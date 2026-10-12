import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestTrace, usageRecord} from '../demo/arc_thin_requests.ts';

test('request telemetry distinguishes prepared/stream/settlement and preserves unknown aborted costs', () => {
  const rows:any[]=[]; const trace=new RequestTrace(row => rows.push(row));
  const id=trace.start('parent',7);
  trace.chunk(id,20); trace.chunk(id,10);
  trace.finish(id,{stopReason:'aborted',usage:{input:0,output:0,totalTokens:0}});
  assert.equal(rows.filter(r=>r.stage==='first_stream_event').length,1);
  const end=rows.at(-1);
  assert.equal(end.cost_status,'unknown'); assert.equal(end.total,null);
  assert.equal(end.status,'aborted'); assert.equal(end.stream_chars,30);
  assert.equal(rows[0].http_headers,'unobserved');
  assert.equal(rows[0].request_id,id); assert.equal(rows[0].logical_request,'parent:7');
  assert.ok(end.monotonic_ms >= rows[0].monotonic_ms);
  assert.equal(trace.start('parent',7) === id,false);
  assert.equal(rows.at(-1).attempt,2);
  assert.equal(usageRecord({stopReason:'aborted',usage:{totalTokens:10,output:5}}).cost_status,'partial');
});

test('Pi completed zero placeholders cannot establish a reported zero cost',()=>{
  const record=usageRecord({stopReason:'stop',usage:{input:0,output:0,totalTokens:0}});
  assert.equal(record.status,'completed'); assert.equal(record.total,null);
  assert.equal(record.cost_status,'unknown');
  assert.equal(record.input,null);assert.equal(record.output,null);
});

test('available response callback records status without headers and captures synchronous failures',async()=>{
  const rows:any[]=[];const trace=new RequestTrace(r=>rows.push(r));
  await trace.run('consult',1,onResponse=>{
    onResponse({status:200,headers:{authorization:'PRIVATE_KEY'}});
    return {result:async()=>({stopReason:'stop',usage:{totalTokens:5}})};
  });
  assert.equal(rows.find(r=>r.stage==='response_headers').response_status,200);
  assert.equal(rows.at(-1).http_headers,'observed');
  assert.equal(JSON.stringify(rows).includes('PRIVATE_KEY'),false);
  await assert.rejects(trace.run('compaction',1,()=>{throw Error('transport creation failed');}));
  assert.equal(rows.at(-1).status,'failed');assert.equal(rows.at(-1).total,null);
});
