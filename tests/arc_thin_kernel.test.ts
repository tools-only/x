import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent, type ActCall } from '../demo/arc_thin_components.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';

const make = (options: { sessionDir?: string; logs?: any[]; played?: ActCall[]; pythonKernel?: boolean; remembered?: unknown[] } = {}) => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'kernel-')));
  const tools = { active: ['python', 'arc_action'] };
  const runtime = new NativeRuntime({
    pi: { registerTool() {}, getActiveTools: () => tools.active, setActiveTools: (names: string[]) => { tools.active = names; } } as any,
    workspace, binder: new Binder(workspace, validatePythonComponent), state: () => ({ grid: [[7, 8]] }), level: () => 0,
    actionCount: () => options.played?.length ?? 0, log(file: string, row: any) { options.logs?.push({ file, ...row }); }, usage() {},
    wrap: (_name, fn) => fn, receipt: body => workspace.receipt(body), ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
    ...(options.pythonKernel === false ? { pythonKernel: false } : {}),
    ...(options.remembered ? { remember: async (args: any) => {
      if (!args?.key) throw Error('a memory entry needs a key');
      options.remembered!.push(args); return `set ${args.key}`;
    } } : {}),
    act: async (call) => {
      options.played?.push(call);
      const n = options.played?.length ?? 0;
      return { line: `#${n} ${call.action} → changed`, observation: { n, grid: ['78'], changed_cells: 3, level_changed: false, missed: false } };
    },
  });
  return { workspace, runtime };
};
const out = (result: any) => result.content[0].text as string;

test('the live kernel keeps what a checkpoint cannot, runs acting code once, reads files mid-cell and keeps the final value as _', async () => {
  const played: ActCall[] = [];
  const logs: any[] = [];
  const { workspace, runtime } = make({ played, logs });
  try {
    const first = out(await runtime.python('square = lambda v: v * v\ngen = (i for i in range(3))\ncalls = []\nk = 2'));
    assert.match(first, /\(python session: \+calls, \+gen, \+k, \+square\)/);
    assert.match(first, /defined, but not in the checkpoint, so a kernel restart loses them: square \(function: <lambda>.*gen \(generator/);
    // Said once: the next call, which keeps them, does not repeat it.
    const second = out(await runtime.python('[square(k), next(gen), next(gen)]'));
    assert.match(second, /→ \[4,0,1\]/);
    assert.doesNotMatch(second, /not in the checkpoint/);
    // Code before env.act runs once, so it may be random; the cell continues where it acted.
    const acting: any = await runtime.python('import random\nfor a in ("ACTION1", "ACTION4"):\n    calls.append(random.random())\n    obs = env.act(a)\n' +
      '    assert obs["changed_cells"] == 3\n[len(calls), env.grid]');
    assert.match(out(acting), /→ \[2,\[\[7,8\]\]\]/);
    assert.match(out(acting), /ACTED 2 action\(s\)\. This decision ends\.\n#1 ACTION1 → changed\n#2 ACTION4 → changed/);
    assert.equal(acting.terminate, true);
    assert.deepEqual(played.map(call => call.action), ['ACTION1', 'ACTION4']);
    // A file the code names only at run time is fetched while the cell waits.
    workspace.runtimeWrite('notes/x.md', 'EXACT_DYNAMIC_READ');
    assert.match(out(await runtime.python("p = 'notes/' + 'x.md'\nopen(p).read()")), /EXACT_DYNAMIC_READ/);
    // The final value stays as _, also when the result shown is shortened.
    assert.match(out(await runtime.python('list(range(5))')), /→ \[0,1,2,3,4\]/);
    assert.match(out(await runtime.python('_[-1] + k')), /→ 6/);
    const long = out(await runtime.python('[[i] * 40 for i in range(400)]'));
    assert.match(long, /the whole final value is _ in the python session/);
    assert.match(out(await runtime.python('len(_)')), /→ 400/);
    // What the session holds, for the working set.
    const view = runtime.sessionView();
    assert.match(view, /^PYTHON SESSION \(/);
    for (const held of ['square function', 'gen generator', 'calls list[2]', 'k 2', "p 'notes/x.md'", 'random module'])
      assert.ok(view.includes(held), `${held} in ${view}`);
    const runs = logs.filter(row => row.file === 'wasi_runs.jsonl');
    assert.ok(runs.every(row => row.mode === 'kernel'));
    assert.ok(runs.slice(1).every(row => !row.fresh), 'one kernel served every call');
    assert.equal(runs.find(row => row.acts === 2)?.files_fetched, 0);
  } finally { runtime.close(); }
});

test('one cell writes memory and a file and acts: one call, with every receipt', async () => {
  const played: ActCall[] = [];
  const remembered: unknown[] = [];
  const { workspace, runtime } = make({ played, remembered });
  try {
    const result: any = await runtime.python("env.remember(op='set', key='rule', text='ACTION1 moves up')\n" +
      "env.remember(op='set', text='no key')\n" +
      "with open('prompts/strategy.md', 'w') as f: f.write('next: go up')\n" +
      "env.act('ACTION1')\n'done'");
    const shown = out(result);
    assert.match(shown, /memory: set rule/);
    assert.match(shown, /memory refused: a memory entry needs a key/);
    assert.match(shown, /ACTED 1 action\(s\)\. This decision ends\./);
    assert.equal(result.terminate, true);
    assert.deepEqual(remembered, [{ op: 'set', key: 'rule', text: 'ACTION1 moves up' }]);
    assert.equal(workspace.read('prompts/strategy.md'), 'next: go up');
    assert.deepEqual(played.map(call => call.action), ['ACTION1']);
  } finally { runtime.close(); }
  // Read-only code (a subagent's python) cannot write memory.
  const quiet = make({ remembered: [] });
  try {
    assert.match(out(await quiet.runtime.python("env.remember(op='set', key='x', text='y')", undefined, true)), /PermissionError: memory is read-only/);
  } finally { quiet.runtime.close(); }
});

test('an interrupted cell ends the kernel; the next call starts a new one from the checkpoint and says so', async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'kernel-session-'));
  const { runtime } = make({ sessionDir });
  try {
    await runtime.python('kept = [1, 2]\nlive_only = lambda: 1');
    const stuck = out(await runtime.python('while True: pass', AbortSignal.timeout(5000)));
    assert.match(stuck, /the python kernel ended: the cell was interrupted/);
    assert.match(stuck, /the next python call starts a new kernel with the session as checkpointed: v1: kept/);
    assert.doesNotMatch(runtime.sessionView(), /live_only/);
    const after = out(await runtime.python('[kept, "live_only" in globals()]'));
    assert.match(after, /new python kernel: the previous one ended \(the cell was interrupted\); the session was restored from its checkpoint v1/);
    assert.match(after, /→ \[\[1,2\],false\]/);
  } finally { runtime.close(); }
  // A restart of the run brings the same checkpoint back.
  const again = make({ sessionDir });
  try { assert.match(out(await again.runtime.python('kept')), /→ \[1,2\]/); } finally { again.runtime.close(); }
});

test('over the checkpoint limit a live session keeps everything defined and says what a restart would lose', async () => {
  const { runtime } = make();
  try {
    const over = out(await runtime.python('import random\nhuge = [random.random() for _ in range(30000)]'));
    assert.match(over, /python session: everything is still defined, but its checkpoint is not written until it fits: it needs \d+ KB and the limit is 128 KB; largest: huge/);
    const next = out(await runtime.python('len(huge)'));
    assert.match(next, /→ 30000/);
    assert.doesNotMatch(next, /checkpoint is not written/);
    assert.match(out(await runtime.python('del huge\nsmall = 1')), /\(python session: \+small, -huge\)/);
  } finally { runtime.close(); }
});

test('without the kernel each call is a fresh sandbox restored from the checkpoint, and acting code is replayed', async () => {
  const played: ActCall[] = [];
  const logs: any[] = [];
  const { runtime } = make({ played, logs, pythonKernel: false });
  try {
    assert.match(out(await runtime.python('square = lambda v: v * v\nk = 2')), /not kept in the python session: square/);
    assert.match(out(await runtime.python('["square" in globals(), k]')), /→ \[false,2\]/);
    await runtime.python('for a in ("ACTION1", "ACTION4"):\n    env.act(a)');
    assert.equal(played.length, 2);
    assert.ok(logs.filter(row => row.file === 'wasi_runs.jsonl').every(row => row.mode === 'exec'));
    assert.equal(logs.filter(row => row.file === 'wasi_runs.jsonl').at(-1).lazy_restarts, 2);
  } finally { runtime.close(); }
});
