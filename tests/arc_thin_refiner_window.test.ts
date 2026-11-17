/** The refinement's decision window (ARC_REFINE_WINDOW, 2026-11-17): rendering, clipping and the drop-oldest cap. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDecisionWindow, WINDOW_CODE_CHARS, WINDOW_REASONING_CHARS, WINDOW_RESULT_CHARS, type WindowBlock } from '../demo/arc_thin_refiner.ts';

const block = (over: Partial<WindowBlock>): WindowBlock => ({ decision: 1, from: 0, to: 0, rows: [], python: [], ...over });

test('a decision block carries what the agent said, its python calls with results, and its move rows', () => {
  const text = renderDecisionWindow([block({
    decision: 7, from: 2, to: 5, reasoning: 'the door moved after ACTION2',
    python: [
      { id: 1, ok: true, code: 'print(grid[3][4])', result: '9' },
      { id: 2, ok: false, code: 'boom()' },
      { id: 3, same: 1, code: 'print(grid[3][4])' },
      { id: 4, ok: true, acted: true, code: "env.act('ACTION2')", result: 'changed 3 cells' },
    ],
    rows: ['#3 ACTION2 → 3 cells', '#4 ACTION1 → 0 cells', '#5 ACTION2 → 3 cells'],
  })], 10_000);
  const lines = text.split('\n');
  assert.equal(lines[0], '[decision 7 | moves #3–#5]');
  assert.equal(lines[1], 'reasoning: the door moved after ACTION2');
  assert.equal(lines[2], 'P1:');
  assert.equal(lines[3], 'print(grid[3][4])');
  assert.equal(lines[4], '→ 9');
  assert.equal(lines[5], 'P2 (failed):');
  assert.equal(lines[6], 'boom()');
  assert.equal(lines[7], 'P3 = P1: same code on the same state, not run again');
  assert.equal(lines[8], 'P4 (acted):');
  assert.equal(lines[10], '→ changed 3 cells');
  assert.deepEqual(lines.slice(-3), ['#3 ACTION2 → 3 cells', '#4 ACTION1 → 0 cells', '#5 ACTION2 → 3 cells']);
});

test('a review or unfinished decision without moves says so in its header', () => {
  const text = renderDecisionWindow([block({ decision: 9, from: 5, to: 5, review: true, reasoning: 'rewrote the review' }),
    block({ decision: 10, from: 5, to: 6, ongoing: true, rows: ['#6 ACTION1 → 1 cell'] })], 10_000);
  assert.match(text, /^\[decision 9 \| no move \| review\]\nreasoning: rewrote the review/);
  assert.match(text, /\n\n\[decision 10 \| moves #6–#6 \| not finished yet\]\n#6 ACTION1 → 1 cell$/);
});

test('reasoning keeps its end, code and results their start, under their caps', () => {
  const text = renderDecisionWindow([block({
    decision: 2, from: 0, to: 1, reasoning: 'a'.repeat(100) + 'b'.repeat(WINDOW_REASONING_CHARS),
    python: [{ id: 1, ok: true, code: 'c'.repeat(WINDOW_CODE_CHARS + 100), result: 'r'.repeat(WINDOW_RESULT_CHARS + 100) }],
    rows: ['#1 ACTION1 → 0 cells'],
  })], 100_000);
  const lines = text.split('\n');
  assert.equal(lines[1], 'reasoning: …' + 'b'.repeat(WINDOW_REASONING_CHARS), 'the end of the reasoning is kept: conclusions come last');
  assert.equal(lines[3], 'c'.repeat(WINDOW_CODE_CHARS - 1) + '…');
  assert.equal(lines[4], '→ ' + 'r'.repeat(WINDOW_RESULT_CHARS - 1) + '…');
});

test('oldest decisions are dropped first to fit the cap, and the gap is named with its action count', () => {
  const blocks = [
    block({ decision: 1, from: 0, to: 2, reasoning: 'x'.repeat(300), rows: ['#1 r', '#2 r'] }),
    block({ decision: 2, from: 2, to: 4, reasoning: 'y'.repeat(300), rows: ['#3 r', '#4 r'] }),
    block({ decision: 3, from: 4, to: 6, reasoning: 'z'.repeat(300), rows: ['#5 r', '#6 r'] }),
  ];
  const all = renderDecisionWindow(blocks, 10_000);
  assert.match(all, /\[decision 1 \|/);
  assert.doesNotMatch(all, /not shown/);
  const capped = renderDecisionWindow(blocks, 400);
  assert.equal(capped.split('\n')[0], '(2 earlier decision(s), moves up to #4, not shown)');
  assert.doesNotMatch(capped, /\[decision 1 \|/);
  assert.doesNotMatch(capped, /\[decision 2 \|/);
  assert.match(capped, /\[decision 3 \| moves #5–#6\]/);
  // The newest decision is always kept, even alone over the cap.
  const tiny = renderDecisionWindow(blocks, 10);
  assert.match(tiny, /\[decision 3 \|/);
  assert.equal(renderDecisionWindow([], 1000), '(none yet)');
});
