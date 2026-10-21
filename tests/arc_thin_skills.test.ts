import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
import { Binder, type Component } from '../demo/arc_thin_binder.ts';
import { parseRefinerReply } from '../demo/arc_thin_refiner.ts';
import { dueSkills, eventKinds, SKILL_PUSH_MAX } from '../demo/arc_thin_skills.ts';
import { Workspace } from '../demo/arc_thin_workspace.ts';

// docs/plans/2026-10-21-components-by-default-canonical-forms.md, S3 (ARC_THIN_SKILLS=1): skills with a consumer. Functional
// checks on a stand-in model and a toy board; whether an agent writes or follows a skill is a question for runs.

const skillFile = (name: string, header: string, body = 'Run scripts/walk.py on the grid, then click the cell it reports.') =>
  `---\nname: ${name}\n${header}---\n${body}\n`;

test('skills on: a weak header loads with defaults and a warning, a known trigger is kept, only an empty body is refused; skills off: the strict reading', async () => {
  const dir = () => new Workspace(mkdtempSync(join(tmpdir(), 'skills-binder-')));
  const w = dir(), on = new Binder(w, undefined, { skills: true });
  const save = async (b: Binder, workspace: Workspace, path: string, content: string) => { workspace.runtimeWrite(path, content); return (await b.save(path, 0))!; };
  assert.match(await save(on, w, 'skills/edge/SKILL.md', '---\nname: edge\n---\n# Walk the edge\nStep 1.\n'),
    /skill edge v1: saved · loaded .*\(warning: no description: the first line of the body is used\)$/);
  assert.match(await save(on, w, 'skills/bare/SKILL.md', 'Walk the edge cell by cell.\n'), /\(warning: no frontmatter: the directory name and the first line of the body are used\)$/);
  assert.match(await save(on, w, 'skills/named/SKILL.md', skillFile('other', 'description: d\n')), /\(warning: name "other" differs from its directory; named is used\)$/);
  assert.match(await save(on, w, 'skills/timed/SKILL.md', skillFile('timed', 'description: d\nmetadata:\n  trigger: level_start\n')), /saved · loaded · active from your next request$/);
  assert.match(await save(on, w, 'skills/odd/SKILL.md', skillFile('odd', 'description: d\nmetadata:\n  trigger: weekly\n')), /\(warning: metadata\.trigger "weekly" is not one of level_start, stall: no trigger\)$/);
  assert.match(await save(on, w, 'skills/empty/SKILL.md', '---\nname: empty\ndescription: d\n---\n'), /NOT loaded \(a skill needs a body\)/);
  on.boundary();
  const bound = Object.fromEntries(on.active().map((c) => [c.name, c]));
  assert.equal(bound.edge.description, 'Walk the edge');
  assert.equal(bound.bare.description, 'Walk the edge cell by cell.');
  assert.equal(bound.timed.trigger, 'level_start');
  assert.equal(bound.odd.trigger, undefined);
  assert.equal(bound.empty, undefined);
  assert.match(on.index(0), /\nskill timed v1 active \[level_start\]: d · read skills\/timed\/SKILL\.md/);

  // Without the flag a header without a description is refused, as it was, and the index is the legacy one.
  const other = dir(), off = new Binder(other);
  assert.match(await save(off, other, 'skills/edge/SKILL.md', '---\nname: edge\n---\nbody\n'), /NOT loaded \(description is required\)/);
  assert.match(await save(off, other, 'skills/timed/SKILL.md', skillFile('timed', 'description: d\nmetadata:\n  trigger: level_start\n')), /saved · loaded · active from your next request$/);
  off.boundary();
  assert.equal(off.active()[0].trigger, undefined);
  assert.match(off.index(0), /\nskill timed v1 active: d · read skills\/timed\/SKILL\.md/);
});

test('skills on: an index over its budget keeps the clipped descriptions that route; without the flag it falls back to names', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'skills-index-'))), on = new Binder(w, undefined, { skills: true }), off = new Binder(w);
  for (let n = 0; n < 7; n++) {
    w.runtimeWrite(`skills/s${n}/SKILL.md`, skillFile(`s${n}`, `description: ${`Kind ${n} of work, `.padEnd(160, 'x')}\nmetadata:\n  trigger: stall\n`));
    await on.save(`skills/s${n}/SKILL.md`, 0); await off.save(`skills/s${n}/SKILL.md`, 0);
  }
  on.boundary(); off.boundary();
  const kept = on.index(0);
  assert.ok(kept.length <= 1200, String(kept.length));
  assert.match(kept, /skill s0 v1 active \[stall\]: Kind 0 of work, x+… · read skills\/s0\/SKILL\.md/);
  assert.equal(kept.split('\n').filter((line) => line.startsWith('skill ')).length, 7);
  assert.match(off.index(0), /^HARNESS \(names only; read a file for its text\)\nskills: s0, s1, s2, s3, s4, s5, s6/);
});

test('several FILE blocks are one skill directory when skills are on; without the flag only the first block is read; anything else is refused', () => {
  const reply = `FILE skills/edge/SKILL.md\n${skillFile('edge', 'description: d\n').trimEnd()}\nEND\nFILE skills/edge/scripts/walk.py\ndef run(grid):\n    return 1\nEND\nWHY level 1 was won by walking the edge`;
  const on = parseRefinerReply(reply, { skills: true });
  assert.equal(on.kind, 'file');
  if (on.kind === 'file') {
    assert.equal(on.path, 'skills/edge/SKILL.md');
    assert.deepEqual(on.extra?.map((f) => f.path), ['skills/edge/scripts/walk.py']);
    assert.equal(on.why, 'level 1 was won by walking the edge');
  }
  const off = parseRefinerReply(reply);
  assert.equal(off.kind, 'file');
  if (off.kind === 'file') assert.equal(off.extra, undefined, 'the second block is ignored, as before');
  const block = (path: string) => `FILE ${path}\nx = 1\nEND\n`;
  const main = block('skills/edge/SKILL.md');
  for (const [why, text] of [['another skill directory', main + block('skills/other/scripts/a.py')], ['a file outside skills/', main + block('tools/a.py')],
    ['a path outside the directory', main + block('skills/edge/../x.py')], ['the same path twice', main + block('skills/edge/scripts/a.py') + block('skills/edge/scripts/a.py')],
    ['more than five files', main + [1, 2, 3, 4, 5].map((n) => block(`skills/edge/scripts/f${n}.py`)).join('')], ['no SKILL.md', block('skills/edge/scripts/a.py') + block('skills/edge/scripts/b.py')]])
    assert.equal(parseRefinerReply(`${text}WHY w`, { skills: true }).kind, 'invalid', why);
  // A lone file beside a skill is a valid reply only with the flag.
  assert.equal(parseRefinerReply(`${block('skills/edge/scripts/a.py')}WHY w`, { skills: true }).kind, 'file');
  assert.equal(parseRefinerReply(`${block('skills/edge/scripts/a.py')}WHY w`).kind, 'invalid');
});

test('a skill with a trigger is due once for each event; one without a trigger, an inactive one and one already shown are not', () => {
  const skill = (name: string, trigger: string | undefined, extra: Partial<Component> = {}): Component => ({ kind: 'skill', name, path: `skills/${name}/SKILL.md`,
    description: name, enabled: true, version: 1, hash: '', source: '', level: 0, body: `do ${name}`, ...(trigger ? { trigger } : {}), ...extra });
  const skills = [skill('a', 'level_start'), skill('b', 'stall'), skill('c', undefined), skill('d', 'level_start', { enabled: false }),
    skill('e', 'level_start', { version: 3 }), skill('f', 'level_start'), skill('g', 'level_start')];
  const shown = new Map<string, string>();
  const paths = (events: Parameters<typeof dueSkills>[1]) => dueSkills(skills, events, shown, 10).map((push) => push.path.split('/')[1]);
  assert.equal(SKILL_PUSH_MAX, 2);
  assert.deepEqual(paths({ level: 'level:1' }), ['e', 'a'], 'level-start skills only, the newest version first, at most two');
  shown.set('skills/e/SKILL.md', 'level:1'); shown.set('skills/a/SKILL.md', 'level:1');
  assert.deepEqual(paths({ level: 'level:1' }), ['f', 'g'], 'the ones shown for this event are not due again');
  shown.set('skills/f/SKILL.md', 'level:1'); shown.set('skills/g/SKILL.md', 'level:1');
  assert.deepEqual(paths({ level: 'level:1' }), []);
  assert.deepEqual(paths({ level: 'level:2' }).sort(), ['a', 'e'], 'the next level is a new event');
  assert.deepEqual(paths({ level: 'level:1', stall: 'stall:55' }), ['b'], 'a stall review is an event for stall skills only');
  const [push] = dueSkills(skills, { level: 'level:1', stall: 'stall:55' }, shown, 55);
  assert.deepEqual(push, { path: 'skills/b/SKILL.md', version: 1, trigger: 'stall', event: 'stall:55', at: 55 });
  // The kind of edit each event suggests, for the refinement to take or leave.
  assert.match(eventKinds(['level 1 reached at #9']).join('\n'), /a level reached: a procedure that won it.*→ a skill/);
  assert.doesNotMatch(eventKinds(['`g = grid` retyped 4 times although x covers it']).join('\n'), /already saves/);
  assert.match(eventKinds(['python computation `g` redone 3 times'], true).join('\n'), /the runtime already saves the functions the agent defines in python/);
  assert.deepEqual(eventKinds(['something else']), []);
});

/** A 16x16 board: a click on the marked cell completes the level (8,8 first, then 3,3); any other click toggles its cell. */
async function world() {
  let n = 0, levels = 0;
  const marks = [[8, 8], [3, 3]];
  const start = () => { const g = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0)); const [x, y] = marks[Math.min(levels, 1)]; g[y][x] = 9; return g; };
  let grid = start();
  const apply = (x?: number, y?: number) => {
    const before = grid.map((r) => [...r]);
    let changed = false;
    if (levels < 2 && x === marks[levels][0] && y === marks[levels][1]) { levels += 1; changed = true; grid = start(); }
    else if (x !== undefined && y !== undefined) grid[y][x] = grid[y][x] ? 0 : 5;
    n += 1;
    return { changed, cells: before.flatMap((r, i) => r.filter((c, j) => c !== grid[i][j])).length };
  };
  const body = (step?: { changed: boolean; cells: number }) => ({ frames: [grid], state: 'NOT_FINISHED', levels_completed: levels,
    agent_available_actions: ['RESET', 'ACTION6'], action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
    observation_delta: { frame_available: true, changed_cells: step?.cells ?? 0, cells: [] }, public_transition: { level_changed: Boolean(step?.changed) } });
  const server: Server = createServer((req, res) => {
    let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
      const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body(call ? apply(call.x, call.y) : undefined)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'skills-run-')) };
}

const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 100, output: 50 } });

/** The native extension on `w` with a stand-in model whose side calls (refinements) wait for the test to settle them. */
async function attach(w: { url: string; root: string }, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: w.root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', PI_ARC_BRIDGE_URL: w.url,
    ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000',
    ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ARC_THIN_REVIEW_CONSULT: '0', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const inputs: string[] = [];
  const pending: Array<(value: any) => void> = [];
  const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
    streamSimple: (_model: any, context: any) => {
      inputs.push(context.messages[0].content[0].text);
      const settled = new Promise((resolve) => pending.push(resolve));
      return { result: () => settled };
    } } };
  await handlers.get('session_start')({}, ctx);
  const text = (result: any) => (result.content ?? []).map((b: any) => b.text ?? '').join('\n');
  const call = async (name: string, params: any) => text(await tools.get(name).execute('t', params, undefined, undefined, ctx));
  const rows = (name: string) => existsSync(join(w.root, 'harness', name))
    ? readFileSync(join(w.root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return {
    inputs, rows, call,
    file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
    async begin(prompt = 'Decide the next action.') {
      const event: any = { prompt, systemPromptOptions: { sections: {} } };
      await handlers.get('before_agent_start')(event, ctx);
      const head = (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages[0];
      return head.content.map((b: any) => b.text ?? '').join('\n');
    },
    act: (params: any) => call('arc_action', repairActionArguments(params)),
    /** The model answered the decision (Pi's message_end for an assistant message). */
    answer: async () => { await handlers.get('message_end')({ message: reply('ok') }); },
    async settle(value: any) { pending.shift()!(value); await new Promise((r) => setTimeout(r, 200)); },
    async calls(count: number) { for (let i = 0; i < 200 && inputs.length < count; i += 1) await new Promise((r) => setTimeout(r, 50)); },
    async close() {
      for (const resolve of pending.splice(0)) resolve(reply('NONE closing'));
      await new Promise((r) => setTimeout(r, 300));
      await handlers.get('session_shutdown')?.({}, ctx);
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

const EDGE_HEADER = 'description: Walk the board edge and click the first cell that differs; use it when a level starts.\nmetadata:\n  trigger: level_start\n';
const edgeReply = (name: string) => `FILE skills/${name}/SKILL.md\n${skillFile(name, EDGE_HEADER).trimEnd()}\nEND\nFILE skills/${name}/scripts/walk.py\n` +
  `def run(grid):\n    return [(r, c) for r, row in enumerate(grid) for c, v in enumerate(row) if v][:1]\nEND\nWHY level 1 was won by a click on the one marked cell`;
const shownRows = (h: { rows: (name: string) => any[] }) => h.rows('call_points.jsonl').filter((row) => row.kind === 'skill_shown');

test('a skill directory a refinement replies with is bound, indexed with its description, shown once at each level start and counted when read', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_SKILLS: '1' });
  try {
    await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
    await h.begin(); await h.act({ action: 'ACTION6', x: 2, y: 2 });
    await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
    // Level 1 is complete: the refinement it starts is told what skills are and which kind of edit the event suggests.
    await h.begin();
    await h.calls(1);
    assert.match(h.inputs[0], /^WHY NOW: level 1 reached at #3/);
    assert.match(h.inputs[0], /THE KIND OF EDIT THE EVENT SUGGESTS \(yours to decide\):\n- a level reached: a procedure that won it, repeatable on another level → a skill/);
    assert.match(h.inputs[0], /\nSAVED SKILLS:\n\(none\)/);
    await h.settle(reply(edgeReply('edge')));
    assert.match(h.file('workspace/skills/edge/scripts/walk.py'), /def run\(grid\)/);
    const edit = h.rows('refiner.jsonl').find((row) => row.kind === 'edit');
    assert.deepEqual([edit.path, edit.category, edit.files, edit.loaded], ['skills/edge/SKILL.md', 'skill', ['skills/edge/scripts/walk.py'], true]);
    await h.act({ action: 'ACTION6', x: 5, y: 5 });

    // The next decision is told of the edit, has the skill in the index with its description, and is shown the skill once.
    const first = await h.begin();
    assert.match(first, /HARNESS UPDATE by a refinement after #3 \(level 1 reached at #3\): skills\/edge\/SKILL\.md v1 with scripts\/walk\.py/);
    assert.match(first, /\nskill edge v1 active \[level_start\]: Walk the board edge and click the first cell that differs; use it when a level starts\. · read skills\/edge\/SKILL\.md/);
    assert.match(first, /\nSKILL skills\/edge\/SKILL\.md v1, shown once for level 2 \(read skills\/edge\/SKILL\.md again when a step matches; whether it applies now is yours to judge\): Walk the board edge[^\n]*\nRun scripts\/walk\.py on the grid/);
    assert.equal(shownRows(h).length, 0, 'it counts as shown when the model has answered the decision');
    assert.ok(first.indexOf('shown once for level 2') > first.indexOf('HARNESS (your prompts'), 'with the context layout the push closes the head');
    await h.answer();
    await h.act({ action: 'ACTION6', x: 6, y: 6 });
    const second = await h.begin();
    assert.doesNotMatch(second, /shown once for level/);
    assert.deepEqual(shownRows(h).map((row) => [row.path, row.version, row.trigger, row.event]), [['skills/edge/SKILL.md', 1, 'level_start', 'level:1']]);

    // Opening the skill is logged as a read of it, after it was shown; the index reports both counts.
    assert.match(await h.call('read', { path: 'skills/edge/SKILL.md' }), /Run scripts\/walk\.py/);
    assert.deepEqual(h.rows('call_points.jsonl').filter((row) => row.kind === 'skill_read').map((row) => [row.skill, row.version, row.review, row.shown]), [['edge', 1, false, true]]);
    await h.act({ action: 'ACTION6', x: 3, y: 3 });

    // Level 2 is a new event: the refinement sees the skill it has, and the skill is shown again, once.
    const third = await h.begin();
    await h.calls(2);
    assert.match(h.inputs[1], /^WHY NOW: level 2 reached at #6/);
    assert.match(h.inputs[1], /\nSAVED SKILLS:\n--- skills\/edge\/SKILL\.md v1 \[level_start\] REFINED: Walk the board edge/);
    assert.match(third, /SKILL skills\/edge\/SKILL\.md v1, shown once for level 3/);
    assert.match(third, /skill edge v1 (?:active|stale) \[level_start\]: .* · shown 1×, read 1×/);
    await h.settle(reply('NONE the skill covers it'));
    await h.answer();
    assert.doesNotMatch(await h.begin(), /shown once for level/);
    assert.deepEqual(shownRows(h).map((row) => row.event), ['level:1', 'level:2']);
  } finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('a skill the agent writes in a stall review is shown once at the first decision after it, and again after the next stall review', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_SKILLS: '1' });
  const steady = skillFile('steady', 'description: What to check first when a level stays open.\nmetadata:\n  trigger: stall\n', 'List the moves not yet tried, then play the one that differs most from the last three.');
  try {
    await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
    await h.begin('STALL REVIEW. Level 1 is still open after 40 actions; this turn takes no action.');
    assert.match(await h.call('write', { path: 'skills/steady/SKILL.md', content: steady }), /skills\/steady\/SKILL\.md → skill steady v1: saved · loaded · active from your next request/);
    await h.answer();
    const after = await h.begin();
    assert.match(after, /SKILL skills\/steady\/SKILL\.md v1, shown once after the stall review just made[^\n]*: What to check first when a level stays open\.\nList the moves not yet tried/);
    await h.answer();
    await h.act({ action: 'ACTION6', x: 2, y: 2 });
    assert.doesNotMatch(await h.begin(), /shown once after the stall review/);
    assert.deepEqual(shownRows(h).map((row) => [row.path, row.event]), [['skills/steady/SKILL.md', 'stall:1']]);

    await h.act({ action: 'ACTION6', x: 4, y: 4 });
    await h.begin('STALL REVIEW. Level 1 is still open after 40 actions; this turn takes no action.');
    await h.answer();
    assert.match(await h.begin(), /SKILL skills\/steady\/SKILL\.md v1, shown once after the stall review just made/);
    await h.answer();
    assert.doesNotMatch(await h.begin(), /shown once after the stall review/);
    assert.deepEqual(shownRows(h).map((row) => row.event), ['stall:1', 'stall:3']);
  } finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('a skill whose header would load without what it was written for goes back to the refinement once, with the reason', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_SKILLS: '1' });
  try {
    await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
    await h.begin();
    await h.calls(1);
    const header = (description: string) => `description: ${description}\nmetadata:\n  trigger: level_start\n`;
    // A colon inside an unquoted description is not YAML: the skill would load with the first body line and no trigger.
    await h.settle(reply(`FILE skills/edge/SKILL.md\n${skillFile('edge', header('Use it when: a level starts')).trimEnd()}\nEND\nWHY w`));
    await h.calls(2);
    assert.match(h.inputs[1], /\nNOT APPLIED: the header of skills\/edge\/SKILL\.md has a problem: frontmatter is not valid YAML/);
    assert.equal(h.file('workspace/skills/edge/SKILL.md'), '');
    await h.settle(reply(`FILE skills/edge/SKILL.md\n${skillFile('edge', header('"Use it when: a level starts"')).trimEnd()}\nEND\nWHY w`));
    assert.match(h.file('workspace/skills/edge/SKILL.md'), /trigger: level_start/);
    assert.deepEqual([h.rows('refiner.jsonl').filter((row) => row.kind === 'returned').length, h.rows('refiner.jsonl').filter((row) => row.kind === 'edit').length], [1, 1]);
  } finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('a restarted run, or a fork, does not show a skill again for an event it was shown for, and shows one whose decision was never answered', async () => {
  const w = await world();
  const options = { ARC_THIN_SKILLS: '1' };
  const first = await attach(w, options);
  let last = first;
  try {
    await first.begin();
    await first.call('write', { path: 'skills/edge/SKILL.md', content: skillFile('edge', EDGE_HEADER) });
    await first.act({ action: 'ACTION6', x: 1, y: 1 });
    assert.match(await first.begin(), /SKILL skills\/edge\/SKILL\.md v1, shown once for level 1/);
    await first.close();
    // The model never answered that decision: the skill is still due.
    assert.deepEqual(shownRows(first), []);
    const second = last = await attach(w, options);
    assert.match(await second.begin(), /SKILL skills\/edge\/SKILL\.md v1, shown once for level 1/);
    await second.answer();
    await second.close();
    assert.deepEqual(shownRows(second).map((row) => row.event), ['level:0']);
    // It was answered and closed: a run that starts from these files does not show it again.
    const third = last = await attach(w, options);
    assert.doesNotMatch(await third.begin(), /shown once for level/);
    assert.deepEqual(shownRows(third).map((row) => row.event), ['level:0']);
    // A stall review's skill, written before a restart, is still shown once after it.
    await third.act({ action: 'ACTION6', x: 2, y: 2 });
    await third.begin('STALL REVIEW. Level 1 is still open after 40 actions; this turn takes no action.');
    await third.call('write', { path: 'skills/steady/SKILL.md', content: skillFile('steady', 'description: What to check first when a level stays open.\nmetadata:\n  trigger: stall\n') });
    await third.answer();
    await third.close();
    const fourth = last = await attach(w, options);
    assert.match(await fourth.begin(), /SKILL skills\/steady\/SKILL\.md v1, shown once after the stall review just made/);
    await fourth.answer();
    assert.doesNotMatch(await fourth.begin(), /shown once after the stall review/);
    assert.deepEqual(shownRows(fourth).map((row) => row.event), ['level:0', 'stall:2'], 'the event is the action count at the stall review');
  } finally { await last.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('flag off: a skill with a trigger is neither shown nor counted, the refinement is not told of skills, and a skill directory reply is not read as one', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
    await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
    await h.begin();
    assert.match(await h.call('write', { path: 'skills/edge/SKILL.md', content: skillFile('edge', EDGE_HEADER) }), /skills\/edge\/SKILL\.md → skill edge v1: saved · loaded · active from your next request$/);
    await h.calls(1);
    assert.match(h.inputs[0], /^WHY NOW: level 1 reached at #2/);
    assert.doesNotMatch(h.inputs[0], /SAVED SKILLS|THE KIND OF EDIT THE EVENT SUGGESTS/);
    await h.settle(reply(edgeReply('refined')));
    // The first block is read as the one FILE it always was; the file beside it is not written.
    assert.match(h.file('workspace/skills/refined/SKILL.md'), /name: refined/);
    assert.equal(h.file('workspace/skills/refined/scripts/walk.py'), '');
    await h.answer();
    const head = await h.begin();
    assert.match(head, /\nskill edge v1 active: Walk the board edge and click the first cell that differs; use it when a level starts\. · read skills\/edge\/SKILL\.md/);
    assert.doesNotMatch(head, /shown once for level|\[level_start\]/);
    await h.answer();
    await h.begin();
    await h.call('read', { path: 'skills/edge/SKILL.md' });
    assert.deepEqual(h.rows('call_points.jsonl').filter((row) => /^skill_/.test(row.kind)), []);
  } finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});
