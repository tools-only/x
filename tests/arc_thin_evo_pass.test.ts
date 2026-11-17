/**
 * The evolution pass (docs/plans/2026-11-17-arc-evolution-pass.md, adapted from the evo line's external pass): at
 * recorded boundaries the runner opens one review-shaped turn whose prompt begins "EVOLUTION PASS."; the extension
 * swaps in a mechanical record — the window since the last pass_close anchor, that window's decisions, the self
 * surface pushed inline, the end of the previous pass's reply — refuses arc_action, and holds the review tool-call
 * cap. Closing the pass leaves a pass_close row whose reply tail is the next pass's CARRIED line, and `NO HARNESS
 * CHANGE: <reason>` leaves a typed no_change row. ARC_THIN_EVO_PASS=0 keeps the resident line out and leaves a pass
 * prompt an ordinary consolidation; the pass consumes no review span; the record keeps its trajectory with the
 * refiner window off, since the pass flag keeps the decision records.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { LEVEL_REVIEW_CALLS } from '../demo/arc_thin_level_review.ts';

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
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'evopass-')),
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
  const lines = (path: string) => existsSync(join(w.root, path))
    ? readFileSync(join(w.root, path), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return {
    call,
    rows: (name: string) => lines(`harness/${name}`),
    async begin(prompt = 'Decide the next action.') {
      await handlers.get('before_agent_start')({ prompt, systemPromptOptions: { sections: {} } }, ctx);
      const head = (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages[0];
      return head.content.map((b: any) => b.text ?? '').join('\n');
    },
    act: (params: any) => call('arc_action', params),
    /** One assistant reply as the extension's message_end hook records it (text collected, NO HARNESS CHANGE typed). */
    say: (said: string) => handlers.get('message_end')({ message: reply(said) }, ctx),
    async close() {
      await new Promise((r) => setTimeout(r, 200));
      await handlers.get('session_shutdown')?.({}, ctx);
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

/** Rows as written, without the timestamp append() adds: the fields the asserts pin. */
const bare = (rows: Array<Record<string, unknown>>) => rows.map(({ t, ...row }) => row);

test('a pass turn swaps in the record and refuses the action; the reply tail is carried; the review span survives', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin(); await h.act({ action: 'ACTION6', x: 3, y: 3 });
    const record = await h.begin('EVOLUTION PASS. 2 actions have passed without a self change or an evolution pass; this turn takes no action.');
    assert.ok(record.includes("EVOLUTION PASS RECORD (actions #1–#2, counted and copied from this run's logs):"));
    assert.ok(record.includes('WINDOW: 2 action(s), 2 decision(s), 0 python call(s), predictions 0 (0 hit/0 miss), ' +
      '0 self change(s), 0 refinement(s) since the last pass.'));
    assert.ok(record.includes("TRAJECTORY (the window's decisions, newest kept under 6000 chars):"));
    assert.ok(record.includes('[decision 1 | moves #1–#1]'));
    assert.match(record, /\[decision 2 \| moves #2–#2\][\s\S]*ACTION6/, 'the window carries the decisions themselves');
    assert.ok(record.includes('"write": "slots/self.json: one JSON object;'), 'the slot inventory is pushed into the record');
    assert.match(record, /\n- your components: /);
    assert.ok(record.includes("CARRIED (the end of your previous pass's reply):\nnone recorded"));
    assert.match(await h.act({ action: 'ACTION1' }), /no action during consolidation/);
    assert.deepEqual(bare(h.rows('harness_decisions.jsonl').filter((row) => row.kind === 'review_start')),
      [{ kind: 'review_start', decision: 3, type: 'evo', at: 2, level: 0 }]);
    const set = h.rows('working_set.jsonl').at(-1);
    assert.equal(set.decision, 3);
    assert.equal(set.consolidating, true);
    assert.equal(set.evo_pass, true);
    await h.say('The toggle rule holds; most of the window went to re-checking it.\nNO HARNESS CHANGE: nothing in the window repeats a cost');
    const decide = await h.begin();
    assert.ok(decide.includes('the host opens one evolution pass outside the game turn'), 'the one resident line names the mechanism');
    assert.deepEqual(bare(h.rows('harness_decisions.jsonl').filter((row) => row.kind === 'no_change')),
      [{ kind: 'no_change', decision: 3, at: 2, type: 'evo', reason: 'nothing in the window repeats a cost' }]);
    assert.deepEqual(bare(h.rows('harness_decisions.jsonl').filter((row) => row.kind === 'pass_close')),
      [{ kind: 'pass_close', decision: 3, at: 2, level: 0,
        carry: 'The toggle rule holds; most of the window went to re-checking it.\nNO HARNESS CHANGE: nothing in the window repeats a cost' }]);
    await h.act({ action: 'ACTION1' });
    const second = await h.begin('EVOLUTION PASS. Level 0 is settled and reviewed; this turn takes no action.');
    assert.ok(second.includes('EVOLUTION PASS RECORD (actions #3–#3'), 'the next window is anchored at the last pass_close');
    assert.ok(second.includes('WINDOW: 1 action(s), 1 decision(s),'));
    assert.match(second, /CARRIED \(the end of your previous pass's reply\):\nThe toggle rule holds;[\s\S]*repeats a cost/);
    const review = await h.begin('CONSOLIDATE. Review what the recent actions showed.');
    assert.ok(review.includes('ACTIONS SINCE YOUR LAST REVIEW (#1–#3, 3 of 3):'), 'the passes consumed none of the review span');
  } finally { await h.close(); await w.server.close(); }
});

test('ARC_THIN_EVO_PASS=0 keeps the resident line out, and a stray pass prompt is an ordinary consolidation', async () => {
  const w = await world();
  const h = await attach(w, { ARC_THIN_EVO_PASS: '0' });
  try {
    const head = await h.begin();
    assert.ok(!head.includes('evolution pass'), 'no resident line without the flag');
    await h.act({ action: 'ACTION1' });
    const stray = await h.begin('EVOLUTION PASS. a stray pass prompt; this turn takes no action.');
    assert.ok(!stray.includes('EVOLUTION PASS RECORD'));
    assert.ok(stray.includes('ACTIONS SINCE YOUR LAST REVIEW (#1–#1, 1 of 1):'), 'the prompt degrades to the ordinary consolidation view');
    assert.match(await h.act({ action: 'ACTION1' }), /no action during consolidation/, 'a review-shaped turn still takes no action');
    await h.begin();
    assert.deepEqual(h.rows('harness_decisions.jsonl').filter((row) => ['review_start', 'pass_close', 'no_change'].includes(row.kind)),
      [], 'the flag off leaves no pass rows');
    assert.ok(h.rows('working_set.jsonl').every((row) => !('evo_pass' in row)));
  } finally { await h.close(); await w.server.close(); }
});

test('with the refiner window off the record keeps its trajectory: the pass flag keeps the decision records', async () => {
  const w = await world();
  const h = await attach(w, { ARC_REFINE_WINDOW: '0' });
  try {
    await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
    const record = await h.begin('EVOLUTION PASS. 1 action has passed without a self change; this turn takes no action.');
    assert.ok(record.includes('WINDOW: 1 action(s), 1 decision(s),'));
    assert.match(record, /\[decision 1 \| moves #1–#1\][\s\S]*ACTION6/);
  } finally { await h.close(); await w.server.close(); }
});

test('the pass is bounded like a review: call 10 carries the closing note, call 11 ends the pass', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin('EVOLUTION PASS. the cap is the review cap; this turn takes no action.');
    // Two files alternate so no three results in a row are identical (that ends the decision early on its own).
    for (let i = 1; i < LEVEL_REVIEW_CALLS; i++)
      await h.call('read', { path: i % 2 ? 'data/self/slots.json' : 'data/self/working_set.jsonl' });
    assert.match(await h.call('read', { path: 'data/self/slots.json' }),
      /\(This was tool call 10 of 10 for this pass: finish now; save a change or end with NO HARNESS CHANGE: <reason>\.\)/);
    assert.match(await h.call('read', { path: 'data/self/slots.json' }), /this pass used its 10 tool calls; it ends here/);
  } finally { await h.close(); await w.server.close(); }
});
