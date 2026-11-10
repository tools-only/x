/** Same executing LiveAgentSelf; META contains no attribution or adoption policy. */
import { createHash, randomUUID } from 'node:crypto';
import { LiveAgentSelf, validateSchema, validateSchemaStructure } from './live_orchestration_core.ts';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';
import type { Validator } from './agent_component_model.ts';

export const copy = <T>(x: T): T => structuredClone(x);
export const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const FLOOR = ['window_entry', 'before_delivery', 'before_active_reset', 'before_batch_switch', 'before_session_end'];
export const PROTOCOL = ['read_self', 'read_self_component', 'reflect_component', 'reflect_orchestration', 'decide'];
type Mode = { tools: string[]; instruction: string; projection?: string; exitSchema: any };
type Route = { id: string; event: string; predicate?: string; projection?: string; mode: string; priority: number; conclusion_sink: 'ledger' | 'lineage' };
export type Policy = {
  request?: { maxOutputTokens: number };
  modes: Record<string, Mode>; routes: Route[];
  methods: Record<string, string>;
  memory: { names: string[] | '*'; order: 'name' | 'newest'; write: 'replace' | 'append' };
  context: { order: Array<'prompts' | 'memory' | 'skills'>; instruction: string };
};
export type SelfContract = {
  source: 'user_contract'; authority: string; decisions: string; content_hash: string; readonly_reason: string;
  boundaries: string[]; capabilities: string[]; writable: string[];
  budget: { requests: number; tokens: number; seconds: number; usd: number; storage_bytes: number };
  acceptance: unknown; inherit_defaults: false; heartbeat: false;
};
type Row = { ref: string; kind: 'fact' | 'claim'; type: string; revision: number; request: number; value: any };
type Window = { id: string; revision: number; baseline: string[]; metric_refs: string[]; scope: string;
  due: { request?: number; units?: number; boundary?: string }; prediction?: { metric: string; value: number; unit: string };
  measure?: { source: string; version: string }; status: string; delivered?: any };

export function seedPolicy(capabilities: string[]): Policy {
  const exitSchema = { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] };
  return { request: { maxOutputTokens: 8192 }, modes: {
    execute: { tools: capabilities, instruction: 'Continue the current task.', exitSchema },
    reflect: { tools: ['read', 'ls', 'grep', 'office.look', 'acceptance'], instruction: 'Review the pinned self/evidence. You choose scope, method and whether to change anything. Exit with decide(op="exit").', exitSchema },
    consolidate: { tools: ['read', 'ls', 'grep', 'acceptance'], instruction: 'Organize this task\'s evidence and bounded inheritance records if useful; no automatic cross-task defaults.', exitSchema },
  }, routes: [], methods: {}, memory: { names: '*', order: 'name', write: 'replace' },
  context: { order: ['prompts', 'memory', 'skills'], instruction: '' } };
}

export function validateContract(c: SelfContract) {
  if (!c || c.source !== 'user_contract' || !c.authority || !c.decisions || !c.readonly_reason) throw Error('explicit user contract not loaded');
  const { content_hash, ...body } = c;
  if (content_hash !== hash(body)) throw Error('user contract hash mismatch');
  if (hash([...c.boundaries].sort()) !== hash([...FLOOR].sort()) || c.heartbeat !== false || c.inherit_defaults !== false) throw Error('v1 contract floor/heartbeat/inheritance mismatch');
  for (const key of ['requests', 'tokens', 'seconds', 'usd', 'storage_bytes']) if (!Number.isFinite(c.budget[key]) || c.budget[key] <= 0) throw Error(`missing numeric budget ${key}`);
  if (!Array.isArray(c.capabilities) || !Array.isArray(c.writable) || !c.acceptance) throw Error('contract capabilities/acceptance required');
}

function validatePolicy(p: Policy, c: SelfContract) {
  if (!p || Object.keys(p).some(k => !['modes','routes','methods','memory','context','request'].includes(k))) throw Error('unknown policy field');
  if (p.request && (!Number.isSafeInteger(p.request.maxOutputTokens) || p.request.maxOutputTokens < 1)) throw Error('invalid request envelope');
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
  private rootValidator?: Validator;
  constructor(contract: SelfContract, saved?: any, validator?: Validator, workspace?: { read(path: string): string }) {
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
    this.rootValidator = rootValidator;
    validateContract(contract); this.contract = copy(contract);
    this.root_id = saved?.root?.root_id ?? randomUUID();
    this.policy = copy(saved?.root?.policy ?? seedPolicy(contract.capabilities)); validatePolicy(this.policy, contract);
    if (saved?.root) {
      const r = saved.root;
      for (const key of ['serial','request','ledger','lineage','definitions','windows','queue','currentMode','review','started','units','tokens','usd','paused','previousMode','activeReset'] as const) if (r[key] !== undefined) (this as any)[key] = copy(r[key]);
      this.consumed = new Set(r.consumed); this.providerCosts = new Set(r.providerCosts);
      if (r.contract_hash !== contract.content_hash) throw Error('saved root contract differs');
      if (r.pending) this.fact('transaction_interrupted', { status: 'aborted', reason: 'uncommitted candidate on process restart' });
      if (r.resetInProgress) this.fact('active_reset_failed',{id:r.resetInProgress,error:'process restart during reset; completion unknown'});
      if (this.review) this.closeIncomplete('crash/recovery');
      this.fact('coverage_gap', { pre_review: false, reason: 'process restart; unknown forced termination/compaction' });
    }
    if (!this.definitions.length) this.definitions.push(this.definition());
  }
  override get revision() { return this.serial; }
  get mode() { return this.currentMode; }
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
      activeReset: this.activeReset ?? null, resetInProgress: this.resetInProgress ?? null, pending: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses, status: 'intent' } : null }) };
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
    if (section === 'ledger') return this.read(offset, count);
    if (section === 'policy') return copy(this.policy);
    if (section === 'contract') return copy(this.contract);
    if (section === 'definition') return copy(this.definitions.find(d => d.revision === offset));
    if (section === 'lineage') return { rows: copy(this.lineage.slice(offset, offset + count)), total: this.lineage.length };
    if (section === 'windows') return copy(this.windows);
    if (section === 'continuity') return { current: super.snapshot(), review: copy(this.review ?? null), requestPin: copy(this.requestPin ?? null) };
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
  transaction(input: { baseRevision: number; components?: any[]; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; validation?: any }) {
    const result = this.mutations.then(() => this.prepareTransaction(input));
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  abortTransaction(error: unknown) {
    this.pending = undefined; this.pendingReview = undefined;
    if (!this.chainFailed) this.fact('transaction_failed',{error:String(error),status:'entire response chain aborted'});
    this.chainFailed = true;
  }
  private async prepareTransaction(input: { baseRevision: number; components?: any[]; orchestration?: any; policy?: Policy; carry?: any; stepMap?: any; restore?: number; validation?: any }) {
    try {
      if (this.chainFailed) throw Error('transaction chain already failed');
      if (input.baseRevision !== this.pendingRevision) throw Error(`stale revision; expected ${this.pendingRevision}`);
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
        if (c.kind === 'tool' && (PROTOCOL.includes(c.name) || this.contract.capabilities.includes(c.name) || c.name === 'office')) throw Error('tool name collides with protected protocol or host capability');
        const value = { ...c, source: c.source, baseRevision: candidate.revision };
        if (c.kind === 'memory' && c.op === 'redefine' && policy.memory.write === 'append') value.source = `${candidate.active().find(x => x.kind === 'memory' && x.name === c.name)?.source ?? ''}\n${c.source}`;
        await candidate.reflectComponent(value); addresses.push(`components.${c.kind}.${c.name}`);
      }
      if (input.orchestration !== undefined) {
        this.assertWrite('orchestration');
        if (input.orchestration.roles?.length !== 1 || input.orchestration.roles[0].id !== 'agent') throw Error('v1 roles must be only agent');
        await candidate.reflectOrchestration({ baseRevision: candidate.revision, orchestration: input.orchestration, authorized: true, carry: input.carry, stepMap: input.stepMap }); addresses.push('orchestration');
      }
      if (input.policy !== undefined) { this.assertWrite('policy'); validatePolicy(input.policy, this.contract); policy = copy(input.policy); addresses.push('policy'); }
      if (!addresses.length) throw Error('empty transaction');
      const validation = input.validation ?? { due: { boundary: 'before_session_end' }, scope: 'unspecified; unverified', baseline: [], metric_refs: [] };
      if (!validation.due || Object.keys(validation.due).some(k => !['request','units','boundary'].includes(k)) || !Object.keys(validation.due).length) throw Error('validation due required');
      for (const k of ['request','units']) if (validation.due[k] !== undefined && (!Number.isSafeInteger(validation.due[k]) || validation.due[k] < 0)) throw Error('invalid due counter');
      if (validation.due.boundary !== undefined && !FLOOR.includes(validation.due.boundary)) throw Error('unknown due boundary');
      for (const ref of [...(validation.baseline ?? []), ...(validation.metric_refs ?? [])]) if (!this.ledger.some(row => row.ref === ref)) throw Error('unknown validation evidence');
      if (validation.measure) validateLiveSelfSource(validation.measure.source);
      if (this.chainFailed) throw Error('response chain failed while candidate was being validated');
      const revision = this.pendingRevision + 1;
      this.pendingReview = this.review?.id;
      this.pending = { candidate, policy, revision, addresses: [...(this.pending?.addresses ?? []), ...addresses], windows: [...(this.pending?.windows ?? []), { ...copy(validation), revision }], source: input.restore,
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
    return this.transaction({ baseRevision: input.baseRevision, components: [input], validation: input.validation });
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
    const tools = this.review?.modeDefinition.tools ?? this.policy.modes[this.currentMode].tools;
    return [...new Set([...PROTOCOL, ...tools.filter((t: string) => t !== 'agent_tools' && this.contract.capabilities.includes(t)),
      ...(tools.includes('agent_tools') && this.contract.capabilities.includes('agent_tools') ? this.active().filter(c => c.kind === 'tool').map(c => c.name) : [])])];
  }
  allowTool(name: string, args: any) { this.assertActionAllowed(name === 'office' ? `office.${args.op}` : name); }
  async boundary(applySurface: (tools: string[]) => void, persist: () => void) {
    if (this.paused) throw Error('inconsistent/paused');
    if (this.pending) {
      const p = this.pending, old = this.baseSaved(), oldPolicy = this.policy, oldSerial = this.serial, onReflection = this.onReflection;
      if (hash(old.snapshot) !== p.baseStateHash) {
        this.pending = undefined; this.chainFailed = false;
        this.fact('activation_failed',{ error:'pinned state changed after reflection; retry migration against current state', revision:this.serial });
        // No state or receipts are lost; the rejected candidate never becomes active.
      } else {
      const windowCount = this.windows.length, definitionCount = this.definitions.length, lineageCount = this.lineage.length;
      this.fact('transaction_intent', { from: this.serial, to: p.revision, addresses: p.addresses }); persist();
      try {
        // Private base-class fields are own properties; keep this root's identity and META state.
        Object.assign(this, p.candidate); this.onReflection = onReflection; this.policy = p.policy; this.serial = p.revision;
        this.onReflection?.({ kind: 'orchestration', revision: this.serial });
        applySurface(this.surface());
        this.pending = undefined;
        for (const w of p.windows) this.windows.push({ id: `window:${this.windows.length}`, baseline: [], metric_refs: [], scope: '', ...w, status: 'open' });
        this.definitions.push(this.definition());
        const activated = this.fact('reflection_activated', { parent: oldSerial, revision: this.serial, addresses: p.addresses, restore_source: p.source ?? null, review: this.review?.id ?? this.pendingReview ?? null });
        this.lineage.push(activated);
        if (this.review) this.review.changes.push(activated.ref);
        else if (this.pendingReview) this.fact('review_activation_closed', { review: this.pendingReview, activation: activated.ref, status: 'changed' });
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
    }
    this.chainFailed = false;
    if (!this.review && this.queue.length) this.enter(this.queue.shift());
    this.lastSurface = this.surface(); applySurface(this.lastSurface);
  }
  async event(type: string, boundary: string, facts: unknown = {}) {
    const key = `${type}:${boundary}`;
    if (this.consumed.has(key)) return { duplicate: true };
    this.consumed.add(key);
    const event = this.fact('event', { type, boundary, facts });
    const input = { event, revision: this.serial, state: super.snapshot(), ledger_offset: this.ledger.length, request: this.request, resources: this.resources() };
    const routes = [...this.policy.routes].filter(r => r.event === type).sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const triggers: any[] = [];
    if (this.contract.boundaries.includes(type)) triggers.push({ id: `contract:${type}`, source: 'user_contract', mode: 'reflect', conclusion_sink: 'ledger' });
    for (const route of routes) {
      try {
        if (route.predicate && (await this.evaluate(this.policy.methods[route.predicate], input, { route: route.id })).value !== true) continue;
        triggers.push({ ...route, source: 'agent_method' });
      } catch (e) { this.fact('watch_stall', { route: route.id, error: String(e), triggered: false }); }
    }
    for (const window of this.windows.filter(w => w.status === 'open')) {
      if ((window.due.boundary && window.due.boundary === type) || (window.due.request !== undefined && this.request >= window.due.request) || (window.due.units !== undefined && this.units >= window.due.units)) {
        const outcomes = this.ledger.filter(r => r.type === 'task_outcome' && r.revision >= window.revision);
        let measured: any = null;
        if (window.measure) {
          try { measured = { status: 'returned', ...(await this.evaluate(window.measure.source, { outcomes, baseline: window.baseline.map(ref => this.ledger.find(r => r.ref === ref)), resources: this.resources() }, { window: window.id })), source: 'agent_measure', version: window.measure.version }; }
          catch (e) { measured = { status: 'failed', error: String(e) }; }
        }
        const observed = measured?.value, prediction = window.prediction;
        const error = prediction && observed?.metric === prediction.metric && observed?.unit === prediction.unit && Number.isFinite(prediction.value) && Number.isFinite(observed.value)
          ? { predicted: prediction.value, observed: observed.value, unit: prediction.unit, difference: observed.value-prediction.value } : { status: 'unknown', reason: 'no comparable numeric prediction/observation' };
        window.status = 'delivered'; window.delivered = { outcomes: outcomes.map(r => r.ref), baseline: window.baseline, measured, prediction_error: error, resources: this.resources(), missing: outcomes.length ? [] : ['task_outcomes'] };
        this.fact('validation_delivered', { window: window.id, ...window.delivered });
        triggers.push({ id: window.id, source: 'validation_due', mode: 'reflect', conclusion_sink: 'ledger' });
      }
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
      suspended: { step: this.step, revision: this.serial }, changes: [], request_entered: this.request, snapshot: this.baseSaved(), windows: this.windows.filter(w => w.status === 'delivered').map(w => w.id) };
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
  exit(input: { status: 'changed'|'unrelated'|'deferred'; subtype?: string; result: any; evidenceRefs: string[]; terminal?: boolean }) {
    if (!this.review) throw Error('no active review');
    if (!['changed','unrelated','deferred'].includes(input.status)) throw Error('invalid closure');
    for (const ref of input.evidenceRefs) if (!this.ledger.some(r => r.ref === ref)) throw Error('unknown evidence ref');
    const schema = this.review.modeDefinition.exitSchema;
    validateSchema(input.result, schema);
    if (input.status === 'changed' && !this.review.changes.length) throw Error('changed requires an actual activation receipt');
    if (input.status === 'unrelated' && (!input.evidenceRefs.length || !input.result.reason)) throw Error('unrelated requires explicit judgment and evidence');
    const review = this.review;
    const row = this.claim('review_closed', { review: review.id, ...input, changes: review.changes, agent_decision: 'present', mode_version: review.revision, pending: Boolean(this.pending) });
    if (this.pending) this.fact('review_pending', { review: review.id, closure: row.ref, status: 'deferred', subtype: 'pending' });
    if (review.triggers.some((t: any) => t.conclusion_sink === 'lineage')) this.lineage.push(row);
    this.review = undefined; this.currentMode = this.previousMode;
    return { recorded: row.ref, resume: this.step, mode: this.currentMode, activation: 'next request boundary' };
  }
  closeIncomplete(reason: string) {
    if (this.review) { this.fact('review_closed', { review: this.review.id, status: 'deferred', subtype: 'incomplete', agent_decision: 'absent', reason }); this.review = undefined; this.currentMode = this.previousMode; }
  }
  interpret(id: string, decision: 'adopt'|'restore'|'defer', explanation: any, restore?: number) {
    const w = this.windows.find(w => w.id === id);
    if (!w || w.status !== 'delivered' || !['adopt','restore','defer'].includes(decision)) throw Error('validation not delivered or invalid decision');
    if (!explanation || !explanation.reason) throw Error('Agent comparison required');
    if (decision === 'restore' && restore === undefined) throw Error('restore source required');
    const row = this.claim('validation_interpreted', { window: id, decision, explanation, restore: restore ?? null, delivered: w.delivered });
    w.status = decision === 'restore' ? 'restore_pending' : decision === 'adopt' ? 'adopted' : 'deferred_unverified';
    return row;
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
  inherit(value: any) {
    for (const key of ['applicability','dependencies','counterexamples','evidence_refs','snapshot','status']) if (value[key] === undefined) throw Error(`inheritance requires ${key}`);
    if (!['candidate','task_adopted','inactive'].includes(value.status)) throw Error('cross-task default inheritance disabled');
    if (!this.definitions.some(d => d.revision === value.snapshot)) throw Error('unknown inheritance snapshot');
    for (const ref of value.evidence_refs) if (!this.ledger.some(r => r.ref === ref)) throw Error('unknown inheritance evidence');
    const row = this.claim('inheritance', { ...value, auto_inherit: false, root_id: this.root_id }); this.lineage.push(row); return row;
  }
  outcome(value: any, delivered = false) { const row = this.fact('task_outcome', value); if (delivered) this.units++; return row; }
  resources() { return { request: this.request, tokens: this.tokens, usd_estimate: this.usd, elapsed_seconds: (Date.now() - this.started)/1000, storage_bytes: this.storageBytes, units: this.units, cap: this.contract.budget }; }
  guard(storageBytes?: number) {
    if (storageBytes !== undefined) this.storageBytes = storageBytes;
    const b = this.contract.budget;
    if (this.request >= b.requests || this.tokens >= b.tokens || this.usd >= b.usd || (Date.now()-this.started)/1000 >= b.seconds || this.storageBytes >= b.storage_bytes) {
      this.closeIncomplete('hard budget'); this.fact('budget_stop', this.resources()); throw Error('authorized budget exhausted');
    }
  }
  pin() {
    this.guard(); this.request++;
    this.requestPin = { request: this.request, revision: this.serial, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, ledger_offset: this.ledger.length, step: this.step };
    this.executionGrant = [...this.lastSurface];
    return copy(this.requestPin);
  }
  cost(usage: any, duration_ms: number, usd: number, known: boolean, unknownTokens = 12000) {
    if (this.providerCosts.has(this.request)) throw Error('request cost already counted');
    this.providerCosts.add(this.request);
    const tokens = known ? ['input','output','cacheRead','cacheWrite'].reduce((n,k) => n + Number(usage[k] ?? 0), 0) : unknownTokens;
    this.tokens += tokens; this.usd += usd;
    return this.fact('request_cost', { pin: this.requestPin, usage: known ? usage : null, tokens, duration_ms, usd_estimate: usd, cost_source: 'provider usage + manifest rates; actual invoice unknown', status: known ? 'reported' : 'unknown_reserved' });
  }
  memory() {
    let memories = this.active().filter(c => c.kind === 'memory' && (this.policy.memory.names === '*' || this.policy.memory.names.includes(c.name)));
    memories.sort(this.policy.memory.order === 'newest' ? (a,b) => b.version-a.version || a.name.localeCompare(b.name) : (a,b) => a.name.localeCompare(b.name));
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
    return { root_id: this.root_id, revision: this.serial, architecture: active.architecture, parts: {
      components: { relation: 'executes from this root', writable_kinds: this.contract.writable.filter(x => x.startsWith('components.')) },
      orchestration: { relation: 'controls active step and trusted receipts', writable: this.contract.writable.includes('orchestration') },
      policy: { relation: 'controls modes, META, memory retrieval/write, request envelope and actual context assembly', request: this.policy.request,
        version: hash(this.policy), writable: this.contract.writable.includes('policy'), expand: 'read_self(section="policy")' },
      protected: { reason: this.contract.readonly_reason, contract_hash: this.contract.content_hash, boundaries: this.contract.boundaries, budget: this.contract.budget, capabilities: this.contract.capabilities, acceptance: this.contract.acceptance },
      unsupported: ['provider replacement', 'task subagents', 'cross-task default promotion', 'interactive world replay'],
    }, dynamic: { run: active.run, mode: this.currentMode, mode_version: this.review?.revision ?? this.serial, review: this.review ? { id: this.review.id, triggers: this.review.triggers, pinned_ledger_offset: this.review.ledger_offset, suspended: this.review.suspended } : null,
      instruction: this.review?.modeDefinition.instruction ?? this.policy.modes[this.currentMode].instruction,
      request_pin: this.requestPin, resources: this.resources(), pending: this.pending ? { revision: this.pending.revision, addresses: this.pending.addresses } : null,
      queue: this.queue.map(t => t.id), windows: this.windows.filter(w => ['open','delivered','restore_pending'].includes(w.status)),
      evidence: { total: this.ledger.length, capsules: this.ledger.filter(r => r.type === 'capsule').map(r => r.ref), read: 'read_self' },
      lineage: { count: this.lineage.length, expand: 'read_self(section="lineage")' } } };
  }
}
