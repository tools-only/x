/**
 * Stages 1-4 of docs/plans/2026-11-16-arc-selfloop-migration.md: the run's own facts under workspace/data/self/, the
 * host's fields plus one digest line on every decision, the typed slots the agent may set, and the level-boundary
 * settlement that counts, from the same receipts, what a level did with the changes saved during it.
 *
 * The facts are projections of logs the runtime already writes, so the decision's own body must not change; the files
 * exist only with ARC_THIN_SELFLOOP=1, carry no message bodies, and a finished level leaves one outcome row and one
 * settlement row. The stage-2 block sits in the tail ahead of the work-memory record, which stays last. A slot saved
 * through the ordinary write path binds at the next decision boundary, rides the digest and the inventory, and a bad
 * save keeps the previous version running.
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
    call,
    file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
    rows: (name: string) => lines(`harness/${name}`),
    selfRows: (name: string) => lines(`workspace/data/self/${name}`),
    selfDir: () => existsSync(join(w.root, 'workspace/data/self')),
    /** The text parts of the last head: the body (and state) first, the tail block last. */
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

test('facts and the digest appear only with the flag; the body differs only by the size the block adds; the work-memory record stays last', async () => {
  const bodies: string[] = [], tails: string[] = [], carried: number[] = [], selfChars: number[] = [];
  const sizeLine = /your last request carried [\d.]+k characters of context/;
  for (const flag of ['0', '1']) {
    const w = await world();
    const h = await attach(w, { ARC_THIN_SELFLOOP: flag });
    try {
      await h.begin(); await h.act({ action: 'ACTION1' });
      await h.begin(); await h.act({ action: 'ACTION1' });
      await h.begin();
      const parts = h.parts();
      bodies.push(parts[0]);
      tails.push(parts.at(-1)!);
      carried.push(Number(/carried ([\d.]+)k characters/.exec(parts[0])![1]));
      if (flag === '0') {
        assert.equal(h.selfDir(), false, 'the control arm writes no self files');
        assert.equal(parts.length, 2);
        assert.match(parts[1], /^NO NEW INFORMATION:/);
      } else {
        const budget = h.selfRows('context_budget.jsonl'), working = h.selfRows('working_set.jsonl');
        assert.deepEqual(budget.map((row) => row.decision), [1, 2, 3]);
        assert.equal(working.length, 3);
        assert.ok(working.every((row) => row.sections && !('text' in row) && !('tail' in row)));
        assert.deepEqual(Object.keys(working[2].sections), Object.keys(h.rows('working_set.jsonl')[2].sections));
        selfChars.push(working[2].sections.self);
        assert.ok(working[2].sections.self > 0, 'the block is accounted for in the working set');
        assert.equal(h.selfRows('outcomes.jsonl').length, 0, 'no level finished yet');
        assert.match(parts[1], /^SELF-EVOLUTION FIELDS \(given by the host, the same every decision\)\n- The task is the host: /);
        assert.match(parts[1], /\nSELF: decision 3, 2 actions at level 0; predictions 0 \(0 hit\/0 miss\); your components \d+(?: \([^)]*\))?; 0 self changes; last outcome none; data\/self\/: 2 budget, 2 working-set, 0 outcome rows\.\n\nNO NEW INFORMATION:/);
        assert.ok(parts[1].indexOf('SELF: decision 3') < parts[1].indexOf('THIS BOARD'));
        assert.match(parts[1], /THIS BOARD [\s\S]*Never tried from it: [\s\S]*\.$/, 'the record on this board stays last');
        assert.equal(parts[1].split('\n\nNO NEW INFORMATION:')[0].length, selfChars[0], 'the accounted size is the block the head shows');
      }
    } finally { await h.close(); await w.server.close(); }
  }
  assert.equal(bodies[1].replace(sizeLine, 'carried <size>'), bodies[0].replace(sizeLine, 'carried <size>'),
    'the body of a decision is unchanged apart from the size it reports');
  assert.notEqual(tails[1], tails[0], 'only the tail gains the self block');
  // The body's own size report is the block plus the blank line that joins the tail; it rounds to 0.1k.
  assert.ok(Math.abs((carried[1] - carried[0]) * 1000 - (selfChars[0] + 2)) <= 120,
    `carried ${carried[0]}k -> ${carried[1]}k for a ${selfChars[0]}-char block`);
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

test('a saved slot binds at the next decision with its receipt, digest line, inventory and runner handoff; a bad save keeps the bound version', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin();
    // The save goes through the same write path as any component: receipt, version, activation at the next boundary.
    assert.match(await h.call('write', { path: 'slots/self.json', content: '{"refine.every": 2, "stall.after": 60}' }),
      /slots\/self\.json → slot self v1: saved · loaded · refine\.every=2, stall\.after=60 · active from your next decision/);
    await h.act({ action: 'ACTION1' });
    const second = await h.begin();
    assert.match(second, /; 1 self change \(last slots\/self\.json v1\); slots set: refine\.every=2, stall\.after=60; last outcome/);
    assert.match(second, /HARNESS \(your prompts, tools, skills and subagents and slots; memory is indexed above\)/);
    assert.match(second, /slot self v1 active: refine\.every=2, stall\.after=60 · read at each decision; a value you set applies from your next decision/);
    const inventory = JSON.parse(h.file('workspace/data/self/slots.json'));
    assert.equal(inventory['refine.every'].current, 2);
    assert.equal(inventory['refine.every'].default, 1000, 'the default stays what the host resolved (ARC_REFINE_EVERY)');
    assert.equal(inventory['stall.after'].current, 60);
    assert.equal(inventory['history.result_chars'].current, inventory['history.result_chars'].default);
    const booked = JSON.parse(h.file('harness/self_slots.json'));
    assert.equal(booked.at, 2);
    assert.deepEqual(booked.values, { 'refine.every': 2, 'stall.after': 60 }, 'the values the runner reads for its own knob');
    // A bad value is refused whole: the receipt names the key and the legal form, and v1 keeps running.
    assert.match(await h.call('write', { path: 'slots/self.json', content: '{"refine.every": 0}' }),
      /slots\/self\.json → slot self v2: saved · NOT loaded \(refine\.every must be an integer 1-200 \(got 0\)\) · v1 still runs/);
    await h.act({ action: 'ACTION1' });
    const third = await h.begin();
    assert.match(third, /; 1 self change \(last slots\/self\.json v1\); slots set: refine\.every=2, stall\.after=60; /,
      'the failed save changes nothing the digest or the bound values show');
    assert.deepEqual(JSON.parse(h.file('harness/self_slots.json')).values, { 'refine.every': 2, 'stall.after': 60 });
    assert.match(third, /REFINE POINT \(every 2 actions;/, 'a read site consumes the slot from the decision it bound at');
  } finally { await h.close(); await w.server.close(); }
});

test('finishing a level settles the changes saved during it: what was bound, what a later predict cited, what rules.md took up', async () => {
  const w = await world();
  const h = await attach(w);
  try {
    await h.begin();
    assert.match(await h.call('write', { path: 'slots/self.json', content: '{"refine.every": 3}' }), /slot self v1: saved/);
    assert.match(await h.call('write', { path: 'prompts/rules.md', content: '---\nactive: true\n---\na click toggles its cell\n' }),
      /prompts\/rules\.md → prompt rules v1: saved/);
    await h.begin(); await h.act({ action: 'ACTION1' });
    await h.begin(); await h.act({ action: 'ACTION6', x: 3, y: 3 });
    w.win();
    await h.begin();
    assert.equal(existsSync(join(w.root, 'workspace/data/self/settlements.jsonl')), false, 'nothing settles before a level finishes');
    await h.act({ action: 'ACTION1', note: 'this move follows the refine.every change' });
    const fourth = await h.begin();
    const rows = h.selfRows('settlements.jsonl');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { level: 0, from_at: 0, to_at: 3, changed: 2, activated: 2, used_later: 1, changes: [
      { path: 'slots/self.json', version: 1, activated: true, used_later: true, signals: ['cited'] },
      { path: 'prompts/rules.md', version: 1, activated: true, used_later: false, signals: [] },
    ] });
    assert.match(fourth, /1 settlement \(level 0: 2 changed, 2 activated, 1 used later: slots\/self\.json v1\)/);
    await h.begin();
    assert.equal(h.selfRows('settlements.jsonl').length, 1, 'a settled level is not settled twice');
  } finally { await h.close(); await w.server.close(); }
});
