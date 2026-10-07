import assert from "node:assert/strict";
import { arcHexGrid, renderArcObservationWindow } from "../demo/pi_arc_observation_window.ts";

const before = [[0, 10], [15, 1]];
const flash = [[2, 10], [15, 1]];
assert.equal(arcHexGrid(before, "current_state_frame"),
	"Grid current_state_frame (2x2) [hex 0-f = color 0-15]:\n0a\nf1");

const transient = {
	event: "action", index: 3, action: "ACTION1", state_before: "NOT_FINISHED", level_before: 0,
	observation_delta: { changed_cells: 0 },
	frame: { state: "NOT_FINISHED", levels_completed: 0, frames: [flash, before] },
};
const changed = {
	event: "action", index: 4, action: "ACTION2", state_before: "NOT_FINISHED", level_before: 0,
	observation_delta: { changed_cells: 1 },
	frame: { state: "NOT_FINISHED", levels_completed: 0, frames: [flash] },
};
const window = renderArcObservationWindow([transient, changed], { frames: [flash] }, { includeImages: true });
assert.equal(window.actionCount, 2);
assert.match(window.text, /arc-action-3.*final_grid_changed=false; transient_animation=true/);
assert.match(window.text, /ANIMATION SUMMARY arc-action-3: frame_count=2.*peak_changed=1/);
assert.match(window.text, /Grid arc-action-3_frame_0: same exact pixels as current_state_frame/);
assert.match(window.text, /arc-action-4.*final_grid_changed=true/);
assert.match(window.text, /Grid current_state_frame.*\n2a\nf1/s);
assert.equal(window.images.length, 1);
assert.ok(window.images.every((item) => item.content.mimeType === "image/png"));

const recent = renderArcObservationWindow([transient, changed], { frames: [flash] }, { maxKeyframeGrids: 1 });
assert.doesNotMatch(recent.text, /Grid arc-action-3_frame/);
assert.match(recent.text, /Grid arc-action-4_frame/);
assert.match(recent.text, /ACTION\/RESULT arc-action-3/);
