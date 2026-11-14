import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, hash, isValidHeartbeat, type SelfContract } from '../demo/self_root.ts';
import { closeLiveSelfMethods } from '../demo/live_self_wasi.ts';
after(closeLiveSelfMethods);

function contract(overrides: Partial<{ heartbeat: SelfContract['heartbeat']; budget: SelfContract['budget'] }> = {}): SelfContract {
  const body = { source: 'user_contract' as const, authority: 'Round v1 explicit test fixture; no real requests', decisions: 'FINAL 2.1 G1', readonly_reason: 'user boundaries, resources and facts are not agent methods',
    boundaries: [...FLOOR], capabilities: ['read','ls','grep','python','office.render','office.look','office.deliver','acceptance','submit_unit','agent_tools'],
    writable: ['components.tool','components.prompt','components.memory','components.skill','orchestration','policy'],
    budget: overrides.budget ?? { requests: 30, tokens: 100000, seconds: 600, usd: 1, storage_bytes: 10000000 },
    acceptance: { checker: 'fixture' }, inherit_defaults: false as const,
    heartbeat: overrides.heartbeat ?? { enabled: true as const, every_settled_task_requests: 3 as const } };
  return { ...body, content_hash: hash(body) };
}
const start = async (s: SelfRoot, kind = 'task') => { await s.boundary(() => {},() => {}); return s.pin(kind); };
const all = (s: SelfRoot) => s.export().root.ledger;
const settle = (s: SelfRoot, usage: any = { input: 10, output: 5, cacheRead: 2, reasoning: 3 }, known = true, unknown = 12000) =>
  s.cost(usage, 20, known ? 0 : 0.25, known, unknown);
const heartbeats = (s: SelfRoot) => all(s).filter(r => r.type === 'event' && r.value?.type === 'heartbeat');

test('validateContract keeps heartbeat false and accepts the enabled object only', () => {
  assert.equal(isValidHeartbeat(false), true);
  assert.equal(isValidHeartbeat({ enabled: true, every_settled_task_requests: 3 }), true);
  for (const heartbeat of [true, { enabled: false, every_settled_task_requests: 3 }, { enabled: true }, { enabled: true, every_settled_task_requests: 2 }, { enabled: true, every_settled_task_requests: 3, extra: 1 }, null, 'false']) {
    const body = { ...contract(), heartbeat } as any;
    const { content_hash, ...rest } = body;
    const c = { ...rest, heartbeat, content_hash: hash({ ...rest, heartbeat }) };
    assert.throws(() => new SelfRoot(c), /heartbeat/);
  }
  assert.equal(new SelfRoot(contract({ heartbeat: false })).contract.heartbeat, false);
});

test('heartbeat fires after settled task requests 3 and 6, not 1 2 4, excludes preflight, and does not double-fire', async () => {
  const s = new SelfRoot(contract());
  await start(s, 'preflight'); settle(s);
  await start(s, 'inference'); settle(s);
  await start(s, 'preflight'); settle(s);
  assert.equal(s.settledTaskRequests(), 0);
  await s.boundary(() => {},() => {});
  assert.equal(heartbeats(s).length, 0);

  await start(s); settle(s);
  await start(s); settle(s);
  await s.boundary(() => {},() => {});
  assert.equal(heartbeats(s).length, 0);
  await start(s); settle(s);
  assert.equal(s.settledTaskRequests(), 3);
  await s.boundary(() => {},() => {});
  assert.equal(heartbeats(s).length, 1);
  assert.equal(heartbeats(s)[0].value.boundary, 'heartbeat:settled:3');
  assert.equal(s.mode, 'reflect');
  assert.deepEqual(s.mirror().dynamic.review.triggers.map((t: any) => t.source), ['user_contract']);
  await s.event('heartbeat', 'heartbeat:settled:3');
  assert.equal(heartbeats(s).length, 1);

  await start(s); settle(s); // request after the queued review is entered on this boundary
  assert.equal(heartbeats(s).length, 1);
  await start(s); settle(s);
  await start(s); settle(s);
  assert.equal(s.settledTaskRequests(), 6);
  await s.boundary(() => {},() => {});
  assert.equal(heartbeats(s).map(r => r.value.boundary).join(','), 'heartbeat:settled:3,heartbeat:settled:6');
});

test('a due heartbeat is queued when a review is open and does not interrupt it', async () => {
  const s = new SelfRoot(contract());
  await s.event('settlement', 'session', { event_classes: ['task_outcome'], coverage_tags: ['heartbeat'], force_review: true });
  await start(s);
  assert.equal(s.mode, 'reflect');
  const reviewId = s.mirror().dynamic.review.id;
  settle(s);
  await start(s); settle(s);
  await start(s); settle(s);
  assert.equal(s.settledTaskRequests(), 3);
  assert.equal(s.mode, 'reflect');
  await s.boundary(() => {},() => {});
  assert.equal(s.mode, 'reflect');
  assert.equal(s.mirror().dynamic.review.id, reviewId);
  assert.ok(s.export().root.queue.some((t: any) => t.triggers.some((x: any) => x.source === 'user_contract' && String(x.id).includes('heartbeat'))));
  assert.equal(heartbeats(s).length, 1);
  await s.transaction({baseRevision:s.revision, policy:{...s.policy, context:{...s.policy.context, instruction:'continue'}}});
  await s.boundary(()=>{},()=>{});
  await s.boundary(() => {},() => {});
  assert.equal(s.mode, 'reflect');
  assert.equal(s.mirror().dynamic.review.id, reviewId);
  assert.ok(s.mirror().dynamic.review.triggers.length > 0);
});

test('at the request cap a due heartbeat records a visible gap and does not dispatch an extra request', async () => {
  const s = new SelfRoot(contract({ budget: { requests: 3, tokens: 100000, seconds: 600, usd: 1, storage_bytes: 10000000 } }));
  await start(s); settle(s);
  await start(s); settle(s);
  await start(s); settle(s);
  assert.equal(s.resources().request, 3);
  await s.boundary(() => {},() => {});
  const gaps = all(s).filter(r => r.type === 'heartbeat_gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].value.settled_task_requests, 3);
  assert.equal(s.resources().request, 3);
  assert.equal(heartbeats(s).length, 0);
  assert.equal(s.mode, 'execute');
  assert.throws(() => s.pin(), /exhausted/);
  assert.equal(s.resources().request, 3);
  assert.equal(s.resources().record.heartbeat_gaps[0].settled_task_requests, 3);
});

test('mirror self view contains the same resource record, with missing usage reserved not zero', async () => {
  const s = new SelfRoot(contract({ heartbeat: false }));
  await start(s);
  settle(s, { input: 80, output: 40, cacheRead: 10, reasoning: 12 }, true);
  await start(s);
  s.cost(null, 5, 0.025, false, 900);
  const record = s.resources().record;
  assert.equal(record.requests.dispatched, 2);
  assert.equal(record.requests.settled, 2);
  assert.equal(record.requests.pending_settlement, 0);
  assert.equal(record.requests.usage_unknown, 1);
  assert.equal(record.tokens.input, 80);
  assert.equal(record.tokens.output, 40);
  assert.equal(record.tokens.cache_read, 10);
  assert.equal(record.tokens.reasoning, 12);
  assert.equal(record.tokens.reasoning_included_in_output, true);
  assert.equal(record.tokens.unknown_reserved, 900);
  assert.notEqual(record.tokens.unknown_reserved, 0);
  assert.match(record.usd.conservative.label, /estimate, never the invoice/);
  assert.match(record.usd.registered.billing, /estimate, never the invoice/);
  const expectedConservative = ((80 + 10) * 20 + 40 * 80) / 1e6 + 0.025;
  const expectedRegistered = ((80 + 10) * 5 + 40 * 30) / 1e6 + 0.025 * (35 / 100);
  assert.ok(Math.abs(record.usd.conservative.estimate - expectedConservative) < 1e-12);
  assert.ok(Math.abs(record.usd.registered.estimate - expectedRegistered) < 1e-12);
  const stable = (r: any) => { const { time, ...rest } = r; return rest; };
  assert.deepEqual(stable(s.mirror().dynamic.resources.record), stable(record));
  assert.equal(s.mirror().dynamic.resources.record.time.started_at, record.time.started_at);
  s.adoptDaemonResources({ ...record, via: 'daemon' });
  assert.equal(s.mirror().dynamic.resources.record.via, 'daemon');
  assert.deepEqual(s.mirror().dynamic.resources.record, s.resources().record);
});