import assert from "node:assert/strict";
import { test } from "node:test";
import { MoveFacts, attemptLine, attempts, classify, coverage, coverageText, failedUnderOneModel, kindText, modelChanges, moveKinds, parseMove,
	rareKinds, repeatEvent, type MoveRow } from "../demo/arc_thin_coverage.ts";
import { nextExperimentText, withNextItem, withoutNextItem } from "../demo/arc_thin_refiner.ts";

/**
 * A 16x16 board with a one-cell block at (1,1) and a bar in row 15 that loses a cell on every move. A click on the block
 * moves it one cell down-right (wrapping at 14); a click elsewhere toggles the clicked cell.
 */
function play(moves: Array<[string, number?, number?]>) {
	const grid = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, () => (y === 15 ? 3 : 0)));
	const block = { x: 1, y: 1 };
	grid[1][1] = 9;
	const grids = new Map<number, number[][]>([[0, grid.map((row) => [...row])]]);
	const rows: MoveRow[] = [];
	moves.forEach(([action, x, y], i) => {
		if (action === "ACTION6" && x === block.x && y === block.y) {
			grid[block.y][block.x] = 0;
			block.x = (block.x + 1) % 14; block.y = (block.y + 1) % 14;
			grid[block.y][block.x] = 9;
		} else if (action === "ACTION6") grid[y!][x!] = grid[y!][x!] ? 0 : 9;
		grid[15][15 - (i % 16)] = Math.floor(i / 16) % 2 ? 3 : 0;
		grids.set(i + 1, grid.map((row) => [...row]));
		rows.push({ n: i + 1, action, ...(x !== undefined ? { x, y } : {}), level_changed: false, state: "NOT_FINISHED", levels_completed: 0 });
	});
	return { rows, facts: new MoveFacts(grids) };
}

test("a line that changes on most moves is a counter: boxes and the kinds of clicks leave it out", () => {
	// su15's move counter in row 63 changed on every move that changed anything, so each bridge box reached down to it.
	const clicks: Array<[number, number]> = [[2, 2], [2, 2], [3, 3], [7, 7], [14, 1], [14, 1], [10, 4], [10, 4], [10, 4], [1, 10], [1, 10], [4, 12]];
	const { rows, facts } = play(clicks.map(([x, y]) => ["ACTION6", x, y]));
	assert.deepEqual([...facts.refresh(rows).rows], [15]);
	assert.deepEqual([...facts.busy.cols], []);
	assert.deepEqual(facts.box(9), { top: 4, left: 10, bottom: 4, right: 10 });
	const kinds = moveKinds(rows, facts);
	assert.deepEqual([1, 2, 3, 4, 5].map((n) => kinds.get(n)), ["ACTION6:unplaced", "ACTION6:inside", "ACTION6:touching", "ACTION6:near", "ACTION6:far"]);
	const cov = coverage(rows, facts);
	assert.deepEqual(cov.clicks, { inside: 5, touching: 1, near: 3, far: 2, unplaced: 1 });
	assert.equal(coverageText(cov, ["ACTION6", "ACTION7", "RESET"]), "on level 1 (12 moves): 12 clicks by distance from the last changed area " +
		"(now x4-4 y12-12): inside 5, touching 1, 2-6 cells 3, more than 6 cells 2, first of an attempt 1; ACTION7 never played");
});

/** A one-cell sprite (9) walking down and back up column 5, one cell per move, and the bar in row 15 losing a cell per move. */
function walk(moves: number) {
	const grid = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, () => (y === 15 ? 3 : 0)));
	let y = 2, dy = 1;
	grid[y][5] = 9;
	const grids = new Map<number, number[][]>([[0, grid.map((row) => [...row])]]);
	const rows: MoveRow[] = [];
	for (let i = 0; i < moves; i += 1) {
		grid[y][5] = 0;
		if (y + dy < 2 || y + dy > 12) dy = -dy;
		y += dy;
		grid[y][5] = 9;
		grid[15][15 - i] = 0;
		grids.set(i + 1, grid.map((row) => [...row]));
		rows.push({ n: i + 1, action: dy > 0 ? "ACTION2" : "ACTION1", level_changed: false, state: "NOT_FINISHED", levels_completed: 0 });
	}
	return { rows, facts: new MoveFacts(grids) };
}

test("an object walking along a line is not a counter: its track stays in boxes and grid keys", () => {
	// The ledger's held-out recheck (docs/plans/2026-10-19-ledger-busy-lines.md): an ls20 player walking a corridor on most
	// moves made the corridor's columns busy, and its positions merged. A walker takes its values along; a bar is recoloured.
	const { rows, facts } = walk(12);
	assert.deepEqual([...facts.refresh(rows).rows], [15]);
	assert.deepEqual([...facts.busy.cols], [], "column 5 is the sprite's track");
	assert.deepEqual(facts.box(3), { top: 4, left: 5, bottom: 5, right: 5 });
	assert.notEqual(facts.key(1), facts.key(2), "two positions of the sprite are two grids");
	assert.equal(facts.key(8), facts.key(12), "the same position with the bar masked is the same grid");
});

test("a counter cell is masked as a cell: its row and column stay", () => {
	// A digit at (15,0) changes on every move; clicks toggle cells, one of them in column 15.
	const grid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0));
	const grids = new Map<number, number[][]>([[0, grid.map((row) => [...row])]]);
	const rows: MoveRow[] = [];
	const clicks: Array<[number, number]> = [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [15, 5], [10, 10]];
	clicks.forEach(([x, y], i) => {
		grid[y][x] = grid[y][x] ? 0 : 9;
		grid[0][15] = 1 + (i % 9);
		grids.set(i + 1, grid.map((row) => [...row]));
		rows.push({ n: i + 1, action: "ACTION6", x, y, level_changed: false, state: "NOT_FINISHED", levels_completed: 0 });
	});
	const facts = new MoveFacts(grids);
	const busy = facts.refresh(rows);
	assert.deepEqual([[...busy.rows], [...busy.cols], [...busy.cells]], [[], [], ["15,0"]]);
	assert.deepEqual(facts.box(9), { top: 5, left: 15, bottom: 5, right: 15 }, "the click in column 15 is placed, without the counter");
	assert.notEqual(facts.key(8), facts.key(9), "the cell it toggled shows in the grid key");
});

test("rare kinds are the available ones the level has (almost) not played; a proposed move is classified from the last change", () => {
	// Twenty clicks, each on the block where the previous one moved it: all inside the last changed area.
	const { rows, facts } = play(Array.from({ length: 20 }, (_, k) => ["ACTION6", (1 + k) % 14, (1 + k) % 14] as [string, number, number]));
	const cov = coverage(rows, facts);
	assert.deepEqual(cov.clicks, { inside: 19, touching: 0, near: 0, far: 0, unplaced: 1 });
	assert.deepEqual(cov.box, { top: 6, left: 6, bottom: 7, right: 7 });
	assert.deepEqual(rareKinds(cov, ["ACTION6", "ACTION7", "RESET"]), ["ACTION6:touching", "ACTION6:near", "ACTION6:far", "ACTION7"]);
	assert.equal(kindText("ACTION6:near"), "a click 2-6 cells from the last changed area");
	assert.deepEqual(classify({ action: "ACTION6", x: 8, y: 9 }, cov, ["ACTION6", "ACTION7"]), { kind: "ACTION6:near", rare: true, placed: true });
	assert.deepEqual(classify({ action: "ACTION6", x: 7, y: 7 }, cov, ["ACTION6", "ACTION7"]), { kind: "ACTION6:inside", rare: false, placed: true });
	assert.equal(classify({ action: "ACTION6" }, cov, ["ACTION6"]).needsXY, true, "a click needs its cell");
	assert.equal(classify({ action: "ACTION7" }, cov, ["ACTION6", "ACTION7"]).rare, true);
});

test("the move a text names: ACTIONn with its cell in the usual forms, the first one only", () => {
	assert.deepEqual(parseMove("ACTION6(30,42) moves it, whereas ACTION6(25,25) does not"), { action: "ACTION6", x: 30, y: 42 });
	assert.deepEqual(parseMove("click ACTION6 at (3, 4) once"), { action: "ACTION6", x: 3, y: 4 });
	assert.deepEqual(parseMove("ACTION6 x=7, y=8"), { action: "ACTION6", x: 7, y: 8 });
	assert.deepEqual(parseMove("a future ACTION7 restores it"), { action: "ACTION7" });
	assert.equal(parseMove("click its untested bottom-left cell"), undefined);
});

test("attempts run between RESETs, GAME_OVERs and level changes; failures count after the agent last changed its model", () => {
	const row = (n: number, action: string, extra: Partial<MoveRow> = {}): MoveRow => ({ n, action, level_changed: false, state: "NOT_FINISHED", levels_completed: 1, ...extra });
	const rows = [row(1, "ACTION6", { level_changed: true }), row(2, "ACTION6"), row(3, "ACTION6", { state: "GAME_OVER" }), row(4, "RESET"),
		row(5, "ACTION6"), row(6, "ACTION6"), row(7, "RESET"), row(8, "ACTION6")];
	const list = attempts(rows);
	assert.deepEqual(list.map((a) => [a.level, a.start, a.end, a.actions, a.ended]), [[0, 1, 1, 1, "level"], [1, 2, 3, 2, "GAME_OVER"], [1, 5, 6, 2, "RESET"], [1, 8, 8, 1, "open"]]);
	assert.equal(attemptLine(list, 1), "this attempt: 1 action; earlier attempts on this level ended after 2, 2 actions (GAME_OVER or RESET)");
	assert.deepEqual(failedUnderOneModel(list, [], 1).map((a) => a.start), [2, 5]);
	assert.deepEqual(failedUnderOneModel(list, [3], 1).map((a) => a.start), [5], "a change after #3 precedes only the attempt from #5");
	const text = repeatEvent(failedUnderOneModel(list, [], 1), 40, { key: "hyp.corner", question: "what a click does", decided: 4, holds: 4 },
		{ text: "on level 2 (4 moves): …" }, "ACTION6(x,y) or ACTIONn");
	assert.match(text, /^attempts on level 2 since the agent last changed a hypothesis about what its actions do: 2, 2 actions, each ended by GAME_OVER or RESET \(40 actions left in the level's budget\); the model in play is hyp\.corner/);
	assert.match(text, /as a rival HYPOTHESIS under the question "what a click does" whose check disagrees with hyp\.corner on some move/);
});

test("the agent changes its model by rewriting, rejecting or deleting a hypothesis about its actions, not by restating it or adding one", () => {
	// su15-g56-1: the claim of hyp.color6_anchor_motion was rewritten after GAME_OVERs with hazard notes; its check stayed.
	const check = "def check(t):\n    return None\n";
	const hyp = (claim: string, extra: Record<string, unknown> = {}) => ({ claim, question: "how blocks move", status: "open", check, ...extra });
	assert.deepEqual(modelChanges([
		{ key: "hyp.move", hyp: hyp("one cell up-left"), at: 10 },
		{ key: "hyp.move", hyp: hyp("one cell up-left; obstacles end the run"), at: 20 },
		{ key: "hyp.undo", hyp: hyp("ACTION7 undoes"), at: 25 },
		{ key: "hyp.target", hyp: { claim: "reach the disk", question: "what completes level 1?" }, at: 26 },
		{ key: "hyp.target", hyp: { claim: "reach the top", question: "what completes level 1?" }, at: 27 },
		{ key: "hyp.move", hyp: hyp("one cell up-left", { check: "def check(t):\n    return True\n" }), at: 30 },
		{ key: "hyp.move", hyp: hyp("x", { check: "def check(t):\n    return False\n" }), at: 35, by: "refinement" },
		{ key: "hyp.undo", hyp: hyp("ACTION7 undoes", { status: "rejected" }), at: 40 },
		{ key: "hyp.undo", deleted: true, at: 41 },
	]), [30, 40, 41]);
});

test("the strategy's next experiment gets the pinned move as its first item, and loses it again", () => {
	const strategy = "---\nactive: true\n---\n## Open questions\n- why\n\n## Next experiment\nTry the top row.\n\n## Failure modes\n- none\n";
	const pinned = withNextItem(strategy, "- First: ACTION6(9,9), a click 2-6 cells from the last changed area");
	assert.match(pinned, /## Next experiment\n- First: ACTION6\(9,9\), a click 2-6 cells from the last changed area\nTry the top row\./);
	assert.equal(nextExperimentText(pinned), "- First: ACTION6(9,9), a click 2-6 cells from the last changed area\nTry the top row.");
	assert.equal(withoutNextItem(pinned, "- First: ACTION6(9,9)"), strategy);
	assert.equal(withNextItem("", "- First: ACTION7"), "---\nactive: true\n---\n## Next experiment\n- First: ACTION7\n\n");
	assert.match(withNextItem("---\nactive: true\n---\nPlan: walk right.\n", "- First: ACTION7"), /^---\nactive: true\n---\n## Next experiment\n- First: ACTION7\n\nPlan: walk right\.\n$/);
});
