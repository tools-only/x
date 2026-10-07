import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";
import { decisionCardV2 } from "../demo/pi_decision_card.ts";
import { arcDecisionFeedback, arcProbeCoverage } from "../demo/pi_arc_decision_feedback.ts";
import { normalizeAutoResearchReport, researchActionContinuation } from "../demo/pi_auto_research_output.ts";
import { buildCrossContextComparison, crossContextComparisonForChild } from "../demo/pi_research_method_runtime.ts";
import { installProviderTelemetry } from "../demo/pi_provider_telemetry.ts";
import { arcActionCoordinates, arcActionCoordinateText } from "../demo/pi_arc_action_input.ts";
import { arcSparseDecisionChangeGroups } from "../demo/pi_arc_context_projection.ts";

test("first model delta is logged once per attempt without saving partials and exposes actual effort", () => {
    const root=mkdtempSync(join(tmpdir(),"first-delta-")), hooks:any={};
    installProviderTelemetry({on(n,f){hooks[n]=f;}} as any,{root});
    hooks.before_provider_request({payload:{reasoning_effort:"low",messages:[]}});
    hooks.message_update({assistantMessageEvent:{type:"thinking_start"}});
    hooks.message_update({assistantMessageEvent:{type:"thinking_delta",delta:"one",partial:{secret:"not captured"}}});
    hooks.message_update({assistantMessageEvent:{type:"text_delta",delta:"two"}});
    hooks.message_end({message:{role:"assistant",stopReason:"stop",usage:{input:1,output:2}}});
    const text=readFileSync(join(root,"provider-telemetry.jsonl"),"utf8"),rows=text.trim().split("\n").map(JSON.parse);
    assert.equal(rows.filter(r=>r.event==="provider_first_model_delta").length,1);
    assert.equal(rows.find(r=>r.event==="provider_request").reasoning_effort,"low");
    assert.ok(rows.find(r=>r.event==="assistant_message").first_model_delta_ms!==null);
    assert.ok(!text.includes("not captured"));
});

test("real ARC comparison projection keeps coordinates and distinguishes animation fingerprints", () => {
    const rows=[{observation_id:"o1",tool_name:"arc_action",input:{action:"ACTION6",x:46,y:46,reasoning:"probe"},
        arc_outcome:{pre_action_state:{fingerprint:"animation"},observation_delta:{changed_cells:0},action_target_cell:{before:8,after:8}}}];
    const comparison=crossContextComparisonForChild(buildCrossContextComparison({observations:rows,explicitEvidenceRefs:["o1"]}));
    const card=comparison.evidence_cards[0];
    assert.deepEqual(card.input,{action:"ACTION6",x:46,y:46});
    assert.deepEqual(card.public_result.action_target_cell,{before:8,after:8});
    assert.ok(card.pre_action_condition.fingerprint_scope.includes("animation"));
    assert.ok(card.input_projection.omitted_fields.includes("reasoning"));
});

test("editable OpenAI field history keeps current transaction and exact recovery while preserving conclusions", async () => {
    const old = { role: "assistant", provider: "yibu", api: "openai-completions", stopReason: "toolUse", content: [
        { type: "thinking", thinkingSignature: "reasoning_content", thinking: "analysis ".repeat(3000) + "COUNTEREXAMPLE still open" },
        { type: "text", text: "Current hypothesis is uncertain" },
        { type: "toolCall", id: "a", name: "arc_action", arguments: { action: "ACTION6", x: 3, y: 4 } }] };
    const current = { ...old, content: [...old.content.slice(0, 2), { type: "toolCall", id: "b", name: "arc_action", arguments: { x: 8, y: 9 } }] };
    const messages = [{role:"user",content:[{type:"text",text:"task"}]}, old,
        {role:"toolResult", toolCallId:"a",toolName:"arc_action",content:[{type:"text",text:"zero delta"}]}, current,
        {role:"toolResult",toolCallId:"b",toolName:"arc_action",content:[{type:"text",text:"CURRENT FULL GRID AND PNG"}]}];
    for (const providers of [[], ["other"], ["yibu"]]) {
        const root = mkdtempSync(join(tmpdir(), "field-history-")), handlers: any = {};
        installTaskLocalContextLifecycle({on(n,f){handlers[n]=f;},registerTool(){}} as any,
            {root,maxChars:400000,reasoningHistoryPolicy:"summarize_openai_field",editableReasoningProviders:providers} as any);
        const result = (await handlers.context({messages})).messages;
        assert.deepEqual(result.find(m=>m.role==="assistant" && m.content.some(p=>p.id==="b")), current);
        assert.deepEqual(result.at(-1),messages.at(-1));
        const projected = result.find(m=>m.role==="assistant" && m.content.some(p=>p.id==="a"));
        if (!providers.includes("yibu")) assert.deepEqual(projected,old);
        else {
            assert.ok(JSON.stringify(projected).length < 4000);
            assert.ok(JSON.stringify(projected).includes("COUNTEREXAMPLE still open"));
            assert.deepEqual(projected.content.slice(-2),old.content.slice(-2));
            const archived = readFileSync(join(root,"task-context-cache","messages.jsonl"),"utf8");
            assert.ok(archived.includes(old.content[0].thinking));
        }
    }
});

test("continuations and signed/opaque fields never use editable field summary", async () => {
    for (const stopReason of ["length","error","aborted","toolUse"]) {
        const blocks = [{type:"thinking",thinking:"x".repeat(10000),thinkingSignature:"native-signature"},
            {type:"reasoning",encrypted_content:"opaque"}];
        if(stopReason!=="toolUse") blocks.push({type:"thinking",thinking:"y".repeat(10000),thinkingSignature:"reasoning_content"});
        const old = {role:"assistant",api:"openai-completions",provider:"yibu",stopReason,content:[...blocks,{type:"toolCall",id:"a",name:"t",arguments:{}}]};
        const handlers:any={};
        installTaskLocalContextLifecycle({on(n,f){handlers[n]=f;},registerTool(){}} as any,
            {root:mkdtempSync(join(tmpdir(),"field-protocol-")),maxChars:400000,reasoningHistoryPolicy:"summarize_openai_field",editableReasoningProviders:["yibu"]} as any);
        const result=await handlers.context({messages:[old,{role:"toolResult",toolCallId:"a",content:[]},{role:"assistant",content:[{type:"text",text:"later"}]}]});
        assert.deepEqual(result.messages.find(m=>m.role==="assistant" && m.content.some(p=>p.id==="a")),old);
    }
});

test("decision card counts real distinct targets instead of accepting 28-location premise", () => {
    const actions = Array.from({length:28},(_,i)=>({action:"ACTION6",x:i<23?46:28,y:i<23?46:28,changed_cells:0,observation_id:`e${i}`}));
    const card = decisionCardV2({recent_actions:actions}, {}, "checkpoint:t@v1");
    assert.equal(card.probe_coverage.unique_targets,2);
    assert.equal(card.probe_coverage.repeated_attempts,26);
    assert.equal(card.probe_coverage.targets[0].attempts,23);
    const next=decisionCardV2({recent_actions:[...actions,{action:"RESET",changed_cells:0},{action:"ACTION6",x:1,y:2,changed_cells:undefined}]},{},"c");
    assert.equal(next.probe_coverage.unique_targets,0);
});

test("spatial contrasts do not keep sampling the same already-tested connected patch", () => {
    const grid=Array.from({length:12},(_,y)=>Array.from({length:12},(_,x)=>x<3&&y<3?9:x>=9&&y>=9?9:5));
    const actions=[{action:"ACTION6",x:1,y:1,changed_cells:0},{action:"ACTION6",x:1,y:1,changed_cells:0}];
    const text=arcDecisionFeedback(actions,grid)!.text;
    assert.ok(text.includes("(10,10)"));
    assert.ok(!text.includes("arc_state crop"));
    assert.ok(!text.includes("sample (1,0)"));
});

test("simple ARC actions with ignored coordinates do not count as coordinate probes", () => {
    const actions = [{action:"ACTION1",x:21,y:32,changed_cells:52,observation_id:"a"},
        {action:"ACTION1",x:22,y:32,changed_cells:52,observation_id:"b"}];
    assert.equal(arcProbeCoverage(actions).unique_targets,0);
    assert.equal(arcProbeCoverage(actions).actions,0);
    assert.deepEqual(arcProbeCoverage([...actions,{action:"ACTION6",x:22,y:32,changed_cells:1}]).targets,
        [{action:"ACTION6",x:22,y:32,attempts:1,visible_effects:1,last_observation_ref:null}]);
});

test("simple controls cannot establish a repeated clicked-pixel transition", () => {
    const actions = [{action:"ACTION1",x:21,y:32,changed_cells:52,observation_id:"a",target_cell:{before:8,after:9}},
        {action:"ACTION1",x:21,y:32,changed_cells:52,observation_id:"b",target_cell:{before:9,after:8}}];
    const result=arcDecisionFeedback(actions);
    assert.ok(!result?.text.includes("SAME ACTION/COORDINATE"));
    assert.ok(!result?.text.includes("clicked pixel"));
});

test("multi-region public change gives one exact-reference hypothesis cue", () => {
    const groups=[{changed_cells:50,bbox:{min_x:10,max_x:19,min_y:10,max_y:19}},
        {changed_cells:4,bbox:{min_x:3,max_x:4,min_y:57,max_y:58}},
        {changed_cells:4,bbox:{min_x:7,max_x:8,min_y:57,max_y:58}}];
    const actions=[{action:"ACTION4",changed_cells:52,observation_id:"o1",level_after:0},
        {action:"ACTION4",changed_cells:58,observation_id:"o2",level_after:0,change_groups:groups}];
    const cue=arcDecisionFeedback(actions)!;
    assert.equal(cue.signature,"multi-region-change:o2");
    assert.ok(cue.text.includes("observation:o2@v1"));
    assert.ok(cue.text.includes('"cells":50') && cue.text.includes('"cells":4'));
    assert.ok(cue.text.includes("Compare the current goal hypothesis and a distinct alternative"));
    assert.ok(cue.text.includes("do not establish a gate, target, or progress"));
    const afterOne=arcDecisionFeedback([...actions,{action:"ACTION4",changed_cells:2,observation_id:"o3"}])!;
    assert.equal(afterOne.signature,cue.signature);
    assert.ok(afterOne.text.includes("1 later native actions occurred"));
});

test("batch member multi-region evidence survives seven later actions and respects state boundaries", () => {
    const groups=[{changed_cells:50,bbox:{top:25,left:19,bottom:34,right:23}},
        {changed_cells:4,bbox:{top:57,left:3,bottom:58,right:4}},
        {changed_cells:4,bbox:{top:57,left:7,bottom:58,right:8}}];
    const source={action:"ACTION2",changed_cells:58,observation_id:"execution-observation-33",change_groups:groups};
    const later=Array.from({length:7},(_,i)=>({action:"ACTION1",changed_cells:i?2:52,observation_id:`later-${i+1}`}));
    const feedback=arcDecisionFeedback([source,...later])!;
    assert.equal(feedback.signature,"multi-region-change:execution-observation-33");
    assert.ok(feedback.text.includes("7 later native actions occurred"));
    assert.ok(feedback.text.includes("recheck the complete current frame"));
    assert.ok(!arcDecisionFeedback([source,...later,{action:"ACTION1",changed_cells:2}])?.signature.startsWith("multi-region-change"));
    assert.ok(!arcDecisionFeedback([source,{action:"RESET",changed_cells:0},later[0]])?.signature.startsWith("multi-region-change"));
    assert.ok(!arcDecisionFeedback([source,{action:"ACTION1",changed_cells:2,level_changed:true},later[0]])?.signature.startsWith("multi-region-change"));
});

test("multi-region cue excludes ordinary, reset, level, missing and fragmented effects", () => {
    const large={changed_cells:50,bbox:{min_x:0,max_x:9,min_y:0,max_y:9}};
    const small={changed_cells:4,bbox:{min_x:3,max_x:4,min_y:57,max_y:58}};
    const base={action:"ACTION4",changed_cells:58,observation_id:"o2",level_after:0};
    const cue=(action:Record<string,unknown>)=>arcDecisionFeedback([{action:"ACTION1",changed_cells:52,observation_id:"o1"},action])?.signature.startsWith("multi-region-change") ?? false;
    assert.equal(cue({...base,change_groups:[large,{changed_cells:2,bbox:small.bbox}]}),false);
    assert.equal(cue({...base,changed_cells:2,change_groups:[]}),false);
    assert.equal(cue({...base,action:"RESET",change_groups:[large,small,small]}),false);
    assert.equal(cue({...base,level_changed:true,change_groups:[large,small,small]}),false);
    assert.equal(cue({...base,change_groups:undefined}),false);
    assert.equal(cue({...base,change_groups:[large,...Array.from({length:8},()=>small)]}),false);
});

test("sparse change groups require complete non-reset, non-level public deltas", () => {
    const groups=[{changed_cells:50,bbox:{top:1,left:1,bottom:10,right:5}},
        {changed_cells:4,bbox:{top:57,left:3,bottom:58,right:4}},
        {changed_cells:4,bbox:{top:57,left:7,bottom:58,right:8}}];
    const complete={changed_cells:58,cells:Array.from({length:58},(_,row)=>({row,col:0})),cells_truncated:false};
    assert.deepEqual(arcSparseDecisionChangeGroups(complete,groups,"ACTION2",false),groups);
    assert.equal(arcSparseDecisionChangeGroups({...complete,cells_truncated:true},groups,"ACTION2",false),undefined);
    assert.equal(arcSparseDecisionChangeGroups({...complete,cells:complete.cells.slice(0,57)},groups,"ACTION2",false),undefined);
    assert.equal(arcSparseDecisionChangeGroups({...complete,cells:undefined},groups,"ACTION2",false),undefined);
    assert.equal(arcSparseDecisionChangeGroups(complete,groups,"RESET",false),undefined);
    assert.equal(arcSparseDecisionChangeGroups(complete,groups,"ACTION2",true),undefined);
    assert.equal(arcSparseDecisionChangeGroups(complete,[groups[0],{changed_cells:2,bbox:groups[1].bbox}],"ACTION2",false),undefined);
    assert.equal(arcSparseDecisionChangeGroups(complete,[...groups,...Array.from({length:6},()=>groups[1])],"ACTION2",false),undefined);
});

test("two large regions plus a separate four-cell region are a bounded multi-region event", () => {
    const groups=[{changed_cells:25,bbox:{top:30,left:34,bottom:34,right:38}},
        {changed_cells:25,bbox:{top:45,left:34,bottom:49,right:38}},
        {changed_cells:84,bbox:{top:61,left:13,bottom:62,right:54}},
        {changed_cells:4,bbox:{top:61,left:62,bottom:62,right:63}}];
    const complete={changed_cells:138,cells:Array.from({length:138},(_,row)=>({row,col:0})),cells_truncated:false};
    assert.deepEqual(arcSparseDecisionChangeGroups(complete,groups,"ACTION3",false),groups);
    const after=[{action:"ACTION3",changed_cells:138,observation_id:"execution-observation-45",change_groups:groups},
        ...Array.from({length:3},(_,i)=>({action:"ACTION3",changed_cells:52,observation_id:`later-${i+1}`}))];
    const feedback=arcDecisionFeedback(after)!;
    assert.equal(feedback.signature,"multi-region-change:execution-observation-45");
    assert.ok(feedback.text.includes("3 later native actions occurred"));
    assert.equal(arcSparseDecisionChangeGroups({...complete,changed_cells:52,cells:complete.cells.slice(0,52)},
        [groups[0],{changed_cells:2,bbox:groups[1].bbox}],"ACTION3",false),undefined);
});

test("simple-control no-op history does not propose unexecutable coordinate contrasts", () => {
    const frame=Array.from({length:12},(_,y)=>Array.from({length:12},(_,x)=>x<3&&y<3?9:x>=9&&y>=9?9:5));
    const result=arcDecisionFeedback([{action:"ACTION1",x:1,y:1,changed_cells:0},
        {action:"ACTION2",x:10,y:10,changed_cells:0}],frame)!;
    assert.ok(result.text.includes("ZERO PIXEL DELTAS"));
    assert.ok(!result.text.includes("tested coordinates"));
    assert.ok(!result.text.includes("uniform-patch contrasts"));
});

test("executed simple-action receipt and historical decision card do not invent a target", () => {
    const raw={action:"ACTION1",x:21,y:32,target_cell:{before:8,after:9},changed_cells:52,observation_id:"o1"};
    const copy=JSON.stringify(raw);
    const text=arcActionCoordinateText(raw);
    assert.ok(text.includes("supplied x/y were ignored"));
    assert.ok(!text.includes("target=frame"));
    const card=decisionCardV2({recent_actions:[raw]}, {}, "checkpoint:t@v1");
    assert.ok(!("x" in card.last_action) && !("target_cell" in card.last_action));
    assert.equal(JSON.stringify(raw),copy);
    const coordinates={action:"ACTION6",x:21,y:32};
    assert.deepEqual(arcActionCoordinates(coordinates),{x:21,y:32});
    assert.ok(arcActionCoordinateText(coordinates,{before:8,after:9}).includes("target=frame[32][21]"));
    assert.equal(arcActionCoordinates({action:"ACTION6",x:21}),undefined);
});

test("research evidence exposes executed simple input while preserving its exact raw reference", () => {
    const raw={action:"ACTION1",x:21,y:32,reasoning:"a coordinate-conditioned hypothesis"};
    const comparison=crossContextComparisonForChild(buildCrossContextComparison({observations:[{
        observation_id:"simple-o1",tool_name:"arc_action",input:raw,
        arc_outcome:{observation_delta:{changed_cells:52},action_target_cell:{before:8,after:9}}}],explicitEvidenceRefs:["simple-o1"]}));
    const card=comparison.evidence_cards[0];
    assert.deepEqual(card.input,{action:"ACTION1"});
    assert.ok(!("action_target_cell" in card.public_result));
    assert.ok(card.input_projection.omitted_fields.includes("x") && card.input_projection.omitted_fields.includes("y"));
    assert.equal(card.observation_ref,"simple-o1");
    assert.equal(raw.x,21);
});

test("research continuation preserves child next step, unsupported claims, and evidence cutoff", () => {
    const raw={conclusion:"Uncertain mechanism",planning_implications:[{implication:"Try a different region",applicability:"current"}],
        research_progress:{topic:"mechanics",question:"what changes?",status:"continue",parent_relevance:"now",next_step:"One ACTION6 with explicit x/y, then compare"},
        experiment_request:{objective:"test",parent_action:"ACTION6 at an untested patch",stop_condition:"one result",as_of_event:"e29"},limitations:["No WIN evidence"]};
    const report=normalizeAutoResearchReport(raw);
    const continuation=researchActionContinuation(report,"research_report:r@v1");
    assert.equal(continuation.next_step,raw.research_progress.next_step);
    assert.equal(continuation.next_experiment.as_of_event,"e29");
    assert.deepEqual(continuation.limitations,["No WIN evidence"]);
    assert.equal(continuation.epistemic_status,"child_proposal_not_verified_or_adopted");
    assert.deepEqual(researchActionContinuation(normalizeAutoResearchReport({conclusion:"saved",research_progress:{topic:"t",question:"q",status:"continue",parent_relevance:"later"}}),"r").next_step,undefined);
    const legacy=normalizeAutoResearchReport({planning_implications:[{decision:"Revise reset strategy",rationale:"same cycle",reconsideration_condition:"new state"}]});
    assert.equal(legacy.planning_implications[0].implication,"Revise reset strategy");
    assert.equal(legacy.planning_implications[0].reconsider_when,"new state");
});
