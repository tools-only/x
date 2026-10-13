/** One file -> one versioned component. Binding is a request-boundary operation. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Workspace } from './arc_thin_workspace.ts';

export type ComponentSpec = { kind: string; name: string; description: string; enabled: boolean;
  parameters?: any; body?: string; tools?: string[]; refs?: string[] };
export type Component = ComponentSpec & { path: string; version: number; hash: string; source: string; level: number };
type Entry = { path: string; version: number; hash: string; level: number; error?: string; retired?: boolean; good?: Component };
export type Validator = (path: string, source: string) => Promise<ComponentSpec>;
const requirePi = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { parseDocument } = requirePi('yaml'); // Pi 0.87.0's pinned YAML dependency, full Agent Skills frontmatter.

export function componentKind(path: string): string | undefined {
  if (path.split('/').includes('_off')) return;
  if (/^(tools|observers|lib)\/[^/]+\.py$/.test(path)) return { tools: 'tool', observers: 'observer', lib: 'library' }[path.split('/')[0]];
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return 'skill';
  if (/^(prompts|roles|notes)\/[^/]+\.md$/.test(path)) return { prompts: 'prompt', roles: 'role', notes: 'note' }[path.split('/')[0]];
}
/** The file conventions require only scalar values and lists, not an SDK. */
export function markdownSpec(path: string, source: string): ComponentSpec {
  const kind = componentKind(path)!; const name = kind === 'skill' ? path.split('/')[1] : path.split('/').at(-1)!.replace(/\.md$/, '');
  if (kind === 'note') return { kind, name, description: source.split(/\r?\n/)[0].slice(0, 100), enabled: true };
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw Error('markdown needs frontmatter');
  const doc = parseDocument(match[1]); if (doc.errors.length) throw Error(doc.errors.map((e: Error) => e.message).join('; '));
  const header: Record<string, any> = doc.toJS({ maxAliasCount: 20 });
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw Error('frontmatter must be a mapping');
  if (kind === 'prompt' && ![true, false].includes(header.active)) throw Error('prompt active must be true or false');
  if ((kind === 'role' || kind === 'skill') && !String(header.description ?? '').trim()) throw Error('description is required');
  if (kind === 'skill' && header.name !== name) throw Error('skill name must match its directory');
  if (kind === 'role' && (!Array.isArray(header.tools) || header.tools.some((t: string) => ['arc_action', 'consult', 'write', 'edit', 'memory'].includes(t))))
    throw Error('role tools must be read, python or named agent tools; never arc_action');
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
    }
  }
  private record(entry: Entry) {
    this.entries.set(entry.path, entry);
    const stored = { ...entry, ...(entry.good ? { good: { ...entry.good, source: undefined } } : {}) };
    appendFileSync(this.log, JSON.stringify(stored) + '\n');
  }
  save(path: string, level: number): Promise<string | undefined> {
    if (/^(data|results)(\/|$)/.test(path)) return Promise.resolve(undefined);
    const kind = componentKind(path) ?? 'file';
    const source = this.workspace.read(path); // Capture the write, before queued validation starts.
    const work = this.saving.then(() => this.saveSource(path, level, kind, source));
    this.saving = work.catch(() => undefined); return work;
  }
  private async saveSource(path: string, level: number, kind: string, source: string) {
    const hash = createHash('sha256').update(source).digest('hex');
    const old = this.entries.get(path);
    if (old?.hash === hash && !old.retired) return kind === 'file' ? undefined : this.receipt(old);
    const target = join(this.versions, `${hash}.txt`);
    if (!existsSync(target)) writeFileSync(target, source, { flag: 'wx', encoding: 'utf8' });
    const entry: Entry = { path, version: (old?.version ?? 0) + 1, hash, level, good: old?.good };
    try {
      const spec = kind === 'file' ? { kind, name: path, description: '', enabled: false }
        : kind === 'tool' || kind === 'observer' || kind === 'library'
          ? await this.validate?.(path, source) : markdownSpec(path, source);
      if (!spec) throw Error('Python component binder not available');
      entry.good = { ...spec, source, path, hash, level, version: entry.version };
    } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
    this.record(entry); return kind === 'file' ? undefined : this.receipt(entry);
  }
  private receipt(entry: Entry) {
    const kind = componentKind(entry.path); const name = entry.good?.name ?? entry.path.split('/').at(-1);
    return `${entry.path} → ${kind} ${name} v${entry.version}: saved · ` + (entry.error
      ? `NOT loaded (${entry.error}) · ${entry.good ? `v${entry.good.version} still runs, its outputs are labelled` : 'no active version'}`
      : entry.good?.enabled ? 'loaded · active from your next request' : 'off · not active from your next request');
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
  index(level: number, failedInputs: Set<string> = new Set()): string {
    const lines = [...this.entries].filter(([path, e]) => !e.retired && componentKind(path)).map(([path, e]) => {
      const c = e.good; const status = e.error ? 'failed' : !c?.enabled ? 'off' : c.level < level || c.refs?.some(r => failedInputs.has(r)) ? 'stale' : 'active';
      return `${c?.kind ?? componentKind(path)} ${c?.name ?? path} v${c?.version ?? e.version} ${status}${e.error && c ? ` (v${e.version} failed)` : ''}${c && c.level < level && status !== 'stale' ? ' · stale' : ''}: ${c?.description ?? e.error} · ${c?.kind === 'tool' ? `${c.name}(...)` : `read ${path}`}`;
    });
    // No saved component: no section (an empty header was shown at every decision of the 2026-10-12 real run).
    if (!lines.length) return '';
    const full = ['CAPABILITIES (your saved components)', ...lines].join('\n');
    if (full.length <= 1200) return full;
    const groups = new Map<string, number>();
    for (const [path, e] of this.entries) if (!e.retired && componentKind(path)) { const kind = componentKind(path)!; groups.set(kind, (groups.get(kind) ?? 0) + 1); }
    return ['CAPABILITIES (grouped)', ...[...groups].map(([kind, n]) => `${kind}: ${n}; ls ${kind === 'library' ? 'lib' : kind === 'note' ? 'notes' : kind + 's'}`),
      `${[...this.entries.values()].filter(e => !e.retired && e.error).length} failed; receipts label last working versions.`].join('\n');
  }
}
