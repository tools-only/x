import {test} from "node:test";
import assert from "node:assert/strict";
import {appendFileSync,mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {installTaskResourceReader} from "../demo/pi_task_resource_store.ts";
import {ensureTaskScope,stampTaskRecord} from "../demo/pi_task_scope.ts";
import {failureClassification} from "../demo/pi_harness_control.ts";
import {harnessStateView,harnessStatusSection} from "../demo/pi_harness_status_views.ts";
import {normalizeArcActionArguments} from "../demo/pi_arc_action_input.ts";
import {decisionCardV2} from "../demo/pi_decision_card.ts";

function fixture(grants?: string[]) {
    const root=mkdtempSync(join(tmpdir(),"arc-cost-failure-")), tools=new Map<string,any>();
    const scope=ensureTaskScope(root);
    for(let n=0;n<25;n++) appendFileSync(join(root,"observation-snapshots.jsonl"),JSON.stringify(
        stampTaskRecord(scope,{snapshot_id:`parent-state-${n}`,version:1,summary:"evidence ".repeat(500),grid:[[n,0],[0,n]]}))+"\n");
    installTaskResourceReader({on(){},registerTool(t:any){tools.set(t.name,t);}} as any,root,grants);
    return {reader:tools.get("task_resource")};
}

test("stage82 exact-ref inspect returns the same complete page as read, including repeats",async()=>{
    const f=fixture(),ref="observation_snapshot:parent-state-9@v1";
    const args={action:"inspect",kind:"observation",ref,offset:0,limit:10000,force_full:false};
    const inspected=(await f.reader.execute("original",args)).details;
    assert.equal(inspected.ref,ref);
    const read=(await f.reader.execute("read",{...args,action:"read"})).details;
    assert.equal(inspected.text,read.text);
    assert.deepEqual(JSON.parse(inspected.text).grid,[[9,0],[0,9]]);
    assert.equal((await f.reader.execute("repeat",args)).details.text,read.text);
    assert.equal(inspected.next_offset,null);
});

test("exact-ref inspect keeps child snapshot authorization and directory pagination bounded",async()=>{
    const ref="observation_snapshot:parent-state-9@v1",restricted=fixture([ref]);
    await assert.rejects(restricted.reader.execute("denied",{action:"inspect",ref:"observation_snapshot:parent-state-10@v1"}),/not granted/);
    assert.equal((await restricted.reader.execute("allowed",{action:"inspect",ref,limit:20})).details.text.length,20);
    const f=fixture(),page=(await f.reader.execute("index",{action:"inspect",kind:"observation_snapshot",limit:10000})).details;
    assert.equal(page.resources.length,20);
    assert.equal(page.next_offset,20);
    assert.ok(page.resources.every((r:any)=>r.summary.length<=240 && r.read.ref===r.resource_ref));
    const next=(await f.reader.execute("next",{action:"inspect",kind:"observation_snapshot",offset:page.next_offset,limit:10000})).details;
    assert.equal(next.resources.length,5);
    assert.equal(next.next_offset,null);
});

test("a bounded delegate timeout closes that attempt without requiring an unrelated Harness inspect",()=>{
    const failure=failureClassification("delegate_task runtime budget exceeded (120000ms); retry with a smaller bounded task");
    assert.equal(failure.retryable,false);
    assert.equal(failure.required_next_call,undefined);
    assert.match(failure.recovery_hint,/smaller|abandon/i);
    const cas=failureClassification(JSON.stringify({format:"task-resource-version-conflict-v1",applied:false,current_version:2,current:{read:{tool:"task_resource",action:"read",ref:"memory:x@v2"}}}));
    assert.equal(cas.retryable,true);
    assert.equal(cas.required_next_call.ref,"memory:x@v2");
});

test("ARC default Harness inspection indexes large pools while retaining creator and assembly entrypoints",()=>{
    const status={format:"task-local-harness-status-v1",task_solving_context:{next_step:"Compare current motion"},
        control_policy:{review:"advisory"},authorized_tools:["task_harness_create"],active_tools:["arc_action"],
        baseline_methods:[{name:"tool-creator",method_ref:"skill:tool-creator@v1",read_call:{action:"read_method",method_name:"tool-creator"}}],
        current_assembly:{assembly_id:"a",revision:2,selected_resource_refs:["tool:motion@v1"]},
        component_pool:Array.from({length:40},(_,i)=>({resource_ref:`memory:m${i}@v1`,body:"large ".repeat(500)})),
        knowledge_requires_review:Array.from({length:40},(_,i)=>({resource_ref:`memory:m${i}@v1`,error:"old scope"})),
        resources:{memory:[]},pending_level_reviews:[],review_contract:{full:"procedure"}};
    const brief=harnessStateView(status);
    assert.equal(brief.task_solving_context.next_step,status.task_solving_context.next_step);
    assert.deepEqual(brief.current_assembly.selected_resource_refs,["tool:motion@v1"]);
    assert.equal(brief.baseline_methods[0].read_call.method_name,"tool-creator");
    assert.ok((brief as any).component_pool===undefined,"pool bodies must be on demand");
    assert.ok(JSON.stringify(brief).length<3000);
    assert.deepEqual(harnessStatusSection(status,"component_pool").value,status.component_pool);
    assert.deepEqual(brief.full_status_call.arguments,{action:"status",section:"all"});
});

test("authored next_decision has one canonical location and conflicts cannot silently survive",()=>{
    const input=normalizeArcActionArguments({action:"ACTION1",decision:{next_decision:"Compare upward displacement",knowledge:{known_effects:["up five"]}}});
    assert.equal(input.decision.knowledge.next_decision,"Compare upward displacement");
    assert.equal(input.decision.next_decision,undefined);
    assert.throws(()=>normalizeArcActionArguments({action:"ACTION1",decision:{next_decision:"new",knowledge:{next_decision:"old"}}}),/conflict/i);
});
test("state-boundary stale knowledge remains recoverable without being projected as current",()=>{
    const checkpoint={decision_state:{known_effects:["old level movement"],counterevidence:["old target failed"],next_decision:"repeat old action"},
        decision_capsule:{hypothesis:"old goal"},reasoning_state:{stale_fields:["decision_state.known_effects","decision_state.counterevidence","decision_state.next_decision","decision_capsule"]}};
    const card=decisionCardV2(checkpoint,{},"checkpoint:c@v1");
    assert.equal(card.known_effects,undefined);
    assert.deepEqual(card.counterevidence,[]);
    assert.equal(card.next_decision,null);
    assert.equal(card.decision_capsule,undefined);
    assert.equal(card.checkpoint_ref,"checkpoint:c@v1");
    assert.equal(checkpoint.decision_state.counterevidence[0],"old target failed");
});
