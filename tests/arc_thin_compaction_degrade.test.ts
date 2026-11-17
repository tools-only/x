/**
 * A failed compaction summary must degrade, not end the run (su15-sl1q, 2026-11-17: one cap-hit summary surfaced as
 * extension_error and stopped the run at 80/200 actions with budget left). The hook retries once without thinking —
 * the summary runs at the agent's thinking level, whose reasoning spends the summary's own output cap — and if that
 * also fails it leaves the context uncompacted this round ({cancel: true}); it never throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const capHit = () => ({ role: 'assistant', content: [{ type: 'text', text: 'partial sum' }],
  stopReason: 'length', usage, timestamp: Date.now() });
const summary = () => ({ role: 'assistant', content: [{ type: 'text', text: 'Native checkpoint: evidence kept.' }],
  stopReason: 'stop', usage, timestamp: Date.now() });

/** The native extension attached with a fake Pi whose summarization answers come from `script`. */
async function attach() {
  const state = { frames: [[[0, 9]]], state: 'NOT_FINISHED', levels_completed: 0,
    agent_available_actions: ['ACTION1'], action_budget: { used: 0, maximum: 40, total_used: 0, total_maximum: null } };
  const server = createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...state, observation_delta: { frame_available: true, changed_cells: 0, cells: [] },
        public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'compaction-degrade-'));
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`,
    ARC_HARNESS_LEDGER: 'disabled', ARC_HARNESS_CRITIC: 'disabled' });
  const handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: () => {}, setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'low' } as any);
  const script: any[] = [];
  const calls: any[] = [];
  const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'], reasoning: true, maxTokens: 4096 },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'offline', headers: {} }),
      streamSimple: (_model: any, _context: any, options: any) => {
        calls.push({ reasoning: options?.reasoning, maxTokens: options?.maxTokens });
        const message = script.shift();
        return { result: async () => { assert.ok(message, 'summary script exhausted'); return message; } };
      } } };
  await handlers.get('session_start')({}, ctx);
  const compact = () => handlers.get('session_before_compact')({ reason: 'auto', preparation: {
    messagesToSummarize: [
      { role: 'user', content: [{ type: 'text', text: 'Decision 1: probe the grid.' }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'REFUTED_HYPOTHESIS recorded.' }], stopReason: 'stop', usage, timestamp: 2 },
    ],
    turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 1200, previousSummary: undefined,
    settings: { reserveTokens: 2000, keepRecentTokens: 400 },
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    firstKeptEntryId: 'entry-1',
  } }, ctx);
  const degraded = () => (existsSync(join(root, 'harness', 'context_budget.jsonl'))
    ? readFileSync(join(root, 'harness', 'context_budget.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []).filter((row: any) => row.degraded);
  return { script, calls, compact, degraded,
    async close() {
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    } };
}

test('a cap-hit summary is retried once without thinking, and later summaries stay without it', async () => {
  const h = await attach();
  try {
    h.script.push(capHit(), summary());
    const first = await h.compact();
    assert.match(first.compaction.summary, /Native checkpoint: evidence kept\./);
    assert.equal(first.compaction.firstKeptEntryId, 'entry-1');
    assert.deepEqual(h.calls.map((c) => c.reasoning), ['low', undefined], 'retry carries no thinking');
    assert.equal(h.calls[0].maxTokens, 1600, 'the summary cap the first attempt hit');
    assert.deepEqual(h.degraded().map((row: any) => [row.degraded, row.thinking]), [['summary_failed', 'low']]);
    assert.match(h.degraded()[0].error, /token cap/);
    // The degrade sticks: the next compaction starts without thinking and succeeds on its first attempt.
    h.script.push(summary());
    const second = await h.compact();
    assert.match(second.compaction.summary, /Native checkpoint/);
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[2].reasoning, undefined);
    assert.equal(h.degraded().length, 1, 'a successful retry adds no second degrade row');
  } finally { await h.close(); }
});

test('two cap hits leave the context uncompacted this round; the hook cancels instead of throwing', async () => {
  const h = await attach();
  try {
    h.script.push(capHit(), capHit());
    assert.deepEqual(await h.compact(), { cancel: true });
    assert.deepEqual(h.degraded().map((row: any) => [row.degraded, row.thinking]),
      [['summary_failed', 'low'], ['summary_failed_twice', 'low']]);
    for (const row of h.degraded()) assert.match(row.error, /token cap/);
    // Already without thinking: one attempt per compaction from here on, cancelled on failure, no throw.
    h.script.push(capHit());
    assert.deepEqual(await h.compact(), { cancel: true });
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.degraded().at(-1), { ...h.degraded().at(-1), degraded: 'summary_failed', thinking: 'off' });
  } finally { await h.close(); }
});
