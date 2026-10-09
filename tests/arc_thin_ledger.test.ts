import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, constantAtCompletions, groupExperiments, maskedHashes, renderLedgerView, type LedgerRow, type Observation } from "../demo/arc_thin_ledger.ts";
import { DEFAULT_CRITIC, criticEffect, criticTriggers, parseCriticReply, type CriticNote } from "../demo/arc_thin_critic.ts";

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

test("critic triggers: closed experiment at the next action, stage events bypass the rate limit, effort needs a rival", () => {
	const rows = [1, 2, 3].map(n => row(n, "ACTION1", { idea: "right" })).concat([row(4, "ACTION3", { idea: "left" })]);
	const state = buildLedger(rows, []);
	const config = { ...DEFAULT_CRITIC, experimentMin: 3, minGap: 1 };
	assert.deepEqual(criticTriggers(state, [], 3, 0, config).triggers, ['experiment "right" #1–#3 closed (idea_changed)']);
	assert.deepEqual(criticTriggers(state, [], 4, 0, config).triggers, []);
	const recent: CriticNote[] = [{ at: 3, level: 0, triggers: [], lines: [], dropped: [] }];
	assert.deepEqual(criticTriggers(state, recent, 3, 0, { ...config, minGap: 8 }).suppressed.length, 1);
	const stage = buildLedger([...rows, row(5, "ACTION1", { level_changed: true, levels_completed: 1 })], []);
	assert.match(criticTriggers(stage, recent, 4, 0, { ...config, minGap: 8 }).triggers[0], /level change at #5/);
	const long = buildLedger(Array.from({ length: 16 }, (_, i) => row(i + 1, "ACTION1", { idea: "right" })), []);
	assert.deepEqual(criticTriggers(long, [], 15, 0).triggers, []);
	assert.match(criticTriggers(long, [], 15, 1).triggers[0], /16 consecutive actions on "right"/);
});

test("critic replies keep only lines citing existing actions and parse one suggestion", () => {
	const parsed = parseCriticReply("1. #2 and #3 moved right\n- nothing cited here\n- #99 invented\n* #1, #4 disagree\nsuggest: ACTION6 (12, 30)",
		5, ["ACTION1", "ACTION6"]);
	assert.deepEqual(parsed.lines, ["#2 and #3 moved right", "#1, #4 disagree"]);
	assert.equal(parsed.dropped.length, 2);
	assert.deepEqual(parsed.suggest, { action: "ACTION6", x: 12, y: 30 });
	assert.equal(parseCriticReply("suggest: ACTION5", 5, ["ACTION1"]).suggest, undefined);
});

test("critic effect looks at the next five actions", () => {
	const rows = [1, 2, 3].map(n => row(n, "ACTION1", { idea: "right" }))
		.concat([4, 5, 6, 7, 8].map(n => row(n, n === 5 ? "ACTION2" : "ACTION1", { idea: n >= 6 ? "left" : "right" })));
	const note: CriticNote = { at: 3, level: 0, triggers: [], lines: ["#3"], dropped: [], idea_at: "right", suggest: { action: "ACTION2" } };
	assert.deepEqual(criticEffect(buildLedger(rows, []), note), { complete: true, idea_changed: true, suggestion_taken: true, repeat_recurred: false });
});
