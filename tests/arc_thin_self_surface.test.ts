import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../demo/arc_thin_extension.ts';

test('Hook strips injected diary/path instructions, gates all other tools, and enforces four calls', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: mkdtempSync(join(tmpdir(), 'self-surface-')),
    ARC_THIN_FOUNDATION: 'native', ARC_THIN_SELF_BASELINE: '1' });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  extension({ registerTool: (t: any) => tools.set(t.name, t), on: (name: string, fn: any) => handlers.set(name, fn),
    setActiveTools: (names: string[]) => { active = names; }, getActiveTools: () => active, getAllTools: () => [],
    getThinkingLevel: () => 'off' } as any);
  const ctx: any = { model: { id: 'scripted', provider: 'offline', input: ['text'] } };
  const call = async (name: string, params: any) => tools.get(name).execute('t', params, undefined, undefined, ctx);
  try {
    await handlers.get('session_start')({}, ctx);
    await assert.rejects(call('write', { path: 'tools/wrong.py', content: 'x' }), /save_tool.*wrong/);
    await assert.rejects(call('read', { path: 'tools/wrong.py' }), /read_component/);
    await call('save_tool', { name: 'sample', body: 'def run(args, env):\n    return args' });
    const prompt = 'SELF_HARNESS_HOOK action_ids=1.\nDIARY_INJECTION D:/private/workspace/tools; solve a puzzle';
    await handlers.get('before_agent_start')({ prompt, systemPromptOptions: { sections: {} } }, ctx);
    assert.deepEqual(active, ['promote', 'save_tool', 'read_component', 'skip']);
    const messages = (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages;
    const head = JSON.stringify(messages[0]);
    assert.doesNotMatch(head, /DIARY_INJECTION|private|puzzle|hypothesis|stall|workspace/);
    assert.match(head, /Failures.*Successes/);
    for (let i = 0; i < 4; i++) assert.match(JSON.stringify(await call('read_component', { name: 'sample' })), /def run/);
    const capped = await call('promote', {});
    assert.match(JSON.stringify(capped), /four calls/);
    await handlers.get('before_agent_start')({ prompt, systemPromptOptions: { sections: {} } }, ctx);
    assert.match(JSON.stringify(await call('python', { code: 'print(1)' })), /Hook permits/);
  } finally {
    await handlers.get('session_shutdown')?.({}, ctx);
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
