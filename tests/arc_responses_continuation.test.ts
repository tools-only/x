import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponsesContinuation, plainReasoningChars } from '../demo/arc_responses_continuation.ts';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses';

const head = { role: 'user', content: 'original observation' };
const reasoning = { type: 'reasoning', id: 'rs_1', content: [{ type: 'reasoning_text', text: 'old thinking' }], summary: [] };
const call = { type: 'function_call', call_id: 'call_1', name: 'python', arguments: '{"code":"1+1"}' };
const result = { type: 'function_call_output', call_id: 'call_1', output: '2' };
const message = { api: 'openai-responses', responseId: 'resp_1', stopReason: 'toolUse', content: [
  { type: 'thinking', thinking: 'old thinking', thinkingSignature: JSON.stringify(reasoning) },
  { type: 'toolCall', id: 'call_1|fc_1', name: 'python', arguments: { code: '1+1' } },
] };
function setup() {
  const state = new ResponsesContinuation();
  state.project({ model: 'qwen', input: [head] }, 'decision1');
  state.accept(message);
  return state;
}

test('same decision uses response ID and only new tool result, keeping canonical reasoning', () => {
  const state = setup();
  const input = [head, reasoning, call, result];
  const projected = state.project({ model: 'qwen', input, reasoning: { effort: 'high' } }, 'decision1');
  assert.equal(projected.payload.previous_response_id, 'resp_1');
  assert.deepEqual(projected.payload.input, [result]);
  assert.deepEqual(projected.payload.reasoning, { effort: 'high' });
  assert.equal(projected.audit.wire_reasoning_chars, 0);
  assert.equal(projected.audit.local_reasoning_chars, 'old thinking'.length);
  assert.equal(projected.payload.store, true);
  assert.deepEqual(input, [head, reasoning, call, result]);
});

test('changed decision or system prefix rebases instead of silently carrying obsolete state', () => {
  assert.equal(setup().project({ input: [head, reasoning, call, result] }, 'decision2').audit.reason, 'decision_or_model_changed');
  const changed = setup().project({ input: [{ ...head, content: 'new observation' }, reasoning, call, result] }, 'decision1');
  assert.equal(changed.audit.reason, 'prefix_changed');
  assert.equal(changed.payload.previous_response_id, undefined);
  assert.equal(changed.audit.wire_reasoning_chars, 'old thinking'.length);
});

test('edited prior reasoning or tool arguments cannot be hidden behind an old response ID', () => {
  const state = setup();
  const altered = { ...reasoning, content: [{ type: 'reasoning_text', text: 'updated thinking' }] };
  assert.equal(state.project({ input: [head, altered, call, result] }, 'decision1').audit.reason, 'previous_output_changed');
  assert.equal(setup().project({ input: [head, reasoning, { ...call, arguments: '{"code":"2+2"}' }, result] }, 'decision1').audit.reason, 'previous_output_changed');
});

test('incomplete/error responses and missing IDs clear continuation state', () => {
  for (const changed of [{ stopReason: 'length' }, { stopReason: 'error' }, { responseId: undefined }]) {
    const state = new ResponsesContinuation();
    state.project({ input: [head] }, 'decision1');
    state.accept({ ...message, ...changed });
    assert.equal(state.project({ input: [head, reasoning, call, result] }, 'decision1').audit.mode, 'full');
  }
});

test('multiple followups carry only their newly added result', () => {
  const state = setup();
  const prior = [head, reasoning, call, result];
  state.project({ input: prior }, 'decision1');
  const call2 = { ...call, call_id: 'call_2' };
  state.accept({ ...message, responseId: 'resp_2', content: [{ type: 'toolCall', id: 'call_2|fc_2', name: 'python', arguments: { code: '1+1' } }] });
  const result2 = { ...result, call_id: 'call_2', output: '3' };
  const projected = state.project({ input: [...prior, call2, result2] }, 'decision1');
  assert.deepEqual(projected.payload.input, [result2]);
  assert.equal(projected.payload.previous_response_id, 'resp_2');
});

test('plain reasoning counts text/summary but does not interpret encrypted content as text', () => {
  assert.equal(plainReasoningChars([{ type: 'reasoning', encrypted_content: 'opaque', summary: [] }]), 0);
});

test('actual Pi Responses SDK parses plain reasoning and emits a tool-result-only stored followup', async () => {
  const state = new ResponsesContinuation();
  const sent: any[] = [];
  const reasoningItem = { ...reasoning, status: 'completed' };
  const callItem = { ...call, id: 'fc_1', status: 'completed' };
  const model: any = { api: 'openai-responses', provider: 'test-responses', id: 'qwen', baseUrl: 'https://example.invalid/v1',
    reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 32768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const fetchMock: any = async (_url: any, init: any) => {
    sent.push(JSON.parse(init.body));
    const first = sent.length === 1;
    const output = first ? [reasoningItem, callItem] : [{ type: 'message', id: 'msg_2', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'done', annotations: [] }] }];
    const events: any[] = [{ type: 'response.created', response: { id: first ? 'resp_1' : 'resp_2' } }];
    output.forEach((item, index) => {
      events.push({ type: 'response.output_item.added', output_index: index, item });
      if (item.type === 'reasoning') events.push({ type: 'response.reasoning_text.delta', output_index: index, delta: 'old thinking' });
      events.push({ type: 'response.output_item.done', output_index: index, item });
    });
    events.push({ type: 'response.completed', response: { id: first ? 'resp_1' : 'resp_2', status: 'completed', output,
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, output_tokens_details: { reasoning_tokens: 5 } } } });
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const options: any = { apiKey: 'test', fetch: fetchMock, reasoning: 'high', maxRetries: 0,
    onPayload: (payload: any) => state.project(payload, 'decision1').payload };
  const tools: any[] = [{ name: 'python', description: 'calculate', parameters: { type: 'object', properties: { code: { type: 'string' } } } }];
  const user: any = { role: 'user', content: 'original observation', timestamp: 1 };
  const first = await streamSimple(model, { messages: [user], tools }, options).result();
  assert.equal(first.stopReason, 'toolUse', first.errorMessage);
  assert.equal(first.responseId, 'resp_1');
  assert.equal(first.content.find((b: any) => b.type === 'thinking')?.thinking, 'old thinking');
  state.accept(first);
  const toolResult: any = { role: 'toolResult', toolCallId: 'call_1|fc_1', toolName: 'python',
    content: [{ type: 'text', text: '2' }], isError: false, timestamp: 2 };
  const second = await streamSimple(model, { messages: [user, first, toolResult], tools }, options).result();
  assert.equal(second.stopReason, 'stop', second.errorMessage);
  assert.equal(sent[1].previous_response_id, 'resp_1');
  assert.equal(sent[1].input.length, 1);
  assert.equal(sent[1].input[0].type, 'function_call_output');
  assert.equal(plainReasoningChars(sent[1].input), 0);
  assert.equal(sent[1].reasoning.effort, 'high');
});
