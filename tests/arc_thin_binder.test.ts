import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';

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

test('components that run by themselves (views, predictors, guards) stop on a later level until saved again; prompts and callable tools stay', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-level-scope-')));
  const b = new Binder(w, async (path, source) => ({ kind: 'tool', name: path.split('/').at(-1)!, description: source,
    enabled: true, view: path.startsWith('observers/'), predictor: path === 'tools/predict.py', guard: path === 'tools/guard.py' }));
  w.runtimeWrite('observers/frame.py', 'view v1'); await b.save('observers/frame.py', 0);
  w.runtimeWrite('tools/predict.py', 'predictor v1'); await b.save('tools/predict.py', 0);
  w.runtimeWrite('tools/guard.py', 'guard v1'); await b.save('tools/guard.py', 0);
  w.runtimeWrite('tools/route.py', 'callable v1'); await b.save('tools/route.py', 0);
  w.runtimeWrite('prompts/p.md', '---\nactive: true\n---\nKEEP'); await b.save('prompts/p.md', 0);
  b.boundary(0);
  assert.deepEqual(b.active().map(c => c.path), ['observers/frame.py', 'prompts/p.md', 'tools/guard.py', 'tools/predict.py', 'tools/route.py']);
  b.boundary(1);
  assert.deepEqual(b.active().map(c => c.path), ['prompts/p.md', 'tools/route.py']);
  assert.deepEqual(b.candidates().map(c => c.path).sort(), ['prompts/p.md', 'tools/route.py']);
  assert.match(b.index(1), /frame\.py v1 stale, not running on this level \(save it again to run it\)/);
  assert.match(b.index(1), /predict\.py v1 stale, not running on this level/);
  assert.match(b.index(1), /guard\.py v1 stale, not running on this level[^\n]*guard, asked before each action is sent/);
  assert.match(b.index(1), /tool route\.py v1 stale: callable v1 · route\.py\(args\)/);
  assert.match(b.index(1), /prompt p v1 stale:/);
  w.runtimeWrite('observers/frame.py', 'view v2'); await b.save('observers/frame.py', 1);
  w.runtimeWrite('tools/predict.py', 'predictor v2'); await b.save('tools/predict.py', 1);
  b.boundary(1);
  assert.deepEqual(b.active().map(c => [c.path, c.version]),
    [['observers/frame.py', 2], ['prompts/p.md', 1], ['tools/predict.py', 2], ['tools/route.py', 1]]);
});

test('ordinary workspace files are versioned without component activation or index noise', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'binder-files-'))); const b = new Binder(w);
  w.runtimeWrite('artifacts/a.txt', 'first'); assert.equal(await b.save('artifacts/a.txt', 0), undefined);
  w.runtimeWrite('artifacts/a.txt', 'second'); await b.save('artifacts/a.txt', 0);
  b.boundary(); assert.equal(b.active().length, 0); assert.equal(b.versionMap()['artifacts/a.txt'], 2);
  assert.equal(b.index(0), '');
});
