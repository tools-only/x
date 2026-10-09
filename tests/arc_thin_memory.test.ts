import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DROPPED_CALLS, MAX_EVIDENCE, MAX_FACTS, MAX_HYPOTHESES, applyRow, applyRows, emptyMemory, planMemoryUpdate, prepareMemoryArguments,
	renderHypotheses, renderMemory, renderRevisions, renderStrategies, visibleDropped, type MemoryState,
} from "../demo/arc_thin_memory.ts";

const commit = (state: MemoryState, params: any, actions = 10) => {
	const plan = planMemoryUpdate(state, params, actions);
	assert.ok(plan.ok, plan.ok ? "" : plan.error);
	applyRows(state, plan.rows);
	return plan;
};

test("legacy single-entry calls still work and old memory.jsonl rows replay as facts", () => {
	const state = emptyMemory();
	for (const row of [{ key: "goal", text: "clear the bar", confidence: 4 }, { key: "plan", text: "x", confidence: 3 },
		{ key: "plan", deleted: true }]) applyRow(state, row);
	assert.deepEqual([...state.facts.keys()], ["goal"]);
	commit(state, { op: "set", key: "plan", text: "go up" });
	commit(state, { key: "controls", text: "ACTION1 moves up" });          // op inferred
	commit(state, { op: "delete", key: "goal" });
	assert.deepEqual([...state.facts.keys()], ["plan", "controls"]);
	const list = planMemoryUpdate(state, { op: "list" }, 0);
	assert.ok(list.ok && /HYPOTHESES: none[\s\S]*- controls: "ACTION1 moves up"/.test(list.receipt));
	const missingOp = planMemoryUpdate(state, { key: "plan" } as any, 0);
	assert.equal(missingOp.ok, false);
});

test("one call removes accumulated per-step entries by prefix and saves the replacement", () => {
	const state = emptyMemory();
	for (let n = 1; n <= MAX_FACTS; n += 1) applyRow(state, { key: `state_${n}`, text: `step ${n}`, confidence: 3 });
	const full = planMemoryUpdate(state, { set: [{ key: "plan", text: "new plan" }] }, 40);
	assert.equal(full.ok, false);
	assert.match(full.ok ? "" : full.error, /delete more in the same call/);
	const plan = commit(state, { delete: ["state_*", "nonexistent"], set: [{ key: "plan", text: "new plan" }] }, 40);
	assert.deepEqual([...state.facts.keys()], ["plan"]);
	assert.match(plan.receipt, /deleted 40 \(state_1, .*\(\+28\)\)/);
	assert.match(plan.receipt, /not found: nonexistent/);
	assert.equal(planMemoryUpdate(state, { delete: ["*"] }, 0).ok, false);
});

test("an invalid part rejects the whole batch", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [{ key: "top_box", claim: "entering the top box wins" }] });
	const plan = planMemoryUpdate(state, {
		set: [{ key: "probe", text: "must not land" }],
		delete: ["hyp.top_box"],
		hypotheses: [{ key: "new_one" }],                               // no claim
	}, 10);
	assert.equal(plan.ok, false);
	assert.match(plan.ok ? "" : plan.error, /NOT changed[\s\S]*hyp\.new_one: a new hypothesis needs claim/);
	assert.ok(state.hypotheses.has("hyp.top_box"));
	assert.ok(!state.facts.has("probe"));
});

test("a rejection keeps the condition it was tested under", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [{ key: "hyp.top_box", claim: "entering the top box completes the level",
		predicts: "ACTION1 at the entrance moves the player inside", next_test: "match the pattern, then ACTION1 at the entrance" }] }, 150);
	// The #157 failure: "top box inaccessible" without saying the pattern did not match.
	const bare = planMemoryUpdate(state, { hypotheses: [{ key: "top_box", status: "rejected" }] }, 157);
	assert.equal(bare.ok, false);
	assert.match(bare.ok ? "" : bare.error, /needs evidence with verdict "refutes"/);
	const noCondition = planMemoryUpdate(state, { hypotheses: [{ key: "top_box", status: "rejected",
		evidence: { action: 157, observed: "blocked", verdict: "refutes" } }] }, 157);
	assert.match(noCondition.ok ? "" : noCondition.error, /condition/);
	const future = planMemoryUpdate(state, { hypotheses: [{ key: "top_box",
		evidence: { action: 158, condition: "c", observed: "o", verdict: "refutes" } }] }, 157);
	assert.match(future.ok ? "" : future.error, /action #158 does not exist/);
	commit(state, { hypotheses: [{ key: "top_box", status: "rejected",
		evidence: { action: 157, condition: "pattern did not match the target", observed: "blocked, 0 cells changed", verdict: "refutes" } }] }, 157);
	const text = renderHypotheses(state, 310);
	assert.match(text, /hyp\.top_box \[rejected\] entering the top box/);
	assert.match(text, /#157 refutes when "pattern did not match the target": blocked, 0 cells changed/);
	assert.match(text, /last tested: #157 \(153 actions ago\) · next test: match the pattern/);
	assert.match(text, /a refutation only covers the condition it was tested under/);
});

test("evidence is appended; refutations outlive older supporting results", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [{ key: "bar", claim: "emptying the bar wins" }] });
	commit(state, { hypotheses: [{ key: "bar", evidence: { action: 1, condition: "pattern unmatched", observed: "no win", verdict: "refutes" } }] });
	for (let n = 2; n <= MAX_EVIDENCE + 3; n += 1)
		commit(state, { hypotheses: [{ key: "bar", evidence: { action: n, condition: "c", observed: "bar shrank", verdict: "supports" } }] });
	const evidence = state.hypotheses.get("hyp.bar")!.evidence;
	assert.equal(evidence.length, MAX_EVIDENCE);
	assert.equal(evidence[0].verdict, "refutes");
	assert.equal(evidence.at(-1)!.action, MAX_EVIDENCE + 3);
	assert.equal(state.hypotheses.get("hyp.bar")!.claim, "emptying the bar wins");
});

test("hypothesis keys and fact keys stay apart; caps hold", () => {
	const state = emptyMemory();
	assert.equal(planMemoryUpdate(state, { set: [{ key: "hyp.x", text: "t" }] }, 0).ok, false);
	const many = Array.from({ length: MAX_HYPOTHESES + 1 }, (_, i) => ({ key: `h${i}`, claim: "c" }));
	assert.match((planMemoryUpdate(state, { hypotheses: many }, 0) as any).error, new RegExp(`max ${MAX_HYPOTHESES}`));
	commit(state, { hypotheses: [{ key: "a", claim: "c" }] });
	commit(state, { delete: ["a"] });                                 // bare name resolves to hyp.a
	assert.equal(state.hypotheses.size, 0);
	assert.match(renderHypotheses(state, 0), /HYPOTHESES: none/);
});

test("prepareArguments repairs JSON-string and scalar list arguments without throwing", () => {
	const args = prepareMemoryArguments({
		set: '[{"key":"plan","text":"p"}]', delete: "state_*",
		hypotheses: [{ key: "h", claim: "c", evidence: '{"condition":"c","observed":"o","verdict":"supports"}' }],
	});
	assert.deepEqual(args.set, [{ key: "plan", text: "p" }]);
	assert.deepEqual(args.delete, ["state_*"]);
	assert.equal(args.hypotheses[0].evidence.verdict, "supports");
	assert.deepEqual(prepareMemoryArguments({ set: "[not json" }), { set: "[not json" });
	assert.equal(prepareMemoryArguments(null), null);
	const more = prepareMemoryArguments({
		tests: { action: 1, condition: "c", observed: "o", verdicts: '[{"key":"hyp.a","verdict":"refutes"}]' },
		strategies: [{ key: "s", plan: "p", depends_on: "hyp.a", uses: '["skill:x"]' }],
	});
	assert.deepEqual(more.tests[0].verdicts, { "hyp.a": "refutes" });
	assert.deepEqual(more.strategies[0].depends_on, ["hyp.a"]);
	assert.deepEqual(more.strategies[0].uses, ["skill:x"]);
});

// ---------------------------------------------------------------- hypothesis-strategy lifecycle
// docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md

/** Persist every row and replay from scratch, as the extension does after a restart. */
const replayed = (rows: any[]) => { const state = emptyMemory(); for (const row of rows) applyRow(state, row); return state; };

test("ls20 #5: supporting a bar hypothesis does not erase untested control hypotheses", () => {
	const state = emptyMemory();
	const rows: any[] = [];
	const step = (params: any, actions: number) => { const plan = commit(state, params, actions); rows.push(...plan.rows); return plan; };
	step({ hypotheses: [
		{ key: "move", question: "Controls", claim: "ACTION1-4 move a piece", predicts: "one object changes position" },
		{ key: "paint", question: "controls", claim: "actions recolor a region" },
		{ key: "progressive", question: "bar", claim: "every action clears one bar column" },
	] }, 4);
	const plan = step({ delete: ["hyp.move", "hyp.paint"], hypotheses: [{ key: "progressive", status: "supported",
		evidence: { action: 5, condition: "after 4 actions", observed: "c17 cleared", verdict: "supports" } }] }, 5);
	assert.match(plan.receipt, /kept as one-line notes because no refutation was recorded: hyp\.move, hyp\.paint/);
	const text = renderHypotheses(state, 11);
	assert.match(text, /question "bar":\n- hyp\.progressive \[supported\]/);
	assert.match(text, /dropped without a recorded refutation[\s\S]*- hyp\.move at #5 \("controls"\), 0 result\(s\): "ACTION1-4 move a piece"/);
	// The store replays to the same state, tombstones included.
	assert.deepEqual(replayed(rows), state);
	// Re-creating the alternative removes its note.
	step({ hypotheses: [{ key: "move", question: "controls", claim: "ACTION1-4 move a piece; #11 hit a wall" }] }, 11);
	assert.doesNotMatch(renderHypotheses(state, 11), /- hyp\.move at #5/);
	assert.match(renderHypotheses(state, 11), /- hyp\.paint at #5/);
	// A rejected hypothesis with its refutation is not kept as a note when deleted.
	step({ hypotheses: [{ key: "colour", question: "controls", claim: "actions recolor" }] }, 11);
	step({ hypotheses: [{ key: "colour", status: "rejected", evidence: { action: 3, condition: "c", observed: "o", verdict: "refutes" } }] }, 11);
	const before = state.dropped.length;
	step({ delete: ["hyp.colour"] }, 11);
	assert.equal(state.dropped.length, before);
});

test("a batch of untested alternatives dropped in one call stays visible as a whole", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: ["a", "b", "c", "d"].map((k) => ({ key: k, question: "controls", claim: `rule ${k}` })) }, 0);
	commit(state, { hypotheses: [{ key: "e", question: "controls", claim: "rule e" }] }, 3);
	commit(state, { delete: ["hyp.a", "hyp.b", "hyp.c", "hyp.d"] }, 5);
	// The first-deleted alternative is shown, not cut by a line limit.
	assert.match(renderHypotheses(state, 6), /dropped without[\s\S]*- hyp\.a at #5[\s\S]*- hyp\.d at #5/);
	// Notes from older deleting actions give way after DROPPED_CALLS later ones.
	for (const [n, key] of [[6, "f"], [7, "g"], [8, "h"]] as const) {
		commit(state, { hypotheses: [{ key, question: "goal", claim: `goal ${key}` }] }, n);
		commit(state, { delete: [`hyp.${key}`] }, n);
	}
	const text = renderHypotheses(state, 9);
	assert.doesNotMatch(text, /- hyp\.a at #5/);
	assert.match(text, /- hyp\.f at #6[\s\S]*- hyp\.h at #8/);
	assert.equal(visibleDropped(state.dropped).length, DROPPED_CALLS);
});

test("the hypothesis cap fits 2-4 rivals on each of two questions", () => {
	const rivals = (question: string, keys: string[]) => keys.map((k) => ({ key: `${question}_${k}`, question, claim: k }));
	const state = emptyMemory();
	commit(state, { hypotheses: [...rivals("controls", ["a", "b", "c", "d"]), ...rivals("goal", ["a", "b", "c", "d"])] }, 0);
	assert.equal(state.hypotheses.size, MAX_HYPOTHESES);
	const over = planMemoryUpdate(state, { hypotheses: rivals("goal", ["e"]) }, 0);
	assert.equal(over.ok, false);
	assert.match(over.ok ? "" : over.error, /max 8/);
});

test("one test updates every rival it bears on and reports the rivals it skipped", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [
		{ key: "a", question: "goal", claim: "emptying the bar wins" },
		{ key: "b", question: "goal", claim: "entering the box wins" },
		{ key: "c", question: "goal", claim: "matching the pattern wins" },
		{ key: "m", question: "controls", claim: "arrows move the block" },
	] }, 0);
	const plan = commit(state, { tests: [{ action: 9, condition: "pattern unmatched, bar empty", observed: "life lost, no level change",
		verdicts: { "hyp.a": "refutes", b: "inconclusive" } }] }, 9);
	assert.match(plan.receipt, /tests #9 → hyp\.a refutes, hyp\.b inconclusive/);
	assert.match(plan.receipt, /rivals not assessed by #9: hyp\.c/);
	assert.doesNotMatch(plan.receipt, /not assessed[^;]*hyp\.m/);        // another question
	assert.equal(state.hypotheses.get("hyp.b")!.evidence[0].condition, "pattern unmatched, bar empty");
	const text = renderHypotheses(state, 12);
	assert.match(text, /- hyp\.c \[open\] matching the pattern wins\n  last tested: never\n  not assessed by the rival test #9/);
	// A verdict for a hypothesis that does not exist refuses the whole call.
	const bad = planMemoryUpdate(state, { set: [{ key: "probe", text: "x" }],
		tests: [{ action: 9, condition: "c", observed: "o", verdicts: { "hyp.zz": "supports" } }] }, 9);
	assert.equal(bad.ok, false);
	assert.match(bad.ok ? "" : bad.error, /hyp\.zz does not exist/);
	assert.ok(!state.facts.has("probe"));
});

test("an unanswered refutation makes a hypothesis contested until the agent decides", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [{ key: "bar", question: "goal", claim: "emptying the bar wins", status: "supported" }] }, 0);
	const plan = commit(state, { hypotheses: [{ key: "bar",
		evidence: { action: 7, condition: "pattern unmatched", observed: "bar empty, life lost", verdict: "refutes" } }] }, 7);
	assert.equal(state.hypotheses.get("hyp.bar")!.status, "contested");
	assert.match(plan.receipt, /hyp\.bar \(\+evidence #7 refutes → contested\)/);
	assert.match(plan.receipt, /contested: hyp\.bar — narrow the claim/);
	assert.match(renderHypotheses(state, 8), /! refuted at #7 since its last revision/);
	// Narrowing the claim to where it held settles it without a status change.
	commit(state, { hypotheses: [{ key: "bar", claim: "emptying the bar wins only once the pattern matches" }] }, 8);
	assert.equal(state.hypotheses.get("hyp.bar")!.status, "contested");    // status is the agent's to restate
	commit(state, { hypotheses: [{ key: "bar", status: "open" }] }, 8);
	assert.equal(state.hypotheses.get("hyp.bar")!.status, "open");
	assert.equal(state.hypotheses.get("hyp.bar")!.contested_at, undefined);
	// Refuting with a narrowed claim in the same call is the agent acting on it: not contested.
	commit(state, { hypotheses: [{ key: "bar", claim: "the bar is a move budget",
		evidence: { action: 8, condition: "c", observed: "o", verdict: "refutes" } }] }, 8);
	assert.equal(state.hypotheses.get("hyp.bar")!.status, "open");
});

test("strategies name their premises; rejecting a premise suspends the active one and logs a revision", () => {
	const state = emptyMemory();
	const ctx = { skills: { bar_count: 1 }, overlay: "count the bar first" };
	commit(state, { set: [{ key: "route", text: "up, up, left" }], hypotheses: [
		{ key: "goal", question: "goal", claim: "emptying the bar wins" },
		{ key: "box", question: "goal", claim: "entering the box wins" },
		{ key: "move", claim: "arrows move the block" },
	] }, 2);
	let plan = planMemoryUpdate(state, { strategies: [{ key: "grind", plan: "keep calling ACTION1 until the bar is empty",
		depends_on: ["goal", "hyp.move"], uses: ["skill:bar_count", "prompt", "skill:missing", "memory:route"] }] }, 2, ctx);
	assert.ok(plan.ok);
	applyRows(state, plan.rows);
	assert.equal(state.strategies.get("strat.grind")!.status, "active");     // a lone new strategy defaults to active
	assert.match(plan.receipt, /strat\.grind active; premises: hyp\.goal \[open\] \(rivals: hyp\.box \[open\]\); hyp\.move \[open\] \(no recorded rival; set question/);
	assert.match(plan.receipt, /ignored uses .*skill:missing/);
	assert.match(renderStrategies(state, 10, ctx), /- strat\.grind \[active since #2, 8 actions\] keep calling ACTION1[\s\S]*depends on: hyp\.goal \[open\], hyp\.move \[open\] · uses: skill:bar_count v1, prompt, memory:route/);
	assert.ok(!planMemoryUpdate(state, { strategies: [{ key: "x", plan: "p", depends_on: ["hyp.nope"] }] }, 2).ok);

	// #10: the agent rejects the premise; the runtime suspends the strategy and snapshots what it used.
	plan = planMemoryUpdate(state, { set: [{ key: "route", text: "go to the box" }], hypotheses: [{ key: "goal", status: "rejected",
		evidence: { action: 10, condition: "bar empty, pattern unmatched", observed: "life lost", verdict: "refutes" } }] }, 10, ctx);
	assert.ok(plan.ok);
	applyRows(state, plan.rows);
	const grind = state.strategies.get("strat.grind")!;
	assert.equal(grind.status, "suspended");
	assert.equal(grind.spent, 8);
	assert.match(grind.note!, /hyp\.goal rejected after #10/);
	assert.match(plan.receipt, /"goal" still has hyp\.box \[open\] — rejecting hyp\.goal does not confirm them/);
	assert.match(plan.receipt, /strat\.grind suspended; it uses skill:bar_count, prompt, memory:route — revise or delete/);
	assert.equal(state.revisions.length, 1);
	assert.deepEqual(state.revisions[0].causes, ["hyp.goal rejected", "strat.grind suspended (hyp.goal rejected after #10)"]);

	// What the agent did afterwards: same actions, skill revised, prompt untouched, memory changed in the revision call.
	const actions = ["ACTION1", "ACTION2", "ACTION1", "ACTION1", "ACTION1", "ACTION1", "ACTION1", "ACTION1", "ACTION1", "ACTION1",
		"ACTION1", "ACTION1", "ACTION3"];
	const later = { skills: { bar_count: 2 }, overlay: "count the bar first" };
	const revisions = renderRevisions(state, actions, later);
	assert.match(revisions, /- after #10: hyp\.goal rejected; strat\.grind suspended \(hyp\.goal rejected after #10\)\. Active now: none\. /);
	assert.match(revisions, /next 3: ACTION1×2 ACTION3×1 \| 3 before: ACTION1×3/);
	assert.match(revisions, /Linked, unchanged since: prompt\. Linked, changed: skill:bar_count v1→v2, memory:route revised\./);
	assert.equal(renderRevisions(state, actions.concat(Array(30).fill("ACTION1")), later), "");   // aged out of the view

	// Activating another strategy replaces the active one; re-asserting a premise-less strategy keeps it.
	commit(state, { strategies: [{ key: "box", plan: "walk into the box", depends_on: ["box"], status: "active" }] }, 13);
	commit(state, { strategies: [{ key: "probe", plan: "probe ACTION3", status: "active" }] }, 14);
	assert.equal(state.strategies.get("strat.box")!.status, "suspended");
	assert.match(state.strategies.get("strat.box")!.note!, /replaced by strat\.probe after #14/);
	assert.match(renderMemory(state, 14, actions), /HYPOTHESES[\s\S]*STRATEGY:\n- strat\.probe \[active since #14, 0 actions\][\s\S]*REVISIONS[\s\S]*MEMORY \(1\)/);
	const two = planMemoryUpdate(state, { strategies: [{ key: "probe", status: "active" }, { key: "box", status: "active" }] }, 14);
	assert.match(two.ok ? "" : two.error, /only one strategy can be active/);
});

test("an explicit re-activation in the same call keeps a strategy whose premise was rejected", () => {
	const state = emptyMemory();
	commit(state, { hypotheses: [{ key: "a", question: "q", claim: "c" }], strategies: [{ key: "s", plan: "p", depends_on: ["a"] }] }, 1);
	commit(state, { hypotheses: [{ key: "a", status: "rejected", evidence: { action: 1, condition: "only before the switch", observed: "o", verdict: "refutes" } }],
		strategies: [{ key: "s", status: "active" }] }, 1);
	assert.equal(state.strategies.get("strat.s")!.status, "active");
	assert.match(renderStrategies(state, 1), /depends on: hyp\.a \[rejected\]/);
	// Deleting a premise also suspends, and a missing premise is shown as deleted.
	commit(state, { delete: ["hyp.a"] }, 2);
	assert.equal(state.strategies.get("strat.s")!.status, "suspended");
	assert.match(renderStrategies(state, 2), /depends on: hyp\.a \(deleted\)/);
	assert.match(state.revisions.at(-1)!.causes.join("; "), /hyp\.a deleted/);
});
