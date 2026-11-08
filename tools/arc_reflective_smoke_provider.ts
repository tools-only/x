/** Scripted local provider for the native reflective ARC adapter smoke. */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { scriptedProviderTransport } from '../tests/pi_scripted_provider_transport.ts';

const definitions = [
  ['tool', 'smoke_tool', '# program: on\ndef run(state, args):\n    return {"result": "ok"}\n'],
  ['prompt', 'smoke_prompt', 'Initial authored prompt text.'],
  ['skill', 'smoke-skill', '---\nname: smoke-skill\ndescription: fixture skill\n---\nFixture skill body.'],
  ['subagent', 'smoke_agent', '---\ntools: []\n---\nReturn a short factual response.'],
  ['memory', 'smoke_memory', 'Counterevidence: none yet. Unfinished test: inspect the current fixture state.'],
  ['process', 'smoke_process', JSON.stringify({ strategy: 'Fixture process text.' })],
] as const;
const revised = (kind: string, name: string, source: string) => kind === 'process'
  ? JSON.stringify({ strategy: 'Revised fixture process text.' })
  : kind === 'memory' ? 'Revised authored memory.'
    : kind === 'skill' ? `---\nname: ${name}\ndescription: fixture skill\n---\nRevised fixture skill body.`
    : kind === 'tool' ? '# program: on\ndef run(state, args):\n    return {"result": "revised"}\n'
    : source + '\nRevised fixture text.\n';
const lifecyclePlan: Array<{ op: 'redefine' | 'restore' | 'use' | 'read'; index: number; path?: string }> = [
  { op: 'redefine', index: 0 }, { op: 'use', index: 0 }, { op: 'restore', index: 0 },
  { op: 'redefine', index: 1 }, { op: 'restore', index: 1 },
  { op: 'redefine', index: 2 }, { op: 'read', index: 2, path: 'components/skill/smoke-skill/v2.source' },
  { op: 'read', index: 2, path: 'skills/smoke-skill/SKILL.md' }, { op: 'restore', index: 2 },
  { op: 'redefine', index: 3 }, { op: 'use', index: 3 }, { op: 'restore', index: 3 },
  { op: 'redefine', index: 4 }, { op: 'restore', index: 4 },
  { op: 'redefine', index: 5 }, { op: 'restore', index: 5 },
  ...definitions.map(([_kind, _name], index) => ({ op: 'read' as const, index, path: `components/${definitions[index][0]}/${definitions[index][1]}/v1.source` })),
];

export default function arcReflectiveSmokeProvider(pi: ExtensionAPI) {
  const root = process.env.ARC_RUN_ROOT ?? process.cwd();
  const tracePath = join(root, 'scripted-provider.jsonl');
  let request = 0;
  let step = 0;
  let defined = false;
  let call = 0;
  let queued = false;
  let rejected = false;
  let lengthStopped = false;
  let resetUsed = false;
  pi.registerProvider('offline-arc-reflective-smoke', {
    api: 'openai-completions', apiKey: 'offline', baseUrl: 'http://unused.invalid',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text', 'image'], contextWindow: 175000,
      maxTokens: 12000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedProviderTransport((_model, context) => {
      const stream = createAssistantMessageEventStream();
      const output: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'offline-arc-reflective-smoke',
        model: 'scripted', content: [], stopReason: 'stop', timestamp: Date.now() };
      const messages: any[] = context.messages ?? [];
      const tools: any[] = context.tools?.length ? context.tools : getCurrentTools(messages as any);
      const system = String(context.systemPrompt || getCurrentSystemPrompt(messages as any) || '');
      const unknownUsage = process.env.SMOKE_UNKNOWN_USAGE === '1'
        || process.env.SMOKE_UNKNOWN_CHILD_USAGE === '1' && tools.length === 0;
      if (!unknownUsage) output.usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      appendFileSync(tracePath, JSON.stringify({ request: ++request, system, tools: tools.map(tool => tool.name), messages }) + '\n');
      const toolNames = new Set(tools.map(tool => tool.name));
      const calls: Array<[string, Record<string, unknown>]> = [];
      if (!toolNames.has('arc_action')) {
        output.content = [{ type: 'text', text: 'Fixture child response with no environment authority.' }];
      } else if (toolNames.has('reflect_component') && !defined) {
        for (const [kind, name, source] of definitions) calls.push(['reflect_component', { op: 'define', kind, name, source, note: 'offline lifecycle fixture' }]);
        defined = true;
      } else if (step < lifecyclePlan.length) {
        const item = lifecyclePlan[step];
        const [kind, name, source] = definitions[item.index];
        if (item.op === 'redefine') calls.push(['reflect_component', { op: item.op, kind, name,
          source: revised(kind, name, source), note: 'offline version fixture' }]);
        else if (item.op === 'restore') calls.push(['reflect_component', { op: item.op, kind, name, version: 1,
          note: 'offline restore fixture' }]);
        else if (item.op === 'use' && kind === 'tool') calls.push(['smoke_tool', {}]);
        else if (item.op === 'use' && kind === 'subagent') {
          calls.push(['smoke_agent', { question: 'Return a short factual response.' }]);
          if (process.env.SMOKE_CONCURRENT_CHILDREN === '1') calls.push(['smoke_agent', { question: 'Return another short factual response.' }]);
        } else if (item.op === 'read') calls.push(['read', { path: item.path }]);
        step++;
      } else if (toolNames.has('arc_action') && step >= lifecyclePlan.length) {
        const latestUser: any = [...messages].reverse().find((message: any) => message.role === 'user');
        const userText = typeof latestUser?.content === 'string' ? latestUser.content
          : (latestUser?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
        const environment = userText.split('CURRENT CANONICAL ENVIRONMENT\n').at(-1)?.trimStart().split('\n')[0];
        const available = environment ? JSON.parse(environment).available_actions ?? [] : [];
        const action = process.env.SMOKE_RESET_FIRST === '1' && !resetUsed ? available.find((name: string) => name === 'RESET')
          : available.find((name: string) => name !== 'RESET') ?? available[0];
        if (action && process.env.SMOKE_LENGTH_BEFORE_ACTION === '1' && !lengthStopped) {
          output.stopReason = 'length';
          lengthStopped = true;
        } else if (action) {
          const chosen = process.env.SMOKE_REJECT_FIRST_ACTION === '1' && !rejected ? 'NOT_AVAILABLE'
            : action;
          calls.push(['arc_action', { action: chosen }]);
          if (action === 'RESET') resetUsed = true;
          if (chosen === 'NOT_AVAILABLE') rejected = true;
          else if (process.env.SMOKE_QUEUE_ACTIONS === '1' && !queued) { calls.push(['arc_action', { action }]); queued = true; }
          step++;
        }
      }
      if (calls.length) output.content = calls.map(([name, args]) => ({ type: 'toolCall' as const, id: `arc-reflective-${++call}`, name, arguments: args }));
      else if (!output.content.length) output.content = [{ type: 'text', text: 'No action tool is available.' }];
      stream.push({ type: 'start', partial: output });
      output.content.forEach((block: any, contentIndex: number) => {
        if (block.type === 'toolCall') {
          stream.push({ type: 'toolcall_start', contentIndex, partial: output });
          stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(block.arguments), partial: output });
          stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: output });
        }
      });
      stream.push({ type: 'done', reason: 'stop', message: output });
      stream.end();
      return stream;
    }),
  });
}
