import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { emptyMemory, applyRows, renderFactsCompact } from '../demo/arc_thin_memory.ts';
import { planNativeMemoryUpdate } from '../demo/arc_thin_native_memory.ts';

/** The tools the extension registers in native mode. */
function nativeTools(): Map<string, any> {
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: mkdtempSync(join(tmpdir(), 'native-memory-')), ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment' });
  const tools = new Map<string, any>();
  try {
    arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: () => {}, getActiveTools: () => [],
      getAllTools: () => [...tools.values()], on: () => {}, getThinkingLevel: () => 'off' } as any);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  return tools;
}

test("the native memory tool documents each hypothesis field where it is written, and validates as loosely as before", () => {
  // The agent put a check in 10 of its 72 hypothesis writes (su15 since 2026-10-15), 3 of them English: in native mode
  // the hypotheses parameter was an array of anything, and the check's interface was described only in the legacy schema.
  const items = nativeTools().get('memory').parameters.properties.hypotheses.items;
  assert.deepEqual(Object.keys(items.properties ?? {}).sort(), ['check', 'claim', 'key', 'next_test', 'predicts', 'question', 'status']);
  for (const [name, field] of Object.entries(items.properties) as Array<[string, any]>) assert.ok(field.description, `${name} has a description`);
  // A malformed field is still the planner's to report per entry, not a schema error that refuses the whole call.
  assert.equal(Value.Check(items, { key: 'hyp.a', claim: 42, status: 'maybe', evidence: { verdict: 'supports' } }), true);
});

test('a claim that opens with a status word sets that status when none is given', () => {
  // su15-q38-2 (2026-10-19): "REJECTED: #89 proved …" with status open kept two dead rivals compared for 45 decisions.
  const state = emptyMemory();
  const first = planNativeMemoryUpdate(state, { hypotheses: [{ key: 'hyp.row', claim: 'erasing the row wins', question: 'goal' }] }, 5);
  assert.equal(first.ok, true); if (!first.ok) return;
  applyRows(state, first.rows);
  const rejected = planNativeMemoryUpdate(state, { hypotheses: [{ key: 'hyp.row', claim: 'REJECTED: #89 proved that emptying the row is a loss' }] }, 89);
  assert.equal(rejected.ok, true); if (!rejected.ok) return;
  applyRows(state, rejected.rows);
  assert.equal(state.hypotheses.get('hyp.row')?.status, 'rejected');
  assert.match(rejected.receipt, /hyp\.row: status set to rejected, as its claim begins/);
  // An explicit status wins, and a claim that only mentions the word does not change it.
  const explicit = planNativeMemoryUpdate(state, { hypotheses: [{ key: 'hyp.b', claim: 'CONFIRMED: ACTION7 undoes', status: 'open' }] }, 90);
  assert.equal(explicit.ok, true); if (!explicit.ok) return;
  applyRows(state, explicit.rows);
  assert.equal(state.hypotheses.get('hyp.b')?.status, 'open');
  const mention = planNativeMemoryUpdate(state, { hypotheses: [{ key: 'hyp.c', claim: 'the rejected block returns to the start' }] }, 91);
  assert.equal(mention.ok, true); if (!mention.ok) return;
  applyRows(state, mention.rows);
  assert.equal(state.hypotheses.get('hyp.c')?.status, 'open');
});

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

test('a check written in English is kept as the next test, the receipt shows the form, and it never replaces a working check', () => {
  // su15-l1-1 saved "after an ACTION6 or ACTION7, does the 9-blob move? record direction" as a check three times; it never
  // compiled ("check: not usable (SyntaxError …)") and the hypothesis kept no test.
  const memory = emptyMemory();
  const commit = (params: any, n: number) => {
    const plan = planNativeMemoryUpdate(memory, params, n);
    assert.equal(plan.ok, true); if (!plan.ok) throw new Error(plan.error);
    applyRows(memory, plan.rows);
    return plan.receipt;
  };
  const prose = 'after an ACTION6 or ACTION7, does the 9-blob move? record direction';
  const receipt = commit({ hypotheses: [{ key: 'blob', claim: 'clicks move the blob', check: prose }] }, 3);
  assert.equal(memory.hypotheses.get('hyp.blob')!.check, undefined);
  assert.equal(memory.hypotheses.get('hyp.blob')!.next_test, prose);
  assert.match(receipt, /hyp\.blob: the check is not Python; it was kept as next_test\. A check is def check\(t\)/);
  // Prose in place of a working check keeps the check; a next_test given with it comes first.
  const working = 'def check(t):\n    return None\n';
  commit({ hypotheses: [{ key: 'blob', check: working }] }, 3);
  commit({ hypotheses: [{ key: 'blob', check: 'record the direction', next_test: 'ACTION6 at the blob' }] }, 4);
  assert.equal(memory.hypotheses.get('hyp.blob')!.check, working);
  assert.equal(memory.hypotheses.get('hyp.blob')!.next_test, 'ACTION6 at the blob; record the direction');
  // Python that defines check another way is compiled as before, and "" still removes the check.
  commit({ hypotheses: [{ key: 'blob', check: 'check = lambda t: None' }] }, 4);
  assert.equal(memory.hypotheses.get('hyp.blob')!.check, 'check = lambda t: None\n');
  commit({ hypotheses: [{ key: 'blob', check: '' }] }, 4);
  assert.equal(memory.hypotheses.get('hyp.blob')!.check, undefined);
});

test('memory(op="list") in native mode shows each check source', () => {
  const memory = emptyMemory();
  const seed = planNativeMemoryUpdate(memory, { hypotheses: [{ key: 'two', claim: 'ACTION1 changes two cells', check: 'def check(t):\n    return None\n' }] }, 2);
  assert.equal(seed.ok, true); if (!seed.ok) return;
  applyRows(memory, seed.rows);
  const list = planNativeMemoryUpdate(memory, { op: 'list' }, 2);
  assert.equal(list.ok, true); if (!list.ok) return;
  assert.match(list.receipt, /- hyp\.two \[open\] ACTION1 changes two cells\n  check: not run yet\n  check source:\n    def check\(t\):\n        return None\n/);
});
