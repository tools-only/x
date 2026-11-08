/** Isolated trials for the PPT host.
 *
 * A trial is an agent-written instruction that runs in its own scratch workspace with its own context — no parent
 * system prompt and no active prompts unless the agent names components to copy in — using the same model and the
 * confined file/program tools. What a trial writes stays in its scratch workspace; apply_trial copies the files the
 * agent selects back into the main workspace, where the Binder versions them like any other write. The runtime never
 * picks a winner, merges results or publishes anything on its own.
 */
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';

const TRIAL_DIRS = ['data', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results'];

export type TrialHost = {
  root: string;
  workspace: Workspace;
  binder: Binder;
  log(file: string, row: any): void;
  usage(kind: string, message: any): void;
  /** The host's provider accounting; every trial request goes through it like a consult. */
  modelResult?(create: (onResponse?: any) => any): Promise<any>;
  reasoning: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Mechanical bounds, not workflow: at most this many trials per call, rounds per trial, ms per trial. */
  maxTrials?: number;
  maxRounds?: number;
  timeoutMs?: number;
};

export type TrialSpec = { id?: string; instruction: string; materials?: string[]; components?: string[] };

type TrialOutcome = { id: string; ok: boolean; answer: string; files: string[]; rounds: number; ms: number; error?: string };

export class Trials {
  constructor(private host: TrialHost) {}

  private trialsRoot() { return join(this.host.root, '.harness', 'trials'); }
  private dir(id: string) { return join(this.trialsRoot(), id); }
  /** Trial ids currently on disk, oldest first. */
  ids(): string[] {
    const root = this.trialsRoot();
    return existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : [];
  }
  private nextId(): string {
    const used = new Set(this.ids());
    let n = 1;
    while (used.has(`t${n}`)) n += 1;
    return `t${n}`;
  }

  /** Run every trial sequentially in its own scratch workspace; a failed trial is reported, never fatal to the others. */
  async run(specs: TrialSpec[], ctx: any, signal: AbortSignal | undefined) {
    if (!ctx?.model || !ctx?.modelRegistry) throw Error('Trials need the active model context.');
    if (!specs.length) throw Error('trials: provide at least one trial');
    if (specs.length > (this.host.maxTrials ?? 3)) throw Error(`trials: at most ${this.host.maxTrials ?? 3} per call`);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    const outcomes: TrialOutcome[] = [];
    for (const spec of specs) {
      const id = spec.id?.trim() || this.nextId();
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw Error(`trial id ${JSON.stringify(id)}: letters, digits, _ and - only`);
      if (existsSync(this.dir(id))) rmSync(this.dir(id), { recursive: true, force: true });
      const started = Date.now();
      try {
        outcomes.push(await this.one(id, spec, ctx, auth, signal, started));
      } catch (error) {
        const message = String((error as Error)?.message ?? error).slice(0, 1200);
        this.host.log('trial_runs.jsonl', { kind: 'run', id, ok: false, error: message, ms: Date.now() - started });
        outcomes.push({ id, ok: false, answer: '', files: [], rounds: 0, ms: Date.now() - started, error: message });
      }
    }
    const body = outcomes.map(o => o.ok
      ? `trial ${o.id}: done in ${o.rounds} round(s), ${o.ms} ms; files written: ${o.files.join(', ') || '(none)'}\n${o.answer}`
      : `trial ${o.id}: FAILED after ${o.rounds} round(s): ${o.error}${o.answer ? `\npartial answer:\n${o.answer}` : ''}`).join('\n\n');
    return { content: [{ type: 'text', text: body }], outcomes };
  }

  private async one(id: string, spec: TrialSpec, ctx: any, auth: any, signal: AbortSignal | undefined, started: number): Promise<TrialOutcome> {
    const dir = this.dir(id);
    const scratch = new Workspace(dir, { dirs: TRIAL_DIRS });
    // Materials are copies of main-workspace files the agent named; components are the agent's own saved ones, copied
    // as ordinary files so the trial works with exactly what was asked for and nothing else.
    for (const path of spec.materials ?? []) {
      const clean = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
      this.host.workspace.path(clean);
      if (!existsSync(this.host.workspace.path(clean))) throw Error(`material ${clean}: not in the workspace`);
      scratch.runtimeWrite(clean, this.host.workspace.readBytes(clean));
    }
    const copied: string[] = [];
    for (const name of spec.components ?? []) {
      const c = this.host.binder.active().find(x => x.name === name) ?? this.host.binder.candidates().find(x => x.name === name);
      if (!c) throw Error(`component ${name}: no saved component by that name`);
      scratch.runtimeWrite(c.path, c.source);
      copied.push(`${c.path}@v${c.version}`);
    }
    scratch.writeGuard = path => {
      if (/^(tools\/|skills\/|agents\/|prompts\/|lib\/|notes\/memory\/|notes\/memory\.md$|AGENTS\.md$)/i.test(path))
        throw Error('Harness component files can only be changed with reflect_component(op="define" or "redefine").');
    };
    const binder = new Binder(scratch, validatePythonComponent);
    await binder.scan(0); binder.boundary();
    const stubPi: any = { registerTool() {}, on() {}, setActiveTools() {}, getActiveTools: () => [] };
    const runtime = new NativeRuntime({ pi: stubPi, workspace: scratch, binder, state: () => ({}), level: () => 0,
      actionCount: () => 0, decision: () => 0, hookTurn: () => false, pythonSession: false, pythonKernel: false,
      modelResult: this.host.modelResult,
      log: (file, row) => this.host.log('trial_runs.jsonl', { ...row, trial: id, inner: file }),
      usage: (kind, message) => this.host.usage('trial', { kind, message, trial: id }),
      wrap: (_name: string, fn: any) => async (_id: string, args: any, s: any, _u: any, c: any) => fn(args, s, c) });
    // The trial's toolset: the confined file tools, python and the named-program calls, all against the scratch workspace.
    const toolDefs: any[] = []; const runTools = new Map<string, (args: any) => Promise<any>>();
    for (const tool of scratch.fileTools()) {
      toolDefs.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
      runTools.set(tool.name, args => tool.execute('trial', args, signal, undefined, { cwd: scratch.root } as any));
    }
    toolDefs.push({ name: 'python', description: 'Run Python in the scratch workspace sandbox (text or binary files). Component paths require reflect_component.', parameters: Type.Object({ code: Type.String({ minLength: 1 }) }) });
    runTools.set('python', a => runtime.python(a.code, signal, false));
    toolDefs.push({ name: 'run_program', description: 'Run the live named program from the scratch workspace tools/ directory.', parameters: Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())) }) });
    runTools.set('run_program', a => runtime.runProgram(a.name, a.args ?? {}, signal));
    toolDefs.push({ name: 'list_programs', description: 'List named programs available in the scratch workspace.', parameters: Type.Object({ query: Type.Optional(Type.String()) }) });
    runTools.set('list_programs', a => ({ content: [{ type: 'text', text: binder.programCatalog(0, a.query ?? '') }] }));
    toolDefs.push({ name: 'read_component', description: 'Read a saved component source by name.', parameters: Type.Object({ name: Type.String() }) });
    runTools.set('read_component', a => {
      const c = binder.active().find(x => x.name === a.name);
      if (!c) throw Error('No active component by this name');
      return { content: [{ type: 'text', text: `${c.name}@v${c.version}\n${c.source}` }] };
    });
    // Its own context: the agent's instruction is the question, and no parent prompt travels with it.
    const systemPrompt = `TRIAL ${id}\nYou are working in an isolated scratch workspace. Files you write here are not visible in the main workspace until the caller applies them. Work in the workspace; produce the artifact or answer the instruction asks for.${copied.length ? `\nLoaded components: ${copied.join(', ')}.` : ''}`;
    const messages: any[] = [{ role: 'user', content: [{ type: 'text', text: spec.instruction }], timestamp: Date.now() }];
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, this.host.timeoutMs ?? 300000);
    const maxRounds = this.host.maxRounds ?? 12;
    let answer = ''; let rounds = 0;
    try {
      while (rounds < maxRounds) {
        if (signal?.aborted) throw Error('trial aborted');
        rounds += 1;
        const create = (onResponse?: any) => ctx.modelRegistry.streamSimple(ctx.model, { systemPrompt, messages, tools: toolDefs } as any,
          { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: this.host.reasoning, maxTokens: ctx.model.maxTokens, ...(onResponse ? { onResponse } : {}) } as any);
        const reply: any = this.host.modelResult ? await this.host.modelResult(create) : await create().result();
        this.host.usage('trial', reply);
        if (['error', 'aborted'].includes(reply.stopReason)) throw Error(`trial ${reply.stopReason}: ${reply.errorMessage ?? ''}`);
        answer = (reply.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        messages.push(reply);
        const calls = (reply.content ?? []).filter((b: any) => b.type === 'toolCall');
        if (!calls.length) break;
        for (const call of calls) {
          let result: any;
          try {
            const def = toolDefs.find(t => t.name === call.name); if (!def) throw Error(`Tool ${call.name} not available in a trial`);
            result = await runTools.get(call.name)!(validateToolArguments(def, call));
          } catch (error) { result = { content: [{ type: 'text', text: String((error as Error)?.message ?? error) }], isError: true }; }
          messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content, isError: Boolean(result.isError), timestamp: Date.now() });
        }
        if (reply.stopReason === 'length') messages.push({ role: 'user', content: 'Continue with the core result.', timestamp: Date.now() });
      }
      // Files this trial changed relative to the main workspace: computed from content, not from a write hook, so a
      // program's writes and the trial's own edits are counted the same way.
      const files = this.changed(id);
      this.host.log('trial_runs.jsonl', { kind: 'run', id, ok: true, rounds, ms: Date.now() - started, files, components: copied });
      return { id, ok: true, answer, files, rounds, ms: Date.now() - started };
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  /** Files a trial changed relative to the main workspace (or created): what apply_trial would copy by default. */
  changed(id: string): string[] {
    const scratch = new Workspace(this.dir(id), { dirs: TRIAL_DIRS });
    return scratch.files().filter(path => {
      if (/^(data|results)(\/|$)/.test(path)) return false;
      const main = this.host.workspace.path(path);
      if (!existsSync(main)) return true;
      const a = readFileSync(main), b = scratch.readBytes(path);
      return a.length !== b.length || !a.equals(b);
    });
  }

  /** Copy the selected trial files into the main workspace; components bind through the Binder like any write. */
  async apply(id: string, paths?: string[]) {
    if (!existsSync(join(this.dir(id), 'workspace'))) throw Error(`No trial ${id}; trials: ${this.ids().join(', ') || 'none'}`);
    const scratch = new Workspace(this.dir(id), { dirs: TRIAL_DIRS });
    const candidates = paths?.length ? paths.map(p => String(p).replace(/\\/g, '/').replace(/^\.\//, '')) : this.changed(id);
    if (!candidates.length) throw Error(`Trial ${id} left no changed files to apply; pass paths to copy specific files.`);
    const receipts: string[] = [];
    for (const clean of candidates) {
      if (/^(data|results)(\/|$)/.test(clean)) throw Error(`${clean}: data/ and results/ are read-only`);
      if (/^(tools\/|skills\/|agents\/|prompts\/|lib\/|notes\/memory\/|notes\/memory\.md$|AGENTS\.md$)/i.test(clean))
        throw Error(`${clean}: harness components can only be changed with reflect_component(op="define" or "redefine")`);
      if (/^(tools\/|skills\/|agents\/|prompts\/|notes\/memory\/|notes\/memory\.md$)/.test(clean))
        throw Error(`${clean}: harness components can only be changed with reflect_component(op="define" or "redefine")`);
      scratch.path(clean);
      const source = scratch.path(clean);
      if (!existsSync(source)) throw Error(`Trial ${id} has no file ${clean}`);
      const body = readFileSync(source);
      this.host.workspace.runtimeWrite(clean, body);
      if (!this.host.workspace.isBinary(clean)) {
        const receipt = await this.host.binder.save(clean, 0, { by: 'trial', decision: 0 });
        if (receipt) receipts.push(receipt);
      }
      receipts.push(`${clean}: applied from ${id} (${body.length} bytes)`);
    }
    this.host.binder.boundary();
    this.host.log('trial_runs.jsonl', { kind: 'apply', id, paths: candidates });
    return { content: [{ type: 'text', text: receipts.join('\n') }], paths: candidates };
  }
}
