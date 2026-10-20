import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';

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
