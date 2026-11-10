import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveSelfSession } from '../demo/live_self_core.ts';
import { closeLiveSelfMethods } from '../demo/live_self_wasi.ts';

const operation = (s: LiveSelfSession, target: 'task_harness' | 'evolution_loop') => s.currentCapabilities.find(x => x.target === target)!;
const reflect = (s: LiveSelfSession, target: 'task_harness' | 'evolution_loop', source: string, ref = operation(s, target).ref) =>
  s.reflect({ ref, replace: true, value: { type: 'text', value: source } });

test('session Mirror uses host-granted, one-use, target-scoped capabilities and revision guards', () => {
  const s = new LiveSelfSession();
  const mirror = s.mirror('task');
  assert.equal(mirror.parts.kernel.protected, true);
  assert.deepEqual(mirror.workspace, { id: s.workspace.id });
  assert.equal((mirror.parts.task_harness as any).operations[0].op, 'replace');
  assert.equal((mirror.parts.evolution_loop as any).operations[0].version, 1);
  const harnessOp = operation(s, 'task_harness');
  assert.throws(() => s.reflect({ ref: harnessOp.ref, replace: true, value: { type: 'json', value: {} } }), /typed value mismatch/);
  assert.throws(() => s.reflect({ ref: harnessOp.ref, replace: true, value: { type: 'text', value: 'def = broken' } }), /source rejected|invalid_program/);
  assert.equal(s.current.version, 1, 'failed validation cannot publish');
  reflect(s, 'task_harness', 'text = input["source_text"].upper()\ntext');
  assert.equal(s.current.version, 2);
  assert.throws(() => reflect(s, 'task_harness', '"second"', harnessOp.ref), /capability revoked or invalid/);
  const noHarnessGrant = new LiveSelfSession([{ target: 'evolution_loop', operation: 'replace' }]);
  assert.equal(noHarnessGrant.mirror('x').parts.task_harness.operations.length, 0);
  const loopRef = operation(noHarnessGrant, 'evolution_loop').ref;
  noHarnessGrant.revoke('evolution_loop');
  assert.throws(() => noHarnessGrant.reflect({ ref: loopRef, replace: true, value: { type: 'text', value: '"valid"' } }), /capability revoked/);
});

test('WASI methods change actual task output and subsequent review analysis; runs retain revision provenance', async () => {
  const s = new LiveSelfSession();
  const initial = await s.draft('slide-outline', 'Revenue rose. Costs were flat.', 1);
  assert.equal(initial.output, 'Brief: Revenue rose');
  assert.equal(initial.revision, 1);
  assert.equal(s.current.version, 1, 'task invocation does not auto-promote');
  const loopSource = `source_words = input["source_text"].lower().split()\ndraft = input["draft"].lower()\nlong_terms = [word.strip(".,!?;:") for word in source_words if len(word.strip(".,!?;:")) > 3]\ncovered = [word for word in long_terms if word in draft]\n{"method": "long-token-recall", "long_terms": len(long_terms), "covered": covered, "recall": len(covered) / len(long_terms) if long_terms else 1.0}`;
  reflect(s, 'task_harness', 'text = input["source_text"].upper()\ntext');
  reflect(s, 'evolution_loop', loopSource);
  const changed = await s.draft('code-note', 'Revenue rose. Costs were flat.', 3);
  assert.equal(changed.output, 'REVENUE ROSE. COSTS WERE FLAT.');
  assert.equal((changed.self_review_signal as any).method, 'long-token-recall');
  assert.equal((changed.self_review_signal as any).long_terms, 5);
  s.recordReview(changed.evidence_id, 'change', 'The source coverage signal is a useful diagnostic, but I want to compare long terms.');
  assert.equal(s.submit(changed.evidence_id, 'change', 'The new comparison evaluates distinct source tokens.').revision, 3);
  const pinned = await s.draft('old-revision-run', 'Revenue rose. Costs were flat.', 1);
  assert.equal(pinned.output, 'Brief: Revenue rose');
  assert.equal(pinned.revision, 1);
  assert.equal(s.trace().review_status.find(x => x.task === 'slide-outline')?.disposition, 'unreviewed');
  assert.equal(s.trace().review_status.find(x => x.task === 'code-note')?.disposition, 'change');
  closeLiveSelfMethods();
});

test('failed optional self review does not block a task deliverable', async () => {
  const s = new LiveSelfSession();
  reflect(s, 'evolution_loop', 'failure = 1 / 0\n{"impossible": failure}');
  const draft = await s.draft('plain-task', 'A useful source sentence.');
  assert.equal(draft.output, 'Brief: A useful source sentence');
  assert.equal(draft.review_status, 'failed');
  assert.equal(s.submit(draft.evidence_id, 'defer', 'The self-review method failed to run.').submitted, true);
  assert.equal(s.trace().review_status[0].disposition, 'defer');
});
