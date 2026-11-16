import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeRow, predictionCounts, selfDigest, spanFacts, withoutBodies } from '../demo/arc_thin_selfview.ts';

test('a working-set row keeps its section sizes and drops the message bodies', () => {
  const row = { decision: 3, actions: 12, sections: { prompts: 120, memory: 40 }, text: 'x'.repeat(5000), tail: 'THIS BOARD' };
  const copy = withoutBodies(row);
  assert.deepEqual(copy, { decision: 3, actions: 12, sections: { prompts: 120, memory: 40 } });
  assert.equal(row.text.length, 5000);
});

test('predictions are counted per carrier and scored only where the runtime scored them', () => {
  const rows = [
    { n: 1, prediction: { fields: [{ hit: true }, { hit: false }, { hit: null }] } },
    { n: 2, prediction: { fields: [{ hit: true }] }, skill_prediction: { hits: 1, misses: 2 } },
    { n: 3, predictors: [{ hits: 2, misses: 0 }, { hits: 0, misses: 1 }] },
    { n: 4 },
  ];
  assert.deepEqual(predictionCounts(rows), { made: 5, hits: 5, misses: 4 });
});

test('an outcome row takes only the rows of its own span and names the winning action', () => {
  const rows = [
    { n: 1, action: 'ACTION1', state: 'NOT_FINISHED', levels_completed: 0 },
    { n: 2, action: 'RESET', state: 'NOT_FINISHED', levels_completed: 0 },
    { n: 3, action: 'ACTION6', state: 'NOT_FINISHED', levels_completed: 1, level_changed: true },
    { n: 4, action: 'ACTION1', state: 'NOT_FINISHED', levels_completed: 1 },
  ];
  const row = outcomeRow({
    level: 0, from: 0, to: 3, rows,
    runs: [
      { kind: 'tool', n: 2, path: 'tools/scan.py' },
      { kind: 'tool', n: 4, path: 'tools/scan.py' },
      { kind: 'python', n: 3 },
      { kind: 'save', n: 1, path: 'tools/scan.py' },
    ],
    claims: [{ n: 2, result: true }, { n: 3, result: false }, { n: 4, result: true }],
    refinements: [{ kind: 'edit', at: 2 }, { kind: 'start', at: 3 }],
    changes: [{ at: 3, path: 'prompts/rules.md', version: 2 }, { at: 4, path: 'prompts/rules.md', version: 3 }],
  });
  assert.equal(row.actions, 3);
  assert.equal(row.resets, 1);
  assert.equal(row.game_overs, 0);
  assert.equal(row.won, true);
  assert.equal(row.win_action, 'ACTION6');
  assert.equal(row.win_n, 3);
  assert.deepEqual(row.tools_used, { 'tools/scan.py': 1 });
  assert.equal(row.python_runs, 1);
  assert.deepEqual(row.claims, { checks: 2, held: 1, contradicted: 1 });
  assert.equal(row.refinements, 1);
  assert.deepEqual(row.self_changes, [{ path: 'prompts/rules.md', version: 2 }]);
});

test('a span without a level change reports it as not won and counts game overs', () => {
  const row = outcomeRow({ level: 1, from: 3, to: 6, rows: [
    { n: 4, action: 'ACTION2', state: 'NOT_FINISHED' },
    { n: 5, action: 'ACTION2', state: 'GAME_OVER' },
    { n: 6, action: 'RESET', state: 'NOT_FINISHED' },
  ] });
  assert.equal(row.actions, 3);
  assert.equal(row.won, false);
  assert.equal('win_action' in row, false);
  assert.equal(row.game_overs, 1);
  assert.deepEqual(row.tools_used, {});
  assert.equal(row.refinements, 0);
  assert.deepEqual(row.self_changes, []);
  assert.deepEqual(spanFacts([{ n: 9, action: 'RESET', state: 'NOT_FINISHED' }]).resets, 1);
});

test('the digest is one line of counts and names, with the pointer to the rows it came from', () => {
  const rows = { budget: 4, working: 4, outcomes: 0, settlements: 0 };
  assert.equal(selfDigest({ decision: 5, actions: 12, level: 0, predictions: { made: 3, hits: 2, misses: 1 },
    components: [], changes: 0, outcomes: [], rows }),
    'SELF: decision 5, 12 actions at level 0; predictions 3 (2 hit/1 miss); your components 0; 0 self changes; ' +
    'last outcome none; data/self/: 4 budget, 4 working-set, 0 outcome rows.');
  assert.equal(selfDigest({ decision: 9, actions: 30, level: 1, predictions: { made: 8, hits: 5, misses: 2 },
    components: [{ path: 'prompts/rules.md', version: 2 }, { path: 'tools/scan.py', version: 1 }], changes: 1,
    outcomes: [{ level: 0, won: true, win_n: 14, win_action: 'ACTION6' }], rows: { budget: 9, working: 9, outcomes: 1, settlements: 0 } }),
    'SELF: decision 9, 30 actions at level 1; predictions 8 (5 hit/2 miss); your components 2 (prompts/rules.md v2, ' +
    'tools/scan.py v1); 1 self change; last outcome level 0 won at #14 by ACTION6; data/self/: 9 budget, 9 working-set, 1 outcome row.');
});

test('the digest names at most three components and counts the rest', () => {
  const line = selfDigest({ decision: 2, actions: 2, level: 0, predictions: { made: 0, hits: 0, misses: 0 },
    components: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ path: `tools/${name}.py`, version: 1 })), changes: 0,
    outcomes: [{ level: 0, won: false }], rows: { budget: 2, working: 2, outcomes: 1 } });
  assert.match(line, /your components 5 \(tools\/a\.py v1, tools\/b\.py v1, tools\/c\.py v1, \+2 more\)/);
  assert.match(line, /last outcome level 0 not won/);
});

test('the digest names the last self change and the slot values that differ from the host defaults', () => {
  const line = selfDigest({ decision: 7, actions: 20, level: 1, predictions: { made: 2, hits: 1, misses: 1 },
    components: [{ path: 'slots/self.json', version: 2 }], changes: 2, lastChange: { path: 'slots/self.json', version: 2 },
    slots: [['refine.every', 5], ['review.consult', false]], outcomes: [], rows: { budget: 7, working: 7, outcomes: 0, settlements: 0 } });
  assert.equal(line, 'SELF: decision 7, 20 actions at level 1; predictions 2 (1 hit/1 miss); your components 1 ' +
    '(slots/self.json v2); 2 self changes (last slots/self.json v2); slots set: refine.every=5, review.consult=false; ' +
    'last outcome none; data/self/: 7 budget, 7 working-set, 0 outcome rows.');
});

test('after a level settles, the digest carries the settlement counts and what they were for', () => {
  const line = selfDigest({ decision: 9, actions: 30, level: 2, predictions: { made: 8, hits: 5, misses: 2 },
    components: [{ path: 'slots/self.json', version: 1 }], changes: 1, outcomes: [{ level: 1, won: true, win_n: 26, win_action: 'ACTION1' }],
    lastSettlement: { level: 1, changed: 1, activated: 1, used_later: 0, changes: [{ path: 'slots/self.json', version: 1, used_later: false }] },
    rows: { budget: 9, working: 9, outcomes: 1, settlements: 2 } });
  assert.match(line, /, 2 settlements \(level 1: 1 changed, 1 activated, 0 used later\)\.$/);
});
