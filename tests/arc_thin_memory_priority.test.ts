import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMemory, renderDecisionMemory } from '../demo/arc_thin_memory.ts';

const memoryWith = () => {
  const memory = emptyMemory();
  memory.strategies.set('strat.route', { plan: 'walk the route to the exit', status: 'active', depends_on: ['hyp.exit'],
    uses: ['memory:fact.walls'], since: 3, spent: 0 });
  memory.strategies.set('strat.old', { plan: 'press everything', status: 'abandoned', depends_on: [], uses: [], since: 0, spent: 3 });
  memory.hypotheses.set('hyp.exit', { claim: 'the exit is top right', status: 'contested', contested_at: 9,
    evidence: [{ action: 9, condition: 'at the corner', observed: 'nothing happened', verdict: 'refutes' }] });
  memory.hypotheses.set('hyp.fuel', { claim: 'rings refill fuel', status: 'supported', check: 'def check(t):\n    return True\n', evidence: [] });
  memory.hypotheses.set('hyp.probe', { claim: 'ACTION2 rotates', question: 'controls', status: 'open', next_test: 'press ACTION2 once', evidence: [] });
  memory.hypotheses.set('hyp.old', { claim: 'ACTION2 moves', question: 'controls', status: 'rejected',
    evidence: [{ action: 2, condition: 'start', observed: 'no move', verdict: 'refutes' }] });
  for (let i = 0; i < 30; i++) memory.facts.set(`fact.f${i}`, { text: `observation number ${i} `.repeat(12), confidence: 2 });
  memory.facts.set('fact.walls', { text: 'walls are color 5', confidence: 3 });
  return memory;
};
const checks = { 'hyp.fuel': 'check on 288 recorded move(s): holds 18 · fails 259 (#20, #21, …, #288) · n/a 11' };
const keys = (memory: ReturnType<typeof emptyMemory>) => [...memory.facts.keys(), ...memory.hypotheses.keys(), ...memory.strategies.keys()];
/** The key is rendered ("- key [") or listed as not shown ("key, " / "key (full text"). */
const named = (view: string, key: string) =>
  new RegExp(`(^- |\\n- |not shown: |, )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\[|, | \\(full text)`).test(view);

test('memory shows first what the record disputes, then open experiments, the strategy and its facts', () => {
  const view = renderDecisionMemory(memoryWith(), 40, checks);
  const at = (key: string) => view.indexOf(`- ${key} [`);
  for (const key of ['hyp.exit', 'hyp.fuel', 'hyp.probe', 'strat.route', 'hyp.old', 'fact.walls']) assert.ok(at(key) >= 0, key);
  assert.ok(Math.max(at('hyp.exit'), at('hyp.fuel')) < at('hyp.probe'), 'a failing check and a contested premise come before open experiments');
  assert.ok(at('hyp.probe') < at('strat.route') && at('strat.route') < at('hyp.old') && at('hyp.old') < at('fact.walls'));
  assert.ok(at('fact.walls') < at('fact.f29'), 'facts the strategy uses come first');
  assert.match(view, /- hyp\.fuel \[supported\][^\n]*\n[^]*fails 259/, 'its status is not changed; the check line says what failed');
  assert.match(view, /#2 refutes under "start": no move/, 'a refuted rival keeps its refutation');
  assert.ok(view.length <= 4000);
});

test('what does not fit is named by key, within the budget', () => {
  const memory = memoryWith();
  for (const maxChars of [4000, 1500, 600]) {
    const view = renderDecisionMemory(memory, 40, checks, maxChars);
    assert.ok(view.length <= maxChars, `${view.length} > ${maxChars}`);
    for (const key of keys(memory)) assert.ok(named(view, key), `${key} missing at ${maxChars}`);
    if (maxChars < 4000) assert.match(view, /\nnot shown: [^\n]* \(full text: data\/memory\.md\)$/);
  }
});

test('an empty memory, or one without hypotheses or an active strategy, says so', () => {
  assert.equal(renderDecisionMemory(emptyMemory(), 0), 'MEMORY: empty. HYPOTHESES: none · STRATEGY: none active');
  const facts = emptyMemory();
  facts.facts.set('fact.a', { text: 'A', confidence: 1 });
  assert.equal(renderDecisionMemory(facts, 0),
    'CURRENT KNOWLEDGE (parent-authored judgments; full evidence: data/memory.md):\nHYPOTHESES: none · STRATEGY: none active\n- fact.a [confidence 1] A');
});

test('the legacy order is the view before 2026-10-15: strategy first, a count of what was left out', () => {
  const memory = memoryWith();
  const legacy = renderDecisionMemory(memory, 40, checks, 4000, 'legacy');
  assert.ok(legacy.indexOf('- strat.route [active]') < legacy.indexOf('- hyp.exit ['));
  assert.match(renderDecisionMemory(memory, 40, checks, 1500, 'legacy'), /\d+ entries omitted by presentation budget; exact details: data\/memory\.md\.$/);
});
