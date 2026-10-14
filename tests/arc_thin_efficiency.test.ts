import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Workspace} from '../demo/arc_thin_workspace.ts';
import {Binder} from '../demo/arc_thin_binder.ts';
import {NativeRuntime} from '../demo/arc_thin_native_runtime.ts';
import {emptyMemory, renderDecisionMemory} from '../demo/arc_thin_memory.ts';
import {nativeDecisionStart, projectNativeDecision} from '../demo/arc_thin_native_context.ts';
import {gridRuns} from '../demo/arc_thin_observation.ts';
import {executeNative} from '../demo/arc_thin_components.ts';

test('ordinary persisted Python acts twice, sees current globals/history, and commits mutations only once', async () => {
 const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'arc-efficiency-')));
 let n = 0;
 const runtime = new NativeRuntime({pi: {registerTool(){}} as any, workspace, binder: new Binder(workspace),
  state: () => ({grid:[[n]], state:'NOT_FINISHED', history:{base_n:n, base_grid:[[n]], transitions:Array.from({length:n}, (_,i)=>({n:i+1})), deltas:{}}}),
  level:()=>0, actionCount:()=>n, log(){}, usage(){}, wrap: (_name, fn)=>fn,
  async act(call, via) {assert.equal(via, 'python'); n++; return {line:`#${n} ${call.action} → changed 1`, observation:{grid:[n.toString(16)], changed_cells:1,
   transition:{n,action:call.action,state:'NOT_FINISHED',level_changed:false,levels_completed:0}}};}});
 try {
  await runtime.python('seen = []\ndef current():\n    return grid[0][0]\n');
  const result:any = await runtime.python('seen.append("once")\nfor _ in range(2):\n    env.act("ACTION1")\n    seen.append((current(), len(history), history.grid(len(history))[0][0]))\nseen');
  assert.equal(n,2,JSON.stringify(result));
  assert.equal(result.terminate,true);
  assert.match(result.content[0].text, /once.*1,1,1.*2,2,2/);
  const kept:any = await runtime.python('assert env["grid"] == grid\nseen');
  assert.match(kept.content[0].text, /once.*1,1,1.*2,2,2/);
  await runtime.python('samples = [1]\ndef measure(x=samples):\n    x.append(grid[0][0])\n    return len(x)\nmeasure()');
  const defaults:any = await runtime.python('measure()\n(measure.__defaults__[0] is samples, samples)');
  assert.match(defaults.content[0].text,/true,\[1,2,2\]/);
  assert.doesNotMatch(defaults.content[0].text,/definitions.*dropped/);
  const denied:any = await runtime.python('env.act("ACTION1")', undefined, true);
  assert.equal(n,2); assert.equal(denied.isError,true);
 } finally {runtime.close();}
});

test('decision projection retains unfinished reasoning, signed blocks and exact recovery while archiving old results', () => {
 const messages:any[]=[{role:'user', content:'DECIDE'},
  {role:'assistant',content:[{type:'thinking',thinking:'old',thinkingSignature:'reasoning_content'}, {type:'toolCall',id:'a',name:'python'}]},
  {role:'toolResult',toolCallId:'a',content:[{type:'text',text:'A'.repeat(2000)}]},
  {role:'assistant',content:[{type:'thinking',thinking:'signed',thinkingSignature:'opaque'},{type:'toolCall',id:'b'}]},
  {role:'toolResult',toolCallId:'b',content:[{type:'text',text:'recent'}]},
  {role:'assistant',stopReason:'length',content:[{type:'thinking',thinking:'pending experiment'}]},
  {role:'user',content:'RECOVER ACTION. Continue.'}];
 assert.equal(nativeDecisionStart(messages),0);
 const projected=projectNativeDecision(messages.slice(0,-1), {reasoning:'recent',fullResults:1,archive:(_m,body)=>`exact ref ${body.length}`});
 assert.match(JSON.stringify(projected), /pending experiment/);
 assert.match(JSON.stringify(projected), /opaque/);
 assert.doesNotMatch(JSON.stringify(projected), /"thinking":"old"/);
 assert.equal(projected.find(m=>m.toolCallId==='a').content[0].text,'exact ref 2000');
 assert.equal(messages[2].content[0].text.length,2000);
});

test('the default decision projection only appends: each request starts with the previous one unchanged', () => {
 const messages:any[]=[{role:'user', content:'DECIDE'}];
 const chains:Record<string,string[]>={none:[],fields:[]};
 for (let i=0;i<5;i++) {
  messages.push({role:'assistant',content:[{type:'thinking',thinking:`round ${i} <carry>probe: step ${i}</carry>`,thinkingSignature:'reasoning_content'},{type:'toolCall',id:`c${i}`,name:'python'}]},
   {role:'toolResult',toolCallId:`c${i}`,content:[{type:'text',text:String(i).repeat(3000)}]});
  for (const reasoning of ['none','fields','all'] as const) {
   const projected=JSON.stringify(projectNativeDecision(messages,{reasoning,fullResults:2}));
   if (reasoning==='all') assert.match(projected,new RegExp(`round ${i}`));
   else { assert.doesNotMatch(projected,/round/); chains[reasoning].push(projected.slice(0,-1)); }
  }
 }
 for (const [mode,snapshots] of Object.entries(chains))
  for (let i=1;i<snapshots.length;i++) assert.ok(snapshots[i].startsWith(snapshots[i-1]), `${mode}: request ${i} rewrote an earlier message`);
});

test('a decision carries the short fields the model wrote, not its reasoning prose, and keeps every call and result', () => {
 const messages:any[]=[{role:'user',content:'DECIDE'},
  {role:'assistant',content:[{type:'thinking',thinking:'long derivation '.repeat(50)+'<carry>probe: superseded</carry> more derivation <carry>premises: key opens door\nprobe: press ACTION1</carry>'},
   {type:'toolCall',id:'a',name:'python'}]},
  {role:'toolResult',toolCallId:'a',content:[{type:'text',text:'changed 3 cells'}]},
  {role:'assistant',content:[{type:'thinking',thinking:'more derivation'},{type:'text',text:'<carry>eliminated: ACTION2 is a no-op here</carry>'},
   {type:'toolCall',id:'b',name:'python'}]},
  {role:'toolResult',toolCallId:'b',content:[{type:'text',text:'changed 0 cells'}]}];
 const projected=projectNativeDecision(messages,{reasoning:'fields'});
 const json=JSON.stringify(projected);
 assert.doesNotMatch(json,/derivation/);
 assert.doesNotMatch(json,/superseded/);
 assert.match(json,/premises: key opens door/);
 assert.match(json,/eliminated: ACTION2 is a no-op here/);
 assert.deepEqual(projected.filter(m=>m.role==='toolResult').map(m=>m.toolCallId),['a','b']);
 assert.match(JSON.stringify(projected.find(m=>m.toolCallId==='a')),/changed 3 cells/);
 // A block the model put in its own text is left exactly as it wrote it: the stored response is verified against it.
 assert.equal(projected.find(m=>m.role==='assistant'&&m.content.some((b:any)=>b.id==='b')).content[0].text,
  '<carry>eliminated: ACTION2 is a no-op here</carry>');
 assert.match(messages[1].content[0].thinking,/derivation/);
 // One lifted out of thinking rides the result of the call that wrote it (both are final then, so the projection of
 // every earlier round stays byte-identical) and is clipped, never rewritten.
 const clipped=projectNativeDecision(messages,{reasoning:'fields',carryChars:20});
 assert.match(JSON.stringify(clipped.find(m=>m.toolCallId==='a')),/premises: key opens/);
 assert.match(JSON.stringify(clipped.find(m=>m.toolCallId==='a')),/chars>/);
});

test('the grid is shown as row runs with coordinates, background left out and equal rows merged; show() prints the same', async () => {
 const grid=Array.from({length:6},(_,y)=>Array.from({length:8},(_,x)=>y<2?4:y<4&&x>=2&&x<=4?3:x===7?11:4));
 assert.equal(gridRuns(grid),'Grid 6×8 as row runs (x ranges inclusive, then the color; background 4 not listed; rows not listed are all background):\n'+
  'y2-3: 2-4:3 7:11\ny4-5: 7:11');
 assert.match(gridRuns(Array.from({length:64},(_,y)=>Array.from({length:64},(_,x)=>(x*7+y*3)%13)),500),/too varied to show here; use show\(\) in python/);
 const out:any=await executeNative({mode:'exec',code:'show()\nshow(x0=2, y0=2, x1=4, y1=3)',sources:{},files:{},state:{grid}});
 assert.equal(out.value.stdout,'rows y0-5, x0-7; background 4 not listed; rows not listed are all background:\ny2-3: 2-4:3 7:11\ny4-5: 7:11\n'+
  'rows y2-3, x2-4; background 3 not listed; rows not listed are all background:\n');
});

test('current knowledge carries next experiment and conditional negative evidence; common results arrive whole', () => {
 const memory=emptyMemory();
 memory.hypotheses.set('hyp.live',{claim:'movement depends on mode',question:'controls',status:'open',next_test:'test ACTION2 after mode change',evidence:[]});
 memory.hypotheses.set('hyp.old',{claim:'ACTION2 always moves',question:'controls',status:'rejected',evidence:[{action:2,verdict:'refutes',condition:'only in blue mode',observed:'no movement'}]});
 let rendered=renderDecisionMemory(memory,2);
 assert.match(rendered,/test ACTION2 after mode change/); assert.match(rendered,/only in blue mode/);
 memory.hypotheses.get('hyp.live')!.next_test='test the new goal';
 rendered=renderDecisionMemory(memory,2); assert.match(rendered,/test the new goal/);
 const workspace=new Workspace(mkdtempSync(join(tmpdir(),'arc-results-')));
 assert.equal(workspace.receipt('X'.repeat(6000)),'X'.repeat(6000));
 assert.match(workspace.receipt('X'.repeat(9000)),/Preview partial/);
});
