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
  const denied:any = await runtime.python('env.act("ACTION1")', undefined, true);
  assert.equal(n,2); assert.equal(denied.isError,true);
 } finally {runtime.close();}
});

test('decision projection retains unfinished reasoning, signed blocks and exact recovery while archiving old results', () => {
 const messages:any[]=[{role:'user', content:'DECIDE'},
  {role:'assistant',content:[{type:'thinking',thinking:'old'}, {type:'toolCall',id:'a',name:'python'}]},
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
