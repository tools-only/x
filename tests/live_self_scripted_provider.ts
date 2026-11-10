/** Deterministic Pi provider: exercises the real extension/tool/context chain, not Luna adoption. */
import { appendFileSync } from 'node:fs';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { scriptedProviderTransport } from './pi_scripted_provider_transport.ts';

const harnessSource = 'output = input["source_text"].upper()\noutput';
const loopSource = 'evidence_ref = input["evidence"][0]["ref"]\nif input["trial_receipt"] is not None:\n    receipt = input["trial_receipt"]\n    original = input["evidence"][0]["output"]\n    conclusion = "trial output differs from cited evidence output" if receipt["output"] != original else "trial output matches cited evidence output"\n    result = {"method": "shared-token-count", "scopes": [{"label": "work-and-meta", "level": "joint", "object_ids": ["task_harness", "evolution_loop"], "evidence_refs": [evidence_ref], "criteria": conclusion}], "decision": "complete", "trial": None, "summary": conclusion}\nelse:\n    result = {"method": "shared-token-count", "scopes": [{"label": "work-and-meta", "level": "joint", "object_ids": ["task_harness", "evolution_loop"], "evidence_refs": [evidence_ref], "criteria": "Compare the method and its review policy against this evidence."}], "decision": "trial", "trial": {"method_id": "task_harness", "evidence_ref": evidence_ref}, "summary": "Run one isolated method trial."}';

function currentMirror(context: any) {
  const body = String(context.systemPrompt ?? context.messages?.find((m: any) => m.role === 'system')?.content ?? '');
  const marker = '[LIVE_SELF_MIRROR]\n';
  const start = body.lastIndexOf(marker); if (start < 0) throw Error('automatic Mirror missing from provider request');
  const line = body.slice(start + marker.length).split('\n')[0];
  return JSON.parse(line);
}

export default function liveSelfScriptedProvider(pi: ExtensionAPI) {
  const contextPath = process.env.LIVE_SELF_PROVIDER_CONTEXTS!;
  let request = 0, toolCall = 0;
  const steps = [
    { name: 'draft_item', arguments: { task: 'alternate-slide-outline', source_text: 'Revenue rose. Costs were flat.' } },
    { name: 'review_self', arguments: { evidence_id: 'evidence-1', disposition: 'change', rationale: 'The first result is useful; compare the source and draft by shared tokens on later work.' } },
    (c: any) => ({ name: 'reflect', arguments: { ref: currentMirror(c).parts.task_harness.operations[0].ref, replace: true, value: { type: 'text', value: harnessSource }, reasoning: 'Uppercase the input to make headings consistent.' } }),
    (c: any) => ({ name: 'reflect', arguments: { ref: currentMirror(c).parts.evolution_loop.operations[0].ref, replace: true, value: { type: 'text', value: loopSource }, reasoning: 'Change the evidence comparison method.' } }),
    { name: 'draft_item', arguments: { task: 'slide-outline', source_text: 'Revenue rose. Costs were flat.' } },
    { name: 'draft_item', arguments: { task: 'code-note', source_text: 'function add(a, b) { return a + b; }' } },
    { name: 'submit_item', arguments: { evidence_id: 'evidence-3', self_review: { disposition: 'keep', rationale: 'The revised source comparison gives a useful signal and the output is complete.' } } },
    undefined,
  ];
  pi.registerProvider('offline-live-self', {
    api: 'openai-completions', apiKey: 'offline', baseUrl: 'http://unused.invalid',
    models: [{ id: 'scripted', name: 'scripted', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedProviderTransport((model, context) => {
      appendFileSync(contextPath, `${JSON.stringify({ request, context })}\n`, 'utf8');
      const step = steps[request++];
      const stream = createAssistantMessageEventStream();
      const output: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], stopReason: step ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: output });
      if (step) {
        const call = typeof step === 'function' ? step(context) : step;
        const block = { type: 'toolCall' as const, id: `live-self-${++toolCall}`, name: call.name, arguments: call.arguments };
        output.content.push(block); const i = output.content.length - 1;
        stream.push({ type: 'toolcall_start', contentIndex: i, partial: output });
        stream.push({ type: 'toolcall_delta', contentIndex: i, delta: JSON.stringify(call.arguments), partial: output });
        stream.push({ type: 'toolcall_end', contentIndex: i, toolCall: block, partial: output });
      } else output.content.push({ type: 'text', text: 'Scripted task completed.' });
      stream.push({ type: 'done', reason: output.stopReason as 'toolUse' | 'stop', message: output }); stream.end(); return stream;
    }),
  });
}
