import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, levelRepeats, renderFacts, type LedgerRow } from '../demo/arc_thin_ledger.ts';

const row = (n: number, action: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  n, action, changed_cells: 0, level_changed: false, state: 'NOT_FINISHED', levels_completed: 0, ...extra });

test('a level of clicks that change nothing reads as counts, a streak, a stall and repeats', () => {
  const grid = [[1, 2], [3, 4]];
  const grids = new Map(Array.from({ length: 26 }, (_, n) => [n, grid] as [number, number[][]]));
  const rows = Array.from({ length: 25 }, (_, i) => row(i + 1, 'ACTION6', { x: 3, y: 4 }));
  assert.equal(renderFacts(buildLedger(rows, [], grids), { used: 25, maximum: 110, total_used: 25, total_maximum: null }), [
    "RUNTIME FACTS (counted from this level's record; data/ledger.md has more):",
    'ACTION BUDGET (a resource, not the goal): level 25 of 110 used, 85 left; run 25 used, limit unknown',
    'EFFORT on this level: 25 actions — ACTION6 25 (25 changed nothing); now ACTION6 ×25 in a row since #1; no new state for the last 24',
    'GOAL TESTS on this level (actions whose predict had level_changed=true or state WIN; text predictions are not counted): none',
    'REPEATS on this level: 24 action(s) gave the same result from the same state as an earlier one; latest #25 (as #22, #23, #24)',
  ].join('\n'));
});

test('a game where every action changes cells has no "changed nothing" count; its stall comes from the masked hashes', () => {
  // Cell (0,0) counts steps (masked as a ticker); the walker moves between two cells every second step.
  const grids = new Map<number, number[][]>();
  for (let n = 0; n <= 12; n++) {
    const at = Math.floor(n / 2) % 2;
    grids.set(n, [[n % 10, 0], [at ? 0 : 7, at ? 7 : 0]]);
  }
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, i % 2 ? 'ACTION2' : 'ACTION1', { changed_cells: 3 }));
  const text = renderFacts(buildLedger(rows, [], grids), undefined);
  assert.doesNotMatch(text, /changed nothing/);
  assert.match(text, /^ACTION BUDGET \(a resource, not the goal\): unknown$/m);
  assert.match(text, /^EFFORT on this level: 12 actions — ACTION1 6, ACTION2 6; no new state for the last 10$/m);
});

test('goal tests and the latest miss are listed by action number; what is not reported reads unknown', () => {
  const rows = [
    row(1, 'ACTION1', { changed_cells: 4, predict: { level_changed: true },
      prediction: { fields: [{ field: 'level_changed', hit: false, expected: 'true', observed: 'false' }] } }),
    row(2, 'ACTION2', { changed_cells: 4, predict: { state: 'WIN' }, prediction: { fields: [{ field: 'state', hit: null, expected: 'WIN' }] } }),
  ];
  const text = renderFacts(buildLedger(rows, [], new Map()), { used: 2, maximum: 10 });
  assert.match(text, /^GOAL TESTS on this level \(actions whose predict had level_changed=true or state WIN; text predictions are not counted\): #1 MISS, #2 unscored$/m);
  assert.match(text, /^LATEST MISS: #1 level_changed=true \(saw false\)$/m);
  assert.match(text, /level 2 of 10 used, 8 left; run unknown/);
  assert.match(renderFacts(buildLedger([], [], new Map()), {}), /level unknown; run unknown\nEFFORT on this level: no actions yet/);
});

test('repeats on a level count across attempts; a RESET is not compared', () => {
  const a = [[0, 1]], b = [[1, 0]];
  const grids = new Map<number, number[][]>([[0, a], [1, b], [2, a], [3, b]]);
  const rows = [row(1, 'ACTION1'), row(2, 'RESET'), row(3, 'ACTION1')];
  const repeats = levelRepeats(buildLedger(rows, [], grids).rows);
  assert.deepEqual(repeats.map((r) => [r.n, r.earlier]), [[3, [1]]]);
});

test('the block stays within 900 characters', () => {
  const rows = Array.from({ length: 300 }, (_, i) => row(i + 1, `ACTION${(i % 7) + 1}`, { predict: { level_changed: true },
    prediction: { fields: [{ field: 'cells', hit: false, expected: 'x'.repeat(200), observed: 'y'.repeat(200) },
      { field: 'level_changed', hit: false, expected: 'true', observed: 'false' }] } }));
  const text = renderFacts(buildLedger(rows, [], new Map()), { used: 300, maximum: 999999, total_used: 300, total_maximum: 999999 });
  assert.ok(text.length <= 900, String(text.length));
  assert.match(text, /^RUNTIME FACTS/);
});
