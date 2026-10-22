import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContest, claimSegments, claimVersion, contestEvents, levelOf, renderClaimSummary, renderContest, rivalEvents, rivalLines, summarizeClaim,
	COUNTEREXAMPLE_MIN_DECIDED,
	unchallenged, withCheckDef, type ClaimRow } from "../demo/arc_thin_claims.ts";
import { parseRefinerReply } from "../demo/arc_thin_refiner.ts";

const grid = (value: number, size = 4) => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x === value && y === 1 ? 9 : 0)));
const row = (n: number, result: ClaimRow["result"], level = 0): ClaimRow => ({ key: "hyp.a", version: "v", n, level, result });

test("a check written as the body of check(t) gets its def line, in a refinement's HYPOTHESIS and EXPECT alike", () => {
	// su15-g56-1 (gpt-5.6-sol, 2026-10-19): 4 of 23 refinement replies were refused for this.
	const body = "if t.get('action') != 'ACTION7':\n    return None\nreturn bool(t['level_changed'])";
	assert.equal(withCheckDef(body), "def check(t):\n    if t.get('action') != 'ACTION7':\n        return None\n    return bool(t['level_changed'])");
	assert.equal(withCheckDef("def check(t):\n    return True"), "def check(t):\n    return True");
	assert.equal(withCheckDef("after an ACTION6, does the blob move?"), "after an ACTION6, does the blob move?", "prose stays prose");
	const reply = parseRefinerReply(`HYPOTHESIS hyp.goal\nclaim: ACTION7 wins\ncheck:\n${body}\nEND\nWHY #50\nEXPECT within 3: ACTION7 is tried\nreturn t['action'] == 'ACTION7'\nEND`);
	assert.equal(reply.kind, "hypothesis");
	assert.match((reply as any).check, /^def check\(t\):\n    if t\.get/);
	assert.equal((reply as any).expect?.check, "def check(t):\n    return t['action'] == 'ACTION7'\n");
});

test("a hypothesis that holds with no rival under its question is unchallenged, and raises one rival event per check version", () => {
	const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ ...row(n, n === 6 ? false : true), key: "hyp.one_cell" }));
	const alone = new Map([["hyp.one_cell", { question: "how blocks move", version: "v", status: "supported" }]]);
	assert.deepEqual(unchallenged(alone, rows).map(({ key, decided, holds }) => [key, decided, holds]), [["hyp.one_cell", 6, 5]]);
	const [[id, text]] = rivalEvents(unchallenged(alone, rows));
	assert.equal(id, "rival:hyp.one_cell@v");
	assert.match(text, /^hyp\.one_cell holds on 5 of 6 decided moves, .*answers "how blocks move": write the strongest rival HYPOTHESIS/);
	// A rival with a check under the same question, too few decided moves, no question, or a contested status: none.
	assert.deepEqual(unchallenged(new Map([...alone, ["hyp.far_click", { question: "how blocks move", version: "w", status: "open" }]]), rows), []);
	assert.deepEqual(unchallenged(alone, rows.slice(0, 4)), []);
	assert.deepEqual(unchallenged(new Map([["hyp.one_cell", { version: "v", status: "open" }]]), rows), []);
	assert.deepEqual(unchallenged(new Map([["hyp.one_cell", { question: "how blocks move", version: "v", status: "contested" }]]), rows), []);
	// A rival without a check does not count: there is nothing to compare on the moves.
	assert.equal(unchallenged(new Map([...alone, ["hyp.prose", { question: "how blocks move", status: "open" }]]), rows).length, 1);
});

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

test("one applicable false is a counterexample; null and errors are not evidence", () => {
	const rows = (results: Array<ClaimRow["result"]>) => results.map((result, i) => row(i + 1, result));
	assert.equal(checkContest(rows([null, "error"]), COUNTEREXAMPLE_MIN_DECIDED), undefined);
	assert.deepEqual(checkContest(rows([null, "error", false]), COUNTEREXAMPLE_MIN_DECIDED), { decided: 1, fails: 1, failing: [3], at: 3 });
	assert.deepEqual(checkContest(rows([true, false]).reverse(), COUNTEREXAMPLE_MIN_DECIDED)?.at, 2, "rows in any order");
	assert.equal(checkContest(rows([false, false, false, false, false]), 0), undefined, "0 turns it off");
	assert.equal(renderContest({ decided: 218, fails: 158, failing: [51, 52, 60, 61, 70], at: 59 }),
		"its check fails on 158 of 218 decided moves (#51, #52, …, #70)");
});

test("each check-contested hypothesis is one refinement event per check version, none when a rule citing it is in dispute", () => {
	const contest = { decided: 6, fails: 6, failing: [1, 2, 3, 4, 5, 6], at: 5 };
	const events = contestEvents([{ key: "hyp.a", version: "v1", contest }, { key: "hyp.b", version: "v2", contest }], ["hyp.b"]);
	assert.deepEqual(events.map(([id]) => id), ["contested:hyp.a@v1"]);
	assert.match(events[0][1], /^hyp\.a is contested: its check fails on 6 of 6 decided moves \(#1, #2, …, #6\); /);
	assert.deepEqual(contestEvents([], []), []);
	// A hypothesis a refinement wrote is the refinement's to rewrite; the agent's is only narrowed under a new key.
	const [[, own]] = contestEvents([{ key: "hyp.a", version: "v1", contest, ownedByRefinement: true }], []);
	assert.match(own, /rewrite it with HYPOTHESIS hyp\.a/);
	assert.doesNotMatch(own, /new key/);
	assert.match(events[0][1], /under a new key/);
});

test("rivals with checks: one line per question, naming a recorded move that separates two of them, or saying none does", () => {
	// su15-l1-1's hyp.block_movement held on 109 of 111 moves it decided, all moves the agent chose because it held the
	// belief; nothing compared it with a rival on the same moves.
	const results = (key: string, version: string, list: Array<ClaimRow["result"]>) =>
		list.map((result, i): ClaimRow => ({ key, version, n: i + 1, level: 0, result }));
	const hypotheses = new Map<string, { question?: string; version?: string; status: string }>([
		["hyp.a", { question: "reach", version: "va", status: "open" }], ["hyp.b", { question: "reach", version: "vb", status: "open" }],
		["hyp.c", { question: "goal", version: "vc", status: "open" }], ["hyp.d", { question: "goal", version: "vd", status: "supported" }],
		["hyp.e", { question: "goal", status: "open" }], ["hyp.f", { question: "goal", version: "vf", status: "rejected" }],
		["hyp.g", { question: "alone", version: "vg", status: "open" }],
	]);
	const rows = [...results("hyp.a", "va", [true, true, false, null]), ...results("hyp.b", "vb", [true, false, false, true]),
		...results("hyp.c", "vc", [true, null, true]), ...results("hyp.d", "vd", [true, false, true]), ...results("hyp.f", "vf", [false, false, false])];
	assert.deepEqual(rivalLines(hypotheses, rows), [
		'question "reach": #2 separates hyp.a (holds) from hyp.b (fails)',
		'question "goal": no recorded move separates hyp.c from hyp.d (both decided 2 moves, same results)',
	]);
	assert.deepEqual(rivalLines(new Map([["hyp.a", { question: "q", version: "va", status: "open" }], ["hyp.b", { question: "q", version: "vb", status: "open" }]]), []),
		['question "q": no recorded move separates hyp.a from hyp.b (no move decided by both)']);
});
