/** One file -> one versioned component. Binding is a request-boundary operation. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Workspace } from './arc_thin_workspace.ts';
import { SCRIPT_LINES, scriptSignature } from './arc_thin_scripts.ts';

export type ComponentSpec = { kind: string; name: string; description: string; enabled: boolean;
  parameters?: any; body?: string; tools?: string[]; refs?: string[]; view?: boolean; predictor?: boolean;
  /** A skill's event (metadata.trigger), when it has one (ARC_THIN_SKILLS), and what the lenient reading warned of. */
  trigger?: string; warnings?: string[] };
export type Component = ComponentSpec & { path: string; version: number; hash: string; source: string; level: number };
type Entry = { path: string; version: number; hash: string; level: number; error?: string; retired?: boolean; good?: Component };
export type Validator = (path: string, source: string) => Promise<ComponentSpec>;
/** The capability index's budget in characters. */
const INDEX_CHARS = 1200;
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
  if (/^prompts\/[^/]+\.md$/.test(path)) return 'prompt';
  if (/^(agents|roles)\/[^/]+\.md$/.test(path)) return 'subagent';
}
/** The events a skill can name in metadata.trigger: the first decision of a level, and the first after a stall review. */
export const SKILL_TRIGGERS = ['level_start', 'stall'];
/** How much of a skill's description the index keeps: it is the text that decides whether the body is read, so it gets more than the 120 of other files. */
export const SKILL_DESCRIPTION_CHARS = 200;
/**
 * A skill read as Pi reads one (docs/reports/pi-native-online-sources/packages__coding-agent__docs__skills.md: "most invalid
 * fields produce warnings"): a problem with the frontmatter is a warning and the defaults load (the directory's name; the
 * first line of the body as the description), and only a skill without a body is refused. A bad trigger is dropped, not guessed.
 */
function lenientSkill(name: string, source: string): ComponentSpec {
  const warnings: string[] = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  let header: Record<string, any> = {}, body = source;
  if (!match) warnings.push('no frontmatter: the directory name and the first line of the body are used');
  else {
    body = match[2];
    const doc = parseDocument(match[1]);
    if (doc.errors.length) warnings.push(`frontmatter is not valid YAML (${String(doc.errors[0].message).split('\n')[0]}): defaults are used`);
    else {
      const parsed = doc.toJS({ maxAliasCount: 20 });
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) header = parsed;
      else warnings.push('frontmatter is not a mapping: defaults are used');
    }
  }
  if (!body.trim()) throw Error('a skill needs a body');
  let description = String(header.description ?? '').trim();
  if (!description) {
    description = (body.split(/\r?\n/).find(line => line.trim()) ?? '').replace(/^\s*#+\s*/, '').trim();
    if (match && !warnings.length) warnings.push('no description: the first line of the body is used');
  } else if (description.length > SKILL_DESCRIPTION_CHARS) warnings.push(`description is ${description.length} characters; the index shows the first ${SKILL_DESCRIPTION_CHARS}`);
  if (header.name !== undefined && header.name !== name) warnings.push(`name ${JSON.stringify(header.name)} differs from its directory; ${name} is used`);
  const wanted = header.metadata && typeof header.metadata === 'object' ? header.metadata.trigger : undefined;
  const trigger = typeof wanted === 'string' && SKILL_TRIGGERS.includes(wanted) ? wanted : undefined;
  if (wanted !== undefined && trigger === undefined) warnings.push(`metadata.trigger ${JSON.stringify(wanted)} is not one of ${SKILL_TRIGGERS.join(', ')}: no trigger`);
  return { kind: 'skill', name, description: description.slice(0, SKILL_DESCRIPTION_CHARS), enabled: true, body, ...(trigger ? { trigger } : {}), ...(warnings.length ? { warnings } : {}) };
}
/** The warnings that mean the header did not say what its writer meant (not the ones that only clip a long description or take the directory's name). */
export const skillHeaderProblems = (spec: ComponentSpec): string[] => (spec.warnings ?? []).filter(warning => !/^(description is \d+ characters|name ")/.test(warning));
/** The file conventions require only scalar values and lists, not an SDK. `lenient`: skills are read as Pi reads them. */
export function markdownSpec(path: string, source: string, options: { lenient?: boolean } = {}): ComponentSpec {
  const kind = componentKind(path)!; const name = kind === 'skill' ? path.split('/')[1] : path.split('/').at(-1)!.replace(/\.md$/, '');
  if (kind === 'skill' && options.lenient) return lenientSkill(name, source);
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
  /**
   * `scripts`: the HARNESS index lists lib/<name>.py as scripts (ARC_THIN_PERSIST_DEFS); otherwise libraries are not listed.
   * `skills` (ARC_THIN_SKILLS): skills are read leniently, carry their trigger, and keep their descriptions in the index
   * when it is over its budget.
   */
  constructor(readonly workspace: Workspace, private validate?: Validator, private options: { scripts?: boolean; skills?: boolean } = {}) {
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
    if (old?.hash === hash && !old.retired) return kind === 'file' ? undefined : this.receipt(old, true);
    const target = join(this.versions, `${hash}.txt`);
    if (!existsSync(target)) writeFileSync(target, source, { flag: 'wx', encoding: 'utf8' });
    const entry: Entry = { path, version: (old?.version ?? 0) + 1, hash, level, good: old?.good };
    try {
      const spec = kind === 'file' ? { kind, name: path, description: '', enabled: false }
        : kind === 'tool' || kind === 'library'
          ? await this.validate?.(path, source) : markdownSpec(path, source, { lenient: this.options.skills === true });
      if (!spec) throw Error('Python component binder not available');
      entry.good = { ...spec, source, path, hash, level, version: entry.version };
    } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
    this.record(entry); return kind === 'file' ? undefined : this.receipt(entry);
  }
  /**
   * What a save did, as the writer is told. `unchanged`: the content was already the current version, so nothing new
   * was saved (su15-p13-q38-1 #183: a repair that returned a crashing view as it was read "v3: saved · loaded").
   */
  private receipt(entry: Entry, unchanged = false) {
    const kind = componentKind(entry.path); const name = entry.good?.name ?? entry.path.split('/').at(-1);
    // A prompt is shown with each decision as it stood when the decision began (the head is built once per decision, and
    // in the system prompt a change mid-decision invalidated the provider's cached prefix on every later request of it,
    // pr-01 2026-10-14); it applies from the next decision.
    const from = kind === 'prompt' ? 'your next decision' : 'your next request';
    const failed = entry.error
      ? `NOT loaded (${entry.error}) · ${entry.good ? `v${entry.good.version} still runs, its outputs are labelled` : 'no active version'}` : '';
    if (unchanged) return `${entry.path} → ${kind} ${name} v${entry.version}: unchanged, the same content as before · ` +
      (failed || (entry.good?.enabled ? 'loaded' : 'off'));
    // What the lenient reading of a skill warned of (ARC_THIN_SKILLS): it loaded, with these defaults.
    const warned = !entry.error && entry.good?.version === entry.version && entry.good.warnings?.length ? ` (warning: ${entry.good.warnings.join('; ')})` : '';
    return `${entry.path} → ${kind} ${name} v${entry.version}: saved · ` + (failed
      || (entry.good?.enabled ? `loaded · active from ${from}` : `off · not active from ${from}`)) + warned;
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
   * and plain files are not listed, unless the binder lists scripts (ARC_THIN_PERSIST_DEFS): then each lib/<name>.py is a
   * line (name and parameters, description, how to import it), the first SCRIPT_LINES in full and the rest by name, and
   * `used` names the paths used on this level, which are not stale whatever level they were saved on. A tool's line says
   * where it enters the decision (a view after each new state, a predictor at each action, otherwise a call) and `usage`
   * what it has done there (the runtime's counts, by path). With skills on (ARC_THIN_SKILLS) an index over its budget gives up
   * detail in steps and keeps the descriptions that route: usage text first, then script lines, then prompt and tool lines
   * (by name), then the descriptions that remain are clipped; a skill line names its trigger. Over its budget without skills
   * it is names only, as it was. Without either option the index is what it was.
   */
  index(level: number, failedInputs: Set<string> = new Set(), usage: Map<string, string> = new Map(), used: Set<string> = new Set()): string {
    const scripts = this.options.scripts === true, skills = this.options.skills === true;
    if (!scripts && !skills) return this.legacyIndex(level, failedInputs, usage);
    const order = ['prompt', 'tool', 'library', 'skill', 'subagent'];
    const rows = [...this.entries].filter(([path, e]) => !e.retired && (order.includes(componentKind(path) ?? '') && (scripts || componentKind(path) !== 'library')))
      .sort((a, b) => order.indexOf(componentKind(a[0])!) - order.indexOf(componentKind(b[0])!) || a[0].localeCompare(b[0])).map(([path, e]) => {
        const c = e.good; const kind = componentKind(path)!; const name = c?.name ?? path;
        const status = !c ? 'failed' : !c.enabled ? 'off' : (c.level < level && !used.has(path)) || c.refs?.some(r => failedInputs.has(r)) ? 'stale' : 'active';
        const use = kind === 'library' ? `import lib.${name}` : kind === 'tool' ? (path.startsWith('observers/') || c?.view ? 'view, shown after each new state'
            : c?.predictor ? 'predictor, run at each action' : `${c?.name ?? ''}(args)`)
          : kind === 'subagent' ? `consult("${c?.name ?? ''}", …)` : kind === 'prompt' ? 'applied while active' : `read ${path}`;
        const shown = kind === 'library' ? `script ${name}${c ? scriptSignature(c.source, name) : ''}` : `${kind} ${name}`;
        const head = `${shown} v${c?.version ?? e.version} ${status}${e.error && c ? ` (v${e.version} failed)` : ''}${kind === 'skill' && c?.trigger ? ` [${c.trigger}]` : ''}: `;
        return { kind, name, path, head, desc: String(c?.description ?? e.error ?? ''), tail: ` · ${use}`, usage: usage.get(path) ?? '', failed: Boolean(e.error) };
      });
    if (!rows.length) return '';
    const header = `HARNESS (your ${rows.some(r => r.kind === 'library') ? 'prompts, tools, scripts, skills and subagents' : 'prompts, tools, skills and subagents'}; memory is indexed above)`;
    // One rendering of the index at a level of detail: usage text or not, how many scripts in full, which kinds by name only,
    // and how long a description may be.
    const render = (o: { usage: boolean; scriptFull: number; byName: string[]; clip: number }) => {
      const out: string[] = [], named = new Set<string>(), rest: string[] = []; let scriptsShown = 0;
      const cut = (text: string) => (text.length > o.clip ? `${text.slice(0, o.clip - 1)}…` : text);
      for (const r of rows) {
        if (o.byName.includes(r.kind)) {
          if (!named.has(r.kind)) { named.add(r.kind); out.push(`${r.kind}s: ${rows.filter(x => x.kind === r.kind).map(x => x.name).join(', ')}`); }
        } else if (r.kind === 'library' && scriptsShown++ >= o.scriptFull) rest.push(r.name);
        else out.push(r.head + cut(r.desc) + r.tail + (o.usage && r.usage ? ` · ${r.usage}` : ''));
      }
      if (rest.length) out.push(`${rest.length}${o.scriptFull ? ' more' : ''} scripts (import lib.<name>): ${rest.join(', ')}`);
      return [header, ...out].join('\n');
    };
    const full = { usage: true, scriptFull: SCRIPT_LINES, byName: [] as string[], clip: Infinity };
    // Over the budget, with skills on, the descriptions that route stay and the rest gives way: usage text first, then script
    // lines, then prompt and tool lines (by name), then the descriptions that remain are clipped. Without skills it is names only.
    const steps = skills ? [full, { ...full, usage: false }, { ...full, usage: false, scriptFull: 0 }, { ...full, usage: false, scriptFull: 0, byName: ['prompt', 'tool'] },
      ...[80, 50, 30].map(clip => ({ ...full, usage: false, scriptFull: 0, byName: ['prompt', 'tool'], clip }))] : [full];
    for (const step of steps) {
      const text = render(step);
      if (text.length <= INDEX_CHARS) return text;
    }
    const groups = new Map<string, string[]>();
    for (const r of rows) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r.name]);
    return ['HARNESS (names only; read a file for its text)', ...[...groups].map(([kind, names]) => `${kind === 'library' ? 'script' : kind}s: ${names.join(', ')}`),
      `${rows.filter(r => r.failed).length} failed; receipts label last working versions.`].join('\n').slice(0, INDEX_CHARS);
  }
  private legacyIndex(level: number, failedInputs: Set<string>, usage: Map<string, string>): string {
    const order = ['prompt', 'tool', 'skill', 'subagent'];
    const listed = [...this.entries].filter(([path, e]) => !e.retired && order.includes(componentKind(path) ?? ''))
      .sort((a, b) => order.indexOf(componentKind(a[0])!) - order.indexOf(componentKind(b[0])!) || a[0].localeCompare(b[0]));
    const lines = listed.map(([path, e]) => {
      const c = e.good; const kind = componentKind(path)!;
      const status = !c ? 'failed' : !c.enabled ? 'off' : c.level < level || c.refs?.some(r => failedInputs.has(r)) ? 'stale' : 'active';
      const use = kind === 'tool' ? (path.startsWith('observers/') || c?.view ? 'view, shown after each new state'
          : c?.predictor ? 'predictor, run at each action' : `${c?.name ?? ''}(args)`)
        : kind === 'subagent' ? `consult("${c?.name ?? ''}", …)` : kind === 'prompt' ? 'applied while active' : `read ${path}`;
      return `${kind} ${c?.name ?? path} v${c?.version ?? e.version} ${status}${e.error && c ? ` (v${e.version} failed)` : ''}: ${c?.description ?? e.error} · ${use}` +
        (usage.get(path) ? ` · ${usage.get(path)}` : '');
    });
    // No saved component: no section (an empty header was shown at every decision of the 2026-10-12 real run).
    if (!lines.length) return '';
    const full = ['HARNESS (your prompts, tools, skills and subagents; memory is indexed above)', ...lines].join('\n');
    if (full.length <= INDEX_CHARS) return full;
    const groups = new Map<string, string[]>();
    for (const [path, e] of listed) { const kind = componentKind(path)!; groups.set(kind, [...(groups.get(kind) ?? []), e.good?.name ?? path]); }
    return ['HARNESS (names only; read a file for its text)', ...[...groups].map(([kind, names]) => `${kind}s: ${names.join(', ')}`),
      `${listed.filter(([, e]) => e.error).length} failed; receipts label last working versions.`].join('\n').slice(0, INDEX_CHARS);
  }
}
