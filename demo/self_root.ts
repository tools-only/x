/** Same executing LiveAgentSelf; META contains no attribution or adoption policy. */
import { createHash, randomUUID } from 'node:crypto';
import { LiveAgentSelf, validateSchema, validateSchemaStructure } from './live_orchestration_core.ts';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';
import type { Validator } from './agent_component_model.ts';

export const copy = <T>(x: T): T => structuredClone(x);
export const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const FLOOR = ['before_active_reset', 'unit_completed', 'before_session_end'];
const FLOOR_STEPS = [
  { unlocked_by: 'first_unit_boundary', close_contract: 'changed follows a completed unit boundary', evidence_scope: ['unit_outcomes'], coverage_tags: [] },
  { unlocked_by: 'later_use_observed', close_contract: 'window records use after activation', evidence_scope: ['used_version_receipts'], coverage_tags: [] },
  { unlocked_by: 'due_window_comparison', close_contract: 'missing numeric metrics remain unverified', evidence_scope: ['due_window_comparisons'], coverage_tags: [] },
];
const INITIAL_CONDITIONS = { floor: { step: 0, evidence: ['settlement_facts'], event_classes: [], coverage_tags: [] }, addenda: [] as unknown[] };
export const PROTOCOL = ['read_self', 'read_self_component', 'reflect_component', 'reflect_orchestration', 'decide', 'decide_exit', 'decide_validation'];
/** Adapter-supplied, task-neutral wiring. Task tool names live in the adapter, never here. */
export type SelfRootOptions = { reviewTools?: string[]; evolutionTools?: string[]; reservedToolNames?: string[]; actionOf?: (name: string, args: any) => string;
  processFactTypes?: string[]; finalDeliveryTools?: string[]; taskComplete?: () => boolean; requiredUnits?: () => number;
  /** Adapter actions that mark a unit boundary; they never count as work between boundaries. */
  boundaryTools?: string[];
  /** Adapter-declared context section names (opaque to the core). */
  contextSections?: string[];
  /** Adapter resolver for read_self(section="context_item", ref). */
  contextItem?: (ref: string) => unknown;
  /** Adapter-specific probe request kinds excluded from settled task requests. */
  probeKinds?: string[] };
type Mode = { tools: string[]; instruction: string; projection?: string; exitSchema: any };
type Route = { id: string; event: string; predicate?: string; projection?: string; mode: string; priority: number; conclusion_sink: 'ledger' | 'lineage' };
export type ImagesRule = 'all' | 'latest' | 'none';
/** The Agent's working-context assembly policy. Seeds reproduce v0.1 behaviour; only the Agent changes it. */
export type ContextPolicy = {
  order: Array<'prompts' | 'memory' | 'skills'>; instruction: string; reasoning?: 'all' | 'latest' | 'none';
  history?: { recent_turns: number | null; older: 'drop' | 'stub' };
  tool_results?: { max_chars: number | null; images: ImagesRule; by_tool?: Record<string, { max_chars?: number | null; images?: ImagesRule }> };
  tool_args?: { max_chars: number | null };
  self_view?: { placement: 'system' | 'tail'; ledger_rows: number; max_chars?: number };
  prompt_layout?: { stable_prefix_chars: number; volatile_tail: 'self_view' | 'projection' | 'both' };
  select?: string;
};
/** Agent-facing context intent. The runtime maps these names to its internal sections and rules. */
export type ContextIntent = {
  contentOrder?: string[];
  history?: { recentTurns?: number | null; older?: 'drop' | 'stub' };
  toolResults?: { maxChars?: number | null; images?: ImagesRule };
  toolArgs?: { maxChars?: number | null };
  selfView?: { placement?: 'system' | 'tail'; ledgerRows?: number; maxChars?: number };
  promptLayout?: { stablePrefixChars?: number; volatileTail?: 'self' | 'projection' | 'both' };
};
export type Policy = {
  request?: { maxOutputTokens: number };
  modes: Record<string, Mode>; routes: Route[];
  methods: Record<string, string>;
  memory: { names: string[] | '*'; order: 'name' | 'newest'; write: 'replace' | 'append' };
  context: ContextPolicy;
  review: { trigger: string; evidence: string; tools: string[]; verification: { metric: string; direction: 'increase' | 'decrease'; segment: 'last' | 'mean' } };
  memory_strategy: { retrieval: 'all' | 'recent'; recent_count: number; partition: 'component' | 'kind'; retention: 'all' | 'latest'; sources: string[] };
};
export type SelfContract = {
  source: 'user_contract'; authority: string; decisions: string; content_hash: string; readonly_reason: string;
  boundaries: string[]; capabilities: string[]; writable: string[];
  budget: { requests: number; tokens: number; seconds: number; usd: number; storage_bytes: number };
  acceptance: unknown; inherit_defaults: false; segment: { work_requests: number }; review: { max_requests_without_change: number };
};
const CORE_PROBE_KINDS = ['preflight','inference','inference_probe','inference-preflight','provider-preflight'];
const PROCESS_FACT_TYPES = ['watch_stall','request_paused','exit_normalization','review_unresolved','reflection_noop'];
const CONSERVATIVE_RATES = { input: 20, output: 80 };
const REGISTERED_RATES = { input: 5, output: 30 };
const ESTIMATE_NEVER_INVOICE = 'estimate, never the invoice';
type Row = { ref: string; kind: 'fact' | 'claim'; type: string; revision: number; request: number; value: any };
export type Metric = { name: string; value: number; unit: string; scope?: string };
export type Window = { id: string; revision: number; parent: number; review: string | null; activation: string; baseline: string[]; baseline_segment: number | null;
  baseline_metrics: { last: Metric[]; mean: Metric[] }; scope: string[];
  due: { settlement: number; after_use: true; rule: string }; expected_effect?: string; success_predicate?: { metric: string; direction: 'increase' | 'decrease'; segment: 'last' | 'mean' }; effect_status: 'specified' | 'effect_unspecified';
  evidence_refs: string[]; baseline_phase: string | null; later_use_refs: string[]; status: string; delivered?: any; unknowns: string[] };
/** Fixed mechanical rules published to the Agent; the host never selects "relevant" evidence. */
export const WINDOW_RULES = {
  baseline: 'every metric of the last segment_summary at or before activation (baseline_last) and the per-metric mean over all segment_summaries at or before activation (baseline_mean); process and outcome metrics alike',
  segment: 'the work between two counted boundaries; each boundary follows the configured number of execute-mode requests containing a task action, and submit_unit with work since the previous counted boundary also counts',
  due: 'the first counted boundary after activation with later use in a comparable work phase; at terminal task closure an open window becomes due_unverified',
  later_use: 'a recorded use of a changed tool/component, or an execute request whose phase matches the declared comparable phase; a request alone is insufficient',
  observed: 'every metric of the segment_summary of the due boundary; differences against baseline_last and baseline_mean, no direction or verdict',
  verification: 'predicate evaluation requires matching work phase, metric present in the declared comparison segment and a recorded later use; otherwise unresolved and retained as an open review obligation',
};
/** Fixed order of context sections in composition facts. Adapter sections are appended in declaration order. */
export const CORE_CONTEXT_SECTIONS = ['prompts', 'memory', 'skills', 'instruction', 'self_view', 'projection', 'tool_schemas', 'history'];

/** The core owns semantic operation definitions; adapters turn these into provider schemas and
 * dispatch consumes the same definition through normalizeOperation. Required lists are exhaustive. */
export type OperationKind = 'review' | 'validation' | 'component' | 'orchestration';
export function operationContract(kind: OperationKind) {
  const reason = { type: 'string', description: 'Optional interpretation in your own words.' };
  if (kind === 'review') return { name: 'decide_exit', description: 'Finish the current review after the host-visible review work is complete. No field is required.',
    properties: { reason }, required: [] as string[] };
  if (kind === 'validation') return { name: 'decide_validation', description: 'Read the due window. The host mechanically checks its Agent-declared predicate and retains or restores the change; no manual retention decision is requested.',
    properties: { window: { type: 'string' } }, required: [] as string[] };
  if (kind === 'component') return { name: 'reflect_component', description: 'Change one component of this Agent. define/redefine need source; restore needs version. Evidence and validation are inferred by the host when omitted.',
    properties: { op: { type: 'string', enum: ['define', 'redefine', 'restore'] }, kind: { type: 'string', enum: ['tool', 'prompt', 'skill', 'memory'] }, name: { type: 'string' }, source: { type: 'string' }, version: { type: 'integer', minimum: 1 }, evidence_refs: { type: 'array', items: { type: 'string' } }, success_predicate: { type: 'object', properties: { metric: { type: 'string' }, direction: { type: 'string', enum: ['increase', 'decrease'] }, segment: { type: 'string', enum: ['last', 'mean'] } }, required: ['metric', 'direction', 'segment'] } }, required: ['op', 'kind', 'name'] };
  return { name: 'reflect_orchestration', description: 'Change orchestration content, policy intent, components, or restore a revision. Evidence and validation are inferred by the host when omitted.',
    properties: { orchestration: { type: 'object', description: 'Direct orchestration content: steps, transitions and decisions.' }, intent: { type: 'object', description: 'Named writable orchestration/content intent; the runtime supplies legal fields and maps values.' }, policy: { type: 'object', description: 'Policy merge patch, including context knobs.' }, components: { type: 'array', items: { type: 'object' } }, restore: { type: 'integer', minimum: 1 }, carry: { type: 'object' }, stepMap: { type: 'object' }, evidence_refs: { type: 'array', items: { type: 'string' } }, success_predicate: { type: 'object', properties: { metric: { type: 'string' }, direction: { type: 'string', enum: ['increase', 'decrease'] }, segment: { type: 'string', enum: ['last', 'mean'] } }, required: ['metric', 'direction', 'segment'] } }, required: [] as string[] };
}

/** Provider-visible JSON schema generated from the one descriptor. The Agent's own mode exit schema
 * (part of its writable policy) is exposed as an optional result object when it declares more than reason. */
export function providerOperationSchema(kind: OperationKind, modeExitSchema?: any) {
  const contract = operationContract(kind);
  const properties: any = structuredClone(contract.properties);
  const own = modeExitSchema?.properties ? Object.keys(modeExitSchema.properties).filter(k => k !== 'reason') : [];
  if (kind === 'review' && own.length) properties.result = structuredClone(modeExitSchema);
  return { type: 'object', properties, required: [...contract.required], additionalProperties: false };
}

/** Dispatch-side check against exactly the provider-visible schema plus the stated conditional semantics. */
export function normalizeOperation(kind: OperationKind, args: any, modeExitSchema?: any) {
  const schema = providerOperationSchema(kind, modeExitSchema);
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const unknown = Object.keys(a).filter(k => a[k] !== undefined && !(k in schema.properties));
  if (unknown.length) throw operationError(`${operationContract(kind).name}: unknown field(s) ${unknown.join(', ')}`, kind, a, { invalid: unknown });
  for (const key of schema.required) if (a[key] === undefined || a[key] === '') throw Error(`${operationContract(kind).name}: ${key} is required`);
  for (const [key, spec] of Object.entries<any>(schema.properties)) {
    const v = a[key]; if (v === undefined) continue;
    const ok = spec.type === 'string' ? typeof v === 'string' : spec.type === 'integer' ? Number.isSafeInteger(v) && v >= (spec.minimum ?? -Infinity)
      : spec.type === 'array' ? Array.isArray(v) : spec.type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : true;
    if (!ok || (spec.enum && !spec.enum.includes(v))) throw Error(`${operationContract(kind).name}: invalid ${key}${spec.enum ? `; one of ${spec.enum.join(', ')}` : ''}`);
  }
  if (kind === 'component' && a.op !== 'restore' && typeof a.source !== 'string') throw Error('reflect_component: define/redefine needs source');
  if (kind === 'component' && a.op === 'restore' && a.version === undefined) throw Error('reflect_component: restore needs version');
  if (kind === 'orchestration' && !['intent', 'policy', 'orchestration', 'components', 'restore'].some(k => a[k] !== undefined)) throw operationError('reflect_orchestration: include orchestration, intent, policy, components or restore', kind, a);
  if (['component','orchestration'].includes(kind) && a.evidence_refs !== undefined && (!Array.isArray(a.evidence_refs) || a.evidence_refs.some((ref: any) => typeof ref !== 'string'))) throw operationError('evidence_refs must be an array of strings when supplied', kind, a, { invalid: ['evidence_refs'] });
  if (['component','orchestration'].includes(kind) && a.success_predicate !== undefined && (!a.success_predicate || typeof a.success_predicate.metric !== 'string' || !['increase','decrease'].includes(a.success_predicate.direction) || !['last','mean'].includes(a.success_predicate.segment))) throw operationError('success_predicate needs metric, direction (increase|decrease), and segment (last|mean)', kind, a, { invalid: ['success_predicate'] });
  return Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
}

function operationError(message: string, kind: OperationKind, input: any, surface: any = {}) {
  const error: any = new Error(message);
  error.surface = { operation: operationContract(kind).name, received: input, writable: surface.writable ?? {
    intent: { meaning: 'orchestration strategy and context intent', current: 'read_self(section="pin")', accepts: 'named intent fields; runtime maps and validates them' },
    components: { meaning: 'concrete Agent component content', current: 'read_self(section="self")' },
    restore: { meaning: 'restore a saved Agent revision', current: 'read_self(section="lineage")' },
  }, invalid: surface.invalid ?? [], correction: surface.correction ?? 'Edit the named writable item and submit this operation again in the same turn.' };
  error.message = `${message}; correction_surface=${JSON.stringify(error.surface)}`;
  return error;
}

function normalizeOrchestration(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const transitions = Array.isArray(value.transitions) ? value.transitions.map((row: any) => {
    const next = { ...row };
    const signal = next.on ?? next.trigger ?? next.after ?? next.after_action;
    if (signal !== undefined && next.on === undefined) next.on = typeof signal === 'string' ? { type: 'action', action: signal } : signal;
    if (typeof next.on === 'string') next.on = { type: 'action', action: next.on };
    return next;
  }) : value.transitions;
  return { ...value, ...(transitions ? { transitions } : {}) };
}

const CONTEXT_ORDER_ALIASES: Record<string, string> = {
  content: 'prompts', instructions: 'prompts', prompt: 'prompts', prompts: 'prompts',
  memory: 'memory', memories: 'memory', learned: 'memory', skills: 'skills', methods: 'skills',
};
/** Maps Agent intent to the private policy vocabulary at one runtime boundary. */
export function normalizeContextIntent(intent: ContextIntent): { context: Partial<ContextPolicy> } {
  const result: any = {};
  if (intent.contentOrder !== undefined) {
    if (!Array.isArray(intent.contentOrder)) throw operationError('contentOrder must be a list of content categories', 'orchestration', intent, { invalid: ['contentOrder'], correction: 'Use named categories such as content, memory, or methods.' });
    const order = intent.contentOrder.map(value => CONTEXT_ORDER_ALIASES[String(value).toLowerCase()]);
    const invalid = intent.contentOrder.filter((_, i) => !order[i]);
    if (invalid.length || new Set(order).size !== order.length) throw operationError('contentOrder contains an unsupported or repeated category', 'orchestration', intent, { invalid, correction: 'Use each content category once; internal section names are accepted by the runtime only through their meaning.' });
    result.order = order;
  }
  if (intent.history) result.history = { recent_turns: intent.history.recentTurns, older: intent.history.older };
  if (intent.toolResults) result.tool_results = { max_chars: intent.toolResults.maxChars, images: intent.toolResults.images };
  if (intent.toolArgs) result.tool_args = { max_chars: intent.toolArgs.maxChars };
  if (intent.selfView) result.self_view = { placement: intent.selfView.placement, ledger_rows: intent.selfView.ledgerRows, max_chars: intent.selfView.maxChars };
  if (intent.promptLayout) result.prompt_layout = { stable_prefix_chars: intent.promptLayout.stablePrefixChars, volatile_tail: intent.promptLayout.volatileTail === 'self' ? 'self_view' : intent.promptLayout.volatileTail };
  return { context: result };
}

const isMetric = (m: any): m is Metric => !!m && typeof m.name === 'string' && typeof m.unit === 'string' && Number.isFinite(m.value);
/** RFC 7386 JSON merge patch: objects merge, null removes, arrays and scalars replace. */
export function mergePatch(target: any, patch: any): any {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return copy(patch);
  const out: any = target && typeof target === 'object' && !Array.isArray(target) ? copy(target) : {};
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v); }
  return out;
}

/** One context item of a provider request, described without content (task- and runtime-neutral). */
export type ContextItem = { ref: string; section: string; role?: string; kind?: 'text' | 'reasoning' | 'tool_call_args' | 'tool_result_text' | 'tool_result_image';
  source?: string; chars: number; images: number; turn_age: number; latest_assistant?: boolean; pair?: string; segment?: number };
export type ContextAction = 'include' | 'stub' | 'drop' | { truncate: number };
const SINCE_CURRENT = (i: ContextItem) => i.turn_age >= 1;
const STUB_CHARS = 220;
export function contextStub(item: ContextItem, policyHash: string, removed: { chars: number; images: number }) {
  return `[context item ${item.ref} omitted by policy.context@${policyHash.slice(0, 12)}: source=${item.source ?? item.section}, ${removed.images ? `${removed.images} images, ` : ''}${removed.chars} chars; read_self(section="context_item", ref="${item.ref}")]`;
}
/** Runtime assembly of the working context from the active policy (art. 6-4): the Agent changes policy and methods,
 * never individual items. The floor (non-history sections, current turn, call/result pairs) is kept mechanically. */
export function planDeclarative(items: ContextItem[], ctx: ContextPolicy) {
  const actions: Record<string, ContextAction> = {};
  const latestImageTurn: Record<string, number> = {};
  for (const i of items) if (i.kind === 'tool_result_image') latestImageTurn[i.source ?? ''] = Math.min(latestImageTurn[i.source ?? ''] ?? Infinity, i.turn_age);
  for (const i of items) {
    let a: ContextAction = 'include';
    if (i.section === 'history') {
      if (i.kind === 'reasoning' && (ctx.reasoning === 'none' || (ctx.reasoning === 'latest' && !i.latest_assistant))) a = 'drop';
      else if (SINCE_CURRENT(i) && ctx.history?.recent_turns != null && i.turn_age >= ctx.history.recent_turns) a = ctx.history.older === 'drop' ? 'drop' : 'stub';
      else if (SINCE_CURRENT(i) && i.kind === 'tool_result_image') {
        const rule = ctx.tool_results?.by_tool?.[i.source ?? '']?.images ?? ctx.tool_results?.images ?? 'all';
        if (rule === 'none' || (rule === 'latest' && i.turn_age > (latestImageTurn[i.source ?? ''] ?? 0))) a = 'stub';
      } else if (SINCE_CURRENT(i) && i.kind === 'tool_result_text') {
        const max = ctx.tool_results?.by_tool?.[i.source ?? '']?.max_chars !== undefined ? ctx.tool_results?.by_tool?.[i.source ?? '']?.max_chars : ctx.tool_results?.max_chars;
        if (max != null && i.chars > max) a = { truncate: max };
      } else if (SINCE_CURRENT(i) && i.kind === 'tool_call_args' && ctx.tool_args?.max_chars != null && i.chars > ctx.tool_args.max_chars) a = { truncate: ctx.tool_args.max_chars };
    }
    actions[i.ref] = a;
  }
  return { actions };
}
export function enforceFloor(items: ContextItem[], actions: Record<string, ContextAction>) {
  const floorKept: string[] = [];
  for (const i of items) {
    const a = actions[i.ref] ?? 'include';
    if (a === 'include') continue;
    if (i.section !== 'history' || i.turn_age < 1 && i.kind !== 'reasoning') { actions[i.ref] = 'include'; floorKept.push(i.ref); continue; }
    // A tool call and its result travel together: never drop one member of a pair; stub instead.
    if (a === 'drop' && i.pair && i.kind !== 'reasoning') { actions[i.ref] = 'stub'; floorKept.push(i.ref); }
    if (typeof a === 'object' && !(Number.isSafeInteger(a.truncate) && a.truncate >= 0)) actions[i.ref] = 'include';
  }
  return floorKept;
}
export function contextComposition(items: ContextItem[], actions: Record<string, ContextAction>, sectionOrder: string[]) {
  const after = (i: ContextItem) => { const a = actions[i.ref] ?? 'include';
    if (a === 'include') return { chars: i.chars, images: i.images };
    if (a === 'drop') return { chars: 0, images: 0 };
    if (a === 'stub') return { chars: Math.min(i.chars, STUB_CHARS), images: 0 };
    return { chars: Math.min(i.chars, a.truncate + STUB_CHARS), images: i.images }; };
  const sections = sectionOrder.map(section => { const xs = items.filter(i => i.section === section);
    return { section, items: xs.length, chars: xs.reduce((n, i) => n + after(i).chars, 0), images: xs.reduce((n, i) => n + after(i).images, 0) }; })
    .concat([...new Set(items.map(i => i.section))].filter(x => !sectionOrder.includes(x)).sort().map(section => { const xs = items.filter(i => i.section === section);
      return { section, items: xs.length, chars: xs.reduce((n, i) => n + after(i).chars, 0), images: xs.reduce((n, i) => n + after(i).images, 0) }; }));
  const h = items.filter(i => i.section === 'history');
  const by = new Map<string, any>();
  for (const i of h) { const k = `${i.source ?? i.role ?? 'history'}|${i.kind ?? 'text'}`; const r = by.get(k) ?? { source: i.source ?? i.role ?? 'history', kind: i.kind ?? 'text', items: 0, chars_after: 0, images_after: 0 };
    r.items++; r.chars_after += after(i).chars; r.images_after += after(i).images; by.set(k, r); }
  const act = (i: ContextItem) => actions[i.ref] ?? 'include';
  const removed = h.filter(i => act(i) !== 'include');
  return { sections, history: { items_total: h.length, items_included: h.filter(i => act(i) === 'include').length, items_stubbed: h.filter(i => act(i) === 'stub').length,
      items_dropped: h.filter(i => act(i) === 'drop').length, items_truncated: h.filter(i => typeof act(i) === 'object').length,
      chars_before: h.reduce((n, i) => n + i.chars, 0), chars_after: h.reduce((n, i) => n + after(i).chars, 0),
      images_before: h.reduce((n, i) => n + i.images, 0), images_after: h.reduce((n, i) => n + after(i).images, 0),
      by_source: [...by.values()].sort((a, b) => a.source.localeCompare(b.source) || a.kind.localeCompare(b.kind)) },
    removed_refs_sample: removed.slice(0, 20).map(i => i.ref) };
}

export function seedPolicy(capabilities: string[], reviewTools: string[] = ['read', 'ls', 'grep']): Policy {
  const exitSchema = { type: 'object', properties: { reason: { type: 'string' } }, required: [] };
  const observe = reviewTools.filter(t => capabilities.includes(t));
  return { request: { maxOutputTokens: 8192 }, modes: {
    execute: { tools: capabilities, instruction: 'Continue the current task.', exitSchema },
    reflect: { tools: observe, instruction: 'Review the pinned self/evidence and choose your scope, method and changes. Finish with decide_exit when it is available.', exitSchema },
    consolidate: { tools: observe, instruction: 'Organize this task\'s evidence and bounded inheritance records if useful; no automatic cross-task defaults.', exitSchema },
  }, routes: [], methods: {}, memory: { names: '*', order: 'name', write: 'replace' },
    review: { trigger: 'booked_quality_or_process_facts', evidence: 'all_booked_facts', tools: [...observe], verification: { metric: 'process.output_cap_stops', direction: 'decrease', segment: 'last' } },
    memory_strategy: { retrieval: 'all', recent_count: 12, partition: 'component', retention: 'latest', sources: ['agent'] },
    context: { order: ['prompts', 'memory', 'skills'], instruction: '', reasoning: 'latest', tool_results: { max_chars: 4000, images: 'latest' }, history: { recent_turns: 16, older: 'stub' }, self_view: { placement: 'tail', ledger_rows: 12, max_chars: 12000 }, prompt_layout: { stable_prefix_chars: 4000, volatile_tail: 'both' } } };
}

export function validateContract(c: SelfContract) {
  if (!c || c.source !== 'user_contract' || !c.authority || !c.decisions || !c.readonly_reason) throw Error('explicit user contract not loaded');
  const { content_hash, ...body } = c;
  if (content_hash !== hash(body)) throw Error('user contract hash mismatch');
  if (hash([...c.boundaries].sort()) !== hash([...FLOOR].sort()) || c.inherit_defaults !== false || !Number.isSafeInteger(c.segment?.work_requests) || c.segment.work_requests < 1) throw Error('v1 contract floor/segment/inheritance mismatch');
  for (const key of ['requests', 'tokens', 'seconds', 'usd', 'storage_bytes']) if (!Number.isFinite(c.budget[key]) || c.budget[key] <= 0) throw Error(`missing numeric budget ${key}`);
  if (!Array.isArray(c.capabilities) || !Array.isArray(c.writable) || !c.acceptance) throw Error('contract capabilities/acceptance required');
}

function validatePolicy(p: Policy, c: SelfContract, outputLimit = Number.MAX_SAFE_INTEGER) {
  if (!p || Object.keys(p).some(k => !['modes','routes','methods','memory','memory_strategy','context','request','review'].includes(k))) throw Error(`unknown policy field; allowed: modes, routes, methods, memory, memory_strategy, context, request, review`);
  if (p.request && (!Number.isSafeInteger(p.request.maxOutputTokens) || p.request.maxOutputTokens < 1 || p.request.maxOutputTokens > outputLimit)) throw Error('invalid request envelope');
  if (!p.modes?.execute || !p.modes.reflect || !p.modes.consolidate || !Array.isArray(p.routes)) throw Error('three modes and routes required');
  for (const mode of Object.values(p.modes)) {
    if (!Array.isArray(mode.tools) || mode.tools.some(t => !c.capabilities.includes(t)) || typeof mode.instruction !== 'string') throw Error('mode exceeds user capabilities');
    if (!mode.exitSchema || mode.exitSchema.type !== 'object') throw Error('mode exitSchema must be an object schema');
    validateSchemaStructure(mode.exitSchema);
    if (mode.projection && !p.methods[mode.projection]) throw Error('unknown mode projection');
  }
  const ids = new Set<string>();
  for (const r of p.routes) {
    if (!r.id || ids.has(r.id) || !p.modes[r.mode] || !Number.isFinite(r.priority) || typeof r.event !== 'string' || !['ledger','lineage'].includes(r.conclusion_sink) ||
      Object.keys(r).some(k => !['id','event','predicate','projection','mode','priority','conclusion_sink'].includes(k))) throw Error('invalid META route');
    ids.add(r.id);
    for (const name of [r.predicate, r.projection]) if (name && !p.methods[name]) throw Error('unresolved method');
  }
  for (const source of Object.values(p.methods)) validateLiveSelfSource(source);
  if (!p.review || !['booked_quality_or_process_facts','disabled'].includes(p.review.trigger) || !['all_booked_facts','current_segment'].includes(p.review.evidence) || !Array.isArray(p.review.tools) || p.review.tools.some(t => typeof t !== 'string') || !p.review.verification || typeof p.review.verification.metric !== 'string' || !['increase','decrease'].includes(p.review.verification.direction) || !['last','mean'].includes(p.review.verification.segment)) throw Error('review policy needs trigger (booked_quality_or_process_facts|disabled), evidence (all_booked_facts|current_segment), tools[], and verification {metric, direction: increase|decrease, segment: last|mean}');
  if (!p.memory_strategy || !['all','recent'].includes(p.memory_strategy.retrieval) || !Number.isSafeInteger(p.memory_strategy.recent_count) || p.memory_strategy.recent_count < 1 || !['component','kind'].includes(p.memory_strategy.partition) || !['all','latest'].includes(p.memory_strategy.retention) || !Array.isArray(p.memory_strategy.sources)) throw Error('memory_strategy needs retrieval (all|recent), recent_count >= 1, partition (component|kind), retention (all|latest), and sources[]');
  if (!p.memory || (p.memory.names !== '*' && (!Array.isArray(p.memory.names) || p.memory.names.some(n => typeof n !== 'string'))) || !['name','newest'].includes(p.memory.order) || !['replace','append'].includes(p.memory.write)) throw Error('invalid memory policy');
  if (!p.context || typeof p.context.instruction !== 'string' || !Array.isArray(p.context.order) || p.context.order.some(x => !['prompts','memory','skills'].includes(x)) || new Set(p.context.order).size !== p.context.order.length) {
    throw operationError('invalid context policy', 'orchestration', p.context, { invalid: ['context'], correction: 'Submit intent.contentOrder using meanings such as content, memory, or methods; the runtime maps it to the internal policy.' });
  }
  if (p.context.reasoning !== undefined && !['all','latest','none'].includes(p.context.reasoning)) throw Error('invalid reasoning context policy');
  validateContextKnobs(p);
}
const nullableInt = (v: any, min: number) => v === null || (Number.isSafeInteger(v) && v >= min);
const IMAGES = ['all', 'latest', 'none'];
function validateContextKnobs(p: Policy) {
  const c: any = p.context;
  const known = ['order', 'instruction', 'reasoning', 'history', 'tool_results', 'tool_args', 'self_view', 'prompt_layout', 'select'];
  const unknown = Object.keys(c).filter(k => !known.includes(k));
  if (unknown.length) throw Error(`unknown context policy field(s) ${unknown.join(', ')}; fields: ${known.join(', ')}`);
  if (c.history !== undefined && (!c.history || !nullableInt(c.history.recent_turns, 1) || !['drop', 'stub'].includes(c.history.older)))
    throw Error('context.history needs recent_turns (integer >= 1 or null) and older (drop|stub)');
  if (c.tool_results !== undefined) {
    const t = c.tool_results;
    if (!t || !nullableInt(t.max_chars, 200) || !IMAGES.includes(t.images)) throw Error('context.tool_results needs max_chars (integer >= 200 or null) and images (all|latest|none)');
    if (t.by_tool !== undefined && (!t.by_tool || typeof t.by_tool !== 'object' || Array.isArray(t.by_tool) ||
      Object.values<any>(t.by_tool).some(r => !r || typeof r !== 'object' || (r.max_chars !== undefined && !nullableInt(r.max_chars, 200)) || (r.images !== undefined && !IMAGES.includes(r.images)))))
      throw Error('context.tool_results.by_tool maps a tool name to {max_chars?, images?}');
  }
  if (c.tool_args !== undefined && (!c.tool_args || !nullableInt(c.tool_args.max_chars, 200))) throw Error('context.tool_args needs max_chars (integer >= 200 or null)');
  if (c.self_view !== undefined && (!c.self_view || !['system', 'tail'].includes(c.self_view.placement) || !Number.isSafeInteger(c.self_view.ledger_rows) || c.self_view.ledger_rows < 0 || c.self_view.ledger_rows > 40 || (c.self_view.max_chars !== undefined && (!Number.isSafeInteger(c.self_view.max_chars) || c.self_view.max_chars < 1000))))
    throw Error('context.self_view needs placement (system|tail), ledger_rows (0..40), and optional max_chars (integer >= 1000)');
  if (c.prompt_layout !== undefined && (!c.prompt_layout || !Number.isSafeInteger(c.prompt_layout.stable_prefix_chars) || c.prompt_layout.stable_prefix_chars < 0 || !['self_view','projection','both'].includes(c.prompt_layout.volatile_tail))) throw Error('context.prompt_layout needs stable_prefix_chars (integer >= 0) and volatile_tail (self_view|projection|both)');
  if (c.select !== undefined && (typeof c.select !== 'string' || !p.methods[c.select])) throw Error('context.select must name a method in policy.methods');
}

/** No new actor: inherited action/decision/component entry points execute on this instance. */
export class SelfRoot extends LiveAgentSelf {
  readonly root_id: string;
  readonly contract: SelfContract;
  policy: Policy;
  private serial = 1;
  private request = 0;
  private ledger: Row[] = [];
  private lineage: any[] = [];
  private definitions: any[] = [];
  private windows: Window[] = [];
  private queue: any[] = [];
  private consumed = new Set<string>();
  private currentMode = 'execute';
  private review?: any;
  private pending?: { candidate: LiveAgentSelf; policy: Policy; revision: number; addresses: string[]; windows: any[]; source?: number; baseStateHash: string };
  private chainFailed = false;
  private paused = false;
  private requestPin?: any;
  private started = Date.now();
  private units = 0;
  private tokens = 0;
  private usd = 0;
  private storageBytes = 0;
  private lastSurface: string[] = [];
  private executionGrant: string[] = [];
  private previousMode = 'execute';
  private providerCosts = new Set<number>();
  private pendingReview?: string;
  private activeReset?: string;
  private resetInProgress?: string;
  private mutations: Promise<unknown> = Promise.resolve();
  private workRequests = 0;
  private reviewRequests = 0;
  private reviewedQualityRefs = new Set<string>();
  private pendingDelivery?: { run: () => Promise<any> };
  private taskEndPending?: string;
  private unresolvedReview = false;
  private conditionSet: any = copy(INITIAL_CONDITIONS);
  private settlementCount = 0;
  private lastSettlementReview?: string;
  private daemonRecord?: any;
  private rootValidator?: Validator;
  private readonly outputLimit: number;
  private readonly options: SelfRootOptions;
  private taskEnded?: string;
  /** Ledger index where the current unit segment starts (after the last counted boundary). */
  private segmentStart = 0;
  private segmentRefs: string[] = [];
  private contextByRequest: Record<string, any> = {};
  constructor(contract: SelfContract, saved?: any, validator?: Validator, workspace?: { read(path: string): string }, outputLimit = Number.MAX_SAFE_INTEGER, options: SelfRootOptions = {}) {
    const rootValidator: Validator | undefined = validator ? async (path,source) => {
      const spec = await validator(path,source);
      const schemaLine = source.split(/\r?\n/).slice(0,10).find(line=>line.startsWith('# parameters:'));
      if (schemaLine) {
        const parameters = JSON.parse(schemaLine.slice('# parameters:'.length));
        validateSchemaStructure(parameters);
        if (parameters.type !== 'object') throw Error('native tool parameters must be an object');
        spec.parameters = parameters;
      }
      return spec;
    } : undefined;
    super(saved, rootValidator, workspace);
    this.outputLimit = outputLimit;
    this.options = options;
    this.rootValidator = rootValidator;
    validateContract(contract); this.contract = copy(contract);
    this.root_id = saved?.root?.root_id ?? randomUUID();
    this.policy = copy(saved?.root?.policy ?? seedPolicy(contract.capabilities, options.reviewTools)); validatePolicy(this.policy, contract, this.outputLimit);
    if (saved?.root) {
      const r = saved.root;
      for (const key of ['serial','request','ledger','lineage','definitions','windows','queue','currentMode','review','started','units','tokens','usd','paused','previousMode','activeReset','workRequests','reviewRequests','conditionSet','settlementCount','lastSettlementReview','taskEnded','taskEndPending','unresolvedReview','segmentStart','segmentRefs','contextByRequest'] as const) if (r[key] !== undefined) (this as any)[key] = copy(r[key]);
      if (r.reviewedQualityRefs !== undefined) this.reviewedQualityRefs = new Set(r.reviewedQualityRefs);
      this.consumed = new Set(r.consumed); this.providerCosts = new Set(r.providerCosts);
      if (r.daemonRecord) this.daemonRecord = copy(r.daemonRecord);
      if (r.contract_hash !== contract.content_hash) throw Error('saved root contract differs');
      if (r.pending) this.fact('transaction_interrupted', { status: 'aborted', reason: 'uncommitted candidate on process restart', review: r.pending.review ?? null });
      // A review already closed while its activation was pending: the activation never happened; record that once.
      if (r.pending?.review && (!this.review || this.review.id !== r.pending.review)) this.fact('review_activation_interrupted', { review: r.pending.review, outcome: 'not_activated', reason: 'process restart before activation' });
      if (r.resetInProgress) this.fact('active_reset_failed',{id:r.resetInProgress,error:'process restart during reset; completion unknown'});
      if (this.review) this.closeMechanically('crash/recovery');
      this.fact('coverage_gap', { pre_review: false, reason: 'process restart; unknown forced termination/compaction' });
    }
    if (!this.definitions.length) this.definitions.push(this.definition());
  }
  override get revision() { return this.serial; }
  get mode() { return this.currentMode; }
  get reviewExitSchema() { return this.exitOperationKind ? copy(this.review.modeDefinition.exitSchema) : undefined; }
  /** The provider-visible exit operation for the current review, from the one descriptor. */
  get exitOperationKind(): 'review' | undefined { return this.review && (!this.inEvolutionReview || this.reviewChanged()) ? 'review' : undefined; }
  private reviewChanged() { return Boolean(this.review?.changes?.length || this.pending?.review === this.review?.id || this.pendingReview === this.review?.id); }
  get exitOperationSchema() { const kind = this.exitOperationKind; return kind ? providerOperationSchema(kind, this.review.modeDefinition.exitSchema) : undefined; }
  get dueWindows() { return this.windows.filter(w => ['due_unverified', 'due_comparable'].includes(w.status)).map(w => w.id); }
  get hasReview() { return Boolean(this.review || this.queue.length); }
  /** Whether the task still has host-owned work that a model stop cannot complete. */
  get taskIncomplete() { return !(this.options.taskComplete?.() ?? false) || this.units < (this.options.requiredUnits?.() ?? 0) || this.windows.some(w => w.status === 'open') || this.hasReview || this.unresolvedReview || Boolean(this.taskEndPending); }
  get pendingRevision() { return this.pending?.revision ?? this.serial; }
  get isPaused() { return this.paused; }
  get isResetting() { return Boolean(this.resetInProgress); }
  private baseSaved() { return { snapshot: super.snapshot(), history: super.history() }; }
  private definition() { return { revision: this.serial, base: this.baseSaved(), policy: copy(this.policy) }; }
  export() {
    return { ...this.baseSaved(), root: copy({ root_id: this.root_id, contract_hash: this.contract.content_hash,
      serial: this.serial, request: this.request, ledger: this.ledger, lineage: this.lineage, definitions: this.definitions,
      windows: this.windows, queue: this.queue, currentMode: this.currentMode, review: this.review,
      consumed: [...this.consumed], started: this.started, units: this.units, tokens: this.tokens, usd: this.usd,
      paused: this.paused, previousMode: this.previousMode, providerCosts: [...this.providerCosts], policy: this.policy,
      workRequests: this.workRequests, reviewRequests: this.reviewRequests, reviewedQualityRefs: [...this.reviewedQualityRefs], daemonRecord: this.daemonRecord ?? null,
      conditionSet: this.conditionSet, settlementCount: this.settlementCount, lastSettlementReview: this.lastSettlementReview,
      taskEnded: this.taskEnded ?? null, taskEndPending: this.taskEndPending ?? null, unresolvedReview: this.unresolvedReview, segmentStart: this.segmentStart, segmentRefs: this.segmentRefs, contextByRequest: this.contextByRequest,
      activeReset: this.activeReset ?? null, resetInProgress: this.resetInProgress ?? null, pending: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses, status: 'intent', review: this.pendingReview ?? null } : null }) };
  }
  private add(kind: 'fact' | 'claim', type: string, value: unknown) {
    const row = { ref: `ledger:${this.ledger.length}`, kind, type, revision: this.serial, request: this.request, value: copy(value) };
    this.ledger.push(row); return copy(row);
  }
  fact(type: string, value: unknown) { return this.add('fact', type, value); }
  claim(type: string, value: unknown) { return this.add('claim', type, value); }
  protected override resolveEvidence(ref: string) {
    const native = super.resolveEvidence(ref);
    if (native) return native;
    const row = this.ledger.find(r => r.ref === ref && r.kind === 'fact');
    return row ? { ref, type: row.type, facts: copy(row.value) } : undefined;
  }
  read(offset = 0, count = 20) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 1 || count > 40) throw Error('invalid ledger page');
    const rows: Row[] = []; let bytes = 0;
    for (const row of this.ledger.slice(offset, offset + count)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (bytes + size > 16 * 1024 && rows.length) break;
      rows.push(copy(row)); bytes += size;
    }
    return { rows, next: offset + rows.length < this.ledger.length ? offset + rows.length : null, total: this.ledger.length };
  }
  detail(section: string, offset = 0, count = 20): any {
    if (section === 'pin') return this.pinView();
    if (section === 'self') return { ...this.mirror(), ledger: this.read(offset, count), conditions: { settlement_count: this.settlementCount, conditions: copy(this.conditionSet), published_steps: copy(FLOOR_STEPS) } };
    if (section === 'ledger') return this.read(offset, count);
    if (section === 'policy') return copy(this.policy);
    if (section === 'contract') return copy(this.contract);
    if (section === 'definition') return copy(this.definitions.find(d => d.revision === offset));
    if (section === 'lineage') return { rows: copy(this.lineage.slice(offset, offset + count)), total: this.lineage.length };
    if (section === 'windows') return copy(this.windows);
    if (section === 'continuity') return { current: super.snapshot(), review: copy(this.review ?? null), requestPin: copy(this.requestPin ?? null) };
    if (section === 'conditions') return { settlement_count: this.settlementCount, conditions: copy(this.conditionSet), published_steps: copy(FLOOR_STEPS) };
    if (section === 'segments') return { rows: this.segmentRefs.slice(offset, offset + count).map(ref => ({ ref, ...copy(this.ledger.find(r => r.ref === ref)!.value) })), total: this.segmentRefs.length };
    if (section === 'requests') { const rows = this.ledger.filter(r => r.type === 'request_record'); return { rows: copy(rows.slice(offset, offset + Math.min(count, 10))), total: rows.length }; }
    if (section === 'context_item') throw Error('context_item needs ref: read_self(section="context_item", ref)');
    throw Error('unknown self section');
  }
  private pinView() {
    return { root_id: this.root_id, revision: this.serial, mode: this.currentMode, in_review: Boolean(this.review), step: this.step,
      writable: this.contract.writable, operations: PROTOCOL, read: 'read_self(section="self")' };
  }
  private assertWrite(address: string) {
    if (!this.contract.writable.includes(address)) throw Error(`protected or unsupported address ${address}`);
    if (this.paused) throw Error('inconsistent/paused');
  }
  private async evaluate(source: string, input: any, metadata: any) {
    const started = Date.now();
    try {
      const result = await runLiveSelfMethod(source,input);
      this.capsule({ input, method_source: source, dependencies: { method: hash(source), isolation: 'pure WASI', metadata }, counterevidence: [], unresolved: [], continuation: { step: this.step, revision: this.serial }, outcome: { status: 'returned', result, duration_ms: Date.now()-started } }, 'host_execution');
      return result;
    } catch (e) {
      this.capsule({ input, method_source: source, dependencies: { method: hash(source), isolation: 'pure WASI', metadata }, counterevidence: [], unresolved: ['method failed; no world inference'], continuation: { step: this.step, revision: this.serial }, outcome: { status: 'failed', error: String(e), duration_ms: Date.now()-started } }, 'host_execution');
      throw e;
    }
  }
  /** All reflection tools in one model response share this pending chain. */
  transaction(input: { baseRevision?: number; components?: any[]; intent?: ContextIntent & Record<string, any>; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; expected_effect?: string; evidence_refs?: string[]; success_predicate?: any }) {
    const result = this.mutations.then(() => this.prepareTransaction(input));
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  abortTransaction(error: unknown) {
    this.pending = undefined; this.pendingReview = undefined;
    if (!this.chainFailed) this.fact('transaction_failed',{error:String(error),status:'entire response chain aborted'});
    this.chainFailed = true;
  }
  private async prepareTransaction(input: { baseRevision?: number; components?: any[]; intent?: ContextIntent & Record<string, any>; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; expected_effect?: string; evidence_refs?: string[]; success_predicate?: any }) {
    try {
      if (this.chainFailed) throw Error('transaction chain already failed');
      if (input.baseRevision !== undefined && input.baseRevision !== this.pendingRevision) throw Error(`stale revision; expected ${this.pendingRevision}`);
      const origin = this.pending?.candidate ?? this;
      const base = origin === this ? this.baseSaved() : { snapshot: origin.snapshot(), history: origin.history() };
      let candidate = new LiveAgentSelf(base, this.rootValidator);
      let policy = copy(this.pending?.policy ?? this.policy);
      const addresses: string[] = [];
      if (input.restore !== undefined) {
        const old = this.definitions.find(d => d.revision === input.restore);
        if (!old) throw Error('unknown same-root snapshot');
        // Definitions only. Current receipts, resources and slot continuity stay current.
        input = { ...input, policy: old.policy, orchestration: old.base.snapshot.orchestration,
          components: old.base.snapshot.components.filter((c: any) => c.kind !== 'memory').map((c: any) => ({ kind: c.kind, name: c.name, source: c.source, op: candidate.allComponents().some(x => x.path === c.path) ? 'redefine' : 'define' })) };
        const wanted = new Set(old.base.snapshot.components.map((c: any) => c.path));
        // Restore a method, never roll learned memory back to an older text.
        for (const c of candidate.allComponents()) if (c.kind === 'memory') wanted.add(c.path);
        for (const c of candidate.allComponents()) if (!wanted.has(c.path)) { this.assertWrite(`components.${c.kind}`); addresses.push(`components.${c.kind}.${c.name}`); }
        const saved = { snapshot: candidate.snapshot(), history: candidate.history() };
        saved.snapshot.components = saved.snapshot.components.filter(c => wanted.has(c.path));
        candidate = new LiveAgentSelf(saved,this.rootValidator);
      }
      for (const c of input.components ?? []) {
        this.assertWrite(`components.${c.kind}`);
        if (c.kind === 'subagent') throw Error('v1 has one agent; task subagents are not authorized');
        if (c.kind === 'tool' && (PROTOCOL.includes(c.name) || this.contract.capabilities.includes(c.name) || (this.options.reservedToolNames ?? []).includes(c.name))) throw Error('tool name collides with protected protocol or host capability');
        const value = { ...c, source: c.source, baseRevision: candidate.revision };
        if (c.kind === 'memory' && c.op === 'redefine' && policy.memory.write === 'append') value.source = `${candidate.active().find(x => x.kind === 'memory' && x.name === c.name)?.source ?? ''}\n${c.source}`;
        await candidate.reflectComponent(value); addresses.push(`components.${c.kind}.${c.name}`);
      }
      if (input.intent !== undefined) {
        this.assertWrite('policy');
        const context = normalizeContextIntent(input.intent).context;
        policy = mergePatch(policy, { context });
        validatePolicy(policy, this.contract, this.outputLimit); addresses.push('policy.context');
      }
      if (input.orchestration !== undefined || input.restore !== undefined) {
        this.assertWrite('orchestration');
        if (input.restore !== undefined && input.orchestration === undefined) { await candidate.reflectOrchestration({ baseRevision:candidate.revision, restore:input.restore, authorized:true }); addresses.push('orchestration'); }
        if (input.orchestration !== undefined) {
          input.orchestration = normalizeOrchestration(input.orchestration);
          if (input.orchestration.roles?.length !== 1 || input.orchestration.roles[0].id !== 'agent') throw Error('v1 roles must be only agent');
          await candidate.reflectOrchestration({ baseRevision: candidate.revision, orchestration: input.orchestration, authorized: true, carry: input.carry, stepMap: input.stepMap }); addresses.push('orchestration');
        }
      }
      if (input.policy !== undefined) {
        this.assertWrite('policy');
        // A restore carries a whole definition; an Agent change is a merge patch onto the current (pending) policy.
        const next = input.restore !== undefined ? copy(input.policy) : mergePatch(policy, input.policy);
        validatePolicy(next, this.contract, this.outputLimit); policy = next; addresses.push('policy');
      }
      if (!addresses.length) throw Error('empty transaction');
      if (input.restore === undefined && hash(candidate.snapshot()) === hash(base.snapshot) && hash(policy) === hash(this.policy)) {
        return { status: 'no_change', changed: false, reason: 'candidate matches the active self', current: addresses.map(address => ({ address, value: address === 'policy.context' ? copy(policy.context) : 'read_self(section="self")' })) };
      }
      const evolution = this.inEvolutionReview;
      if (evolution) {
        const supplied = [...(input.components?.flatMap((c: any) => c.evidence_refs ?? []) ?? []), ...(input.evidence_refs ?? [])];
        const facts = new Set(this.reviewView().all_facts.map((r: any) => r.ref));
        input.evidence_refs = [...new Set(supplied.filter((ref: string) => facts.has(ref)))];
      }
      if (this.chainFailed) throw Error('response chain failed while candidate was being validated');
      const revision = this.pendingRevision + 1;
      this.pendingReview = this.review?.id ?? this.pendingReview;
      const knownMetrics = this.reviewView().quality_facts.flatMap((row: any) => row.value?.metrics ?? []).filter(isMetric);
      const requestedPredicate = input.components?.find((c: any) => c.success_predicate)?.success_predicate ?? (input as any).success_predicate;
      const metric = requestedPredicate?.metric ? knownMetrics.find(m => m.name === requestedPredicate.metric) ?? knownMetrics.find(m => m.name.includes(requestedPredicate.metric) || requestedPredicate.metric.includes(m.name)) : knownMetrics[0];
      const success_predicate = metric ? { metric: metric.name, direction: requestedPredicate?.direction ?? 'decrease', segment: requestedPredicate?.segment ?? 'last' } : undefined;
      const reviewFacts = this.reviewView().all_facts.map((r: any) => r.ref);
      const evidence_refs = [...new Set([...(input.components?.flatMap((c: any) => c.evidence_refs ?? []) ?? []), ...(input.evidence_refs ?? []), ...(evolution ? reviewFacts : [])].filter((ref: string) => reviewFacts.includes(ref)))];
      this.pending = { candidate, policy, revision, addresses: [...(this.pending?.addresses ?? []), ...addresses], windows: [...(this.pending?.windows ?? []), ...(evolution && addresses.length ? [{ addresses, success_predicate, evidence_refs, review: this.review?.id ?? null }] : [])], source: input.restore,
        baseStateHash: this.pending?.baseStateHash ?? hash(this.baseSaved().snapshot) };
      return this.fact('reflection_activated', { revision, addresses, activation: 'before next provider request', review: this.review?.id ?? null }).value;
    } catch (e) {
      this.abortTransaction(e); throw e;
    }
  }
  override async reflectComponent(input: any): Promise<any> {
    // Seed only before the first request; not an agent mutation.
    if (input.origin?.by === 'runtime-seed' && this.request === 0) {
      const result = await super.reflectComponent({ ...input, baseRevision: super.revision });
      this.definitions = [this.definition()]; return result;
    }
    return this.transaction({ baseRevision: input.baseRevision ?? this.pendingRevision, components: [input], expected_effect: input.expected_effect });
  }
  override async reflectSource(_path: string, _source: string, _level = 0, _baseRevision = this.revision): Promise<any> {
    throw Error('Generic component-storage writes are refused; use reflect_component or reflect_orchestration');
  }
  override async reflectOrchestration(input: any): Promise<any> { return this.transaction(input); }
  override assertActionAllowed(type: string) {
    if (!this.executionGrant.includes(type) && !PROTOCOL.includes(type)) throw Error(`action ${type} outside pinned mode/user surface`);
    // Review suspends the work step; its observe tools are not constrained by a work whitelist.
    if (this.requestPin?.mode === 'execute') super.assertActionAllowed(type);
  }
  surface() {
    // Evolution review observes evidence; task artifacts are not edited there (design §1).
    const tools = this.inEvolutionReview
      ? [...new Set([...this.policy.review.tools, ...this.review?.modeDefinition.tools ?? [], ...this.policy.modes[this.currentMode].tools])] : this.review?.modeDefinition.tools ?? this.policy.modes[this.currentMode].tools;
    return [...new Set([...PROTOCOL, ...tools.filter((t: string) => t !== 'agent_tools' && this.contract.capabilities.includes(t)),
      ...(tools.includes('agent_tools') && this.contract.capabilities.includes('agent_tools') ? this.active().filter(c => c.kind === 'tool').map(c => c.name) : [])])];
  }
  allowTool(name: string, args: any) { this.assertActionAllowed(this.options.actionOf ? this.options.actionOf(name, args) : name); }
  get inEvolutionReview() { return Boolean(this.review?.triggers.some((t: any) => t.id === 'evolution_review')); }
  get settlementReviewRef() { return this.lastSettlementReview; }
  get inCapabilityReview() { return this.inEvolutionReview; }
  get capabilityReviewClosed() { return this.ledger.some(r => r.type === 'review_closed' && r.value?.occasion === 'evolution_review' && r.value?.closed_by === 'agent'); }
  /** read_self(section="context_item", ref): read-only recovery of an item the active context policy omitted. */
  contextItem(ref: string) {
    if (!this.options.contextItem) throw Error('context item recovery is not provided by this runtime adapter');
    return this.options.contextItem(ref);
  }
  actionName(name: string, args: any) { return this.options.actionOf ? this.options.actionOf(name, args) : name; }
  isFinalDelivery(name: string, args: any) {
    return (this.options.finalDeliveryTools ?? []).includes(this.actionName(name, args));
  }
  private applyConditionAddenda() {
    const routes = this.policy.routes.map((route: any) => ({ id: route.id, event: route.event, mode: route.mode, priority: route.priority }));
    this.conditionSet.addenda = routes;
  }
  /** Activate the pending candidate (single place). Creates host windows for evolution-review reflections. */
  private activatePending(applySurface: (tools: string[]) => void, persist: () => void) {
    if (!this.pending) return;
    const p = this.pending, old = this.baseSaved(), oldPolicy = this.policy, oldSerial = this.serial, onReflection = this.onReflection;
    if (hash(old.snapshot) !== p.baseStateHash) {
      this.pending = undefined; this.chainFailed = false;
      this.fact('activation_failed',{ error:'pinned state changed after reflection; retry migration against current state', revision:this.serial });
      if (this.pendingReview && !this.review) this.fact('review_activation_interrupted', { review: this.pendingReview, outcome: 'not_activated', reason: 'activation failed' });
      this.pendingReview = undefined;
      return;
    }
    const windowCount = this.windows.length, definitionCount = this.definitions.length, lineageCount = this.lineage.length;
    this.fact('transaction_intent', { from: this.serial, to: p.revision, addresses: p.addresses }); persist();
    try {
      // Private base-class fields are own properties; preserve this root's identity and META state.
      Object.assign(this, p.candidate); this.onReflection = onReflection; this.policy = p.policy; this.serial = p.revision;
      this.onReflection?.({ kind: 'orchestration', revision: this.serial });
      applySurface(this.surface());
      this.pending = undefined;
      const activated = this.fact('reflection_activated', { parent: oldSerial, revision: this.serial, addresses: p.addresses, restore_source: p.source ?? null, review: this.review?.id ?? this.pendingReview ?? null });
      for (const w of p.windows) if (w) this.createWindow(oldSerial, activated.ref, w.addresses ?? p.addresses, w.expected_effect, w.review ?? null, w.success_predicate, w.evidence_refs);
      this.definitions.push(this.definition());
      this.lineage.push(activated);
      this.applyConditionAddenda();
      if (this.review) this.review.changes.push(activated.ref);
      else if (this.pendingReview) this.fact('review_activation_closed', { review: this.pendingReview, activation: activated.ref, outcome: 'changed',
        windows: this.windows.filter(w => w.activation === activated.ref).map(w => w.id) });
      if (p.source !== undefined) for (const w of this.windows) if (w.status === 'restore_pending') { w.status = 'restored'; this.fact('reflection_restored',{ window:w.id, revision:this.serial, restore_source:p.source, addresses: p.addresses }); this.fact('validation_enacted',{ window:w.id, revision:this.serial, restore_source:p.source }); }
      this.pendingReview = undefined;
      persist();
    } catch (e) {
      this.pending = undefined; this.policy = oldPolicy; this.serial = oldSerial;
      this.windows.length = windowCount; this.definitions.length = definitionCount; this.lineage.length = lineageCount;
      Object.assign(this, new LiveAgentSelf(old, this.rootValidator)); this.onReflection = onReflection;
      try { this.onReflection?.({ kind: 'orchestration', revision: this.serial }); applySurface(this.surface()); persist(); }
      catch (recovery) { this.paused = true; this.fact('inconsistent', { error: String(e), recovery: String(recovery) }); persist(); throw Error('tool/persistence compensation failed; paused'); }
      this.fact('activation_failed', { error: String(e), restored: this.serial }); persist(); throw e;
    }
  }
  /** Host-made window (art. 5-1): fixed segment baseline rule, no Agent bookkeeping fields. */
  private createWindow(parent: number, activation: string, addresses: string[], expected_effect: string | undefined, review: string | null, success_predicate?: any, evidence_refs: string[] = []) {
    const summaries = this.segmentRefs.map(ref => this.ledger.find(r => r.ref === ref)!).filter(Boolean);
    const last = summaries.at(-1);
    const lastMetrics: Metric[] = (last?.value?.metrics ?? []).filter(isMetric);
    const mean: Metric[] = lastMetrics.map(m => { const xs = summaries.flatMap(r => (r.value?.metrics ?? []).filter((x: any) => isMetric(x) && x.name === m.name && x.unit === m.unit).map((x: Metric) => x.value));
      return { name: m.name, unit: m.unit, value: xs.reduce((a: number, b: number) => a + b, 0) / xs.length }; });
    const window: Window = { id: `window:${this.windows.length}`, revision: this.serial, parent, review, activation, baseline: summaries.map(r => r.ref),
      baseline_segment: last ? Number(last.value.segment) : null, baseline_metrics: { last: lastMetrics, mean }, scope: [...addresses],
      due: { settlement: this.settlementCount + 1, after_use: true, rule: WINDOW_RULES.due }, ...(expected_effect ? { expected_effect } : {}),
      success_predicate, evidence_refs, baseline_phase: (last?.value?.phase ?? null), effect_status: success_predicate ? 'specified' : expected_effect ? 'specified' : 'effect_unspecified', later_use_refs: [], status: 'open',
      unknowns: [...(last ? [] : ['settled_baseline']), ...(lastMetrics.length ? [] : ['repeatable_numeric_metric']), ...(success_predicate ? [] : ['success_predicate']), 'comparable_phase', 'later_use'] };
    this.windows.push(window);
    this.fact('window_created', { window: window.id, revision: window.revision, parent, activation, baseline_rule: WINDOW_RULES.baseline, baseline_segment: window.baseline_segment,
      baseline_metrics: lastMetrics.length, due: window.due, effect_status: window.effect_status, unknowns: window.unknowns });
    return window;
  }
  /** Mechanical later-use facts for a window (no semantic inference). */
  private laterUse(w: Window) {
    const start = this.ledger.findIndex(r => r.ref === w.activation);
    const tools = new Set(w.scope.filter(a => a.startsWith('components.tool.')).map(a => a.slice('components.tool.'.length)));
    return this.ledger.filter((r, i) => i > start && r.kind === 'fact' && (
      (r.type === 'provider_input' && r.value?.pin?.mode === 'execute' && Number(r.value?.pin?.revision) >= w.revision && w.baseline_phase !== null && r.value?.phase === w.baseline_phase && !(w.evidence_refs ?? []).includes(r.ref)) ||
      (r.type === 'tool_result' && tools.has(r.value?.tool)) || (r.type === 'component_consumed' && r.revision >= w.revision))).map(r => r.ref);
  }
  /** Deliver a window against one observed segment summary (or none at task end). Differences only; no verdict. */
  private deliverWindow(w: Window, reason: string, observedRef?: string) {
    w.later_use_refs = this.laterUse(w);
    const observedRow = observedRef ? this.ledger.find(r => r.ref === observedRef) : undefined;
    const observed: Metric[] = (observedRow?.value?.metrics ?? []).filter(isMetric);
    const comparisons = w.baseline_metrics.last.flatMap(b => {
      const o = observed.find(x => x.name === b.name && x.unit === b.unit && ((x as any).scope ?? 'segment') === ((b as any).scope ?? 'segment')); if (!o) return [];
      const m = w.baseline_metrics.mean.find(x => x.name === b.name && x.unit === b.unit);
      return [{ name: b.name, unit: b.unit, baseline_last: b.value, baseline_mean: m?.value ?? null, observed: o.value, diff_last: o.value - b.value, diff_mean: m ? o.value - m.value : null }]; });
    const key = (m: Metric) => `${m.name}|${m.unit}`;
    const missing_metrics = [...new Set([...w.baseline_metrics.last.map(key), ...observed.map(key)])]
      .filter(k => !w.baseline_metrics.last.some(m => key(m) === k) || !observed.some(m => key(m) === k));
    const predicate = w.success_predicate;
    const comparison = predicate ? comparisons.find(c => c.name === predicate.metric) : undefined;
    const matchingPhase = w.baseline_phase !== null && observedRow?.value?.phase === w.baseline_phase;
    const missing = [...(w.later_use_refs.length ? [] : ['later_use']), ...(observedRow ? [] : ['observed_segment']),
      ...(w.baseline.length ? [] : ['settled_baseline']), ...(comparisons.length ? [] : ['repeatable_numeric_metric']),
      ...(predicate ? [] : ['success_predicate']), ...(comparison ? [] : ['predicate_metric']), ...(matchingPhase ? [] : ['comparable_phase']), ...(comparisons.length ? [] : ['same_metric_scope'])];
    const predicateMet = predicate && comparison && matchingPhase ? predicate.direction === 'increase'
      ? comparison.observed > (predicate.segment === 'mean' ? comparison.baseline_mean : comparison.baseline_last)
      : comparison.observed < (predicate.segment === 'mean' ? comparison.baseline_mean : comparison.baseline_last) : false;
    const verification = missing.length || !predicate ? 'unverified' : 'comparable';
    w.status = verification === 'comparable' ? 'due_comparable' : 'due_unverified';
    w.delivered = { reason, baseline_segment: w.baseline_segment, observed_segment: observedRow?.value?.segment ?? null, observed_ref: observedRef ?? null,
      metric_comparisons: comparisons, missing_metrics, later_use: w.later_use_refs.length > 0,
      later_use_refs: w.later_use_refs.slice(-20), missing, verification, success_predicate: predicate ?? null, predicate_met: verification === 'comparable' ? Boolean(predicateMet) : null, restore_default: w.parent };
    return this.fact('validation_delivered', { window: w.id, ...w.delivered });
  }
  async boundary(applySurface: (tools: string[]) => void, persist: () => void) {
    if (this.paused) throw Error('inconsistent/paused');
    this.activatePending(applySurface, persist);
    this.chainFailed = false;
    if (!this.review) this.reviewRequests = 0;
    await this.event('request_boundary',`request:${this.request}`);
    if (!this.review && this.queue.length) this.enter(this.queue.shift());
    this.lastSurface = this.surface(); applySurface(this.lastSurface);
    if (!this.review && this.pendingDelivery) { const delivery = this.pendingDelivery; this.pendingDelivery = undefined; await delivery.run(); }
  }
  /** End a response. Host-opened reviews close only by Agent change or an explicit unresolved cap record. */
  endResponse(applySurface: (tools: string[]) => void, persist: () => void, reason: string) {
    if (!this.paused) this.activatePending(applySurface, persist);
    if (!this.review || !this.inEvolutionReview) this.closeMechanically(reason);
  }
  /** Task end (formal delivery or a real terminal stop): open windows become due. */
  taskEnd(reason: string) {
    if (this.taskEnded) return { duplicate: true };
    const formalDelivery = reason === 'delivered';
    if (formalDelivery && (this.review || this.queue.length || this.pendingDelivery || this.unresolvedReview || this.windows.some(w => ['open','due_unverified','due_comparable','restore_pending'].includes(w.status)))) {
      this.taskEndPending = reason;
      return { deferred: true };
    }
    this.taskEnded = reason;
    const delivered = this.windows.filter(w => w.status === 'open').map(w => {
      const observed = this.segmentRefs.map(ref => this.ledger.find(r => r.ref === ref)!).filter(r => r && Number(r.value.segment) > (w.baseline_segment ?? 0)).at(-1);
      return this.deliverWindow(w, `task end: ${reason}`, observed?.ref).ref; });
    this.taskEndPending = undefined;
    this.fact('task_ended', { reason, windows_delivered: delivered });
    return { delivered };
  }
  /** Ledger rows of the current (uncounted) unit segment, for adapter metrics. */
  segmentRows() { return copy(this.ledger.slice(this.segmentStart)); }
  get segmentNumber() { return this.settlementCount + 1; }
  private isWork(r: Row) {
    const boundary = this.options.boundaryTools ?? [];
    if (r.kind !== 'fact' || r.value?.mode !== 'execute') return false;
    const tool = r.value?.tool ?? r.value?.facts?.tool;
    const action = r.value?.action ?? r.value?.facts?.action ?? tool;
    return Boolean(tool) && !PROTOCOL.includes(tool) && !boundary.includes(action);
  }
  private segmentHasWork(rows: Row[]) {
    return rows.some(r => this.isWork(r) || (r.type === 'event' && ['tool_failed', 'tool_cancelled'].includes(r.value?.type)
      && !PROTOCOL.includes(r.value?.facts?.tool)
      && !(this.options.boundaryTools ?? []).includes(this.actionName(r.value.facts.tool, r.value.facts.args))));
  }
  /** Host-selected evidence for the review's counted segment, in a fixed order. */
  reviewView() {
    const eventRow = this.review ? this.ledger.find(r => r.ref === this.review.event && r.type === 'event') : undefined;
    const facts = eventRow?.value?.facts ?? {};
    const summary = facts.segment_summary ? this.ledger.find(r => r.ref === facts.segment_summary) : undefined;
    const range = summary?.value?.ledger;
    const rows = Array.isArray(range) ? this.ledger.slice(range[0], range[1] + 1) : [];
    const item = (r: Row) => ({ ref: r.ref, type: r.type, value: copy(r.value) });
    const processTypes = new Set(['request_record', ...PROCESS_FACT_TYPES]);
    const processFacts = rows.filter(r => processTypes.has(r.type)).map(item);
    const toolEvents = rows.filter(r => r.type === 'event' && ['tool_succeeded', 'tool_failed', 'tool_cancelled'].includes(r.value?.type))
      .map(r => ({ ref: r.ref, type: r.value.type, facts: copy(r.value.facts) }));
    const boundaries = rows.filter(r => r.type === 'event' && ['unit_completed', 'work_quantum', 'settlement'].includes(r.value?.type))
      .map(r => ({ ref: r.ref, type: r.value.type, facts: copy(r.value.facts) }));
    const receipts = rows.filter(r => (this.options.processFactTypes ?? []).includes(r.type)).map(item);
    const selfActivity = rows.filter(r => ['reflection_activated', 'reflection_noop', 'review_closed'].includes(r.type)).map(item);
    const qualityFacts = rows.filter(r => r.type === 'task_outcome').map(r => ({ ref: r.ref, value: copy(r.value) }));
    const due = (facts.due_windows ?? []).map((id: string) => {
      const window = this.windows.find(w => w.id === id);
      return window ? { id, delivered: copy(window.delivered ?? null) } : { id, delivered: null };
    });
    const allFacts = rows.filter(r => r.kind === 'fact').map(item);
    return { process_facts: processFacts, tool_events: toolEvents, boundaries, receipts_probes: receipts,
      self_activity: selfActivity, quality_facts: qualityFacts, due_window_deliveries: due, all_facts: allFacts };
  }
  /** Host-made per-segment summary: counts, sums, max and last over recorded facts; no labels or ranking. */
  private summarizeSegment(boundaryRef: string, unit: string | null) {
    const rows = this.ledger.slice(this.segmentStart);
    const reqs = rows.filter(r => r.type === 'request_record' && r.value?.pin?.mode === 'execute' && !this.isProbeKind(r.value?.kind));
    const allReqs = rows.filter(r => r.type === 'request_record' && !this.isProbeKind(r.value?.kind));
    const tok = (r: Row, k: string) => Number(r.value?.tokens?.[k] ?? 0);
    const sum = (k: string) => allReqs.reduce((n, r) => n + tok(r, k), 0);
    const lastComp = reqs.at(-1)?.value?.composition ?? null;
    const work = rows.filter(r => this.isWork(r));
    const byTool = new Map<string, { tool: string; calls: number; errors: number }>();
    for (const r of work) { const k = r.value.action ?? r.value.tool; const x = byTool.get(k) ?? { tool: k, calls: 0, errors: 0 }; x.calls++; byTool.set(k, x); }
    const errors = rows.filter(r => r.type === 'event' && r.value?.type === 'tool_failed');
    for (const r of errors) { const k = r.value?.facts?.tool ?? 'unknown'; const x = byTool.get(k) ?? { tool: k, calls: 0, errors: 0 }; x.errors++; byTool.set(k, x); }
    const process = { requests: allReqs.length, execute_requests: reqs.length, input_tokens_sum: sum('input'), input_tokens_max: Math.max(0, ...allReqs.map(r => tok(r, 'input'))),
      input_tokens_last: reqs.length ? tok(reqs.at(-1)!, 'input') : 0, output_tokens_sum: sum('output'), cache_read_sum: sum('cache_read'),
      output_cap_stops: allReqs.filter(r => r.value?.stop === 'output_cap').length, provider_retries: allReqs.reduce((n, r) => n + Number(r.value?.provider_retries ?? 0), 0),
      tool_errors: errors.length, latency_s: allReqs.reduce((n, r) => n + Number(r.value?.latency_ms ?? 0), 0) / 1000,
      history_chars_last: Number(lastComp?.history?.chars_after ?? 0), images_in_context_last: Number(lastComp?.history?.images_after ?? 0),
      context_policy_revisions: [...new Set(allReqs.map(r => r.value?.context_policy?.revision).filter((x: any) => x !== undefined))] };
    const outcomeRows = rows.filter(r => r.kind === 'fact' && r.type === 'task_outcome' && Array.isArray(r.value?.metrics));
    const outcome = new Map<string, Metric>();
    for (const r of outcomeRows) for (const m of r.value.metrics) if (isMetric(m)) outcome.set(`${m.name}|${m.unit}`, { name: m.name, value: m.value, unit: m.unit });
    const processMetrics: Metric[] = Object.entries(process).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ name: `process.${k}`, value: v as number, unit: k.includes('tokens') ? 'tokens' : k.includes('chars') ? 'chars' : k === 'latency_s' ? 's' : 'count' }));
    const workMetrics: Metric[] = [{ name: 'work.task_actions', value: work.length, unit: 'count' }];
    const metrics = [...processMetrics, ...workMetrics, ...outcome.values()];
    const phase = rows.find(r => r.type === 'provider_input')?.value?.phase ?? null;
    const row = this.fact('segment_summary', { segment: this.settlementCount, boundary: boundaryRef, unit, phase, ledger: [this.segmentStart, this.ledger.length - 1],
      requests: allReqs.length ? [allReqs[0].value.request, allReqs.at(-1)!.value.request] : [], process, work: { task_actions: work.length, by_tool: [...byTool.values()].sort((a, b) => a.tool.localeCompare(b.tool)) },
      outcome_refs: outcomeRows.map(r => r.ref), metrics, composition_last: lastComp });
    this.segmentRefs.push(row.ref);
    this.segmentStart = this.ledger.length;
    return row;
  }
  async event(type: string, boundary: string, facts: unknown = {}) {
    const key = `${type}:${boundary}`;
    if (this.consumed.has(key)) return { duplicate: true };
    this.consumed.add(key);
    const final = (facts as any)?.final === true;
    let settles = ['unit_completed', 'settlement', 'work_quantum'].includes(type);
    // D2: a unit boundary counts only when task work ran since the previous counted boundary (final delivery always settles).
    const forcedReview = (facts as any)?.force_review === true;
    const coalesced = settles && !final && !forcedReview && !this.segmentHasWork(this.ledger.slice(this.segmentStart));
    if (coalesced) settles = false;
    if (settles) this.settlementCount++;
    const event = this.fact('event', { type, boundary, facts });
    if (coalesced) {
      this.fact('boundary_coalesced', { event: event.ref, unit: (facts as any)?.unit ?? null, segment: this.segmentNumber, rule: WINDOW_RULES.segment });
      return { event: event.ref, triggers: [], coalesced: true };
    }
    const segmentEvidence = this.ledger.slice(this.segmentStart);
    const summary = settles ? this.summarizeSegment(event.ref, (facts as any)?.unit ?? null) : undefined;
    const input = { event, revision: this.serial, state: super.snapshot(), ledger_offset: this.ledger.length, request: this.request, resources: this.resources() };
    // Final settlement remains a counted boundary so booked quality/process facts can open the next review.
    const quiet = false;
    const routes = quiet ? [] : [...this.policy.routes].filter(r => r.event === type).sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const triggers: any[] = [];
    if (this.contract.boundaries.includes(type) && !quiet) triggers.push({ id: `contract:${type}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });
    if (settles && !quiet) {
      const classes = Array.isArray((facts as any)?.event_classes) ? (facts as any).event_classes : [];
      const tags = Array.isArray((facts as any)?.coverage_tags) ? (facts as any).coverage_tags : [];
      const prior = this.conditionSet.floor;
      this.conditionSet.floor = { ...prior, event_classes: [...new Set([...prior.event_classes, ...classes])], coverage_tags: [...new Set([...prior.coverage_tags, ...tags])] };
    const eventFacts = (facts as any)?.evidenceRefs ?? [];
      const segmentRows = segmentEvidence;
      const newFacts = eventFacts.length > 0 || segmentRows.some(r => r.type === 'task_outcome' || ['watch_stall','request_paused','exit_normalization','tool_failed','reflection_validation_failed','acceptance_result','validation_delivered'].includes(r.type));
      if (newFacts && this.policy.review.trigger !== 'disabled') triggers.push({ id: 'evolution_review', source: 'booked_facts', mode: 'reflect', conclusion_sink: 'ledger' });
    }

    for (const route of routes) {
      try {
        if (route.predicate && (await this.evaluate(this.policy.methods[route.predicate], input, { route: route.id })).value !== true) continue;
        triggers.push({ ...route, source: 'agent_method' });
      } catch (e) { this.fact('watch_stall', { route: route.id, error: String(e), triggered: false }); }
    }
    if (settles) {
      // A window is due at the first counted boundary after activation once later use was observed (fixed rule).
      for (const w of this.windows.filter(w => w.status === 'open' && this.settlementCount >= w.due.settlement)) {
        w.later_use_refs = this.laterUse(w);
        if (!w.later_use_refs.length) continue;
        this.deliverWindow(w, `settlement ${this.settlementCount}`, summary?.ref);
        if (!quiet) triggers.push({ id: w.id, source: 'validation_due', mode: 'reflect', conclusion_sink: 'ledger' });
      }
      const comparisons = this.ledger.filter(r => r.type === 'change_retained' && r.value?.delivered?.predicate_met === true);
      const prior = this.conditionSet.floor;
      const step = Math.max(prior.step, comparisons.length ? 3 : prior.step > 0 ? 1 : 0);
      this.conditionSet.floor = { step, evidence: [...new Set([...prior.evidence, ...FLOOR_STEPS.slice(0, step).flatMap(s => s.evidence_scope)])],
        event_classes: [...this.conditionSet.floor.event_classes], coverage_tags: [...this.conditionSet.floor.coverage_tags] };
      const row = this.ledger.find(r => r.ref === event.ref)!;
      row.value.facts = { ...(row.value.facts ?? {}), settlement: this.settlementCount, segment_summary: summary?.ref ?? null, comparison_refs: comparisons.map(r => r.ref),
        due_windows: this.dueWindows, conditions: copy(this.conditionSet) };
      this.lastSettlementReview = event.ref;
    }

    if (triggers.length) {
      const existing = this.queue.find(t => t.boundary === boundary);
      if (existing) existing.triggers.push(...triggers);
      else this.queue.push({ id: `review:${event.ref}`, boundary, event: event.ref, triggers, revision: this.serial, ledger_offset: this.ledger.length });
    }
    return { event: event.ref, triggers, ...(summary ? { segment_summary: summary.ref } : {}) };
  }
  /** Final delivery settles facts but leaves an evolvable review loop open when quality facts or windows remain. */
  async finalSettlement(boundary: string, facts: any = {}) {
    const result = await this.event('settlement', boundary, { ...facts, final: false, force_review: true });
    return { ...result, task_end: { deferred: true, reason: 'formal delivery completion is recorded by the adapter after its delivery action returns' } };
  }
  private enter(ticket: any) {
    this.previousMode = this.currentMode; this.currentMode = ticket.triggers[0].mode;
    this.reviewRequests = 0;
    this.review = { ...ticket, mode: this.currentMode, modeDefinition: copy(this.policy.modes[this.currentMode]), policy: copy(this.policy),
      suspended: { step: this.step, revision: this.serial }, changes: [], request_entered: this.request, snapshot: this.baseSaved(), windows: this.dueWindows, entry_hash: hash(this.baseSaved().snapshot) };
    if (this.inEvolutionReview) {
      const shown = this.reviewView().quality_facts.map((x: any) => x.ref);
      this.reviewedQualityRefs = new Set([...this.reviewedQualityRefs, ...shown]);
      this.fact('review_quality_facts', { review_event: ticket.event, refs: shown });
      this.fact('self_view', { review: ticket.id, view: this.reviewSelfView() });
    }
    this.fact('mode_entered', { id: ticket.id, mode: this.currentMode, triggers: ticket.triggers, suspended: this.review.suspended });
      this.fact('review_frame', { in_review: true, must_change_self: true, writes_resume: 'after decide_exit; hot orchestration changes remain active immediately', due_windows: this.dueWindows.map(w => w.id), result: 'runtime records activation, booked facts, retention or restore' });
  }
  reviewSelfView() {
    const active = this.active();
    const latest = this.segmentRefs.at(-1) ? this.ledger.find(r => r.ref === this.segmentRefs.at(-1))?.value : null;
    const entry = (name: string, kind: string, controls: string, value: any, writable: boolean, change: any) => ({ name, kind, controls, value, writable, ops: writable ? change.ops : [], change: writable ? change : null, latest_facts: latest?.metrics ?? [] });
    return { revision: this.serial, entries: [
      ...['prompt','skill','tool','memory'].flatMap(kind => active.filter(c => c.kind === kind).map(c => entry(c.name, kind, `${kind} component`, `${c.name}@${c.version} ${hash(c.source).slice(0, 12)}`, this.contract.writable.includes(`components.${kind}`), { ops: ['reflect_component'], example: { op: 'redefine', kind, name: c.name, source: 'replace with concrete content' } }))),
      entry('orchestration', 'orchestration', 'steps, transitions and decisions', `revision ${this.current.revision}`, this.contract.writable.includes('orchestration'), { ops: ['reflect_orchestration'], example: { orchestration: this.current.orchestration } }),
      entry('context', 'policy', 'working context assembly knobs', copy(this.policy.context), this.contract.writable.includes('policy'), { ops: ['reflect_orchestration'], example: { intent: { promptLayout: { volatileTail: 'self' } } } }),
      entry('review', 'policy', 'review trigger, evidence and validation method', copy(this.policy.review), this.contract.writable.includes('policy'), { ops: ['reflect_orchestration'], example: { policy: { review: copy(this.policy.review) } } }),
    ], full: 'read_self(section="self")' };
  }
  enterMode(mode: string) {
    if (!this.policy.modes[mode] || this.review) throw Error('mode unavailable or mode already active');
    const ref = this.claim('enter_mode', { mode });
    this.enter({ id: `review:${ref.ref}`, event: ref.ref, revision: this.serial, ledger_offset: this.ledger.length, triggers: [{ id: ref.ref, source: 'agent_active', mode, conclusion_sink: 'ledger' }] });
    return { activation_intent: mode, activation: 'next request boundary' };
  }
  async requestReset() {
    if (!this.activeReset) {
      this.activeReset = `reset:${this.request}`;
      await this.event('before_active_reset',this.activeReset);
      return { ready: false, id: this.activeReset };
    }
    if (this.review || this.queue.length) return { ready: false, id: this.activeReset };
    const result = { ready: true, id: this.activeReset };
    this.fact('active_reset_authorized',result); this.resetInProgress = this.activeReset; this.activeReset = undefined;
    return result;
  }
  finishReset(id: string, error?: string) {
    this.fact(error ? 'active_reset_failed' : 'active_reset_completed',{id,...(error ? {error} : {})});
    this.resetInProgress = undefined;
  }
  /** decide_exit: at most one invalid expression, then mechanical close. */
  exit(input: { reason?: string; result?: any }) {
    if (!this.review) throw Error('no active review');
    const review = this.review;
    const reason = input.reason ?? input.result?.reason;
    const result = input.result ?? (reason !== undefined ? { reason } : {});
    let invalid: string | undefined;
    try { validateSchema(result, review.modeDefinition.exitSchema); } catch (e) { invalid = `result does not match your mode exit schema: ${String(e)}`; }
    if (invalid) {
      review.invalid_exits = (review.invalid_exits ?? 0) + 1;
      if (review.invalid_exits === 1) {
        this.fact('exit_normalization', { review: review.id, error: invalid, next: 'a second invalid exit closes this review mechanically' });
        throw Error(`${invalid}; a second invalid exit closes this review mechanically`);
      }
      return this.closeMechanically('second invalid exit expression', { attempted: { reason: reason ?? null }, error: invalid });
    }
    return this.close(review, 'agent', { result });
  }
  /** One closure record; a host-unresolved close is distinct from an Agent conclusion. */
  private close(review: any, closedBy: string, extra: any = {}) {
    const evolution = this.inEvolutionReview;
    const unresolved = evolution && closedBy.startsWith('mechanical:') && !this.reviewChanged();
    const outcome = unresolved || closedBy.includes('review_unresolved') ? 'review_unresolved' : review.changes.length > 0 ? 'activated' : this.pending ? 'activation_intent' : 'closed';
    if (evolution && closedBy === 'agent' && !this.reviewChanged()) throw Error('host-opened evolution review requires a qualifying change');
    const undecided = (review.windows ?? []).filter((id: string) => this.windows.some(w => w.id === id && ['due_unverified', 'due_comparable'].includes(w.status)));
    for (const id of undecided) this.fact('validation_undecided', { window: id, review: review.id });
    const pinned = this.ledger.find(r => r.ref === review.event)?.value?.facts?.evidenceRefs;
    const evidenceRefs = [...new Set([review.event, ...(Array.isArray(pinned) ? pinned : [])].filter(Boolean))];
    const windows = this.windows.filter(w => w.review === review.id).map(w => ({ id: w.id, due: w.due, effect_status: w.effect_status, unknowns: w.unknowns }));
    const value = { review: review.id, occasion: evolution ? 'evolution_review' : null, outcome, closed_by: closedBy, ...extra,
      evidenceRefs, changes: review.changes, windows, undecided_windows: undecided, mode_version: review.revision, activation_intent: Boolean(this.pending) };
    const row = closedBy === 'agent' ? this.claim('review_closed', value) : this.fact('review_closed', value);
    if (this.pending) this.fact('review_activation_deferred', { review: review.id, closure: row.ref, outcome: 'activation_intent' });
    if (review.triggers.some((t: any) => t.conclusion_sink === 'lineage')) this.lineage.push(row);
    if (evolution && this.reviewChanged()) this.unresolvedReview = false;
    this.review = undefined; this.currentMode = this.previousMode;
    return { recorded: row.ref, outcome, windows, undecided_windows: undecided, activated: review.changes, activation_boundary: this.pending ? 'next request boundary' : null, resume: this.step, mode: this.currentMode };
  }
  /** One mechanical closure (agent_end, crash, budget, second invalid exit). Never invents an Agent decision. */
  closeMechanically(reason: string, extra: any = {}) {
    if (!this.review) return undefined;
    if (reason === 'review_unresolved') this.fact('review_unresolved', { review:this.review.id, requests:this.reviewRequests });
    return this.close(this.review, `mechanical:${reason}`, extra);
  }
  closeIncomplete(reason: string) { return this.closeMechanically(reason); }
  /** Host mechanically evaluates the Agent-declared predicate and retains or restores the changed definition. */
  async interpret(id?: string) {
    const due = this.windows.filter(w => ['due_unverified', 'due_comparable'].includes(w.status));
    const w = id === undefined ? (due.length === 1 ? due[0] : undefined) : this.windows.find(x => x.id === id);
    if (!w || !due.includes(w)) {
      const cause = id === undefined && due.length > 1 ? `several windows are due: ${due.map(x => x.id).join(', ')}` : w ? `window is ${w.status}; it becomes due after later use at a counted unit boundary` : 'no such due window';
      const row = this.fact('validation_pending', { window: id ?? null, due: due.map(x => x.id), open: this.windows.filter(x => x.status === 'open').map(x => x.id), cause });
      return { recorded: row.ref, status: 'incomplete', cause };
    }
    const met = w.delivered?.predicate_met === true;
    if (!met) {
      await this.transaction({ baseRevision: this.pendingRevision, restore: w.parent });
      w.status = 'restore_pending';
      return { window: w.id, result: 'restore_scheduled', predicate_met: false, predicate: w.success_predicate, restore: 'queued for the next request boundary' };
    }
    w.status = 'retained';
    this.fact('change_retained', { window: w.id, predicate: w.success_predicate, delivered: w.delivered });
    return { window: w.id, result: 'retained', predicate_met: true, predicate: w.success_predicate };
  }
  async replay(ref: string, source?: string) {
    const capsule = this.ledger.find(r => r.ref === ref && r.type === 'capsule');
    if (!capsule) throw Error('unknown capsule');
    const c = capsule.value;
    if (!c.method_source || !c.input) throw Error('capsule has no pure replayable method; unknown dependencies cannot be simulated');
    const value = await runLiveSelfMethod(source ?? c.method_source, c.input);
    return this.fact('replay', { capsule: ref, input_hash: hash(c.input), source_hash: hash(source ?? c.method_source), output: value, isolation: 'pure WASI; no workspace/network', counterfactual_world_result: false, dependencies: c.dependencies });
  }
  capsule(value: { input: any; method_source?: string; dependencies: any; counterevidence: any; unresolved: any; continuation: any; outcome: any }, source: 'agent_claim'|'host_execution' = 'agent_claim') {
    if (value.method_source) validateLiveSelfSource(value.method_source);
    return this.add(source === 'host_execution' ? 'fact' : 'claim','capsule', { ...value, source, input_hash: hash(value.input), environment: { node: process.version, python: 'repository WASI' } });
  }
  inherit(input: any) {
    // Agent supplies applicability/counterexamples; snapshot, dependencies, evidence and lifecycle status are host facts.
    if (input?.applicability === undefined) throw Error('inheritance requires applicability');
    const value = { counterexamples: [], dependencies: [], evidence_refs: [], snapshot: this.serial, status: 'candidate', ...input };
    if (!['candidate','retained_for_task','inactive'].includes(value.status)) throw Error('cross-task default inheritance disabled');
    if (!this.definitions.some(d => d.revision === value.snapshot)) throw Error('unknown inheritance snapshot');
    for (const ref of value.evidence_refs) if (!this.ledger.some(r => r.ref === ref)) throw Error('unknown inheritance evidence');
    const row = this.claim('inheritance', { ...value, auto_inherit: false, root_id: this.root_id }); this.lineage.push(row); return row;
  }
  outcome(value: any, delivered = false) { const row = this.fact('task_outcome', value); if (delivered) this.units++; return row; }
  adoptDaemonResources(record: any) { this.daemonRecord = copy(record); }
  private isProbeKind(kind?: string) { return [...CORE_PROBE_KINDS, ...(this.options.probeKinds ?? [])].includes(kind ?? ''); }
  settledTaskRequests() {
    return this.ledger.filter(r => r.type === 'request_record' && !this.isProbeKind(r.value?.kind)).length;
  }
  private usageParts(usage: any) {
    if (!usage) return null;
    const input = usage.input ?? usage.prompt_tokens, output = usage.output ?? usage.completion_tokens;
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    const details = usage.prompt_tokens_details ?? {}, outDetails = usage.output_tokens_details ?? {}, completionDetails = usage.completion_tokens_details ?? {};
    return { input: Number(input), output: Number(output),
      cache_read: Number(usage.cacheRead ?? usage.cache_read ?? details.cached_tokens ?? 0),
      reasoning: Number(usage.reasoning ?? usage.reasoning_tokens ?? outDetails.reasoning_tokens ?? completionDetails.reasoning_tokens ?? 0) };
  }
  private usdFromParts(parts: { input: number; output: number; cache_read: number }, rates: { input: number; output: number }) {
    return (parts.input * rates.input + parts.output * rates.output + parts.cache_read * rates.input) / 1e6;
  }
  resourceRecord() {
    const costs = this.ledger.filter(r => r.type === 'request_record');
    const tokens = { input: 0, output: 0, cache_read: 0, reasoning: 0, unknown_reserved: 0, reasoning_included_in_output: true as const };
    let conservative = 0, registered = 0, usageUnknown = 0;
    for (const row of costs) {
      const parts = this.usageParts(row.value?.usage);
      if (!parts || row.value?.status === 'unknown_reserved') {
        usageUnknown += 1;
        tokens.unknown_reserved += Number(row.value?.tokens ?? 0);
        const reserved = Number(row.value?.usd_estimate ?? 0);
        conservative += reserved;
        registered += reserved * ((REGISTERED_RATES.input + REGISTERED_RATES.output) / (CONSERVATIVE_RATES.input + CONSERVATIVE_RATES.output));
      } else {
        tokens.input += parts.input; tokens.output += parts.output; tokens.cache_read += parts.cache_read; tokens.reasoning += parts.reasoning;
        conservative += this.usdFromParts(parts, CONSERVATIVE_RATES);
        registered += this.usdFromParts(parts, REGISTERED_RATES);
      }
    }
    const pending = Math.max(0, this.request - costs.length);
    const reasons = (type: string) => this.ledger.filter(r => r.type === type).map(r => String(r.value?.reason ?? type));
    const permit = reasons('permit_rejected');
    const preflight = this.ledger.filter(r => r.type === 'preflight_completed' && r.value?.status && !['passed','available'].includes(r.value.status)).map(r => String(r.value.reason ?? r.value.status));
    const budget = reasons('budget_stop');
    return {
      requests: { dispatched: this.request, settled: costs.length, pending_settlement: pending, usage_unknown: usageUnknown },
      tokens, usd: {
        conservative: { input_per_million: CONSERVATIVE_RATES.input, output_per_million: CONSERVATIVE_RATES.output, estimate: conservative, label: 'conservative estimate 20/80 USD per million; estimate, never the invoice', billing: ESTIMATE_NEVER_INVOICE },
        registered: { input_per_million: REGISTERED_RATES.input, output_per_million: REGISTERED_RATES.output, estimate: registered, label: 'registered estimate 5/30 USD per million; estimate, never the invoice', billing: ESTIMATE_NEVER_INVOICE },
      },
      time: { started_at: this.started, elapsed_seconds: (Date.now() - this.started)/1000 },
      storage: { bytes: this.storageBytes },
      stops: {
        permit_reject: { count: permit.length, reasons: permit },
        preflight_failure: { count: preflight.length, reasons: preflight },
        budget_stop: { count: budget.length, reasons: budget },
      },

    };
  }
  resources() {
    const record = this.daemonRecord ?? this.resourceRecord();
    return { request: this.request, tokens: this.tokens, usd_estimate: this.usd, elapsed_seconds: (Date.now() - this.started)/1000, storage_bytes: this.storageBytes, units: this.units, cap: this.contract.budget, record };
  }
  async requestBoundary() {
    const sincePin = this.ledger.slice(this.requestPin?.ledger_offset ?? this.ledger.length);
    const worked = this.segmentHasWork(sincePin);
    if (this.requestPin?.mode === 'execute' && !this.isProbeKind(this.requestPin.kind) && worked) this.workRequests++;
    if (this.workRequests >= this.contract.segment.work_requests) {
      this.workRequests = 0;
      await this.event('work_quantum', `work:${this.settlementCount}:${this.request}`, { source: 'user_contract' });
    }
  }
  queueFinalDelivery(run: () => Promise<any>) {
    if (this.queue.length || this.review) throw Error('final delivery is already deferred by an open review');
    this.pendingDelivery = { run };
    return this.event('settlement', `quality-review:${this.request}:${this.ledger.length}`, { final: false, force_review: true, source: 'unreviewed_quality' }).then(result => ({ delivery_deferred: true, review: result.event, completion: 'host completes delivery after review closure' }));
  }
  needsQualityReview() { return this.ledger.some(r => r.type === 'task_outcome' && !this.reviewedQualityRefs.has(r.ref)); }
  guard(storageBytes?: number) {
    if (storageBytes !== undefined) this.storageBytes = storageBytes;
    const b = this.contract.budget;
    if (this.request >= b.requests || this.tokens >= b.tokens || this.usd >= b.usd || (Date.now()-this.started)/1000 >= b.seconds || this.storageBytes >= b.storage_bytes) {
      this.closeMechanically('hard budget'); this.fact('budget_stop', this.resources()); this.taskEnd('budget stop'); throw Error('authorized budget exhausted');
    }
  }
  pin(kind = 'task') {
    this.guard(); this.request++;
    this.requestPin = { request: this.request, revision: this.serial, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, context_policy_revision: this.serial, ledger_offset: this.ledger.length, step: this.step, kind };
    this.executionGrant = [...this.lastSurface];
    return copy(this.requestPin);
  }
  /** Per-request process fact (request_record): tokens, stop, latency and the context composition/receipt of this request. */
  cost(usage: any, duration_ms: number, usd: number, known: boolean, unknownTokens = 12000, extra: { stop?: string; cut_tool_calls?: string[]; provider_retries?: number | null; output_cap?: number; cache_supported?: boolean | 'unknown' } = {}) {
    if (this.providerCosts.has(this.request)) throw Error('request cost already counted');
    this.providerCosts.add(this.request);
    const tokens = known ? ['input','output','cacheRead','cacheWrite'].reduce((n,k) => n + Number(usage[k] ?? 0), 0) : unknownTokens;
    this.tokens += tokens; this.usd += usd;
    const parts = known ? this.usageParts(usage) : null;
    const context = this.contextByRequest[String(this.request)] ?? null;
    delete this.contextByRequest[String(this.request)];
    const row = this.fact('request_record', { request: this.request, pin: this.requestPin, kind: this.requestPin?.kind ?? 'task', segment: this.segmentNumber,
      usage: known ? usage : null,
      tokens: { input: parts?.input ?? null, output: parts?.output ?? null, cache_read: parts?.cache_read ?? null, cache_write: known ? Number(usage.cacheWrite ?? 0) : null, reasoning: parts?.reasoning ?? null,
        total: tokens, status: known ? 'reported' : 'unknown_reserved' },
      output_cap: extra.output_cap ?? this.policy.request?.maxOutputTokens ?? null, stop: extra.stop ?? null, cut_tool_calls: extra.cut_tool_calls ?? [],
      provider_retries: extra.provider_retries ?? null, cache_supported: extra.cache_supported ?? 'unknown', latency_ms: duration_ms, duration_ms,
      usd_estimate: usd, cost_source: 'provider usage + manifest rates; actual invoice unknown', status: known ? 'reported' : 'unknown_reserved',
      composition: context?.composition ?? null, context_policy: context?.receipt ?? null });
    return row;
  }
  /** Runtime assembly plan for this request from the pinned context policy (declarative knobs, then the Agent's optional
   * select method, then the floor). The adapter applies it; the Agent never edits individual items (art. 6-4). */
  async planContext(items: ContextItem[]) {
    const ctx = this.policy.context, policyHash = hash(ctx);
    const { actions } = planDeclarative(items, ctx);
    let select: any = null;
    if (ctx.select) {
      select = { method: ctx.select, failed: null as string | null };
      try {
        const out = await this.evaluate(this.policy.methods[ctx.select], { items: items.map(i => ({ ...i })), declarative: copy(actions), mode: this.currentMode, segment: this.segmentNumber }, { context_select: ctx.select });
        const chosen = out?.value?.actions ?? out?.actions;
        if (!chosen || typeof chosen !== 'object') throw Error('select returned no actions object');
        for (const [ref, a] of Object.entries<any>(chosen)) if (ref in actions && (['include','stub','drop'].includes(a) || (a && Number.isSafeInteger(a.truncate)))) actions[ref] = a;
      } catch (e) { select.failed = String(e); this.fact('watch_stall', { context_select: ctx.select, error: String(e), fallback: 'declarative plan' }); }
    }
    const floorKept = enforceFloor(items, actions);
    const sectionOrder = [...CORE_CONTEXT_SECTIONS, ...(this.options.contextSections ?? [])];
    const composition = contextComposition(items, actions, sectionOrder);
    const receipt = { revision: this.serial, hash: policyHash, plan_hash: hash(actions), select: select?.method ?? null, ...(select?.failed ? { select_failed: select.failed } : {}), floor_kept: floorKept.slice(0, 40), floor_kept_count: floorKept.length };
    return { actions, composition, receipt, policyHash };
  }
  /** Record the applied composition of the pinned request; merged into its request_record when usage settles. */
  recordContext(composition: any, receipt: any) {
    this.contextByRequest[String(this.request)] = { composition: copy(composition), receipt: copy(receipt) };
    for (const k of Object.keys(this.contextByRequest)) if (Number(k) < this.request - 4) delete this.contextByRequest[k];
  }
  memory() {
    let memories = this.active().filter(c => c.kind === 'memory' && (this.policy.memory.names === '*' || this.policy.memory.names.includes(c.name)));
    memories.sort(this.policy.memory.order === 'newest' ? (a,b) => b.version-a.version || a.name.localeCompare(b.name) : (a,b) => a.name.localeCompare(b.name));
    if (this.policy.memory_strategy.partition === 'kind') memories.sort((a,b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    if (this.policy.memory_strategy.sources.length && !this.policy.memory_strategy.sources.includes('agent')) return [];
    if (this.policy.memory_strategy.retention === 'latest') memories = memories.filter(c => c.version === Math.max(...memories.filter(x => x.name === c.name).map(x => x.version)));
    if (this.policy.memory_strategy.retrieval === 'recent') memories = memories.slice(-this.policy.memory_strategy.recent_count);
    return memories;
  }
  async projection() {
    const p = this.review?.policy ?? this.policy;
    const name = this.review?.triggers.find((r: any) => r.projection)?.projection ?? this.review?.modeDefinition.projection ?? p.modes[this.currentMode].projection;
    if (!name) return { counts: { facts: this.ledger.filter(r => r.kind === 'fact').length, claims: this.ledger.filter(r => r.kind === 'claim').length,
      outcomes: this.ledger.filter(r => r.type === 'task_outcome').length, requests: this.request, units: this.units }, evidence: { offset: 0, total: this.ledger.length, read: 'read_self(section="ledger",offset,count)' } };
    try { return { method: name, version: hash(p.methods[name]), value: (await this.evaluate(p.methods[name], { resources: this.resources(), evidence_index: this.ledger.map(r => ({ ref: r.ref, kind: r.kind, type: r.type, revision: r.revision })) }, { projection: name })).value }; }
    catch (e) { return { failed: String(e), fallback: { offset: 0, total: this.ledger.length }, structure_preserved: true }; }
  }
  override mirror(): any {
    const active = super.mirror();
    for (const component of active.architecture.components) delete (component as any).body;
    const reviewEvent = this.review && this.ledger.find(r => r.ref === this.review.event && r.type === 'event')?.value.facts;
    const reviewEvidence = reviewEvent ? { ...reviewEvent, ...this.reviewView() } : undefined;
    const rows = Math.min(this.policy.context.self_view?.ledger_rows ?? 4, 8);
    const lastRequest = this.ledger.findLast(r => r.type === 'request_record');
    const segments = this.segmentRefs.slice(-12).map(ref => { const v = this.ledger.find(r => r.ref === ref)!.value; return { ref, segment: v.segment, unit: v.unit, requests: v.requests, metrics: v.metrics }; });
    return { root_id: this.root_id, revision: this.serial, pin: { mode: this.currentMode, in_review: Boolean(this.review), must_change_self: Boolean(this.review), writes_resume: this.review ? 'after decide_exit; reflection remains hot' : 'now', current_knobs: { request: this.policy.request, context_intent: { meaning: 'runtime-owned context strategy', current: 'read_self(section="policy")' } }, result: this.lastSettlementReview ? 'read_self(section="ledger") for booked facts and results' : null }, architecture: active.architecture, ledger: rows ? this.read(Math.max(0, this.ledger.length - rows), rows) : { rows: [], next: 0, total: this.ledger.length }, parts: {
      components: { relation: 'executes from this root', writable_kinds: this.contract.writable.filter(x => x.startsWith('components.')) },
      orchestration: { relation: 'controls active step and trusted receipts', writable: this.contract.writable.includes('orchestration') },
      policy: { relation: 'controls modes, META, memory retrieval/write, request envelope and actual context assembly', request: this.policy.request,
        version: hash(this.policy), writable: this.contract.writable.includes('policy'), expand: 'read_self(section="policy")' },
      context: { relation: 'runtime assembles working context from Agent intent; composition section names are read-only facts',
        writable: this.contract.writable.includes('policy'), change: 'reflect_orchestration(intent={...})', last_composition: lastRequest?.value?.composition ?? null, retrieve: 'read_self(section="context_item", ref)' },
      protected: { reason: this.contract.readonly_reason, contract_hash: this.contract.content_hash, boundaries: this.contract.boundaries, budget: this.contract.budget, capabilities: this.contract.capabilities, acceptance: this.contract.acceptance },
      unsupported: ['provider replacement', 'task subagents', 'cross-task default promotion', 'interactive world replay'],
    }, dynamic: { run: active.run, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, settlement_count: this.settlementCount, conditions: copy(this.conditionSet), review: this.review ? { id: this.review.id, kind: this.exitOperationKind, triggers: this.review.triggers, pinned_ledger_offset: this.review.ledger_offset, suspended: this.review.suspended, exit_operation: this.exitOperationSchema, due_windows: this.dueWindows } : null,
      ...(reviewEvidence ? { review_evidence: copy(reviewEvidence) } : {}),
       process: { last_request: lastRequest ? { request: lastRequest.value.request, mode: lastRequest.value.pin?.mode ?? null, tokens: lastRequest.value.tokens, stop: lastRequest.value.stop,
          output_cap: lastRequest.value.output_cap, cut_tool_calls: lastRequest.value.cut_tool_calls, latency_ms: lastRequest.value.latency_ms, cache_supported: lastRequest.value.cache_supported,
          context_policy: lastRequest.value.context_policy, composition: lastRequest.value.composition } : null,
         current_segment: this.segmentNumber, segments, segments_total: this.segmentRefs.length, expand: 'read_self(section="segments"|"requests")', writable_knob: lastRequest?.value?.stop === 'output_cap' ? { name: 'maxOutputTokens', current: this.policy.request?.maxOutputTokens, fact: 'output_cap' } : null },
      instruction: this.review?.modeDefinition.instruction ?? this.policy.modes[this.currentMode].instruction,
      request_pin: this.requestPin, resources: this.resources(), activation_intent: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses } : null,
      queue: this.queue.map(t => t.id), windows: this.windows.filter(w => ['open','due_unverified','due_comparable','restore_pending'].includes(w.status)), window_rules: WINDOW_RULES, task_ended: this.taskEnded ?? null,
      evidence: { total: this.ledger.length, capsules: this.ledger.filter(r => r.type === 'capsule').map(r => r.ref), read: 'read_self' },
      lineage: { count: this.lineage.length, expand: 'read_self(section="lineage")' } } };
  }
}
