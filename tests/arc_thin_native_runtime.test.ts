import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';

test('B: parent Python save records creation separately from a later component call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-self-save-'));
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  const tools = new Map<string, any>(); let active: string[] = [];
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool(t: any) { tools.set(t.name, t); },
    getActiveTools: () => active, setActiveTools(names: string[]) { active = names; } } as any,
    workspace, binder, state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 0,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    const result = await runtime.python('print(6 * 7)', undefined, false, 'answer');
    assert.match(result.content[0].text, /saved.*loaded/);
    const rows = readFileSync(join(root, '.harness/components.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(r => r.path === 'tools/answer.py' && r.by === 'agent' && r.kind === 'tool' && r.layer === 'self' && !r.error));
    assert.equal(logs.filter(r => r.kind === 'tool').length, 0, 'saving/running the cell is not a saved tool call');
    binder.boundary(); runtime.register();
    const called = await tools.get('answer').execute({ args: {} });
    assert.match(called.content[0].text, /42/);
    assert.ok(logs.some(r => r.file === 'component_runs.jsonl' && r.kind === 'tool' && r.path === 'tools/answer.py' && r.version === 1 && r.ok));
  } finally { runtime.close(); }
});

test('noteSave forwards process prompt saves to the host callback', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-process-save-')));
  const saved: Array<[string, string | undefined]> = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 0,
    log() {}, usage() {}, onSaved: (path, receipt) => { saved.push([path, receipt]); }, wrap: (_name, fn) => fn });
  try {
    runtime.noteSave('prompts/process/reuse.md', 'saved · loaded');
    assert.deepEqual(saved, [['prompts/process/reuse.md', 'saved · loaded']]);
  } finally { runtime.close(); }
});

test('short window check appears once after repeated nonacting Python work and resets after an action', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-window-check-')));
  let n = 0;
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => n,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    const run = async (code: string, readonly = false) => (await runtime.python(code, undefined, readonly)).content[0].text;
    assert.doesNotMatch(await run('print(1)'), /WINDOW CHECK/);
    assert.doesNotMatch(await run('print(2)'), /WINDOW CHECK/);
    assert.match(await run('print(3)'), /WINDOW CHECK.*If the next test is clear, act/);
    assert.doesNotMatch(await run('print(4)'), /WINDOW CHECK/, 'one cue per action window');
    n = 1;
    assert.doesNotMatch(await run('print(5)', true), /WINDOW CHECK/, 'read-only work does not advance the window');
    assert.doesNotMatch(await run('print(6)'), /WINDOW CHECK/);
    assert.doesNotMatch(await run('print(7)'), /WINDOW CHECK/);
    assert.match(await run('print(8)'), /WINDOW CHECK/);
    assert.deepEqual(logs.filter(row => row.file === 'component_runs.jsonl' && row.kind === 'window_check').map(row => row.n), [0, 1]);
  } finally { runtime.close(); }
});

test('sandbox artifact globals reflect authoritative workspace JSON', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-runtime-')));
  workspace.runtimeWrite('artifacts/measured.json', '{"answer":42}');
  workspace.runtimeWrite('results/unrelated.txt', 'x'.repeat(500000));
  const logs:any[]=[];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({ artifacts: { old: 'kept' } }), level: () => 0, actionCount: () => 0,
    log(file,row) {logs.push({file,...row});}, usage() {}, wrap: (_name, fn) => fn });
  try {
    const result = await runtime.python("(artifacts['measured']['answer'], artifacts['old'])");
    assert.match(result.content[0].text, /42.*kept/);
    workspace.runtimeWrite('notes/dynamic.md', 'EXACT_DYNAMIC_READ');
    const read = await runtime.python("path = 'notes/' + 'dynamic.md'\nopen(path).read()");
    assert.match(read.content[0].text, /EXACT_DYNAMIC_READ/);
    const runs=logs.filter(row=>row.file==='wasi_runs.jsonl');
    assert.equal(runs.length,2);
    assert.ok(runs[0].snapshot_read_bytes >= 500000);
    // Only files the code names travel with the cell; one it builds at run time is fetched while the cell waits.
    assert.ok(runs[0].input_bytes < 200000);
    assert.equal(runs[0].mode,'kernel');
    assert.equal(runs[1].files_fetched,1);
    assert.ok(runs[0].compile_ms>=0);
    assert.ok(runs[0].snapshot_ms>=0);
    // Listing works from file names alone (os.listdir('data') failed with ENOENT before).
    workspace.runtimeWrite('data/frames/0.json', '{}');
    const listed = await runtime.python("import os\n(os.listdir('data'), os.listdir('data/frames'), os.path.isdir('tools'), os.path.exists('notes/dynamic.md'), 'data' in os.listdir('.'))");
    assert.match(listed.content[0].text, /\[\["frames"\],\["0\.json"\],true,true,true\]/);
    // Repeated computations are counted for the CAPABILITIES area.
    for (const n of [1, 2]) await runtime.python(`g = history_like = [${n}]\nprint(len(g) + ${n})`);
    assert.match(runtime.repetitionText(0), /1 of your last \d python calls/);
    assert.equal(runtime.repetitionText(1), '');
  } finally { runtime.close(); }
});

test('work memory: a python result starts with its address, a repeat names the first call, an unchanged state answers it, cell(k) runs call k again', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-runtime-wm-')));
  const logs: any[] = [];
  let n = 0;
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({ grid: [[1, 2], [3, 4]] }), level: () => 0, actionCount: () => n,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  const text = async (code: string) => (await runtime.python(code)).content[0].text.trim();
  try {
    assert.match(await text('total = sum(map(sum, grid))\nprint(total)'), /^\[P1\]\n10\n[\s\S]*\(python session: \+total\)/);
    assert.equal(await text('# again\ntotal = sum(map(sum, grid))\nprint(total)'), '[P2 = P1: same code on the same state, not run again]\n10\n\n→ null');
    n = 1;
    assert.match(await text('total = sum(map(sum, grid))\nprint(total)'), /^\[P3 = P1: same code\]\n10\n/, 'a new state: it runs again');
    assert.match(await text('print(cell(1) is None, total)'), /^\[P4\]\n10\nTrue 10\n/, 'cell(1) ran P1 here');
    workspace.runtimeWrite('notes/x.md', 'x');
    assert.match(await text('# after a write\ntotal = sum(map(sum, grid))\nprint(total)'), /^\[P5 = P1: same code, other comments\]\n10\n/,
      'a workspace write since: it runs again');
    assert.match(await text('cell(99)'), /^\[P6\]\n[\s\S]*no python call P99/);
    // Lines retyped from an earlier call are named; cell(k, a, b) runs them.
    assert.match(await text('acc = []\nfor row in grid:\n    for v in row:\n        acc.append(v * 2)\nprint(sum(acc))'), /^\[P7\]\n20\n/);
    assert.match(await text('scale = 3\nacc = []\nfor row in grid:\n    for v in row:\n        acc.append(v*2)\nprint(sum(acc) * scale)'),
      /^\[P8: lines 2-5 = P7 lines 1-4\]\n60\n/);
    assert.match(await text('acc = None\ncell(7, 1, 4)\nprint(len(acc))'), /^\[P9\]\n4\n/);
    const calls = logs.filter((row) => row.file === 'python_calls.jsonl');
    assert.deepEqual(calls.map((row) => [row.id, row.same ?? null, Boolean(row.cached)]), [[1, null, false], [2, 1, true], [3, 1, false],
      [4, null, false], [5, 1, false], [6, null, false], [7, null, false], [8, null, false], [9, null, false]]);
    assert.deepEqual(calls[3].cells, [1]);
    assert.deepEqual(calls[7].blocks, [{ from: 2, to: 5, id: 7, a: 1, b: 4 }]);
    assert.deepEqual(calls[8].cells, [7]);
  } finally { runtime.close(); }
});

test('a view and predictor saved on an earlier level are reported as unconfirmed and are not run on the next level', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-runtime-stale-level-')));
  const binder = new Binder(workspace, validatePythonComponent);
  workspace.runtimeWrite('tools/old_view.py', '# Old level map.\n# view: on\ndef observe(state):\n    return "OLD_LEVEL_MAP"\n');
  await binder.save('tools/old_view.py', 0);
  workspace.runtimeWrite('tools/old_predictor.py', 'def predict(state, action):\n    return {"state": "NOT_FINISHED"}\n');
  await binder.save('tools/old_predictor.py', 0);
  binder.boundary();
  const logs: any[] = [];
  let level = 1;
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder,
    state: () => ({ grid: [[1]] }), level: () => level, actionCount: () => 1,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    runtime.observe(1);
    const shown = await runtime.observerText();
    assert.match(shown, /old_view\.py.*written on level 0.*unconfirmed on level 1/i);
    assert.doesNotMatch(shown, /OLD_LEVEL_MAP/);
    assert.deepEqual(logs.filter(row => row.file === 'observer_runs.jsonl'), []);
    assert.deepEqual(await runtime.predict({ name: 'ACTION1' }), []);

    level = 0;
    runtime.observe(2);
    assert.match(await runtime.observerText(), /OLD_LEVEL_MAP/);
    assert.equal(logs.filter(row => row.file === 'observer_runs.jsonl').length, 1);
    assert.equal((await runtime.predict({ name: 'ACTION1' })).length, 1);
  } finally { runtime.close(); }
});

test('action guards run only on their saved level and return versioned decisions', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-runtime-guard-level-')));
  const binder = new Binder(workspace, validatePythonComponent);
  workspace.runtimeWrite('tools/guard.py', 'def admit(state, action):\n    return action["name"] != "ACTION1"\n');
  await binder.save('tools/guard.py', 0);
  binder.boundary();
  let level = 0;
  const registered: string[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool(tool: any) { registered.push(tool.name); } } as any, workspace, binder,
    state: () => ({ grid: [[1]] }), level: () => level, actionCount: () => 0,
    log() {}, usage() {}, wrap: (_name, fn) => fn });
  try {
    runtime.register();
    assert.equal(registered.includes('guard'), false, 'an action guard is a runtime hook, not a callable tool');
    const checks = await runtime.admit({ name: 'ACTION1' });
    assert.equal(checks.length, 1);
    assert.deepEqual({ path: checks[0].path, version: checks[0].version, allow: checks[0].allow },
      { path: 'tools/guard.py', version: 1, allow: false });
    assert.equal(typeof checks[0].ms, 'number');
    level = 1;
    assert.deepEqual(await runtime.admit({ name: 'ACTION1' }), [], 'a prior-level guard does not constrain this level');
  } finally { runtime.close(); }
});

test('a loop mount carries versioned local state through real feedback and restart without acting or writing', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-runtime-meta-')));
  const binder = new Binder(workspace, validatePythonComponent);
  workspace.runtimeWrite('tools/process.py', '# mount: decision, action, feedback\n' +
    'def on_event(state, event):\n' +
    '    if event["phase"] == "decision":\n' +
    '        return {"context": "local=" + str(event["local"]), "next_local": (event["local"] or 0) + 1}\n' +
    '    if event["phase"] == "action":\n' +
    '        return {"allow": True, "expect_next": [{"path": "grid.0.0", "equals": 2}]}\n' +
    '    return {"next_local": state["grid"][0][0]}\n');
  await binder.save('tools/process.py', 0);
  binder.boundary();
  let n = 0, level = 0, grid = [[1]];
  const logs: any[] = [];
  const host = { pi: { registerTool() {} } as any, workspace, binder, state: () => ({ grid }),
    level: () => level, actionCount: () => n, log(file: string, row: any) { logs.push({ file, ...row }); },
    usage() {}, wrap: (_name: string, fn: any) => fn };
  const runtime = new NativeRuntime(host);
  try {
    assert.match(await runtime.loopDecisionText(), /local=None/);
    const action = await runtime.loopAction({ name: 'ACTION1' });
    assert.equal(action[0].allow, true);
    assert.deepEqual(action[0].expect_next, [{ path: 'grid.0.0', equals: 2 }]);
    n = 1; grid = [[2]];
    await runtime.loopFeedback({ name: 'ACTION1' }, [{ path: 'grid.0.0', hit: true }], 0);
    assert.match(await runtime.loopDecisionText(), /local=2/);
    assert.ok(logs.some(row => row.file === 'mount_state.jsonl' && row.local === 2));
    level = 1;
    assert.equal(await runtime.loopDecisionText(), '');
    assert.deepEqual(await runtime.loopAction({ name: 'ACTION1' }), []);
  } finally { runtime.close(); }
  level = 0;
  const restored = new NativeRuntime(host);
  try {
    restored.seedMountLocal(logs.filter(row => row.file === 'mount_state.jsonl'));
    assert.match(await restored.loopDecisionText(), /local=3/);
  } finally { restored.close(); }
});
