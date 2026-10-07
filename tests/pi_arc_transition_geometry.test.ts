import {test} from "node:test";
import assert from "node:assert/strict";
import {arcUniqueRegionTranslations, arcAnchoredPatternChanges, ArcTranslationWitnesses, arcSmallColorRegions} from "../demo/pi_arc_transition_geometry.ts";
import {renderArcEffectLedger} from "../demo/pi_arc_context_projection.ts";

test("allocation facts ignore sources/counts, survive RESET and clear at real level change",()=>{
    const ledger=new ArcTranslationWitnesses();
    const a=[[0,2,2,2,2,2,0,0]],b=[[0,0,2,2,2,2,2,0]];
    const record=(action:string,before:number[][],after:number[][],index:number)=>ledger.record(action,
        arcUniqueRegionTranslations(before,after),{action_index:index,pre_action_ref:`p${index}`},false,
        arcAnchoredPatternChanges(before,after),{before,after});
    record("ACTION1",a,a,0);assert.deepEqual(ledger.facts(),[]);
    record("ACTION1",a,b,1);assert.deepEqual(ledger.facts(),[]);
    record("ACTION2",b,b,2);const facts=ledger.facts();assert.equal(facts.length,1);
    record("ACTION2",b,b,3);assert.deepEqual(ledger.facts(),facts);
    ledger.record("RESET",[],{action_index:4,pre_action_ref:"reset"});
    assert.deepEqual(ledger.facts(),facts);
    record("ACTION1",a,b,5);record("ACTION2",b,b,6);assert.deepEqual(ledger.facts(),facts);
    record("ACTION1",b,a,7);record("ACTION2",a,a,8);assert.equal(ledger.facts().length,2);
    const repeated=[[2,2,2,2,2,0,2,2,2,2,2,0]];
    record("ACTION3",repeated,repeated,9);assert.equal(ledger.facts().length,2);
    ledger.record("ACTION1",[],{action_index:10,pre_action_ref:"level"},true);
    assert.deepEqual(ledger.facts(),[]);
});

test("allocation pattern identity includes action and exact masks without source timestamps",()=>{
    const ledger=new ArcTranslationWitnesses();
    const a=[[2,2,2],[2,0,0],[2,0,0]],b=[[2,2,2],[0,0,2],[0,0,2]];
    for(let i=0;i<3;i++)ledger.record("ACTION1",[],{action_index:i,pre_action_ref:`p${i}`},false,arcAnchoredPatternChanges(a,b));
    assert.equal(ledger.facts().length,1);
    ledger.record("ACTION1",[],{action_index:4,pre_action_ref:"reverse"},false,arcAnchoredPatternChanges(b,a));
    assert.equal(ledger.facts().length,2);
    ledger.record("ACTION1",[],{action_index:5,pre_action_ref:"bad"},false,arcAnchoredPatternChanges([[0],[1,0]],a));
    assert.equal(ledger.facts().length,2);
});

test("full-frame geometry measures overlapping translation rather than changed-strip distance",()=>{
    const a=[[0,2,2,2,2,2,0,0]],b=[[0,0,2,2,2,2,2,0]];
    assert.deepEqual(arcUniqueRegionTranslations(a,b),[{value:2,cells:5,from:[1,0],to:[2,0],offset:[1,0],entered_colors:[[0,1]]}]);
    assert.deepEqual(arcUniqueRegionTranslations(a,a),[]);
});

test("entry evidence counts original colors without treating them as terrain semantics",()=>{
    const match=arcUniqueRegionTranslations([[9,9,3,3]],[[3,3,9,9]])
        .find(row=>row.value===9)!;
    assert.deepEqual(match.entered_colors,[[3,2]]);
    const ledger=new ArcTranslationWitnesses();
    ledger.record("ACTION4",[match],{action_index:1,pre_action_ref:"pre_action_state:first@v1"});
    const first=ledger.render();
    ledger.record("ACTION4",[match],{action_index:2,pre_action_ref:"pre_action_state:repeat@v1"});
    assert.equal(ledger.render(),first);
    ledger.record("ACTION4",[{...match,entered_colors:[[1,1],[3,1]]}],
        {action_index:3,pre_action_ref:"pre_action_state:new-color@v1"});
    assert.equal((ledger.render().match(/"action_index"/g)??[]).length,2);
    assert.match(ledger.render(),/new-color@v1/);
    ledger.record("RESET",[],{action_index:4,pre_action_ref:""});
    assert.equal(ledger.render(),"");
});

test("entry histograms bound unusual palettes and expose omitted pixel counts",()=>{
    const before=[Array(20).fill(99).concat(Array.from({length:20},(_,i)=>i))];
    const after=[Array.from({length:20},(_,i)=>i).concat(Array(20).fill(99))];
    const match=arcUniqueRegionTranslations(before,after).find(row=>row.value===99)!;
    assert.equal(match.entered_colors!.length,16);
    assert.equal(match.entered_colors!.reduce((sum,[,n])=>sum+n,0)+match.entered_colors_omitted_cells!,20);
    assert.equal(match.entered_colors_omitted_cells,4);
});
test("geometry refuses ambiguous repeated shapes, changed shapes, or malformed grids",()=>{
    assert.deepEqual(arcUniqueRegionTranslations([[2,0,2,0,0]],[[0,2,0,2,0]]),[]);
    assert.deepEqual(arcUniqueRegionTranslations([[0,2,2,0]],[[0,0,2,0]]),[]);
    assert.deepEqual(arcUniqueRegionTranslations([[0],[0,1]],[[0],[1]]),[]);
});

test("same-anchor equal-count pattern changes preserve exact masks and source without object inference",()=>{
    const before=[[2,2,2],[2,0,0],[2,0,0]],after=[[2,2,2],[0,0,2],[0,0,2]];
    const patterns=arcAnchoredPatternChanges(before,after);
    assert.deepEqual(patterns,{changes:[{value:2,cells:5,anchor:[0,0],before:["###","#..","#.."],after:["###","..#","..#"]}],omitted:0});
    const ledger=new ArcTranslationWitnesses();
    ledger.record("ACTION1",[],{action_index:1,pre_action_ref:"pre_action_state:pattern@v1"},false,patterns);
    const first=ledger.render();
    assert.match(first,/PUBLIC ANCHORED PATTERN CHANGES/);
    assert.match(first,/no object, causal or goal inference/);
    assert.match(first,/pattern@v1/);
    ledger.record("ACTION1",[],{action_index:2,pre_action_ref:"pre_action_state:repeat@v1"},false,patterns);
    assert.equal(ledger.render(),first);
    ledger.record("ACTION1",[],{action_index:3,pre_action_ref:""},true,patterns);
    assert.equal(ledger.render(),"");
});

test("anchored pattern evidence excludes plain displacement, size changes and invalid frames",()=>{
    const shape=[[2,2,2],[2,0,0],[2,0,0]];
    assert.deepEqual(arcAnchoredPatternChanges(shape,shape),{changes:[],omitted:0});
    assert.deepEqual(arcAnchoredPatternChanges([[0,2,2,2,2,0]],[[0,0,2,2,2,2]]),{changes:[],omitted:0});
    assert.deepEqual(arcAnchoredPatternChanges(shape,[[2,2,2],[2,2,0],[2,0,0]]),{changes:[],omitted:0});
    assert.deepEqual(arcAnchoredPatternChanges([[0],[1,0]],shape),{changes:[],omitted:0});
});

test("pattern projection keeps eight witnesses and reports overflow, then clears on RESET",()=>{
    const ledger=new ArcTranslationWitnesses();
    for(let i=0;i<20;i++) ledger.record("ACTION1",[],{action_index:i,pre_action_ref:`pre_action_state:p${i}@v1`},false,
        {changes:[{value:2,cells:5,anchor:[i,0],before:["###","#..","#.."],after:["###","..#","..#"]}],omitted:0});
    assert.equal((ledger.render().match(/"action_index"/g)??[]).length,8);
    assert.match(ledger.render(),/Omitted=12/);
    assert.ok(ledger.render().length<3000);
    ledger.record("RESET",[],{action_index:21,pre_action_ref:""});
    assert.equal(ledger.render(),"");
});

test("pattern extraction reports per-frame omissions and rejects oversized windows",()=>{
    const before=Array.from({length:3},()=>Array(36).fill(0));
    const after=Array.from({length:3},()=>Array(36).fill(0));
    for(let i=0;i<9;i++){
        for(let dx=0;dx<3;dx++)before[0][i*4+dx]=after[0][i*4+dx]=i+1;
        before[1][i*4]=before[2][i*4]=i+1;
        after[1][i*4+2]=after[2][i*4+2]=i+1;
    }
    const patterns=arcAnchoredPatternChanges(before,after);
    assert.equal(patterns.changes.length,8);
    assert.equal(patterns.omitted,1);
    const wideBefore=[Array(20).fill(2),[2,...Array(19).fill(0)]];
    const wideAfter=[Array(20).fill(2),[...Array(19).fill(0),2]];
    assert.deepEqual(arcAnchoredPatternChanges(wideBefore,wideAfter),{changes:[],omitted:0});
});

test("offset witnesses survive blocked actions without turning correspondence into a control rule",()=>{
    const ledger=new ArcTranslationWitnesses();
    assert.equal(ledger.render(),"");
    const move=arcUniqueRegionTranslations([[0,2,2,0]],[[0,0,2,2]]);
    ledger.record("ACTION1",move,{action_index:1,pre_action_ref:"pre_action_state:a@v1"});
    for(let i=2;i<40;i++) ledger.record("ACTION1",[],{action_index:i,pre_action_ref:`pre_action_state:a${i}@v1`});
    const text=ledger.render();
    assert.match(text,/"offset":\[1,0\]/);
    assert.match(text,/pre_action_state:a@v1/);
    assert.match(text,/not object identity, universal controls, current positions or goals/);
    ledger.record("ACTION1",move,{action_index:40,pre_action_ref:"pre_action_state:other@v1"});
    assert.equal(ledger.render(),text);
    ledger.record("ACTION1",arcUniqueRegionTranslations([[0,0,2,2]],[[0,2,2,0]]),{action_index:41,pre_action_ref:"pre_action_state:b@v1"});
    assert.match(ledger.render(),/"offset":\[-1,0\]/);
    assert.match(ledger.render(),/"offset":\[1,0\]/);
});

test("witness projection is bounded and resets across environment epochs",()=>{
    const ledger=new ArcTranslationWitnesses();
    for(let i=0;i<40;i++) ledger.record("ACTION1",[{value:2,cells:i+1,from:[0,0],to:[1,0],offset:[1,0]}],
        {action_index:i+1,pre_action_ref:`pre_action_state:a${i}@v1`});
    const text=ledger.render();
    assert.equal((text.match(/"action_index"/g)??[]).length,16);
    assert.match(text,/Omitted=24/);
    assert.ok(text.length<4000);
    ledger.record("RESET",[],{action_index:41,pre_action_ref:""});
    assert.equal(ledger.render(),"");
    ledger.record("ACTION2",[{value:3,cells:1,from:[0,0],to:[0,1],offset:[0,1]}],
        {action_index:42,pre_action_ref:"pre_action_state:fresh@v1"});
    assert.match(ledger.render(),/epoch=1/);
    assert.ok(!ledger.render().includes("a39@v1"));
    ledger.record("ACTION2",[],{action_index:43,pre_action_ref:""},true);
    assert.equal(ledger.render(),"");
});
test("resident effect ledger is a bounded current-epoch index without post-value action aliases",()=>{
    const effects=new Map<string,any>([["ACTION1",{attempts:100,distinct_effects:Array.from({length:100},(_,n)=>({
        state_epoch:n<50?0:1,changed_cells:n,bbox:{top:n,left:0,bottom:n,right:0},last_action_index:n,
        components:[{changed_cells:50,bbox:{top:0,left:0,bottom:9,right:4},matching_actions:["ACTION1","ACTION2"]}]}))}]]);
    const text=renderArcEffectLedger(effects);
    assert.ok(text.length<1000);
    assert.ok(!text.includes("matching_actions"));
    assert.match(text,/last_action_index/);
    assert.match(text,/Complete/);
});

test("unchanged placement evidence survives a changing marker and updates exact source and count",()=>{
    const ledger=new ArcTranslationWitnesses();
    const a=[[0,2,2,2,2,2,0,0,0]],b=[[0,0,2,2,2,2,2,0,0]],c=[[0,0,2,2,2,2,2,0,3]];
    ledger.record("ACTION1",arcUniqueRegionTranslations(a,b),{action_index:1,pre_action_ref:"pre_action_state:move@v1"},false,undefined,{before:a,after:b});
    assert.ok(!ledger.render().includes("PUBLIC UNCHANGED PLACEMENT"));
    ledger.record("ACTION3",[],{action_index:2,pre_action_ref:"pre_action_state:blocked@v1"},false,undefined,{before:b,after:c});
    ledger.record("ACTION3",[],{action_index:3,pre_action_ref:"pre_action_state:latest@v1"},false,undefined,{before:c,after:b});
    assert.match(ledger.render(),/PUBLIC UNCHANGED PLACEMENT WITNESSES/);
    assert.match(ledger.render(),/"anchor":\[2,0\]/);
    assert.match(ledger.render(),/"observations":2/);
    assert.match(ledger.render(),/latest@v1/);
    assert.match(ledger.render(),/not whole-state no-ops or permanent blocks/);
    ledger.record("RESET",[],{action_index:4,pre_action_ref:""});
    ledger.record("ACTION3",[],{action_index:5,pre_action_ref:""},false,undefined,{before:b,after:c});
    assert.equal(ledger.render(),"");
});

test("unobserved static and ambiguous repeated patterns do not acquire a placement identity",()=>{
    const ledger=new ArcTranslationWitnesses();
    const a=[[0,2,2,2,2,2,0,0,0,0,0,0]],b=[[0,0,2,2,2,2,2,0,0,0,0,0]];
    ledger.record("ACTION3",[],{action_index:1,pre_action_ref:""},false,undefined,{before:b,after:b});
    assert.equal(ledger.render(),"");
    ledger.record("ACTION1",arcUniqueRegionTranslations(a,b),{action_index:2,pre_action_ref:""},false,undefined,{before:a,after:b});
    const repeated=[[2,2,2,2,2,0,2,2,2,2,2,0]];
    ledger.record("ACTION3",[],{action_index:3,pre_action_ref:""},false,undefined,{before:repeated,after:repeated});
    assert.ok(!ledger.render().includes("PUBLIC UNCHANGED PLACEMENT"));
    ledger.record("ACTION1",[],{action_index:4,pre_action_ref:""},true);
    assert.equal(ledger.render(),"");
});

test("unchanged placement history is bounded across distinct anchors",()=>{
    const ledger=new ArcTranslationWitnesses();
    const grid=(x:number)=>[Array.from({length:128},(_,i)=>i>=x&&i<x+5?2:0)];
    for(let i=0;i<20;i++){
        const a=grid(i+1),b=grid(i+2);
        ledger.record("ACTION1",arcUniqueRegionTranslations(a,b),{action_index:i*2,pre_action_ref:""},false,undefined,{before:a,after:b});
        ledger.record("ACTION3",[],{action_index:i*2+1,pre_action_ref:`pre_action_state:s${i}@v1`},false,undefined,{before:b,after:b});
    }
    const stationary=ledger.render().split("PUBLIC UNCHANGED PLACEMENT WITNESSES")[1];
    assert.equal((stationary.match(/"observations"/g)??[]).length,16);
    assert.match(stationary,/Omitted=4/);
    assert.ok(stationary.length<5000);
});

test("current template matches use the supplied frame, not historical anchors",()=>{
    const ledger=new ArcTranslationWitnesses();
    const a=[[0,2,2,2,2,2,0,0,0]],b=[[0,0,2,2,2,2,2,0,0]],c=[[0,0,0,2,2,2,2,2,0]];
    assert.equal(ledger.renderCurrent(a,"observation_snapshot:initial@v1"),"");
    ledger.record("ACTION1",arcUniqueRegionTranslations(a,b),{action_index:1,pre_action_ref:"pre_action_state:a@v1"},false,undefined,{before:a,after:b});
    const text=ledger.renderCurrent(c,"observation_snapshot:now@v1");
    assert.match(text,/CURRENT MATCHES OF PREVIOUSLY TRANSLATED PATTERNS/);
    assert.match(text,/observation_snapshot:now@v1/);
    assert.match(text,/"matches":1,"anchor":\[3,0\]/);
    assert.match(text,/"mask":\["#####"\]/);
    assert.ok(!text.includes('"anchor":[2,0]'));
    const ambiguous=ledger.renderCurrent([[2,2,2,2,2,0,2,2,2,2,2]],"ambiguous");
    assert.match(ambiguous,/"matches":2/);
    assert.ok(!ambiguous.includes('"anchor"'));
    const missing=ledger.renderCurrent([[2,2,2,2,0]],"missing");
    assert.match(missing,/"matches":0/);
    assert.ok(!missing.includes('"anchor"'));
    assert.match(ledger.renderCurrent([[0],[0,1]],"invalid"),/unavailable/);
    for(const boundary of [false,true]){
        ledger.record(boundary?"ACTION1":"RESET",[],{action_index:2,pre_action_ref:""},boundary);
        assert.equal(ledger.renderCurrent(c,"reset"),"");
    }
});

test("small color regions preserve static, translated, isolated and repeated exact masks",()=>{
    const grid=Array.from({length:20},()=>Array(20).fill(0));
    for(let y=1;y<4;y++)for(let x=1;x<6;x++)grid[y][x]=9;
    for(const [x,y] of [[10,1],[11,1],[12,1],[12,2],[12,3],[10,3],[17,17]])grid[y][x]=9;
    const table=arcSmallColorRegions(grid)!;
    assert.equal(table.regions.length,4);
    assert.equal(table.omitted,0);
    assert.deepEqual(table.regions[0],{value:9,cells:15,anchor:[1,1],mask:["#####","#####","#####"]});
    assert.deepEqual(table.regions[1],{value:9,cells:5,anchor:[10,1],mask:["###","..#","..#"]});
    assert.deepEqual(table.regions.slice(2).map(r=>r.anchor),[[10,3],[17,17]]);
    for(const r of table.regions)assert.equal(r.mask.join('').replace(/\./g,'').length,r.cells);
    const repeated=arcSmallColorRegions([[2,0,2]])!;
    assert.equal(repeated.regions.filter(r=>r.value===2).length,2);
    assert.equal(arcSmallColorRegions([[0],[0,1]]),null);
});

test("small color index bounds noise and windows without hiding omissions",()=>{
    const noisy=Array.from({length:8},(_,y)=>Array.from({length:8},(_,x)=>(x+y)%2));
    const table=arcSmallColorRegions(noisy)!;
    assert.equal(table.regions.length,16);
    assert.equal(table.omitted,48);
    assert.ok(table.regions.every(r=>r.cells===1));
    assert.deepEqual(arcSmallColorRegions([Array(17).fill(2)]),{regions:[],omitted:0});
    assert.deepEqual(arcSmallColorRegions(Array.from({length:9},()=>Array(9).fill(2))),{regions:[],omitted:0});
});
