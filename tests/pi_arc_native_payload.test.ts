import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeArcActionPayload, normalizeArcActionArguments, validateArcActionCoordinates } from "../demo/pi_arc_action_input.ts";

test("top-level decision aliases stay out of the native ARC payload", () => {
	const authored = {
		action: "ACTION4", reasoning: "Check the live frame",
		decision: { hypothesis: "A testable route", prediction: "A visible change", basis_refs: ["tool:count-grid-color@v1"] },
		subgoal: "Try one control", next_step: "Inspect the outcome",
	};
	const normalized = normalizeArcActionArguments(authored);
	assert.deepEqual(normalized.decision, {
		hypothesis: "A testable route", prediction: "A visible change", basis_refs: ["tool:count-grid-color@v1"],
		subgoal: "Try one control", next_step: "Inspect the outcome",
	});
	assert.deepEqual(nativeArcActionPayload(normalized), { action: "ACTION4", reasoning: "Check the live frame" });
	assert.equal(authored.subgoal, "Try one control");
});

test("conflicts and unknown fields are rejected before the bridge", () => {
	assert.throws(() => normalizeArcActionArguments({ action: "ACTION1", subgoal: "a", decision: { subgoal: "b" } }), /conflict.*subgoal/);
	assert.throws(() => normalizeArcActionArguments({ action: "ACTION1", secret: "do not forward" }), /unsupported.*secret/);
	assert.throws(() => normalizeArcActionArguments({ action: "ACTION1", next_step: 4 }), /next_step.*string/);
	const complex = normalizeArcActionArguments({ action: "ACTION6", x: 21, y: 32, decision: { prediction: "one cell changes" } });
	assert.deepEqual(nativeArcActionPayload(complex), { action: "ACTION6", x: 21, y: 32 });
});

test("misnested next_step preserves authored decision without another model turn", () => {
	const authored={action:"ACTION4",decision:{next_step:"Map the remaining control",
		knowledge:{next_step:"Then compare the resulting configuration",known_effects:["A measured displacement"]}}};
	const normalized=normalizeArcActionArguments(authored);
	assert.deepEqual(normalized.decision,{next_step:"Map the remaining control",knowledge:{
		next_decision:"Then compare the resulting configuration",known_effects:["A measured displacement"]}});
	assert.equal(authored.decision.knowledge.next_step,"Then compare the resulting configuration");
	assert.deepEqual(nativeArcActionPayload(normalized),{action:"ACTION4"});
	assert.throws(()=>normalizeArcActionArguments({action:"ACTION1",decision:{knowledge:{next_step:"a",next_decision:"b"}}}),/conflict.*next_decision/);
	assert.throws(()=>normalizeArcActionArguments({action:"ACTION1",decision:{next_decision:"a",knowledge:{next_step:"b"}}}),/conflict.*next_decision/);
	assert.equal(normalizeArcActionArguments({action:"ACTION1",decision:{knowledge:{next_step:"a",next_decision:"a"}}}).decision.knowledge.next_decision,"a");
});

test("ACTION6 native fields nested in decision move only without conflicts", () => {
	const authored = {action:"ACTION6", decision:{x:48,y:12,reasoning:"Exact authored intent",prediction:"A test"}};
	const result = normalizeArcActionArguments(authored);
	assert.deepEqual(nativeArcActionPayload(result), {action:"ACTION6",x:48,y:12,reasoning:"Exact authored intent"});
	assert.deepEqual(result.decision, {prediction:"A test"});
	assert.equal(authored.decision.x,48);
	assert.deepEqual(normalizeArcActionArguments({...authored,x:48,y:12}).decision,{prediction:"A test"});
	for (const key of ["x","y","reasoning"]) {
		assert.throws(() => normalizeArcActionArguments({...authored,[key]:key==="reasoning"?"different":1}), /conflict/);
	}
});

test("ACTION6 coordinates reject before writes; simple actions retain ignored-coordinate semantics", () => {
	for (const value of [undefined, null, "12", 12.5, -1, 64, NaN, Infinity]) {
		assert.throws(() => validateArcActionCoordinates({action:"ACTION6",x:value,y:12}), /integer.*0\.\.63/);
	}
	assert.throws(() => normalizeArcActionArguments({action:"ACTION6",decision:{x:12.5,y:12}}), /integer/);
	assert.throws(() => normalizeArcActionArguments({action:"ACTION6",decision:{x:12}}), /integer/);
	assert.throws(() => normalizeArcActionArguments({action:"ACTION1",decision:{reasoning:7}}), /reasoning.*string/);
	validateArcActionCoordinates({action:"ACTION1"});
	const simple=normalizeArcActionArguments({action:"ACTION1",decision:{x:3,y:4}});
	assert.equal(simple.x,undefined);
	assert.deepEqual(simple.decision,{x:3,y:4});
});
