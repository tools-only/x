/** Bounded real-Pi provider fixture for the PPT online-method lifecycle. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

const programV1 = `def run(args, env):
    with open('data/material.txt') as source:
        material = source.read()
    terms = ['Revenue']
    present = {term: term in material for term in terms}
    return 'METHOD_RESULT_V' + str(len(terms)) + ': ' + str(present)
`;

function toolResultText(context: any) {
  return (context.messages ?? []).filter((message: any) => message.role === 'toolResult')
    .flatMap((message: any) => message.content ?? [])
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text)
    .join('\n');
}

export default function(pi: any) {
  let turn = 0;
  pi.registerProvider('ppt-live-method-diagnostic', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const n = turn++;
      assert.ok(n < 8, 'provider request limit exceeded');
      const system = context.systemPrompt || JSON.stringify((context.messages ?? []).filter((message: any) => message.role === 'system'));
      const results = toolResultText(context);
      let content: any[];
      if (n === 0) {
        assert.match(system, /Design your own feedback loop/);
        content = [{ type: 'toolCall', id: 'create-method', name: 'self_component', arguments: {
          kind: 'prompt', name: 'live_method', content: 'METHOD_PROMPT_V1: Run live_check on supplied material and inspect its returned evidence.',
        } }];
      } else if (n === 1) {
        assert.match(system, /METHOD_PROMPT_V1/);
        assert.match(results, /prompt live_method v1: saved.*loaded/);
        content = [{ type: 'toolCall', id: 'save-v1', name: 'save_program', arguments: {
          name: 'live_check', description: 'Check a requested earnings label in supplied material', body: programV1,
        } }];
      } else if (n === 2) {
        assert.match(system, /METHOD_PROMPT_V1/);
        assert.match(results, /live_check v1: saved/);
        content = [{ type: 'toolCall', id: 'run-v1', name: 'run_program', arguments: { name: 'live_check' } }];
      } else if (n === 3) {
        assert.match(results, /METHOD_RESULT_V1: .*Revenue.*True/);
        content = [{ type: 'toolCall', id: 'revise-v2', name: 'edit_program', arguments: {
          name: 'live_check', old_text: "    terms = ['Revenue']",
          new_text: "    terms = ['Revenue', 'Net income']",
          expected_version: 1,
        } }];
      } else if (n === 4) {
        assert.match(system, /METHOD_PROMPT_V1/);
        assert.match(results, /live_check v2: saved/);
        content = [{ type: 'toolCall', id: 'run-v2', name: 'run_program', arguments: { name: 'live_check' } }];
      } else if (n === 5) {
        assert.match(results, /METHOD_RESULT_V2:/);
        content = [{ type: 'toolCall', id: 'run-history-v1', name: 'run_program', arguments: { name: 'live_check', version: 1 } }];
      } else if (n === 6) {
        assert.match(results, /METHOD_RESULT_V1: .*Revenue.*True/);
        content = [
          { type: 'toolCall', id: 'retire', name: 'retire_program', arguments: { name: 'live_check', expected_version: 2 } },
          { type: 'toolCall', id: 'disable-method', name: 'write', arguments: {
            path: 'prompts/live_method.md', content: '---\nactive: false\n---\nMETHOD_PROMPT_V1: retired',
          } },
        ];
      } else {
        assert.doesNotMatch(system, /METHOD_PROMPT_V1/);
        assert.match(results, /"retired":"live_check","version":2/);
        content = [{ type: 'text', text: 'PPT_METHOD_LOOP_WIRING_PASS: ordinary work can continue after method retirement.' }];
      }
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'provider-checks.jsonl'), JSON.stringify({ turn: n, passed: true }) + '\n');
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content, stopReason: n < 7 ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end();
      return stream;
    }),
  });
}
