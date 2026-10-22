import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionBatchLimit, actionBudgetText, actionBudgetWithBaseline, carriedReviewRoute, executionRouteReady, isVerifiedReplay, knownResetReplay, resetCostText, shouldDeferExplorationPin } from '../demo/arc_thin_action_efficiency.ts';

test('exploration pins yield only when a confirmed mechanism and an executable route both exist', () => {
  assert.equal(executionRouteReady(false, 3), false);
  assert.equal(executionRouteReady(true, 0), false);
  assert.equal(executionRouteReady(true, 3), true);
  const lessons = `Mechanism (confirmed): advance the row by matching the marker.
Carried to Level 2.`;
  const winningActions = [
    { action: 'ACTION6', x: 48, y: 15 },
    { action: 'ACTION6', x: 46, y: 15, level_changed: true },
  ];
  const route = carriedReviewRoute(lessons, winningActions);
  assert.deepEqual(route, ['ACTION6(48,15)', 'ACTION6(46,15)']);
  // VERIFY had confidence=1 and no Route line; the carried review plus actual win is now sufficient.
  assert.equal(executionRouteReady(/Mechanism \(confirmed\)/i.test(lessons), route.length), true);
  assert.equal(shouldDeferExplorationPin(executionRouteReady(true, route.length)), true);
  assert.equal(shouldDeferExplorationPin(executionRouteReady(false, 3)), false);
});

test('only a previously completed exact route earns the long replay batch cap', () => {
  const actions = Array.from({ length: 5 }, (_, i) => ({ action: `ACTION${i + 1}` }));
  assert.equal(actionBatchLimit(false), 4);
  assert.equal(actionBatchLimit(true), 24);
  assert.equal(isVerifiedReplay(actions, actions.map((row, i) => ({ ...row, level_changed: i === 4 }))), true);
  assert.equal(isVerifiedReplay(actions, actions), false);
  assert.equal(isVerifiedReplay(actions, actions.map((row, i) => ({ ...row, level_changed: i === 2 }))), false);
});

test('budget and RESET receipts expose action cost and recognize exact replay despite novelty=new', () => {
  const budget = { used: 15, maximum: 100, level: 1, baseline_actions: [10, 12], total_used: 30, total_maximum: 200 };
  const projectedRowBudget = actionBudgetWithBaseline({ used: 38, maximum: 110 }, { baseline_actions: [22, 42] }, 1, true);
  assert.match(actionBudgetText(projectedRowBudget), /baseline=22 used_vs_baseline=1\.73x/);
  assert.match(actionBudgetText(budget), /actions_used=15 baseline=12 used_vs_baseline=1\.25x level_cap=100 run=30\/200/);
  assert.match(resetCostText(budget, 4), /cumulative_level_cost=15; actions_since_reset=4/);
  const resetReplay = [
    { action: 'ACTION6', x: 48, y: 15, novelty: 'new' },
    { action: 'ACTION6', x: 46, y: 15, novelty: 'new' },
    { action: 'RESET' },
    { action: 'ACTION6', x: 48, y: 15, novelty: 'new' },
    { action: 'ACTION6', x: 46, y: 15, novelty: 'new' },
  ];
  assert.equal(knownResetReplay(resetReplay), true);
  assert.equal(knownResetReplay([{ action: 'RESET' }, { action: 'ACTION1', novelty: 'new' }]), false);
  assert.equal(knownResetReplay([{ action: 'ACTION1' }, { action: 'ACTION2' }, { action: 'RESET' }, { action: 'ACTION1' }, { action: 'ACTION3' }]), false);
});

test('carried route starts after the last failed attempt boundary', () => {
  const lessons = `Mechanism (confirmed): route.
Carried to Level 2.`;
  const route = carriedReviewRoute(lessons, [
    { action: 'ACTION1' }, { action: 'ACTION1', state: 'GAME_OVER' }, { action: 'RESET' },
    { action: 'ACTION2' }, { action: 'ACTION3', level_changed: true },
  ]);
  assert.deepEqual(route, ['ACTION2', 'ACTION3']);
});
