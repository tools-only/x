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
  assert.match(String(refused.error), /no action capability/);
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

test('env.act with a list plays it as one batch, as Continual Harness skills call take_actions, and stops at a level change', async () => {
  const code = 'r = env.act([{"name": "action1"}, {"name": "ACTION6", "x": 70, "y": "2"}, {"name": "ACTION1"}])\n' +
    '[r["executed_count"], r["level_changed"], r["terminal"], r["score"], r["last_frame"]["frame"]]';
  const run = (acts: any[]) => executeNative({ mode: 'exec', code, sources: {}, files: {}, acts, allow_act: true,
    state: { grid: [[0]], state: 'NOT_FINISHED', levels_completed: 0 } });
  const first = await run([]);
  assert.deepEqual(first.need_act, { action: 'ACTION1', batch: [1, 3] });
  const one = { call: first.need_act, observation: { grid: ['0'], state: 'NOT_FINISHED', levels_completed: 0 } };
  const second = await run([one]);
  assert.deepEqual(second.need_act, { action: 'ACTION6', batch: [2, 3], x: 63, y: 2 }, 'coordinates clamped as CH clamps them');
  const done = await run([one, { call: second.need_act, observation: { grid: ['1'], state: 'NOT_FINISHED', levels_completed: 1 } }]);
  assert.deepEqual((done.value as any).value, [2, true, false, 1, [[[1]]]], 'the third entry is not played after the level changed');
  const missed = await run([one, { call: second.need_act, observation: { grid: ['1'], state: 'NOT_FINISHED', levels_completed: 0, missed: true } }]);
  assert.equal((missed.value as any).value[0], 2, 'a missed prediction ends the list, as in an arc_action list');
  const none = await executeNative({ mode: 'exec', code: 'env.act([{"x": 1}])', sources: {}, state: {}, files: {}, allow_act: true, acts: [] });
  assert.match(String((none.value as any)?.stopped), /take_actions executed no actions/);
  // One entry given alone plays as that action (su15-ch-q38-1 lost an action to env.act({...}), 2026-10-20).
  const entry = await executeNative({ mode: 'exec', code: 'env.act({"name": "ACTION6", "x": 20, "y": 43})', sources: {}, state: {}, files: {},
    allow_act: true, acts: [] });
  assert.deepEqual(entry.need_act, { action: 'ACTION6', x: 20, y: 43 });
});

// The python session protocol: a call receives the last checkpoint and reports the next one.
const NO_SESSION = { defs: [], blob: '', sha: '', cap: 128_000 };
const STATE = { grid: [[1, 2], [3, 4]], history: { transitions: [], base_n: 0, base_grid: [[1, 2], [3, 4]], deltas: {} } };
const sessionRun = (code: string, session: any, extra: Record<string, unknown> = {}): Promise<any> =>
  executeNative({ mode: 'exec', code, sources: {}, state: STATE, files: {}, session, ...extra });
const carry = (previous: any, result: any) => result.session.blob === undefined ? previous
  : { defs: result.session.defs, blob: result.session.blob, sha: result.session.sha, cap: previous.cap };

test('python session keeps types, shared references, in-place changes and deletions without any save step', async () => {
  const first = await sessionRun('from collections import Counter, deque\nimport math\npair = (1, 2)\nseen = {3, 4}\ntable = {(0, 1): "a", 2: "b"}\n' +
    'counts = Counter("aab")\nqueue = deque([1, 2], maxlen=5)\nraw = b"ab"\nshared = [1]\nbox = {"x": shared, "y": shared}\ntmp = 5\n_hidden = 1', NO_SESSION);
  assert.equal(first.ok, true);
  assert.deepEqual(first.session.names, ['Counter', 'box', 'counts', 'deque', 'math', 'pair', 'queue', 'raw', 'seen', 'shared', 'table', 'tmp']);
  assert.deepEqual(first.session.unsupported, []);
  assert.ok(first.session.chars > 0 && first.session.chars < 2000);
  // No assignment in this call: a list is appended to, a set added to, a name deleted.
  const s1 = carry(NO_SESSION, first);
  const second = await sessionRun('shared.append(2)\nseen.add(5)\ndel tmp\n[type(pair).__name__, sorted(seen), table[(0, 1)], counts["a"], queue.maxlen, ' +
    'raw.decode(), box["x"] is shared, box["y"], math.floor(2.5), "tmp" in globals()]', s1);
  assert.deepEqual(second.value.value, ['tuple', [3, 4, 5], 'a', 2, 5, 'ab', true, [1, 2], 2, false]);
  assert.equal(second.session.names.includes('tmp'), false);
  const third = await sessionRun('[shared, sorted(seen), "tmp" in globals(), box["x"] is box["y"], "_hidden" in globals()]', carry(s1, second));
  assert.deepEqual(third.value.value, [[1, 2], [3, 4, 5], false, true, false]);
  // Without a session nothing is reported (saved tools, views, the legacy path).
  assert.equal((await executeNative({ mode: 'exec', code: 'k = 1', sources: {}, state: {}, files: {} }) as any).session, undefined);
});

test('python session re-runs def/class statements in place and names what cannot be kept, with the reason', async () => {
  const first = await sessionRun('class Point:\n    def __init__(self, x, y):\n        self.x, self.y = x, y\n    def moved(self, dx):\n        return Point(self.x + dx, self.y)\n' +
    'def step(p):\n    return p.moved(k)\nk = 2\nhome = Point(1, 1)\nalias = step\nsquare = lambda v: v * v\ngen = (i for i in range(3))\n' +
    'from collections import namedtuple\nPair = namedtuple("Pair", "x y")\npair = Pair(1, 2)', NO_SESSION);
  assert.deepEqual(first.session.defs.map(([name]: [string]) => name), ['Point', 'step']);
  assert.deepEqual(first.session.names, ['alias', 'home', 'k', 'namedtuple']);
  const why = Object.fromEntries(first.session.unsupported);
  assert.match(why.square, /^function: <lambda> is not defined by a def or class statement at the top level/);
  assert.match(why.gen, /^generator: cannot pickle 'generator' object/);
  assert.match(why.Pair, /^type: Pair is not defined by a def or class statement/);
  assert.match(why.pair, /^Pair: Pair is not defined by a def or class statement/);
  const s1 = carry(NO_SESSION, first);
  const second = await sessionRun('k = 5\nq = alias(home)\n[q.x, type(q).__name__, isinstance(home, Point), "square" in globals()]', s1);
  assert.deepEqual(second.value.value, [6, 'Point', true, false]);
  // A redefinition replaces the source where it stood. A value that still points at the earlier function cannot
  // be kept (it would silently become the new one) and is reported; deleting a function drops its definition.
  const s2 = carry(s1, second);
  const third = await sessionRun('def step(p):\n    return p.moved(k + 1)\nstep(home).x', s2);
  assert.equal(third.value.value, 7);
  assert.deepEqual(third.session.defs.map(([name]: [string]) => name), ['Point', 'step']);
  assert.match(third.session.defs[1][1], /k \+ 1/);
  assert.match(Object.fromEntries(third.session.unsupported).alias, /^function: it refers to an earlier step, which has been redefined or deleted/);
  const fourth = await sessionRun('del step\n"alias" in globals()', carry(s2, third));
  assert.equal(fourth.value.value, false);
  assert.deepEqual(fourth.session.defs.map(([name]: [string]) => name), ['Point']);
  // Names the code read from the session are listed, for the warning when it is saved as a tool.
  assert.deepEqual(second.session.uses, ['Point', 'alias', 'home']);
});

test('python session never stores runtime objects and never acts or writes while it is restored', async () => {
  const first = await sessionRun('h = history\ns = state\ne = env\ng = grid\nsnapshot = [row[:] for row in grid]', NO_SESSION);
  assert.deepEqual(first.session.unsupported, []);
  // A later state: runtime objects are the current ones; plain values are what they were.
  const later = { ...STATE, grid: [[9, 9], [9, 9]] };
  const second = await executeNative({ mode: 'exec', code: '[h is history, s is state, e is env, g, grid, snapshot]', sources: {}, state: later, files: {},
    session: carry(NO_SESSION, first) }) as any;
  assert.deepEqual(second.value.value, [true, true, true, [[1, 2], [3, 4]], [[9, 9], [9, 9]], [[1, 2], [3, 4]]]);
  // What ran before an error stays, as in a kernel; what did not run is not there.
  const failed = await sessionRun('a = 1\nb = undefined_name\nc = 3', NO_SESSION);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /NameError/);
  assert.deepEqual(failed.session.names, ['a']);
  // Restoring re-runs definitions only, and a definition that would act or write is refused and reported.
  const acting = await sessionRun('1', { ...NO_SESSION, defs: [['Bad', 'class Bad:\n    x = env.act("ACTION1")\n'],
    ['Writer', 'class Writer:\n    f = open("notes/x.md", "w"); f.write("a"); f.close()\n'], ['fine', 'def fine():\n    return 1\n']] },
    { allow_act: true, allow_writes: true, acts: [] });
  assert.equal(acting.need_act, undefined);
  assert.equal(acting.ops, undefined);
  assert.deepEqual(acting.session.failed_defs, [['Bad', 'PermissionError: no action while the python session is restored']]);
  assert.deepEqual(acting.session.defs.map(([name]: [string]) => name), ['Writer', 'fine']);
  // A checkpoint that does not load is reported as such, and the call does not offer a replacement for it.
  const broken = await sessionRun('z = 1', { ...NO_SESSION, blob: 'bm90IGEgcGlja2xl', sha: 'x' });
  assert.match(broken.session.load_error, /Error/);
  assert.equal(broken.session.blob, undefined);
});

test('python session over capacity is refused as a whole and says what is largest; an unchanged session sends nothing back', async () => {
  const tight = { ...NO_SESSION, cap: 300 };
  const over = await sessionRun('import random\nbig = [random.random() for _ in range(2000)]\nsmall = 1', tight);
  assert.equal(over.ok, true);
  assert.equal(over.session.blob, undefined);
  assert.equal(over.session.over.cap, 300);
  assert.ok(over.session.over.chars > 300);
  assert.equal(over.session.over.largest[0][0], 'big');
  const first = await sessionRun('k = [1, 2, 3]', NO_SESSION);
  const same = await sessionRun('len(k)', carry(NO_SESSION, first));
  assert.equal(same.session.unchanged, true);
  assert.equal(same.session.blob, undefined);
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
