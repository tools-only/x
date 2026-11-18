import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, META_STRATEGY, META_PASS_STRATEGY, META_PASS_ROUND1_LINE, META_PASS_ROUND2_LINE, ENTRANCE_QUESTIONS, hash } from '../demo/self_root.ts';

// User decision 2026-11-17: the seeded evolution_policy prompt is gone. Evolution judgment runs in one
// host-opened evolution pass at a recorded run boundary, outside the task turn; the pass writes through the
// ordinary reflection interface and the runtime assembles nothing further. Same date, second decision: induction
// and capability inference never share a round - the pass runs as two rounds, round 1 closing with the
// agent's own reading and round 2 opening at the next request boundary with that closure at its entry and the
// entrance questions as its frame. Offline checks cover: the trigger set (episode closed, delivery stalled,
// task-event triggers, the per-round prompts and facts, closure by decide_exit, and the absence of request caps.

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

test('META pass: delivery stalls open a pass; request counts alone do not', async () => {
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
  for (let i = 0; i < 40; i++) t.fact('request_record', { request: i, pin: { mode: 'execute' } });
  await tick(t);
  assert.equal(t.review, undefined, 'request count alone does not open a pass');
  assert.equal(t.metaPassDue(), null);
});

test('META pass: request counts do not mechanically close either round', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review);
  for (let i = 0; i < 10; i++) s.pin();
  await tick(s);
  assert.ok(s.review, 'round 1 remains open until the agent closes it');
  assert.ok(s.reviewStrategy().includes(META_PASS_ROUND1_LINE));
  assert.ok(!all(s).some((r: any) => r.type === 'meta_pass_capped'));
  s.exit({ reason: 'the recorded evidence supports continuing to the capability round' });
  await tick(s);
  assert.ok(s.review);
  assert.ok(s.reviewStrategy().includes(META_PASS_ROUND2_LINE));
  for (let i = 0; i < 40; i++) s.pin();
  await tick(s);
  assert.ok(s.review, 'round 2 remains open until a change or explicit no_change');
  assert.ok(!all(s).some((r: any) => r.type === 'meta_pass_capped'));
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

test('META pass: neither execute nor reflect request counts trigger a pass', async () => {
  const s = await designed();
  for (let i = 0; i < 30; i++) s.fact('request_record', { request: i, pin: { mode: 'reflect' } });
  for (let i = 0; i < 30; i++) s.fact('request_record', { request: 30 + i, pin: { mode: 'execute' } });
  await tick(s);
  assert.equal(s.review, undefined, 'request counts alone do not open a pass');
  assert.equal(s.metaPassDue(), null);
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
