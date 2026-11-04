/** Real Pi diagnostic provider: checks live prompt changes between tool continuations. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';
export default function(pi: any) {
  let turn = 0;
  pi.registerProvider('ppt-refresh-diagnostic', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const n = turn++;
      const prompt = context.systemPrompt ?? JSON.stringify(context.messages.filter((m: any) => m.role === 'system'));
      assert.match(prompt, /construct your own short feedback-and-improvement loop/);
      if (n === 1) assert.match(prompt, /PPT_LIVE_METHOD_ONE/);
      if (n === 2) { assert.match(prompt, /PPT_LIVE_METHOD_TWO/); assert.doesNotMatch(prompt, /PPT_LIVE_METHOD_ONE/); }
      if (n === 3) assert.doesNotMatch(prompt, /PPT_LIVE_METHOD_(ONE|TWO)/);
      const args = n < 2
        ? { kind: 'prompt', name: 'live_method', content: n === 0 ? 'PPT_LIVE_METHOD_ONE' : 'PPT_LIVE_METHOD_TWO' }
        : { path: 'prompts/live_method.md', content: '---\nactive: false\n---\nPPT_LIVE_METHOD_TWO' };
      const content = n < 3 ? [{ type: 'toolCall', id: 'change'+n, name: n < 2 ? 'self_component' : 'write', arguments: args }] : [{ type: 'text', text: 'PPT_REFRESH_PASS' }];
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'refresh-checks.jsonl'), JSON.stringify({ turn: n, passed: true })+'\n');
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content, stopReason: n < 3 ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); return stream;
    }),
  });
}
