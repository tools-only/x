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

type Checkpoint = { version: number; defs: Array<[string, string]>; blob: string; sha: string; names: string[]; chars: number };
const EMPTY: Checkpoint = { version: 0, defs: [], blob: "", sha: "", names: [], chars: 0 };
const digest = (checkpoint: Checkpoint) => createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex");
const kb = (chars: number) => `${Math.max(1, Math.round(chars / 1000))} KB`;
const listed = (items: string[], limit = 300) => { const text = items.join(", "); return text.length > limit ? `${text.slice(0, limit)}…` : text; };

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
  /** What a python call receives. */
  payload() { return { defs: this.state.defs, blob: this.state.blob, sha: this.state.sha, cap: SESSION_CAP_CHARS }; }
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
   * was not kept with its reason. An unchanged session says nothing.
   */
  commit(report: SessionReport | undefined): SessionOutcome {
    if (!report) return { receipt: "", committed: false, version: this.state.version };
    const lines: string[] = [];
    let committed = false, event: string | undefined;
    if (report.load_error) {
      const bad = this.state.version, now = this.rollback();
      event = "rolled_back";
      lines.push(`(python session v${bad} could not be restored: ${report.load_error}. ` +
        (now ? `It is back at v${now}: ${listed(this.names()) || "empty"}.` : "It is empty now.") + " Nothing from this call was kept.)");
    } else if (report.error) {
      event = "not_saved";
      lines.push(`(python session NOT saved: ${report.error}. The state before this call is kept.)`);
    } else if (report.over) {
      event = "over_capacity";
      const largest = report.over.largest.map(([name, chars]) => `${name} ${kb(chars)}`).join(", ");
      lines.push(`(python session NOT saved: it needs ${kb(report.over.chars)} and the limit is ${kb(report.over.cap || SESSION_CAP_CHARS)}` +
        `${largest ? `; largest: ${largest}` : ""}. The state before this call is kept, so nothing this call defined or changed is there next time: ` +
        "del what you do not need, or write large data to a file.)");
    } else if (!report.unchanged && report.sha !== undefined) {
      const before = new Set(this.names());
      const next: Checkpoint = { version: this.latest + 1, defs: report.defs ?? [], blob: report.blob ?? "", sha: report.sha,
        names: report.names ?? [], chars: report.chars ?? 0 };
      this.write(next);
      this.state = next; this.latest = next.version; committed = true; event = "committed";
      const after = new Set(this.names());
      const changes = [...[...after].filter((name) => !before.has(name)).map((name) => `+${name}`), ...[...before].filter((name) => !after.has(name)).map((name) => `-${name}`)];
      if (changes.length) lines.push(`(python session: ${listed(changes)})`);
    }
    if (report.unsupported?.length)
      lines.push(`(not kept in the python session: ${listed(report.unsupported.map(([name, why]) => `${name} (${why})`), 500)})`);
    if (report.failed_defs?.length)
      lines.push(`(definitions that no longer run and were dropped: ${listed(report.failed_defs.map(([name, why]) => `${name} (${why})`), 400)})`);
    if (report.gone?.length)
      lines.push(`(dropped from the python session, their definitions no longer load: ${listed(report.gone)}` +
        `${report.gone_refs?.length ? ` [${listed(report.gone_refs, 200)}]` : ""})`);
    return { receipt: lines.join("\n"), committed, version: this.state.version, ...(event ? { event } : {}) };
  }
}
