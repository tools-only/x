/** P0 diagnostic unit/fixture tests only. No ARC engine, Pi loop, or provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoalAdmission, goalAdmissionMode, refuseGoal, applyOutcome, goalDocument, overlapsStatus,
  type GoalClaim, type GoalRecord, type GoalOutcome } from '../demo/arc_thin_goal_admission.ts';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
const strategy = 'prompts/strategy.md';
const claim = (patch: Partial<GoalClaim> = {}): GoalClaim => ({ id: 'goal.exit', level: 0, claim: 'The switch opens the exit',
  rivals: [{ claim: 'The switch only recolors itself', predicts: { changed_cells: 1 } }],
  discriminating_move: { actions: [{ action: 'ACTION1' }], predicts: { changed_cells: 3 } },
  kill_condition: { state: 'GAME_OVER' }, state: 'proposed', ...patch });
const doc = (g: GoalClaim = claim(), route = false) => `---\nactive: true\n---\n## Next experiment\n- Test the switch [${g.id}]\n${route ? `Route: ACTION1 [${g.id}]\n` : ''}\n\`\`\`goal-claim\n${JSON.stringify(g)}\n\`\`\`\n`;
const outcome = (patch: Partial<GoalOutcome> = {}): GoalOutcome => ({ n: 1, level: 0, action: 'ACTION1', state: 'NOT_FINISHED',
  level_changed: false, changed_cells: 3, ...patch });
const record = (g = claim()): GoalRecord => ({ goal: g, state: 'under_test', progress: 0, at: 0 });

test('refuse a goal without a rival; reject non-discriminating and unobservable contracts', () => {
  assert.match(refuseGoal(claim({ rivals: [] }))!, /rival/);
  assert.match(refuseGoal(claim({ rivals: [{ claim: 'rival', predicts: { changed_cells: 3 } }] }))!, /disagree/);
  assert.match(refuseGoal(claim({ rivals: [{ claim: 'rival', predicts: { state: 'WIN' } }] }))!, /common observable/);
  assert.match(refuseGoal(claim({ kill_condition: {} }))!, /observable/);
  assert.match(refuseGoal(claim({ kill_condition: { prose: 'bad' } as any }))!, /observable/);
  assert.match(refuseGoal(claim({ discriminating_move: { actions: Array(5).fill({ action: 'ACTION1' }), predicts: { changed_cells: 3 } } }))!, /1-4/);
  assert.match(refuseGoal(claim({ terminal_risk: { planned_actions: 4, remaining_actions: 4 } }))!, /shorter/);
  assert.equal(refuseGoal(claim()), undefined);
});

test('GAME_OVER retires; level-change miss contests; observable kill retires without refinement', () => {
  assert.equal(applyOutcome(record(), outcome({ state: 'GAME_OVER' })).state, 'retired');
  const missed = applyOutcome(record(), outcome({ predicted_level_change: true }));
  assert.equal(missed.state, 'contested'); assert.match(missed.reason!, /level_change missed/);
  const killed = applyOutcome(record(claim({ kill_condition: { cells: [{ x: 2, y: 0, value: 0 }] } })), outcome({ after: [[1, 2, 0]] }));
  assert.equal(killed.state, 'retired'); assert.equal(killed.reason, 'kill_condition hit');
  assert.equal(applyOutcome(record(), outcome({ level: 1, state: 'GAME_OVER' })).state, 'under_test', 'level scope preserved');
});

test('support comes from the completed separating test, never an authored state', () => {
  const a = new GoalAdmission('on');
  assert.equal(a.admit(strategy, doc(claim({ state: 'supported' })), 0, 0).ok, true);
  assert.equal(a.records.get('goal.exit')!.state, 'under_test');
  assert.equal(a.admit(strategy, doc(claim(), true), 0, 0).ok, false);
  a.outcome(['goal.exit'], outcome({ action: 'ACTION2' }));
  assert.equal(a.records.get('goal.exit')!.state, 'under_test');
  a.outcome(['goal.exit'], outcome());
  assert.equal(a.admit(strategy, doc(claim(), true), 0, 1).ok, true);
  assert.equal(a.route(strategy, doc(claim(), true), 1).ok, false);
  a.outcome(['goal.exit'], outcome({ n: 2, state: 'GAME_OVER' }));
  assert.equal(a.route(strategy, doc(claim(), true), 0).ok, false);
  assert.equal(a.admit(strategy, doc(claim({ id: 'goal.renamed' })), 0, 2).ok, false, 'renaming cannot erase counterevidence');
  assert.equal(a.admit(strategy, '---\nactive: true\n---\n## Next experiment\n', 0, 2).ok, true, 'withdrawal remains possible');
});

test('off is default; shadow computes and tracks without refusing writes or Route', () => {
  assert.equal(goalAdmissionMode(), 'off'); assert.throws(() => goalAdmissionMode('yes'), /must be/);
  for (const mode of ['off', 'shadow', 'on'] as const) {
    const a = new GoalAdmission(mode);
    const invalid = a.admit(strategy, doc(claim({ rivals: [] })), 0, 0);
    assert.equal(invalid.ok, mode !== 'on');
    assert.equal(invalid.wouldRefuse, mode !== 'off');
    assert.equal(a.route(strategy, doc(claim(), true), 0).ok, mode !== 'on');
    if (mode === 'shadow') {
      a.outcome(['goal.exit'], outcome({ state: 'GAME_OVER' }));
      assert.equal(a.records.get('goal.exit')!.state, 'retired');
      assert.equal(a.route(strategy, doc(claim(), true), 0).ok, true);
    }
    if (mode === 'off') assert.equal(a.records.size, 0);
  }
});

test('busy row, column and ticker overlap need level confirmation', () => {
  const mask = { rows: new Set([7]), cols: new Set([5]), ticker: new Set(['2,3']) };
  for (const cell of [{ x: 0, y: 7 }, { x: 5, y: 0 }, { x: 2, y: 3 }]) {
    assert.equal(overlapsStatus([cell], mask), true);
    const a = new GoalAdmission('on');
    assert.match(a.admit(strategy, doc(claim({ goal_region: [cell] })), 0, 8, mask).reason!, /busy line/);
  }
});

test('rules goal lines need runtime level-change evidence and explicit scope/citation', () => {
  const a = new GoalAdmission('on'), g = claim({ discriminating_move: { actions: [{ action: 'ACTION1' }], predicts: { level_changed: true } },
    rivals: [{ claim: 'No exit', predicts: { level_changed: false } }] });
  const rules = (line: string) => doc(g).replace('## Next experiment\n- Test the switch [goal.exit]', line);
  assert.equal(a.admit('prompts/rules.md', rules('- Level 1: the switch wins [goal.exit]'), 0, 0).ok, false);
  a.admit(strategy, doc(g), 0, 0);
  a.outcome([g.id], outcome({ level_changed: true }));
  assert.equal(a.admit('prompts/rules.md', rules('- Level 1: the switch wins [goal.exit]'), 1, 1).ok, true);
  assert.equal(a.admit('prompts/rules.md', rules('- The switch wins [goal.exit]'), 1, 1).ok, false);
  assert.equal(a.admit('prompts/rules.md', rules('- Level 2: the switch wins [goal.exit]'), 1, 1).ok, false);
});

test('shared Workspace seam refuses parent write/edit, refiner/guest write, restore and move before mutation', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'goal-write-'))), a = new GoalAdmission('on');
  w.beforeWrite = (path, source) => { const v = a.admit(path, source, 0, 0); if (!v.ok) throw Error(`GOAL_ADMISSION: ${v.reason}`); };
  const tools = Object.fromEntries(w.fileTools().map(t => [t.name, t]));
  const call = (name: string, args: any) => tools[name].execute('test', args, undefined, undefined, { cwd: w.root } as any);
  const bad = '---\nactive: true\n---\n## Next experiment\n- Clear the timer to win\n';
  await assert.rejects(call('write', { path: './prompts/strategy.md', content: bad }), /GOAL_ADMISSION/);
  assert.equal(existsSync(w.path(strategy)), false);
  w.mutate({ op: 'write', path: strategy, content: doc() });
  const before = w.read(strategy);
  await assert.rejects(call('edit', { path: strategy, edits: [{ oldText: '"rivals":[{"claim":"The switch only recolors itself","predicts":{"changed_cells":1}}]', newText: '"rivals":[]' }] }), /GOAL_ADMISSION/);
  assert.equal(w.read(strategy), before);
  for (const path of [strategy, 'PROMPTS/STRATEGY.MD'])
    assert.throws(() => w.mutate({ op: 'write', path, content: bad }), /GOAL_ADMISSION/, 'shared refiner/Python/restore mutation');
  w.mutate({ op: 'write', path: 'notes/bad.md', content: bad });
  assert.throws(() => w.mutate({ op: 'move', path: 'notes/bad.md', destination: strategy }), /GOAL_ADMISSION/);
  assert.equal(w.read(strategy), before);
});

/** The production extension's registered tools/hooks with an in-memory fetch double. No sockets or ARC runner. */
async function fixture(mode: 'off' | 'shadow' | 'on', options: { refinerReply?: string; root?: string } = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'goal-extension-'));
  mkdirSync(join(root, 'harness'), { recursive: true });
  if (!options.root) writeFileSync(join(root, 'harness', 'usage.jsonl'), JSON.stringify({ kind: 'refiner', input: 100000, output: 100000 }) + '\n');
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    ARC_THIN_OBSERVATION: 'query', ARC_THIN_GOAL_ADMISSION: mode, ARC_THIN_REFINE_POINT: '0', ARC_THIN_REVIEW_CONSULT: '0',
    ARC_THIN_NO_EFFECT_REPEATS: '0', ARC_THIN_COVERAGE: '0', ARC_THIN_PYTHON_KERNEL: '0',
    ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_CRITIC_MIN_GAP: '999',
    PI_ARC_BRIDGE_URL: 'http://unit.invalid', ARC_THIN_CONTEXT_LAYOUT: '1' });
  let n = 0, status = 'NOT_FINISHED', levels = 0, next: any = {};
  const state = () => ({ frames: [[[0, n % 10, 0], [0, 0, 0], [0, 0, 0]]], state: status, levels_completed: levels,
    agent_available_actions: ['ACTION1', 'ACTION2', 'RESET'], action_budget: { used: n, maximum: 40 } });
  globalThis.fetch = (async (url: any) => {
    assert.match(String(url), /^http:\/\/unit\.invalid\/(state|action)$/);
    if (String(url).endsWith('/action')) { n++; status = next.state ?? 'NOT_FINISHED'; if (next.level_changed) levels++; }
    return new Response(JSON.stringify({ ...state(), observation_delta: { changed_cells: next.changed_cells ?? 3 },
      public_transition: { level_changed: Boolean(next.level_changed) } }), { headers: { 'content-type': 'application/json' } });
  }) as any;
  const tools = new Map<string, any>(), hooks = new Map<string, any>(); let active: string[] = [];
  let calls = 0;
  const ctx: any = { model: { id: 'unit-double', provider: 'unit', input: ['text'] }, modelRegistry: { streamSimple: () => {
    calls++;
    return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: options.refinerReply ?? 'NONE unit' }],
      stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } }) };
  } } };
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (name: string, f: any) => hooks.set(name, f),
    getThinkingLevel: () => 'off' } as any);
  const call = async (name: string, params: any) => tools.get(name).execute('unit', params, undefined, undefined, ctx);
  const rows = (name: string) => existsSync(join(root, 'harness', name)) ? readFileSync(join(root, 'harness', name), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  await hooks.get('session_start')({}, ctx);
  return { root, call, rows, get calls() { return calls; }, get actions() { return n; }, setOutcome: (v: any) => next = v,
    async begin() {
      const event = { prompt: 'Decide.', systemPromptOptions: { sections: {} } };
      await hooks.get('before_agent_start')(event, ctx);
      const result = await hooks.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx);
      return JSON.stringify(result) + JSON.stringify(event);
    },
    async act(patch: any = {}) { return call('arc_action', repairActionArguments({ action: 'ACTION1', ...patch })); },
    async close() {
      await hooks.get('session_shutdown')?.({}, ctx);
      globalThis.fetch = originalFetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    } };
}

for (const mode of ['off', 'shadow', 'on'] as const) test(`extension write and Route behavior in ${mode}`, async () => {
  const h = await fixture(mode);
  try {
    await h.begin();
    const bad = '---\nactive: true\n---\nRoute: clear the bar to win\n';
    if (mode === 'on') await assert.rejects(h.call('write', { path: strategy, content: bad }), /GOAL_ADMISSION/);
    else assert.equal(Boolean((await h.call('write', { path: strategy, content: bad })).isError), false);
    assert.equal(existsSync(join(h.root, 'workspace', strategy)), mode !== 'on');
    if (mode !== 'on') {
      await h.begin(); const r = await h.act();
      assert.equal(Boolean(r.isError), false); assert.equal(h.actions, 1);
    }
    if (mode === 'off') assert.equal(h.rows('goal_admission.jsonl').length, 0);
    if (mode === 'shadow') assert.ok(h.rows('goal_admission.jsonl').some(r => r.kind === 'route_gate' && r.wouldRefuse && r.ok));

  } finally { await h.close(); }
});

test('direct runtime outcome falsifies over refiner cost cap and throttle; stale Route blocked and next head withdrawn', async () => {
  const h = await fixture('on');
  try {
    await h.begin();
    assert.equal(Boolean((await h.call('write', { path: strategy, content: doc() })).isError), false);
    await h.act();
    let rows = h.rows('goal_admission.jsonl');
    assert.equal(rows.at(-1).records[0].state, 'supported');
    await h.begin();
    assert.equal(Boolean((await h.call('write', { path: strategy, content: doc(claim(), true) })).isError), false);
    await h.begin();
    h.setOutcome({ state: 'GAME_OVER' });
    await h.act();
    rows = h.rows('goal_admission.jsonl');
    const result = rows.findLast(r => r.kind === 'outcome');
    assert.equal(result.records[0].state, 'retired'); assert.equal(result.n, 2);
    assert.equal(h.calls, 0, 'no side-model adjudication needed');
    await h.begin();
    await assert.rejects(h.act(), /GOAL_ADMISSION/); assert.equal(h.actions, 2);
    const head = await h.begin();
    assert.match(head, /GOAL_ADMISSION withheld/);
    assert.doesNotMatch(head, /Route: ACTION1/);
    const corrections = await h.call('write', { path: strategy, content: '---\nactive: true\n---\n## Open questions\nFind a different explanation.\n' });
    assert.equal(Boolean(corrections.isError), false);
  } finally { await h.close(); }
});

for (const [name, patch, predicted, expected] of [
  ['level miss', {}, { level_changed: true }, 'contested'],
  ['kill hit', { changed_cells: 0 }, undefined, 'retired'],
] as const) test(`direct runtime ${name} works without a refinement turn`, async () => {
  const h = await fixture('on');
  try {
    await h.begin();
    const g = claim({ kill_condition: { changed_cells: 0 } });
    await h.call('write', { path: strategy, content: doc(g) });
    h.setOutcome(patch);
    await h.act(predicted ? { predict: predicted } : {});
    assert.equal(h.rows('goal_admission.jsonl').findLast(r => r.kind === 'outcome').records[0].state, expected);
    assert.equal(h.calls, 0);
  } finally { await h.close(); }
});

test('refiner FILE edits traverse the same hard refusal seam', async () => {
  const h = await fixture('on', { refinerReply: 'FILE prompts/strategy.md\nNext experiment\n- Clear the bar to win\nEND\nWHY unit' });
  try {
    await h.begin();
    await h.call('refine', { focus: 'test the current goal' });
    for (let i = 0; i < 50 && !h.rows('refiner.jsonl').some(r => r.kind === 'refused'); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(h.calls, 1);
    assert.ok(h.rows('refiner.jsonl').some(r => r.kind === 'refused' && /GOAL_ADMISSION/.test(r.why)));
    assert.equal(existsSync(join(h.root, 'workspace', strategy)), false);
  } finally { await h.close(); }
});

test('a multi-action discriminator supports only its complete sequence; RESET restarts progress', () => {
  const g = claim({ discriminating_move: { actions: [{ action: 'ACTION1' }, { action: 'ACTION2' }], predicts: { changed_cells: 3 } } });
  const r = applyOutcome(record(g), outcome());
  assert.equal(r.state, 'under_test'); assert.equal(r.progress, 1);
  assert.equal(applyOutcome(r, outcome({ n: 2, action: 'RESET' })).progress, 0);
  const supported = applyOutcome(r, outcome({ n: 2, action: 'ACTION2' }));
  assert.equal(supported.state, 'supported'); assert.equal(supported.goal.state, 'supported');
  assert.equal(applyOutcome(supported, outcome({ n: 3, state: 'GAME_OVER' })).goal.state, 'retired');
});

test('supported busy-line goal requires actual level confirmation, and Route cites the supported claim', () => {
  const a = new GoalAdmission('on'), g = claim({ goal_region: [{ x: 0, y: 7 }] });
  a.admit(strategy, doc(g), 0, 0); a.outcome([g.id], outcome());
  const mask = { rows: new Set([7]), cols: new Set<number>(), ticker: new Set<string>() };
  assert.equal(a.route(strategy, doc(g, true), 0, mask).ok, false);
  assert.equal(a.route(strategy, doc(g, true).replace('Route: ACTION1 [goal.exit]', 'Route: ACTION1 [goal.other]'), 0).ok, false);
  const confirmed = new GoalAdmission('on', [{ ...a.records.get(g.id)!, level_confirmed: true }]);
  assert.equal(confirmed.admit(strategy, doc(g, true), 0, 1, mask).ok, true);
});

test('retirement and evidence survive production extension reconstruction; old seeded Route cannot run', async () => {
  let h = await fixture('on');
  const root = h.root;
  try {
    await h.begin(); await h.call('write', { path: strategy, content: doc() }); await h.act();
    await h.begin(); await h.call('write', { path: strategy, content: doc(claim(), true) });
    await h.begin(); h.setOutcome({ state: 'GAME_OVER' }); await h.act();
  } finally { await h.close(); }
  h = await fixture('on', { root });
  try {
    const head = await h.begin();
    assert.match(head, /GOAL_ADMISSION withheld/);
    await assert.rejects(h.act(), /retired/);
    assert.equal(h.actions, 0);
    const roster = JSON.parse(readFileSync(join(root, 'workspace/data/goal_claims.json'), 'utf8'));
    assert.equal(roster[0].state, 'retired'); assert.equal(roster[0].evidence_at, 2);
  } finally { await h.close(); }
});

test('unstructured and bold Markdown control sections cannot bypass the protected write gate', () => {
  const a = new GoalAdmission('on');
  for (const body of ['## Next experiment\n- win now', '**Next experiment:** win now', '- Route: win now', '### Route\n- win now'])
    assert.equal(a.admit(strategy, '---\nactive: true\n---\n' + body, 0, 0).ok, false, body);
  assert.equal(goalDocument(strategy, '---\nactive: true\n---\n## Open questions\nWhat is the goal?\n').protected, '', 'goal discussion outside control is allowed');
  assert.equal(a.admit(strategy, doc(claim()).replace('```goal-claim', '```json'), 0, 0).ok, false);
  assert.equal(a.admit('notes/strategy.md', 'Next experiment: discuss anything', 0, 0).ok, true, 'notes are outside control');
});

test('shadow keeps valid but unsupported Route visible, including after contradictory outcomes', async () => {
  const h = await fixture('shadow');
  try {
    await h.begin(); await h.call('write', { path: strategy, content: doc(claim(), true) });
    let head = await h.begin(); assert.match(head, /Route: ACTION1/); assert.doesNotMatch(head, /GOAL_ADMISSION withheld/);
    h.setOutcome({ state: 'GAME_OVER' }); await h.act();
    assert.equal(h.rows('goal_admission.jsonl').findLast(r => r.kind === 'outcome').records[0].state, 'retired');
    head = await h.begin(); assert.match(head, /Route: ACTION1/); assert.doesNotMatch(head, /GOAL_ADMISSION withheld/);
    assert.equal(Boolean((await h.act()).isError), false); assert.equal(h.actions, 2);
  } finally { await h.close(); }
});

test('a pre-existing unsupported Route is withheld and action-gated, while RESET recovery remains available', async () => {
  const h = await fixture('on');
  try {
    writeFileSync(join(h.root, 'workspace', strategy), doc(claim({ state: 'supported' }), true));
    const head = await h.begin(); assert.match(head, /GOAL_ADMISSION withheld/); assert.doesNotMatch(head, /Route: ACTION1/);
    await assert.rejects(h.act(), /GOAL_ADMISSION/); assert.equal(h.actions, 0);
    await h.begin();
    assert.equal(Boolean((await h.act({ action: 'RESET' })).isError), false); assert.equal(h.actions, 1);
  } finally { await h.close(); }
});

test('counterevidence follows equivalent aliases and cannot be erased by changing risk metadata', () => {
  const a = new GoalAdmission('on');
  a.admit(strategy, doc(), 0, 0); a.outcome(['goal.exit'], outcome());
  assert.equal(a.admit(strategy, doc(claim({ id: 'goal.alias' }), true), 0, 1).ok, true);
  a.outcome(['goal.alias'], outcome({ n: 2, state: 'GAME_OVER' }));
  assert.equal(a.admit(strategy, doc(), 0, 2).ok, false, 'old supported alias inherits the refutation');
  assert.equal(a.admit(strategy, doc(claim({ id: 'goal.another', terminal_risk: { planned_actions: 1, remaining_actions: 8 } })), 0, 2).ok, false);
});
