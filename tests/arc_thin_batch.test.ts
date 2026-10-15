import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairBatchArguments } from '../demo/arc_thin_boundary.ts';

test('a batch arrives in the earlier shapes too and is turned into one actions list', () => {
  assert.deepEqual(repairBatchArguments({ action: 'ACTION1', x: '3', y: 4, predict: { level_changed: false }, then: ['action2', { action: 'ACTION6', x: 5, y: 6 }], note: 'n' }),
    { note: 'n', actions: [{ action: 'ACTION1', x: 3, y: 4, predict: { level_changed: false } }, { action: 'ACTION2' }, { action: 'ACTION6', x: 5, y: 6 }] });
  // Continual Harness's take_actions names the action `name`; a list may come as a JSON string or as bare names.
  assert.deepEqual(repairBatchArguments({ actions: [{ name: 'ACTION6', x: 1, y: 2 }, 'action7'] }).actions,
    [{ action: 'ACTION6', x: 1, y: 2 }, { action: 'ACTION7' }]);
  assert.deepEqual(repairBatchArguments({ actions: '[{"action":"ACTION1"},{"action":"ACTION2"}]' }).actions, [{ action: 'ACTION1' }, { action: 'ACTION2' }]);
  assert.deepEqual(repairBatchArguments({ actions: 'ACTION1, ACTION2' }).actions, [{ action: 'ACTION1' }, { action: 'ACTION2' }]);
  // A prediction for the whole call goes to the first action; a malformed one is dropped, never the action.
  assert.deepEqual(repairBatchArguments({ predict: { state: 'WIN' }, actions: [{ action: 'ACTION1' }, { action: 'ACTION2', predict: 7 }] }).actions,
    [{ action: 'ACTION1', predict: { state: 'WIN' } }, { action: 'ACTION2' }]);
  // Already a batch: unchanged. Nothing usable: left for the schema to refuse.
  const batch = { actions: [{ action: 'ACTION1' }], note: 'x' };
  assert.deepEqual(repairBatchArguments(batch), batch);
  assert.deepEqual(repairBatchArguments({ note: 'nothing' }), { note: 'nothing' });
});

/** The native extension on a bridge whose 9 moves one cell per action, without ledger or refinements. */
async function fixture(env: Record<string, string> = {}) {
  let n = 0;
  const grid = () => { const g = Array.from({ length: 8 }, () => Array(8).fill(0)); g[3][n % 8] = 9; return g; };
  const state = () => ({ frames: [grid()], state: 'NOT_FINISHED', levels_completed: 0, agent_available_actions: ['ACTION1', 'ACTION2', 'ACTION6'],
    action_budget: { used: n, maximum: 40, total_used: n, total_maximum: null } });
  const server = createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      if (req.url !== '/state') n++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...state(), observation_delta: { frame_available: true, changed_cells: 2, cells: [] }, public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'arc-batch-'));
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'disabled', ARC_HARNESS_CRITIC: 'disabled', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const ctx: any = { model: { input: ['text'] } };
  await handlers.get('session_start')({}, ctx);
  return {
    tool: () => tools.get('arc_action'),
    /** A new decision, then one arc_action call with these arguments; its text. */
    async play(args: any) {
      await handlers.get('before_agent_start')({ prompt: 'Decide.', systemPromptOptions: { sections: {} } }, ctx);
      await handlers.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx);
      const result = await tools.get('arc_action').execute('t', args, undefined, undefined, ctx);
      return String(result.content[0].text);
    },
    trajectory: () => readFileSync(join(root, 'harness/trajectory.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    async close() {
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

test('arc_action plays a batch in one call; a missed prediction does not stop it, a refusal does', async () => {
  const h = await fixture();
  try {
    const schema = h.tool().parameters.properties;
    assert.equal(schema.actions.maxItems, 24);
    assert.deepEqual(schema.actions.items.properties.action.enum, []);
    await h.play({ actions: [{ action: 'ACTION1' }] });
    const text = await h.play({ actions: [{ action: 'ACTION1', predict: { cells: [[0, 0, 7]] } }, { action: 'ACTION2' }, { action: 'ACTION6', x: 3, y: 4 }], note: 'three moves' });
    assert.match(text, /^PLAYED #2–#4: ACTION1 ×1, ACTION2 ×1, ACTION6 ×1\n#2 ACTION1 → [^\n]*MISS[^\n]*\n#3 ACTION2 → [^\n]*\n#4 ACTION6\(3,4\) → /);
    const rows = h.trajectory();
    assert.deepEqual(rows.slice(1).map((r: any) => [r.n, r.decision, r.note]), [[2, 2, 'three moves'], [3, 2, 'batch 2 of 3'], [4, 2, 'batch 3 of 3']]);
    const refused = await h.play({ actions: [{ action: 'ACTION1' }, { action: 'ACTION5' }, { action: 'ACTION2' }] });
    assert.match(refused, /\nbatch: 1 of 3 played; stopped: action 'ACTION5' is not currently available\. Available now: ACTION1, ACTION2, ACTION6; last action played: #5 ACTION1\.$/);
    // The earlier action + then shape still plays as a batch.
    const legacy = await h.play({ action: 'ACTION2', then: ['ACTION1'] });
    assert.match(legacy, /^#6 ACTION2 → [^\n]*\n#7 ACTION1 → /);
  } finally { await h.close(); }
});

test('a batch is capped at its share of the budget left, and ARC_THIN_BATCH_STOP=miss restores the stop at a miss', async () => {
  const capped = await fixture();
  try {
    const text = await capped.play({ actions: Array.from({ length: 12 }, () => ({ action: 'ACTION1' })) });
    assert.match(text, /^PLAYED #1–#10: ACTION1 ×10\n/);
    assert.match(text, /\nbatch: 10 of 12 played; stopped: this call's share of the budget was reached \(10 actions: 25% of the 40 left\)\.$/);
  } finally { await capped.close(); }
  const miss = await fixture({ ARC_THIN_BATCH_STOP: 'miss' });
  try {
    assert.match(miss.tool().description, /a prediction misses/);
    const text = await miss.play({ actions: [{ action: 'ACTION1', predict: { cells: [[0, 0, 7]] } }, { action: 'ACTION2' }] });
    assert.match(text, /\nbatch: 1 of 2 played; stopped: #1's prediction missed\.$/);
  } finally { await miss.close(); }
});
