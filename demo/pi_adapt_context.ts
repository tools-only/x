import { createHash } from "node:crypto";

export type EvidenceRef = { ref: string; version: string; digest: string; chars: number };
export type ContextBudget = {
  inputChars: number;
  outputChars: number;
  hydrateChars: number;
  compactionChars: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheInputTokens?: number;
  compactionTokens?: number;
  cost?: number;
  latencyMs?: number;
  softLimitChars?: number;
  hardLimitChars?: number;
  signal?: string;
  stop?: string;
};
export type SessionState = {
  schemaVersion: 1;
  revision: number;
  goal?: string;
  constraints: Array<{ id?: string; text: string; source_ref?: string }>;
  acceptance: Array<{ id?: string; criterion: string; status: "unverified" | "pass" | "fail"; evidence_refs?: string[] }>;
  openItems: string[];
  decisions: Array<{ status: "open" | "chosen" | "closed"; choice?: string; rationale?: string; evidence_refs?: string[] }>;
  claims: Array<{ kind: "fact" | "hypothesis"; statement: string; status: "proposed" | "supported" | "contradicted" | "stale"; evidence_refs?: string[] }>;
  evidence: Array<{ summary: string; ref?: EvidenceRef }>;
  failures: Array<{ summary: string; preconditions?: string; retryWhen?: string; ref?: EvidenceRef }>;
  artifacts: Array<{ name: string; version: string; role: string; ref?: EvidenceRef }>;
  activeMethod?: { name: string; version: string; summary: string };
  recentObs: Array<{ code: string; summary: string; ref?: EvidenceRef }>;
  toolSurface: Array<{ name: string; schema: unknown }>;
  budget: ContextBudget;
};
export type CompiledView = {
  stateRevision: number;
  goal?: string;
  constraints: SessionState["constraints"];
  acceptance: SessionState["acceptance"];
  openItems: string[];
  decisions: SessionState["decisions"];
  claims: SessionState["claims"];
  evidence: SessionState["evidence"];
  failures: SessionState["failures"];
  artifacts: SessionState["artifacts"];
  activeMethod?: SessionState["activeMethod"];
  recentObs: SessionState["recentObs"];
  toolSurface: SessionState["toolSurface"];
  budget: ContextBudget;
  omitted: Array<{ section: string; count: number }>;
  inputTokenEstimate: number;
};

export function emptySessionState(): SessionState {
  return { schemaVersion: 1, revision: 0, constraints: [], acceptance: [], openItems: [], decisions: [], claims: [], evidence: [], failures: [], artifacts: [],
    recentObs: [], toolSurface: [], budget: { inputChars: 0, outputChars: 0, hydrateChars: 0, compactionChars: 0 } };
}

export function parseSessionState(json: string): SessionState {
  const value = JSON.parse(json);
  const budget = value?.budget;
  const counters = ["inputChars", "outputChars", "hydrateChars", "compactionChars"];
  if (value?.schemaVersion !== 1 || !Number.isInteger(value.revision)
    || !["constraints", "acceptance", "openItems", "decisions", "claims", "evidence", "failures", "artifacts", "recentObs", "toolSurface"]
      .every(key => Array.isArray(value[key]))
    || !budget || !counters.every(key => Number.isFinite(budget[key]) && budget[key] >= 0))
    throw Error("invalid persisted ADAPT SessionState");
  return value as SessionState;
}

export function compileContext(state: SessionState, budgetChars = 6000): CompiledView {
  const view: CompiledView = {
    stateRevision: state.revision, goal: state.goal, constraints: [...state.constraints], acceptance: [...state.acceptance],
    openItems: [...state.openItems], decisions: [...state.decisions], claims: [...state.claims],
    evidence: [...state.evidence], failures: [...state.failures], artifacts: [...state.artifacts],
    activeMethod: state.activeMethod, recentObs: [...state.recentObs], toolSurface: [...state.toolSurface],
    budget: { ...state.budget }, omitted: [], inputTokenEstimate: 0,
  };
  const trim = (key: "recentObs" | "evidence" | "toolSurface", values: any[]) => {
    while (JSON.stringify(view).length > budgetChars && values.length) {
      values.shift();
      const old = view.omitted.find(item => item.section === key);
      if (old) old.count += 1;
      else view.omitted.push({ section: key, count: 1 });
    }
  };
  trim("recentObs", view.recentObs);
  trim("evidence", view.evidence);
  trim("toolSurface", view.toolSurface);
  view.inputTokenEstimate = Math.ceil(JSON.stringify(view).length / 4);
  return view;
}

export function resultEnvelope(input: {
  code: "ok" | "error" | "cancelled";
  summary: string;
  keyFields?: Record<string, unknown>;
  evidence?: EvidenceRef;
  next?: string;
}) {
  return { code: input.code, summary: input.summary.slice(0, 500), keyFields: input.keyFields ?? {},
    evidence: input.evidence, next: input.next };
}

export function evidenceRef(ref: string, body: string): EvidenceRef {
  const digest = createHash("sha256").update(body).digest("hex");
  return { ref: `evidence:${ref}@sha256:${digest}`, version: digest.slice(0, 16), digest, chars: body.length };
}

export function hydrateEvidence(
  pointer: EvidenceRef,
  read: (ref: string) => string | undefined,
  offset = 0,
  limit = 4000,
) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1)
    return { ok: false as const, error: "invalid_slice", detail: "offset must be >= 0 and limit must be >= 1" };
  if (pointer.ref !== `evidence:${pointer.ref.slice("evidence:".length, pointer.ref.lastIndexOf("@sha256:"))}@sha256:${pointer.digest}`
    || pointer.version !== pointer.digest.slice(0, 16))
    return { ok: false as const, error: "version_mismatch", ref: pointer.ref };
  const body = read(pointer.ref.slice("evidence:".length, pointer.ref.lastIndexOf("@sha256:")));
  if (body === undefined) return { ok: false as const, error: "missing_or_expired", ref: pointer.ref };
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== pointer.digest) return { ok: false as const, error: "digest_mismatch", ref: pointer.ref };
  if (offset > body.length) return { ok: false as const, error: "offset_out_of_range", offset, chars: body.length };
  const end = Math.min(body.length, offset + limit);
  return { ok: true as const, ref: pointer.ref, version: pointer.version, digest, offset, end, chars: body.length,
    text: body.slice(offset, end), nextOffset: end < body.length ? end : undefined };
}

export function observeBudget(
  current: ContextBudget,
  charge: { kind: "input" | "output" | "hydrate" | "compaction"; chars: number },
): ContextBudget {
  const field = charge.kind === "input" ? "inputChars" : charge.kind === "output" ? "outputChars"
    : charge.kind === "hydrate" ? "hydrateChars" : "compactionChars";
  const budget = { ...current, [field]: current[field] + Math.max(0, charge.chars) };
  const total = budget.inputChars + budget.outputChars + budget.hydrateChars + budget.compactionChars;
  if (budget.hardLimitChars !== undefined && total >= budget.hardLimitChars)
    budget.stop = `hard context budget reached (${total}/${budget.hardLimitChars} chars)`;
  else if (budget.softLimitChars !== undefined && total >= budget.softLimitChars)
    budget.signal = `context budget high-water (${total}/${budget.softLimitChars} chars)`;
  return budget;
}

export function observeUsage(current: ContextBudget, kind: string, usage: Record<string, unknown>): ContextBudget {
  const next = { ...current };
  const number = (key: string) => {
    const value = Number(usage[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  next.inputTokens = (next.inputTokens ?? 0) + number("input");
  next.outputTokens = (next.outputTokens ?? 0) + number("output");
  next.cacheInputTokens = (next.cacheInputTokens ?? 0) + number("cacheRead");
  if (kind === "compaction") next.compactionTokens = (next.compactionTokens ?? 0) + number("input") + number("output");
  if (Number.isFinite(Number(usage.cost))) next.cost = (next.cost ?? 0) + Number(usage.cost);
  if (Number.isFinite(Number(usage.durationMs))) next.latencyMs = (next.latencyMs ?? 0) + Number(usage.durationMs);
  return next;
}
