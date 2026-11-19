import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelfRoot } from '../demo/self_root.ts';
import { ARC_SELF_ROOT_OPTIONS, arcRuntimeView, arcSelfRootPaths, loadOrCreateArcContract } from '../demo/self_root_arc.ts';

test('ARC SelfRoot starts without a SelfRoot quota, with one run view and a first-action grant', () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-self-root-'));
  try {
    const capabilities = [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools];
    const contract = loadOrCreateArcContract(root, capabilities);
    const view = arcRuntimeView({ state: 'PLAYING', levels_completed: 0, available_actions: ['ACTION1'], frames: [[[1, 2]]] }, [], 0);
    const evo = new SelfRoot(contract, undefined, undefined, undefined, undefined,
      { ...ARC_SELF_ROOT_OPTIONS, taskRuntimeView: () => view });

    evo.pin();
    assert.doesNotThrow(() => evo.assertActionAllowed('arc_action'));
    assert.equal((contract as any).budget, undefined);
    assert.equal((evo.contract as any).budget, undefined);
    assert.deepEqual(evo.mirror().task_runtime.observation.grid, [[1, 2]]);
    assert.equal(evo.mirror().task_runtime.history.full, 'read_self(section="ledger")');
    assert.equal(arcSelfRootPaths(root).state, join(root, 'self_root', 'state.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ARC counts played actions across requests and reloads, and starts a fresh interval after a pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-pass-'));
  try {
    const contract = loadOrCreateArcContract(root, [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools]);
    const open = (saved?: any) => new SelfRoot(contract, saved, undefined, undefined, undefined, ARC_SELF_ROOT_OPTIONS);
    let evo = open();
    const play = async (n: number) => {
      evo.fact(n % 2 ? 'arc_action' : 'python.env_act', { n });
      await evo.queueActionIntervalReview(30, n);
    };
    for (let n = 1; n <= 29; n++) await play(n);
    evo.fact('reflection_activated', { addresses: ['components.prompt.note'] });
    evo = open(evo.export());
    assert.equal(evo.actionIntervalReviewState, undefined);
    await play(30);
    await evo.queueActionIntervalReview(30, 30);
    assert.equal(evo.export().root.queue.length, 1);
    assert.equal(evo.actionIntervalReviewState, 'queued');
    await evo.boundary(() => {}, () => {});
    assert.equal(evo.actionIntervalReviewState, 'active');
    evo.exit({ reason: 'no change needed' });
    for (let n = 31; n <= 49; n++) await play(n);
    evo.fact('arc_action', { n: 50 });
    const outcome = evo.outcome({ actions: 50, levels_completed: 1, metrics: [] });
    await evo.event('unit_completed', 'level-at-50', { event_classes: ['task_outcome'], evidenceRefs: [outcome.ref] });
    await evo.queueActionIntervalReview(30, 50);
    await evo.boundary(() => {}, () => {});
    assert.equal(evo.inEvolutionReview, true);
    evo.exit({ reason: 'level reviewed' });
    for (let n = 51; n <= 79; n++) await play(n);
    assert.equal(evo.actionIntervalReviewState, undefined);
    await play(80);
    assert.equal(evo.actionIntervalReviewState, 'queued');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ARC task cadence opens after fifty played actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-cadence-'));
  try {
    const contract = loadOrCreateArcContract(root, [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools]);
    const evo = new SelfRoot(contract, undefined, undefined, undefined, undefined, ARC_SELF_ROOT_OPTIONS);
    const interval = ARC_SELF_ROOT_OPTIONS.metaFallback.interval;
    for (let action = 1; action < interval; action++) {
      evo.fact('arc_action', { n: action });
      await evo.queueActionIntervalReview(interval, action);
    }
    assert.equal(evo.actionIntervalReviewState, undefined);
    evo.fact('arc_action', { n: interval });
    await evo.queueActionIntervalReview(interval, interval);
    assert.equal(evo.actionIntervalReviewState, 'queued');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ARC optional Meta starts after exploration and routes one focus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-meta-'));
  try {
    const contract = loadOrCreateArcContract(root, [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools]);
    const evo = new SelfRoot(contract, undefined, undefined, undefined, undefined, {
      ...ARC_SELF_ROOT_OPTIONS, mechanisms: { meta: true }, metaAtStart: false,
    });
    assert.equal(evo.metaT0Pending, false);
    for (let action = 1; action < ARC_SELF_ROOT_OPTIONS.metaFallback.interval; action++) evo.fact('arc_action', { n: action });
    assert.equal(evo.metaPassDue(), null);
    evo.fact('arc_action', { n: ARC_SELF_ROOT_OPTIONS.metaFallback.interval });
    await evo.boundary(() => {}, () => {});
    assert.equal(evo.reviewSelfView().evolution_pass.trigger, 'action_cadence_fallback');
    assert.equal(evo.reviewExitSchema?.properties.next_specialist.enum.includes('loop'), true);
    evo.exit({ result: { reason: 'exploration can continue', next_specialist: 'none' } });
    await evo.boundary(() => {}, () => {});
    assert.equal(evo.hasReview, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
