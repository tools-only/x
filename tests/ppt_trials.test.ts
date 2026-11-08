import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { Binder } from '../demo/arc_thin_binder.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';
import { Trials } from '../demo/ppt_trials.ts';

type Reply = { role: 'assistant'; content: any[]; stopReason: string; usage: { input: number; output: number } };

/** A scripted provider: each call returns the next queued reply and records the request it saw. */
function scripted(replies: Reply[]) {
  const requests: any[] = [];
  let index = 0;
  return {
    requests,
    registry: {
      getApiKeyAndHeaders: async () => ({ apiKey: 'local-test' }),
      streamSimple: (_model: any, request: any) => {
        requests.push(request);
        const reply = replies[Math.min(index++, replies.length - 1)];
        return { result: async () => reply };
      },
    },
  };
}

const reply = (content: any[], stopReason = 'stop'): Reply =>
  ({ role: 'assistant', content, stopReason, usage: { input: 10, output: 10 } });

function boot(root: string) {
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  let activeTools: string[] = [];
  pptDemo({ registerTool: (t: any) => tools.set(t.name, t), on: (n: string, f: any) => hooks.set(n, f),
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools, getAllTools: () => [...tools.values()] } as any);
  const workspace = new Workspace(root, { dirs: ['data', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results'] });
  const binder = new Binder(workspace, validatePythonComponent);
  const trials = new Trials({ root, workspace, binder,
    log: (file, row) => appendFileSync(join(root, 'harness', file), JSON.stringify(row) + '\n'),
    usage: (_kind, message) => appendFileSync(join(root, 'harness/model-usage.jsonl'), JSON.stringify({ kind: 'trial', usage: message.usage }) + '\n'),
    reasoning: 'off' });
  return { tools, hooks, trials, workspace, binder,
    call: (name: string, args: any, ctx: any = {}) => tools.get(name).execute('test', args, undefined, undefined, ctx) };
}

test('trials run isolated, write only in their scratch workspace, and apply_trial is the only way in', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-trial-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now() + 240000);
  const { tools, hooks, call, trials, binder } = boot(root);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });

  // A saved component the trial may load; the parent prompt must not reach the trial.
  await call('reflect_component', { op: 'define', kind: 'prompt', name: 'tone', source: 'PARENT-ONLY-INSTRUCTION.', note: 'test isolation' });
  await call('reflect_component', { op: 'define', kind: 'tool', name: 'trial_probe', source: '# program: on\n# description: Return the copied value\ndef main(args):\n    return "native copied tool"', note: 'test native trial tool' });
  await call('reflect_component', { op: 'define', kind: 'skill', name: 'count-items', source: '---\ndescription: count items\n---\nCount the supplied items.', note: 'test native trial skill' });
  await call('write', { path: 'notes/material.txt', content: 'Revenue 29.6B' });
  await binder.scan(0); binder.boundary();

  const provider = scripted([
    reply([{ type: 'toolCall', id: 'c1', name: 'trial_probe', arguments: { args: {} } },
      { type: 'toolCall', id: 'c1b', name: 'read', arguments: { path: 'skills/count-items/SKILL.md' } }]),
    reply([{ type: 'text', text: 'Candidate A: a single-column layout.' }]),
    reply([{ type: 'toolCall', id: 'c2', name: 'python', arguments: { code: "open('artifacts/proposal.html','w').write('<html><body><div class=\"slide\">candidate B</div></body></html>')\nprint('wrote proposal')" } }]),
    reply([{ type: 'text', text: 'Candidate B: a two-column layout.' }]),
  ]);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: provider.registry };

  const run = await trials.run([
    { id: 'a', instruction: 'Build a candidate page.', components: ['trial_probe', 'count-items'] },
    { id: 'b', instruction: 'Build a different candidate page.' },
  ], ctx, undefined);
  const body = run.content[0].text;
  assert.match(body, /trial a: done/);
  assert.match(body, /trial b: done/);
  assert.match(body, /artifacts\/proposal\.html/);
  // Two trials, two rounds each: the parent's prompt never appears in a trial's system prompt or messages.
  assert.equal(provider.requests.length, 4);
  assert.match(provider.requests[0].systemPrompt, /<name>count-items<\/name>/);
  assert.deepEqual(provider.requests[0].tools.filter((tool: any) => tool.name === 'trial_probe').map((tool: any) => tool.name), ['trial_probe']);
  assert.match(JSON.stringify(provider.requests[1].messages), /native copied tool/);
  assert.match(JSON.stringify(provider.requests[1].messages), /Count the supplied items/);
  for (const request of provider.requests) {
    assert.doesNotMatch(request.systemPrompt, /PARENT-ONLY-INSTRUCTION/);
    assert.doesNotMatch(JSON.stringify(request.messages), /PARENT-ONLY-INSTRUCTION/);
  }
  // The material was copied in; nothing reached the main workspace.
  assert.equal(existsSync(join(root, 'workspace/artifacts/proposal.html')), false);
  // Budget accounting: every trial request is a charged provider request.
  const usage = readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(usage.filter((u: any) => u.kind === 'trial').length, 4);

  assert.equal(tools.has('trials'), false);
});

test('a failing trial is reported without discarding the others', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-trial-fail-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now() + 120000);
  const { hooks, trials } = boot(root);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });

  const provider = scripted([
    reply([{ type: 'toolCall', id: 'x', name: 'python', arguments: { code: 'raise SystemExit(3)' } }]),
    reply([{ type: 'text', text: 'second trial answer' }]),
  ]);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: provider.registry };
  // A missing material fails that trial only; the second still runs.
  const run = await trials.run([
    { id: 'broken', instruction: 'x', materials: ['data/absent.txt'] },
    { id: 'fine', instruction: 'y' },
  ], ctx, undefined);
  const body = run.content[0].text;
  assert.match(body, /trial broken: FAILED/);
  assert.match(body, /trial fine: done/);
  assert.match(body, /second trial answer/);
});

test('lineage reports what ran and what was written, and labels unrecorded changes', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-lineage-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now() + 240000);
  const { hooks, call } = boot(root);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });

  await call('reflect_component', { op: 'define', kind: 'tool', name: 'page_builder', note: 'test lineage', source:
    "# program: on\n# description: Builds a page\ndef main(args):\n    open('artifacts/presentation.html','w').write('<html><body><div class=\"slide\">v1</div></body></html>')\n    print('ok')" });
  await call('page_builder', { args: {} });
  const first = await call('office', { op: 'render' });
  const text = first.content[0].text;
  assert.match(text, /Lineage since render v0/);
  assert.match(text, /tool page_builder@v1/);
  assert.match(text, /artifacts\/presentation\.html/);

  // A direct edit is not attributed to any program.
  await call('write', { path: 'artifacts/presentation.html', content: '<html><body><div class="slide">hand edit</div></body></html>' });
  const second = await call('office', { op: 'render' });
  assert.match(second.content[0].text, /changed outside a recorded run: artifacts\/presentation\.html/);
  assert.doesNotMatch(second.content[0].text, /tool page_builder@v1 \(1 ok/);
});
