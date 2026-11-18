import test from 'node:test';
import assert from 'node:assert/strict';
import { installPiCompactionAdapter } from '../demo/pi_compaction_adapter.ts';

test('Pi compaction adapter delegates task-neutral lifecycle decisions to its policy', () => {
  const handlers = new Map<string, (event: any) => unknown>();
  const pi = { on: (event: string, handler: (event: any) => unknown) => handlers.set(event, handler) } as any;
  const calls: string[] = [];
  installPiCompactionAdapter(pi, {
    prepare: event => event.summary ? { accepted: event.summary } : undefined,
    onUnexpected: () => { calls.push('unexpected'); return { cancel: true }; },
    onRestored: event => { calls.push(`restored:${event.reason}`); return undefined; },
  });
  assert.deepEqual(handlers.get('session_before_compact')!({ summary: 'carry' }), { accepted: 'carry' });
  assert.deepEqual(handlers.get('session_before_compact')!({}), { cancel: true });
  handlers.get('session_compact')!({ reason: 'manual' });
  assert.deepEqual(calls, ['unexpected', 'restored:manual']);
});
