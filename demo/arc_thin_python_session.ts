/**
 * The python session's host side: where the checkpoint of the agent's python namespace lives.
 *
 * The guest (arc_thin_components.ts) pickles the namespace after every python call and reports it; this class decides
 * whether it becomes the new state and says so accurately. The bytes are opaque here and are never unpickled.
 *   - A commit is all or nothing: one file per version, written to a temporary name and renamed, then the head pointer.
 *   - The last versions are kept, so a damaged file falls back to the one before it.
 *   - Over capacity, unverifiable or unloadable never commits and never evicts: the previous state stays and the
 *     receipt says why.
 *   - Restoring after a restart reads files only. No code of the agent runs on the host, and the guest re-runs
 *     definitions with acting disabled, so recovery never repeats an environment action.
 * Without a directory the session lives in memory (a subagent's own session for one consult).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReport } from "./arc_thin_components.ts";

/** Checkpoint capacity: base64 of the compressed namespace plus the source of kept definitions, in characters. */
export const SESSION_CAP_CHARS = 128_000;
const KEEP_VERSIONS = 5;

type Checkpoint = { version: number; defs: Array<[string, string]>; blob: string; sha: string; names: string[]; chars: number; functions?: boolean;
  brief?: Record<string, string> };
const EMPTY: Checkpoint = { version: 0, defs: [], blob: "", sha: "", names: [], chars: 0 };
const digest = (checkpoint: Checkpoint) => createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex");
const kb = (chars: number) => `${Math.max(1, Math.round(chars / 1000))} KB`;
const listed = (items: string[], limit = 300) => { const text = items.join(", "); return text.length > limit ? `${text.slice(0, limit)}…` : text; };
/** A kept definition's parameters as written, "(grid, color)"; "class" for a class; "" when its source does not say. */
const signatureOf = (name: string, source: string) => {
  const m = new RegExp(`^\\s*(?:async\\s+)?(def|class)\\s+${name.replace(/[^\w]/g, "")}\\b\\s*(\\([^)]*\\))?`, "m").exec(source);
  return !m ? "" : m[1] === "class" ? "class" : (m[2] ?? "").replace(/\s+/g, " ");
};

export type SessionOutcome = { receipt: string; committed: boolean; version: number; event?: string };

export class PythonSession {
  private state: Checkpoint = EMPTY;
  /** The highest version number ever used, so a rolled-back version is never reused. */
  private latest = 0;
  /** Set when the session was read from disk at construction: the version restored. */
  readonly recovered?: number;
  constructor(private dir?: string) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const versions = this.versions();
    this.latest = versions[0] ?? 0;
    let head: number | undefined;
    try { head = Number(JSON.parse(readFileSync(join(dir, "HEAD.json"), "utf8")).version); } catch { /* fall back to the files */ }
    // The head names the committed version; a version file newer than it was written but never committed.
    for (const version of versions.filter((v) => head === undefined || !Number.isFinite(head) || v <= head)) {
      const loaded = this.read(version);
      if (loaded) { this.state = loaded; this.recovered = version; break; }
    }
  }
  private file(version: number) { return join(this.dir!, `v${version}.json`); }
  /** Version numbers on disk, newest first. */
  private versions(): number[] {
    if (!this.dir || !existsSync(this.dir)) return [];
    return readdirSync(this.dir).map((name) => /^v(\d+)\.json$/.exec(name)).filter(Boolean).map((m) => Number(m![1])).sort((a, b) => b - a);
  }
  private read(version: number): Checkpoint | undefined {
    try {
      const { checkpoint, sha256 } = JSON.parse(readFileSync(this.file(version), "utf8"));
      return checkpoint?.version === version && digest(checkpoint) === sha256 ? checkpoint : undefined;
    } catch { return undefined; }
  }
  private write(checkpoint: Checkpoint) {
    if (!this.dir) return;
    const atomic = (path: string, body: string) => { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, body, "utf8"); renameSync(tmp, path); };
    atomic(this.file(checkpoint.version), JSON.stringify({ checkpoint, sha256: digest(checkpoint) }));
    atomic(join(this.dir, "HEAD.json"), JSON.stringify({ version: checkpoint.version, at: new Date().toISOString() }));
    for (const old of this.versions().slice(KEEP_VERSIONS)) rmSync(this.file(old), { force: true });
  }
  get version() { return this.state.version; }
  private tail: Promise<unknown> = Promise.resolve();
  /** Calls that share a session run one at a time, as in a kernel: each sees what the one before it left. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.catch(() => undefined);
    return run;
  }
  /** Everything the session holds by name: values and definitions. */
  names(): string[] { return [...this.state.defs.map(([name]) => `${name}()`), ...this.state.names]; }
  /**
   * What the namespace holds now, name -> what it is (definitions as name(), first; then names in order). In a live
   * kernel this is the namespace itself, including what the checkpoint could not keep; otherwise the last checkpoint.
   */
  private live?: Record<string, string>;
  /** In a live kernel, what was already said about the checkpoint, so the same notice is not repeated every call. */
  private noted = { over: "", unsupported: new Set<string>() };
  /** Names whose function was already reported lost to a value (once per name). */
  private overwritten = new Set<string>();
  holding(): Record<string, string> {
    const brief = this.live ?? Object.fromEntries([...this.state.defs.map(([name, source]) => [`${name}()`, signatureOf(name, source)] as [string, string]),
      ...this.state.names.map((name) => [name, this.state.brief?.[name] ?? ""] as [string, string])]);
    const names = Object.keys(brief);
    return Object.fromEntries([...names.filter((name) => name.endsWith("()")), ...names.filter((name) => !name.endsWith("()")).sort()]
      .map((name) => [name, brief[name]]));
  }
  /** The live kernel ended: what it held beyond the checkpoint is gone, and the next kernel starts from the checkpoint. */
  kernelEnded() { this.live = undefined; this.noted = { over: "", unsupported: new Set() }; }
  /**
   * One line for the agent: the names its python code can use without rebuilding anything, functions with their
   * parameters (work memory: re-typed helpers were mostly helpers the agent could not see how to call). Empty when there
   * are none.
   */
  view(limit = 900): string {
    const entries = Object.entries(this.holding());
    if (!entries.length) return "";
    const head = "PYTHON SESSION (defined by your earlier python calls and still there; use these names instead of recomputing or re-reading): ";
    const item = ([name, what]: [string, string]) => name.endsWith("()") && what.startsWith("(") ? `${name.slice(0, -2)}${what}`
      : name.endsWith("()") && what === "class" ? `${name.slice(0, -2)} (class)` : what ? `${name} ${what}` : name;
    let text = entries.map(item).join(", ");
    if (head.length + text.length > limit) text = entries.map(([name]) => name).join(", ");
    if (head.length + text.length > limit) {
      const shown: string[] = [];
      let used = 0;
      for (const [name] of entries) { if (used + name.length + 2 > limit - head.length - 40) break; shown.push(name); used += name.length + 2; }
      text = `${shown.join(", ")}, … ${entries.length - shown.length} more (dir() lists them)`;
    }
    return head + text;
  }
  /** What a python call receives. */
  payload() { return { defs: this.state.defs, blob: this.state.blob, sha: this.state.sha, cap: SESSION_CAP_CHARS,
    ...(this.state.functions ? {functions: true} : {}) }; }
  /** Step back to the newest older version that reads, or to empty. */
  private rollback(): number {
    const bad = this.state.version;
    if (this.dir) { try { renameSync(this.file(bad), `${this.file(bad)}.bad`); } catch { /* already gone */ } }
    this.state = EMPTY;
    for (const version of this.versions().filter((v) => v < bad)) {
      const loaded = this.read(version);
      if (loaded) { this.state = loaded; break; }
    }
    if (this.dir) writeFileSync(join(this.dir, "HEAD.json"), JSON.stringify({ version: this.state.version, at: new Date().toISOString(), rolled_back_from: bad }), "utf8");
    return this.state.version;
  }
  /**
   * Apply what one python call reported. The receipt is what the agent is told: changes by name, and anything that
   * was not kept with its reason. An unchanged session says nothing. `live`: the call ran in a live kernel, so what it
   * defined stays defined even when the checkpoint is not written; only a kernel restart falls back to the checkpoint.
   */
  commit(report: SessionReport | undefined, live = false): SessionOutcome {
    if (!report) return { receipt: "", committed: false, version: this.state.version };
    const lines: string[] = [];
    let committed = false, event: string | undefined;
    const before = Object.keys(this.holding());
    const sources = new Map(this.state.defs);
    if (report.load_error) {
      const bad = this.state.version, now = this.rollback();
      this.live = undefined;
      event = "rolled_back";
      lines.push(`(python session v${bad} could not be restored: ${report.load_error}. ` +
        (now ? `It is back at v${now}: ${listed(this.names()) || "empty"}.` : "It is empty now.") + " Nothing from this call was kept.)");
    } else if (report.error) {
      event = "not_saved";
      lines.push(live ? `(python session: everything is still defined, but the checkpoint failed: ${report.error}. A kernel restart would bring back v${this.state.version}.)`
        : `(python session NOT saved: ${report.error}. The state before this call is kept.)`);
    } else if (report.over) {
      event = "over_capacity";
      const largest = report.over.largest.map(([name, chars]) => `${name} ${kb(chars)}`).join(", ");
      const size = `it needs ${kb(report.over.chars)} and the limit is ${kb(report.over.cap || SESSION_CAP_CHARS)}${largest ? `; largest: ${largest}` : ""}`;
      const key = report.over.largest.map(([name]) => name).join(",");
      if (!live) lines.push(`(python session NOT saved: ${size}. The state before this call is kept, so nothing this call defined or changed is there next time: ` +
        "del what you do not need, or write large data to a file.)");
      else if (key !== this.noted.over) lines.push(`(python session: everything is still defined, but its checkpoint is not written until it fits: ${size}. ` +
        `A kernel restart would bring back v${this.state.version}: del what you do not need, or write large data to a file.)`);
      if (live) this.noted.over = key;
    } else if (!report.unchanged && report.sha !== undefined) {
      const next: Checkpoint = { version: this.latest + 1, defs: report.defs ?? [], blob: report.blob ?? "", sha: report.sha,
        names: report.names ?? [], chars: report.chars ?? 0, ...(report.functions ? {functions: true} : {}),
        ...(report.brief ? { brief: Object.fromEntries((report.names ?? []).map((name) => [name, report.brief![name] ?? ""])) } : {}) };
      this.write(next);
      this.state = next; this.latest = next.version; committed = true; event = "committed";
      this.noted.over = "";
    }
    if (!report.load_error && (live || committed)) {
      if (live && report.brief) this.live = report.brief;
      const now = this.holding();
      const after = Object.keys(now);
      const changes = [...after.filter((name) => !before.includes(name)).map((name) => `+${name}`), ...before.filter((name) => !after.includes(name)).map((name) => `-${name}`)];
      if (changes.length) lines.push(`(python session: ${listed(changes)})`);
      // A function the agent defined that this call bound to a value is gone, said once per name in plain words: in
      // su15-p13-q38-1 `diff = [...]` at #38 replaced the diff(a, b) defined at #35, the receipt read "+diff, -diff()",
      // and 30 later cells computed the difference by hand.
      for (const name of before.filter((key) => key.endsWith("()") && !after.includes(key)).map((key) => key.slice(0, -2))) {
        const what = now[name];
        if (what === undefined || what === "function" || what === "class" || this.overwritten.has(name)) continue;
        this.overwritten.add(name);
        const signature = /^\s*(?:async\s+)?def\s+(\w+\s*\(.*?\))\s*(?:->[^:\n]*)?:/m.exec(sources.get(name) ?? "")?.[1]?.replace(/\s+/g, " ") ?? `${name}()`;
        lines.push(`(${name} was your function ${signature}; this call bound ${name} to ${what || "a value"}, so the function is no longer in the session)`);
      }
    }
    // In a live kernel a value the checkpoint cannot hold stays defined; it is named once, not on every call.
    const unsupported = (report.unsupported ?? []).filter(([name]) => !live || !this.noted.unsupported.has(name));
    if (live) this.noted.unsupported = new Set((report.unsupported ?? []).map(([name]) => name));
    if (unsupported.length)
      lines.push(live ? `(defined, but not in the checkpoint, so a kernel restart loses them: ${listed(unsupported.map(([name, why]) => `${name} (${why})`), 500)})`
        : `(not kept in the python session: ${listed(unsupported.map(([name, why]) => `${name} (${why})`), 500)})`);
    if (report.failed_defs?.length)
      lines.push(`(definitions that no longer run and were dropped: ${listed(report.failed_defs.map(([name, why]) => `${name} (${why})`), 400)})`);
    if (report.gone?.length)
      lines.push(`(dropped from the python session, their definitions no longer load: ${listed(report.gone)}` +
        `${report.gone_refs?.length ? ` [${listed(report.gone_refs, 200)}]` : ""})`);
    return { receipt: lines.join("\n"), committed, version: this.state.version, ...(event ? { event } : {}) };
  }
}
