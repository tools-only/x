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
