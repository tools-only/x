import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMemoryStore } from '../demo/runtime_memory_store.ts';

test('stores versioned memories with provenance and reads historical versions', () => {
  const store = new RuntimeMemoryStore();
  const first = store.write({ id: 'workflow', source: 'Use evidence before deciding', scope: 'general', provenance: ['run-1'] });
  const second = store.write({ id: 'workflow', source: 'Check evidence and counterexamples', scope: 'general', provenance: ['run-2'], expectedVersion: first.version });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(store.read('workflow')?.source, second.source);
  assert.equal(store.read('workflow', 1)?.source, first.source);
});

test('rejects writes based on a stale version', () => {
  const store = new RuntimeMemoryStore();
  store.write({ id: 'workflow', source: 'v1' });

  assert.throws(() => store.write({ id: 'workflow', source: 'stale', expectedVersion: 0 }), /version conflict/);
});

test('search returns scoped previews and excludes retired records by default', () => {
  const store = new RuntimeMemoryStore();
  const saved = store.write({ id: 'general-workflow', source: 'Use evidence before deciding', scope: 'general' });
  store.write({ id: 'ppt-workflow', source: 'Use evidence before deciding in slide production', scope: 'ppt' });
  store.retire(saved.id, saved.version);

  assert.deepEqual(store.search('evidence', { scope: 'ppt' }), [
    { id: 'ppt-workflow', version: 1, scope: 'ppt', preview: 'Use evidence before deciding in slide production' },
  ]);
  assert.deepEqual(store.search('evidence', { scope: 'general' }), []);
});

test('snapshot and reload preserve versions, provenance, scope, and retirement', () => {
  const store = new RuntimeMemoryStore();
  const first = store.write({ id: 'workflow', source: 'v1', scope: 'general', provenance: ['run-1'] });
  const second = store.write({ id: 'workflow', source: 'v2', scope: 'general', provenance: ['run-2'], expectedVersion: first.version });
  store.retire(second.id, second.version);
  const restored = RuntimeMemoryStore.fromSnapshot(store.snapshot());

  assert.equal(restored.read('workflow', 1)?.provenance[0], 'run-1');
  assert.equal(restored.read('workflow')?.status, 'retired');
  assert.deepEqual(restored.search('v2'), []);
  assert.equal(RuntimeMemoryStore.fromSerialized(store.serialize()).read('workflow')?.status, 'retired');
});

test('rejects malformed snapshots and returns detached records', () => {
  assert.throws(() => RuntimeMemoryStore.fromSnapshot({ records: [{ id: 'x', version: 2, source: 'bad', provenance: [], status: 'active' }] } as any), /invalid memory snapshot/);
  const store = new RuntimeMemoryStore();
  const written = store.write({ id: 'x', source: 'source', provenance: ['run'] });
  written.provenance.push('mutated');
  assert.deepEqual(store.read('x')?.provenance, ['run']);
});
