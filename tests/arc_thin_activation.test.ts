import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';
import { NativeRuntime } from '../demo/arc_thin_native_runtime.ts';
import { parseRefinerReply, STRATEGY_CHARS } from '../demo/arc_thin_refiner.ts';
import { emptyMemory, applyRow, renderMemoryIndex } from '../demo/arc_thin_memory.ts';
import { projectNativeHistory } from '../demo/arc_thin_native_context.ts';

const runtimeFor = (played: Array<{ batch: any; via: string }>) => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'activation-')));
  const binder = new Binder(workspace, validatePythonComponent);
  const registered: string[] = [];
  let active: string[] = [];
  const runtime = new NativeRuntime({
    pi: { registerTool(t: any) { registered.push(t.name); }, getActiveTools: () => active, setActiveTools: (names: string[]) => { active = names; } } as any,
    workspace, binder, state: () => ({ grid: [[7, 8]] }), level: () => 0, actionCount: () => played.length, log() {}, usage() {},
    wrap: (_name, fn) => fn,
    act: async (batch, via) => { played.push({ batch, via }); return { text: `PLAYED ${batch.actions.length} from ${via}`, played: batch.actions.length }; },
  });
  return { workspace, binder, runtime, registered };
};

test('saved code acts: python(save=) saves the code as a script tool and plays what it returns; unsaved code does not', async () => {
  const played: Array<{ batch: any; via: string }> = [];
  const { workspace, binder, runtime, registered } = runtimeFor(played);
  try {
    const code = '# Two moves.\n{"actions": [{"action": "ACTION1"}, "ACTION4"], "seen": grid[0][1] + args.get("bias", 0)}';
    const unsaved = await runtime.python(code);
    assert.equal(played.length, 0);
    assert.match(unsaved.content[0].text, /not played: only saved code acts/);
    assert.notEqual((unsaved as any).terminate, true);
    const saved: any = await runtime.python(code, undefined, false, 'two_moves');
    assert.match(saved.content[0].text, /tools\/two_moves\.py → tool two_moves v1: saved · loaded/);
    assert.match(saved.content[0].text, /PLAYED 2 from tools\/two_moves\.py/);
    assert.equal(saved.terminate, true);
    assert.equal(workspace.read('tools/two_moves.py').trim(), code);
    assert.ok(registered.includes('two_moves'));
    // The script tool takes its inputs as args and is callable without a rewrite.
    binder.boundary();
    const component = binder.active().find(c => c.path === 'tools/two_moves.py')!;
    assert.deepEqual(component.parameters, { type: 'object', properties: { args: { type: 'object' } }, additionalProperties: false });
    assert.equal(component.description, 'Two moves.');
    const called: any = await (runtime as any).call(component, { args: { bias: 2 } });
    assert.match(called.content[0].text, /"seen":10/);
    assert.equal(played.length, 2);
    assert.equal(played[1].via, 'tools/two_moves.py');
    // A read-only consult call never acts.
    await (runtime as any).call(component, { args: {} }, undefined, true);
    assert.equal(played.length, 2);
    await assert.rejects(runtime.python('1', undefined, false, 'Bad Name'), /save must be a lowercase name/);
  } finally { runtime.close(); }
});

test('refiner replies: one FILE block with its WHY, NONE, or invalid', () => {
  const edit = parseRefinerReply('FILE notes/strategy.md\n```\nRules\n- A1 moves up (conf 4, #1-#3)\n```\nEND\nWHY #1-#3 all moved the block up');
  assert.deepEqual(edit, { kind: 'file', path: 'notes/strategy.md', content: 'Rules\n- A1 moves up (conf 4, #1-#3)\n', why: '#1-#3 all moved the block up' });
  assert.equal(parseRefinerReply('NONE nothing new since #4').kind, 'none');
  assert.equal(parseRefinerReply('FILE ../secret.py\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('FILE data/frames/1.json\nx\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('just prose').kind, 'invalid');
  const long = parseRefinerReply(`FILE notes/strategy.md\n${'x'.repeat(4000)}\nEND`);
  assert.equal(long.kind === 'file' && long.content.length, STRATEGY_CHARS + 1);
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

test('history budget drops the oldest earlier decisions, keeps the current one, and says where the record lives', () => {
  const history: any[] = [];
  for (let n = 0; n < 6; n++) history.push({ role: 'user', content: `decision ${n}` },
    { role: 'assistant', content: [{ type: 'toolCall', id: String(n), name: 'python', arguments: { code: 'x' } }] },
    { role: 'toolResult', toolCallId: String(n), toolName: 'python', content: [{ type: 'text', text: 'R'.repeat(1500) }] });
  const shown = projectNativeHistory(history, false, { verbatim: 2, condensed: 4, budget: 3500 });
  const users = shown.filter(m => m.role === 'user');
  const text = (m: any) => typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text ?? '').join('\n');
  assert.equal(text(users.at(-1)), 'decision 5');
  assert.ok(users.length < 6);
  assert.match(text(users[0]), /earlier decisions? not shown; your memory, notes\/, saved components/);
});
