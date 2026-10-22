import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r3Admit, r3Config, r3State } from '../demo/arc_thin_r3.ts';
import type { Grid, StatusMask } from '../demo/arc_thin_effects.ts';

const mask: StatusMask = { rows: new Set(), cols: new Set(), ticker: new Set() };
const grid: Grid = [[0, 0], [0, 1]];

test('G1 requires a checkable prediction after the progress window; predict.effect alone is ignored', () => {
  const state = r3State(); state.level = 1; state.since = 6;
  const cfg = r3Config({ ARC_THIN_R3: 'on', ARC_THIN_R3_PROGRESS: 'on' });
  const blocked = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1, predict: { effect: 'move' } as any }, grid, mask, cfg);
  assert.equal(blocked.admit, false); assert.equal(blocked.rows[0].gate, 'G1');
  const admitted = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1, predict: { cells: [[0, 0]] } }, grid, mask, cfg);
  assert.equal(admitted.admit, true);
});
