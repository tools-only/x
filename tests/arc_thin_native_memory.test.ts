import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMemory, applyRows } from '../demo/arc_thin_memory.ts';
import { planNativeMemoryUpdate } from '../demo/arc_thin_native_memory.ts';

test('native memory accepts independent valid and partial entries but refuses fabricated action evidence atomically', () => {
  const memory = emptyMemory();
  const plan = planNativeMemoryUpdate(memory, { set: [{ key: 'fact', text: 'observed' }, { key: 'missing' } as any],
    hypotheses: [{ key: 'h', claim: 'moves right', evidence: { verdict: 'supports' } }, { key: 'incomplete' }] }, 2);
  assert.equal(plan.ok, true); if (!plan.ok) return;
  applyRows(memory, plan.rows);
  assert.equal(memory.facts.get('fact')?.text, 'observed');
  assert.equal(memory.hypotheses.get('hyp.h')?.claim, 'moves right');
  assert.equal(memory.hypotheses.get('hyp.h')?.evidence.length, 0);
  assert.match(plan.receipt, /not applied/);
  assert.equal(memory.facts.has('missing'), false);
  const corrupt = planNativeMemoryUpdate(memory, { set: [{ key: 'should_not_apply', text: 'x' }],
    tests: [{ action: 999, verdicts: { h: 'supports' } }] }, 2);
  assert.equal(corrupt.ok, false);
  assert.equal(memory.facts.has('should_not_apply'), false);
  const update = planNativeMemoryUpdate(memory, { hypotheses: [{ key: 'h', next_test: 'ACTION4' }] }, 2);
  assert.equal(update.ok, true);
});
