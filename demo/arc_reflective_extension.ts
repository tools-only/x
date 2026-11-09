/** ARC environment I/O hosted by the native reflective core. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadSkills, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';
import { validateReflectiveComponent } from './arc_thin_components.ts';
import { createProcessCore } from './ppt_reflective_core.ts';
import { storeObservation } from './arc_thin_observation.ts';
import { bridge } from './pi_arc_bridge_client.ts';

const ARC_TASK = `Complete the interactive environment task using its observations and actions. The environment reports state, available actions, and progress. The runtime provides native components and versioned source files that can be read. Only the parent agent may change the environment, through arc_action or an active native tool. Parent, children, and environment actions share the run limits. The agent decides whether to create, use, revise, restore, or leave resources unused.`;
const COMPONENT_KINDS = ['tool', 'prompt', 'skill', 'subagent', 'memory', 'process'] as const;
const jsonText = (value: unknown, isError = false, terminate = false) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError, terminate,
});

export default function arcReflective(pi: ExtensionAPI) {
  const root = process.env.ARC_RUN_ROOT;
  if (!root) throw new Error('ARC_RUN_ROOT is required');
  const workspace = new Workspace(root, { dirs: ['data', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results', 'components', 'processes'] });
  workspace.writeGuard = (path: string) => {
    if (/^(tools\/|skills\/|agents\/|prompts\/|lib\/|notes\/memory(?:\/|\.md$)|AGENTS\.md$|processes\/|components\/)/i.test(path))
      throw new Error('Native component files can only be changed with reflect_component.');
  };
  const binder = new Binder(workspace, validateReflectiveComponent);
  const harness = join(root, 'harness');
  mkdirSync(harness, { recursive: true });
  const statePath = join(root, '.harness', 'arc-reflective.json');
  mkdirSync(dirname(statePath), { recursive: true });
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { phase: 0, complete: false };
  state.process ??= { active: null, pending: null, failures: [] };
  const append = (file: string, row: any) => appendFileSync(join(harness, file), JSON.stringify({ t: new Date().toISOString(), phase: state.phase ?? 0, ...row }) + '\n');
  const readRows = (file: string) => existsSync(join(harness, file))
    ? readFileSync(join(harness, file), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const stateFrame = async () => await bridge('/state') as Record<string, any>;
  let observation: Record<string, any> | undefined;
  let phaseActionUsed = false;
  let actionBlocked = Boolean(state.actionBlocked);
  let pendingDecisionText = '';
  let initialized = false;
  let execution: any;
  const nativeNames = new Map<string, { kind: string; path: string }>();

  const previousRequests = readRows('provider-requests.jsonl');
  const previousUsage = readRows('model-usage.jsonl');
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.PPT_DEMO_REQUEST_RESERVE_USD ?? 4.46);
  const cap = Number(process.env.PPT_DEMO_BUDGET_USD ?? 400);
  const inputRate = Number(process.env.PPT_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.PPT_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.PPT_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.PPT_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  const unknownUsageReserveTokens = 12000;
  let requests = previousRequests.at(-1)?.request ?? 0;
  const pendingRequests: Array<{ request: number; reserve: number; route: string }> = [];
  const settledRequests = new Set(previousUsage.map(row => row.request));
  let spent = Number(lastUsage?.conservative_usd ?? 0) + [...new Set(previousRequests.map(row => row.request))].filter(id => !settledRequests.has(id)).length * reserve;
  let tokensSpent = previousUsage.reduce((sum, row) => sum + (row.usage
    ? Number(row.usage.input ?? 0) + Number(row.usage.output ?? 0) + Number(row.usage.cacheRead ?? 0) + Number(row.usage.cacheWrite ?? 0)
    : unknownUsageReserveTokens), 0);
  const reportedTokens = (usage: any) => Number(usage?.input ?? 0) + Number(usage?.output ?? 0)
    + Number(usage?.cacheRead ?? 0) + Number(usage?.cacheWrite ?? 0);
  const settleRequest = (request: number, message: any) => {
    const index = pendingRequests.findIndex(item => item.request === request);
    if (index < 0) return;
    const [reservation] = pendingRequests.splice(index, 1);
    const usage = message?.usage ?? {};
    const known = Number.isFinite(usage.input) && Number.isFinite(usage.output) && usage.input + usage.output > 0;
    const tokens = known ? reportedTokens(usage) : unknownUsageReserveTokens;
    tokensSpent += tokens;
    if (known) spent += (Number(usage.input ?? 0) * inputRate + Number(usage.cacheRead ?? 0) * cacheReadRate
      + Number(usage.cacheWrite ?? 0) * cacheWriteRate + Number(usage.output ?? 0) * outputRate) / 1e6 - reservation.reserve;
    append('model-usage.jsonl', { request, route: reservation.route, owner: (reservation as any).owner, usage: known ? usage : null, tokens_used: tokens,
      tokens_total: tokensSpent, conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: message?.stopReason });
  };
  const reserveRequest = (route: string) => {
    if (spent + reserve > cap) {
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent,
        reserved: pendingRequests.reduce((sum, item) => sum + item.reserve, 0), reserve, requests, tokensSpent, reason: 'pre-dispatch cap' }, null, 2));
      return undefined;
    }
    spent += reserve;
    const request = ++requests;
    pendingRequests.push({ request, reserve, route, owner: execution?.owner } as any);
    append('provider-requests.jsonl', { request, route, owner: execution?.owner, conservative_usd: spent });
    return request;
  };

  const currentRef = () => 'data/current.json';
  const phaseLog = () => readRows('reflective-actions.jsonl');
  const componentDir = (kind: string, name: string) => `components/${kind}/${name}`;
  const componentPath = (kind: string, name: string) => kind === 'tool' ? `tools/${name}.py`
    : kind === 'prompt' ? `prompts/${name}.md`
      : kind === 'skill' ? `skills/${name}/SKILL.md`
        : kind === 'subagent' ? `agents/${name}.md`
          : kind === 'memory' ? `notes/memory/${name}.md` : `processes/${name}.json`;
  const log = (file: string, row: any) => append(file, { owner: execution?.owner, input_ref: execution?.input_ref, ...row });
  const processCore = createProcessCore({ state, binder, workspace, persist, log });

  const recordFrame = async (frame: Record<string, any>, phase: number, action?: any, producer?: any) => {
    const beforeRef = state.lastReceipt?.observation_ref;
    observation = frame;
    storeObservation(workspace, frame, phase);
    const budget = frame.action_budget ?? {};
    const receipt = {
      phase, action: action ?? null, state: frame.state ?? null, levels_completed: frame.levels_completed ?? null,
      action_budget: budget, observation_ref: `data/observations/${phase}.json`, image_ref: `data/frames/${phase}.png`,
      grid_ref: `data/observations/${phase}.json`, environment_action_index: budget.total_used ?? null,
      before_observation_ref: beforeRef ?? null, changed_cells: frame.observation_delta?.changed_cells ?? null,
      bbox: frame.observation_delta?.bbox ?? null, owner: producer?.owner ?? null,
      input_ref: producer?.input_ref ?? beforeRef ?? null, output_refs: [...(producer?.outputs ?? [])],
      decision_text: pendingDecisionText || null, decision_text_source: 'agent_interpretation',
    };
    workspace.runtimeWrite(`data/frames/${phase}.json`, JSON.stringify(frame.frames?.at(-1) ?? null) + '\n');
    if (action) {
      append('reflective-actions.jsonl', receipt);
      append('trajectory.jsonl', { n: receipt.environment_action_index ?? phase, decision: phase, ...action,
        changed_cells: frame.observation_delta?.changed_cells ?? null, bbox: frame.observation_delta?.bbox ?? null,
        level_changed: Number(frame.levels_completed ?? 0) > Number(state.lastReceipt?.levels_completed ?? 0),
        state: receipt.state, levels_completed: receipt.levels_completed, budget: receipt.action_budget,
        observation_ref: receipt.observation_ref, grid_ref: receipt.grid_ref, image_ref: receipt.image_ref });
    }
    state.phase = phase;
    state.lastReceipt = receipt;
    if (action) state.actionBlocked = false;
    persist();
    return receipt;
  };

  const act = async (call: any, via: string) => {
    if (actionBlocked) return { stopped: 'Environment outcome is uncertain; the action cannot be replayed.' };
    if (!observation) return { stopped: 'Current environment state is unavailable.' };
    if (!Array.isArray(observation.agent_available_actions ?? observation.available_actions)
      || !(observation.agent_available_actions ?? observation.available_actions).includes(call.action)) {
      append('errors.jsonl', { phase: state.phase, action: call, via, outcome: 'rejected', retry: true, error: 'Action is unavailable in the current observation.' });
      return { stopped: 'Action is not available in the current environment state.' };
    }
    if (phaseActionUsed) return { stopped: 'This logical phase already has a settled environment action.' };
    phaseActionUsed = true;
    const producer = execution;
    const payload = { action: call.action, ...(call.x !== undefined && call.y !== undefined ? { x: call.x, y: call.y } : {}) };
    try {
      const next = await bridge('/action', payload) as Record<string, any>;
      const receipt = await recordFrame(next, state.phase + 1, { ...payload, via }, producer);
      if (producer) {
        const compute = await runtime.loopFeedback({ name: call.action, x: call.x, y: call.y }, [], 0, producer, receipt);
        state.process.feedback = { owner: producer.owner, input_ref: producer.input_ref, output_refs: producer.outputs,
          receipt, compute };
        append('lifecycle.jsonl', { event: 'method_feedback', ...state.process.feedback });
        persist();
      }
      return { observation: { ...next, receipt }, line: `Settled action ${receipt.environment_action_index}; ${receipt.state}; level ${receipt.levels_completed}.` };
    } catch (error) {
      let details: any;
      try { details = JSON.parse(error instanceof Error ? error.message : String(error)); } catch { details = undefined; }
      if (details?.operation === '/action' && [400, 422].includes(Number(details.status))) {
        phaseActionUsed = false;
        append('errors.jsonl', { phase: state.phase, action: payload, via, outcome: 'rejected', retry: true, error: String(error).slice(0, 1200) });
        return { stopped: `Action was rejected before settlement; the phase remains current and a corrected action may be tried. ${String(error).slice(0, 500)}` };
      }
      actionBlocked = true;
      state.actionBlocked = true;
      persist();
      append('errors.jsonl', { phase: state.phase, action: payload, via, outcome: 'rejected_or_uncertain', retry: false, error: String(error).slice(0, 1200) });
      return { stopped: `Action did not settle as a confirmed receipt; do not replay it. ${String(error).slice(0, 500)}` };
    }
  };

  const runtime = new NativeRuntime({
    pi, workspace, binder, state: () => ({ ...state, observation }), level: () => Number(observation?.levels_completed ?? 0),
    actionCount: () => phaseLog().length, decision: () => Number(state.phase ?? 0), log,
    usage: (kind: string, message: any) => append('usage.jsonl', { kind, stop_reason: message?.stopReason, usage: message?.usage }),
    wrap: (_name: string, fn: any) => async (_id: string, args: any, signal: any, _update: any, ctx: any) => fn(args, signal, ctx),
    act,
    method: { state: state.process, persist, totalMs: Number(process.env.REFLECTIVE_AUTO_COMPUTE_MS ?? 0),
      deadline: Number(process.env.ARC_RUN_DEADLINE_MS ?? 0) },
    consultReasoning: 'low',
    modelResult: async (create: any) => {
      const request = reserveRequest('native-child');
      if (request === undefined) throw new Error('Shared conservative request budget exhausted before child dispatch.');
      const reply = await create().result();
      settleRequest(request, reply);
      return reply;
    },
  });

  const assertNativeName = (name: string, kind: string, path: string) => {
    if (kind !== 'tool' && kind !== 'subagent') return;
    const prior = nativeNames.get(name);
    if (prior && (prior.kind !== kind || prior.path !== path)) throw new Error(`Native name ${name} is already bound.`);
    if (!prior && pi.getAllTools().some(tool => tool.name === name)) throw new Error(`Native name ${name} is already owned.`);
  };
  const publishFiles = (path: string, kind: string, name: string) => {
    const versions = new Set<number>();
    const active = binder.active().find(component => component.path === path);
    if (active) versions.add(active.version);
    for (const row of readRows('lifecycle.jsonl')) if (row.event === 'reflective_change' && row.name === name && row.kind === kind && row.ok && Number.isSafeInteger(row.version)) versions.add(row.version);
    for (const item of binder.historyOf(path).versions) if (versions.has(item.version)) {
      const source = binder.sourceOf(path, item.version);
      if (source !== undefined) workspace.runtimeWrite(`${componentDir(kind, name)}/v${item.version}.source`, source);
    }
  };
  const skillSection = () => {
    const paths = binder.active().filter(c => c.kind === 'skill').map(c => workspace.path(c.path));
    const skills = loadSkills({ skillPaths: paths, includeDefaults: false, cwd: root } as any);
    return skills.skills.length ? formatSkillsForPrompt(skills.skills, 'read') : '';
  };

  const validateProcess = processCore.validate;
  const reflect = async (a: any) => {
    if (!a.note?.trim() || !a.name || !COMPONENT_KINDS.includes(a.kind)) throw new Error('name, kind, and a nonempty note are required.');
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(a.name)) throw new Error('Invalid component name.');
    const path = componentPath(a.kind, a.name);
    const current = binder.active().find(component => component.path === path);
    const exists = Boolean(current) || existsSync(workspace.path(path));
    if (a.op === 'define' && exists) throw new Error('Component exists; use redefine.');
    if (a.op === 'redefine' && !exists) throw new Error('Component does not exist; use define.');
    let source = a.source;
    if (a.op === 'restore') {
      if (!Number.isSafeInteger(a.version)) throw new Error('A saved version is required for restore.');
      source = binder.sourceOf(path, a.version);
      if (source === undefined) throw new Error(`Saved version ${a.version} is unavailable.`);
    } else if (typeof source !== 'string') throw new Error('Source is required.');
    assertNativeName(a.name, a.kind, path);
    if (a.kind === 'tool' && !source.split(/\r?\n/).slice(0, 10).some((line: string) => line.trim() === '# program: on'))
      throw new Error('Tool source must declare # program: on in its first ten lines.');
    const oldSource = current?.source;
    if (a.kind === 'process') {
      const envelope = JSON.parse(source);
      validateProcess(envelope);
      const saved = await binder.publish(path, source, 0, { by: 'agent', decision: state.phase,
        ...(a.op === 'restore' ? { restored_from: a.version } : {}) });
      if (saved.error) throw Error(saved.error);
      const { receipt, component } = saved;
      const version = component!.version;
      state.process ??= { active: null, pending: null, failures: [] };
      state.process.pending = { ...component, envelope };
      persist(); binder.boundary();
      append('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind, version,
        hash: component!.hash, restored_from: a.op === 'restore' ? a.version : undefined, note: a.note, ok: true, activated: false });
      publishFiles(path, a.kind, a.name);
      return jsonText({ ok: true, name: a.name, kind: a.kind, version, receipt, activation: 'next provider request' });
    }
    if (a.kind === 'skill') {
      workspace.mutate({ op: 'write', path, content: source }, true);
      const skills = loadSkills({ skillPaths: [workspace.path(path)], includeDefaults: false, cwd: root } as any);
      if (!skills.skills.some((skill: any) => skill.filePath === workspace.path(path) && skill.name === a.name) || skills.diagnostics.length) {
        if (oldSource !== undefined) workspace.mutate({ op: 'write', path, content: oldSource }, true);
        else workspace.mutate({ op: 'delete', path }, true);
        const error = skills.diagnostics.map((item: any) => item.message).join('; ') || 'Pi did not load the published skill.';
        append('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind, note: a.note, ok: false, error });
        return jsonText({ ok: false, error });
      }
    }
    const saved = await binder.publish(path, source, 0, { by: 'agent', decision: state.phase,
      ...(a.op === 'restore' ? { restored_from: a.version } : {}) });
    if (saved.error) throw Error(saved.error);
    const receipt = saved.receipt;
    binder.boundary();
    const updated = binder.active().find(component => component.path === path);
    if (!updated || updated.hash !== createHash('sha256').update(source).digest('hex'))
      throw new Error('Published component did not bind to its saved source.');
    const version = updated?.version ?? binder.versionMap()[path];
    runtime.register();
    if (a.kind === 'tool' || a.kind === 'subagent') {
      nativeNames.set(a.name, { kind: a.kind, path });
      pi.setActiveTools([...new Set([...pi.getActiveTools().filter(name => !nativeNames.has(name)), ...runtime.toolNames()])]);
    }
    append('lifecycle.jsonl', { event: 'reflective_change', op: a.op, name: a.name, kind: a.kind, from_version: current?.version ?? null,
      version, hash: updated?.hash, restored_from: a.op === 'restore' ? a.version : undefined,
      note: a.note, ok: true, activated: ['tool', 'subagent'].includes(a.kind), effective: updated?.mount?.length ? 'native boundary binding' : ['tool', 'subagent'].includes(a.kind) ? 'native registry' : 'next provider request' });
    publishFiles(path, a.kind, a.name);
    return jsonText({ ok: true, name: a.name, kind: a.kind, version, receipt,
      native: updated?.mount?.length ? 'native decision/feedback binding; requires exact current process ref' : ['tool', 'subagent'].includes(a.kind) ? 'Pi tool' : a.kind === 'skill' ? 'Pi skill index and ordinary read' : 'next provider request' });
  };

  pi.registerTool({ name: 'reflect_component', label: 'reflect_component',
    description: 'Define, revise, or restore a native tool, prompt, skill, subagent, memory, or process. Sources and versions are readable files under components/<kind>/<name>/.',
    parameters: Type.Object({ op: Type.Union([Type.Literal('define'), Type.Literal('redefine'), Type.Literal('restore')]),
      name: Type.String(), kind: Type.Union(COMPONENT_KINDS.map(kind => Type.Literal(kind)) as any), source: Type.Optional(Type.String()),
      version: Type.Optional(Type.Integer({ minimum: 1 })), note: Type.String() }),
    execute: async (_id, args: any) => {
      try { return await reflect(args); }
      catch (error) {
        const failure = { event: 'reflective_change', op: args.op, name: args.name, kind: args.kind, ok: false, error: String(error).slice(0, 1500) };
        append('lifecycle.jsonl', failure);
        if (/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(args.name) && COMPONENT_KINDS.includes(args.kind))
          workspace.runtimeWrite(`${componentDir(args.kind, args.name)}/last-failure.md`, failure.error);
        return jsonText(failure, true);
      }
    },
  });

  for (const tool of workspace.fileTools()) pi.registerTool({
    ...tool,
    execute: async (id: string, args: any, signal: any, update: any, ctx: any) => {
      const result = await tool.execute(id, args, signal, update, ctx);
      if (tool.name === 'read' && !result?.isError) {
        append('lifecycle.jsonl', { event: 'native_read', path: args.path, phase: state.phase });
        const match = /^components\/(tool|prompt|skill|subagent|memory|process)\/([^/]+)\/v(\d+)\.source$/.exec(String(args.path));
        if (match) {
          const [, kind, name, versionText] = match;
          const source = binder.sourceOf(componentPath(kind, name), Number(versionText));
          append('lifecycle.jsonl', { event: 'component_consumed', kind, name, version: Number(versionText),
            ...(source === undefined ? {} : { hash: createHash('sha256').update(source).digest('hex') }), boundary: 'native_read' });
        }
      }
      return result;
    },
  } as any);

  pi.registerTool({ name: 'arc_action', label: 'arc_action',
    description: 'Send one currently available concrete action to ARC and return its canonical receipt.',
    parameters: Type.Object({ action: Type.String(), x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })), y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })) }),
    execute: async (_id, args: any) => {
      const result = await act({ action: args.action, x: args.x, y: args.y }, 'arc_action');
      if (!('observation' in result)) return jsonText(result.stopped ?? 'Action failed.', true, true);
      phaseActionUsed = true;
      return jsonText(result.line, false, true);
    },
  });

  const initialize = async () => {
    if (initialized) return;
    const frame = await stateFrame();
    const baseline = frame.action_budget?.baseline_actions;
    if (!Array.isArray(baseline) || !baseline.length || baseline.some((value: unknown) => !Number.isSafeInteger(value) || Number(value) <= 0))
      throw new Error('ARC protocol preflight failed: environment.info.baseline_actions is missing or invalid.');
    if (!Number.isSafeInteger(Number(frame.action_budget?.maximum)) || Number(frame.action_budget.maximum) <= 0)
      throw new Error('ARC protocol preflight failed: SDK-derived action budget is unavailable.');
    const eventReply = await bridge('/events?after=0') as Record<string, any>;
    const knownIndex = Number(state.lastReceipt?.environment_action_index ?? 0);
    for (const event of (Array.isArray(eventReply.events) ? eventReply.events : []).filter((item: any) => item?.event === 'action' && Number(item.index) > knownIndex)) {
      pendingDecisionText = '';
      await recordFrame(event.frame, Number(state.phase ?? 0) + 1, { action: event.action, ...(event.coordinates ?? {}), via: 'bridge_recovery' });
    }
    await recordFrame(frame, Number(state.phase ?? 0));
    workspace.runtimeWrite('data/native-components.md', readFileSync(fileURLToPath(new URL('./prompts/reflective_native_contract.md', import.meta.url)), 'utf8'));
    if (!state.process.active && !state.process.pending) {
      const saved = await binder.publish('processes/direct.json', JSON.stringify({ strategy: 'Complete the given task within its fixed boundaries.', refs: [] }), 0, { by: 'preset' });
      state.process.pending = { ...saved.component, envelope: JSON.parse(saved.component!.source) };
      publishFiles('processes/direct.json', 'process', 'direct');
    }
    await binder.scan(0);
    binder.boundary();
    runtime.register();
    for (const c of binder.active()) publishFiles(c.path, c.kind, c.name);
    for (const c of binder.active().filter(component => component.kind === 'tool' || component.kind === 'subagent')) {
      assertNativeName(c.name, c.kind, c.path);
      nativeNames.set(c.name, { kind: c.kind, path: c.path });
    }
    const selected = ['read', 'write', 'edit', 'ls', 'grep', 'arc_action', 'reflect_component', ...runtime.toolNames()];
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...selected])]);
    append('lifecycle.jsonl', { event: 'initial_registry', components: binder.active().map(c => ({ kind: c.kind, name: c.name, version: c.version, path: c.path, hash: c.hash })) });
    initialized = true;
  };

  const contextBlocks = () => {
    const rows = phaseLog().slice(-8);
    const decisions = rows.map(row => `phase ${row.phase}: agent interpretation=${row.decision_text || '(no assistant text captured)'}\n` +
      `receipt=${JSON.stringify({ action: row.action, state: row.state, levels_completed: row.levels_completed, action_budget: row.action_budget,
        changed_cells: row.changed_cells, bbox: row.bbox, owner: row.owner, input_ref: row.input_ref, output_refs: row.output_refs })}\n` +
      `refs=${row.observation_ref}, ${row.grid_ref}, ${row.image_ref}`).join('\n');
    const changes = readRows('lifecycle.jsonl').slice(-16).map(row => JSON.stringify({ event: row.event, op: row.op, kind: row.kind,
      name: row.name, version: row.version, from_version: row.from_version, activated: row.activated, effective: row.effective,
      ok: row.ok, use: row.use, decision: row.decision, phase: row.phase }))
      .concat(readRows('component_runs.jsonl').slice(-8).map(row => JSON.stringify({ event: 'native_tool_use', kind: row.kind,
        name: row.name, path: row.path, version: row.version, ok: row.ok, value: row.value, error: row.error, phase: row.phase })))
      .concat(readRows('consult_runs.jsonl').slice(-4).map(row => JSON.stringify({ event: 'native_subagent_use', name: row.role,
        version: row.version, ok: row.ok, outcome: row.outcome, phase: row.phase })));
    const active = binder.active().map(c => `${c.kind}/${c.name}@v${c.version} ${c.path}`);
    const authoredEvidenceRefs = workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path));
    const phase = state.lastReceipt ?? {};
    const frame = observation ?? {};
    const grid = frame.frames?.at(-1) ?? null;
    const imagePath = grid ? workspace.path(`data/frames/${state.phase}.png`) : '';
    const image = imagePath && existsSync(imagePath) ? { type: 'image', mimeType: 'image/png', data: readFileSync(imagePath).toString('base64') } : undefined;
    const current = [
      'RECENT COMPLETED ACTIONS (canonical receipts; decision_text is Agent interpretation)', decisions || '(no completed action)',
      `PRODUCING METHOD FEEDBACK: ${JSON.stringify(state.process.feedback ? { ...state.process.feedback, compute: undefined } : null)}`,
      `Authored memory/evidence refs: ${authoredEvidenceRefs.join(', ') || '(none)'}`,
      'SELF-SURGERY CHANGES AND NATIVE USE (facts)', changes.join('\n') || '(none recorded)',
      `ACTIVE RESOURCES: ${active.join('; ') || '(none)'}`,
      `CURRENT PHASE CHANGES: ${JSON.stringify(readRows('lifecycle.jsonl').filter(row => row.phase === state.phase))}`,
      'CURRENT CANONICAL ENVIRONMENT', JSON.stringify({ state: frame.state, levels_completed: frame.levels_completed,
        available_actions: frame.agent_available_actions ?? frame.available_actions, action_budget: frame.action_budget,
        grid, observation_ref: currentRef(), image_ref: `data/frames/${state.phase}.png`, phase }),
    ].join('\n\n');
    const prompts = binder.active().filter(c => c.kind === 'prompt').map(c => `\n\n## PROMPT ${c.name}@v${c.version}\n${c.body}`);
    const memoryPaths = workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path));
    const memories = memoryPaths.map(path => `\n\n## MEMORY ${path}\n${workspace.read(path)}`);
    const activePrompts = binder.active().filter(c => c.kind === 'prompt');
    const additions: any[] = [...prompts.map((text, i) => ({ kind: 'prompt', name: activePrompts[i].name,
      version: activePrompts[i].version, hash: activePrompts[i].hash, text })),
      ...memories.map((text, index) => {
        const path = memoryPaths[index];
        const component = binder.active().find(c => c.kind === 'memory' && componentPath(c.kind, c.name) === path);
        const name = component?.name ?? path.split('/').at(-1)?.replace(/\.md$/, '') ?? path;
        const version = component?.version ?? binder.versionMap()[path];
        const source = workspace.read(path);
        return { kind: 'memory', name, version, hash: createHash('sha256').update(source).digest('hex'), text };
      }), ...processCore.contextAdditions()];
    const skills = skillSection();
    for (const item of additions) append('lifecycle.jsonl', { event: 'component_consumed', kind: item.kind, name: item.name,
      version: item.version, hash: item.hash, boundary: 'provider_request' });
    return { current, image, additions, skills };
  };

  pi.on('before_agent_start', async (event: any) => {
    await initialize();
    phaseActionUsed = false;
    event.systemPromptOptions ??= {};
    const taskResource = readFileSync(fileURLToPath(new URL('./prompts/arc_reflective_task.md', import.meta.url)), 'utf8');
    event.systemPromptOptions.forceSystemPrompt = [ARC_TASK, taskResource].filter(Boolean).join('\n\n');
    return { systemPrompt: event.systemPromptOptions.forceSystemPrompt };
  });
  pi.on('context', async (event: any) => {
    const messages = event.messages as any[];
    const settled = messages.findLastIndex(message => message.role === 'toolResult' && message.toolName === 'arc_action'
      && !message.isError && JSON.stringify(message.content ?? []).includes('Settled action '));
    return { messages: settled >= 0 ? messages.slice(settled + 1) : messages };
  });
  pi.on('message_end', (event: any) => {
    const message = event.message;
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      if (content.some((part: any) => part.type === 'toolCall' && part.name === 'arc_action'))
        pendingDecisionText = content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n').slice(-6000);
      const reservation = pendingRequests[0];
      if (reservation) settleRequest(reservation.request, message);
    }
  });
  pi.on('before_provider_request', async (event: any) => {
    processCore.activate(String(observation?.levels_completed ?? 0));
    execution = processCore.execution(`data/observations/${state.phase}.json`, String(observation?.levels_completed ?? 0));
    const computeText = await runtime.loopDecisionText(execution);
    const request = reserveRequest('parent');
    if (request === undefined) process.exit(0);
    const payload = event.payload as any;
    const system = typeof payload?.systemPrompt === 'string' ? { content: payload.systemPrompt }
      : payload?.messages?.find((message: any) => message.role === 'system');
    const blocks = contextBlocks();
    blocks.current += `\n\n${[computeText, state.process.feedback?.compute].filter(Boolean).join('\n').slice(0, 2400)}`;
    if (system) {
      const taskResource = readFileSync(fileURLToPath(new URL('./prompts/arc_reflective_task.md', import.meta.url)), 'utf8');
      const base = [ARC_TASK, taskResource].join('\n\n');
      const injected = [...blocks.additions.map((item: any) => `\n\n## ${item.kind.toUpperCase()} ${item.name}\n${item.text}`),
        blocks.skills ? `\n\n${blocks.skills}` : ''].join('');
      system.content = `${base}\n\n## ARC_REFLECTIVE_LIVE_CONTEXT${injected}`;
      if (typeof payload.systemPrompt === 'string') payload.systemPrompt = system.content;
    }
    const latestUser = [...(payload.messages ?? [])].reverse().find((message: any) => message.role === 'user');
    if (latestUser) {
      const marker = '\n\nARC_REFLECTIVE_CURRENT_CONTEXT\n';
      const oldText = typeof latestUser.content === 'string' ? latestUser.content : '';
      const content = Array.isArray(latestUser.content) ? latestUser.content : [{ type: 'text', text: oldText }];
      const prior = content.findLast((part: any) => part?.type === 'text' && String(part.text).includes(marker));
      if (prior) {
        const priorIndex = content.indexOf(prior);
        prior.text = String(prior.text).split(marker)[0];
        if (['image', 'image_url'].includes(content[priorIndex + 1]?.type)) content.splice(priorIndex + 1, 1);
      }
      else if (oldText) content[0] = { type: 'text', text: oldText };
      const current = { type: 'text', text: `${marker}${blocks.current}` };
      // The payload is already in the provider wire format; OpenAI-compatible chat payloads take image_url parts.
      const wireImage = blocks.image && typeof payload?.systemPrompt !== 'string'
        ? { type: 'image_url', image_url: { url: `data:${blocks.image.mimeType};base64,${blocks.image.data}` } }
        : blocks.image;
      content.push(current, ...(wireImage ? [wireImage] : []));
      latestUser.content = content;
    }
    append('provider-requests.jsonl', { request, route: 'parent', owner: execution.owner, input_ref: execution.input_ref,
      output_refs: execution.outputs, feedback: state.process.feedback, conservative_usd: spent,
      payload: JSON.stringify(payload, (key, value) => (key === 'data' || key === 'url') && typeof value === 'string' && value.length > 4096 ? '(image)' : value) });
  });
}
