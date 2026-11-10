/** Per-session Live Self Mirror with WASI-authored methods and commit-scoped capabilities. */
import { randomUUID, createHash } from 'node:crypto';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';

export type TypedValue = { type: 'text'; value: string } | { type: 'json'; value: unknown };
export type Grant = { target: 'task_harness' | 'evolution_loop'; operation: 'replace' };
export type MirrorPart = { name: string; type: 'method' | 'kernel'; protected: boolean; category: string; role: string; interface?: Record<string, unknown>; value: TypedValue };
export type Revision = { version: number; parts: Record<string, MirrorPart>; receipt: string; createdBy: string };
type GrantOperation = { op: 'replace'; target: string; ref: string; version: number };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const initialHarness = `text = " ".join(input["source_text"].split())\ntext = text.split(".")[0].strip()\n"Brief: " + text`;
const initialLoop = `evidence_ref = input["evidence"][-1]["ref"]\n{"scopes": [{"label": "method", "object_ids": ["task_harness"], "evidence_refs": [evidence_ref], "criteria": "Inspect the task method against its current evidence."}], "decision": "complete", "trial": None, "summary": "Method-scoped review complete."}`;

export class LiveSelfSession {
  readonly id = randomUUID();
  readonly piSessionId: string;
  readonly workspace = { id: randomUUID() };
  private revisions: Revision[];
  private grants: Grant[];
  private activeCapabilities = new Map<string, { target: string; version: number; operation: string }>();
  private drafts: Array<{ evidenceId: string; task: string; input: string; output: string; revision: number; review: unknown; reviewStatus: string }> = [];
  private nextEvidenceSequence = 1;
  private reviews: Array<{ evidenceId: string; task: string; disposition: 'keep' | 'defer' | 'change'; rationale: string; revision: number }> = [];
  private submitted: Array<{ evidence_id: string; task: string; content: string; revision: number; used_draft_output: boolean }> = [];
  constructor(grants: readonly Grant[] = [{ target: 'task_harness', operation: 'replace' }, { target: 'evolution_loop', operation: 'replace' }], piSessionId = 'unit-test-session') {
    this.piSessionId = piSessionId;
    this.grants = clone(grants);
    this.revisions = [{ version: 1, parts: {
      kernel: { name: 'kernel', type: 'kernel', category: 'runtime', role: 'protected execution and permission boundary', protected: true, value: { type: 'json', value: { operation_contract: ['replace'], workspace: this.workspace.id, authority: 'extension-host' } } },
      task_harness: { name: 'task_harness', type: 'method', category: 'method', role: 'creates ordinary task drafts', protected: false, interface: { used_by: 'draft_item', input: { task: 'text', source_text: 'text' }, output: 'text <= 8000 chars; executes in CPython/WASI', trialable: true }, value: { type: 'text', value: initialHarness } },
      evolution_loop: { name: 'evolution_loop', type: 'method', category: 'meta-method', role: 'chooses review scopes, evidence, and bounded trial or completion', protected: false, interface: { used_by: 'draft_item self-review boundary', input: { task: 'text', source_text: 'text', draft: 'text', mirror: 'pinned structural graph', evidence: 'up to four raw versioned evidence refs', trial_receipt: 'null on first call; receipt on one continuation' }, output: '{scopes:[{label,level?,object_ids,evidence_refs,criteria}],decision:trial|complete,trial?:{method_id,evidence_ref},summary?}; after one trial the same pinned method receives its receipt and must return decision=complete with no trial', python_return: 'final expression, or assign result in each conditional branch', trialable: true, max_trials_per_review: 1 }, value: { type: 'text', value: initialLoop } },
    }, receipt: 'bootstrap', createdBy: 'bootstrap' }];
    this.mintCapabilities();
    for (const part of ['task_harness', 'evolution_loop']) validateLiveSelfSource(this.current.parts[part].value.value as string);
  }
  get current() { return this.revisions.at(-1)!; }
  get currentCapabilities(): GrantOperation[] { return [...this.activeCapabilities].map(([ref, c]) => ({ op: 'replace', target: c.target, ref, version: c.version })); }
  history() { return clone(this.revisions); }
  private mintCapabilities() {
    this.activeCapabilities = new Map();
    for (const g of this.grants) if (g.operation === 'replace') {
      const ref = `mirror-op:${randomUUID()}`; this.activeCapabilities.set(ref, { target: g.target, version: this.current.version, operation: g.operation });
    }
  }
  /** Trusted host revocation; there is deliberately no agent-facing revoke tool. */
  revoke(target?: Grant['target']) {
    for (const [ref, grant] of this.activeCapabilities) if (!target || grant.target === target) this.activeCapabilities.delete(ref);
    this.grants = target ? this.grants.filter(g => g.target !== target) : [];
  }
  /** A capability shown on a Mirror part resolves to its live property at commit. */
  reflect(input: { ref: string; replace: true; value: TypedValue }) {
    const cap = this.activeCapabilities.get(input.ref);
    if (!cap) throw Error('capability revoked or invalid');
    if (cap.operation !== 'replace') throw Error('capability operation mismatch');
    if (cap.version !== this.current.version) throw Error('stale revision');
    const part = this.current.parts[cap.target];
    if (!part || part.protected) throw Error('target unavailable or protected');
    if (part.value.type !== input.value.type) throw Error('typed value mismatch');
    // Validate before consuming capability or publishing; failed source cannot burn another grant.
    const source = input.value.value;
    if (typeof source !== 'string') throw Error('method source must be text');
    validateLiveSelfSource(source);
    const parts = clone(this.current.parts); parts[cap.target] = { ...part, value: clone(input.value) };
    const receipt = digest({ session: this.id, workspace: this.workspace.id, from: this.current.version, target: cap.target, value: input.value });
    const revision = { version: this.current.version + 1, parts, receipt, createdBy: 'agent' };
    this.revisions.push(revision);
    this.mintCapabilities();
    return { version: revision.version, receipt, target: cap.target, source_validated: true };
  }
  async draft(task: string, sourceText: string, version = this.current.version, signal?: AbortSignal) {
    const evidenceId = `evidence-${this.nextEvidenceSequence++}`;
    const rev = this.revisions.find(r => r.version === version); if (!rev) throw Error('unknown pinned revision');
    const harness = rev.parts.task_harness.value.value as string;
    const loop = rev.parts.evolution_loop.value.value as string;
    const output = (await runLiveSelfMethod(harness, { task, source_text: sourceText }, signal)).value;
    if (typeof output !== 'string' || output.length > 8000) throw Error('task harness output contract requires <= 8000 characters of text');
    const evidenceRef = `${evidenceId}@r${version}`;
    const graphObjects = Object.values(rev.parts).map(p => ({ id: p.name, category: p.category, role: p.role, type: p.type, protected: p.protected,
      relations: p.name === 'kernel' ? [] : [{ type: 'executes_in', target: 'kernel' }] }));
    const mirrorSnapshot = { version: rev.version, graph: graphObjects, parts: Object.values(rev.parts).map(p => ({ id: p.name, type: p.type, category: p.category, role: p.role, protected: p.protected, value_type: p.value.type })) };
    const currentEvidence = { ref: evidenceRef, evidence_id: evidenceId, revision: version, task, input: sourceText, output };
    const evidence = [...this.drafts.slice(-3).map(d => ({ ref: `${d.evidenceId}@r${d.revision}`, evidence_id: d.evidenceId, revision: d.revision, task: d.task, input: d.input, output: d.output })), currentEvidence];
    const reviewInput = { task, source_text: sourceText, draft: output, mirror: mirrorSnapshot, evidence, trial_receipt: null };
    let review: unknown = null, reviewStatus = 'failed';
    let stage = 'input_validation';
    try {
      if (Buffer.byteLength(JSON.stringify(reviewInput), 'utf8') > 14 * 1024) throw Error('meta evidence window exceeds bounded input envelope');
      stage = 'meta_review';
      const candidate = (await runLiveSelfMethod(loop, reviewInput, signal)).value;
      stage = 'trial_or_continuation';
      review = await this.executeMetaPlan(candidate, loop, reviewInput, evidence, mirrorSnapshot, rev, signal);
      reviewStatus = (review as any)?.continuation_failure ? 'partial' : 'available';
    } catch (e) { review = { status: 'failed', failure: { stage, reason: (e as Error).message.slice(0, 240) } }; }
    this.drafts.push({ evidenceId, task, input: sourceText, output, revision: version, review, reviewStatus });
    return { evidence_id: evidenceId, evidence_ref: evidenceRef, task, output, revision: version, meta_review: review, review_status: reviewStatus };
  }
  private async executeMetaPlan(candidate: unknown, metaSource: string, reviewInput: Record<string, unknown>, evidence: Array<{ ref: string; evidence_id: string; revision: number; task: string; input: string; output: string }>, graph: unknown, rev: Revision, signal?: AbortSignal) {
    const ids = new Set(Object.keys(rev.parts));
    const refs = new Map(evidence.map(item => [item.ref, item]));
    const validate = (value: unknown, allowTrial: boolean) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('meta plan must be an object');
      const plan = value as any;
      if (!Array.isArray(plan.scopes) || plan.scopes.length > 5) throw Error('meta plan scopes must be an array of at most five');
      for (const scope of plan.scopes) {
        if (!scope || typeof scope.label !== 'string' || typeof scope.criteria !== 'string' || (scope.level !== undefined && typeof scope.level !== 'string') || !Array.isArray(scope.object_ids) || !Array.isArray(scope.evidence_refs)) throw Error('invalid meta scope');
        if (scope.object_ids.some((id: unknown) => typeof id !== 'string' || !ids.has(id))) throw Error('meta scope references unknown object');
        if (scope.evidence_refs.some((ref: unknown) => typeof ref !== 'string' || !refs.has(ref))) throw Error('meta scope references unknown evidence');
      }
      if (!['trial', 'complete'].includes(plan.decision)) throw Error('meta decision must be trial or complete');
      if (!allowTrial && (plan.decision !== 'complete' || plan.trial != null)) throw Error('Meta continuation must complete without requesting a second trial');
      return plan;
    };
    const plan = validate(candidate, true);
    if (plan.decision === 'complete') {
      if (plan.trial != null) throw Error('complete decision cannot request a trial');
      return { plan, trial_receipt: null, execution_trace: [{ step: 'review', status: 'complete' }] };
    }
    const request = plan.trial;
    if (!request || typeof request.method_id !== 'string' || typeof request.evidence_ref !== 'string') throw Error('trial request requires method_id and evidence_ref');
    const part = rev.parts[request.method_id];
    if (!part || part.protected || part.interface?.trialable !== true) throw Error('requested method is not trialable');
    const selected = refs.get(request.evidence_ref);
    if (!selected) throw Error('trial evidence reference is stale or unknown');
    const methodSource = part.value.value as string;
    const trialInput = request.method_id === 'task_harness'
      ? { task: selected.task, source_text: selected.input }
      : request.method_id === 'evolution_loop'
        ? { ...reviewInput, task: selected.task, source_text: selected.input, draft: selected.output }
        : (() => { throw Error('no trial input adapter for method'); })();
    const result = await runLiveSelfMethod(methodSource, trialInput, signal);
    const trialReceipt = { method_id: request.method_id, evidence_ref: selected.ref, revision: rev.version, output: result.value };
    try {
      const continuation = await runLiveSelfMethod(metaSource, { ...reviewInput, trial_receipt: trialReceipt }, signal);
      const finalPlan = validate(continuation.value, false);
      return { plan: finalPlan, initial_plan: plan, trial_receipt: trialReceipt,
        execution_trace: [{ step: 'review', status: 'trial_requested' }, { step: 'trial', method_id: request.method_id, evidence_ref: selected.ref, revision: rev.version, status: 'executed' }, { step: 'continuation', status: 'complete', method_id: 'evolution_loop', revision: rev.version }] };
    } catch (error) {
      return { plan, initial_plan: plan, trial_receipt: trialReceipt, continuation_failure: (error as Error).message,
        execution_trace: [{ step: 'review', status: 'trial_requested' }, { step: 'trial', method_id: request.method_id, evidence_ref: selected.ref, revision: rev.version, status: 'executed' }, { step: 'continuation', status: 'bounded_failure', method_id: 'evolution_loop', revision: rev.version }] };
    }
  }
  recordReview(evidenceId: string, disposition: 'keep' | 'defer' | 'change', rationale: string) {
    const draft = this.drafts.find(d => d.evidenceId === evidenceId);
    if (!draft) throw Error('no task evidence window available to review');
    const record = { evidenceId, task: draft.task, disposition, rationale, revision: draft.revision };
    this.reviews.push(record);
    return { ...record, recorded: true };
  }
  submit(evidenceId: string, disposition: 'keep' | 'defer' | 'change', rationale: string, content?: string) {
    const draft = this.drafts.find(d => d.evidenceId === evidenceId);
    if (!draft) throw Error('no draft for this evidence_id');
    this.recordReview(evidenceId, disposition, rationale);
    const result = { evidence_id: evidenceId, task: draft.task, content: content ?? draft.output,
      revision: draft.revision, used_draft_output: content === undefined || content === draft.output };
    this.submitted.push(result);
    return { ...result, submitted: true };
  }
  mirror(task: string) {
    const parts = Object.fromEntries(Object.entries(this.current.parts).map(([name, part]) => [name, {
      ...clone(part), id: name, relations: name === 'kernel' ? [] : [{ type: 'executes_in', target: 'kernel' }], operations: this.currentCapabilities.filter(o => o.target === name),
    }]));
    const graph = Object.values(parts).map((part: any) => ({ id: part.id, category: part.category, role: part.role, type: part.type, protected: part.protected, relations: part.relations }));
    return { task, session: this.id, pi_session_id: this.piSessionId, version: this.current.version, graph, parts, workspace: { id: this.workspace.id } };
  }
  trace() {
    return { drafts: clone(this.drafts), reviews: clone(this.reviews), submissions: clone(this.submitted),
      review_status: this.drafts.map(d => ({ evidence_id: d.evidenceId, task: d.task, revision: d.revision, analysis_status: d.reviewStatus,
        disposition: [...this.reviews].reverse().find(r => r.evidenceId === d.evidenceId)?.disposition ?? 'unreviewed' })) };
  }
}
