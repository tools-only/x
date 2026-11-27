import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "memory" | "skill" | "prompt" | "subagent" | "tool";
export type VerifyRuleInput = string | { when: string; assert: string };
export type LifecycleStatus = "active" | "provisional" | "confirmed" | "contradicted" | "review_due" | "variant_broken" | "dormant";
export type Component = { id?: string; kind: Kind; name: string; version: number; body: string; summary: string; hash: string; verify?: Record<string, string>; retired?: boolean; layer?: "L1" | "L2" | "L3" | "L4" | "L5"; scope?: "level" | "game"; status?: LifecycleStatus; last_promoted_level?: number; when?: string; out_branch?: string };
export type ReflectOp = "define" | "redefine" | "restore" | "add" | "revise" | "retire" | "merge" | "promote" | "demote";
export type StatsBucket = { invocations: number; ok: number; action_producing: number; reads: number; failures: number };
export type ComponentStats = {
  defined_level: number; updated_level: number; defined_step: number; updated_step: number;
  last_used_level?: number; last_used_step?: number;
  by_level: Record<string, StatsBucket>; total: StatsBucket;
  consecutive_failures: number; last_failure_witness?: string;
  consecutive_publish_failures: number; last_publish_error?: string;
};
const LIMIT: Record<Kind, number> = { memory: 2400, skill: 4000, prompt: 600, subagent: 1500, tool: 10000 };
const NAME = /^[a-z][a-z0-9_]{0,40}$/;
const emptyBucket = (): StatsBucket => ({ invocations: 0, ok: 0, action_producing: 0, reads: 0, failures: 0 });
const digest = (body: string, verify?: Record<string, string>) => {
  const entries = verify ? Object.entries(verify).sort(([a], [b]) => a.localeCompare(b)) : [];
  const payload = entries.length ? `${body}\0${JSON.stringify(entries)}` : body;
  return createHash("sha256").update(payload).digest("hex");
};
function scanTopLevel(expr: string): { hasIfElse: boolean; hasOr: boolean; andClauses: string[] } {
  let depth = 0;
  let quote: string | null = null;
  let hasIf = false;
  let hasElse = false;
  let hasOr = false;
  const andClauses: string[] = [];
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\" && i + 1 < expr.length) { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth += 1; continue; }
    if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) { depth -= 1; continue; }
    if (depth !== 0) continue;
    if (/[A-Za-z_]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(expr[i - 1]))) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j += 1;
      const word = expr.slice(i, j);
      if (word === "if") hasIf = true;
      else if (word === "else" && hasIf) hasElse = true;
      else if (word === "or") hasOr = true;
      else if (word === "and") {
        andClauses.push(expr.slice(start, i).trim());
        start = j;
      }
      i = j - 1;
    }
  }
  andClauses.push(expr.slice(start).trim());
  return { hasIfElse: hasIf && hasElse, hasOr, andClauses };
}
const OUTCOME_REF = /\b(?:after_frame|frame_diff|result|changed)\b|\bdiff\s*\(/;
export function normalizeVerifyExpr(raw: VerifyRuleInput): string {
  if (raw && typeof raw === "object") {
    const whenExpr = String(raw.when ?? "").trim();
    const assertExpr = String(raw.assert ?? "").trim();
    if (!whenExpr || !assertExpr || whenExpr.includes("\n") || assertExpr.includes("\n"))
      throw Error("verify expression must be one line of 1–320 characters");
    const formatted = `(${assertExpr}) if (${whenExpr}) else None`;
    if (formatted.length > 320) throw Error("verify expression must be one line of 1–320 characters");
    return formatted;
  }
  let expr = String(raw ?? "").trim();
  if (!expr || expr.includes("\n")) throw Error("verify expression must be one line of 1–320 characters");
  const { hasIfElse, hasOr, andClauses } = scanTopLevel(expr);
  if (!hasIfElse && !hasOr && andClauses.length >= 2) {
    const guardParts: string[] = [];
    let splitIdx = 0;
    for (; splitIdx < andClauses.length; splitIdx += 1) {
      const clause = andClauses[splitIdx];
      if (clause && /\bt\.action\b/.test(clause) && !OUTCOME_REF.test(clause)) guardParts.push(clause);
      else break;
    }
    const assertParts = andClauses.slice(splitIdx).filter(Boolean);
    if (guardParts.length > 0 && assertParts.length > 0) {
      expr = `(${assertParts.join(" and ")}) if (${guardParts.join(" and ")}) else None`;
    }
  }
  if (expr.length > 320) throw Error("verify expression must be one line of 1–320 characters");
  return expr;
}
const cleanVerify = (kind: Kind, verify?: Record<string, VerifyRuleInput>) => {
  if (verify === undefined) return undefined;
  if (kind !== "memory") throw Error("verify is supported on memory components only");
  const entries = Object.entries(verify);
  if (!entries.length) return undefined;
  if (entries.length > 6) throw Error("verify supports at most 6 rules");
  const cleaned: Record<string, string> = {};
  for (const [key, rawExpr] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!NAME.test(key)) throw Error("verify rule name must be lowercase letters, digits or underscore");
    cleaned[key] = normalizeVerifyExpr(rawExpr);
  }
  return cleaned;
};

export class LayeredComponents {
  private heads = new Map<string, number>();
  private metrics = new Map<string, ComponentStats>();
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
    const path = join(root, "HEAD.json");
    if (existsSync(path)) this.heads = new Map(Object.entries(JSON.parse(readFileSync(path, "utf8"))));
    const statsPath = join(root, "stats.json");
    if (existsSync(statsPath)) this.metrics = new Map(Object.entries(JSON.parse(readFileSync(statsPath, "utf8"))));
  }
  private key(kind: Kind, name: string) { return `${kind}/${name}`; }
  private path(kind: Kind, name: string, version: number) { return join(this.root, kind, name, `v${version}.json`); }
  private saveStats() {
    const file = join(this.root, "stats.json"), temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(this.metrics)), "utf8");
    renameSync(temp, file);
  }
  private ensureStats(kind: Kind, name: string, level: number, step: number): ComponentStats {
    const key = this.key(kind, name);
    let entry = this.metrics.get(key);
    if (!entry) {
      entry = { defined_level: level, updated_level: level, defined_step: step, updated_step: step,
        by_level: {}, total: emptyBucket(), consecutive_failures: 0, consecutive_publish_failures: 0 };
      this.metrics.set(key, entry);
    }
    return entry;
  }
  stats(kind: Kind, name: string): ComponentStats | undefined { return this.metrics.get(this.key(kind, name)); }
  allStats(): Record<string, ComponentStats> { return Object.fromEntries(this.metrics); }
  recordChange(kind: Kind, name: string, level: number, step: number) {
    const entry = this.ensureStats(kind, name, level, step);
    entry.updated_level = level;
    entry.updated_step = step;
    entry.consecutive_failures = 0;
    entry.consecutive_publish_failures = 0;
    entry.last_publish_error = undefined;
    this.saveStats();
  }
  recordRead(kind: Kind, name: string, level: number, step: number) {
    const entry = this.ensureStats(kind, name, level, step);
    const bucket = entry.by_level[String(level)] ??= emptyBucket();
    bucket.reads += 1;
    entry.total.reads += 1;
    entry.last_used_level = level;
    entry.last_used_step = step;
    this.saveStats();
  }
  recordInvocation(kind: Kind, name: string, level: number, step: number, outcome: { ok: boolean; action_producing?: boolean; witness?: string }) {
    const entry = this.ensureStats(kind, name, level, step);
    const bucket = entry.by_level[String(level)] ??= emptyBucket();
    for (const b of [bucket, entry.total]) {
      b.invocations += 1;
      if (outcome.ok) {
        b.ok += 1;
        if (outcome.action_producing) b.action_producing += 1;
      } else {
        b.failures += 1;
      }
    }
    entry.last_used_level = level;
    entry.last_used_step = step;
    if (outcome.ok) {
      entry.consecutive_failures = 0;
    } else {
      entry.consecutive_failures += 1;
      if (outcome.witness) entry.last_failure_witness = outcome.witness.replace(/\s+/g, " ").trim().slice(0, 160);
    }
    this.saveStats();
    return entry;
  }
  recordPublishFailure(name: string, level: number, step: number, error: string) {
    const entry = this.ensureStats("tool", name, level, step);
    entry.consecutive_publish_failures += 1;
    entry.last_publish_error = error.replace(/\s+/g, " ").trim().slice(0, 160);
    this.saveStats();
    return entry;
  }
  current(kind: Kind, name: string): Component | undefined {
    const version = this.heads.get(this.key(kind, name));
    return version ? this.read(kind, name, version) : undefined;
  }
  read(kind: Kind, name: string, version: number): Component {
    if (!NAME.test(name) || !Number.isInteger(version) || version < 1) throw Error("invalid component reference");
    const component = JSON.parse(readFileSync(this.path(kind, name, version), "utf8")) as Component;
    const hash = digest(component.body, component.verify);
    if (component.kind !== kind || component.name !== name || component.version !== version || component.hash !== hash)
      throw Error("component version failed integrity check");
    return { ...component, id: this.key(kind, name) };
  }
  list(kind?: Kind): Component[] {
    return [...this.heads].filter(([key]) => !kind || key.startsWith(kind + "/"))
      .map(([key, version]) => { const [k, name] = key.split("/"); return this.read(k as Kind, name, version); })
      .filter(component => !component.retired);
  }
  onLevelTransition(fromLevel: number, toLevel: number) {
    for (const item of this.list()) {
      if ((item.scope ?? "level") !== "level" || item.status === "dormant") continue;
      this.reflect("revise", item.kind, item.name, item.body, item.summary, undefined, item.verify, { status: "dormant" });
    }
  }
  updateProof(name: string, level: number, buckets: Record<string, { support: number; counter: number }>) {
    const item = this.current("memory", name);
    if (!item || item.retired || item.status === "dormant") return;
    const bucket = buckets[String(level)];
    const failed = (bucket?.counter ?? 0) > 0;
    const confirmed = item.status === "provisional" && level !== item.last_promoted_level &&
      (bucket?.support ?? 0) >= 3 && !failed && Object.entries(buckets).some(([key, value]) => Number(key) !== level && value.support > 0);
    if (failed && item.status !== "contradicted" || confirmed)
      return this.reflect("revise", "memory", name, item.body, item.summary, undefined, item.verify,
        { status: failed ? "contradicted" : "confirmed" });
  }
  reflect(op: ReflectOp, kind: Kind, name: string, body?: string, summary = "", version?: number,
          verify?: Record<string, VerifyRuleInput>, metadata?: { layer?: Component["layer"]; scope?: Component["scope"]; status?: LifecycleStatus; last_promoted_level?: number; sources?: string[] }): Component {
    if (!NAME.test(name)) throw Error("component name must be lowercase letters, digits or underscore");
    if (metadata?.scope && !["level", "game"].includes(metadata.scope)) throw Error("invalid component scope");
    if (metadata?.layer && !/^L[1-5]$/.test(metadata.layer)) throw Error("invalid component layer");
    const current = this.current(kind, name);
    const adding = op === "define" || op === "add";
    if (adding && current) throw Error("component already exists; use revise");
    if (!adding && !current) throw Error("component does not exist; use add");
    const sources = op === "merge" ? (metadata?.sources ?? []).map(source => {
      if (source === name) throw Error("merge source must differ from target");
      const item = this.current(kind, source);
      if (!item || item.retired) throw Error("merge source is not active");
      return item;
    }) : [];
    if (op === "merge" && !sources.length) throw Error("merge requires sources and replacement body");
    let retired = op === "retire";
    if ((retired || op === "promote" || op === "demote") && current) {
      body = current.body;
      summary = current.summary;
      verify = current.verify;
    }
    if (op === "restore") {
      if (!version) throw Error("restore requires a version");
      const prior = this.read(kind, name, version);
      body = prior.body;
      summary = prior.summary;
      verify = prior.verify;
      retired = Boolean(prior.retired);
      metadata = { layer: prior.layer, scope: prior.scope, status: prior.status, last_promoted_level: prior.last_promoted_level };
    }
    if (!body?.trim() || body.length > LIMIT[kind]) throw Error(`${kind} body must have 1–${LIMIT[kind]} characters`);
    if (kind === "skill" && !summary.trim()) throw Error("skill needs a one-line summary");
    if (summary.includes("\n")) throw Error("summary must be one line");
    const clean = cleanVerify(kind, verify);
    const next = (current?.version ?? 0) + 1;
    const component: Component = { layer: current?.layer, scope: current?.scope ?? (kind === "tool" || kind === "skill" ? "game" : "level"), status: op === "revise" || op === "merge" ? "active" : current?.status ?? "active", last_promoted_level: current?.last_promoted_level, ...metadata, ...(op === "promote" ? { scope: "game" as const, status: "provisional" as const } : op === "demote" ? { scope: "level" as const, status: "dormant" as const } : {}), id: this.key(kind, name), kind, name, version: next, body,
      ...(retired ? { retired: true } : {}),
      summary: summary.slice(0, 120), ...(clean ? { verify: clean } : {}), hash: digest(body, clean) };
    {
      component.when = /^\s*#?\s*when:[ \t]*(.+)$/mi.exec(body)?.[1].trim().slice(0, 120);
      component.out_branch = /^\s*#?\s*out\/branch:[ \t]*(.+)$/mi.exec(body)?.[1].trim().slice(0, 120);
    }
    const path = this.path(kind, name, next);
    mkdirSync(join(this.root, kind, name), { recursive: true });
    writeFileSync(path, JSON.stringify(component), "utf8");
    this.heads.set(this.key(kind, name), next);
    const head = join(this.root, "HEAD.json"), temp = `${head}.tmp`, headsJson = JSON.stringify(Object.fromEntries(this.heads));
    writeFileSync(temp, headsJson, "utf8");
    try { renameSync(temp, head); } catch { writeFileSync(head, headsJson, "utf8"); }
    for (const source of sources) this.reflect("retire", kind, source.name);
    return component;
  }
}
