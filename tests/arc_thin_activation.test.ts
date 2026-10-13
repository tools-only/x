import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent, type ActCall } from '../demo/arc_thin_components.ts';
import { MAX_ACTS, NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { PythonSession } from '../demo/arc_thin_python_session.ts';
import { parseRefinerReply, STRATEGY_CHARS } from '../demo/arc_thin_refiner.ts';
import { emptyMemory, applyRow, renderMemoryIndex } from '../demo/arc_thin_memory.ts';

type Played = { call: ActCall; via: string };
/** A host whose every second action changes nothing; `levelAt` makes that action change the level (the runtime then stops the call). */
const runtimeFor = (played: Played[], options: { levelAt?: number; quiet?: boolean; sessionDir?: string; logs?: any[] } = {}) => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'activation-')));
  const binder = new Binder(workspace, validatePythonComponent);
  const registered: string[] = [];
  const tools = { active: ['python', 'arc_action'] };
  let stopped: string | undefined;
  const runtime = new NativeRuntime({
    pi: { registerTool(t: any) { registered.push(t.name); }, getActiveTools: () => tools.active, setActiveTools: (names: string[]) => { tools.active = names; } } as any,
    workspace, binder, state: () => ({ grid: [[7, 8]] }), level: () => 0, actionCount: () => played.length,
    log(file: string, row: any) { options.logs?.push({ file, ...row }); }, usage() {},
    wrap: (_name, fn) => fn, ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
    act: async (call, via) => {
      if (stopped) return { stopped };
      played.push({ call, via });
      const n = played.length;
      const level = n === options.levelAt;
      if (level) stopped = 'the level changed';
      return { line: `#${n} ${call.action} → changed`, observation: { n, grid: ['78'], changed_cells: options.quiet || n % 2 ? 3 : 0, level_changed: level, missed: false } };
    },
  });
  return { workspace, binder, runtime, registered, tools };
};
const LOOP = '# Walk until nothing changes.\nseen = []\nfor a in ("ACTION1", "ACTION4", "ACTION1"):\n    obs = env.act(a)\n' +
  '    seen.append(obs["changed_cells"])\n    if obs["changed_cells"] == 0: break\n{"seen": seen, "bias": args.get("bias", 0)}';

test('saved code acts in a closed loop: python(save=) saves the code as a tool and runs it; unsaved code cannot act', async () => {
  const played: Played[] = [];
  const { workspace, binder, runtime, registered, tools } = runtimeFor(played);
  try {
    const unsaved: any = await runtime.python(LOOP);
    assert.equal(played.length, 0);
    assert.match(unsaved.content[0].text, /only saved code acts/);
    assert.notEqual(unsaved.terminate, true);
    const saved: any = await runtime.python(LOOP, undefined, false, 'walk');
    assert.match(saved.content[0].text, /tools\/walk\.py → tool walk v1: saved · loaded/);
    // The code saw the second observation (nothing changed) and stopped itself: two actions, not three.
    assert.match(saved.content[0].text, /"seen":\[3,0\]/);
    assert.match(saved.content[0].text, /ACTED 2 action\(s\)\. This decision ends\.\n#1 ACTION1 → changed\n#2 ACTION4 → changed/);
    assert.equal(saved.terminate, true);
    assert.deepEqual(played.map(p => [p.call.action, p.via]), [['ACTION1', 'tools/walk.py'], ['ACTION4', 'tools/walk.py']]);
    assert.equal(workspace.read('tools/walk.py').trim(), LOOP);
    assert.ok(registered.includes('walk') && tools.active.includes('walk'));
    // The saved tool takes a dict of arguments and is callable without a rewrite.
    binder.boundary();
    const component = binder.active().find(c => c.path === 'tools/walk.py')!;
    assert.deepEqual(component.parameters, { type: 'object', properties: { args: { type: 'object' } }, additionalProperties: false });
    assert.equal(component.description, 'Walk until nothing changes.');
    const called: any = await (runtime as any).call(component, { args: { bias: 2 } });
    assert.match(called.content[0].text, /"bias":2/);
    assert.equal(called.terminate, true);
    assert.equal(played.length, 4);
    // A read-only (subagent) call never acts.
    const readonly: any = await (runtime as any).call(component, { args: {} }, undefined, true);
    assert.match(readonly.content[0].text, /only saved code acts/);
    assert.equal(played.length, 4);
    await assert.rejects(runtime.python('1', undefined, false, 'Bad Name'), /save must be a lowercase name/);
  } finally { runtime.close(); }
});

test('the runtime ends an acting call at a level change and at the action limit; the actions taken stand', async () => {
  const forever = '# Press until stopped.\nn = 0\nwhile True:\n    env.act("ACTION1")\n    n += 1\n';
  const first: Played[] = [];
  const level = runtimeFor(first, { levelAt: 2, quiet: true });
  try {
    const result: any = await level.runtime.python(forever, undefined, false, 'press');
    assert.equal(first.length, 2);
    assert.match(result.content[0].text, /\{"stopped":"the level changed"\}/);
    assert.match(result.content[0].text, /ACTED 2 action\(s\); stopped: the level changed\. This decision ends\./);
    assert.equal(result.terminate, true);
  } finally { level.runtime.close(); }
  const second: Played[] = [];
  const limit = runtimeFor(second, { quiet: true });
  try {
    const result: any = await limit.runtime.python(forever, undefined, false, 'press');
    assert.equal(second.length, MAX_ACTS);
    assert.match(result.content[0].text, new RegExp(`ACTED ${MAX_ACTS} action\\(s\\); stopped: the limit of ${MAX_ACTS} actions per call was reached`));
  } finally { limit.runtime.close(); }
});

test('every write is versioned and env.restore brings a version back; tools are only added within a decision', async () => {
  const { workspace, binder, runtime, tools } = runtimeFor([]);
  try {
    await runtime.python('def run(args):\n    return 1\n', undefined, false, 'pick');
    await runtime.python('def run(args):\n    return 2\n', undefined, false, 'pick');
    assert.equal(binder.versionMap()['tools/pick.py'], 2);
    const restored: any = await runtime.python('env.restore("tools/pick.py", 1)');
    assert.match(restored.content[0].text, /tools\/pick\.py: restored from v1 · tools\/pick\.py → tool pick v3: saved · loaded/);
    assert.equal(workspace.read('tools/pick.py'), 'def run(args):\n    return 1\n');
    const missing: any = await runtime.python('env.restore("tools/pick.py", 9)');
    assert.match(missing.content[0].text, /tools\/pick\.py: no version 9 to restore/);
    // Removing a tool mid-decision does not take it out of the tool list the model was given.
    binder.boundary();
    await runtime.python("import os\nos.remove('tools/pick.py')");
    assert.ok(tools.active.includes('pick'));
    assert.equal(runtime.toolNames().includes('pick'), false);
  } finally { runtime.close(); }
});

test('the python session is the default workspace: kept without a save step, after a restart, apart from subagents and saved tools', async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'activation-session-'));
  const logs: any[] = [];
  const { runtime } = runtimeFor([], { sessionDir, logs });
  const out = (result: any) => result.content[0].text as string;
  try {
    assert.match(out(await runtime.python('def bump(v):\n    return v + step\nstep = 3\nseen = [1]')), /\(python session: \+bump\(\), \+seen, \+step\)/);
    // An in-place change needs no assignment and no save; an unchanged session says nothing.
    assert.doesNotMatch(out(await runtime.python('seen.append(bump(4))')), /python session/);
    assert.match(out(await runtime.python('seen')), /→ \[1,7\]/);
    // Calls sent together run in order, each seeing what the one before left.
    const [a, b] = await Promise.all([runtime.python('order = [1]'), runtime.python('order.append(2)\norder')]);
    assert.match(out(a), /\+order/);
    assert.match(out(b), /→ \[1,2\]/);
    // A subagent's python has its own session for the consult.
    assert.match(out(await runtime.python('step = 100\nmine = 1', undefined, true, undefined, new PythonSession())), /\+mine, \+step/);
    assert.match(out(await runtime.python('[bump(4), "mine" in globals()]')), /→ \[7,false\]/);
    // Saving code that relies on the session says the tool will run without it.
    assert.match(out(await runtime.python('bump(1)', undefined, false, 'use_bump')),
      /\(tools\/use_bump\.py uses names from the python session: bump\. A saved tool runs without the session/);
    // Over capacity: refused as a whole, the earlier state stays.
    assert.match(out(await runtime.python('import random\nhuge = [random.random() for _ in range(30000)]')), /python session NOT saved: it needs \d+ KB and the limit is 128 KB; largest: huge/);
    assert.match(out(await runtime.python('"huge" in globals()')), /→ false/);
  } finally { runtime.close(); }
  // After a restart the same session comes back from its checkpoint.
  const again = runtimeFor([], { sessionDir, logs });
  try {
    assert.match(out(await again.runtime.python('[bump(4), seen, order]')), /→ \[7,\[1,7\],\[1,2\]\]/);
    assert.ok(logs.some(row => row.file === 'python_session.jsonl' && row.event === 'restored' && row.names.includes('bump()')));
    assert.ok(logs.some(row => row.file === 'python_session.jsonl' && row.event === 'over_capacity' && row.over.largest[0][0] === 'huge'));
  } finally { again.runtime.close(); }
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'activation-off-')));
  const off = new NativeRuntime({ pi: { registerTool() {}, getActiveTools: () => [], setActiveTools() {} } as any, workspace,
    binder: new Binder(workspace, validatePythonComponent), state: () => ({}), level: () => 0, actionCount: () => 0, log() {}, usage() {},
    wrap: (_name, fn) => fn, pythonSession: false });
  try {
    await off.python('step = 3');
    assert.match((await off.python('step') as any).content[0].text, /NameError/);
  } finally { off.close(); }
});

test('refinement replies: one FILE or MEMORY block with its WHY, NONE, or invalid', () => {
  const edit = parseRefinerReply('FILE prompts/strategy.md\n```\nRules\n- A1 moves up (conf 4, #1-#3)\n```\nEND\nWHY #1-#3 all moved the block up');
  assert.deepEqual(edit, { kind: 'file', path: 'prompts/strategy.md', content: '---\nactive: true\n---\nRules\n- A1 moves up (conf 4, #1-#3)\n', why: '#1-#3 all moved the block up' });
  assert.deepEqual(parseRefinerReply('MEMORY rule.up 4\nACTION1 moves the block up\none cell.\nEND\nWHY #1-#3'),
    { kind: 'memory', key: 'rule.up', confidence: 4, text: 'ACTION1 moves the block up one cell.', why: '#1-#3' });
  assert.deepEqual(parseRefinerReply('MEMORY rule.up 5 replaces hyp.tick, hyp.click rule.up\nACTION1 moves the block up.\nEND\nWHY #1-#8'),
    { kind: 'memory', key: 'rule.up', confidence: 5, text: 'ACTION1 moves the block up.', why: '#1-#8', replaces: ['hyp.tick', 'hyp.click'] });
  const tool = parseRefinerReply('FILE tools/route.py\ndef run(args, env):\n    return 1\nEND\nWHY retyped at #4-#6');
  assert.equal(tool.kind === 'file' && tool.content, 'def run(args, env):\n    return 1\n');
  assert.equal(parseRefinerReply('FILE skills/probe/SKILL.md\n---\nname: probe\ndescription: d\n---\nbody\nEND').kind, 'file');
  assert.equal(parseRefinerReply('NONE nothing new since #4').kind, 'none');
  assert.equal(parseRefinerReply('FILE ../secret.py\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('FILE data/frames/1.json\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('FILE notes/strategy.md\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('FILE agents/critic.md\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('MEMORY rule 9\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('just prose').kind, 'invalid');
  const long = parseRefinerReply(`FILE prompts/strategy.md\n${'x'.repeat(4000)}\nEND`);
  assert.equal(long.kind === 'file' && long.content.length, '---\nactive: true\n---\n'.length + STRATEGY_CHARS + 1);
});

test('memory index: one line per entry, live hypotheses first, full text by path', () => {
  const memory = emptyMemory();
  applyRow(memory, { key: 'obs.layout', text: 'room x14-53 y25-49 '.repeat(20), confidence: 3 });
  applyRow(memory, { key: 'hyp.goal', hyp: { claim: 'cover the star', status: 'open', evidence: [], check: 'def check(t): return None' } });
  applyRow(memory, { key: 'hyp.old', hyp: { claim: 'old idea', status: 'rejected', evidence: [] } });
  const index = renderMemoryIndex(memory, 5, { 'hyp.goal': 'check: passes 3/3' });
  const lines = index.split('\n');
  assert.match(lines[0], /^MEMORY INDEX \(one line per entry; full text in data\/memory\.md; 1 rejected hypotheses and 0 inactive strategies only there\):/);
  assert.match(lines[1], /^- hyp\.goal \[open\] cover the star · check: passes 3\/3 · tested never$/);
  assert.match(lines[2], /^- obs\.layout \(conf 3\) room x14-53/);
  assert.ok(lines[2].length < 140);
  assert.equal(lines.length, 3);
});
