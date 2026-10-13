import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PythonSession, SESSION_CAP_CHARS } from '../demo/arc_thin_python_session.ts';

const report = (n: number, names: string[], defs: Array<[string, string]> = []) =>
  ({ defs, blob: `blob${n}`, sha: `sha${n}`, names, chars: 10 * n, raw_bytes: 100, unsupported: [], uses: [] });

test('checkpoints are versioned files behind a head pointer and come back after a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pysession-'));
  const session = new PythonSession(dir);
  assert.equal(session.recovered, undefined);
  assert.deepEqual(session.payload(), { defs: [], blob: '', sha: '', cap: SESSION_CAP_CHARS });
  const first = session.commit(report(1, ['grid0', 'k'], [['diff', 'def diff(a, b):\n    return 1\n']]));
  assert.deepEqual(first, { receipt: '(python session: +diff(), +grid0, +k)', committed: true, version: 1, event: 'committed' });
  // Changes are named; an unchanged session says nothing and writes nothing.
  assert.equal(session.commit(report(2, ['grid0', 'seen'], [['diff', 'def diff(a, b):\n    return 1\n']])).receipt, '(python session: +seen, -k)');
  assert.deepEqual(session.commit({ unchanged: true, unsupported: [], uses: [] }), { receipt: '', committed: false, version: 2 });
  assert.deepEqual(readdirSync(dir).sort(), ['HEAD.json', 'v1.json', 'v2.json']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'HEAD.json'), 'utf8')).version, 2);
  // A restart reads the files: same payload, nothing else needed.
  const restarted = new PythonSession(dir);
  assert.equal(restarted.recovered, 2);
  assert.deepEqual(restarted.payload(), session.payload());
  assert.deepEqual(restarted.names(), ['diff()', 'grid0', 'seen']);
  // Only the last versions are kept.
  for (let n = 3; n <= 9; n++) restarted.commit(report(n, [`n${n}`]));
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('v')).sort(), ['v5.json', 'v6.json', 'v7.json', 'v8.json', 'v9.json']);
});

test('nothing is committed, evicted or reported as saved when a checkpoint cannot be taken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pysession-fail-'));
  const session = new PythonSession(dir);
  session.commit(report(1, ['k']));
  const before = session.payload();
  const over = session.commit({ over: { chars: 310_000, cap: 128_000, raw_bytes: 900_000, largest: [['frames', 250_000], ['paths', 40_000]] }, unsupported: [], uses: [] });
  assert.equal(over.committed, false);
  assert.match(over.receipt, /^\(python session NOT saved: it needs 310 KB and the limit is 128 KB; largest: frames 250 KB, paths 40 KB\. The state before this call is kept/);
  const failed = session.commit({ error: 'it could not be read back (EOFError: Ran out of input)', unsupported: [], uses: [] });
  assert.match(failed.receipt, /^\(python session NOT saved: it could not be read back \(EOFError: Ran out of input\)\. The state before this call is kept\.\)$/);
  assert.deepEqual(session.payload(), before);
  assert.deepEqual(new PythonSession(dir).payload(), before);
  // What could not be kept is named with its reason, next to what was.
  const mixed = session.commit({ ...report(2, ['k', 'm']), unsupported: [['gen', "generator: cannot pickle 'generator' object"]],
    failed_defs: [['old', 'NameError: name x is not defined']], gone: ['route'], gone_refs: ['lib.path.Route'] });
  assert.equal(mixed.receipt, "(python session: +m)\n(not kept in the python session: gen (generator: cannot pickle 'generator' object))\n" +
    '(definitions that no longer run and were dropped: old (NameError: name x is not defined))\n' +
    '(dropped from the python session, their definitions no longer load: route [lib.path.Route])');
});

test('a damaged or unloadable checkpoint falls back to the version before it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pysession-bad-'));
  const session = new PythonSession(dir);
  session.commit(report(1, ['a']));
  session.commit(report(2, ['a', 'b']));
  // The newest file is damaged on disk: the restart takes the one before it.
  writeFileSync(join(dir, 'v2.json'), '{"checkpoint": {"version": 2}, "sha256": "wrong"}');
  const restarted = new PythonSession(dir);
  assert.equal(restarted.recovered, 1);
  // A version file newer than the head was never committed and is not taken, even when it is intact.
  const headDir = mkdtempSync(join(tmpdir(), 'pysession-head-'));
  new PythonSession(headDir).commit(report(1, ['a']));
  const { checkpoint } = JSON.parse(readFileSync(join(headDir, 'v1.json'), 'utf8'));
  const orphan = { ...checkpoint, version: 7, names: ['orphan'] };
  writeFileSync(join(headDir, 'v7.json'), JSON.stringify({ checkpoint: orphan, sha256: createHash('sha256').update(JSON.stringify(orphan)).digest('hex') }));
  assert.equal(new PythonSession(headDir).recovered, 1);
  writeFileSync(join(headDir, 'HEAD.json'), JSON.stringify({ version: 7 }));
  assert.equal(new PythonSession(headDir).recovered, 7);
  assert.deepEqual(restarted.names(), ['a']);
  // The guest could not load the stored checkpoint: roll back, say so, and keep nothing from that call.
  session.commit(report(3, ['a', 'b', 'c']));
  const rolled = session.commit({ load_error: 'UnpicklingError: invalid load key', failed_defs: [], gone: [] });
  assert.equal(rolled.event, 'rolled_back');
  assert.match(rolled.receipt, /^\(python session v3 could not be restored: UnpicklingError: invalid load key\. It is back at v1: a\. Nothing from this call was kept\.\)$/);
  assert.deepEqual(session.names(), ['a']);
  // Version numbers are never reused after a rollback.
  assert.equal(session.commit(report(4, ['a', 'z'])).version, 4);
  // A session without a directory lives in memory: a subagent's own.
  const child = new PythonSession();
  assert.equal(child.commit(report(1, ['x'])).receipt, '(python session: +x)');
  assert.deepEqual(child.payload().blob, 'blob1');
});

test('calls that share a session run one at a time', async () => {
  const session = new PythonSession();
  const order: string[] = [];
  const slow = session.exclusive(async () => { order.push('a start'); await new Promise(done => setTimeout(done, 30)); order.push('a end'); return 1; });
  const failing = session.exclusive(async () => { order.push('b'); throw Error('boom'); });
  const fast = session.exclusive(async () => { order.push('c'); return 3; });
  assert.equal(await slow, 1);
  await assert.rejects(failing, /boom/);
  assert.equal(await fast, 3);
  assert.deepEqual(order, ['a start', 'a end', 'b', 'c']);
});
