/**
 * Work memory (docs/plans/2026-10-20-work-memory.md) in the native extension against an HTTP stand-in for the bridge: each
 * action says whether its result was already known from the same board, the head shows what the board already showed,
 * and after a decision that learned nothing new the next head says so and a move never played from this board is pinned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

/** A 16x16 board with two marked cells: ACTION1 changes nothing, a click toggles its cell. */
async function world() {
  let n = 0;
  const grid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0));
  grid[3][3] = 7; grid[8][8] = 9;
  const apply = (action?: string, x?: number, y?: number) => {
    n += 1;
    if (action === 'ACTION6' && x !== undefined && y !== undefined) { grid[y][x] = grid[y][x] ? 0 : 5; return 1; }
    return 0;
  };
  const body = (cells?: number) => ({ frames: [grid], state: 'NOT_FINISHED', levels_completed: 0,
    agent_available_actions: ['RESET', 'ACTION1', 'ACTION6'], action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
    observation_delta: { frame_available: true, changed_cells: cells ?? 0, cells: [] }, public_transition: { level_changed: false } });
  const server: Server = createServer((req, res) => {
    let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
      const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body(call ? apply(call.action, call.x, call.y) : undefined)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'work-memory-')) };
}

async function attach(w: { url: string; root: string }, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: w.root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', PI_ARC_BRIDGE_URL: w.url,
    ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000',
    ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ...env });
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
  return {
    file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
    rows: (name: string) => existsSync(join(w.root, 'harness', name))
      ? readFileSync(join(w.root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
    /** The text parts of the last head, in order. */
    parts: (): string[] => head.content.filter((b: any) => b.type === 'text').map((b: any) => b.text),
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

test('an action whose result this board already showed is said to be known; the next head ends with what was learned and what the board showed, and pins a move never played from it', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    assert.doesNotMatch(await h.begin(), /THIS BOARD|NO NEW INFORMATION/, 'a first board says nothing');
    assert.doesNotMatch(await h.act({ action: 'ACTION1' }), /known/);
    await h.begin();
    assert.match(await h.act({ action: 'ACTION1' }), /^#2 ACTION1 → changed=0 [^\n]* \(known: the same result as #1 from this board\)/);
    assert.deepEqual(h.rows('trajectory.jsonl').map((row) => [row.n, row.novelty, row.known_from ?? null]), [[1, 'new', null], [2, 'known', 1]]);
    await h.begin();
    // The agent's own record on this board is the head's last part, where the response starts, and nowhere before it.
    assert.match(h.parts().at(-1)!, /^NO NEW INFORMATION: your last decision only played ACTION1, whose results this board had already shown \(first at #1\)\. Playing them again shows nothing new\. Next experiment pinned: ACTION6\(3,3\), never played from this board\.\n\nTHIS BOARD \(status cells masked\) was here before: the start, #1\. From it: ACTION1 ×2 → no change\. Never tried from it: clicks on 2 of 2 objects: ACTION6\(3,3\), ACTION6\(8,8\)\.$/);
    assert.doesNotMatch(h.parts()[0], /NO NEW INFORMATION|THIS BOARD/);
    assert.match(h.file('workspace/prompts/strategy.md'), /- First: ACTION6\(3,3\); never played from this board/);
    assert.deepEqual(h.rows('work_memory.jsonl').map((row) => [row.kind, row.move]), [['novelty_pin', 'ACTION6(3,3)']]);
    // The pinned move is new: the streak ends, and the board after it was not seen before.
    assert.doesNotMatch(await h.act({ action: 'ACTION6', x: 3, y: 3 }), /known/);
    const next = await h.begin();
    assert.doesNotMatch(next, /NO NEW INFORMATION|THIS BOARD/);
    assert.match(next, /TEST RESULT \(this board, test 1 of 1\): ACTION6\(3,3\), never played from this board: played at #3/);
  } finally { await h.close(); await w.server.close(); }
});

test('ARC_THIN_WORK_MEMORY=0 leaves rows, heads and pins as they were', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_WORK_MEMORY: '0' });
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin();
    assert.doesNotMatch(await h.act({ action: 'ACTION1' }), /known/);
    const head = await h.begin();
    assert.doesNotMatch(head, /NO NEW INFORMATION|THIS BOARD/);
    assert.equal(h.rows('trajectory.jsonl').some((row) => 'novelty' in row), false);
    assert.equal(h.rows('work_memory.jsonl').length, 0);
  } finally { await h.close(); await w.server.close(); }
});

test('ARC_THIN_CONTEXT_LAYOUT=0 puts the record where it was: NO NEW INFORMATION opens the head, THIS BOARD follows the state', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_CONTEXT_LAYOUT: '0' });
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin(); await h.act({ action: 'ACTION1' });
    const head = await h.begin();
    assert.match(head, /^Decide the next action\.\n\nNO NEW INFORMATION: your last decision only played ACTION1/);
    assert.match(head, /\n\nTHIS BOARD \(status cells masked\) was here before: the start, #1\./);
    assert.equal(h.parts().length, 1, 'one text part, as before');
  } finally { await h.close(); await w.server.close(); }
});
