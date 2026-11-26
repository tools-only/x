import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "memory" | "skill" | "prompt" | "subagent" | "tool";
export type Component = { kind: Kind; name: string; version: number; body: string; summary: string; hash: string };
const LIMIT: Record<Kind, number> = { memory: 2400, skill: 4000, prompt: 600, subagent: 1500, tool: 20000 };
const NAME = /^[a-z][a-z0-9_]{0,40}$/;

export class CognitiveComponents {
  private heads = new Map<string, number>();
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
    const path = join(root, "HEAD.json");
    if (existsSync(path)) this.heads = new Map(Object.entries(JSON.parse(readFileSync(path, "utf8"))));
  }
  private key(kind: Kind, name: string) { return `${kind}/${name}`; }
  private path(kind: Kind, name: string, version: number) { return join(this.root, kind, name, `v${version}.json`); }
  current(kind: Kind, name: string): Component | undefined {
    const version = this.heads.get(this.key(kind, name));
    return version ? this.read(kind, name, version) : undefined;
  }
  read(kind: Kind, name: string, version: number): Component {
    if (!NAME.test(name) || !Number.isInteger(version) || version < 1) throw Error("invalid component reference");
    const component = JSON.parse(readFileSync(this.path(kind, name, version), "utf8")) as Component;
    const hash = createHash("sha256").update(component.body).digest("hex");
    if (component.kind !== kind || component.name !== name || component.version !== version || component.hash !== hash)
      throw Error("component version failed integrity check");
    return component;
  }
  list(kind?: Kind): Component[] {
    return [...this.heads].filter(([key]) => !kind || key.startsWith(kind + "/"))
      .map(([key, version]) => { const [k, name] = key.split("/"); return this.read(k as Kind, name, version); });
  }
  reflect(op: "define" | "redefine" | "restore", kind: Kind, name: string, body?: string, summary = "", version?: number): Component {
    if (!NAME.test(name)) throw Error("component name must be lowercase letters, digits or underscore");
    const current = this.current(kind, name);
    if (op === "define" && current) throw Error("component already exists; use redefine");
    if (op !== "define" && !current) throw Error("component does not exist; use define");
    if (op === "restore") {
      if (!version) throw Error("restore requires a version");
      const prior = this.read(kind, name, version);
      body = prior.body;
      summary = prior.summary;
    }
    if (!body?.trim() || body.length > LIMIT[kind]) throw Error(`${kind} body must have 1–${LIMIT[kind]} characters`);
    if (kind === "skill" && !summary.trim()) throw Error("skill needs a one-line summary");
    if (summary.includes("\n")) throw Error("summary must be one line");
    const next = (current?.version ?? 0) + 1;
    const component: Component = { kind, name, version: next, body,
      summary: summary.slice(0, 120), hash: createHash("sha256").update(body).digest("hex") };
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

