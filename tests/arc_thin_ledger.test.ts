import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetLeft, buildLedger, constantAtCompletions, groupExperiments, maskedHashes, renderLedgerView, type LedgerRow, type Observation } from "../demo/arc_thin_ledger.ts";
import { DEFAULT_CRITIC, IGNORED_REVIEW, buildDossier, criticEffect, criticTriggers, ignoredReview, parseCriticReply, type CriticNote } from "../demo/arc_thin_critic.ts";

const row = (n: number, action: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
	n, action, changed_cells: 1, level_changed: false, state: "NOT_FINISHED", levels_completed: 0, ...extra });

/** grid[0][0] is a ticker that changes every action; grid[1][1] is the meaningful state. */
const grid = (tick: number, value: number) => [[tick % 10, 0], [0, value]];

test("experiments group by idea, fall back to action runs, and close on stage events", () => {
	const rows = [row(1, "ACTION1", { idea: "go right" }), row(2, "ACTION4", { idea: "Go  right" }), row(3, "ACTION2"),
		row(4, "ACTION2"), row(5, "ACTION1", { idea: "box", level_changed: true, levels_completed: 1 }), row(6, "ACTION1", { idea: "box" })];
	const e = groupExperiments(rows);
	assert.deepEqual(e.map(x => [x.label, x.start, x.end, x.close_reason ?? "open"]),
		[["go right", 1, 2, "idea_changed"], ["ACTION2", 3, 4, "idea_changed"], ["box", 5, 5, "level_changed"], ["box", 6, 6, "open"]]);
});

test("ticker cells are masked so repeated results become visible", () => {
	const grids = new Map<number, number[][]>();
	const rows: LedgerRow[] = [];
	// value follows 0,0,1,0,0,1...; ACTION1 from value 0 to 0 recurs, so a repeated result must be detected
	for (let n = 0; n <= 12; n += 1) grids.set(n, grid(n, n % 3 === 2 ? 1 : 0));
	for (let n = 1; n <= 12; n += 1) rows.push(row(n, "ACTION1"));
	assert.equal(maskedHashes(grids).ticker, 1);
	const state = buildLedger(rows, [], grids);
	assert.ok(state.repeats.length >= 8);
	assert.deepEqual(state.repeats[0].earlier, [1]);
	assert.equal(state.repeats[0].n, 4);
	assert.ok(state.stall >= 10);
});

test("measurements at completions and the constant-at-every-completion line", () => {
	const rows = [row(1, "ACTION1"), row(2, "ACTION1", { level_changed: true, levels_completed: 1 }), row(3, "ACTION1"),
		row(4, "ACTION1"), row(5, "ACTION1", { level_changed: true, levels_completed: 2 })];
	const obs: Observation[] = [0, 1, 2, 3, 4, 5].map(n => ({ n, skill: "bar", version: 1, ok: true,
		value: { remaining: n === 1 || n === 4 ? 0 : 5, pos: n } }));
	const state = buildLedger(rows, obs);
	assert.deepEqual(state.completions.map(c => [c.n, c.from, c.to, c.leaves["bar.remaining"]]), [[2, 0, 1, "0"], [5, 1, 2, "0"]]);
	assert.deepEqual(constantAtCompletions(state.completions, state.index), ["bar.remaining=0"]);
	const view = renderLedgerView(state, []);
	assert.match(view, /AT COMPLETIONS: #2 \(level 0→1.*same at every level completion: bar\.remaining=0/);
});

test("the view shows effort, expected vs observed and unpursued memory hypotheses", () => {
	const rows = [row(1, "ACTION1", { idea: "right", expect: "moves right" }), row(2, "ACTION1", { idea: "right" }),
		row(3, "ACTION1", { idea: "right" }), row(4, "ACTION3", { idea: "left" })];
	const obs: Observation[] = [0, 1, 2, 3, 4].map(n => ({ n, skill: "pos", version: 1, ok: true, value: [2, 3, 4, 5, 4][n] }));
	const view = renderLedgerView(buildLedger(rows, obs), ["hyp.box"]);
	assert.match(view, /IDEAS: left — 1 in a row \(#4–#4\), 1 total; right — 3 actions, last #3; not pursued by idea label: hyp\.box/);
	assert.match(view, /LAST EXPERIMENT right #1–#3: expected "moves right" \| observed: level unchanged; 3 cells changed over 3 action\(s\); pos\.value 2→5/);
});

test("goal coverage counts only structured level/WIN predictions and exposes untested effort", () => {
	const rows = [
		row(1, "ACTION1", { idea: "fill bar", predict: { state: "PLAYING" }, prediction: { fields: [{ field: "state", hit: true }] } }),
		row(2, "ACTION1", { idea: "fill bar" }),
		row(3, "ACTION2", { idea: "probe route", predict: { level_changed: true }, prediction: { fields: [{ field: "level_changed", hit: true }] } }),
		row(4, "ACTION2", { idea: "probe route" }),
	];
	const view = renderLedgerView(buildLedger(rows, []), ["hyp.goal_bar", "hyp.goal_route"], 900, [
		{ key: "hyp.goal_bar", evidence: [{ action: 1 }] },
		{ key: "hyp.goal_route", evidence: [] },
	]);
	assert.match(view, /GOAL CHECKS: #3 hit/);
	assert.match(view, /goal hypotheses without a matching level\/WIN prediction: hyp\.goal_bar, hyp\.goal_route/);
	assert.match(view, /effort without a level\/WIN check: fill bar\(2\)/);
	assert.doesNotMatch(view, /ACTION1.*goal check/);
});

const miss = { prediction: { fields: [{ field: "cells", hit: false }] } };
const hit = { prediction: { fields: [{ field: "cells", hit: true }] } };

test("critic triggers only on failures: GAME_OVER and a missed level/WIN prediction bypass the rate limit", () => {
	const rows = [1, 2, 3].map(n => row(n, "ACTION1", { idea: "right" })).concat([row(4, "ACTION3", { idea: "left" })]);
	const config = { ...DEFAULT_CRITIC, experimentMin: 3, minGap: 1 };
	// Closed experiments, changes of idea, level changes and RESET no longer call the critic.
	assert.deepEqual(criticTriggers(buildLedger(rows, []), [], 3, 0, config).triggers, []);
	const progress = buildLedger([...rows, row(5, "ACTION1", { level_changed: true, levels_completed: 1 }), row(6, "RESET")], []);
	assert.deepEqual(criticTriggers(progress, [], 4, 0, config).triggers, []);
	const recent: CriticNote[] = [{ at: 4, level: 0, triggers: [], lines: [], dropped: [] }];
	const over = buildLedger([...rows, row(5, "ACTION1", { state: "GAME_OVER" })], []);
	assert.deepEqual(criticTriggers(over, recent, 4, 0, { ...config, minGap: 8 }).triggers, ["GAME_OVER at #5"]);
	const missedGoal = buildLedger([...rows, row(5, "ACTION1", { predict: { level_changed: true }, prediction: { fields: [{ field: "level_changed", hit: false }] } })], []);
	assert.deepEqual(criticTriggers(missedGoal, recent, 4, 0, { ...config, minGap: 8 }).triggers, ["#5: the predicted level change did not happen"]);
});

test("critic triggers on repeated prediction misses, and on a long stretch without a goal check only while predictions miss", () => {
	const config = { ...DEFAULT_CRITIC, minGap: 1 };
	const misses = buildLedger([row(1, "ACTION1", hit), row(2, "ACTION1", miss), row(3, "ACTION2", hit), row(4, "ACTION2", miss)], []);
	assert.deepEqual(criticTriggers(misses, [], 3, 0, config).triggers, ["predictions missed at #2, #4 (of the last 5 actions)"]);
	assert.deepEqual(criticTriggers(buildLedger([row(1, "ACTION1", miss), row(2, "ACTION1", hit)], []), [], 1, 0, config).triggers, []);
	// 16 actions, every prediction right: a plan being executed is left alone.
	const hits = buildLedger(Array.from({ length: 16 }, (_, i) => row(i + 1, "ACTION1", hit)), []);
	assert.deepEqual(criticTriggers(hits, [], 15, 0, config).triggers, []);
	const oneMiss = buildLedger(Array.from({ length: 16 }, (_, i) => row(i + 1, "ACTION1", i === 3 ? miss : hit)), []);
	assert.deepEqual(criticTriggers(oneMiss, [], 15, 0, config).triggers, ["16 actions on this level without a level/WIN prediction; 1 of them had prediction misses"]);
	const checked = buildLedger(Array.from({ length: 16 }, (_, i) => row(i + 1, "ACTION1", i === 3 ? miss
		: i === 9 ? { predict: { level_changed: true }, prediction: { fields: [{ field: "level_changed", hit: true }] } } : hit)), []);
	assert.deepEqual(criticTriggers(checked, [], 15, 0, config).triggers, []);
});

test("critic replies: structured lines need a known target and existing actions; plain lines keep the old grounding rule", () => {
	const parsed = parseCriticReply("1. #2 and #3 moved right\n- nothing cited here\n- #99 invented\n* #1, #4 disagree\nsuggest: ACTION6 (12, 30)",
		5, ["ACTION1", "ACTION6"]);
	assert.deepEqual(parsed.lines, ["#2 and #3 moved right", "#1, #4 disagree"]);
	assert.equal(parsed.dropped.length, 2);
	assert.deepEqual(parsed.suggest, { action: "ACTION6", x: 12, y: 30 });
	assert.equal(parseCriticReply("suggest: ACTION5", 5, ["ACTION1"]).suggest, undefined);
	const structured = parseCriticReply([
		"hyp.goal_bar | contradicted | #4 filled the bar, no level change | does the level change when the bar is empty",
		"goal | untested | #1-#5 made no level/WIN prediction | predict the level change before the next attempt",
		"hyp.unknown | weakened | #2 | x",
		"strat.walk | stalled | no actions cited | x",
		"hyp.goal_bar | contradicted | #9 | x",
	].join("\n"), 5, ["ACTION1"], ["hyp.goal_bar", "strat.walk"]);
	assert.deepEqual(structured.lines, [
		"hyp.goal_bar contradicted: #4 filled the bar, no level change; cheapest test: does the level change when the bar is empty",
		"goal untested: #1-#5 made no level/WIN prediction; cheapest test: predict the level change before the next attempt",
	]);
	assert.deepEqual(structured.targets, ["hyp.goal_bar", "goal"]);
	assert.equal(structured.dropped.length, 3);
});

test("critic effect looks at the next five actions", () => {
	const rows = [1, 2, 3].map(n => row(n, "ACTION1", { idea: "right" }))
		.concat([4, 5, 6, 7, 8].map(n => row(n, n === 5 ? "ACTION2" : "ACTION1", { idea: n >= 6 ? "left" : "right" })));
	const note: CriticNote = { at: 3, level: 0, triggers: [], lines: ["#3"], dropped: [], idea_at: "right", suggest: { action: "ACTION2" } };
	assert.deepEqual(criticEffect(buildLedger(rows, []), note), { complete: true, idea_changed: true, idea_kept: false, suggestion_taken: true, repeat_recurred: false });
});

test("a review about keys counts as answered when the agent writes one of them; otherwise it is reported once", () => {
	const kept = (through: number) => buildLedger(Array.from({ length: through }, (_, i) => row(i + 1, "ACTION1", { idea: "fill bar" })), []);
	const note: CriticNote = { at: 10, level: 0, triggers: [], lines: ["hyp.goal_bar contradicted: #9"], dropped: [], targets: ["hyp.goal_bar"], idea_at: "fill bar" };
	const config = { ...DEFAULT_CRITIC, minGap: 50, effortRun: 99 };
	const none = () => false;
	assert.deepEqual(criticTriggers(kept(14), [note], 13, 0, config, none).triggers, []);
	const at15 = criticTriggers(kept(15), [note], 14, 0, config, none).triggers;
	assert.deepEqual(at15, ["the review at #10 was not acted on: #11–#15 did not revise hyp.goal_bar"]);
	assert.ok(at15[0].startsWith(IGNORED_REVIEW));
	assert.deepEqual(criticTriggers(kept(16), [note], 15, 0, config, none).triggers, []);
	// Writing the key in the window answers it, whatever the idea labels say.
	const touched = (keys: string[], from: number, to: number) => keys.includes("hyp.goal_bar") && from === 10 && to === 15;
	assert.equal(ignoredReview(kept(15), note, touched), undefined);
	// A note about the goal is answered by a level/WIN prediction.
	const goal: CriticNote = { ...note, targets: ["goal"], lines: ["goal untested: #9"] };
	const predicted = buildLedger(Array.from({ length: 15 }, (_, i) => row(i + 1, "ACTION1", i === 12 ? { predict: { level_changed: true } } : {})), []);
	assert.equal(ignoredReview(predicted, goal, none), undefined);
	assert.match(ignoredReview(kept(15), goal, none) ?? "", /did not revise the goal \(no level\/WIN prediction\)/);
	// The per-level cap still applies.
	assert.deepEqual(criticTriggers(kept(15), [note], 14, 0, { ...config, perLevel: 1 }, none).triggers, []);
});

test("a review with no targets falls back to the idea labels", () => {
	const kept = (through: number, extra: (n: number) => Partial<LedgerRow> = () => ({})) =>
		buildLedger(Array.from({ length: through }, (_, i) => row(i + 1, "ACTION1", { idea: "fill bar", ...extra(i + 1) })), []);
	const note: CriticNote = { at: 10, level: 0, triggers: [], lines: ["#9 rival untested"], dropped: [], idea_at: "fill bar", suggest: { action: "ACTION3" } };
	assert.equal(ignoredReview(kept(15), note), 'the review at #10 was not acted on: #11–#15 kept the idea "fill bar" and did not try ACTION3');
	assert.equal(ignoredReview(kept(15, n => n === 12 ? { action: "ACTION3" } : {}), note), undefined);
	assert.equal(ignoredReview(kept(15, n => n === 13 ? { idea: "probe" } : {}), note), undefined);
	assert.equal(ignoredReview(kept(15, n => n === 14 ? { idea: undefined } : {}), note), undefined);
});

test("budget left is the tighter of the level and run budgets and appears in the view and the dossier", () => {
	const rows = [row(1, "ACTION1", { idea: "right", budget: { used: 30, maximum: 40, total_used: 90, total_maximum: 100 } })];
	const state = buildLedger(rows, []);
	assert.equal(budgetLeft(state), 10);
	assert.equal(budgetLeft(buildLedger([row(1, "ACTION1", { budget: { used: 3, maximum: null, total_used: 95, total_maximum: 100 } })], [])), 5);
	assert.equal(budgetLeft(buildLedger([row(1, "ACTION1")], [])), null);
	assert.match(renderLedgerView(state, []), /IDEAS: right — 1 in a row \(#1–#1\), 1 total; actions left in budget: 10/);
	assert.match(buildDossier({ state, triggers: ["t"], memoryText: "", skills: [], notes: [], recentLines: [], currentState: "" }),
		/ACTIONS SO FAR: 1; levels completed: 0; actions left in budget: 10/);
	assert.doesNotMatch(renderLedgerView(buildLedger([row(1, "ACTION1", { idea: "right" })], []), []), /budget/);
});
