import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMemory, applyRows, renderFactsCompact } from '../demo/arc_thin_memory.ts';
import { planNativeMemoryUpdate } from '../demo/arc_thin_native_memory.ts';

test('native facts have the same action provenance in live and replayed views', () => {
  const state = emptyMemory();
  const saved = planNativeMemoryUpdate(state, {set:[{key:'bar',text:'bar=19'}]}, 25);
  assert.equal(saved.ok,true); if (!saved.ok) return;
  applyRows(state, saved.rows);
  assert.equal(state.facts.get('bar')?.at,25);
  assert.match(renderFactsCompact(state,2200,true), /recorded at #25/);
  const replay=emptyMemory(); applyRows(replay,JSON.parse(JSON.stringify(saved.rows)));
  assert.deepEqual(replay,state);
  const old=emptyMemory(); applyRows(old,[{key:'old',text:'old state',confidence:3}]);
  assert.match(renderFactsCompact(old,2200,true), /source unknown/);
  assert.doesNotMatch(renderFactsCompact(state), /recorded at/);
});

test('native batch deletion reports only applied deletions and replays the saved state', () => {
  const memory = emptyMemory();
  const seed = planNativeMemoryUpdate(memory, {set: [{key:'a',text:'one'}, {key:'b',text:'two'}]}, 2);
  assert.equal(seed.ok, true); if (!seed.ok) return;
  applyRows(memory, seed.rows);
  const plan = planNativeMemoryUpdate(memory, {op:'delete', delete:['a','b']}, 2);
  assert.equal(plan.ok, true); if (!plan.ok) return;
  assert.doesNotMatch(plan.receipt, /not applied/);
  applyRows(memory, plan.rows);
  assert.equal(memory.facts.size, 0);
  const replay = emptyMemory(); applyRows(replay, [...seed.rows, ...plan.rows]);
  assert.deepEqual(replay, memory);
  const empty = planNativeMemoryUpdate(memory, {op:'delete', delete:[]}, 2);
  assert.equal(empty.ok && /not applied/.test(empty.receipt), true);
});

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
