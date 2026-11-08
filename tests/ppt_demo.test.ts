import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';

const toolSource = (body: string, description = 'Offline test component') => `# program: on\n# description: ${description}\n${body.trim()}\n`;

test('unknown provider usage remains charged across process reload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-budget-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  for (let i=0; i<2; i++) {
    const hooks = new Map<string, any>();
    pptDemo({ registerTool() {}, on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [] } as any);
    hooks.get('before_provider_request')({ payload: { messages: [] } });
    hooks.get('message_end')({ message: { role: 'assistant', stopReason: 'error' } });
  }
  const rows = readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows[1].usage_status, 'unknown_reserved');
  assert.equal(rows[1].conservative_usd, 7.04);
});

test('reflective component surgery introspects, hot-swaps, rolls back, and rejects deck edits as evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  const pi = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools };
  pptDemo(pi as any);
  const call = async (name: string, args: any) => tools.get(name).execute('reflect-test', args, undefined, undefined, {});
  const requestContext = (content = 'base prompt') => {
    const event = { messages: [{ role: 'system', content }] };
    hooks.get('context_with_system')(event, { sessionManager: { getSessionId: () => 'same-session' } });
    return event.messages[0].content as string;
  };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.ok(!tools.has('save_program') && !tools.has('self_component') && !tools.has('edit_program') && !tools.has('component_lifecycle'));
  const selfModificationSurface = [...tools.keys()].filter(name => ['reflect_component', 'trials', 'trial_files', 'apply_trial', 'checkpoint', 'list_programs', 'python', 'edit', 'write'].includes(name)).sort();
  assert.deepEqual(selfModificationSurface, ['edit', 'list_programs', 'python', 'reflect_component', 'write']);
  for (const name of ['trials', 'trial_files', 'apply_trial', 'checkpoint']) assert.equal(tools.has(name), false, `${name} must not be agent-visible`);
  assert.equal(typeof tools.get('list_programs').execute, 'function');
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'reflect_rules', source: '---\nactive: true\n---\nprompt version one' });
  const firstTool = toolSource(`def main(args):\n    return 'tool version one'`, 'Reflective test tool');
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'reflect_tool', source: firstTool });
  const listed = await call('reflect_component', { op: 'inspect' });
  const live = JSON.parse(listed.content[0].text);
  assert.ok(live.some((c: any) => c.kind === 'prompt' && c.name === 'reflect_rules' && c.detail === 'read_component(name="reflect_rules")'));
  assert.ok(live.some((c: any) => c.kind === 'tool' && c.name === 'reflect_tool' && c.detail === 'read_component(name="reflect_tool")'));
  assert.ok(live.every((c: any) => !('source' in c)));
  const newTool = toolSource(`def main(args):\n    return 'tool version two'`, 'Reflective test tool');
  const redefine = await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'reflect_tool', source: newTool });
  assert.equal(JSON.parse(redefine.content[0].text).next_call, 'run_program(name="reflect_tool", args={})');
  assert.match((await call('run_program', { name: 'reflect_tool' })).content[0].text, /tool version two/);
  await call('reflect_component', { op: 'redefine', kind: 'prompt', name: 'reflect_rules', source: '---\nactive: true\n---\nprompt version two' });
  assert.match(requestContext(), /prompt version two/);
  await call('reflect_component', { op: 'restore', kind: 'tool', name: 'reflect_tool', version: 1 });
  assert.match((await call('run_program', { name: 'reflect_tool' })).content[0].text, /tool version one/);
  await call('reflect_component', { op: 'restore', kind: 'prompt', name: 'reflect_rules', version: 1 });
  assert.match(requestContext(), /prompt version one/);
  await call('write', { path: 'artifacts/deck.json', content: '{"slides":[]}' });
  await assert.rejects(() => call('write', { path: 'prompts/bypass.md', content: 'bypass' }), /reflect_component/);
  await assert.rejects(() => call('edit', { path: 'tools/reflect_tool.py', oldText: 'main', newText: 'main2' }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('notes/memory/bypass.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('skills/bypass/SKILL.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('agents/bypass.md','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('python', { code: "open('lib/bypass.py','w').write('bypass')" }), /reflect_component/);
  await assert.rejects(() => call('write', { path: 'ToOlS/bypass.py', content: 'bypass' }), /reflect_component/);
  assert.ok(!existsSync(join(root, 'workspace/prompts/bypass.md')));
  const afterDeckWrite = JSON.parse((await call('reflect_component', { op: 'inspect' })).content[0].text);
  assert.ok(!afterDeckWrite.some((c: any) => c.path === 'artifacts/deck.json'));
  assert.ok(activeTools.includes('reflect_tool'));
  const lifecycle = readFileSync(join(root, 'harness/lifecycle.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const promptChange = lifecycle.find(row => row.event === 'reflective_change' && row.kind === 'prompt' && row.version === 2);
  assert.ok(lifecycle.some(row => row.kind === 'prompt' && row.version === 2 && row.session_id === promptChange.session_id && row.boundary === 'context_with_system provider request'));
  const deckOnly = mkdtempSync(join(tmpdir(), 'ppt-deck-only-'));
  mkdirSync(join(deckOnly, 'harness'), { recursive: true });
  mkdirSync(join(deckOnly, 'artifacts'), { recursive: true });
  writeFileSync(join(deckOnly, 'artifacts/deck.json'), '{"slides":[]}');
  const checker = spawnSync('python', ['tools/check_reflective_core_evidence.py', deckOnly], { encoding: 'utf8' });
  assert.equal(checker.status, 1, checker.stdout + checker.stderr);
  assert.match(checker.stdout, /"pass": false/);
});

test('reflective redefine reaches and restores prompt, skill, tool, subagent, and memory boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-five-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  const call = (name: string, args: any) => tools.get(name).execute('reflect-test', args, undefined, undefined, {});
  const requestContext = () => {
    const event = { messages: [{ role: 'system', content: 'base system' }] };
    hooks.get('context_with_system')(event, { sessionManager: { getSessionId: () => 'five-kind-session' } });
    return event.messages[0].content as string;
  };
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'offline-test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => ({ role: 'assistant', content: [{ type: 'text', text: request.systemPrompt }], stopReason: 'stop', usage: { input: 1, output: 1 } }) }),
  } };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  for (const [kind, name, source] of [
    ['prompt', 'five_prompt', '---\nactive: true\n---\nprompt old'], ['skill', 'five_skill', 'skill old'],
    ['subagent', 'five_agent', '---\ndescription: reviewer\ntools: []\n---\nsubagent old'], ['memory', 'five_memory', 'memory old'],
    ['tool', 'five_tool', toolSource("def main(args):\n    return 'tool old'", 'version check')],
  ]) await call('reflect_component', { op: 'define', kind, name, source });
  const definitions: Record<string, string> = {
    prompt: '---\nactive: true\n---\nprompt new', skill: 'skill new', subagent: '---\ndescription: reviewer\ntools: []\n---\nsubagent new',
    memory: 'memory new', tool: toolSource("def main(args):\n    return 'tool new'", 'version check'),
  };
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory']) await call('reflect_component', { op: 'redefine', kind, name: `five_${kind === 'subagent' ? 'agent' : kind === 'memory' ? 'memory' : kind}`, source: definitions[kind] });
  const prompt = requestContext();
  assert.match(prompt, /prompt new/);
  assert.match(prompt, /memory new/);
  assert.match((await call('read_component', { name: 'five_skill' })).content[0].text, /skill new/);
  assert.match((await call('run_program', { name: 'five_tool' })).content[0].text, /tool new/);
  let consultSystem = '';
  ctx.modelRegistry.streamSimple = (_model: any, request: any) => { consultSystem = request.systemPrompt; return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: 'reviewed' }], stopReason: 'stop', usage: { input: 1, output: 1 } }) }; };
  await tools.get('consult').execute('test', { agent: 'five_agent', question: 'Review' }, undefined, undefined, ctx);
  assert.match(consultSystem, /subagent new/);
  const names: Record<string, string> = { prompt: 'five_prompt', skill: 'five_skill', tool: 'five_tool', subagent: 'five_agent', memory: 'five_memory' };
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory']) await call('reflect_component', { op: 'restore', kind, name: names[kind], version: 1 });
  const restored = requestContext();
  assert.match(restored, /prompt old/);
  assert.match(restored, /memory old/);
  assert.match((await call('read_component', { name: 'five_skill' })).content[0].text, /skill old/);
  assert.match((await call('run_program', { name: 'five_tool' })).content[0].text, /tool old/);
  await tools.get('consult').execute('test', { agent: 'five_agent', question: 'Review' }, undefined, undefined, ctx);
  assert.match(consultSystem, /subagent old/);
  const evidence = spawnSync('python', ['tools/check_reflective_core_evidence.py', root], { encoding: 'utf8' });
  assert.equal(evidence.status, 0, evidence.stdout + evidence.stderr);
  assert.deepEqual(Object.keys(JSON.parse(evidence.stdout).per_kind).sort(), ['memory', 'prompt', 'skill', 'subagent', 'tool']);
  assert.ok(activeTools.includes('five_tool'));
});

test('session starts with five live baseline components that redefine and restore at their real boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-reflective-seeded-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  const call = (name: string, args: any) => tools.get(name).execute('reflect-seeded', args, undefined, undefined, {});
  const context = () => {
    const event = { messages: [{ role: 'system', content: readFileSync('demo/prompts/ppt_demo_system.md', 'utf8') }] };
    hooks.get('context_with_system')(event, { sessionManager: { getSessionId: () => 'seeded-session' } });
    return event.messages[0].content as string;
  };
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const initial = JSON.parse((await call('reflect_component', { op: 'inspect' })).content[0].text);
  assert.deepEqual(new Set(initial.map((c: any) => c.kind)), new Set(['prompt', 'tool', 'skill', 'subagent', 'memory']));
  const names: Record<string, string> = { prompt: 'ppt_baseline_guidance', skill: 'deck_workflow', tool: 'deck_file_summary', subagent: 'deck_reviewer', memory: 'presentation_workflow' };
  const changed: Record<string, string> = {
    prompt: '---\nactive: true\n---\nSeeded prompt changed for this request boundary.',
    skill: 'Seeded skill changed for the next skill read.',
    tool: toolSource("def main(args, env):\n    return {'seeded_tool': 'changed'}", 'Summarize the current HTML deck file used by the presentation workflow.'),
    subagent: '---\ndescription: changed reviewer\ntools: [read, grep]\n---\nSeeded reviewer changed.',
    memory: 'Seeded memory changed for the next request.',
  };
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory'])
    await call('reflect_component', { op: 'redefine', kind, name: names[kind], source: changed[kind] });
  assert.match(context(), /Seeded prompt changed/);
  assert.match(context(), /Seeded memory changed/);
  assert.match((await call('read_component', { name: names.skill })).content[0].text, /Seeded skill changed/);
  assert.match((await call('run_program', { name: names.tool })).content[0].text, /changed/);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'offline-test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => ({ role: 'assistant', content: [{ type: 'text', text: request.systemPrompt }], stopReason: 'stop', usage: { input: 1, output: 1 } }) }),
  } };
  await tools.get('consult').execute('test', { agent: names.subagent, question: 'Review briefly' }, undefined, undefined, ctx);
  for (const kind of ['prompt', 'skill', 'tool', 'subagent', 'memory'])
    await call('reflect_component', { op: 'restore', kind, name: names[kind], version: 1 });
  assert.match(context(), /You are completing the task in the supplied brief/);
  assert.match((await call('read_component', { name: names.skill })).content[0].text, /Keep each slide focused/);
  assert.match((await call('run_program', { name: names.tool })).content[0].text, /file not found/);
  assert.ok(activeTools.includes(names.tool));
  const deckOnly = mkdtempSync(join(tmpdir(), 'ppt-seeded-deck-only-'));
  mkdirSync(join(deckOnly, 'artifacts'), { recursive: true });
  writeFileSync(join(deckOnly, 'artifacts/deck.json'), '{"slides":[]}');
  const checker = spawnSync('python', ['tools/check_reflective_core_evidence.py', deckOnly], { encoding: 'utf8' });
  assert.equal(checker.status, 1, checker.stdout + checker.stderr);
});

test('free-hands: programs write text and binary, any entry shape, plain markdown components, render and delivery without gates', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+240000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  const call = (name: string, args: any) => tools.get(name).execute('test', args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.ok(activeTools.includes('consult'));
  assert.ok(activeTools.includes('python'));
  await assert.rejects(() => tools.get('consult').execute('test', { agent: 'visual_review', question: 'Review a slide' }, undefined, undefined, { model: { maxTokens: 1000 } }), /no active subagent/);

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
  const first = await call('run_program', { name: 'page_builder', args: { title: 'Initial' } });
  assert.equal(first.isError, false, first.content?.[0]?.text);
  const manifest = join(root, 'workspace/artifacts/deck.json');
  assert.match(readFileSync(manifest, 'utf8'), /Initial/);

  // A live program may write before it is redefined.
  const duringAdapt = await call('run_program', { name: 'page_builder', args: { title: 'Adapt write' } });
  assert.equal(duringAdapt.isError, false, duringAdapt.content?.[0]?.text);
  assert.match(readFileSync(manifest, 'utf8'), /Adapt write/);

  await call('reflect_component', { op: 'redefine', kind: 'tool', name: 'page_builder', source: toolSource(body, 'Updated method') });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const matches = await call('list_programs', { query: 'updated' });
  assert.match(matches.content[0].text, /page_builder@v2/);
  await call('run_program', { name: 'page_builder', args: { title: 'Updated' } });

  // Render has no quality-map prerequisite and does not terminate the run.
  const firstRender = await call('office', { op: 'render' });
  assert.notEqual(firstRender.terminate, true);
  // The fact line reports what ran before this render; it is a fact, not a gate.
  assert.match(firstRender.content[0].text, /Since render v0: \d+ program runs, 0 consults, \d+ artifact writes; current revision checked: (yes|no)/);
  const receipt = JSON.parse(readFileSync(join(root, 'exports/v001/receipt.json'), 'utf8'));
  assert.equal(receipt.slides, 3);
  assert.match(receipt.renderer, /headless HTML/);
  assert.equal(receipt.warnings.length, 0);
  // The image element outside data/ was embedded by content, not refused.
  assert.ok(existsSync(join(root, 'exports/v001/render/deck.html')));
  assert.match(readFileSync(join(root, 'workspace/results/renders/v001/receipt.json'), 'utf8'), /"source"/);
  assert.ok(existsSync(join(root, 'workspace/results/renders/v001/slide-01.png')));
  const look = await call('office', { op: 'look' });
  assert.equal(look.content.length, 3);
  assert.equal(look.content[0].type, 'image');

  // Delivery needs no map, checks or coverage reviewer; it still refuses a stale render.
  const source = JSON.parse(readFileSync(manifest, 'utf8'));
  source.slides[0].elements[0].text = 'Changed';
  writeFileSync(manifest, JSON.stringify(source));
  await assert.rejects(() => call('office', { op: 'deliver' }), /changed since render/);

  // Consult sends an image ref of any type as an image (content-detected), here the rendered slide PNG.
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  let consultRequest: any, consultOptions: any;
  await tools.get('consult').execute('test', { agent: 'visual_review', question: 'What is visible?', refs: ['results/renders/v001/slide-01.png'] }, undefined, undefined, {
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
  assert.match(secondRender.content[0].text, /Since render v1: 0 program runs, 1 consults, \d+ artifact writes; current revision checked: yes/);
  const delivered = await call('office', { op: 'deliver' });
  assert.equal(delivered.terminate, true);
  assert.match(delivered.content[0].text, /Since render v2: 0 program runs, 0 consults/);
  assert.ok(existsSync(join(root, 'delivery/presentation.html')));
  assert.ok(existsSync(join(root, 'delivery/slide-01.png')));
  const harness = JSON.parse(readFileSync(join(root, 'delivery/harness.json'), 'utf8'));
  // v1 initial save, v2 the updated method; the reload run writes the same source, so the version stands.
  assert.equal(harness.components.find((c: any) => c.name === 'page_builder').version, 2);
  assert.ok(harness.components.some((c: any) => c.name === 'visual_review'));

  const fresh = mkdtempSync(join(tmpdir(), 'ppt-reload-'));
  cpSync(join(root, 'delivery/harness'), join(fresh, 'workspace'), { recursive: true });
  process.env.PPT_DEMO_ROOT = fresh;
  const reloaded = new Map<string, any>(), freshHooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => reloaded.set(t.name, t), on: (n: string, f: any) => freshHooks.set(n, f), setActiveTools() {}, getActiveTools: () => [...reloaded.keys()] } as any);
  await freshHooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const run = await reloaded.get('run_program').execute('reload', { name: 'page_builder', args: { title: 'Fresh data' } }, undefined, undefined, {});
  assert.equal(run.isError, false, run.content?.[0]?.text);
  assert.match(readFileSync(join(fresh, 'workspace/artifacts/deck.json'), 'utf8'), /Fresh data/);
  console.log('Actual HTML presentation artifacts:', root);
});
