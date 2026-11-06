/** Actual Pi context projection and reference hydration through ordinary tools. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

export default function(pi: any) {
  let request = 0, prefix = '', savedArguments = '';
  pi.registerProvider('ppt-context-diagnostic', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const turn = request++;
      const messages = context.messages;
      const all = JSON.stringify(messages);
      let content: any[];
      if (turn === 0) content = [
        { type: 'toolCall', id: 'source', name: 'write', arguments: { path: 'artifacts/source.txt', content: 'EXACT_SOURCE_'+'x'.repeat(9000) } },
        { type: 'toolCall', id: 'image', name: 'read', arguments: { path: 'data/pixel.png' } },
        { type: 'toolCall', id: 'note2', name: 'write', arguments: { path: 'artifacts/note2.txt', content: 'two' } },
      ];
      else if (turn === 1) {
        const call = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((b: any) => b.type === 'toolCall' && b.id === 'source');
        assert.match(call.arguments.content, /Historical content/);
        savedArguments = call.arguments.content;
        assert.ok(messages.some((m: any) => m.role === 'toolResult' && m.content.some((b: any) => b.type === 'image')));
        content = [{ type: 'text', text: 'FIRST_TASK_TURN_DONE' }];
      } else if (turn === 2) {
        const call = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((b: any) => b.type === 'toolCall' && b.id === 'source');
        assert.equal(call.arguments.content, savedArguments);
        assert.doesNotMatch(all, /EXACT_SOURCE_x{9000}/);
        const ref = /results\/r\d+\.txt/.exec(call.arguments.content)![0];
        prefix = JSON.stringify(messages.slice(0, messages.findIndex((m: any) => m.role === 'user' && JSON.stringify(m.content).includes('SECOND_TASK_TURN'))));
        const imageRef = /results\/ppt-context-[a-f0-9]+\.png/.exec(all)![0];
        assert.ok(!messages.some((m: any) => m.role === 'toolResult' && m.content.some((b: any) => b.type === 'image')));
        content = [{ type: 'toolCall', id: 'hydrate', name: 'read', arguments: { path: ref } },
          { type: 'toolCall', id: 'hydrate-image', name: 'read', arguments: { path: imageRef } }];
      } else {
        assert.equal(turn, 3);
        assert.ok(messages.some((m: any) => m.role === 'toolResult' && m.toolCallId === 'hydrate-image' && m.content.some((b: any) => b.type === 'image')));
        assert.match(all, /EXACT_SOURCE_x{9000}/);
        assert.equal(JSON.stringify(messages.slice(0, messages.findIndex((m: any) => m.role === 'user' && JSON.stringify(m.content).includes('SECOND_TASK_TURN')))), prefix);
        content = [{ type: 'text', text: 'SECOND_TASK_TURN_DONE' }];
      }
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'context-provider.jsonl'), JSON.stringify({ turn, passed: true })+'\n');
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content,
        stopReason: content.some(b => b.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); return stream;
    }),
  });
}
