/** Same executing LiveAgentSelf; META contains no attribution or adoption policy. */
import { createHash, randomUUID } from 'node:crypto';
import { LiveAgentSelf, validateSchema, validateSchemaStructure, contractProblems, ORCHESTRATION_CONTRACT_FORM, TASK_EVENTS, type OrchestrationContract } from './live_orchestration_core.ts';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';
import { componentAddress, minimalComponentSource, type Validator } from './agent_component_model.ts';
import { observe, renderObservation, observationHeads, type Observation } from './self_observation.ts';

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
  onPendingDelivery?: (pending: boolean) => void;
  pendingDeliveryState?: () => boolean;
  runPendingDelivery?: () => Promise<unknown>;
  deliveryTransitionReached?: () => boolean;
  budgetStopPendingDelivery?: () => Promise<unknown>;
  /** Adapter actions that mark a unit boundary; they never count as work between boundaries. */
  boundaryTools?: string[];
  /** Adapter action receipt types recordAction can produce; once declared, orchestration reflection rejects bindings to any other type. */
  actionReceiptTypes?: string[];
  /** Adapter fact types whose completed work should open a review at its settlement. */
  workCheckpointTypes?: string[];
  /** Adapter-declared context section names (opaque to the core). */
  contextSections?: string[];
  /** Adapter resolver for read_self(section="context_item", ref). */
  contextItem?: (ref: string) => unknown;
  /** Host observation supplied at review entry. It may refresh a task artifact, but returns facts only. */
  observeCurrentArtifact?: () => unknown;
  /** Adapter-declared metric meaning; the core only uses the returned polarity and primary metric. */
  metricInfo?: (metrics: Metric[]) => { primary?: string; better?: 'higher' | 'lower'; scope?: string };
  /** Adapter-owned opaque identity for comparing observations of one metric. */
  observationIdentity?: (metric: Metric) => string | undefined;
  acceptanceUnits?: string[] | (() => string[]);
  canonicalSource?: () => string | undefined;
  /** Adapter-specific probe request kinds excluded from settled task requests. */
  probeKinds?: string[];
  /** Mechanism switches for single-factor ablation; defaults are the current behavior (all on, legacy off). */
  mechanisms?: SelfRootMechanisms };
export type SelfRootMechanisms = { observation?: boolean; compiler?: boolean; effect_return?: boolean; legacy_obligation?: boolean; a4?: boolean; ask?: boolean; l4?: boolean; meta?: boolean };
type Mode = { tools: string[]; instruction: string; projection?: string; exitSchema: any };
type Route = { id: string; event: string; predicate?: string; projection?: string; mode: string; priority: number; conclusion_sink: 'ledger' | 'lineage' };
export type ImagesRule = 'all' | 'latest' | 'none';
/** The Agent's working-context assembly policy. Seeds reproduce v0.1 behaviour; only the Agent changes it. */
export type ContextPolicy = {
  order: Array<'prompts' | 'memory' | 'skills'>; instruction: string; reasoning?: 'all' | 'latest' | 'none';
  history?: { recent_turns: number | null; older: 'drop' | 'stub' };
  tool_results?: { max_chars: number | null; images: ImagesRule; by_tool?: Record<string, { max_chars?: number | null; images?: ImagesRule }> };
  tool_args?: { max_chars: number | null };
  self_view?: { placement: 'system' | 'tail'; ledger_rows: number };
  prompt_layout?: { volatile_tail: 'self_view' | 'projection' | 'both' };
  select?: string;
};
/** Agent-facing context intent. The runtime maps these names to its internal sections and rules. */
export type Policy = {
  request?: { maxOutputTokens: number };
  modes: Record<string, Mode>; routes: Route[];
  methods: Record<string, string>;
  memory: { names: string[] | '*'; order: 'name' | 'newest'; write: 'replace' | 'append' };
  context: ContextPolicy;
  review: { trigger: string; evidence: string; tools: string[]; verification: { metric?: string; direction?: 'increase' | 'decrease'; segment?: 'last' | 'mean' } };
  memory_strategy: { retrieval: 'all' | 'recent'; recent_count: number; partition: 'component' | 'kind'; retention: 'all' | 'latest'; sources: string[] };
};
export type SelfContract = {
  source: 'user_contract'; authority: string; decisions: string; content_hash: string; readonly_reason: string;
  boundaries: string[]; capabilities: string[]; writable: string[];
  budget: { requests: number; tokens: number; seconds: number; usd: number; storage_bytes: number };
  acceptance: unknown; inherit_defaults: false; segment?: { work_requests: number }; review?: { max_requests_without_change: number };
};
export type HeartbeatContract = false | { enabled: true; every_settled_task_requests: 3 };
export function isValidHeartbeat(value: unknown): value is false | { enabled: true; every_settled_task_requests: number } {
  if (value === false) return true;
  if (!value || typeof value !== 'object') return false;
  const heartbeat = value as Record<string, unknown>;
  return heartbeat.enabled === true && heartbeat.every_settled_task_requests === 3
    && Object.keys(heartbeat).length === 2;
}
const CORE_PROBE_KINDS = ['preflight','inference','inference_probe','inference-preflight','provider-preflight'];
const PROCESS_FACT_TYPES = ['watch_stall','request_paused','exit_normalization','review_unresolved','reflection_noop'];
const CONSERVATIVE_RATES = { input: 20, output: 80 };
const REGISTERED_RATES = { input: 5, output: 30 };
const ESTIMATE_NEVER_INVOICE = 'estimate, never the invoice';
type Row = { ref: string; kind: 'fact' | 'claim'; type: string; revision: number; request: number; value: any };
export type Metric = { name: string; value: number; unit: string; scope?: string; observation?: any; observation_id?: string };
export type Window = { id: string; revision: number; parent: number; review: string | null; activation: string; baseline: string[]; baseline_segment: number | null;
  baseline_metrics: { last: Metric[]; mean: Metric[] }; scope: string[];
  due: { settlement: number; after_use: true; rule: string }; expected_effect?: string; success_predicate?: { metric: string; direction: 'increase' | 'decrease'; segment: 'last' | 'mean'; scope?: string }; predicate_source?: 'provisional' | 'agent'; effect_status: 'specified' | 'effect_unspecified';
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
export const FIXED_REVIEW_STRATEGY = 'At a self-evolution entrance the runtime delivers recorded operating facts (repeats, costs, losses, rejections, trajectory, outcome paths) beside the current definition of every writable and protected object. Judgment stays with the Agent: act on the facts, or close with decide_exit - a judged no-change is a valid closure. Changes activate at the next request boundary and their recorded effects return to the same view. The host presents facts without ranking, diagnosis, recommendation or forced order.';
/** Pre-M-A obligation framing; active only under mechanisms.legacy_obligation. */
export const LEGACY_REVIEW_STRATEGY = 'At every self-evolution entrance, inspect the complete factual space of every writable and protected object: current definition, participation and use, legal operations not yet observed, linked evidence, unknowns and costs. An existing, rendered, submitted or delivered artifact never ends the obligation to examine and evolve orchestration and component classes; rework of produced artifacts is a normal route. Distinguish exposure from actual use and follow same-root version receipts. Then the Agent chooses any change that can alter the next task action and uses the same-task result before deciding again. The host presents facts without ranking, diagnosis, recommendation or forced order.';
/** EVO_L4: the only legal values for a declared change layer; recorded and echoed, never inferred. */
export const EVOLUTION_LAYERS = ['prompt', 'context', 'loop', 'harness'];
/** EVO_ASK: entrance-only question block riding the review-strategy delivery; zero resident outside reviews.
 * Open phrasing only: no component names, no causal assertions, no exit gate beyond the response field. */
export const ENTRANCE_QUESTIONS = [
  'Is the root cause of the recorded outcomes at the capability layer (a component or orchestration structure to create or restructure) or at the parameter layer (a value to tune)?',
  'Given the recorded recurrence and inventory facts, is any recurring work not covered by an existing capability?',
  'Which capabilities exist but appear in no recorded outcome path, and why?',
];
export function entranceAskBlock(layer: boolean): string {
  return ['SELF-EVOLUTION ENTRANCE QUESTIONS: This harness is yours; evolution means creating or optimizing components and orchestration, not only adjusting parameters.',
    ...(layer ? [`Four layers exist as coordinates for locating a change - ${EVOLUTION_LAYERS.join(', ')} - and a recorded change may declare its evolution_layer.`] : []),
    ...ENTRANCE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
    'Close with decide_exit carrying result.entry_question_responses: exactly three strings, one per question; "none" is a valid response. "No gap" and "no change" are both valid closures.'].join('\n');
}
/** EVO_META (user decision 2026-11-16): the self-evolution loop is a fixed host mechanism, not something the agent
 * invents. The seven fixed fields live in demo/prompts/self_root_meta_fields.md (stable prefix); the dynamic half -
 * optimizable objects, the orchestration contract and the acceptance counters - is rendered by metaBoard() in the
 * self view. Every string here names mechanism, facts or boundaries only; task content reaches the agent through the
 * runner's task prompt and through its own orchestration contract. */
export const META_STRATEGY = 'This harness is yours: components, policy and orchestration are writable at every request; each write activates at the next request boundary and its receipt returns to the same self view. The self-evolution mechanism and the acceptance standard are host-given and are not redesigned here; the task side - task goal, task acceptance and this task\'s run plan - is yours and lives in your orchestration contract. The runtime books facts - repeats, costs, effects, inventory and recurrence - without ranking, diagnosis or recommendation, and opens no review of its own. Your orchestration decides when task segments run and when you look at the harness. Judgment stays with you.';
export function orchestrationSchema(current?: any) {
  const receiptCondition = { type: 'object', properties: { type: { type: 'string' }, currentArtifact: { type: 'boolean' }, freshness: { type: 'string', enum: ['current','any'] }, factPath: { type: 'string' }, equals: {} }, required: ['type'], additionalProperties: false };
  const output = { type: 'object', description: 'Supported JSON schema subset: object, array, string, integer, number, boolean, null, enum, properties, required, items.' };
  const binding = { type: 'object', properties: { kind: { type: 'string', enum: ['prompt','skill','tool','memory','context'] }, name: { type: 'string' }, version: { type: 'integer', minimum: 1 } }, required: ['kind','name'], additionalProperties: false };
  const contract = { type: 'object', description: `Task-side contract written at the T0 design turn and rendered in the self view: task_goal, task_acceptance, and loop_policy.look_when - each trigger on one task-side event (${TASK_EVENTS.join(' | ')}), never a counter or a clock.`,
    properties: { task_goal: { type: 'string' }, task_acceptance: { type: 'string' }, loop_policy: { type: 'object' } }, required: ['task_goal','task_acceptance','loop_policy'], additionalProperties: false };
  // A minimal real loop, not an empty shell: a transition turns when its receipt arrives, and the contract carries
  // the task side the host does not supply.
  const example = { revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [],
    contract: { task_goal: 'The task artifact this run must deliver', task_acceptance: 'How its delivery is judged and how you verify it',
      loop_policy: { look_when: [{ on: 'segment_boundary', look: 'what the last segment recorded, with which task facts' }] } },
    transitions: [{ id: 'again', from: 'work', on: { type: 'action', action: 'self.change' }, requires: [{ type: 'self.change' }], to: 'work' }] };
  const definition = current ?? example;
  return { type: 'object', properties: { revision: { type: 'integer' }, contract, roles: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }, slots: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['json','text'] }, initial: {}, writers: { type: 'array', items: { type: 'string' } } }, required: ['id','type'], additionalProperties: false } }, steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, role: { type: 'string' }, decision: { type: 'string' }, actions: { type: 'array', description: 'Permission scope for this step: tool names (read, write, edit, office.render, ...) this step may call. Omit to allow every tool; protocol tools are never scoped by it.', items: { type: 'string' } }, bindings: { type: 'array', items: binding } }, required: ['id','role'], additionalProperties: false } }, decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, judge: { type: 'string' }, question: { type: 'string' }, evidence: { type: 'array', items: receiptCondition }, output, writes: { type: 'object' } }, required: ['id','judge','question','evidence','output'], additionalProperties: false } }, transitions: { type: 'array', description: 'Each row: {id, from, on, requires, to}. on is {type:"action",action:"<an action receipt type this runtime records>"} or {type:"decision",id:"<decision id>"}; requires lists the receipts that must be cited for it to fire.', items: { type: 'object', properties: { id: { type: 'string' }, from: { type: 'string' }, on: { type: 'object' }, requires: { type: 'array', items: receiptCondition }, to: { type: 'string' } }, required: ['id','from','on','requires','to'], additionalProperties: false } } }, required: ['roles','slots','steps','decisions','transitions'], additionalProperties: false, current: definition, example };
}
export function operationContract(kind: OperationKind) {
  const reason = { type: 'string', description: 'Optional interpretation in your own words.' };
  if (kind === 'review') return { name: 'decide_exit', description: 'Finish the current review after the host-visible review work is complete.', properties: { reason }, required: [] as string[] };
  if (kind === 'validation') return { name: 'decide_validation', description: 'Read the due window; missing or provisional comparisons remain unresolved.', properties: { window: { type: 'string' } }, required: [] as string[] };
  if (kind === 'component') return { name: 'reflect_component', description: 'Change one component of this Agent.', properties: { op: { type: 'string', enum: ['define','redefine','restore'] }, kind: { type: 'string', enum: ['tool','prompt','skill','memory'] }, name: { type: 'string' }, source: { type: 'string' }, version: { type: 'integer', minimum: 1 }, write: { type: 'string', enum: ['replace','append','patch'], description: 'How source lands on the current value: replace (default), append, or patch.' }, patch: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find','replace'], additionalProperties: false }, description: 'Literal find/replace edits applied to the current source when write=patch.' }, evidence_refs: { type: 'array', items: { type: 'string' } }, success_predicate: { type: 'object' }, expected_effect: { type: 'string', description: 'Recorded effect you expect from this change; declaring one opens a validation window.' } }, required: ['op','kind','name'] };
  const context = { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' }, reasoning: { type: 'string', enum: ['all','latest','none'] }, history: { type: 'object' }, tool_results: { type: 'object' }, tool_args: { type: 'object' }, self_view: { type: 'object' }, prompt_layout: { type: 'object', properties: { volatile_tail: { type: 'string', enum: ['self_view','projection','both'] } }, additionalProperties: false } }, additionalProperties: false };
  const policy = { type: 'object', properties: { modes: { type: 'object' }, routes: { type: 'array' }, methods: { type: 'object' }, memory: { type: 'object' }, memory_strategy: { type: 'object' }, context, request: { type: 'object' }, review: { type: 'object' } }, additionalProperties: false };
  const orchestrationPatch = { type: 'object', properties: {
    roles: { type: 'array' }, slots: { type: 'array' }, steps: { type: 'array' }, decisions: { type: 'array' }, transitions: { type: 'array' },
    steps_by_id: { type: 'object', additionalProperties: { type: 'object' } },
  }, additionalProperties: false };
  return { name: 'reflect_orchestration', description: 'Apply a current orchestration patch or replacement, an atomic typed policy merge patch, component changes, or restore. A legal change is pinned before the next request.', properties: { orchestration: orchestrationSchema(), orchestration_patch: orchestrationPatch, policy, components: { type: 'array', items: { type: 'object' } }, restore: { type: 'integer', minimum: 1 }, restore_scope: { type: 'array', items: { type: 'string' }, description: 'Addresses the restore is intended to revert; the host reports every other address the restore would also change.' }, carry: { type: 'object' }, stepMap: { type: 'object' }, evidence_refs: { type: 'array', items: { type: 'string' } }, success_predicate: { type: 'object' }, expected_effect: { type: 'string', description: 'Recorded effect you expect from this change; declaring one opens a validation window.' } }, required: [] as string[] };
}

/** Provider-visible JSON schema generated from the one descriptor. The Agent's own mode exit schema
 * (part of its writable policy) is exposed as an optional result object when it declares more than reason. */
export function providerOperationSchema(kind: OperationKind, modeExitSchema?: any, currentOrchestration?: any, opts?: { layer?: boolean }) {
  const contract = operationContract(kind);
  const properties: any = structuredClone(contract.properties);
  if (kind === 'orchestration' && currentOrchestration) properties.orchestration = orchestrationSchema(currentOrchestration);
  if (opts?.layer && (kind === 'component' || kind === 'orchestration')) properties.evolution_layer = { type: 'string', enum: [...EVOLUTION_LAYERS], description: 'Optional declared layer of this change; recorded and echoed, never inferred. Absent means undeclared.' };
  const own = modeExitSchema?.properties ? Object.keys(modeExitSchema.properties).filter(k => k !== 'reason') : [];
  if (kind === 'review' && own.length) properties.result = structuredClone(modeExitSchema);
  return { type: 'object', properties, required: [...contract.required], additionalProperties: false };
}

/** Dispatch-side check against exactly the provider-visible schema plus the stated conditional semantics. */
export function normalizeOperation(kind: OperationKind, args: any, modeExitSchema?: any, opts?: { layer?: boolean }) {
  const schema = providerOperationSchema(kind, modeExitSchema, undefined, opts);
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
  if (kind === 'component' && a.op !== 'restore' && typeof a.source !== 'string' && !(a.write === 'patch' && Array.isArray(a.patch) && a.patch.length)) throw Error('reflect_component: define/redefine needs source (or write:patch with a patch array)');
  if (kind === 'component' && a.patch !== undefined && (!Array.isArray(a.patch) || a.patch.some((p: any) => !p || typeof p.find !== 'string' || typeof p.replace !== 'string'))) throw operationError('patch must be an array of {find, replace} string pairs', kind, a, { invalid: ['patch'] });
  if (kind === 'component' && a.op === 'restore' && a.version === undefined) throw Error('reflect_component: restore needs version');
  if (kind === 'orchestration' && !['policy', 'orchestration', 'orchestration_patch', 'components', 'restore'].some(k => a[k] !== undefined)) throw operationError('reflect_orchestration: include orchestration, orchestration_patch, policy, components or restore', kind, a);
  if (['component','orchestration'].includes(kind) && a.evidence_refs !== undefined && (!Array.isArray(a.evidence_refs) || a.evidence_refs.some((ref: any) => typeof ref !== 'string'))) throw operationError('evidence_refs must be an array of strings when supplied', kind, a, { invalid: ['evidence_refs'] });
  if (['component','orchestration'].includes(kind) && a.success_predicate !== undefined && (!a.success_predicate || typeof a.success_predicate.metric !== 'string' || !['increase','decrease'].includes(a.success_predicate.direction) || !['last','mean'].includes(a.success_predicate.segment))) throw operationError('success_predicate needs metric, direction (increase|decrease), and segment (last|mean)', kind, a, { invalid: ['success_predicate'] });
  const normalized = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
  return normalized;
}

function operationError(message: string, kind: OperationKind, input: any, surface: any = {}) {
  const error: any = new Error(message);
  error.surface = { operation: operationContract(kind).name, received: input, writable: surface.writable ?? {
    policy: { meaning: 'typed orchestration and context policy patch', current: 'read_self(section="policy")', accepts: 'named policy fields validated atomically' }, orchestration: { meaning: 'complete executable orchestration definition', current: 'read_self(section="definition")', accepts: 'roles, slots, steps, decisions and transitions' },
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
function mergeOrchestrationPatch(current: any, patch: any) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('orchestration_patch must be an object');
  const next = copy(current);
  for (const key of ['roles', 'slots', 'steps', 'decisions', 'transitions']) {
    if (patch[key] !== undefined) {
      if (!Array.isArray(patch[key])) throw Error(`orchestration_patch.${key} must be an array`);
      next[key] = patch[key];
    }
  }
  if (patch.steps_by_id) {
    if (!patch.steps_by_id || typeof patch.steps_by_id !== 'object' || Array.isArray(patch.steps_by_id)) throw Error('orchestration_patch.steps_by_id must be an object');
    next.steps = next.steps.map((step: any) => patch.steps_by_id[step.id] ? { ...step, ...patch.steps_by_id[step.id] } : step);
  }
  // The task-side contract is one object: a patch replaces it whole, like a definition field, never field-merges.
  if (patch.contract !== undefined) next.contract = patch.contract;
  return next;
}

/** Deterministic completion of mechanical orchestration intent. Omitted transition events and requires
 * are filled from the declared structure; a decision step with no decision-typed exit gets one to the
 * next step in array order. Semantic choices stay the agent's: ambiguity raises one concrete question
 * instead of a format rejection. A name that is not a receipt type this runtime records is never completed
 * into requires (that silently wrote the wrong word into a second field and produced a two-error rejection);
 * it asks back once, naming the legal events and the recordable set. Runs before validation; the validator
 * itself is untouched. */
export function compileOrchestrationIntent(def: any, knownActions?: ReadonlySet<string>): { definition: any; compiled: { transition?: string; step?: string; field: string; value: any }[] } {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { definition: def, compiled: [] };
  const d = copy(def);
  const compiled: { transition?: string; step?: string; field: string; value: any }[] = [];
  const steps: any[] = Array.isArray(d.steps) ? d.steps : [];
  const decisions: any[] = Array.isArray(d.decisions) ? d.decisions : [];
  const transitions: any[] = Array.isArray(d.transitions) ? d.transitions : [];
  const ask = (q: string) => { throw operationError(q, 'orchestration', def, { invalid: ['transitions'], correction: q }); };
  const recordable = knownActions?.size ? ` Action receipt types this runtime records: ${[...knownActions].sort().join(', ')}.` : '';
  const decisionOf = (stepId: any) => { const s = steps.find(x => x?.id === stepId); return s?.decision ? decisions.find(x => x?.id === s.decision) : undefined; };
  const actionsOf = (stepId: any) => { const a = steps.find(x => x?.id === stepId)?.actions; return Array.isArray(a) ? a : []; };
  for (const t of transitions) {
    if (!t || typeof t !== 'object') continue;
    const dec = decisionOf(t.from);
    const acts = actionsOf(t.from);
    const onKeys = t.on && typeof t.on === 'object' && !Array.isArray(t.on) ? Object.keys(t.on) : null;
    if (t.on === undefined || t.on === null || (onKeys && onKeys.length === 0)) {
      if (dec) t.on = { type: 'decision', id: dec.id };
      else if (acts.length === 1 && (!knownActions?.size || knownActions.has(acts[0]))) t.on = { type: 'action', action: acts[0] };
      else ask(`transition ${t.id ?? '?'} from step '${t.from}' has no 'on' event and the step declares ${acts.length ? `${acts.length} actions (${acts.join(', ')}; a tool-name permission scope, not receipt types)` : 'no decision and no action'}; which event fires it? Resend with on:{type:"action",action:"<a receipt type>"} or on:{type:"decision",id:"<decision>"}.${recordable}`);
      compiled.push({ transition: t.id, field: 'on', value: copy(t.on) });
    } else if (onKeys && onKeys.length === 1 && !('type' in t.on)) {
      const key = onKeys[0];
      const props = dec?.output?.properties ?? {};
      if (dec && key in props) { t.on = { type: 'decision', id: dec.id, path: `/${key}`, equals: t.on[key] }; compiled.push({ transition: t.id, field: 'on', value: copy(t.on) }); }
      else ask(`transition ${t.id ?? '?'} has on:{${JSON.stringify(key)}: ...}, and the legal events are on:{type:"action",action:"<a receipt type this runtime records>"}${acts.length ? ` (step '${t.from}' lists tools ${acts.join(', ')} in its permission scope; that scope says nothing about receipt types)` : ''} or on:{type:"decision",id:"<decision id>"}${dec ? `, whose output properties here are ${Object.keys(props).join(', ') || 'none'}` : ` (step '${t.from}' declares no decision)`}.${recordable}`);
    }
    if (!Array.isArray(t.requires) || t.requires.length === 0) {
      const onType = t.on?.type;
      if (onType === 'decision') { const dd = decisions.find(x => x?.id === t.on.id); t.requires = copy(dd?.evidence ?? []); compiled.push({ transition: t.id, field: 'requires', value: copy(t.requires) }); }
      else if (onType === 'action' && typeof t.on.action === 'string') {
        if (knownActions?.size && !knownActions.has(t.on.action))
          ask(`transition ${t.id ?? '?'} names action '${t.on.action}' in on.action, and this runtime records no such receipt type, so the transition could never fire; requires was left as you wrote it instead of being filled with that name. Resend with on:{type:"action",action:"<one of those>"} and requires:[{type:"<the same>"}].${recordable}`);
        t.requires = [{ type: t.on.action }]; compiled.push({ transition: t.id, field: 'requires', value: copy(t.requires) });
      }
      else if (!Array.isArray(t.requires)) t.requires = [];
    }
  }
  const ids = new Set(transitions.map((t: any) => t?.id));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s?.decision) continue;
    if (transitions.some((t: any) => t?.from === s.id && t?.on?.type === 'decision')) continue;
    const next = steps[i + 1];
    if (!next) ask(`decision step '${s.id}' is last in step order and has no decision-typed transition out; add a transition naming its target step.`);
    const dec = decisions.find(x => x?.id === s.decision);
    let id = `t_${s.id}_${next.id}`;
    for (let n = 2; ids.has(id); n++) id = `t_${s.id}_${next.id}_${n}`;
    ids.add(id);
    const t = { id, from: s.id, on: { type: 'decision', id: s.decision }, requires: copy(dec?.evidence ?? []), to: next.id };
    transitions.push(t);
    compiled.push({ step: s.id, transition: id, field: 'synthesized', value: copy(t) });
  }
  d.transitions = transitions;
  return { definition: d, compiled };
}

const CONTEXT_ORDER_ALIASES: Record<string, string> = {
  content: 'prompts', instructions: 'prompts', prompt: 'prompts', prompts: 'prompts',
  memory: 'memory', memories: 'memory', learned: 'memory', skills: 'skills', methods: 'skills',
};
/** Legacy input normalization kept private; the provider surface exposes policy.context directly. */
function normalizeLegacyContextPolicy(input: any): { context: Partial<ContextPolicy> } {
  const result: any = {};
  if (input.contentOrder !== undefined) {
    if (!Array.isArray(input.contentOrder)) throw operationError('contentOrder must be a list of content categories', 'orchestration', input, { invalid: ['contentOrder'], correction: 'Use policy.context.order.' });
    const order = input.contentOrder.map(value => CONTEXT_ORDER_ALIASES[String(value).toLowerCase()]);
    const invalid = input.contentOrder.filter((_, i) => !order[i]);
    if (invalid.length || new Set(order).size !== order.length) throw operationError('contentOrder contains an unsupported or repeated category', 'orchestration', input, { invalid, correction: 'Use each content category once.' });
    result.order = order;
  }
  if (input.history) result.history = { recent_turns: input.history.recentTurns, older: input.history.older };
  if (input.toolResults) result.tool_results = { max_chars: input.toolResults.maxChars, images: input.toolResults.images };
  if (input.toolArgs) result.tool_args = { max_chars: input.toolArgs.maxChars };
  if (input.selfView) result.self_view = { placement: input.selfView.placement, ledger_rows: input.selfView.ledgerRows };
  if (input.promptLayout) result.prompt_layout = { volatile_tail: input.promptLayout.volatileTail === 'self' ? 'self_view' : input.promptLayout.volatileTail };
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
  source?: string; chars: number; image_bytes?: number; images: number; turn_age: number; latest_assistant?: boolean; pair?: string; segment?: number };
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
    omitted_items: removed.map(i => ({ ref: i.ref, kind: i.kind ?? 'text', source: i.source ?? i.section, chars: i.chars, images: i.images, action: act(i) })) };
}

export function seedPolicy(capabilities: string[], reviewTools: string[] = ['read', 'ls', 'grep']): Policy {
  const exitSchema = { type: 'object', properties: { reason: { type: 'string' } }, required: [] };
  const observe = reviewTools.filter(t => capabilities.includes(t));
  return { request: { maxOutputTokens: 32768 }, modes: {
    execute: { tools: capabilities, instruction: 'Continue the current task.', exitSchema },
    reflect: { tools: observe, instruction: 'Review the pinned self/evidence and choose your scope, method and changes. Finish with decide_exit when it is available.', exitSchema },
    consolidate: { tools: observe, instruction: 'Organize this task\'s evidence and bounded inheritance records if useful; no automatic cross-task defaults.', exitSchema },
  }, routes: [], methods: {}, memory: { names: '*', order: 'name', write: 'replace' },
    review: { trigger: 'booked_quality_or_process_facts', evidence: 'all_booked_facts', tools: [...observe], verification: {} },
    memory_strategy: { retrieval: 'all', recent_count: 12, partition: 'component', retention: 'latest', sources: ['agent'] },
    context: { order: ['prompts', 'memory', 'skills'], instruction: '', reasoning: 'latest', tool_results: { max_chars: 16000, images: 'latest' }, history: { recent_turns: 16, older: 'stub' }, self_view: { placement: 'tail', ledger_rows: 12 }, prompt_layout: { volatile_tail: 'both' } } };
}

export function validateContract(c: SelfContract) {
  if (!c || c.source !== 'user_contract' || !c.authority || !c.decisions || !c.readonly_reason) throw Error('explicit user contract not loaded');
  const { content_hash, ...body } = c;
  if (content_hash !== hash(body)) throw Error('user contract hash mismatch');
  if (hash([...c.boundaries].sort()) !== hash([...FLOOR].sort()) || c.inherit_defaults !== false || (c.segment !== undefined && (!Number.isSafeInteger(c.segment.work_requests) || c.segment.work_requests < 1)) || (c.heartbeat !== undefined && !isValidHeartbeat(c.heartbeat))) throw Error('v1 contract floor/segment/heartbeat/inheritance mismatch');
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
  if (!p.review || p.review.trigger !== 'booked_quality_or_process_facts' || !['all_booked_facts','current_segment'].includes(p.review.evidence) || !Array.isArray(p.review.tools) || p.review.tools.some(t => typeof t !== 'string') || !p.review.verification || (p.review.verification.metric !== undefined && typeof p.review.verification.metric !== 'string') || (p.review.verification.direction !== undefined && !['increase','decrease'].includes(p.review.verification.direction)) || (p.review.verification.segment !== undefined && !['last','mean'].includes(p.review.verification.segment))) throw Error('review policy needs trigger booked_quality_or_process_facts, evidence (all_booked_facts|current_segment), tools[], and optional verification {metric, direction: increase|decrease, segment: last|mean}');
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
  if (c.self_view !== undefined && (!c.self_view || !['system', 'tail'].includes(c.self_view.placement) || !Number.isSafeInteger(c.self_view.ledger_rows) || c.self_view.ledger_rows < 0 || c.self_view.ledger_rows > 40))
    throw Error('context.self_view needs placement (system|tail) and ledger_rows (0..40)');
  if (c.prompt_layout !== undefined && (!c.prompt_layout || !['self_view','projection','both'].includes(c.prompt_layout.volatile_tail))) throw Error('context.prompt_layout needs volatile_tail (self_view|projection|both)');
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
  private pending?: { candidate: LiveAgentSelf; policy: Policy; revision: number; addresses: string[]; windows: any[]; source?: number; baseStateHash: string; declaredLayers?: Record<string, string> };
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
  private heartbeatDue: number[] = [];
  private reviewRequests = 0;
  private reviewedQualityRefs = new Set<string>();
  private reviewObjectState: any = null;
  private pendingDelivery?: { run: () => Promise<any> };
  private pendingDeliveryName?: string;
  private budgetDelivery?: Promise<unknown>;
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
    if (options.actionReceiptTypes?.length) this.declareActionTypes(options.actionReceiptTypes);
    // EVO_META (2026-11-16): this runtime records one `self.change` receipt per activation after the T0 design.
    // Declared as a receipt type so a loop bound to it validates at reflect time instead of binding silently,
    // exactly like the adapter-declared task receipts.
    if (this.mech.meta) this.declareActionTypes([...(this.knownActionTypes ?? []), 'self.change']);
    validateContract(contract); this.contract = copy(contract);
    this.root_id = saved?.root?.root_id ?? randomUUID();
    this.policy = copy(saved?.root?.policy ?? seedPolicy(contract.capabilities, options.reviewTools)); validatePolicy(this.policy, contract, this.outputLimit);
    if (saved?.root) {
      const r = saved.root;
      for (const key of ['serial','request','ledger','lineage','definitions','windows','queue','currentMode','review','started','units','tokens','usd','paused','previousMode','activeReset','workRequests','heartbeatDue','reviewRequests','conditionSet','settlementCount','lastSettlementReview','taskEnded','taskEndPending','unresolvedReview','segmentStart','segmentRefs','contextByRequest'] as const) if (r[key] !== undefined) (this as any)[key] = copy(r[key]);
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
  get reviewExitSchema() {
    if (!this.review) return undefined;
    const schema = copy(this.review.modeDefinition.exitSchema);
    // EVO_ASK closure protocol: the entrance questions close through one array field on the agent's own exit schema.
    if (this.mech.ask && this.inEvolutionReview) {
      schema.properties = { ...(schema.properties ?? {}), entry_question_responses: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'One response per entrance question, in order; "none" is a valid response.' } };
      schema.required = [...new Set([...(schema.required ?? []), 'entry_question_responses'])];
    }
    return schema;
  }
  /** The provider-visible exit operation for the current review, from the one descriptor. */
  get exitOperationKind(): 'review' | undefined { return this.review ? 'review' : undefined; }
  private reviewChanged() { return Boolean(this.review?.changes?.length || this.pending?.review === this.review?.id || this.pendingReview === this.review?.id); }
  get exitOperationSchema() { const kind = this.exitOperationKind; return kind ? providerOperationSchema(kind, this.reviewExitSchema) : undefined; }
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
    if (section === 'observation') return this.observation();
    if (section === 'continuity') return { current: super.snapshot(), review: copy(this.review ?? null), requestPin: copy(this.requestPin ?? null) };
    if (section === 'conditions') return { settlement_count: this.settlementCount, conditions: copy(this.conditionSet), published_steps: copy(FLOOR_STEPS) };
    if (section === 'segments') return { rows: this.segmentRefs.slice(offset, offset + count).map(ref => ({ ref, ...copy(this.ledger.find(r => r.ref === ref)!.value) })), total: this.segmentRefs.length };
    if (section === 'requests') { const rows = this.ledger.filter(r => r.type === 'request_record'); return { rows: copy(rows.slice(offset, offset + Math.min(count, 10))), total: rows.length }; }
    if (section === 'context_item') throw Error('context_item needs ref: read_self(section="context_item", ref)');
    if (section === 'ledger' && (offset as any) === undefined) return this.read(0, count);
    throw Error('unknown self section');
  }
  /** Effective mechanism switches; the adapter may turn individual mechanisms off for ablation runs. */
  get mech(): Required<SelfRootMechanisms> {
    const m: Required<SelfRootMechanisms> = { observation: true, compiler: true, effect_return: true, legacy_obligation: false, a4: false, ask: false, l4: false, meta: false, ...(this.options.mechanisms ?? {}) };
    // META is mutually exclusive with the mechanisms it replaces: no questionnaire, no layer declarations, no obligation framing.
    if (m.meta) { m.ask = false; m.l4 = false; m.legacy_obligation = false; }
    return m;
  }
  /** The one fixed strategy line shown with the self view; evidence framing unless legacy obligation is on.
   * entrance=true appends the EVO_ASK question block at evolution-review entrances only (zero resident elsewhere). */
  reviewStrategy(entrance = false): string {
    if (this.mech.meta) return META_STRATEGY;
    const base = this.mech.legacy_obligation ? LEGACY_REVIEW_STRATEGY : FIXED_REVIEW_STRATEGY;
    return entrance && this.mech.ask && this.inEvolutionReview ? `${base}\n${entranceAskBlock(this.mech.l4)}` : base;
  }
  /** EVO_META T0: the gate is open until the agent has written its orchestration contract (the design turn). */
  get metaT0Pending() { return this.mech.meta && !this.ledger.some(r => r.type === 'meta_t0_design'); }
  /** The task-side contract in force: the live orchestration's own, else the one recorded at the design turn. */
  metaContract(): OrchestrationContract | null {
    const row = this.ledger.find(r => r.type === 'meta_t0_design');
    return ((this.current?.orchestration as any)?.contract ?? row?.value?.contract ?? null) as OrchestrationContract | null;
  }
  /** Mechanical acceptance bookkeeping (user decision 2026-11-16). changes: agent-initiated structural activations
   * after the first task segment started. activated: a later provider request ran after the write. used_later: the
   * changed object is visible in later task execution - a tool that ran, a text kind carried by the recorded live
   * context injection, or an orchestration/policy applied to a later request. Existing receipts only; no new one. */
  metaAcceptance() {
    const start = this.ledger.findIndex(r => r.type === 'meta_t0_design');
    if (start < 0) return { changes: 0, activated: 0, used_later: 0, last: null as { ref: string; revision: number | null; addresses: string[]; activated: boolean; used_later: boolean } | null };
    const rows = this.ledger.slice(start + 1);
    let changes = 0, activated = 0, usedLater = 0;
    let last: { ref: string; revision: number | null; addresses: string[]; activated: boolean; used_later: boolean } | null = null;
    rows.forEach((row, i) => {
      // Each write books an intent row at reflect time and, at the boundary, an activation row carrying `parent`.
      // The change is the intent row; counting the activation too would count one change twice, and the design's own
      // activation - which lands after the design row - is the design, not a later change.
      if (row.type !== 'reflection_activated' || row.value?.parent !== undefined) return;
      changes++;
      const after = rows.slice(i + 1);
      const isActivated = after.some(r => r.type === 'provider_input');
      const isUsed = this.changeUsed(row.value?.addresses ?? [], after);
      if (isActivated) activated++;
      if (isUsed) usedLater++;
      last = { ref: row.ref, revision: row.value?.revision ?? null, addresses: row.value?.addresses ?? [], activated: isActivated, used_later: isUsed };
    });
    return { changes, activated, used_later: usedLater, last };
  }
  private changeUsed(addresses: string[], after: any[]) {
    return addresses.some(address => {
      const component = /^components\.(tool|prompt|skill|memory)\.(.+)$/.exec(address);
      // Orchestration and policy are applied to every later request; that application is their use.
      if (!component) return after.some(r => r.type === 'provider_input');
      const [, kind, name] = component;
      if (kind === 'tool') return after.some(r => r.type === 'event' && r.value?.type === 'tool_succeeded' && r.value?.facts?.tool === name);
      return after.some(r => r.type === 'provider_input' && (r.value?.component_addresses ?? []).includes(`${kind}.${name}`));
    });
  }
  private metaPhase(): 'design' | 'task' | 'boundary' | 'settled' {
    if (this.metaT0Pending) return 'design';
    if (this.ledger.some(r => r.type === 'meta_harness_inventory')) return 'settled';
    const index = (type: string) => { for (let i = this.ledger.length - 1; i >= 0; i--) if (this.ledger[i].type === type) return i; return -1; };
    return index('segment_summary') > index('request_record') ? 'boundary' : 'task';
  }
  /** EVO_META board: the dynamic half of the seven fixed fields. Fields 1-3 and 7 are the fixed prompt file; this
   * block renders field 4 from live objects, fields 5-6 from the orchestration contract, the acceptance counters and
   * the phase block. Flow adaptation: full at the design turn, one mechanism line during a task segment, expanded at
   * a segment boundary, settled once at session end. Facts only; no ranking, diagnosis or advice. */
  metaBoard() {
    if (!this.mech.meta) return '';
    const phase = this.metaPhase();
    if (phase === 'design' && !this.ledger.some(r => r.type === 'meta_t0_delivered'))
      this.fact('meta_t0_delivered', { request: this.request, material: 'seven fixed fields; task side filled by orchestration.contract', gate: 'contract before the first task segment' });
    const contract = this.metaContract();
    const acc = this.metaAcceptance();
    const orchestration: any = this.current?.orchestration ?? {};
    const components = this.active();
    const named = (kind: string) => components.filter(c => c.kind === kind).map(c => `${c.name}@v${c.version}`).join(', ') || 'none';
    const step = (orchestration.steps ?? []).find((s: any) => s.id === this.step);
    const recordable = this.knownActionTypes?.size ? [...this.knownActionTypes].sort().join(', ') : '';
    const objects = [
      'OPTIMIZABLE OBJECTS',
      `prompt - ${named('prompt')}; change with reflect_component(kind:"prompt"); read_self(section="self")`,
      `context - policy.context (order: ${(this.policy.context?.order ?? []).join(', ')}; self view: ${this.policy.context?.prompt_layout?.volatile_tail ? 'tail' : 'system'}); change with reflect_orchestration({policy:{context}}); read_self(section="policy")`,
      `loop - orchestration revision ${this.current?.revision ?? 1}, active step '${this.step}'${step?.actions ? ` (action scope: ${step.actions.join(', ')})` : ''}; a transition fires on on:{type:"action",action:"<${recordable || 'a recorded receipt type'}>"} or on:{type:"decision",id:"<decision>"}; change with reflect_orchestration({orchestration}); read_self(section="definition")`,
      `harness - ${components.length} components at self revision ${this.revision} (${named('tool')} tools; ${named('skill')} skills; ${named('memory')} memory); any write above; read_self(section="self")`,
    ];
    const summary = this.ledger.filter(r => r.type === 'segment_summary').map(r => r.value);
    const numbers = (v: any) => v ? `requests ${v.process?.requests ?? 0}, task actions ${v.work?.task_actions ?? 0}, tool errors ${v.process?.tool_errors ?? 0}, elapsed ${Math.round(Number(v.process?.latency_s ?? 0))}s, phase ${v.phase ?? 'unknown'}` : 'none';
    // The run plan's look triggers are the agent's own task-side text for this event; the boundary is where they apply.
    const look = (contract?.loop_policy?.look_when ?? []).filter((w: any) => w?.on === 'segment_boundary').map((w: any) => String(w.look));
    const flow = phase === 'design'
      ? `DESIGN TURN - the mechanism and the acceptance standard above are given; this turn does not design an evolution loop. Fill TASK GOAL and TASK ACCEPTANCE and write this task's run plan in one reflect_orchestration: orchestration.contract = ${ORCHESTRATION_CONTRACT_FORM.slice('contract:'.length)}. Each look trigger binds one task-side event: ${TASK_EVENTS.join(', ')}; a counter or a clock alone is not a task event. The gate opens at that write.${recordable ? ` Action receipt types this runtime records: ${recordable}. A step's actions list is a permission scope over tool names, not over receipt types.` : ''}`
      : phase === 'boundary'
        ? [`SEGMENT BOUNDARY. Last change: ${acc.last ? `${acc.last.addresses.join(', ')} at revision ${acc.last.revision} - activated ${acc.last.activated ? 'yes' : 'no'}, used_later ${acc.last.used_later ? 'yes' : 'no'}` : 'none'}.`,
          `Last segment: ${numbers(summary.at(-1))}. Previous segment: ${numbers(summary.at(-2))}.`,
          ...(look.length ? [`Your run plan for this event (segment_boundary): ${look.join(' | ')}`] : []),
          'Facts only; judgment stays with you.'].join('\n')
        : phase === 'settled'
          ? `SESSION CLOSED - acceptance settled once: changes ${acc.changes} / activated ${acc.activated} / used_later ${acc.used_later}.`
          : `MECHANISM: every write activates at the next request boundary and its receipt returns here; this block expands at the next task-segment boundary.`;
    return [
      `TASK GOAL: ${contract?.task_goal ?? '(empty - this design turn fills it)'}`,
      `TASK ACCEPTANCE: ${contract?.task_acceptance ?? '(empty - this design turn fills it)'}`,
      ...objects,
      `SELF-EVOLUTION: changes ${acc.changes} / activated ${acc.activated} / used_later ${acc.used_later}.`,
      flow,
    ].join('\n');
  }
  /** Three-altitude recorded operating facts over this ledger - the dynamic facet of the one self view. */
  observation(): Observation {
    const decisions = ((this.current?.orchestration?.decisions ?? []) as any[]).map(d => `decide:${d.id}`);
    const capabilities = [...new Set([...(this.lastSurface.length ? this.lastSurface : this.surface()), ...decisions])];
    const components = this.active().map(c => ({ kind: c.kind, name: c.name, chars: typeof c.source === 'string' ? c.source.length : undefined }));
    return observe({ ledger: this.ledger, capabilities, components,
      ...(this.mech.a4 ? { a4: true, orchestration: { steps: ((this.current?.orchestration?.steps ?? []) as any[]).map((s: any) => String(s.id)) }, bindings: this.consumptionBindings() } : {}) });
  }
  /** EVO_A4: recorded consumption-binding fact per kind - how that kind's text or callable reaches a request,
   * and its resident chars per request under the active context policy. Facts only; judgment stays with the agent. */
  private consumptionBindings(): Record<string, { binding: string; rent_chars: number }> {
    const active = this.active();
    const len = (c: any) => (typeof c.body === 'string' ? c.body : typeof c.source === 'string' ? c.source : '').length;
    return {
      prompt: { binding: 'full text into the context head each request', rent_chars: active.filter(c => c.kind === 'prompt').reduce((n, c) => n + len(c), 0) },
      memory: { binding: 'policy-filtered full text into the context head', rent_chars: this.memory().reduce((n, c: any) => n + `${c.name}@${c.version}\n`.length + len(c), 0) },
      skill: { binding: 'index line in the head; body on read_self_component', rent_chars: active.filter(c => c.kind === 'skill').reduce((n, c: any) => n + `${c.name}@${c.version}: ${c.description ?? ''}; read_self_component`.length, 0) },
      tool: { binding: 'registered callable; schema in the tools block', rent_chars: 0 },
      subagent: { binding: 'write rejected: v1 has one agent', rent_chars: 0 },
    };
  }
  observationText(budget = 2800) { return renderObservation(this.observation(), budget); }
  observationDigest() { return observationHeads(this.observation()); }
  /** META self-state push: facts about the agent's own harness since it last changed - the optimizable objects
   * themselves, so the tail changes when the self changes. Facts only, no interpretation. `anchor` selects the row
   * the "since" half counts from: the T0/activation row for the pushed view, and the previous activation when the
   * runtime books the same facts as a self.change receipt. */
  selfChangeDigest(anchor?: any) {
    const changes = this.ledger.filter(r => r.type === 'reflection_activated' || r.type === 'meta_t0_design');
    const last = anchor ?? changes.at(-1);
    const refused = new Map<string, { tool: string; count: number; last_error: string }>();
    for (const r of this.ledger.slice(last ? this.ledger.indexOf(last) + 1 : 0)) {
      if (r.type !== 'tool_failed') continue;
      const tool = String(r.value?.tool ?? '');
      const raw = r.value?.error ?? r.value?.content ?? '';
      const message = Array.isArray(raw) ? raw.map((c: any) => String(c?.text ?? '')).join(' ') : String(raw);
      // Every operation the agent's own orchestration refused, not only reflection. A step's `actions` list is
      // agent-written content, so a task tool refused by it is self-inflicted cost the agent must be able to see while
      // paying it (M3 run 2026-11-16: 29 of the 39 "not allowed by active step" refusals were read/read_self/ls/
      // python/write/decide, none of which this digest reported; only the 10 reflection refusals were counted).
      if (!/not allowed by active step/.test(message) && !['reflect_component', 'reflect_orchestration'].includes(tool)) continue;
      const entry = refused.get(tool) ?? { tool, count: 0, last_error: '' };
      refused.set(tool, { ...entry, count: entry.count + 1, last_error: message.slice(0, 400) });
    }
    // The addressable half: the receipt this view was booked as, so a decision can cite it by ref. Null before the
    // first activation after the T0 design, when no receipt exists yet.
    const booked = [...this.ledger].reverse().find(r => r.type === 'reflection_activated' && r.value?.self_change);
    return {
      self_changes: changes.length,
      last_change: last ? { type: last.type, revision: last.value?.revision ?? last.revision, request: last.request,
        addresses: last.value?.addresses ?? null, expected_effect: last.value?.expected_effect ?? null,
        success_predicates: last.value?.success_predicates ?? null } : null,
      last_self_change: booked ? { ref: booked.value.self_change.ref, revision: booked.value.revision,
        transition: booked.value.self_change.transition ?? null } : null,
      requests_since_change: last ? this.request - Number(last.request ?? 0) : this.request,
      refused_self_operations: [...refused.values()],
      validation_windows: this.windows.map(w => ({ id: w.id, scope: w.scope, expected_effect: w.expected_effect ?? null,
        effect_status: w.effect_status, status: w.status, due_settlement: w.due?.settlement ?? null, later_use_refs: w.later_use_refs.length })),
    };
  }
  private pinView() {
    return this.review ? this.reviewSelfView() : { ...this.mirror(), writable: this.contract.writable, operations: PROTOCOL };
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
  transaction(input: { baseRevision?: number; components?: any[]; orchestration?: any; orchestration_patch?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; restore_scope?: string[]; expected_effect?: string; evidence_refs?: string[]; success_predicate?: any; evolution_layer?: string }) {
    const result = this.mutations.then(() => this.prepareTransaction(input));
    this.mutations = result.then(() => undefined, () => undefined);
    // EVO_META T0 gate: the first orchestration write - whatever it produced, a seed-equivalent rewrite included - is the
    // agent's design, and it opens the gate. Booked here so every adapter path (tool dispatch, restore) records it once.
    if (input.orchestration === undefined && input.orchestration_patch === undefined && input.restore === undefined) return result;
    return result.then(value => { this.noteMetaDesign(value); return value; });
  }
  /** EVO_META T0: the gate's only state is this ledger row; a failed write never opens it, and neither does a write
   * that changed nothing or one that carries no contract (a restore, or an orchestration without the task side). */
  private noteMetaDesign(result: any) {
    if (!this.mech.meta || this.ledger.some(r => r.type === 'meta_t0_design')) return;
    if (result?.status === 'no_change') return;
    const contract = (this.pending as any)?.candidate?.current?.orchestration?.contract ?? null;
    if (!contract) return;
    this.fact('meta_t0_design', { revision: this.pending?.revision ?? this.serial, status: result?.status ?? 'changed', addresses: result?.addresses ?? null, gate: 'open', contract });
  }
  abortTransaction(error: unknown, tool?: string) {
    this.pending = undefined; this.pendingReview = undefined;
    // A rejected self-operation is the signal the agent named as missing. M3 (2026-11-16): seven refused read/reflect
    // calls were answered with a same-turn correction and recorded nothing, so the self-state digest's
    // refused_self_operations stayed empty while the agent was in fact being refused. Record the same tool_failed
    // shape the other failure paths write, so one reader covers both.
    if (tool) this.fact('tool_failed', { tool, error: String(error) });
    if (!this.chainFailed) this.fact('transaction_failed',{error:String(error),status:'entire response chain aborted'});
    this.chainFailed = true;
  }
  private async prepareTransaction(input: { baseRevision?: number; components?: any[]; orchestration?: any; orchestration_patch?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; restore_scope?: string[]; expected_effect?: string; evidence_refs?: string[]; success_predicate?: any; evolution_layer?: string }) {
    try {
      if (this.chainFailed) throw Error('transaction chain already failed');
      if (input.baseRevision !== undefined && input.baseRevision !== this.pendingRevision) throw Error(`stale revision; expected ${this.pendingRevision}`);
      // EVO_L4: optional declared layer per changed address; recorded and echoed, never inferred.
      const declaredLayers: Record<string, string> = {};
      const declareLayer = (address: string, layer: any) => {
        if (layer === undefined || !this.mech.l4) return;
        if (!EVOLUTION_LAYERS.includes(layer)) throw Error(`evolution_layer must be one of ${EVOLUTION_LAYERS.join(', ')}`);
        declaredLayers[address] = layer;
      };
      const origin = this.pending?.candidate ?? this;
      const base = origin === this ? this.baseSaved() : { snapshot: origin.snapshot(), history: origin.history() };
      let candidate = new LiveAgentSelf(base, this.rootValidator);
      if (this.knownActionTypes) candidate.declareActionTypes(this.knownActionTypes);
      let policy = copy(this.pending?.policy ?? this.policy);
      const addresses: string[] = [];
      const compiledEntries: { transition?: string; step?: string; field: string; value: any }[] = [];
      const skippedUnchanged: string[] = [];
      let restoreScope: Set<string> | null = null;
      const restoreNotRestored: string[] = [];
      if (input.restore !== undefined) {
        const old = this.definitions.find(d => d.revision === input.restore);
        if (!old) throw Error('unknown same-root snapshot');
        restoreScope = this.mech.compiler && Array.isArray(input.restore_scope) && input.restore_scope.length ? new Set(input.restore_scope.map(String)) : null;
        const curPolicy = copy(this.pending?.policy ?? this.policy);
        // Intent-scoped restore: only the named addresses revert; everything else stays current.
        const restoreOrch = !restoreScope || restoreScope.has(componentAddress('orchestration', ''));
        const scopedPolicyKeys = Object.keys(old.policy).filter(k => !restoreScope || restoreScope.has(componentAddress('policy', k)));
        // Definitions only. Current receipts, resources and slot continuity stay current.
        input = { ...input, policy: restoreScope ? (scopedPolicyKeys.length ? { ...curPolicy, ...Object.fromEntries(scopedPolicyKeys.map(k => [k, (old.policy as any)[k]])) } : undefined) : old.policy,
          orchestration: restoreOrch ? old.base.snapshot.orchestration : undefined,
          components: old.base.snapshot.components.filter((c: any) => c.kind !== 'memory' && (!restoreScope || restoreScope.has(componentAddress(c.kind, c.name)))).map((c: any) => ({ kind: c.kind, name: c.name, source: c.source, op: candidate.allComponents().some(x => x.path === c.path) ? 'redefine' : 'define' })) };
        const wanted = new Set(old.base.snapshot.components.map((c: any) => c.path));
        // Restore a method, never roll learned memory back to an older text.
        for (const c of candidate.allComponents()) if (c.kind === 'memory') wanted.add(c.path);
        // A component outside the named scope stays current even when absent from the restored definition.
        if (restoreScope) for (const c of candidate.allComponents()) if (!restoreScope.has(componentAddress(c.kind, c.name))) wanted.add(c.path);
          for (const c of candidate.allComponents()) if (!wanted.has(c.path)) { this.assertWrite(`components.${c.kind}`); addresses.push(componentAddress(c.kind, c.name)); }
        // Address-diff pushback: record what differs from the restored definition but stayed current because it was out of scope.
        if (restoreScope) {
          const curComps = new Map(candidate.allComponents().filter((c: any) => c.kind !== 'memory').map((c: any) => [componentAddress(c.kind, c.name), c.source]));
          const oldComps = new Map(old.base.snapshot.components.filter((c: any) => c.kind !== 'memory').map((c: any) => [componentAddress(c.kind, c.name), c.source]));
          for (const addr of new Set([...curComps.keys(), ...oldComps.keys()])) if (curComps.get(addr) !== oldComps.get(addr) && !restoreScope.has(addr)) restoreNotRestored.push(addr);
          for (const k of new Set([...Object.keys(curPolicy), ...Object.keys(old.policy)])) if (!restoreScope.has(componentAddress('policy', k)) && hash((curPolicy as any)[k] ?? null) !== hash((old.policy as any)[k] ?? null)) restoreNotRestored.push(componentAddress('policy', k));
          if (!restoreOrch && hash(candidate.current.orchestration ?? null) !== hash(old.base.snapshot.orchestration ?? null)) restoreNotRestored.push(componentAddress('orchestration', ''));
        }
        const saved = { snapshot: candidate.snapshot(), history: candidate.history() };
        saved.snapshot.components = saved.snapshot.components.filter(c => wanted.has(c.path));
        candidate = new LiveAgentSelf(saved,this.rootValidator);
        if (this.knownActionTypes) candidate.declareActionTypes(this.knownActionTypes);
      }
      for (const c of input.components ?? []) {
        this.assertWrite(`components.${c.kind}`);
        if (c.kind === 'subagent') throw Error('v1 has one agent; task subagents are not authorized');
        if (c.kind === 'tool' && (PROTOCOL.includes(c.name) || this.contract.capabilities.includes(c.name) || (this.options.reservedToolNames ?? []).includes(c.name))) throw Error('tool name collides with protected protocol or host capability');
        const value = { ...c, source: c.source, baseRevision: candidate.revision };
        delete (value as any).evolution_layer;
        const currentSource = () => candidate.active().find(x => x.kind === c.kind && x.name === c.name)?.source;
        if (this.mech.compiler && c.op === 'redefine' && c.write === 'append') value.source = `${currentSource() ?? ''}\n${c.source ?? ''}`;
        else if (this.mech.compiler && c.op === 'redefine' && c.write === 'patch') {
          let src = currentSource();
          if (typeof src !== 'string') throw operationError(`patch needs an existing ${c.kind} ${c.name}`, 'component', c, { invalid: ['write'], correction: `Component ${c.kind}/${c.name} has no current source; use op:define with full source instead of write:patch.` });
          for (const p of c.patch ?? []) {
            if (!p || typeof p.find !== 'string' || !src.includes(p.find)) throw operationError('patch find text is not present in the current source', 'component', c, { invalid: ['patch'], correction: `The find text ${JSON.stringify(String(p?.find ?? '')).slice(0, 80)} is not in ${c.kind}/${c.name}; read_self_component("${c.kind}","${c.name}") and resend the exact current text.` });
            src = src.split(p.find).join(p.replace ?? '');
          }
          value.source = src;
        }
        else if (c.kind === 'memory' && c.op === 'redefine' && c.write === undefined && policy.memory.write === 'append') value.source = `${currentSource() ?? ''}\n${c.source}`;
        // Hash gate: a source identical to the current version does not bump the version or open a window.
        if (this.mech.compiler && c.op === 'redefine' && currentSource() === value.source) { skippedUnchanged.push(componentAddress(c.kind, c.name)); continue; }
        declareLayer(componentAddress(c.kind, c.name), c.evolution_layer);
        await candidate.reflectComponent(value); addresses.push(componentAddress(c.kind, c.name));
      }
      if (input.orchestration !== undefined || input.orchestration_patch !== undefined || (input.restore !== undefined && (!restoreScope || restoreScope.has(componentAddress('orchestration', ''))))) {
        this.assertWrite('orchestration');
        if (input.restore !== undefined && input.orchestration === undefined && input.orchestration_patch === undefined) { await candidate.reflectOrchestration({ baseRevision:candidate.revision, restore:input.restore, authorized:true }); addresses.push(componentAddress('orchestration', '')); }
        if (input.orchestration !== undefined || input.orchestration_patch !== undefined) {
          let definition = normalizeOrchestration(input.orchestration ?? mergeOrchestrationPatch(candidate.current.orchestration, input.orchestration_patch));
          // Intent compiler: deterministic completion of mechanical wiring; ambiguity asks one concrete question.
          if (this.mech.compiler) { const completed = compileOrchestrationIntent(definition, this.knownActionTypes); definition = completed.definition; compiledEntries.push(...completed.compiled); }
          // EVO_META T0 gate (user decision 2026-11-16): the gate checks the orchestration's fixed contract object,
          // not the fact that something was submitted. TASK GOAL, TASK ACCEPTANCE and the run plan must be present;
          // the run plan's triggers bind task-side events, so a counter or a clock cannot open it. Shape only - the
          // host does not judge whether the plan is good.
          if (this.metaT0Pending) {
            const problems = contractProblems(definition.contract);
            if (problems.length) throw operationError(`the T0 gate needs the task-side contract in your orchestration (${problems.join('; ')})`, 'orchestration', input, { invalid: ['contract'],
              correction: `Add orchestration.contract in this form: ${ORCHESTRATION_CONTRACT_FORM} Then resend. The mechanism and the acceptance standard are given; this turn fills only the task side.` });
          }
          if (definition.roles?.length !== 1 || definition.roles[0].id !== 'agent') throw Error('v1 roles must be only agent');
          await candidate.reflectOrchestration({ baseRevision: candidate.revision, orchestration: definition, authorized: true, carry: input.carry, stepMap: input.stepMap }); addresses.push(componentAddress('orchestration', ''));
        }
      }
      if (input.policy !== undefined) {
        this.assertWrite('policy');
        // A restore carries a whole definition; an Agent change is a merge patch onto the current (pending) policy.
        const next = input.restore !== undefined ? copy(input.policy) : mergePatch(policy, input.policy);
        validatePolicy(next, this.contract, this.outputLimit); policy = next;
        for (const key of Object.keys(input.policy)) if (!restoreScope || restoreScope.has(componentAddress('policy', key))) addresses.push(componentAddress('policy', key));
      }
      // EVO_L4: a top-level declaration covers the orchestration/policy addresses this transaction touched.
      if (input.evolution_layer !== undefined) for (const address of addresses) if (address === componentAddress('orchestration', '') || address.startsWith('policy.')) declareLayer(address, input.evolution_layer);
      if (!addresses.length && skippedUnchanged.length) return { status: 'no_change', changed: false, reason: 'source identical to the current version; no version bump and no validation window', current: skippedUnchanged.map(address => ({ address, value: 'read_self_component(kind, name)' })) };
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
      const knownMetrics = this.ledger.filter(r => r.type === 'task_outcome' && r.revision <= this.serial)
        .flatMap((row: any) => row.value?.metrics ?? []).filter(isMetric);
      const requestedPredicate = input.components?.find((c: any) => c.success_predicate)?.success_predicate ?? (input as any).success_predicate;
      const metric = requestedPredicate?.metric ? knownMetrics.find(m => m.name === requestedPredicate.metric) : undefined;
      const legalMetrics = [...new Map(knownMetrics.map(m => [`${m.name}|${m.scope ?? 'segment'}`, { name: m.name, scope: m.scope ?? 'segment' }])).values()];
      if (requestedPredicate && (!metric || !requestedPredicate.direction || !requestedPredicate.segment)) {
        throw operationError('success_predicate did not resolve at the owning boundary', 'orchestration', input, { invalid: ['success_predicate'], legal_metrics: legalMetrics, correction: 'Retry this same turn with one listed metric name, its scope, direction (increase|decrease), and segment (last|mean).' });
      }
      const baselineRef = this.segmentRefs.at(-1) ?? null;
      const success_predicate = requestedPredicate && metric ? { metric: metric.name, direction: requestedPredicate.direction, segment: requestedPredicate.segment, scope: requestedPredicate.scope ?? metric.scope ?? 'segment', baseline: { value: metric.value, segment: this.segmentNumber - 1, ref: baselineRef } } : undefined;
      const reviewFacts = this.reviewView().all_facts.map((r: any) => r.ref);
      const suppliedRefs = [...new Set([...(input.components?.flatMap((c: any) => c.evidence_refs ?? []) ?? []), ...(input.evidence_refs ?? [])])];
      const retained = suppliedRefs.filter((ref: string) => reviewFacts.includes(ref));
      const discarded = suppliedRefs.filter((ref: string) => !reviewFacts.includes(ref)).map(ref => ({ ref, reason: 'not a booked fact reference in this review' }));
      // Effect return: evidence is what the agent cites; the full booked set is not auto-attached.
      const evidence_refs = this.mech.effect_return ? retained : [...new Set([...(evolution ? reviewFacts : []), ...retained])];
      // Effect return: a validation window opens only for a declared effect; an undeclared change activates without one.
      const windowDue = !this.mech.effect_return || Boolean(requestedPredicate || input.expected_effect);
      this.pending = { candidate, policy, revision, addresses: [...(this.pending?.addresses ?? []), ...addresses], windows: [...(this.pending?.windows ?? []), ...(evolution && addresses.length && windowDue ? [{ addresses, expected_effect: input.expected_effect, success_predicate, predicate_source: requestedPredicate ? 'agent' : 'provisional', evidence_refs, review: this.review?.id ?? null }] : [])], source: input.restore,
        declaredLayers: { ...(this.pending?.declaredLayers ?? {}), ...declaredLayers },
        baseStateHash: this.pending?.baseStateHash ?? hash(this.baseSaved().snapshot) };
      return this.fact('reflection_activated', { revision, addresses, activation: 'before next provider request', review: this.review?.id ?? null,
        ...(compiledEntries.length ? { compiled: compiledEntries } : {}),
        ...(skippedUnchanged.length ? { unchanged_skipped: skippedUnchanged } : {}),
        ...(restoreScope ? { restore_scope: [...restoreScope], differs_not_restored: restoreNotRestored } : {}),
        ...(Object.keys(declaredLayers).length ? { declared_layers: declaredLayers } : {}),
        evidence_refs: { retained, discarded, auto_attached: evolution && !this.mech.effect_return ? reviewFacts : [] }, success_predicate, predicate_source: requestedPredicate ? 'agent' : 'provisional',
        ...(input.expected_effect ? { expected_effect: input.expected_effect } : {}),
        ...(evolution && addresses.length ? { validation_window: windowDue ? 'opens at activation' : 'none; a window opens when the change declares expected_effect or success_predicate' } : {}) }).value;
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
    // The protocol surface is never gated by an object it can revise. A step's `actions` list is agent-written
    // orchestration content; letting it refuse read_self/reflect_* would let the first narrow design switch off the
    // tools that widen it again (M3 run 2026-11-16: step `work` listed four task actions and every read/reflect call
    // returned "not allowed by active step work" for 30 requests, with no route back). surface() advertises PROTOCOL
    // at every request, so gating it was also an advertisement the runtime then contradicted.
    if (PROTOCOL.includes(type)) return;
    // Review suspends the work step; its observe tools are not constrained by a work whitelist.
    if (this.requestPin?.mode === 'execute') super.assertActionAllowed(type);
  }
  surface() {
    // EVO_META T0: until the agent has written its orchestration once, only the protocol surface exists. The task segment
    // (and every tool it creates) opens on the other side of that gate; nothing is refused that is not named here.
    if (this.metaT0Pending) return [...PROTOCOL];
    // Evolution review observes evidence; task artifacts are not edited there (design §1).
    const tools = this.inEvolutionReview
      ? [...new Set([...this.policy.review.tools, ...this.review?.modeDefinition.tools ?? [], ...this.policy.modes[this.currentMode].tools])] : this.review?.modeDefinition.tools ?? this.policy.modes[this.currentMode].tools;
    return [...new Set([...PROTOCOL, ...tools.filter((t: string) => t !== 'agent_tools' && this.contract.capabilities.includes(t)),
      ...(this.contract.capabilities.includes('agent_tools') ? this.active().filter(c => c.kind === 'tool').map(c => c.name) : [])])];
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
  /** EVO_META (2026-11-16, problems 2 and 3): the self view as an object the loop runs through. After the T0 design,
   * every activation books one `self.change` action receipt carrying the pushed self-state facts, so a transition the
   * agent wrote on it turns the agent's own loop at the activation, and a decision can cite the receipt's ref instead
   * of the view being a switch-invariant wallpaper. The first activation is the T0 design itself - the loop's
   * existence condition, not a cycle - and books none; the comparison arm records none at all. */
  private metaSelfChange(addresses: string[]) {
    if (!this.mech.meta || this.snapshot().complete) return undefined;
    const prior = [...this.ledger].reverse().find(r => r.type === 'reflection_activated' && r.value?.parent !== undefined);
    if (!prior) return undefined;
    const receipt = this.recordAction('self.change', { revision: this.serial, addresses, ...this.selfChangeDigest(prior) }, false, true);
    return { ref: receipt.receipt.ref, transition: receipt.transition };
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
    try {
      this.fact('transaction_intent', { from: this.serial, to: p.revision, addresses: p.addresses }); persist();
      // Private base-class fields are own properties; preserve this root's identity and META state.
      Object.assign(this, p.candidate); this.onReflection = onReflection; this.policy = p.policy; this.serial = p.revision;
      this.onReflection?.({ kind: 'orchestration', revision: this.serial });
      this.pending = undefined;
      // META: the view as a receipt in the loop, recorded before the step surface is applied so a matching transition
      // moves the step the very request this change activates.
      const selfChange = this.metaSelfChange(p.addresses ?? []);
      applySurface(this.surface());
      const activated = this.fact('reflection_activated', { parent: oldSerial, revision: this.serial, addresses: p.addresses, restore_source: p.source ?? null, review: this.review?.id ?? this.pendingReview ?? null,
        ...(p.declaredLayers && Object.keys(p.declaredLayers).length ? { declared_layers: p.declaredLayers } : {}),
        ...(selfChange ? { self_change: selfChange } : {}),
        success_predicates: p.windows.filter(Boolean).map((w: any) => ({ predicate: w.success_predicate ?? null, predicate_source: w.predicate_source ?? null })) });
      for (const w of p.windows) if (w) this.createWindow(oldSerial, activated.ref, w.addresses ?? p.addresses, w.expected_effect, w.review ?? null, w.success_predicate, w.evidence_refs, w.predicate_source);
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
      const knownActionTypes = this.knownActionTypes;
      Object.assign(this, new LiveAgentSelf(old, this.rootValidator)); this.onReflection = onReflection;
      if (knownActionTypes) this.declareActionTypes(knownActionTypes);
      try { this.onReflection?.({ kind: 'orchestration', revision: this.serial }); applySurface(this.surface()); persist(); }
      catch (recovery) { this.paused = true; this.fact('inconsistent', { error: String(e), recovery: String(recovery) }); persist(); throw Error('tool/persistence compensation failed; paused'); }
      this.fact('activation_failed', { error: String(e), restored: this.serial }); persist(); throw e;
    }
  }
  /** Host-made window (art. 5-1): fixed segment baseline rule, no Agent bookkeeping fields. */
  private createWindow(parent: number, activation: string, addresses: string[], expected_effect: string | undefined, review: string | null, success_predicate?: any, evidence_refs: string[] = [], predicate_source?: 'provisional' | 'agent') {
    const summaries = this.segmentRefs.map(ref => this.ledger.find(r => r.ref === ref)!).filter(Boolean);
    const last = summaries.at(-1);
    const allMetrics = summaries.flatMap(r => (r.value?.metrics ?? []).filter(isMetric));
    const latestMetrics = (last?.value?.metrics ?? []).filter(isMetric);
    const key = (m: Metric) => `${m.name}|${m.unit}|${m.scope ?? 'segment'}`;
    const lastMetrics: Metric[] = [...new Map(latestMetrics.map(m => [key(m), m])).values()];
    if (success_predicate?.metric) {
      const predicateScope = success_predicate.scope ?? 'segment';
      const comparable = [...allMetrics].reverse().find(m => m.name === success_predicate.metric && (m.scope ?? 'segment') === predicateScope);
      if (comparable && !lastMetrics.some(m => key(m) === key(comparable))) lastMetrics.push(comparable);
    }
    const mean: Metric[] = lastMetrics.map(m => { const xs = allMetrics.filter(x => key(x) === key(m)).map(x => x.value);
      return { ...m, value: xs.reduce((a: number, b: number) => a + b, 0) / xs.length }; });
    const resolvedPredicate = predicate_source === 'agent' && success_predicate?.metric ? { ...success_predicate, baseline: lastMetrics.find(m => m.name === success_predicate.metric && (m.scope ?? 'segment') === (success_predicate.scope ?? 'segment')) ? { value: lastMetrics.find(m => m.name === success_predicate.metric && (m.scope ?? 'segment') === (success_predicate.scope ?? 'segment'))!.value, segment: last?.value?.segment ?? null, ref: last?.ref ?? null } : null } : success_predicate;
    const window: Window = { id: `window:${this.windows.length}`, revision: this.serial, parent, review, activation, baseline: summaries.map(r => r.ref),
      baseline_segment: last ? Number(last.value.segment) : null, baseline_metrics: { last: lastMetrics, mean }, scope: [...addresses],
      due: { settlement: this.settlementCount + 1, after_use: true, rule: WINDOW_RULES.due }, ...(expected_effect ? { expected_effect } : {}),
      success_predicate: resolvedPredicate, predicate_source, evidence_refs, baseline_phase: (last?.value?.phase ?? null), effect_status: success_predicate ? 'specified' : expected_effect ? 'specified' : 'effect_unspecified', later_use_refs: [], status: 'open',
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
    const identity = (m: Metric) => m.observation_id ?? this.options.observationIdentity?.(m);
    const baselineIndex = this.ledger.findIndex(r => r.ref === w.activation);
    const fresh = (m: Metric, baseline: Metric) => { const id = identity(m); return id !== undefined && id !== identity(baseline) && this.ledger.some((r, i) => i > baselineIndex && r.type === 'task_outcome' && (r.value?.metrics ?? []).some((x: any) => isMetric(x) && identity(x) === id)); };
    const comparisons = w.baseline_metrics.last.flatMap(b => {
      const o = observed.find(x => x.name === b.name && x.unit === b.unit && ((x as any).scope ?? 'segment') === ((b as any).scope ?? 'segment') && fresh(x, b)); if (!o) return [];
      const m = w.baseline_metrics.mean.find(x => x.name === b.name && x.unit === b.unit && (x.scope ?? 'segment') === (b.scope ?? 'segment'));
      return [{ name: b.name, unit: b.unit, scope: b.scope ?? 'segment', baseline_observation_id: identity(b) ?? null, observation_id: identity(o) ?? null, baseline_last: b.value, baseline_mean: m?.value ?? null, observed: o.value, diff_last: o.value - b.value, diff_mean: m ? o.value - m.value : null }]; });
    const key = (m: Metric) => `${m.name}|${m.unit}|${m.scope ?? 'segment'}`;
    const missing_metrics = [...new Set([...w.baseline_metrics.last.map(key), ...observed.map(key)])]
      .map(k => ({ key: k, baseline: w.baseline_metrics.last.find(m => key(m) === k) ? { scope: w.baseline_metrics.last.find(m => key(m) === k)!.scope ?? 'segment', observation_id: identity(w.baseline_metrics.last.find(m => key(m) === k)!) ?? null } : null,
        current: observed.find(m => key(m) === k) ? { scope: observed.find(m => key(m) === k)!.scope ?? 'segment', observation_id: identity(observed.find(m => key(m) === k)!) ?? null } : null }))
      .filter(row => !row.baseline || !row.current || row.baseline.observation_id === row.current.observation_id);
    const predicate = w.success_predicate;
    const comparison = predicate ? comparisons.find(c => c.name === predicate.metric && c.scope === (predicate.scope ?? c.scope)) : undefined;
    const matchingPhase = w.baseline_phase !== null && observedRow?.value?.phase === w.baseline_phase;
    const missing = [...(w.later_use_refs.length ? [] : ['later_use']), ...(observedRow ? [] : ['observed_segment']),
      ...(w.baseline.length ? [] : ['settled_baseline']), ...(comparisons.length ? [] : ['repeatable_numeric_metric']),
      ...(predicate ? [] : ['success_predicate']), ...(comparison ? [] : ['predicate_metric']), ...(matchingPhase ? [] : ['comparable_phase']), ...(comparisons.length ? [] : ['same_metric_scope'])];
    const predicateMet = predicate && comparison && matchingPhase ? predicate.direction === 'increase'
      ? comparison.observed > (predicate.segment === 'mean' ? comparison.baseline_mean : comparison.baseline_last)
      : comparison.observed < (predicate.segment === 'mean' ? comparison.baseline_mean : comparison.baseline_last) : false;
    const verification = missing.length || !predicate ? 'unverified' : 'comparable';
    w.status = verification === 'comparable' ? 'due_comparable' : reason.startsWith('task end:') ? 'unverified_at_task_end' : 'due_unverified';
    w.delivered = { reason, baseline_segment: w.baseline_segment, observed_segment: observedRow?.value?.segment ?? null, observed_ref: observedRef ?? null,
      metric_comparisons: comparisons, missing_metrics, later_use: w.later_use_refs.length > 0,
      ...(w.expected_effect ? { expected_effect: w.expected_effect } : {}),
      later_use_refs: w.later_use_refs.slice(-20), missing, verification, success_predicate: predicate ?? null, predicate_source: w.predicate_source ?? (predicate ? 'agent' : null), predicate_met: verification === 'comparable' ? Boolean(predicateMet) : null, restore_default: w.parent };
    return this.fact('validation_delivered', { window: w.id, ...w.delivered });
  }
  async boundary(applySurface: (tools: string[]) => void, persist: () => void) {
    if (this.paused) throw Error('inconsistent/paused');
    this.activatePending(applySurface, persist);
    this.chainFailed = false;
    if (!this.review) this.reviewRequests = 0;
    await this.event('request_boundary',`request:${this.request}`);
    const due = this.heartbeatDue.splice(0);
    if (this.contract.heartbeat) for (const settled of due) {
      const boundary = `heartbeat:settled:${settled}`;
      if (this.request >= this.contract.budget.requests) this.fact('heartbeat_gap', { settled_task_requests: settled, reason: 'hard cap; heartbeat not dispatched', source: 'user_contract' });
      else await this.event('heartbeat', boundary, { settled_task_requests: settled, source: 'user_contract' });
    }
    if (!this.review && this.queue.length) this.enter(this.queue.shift());
    this.lastSurface = this.surface(); applySurface(this.lastSurface);
    if (this.options.pendingDeliveryState?.() && this.options.deliveryTransitionReached?.() && !this.review && !this.queue.length && !this.taskEndPending) {
      this.fact('delivery_transition', { state: 'execute_pending_final_delivery' });
      await this.options.runPendingDelivery?.();
    }
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
    if (!formalDelivery && this.options.pendingDeliveryState?.() && /budget|permit reject/i.test(reason)) {
      this.budgetDelivery ??= this.options.budgetStopPendingDelivery?.();
    }
    if (formalDelivery && (this.review || this.queue.length || this.pendingDelivery || this.unresolvedReview) && !this.taskEndPending) {
      this.taskEndPending = reason;
      this.fact('review_unresolved', { reason: 'task end reached with review work still open', review: this.review?.id ?? null,
        queued_reviews: this.queue.map(t => t.id), pending_delivery: Boolean(this.pendingDelivery) });
      return { deferred: true };
    }
    this.taskEnded = reason;
    if (this.review || this.queue.length || this.pendingDelivery || this.unresolvedReview) {
      this.fact('review_unresolved', { reason: 'task ended with review work still open', review: this.review?.id ?? null,
        queued_reviews: this.queue.map(t => t.id), pending_delivery: Boolean(this.pendingDelivery) });
    }
    const delivered = this.windows.filter(w => w.status === 'open').map(w => this.deliverWindow(w, `task end: ${reason}`).ref);
    this.taskEndPending = undefined;
    this.fact('task_ended', { reason, windows_delivered: delivered });
    // META T2: a delivered run never reaches before_session_end, so the harness inventory is booked here too.
    this.metaInventory();
    return { delivered };
  }
  waitForBudgetDelivery() { return this.budgetDelivery ?? Promise.resolve(); }
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
      && !(this.options.boundaryTools ?? []).includes(this.actionName(r.value.facts.tool, r.value.facts.args)))
      || (r.type === 'tool_failed' && !PROTOCOL.includes(r.value?.tool)));
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
    const summaryValue = summary?.value ?? { process: {}, metrics: [] };
    const processMetrics = Object.entries(summaryValue.process ?? {}).map(([name, value]) => ({ name: `process.${name}`, value, ref: summary?.ref ?? null }));
    const acceptance = (summaryValue.metrics ?? []).filter((m: any) => typeof m.name === 'string' && m.name.startsWith('acceptance.')).map((m: any) => ({ ...copy(m), denominator: m.name.endsWith('_found') ? (summaryValue.metrics ?? []).find((x: any) => x.name === m.name.replace('_found', '_total'))?.value ?? null : undefined, ref: summary?.ref ?? null }));
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
    const requests = rows.filter(r => r.type === 'request_record').map(r => ({ ref: r.ref, request: r.value.request, usage: copy(r.value.usage ?? null), usd: r.value.usd_estimate ?? null }));
    const omitted_context = rows.flatMap(r => (r.value?.composition?.omitted_items ?? []).map((x: any) => ({ ...copy(x), request_ref: r.ref })));
    const legalMetrics = [...new Map((summaryValue.metrics ?? []).filter(isMetric).map((m: Metric) => [`${m.name}|${m.scope ?? 'segment'}`, { name: m.name, scope: m.scope ?? 'segment' }])).values()];
    if (this.pendingDelivery || this.options.pendingDeliveryState?.()) allFacts.push({ ref: `pending-delivery:${this.request}`, type: 'pending_final_delivery', value: { state: 'pending', action: this.pendingDeliveryName ?? 'final delivery' } });
    return { process_facts: processFacts, tool_events: toolEvents, boundaries, receipts_probes: receipts,
      quality_facts: qualityFacts, fact_table: { process_metrics: processMetrics, unit_acceptance: acceptance, request_costs: requests, omitted_context, pending_delivery: Boolean(this.pendingDelivery || this.options.pendingDeliveryState?.()), legal_predicate_metrics: legalMetrics },
      self_activity: selfActivity, due_window_deliveries: due, all_facts: allFacts };
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
    const reviewReqs = allReqs.filter(r => r.value?.pin?.mode === 'reflect');
    const process = { requests: reqs.length, execute_requests: reqs.length, input_tokens_sum: reqs.reduce((n, r) => n + tok(r, 'input'), 0), input_tokens_max: Math.max(0, ...reqs.map(r => tok(r, 'input'))),
      input_tokens_last: reqs.length ? tok(reqs.at(-1)!, 'input') : 0, output_tokens_sum: reqs.reduce((n, r) => n + tok(r, 'output'), 0), cache_read_sum: reqs.reduce((n, r) => n + tok(r, 'cache_read'), 0),
      output_cap_stops: reqs.filter(r => r.value?.stop === 'output_cap').length, provider_retries: reqs.reduce((n, r) => n + Number(r.value?.provider_retries ?? 0), 0),
      tool_errors: errors.length, latency_s: reqs.reduce((n, r) => n + Number(r.value?.latency_ms ?? 0), 0) / 1000,
      history_chars_last: Number(lastComp?.history?.chars_after ?? 0), images_in_context_last: Number(lastComp?.history?.images_after ?? 0),
      context_policy_revisions: [...new Set(reqs.map(r => r.value?.context_policy?.revision).filter((x: any) => x !== undefined))] };
    const review = { requests: reviewReqs.length, input_tokens_sum: reviewReqs.reduce((n, r) => n + tok(r, 'input'), 0), output_tokens_sum: reviewReqs.reduce((n, r) => n + tok(r, 'output'), 0), latency_s: reviewReqs.reduce((n, r) => n + Number(r.value?.latency_ms ?? 0), 0) / 1000 };
    const outcomeRows = rows.filter(r => r.kind === 'fact' && r.type === 'task_outcome' && Array.isArray(r.value?.metrics));
    const outcome = new Map<string, Metric>();
    for (const r of outcomeRows) for (const m of r.value.metrics) if (isMetric(m)) outcome.set(`${m.name}|${m.unit}|${m.scope ?? ''}`, copy(m));
    const processMetrics: Metric[] = Object.entries(process).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ name: `process.${k}`, value: v as number, unit: k.includes('tokens') ? 'tokens' : k.includes('chars') ? 'chars' : k === 'latency_s' ? 's' : 'count' }));
    const workMetrics: Metric[] = [{ name: 'work.task_actions', value: work.length, unit: 'count' }];
    const metrics = [...processMetrics, ...workMetrics, ...outcome.values()];
    const phase = rows.find(r => r.type === 'provider_input')?.value?.phase ?? null;
    const row = this.fact('segment_summary', { segment: this.settlementCount, boundary: boundaryRef, unit, phase, ledger: [this.segmentStart, this.ledger.length - 1],
      requests: allReqs.length ? [allReqs[0].value.request, allReqs.at(-1)!.value.request] : [], process, review, work: { task_actions: work.length, by_tool: [...byTool.values()].sort((a, b) => a.tool.localeCompare(b.tool)) },
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
    const segmentBeforeBoundary = this.ledger.slice(this.segmentStart);
    const hasUnreviewedOutcome = segmentBeforeBoundary.some(r => r.type === 'task_outcome' && !this.reviewedQualityRefs.has(r.ref));
    const coalesced = settles && !final && !forcedReview && !hasUnreviewedOutcome && !this.segmentHasWork(segmentBeforeBoundary);
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
    if (this.contract.boundaries.includes(type) && !quiet && !this.mech.meta) triggers.push({ id: `contract:${type}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });
    if (settles && !quiet) {
      const classes = Array.isArray((facts as any)?.event_classes) ? (facts as any).event_classes : [];
      const tags = Array.isArray((facts as any)?.coverage_tags) ? (facts as any).coverage_tags : [];
      const prior = this.conditionSet.floor;
      this.conditionSet.floor = { ...prior, event_classes: [...new Set([...prior.event_classes, ...classes])], coverage_tags: [...new Set([...prior.coverage_tags, ...tags])] };
    const eventFacts = (facts as any)?.evidenceRefs ?? [];
      const segmentRows = segmentEvidence;
      const process = summary?.value?.process;
      const checkpointTypes = new Set(this.options.workCheckpointTypes ?? []);
      const checkpoint = segmentRows.some(r => checkpointTypes.has(r.type));
      const subtype = segmentRows.some(r => r.type === 'event' && ['tool_failed', 'tool_cancelled', 'request_paused', 'watch_stall'].includes(r.value?.type));
      const processFault = Number(process?.output_cap_stops ?? 0) > 0 || Number(process?.tool_errors ?? 0) > 0;
      const newFacts = eventFacts.length > 0 || segmentRows.some(r => r.type === 'task_outcome' || ['watch_stall','request_paused','exit_normalization','reflection_validation_failed','acceptance_result',...(this.mech.effect_return ? [] : ['validation_delivered']),'tool_failed'].includes(r.type)) || subtype || processFault || checkpoint;
      // META: facts are booked but no longer schedule a review - the loop's rhythm belongs to the agent's orchestration.
      if ((newFacts || forcedReview) && !this.mech.meta) triggers.push({ id: 'evolution_review', source: forcedReview ? 'requested_review' : 'booked_facts', mode: 'reflect', conclusion_sink: 'ledger' });
    }
    if (type === 'heartbeat' && !quiet && !this.mech.meta) triggers.push({ id: `contract:${boundary}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });

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
        const quality = ((summary?.ref ? this.ledger.find(r => r.ref === summary.ref)?.value?.metrics : undefined) ?? []).some((m: any) => {
          const baseline = w.baseline_metrics.last.find(b => b.name === m.name && b.unit === m.unit && (b.scope ?? 'segment') === (m.scope ?? 'segment'));
          const currentId = m.observation_id ?? this.options.observationIdentity?.(m);
          const baselineId = baseline && (baseline.observation_id ?? this.options.observationIdentity?.(baseline));
          const activationIndex = this.ledger.findIndex(r => r.ref === w.activation);
          const observedAfterActivation = currentId !== undefined && this.ledger.some((r, i) => i > activationIndex && r.type === 'task_outcome' && (r.value?.metrics ?? []).some((x: any) => isMetric(x) && x.name === m.name && (x.scope ?? 'segment') === (m.scope ?? 'segment') && (x.observation_id ?? this.options.observationIdentity?.(x)) === currentId));
          return m.name === w.success_predicate?.metric && (m.scope ?? 'segment') === (w.success_predicate?.scope ?? 'segment') && observedAfterActivation && currentId !== baselineId;
        });
        if (w.success_predicate && !quality) { w.unknowns = [...new Set([...w.unknowns, 'awaiting_observation'])]; continue; }
        this.deliverWindow(w, `settlement ${this.settlementCount}`, summary?.ref);
        // Effect return: the host evaluates the agent-declared predicate mechanically at due; retain/restore lands as facts.
        if (this.mech.effect_return && w.predicate_source === 'agent' && w.status === 'due_comparable') {
          try { await this.interpret(w.id); } catch (e) { this.fact('validation_error', { window: w.id, error: String(e) }); }
        }
        // A delivered window lands as facts in the self view; it does not summon a review by itself.
        if (!quiet && !this.mech.effect_return) triggers.push({ id: w.id, source: 'validation_due', mode: 'reflect', conclusion_sink: 'ledger' });
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
      const pendingDelivery = Boolean(this.pendingDelivery || this.options.pendingDeliveryState?.());
      if (pendingDelivery && !forcedReview) {
        // No new reviews while final delivery is pending; the facts stay booked for the next entrance.
        this.fact('review_suppressed', { boundary, event: event.ref, triggers: triggers.map((t: any) => t.id), reason: 'final delivery pending' });
      } else {
      const existing = this.queue.find(t => t.boundary === boundary);
      if (existing) existing.triggers.push(...triggers);
      else this.queue.push({ id: `review:${event.ref}`, boundary, event: event.ref, triggers, revision: this.serial, ledger_offset: this.ledger.length });
      }
    }
    // META T2: the close of the session books the harness's final inventory once; the agent closes freely.
    if (type === 'before_session_end') this.metaInventory();
    return { event: event.ref, triggers, ...(summary ? { segment_summary: summary.ref } : {}) };
  }
  /** EVO_META T2: what the agent's own view holds at close, and the acceptance counts settled once. Facts only. */
  private metaInventory() {
    if (!this.mech.meta || this.ledger.some(r => r.type === 'meta_harness_inventory')) return;
    const orchestration: any = this.current?.orchestration ?? {};
    const acceptance = this.metaAcceptance();
    this.fact('meta_harness_inventory', {
      components: this.active().map(c => ({ kind: c.kind, name: c.name, chars: String(c.source ?? '').length })),
      orchestration: { revision: orchestration.revision ?? this.serial, slots: (orchestration.slots ?? []).length, steps: (orchestration.steps ?? []).length,
        decisions: (orchestration.decisions ?? []).length, transitions: (orchestration.transitions ?? []).length },
      revision_chain: this.ledger.filter(r => r.type === 'reflection_activated').map(r => ({ revision: r.value?.revision ?? null, addresses: r.value?.addresses ?? [], review: r.value?.review ?? null })),
      policy_keys: Object.keys(this.policy), design: this.ledger.find(r => r.type === 'meta_t0_design')?.ref ?? null,
      acceptance: { changes: acceptance.changes, activated: acceptance.activated, used_later: acceptance.used_later,
        last_change: acceptance.last?.ref ?? null, contract: this.metaContract() },
    });
  }
  /** Final delivery settles facts but leaves an evolvable review loop open when quality facts or windows remain. */
  async finalSettlement(boundary: string, facts: any = {}) {
    // META: the host opens no review at settlement; only the agent's own orchestration routes can.
    const result = await this.event('settlement', boundary, { ...facts, final: false, force_review: !this.mech.meta });
    return { ...result, task_end: { deferred: true, reason: 'formal delivery completion is recorded by the adapter after its delivery action returns' } };
  }
  private enter(ticket: any) {
    this.previousMode = this.currentMode; this.currentMode = ticket.triggers[0].mode;
    this.reviewRequests = 0;
    this.review = { ...ticket, mode: this.currentMode, modeDefinition: copy(this.policy.modes[this.currentMode]), policy: copy(this.policy),
      suspended: { step: this.step, revision: this.serial }, changes: [], request_entered: this.request, snapshot: this.baseSaved(), windows: this.dueWindows, entry_hash: hash(this.baseSaved().snapshot) };
    let object_state: any = null;
    try { object_state = this.options.observeCurrentArtifact?.() ?? null; } catch (error) { object_state = { refresh: { fresh: false, failed: true, error: String(error) } }; }
    this.reviewObjectState = object_state;
    if (this.inEvolutionReview) {
      const shown = this.reviewView().quality_facts.map((x: any) => x.ref);
      this.reviewedQualityRefs = new Set([...this.reviewedQualityRefs, ...shown]);
      this.fact('review_quality_facts', { review_event: ticket.event, refs: shown });
      this.fact('self_view', { review: ticket.id, view: { revision: this.serial, full: 'read_self(section="pin")' } });
    }
    this.fact('mode_entered', { id: ticket.id, mode: this.currentMode, triggers: ticket.triggers, suspended: this.review.suspended });
    const due_windows = this.dueWindows.map(id => { const w = this.windows.find(x => x.id === id)!; return { id, predicate: w.success_predicate ?? null, baseline: w.baseline_metrics, delivered: w.delivered ?? null, status: w.status }; });
    const frame: any = { in_review: true, writes_resume: 'after decide_exit; hot orchestration changes remain active immediately', pending_final_delivery: Boolean(this.pendingDelivery || this.options.pendingDeliveryState?.()), due_windows, review_requests_so_far: this.reviewRequests, object_state, result: 'runtime records activation, booked facts, retention or restore' };
    if (this.mech.legacy_obligation) Object.assign(frame, { must_change_self: true, artifact_does_not_end_evolution: true, rework_path: 'reflect orchestration; rewrite; render; resubmit or preview' });
    else frame.exit = 'decide_exit is available at any point; a judged no-change is a valid closure';
    if (this.mech.observation) frame.observation = this.observationText(2400);
    // EVO_L4 closure backflow: the last recorded closures return to the next entrance (presentation only).
    if (this.mech.l4) {
      const recent = this.ledger.filter(r => r.type === 'review_closed').slice(-3).map(r => ({
        ref: r.ref, outcome: r.value?.outcome ?? null, closed_by: r.value?.closed_by ?? null,
        responses: (Array.isArray(r.value?.result?.entry_question_responses) ? r.value.result.entry_question_responses : []).map((x: any) => String(x).split('\n')[0].slice(0, 160)) }));
      if (recent.length) frame.recent_closures = recent;
    }
    this.fact('review_frame', frame);
  }
  reviewSelfView() {
    const active = this.active();
    const latest = this.segmentRefs.at(-1) ? this.ledger.find(r => r.ref === this.segmentRefs.at(-1))?.value : null;
    const entry = (name: string, kind: string, controls: string, value: any, writable: boolean, change: any, reason?: string) => {
      const address = kind === 'policy' ? componentAddress('policy', name.replace(/^policy\./, '')) : componentAddress(kind, name);
      const related = this.ledger.filter(r => {
        const rawAddresses = r.value?.addresses ?? r.value?.address;
        const addresses = rawAddresses === undefined ? [] : [rawAddresses];
        const flat = addresses.flatMap((x: any) => Array.isArray(x) ? x : [x]);
        return flat.map((x: any) => String(x)).map((x: string) => x.startsWith('components.') || x.startsWith('policy.') || x === 'orchestration' ? x : x.includes('.') ? componentAddress(...x.split('.', 2) as [string,string]) : x).includes(address) || (r.type === 'provider_input' && (r.value?.component_addresses ?? []).includes(address)) || (r.type === 'task_outcome' && (r.value?.component_addresses ?? []).includes(address));
      });
      const exposure = related.filter(r => r.type === 'provider_input').map(r => r.ref);
      const use = related.filter(r => r.type === 'component_consumed' || r.type === 'tool_result' || r.type === 'activation_activated' || r.type === 'reflection_activated' || r.type === 'policy_applied').map(r => r.ref);
      const effect = related.filter(r => r.type === 'task_outcome' || r.type === 'unit_preview').map(r => r.ref);
      const tried = new Set(related.flatMap(r => r.type.includes('reflection') || r.type.includes('activation') ? ['redefine'] : r.type === 'component_read' ? ['read'] : []));
      const legal = writable ? (kind === 'component' ? ['define', 'redefine', 'restore', 'read'] : ['patch', 'replace', 'restore', 'read']) : ['read'];
      return { name, kind, controls, value, writable, ops: writable ? change.ops : [], change: writable ? change : null,
        facts: { exposure: exposure.length > 0, use: use.length > 0, effect: effect.length > 0, used: use.length > 0, changed: related.some(r => r.type === 'reflection_activated'), untried: legal.filter(op => !tried.has(op)), source_refs: [...exposure, ...use].slice(-8), outcome_refs: effect.slice(-8), costs: related.map(r => r.value?.cost ?? r.value?.usage ?? null).filter(Boolean).slice(-8), unknowns: related.length ? [] : ['no same-root use receipt recorded'] }, reason: writable ? undefined : reason ?? 'protected by user contract' };
    };
    const components = ['prompt','skill','tool','memory'].flatMap(kind => {
      const current = active.filter(c => c.kind === kind);
      const names = [...new Set(current.map(c => c.name))];
      if (!names.length) names.push(`${kind}_candidate`);
        return names.map(name => { const c = current.find(x => x.name === name); const row: any = entry(name, kind, `${kind} component`, c ? { version: c.version, source_hash: hash(c.source).slice(0, 12), active: true, chars: c.source?.length ?? null, current_source: 'read_self_component(kind, name)' } : { active: false }, this.contract.writable.includes(`components.${kind}`), { ops: ['reflect_component'], source_requirements: kind === 'tool' ? ['first ten lines must contain # program: on'] : ['non-empty source'], example: c ? { op: 'redefine', kind, name } : { op: 'define', kind, name, source: minimalComponentSource(kind, name) } }); if (this.mech.a4 && !c) row.candidate = true; return row; });
    });
    const policyValue = (v: any) => { const s = JSON.stringify(v); return s.length <= 400 ? copy(v) : { keys: Object.keys(v ?? {}), chars: s.length, full: 'read_self(section="policy")' }; };
    const policyEntries = Object.keys(this.policy).map(name => entry(`policy.${name}`, 'policy', name, policyValue((this.policy as any)[name]), this.contract.writable.includes('policy'), { ops: ['reflect_orchestration'], example: { policy: { [name]: '<merge patch onto the current value>' } } }));
    const protectedEntries = ['fixed_review_strategy','user_contract','provider_boundary'].map(name => entry(name, 'protected', 'visible protected element', { active: true }, false, null, name === 'fixed_review_strategy' ? 'fixed strategy for this phase' : 'user or provider boundary'));
    const countKind = (kind: string) => components.filter((x: any) => x.kind === kind && !x.candidate).length;
    const categories = { orchestration: 1, policy: Object.keys(this.policy).length, prompt: countKind('prompt'), skill: countKind('skill'), tool: countKind('tool'), memory: countKind('memory'), protected: protectedEntries.length };
    const factRows = this.ledger.filter(r => r.kind === 'fact');
    const byType: Record<string, number> = {};
    for (const r of factRows) byType[r.type] = (byType[r.type] ?? 0) + 1;
    const facts = { total: factRows.length, by_type: byType, last: factRows.slice(-12).map(r => ({ ref: r.ref, type: r.type, revision: r.revision, request: r.request })), full: 'read_self(section="ledger", offset, count)' };
    const memories = active.filter(c => c.kind === 'memory');
    const allEntries: any[] = [
      ...components, entry('orchestration', 'orchestration', 'steps, transitions and decisions', copy(this.current.orchestration), this.contract.writable.includes('orchestration'), { ops: ['reflect_orchestration'], example: { orchestration: 'full replacement or orchestration_patch; the current definition is this entry value' } }), ...policyEntries, ...protectedEntries
    ];
    // EVO_L4: echo recorded layer declarations onto entries and regroup already-recorded facts by layer.
    const declared: Record<string, string> = {};
    if (this.mech.l4) {
      for (const r of this.ledger) if (r.type === 'reflection_activated' && r.value?.declared_layers) Object.assign(declared, r.value.declared_layers);
      for (const e of allEntries) {
        if (e.kind === 'protected') continue;
        const address = e.kind === 'policy' ? componentAddress('policy', e.name.replace(/^policy\./, '')) : e.kind === 'orchestration' ? componentAddress('orchestration', '') : componentAddress(e.kind, e.name);
        e.evolution_layer = declared[address] ?? 'undeclared';
      }
    }
    return { revision: this.serial, strategy: this.reviewStrategy(true), categories, entries: allEntries, ...(this.mech.l4 ? { layers: this.layersView(declared) } : {}), ...(this.mech.observation ? { observation: this.observationText(2000) } : {}), facts, memory_policy_fact: memories.length ? null : 'The current memory policy has no memory component to manage.', object_state: this.review ? this.reviewObjectState : null, due_windows: this.dueWindows, review_requests_so_far: this.reviewRequests, full: 'read_self(section="self")' };
  }
  /** EVO_L4: the four layers as coordinates - a regrouping of facts already recorded elsewhere; no new counters. */
  private layersView(declared: Record<string, string>) {
    const active = this.active();
    const chars = (kind: string) => active.filter(c => c.kind === kind).reduce((n, c: any) => n + (typeof c.source === 'string' ? c.source.length : typeof c.body === 'string' ? c.body.length : 0), 0);
    const stepRuns: Record<string, number> = {};
    for (const r of this.ledger) if (r.type === 'request_record' && r.value?.pin?.step !== undefined) { const id = String(r.value.pin.step); stepRuns[id] = (stepRuns[id] ?? 0) + 1; }
    for (const s of (this.current?.orchestration?.steps ?? []) as any[]) { const id = String(s?.id ?? s); if (!(id in stepRuns)) stepRuns[id] = 0; }
    const lastRequest = this.ledger.findLast(r => r.type === 'request_record');
    return {
      prompt: { prompts: active.filter(c => c.kind === 'prompt').map(c => c.name), chars: chars('prompt'), delivery: 'full text into the context head each request' },
      context: { memory_chars: chars('memory'), policy: 'policy.context', last_composition: lastRequest?.value?.composition ?? null },
      loop: { step_executions: stepRuns, reviews: { opened: this.ledger.filter(r => r.type === 'mode_entered').length, closed: this.ledger.filter(r => r.type === 'review_closed').length } },
      harness: { tools: new Set(active.filter(c => c.kind === 'tool').map(c => c.name)).size, skills: new Set(active.filter(c => c.kind === 'skill').map(c => c.name)).size, subagents: 0, counts: 'see [inventory] and [recurrence] in observation' },
      declared_layers: declared,
    };
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
    if (this.mech.legacy_obligation && /already\s+(?:done|finished|delivered)|(?:artifact|delivery).{0,32}(?:risk|risky)|risk.{0,32}(?:artifact|delivered)/i.test(String(reason ?? ''))) {
      const correction = 'Continue self-evolution: an existing or delivered artifact does not close review. Rewrite the artifact through the active orchestration, then render and resubmit/preview as needed. Final delivery is pending and will complete after the scheduled work or at the authorized budget boundary.';
      this.fact('exit_correction', { review: review.id, rationale: reason, correction, pending_delivery: Boolean(this.pendingDelivery) });
      return { accepted: false, terminate: false, same_turn_correction: correction, pending_delivery: Boolean(this.pendingDelivery) };
    }
    let invalid: string | undefined;
    const exitSchema = this.reviewExitSchema ?? review.modeDefinition.exitSchema;
    try { validateSchema(result, exitSchema); } catch (e) { invalid = `result does not match your mode exit schema: ${String(e)}`; }
    if (!invalid && this.mech.ask && this.inEvolutionReview) {
      const responses = (result as any)?.entry_question_responses;
      if (!Array.isArray(responses) || responses.length !== 3 || responses.some((x: any) => typeof x !== 'string'))
        invalid = 'entry_question_responses must be exactly three strings, one per entrance question ("none" is a valid response)';
    }
    if (invalid) {
      review.invalid_exits = (review.invalid_exits ?? 0) + 1;
      if (review.invalid_exits === 1) {
        this.fact('exit_normalization', { review: review.id, error: invalid, next: 'a second invalid exit closes this review mechanically' });
        throw Error(`${invalid}; a second invalid exit closes this review mechanically`);
      }
      return this.closeMechanically('second invalid exit expression', { attempted: { reason: reason ?? null }, error: invalid });
    }
    return { ...this.close(review, 'agent', { result }), terminate: false };
  }
  /** One closure record; a host-unresolved close is distinct from an Agent conclusion. */
  private close(review: any, closedBy: string, extra: any = {}) {
    const evolution = this.inEvolutionReview;
    const unresolved = evolution && closedBy.startsWith('mechanical:') && !this.reviewChanged();
    const outcome = unresolved || closedBy.includes('review_unresolved') ? 'review_unresolved' : review.changes.length > 0 ? 'activated' : this.pending ? 'activation_intent' : 'closed';
    if (this.mech.legacy_obligation && evolution && closedBy === 'agent' && !this.reviewChanged()) throw Error('host-opened evolution review requires a qualifying change');
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
    if (w.predicate_source !== 'agent') return { window: w.id, result: 'unverified', predicate_met: null, predicate: w.success_predicate, predicate_source: w.predicate_source ?? 'provisional', reason: 'provisional comparison cannot retain or restore until Agent adopts or changes it' };
    if (w.delivered?.verification === 'unverified' || w.delivered?.predicate_met === null) return { window: w.id, result: 'unverified', predicate_met: null, predicate: w.success_predicate };
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
        tokens.unknown_reserved += Number(row.value?.tokens?.total ?? row.value?.tokens ?? 0);
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
      heartbeat_gaps: this.ledger.filter(r => r.type === 'heartbeat_gap').map(r => copy(r.value)),

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
    if (this.workRequests >= (this.contract.segment?.work_requests ?? 1)) {
      this.workRequests = 0;
      await this.event('work_quantum', `work:${this.settlementCount}:${this.request}`, { source: 'user_contract' });
    }
  }
  queueFinalDelivery(run: () => Promise<any>, action = 'final delivery') {
    if (this.queue.length || this.review) throw Error('final delivery is already deferred by an open review');
    this.pendingDelivery = { run };
    this.options.onPendingDelivery?.(true);
    this.pendingDeliveryName = action;
    return this.event('settlement', `quality-review:${this.request}:${this.ledger.length}`, { final: false, force_review: !this.mech.meta, source: 'unreviewed_quality' }).then(result => ({ delivery_deferred: true, review: result.event, pending_delivery: true, completion: 'scheduled rewrite/re-render/resubmit runs first; otherwise host completes pending delivery after review closure or budget stop' }));
  }
  async runPendingDelivery() { if (!this.pendingDelivery || this.review || this.queue.length) return undefined; const pending = this.pendingDelivery; this.pendingDelivery = undefined; this.pendingDeliveryName = undefined; this.options.onPendingDelivery?.(false); return pending.run(); }
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
    if (this.review) this.reviewRequests++;
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
    const interval = this.contract.heartbeat && this.contract.heartbeat.every_settled_task_requests;
    const settled = this.settledTaskRequests();
    if (interval && settled > 0 && settled % interval === 0 && !this.heartbeatDue.includes(settled)) this.heartbeatDue.push(settled);
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
  /** Cheap per-kind counts of the self catalog (same shape reviewSelfView reports). */
  selfCategories() {
    const active = this.active();
    const count = (kind: string) => { const n = new Set(active.filter(c => c.kind === kind).map(c => c.name)).size; return this.mech.a4 ? n : n || 1; };
    return { orchestration: 1, policy: Object.keys(this.policy).length, prompt: count('prompt'), skill: count('skill'), tool: count('tool'), memory: count('memory'), protected: 3 };
  }
  async projection() {
    const p = this.review?.policy ?? this.policy;
    const name = this.review?.triggers.find((r: any) => r.projection)?.projection ?? this.review?.modeDefinition.projection ?? p.modes[this.currentMode].projection;
    if (!name) return { counts: { facts: this.ledger.filter(r => r.kind === 'fact').length, claims: this.ledger.filter(r => r.kind === 'claim').length,
      outcomes: this.ledger.filter(r => r.type === 'task_outcome').length, requests: this.request, units: this.units }, strategy: this.reviewStrategy(), factual_space: { categories: this.selfCategories(), entries: 'read_self(section="pin")' }, evidence: { offset: 0, total: this.ledger.length, read: 'read_self(section="ledger",offset,count)' } };
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
    return { root_id: this.root_id, revision: this.serial, strategy: this.reviewStrategy(), factual_space: { categories: this.selfCategories(), entries: 'read_self(section="pin")' }, pin: { mode: this.currentMode, in_review: Boolean(this.review), ...(this.mech.legacy_obligation ? { must_change_self: Boolean(this.review) } : {}), writes_resume: this.review ? 'after decide_exit; reflection remains hot' : 'now', current_knobs: { request: this.policy.request, context_policy: { meaning: 'runtime-owned context strategy', current: 'read_self(section="policy")' } }, result: this.lastSettlementReview ? 'read_self(section="ledger") for booked facts and results' : null }, architecture: active.architecture, ledger: rows ? this.read(Math.max(0, this.ledger.length - rows), rows) : { rows: [], next: 0, total: this.ledger.length }, parts: {
      components: { relation: 'executes from this root', writable_kinds: this.contract.writable.filter(x => x.startsWith('components.')) },
      orchestration: { relation: 'controls active step and trusted receipts', writable: this.contract.writable.includes('orchestration') },
      policy: { relation: 'controls modes, META, memory retrieval/write, request envelope and actual context assembly', request: this.policy.request,
        version: hash(this.policy), writable: this.contract.writable.includes('policy'), expand: 'read_self(section="policy")' },
      context: { relation: 'runtime assembles working context from typed policy;  composition section names are read-only facts',
        writable: this.contract.writable.includes('policy'), change: 'reflect_orchestration({policy:{context:{...}}})', last_composition: lastRequest?.value?.composition ?? null, retrieve: 'read_self(section="context_item", ref)' },
      protected: { reason: this.contract.readonly_reason, contract_hash: this.contract.content_hash, boundaries: this.contract.boundaries, budget: this.contract.budget, capabilities: this.contract.capabilities, acceptance: this.contract.acceptance },
      unsupported: ['provider replacement', 'task subagents', 'cross-task default promotion', 'interactive world replay'],
    }, dynamic: { run: active.run, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, settlement_count: this.settlementCount, conditions: copy(this.conditionSet), ...(this.mech.observation ? { observation: this.observationDigest() } : {}), review: this.review ? { id: this.review.id, kind: this.exitOperationKind, triggers: this.review.triggers, pinned_ledger_offset: this.review.ledger_offset, suspended: this.review.suspended, exit_operation: this.exitOperationSchema, due_windows: this.dueWindows } : null,
      ...(reviewEvidence ? { review_evidence: copy(reviewEvidence) } : {}),
       process: { last_request: lastRequest ? { request: lastRequest.value.request, mode: lastRequest.value.pin?.mode ?? null, tokens: lastRequest.value.tokens, stop: lastRequest.value.stop,
          output_cap: lastRequest.value.output_cap, cut_tool_calls: lastRequest.value.cut_tool_calls, latency_ms: lastRequest.value.latency_ms, cache_supported: lastRequest.value.cache_supported,
          context_policy: lastRequest.value.context_policy, composition: lastRequest.value.composition } : null,
         current_segment: this.segmentNumber, segments, segments_total: this.segmentRefs.length, expand: 'read_self(section="segments"|"requests")' },
      instruction: this.review?.modeDefinition.instruction ?? this.policy.modes[this.currentMode].instruction,
      request_pin: this.requestPin, resources: this.resources(), activation_intent: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses } : null,
      queue: this.queue.map(t => t.id), windows: this.windows.filter(w => ['open','due_unverified','due_comparable','restore_pending'].includes(w.status)), window_rules: WINDOW_RULES, task_ended: this.taskEnded ?? null,
      evidence: { total: this.ledger.length, capsules: this.ledger.filter(r => r.type === 'capsule').map(r => r.ref), read: 'read_self' },
      lineage: { count: this.lineage.length, expand: 'read_self(section="lineage")' } } };
  }
}
