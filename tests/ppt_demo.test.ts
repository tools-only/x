import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';

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

test('refreshes active prompts for parent provider payload formats', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-prompt-formats-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  process.env.PPT_DEMO_BUDGET_USD = '100';
  const hooks = new Map<string, any>(), tools = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [] } as any);
  await hooks.get('before_agent_start')({ prompt: 'start' });
  await tools.get('self_component').execute('x', { kind: 'prompt', name: 'live', content: 'FRESH_METHOD' }, undefined, undefined, {});
  for (const payload of [
    { messages: [{ role: 'system', content: 'You own both the presentation old' }] },
    { messages: [{ role: 'developer', content: 'You own both the presentation old' }] },
    { input: [{ role: 'developer', content: 'You own both the presentation old' }] },
    { system: [{ type: 'text', text: 'You own both the presentation old' }] },
  ]) {
    hooks.get('before_provider_request')({ payload });
    assert.match(JSON.stringify(payload), /FRESH_METHOD/);
  }
  delete process.env.PPT_DEMO_BUDGET_USD;
});

test('nested delegation respects parent tools and material scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-nested-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  process.env.PPT_DEMO_BUDGET_USD = '100';
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [] } as any);
  await hooks.get('before_agent_start')({ prompt: 'start' });
  const call = (name: string, args: any, ctx: any = {}) => tools.get(name).execute('id', args, undefined, undefined, ctx);
  await call('write', { path: 'artifacts/source.txt', content: 'visible evidence' });
  await call('self_component', { kind: 'subagent', name: 'outer', content: 'delegate', tools: ['read', 'run_agent'] });
  await call('self_component', { kind: 'subagent', name: 'inner', content: 'read', tools: ['read'] });
  await call('self_component', { kind: 'subagent', name: 'excess', content: 'write', tools: ['write'], write_scope: ['artifacts/'] });
  let turn = 0;
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => {
      if (request.systemPrompt.includes('CONSULT_ROLE inner')) {
        assert.ok(request.messages[0].content.some((p: any) => p.text?.includes('visible evidence')));
        return { role: 'assistant', content: [{ type: 'text', text: 'inner result' }], stopReason: 'stop', usage: { input: 1, output: 1 } };
      }
      if (turn++ === 0) return { role: 'assistant', content: [
        { type: 'toolCall', id: 'ok', name: 'run_agent', arguments: { agent: 'inner', task: 'Read', refs: ['artifacts/source.txt'], independent: true } },
        { type: 'toolCall', id: 'bad', name: 'run_agent', arguments: { agent: 'excess', task: 'Write' } },
      ], stopReason: 'toolUse', usage: { input: 1, output: 1 } };
      assert.ok(request.messages.some((m: any) => m.role === 'toolResult' && m.toolCallId === 'ok' && !m.isError && JSON.stringify(m.content).includes('inner result')));
      assert.ok(request.messages.some((m: any) => m.role === 'toolResult' && m.toolCallId === 'bad' && m.isError && JSON.stringify(m.content).includes('outside the parent role')));
      return { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', usage: { input: 1, output: 1 } };
    } }),
  } };
  const result = await call('run_agent', { agent: 'outer', task: 'delegate', refs: ['artifacts/source.txt'], independent: true }, ctx);
  assert.match(result.content[0].text, /done/);
  delete process.env.PPT_DEMO_BUDGET_USD;
});

test('running child observes an updated role on its next request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-role-refresh-'));
  process.env.PPT_DEMO_ROOT = root; process.env.PPT_DEMO_DEADLINE = String(Date.now()+60000);
  process.env.PPT_DEMO_BUDGET_USD = '100';
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools() {}, getActiveTools: () => [] } as any);
  await hooks.get('before_agent_start')({ prompt: 'start' });
  const call = (name: string, args: any, ctx: any = {}) => tools.get(name).execute('id', args, undefined, undefined, ctx);
  await call('self_component', { kind: 'subagent', name: 'role_refresh', content: 'OLD_ROLE', tools: ['write'], write_scope: ['agents/'] });
  let turn = 0;
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => {
      if (turn++ === 0) {
        assert.match(request.systemPrompt, /OLD_ROLE/);
        return { role: 'assistant', content: [{ type: 'toolCall', id: 'edit', name: 'write', arguments: {
          path: 'agents/role_refresh.md', content: '---\ndescription: refresh\ntools: [write]\nwrite_scope: [agents/]\n---\nNEW_ROLE',
        } }], stopReason: 'toolUse', usage: { input: 1, output: 1 } };
      }
      assert.match(request.systemPrompt, /NEW_ROLE/); assert.doesNotMatch(request.systemPrompt, /OLD_ROLE/);
      return { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', usage: { input: 1, output: 1 } };
    } }),
  } };
  const result = await call('run_agent', { agent: 'role_refresh', task: 'refresh', independent: true }, ctx);
  assert.match(result.content[0].text, /done/);
  delete process.env.PPT_DEMO_BUDGET_USD;
});

test('agent-owned workflow, scoped workers, PowerPoint export and source-checked delivery', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+240000);
  mkdirSync(join(root, 'workspace/data'), { recursive: true });
  writeFileSync(join(root, 'workspace/data/instructions.md'), 'Brief requires 15 slides.');
  writeFileSync(join(root, 'workspace/data/material.txt'), 'Supplied evidence for the test.');
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  const call = (name: string, args: any) => tools.get(name).execute('test', args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.ok(activeTools.includes('consult'));
  assert.ok(activeTools.includes('run_agent'));
  assert.ok(activeTools.includes('retire_program'));
  assert.ok(!activeTools.includes('acceptance_check'));
  await assert.rejects(() => tools.get('consult').execute('test', { agent: 'visual_review', question: 'Review a slide' }, undefined, undefined, { model: { maxTokens: 1000 } }), /Create one with self_component/);
  const body = `import json\nslides=[]\nfor i in range(15):\n    slides.append({'elements':[{'kind':'text','x':0.5,'y':0.5,'w':10,'h':1,'text':args['title']+' '+str(i+1),'size':28}]})\nslides[0]['elements'].extend([{'kind':'chart','x':1,'y':2,'w':5,'h':3,'categories':['A','B'],'series':[{'name':'Revenue','values':[3,4]}],'unit':'USD bn'},{'kind':'table','x':7,'y':2,'w':5,'h':2,'rows':[['Metric','Value'],['A','3']]}])\njson.dump({'slides':slides},open('artifacts/deck.json','w'))\nprint('created',len(slides))`;
  await call('write', { path: 'drafts/page_builder.py', content: body });
  await assert.rejects(() => call('save_program', { name: 'page_builder', description: 'ambiguous', body, source_path: 'drafts/page_builder.py' }), /exactly one/);
  await assert.rejects(() => call('save_program', { name: 'page_builder', description: 'missing' }), /exactly one/);
  const failedPayload = { messages: [{ role: 'system', content: 'You own both the presentation' }] };
  hooks.get('before_provider_request')({ payload: failedPayload });
  assert.match(failedPayload.messages[0].content, /Latest unresolved program publication failure/);
  const failedTools = readFileSync(join(root, 'harness/tools.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(failedTools.some(row => row.name === 'save_program' && row.isError && /exactly one/.test(row.error)));
  await assert.rejects(() => call('save_program', { name: 'page_builder', description: 'outside', source_path: '../outside.py' }));
  await call('save_program', { name: 'page_builder', description: 'Parameterised diagnostic page generator', source_path: 'drafts/page_builder.py' });
  const recoveredPayload = { messages: [{ role: 'system', content: 'You own both the presentation' }] };
  hooks.get('before_provider_request')({ payload: recoveredPayload });
  assert.doesNotMatch(recoveredPayload.messages[0].content, /Latest unresolved program publication failure/);
  await call('self_component', { kind: 'subagent', name: 'visual_review', description: 'Read-only slide visual assessment', content: 'Inspect the requested rendered slide.', tools: [] });
  const first = await call('run_program', { name: 'page_builder', args: { title: 'Initial' } });
  assert.equal(first.isError, false);
  const manifest = join(root, 'workspace/artifacts/deck.json');
  assert.match(readFileSync(manifest, 'utf8'), /Initial/);
  await call('save_program', { name: 'page_builder', description: 'Updated method', body: body+'\nprint("updated method")', expected_version: 1 });
  const matches = await call('list_programs', { query: 'updated deck method' });
  assert.match(matches.content[0].text, /page_builder@v2/);
  await call('run_program', { name: 'page_builder', version: 1, args: { title: 'Historical' } });
  assert.match(readFileSync(manifest, 'utf8'), /Historical/);
  await call('edit_program', { name: 'page_builder', old_text: 'print("updated method")', new_text: 'print("patched method")', expected_version: 2 });
  await call('run_program', { name: 'page_builder', args: { title: 'Updated' } });
  await assert.rejects(() => call('retire_program', { name: 'page_builder', expected_version: 2 }), /expected v2, current version is v3/);
  assert.match(readFileSync(manifest, 'utf8'), /Updated/);
  const firstRender = await call('office', { op: 'render' });
  assert.equal(firstRender.terminate, false);
  const receipt = JSON.parse(readFileSync(join(root, 'exports/v001/receipt.json'), 'utf8'));
  assert.equal(receipt.slides, 15);
  assert.equal(receipt.native_objects.chart, 1);
  assert.equal(receipt.renderer, 'Microsoft PowerPoint 16 COM');
  assert.match(readFileSync(join(root, 'workspace/results/renders/v001/receipt.json'), 'utf8'), /"source"/);
  const recovered = await call('office', { op: 'recover', revision: 1, destination: 'artifacts/recovered_v1' });
  assert.match(recovered.content[0].text, /recovered_v1/);
  assert.equal(readFileSync(join(root, 'workspace/artifacts/recovered_v1/deck.json'), 'utf8'), readFileSync(manifest, 'utf8'));
  await assert.rejects(() => call('office', { op: 'recover', revision: 1, destination: 'artifacts/recovered_v1' }), /already exists/);
  const look = await call('office', { op: 'look', pages: [1] });
  assert.equal(look.content[0].type, 'image');
  await call('self_component', { kind: 'subagent', name: 'artifact_writer', description: 'Write a scoped artifact from loaded evidence',
    content: 'Use only the supplied evidence and write the requested file.', tools: ['read', 'write'], write_scope: ['artifacts/'] });
  let isolatedInput: any;
  await tools.get('run_agent').execute('isolated', {
    agent: 'artifact_writer', task: 'Describe the rendered image.', independent: true,
    refs: ['results/renders/v001/slide-01.png'],
  }, undefined, undefined, { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'local-test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => {
      isolatedInput = request;
      return { role: 'assistant', content: [{ type: 'text', text: 'Slide observed.' }], stopReason: 'stop', usage: { input: 2, output: 1 } };
    } }),
  } });
  assert.doesNotMatch(isolatedInput.systemPrompt, /You own both the presentation/);
  assert.ok(isolatedInput.messages[0].content.some((part: any) => part.type === 'image'));
  await call('self_component', { kind: 'subagent', name: 'render_worker', description: 'Render a slide', content: 'Render the draft.', tools: ['office'] });
  let renderRound = 0;
  const childRender = await tools.get('run_agent').execute('render-child', { agent: 'render_worker', task: 'Render the draft.', independent: true }, undefined, undefined, {
    model: { maxTokens: 1000 }, modelRegistry: {
      getApiKeyAndHeaders: async () => ({ apiKey: 'local-test' }),
      streamSimple: (_model: any, request: any) => ({ result: async () => {
        if (renderRound++ === 0) return { role: 'assistant', content: [{ type: 'toolCall', id: 'r1', name: 'office', arguments: {} }], stopReason: 'toolUse', usage: { input: 2, output: 1 } };
        assert.ok(request.messages.some((m: any) => m.role === 'toolResult' && !m.isError && m.content.some((p: any) => p.type === 'image')));
        return { role: 'assistant', content: [{ type: 'text', text: 'Render observed.' }], stopReason: 'stop', usage: { input: 2, output: 1 } };
      } }),
    },
  });
  assert.match(childRender.content[0].text, /Render observed/);
  let workerRequests = 0;
  const workerContext = { model: { maxTokens: 1000 }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: 'local-test' }),
    streamSimple: (_model: any, request: any) => ({ result: async () => {
      workerRequests++;
      if (workerRequests === 1) return { role: 'assistant', content: [
        { type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'artifacts/worker.txt', content: 'worker output' } },
        { type: 'toolCall', id: 'w2', name: 'write', arguments: { path: 'delivery/bypass.txt', content: 'blocked' } },
      ], stopReason: 'toolUse', usage: { input: 2, output: 1 } };
      assert.ok(request.messages.some((message: any) => message.role === 'toolResult' && message.isError));
      assert.match(request.systemPrompt, /presentation and the system/);
      return { role: 'assistant', content: [{ type: 'text', text: 'Wrote artifacts/worker.txt from the loaded brief.' }], stopReason: 'stop', usage: { input: 2, output: 3 } };
    } }),
  } };
  await assert.rejects(() => tools.get('run_agent').execute('test', { agent: 'artifact_writer', task: 'Use absent material.', uses: ['data/missing.md'] }, undefined, undefined, workerContext), /missing file/);
  const worker = await tools.get('run_agent').execute('test', { agent: 'artifact_writer', task: 'Write the requested artifact summary.', uses: ['data/instructions.md'] }, undefined, undefined, workerContext);
  assert.match(worker.content[0].text, /artifacts\/worker\.txt/);
  assert.match(readFileSync(join(root, 'workspace/artifacts/worker.txt'), 'utf8'), /worker output/);
  await call('write', { path: 'artifacts/parent.txt', content: 'direct draft' });
  assert.equal(readFileSync(join(root, 'workspace/artifacts/parent.txt'), 'utf8'), 'direct draft');
  await call('save_program', { name: 'workflow_driver', description: 'Run a task-local workflow with agent and render host calls',
    body: `def run(args, env):\n    answer=env.agent('artifact_writer','Write the requested artifact summary.',uses=['data/instructions.md'])\n    with open('artifacts/worker.txt') as f:\n        worker_output=f.read()\n    render=env.render()\n    return {'answer':answer,'worker_output':worker_output,'render_revision':render['revision']}` });
  workerRequests = 0;
  const workflow = await tools.get('run_program').execute('test', { name: 'workflow_driver' }, undefined, undefined, workerContext);
  assert.equal(workflow.isError, false);
  assert.match(workflow.content[0].text, /worker output/);
  assert.match(workflow.content[0].text, /render_revision/);
  const source = JSON.parse(readFileSync(manifest, 'utf8'));
  source.slides[0].elements[0].text = 'Changed';
  writeFileSync(manifest, JSON.stringify(source));
  await assert.rejects(() => call('office', { op: 'deliver' }), /changed since render/);
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
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await call('office', { op: 'render' });
  writeFileSync(join(root, 'workspace/data/instructions.md'), 'Brief requires 16 slides.');
  await assert.rejects(() => call('office', { op: 'deliver' }), /requires 16/);
  writeFileSync(join(root, 'workspace/data/instructions.md'), 'Brief requires 15 slides.');
  await call('office', { op: 'deliver' });
  const harness = JSON.parse(readFileSync(join(root, 'delivery/harness.json'), 'utf8'));
  assert.equal(harness.components.find((c: any) => c.name === 'page_builder').version, 3);
  const fresh = mkdtempSync(join(tmpdir(), 'ppt-reload-'));
  cpSync(join(root, 'delivery/harness'), join(fresh, 'workspace'), { recursive: true });
  process.env.PPT_DEMO_ROOT = fresh;
  const reloaded = new Map<string, any>(), freshHooks = new Map<string, any>();
  pptDemo({ registerTool: (t: any) => reloaded.set(t.name, t), on: (n: string, f: any) => freshHooks.set(n, f), setActiveTools() {}, getActiveTools: () => [...reloaded.keys()] } as any);
  await freshHooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const run = await reloaded.get('run_program').execute('reload', { name: 'page_builder', args: { title: 'Fresh data' } }, undefined, undefined, {});
  assert.equal(run.isError, false);
  assert.match(readFileSync(join(fresh, 'workspace/artifacts/deck.json'), 'utf8'), /Fresh data/);
  console.log('Actual PowerPoint test artifacts:', root);
});

test('a representative partial HTML draft renders to a real PowerPoint image', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-partial-render-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+120000);
  mkdirSync(join(root, 'workspace/data'), { recursive: true });
  writeFileSync(join(root, 'workspace/data/instructions.md'), 'The final brief requires 15 slides.');
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  pptDemo({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, fn: any) => hooks.set(name, fn), setActiveTools() {}, getActiveTools: () => [] } as any);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await tools.get('write').execute('partial', { path: 'artifacts/partial.html', content: '<!doctype html><style>[data-slide]{width:1280px;height:720px;display:flex;align-items:center;justify-content:center;font:48px sans-serif}</style><div data-slide>Representative page</div>' }, undefined, undefined, {});
  const rendered = await tools.get('office').execute('partial', { op: 'render', source_path: 'artifacts/partial.html' }, undefined, undefined, {});
  const receipt = JSON.parse(rendered.content[0].text);
  assert.equal(receipt.slides, 1);
  assert.equal(receipt.renderer, 'Microsoft Edge HTML + Microsoft PowerPoint 16 COM');
  assert.ok(existsSync(join(root, 'workspace/results/renders/v001/slide-01.png')));
});
