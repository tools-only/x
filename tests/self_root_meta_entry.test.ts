import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, hash } from '../demo/self_root.ts';

// User decisions 2026-11-17: the evolution pass opens on a mechanical entry block - run position, trigger, window
// counts, the window's recorded trajectory lines, artifact head, self head, carried notes - every item expandable
// by the ref it names; decide_exit may carry result.carry to the next pass entry; read_self(section="evidence")
// expands one recorded ref through the adapter. Offline checks cover the block's content and bounds, the trajectory
// window filter and budget, the carry roundtrip and its clip fact, the evidence envelopes (present / missing /
// error, never a throw), and that the pass window rows reach reviewView.

const userContract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:60,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}) => new SelfRoot(userContract(), undefined, undefined, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const tick = async (s: any) => s.boundary(()=>{}, ()=>{});
const all = (s: any) => s.export().root.ledger;
const seed = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] };
const taskSide = { task_goal: 'Deliver the artifact this run must produce', task_acceptance: "verified from this run's own acceptance checks and a fresh render",
  loop_policy: { look_when: [{ on: 'segment_boundary', look: 'the last segment numbers and the last change' }] } };
const design = { ...seed, contract: taskSide };
const designed = async (options: any = {}) => { const s = make({ meta: true }, options); await tick(s); await s.transaction({ baseRevision: 1, orchestration: design }); await tick(s); return s; };

test('META pass entry: one mechanical block at entry - position, trigger, window counts, refs - booked once', async () => {
  const s = await designed({ runPosition: () => ({ episode: { active: 1, total: 2 }, artifact_revision: 3 }) });
  s.fact('request_record', { request: 1, pin: { mode: 'execute' }, composition: { images_refs: [{ ref: 'item:4.2', source: 'office.look' }, { ref: 'item:9.0', source: 'office.look' }] } });
  s.fact('request_record', { request: 2, pin: { mode: 'execute' } });
  s.fact('tool_failed', { tool: 'office.render', content: 'renderer exit 1' });
  s.fact('artifact_write', { path: 'deck.py', mode: 'program' });
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review, 'the episode boundary opens the pass');
  const entry = s.review.pass_entry;
  assert.equal(typeof entry, 'string');
  assert.ok(entry.length <= 1500, 'the block is bounded while no trajectory adapter is wired');
  assert.match(entry, /^TASK: Deliver the artifact/, 'the task goal heads the block');
  assert.ok(entry.includes('"artifact_revision":3'), 'the adapter-declared run position rides the first line as a fact');
  assert.match(entry, /TRIGGER: episode_boundary; window ledger:\d+\.\.ledger:\d+ \(expand: read_self\(section="ledger", offset=\d+\)\)/);
  assert.match(entry, /WINDOW: 2 request\(s\)/);
  assert.match(entry, /1 failed call\(s\)/);
  assert.match(entry, /1 artifact write\(s\)/);
  assert.match(entry, /2 image part\(s\) delivered/, 'delivered image parts are counted from the request records');
  assert.match(entry, /read_self\(section="evidence", ref="request:N"\)/, 'the window line names its expansion');
  assert.match(entry, /TRAJECTORY: not provided/, 'no trajectory adapter stays a stated absence');
  assert.match(entry, /ARTIFACT: none rendered/);
  assert.match(entry, /SELF: revision \d+; components: /);
  assert.match(entry, /CARRIED: none recorded/);
  assert.ok(!/rank|recommend|should|priorit/i.test(entry), 'facts only: no ranking, diagnosis or recommendation');
  const booked = all(s).filter((r: any) => r.type === 'meta_pass_entry');
  assert.equal(booked.length, 1, 'the entry is computed once at entry and booked once');
  assert.equal(booked[0].value.text, entry);
  assert.equal(booked[0].value.chars, entry.length);
  assert.equal(s.reviewSelfView().evolution_pass.entry, entry, 'the pass view carries the same block');
  const bare = await designed();
  s2open(bare);
  await tick(bare);
  assert.match(bare.review.pass_entry, /position: not provided/, 'no adapter position stays a stated absence, not an error');
});
const s2open = (s: any) => s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-b' });

test('META pass carry: decide_exit result.carry is stored verbatim, rendered clipped at the next entry, clip booked', async () => {
  const s = await designed();
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review);
  const op = s.exitOperationSchema;
  assert.ok(op.properties.result, 'the pass exposes result on the visible decide_exit operation');
  assert.ok(op.properties.result.properties.carry, 'carry is a declared optional field during the pass');
  assert.ok(!(op.properties.result.required ?? []).includes('carry'), 'carry is never required: a no-carry close stays legal');
  const long = 'retained understanding: ' + 'x'.repeat(230);
  const closed = s.exit({ result: { reason: 'pass 1 done', carry: ['open question: does the renderer cache fonts', long] } });
  assert.ok(closed.recorded, 'the exit with carry closes the pass');
  const closedRow = all(s).filter((r: any) => r.type === 'review_closed').at(-1);
  assert.equal(closedRow.value.result.carry.length, 2);
  assert.equal(closedRow.value.result.carry[1], long, 'storage is verbatim; clipping happens at render only');
  s.pin();
  await tick(s);
  s.fact('action_transition_stalled', { action: 'office.deliver', status: 'stalled', step: 'work' });
  await tick(s);
  assert.ok(s.review, 'the next pass opens on the new trigger row');
  const entry = s.review.pass_entry;
  assert.match(entry, /CARRIED: open question: does the renderer cache fonts \| retained understanding: x+…/);
  assert.ok(!entry.includes('x'.repeat(210)), 'a long note is clipped to 200 chars in the entry');
  assert.equal(all(s).filter((r: any) => r.type === 'carry_truncated').length, 1, 'the clip is recorded once as a fact');
  const route = await designed();
  await route.transaction({ baseRevision: route.revision, policy: { routes: [{ id: 'self_check', event: 'settlement', mode: 'reflect', priority: 1, conclusion_sink: 'ledger' }] } }); await tick(route);
  await route.event('settlement', 'agent-loop', { event_classes: ['task_outcome'], coverage_tags: ['agent-loop'], force_review: true }); await tick(route);
  assert.ok(route.review, 'the agent-declared route still opens');
  assert.equal(route.exitOperationSchema.properties.result, undefined, 'outside a pass the exit operation is unchanged');
});

test('META pass evidence: read_self(section="evidence") resolves through the adapter; missing stays a value', async () => {
  const s = make({ meta: true }, { adapterEvidence: (ref: string, offset: number) => {
    if (ref === 'request:7') return { ref, state: 'recorded', request: 7, payload: 'PAYLOAD'.slice(offset) };
    if (ref === 'boom') throw Error('adapter exploded');
    return undefined;
  } });
  assert.equal(s.evidence().state, 'missing');
  assert.match(s.evidence().usage, /request:N/, 'the empty call teaches the legal form');
  assert.equal(s.evidence('request:7').state, 'recorded');
  assert.equal(s.evidence('request:7', 3).payload, 'LOAD', 'offset pages through the adapter');
  assert.equal(s.evidence('artifact:v9').state, 'missing');
  assert.deepEqual(s.evidence('artifact:v9').known_prefixes, ['request:', 'artifact:v']);
  assert.equal(s.evidence('boom').state, 'error', 'an adapter throw becomes a value, never a crash into the agent');
  assert.match(s.evidence('boom').error, /adapter exploded/);
  assert.throws(() => s.detail('evidence'), /evidence needs ref/, 'detail routes evidence to the ref form');
  const bare = make({ meta: true });
  assert.equal(bare.evidence('request:1').state, 'missing', 'no adapter wired: still a value');
});

test('META pass view: the pass window rows are visible in reviewView (facts.window)', async () => {
  const s = await designed();
  s.fact('request_record', { request: 1, pin: { mode: 'execute' }, usage: { input: 10 } });
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review);
  const view = s.reviewView();
  assert.ok(view.all_facts.length >= 2, 'the pass window facts are visible, not an empty view');
  assert.ok(view.all_facts.some((r: any) => r.type === 'task_episode_closed'), 'the trigger row itself is in the window');
  assert.equal(view.fact_table.request_costs.length, 1, 'the request cost rows ride the same window');
});

test('META pass trajectory: adapter lines ride the entry - window-filtered by request tag, newest kept, bounded', async () => {
  const lines: string[] = [];
  const s = await designed({ adapterTrajectory: () => lines });
  s.fact('request_record', { request: 4, pin: { mode: 'execute' } });
  s.fact('request_record', { request: 5, pin: { mode: 'execute' } });
  lines.push('R3 call office.render {"op":"preview"}');
  lines.push('R4 thinking: the outline covers twelve sections');
  lines.push('R4 call read {"path":"data/material.txt"}');
  lines.push('R4 result read: Source page 1 content');
  lines.push('R5 provider_error: terminated');
  lines.push('untagged adapter note');
  s.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-a' });
  await tick(s);
  assert.ok(s.review, 'the episode boundary opens the pass');
  const entry = s.review.pass_entry;
  assert.match(entry, /TRAJECTORY: 5 recorded event line\(s\)/, 'the section counts the window lines');
  assert.ok(entry.includes('R4 thinking: the outline covers twelve sections'), 'recorded agent language rides the entry verbatim');
  assert.ok(entry.includes('R5 provider_error: terminated'), 'a failed request is visible in the trajectory');
  assert.ok(entry.includes('untagged adapter note'), 'an untagged line is transcribed, not judged');
  assert.ok(!entry.includes('R3 call office.render'), 'lines tagged before the window stay out');
  assert.equal(all(s).filter((r: any) => r.type === 'meta_pass_entry').at(-1).value.text, entry, 'the booked fact carries the same block');
  const burst: string[] = [];
  const b = await designed({ adapterTrajectory: () => burst });
  b.fact('request_record', { request: 1, pin: { mode: 'execute' } });
  for (let i = 0; i < 80; i++) burst.push(`R1 result read: ${'y'.repeat(180)} line ${i}`);
  b.fact('task_episode_closed', { episode: 1, of: 2, id: 'case-b' });
  await tick(b);
  const be = b.review.pass_entry;
  assert.ok(be.length <= 8000, 'the entry keeps its overall bound');
  assert.match(be, /TRAJECTORY: 80 recorded event line\(s\); oldest \d+ omitted \(full text: read_self\(section="evidence", ref="request:N"\)\)/);
  assert.ok(be.includes('line 79'), 'the newest line survives the budget');
  assert.ok(!be.includes(' line 0\n'), 'the oldest line is omitted under the budget');
  assert.match(be, /CARRIED: none recorded/, 'the sections after the trajectory survive');
  const boom = await designed({ adapterTrajectory: () => { throw Error('adapter exploded'); } });
  s2open(boom);
  await tick(boom);
  assert.match(boom.review.pass_entry, /TRAJECTORY: unavailable \(Error: adapter exploded\)/, 'an adapter throw becomes a stated absence, never a crash into the agent');
});
