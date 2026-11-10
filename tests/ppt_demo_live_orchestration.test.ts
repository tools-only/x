import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';

test('opt-in Pi surface projects and directly revises the live Agent orchestration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-live-self-'));
  const old = Object.fromEntries(['PPT_DEMO_ROOT', 'PPT_DEMO_DEADLINE', 'PPT_DEMO_BUDGET_USD', 'PPT_LIVE_ORCHESTRATION']
    .map(name => [name, process.env[name]]));
  Object.assign(process.env, { PPT_DEMO_ROOT: root, PPT_DEMO_DEADLINE: String(Date.now() + 60000), PPT_DEMO_BUDGET_USD: '100', PPT_LIVE_ORCHESTRATION: '1' });
  try {
    const tools = new Map<string, any>(), hooks = new Map<string, any>();
    const pi = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
      setActiveTools() {}, getActiveTools: () => [], getAllTools: () => [...tools.values()] };
    pptDemo(pi as any);
    await hooks.get('before_agent_start')({ prompt: 'Create a presentation.' });
    assert.ok(tools.has('reflect_component'));
    assert.ok(tools.has('reflect_orchestration'));
    assert.ok(tools.has('decide'));
    const definition = { roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] };
    const committed = await tools.get('reflect_orchestration').execute('test', { baseRevision: 1, orchestration: definition }, undefined, undefined, {});
    assert.match(committed.content[0].text, /"revision":2/);
    const event = { payload: { systemPrompt: 'PPT baseline', messages: [] } };
    hooks.get('before_provider_request')(event);
    assert.match(event.payload.systemPrompt, /LIVE AGENT SELF/);
    assert.match(event.payload.systemPrompt, /"rootObject": "complete running Agent"/);
    assert.match(event.payload.systemPrompt, /"revision": 2/);
    const rows = (await import('node:fs')).readFileSync(join(root, 'harness/live_orchestration.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(rows.some(row => row.event === 'reflection_committed'));
    assert.ok(rows.some(row => row.event === 'self_view_injected'));
  } finally {
    for (const [name, value] of Object.entries(old)) if (value === undefined) delete process.env[name]; else process.env[name] = value!;
  }
});
