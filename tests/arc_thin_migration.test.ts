import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { migrateWorkspace } from '../demo/arc_thin_migration.ts';
import { executeNative, validatePythonComponent } from '../demo/arc_thin_components.ts';

test('legacy stores migrate once into normal workspace components with compatible state artifacts', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'migration-')));
  const input = { skills: new Map([['old', { source: 'def run(state, args):\n    return state["artifacts"]["route"] + args.get("extra", 0)\n', description: 'use the route' }]]),
    overlay: 'KEEP_THE_COUNTEREXAMPLE', notes: new Map([['controls', { text: 'saved controls' }]]), artifacts: { route: 40 } };
  assert.equal(migrateWorkspace(workspace, input).length, 5);
  assert.deepEqual(migrateWorkspace(workspace, input), []);
  const binder = new Binder(workspace, validatePythonComponent); await binder.scan(0); binder.boundary();
  const sources = Object.fromEntries(binder.active().filter(c => c.path.endsWith('.py')).map(c => [c.path, c.source]));
  const result = await executeNative({ sources, mode: 'call', path: 'tools/old.py', args: { args: { extra: 2 } }, state: { artifacts: { route: 40 } } });
  assert.deepEqual(result, { ok: true, value: 42 });
  assert.equal(workspace.read('notes/controls.md'), 'saved controls');
  assert.equal(JSON.parse(workspace.read('artifacts/route.json')), 40);
  assert.equal(binder.active().find(c => c.kind === 'prompt')?.body?.trim(), 'KEEP_THE_COUNTEREXAMPLE');
});
