import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
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

test('real named-program execution, ADAPT read-only, revision use, HTML browser rendering and current delivery', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-native-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now()+240000);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f), setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  const call = (name: string, args: any) => tools.get(name).execute('test', args, undefined, undefined, {});
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  assert.ok(activeTools.includes('consult'));
  await assert.rejects(() => tools.get('consult').execute('test', { agent: 'visual_review', question: 'Review a slide' }, undefined, undefined, { model: { maxTokens: 1000 } }), /Create one with self_component/);
  const body = `import json\nslides=[]\nfor i in range(15):\n    slides.append({'elements':[{'kind':'text','x':0.5,'y':0.5,'w':10,'h':1,'text':args['title']+' '+str(i+1),'size':28}]})\nslides[0]['elements'].extend([{'kind':'chart','x':1,'y':2,'w':5,'h':3,'categories':['A','B'],'series':[{'name':'Revenue','values':[3,4]}],'unit':'USD bn'},{'kind':'table','x':7,'y':2,'w':5,'h':2,'rows':[['Metric','Value'],['A','3']]}])\njson.dump({'slides':slides},open('artifacts/deck.json','w'))\nprint('created',len(slides))`;
  await call('save_program', { name: 'page_builder', description: 'Parameterised diagnostic page generator', body });
  await call('self_component', { kind: 'subagent', name: 'visual_review', description: 'Read-only slide visual assessment', content: 'Inspect the requested rendered slide.', tools: [] });
  const first = await call('run_program', { name: 'page_builder', args: { title: 'Initial' } });
  assert.equal(first.isError, false);
  const manifest = join(root, 'workspace/artifacts/deck.json');
  assert.match(readFileSync(manifest, 'utf8'), /Initial/);
  await call('checkpoint', { note: 'Test revised method before continuing', adapt: true });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const rejected = await call('run_program', { name: 'page_builder', args: { title: 'Forbidden' } });
  assert.equal(rejected.isError, true);
  assert.doesNotMatch(readFileSync(manifest, 'utf8'), /Forbidden/);
  await call('save_program', { name: 'page_builder', description: 'Updated method', body: body+'\nprint("updated method")', expected_version: 1 });
  await call('checkpoint', { note: 'Use updated program in TASK', decision: 'revise', reason: 'Earlier generator needs a clearer output marker.' });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const matches = await call('list_programs', { query: 'updated deck method' });
  assert.match(matches.content[0].text, /page_builder@v2/);
  await call('run_program', { name: 'page_builder', version: 1, args: { title: 'Historical' } });
  assert.match(readFileSync(manifest, 'utf8'), /Historical/);
  await call('edit_program', { name: 'page_builder', old_text: 'print("updated method")', new_text: 'print("patched method")', expected_version: 2 });
  await call('run_program', { name: 'page_builder', args: { title: 'Updated' } });
  const firstRender = await call('office', { op: 'render' });
  assert.equal(firstRender.terminate, true);
  const receipt = JSON.parse(readFileSync(join(root, 'exports/v001/receipt.json'), 'utf8'));
  assert.equal(receipt.slides, 15);
  assert.equal(receipt.native_objects.chart, 1);
  assert.match(receipt.renderer, /headless HTML/);
  assert.match(readFileSync(join(root, 'exports/v001/presentation.html'), 'utf8'), /Quarterly results|Updated/);
  assert.match(readFileSync(join(root, 'workspace/results/renders/v001/receipt.json'), 'utf8'), /"source"/);
  const look = await call('office', { op: 'look', pages: [1] });
  assert.equal(look.content[0].type, 'image');
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
  await call('checkpoint', { note: 'Render changed deck', decision: 'continue', reason: 'First render has editable chart and table, with no warnings.' });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  await call('save_program', { name: 'accept_deck', description: 'Check current render evidence for slide count and geometry',
    body: `import json\ndef run(args, env):\n    receipt=json.load(open(args['receipt']))\n    ok=len(receipt['source']['slides'])==15 and all(w['issue']=='font_substituted' for w in receipt['warnings'])\n    return {'ok':ok,'reason':'Current receipt has 15 pages and no geometry warnings' if ok else 'Current receipt failed required checks'}` });
  await call('acceptance_check', { name: 'accept_deck' });
  await call('office', { op: 'render' });
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
  console.log('Actual HTML presentation artifacts:', root);
});
