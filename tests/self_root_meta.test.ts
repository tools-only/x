import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SelfRoot, FLOOR, PROTOCOL, META_GOAL, META_STRATEGY, hash } from '../demo/self_root.ts';

// EVO_META (design 2026-11-16 §4): the general meta loop is a task-free host spine. Offline checks cover the
// T0 gate and its one-time design record, the absence of host review entrances, the T2 close inventory, and
// that the replaced mechanisms (ASK, L4, legacy obligation) are off rather than stacked.

const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}) => new SelfRoot(contract(), undefined, undefined, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const tick = async (s: any) => s.boundary(()=>{}, ()=>{});
const all = (s: any) => s.export().root.ledger;
const count = (s: any, type: string) => all(s).filter((r: any) => r.type === type).length;
const seed = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] };
// A design that satisfies the T0 gate: one transition, bound to the receipt type META itself registers.
const design = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }, { id: 'refine', role: 'agent' }], decisions: [],
  transitions: [{ id: 'again', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'refine' }] };

test('META T0: only the protocol surface before the design; the material is delivered once and names the gate', async () => {
  const s = make({ meta: true }); await tick(s); s.pin();
  assert.deepEqual(s.surface(), [...PROTOCOL], 'no task tool before the first orchestration write');
  assert.throws(() => s.assertActionAllowed('office.render'), /outside pinned mode\/user surface/);
  assert.doesNotThrow(() => s.assertActionAllowed('reflect_orchestration'), 'the design interface stays reachable');
  assert.equal(s.metaGoal(), META_GOAL);
  const t0 = s.metaT0();
  assert.ok(t0.includes('DESIGN TURN') && t0.includes('reflect_orchestration') && t0.includes('four layers'));
  for (const layer of ['prompt - components of kind prompt', 'context - policy.context', 'loop - your orchestration', 'harness - all of the above'])
    assert.ok(t0.includes(layer), `the material names the ${layer.split(' ')[0]} layer and an object in it`);
  assert.ok(t0.includes('self.change') && t0.includes('A design has at least one transition'), 'the gate and the loop receipt are stated');
  assert.ok(t0.includes('The first task segment opens after the reflect_orchestration that states your design'));
  assert.ok(!t0.toLowerCase().includes('deck'), 'the spine carries no task content');
  assert.equal(count(s, 'meta_t0_delivered'), 1, 'delivery is booked once');
  s.metaT0();
  assert.equal(count(s, 'meta_t0_delivered'), 1);
  const off = make(); await tick(off);
  assert.equal(off.metaGoal(), '');
  assert.ok(off.surface().includes('office.render'), 'non-META arms keep the unforbidden surface');
  assert.equal(count(off, 'meta_t0_delivered'), 0);
});

test('META T0: a seed-equivalent write leaves the gate closed; a design with a transition opens it', async () => {
  const s = make({ meta: true }); await tick(s);
  // M2 (2026-11-16): a rewrite equivalent to the seed passed the gate, so the design turn had no product and T0->T1
  // had no progression. The gate now requires a design with at least one transition.
  await assert.rejects(s.transaction({ baseRevision: 1, orchestration: seed }), /T0 gate opens on a design, and a design has at least one transition/);
  assert.equal(s.metaT0Pending, true, 'a no-op never opens the gate');
  assert.equal(count(s, 'meta_t0_design'), 0);
  assert.ok(s.metaT0().includes('at least one transition'), 'the material stays and states the requirement');
  await tick(s);
  const result = await s.transaction({ baseRevision: s.revision, orchestration: design });
  assert.ok(result.addresses.includes('orchestration'));
  assert.equal(count(s, 'meta_t0_design'), 1, 'the first accepted design is recorded once');
  assert.equal(all(s).find((r: any) => r.type === 'meta_t0_design').value.gate, 'open');
  assert.equal(s.metaT0Pending, false);
  assert.equal(s.metaT0(), '', 'the material stops once the design exists');
  await tick(s);
  assert.ok(s.surface().includes('office.render'), 'the task surface opens after the design');
  s.pin();
  assert.doesNotThrow(() => s.assertActionAllowed('office.render'));
  await s.transaction({ baseRevision: s.revision, orchestration: design });
  assert.equal(count(s, 'meta_t0_design'), 1, 'later writes never re-record the design');
});

test('META T1: booked facts, settlements and heartbeats open no host review; the old arm still opens them', async () => {
  const s = make({ meta: true }); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  const settled = await s.event('settlement', 'submitted', { event_classes: ['task_outcome'], coverage_tags: ['submitted'], force_review: true });
  assert.deepEqual(settled.triggers, [], 'force_review does not summon a review');
  const heartbeat = await s.event('heartbeat', 'hb:1', {});
  assert.deepEqual(heartbeat.triggers, []);
  await tick(s);
  assert.equal(s.review, undefined);
  assert.equal(s.queue.length, 0);
  assert.equal(s.reviewStrategy(), META_STRATEGY);
  const old = make(); await tick(old);
  const oldSettled = await old.event('settlement', 'submitted', { event_classes: ['task_outcome'], coverage_tags: ['submitted'], force_review: true });
  assert.ok(oldSettled.triggers.some((t: any) => t.id === 'evolution_review'), 'the comparison arm is unchanged');
  const oldHeartbeat = await old.event('heartbeat', 'hb:1', {});
  assert.ok(oldHeartbeat.triggers.some((t: any) => t.id === 'contract:hb:1'));
});

test('META replaces the other mechanisms and leaves an agent-declared entrance schema untouched', async () => {
  const s = make({ meta: true, ask: true, l4: true, legacy_obligation: true }); await tick(s);
  assert.equal(s.mech.ask, false);
  assert.equal(s.mech.l4, false);
  assert.equal(s.mech.legacy_obligation, false);
  assert.equal(s.reviewStrategy(true), META_STRATEGY, 'no entrance question block, no layer framing');
  assert.ok(!s.reviewStrategy(true).includes('ENTRANCE QUESTIONS'));
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  await s.transaction({ baseRevision: s.revision, policy: { routes: [{ id: 'self_check', event: 'settlement', mode: 'reflect', priority: 1, conclusion_sink: 'ledger' }] } }); await tick(s);
  await s.event('settlement', 'agent-loop', { event_classes: ['task_outcome'], coverage_tags: ['agent-loop'], force_review: true }); await tick(s);
  assert.ok(s.review, 'the agent-declared route is a legal entrance');
  assert.equal(s.reviewExitSchema.properties.entry_question_responses, undefined);
  assert.equal(s.exitOperationSchema.properties.result, undefined);
});

test('META T2: task end books the harness inventory once; before_session_end never duplicates it', async () => {
  const s = make({ meta: true }); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  await s.transaction({ baseRevision: s.revision, components: [{ op: 'define', kind: 'prompt', name: 'house_style', source: 'deliver in the review language' }] }); await tick(s);
  s.taskEnd('delivered');
  const inventory = all(s).filter((r: any) => r.type === 'meta_harness_inventory');
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].value.orchestration.steps, 2);
  assert.equal(inventory[0].value.components.length, 1);
  assert.ok(inventory[0].value.design, 'the inventory cites the design record');
  await s.event('before_session_end', 'session:1', {});
  assert.equal(count(s, 'meta_harness_inventory'), 1);
  const off = make(); await tick(off); off.taskEnd('delivered');
  assert.equal(count(off, 'meta_harness_inventory'), 0, 'no inventory outside META');
});

test('META self-state push: the tail carries the optimizable object and a since-last-change delta, facts only', async () => {
  const s = make({ meta: true }); await tick(s);
  const before = s.selfChangeDigest();
  assert.equal(before.self_changes, 0);
  assert.equal(before.last_change, null);
  assert.equal(before.last_self_change, null, 'no receipt exists before the first activation after the design');
  assert.equal(before.requests_since_change, s.request);
  assert.deepEqual(before.validation_windows, [], 'an empty window list is a fact, not an absence');
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  const first = s.selfChangeDigest();
  assert.ok(first.self_changes >= 1, 'the write is a self change');
  assert.deepEqual(first.last_change.addresses, ['orchestration']);
  assert.equal(first.last_change.revision, s.revision);
  s.fact('tool_failed', { tool: 'reflect_orchestration', content: 'steps[0].role is not a declared role' });
  s.fact('tool_failed', { tool: 'reflect_orchestration', content: 'second refusal' });
  s.fact('tool_failed', { tool: 'office.render', content: 'not a reflect operation' });
  await tick(s);
  const after = s.selfChangeDigest();
  const lastRow = all(s).filter((r: any) => r.type === 'reflection_activated' || r.type === 'meta_t0_design').at(-1);
  assert.equal(after.requests_since_change, s.request - lastRow.request, 'requests since the last self change');
  assert.equal(after.refused_self_operations.length, 1, 'an ordinary tool failure that no self-written rule caused is not a refused self operation');
  assert.equal(after.refused_self_operations[0].count, 2);
  assert.equal(after.refused_self_operations[0].last_error, 'second refusal', 'the last refusal text is carried verbatim');
});

test('META self-lock: a narrow step whitelist scopes task tools but never the protocol that widens it again', async () => {
  const receiptTypes = ['office.render', 'office.look', 'office.deliver', 'submit_unit'];
  const s = make({ meta: true }, { actionReceiptTypes: receiptTypes }); await tick(s);
  // M3 run 2026-11-16: the agent's own revision 2 listed the four receipt types, and every read/read_self/reflect call
  // afterwards returned "not allowed by active step work" for 30 requests with no route back. Two causes: a step's
  // actions could only name receipt types, and the step gate covered the protocol tools themselves.
  const narrow: any = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent', actions: ['read'] }], decisions: [],
    transitions: [{ id: 'again', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'work' }] };
  const written = await s.transaction({ baseRevision: 1, orchestration: narrow });
  assert.ok(written.addresses.includes('orchestration'), 'a whitelist may name a tool this runtime never records as a receipt');
  await tick(s); s.pin();
  assert.doesNotThrow(() => s.assertActionAllowed('read'), 'a tool on the whitelist runs');
  const granted = s.surface().filter((t: string) => !PROTOCOL.includes(t));
  assert.ok(granted.length > 1, 'the task surface has tools beyond the whitelist');
  for (const tool of granted.filter((t: string) => t !== 'read'))
    assert.throws(() => s.assertActionAllowed(tool), /not allowed by active step work/, `${tool} stays scoped by the step`);
  for (const op of PROTOCOL) assert.doesNotThrow(() => s.assertActionAllowed(op), `${op} stays reachable under a narrow step`);
});

test('META self-state push: a reflection refused through abortTransaction is booked as a refused self operation', async () => {
  const s = make({ meta: true }); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  s.abortTransaction('orchestration rejected: step work does not allow read', 'reflect_orchestration');
  const digest = s.selfChangeDigest();
  assert.equal(digest.refused_self_operations.length, 1, 'the rejection is visible in the pushed self state');
  assert.equal(digest.refused_self_operations[0].tool, 'reflect_orchestration');
  assert.match(digest.refused_self_operations[0].last_error, /does not allow read/);
});

test('META self-state push: a task tool refused by the agent\'s own step whitelist is a refused self operation too', async () => {
  const s = make({ meta: true }); await tick(s);
  const narrow: any = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent', actions: ['read'] }], decisions: [],
    transitions: [{ id: 'again', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'work' }] };
  await s.transaction({ baseRevision: 1, orchestration: narrow }); await tick(s);
  s.abortTransaction('action python is not allowed by active step work', 'python');
  s.abortTransaction('action python is not allowed by active step work', 'python');
  s.abortTransaction('compile error in generated module', 'python');
  const digest = s.selfChangeDigest();
  const row = digest.refused_self_operations.find((r: any) => r.tool === 'python');
  assert.ok(row, 'the whitelist refusal is visible in the pushed self state');
  assert.equal(row.count, 2, 'an unrelated tool failure on the same tool is not counted');
  assert.match(row.last_error, /not allowed by active step work/);
});

test('META self.change: an activation after the design books the self state as a receipt the loop turns on', async () => {
  // 2026-11-16, problems 2 and 3: the self view was pushed every request with full content but no step, transition
  // or decision consumed it (read_self calls = 0 in three runs). The view is now also an action receipt: a transition
  // the agent writes on self.change fires at the activation, and a decision can cite the receipt by the ref the
  // digest shows. The T0 design itself is the loop's existence condition and books none.
  const recap: any = { revision: 1, roles: [{ id: 'agent' }], slots: [],
    steps: [{ id: 'work', role: 'agent' }, { id: 'check', role: 'agent', decision: 'look' }, { id: 'refine', role: 'agent' }],
    decisions: [{ id: 'look', judge: 'agent', question: 'what did the change do', evidence: [{ type: 'self.change' }], output: { type: 'object', required: ['go'], properties: { go: { type: 'boolean' } } } }],
    transitions: [{ id: 'to_check', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'check' },
      { id: 'to_refine', from: 'check', on: { type: 'decision', id: 'look', path: '/go', equals: true }, requires: [{ type: 'self.change' }], to: 'refine' }] };
  const s = make({ meta: true }); await tick(s);
  const receipts = () => s.snapshot().actions.filter((a: any) => a.type === 'self.change');
  await s.transaction({ baseRevision: 1, orchestration: recap });
  await tick(s);
  assert.equal(receipts().length, 0, 'the T0 design activation books no self.change receipt');
  assert.equal(s.step, 'work');
  assert.equal(s.selfChangeDigest().last_self_change, null);
  await s.transaction({ baseRevision: s.revision, components: [{ op: 'define', kind: 'prompt', name: 'house_style', source: 'deliver in the review language' }] });
  await tick(s);
  const booked = receipts();
  assert.equal(booked.length, 1, 'the activation books the pushed self state as one receipt');
  assert.deepEqual(booked[0].facts.addresses, ['components.prompt.house_style']);
  assert.equal(booked[0].facts.revision, s.revision);
  assert.equal(s.step, 'check', 'the transition the agent wrote on self.change fires at that activation');
  const digest = s.selfChangeDigest();
  assert.equal(digest.last_self_change.ref, booked[0].ref, 'the digest shows the receipt ref a decision can cite');
  assert.equal(digest.last_self_change.transition.status, 'advanced');
  const decided = s.decide({ decisionId: 'look', actor: 'agent', evidenceRefs: [booked[0].ref], result: { go: true } });
  assert.ok(decided.accepted, 'the pushed self state is citable evidence, not wallpaper');
  assert.equal(s.advance().status, 'advanced');
  const off = make(); await tick(off);
  await off.transaction({ baseRevision: 1, orchestration: design }); await tick(off);
  assert.equal(off.snapshot().actions.filter((a: any) => a.type === 'self.change').length, 0, 'the comparison arm books none');
});

test('META resident prompt: no host-opened review entrance and no window promise; the B prompt is untouched', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const meta = read('../demo/prompts/self_root_meta_system.md');
  const base = read('../demo/prompts/self_root_system.md');
  assert.ok(!meta.includes('the host opens evolution reviews at work boundaries'));
  assert.ok(!meta.includes('FIXED REVIEW ENTRANCE'));
  assert.ok(!meta.includes('The host opens a validation window only for a declared effect'));
  assert.ok(meta.includes('No host-opened review entrance exists in this run'));
  assert.ok(meta.includes('SELF-STATE MATERIAL'));
  assert.ok(base.includes('FIXED REVIEW ENTRANCE'), 'the B-arm prompt still describes the entrance its own arm opens');
});
