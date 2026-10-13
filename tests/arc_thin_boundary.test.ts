import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, isEnvironmentFailure, parseLooseJson, repairActionArguments, repairMemoryArguments, repairSkillArguments } from "../demo/arc_thin_boundary.ts";
import { applyRows, emptyMemory, planMemoryUpdate } from "../demo/arc_thin_memory.ts";

// Shapes taken from refused memory calls in the 2026-10-09 thin-hyp runs (pi-events.jsonl).

test("a skill source sent with escaped line breaks is unescaped once; a source with real line breaks is left alone", () => {
	const escaped = String.raw`def run(state, args):\n    return {"s": "a\\nb", "q": \"x\"}\n`;
	assert.equal(repairSkillArguments({ op: "set", name: "s", source: escaped }).source,
		'def run(state, args):\n    return {"s": "a\\nb", "q": "x"}\n');
	const real = 'def run(state, args):\n    return "a\\nb"\n';
	assert.equal(repairSkillArguments({ op: "set", name: "s", source: real }).source, real);
	assert.equal(repairSkillArguments({ name: "s", source: escaped }).op, "set");
});

test("an evidence list becomes one appended result per entry", () => {
	const args = repairMemoryArguments({ hypotheses: [{ key: "hyp.a", claim: "c", evidence: [
		{ action: 1, condition: "first", observed: "o1", verdict: "supports" },
		{ action: 2, condition: "second", observed: "o2", verdict: "refutes" },
	] }] });
	assert.equal(args.hypotheses.length, 2);
	assert.equal(args.hypotheses[0].evidence.action, 1);
	assert.deepEqual(args.hypotheses[1], { key: "hyp.a", evidence: { action: 2, condition: "second", observed: "o2", verdict: "refutes" } });
	const state = emptyMemory();
	const plan = planMemoryUpdate(state, args, 2);
	assert.ok(plan.ok, plan.ok ? "" : plan.error);
	applyRows(state, plan.rows);
	assert.deepEqual(state.hypotheses.get("hyp.a")!.evidence.map((e) => e.action), [1, 2]);
	// A JSON-string list is repaired first, then expanded.
	const fromString = repairMemoryArguments({ hypotheses: [{ key: "hyp.a", evidence: JSON.stringify([{ condition: "c", observed: "o", verdict: "supports" }]) }] });
	assert.equal(fromString.hypotheses[0].evidence.verdict, "supports");
});

test("over-long strings are clipped to the documented limit instead of refusing the call", () => {
	const long = "x".repeat(900);
	const args = repairMemoryArguments({ key: "notes", text: long, hypotheses: [{ key: "hyp.a", claim: long, evidence: { condition: long, observed: long, verdict: "supports" } }] });
	assert.equal(args.text.length, LIMITS.text);
	assert.ok(args.text.endsWith("…"));
	assert.equal(args.hypotheses[0].claim.length, LIMITS.claim);
	assert.equal(args.hypotheses[0].evidence.condition.length, LIMITS.condition);
	assert.equal(repairMemoryArguments({ set: [{ key: "k", text: long }] }).set[0].text.length, LIMITS.text);
});

test("hypothesis and strategy keys sent through set are routed to their own fields", () => {
	const args = repairMemoryArguments({ set: [{ key: "hyp.goal", text: "the goal is X" }, { key: "plan", text: "p" }, { key: "strat.s", text: "do Y" }] });
	assert.deepEqual(args.set, [{ key: "plan", text: "p" }]);
	assert.deepEqual(args.hypotheses, [{ key: "hyp.goal", claim: "the goal is X" }]);
	assert.deepEqual(args.strategies, [{ key: "strat.s", plan: "do Y" }]);
	const single = repairMemoryArguments({ op: "set", key: "hyp.box", text: "entering the box wins" });
	assert.deepEqual(single, { hypotheses: [{ key: "hyp.box", claim: "entering the box wins" }] });
	const state = emptyMemory();
	assert.ok(planMemoryUpdate(state, single, 0).ok);
	// Only a set is routed; a delete of a hypothesis key is left alone.
	assert.deepEqual(repairMemoryArguments({ op: "delete", key: "hyp.box" }), { op: "delete", key: "hyp.box" });
});

test("an unknown memory op is dropped when batch fields say what to do", () => {
	assert.deepEqual(repairMemoryArguments({ op: "update_hypotheses", hypotheses: [{ key: "hyp.a", claim: "c" }] }),
		{ hypotheses: [{ key: "hyp.a", claim: "c" }] });
	assert.equal(repairMemoryArguments({ op: "list" }).op, "list");
	assert.equal(repairMemoryArguments({ op: "get" }).op, "list");               // ls20 board r2
	assert.equal(repairMemoryArguments({ op: "remove", key: "plan" }).op, "delete");
	// op "update" with a hypothesis key and text (ls20 A): routed to hypotheses.
	assert.deepEqual(repairMemoryArguments({ op: "update", key: "hyp.goal", text: "the goal is X", confidence: 4 }),
		{ confidence: 4, hypotheses: [{ key: "hyp.goal", claim: "the goal is X" }] });
	assert.equal(repairMemoryArguments(null), null);
});

test("a JSON string missing its closing brackets is completed; nulls mean not given", () => {
	// thin-final-ls20-20261009: strategies arrived as "\n[{...}\n" (no closing bracket) and was refused.
	const truncated = "\n[{\"key\": \"strat.s\", \"plan\": \"p [x]\", \"status\": \"active\", \"depends_on\": [\"hyp.a\"], \"uses\": [\"prompt\"]}\n";
	assert.deepEqual(parseLooseJson(truncated), [{ key: "strat.s", plan: "p [x]", status: "active", depends_on: ["hyp.a"], uses: ["prompt"] }]);
	assert.deepEqual(parseLooseJson("[{\"key\": \"a\", \"text\": \"unterminated"), [{ key: "a", text: "unterminated" }]);
	assert.equal(parseLooseJson("[{\"a\": 1}}"), undefined);                  // mismatched: not repaired
	assert.equal(parseLooseJson("plain text"), undefined);
	const repaired = repairMemoryArguments({ set: [{ key: "k", text: "t" }], strategies: truncated });
	assert.equal(repaired.strategies[0].key, "strat.s");
	assert.deepEqual(repaired.strategies[0].depends_on, ["hyp.a"]);
	// Same run: evidence: null alongside a status change.
	const nulls = repairMemoryArguments({ hypotheses: [{ key: "hyp.a", claim: "c", status: "supported", evidence: null }], tests: null });
	assert.deepEqual(nulls, { hypotheses: [{ key: "hyp.a", claim: "c", status: "supported" }] });
	assert.ok(planMemoryUpdate(emptyMemory(), nulls, 0).ok);
});

test("skill op is inferred from the fields present; arc_action notes are clipped", () => {
	assert.equal(repairSkillArguments({ name: "count", source: "def run(state, args):\n    return 1\n" }).op, "set");
	assert.equal(repairSkillArguments({ name: "count" }).op, "get");
	assert.equal(repairSkillArguments({ op: "save", name: "count", source: "def run(s,a): return 1" }).op, "set");
	assert.deepEqual(repairSkillArguments({ op: "delete", name: "count" }), { op: "delete", name: "count" });
	const action = repairActionArguments({ action: "ACTION1", note: `${"why ".repeat(120)}\n` });
	assert.equal(action.note.length, LIMITS.note);
	assert.deepEqual(repairActionArguments({ action: "ACTION2" }), { action: "ACTION2" });
	// A then list: names or a JSON string become steps; a malformed step prediction is dropped; an unusable list goes.
	assert.deepEqual(repairActionArguments({ action: "ACTION1", then: ["action4", { action: "ACTION2", predict: 7 }] }).then,
		[{ action: "ACTION4" }, { action: "ACTION2" }]);
	assert.deepEqual(repairActionArguments({ action: "ACTION1", then: '["ACTION3"]' }).then, [{ action: "ACTION3" }]);
	assert.deepEqual(repairActionArguments({ action: "ACTION1", then: "ACTION3, ACTION4" }).then, [{ action: "ACTION3" }, { action: "ACTION4" }]);
	assert.equal("then" in repairActionArguments({ action: "ACTION1", then: [5, null] }), false);
});

test("environment failures are told apart from the agent's invalid actions", () => {
	const http = (status: number, message: string) => Object.assign(new Error(message), { status });
	assert.equal(isEnvironmentFailure(http(502, "ARC environment step failed: EnvironmentReturnedNoFrame: step returned None")), true);
	assert.equal(isEnvironmentFailure(http(500, "internal error")), true);
	assert.equal(isEnvironmentFailure(http(400, "action 'ACTION5' is not currently available")), false);
	assert.equal(isEnvironmentFailure(http(400, "complex ARC actions require exactly integer x and y")), false);
	assert.equal(isEnvironmentFailure(http(403, "owner action token required")), false);
	assert.equal(isEnvironmentFailure(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), true);
	assert.equal(isEnvironmentFailure(new TypeError("fetch failed")), true);
	assert.equal(isEnvironmentFailure(new Error("PI_ARC_BRIDGE_URL is not set")), false);
});
