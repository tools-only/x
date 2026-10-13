import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePythonComponent, executeNative } from '../demo/arc_thin_components.ts';

const ARGS = { type: 'object', properties: { args: { type: 'object' } }, additionalProperties: false };

test('every tool has one args contract and executes exact injected sources in isolated fresh WASI', async () => {
  const source = '"""Compare measured values."""\ndef run(x: int, bias: int = 2):\n    from lib.offset import plus\n    return plus(x, bias)\n';
  const spec = await validatePythonComponent('tools/compare.py', source);
  assert.deepEqual(spec.parameters, ARGS);
  assert.equal(spec.kind, 'tool');
  assert.equal(spec.view, false);
  const sources = { 'tools/compare.py': source, 'lib/offset.py': 'def plus(x, y):\n    return x + y\n' };
  const output = await executeNative({ mode: 'call', path: 'tools/compare.py', args: { args: { x: 40 } }, sources, state: {} });
  assert.deepEqual(output, { ok: true, value: 42 });
  // No annotation is needed: the 2026-10-13 run lost saves to "run(args) needs an annotation".
  assert.deepEqual((await validatePythonComponent('tools/plain.py', 'def run(args):\n    return args\n')).parameters, ARGS);
  await assert.rejects(validatePythonComponent('tools/bad.py', 'def run(x: str)\n    return x\n'), /SyntaxError.*line 1/);
  await assert.rejects(validatePythonComponent('tools/python.py', 'def run(args):\n    return 1\n'), /reserved/);
  assert.equal((await validatePythonComponent('lib/offset.py', sources['lib/offset.py'])).kind, 'library');
  const blocked = await executeNative({ mode: 'exec', code: "open('../secret')", sources: {}, state: {}, files: {} });
  assert.equal(blocked.ok, false);
  const text = await executeNative({ mode: 'exec', code: "open('notes/a.md').read()", sources: {}, state: {}, files: { 'notes/a.md': 'EXACT' } });
  assert.deepEqual(text.value, { stdout: '', value: 'EXACT', has_value: true });
});

test('tool forms: script, run(args), run(args, env), older run(state, args) and observe(state); a view is a marked tool', async () => {
  const state = { grid: [[7, 8]] };
  const call = (path: string, source: string, args: Record<string, unknown> = {}) =>
    executeNative({ mode: 'call', path, args: { args }, sources: { [path]: source }, state });
  assert.equal(((await call('tools/s.py', '# Script.\ngrid[0][1] + args.get("bias", 0)', { bias: 2 })).value as any).value, 10);
  assert.equal((await call('tools/a.py', 'def run(args):\n    return args["k"] * 2\n', { k: 4 })).value, 8);
  assert.equal((await call('tools/e.py', 'def run(args, env):\n    return env.grid[0][0] + args.get("k", 0)\n', { k: 1 })).value, 8);
  assert.equal((await call('tools/o.py', 'def run(state, args):\n    return state["grid"][0][1] + args["k"]\n', { k: 1 })).value, 9);
  assert.equal((await call('observers/p.py', 'def observe(state):\n    return state["grid"][0][0]\n')).value, 7);
  assert.equal((await validatePythonComponent('tools/v.py', '# Positions.\n# view: on\ngrid[0]\n')).view, true);
  assert.equal((await validatePythonComponent('tools/v.py', '# Positions.\n# view: off\ngrid[0]\n')).view, false);
  assert.equal((await validatePythonComponent('observers/p.py', 'def observe(state):\n    return 1\n')).view, true);
  const off = await validatePythonComponent('observers/p.py', '# observe: off\ndef observe(state):\n    return 1\n');
  assert.equal(off.enabled, false);
});

test('env.act is a closed loop by replay: each new act() is requested, recorded observations are returned in order', async () => {
  const code = 'seen = []\nfor a in ("ACTION1", "ACTION4", "ACTION1"):\n    obs = env.act(a, predict={"level_changed": False})\n' +
    '    seen.append(obs["changed_cells"])\n    if obs["changed_cells"] == 0: break\nseen';
  const run = (acts: any[], allow_act = true) => executeNative({ mode: 'exec', code, sources: {}, state: { grid: [[0]] }, files: {}, acts, allow_act });
  const refused = await run([], false);
  assert.match(String(refused.error), /only saved code acts/);
  const first = await run([]);
  assert.deepEqual(first.need_act, { action: 'ACTION1', predict: { level_changed: false } });
  const one = { call: first.need_act, observation: { grid: ['0f'], changed_cells: 3 } };
  const second = await run([one]);
  assert.deepEqual(second.need_act, { action: 'ACTION4', predict: { level_changed: false } });
  // The code stops itself when nothing changed: two actions, not three.
  const done = await run([one, { call: second.need_act, observation: { grid: ['00'], changed_cells: 0 } }]);
  assert.deepEqual((done.value as any).value, [3, 0]);
  assert.equal(done.need_act, undefined);
  // A runtime stop ends the call with what was done; code that swallows it cannot ask again.
  const stopped = await run([one, { call: second.need_act, stopped: 'the level changed' }]);
  assert.deepEqual(stopped, { ok: true, value: { stopped: 'the level changed' } });
  const stubborn = 'n = 0\nfor _ in range(5):\n    try:\n        env.act("ACTION1")\n        n += 1\n    except Exception:\n        pass\nn';
  const swallowed = await executeNative({ mode: 'exec', code: stubborn, sources: {}, state: {}, files: {}, allow_act: true,
    acts: [{ call: { action: 'ACTION1' }, stopped: 'state GAME_OVER' }] });
  assert.equal((swallowed.value as any).value, 0);
  assert.equal(swallowed.need_act, undefined);
  // The observation's grid comes back as integers, and env.grid follows it.
  const grid = await executeNative({ mode: 'exec', code: 'o = env.act("ACTION1", 3, 4)\n[o["grid"], env.grid]', sources: {}, state: {}, files: {},
    allow_act: true, acts: [{ call: { action: 'ACTION1', x: 3, y: 4 }, observation: { grid: ['0f', 'a1'] } }] });
  assert.deepEqual((grid.value as any).value, [[[0, 15], [10, 1]], [[0, 15], [10, 1]]]);
  // A replay that diverges from the recorded calls is an error, not a silent wrong action.
  const diverged = await executeNative({ mode: 'exec', code: 'env.act("ACTION2")', sources: {}, state: {}, files: {}, allow_act: true,
    acts: [{ call: { action: 'ACTION1' }, observation: {} }] });
  assert.match(String(diverged.error), /must repeat the same act\(\) calls/);
});

test('python session: what a call defines is returned and restored in the next call, which shares one namespace', async () => {
  const run = (code: string, session: any) => executeNative({ mode: 'exec', code, sources: {}, state: { grid: [[1, 2], [3, 4]] }, files: {}, session });
  const first: any = await run('import math\nfrom collections import Counter\ndef cell(x, y):\n    return grid[y][x] + k\nk = 10\nseen = {"a": (1, 2)}\nblob = set([1])\n_hidden = 1\ncell(1, 0)', {});
  assert.equal(first.value.value, 12);
  assert.deepEqual(Object.keys(first.session.defs), ['import: import math', 'import: from collections import Counter', 'cell']);
  assert.deepEqual(first.session.vars, { k: 10, seen: { a: [1, 2] } });
  assert.deepEqual(first.session.dropped, ['blob']);
  // The next call: the function sees a value defined in this call and the restored k; imports are back.
  const second: any = await run('k = 20\n[cell(0, 1), math.floor(2.5), Counter("aa")["a"]]', first.session);
  assert.deepEqual(second.value.value, [23, 2, 2]);
  assert.deepEqual(second.session.vars, { k: 20 });
  // A definition that no longer runs is reported and dropped by the host.
  const broken: any = await run('1', { defs: { bad: 'raise ValueError("x")' }, vars: {} });
  assert.deepEqual(broken.session.failed, ['bad']);
  // Without a session nothing is returned (saved tools, the legacy path).
  assert.equal((await executeNative({ mode: 'exec', code: 'k = 1', sources: {}, state: {}, files: {} }) as any).session, undefined);
});

test('a view cannot act', async () => {
  await assert.rejects(validatePythonComponent('tools/loop.py', '# view: on\nenv.act("ACTION1")\n'), /a view runs after every new state and cannot act/);
});

test('env.restore asks the host for an earlier version; read-only executions cannot', async () => {
  const ok = await executeNative({ mode: 'exec', code: 'env.restore("tools/route.py", 2)', sources: {}, state: {}, files: {}, allow_writes: true });
  assert.deepEqual(ok.ops, [{ op: 'restore', path: 'tools/route.py', version: 2 }]);
  const refused = await executeNative({ mode: 'exec', code: 'env.restore("tools/route.py", 2)', sources: {}, state: {}, files: {} });
  assert.match(String(refused.error), /read-only/);
});
