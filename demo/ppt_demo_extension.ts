/** PPT host for the branch's Binder + NativeRuntime named-program implementation. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  const basePrompt = readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8');
  const adaptPrompt = readFileSync(fileURLToPath(new URL('./prompts/ppt_adapt_system.md', import.meta.url)), 'utf8');
  const activePromptText = () => binder.active().filter(c => c.kind === 'prompt').map(c => `${binder.label(c.path)}\n${c.body}`).join('\n\n');
  mkdirSync(join(root, 'harness'), { recursive: true });
  const statePath = join(root, '.harness', 'ppt-loop.json');
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { revision: 0, complete: false, events: [] };
  let resumed = false, initialized = false;
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const log = (file: string, row: any) => appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), ...row })+'\n');
  const readLog = (file: string) => existsSync(join(root, 'harness', file))
    ? readFileSync(join(root, 'harness', file), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  const canonicalSourcePath = () => existsSync(workspace.path('artifacts/presentation.html'))
    ? 'artifacts/presentation.html' : 'artifacts/deck.json';
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], terminate });
  const previousRequests = existsSync(join(root, 'harness/provider-requests.jsonl'))
    ? readFileSync(join(root, 'harness/provider-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const previousUsage = existsSync(join(root, 'harness/model-usage.jsonl'))
    ? readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.PPT_DEMO_REQUEST_RESERVE_USD ?? 3.52);
  const cap = Number(process.env.PPT_DEMO_BUDGET_USD ?? 12);
  const inputRate = Number(process.env.PPT_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.PPT_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.PPT_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.PPT_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  const imageReserve = Number(process.env.PPT_DEMO_IMAGE_RESERVE_USD ?? 0.25);
  let requests = previousRequests.at(-1)?.request ?? 0, reserved = 0;
  let spent = (lastUsage?.conservative_usd ?? 0) + Math.max(0, requests-(lastUsage?.request ?? 0))*reserve;
  const snapshot = () => {
    const sourcePath = canonicalSourcePath();
    const source = existsSync(workspace.path(sourcePath)) ? workspace.read(sourcePath) : null;
    const memory = workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))
      .map(path => ({ path, summary: workspace.read(path).split(/\r?\n/).find((line: string) => line.trim())?.slice(0, 240) ?? '' }));
    const feedback = state.lastFeedback;
    return { task: 'PPT production', revision: state.revision,
      last_feedback: feedback ? { revision: feedback.revision, slides: feedback.slides,
        native_objects: feedback.native_objects, warnings: feedback.warnings, source_path: feedback.source_path,
        evidence: feedback.evidence } : null,
      rendered_revisions: (state.renderedRevisions ?? []).slice(-8),
      memory,
      ...(source !== null ? { presentation_source: { path: sourcePath, bytes: Buffer.byteLength(source, 'utf8') } } : {}) };
  };
  let renderPresentation: (sourcePath?: string) => Promise<any>;
  const modelResult = async (create: any, kind = 'consult') => {
      if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
        writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, reason: 'consult budget boundary' }));
        process.exit(0);
      }
      spent += reserve;
      const request = ++requests;
      log('provider-requests.jsonl', { request, kind, estimated_usd_so_far: spent });
      let reply;
      try { reply = await create().result(); reply.autoresearchRequestId = request; }
      catch (error) {
        log('model-usage.jsonl', { request, kind, usage: null, conservative_usd: spent,
          usage_status: 'unknown_reserved', error: String(error).slice(0, 1200) });
        if (error && typeof error === 'object') (error as any).providerRequestId = request;
        throw error;
      }
      const u = reply.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && u.input + u.output > 0;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserve;
      log('model-usage.jsonl', { request, kind, usage: known ? u : null, conservative_usd: spent,
        usage_status: known ? 'reported' : 'unknown_reserved', stopReason: reply.stopReason });
      return reply;
    };
  const runtime = new NativeRuntime({ pi, workspace, binder, state: snapshot, level: () => 0,
    actionCount: () => requests, decision: () => requests, hookTurn: () => false, immediateSubagent: true,
    consultReasoning: (process.env.PPT_DEMO_THINKING ?? 'high') as 'low' | 'medium' | 'high',
    modelResult,
    pythonSession: false, pythonKernel: false, workMemory: false, log, usage: (kind, message) => log('usage.jsonl', { kind, message }),
    generateImage: async ({ prompt }, signal, ctx) => {
      if (!ctx.model) throw Error('Image generation needs the active model context for provider authentication.');
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      const base = (process.env.PPT_DEMO_IMAGE_API_BASE || ctx.model.baseUrl).replace(/\/+$/, '');
      const endpoint = /\/images\/generations$/i.test(base) ? base : `${base}/images/generations`;
      const apiKey = process.env.PPT_DEMO_IMAGE_API_KEY || auth.apiKey;
      if (!apiKey) throw Error('Image generation needs PPT_DEMO_IMAGE_API_KEY or model provider credentials.');
      const model = process.env.PPT_DEMO_IMAGE_MODEL || 'gpt-image-1';
      const format = (process.env.PPT_DEMO_IMAGE_FORMAT || 'png').toLowerCase();
      if (!['png', 'jpeg', 'webp'].includes(format)) throw Error('PPT_DEMO_IMAGE_FORMAT must be png, jpeg or webp.');
      if (spent + imageReserve > cap) throw Error('Image request exceeds the remaining task budget.');
      spent += imageReserve;
      const request = { model, prompt, n: 1, response_format: 'b64_json', ...(process.env.PPT_DEMO_IMAGE_SIZE ? { size: process.env.PPT_DEMO_IMAGE_SIZE } : {}),
        ...(process.env.PPT_DEMO_IMAGE_QUALITY ? { quality: process.env.PPT_DEMO_IMAGE_QUALITY } : {}), ...(format !== 'png' ? { output_format: format } : {}) };
      log('image-generation.jsonl', { event: 'started', model, endpoint, reserve_usd: imageReserve, prompt_chars: prompt.length });
      try {
        const headers = new Headers(auth.headers ?? {});
        headers.set('Authorization', `Bearer ${apiKey}`);
        headers.set('Content-Type', 'application/json');
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(request), signal });
        const body = await response.json() as any;
        if (!response.ok) throw Error(`Image API ${response.status}: ${JSON.stringify(body).slice(0, 1500)}`);
        const item = body?.data?.[0];
        if (typeof item?.b64_json !== 'string') throw Error('Image API response did not contain data[0].b64_json.');
        const ext = format === 'jpeg' ? 'jpg' : format;
        const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`;
        const data = item.b64_json;
        const imageCount = workspace.files('artifacts').filter(path => /^artifacts\/visuals\/image-\d+\./.test(path)).length;
        const path = `artifacts/visuals/image-${String(imageCount + 1).padStart(3, '0')}.${ext}`;
        workspace.runtimeWrite(path, Buffer.from(data, 'base64'));
        log('image-generation.jsonl', { event: 'completed', model, path, mimeType, bytes: Buffer.byteLength(data, 'base64'), reserve_usd: imageReserve });
        return { content: [{ type: 'text', text: `Generated ${path} (${mimeType}); include it by relative path in the HTML source.` },
          { type: 'image', data, mimeType }], generatedAsset: { path, data, mimeType } };
      } catch (error) {
        log('image-generation.jsonl', { event: 'failed', model, error: String(error).slice(0, 1500), reserve_usd: imageReserve });
        throw error;
      }
    },
    agent: async (request, signal, ctx) => {
      if (!ctx) throw Error('env.agent needs the active Pi request context');
      const reply: any = await runtime.runAgent(request as any, signal, ctx, (request as any).independent ? '' : () => `${basePrompt}\n${activePromptText()}`);
      return reply.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n') ?? '';
    },
    render: async request => renderPresentation(String(request.source_path ?? canonicalSourcePath())),
    wrap: (_name, fn) => async (_id: string, args: any, signal: any, _update: any, ctx: any) => fn(args, signal, ctx),
  });
  renderPresentation = async (sourcePath = canonicalSourcePath()) => {
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE)) throw Error('Task deadline reached before rendering.');
    if (!sourcePath.startsWith('artifacts/') || !/\.(json|html?)$/i.test(sourcePath)) throw Error('Render source must be a JSON or HTML file under artifacts/.');
    const source = workspace.path(sourcePath);
    if (!existsSync(source)) throw Error(`Render source does not exist: ${sourcePath}`);
    const revision = ++state.revision; persist();
    const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_artifact.py', import.meta.url));
    const deadline = Number(process.env.PPT_DEMO_DEADLINE);
    const timeout = Number.isFinite(deadline) ? Math.max(1, Math.min(180000, deadline - Date.now())) : 180000;
    const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, source, String(revision)], { encoding: 'utf8', timeout, maxBuffer: 2*1024*1024, windowsHide: true });
    if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error)).slice(-5000));
    const receipt = JSON.parse(child.stdout);
    state.lastFeedback = { revision, slides: receipt.slides, native_objects: receipt.native_objects,
      warnings: receipt.warnings, renderer: receipt.renderer, source_path: sourcePath,
      source_sha256: receipt.source_sha256, source_format: receipt.source_format };
    state.renderedRevisions = [...(state.renderedRevisions ?? []), state.lastFeedback];
    state.events.push({ type: 'render', ...state.lastFeedback }); persist();
    log('renders.jsonl', state.lastFeedback);
    const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
    cpSync(workspace.path('artifacts'), join(out, 'source-snapshot'), { recursive: true });
    const evidence = `results/renders/v${String(revision).padStart(3, '0')}`;
    workspace.runtimeWrite(`${evidence}/receipt.json`, readFileSync(join(out, 'receipt.json')));
    workspace.runtimeWrite(`${evidence}/contact-sheet.png`, readFileSync(join(out, 'contact-sheet.png')));
    for (let n = 1; n <= receipt.slides; n++) workspace.runtimeWrite(`${evidence}/slide-${String(n).padStart(2, '0')}.png`, readFileSync(join(out, `slide-${String(n).padStart(2, '0')}.png`)));
    state.lastFeedback.evidence = evidence; persist();
    return state.lastFeedback;
  };
  const taskTools = new Map<string, any>();
  const addTool = (tool: any) => { taskTools.set(tool.name, tool); pi.registerTool(tool); };
  const register = (name: string, description: string, parameters: any, fn: any) => addTool({ name, label: name,
    description, parameters, execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      let result;
      try {
        result = await fn(args, signal, ctx);
        if (['save_program', 'retire_program'].includes(name) && state.failedProgramSave?.name === args.name) {
          delete state.failedProgramSave; persist();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (name === 'save_program') {
          state.failedProgramSave = { name: args.name, error: message.slice(0, 400) }; persist();
        }
        log('tools.jsonl', { name, args: name === 'save_program' ? { ...args, body: '(rejected source is in session)' } : args, isError: true, error: message });
        throw error;
      }
      log('tools.jsonl', { name, args: name === 'save_program' ? { ...args, body: '(see versioned source)' } : args,
        result: result?.content?.filter((x: any) => x.type === 'text'), isError: result?.isError ?? false });
      return result;
    } });
  for (const tool of workspace.fileTools()) addTool({ ...tool, execute: async (id, args: any, signal, update, ctx) => {
    if (['write', 'edit'].includes(tool.name) && /^\/?\.?\/?delivery\//.test(String(args.path).replace(/\\/g, '/')))
      throw Error('delivery/ is generated by office(op="deliver"); edit the working source under artifacts/ through a harness component.');
    if (['write', 'edit'].includes(tool.name) && /^(tools|lib)\//.test(args.path)) throw Error('Use save_program for executable harness changes.');
    return tool.execute(id, args, signal, update, ctx);
  } });
  workspace.onWrite = async path => { const result = await binder.save(path, 0, { by: 'agent', decision: requests }); binder.boundary(); return result; };
  register('adapt', 'Start an independent ADAPT conversation with optional context text and exact workspace file refs you choose. It receives no task history, task prompt, or active prompts; it uses the same model and shared task budget. At call start it captures the current adapt_method skill body, if present; editing that skill affects later ADAPT calls only. It can use the available task tools except adapt itself (including office, where deliver may be callable; NativeRuntime consult is not included). It continues through tool calls/length continuation until it returns a final answer here; intermediate dialogue stays inside this call, with no separate exit tool. Its component changes can affect later task requests. The host core, loop, permissions, and budget handling are not editable here.',
    Type.Object({ context: Type.Optional(Type.String()), refs: Type.Optional(Type.Array(Type.String())) }),
    async (a: any, signal: any, ctx: any) => {
      if (!ctx.model) throw Error('ADAPT needs the active model context');
      const method = binder.active().find(component => component.kind === 'skill' && component.name === 'adapt_method');
      const systemPrompt = `${adaptPrompt}${method ? `\n\n## Agent-authored adapt_method (${method.path}@v${method.version})\n${method.body}` : ''}`;
      const content: any[] = [{ type: 'text', text: a.context ?? '' }];
      const reader = workspace.fileTools().find(tool => tool.name === 'read')!;
      for (const ref of a.refs ?? []) {
        const result = await reader.execute('adapt-context', { path: ref }, signal, undefined, ctx);
        if (result.isError) throw Error(`Cannot load ADAPT ref: ${ref}`);
        content.push({ type: 'text', text: `Selected ref: ${ref}` }, ...result.content);
      }
      const messages: any[] = [{ role: 'user', content, timestamp: Date.now() }];
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      log('lifecycle.jsonl', { event: 'adapt_enter', context: a.context ?? '', refs: a.refs ?? [] });
      while (true) {
        if (signal?.aborted) throw Error('ADAPT aborted');
        const tools = [...taskTools.values()].filter(tool => tool.name !== 'adapt');
        const create = () => ctx.modelRegistry.streamSimple(ctx.model, { systemPrompt, messages,
          tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) },
          { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: process.env.PPT_DEMO_THINKING ?? 'high', maxTokens: ctx.model.maxTokens });
        const reply = await modelResult(create, 'adapt');
        log('adapt_messages.jsonl', { message: reply });
        if (['error', 'aborted'].includes(reply.stopReason)) throw Error(`ADAPT ${reply.stopReason}: ${reply.errorMessage ?? ''}`);
        messages.push(reply);
        if (reply.stopReason === 'length') {
          messages.push({ role: 'user', content: 'Continue.', timestamp: Date.now() });
          continue;
        }
        const calls = reply.content.filter((part: any) => part.type === 'toolCall');
        if (!calls.length) {
          log('lifecycle.jsonl', { event: 'adapt_exit' });
          return text(reply.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n'));
        }
        for (const call of calls) {
          let result;
          try {
            const tool = tools.find(tool => tool.name === call.name);
            if (!tool) throw Error(`ADAPT tool unavailable: ${call.name}`);
            result = await tool.execute(call.id, validateToolArguments(tool, call), signal, undefined, ctx);
          } catch (error) { result = { ...text(String(error)), isError: true }; }
          const message = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content,
            isError: Boolean(result.isError), timestamp: Date.now() };
          messages.push(message); log('adapt_messages.jsonl', { message });
        }
      }
    });
  register('save_program', 'Create/revise a reusable Python program. Supply exactly one of body or source_path. For long source, write/edit a draft file in small pieces, then publish its source_path without repeating the code. Fresh WASI; state, args, env injected. Use open/json for workspace text. No host imports.',
    Type.Object({ name: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), description: Type.String({ minLength: 1, maxLength: 120, pattern: '^[^\\r\\n]+$' }), tags: Type.Optional(Type.Array(Type.String())), body: Type.Optional(Type.String()), source_path: Type.Optional(Type.String()), expected_version: Type.Optional(Type.Integer()) }),
    async (a: any) => {
      if ((a.body === undefined) === (a.source_path === undefined)) throw Error('Supply exactly one of body or source_path.');
      const body = a.source_path === undefined ? a.body : workspace.read(a.source_path);
      return text(await runtime.saveProgram(a.name, body, a.description, a.tags ?? [], a.expected_version));
    });
  register('run_program', 'Run an Agent-authored tool or workflow against the current task state. Omit version for active. Set readonly=true to refuse workspace writes and env.agent/env.render calls; it still reads the current workspace and is not a historical-state snapshot. Python source may write artifacts/presentation.html (preferred) or artifacts/deck.json; env.agent(...) runs a declared task-local agent and env.render(...) renders the current presentation.',
    Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())), version: Type.Optional(Type.Integer({ minimum: 1 })),
      readonly: Type.Optional(Type.Boolean()) }),
    (a: any, signal: any, ctx: any) => runtime.runProgram(a.name, a.args ?? {}, signal, a.version, ctx, a.readonly === true));
  register('retire_program', 'Retire an active named program from future use while keeping its source under tools_off/ and its version history. Supply the current version.',
    Type.Object({ name: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), expected_version: Type.Integer({ minimum: 1 }) }),
    async (a: any) => {
      const path = 'tools/' + a.name + '.py';
      const component = binder.active().find(c => c.path === path && c.program);
      if (!component) throw Error('program ' + a.name + ': no active named program');
      if (component.version !== a.expected_version) throw Error('program ' + a.name + ': expected v' + a.expected_version + ', current version is v' + component.version);
      const destination = 'tools_off/' + a.name + '.py';
      if (existsSync(workspace.path(destination))) throw Error('program ' + a.name + ': retired source already exists at ' + destination);
      workspace.mutate({ op: 'move', path, destination });
      await binder.scan(0);
      binder.boundary();
      runtime.register();
      return text({ retired: a.name, version: component.version, source: destination });
    });
  register('edit_program', 'Revise one exact text span in an active program while preserving its version history. Use read_component first.',
    Type.Object({ name: Type.String(), old_text: Type.String(), new_text: Type.String(), expected_version: Type.Integer({ minimum: 1 }) }),
    async (a: any) => {
      const c = binder.active().find(c => c.program && c.name === a.name);
      if (!c || c.version !== a.expected_version) throw Error('Program version changed; read_component and retry.');
      if (!a.old_text || c.source.split(a.old_text).length !== 2) throw Error('old_text must occur exactly once in the active source.');
      return text(await runtime.saveProgram(a.name, c.source.replace(a.old_text, a.new_text), c.description, c.tags ?? [], c.version));
    });
  register('list_programs', 'Find available executable methods and versions by purpose.', Type.Object({ query: Type.Optional(Type.String()) }),
    (a: any) => text(binder.programCatalog(0, a.query ?? '')));
  register('read_component', 'Inspect a named method source and exact active version.', Type.Object({ name: Type.String() }), (a: any) => {
    const c = binder.active().find(c => c.name === a.name);
    if (!c) throw Error('No active component by this name');
    return text(`${c.name}@v${c.version}\n${c.source}`);
  });
  register('self_component', 'Create or revise a task-local prompt, skill, memory entry, or subagent role. For subagents, declare allowed tools and a narrow write_scope for any write/edit capability. Saved components are available on subsequent requests.',
    Type.Object({ kind: Type.Union([Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('memory'), Type.Literal('subagent')]),
      name: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), content: Type.String(),
      description: Type.Optional(Type.String()), tools: Type.Optional(Type.Array(Type.String())), write_scope: Type.Optional(Type.Array(Type.String())) }),
    async (a: any) => {
      const path = a.kind === 'memory' ? `notes/memory/${a.name}.md` : a.kind === 'skill' ? `skills/${a.name}/SKILL.md`
        : a.kind === 'subagent' ? `agents/${a.name}.md` : `prompts/${a.name}.md`;
      const content = a.kind === 'memory' ? a.content : a.kind === 'prompt' ? `---\nactive: true\n---\n${a.content}`
        : a.kind === 'subagent' ? `---\ndescription: ${JSON.stringify(a.description ?? a.name)}\ntools: ${JSON.stringify(a.tools ?? ['read'])}${a.write_scope ? `\nwrite_scope: ${JSON.stringify(a.write_scope)}` : ''}\n---\n${a.content}`
        : `---\nname: ${a.name}\ndescription: ${JSON.stringify(a.description ?? a.name)}\n---\n${a.content}`;
      workspace.mutate({ op: 'write', path, content });
      const receipt = await binder.save(path, 0, { by: 'agent', decision: requests });
      return text(receipt ?? `Saved ${path}; the saved version is available to subsequent requests.`);
    });
  register('run_agent', 'Run a saved task-local subagent in a fresh context. It sees its role, active prompts, and only the files named in uses/refs or its role. Set independent=true to omit the parent instructions and active prompts for a fresh perspective. Its declared tools and write_scope control access. It cannot deliver.',
    Type.Object({ agent: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), task: Type.String(),
      uses: Type.Optional(Type.Array(Type.String())), refs: Type.Optional(Type.Array(Type.String())), save_as: Type.Optional(Type.String()), independent: Type.Optional(Type.Boolean()) }),
    async (a: any, signal: any, ctx: any) => {
      const uses = [...new Set(a.uses ?? [])];
      for (const ref of uses) {
        workspace.path(ref);
        if (!existsSync(workspace.path(ref))) throw Error(`run_agent uses missing file ${ref}`);
      }
      return runtime.runAgent({ ...a, uses }, signal, ctx, a.independent ? '' : () => `${basePrompt}\n${activePromptText()}`);
    });
  register('explore', 'Run an Agent-chosen number of independent, read-only candidate explorations in fresh contexts using your instructions and explicit refs. Same active model and task budget; candidates run sequentially. Returns each raw answer or failure separately. No candidate can use tools, change files, synthesize others, publish components or choose a winner.',
    Type.Object({ candidates: Type.Array(Type.Object({ instruction: Type.String({ minLength: 1 }), refs: Type.Optional(Type.Array(Type.String())) }), { minItems: 1 }) }),
    async (a: any, signal: any, ctx: any) => {
      if (!ctx) throw Error('explore needs the active Pi request context');
      const results = [];
      for (let index = 0; index < a.candidates.length; index++) {
        const candidate = a.candidates[index];
        const refs = [...new Set(candidate.refs ?? [])];
        const requestBefore = requests;
        try {
          const result = await runtime.explore(candidate.instruction, refs, signal, ctx);
          results.push({ index, instruction: candidate.instruction, ...result });
          log('explore_runs.jsonl', { index, instruction: candidate.instruction, refs, request: result.provider_request_id,
            request_observed: requests, status: 'ok', answer_ref: result.answer_ref });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ index, instruction: candidate.instruction, refs, error: message });
          log('explore_runs.jsonl', { index, instruction: candidate.instruction, refs, request: (error as any)?.providerRequestId ?? null,
            request_observed: requests, usage_status: requests > requestBefore ? 'see_model-usage.jsonl' : 'not_started', status: 'error', error: message });
        }
      }
      return text({ candidates: results, selection: 'agent_decides' });
    });
  register('office', 'Render the canonical HTML presentation (preferred; artifacts/presentation.html) or JSON fallback/candidate under artifacts/ through Edge and PowerPoint, inspect rendered pages, or deliver the current source and deck. Each render stores its source and assets. Use look to inspect revisions or recover to copy a revision into a new artifacts/ directory.',
    Type.Object({ op: Type.Union([Type.Literal('render'), Type.Literal('look'), Type.Literal('recover'), Type.Literal('deliver')]), source_path: Type.Optional(Type.String()), destination: Type.Optional(Type.String()), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async (a: any) => {
      if (a.op === 'render') {
        const sourcePath = a.source_path ?? canonicalSourcePath();
        const feedback = await renderPresentation(sourcePath);
        const out = join(root, 'exports', `v${String(feedback.revision).padStart(3, '0')}`);
        return { content: [...text(feedback).content, { type: 'image', data: readFileSync(join(out, 'contact-sheet.png')).toString('base64'), mimeType: 'image/png' }],
          terminate: false };
      }
      const revision = a.revision ?? state.lastFeedback?.revision;
      if (!revision || !existsSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'))) throw Error('No successful rendered revision');
      const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
      if (a.op === 'recover') {
        const snapshotPath = join(out, 'source-snapshot');
        if (!existsSync(snapshotPath)) throw Error('This render predates source snapshots.');
        const destination = a.destination;
        if (!destination || !/^artifacts\/[a-zA-Z0-9_-]+$/.test(destination))
          throw Error('Choose a new destination such as artifacts/recovered_v1.');
        const target = workspace.path(destination, true);
        if (existsSync(target)) throw Error('Recovery destination already exists; choose a new directory.');
        cpSync(snapshotPath, target, { recursive: true, errorOnExist: true });
        return text({ recovered_revision: revision, destination });
      }
      if (a.op === 'look') return { content: (a.pages ?? [1]).map((n: number) => ({ type: 'image', data: readFileSync(join(out, `slide-${String(n).padStart(2, '0')}.png`)).toString('base64'), mimeType: 'image/png' })) };
      const sourcePath = canonicalSourcePath();
      if (state.lastFeedback?.source_path !== sourcePath) throw Error(`Render the current canonical source ${sourcePath} before delivery.`);
      const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
      const sourceHash = createHash('sha256');
      for (const path of workspace.files('artifacts').sort()) {
        sourceHash.update(path.slice('artifacts/'.length)); sourceHash.update('\0');
        sourceHash.update(readFileSync(workspace.path(path))); sourceHash.update('\0');
      }
      if (receipt.source_sha256 !== sourceHash.digest('hex')) throw Error('Presentation source or a local asset changed since render; render current version before delivery.');
      const brief = workspace.read('data/instructions.md');
      const expectedSlides = /\b(\d+)\s+slides?\b/i.exec(brief)?.[1];
      if (expectedSlides && receipt.slides !== Number(expectedSlides))
        throw Error(`Rendered deck has ${receipt.slides} slides; the brief requires ${expectedSlides}.`);
      const delivery = join(root, 'delivery'); mkdirSync(delivery, { recursive: true });
      cpSync(out, join(delivery, 'presentation'), { recursive: true });
      cpSync(workspace.path('artifacts'), join(delivery, 'source'), { recursive: true });
      const components = binder.active();
      for (const c of components) { const path = join(delivery, 'harness', c.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, c.source); }
      for (const memoryPath of workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))) {
        const target = join(delivery, 'harness', memoryPath); mkdirSync(join(target, '..'), { recursive: true }); cpSync(workspace.path(memoryPath), target);
      }
      writeFileSync(join(delivery, 'harness.json'), JSON.stringify({ base: 'codex/agent-native-program-loop', components: components.map(c => ({ name: c.name, kind: c.kind, version: c.version, path: c.path, hash: c.hash })), load: 'Copy harness/ into a new PPT demo workspace; Binder loads and runs the saved programs with fresh state/args.' }, null, 2));
      for (const relative of ['.harness/components.jsonl', 'harness/tools.jsonl', 'harness/lifecycle.jsonl', 'harness/renders.jsonl', 'harness/usage.jsonl',
        'harness/consult_runs.jsonl', 'harness/model-usage.jsonl', 'harness/provider-requests.jsonl', 'session.jsonl']) {
        const source = join(root, relative);
        if (!existsSync(source)) continue;
        const target = join(delivery, 'harness-evidence', relative.replace(/^\.harness\//, ''));
        mkdirSync(join(target, '..'), { recursive: true }); cpSync(source, target);
      }
      state.complete = true; state.deliveredRevision = revision; persist(); log('lifecycle.jsonl', { event: 'delivered', revision });
      cpSync(join(root, 'harness', 'lifecycle.jsonl'), join(delivery, 'harness-evidence', 'harness', 'lifecycle.jsonl'));
      return text({ delivered: revision, directory: 'delivery/' }, true);
    });
  pi.on('before_agent_start', async (event: any) => {
    if (!initialized) {
      await binder.scan(0);
      if (!workspace.files('skills').includes('skills/self_evolution/SKILL.md')) {
        const skill = readFileSync(fileURLToPath(new URL('./harness-methods/self_evolution/SKILL.md', import.meta.url)), 'utf8');
        workspace.mutate({ op: 'write', path: 'skills/self_evolution/SKILL.md', content: skill });
        await binder.save('skills/self_evolution/SKILL.md', 0, { by: 'system', decision: requests });
      }
      binder.boundary(); runtime.register(); initialized = true;
    }
    resumed = event.prompt === 'PPT_RESUME' || event.prompt.startsWith('PPT_RESUME\n');
    if (!resumed) { binder.boundary(); persist(); }
    const selected = ['adapt', 'read', 'write', 'edit', 'ls', 'grep', 'save_program', 'edit_program', 'run_program', 'retire_program', 'list_programs', 'read_component', 'self_component', 'run_agent', 'explore', 'office'];
    selected.push('consult');
    pi.setActiveTools(selected);
    const systemPrompt = `${basePrompt}\n${activePromptText()}`;
    const skillIndex = binder.active().filter(c => c.kind === 'skill')
      .map(c => `${c.name}@v${c.version} | ${c.description} | read_component(name) for full method`).join('\n');
    const current = JSON.stringify(snapshot());
    const harnessIndex = binder.active().map(c => {
      const runs = c.kind === 'subagent'
        ? readLog('consult_runs.jsonl').filter((row: any) => row.role === c.name).length
        : readLog('component_runs.jsonl').filter((row: any) => row.path === c.path && ['tool', 'program_call'].includes(row.kind)).length;
      return `${c.path}@v${c.version} | ${c.description} | runs=${runs}`;
    });
    const unbounded = process.env.PPT_DEMO_UNBOUNDED === '1';
    const remainingMinutes = unbounded ? 'unlimited' : String(Math.max(0, Math.ceil((Number(process.env.PPT_DEMO_DEADLINE) - Date.now()) / 60000)));
    const budgetLine = unbounded
      ? `Remaining runtime and estimated spend: unlimited; provider requests ${requests}; generated images ${readLog('image-generation.jsonl').filter((row: any) => row.event === 'completed').length}.`
      : `Remaining: ${remainingMinutes} min; estimated USD ${Math.max(0, cap - spent).toFixed(2)} of ${cap.toFixed(2)}; provider requests ${requests}.`;
    log('lifecycle.jsonl', { event: resumed ? 'resume' : 'request_started' });
    return { systemPrompt, message: { customType: 'ppt-work-state', content: `Current state: ${current}\n${skillIndex}\n${binder.programCatalog(0)}\n${budgetLine}\nHarness index: ${harnessIndex.join('; ') || 'empty'}`, display: false } };
  });
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  pi.on('before_provider_request', (event: any) => {
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, reason: 'authorized budget boundary' }));
      process.exit(0); // Extension event exceptions are fail-open in Pi; stop before the HTTP call.
    }
    spent += reserve; reserved = reserve;
    const payload = event.payload as any;
    binder.boundary();
    const failedSave = state.failedProgramSave;
    const prompt = `${basePrompt}\n${activePromptText()}${failedSave ? `\nLatest unresolved program publication failure: ${JSON.stringify(failedSave)}. That save did not create or update the program; no successful execution follows from it. You may correct it or continue without that method.` : ''}`;
    if (Array.isArray(payload.system)) {
      const block = payload.system.find((part: any) => typeof part.text === 'string' && part.text.includes('You own both the presentation'));
      if (block) block.text = prompt;
    } else {
      const messages = payload.messages ?? payload.input;
      if (Array.isArray(messages)) {
        const head = messages.find((message: any) => (message.role === 'system' || message.role === 'developer') &&
          typeof message.content === 'string' && message.content.includes('You own both the presentation'));
        if (head) { head.content = prompt; delete head.sections; }
      }
    }
    log('provider-requests.jsonl', { request: ++requests, estimated_usd_so_far: spent,
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
  });
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'assistant') {
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
    }
  });
}
