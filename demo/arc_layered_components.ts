import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "memory" | "skill" | "prompt" | "subagent" | "tool";
export type Component = { kind: Kind; name: string; version: number; body: string; summary: string; hash: string; verify?: Record<string, string> };
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
const cleanVerify = (kind: Kind, verify?: Record<string, string>) => {
  if (verify === undefined) return undefined;
  if (kind !== "memory") throw Error("verify is supported on memory components only");
  const entries = Object.entries(verify);
  if (!entries.length) return undefined;
  if (entries.length > 6) throw Error("verify supports at most 6 rules");
  const cleaned: Record<string, string> = {};
  for (const [key, rawExpr] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!NAME.test(key)) throw Error("verify rule name must be lowercase letters, digits or underscore");
    const expr = String(rawExpr ?? "").trim();
    if (!expr || expr.length > 240 || expr.includes("\n"))
      throw Error("verify expression must be one line of 1–240 characters");
    cleaned[key] = expr;
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
    return component;
  }
  list(kind?: Kind): Component[] {
    return [...this.heads].filter(([key]) => !kind || key.startsWith(kind + "/"))
      .map(([key, version]) => { const [k, name] = key.split("/"); return this.read(k as Kind, name, version); });
  }
  reflect(op: "define" | "redefine" | "restore", kind: Kind, name: string, body?: string, summary = "", version?: number,
          verify?: Record<string, string>): Component {
    if (!NAME.test(name)) throw Error("component name must be lowercase letters, digits or underscore");
    const current = this.current(kind, name);
    if (op === "define" && current) throw Error("component already exists; use redefine");
    if (op !== "define" && !current) throw Error("component does not exist; use define");
    if (op === "restore") {
      if (!version) throw Error("restore requires a version");
      const prior = this.read(kind, name, version);
      body = prior.body;
      summary = prior.summary;
      verify = prior.verify;
    }
    if (!body?.trim() || body.length > LIMIT[kind]) throw Error(`${kind} body must have 1–${LIMIT[kind]} characters`);
    if (kind === "skill" && !summary.trim()) throw Error("skill needs a one-line summary");
    if (summary.includes("\n")) throw Error("summary must be one line");
    const clean = cleanVerify(kind, verify);
    const next = (current?.version ?? 0) + 1;
    const component: Component = { kind, name, version: next, body,
      summary: summary.slice(0, 120), ...(clean ? { verify: clean } : {}), hash: digest(body, clean) };
    const path = this.path(kind, name, next);
    mkdirSync(join(this.root, kind, name), { recursive: true });
    writeFileSync(path, JSON.stringify(component), "utf8");
    this.heads.set(this.key(kind, name), next);
    const head = join(this.root, "HEAD.json"), temp = `${head}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(this.heads)), "utf8");
    renameSync(temp, head);
    return component;
  }
}
