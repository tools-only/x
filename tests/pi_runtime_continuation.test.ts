import test from 'node:test';
import assert from 'node:assert/strict';
import { installPiRuntimeContinuation } from '../demo/pi_runtime_continuation.ts';

test('Pi runtime restores the latest continuation into the next agent prompt', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const entries: any[] = [{ type: 'custom', customType: 'runtime-continuation', data: { runId: 'run-1', version: 1, state: { next: 'verify' }, evidenceRefs: ['source@v2'] } }];
  const pi = { on: (event: string, handler: (event: any, ctx: any) => unknown) => handlers.set(event, handler), appendEntry: (type: string, data: unknown) => entries.push({ type: 'custom', customType: type, data }) } as any;
  const ctx = { sessionManager: { getEntries: () => entries } };
  installPiRuntimeContinuation(pi, { resolveEvidence: ref => ref === 'source@v2' ? { text: 'verified source' } : undefined });

  const result = await handlers.get('before_agent_start')!({ systemPrompt: 'Base prompt' }, ctx);
  assert.match(result.systemPrompt, /next.*verify/s);
  assert.match(result.systemPrompt, /verified source/);
  assert.equal(entries.length, 1);
});

test('Pi runtime persists continuation state in the native session and uses latest version', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const entries: any[] = [];
  const pi = { on: (event: string, handler: (event: any, ctx: any) => unknown) => handlers.set(event, handler), appendEntry: (type: string, data: unknown) => entries.push({ type: 'custom', customType: type, data }) } as any;
  const ctx = { sessionManager: { getEntries: () => entries } };
  installPiRuntimeContinuation(pi, { resolveEvidence: () => undefined });

  handlers.get('runtime_continuation_save')!({ runId: 'run-2', state: { step: 1 }, evidenceRefs: [] }, ctx);
  handlers.get('runtime_continuation_save')!({ runId: 'run-2', state: { step: 2 }, evidenceRefs: [] }, ctx);
  const result = await handlers.get('before_agent_start')!({ systemPrompt: 'Base prompt' }, ctx);
  assert.match(result.systemPrompt, /step.*2/s);
  assert.equal(entries.length, 2);
});
