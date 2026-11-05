import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pptDemo from '../demo/ppt_demo_extension.ts';

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
    setActiveTools: (names: string[]) => { activeTools = names; }, getActiveTools: () => activeTools } as any);
  return { tools, hooks, call: (name: string, args: any, ctx: any = {}) => tools.get(name).execute('test', args, undefined, undefined, ctx) };
}

test('trials run isolated, write only in their scratch workspace, and apply_trial is the only way in', { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-trial-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now() + 240000);
  const { tools, hooks, call } = boot(root);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });

  // A saved component the trial may load; the parent prompt must not reach the trial.
  await call('self_component', { kind: 'prompt', name: 'tone', content: 'PARENT-ONLY-INSTRUCTION.' });
  await call('write', { path: 'notes/material.txt', content: 'Revenue 29.6B' });

  const provider = scripted([
    reply([{ type: 'toolCall', id: 'c1', name: 'python', arguments: { code: "open('artifacts/proposal.html','w').write('<html><body><div class=\"slide\">candidate A</div></body></html>')\nprint('wrote proposal')" } }]),
    reply([{ type: 'text', text: 'Candidate A: a single-column layout.' }]),
    reply([{ type: 'toolCall', id: 'c2', name: 'python', arguments: { code: "open('artifacts/proposal.html','w').write('<html><body><div class=\"slide\">candidate B</div></body></html>')\nprint('wrote proposal')" } }]),
    reply([{ type: 'text', text: 'Candidate B: a two-column layout.' }]),
  ]);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: provider.registry };

  const run = await call('trials', { trials: [
    { id: 'a', instruction: 'Build a candidate page.', materials: ['notes/material.txt'] },
    { id: 'b', instruction: 'Build a different candidate page.' },
  ] }, ctx);
  const body = run.content[0].text;
  assert.match(body, /trial a: done/);
  assert.match(body, /trial b: done/);
  assert.match(body, /artifacts\/proposal\.html/);
  // Two trials, two rounds each: the parent's prompt never appears in a trial's system prompt or messages.
  assert.equal(provider.requests.length, 4);
  for (const request of provider.requests) {
    assert.doesNotMatch(request.systemPrompt, /PARENT-ONLY-INSTRUCTION/);
    assert.doesNotMatch(JSON.stringify(request.messages), /PARENT-ONLY-INSTRUCTION/);
  }
  // The material was copied in; nothing reached the main workspace.
  assert.match(readFileSync(join(root, '.harness/trials/a/workspace/notes/material.txt'), 'utf8'), /Revenue/);
  assert.equal(existsSync(join(root, 'workspace/artifacts/proposal.html')), false);
  // Budget accounting: every trial request is a charged provider request.
  const usage = readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(usage.filter((u: any) => u.kind === 'trial').length, 4);

  const changedA = await call('trial_files', { id: 'a' });
  assert.match(changedA.content[0].text, /artifacts\/proposal\.html/);

  // Applying copies only the selected trial's files in, and the write is versioned like any other.
  await call('apply_trial', { id: 'a', paths: ['artifacts/proposal.html'] });
  assert.match(readFileSync(join(root, 'workspace/artifacts/proposal.html'), 'utf8'), /candidate A/);
  const state = await call('office', { op: 'render' });
  assert.notEqual(state.isError, true, state.content?.[0]?.text);
  assert.match(readFileSync(join(root, 'exports/v001/receipt.json'), 'utf8'), /proposal\.html/);
});

test('a failing trial is reported without discarding the others', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-trial-fail-'));
  process.env.PPT_DEMO_ROOT = root;
  process.env.PPT_DEMO_DEADLINE = String(Date.now() + 120000);
  const { hooks, call } = boot(root);
  await hooks.get('before_agent_start')({ prompt: 'PPT_NEXT' });

  const provider = scripted([
    reply([{ type: 'toolCall', id: 'x', name: 'python', arguments: { code: 'raise SystemExit(3)' } }]),
    reply([{ type: 'text', text: 'second trial answer' }]),
  ]);
  const ctx = { model: { maxTokens: 1000 }, modelRegistry: provider.registry };
  // A missing material fails that trial only; the second still runs.
  const run = await call('trials', { trials: [
    { id: 'broken', instruction: 'x', materials: ['data/absent.txt'] },
    { id: 'fine', instruction: 'y' },
  ] }, ctx);
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

  await call('save_program', { name: 'page_builder', description: 'Builds a page',
    body: "def main(args):\n    open('artifacts/presentation.html','w').write('<html><body><div class=\"slide\">v1</div></body></html>')\n    print('ok')" });
  await call('run_program', { name: 'page_builder' });
  const first = await call('office', { op: 'render' });
  const text = first.content[0].text;
  assert.match(text, /Lineage since render v0/);
  assert.match(text, /program page_builder@v1/);
  assert.match(text, /artifacts\/presentation\.html/);

  // A direct edit is not attributed to any program.
  await call('write', { path: 'artifacts/presentation.html', content: '<html><body><div class="slide">hand edit</div></body></html>' });
  const second = await call('office', { op: 'render' });
  assert.match(second.content[0].text, /changed outside a recorded run: artifacts\/presentation\.html/);
  assert.doesNotMatch(second.content[0].text, /program page_builder@v1 \(1 ok/);
});