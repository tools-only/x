import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeRow, predictionCounts, spanFacts, withoutBodies } from '../demo/arc_thin_selfview.ts';

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
