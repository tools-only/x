import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveOrchestrationSession } from '../demo/live_orchestration_core.ts';
import { SelfRoot, FLOOR, hash } from '../demo/self_root.ts';

// M1 (runs/evo-m1-glm53f-meta-20261116): the agent bound its loop to a receipt type no adapter records,
// every later receipt echoed status "recorded", and the loop never turned through the whole run.
// Declared action receipt types make such a binding fail at reflect time, naming the recordable set,
// instead of producing a structure the runtime can never execute.

const types = ['office.render', 'office.look', 'office.deliver', 'submit_unit'];
const loop = (onAction: string, requireType: string) => ({
  roles: [{ id: 'agent' }], slots: [],
  steps: [{ id: 'work', role: 'agent' }, { id: 'render', role: 'agent' }], decisions: [],
  transitions: [{ id: 'to_render', from: 'work', on: { type: 'action', action: onAction }, requires: [{ type: requireType }], to: 'render' }],
});

test('declared action types reject bindings no runtime action produces, naming the recordable set', () => {
  const s = new LiveOrchestrationSession();
  s.declareActionTypes(types);
  assert.throws(() => s.reflect({ baseRevision: 1, orchestration: loop('render_save', 'render_save'), authorized: true }),
    /transition to_render binds to action type 'render_save'.*office\.deliver, office\.look, office\.render, submit_unit/);
  assert.throws(() => s.reflect({ baseRevision: 1, orchestration: loop('submit_unit', 'render_save'), authorized: true }),
    /transition to_render binds to action type 'render_save'/);
  const decisionBound: any = loop('submit_unit', 'submit_unit');
  decisionBound.steps[0].decision = 'check';
  decisionBound.decisions = [{ id: 'check', judge: 'agent', question: 'agent question', evidence: [{ type: 'render_save' }], output: { type: 'object', required: [], properties: {} } }];
  assert.throws(() => s.reflect({ baseRevision: 1, orchestration: decisionBound, authorized: true }),
    /decision check binds to action type 'render_save'/);
  assert.equal(s.current.revision, 1, 'no partial commit');
});

test('a loop bound to recorded types turns: the receipt advances the step', () => {
  const s = new LiveOrchestrationSession();
  s.declareActionTypes(types);
  s.reflect({ baseRevision: 1, orchestration: loop('submit_unit', 'submit_unit'), authorized: true });
  const action = s.recordAction('submit_unit', { unit: 'unit-01', artifactVersion: 1, artifactHash: 'h1' });
  assert.equal(action.transition.status, 'advanced');
  assert.equal(s.step, 'render');
});

test('undeclared sessions keep accepting arbitrary type strings', () => {
  const s = new LiveOrchestrationSession();
  assert.doesNotThrow(() => s.reflect({ baseRevision: 1, orchestration: loop('render_save', 'render_save'), authorized: true }));
});

// SelfRoot integration: the adapter declares its receipt types once; the transaction path validates
// candidates against them, a rejected design leaves the T0 gate closed, and the T0 material names the set.
const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}) => new SelfRoot(contract(), undefined, undefined, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const tick = async (s: any) => s.boundary(()=>{}, ()=>{});

test('META with declared receipt types: T0 names them, a rejected design keeps the gate closed, a corrected one opens it', async () => {
  const s = make({ meta: true }, { actionReceiptTypes: types }); await tick(s);
  const material = s.metaT0();
  assert.ok(material.includes('Action receipt types this runtime records'));
  // META registers its own loop receipt beside the adapter's task receipts.
  assert.ok(material.includes('office.deliver, office.look, office.render, self.change, submit_unit'));
  // The intent compiler no longer copies a wrong name into requires: one question comes back naming the recordable set.
  const bare = { ...loop('render_save', 'render_save'), transitions: [{ id: 'to_render', from: 'work', on: { type: 'action', action: 'render_save' }, requires: [], to: 'render' }] };
  await assert.rejects(s.transaction({ baseRevision: 1, orchestration: bare }),
    /names action 'render_save' in on\.action.*requires was left as you wrote it.*office\.deliver, office\.look, office\.render, self\.change, submit_unit/);
  assert.equal(s.metaT0Pending, true, 'a failed write never opens the gate');
  assert.equal(s.export().root.ledger.filter((r: any) => r.type === 'meta_t0_design').length, 0);
  // The rejection aborts that whole response chain; the next request starts clean, as in the live runtime.
  await tick(s);
  const ok = await s.transaction({ baseRevision: s.revision, orchestration: loop('submit_unit', 'submit_unit') });
  assert.ok(ok.addresses.includes('orchestration'));
  assert.equal(s.metaT0Pending, false);
  assert.equal(s.export().root.ledger.filter((r: any) => r.type === 'meta_t0_design').length, 1);
  assert.equal(s.metaT0(), '', 'the material stops once the design exists');
});

test('outside META the SelfRoot transaction path keeps the old acceptance of undeclared receipt names', async () => {
  const s = make(); await tick(s);
  const ok = await s.transaction({ baseRevision: 1, orchestration: loop('render_save', 'render_save') });
  assert.ok(ok.addresses.includes('orchestration'));
});
