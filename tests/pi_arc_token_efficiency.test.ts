import {test} from "node:test";
import assert from "node:assert/strict";
import {renderArcObservationWindow} from "../demo/pi_arc_observation_window.ts";
import {compactHistoricalArcFrames} from "../demo/pi_arc_context_projection.ts";
import {researchActionContinuation} from "../demo/pi_auto_research_output.ts";

test("equal action-result and current grids retain their roles but send pixels once", () => {
    const grid=[[9,8],[0,2]];
    const view=renderArcObservationWindow([{event:"action",index:1,action:"ACTION6",
        observation_delta:{changed_cells:1},frame:{frames:[grid]}}],{frames:[grid]},{includeImages:true});
    assert.equal(view.images.length,1);
    assert.equal(view.text.split("98\n02").length-1,1);
    assert.match(view.text,/ACTION\/RESULT arc-action-1/);
    assert.match(view.text,/same exact pixels as current_state_frame/);
    assert.match(view.text,/Grid current_state_frame/);
});

test("a candidate-linked executed research probe is previous work, not a fresh next step",()=>{
    const report={candidate_updates:[{id:"op"}],research_progress:{parent_relevance:"now",next_step:"Try another surface"},
        experiment_request:{as_of_event:"e1",parent_action:"Try another surface"},limitations:["Goal unknown"]};
    const observations=[{observation_id:"e1",tool_name:"arc_action",input:{action:"ACTION6"}},
        {observation_id:"e2",tool_name:"arc_action",input:{action:"ACTION6",x:7,y:9,decision:{selection:{candidate_id:"op"}}},
            arc_outcome:{action_target_cell:{before:9,after:8},public_transition:{level_changed:false},observation_delta:{changed_cells:36}}}];
    const result=researchActionContinuation(report,"research_report:r@v1",observations);
    assert.equal(result.next_step,undefined);
    assert.equal(result.next_experiment,undefined);
    assert.equal(result.previous_proposal.next_step,"Try another surface");
    assert.equal(result.followup_evidence.linked_action_count,1);
    assert.equal(result.followup_evidence.receipts[0].level_changed,false);
    assert.match(result.epistemic_status,/not_semantically_validated/);
    assert.equal(researchActionContinuation(report,"r",observations.slice(0,1)).next_step,"Try another surface");
    assert.equal(researchActionContinuation(report,"r",[{...observations[1],is_error:true}]).next_step,"Try another surface");
});

test("distinct transient pixels remain available alongside the complete current frame", () => {
    const view=renderArcObservationWindow([{event:"action",index:1,action:"ACTION6",
        observation_delta:{changed_cells:0},frame:{frames:[[[2,0]],[[0,0]]]}}],
        {frames:[[[0,0]]]},{includeImages:true});
    assert.equal(view.images.length,2);
    assert.match(view.text,/transient_animation=true/);
    assert.match(view.text,/Grid arc-action-1_frame_0.*\n20/s);
    assert.match(view.text,/Grid current_state_frame.*\n00/s);
});

test("proposal retirement never guesses an action link or discards unverified goal work", () => {
    const report={candidate_updates:[{id:"goal"},{}],research_progress:{parent_relevance:"now",next_step:"Test the full target"},
        experiment_request:{as_of_event:"observation:e1@v1",parent_action:"Test the full target"},
        limitations:["Target completion remains unverified"]};
    const cutoff={observation_id:"e1",tool_name:"arc_action",input:{decision:{hypothesis_id:"goal"}}};
    const action={observation_id:"e2",tool_name:"arc_action",input:{action:"ACTION6",decision:{}},
        arc_outcome:{public_transition:{level_changed:false},observation_delta:{changed_cells:36}}};
    for(const decision of [{},{selection:{candidate_id:"other"}}]) {
        const result=researchActionContinuation(report,"r",[cutoff,{...action,input:{...action.input,decision}}]);
        assert.equal(result.next_step,"Test the full target");
        assert.equal(result.followup_evidence.linked_action_count,0);
    }
    const linked={...action,input:{...action.input,decision:{hypothesis_id:"goal"}}};
    const result=researchActionContinuation(report,"r",[cutoff,linked]);
    assert.equal(result.previous_proposal.next_experiment.parent_action,"Test the full target");
    assert.deepEqual(result.limitations,["Target completion remains unverified"]);
    assert.equal(result.followup_evidence.receipts[0].level_changed,false);
    assert.match(result.epistemic_status,/not_semantically_validated/);
    assert.equal(researchActionContinuation(report,"r",[cutoff,{...linked,is_error:true}]).next_step,"Test the full target");
    // Report publication is newer than these actions: they cannot consume its proposal.
    assert.equal(researchActionContinuation(report,"r",[{...cutoff,recordedAt:"2026-10-02T00:00:00Z"},
        {...linked,recordedAt:"2026-10-02T00:00:01Z"}],"2026-10-02T00:00:02Z").next_step,"Test the full target");
});

test("repeated identical cycle instructions are folded without losing recovery or tool pairs", () => {
    const instruction={role:"user",content:[{type:"text",text:"ARC decision-cycle contract: same guidance"}]};
    const assistant={role:"assistant",content:[{type:"toolCall",id:"a",name:"arc_action",arguments:{}}]};
    const result={role:"toolResult",toolCallId:"a",toolName:"arc_action",content:[{type:"text",text:"result"}]};
    const recovery={role:"user",content:[{type:"text",text:"Length recovery: preserve unfinished work"}]};
    const projected=compactHistoricalArcFrames([instruction,assistant,result,recovery,instruction]);
    assert.deepEqual(projected,[assistant,result,recovery,instruction]);
});
