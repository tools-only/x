import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FIXED_REVIEW_STRATEGY, FLOOR, hash } from '../demo/self_root.ts';
import { PPT_SELF_ROOT_OPTIONS } from '../demo/self_root_ppt.ts';

const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const open = async (s:any) => { await s.event('settlement','submitted',{event_classes:['task_outcome'],coverage_tags:['submitted'],force_review:true}); await s.boundary(()=>{},()=>{}); };

test('George standing rule rejects delivered-artifact exits in the same turn', async () => {
  const s:any=new SelfRoot(contract()); await open(s);
  for (const reason of ['already done/delivered','risk to the delivered artifact']) {
    const r=s.exit({reason});
    assert.equal(r.accepted,false); assert.equal(r.terminate,false); assert.match(r.same_turn_correction,/Rewrite.*render.*resubmit|preview/i); assert.match(r.same_turn_correction,/pending/i); assert.ok(s.mirror().dynamic.review);
  }
  assert.match(FIXED_REVIEW_STRATEGY,/delivered artifact never ends/); assert.match(PPT_SELF_ROOT_OPTIONS.evolutionTools.join(' '),/office\.render/);
});

test('post-submission review exposes orchestration and every component class plus rework path', async () => {
  const s:any=new SelfRoot(contract()); await open(s);
  const view=s.reviewSelfView();
  assert.deepEqual(view.categories,{orchestration:1,policy:Object.keys(s.policy).length,prompt:1,skill:1,tool:1,memory:1,protected:3});
  for (const kind of ['orchestration','prompt','skill','tool','memory']) assert.ok(view.entries.some((e:any)=>e.kind===kind));
  const frame=s.allFacts?.() ?? s.mirror().dynamic.review;
  assert.match(JSON.stringify(s.mirror()),/render; resubmit or preview|rewrite/i);
});
