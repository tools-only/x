import { validateToolArguments } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Binder, type Component } from './arc_thin_binder.ts';
import { Workspace } from './arc_thin_workspace.ts';
import { executeNative, type NativeResult } from './arc_thin_components.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';

type Host = { pi: ExtensionAPI; workspace: Workspace; binder: Binder; state(): Record<string, unknown>;
  level(): number; actionCount(): number; log(file: string, row: any): void; usage(kind: string, message: any): void;
  wrap(name: string, fn: (args: any, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<any>): any;
  receipt?(body: string): string };
const shown = (result: NativeResult) => !result.ok ? [result.error, result.where].filter(Boolean).join('\n')
  : typeof result.value === 'object' && result.value !== null && 'stdout' in result.value
    ? [(result.value as any).stdout, (result.value as any).has_value ? '→ ' + JSON.stringify((result.value as any).value) : ''].filter(Boolean).join('\n')
    : JSON.stringify(result.value ?? null);
const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], isError });

export class NativeRuntime {
  private registered = new Map<string, string>();
  private observers = new TaskPythonPool();
  private pending: Promise<unknown> = Promise.resolve();
  private observed = new Set<string>();
  private outputs = new Map<string, string>();
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
  private snapshot() {
    const sources: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const c of this.host.binder.active()) if (c.path.endsWith('.py')) sources[c.path] = c.source;
    for (const path of this.host.workspace.files()) {
      if (/^(lib|tools|observers)\/.+\.py$/.test(path)) continue; // failed source never hides behind a working import
      if (/^skills\/.+\.py$/.test(path)) sources[path] = this.host.workspace.read(path);
      else files[path] = this.host.workspace.read(path);
    }
    const versions = Object.fromEntries(this.host.binder.active().map(c => [c.path, c.version]));
    return { sources, files, state: this.host.state(), versions };
  }
  private async applyWrites(result: NativeResult) {
    // Recheck untrusted guest output at the host boundary before applying any filesystem mutation.
    for (const path of Object.keys(result.writes ?? {})) this.host.workspace.path(path, true);
    for (const [path, body] of Object.entries(result.writes ?? {})) {
      this.host.workspace.runtimeWrite(path, body);
      await this.host.binder.save(path, this.host.level());
    }
    if (Object.keys(result.writes ?? {}).length) this.register();
  }
  async python(code: string, signal?: AbortSignal, readonly = false) {
    const snap = this.snapshot(); const started = Date.now();
    const result = await executeNative({ ...snap, mode: 'exec', code, allow_writes: !readonly }, signal);
    if (result.ok) await this.applyWrites(result);
    this.host.log('component_runs.jsonl', { kind: 'python', n: this.host.actionCount(), versions: snap.versions, ok: result.ok, ms: Date.now() - started });
    return text(this.host.receipt?.(shown(result)) ?? shown(result), !result.ok);
  }
  private async call(c: Component, args: any, signal?: AbortSignal, readonly = false) {
    const snap = this.snapshot(); const started = Date.now(); const label = this.host.binder.label(c.path);
    const result = await executeNative({ ...snap, mode: 'call', path: c.path, args, allow_writes: !readonly }, signal);
    if (result.ok) await this.applyWrites(result);
    this.host.log('component_runs.jsonl', { kind: 'tool', name: c.name, n: this.host.actionCount(), version: c.version,
      versions: snap.versions, ok: result.ok, ms: Date.now() - started });
    const body = `${label} →\n${shown(result)}`;
    return text(this.host.receipt?.(body) ?? body, !result.ok);
  }
  observe(n: number) {
    const snap = this.snapshot();
    for (const c of this.host.binder.active().filter(c => c.kind === 'observer')) {
      const key = `${c.path}@${c.version}@${n}`; if (this.observed.has(key)) continue; this.observed.add(key);
      const work = async () => {
        const started = Date.now(); let result: NativeResult;
        try { result = await executeNative({ ...snap, mode: 'observe', path: c.path }, undefined, this.observers); }
        catch (error) { result = { ok: false, error: String(error) }; }
        const body = `${this.host.binder.label(c.path)} state #${n}: ${shown(result)}`;
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
          const ref = `results/consult-${started}.txt`; this.host.workspace.runtimeWrite(ref, answer);
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
