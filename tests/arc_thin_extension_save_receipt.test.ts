import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

test('tool save receipt states the env.act fact only when the saved source omits it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arc-thin-env-act-receipt-'));
  const names = ['ARC_THIN_FOUNDATION', 'ARC_THIN_SELF_BASELINE', 'ARC_THIN_SELF_CONVERT', 'ARC_RUN_ROOT'];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  let activeTools: string[] = [];
  process.env.ARC_THIN_FOUNDATION = 'native';
  process.env.ARC_THIN_SELF_BASELINE = '1';
  delete process.env.ARC_THIN_SELF_CONVERT;
  process.env.ARC_RUN_ROOT = root;
  const pi = {
    on(name: string, handler: Function) { handlers.set(name, handler); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    getActiveTools() { return activeTools; },
    setActiveTools(value: string[]) { activeTools = value; },
    getAllTools() { return []; },
    getThinkingLevel() { return 'off'; },
  } as any;
  try {
    arcThinExtension(pi);
    await handlers.get('session_start')!({}, {});
    const save = tools.get('save');
    const readOnly = await save.execute('save-read', {
      kind: 'tool', name: 'inspect_grid',
      content: 'def run(args, env):\n    return {"value": 7}',
    }, undefined, undefined, {});
    const readOnlyText = readOnly.content.map((block: any) => block.text ?? '').join('\n');
    assert.match(readOnlyText, /此版本未引用 env\.act/);
    assert.match(readOnlyText, /必要时调用 env\.act，再保存新版/);

    const actionCapable = await save.execute('save-action', {
      kind: 'tool', name: 'move_if_needed',
      content: 'def run(args, env):\n    if args.get("act"):\n        return env.act({"action": "ACTION1"})\n    return {"value": 7}',
    }, undefined, undefined, {});
    const actionText = actionCapable.content.map((block: any) => block.text ?? '').join('\n');
    assert.doesNotMatch(actionText, /此版本未引用 env\.act/);
  } finally {
    handlers.get('session_shutdown')?.();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
