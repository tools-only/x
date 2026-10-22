import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePrediction, predictionSchema, renderScore, scorePrediction, type Grid } from "../demo/arc_thin_prediction.ts";
import { repairActionArguments } from "../demo/arc_thin_boundary.ts";

const blank = (width = 12, height = 10, fill = 0): Grid => Array.from({ length: height }, () => Array(width).fill(fill));
const paint = (grid: Grid, cells: Array<[number, number]>, value: number): Grid => {
	const out = grid.map((row) => row.slice());
	for (const [x, y] of cells) out[y][x] = value;
	return out;
};

test("each supplied field is checked against the observation the action returned", () => {
	const after = paint(blank(), [[3, 3], [4, 3]], 5);
	const score = scorePrediction({ cells: [[3, 3, 5], [4, 3, 5], [5, 3, 5]], level_changed: true, state: "playing" },
		{ after, level_changed: false, state: "PLAYING" });
	assert.deepEqual(score.fields.map((f) => [f.field, f.hit]), [["cells", false], ["level_changed", false], ["state", true]]);
	assert.deepEqual([score.hits, score.misses, score.unscorable], [1, 2, 0]);
	assert.equal(renderScore(score), "cells=3 predicted value(s) MISS (saw 2/3 right; (5,3)=0); level_changed=true MISS (saw false); state=playing ok");
	assert.equal(scorePrediction({ cells: [[3, 3, 5]] }, { after, level_changed: false, state: "PLAYING" }).hits, 1);
});

test("a field that cannot be compared is not scored as a miss", () => {
	const score = scorePrediction({ cells: [[99, 99, 1]], state: "WIN" }, { level_changed: false, state: "PLAYING" });
	assert.deepEqual([score.hits, score.misses, score.unscorable], [0, 1, 1]);
	assert.match(renderScore(score), /cells=1 predicted value\(s\) not scored \(no grid\); state=WIN MISS \(saw PLAYING\)/);
});

test("the runtime offers no cross-frame field: comparing frames is the agent's own tool", () => {
	// Only values readable from the returned observation are scored; change counts, unchanged cells and
	// region movement would need a frame comparison, which the project leaves to skills the agent writes.
	assert.deepEqual(Object.keys(predictionSchema().properties).sort(), ["cells", "hypothesis", "level_changed", "state", "text"]);
	assert.deepEqual(normalizePrediction({ changed_cells: 3, changed_cells_range: [1, 4], unchanged: [[0, 0]], moved: { dx: 1, dy: 0 }, cells: [[1, 2, 3]] }),
		{ cells: [[1, 2, 3]] });
	assert.equal(normalizePrediction({ moved: { dx: 1, dy: 0 }, changed_cells: 5 }), undefined);
});

test("a prediction keeps its well-formed fields; a malformed one never rejects the action", () => {
	assert.deepEqual(normalizePrediction({ cells: [[1, 2, 3], [1, 2], "x", [-1, 0, 2]], level_changed: "yes", state: " WIN ", extra: 1 }),
		{ cells: [[1, 2, 3]], state: "WIN" });
	// Models send nested values as JSON strings.
	assert.deepEqual(normalizePrediction(JSON.stringify({ cells: "[[5,5,2]]", level_changed: false })), { cells: [[5, 5, 2]], level_changed: false });
	// A frame-diff skill may return [x,y,before,after]; the boundary keeps the
	// post-action value without making the runtime compute the diff.
	assert.deepEqual(normalizePrediction({ cells: [[5, 5, 1, 2], [6, 5, 0, 3]] }), { cells: [[5, 5, 2], [6, 5, 3]] });
	assert.equal(normalizePrediction(["the block moves right"]), undefined);
	assert.equal(normalizePrediction([1, 2]), undefined);

	assert.deepEqual(repairActionArguments({ action: "ACTION1", note: "n", predict: "", predict_skill: 7 }), { action: "ACTION1", note: "n" });
	assert.deepEqual(repairActionArguments({ action: "ACTION1", predict: { cells: [[1, 1, 4]], bogus: true }, predict_skill: " step " }),
		{ action: "ACTION1", predict: { cells: [[1, 1, 4]] }, predict_skill: "step" });
});

test("one prediction surface: words go in predict.text, are kept unchecked, and the old expect field folds into it", () => {
	// Words alone are a prediction in words, not a malformed one.
	assert.deepEqual(normalizePrediction("the block   moves right"), { text: "the block moves right" });
	assert.deepEqual(normalizePrediction({ text: "x".repeat(400), state: "WIN" })?.text?.length, 300);
	assert.deepEqual(repairActionArguments({ action: "ACTION1", predict: "it moves" }), { action: "ACTION1", predict: { text: "it moves" } });
	// expect (the former ledger field) becomes predict.text; a text already in predict wins, checked fields stay.
	assert.deepEqual(repairActionArguments({ action: "ACTION1", expect: " bar shrinks ", predict: { cells: [[1, 1, 4]] } }),
		{ action: "ACTION1", predict: { cells: [[1, 1, 4]], text: "bar shrinks" } });
	assert.deepEqual(repairActionArguments({ action: "ACTION1", expect: "a", predict: { text: "b" } }), { action: "ACTION1", predict: { text: "b" } });
	assert.deepEqual(repairActionArguments({ action: "ACTION1", expect: "" }), { action: "ACTION1" });
	// Text is not scored: a text-only prediction has no checked fields.
	assert.equal(scorePrediction({ text: "it moves" }, { after: blank(), level_changed: false, state: "PLAYING" }).fields.length, 0);
});

test("an action prediction can bind to the current hypothesis it is testing", () => {
	assert.deepEqual(normalizePrediction({ hypothesis: "hyp.touch", text: "crossing the target should win", level_changed: true }),
		{ hypothesis: "hyp.touch", text: "crossing the target should win", level_changed: true });
});
