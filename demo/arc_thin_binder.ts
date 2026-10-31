/** One file -> one versioned component. Binding is a request-boundary operation. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Workspace } from './arc_thin_workspace.ts';

export type ComponentSpec = { kind: string; name: string; description: string; enabled: boolean;
  parameters?: any; body?: string; tools?: string[]; refs?: string[]; view?: boolean; predictor?: boolean; guard?: boolean;
  mount?: Array<'decision' | 'action' | 'feedback'> };
export type Component = ComponentSpec & { path: string; version: number; hash: string; source: string; level: number };
type Entry = { path: string; version: number; hash: string; level: number; kind?: string; layer?: string; by?: string; decision?: number; error?: string; retired?: boolean; good?: Component };
export type Validator = (path: string, source: string) => Promise<ComponentSpec>;
const requirePi = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { parseDocument } = requirePi('yaml'); // Pi 0.87.0's pinned YAML dependency, full Agent Skills frontmatter.

/**
 * The five capability categories (Prompt, Memory, Tool, Skill, Subagent; Memory lives in the memory store), by
 * workspace place. lib/ holds code tools import (a dependency, not a capability); notes/, artifacts/ and other files
 * are plain workspace files. observers/ and roles/ are older places for view tools and subagents.
 */
export function componentKind(path: string): string | undefined {
  if (path.split('/').includes('_off')) return;
  if (/^(tools|observers)\/[^/]+\.py$/.test(path)) return 'tool';
  if (/^lib\/[^/]+\.py$/.test(path)) return 'library';
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return 'skill';
  if (/^prompts\/process\/[^/]+\.md$/.test(path)) return 'prompt';
  if (/^prompts\/[^/]+\.md$/.test(path)) return 'prompt';
  if (/^(agents|roles)\/[^/]+\.md$/.test(path)) return 'subagent';
}
/** The file conventions require only scalar values and lists, not an SDK. */
export function markdownSpec(path: string, source: string): ComponentSpec {
  const kind = componentKind(path)!; const name = kind === 'skill' ? path.split('/')[1]
    : `${path.startsWith('prompts/process/') ? 'process_' : ''}${path.split('/').at(-1)!.replace(/\.md$/, '')}`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw Error('markdown needs frontmatter');
  const doc = parseDocument(match[1]); if (doc.errors.length) throw Error(doc.errors.map((e: Error) => e.message).join('; '));
  const header: Record<string, any> = doc.toJS({ maxAliasCount: 20 });
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw Error('frontmatter must be a mapping');
  if (kind === 'prompt' && ![true, false].includes(header.active)) throw Error('prompt active must be true or false');
  if ((kind === 'subagent' || kind === 'skill') && !String(header.description ?? '').trim()) throw Error('description is required');
  if (kind === 'skill' && header.name !== name) throw Error('skill name must match its directory');
  if (kind === 'subagent' && (!Array.isArray(header.tools) || header.tools.some((t: string) => ['arc_action', 'consult', 'write', 'edit', 'memory', 'refine'].includes(t))))
    throw Error('subagent tools must be read, python or named tools; subagents never act');
  return { kind, name, description: String(header.description ?? match[2].split(/\r?\n/).find(s => s.trim()) ?? '').slice(0, 120),
    enabled: kind !== 'prompt' || header.active === true, body: match[2], tools: header.tools, refs: header.refs };
}

export class Binder {
  private entries = new Map<string, Entry>();
  private bindings = new Map<string, Component>();
  private saving: Promise<unknown> = Promise.resolve();
  private log: string; private versions: string;
  constructor(readonly workspace: Workspace, private validate?: Validator) {
    const store = join(workspace.root, '..', '.harness');
    this.versions = join(store, 'versions'); mkdirSync(this.versions, { recursive: true });
    this.log = join(store, 'components.jsonl');
    if (existsSync(this.log)) for (const line of readFileSync(this.log, 'utf8').trim().split('\n').filter(Boolean)) {
      const entry: Entry = JSON.parse(line);
      if (entry.good) entry.good.source = readFileSync(join(this.versions, `${entry.good.hash}.txt`), 'utf8');
      this.entries.set(entry.path, entry);
      this.remember(entry);
    }
  }
  private record(entry: Entry) {
    this.entries.set(entry.path, entry);
    this.remember(entry);
    const stored = { ...entry, ...(entry.good ? { good: { ...entry.good, source: undefined } } : {}) };
    appendFileSync(this.log, JSON.stringify(stored) + '\n');
  }
  /** Every saved version of every path (version → source hash), for restore. */
  private history = new Map<string, Map<number, string>>();
  private remember(entry: Entry) {
    if (entry.retired) return;
    const versions = this.history.get(entry.path) ?? new Map<number, string>();
    versions.set(entry.version, entry.hash); this.history.set(entry.path, versions);
  }
  /** The source of one saved version, or undefined. */
  sourceOf(path: string, version: number): string | undefined {
    const hash = this.history.get(path)?.get(version);
    const file = hash ? join(this.versions, `${hash}.txt`) : '';
    return file && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  }
  originOf(path: string): { by?: string; decision?: number } | undefined {
    const entry = this.entries.get(path);
    return entry ? { by: entry.by, decision: entry.decision } : undefined;
  }
  save(path: string, level: number, origin: { by: string; decision?: number } = { by: 'unknown' }): Promise<string | undefined> {
    if (/^(data|results)(\/|$)/.test(path)) return Promise.resolve(undefined);
    const kind = componentKind(path) ?? 'file';
    const source = this.workspace.read(path); // Capture the write, before queued validation starts.
    const work = this.saving.then(() => this.saveSource(path, level, kind, source, origin));
    this.saving = work.catch(() => undefined); return work;
  }
  private async saveSource(path: string, level: number, kind: string, source: string, origin: { by: string; decision?: number }) {
    const hash = createHash('sha256').update(source).digest('hex');
    const old = this.entries.get(path);
    if (old?.hash === hash && !old.retired) return kind === 'file' ? undefined : this.receipt(old, true);
    const target = join(this.versions, `${hash}.txt`);
    if (!existsSync(target)) writeFileSync(target, source, { flag: 'wx', encoding: 'utf8' });
    const entry: Entry = { path, version: (old?.version ?? 0) + 1, hash, level, kind,
      // B: ownership is recorded at save; layer follows the path, never an Agent declaration.
      layer: path.startsWith('prompts/process/') ? 'meta' : componentKind(path) ? 'self' : undefined, by: origin.by, decision: origin.decision, good: old?.good };
    try {
      const spec = kind === 'file' ? { kind, name: path, description: '', enabled: false }
        : kind === 'tool' || kind === 'library'
          ? await this.validate?.(path, source) : markdownSpec(path, source);
      if (!spec) throw Error('Python component binder not available');
      if (spec.kind === 'prompt') {
        const section = `prompt_${spec.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        const collision = [...this.entries].some(([otherPath, other]) => otherPath !== path && !other.retired && other.good?.kind === 'prompt'
          && `prompt_${other.good.name.replace(/[^a-zA-Z0-9_]/g, '_')}` === section);
        if (collision) throw Error(`prompt section name collision: ${section}`);
      }
      entry.good = { ...spec, source, path, hash, level, version: entry.version };
    } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
    this.record(entry); return kind === 'file' ? undefined : this.receipt(entry);
  }
  /**
   * What a save did, as the writer is told. `unchanged`: the content was already the current version, so nothing new
   * was saved (su15-p13-q38-1 #183: a repair that returned a crashing view as it was read "v3: saved · loaded").
   */
  private receipt(entry: Entry, unchanged = false) {
    const kind = componentKind(entry.path); const name = entry.good?.name ?? entry.path.split('/').at(-1)?.replace(/\.[^.]+$/, '');
    // A prompt is shown with each decision as it stood when the decision began (the head is built once per decision, and
    // in the system prompt a change mid-decision invalidated the provider's cached prefix on every later request of it,
    // pr-01 2026-10-14); it applies from the next decision.
    const from = kind === 'prompt' ? 'your next decision' : 'your next request';
    const failed = entry.error
      ? `NOT loaded (body: ${entry.error.replaceAll(entry.path, "component")} ) · ${entry.good ? `v${entry.good.version} still runs, its outputs are labelled` : 'no active version'}` : '';
    if (unchanged) return `${kind} ${name} v${entry.version}: unchanged, the same content as before · ` +
      (failed || (entry.good?.enabled ? 'loaded' : 'off'));
    return `${kind} ${name} v${entry.version}: saved · ` + (failed
      || (entry.good?.enabled ? `loaded · active from ${from}` : `off · not active from ${from}`));
  }
  async scan(level: number) {
    const paths = new Set(this.workspace.files().filter(p => !/^(data|results)(\/|$)/.test(p)));
    for (const [path, entry] of this.entries) if (!paths.has(path) && !entry.retired)
      this.record({ ...entry, retired: true });
    for (const path of paths) await this.save(path, level);
  }
  boundary() {
    this.bindings.clear();
    for (const [path, entry] of this.entries) if (!entry.retired && entry.good?.enabled) this.bindings.set(path, entry.good);
  }
  active(): Component[] { return [...this.bindings.values()].sort((a, b) => a.path.localeCompare(b.path)); }
  candidates(): Component[] {
    return [...this.entries.values()].filter(e => !e.retired && e.good?.enabled).map(e => e.good!);
  }
  versionMap(): Record<string, number> {
    return Object.fromEntries([...this.entries].filter(([, e]) => !e.retired && e.good).map(([path, e]) => [path, e.good!.version]));
  }
  label(path: string): string {
    const active = this.bindings.get(path); const entry = this.entries.get(path);
    return `${active?.name ?? path} v${active?.version ?? 'none'}${entry?.error ? ` (v${entry.version} failed)` : ''}`;
  }
  /**
   * The capability index: one line per saved prompt, tool, skill and subagent (memory has its own index). Libraries
   * and plain files are not listed. A tool's line says where it enters the decision (a view after each new state, a
   * predictor at each action, otherwise a call) and `usage` what it has done there (the runtime's counts, by path).
   */
  index(level: number, failedInputs: Set<string> = new Set(), usage: Map<string, string> = new Map(), includeProcess = true): string {
    const order = ['prompt', 'tool', 'skill', 'subagent'];
    const listed = [...this.entries].filter(([path, e]) => !e.retired && order.includes(componentKind(path) ?? '')
		&& (includeProcess || !path.startsWith('prompts/process/')))
      .sort((a, b) => order.indexOf(componentKind(a[0])!) - order.indexOf(componentKind(b[0])!) || a[0].localeCompare(b[0]));
    const lines = listed.map(([path, e]) => {
      const c = e.good; const kind = componentKind(path)!;
      const status = !c ? 'failed' : !c.enabled ? 'off' : c.level < level || c.refs?.some(r => failedInputs.has(r)) ? 'stale' : 'Created';
      return `${c?.name ?? path.split('/').at(-1)?.replace(/\.[^.]+$/, '')} | ${kind} | ${status} | via=${usage.get(path) ?? '0'}`;
    });
    // No saved component: no section (an empty header was shown at every decision of the 2026-10-12 real run).
    if (!lines.length) return '';
    const full = ['HARNESS (your prompts, tools, skills and subagents; memory is indexed above)', ...lines].join('\n');
    if (full.length <= 1200) return full;
    const groups = new Map<string, string[]>();
    for (const [path, e] of listed) { const kind = componentKind(path)!; groups.set(kind, [...(groups.get(kind) ?? []), e.good?.name ?? path.split('/').at(-1)!.replace(/\.[^.]+$/, '')]); }
    return ['HARNESS (logical names; read_component for content)', ...[...groups].map(([kind, names]) => `${kind}s: ${names.join(', ')}`),
      `${listed.filter(([, e]) => e.error).length} failed; receipts label last working versions.`].join('\n').slice(0, 1200);
  }
}
