import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, PROTOCOL, hash, type SelfContract } from '../demo/self_root.ts';
import { closeLiveSelfMethods } from '../demo/live_self_wasi.ts';
after(closeLiveSelfMethods);

export function contract(): SelfContract {
  const body = { source: 'user_contract' as const, authority: 'Round v1 explicit test fixture; no real requests', decisions: 'FINAL 2.1 G1', readonly_reason: 'user boundaries, resources and facts are not agent methods',
    boundaries: [...FLOOR], capabilities: ['read','ls','grep','python','office.render','office.look','office.deliver','acceptance','submit_unit','agent_tools'],
    writable: ['components.tool','components.prompt','components.memory','components.skill','orchestration','policy'],
    budget: { requests: 30, tokens: 100000, seconds: 600, usd: 1, storage_bytes: 10000000 }, acceptance: { checker: 'fixture' }, inherit_defaults: false as const, heartbeat: false as const };
  return { ...body, content_hash: hash(body) };
}
const start = async (s: SelfRoot) => { await s.boundary(() => {},() => {}); return s.pin(); };
const all = (s: SelfRoot) => s.export().root.ledger;

test('explicit floor/hash/numeric cap are required; protected facts stay visible', () => {
  assert.throws(() => new SelfRoot(undefined as any), /contract/);
  const c = contract(); c.boundaries.pop(); assert.throws(() => new SelfRoot(c), /hash/);
  const s = new SelfRoot(contract()); assert.equal(s.mirror().parts.protected.contract_hash,contract().content_hash);
  assert.ok(s.mirror().parts.unsupported.includes('task subagents'));
});

test('META merges a boundary, deduplicates consumption, no automatic failure diagnosis', async () => {
  const s = new SelfRoot(contract());
  await s.event('tool_failed','a',{ error:'x' }); assert.equal(s.export().root.queue.length,0);
  const a = await s.event('before_delivery','delivery:1'); await s.event('before_session_end','delivery:1');
  assert.equal(s.export().root.queue.length,1); assert.equal(s.export().root.queue[0].triggers.length,2);
  assert.deepEqual(await s.event('before_delivery','delivery:1'),{duplicate:true});
  const saved = s.export(), x = new SelfRoot(contract(),saved), y = new SelfRoot(contract(),saved);
  const rx = await x.event('tool_succeeded','same',{ok:true}), ry = await y.event('tool_succeeded','same',{ok:true});
  assert.deepEqual(rx,ry); assert.ok((a as any).triggers[0].source === 'user_contract');
});

test('pending chain leaves pinned response unchanged, any failure aborts whole chain', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const p = structuredClone(s.policy); p.context.instruction = 'next input';
  await s.transaction({baseRevision:1,policy:p}); assert.equal(s.revision,1); assert.equal(s.policy.context.instruction,'');
  await assert.rejects(s.transaction({baseRevision:1,policy:p}),/stale/);
  await start(s); assert.equal(s.revision,1); assert.equal(s.policy.context.instruction,'');
  await s.transaction({baseRevision:1,policy:p}); await start(s);
  assert.equal(s.revision,2); assert.equal(s.policy.context.instruction,'next input');
});

test('same root atomically changes memory selection/context/control; restore is a new revision', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const p = structuredClone(s.policy); p.memory.names = ['second']; p.context.order = ['memory'];
  const orchestration = { roles:[{id:'agent'}],slots:[{id:'model',type:'text',initial:'fresh'}],steps:[{id:'build',role:'agent',actions:['python']}],decisions:[],transitions:[] };
  await s.transaction({baseRevision:1,policy:p,orchestration,components:[{op:'define',kind:'memory',name:'first',source:'first'},{op:'define',kind:'memory',name:'second',source:'second'}]});
  await start(s); assert.equal(s.step,'build'); assert.deepEqual(s.memory().map(c=>c.name),['second']);
  s.cost({input:1,output:2},3,0.01,true); const id = s.root_id;
  const old = s.detail('definition',2);
  p.context.instruction = 'another method';
  await s.transaction({baseRevision:2,policy:p,orchestration:{...orchestration,steps:[{id:'other',role:'agent'}]},stepMap:{build:'other'}}); await start(s);
  assert.equal(s.step,'other');
  await s.transaction({baseRevision:3,restore:2,stepMap:{other:'build'}}); await start(s);
  assert.equal(s.revision,4); assert.equal(s.root_id,id); assert.equal(s.step,'build');
  assert.equal(s.resources().tokens,3); assert.equal(s.policy.context.instruction,old.policy.context.instruction);
});

test('mode schema and action entry change together; old review definition remains pinned', async () => {
  const s = new SelfRoot(contract()); await s.event('window_entry','session'); await start(s);
  assert.equal(s.mode,'reflect'); assert.ok(PROTOCOL.every(t=>s.surface().includes(t)));
  assert.throws(()=>s.allowTool('python',{}),/outside/); s.allowTool('office',{op:'look'});
  const p = structuredClone(s.policy); p.modes.reflect.tools.push('python'); p.modes.reflect.instruction = 'new review';
  await s.transaction({baseRevision:1,policy:p}); await start(s);
  assert.throws(()=>s.allowTool('python',{}),/outside/);
  s.exit({status:'changed',result:{reason:'used activation receipt'},evidenceRefs:[]}); await start(s);
  s.allowTool('python',{});
  s.enterMode('reflect'); await start(s); s.allowTool('python',{});
  assert.equal(s.mirror().dynamic.instruction,'new review');
});

test('plain text ends incomplete without invented agent decision or re-trigger loop', async () => {
  const s = new SelfRoot(contract()); await s.event('window_entry','session'); await start(s);
  assert.throws(()=>s.exit({status:'changed',result:{reason:'fiction'},evidenceRefs:[]}),/activation/);
  s.closeIncomplete('plain text'); await s.event('window_entry','session'); await start(s);
  assert.equal(s.mode,'execute');
  assert.equal(all(s).find(r=>r.type==='review_closed')!.value.agent_decision,'absent');
});

test('window delivers protected outcomes, cost once and matching numeric prediction error; same agent decides', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const baseline = s.outcome({source:'protected_acceptance',value:1});
  await s.transaction({baseRevision:1,policy:s.policy,validation:{due:{units:1},scope:'next unit',baseline:[baseline.ref],metric_refs:[],prediction:{metric:'count',value:2,unit:'units'},measure:{source:'{"metric": "count", "value": len(input["outcomes"]), "unit": "units"}',version:'v1'}}});
  await start(s); s.outcome({source:'protected_acceptance',value:2},true);
  s.cost({input:10,output:5},20,0.01,true); assert.throws(()=>s.cost({},1,0.1,false),/already counted/);
  await s.event('unit_completed','one');
  const w = s.detail('windows')[0]; assert.equal(w.status,'delivered'); assert.equal(w.delivered.prediction_error.difference,-1);
  assert.equal(s.detail('windows')[0].status,'delivered');
  s.interpret(w.id,'defer',{reason:'insufficient comparison'});
  assert.equal(s.detail('windows')[0].status,'deferred_unverified');
});

test('bounded pure failure/success capsules restore and replay without workspace/network effects', async () => {
  const s = new SelfRoot(contract());
  const c = s.capsule({input:{n:2},method_source:'input["n"] + 1',dependencies:{unknown:[]},counterevidence:['original result 3'],unresolved:['world effect unknown'],continuation:{step:'work'},outcome:{value:3}});
  const restored = new SelfRoot(contract(),s.export());
  const r = await restored.replay(c.ref); assert.equal(r.value.output.value,3); assert.equal(r.value.counterfactual_world_result,false);
  await assert.rejects(restored.replay(c.ref,'1 / 0'));
  const missing = s.capsule({input:{},dependencies:{unknown:['external state']},counterevidence:[],unresolved:[],continuation:{},outcome:{}});
  await assert.rejects(s.replay(missing.ref),/no pure replayable/);
});

test('watch/projection errors remain visible; floor survives and full evidence remains recoverable', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const p = structuredClone(s.policy); p.methods.bad = '1 / 0'; p.modes.reflect.projection = 'bad';
  p.routes.push({id:'r',event:'before_delivery',predicate:'bad',mode:'reflect',priority:0,conclusion_sink:'ledger'});
  await s.transaction({baseRevision:1,policy:p}); await start(s);
  await s.event('before_delivery','one'); await start(s);
  assert.equal(s.mode,'reflect'); assert.ok(all(s).some(r=>r.type==='watch_stall'));
  assert.ok((await s.projection()).failed); assert.ok(s.detail('ledger').total > 0);
});

test('failed tool activation compensates; failed compensation pauses instead of claiming rollback', async () => {
  const s = new SelfRoot(contract()); await start(s); await s.transaction({baseRevision:1,policy:s.policy});
  let n = 0;
  await assert.rejects(s.boundary(()=>{if(++n===1)throw Error('schema failed');},()=>{}),/schema failed/);
  assert.equal(s.revision,1); assert.equal(s.isPaused,false);
  await s.transaction({baseRevision:1,policy:s.policy});
  await assert.rejects(s.boundary(()=>{throw Error('always');},()=>{}),/paused/);
  assert.equal(s.isPaused,true);
});

test('P5 records do not automatically inherit and hard caps cannot be changed via policy', async () => {
  const s = new SelfRoot(contract()); await start(s);
  s.inherit({applicability:'one task',dependencies:[],counterexamples:[],evidence_refs:[],snapshot:1,status:'candidate'});
  assert.equal(s.detail('lineage').rows[0].value.auto_inherit,false);
  assert.throws(()=>s.inherit({applicability:'x',dependencies:[],counterexamples:[],evidence_refs:[],snapshot:1,status:'default'}),/disabled/);
  await assert.rejects(s.transaction({baseRevision:1,policy:{...s.policy,budget:{tokens:9}} as any}),/unknown policy/);
  s.guard(); assert.throws(()=>s.guard(contract().budget.storage_bytes),/exhausted/);
});

test('restore removes later tools, preserves learned memory and adds lineage', async () => {
  const validator = async () => ({kind:'tool',name:'probe',enabled:true,description:'fixture',body:''} as any);
  const s = new SelfRoot(contract(),undefined,validator); await start(s);
  await s.transaction({baseRevision:1,components:[{op:'define',kind:'tool',name:'probe',source:'# program: on\ndef main(args):\n return 1'}, {op:'define',kind:'memory',name:'learned',source:'counterevidence survives'}]});
  await start(s); assert.ok(s.surface().includes('probe'));
  await s.transaction({baseRevision:2,restore:1}); await start(s);
  assert.equal(s.revision,3); assert.ok(!s.surface().includes('probe'));
  assert.equal(s.memory()[0].source,'counterevidence survives');
  assert.equal(all(s).filter(r=>r.type==='reflection_activated').at(-1)!.value.parent,2);
});

test('late action refuses stale candidate without dropping the real receipt', async () => {
  const s = new SelfRoot(contract()); await start(s);
  await s.transaction({baseRevision:1,policy:s.policy});
  s.recordAction('python',{result:'late'});
  await start(s);
  assert.equal(s.revision,1); assert.equal(s.snapshot().actions.at(-1)!.facts.result,'late');
  assert.ok(all(s).some(r=>r.type==='activation_failed'));
});

test('pure control decision uses a real event without fabricated task action', async () => {
  const s = new SelfRoot(contract()); await start(s);
  await s.transaction({baseRevision:1,orchestration:{roles:[{id:'agent'}],slots:[],steps:[{id:'choose',role:'agent',decision:'go'},{id:'next',role:'agent'}],
    decisions:[{id:'go',judge:'agent',question:'continue?',evidence:[{type:'event',factPath:'/type',equals:'stall'}],output:{type:'boolean'}}],
    transitions:[{id:'go',from:'choose',on:{type:'decision',id:'go',equals:true},requires:[{type:'event',factPath:'/type',equals:'stall'}],to:'next'}]}});
  await start(s); const event = await s.event('stall','control');
  s.decide({decisionId:'go',actor:'agent',evidenceRefs:[(event as any).event],result:true});
  assert.equal(s.advance().status,'advanced'); assert.equal(s.snapshot().actions.length,0);
});

test('active reset reviews first; interrupted candidates abort and facts/claims stay distinct', async () => {
  const s = new SelfRoot(contract()); await start(s);
  assert.equal((await s.requestReset()).ready,false); await start(s);
  assert.equal((await s.requestReset()).ready,false);
  s.exit({status:'deferred',subtype:'keep',result:{reason:'preserve evidence refs'},evidenceRefs:[]});
  await start(s); assert.equal((await s.requestReset()).ready,true);
  const claim=s.capsule({input:{},dependencies:{},counterevidence:[],unresolved:[],continuation:{},outcome:{}});
  assert.equal(claim.kind,'claim');
  await s.transaction({baseRevision:1,policy:s.policy});
  const restored=new SelfRoot(contract(),s.export()); await start(restored);
  assert.equal(restored.revision,1);
  assert.ok(all(restored).some(r=>r.type==='transaction_interrupted'));
});

test('host schema rejection also aborts an in-flight reflection validation', async () => {
  let begin!:()=>void, release!:()=>void;
  const begun=new Promise<void>(r=>begin=r), gate=new Promise<void>(r=>release=r);
  const s=new SelfRoot(contract(),undefined,async()=>{begin();await gate;return {kind:'tool',name:'probe',enabled:true,description:'fixture'};});
  await start(s);
  const transaction=s.transaction({baseRevision:1,components:[{op:'define',kind:'tool',name:'probe',source:'# program: on\ndef main(args): return 1'}]});
  await begun; s.abortTransaction('parallel reflection rejected by Pi schema'); release();
  await assert.rejects(transaction,/chain failed/); await start(s);
  assert.equal(s.revision,1); assert.ok(!s.surface().includes('probe'));
});
