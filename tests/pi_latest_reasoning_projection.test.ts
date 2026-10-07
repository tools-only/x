import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";

// Faithful reconstruction of the actual serialized transaction. Transport
// captures do not contain Pi-only metadata; this is an offline diagnostic.
const run = "runs/arc-stage117-qwen-baseline-ft09-60-20261006";
const captures = existsSync(run) ? readdirSync(run).filter(f => /^provider-prompt-treatment-.*\.json$/.test(f)).sort() : [];
const hasRealCapture = captures.length >= 2;
// Negative cases remain portable when local research artifacts are unavailable.
const payload = hasRealCapture ? JSON.parse(readFileSync(join(run, captures[1]), "utf8")).payload : {messages:[
    {role:"user",content:"Public task"},
    {role:"assistant",content:"Compare the tool result",reasoning_content:"synthetic ".repeat(3000),tool_calls:[
        {id:"probe",function:{name:"public_probe",arguments:JSON.stringify({decision:{subgoal:"compare",hypothesis:"unknown",prediction:"value",falsifier:"another value",next_step:"observe"}})}}]},
    {role:"tool",tool_call_id:"probe",content:"public result"},
]};
const serialized = payload.messages.find(m => m.role === "assistant");
const assistant = {role:"assistant", provider:"yibu", model:"qwen3.8-27b", api:"openai-completions", stopReason:"toolUse", content:[
    {type:"thinking", thinkingSignature:"reasoning_content", thinking:serialized.reasoning_content},
    {type:"text", text:serialized.content},
    ...serialized.tool_calls.map(c => ({type:"toolCall",id:c.id,name:c.function.name,arguments:JSON.parse(c.function.arguments)})),
]};
const receipt = payload.messages.find(m => m.role === "tool");
const result = {role:"toolResult", toolCallId:receipt.tool_call_id, content:[{type:"text",text:receipt.content}]};
const users = payload.messages.filter(m => m.role === "user").map(m => ({role:"user",content:typeof m.content === "string"
    ? [{type:"text",text:m.content}] : m.content.map(p => p.type === "text" ? p :
        {type:"image",mimeType:"image/png",data:p.image_url.url.split(",")[1]})}));
const messages = [users[0],assistant,result,...users.slice(1)];

async function project(input:any[], policy="summarize_completed_openai_field", providers=["yibu"]) {
    const root=mkdtempSync(join(tmpdir(),"latest-reasoning-")), hooks:any={};
    installTaskLocalContextLifecycle({on(n,f){hooks[n]=f;},registerTool(){}} as any,
        {root,maxChars:400000,reasoningHistoryPolicy:policy,editableReasoningProviders:providers} as any);
    return {root,messages:(await hooks.context({messages:input})).messages};
}

test("real first Qwen transaction projects latest completed thought and preserves public state exactly",{skip:!hasRealCapture},async()=>{
    const before=JSON.stringify(messages), {root,messages:after}=await project(messages);
    const projected=after.find(m=>m.role==="assistant");
    assert.ok(JSON.stringify(projected).length < JSON.stringify(assistant).length - 24000);
    assert.deepEqual(projected.content.slice(1),assistant.content.slice(1));
    assert.deepEqual(after.filter(m=>m.role!=="assistant"),messages.filter(m=>m.role!=="assistant"));
    assert.ok(projected.content[0].text.endsWith(serialized.reasoning_content.slice(-2500)));
    const hash=createHash("sha256").update(JSON.stringify(assistant)).digest("hex");
    const ref=`context:msg-${hash}@v1`;
    assert.ok(projected.content[0].text.includes(ref));
    const archives=readFileSync(join(root,"task-context-cache","messages.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(archives.find(a=>a.archive_id===`msg-${hash}`).message,assistant);
    assert.equal(JSON.stringify(messages),before);
    const log=JSON.parse(readFileSync(join(root,"task-context-compactions.jsonl"),"utf8").trim().split("\n").at(-1)!);
    assert.equal(log.completed_field_reasoning_blocks_summarized,1);
});

test("preserve, historical-only policy and unverified providers keep latest unchanged",async()=>{
    for(const [policy,providers] of [["preserve",["yibu"]],["summarize_openai_field",["yibu"]],
        ["summarize_completed_openai_field",[]],["summarize_completed_openai_field",["other"]]] as any[]) {
        assert.deepEqual((await project(messages,policy,providers)).messages.find(m=>m.role==="assistant"),assistant);
    }
});

test("unfinished, unsupported, protected or public-state-free latest transactions stay intact",async()=>{
    const variants:any[]=[];
    for(const stopReason of ["length","error","aborted",undefined]) variants.push({...assistant,stopReason});
    variants.push({...assistant,api:"anthropic-messages"});
    for(const protection of [{thinkingSignature:"native-signature"},{signature:"signed"},{encrypted_content:"opaque"},{redacted:true}])
        variants.push({...assistant,content:[{...assistant.content[0],...protection},...assistant.content.slice(1)]});
    const call=assistant.content.at(-1)!;
    variants.push({...assistant,content:[...assistant.content.slice(0,-1),{...call,arguments:{...call.arguments,decision:undefined}}]});
    for(const field of ["subgoal","hypothesis","prediction","falsifier","next_step"])
        variants.push({...assistant,content:[...assistant.content.slice(0,-1),{...call,arguments:{...call.arguments,decision:{...call.arguments.decision,[field]:""}}}]});
    for(const m of variants) {
        const input=messages.map(x=>x===assistant?m:x);
        assert.deepEqual((await project(input)).messages.find(x=>x.role==="assistant"),m);
    }
});

test("partial or invalid multi-call transactions do not release latest thought",async()=>{
    const call=assistant.content.at(-1)!;
    for(const extra of [{...call,id:"pending"},{...call,id:undefined},{...call,id:call.id}]) {
        const m={...assistant,content:[...assistant.content,extra]};
        assert.deepEqual((await project(messages.map(x=>x===assistant?m:x))).messages.find(x=>x.role==="assistant"),m);
    }
});

test("error, duplicate, orphan receipts and mixed signatures preserve latest thought",async()=>{
    const signed={type:"thinking",thinkingSignature:"native-signature",thinking:"protected"};
    const mixed={...assistant,content:[...assistant.content,signed]};
    assert.deepEqual((await project(messages.map(m=>m===assistant?mixed:m))).messages.find(m=>m.role==="assistant"),mixed);
    for(const receipts of [[{...result,isError:true}],[result,result],[result,{...result,toolCallId:"orphan"}]]) {
        const input=[messages[0],assistant,...receipts,...messages.slice(3)];
        assert.equal(JSON.stringify((await project(input)).messages.find(m=>m.role==="assistant")),JSON.stringify(assistant),"latest thought must remain intact");
    }
});
