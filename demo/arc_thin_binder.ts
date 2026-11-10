/** One file -> one versioned component. Binding is a request-boundary operation. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Workspace } from './arc_thin_workspace.ts';
import { componentKind, markdownSpec, type Component, type ComponentSpec, type Validator } from './agent_component_model.ts';
export { componentKind, markdownSpec } from './agent_component_model.ts';
export type { Component, ComponentSpec, Validator } from './agent_component_model.ts';
type Entry = { path: string; version: number; hash: string; level: number; kind?: string; layer?: string; by?: string; decision?: number; error?: string; retired?: boolean; good?: Component };

export class Binder {
  private entries = new Map<string, Entry>();
  private bindings = new Map<string, Component>();
  private processBinding?: Component;
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
  historyOf(path: string) {
    const versions = this.history.get(path);
    const entry = this.entries.get(path);
    return { versions: [...(versions ?? [])].map(([version, hash]) => ({ version, hash })),
      lastFailure: entry?.error ? { version: entry.version, error: entry.error } : undefined };
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
  /** Validate the captured candidate before changing the live source or binding. */
  publish(path: string, source: string, level: number, origin: { by: string; decision?: number; restored_from?: number }) {
    const work = this.saving.then(async () => {
      const receipt = await this.saveSource(path, level, componentKind(path) ?? 'file', source, origin, true);
      const entry = this.entries.get(path)!;
      return { receipt, component: entry.good, error: entry.error };
    });
    this.saving = work.catch(() => undefined);
    return work;
  }
  private async saveSource(path: string, level: number, kind: string, source: string, origin: { by: string; decision?: number; restored_from?: number }, publish = false) {
    const hash = createHash('sha256').update(source).digest('hex');
    const old = this.entries.get(path);
    if (old?.hash === hash && !old.retired) return kind === 'file' ? undefined : this.receipt(old, true);
    const target = join(this.versions, `${hash}.txt`);
    if (!existsSync(target)) writeFileSync(target, source, { flag: 'wx', encoding: 'utf8' });
    const entry: Entry = { path, version: (old?.version ?? 0) + 1, hash, level, kind,
      // B: ownership is recorded at save; layer follows the path, never an Agent declaration.
      layer: path.startsWith('prompts/process/') ? 'meta' : componentKind(path) ? 'self' : undefined, ...origin, good: old?.good };
    try {
      const spec = kind === 'file' ? { kind, name: path, description: '', enabled: false }
        : kind === 'tool' || kind === 'library'
          ? await this.validate?.(path, source)
          : kind === 'process' ? { kind, name: path.split('/').at(-1)!.replace(/\.json$/, ''), description: 'Current task method', enabled: true,
            body: JSON.stringify(JSON.parse(source)) } : markdownSpec(path, source);
      if (!spec) throw Error('Python component binder not available');
      if (spec.kind === 'prompt') {
        const section = `prompt_${spec.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        const collision = [...this.entries].some(([otherPath, other]) => otherPath !== path && !other.retired && other.good?.kind === 'prompt'
          && `prompt_${other.good.name.replace(/[^a-zA-Z0-9_]/g, '_')}` === section);
        if (collision) throw Error(`prompt section name collision: ${section}`);
      }
      entry.good = { ...spec, source, path, hash, level, version: entry.version };
    } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
    if (publish && !entry.error) this.workspace.runtimeWrite(path, source);
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
    for (const path of paths) if (componentKind(path) !== 'process') await this.save(path, level);
  }
  boundary() {
    this.bindings.clear();
    for (const [path, entry] of this.entries) if (!entry.retired && entry.good?.enabled && entry.good.kind !== 'process') this.bindings.set(path, entry.good);
    if (this.processBinding) this.bindings.set(this.processBinding.path, this.processBinding);
  }
  /** The process core selects one saved Binder component at a safe request boundary. */
  bindProcess(component: Component) {
    if (this.processBinding) this.bindings.delete(this.processBinding.path);
    this.processBinding = component;
    this.bindings.set(component.path, component);
    this.workspace.runtimeWrite(component.path, component.source);
    this.workspace.runtimeWrite(`components/process/${component.name}/v${component.version}.source`, component.source);
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
      if (c?.program) return `${c.name}@v${c.version} | executable skill | ${status} | ${c.description}` +
        (c.tags?.length ? ` | ${c.tags.join(', ')}` : '');
      return `${c?.name ?? path.split('/').at(-1)?.replace(/\.[^.]+$/, '')} | ${kind} | ${status} | ${c?.description ?? ''} | via=${usage.get(path) ?? '0'}`;
    });
    // No saved component: no section (an empty header was shown at every decision of the 2026-10-12 real run).
    if (!lines.length) return '';
    const full = ['HARNESS (your prompts, tools, skills and subagents; memory is indexed above)', ...lines].join('\n');
    if (full.length <= 1200) return full;
    const groups = new Map<string, string[]>();
    for (const [path, e] of listed) { const kind = componentKind(path)!; groups.set(kind, [...(groups.get(kind) ?? []), e.good?.name ?? path.split('/').at(-1)!.replace(/\.[^.]+$/, '')]); }
    return ['HARNESS (native component names; callable inputs appear in each tool schema)', ...[...groups].map(([kind, names]) => `${kind}s: ${names.join(', ')}`),
      `${listed.filter(([, e]) => e.error).length} failed; receipts label last working versions.`].join('\n').slice(0, 1200);
  }
}
