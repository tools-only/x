import test from "node:test";
import assert from "node:assert/strict";
import { levelReviewInputContract, levelReviewWindows, validateLevelReview } from "../demo/pi_level_retrospective.ts";

const action = (id: string, before = 0, after = 0, state = "NOT_FINISHED", name = "ACTION1") => ({
	observation_id: id, tool_name: "arc_action", input: { action: name }, recordedAt: id,
	arc_outcome: { state, levels_completed: after, public_transition: {level_before: before, level_after: after, level_changed: before !== after} },
});
const report = () => ({summary:"Solved after probing", mechanisms:"Conditional gate", shortcomings:"Repeated blocked probe",
	lessons:"Check target before moving", next_attempt:"Reuse verified path", credits:[] as any[]});

test("reset retains full level history; success starts a new level; duplicate events ignored", () => {
	const reset = action("02",0,0,"NOT_FINISHED","RESET");
	const windows = levelReviewWindows([action("01"), reset, reset, action("03",0,1), action("04",1,1,"GAME_OVER")]);
	assert.deepEqual(windows.map(w=>w.reasons), [["reset"],["level_success"],["game_failure"]]);
	assert.deepEqual(windows.map(w=>w.action_refs), [["01","02"],["01","02","03"],["04"]]);
	assert.equal(windows[1].attempt,2);
	assert.deepEqual(levelReviewWindows([action("01"),reset,action("03",0,1),action("04",1,1,"GAME_OVER")]),windows);
});
test("failed calls and pixel deltas do not invent reset; WIN and exhausted budget are boundaries", () => {
	assert.equal(levelReviewWindows([{...action("01"),is_error:true}, {...action("02"),changed_cells:146}]).length,0);
	assert.deepEqual(levelReviewWindows([action("03",0,0,"WIN")])[0].reasons,["level_success"]);
	const exhausted=action("04"); (exhausted.arc_outcome as any).action_budget={total_used:10,total_maximum:10};
	assert.deepEqual(levelReviewWindows([exhausted])[0].reasons,["game_failure"]);
});
test("positive credit requires actual application and exact in-window evidence", () => {
	const observations=[action("02"),action("03",0,1)], window=levelReviewWindows(observations)[0];
	const resources=[{resource_ref:"skill:reader@v1",recordedAt:"01"}];
	const value=report(); value.credits=[{kind:"harness",target_ref:"skill:reader@v1",verdict:"positive",use_stage:"exposed",
		evidence_refs:["02"],reason:"Prediction matched",counterfactual:"Memory could also explain it",next_use:"Retest next level"}];
	assert.throws(()=>validateLevelReview(window,value,observations,resources),/alone/);
	Object.assign(value.credits[0],{use_stage:"applied",application_ref:"02"});
	assert.equal(validateLevelReview(window,value,observations,resources).credits[0].attribution_status,"agent_assessed_not_causal_proof");
	value.credits[0].evidence_refs=["missing"];
	assert.throws(()=>validateLevelReview(window,value,observations,resources),/exact evidence/);
});
test("future resources and application before creation cannot receive retrospective credit", () => {
	const observations=[action("02"),action("03",0,1)], window=levelReviewWindows(observations)[0];
	const value=report(); value.credits=[{kind:"harness",target_ref:"memory:map@v2",verdict:"positive",use_stage:"applied",
		application_ref:"02",evidence_refs:["02"],reason:"Used map",counterfactual:"Uncertain",next_use:"Check map"}];
	assert.throws(()=>validateLevelReview(window,value,observations,[{resource_ref:"memory:map@v2",recordedAt:"04"}]),/after the outcome/);
	assert.throws(()=>validateLevelReview(window,value,observations,[{resource_ref:"memory:map@v2",recordedAt:"03"}]),/predates/);
});

test("review input contract separates exact behavior, evidence, and per-resource application candidates", () => {
	const observations=[action("01"), {...action("02"),is_error:true}, action("03",0,1)];
	const window=levelReviewWindows(observations)[0];
	const contract=levelReviewInputContract(window,observations,[
		{resource_ref:"skill:reader@v1",recordedAt:"01.5"},
		{resource_ref:"memory:future@v1",recordedAt:"04"},
	]);
	assert.deepEqual(contract.behavior_target_ref_candidates,["01","02","03"]);
	assert.deepEqual(contract.evidence_ref_candidates,["01","02","03"]);
	assert.deepEqual(contract.harness_targets,[{
		target_ref:"skill:reader@v1",
		application_ref_candidates:["03"],
	}]);
	assert.equal(contract.empty_credits_allowed,true);
});
