import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';

// docs/plans/2026-10-19-coverage-attempts-delivery.md: P1 (kinds of moves on events), P2 (attempts), P3 (the next
// experiment pinned in the strategy), P4 (ARC_THIN_LEAN).

const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 100, output: 50 } });
/** hyp.diag: a click on the block moves it away (None for clicks elsewhere). */
const ON_BLOCK = "def check(t):\n    if t['action'] != 'ACTION6' or t['before'][t['y']][t['x']] != 9:\n        return None\n    return t['after'][t['y']][t['x']] == 0\n";
/** hyp.jump: a click off the block puts the block on the clicked cell (None for clicks on it). */
const OFF_BLOCK = "def check(t):\n    if t['action'] != 'ACTION6' or t['before'][t['y']][t['x']] == 9:\n        return None\n    return t['after'][t['y']][t['x']] == 9\n";

/**
 * The native extension on a 16x16 board: a one-cell block at (1,1) that a click on it moves one cell down-right, a click
 * elsewhere toggles that cell, a click at (15,0) ends the attempt in GAME_OVER, and a bar in row 15 loses a cell on every
 * move. RESET restores the start. Refinements wait until the test settles them.
 */
async function fixture(env: Record<string, string> = {}) {
  let n = 0, used = 0, state = 'NOT_FINISHED';
  const block = { x: 1, y: 1 };
  const start = () => { const g = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, () => (y === 15 ? 3 : 0))); g[1][1] = 9; return g; };
  let grid = start();
  const apply = (action: string, x?: number, y?: number) => {
    const before = grid.map((row) => [...row]);
    if (action === 'RESET') { grid = start(); block.x = 1; block.y = 1; state = 'NOT_FINISHED'; used = 0; }
    else {
      if (action === 'ACTION6' && x === 15 && y === 0) state = 'GAME_OVER';
      else if (action === 'ACTION6' && x === block.x && y === block.y) {
        grid[block.y][block.x] = 0; block.x = (block.x + 1) % 14; block.y = (block.y + 1) % 14; grid[block.y][block.x] = 9;
      } else if (action === 'ACTION6') grid[y!][x!] = grid[y!][x!] ? 0 : 9;
      grid[15][15 - (used % 16)] = Math.floor(used / 16) % 2 ? 3 : 0;
      used += 1;
    }
    n += 1;
    return before.flatMap((row, i) => row.filter((cell, j) => cell !== grid[i][j])).length;
  };
  const body = (changed: number) => ({ frames: [grid], state, levels_completed: 0, agent_available_actions: ['RESET', 'ACTION6', 'ACTION7'],
    action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
    observation_delta: { frame_available: true, changed_cells: changed, cells: [] }, public_transition: { level_changed: false } });
  const server = createServer((req, res) => {
    let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
      const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
      const changed = call ? apply(call.action, call.x, call.y) : 0;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body(changed)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'coverage-events-'));
  const saved = { ...process.env };
  // Only the events under test start refinements: no schedule, goal-test or unchecked-belief events.
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled',
    ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000', ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ...env });
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
  let system = '';
  const act = (call: { action: string; x?: number; y?: number }) => tools.get('arc_action').execute('t', repairActionArguments(call), undefined, undefined, ctx);
  const begin = async () => {
    const event: any = { prompt: 'Decide.', systemPromptOptions: { sections: {} } };
    await handlers.get('before_agent_start')(event, ctx);
    system = String(event.systemPromptOptions.customPrompt ?? '');
    const head = (await handlers.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx)).messages[0];
    return head.content.map((b: any) => b.text ?? '').join('\n');
  };
  const rows = (name: string) => existsSync(join(root, 'harness', name))
    ? readFileSync(join(root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return {
    inputs, rows, act, begin, block: () => ({ ...block }), active: () => active, system: () => system,
    file: (path: string) => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '',
    memory: async (params: any) => (await tools.get('memory').execute('t', params, undefined, undefined, ctx)).content.map((b: any) => b.text ?? '').join('\n'),
    async decide(call: { action: string; x?: number; y?: number }) { const head = await begin(); await act(call); return head; },
    async settle(value: any) { pending.shift()!(value); await new Promise((r) => setTimeout(r, 200)); },
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

test('a rival must disagree on a kind of move the level has not seen; an answer on a seen kind goes back once, and the move it names is pinned first in the next experiment until it is played', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 9; i++) await h.decide({ action: 'ACTION6', ...h.block() });
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.diag', question: 'what a click on the block does', claim: 'a click on the block moves it one cell down-right', check: ON_BLOCK }] });
    await h.act({ action: 'ACTION6', ...h.block() });
    await h.begin();
    await h.calls(1);
    assert.match(h.inputs[0], /^WHY NOW: hyp\.diag holds on 10 of 10 decided moves, all moves the agent chose, and no other hypothesis with a check answers "what a click on the block does"\. Moves on level 1 \(10 moves\): 10 clicks by distance from the last changed area \(now x10-11 y10-11\): inside 9, touching 0, 2-6 cells 0, more than 6 cells 0, first of an attempt 1; ACTION7 never played: write the strongest rival HYPOTHESIS/);
    assert.match(h.inputs[0], /on a kind of move this level has not seen \(a click touching the last changed area; a click 2-6 cells from the last changed area; a click more than 6 cells from the last changed area; ACTION7\); name that move in predicts as ACTION6\(x,y\) or ACTIONn/);
    const on = h.block();
    await h.settle(reply(`HYPOTHESIS hyp.jump\nclaim: a click puts the block on the clicked cell\nquestion: anything\npredicts: ACTION6(${on.x},${on.y}) moves it\ncheck:\n${OFF_BLOCK}END\nWHY rival`));
    await h.calls(2);
    assert.match(h.inputs[1], new RegExp(`\\nNOT APPLIED: ACTION6\\(${on.x},${on.y}\\) is a click inside the last changed area, a kind of move this level has seen 9 times; the rival must disagree with it on a kind the level has not seen: a click touching`));
    const near = { x: on.x + 3, y: on.y + 3 };
    await h.settle(reply(`HYPOTHESIS hyp.jump\nclaim: a click puts the block on the clicked cell\nquestion: anything\npredicts: ACTION6(${near.x},${near.y}) puts the block there; hyp.diag says nothing moves\ncheck:\n${OFF_BLOCK}END\nWHY rival`));
    const jump = h.rows('memory.jsonl').filter((row) => row.key === 'hyp.jump').at(-1);
    assert.equal(jump?.hyp.question, 'what a click on the block does', 'the rival shares its target question');
    assert.match(h.file('workspace/prompts/strategy.md'), new RegExp(`## Next experiment\\n- First: ACTION6\\(${near.x},${near.y}\\), a click 2-6 cells from the last changed area; hyp\\.jump against hyp\\.diag: ACTION6\\(${near.x},${near.y}\\) puts the block there`));
    await h.act({ action: 'ACTION7' });
    const told = await h.begin();
    assert.match(told, new RegExp(`hypothesis hyp\\.jump with a check, run on every recorded move; its test move ACTION6\\(${near.x},${near.y}\\) is the first item of prompts/strategy\\.md's next experiment`));
    assert.match(told, /\nquestion "what a click on the block does": no recorded move separates hyp\.diag from hyp\.jump \(no move decided by both\)/);
    await h.act({ action: 'ACTION6', ...near });
    const after = await h.begin();
    assert.doesNotMatch(after, /question "what a click on the block does"/, 'the unchanged comparison is not shown again');
    assert.doesNotMatch(h.file('workspace/prompts/strategy.md'), /- First:/);
    assert.deepEqual(h.rows('refiner.jsonl').filter((row) => row.kind === 'next_done').map((row) => [row.outcome, row.n]), [['met', 12]]);
    assert.deepEqual(h.rows('refiner.jsonl').filter((row) => row.kind === 'returned').length, 1);
  } finally { await h.close(); }
});

test('two attempts failed under one model raise the repeated-failure event, and RESOURCES compares the attempts', async () => {
  // Rival events off: the block clicks would raise one for hyp.diag, and it would hold the refinement this test waits for.
  const h = await fixture({ ARC_REFINE_RIVALS: '0' });
  try {
    await h.begin();
    await h.memory({ hypotheses: [{ key: 'hyp.diag', question: 'what a click on the block does', claim: 'a click on the block moves it one cell down-right', check: ON_BLOCK }] });
    for (let i = 0; i < 3; i++) { await h.act({ action: 'ACTION6', ...h.block() }); await h.begin(); }
    await h.act({ action: 'ACTION6', x: 15, y: 0 });
    await h.begin();
    await h.calls(1);
    await h.settle(reply('NONE first GAME_OVER'));
    await h.act({ action: 'RESET' });
    for (let i = 0; i < 3; i++) { await h.begin(); await h.act({ action: 'ACTION6', ...h.block() }); }
    await h.begin();
    await h.act({ action: 'ACTION6', x: 15, y: 0 });
    const head = await h.begin();
    assert.match(head, /RESOURCES: this attempt: 0 actions; earlier attempts on this level ended after 4, 4 actions \(GAME_OVER\)[;.]/);
    await h.calls(2);
    assert.match(h.inputs[1], /^WHY NOW: GAME_OVER at #9; attempts on level 1 since the agent last changed a hypothesis about what its actions do: 4, 4 actions, each ended by GAME_OVER \(\d+ actions left in the level's budget\); the model in play is hyp\.diag \(holds on 6 of 6 decided moves in them\)\. Moves on level 1 \(8 moves\)/);
    assert.match(h.inputs[1], /as a rival HYPOTHESIS under the question "what a click on the block does" whose check disagrees with hyp\.diag on some move, and name the cheapest move that tests it in predicts as ACTION6\(x,y\) or ACTIONn/);
  } finally { await h.close(); }
});

test('ARC_THIN_LEAN=1 leaves out refine, consult and the subagent line; by default they are there, as before', async () => {
  const lean = await fixture({ ARC_THIN_LEAN: '1' });
  try {
    await lean.begin();
    assert.ok(!lean.active().includes('refine') && !lean.active().includes('consult'), lean.active().join(','));
    assert.match(lean.system(), /Your harness has four kinds of capability:/);
    assert.match(lean.system(), /- Skill: skills\/<name>\/SKILL\.md, a procedure read on demand\.\r?\nRefinements run in the background \(level changes, missing goal tests, stalls, repeated work\); /);
    assert.doesNotMatch(lean.system(), /Subagent|consult|refine\(focus\)/);
  } finally { await lean.close(); }
  const full = await fixture();
  try {
    await full.begin();
    assert.ok(full.active().includes('refine') && full.active().includes('consult'), full.active().join(','));
    assert.match(full.system(), /Your harness has five kinds of capability:/);
    assert.match(full.system(), /Python \(not subagents or views\) can call env\.act/);
    assert.match(full.system(), /- Skill: skills\/<name>\/SKILL\.md \(name, description\), a procedure read on demand\.\r?\n- Subagent: agents\/<name>\.md \(description, tools: \[read, python, <tool names>\]\) answers consult\(agent, question, refs\) in its own context; it never acts\.\r?\nRefinements run in the background \(level changes, missing goal tests, stalls, repeated work, refine\(focus\)\); /);
  } finally { await full.close(); }
});
