import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { validatePythonComponent, type CellDef } from '../demo/arc_thin_components.ts';
import { MAX_SCRIPTS, SCRIPT_MARK, planScripts, scriptSource, scriptsUsed } from '../demo/arc_thin_scripts.ts';

// docs/plans/2026-10-21-components-by-default-canonical-forms.md, S2 (ARC_THIN_PERSIST_DEFS=1): the functions a python cell
// defines at its top level are saved as lib/<name>.py by the runtime, through the binder's own save.

const def = (name: string, extra: Partial<CellDef> = {}): CellDef => ({ name, source: `def ${name}(a):\n    return a\n`, sig: '(a)', doc: '', comment: '',
  imports: [], deps: [], needs: [], decorated: false, asynchronous: false, assigns_global: false, ...extra });

test('a function is saved as a script only when everything it uses is built in, an import or a script; each other one is skipped with its reason', () => {
  const files: Record<string, string> = {};
  const known = (count = 0) => ({ source: (name: string) => files[name], count });
  const hyp = def('hyp', { doc: 'length of the hypotenuse', imports: ['import math'], source: 'def hyp(a, b):\n    return math.sqrt(a * a + b * b)\n', sig: '(a, b)' });
  const plan = planScripts([hyp, def('norm', { deps: ['hyp'] }), def('shifted', { needs: ['OFFSET'] }), def('wrap', { deps: ['shifted'] }),
    def('Camel'), def('wrapped', { decorated: true }), def('lazy', { asynchronous: true }), def('count', { assigns_global: true })], known());
  assert.deepEqual(plan.write.map((w) => w.path), ['lib/hyp.py', 'lib/norm.py']);
  assert.equal(plan.write[0].content, '# length of the hypotenuse\n' + SCRIPT_MARK + '\nimport math\n\ndef hyp(a, b):\n    return math.sqrt(a * a + b * b)\n');
  assert.match(plan.write[1].content, /^# norm\(a\)\n[^\n]+\nfrom lib\.hyp import hyp\n\ndef norm\(a\):/, 'a function of this cell that it calls is imported; no description falls back to name and parameters');
  assert.deepEqual(plan.skipped.map((s) => s.name), ['shifted', 'wrap', 'Camel', 'wrapped', 'lazy', 'count']);
  assert.match(plan.skipped[0].why, /uses OFFSET, defined outside it \(define it inside, or pass it in\)/);
  assert.match(plan.skipped[1].why, /calls shifted, which is not saved as a script/);
  // The runtime's own file again is left alone; the agent's own file is never replaced; a cycle with an existing script is refused.
  files.hyp = scriptSource(hyp); files.mine = '# mine\ndef mine():\n    return 1\n'; files.back = 'from lib.top import top\ndef back():\n    return top()\n';
  const again = planScripts([hyp, def('mine'), def('top', { deps: ['back'] })], known());
  assert.deepEqual([again.write, again.unchanged], [[], ['hyp']]);
  assert.deepEqual(again.skipped.map((s) => [s.name, s.why.replace(/lib\/\w+\.py/, 'lib/X.py')]),
    [['mine', 'lib/X.py is your own file and is not replaced'], ['top', 'lib/X.py already imports it, so each would import the other']]);
  // A new script past the limit stays in the session; one that is already a script can still change.
  const full = planScripts([def('fresh'), def('hyp', { doc: 'changed' })], known(MAX_SCRIPTS));
  assert.deepEqual([full.write.map((w) => w.name), full.skipped.map((s) => s.name)], [['hyp'], ['fresh']]);
});

test('a cell that imports a script or uses it by the name its session holds is adoption; only scripts count', () => {
  const scripts = new Set(['norm', 'hyp', 'snap']);
  assert.deepEqual(scriptsUsed('from lib.norm import norm\nimport lib.hyp\nfrom lib import snap, other\nprint(os)', ['hyp', 'plain', 'snap'], scripts),
    { imported: ['hyp', 'norm', 'snap'], named: [] });
  assert.deepEqual(scriptsUsed('print(hyp(3, 4))', ['hyp', 'plain'], scripts), { imported: [], named: ['hyp'] });
});

/** A native runtime on a real sandbox, with the binder validating python as in a run; `persist` is ARC_THIN_PERSIST_DEFS. */
function world(persist: boolean) {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'scripts-')));
  const binder = new Binder(workspace, validatePythonComponent, { scripts: persist });
  const logs: any[] = [];
  let n = 0;
  const runtime = new NativeRuntime({ pi: { registerTool() {}, setActiveTools() {}, getActiveTools: () => [] } as any, workspace, binder, state: () => ({ grid: [[1, 2], [3, 4]] }),
    level: () => 0, actionCount: () => n, log(file, row) { logs.push({ file, ...row }); }, usage() {}, wrap: (_name, fn) => fn, persistDefs: persist });
  return { workspace, binder, logs, runtime,
    /** One python cell; the binder binds what the cell saved, as the next request would. */
    async cell(code: string) { binder.boundary(); const text = (await runtime.python(code)).content[0].text; binder.boundary(); return text; },
    rows: (kind: string) => logs.filter((row) => row.file === 'component_runs.jsonl' && row.kind === kind),
    file: (path: string) => (existsSync(join(workspace.root, path)) ? readFileSync(join(workspace.root, path), 'utf8') : undefined) };
}

const FIRST = 'import math\nOFFSET = 3\ndef hyp(a, b):\n    """length of the hypotenuse"""\n    return math.sqrt(a * a + b * b)\ndef norm(a, b):\n    return hyp(a, b) / 2\ndef shifted(x):\n    return x + OFFSET\n';

test('a cell with two functions saves two scripts through the binder; the one that needs a value of the session stays in it, and is told why', async () => {
  const w = world(true);
  try {
    const text = await w.cell(FIRST);
    assert.match(text, /\(saved as scripts: lib\/hyp\.py v1, lib\/norm\.py v1; import lib\.<name> in a later cell or in saved code\)/);
    assert.match(text, /\(not saved as scripts: shifted, it uses OFFSET, defined outside it \(define it inside, or pass it in\)\)/);
    assert.equal(w.file('lib/hyp.py'), '# length of the hypotenuse\n' + SCRIPT_MARK + '\nimport math\n\ndef hyp(a, b):\n    """length of the hypotenuse"""\n    return math.sqrt(a * a + b * b)\n');
    assert.match(w.file('lib/norm.py')!, /\nfrom lib\.hyp import hyp\n\ndef norm\(a, b\):/);
    assert.equal(w.file('lib/shifted.py'), undefined);
    assert.deepEqual([w.binder.versionMap()['lib/hyp.py'], w.binder.versionMap()['lib/norm.py']], [1, 1]);
    assert.equal(w.binder.active().find((c) => c.path === 'lib/hyp.py')?.description, 'length of the hypotenuse', 'the docstring is the description');
    assert.deepEqual(w.rows('save').map((row) => [row.path, row.ok]), [['lib/hyp.py', true], ['lib/norm.py', true]]);
    assert.deepEqual(w.rows('persist').map((row) => [row.saved, row.skipped.length]), [[['lib/hyp.py v1', 'lib/norm.py v1'], 1]]);
    // The same functions again, in a cell that runs (an identical cell is answered from the last result without running):
    // the same files, the same refusal, so nothing is saved and nothing is said twice; the redefinition is logged as unchanged.
    const again = await w.cell(FIRST + 'print("again")\n');
    assert.match(again, /\bagain\b/);
    assert.doesNotMatch(again, /saved as scripts|not saved as scripts/);
    assert.equal(w.rows('save').length, 2);
    assert.deepEqual(w.rows('persist').map((row) => [row.saved, row.unchanged, row.skipped.length]), [[['lib/hyp.py v1', 'lib/norm.py v1'], [], 1], [[], ['hyp', 'norm'], 0]]);
  } finally { w.runtime.close(); }
});

test('a later cell that imports a saved script, or calls one by its name, is logged as using it; the saved module runs on its own', async () => {
  const w = world(true);
  try {
    await w.cell(FIRST);
    const text = await w.cell('from lib.norm import norm\nprint(norm(3, 4))\nprint(hyp(6, 8))');
    assert.match(text, /\n2\.5\n10\.0\n/, 'norm ran from its module, which imports hyp from its own');
    assert.deepEqual(w.rows('import').map((row) => [row.imported, row.named]), [[['norm'], ['hyp']]]);
    // A cell that defines and calls a function in the same breath is not adoption of what was saved.
    await w.cell('def twice(x):\n    return 2 * x\nprint(twice(2))');
    assert.equal(w.rows('import').length, 1);
  } finally { w.runtime.close(); }
});

test('a function defined again with other code is a new version of its script, the same code again is not, and a file of the agent\'s own is kept', async () => {
  const w = world(true);
  try {
    await w.cell('def snap(g):\n    return [r[:] for r in g]\n');
    const same = await w.cell('def snap(g):\n    return [r[:] for r in g]\nprint("ran")\n');
    assert.match(same, /\bran\b/, 'the cell ran');
    assert.doesNotMatch(same, /saved as scripts/);
    assert.equal(w.binder.versionMap()['lib/snap.py'], 1);
    assert.equal(w.rows('save').length, 1, 'the second definition was the same file');
    assert.match(await w.cell('def snap(g):\n    return [list(r) for r in g]\n'), /saved as scripts: lib\/snap\.py v2/);
    assert.equal(w.binder.versionMap()['lib/snap.py'], 2);
    w.workspace.mutate({ op: 'write', path: 'lib/mine.py', content: '# my helper\ndef mine():\n    return 1\n' });
    await w.binder.save('lib/mine.py', 0);
    assert.match(await w.cell('def mine():\n    return 2\n'), /not saved as scripts: mine, lib\/mine\.py is your own file and is not replaced/);
    assert.equal(w.file('lib/mine.py'), '# my helper\ndef mine():\n    return 1\n');
  } finally { w.runtime.close(); }
});

test('flag off: a cell with functions saves nothing, says nothing and logs nothing about scripts', async () => {
  const w = world(false);
  try {
    const text = await w.cell(FIRST);
    assert.doesNotMatch(text, /scripts/);
    assert.deepEqual(w.workspace.files().filter((path) => path.startsWith('lib/')), []);
    assert.deepEqual([w.rows('persist').length, w.rows('import').length, w.rows('save').length], [0, 0, 0]);
  } finally { w.runtime.close(); }
});

test('the HARNESS index lists scripts by name, parameters and description, eight in full and the rest by name; a script used on this level is not stale', async () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'scripts-index-')));
  const make = (scripts: boolean) => new Binder(workspace, async (path, source) => ({ kind: 'library', name: path.slice(4, -3), description: source.split('\n')[0].slice(2), enabled: true }), { scripts });
  const on = make(true);
  for (let i = 1; i <= 10; i++) { workspace.runtimeWrite(`lib/s${i}.py`, `# does thing ${i}\ndef s${i}(a, b=2):\n    return a\n`); await on.save(`lib/s${i}.py`, 0); }
  on.boundary();
  const text = on.index(0);
  assert.match(text, /^HARNESS \(your prompts, tools, scripts, skills and subagents; memory is indexed above\)\nscript s1\(a, b=2\) v1 active: does thing 1 · import lib\.s1\n/);
  assert.equal(text.split('\n').filter((line) => line.startsWith('script ')).length, 8);
  assert.match(text, /\n2 more scripts \(import lib\.<name>\): s8, s9$/, 'in path order, as the rest of the index');
  assert.match(on.index(1), /script s1\(a, b=2\) v1 stale:/, 'saved on an earlier level');
  assert.match(on.index(1, new Set(), new Map(), new Set(['lib/s1.py'])), /script s1\(a, b=2\) v1 active:/, 'imported on this level');
  // Without the option libraries stay out of the index, as before.
  const off = make(false); await off.scan(0); off.boundary();
  assert.equal(off.index(0), '');
});
