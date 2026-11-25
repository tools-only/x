import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';

test('observer output is executed once and reused across requests on the same state', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'observer-same-state-')));
  const path = 'tools/inspect.py';
  const component: any = { kind: 'tool', name: 'inspect', path, source: 'print("OBSERVED_ONCE")', version: 1, level: 0, view: true };
  const logs: any[] = [];
  const self: any = { active: () => [component], candidates: () => [component], versionMap: () => ({ [path]: 1 }),
    sourceOf: () => component.source, label: () => 'inspect v1' };
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace), self,
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 4,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    runtime.observe(4);
    runtime.observe(4);
    assert.match(await runtime.observerText(), /OBSERVED_ONCE/);
    runtime.observe(4);
    assert.match(await runtime.observerText(), /OBSERVED_ONCE/);
    assert.equal(logs.filter(row => row.file === 'observer_runs.jsonl').length, 1,
      'repeated request boundaries for the same component version and state reuse the settled result');
  } finally { runtime.close(); }
});

test('observer restart restores the same-state receipt and its failure streak', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'observer-restart-')));
  const path = 'tools/inspect.py';
  const component: any = { kind: 'tool', name: 'inspect', path, source: 'print("observed")', version: 3, level: 0, view: true };
  const logs: any[] = [];
  const self: any = { active: () => [component], candidates: () => [component], versionMap: () => ({ [path]: 3 }),
    sourceOf: () => component.source };
  const deliveredFacts: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    self,
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 4,
    taskFacts: () => deliveredFacts,
    log(file, row) { logs.push({ file, ...row }); if (file === 'task_runtime_fact_delivery.jsonl') deliveredFacts.push(row); },
    usage() {}, wrap: (_name, fn) => fn });
  try {
    runtime.seedViews([
      { key: `${path}@3@1`, n: 1, ok: true, value: { stdout: 'OBSERVER_OK' }, current: 'inspect v3 state #1: OBSERVER_OK' },
      { key: `${path}@3@2`, n: 2, ok: false, error: 'observer failed', current: 'inspect v3 state #2: observer failed' },
      { key: `${path}@3@3`, n: 3, ok: false, error: 'observer failed', current: 'inspect v3 state #3: observer failed' },
      { key: `${path}@3@4`, n: 4, ok: false, error: 'observer failed', current: 'inspect v3 state #4: observer failed' },
    ]);
    assert.equal(runtime.lastShowingVersion(path, 4), 3);
    assert.deepEqual(runtime.viewStats().get(path), { runs: 4, errors: 3, changes: 0 });
    assert.deepEqual(runtime.emptyViews(), [{ path, version: 3, states: [3, 4], failed: 3, error: 'observer failed' }]);
    assert.equal(await runtime.observerText(), 'inspect v3 state #4: observer failed');
    const evidence = runtime.taskEvidenceText(0);
    assert.match(evidence, /runtime:observer:tools\/inspect\.py@3: observer produced no usable output on consecutive states #3, #4/);
    assert.match(evidence, /latest error: observer failed/);
    assert.match(evidence, /Source: observer_runs\.jsonl/);
    assert.equal(deliveredFacts.filter(row => row.kind === 'shown').length, 1,
      'the symptom delivery is persisted so the same evidence is not replayed unchanged');
    assert.equal(runtime.taskEvidenceText(0), '', 'the unchanged issue is not repeated at the next boundary');
    const reviewEvidence = runtime.taskEvidenceText(0, 'review');
    assert.match(reviewEvidence, /runtime:observer:tools\/inspect\.py@3: observer produced no usable output/);
    assert.equal(runtime.taskEvidenceText(0, 'review'), '', 'the same review evidence is not repeated within the pass');
    const restarted = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace), self,
      state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 4, taskFacts: () => deliveredFacts,
      log() {}, usage() {}, wrap: (_name, fn) => fn });
    try {
      restarted.seedViews([
        { key: `${path}@3@1`, n: 1, ok: true, value: { stdout: 'OBSERVER_OK' }, current: 'inspect v3 state #1: OBSERVER_OK' },
        { key: `${path}@3@2`, n: 2, ok: false, error: 'observer failed', current: 'inspect v3 state #2: observer failed' },
        { key: `${path}@3@3`, n: 3, ok: false, error: 'observer failed', current: 'inspect v3 state #3: observer failed' },
        { key: `${path}@3@4`, n: 4, ok: false, error: 'observer failed', current: 'inspect v3 state #4: observer failed' },
      ]);
      assert.equal(restarted.taskEvidenceText(0), '', 'the delivery ledger prevents an unchanged issue replay after restart');
      assert.equal(restarted.taskEvidenceText(0, 'review'), '');
      restarted.seedViews([
        { key: `${path}@3@5`, n: 5, ok: false, error: 'observer failed', current: 'inspect v3 state #5: observer failed' },
      ]);
      assert.match(restarted.taskEvidenceText(0), /#4, #5/,
        'new evidence for the unresolved issue is delivered after restart');
    } finally { restarted.close(); }
    runtime.observe(4);
    assert.equal(logs.filter(row => row.file === 'observer_runs.jsonl').length, 0,
      'the already-recorded state/version is reused after restart');
  } finally { runtime.close(); }
});

test('component exposure facts separate active-schema presence from execution', () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'component-exposure-')));
  const path = 'tools/probe.py';
  const component: any = { kind: 'tool', name: 'probe', path, source: 'def run(args): return 1', version: 2, level: 0 };
  const components = [{ kind: 'tool', name: 'probe', path, level: 0, version: 2, hash: 'hash-v2' }];
  const facts: any[] = [
    { kind: 'component_delivery', surface: 'task', decision: 3, n: 1, components },
    { kind: 'component_delivery', surface: 'task', decision: 4, n: 2, components },
    { kind: 'component_delivery', surface: 'review', decision: 5, n: 2, components },
    { kind: 'component_delivery', surface: 'review', decision: 6, n: 3, components },
  ];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    self: { active: () => [component], candidates: () => [component], versionMap: () => ({ [path]: 2 }), sourceOf: () => component.source },
    taskFacts: () => facts, state: () => ({}), level: () => 0, actionCount: () => 2, decision: () => 6,
    log() {}, usage() {}, wrap: (_name, fn) => fn });
  try {
    const taskEvidence = runtime.taskEvidenceText(0, 'task');
    assert.match(taskEvidence, /runtime:component:tools\/probe\.py@2: tool probe appeared in the active tool set at 2 task requests/);
    assert.match(taskEvidence, /no execution record for this version followed its first exposure/);
    assert.match(taskEvidence, /does not establish that the component was relevant or should have been called/);
    assert.equal(runtime.taskEvidenceText(0, 'task'), '', 'the unchanged exposure evidence is not repeated');
    assert.match(runtime.taskEvidenceText(0, 'review'), /runtime:component:tools\/probe\.py@2/);
    facts.push({ kind: 'component_execution', surface: 'task', path, version: 2, decision: 4, n: 2, outcome: 'success' });
    facts.push({ kind: 'component_delivery', surface: 'task', decision: 5, n: 3, components });
    const feedback = runtime.taskEvidenceText(0, 'task');
    assert.doesNotMatch(feedback, /Active runtime issue runtime:component/,
      'an execution closes the preceding exposure gap');
    assert.match(feedback, /Component-use feedback runtime:component:tools\/probe\.py@2/);
    assert.match(feedback, /execution recorded success at decision 4, action count #2; 0 environment action\(s\) have followed/);
    assert.match(feedback, /temporal evidence, not causal attribution/);
  } finally { runtime.close(); }
});
