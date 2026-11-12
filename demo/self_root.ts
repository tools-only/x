/** Same executing LiveAgentSelf; META contains no attribution or adoption policy. */
import { createHash, randomUUID } from 'node:crypto';
import { LiveAgentSelf, validateSchema, validateSchemaStructure } from './live_orchestration_core.ts';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';
import type { Validator } from './agent_component_model.ts';

export const copy = <T>(x: T): T => structuredClone(x);
export const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const FLOOR = ['before_delivery', 'before_active_reset', 'unit_completed', 'before_session_end'];
const FLOOR_STEPS = [
  { unlocked_by: 'first_unit_boundary', close_contract: 'changed follows a completed unit boundary', evidence_scope: ['unit_outcomes'], coverage_tags: [] },
  { unlocked_by: 'later_use_observed', close_contract: 'window records use after activation', evidence_scope: ['used_version_receipts'], coverage_tags: [] },
  { unlocked_by: 'due_window_comparison', close_contract: 'missing numeric metrics remain unverified', evidence_scope: ['due_window_comparisons'], coverage_tags: [] },
];
const INITIAL_CONDITIONS = { floor: { step: 0, evidence: ['settlement_facts'], event_classes: [], coverage_tags: [] }, addenda: [] as unknown[] };
export const PROTOCOL = ['read_self', 'read_self_component', 'reflect_component', 'reflect_orchestration', 'decide', 'decide_exit', 'decide_validation'];
/** Adapter-supplied, task-neutral wiring. Task tool names live in the adapter, never here. */
export type SelfRootOptions = { reviewTools?: string[]; evolutionTools?: string[]; reservedToolNames?: string[]; actionOf?: (name: string, args: any) => string };
type Mode = { tools: string[]; instruction: string; projection?: string; exitSchema: any };
type Route = { id: string; event: string; predicate?: string; projection?: string; mode: string; priority: number; conclusion_sink: 'ledger' | 'lineage' };
export type Policy = {
  request?: { maxOutputTokens: number };
  modes: Record<string, Mode>; routes: Route[];
  methods: Record<string, string>;
  memory: { names: string[] | '*'; order: 'name' | 'newest'; write: 'replace' | 'append' };
  context: { order: Array<'prompts' | 'memory' | 'skills'>; instruction: string; reasoning?: 'all' | 'latest' | 'none' };
};
export type SelfContract = {
  source: 'user_contract'; authority: string; decisions: string; content_hash: string; readonly_reason: string;
  boundaries: string[]; capabilities: string[]; writable: string[];
  budget: { requests: number; tokens: number; seconds: number; usd: number; storage_bytes: number };
  acceptance: unknown; inherit_defaults: false; heartbeat: false | { enabled: true; every_settled_task_requests: 3 };
};
export type HeartbeatContract = SelfContract['heartbeat'];
const PROBE_KINDS = new Set(['preflight','inference','inference_probe','inference-preflight','provider-preflight','renderer-preflight']);
const CONSERVATIVE_RATES = { input: 20, output: 80 };
const REGISTERED_RATES = { input: 5, output: 30 };
const ESTIMATE_NEVER_INVOICE = 'estimate, never the invoice';
export function isValidHeartbeat(heartbeat: unknown): heartbeat is HeartbeatContract {
  if (heartbeat === false) return true;
  return !!heartbeat && typeof heartbeat === 'object' && !Array.isArray(heartbeat)
    && (heartbeat as any).enabled === true
    && (heartbeat as any).every_settled_task_requests === 3
    && Object.keys(heartbeat as any).length === 2;
}
export function heartbeatInterval(heartbeat: HeartbeatContract): number | undefined {
  return heartbeat === false ? undefined : heartbeat.every_settled_task_requests;
}
type Row = { ref: string; kind: 'fact' | 'claim'; type: string; revision: number; request: number; value: any };
export type Window = { id: string; revision: number; parent: number; review: string | null; activation: string; baseline: string[]; metric_refs: string[]; scope: string[];
  due: { settlement: number; after_use: true; rule: string }; expected_effect?: string; effect_status: 'specified' | 'effect_unspecified';
  later_use_refs: string[]; status: string; delivered?: any; unknowns: string[] };
/** Fixed mechanical rules published to the Agent; the host never selects "relevant" evidence. */
export const WINDOW_RULES = {
  baseline: 'all task_outcome and request_cost facts recorded at or before the latest settlement boundary (one task; the task scope covers every modified address)',
  metric_refs: 'baseline task_outcome facts carrying value.metric = {name, value:number, unit}; otherwise empty',
  due: 'the first settlement boundary after activation at which later use of the activated revision has been observed; at task end an open window becomes due_unverified',
  later_use: 'execute-mode provider requests pinned at or after the activated revision; for a changed tool, a recorded call of that tool',
  verification: 'comparable only with later use, an Agent expected_effect and the same numeric metric before and after; otherwise unverified',
};

/** The core owns semantic operation definitions; adapters turn these into provider schemas and
 * dispatch consumes the same definition through normalizeOperation. Required lists are exhaustive. */
export type OperationKind = 'delivery' | 'evolution' | 'validation' | 'component' | 'orchestration';
export function operationContract(kind: OperationKind) {
  const reason = { type: 'string', description: 'Optional interpretation in your own words.' };
  if (kind === 'evolution') return { name: 'decide_exit', description: 'Close the current evolution review. No field is required. An activated reflection in this review closes as changed automatically; otherwise omitted status closes as deferred. unrelated needs a reason.',
    properties: { status: { type: 'string', enum: ['deferred', 'unrelated'] }, reason }, required: [] as string[] };
  if (kind === 'delivery') return { name: 'decide_exit', description: 'Close the current task review. No field is required; keep means the task artifact stays as it is.',
    properties: { status: { type: 'string', enum: ['deferred', 'unrelated', 'keep'] }, reason }, required: [] as string[] };
  if (kind === 'validation') return { name: 'decide_validation', description: 'Your decision on a due validation window. window is needed only when several windows are due; restore defaults to the recorded parent revision.',
    properties: { window: { type: 'string' }, decision: { type: 'string', enum: ['adopt', 'restore', 'defer'] }, reason: { type: 'string', description: 'How you interpret the delivered baseline/outcome facts.' }, restore: { type: 'integer', minimum: 1 } }, required: ['decision', 'reason'] };
  if (kind === 'component') return { name: 'reflect_component', description: 'Change one component of this Agent. define/redefine need source; restore needs version. Revision bookkeeping and the validation window are host-made.',
    properties: { op: { type: 'string', enum: ['define', 'redefine', 'restore'] }, kind: { type: 'string', enum: ['tool', 'prompt', 'skill', 'memory'] }, name: { type: 'string' }, source: { type: 'string' }, version: { type: 'integer', minimum: 1 }, expected_effect: { type: 'string', description: 'Optional: what you expect this change to do. Without it the window stays effect_unspecified.' } }, required: ['op', 'kind', 'name'] };
  return { name: 'reflect_orchestration', description: 'Change this Agent orchestration/policy/components, or restore a revision. Include at least one change or restore. Revision bookkeeping and the validation window are host-made.',
    properties: { orchestration: { type: 'object' }, policy: { type: 'object' }, components: { type: 'array', items: { type: 'object' } }, restore: { type: 'integer', minimum: 1 }, carry: { type: 'object' }, stepMap: { type: 'object' }, expected_effect: { type: 'string', description: 'Optional: what you expect this change to do.' } }, required: [] as string[] };
}

/** Provider-visible JSON schema generated from the one descriptor. The Agent's own mode exit schema
 * (part of its writable policy) is exposed as an optional result object when it declares more than reason. */
export function providerOperationSchema(kind: OperationKind, modeExitSchema?: any) {
  const contract = operationContract(kind);
  const properties: any = structuredClone(contract.properties);
  const own = modeExitSchema?.properties ? Object.keys(modeExitSchema.properties).filter(k => k !== 'reason') : [];
  if ((kind === 'evolution' || kind === 'delivery') && own.length) properties.result = structuredClone(modeExitSchema);
  return { type: 'object', properties, required: [...contract.required], additionalProperties: false };
}

/** Dispatch-side check against exactly the provider-visible schema plus the stated conditional semantics. */
export function normalizeOperation(kind: OperationKind, args: any, modeExitSchema?: any) {
  const schema = providerOperationSchema(kind, modeExitSchema);
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const unknown = Object.keys(a).filter(k => a[k] !== undefined && !(k in schema.properties));
  if (unknown.length) throw Error(`${operationContract(kind).name}: unknown field(s) ${unknown.join(', ')}; visible fields: ${Object.keys(schema.properties).join(', ')}`);
  for (const key of schema.required) if (a[key] === undefined || a[key] === '') throw Error(`${operationContract(kind).name}: ${key} is required`);
  for (const [key, spec] of Object.entries<any>(schema.properties)) {
    const v = a[key]; if (v === undefined) continue;
    const ok = spec.type === 'string' ? typeof v === 'string' : spec.type === 'integer' ? Number.isSafeInteger(v) && v >= (spec.minimum ?? -Infinity)
      : spec.type === 'array' ? Array.isArray(v) : spec.type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : true;
    if (!ok || (spec.enum && !spec.enum.includes(v))) throw Error(`${operationContract(kind).name}: invalid ${key}${spec.enum ? `; one of ${spec.enum.join(', ')}` : ''}`);
  }
  if (kind === 'component' && a.op !== 'restore' && typeof a.source !== 'string') throw Error('reflect_component: define/redefine needs source');
  if (kind === 'component' && a.op === 'restore' && a.version === undefined) throw Error('reflect_component: restore needs version');
  if (kind === 'orchestration' && !['orchestration', 'policy', 'components', 'restore'].some(k => a[k] !== undefined)) throw Error('reflect_orchestration: include orchestration, policy, components or restore');
  return Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
}

const isMetric = (m: any) => !!m && typeof m.name === 'string' && typeof m.unit === 'string' && Number.isFinite(m.value);

export function seedPolicy(capabilities: string[], reviewTools: string[] = ['read', 'ls', 'grep']): Policy {
  const exitSchema = { type: 'object', properties: { reason: { type: 'string' } }, required: [] };
  const observe = reviewTools.filter(t => capabilities.includes(t));
  return { request: { maxOutputTokens: 8192 }, modes: {
    execute: { tools: capabilities, instruction: 'Continue the current task.', exitSchema },
    reflect: { tools: observe, instruction: 'Review the pinned self/evidence. You choose scope, method and whether to change anything. Close with decide_exit.', exitSchema },
    consolidate: { tools: observe, instruction: 'Organize this task\'s evidence and bounded inheritance records if useful; no automatic cross-task defaults.', exitSchema },
  }, routes: [], methods: {}, memory: { names: '*', order: 'name', write: 'replace' },
  context: { order: ['prompts', 'memory', 'skills'], instruction: '', reasoning: 'latest' } };
}

export function validateContract(c: SelfContract) {
  if (!c || c.source !== 'user_contract' || !c.authority || !c.decisions || !c.readonly_reason) throw Error('explicit user contract not loaded');
  const { content_hash, ...body } = c;
  if (content_hash !== hash(body)) throw Error('user contract hash mismatch');
  if (hash([...c.boundaries].sort()) !== hash([...FLOOR].sort()) || c.inherit_defaults !== false || !isValidHeartbeat(c.heartbeat)) throw Error('v1 contract floor/heartbeat/inheritance mismatch');
  for (const key of ['requests', 'tokens', 'seconds', 'usd', 'storage_bytes']) if (!Number.isFinite(c.budget[key]) || c.budget[key] <= 0) throw Error(`missing numeric budget ${key}`);
  if (!Array.isArray(c.capabilities) || !Array.isArray(c.writable) || !c.acceptance) throw Error('contract capabilities/acceptance required');
}

function validatePolicy(p: Policy, c: SelfContract, outputLimit = Number.MAX_SAFE_INTEGER) {
  if (!p || Object.keys(p).some(k => !['modes','routes','methods','memory','context','request'].includes(k))) throw Error('unknown policy field');
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
  if (!p.memory || (p.memory.names !== '*' && (!Array.isArray(p.memory.names) || p.memory.names.some(n => typeof n !== 'string'))) || !['name','newest'].includes(p.memory.order) || !['replace','append'].includes(p.memory.write)) throw Error('invalid memory policy');
  if (!p.context || typeof p.context.instruction !== 'string' || !Array.isArray(p.context.order) || p.context.order.some(x => !['prompts','memory','skills'].includes(x)) || new Set(p.context.order).size !== p.context.order.length) throw Error('invalid context policy');
  if (p.context.reasoning !== undefined && !['all','latest','none'].includes(p.context.reasoning)) throw Error('invalid reasoning context policy');
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
  private heartbeatDue: number[] = [];
  private conditionSet: any = copy(INITIAL_CONDITIONS);
  private settlementCount = 0;
  private lastSettlementReview?: string;
  private daemonRecord?: any;
  private rootValidator?: Validator;
  private readonly outputLimit: number;
  private readonly options: SelfRootOptions;
  private taskEnded?: string;
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
      for (const key of ['serial','request','ledger','lineage','definitions','windows','queue','currentMode','review','started','units','tokens','usd','paused','previousMode','activeReset','heartbeatDue','conditionSet','settlementCount','lastSettlementReview','taskEnded'] as const) if (r[key] !== undefined) (this as any)[key] = copy(r[key]);
      this.consumed = new Set(r.consumed); this.providerCosts = new Set(r.providerCosts);
      if (r.daemonRecord) this.daemonRecord = copy(r.daemonRecord);
      if (r.contract_hash !== contract.content_hash) throw Error('saved root contract differs');
      if (r.pending) this.fact('transaction_interrupted', { status: 'aborted', reason: 'uncommitted candidate on process restart', review: r.pending.review ?? null });
      // A review already closed while its activation was pending: the activation never happened; record that once.
      if (r.pending?.review && (!this.review || this.review.id !== r.pending.review)) this.fact('review_activation_interrupted', { review: r.pending.review, status: 'deferred', subtype: 'incomplete', reason: 'process restart before activation' });
      if (r.resetInProgress) this.fact('active_reset_failed',{id:r.resetInProgress,error:'process restart during reset; completion unknown'});
      if (this.review) this.closeMechanically('crash/recovery');
      this.fact('coverage_gap', { pre_review: false, reason: 'process restart; unknown forced termination/compaction' });
    }
    if (!this.definitions.length) this.definitions.push(this.definition());
  }
  override get revision() { return this.serial; }
  get mode() { return this.currentMode; }
  get reviewExitSchema() { return this.review ? copy(this.review.modeDefinition.exitSchema) : undefined; }
  /** The provider-visible exit operation for the current review, from the one descriptor. */
  get exitOperationKind(): 'evolution' | 'delivery' | undefined { return this.review ? (this.inEvolutionReview ? 'evolution' : 'delivery') : undefined; }
  get exitOperationSchema() { const kind = this.exitOperationKind; return kind ? providerOperationSchema(kind, this.review.modeDefinition.exitSchema) : undefined; }
  get dueWindows() { return this.windows.filter(w => ['due_unverified', 'due_comparable'].includes(w.status)).map(w => w.id); }
  get hasReview() { return Boolean(this.review || this.queue.length); }
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
      heartbeatDue: this.heartbeatDue, daemonRecord: this.daemonRecord ?? null,
      conditionSet: this.conditionSet, settlementCount: this.settlementCount, lastSettlementReview: this.lastSettlementReview,
      taskEnded: this.taskEnded ?? null,
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
    if (section === 'self') return { ...this.mirror(), ledger: this.read(offset, count), conditions: { settlement_count: this.settlementCount, conditions: copy(this.conditionSet), published_steps: copy(FLOOR_STEPS) } };
    if (section === 'ledger') return this.read(offset, count);
    if (section === 'policy') return copy(this.policy);
    if (section === 'contract') return copy(this.contract);
    if (section === 'definition') return copy(this.definitions.find(d => d.revision === offset));
    if (section === 'lineage') return { rows: copy(this.lineage.slice(offset, offset + count)), total: this.lineage.length };
    if (section === 'windows') return copy(this.windows);
    if (section === 'continuity') return { current: super.snapshot(), review: copy(this.review ?? null), requestPin: copy(this.requestPin ?? null) };
    if (section === 'conditions') return { settlement_count: this.settlementCount, conditions: copy(this.conditionSet), published_steps: copy(FLOOR_STEPS) };
    throw Error('unknown self section');
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
  transaction(input: { baseRevision?: number; components?: any[]; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; expected_effect?: string }) {
    const result = this.mutations.then(() => this.prepareTransaction(input));
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  abortTransaction(error: unknown) {
    this.pending = undefined; this.pendingReview = undefined;
    if (!this.chainFailed) this.fact('transaction_failed',{error:String(error),status:'entire response chain aborted'});
    this.chainFailed = true;
  }
  private async prepareTransaction(input: { baseRevision?: number; components?: any[]; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; expected_effect?: string }) {
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
        if (c.kind === 'subagent') throw Error('v1 has one agent; task subagents deferred');
        if (c.kind === 'tool' && (PROTOCOL.includes(c.name) || this.contract.capabilities.includes(c.name) || (this.options.reservedToolNames ?? []).includes(c.name))) throw Error('tool name collides with protected protocol or host capability');
        const value = { ...c, source: c.source, baseRevision: candidate.revision };
        if (c.kind === 'memory' && c.op === 'redefine' && policy.memory.write === 'append') value.source = `${candidate.active().find(x => x.kind === 'memory' && x.name === c.name)?.source ?? ''}\n${c.source}`;
        await candidate.reflectComponent(value); addresses.push(`components.${c.kind}.${c.name}`);
      }
      if (input.orchestration !== undefined || input.restore !== undefined) {
        this.assertWrite('orchestration');
        if (input.restore !== undefined && input.orchestration === undefined) { await candidate.reflectOrchestration({ baseRevision:candidate.revision, restore:input.restore, authorized:true }); addresses.push('orchestration'); }
        if (input.orchestration !== undefined) {
          if (input.orchestration.roles?.length !== 1 || input.orchestration.roles[0].id !== 'agent') throw Error('v1 roles must be only agent');
          await candidate.reflectOrchestration({ baseRevision: candidate.revision, orchestration: input.orchestration, authorized: true, carry: input.carry, stepMap: input.stepMap }); addresses.push('orchestration');
        }
      }
      if (input.policy !== undefined) { this.assertWrite('policy'); validatePolicy(input.policy, this.contract, this.outputLimit); policy = copy(input.policy); addresses.push('policy'); }
      if (!addresses.length) throw Error('empty transaction');
      const evolution = this.inEvolutionReview;
      if (this.chainFailed) throw Error('response chain failed while candidate was being validated');
      const revision = this.pendingRevision + 1;
      this.pendingReview = this.review?.id ?? this.pendingReview;
      this.pending = { candidate, policy, revision, addresses: [...(this.pending?.addresses ?? []), ...addresses], windows: [...(this.pending?.windows ?? []), ...(evolution && addresses.length ? [{ addresses, expected_effect: input.expected_effect, review: this.review?.id ?? null }] : [])], source: input.restore,
        baseStateHash: this.pending?.baseStateHash ?? hash(this.baseSaved().snapshot) };
      return this.fact('reflection_pending', { revision, addresses, activation: 'before next provider request', review: this.review?.id ?? null }).value;
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
      ? (this.options.evolutionTools ?? ['read', 'ls', 'grep']) : this.review?.modeDefinition.tools ?? this.policy.modes[this.currentMode].tools;
    return [...new Set([...PROTOCOL, ...tools.filter((t: string) => t !== 'agent_tools' && this.contract.capabilities.includes(t)),
      ...(tools.includes('agent_tools') && this.contract.capabilities.includes('agent_tools') ? this.active().filter(c => c.kind === 'tool').map(c => c.name) : [])])];
  }
  allowTool(name: string, args: any) { this.assertActionAllowed(this.options.actionOf ? this.options.actionOf(name, args) : name); }
  get inEvolutionReview() { return Boolean(this.review?.triggers.some((t: any) => t.id === 'evolution_review')); }
  get settlementReviewRef() { return this.lastSettlementReview; }
  get inCapabilityReview() { return this.inEvolutionReview; }
  get capabilityReviewClosed() { return this.ledger.some(r => r.type === 'review_closed' && r.value?.occasion === 'evolution_review' && r.value?.agent_decision === 'present'); }
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
      if (this.pendingReview && !this.review) this.fact('review_activation_interrupted', { review: this.pendingReview, status: 'deferred', subtype: 'incomplete', reason: 'activation failed' });
      this.pendingReview = undefined;
      return;
    }
    const windowCount = this.windows.length, definitionCount = this.definitions.length, lineageCount = this.lineage.length;
    this.fact('transaction_intent', { from: this.serial, to: p.revision, addresses: p.addresses }); persist();
    try {
      // Private base-class fields are own properties; keep this root's identity and META state.
      Object.assign(this, p.candidate); this.onReflection = onReflection; this.policy = p.policy; this.serial = p.revision;
      this.onReflection?.({ kind: 'orchestration', revision: this.serial });
      applySurface(this.surface());
      this.pending = undefined;
      const activated = this.fact('reflection_activated', { parent: oldSerial, revision: this.serial, addresses: p.addresses, restore_source: p.source ?? null, review: this.review?.id ?? this.pendingReview ?? null });
      for (const w of p.windows) if (w) this.createWindow(oldSerial, activated.ref, w.addresses ?? p.addresses, w.expected_effect, w.review ?? null);
      this.definitions.push(this.definition());
      this.lineage.push(activated);
      this.applyConditionAddenda();
      if (this.review) this.review.changes.push(activated.ref);
      else if (this.pendingReview) this.fact('review_activation_closed', { review: this.pendingReview, activation: activated.ref, status: 'changed', subtype: 'unverified',
        windows: this.windows.filter(w => w.activation === activated.ref).map(w => w.id) });
      if (p.source !== undefined) for (const w of this.windows) if (w.status === 'restore_pending') { w.status = 'restored'; this.fact('validation_enacted',{ window:w.id, revision:this.serial, restore_source:p.source }); }
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
  /** Host-made window (art. 5-1): fixed baseline rule, no Agent bookkeeping fields. */
  private createWindow(parent: number, activation: string, addresses: string[], expected_effect: string | undefined, review: string | null) {
    const boundary = this.ledger.findLast(r => r.type === 'event' && ['unit_completed', 'settlement'].includes(r.value?.type) && !r.value?.duplicate);
    const cut = boundary ? Number(boundary.ref.slice(7)) : -1;
    const baseline = this.ledger.filter((r, i) => i <= cut && r.kind === 'fact' && ['task_outcome', 'request_cost'].includes(r.type)).map(r => r.ref);
    const metric_refs = this.ledger.filter((r, i) => i <= cut && r.kind === 'fact' && r.type === 'task_outcome' && isMetric(r.value?.metric)).map(r => r.ref);
    const window: Window = { id: `window:${this.windows.length}`, revision: this.serial, parent, review, activation, baseline, metric_refs, scope: [...addresses],
      due: { settlement: this.settlementCount + 1, after_use: true, rule: WINDOW_RULES.due }, ...(expected_effect ? { expected_effect } : {}),
      effect_status: expected_effect ? 'specified' : 'effect_unspecified', later_use_refs: [], status: 'open',
      unknowns: [...(boundary ? [] : ['settled_baseline']), ...(metric_refs.length ? [] : ['repeatable_numeric_metric']), ...(expected_effect ? [] : ['expected_effect']), 'later_use'] };
    this.windows.push(window);
    this.fact('window_created', { window: window.id, revision: window.revision, parent, activation, baseline_rule: WINDOW_RULES.baseline, baseline_count: baseline.length,
      metric_refs, due: window.due, effect_status: window.effect_status, unknowns: window.unknowns });
    return window;
  }
  /** Mechanical later-use facts for a window (no semantic inference). */
  private laterUse(w: Window) {
    const start = this.ledger.findIndex(r => r.ref === w.activation);
    const tools = new Set(w.scope.filter(a => a.startsWith('components.tool.')).map(a => a.slice('components.tool.'.length)));
    return this.ledger.filter((r, i) => i > start && r.kind === 'fact' && (
      (r.type === 'provider_input' && r.value?.pin?.mode === 'execute' && Number(r.value?.pin?.revision) >= w.revision) ||
      (r.type === 'tool_result' && tools.has(r.value?.tool)) || (r.type === 'component_consumed' && r.revision >= w.revision))).map(r => r.ref);
  }
  private deliverWindow(w: Window, reason: string) {
    const start = this.ledger.findIndex(r => r.ref === w.activation);
    w.later_use_refs = this.laterUse(w);
    const outcomes = this.ledger.filter((r, i) => i > start && r.kind === 'fact' && r.type === 'task_outcome');
    const metric = (rows: Row[]) => rows.map(r => r.value?.metric).filter(isMetric);
    const before = metric(w.metric_refs.map(ref => this.ledger.find(r => r.ref === ref)!).filter(Boolean)), after = metric(outcomes);
    const comparisons = before.flatMap(b => after.filter(a => a.name === b.name && a.unit === b.unit).slice(-1)
      .map(a => ({ name: b.name, unit: b.unit, baseline: b.value, observed: a.value, difference: a.value - b.value })));
    const missing = [...(w.later_use_refs.length ? [] : ['later_use']), ...(outcomes.length ? [] : ['task_outcomes']),
      ...(w.baseline.length ? [] : ['task_baseline']), ...(w.expected_effect ? [] : ['expected_effect']), ...(comparisons.length ? [] : ['repeatable_numeric_metric'])];
    const verification = missing.length ? 'unverified' : 'comparable';
    w.status = verification === 'comparable' ? 'due_comparable' : 'due_unverified';
    w.delivered = { reason, outcomes: outcomes.map(r => r.ref), baseline: w.baseline, metric_comparisons: comparisons, later_use: w.later_use_refs.length > 0,
      later_use_refs: w.later_use_refs.slice(-20), missing, verification, resources: this.resources(), restore_default: w.parent };
    return this.fact('validation_delivered', { window: w.id, ...w.delivered });
  }
  async boundary(applySurface: (tools: string[]) => void, persist: () => void) {
    if (this.paused) throw Error('inconsistent/paused');
    this.activatePending(applySurface, persist);
    this.chainFailed = false;
    await this.emitDueHeartbeats();
    await this.event('request_boundary',`request:${this.request}`);
    if (!this.review && this.queue.length) this.enter(this.queue.shift());
    this.lastSurface = this.surface(); applySurface(this.lastSurface);
  }
  /** End of a model response/run (Pi agent_end): resolve a pending activation first, then one mechanical closure. */
  endResponse(applySurface: (tools: string[]) => void, persist: () => void, reason: string) {
    if (!this.paused) this.activatePending(applySurface, persist);
    this.closeMechanically(reason);
  }
  /** Task end (delivery completed or budget stop): open windows become due_unverified; no further review is queued. */
  taskEnd(reason: string) {
    if (this.taskEnded) return { duplicate: true };
    this.taskEnded = reason;
    const delivered = this.windows.filter(w => w.status === 'open').map(w => this.deliverWindow(w, `task end: ${reason}`).ref);
    this.fact('task_ended', { reason, windows_delivered: delivered });
    return { delivered };
  }
  async event(type: string, boundary: string, facts: unknown = {}) {
    const key = `${type}:${boundary}`;
    const duplicate = this.consumed.has(key);
    const settles = !duplicate && ['unit_completed', 'settlement'].includes(type);
    if (settles) this.settlementCount++;
    if (duplicate) return { duplicate: true };
    this.consumed.add(key);
    const event = this.fact('event', { type, boundary, facts });
    const input = { event, revision: this.serial, state: super.snapshot(), ledger_offset: this.ledger.length, request: this.request, resources: this.resources() };
    const routes = type === 'heartbeat' ? [] : [...this.policy.routes].filter(r => r.event === type).sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const triggers: any[] = [];
    if (this.contract.boundaries.includes(type) && !(settles && this.taskEnded)) triggers.push({ id: `contract:${type}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });
    if (settles && !this.taskEnded) {
      const classes = Array.isArray((facts as any)?.event_classes) ? (facts as any).event_classes : [];
      const tags = Array.isArray((facts as any)?.coverage_tags) ? (facts as any).coverage_tags : [];
      const prior = this.conditionSet.floor;
      this.conditionSet.floor = { ...prior, event_classes: [...new Set([...prior.event_classes, ...classes])], coverage_tags: [...new Set([...prior.coverage_tags, ...tags])] };
      triggers.push({ id: 'evolution_review', source: 'settlement_clock', mode: 'reflect', conclusion_sink: 'ledger' });
    }
    if (type === 'heartbeat' && heartbeatInterval(this.contract.heartbeat)) {
      triggers.push({ id: `contract:${boundary}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });
    }
    for (const route of routes) {
      try {
        if (route.predicate && (await this.evaluate(this.policy.methods[route.predicate], input, { route: route.id })).value !== true) continue;
        triggers.push({ ...route, source: 'agent_method' });
      } catch (e) { this.fact('watch_stall', { route: route.id, error: String(e), triggered: false }); }
    }
    if (settles) {
      // A window is due at the first settlement after activation once later use was observed (fixed rule).
      for (const w of this.windows.filter(w => w.status === 'open' && this.settlementCount >= w.due.settlement)) {
        w.later_use_refs = this.laterUse(w);
        if (!w.later_use_refs.length) continue;
        this.deliverWindow(w, `settlement ${this.settlementCount}`);
        triggers.push({ id: w.id, source: 'validation_due', mode: 'reflect', conclusion_sink: 'ledger' });
      }
      const comparisons = this.ledger.filter(r => r.type === 'validation_delivered' && r.value?.verification === 'comparable');
      const hasLaterUse = this.windows.some(w => w.later_use_refs.length > 0);
      const prior = this.conditionSet.floor;
      const step = Math.max(prior.step, comparisons.length ? 3 : hasLaterUse ? 2 : 1);
      this.conditionSet.floor = { step, evidence: [...new Set([...prior.evidence, ...FLOOR_STEPS.slice(0, step).flatMap(s => s.evidence_scope)])],
        event_classes: [...this.conditionSet.floor.event_classes], coverage_tags: [...this.conditionSet.floor.coverage_tags] };
      const row = this.ledger.find(r => r.ref === event.ref)!;
      row.value.facts = { ...(row.value.facts ?? {}), settlement: this.settlementCount, comparison_refs: comparisons.map(r => r.ref),
        due_windows: this.dueWindows, conditions: copy(this.conditionSet) };
      this.lastSettlementReview = event.ref;
    }
    if (triggers.length) {
      const existing = this.queue.find(t => t.boundary === boundary);
      if (existing) existing.triggers.push(...triggers);
      else this.queue.push({ id: `review:${event.ref}`, boundary, event: event.ref, triggers, revision: this.serial, ledger_offset: this.ledger.length });
    }
    return { event: event.ref, triggers };
  }
  private enter(ticket: any) {
    this.previousMode = this.currentMode; this.currentMode = ticket.triggers[0].mode;
    this.review = { ...ticket, mode: this.currentMode, modeDefinition: copy(this.policy.modes[this.currentMode]), policy: copy(this.policy),
      suspended: { step: this.step, revision: this.serial }, changes: [], request_entered: this.request, snapshot: this.baseSaved(), windows: this.dueWindows };
    this.fact('mode_entered', { id: ticket.id, mode: this.currentMode, triggers: ticket.triggers, suspended: this.review.suspended });
  }
  enterMode(mode: string) {
    if (!this.policy.modes[mode] || this.review) throw Error('mode unavailable or mode already active');
    const ref = this.claim('enter_mode', { mode });
    this.enter({ id: `review:${ref.ref}`, event: ref.ref, revision: this.serial, ledger_offset: this.ledger.length, triggers: [{ id: ref.ref, source: 'agent_active', mode, conclusion_sink: 'ledger' }] });
    return { pending_mode: mode, activation: 'next request boundary' };
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
  /** decide_exit. Host derives status/subtype/refs/windows; at most one invalid expression, then mechanical close. */
  exit(input: { status?: string; reason?: string; result?: any; evidenceRefs?: string[] }) {
    if (!this.review) throw Error('no active review');
    const review = this.review, evolution = this.inEvolutionReview;
    const allowed = evolution ? ['deferred', 'unrelated'] : ['deferred', 'unrelated', 'keep'];
    const reason = input.reason ?? input.result?.reason;
    const result = input.result ?? (reason !== undefined ? { reason } : {});
    let invalid: string | undefined;
    if (input.status !== undefined && input.status !== 'changed' && !allowed.includes(input.status)) invalid = `status must be omitted or one of ${allowed.join(', ')}`;
    else if ((input.evidenceRefs ?? []).some(ref => !this.ledger.some(r => r.ref === ref))) invalid = 'unknown evidence ref';
    else { try { validateSchema(result, review.modeDefinition.exitSchema); } catch (e) { invalid = `result does not match your mode exit schema: ${String(e)}`; } }
    if (invalid) {
      review.invalid_exits = (review.invalid_exits ?? 0) + 1;
      if (review.invalid_exits === 1) {
        this.fact('exit_normalization', { review: review.id, error: invalid, next: 'a second invalid exit closes this review mechanically' });
        throw Error(`${invalid}; a second invalid exit closes this review as deferred/incomplete`);
      }
      return this.closeMechanically('second invalid exit expression', { attempted: { status: input.status ?? null, reason: reason ?? null }, error: invalid });
    }
    const activated = review.changes.length > 0 || Boolean(this.pending);
    let status: string, subtype: string;
    const notes: string[] = [];
    if (activated) {
      status = 'changed'; subtype = 'unverified';
      if (input.status && input.status !== 'changed') notes.push(`Agent status ${input.status} conflicts with an activated reflection; recorded as changed/unverified`);
    } else if (input.status === 'changed') { status = 'deferred'; subtype = 'incomplete'; notes.push('changed without an activated reflection'); }
    else if (input.status === undefined) { status = 'deferred'; subtype = 'incomplete'; }
    else if (input.status === 'unrelated' && !reason) { status = 'deferred'; subtype = 'incomplete'; notes.push('unrelated without a reason'); }
    else if (input.status === 'keep') { status = 'keep'; subtype = 'task_keep'; }
    else if (input.status === 'deferred') { status = 'deferred'; subtype = 'agent_deferred'; }
    else { status = 'unrelated'; subtype = 'agent_unrelated'; }
    const pinned = this.ledger.find(r => r.ref === review.event)?.value?.facts?.evidenceRefs;
    const evidenceRefs = [...new Set([review.event, ...(Array.isArray(pinned) ? pinned : []), ...(input.evidenceRefs ?? [])].filter(Boolean))];
    const windows = this.windows.filter(w => w.review === review.id).map(w => ({ id: w.id, due: w.due, effect_status: w.effect_status, unknowns: w.unknowns }));
    const row = this.claim('review_closed', { review: review.id, occasion: evolution ? 'evolution_review' : null, status, subtype, result, notes,
      evidenceRefs, changes: review.changes, windows, agent_decision: 'present', mode_version: review.revision, pending: Boolean(this.pending) });
    if (this.pending) this.fact('review_pending', { review: review.id, closure: row.ref, status: 'changed_pending_activation' });
    if (review.triggers.some((t: any) => t.conclusion_sink === 'lineage')) this.lineage.push(row);
    this.review = undefined; this.currentMode = this.previousMode;
    return { recorded: row.ref, status, subtype, notes, windows, activated: review.changes, pending_activation: this.pending ? 'next request boundary' : null, resume: this.step, mode: this.currentMode };
  }
  /** One mechanical closure (agent_end, crash, budget, second invalid exit). Never invents an Agent decision. */
  closeMechanically(reason: string, extra: any = {}) {
    if (!this.review) return undefined;
    const review = this.review, changed = review.changes.length > 0;
    const row = this.fact('review_closed', { review: review.id, occasion: this.inEvolutionReview ? 'evolution_review' : null,
      status: changed ? 'changed' : 'deferred', subtype: changed ? 'unverified' : 'incomplete', agent_decision: 'absent', reason, changes: review.changes,
      windows: this.windows.filter(w => w.review === review.id).map(w => w.id), pending: Boolean(this.pending), ...extra });
    this.review = undefined; this.currentMode = this.previousMode;
    return { recorded: row.ref, status: row.value.status, subtype: row.value.subtype, mode: this.currentMode, reason };
  }
  closeIncomplete(reason: string) { return this.closeMechanically(reason); }
  /** decide_validation. Only the Agent adopts/restores/defers; unknown evidence stays unverified. */
  async interpret(id: string | undefined, decision: 'adopt'|'restore'|'defer', explanation: any, restore?: number) {
    const reason = typeof explanation === 'string' ? explanation : explanation?.reason;
    if (!['adopt','restore','defer'].includes(decision)) throw Error('decision must be adopt, restore or defer');
    if (!reason) throw Error('reason is required: your interpretation of the delivered facts');
    const due = this.windows.filter(w => ['due_unverified', 'due_comparable'].includes(w.status));
    if (id === undefined && due.length > 1) throw Error(`several windows are due; choose window from ${due.map(w => w.id).join(', ')}`);
    const w = id === undefined ? due[0] : this.windows.find(x => x.id === id);
    if (!w || !due.includes(w)) {
      // Before later use there is nothing to interpret: record the attempt and return to work, no rejection loop.
      const row = this.claim('validation_incomplete', { window: id ?? null, decision, reason, open: this.windows.filter(x => x.status === 'open').map(x => x.id),
        cause: w ? `window is ${w.status}; it becomes due after later use at a settlement boundary` : 'no window is due' });
      return { recorded: row.ref, status: 'incomplete', cause: row.value.cause };
    }
    const target = decision === 'restore' ? (restore ?? w.parent) : undefined;
    if (decision === 'restore') await this.transaction({ baseRevision: this.pendingRevision, restore: target });
    const verified = w.delivered?.verification === 'comparable';
    const row = this.claim('validation_interpreted', { window: w.id, decision, reason, restore: target ?? null, verification: w.delivered?.verification ?? 'unverified', delivered: w.delivered });
    w.status = decision === 'restore' ? 'restore_pending' : decision === 'adopt' ? (verified ? 'adopted' : 'adopted_unverified') : 'deferred_unverified';
    return { recorded: row.ref, window: w.id, status: w.status, restore: target ?? null };
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
    if (!['candidate','task_adopted','inactive'].includes(value.status)) throw Error('cross-task default inheritance disabled');
    if (!this.definitions.some(d => d.revision === value.snapshot)) throw Error('unknown inheritance snapshot');
    for (const ref of value.evidence_refs) if (!this.ledger.some(r => r.ref === ref)) throw Error('unknown inheritance evidence');
    const row = this.claim('inheritance', { ...value, auto_inherit: false, root_id: this.root_id }); this.lineage.push(row); return row;
  }
  outcome(value: any, delivered = false) { const row = this.fact('task_outcome', value); if (delivered) this.units++; return row; }
  adoptDaemonResources(record: any) { this.daemonRecord = copy(record); }
  private isProbeKind(kind?: string) { return PROBE_KINDS.has(kind ?? ''); }
  settledTaskRequests() {
    return this.ledger.filter(r => r.type === 'request_cost' && !this.isProbeKind(r.value?.kind)).length;
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
    const costs = this.ledger.filter(r => r.type === 'request_cost');
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
      heartbeat_gaps: this.ledger.filter(r => r.type === 'heartbeat_gap').map(r => copy(r.value)),
    };
  }
  resources() {
    const record = this.daemonRecord ?? this.resourceRecord();
    return { request: this.request, tokens: this.tokens, usd_estimate: this.usd, elapsed_seconds: (Date.now() - this.started)/1000, storage_bytes: this.storageBytes, units: this.units, cap: this.contract.budget, record };
  }
  private queueHeartbeatIfDue() {
    const interval = heartbeatInterval(this.contract.heartbeat);
    if (!interval) return;
    const settled = this.settledTaskRequests();
    if (settled > 0 && settled % interval === 0 && !this.heartbeatDue.includes(settled)) this.heartbeatDue.push(settled);
  }
  private async emitDueHeartbeats() {
    const interval = heartbeatInterval(this.contract.heartbeat);
    if (!interval) { this.heartbeatDue = []; return; }
    const due = [...this.heartbeatDue];
    this.heartbeatDue = [];
    for (const settled of due) {
      const boundary = `heartbeat:settled:${settled}`;
      if (this.request >= this.contract.budget.requests) {
        if (!this.consumed.has(`heartbeat:${boundary}`)) {
          this.consumed.add(`heartbeat:${boundary}`);
          this.fact('heartbeat_gap', { settled_task_requests: settled, reason: 'hard cap; heartbeat not dispatched', source: 'user_contract' });
        }
        continue;
      }
      await this.event('heartbeat', boundary, { settled_task_requests: settled, source: 'user_contract' });
    }
  }
  guard(storageBytes?: number) {
    if (storageBytes !== undefined) this.storageBytes = storageBytes;
    const b = this.contract.budget;
    if (this.request >= b.requests || this.tokens >= b.tokens || this.usd >= b.usd || (Date.now()-this.started)/1000 >= b.seconds || this.storageBytes >= b.storage_bytes) {
      this.closeMechanically('hard budget'); this.fact('budget_stop', this.resources()); this.taskEnd('budget stop'); throw Error('authorized budget exhausted');
    }
  }
  pin(kind = 'task') {
    this.guard(); this.request++;
    this.requestPin = { request: this.request, revision: this.serial, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, ledger_offset: this.ledger.length, step: this.step, kind };
    this.executionGrant = [...this.lastSurface];
    return copy(this.requestPin);
  }
  cost(usage: any, duration_ms: number, usd: number, known: boolean, unknownTokens = 12000) {
    if (this.providerCosts.has(this.request)) throw Error('request cost already counted');
    this.providerCosts.add(this.request);
    const tokens = known ? ['input','output','cacheRead','cacheWrite'].reduce((n,k) => n + Number(usage[k] ?? 0), 0) : unknownTokens;
    this.tokens += tokens; this.usd += usd;
    const row = this.fact('request_cost', { pin: this.requestPin, kind: this.requestPin?.kind ?? 'task', usage: known ? usage : null, tokens, duration_ms, usd_estimate: usd, cost_source: 'provider usage + manifest rates; actual invoice unknown', status: known ? 'reported' : 'unknown_reserved' });
    this.queueHeartbeatIfDue();
    return row;
  }
  memory() {
    let memories = this.active().filter(c => c.kind === 'memory' && (this.policy.memory.names === '*' || this.policy.memory.names.includes(c.name)));
    memories.sort(this.policy.memory.order === 'newest' ? (a,b) => b.version-a.version || a.name.localeCompare(b.name) : (a,b) => a.name.localeCompare(b.name));
    return memories;
  }
  /** Select only the reasoning channel; task text, tools, images and call IDs stay intact. */
  contextMessages(messages: any[]) {
    const selection = this.policy.context.reasoning ?? 'all';
    const latest = messages.findLastIndex(m => m.role === 'assistant');
    return messages.map((m,i) => m.role !== 'assistant' || selection === 'all' || (selection === 'latest' && i === latest) ? m :
      { ...m, content: Array.isArray(m.content) ? m.content.filter((part: any) => part.type !== 'thinking') : m.content });
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
    const reviewEvidence = this.review && this.ledger.find(r => r.ref === this.review.event && r.type === 'event' && ['before_delivery','settlement','unit_completed'].includes(r.value.type))?.value.facts;
    return { root_id: this.root_id, revision: this.serial, architecture: active.architecture, ledger: this.read(0, 40), parts: {
      components: { relation: 'executes from this root', writable_kinds: this.contract.writable.filter(x => x.startsWith('components.')) },
      orchestration: { relation: 'controls active step and trusted receipts', writable: this.contract.writable.includes('orchestration') },
      policy: { relation: 'controls modes, META, memory retrieval/write, request envelope and actual context assembly', request: this.policy.request,
        version: hash(this.policy), writable: this.contract.writable.includes('policy'), expand: 'read_self(section="policy")' },
      protected: { reason: this.contract.readonly_reason, contract_hash: this.contract.content_hash, boundaries: this.contract.boundaries, budget: this.contract.budget, capabilities: this.contract.capabilities, acceptance: this.contract.acceptance },
      unsupported: ['provider replacement', 'task subagents', 'cross-task default promotion', 'interactive world replay'],
    }, dynamic: { run: active.run, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, settlement_count: this.settlementCount, conditions: copy(this.conditionSet), review: this.review ? { id: this.review.id, kind: this.exitOperationKind, triggers: this.review.triggers, pinned_ledger_offset: this.review.ledger_offset, suspended: this.review.suspended, exit_operation: this.exitOperationSchema, due_windows: this.dueWindows } : null,
      ...(reviewEvidence ? { review_evidence: copy(reviewEvidence) } : {}),
      instruction: this.review?.modeDefinition.instruction ?? this.policy.modes[this.currentMode].instruction,
      request_pin: this.requestPin, resources: this.resources(), pending: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses } : null,
      queue: this.queue.map(t => t.id), windows: this.windows.filter(w => ['open','due_unverified','due_comparable','restore_pending'].includes(w.status)), window_rules: WINDOW_RULES, task_ended: this.taskEnded ?? null,
      evidence: { total: this.ledger.length, capsules: this.ledger.filter(r => r.type === 'capsule').map(r => r.ref), read: 'read_self' },
      lineage: { count: this.lineage.length, expand: 'read_self(section="lineage")' } } };
  }
}
