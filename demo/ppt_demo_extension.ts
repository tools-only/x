/** PPT host whose writable capability objects live directly on the active Agent.
 *
 * Free-hands revision (2026-11-04): the preset quality workflow is gone. No quality map, no automatic checks or
 * coverage reviews on render, no delivery gate beyond the integrity of what is delivered (the rendered source is
 * still the source being delivered). The agent decides its own workflow; the host provides facts (statusText),
 * facilities (Python, native resources, render/look/deliver) and the hard boundaries only: budget,
 * deadline, path confinement, provider authorization.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';
import { canonicalPath, sourceFacts, deliveryIntegrity, statusFacts, PPT_GOAL, PPT_ACTIONS, OFFICE_ACTION_DESCRIPTION } from './ppt_demo_adapter.ts';
import { LiveAgentSelf } from './live_orchestration_core.ts';
import { SelfRoot, hash } from './self_root.ts';
import { providerPermit } from './provider_permit.ts';
import { installSelfRootTools, type SelfRootManifest, collectAcceptance, directoryBytes } from './self_root_ppt.ts';

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const manifest: SelfRootManifest | undefined = process.env.EVO_MANIFEST ? JSON.parse(readFileSync(process.env.EVO_MANIFEST, 'utf8')) : undefined;
  const experimentManifest = manifest ?? (process.env.PPT_EXPERIMENT_LIMITS ? JSON.parse(readFileSync(process.env.PPT_EXPERIMENT_LIMITS,'utf8')) : undefined);
  const experimentLimits = experimentManifest?.contract.budget;
  if (manifest && process.env.PPT_FRESH_BATCH === '1') throw Error('v1 uses one serial conversation; fresh-batch runner is disabled');
  const sessionId = `${process.pid}-${Date.now()}`;
  const freshBatch = process.env.PPT_FRESH_BATCH === '1';
  const requestedBatchLimit = Number(process.env.PPT_BATCH_REQUESTS ?? 10);
  const batchLimit = requestedBatchLimit === 0 ? Infinity
    : Number.isSafeInteger(requestedBatchLimit) && requestedBatchLimit > 0 ? requestedBatchLimit : 10;
  // The PPT workspace starts from what the task actually uses; no ARC skeleton (data/frames, config).
  const workspace = new Workspace(root, { dirs: ['data', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results'] });
  workspace.writeGuard = path => {
    if (/^(tools\/|skills\/|agents\/|prompts\/|lib\/|notes\/memory\/|notes\/memory\.md$|AGENTS\.md$|processes\/|components\/)/i.test(path))
      throw Error('Harness capabilities are live Agent objects; use reflect_component or reflect_orchestration to change self.');
  };
  mkdirSync(join(root, 'harness'), { recursive: true });
  const statePath = join(root, '.harness', 'ppt-loop.json');
  const liveSelfPath = join(root, '.harness', 'live-self.json');
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { batch: 0, batchRequests: 0, phase: 'task', nextPhase: 'task', note: '', noteStale: false, revision: 0, complete: false, events: [] };
  state.batchRequests ??= 0;
  state.phase ??= 'task';
  state.nextPhase ??= 'task';
  state.note ??= '';
  state.noteStale ??= false;
  const savedSelf = existsSync(liveSelfPath) ? JSON.parse(readFileSync(liveSelfPath, 'utf8')) : undefined;
  const evo = manifest ? new SelfRoot(manifest.contract, savedSelf, validatePythonComponent, workspace, manifest.settings.model?.maxTokens) : undefined;
  const agentSelf = evo ?? new LiveAgentSelf(savedSelf, validatePythonComponent, workspace);
  let activatingEvo = false;
  let advanceEvoBoundary = async () => {};
  let resumed = false, initialized = false;
  const ownedNative = new Map<string, { kind: string; path: string }>();
  const initialSystemPrompt = readFileSync(fileURLToPath(new URL(manifest ? './prompts/self_root_system.md' : './prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
  let forcedBaseline = initialSystemPrompt;
  let injectedSkillsSection = '';
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const persistLiveSelf = (event?: string, value?: unknown) => {
    const snapshot = agentSelf.snapshot();
    mkdirSync(dirname(liveSelfPath), { recursive: true });
    writeFileSync(liveSelfPath + '.next', JSON.stringify(evo ? evo.export() : { snapshot, history: agentSelf.history() }, null, 2));
    renameSync(liveSelfPath + '.next', liveSelfPath);
    if (event) appendFileSync(join(root, 'harness', 'live_agent_self.jsonl'), JSON.stringify({ time: new Date().toISOString(), event, value, self_revision: agentSelf.revision, orchestration_revision: agentSelf.current.revision, step: agentSelf.step, components: agentSelf.allComponents().map((component: any) => ({ kind: component.kind, name: component.name, version: component.version, hash: component.hash, enabled: component.enabled })) }) + '\n');
  };
  // Evidence facts only: what has run since the last completed render. No gate, no instruction — the agent still
  // decides whether to check; this makes "has this revision been checked" a visible fact instead of a hidden one.
  // Counters are per process (a resumed process starts at zero).
  const evidence = { revision: Number(state.lastFeedback?.revision ?? 0), toolRuns: 0, childRuns: 0, artifactWrites: 0 };
  const evidenceLine = () => `Since render v${evidence.revision}: ${evidence.toolRuns} native tool runs, ${evidence.childRuns} subagent runs, ${evidence.artifactWrites} artifact writes; component activity recorded: ${evidence.toolRuns + evidence.childRuns > 0 ? 'yes' : 'no'}.`;
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
    if (row?.event === 'native_file_write' && typeof row.path === 'string' && row.path.startsWith('artifacts/')) {
      agentSelf.invalidateArtifact();
      persistLiveSelf('artifact_invalidated', { path: row.path, via: 'native runtime write' });
    }
    if (file === 'component_runs.jsonl' && row?.kind === 'tool') evidence.toolRuns += 1;
    if (file === 'consult_runs.jsonl') evidence.childRuns += 1;
    if (file === 'component_runs.jsonl' && ['program_call', 'tool', 'save', 'program_save'].includes(row?.kind)) lineageUse(row);
    if (file === 'consult_runs.jsonl' && row?.role) lineageUse({ ...row, role: row.role, kind: 'subagent' });
    appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), session_id: sessionId, batch: state.batch, ...row })+'\n');
  };
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], terminate });
  const registerTool = pi.registerTool.bind(pi);
  (pi as any).registerTool = (tool: any) => registerTool({ ...tool, execute: async (...args: any[]) => {
    const began = Date.now();
    let result;
    try { if (evo) evo.allowTool(tool.name, args[1]); result = await tool.execute(...args); }
    catch (error) {
      if (evo && ['reflect_component','reflect_orchestration'].includes(tool.name)) evo.abortTransaction(error);
      if (evo) await evo.event(args[2]?.aborted ? 'tool_cancelled' : 'tool_failed',`tool:${args[0]}`, { tool: tool.name, args: args[1], error: String(error), duration_ms: Date.now()-began });
      persistLiveSelf(); throw error;
    }
    if (evo) {
      evo.fact('tool_result', { tool: tool.name, input_hash: hash(args[1]), result, duration_ms: Date.now()-began });
      await evo.event(result?.isError ? 'tool_failed' : 'tool_succeeded',`tool:${args[0]}`, { tool: tool.name, input_hash: hash(args[1]), duration_ms: Date.now()-began });
      persistLiveSelf();
    }
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
  let unknownUsageReserveTokens = Number(process.env.PPT_DEMO_REQUEST_RESERVE_TOKENS ?? 12000);
  let requestReserve = reserve;
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
  const runtime = new NativeRuntime({ pi, workspace, self: agentSelf, state: snapshot, level: () => 0,
    actionCount: () => state.batch, decision: () => state.batch,
    // No forced read-only ADAPT turn: the phase a checkpoint records is informational; the agent decides what its
    // engineering turns may do, as it decides the workflow itself.
    hookTurn: () => false,
    consultReasoning: (process.env.PPT_DEMO_THINKING ?? 'high') as 'low' | 'medium' | 'high',
    modelResult: async create => {
      if (experimentManifest) throw Error('this experiment authorizes one serial agent; child provider calls are disabled');
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
  const assertNativeName = (name: string, kind: string, path?: string) => {
    if (kind !== 'tool' && kind !== 'subagent') return;
    const prior = ownedNative.get(name);
    if (prior && (prior.kind !== kind || prior.path !== path)) throw Error(`native tool name ${name} is already owned by ${prior.kind}`);
    const existing = pi.getAllTools().find(tool => tool.name === name);
    if (existing && !prior) throw Error(`native tool name ${name} is owned by the host or another extension`);
  };
  // The reflection kernel updates the Pi-facing capability surface as part of the same object write.
  // The Agent makes one reflection call; it does not perform a second publish/assembly operation.
  agentSelf.onReflection = change => {
    if (evo) {
      for (const component of agentSelf.active().filter(c=>c.kind==='tool')) {
        assertNativeName(component.name,component.kind,component.path);
        ownedNative.set(component.name,{kind:component.kind,path:component.path});
      }
      runtime.register(); if (!activatingEvo) persistLiveSelf('request_boundary_reflected', { revision: agentSelf.revision }); return;
    }
    const component = change.component;
    if (component) {
      assertNativeName(component.name, component.kind, component.path);
      runtime.register();
      if (component.kind === 'tool' || component.kind === 'subagent') {
        ownedNative.set(component.name, { kind: component.kind, path: component.path });
        pi.setActiveTools([...new Set([...pi.getActiveTools(), component.name])]);
      }
    }
    persistLiveSelf(change.kind === 'component' ? 'component_hot_reflected' : 'orchestration_hot_reflected',
      component ? { kind: component.kind, name: component.name, version: component.version, hash: component.hash } : undefined);
  };
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
  for (const tool of workspace.fileTools()) {
    if (tool.name !== 'read') { pi.registerTool(tool); continue; }
    const execute = tool.execute;
    pi.registerTool({ ...tool, execute: async (id: string, args: any, signal: any, update: any, ctx: any) => {
      const result = await execute(id, args, signal, update, ctx);
      return result;
    } });
  }
  workspace.onWrite = async path => {
    if (path.startsWith('artifacts/')) evidence.artifactWrites += 1;
    if (path.startsWith('artifacts/') && agentSelf) {
      agentSelf.invalidateArtifact();
      persistLiveSelf('artifact_invalidated', { path });
    }
    // A direct file write is an agent edit with no recorded run behind it; lineage says so instead of guessing.
    lineage.writes.set(path, (lineage.writes.get(path) ?? 0) + 1);
    if (!/^(tools|lib|skills|agents|prompts|notes)\//.test(path)) lineage.unattributed.add(path);
    return undefined;
  };
  register('python', 'Run Python in the confined workspace sandbox. Files under the workspace are read and written with open(path) — text or binary ("rb"/"wb"), any file type (images, decks, data). Harness component paths require reflect_component. Returns what you print and the value of a final expression.',
    Type.Object({ code: Type.String({ minLength: 1, maxLength: 65536 }) }),
    async (a: any, signal: any) => runtime.python(a.code, signal, false));
  register('read_self_component', 'Read a component directly from the live Agent mirror by kind, name, and optional version.',
    Type.Object({ kind: Type.Union([Type.Literal('tool'), Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('subagent'), Type.Literal('memory')]),
      name: Type.String(), version: Type.Optional(Type.Integer({ minimum: 1 })) }), async (a: any) => {
      const path = a.kind === 'tool' ? `tools/${a.name}.py` : a.kind === 'prompt' ? `prompts/${a.name}.md`
        : a.kind === 'skill' ? `skills/${a.name}/SKILL.md` : a.kind === 'subagent' ? `agents/${a.name}.md` : `notes/memory/${a.name}.md`;
      const currentVersion = agentSelf.versionMap()[path];
      const version = a.version ?? currentVersion;
      const component = agentSelf.allComponents().find((row: any) => row.path === path && row.version === version);
      const source = component?.source ?? (version === undefined ? undefined : agentSelf.sourceOf(path, version));
      if (source === undefined) throw Error(`no ${a.kind} ${a.name}${a.version ? ` at v${a.version}` : ' in the active Agent'}`);
      return text({ kind: a.kind, name: a.name, version: component?.version ?? version, source });
    });
  register('reflect_component', 'Directly hot-reflect a capability into the active Agent object. No component file is written and no intermediate publisher assembles it. Provide the current Agent self revision shown in the mirror.' + (evo ? ' Activation is before the next request. A tool may declare # parameters: followed by a JSON object schema in its first ten lines; source and schema change together.' : ''),
    Type.Object({ baseRevision: Type.Integer({ minimum: 1 }), op: Type.Union([Type.Literal('define'), Type.Literal('redefine'), Type.Literal('restore')]),
      name: Type.String(), kind: Type.Union([Type.Literal('tool'), Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('subagent'), Type.Literal('memory')]),
      source: Type.Optional(Type.String()), version: Type.Optional(Type.Integer({ minimum: 1 })), note: Type.Optional(Type.String()), ...(evo ? {validation: Type.Optional(Type.Any())} : {}) }), async (a: any) => {
      const path = a.kind === 'tool' ? `tools/${a.name}.py` : a.kind === 'prompt' ? `prompts/${a.name}.md`
        : a.kind === 'skill' ? `skills/${a.name}/SKILL.md` : a.kind === 'subagent' ? `agents/${a.name}.md` : `notes/memory/${a.name}.md`;
      try {
        if (experimentLimits && a.kind === 'subagent') throw Error('experiment authorizes one agent; no task subagents');
        assertNativeName(a.name, a.kind, path);
        const result = await agentSelf.reflectComponent({ ...a, level: 0, origin: { by: 'agent', decision: state.batch } });
        if (evo) return text(result);
        log('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind,
          version: result.component.version, hash: result.component.hash, self_revision: result.revision,
          note: a.note, ok: true, activation: 'live Agent object' });
        return text({ ok: true, selfRevision: result.revision, name: a.name, kind: a.kind,
          purpose: result.component.description, version: result.component.version, reflected: 'directly into active Agent object' });
      } catch (error) {
        log('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind,
          self_revision: agentSelf.revision, note: a.note, ok: false, error: String(error) });
        if (evo) throw error;
        return text({ ok: false, selfRevision: agentSelf.revision, name: a.name, kind: a.kind, error: String(error) });
      }
    });
  register('reflect_orchestration', 'Directly revise the active Agent orchestration. Submit a complete object and the current Agent self revision; this updates the same live Agent object used for components.',
    Type.Object({ baseRevision: Type.Integer({ minimum: 1 }), orchestration: Type.Any(), carry: Type.Optional(Type.Any()), note: Type.Optional(Type.String()) }), async (args: any) => {
      const result = agentSelf.reflectOrchestration({ baseRevision: args.baseRevision, orchestration: args.orchestration, carry: args.carry, authorized: true });
      return text({ ...result, active: agentSelf.mirror() });
    });
  register('decide', 'Submit an Agent-authored decision against trusted action receipts. The live orchestration checks evidence and applies its declared transition.',
    Type.Object({ decisionId: Type.String(), evidenceRefs: Type.Array(Type.String()), result: Type.Any() }), async (args: any) => {
      const activeHash = currentSourceFacts()?.hash;
      if (activeHash !== agentSelf.snapshot().latestArtifactHash) {
        agentSelf.invalidateArtifact();
        persistLiveSelf('artifact_invalidated', { reason: 'current source hash differs from latest rendered artifact' });
      }
      const decision = agentSelf.decide({ decisionId: args.decisionId, actor: 'agent', evidenceRefs: args.evidenceRefs, result: args.result });
      const transition = agentSelf.advance();
      persistLiveSelf('decision_and_transition', { decision, transition });
      return text({ decision, transition, active: agentSelf.mirror() });
    });
  if (evo && manifest) installSelfRootTools({ pi, evo, manifest, root, workspace, text, persist: persistLiveSelf });
  const officeParameters = Type.Object({ op: Type.Union([Type.Literal(PPT_ACTIONS[0]), Type.Literal(PPT_ACTIONS[1]), Type.Literal(PPT_ACTIONS[2])]),
    source_path: Type.Optional(Type.String()), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))), revision: Type.Optional(Type.Integer({ minimum: 1 })),
    self_review: Type.Optional(Type.Object({ disposition: Type.Union([Type.Literal('keep'), Type.Literal('defer'), Type.Literal('change')]), rationale: Type.String() })) });
  register('office', OFFICE_ACTION_DESCRIPTION, officeParameters,
    async (a: any, signal: AbortSignal, ctx: any) => {
      if (evo && a.op === 'deliver') {
        const boundary = `delivery:${currentSourceFacts()?.hash}`;
        const routed = await evo.event('before_delivery', boundary);
        if (!(routed as any).duplicate) {
          await evo.event('before_session_end', boundary);
          persistLiveSelf();
          return text({ delivery_pending: true, boundary, review: 'queued for next request; repeat delivery after review' });
        }
        if (evo.mode !== 'execute') throw Error('delivery awaits review exit');
      }
      agentSelf.assertActionAllowed(`office.${a.op}`);
      if (a.op === 'render') {
        const sourcePath = a.source_path ?? canonical();
        if (!sourcePath) throw Error('Choose source_path from an existing file under artifacts/, or create artifacts/presentation.html or artifacts/deck.json as the canonical source.');
        if (!sourcePath.startsWith('artifacts/') || !/\.(json|html)$/i.test(sourcePath)) throw Error('Render source must be JSON or HTML under artifacts/.');
        const source = workspace.path(sourcePath);
        if (!existsSync(source)) throw Error(`Render source does not exist: ${sourcePath}`);
        const revision = ++state.revision; persist();
        const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_html.py', import.meta.url));
        const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, source, String(revision)], { encoding: 'utf8', timeout: 300000, maxBuffer: 4*1024*1024, windowsHide: true });
        if (child.error || child.status !== 0) {
          if (evo && manifest) evo.outcome({ source:'protected_acceptance', checker:manifest.checker, unit:'whole_deck',
            artifact:{path:sourcePath,sha256:fileHash(sourcePath)}, renderer:{exit:child.status,error:String(child.error ?? child.stderr),original_output:child.stdout}, status:'render_failed' });
          throw Error((child.stderr || String(child.error)).slice(-5000));
        }
        const receipt = JSON.parse(child.stdout);
        const acceptance = experimentManifest ? collectAcceptance(experimentManifest, root, workspace, sourcePath, receipt, child.status) : undefined;
        if (evo && acceptance) { evo.outcome(acceptance); persistLiveSelf(); }
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
        const orchestrationAction = agentSelf.recordAction('office.render', { artifactVersion: revision,
          artifactHash: receipt.source_sha256, sourcePath, evidencePath, slides: receipt.slides, renderer: receipt.renderer }, true);
        persistLiveSelf('action_receipt', orchestrationAction);
        // Facts about the period that just ended (how the previous revision was checked), then the new period starts.
        const sincePrevious = evidenceLine();
        const lineageSince = lineageLine();
        evidence.revision = revision; evidence.toolRuns = 0; evidence.childRuns = 0; evidence.artifactWrites = 0;
        lineage.revision = revision; lineage.uses.clear(); lineage.writes.clear(); lineage.unattributed.clear();
        return { content: [...text({ render: state.lastFeedback, acceptance, evidence: sincePrevious, lineage: lineageSince, state: statusText(), orchestration_action: orchestrationAction }).content,
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
        const renderedReceipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
        const orchestrationAction = agentSelf.recordAction('office.look', { artifactVersion: Number(revision),
          artifactHash: renderedReceipt.source_sha256, pages: wanted.map((name: string) => Number(name.match(/\d+/)?.[0])) });
        persistLiveSelf('action_receipt', orchestrationAction);
        const images = wanted.map((n: string) => ({ type: 'image', data: readFileSync(join(out, n)).toString('base64'), mimeType: 'image/png' }));
        return { content: [...text({ orchestration_action: orchestrationAction }).content, ...images] };
      }
      const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
      const deliveryError = deliveryIntegrity(workspace, receipt, canonical(), revision, state.lastFeedback?.revision, fileHash);
      if (deliveryError) throw Error(deliveryError);
      let selfReview: any;
      if (!evo && !a.self_review) throw Error('Delivery requires a self-review record for the current orchestration revision.');
      selfReview = evo ? { recorded_in: 'same-root ledger' } : agentSelf.recordSelfReview({ revision: agentSelf.current.revision,
        disposition: a.self_review.disposition, rationale: a.self_review.rationale });
      persistLiveSelf('self_review', selfReview);
      const currentHash = fileHash(receipt.source_path);
      const delivery = join(root, 'delivery'); mkdirSync(delivery, { recursive: true });
      // The rendered revision, not one file: the presentation plus every page image and the receipt. The render
      // directory (the HTML with its relative assets intact) is delivered too; only the browser profile is skipped.
      for (const entry of readdirSync(out)) {
        if (entry === 'browser-profile') continue;
        cpSync(join(out, entry), join(delivery, entry), { recursive: true });
      }
      mkdirSync(join(delivery, 'harness'), { recursive: true });
      const components = agentSelf.active();
      for (const c of components) { const path = join(delivery, 'harness', c.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, c.source); }
      writeFileSync(join(delivery, 'harness.json'), JSON.stringify({ components: components.map(c => ({ name: c.name, kind: c.kind, version: c.version, path: c.path, hash: c.hash })),
        artifact_sha256: currentHash }, null, 2));
      for (const relative of ['harness/component_runs.jsonl', 'harness/tools.jsonl', 'harness/lifecycle.jsonl', 'harness/renders.jsonl', 'harness/usage.jsonl', 'harness/live_agent_self.jsonl',
        'harness/consult_runs.jsonl', 'harness/model-usage.jsonl', 'harness/provider-requests.jsonl', 'session.jsonl']) {
        const source = join(root, relative);
        if (!existsSync(source)) continue;
        const target = join(delivery, 'harness-evidence', relative.replace(/^\.harness\//, ''));
        mkdirSync(join(target, '..'), { recursive: true }); cpSync(source, target);
      }
      if (evo && manifest) {
        evo.outcome(collectAcceptance(manifest, root, workspace, receipt.source_path, receipt, 0));
        const delivered = new Set(evo.export().root.ledger.filter((r: any) => r.type === 'unit_delivered').map((r: any) => r.value.unit));
        for (const unit of manifest.units) if (!delivered.has(unit.id)) {
          evo.outcome(collectAcceptance(manifest, root, workspace, receipt.source_path, receipt, 0, unit.id), true);
          evo.fact('unit_delivered', { unit: unit.id, via: 'whole_deck_delivery' });
        }
        persistLiveSelf();
      }
      state.complete = true; state.deliveredRevision = revision; persist(); log('lifecycle.jsonl', { event: 'delivered', revision });
      const orchestrationAction = agentSelf.recordAction('office.deliver', { artifactVersion: Number(revision), artifactHash: currentHash, sourcePath: receipt.source_path });
      persistLiveSelf('action_receipt', orchestrationAction);
      const liveTrace = join(root, 'harness', 'live_agent_self.jsonl');
      if (existsSync(liveTrace)) {
        const target = join(delivery, 'harness-evidence', 'harness', 'live_agent_self.jsonl');
        mkdirSync(dirname(target), { recursive: true }); cpSync(liveTrace, target);
      }
      return text({ delivered: revision, directory: 'delivery/', evidence: evidenceLine(), self_review: selfReview, orchestration_action: orchestrationAction }, true);
    });
  pi.on('before_agent_start', async (event: any) => {
    if (!initialized) {
      // Initial capabilities are fields on the live Agent object, not workspace files.
      if (!agentSelf.active().some((component: any) => component.path === 'prompts/ppt_baseline_guidance.md'))
        await agentSelf.seedComponent('prompt', 'ppt_baseline_guidance', initialSystemPrompt);
      persistLiveSelf();
      log('lifecycle.jsonl', { event: 'initial_registry', components: agentSelf.active().map(c => ({ kind: c.kind, name: c.name, version: c.version, hash: c.hash })) });
      const nativeComponents = agentSelf.active().filter(c => c.kind === 'tool' || c.kind === 'subagent');
      for (const c of nativeComponents) {
        assertNativeName(c.name, c.kind, c.path);
        const prior = ownedNative.get(c.name);
        if (prior) throw Error(`native tool name ${c.name} has multiple component definitions`);
        ownedNative.set(c.name, { kind: c.kind, path: c.path });
      }
      runtime.register();
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...nativeComponents.map(c => c.name)])]);
      initialized = true;
    }
    resumed = event.prompt === 'PPT_RESUME';
    if (freshBatch && !resumed && state.batchRequests >= batchLimit && !state.batchClosed) {
      state.nextPhase = 'task'; state.noteStale = true; state.batchClosed = true;
      log('lifecycle.jsonl', { event: 'batch_closed', reason: 'request_limit', requests: state.batchRequests, limit: batchLimit });
    }
    const handoff = state.noteStale ? '(none: the last batch closed at its request limit)' : state.note || '(none)';
    const memory = agentSelf.active().filter((component: any) => component.kind === 'memory')
      .map((component: any) => `## ${component.name}@v${component.version}\n${component.source}`).join('\n');
    const memoryBlock = `TASK MEMORY\n${memory || '(none saved)'}`;
    if (!resumed) {
      state.batch++; state.batchRequests = 0; state.batchClosed = false;
      state.phase = state.nextPhase ?? 'task'; state.nextPhase = state.phase;
      if (state.noteStale) { state.note = ''; state.noteStale = false; }
      persist();
    }
    // Agent-created tools stay active across batches: setActiveTools unions in everything registered.
    const selected = new Set(['read', 'write', 'edit', 'ls', 'grep', 'python', 'reflect_component', 'read_self_component', 'office', 'reflect_orchestration', 'decide']);
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...selected])]);
    // A forced prompt is reapplied by Pi AFTER context_with_system and would erase the live Mirror.
    if (evo) {
      await advanceEvoBoundary();
      return { message: { customType: 'same-root-window', content: 'Continue this task in the same root and serial session.', display: false } };
    }
    const baselinePrompt = agentSelf.active().find(c => c.kind === 'prompt' && c.name === 'ppt_baseline_guidance')?.body
      ?? readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
    const taskGuidancePath = workspace.path('AGENTS.md');
    const taskGuidance = existsSync(taskGuidancePath) ? readFileSync(taskGuidancePath, 'utf8') : '';
    forcedBaseline = baselinePrompt;
    const systemPrompt = [baselinePrompt, taskGuidance].filter(Boolean).join('\n\n');
    event.systemPromptOptions ??= {};
    event.systemPromptOptions.forceSystemPrompt = systemPrompt;
    log('lifecycle.jsonl', { event: resumed ? 'resume' : 'batch_started' });
    if (!freshBatch) return { systemPrompt, message: { customType: 'ppt-task-memory', content: memoryBlock, display: false } };
    const deadline = Number(process.env.PPT_DEMO_DEADLINE);
    const handoffMessage = [`FRESH CONTEXT: batch ${state.batch}, phase ${state.phase}. Earlier batches are not in this conversation. Carried over: workspace files; prompts in the system prompt; memory in full; native tools and skill index; the handoff note.`,
      `Handoff note: ${handoff}.`, `Time left: ${Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} min; budget left: $${Math.max(0, cap - spent).toFixed(2)}; requests per batch: ${batchLimit}.`,
      memoryBlock, statusText()].join('\n\n');
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
  const addCurrentContext = (system: any) => {
    if (evo) return;
    const prompts = agentSelf.active().filter((component: any) => component.kind === 'prompt' && component.name !== 'ppt_baseline_guidance');
    const memories = evo ? evo.memory() : agentSelf.active().filter((component: any) => component.kind === 'memory');
    const skills = agentSelf.active().filter((component: any) => component.kind === 'skill');
    const additions = [
      ...prompts.map((component: any) => ({ kind: 'prompt', name: component.name, version: component.version, text: component.body })),
      ...memories.map((component: any) => ({ kind: 'memory', name: component.name, version: component.version, text: component.source })),
    ];
    const baselinePrompt = agentSelf.active().find((component: any) => component.kind === 'prompt' && component.name === 'ppt_baseline_guidance');
    const nextBaseline = baselinePrompt?.body ?? initialSystemPrompt;
    const skillsSection = skills.length ? `## Agent skills\n${skills.map((skill: any) =>
      `- ${skill.name}@v${skill.version}: ${skill.description}. Read with read_self_component(kind="skill", name="${skill.name}").`).join('\n')}` : '';
    let content = typeof system.content === 'string' ? system.content : '';
    if (content.includes(forcedBaseline)) content = content.replace(forcedBaseline, nextBaseline);
    else if (!content.includes(nextBaseline)) content += `\n\n${nextBaseline}`;
    const appended = additions.filter(item => item.kind !== 'prompt' || !content.includes(item.text))
      .map(item => `\n\n## ${item.kind.toUpperCase()} ${item.name}\n${item.text}`).join('');
    const selfView = agentSelf.mirror();
    const liveSelfBlock = `\n\n## LIVE AGENT SELF\nThis is the same Agent executing the task. Components and orchestration are fields on this object. reflect_component and reflect_orchestration atomically replace those fields directly; no component workspace file or intermediate publication step is involved. The runtime executes from the active object. Use the current root revision for either reflection call. read_self_component reads the active component object and its retained revisions. You define task-specific judgments, evidence and transitions; the host checks object shape, authorization and evidence integrity. A successful office action returns a trusted action receipt; cite those exact IDs in decide. At delivery, include self_review for the current orchestration revision.\n\n${JSON.stringify({
      root: { id: sessionId, runtime: 'Pi extension host', model: process.env.PPT_DEMO_MODEL ?? 'provider-selected', object: 'complete running Agent' },
      protectedBase: [{ id: 'pi-runtime', role: 'provider requests, tool registry, extension lifecycle' }, { id: 'workspace-boundary', role: 'path confinement' }, { id: 'budget-boundary', role: 'request, cost and deadline enforcement' }, { id: 'office-adapter', role: 'real render, look and deliver actions' }],
      self: selfView,
      taskRuntime: { goal: PPT_GOAL, source: currentSourceFacts(), state: { revision: state.revision, latestRender: state.lastFeedback ?? null,
        renderedRevisions: (state.renderedRevisions ?? []).slice(-8), complete: state.complete, deliveredRevision: state.deliveredRevision ?? null } },
      grantedOperations: ['reflect_component(baseRevision,op,kind,name,source)', 'reflect_orchestration(baseRevision, orchestration)', 'read_self_component(kind,name,version?)', 'decide(decisionId,evidenceRefs,result)'],
      evidenceRule: 'Action receipts exist only after successful host actions. A render receipt binds the source hash and rendered revision; source edits invalidate current-artifact evidence.'
    }, null, 2)}`;
    if (injectedSkillsSection && content.includes(injectedSkillsSection)) content = content.replace(injectedSkillsSection, '');
    system.content = `${content}${appended}${liveSelfBlock}${skillsSection ? `\n\n${skillsSection}` : ''}`;
    log('live_agent_self.jsonl', { event: 'self_view_injected', revision: agentSelf.revision,
      orchestration_revision: agentSelf.current.revision, step: agentSelf.step,
      component_versions: agentSelf.active().map((component: any) => ({ kind: component.kind, name: component.name, version: component.version })) });
    injectedSkillsSection = skillsSection;
    if (skillsSection) log('lifecycle.jsonl', { event: 'skill_index_exposed', skills: skills.map((component: any) => ({ name: component.name, version: component.version, hash: component.hash })) });
    for (const item of additions) log('lifecycle.jsonl', { event: 'component_consumed', ...item, text: undefined, boundary: 'provider request' });
    if (baselinePrompt) log('lifecycle.jsonl', { event: 'component_consumed', kind: 'prompt', name: baselinePrompt.name,
      version: baselinePrompt.version, boundary: 'provider request' });
  };
  let evoRequestStarted = 0;
  if (evo) {
    const applySurface = (actions: string[]) => {
      const names = [...new Set(actions.map(name => name.startsWith('office.') ? 'office' : name))];
      const known = new Set(pi.getAllTools().map(t => t.name));
      if (names.some(name => !known.has(name))) throw Error(`unregistered mode tool: ${names.filter(name => !known.has(name)).join(',')}`);
      pi.setActiveTools(names);
      if (hash([...pi.getActiveTools()].sort()) !== hash([...names].sort())) throw Error('tool surface refresh mismatch');
    };
    advanceEvoBoundary = async () => {
      activatingEvo = true;
      try { await evo.boundary(applySurface,persistLiveSelf); }
      catch (error) {
        evo.fact('request_paused', { error: String(error) }); persistLiveSelf();
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason: String(error), resources: evo.resources() }));
        process.exit(0);
      } finally { activatingEvo = false; }
      persistLiveSelf();
    };
    // Pi snapshots executable tools before context_with_system. Commit after the
    // whole response's tools finish, before its next-turn executable refresh.
    pi.on('turn_end', async (event: any) => {
      // Pi rejects malformed arguments before tool_result hooks. Its completed
      // turn receipts include those rejections and precede our commit boundary.
      for (const result of event.toolResults ?? []) if (result.isError) {
        if (['reflect_component','reflect_orchestration'].includes(result.toolName)) evo.abortTransaction(JSON.stringify(result.content));
        await evo.event('tool_failed',`tool:${result.toolCallId}`,{tool:result.toolName,content:result.content});
      }
      await advanceEvoBoundary();
    });
    pi.on('session_start', async () => { await evo.event('window_entry','session-window'); persistLiveSelf(); });
    pi.on('context_with_system', async (event: any) => {
      try {
        evo.guard(directoryBytes(root));
        const pin = evo.pin(); evoRequestStarted = Date.now();
        const messages = [...event.messages];
        const system = { ...messages[0] };
        if (system.role !== 'system') throw Error('missing system message');
        // Rebuild the actual schema, including office sub-operations, for this request.
        const actions = evo.surface(), names = new Set(pi.getActiveTools());
        system.toolsAdded = pi.getAllTools().filter(t => names.has(t.name)).map(t => {
          const parameters = structuredClone(t.parameters) as any;
          if (t.name === 'office') parameters.properties.op = { type: 'string', enum: actions.filter(x => x.startsWith('office.')).map(x => x.slice(7)) };
          // Type the operation, not the mode name. Other decisions retain their
          // declared result shapes; exit uses the Agent's pinned schema.
          if (t.name === 'decide') parameters.allOf = [{
            if: { properties: { op: { const: 'exit' } }, required: ['op'] },
            then: { properties: { result: evo.reviewExitSchema ?? { type: 'object' } }, required: ['result'] },
          }];
          return { name: t.name, description: t.description, parameters };
        });
        // Older tool additions/removals must not re-open a suspended capability later in history.
        for (let i = 1; i < messages.length; i++) if (messages[i].role === 'system') { messages[i] = { ...messages[i] }; delete messages[i].toolsAdded; delete messages[i].toolsRemoved; }
        const groups: Record<string,string> = {
          prompts: agentSelf.active().filter(c => c.kind === 'prompt').map(c => c.body).join('\n\n'),
          memory: evo.memory().map(c => `${c.name}@${c.version}\n${c.source}`).join('\n\n'),
          skills: agentSelf.active().filter(c => c.kind === 'skill').map(c => `${c.name}@${c.version}: ${c.description}; read_self_component`).join('\n'),
        };
        const taskInstructions = existsSync(workspace.path('data/instructions.md')) ? workspace.read('data/instructions.md') : '';
        system.content = [taskInstructions, ...evo.policy.context.order.map(k => groups[k]), evo.policy.context.instruction,
          'SELF ROOT: one agent, one session. Protocol: read_self expands policy/ledger/lineage; reflect_component or reflect_orchestration queues a candidate until the next request. decide(op="enter_mode",mode=...) changes attention; decide(op="exit",status="deferred",subtype="keep",result={reason:...},evidenceRefs=[]) can keep the current method. changed requires activation; keep is not unrelated. Validation decisions compare task facts; no required modification. office.deliver hands over the whole deck; submit_unit supports partial handover.',
          JSON.stringify(evo.mirror()), JSON.stringify(await evo.projection())].join('\n\n');
        messages[0] = system;
        evo.fact('provider_input', { pin, schema_hash: hash(system.toolsAdded), tools: system.toolsAdded.map((t: any) => t.name), context_hash: hash(system.content), memory_versions: evo.memory().map(c => ({ name:c.name,version:c.version })), complete_input_ref: 'harness/provider-requests.jsonl' });
        persistLiveSelf();
        return { messages };
      } catch (error) {
        evo.fact('request_paused', { error: String(error) }); persistLiveSelf();
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason: String(error), resources: evo.resources() }));
        process.exit(0); // Pi event exceptions are fail-open: never send inconsistent tools/definitions.
      }
    });
    pi.on('agent_end', async () => {
      evo.closeIncomplete('plain-text/technical end without decide exit');
      if (!state.complete && !evo.isResetting) await evo.event('before_session_end','normal-session-end');
      persistLiveSelf();
    });
    pi.on('session_before_compact', (event: any) => {
      if (event.customInstructions?.startsWith('SELFROOT_SUMMARY\n')) return { compaction: {
        summary:event.customInstructions.slice('SELFROOT_SUMMARY\n'.length), firstKeptEntryId:event.preparation.firstKeptEntryId,
        tokensBefore:event.preparation.tokensBefore, details:{ source:'same Agent explicit continuity summary', root_id:evo.root_id } } };
      evo.fact('coverage_gap',{ reason:'unexpected compaction; no pre-review or same-Agent summary', pre_review:false }); persistLiveSelf();
      return { cancel:true }; // Never hide an additional summarizer/model lifecycle or unmetered call.
    });
    pi.on('session_compact', (event: any) => { evo.fact('context_restored',{ reason:event.reason, root_id:evo.root_id, evidence_recovery:'read_self' }); persistLiveSelf(); });
    pi.on('session_shutdown', () => { evo.closeIncomplete('session shutdown'); persistLiveSelf(); });
  }
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  pi.on('before_provider_request', (event: any) => {
    let payload = event.payload as any;
    const system = typeof payload?.systemPrompt === 'string' ? { content: payload.systemPrompt }
      : payload?.messages?.find((message: any) => message.role === 'system');
    if (system) {
      addCurrentContext(system);
      if (typeof payload.systemPrompt === 'string') payload.systemPrompt = system.content;
    }
    let permit;
    if (experimentManifest?.settings?.model) {
      const model = experimentManifest.settings.model;
      const output = evo?.policy.request?.maxOutputTokens ?? experimentManifest.settings.request_output_tokens ?? model.maxTokens;
      if (output > model.maxTokens) {
        evo?.closeIncomplete('output envelope exceeds registered model'); persistLiveSelf();
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason:'output envelope exceeds registered model', output })); process.exit(0);
      }
      permit = providerPermit(payload, model, output, { input: Math.max(inputRate,cacheReadRate,cacheWriteRate), output: outputRate });
      payload = permit.payload; requestReserve = permit.usd; unknownUsageReserveTokens = permit.tokens;
    }
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + requestReserve > cap ||
      (experimentLimits && (requests >= experimentLimits.requests || tokensSpent + unknownUsageReserveTokens > experimentLimits.tokens || directoryBytes(root) >= experimentLimits.storage_bytes))) {
      evo?.closeIncomplete('authorized budget boundary'); persistLiveSelf();
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, permit: permit ? { ...permit, payload: undefined } : undefined, reason: 'authorized budget boundary' }));
      process.exit(0); // Pi event exceptions are fail-open: stop before HTTP.
    }
    spent += requestReserve; reserved = requestReserve;
    if (freshBatch) state.batchRequests = (state.batchRequests ?? 0) + 1;
    log('provider-requests.jsonl', { request: ++requests, batch_request: state.batchRequests, estimated_usd_so_far: spent,
      permit: permit ? { ...permit, payload: undefined } : { usd: requestReserve, tokens: unknownUsageReserveTokens },
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
    if (freshBatch) persist();
    return payload;
  });
  let settledRequest = lastUsage?.request ?? 0;
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'assistant') {
      // Pi can synthesize an aborted assistant while compacting without sending
      // a request. Only an actually dispatched request owns usage/cost.
      if (requests <= settledRequest) return;
      settledRequest = requests;
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (evo) {
        const estimate = known ? ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6 : requestReserve;
        evo.cost(u,Date.now()-evoRequestStarted,estimate,known,unknownUsageReserveTokens);
        persistLiveSelf();
      }
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent,
        conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
    }
  });
}
