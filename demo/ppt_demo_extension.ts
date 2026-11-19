/** PPT host whose writable capability objects live directly on the active Agent.
 *
 * Free-hands revision (2026-11-04): the preset quality workflow is gone. No quality map, no automatic checks or
 * coverage reviews on render, no delivery gate beyond the integrity of what is delivered (the rendered source is
 * still the source being delivered). The agent decides its own workflow; the host provides facts (statusText),
 * facilities (Python, native resources, render/look/deliver) and the hard boundaries only: budget,
 * deadline, path confinement, provider authorization.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { projectAgentHistory } from './self_root_context.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';
import { canonicalPath, sourceFacts, deliveryIntegrity, statusFacts, PPT_GOAL, PPT_ACTIONS, OFFICE_ACTION_DESCRIPTION } from './ppt_demo_adapter.ts';
import { LiveAgentSelf } from './live_orchestration_core.ts';
import { SelfRoot, hash, normalizeOperation } from './self_root.ts';
import { providerPermit } from './provider_permit.ts';
import { installSelfRootTools, type SelfRootManifest, collectAcceptance, directoryBytes, PPT_SELF_ROOT_OPTIONS, selfRootToolSchema, pptUnitMetrics } from './self_root_ppt.ts';
import { createPiContextAdapter, deliveredImageRefs, normalizeStop, cacheSupported } from './pi_context_adapter.ts';

function refreshResourceDaemon(root: string) {
  if (!root) return;
  try {
    const helper = fileURLToPath(new URL('../src/autoresearch_pi/resource_daemon.py', import.meta.url));
    const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, 'refresh', root], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    if (child.error || child.status !== 0) return;
    return JSON.parse(child.stdout || 'null');
  } catch { return; }
}
function syncDaemonResources(root: string, agent?: SelfRoot) {
  try {
    const record = refreshResourceDaemon(root);
    if (record && agent) agent.adoptDaemonResources(record);
  } catch { return; }
}

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const manifest: SelfRootManifest | undefined = process.env.EVO_MANIFEST ? JSON.parse(readFileSync(process.env.EVO_MANIFEST, 'utf8')) : undefined;
  const experimentManifest = manifest ?? (process.env.PPT_EXPERIMENT_LIMITS ? JSON.parse(readFileSync(process.env.PPT_EXPERIMENT_LIMITS,'utf8')) : undefined);
  const experimentLimits = experimentManifest?.contract.budget;
  if (manifest && process.env.PPT_FRESH_BATCH === '1') throw Error('v0.1 uses one serial conversation; fresh-batch runner is disabled');
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
  state.episode ??= 1; state.usedCases ??= [];
  if (manifest?.episodes && (!manifest.episodes.length || hash(manifest.episodes) !== manifest.episodes_sha256)) throw Error('frozen episode list missing, empty or changed');
  if (manifest?.episodes && !(state.episode >= 1 && state.episode <= manifest.episodes.length)) throw Error('active episode is outside the frozen episode list');
  const activeManifest = () => { const episode = manifest?.episodes?.[state.episode - 1]; return episode ? { ...manifest, ...episode, contract: { ...manifest!.contract, acceptance: episode.acceptance } } : manifest; };
  const savedSelf = existsSync(liveSelfPath) ? JSON.parse(readFileSync(liveSelfPath, 'utf8')) : undefined;
  const piContext = createPiContextAdapter();
  // Trajectory transcript (user decision 2026-11-17: the run view carries the trajectory itself, not only its
  // counts): one line per recorded message event, tagged with the request it belongs to. Mechanical transcription
  // only - heads clipped, whitespace collapsed, data URLs scrubbed, no selection by content; the core renders the
  // pass-window slice into the evolution pass entry, and the full text stays in harness/provider-requests.jsonl.
  const trajectoryLines: string[] = [];
  const trajHead = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
  const trajArgs = (args: any) => trajHead(JSON.stringify(args ?? {}, (k, v) => typeof v === 'string' && v.startsWith('data:') ? '(image)' : v) ?? '');
  // Mechanism flags (default on; EVO_MA/MB/MC=0 turns one off, EVO_LEGACY_OBLIGATION=1 restores the pre-M-A framing).
  // EVO_A4/EVO_ASK/EVO_L4=1 turn on the capability-view items (default off for B2 comparability).
  // EVO_META=1 runs the general meta loop (2026-11-16): T0 design turn plus the agent's own review rhythm; it forces ask/l4 off.
  const EVO_MECH = { observation: process.env.EVO_MA !== '0', compiler: process.env.EVO_MB !== '0', effect_return: process.env.EVO_MC !== '0', legacy_obligation: process.env.EVO_LEGACY_OBLIGATION === '1', a4: process.env.EVO_A4 === '1', ask: process.env.EVO_ASK === '1', l4: process.env.EVO_L4 === '1', meta: process.env.EVO_META === '1' };
  const evo = manifest ? new SelfRoot(manifest.contract, savedSelf, validatePythonComponent, workspace, manifest.settings.model?.maxTokens,
    { ...PPT_SELF_ROOT_OPTIONS, mechanisms: EVO_MECH, taskComplete: () => state.complete || agentSelf?.snapshot?.().complete === true, requiredUnits: () => activeManifest()?.units.length ?? 0,
      taskEpisodes: () => manifest?.episodes && manifest.episodes.length > 1 ? { active: state.episode, total: manifest.episodes.length } : null,
      pendingDeliveryState: () => agentSelf?.hasPendingFinalDelivery?.() === true,
      deliveryTransitionReached: () => !agentSelf?.hasPendingFinalDelivery?.() || agentSelf?.pendingDeliveryTransitionReady?.() === true,
      runPendingDelivery: async () => agentSelf.hasPendingFinalDelivery() ? officeDeliver({ op: 'deliver' }, new AbortController().signal, {}, true) : undefined,
      budgetStopPendingDelivery: async () => agentSelf.hasPendingFinalDelivery() ? officeDeliver({ op: 'deliver' }, new AbortController().signal, {}, true) : undefined,
      contextItem: (ref: string) => piContext.resolve(ref), canonicalSource: () => canonicalPath(workspace),
      // META pass surfaces (user decision 2026-11-17): adapter-declared run position and recorded-evidence expansion.
      runPosition: () => ({ episode: manifest?.episodes && manifest.episodes.length > 1 ? { active: state.episode, total: manifest.episodes.length } : null,
        artifact_revision: state.revision ?? null, delivered_revision: state.deliveredRevision ?? null,
        last_render: state.lastFeedback ? { revision: state.lastFeedback.revision, warnings: Array.isArray(state.lastFeedback.warnings) ? state.lastFeedback.warnings.length : state.lastFeedback.warnings ?? null } : null }),
      adapterEvidence: (ref: string, offset = 0) => {
        const page = 16000;
        const rowsOf = (name: string) => existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
        const req = /^request:(\d+)$/.exec(ref);
        if (req) {
          const row: any = rowsOf('harness/provider-requests.jsonl').find((r: any) => Number(r.request) === Number(req[1]));
          if (!row) return { ref, state: 'missing', recorded_in: 'harness/provider-requests.jsonl' };
          const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload ?? null);
          return { ref, state: 'recorded', request: row.request, kind: row.kind ?? 'provider', composition: row.composition ?? null,
            permit: row.permit ?? null, payload_chars: payload.length, offset, payload: payload.slice(offset, offset + page),
            next_offset: offset + page < payload.length ? offset + page : null };
        }
        const art = /^artifact:v(\d+)$/.exec(ref);
        if (art) {
          const row: any = rowsOf('harness/renders.jsonl').find((r: any) => Number(r.revision) === Number(art[1]));
          return row ? { ref, state: 'recorded', render: row } : { ref, state: 'missing', recorded_in: 'harness/renders.jsonl' };
        }
        return { ref, state: 'missing', known_prefixes: ['request:', 'artifact:v'] };
      },
      adapterTrajectory: () => trajectoryLines,
      metricInfo: (metrics: any[]) => ({ primary: metrics.find(m => m.name === 'acceptance.required_found')?.name, better: 'higher', scope: 'whole_deck' }),
      acceptanceUnits: () => activeManifest()?.units.map((u: any) => u.id) ?? [],
      observeCurrentArtifact: () => { const source = sourceFacts(workspace); const render = state.lastFeedback ? { ...state.lastFeedback, fresh: Boolean(source && state.lastFeedback.source_path === source.source && source.hash === state.lastFeedback.source_hash) } : { fresh: false, reason: 'no render recorded' }; return { source, render, acceptance: render.fresh ? 'latest recorded acceptance is attached to task outcomes' : null, fact_refs: evo?.reviewView().quality_facts.map((x: any) => x.ref) ?? [] }; } }) : undefined;
  const agentSelf = evo ?? new LiveAgentSelf(savedSelf, validatePythonComponent, workspace);
  // The plain path records office actions only; submit_unit is a self-root adapter tool.
  if (!evo) agentSelf.declareActionTypes(['office.render', 'office.look', 'office.deliver']);
  let activatingEvo = false;
  let advanceEvoBoundary = async () => {};
  let resumed = false, initialized = false;
  const ownedNative = new Map<string, { kind: string; path: string }>();
  // META runs seed the META variant of the resident prompt: same object contract, minus the host-opened review
  // entrance and its decide_exit, which META turns off (self_root.ts protocolSurface and the review-only exit schema).
  const initialSystemPrompt = readFileSync(fileURLToPath(new URL(manifest ? (EVO_MECH.meta ? './prompts/self_root_meta_system.md' : './prompts/self_root_system.md') : './prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
  // META (user decision 2026-11-16): the seven fixed self-evolution fields. The four fixed fields sit in this file
  // and enter the stable prefix unchanged, so editing the agent's harness never rewrites them and never zeroes the
  // provider prefix cache; the dynamic fields ride the self view instead.
  const metaFieldsText = EVO_MECH.meta ? readFileSync(fileURLToPath(new URL('./prompts/self_root_meta_fields.md', import.meta.url)), 'utf8') : '';
  // User decision 2026-11-17: no seeded evolution policy. Evolution judgment runs in the host-opened evolution
  // pass (self_root.ts metaPassDue / META_PASS_STRATEGY), outside the task turn; its writes activate through the
  // ordinary reflection interface, so the runtime assembles nothing further.
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
      if (evo) evo.fact('artifact_write', { path: row.path, mode: 'program', chars: Number(row.bytes ?? row.size ?? 0) || null, via: 'native runtime write' });
      agentSelf.invalidateArtifact();
      persistLiveSelf('artifact_invalidated', { path: row.path, via: 'native runtime write' });
    }
    if (file === 'component_runs.jsonl' && row?.kind === 'tool') evidence.toolRuns += 1;
    if (file === 'consult_runs.jsonl') evidence.childRuns += 1;
    if (file === 'component_runs.jsonl' && ['program_call', 'tool', 'save', 'program_save'].includes(row?.kind)) lineageUse(row);
    if (file === 'consult_runs.jsonl' && row?.role) lineageUse({ ...row, role: row.role, kind: 'subagent' });
    appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), session_id: sessionId, batch: state.batch, ...row })+'\n');
  };
  // Every tool result carries text: a section that has nothing to return must say so, not hand the provider an empty
  // content block (M8 2026-11-17: read_self("definition") returned undefined and the next provider request died on it).
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) ?? 'no content for this request' }], terminate,
    ...(value && typeof value === 'object' && value.is_error === true ? { isError: true } : {}) });
  const registerTool = pi.registerTool.bind(pi);
  (pi as any).registerTool = (tool: any) => registerTool({ ...tool, execute: async (...args: any[]) => {
    const began = Date.now();
    let result;
    // Adapter fact for artifact writes through file tools (mode and size only; no judgement).
    const artifactWrite = evo && ['write', 'edit'].includes(tool.name) && typeof args[1]?.path === 'string' && args[1].path.replace(/^\.\//, '').startsWith('artifacts/')
      ? { path: args[1].path, mode: tool.name === 'edit' ? 'edit' : existsSync(workspace.path(args[1].path)) ? 'overwrite' : 'create',
          chars: tool.name === 'edit' ? (args[1].edits ?? []).reduce((n: number, e: any) => n + String(e?.newText ?? '').length, 0) : String(args[1].content ?? '').length } : undefined;
    try { if (evo) evo.allowTool(tool.name, args[1]); result = await tool.execute(...args); }
    catch (error) {
      if (evo && ['reflect_component','reflect_orchestration'].includes(tool.name)) {
        evo.abortTransaction(error, tool.name);
        return text({ is_error: true, error: String(error?.message ?? error), same_turn_correction: 'The reflection was rejected and this turn continues. The rejection is recorded; read the returned correction surface, repair the operation and retry whenever you decide to.', terminate: false, reason: { code: 'reflection_rejected', surface: error?.surface ?? { received: args[1], correction: 'Use the visible operation fields and current revision.' } } });
      }
      if (evo) {
        evo.fact('tool_failed', { tool: tool.name, args: args[1], error: String(error), duration_ms: Date.now()-began });
        await evo.event(args[2]?.aborted ? 'tool_cancelled' : 'tool_failed',`tool:${args[0]}`, { tool: tool.name, args: args[1], error: String(error), duration_ms: Date.now()-began });
      }
      persistLiveSelf(); throw error;
    }
    if (evo) {
      if (artifactWrite && !result?.isError) evo.fact('artifact_write', artifactWrite);
      evo.fact('tool_result', { tool: tool.name, action: evo.actionName(tool.name, args[1]), mode: evo.mode, is_error: Boolean(result?.isError), input_hash: hash(args[1]), result, duration_ms: Date.now()-began });
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
      // Subagent calls are child model calls of this same run: they enter the same request counter and metering below,
      // and they cannot pass the deadline or the authorized request budget.
      if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
        writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, reason: 'consult budget boundary', stop_kind: 'budget_stop' }));
        syncDaemonResources(root, evo);
        process.exit(0);
      }
      spent += reserve;
      log('provider-requests.jsonl', { request: ++requests, kind: 'consult', estimated_usd_so_far: spent });
      syncDaemonResources(root, evo);
      const reply = await create().result();
      const u = reply.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && u.input + u.output > 0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserve;
      log('model-usage.jsonl', { request: requests, kind: 'consult', usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent, conservative_usd: spent,
        usage_status: known ? 'reported' : 'unknown_reserved', stopReason: reply.stopReason });
      syncDaemonResources(root, evo);
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
      // A reflected tool or subagent is registered and activated in the same object write; without activation Pi never
      // advertises it, and the write would be a change the runtime could not consume (M3b/M3c: no created callable
      // was ever in the active surface).
      const callable = agentSelf.active().filter((c: any) => c.kind === 'tool' || c.kind === 'subagent');
      for (const component of callable) {
        assertNativeName(component.name, component.kind, component.path);
        ownedNative.set(component.name, { kind: component.kind, path: component.path });
      }
      runtime.register();
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...callable.map(c => c.name)])]);
      if (!activatingEvo) persistLiveSelf('request_boundary_reflected', { revision: agentSelf.revision }); return;
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
  register('reflect_component', 'Directly hot-reflect a capability into the active Agent object. The host supplies revision and evidence bookkeeping.' + (evo ? ' Activation is before the next request.' : ''),
    Type.Object({ op: Type.Union([Type.Literal('define'), Type.Literal('redefine'), Type.Literal('restore')]),
      name: Type.String(), kind: Type.Union([Type.Literal('tool'), Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('subagent'), Type.Literal('memory')]),
      source: Type.Optional(Type.String()), version: Type.Optional(Type.Integer({ minimum: 1 })), write: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('append'), Type.Literal('patch')])), patch: Type.Optional(Type.Array(Type.Object({ find: Type.String(), replace: Type.String() }))), evidence_refs: Type.Optional(Type.Array(Type.String())), success_predicate: Type.Optional(Type.Object({ metric: Type.String(), direction: Type.Union([Type.Literal('increase'), Type.Literal('decrease')]), segment: Type.Union([Type.Literal('last'), Type.Literal('mean')]) })), expected_effect: Type.Optional(Type.String()), ...(evo?.mech.l4 ? { evolution_layer: Type.Optional(Type.Union([Type.Literal('prompt'), Type.Literal('context'), Type.Literal('loop'), Type.Literal('harness')])) } : {}), note: Type.Optional(Type.String()) }), async (a: any) => {
      const path = a.kind === 'tool' ? `tools/${a.name}.py` : a.kind === 'prompt' ? `prompts/${a.name}.md`
        : a.kind === 'skill' ? `skills/${a.name}/SKILL.md` : a.kind === 'subagent' ? `agents/${a.name}.md` : `notes/memory/${a.name}.md`;
      try {
        const input = evo ? normalizeOperation('component', a, undefined, { layer: evo.mech.l4 }) : a;
        assertNativeName(input.name, input.kind, path);
        const result = await agentSelf.reflectComponent({ ...input, baseRevision: evo?.pendingRevision ?? agentSelf.revision, level: 0, origin: { by: 'agent', decision: state.batch } });
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
        return text({ is_error: true, ok: false, selfRevision: agentSelf.revision, name: a.name, kind: a.kind,
          reason: { code: 'reflection_rejected', error: String(error) } });
      }
    });
  if (!evo) register('reflect_orchestration', 'Directly revise the active Agent orchestration. Host revision and evidence bookkeeping are automatic.',
    Type.Object({ orchestration: Type.Optional(Type.Record(Type.String(), Type.Any())), orchestration_patch: Type.Optional(Type.Record(Type.String(), Type.Any())), policy: Type.Optional(Type.Record(Type.String(), Type.Any())), components: Type.Optional(Type.Array(Type.Any())), restore: Type.Optional(Type.Integer({minimum:1})), carry: Type.Optional(Type.Record(Type.String(), Type.Any())), stepMap: Type.Optional(Type.Record(Type.String(), Type.Any())), evidence_refs: Type.Optional(Type.Array(Type.String())), success_predicate: Type.Optional(Type.Object({ metric: Type.String(), direction: Type.Union([Type.Literal('increase'), Type.Literal('decrease')]), segment: Type.Union([Type.Literal('last'), Type.Literal('mean')]) })), expected_effect: Type.Optional(Type.String()) }), async (args: any) => {
      const result = await agentSelf.reflectOrchestration({ ...args, baseRevision: agentSelf.revision, authorized: true });
      return text({ ...result, active: agentSelf.mirror() });
    });
  if (!evo) register('decide', 'Submit an Agent-authored decision against trusted action receipts. The live orchestration checks evidence and applies its declared transition.',
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
  if (evo && manifest) installSelfRootTools({ pi, evo, manifest: activeManifest, root, workspace, text, persist: persistLiveSelf, episode: () => state.episode });
  const officeParameters = Type.Object({ op: Type.Union(PPT_ACTIONS.map(action => Type.Literal(action)) as any),
    source_path: Type.Optional(Type.String()), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))), revision: Type.Optional(Type.Integer({ minimum: 1 })),
    unit: Type.Optional(Type.String()),
    self_review: Type.Optional(Type.Object({ disposition: Type.Union([Type.Literal('keep'), Type.Literal('defer'), Type.Literal('change')]), rationale: Type.String() })) });
  register('office', OFFICE_ACTION_DESCRIPTION, officeParameters,
    async (a: any, signal: AbortSignal, ctx: any) => {
      // META: the host opens no review of its own, so nothing defers final delivery; the harness inventory books at task end.
      if (!evo?.mech.meta && evo?.inEvolutionReview && evo.isFinalDelivery('office', a)) {
        agentSelf.markPendingFinalDelivery();
        return text(await evo.queueFinalDelivery(async () => officeDeliver(a, signal, ctx, true), 'office.deliver'));
      }
      if (!evo?.mech.meta && evo && evo.isFinalDelivery('office', a) && evo.needsQualityReview()) {
        agentSelf.markPendingFinalDelivery();
        return text(await evo.queueFinalDelivery(async () => officeDeliver(a, signal, ctx, true), 'office.deliver'));
      }
      return officeDeliver(a, signal, ctx);
    });
  const officeDeliver = async (a: any, signal: AbortSignal, ctx: any, hostDeferred = false) => {
      // The host defers final delivery while opening a review for quality facts not yet shown.
      if (!hostDeferred) agentSelf.assertActionAllowed(`office.${a.op}`);
      if (a.op === 'preview') {
        const unit = activeManifest()?.units.find((u: any) => u.id === a.unit);
        if (!unit) throw Error('preview requires a frozen unit');
        const page = Number(unit.citation.match(/(?:page|p\.)\s*(\d+)/i)?.[1] ?? 1);
        const sourcePath = a.source_path ?? canonical(); if (!sourcePath) throw Error('preview requires a canonical source');
        const revision = ++state.revision; const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_html.py', import.meta.url));
        const started = Date.now();
        const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, workspace.path(sourcePath), String(revision), '--page-start', String(page), '--page-end', String(page)], { encoding: 'utf8', timeout: 300000, maxBuffer: 4*1024*1024, windowsHide: true });
        if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error)).slice(-5000));
        const receipt = JSON.parse(child.stdout); const elapsedMs = Date.now() - started;
        const acceptance = collectAcceptance(activeManifest()!, root, workspace, sourcePath, receipt, child.status, unit.id);
        const result = { unit: unit.id, scope: unit.citation, preview: true, receipt, acceptance, metrics: pptUnitMetrics(acceptance, evo?.segmentRows?.() ?? []), source_identity: { path: sourcePath, sha256: receipt.source_sha256 }, checker: activeManifest()?.checker ?? null, artifact_identity: { revision: receipt.revision, output: receipt.output ?? null }, cost: { elapsed_ms: elapsedMs, usd: null, measured: true }, unknowns: ['preview dollar cost unavailable without an adapter rate'] };
        if (evo) evo.outcome({ source: 'adapter_preview', unit: unit.id, ...result }, true); persist(); return { content: text(result).content };
      }
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
          if (evo && manifest) evo.outcome({ source:'protected_acceptance', checker:manifest.checker, unit:'whole_deck', episode:state.episode,
            artifact:{path:sourcePath,sha256:fileHash(sourcePath)}, renderer:{exit:child.status,error:String(child.error ?? child.stderr),original_output:child.stdout}, status:'render_failed' });
          throw Error((child.stderr || String(child.error)).slice(-5000));
        }
        const receipt = JSON.parse(child.stdout);
        const acceptance = experimentManifest ? collectAcceptance(activeManifest() ?? experimentManifest, root, workspace, sourcePath, receipt, child.status) : undefined;
        if (evo && acceptance) { evo.outcome({ ...acceptance, episode:state.episode, metrics: pptUnitMetrics(acceptance, evo.segmentRows()) }); persistLiveSelf(); }
        state.lastFeedback = { revision, slides: receipt.slides, native_objects: receipt.native_objects,
          warnings: receipt.warnings, renderer: receipt.renderer, source_path: sourcePath, source_hash: receipt.source_sha256 };
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
        if (evo) evo.fact('render_action_receipt', { action_ref: orchestrationAction.receipt.ref,
          transition: orchestrationAction.transition });
        if (evo) await evo.event('settlement', `render:${revision}`, { checkpoint: 'render_action_receipt', event_classes: ['task_outcome'] });
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
        const episode = activeManifest()!;
        const whole = collectAcceptance(episode, root, workspace, receipt.source_path, receipt, 0);
        evo.outcome({ ...whole, episode:state.episode, metrics: pptUnitMetrics(whole, evo.segmentRows()) });
        const delivered = new Set(evo.export().root.ledger.filter((r: any) => r.type === 'unit_delivered' && (r.value?.episode ?? 1) === state.episode).map((r: any) => r.value.unit));
        for (const unit of episode.units) if (!delivered.has(unit.id)) {
          const unitAcceptance = collectAcceptance(episode, root, workspace, receipt.source_path, receipt, 0, unit.id);
          evo.outcome({ ...unitAcceptance, episode:state.episode, metrics: pptUnitMetrics(unitAcceptance, evo.segmentRows()) }, true);
          evo.fact('unit_delivered', { unit: unit.id, episode:state.episode, via: 'whole_deck_delivery' });
        }
        // The final settlement occurs only when the deferred delivery actually runs.
        await evo.finalSettlement(`delivery:${currentHash}`, { unit: null });
        persistLiveSelf();
      }
      const orchestrationAction = agentSelf.recordAction('office.deliver', { artifactVersion: Number(revision), artifactHash: currentHash, sourcePath: receipt.source_path }, false, hostDeferred);
      // Delivery is an action like every other: the agent's own transition decides whether the run is over. In meta
      // runs only a matching transition to "complete" ends the run; a stalled or merely recorded delivery keeps the
      // run open and returns the stall facts, so repairing the orchestration stays the agent's move instead of the
      // host closing the session (M5 2026-11-16: a work-step self-loop invalidated the render receipt and the host
      // ended an otherwise live run). Outside meta the previous semantics hold: anything but a transition to a next
      // step ends the run.
      const transition: any = orchestrationAction?.transition ?? { status: 'complete' };
      const metaRun = !!evo && EVO_MECH.meta;
      const ended = transition.status === 'complete' || (!metaRun && transition.status !== 'advanced');
      const stalledOpen = !ended && transition.status !== 'advanced';
      if (transition.status === 'stalled' || stalledOpen)
        log('lifecycle.jsonl', { event: 'delivery_transition_stalled', status: transition.status, step: transition.step ?? agentSelf.step, run_open: stalledOpen, transitions: transition.existing_transitions });
      if (stalledOpen) evo?.fact('action_transition_stalled', { action: 'office.deliver', status: transition.status, step: transition.step ?? agentSelf.step,
        existing_transitions: transition.existing_transitions ?? null, editable_content: transition.editable_content ?? null,
        run: 'open - the run completes only at a transition whose to is "complete"; route office.deliver with reflect_orchestration, or end the run through such a transition' });
      const episodes = evo && manifest?.episodes ? manifest.episodes : undefined;
      const closingEpisode = state.episode;
      const episodeSwitch = ended && !!episodes && closingEpisode < episodes.length;
      if (ended && episodes) {
        // Every closed episode keeps its own delivered files; root delivery/ holds the latest episode's.
        const caseDelivery = join(root, 'cases', episodes[closingEpisode - 1].id, 'delivery');
        rmSync(caseDelivery, { recursive: true, force: true });
        mkdirSync(caseDelivery, { recursive: true });
        cpSync(delivery, caseDelivery, { recursive: true });
      }
      let taskEnd: any;
      let switchFailed: string | undefined;
      if (episodeSwitch) {
        // Mechanical host service between frozen episodes: archive above, swap the live task data below,
        // reopen the same orchestration. Components, ledger, history, session and budget continue unchanged.
        // The closure is recorded once; the data swap and reopen rerun freely, so a failed switch never leaves the
        // orchestration sealed with the next episode unreachable.
        const closed = episodes![closingEpisode - 1], next = episodes![closingEpisode];
        const nextData = join(root, 'cases', next.id, 'workspace', 'data');
        try {
          if (!existsSync(nextData)) throw Error(`frozen task data missing at cases/${next.id}/workspace/data`);
          if (!evo!.export().root.ledger.some((row: any) => row.type === 'task_episode_closed' && row.value?.episode === closingEpisode))
            evo!.fact('task_episode_closed', { episode: closingEpisode, of: episodes!.length, id: closed.id, delivered_revision: Number(revision),
              artifact_sha256: currentHash, delivery: `cases/${closed.id}/delivery` });
          const liveData = join(workspace.root, 'data');
          rmSync(liveData, { recursive: true, force: true });
          cpSync(nextData, liveData, { recursive: true });
          state.episode = closingEpisode + 1;
          delete state.lastFeedback;
          agentSelf.invalidateArtifact();
          agentSelf.reopen();
          evo!.fact('task_episode_started', { episode: state.episode, of: episodes!.length, id: next.id, sources: next.sources,
            task_data: 'workspace data/ now holds this episode\'s frozen sources',
            continuity: 'same root, serial session, components, ledger and budget; the orchestration is open again at its current step' });
          log('lifecycle.jsonl', { event: 'task_episode_switched', closed: closed.id, active: next.id, episode: state.episode });
          taskEnd = { continuing: true, transition_status: transition.status,
            episode_closed: { episode: closingEpisode, id: closed.id, delivery: `cases/${closed.id}/delivery` },
            episode_active: { episode: state.episode, of: episodes!.length, id: next.id } };
        } catch (error: any) {
          switchFailed = String(error?.message ?? error);
          if (agentSelf.snapshot().complete === true) { agentSelf.invalidateArtifact(); agentSelf.reopen(); }
          evo!.fact('task_episode_switch_failed', { episode: closingEpisode, next: next.id, error: switchFailed });
          taskEnd = { continuing: true, transition_status: transition.status,
            episode_closed: { episode: closingEpisode, id: closed.id, delivery: `cases/${closed.id}/delivery` },
            episode_switch_failed: { active: state.episode, of: episodes!.length, id: next.id, error: switchFailed, orchestration: 'reopened',
              repair: 'the orchestration is open again; make the same delivery once more to retry the episode switch' } };
        }
      } else {
        taskEnd = ended ? evo?.taskEnd('delivered')
          : { continuing: true, transition_status: transition.status, step: transition.step ?? agentSelf.step,
              ...(stalledOpen
                ? { stall: { existing_transitions: transition.existing_transitions ?? null, editable_content: transition.editable_content ?? null,
                    repair: 'the run stays open; the delivered files stand, and the run completes only at a transition whose to is "complete"' } }
                : { transition: transition.transition }) };
      }
      agentSelf.completePendingFinalDelivery();
      state.deliveredRevision = revision; state.deliveredHash = currentHash;
      if (ended && !episodeSwitch) state.complete = true;
      persist(); log('lifecycle.jsonl', { event: 'delivered', revision, episode: closingEpisode, continues: !ended || episodeSwitch, transition: transition.status, step: agentSelf.step });
      persistLiveSelf('action_receipt', orchestrationAction);
      const liveTrace = join(root, 'harness', 'live_agent_self.jsonl');
      if (existsSync(liveTrace)) {
        const target = join(delivery, 'harness-evidence', 'harness', 'live_agent_self.jsonl');
        mkdirSync(dirname(target), { recursive: true }); cpSync(liveTrace, target);
      }
      return text({ delivered: revision, directory: 'delivery/', evidence: evidenceLine(), self_review: selfReview, orchestration_action: orchestrationAction, task_end: taskEnd }, true);
    };
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
    const selected = new Set(['read', 'write', 'edit', 'ls', 'grep', 'python', 'reflect_component', 'read_self_component', 'office', 'reflect_orchestration', 'decide', ...(evo ? ['decide_exit', 'decide_validation'] : [])]);
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
    const tail: any[] = [];
    tail.push({ role: 'user', content: [{ type: 'text', text: statusText() }], timestamp: Date.now(), contextSection: evo?.inEvolutionReview ? 'review_status' : 'task_status' });
    if (freshBatch && state.batchRequests === batchLimit - 1) tail.push({ role: 'custom', customType: 'ppt-batch-limit', display: false,
      timestamp: Date.now(), content: 'LAST REQUEST IN THIS BATCH. The next batch starts with a fresh conversation; only the workspace, your harness and a checkpoint note (max 400 chars) carry over.' });
    return { messages: projectAgentHistory([...kept, ...tail], workspace) };
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
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason: String(error), resources: evo.resources(), stop_kind: 'budget_stop' }));
        syncDaemonResources(root, evo);
        process.exit(0);
      } finally { activatingEvo = false; }
      persistLiveSelf();
      syncDaemonResources(root, evo);
    };
    // Pi snapshots executable tools before context_with_system. Commit after the
    // whole response's tools finish, before its next-turn executable refresh.
    pi.on('turn_end', async (event: any) => {
      // Pi rejects malformed arguments before tool_result hooks. Its completed
      // turn receipts include those rejections and precede our commit boundary.
      for (const result of event.toolResults ?? []) if (result.isError) {
        if (['reflect_component','reflect_orchestration'].includes(result.toolName)) evo.abortTransaction(JSON.stringify(result.content));
        evo.fact('tool_failed', { tool: result.toolName, content: result.content });
        await evo.event('tool_failed',`tool:${result.toolCallId}`,{tool:result.toolName,content:result.content});
      }
      await advanceEvoBoundary();
    });
    pi.on('session_start', async () => { persistLiveSelf(); });
    pi.on('context_with_system', async (event: any) => {
      try {
        evo.guard(directoryBytes(root));
        const pin = evo.pin(); evoRequestStarted = Date.now();
        const messages = [...event.messages];
        const system = { ...messages[0] };
        if (system.role !== 'system') throw Error('missing system message');
        // Rebuild the actual schema, including office sub-operations, for this request.
        const actions = evo.surface(), names = new Set(pi.getActiveTools());
        const currentStep = evo.current.orchestration.steps.find((step: any) => step.id === evo.step);
        const stepBindings = currentStep?.bindings ?? [];
        for (const binding of stepBindings) if (binding.kind === 'tool') names.add(binding.name);
        // Provider-visible schemas for self operations come from the core descriptor (one definition);
        // tools a state does not offer (decide_exit outside review, decide_validation without a due window) are not advertised.
        system.toolsAdded = pi.getAllTools().filter(t => names.has(t.name)).flatMap(t => {
          const generated = selfRootToolSchema(evo, t.name);
          if (generated === undefined) return [];
          const parameters = generated ?? structuredClone(t.parameters) as any;
          if (t.name === 'office') { parameters.properties.op = { type: 'string', enum: actions.filter(x => x.startsWith('office.')).map(x => x.slice(7)) }; delete parameters.properties.self_review; }
          const component = agentSelf.active().find((candidate: any) => candidate.kind === 'tool' && candidate.name === t.name);
          const description = component ? `${t.description}\nActive component ${component.name}@v${component.version} ${component.hash}` : t.description;
          return [{ name: t.name, description, parameters }];
        });
        for (const t of system.toolsAdded) { const expected = selfRootToolSchema(evo, t.name); if (expected && hash(expected) !== hash(t.parameters)) throw Error(`provider schema for ${t.name} differs from its descriptor`); }
        // Older tool additions/removals must not re-open a suspended capability later in history.
        for (let i = 1; i < messages.length; i++) if (messages[i].role === 'system') { messages[i] = { ...messages[i] }; delete messages[i].toolsAdded; delete messages[i].toolsRemoved; }
        const groups: Record<string,string> = {
          prompts: agentSelf.active().filter(c => c.kind === 'prompt').map(c => c.body).join('\n\n'),
          memory: evo.memory().map(c => `${c.name}@${c.version}\n${c.source}`).join('\n\n'),
          skills: agentSelf.active().filter(c => c.kind === 'skill').map(c => `${c.name}@${c.version}: ${c.description}; read_self_component`).join('\n'),
        };
        const boundComponents = stepBindings.map((binding: any) => {
          const component = agentSelf.active().find((candidate: any) => candidate.kind === binding.kind && candidate.name === binding.name && (binding.version === undefined || candidate.version === binding.version));
          if (binding.kind === 'context') return `context:${binding.name}`;
          if (!component) throw Error(`unresolved step binding ${binding.kind}.${binding.name}${binding.version === undefined ? '' : `@v${binding.version}`}`);
          return `${binding.kind}:${component.name}@v${component.version}`;
        });
        const taskInstructions = evo.inCapabilityReview ? '' : existsSync(workspace.path('data/instructions.md')) ? workspace.read('data/instructions.md') : '';
        const ctx = evo.policy.context;
        const selfView = evo.inEvolutionReview
          ? [JSON.stringify(evo.reviewSelfView()), JSON.stringify(await evo.projection())]
          : [JSON.stringify({ root_id: evo.root_id, revision: evo.revision, mode: evo.mode, step: evo.step,
            in_review: false, pending: evo.detail('pin').activation_intent ?? null, resources: evo.resources(),
            ...(evo.mech.observation ? { observation: evo.observationDigest() } : {}),
            ...(evo.mech.meta ? { self_state: evo.selfChangeDigest(), self_evolution: evo.metaBoard() } : {}),
            read_full: 'read_self(section="self")', read_policy: 'read_self(section="policy")' })];
        const selfTail = ctx.self_view?.placement === 'tail';
        const coreLine = evo.mech.legacy_obligation
          ? `${evo.reviewStrategy()}\nSELF ROOT: one agent, one task, one serial session. decide_exit is visible at review entry. An existing or delivered artifact does not end examination and evolution of orchestration or component classes. Rework runs through orchestration rewrite, render and resubmit/preview; pending final delivery completes at the delivery transition after scheduled rework, or at the budget boundary.`
          : evo.mech.meta
            ? `${evo.reviewStrategy()}\n${evo.inEvolutionReview
              ? `SELF ROOT: evolution pass - the task step is suspended and resumes when the final pass round closes; each round closes through decide_exit, is bounded, and its writes activate at the next request boundary. Task artifacts are not edited here unless a write above says so.`
              : `SELF ROOT: one serial session; no review entrance exists in this run. At a recorded run boundary the host opens one evolution pass outside the task turn, and the task resumes at its current step when the pass closes. Every protocol tool the self view names is available at every step. Rework stays available through orchestration rewrite, render and resubmit/preview; office.deliver is an action receipt your own transition routes, and the run completes only at a transition whose to is "complete" - a delivery whose transition stalls or only records leaves the run open with the stall facts returned.`}`
            : `${evo.reviewStrategy()}\nSELF ROOT: one agent, one task, one serial session. decide_exit is available at any point in a review; a judged no-change is a valid closure. Rework stays available through orchestration rewrite, render and resubmit/preview; pending final delivery completes at the delivery transition, or at the budget boundary.`;
        // META (2026-11-16): the fixed self-evolution fields, unchanged in the stable prefix. The dynamic half
        // (objects, contract, counters, phase) rides the self view so a change never rewrites this prefix.
        const metaText = metaFieldsText;
        const bindingText = boundComponents.length ? `## ACTIVE STEP BINDINGS\n${boundComponents.join('\n')}` : '';
        // Full orchestration shape, not just the current step: an empty transitions/decisions list is then a visible
        // fact of the optimizable object instead of an absence the agent has to infer.
        const orchestrationText = `## ACTIVE ORCHESTRATION\n${JSON.stringify({ revision: evo.current.revision, step: evo.step, orchestration: evo.current.orchestration })}`;
        const prefix = [taskInstructions, metaText, ...ctx.order.map(k => groups[k]), bindingText, orchestrationText, ctx.instruction, coreLine].filter(Boolean).join('\n\n');
        const volatile = ctx.prompt_layout?.volatile_tail === 'self_view' ? [selfView[0]] : ctx.prompt_layout?.volatile_tail === 'projection' ? [selfView[1]] : selfView;
        const stable = prefix;
        const volatileText = volatile.join('\n\n');
        const viewInSystem = !selfTail;
        const reviewStrategy = evo.inEvolutionReview ? evo.reviewStrategy(true) : '';
        const sections = [{ section: 'task_brief', text: taskInstructions }, { section: 'meta_loop', text: metaText }, ...ctx.order.map(k => ({ section: k, text: groups[k] })), { section: 'instruction', text: [ctx.instruction, coreLine].filter(Boolean).join('\n\n') },
          ...(viewInSystem ? [{ section: 'self_view', text: volatileText }] : []), { section: 'projection', text: ctx.prompt_layout?.volatile_tail === 'self_view' ? '' : volatile[1] ?? '' }];
        system.content = [reviewStrategy, stable, ...(viewInSystem ? [volatileText] : [])].filter(Boolean).join('\n\n');
        messages[0] = system;
        // Runtime assembly from the active context policy (art. 6-4): items -> core plan -> applied request.
        const list = piContext.items(messages, sections, system.toolsAdded);
        const plan = await evo.planContext(list);
        const assembled = piContext.apply(messages, list, plan.actions, plan.policyHash);
        // Delivered image parts by stable ref: a request-record fact the pass window can count and expand.
        plan.composition.images_refs = deliveredImageRefs(list, plan.actions);
        if (selfTail) { const tail = { role: 'custom', customType: 'self-view', display: false, timestamp: Date.now(), content: selfView.join('\n\n') }; assembled.push(tail); plan.composition.sections.push({ section: 'self_view_tail', items: 1, chars: tail.content.length, images: 0 }); }
        const deliveredText = assembled.map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')).join('\n');
        const delivered = { text: deliveredText, tools: system.toolsAdded, messages: assembled.map((m: any) => ({ role: m.role, content: m.content })) };
        plan.composition.delivered_chars = deliveredText.length;
        plan.composition.delivered_hash = hash(delivered);
        plan.composition.receipt_matches_sent_text = true;
        evo.recordContext(plan.composition, { ...plan.receipt, delivered_hash: plan.composition.delivered_hash, delivered_chars: deliveredText.length });
        evo.fact('provider_input', { pin, phase: state.phase ?? null, schema_hash: hash(system.toolsAdded), operation_schemas: Object.fromEntries(system.toolsAdded.filter((t: any) => selfRootToolSchema(evo, t.name)).map((t: any) => [t.name, hash(t.parameters)])), tools: system.toolsAdded.map((t: any) => t.name), context_hash: hash(delivered), delivered_chars: deliveredText.length, context_policy: plan.receipt, reasoning_selection: ctx.reasoning ?? 'all', component_addresses: agentSelf.active().map(c => `${c.kind}.${c.name}`), memory_versions: evo.memory().map(c => ({ name:c.name,version:c.version })), complete_input_ref: 'harness/provider-requests.jsonl' });
        persistLiveSelf();
        return { messages: assembled };
      } catch (error) {
        evo.fact('request_paused', { error: String(error) }); persistLiveSelf();
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason: String(error), resources: evo.resources(), stop_kind: 'budget_stop' }));
        syncDaemonResources(root, evo);
        process.exit(0); // Pi event exceptions are fail-open: never send inconsistent tools/definitions.
      }
    });
    pi.on('agent_end', async () => {
      // Pi order: tool results -> turn_end (activation) -> agent_end. A stopped model turn is not task/session completion.
      try { evo.endResponse(applySurface, persistLiveSelf, 'response ended without decide_exit'); }
      catch (error) { evo.fact('request_paused', { error: String(error) }); }
      // The run is over only when a recorded transition says so: the adapter's own flag after a delivery that ended the
      // run, or the agent's orchestration flag when its workflow completes on some other receipt/decision.
      if (state.complete || evo.snapshot().complete) {
        evo.taskEnd(state.deliveredRevision ? 'delivered' : 'orchestration complete');
      } else if (!evo.isResetting && !evo.taskIncomplete) {
        await evo.event('before_session_end', 'formal-task-end');
      }
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
    pi.on('session_shutdown', () => {
      evo.closeMechanically('session shutdown');
      evo.taskEnd('session shutdown');
      persistLiveSelf();
    });
  }
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  pi.on('before_provider_request', async (event: any) => {
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
      evo?.closeMechanically('output envelope exceeds registered model'); evo?.taskEnd('permit reject'); await evo?.waitForBudgetDelivery(); persistLiveSelf();
        writeFileSync(join(root,'budget-stop.json'),JSON.stringify({ reason:'output envelope exceeds registered model', output, stop_kind: 'permit_reject' }));
        syncDaemonResources(root, evo);
        process.exit(0);
      }
      permit = providerPermit(payload, model, output, { input: Math.max(inputRate,cacheReadRate,cacheWriteRate), output: outputRate });
      payload = permit.payload; requestReserve = permit.usd; unknownUsageReserveTokens = permit.tokens;
    }
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + requestReserve > cap ||
      (experimentLimits && (requests >= experimentLimits.requests || tokensSpent + unknownUsageReserveTokens > experimentLimits.tokens || directoryBytes(root) >= experimentLimits.storage_bytes))) {
      evo?.closeMechanically('authorized budget boundary'); evo?.taskEnd('budget stop'); await evo?.waitForBudgetDelivery(); persistLiveSelf();
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, permit: permit ? { ...permit, payload: undefined } : undefined, reason: 'authorized budget boundary', stop_kind: 'budget_stop' }));
      syncDaemonResources(root, evo);
      process.exit(0); // Pi event exceptions are fail-open: stop before HTTP.
    }
    spent += requestReserve; reserved = requestReserve;
    if (freshBatch) state.batchRequests = (state.batchRequests ?? 0) + 1;
    const chars = (value: any) => JSON.stringify(value).length;
    const inputMessages = payload?.messages ?? [];
    const composition = { system_chars: inputMessages.filter((m: any) => m.role === 'system').reduce((n: number,m: any) => n+chars(m),0),
      schema_chars: chars(payload?.tools ?? []), history_chars: inputMessages.filter((m: any) => m.role !== 'system').reduce((n: number,m: any) => n+chars(m),0),
      reasoning_chars: inputMessages.reduce((n: number,m: any) => n+(typeof m.reasoning_content === 'string' ? m.reasoning_content.length : 0),0),
      payload_bytes: Buffer.byteLength(JSON.stringify(payload)), basis: 'serialized characters/bytes; tokens are provider-reported separately' };
    log('provider-requests.jsonl', { request: ++requests, batch_request: state.batchRequests, estimated_usd_so_far: spent, composition,
      permit: permit ? { ...permit, payload: undefined } : { usd: requestReserve, tokens: unknownUsageReserveTokens },
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
    if (freshBatch) persist();
    syncDaemonResources(root, evo);
    return payload;
  });
  let settledRequest = lastUsage?.request ?? 0;
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'toolResult') {
      const text = (Array.isArray(m.content) ? m.content : []).map((p: any) => p?.type === 'text' ? p.text : '(image)').join(' ');
      trajectoryLines.push(`R${requests} result ${m.toolName ?? 'tool'}${m.isError ? ' error' : ''}: ${trajHead(text)}`);
      return;
    }
    if (m.role === 'assistant') {
      // Pi can synthesize an aborted assistant while compacting without sending
      // a request. Only an actually dispatched request owns usage/cost.
      if (requests <= settledRequest) return;
      settledRequest = requests;
      for (const part of Array.isArray(m.content) ? m.content : []) {
        const line = part?.type === 'toolCall' ? `call ${part.name} ${trajArgs(part.arguments)}`
          : part?.type === 'thinking' ? (trajHead(part.thinking ?? '') && `thinking: ${trajHead(part.thinking ?? '')}`)
          : (trajHead(part?.text ?? '') && `${part?.type ?? 'text'}: ${trajHead(part?.text ?? '')}`);
        if (line) trajectoryLines.push(`R${requests} ${line}`);
      }
      if (m.stopReason === 'error') trajectoryLines.push(`R${requests} provider_error: ${trajHead(String(m.errorMessage ?? 'error'))}`);
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (evo) {
        const estimate = known ? ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6 : requestReserve;
        const reasoning = m.content?.filter((part: any) => part.type === 'thinking');
        if (reasoning?.length) evo.fact('assistant_reasoning', { request: requests, blocks: reasoning, recovery: 'read_self(section="ledger")' });
        const stop = normalizeStop(m.stopReason);
        evo.cost(u,Date.now()-evoRequestStarted,estimate,known,unknownUsageReserveTokens, { stop: stop ?? undefined,
          cut_tool_calls: stop === 'output_cap' ? (m.content ?? []).filter((p: any) => p.type === 'toolCall').map((p: any) => p.name) : [],
          provider_retries: null, output_cap: evo.policy.request?.maxOutputTokens, cache_supported: cacheSupported(experimentManifest?.settings?.model) });
        persistLiveSelf();
      }
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent,
        conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
      syncDaemonResources(root, evo);
    }
  });
}
