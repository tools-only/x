import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';

// Simulated before_provider_request calls exercise context wiring, not real spending.
process.env.PPT_DEMO_BUDGET_USD = '1000';

const toolSource = (body: string, description = 'Offline test component') => `# program: on\n# description: ${description}\n${body.trim()}\n`;

test('unknown provider usage remains charged across process reload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-budget-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  for (let i=0; i<2; i++) {
    const hooks = new Map<string, any>();
    pptDemo({ registerTool() {}, on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [] } as any);
    await hooks.get('before_provider_request')({ payload: { messages: [] } });
    hooks.get('message_end')({ message: { role: 'assistant', stopReason: 'error' } });
  }
  const rows = readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows[1].usage_status, 'unknown_reserved');
  assert.equal(rows[1].conservative_usd, 7.04);
});

test('reflective component surgery hot-swaps, rolls back, and rejects deck edits as evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  const pi = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] };
  pptDemo(pi as any);
  const call = async (name: string, args: any) => tools.get(name).execute('reflect-test', ['define','redefine','restore'].includes(args.op) ? { note: 'test mutation', ...args } : args, undefined, undefined, {});
  const requestContext = async (content = 'base prompt') => {
    const payload = { systemPrompt: content, messages: [] };
    await hooks.get('before_provider_request')({ payload });
    return payload.systemPrompt;
  };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.ok(!tools.has('save_program') && !tools.has('self_component') && !tools.has('edit_program') && !tools.has('component_lifecycle'));
  const selfModificationSurface = [...tools.keys()].filter(name => ['reflect_component', 'trials', 'trial_files', 'apply_trial', 'checkpoint', 'run_program', 'list_programs', 'read_component', 'python', 'edit', 'write', 'consult'].includes(name)).sort();
  assert.deepEqual(selfModificationSurface, ['edit', 'python', 'reflect_component', 'write']);
  await assert.rejects(() => tools.get('reflect_component').execute('reflect-test', { op: 'define', kind: 'skill', name: 'missing_note', source: 'no note' }, undefined, undefined, {}), /note is required/);
  assert.equal(existsSync(join(root, 'workspace/skills/missing_note/SKILL.md')), false);
  for (const name of ['trials', 'trial_files', 'apply_trial', 'checkpoint']) assert.equal(tools.has(name), false, `${name} must not be agent-visible`);
  for (const name of ['run_program', 'list_programs', 'read_component', 'consult']) assert.equal(tools.has(name), false);
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'reflect_rules', source: '---\nactive: true\n---\nprompt version one' });
  const firstTool = toolSource(`def main(args):\n    return 'tool version one'`, 'Reflective test tool');
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'reflect_tool', source: firstTool });
  assert.deepEqual(tools.get('reflect_component').parameters.properties.op.anyOf.map((x: any) => x.const), ['define', 'redefine', 'restore']);
  assert.equal(readFileSync(join(root, 'workspace/components/tool/reflect_tool/v1.source'), 'utf8'), firstTool);
  assert.match((await call('read', { path: 'tools/reflect_tool.py' })).content[0].text, /tool version one/);
  const newTool = toolSource(`def main(args):\n    return 'tool version two'`, 'Reflective test tool');
  const redefine = await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'reflect_tool', source: newTool });
  assert.equal(JSON.parse(redefine.content[0].text).ok, true);
  assert.match((await call('reflect_tool', { args: {} })).content[0].text, /tool version two/);
  await call('reflect_component', { op: 'redefine', kind: 'prompt', name: 'reflect_rules', source: '---\nactive: true\n---\nprompt version two' });
  assert.match(await requestContext(), /prompt version two/);
  await call('reflect_component', { op: 'restore', kind: 'tool', name: 'reflect_tool', version: 1 });
  assert.match((await call('reflect_tool', { args: {} })).content[0].text, /tool version one/);
  await call('reflect_component', { op: 'restore', kind: 'prompt', name: 'reflect_rules', version: 1 });
  assert.match(await requestContext(), /prompt version one/);
  await call('write', { path: 'artifacts/deck.json', content: '{"slides":[]}' });
  await assert.rejects(() => call('write', { path: 'prompts/bypass.md', content: 'bypass' }), /reflect_component/);
  await assert.rejects(() => call('edit', { path: 'tools/reflect_tool.py', oldText: 'main', newText: 'main2' }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('notes/memory/bypass.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('skills/bypass/SKILL.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('agents/bypass.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('lib/bypass.py','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('write', { path: 'ToOlS/bypass.py', content: 'bypass' }), /reflect_component/);
  assert.ok(!existsSync(join(root, 'workspace/prompts/bypass.md')));
  assert.ok(activeTools.includes('reflect_tool'));
  const lifecycle = readFileSync(join(root, 'harness/lifecycle.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const promptChange = lifecycle.find(row => row.event === 'reflective_change' && row.kind === 'prompt' && row.version === 2);
  assert.ok(lifecycle.some(row => row.kind === 'prompt' && row.version === 2 && row.session_id === promptChange.session_id && row.boundary === 'provider request'));
  const deckOnly = mkdtempSync(join(tmpdir(), 'ppt-deck-only-'));
  mkdirSync(join(deckOnly, 'harness'), { recursive: true });
  mkdirSync(join(deckOnly, 'artifacts'), { recursive: true });
  writeFileSync(join(deckOnly, 'artifacts/deck.json'), '{"slides":[]}');
  const checker = spawnSync('python', ['tools/check_reflective_core_evidence.py', deckOnly], { encoding: 'utf8' });
  assert.equal(checker.status, 1, checker.stdout + checker.stderr);
  assert.match(checker.stdout, /"pass": false/);
});

test('native ownership collisions and rejected candidates preserve the published binding and file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-reject-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now() + 60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('native-reject', ['define', 'redefine', 'restore'].includes(args.op)
    ? { note: 'test native publication', ...args } : args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const tool = toolSource("def main(args):\n    return 'last good tool'", 'Last good');
  const skill = '---\ndescription: original skill\n---\noriginal body';
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'stable_tool', source: tool });
  await call('reflect_component', { op: 'define', kind: 'skill', name: 'stable-skill', source: skill });
  await assert.rejects(() => call('reflect_component', { op: 'define', kind: 'tool', name: 'office', source: tool }), /owned by the host/);
  await assert.rejects(() => call('reflect_component', { op: 'define', kind: 'tool', name: 'read', source: tool }), /owned by the host/);
  await assert.rejects(() => call('reflect_component', { op: 'define', kind: 'subagent', name: 'stable_tool', source: '---\ndescription: duplicate\n---\nchild' }), /already owned by tool/);
  assert.equal(existsSync(join(root, 'workspace/tools/office.py')), false);
  assert.equal(existsSync(join(root, 'workspace/agents/stable_tool.md')), false);

  const failedTool = await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'stable_tool', source: '# program: on\ndef main(:\n pass' });
  assert.equal(JSON.parse(failedTool.content[0].text).ok, false);
  assert.match((await call('stable_tool', { args: {} })).content[0].text, /last good tool/);
  assert.equal(readFileSync(join(root, 'workspace/tools/stable_tool.py'), 'utf8'), tool);

  const failedSkill = await call('reflect_component', { op: 'redefine', kind: 'skill', name: 'stable-skill', source: 'missing description body' });
  assert.equal(JSON.parse(failedSkill.content[0].text).ok, false);
  assert.equal(readFileSync(join(root, 'workspace/skills/stable-skill/SKILL.md'), 'utf8'), skill);
  const next = { systemPrompt: readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'), messages: [] };
  await hooks.get('before_provider_request')({ payload: next });
  assert.match(next.systemPrompt, /<description>original skill<\/description>/);
  assert.match(readFileSync(join(root, 'workspace/components/skill/stable-skill/last-failure.md'), 'utf8'), /description/);
  assert.equal(readFileSync(join(root, 'workspace/components/skill/stable-skill/v1.source'), 'utf8'), skill);
  assert.equal(activeTools.includes('stable_tool'), true);
});

test('an entered native tool call keeps its published source while later calls use the replacement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-pin-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now() + 60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools() {}, getActiveTools: () => [], getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('pin-test', ['define', 'redefine', 'restore'].includes(args.op)
    ? { note: 'pin invocation version', ...args } : args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'pinned_tool', source:
    '# program: on\n# description: delayed v1\nimport time\ndef main(args):\n    time.sleep(0.5)\n    return "entered-v1"' });
  const entered = call('pinned_tool', { args: {} });
  await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'pinned_tool', source:
    '# program: on\n# description: immediate v2\ndef main(args):\n    return "next-v2"' });
  assert.match((await entered).content[0].text, /entered-v1/);
  assert.match((await call('pinned_tool', { args: {} })).content[0].text, /next-v2/);
});

test('process envelopes validate, revise at settle, and log only an enforced changed choice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-process-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: () => {}, getActiveTools: () => [], getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('process-test', args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const component = (v: string) => `---\nactive: true\n---\n${v}`;
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'ref', source: component('ref v1'), note: 'test process reference' });
  const envelope = (version: number, decision: string) => JSON.stringify({
    workflow: { strategy: `workflow ${version}`, refs: [{ name: 'ref', kind: 'prompt', version }], hook: '' },
    loop: { strategy: `loop ${version}`, refs: [{ name: 'ref', kind: 'prompt', version }], hook: `export default (input: {stop_reason:string}) => ({decision:'${decision}',guidance:'continue with evidence'})` },
  });
  const bindRequest = async () => {
    const event = { payload: { systemPrompt: 'base prompt', messages: [] } };
    await hooks.get('before_provider_request')(event);
    return event;
  };
  const first = await call('reflect_component', { op: 'define', kind: 'process', name: 'task_loop', source: envelope(1, 'continue'), note: 'first loop version' });
  assert.match(first.content[0].text, /"ok":true/, first.content[0].text);
  await bindRequest();
  hooks.get('agent_end')();
  await call('reflect_component', { op: 'redefine', kind: 'prompt', name: 'ref', source: component('ref v2'), note: 'revise reference' });
  await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_loop', source: envelope(2, 'adapt'), note: 'use revised reference' });
  await bindRequest();
  hooks.get('message_end')({ message: { role: 'assistant', stopReason: 'stop' } });
  hooks.get('agent_end')();
  const state = JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8'));
  assert.equal(state.process.active.version, 2);
  assert.equal(state.process.next.decision, 'adapt');
  const rows = readFileSync(join(root, 'harness/process_boundaries.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x));
  assert.equal(rows.at(-1).process_version, 2);
  assert.equal(rows.at(-1).changed_action, true);
  await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_loop', source: JSON.stringify({
    workflow: { strategy: 'workflow 3', refs: [{ name: 'ref', kind: 'prompt', version: 2 }] },
    loop: { strategy: 'loop 3', refs: [{ name: 'ref', kind: 'prompt', version: 2 }], hook: `export default (input: {stop_reason:string}) => { if(input.stop_reason==='stop') throw Error('runtime fault'); return {decision:'continue'} }` },
  }), note: 'exercise runtime recovery' });
  await bindRequest();
  hooks.get('message_end')({ message: { role: 'assistant', stopReason: 'stop' } });
  hooks.get('agent_end')();
  assert.equal(JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).process.active.version, 2);
  const timed = await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_loop', source: JSON.stringify({
    workflow: { strategy: '', refs: [{ name: 'ref', kind: 'prompt', version: 2 }] },
    loop: { strategy: '', refs: [], hook: `export default (input: {stop_reason:string}) => { if(input.stop_reason==='stop') while(true){}; return {decision:'continue'} }` },
  }), note: 'exercise bounded hook runtime' });
  assert.match(timed.content[0].text, /"ok":true/);
  await bindRequest();
  hooks.get('message_end')({ message: { role: 'assistant', stopReason: 'stop' } });
  hooks.get('agent_end')();
  assert.equal(JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).process.active.version, 2);
  const invalidTs = await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_loop', source: JSON.stringify({
    workflow: { strategy: '', refs: [] }, loop: { strategy: '', refs: [], hook: 'export default (' },
  }), note: 'reject invalid TypeScript' });
  assert.match(invalidTs.content[0].text, /"ok":false/);
  const invalid = await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_loop', source: JSON.stringify({ workflow: { strategy: '', refs: [{ name: 'missing', kind: 'prompt', version: 1 }] }, loop: { strategy: '', refs: [] } }), note: 'invalid reference test' });
  assert.match(invalid.content[0].text, /unresolved exact reference/);
  assert.equal(JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).process.active.version, 2);
  const restorable = JSON.stringify({ workflow: { strategy: 'saved v1', refs: [] }, loop: { strategy: '', refs: [] } });
  await call('reflect_component', { op: 'define', kind: 'process', name: 'restore_path', source: restorable, note: 'create restore fixture' });
  await call('reflect_component', { op: 'redefine', kind: 'process', name: 'restore_path', source: JSON.stringify({ workflow: { strategy: 'v2', refs: [] }, loop: { strategy: '', refs: [] } }), note: 'save newer process' });
  await call('reflect_component', { op: 'restore', kind: 'process', name: 'restore_path', version: 1, note: 'restore saved process version' });
  await bindRequest();
  hooks.get('agent_end')();
  const restored = JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).process.active;
  assert.equal(restored.name, 'restore_path');
  assert.equal(restored.version, 3);
  assert.equal(restored.envelope.workflow.strategy, 'saved v1');
  assert.equal(existsSync(join(root, 'workspace/components/process/deck_workflow/v1.source')), false);
  await call('reflect_component', { op: 'redefine', kind: 'process', name: 'restore_path', source: JSON.stringify({
    workflow: { strategy: 'deny delivery', refs: [], hook: `export default () => ({allow:false,guidance:'deny'})` },
    loop: { strategy: '', refs: [] },
  }), note: 'verify core preserves last good on denial' });
  await bindRequest();
  await assert.rejects(() => call('office', { op: 'deliver' }), /process hook failed/);
  const denied = JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8'));
  assert.equal(denied.process.active.version, 3);
  assert.equal(denied.complete, false);
  assert.equal(existsSync(join(root, 'delivery')), false);
});

test('single-part process binds on the next request, captures versions, and retains last-good on activation failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-process-request-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [], getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('single-process-session', args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'task_ref', source: '---\nactive: true\n---\nreference v1', note: 'process reference' });
  const define = (strategy: string, extra: object = {}) => call('reflect_component', { op: 'define', kind: 'process', name: 'task_method',
    source: JSON.stringify({ strategy, refs: [{ name: 'task_ref', kind: 'prompt', version: 1 }], ...extra }), note: `observed: ${strategy}` });
  const redefine = (strategy: string, extra: object = {}) => call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_method',
    source: JSON.stringify({ strategy, refs: [{ name: 'task_ref', kind: 'prompt', version: 1 }], ...extra }), note: `observed: ${strategy}` });
  await define('first method');
  const request = async () => {
    const event = { payload: { systemPrompt: 'base prompt', messages: [] } };
    await hooks.get('before_provider_request')(event);
    return event.payload.systemPrompt;
  };
  assert.match(await request(), /ACTIVE PROCESS task_method@v1[\s\S]*first method[\s\S]*Exact component references: task_ref\/prompt@v1/);
  await redefine('second method');
  assert.equal(JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).process.active.version, 1);
  assert.match(await request(), /ACTIVE PROCESS task_method@v2[\s\S]*second method/);
  await call('reflect_component', { op: 'redefine', kind: 'process', name: 'task_method', source: JSON.stringify({ strategy: 'bad pending version', refs: [{ name: 'task_ref', kind: 'prompt', version: 1 }] }), note: 'reference may expire' });
  await call('reflect_component', { op: 'redefine', kind: 'prompt', name: 'task_ref', source: '---\nactive: true\n---\nreference v2', note: 'reference changed' });
  const recovered = await request();
  assert.match(recovered, /ACTIVE PROCESS task_method@v2[\s\S]*second method/);
  const state = JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8'));
  assert.equal(state.process.active.version, 2);
  assert.equal(state.process.activationReceipt.name, 'task_method');
  const life = readFileSync(join(root, 'harness/lifecycle.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const bindings = life.filter(row => row.event === 'process_context_injected');
  assert.deepEqual(bindings.map(row => [row.name, row.version, row.session_id]), [
    ['task_method', 1, bindings[0].session_id], ['task_method', 2, bindings[0].session_id], ['task_method', 2, bindings[0].session_id],
  ]);
});

test('reflective redefine reaches and restores prompt, skill, tool, subagent, and memory boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-five-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  const childRequests: any[] = [];
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('reflect-test', ['define','redefine','restore'].includes(args.op) ? { note: 'test mutation', ...args } : args, undefined, undefined, {});
  const requestContext = async () => {
    const event = { payload: { systemPrompt: 'base system', messages: [] } };
    await hooks.get('before_provider_request')(event);
    return event.payload.systemPrompt;
  };
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async (model: any) => { assert.equal(model, ctx.model); return { apiKey: 'offline-test', headers: { authorization: 'same-model' } }; },
    streamSimple: (model: any, request: any, options: any) => {
      assert.equal(model, ctx.model); assert.equal(options.headers.authorization, 'same-model'); childRequests.push(request);
      return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: request.systemPrompt }], stopReason: 'stop', usage: { input: 1, output: 1 } }) };
    },
  } };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await call('write', { path: 'notes/brief.txt', content: 'child reference text' });
  writeFileSync(join(root, 'workspace/notes/child.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWkAAAAASUVORK5CYII=', 'base64'));
  for (const [kind, name, source] of [
    ['prompt', 'five_prompt', '---\nactive: true\n---\nprompt old'], ['skill', 'five-skill', '---\ndescription: counting procedure\n---\nskill old'],
    ['subagent', 'five_agent', '---\ndescription: reviewer\ntools: [read]\nrefs: [notes/brief.txt, notes/child.png]\n---\nsubagent old'], ['memory', 'five_memory', 'memory old'],
    ['tool', 'five_tool', toolSource("def main(args):\n    return 'tool old'", 'version check')],
  ]) await call('reflect_component', { op: 'define', kind, name, source });
  const definitions: Record<string, string> = {
    prompt: '---\nactive: true\n---\nprompt new', skill: '---\ndescription: counting procedure\n---\nskill new', subagent: '---\ndescription: reviewer\ntools: [read]\nrefs: [notes/brief.txt, notes/child.png]\n---\nsubagent new',
    memory: 'memory new', tool: toolSource("def main(args):\n    return 'tool new'", 'version check'),
  };
  const names: Record<string, string> = { prompt: 'five_prompt', skill: 'five-skill', tool: 'five_tool', subagent: 'five_agent', memory: 'five_memory' };
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory']) await call('reflect_component', { op: 'redefine', kind, name: names[kind], source: definitions[kind] });
  const prompt = await requestContext();
  assert.match(prompt, /prompt new/);
  assert.match(prompt, /memory new/);
  assert.match(prompt, /<name>five-skill<\/name>/);
  assert.match((await call('read', { path: 'skills/five-skill/SKILL.md' })).content[0].text, /skill new/);
  assert.match((await call('five_tool', { args: {} })).content[0].text, /tool new/);
  let consultSystem = '';
  ctx.modelRegistry.streamSimple = (_model: any, request: any) => { consultSystem = request.systemPrompt; childRequests.push(request); return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: 'reviewed' }], stopReason: 'stop', usage: { input: 1, output: 1 } }) }; };
  await tools.get('five_agent').execute('test', { question: 'Review' }, undefined, undefined, ctx);
  assert.match(consultSystem, /subagent new/);
  assert.match(JSON.stringify(childRequests[0].messages), /child reference text/);
  assert.ok(childRequests[0].messages.some((message: any) => message.content?.some((part: any) => part.type === 'image' && part.mimeType === 'image/png')));
  assert.deepEqual(childRequests[0].tools.map((tool: any) => tool.name), ['read']);
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory']) await call('reflect_component', { op: 'restore', kind, name: names[kind], version: 1 });
  const restored = await requestContext();
  assert.match(restored, /prompt old/);
  assert.match(restored, /memory old/);
  assert.match((await call('read', { path: 'skills/five-skill/SKILL.md' })).content[0].text, /skill old/);
  assert.match((await call('five_tool', { args: {} })).content[0].text, /tool old/);
  await tools.get('five_agent').execute('test', { question: 'Review' }, undefined, undefined, ctx);
  assert.match(consultSystem, /subagent old/);
  const childRuns = readFileSync(join(root, 'harness/consult_runs.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(childRuns.map((row: any) => [row.role, row.version, row.ok]), [['five_agent', 2, true], ['five_agent', 3, true]]);
  assert.ok(childRuns.every((row: any) => row.refs.includes('notes/brief.txt') && row.refs.includes('notes/child.png')));
  const evidence = spawnSync('python', ['tools/check_reflective_core_evidence.py', root], { encoding: 'utf8' });
  assert.equal(evidence.status, 0, evidence.stdout + evidence.stderr);
  assert.deepEqual(Object.keys(JSON.parse(evidence.stdout).per_kind).sort(), ['memory', 'prompt', 'skill', 'subagent', 'tool']);
  assert.ok(activeTools.includes('five_tool'));
});

test('initial registry omits strategic reviewer/workflow seeds and keeps optional process guidance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-seeded-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('reflect-seeded', ['define','redefine','restore'].includes(args.op) ? { note: 'test mutation', ...args } : args, undefined, undefined, {});
  const context = async () => {
    const event = { payload: { systemPrompt: readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'), messages: [] } };
    await hooks.get('before_provider_request')(event);
    return event.payload.systemPrompt;
  };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.equal(readFileSync(join(root, 'workspace/prompts/ppt_baseline_guidance.md'), 'utf8'), readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'));
  assert.doesNotMatch(await context(), /must review|presentation workflow|deck reviewer/i);
  assert.match(readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'), /single modification primitive/);
  assert.doesNotMatch(readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'), /run_program|read_component|consult\(agent=/i);
  assert.match(readFileSync('demo/ppt_demo_adapter.ts', 'utf8'), /deliver|delivery/i);
  const deckOnly = mkdtempSync(join(tmpdir(), 'ppt-seeded-deck-only-'));
  mkdirSync(join(deckOnly, 'artifacts'), { recursive: true });
  writeFileSync(join(deckOnly, 'artifacts/deck.json'), '{"slides":[]}');
  const checker = spawnSync('python', ['tools/check_reflective_core_evidence.py', deckOnly], { encoding: 'utf8' });
  assert.equal(checker.status, 1, checker.stdout + checker.stderr);
});

test('native tools and Pi skill index appear after publication and are directly usable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-new-components-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('new-session', ['define','redefine','restore'].includes(args.op) ? { note: 'avoid repeating a small task step', ...args } : args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  for (const [kind, name, source] of [
    ['tool', 'new_counter', '# program: on\n# description: Count a supplied list\ndef main(args, env):\n    return {\'count\': len(args[\'items\'])}'],
    ['skill', 'new-method', '---\ndescription: count items\n---\nCount each item once, then report the total.'],
    ['subagent', 'new_advisor', '---\ndescription: concise advisor\ntools: [read]\n---\nReturn one useful observation.'],
  ] as string[][]) {
    await call('reflect_component', { op: 'define', kind, name, source });
  }
  const event = { payload: { systemPrompt: readFileSync('demo/prompts/ppt_demo_system.md', 'utf8'), messages: [] } };
  await hooks.get('before_provider_request')(event);
  assert.equal(tools.has('new_counter'), true);
  assert.equal(tools.has('new_advisor'), true);
  assert.deepEqual(Object.keys(tools.get('new_counter').parameters.properties), ['args']);
  assert.deepEqual(Object.keys(tools.get('new_advisor').parameters.properties), ['question', 'refs']);
  assert.match(event.payload.systemPrompt, /<name>new-method<\/name>/);
  assert.match((await call('new_counter', { args: { items: [1, 2, 3] } })).content[0].text, /3/);
  assert.match((await call('read', { path: 'skills/new-method/SKILL.md' })).content[0].text, /Count each item once/);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'offline-test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => ({ role: 'assistant', content: [{ type: 'text', text: request.systemPrompt }], stopReason: 'stop', usage: { input: 1, output: 1 } }) }),
  } };
  const consult = await tools.get('new_advisor').execute('test', { question: 'One observation' }, undefined, undefined, ctx);
  assert.equal(consult.isError, false);
  const life = readFileSync(join(root, 'harness/lifecycle.jsonl'), 'utf8');
  assert.equal((life.match(/"event":"definition_discovered"/g) ?? []).length, 0);
  assert.equal((life.match(/"note":"avoid repeating a small task step"/g) ?? []).length, 3);
  assert.ok(activeTools.includes('new_counter'));
});

test('free-hands: programs write text and binary, any entry shape, plain markdown components, render and delivery without gates', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+240000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const call = (name: string, args: any) => tools.get(name).execute('test', ['define','redefine','restore'].includes(args.op) ? { note: 'test mutation', ...args } : args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.equal(activeTools.includes('consult'), false);
  assert.ok(activeTools.includes('python'));
  for (const name of ['run_program', 'list_programs', 'read_component', 'consult']) assert.equal(tools.has(name), false);

  // A plain markdown subagent with no frontmatter binds with defaults; a subagent may keep write tools.
  await call('reflect_component', { op: 'define', kind: 'subagent', name: 'visual_review', source: '---\ndescription: reviewer\ntools: [read, write]\n---\nInspect the requested rendered slide.' });
  // A plain markdown prompt (no frontmatter) is active by default.
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'style_rules', source: '---\nactive: true\n---\nPrefer dark titles on light backgrounds.' });

  // The ad-hoc python tool exists and writes binary bytes (a PNG) plus reads them back.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const binary = await call('python', { code:
    `import base64\nwith open('artifacts/pixel.png','wb') as f: f.write(base64.b64decode('${png}'))\nwith open('artifacts/pixel.png','rb') as f: back = f.read()\nprint(len(back), back[:4])` });
  assert.equal(binary.isError, false, binary.content?.[0]?.text);
  assert.match(binary.content[0].text, /\d+ b'\\x89PNG'/);
  const written = readFileSync(join(root, 'workspace/artifacts/pixel.png'));
  assert.equal(written.subarray(0, 4).toString('hex'), '89504e47');

  // A program with a main() entry (no run/observe) is accepted and callable.
  const body = `import json\ndef main(args):\n    slides=[]\n    for i in range(3):\n        slides.append({'elements':[{'kind':'text','x':0.5,'y':0.5,'w':10,'h':1,'text':args['title']+' '+str(i+1),'size':28}]})\n    slides[0]['elements'].append({'kind':'image','x':1,'y':2,'w':3,'h':3,'path':'artifacts/pixel.png'})\n    json.dump({'slides':slides},open('artifacts/deck.json','w'))\n    print('created',len(slides))`;
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'page_builder', source: toolSource(body, 'Parameterised page generator') });
  const first = await call('page_builder', { args: { title: 'Initial' } });
  assert.equal(first.isError, false, first.content?.[0]?.text);
  const manifest = join(root, 'workspace/artifacts/deck.json');
  assert.match(readFileSync(manifest, 'utf8'), /Initial/);

  // A live program may write before it is redefined.
  const duringAdapt = await call('page_builder', { args: { title: 'Adapt write' } });
  assert.equal(duringAdapt.isError, false, duringAdapt.content?.[0]?.text);
  assert.match(readFileSync(manifest, 'utf8'), /Adapt write/);

  await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'page_builder', source: toolSource(body, 'Updated method') });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.equal(tools.get('page_builder').description, 'Updated method');
  await call('page_builder', { args: { title: 'Updated' } });

  // Render has no quality-map prerequisite and does not terminate the run.
  await call('reflect_component', { op: 'define', kind: 'process', name: 'integrity_probe', source: JSON.stringify({
    workflow: { strategy: '', refs: [], hook: 'export default () => ({allow:true})' },
    loop: { strategy: '', refs: [] },
  }) });
  const firstRender = await call('office', { op: 'render' });
  assert.notEqual(firstRender.terminate, true);
  // The fact line reports what ran before this render; it is a fact, not a gate.
  assert.match(firstRender.content[0].text, /Since render v0: \d+ native tool runs, 0 subagent runs, \d+ artifact writes; component activity recorded: (yes|no)/);
  const receipt = JSON.parse(readFileSync(join(root, 'exports/v001/receipt.json'), 'utf8'));
  assert.equal(receipt.slides, 3);
  assert.match(receipt.renderer, /headless HTML/);
  assert.equal(receipt.warnings.length, 0);
  // The image element outside data/ was embedded by content, not refused.
  assert.ok(existsSync(join(root, 'exports/v001/render/deck.html')));
  assert.match(readFileSync(join(root, 'workspace/results/renders/v001/receipt.json'), 'utf8'), /"source"/);
  assert.ok(existsSync(join(root, 'workspace/results/renders/v001/slide-01.png')));
  assert.equal((await call('read', { path: 'results/renders/v001/slide-01.png' })).content.some((part: any) => part.type === 'image'), true);
  const look = await call('office', { op: 'look' });
  assert.equal(look.content.length, 3);
  assert.equal(look.content[0].type, 'image');

  // Delivery needs no map, checks or coverage reviewer; it still refuses a stale render.
  const source = JSON.parse(readFileSync(manifest, 'utf8'));
  source.slides[0].elements[0].text = 'Changed';
  writeFileSync(manifest, JSON.stringify(source));
  await assert.rejects(() => call('office', { op: 'deliver' }), /changed since render/);
  assert.equal(JSON.parse(readFileSync(join(root, '.harness/ppt-loop.json'), 'utf8')).complete, false);

  // The native subagent tool sends an image ref as an image (content-detected).
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  let consultRequest: any, consultOptions: any;
  await tools.get('visual_review').execute('test', { question: 'What is visible?', refs: ['results/renders/v001/slide-01.png'] }, undefined, undefined, {
    model: { maxTokens: 1000 }, modelRegistry: {
      getApiKeyAndHeaders: async () => ({ apiKey: 'local-test' }),
      streamSimple: (_model: any, request: any, options: any) => {
        consultRequest = request; consultOptions = options;
        return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: 'Visible slide.' }], stopReason: 'stop', usage: { input: 1, output: 1 } }) };
      },
    },
  });
  assert.equal(consultOptions.reasoning, 'high');
  assert.equal(consultRequest.messages[0].content.some((block: any) => block.type === 'image' && block.mimeType === 'image/png'), true);

  const secondRender = await call('office', { op: 'render' });
  // Between v1 and v2 one consult ran and no program did; the fact line reports that period.
  assert.match(secondRender.content[0].text, /Since render v1: 0 native tool runs, 1 subagent runs, \d+ artifact writes; component activity recorded: yes/);
  const delivered = await call('office', { op: 'deliver' });
  assert.equal(delivered.terminate, true);
  assert.match(delivered.content[0].text, /Since render v2: 0 native tool runs, 0 subagent runs/);
  assert.ok(existsSync(join(root, 'delivery/presentation.html')));
  assert.ok(existsSync(join(root, 'delivery/slide-01.png')));
  const deliveredRuns = readFileSync(join(root, 'delivery/harness-evidence/harness/component_runs.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(deliveredRuns.some((row: any) => row.kind === 'tool' && row.name === 'page_builder' && row.version === 2 && row.ok));
  const harness = JSON.parse(readFileSync(join(root, 'delivery/harness.json'), 'utf8'));
  // v1 initial save, v2 the updated method; the reload run writes the same source, so the version stands.
  assert.equal(harness.components.find((c: any) => c.name === 'page_builder').version, 2);
  assert.ok(harness.components.some((c: any) => c.name === 'visual_review'));

  const fresh = mkdtempSync(join(tmpdir(), 'ppt-reload-'));
  cpSync(join(root, 'delivery/harness'), join(fresh, 'workspace'), { recursive: true });
  process.env.PPT_DEMO_ROOT = fresh;
  const reloaded = new Map<string, any>(), freshHooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => reloaded.set(t.name, t), on: (n: string, f: any) => freshHooks.set(n, f), setActiveTools() {}, getActiveTools: () => [...reloaded.keys()], getAllTools: () => [...reloaded.values()] } as any);
  await freshHooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const run = await reloaded.get('page_builder').execute('reload', { args: { title: 'Fresh data' } }, undefined, undefined, {});
  assert.equal(run.isError, false, run.content?.[0]?.text);
  assert.match(readFileSync(join(fresh, 'workspace/artifacts/deck.json'), 'utf8'), /Fresh data/);
  console.log('Actual HTML presentation artifacts:', root);
});
