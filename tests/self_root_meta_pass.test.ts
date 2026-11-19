import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, META_STRATEGY, META_PASS_STRATEGY, META_PASS_REQUEST_CAP, META_PASS_ROUND_CAPS, META_PASS_ROUND1_LINE, META_PASS_ROUND2_LINE, ENTRANCE_QUESTIONS, hash } from '../demo/self_root.ts';

// User decision 2026-11-17: the seeded evolution_policy prompt is gone. Evolution judgment runs in one
// host-opened evolution pass at a recorded run boundary, outside the task turn; the pass writes through the
// ordinary reflection interface and the runtime assembles nothing further. Same date, second decision: induction
// and capability inference never share a round - the pass runs as two bounded rounds, round 1 closing with the
// agent's own reading and round 2 opening at the next request boundary with that closure at its entry and the
// entrance questions as its frame. Offline checks cover: the trigger set (episode closed, delivery stalled,
// recorded stagnation), the per-round prompts and facts, closure by decide_exit, the per-round mechanical caps,
// and that non-META arms keep their rhythm.

const userContract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:60,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}, validator?: any) => new SelfRoot(userContract(), undefined, validator, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const tick = async (s: any) => s.boundary(()=>{}, ()=>{});
const all = (s: any) => s.export().root.ledger;
const seed = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] };
const taskSide = { task_goal: 'Deliver the artifact this run must produce', task_acceptance: "verified from this run's own acceptance checks and a fresh render",
  loop_policy: { look_when: [{ on: 'segment_boundary', look: 'the last segment numbers and the last change' }] } };
const design = { ...seed, contract: taskSide };
const designed = async (mechanisms: any = { meta: true }) => { const s = make(mechanisms); await tick(s); await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s); return s; };
const RESPONSES = ['parameter layer, not a capability gap', 'none', 'none'];

test('META pass: an episode close opens one pass outside the task turn, with its own strategy and facts', async () => {
  const s = await designed();
  assert.equal(s.metaPassDue(), null, 'no boundary fact recorded yet: no pass');
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a', delivered_revision: 3 });
  await tick(s);
  assert.ok(s.review, 'the episode boundary opens the pass');
  assert.equal(s.review.triggers[0].source, 'meta_pass');
  assert.equal(s.mode, 'reflect', 'the task step is suspended for the pass');
  assert.ok(s.reviewStrategy().startsWith(META_PASS_STRATEGY), 'the pass request carries the pass strategy, not the resident one');
  assert.ok(s.reviewStrategy().includes(META_PASS_ROUND1_LINE), 'round 1 carries the induction frame');
  assert.ok(!s.reviewStrategy().includes(ENTRANCE_QUESTIONS[0]), 'the entrance questions belong to round 2, not round 1');
  assert.notEqual(s.reviewStrategy(), META_STRATEGY);
  const view = s.reviewSelfView();
  assert.equal(view.evolution_pass.trigger, 'episode_boundary', 'the pass says which recorded boundary opened it');
  assert.equal(view.evolution_pass.episode, 1);
  assert.ok(s.surface().includes('decide_exit'), 'the pass closes through the agent\'s own exit');
  assert.ok(all(s).some((r: any) => r.type === 'meta_pass_opened' && r.value.trigger === 'episode_boundary' && r.value.round === 1));
  const closed = s.exit({ reason: 'no change: the recorded facts show one delivery path' });
  assert.ok(closed.recorded);
  assert.deepEqual(closed.next_round, { round: 2, of: 2, opens: 'next request boundary' }, 'the induction closure announces the capability round');
  assert.equal(s.review, undefined);
  assert.equal(s.mode, 'execute', 'decide_exit suspends the pass until the next boundary');
  await tick(s);
  assert.ok(s.review, 'the capability round opens at the next request boundary');
  assert.equal(s.mode, 'reflect');
  assert.ok(s.reviewStrategy().includes(META_PASS_ROUND2_LINE), 'round 2 carries the capability frame');
  assert.ok(s.reviewStrategy().includes(ENTRANCE_QUESTIONS[0]), 'the entrance questions ride the round-2 strategy');
  assert.ok(all(s).some((r: any) => r.type === 'meta_pass_round' && r.value.from === 1 && r.value.to === 2));
  const done = s.exit({ result: { reason: 'no capability gap read from this window', entry_question_responses: RESPONSES } });
  assert.ok(done.recorded);
  assert.equal(done.next_round, undefined, 'the capability round is the final round');
  assert.equal(s.review, undefined);
  assert.equal(s.mode, 'execute', 'the final round\'s decide_exit resumes the task step');
  await tick(s);
  assert.equal(s.metaPassDue(), null, 'the closed pass does not reopen without a new boundary fact');
  await tick(s);
  assert.equal(s.review, undefined, 'and no third round or second pass is queued');
});

test('META pass: a stalled delivery transition and recorded stagnation each open one bounded pass', async () => {
  const s = await designed();
  s.fact('action_transition_stalled', { action: 'office.deliver', status: 'stalled', step: 'work' });
  await tick(s);
  assert.ok(s.review, 'a stalled delivery opens the pass');
  assert.equal(s.reviewSelfView().evolution_pass.trigger, 'delivery_stall');
  s.exit({ reason: 'no change' }); await tick(s);
  assert.ok(s.review, 'the capability round follows the induction close');
  s.exit({ result: { reason: 'no gap', entry_question_responses: RESPONSES } }); await tick(s);
  assert.equal(s.review, undefined);

  const t = await designed();
  for (let i = 0; i < 12; i++) t.fact('request_record', { request: i, pin: { mode: 'execute' } });
  await tick(t);
  assert.ok(t.review, 'twelve execute requests without an artifact write open the pass');
  assert.equal(t.reviewSelfView().evolution_pass.trigger, 'stagnation');
  assert.equal(t.reviewSelfView().evolution_pass.execute_requests_without_artifact_write, 12);

  const capped = make({ meta: true }); await tick(capped);
  await capped.transaction({ baseRevision: 1, orchestration: design });
  for (let i = 0; i < 5; i++) capped.fact('request_record', { request: i, pin: { mode: 'execute' } });
  await tick(capped);
  assert.equal(capped.review, undefined, 'a few requests are not stagnation');
});

test('META cadence follows the task adapter unit and interval', async () => {
  const requests = make({ meta: true }, { metaFallback: { unit: 'request', interval: 3 } });
  await tick(requests);
  await requests.transaction({ baseRevision: 1, orchestration: design });
  for (let request = 1; request <= 2; request++) requests.fact('request_record', { request, pin: { mode: 'execute' } });
  assert.equal(requests.metaPassDue(), null);
  requests.fact('request_record', { request: 3, pin: { mode: 'execute' } });
  assert.deepEqual(requests.metaPassDue()?.facts, {
    trigger: 'request_cadence_fallback', execute_requests_since_last_evolution: 3, interval: 3, window: [3, 5],
  });

  const actions = make({ meta: true }, {
    metaFallback: { unit: 'action', interval: 2 }, actionReceiptTypes: ['arc_action'],
  });
  await tick(actions);
  await actions.transaction({ baseRevision: 1, orchestration: design });
  for (let request = 1; request <= 5; request++) actions.fact('request_record', { request, pin: { mode: 'execute' } });
  assert.equal(actions.metaPassDue(), null);
  actions.fact('arc_action', { n: 1 });
  assert.equal(actions.metaPassDue(), null);
  actions.fact('arc_action', { n: 2 });
  assert.equal(actions.metaPassDue()?.facts.trigger, 'action_cadence_fallback');
  assert.equal(actions.metaPassDue()?.facts.actions_since_last_evolution, 2);
});

test('selective Meta resumes or opens only the chosen specialist', async () => {
  const create = async () => {
    const self = make({ meta: true }, { metaRouting: 'selective' });
    await tick(self);
    await self.transaction({ baseRevision: 1, orchestration: design });
    self.fact('request_record', { request: 1, pin: { mode: 'execute', revision: 2 }, tokens: { total: 100, status: 'reported' } });
    self.fact('action_transition_stalled', { action: 'office.deliver' });
    await tick(self);
    return self;
  };
  const resume = await create();
  assert.equal(resume.reviewExitSchema.properties.next_specialist.enum.includes('loop'), true);
  assert.equal(resume.stageView(resume.metaPassDue()?.window ?? [3, 4]).parent_recorded_tokens, 100);
  resume.exit({ result: { reason: 'continue task', next_specialist: 'none' } });
  await tick(resume);
  assert.equal(resume.review, undefined);

  const focused = await create();
  const closed = focused.exit({ result: { reason: 'workflow has no feedback point', next_specialist: 'loop' } });
  assert.deepEqual(closed.next_round.specialists, ['loop']);
  await tick(focused);
  assert.equal(focused.reviewSelfView().evolution_pass.specialist, 'loop');
  focused.fact('meta_specialist_no_change', { reason: 'no safe edit' });
  focused.closeMechanically('review_unresolved');
  await tick(focused);
  assert.equal(focused.review, undefined);
});

test('META pass: each round is bounded; the induction cap opens round 2, the capability cap closes the pass', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review);
  for (let i = 0; i < META_PASS_ROUND_CAPS[0]; i++) s.pin();
  await tick(s);
  assert.ok(s.review, 'the induction cap does not end the occasion: the capability round opens at the same boundary');
  assert.ok(s.reviewStrategy().includes(META_PASS_ROUND2_LINE));
  assert.ok(all(s).some((r: any) => r.type === 'meta_pass_capped' && r.value.round === 1 && r.value.cap === META_PASS_ROUND_CAPS[0]));
  assert.ok(all(s).some((r: any) => r.type === 'meta_pass_round' && r.value.to === 2), 'the mechanical close still advances the round');
  for (let i = 0; i < META_PASS_ROUND_CAPS[1]; i++) s.pin();
  await tick(s);
  assert.equal(s.review, undefined, 'the capability cap closes the pass');
  assert.equal(s.mode, 'execute');
  assert.ok(all(s).some((r: any) => r.type === 'meta_pass_capped' && r.value.round === 2 && r.value.cap === META_PASS_ROUND_CAPS[1]));
  const closed = all(s).filter((r: any) => r.type === 'review_closed').at(-1);
  assert.equal(closed.value.closed_by, 'mechanical:evolution pass request cap', 'the cap close is mechanical, never an agent judgement');
  assert.equal(closed.value.occasion, 'evolution_review');
  assert.equal(closed.value.outcome, 'review_unresolved', 'an unresolved pass is recorded as such');
  assert.equal(META_PASS_REQUEST_CAP, META_PASS_ROUND_CAPS[0] + META_PASS_ROUND_CAPS[1], 'the occasion total is the sum of the round caps');
  await tick(s);
  assert.equal(s.review, undefined, 'the episode fact does not reopen a pass that the cap just closed');
});

test('META pass: a write inside the pass activates at the next boundary and the task view carries it', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  await s.transaction({ baseRevision: s.revision, components: [{ op: 'define', kind: 'prompt', name: 'house_style', source: 'evidence first' }] });
  await tick(s);
  assert.ok(s.active().some((c: any) => c.kind === 'prompt' && c.name === 'house_style'), 'the pass change is part of the live self');
  s.exit({ reason: 'one prompt added' });
  await tick(s);
  assert.ok(s.review, 'the capability round opens with the induction round\'s change in force');
  assert.ok(s.active().some((c: any) => c.name === 'house_style'));
  s.exit({ result: { reason: 'the added prompt covers the read gap', entry_question_responses: RESPONSES } });
  await tick(s);
  assert.equal(s.mode, 'execute');
  assert.ok(s.active().some((c: any) => c.name === 'house_style'), 'the task step resumes with the pass change in force');
  assert.ok(s.metaAcceptance().changes >= 1, 'the pass change counts as an agent-initiated structural change');
});

test('META pass: non-META arms open no pass at the same boundaries', async () => {
  const off = make(); await tick(off);
  await off.transaction({ baseRevision: 1, orchestration: design });
  off.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  off.fact('action_transition_stalled', { action: 'office.deliver', status: 'stalled' });
  for (let i = 0; i < 12; i++) off.fact('request_record', { request: i, pin: { mode: 'execute' } });
  await tick(off);
  assert.equal(off.review, undefined);
  assert.equal(off.metaPassDue(), null);
});

test('META pass: no pass opens before the T0 design exists, whatever the ledger records', async () => {
  const s = make({ meta: true });
  await tick(s);
  s.fact('task_episode_closed', { episode: 1 });
  await tick(s); await tick(s); await tick(s);
  assert.equal(s.review, undefined, 'the design gate blocks the pass');
  assert.equal(s.metaPassDue(), null, 'metaT0Pending blocks the trigger check itself');
  assert.ok(!all(s).some((r: any) => r.type === 'meta_pass_opened'), 'no pass is recorded as opened');
});

test('META pass: reflect-mode requests do not count toward the stagnation threshold', async () => {
  const s = await designed();
  for (let i = 0; i < 12; i++) s.fact('request_record', { request: i, pin: { mode: 'reflect' } });
  for (let i = 0; i < 11; i++) s.fact('request_record', { request: 12 + i, pin: { mode: 'execute' } });
  await tick(s);
  assert.equal(s.review, undefined, 'twelve reflect-mode plus eleven execute-mode requests stay below the threshold');
  assert.equal(s.metaPassDue(), null);
  s.fact('request_record', { request: 23, pin: { mode: 'execute' } });
  await tick(s);
  assert.ok(s.review, 'the twelfth execute-mode request reaches the threshold');
  const pass = s.reviewSelfView().evolution_pass;
  assert.equal(pass.trigger, 'stagnation');
  assert.equal(pass.execute_requests_without_artifact_write, 12, 'only execute-mode requests are counted');
});

test('META pass: a second pass needs a new trigger row recorded after the previous close', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review, 'the episode row opens the first pass');
  const closed = s.exit({ reason: 'no change: the recorded facts show one delivery path' });
  assert.ok(closed.recorded);
  await tick(s);
  assert.ok(s.review, 'the capability round follows');
  s.exit({ result: { reason: 'no gap', entry_question_responses: RESPONSES } });
  assert.equal(s.mode, 'execute', 'the final round\'s decide_exit resumes the task step');
  // A task request lands after the close: the pass event keys on the request counter (`pass:${request}`),
  // and in a real run a provider request always sits between two boundaries.
  s.pin();
  await tick(s);
  assert.equal(s.review, undefined, 'the old episode row is behind the review_closed anchor: no new pass');
  assert.equal(s.metaPassDue(), null);
  s.fact('action_transition_stalled', { action: 'office.deliver', status: 'stalled', step: 'work' });
  await tick(s);
  assert.ok(s.review, 'a trigger row recorded after the close opens the next pass');
  assert.equal(s.reviewSelfView().evolution_pass.trigger, 'delivery_stall');
  const rows = all(s);
  const closedIdx = rows.findLastIndex((r: any) => r.type === 'review_closed');
  assert.ok(closedIdx >= 0);
  const opened = rows.filter((r: any) => r.type === 'meta_pass_opened').at(-1);
  assert.equal(opened.value.trigger, 'delivery_stall');
  assert.ok(opened.value.window[0] > closedIdx, 'the new pass window starts after the recorded close');
});

test('META pass rounds: the capability round alone closes through the entrance-question responses', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  const r1 = s.reviewExitSchema;
  assert.ok(!r1.required?.includes('entry_question_responses'), 'the induction round closes on the agent\'s own schema');
  assert.ok(r1.properties.carry, 'carry stays available in every round');
  s.exit({ reason: 'facts read' });
  await tick(s);
  const r2 = s.reviewExitSchema;
  assert.ok(r2.required.includes('entry_question_responses'), 'the capability round requires one response per entrance question');
  assert.throws(() => s.exit({ reason: 'missing responses' }), /entry_question_responses/, 'a round-2 exit without responses is invalid');
  const closed = s.exit({ result: { reason: 'no gap', entry_question_responses: RESPONSES } });
  assert.ok(closed.recorded);
  assert.equal(s.review, undefined);
});
