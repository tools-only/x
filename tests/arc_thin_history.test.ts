import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHistory, gridChanges, type CellChange, type HistoryRow } from "../demo/arc_thin_history.ts";
import { SKILL_LIMITS, skillGuestProgram, type GuestResult } from "../demo/arc_thin_skill_guest.ts";
import { evaluateTaskPython } from "../demo/pi_task_python.ts";
import type { Grid } from "../demo/arc_thin_prediction.ts";

// A marker that steps along a row: grid n has the marker at x=n.
const grid = (n: number): Grid => Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => (y === 1 && x === n ? 6 : 0)));
const rows = (count: number): HistoryRow[] => Array.from({ length: count }, (_, i) => ({
	n: i + 1, action: i % 2 ? "B" : "A", level_changed: false, state: "PLAYING", levels_completed: 0,
}));
const grids = (count: number) => new Map(Array.from({ length: count + 1 }, (_, n) => [n, grid(n)] as [number, Grid]));

test("history rows hold what the environment reported; grids travel as one base grid plus deltas", () => {
	assert.deepEqual(gridChanges(grid(0), grid(1)), [[0, 1, 6, 0], [1, 1, 0, 6]]);
	assert.equal(gridChanges(grid(0), [[0]]), undefined);
	const history = buildHistory(rows(3), grids(3), new Map());
	assert.equal(history.base_n, 0);
	assert.deepEqual(history.base_grid, grid(0));
	// No comparison is offered on the rows: no change list, no change count.
	assert.deepEqual(history.transitions, rows(3));
	assert.deepEqual(Object.keys(history.transitions[0]).sort(), ["action", "level_changed", "levels_completed", "n", "state"]);
	assert.deepEqual(Object.keys(history.deltas), ["1", "2", "3"]);
	// Extra fields on the stored rows (evaluation-only counts) do not reach the payload.
	const stored = rows(1).map((row) => ({ ...row, changed_cells: 2, bbox: {}, note: "n" }));
	assert.deepEqual(Object.keys(buildHistory(stored, grids(1), new Map()).transitions[0]).sort(),
		["action", "level_changed", "levels_completed", "n", "state"]);
});

test("a tight budget or a missing grid keeps every row and shortens the stretch with grids", () => {
	const cache = new Map<number, CellChange[] | null>();
	const base = JSON.stringify(grid(3)).length;
	// Room for the base grid and one transition's changes only.
	const tight = buildHistory(rows(3), grids(3), cache, base + 40);
	assert.equal(tight.base_n, 2);
	assert.deepEqual(Object.keys(tight.deltas), ["3"]);
	assert.equal(tight.transitions.length, 3);
	const holed = grids(3);
	holed.delete(1);
	assert.equal(buildHistory(rows(3), holed, new Map()).base_n, 2);
	const none = buildHistory(rows(3), new Map(), new Map());
	assert.deepEqual([none.base_n, none.base_grid, none.transitions.length], [null, null, 3]);
});

test("a skill builds its own frame comparison from history.grid in the sandbox", async () => {
	// The agent's tool, not the project's: which cells each action changed, and where the marker was.
	const source = [
		"def run(state, args):",
		"    h = state['history']",
		"    def changed(n):",
		"        a, b = h.grid(n - 1), h.grid(n)",
		"        return [[x, y, a[y][x], b[y][x]] for y in range(len(b)) for x in range(len(b[y])) if a[y][x] != b[y][x]]",
		"    return {",
		"        'count': len(h),",
		"        'a_actions': [t['n'] for t in h.transitions(action='A')],",
		"        'window': [t['n'] for t in h.transitions(since=2, until=3)],",
		"        'positions': [h.grid(n)[1].index(6) for n in range(len(h) + 1)],",
		"        'playing': [t['n'] for t in h.find(lambda t: t['state'] == 'PLAYING')],",
		"        'first_change': changed(1),",
		"        'row_keys': sorted(h.transitions()[0].keys()),",
		"    }",
	].join("\n");
	const run = async (history: unknown, body = source) => (await evaluateTaskPython(skillGuestProgram(SKILL_LIMITS),
		{ mode: "run", source: body, state: { grid: grid(4), history }, args: {} })).value as GuestResult;
	const result = await run(buildHistory(rows(4), grids(4), new Map()));
	assert.ok(result.ok, result.ok ? "" : result.error);
	assert.deepEqual(result.value, {
		count: 4, a_actions: [1, 3], window: [2, 3], positions: [0, 1, 2, 3, 4], playing: [1, 2, 3, 4],
		first_change: [[0, 1, 6, 0], [1, 1, 0, 6]],
		row_keys: ["action", "level_changed", "levels_completed", "n", "state"],
	});
	// Outside the stretch that has grids, the skill gets an error it can read, not a wrong grid.
	const short = buildHistory(rows(4), grids(4), new Map(), JSON.stringify(grid(4)).length + 40);
	const failed = await run(short, "def run(state, args):\n    return state['history'].grid(0)\n");
	assert.equal(failed.ok, false);
	assert.match(failed.ok ? "" : failed.error, /history\.grid\(0\): grids are available for 3\.\.4/);
});
