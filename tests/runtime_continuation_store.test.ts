import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeContinuationStore } from '../demo/runtime_continuation_store.ts';

test('saves versioned continuation state and restores an exact version', () => {
  const store = new RuntimeContinuationStore();
  const first = store.save({ runId: 'run-1', state: { next: 'inspect', assumptions: ['A'], counterexamples: ['B'] }, evidenceRefs: ['obs:7'], expectedVersion: 0 });
  const second = store.save({ runId: 'run-1', state: { next: 'act', assumptions: ['A'], counterexamples: ['B'] }, evidenceRefs: ['obs:7', 'decision:3'], expectedVersion: first.version });

  assert.equal(first.version, 1);
  assert.deepEqual(store.load('run-1')?.state, second.state);
  assert.equal(store.load('run-1', 1)?.state.next, 'inspect');
  assert.deepEqual(store.load('run-1')?.evidenceRefs, ['obs:7', 'decision:3']);
});

test('rejects stale writes and malformed state instead of silently overwriting', () => {
  const store = new RuntimeContinuationStore();
  store.save({ runId: 'run-1', state: { next: 'inspect' }, evidenceRefs: [], expectedVersion: 0 });
  assert.throws(() => store.save({ runId: 'run-1', state: { next: 'wrong' }, evidenceRefs: [], expectedVersion: 0 }), /version conflict/);
  assert.throws(() => store.save({ runId: 'run-1', state: undefined, evidenceRefs: [], expectedVersion: 1 } as any), /JSON value/);
});

test('round-trips snapshot and rejects invalid version sequences', () => {
  const store = new RuntimeContinuationStore();
  store.save({ runId: 'run-1', state: { next: 'inspect' }, evidenceRefs: [], expectedVersion: 0 });
  const restored = RuntimeContinuationStore.fromSnapshot(store.snapshot());
  assert.deepEqual(restored.load('run-1')?.state, { next: 'inspect' });
  assert.throws(() => RuntimeContinuationStore.fromSnapshot({ records: [{ runId: 'run-1', version: 3, state: {}, evidenceRefs: [] }] } as any), /invalid continuation snapshot/);
});

test('prepares next-request payload with exact continuation state and resolvable evidence', () => {
  const store = new RuntimeContinuationStore();
  store.save({ runId: 'run-1', state: { next: 'test hypothesis', counterexample: 'obs:2' }, evidenceRefs: ['obs:1', 'obs:missing'], expectedVersion: 0 });

  assert.deepEqual(store.preparePrompt('run-1', ref => ref === 'obs:1' ? { fact: 'observed' } : undefined), {
    runId: 'run-1', version: 1, state: { next: 'test hypothesis', counterexample: 'obs:2' },
    evidence: [{ ref: 'obs:1', available: true, value: { fact: 'observed' } }, { ref: 'obs:missing', available: false }],
  });
  assert.equal(store.preparePrompt('unknown-run', () => 'not used'), undefined);
});
