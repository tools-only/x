import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelfRoot } from '../demo/self_root.ts';
import { ARC_SELF_ROOT_OPTIONS, arcRuntimeView, arcSelfRootPaths, loadOrCreateArcContract } from '../demo/self_root_arc.ts';

test('ARC SelfRoot starts with a valid budget, one run view, and a first-action grant', () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-self-root-'));
  try {
    const budget = { requests: 1000, tokens: 120_000, seconds: 600, usd: 10, storage_bytes: 50_000_000 };
    const capabilities = [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools];
    const contract = loadOrCreateArcContract(root, budget, capabilities);
    const view = arcRuntimeView({ state: 'PLAYING', levels_completed: 0, available_actions: ['ACTION1'], frames: [[[1, 2]]] }, [], 0);
    const evo = new SelfRoot(contract, undefined, undefined, undefined, undefined,
      { ...ARC_SELF_ROOT_OPTIONS, taskRuntimeView: () => view });

    evo.pin();
    assert.doesNotThrow(() => evo.assertActionAllowed('arc_action'));
    assert.deepEqual(evo.mirror().task_runtime.observation.grid, [[1, 2]]);
    assert.equal(evo.mirror().task_runtime.history.full, 'read_self(section="ledger")');
    assert.equal(arcSelfRootPaths(root).state, join(root, 'self_root', 'state.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
