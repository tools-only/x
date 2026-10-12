import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';

test('workspace file tools refuse absolute, traversal, junction and protected writes', async () => {
  const run = mkdtempSync(join(tmpdir(), 'arc-workspace-')); const w = new Workspace(run);
  const tools = Object.fromEntries(w.fileTools().map(t => [t.name, t]));
  const call = (name: string, args: any) => tools[name].execute('test', args, undefined, undefined, { cwd: run } as any);
  const text = (r: any) => r.content.map((b: any) => b.text).join('\n');
  await call('write', { path: 'notes/a.md', content: 'precise evidence\nCOUNTEREXAMPLE' });
  assert.match(text(await call('read', { path: 'notes/a.md', offset: 2, limit: 1 })), /COUNTEREXAMPLE/);
  await call('edit', { path: 'notes/a.md', edits: [{ oldText: 'precise', newText: 'exact' }] });
  assert.match(text(await call('grep', { pattern: 'exact' })), /notes\/a.md:1:exact evidence/);
  w.runtimeWrite('data/current.json', '{"n":0}');
  assert.match(text(await call('read', { path: 'data/current.json' })), /"n":0/);
  for (const path of ['../outside', join(run, 'host.txt'), 'data/current.json', 'results/x.txt', '.harness/secret', 'notes/a.md:stream'])
    await assert.rejects(call('write', { path, content: 'escape' }), /workspace|read.only|path/i);
  const outside = join(run, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret.txt'), 'HOST_SECRET');
  symlinkSync(outside, join(w.root, 'notes/link'), 'junction');
  for (const name of ['read', 'write', 'edit', 'ls', 'grep']) await assert.rejects(call(name,
    name === 'grep' ? { path: 'notes/link', pattern: '.' } : { path: 'notes/link/secret.txt', content: 'escape', edits: [] }), /link|junction/i);
  assert.equal(text(await call('grep', { pattern: 'HOST_SECRET' })).includes('HOST_SECRET'), false);
});
