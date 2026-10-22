import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { Workspace } from '../demo/arc_thin_workspace.ts';

test('consult reserves its last budget rounds for a no-tools conclusion and returns refs on mechanical failure', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'thin-consult-budget-')));
  workspace.runtimeWrite('notes/evidence.md', 'Observed: the marker changed after ACTION1.');
  workspace.runtimeWrite('agents/analyst.md', '---\ndescription: general evidence analyst\ntools: [read]\nrefs: [notes/evidence.md]\n---\nSeparate observation from explanation.');
  const binder = new Binder(workspace);
  await binder.scan(0); binder.boundary();
  const tools = new Map<string, any>(), requests: any[] = [], logs: any[] = [];
  let failNext = false, round = 0;
  const runtime = new NativeRuntime({ pi: { registerTool: (tool: any) => tools.set(tool.name, tool) } as any, workspace, binder,
    state: () => ({}), level: () => 0, actionCount: () => 1, log: (file, row) => logs.push({ file, ...row }), usage() {},
    wrap: (_name, fn) => fn, pythonSession: false, pythonKernel: false });
  runtime.register();
  const ctx: any = { model: { id: 'test-model', api: 'test', provider: 'test', input: ['text'] }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'test-key', headers: {} }),
    streamSimple: (_model: any, context: any) => {
      requests.push(context); round += 1;
      return { result: async () => {
        if (failNext) { failNext = false; return { stopReason: 'error', errorMessage: 'service unavailable', content: [] }; }
        const usage = { input: 1, output: 1, totalTokens: 2, cost: {} };
        if (round <= 4) return { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: `r${round}`,
          name: 'read', arguments: { path: 'notes/evidence.md' } }], usage };
        return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Known: the marker changed after ACTION1. Unknown: the cause.' }], usage };
      } };
    } } };
  try {
    const result = await tools.get('consult').execute({ agent: 'analyst', question: 'What is established?', refs: [] }, undefined, ctx);
    assert.match(result.content[0].text, /Known: the marker changed after ACTION1\. Unknown: the cause\./);
    assert.match(result.content[0].text, /Evidence refs: notes\/evidence\.md/);
    assert.equal(requests.length, 5, 'one of the existing six rounds remains available for a length continuation');
    assert.ok(requests.slice(0, 4).every(request => request.tools.length === 1));
    assert.equal(requests[4].tools.length, 0, 'the reserved delivery round cannot launch more research tools');
    assert.match(requests[4].systemPrompt, /FINAL DELIVERY: state known facts, unknowns, and exact supplied evidence refs/);

    round = 0; failNext = true;
    const failed = await tools.get('consult').execute({ agent: 'analyst', question: 'What is established?', refs: [] }, undefined, ctx);
    assert.match(failed.content[0].text, /CONSULT INCOMPLETE: consult error: service unavailable/);
    assert.match(failed.content[0].text, /Unknown: a final synthesis was not returned/);
    assert.match(failed.content[0].text, /Evidence refs: notes\/evidence\.md/);
    assert.doesNotMatch(failed.content[0].text, /Known: the cause is/);
    assert.equal(logs.filter(row => row.file === 'consult_runs.jsonl' && row.incomplete).length, 1);
  } finally { runtime.close(); }
});
