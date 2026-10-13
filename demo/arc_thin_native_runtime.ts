import { validateToolArguments } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Binder, type Component } from './arc_thin_binder.ts';
import { Workspace } from './arc_thin_workspace.ts';
import { executeNative, type ActCall, type NativeResult, type SessionDelta } from './arc_thin_components.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import { codeShape, componentLines, kitOf, repeatedFamilies, repetitionText, type PythonRun } from './arc_thin_reuse.ts';

/** One action taken for saved code: the observation it gets back, or why acting stopped; `line` is the receipt. */
export type ActOutcome = { observation?: Record<string, unknown>; stopped?: string; line?: string };
type Host = { pi: ExtensionAPI; workspace: Workspace; binder: Binder; state(): Record<string, unknown>;
  level(): number; actionCount(): number; decision?(): number; log(file: string, row: any): void; usage(kind: string, message: any): void;
  wrap(name: string, fn: (args: any, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<any>): any;
  artifacts?(result: NativeResult, component: Component, n: number): NativeResult;
  /** Take one action for saved code through the environment boundary (closed loop: env.act in the code). */
  act?(call: ActCall, via: string): Promise<ActOutcome>;
  receipt?(body: string): string; modelResult?(create:(onResponse:(response:any)=>void)=>any):Promise<any>;
  /** Keep what python calls define for later python calls (default true). */
  pythonSession?: boolean };
export const SAVE_NAME = /^[a-z_][a-z0-9_]{0,40}$/;
/** At most this many env.act calls in one tool call; acting code is replayed once per action. */
export const MAX_ACTS = 24;
/** Python session bounds: source of kept definitions and JSON of kept values; the oldest go first. */
const SESSION_DEF_CHARS = 48_000, SESSION_VALUE_CHARS = 96_000;
/** Python executions of the agent and its subagents that run at once (each is one python process). */
const MAX_PARALLEL = 4;
const shown = (result: NativeResult) => !result.ok ? [result.error, result.where].filter(Boolean).join('\n')
  : typeof result.value === 'object' && result.value !== null && 'stdout' in result.value
    ? [(result.value as any).stdout, (result.value as any).has_value ? '→ ' + JSON.stringify((result.value as any).value) : ''].filter(Boolean).join('\n')
    : JSON.stringify(result.value ?? null);
const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], isError });
export { codeShape, kitOf, repetitionText, type PythonRun } from './arc_thin_reuse.ts';

/** What one execution acted: the receipt lines and, when the runtime stopped it, why. */
type Acted = { lines: string[]; stopped?: string };

export class NativeRuntime {
  private registered = new Map<string, string>();
  private viewPool = new TaskPythonPool();
  private pending: Promise<unknown> = Promise.resolve();
  private observed = new Set<string>();
  private outputs = new Map<string, string>();
  private pythonRuns: PythonRun[] = [];
  /** What python calls defined: definitions (re-run from source) and JSON values, oldest first. */
  private session = { defs: new Map<string, string>(), vars: new Map<string, { value: unknown; chars: number }>() };
  private sessionPayload() {
    return { defs: Object.fromEntries(this.session.defs), vars: Object.fromEntries([...this.session.vars].map(([k, v]) => [k, v.value])) };
  }
  /** Keep a call's definitions and values; returns the names kept, for the receipt. */
  private keepSession(delta: SessionDelta | undefined): string {
    if (!delta) return '';
    const { defs, vars } = this.session;
    for (const [name, src] of Object.entries(delta.defs ?? {})) { defs.delete(name); defs.set(name, src); }
    for (const [name, value] of Object.entries(delta.vars ?? {})) { vars.delete(name); vars.set(name, { value, chars: JSON.stringify(value).length }); }
    let defChars = [...defs.values()].reduce((n, s) => n + s.length, 0);
    for (const [name, src] of defs) { if (defChars <= SESSION_DEF_CHARS) break; defs.delete(name); defChars -= src.length; }
    let valueChars = [...vars.values()].reduce((n, v) => n + v.chars, 0);
    for (const [name, v] of vars) { if (valueChars <= SESSION_VALUE_CHARS) break; vars.delete(name); valueChars -= v.chars; }
    const kept = [...Object.keys(delta.defs ?? {}).map(k => k.replace(/^import: /, '')), ...Object.keys(delta.vars ?? {})];
    return [kept.length ? `(kept for later python calls: ${kept.join(', ').slice(0, 300)})` : '',
      delta.dropped?.length ? `(not kept, not JSON or too large: ${delta.dropped.join(', ').slice(0, 200)})` : '',
      delta.failed?.length ? `(earlier definitions that failed to re-run and were dropped: ${delta.failed.join(', ')})` : ''].filter(Boolean).join('\n');
  }
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
    host.pi.registerTool({ name: 'consult', label: 'Consult', description: 'Ask a saved subagent (agents/<name>.md) with exact workspace refs. Subagents never act.',
      parameters: Type.Object({ agent: Type.String(), question: Type.String(), refs: Type.Optional(Type.Array(Type.String())) }),
      prepareArguments: (args: any) => args && typeof args === 'object' && args.role && !args.agent ? { ...args, agent: args.role } : args,
      execute: host.wrap('consult', (args, signal, ctx) => this.consult(args, signal, ctx)) });
  }
  /** The saved tools the agent can call by name (views under observers/ are shown, not called). */
  private callable() { return this.host.binder.candidates().filter(c => c.kind === 'tool' && !c.path.startsWith('observers/')); }
  /** Register candidates immediately; Pi advertises them only on its next request. Execution uses boundary snapshots. */
  register() {
    for (const c of this.callable()) {
      if (this.registered.get(c.name) === c.hash) continue;
      this.host.pi.registerTool({ name: c.name, label: c.name, description: c.description, parameters: c.parameters,
        // Older calls passed the inputs at the top level; they become args.
        prepareArguments: (args: any) => args && typeof args === 'object' && !('args' in args) && Object.keys(args).length ? { args } : args,
        execute: this.host.wrap(c.name, async (args, signal) => {
          const active = this.host.binder.active().find(x => x.path === c.path);
          if (!active) throw Error(`${c.name} is retired or off`);
          return this.call(active, args, signal);
        }) });
      this.registered.set(c.name, c.hash);
    }
  }
  toolNames() { return this.callable().filter(c => this.registered.has(c.name)).map(c => c.name); }
  /** Earlier python runs of this run (component_runs.jsonl), after a restart. */
  seedPython(rows: any[]) {
    for (const r of rows) {
      if (r?.kind === 'python' && !r.readonly && typeof r.shape === 'string')
        this.pythonRuns.push({ level: Number(r.level) || 0, shape: r.shape, lines: r.lines ?? [], struct: r.struct ?? [], gist: String(r.gist ?? ''), kit: String(r.kit ?? ''),
          decision: Number(r.decision) || 0, n: Number(r.n) || 0 });
    }
  }
  private decision() { return this.host.decision?.() ?? 0; }
  noteSave(path: string, receipt: string | undefined) {
    if (!/^(tools|observers|lib)\/[^/]+\.py$/.test(path)) return;
    const ok = !/NOT loaded/.test(receipt ?? '');
    this.host.log('component_runs.jsonl', { kind: 'save', path, decision: this.decision(), n: this.host.actionCount(), ok,
      ...(ok ? {} : { error: /NOT loaded \(([^)]*)\)/.exec(receipt ?? '')?.[1]?.slice(0, 200) }) });
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
   * saved tools last changed, or retyped although a saved tool covers it.
   */
  repeatedWork(level: number) {
    return repeatedFamilies(this.levelRuns(level), this.components()).filter(f => f.recent >= 3 || (f.covered && f.recent >= 2))
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
      this.host.workspace.path(op.path, true);
      if (op.destination) this.host.workspace.path(op.destination, true);
    }
    const receipts: string[] = [];
    for (const op of result.ops ?? []) {
      if (op.op === 'restore') {
        const source = this.host.binder.sourceOf(op.path, Number(op.version));
        if (source === undefined) { receipts.push(`${op.path}: no version ${op.version} to restore`); continue; }
        this.host.workspace.mutate({ op: 'write', path: op.path, content: source });
        const receipt = await this.host.binder.save(op.path, this.host.level());
        receipts.push(`${op.path}: restored from v${op.version}${receipt ? ` · ${receipt}` : ''}`); this.noteSave(op.path, receipt);
        continue;
      }
      this.host.workspace.mutate(op as any);
      if (op.op === 'write') { const receipt = await this.host.binder.save(op.path, this.host.level()); if (receipt) receipts.push(receipt); this.noteSave(op.path, receipt); }
      else receipts.push(`${op.path}: ${op.op === 'move' ? 'moved to ' + op.destination : 'deleted'} · bindings rebuilt next request`);
    }
    if (result.ops?.length) {
      await this.host.binder.scan(this.host.level()); this.register();
      // Tools are only added mid-decision, never removed: the tool list the agent sees stays consistent.
      const names = new Set(this.toolNames());
      this.host.pi.setActiveTools([...new Set([...this.host.pi.getActiveTools(), ...names])]);
    }
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
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      this.host.log('wasi_runs.jsonl',{mode:input.mode,n:this.host.actionCount(),...input.snapshotMetrics,
        lazy_restarts:Math.max(0,attempts.length-1),acts:acts.length,attempts,total_ms:performance.now()-started,
        timing_note:'execution_ms includes instantiate/guest; attempt ms includes host/compile/transport; do not sum overlapping phases'});
    }
  }
  /** The tool result: what the code returned, then what it did in the game; acting ends the decision. */
  private finish(body: string, result: NativeResult & { acted?: Acted }) {
    const shownBody = this.host.receipt?.(body) ?? body;
    const acted = result.acted;
    if (!acted?.lines.length) return text(shownBody + (acted?.stopped ? `\n(no action taken: ${acted.stopped})` : ''), !result.ok);
    return { ...text([shownBody, `ACTED ${acted.lines.length} action(s)${acted.stopped ? `; stopped: ${acted.stopped}` : ''}. This decision ends.`,
      ...acted.lines].join('\n'), !result.ok), terminate: true };
  }
  /**
   * One-off python. With `save`, the code is first saved as it is under tools/<save>.py and this run is its first
   * call: saving costs no rewrite, and only saved code may act.
   */
  async python(code: string, signal?: AbortSignal, readonly = false, save?: string) {
    const saveReceipts: string[] = [];
    let via: string | undefined;
    if (save !== undefined && !readonly) {
      if (!SAVE_NAME.test(save)) throw Error('save must be a lowercase name like route_to (letters, digits, _)');
      const path = `tools/${save}.py`;
      this.host.workspace.mutate({ op: 'write', path, content: code.endsWith('\n') ? code : code + '\n' });
      const receipt = await this.host.binder.save(path, this.host.level());
      if (receipt) saveReceipts.push(receipt);
      this.noteSave(path, receipt);
      await this.host.binder.scan(this.host.level()); this.register();
      const names = new Set(this.toolNames());
      this.host.pi.setActiveTools([...new Set([...this.host.pi.getActiveTools(), ...names])]);
      if (!/NOT loaded/.test(receipt ?? '')) via = path;
    }
    const snap = this.snapshot(); const started = Date.now();
    const kit = kitOf(this.host.binder.versionMap());
    const sessionOn = this.host.pythonSession !== false;
    const result = await this.execute({ ...snap, mode: 'exec', code, allow_writes: !readonly, ...(sessionOn ? { session: this.sessionPayload() } : {}) },
      signal, undefined, via);
    const receipts = [...saveReceipts, ...(result.ok ? await this.applyWrites(result) : [])];
    // A subagent's read-only python sees the session but does not change it.
    const kept = result.ok && !readonly ? this.keepSession(result.session) : '';
    const shape = codeShape(code);
    // A consult's read-only python is not the parent's own work.
    const decision = this.decision();
    if (!readonly) this.pythonRuns.push({ level: this.host.level(), ...shape, kit, decision, n: this.host.actionCount(), code: code.slice(0, 2000) });
    this.host.log('component_runs.jsonl', { kind: 'python', n: this.host.actionCount(), versions: snap.versions, ok: result.ok, ms: Date.now() - started,
      ...(readonly ? { readonly } : { level: this.host.level(), decision, ...shape, kit, ...(save ? { saved_as: `tools/${save}.py` } : {}) }),
      acted: result.acted?.lines.length ?? 0, ...(result.session ? { session_defs: Object.keys(result.session.defs ?? {}).length,
        session_vars: Object.keys(result.session.vars ?? {}).length, session_dropped: result.session.dropped?.length ?? 0 } : {}) });
    const failed = this.host.binder.active().map(c => this.host.binder.label(c.path)).filter(s => s.includes('failed'));
    // Save receipts first: a long output is clipped to its head, and the receipt says which version runs next.
    return this.finish([...receipts, shown(result), kept, ...failed.map(s => 'bindings: ' + s)].filter(Boolean).join('\n'), result);
  }
  async legacyAlias(name: string, args: any, signal?: AbortSignal) {
    const component = this.host.binder.active().find(c => c.kind === 'tool' && c.name === name && !c.path.startsWith('observers/'));
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
    const fallback = this.host.binder.active().filter(x => x.path !== c.path).map(x => this.host.binder.label(x.path)).filter(s => s.includes('failed'));
    return this.finish([`${label} →\n${shown(result)}`, ...receipts, ...fallback.map(s => 'bindings: ' + s)].join('\n'), result);
  }
  /** Tools marked as views run after every new state; their outputs are shown each decision. They never act. */
  observe(n: number) {
    const due = this.host.binder.active().filter(c => c.kind === 'tool' && (c as any).view && !this.observed.has(`${c.path}@${c.version}@${n}`));
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
        const body = `${c.name} v${c.version}${liveLabel.startsWith(`${c.name} v${c.version}`) ? liveLabel.slice(`${c.name} v${c.version}`.length) : ''} state #${n}: ${shown(result)}`;
        this.outputs.set(c.path, this.host.receipt?.(body) ?? body);
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
    const live = new Set(this.host.binder.active().filter(c => (c as any).view).map(c => c.path));
    return [...this.outputs].filter(([path]) => live.has(path)).map(([, s]) => s.length > 900 ? s.slice(0, 900) : s).join('\n').slice(0, 2400);
  }
  private async consult(args: { agent: string; question: string; refs?: string[] }, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const agent = this.host.binder.active().find(c => c.kind === 'subagent' && c.name === args.agent);
    if (!agent || !ctx.model) throw Error(`no active subagent ${args.agent}; subagents: ${this.host.binder.active().filter(c => c.kind === 'subagent').map(c => c.name).join(', ') || 'none'}`);
    const allowed = agent.tools ?? []; const refs = [...(agent.refs ?? []), ...(args.refs ?? [])];
    const tools: any[] = []; const runTools = new Map<string, (args: any) => Promise<any>>();
    for (const name of allowed) {
      if (name === 'arc_action') throw Error('arc_action cannot be granted');
      if (name === 'read') {
        const def = this.host.workspace.fileTools().find(t => t.name === 'read')!;
        tools.push({ name, description: def.description, parameters: def.parameters });
        runTools.set(name, args => def.execute('consult', args, signal, undefined, ctx));
      } else if (name === 'python') {
        tools.push({ name, description: 'Read-only one-off Python', parameters: Type.Object({ code: Type.String() }) });
        runTools.set(name, args => this.python(args.code, signal, true));
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
          { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: 'off', maxTokens: 1024,...(onResponse?{onResponse}:{}) } as any);
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
  close() { this.viewPool.close(); }
}
