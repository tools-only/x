import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYST_SYSTEM, analystInputs, analystMessage, analystReceipt } from "../demo/arc_thin_analyst.ts";

// The 2026-10-10 ls20 question that got the current grid described as the starting grid.
const HISTORY_QUESTION = "Using state['history'], examine the FIRST grid (history.grid(0), the starting state). Where was the color-11 region initially?";

test("the analyst is told what it sees and that it sees nothing else", () => {
	assert.match(ANALYST_SYSTEM, /You see only the inputs listed under INPUTS/);
	assert.match(ANALYST_SYSTEM, /say first which input is missing/);
	assert.match(ANALYST_SYSTEM, /Never present a given grid as a different one/);
	const text = analystMessage({ question: HISTORY_QUESTION, current: "r0: c0-63=4", actions: 43 });
	assert.match(text, /^INPUTS: the current grid \(after action #43\)\. Nothing else from this run is visible to you\.\n\nQUESTION: /);
	assert.match(text, /\n\nCURRENT GRID \(after action #43\)\nr0: c0-63=4$/);
	assert.doesNotMatch(text, /PREVIOUS GRID|MEMORY/);
});

test("optional inputs are named when included, and the receipt repeats them", () => {
	const inputs = { question: "q", current: "cur", actions: 7, previous: "prev", memory: "MEMORY (1): ..." };
	assert.equal(analystInputs(inputs), "the current grid (after action #7), the grid before action #7, the agent's memory");
	const text = analystMessage(inputs);
	assert.match(text, /PREVIOUS GRID \(before action #7\)\nprev\n\nMEMORY \(1\): \.\.\.$/);
	assert.equal(analystReceipt("answer", inputs),
		"answer\n\n(analyst saw only: the current grid (after action #7), the grid before action #7, the agent's memory)");
	// Asked for the previous grid before any action: said so, and not listed as an input.
	const first = { question: "q", current: "cur", actions: 0, previous: null };
	assert.equal(analystInputs(first), "the current grid (before any action)");
	assert.match(analystMessage(first), /PREVIOUS GRID: none yet\.$/);
});
