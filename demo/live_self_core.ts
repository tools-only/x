/** Per-session Live Self Mirror with WASI-authored methods and commit-scoped capabilities. */
import { randomUUID, createHash } from 'node:crypto';
import { runLiveSelfMethod, validateLiveSelfSource } from './live_self_wasi.ts';

export type TypedValue = { type: 'text'; value: string } | { type: 'json'; value: unknown };
export type Grant = { target: 'task_harness' | 'evolution_loop'; operation: 'replace' };
export type MirrorPart = { name: string; type: 'method' | 'kernel'; protected: boolean; interface?: Record<string, unknown>; value: TypedValue };
export type Revision = { version: number; parts: Record<string, MirrorPart>; receipt: string; createdBy: string };
type GrantOperation = { op: 'replace'; target: string; ref: string; version: number };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const initialHarness = `text = " ".join(input["source_text"].split())\ntext = text.split(".")[0].strip()\n"Brief: " + text`;
const initialLoop = `source = input["source_text"].lower().split()\ndraft = input["draft"].lower()\nterms = sorted(set(word.strip(".,!?;:") for word in source if len(word.strip(".,!?;:")) >= 4))\npresent = [word for word in terms if word in draft]\ncoverage = len(present) / len(terms) if terms else 1.0\n{"terms_examined": len(terms), "terms_in_draft": present, "coverage": coverage, "signal": "source overlap observed" if coverage >= 0.25 else "source overlap is limited"}`;

export class LiveSelfSession {
  readonly id = randomUUID();
  readonly piSessionId: string;
  readonly workspace = { id: randomUUID() };
  private revisions: Revision[];
  private grants: Grant[];
  private activeCapabilities = new Map<string, { target: string; version: number; operation: string }>();
  private drafts: Array<{ evidenceId: string; task: string; input: string; output: string; revision: number; review: unknown; reviewStatus: string }> = [];
  private reviews: Array<{ evidenceId: string; task: string; disposition: 'keep' | 'defer' | 'change'; rationale: string; revision: number }> = [];
  private submitted: Array<{ evidence_id: string; task: string; content: string; revision: number; used_draft_output: boolean }> = [];
  constructor(grants: readonly Grant[] = [{ target: 'task_harness', operation: 'replace' }, { target: 'evolution_loop', operation: 'replace' }], piSessionId = 'unit-test-session') {
    this.piSessionId = piSessionId;
    this.grants = clone(grants);
    this.revisions = [{ version: 1, parts: {
      kernel: { name: 'kernel', type: 'kernel', protected: true, value: { type: 'json', value: { operation_contract: ['replace'], workspace: this.workspace.id, authority: 'extension-host' } } },
      task_harness: { name: 'task_harness', type: 'method', protected: false, interface: { used_by: 'draft_item', input: { task: 'text', source_text: 'text' }, output: 'text <= 8000 chars; executes in CPython/WASI' }, value: { type: 'text', value: initialHarness } },
      evolution_loop: { name: 'evolution_loop', type: 'method', protected: false, interface: { used_by: 'draft_item self-review boundary', input: { task: 'text', source_text: 'text', draft: 'text', mirror: 'pinned structural snapshot' }, output: 'JSON object evidence signal; no disposition' }, value: { type: 'text', value: initialLoop } },
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
    const rev = this.revisions.find(r => r.version === version); if (!rev) throw Error('unknown pinned revision');
    const harness = rev.parts.task_harness.value.value as string;
    const loop = rev.parts.evolution_loop.value.value as string;
    const output = (await runLiveSelfMethod(harness, { task, source_text: sourceText }, signal)).value;
    if (typeof output !== 'string' || output.length > 8000) throw Error('task harness output contract requires <= 8000 characters of text');
    const mirrorSnapshot = { version: rev.version, parts: Object.values(rev.parts).map(p => ({ id: p.name, type: p.type, protected: p.protected, value_type: p.value.type, value: p.value.value })) };
    let review: unknown = null, reviewStatus = 'failed';
    try {
      const candidate = (await runLiveSelfMethod(loop, { task, source_text: sourceText, draft: output, mirror: mirrorSnapshot }, signal)).value;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw Error('evolution loop output contract requires a JSON object');
      review = candidate; reviewStatus = 'available';
    } catch { /* Optional analysis failure never blocks the actual task output. */ }
    const evidenceId = `evidence-${this.drafts.length + 1}`;
    this.drafts.push({ evidenceId, task, input: sourceText, output, revision: version, review, reviewStatus });
    return { evidence_id: evidenceId, task, output, revision: version, self_review_signal: review, review_status: reviewStatus };
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
      ...clone(part), operations: this.currentCapabilities.filter(o => o.target === name),
    }]));
    return { task, session: this.id, pi_session_id: this.piSessionId, version: this.current.version, parts, workspace: { id: this.workspace.id } };
  }
  trace() {
    return { drafts: clone(this.drafts), reviews: clone(this.reviews), submissions: clone(this.submitted),
      review_status: this.drafts.map(d => ({ evidence_id: d.evidenceId, task: d.task, revision: d.revision, analysis_status: d.reviewStatus,
        disposition: [...this.reviews].reverse().find(r => r.evidenceId === d.evidenceId)?.disposition ?? 'unreviewed' })) };
  }
}
