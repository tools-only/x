/** Local experimental transport. The development model supplies replies to actual Pi requests. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { scriptedProviderTransport } from '../tests/pi_scripted_provider_transport.ts';

const MAX_REQUESTS = 18;
const REPLY_DEADLINE_MS = 240_000;

type Reply = { text?: string; calls?: { name: string; args: Record<string, unknown> }[] };

export default function liveSelfLunaRelay(pi: ExtensionAPI) {
    const root = process.env.LIVE_SELF_RELAY_DIR;
    if (!root) throw new Error('Set LIVE_SELF_RELAY_DIR to a fresh experiment directory');
    mkdirSync(root, { recursive: true });
    if (existsSync(join(root, 'relay.jsonl'))) throw new Error('Relay directory already used');
    let seq = 0;
    pi.registerProvider('local-luna-relay', {
        api: 'openai-completions', apiKey: 'local-only', baseUrl: 'http://unused.invalid',
        models: [{ id: 'gpt-6-luna-high', name: 'GPT-6 Luna high via development relay', reasoning: false,
            input: ['text'], contextWindow: 64000, maxTokens: 4000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        streamSimple: scriptedProviderTransport((model, context, options) => {
            const stream = createAssistantMessageEventStream();
            const request = ++seq;
            const output: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider,
                model: model.id, content: [], stopReason: 'stop', timestamp: Date.now(),
                // Pi requires usage fields. Relay transport has no model usage accounting.
                usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            void (async () => {
                try {
                    if (request > MAX_REQUESTS) throw new Error('Experiment reached its request cap');
                    const start = Date.now();
                    const input = JSON.stringify({ request, system: context.systemPrompt ?? getCurrentSystemPrompt(context.messages),
                        tools: context.tools?.length ? context.tools : getCurrentTools(context.messages), messages: context.messages });
                    const path = join(root, `request-${request}.json`);
                    writeFileSync(`${path}.tmp`, input);
                    renameSync(`${path}.tmp`, path);
                    appendFileSync(join(root, 'relay.jsonl'), JSON.stringify({ request, inputBytes: Buffer.byteLength(input) }) + '\n');
                    const response = join(root, `reply-${request}.json`);
                    while (!existsSync(response)) {
                        if (Date.now() - start > REPLY_DEADLINE_MS) throw new Error(`No reply for request ${request}`);
                        await delay(300, undefined, { signal: options?.signal });
                    }
                    const reply = JSON.parse(readFileSync(response, 'utf8')) as Reply;
                    if (!reply || (!reply.text && !reply.calls?.length) || (reply.calls?.length ?? 0) > 8) {
                        throw new Error('Reply needs text or one to eight tool calls');
                    }
                    if (reply.text) output.content.push({ type: 'text', text: reply.text });
                    for (const [index, call] of (reply.calls ?? []).entries()) {
                        if (typeof call.name !== 'string' || !call.args || Array.isArray(call.args) || typeof call.args !== 'object') {
                            throw new Error('A call needs a tool name and JSON object args');
                        }
                        output.content.push({ type: 'toolCall', id: `luna-${request}-${index}`, name: call.name, arguments: call.args });
                    }
                    if (reply.calls?.length) output.stopReason = 'toolUse';
                    appendFileSync(join(root, 'relay.jsonl'), JSON.stringify({ request, replyMs: Date.now() - start,
                        tools: (reply.calls ?? []).map(call => call.name) }) + '\n');
                    stream.push({ type: 'start', partial: output });
                    for (const [contentIndex, part] of output.content.entries()) {
                        if (part.type === 'toolCall') stream.push({ type: 'toolcall_end', contentIndex, toolCall: part, partial: output });
                    }
                    stream.push({ type: 'done', reason: output.stopReason, message: output });
                } catch (error) {
                    output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
                    output.errorMessage = String(error instanceof Error ? error.message : error);
                    appendFileSync(join(root, 'relay.jsonl'), JSON.stringify({ request, error: output.errorMessage }) + '\n');
                    stream.push({ type: 'error', reason: output.stopReason, error: output });
                } finally {
                    stream.end();
                }
            })();
            return stream;
        }),
    });
}
