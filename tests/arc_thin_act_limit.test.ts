import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';
import { MAX_ACTS, NativeRuntime, actLimit, actedSummary } from '../demo/arc_thin_native_runtime.ts';

const FIXED = { cap: MAX_ACTS, why: `the limit of ${MAX_ACTS} actions per call was reached` };

test('one acting call may spend a share of what the budget has left, at least one action and at most MAX_ACTS', () => {
  assert.deepEqual(actLimit({ used: 92, maximum: 110, total_used: 92, total_maximum: null }, 0.25),
    { cap: 5, why: "this call's share of the budget was reached (5 actions: 25% of the 18 left)" });
  assert.equal(actLimit({ used: 10, maximum: 500, total_used: 390, total_maximum: 400 }, 0.25).cap, 3, 'the nearer limit counts');
  assert.equal(actLimit({ used: 110, maximum: 110 }, 0.25).cap, 1, 'at an empty budget the environment refuses, not the cap');
  for (const fixed of [actLimit(undefined, 0.25), actLimit({ used: 3, maximum: null }, 0.25), actLimit({ used: 0, maximum: 500 }, 0.25),
    actLimit({ used: 92, maximum: 110 }, 0)])
    assert.deepEqual(fixed, FIXED);
});

test('a call of three or more actions gets one summary line, fewer get none', () => {
  assert.equal(actedSummary([{ n: 1, action: 'ACTION1', changed: 3 }, { n: 2, action: 'ACTION1', changed: 0 }]), '');
  assert.equal(actedSummary([{ n: 41, action: 'ACTION6', changed: 0 }, { n: 42, action: 'ACTION6', changed: 0 }, { n: 43, action: 'ACTION1', changed: 2 }]),
    'PLAYED #41–#43: ACTION6 ×2, ACTION1 ×1; 2 changed nothing');
  assert.equal(actedSummary([{ action: 'ACTION1', changed: 1 }, { action: 'ACTION1', changed: 1 }, { action: 'ACTION2', changed: null }]),
    'PLAYED: ACTION1 ×2, ACTION2 ×1');
});

test('the runtime stops an acting call at the cap its host gives, says why, and sums the batch up', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'act-limit-')));
  const binder = new Binder(workspace, validatePythonComponent);
  let n = 0;
  const runtime = new NativeRuntime({
    pi: { registerTool() {}, getActiveTools: () => [], setActiveTools() {} } as any,
    workspace, binder, state: () => ({ grid: [[7, 8]] }), level: () => 0, actionCount: () => n, log() {}, usage() {},
    wrap: (_name, fn) => fn,
    act: async (call) => { n += 1; return { line: `#${n} ${call.action} → changed=0`, observation: { n, changed_cells: 0, level_changed: false, missed: false } }; },
    actLimit: () => ({ cap: 3, why: 'CAP_REASON' }),
  });
  try {
    const result: any = await runtime.python('# Press until stopped.\nwhile True:\n    env.act("ACTION1")\n', undefined, false, 'press');
    assert.equal(n, 3);
    assert.match(result.content[0].text,
      /ACTED 3 action\(s\); stopped: CAP_REASON\. This decision ends\.\nPLAYED #1–#3: ACTION1 ×3; 3 changed nothing\n#1 ACTION1 → changed=0\n#2 ACTION1 → changed=0\n#3 ACTION1 → changed=0/);
    assert.equal(result.terminate, true);
  } finally { runtime.close(); }
});
