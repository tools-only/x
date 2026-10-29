import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { gitTool } from '../demo/arc_thin_git.ts';

test('git-lite commits only selected workspace files and binder still loads them', async () => {
  const run = mkdtempSync(join(tmpdir(), 'arc-git-lite-'));
  try {
    const workspace = new Workspace(run), binder = new Binder(workspace);
    const tool = gitTool(workspace);
    const call = async (op: string, extra: Record<string, unknown> = {}) => (tool.execute('test', { op, ...extra }) as any);
    const response = async (op: string, extra: Record<string, unknown> = {}) => {
      const result = await call(op, extra);
      return { result, text: result.content[0].text as string };
    };
    assert.match((await response('status')).text, /call git init/);
    assert.equal((await response('log')).result.isError, true);
    workspace.runtimeWrite('skills/retained/SKILL.md', '---\nname: retained\ndescription: reusable check\n---\nCheck one stable invariant.\n');
    workspace.runtimeWrite('notes/unselected.md', 'leave out');
    assert.equal((await response('init')).result.isError, undefined);
    assert.equal((await response('status')).result.isError, undefined);
    assert.equal((await response('add', { paths: ['skills/retained/SKILL.md'] })).result.isError, undefined);
    const staged = spawnSync('git', ['--git-dir', join(workspace.root, '.git'), '--work-tree', workspace.root, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    assert.equal(staged.stdout.trim(), 'skills/retained/SKILL.md');
    const committed = await response('commit', { message: '记录可复用的检查步骤' });
    assert.match(committed.text, /[a-f0-9]{40}/);
    assert.match(committed.text, /记录可复用的检查步骤/);
    assert.match(committed.text, /skills\/retained\/SKILL.md/);
    assert.doesNotMatch(committed.text, /notes\/unselected\.md/);
    const log = await response('log');
    assert.match(log.text, /[a-f0-9]{40}/);
    assert.match(log.text, /记录可复用的检查步骤/);
    await binder.scan(0); binder.boundary();
    assert.equal(binder.active().some(c => c.path === 'skills/retained/SKILL.md'), true);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('git-lite rejects unsafe paths, operations and external .git targets', async () => {
  const run = mkdtempSync(join(tmpdir(), 'arc-git-lite-negative-'));
  try {
    const workspace = new Workspace(run), tool = gitTool(workspace);
    const call = (op: string, extra: Record<string, unknown> = {}) => tool.execute('test', { op, ...extra }) as Promise<any>;
    assert.equal((await call('add', { paths: ['x'] })).isError, true);
    assert.equal((await call('init')).isError, undefined);
    for (const path of ['../escape', 'C:/outside', '.hidden', './x', '-A', 'notes/*', 'data/x', 'results/r.txt'])
      assert.equal((await call('add', { paths: [path] })).isError, true, path);
    for (const op of ['push', 'fetch', 'pull', 'remote', 'reset', 'checkout', 'switch', 'clean', 'rebase', 'branch', 'tag'])
      assert.equal((await call(op)).isError, true, op);
    const external = mkdtempSync(join(tmpdir(), 'arc-git-external-'));
    try {
      rmSync(join(workspace.root, '.git'), { recursive: true, force: true });
      mkdirSync(join(external, '.git'));
      const link = spawnSync('cmd.exe', ['/c', 'mklink', '/J', join(workspace.root, '.git'), join(external, '.git')], { encoding: 'utf8' });
      if (link.status === 0) assert.equal((await call('status')).isError, true);
    } finally { rmSync(external, { recursive: true, force: true }); }
  } finally { rmSync(run, { recursive: true, force: true }); }
});
