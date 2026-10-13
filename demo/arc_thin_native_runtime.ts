import { validateToolArguments } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Binder, type Component } from './arc_thin_binder.ts';
import { Workspace } from './arc_thin_workspace.ts';
import { executeNative, type NativeResult } from './arc_thin_components.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import { adoptionGaps, codeShape, componentLines, kitOf, repeatedFamilies, repetitionText, type AdoptionGap, type PythonRun } from './arc_thin_reuse.ts';

type Host = { pi: ExtensionAPI; workspace: Workspace; binder: Binder; state(): Record<string, unknown>;
  level(): number; actionCount(): number; decision?(): number; log(file: string, row: any): void; usage(kind: string, message: any): void;
  wrap(name: string, fn: (args: any, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<any>): any;
  artifacts?(result: NativeResult, component: Component, n: number): NativeResult;
  receipt?(body: string): string };
const shown = (result: NativeResult) => !result.ok ? [result.error, result.where].filter(Boolean).join('\n')
  : typeof result.value === 'object' && result.value !== null && 'stdout' in result.value
    ? [(result.value as any).stdout, (result.value as any).has_value ? '→ ' + JSON.stringify((result.value as any).value) : ''].filter(Boolean).join('\n')
    : JSON.stringify(result.value ?? null);
const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], isError });
export { codeShape, kitOf, repetitionText, type PythonRun } from './arc_thin_reuse.ts';

/** A repeated computation that went on after it was shown, with where the reuse path broke (mechanical). */
export type LocatedGap = AdoptionGap & { level: number; finding: string; samples: string[] };

export class NativeRuntime {
  private registered = new Map<string, string>();
  private observers = new TaskPythonPool();
  private pending: Promise<unknown> = Promise.resolve();
  private observed = new Set<string>();
  private outputs = new Map<string, string>();
  private pythonRuns: PythonRun[] = [];
  constructor(private host: Host) {
    host.pi.registerTool({ name: 'consult', label: 'Consult', description: 'Ask a saved role with exact workspace refs. No game action access.',
      parameters: Type.Object({ role: Type.String(), question: Type.String(), refs: Type.Optional(Type.Array(Type.String())) }),
      execute: host.wrap('consult', (args, signal, ctx) => this.consult(args, signal, ctx)) });
  }
  /** Register candidates immediately; Pi advertises them only on its next request. Execution uses boundary snapshots. */
  register() {
    for (const c of this.host.binder.candidates().filter(c => c.kind === 'tool')) {
      if (['arc_action', 'read', 'write', 'edit', 'ls', 'grep', 'python', 'memory', 'consult', 'run_skill'].includes(c.name)) continue;
      if (this.registered.get(c.name) === c.hash) continue;
      this.host.pi.registerTool({ name: c.name, label: c.name, description: c.description, parameters: c.parameters,
        execute: this.host.wrap(c.name, async (args, signal) => {
          const active = this.host.binder.active().find(x => x.path === c.path);
          if (!active) throw Error(`${c.name} is retired or off`);
          return this.call(active, args, signal);
        }) });
      this.registered.set(c.name, c.hash);
    }
  }
  toolNames() { return this.host.binder.candidates().filter(c => c.kind === 'tool' && this.registered.has(c.name)).map(c => c.name); }
  /** Earlier python runs of this run (component_runs.jsonl), after a restart. */
  seedPython(rows: any[]) {
    for (const r of rows) {
      if (r?.kind === 'python' && !r.readonly && typeof r.shape === 'string')
        this.pythonRuns.push({ level: Number(r.level) || 0, shape: r.shape, lines: r.lines ?? [], struct: r.struct ?? [], gist: String(r.gist ?? ''), kit: String(r.kit ?? ''),
          decision: Number(r.decision) || 0, n: Number(r.n) || 0 });
      if (r?.kind === 'tool' && typeof r.path === 'string' && !r.readonly) this.uses.push({ path: r.path, decision: Number(r.decision) || 0 });
      if (r?.kind === 'save' && typeof r.path === 'string') this.saves.push({ path: r.path, decision: Number(r.decision) || 0, ok: r.ok !== false, error: r.error });
      if (r?.kind === 'reuse_shown' && Array.isArray(r.shapes))
        for (const s of r.shapes) if (!this.shown.has(s)) this.shown.set(s, Number(r.decision) || 0);
      if (r?.kind === 'reuse_gap' && Array.isArray(r.shapes)) for (const s of r.shapes) this.investigated.add(s);
    }
  }
  /** Calls the agent made to saved tools and imports of tools/lib modules from its python, by decision. */
  private uses: Array<{ path: string; decision: number }> = [];
  /** Component saves (write, edit or python) with whether they loaded. */
  private saves: Array<{ path: string; decision: number; ok: boolean; error?: string }> = [];
  /** Family key → decision at which REPEATED WORK first showed it; families already investigated as gaps. */
  private shown = new Map<string, number>();
  private investigated = new Set<string>();
  private decision() { return this.host.decision?.() ?? 0; }
  noteSave(path: string, receipt: string | undefined) {
    if (!/^(tools|observers|lib)\/[^/]+\.py$/.test(path)) return;
    const ok = !/NOT loaded/.test(receipt ?? '');
    const row = { path, decision: this.decision(), ok, ...(ok ? {} : { error: /NOT loaded \(([^)]*)\)/.exec(receipt ?? '')?.[1]?.slice(0, 200) }) };
    this.saves.push(row); this.host.log('component_runs.jsonl', { kind: 'save', ...row });
  }
  private components() {
    return this.host.binder.active().filter(c => /^(tools|observers|lib)\//.test(c.path) && c.path.endsWith('.py')).map(c => componentLines(c.path, c.source));
  }
  private levelRuns(level: number) {
    const kit = kitOf(this.host.binder.versionMap());
    return this.pythonRuns.filter(r => r.level === level && r.kit === kit);
  }
  /** REPEATED WORK for the working set; the families it names are remembered as shown at this decision. */
  repetitionText(level: number) {
    const runs = this.levelRuns(level); const components = this.components();
    const decision = this.decision();
    for (const family of repeatedFamilies(runs, components)) {
      const fresh = [...new Set(family.runs.map(r => r.shape))].filter(s => !this.shown.has(s));
      if (!fresh.length) continue;
      for (const s of fresh) this.shown.set(s, decision);
      this.host.log('component_runs.jsonl', { kind: 'reuse_shown', shapes: fresh, gist: family.gist, decision });
    }
    return repetitionText(runs, components);
  }
  /**
   * Families rebuilt after they were shown, each with a mechanical finding of where reuse broke. Returned once per
   * family (logged as reuse_gap); the semantic investigation is the caller's side call.
   */
  adoptionGaps(level: number): LocatedGap[] {
    const runs = this.pythonRuns.filter(r => r.level === level);
    const components = this.components();
    const out: LocatedGap[] = [];
    for (const gap of adoptionGaps(runs, components, this.shown, this.investigated)) {
      for (const s of gap.shapes) this.investigated.add(s);
      const since = gap.shownAt;
      const savedSince = this.saves.filter(s => s.decision >= since);
      let finding: string;
      if (gap.covered) {
        const used = this.uses.filter(u => u.path === gap.covered && u.decision >= since).length;
        finding = gap.covered.startsWith('observers/')
          ? `${gap.covered} covers it and its output is shown every decision, yet it was rebuilt ${gap.after.length} more times`
          : used ? `${gap.covered} covers it and was used ${used} times since, yet it was still rebuilt ${gap.after.length} more times`
            : `${gap.covered} covers it but was not used since; it was rebuilt ${gap.after.length} more times`;
      } else if (savedSince.some(s => !s.ok)) {
        const failed = savedSince.filter(s => !s.ok).at(-1)!;
        finding = `a component save failed validation since (${failed.path}: ${failed.error ?? 'not loaded'}); it was rebuilt ${gap.after.length} more times`;
      } else if (savedSince.length) {
        finding = `the components saved since (${[...new Set(savedSince.map(s => s.path))].join(', ')}) do not contain this code; it was rebuilt ${gap.after.length} more times`;
      } else finding = `no component was saved for it; it was rebuilt ${gap.after.length} more times`;
      const samples = gap.after.slice(-2).map(r => r.code ?? '').filter(Boolean);
      const located: LocatedGap = { ...gap, level, finding, samples };
      this.host.log('component_runs.jsonl', { kind: 'reuse_gap', shapes: gap.shapes, gist: gap.gist, level, shown_at: since, decision: this.decision(),
        rebuilt_after: gap.after.length, total: gap.total, covered: gap.covered, finding });
      out.push(located);
      break; // one investigation per decision; the next gap waits for the next decision
    }
    return out;
  }
  private snapshot() {
    const sources: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const c of this.host.binder.active()) if (c.path.endsWith('.py')) sources[c.path] = c.source;
    for (const path of this.host.workspace.files()) {
      if (/^(lib|tools|observers)\/.+\.py$/.test(path)) continue; // failed source never hides behind a working import
      if (/^skills\/.+\.py$/.test(path)) sources[path] = this.host.workspace.read(path);
      else files[path] = this.host.workspace.read(path);
    }
    const versions = this.host.binder.versionMap();
    for (const c of this.host.binder.active()) versions[c.path] = c.version;
    const artifacts = { ...(this.host.state().artifacts as Record<string, unknown> ?? {}) };
    for (const [path, body] of Object.entries(files)) if (/^artifacts\/[^/]+\.json$/.test(path)) {
      try { artifacts[path.slice(10, -5)] = JSON.parse(body); } catch { /* Non-JSON artifacts remain readable files. */ }
    }
    return { sources, files, state: { ...this.host.state(), artifacts }, versions };
  }
  private async applyWrites(result: NativeResult) {
    // Recheck untrusted guest output at the host boundary before applying any filesystem mutation.
    for (const op of result.ops ?? []) {
      this.host.workspace.path(op.path, true);
      if (op.destination) this.host.workspace.path(op.destination, true);
    }
    const receipts: string[] = [];
    for (const op of result.ops ?? []) {
      this.host.workspace.mutate(op);
      if (op.op === 'write') { const receipt = await this.host.binder.save(op.path, this.host.level()); if (receipt) receipts.push(receipt); this.noteSave(op.path, receipt); }
      else receipts.push(`${op.path}: ${op.op === 'move' ? 'moved to ' + op.destination : 'deleted'} · bindings rebuilt next request`);
    }
    if (result.ops?.length) {
      await this.host.binder.scan(this.host.level()); this.register();
      const names = new Set(this.toolNames());
      this.host.pi.setActiveTools([...this.host.pi.getActiveTools().filter(n => !this.registered.has(n) || names.has(n)), ...names]);
    }
    return receipts;
  }
  private async execute(input: ReturnType<NativeRuntime['snapshot']> & Record<string, any>, signal?: AbortSignal, pool?: TaskPythonPool) {
    // Store growth must not consume every call's WASI allowance. Reads fetch only exact confined snapshot files.
    const all = input.files; const files: Record<string, string> = {};
    const source = input.code ?? input.sources[input.path] ?? '';
    for (const [path, body] of Object.entries(all)) if (source.includes(`'${path}'`) || source.includes(`"${path}"`)) files[path] = body;
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, 20000);
    try {
      for (let reads = 0; reads <= 32; reads++) {
        const result = await executeNative({ ...input, files, file_names: Object.keys(all) }, controller.signal, pool);
        if (!result.need_file) return result;
        this.host.workspace.path(result.need_file);
        if (!Object.hasOwn(all, result.need_file) || Object.hasOwn(files, result.need_file)) throw Error('invalid workspace read request');
        files[result.need_file] = all[result.need_file];
      }
      throw Error('workspace read retry budget exceeded; use read with exact refs');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async python(code: string, signal?: AbortSignal, readonly = false) {
    const snap = this.snapshot(); const started = Date.now();
    const kit = kitOf(this.host.binder.versionMap());
    const result = await this.execute({ ...snap, mode: 'exec', code, allow_writes: !readonly }, signal);
    const receipts = result.ok ? await this.applyWrites(result) : [];
    const shape = codeShape(code);
    // A consult role's read-only python is not the parent's own work.
    const decision = this.decision();
    if (!readonly) {
      this.pythonRuns.push({ level: this.host.level(), ...shape, kit, decision, n: this.host.actionCount(), code: code.slice(0, 2000) });
      for (const m of code.matchAll(/\b(?:from|import)\s+(tools|lib)\.([A-Za-z_]\w*)/g)) this.uses.push({ path: `${m[1]}/${m[2]}.py`, decision });
    }
    this.host.log('component_runs.jsonl', { kind: 'python', n: this.host.actionCount(), versions: snap.versions, ok: result.ok, ms: Date.now() - started,
      ...(readonly ? { readonly } : { level: this.host.level(), decision, ...shape, kit }) });
    const failed = this.host.binder.active().map(c => this.host.binder.label(c.path)).filter(s => s.includes('failed'));
    // Save receipts first: a long output is clipped to its head, and the receipt says which version runs next.
    const body = [...receipts, shown(result), ...failed.map(s => 'bindings: ' + s)].join('\n');
    return text(this.host.receipt?.(body) ?? body, !result.ok);
  }
  async legacyAlias(name: string, args: any, signal?: AbortSignal) {
    const component = this.host.binder.active().find(c => c.kind === 'tool' && c.name === name);
    if (!component) throw Error(`legacy alias ${name}: tool retired or unavailable`);
    return this.call(component, { args }, signal);
  }
  private async call(c: Component, args: any, signal?: AbortSignal, readonly = false) {
    const snap = this.snapshot(); const started = Date.now(); const label = this.host.binder.label(c.path);
    let result = await this.execute({ ...snap, mode: 'call', path: c.path, args, allow_writes: !readonly }, signal);
    const receipts = result.ok ? await this.applyWrites(result) : [];
    if (!readonly && this.host.artifacts) result = this.host.artifacts(result, c, this.host.actionCount());
    if (!readonly) this.uses.push({ path: c.path, decision: this.decision() });
    this.host.log('component_runs.jsonl', { kind: 'tool', name: c.name, path: c.path, decision: this.decision(), readonly, n: this.host.actionCount(), version: c.version,
      versions: snap.versions, ok: result.ok, ms: Date.now() - started });
    const fallback = this.host.binder.active().filter(x => x.path !== c.path).map(x => this.host.binder.label(x.path)).filter(s => s.includes('failed'));
    const body = [`${label} →\n${shown(result)}`, ...receipts, ...fallback.map(s => 'bindings: ' + s)].join('\n');
    return text(this.host.receipt?.(body) ?? body, !result.ok);
  }
  observe(n: number) {
    const snap = this.snapshot();
    for (const c of this.host.binder.active().filter(c => c.kind === 'observer')) {
      const key = `${c.path}@${c.version}@${n}`; if (this.observed.has(key)) continue; this.observed.add(key);
      const work = async () => {
        const started = Date.now(); let result: NativeResult;
        try { result = await this.execute({ ...snap, mode: 'observe', path: c.path }, undefined, this.observers); }
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
    return [...this.outputs.values()].map(s => s.length > 900 ? s.slice(0, 900) : s).join('\n').slice(0, 2400);
  }
  private async consult(args: { role: string; question: string; refs?: string[] }, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const role = this.host.binder.active().find(c => c.kind === 'role' && c.name === args.role);
    if (!role || !ctx.model) throw Error('consult role or model unavailable');
    const allowed = role.tools ?? []; const refs = [...(role.refs ?? []), ...(args.refs ?? [])];
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
        const c = this.host.binder.active().find(c => c.kind === 'tool' && c.name === name);
        if (!c) throw Error(`role tool ${name} unavailable`);
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
        const stream = ctx.modelRegistry.streamSimple(ctx.model, { systemPrompt: `CONSULT_ROLE ${role.name}\n${role.body}`, messages, tools } as any,
          { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: 'off', maxTokens: 1024 } as any);
        const reply: any = await stream.result();
        this.host.usage('consult', reply); messages.push(reply);
        if (['error', 'aborted'].includes(reply.stopReason)) throw Error(`consult ${reply.stopReason}: ${reply.errorMessage ?? ''}`);
        answer = (reply.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (reply.stopReason === 'length') {
          if (++lengths > 1) throw Error('consult length continuation exhausted');
          messages.push({ role: 'user', content: 'Continue with the core conclusion and exact references.', timestamp: Date.now() }); continue;
        }
        const calls = (reply.content ?? []).filter((b: any) => b.type === 'toolCall');
        if (!calls.length) {
          this.host.log('consult_runs.jsonl', { role: role.name, version: role.version, refs, tools: allowed, answer, ms: Date.now() - started });
          const ref = this.host.workspace.resultRef(answer, 'c');
          return text(`${this.host.binder.label(role.path)} →\n${answer}\nref: ${ref}`);
        }
        for (const call of calls) {
          let result: any;
          try {
            const def = tools.find(t => t.name === call.name); if (!def) throw Error(`Tool ${call.name} not granted`);
            result = await runTools.get(call.name)!(validateToolArguments(def, call));
          } catch (error) { result = text(String(error), true); }
          messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content,
            isError: Boolean(result.isError), timestamp: Date.now() });
        }
      }
      throw Error('consult tool/time budget exhausted');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  close() { this.observers.close(); }
}
