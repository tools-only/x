import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, hash } from '../demo/self_root.ts';

// One positive and one negative (flag-off) case per mechanism: M-A observation, M-B intent compiler
// (wiring completion, hash gate, append/patch, scoped restore), M-C effect return (declared windows,
// no self-triggered reviews), and the delivery-pendency review suppression.

const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}) => new SelfRoot(contract(), undefined, undefined, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const open = async (s: any) => { await s.event('settlement','submitted',{event_classes:['task_outcome'],coverage_tags:['submitted'],force_review:true}); await s.boundary(()=>{},()=>{}); };
const tick = async (s: any) => s.boundary(()=>{},()=>{});
const all = (s: any) => s.export().root.ledger;
const QG = { evidence: [{ type: 'task_outcome' }], id: 'qg', judge: 'agent', output: { properties: { pass: { type: 'boolean' } }, required: ['pass'], type: 'object' }, question: 'q' };
const INTENT = { roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent', decision: 'qg' }, { id: 'submit', role: 'agent' }], decisions: [QG], transitions: [{ id: 't1', from: 'work', on: {}, requires: [], to: 'submit' }] };

test('M-A: review entrance carries recorded observation; flag off removes it, section read stays factual', async () => {
  const s = make(); await open(s);
  const frame = all(s).findLast((r: any) => r.type === 'review_frame')?.value;
  assert.ok(typeof frame.observation === 'string' && frame.observation.includes('[trace]'));
  assert.equal(frame.must_change_self, undefined);
  assert.ok(typeof s.reviewSelfView().observation === 'string');
  const o = s.detail('observation');
  assert.ok(o.a1 && o.a2 && o.a3 && typeof o.rows === 'number');
  const off = make({ observation: false }); await open(off);
  const offFrame = all(off).findLast((r: any) => r.type === 'review_frame')?.value;
  assert.equal(offFrame.observation, undefined);
  assert.equal(off.reviewSelfView().observation, undefined);
});

test('M-B: empty mechanical wiring compiles to an activation with an echoed delta; flag off rejects it', async () => {
  const s = make(); await tick(s);
  const r = await s.transaction({ orchestration: structuredClone(INTENT) });
  assert.ok(Array.isArray(r.compiled) && r.compiled.some((c: any) => c.transition === 't1' && c.field === 'on'));
  await tick(s);
  const active = s.current.orchestration.transitions.find((t: any) => t.id === 't1');
  assert.deepEqual(active.on, { type: 'decision', id: 'qg' });
  assert.deepEqual(active.requires, [{ type: 'task_outcome' }]);
  const off = make({ compiler: false }); await tick(off);
  await assert.rejects(() => off.transaction({ orchestration: structuredClone(INTENT) }));
});

test('M-B: an identical redefine is a no-change without version bump; flag off bumps a new revision', async () => {
  const s = make(); await tick(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'p1', source: 'same text' }] }); await tick(s);
  const before = s.revision;
  const r = await s.transaction({ components: [{ op: 'redefine', kind: 'prompt', name: 'p1', source: 'same text' }] });
  assert.equal(r.status, 'no_change'); await tick(s);
  assert.equal(s.revision, before);
  const off = make({ compiler: false }); await tick(off);
  await off.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'p1', source: 'same text' }] }); await tick(off);
  const offBefore = off.revision;
  await off.transaction({ components: [{ op: 'redefine', kind: 'prompt', name: 'p1', source: 'same text' }] }); await tick(off);
  assert.notEqual(off.revision, offBefore);
});

test('M-B: per-call append and patch land on the current source; a missing find text asks one concrete question', async () => {
  const s = make(); await tick(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'p2', source: 'alpha' }] }); await tick(s);
  await s.transaction({ components: [{ op: 'redefine', kind: 'prompt', name: 'p2', write: 'append', source: 'beta' }] }); await tick(s);
  assert.equal(s.active().find((x: any) => x.kind === 'prompt' && x.name === 'p2').source, 'alpha\nbeta');
  await s.transaction({ components: [{ op: 'redefine', kind: 'prompt', name: 'p2', write: 'patch', patch: [{ find: 'alpha', replace: 'gamma' }] }] }); await tick(s);
  assert.match(s.active().find((x: any) => x.kind === 'prompt' && x.name === 'p2').source, /^gamma\nbeta/);
  await assert.rejects(() => s.transaction({ components: [{ op: 'redefine', kind: 'prompt', name: 'p2', write: 'patch', patch: [{ find: 'not-there', replace: 'x' }] }] }), /not present|not in/);
});

test('M-B: a scoped restore reverts only the named addresses and reports what it left current', async () => {
  const s = make(); await tick(s);
  const originalMax = s.policy.request.maxOutputTokens;
  await s.transaction({ policy: { request: { maxOutputTokens: 4096 } } }); await tick(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'keepme', source: 'K' }] }); await tick(s);
  await s.transaction({ restore: 1, restore_scope: ['policy.request'] }); await tick(s);
  assert.equal(s.policy.request.maxOutputTokens, originalMax);
  assert.ok(s.active().some((x: any) => x.kind === 'prompt' && x.name === 'keepme'));
  const fact = all(s).findLast((r: any) => r.type === 'reflection_activated' && r.value.restore_scope)?.value;
  assert.deepEqual(fact.restore_scope, ['policy.request']);
  assert.ok(fact.differs_not_restored.includes('components.prompt.keepme'));
});

test('M-C: a window opens only for a declared effect; flag off opens provisional windows for every change', async () => {
  const s = make(); await open(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'w0', source: 'no declaration' }] }); await tick(s);
  assert.equal(s.detail('windows').length, 0);
  const fact = all(s).findLast((r: any) => r.type === 'reflection_activated' && r.value.validation_window !== undefined)?.value;
  assert.match(String(fact?.validation_window ?? ''), /none/);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'w1', source: 'declared' }], expected_effect: 'next segment repeats this prompt less' }); await tick(s);
  const windows = s.detail('windows');
  assert.equal(windows.length, 1);
  assert.equal(windows[0].effect_status, 'specified');
  assert.equal(windows[0].expected_effect, 'next segment repeats this prompt less');
  const off = make({ effect_return: false }); await open(off);
  await off.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'w0', source: 'no declaration' }] }); await tick(off);
  assert.equal(off.detail('windows').length, 1);
  assert.equal(off.detail('windows')[0].effect_status, 'effect_unspecified');
});

test('M-C: evidence is what the agent cites; the booked review set is not auto-attached', async () => {
  const s = make(); await open(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'e1', source: 'cited' }] });
  const fact = all(s).findLast((r: any) => r.type === 'reflection_activated')?.value;
  assert.deepEqual(fact.evidence_refs.auto_attached, []);
  const off = make({ effect_return: false }); await open(off);
  await off.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'e1', source: 'cited' }] });
  const offFact = all(off).findLast((r: any) => r.type === 'reflection_activated')?.value;
  assert.ok(offFact.evidence_refs.auto_attached.length > 0);
});

test('terminal closure: new reviews are suppressed while final delivery is pending, except a forced review', async () => {
  let pending = false;
  const s = make(undefined, { pendingDeliveryState: () => pending }); await tick(s);
  pending = true;
  s.outcome({ source: 'protected_acceptance', value: 1 });
  await s.event('settlement', 'unit', { event_classes: ['task_outcome'], coverage_tags: [] });
  assert.ok(all(s).some((r: any) => r.type === 'review_suppressed'));
  assert.equal(s.export().root.queue.length, 0);
  await s.event('settlement', 'forced', { event_classes: ['task_outcome'], coverage_tags: [], force_review: true });
  assert.equal(s.export().root.queue.length, 1);
});
