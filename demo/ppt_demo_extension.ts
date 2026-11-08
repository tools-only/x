/** PPT host for the branch's Binder + NativeRuntime named-program implementation.
 *
 * Free-hands revision (2026-11-04): the preset quality workflow is gone. No quality map, no automatic checks or
 * coverage reviews on render, no delivery gate beyond the integrity of what is delivered (the rendered source is
 * still the source being delivered). The agent decides its own workflow; the host provides facts (statusText),
 * facilities (python, programs, components, render/look/deliver, consult) and the hard boundaries only: budget,
 * deadline, path confinement, provider authorization.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';
import { canonicalPath, sourceFacts, deliveryIntegrity, statusFacts, PPT_GOAL, PPT_ACTIONS, OFFICE_ACTION_DESCRIPTION } from './ppt_demo_adapter.ts';
import { createProcessCore } from './ppt_reflective_core.ts';

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const sessionId = `${process.pid}-${Date.now()}`;
  const freshBatch = process.env.PPT_FRESH_BATCH === '1';
  const requestedBatchLimit = Number(process.env.PPT_BATCH_REQUESTS ?? 10);
  const batchLimit = requestedBatchLimit === 0 ? Infinity
    : Number.isSafeInteger(requestedBatchLimit) && requestedBatchLimit > 0 ? requestedBatchLimit : 10;
  // The PPT workspace starts from what the task actually uses; no ARC skeleton (data/frames, config).
  const workspace = new Workspace(root, { dirs: ['data', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results'] });
  workspace.writeGuard = path => {
    if (/^(tools\/|skills\/|agents\/|prompts\/|lib\/|notes\/memory\/|notes\/memory\.md$|AGENTS\.md$|processes\/)/i.test(path))
      throw Error('Harness component files can only be changed with reflect_component(op="define" or "redefine").');
  };
  const binder = new Binder(workspace, validatePythonComponent);
  mkdirSync(join(root, 'harness'), { recursive: true });
  const statePath = join(root, '.harness', 'ppt-loop.json');
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { batch: 0, batchRequests: 0, phase: 'task', nextPhase: 'task', note: '', noteStale: false, revision: 0, complete: false, events: [] };
  state.batchRequests ??= 0;
  state.phase ??= 'task';
  state.nextPhase ??= 'task';
  state.note ??= '';
  state.noteStale ??= false;
  state.process ??= { active: null, pending: null, failures: [] };
  let resumed = false, initialized = false;
  const newDefinitions: Array<{ name: string; kind: string; purpose: string; version: number; use_endpoint: string }> = [];
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  // Evidence facts only: what has run since the last completed render. No gate, no instruction — the agent still
  // decides whether to check; this makes "has this revision been checked" a visible fact instead of a hidden one.
  // Counters are per process (a resumed process starts at zero).
  const evidence = { revision: Number(state.lastFeedback?.revision ?? 0), programRuns: 0, consults: 0, artifactWrites: 0 };
  const evidenceLine = () => `Since render v${evidence.revision}: ${evidence.programRuns} program runs, ${evidence.consults} consults, ${evidence.artifactWrites} artifact writes; current revision checked: ${evidence.programRuns + evidence.consults > 0 ? 'yes' : 'no'}.`;
  // Work lineage: which component versions actually ran, and which files they touched, since the last render. It is
  // built from execution facts the host already records; it attributes nothing and grades nothing. Its only job is to
  // save the agent from reconstructing "what produced this revision" out of the conversation and the logs.
  type LineageUse = { name: string; kind: string; version: number | string; ok: number; failed: number; via: string };
  const lineage: { revision: number; uses: Map<string, LineageUse>; writes: Map<string, number>; unattributed: Set<string> } =
    { revision: Number(state.lastFeedback?.revision ?? 0), uses: new Map(), writes: new Map(), unattributed: new Set() };
  const lineageUse = (row: any) => {
    const name = String(row.name ?? row.role ?? ''), version = row.version ?? '?';
    if (!name) return;
    const kind = row.role ? 'subagent' : row.kind === 'program_call' ? 'program' : row.kind === 'save' || row.kind === 'program_save' ? 'save' : 'tool';
    const key = `${kind}:${name}@${version}`;
    const use = lineage.uses.get(key) ?? { name, kind, version, ok: 0, failed: 0, via: row.readonly ? 'read-only call' : 'call' };
    if (row.kind === 'program_call' || row.kind === 'tool') { if (row.ok === false) use.failed += 1; else use.ok += 1; }
    lineage.uses.set(key, use);
  };
  const lineageLine = () => {
    const uses = [...lineage.uses.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const writes = [...lineage.writes].sort((a, b) => b[1] - a[1]).map(([path, n]) => `${path}${n > 1 ? `×${n}` : ''}`);
    if (!uses.length && !writes.length) return `Lineage since render v${lineage.revision}: nothing recorded.`;
    return [`Lineage since render v${lineage.revision} (execution facts, not a causal or quality claim):`,
      uses.length ? `ran: ${uses.map(u => `${u.kind} ${u.name}@v${u.version}${u.ok + u.failed ? ` (${u.ok} ok, ${u.failed} failed)` : ''}`).join('; ')}` : 'ran: nothing',
      writes.length ? `wrote: ${writes.slice(0, 12).join(', ')}${writes.length > 12 ? `, +${writes.length - 12} more` : ''}` : 'wrote: nothing',
      lineage.unattributed.size ? `changed outside a recorded run: ${[...lineage.unattributed].slice(0, 8).join(', ')}` : ''].filter(Boolean).join('\n');
  };
  const log = (file: string, row: any) => {
    if (file === 'component_runs.jsonl' && row?.kind === 'program_call') evidence.programRuns += 1;
    if (file === 'consult_runs.jsonl') evidence.consults += 1;
    if (file === 'component_runs.jsonl' && ['program_call', 'tool', 'save', 'program_save'].includes(row?.kind)) lineageUse(row);
    if (file === 'consult_runs.jsonl' && row?.role) lineageUse({ ...row, role: row.role });
    appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), session_id: sessionId, batch: state.batch, ...row })+'\n');
  };
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], terminate });
  const processPath = (name: string) => `processes/${name}.json`;
  const processRows = () => (existsSync(workspace.path('processes')) ? workspace.files('processes') : []).filter(path => path.endsWith('.json')).map(path => {
    try { return { ...JSON.parse(workspace.read(path)), name: path.split('/').at(-1)!.replace(/\.json$/, ''), version: binder.versionMap()[path] }; } catch { return undefined; }
  }).filter(Boolean);
  const processCore = createProcessCore({ state, binder, workspace, persist, log });
  const { validate: validateProcess } = processCore;
  const activateProcess = () => processCore.activate();
  const registerTool = pi.registerTool.bind(pi);
  (pi as any).registerTool = (tool: any) => registerTool({ ...tool, execute: async (...args: any[]) => {
    const result = await tool.execute(...args);
    if (!freshBatch || result?.terminate || (state.batchRequests ?? 0) < batchLimit) return result;
    state.nextPhase = 'task'; state.noteStale = true; state.batchClosed = true; persist();
    log('lifecycle.jsonl', { event: 'batch_closed', reason: 'request_limit', requests: state.batchRequests, limit: batchLimit });
    return { ...result, terminate: true, content: [...(result?.content ?? []),
      { type: 'text', text: 'Batch closed at its request limit; the next batch starts with a fresh conversation.' }] };
  } });
  const previousRequests = existsSync(join(root, 'harness/provider-requests.jsonl'))
    ? readFileSync(join(root, 'harness/provider-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const previousUsage = existsSync(join(root, 'harness/model-usage.jsonl'))
    ? readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.PPT_DEMO_REQUEST_RESERVE_USD ?? 3.52);
  const cap = Number(process.env.PPT_DEMO_BUDGET_USD ?? 12);
  const unknownUsageReserveTokens = 12000;
  const inputRate = Number(process.env.PPT_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.PPT_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.PPT_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.PPT_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  let requests = previousRequests.at(-1)?.request ?? 0, reserved = 0;
  let spent = (lastUsage?.conservative_usd ?? 0) + Math.max(0, requests-(lastUsage?.request ?? 0))*reserve;
  const reportedTokens = (usage: any) => Number(usage?.input ?? 0) + Number(usage?.output ?? 0) + Number(usage?.cacheRead ?? 0) + Number(usage?.cacheWrite ?? 0);
  let tokensSpent = previousUsage.reduce((sum, row) => sum + (row.usage ? reportedTokens(row.usage) : unknownUsageReserveTokens), 0);
  const snapshot = () => {
    const deckPath = 'artifacts/deck.json', htmlPath = 'artifacts/presentation.html';
    const deck = existsSync(workspace.path(deckPath)) ? JSON.parse(workspace.read(deckPath)) : null;
    const memory = workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))
      .map(path => ({ path, summary: workspace.read(path).split(/\r?\n/).find((line: string) => line.trim())?.slice(0, 240) ?? '' }));
    const feedback = state.lastFeedback;
    const html = !deck && existsSync(workspace.path(htmlPath)) ? workspace.read(htmlPath) : null;
    return { task: PPT_GOAL, batch: state.batch, revision: state.revision,
      last_feedback: feedback ? { revision: feedback.revision, slides: feedback.slides,
        native_objects: feedback.native_objects, warnings: feedback.warnings, source_path: feedback.source_path,
        evidence: feedback.evidence } : null,
      rendered_revisions: (state.renderedRevisions ?? []).slice(-8),
      memory,
      ...(deck ? { deck: { path: deckPath, format: 'scene-json', slides: deck.slides.length,
        titles: deck.slides.map((slide: any) => slide.elements.find((el: any) => el.kind === 'text')?.text ?? '') } }
        : html ? { deck: { path: htmlPath, format: 'html', bytes: Buffer.byteLength(html) } } : {}) };
  };
  const runtime = new NativeRuntime({ pi, workspace, binder, state: snapshot, level: () => 0,
    actionCount: () => state.batch, decision: () => state.batch,
    // No forced read-only ADAPT turn: the phase a checkpoint records is informational; the agent decides what its
    // engineering turns may do, as it decides the workflow itself.
    hookTurn: () => false,
    consultReasoning: (process.env.PPT_DEMO_THINKING ?? 'high') as 'low' | 'medium' | 'high',
    modelResult: async create => {
      if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
        writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, reason: 'consult budget boundary' }));
        process.exit(0);
      }
      spent += reserve;
      log('provider-requests.jsonl', { request: ++requests, kind: 'consult', estimated_usd_so_far: spent });
      const reply = await create().result();
      const u = reply.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && u.input + u.output > 0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserve;
      log('model-usage.jsonl', { request: requests, kind: 'consult', usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent, conservative_usd: spent,
        usage_status: known ? 'reported' : 'unknown_reserved', stopReason: reply.stopReason });
      return reply;
    },
    pythonSession: false, pythonKernel: false, workMemory: false, log, usage: (kind, message) => log('usage.jsonl', { kind, message }),
    wrap: (_name, fn) => async (_id: string, args: any, signal: any, _update: any, ctx: any) => fn(args, signal, ctx),
  });
  const canonical = () => canonicalPath(workspace);
  const fileHash = (path: string) => createHash('sha256').update(readFileSync(workspace.path(path))).digest('hex');
  const currentSourceFacts = () => sourceFacts(workspace, canonical());
  /** Facts only: where the work stands. No nudges, no prescribed next step; the agent decides its workflow. */
  const statusText = () => statusFacts({ source: currentSourceFacts(), state, evidenceLine, lineageLine, workspace, tokensSpent, spent, cap,
    deadline: Number(process.env.PPT_DEMO_DEADLINE) });
  const register = (name: string, description: string, parameters: any, fn: any) => pi.registerTool({ name, label: name,
    description, parameters, execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      const result = await fn(args, signal, ctx);
      log('tools.jsonl', { name, args,
        result: result?.content?.filter((x: any) => x.type === 'text'), isError: result?.isError ?? false });
      return result;
    } });
  for (const tool of workspace.fileTools()) pi.registerTool(tool);
  workspace.onWrite = async path => {
    if (path.startsWith('artifacts/')) evidence.artifactWrites += 1;
    // A direct file write is an agent edit with no recorded run behind it; lineage says so instead of guessing.
    lineage.writes.set(path, (lineage.writes.get(path) ?? 0) + 1);
    if (!/^(tools|lib|skills|agents|prompts|notes)\//.test(path)) lineage.unattributed.add(path);
    const result = await binder.save(path, 0, { by: 'agent', decision: state.batch }); binder.boundary();
    return result;
  };
  register('python', 'Run Python in the confined workspace sandbox. Files under the workspace are read and written with open(path) — text or binary ("rb"/"wb"), any file type (images, decks, data). Harness component paths require reflect_component. Returns what you print and the value of a final expression.',
    Type.Object({ code: Type.String({ minLength: 1, maxLength: 65536 }) }),
    async (a: any, signal: any) => runtime.python(a.code, signal, false));
  register('run_program', 'Run the live version of a named tool against current task evidence. Programs may read and write confined workspace files (text or binary).',
    Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
    async (a: any, signal: any) => {
      const result = await runtime.runProgram(a.name, a.args ?? {}, signal);
      await binder.scan(0); binder.boundary(); runtime.register();
      return result;
    });
  register('list_programs', 'Find available executable methods and versions by purpose.', Type.Object({ query: Type.Optional(Type.String()) }),
    (a: any) => text(binder.programCatalog(0, a.query ?? '')));
  register('read_component', 'Inspect a named component source and exact active version.', Type.Object({ name: Type.String() }), (a: any) => {
    const c = binder.active().find(c => c.name === a.name);
    if (!c) throw Error('No active component by this name');
    if (c.kind === 'skill') log('lifecycle.jsonl', { event: 'component_consumed', kind: c.kind, name: c.name, version: c.version, boundary: 'read_component' });
    return text(`${c.name}@v${c.version}\n${c.source}`);
  });
  register('reflect_component', 'Inspect, define, redefine, or restore a live harness component or process. Process versions use the same note, Binder history, and restore path as physical components.',
    Type.Object({ op: Type.Union([Type.Literal('inspect'), Type.Literal('define'), Type.Literal('redefine'), Type.Literal('restore')]),
      name: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal('tool'), Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('subagent'), Type.Literal('memory'), Type.Literal('process')])),
      source: Type.Optional(Type.String()), version: Type.Optional(Type.Integer({ minimum: 1 })), note: Type.Optional(Type.String()) }), async (a: any) => {
      const components = binder.active().filter(c => ['tool', 'prompt', 'skill', 'subagent'].includes(c.kind));
      const consumers = (component: any) => [...new Set([
        ...(component.kind === 'tool' ? ['Pi tool registry / run_program'] : []),
        ...(component.kind === 'prompt' ? ['next provider request system prompt'] : []),
        ...(component.kind === 'skill' ? ['task workspace skill index'] : []),
        ...(component.kind === 'subagent' ? ['consult'] : []),
        ...components.filter(other => other.path !== component.path && other.source.includes(component.name)).map(other => `${other.kind}:${other.name}`),
      ])];
       if (a.op === 'inspect') return text([...components.map(c => ({ name: c.name, kind: c.kind, version: c.version,
        path: c.path, used_by: consumers(c), detail: `read_component(name=${JSON.stringify(c.name)})` })), ...workspace.files('notes').filter(path => /^notes\/memory\/.+\.md$/.test(path))
        .map(path => ({ name: path.split('/').at(-1)!.replace(/\.md$/, ''), kind: 'memory', version: binder.versionMap()[path] ?? 1,
          path, used_by: ['next provider request system context'], detail: `read(path=${JSON.stringify(path)})` })),
        ...processRows().map(p => ({ name: p.name, kind: 'process', version: p.version, status: state.process.active?.name === p.name ? 'active' : 'saved' }))]);
       if (a.op !== 'inspect' && (typeof a.note !== 'string' || !a.note.trim())) throw Error('note is required for define, redefine, or restore');
       if (!a.name || !a.kind) throw Error('name and kind are required for define, redefine, or restore');
       if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(a.name)) throw Error('invalid component name');
      if (a.kind === 'process') {
        const path = processPath(a.name), old = existsSync(workspace.path(processPath(a.name)))
          ? { name: a.name, version: binder.versionMap()[processPath(a.name)] } : undefined;
        if (a.op === 'define' && old) throw Error('process already exists; use redefine');
        if ((a.op === 'redefine' || a.op === 'restore') && !old) throw Error('process does not exist; use define');
        let envelope: any;
        try {
          const raw = a.op === 'restore' ? binder.sourceOf(path, a.version) : a.source;
          if (typeof raw !== 'string') throw Error(a.op === 'restore' ? 'saved version not found' : 'source is required');
          envelope = JSON.parse(raw); validateProcess(envelope);
        } catch (error) { return text({ ok: false, name: a.name, kind: 'process', last_good: state.process.active, error: String(error) }); }
        workspace.mutate({ op: 'write', path, content: JSON.stringify(envelope) }, true);
        const receipt = await binder.save(path, 0, { by: 'agent', decision: state.batch });
        const version = binder.versionMap()[path];
        state.process.pending = { name: a.name, version, envelope };
        persist(); binder.boundary();
        log('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: 'process', version, note: a.note, ok: true, envelope_hash: createHash('sha256').update(JSON.stringify(envelope)).digest('hex') });
        if (a.op === 'define') newDefinitions.push({ name: a.name, kind: 'process', purpose: 'Agent-authored workflow and settled-round strategy', version, use_endpoint: `reflect_component(op="inspect", kind="process", name=${JSON.stringify(a.name)})` });
        return text({ ok: true, name: a.name, kind: 'process', version, receipt, activation: 'next workflow or settled-round boundary' });
      }
      if (!['tool', 'prompt', 'skill', 'subagent', 'memory'].includes(a.kind)) throw Error('unsupported component kind');
      const path = a.kind === 'tool' ? `tools/${a.name}.py` : a.kind === 'prompt' ? `prompts/${a.name}.md`
        : a.kind === 'skill' ? `skills/${a.name}/SKILL.md` : a.kind === 'subagent' ? `agents/${a.name}.md` : `notes/memory/${a.name}.md`;
      if (!/^(tools\/[^/]+\.py|prompts\/[^/]+\.md|skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md|notes\/memory\/[^/]+\.md)$/.test(path)) throw Error('invalid component name');
       if ((a.op === 'define' || a.op === 'redefine') && typeof a.source !== 'string') throw Error('source is required for define or redefine');
      const current = binder.active().find(c => c.path === path);
       const exists = Boolean(current) || a.kind === 'memory' && existsSync(workspace.path(path));
      let nextSource = a.source;
        if (a.op === 'define' && exists) throw Error(`${a.kind} ${a.name} already exists; use redefine`);
        if (a.op === 'redefine' && !exists) throw Error(`${a.kind} ${a.name} does not exist; use define`);
       if (a.op === 'restore') {
         if (!Number.isSafeInteger(a.version)) throw Error('version is required for restore');
        nextSource = binder.sourceOf(path, a.version);
        if (nextSource === undefined) throw Error(`no saved version ${a.version} for ${a.name}`);
      }
       if (a.kind === 'tool' && !nextSource.split(/\r?\n/).slice(0, 10).some((line: string) => line.trim() === '# program: on'))
         throw Error('tool source must include # program: on in its first ten lines so run_program can consume it');
      const receipt = a.kind === 'tool'
         ? await (async () => {
           workspace.mutate({ op: 'write', path, content: nextSource }, true);
           const saved = await binder.save(path, 0, { by: 'agent', decision: state.batch });
           binder.boundary(); await binder.scan(0); runtime.register(); return saved;
         })()
        : await (async () => {
           workspace.mutate({ op: 'write', path, content: nextSource }, true);
          const saved = await binder.save(path, 0, { by: 'agent', decision: state.batch });
          binder.boundary(); return saved;
        })();
      runtime.register();
      if (a.kind === 'tool') pi.setActiveTools([...new Set([...pi.getActiveTools(), a.name])]);
      const updated = binder.active().find(c => c.path === path);
      const version = updated?.version ?? binder.versionMap()[path];
      if ((!updated && a.kind !== 'memory') || (a.kind === 'tool' && updated?.kind !== 'tool')) {
        log('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind, version: binder.versionMap()[path],
          hash: updated?.hash, note: a.note, ok: false, error: `publication did not bind: ${receipt ?? path}` });
        throw Error(`redefinition did not bind: ${receipt ?? path}`);
      }
      log('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: updated?.name ?? a.name, kind: a.kind,
         from_version: current?.version ?? (a.kind === 'memory' && exists ? binder.versionMap()[path] : null), version, hash: updated?.hash, note: a.note });
      const name = updated?.name ?? a.name;
      const nextCall = a.kind === 'tool' ? `run_program(name=${JSON.stringify(name)}, args={})`
        : a.kind === 'subagent' ? `consult(agent=${JSON.stringify(name)}, question="Review supplied facts briefly", refs=["data/material.txt"])`
        : a.kind === 'skill' ? `read_component(name=${JSON.stringify(name)})`
        : a.kind === 'prompt' ? 'Make the next provider request; the prompt is injected automatically.'
        : 'Make the next provider request; the memory is injected automatically.';
      if (a.op === 'define' && updated) newDefinitions.push({ name, kind: a.kind, purpose: updated.description, version,
        use_endpoint: nextCall });
      return text({ name, kind: a.kind, purpose: updated?.description ?? '', version, receipt, effective: 'next_pi_request', use_endpoint: nextCall, next_call: nextCall,
        detail: a.kind === 'tool' || a.kind === 'subagent' ? undefined : `read ${path} for full source` });
    });
  register('office', OFFICE_ACTION_DESCRIPTION,
    Type.Object({ op: Type.Union([Type.Literal(PPT_ACTIONS[0]), Type.Literal(PPT_ACTIONS[1]), Type.Literal(PPT_ACTIONS[2])]), source_path: Type.Optional(Type.String()), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async (a: any, signal: AbortSignal, ctx: any) => {
      const activeProcess = ['render', 'deliver'].includes(a.op) ? activateProcess() : state.process.active;
      const hasActionBoundary = ['render', 'deliver'].includes(a.op);
      const actionBoundary = processCore.boundary(a.op === 'deliver' ? 'before-submit/deliver' : 'before-action', a.op, activeProcess,
        { transition: a.op, source: hasActionBoundary ? currentSourceFacts() : undefined, rendered_revision: state.lastFeedback?.revision ?? null,
          references: activeProcess?.envelope.workflow.refs ?? [] }, ['render', 'deliver'].includes(a.op));
      processCore.beforeAction(actionBoundary);
      if (a.op === 'render') {
        const sourcePath = a.source_path ?? canonical();
        if (!sourcePath) throw Error('Choose source_path from an existing file under artifacts/, or create artifacts/presentation.html or artifacts/deck.json as the canonical source.');
        if (!sourcePath.startsWith('artifacts/') || !/\.(json|html)$/i.test(sourcePath)) throw Error('Render source must be JSON or HTML under artifacts/.');
        const source = workspace.path(sourcePath);
        if (!existsSync(source)) throw Error(`Render source does not exist: ${sourcePath}`);
        const revision = ++state.revision; persist();
        const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_html.py', import.meta.url));
        const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, source, String(revision)], { encoding: 'utf8', timeout: 300000, maxBuffer: 4*1024*1024, windowsHide: true });
        if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error)).slice(-5000));
        const receipt = JSON.parse(child.stdout);
        state.lastFeedback = { revision, slides: receipt.slides, native_objects: receipt.native_objects,
          warnings: receipt.warnings, renderer: receipt.renderer, source_path: sourcePath };
        state.renderedRevisions = [...(state.renderedRevisions ?? []), state.lastFeedback];
        state.events.push({ batch: state.batch, type: 'render', ...state.lastFeedback }); persist();
        log('renders.jsonl', state.lastFeedback);
        const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
        const evidencePath = `results/renders/v${String(revision).padStart(3, '0')}`;
        // The rendered evidence becomes workspace files: receipt, contact sheet and every page image.
        for (const entry of readdirSync(out, { withFileTypes: true })) {
          if (!entry.isFile() || !/^(receipt\.json|contact-sheet\.png|slide-\d+\.png)$/.test(entry.name)) continue;
          const body = readFileSync(join(out, entry.name));
          workspace.runtimeWrite(`${evidencePath}/${entry.name}`, entry.name.endsWith('.png') ? body : body.toString('utf8'));
        }
        state.lastFeedback.evidence = evidencePath;
        persist();
        // Facts about the period that just ended (how the previous revision was checked), then the new period starts.
        const sincePrevious = evidenceLine();
        const lineageSince = lineageLine();
        evidence.revision = revision; evidence.programRuns = 0; evidence.consults = 0; evidence.artifactWrites = 0;
        lineage.revision = revision; lineage.uses.clear(); lineage.writes.clear(); lineage.unattributed.clear();
        return { content: [...text({ render: state.lastFeedback, evidence: sincePrevious, lineage: lineageSince, state: statusText() }).content,
          { type: 'image', data: readFileSync(join(out, 'contact-sheet.png')).toString('base64'), mimeType: 'image/png' }] };
      }
      const revision = a.revision ?? state.lastFeedback?.revision;
      if (!revision || !existsSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'))) throw Error('No successful rendered revision');
      const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
      if (a.op === 'look') {
        const available = readdirSync(out).filter(n => /^slide-\d+\.png$/.test(n)).sort();
        const wanted = a.pages?.length ? a.pages.map((n: number) => `slide-${String(n).padStart(2, '0')}.png`) : available;
        const missing = wanted.filter((n: string) => !existsSync(join(out, n)));
        if (missing.length) throw Error(`No rendered page(s): ${missing.join(', ')}; rendered: ${available.join(', ') || 'none'}`);
        return { content: wanted.map((n: string) => ({ type: 'image', data: readFileSync(join(out, n)).toString('base64'), mimeType: 'image/png' })) };
      }
      const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
      const deliveryError = deliveryIntegrity(workspace, receipt, canonical(), revision, state.lastFeedback?.revision, fileHash);
      if (deliveryError) throw Error(deliveryError);
      const currentHash = fileHash(receipt.source_path);
      const delivery = join(root, 'delivery'); mkdirSync(delivery, { recursive: true });
      // The rendered revision, not one file: the presentation plus every page image and the receipt. The render
      // directory (the HTML with its relative assets intact) is delivered too; only the browser profile is skipped.
      for (const entry of readdirSync(out)) {
        if (entry === 'browser-profile') continue;
        cpSync(join(out, entry), join(delivery, entry), { recursive: true });
      }
      mkdirSync(join(delivery, 'harness'), { recursive: true });
      const components = binder.active();
      for (const c of components) { const path = join(delivery, 'harness', c.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, c.source); }
      for (const c of components.filter(component => component.kind === 'skill')) {
        const directory = join('skills', c.name);
        cpSync(workspace.path(directory), join(delivery, 'harness', directory), { recursive: true });
      }
      for (const memoryPath of workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))) {
        const target = join(delivery, 'harness', memoryPath); mkdirSync(join(target, '..'), { recursive: true }); cpSync(workspace.path(memoryPath), target);
      }
      writeFileSync(join(delivery, 'harness.json'), JSON.stringify({ components: components.map(c => ({ name: c.name, kind: c.kind, version: c.version, path: c.path, hash: c.hash })),
        artifact_sha256: currentHash }, null, 2));
      for (const relative of ['.harness/components.jsonl', 'harness/tools.jsonl', 'harness/lifecycle.jsonl', 'harness/renders.jsonl', 'harness/usage.jsonl', 'harness/process_boundaries.jsonl',
        'harness/consult_runs.jsonl', 'harness/model-usage.jsonl', 'harness/provider-requests.jsonl', 'session.jsonl']) {
        const source = join(root, relative);
        if (!existsSync(source)) continue;
        const target = join(delivery, 'harness-evidence', relative.replace(/^\.harness\//, ''));
        mkdirSync(join(target, '..'), { recursive: true }); cpSync(source, target);
      }
      state.complete = true; state.deliveredRevision = revision; persist(); log('lifecycle.jsonl', { event: 'delivered', revision });
      return text({ delivered: revision, directory: 'delivery/', evidence: evidenceLine() }, true);
    });
  pi.on('before_agent_start', async (event: any) => {
    if (!initialized) {
      // Start with addressable versions of the capabilities this workflow already runs. The prompt body is
      // byte-for-byte the existing PPT system prompt; context_with_system replaces that same section on redefinition.
      const seed = (path: string, source: string) => {
        if (!existsSync(workspace.path(path))) {
          mkdirSync(dirname(workspace.path(path)), { recursive: true });
          writeFileSync(workspace.path(path), source, 'utf8');
        }
      };
      seed('prompts/ppt_baseline_guidance.md', readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8'));
      seed('agents/deck_reviewer.md', '---\ndescription: Review a slide deck for clarity and source traceability\ntools: [read, grep]\n---\nReview the supplied draft and source material briefly. Identify the most consequential unsupported claim, unclear comparison, or readability issue; cite the relevant evidence and suggest one concrete correction.');
      seed('notes/memory/presentation_workflow.md', 'The active presentation workflow uses the supplied source materials, renders the canonical artifact, and delivers the rendered revision.');
      await binder.scan(0);
      binder.boundary();
      log('lifecycle.jsonl', { event: 'initial_registry', components: binder.active().map(c => ({ kind: c.kind, name: c.name, version: c.version, hash: c.hash })) });
      runtime.register();
      if (!binder.active().some(c => c.kind === 'tool' && c.name === 'deck_file_summary')) {
        await runtime.saveProgram('deck_file_summary', `def main(args, env):
    from pathlib import Path
    path = str(args.get('path', 'artifacts/presentation.html'))
    target = Path(path)
    if not target.is_file():
        return {'ok': False, 'path': path, 'reason': 'file not found'}
    text = target.read_text(encoding='utf-8', errors='replace')
    return {'ok': True, 'path': path, 'bytes': len(text.encode('utf-8')), 'slides': text.count('class="slide'), 'has_title': '<title>' in text.lower()}
`, 'Summarize the current HTML deck file used by the presentation workflow.', ['deck', 'summary']);
      }
      initialized = true;
    }
    resumed = event.prompt === 'PPT_RESUME';
    if (freshBatch && !resumed && state.batchRequests >= batchLimit && !state.batchClosed) {
      state.nextPhase = 'task'; state.noteStale = true; state.batchClosed = true;
      log('lifecycle.jsonl', { event: 'batch_closed', reason: 'request_limit', requests: state.batchRequests, limit: batchLimit });
    }
    const handoff = state.noteStale ? '(none: the last batch closed at its request limit)' : state.note || '(none)';
    const memory = workspace.files('notes').filter((path: string) => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))
      .map((path: string) => `## ${path}\n${workspace.read(path)}`).join('\n');
    const memoryBlock = `TASK MEMORY\n${memory || '(none saved)'}`;
    if (!resumed) {
      state.batch++; state.batchRequests = 0; state.batchClosed = false;
      state.phase = state.nextPhase ?? 'task'; state.nextPhase = state.phase;
      if (state.noteStale) { state.note = ''; state.noteStale = false; }
      binder.boundary(); persist();
    }
    // Agent-created tools stay active across batches: setActiveTools unions in everything registered.
  const selected = new Set(['read', 'write', 'edit', 'ls', 'grep', 'python', 'run_program', 'list_programs', 'read_component', 'reflect_component', 'office', 'consult']);
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...selected])]);
    const activePrompts = binder.active().filter(c => c.kind === 'prompt' && c.name !== 'ppt_baseline_guidance').map(c => c.body).join('\n');
    const baselinePrompt = binder.active().find(c => c.kind === 'prompt' && c.name === 'ppt_baseline_guidance')?.body
      ?? readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
    const taskGuidancePath = workspace.path('AGENTS.md');
    const taskGuidance = existsSync(taskGuidancePath) ? readFileSync(taskGuidancePath, 'utf8') : '';
    const systemPrompt = [baselinePrompt,
      taskGuidance, activePrompts].filter(Boolean).join('\n\n');
    event.systemPromptOptions ??= {};
    event.systemPromptOptions.forceSystemPrompt = systemPrompt;
    log('lifecycle.jsonl', { event: resumed ? 'resume' : 'batch_started' });
    if (!freshBatch) return { systemPrompt, message: { customType: 'ppt-task-memory', content: memoryBlock, display: false } };
    const deadline = Number(process.env.PPT_DEMO_DEADLINE);
    const handoffMessage = [`FRESH CONTEXT: batch ${state.batch}, phase ${state.phase}. Earlier batches are not in this conversation. Carried over: workspace files; your prompts (in the system prompt); your memory (below, in full); your skills, programs and subagents (listed below; read_component for a body); the handoff note.`,
      `Handoff note: ${handoff}.`, `Time left: ${Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} min; budget left: $${Math.max(0, cap - spent).toFixed(2)}; requests per batch: ${batchLimit}.`,
      memoryBlock, binder.index(0) || 'HARNESS\n(none)', binder.programCatalog(0), statusText()].join('\n\n');
    return { systemPrompt, message: { customType: 'ppt-work-state', content: handoffMessage, display: false } };
  });
  pi.on('context', async (event: any) => {
    const messages = event.messages;
    const messageText = (message: any) => typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map((part: any) => part?.text ?? '').join('') : '';
    const start = freshBatch ? messages.findLastIndex((message: any) => message.role === 'user' && messageText(message) !== 'PPT_RESUME') : -1;
    const kept = start >= 0 ? messages.slice(start) : [...messages];
    const tail: any[] = [{ role: 'user', content: [{ type: 'text', text: statusText() }], timestamp: Date.now() }];
    if (freshBatch && state.batchRequests === batchLimit - 1) tail.push({ role: 'custom', customType: 'ppt-batch-limit', display: false,
      timestamp: Date.now(), content: 'LAST REQUEST IN THIS BATCH. The next batch starts with a fresh conversation; only the workspace, your harness and a checkpoint note (max 400 chars) carry over.' });
    return { messages: [...kept, ...tail] };
  });
  // Prompt and memory changes are interceded into the very next provider request,
  // including tool continuations in the same Pi task/session.
  pi.on('context_with_system', (event: any, ctx: any) => {
    const system = event.messages.find((message: any) => message.role === 'system');
    if (!system) return;
    const prompts = binder.active().filter(c => c.kind === 'prompt' && c.name !== 'ppt_baseline_guidance');
    const memories = workspace.files('notes').filter((path: string) => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path));
    const additions = [
      ...prompts.map((prompt: any) => ({ kind: 'prompt', name: prompt.name, version: prompt.version, text: prompt.body })),
      ...memories.map((path: string) => ({ kind: 'memory', name: path.split('/').at(-1)!.replace(/\.md$/, ''), version: binder.versionMap()[path] ?? 1, text: workspace.read(path) })),
    ];
    additions.push(...processCore.contextAdditions());
    const discoveries = newDefinitions.splice(0);
    const baselinePrompt = binder.active().find(c => c.kind === 'prompt' && c.name === 'ppt_baseline_guidance');
    const originalPrompt = readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
    if (baselinePrompt && typeof system.content === 'string' && system.content.includes(originalPrompt))
      system.content = system.content.replace(originalPrompt, baselinePrompt.body);
    if (!additions.length && !baselinePrompt && !discoveries.length) return;
    const appended = additions.map(item => `\n\n## ${item.kind.toUpperCase()} ${item.name}\n${item.text}`).join('');
    const content = typeof system.content === 'string' ? system.content : '';
    const discoveryText = discoveries.map(item => `\n\n## Newly defined ${item.kind}: ${item.name}\nPurpose: ${item.purpose}\nVersion: ${item.version}\nUse: ${item.use_endpoint}`).join('');
    system.content = `${content}${appended}${discoveryText}`;
    for (const item of discoveries) log('lifecycle.jsonl', { event: 'definition_discovered', ...item });
    for (const item of additions) log('lifecycle.jsonl', { event: 'component_consumed', ...item, text: undefined,
      boundary: 'context_with_system provider request' });
    if (baselinePrompt) log('lifecycle.jsonl', { event: 'component_consumed', kind: 'prompt', name: baselinePrompt.name,
      version: baselinePrompt.version, boundary: 'context_with_system provider request' });
  });
  let settledMessage: any;
  pi.on('agent_end', () => {
    const activeProcess = activateProcess();
    if (!activeProcess) return;
    const settleBoundary = processCore.boundary('settle', 'agent_end', activeProcess,
      { stop_reason: settledMessage?.stopReason ?? 'unknown', batch: state.batch, revision: state.revision, complete: state.complete, process_version: activeProcess.version,
        references: activeProcess.envelope.loop.refs ?? [] }, true);
    const input = { ...settleBoundary.input,
    };
    if (processCore.settle(activeProcess, input)) settledMessage = undefined;
  });
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  pi.on('before_provider_request', (event: any) => {
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, reason: 'authorized budget boundary' }));
      process.exit(0); // Extension event exceptions are fail-open in Pi; stop before the HTTP call.
    }
    spent += reserve; reserved = reserve;
    if (freshBatch) state.batchRequests = (state.batchRequests ?? 0) + 1;
    const payload = event.payload as any;
    log('provider-requests.jsonl', { request: ++requests, batch_request: state.batchRequests, estimated_usd_so_far: spent,
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
    if (freshBatch) persist();
  });
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'assistant') {
      settledMessage = m;
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent,
        conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
    }
  });
}
