/** PPT host for the branch's Binder + NativeRuntime named-program implementation. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  mkdirSync(join(root, 'harness'), { recursive: true });
  const statePath = join(root, '.harness', 'ppt-loop.json');
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { phase: 'task', nextPhase: 'task', batch: 0, revision: 0, complete: false, note: '', events: [] };
  let resumed = false, initialized = false;
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const log = (file: string, row: any) => appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), batch: state.batch, phase: state.phase, ...row })+'\n');
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], terminate });
  const snapshot = () => ({ task: 'PPT production', phase: state.phase, batch: state.batch,
    revision: state.revision, last_feedback: state.lastFeedback ?? null,
    memory: existsSync(workspace.path('notes/memory.md')) ? workspace.read('notes/memory.md') : '',
    ...(existsSync(workspace.path('artifacts/deck.json')) ? { deck: JSON.parse(workspace.read('artifacts/deck.json')) } : {}) });
  const runtime = new NativeRuntime({ pi, workspace, binder, state: snapshot, level: () => 0,
    actionCount: () => state.batch, decision: () => state.batch, hookTurn: () => state.phase === 'adapt',
    pythonSession: false, pythonKernel: false, workMemory: false, log, usage: (kind, message) => log('usage.jsonl', { kind, message }),
    wrap: (_name, fn) => async (_id: string, args: any, signal: any, _update: any, ctx: any) => fn(args, signal, ctx),
  });
  const register = (name: string, description: string, parameters: any, fn: any) => pi.registerTool({ name, label: name,
    description, parameters, execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      const result = await fn(args, signal, ctx);
      log('tools.jsonl', { name, args: name === 'save_program' ? { ...args, body: '(see versioned source)' } : args,
        result: result?.content?.filter((x: any) => x.type === 'text'), isError: result?.isError ?? false });
      return result;
    } });
  for (const tool of workspace.fileTools()) pi.registerTool({ ...tool, execute: async (id, args: any, signal, update, ctx) => {
    if (state.phase === 'adapt' && ['write', 'edit'].includes(tool.name) && !/^(notes|prompts|skills|agents)\//.test(args.path))
      throw Error('ADAPT changes methods or memory; return to TASK to modify the deck.');
    if (['write', 'edit'].includes(tool.name) && /^(tools|lib)\//.test(args.path)) throw Error('Use save_program for executable harness changes.');
    return tool.execute(id, args, signal, update, ctx);
  } });
  workspace.onWrite = async path => { const result = await binder.save(path, 0, { by: 'agent', decision: state.batch }); binder.boundary(); return result; };
  register('save_program', 'Create/revise a reusable Python program. Same branch API and fresh WASI execution. Complete source; state, args, env injected. Use open/json for workspace text. No host imports.',
    Type.Object({ name: Type.String(), description: Type.String(), tags: Type.Optional(Type.Array(Type.String())), body: Type.String(), expected_version: Type.Optional(Type.Integer()) }),
    async (a: any) => text(await runtime.saveProgram(a.name, a.body, a.description, a.tags ?? [], a.expected_version)));
  register('run_program', 'Run the active named version against current deck/state. Writes allowed in TASK; read-only in ADAPT. Python source may use open("artifacts/deck.json", "w") and json.dump. Print compact results.',
    Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
    (a: any, signal: any) => runtime.runProgram(a.name, a.args ?? {}, signal));
  register('list_programs', 'Find available executable methods and versions by purpose.', Type.Object({ query: Type.Optional(Type.String()) }),
    (a: any) => text(binder.programCatalog(0, a.query ?? '')));
  register('read_component', 'Inspect a named method source and exact active version.', Type.Object({ name: Type.String() }), (a: any) => {
    const c = binder.active().find(c => c.name === a.name);
    if (!c) throw Error('No active component by this name');
    return text(`${c.name}@v${c.version}\n${c.source}`);
  });
  register('self_component', 'Create or revise a task-local prompt, skill, memory entry, or read-only subagent role. Changes become available at the next batch boundary.',
    Type.Object({ kind: Type.Union([Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('memory'), Type.Literal('subagent')]),
      name: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), content: Type.String(),
      description: Type.Optional(Type.String()), tools: Type.Optional(Type.Array(Type.String())) }),
    async (a: any) => {
      const path = a.kind === 'memory' ? 'notes/memory.md' : a.kind === 'skill' ? `skills/${a.name}/SKILL.md`
        : a.kind === 'subagent' ? `agents/${a.name}.md` : `prompts/${a.name}.md`;
      const content = a.kind === 'memory' ? a.content : a.kind === 'prompt' ? `---\nactive: true\n---\n${a.content}`
        : a.kind === 'subagent' ? `---\ndescription: ${JSON.stringify(a.description ?? a.name)}\ntools: ${JSON.stringify(a.tools ?? ['read'])}\n---\n${a.content}`
        : `---\nname: ${a.name}\ndescription: ${a.name}\n---\n${a.content}`;
      workspace.mutate({ op: 'write', path, content });
      const receipt = await binder.save(path, 0, { by: 'agent', decision: state.batch });
      return text(receipt ?? `Saved ${path}; next batch uses it.`);
    });
  register('office', 'Render current deck through actual PowerPoint, view full-size pages, or deliver. Read data/environment.md for the editable object format. Render returns native checks and contact sheet; look returns up to 4 pages.',
    Type.Object({ op: Type.Union([Type.Literal('render'), Type.Literal('look'), Type.Literal('deliver')]), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 30 }), { maxItems: 4 })), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
    (a: any) => {
      if (state.phase === 'adapt' && a.op !== 'look') throw Error('ADAPT is read-only; use TASK to render/deliver.');
      if (a.op === 'render') {
        const revision = ++state.revision; persist();
        const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_artifact.py', import.meta.url));
        const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, workspace.path('artifacts/deck.json'), String(revision)], { encoding: 'utf8', timeout: 180000, maxBuffer: 2*1024*1024, windowsHide: true });
        if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error)).slice(-5000));
        state.lastFeedback = JSON.parse(child.stdout); state.events.push({ batch: state.batch, type: 'render', ...state.lastFeedback }); persist();
        log('renders.jsonl', state.lastFeedback);
        return { content: [...text(state.lastFeedback).content, { type: 'image', data: readFileSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'contact-sheet.png')).toString('base64'), mimeType: 'image/png' }] };
      }
      const revision = a.revision ?? state.lastFeedback?.revision;
      if (!revision || !existsSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'))) throw Error('No successful rendered revision');
      const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
      if (a.op === 'look') return { content: (a.pages ?? [1]).map((n: number) => ({ type: 'image', data: readFileSync(join(out, `slide-${String(n).padStart(2, '0')}.png`)).toString('base64'), mimeType: 'image/png' })) };
      const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
      if (JSON.stringify(receipt.source) !== JSON.stringify(JSON.parse(workspace.read('artifacts/deck.json')))) throw Error('Deck changed since render; render current version before delivery.');
      if (receipt.slides < 15 || receipt.slides > 20) throw Error('Original task requires 15–20 slides.');
      const delivery = join(root, 'delivery'); mkdirSync(delivery, { recursive: true });
      cpSync(out, join(delivery, 'presentation'), { recursive: true });
      const components = binder.active();
      for (const c of components) { const path = join(delivery, 'harness', c.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, c.source); }
      if (existsSync(workspace.path('notes/memory.md'))) { mkdirSync(join(delivery, 'harness', 'notes'), { recursive: true }); cpSync(workspace.path('notes/memory.md'), join(delivery, 'harness', 'notes', 'memory.md')); }
      writeFileSync(join(delivery, 'harness.json'), JSON.stringify({ base: 'codex/agent-native-program-loop', components: components.map(c => ({ name: c.name, kind: c.kind, version: c.version, path: c.path, hash: c.hash })), load: 'Copy harness/ into a new PPT demo workspace; Binder loads and runs the saved programs with fresh state/args.' }, null, 2));
      for (const relative of ['.harness/components.jsonl', 'harness/tools.jsonl', 'harness/lifecycle.jsonl', 'harness/usage.jsonl',
        'harness/consult_runs.jsonl', 'harness/model-usage.jsonl', 'harness/provider-requests.jsonl', 'session.jsonl']) {
        const source = join(root, relative);
        if (!existsSync(source)) continue;
        const target = join(delivery, 'harness-evidence', relative.replace(/^\.harness\//, ''));
        mkdirSync(join(target, '..'), { recursive: true }); cpSync(source, target);
      }
      state.complete = true; state.deliveredRevision = revision; persist(); log('lifecycle.jsonl', { event: 'delivered', revision });
      cpSync(join(root, 'harness', 'lifecycle.jsonl'), join(delivery, 'harness-evidence', 'harness', 'lifecycle.jsonl'));
      return text({ delivered: revision, directory: 'delivery/' }, true);
    });
  register('checkpoint', 'End a meaningful work batch with a short continuation note. Optionally request an ADAPT window now, including before making slides. No fixed slide/action count. In ADAPT, return to TASK.',
    Type.Object({ note: Type.String(), adapt: Type.Optional(Type.Boolean()) }), (a: any) => {
      state.note = a.note; state.nextPhase = state.phase === 'task' && a.adapt ? 'adapt' : 'task';
      log('lifecycle.jsonl', { event: 'batch_settled', nextPhase: state.nextPhase, note: a.note }); persist();
      return text({ next: state.nextPhase, note: state.note }, true);
    });
  pi.on('before_agent_start', async (event: any) => {
    if (!initialized) { await binder.scan(0); binder.boundary(); runtime.register(); initialized = true; }
    resumed = event.prompt === 'PPT_RESUME';
    if (!resumed) { state.phase = state.nextPhase; state.batch++; binder.boundary(); persist(); }
    const selected = ['read', 'write', 'edit', 'ls', 'grep', 'save_program', 'run_program', 'list_programs', 'read_component', 'self_component', 'office', 'checkpoint'];
    if (binder.active().some(c => c.kind === 'subagent')) selected.push('consult');
    pi.setActiveTools(state.phase === 'adapt' ? selected.filter(x => !['write', 'edit'].includes(x)) : selected);
    const activePrompts = binder.active().filter(c => c.kind === 'prompt').map(c => c.body).join('\n');
    const systemPrompt = readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8') + '\n' + activePrompts;
    const current = JSON.stringify(snapshot());
    log('lifecycle.jsonl', { event: resumed ? 'resume' : 'batch_started', catalog: binder.programCatalog(0) });
    return { systemPrompt, message: { customType: 'ppt-work-state', content: `PHASE ${state.phase.toUpperCase()} BATCH ${state.batch}\nContinuation: ${state.note}\nCurrent state: ${current}\n${binder.index(0)}\n${binder.programCatalog(0)}\n${binder.active().filter(c => c.kind === 'skill').map(c => `Method ${c.name}: ${c.body}`).join('\n')}`, display: false } };
  });
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  const previousRequests = existsSync(join(root, 'harness/provider-requests.jsonl'))
    ? readFileSync(join(root, 'harness/provider-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const previousUsage = existsSync(join(root, 'harness/model-usage.jsonl'))
    ? readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.PPT_DEMO_REQUEST_RESERVE_USD ?? 3.52);
  const cap = Number(process.env.PPT_DEMO_BUDGET_USD ?? 12);
  const inputRate = Number(process.env.PPT_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.PPT_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.PPT_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.PPT_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  let requests = previousRequests.at(-1)?.request ?? 0, reserved = 0;
  let spent = (lastUsage?.conservative_usd ?? 0) + Math.max(0, requests-(lastUsage?.request ?? 0))*reserve;
  pi.on('before_provider_request', (event: any) => {
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, reason: 'authorized budget boundary' }));
      process.exit(0); // Extension event exceptions are fail-open in Pi; stop before the HTTP call.
    }
    spent += reserve; reserved = reserve;
    const payload = event.payload as any;
    log('provider-requests.jsonl', { request: ++requests, phase: state.phase, estimated_usd_so_far: spent,
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
  });
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'assistant') {
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
    }
  });
}
