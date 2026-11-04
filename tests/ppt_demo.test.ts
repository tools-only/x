import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
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
  await call('self_component', { kind: 'subagent', name: 'visual_review', content: 'Inspect the requested rendered slide.', tools: ['read', 'write'] });
  // A plain markdown prompt (no frontmatter) is active by default.
  await call('self_component', { kind: 'prompt', name: 'style_rules', content: 'Prefer dark titles on light backgrounds.' });

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
  await call('save_program', { name: 'page_builder', description: 'Parameterised page generator', body });
  const first = await call('run_program', { name: 'page_builder', args: { title: 'Initial' } });
  assert.equal(first.isError, false, first.content?.[0]?.text);
  const manifest = join(root, 'workspace/artifacts/deck.json');
  assert.match(readFileSync(manifest, 'utf8'), /Initial/);

  // The engineering turn is not forced read-only: a program may write during it.
  await call('checkpoint', { note: 'Revising method', adapt: true });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const duringAdapt = await call('run_program', { name: 'page_builder', args: { title: 'Adapt write' } });
  assert.equal(duringAdapt.isError, false, duringAdapt.content?.[0]?.text);
  assert.match(readFileSync(manifest, 'utf8'), /Adapt write/);

  await call('checkpoint', { note: 'Back to task', adapt: false });
  await call('save_program', { name: 'page_builder', description: 'Updated method', body, expected_version: 1 });
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });
  const matches = await call('list_programs', { query: 'updated' });
  assert.match(matches.content[0].text, /page_builder@v2/);
  await call('run_program', { name: 'page_builder', version: 1, args: { title: 'Historical' } });
  assert.match(readFileSync(manifest, 'utf8'), /Historical/);
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
