import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, changeOnLines, maskedHashes, meterLines, progressAt, renderFacts, type LedgerRow } from '../demo/arc_thin_ledger.ts';

// Synthetic toy boards only (no grid is copied from a game): 10x10, a static object at (2,2) and an empty bottom row.
const start = () => {
  const grid = Array.from({ length: 10 }, () => Array(10).fill(0));
  grid[2][2] = 3;
  return grid;
};
const clone = (grid: number[][]) => grid.map((row) => [...row]);
type Step = { action: string; x?: number; y?: number; edit?: (grid: number[][]) => void };

/** Plays the steps from a board; each step edits a copy of the state before it. */
function play(first: number[][], steps: Step[]) {
  const grids = new Map<number, number[][]>([[0, first]]);
  const rows: LedgerRow[] = [];
  steps.forEach((step, i) => {
    const before = grids.get(i)!, after = clone(before);
    step.edit?.(after);
    const changed = before.flatMap((row, y) => row.filter((cell, x) => cell !== after[y][x])).length;
    grids.set(i + 1, after);
    rows.push({ n: i + 1, action: step.action, ...(step.x !== undefined ? { x: step.x, y: step.y } : {}),
      changed_cells: changed, level_changed: false, state: 'NOT_FINISHED', levels_completed: 0 });
  });
  return { rows, grids };
}
/** The bottom row fills two cells from the right on every action that does anything. */
const fill = (grid: number[][]) => {
  const filled = grid[9].filter((cell) => cell === 5).length;
  grid[9][9 - filled] = 5; grid[9][8 - filled] = 5;
};
const move = (from: [number, number], to: [number, number]) => (grid: number[][]) => {
  grid[from[1]][from[0]] = 0; grid[to[1]][to[0]] = 3; fill(grid);
};
// Clicks anywhere advance the bar; one click lands where nothing happens.
const clicks: Step[] = [
  { action: 'ACTION6', x: 5, y: 5, edit: fill },
  { action: 'ACTION6', x: 1, y: 1 },
  { action: 'ACTION6', x: 2, y: 2, edit: fill },
  { action: 'ACTION6', x: 7, y: 3, edit: fill },
  { action: 'ACTION6', x: 2, y: 2, edit: fill },
];

test('a row that fills a few new cells on every action, whatever was clicked, is a meter line', () => {
  const { rows, grids } = play(start(), clicks);
  assert.deepEqual(meterLines(rows, grids), [{ axis: 'row', index: 9, length: 10, since: 1, changing: 4, hits: 4, min: 2, max: 2,
    again: false, differs: 8 }]);
  // Three changing actions are not enough to tell it from an effect.
  assert.deepEqual(meterLines(rows.slice(0, 4), grids), []);
});

test('one action repeated is a meter line only when it changes nothing but the line', () => {
  // su15-r6 (2026-10-16): 32 clicks on one cell changed only the bottom row, and no line was found.
  const same = play(start(), Array.from({ length: 5 }, () => ({ action: 'ACTION6', x: 5, y: 5, edit: fill })));
  assert.deepEqual(meterLines(same.rows, same.grids), [{ axis: 'row', index: 9, length: 10, since: 1, changing: 5, hits: 5, min: 2, max: 2,
    again: false, differs: 10 }]);
  assert.deepEqual(progressAt(same.rows, same.grids, 5), { progress: false,
    why: '#5 changed only cells that change on (nearly) every action (row 9); outside them the board has not changed on this level' });
  // The same press that also moves an object could be filling the row itself: no line until another action fills it too.
  const walker = start();
  walker[4][2] = 3;
  const moving = play(walker, [2, 3, 4, 5, 6].map((x) => ({ action: 'ACTION4', edit: (grid: number[][]) => {
    grid[4][x] = 0; grid[4][x + 1] = 3; fill(grid);
  } })));
  assert.deepEqual(meterLines(moving.rows, moving.grids), []);
});

test('a change is split by the meter lines known by then: the count on them, the count and box of the rest', () => {
  const { rows, grids } = play(start(), [...clicks,
    { action: 'ACTION1', edit: move([2, 2], [3, 2]) },
  ]);
  // Before the line is known there is nothing to split.
  assert.equal(changeOnLines(rows, grids, 3), undefined);
  assert.deepEqual(changeOnLines(rows, grids, 5), { lines: ['row 9'], on: 2, rest: 0 });
  assert.deepEqual(changeOnLines(rows, grids, 6), { lines: ['row 9'], on: 2, rest: 2, box: { left: 2, right: 3, top: 2, bottom: 2 } });
  // An action that changed none of a line's cells is reported as the bridge reports it.
  const quiet = play(start(), [...clicks, { action: 'ACTION1', edit: (grid) => { grid[2][2] = 0; grid[2][3] = 3; } }]);
  assert.equal(changeOnLines(quiet.rows, quiet.grids, 6), undefined);
});

test('clicks are counted by distance from the nearest cell that is neither background nor recurring', () => {
  const { rows, grids } = play(start(), [...clicks, { action: 'ACTION6', x: 3, y: 2, edit: move([2, 2], [3, 2]) }]);
  const state = buildLedger(rows, [], grids, { lines: true, clicks: true });
  // (2,2) twice on the object, (1,1) and (3,2) next to it, (5,5) 3 away, (7,3) 5 away; only (3,2) moved anything besides the row.
  assert.deepEqual(state.clicks, [{ clicks: 2, changed: 0 }, { clicks: 2, changed: 1 }, { clicks: 1, changed: 0 }, { clicks: 1, changed: 0 }, { clicks: 0, changed: 0 }]);
  assert.match(renderFacts(state, null, 1200), /\nCLICKS on this level by distance from the nearest cell that is not background or recurring \(in cells; how many changed the board besides recurring cells\): on it 2 \(0 changed\), next to it 2 \(1 changed\), 2-3 away 1 \(0 changed\), 4-7 away 1 \(0 changed\), 8\+ away 0(\n|$)/);
  assert.equal(buildLedger(rows, [], grids, { lines: true }).clicks, undefined);
  assert.doesNotMatch(renderFacts(buildLedger(rows.slice(0, 4), [], grids, { lines: true, clicks: true }), null), /CLICKS/, 'fewer than 5 clicks: no line');
});

test('an object moved by one action, clicks that paint the clicked row, and a cell changed twice are not meter lines', () => {
  const walker = start();
  walker[4][2] = 3;
  const walk = play(walker, [2, 3, 4, 5, 6].map((x) => ({ action: 'ACTION4', edit: (grid: number[][]) => {
    grid[4][x] = 0; grid[4][x + 1] = 3;
  } })));
  assert.deepEqual(meterLines(walk.rows, walk.grids), []);
  const paint = play(start(), [1, 2, 3, 4, 5].map((x) => ({ action: 'ACTION6', x, y: 4, edit: (grid: number[][]) => { grid[4][x] = 7; } })));
  assert.deepEqual(meterLines(paint.rows, paint.grids), []);
  const toggle = play(start(), ['ACTION1', 'ACTION2', 'ACTION1', 'ACTION2'].map((action, i) => ({ action, edit: (grid: number[][]) => {
    grid[6][4] = i % 2 ? 0 : 8;
  } })));
  assert.deepEqual(meterLines(toggle.rows, toggle.grids), []);
});

test('progress: nothing changed, only the meter changed, or the batch came back to where it started', () => {
  const { rows, grids } = play(start(), [...clicks,
    { action: 'RESET', edit: (grid) => { grid.splice(0, grid.length, ...start()); } },
    { action: 'ACTION1', edit: move([2, 2], [3, 2]) },
    { action: 'ACTION2', edit: move([3, 2], [2, 2]) },
  ]);
  assert.deepEqual(progressAt(rows, grids, 2), { progress: false, why: '#2 changed nothing; outside recurring cells the board has not changed since #1' });
  // Before the line is known a fill is new; once it is, the same kind of fill is not.
  assert.deepEqual(progressAt(rows, grids, 3), { progress: true });
  assert.deepEqual(progressAt(rows, grids, 5), { progress: false,
    why: '#5 changed only cells that change on (nearly) every action (row 9); outside them the board has not changed on this level' });
  assert.deepEqual(progressAt(rows, grids, 6), { progress: true });
  assert.deepEqual(progressAt(rows, grids, 7), { progress: true });
  // There and back: a batch that started after the RESET is back where it started; an older state is no stop.
  assert.deepEqual(progressAt(rows, grids, 8, true, 6), { progress: false, why: '#8 brought back the state this batch started from' });
  assert.deepEqual(progressAt(rows, grids, 8), { progress: true });
  assert.deepEqual(progressAt(rows, grids, 8, true, 7), { progress: true });
  // Without lines only no change at all, or a return to the batch's start, stops it.
  assert.deepEqual(progressAt(rows, grids, 5, false), { progress: true });
});

test('the facts count actions that changed only recurring cells apart and say which line is left out', () => {
  const { rows, grids } = play(start(), clicks);
  const facts = renderFacts(buildLedger(rows, [], grids, { lines: true }), null);
  assert.match(facts, /EFFORT on this level: 5 actions — ACTION6 5 \(1 changed nothing, 4 only recurring cells\); now ACTION6 ×5 in a row since #1; no new state for the last 4/);
  assert.match(facts, /RECURRING CHANGE \(left out of the changed-nothing, stall and repeat counts\): row 9 changed on 4 of the 4 non-RESET actions that changed anything since #1, 2 cells each, each cell once; 8 of its 10 cells differ from this attempt's start/);
  assert.match(facts, /REPEATS on this level: 1 action\(s\) gave the same result from the same state as an earlier one; latest #5 \(as #3\)/);
});

test('with meter lines off the ledger is the per-cell ticker ledger of 2026-10-15', () => {
  const { rows, grids } = play(start(), clicks);
  const state = buildLedger(rows, [], grids);
  assert.equal(state.lines_on, false);
  assert.deepEqual(state.lines, []);
  const { hash } = maskedHashes(grids);
  assert.deepEqual(state.rows.map((row) => [row.before_hash, row.after_hash]), rows.map((row) => [hash.get(row.n - 1), hash.get(row.n)]));
  const facts = renderFacts(state, null);
  assert.doesNotMatch(facts, /RECURRING|only recurring/);
  assert.match(facts, /ACTION6 5 \(1 changed nothing\)/);
});
