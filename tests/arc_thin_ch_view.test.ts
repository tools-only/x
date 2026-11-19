/**
 * The Continual Harness port (demo/arc_thin_ch_view.ts) against Continual Harness's own renderers: the goldens in
 * tests/fixtures/ch_golden.json were produced by CH's code (tools/ch_golden.py) from the same inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildObservationSection, computeGridDelta, currentStateBlock, gridPng, prettyPrintGrid, renderRecentHistory, summarizeGridTransitions,
  validateActionSequence, gridFactsText } from '../demo/arc_thin_ch_view.ts';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ch_golden.json', import.meta.url), 'utf8'));

test('CH observation baseline stays intact while one distinct intermediate frame supplements a repeated final frame', () => {
  const full = buildObservationSection(golden.observations.inputs);
  assert.deepEqual(full.grids.map((g) => g.label), [...golden.observations.labels.slice(0, -1), 'action_step_5_frame_0', golden.observations.labels.at(-1)]);
  const originalFlag = (text: string) => text.replace(/final_grid_changed=(yes|no); intermediate_frames_changed=(yes|no)/g,
    (_: string, final: string, intermediate: string) => `final_grid_changed=${final}; transient_animation=${final === 'yes' ? 'no' : intermediate}`);
  const extra = prettyPrintGrid(golden.observations.inputs.at(-1).animation[0], 'action_step_5_frame_0');
  assert.equal(originalFlag(full.text).replace(`RENDERED GRIDS: frame indices [0, 1]\n${extra}\nGrid action_step_5_frame_1`,
    'RENDERED GRIDS: frame indices [1]\nGrid action_step_5_frame_1'), golden.observations.text);
  const tight = buildObservationSection(golden.observations.inputs, 1);
  assert.equal(originalFlag(tight.text), golden.observations.budget1_text);
  assert.deepEqual(tight.grids.map((g) => g.label), golden.observations.budget1_labels);
});

test('a final result keeps its frame and gains only one distinct intermediate frame when it is also the current grid', () => {
  const pre = [[0, 0], [0, 0]], first = [[1, 0], [0, 0]], moving = [[0, 1], [0, 0]], final = [[0, 0], [0, 2]];
  const observation = { step: 1, action: 'ACTION1', source: 'arc_action', preState: 'PLAYING', preScore: 0,
    postState: 'PLAYING', postScore: 0, preGrid: pre, animation: [first, moving, final], validFrame: true };
  const selected = buildObservationSection([observation], 1);
  assert.deepEqual(selected.grids.map((g) => g.label), ['action_step_1_frame_1', 'action_step_1_frame_2']);
  assert.deepEqual(selected.grids.at(-1)?.grid, final);
  assert.match(selected.text, /intermediate_frames_changed=yes[\s\S]*RENDERED GRIDS: frame indices \[1, 2\]/);
  assert.equal(buildObservationSection([observation], 0).grids.length, 0);
  const withoutMotion = buildObservationSection([{ ...observation, animation: [pre, final] }], 1);
  assert.deepEqual(withoutMotion.grids.map((g) => g.label), ['action_step_1_frame_1']);
  const changedCurrent = buildObservationSection([observation], 1, [[9, 9], [9, 9]]);
  assert.deepEqual(changedCurrent.grids.map((g) => g.label), ['action_step_1_frame_2']);
  const twoActions = buildObservationSection([observation, { ...observation, step: 2 }], 2);
  assert.deepEqual(twoActions.grids.map((g) => g.label),
    ['action_step_1_frame_2', 'action_step_2_frame_1', 'action_step_2_frame_2']);
});

test('RECENT HISTORY matches CH: levels cleared, attempt summaries, run-length loops, elision under the character cap', () => {
  assert.equal(renderRecentHistory(golden.history.inputs, 12000), golden.history.text);
  assert.equal(renderRecentHistory(golden.history.inputs, 150), golden.history.short);
});

test('CURRENT STATE matches CH: action meanings, ACTION6 asks for x and y, the grid as a hex map; RESET is listed when offered', () => {
  const { grid, actions, levels, text } = golden.state;
  assert.equal(currentStateBlock('NOT_FINISHED', levels, actions.filter((a: string) => a !== 'RESET'), grid), text);
  // CH never lists RESET (its harness plays it); here it is the agent's action.
  assert.equal(currentStateBlock('NOT_FINISHED', levels, actions, grid),
    text.replace('available actions: \n', 'available actions: \n  RESET: Start or restart a game. Must be called first when NOT_PLAYED or after GAME_OVER to play again.\n'));
});

test('grid facts provide compact per-color counts and extents without implying object segmentation', () => {
  assert.equal(gridFactsText([[0, 9, 9], [1, 1, 0]]),
    '## GRID FACTS\nPer-color cell counts and extents (one extent may contain disconnected cells): 0:n2,x0-2,y0-1; 1:n2,x0-1,y1-1; 9:n2,x1-2,y0-0');
  assert.equal(gridFactsText(undefined), '');
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

test('an action list is cut at its first bad entry; RESET is an action when offered; ACTION6 needs x and y', () => {
  const offered = ['ACTION1', 'ACTION6'];
  const ok = validateActionSequence([{ name: 'action1' }, { name: 'ACTION6', x: 70, y: '3' }, { name: 'RESET' }, { name: 'ACTION1' }], offered);
  assert.deepEqual(ok.steps.map(({ action, x, y, position }) => ({ action, x, y, position })),
    [{ action: 'ACTION1', x: undefined, y: undefined, position: 1 }, { action: 'ACTION6', x: 63, y: 3, position: 2 }]);
  assert.deepEqual(ok.rejected.map(({ position, reason }) => [position, reason.split(' /')[0]]), [[3, 'unknown action name']], 'RESET not offered');
  assert.deepEqual(validateActionSequence([{ name: 'RESET' }], ['RESET', ...offered]).steps.map((s) => s.action), ['RESET']);
  assert.equal(validateActionSequence([{ name: 'ACTION6' }], offered).steps.length, 0, 'CH would click (0,0); here it is refused');
  assert.deepEqual(validateActionSequence('ACTION1', offered).rejected, [{ raw: 'ACTION1', reason: 'actions must be a list', position: 0 }]);
  assert.deepEqual(validateActionSequence([{ x: 1 }], offered).rejected[0].reason, "missing 'name' field");
});
