/**
 * The Continual Harness port (demo/arc_thin_ch_view.ts) against Continual Harness's own renderers: the goldens in
 * tests/fixtures/ch_golden.json were produced by CH's code (tools/ch_golden.py) from the same inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildObservationSection, computeGridDelta, currentStateBlock, formatToolResults, gridPng, pyDumps, renderRecentHistory,
  summarizeGridTransitions, validateActionSequence } from '../demo/arc_thin_ch_view.ts';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ch_golden.json', import.meta.url), 'utf8'));

test('OBSERVATIONS SINCE LAST QUERY matches CH line for line, with the same key frames under the 4-grid and a 1-grid budget', () => {
  const full = buildObservationSection(golden.observations.inputs);
  assert.equal(full.text, golden.observations.text);
  assert.deepEqual(full.grids.map((g) => g.label), golden.observations.labels);
  const tight = buildObservationSection(golden.observations.inputs, 1);
  assert.equal(tight.text, golden.observations.budget1_text);
  assert.deepEqual(tight.grids.map((g) => g.label), golden.observations.budget1_labels);
});

test('RECENT HISTORY matches CH: levels cleared, attempt summaries, run-length loops, elision under the character cap', () => {
  assert.equal(renderRecentHistory(golden.history.inputs, 12000), golden.history.text);
  assert.equal(renderRecentHistory(golden.history.inputs, 150), golden.history.short);
});

test('TOOL RESULTS FROM PREVIOUS TURN matches CH: recap, identical-output pointer, lifted code, Python JSON', () => {
  assert.equal(formatToolResults(golden.tool_results.inputs), golden.tool_results.text);
  assert.equal(formatToolResults(golden.tool_results.inputs.slice(0, 2)), golden.tool_results.two);
  for (const { value, plain, indent } of golden.dumps) {
    assert.equal(pyDumps(value), plain);
    assert.equal(pyDumps(value, { indent: 2 }), indent);
  }
});

test('CURRENT STATE matches CH: RESET never listed, ACTION6 asks for x and y, the grid as a hex map', () => {
  const { grid, actions, levels, text } = golden.state;
  assert.equal(currentStateBlock('NOT_FINISHED', levels, actions, grid), text);
});

test('step records keep CH grid_change and grid_delta; the PNG has CH palette pixels', () => {
  const { pre, post, change, delta } = golden.transitions;
  assert.deepEqual(summarizeGridTransitions(pre, post), change);
  assert.deepEqual(computeGridDelta(pre, post), delta);
  const png = gridPng(golden.image.grid);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], golden.image.size);
  const idat = png.subarray(33 + 8, png.length - 12 - 4);
  const raw = inflateSync(idat), width = golden.image.size[0];
  const rgba = Buffer.concat(Array.from({ length: golden.image.size[1] }, (_, y) => raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4))));
  assert.equal(rgba.toString('base64'), golden.image.rgba);
});

test('an action list is truncated at its first bad entry; RESET is never an agent action; ACTION6 needs x and y', () => {
  const offered = ['RESET', 'ACTION1', 'ACTION6'];
  const ok = validateActionSequence([{ name: 'action1' }, { name: 'ACTION6', x: 70, y: '3' }, { name: 'RESET' }, { name: 'ACTION1' }], offered);
  assert.deepEqual(ok.steps.map(({ action, x, y, position }) => ({ action, x, y, position })),
    [{ action: 'ACTION1', x: undefined, y: undefined, position: 1 }, { action: 'ACTION6', x: 63, y: 3, position: 2 }]);
  assert.deepEqual(ok.rejected.map(({ position, reason }) => [position, reason.split(' /')[0]]), [[3, 'unknown action name']]);
  assert.equal(validateActionSequence([{ name: 'ACTION6' }], offered).steps.length, 0, 'CH would click (0,0); here it is refused');
  assert.deepEqual(validateActionSequence('ACTION1', offered).rejected, [{ raw: 'ACTION1', reason: 'actions must be a list', position: 0 }]);
  assert.deepEqual(validateActionSequence([{ x: 1 }], offered).rejected[0].reason, "missing 'name' field");
  assert.equal(validateActionSequence([{ name: 'ACTION2' }], []).steps[0].action, 'ACTION2', 'nothing offered: every action but RESET');
});
