import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { validateReflectiveComponent } from '../demo/arc_thin_components.ts';
import { createProcessCore } from '../demo/ppt_reflective_core.ts';

function boot() {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'evolution-v1-')), { dirs: ['tools', 'processes', 'notes', 'results', 'data'] });
  const binder = new Binder(workspace, validateReflectiveComponent);
  const state: any = { process: { active: null, pending: null, failures: [] } };
  const logs: any[] = [];
  const log = (file: string, row: any) => logs.push({ file, ...row });
  const core = createProcessCore({ workspace, binder, state, persist() {}, log });
  const host: any = { workspace, binder, state: () => ({ public_value: 7 }), level: () => 0, actionCount: () => 0,
    pi: { registerTool() {} }, wrap() {}, log, usage() {}, pythonSession: false,
    method: { state: state.process, persist() {}, totalMs: 30000, deadline: Date.now() + 90000 } };
  const runtime = new NativeRuntime(host);
  const publish = async (path: string, source: string) => {
    const result = await binder.publish(path, source, 0, { by: 'agent' });
    binder.boundary(); return result;
  };
  const method = async (strategy: string, refs: any[] = []) => {
    const envelope = { strategy, refs }; core.validate(envelope);
    const saved = await publish('processes/direct.json', JSON.stringify(envelope));
    assert.equal(saved.error, undefined);
    state.process.pending = { ...saved.component, envelope };
    core.activate('scope-a');
    return core.execution('data/input-1.json', 'scope-a');
  };
  return { workspace, binder, state, core, host, runtime, logs, publish, method };
}
const source = '# program: on\n# mount: decision,feedback\ndef on_event(state, event):\n    return {"context": {"value": state["public_value"], "phase": event["phase"], "owner": event["owner"]["version"]}, "next_local": (event["local"] or 0)+1}\n';

test('one current process replaces old strategy; Binder supplies process/memory identities and restore history', async () => {
  const b = boot();
  const first = await b.method('first');
  const second = await b.method('second');
  assert.notEqual(first.owner.hash, second.owner.hash);
  assert.equal(b.core.contextAdditions().length, 1);
  assert.match(b.core.contextAdditions()[0].text, /second/);
  assert.doesNotMatch(b.core.contextAdditions()[0].text, /first/);
  const restored = await b.publish('processes/direct.json', b.binder.sourceOf('processes/direct.json', 1)!);
  assert.equal(restored.component!.version, 3);
  assert.equal(restored.component!.hash, first.owner.hash);
  assert.equal(b.state.process.active.version, 2); // Future boundary only.
  const memory = await b.publish('notes/memory/facts.md', 'An authored interpretation.');
  assert.equal(memory.component!.kind, 'memory');
  assert.equal(b.binder.sourceOf(memory.component!.path, 1), memory.component!.source);
});

test('invalid tool source, forbidden action/guard and refs limits preserve old effective source', async () => {
  const b = boot();
  await b.publish('tools/compute.py', source);
  const invalid = await b.publish('tools/compute.py', '# program: on\ndef broken(');
  assert.ok(invalid.error);
  assert.equal(b.workspace.read('tools/compute.py'), source);
  assert.equal(b.binder.active().find(c => c.name === 'compute')!.version, 1);
  assert.ok((await b.publish('tools/action.py', source.replace('decision,feedback', 'action'))).error);
  assert.ok((await b.publish('tools/guard.py', '# program: on\ndef admit(state, action):\n    return True')).error);
  await b.publish('tools/other.py', source);
  assert.throws(() => b.core.validate({ strategy: 'x', refs: [{ name: 'compute', kind: 'tool', version: 1 }, { name: 'other', kind: 'tool', version: 1 }] }), /at most one/);
});

test('native compute dedupes across requests/restart, and late feedback retains producing version', async () => {
  const b = boot();
  await b.publish('tools/compute.py', source);
  const first = await b.method('compute', [{ name: 'compute', kind: 'tool', version: 1 }]);
  const decision = await b.runtime.loopDecisionText(first);
  assert.match(decision, /"value":7/);
  assert.match(decision, /output_ref/);
  assert.equal(await b.runtime.loopDecisionText(first), decision);
  assert.equal(await new NativeRuntime(b.host).loopDecisionText(first), decision);
  const second = await b.method('direct');
  assert.equal(await b.runtime.loopDecisionText(second), '');
  const feedback = await b.runtime.loopFeedback({ name: 'task-result' }, [], 0, first, { ref: 'data/result-2.json', actual: 8 });
  assert.match(feedback!, /feedback/);
  const runs = b.logs.filter(r => r.file === 'component_runs.jsonl');
  assert.equal(runs.length, 2);
  assert.equal(runs[1].owner.version, 1);
  assert.equal(runs[1].feedback_ref, 'data/result-2.json');
  assert.equal(runs[0].input_ref, 'data/input-1.json');
  assert.match(b.workspace.read(runs[1].output_ref), /"owner":1/);
  assert.ok(b.state.process.compute.spent_ms > 0);
  assert.ok(b.logs.some(r => r.file === 'wasi_runs.jsonl' && r.snapshot_ms >= 0));
});

test('mismatched refs and changed task scope pause compute; zero allowance does not execute', async () => {
  const b = boot();
  await b.publish('tools/compute.py', source);
  await b.method('compute', [{ name: 'compute', kind: 'tool', version: 1 }]);
  assert.match(await b.runtime.loopDecisionText(b.core.execution('data/new.json', 'scope-b')), /scope changed/);
  await b.publish('tools/compute.py', source + '\n# new version');
  assert.match(await b.runtime.loopDecisionText(b.core.execution('data/new.json', 'scope-a')), /references no longer match/);
  const current = await b.method('new', [{ name: 'compute', kind: 'tool', version: 2 }]);
  b.host.method.totalMs = 0;
  assert.match(await b.runtime.loopDecisionText(current), /allowance exhausted/);
  assert.equal(b.logs.filter(r => r.file === 'component_runs.jsonl').length, 0);
});

test('native read pages large single-line JSON without changing its bytes', async () => {
  const b = boot();
  const raw = JSON.stringify({ values: Array.from({ length: 10000 }, (_, i) => i) });
  b.workspace.runtimeWrite('data/large.json', raw);
  const read = b.workspace.fileTools().find(t => t.name === 'read')!;
  const result: any = await read.execute('read', { path: 'data/large.json', offset: 500, limit: 3 }, undefined, undefined, {} as any);
  assert.match(result.content[0].text, /497/);
  assert.equal(b.workspace.read('data/large.json'), raw);
});
