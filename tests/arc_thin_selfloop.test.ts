/**
 * Stage 1 of docs/plans/2026-11-16-arc-selfloop-migration.md: the run's own facts under workspace/data/self/.
 *
 * These facts are projections of logs the runtime already writes, so the decision's own text must not change when the
 * flag is on; the files exist only with ARC_THIN_SELFLOOP=1, carry no message bodies, and a finished level leaves one
 * outcome row. The stage-1 claim is readability and zero behavior risk, not adoption.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

/** A 16x16 board with two marked cells: ACTION1 changes nothing, a click toggles its cell, the next action wins the level. */
async function world() {
  let n = 0, levels = 0, pendingWin = false;
  const grid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0));
  grid[3][3] = 7; grid[8][8] = 9;
  const apply = (action?: string, x?: number, y?: number) => {
    n += 1;
    if (pendingWin) { pendingWin = false; levels += 1; return { cells: 1, win: true }; }
    if (action === 'ACTION6' && x !== undefined && y !== undefined) { grid[y][x] = grid[y][x] ? 0 : 5; return { cells: 1, win: false }; }
    return { cells: 0, win: false };
  };
  const body = (result: { cells?: number; win?: boolean } = {}) => ({ frames: [grid], state: 'NOT_FINISHED', levels_completed: levels,
    agent_available_actions: ['RESET', 'ACTION1', 'ACTION6'],
    action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
    observation_delta: { frame_available: true, changed_cells: result.cells ?? 0, cells: [] },
    public_transition: { level_changed: result.win ?? false } });
  const server: Server = createServer((req, res) => {
    let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
      const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(call ? body(apply(call.action, call.x, call.y)) : body()));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'selfloop-')),
    win: () => { pendingWin = true; } };
}

async function attach(w: { url: string; root: string }, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: w.root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', PI_ARC_BRIDGE_URL: w.url,
    ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000',
    ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ARC_THIN_SELFLOOP: '1', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 10, output: 5 } });
  const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'k', headers: {} }), streamSimple: () => ({ result: async () => reply('NONE') }) } };
  await handlers.get('session_start')({}, ctx);
  const text = (result: any) => (result.content ?? []).map((b: any) => b.text ?? '').join('\n');
  const call = async (name: string, params: any) => {
    const tool = tools.get(name);
    try { return text(await tool.execute('t', tool.prepareArguments ? tool.prepareArguments(params) : params, undefined, undefined, ctx)); }
    catch (error) { return `REFUSED: ${(error as Error).message}`; }
  };
  let head: any;
  const lines = (path: string) => existsSync(join(w.root, path))
    ? readFileSync(join(w.root, path), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return {
    file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
    rows: (name: string) => lines(`harness/${name}`),
    selfRows: (name: string) => lines(`workspace/data/self/${name}`),
    selfDir: () => existsSync(join(w.root, 'workspace/data/self')),
    async begin(prompt = 'Decide the next action.') {
      await handlers.get('before_agent_start')({ prompt, systemPromptOptions: { sections: {} } }, ctx);
      head = (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages[0];
      return head.content.map((b: any) => b.text ?? '').join('\n');
    },
    act: (params: any) => call('arc_action', params),
    async close() {
      await new Promise((r) => setTimeout(r, 200));
      await handlers.get('session_shutdown')?.({}, ctx);
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

test('stage 1 facts appear only with the flag, keep no message bodies, and leave every decision text as it was', async () => {
  const heads: string[] = [];
  for (const flag of ['0', '1']) {
    const w = await world();
    const h = await attach(w, { ARC_THIN_SELFLOOP: flag });
    try {
      await h.begin(); await h.act({ action: 'ACTION1' });
      await h.begin(); await h.act({ action: 'ACTION6', x: 3, y: 3 });
      heads.push(await h.begin());
      if (flag === '0') {
        assert.equal(h.selfDir(), false, 'the control arm writes no self files');
      } else {
        const budget = h.selfRows('context_budget.jsonl'), working = h.selfRows('working_set.jsonl');
        assert.deepEqual(budget.map((row) => row.decision), [1, 2, 3]);
        assert.equal(working.length, 3);
        assert.ok(working.every((row) => row.sections && !('text' in row) && !('tail' in row)));
        assert.deepEqual(working.map((row) => row.decision), h.rows('working_set.jsonl').map((row) => row.decision));
        assert.deepEqual(Object.keys(working[2].sections), Object.keys(h.rows('working_set.jsonl')[2].sections));
        assert.equal(h.selfRows('outcomes.jsonl').length, 0, 'no level finished yet');
      }
    } finally { await h.close(); await w.server.close(); }
  }
  assert.equal(heads[1], heads[0], 'stage 1 adds no text to a decision');
});

test('a finished level leaves one outcome row with its span, winner and own-component counts', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin(); await h.act({ action: 'ACTION6', x: 3, y: 3 });
    w.win();
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin();
    const rows = h.selfRows('outcomes.jsonl');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { level: 0, from_at: 0, to_at: 3, actions: 3, resets: 0, game_overs: 0,
      predictions: { made: 0, hits: 0, misses: 0 }, won: true, win_action: 'ACTION1', win_n: 3,
      tools_used: {}, python_runs: 0, claims: { checks: 0, held: 0, contradicted: 0 }, refinements: 0, self_changes: [] });
    await h.begin();
    assert.equal(h.selfRows('outcomes.jsonl').length, 1, 'a settled level is not written twice');
  } finally { await h.close(); await w.server.close(); }
});

test('a restarted run seeds the self files from the store instead of replacing them', async () => {
  const w = await world();
  let h = await attach(w);
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin();
    assert.equal(h.selfRows('context_budget.jsonl').length, 2);
  } finally { await h.close(); }
  h = await attach(w);
  try {
    await h.begin();
    const rows = h.selfRows('context_budget.jsonl');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.decision), [1, 2, 3]);
  } finally { await h.close(); await w.server.close(); }
});
