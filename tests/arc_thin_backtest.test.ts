import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestCases, counterexamples, renderBacktest, scoreBacktest, type BacktestRow, type ModelCheck } from "../demo/arc_thin_backtest.ts";
import { explorationLine, isGoalHypothesis } from "../demo/arc_thin_ledger.ts";
import { parseCriticReply } from "../demo/arc_thin_critic.ts";
import { emptyMemory, planMemoryUpdate, applyRows, renderFactsCompact } from "../demo/arc_thin_memory.ts";

// A 3x3 world: one cell of value 5 that ACTION1 moves right and ACTION2 moves down; RESET puts it back.
const at = (x: number, y: number) => Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => (c === x && r === y ? 5 : 0)));
const row = (n: number, action: string, extra: Partial<BacktestRow> = {}): BacktestRow =>
	({ n, action, level_changed: false, state: "NOT_FINISHED", levels_completed: 0, ...extra });
const rows = [row(1, "ACTION1"), row(2, "ACTION2"), row(3, "RESET"), row(4, "ACTION1")];
const grids = new Map([[0, at(0, 0)], [1, at(1, 0)], [2, at(1, 1)], [3, at(0, 0)], [4, at(1, 0)]]);

test("cases carry only what existed before each move", () => {
	const cases = backtestCases(rows, grids, 0, 4, ["ACTION1", "ACTION2", "RESET"]);
	assert.deepEqual(cases.map((c) => [c.n, c.proposed_action.action, c.recent_actions.length]), [[1, "ACTION1", 0], [2, "ACTION2", 1], [3, "RESET", 2], [4, "ACTION1", 3]]);
	assert.ok(cases.every((c) => c.recent_actions.every((r: any) => r.n < c.n)), "no case sees its own or a later move");
	assert.deepEqual(backtestCases(rows, grids, 2, 4, []).map((c) => c.n), [3, 4], "incremental: only moves not checked yet");
	const missing = new Map(grids); missing.delete(1);
	assert.deepEqual(backtestCases(rows, missing, 0, 4, []).map((c) => c.n), [3, 4], "a move whose grids are missing is skipped");
});

test("replies are scored as right, wrong, abstained or failed; fit, later and RESET are kept apart", () => {
	// The model: "ACTION1 moves the 5 right"; it says nothing about ACTION2 and fails on RESET.
	const results = [
		{ n: 1, ok: true, value: { cells: [[1, 0, 5], [0, 0, 0]] } },
		{ n: 2, ok: true, value: {} },
		{ n: 3, ok: false, error: "KeyError: 'x'" },
		{ n: 4, ok: true, value: { cells: [[2, 0, 5]] } },
	];
	const checks = scoreBacktest("mover", 1, results, rows, grids, 2);
	assert.deepEqual(checks.map((c) => [c.n, c.set, c.outcome]), [[1, "fit", "right"], [2, "fit", "abstained"], [3, "reset", "error"], [4, "later", "wrong"]]);
	// Claims count the predicted cells and how many of them predict a change from the grid before the move.
	assert.deepEqual([checks[0].cells, checks[0].changes], [2, 2]);
	assert.match(checks[3].detail!, /cells 1 predicted value\(s\) \[1 as change\]: 0\/1 right; \(2,0\)=0/);
	const text = renderBacktest("mover", 1, checks);
	assert.match(text, /^- mover v1 \(model, checked on recorded moves\): recorded moves \(fit\) 1\/2 right, 1 no prediction; moves since saving 0\/1 right, 1 wrong; RESETs 0\/1 right, 1 failed; claims 1\.5 cells per move, 1\.5 of them changes\n  wrong: #3 RESET: KeyError: 'x' \| #4 ACTION1: cells/);
	assert.equal(renderBacktest("mover", 2, checks), "- mover v2 (model): no recorded transition to check yet");
});

test("a goal model's level prediction is counted apart, and a background-only claim is not an exact move", () => {
	const won = [row(1, "ACTION1"), row(2, "ACTION2", { level_changed: true, levels_completed: 1 })];
	const checks = scoreBacktest("goal", 1, [
		{ n: 1, ok: true, value: { level_changed: true } },
		{ n: 2, ok: true, value: { level_changed: true } },
	], won, grids, 2);
	assert.deepEqual(checks.map((c) => c.outcome), ["wrong", "right"]);
	assert.match(renderBacktest("goal", 1, checks), /predicted a level change 2×, right 1×/);
	// Claiming only cells that do not change is scored, but the claims line shows 0 changes.
	const still = scoreBacktest("still", 1, [{ n: 1, ok: true, value: { cells: [[2, 2, 0]] } }], rows, grids, 1);
	assert.equal(still[0].outcome, "right");
	assert.match(renderBacktest("still", 1, still), /claims 1\.0 cells per move, 0\.0 of them changes/);
});

test("counterexamples are spread over actions before repeating one", () => {
	const bad = (n: number, action: string): ModelCheck => ({ name: "m", version: 1, n, action, set: "fit", outcome: "wrong" });
	assert.deepEqual(counterexamples([bad(1, "ACTION1"), bad(2, "ACTION1"), bad(3, "ACTION1"), bad(4, "ACTION2")]).map((c) => c.n), [2, 3, 4]);
	assert.deepEqual(counterexamples([bad(1, "ACTION1"), bad(2, "ACTION2"), bad(3, "ACTION3"), bad(4, "ACTION1")], 2).map((c) => c.n), [3, 4]);
});

test("exploration counts what was tried from the exact current grid", () => {
	// After #4 the grid equals the one after #1: from it ACTION2 was tried once (one result); ACTION1 never.
	const line = explorationLine(rows, grids, 4, ["ACTION1", "ACTION2", "RESET"]);
	assert.match(line, /^EXPLORATION \(exact grids\): this exact grid was also seen at #1; from it: ACTION2 1× \(1 distinct result\); never tried from it: ACTION1, RESET; new grids in the last 5 states: 3$/);
	assert.match(explorationLine(rows, grids, 3, ["ACTION1"]), /this exact grid was also seen at the start; from it: ACTION1 2× \(1 distinct result\)/);
	assert.equal(explorationLine(rows.slice(0, 1), grids, 1, []), "", "nothing before three moves");
});

test("goal hypotheses are recognised by the words of their own question or key", () => {
	assert.ok(isGoalHypothesis("hyp.goal_right", "what is the goal?"));
	assert.ok(isGoalHypothesis("hyp.box", "how do we win?"));
	assert.ok(isGoalHypothesis("hyp.lvl", "what triggers level change?"));
	assert.ok(isGoalHypothesis("hyp.goal_dot"));
	assert.ok(!isGoalHypothesis("hyp.controls", "what do actions do?"));
});

test("critic lines are kept when grounded in actions, keys or counts; invented or repeated ones are dropped", () => {
	const reply = [
		"- Goal model hyp.goal_right is unresolved: 22 actions spent on control isolation with zero WIN checks.",
		"- strat.explore_controls is stalled after #12–#20.",
		"- hyp.invented is supported.",
		"- #99 shows a pattern.",
		"- The agent should think harder.",
		"- 400 actions were wasted.",
		"- The label toggle_regions is misleading (#24).",
	].join("\n");
	const parsed = parseCriticReply(reply, 30, ["ACTION1"], ["hyp.goal_right", "strat.explore_controls"], ["The label toggle_regions is misleading (#24)."]);
	assert.deepEqual(parsed.lines, [
		"Goal model hyp.goal_right is unresolved: 22 actions spent on control isolation with zero WIN checks.",
		"strat.explore_controls is stalled after #12–#20.",
	]);
	assert.equal(parsed.dropped.length, 5);
});

test("a corrected belief retires the facts it replaces in the same call", () => {
	const state = emptyMemory();
	const commit = (params: any) => { const plan = planMemoryUpdate(state, params, 10); assert.ok(plan.ok, plan.ok ? "" : plan.error); applyRows(state, plan.rows); return plan; };
	commit({ set: [{ key: "obs.a1", text: "A1 extends up" }, { key: "obs.a1_v2", text: "A1 toggles" }, { key: "obs.other", text: "x" }] });
	const plan = commit({ set: [{ key: "obs.a1_model", text: "A1 moves the block up 5", replaces: ["obs.a1", "obs.a1_v2"] }] });
	assert.match((plan as any).receipt, /obs\.a1_model replaces obs\.a1, obs\.a1_model replaces obs\.a1_v2/);
	assert.deepEqual([...state.facts.keys()].sort(), ["obs.a1_model", "obs.other"]);
	assert.doesNotMatch(renderFactsCompact(state), /extends|toggles/);
	// Replacing a key that does not exist is reported, not an error; an entry cannot replace itself.
	const again = commit({ set: [{ key: "obs.a1_model", text: "A1 moves up 5 unless blocked", replaces: ["obs.a1_model", "obs.gone"] }] });
	assert.match((again as any).receipt, /not found: obs\.gone/);
	assert.ok(state.facts.has("obs.a1_model"));
});
