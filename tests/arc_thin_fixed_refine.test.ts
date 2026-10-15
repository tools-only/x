import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
import { scheduleDue } from '../demo/arc_thin_refiner.ts';

const reply = (text: string, usage = { input: 100, output: 50 }) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop',
  usage: { ...usage, cacheRead: 0, cacheWrite: 0, totalTokens: usage.input + usage.output } });

/**
 * The native extension on a bridge whose 9 moves one cell per action, with the ledger and refinements on. The refiner's
 * model calls wait until the test settles them, so a test decides what was played while a refinement ran.
 */
async function fixture(env: Record<string, string>) {
  let n = 0;
  const grid = () => { const g = Array.from({ length: 8 }, () => Array(8).fill(0)); g[3][n % 8] = 9; return g; };
  const state = () => ({ frames: [grid()], state: 'NOT_FINISHED', levels_completed: 0, agent_available_actions: ['ACTION1', 'ACTION2'],
    action_budget: { used: n, maximum: 40, total_used: n, total_maximum: null } });
  const server = createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      if (req.url !== '/state') n++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...state(), observation_delta: { frame_available: true, changed_cells: 2, cells: [] }, public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'fixed-refine-'));
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled',
    ARC_REFINE_EVERY: '2', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const inputs: string[] = [];
  const pending: Array<(value: any) => void> = [];
  const ctx: any = { model: { input: ['text'] }, modelRegistry: { streamSimple: (_model: any, context: any) => {
    inputs.push(context.messages[0].content[0].text);
    const settled = new Promise((resolve) => pending.push(resolve));
    return { result: () => settled };
  } } };
  await handlers.get('session_start')({}, ctx);
  const act = (action: string) => tools.get('arc_action').execute('t', repairActionArguments({ action }), undefined, undefined, ctx);
  const begin = async () => {
    const event: any = { prompt: 'Decide.', systemPromptOptions: { sections: {} } };
    await handlers.get('before_agent_start')(event, ctx);
    const head = (await handlers.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx)).messages[0];
    return { system: String(event.systemPromptOptions.customPrompt), head: head.content.map((b: any) => b.text ?? '').join('\n') };
  };
  return {
    inputs, act, begin,
    /** One decision: its start, the head the model is given, and one action. */
    async decide(action = 'ACTION1') { const seen = await begin(); await act(action); return seen; },
    /** Settle the oldest refinement call still waiting, and give its edit time to apply. */
    async settle(value: any) { pending.shift()!(value); await new Promise((r) => setTimeout(r, 150)); },
    refiner: () => existsSync(join(root, 'harness/refiner.jsonl'))
      ? readFileSync(join(root, 'harness/refiner.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
    async close() {
      for (const resolve of pending.splice(0)) resolve(reply('NONE closing'));
      await new Promise((r) => setTimeout(r, 150));
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

test('the schedule is due each time the action count passes a multiple of K', () => {
  assert.deepEqual([1, 14, 15, 16].map((n) => scheduleDue(n, 0, 15)), [false, false, true, true]);
  assert.deepEqual([16, 29, 30, 44].map((n) => scheduleDue(n, 15, 15)), [false, false, true, true]);
  assert.equal(scheduleDue(34, 10, 15), true, 'one decision that played many actions still gets one');
  assert.equal(scheduleDue(100, 0, 0), false);
});

test('fixed step: a refinement every K actions with the facts as input; an edit names what followed its record; a failure is reported', async () => {
  const h = await fixture({});
  try {
    const first = await h.decide();
    assert.match(first.system, /A refinement runs in the background every 2 actions, at a level change, or when you call refine\(focus\)/);
    assert.match(first.head, /^Decide\.\n\nRUNTIME FACTS \(/);
    assert.match(first.head, /\nACTION BUDGET \(a resource, not the goal\): level 0 of 40 used, 40 left; run 0 used, limit unknown\n/);
    assert.match(first.head, /MEMORY: empty\. HYPOTHESES: none · STRATEGY: none active/);
    assert.doesNotMatch(first.head, /RECENT ACTIONS/);
    await h.decide();
    assert.equal(h.inputs.length, 0, 'nothing is due before the second action');
    // At 2 actions the scheduled refinement starts and waits; the agent plays #3 meanwhile.
    await h.decide();
    assert.equal(h.inputs.length, 1);
    assert.match(h.inputs[0], /^WHY NOW: scheduled: every 2 actions, now #2\n\n/);
    assert.match(h.inputs[0], /\n\nRUNTIME FACTS \([^]*EFFORT on this level: 2 actions/);
    await h.settle(reply('FILE prompts/strategy.md\nNext experiment\n- STRATEGY_MARK\nEND\nWHY scheduled review'));
    const fourth = await h.decide();
    assert.match(fourth.head, /HARNESS UPDATE by a refinement after #2 \(scheduled: every 2 actions, now #2\): prompts\/strategy\.md v1 — scheduled review\. Revise, restore or delete it like your own edits\. It was made from the record up to #2; since then: #3 ACTION1\./);
    assert.equal(h.inputs.length, 1, 'not due again until the fourth action');
    await h.decide();
    assert.equal(h.inputs.length, 2);
    await h.settle({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'PROVIDER  DOWN',
      usage: { input: 50_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 50_010 } });
    const sixth = await h.decide();
    assert.match(sixth.head, /REFINEMENT after #4 \(scheduled: every 2 actions, now #4\) failed: PROVIDER DOWN; nothing changed\./);
    assert.doesNotMatch(sixth.head, /HARNESS UPDATE/, 'each notice is shown once');
    // At 6 actions one is due, but refinements have spent more than their share of the tokens: it is skipped.
    const seventh = await h.decide();
    assert.doesNotMatch(seventh.head, /REFINEMENT|HARNESS UPDATE/);
    assert.equal(h.inputs.length, 2);
    const rows = h.refiner();
    assert.deepEqual(rows.filter((r) => r.kind === 'start').map((r) => r.at), [2, 4]);
    assert.ok(rows.some((r) => r.kind === 'edit' && r.path === 'prompts/strategy.md' && r.evidence_at === 2 && r.at === 3), JSON.stringify(rows));
    assert.ok(rows.some((r) => r.kind === 'failed' && r.error === 'PROVIDER DOWN' && r.evidence_at === 4 && r.output_tokens === 10), JSON.stringify(rows));
    assert.ok(rows.some((r) => r.kind === 'over_budget' && r.at === 6 && r.dropped[0] === 'scheduled: every 2 actions, now #6'), JSON.stringify(rows));
    assert.ok(!rows.some((r) => r.kind === 'invalid'));
  } finally { await h.close(); }
});

test('events mode keeps the earlier triggers, ARC_THIN_FACTS=0 the earlier head; a refusal names what is available', async () => {
  const h = await fixture({ ARC_REFINE_TRIGGERS: 'events', ARC_THIN_FACTS: '0' });
  try {
    const first = await h.decide();
    assert.match(first.system, /Refinements run in the background \(level changes, missing goal tests, stalls, repeated work, refine\(focus\)\)/);
    assert.match(first.head, /RECENT ACTIONS: none yet\./);
    assert.doesNotMatch(first.head, /RUNTIME FACTS/);
    await h.decide();
    const third = await h.decide();
    assert.match(third.head, /RECENT ACTIONS \(last 2 of 2\):/);
    assert.equal(h.inputs.length, 1);
    assert.match(h.inputs[0], /^WHY NOW: 2 actions since the last refinement\n\nACTIONS SO FAR: 2;/);
    await h.settle(reply('NONE nothing to change'));
    await h.begin();
    await assert.rejects(h.act('ACTION5'),
      /action 'ACTION5' is not currently available\. Available now: ACTION1, ACTION2; last action played: #3 ACTION1\./);
  } finally { await h.close(); }
});

test('without the ledger there are no facts and the head is as before', async () => {
  const h = await fixture({ ARC_HARNESS_LEDGER: 'disabled', ARC_HARNESS_CRITIC: 'disabled' });
  try {
    await h.decide();
    const second = await h.decide();
    assert.doesNotMatch(second.head, /RUNTIME FACTS/);
    assert.match(second.head, /RECENT ACTIONS \(last 1 of 1\):/);
    assert.doesNotMatch(second.system, /refinement/i);
  } finally { await h.close(); }
});
