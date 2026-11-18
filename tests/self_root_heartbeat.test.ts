import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, hash, type SelfContract } from '../demo/self_root.ts';
import { closeLiveSelfMethods } from '../demo/live_self_wasi.ts';
after(closeLiveSelfMethods);

function contract(): SelfContract {
  const body = { source: 'user_contract' as const, authority: 'Round v1 explicit test fixture; no real requests', decisions: 'FINAL 2.1 G1', readonly_reason: 'user boundaries, resources and facts are not agent methods',
    boundaries: [...FLOOR], capabilities: ['read','ls','grep','python','office.render','office.look','office.deliver','acceptance','submit_unit','agent_tools'],
    writable: ['components.tool','components.prompt','components.memory','components.skill','orchestration','policy'],
    acceptance: { checker: 'fixture' }, inherit_defaults: false as const };
  return { ...body, content_hash: hash(body) };
}
const start = async (s: SelfRoot, kind = 'task') => { await s.boundary(() => {},() => {}); return s.pin(kind); };
const all = (s: SelfRoot) => s.export().root.ledger;
const settle = (s: SelfRoot, usage: any = { input: 10, output: 5, cacheRead: 2, reasoning: 3 }, known = true, unknown = 12000) =>
  s.cost(usage, 20, known ? 0 : 0.25, known, unknown);
test('SelfRoot does not impose request, token, storage, segment, or heartbeat thresholds', async () => {
  const base = contract();
  const legacy = { ...base, budget: { requests: 1, tokens: 1, seconds: 1, usd: 0.01, storage_bytes: 1 },
    segment: { work_requests: 1 }, heartbeat: { enabled: true, every_settled_task_requests: 3 } } as any;
  const { content_hash: _hash, ...body } = legacy;
  const s = new SelfRoot({ ...body, content_hash: hash(body) });
  for (let i = 0; i < 5; i++) { s.pin(); settle(s); }
  await s.boundary(() => {},() => {});
  assert.equal(s.resources().request, 5);
  assert.equal((s.contract as any).budget, undefined);
  assert.equal((s.contract as any).heartbeat, undefined);
  assert.equal((s.contract as any).segment, undefined);
  assert.equal(all(s).some(r => r.type === 'heartbeat_gap' || r.value?.type === 'heartbeat' || r.value?.type === 'work_quantum'), false);
});

test('mirror self view contains the same resource record, with missing usage reserved not zero', async () => {
  const s = new SelfRoot(contract());
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
