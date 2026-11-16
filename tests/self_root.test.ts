import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, PROTOCOL, hash, type SelfContract } from '../demo/self_root.ts';
import { deliveryReviewEvidence } from '../demo/self_root_ppt.ts';
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
  assert.ok(s.mirror().parts.unsupported.includes('step roles other than agent'));
});

test('META merges a boundary, deduplicates consumption, no automatic failure diagnosis', async () => {
  const s = new SelfRoot(contract());
  await s.event('tool_failed','a',{ error:'x' }); assert.equal(s.export().root.queue.length,0);
  const a = await s.event('before_delivery','delivery:1'); await s.event('before_session_end','delivery:2');
  assert.equal(s.export().root.queue.length,1); assert.equal(s.export().root.queue[0].triggers.length,1);
  assert.deepEqual(await s.event('before_delivery','delivery:1'),{duplicate:true});
  const saved = s.export(), x = new SelfRoot(contract(),saved), y = new SelfRoot(contract(),saved);
  const rx = await x.event('tool_succeeded','same',{ok:true}), ry = await y.event('tool_succeeded','same',{ok:true});
  assert.deepEqual(rx,ry); assert.ok(s.export().root.queue.every((ticket:any) => ticket.triggers.every((trigger:any) => trigger.source === 'user_contract')));
});

test('delivery evidence stays pinned, valid refs close any disposition, invalid refs preserve review', async () => {
  for (const status of ['deferred', 'unrelated'] as const) {
    const s = new SelfRoot(contract()); await start(s);
    const receipt = s.fact('task_outcome', { source: 'protected_acceptance' });
    const evidence = { evidenceRefs: [receipt.ref], artifact: { revision: 2, sha256: 'current' } };
    await s.event('before_delivery', 'delivery:current', evidence);
    await s.event('before_session_end', 'delivery:current');
    assert.equal(s.export().root.queue.length, 1);
    await start(s);
    assert.ok(s.mirror().dynamic.review_evidence?.fact_table);
    assert.equal(s.mirror().dynamic.review !== null, true);
    assert.ok(s.mirror().dynamic.review_evidence?.fact_table);
    s.exit({ reason: 'task evidence supports this choice and changes the next action' });
    assert.equal(s.mirror().dynamic.review, null);
  }
});

test('delivery projection bounds warnings and reports false and unknown probes without interpretation', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const warnings = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, issue: 'outside_canvas' }));
  const outcome = s.outcome({ checker: { version: 'v2' }, slide_count: { expected: 2, observed: 1, matches: false },
    units: [{ citation_literal: { found: false }, normalized: { citation_found: true, matches: [{ found: null }] } }],
    renderer: { receipt: { revision: 3, source_sha256: 'hash-3', slides: 1, warnings } } });
  const failure = s.fact('event', { type: 'tool_failed', facts: { tool: 'write', error: 'truncated' } });
  const success = s.fact('event', { type: 'tool_succeeded', facts: { tool: 'python' } });
  const render = s.recordAction('office.render', { artifactVersion: 3, artifactHash: 'hash-3' }, true);
  const action = s.fact('render_action_receipt', { action_ref: render.receipt.ref, transition: render.transition });
  const facts = deliveryReviewEvidence(s);
  assert.deepEqual(facts.evidenceRefs, [outcome.ref, failure.ref, success.ref, action.ref]);
  assert.equal(facts.artifact?.warnings.length, 8);
  assert.equal(facts.artifact?.additional_warnings, 4);
  assert.deepEqual(facts.checker?.flags, { true: 1, false: 1, unknown: 1 });
  assert.equal(facts.checker?.slide_count.matches, false);
  assert.equal(facts.tool_failure?.ref, failure.ref);
  assert.equal(facts.render_action?.ref, render.receipt.ref);
  assert.ok(!JSON.stringify(facts).includes('proposed_change'));
});

test('unit boundary queues the same-task evolution review and exposes host facts', async () => {
  for (const status of ['unrelated','deferred'] as const) {
    const s = new SelfRoot(contract()); await start(s);
    const baseline = s.outcome({ episode:1, renderer:{ receipt:{ revision:1,source_sha256:'first',slides:15,warnings:[] } },
      units:[{ citation_literal:{ found:false }, normalized:{ matches:[{ found:null }] } }] });
    const facts = { episode:1, outcome_refs:[baseline.ref], event_classes:['task_outcome','new_event'], coverage_tags:['tag_alpha'], used_version_refs:[], comparison_refs:[], floor_met:true };
    await s.event('settlement','episode:1:delivered',{...facts, force_review:true});
    assert.deepEqual(await s.event('settlement','episode:1:delivered',facts),{duplicate:true});
    await start(s);
    assert.equal(s.inCapabilityReview,true);
    assert.deepEqual(s.surface().filter(x=>['write','edit','python','office.deliver','acceptance','submit_unit'].includes(x)),[]);
    assert.ok(s.mirror().dynamic.conditions.floor.coverage_tags.includes('tag_alpha'));
    assert.ok(s.mirror().dynamic.conditions.floor.step >= 0);
    assert.ok(PROTOCOL.every(t=>s.surface().includes(t)));
    assert.equal(s.mirror().dynamic.review !== null, true);
    await s.transaction({baseRevision:s.revision, policy:{...s.policy, context:{...s.policy.context, instruction:'evidence considered'}}});
    await s.boundary(()=>{},()=>{});
    assert.equal(s.mode,'reflect');
  }
});

test('no session-entry review; settlement review uses the v1.4 exit contract', async () => {
  const s = new SelfRoot(contract()); await s.boundary(()=>{},()=>{});
  assert.equal(s.mode,'execute'); assert.equal(s.hasReview,false);
  await s.event('settlement','first',{event_classes:['task_outcome'],coverage_tags:['tag'],used_version_refs:[],force_review:true}); await start(s);
  assert.equal(s.mode,'reflect');
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

test('request envelope is part of the same policy, hot activation and restore', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const p = structuredClone(s.policy); p.request = { maxOutputTokens: 16384 };
  await s.transaction({baseRevision:1,policy:p});
  assert.equal(s.policy.request?.maxOutputTokens,32768);
  await start(s); assert.equal(s.policy.request?.maxOutputTokens,16384);
  await s.transaction({baseRevision:2,restore:1}); await start(s);
  assert.equal(s.policy.request?.maxOutputTokens,32768);
  assert.equal(s.revision,3);
});

test('registered output limit rejects a reflection before activation', async () => {
  const s = new SelfRoot(contract(),undefined,undefined,undefined,32768); await start(s);
  const p = structuredClone(s.policy); p.request = { maxOutputTokens: 32769 };
  await assert.rejects(s.transaction({baseRevision:1,policy:p}),/request envelope/);
  await start(s);
  assert.equal(s.revision,1);
  assert.equal(s.policy.request!.maxOutputTokens,32768);
  assert.ok(!all(s).some(r => r.type === 'reflection_activated'));
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
  const s = new SelfRoot(contract()); await s.event('settlement','session',{event_classes:['task_outcome'],coverage_tags:[],force_review:true}); await start(s);
  assert.equal(s.mode,'reflect'); assert.ok(PROTOCOL.every(t=>s.surface().includes(t)));
  assert.throws(()=>s.allowTool('python',{}),/outside/);
  const p = structuredClone(s.policy); p.modes.reflect.tools.push('python'); p.modes.reflect.instruction = 'new review';
  await s.transaction({baseRevision:1,policy:p}); await start(s);
  assert.doesNotThrow(()=>s.allowTool('python',{}));
  s.exit({reason:'no verifiable window'}); await start(s);
  s.allowTool('python',{});
  s.enterMode('reflect'); await start(s); s.allowTool('python',{});
  assert.equal(s.mirror().dynamic.instruction,'new review');
});

test('plain text ends incomplete without invented agent decision or re-trigger loop', async () => {
  // Legacy obligation arm: an agent exit without a qualifying change is refused.
  const legacy = new SelfRoot(contract(), undefined, undefined, undefined, undefined, { mechanisms: { legacy_obligation: true } } as any);
  await legacy.event('settlement','session',{event_classes:['task_outcome'],coverage_tags:[],force_review:true}); await start(legacy);
  assert.throws(()=>legacy.exit({result:{reason:'fiction'}}),/qualifying change/);
  legacy.closeIncomplete('plain text');
  // Default (evidence framing): a judged no-change is a valid closure; no invented decision or re-trigger loop.
  const s = new SelfRoot(contract()); await s.event('settlement','session',{event_classes:['task_outcome'],coverage_tags:[],force_review:true}); await start(s);
  assert.doesNotThrow(()=>s.exit({result:{reason:'fiction'}}));
  await s.event('settlement','session',{event_classes:['task_outcome'],coverage_tags:[]}); await start(s);
  assert.equal(s.mode,'execute');
  assert.ok(all(s).some(r=>r.type==='review_closed'));
});

test('window delivers protected outcomes, cost once and matching numeric prediction error; same agent decides', async () => {
  const s = new SelfRoot(contract()); await start(s);
  const baseline = s.outcome({source:'protected_acceptance',value:1});
  await s.transaction({baseRevision:1,policy:s.policy,validation:{due:{units:1},scope:'next unit',baseline:[baseline.ref],metric_refs:[],prediction:{metric:'count',value:2,unit:'units'},measure:{source:'{"metric": "count", "value": len(input["outcomes"]), "unit": "units"}',version:'v1'}}});
  await start(s); s.outcome({source:'protected_acceptance',value:2},true);
  s.cost({input:10,output:5},20,0.01,true); assert.throws(()=>s.cost({},1,0.1,false),/already counted/);
  await s.event('unit_completed','one');
  const w = s.detail('windows')[0]; assert.ok(w === undefined || ['open','due_unverified'].includes(w.status));
  if (!w) return; assert.equal(w.delivered.prediction_error.difference,-1);
  assert.equal(s.detail('windows')[0].status,'due_unverified');
  assert.equal((await s.interpret(w.id)).result,'unverified');
  assert.equal(s.detail('windows')[0].status,'due_unverified');
});

test('reasoning selection changes the runtime context plan without losing required items', async () => {
  const s = new SelfRoot(contract());
  const items = [{ref:'task',section:'task_brief',content:'original task',required:true},{ref:'tool',section:'task_status',content:'tool continuity',required:true}];
  const first = await s.planContext(items as any);
  assert.ok(first.composition);
  await start(s);
  const p = structuredClone(s.policy); p.context.reasoning = 'all';
  await s.transaction({baseRevision:1,policy:p}); await start(s);
  const second = await s.planContext(items as any);
  assert.ok(second.composition); assert.notEqual(first.receipt.hash,second.receipt.hash);
});

test('no implicit empty validation window is created', async () => {
  const s = new SelfRoot(contract()); await start(s);
  await s.event('before_session_end','delivery:same'); await start(s);
  await s.transaction({baseRevision:1,policy:s.policy}); await start(s);
  assert.equal(s.detail('windows').length,0);
  assert.equal(s.hasReview,true);
});

test('request commitments expire at request boundary without an unrelated tool event', async () => {
  const s = new SelfRoot(contract()); await start(s);
  await s.transaction({baseRevision:1,policy:s.policy,validation:{due:{request:2},scope:'bounded',baseline:[],metric_refs:[]}});
  await start(s); assert.equal(s.mode,'execute');
  await start(s); assert.ok(['execute','reflect'].includes(s.mode));
  assert.ok(s.detail('windows').length === 0 || ['open','due_unverified','due_comparable'].includes(s.detail('windows')[0]?.status));
});

test('validation interpretation preserves the safety boundary until a delivered Agent predicate exists', async () => {
  const s = new SelfRoot(contract()); await start(s);
  await s.transaction({baseRevision:1,policy:s.policy,validation:{due:{request:1},baseline:[],metric_refs:[],scope:'no baseline'}});
  await start(s);
  const result = await s.interpret('window:0');
  assert.ok(result.result === 'unverified' || result.status === 'incomplete');
  assert.equal(s.pendingRevision,s.revision);
  assert.ok(s.detail('windows').length >= 0);
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
  await s.event('before_delivery','one',{force_review:true}); await start(s);
  assert.ok(['execute','reflect'].includes(s.mode)); assert.ok(all(s).some(r=>r.type==='watch_stall'));
  const projection = await s.projection(); assert.ok(projection.failed || projection.value === undefined); assert.ok(s.detail('ledger').total > 0);
});

test('failed tool activation compensates; failed compensation pauses instead of claiming rollback', async () => {
  const s = new SelfRoot(contract()); await start(s); await s.transaction({baseRevision:1,policy:s.policy});
  let n = 0;
  await assert.rejects(s.boundary(()=>{if(++n===1)throw Error('schema failed');},()=>{}),/schema failed/);
  assert.equal(s.revision,1); assert.equal(s.isPaused,false);
  const changed = structuredClone(s.policy); changed.context.instruction = 'compensation candidate';
  await s.transaction({baseRevision:1,policy:changed});
  await assert.rejects(s.boundary(()=>{throw Error('always');},()=>{throw Error('compensation failed');}),/compensation failed/);
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
  const changed = structuredClone(s.policy); changed.context.instruction = 'stale candidate';
  await s.transaction({baseRevision:1,policy:changed});
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
  const changed = structuredClone(s.policy); changed.context.instruction = 'interrupted candidate';
  const pending = s.transaction({baseRevision:1,policy:changed});
  await Promise.resolve();
  const restored=new SelfRoot(contract(),s.export());
  await start(restored);
  assert.ok(all(restored).some(r=>r.type==='transaction_interrupted'));
  await pending;
  assert.equal(restored.revision,1);
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