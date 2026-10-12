import assert from "node:assert/strict";
import { test } from "node:test";
import { claimSegments, claimVersion, levelOf, renderClaimSummary, summarizeClaim, type ClaimRow } from "../demo/arc_thin_claims.ts";

const grid = (value: number, size = 4) => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x === value && y === 1 ? 9 : 0)));
const row = (n: number, result: ClaimRow["result"], level = 0): ClaimRow => ({ key: "hyp.a", version: "v", n, level, result });

test("segments carry the grid before each run of consecutive transitions, then cell changes; gaps and shape changes restart", () => {
	const grids = new Map<number, number[][]>([[0, grid(0)], [1, grid(1)], [2, grid(2)], [4, grid(3)], [5, grid(0, 5)]]);
	const { batches, missing } = claimSegments([1, 2, 3, 4, 5], grids);
	assert.deepEqual(missing, [3, 4]);
	const segments = batches.flat();
	assert.deepEqual(segments.map((s) => s.start), [1, 5]);
	assert.deepEqual(segments[0].steps.map((s) => [s.n, s.grid ? "grid" : "delta"]), [[1, "grid"], [2, "delta"]]);
	assert.deepEqual(segments[0].steps[1].delta, [[1, 1, 9, 0], [2, 1, 0, 9]]);
	// Transition 5 has its own segment: grid 4 before it, a 5x5 grid after it.
	assert.equal(segments[1].grid, grids.get(4));
	assert.equal(segments[1].steps[0].grid!.length, 5);
	// A small budget splits batches without losing transitions.
	const split = claimSegments([1, 2], grids, 10);
	assert.equal(split.batches.length, 2);
	assert.deepEqual(split.batches.flat().flatMap((s) => s.steps.map((step) => step.n)), [1, 2]);
});

test("the summary counts holds, fails with their action numbers, not-applicable and errors, and splits off the current level", () => {
	const rows = [row(1, true), row(2, null), row(3, false), row(4, "error"), row(5, true, 1), row(6, false, 1)];
	rows[3].error = "ZeroDivisionError: division by zero";
	const summary = summarizeClaim(rows, 1);
	assert.deepEqual({ holds: summary.holds, fails: summary.fails, na: summary.na, errors: summary.errors, failing: summary.failing },
		{ holds: 2, fails: 2, na: 1, errors: 1, failing: [3, 6] });
	assert.deepEqual(summary.level, { level: 1, holds: 1, fails: 1, na: 0, errors: 0, failing: [6] });
	assert.equal(renderClaimSummary(summary),
		"check on 6 recorded move(s): holds 2 · fails 2 (#3, #6) · n/a 1 · errors 1 | on level 2: holds 1 · fails 1 (#6) · first error: ZeroDivisionError: division by zero");
	// No level split while every result is on one level.
	assert.equal(summarizeClaim([row(1, true)], 0).level, undefined);
	assert.equal(renderClaimSummary(summarizeClaim([row(1, null), row(2, null)], 0)), "check on 2 recorded move(s): holds 0 · fails 0 · n/a 2 · never applied");
	assert.equal(renderClaimSummary(summarizeClaim(Array.from({ length: 6 }, (_, i) => row(i + 1, false)), 0)),
		"check on 6 recorded move(s): holds 0 · fails 6 (#1, #2, …, #6)");
	assert.equal(renderClaimSummary(undefined), "check: not run yet");
	assert.match(renderClaimSummary(undefined, "SyntaxError: invalid syntax line 1: def check(t)"), /^check: not usable \(SyntaxError/);
});

test("versions identify the source; the level of an action is the levels completed before it", () => {
	assert.equal(claimVersion("def check(t): return True"), claimVersion("def check(t): return True"));
	assert.notEqual(claimVersion("a"), claimVersion("b"));
	assert.equal(levelOf({ level_changed: true, levels_completed: 1 }), 0);
	assert.equal(levelOf({ level_changed: false, levels_completed: 1 }), 1);
});
