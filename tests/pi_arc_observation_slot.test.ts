import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import installArc from "../demo/pi_arc_agi_3_extension.ts";

test("real ARC hooks keep the system prefix stable and inject complete current pixels on every continuation",async()=>{
    const keys=["PI_AUTORESEARCH_VARIANT","PI_AUTORESEARCH_E2E_ROOT","PI_ARC_BRIDGE_URL","PI_ARC_INPUT_MODALITIES"];
    const previous=keys.map(key=>process.env[key]);
    const originalFetch=globalThis.fetch;
    try {
        Object.assign(process.env,{PI_AUTORESEARCH_VARIANT:"control",PI_AUTORESEARCH_E2E_ROOT:mkdtempSync(join(tmpdir(),"arc-slot-")),
            PI_ARC_BRIDGE_URL:"http://fixture.invalid",PI_ARC_INPUT_MODALITIES:"text,image"});
        const hooks:Record<string,any[]>={},tools:any[]=[];
        let active:string[]=[],index=0;
        const pi:any={on(n,f){(hooks[n]??=[]).push(f);},registerTool(t){tools.push(t);},
            getAllTools(){return tools;},getActiveTools(){return active;},setActiveTools(v){active=v;}};
        let state:any={state:"NOT_FINISHED",frames:[[[9,0],[0,2]]],levels_completed:0,
            available_actions:["ACTION6"],action_budget:{total_used:0}};
        globalThis.fetch=async(url:any)=>new Response(JSON.stringify(String(url).includes("/events")
            ?{events:[],next:index}:state),{status:200,headers:{"content-type":"application/json"}});
        installArc(pi);
        const start=async()=>{
            let systemPrompt="STABLE BASE";
            for(const hook of hooks.before_agent_start){const r=await hook({prompt:"next",systemPrompt});if(r?.systemPrompt)systemPrompt=r.systemPrompt;}
            return systemPrompt;
        };
        const first=await start();
        const slot=hooks.context.at(-1)!;
        for(let repeat=0;repeat<2;repeat++){
            const messages=(await slot({messages:[]})).messages;
            assert.match(JSON.stringify(messages),/90\\n02/);
            assert.equal(messages.flatMap(m=>m.content).filter(p=>p.type==="image").length,1);
        }
        state={...state,frames:[[[8,0],[0,2]]],action_budget:{total_used:1}};index=1;
        const second=await start();
        assert.equal(second,first);
        assert.doesNotMatch(second,/Grid current_state_frame/);
        const current=JSON.stringify((await slot({messages:[]})).messages);
        assert.match(current,/80\\n02/);
        assert.doesNotMatch(current,/90\\n02/);
    } finally {
        globalThis.fetch=originalFetch;
        keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
    }
});
