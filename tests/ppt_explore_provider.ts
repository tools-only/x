/** Real-Pi scripted fixture for independent read-only explore candidates. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

function texts(context: any) {
  return (context.messages ?? []).flatMap((message: any) => message.content ?? [])
    .filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
}
function system(context: any) {
  return context.systemPrompt || (context.messages ?? []).filter((message: any) => message.role === 'system')
    .map((message: any) => typeof message.content === 'string' ? message.content
      : (message.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n')).join('\n');
}

export default function(pi: any) {
  let request = 0;
  pi.registerProvider('ppt-explore-diagnostic', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const n = request++;
      assert.ok(n < 4, 'provider request limit exceeded');
      let content: any[];
      let stopReason = 'stop';
      let errorMessage: string | undefined;
      if (n === 0) {
        content = [{ type: 'toolCall', id: 'explore-batch', name: 'explore', arguments: { candidates: [
          { instruction: 'Compare two possible ways to structure the supplied findings.', refs: ['data/material.txt'] },
          { instruction: 'Find a potential omission in the supplied findings.', refs: ['data/material.txt'] },
        ] } }];
        stopReason = 'toolUse';
      } else if (n === 1) {
        assert.match(texts(context), /Compare two possible ways/);
        assert.match(texts(context), /Revenue was \$30B/);
        assert.match(system(context), /independent read-only candidate/);
        assert.doesNotMatch(system(context), /You own both the presentation/);
        content = [{ type: 'text', text: 'CANDIDATE_ONE_RAW: lead with the revenue trend.' }];
      } else if (n === 2) {
        assert.match(texts(context), /Find a potential omission/);
        assert.match(system(context), /independent read-only candidate/);
        content = [{ type: 'text', text: 'candidate provider failure' }];
        stopReason = 'error'; errorMessage = 'scripted candidate failure';
      } else {
        const prior = texts(context);
        assert.match(prior, /CANDIDATE_ONE_RAW/);
        assert.match(prior, /explore error: scripted candidate failure/);
        content = [{ type: 'text', text: 'EXPLORE_PARENT_RECEIVED_BOTH_OUTCOMES' }];
      }
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'provider-checks.jsonl'), JSON.stringify({ request: n, passed: true }) + '\n');
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content, stopReason, timestamp: Date.now(), ...(errorMessage ? { errorMessage } : {}),
        usage: { input: 10, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 18,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: stopReason, message });
      stream.end();
      return stream;
    }),
  });
}
