import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';

test('Python tool receipts explain Markdown and syntax failures and load valid tools', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-python-feedback-')));
  const b = new Binder(w, validatePythonComponent);
  const save = async (path: string, source: string) => { w.runtimeWrite(path, source); return b.save(path, 0); };

  const notes = await save('tools/level1_layout.py', '# Level 1 Layout\n\n- Top row is blocked\n- Path bends left\n');
  assert.match(notes!, /NOT loaded/);
  assert.match(notes!, /looks like Markdown\/notes, not executable Python/);
  assert.match(notes!, /memory\/ or prompts\//);
  assert.match(notes!, /no active version/);

  const syntax = await save('tools/broken.py', 'def run(state, args):\n    return (\n');
  assert.match(syntax!, /NOT loaded/);
  assert.match(syntax!, /Python SyntaxError at line 2/);

  const valid = await save('tools/ok_tool.py', 'def run(state, args):\n    return args\n');
  assert.match(valid!, /saved · loaded/);
  b.boundary();
  assert.deepEqual(b.active().map(component => component.path), ['tools/ok_tool.py']);
});

test('binder versions writes, labels failed fallback, activates next boundary and recovers retirement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'binder-')); const w = new Workspace(root);
  let b = new Binder(w); const save = async (path: string, content: string) => { w.runtimeWrite(path, content); return b.save(path, 0); };
  assert.match(await save('prompts/p.md', '---\nactive: true\n---\nKEEP_HYPOTHESIS'), /v1.*saved.*loaded.*next decision/);
  assert.equal(b.active().length, 0);
  b.boundary(); assert.equal(b.active()[0].version, 1);
  assert.match(await save('prompts/p.md', 'missing header'), /v2.*NOT loaded.*v1 still runs/);
  b.boundary(); assert.match(b.label('prompts/p.md'), /v1 \(v2 failed\)/);
  b = new Binder(w); await b.scan(0); b.boundary(); assert.equal(b.active()[0].source.includes('KEEP_HYPOTHESIS'), true);
  assert.match(b.index(1), /stale/);
  await save('prompts/p.md', '---\nactive: false\n---\nDISABLED'); b.boundary(); assert.equal(b.active().length, 0);
  assert.match(b.index(0), /off/);
  await save('prompts/p.md', '---\nactive: true\n---\nFIXED'); b.boundary(); assert.equal(b.active()[0].version, 4);
  rmSync(w.path('prompts/p.md')); await b.scan(0); b.boundary(); assert.equal(b.active().length, 0);
  b = new Binder(w); await b.scan(0); b.boundary(); assert.equal(b.active().length, 0);
  for (let n = 0; n < 40; n++) await save(`notes/n${n}.md`, `note ${n}`);
  assert.ok(b.index(0).length <= 1200);
});

test('overlapping saves retain write order and distinct receipts', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-order-')));
  let release!: () => void;
  const blocked = new Promise<void>(done => { release = done; });
  const b = new Binder(w, async (path, source) => {
    if (source === 'first') await blocked;
    return { kind: 'tool', name: 'ordered', description: source, enabled: true };
  });
  w.runtimeWrite('tools/ordered.py', 'first'); const first = b.save('tools/ordered.py', 0);
  w.runtimeWrite('tools/ordered.py', 'second'); const second = b.save('tools/ordered.py', 0);
  release();
  assert.match((await first)!, /v1/); assert.match((await second)!, /v2/);
  b.boundary(); assert.equal(b.active()[0].source, 'second');
});

test('ordinary workspace files are versioned without component activation or index noise', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-files-'))); const b = new Binder(w);
  w.runtimeWrite('artifacts/a.txt', 'first'); assert.equal(await b.save('artifacts/a.txt', 0), undefined);
  w.runtimeWrite('artifacts/a.txt', 'second'); await b.save('artifacts/a.txt', 0);
  b.boundary(); assert.equal(b.active().length, 0); assert.equal(b.versionMap()['artifacts/a.txt'], 2);
  assert.equal(b.index(0), '');
});

test('process prompts bind in their own section namespace and reject collisions', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-process-'))); const b = new Binder(w);
  w.runtimeWrite('prompts/process/reuse.md', '---\nactive: true\n---\nEXPECT within 2 actions: reuse an existing capability');
  assert.match(await b.save('prompts/process/reuse.md', 0, { by: 'agent', decision: 4 })!, /saved.*loaded/);
  assert.deepEqual(b.originOf('prompts/process/reuse.md'), { by: 'agent', decision: 4 });
  b.boundary();
  assert.equal(b.active()[0].name, 'process_reuse');

  w.runtimeWrite('prompts/process_reuse.md', '---\nactive: true\n---\nconflicting section');
  assert.match(await b.save('prompts/process_reuse.md', 0)!, /NOT loaded.*section name collision/);
  b.boundary();
  assert.deepEqual(b.active().map(c => c.path), ['prompts/process/reuse.md']);
});
