/** R0: installed Pi contracts, exercised over RPC; no external provider. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager, convertToLlm, serializeConversation, createReadToolDefinition,
  createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { scriptedProviderTransport } from '../tests/pi_scripted_provider_transport.ts';

const source = fileURLToPath(import.meta.url);
const project = resolve(dirname(source), '..');
export const row = (path: string, value: unknown) => appendFileSync(path, JSON.stringify(value) + '\n');
export const rows = (path: string): any[] => {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)); }
  catch { return []; }
};

export function launchRpc(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events: any[] = []; let stderr = ''; let id = 0;
  createInterface({ input: child.stdout }).on('line', s => {
    try { const value = JSON.parse(s); events.push(value); row(join(cwd, 'rpc.jsonl'), value); }
    catch { stderr += s; }
  });
  child.stderr.on('data', s => { stderr = (stderr + s).slice(-12000); });
  const wait = async (predicate: (e: any) => boolean, start = 0) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const found = events.slice(start).find(predicate); if (found) return found;
      if (child.exitCode !== null) throw Error(`Pi exited ${child.exitCode}: ${stderr}`);
      await new Promise(done => setTimeout(done, 20));
    }
    throw Error(`RPC timeout: ${stderr}`);
  };
  return { events, wait, close: async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>(done => { child.once('exit', () => done()); child.kill(); });
  }, send: async (type: string, params: Record<string, unknown> = {}) => {
    const request = { id: ++id, type, ...params }; child.stdin.write(JSON.stringify(request) + '\n');
    const result = await wait(e => e.type === 'response' && e.id === request.id);
    return result;
  }, prompt: async (message: string) => {
    const start = events.length; const request = { id: ++id, type: 'prompt', message };
    child.stdin.write(JSON.stringify(request) + '\n');
    const ack = await wait(e => e.type === 'response' && e.id === request.id);
    assert.equal(ack.success, true, JSON.stringify(ack));
    await wait(e => e.type === 'agent_end', start);
  } };
}

export default function spike(pi: ExtensionAPI) {
  const root = process.env.ARC_RUN_ROOT!;
  const record = (value: unknown) => row(join(root, 'probe.jsonl'), value);
  const virtual = new Map<string, string>([['seed.txt', 'backend-only']]);
  const key = (p: string) => p.replace(/\\/g, '/').split('/').at(-1)!;
  const access = async (p: string) => { if (!virtual.has(key(p))) throw Error('missing virtual file'); };
  const readFile = async (p: string) => { await access(p); return Buffer.from(virtual.get(key(p))!); };
  const writeFile = async (p: string, text: string) => { virtual.set(key(p), text); };
  pi.registerTool(createReadToolDefinition(root, { operations: { access, readFile, detectImageMimeType: async () => null } }));
  pi.registerTool(createWriteToolDefinition(root, { operations: { writeFile, mkdir: async () => {} } }));
  pi.registerTool(createEditToolDefinition(root, { operations: { access, readFile, writeFile } }));
  pi.registerTool(createLsToolDefinition(root, { operations: { exists: () => true,
    stat: () => ({ isDirectory: () => true }), readdir: () => [...virtual.keys()] } }));
  pi.registerTool({ name: 'install', label: 'install', description: 'install dynamic tool', parameters: Type.Object({}),
    execute: async () => {
      pi.registerTool({ name: 'dynamic', label: 'dynamic', description: 'dynamic contract', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: 'DYNAMIC_SEMANTIC_42' }] }) });
      pi.setActiveTools([...pi.getActiveTools(), 'dynamic']);
      return { content: [{ type: 'text', text: 'installed' }] };
    } });
  pi.on('session_start', () => pi.setActiveTools(['read', 'write', 'edit', 'ls', 'install']));
  pi.on('before_agent_start', event => {
    if (event.prompt === 'raw') return { systemPrompt: 'RAW_PROMPT' };
    event.systemPromptOptions.sections.foundation = event.prompt === 'second' ? 'SECTION_V2' : 'SECTION_V1';
  });
  pi.on('session_before_compact', event => {
    const input = serializeConversation(convertToLlm(event.preparation.messagesToSummarize));
    record({ kind: 'compaction_input', input, tokens: event.preparation.tokensBefore });
  });
  let call = 0;
  pi.registerProvider('foundation-spike', { api: 'openai-completions', apiKey: 'offline', baseUrl: 'http://unused.invalid',
    models: [{ id: 'scripted', name: 'scripted', reasoning: true, input: ['text'], contextWindow: 175000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedProviderTransport((model, context) => {
      const system = context.systemPrompt || getCurrentSystemPrompt(context.messages); const tools = context.tools || getCurrentTools(context.messages);
      const summary = system.includes('summariz');
      const users = context.messages.filter((m: any) => m.role === 'user');
      const prompt = JSON.stringify(users.at(-1));
      const results = context.messages.filter((m: any) => m.role === 'toolResult');
      record({ kind: 'request', system, messages: context.messages, tools, summary });
      let calls: Array<[string, any]> = [];
      if (!summary && prompt.includes('first')) {
        const names = new Set(results.map((r: any) => r.toolName));
        if (!names.has('install')) calls = [['install', {}], ['write', { path: 'x.txt', content: 'old' }],
          ['edit', { path: 'x.txt', edits: [{ oldText: 'old', newText: 'new' }] }], ['ls', {}], ['read', { path: 'seed.txt' }]];
        else if (!names.has('dynamic')) calls = [['dynamic', {}], ['read', { path: 'x.txt' }]];
      }
      const output: any = { role: 'assistant', api: model.api, model: model.id, provider: model.provider,
        content: summary ? [{ type: 'text', text: 'Native checkpoint: SPIKE_RETAINED' }]
          : calls.length ? calls.map(([name, args]) => ({ type: 'toolCall', name, arguments: args, id: `spike-${++call}` }))
          : [{ type: 'text', text: 'SPIKE_RETAINED' }], stopReason: calls.length ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'start', partial: output });
      stream.push({ type: 'done', reason: output.stopReason, message: output }); stream.end(); return stream;
    }) });
}

export async function runSpike(root: string) {
  mkdirSync(root, { recursive: true }); mkdirSync(join(root, 'agent'), { recursive: true });
  const version = JSON.parse(readFileSync(join(project, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version;
  assert.equal(version, '0.87.0');
  const skill = join(root, 'skill/SKILL.md'); mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: spike-skill\ndescription: SPIKE_SKILL_DESCRIPTION\n---\nInstructions.\n');
  writeFileSync(join(root, 'agent/settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 100, reserveTokens: 1000 } }));
  const session = join(root, 'session.jsonl');
  const env = { ...process.env, PI_CODING_AGENT_DIR: join(root, 'agent'), ARC_RUN_ROOT: root };
  const args = [join(project, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--mode', 'rpc',
    '--provider', 'foundation-spike', '--model', 'scripted', '--session', session, '--no-extensions',
    '--no-context-files', '--no-builtin-tools', '--no-prompt-templates', '--no-skills', '--skill', skill, '--extension', source];
  let rpc = launchRpc(args, root, env);
  try { await rpc.prompt('first'); await rpc.prompt('second'); await rpc.prompt('raw'); }
  finally { await rpc.close(); }
  rpc = launchRpc(args, root, env);
  try { await rpc.prompt('restart'); } finally { await rpc.close(); }
  // Seed diagnostically; the real Pi compact RPC receives and serializes these canonical entries.
  const manager = SessionManager.open(session);
  manager.appendMessage({ role: 'user', content: 'compaction seed', timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'foundation-spike', model: 'scripted',
    content: [{ type: 'thinking', thinking: 'THINKING_PROBE'.repeat(400) },
      { type: 'toolCall', id: 'long', name: 'read', arguments: { path: 'long.txt' } }], stopReason: 'toolUse',
    timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendMessage({ role: 'toolResult', toolCallId: 'long', toolName: 'read', isError: false,
    content: [{ type: 'text', text: 'R'.repeat(2300) + 'COUNTEREXAMPLE_MIDDLE' + 'Z'.repeat(6000) }], timestamp: Date.now() });
  for (let n = 0; n < 8; n++) manager.appendMessage({ role: 'user', content: `later ${n} ` + 'context '.repeat(80), timestamp: Date.now() });
  rpc = launchRpc(args, root, env); let compact: any; const started = Date.now();
  try { compact = await rpc.send('compact'); assert.equal(compact.success, true, JSON.stringify(compact)); }
  finally { await rpc.close(); }
  const log = rows(join(root, 'probe.jsonl')); const requests = log.filter(r => r.kind === 'request');
  const input = log.find(r => r.kind === 'compaction_input')?.input ?? '';
  const saved = rows(session); const wire = JSON.stringify(requests);
  const probes = [
    { name: 'session continuity and restart', verified: true, pass: requests.some(r => !r.summary && JSON.stringify(r.messages).includes('restart') && JSON.stringify(r.messages).includes('SPIKE_RETAINED')) },
    { name: 'system sections patch', verified: true, pass: saved.some(r => JSON.stringify(r).includes('SECTION_V1')) && saved.some(r => JSON.stringify(r).includes('SECTION_V2')), artifact: session },
    { name: 'mid-session registerTool', verified: true, pass: wire.includes('DYNAMIC_SEMANTIC_42') },
    { name: 'forced prompt and skills', verified: true, pass: false,
      observed: { structuredHasSkill: requests.some(r => r.system.includes('SPIKE_SKILL_DESCRIPTION')), rawHasSkill: requests.some(r => r.system === 'RAW_PROMPT' && r.system.includes('SPIKE_SKILL_DESCRIPTION')) },
      workaround: 'Use systemPromptOptions.customPrompt and sections; do not return forced systemPrompt.' },
    { name: 'built-in custom backends', verified: true, pass: wire.includes('backend-only') && wire.includes('new'),
      limitation: 'grep still spawns host rg; replace its execute with a confined workspace search.' },
    { name: 'native compaction input', verified: true, pass: false, reasoningIncluded: input.includes('THINKING_PROBE'),
      counterexampleIncluded: input.includes('COUNTEREXAMPLE_MIDDLE'), inputChars: input.length, wallMs: Date.now() - started,
      workaround: 'Project reasoning out and replace long tool results with workspace receipts before compact. Keep auto-compaction off until native input smoke passes.' }
  ];
  assert.ok(input.length > 0, 'compaction input was not observed');
  const report = { piVersion: version, paidTokens: 0, provider: 'foundation-spike/scripted', environment: 'real Pi RPC, virtual files, no ARC bridge', probes };
  writeFileSync(join(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
if (resolve(process.argv[1] ?? '') === source) {
  console.log(JSON.stringify(await runSpike(resolve(process.argv[2] ?? join(project, 'runs/foundation-r0'))), null, 2));
}
