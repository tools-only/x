/** The refinement ledger and EXPECT (r04; ported from claude/refiner-ledger-20261016), and strict checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
import { memoryEditNow, parseExpect, parseRefinerReply, renderEditLedger, REFINER_LEDGER_SYSTEM } from '../demo/arc_thin_refiner.ts';

const reply = (text: string, usage = { input: 100, output: 50 }) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop',
  usage: { ...usage, cacheRead: 0, cacheWrite: 0, totalTokens: usage.input + usage.output } });

const EXPECT_ACTION2 = "EXPECT within 4 actions: the agent plays ACTION2\ndef check(t):\n    return True if t['action'] == 'ACTION2' else None\nEND";

test('an EXPECT block after or before an edit is kept with it; a malformed one is named, not applied', () => {
  const file = parseRefinerReply(`FILE prompts/strategy.md\nNext experiment\n- ACTION2 once\nEND\nWHY #1-#2 never tried ACTION2\n${EXPECT_ACTION2}`);
  assert.equal(file.kind, 'file');
  assert.deepEqual((file as any).expect, { claim: 'the agent plays ACTION2', within: 4,
    check: "def check(t):\n    return True if t['action'] == 'ACTION2' else None\n" });
  assert.equal((file as any).why, '#1-#2 never tried ACTION2');
  assert.doesNotMatch((file as any).content, /EXPECT|def check/, 'the expectation is not part of the file');
  const before = parseRefinerReply(`${EXPECT_ACTION2}\nMEMORY fact.two 2\nACTION2 is untested\nEND\nWHY none of #1-#2 was ACTION2`);
  assert.equal(before.kind, 'memory');
  assert.equal((before as any).expect.claim, 'the agent plays ACTION2');
  const hypothesis = parseRefinerReply("HYPOTHESIS hyp.two\nclaim: ACTION2 moves the 9\nquestion: what ACTION2 does\ncheck:\ndef check(t):\n    return None\nEND\n" +
    "WHY untested\nEXPECT the agent tests it\n```python\ndef check(t):\n    return t['action'] == 'ACTION2' or None\n```\nEND");
  assert.equal(hypothesis.kind, 'hypothesis');
  assert.equal((hypothesis as any).check, 'def check(t):\n    return None\n', 'the hypothesis keeps its own check');
  assert.deepEqual((hypothesis as any).expect, { claim: 'the agent tests it', check: "def check(t):\n    return t['action'] == 'ACTION2' or None\n" });
  assert.deepEqual(parseExpect('EXPECT within 500 actions: x\ndef check(t):\n    return None\nEND').expect?.within, 60, 'the horizon is clamped');
  // su15-f2-src2 #62 wrote the horizon without "actions"; it was read as part of the sentence, with the default horizon.
  assert.deepEqual(parseExpect('EXPECT within 5: The agent stops\ndef check(t):\n    return None\nEND').expect,
    { claim: 'The agent stops', within: 5, check: 'def check(t):\n    return None\n' });
  // The body of check(t) without its def line gets the def line (su15-g56-1, 2026-10-19); other code is still refused.
  assert.deepEqual(parseExpect('EXPECT within 3 actions: x\nreturn None\nEND').expect, { claim: 'x', within: 3, check: 'def check(t):\n    return None\n' });
  const malformed = parseRefinerReply('FILE prompts/strategy.md\n- plan\nEND\nWHY w\nEXPECT within 3 actions: x\nprint(1)\nEND');
  assert.equal(malformed.kind, 'file');
  assert.equal((malformed as any).expect, undefined);
  assert.equal((malformed as any).expectError, 'an EXPECT check must define check(t)');
  const plain = parseRefinerReply('FILE prompts/strategy.md\n- plan\nEND\nWHY w');
  assert.equal((plain as any).expect, undefined);
  assert.equal((plain as any).expectError, undefined);
  assert.deepEqual(parseRefinerReply('NONE nothing new'), { kind: 'none', why: 'nothing new' });
  assert.match(REFINER_LEDGER_SYSTEM, /YOUR EARLIER EDITS/);
  assert.match(REFINER_LEDGER_SYSTEM, /EXPECT within <N> actions:/);
});

test('the ledger lists edits newest first and stays within its characters', () => {
  const text = renderEditLedger([
    { at: 30, told: 32, target: 'prompts/strategy.md v3', why: 'the row is a counter', now: 'still current', since: '14 actions, no level change',
      expect: 'expected within 15: "a click 3 cells from a block" — not seen in 15 actions' },
    { at: 15, told: 17, target: 'memory hyp.reach', why: 'x'.repeat(400), now: 'deleted by the agent at #20', since: '27 actions (1 RESET), no level change',
      use: 'its check since: holds 0 · fails 0 · n/a 27; status open' },
    { at: 5, target: 'tools/find.py v1', why: 'w', now: 'retired' },
  ]);
  assert.equal(text.split('\n')[0], 'YOUR EARLIER EDITS (newest first; what the record shows since the agent was told of each):');
  assert.match(text, /\n- after #30 prompts\/strategy\.md v3 \(still current\): "the row is a counter" · since #32: 14 actions, no level change · expected within 15: "a click 3 cells from a block" — not seen in 15 actions\n/);
  assert.match(text, /\n- after #15 memory hyp\.reach \(deleted by the agent at #20\): "x{139}…" · since #17: 27 actions \(1 RESET\), no level change · its check since: holds 0 · fails 0 · n\/a 27; status open\n/);
  assert.match(text, /\n- after #5 tools\/find\.py v1 \(retired\): "w" · not shown to the agent yet$/);
  const short = renderEditLedger([{ at: 1, told: 2, target: 'a', why: 'w', now: 'still current', since: 'no actions' },
    { at: 0, told: 1, target: 'b'.repeat(300), why: 'w', now: 'still current', since: 'no actions' }], 200);
  assert.match(short, /\n- \(1 older edit\(s\) not shown\)$/);
  assert.equal(renderEditLedger([]), '');
});

test("the ledger keeps a check's contest apart from the agent's rewrites", () => {
  assert.equal(memoryEditNow([{ by: 'check', at: 8 }], true), 'still as written; contested by its check at #8');
  assert.equal(memoryEditNow([{ at: 5 }, { by: 'check', at: 8 }], true), 'rewritten by the agent at #5; contested by its check at #8');
  assert.equal(memoryEditNow([{ by: 'refinement', at: 6, deleted: true }], false), 'deleted by a refinement at #6');
  assert.equal(memoryEditNow([], false), 'no longer in memory');
});

test('a MEMORY line that copies the charter\'s brackets around replaces is accepted', () => {
  // The five invalid replies of the 2026-10-16 replay (qwen3.8-27b, 96 replies) were all of this form.
  const reply = 'Looking at #92 first.\n\nMEMORY game-over-lesson 2 [replaces game-over-lesson, level1-goal]\nGAME OVER at #92 did not involve the cluster.\nEND\nWHY #92 contradicts the stored lesson';
  assert.deepEqual(parseRefinerReply(reply), { kind: 'memory', key: 'game-over-lesson', confidence: 2, text: 'GAME OVER at #92 did not involve the cluster.',
    why: '#92 contradicts the stored lesson', replaces: ['level1-goal'] });
  const plain = parseRefinerReply('MEMORY fact.a 3 replaces fact.b\nA text.\nEND\nWHY w');
  assert.deepEqual((plain as any).replaces, ['fact.b']);
  const none = parseRefinerReply('MEMORY fact.a 3\nA text.\nEND\nWHY w');
  assert.equal((none as any).replaces, undefined);
});

/**
 * The native extension on a bridge whose 9 moves one cell per action (two cells change), with the ledger and
 * refinements on (ARC_REFINE_EVERY=2). The refiner's model calls wait until the test settles them. Actions in
 * `still` leave the grid as it was.
 */
async function fixture(env: Record<string, string>, { still = [] as string[] } = {}) {
  let n = 0;
  const grid = () => { const g = Array.from({ length: 8 }, () => Array(8).fill(0)); g[3][n % 8] = 9; return g; };
  const state = () => ({ frames: [grid()], state: 'NOT_FINISHED', levels_completed: 0, agent_available_actions: ['ACTION1', 'ACTION2'],
    action_budget: { used: n, maximum: 40, total_used: n, total_maximum: null } });
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (chunk) => body += chunk); req.on('end', () => {
      const action = req.url === '/action' ? JSON.parse(body || '{}').action : undefined;
      const moved = req.url !== '/state' && !still.includes(action);
      if (moved) n++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...state(), observation_delta: { frame_available: true, changed_cells: moved ? 2 : 0, cells: [] }, public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'refine-ledger-'));
  const saved = { ...process.env };
  // The 9 changes two cells per move, so the repeat refusal (ARC_THIN_NO_EFFECT_REPEATS) is off: these tests repeat ACTION1.
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled',
    ARC_REFINE_EVERY: '2', ARC_THIN_NO_EFFECT_REPEATS: '0', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const inputs: string[] = [], systems: string[] = [];
  const pending: Array<(value: any) => void> = [];
  const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
    streamSimple: (_model: any, context: any) => {
      inputs.push(context.messages[0].content[0].text);
      systems.push(String(context.systemPrompt ?? ''));
      const settled = new Promise((resolve) => pending.push(resolve));
      return { result: () => settled };
    } } };
  await handlers.get('session_start')({}, ctx);
  const act = (action: string) => tools.get('arc_action').execute('t', repairActionArguments({ action }), undefined, undefined, ctx);
  const begin = async () => {
    const event: any = { prompt: 'Decide.', systemPromptOptions: { sections: {} } };
    await handlers.get('before_agent_start')(event, ctx);
    const head = (await handlers.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx)).messages[0];
    return head.content.map((b: any) => b.text ?? '').join('\n');
  };
  const rows = (name: string) => existsSync(join(root, 'harness', name))
    ? readFileSync(join(root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return {
    inputs, systems, act, begin, rows,
    /** A file of the run, e.g. workspace/data/memory.md. */
    file: (path: string) => readFileSync(join(root, path), 'utf8'),
    /** Any registered tool, called as the agent would. */
    tool: async (name: string, params: any) => (await tools.get(name).execute('t', params, undefined, undefined, ctx)).content.map((b: any) => b.text ?? '').join('\n'),
    memory: async (params: any) => (await tools.get('memory').execute('t', params, undefined, undefined, ctx)).content.map((b: any) => b.text ?? '').join('\n'),
    async decide(action = 'ACTION1') { const head = await begin(); await act(action); return head; },
    /** Settle the oldest refinement call still waiting; the next call (if any) starts after its ledger checks. */
    async settle(value: any) { pending.shift()!(value); await new Promise((r) => setTimeout(r, 150)); },
    /** Wait until `count` refinement calls have reached the model (the ledger's sandbox checks come first). */
    async calls(count: number) { for (let i = 0; i < 200 && inputs.length < count; i += 1) await new Promise((r) => setTimeout(r, 50)); },
    async close() {
      for (const resolve of pending.splice(0)) resolve(reply('NONE closing'));
      await new Promise((r) => setTimeout(r, 300));
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

test('a later refinement is told what became of its edits: an expectation met on the moves after the agent was told, a memory entry the agent deleted', async () => {
  const h = await fixture({});
  try {
    await h.decide();
    await h.decide();
    await h.decide();
    await h.calls(1);
    assert.equal(h.inputs.length, 1);
    assert.doesNotMatch(h.inputs[0], /YOUR EARLIER EDITS/, 'no edits yet');
    assert.match(h.systems[0], /YOUR EARLIER EDITS, when present, lists your latest edits/);
    await h.settle(reply(`FILE prompts/strategy.md\nNext experiment\n- ACTION2 once\nEND\nWHY #1-#2 never tried ACTION2\n${EXPECT_ACTION2}`));
    // The decision that shows the edit starts at #3; its move #4 is the expected one.
    const fourth = await h.decide('ACTION2');
    assert.match(fourth, /HARNESS UPDATE by a refinement after #3 \(2 actions since the last refinement\): prompts\/strategy\.md v1 — #1-#2 never tried ACTION2\./);
    await h.begin();
    await h.calls(2);
    assert.equal(h.inputs.length, 2);
    assert.match(h.inputs[1], /\nACTIONS SO FAR: 4;[^\n]*\n\nYOUR EARLIER EDITS \(newest first; what the record shows since the agent was told of each\):\n- after #3 prompts\/strategy\.md v1 \(still current\): "#1-#2 never tried ACTION2" · since #3: 1 action, no level change · expected within 4: "the agent plays ACTION2" — met at #4\n\nCURRENT prompts\/strategy\.md/);
    await h.settle(reply('MEMORY fact.edge 2\nThe 9 wraps at the right edge\nEND\nWHY #1-#4 moved it right each time\nEXPECT within 2 actions: the 9 is back at x=0\ndef check(t):\n    return None\nEND'));
    await h.act('ACTION1');
    // The agent deletes the entry the refinement wrote, in the decision that shows it.
    const sixth = await h.begin();
    assert.match(sixth, /HARNESS UPDATE by a refinement after #4 \(2 actions since the last refinement\): memory fact\.edge \(conf 2\)/);
    assert.match(await h.memory({ delete: ['fact.edge'] }), /fact\.edge/);
    await h.act('ACTION1');
    await h.begin();
    await h.calls(3);
    assert.equal(h.inputs.length, 3);
    assert.match(h.inputs[2], /\n- after #4 memory fact\.edge \(deleted by the agent at #5\): "#1-#4 moved it right each time" · since #5: 1 action, no level change · expected within 2: "the 9 is back at x=0" — not seen yet \(1 of 2 actions\)\n- after #3 prompts\/strategy\.md v1 \(still current\): "#1-#2 never tried ACTION2" · since #3: 3 actions, no level change · expected within 4: "the agent plays ACTION2" — met at #4\n/);
    const refiner = h.rows('refiner.jsonl');
    const edits = refiner.filter((row) => row.kind === 'edit');
    assert.deepEqual(edits.map((row) => row.id), ['e1', 'e2']);
    assert.deepEqual(edits[0].expect, { claim: 'the agent plays ACTION2', within: 4, check: "def check(t):\n    return True if t['action'] == 'ACTION2' else None\n" });
    assert.deepEqual(refiner.filter((row) => row.kind === 'told').map((row) => [row.id, row.at]), [['e1', 3], ['e2', 5]]);
    assert.ok(refiner.filter((row) => row.kind === 'start').every((row) => row.model === 'agent-model'));
    // Each input and reply is kept as it was, with the model that answered.
    const inputs = h.rows('refiner_inputs.jsonl');
    assert.equal(inputs.length, 3);
    assert.deepEqual([inputs[0].model, inputs[0].at, inputs[0].input], ['agent-model', 2, h.inputs[0]]);
    const replies = h.rows('refiner_replies.jsonl');
    assert.equal(replies.length, 2);
    assert.match(replies[0].text, /^FILE prompts\/strategy\.md\n[^]*EXPECT within 4 actions: the agent plays ACTION2/);
    assert.deepEqual([replies[0].model, replies[0].stop_reason, replies[0].at], ['agent-model', 'stop', 2]);
  } finally { await h.close(); }
});

test('a MEMORY line the memory component refuses is recorded as invalid: no edit, no notice, nothing in the ledger', async () => {
  // su15-r04-e1 #9: "MEMORY hyp.border_cost 4" (a hyp. key belongs to a hypothesis) was refused by the memory component
  // but recorded as edit e3, announced to the agent, and listed as "no longer in memory".
  const h = await fixture({});
  try {
    await h.decide();
    await h.decide();
    await h.decide();
    await h.calls(1);
    await h.settle(reply(`MEMORY hyp.border 4\nEach move changes two cells\nEND\nWHY #1-#3 changed two each\n${EXPECT_ACTION2}`));
    const fourth = await h.decide('ACTION2');
    assert.doesNotMatch(fourth, /HARNESS UPDATE/);
    await h.begin();
    await h.calls(2);
    assert.doesNotMatch(h.inputs[1], /YOUR EARLIER EDITS/);
    const refiner = h.rows('refiner.jsonl');
    assert.deepEqual(refiner.filter((row) => row.kind === 'edit' || row.kind === 'told'), []);
    const invalid = refiner.filter((row) => row.kind === 'invalid');
    assert.equal(invalid.length, 1);
    assert.match(invalid[0].why, /not applied: set\[0\]: [^]*keys starting with hyp\. or strat\. are hypotheses or strategies/);
    assert.deepEqual(h.rows('memory.jsonl').filter((row) => row.key === 'hyp.border'), []);
  } finally { await h.close(); }
});

test('a hypothesis a refinement wrote is followed by its own check results since the agent was told', async () => {
  const h = await fixture({});
  try {
    await h.decide();
    await h.decide();
    await h.decide();
    await h.calls(1);
    await h.settle(reply("HYPOTHESIS hyp.right\nclaim: ACTION1 moves the 9 one cell right\nquestion: what ACTION1 does\ncheck:\ndef check(t):\n    return True if t['action'] == 'ACTION1' else None\nEND\nWHY #1-#3 all moved it"));
    await h.decide('ACTION1');
    await h.begin();
    await h.calls(2);
    assert.match(h.inputs[1], /\n- after #3 memory hyp\.right \(still as written\): "#1-#3 all moved it" · since #3: 1 action, no level change · its check since: holds 1 · fails 0 · n\/a 0; status \w+\n/);
  } finally { await h.close(); }
});

test('checks see changed_cells, and t.get of a key a move does not carry raises, for hypotheses and expectations alike', async () => {
  // 6 of the 14 hypotheses refinements wrote in su15 r2-r9 read changed_cells with t.get and a default, and were judged
  // on the default; in su15-f2-src2 an expectation read t.get('predict') and was reported contradicted on a move that met it.
  const h = await fixture({});
  try {
    await h.decide();
    await h.decide();
    await h.decide();
    await h.calls(1);
    await h.settle(reply("HYPOTHESIS hyp.cells\nclaim: ACTION1 changes two cells\nquestion: what ACTION1 does\ncheck:\n" +
      "def check(t):\n    return t.get('changed_cells', 0) == 2 if t['action'] == 'ACTION1' else None\nEND\n" +
      "WHY #1-#3 all moved it\nEXPECT within 2 actions: the agent's moves change cells\ndef check(t):\n    return t.get('changed', 0) > 0\nEND"));
    await h.decide('ACTION1');
    await h.begin();
    await h.calls(2);
    const entry = h.inputs[1].split('\n').find((line) => line.startsWith('- after #3 memory hyp.cells')) ?? '';
    assert.match(entry, / · its check since: holds 1 · fails 0 · n\/a 0; status \w+ · /, "the hypothesis check reads the move's changed_cells");
    assert.match(entry, /expected within 2: "the agent's moves change cells" — its check raised on 1 of 1 move\(s\), first at #4 \(KeyError: "a move has no 'changed'; it has action, after, bbox, before, changed_cells, level_changed, levels_completed, n, state, x, y"/);
    // The agent's own hypothesis that reads a key a move does not carry gets an error on every move, not a default.
    await h.memory({ hypotheses: [{ key: 'hyp.noted', claim: 'moves carry a prediction', check: "def check(t):\n    return t.get('predict') is not None\n" }] });
    await h.begin();
    const noted = h.rows('claim_checks.jsonl').filter((row) => row.key === 'hyp.noted' && !row.control);
    assert.ok(noted.length >= 4 && noted.every((row) => row.result === 'error' && /a move has no 'predict'/.test(row.error)), JSON.stringify(noted.slice(0, 2)));
    const cells = h.rows('claim_checks.jsonl').filter((row) => row.key === 'hyp.cells' && !row.control);
    assert.deepEqual(cells.filter((row) => row.result !== null).map((row) => row.result), cells.filter((row) => row.result !== null).map(() => true),
      'every ACTION1 move changed two cells');
  } finally { await h.close(); }
});

test("a check's move carries bbox, the box of the cells it changed as trajectory rows report it, and None when nothing changed", async () => {
  // Receipts and data/trajectory.jsonl report a box ({top, left, bottom, right}); a check's move did not carry one.
  const h = await fixture({}, { still: ['ACTION2'] });
  try {
    await h.decide('ACTION1');
    await h.decide('ACTION1');
    await h.decide('ACTION2');
    await h.begin();
    const receipt = await h.memory({ hypotheses: [{ key: 'hyp.box', claim: 'ACTION1 moves the 9 one cell right; ACTION2 changes nothing',
      check: "def check(t):\n    if 'bbox' not in t:\n        return False\n    if t['action'] == 'ACTION1':\n" +
        "        return t['bbox'] == {'top': 3, 'left': t['n'] - 1, 'bottom': 3, 'right': t['n']}\n    return t.get('bbox') is None\n" }] });
    assert.match(receipt, /hyp\.box check on 3 recorded move\(s\): holds 3 · fails 0/, receipt);
    const rows = h.rows('claim_checks.jsonl').filter((row) => row.key === 'hyp.box' && !row.control);
    assert.deepEqual(rows.map((row) => [row.n, row.result]), [[1, true], [2, true], [3, true]]);
  } finally { await h.close(); }
});

test("data/memory.md shows each check's source; the decision's own view does not", async () => {
  const h = await fixture({});
  try {
    await h.decide('ACTION1');
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.two', claim: 'ACTION1 changes two cells',
      check: "def check(t):\n    return t['changed_cells'] == 2 if t['action'] == 'ACTION1' else None\n" }] });
    const head = await h.begin();
    assert.match(h.file('workspace/data/memory.md'), /- hyp\.two \[open\] ACTION1 changes two cells\n  check on 1 recorded move\(s\): holds 1 · fails 0\n  check source:\n    def check\(t\):\n        return t\['changed_cells'\] == 2 if t\['action'\] == 'ACTION1' else None\n/);
    assert.match(head, /hyp\.two/);
    assert.doesNotMatch(head, /def check/);
  } finally { await h.close(); }
});

const TWO = "def check(t):\n    return t['changed_cells'] == 2\n";
const THREE = "def check(t):\n    return t['changed_cells'] == 3\n";

test("a check failing on at least half of 5 decided moves contests its hypothesis once, shown first; the agent's later status stands", async () => {
  // su15-l1-3: hyp.action6_moves_bottom stayed open with its check at "holds 60 · fails 158" in the last of its 314 requests.
  const h = await fixture({});
  try {
    for (let i = 0; i < 5; i++) await h.decide('ACTION1');
    await h.begin();
    const receipt = await h.memory({ hypotheses: [{ key: 'hyp.fine', claim: 'ACTION1 changes two cells', check: TWO },
      { key: 'hyp.three', claim: 'ACTION1 changes three cells', check: THREE }] });
    assert.match(receipt, /hyp\.three contested: its check fails on 5 of 5 decided moves \(#1, #2, …, #5\)/);
    assert.doesNotMatch(receipt, /hyp\.fine contested/);
    const byCheck = () => h.rows('memory.jsonl').filter((row) => row.key === 'hyp.three' && row.by === 'check');
    assert.deepEqual(byCheck().map((row) => [row.hyp.status, row.hyp.contested_at]), [['contested', 5]]);
    const head = await h.begin();
    const view = head.slice(head.indexOf('CURRENT KNOWLEDGE'));
    assert.ok(view.includes('- hyp.three [contested]') && view.indexOf('- hyp.three') < view.indexOf('- hyp.fine'), view);
    assert.match(view, /\n  ! its check fails on 5 of 5 decided moves \(#1, #2, …, #5\): narrow the claim and its check to where it held, fix the check, or reject it; then restate its status/);
    // The agent restates it open: the same check and claim do not contest it again.
    await h.memory({ hypotheses: [{ key: 'hyp.three', status: 'open' }] });
    await h.act('ACTION1');
    await h.begin();
    assert.equal(byCheck().length, 1);
    // A rewritten check that still fails contests it again.
    const again = await h.memory({ hypotheses: [{ key: 'hyp.three', check: "def check(t):\n    return t['changed_cells'] == 4\n" }] });
    assert.match(again, /hyp\.three contested: its check fails on 6 of 6 decided moves/);
    assert.equal(byCheck().length, 2);
  } finally { await h.close(); }
});

test('ARC_CHECK_CONTEST_MIN=0 leaves check results out of a hypothesis status', async () => {
  const h = await fixture({ ARC_CHECK_CONTEST_MIN: '0' });
  try {
    for (let i = 0; i < 5; i++) await h.decide('ACTION1');
    await h.begin();
    assert.doesNotMatch(await h.memory({ hypotheses: [{ key: 'hyp.three', claim: 'ACTION1 changes three cells', check: THREE }] }), /contested/);
    await h.begin();
    assert.deepEqual(h.rows('memory.jsonl').filter((row) => row.by === 'check'), []);
  } finally { await h.close(); }
});

/** Five ACTION1 moves (two cells each), then hyp.three, whose check fails on all of them. */
async function contested(env: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const h = await fixture(env);
  for (let i = 0; i < 5; i++) await h.decide('ACTION1');
  await h.begin();
  const receipt = await h.memory({ hypotheses: [{ key: 'hyp.three', claim: 'ACTION1 changes three cells', check: THREE, ...extra }] });
  return { h, receipt };
}

test('a hypothesis already contested by a refutation is not contested again by its check after the agent restates it', async () => {
  const { h } = await contested({}, { evidence: { action: 5, condition: 'after ACTION1', observed: 'two cells changed', verdict: 'refutes' } });
  try {
    assert.doesNotMatch(await h.memory({ hypotheses: [{ key: 'hyp.three', status: 'open' }] }), /contested/);
  } finally { await h.close(); }
});

test("a contest whose check was fixed says so, and what is left to do", async () => {
  const { h } = await contested();
  try {
    await h.memory({ hypotheses: [{ key: 'hyp.three', check: TWO }] });
    assert.match(await h.begin(), /\n  ! contested at #5; its current check does not contest it: narrow the claim, reject it, or restate its status/);
  } finally { await h.close(); }
});

test('a refinement answer that is refused leaves the contest to be raised again', async () => {
  const { h } = await contested({ ARC_REFINE_EVERY: '100' });
  try {
    await h.act('ACTION1');
    await h.begin();
    await h.calls(1);
    // The same key: refused ("exists"), so the event is not answered.
    await h.settle(reply('HYPOTHESIS hyp.three\nclaim: ACTION1 changes two cells\ncheck:\ndef check(t):\n    return None\nEND\nWHY narrower'));
    await h.act('ACTION1');
    await h.begin();
    await h.calls(2);
    assert.match(h.inputs[1] ?? '', /hyp\.three is contested: [^\n]*under a new key/);
  } finally { await h.close(); }
});

test('a refinement rewrites a hypothesis a refinement wrote once its check contests it, seeing that check', async () => {
  // All 25 checks recorded in su15 since 2026-10-15 were refinement-written, and 12 would have been contested; a
  // refinement could only add hypotheses, so a contested one of its own could never be narrowed.
  const h = await fixture({ ARC_REFINE_EVERY: '100' });
  try {
    await h.decide('ACTION1');
    await h.begin();
    await h.tool('refine', { focus: 'write the hypothesis the moves suggest' });
    await h.calls(1);
    await h.settle(reply(`HYPOTHESIS hyp.three\nclaim: ACTION1 changes three cells\nquestion: what ACTION1 changes\ncheck:\n${THREE}END\nWHY #1 changed cells`));
    for (let i = 0; i < 5; i++) await h.decide('ACTION1');
    await h.begin();
    await h.calls(2);
    assert.match(h.inputs[1] ?? '', /hyp\.three is contested: [^\n]*rewrite it with HYPOTHESIS hyp\.three/);
    assert.match(h.inputs[1] ?? '', /\nCHECKS NAMED ABOVE:\n--- hyp\.three\ndef check\(t\):\n    return t\['changed_cells'\] == 3\n/);
    await h.settle(reply(`HYPOTHESIS hyp.three\nclaim: ACTION1 changes two cells\nquestion: what ACTION1 changes\ncheck:\n${TWO}END\nWHY every move changed two cells`));
    await h.act('ACTION1');
    await h.begin();
    const rewritten = h.rows('memory.jsonl').filter((row) => row.key === 'hyp.three' && row.by === 'refinement').at(-1);
    assert.deepEqual([rewritten?.hyp.claim, rewritten?.hyp.status, rewritten?.hyp.check], ['ACTION1 changes two cells', 'open', TWO]);
    assert.ok(h.rows('refiner.jsonl').some((row) => row.kind === 'edit' && row.path === 'memory:hyp.three' && row.rewrote), 'recorded as a rewrite');
  } finally { await h.close(); }
});

test('a check-contested hypothesis starts one refinement, and a HYPOTHESIS edit answers it', async () => {
  // Only events start refinements here (ARC_REFINE_EVERY=100).
  const h = await fixture({ ARC_REFINE_EVERY: '100' });
  try {
    for (let i = 0; i < 5; i++) await h.decide('ACTION1');
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.three', claim: 'ACTION1 changes three cells', check: THREE }] });
    await h.act('ACTION1');
    await h.begin();
    await h.calls(1);
    assert.match(h.inputs[0] ?? '', /^WHY NOW: [^\n]*hyp\.three is contested: its check fails on 6 of 6 decided moves/);
    await h.settle(reply("HYPOTHESIS hyp.where\nclaim: ACTION1 changes three cells only somewhere else\nquestion: what ACTION1 changes\n" +
      "check:\ndef check(t):\n    return None\nEND\nWHY #1-#6 changed two cells each"));
    await h.act('ACTION1');
    await h.begin();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(h.inputs.length, 1, 'answered once, not raised again');
  } finally { await h.close(); }
});

test('a rule citing a hypothesis that does not exist is named under RULE CHECKS and raised to a refinement', async () => {
  // su15-r04-e1's refinements wrote rules citing hyp.action6_mechanic, hyp.border_cost and hyp.action7_noop, none of
  // which existed; RULE CHECKS said "no check behind" them, as for a hypothesis without a check.
  const h = await fixture({});
  try {
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.right', claim: 'ACTION1 moves the 9 one cell right', check: TWO }] });
    await h.act('ACTION1');
    await h.decide();
    await h.decide();
    await h.calls(1);
    await h.settle(reply('FILE prompts/rules.md\n- ACTION1 moves the 9 one cell right (hyp.right)\n- ACTION2 changes nothing (hyp.still)\nEND\nWHY #1-#3 moved it right'));
    await h.act('ACTION1');
    const head = await h.begin();
    assert.match(head, /RULE CHECKS \(prompts\/rules\.md\) on #\d+: [^\n]*; cites hyp\.still, which does not exist/);
    assert.doesNotMatch(head, /cites hyp\.right/);
    await h.calls(2);
    assert.match(h.inputs[1] ?? '', /^WHY NOW: [^\n]*prompts\/rules\.md cites hyp\.still, which does not exist/);
  } finally { await h.close(); }
});

test('rival hypotheses with checks are compared on the recorded moves in the decision view', async () => {
  const h = await fixture({});
  try {
    await h.decide('ACTION1');
    await h.decide('ACTION1');
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.two', question: 'what ACTION1 changes', claim: 'two cells', check: TWO },
      { key: 'hyp.one', question: 'what ACTION1 changes', claim: 'one cell', check: "def check(t):\n    return t['changed_cells'] == 1\n" }] });
    await h.act('ACTION1');
    const head = await h.begin();
    assert.match(head, /\nquestion "what action1 changes": #3 separates hyp\.two \(holds\) from hyp\.one \(fails\)/);
  } finally { await h.close(); }
});

test('ARC_REFINE_LEDGER=0 gives the earlier input and charter; the edits are still logged with ids', async () => {
  const h = await fixture({ ARC_REFINE_LEDGER: '0' });
  try {
    await h.decide();
    await h.decide();
    await h.decide();
    await h.calls(1);
    await h.settle(reply(`FILE prompts/strategy.md\nNext experiment\n- ACTION2 once\nEND\nWHY first\n${EXPECT_ACTION2}`));
    await h.decide('ACTION2');
    await h.begin();
    await h.calls(2);
    assert.equal(h.inputs.length, 2);
    assert.doesNotMatch(h.inputs[1], /YOUR EARLIER EDITS/);
    assert.doesNotMatch(h.systems[1], /YOUR EARLIER EDITS|EXPECT/);
    assert.deepEqual(h.rows('refiner.jsonl').filter((row) => row.kind === 'edit').map((row) => row.id), ['e1']);
  } finally { await h.close(); }
});
