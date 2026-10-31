import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { codeShape, kitOf } from '../demo/arc_thin_reuse.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';

test('Self candidate -> explicit promote -> named Task call -> resident feedback, without convert note', async () => {
  const root = mkdtempSync(join(tmpdir(), 'self-contract-'));
  const workspace = new Workspace(root), binder = new Binder(workspace, validatePythonComponent);
  const tools = new Map<string, any>(), logs: any[] = [];
  let decision = 1, level = 0;
  const runtime = new NativeRuntime({ pi: { registerTool(t: any) { tools.set(t.name, t); } } as any,
    workspace, binder, state: () => ({}), level: () => level, actionCount: () => 0,
    decision: () => decision, selfBaseline: true, workMemory: false,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    await runtime.python('def total(values: list[int]) -> int:\n    return sum(values)\nprint(total([1, 2]))');
    assert.deepEqual(runtime.promotionCandidates().map(c => c.name), ['total']);
    assert.equal(binder.candidates().length, 0, 'sensing must never publish');
    assert.match(runtime.selfMaterials(), /candidate total/);
    decision = 4;
    assert.match(runtime.selfMaterials(), /candidate_uncalled/);
    level = 1;
    assert.equal(runtime.promotionCandidates().length, 0, 'window starts at level boundary');
    level = 0;
    await runtime.promote();
    assert.equal(existsSync(join(workspace.root, 'notes/convert.md')), false);
    assert.match(runtime.selfMaterials(), /total \| tool \| Shown \| via=0/);
    assert.doesNotMatch(runtime.selfMaterials(), /Covered/);
    assert.doesNotMatch(binder.index(0), /tools\/|workspace|hypothesis|stall/i);
    binder.boundary();
    const result = await tools.get('total').execute({ args: { values: [4, 7] } });
    assert.match(result.content[0].text, /11/);
    assert.match(runtime.selfMaterials(), /total \| Covered \| via=1/);
    await tools.get('total').execute({ args: {} });
    await tools.get('total').execute({ args: {} });
    assert.match(runtime.selfMaterials(), /total \| repeated_call_failure/);
    assert.ok(logs.some(r => r.file === 'component_runs.jsonl' && r.kind === 'tool' && r.ok === true));
    await assert.rejects(runtime.saveTool('../wrong', 'def run(args, env):\n    return 1'), /name:/);
    await assert.rejects(runtime.saveTool('broken', 'return 1'), /run\(args, env\)/);
    await runtime.python('def leftover(value):\n    return value');
    await runtime.python('def run(value, /, offset=2, *, multiplier=3):\n    return (value + offset) * multiplier');
    await runtime.promote('run'); binder.boundary();
    assert.match((await tools.get('run').execute({ args: { value: 4 } })).content[0].text, /18/);
    assert.ok(runtime.selfMaterials().length <= 2400);
    assert.deepEqual(runtime.promotionCandidates(), [], 'save cursor excludes earlier cells even at the same action');
    const replay = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder,
      state: () => ({}), level: () => 0, actionCount: () => 0, log() {}, usage() {}, wrap: (_name, fn) => fn });
    try {
      replay.seedPython(logs.filter(r => r.file === 'component_runs.jsonl'));
      replay.seedSelfMaterials(logs.filter(r => r.file === 'self_materials.jsonl'));
      assert.deepEqual(replay.promotionCandidates(), [], 'restart restores the same save cursor');
      assert.match(replay.selfMaterials(), /Covered/);
    } finally { replay.close(); }
  } finally { runtime.close(); }
});


test('repeat scanner names uncovered work and stops reporting it when a component covers it', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'self-repeat-')));
  const binder = new Binder(workspace, validatePythonComponent);
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder,
    state: () => ({}), level: () => 0, actionCount: () => 0, log() {}, usage() {}, wrap: (_name, fn) => fn });
  const code = 'print(sum([1, 2]))';
  try {
    runtime.seedPython([1, 2, 3].map(decision => ({ kind: 'python', level: 0, n: 0, decision,
      ok: true, ...codeShape(code), kit: '', code_excerpt: code })));
    assert.match(runtime.selfMaterials(), /reuse_[a-f0-9]+ \| repeated_work_without_component/);
    workspace.runtimeWrite('tools/existing.py', code);
    await binder.save('tools/existing.py', 0); binder.boundary();
    runtime.seedPython([4, 5, 6].map(decision => ({ kind: 'python', level: 0, n: 0, decision,
      ok: true, ...codeShape(code), kit: kitOf(binder.versionMap()), code_excerpt: code })));
    assert.equal(runtime.repeatedWork(0)[0]?.covered, 'tools/existing.py');
    assert.doesNotMatch(runtime.selfMaterials(), /repeated_work_without_component/);
  } finally { runtime.close(); }
});
