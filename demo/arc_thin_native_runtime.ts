import { validateToolArguments } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Binder, type Component } from './arc_thin_binder.ts';
import { Workspace } from './arc_thin_workspace.ts';
import { executeNative, nativeKernel, type ActCall, type NativeResult } from './arc_thin_components.ts';
import { PythonSession } from './arc_thin_python_session.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import type { KernelRequest, PythonKernel } from './pi_task_python_kernel.ts';
import { codeShape, componentLines, coveringComponent, kitOf, repeatedFamilies, repetitionText, type PythonRun } from './arc_thin_reuse.ts';
import { blockNote, cellRefs, codeKey, commentLines, repeatedBlocks } from './arc_thin_work_memory.ts';

/** One action taken for foreground code: its feedback, or why acting stopped; `line` is the receipt. */
export type ActOutcome = { observation?: Record<string, unknown>; stopped?: string; line?: string };
type Host = { pi: ExtensionAPI; workspace: Workspace; binder: Binder; state(): Record<string, unknown>;
  level(): number; actionCount(): number; decision?(): number; log(file: string, row: any): void; usage(kind: string, message: any): void;
  wrap(name: string, fn: (args: any, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<any>): any;
  artifacts?(result: NativeResult, component: Component, n: number): NativeResult;
  /** Take one action for foreground code through the environment boundary (closed loop: env.act). */
  act?(call: ActCall, via: string): Promise<ActOutcome>;
  /** Commit a memory update made by code (env.remember) through the memory tool's own update; returns its receipt. */
  remember?(args: unknown): Promise<string>;
  onSaved?(path: string, receipt: string | undefined): void;
  metaDecision?(choice: string, reason: string): string;
  receipt?(body: string): string; modelResult?(create:(onResponse:(response:any)=>void)=>any):Promise<any>;
  /** Keep the python namespace between python calls (default true). */
  pythonSession?: boolean;
  /** Run the parent's python calls in a live kernel (default true); false: a fresh sandbox per call, restored from the checkpoint. */
  pythonKernel?: boolean;
  /** Work memory (default true): python calls get addresses, repeats name what they repeat, cell(k) runs call k again. */
  workMemory?: boolean;
  /** A baseline subagent may be consulted after its save, on the next provider request of this decision. */
  immediateSubagent?: boolean;
  /** Baseline exposes the component shortcut and session source extractor. */
  selfBaseline?: boolean;
  /** Where the python session is checkpointed, so it survives a runtime restart; in memory when absent. */
  sessionDir?: string };
export const SAVE_NAME = /^[a-z_][a-z0-9_]{0,40}$/;
/** At most this many env.act calls in one tool call. */
export const MAX_ACTS = 24;
/** Python executions of the agent and its subagents that run at once (each is one python process). */
const MAX_PARALLEL = 4;
/** States after which a view whose output never changed is shown as a snapshot: its head only (observe). */
export const CONSTANT_VIEW_RUNS = 5;
/** Host-owned limit; source declarations cannot increase it. */
const MAX_LOOP_MOUNTS = 4;
const MAX_LOOP_MOUNT_MS = 5000;
const shown = (result: NativeResult) => !result.ok ? [result.error, result.where].filter(Boolean).join('\n')
  : typeof result.value === 'object' && result.value !== null && 'stdout' in result.value
    ? [(result.value as any).stdout, (result.value as any).has_value ? '→ ' + JSON.stringify((result.value as any).value) : ''].filter(Boolean).join('\n')
    : JSON.stringify(result.value ?? null);
const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], isError });
export { codeShape, kitOf, repetitionText, type PythonRun } from './arc_thin_reuse.ts';

/** A component's output that carries nothing: None, an empty string or container, or a script that printed nothing. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('stdout' in v) return !String(v.stdout ?? '').trim() && (!v.has_value || isEmptyValue(v.value));
    return Object.keys(v).length === 0;
  }
  return false;
}
/** Consecutive empty outputs before a view is reported to the refinement. */
export const EMPTY_VIEW_STATES = 2;

/** What one execution acted: the receipt lines and, when the runtime stopped it, why. */
type Acted = { lines: string[]; stopped?: string };

export class NativeRuntime {
  private registered = new Map<string, string>();
  private viewPool = new TaskPythonPool();
  private pending: Promise<unknown> = Promise.resolve();
  private mountLocal = new Map<string, unknown>();
  private observed = new Set<string>();
  private outputs = new Map<string, string>();
  /** path@version → the states on which the view has shown nothing, in a row, and how many of the latest raised. */
  private viewHealth = new Map<string, { path: string; version: number; states: number[]; failed: number; error?: string }>();
  /** path@version of views that showed something at least once. */
  private viewShowed = new Set<string>();
  /** level:path of components already named in a python result as covering a retyped computation. */
  private coverHinted = new Set<string>();
  /** One short in-window review cue per level and canonical action count. */
  private windowCheckHinted = new Set<string>();
  private conversionHintDecision = -1;
  private savedFeedback = new Map<string, { version: number; n: number; ok: number; failed: number }>();
  /** Active views whose last EMPTY_VIEW_STATES outputs or more were empty. */
  emptyViews() {
    const live = new Set(this.host.binder.active().filter(c => (c as any).view).map(c => `${c.path}@${c.version}`));
    return [...this.viewHealth].filter(([key, v]) => live.has(key) && v.states.length >= EMPTY_VIEW_STATES).map(([, v]) => v);
  }
  /** The newest version of `path` below `below` that showed something as a view. */
  lastShowingVersion(path: string, below: number): number | undefined {
    for (let version = below - 1; version > 0; version--) if (this.viewShowed.has(`${path}@${version}`)) return version;
    return undefined;
  }
  /** Which view versions showed something, from observer_runs.jsonl, after a restart; and what each view has done. */
  seedViews(rows: any[]) {
    for (const r of rows) {
      if (r?.ok && typeof r.key === 'string' && !isEmptyValue(r.value)) this.viewShowed.add(r.key.replace(/@\d+$/, ''));
      if (typeof r?.key === 'string' && Number.isInteger(r.n)) this.countView(r.key.replace(/@\d+$/, ''), r.n, r.ok ? r.value : undefined, Boolean(r.ok));
    }
  }
  /** path@version → its runs, raised runs, runs whose output differed from the run before, and the last output. */
  private viewCounts = new Map<string, { runs: number; errors: number; changes: number; changedAt: number; last?: string }>();
  private countView(key: string, n: number, value: unknown, ok: boolean) {
    const counts = this.viewCounts.get(key) ?? { runs: 0, errors: 0, changes: 0, changedAt: n };
    const output = ok ? JSON.stringify(value ?? null) : undefined;
    counts.runs += 1;
    if (!ok) counts.errors += 1;
    else if (output !== counts.last) { if (counts.last !== undefined) counts.changes += 1; counts.changedAt = n; counts.last = output; }
    this.viewCounts.set(key, counts);
  }
  /** What each active view's current version has done: its runs, raised runs and output changes (A4 accounting). */
  viewStats(): Map<string, { runs: number; errors: number; changes: number }> {
    const out = new Map<string, { runs: number; errors: number; changes: number }>();
    for (const c of this.host.binder.active()) {
      if (c.level !== this.host.level()) continue;
      const counts = this.viewCounts.get(`${c.path}@${c.version}`);
      if ((c as any).view && counts) out.set(c.path, { runs: counts.runs, errors: counts.errors, changes: counts.changes });
    }
    return out;
  }
  private pythonRuns: PythonRun[] = [];
  /**
   * Work memory (docs/plans/2026-10-20-work-memory.md): the parent's python calls by address, P1, P2, ... Every result
   * starts with its address, a repeat names the call it repeats, lines retyped from an earlier call name that call's lines,
   * and cell(k) (cell(k, a, b)) runs call k's code (its lines a to b) again. `n`, `session` and `workspace` are the state,
   * session version and workspace version the call ran on (for the same-state cache).
   */
  private calls: Array<{ id: number; key: string; comments: string; code: string; n: number; session: number; workspace: number;
    pure: boolean; ok: boolean; result?: string }> = [];
  /** Calls of this run before a restart (python_calls.jsonl): their code stays runnable with cell(k). */
  seedCalls(rows: any[]) {
    for (const r of rows) if (Number.isInteger(r?.id) && typeof r.code === 'string')
      this.calls.push({ id: r.id, key: codeKey(r.code), comments: commentLines(r.code).join('\n'), code: r.code, n: -1, session: -1, workspace: -1, pure: false, ok: Boolean(r.ok) });
  }
  /** The code of call k and of the calls it runs with cell(), for the guest's cell(). */
  private cellSources(code: string): Record<string, string> {
    const out: Record<string, string> = {};
    const todo = cellRefs(code);
    while (todo.length) {
      const id = todo.pop()!;
      if (out[id] !== undefined) continue;
      const call = this.calls.find(c => c.id === id);
      if (!call) continue;
      out[id] = call.code;
      todo.push(...cellRefs(call.code));
    }
    return out;
  }
  /**
   * The parent's python session: the namespace its python calls share, checkpointed after every call and restored
   * after a restart (arc_thin_python_session.ts). Saved tools and subagents do not see it.
   */
  private session: PythonSession | undefined;
  /**
   * The live kernel the parent's session runs in: its namespace stays in memory between calls and env.act waits for
   * feedback where it is called. The checkpoint is still written after every call; a new kernel starts from it.
   */
  private kernel: PythonKernel | undefined;
  /** Foreground executions running at once; the rest wait for a slot before their time allowance starts. */
  private running = 0;
  private waiting: Array<() => void> = [];
  private async slot(): Promise<() => void> {
    if (this.running >= MAX_PARALLEL) await new Promise<void>(start => this.waiting.push(start));
    else this.running += 1;
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = this.waiting.shift();
      if (next) next(); else this.running -= 1;
    };
  }
  constructor(private host: Host) {
    if (host.pythonSession !== false) {
      this.session = new PythonSession(host.sessionDir);
      if (this.session.recovered) host.log('python_session.jsonl', { event: 'restored', version: this.session.recovered, names: this.session.names() });
      if (host.pythonKernel !== false) this.kernel = nativeKernel();
    }
    host.pi.registerTool({ name: 'consult', label: 'Consult', description: 'Ask a saved subagent (agents/<name>.md) with exact workspace refs. Subagents never act.',
      parameters: Type.Object({ agent: Type.String(), question: Type.String(), refs: Type.Optional(Type.Array(Type.String())) }),
      prepareArguments: (args: any) => args && typeof args === 'object' && args.role && !args.agent ? { ...args, agent: args.role } : args,
      execute: host.wrap('consult', (args, signal, ctx) => this.consult(args, signal, ctx)) });
  }
  /** The saved tools the agent can call by name (views under observers/ are shown, not called). */
  private callable() { return this.host.binder.candidates().filter(c => c.kind === 'tool' && !(c as any).guard && !c.mount?.length && !c.path.startsWith('observers/')); }
  /** Register candidates immediately; Pi advertises them only on its next request. Execution uses boundary snapshots. */
  register() {
    for (const c of this.callable()) {
      if (this.registered.get(c.name) === c.hash) continue;
      this.host.pi.registerTool({ name: c.name, label: c.name, description: c.description, parameters: c.parameters,
        // Older calls passed the inputs at the top level; they become args.
        prepareArguments: (args: any) => args && typeof args === 'object' && !('args' in args) && Object.keys(args).length ? { args } : args,
        execute: this.host.wrap(c.name, async (args, signal) => {
          const active = this.host.binder.active().find(x => x.path === c.path);
          if (!active || active.mount?.length) throw Error(`${c.name} is retired or mounted at a loop boundary`);
          return this.call(active, args, signal);
        }) });
      this.registered.set(c.name, c.hash);
    }
  }
  toolNames() { return this.callable().filter(c => this.registered.has(c.name)).map(c => c.name); }
  /** Earlier python runs of this run (component_runs.jsonl), after a restart. */
  seedPython(rows: any[]) {
    for (const r of rows) {
      if (r.kind === 'save' && r.ok && r.by === 'agent') {
        const previous = this.savedFeedback.get(r.path);
        if (previous?.version !== r.version) this.savedFeedback.set(r.path, { version: r.version, n: r.n, ok: 0, failed: 0 });
      }
      if (r.kind === 'tool' && !r.readonly) {
        const saved = this.savedFeedback.get(r.path);
        if (saved?.version === r.version) saved[r.ok ? 'ok' : 'failed']++;
      }
      if (r?.kind === 'window_check' && Number.isInteger(r.level) && Number.isInteger(r.n))
        this.windowCheckHinted.add(`${r.level}:${r.n}`);
      if (r?.kind === 'python' && !r.readonly && typeof r.shape === 'string')
        this.pythonRuns.push({ level: Number(r.level) || 0, shape: r.shape, lines: r.lines ?? [], struct: r.struct ?? [], gist: String(r.gist ?? ''), kit: String(r.kit ?? ''),
          decision: Number(r.decision) || 0, n: Number(r.n) || 0 });
    }
  }
  private decision() { return this.host.decision?.() ?? 0; }
  /** Updated at save/call events; ordinary heads never rescan the run log. */
  selfFeedbackText(path?: string) {
    const lines = (path ? this.host.binder.candidates() : this.host.binder.active()).filter(c => c.kind === 'tool' && c.path.startsWith('tools/') &&
      !c.mount?.length && !c.guard && (!path || c.path === path)).flatMap(c => {
      const saved = this.savedFeedback.get(c.path);
      if (!saved || saved.version !== c.version) return [];
      return [`${c.name} v${c.version}: ${saved.ok + saved.failed ? `${saved.ok} calls OK, ${saved.failed} failed` : 'not called yet'}; ${Math.max(0, this.host.actionCount() - saved.n)} actions since save`];
    }).slice(-3);
    return lines.length ? `SELF FEEDBACK: ${lines.join('; ')}. Call results only; replacement of rewriting and task benefit are unmeasured.` : '';
  }
  noteSave(path: string, receipt: string | undefined) {
    if (/^(tools|observers|lib)\/[^/]+\.py$/.test(path)) {
      const ok = !/NOT loaded/.test(receipt ?? '');
      const version = this.host.binder.versionMap()[path];
      if (ok && this.host.binder.originOf(path)?.by === 'agent' && this.savedFeedback.get(path)?.version !== version)
        this.savedFeedback.set(path, { version, n: this.host.actionCount(), ok: 0, failed: 0 });
      this.host.log('component_runs.jsonl', { kind: 'save', path, decision: this.decision(), n: this.host.actionCount(), ok,
        version: this.host.binder.versionMap()[path], by: this.host.binder.originOf(path)?.by,
        ...(ok ? {} : { error: /NOT loaded \(([^)]*)\)/.exec(receipt ?? '')?.[1]?.slice(0, 200) }) });
    }
    this.host.onSaved?.(path, receipt);
  }
  seedMountLocal(rows: any[]) {
    for (const row of rows) if (typeof row?.key === 'string' && Object.hasOwn(row, 'local'))
      this.mountLocal.set(row.key, row.local);
  }
  private components() {
    return this.host.binder.active().filter(c => /^(tools|observers|lib)\//.test(c.path) && c.path.endsWith('.py')).map(c => componentLines(c.path, c.source));
  }
  private levelRuns(level: number) {
    const kit = kitOf(this.host.binder.versionMap());
    return this.pythonRuns.filter(r => r.level === level && r.kit === kit);
  }
  /**
   * Repeated python work on a level, for the refinement trigger: a computation redone at least 3 times since the
   * saved tools last changed. A computation a saved component covers is named in the python result at its second
   * typing (coveringComponent); a refinement is asked only if it is typed again after that.
   */
  repeatedWork(level: number) {
    return repeatedFamilies(this.levelRuns(level), this.components()).filter(f => f.recent >= 3)
      .map(f => ({ key: f.key, gist: f.gist, calls: f.recent, covered: f.covered, samples: f.runs.slice(-2).map(r => r.code ?? '').filter(Boolean) }));
  }
  repetitionText(level: number) { return repetitionText(this.levelRuns(level), this.components()); }
  private snapshot() {
    const started=performance.now(); let readBytes=0;
    const sources: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const c of this.host.binder.active()) if (c.path.endsWith('.py')) sources[c.path] = c.source;
    const scanStarted=performance.now(), paths=this.host.workspace.files(), scanMs=performance.now()-scanStarted;
    const readStarted=performance.now();
    for (const path of paths) {
      if (path.endsWith('.png')) continue; // binary observations are read as images by Pi, never decoded into guest text
      if (/^(lib|tools|observers)\/.+\.py$/.test(path)) continue; // failed source never hides behind a working import
      const body=this.host.workspace.read(path); readBytes+=Buffer.byteLength(body);
      if (/^skills\/.+\.py$/.test(path)) sources[path] = body;
      else files[path] = body;
    }
    const versions = this.host.binder.versionMap();
    for (const c of this.host.binder.active()) versions[c.path] = c.version;
    const artifacts = { ...(this.host.state().artifacts as Record<string, unknown> ?? {}) };
    for (const [path, body] of Object.entries(files)) if (/^artifacts\/[^/]+\.json$/.test(path)) {
      try { artifacts[path.slice(10, -5)] = JSON.parse(body); } catch { /* Non-JSON artifacts remain readable files. */ }
    }
    return { sources, files, state: { ...this.host.state(), artifacts }, versions,
      snapshotMetrics:{snapshot_ms:performance.now()-started, scan_ms:scanMs, read_ms:performance.now()-readStarted,
        snapshot_read_bytes:readBytes, scanned_files:paths.length} };
  }
  private async applyWrites(result: NativeResult) {
    // Recheck untrusted guest output at the host boundary before applying any filesystem mutation.
    for (const op of result.ops ?? []) {
      if (op.op === 'memory' || op.op === 'meta_decide') continue;
      this.host.workspace.path(op.path, true);
      if (op.destination) this.host.workspace.path(op.destination, true);
    }
    const receipts: string[] = [];
    const decisions: Array<{ choice: string; reason: string }> = [];
    let files = 0;
    for (const op of result.ops ?? []) {
      if (op.op === 'memory') {
        // Refused updates are reported with the result; they never undo the cell's other writes or actions.
        if (!this.host.remember) { receipts.push('memory: not available here'); continue; }
        try { receipts.push('memory: ' + await this.host.remember(op.args)); }
        catch (error) { receipts.push('memory refused: ' + String((error as Error)?.message ?? error)); }
        continue;
      }
      if (op.op === 'meta_decide') {
        decisions.push({ choice: String(op.choice ?? ''), reason: String(op.reason ?? '') });
        continue;
      }
      files += 1;
      if (op.op === 'restore') {
        const source = this.host.binder.sourceOf(op.path, Number(op.version));
        if (source === undefined) { receipts.push(`${op.path}: no version ${op.version} to restore`); continue; }
        this.host.workspace.mutate({ op: 'write', path: op.path, content: source });
        const receipt = await this.host.binder.save(op.path, this.host.level(), { by: 'agent', decision: this.decision() });
        receipts.push(`${op.path}: restored from v${op.version}${receipt ? ` · ${receipt}` : ''}`); this.noteSave(op.path, receipt);
        continue;
      }
      this.host.workspace.mutate(op as any);
      if (op.op === 'write') { const receipt = await this.host.binder.save(op.path, this.host.level(), { by: 'agent', decision: this.decision() }); if (receipt) receipts.push(receipt); this.noteSave(op.path, receipt); }
      else receipts.push(`${op.path}: ${op.op === 'move' ? 'moved to ' + op.destination : 'deleted'} · bindings rebuilt next request`);
    }
    if (files) {
      await this.host.binder.scan(this.host.level()); this.register();
      // Tools are only added mid-decision, never removed: the tool list the agent sees stays consistent.
      const names = new Set(this.toolNames());
      this.host.pi.setActiveTools([...new Set([...this.host.pi.getActiveTools(), ...names])]);
    }
    for (const meta of decisions) receipts.push('meta: ' + (this.host.metaDecision?.(meta.choice, meta.reason) ?? 'unavailable'));
    return receipts;
  }
  /**
   * One execution with its host round trips: a file the code opens is fetched (with the rest of its folder, so a
   * loop over frames is one restart, not one per file), and each env.act() is taken through the host and the code
   * replayed with the observation (closed loop, at most MAX_ACTS per call).
   */
  private async execute(input: ReturnType<NativeRuntime['snapshot']> & Record<string, any>, signal?: AbortSignal, pool?: TaskPythonPool,
    via?: string): Promise<NativeResult & { acted?: Acted }> {
    const started=performance.now(); const attempts:any[]=[];
    // Store growth must not consume every call's WASI allowance. Reads fetch only exact confined snapshot files.
    const all = input.files; const files: Record<string, string> = {};
    const source = input.code ?? input.sources[input.path] ?? '';
    for (const [path, body] of Object.entries(all)) if (source.includes(`'${path}'`) || source.includes(`"${path}"`)) files[path] = body;
    const acts: Array<{ call: ActCall; observation?: unknown; stopped?: string }> = [];
    const acted: Acted = { lines: [] };
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    // Each attempt gets its own time allowance once it holds a slot: a replayed acting call restarts the code once per
    // action, and a message with many python calls must not spend their allowances waiting for the CPU.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      for (let rounds = 0; rounds <= 32 + MAX_ACTS; rounds++) {
        const {snapshotMetrics, ...request}=input;
        const payload={...request,files,file_names:Object.keys(all),acts,allow_act:Boolean(via)};
        const queued=performance.now();
        const release = pool ? () => {} : await this.slot();
        const at=performance.now();
        let result:NativeResult, metrics:Record<string,unknown>={};
        try {
          clearTimeout(timer); timer = setTimeout(abort, 20000);
          result=await executeNative(payload,controller.signal,pool, value=>{metrics=value;});
        }
        catch (error) { attempts.push({ms:performance.now()-at,slot_wait_ms:at-queued,input_bytes:Buffer.byteLength(JSON.stringify(payload)),
          ...((error as any).consumed ?? {}),ok:false}); throw error; }
        finally { release(); }
        attempts.push({ms:performance.now()-at,slot_wait_ms:at-queued,input_bytes:Buffer.byteLength(JSON.stringify(payload)),...metrics,ok:result.ok});
        if (result.need_act) {
          if (!via || !this.host.act) throw Error('this code cannot act');
          const played = acts.filter(a => !a.stopped).length;
          const outcome: ActOutcome = played >= MAX_ACTS ? { stopped: `the limit of ${MAX_ACTS} actions per call was reached` }
            : acted.stopped ? { stopped: acted.stopped } : await this.host.act(result.need_act, via);
          if (outcome.line) acted.lines.push(outcome.line);
          if (outcome.stopped) acted.stopped ??= outcome.stopped;
          acts.push({ call: result.need_act, ...(outcome.stopped ? { stopped: outcome.stopped } : { observation: outcome.observation }) });
          continue;
        }
        if (!result.need_file) return { ...result, acted };
        this.host.workspace.path(result.need_file);
        if (!Object.hasOwn(all, result.need_file) || Object.hasOwn(files, result.need_file)) throw Error('invalid workspace read request');
        files[result.need_file] = all[result.need_file];
        const folder = result.need_file.slice(0, result.need_file.lastIndexOf('/') + 1);
        let room = 120_000;
        for (const [path, body] of Object.entries(all)) {
          if (!folder || !path.startsWith(folder) || Object.hasOwn(files, path) || body.length > room) continue;
          files[path] = body; room -= body.length;
        }
      }
      throw Error('workspace read or action budget exceeded; use history.grid(n) or env.frame(n) for frames');
    } catch (error) {
      // A guest/transport failure cannot erase actions already acknowledged by the host.
      if (!acted.lines.length) throw error;
      return { ok: false, error: String(error), acted,
        ...(input.session ? { session: { error: 'execution ended before a checkpoint was returned' } } : {}) };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      this.host.log('wasi_runs.jsonl',{mode:input.mode,n:this.host.actionCount(),...input.snapshotMetrics,
        lazy_restarts:Math.max(0,attempts.length-1),acts:acts.length,attempts,total_ms:performance.now()-started,
        timing_note:'execution_ms includes instantiate/guest; attempt ms includes host/compile/transport; do not sum overlapping phases'});
    }
  }
  /**
   * One cell in the live kernel. An action or a file the code asks for is answered while the cell waits, so the code
   * runs once. The same limits hold as for a replayed call: at most MAX_ACTS actions, acting only with `via`.
   */
  private async executeKernel(input: ReturnType<NativeRuntime['snapshot']> & Record<string, any>, signal: AbortSignal | undefined,
    via: string | undefined): Promise<NativeResult & { acted?: Acted; kernel?: { fresh: boolean; previousExit?: string; ended?: string } }> {
    const started = performance.now();
    const all = input.files; const files: Record<string, string> = {};
    const source = input.code ?? '';
    for (const [path, body] of Object.entries(all)) if (source.includes(`'${path}'`) || source.includes(`"${path}"`)) files[path] = body;
    const acted: Acted = { lines: [] };
    let played = 0, fetched = 0;
    const answer = async (request: KernelRequest): Promise<unknown> => {
      if (request.t === 'act') {
        if (!via || !this.host.act) return { error: 'this code cannot act' };
        const call = request.call as ActCall;
        if (!call || typeof call.action !== 'string') return { error: 'invalid action request' };
        const outcome: ActOutcome = played >= MAX_ACTS ? { stopped: `the limit of ${MAX_ACTS} actions per call was reached` }
          : acted.stopped ? { stopped: acted.stopped } : await this.host.act(call, via);
        if (!outcome.stopped) played += 1;
        if (outcome.line) acted.lines.push(outcome.line);
        if (outcome.stopped) acted.stopped ??= outcome.stopped;
        return outcome.stopped ? { stopped: outcome.stopped } : { observation: outcome.observation };
      }
      if (request.t === 'file') {
        const path = String(request.path ?? '');
        try { this.host.workspace.path(path); } catch (error) { return { error: String((error as Error).message ?? error) }; }
        if (!Object.hasOwn(all, path)) return { error: 'not in the workspace' };
        if (++fetched > 32) return { error: 'workspace read budget exceeded; use history.grid(n) or env.frame(n) for frames' };
        // The rest of its folder comes along, so a loop over frames is one request, not one per file.
        const out: Record<string, string> = { [path]: all[path] };
        const folder = path.slice(0, path.lastIndexOf('/') + 1);
        let room = 120_000;
        for (const [other, body] of Object.entries(all)) {
          if (!folder || !other.startsWith(folder) || other === path || body.length > room) continue;
          out[other] = body; room -= body.length;
        }
        return { files: out };
      }
      return { error: 'unknown request' };
    };
    const { snapshotMetrics, ...request } = input;
    const payload = { ...request, files, file_names: Object.keys(all), acts: [], allow_act: Boolean(via) };
    let metrics: Record<string, unknown> = {}, ended: string | undefined;
    try {
      const run = await this.kernel!.run(payload, answer, signal);
      metrics = { ...run.metrics, fresh: run.fresh };
      return { ...run.result, acted, kernel: { fresh: run.fresh, ...(run.previousExit ? { previousExit: run.previousExit } : {}) } };
    } catch (error) {
      ended = String((error as Error)?.message ?? error);
      this.session?.kernelEnded();
      // A kernel that ended cannot erase actions already acknowledged by the host.
      return { ok: false, error: `the python kernel ended: ${ended}`, acted, kernel: { fresh: false, ended } };
    } finally {
      this.host.log('wasi_runs.jsonl', { mode: 'kernel', n: this.host.actionCount(), ...snapshotMetrics, acts: played, files_fetched: fetched,
        input_bytes: Buffer.byteLength(JSON.stringify(payload)), ...metrics, ...(ended ? { ended } : {}), total_ms: performance.now() - started });
    }
  }
  /**
   * The tool result: what the code returned, then what it did in the game; acting ends the decision. `valueKept`: the
   * final value stays in the live session as _, so a result shortened here is still whole there.
   */
  private finish(body: string, result: NativeResult & { acted?: Acted }, valueKept = false, mark = '') {
    let shownBody = mark + (this.host.receipt?.(body) ?? body);
    if (valueKept && shownBody !== mark + body) shownBody += '\n(the whole final value is _ in the python session until your next final expression: take the part you need from it)';
    const acted = result.acted;
    if (!acted?.lines.length) return text(shownBody + (acted?.stopped ? `\n(no action taken: ${acted.stopped})` : ''), !result.ok);
    return { ...text([shownBody, `ACTED ${acted.lines.length} action(s)${acted.stopped ? `; stopped: ${acted.stopped}` : ''}. This decision ends.`,
      ...acted.lines].join('\n'), !result.ok), terminate: true };
  }
  /**
   * Foreground Python uses the parent's namespace and action boundary. With `save`, the exact submitted source is
   * published before execution; this is separate from invoking the saved entry point. Session calls run one at a time.
   */
  async python(code: string, signal?: AbortSignal, readonly = false, save?: string, session: PythonSession | undefined = this.session) {
    return session ? session.exclusive(() => this.runPython(code, signal, readonly, save, session)) : this.runPython(code, signal, readonly, save, undefined);
  }
  /** Read a session function's definition and dependency names without publishing or invoking the function. */
  async sessionFunction(name: string, signal?: AbortSignal): Promise<NativeResult> {
    if (!this.session) return { ok: false, error: 'the Python session is disabled' };
    return this.session.exclusive(async () => {
      const input = { ...this.snapshot(), mode: 'session_export', function: name, session: this.session!.payload(),
        session_names: this.session!.names() } as ReturnType<NativeRuntime['snapshot']> & Record<string, any>;
      const result = this.kernel ? await this.executeKernel(input, signal, undefined) : await this.execute(input, signal);
      this.host.log('component_runs.jsonl', { kind: 'session_export', function: name, decision: this.decision(), n: this.host.actionCount(),
        ok: result.ok, ...(result.ok ? {} : { error: String(result.error ?? '').slice(0, 200) }) });
      return result;
    });
  }
  private async runPython(code: string, signal: AbortSignal | undefined, readonly: boolean, save: string | undefined, session: PythonSession | undefined) {
    // Work memory: the parent's calls have an address and a repeat names the call it repeats. A repeat on an unchanged
    // state (no action, no session change, no workspace write since) gets that call's result instead of a second run.
    const parent = !readonly && session === this.session && this.host.workMemory !== false;
    const key = codeKey(code), comments = commentLines(code).join('\n');
    // A repeat names the first call with this code; the same-state check compares with the latest one.
    const first = parent ? this.calls.find(c => c.key === key) : undefined;
    const latest = parent ? this.calls.filter(c => c.key === key).at(-1) : undefined;
    const id = parent ? Math.max(0, ...this.calls.map(c => c.id)) + 1 : 0;
    if (first && latest && save === undefined && latest.pure && latest.ok && latest.result !== undefined && latest.n === this.host.actionCount()
      && latest.session === (session?.version ?? 0) && latest.workspace === this.host.workspace.version) {
      this.calls.push({ ...latest, id, comments, code });
      this.host.log('python_calls.jsonl', { id, same: first.id, cached: true, n: latest.n, decision: this.decision(), ok: true, code });
      return text(`[P${id} = P${first.id}: same code on the same state, not run again]\n${this.host.receipt?.(latest.result) ?? latest.result}`);
    }
    // A new cell that retypes whole statements of an earlier one says which lines (cell(k, a, b) runs them).
    const blocks = parent && !first ? repeatedBlocks(code, this.calls.filter((c, i, all) => all.findIndex(o => o.key === c.key) === i)) : [];
    const mark = !parent ? '' : first ? `[P${id} = P${first.id}: same code${first.comments === comments ? '' : ', other comments'}]\n`
      : blocks.length ? `[P${id}: ${blockNote(blocks)}]\n` : `[P${id}]\n`;
    const earlier = first;
    const cells = parent ? this.cellSources(code) : {};
    const saveReceipts: string[] = [];
    let via: string | undefined = !readonly && this.host.act ? 'python' : undefined;
    if (save !== undefined && !readonly) {
      if (!SAVE_NAME.test(save)) throw Error('save must be a lowercase name like route_to (letters, digits, _)');
      const path = `tools/${save}.py`;
      this.host.workspace.mutate({ op: 'write', path, content: code.endsWith('\n') ? code : code + '\n' });
      const receipt = await this.host.binder.save(path, this.host.level(), { by: 'agent', decision: this.decision() });
      if (receipt) saveReceipts.push(receipt);
      this.noteSave(path, receipt);
      await this.host.binder.scan(this.host.level()); this.register();
      const names = new Set(this.toolNames());
      this.host.pi.setActiveTools([...new Set([...this.host.pi.getActiveTools(), ...names])]);
      if (!/NOT loaded/.test(receipt ?? '')) via = path;
    }
    const snap = this.snapshot(); const started = Date.now();
    const windowAtStart = this.host.actionCount();
    const kit = kitOf(this.host.binder.versionMap());
    const input = { ...snap, mode: 'exec', code, allow_writes: !readonly, ...(session ? { session: session.payload() } : {}),
      ...(Object.keys(cells).length ? { cells } : {}) };
    // The parent's session runs in its live kernel; a subagent's session and saved tools keep a fresh sandbox per call.
    const live = Boolean(this.kernel && session && session === this.session);
    const result = live ? await this.executeKernel(input, signal, via) : await this.execute(input, signal, undefined, via);
    const receipts = [...saveReceipts, ...(result.ok ? await this.applyWrites(result) : [])];
    // The namespace is checkpointed whether or not the code raised: what ran before an error stays, as in a kernel.
    const outcome = session?.commit(result.session, live);
    // A checkpoint that did not load must not stay half-restored in the kernel: the next call starts from the rollback.
    if (live && outcome?.event === 'rolled_back') { this.kernel!.kill('its checkpoint did not load'); session!.kernelEnded(); }
    const kernel = live ? (result as any).kernel as { fresh: boolean; previousExit?: string; ended?: string } | undefined : undefined;
    const sessionNotes = [
      kernel?.fresh && kernel.previousExit ? `(new python kernel: the previous one ended (${kernel.previousExit}); the session was restored from its checkpoint v${session!.version} before this call)` : '',
      kernel?.ended ? `(the next python call starts a new kernel with the session as checkpointed: v${session!.version}${session!.names().length ? `: ${session!.names().join(', ').slice(0, 300)}` : ', empty'})` : '',
      outcome?.receipt ?? '',
      // A saved tool runs without the session: say so when the code just saved relies on it.
      save && via?.startsWith('tools/') && result.session?.uses?.length ? `(${via} uses names from the python session: ${result.session.uses.join(', ').slice(0, 200)}. ` +
        'A saved tool runs without the session, so define them inside it or pass them in args.)' : ''].filter(Boolean).join('\n');
    if (outcome?.event) this.host.log('python_session.jsonl', { event: outcome.event, version: outcome.version, readonly, decision: this.decision(), n: this.host.actionCount(),
      chars: result.session?.chars ?? result.session?.over?.chars, raw_bytes: result.session?.raw_bytes ?? result.session?.over?.raw_bytes,
      names: result.session?.names?.length, defs: result.session?.defs?.length, unsupported: result.session?.unsupported,
      over: result.session?.over, error: result.session?.error ?? result.session?.load_error, failed_defs: result.session?.failed_defs, gone: result.session?.gone });
    const shape = codeShape(code);
    // A consult's read-only python is not the parent's own work.
    const decision = this.decision();
    if (!readonly) this.pythonRuns.push({ level: this.host.level(), ...shape, kit, decision, n: this.host.actionCount(), code: code.slice(0, 2000) });
    this.host.log('component_runs.jsonl', { kind: 'python', n: this.host.actionCount(), versions: snap.versions, ok: result.ok, ms: Date.now() - started,
      ...(readonly ? { readonly } : { level: this.host.level(), decision, ...shape, kit, ...(save ? { saved_as: `tools/${save}.py` } : {}) }),
      acted: result.acted?.lines.length ?? 0, ...(outcome ? { session_version: outcome.version, session_event: outcome.event ?? 'unchanged' } : {}) });
    const failed = this.host.binder.active().map(c => this.host.binder.label(c.path)).filter(s => s.includes('failed'));
    // Saved once, named once: when this call retypes what a saved component computes, its own result says so (once per
    // component and level), so the next call can use it instead (Prime: the change arrives in the next tool result).
    // All of the level's calls count: counting only those since the saved tools last changed (levelRuns) let every save
    // reset it, and it fired 0 times in 8 runs (2026-10-19).
    const covering = readonly ? undefined : coveringComponent(this.pythonRuns.filter(r => r.level === this.host.level()), this.components());
    const coverKey = `${this.host.level()}:${covering}`;
    let coverNote = '';
    if (covering && !this.coverHinted.has(coverKey)) {
      this.coverHinted.add(coverKey);
      const c = this.host.binder.active().find(x => x.path === covering);
      coverNote = `(${covering} already computes this: ${c?.kind === 'tool' && ((c as any).view || c.path.startsWith('observers/'))
        ? 'it is a view, so its output is shown with each new state under HARNESS'
        : c?.kind === 'tool' ? `call ${c.name}(args={...})` : `from ${covering.replace(/\.py$/, '').replace(/\//g, '.')} import …`} instead of retyping it)`;
      this.host.log('component_runs.jsonl', { kind: 'cover_hint', path: covering, level: this.host.level(), decision, n: this.host.actionCount() });
    }
    const windowKey = `${this.host.level()}:${windowAtStart}`;
    let conversionNote = '';
    const family = this.conversionHintDecision !== decision && !readonly && !save && result.ok ? repeatedFamilies(this.levelRuns(this.host.level()), this.components())
      .find(f => f.runs.includes(this.pythonRuns.at(-1)!)) : undefined;
    if (family && this.conversionHintDecision !== decision) {
      this.conversionHintDecision = decision;
      const existing = family.covered && this.host.binder.active().find(c => c.path === family.covered && this.toolNames().includes(c.name));
      const names = [...new Set(family.runs.flatMap(r => [...(r.code ?? r.gist).matchAll(/(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g)].map(m => m[1])))].slice(-3);
      conversionNote = `SELF REUSE: repeat/near-duplicate Python detected (${family.recent} calls). ` + (existing
        ? `Call ${existing.name}(args={...}) now instead of rebuilding it.`
        : 'Save reusable checked logic as a tool now: ' + (this.host.selfBaseline
          ? 'promote_session_function(function="..."); adapt dependencies and run(state,args); self_component(name, content); call the saved name.'
          : 'adapt dependencies and run(state,args), then python(code="...", save="...").')) +
        (names.length ? ` Recent definitions: ${names.join(', ')}.` : '') +
        ' You choose; skip one-offs or no remaining use without a report.';
      this.host.log('component_runs.jsonl', { kind: 'conversion_hint', level: this.host.level(), decision, n: this.host.actionCount(), calls: family.recent });
    }
    const windowCalls = this.pythonRuns.filter(r => r.level === this.host.level() && r.n === windowAtStart).length;
    let windowCheck = '';
    if (!readonly && !result.acted?.lines.length && this.host.actionCount() === windowAtStart &&
        windowCalls >= 3 && !this.windowCheckHinted.has(windowKey)) {
      this.windowCheckHinted.add(windowKey);
      windowCheck = `WINDOW CHECK: ${windowCalls} Python calls since action #${windowAtStart}. Briefly compare what they established and what remains uncertain. ` +
        'If the next test is clear, act without deeper review. Investigate a real contradiction, blocker or tool failure. Save checked reusable logic, then call the saved version instead of rebuilding it.';
      this.host.log('component_runs.jsonl', { kind: 'window_check', level: this.host.level(), n: windowAtStart, decision, calls: windowCalls });
    }
    // Save receipts first: a long output is clipped to its head, and the receipt says which version runs next.
    const out = this.finish([...receipts, shown(result), sessionNotes, coverNote, windowCheck, ...failed.map(s => 'bindings: ' + s)].filter(Boolean).join('\n'), result,
      live && result.ok && Boolean((result.value as any)?.has_value), mark);
    // Keep the cue visible even when the Python output is shortened to a receipt.
    if (conversionNote) out.content.push({ type: 'text', text: conversionNote });
    if (save) {
      const feedback = this.selfFeedbackText(`tools/${save}.py`);
      if (feedback) out.content.push({ type: 'text', text: feedback });
    }
    if (parent) {
      const acted = Boolean(result.acted?.lines.length);
      // Only a computation that acted, wrote, remembered or saved nothing can be answered again from its result.
      const pure = !acted && !result.ops?.length && save === undefined && !/\benv\.(act|remember|restore)\s*\(/.test(code);
      // What the code printed and returned, without this call's notes, answers a repeat on the same state.
      this.calls.push({ id, key, comments, code, n: this.host.actionCount(), session: session?.version ?? 0, workspace: this.host.workspace.version,
        pure, ok: result.ok, result: shown(result) });
      this.host.log('python_calls.jsonl', { id, ...(earlier ? { same: earlier.id } : {}), ...(Object.keys(cells).length ? { cells: Object.keys(cells).map(Number) } : {}),
        ...(blocks.length ? { blocks } : {}), n: this.host.actionCount(), decision, ok: result.ok, acted, code });
    }
    return out;
  }
  async legacyAlias(name: string, args: any, signal?: AbortSignal) {
    const component = this.host.binder.active().find(c => c.kind === 'tool' && !(c as any).guard && !c.mount?.length && c.name === name && !c.path.startsWith('observers/'));
    if (!component) throw Error(`legacy alias ${name}: tool retired or unavailable`);
    return this.call(component, { args }, signal);
  }
  private async call(c: Component, args: any, signal?: AbortSignal, readonly = false) {
    const snap = this.snapshot(); const started = Date.now(); const label = this.host.binder.label(c.path);
    let result = await this.execute({ ...snap, mode: 'call', path: c.path, args, allow_writes: !readonly }, signal, undefined, readonly ? undefined : c.path);
    const receipts = result.ok ? await this.applyWrites(result) : [];
    if (!readonly && this.host.artifacts) result = { ...this.host.artifacts(result, c, this.host.actionCount()), acted: result.acted };
    this.host.log('component_runs.jsonl', { kind: 'tool', name: c.name, path: c.path, decision: this.decision(), readonly, n: this.host.actionCount(), version: c.version,
      versions: snap.versions, ok: result.ok, ms: Date.now() - started, acted: result.acted?.lines.length ?? 0 });
    const saved = this.savedFeedback.get(c.path);
    if (!readonly && saved?.version === c.version) saved[result.ok ? 'ok' : 'failed']++;
    const fallback = this.host.binder.active().filter(x => x.path !== c.path).map(x => this.host.binder.label(x.path)).filter(s => s.includes('failed'));
    const out = this.finish([`${label} →\n${shown(result)}`, ...receipts, ...fallback.map(s => 'bindings: ' + s)].join('\n'), result);
    const feedback = !readonly && this.selfFeedbackText(c.path);
    if (feedback) out.content.push({ type: 'text', text: feedback });
    return out;
  }
  /** Tools marked as views run after every new state; their outputs are shown each decision. They never act. */
  observe(n: number) {
    const due = this.host.binder.active().filter(c => c.kind === 'tool' && (c as any).view && c.level === this.host.level()
      && !this.observed.has(`${c.path}@${c.version}@${n}`));
    if (!due.length) return;
    const snap = this.snapshot();
    for (const c of due) {
      const key = `${c.path}@${c.version}@${n}`; this.observed.add(key);
      const work = async () => {
        const started = Date.now(); let result: NativeResult;
        try { result = await this.execute({ ...snap, mode: 'call', path: c.path, args: { args: {} } }, undefined, this.viewPool); }
        catch (error) { result = { ok: false, error: String(error) }; }
        if (this.host.artifacts) result = this.host.artifacts(result, c, n);
        const liveLabel = this.host.binder.label(c.path);
        this.countView(`${c.path}@${c.version}`, n, result.ok ? result.value : undefined, result.ok);
        // An output that has not changed is still shown (a decision sees only its own head), and says so. One that has
        // been the same on every state since the view was saved is a snapshot, not a view of the state (in the su15 runs on
        // record: saved scripts reading fixed frames, such as history.grid(28)); after CONSTANT_VIEW_RUNS states its line
        // keeps only its head, so it does not crowd out the views that change (loop-bound artifacts plan, A4).
        const counts = this.viewCounts.get(`${c.path}@${c.version}`);
        const since = counts?.changedAt;
        const output = shown(result);
        const constant = result.ok && counts !== undefined && counts.changes === 0 && counts.runs >= CONSTANT_VIEW_RUNS;
        const body = `${c.name} v${c.version}${liveLabel.startsWith(`${c.name} v${c.version}`) ? liveLabel.slice(`${c.name} v${c.version}`.length) : ''} state #${n}` +
          (constant ? ` (the same output on all ${counts.runs} states since #${since}: a snapshot, not a view of the state; "# view: off" ` +
            `makes it a tool you call): ${output.length > 160 ? `${output.slice(0, 159)}…` : output}`
            : `${result.ok && since !== undefined && since < n ? ` (output unchanged since #${since})` : ''}: ${output}`);
        this.outputs.set(c.path, this.host.receipt?.(body) ?? body);
        // A view that shows nothing is a saved component the agent cannot use (tc-01: a refined view returned None on
        // every state and nobody noticed); consecutive empty states are counted for the refinement trigger.
        const empty = !result.ok || isEmptyValue(result.value);
        const streak = this.viewHealth.get(`${c.path}@${c.version}`) ?? { path: c.path, version: c.version, states: [] as number[], failed: 0 };
        streak.states = empty ? [...streak.states, n] : [];
        streak.failed = result.ok ? 0 : streak.failed + 1;
        streak.error = result.ok ? undefined : String(result.error ?? '');
        this.viewHealth.set(`${c.path}@${c.version}`, streak);
        if (!empty) this.viewShowed.add(`${c.path}@${c.version}`);
        this.host.log('observer_runs.jsonl', { key, n, name: c.name, version: c.version, versions: snap.versions,
          ok: result.ok, value: result.ok ? result.value : undefined, error: result.ok ? undefined : result.error, ms: Date.now() - started });
      };
      this.pending = this.pending.then(work);
    }
  }
  async observerText() {
    // Advisory work has its own pool and bounded wait, never a foreground WASI namespace.
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([this.pending, new Promise<void>(done => { timer = setTimeout(done, 5000); })]);
    clearTimeout(timer!);
    const level = this.host.level();
    const views = this.host.binder.active().filter(c => (c as any).view);
    const current = new Set(views.filter(c => c.level === level).map(c => c.path));
    const shown = [...this.outputs].filter(([path]) => current.has(path)).map(([, s]) => s.length > 900 ? s.slice(0, 900) : s);
    const stale = views.filter(c => c.level !== level).map(c =>
      `${c.path} v${c.version}: written on level ${c.level}; unconfirmed on level ${level}`);
    return [...shown, ...stale].join('\n').slice(0, 2400);
  }
  /** One generic, read-only Agent-authored callback at a runtime boundary. Its result is evidence, not authority. */
  private loopMounts(phase: 'decision' | 'action' | 'feedback', level = this.host.level()) {
    return this.host.binder.active().filter(c => c.kind === 'tool' && c.level === level && c.mount?.includes(phase));
  }
  private async runLoopMount(c: Component, event: Record<string, unknown>) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_LOOP_MOUNT_MS);
    let result: NativeResult;
    try {
      const snap = this.snapshot();
      result = await this.execute({ ...snap, mode: 'call', path: c.path, args: { args: {} },
        mount_event: { ...event, local: this.mountLocal.get(`${c.path}@${c.version}@${c.level}`) ?? null },
        allow_writes: false }, controller.signal, this.viewPool);
    } catch (error) { result = { ok: false, error: String(error) }; }
    finally { clearTimeout(timer); }
    const value = result.value as any;
    if (result.ok && event.phase !== 'action' && value && typeof value === 'object' && !Array.isArray(value)
      && Object.hasOwn(value, 'next_local')) {
      const encoded = JSON.stringify(value.next_local);
      if (!encoded || encoded.length > 8192) result = { ok: false, error: 'next_local must be JSON of at most 8192 characters' };
      else {
        const key = `${c.path}@${c.version}@${c.level}`;
        this.mountLocal.set(key, value.next_local);
        this.host.log('mount_state.jsonl', { key, path: c.path, version: c.version, level: c.level,
          n: this.host.actionCount(), local: value.next_local });
      }
    }
    const shownValue = result.ok && value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'context')
      ? value.context : result.value;
    const visible = shownValue && typeof shownValue === 'object' && !Array.isArray(shownValue)
      ? Object.fromEntries(Object.entries(shownValue).filter(([key]) => key !== 'next_local' && key !== 'expect_next')) : shownValue;
    const row = { kind: 'mount', path: c.path, version: c.version, level: c.level, decision: this.decision(),
      n: this.host.actionCount(), phase: event.phase, ok: result.ok, ms: Date.now() - started,
      ...(result.ok ? { value: JSON.stringify(visible ?? null).slice(0, 700) } : { error: String(result.error ?? '').slice(0, 300) }) };
    this.host.log('component_runs.jsonl', row);
    return { ...result, visible };
  }
  /** A free-form result enters the next decision head unasked, bounded by the host. */
  async loopDecisionText(): Promise<string> {
    const due = this.loopMounts('decision');
    if (!due.length) return '';
    const parts: string[] = [];
    for (const c of due.slice(0, MAX_LOOP_MOUNTS)) {
      const result = await this.runLoopMount(c, { phase: 'decision', decision: this.decision(), n: this.host.actionCount() });
      parts.push(`${c.path} v${c.version}: ${result.ok ? JSON.stringify(result.visible ?? null).slice(0, 700) : shown(result).slice(0, 700)}`);
    }
    if (due.length > MAX_LOOP_MOUNTS) parts.push(`${due.length - MAX_LOOP_MOUNTS} loop mount(s) skipped by runtime limit`);
    return `LOOP MOUNTS (Agent-authored; verify against the environment):\n${parts.join('\n')}`.slice(0, 2400);
  }
  /** At the action boundary only an explicit allow:false can refuse; failures also refuse, as for guards. */
  async loopAction(action: { name: string; x?: number; y?: number }): Promise<Array<{ path: string; version: number;
    allow: boolean; reason?: string; error?: string; expect_next?: Array<{ path: string; equals: unknown }> }>> {
    const due = this.loopMounts('action');
    const checks: Array<{ path: string; version: number; allow: boolean; reason?: string; error?: string;
      expect_next?: Array<{ path: string; equals: unknown }> }> = [];
    if (due.length > MAX_LOOP_MOUNTS) return [{ path: '(runtime)', version: 0, allow: false,
      error: `${due.length} action mounts exceed the runtime limit of ${MAX_LOOP_MOUNTS}` }];
    for (const c of due.slice(0, MAX_LOOP_MOUNTS)) {
      const result = await this.runLoopMount(c, { phase: 'action', decision: this.decision(), n: this.host.actionCount(), action });
      const value = result.value as any;
      const predictions = value && typeof value === 'object' ? value.expect_next : undefined;
      const validPredictions = predictions === undefined || (Array.isArray(predictions) && predictions.length <= 16
        && JSON.stringify(predictions).length <= 8192 && predictions.every((item: any) => item && typeof item === 'object'
          && typeof item.path === 'string' && item.path.length <= 100
          && /^(?:[A-Za-z_][A-Za-z_0-9]*|\d+)(?:\.(?:[A-Za-z_][A-Za-z_0-9]*|\d+))*$/.test(item.path)
          && Object.hasOwn(item, 'equals')));
      const allow = result.ok && validPredictions && (value === true || (value && typeof value === 'object' && value.allow === true));
      const reason = value && typeof value === 'object' && typeof value.reason === 'string' ? value.reason.slice(0, 200) : undefined;
      checks.push({ path: c.path, version: c.version, allow, ...(reason ? { reason } : {}),
        ...(allow && predictions ? { expect_next: predictions } : {}),
        ...(!result.ok ? { error: String(result.error ?? '').slice(0, 200) } :
          !validPredictions ? { error: 'expect_next must contain at most 16 bounded {path, equals} checks' } :
          value === false || (value && typeof value === 'object' && value.allow === false) ? {} :
          !allow ? { error: 'action mount must return bool or {allow: bool, reason?: str}' } : {}) });
    }
    return checks;
  }
  /** The post-action state is canonical; Agent code may update only its private bounded local state. */
  async loopFeedback(action: { name: string; x?: number; y?: number }, checks: unknown[], fromLevel: number) {
    const due = this.loopMounts('feedback', fromLevel);
    for (const c of due.slice(0, MAX_LOOP_MOUNTS))
      await this.runLoopMount(c, { phase: 'feedback', decision: this.decision(), n: this.host.actionCount(),
        from_level: fromLevel, action, checks });
    if (due.length > MAX_LOOP_MOUNTS) this.host.log('component_runs.jsonl', { kind: 'mount_limit', phase: 'feedback',
      n: this.host.actionCount(), level: fromLevel, skipped: due.length - MAX_LOOP_MOUNTS });
  }
  /** The active predictor tools: they define predict(state, action) (arc_thin_components.ts). */
  predictors() { return this.host.binder.active().filter(c => c.kind === 'tool' && (c as any).predictor && c.level === this.host.level()); }
  /** Active, current-level tools that define the read-only admit(state, action) action contract. */
  guards() { return this.host.binder.active().filter(c => c.kind === 'tool' && (c as any).guard && c.level === this.host.level()); }
  /** Run each active guard against the state and exact action about to cross the environment boundary. */
  async admit(action: { name: string; x?: number; y?: number }): Promise<Array<{ path: string; version: number; allow?: boolean; reason?: string; error?: string; ms: number }>> {
    const due = this.guards();
    if (!due.length) return [];
    const snap = this.snapshot();
    return Promise.all(due.map(async c => {
      const started = Date.now();
      try {
        const result = await this.execute({ ...snap, mode: 'call', path: c.path, args: { args: {} }, guard: action }, undefined, this.viewPool);
        if (!result.ok) return { path: c.path, version: c.version, error: [result.error, result.where].filter(Boolean).join(' · ').slice(0, 200), ms: Date.now() - started };
        const value = result.value as any;
        const allow = typeof value === 'boolean' ? value : value && typeof value === 'object' && typeof value.allow === 'boolean'
          ? value.allow : undefined;
        const reason = value && typeof value === 'object' && typeof value.reason === 'string' ? value.reason.slice(0, 200) : undefined;
        return { path: c.path, version: c.version, allow, ...(reason ? { reason } : {}),
          ...(allow === undefined ? { error: 'admit must return bool or {allow: bool, reason?: str}' } : {}), ms: Date.now() - started };
      } catch (error) {
        return { path: c.path, version: c.version, error: String(error).slice(0, 200), ms: Date.now() - started };
      }
    }));
  }
  /**
   * Each predictor's prediction for one action about to be played. The state is taken now, before the caller sends the
   * action, and the predictors run in the view pool while the environment answers; they cannot act or write.
   */
  predict(action: { name: string; x?: number; y?: number }): Promise<Array<{ path: string; version: number; value?: unknown; error?: string }>> {
    const due = this.predictors();
    if (!due.length) return Promise.resolve([]);
    const snap = this.snapshot();
    return Promise.all(due.map(async c => {
      try {
        const result = await this.execute({ ...snap, mode: 'call', path: c.path, args: { args: {} }, predict: action }, undefined, this.viewPool);
        return result.ok ? { path: c.path, version: c.version, value: result.value }
          : { path: c.path, version: c.version, error: [result.error, result.where].filter(Boolean).join(' · ').slice(0, 200) };
      } catch (error) { return { path: c.path, version: c.version, error: String(error).slice(0, 200) }; }
    }));
  }
  /** Each predictor's predictions for several candidate actions on the current state, one execution per predictor. */
  predictMany(actions: Array<{ name: string; x?: number; y?: number }>):
    Promise<Array<{ path: string; version: number; values?: Array<{ value?: unknown; error?: string }>; error?: string }>> {
    const due = this.predictors();
    if (!due.length || !actions.length) return Promise.resolve([]);
    const snap = this.snapshot();
    return Promise.all(due.map(async c => {
      try {
        const result = await this.execute({ ...snap, mode: 'call', path: c.path, args: { args: {} }, predict: actions }, undefined, this.viewPool);
        return result.ok && Array.isArray(result.value) ? { path: c.path, version: c.version, values: result.value as any[] }
          : { path: c.path, version: c.version, error: String(result.error ?? 'no list of predictions').slice(0, 200) };
      } catch (error) { return { path: c.path, version: c.version, error: String(error).slice(0, 200) }; }
    }));
  }
  private async consult(args: { agent: string; question: string; refs?: string[] }, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const available = this.host.immediateSubagent ? this.host.binder.candidates() : this.host.binder.active();
    const agent = available.find(c => c.kind === 'subagent' && c.name === args.agent);
    if (!agent || !ctx.model) throw Error(`no active subagent ${args.agent}; subagents: ${available.filter(c => c.kind === 'subagent').map(c => c.name).join(', ') || 'none'}`);
    const allowed = agent.tools ?? []; const refs = [...(agent.refs ?? []), ...(args.refs ?? [])];
    const tools: any[] = []; const runTools = new Map<string, (args: any) => Promise<any>>();
    // The subagent's python has a session of its own for this consult: it neither sees nor changes the parent's.
    const childSession = this.session ? new PythonSession() : undefined;
    for (const name of allowed) {
      if (name === 'arc_action') throw Error('arc_action cannot be granted');
      if (name === 'read') {
        const def = this.host.workspace.fileTools().find(t => t.name === 'read')!;
        tools.push({ name, description: def.description, parameters: def.parameters });
        runTools.set(name, args => def.execute('consult', args, signal, undefined, ctx));
      } else if (name === 'python') {
        tools.push({ name, description: 'Read-only one-off Python', parameters: Type.Object({ code: Type.String() }) });
        runTools.set(name, args => this.python(args.code, signal, true, undefined, childSession));
      } else {
        const c = this.host.binder.active().find(c => c.kind === 'tool' && c.name === name && !c.path.startsWith('observers/'));
        if (!c) throw Error(`subagent tool ${name} unavailable`);
        tools.push({ name, description: c.description, parameters: c.parameters });
        runTools.set(name, args => this.call(c, args, signal, true));
      }
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    const messages: any[] = [{ role: 'user', content: [{ type: 'text', text: `Question: ${args.question}\n` +
      refs.map(ref => `${ref}:\n${this.host.workspace.read(ref)}`).join('\n') }], timestamp: Date.now() }];
    const started = Date.now(); const deadline = started + 120000;
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 120000);
    let answer = ''; let lengths = 0;
    try {
      for (let round = 0; round < 6 && Date.now() < deadline; round++) {
        if (signal?.aborted) throw Error('consult aborted');
        const create = (onResponse?:any) => ctx.modelRegistry.streamSimple(ctx.model!, { systemPrompt: `CONSULT_ROLE ${agent.name}\n${agent.body}`, messages, tools } as any,
          { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: 'off', maxTokens: ctx.model!.maxTokens, ...(onResponse?{onResponse}:{}) } as any);
        const reply: any = this.host.modelResult ? await this.host.modelResult(create) : await create().result();
        this.host.usage('consult', reply); messages.push(reply);
        if (['error', 'aborted'].includes(reply.stopReason)) throw Error(`consult ${reply.stopReason}: ${reply.errorMessage ?? ''}`);
        answer = (reply.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (reply.stopReason === 'length') {
          if (++lengths > 1) throw Error('consult length continuation exhausted');
          messages.push({ role: 'user', content: 'Continue with the core conclusion and exact references.', timestamp: Date.now() }); continue;
        }
        const calls = (reply.content ?? []).filter((b: any) => b.type === 'toolCall');
        if (!calls.length) {
          this.host.log('consult_runs.jsonl', { role: agent.name, version: agent.version, refs, tools: allowed, answer, ms: Date.now() - started });
          const {ref}=this.host.workspace.saveResult(answer);
          return text(`${this.host.binder.label(agent.path)} →\n${this.host.workspace.receipt(answer)}\nref: ${ref}`);
        }
        for (const call of calls) {
          let result: any;
          try {
            const def = tools.find(t => t.name === call.name); if (!def) throw Error(`Tool ${call.name} not granted`);
            // A saved tool takes args={...}; inputs sent at the top level become args, as for the parent.
            const named = call.name !== 'read' && call.name !== 'python' && call.arguments && typeof call.arguments === 'object'
              && !('args' in call.arguments) && Object.keys(call.arguments).length;
            result = await runTools.get(call.name)!(validateToolArguments(def, named ? { ...call, arguments: { args: call.arguments } } : call));
          } catch (error) { result = text(String(error), true); }
          messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content,
            isError: Boolean(result.isError), timestamp: Date.now() });
        }
      }
      throw Error('consult tool/time budget exhausted');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  close() { this.viewPool.close(); this.kernel?.close(); }
  /** The line listing what the parent's python session holds, for the decision's working set. */
  sessionView(): string { return this.session?.view() ?? ''; }
}
