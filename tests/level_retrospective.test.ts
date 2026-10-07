import test from "node:test";
import assert from "node:assert/strict";
import { levelReviewInputContract, levelReviewWindows, validateLevelReview } from "../demo/pi_level_retrospective.ts";
import { buildOutcomeCostIndex } from "../demo/pi_outcome_cost_index.ts";

const action = (id: string, before = 0, after = 0, state = "NOT_FINISHED", name = "ACTION1") => ({
	observation_id: id, tool_name: "arc_action", input: { action: name }, recordedAt: id,
	arc_outcome: { state, levels_completed: after, public_transition: {level_before: before, level_after: after, level_changed: before !== after} },
});
const report = () => ({summary:"Solved after probing", mechanisms:"Conditional gate", shortcomings:"Repeated blocked probe",
	lessons:"Check target before moving", next_attempt:"Reuse verified path", credits:[] as any[],
	success_path:{status:"insufficient_evidence",scope:"fixture level",preconditions:[],steps:[],
		success_check:"environment reported completion",uncertainty:"No reusable rule established",reuse_advice:"Do not reuse yet"}});

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

test("uncertain harness credit may leave use stage unknown without claiming application", () => {
	const observations=[action("02"),action("03",0,1)], window=levelReviewWindows(observations)[0];
	const resources=[{resource_ref:"memory:inert-probes@v1",recordedAt:"01"}];
	const value=report(); value.credits=[{kind:"harness",target_ref:"memory:inert-probes@v1",verdict:"uncertain",
		evidence_refs:["02"],reason:"Created before reset, use unconfirmed",counterfactual:"Could have helped if selected",next_use:"Review on next attempt"}];
	const credit=validateLevelReview(window,value,observations,resources).credits[0];
	assert.equal(credit.use_stage,undefined);
	assert.equal(credit.attribution_status,"use_stage_unverified");
	value.credits[0].use_stage="invalid-stage";
	assert.throws(()=>validateLevelReview(window,value,observations,resources),/use_stage/);
	delete value.credits[0].use_stage;
	value.credits[0].verdict="positive";
	assert.throws(()=>validateLevelReview(window,value,observations,resources),/positive|use_stage/);
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

test("tool-call index uses event ordinals, separates cumulative and boundary slices, and marks cost unknown", () => {
	const windows=[{window_id:"w1",boundary_ref:"o1",boundary_tool_call_id:"a1",reasons:["reset"]},
		{window_id:"w2",boundary_ref:"o2",boundary_tool_call_id:"a2",reasons:["level_success"]}];
	const events=[
		{type:"tool_execution_start",toolCallId:"prep",toolName:"read"},
		{type:"tool_execution_end",toolCallId:"prep",toolName:"read"},
		{type:"tool_execution_start",toolCallId:"a1",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"a1",toolName:"arc_action"},
		{type:"tool_execution_start",toolCallId:"a2",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"a2",toolName:"arc_action"},
	];
	const observations=[{observation_id:"o1",toolCallId:"a1"},{observation_id:"o2",toolCallId:"a2"}];
	const first=buildOutcomeCostIndex(windows[0],windows,events,observations);
	const second=buildOutcomeCostIndex(windows[1],windows,events,observations);
	assert.equal(first.whole_level.tool_counts.read,1);
	assert.equal(second.whole_level.arc_actions,2);
	assert.equal(second.since_previous_boundary.arc_actions,1);
	assert.equal(second.calls.at(-1).call_ref,"tool_call:5:a2");
	assert.equal(second.calls.at(-1).elapsed_ms,null);
	assert.equal(second.provider_cost.attribution,"unknown");
});

test("reused toolCallIds are disambiguated by event ordinal and boundary time", () => {
	const windows=[{window_id:"w1",boundary_ref:"o1",boundary_tool_call_id:"same",reasons:["reset"],evidence_refs:["o1"]},
		{window_id:"w2",boundary_ref:"o2",boundary_tool_call_id:"same",reasons:["level_success"],evidence_refs:["o1","o2"]}];
	const events=[
		{type:"tool_execution_start",toolCallId:"same",toolName:"arc_action",recordedAt:"2026-01-01T00:00:01Z"},
		{type:"tool_execution_end",toolCallId:"same",toolName:"arc_action",recordedAt:"2026-01-01T00:00:02Z"},
		{type:"tool_execution_start",toolCallId:"same",toolName:"arc_action",recordedAt:"2026-01-01T00:00:03Z"},
		{type:"tool_execution_end",toolCallId:"same",toolName:"arc_action",recordedAt:"2026-01-01T00:00:04Z"},
	];
	const observations=[{observation_id:"o1",toolCallId:"same",recordedAt:"2026-01-01T00:00:02.001Z"},
		{observation_id:"o2",toolCallId:"same",recordedAt:"2026-01-01T00:00:04.001Z"}];
	const index=buildOutcomeCostIndex(windows[1],windows,events,observations);
	assert.equal(index.boundary_call_ref,"tool_call:3:same");
	assert.deepEqual(index.calls.map((call:any)=>call.call_ref),["tool_call:1:same","tool_call:3:same"]);
	assert.deepEqual(index.calls[1].observation_refs,[]);
	assert.equal(index.since_previous_boundary.arc_actions,1);
	assert.ok(index.gaps.includes("ambiguous_observation_join:same"));
});

test("ambiguous previous boundary does not mislabel cumulative calls as incremental cost", () => {
	const windows=[{window_id:"w1",boundary_ref:"o1",boundary_tool_call_id:"same",reasons:["reset"]},
		{window_id:"w2",boundary_ref:"o2",boundary_tool_call_id:"next",reasons:["level_success"]}];
	const events=[
		{type:"tool_execution_start",toolCallId:"same",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"same",toolName:"arc_action"},
		{type:"tool_execution_start",toolCallId:"same",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"same",toolName:"arc_action"},
		{type:"tool_execution_start",toolCallId:"next",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"next",toolName:"arc_action"},
	];
	const observations=[{observation_id:"o1",toolCallId:"same"},{observation_id:"o2",toolCallId:"next"}];
	const index=buildOutcomeCostIndex(windows[1],windows,events,observations);
	assert.equal(index.whole_level.arc_actions,3);
	assert.equal(index.since_previous_boundary,null);
	assert.equal(index.coverage,"partial");
	assert.ok(index.gaps.includes("previous_boundary_tool_event_unavailable_or_ambiguous"));
});

test("provider usage remains request-window cost instead of being assigned to tool calls", () => {
	const windows=[{window_id:"w",boundary_ref:"o",boundary_tool_call_id:"a",reasons:["level_success"]}];
	const events=[
		{type:"message_end",recordedAt:"2026-01-01T00:00:01Z",message:{usage:{input:40,output:7,totalTokens:47}}},
		{type:"tool_execution_start",toolCallId:"a",toolName:"arc_action",recordedAt:"2026-01-01T00:00:02Z"},
		{type:"tool_execution_end",toolCallId:"a",toolName:"arc_action",recordedAt:"2026-01-01T00:00:03Z"},
	];
	const index=buildOutcomeCostIndex(windows[0],windows,events,[{observation_id:"o",toolCallId:"a",recordedAt:"2026-01-01T00:00:03.001Z"}]);
	assert.equal(index.provider_cost.request_count,1);
	assert.equal(index.provider_cost.input_tokens,40);
	assert.equal(index.provider_cost.attribution,"window_only");
	assert.equal(index.provider_cost.token_status,"provider_reported");
});

test("success_path and failure-mode references are exact and outcome-gated", () => {
	const observations=[action("02"),action("03",0,1)], window=levelReviewWindows(observations)[0];
	const value=report(); value.success_path={status:"candidate",scope:"this puzzle's rule",preconditions:["read target"],
		steps:[{operation:"compare",input_or_condition:"target shown",output_or_check:"mapping found",evidence_refs:["02"],
			role:"discovery"}],success_check:"WIN state",uncertainty:"Needs a new layout",reuse_advice:"Retest before promoting"};
	assert.equal(validateLevelReview(window,value,observations,[]).success_path.status,"candidate");
	value.success_path.steps[0].call_refs=["tool_call:fake"];
	assert.throws(()=>validateLevelReview(window,value,observations,[]),/exact evidence refs/);
	delete value.success_path.steps[0].call_refs;
	value.failure_modes=[{symptom:"No transition",trigger:"blocked probe",evidence_refs:["02"],
		recovery_or_next_test:"inspect the alternate tile",applicability:"same board",confidence:"medium"}];
	assert.throws(()=>validateLevelReview(window,value,observations,[]),/falsified_hypothesis/);
});

test("a real indexed call ref is accepted by the success-path validator", () => {
	const observations=[{...action("done",0,1),toolCallId:"arc-1"}];
	const window=levelReviewWindows(observations)[0];
	const events=[
		{type:"tool_execution_start",toolCallId:"arc-1",toolName:"arc_action"},
		{type:"tool_execution_end",toolCallId:"arc-1",toolName:"arc_action"},
	];
	(window as any).tool_call_index=buildOutcomeCostIndex(window,[window],events,observations);
	const callRef=(window as any).tool_call_index.calls[0].call_ref;
	const value=report(); value.success_path={status:"candidate",scope:"same rule-shaped board",preconditions:["read target"],
		steps:[{operation:"compare target",input_or_condition:"target visible",output_or_check:"mismatch found",
			evidence_refs:["done"],call_refs:[callRef],role:"discovery"}],success_check:"level advances",
		uncertainty:"one success only",reuse_advice:"trial on the next board",
		proposed_omissions:[{call_refs:[callRef],rationale:"may be unnecessary once rule is known",risk:"could miss a changed rule",confidence:"low"}]};
	assert.deepEqual(validateLevelReview(window,value,observations,[]).success_path.steps[0].call_refs,[callRef]);
});

test("failure modes distinguish environment reset from agent-reported reset", () => {
	const reported={...action("02"),arc_outcome:{state:"NOT_FINISHED",public_transition:{reset:true},reset_report:{reason:"possible reset"}}};
	const observations=[reported], window=levelReviewWindows(observations)[0];
	const value=report(); delete value.success_path;
	value.failure_modes=[{symptom:"state reverted",trigger:"reset-like transition",evidence_refs:["02"],
		recovery_or_next_test:"verify the next public state",applicability:"only after matching transition",confidence:"low"}];
	assert.equal(validateLevelReview(window,value,observations,[]).failure_modes[0].evidence_status,"agent_reported_unverified");
	const confirmed={...reported,input:{action:"RESET"},arc_outcome:{state:"NOT_FINISHED",public_transition:{reset:true}}};
	const confirmedWindow=levelReviewWindows([confirmed])[0];
	assert.equal(validateLevelReview(confirmedWindow,value,[confirmed],[]).failure_modes[0].evidence_status,"environment_confirmed");
});
