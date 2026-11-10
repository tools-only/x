import { createHash } from 'node:crypto';
import { componentKind, markdownSpec, type Component, type ComponentSpec, type Validator } from './agent_component_model.ts';

export type ReceiptCondition = { type: string; currentArtifact?: boolean; freshness?: 'current' | 'any'; factPath?: string; equals?: unknown };
export type LiveOrchestration = {
  revision: number;
  roles: Array<{ id: string }>;
  slots: Array<{ id: string; type: 'json' | 'text'; initial?: unknown; writers?: string[] }>;
  steps: Array<{ id: string; role: string; decision?: string; actions?: string[] }>;
  decisions: Array<{ id: string; judge: string; question: string; evidence: ReceiptCondition[]; output: Record<string, unknown>; writes?: { slot: string; from?: string } }>;
  transitions: Array<{ id: string; from: string; on: { type: 'decision'; id: string; path?: string; equals?: unknown } | { type: 'action'; action: string }; requires: ReceiptCondition[]; to: string | 'complete' }>;
};
type ActionReceipt = { ref: string; type: string; artifactVersion?: number; artifactHash?: string; facts: Record<string, unknown> };
type DecisionReceipt = { ref: string; revision: number; step: string; generation: number; decisionId: string; actor: string; evidenceRefs: string[]; result: unknown };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pointer = (value: unknown, path = ''): unknown => path.split('/').slice(1).reduce((v: any, raw) => {
  const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
  return v == null ? undefined : v[key];
}, value);

function validateSchema(value: unknown, schema: any, path = '$'): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw Error(`invalid output schema at ${path}`);
  const valid = schema.type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'array' ? Array.isArray(value)
      : schema.type === 'string' ? typeof value === 'string'
        : schema.type === 'integer' ? Number.isSafeInteger(value)
          : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : schema.type === 'boolean' ? typeof value === 'boolean'
              : schema.type === 'null' ? value === null : false;
  if (!valid) throw Error(`decision result does not match ${schema.type ?? 'supported'} at ${path}`);
  if (schema.enum && !schema.enum.some((item: unknown) => same(item, value))) throw Error(`decision result is not an allowed value at ${path}`);
  if (schema.type === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value as object, key)) throw Error(`missing required result field ${key}`);
    for (const [key, child] of Object.entries(props)) if (Object.hasOwn(value as object, key)) validateSchema((value as any)[key], child, `${path}.${key}`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value as object)) if (!Object.hasOwn(props, key)) throw Error(`unexpected result field ${key}`);
  }
  if (schema.type === 'array' && schema.items) for (const [i, item] of (value as unknown[]).entries()) validateSchema(item, schema.items, `${path}[${i}]`);
}
function validateSchemaStructure(schema: any, path = '$'): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw Error(`invalid output schema at ${path}`);
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(schema.type)) throw Error(`unsupported output schema type at ${path}`);
  if (schema.type === 'object') for (const [key, child] of Object.entries(schema.properties ?? {})) validateSchemaStructure(child, `${path}.${key}`);
  if (schema.type === 'array' && schema.items) validateSchemaStructure(schema.items, `${path}[]`);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw Error(`invalid enum at ${path}`);
}

function validateDefinition(def: any): Omit<LiveOrchestration, 'revision'> {
  if (!def || typeof def !== 'object' || !Array.isArray(def.roles) || !Array.isArray(def.slots) || !Array.isArray(def.steps) || !Array.isArray(def.decisions) || !Array.isArray(def.transitions)) throw Error('orchestration must define roles, slots, steps, decisions and transitions');
  const unique = (rows: any[], label: string) => {
    if (rows.some(row => !row || typeof row.id !== 'string' || !row.id.trim()) || new Set(rows.map(row => row.id)).size !== rows.length) throw Error(`${label} must have unique non-empty ids`);
  };
  unique(def.roles, 'roles'); unique(def.steps, 'steps'); unique(def.decisions, 'decisions'); unique(def.transitions, 'transitions');
  if (def.slots.some((slot: any) => !slot || typeof slot.id !== 'string' || !slot.id.trim() || !['json', 'text'].includes(slot.type)) || new Set(def.slots.map((slot: any) => slot.id)).size !== def.slots.length) throw Error('slots must have unique non-empty ids and text/json types');
  const slots = new Map(def.slots.map((slot: any) => [slot.id, slot]));
  const roles = new Set(def.roles.map((x: any) => x.id)), steps = new Set(def.steps.map((x: any) => x.id));
  const decisions = new Map(def.decisions.map((x: any) => [x.id, x]));
  if (!roles.has('agent')) throw Error('orchestration must retain the authorized agent role');
  for (const step of def.steps) {
    if (!roles.has(step.role)) throw Error(`step ${step.id} references unknown role`);
    if (step.actions !== undefined && (!Array.isArray(step.actions) || step.actions.some((action: unknown) => typeof action !== 'string') || new Set(step.actions).size !== step.actions.length)) throw Error(`invalid actions for step ${step.id}`);
    if (step.decision && !decisions.has(step.decision)) throw Error(`step ${step.id} references unknown decision`);
  }
  for (const d of def.decisions) {
    if (!roles.has(d.judge) || typeof d.question !== 'string' || !Array.isArray(d.evidence) || !d.evidence.length) throw Error(`invalid decision definition ${d.id}`);
    for (const requirement of d.evidence) if (typeof requirement.type !== 'string' || (requirement.factPath !== undefined && typeof requirement.factPath !== 'string')) throw Error(`invalid evidence condition in decision ${d.id}`);
    if (d.writes && (!slots.has(d.writes.slot) || (d.writes.from !== undefined && typeof d.writes.from !== 'string'))) throw Error(`invalid slot write in decision ${d.id}`);
    validateSchemaStructure(d.output);
    validateSchema(schemaProbe(d.output), d.output);
  }
  for (const t of def.transitions) {
    if (!steps.has(t.from) || (t.to !== 'complete' && !steps.has(t.to))) throw Error(`transition ${t.id} references an unknown step`);
    if (!['decision', 'action'].includes(t.on?.type) || (t.on.type === 'decision' && !decisions.has(t.on.id)) ||
      (t.on.type === 'action' && typeof t.on.action !== 'string') || !Array.isArray(t.requires)) throw Error(`invalid transition ${t.id}`);
    if (!t.requires.length) throw Error(`transition ${t.id} must require trusted evidence`);
    for (const requirement of t.requires) if (typeof requirement.type !== 'string' || (requirement.factPath !== undefined && typeof requirement.factPath !== 'string')) throw Error(`invalid evidence condition in transition ${t.id}`);
  }
  for (const step of def.steps) if (step.decision && !def.transitions.some((transition: any) => transition.from === step.id && transition.on?.type === 'decision' && transition.on.id === step.decision)) throw Error(`decision step ${step.id} has no reachable transition`);
  return clone({ roles: def.roles, slots: def.slots, steps: def.steps, decisions: def.decisions, transitions: def.transitions });
}
function schemaProbe(schema: any): unknown {
  if (schema?.enum?.length) return schema.enum[0];
  if (schema?.type === 'object') return Object.fromEntries((schema.required ?? []).map((key: string) => [key, schemaProbe(schema.properties?.[key])]));
  if (schema?.type === 'array') return [];
  if (schema?.type === 'string') return '';
  if (schema?.type === 'integer' || schema?.type === 'number') return 0;
  if (schema?.type === 'boolean') return false;
  if (schema?.type === 'null') return null;
  return undefined;
}

/** Runtime-owned evidence ledger and directly reflected, versioned task organization. */
export class LiveOrchestrationSession {
  private revisions: LiveOrchestration[];
  private actions: ActionReceipt[] = [];
  private decisions: DecisionReceipt[] = [];
  private slotValues: Record<string, unknown> = {};
  private selfReviews: Array<{ revision: number; disposition: 'keep' | 'defer' | 'change'; rationale: string }> = [];
  private latestArtifactVersion?: number;
  private latestArtifactHash?: string;
  private activeStep = 'work';
  private stepGeneration = 0;
  private consumedDecisions = new Set<string>();
  private complete = false;
  constructor(saved?: any) {
    if (saved?.snapshot?.orchestration && Array.isArray(saved.history) && saved.history.length) {
      this.revisions = clone(saved.history);
      this.actions = clone(saved.snapshot.actions ?? []);
      this.decisions = clone(saved.snapshot.decisions ?? []);
      this.selfReviews = clone(saved.snapshot.selfReviews ?? []);
      this.slotValues = clone(saved.snapshot.slotValues ?? {});
      this.latestArtifactVersion = saved.snapshot.latestArtifactVersion;
      this.latestArtifactHash = saved.snapshot.latestArtifactHash;
      this.activeStep = saved.snapshot.step ?? this.revisions.at(-1)!.steps[0].id;
      this.stepGeneration = saved.snapshot.stepGeneration ?? 0;
      this.consumedDecisions = new Set(saved.snapshot.consumedDecisions ?? []);
      this.complete = saved.snapshot.complete === true;
    } else this.revisions = [{ revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [] }];
  }
  get current() { return { revision: this.revisions.length, orchestration: this.revisions.at(-1)! }; }
  get step() { return this.activeStep; }
  snapshot() { return { revision: this.current.revision, orchestration: clone(this.current.orchestration), step: this.activeStep, complete: this.complete,
    actions: clone(this.actions), decisions: clone(this.decisions), selfReviews: clone(this.selfReviews), slotValues: clone(this.slotValues), latestArtifactVersion: this.latestArtifactVersion,
    latestArtifactHash: this.latestArtifactHash, stepGeneration: this.stepGeneration, consumedDecisions: [...this.consumedDecisions] }; }
  history() { return clone(this.revisions); }
  recordSelfReview(input: { revision: number; disposition: 'keep' | 'defer' | 'change'; rationale: string }) {
    if (input.revision !== this.current.revision) throw Error('self-review must cite the current orchestration revision');
    if (!['keep', 'defer', 'change'].includes(input.disposition) || typeof input.rationale !== 'string' || !input.rationale.trim()) throw Error('invalid self-review');
    const review = { revision: input.revision, disposition: input.disposition, rationale: input.rationale.trim() };
    this.selfReviews.push(review);
    return { ...review, recorded: true };
  }
  hasCurrentSelfReview() { return this.selfReviews.some(review => review.revision === this.current.revision); }
  reflect(input: { baseRevision: number; orchestration: unknown; authorized: boolean; carry?: Record<string, unknown> }) {
    if (input.authorized !== true) throw Error('unauthorized orchestration reflection');
    if (input.baseRevision !== this.current.revision) throw Error('stale revision');
    const candidate = validateDefinition(input.orchestration);
    const bootstrap = this.current.revision === 1 && this.activeStep === 'work' && this.current.orchestration.steps.length === 1;
    if (!bootstrap && !candidate.steps.some(step => step.id === this.activeStep)) throw Error('active step must remain reachable');
    if (input.carry !== undefined && (!input.carry || typeof input.carry !== 'object' || Array.isArray(input.carry))) throw Error('carry must be an object');
    const nextSlotValues: Record<string, unknown> = {};
    for (const slot of candidate.slots) {
      if (Object.hasOwn(input.carry ?? {}, slot.id) && slot.writers && !slot.writers.includes('agent')) throw Error(`unauthorized carry write to slot ${slot.id}`);
      const value = Object.hasOwn(input.carry ?? {}, slot.id) ? input.carry![slot.id] : this.slotValues[slot.id] ?? slot.initial;
      if (value !== undefined && slot.type === 'text' && typeof value !== 'string') throw Error(`slot ${slot.id} requires text`);
      if (value !== undefined && slot.type === 'json' && (typeof value === 'function' || typeof value === 'symbol')) throw Error(`slot ${slot.id} requires JSON`);
      if (value !== undefined) { JSON.stringify(value); nextSlotValues[slot.id] = clone(value); }
    }
    for (const key of Object.keys(input.carry ?? {})) if (!candidate.slots.some(slot => slot.id === key)) throw Error(`carry references unknown slot ${key}`);
    const next = { revision: this.current.revision + 1, ...candidate };
    this.revisions.push(next);
    this.slotValues = nextSlotValues;
    if (bootstrap) { this.activeStep = next.steps[0].id; this.stepGeneration++; }
    return { revision: next.revision, receipt: digest({ from: input.baseRevision, orchestration: next, carry: input.carry ?? {} }), step: this.activeStep };
  }
  invalidateArtifact() { this.latestArtifactVersion = undefined; this.latestArtifactHash = undefined; }
  assertActionAllowed(type: string) {
    if (this.complete) throw Error('orchestration is complete');
    const step = this.current.orchestration.steps.find(row => row.id === this.activeStep);
    if (!step) throw Error('active orchestration step is unavailable');
    if (step.role !== 'agent') throw Error(`role ${step.role} has no active executor`);
    if (step.actions && !step.actions.includes(type)) throw Error(`action ${type} is not allowed by active step ${step.id}`);
  }
  /** Called only by host action adapters after a real action succeeds. */
  recordAction(type: string, facts: Record<string, unknown> = {}, updatesCurrentArtifact = false) {
    if (typeof type !== 'string' || !type || !facts || typeof facts !== 'object' || Array.isArray(facts)) throw Error('invalid action facts');
    this.assertActionAllowed(type);
    const artifactVersion = Number.isSafeInteger(facts.artifactVersion) ? Number(facts.artifactVersion) : undefined;
    const artifactHash = typeof facts.artifactHash === 'string' ? facts.artifactHash : undefined;
    if (updatesCurrentArtifact && artifactVersion !== undefined && artifactHash) {
      this.latestArtifactVersion = artifactVersion; this.latestArtifactHash = artifactHash;
    }
    const receipt = { ref: `action-${this.actions.length + 1}`, type, artifactVersion, artifactHash, facts: clone(facts) };
    this.actions.push(receipt);
    return { receipt: clone(receipt), transition: this.advanceAction(receipt) };
  }
  decide(input: { decisionId: string; actor: string; evidenceRefs: string[]; result: unknown }) {
    if (input.actor !== 'agent') throw Error('unauthorized decision actor');
    const step = this.current.orchestration.steps.find(s => s.id === this.activeStep);
    const decision = this.current.orchestration.decisions.find(d => d.id === input.decisionId);
    if (!step || step.role !== 'agent' || !decision || decision.judge !== 'agent' || step.decision !== decision.id) throw Error('unauthorized or inactive decision');
    if (!Array.isArray(input.evidenceRefs)) throw Error('evidence refs are required');
    const refs = input.evidenceRefs.map(ref => this.actions.find(a => a.ref === ref));
    if (refs.some(ref => !ref)) throw Error('unknown evidence reference');
    for (const needed of decision.evidence) {
      const matching = refs.filter(receipt => receipt!.type === needed.type && (needed.factPath === undefined || same(pointer(receipt!.facts, needed.factPath), needed.equals)));
      const mustBeCurrent = needed.currentArtifact || needed.freshness === 'current';
      const matched = matching.some(receipt => !mustBeCurrent || (receipt!.artifactVersion === this.latestArtifactVersion && !!this.latestArtifactHash && receipt!.artifactHash === this.latestArtifactHash));
      if (!matched) throw Error(matching.length && mustBeCurrent ? `stale evidence ${needed.type}` : `missing evidence ${needed.type}`);
    }
    validateSchema(input.result, decision.output);
    if (decision.writes) {
      const slot = this.current.orchestration.slots.find(candidate => candidate.id === decision.writes!.slot)!;
      if (slot.writers && !slot.writers.includes(input.actor)) throw Error(`unauthorized write to slot ${slot.id}`);
      const value = decision.writes.from ? pointer(input.result, decision.writes.from) : input.result;
      if (value === undefined) throw Error(`decision slot source is missing`);
      if (slot.type === 'text' && typeof value !== 'string') throw Error(`slot ${slot.id} requires text`);
      this.slotValues[slot.id] = clone(value);
    }
    const receipt = { ref: `decision-${this.decisions.length + 1}`, revision: this.current.revision, step: this.activeStep, generation: this.stepGeneration,
      decisionId: decision.id, actor: input.actor, evidenceRefs: [...input.evidenceRefs], result: clone(input.result) };
    this.decisions.push(receipt);
    return { accepted: true, ...clone(receipt) };
  }
  advance() {
    if (this.complete) return { status: 'complete' as const, step: this.activeStep };
    const latest = this.decisions.at(-1);
    const definition = this.current.orchestration;
    if (!latest || this.consumedDecisions.has(latest.ref) || latest.revision !== this.current.revision || latest.step !== this.activeStep || latest.generation !== this.stepGeneration)
      return { status: 'stalled' as const, step: this.activeStep, reason: 'no fresh decision for current step and revision' };
    const matching = definition.transitions.filter(t => t.from === this.activeStep && t.on.type === 'decision' && latest.decisionId === t.on.id && same(pointer(latest.result, t.on.path), t.on.equals)
      && this.requiresMatched(t.requires, latest.evidenceRefs));
    if (matching.length !== 1) return { status: 'stalled' as const, step: this.activeStep, reason: matching.length ? 'ambiguous transition' : 'no transition matches current decision and evidence' };
    const transition = matching[0];
    this.consumedDecisions.add(latest.ref);
    if (transition.to === 'complete') { this.complete = true; return { status: 'complete' as const, step: this.activeStep, transition: transition.id }; }
    this.activeStep = transition.to;
    this.stepGeneration++;
    return { status: 'advanced' as const, step: this.activeStep, transition: transition.id };
  }
  private requiresMatched(requirements: ReceiptCondition[], refs: string[]) {
    return requirements.every(requirement => this.actions.some(action => refs.includes(action.ref) && action.type === requirement.type &&
      (requirement.factPath === undefined || same(pointer(action.facts, requirement.factPath), requirement.equals)) &&
      (!(requirement.currentArtifact || requirement.freshness === 'current') ||
        (action.artifactVersion === this.latestArtifactVersion && !!this.latestArtifactHash && action.artifactHash === this.latestArtifactHash))));
  }
  private advanceAction(receipt: ActionReceipt) {
    const matches = this.current.orchestration.transitions.filter(transition => transition.from === this.activeStep && transition.on.type === 'action'
      && transition.on.action === receipt.type && this.requiresMatched(transition.requires, [receipt.ref]));
    if (matches.length !== 1) return { status: 'stalled' as const, step: this.activeStep, reason: matches.length ? 'ambiguous transition' : 'no action transition matches current receipt' };
    const transition = matches[0];
    if (transition.to === 'complete') { this.complete = true; return { status: 'complete' as const, step: this.activeStep, transition: transition.id }; }
    this.activeStep = transition.to; this.stepGeneration++;
    return { status: 'advanced' as const, step: this.activeStep, transition: transition.id };
  }
}

/** The single mutable Agent object: components and task organization share one live revision space. */
export class LiveAgentSelf extends LiveOrchestrationSession {
  private components = new Map<string, Component>();
  private componentVersions = new Map<string, Map<number, string>>();
  private origins = new Map<string, { by?: string; decision?: number }>();
  private selfRevision = 1;
  onReflection?: (event: { kind: 'component' | 'orchestration'; component?: Component; revision: number }) => void;
  constructor(saved?: any, private validator?: Validator, private workspace?: { read(path: string): string }) {
    super(saved);
    this.selfRevision = Number.isSafeInteger(saved?.snapshot?.selfRevision) ? saved.snapshot.selfRevision : 1;
    for (const component of saved?.snapshot?.components ?? []) this.components.set(component.path, clone(component));
    for (const [path, rows] of Object.entries(saved?.snapshot?.componentHistory ?? {}) as Array<[string, Array<{version:number;source:string}>]>) {
      this.componentVersions.set(path, new Map(rows.map(row => [row.version, row.source])));
    }
    for (const [path, origin] of Object.entries(saved?.snapshot?.origins ?? {})) this.origins.set(path, origin as any);
  }
  get revision() { return this.selfRevision; }
  override snapshot() {
    const componentHistory = Object.fromEntries([...this.componentVersions].map(([path, versions]) =>
      [path, [...versions].map(([version, source]) => ({ version, source }))]));
    return { ...super.snapshot(), selfRevision: this.selfRevision,
      components: this.allComponents(), componentHistory, origins: Object.fromEntries(this.origins) };
  }
  mirror() {
    const run = super.snapshot();
    return { id: 'live-agent-self', revision: this.selfRevision,
      architecture: { components: this.allComponents().map(({source, ...component}) => component), orchestration: run.orchestration },
      writable: { components: 'reflect_component on the active Agent object', orchestration: 'reflect_orchestration on the active Agent object' },
      run: { step: run.step, complete: run.complete, actions: run.actions.slice(-8), decisions: run.decisions.slice(-8),
        selfReviews: run.selfReviews.slice(-4), latestArtifactVersion: run.latestArtifactVersion, latestArtifactHash: run.latestArtifactHash } };
  }
  allComponents(): Component[] { return [...this.components.values()].sort((a,b) => a.path.localeCompare(b.path)); }
  active(): Component[] { return [...this.components.values()].filter(component => component.enabled).sort((a,b) => a.path.localeCompare(b.path)); }
  candidates(): Component[] { return this.active(); }
  versionMap(): Record<string, number> { return Object.fromEntries([...this.components].map(([path, component]) => [path, component.version])); }
  label(path: string) { const component = this.components.get(path); return `${component?.name ?? path} v${component?.version ?? 'none'}`; }
  originOf(path: string) { return this.origins.get(path); }
  sourceOf(path: string, version: number) { return this.componentVersions.get(path)?.get(version); }
  historyOf(path: string) { return { versions: [...(this.componentVersions.get(path) ?? [])].map(([version, source]) => ({ version, hash: digest(source) })) }; }
  index(_level: number, _failedInputs?: Set<string>, usage?: Map<string,string>) {
    const entries = this.active().filter(component => ['prompt','tool','skill','subagent'].includes(component.kind));
    return entries.length ? ['HARNESS COMPONENTS IN THE LIVE AGENT', ...entries.map(c =>
      `${c.name} | ${c.kind} | v${c.version} | ${c.description} | via=${usage?.get(c.path) ?? '0'}`)].join('\n') : '';
  }
  /** Existing workspace-backed ARC callers remain supported; PPT self-reflection uses reflectComponent directly. */
  async save(path: string, level: number, origin: {by:string;decision?:number} = {by:'agent'}) {
    const kind = componentKind(path);
    if (!kind || kind === 'process' || kind === 'library') return undefined;
    const source = this.workspace?.read(path);
    if (typeof source !== 'string') return undefined;
    const current = this.components.get(path);
    const result = await this.reflectComponent({ op: current ? 'redefine' : 'define', kind, name: componentName(path,kind),
      source, baseRevision: this.selfRevision, level, origin });
    return `${kind} ${result.component.name} v${result.component.version}: reflected into live Agent`;
  }
  async scan(level: number) { void level; }
  boundary() { /* Direct object replacement is active immediately; there is no pending binder boundary. */ }
  bindProcess(_component: Component) { throw Error('process components are represented by self.orchestration'); }
  async seedComponent(kind: string, name: string, source: string, level = 0) {
    return this.reflectComponent({ op: 'define', kind, name, source, baseRevision: this.selfRevision, level, origin: { by: 'runtime-seed' } });
  }
  async reflectSource(path: string, source: string, level = 0, baseRevision = this.selfRevision) {
    const kind = componentKind(path);
    if (!kind || kind === 'process' || kind === 'library') throw Error(`not a mutable Agent component: ${path}`);
    const current = this.components.get(path);
    return this.reflectComponent({ op: current ? 'redefine' : 'define', kind, name: componentName(path,kind), source, baseRevision, level, origin: { by: 'agent' } });
  }
  async reflectComponent(input: { op: 'define'|'redefine'|'restore'; kind: string; name: string; source?: string; version?: number;
    baseRevision: number; level?: number; origin?: {by:string;decision?:number} }) {
    if (input.baseRevision !== this.selfRevision) throw Error(`stale Agent revision ${input.baseRevision}; current revision is ${this.selfRevision}`);
    if (!['tool','prompt','skill','subagent','memory'].includes(input.kind)) throw Error(`unsupported mutable component kind ${input.kind}`);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.name)) throw Error('invalid component name');
    const path = componentPath(input.kind,input.name), current = this.components.get(path);
    if (input.op === 'define' && current) throw Error(`${input.kind} ${input.name} already exists; use redefine`);
    if (input.op !== 'define' && !current) throw Error(`${input.kind} ${input.name} does not exist; use define`);
    const source = input.op === 'restore' ? this.sourceOf(path, Number(input.version)) : input.source;
    if (typeof source !== 'string') throw Error(input.op === 'restore' ? 'saved component version not found' : 'source is required');
    let spec: ComponentSpec;
    if (input.kind === 'tool') {
      if (!source.split(/\r?\n/).slice(0,10).some(line => line.trim() === '# program: on')) throw Error('tool source must include # program: on in its first ten lines');
      if (!this.validator) throw Error('tool validation service is unavailable');
      spec = await this.validator(path,source);
    } else spec = markdownSpec(path,source);
    if (input.kind === 'skill' && spec.name !== input.name) throw Error('skill name must match its component address');
    if (['tool','subagent'].includes(input.kind) && spec.kind !== input.kind) throw Error(`component validator returned ${spec.kind}, expected ${input.kind}`);
    if (input.baseRevision !== this.selfRevision) throw Error('Agent changed while component validation was running; retry against the current revision');
    const version = (current?.version ?? 0) + 1, hash = digest(source);
    const component: Component = { ...spec, path, version, hash, source, level: input.level ?? 0 };
    const previousOrigin = this.origins.get(path);
    this.components.set(path, component);
    const versions = this.componentVersions.get(path) ?? new Map<number,string>();
    versions.set(version,source); this.componentVersions.set(path,versions);
    this.origins.set(path,input.origin ?? {by:'agent'}); this.selfRevision++;
    try { this.onReflection?.({ kind: 'component', component: clone(component), revision: this.selfRevision }); }
    catch (error) {
      if (current) this.components.set(path,current); else this.components.delete(path);
      versions.delete(version); if (!versions.size) this.componentVersions.delete(path);
      if (previousOrigin) this.origins.set(path,previousOrigin); else this.origins.delete(path);
      this.selfRevision--;
      throw error;
    }
    return { revision: this.selfRevision, component: clone(component), previousVersion: current?.version ?? null };
  }
  async reflectOrchestration(input: {baseRevision:number; orchestration:unknown; carry?:Record<string,unknown>; authorized:boolean}) {
    if (input.baseRevision !== this.selfRevision) throw Error(`stale Agent revision ${input.baseRevision}; current revision is ${this.selfRevision}`);
    const result = super.reflect({ baseRevision: this.current.revision, orchestration: input.orchestration,
      carry: input.carry, authorized: input.authorized });
    this.selfRevision++;
    this.onReflection?.({ kind: 'orchestration', revision: this.selfRevision });
    return { ...result, selfRevision: this.selfRevision };
  }
}

function componentPath(kind: string, name: string) {
  if (kind === 'tool') return `tools/${name}.py`;
  if (kind === 'prompt') return `prompts/${name}.md`;
  if (kind === 'skill') return `skills/${name}/SKILL.md`;
  if (kind === 'subagent') return `agents/${name}.md`;
  if (kind === 'memory') return `notes/memory/${name}.md`;
  throw Error(`unsupported component kind ${kind}`);
}
function componentName(path: string, kind: string) {
  return kind === 'skill' ? path.split('/')[1] : path.split('/').at(-1)!.replace(/\.(py|md)$/, '');
}
