import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SelfRoot, FLOOR, PROTOCOL, META_STRATEGY, hash } from '../demo/self_root.ts';

// EVO_META (user decision 2026-11-16): the self-evolution loop is a fixed host mechanism plus seven fixed fields;
// the T0 design turn fills only the task side (orchestration.contract). Offline checks cover the fixed prompt file,
// the contract gate and its task-side trigger vocabulary, the phase-adapted board, the mechanical acceptance
// counters, and the absence of a host review entrance.

const userContract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}, validator?: any) => new SelfRoot(userContract(), undefined, validator, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const tick = async (s: any) => s.boundary(()=>{}, ()=>{});
const all = (s: any) => s.export().root.ledger;
const count = (s: any, type: string) => all(s).filter((r: any) => r.type === type).length;
const seed = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] };
// The task side the design turn fills: goal, acceptance and a run plan whose trigger binds a task-side event.
const taskSide = { task_goal: 'Deliver the artifact this run must produce', task_acceptance: "verified from this run's own acceptance checks and a fresh render",
  loop_policy: { look_when: [{ on: 'segment_boundary', look: 'the last segment numbers and the last change' }] } };
const design = { ...seed, contract: taskSide };
const fields = readFileSync(new URL('../demo/prompts/self_root_meta_fields.md', import.meta.url), 'utf8');
const recordableTool = async (_path: string, _source: string) => ({ kind: 'tool', name: 'deck_check', description: 'fixture', enabled: true, program: true });

test('META fixed fields: the static prompt file is host-given, task-free and ordered; the board starts empty', async () => {
  // The four fixed fields stay in a prompt file that enters the stable prefix unchanged: editing the agent's harness
  // must never rewrite them (and never zero the provider prefix cache, the yibu lesson of 2026-10-14).
  for (const name of ['TASK IS THE HOST', 'SELF-EVOLUTION GOAL', 'SELF-EVOLUTION MECHANISM', 'SELF-EVOLUTION ACCEPTANCE'])
    assert.ok(fields.includes(name), `the fixed file names ${name}`);
  assert.ok(fields.indexOf('TASK IS THE HOST') < fields.indexOf('SELF-EVOLUTION GOAL') && fields.indexOf('SELF-EVOLUTION GOAL') < fields.indexOf('SELF-EVOLUTION MECHANISM') && fields.indexOf('SELF-EVOLUTION MECHANISM') < fields.indexOf('SELF-EVOLUTION ACCEPTANCE'));
  assert.ok(!/\{\{/.test(fields), 'no values and no placeholders: the file is the same text every request');
  assert.ok(!fields.toLowerCase().includes('deck'), 'no task content in the host-given text');
  const s = make({ meta: true }); await tick(s);
  assert.deepEqual(s.surface(), [...PROTOCOL.filter(t => t !== 'decide_exit'), 'read', 'ls', 'grep'], 'before the contract write: the protocol (no decide_exit without a review) plus read-only inspection');
  assert.throws(() => s.assertActionAllowed('office.render'), /outside pinned mode\/user surface/);
  assert.doesNotThrow(() => s.assertActionAllowed('reflect_orchestration'), 'the design interface stays reachable');
  const board = s.metaBoard();
  assert.match(board, /TASK GOAL: \(empty/, 'field 5 is empty at the design turn');
  assert.match(board, /TASK ACCEPTANCE: \(empty/, 'field 6 is empty at the design turn');
  assert.match(board, /^OPTIMIZABLE OBJECTS$/m, 'field 4 is host-rendered from live state');
  for (const layer of ['prompt -', 'context - policy.context', 'loop - orchestration revision', 'harness - '])
    assert.ok(board.includes(layer), `the board names the ${layer.split(' ')[0]} layer and an object in it`);
  assert.match(board, /DESIGN TURN/, 'the design turn states what this turn does');
  // 2026-11-16: the loop is self-evolving; a trigger may bind only events this run records itself.
  assert.ok(board.includes('segment_boundary, failure, repetition'), 'the legal task-side events are named');
  assert.ok(!board.includes('delivery_feedback'), 'feedback from outside the run is not an event a trigger can bind');
  assert.ok(!board.toLowerCase().includes('deck'), 'the spine carries no task content');
  assert.equal(count(s, 'meta_t0_delivered'), 1, 'delivery is booked once');
  s.metaBoard();
  assert.equal(count(s, 'meta_t0_delivered'), 1);
  const off = make(); await tick(off);
  assert.equal(off.metaBoard(), '');
  assert.ok(off.surface().includes('office.render'), 'non-META arms keep the unforbidden surface');
  assert.equal(count(off, 'meta_t0_delivered'), 0);
});

test('META contract gate: missing fields and counter/clock triggers are refused with the legal form; a complete contract opens it', async () => {
  // The old gate only asked whether something was submitted (and then whether it had a transition). The gate now
  // checks the fixed contract object; a pure counter or clock cannot stand in for a task-side event.
  const s = make({ meta: true }); await tick(s);
  await assert.rejects(s.transaction({ baseRevision: 1, orchestration: seed }),
    /T0 gate needs the task-side contract.*contract\.task_goal is missing.*contract\.task_acceptance is missing.*contract\.loop_policy\.look_when is missing/);
  assert.equal(s.metaT0Pending, true, 'a failed write never opens the gate');
  assert.equal(count(s, 'meta_t0_design'), 0);
  await tick(s);
  const clock: any = { ...seed, contract: { ...taskSide, loop_policy: { look_when: [{ on: 'every_5_requests', look: 'look at the harness' }] } } };
  await assert.rejects(s.transaction({ baseRevision: 1, orchestration: clock }),
    /look_when\[0\]\.on names "every_5_requests".*legal events are segment_boundary, failure, repetition/);
  await tick(s);
  assert.equal(s.metaT0Pending, true);
  const external: any = { ...seed, contract: { ...taskSide, loop_policy: { look_when: [{ on: 'delivery_feedback', look: 'what someone said about the delivery' }] } } };
  await assert.rejects(s.transaction({ baseRevision: 1, orchestration: external }), (err: Error) => {
    assert.match(err.message, /look_when\[0\]\.on names "delivery_feedback".*legal events are segment_boundary, failure, repetition, self_change\)/);
    assert.ok(!err.message.includes('repetition, delivery_feedback'), 'the refusal no longer offers an external event');
    return true;
  });
  await tick(s);
  assert.equal(s.metaT0Pending, true, 'an external-feedback trigger never opens the gate');
  const written = await s.transaction({ baseRevision: 1, orchestration: design });
  assert.ok(written.addresses.includes('orchestration'));
  assert.equal(count(s, 'meta_t0_design'), 1, 'the first accepted contract write is recorded once');
  assert.deepEqual(all(s).find((r: any) => r.type === 'meta_t0_design').value.contract, taskSide, 'the design record carries the task side');
  assert.equal(s.metaT0Pending, false);
  assert.ok(!s.metaBoard().includes('DESIGN TURN'), 'the design block stops once the design exists');
  await tick(s);
  assert.ok(s.surface().includes('office.render'), 'the task surface opens after the design');
  s.pin();
  assert.doesNotThrow(() => s.assertActionAllowed('office.render'));
  await s.transaction({ baseRevision: s.revision, orchestration: design });
  assert.equal(count(s, 'meta_t0_design'), 1, 'later writes never re-record the design');
});

test('META contract: the design record keeps the task side when a later orchestration write omits it', async () => {
  const s = make({ meta: true }); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  await s.transaction({ baseRevision: s.revision, orchestration: { ...seed, steps: [{ id: 'work', role: 'agent' }, { id: 'check', role: 'agent' }] } }); await tick(s);
  assert.equal(s.current.orchestration.contract, undefined, 'the later definition carries no contract');
  assert.match(s.metaBoard(), /TASK GOAL: Deliver the artifact/, 'the declared task side stays visible');
});

test('META board: a tool change activates with a later request and counts as used only when the tool runs', async () => {
  const s = make({ meta: true }, {}, recordableTool); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  await s.transaction({ baseRevision: s.revision, components: [{ op: 'define', kind: 'tool', name: 'deck_check', source: '# program: on\n# fixture tool' }] }); await tick(s);
  let acc = s.metaAcceptance();
  assert.equal(acc.changes, 1, 'the post-design activation is one change');
  assert.equal(acc.activated, 0, 'no later request has run yet');
  assert.equal(acc.used_later, 0);
  s.fact('provider_input', { component_addresses: ['tool.deck_check'] });
  acc = s.metaAcceptance();
  assert.equal(acc.activated, 1, 'a later provider request ran after the write');
  assert.equal(acc.used_later, 0, 'being visible in the request is not running the tool');
  s.fact('event', { type: 'tool_succeeded', facts: { tool: 'deck_check' } });
  acc = s.metaAcceptance();
  assert.equal(acc.used_later, 1, 'the tool ran in a later task action');
  assert.match(s.metaBoard(), /changes 1 \/ activated 1 \/ used_later 1/);
});

test('META board flow: compact during the task, expanded at a segment boundary, settled once at task end', async () => {
  const s = make({ meta: true }); await tick(s);
  await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s);
  assert.match(s.metaBoard(), /MECHANISM: every write activates at the next request boundary/);
  assert.ok(!s.metaBoard().includes('SEGMENT BOUNDARY'));
  await s.event('settlement', 'unit:1', { final: true }); await tick(s);
  const boundary = s.metaBoard();
  assert.ok(boundary.includes('SEGMENT BOUNDARY'), 'the boundary expands the block');
  assert.match(boundary, /Last change: none/);
  assert.match(boundary, /Last segment: requests 0, task actions 0, tool errors 0, elapsed 0s/);
  assert.match(boundary, /run plan for this event \(segment_boundary\): the last segment numbers and the last change/, 'the contract reaches the loop unasked, at the event its trigger names');
  assert.match(boundary, /never combines them into a task-level acceptance conclusion/, 'the boundary states that per-unit verdicts stay per-unit');
  s.fact('request_record', { request: s.request });
  assert.ok(!s.metaBoard().includes('SEGMENT BOUNDARY'), 'one request later the compact line returns');
  s.taskEnd('delivered');
  assert.match(s.metaBoard(), /SESSION CLOSED - acceptance settled once: changes 0 \/ activated 0 \/ used_later 0/);
  const inventory = all(s).filter((r: any) => r.type === 'meta_harness_inventory');
  assert.deepEqual(inventory[0].value.acceptance, { changes: 0, activated: 0, used_later: 0, last_change: null, contract: taskSide });
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
  assert.equal(inventory[0].value.orchestration.steps, 1);
  assert.equal(inventory[0].value.components.length, 1);
  assert.ok(inventory[0].value.design, 'the inventory cites the design record');
  assert.equal(inventory[0].value.acceptance.changes, 1, 'the prompt change is counted, the design activation is not');
  assert.equal(inventory[0].value.acceptance.activated, 0, 'no request ran after the change');
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
  const narrow: any = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent', actions: ['read'] }], decisions: [], contract: taskSide,
    transitions: [{ id: 'again', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'work' }] };
  const written = await s.transaction({ baseRevision: 1, orchestration: narrow });
  assert.ok(written.addresses.includes('orchestration'), 'a whitelist may name a tool this runtime never records as a receipt');
  await tick(s); s.pin();
  assert.doesNotThrow(() => s.assertActionAllowed('read'), 'a tool on the whitelist runs');
  const granted = s.surface().filter((t: string) => !PROTOCOL.includes(t));
  assert.ok(granted.length > 1, 'the task surface has tools beyond the whitelist');
  for (const tool of granted.filter((t: string) => t !== 'read'))
    assert.throws(() => s.assertActionAllowed(tool), /not allowed by active step work; this step's declared actions: read/, `${tool} stays scoped by the step and the refusal names the legal set`);
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
  const narrow: any = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent', actions: ['read'] }], decisions: [], contract: taskSide,
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
  // 2026-11-16: the self view was pushed every request with full content but no step, transition or decision consumed
  // it (read_self calls = 0 in three runs). The view is now also an action receipt: a transition the agent writes on
  // self.change fires at the activation, and a decision can cite the receipt by the ref the digest shows. The T0
  // design itself is the loop's existence condition and books none.
  const recap: any = { revision: 1, roles: [{ id: 'agent' }], slots: [], contract: taskSide,
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
  assert.deepEqual(Object.keys(digest.last_self_change.transition).sort(), ['status', 'step'], 'the transition is compacted to status and step, so the booked receipt does not nest the previous digest on every revision');
  const decided = s.decide({ decisionId: 'look', actor: 'agent', evidenceRefs: [booked[0].ref], result: { go: true } });
  assert.ok(decided.accepted, 'the pushed self state is citable evidence, not wallpaper');
  assert.equal(s.advance().status, 'advanced');
  const off = make(); await tick(off);
  await off.transaction({ baseRevision: 1, orchestration: design }); await tick(off);
  assert.equal(off.snapshot().actions.filter((a: any) => a.type === 'self.change').length, 0, 'the comparison arm books none');
});

test('META resident prompt: no host-opened review entrance and the fixed fields are named', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const meta = read('../demo/prompts/self_root_meta_system.md');
  const base = read('../demo/prompts/self_root_system.md');
  assert.ok(!meta.includes('the host opens evolution reviews at work boundaries'));
  assert.ok(!meta.includes('FIXED REVIEW ENTRANCE'));
  assert.ok(!meta.includes('The host opens a validation window only for a declared effect'));
  assert.ok(meta.includes('No host-opened review entrance exists in this run'));
  assert.ok(meta.includes('SELF-STATE MATERIAL') && meta.includes('TASK GOAL') && meta.includes('acceptance counters'));
  assert.ok(base.includes('FIXED REVIEW ENTRANCE'), 'the B-arm prompt still describes the entrance its own arm opens');
});
