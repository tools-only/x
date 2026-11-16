/**
 * Stage 4 of docs/plans/2026-11-16-arc-selfloop-migration.md: the level-boundary settlement. The brief fixes what
 * `used later` means before any run: a later predict cites the change (the path, the file's name or a slot key it set),
 * the change is promoted to a line of rules.md (a rules.md bound after it), or, for a tool saved as a view, guard or
 * hook, the component ran after the save. Every signal below is a recorded row or run; nothing is judged here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settlementRow, settlementText } from '../demo/arc_thin_selfview.ts';

test('a slot change that stays bound and is cited by a later predict counts as activated and used later', () => {
  const row = settlementRow({
    level: 0, to: 3,
    changes: [{ at: 1, path: 'slots/self.json', version: 1, parameters: { slots: { 'refine.every': 2, 'stall.after': 60 } } }],
    versions: { 'slots/self.json': 1 },
    slots: { 'refine.every': 2, 'stall.after': 60 },
    trajectory: [
      { n: 1, idea: 'try the slot' },
      { n: 2, expect: 'with refine.every at 2 the refinement is due' },
      { n: 3, note: 'unrelated' },
    ],
    runs: [],
  });
  assert.equal(row.changed, 1);
  assert.equal(row.activated, 1);
  assert.equal(row.used_later, 1);
  assert.deepEqual(row.changes, [{ path: 'slots/self.json', version: 1, activated: true, used_later: true, signals: ['cited'] }]);
  assert.equal(settlementText(row), '1 changed, 1 activated, 1 used later: slots/self.json v1');
});

test('a change nothing later cites, promotes or runs is counted and left unused', () => {
  const row = settlementRow({
    level: 0, to: 3,
    changes: [
      { at: 1, path: 'tools/scan.py', version: 1 },
      { at: 2, path: 'prompts/rules.md', version: 1 },
    ],
    versions: { 'tools/scan.py': 1, 'prompts/rules.md': 1 },
    trajectory: [
      { n: 1, idea: 'scan the board first' },
      { n: 3, expect: 'the next step follows from the board' },
    ],
    // The one run of the tool came before the save, so it answers nothing.
    runs: [{ kind: 'tool', path: 'tools/scan.py', n: 1 }],
  });
  assert.equal(row.changed, 2);
  assert.equal(row.activated, 2);
  assert.equal(row.used_later, 0);
  assert.deepEqual(row.changes.map((change: any) => change.signals), [[], []]);
});

test('a rules.md line bound after a change promotes it, and a run after the save exercises a saved tool', () => {
  const row = settlementRow({
    level: 1, to: 6,
    changes: [
      { at: 3, path: 'tools/probe.py', version: 1 },
      { at: 3, path: 'prompts/lessons.md', version: 1 },
    ],
    versions: { 'tools/probe.py': 1, 'prompts/lessons.md': 1, 'prompts/rules.md': 2 },
    trajectory: [],
    runs: [{ kind: 'tool', path: 'tools/probe.py', n: 4 }],
  });
  assert.deepEqual(row.changes.map((change: any) => change.signals), [['rules', 'exercised'], ['rules']]);
  assert.equal(row.used_later, 2);
});

test('a slot key a later save drops is no longer activated, so it cannot be used later', () => {
  const row = settlementRow({
    level: 0, to: 2,
    changes: [{ at: 1, path: 'slots/self.json', version: 1, parameters: { slots: { 'stall.after': 60 } } }],
    versions: { 'slots/self.json': 2 },
    slots: { 'refine.every': 2 },
    trajectory: [{ n: 2, idea: 'stall.after is set' }],
    runs: [],
  });
  assert.deepEqual(row.changes, [{ path: 'slots/self.json', version: 1, activated: false, used_later: false, signals: [] }]);
  assert.equal(settlementText(row), '1 changed, 0 activated, 0 used later');
});
