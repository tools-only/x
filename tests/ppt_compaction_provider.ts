/** Scripted provider: exercise automatic PPT compaction and continuation, without paid calls. */
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

export default function(pi: any) {
  let taskTurns = 0;
  const failSummary = process.env.PPT_COMPACTION_TEST_FAIL === '1';
  const official = process.env.PPT_COMPACTION_TEST_OFFICIAL === '1';
  pi.registerProvider(official ? 'openai-codex' : 'az-demo', {
    baseUrl: 'http://localhost', apiKey: 'diagnostic', api: 'openai-completions',
    models: [{ id: official ? 'gpt-6-luna' : 'qwen3.8-27b', name: 'scripted', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const system = context.systemPrompt ?? context.messages.find((m: any) => m.role === 'system')?.content;
      const summary = !JSON.stringify(system ?? '').includes('You own both the presentation');
      const all = JSON.stringify(context);
      let answer: string;
      if (summary) {
        assert.match(all, /conversation/i);
        answer = 'PPT_CHECKPOINT: KEEP_TASK_CONSTRAINT; source artifacts/presentation.html; rendering remains unverified.';
      } else if (taskTurns++ === 0) {
        answer = 'KEEP_TASK_CONSTRAINT. ' + 'Historical production notes. '.repeat(2000);
      } else {
        assert.match(all, failSummary ? /KEEP_TASK_CONSTRAINT/ : /PPT_CHECKPOINT/);
        const path = join(process.env.PPT_DEMO_ROOT!, '.harness/ppt-loop.json');
        const state = JSON.parse(readFileSync(path, 'utf8'));
        state.complete = true; // End this wiring probe; no real deck delivery is claimed.
        writeFileSync(path, JSON.stringify(state));
        answer = 'TASK_CONTINUED_AFTER_COMPACTION';
      }
      appendFileSync(join(process.env.PPT_DEMO_ROOT!, 'compaction-provider.jsonl'), JSON.stringify({ summary, taskTurns })+'\n');
      const input = !summary && taskTurns === 1 ? 90000 : 20;
      const message: any = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [{ type: 'text', text: answer }], stopReason: summary && failSummary ? 'length' : 'stop', timestamp: Date.now(),
        usage: { input, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: input+20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); return stream;
    }),
  });
}


