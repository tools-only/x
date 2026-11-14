import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FIXED_REVIEW_STRATEGY, LEGACY_REVIEW_STRATEGY, FLOOR, hash } from '../demo/self_root.ts';
import { PPT_SELF_ROOT_OPTIONS } from '../demo/self_root_ppt.ts';

const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const open = async (s:any) => { await s.event('settlement','submitted',{event_classes:['task_outcome'],coverage_tags:['submitted'],force_review:true}); await s.boundary(()=>{},()=>{}); };

test('George standing rule holds behind the legacy flag; the default closes on the agent judgment', async () => {
  const legacy:any=new SelfRoot(contract(), undefined, undefined, undefined, undefined, { mechanisms: { legacy_obligation: true } } as any); await open(legacy);
  for (const reason of ['already done/delivered','risk to the delivered artifact']) {
    const r=legacy.exit({reason});
    assert.equal(r.accepted,false); assert.equal(r.terminate,false); assert.match(r.same_turn_correction,/Rewrite.*render.*resubmit|preview/i); assert.match(r.same_turn_correction,/pending/i); assert.ok(legacy.mirror().dynamic.review);
  }
  assert.match(LEGACY_REVIEW_STRATEGY,/delivered artifact never ends/);
  const s:any=new SelfRoot(contract()); await open(s);
  const r=s.exit({reason:'already done/delivered'});
  assert.notEqual(r?.accepted,false); assert.ok(!s.mirror().dynamic.review);
  assert.match(FIXED_REVIEW_STRATEGY,/judged no-change is a valid closure/); assert.match(PPT_SELF_ROOT_OPTIONS.evolutionTools.join(' '),/office\.render/);
});

test('post-submission review exposes orchestration and every component class plus the exit route', async () => {
  const s:any=new SelfRoot(contract()); await open(s);
  const view=s.reviewSelfView();
  assert.deepEqual(view.categories,{orchestration:1,policy:Object.keys(s.policy).length,prompt:1,skill:1,tool:1,memory:1,protected:3});
  for (const kind of ['orchestration','prompt','skill','tool','memory']) assert.ok(view.entries.some((e:any)=>e.kind===kind));
  assert.match(JSON.stringify(s.mirror()),/decide_exit is available at any point/i);
  assert.ok(typeof view.observation === 'string' && view.observation.includes('[trace]'));
});
