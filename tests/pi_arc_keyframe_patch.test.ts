import assert from "node:assert/strict";
import { test } from "node:test";
import { arcHexGrid, renderArcObservationWindow } from "../demo/pi_arc_observation_window.ts";
import { renderArcFrameImage } from "../demo/pi_arc_frame_image.ts";

type Grid = number[][];
const blank = (height = 64, width = height, color = 0): Grid =>
	Array.from({ length: height }, () => Array(width).fill(color));
const copy = (value: Grid): Grid => value.map(row => [...row]);
function animation(peak: Grid, final: Grid, index = 1) {
	return { event: "action", index, action: "ACTION1", state_before: "NOT_FINISHED", level_before: 0,
		observation_delta: { changed_cells: 0 },
		frame: { state: "NOT_FINISHED", levels_completed: 0, frames: [peak, final] } };
}
function block(text: string, label: string): string {
	const result = text.split("\n\n").find(value => value.startsWith(`Grid ${label} (`));
	assert.ok(result, `missing grid block ${label}`);
	return result;
}
function decodePatch(text: string, current: Grid): { grid: Grid; spans: Array<[number, number, string]> } {
	const [header, payload] = text.split("\n");
	assert.match(header, /relative to current_state_frame/);
	assert.match(header, /zero-based replacement spans \[y,x_start,hex_values\]/);
	assert.match(header, /unlisted cells unchanged/);
	const spans = JSON.parse(payload) as Array<[number, number, string]>;
	const result = copy(current);
	for (const [y, x, values] of spans) {
		assert.ok(Number.isInteger(y) && y >= 0 && y < result.length);
		assert.ok(Number.isInteger(x) && x >= 0 && x + values.length <= result[y].length);
		assert.match(values, /^[0-9a-f]+$/);
		for (const [offset, digit] of [...values].entries()) result[y][x + offset] = parseInt(digit, 16);
	}
	return { grid: result, spans };
}

test("sparse peak reconstructs all pixels and preserves full current grid and PNG order", () => {
	const current = blank(), peak = copy(current);
	for (let y = 32; y < 40; y++) for (let x = 32; x < 42; x++) peak[y][x] = 2;
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] }, { includeImages: true });
	const patch = block(view.text, "arc-action-1_frame_0");
	const decoded = decodePatch(patch, current);
	assert.deepEqual(decoded.grid, peak);
	assert.deepEqual(decoded.spans, Array.from({ length: 8 }, (_, i) => [32 + i, 32, "2222222222"]));
	assert.ok(patch.length < arcHexGrid(peak, "arc-action-1_frame_0").length);
	assert.equal(block(view.text, "current_state_frame"), arcHexGrid(current, "current_state_frame"));
	assert.match(view.text, /peak_changed=80, peak_frame_index=0/);
	assert.deepEqual(view.images.map(image => image.content),
		[peak, current].map(value => renderArcFrameImage({ frames: [value] }).content));
	assert.match(view.images[0].label, /^arc-action-1_frame_0\n/);
	assert.match(view.images[1].label, /^current_state_frame\n/);
});

test("row spans retain zero values and split only at unchanged pixels", () => {
	const current = blank(16, 16, 7), peak = copy(current);
	peak[0][0] = 0; peak[0][1] = 10; peak[0][3] = 15; peak[15][15] = 14;
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] });
	const decoded = decodePatch(block(view.text, "arc-action-1_frame_0"), current);
	assert.deepEqual(decoded.spans, [[0, 0, "0a"], [0, 3, "f"], [15, 15, "e"]]);
	assert.deepEqual(decoded.grid, peak);
	assert.deepEqual(view.images, []);
});

test("one changed corner pixel is reversible without a second read", () => {
	const current = blank(), peak = copy(current); peak[63][63] = 15;
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] });
	const decoded = decodePatch(block(view.text, "arc-action-1_frame_0"), current);
	assert.deepEqual(decoded.spans, [[63, 63, "f"]]);
	assert.deepEqual(decoded.grid, peak);
});

test("equal frames keep exact-duplicate handling and one current image", () => {
	const current = blank();
	const event = { ...animation(current, current), observation_delta: { changed_cells: 256 } };
	const view = renderArcObservationWindow([event], { frames: [current] }, { includeImages: true });
	assert.match(view.text, /Grid arc-action-1_frame_1: same exact pixels as current_state_frame/);
	assert.doesNotMatch(view.text, /replacement spans/);
	assert.equal(view.images.length, 1);
});

test("dense changes retain the full selected grid", () => {
	const current = blank(), peak = blank(64, 64, 15);
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] }, { includeImages: true });
	assert.equal(block(view.text, "arc-action-1_frame_0"), arcHexGrid(peak, "arc-action-1_frame_0"));
	assert.equal(view.images.length, 2);
});

test("dimension mismatch retains the full selected grid", () => {
	const current = blank(), peak = blank(8, 9, 2);
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] }, { includeImages: true });
	assert.equal(block(view.text, "arc-action-1_frame_0"), arcHexGrid(peak, "arc-action-1_frame_0"));
	assert.deepEqual(view.images.map(image => image.metadata.frame_size), [[8, 9], [64, 64]]);
});

test("small grids fall back when the complete patch text would be longer", () => {
	const current = [[0, 0], [0, 0]], peak = [[2, 0], [0, 0]];
	const view = renderArcObservationWindow([animation(peak, current)], { frames: [current] });
	assert.equal(block(view.text, "arc-action-1_frame_0"), arcHexGrid(peak, "arc-action-1_frame_0"));
});

test("equal complete patch and full-grid text lengths retain the full grid", () => {
	const label = "arc-action-1_frame_0";
	let found = false;
	for (let width = 100; width <= 256; width += 1) {
		const current = blank(1, width), peak = copy(current); peak[0][0] = 2;
		const emitted = block(renderArcObservationWindow([animation(peak, current)],
			{ frames: [current] }).text, label);
		if (!emitted.includes("relative to current_state_frame")) continue;
		assert.ok(emitted.length < arcHexGrid(peak, label).length);
		const previousCurrent = blank(1, width - 1), previousPeak = copy(previousCurrent);
		previousPeak[0][0] = 2;
		const previousFull = arcHexGrid(previousPeak, label);
		const samePatchAtPreviousWidth = emitted.replace(`(1x${width})`, `(1x${width - 1})`);
		assert.equal(samePatchAtPreviousWidth.length, previousFull.length);
		assert.equal(block(renderArcObservationWindow([animation(previousPeak, previousCurrent)],
			{ frames: [previousCurrent] }).text, label), previousFull);
		found = true;
		break;
	}
	assert.ok(found, "a complete patch/full-grid equality boundary must be exercised");
});

test("peak tie selection and duplicate keyframes preserve original labels and images", () => {
	const current = blank(), first = copy(current), other = copy(current);
	first[1][1] = 2; other[2][2] = 3;
	const event = animation(first, current);
	event.frame.frames = [first, other, current];
	const view = renderArcObservationWindow([event, animation(first, current, 2)],
		{ frames: [current] }, { includeImages: true });
	assert.deepEqual(decodePatch(block(view.text, "arc-action-1_frame_0"), current).grid, first);
	assert.match(view.text, /peak_frame_index=0/);
	assert.match(view.text, /Grid arc-action-2_frame_0: same exact pixels as arc-action-1_frame_0/);
	assert.doesNotMatch(view.text, /Grid arc-action-1_frame_1/);
	assert.equal(view.images.length, 2);
	assert.deepEqual(view.images.map(image => image.content),
		[first, current].map(value => renderArcFrameImage({ frames: [value] }).content));
});

test("action and grid limits keep existing selection and factual result lines", () => {
	const current = blank();
	const events = [1, 2, 3].map(index => { const peak = copy(current); peak[index][index] = index;
		return animation(peak, current, index); });
	const view = renderArcObservationWindow(events, { frames: [current] },
		{ maxDetailedActions: 2, maxKeyframeGrids: 1, includeImages: true });
	assert.equal(view.actionCount, 3);
	assert.match(view.text, /Earlier actions since last observation: 1/);
	assert.match(view.text, /ACTION\/RESULT arc-action-2/);
	assert.match(view.text, /ACTION\/RESULT arc-action-3/);
	assert.doesNotMatch(view.text, /Grid arc-action-2_frame/);
	assert.deepEqual(decodePatch(block(view.text, "arc-action-3_frame_0"), current).grid, events[2].frame.frames[0]);
	assert.equal(view.images.length, 2);
});

test("historical final, RESET, and level transitions re-encode against fresh current anchor", () => {
	const before = blank(), historical = copy(before), fresh = copy(before);
	historical[8][9] = 2; fresh[10][11] = 3;
	const historicalEvent = { ...animation(historical, historical), observation_delta: { changed_cells: 256 } };
	const reset = { ...animation(historical, before, 2), event: "forced_action", action: "RESET",
		frame: { state: "NOT_FINISHED", levels_completed: 1, frames: [historical, before] } };
	for (const anchor of [before, fresh]) {
		const view = renderArcObservationWindow([historicalEvent, reset], { frames: [anchor], levels_completed: 1 });
		assert.deepEqual(decodePatch(block(view.text, "arc-action-1_frame_1"), anchor).grid, historical);
		assert.match(view.text, /Grid forced-RESET_frame_0: same exact pixels as arc-action-1_frame_1/);
		assert.equal(block(view.text, "current_state_frame"), arcHexGrid(anchor, "current_state_frame"));
	}
});

test("unavailable and irregular grids retain existing boundary errors", () => {
	assert.throws(() => renderArcObservationWindow([], { frames: [] }), /current public ARC frame is unavailable/);
	assert.throws(() => renderArcObservationWindow([], { frames: [[[0], [0, 1]]] }), /ARC grid must be rectangular/);
	assert.throws(() => renderArcObservationWindow([
		{ event: "action", index: 1, observation_delta: { changed_cells: 256 },
			frame: { frames: [[[1], [1, 2]]] } },
	], { frames: [blank(2)] }), /ARC grid must be rectangular/);
});
