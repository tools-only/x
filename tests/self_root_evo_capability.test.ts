import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfRoot, FLOOR, hash, normalizeOperation } from '../demo/self_root.ts';
import { observe, renderObservation, observationHeads } from '../demo/self_observation.ts';

// One positive and one flag-off case per capability-view item: A4 inventory/recurrence (true counts,
// bindings, review-entrance-only placement), ASK entrance questions (one block, closure through the
// exit schema), and L4 layer declarations (record+echo, [layers] regrouping, closure backflow).

const contract = () => { const b:any={source:'user_contract',authority:'fixture',decisions:'fixture',readonly_reason:'fixture',boundaries:[...FLOOR],capabilities:['read','ls','grep','office.render','office.preview','acceptance'],writable:['components.tool','components.prompt','components.skill','components.memory','orchestration','policy'],budget:{requests:30,tokens:100000,seconds:600,usd:1,storage_bytes:10000000},acceptance:{checker:'fixture'},inherit_defaults:false,heartbeat:false}; return {...b,content_hash:hash(b)}; };
const make = (mechanisms?: any, options: any = {}) => new SelfRoot(contract(), undefined, undefined, undefined, undefined, { ...options, ...(mechanisms ? { mechanisms } : {}) } as any) as any;
const open = async (s: any, boundary = 'submitted') => { await s.event('settlement',boundary,{event_classes:['task_outcome'],coverage_tags:[boundary],force_review:true}); await s.boundary(()=>{},()=>{}); };
const tick = async (s: any) => s.boundary(()=>{},()=>{});
const all = (s: any) => s.export().root.ledger;

test('observation: recorded reasoning blocks are counted and a restated head becomes a [thought] repetition line', () => {
  const rows = [
    { ref: 'L1', type: 'assistant_reasoning', value: { blocks: [{ type: 'thinking', thinking: 'I should re-run step 3 before the check.' }] } },
    { ref: 'L2', type: 'assistant_reasoning', value: { blocks: [{ type: 'thinking', thinking: 'I should re-run step 7 before the check.' },
      { type: 'thinking', thinking: 'A different consideration about the remaining budget.' }] } },
  ];
  const o = observe({ ledger: rows as any });
  assert.equal(o.a2.thoughts.blocks, 3, 'every recorded block is counted');
  assert.equal(o.a2.thoughts.repeated.length, 1, 'digit-normalized heads group the restated instruction');
  assert.equal(o.a2.thoughts.repeated[0].count, 2);
  assert.equal(o.a2.thoughts.repeated[0].last, 'L2');
  const text = renderObservation(o, 2800);
  assert.ok(text.includes('[thought] x2'), 'the repetition is a visible line');
  assert.ok(text.includes('reasoning blocks 3'), 'the block count rides the trace line');
});

test('A4: observation carries true counts and recorded bindings; digest stays free; flag off removes the block', async () => {
  const s = make({ a4: true }); await tick(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'p1', source: 'hello' }] }); await tick(s);
  const o = s.detail('observation');
  assert.ok(o.a4, 'a4 block present');
  const kinds = Object.fromEntries(o.a4.inventory.kinds.map((k: any) => [k.kind, k]));
  assert.equal(kinds.prompt.count, 1);
  assert.equal(kinds.prompt.rent_chars, 'hello'.length);
  assert.match(String(kinds.prompt.binding), /context head/);
  assert.equal(kinds.subagent.count, 0);
  assert.equal(kinds.tool.rent_chars, 0);
  assert.equal(o.a4.inventory.residency_chars, 'hello'.length);
  const text = s.observationText(2400);
  assert.ok(text.includes('[inventory]') && text.includes('[recurrence]'));
  assert.ok(text.includes('subagent 0'));
  assert.ok(!s.observationDigest().includes('[inventory]'), 'digest stays A4-free');
  const off = make(); await tick(off);
  assert.equal(off.detail('observation').a4, undefined);
  assert.ok(!off.observationText(2400).includes('[inventory]'));
});

test('A4: review entrance shows the block; self view drops padded counts and marks candidates', async () => {
  const s = make({ a4: true }); await open(s);
  const frame = all(s).findLast((r: any) => r.type === 'review_frame')?.value;
  assert.ok(String(frame.observation).includes('[inventory]'));
  const rv = s.reviewSelfView();
  assert.equal(rv.categories.prompt, 0);
  assert.equal(rv.categories.tool, 0);
  const candidate = rv.entries.find((e: any) => e.name === 'prompt_candidate');
  assert.equal(candidate.candidate, true);
  assert.equal(s.selfCategories().prompt, 0);
  const off = make(); await open(off);
  const offRv = off.reviewSelfView();
  assert.equal(offRv.categories.prompt, 1);
  assert.equal(offRv.entries.find((e: any) => e.name === 'prompt_candidate').candidate, undefined);
  assert.equal(off.selfCategories().prompt, 1);
});

test('ASK: one entrance block on the review strategy and a closure field on the exit schema; flag off reverts both', async () => {
  const s = make({ ask: true }); await open(s);
  const rv = s.reviewSelfView();
  assert.ok(rv.strategy.includes('SELF-EVOLUTION ENTRANCE QUESTIONS'));
  assert.ok(rv.strategy.includes('entry_question_responses'));
  assert.ok(!s.reviewStrategy().includes('ENTRANCE QUESTIONS'), 'resident strategy stays bare');
  assert.ok(s.exitOperationSchema.properties.result.properties.entry_question_responses, 'exit schema extended');
  const off = make(); await open(off);
  assert.ok(!off.reviewSelfView().strategy.includes('ENTRANCE QUESTIONS'));
  assert.equal(off.exitOperationSchema.properties.result, undefined);
  const plain = off.exit({ reason: 'plain closure' });
  assert.equal(all(off).findLast((r: any) => r.type === 'review_closed')?.value.closed_by, 'agent');
  assert.equal(plain.outcome, 'closed');
});

test('ASK closure protocol: missing responses ride the invalid-exit path; three strings close as the agent', async () => {
  const s = make({ ask: true }); await open(s);
  assert.throws(() => s.exit({ reason: 'x' }), /entry_question_responses/);
  assert.ok(all(s).some((r: any) => r.type === 'exit_normalization'));
  const second = s.exit({ reason: 'x' });
  assert.match(String(all(s).findLast((r: any) => r.type === 'review_closed')?.value.closed_by), /^mechanical:/);
  assert.ok(second);
  await open(s, 'reopened');
  assert.throws(() => s.exit({ result: { reason: 'r', entry_question_responses: ['only one'] } }), /three strings/);
  const done = s.exit({ result: { reason: 'ok', entry_question_responses: ['a', 'b', 'none'] } });
  const closed = all(s).findLast((r: any) => r.type === 'review_closed')?.value;
  assert.equal(closed.closed_by, 'agent');
  assert.deepEqual(closed.result.entry_question_responses, ['a', 'b', 'none']);
  assert.ok(done);
});

test('L4: a declared layer is recorded and echoed, never inferred; bad values reject; flag off rejects the field at the surface', async () => {
  assert.ok(normalizeOperation('component', { op: 'define', kind: 'prompt', name: 'x', source: 's', evolution_layer: 'prompt' }, undefined, { layer: true }));
  assert.throws(() => normalizeOperation('component', { op: 'define', kind: 'prompt', name: 'x', source: 's', evolution_layer: 'prompt' }), /unknown field/);
  assert.throws(() => normalizeOperation('component', { op: 'define', kind: 'prompt', name: 'x', source: 's', evolution_layer: 'vibes' }, undefined, { layer: true }), /one of/);
  const s = make({ l4: true }); await tick(s);
  await s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'lp', source: 'text', evolution_layer: 'prompt' }] });
  const prepared = all(s).findLast((r: any) => r.type === 'reflection_activated')?.value;
  assert.equal(prepared.declared_layers['components.prompt.lp'], 'prompt');
  await tick(s);
  const activated = all(s).findLast((r: any) => r.type === 'reflection_activated' && r.value.parent !== undefined)?.value;
  assert.equal(activated.declared_layers['components.prompt.lp'], 'prompt');
  await assert.rejects(() => s.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'bad', source: 't', evolution_layer: 'vibes' }] }), /one of/);
  await tick(s);
  await s.transaction({ policy: { request: { maxOutputTokens: 2048 } }, evolution_layer: 'loop' }); await tick(s);
  const policyFact = all(s).findLast((r: any) => r.type === 'reflection_activated' && r.value.parent !== undefined)?.value;
  assert.ok(Object.values(policyFact.declared_layers ?? {}).includes('loop'));
  await open(s);
  const rv = s.reviewSelfView();
  assert.equal(rv.entries.find((e: any) => e.name === 'lp').evolution_layer, 'prompt');
  assert.equal(rv.entries.find((e: any) => e.name === 'orchestration').evolution_layer, 'undeclared');
  assert.ok(rv.layers.prompt.prompts.includes('lp'));
  assert.equal(rv.layers.declared_layers['components.prompt.lp'], 'prompt');
  assert.ok(rv.layers.loop.reviews.opened >= 1);
  assert.equal(rv.layers.harness.subagents, 0);
  const off = make(); await tick(off);
  await off.transaction({ components: [{ op: 'define', kind: 'prompt', name: 'lp', source: 'text', evolution_layer: 'prompt' }] }); await tick(off);
  assert.equal(all(off).findLast((r: any) => r.type === 'reflection_activated' && r.value.parent !== undefined)?.value.declared_layers, undefined);
  await open(off);
  const offRv = off.reviewSelfView();
  assert.equal(offRv.entries.find((e: any) => e.name === 'lp').evolution_layer, undefined);
  assert.equal(offRv.layers, undefined);
});

test('L4 closure backflow: the next entrance shows the last closures with their responses; flag off shows none', async () => {
  const s = make({ ask: true, l4: true }); await open(s);
  s.exit({ result: { reason: 'first pass', entry_question_responses: ['gap seen', 'no candidate', 'none'] } });
  await open(s, 'next-entrance');
  const frame = all(s).findLast((r: any) => r.type === 'review_frame')?.value;
  assert.ok(Array.isArray(frame.recent_closures) && frame.recent_closures.length >= 1);
  const last = frame.recent_closures.at(-1);
  assert.equal(last.closed_by, 'agent');
  assert.deepEqual(last.responses, ['gap seen', 'no candidate', 'none']);
  assert.ok(rvHasAsk(s));
  const off = make(); await open(off);
  off.exit({ reason: 'done' });
  await open(off, 'next-entrance');
  assert.equal(all(off).findLast((r: any) => r.type === 'review_frame')?.value.recent_closures, undefined);
});

// With both flags on, the entrance strategy carries the one-line four-layer coordinates extension.
const rvHasAsk = (s: any) => { const t = s.reviewSelfView().strategy; return t.includes('Four layers') && t.includes('ENTRANCE QUESTIONS'); };

test('A3: recorded false boolean leaves render as a grouped tally line the compact echo cut off', () => {
  const item = (ok: boolean) => ({
    probes: [{ text: 'alpha', found: true }, { text: 'beta', found: true }],
    aux: { text: 'gamma', found: false },
    summary: { accepted: ok, count: 2 },
  });
  const value = {
    source: 'fixture_source',
    meta: { version: 'long-metadata-version-string-v9', digest: 'd'.repeat(64) },
    digests: Object.fromEntries(['a', 'b', 'c', 'e', 'f', 'g'].map(k => [`file-${k}`, k.repeat(64)])),
    items: [item(true), item(true), item(true), item(true), item(false), item(false)],
  };
  const o = observe({ ledger: [{ ref: 'L7', type: 'task_outcome', value }] as any });
  const e = o.a3.entries[0];
  assert.ok(!e.outcome.includes('accepted'), 'capped echo never reaches the verdict fields');
  assert.equal(e.booleans.total, 24);
  assert.equal(e.booleans.false_count, 8);
  assert.deepEqual(e.booleans.false_paths.find(g => g.path === 'items[#].summary.accepted'),
    { path: 'items[#].summary.accepted', count: 2, at: [4, 5] });
  const text = renderObservation(o, 2800);
  assert.ok(text.includes('false 8/24:'), 'tally line rides the outcome');
  assert.ok(text.includes('items[#].aux.found x6 at [0,1,2]'));
  assert.ok(text.includes('items[#].summary.accepted x2 at [4,5]'));
  assert.ok(observationHeads(o).includes('(8 false)'), 'the one-line digest carries the count');
  const clean = observe({ ledger: [{ ref: 'L8', type: 'task_outcome', value: { done: true, steps: [{ ok: true }] } }] as any });
  assert.equal(clean.a3.entries[0].booleans.false_count, 0);
  assert.ok(!renderObservation(clean, 2800).includes('  false '), 'all-true outcome adds no tally line');
  assert.ok(!observationHeads(clean).includes('false'));
});
