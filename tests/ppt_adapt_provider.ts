/** Local scripted provider checks ADAPT control, not autonomous evolution. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

export default function(pi: any) {
  let turn = 0;
  pi.registerProvider('ppt-adapt-diagnostic', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const n = turn++;
      assert.ok(n < 6);
      const all = JSON.stringify(context);
      const call = (id: string, name: string, args: any) => [{ type: 'toolCall', id, name, arguments: args }];
      let content: any[];
      if (n === 0) {
        assert.match(all, /Develop your capability continuously during this task/);
        assert.match(all, /collaboration relationships, control flows, and operating mechanisms/);
        assert.match(all, /no fixed entry point/i);
        assert.match(all, /TASK_HISTORY_ONLY/);
        content = call('enter', 'adapt', { context: 'SELECTED_ADAPT_CONTEXT', refs: ['data/material.txt'] });
      } else if (n === 1) {
        assert.match(all, /independent ADAPT turn charged with helping the caller keep developing/);
        assert.match(all, /optional `adapt_method` skill body captured at the beginning/);
        assert.match(all, /SELECTED_ADAPT_CONTEXT/);
        assert.match(all, /Revenue was/);
        assert.doesNotMatch(all, /TASK_HISTORY_ONLY/);
        content = [{ type: 'text', text: 'ADAPT_PRIVATE_THOUGHT' },
          ...call('change', 'self_component', { kind: 'prompt', name: 'working_method', content: 'METHOD_FROM_ADAPT' }),
          ...call('method', 'self_component', { kind: 'skill', name: 'adapt_method', description: 'Future ADAPT method', content: 'FUTURE_ADAPT_METHOD' })];
      } else if (n === 2) {
        assert.match(all, /SELECTED_ADAPT_CONTEXT/);
        assert.match(all, /working_method/);
        assert.doesNotMatch(all, /TASK_HISTORY_ONLY/);
        content = [{ type: 'text', text: 'ADAPT_FINAL_RESULT' }];
      } else if (n === 3) {
        assert.match(all, /ADAPT_FINAL_RESULT/);
        assert.doesNotMatch(all, /ADAPT_PRIVATE_THOUGHT/);
        assert.match(all, /You own both the presentation/);
        assert.match(all, /TASK_HISTORY_ONLY/);
        assert.match(all, /METHOD_FROM_ADAPT/);
        content = call('enter-again', 'adapt', { context: 'SECOND_ADAPT_CONTEXT' });
      } else if (n === 4) {
        assert.match(all, /FUTURE_ADAPT_METHOD/);
        assert.match(all, /SECOND_ADAPT_CONTEXT/);
        assert.doesNotMatch(all, /SELECTED_ADAPT_CONTEXT|TASK_HISTORY_ONLY|METHOD_FROM_ADAPT|Revenue was/);
        content = [{ type: 'text', text: 'SECOND_ADAPT_RESULT' }];
      } else {
        assert.match(all, /TASK_HISTORY_ONLY/);
        assert.match(all, /METHOD_FROM_ADAPT/);
        content = [{ type: 'text', text: 'ADAPT_CONTROL_RETURNED' }];
      }
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'provider-checks.jsonl'), JSON.stringify({ turn: n, passed: true }) + '\n');
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content, stopReason: [0, 1, 3].includes(n) ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); return stream;
    }),
  });
}
