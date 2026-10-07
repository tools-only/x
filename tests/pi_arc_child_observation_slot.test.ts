import { test } from "node:test";
import assert from "node:assert/strict";
import installArcChild from "../demo/pi_arc_readonly_subagent_extension.ts";

test("published child pixels survive later projections without reads or extra permissions", async () => {
    const keys=["PI_TASK_SUBAGENT_TOOLS","PI_TASK_CHILD_STATE_SNAPSHOT","PI_ARC_CHILD_OBSERVATION",
        "PI_ARC_INPUT_MODALITIES","PI_ARC_ACTION_TOKEN"];
    const previous=keys.map(key=>process.env[key]);
    try {
        Object.assign(process.env,{PI_TASK_SUBAGENT_TOOLS:'["arc_state"]',
            PI_TASK_CHILD_STATE_SNAPSHOT:JSON.stringify({frames:[[[9,0],[0,2]]],action_budget:{total_used:2}}),
            PI_ARC_CHILD_OBSERVATION:"published",PI_ARC_INPUT_MODALITIES:"text,image",PI_ARC_ACTION_TOKEN:""});
        const hooks:Record<string,any[]>={},tools:any[]=[];
        const pi:any={on(n,f){(hooks[n]??=[]).push(f);},registerTool(t){tools.push(t);}};
        installArcChild(pi);
        pi.on("context",()=>({messages:[]})); // A later-loaded transcript lifecycle.
        for(const f of hooks.session_start??[]) await f({});
        for(const f of hooks.session_start??[]) await f({}); // Idempotent installation.
        assert.equal(hooks.context.length,2);
        process.env.PI_TASK_CHILD_STATE_SNAPSHOT=JSON.stringify({frames:[[[8,8],[8,8]]]});
        for(let turn=0;turn<2;turn++){
            let messages:any[]=[{role:"user",content:[{type:"text",text:"old"}]}];
            for(const f of hooks.context) messages=(await f({messages})).messages;
            const parts=messages.flatMap(m=>m.content);
            assert.equal(parts.filter(p=>p.type==="image").length,1);
            assert.match(parts.filter(p=>p.type==="text").map(p=>p.text).join("\n"),/90\n02/);
            assert.match(parts[0].text,/fixed at delegation/);
        }
        assert.deepEqual(tools.map(t=>t.name),["arc_state"]);
        for(const [grant,lease,flag] of [['[]','','published'],['["arc_state"]','lease','published'],['["arc_state"]','','']]){
            Object.assign(process.env,{PI_TASK_SUBAGENT_TOOLS:grant,PI_ARC_ACTION_TOKEN:lease,PI_ARC_CHILD_OBSERVATION:flag});
            const excluded:Record<string,any[]>={};
            installArcChild({on(n,f){(excluded[n]??=[]).push(f);},registerTool(){}} as any);
            assert.equal(excluded.session_start,undefined);
        }
    } finally {
        keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
    }
});
