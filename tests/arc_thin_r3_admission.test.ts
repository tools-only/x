import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r3Admit, r3Config, r3Observe, r3State } from '../demo/arc_thin_r3.ts';
import type { Grid, StatusMask } from '../demo/arc_thin_effects.ts';

const mask: StatusMask = { rows: new Set(), cols: new Set(), ticker: new Set() };
const grid: Grid = [[0, 0], [0, 1]];

test('G1 counts actions despite board changes and requires a bound executable hypothesis check', () => {
  const state = r3State(); state.level = 1;
  for (let n = 1; n <= 6; n++) r3Observe(state, { n, level: 1, kind: 'moved', newConfig: true, newState: true,
    config: `config-${n}`, stateAfter: `state-${n}`, stateBefore: `state-${n - 1}`, masked: 1 } as any);
  assert.equal(state.since, 6, 'new boards and configurations do not reset the experiment window');
  const cfg = r3Config({ ARC_THIN_R3: 'on', ARC_THIN_R3_PROGRESS: 'on', ARC_THIN_R3_DEGRADE_AFTER: '10' });
  const blocked = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1, predict: { effect: 'move' } as any }, grid, mask, cfg);
  assert.equal(blocked.admit, false); assert.equal(blocked.rows[0].gate, 'G1');
  const ordinaryPrediction = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1, predict: { cells: [[0, 0]] } }, grid, mask, cfg);
  assert.equal(ordinaryPrediction.admit, false);
  const staleHypothesis = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1,
    predict: { hypothesis: 'hyp.touch' }, checkedHypotheses: new Set() }, grid, mask, cfg);
  assert.equal(staleHypothesis.admit, false);
  const admitted = r3Admit(state, { n: 7, level: 1, action: 'ACTION6', x: 1, y: 1,
    predict: { hypothesis: 'hyp.touch' }, checkedHypotheses: new Set(['hyp.touch']) }, grid, mask, cfg);
  assert.equal(admitted.admit, true);
  for (let attempt = 0; attempt < 4; attempt++) {
    const deniedAgain = r3Admit(state, { n: 7 + attempt, level: 1, action: 'ACTION6', x: 1, y: 1 }, grid, mask, cfg);
    assert.equal(deniedAgain.admit, false, 'G1 is a semantic contract, not a refusal threshold that degrades open');
    assert.equal(deniedAgain.rows.some(row => row.gate === 'R0'), false);
  }
});
