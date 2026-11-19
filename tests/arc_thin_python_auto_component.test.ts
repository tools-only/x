import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';
import { SelfRoot } from '../demo/self_root.ts';
import { ARC_SELF_ROOT_OPTIONS, loadOrCreateArcContract } from '../demo/self_root_arc.ts';

test('a documented portable session function becomes a SelfRoot tool without a publish call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'python-auto-component-'));
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  const contract = loadOrCreateArcContract(root, [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools]);
  const evo = new SelfRoot(contract, undefined, validatePythonComponent, workspace, undefined, ARC_SELF_ROOT_OPTIONS);
  evo.pin('task');
  const tools = new Map<string, any>();
  const runtime = new NativeRuntime({ pi: { registerTool(tool: any) { tools.set(tool.name, tool); }, getActiveTools: () => [], setActiveTools() {} } as any,
    workspace, binder, self: binder, reflectedSelf: evo, state: () => ({}), level: () => 0, actionCount: () => 0,
    log() {}, usage() {}, wrap: (_name, fn) => fn });
  try {
    const created = await runtime.python('def double(args, env):\n    """Double a supplied number.\n    Applies: numeric inputs.\n    """\n    value = args["value"]\n    if not isinstance(value, (int, float)):\n        raise ValueError("value must be numeric")\n    return {"value": value * 2}');
    assert.match(created.content[0].text, /automatically staged as a SelfRoot tool/);
    await evo.boundary(() => {}, () => {});
    assert.deepEqual(evo.executionView().active_components.filter((c: any) => c.kind === 'tool').map((c: any) => c.name), ['double']);
    assert.match(evo.executionView().active_components.find((c: any) => c.name === 'double')?.description ?? '', /Applies: numeric inputs/);
    assert.equal(JSON.stringify(evo.executionView()).includes('value must be numeric'), false, 'ordinary view does not include source');
    runtime.register();
    const result = await tools.get('double').execute({ args: { value: 4 } });
    assert.match(result.content[0].text, /8/);
    const invalid = await tools.get('double').execute({ args: { value: 'bad' } });
    assert.match(invalid.content[0].text, /value must be numeric/);
    await runtime.python('def double(args, env):\n    """Triple a supplied number.\n    Applies: numeric inputs.\n    """\n    value = args["value"]\n    if not isinstance(value, (int, float)):\n        raise ValueError("value must be numeric")\n    return {"value": value * 3}');
    await evo.boundary(() => {}, () => {});
    runtime.register();
    assert.equal(evo.executionView().active_components.find((c: any) => c.name === 'double')?.version, 2);
    const revised = await tools.get('double').execute({ args: { value: 4 } });
    assert.match(revised.content[0].text, /12/);
  } finally { runtime.close(); rmSync(root, { recursive: true, force: true }); }
});

test('scratch code and nonportable functions stay in the sandbox', async () => {
  const root = mkdtempSync(join(tmpdir(), 'python-auto-scratch-'));
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  const contract = loadOrCreateArcContract(root, [...ARC_SELF_ROOT_OPTIONS.reviewTools, ...ARC_SELF_ROOT_OPTIONS.evolutionTools]);
  const evo = new SelfRoot(contract, undefined, validatePythonComponent, workspace, undefined, ARC_SELF_ROOT_OPTIONS);
  evo.pin('task');
  const runtime = new NativeRuntime({ pi: { registerTool() {}, getActiveTools: () => [], setActiveTools() {} } as any,
    workspace, binder, self: binder, reflectedSelf: evo, state: () => ({}), level: () => 0, actionCount: () => 0,
    log() {}, usage() {}, wrap: (_name, fn) => fn });
  try {
    await runtime.python('print(3)');
    const undocumented = await runtime.python('def hidden(args, env):\n    return args["value"]');
    assert.match(undocumented.content[0].text, /not mounted.*docstring needs/);
    const dependent = await runtime.python('offset = 7\ndef shifted(args, env):\n    """Shift a supplied number.\n    Applies: numeric inputs.\n    """\n    return args["value"] + offset');
    assert.match(dependent.content[0].text, /not mounted.*dependencies explicit/);
    await evo.boundary(() => {}, () => {});
    assert.equal(evo.executionView().active_components.some((c: any) => c.kind === 'tool'), false);
  } finally { runtime.close(); rmSync(root, { recursive: true, force: true }); }
});
