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
  const registered = new Set<string>();
  const tools = new Map<string, any>(); let active: string[] = [];
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool(t: any) { tools.set(t.name, t); },
    getActiveTools: () => active, setActiveTools(names: string[]) { active = names; } } as any,
    workspace, binder, state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 0,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    const result = await runtime.python('print(6 * 7)', undefined, false, 'answer');
    assert.match(result.content[0].text, /saved.*loaded/);
    assert.match(result.content[1].text, /Next request: call answer\(args=\{\}\) to run the saved version/);
    const rows = readFileSync(join(root, '.harness/components.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(r => r.path === 'tools/answer.py' && r.by === 'agent' && r.kind === 'tool' && r.layer === 'self' && !r.error));
    assert.equal(logs.filter(r => r.kind === 'tool').length, 0, 'saving/running the cell is not a saved tool call');
    binder.boundary(); runtime.register();
    const called = await tools.get('answer').execute({ args: {} });
    assert.match(called.content[0].text, /42/);
    assert.ok(logs.some(r => r.file === 'component_runs.jsonl' && r.kind === 'tool' && r.path === 'tools/answer.py' && r.version === 1 && r.ok));
    assert.match(runtime.selfFeedbackText(), /answer v1: 1 calls OK, 0 failed/);
    const replay = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder,
      state: () => ({}), level: () => 0, actionCount: () => 0, log() {}, usage() {}, wrap: (_name, fn) => fn });
    try {
      replay.seedPython(logs.filter(row => row.file === 'component_runs.jsonl'));
      assert.equal(replay.selfFeedbackText(), runtime.selfFeedbackText(), 'restart reconstructs current-version feedback');
      replay.seedPython([{ kind: 'save', path: 'tools/answer.py', version: 1, by: 'agent', n: 0, ok: true },
        { kind: 'tool', path: 'tools/answer.py', version: 1, readonly: true, ok: false }]);
      assert.match(replay.selfFeedbackText(), /answer v1: 1 calls OK, 0 failed/, 'unchanged saves and readonly calls retain the counts');
    } finally { replay.close(); }
  } finally { runtime.close(); }
});

test('AGENT-RUNTIME-IFACE: save adapts an exact session ref and rejects incomplete tool content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-save-intent-'));
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  const tools = new Map<string, any>();
  let actions = 0;
  const runtime = new NativeRuntime({ pi: { registerTool(t: any) { tools.set(t.name, t); },
    getActiveTools: () => [], setActiveTools() {} } as any,
    workspace, binder, state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => 0,
    act: async call => { actions++; return { line: `played ${call.action}`, observation: { state: 'PLAYING' } }; },
    log() {}, usage() {}, wrap: (_name, fn) => fn });
  try {
    await runtime.python('def candidate(args, env):\n    if args.get("act"):\n        return env.act(args["action"])\n    return {"value": args.get("value")}');
    const source = await runtime.toolSource(undefined, 'candidate');
    assert.match(source, /def run\(args, env\):\n    return candidate\(args, env\)/);
    await assert.rejects(runtime.toolSource('def inspect(state):\n    return state', undefined),
      /must define run\(args, env\)/);
    workspace.mutate({ op: 'write', path: 'tools/candidate.py', content: source });
    const receipt = await binder.save('tools/candidate.py', 0, { by: 'agent' });
    assert.match(receipt ?? '', /saved.*loaded/);
    binder.boundary(); runtime.register();
    const result = await tools.get('candidate').execute({ args: { value: 7 } });
    assert.match(result.content[0].text, /7/);
    const acted = await tools.get('candidate').execute({ args: { act: true, action: 'ACTION1' } });
    assert.equal(actions, 1);
    assert.match(acted.content[0].text, /ACTED 1 action/);
  } finally { runtime.close(); }
});

test('CANDIDATE-TOOL-REF: session export confirms exact ref and rejects non-callable definitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-session-ref-'));
  const workspace = new Workspace(root);
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({}), level: () => 0, actionCount: () => 0,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    await runtime.python('def candidate(args, env):\n    return {"ok": True}');
    const exported = await runtime.sessionFunction('candidate');
    assert.equal(exported.ok, true);
    assert.deepEqual(logs.filter(row => row.file === 'component_runs.jsonl' && row.kind === 'session_export')
      .map(row => ({ function: row.function, parameters: row.parameters, ok: row.ok })),
      [{ function: 'candidate', parameters: ['args', 'env'], ok: true }]);
    const missing = await runtime.sessionFunction('missing');
    assert.equal(missing.ok, false);
    assert.match(missing.error ?? '', /no saved session function named missing/);
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
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => n, pythonSession: false,
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

test('ordinary task Python calls do not receive a conversion cue', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-convert-cue-')));
  let decision = 1;
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({}), level: () => 0, actionCount: () => 0, decision: () => decision, selfBaseline: true,
    pythonSession: false,
    workMemory: false, receipt: () => 'SHORTENED OUTPUT',
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  const run = (name: string, readonly = false) => runtime.python(`def ${name}(items):\n    return sum(items)\nprint('x' * 10000)`, undefined, readonly);
  try {
    await run('subtotal');
    const repeated = await run('renamed_subtotal');
    assert.match(repeated.content[0].text, /^SHORTENED OUTPUT/);
    assert.doesNotMatch(repeated.content.map((part: any) => part.text ?? '').join('\n'), /SELF REUSE/);
    assert.equal((await run('third_subtotal')).content.length, 1);
    decision = 2;
    assert.equal((await run('readonly_subtotal', true)).content.length, 1);
    assert.equal((await run('later_subtotal')).content.length, 1);
    assert.equal(logs.filter(row => row.kind === 'save').length, 0);
    assert.equal(logs.filter(row => row.kind === 'conversion_hint').length, 0);
  } finally { runtime.close(); }
});

test('ordinary task session function reuse does not emit conversion guidance', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-prototype-cue-')));
  const logs: any[] = [];
  const runtime = new NativeRuntime({ pi: { registerTool() {} } as any, workspace, binder: new Binder(workspace),
    state: () => ({}), level: () => 0, actionCount: () => 0, decision: () => 1, selfBaseline: true,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    const defined = await runtime.python('def shift_rows(rows, delta):\n    return [row + delta for row in rows]');
    assert.doesNotMatch(defined.content.map((part: any) => part.text ?? '').join('\n'), /SELF REUSE/);
    const firstUse = await runtime.python("result = shift_rows([1, 2], 3)\nprint('first', result[0])");
    assert.doesNotMatch(firstUse.content.map((part: any) => part.text ?? '').join('\n'), /SELF REUSE/);
    const reused = await runtime.python("rows = shift_rows([4, 5], 2)\nprint('last', rows[-1])\nprint('count', len(rows))");
    assert.doesNotMatch(reused.content.map((part: any) => part.text ?? '').join('\n'), /SELF REUSE/);
    assert.deepEqual(logs.filter(row => row.kind === 'conversion_hint'), []);
  } finally { runtime.close(); }
});

test('related active components are shown with version and evidence; read and trial remain optional telemetry', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'native-reuse-index-')));
  const binder = new Binder(workspace, validatePythonComponent);
  const registered = new Set<string>();
  workspace.runtimeWrite('tools/sum_rows.py', '# view: off\ndef run(state, args):\n    rows = args["rows"]\n    return sum(sum(row) for row in rows)\n\ndef summarize(rows):\n    return sum(sum(row) for row in rows)\n');
  await binder.save('tools/sum_rows.py', 0, { by: 'agent' }); binder.boundary();
  const logs: any[] = [];
  let n = 0;
  const runtime = new NativeRuntime({ pi: { registerTool(tool: any) { registered.add(tool.name); } } as any, workspace, binder,
    state: () => ({ grid: [[1]] }), level: () => 0, actionCount: () => n,
    log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn });
  try {
    runtime.register();
    assert.equal(registered.has('sum_rows'), true, `candidate=${JSON.stringify(binder.candidates().map(c => ({ path: c.path, name: c.name, kind: c.kind, view: (c as any).view, level: c.level })))} names=${runtime.toolNames()}`);
    const result = await runtime.python('rows = [[1, 2], [3, 4]]\nprint(sum(sum(row) for row in rows))');
    assert.match(result.content.map((part: any) => part.text ?? '').join('\n'), /RELATED COMPONENTS[\s\S]*sum_rows@1 sum_rows\(args=\{\.\.\.\}\).*\d+\/\d+ normalized computation lines match/);
    runtime.noteReuseRead('tools/sum_rows.py');
    assert.ok(logs.some(row => row.kind === 'reuse_shown' && row.paths.includes('tools/sum_rows.py@1')));
    assert.ok(logs.some(row => row.kind === 'reuse_shown' && row.evidence[0].matched > 0));
    assert.ok(logs.some(row => row.kind === 'reuse_read' && row.path === 'tools/sum_rows.py' && row.version === 1));
    n++;
    assert.doesNotMatch((await runtime.python('x = 2\nprint(x + 1)')).content.map((part: any) => part.text ?? '').join('\n'), /RELATED COMPONENTS/);
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
