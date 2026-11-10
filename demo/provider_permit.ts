/** A request owns its unresolved liability; task-wide limits are never resized. */
export function providerPermit(payload: any, model: { contextWindow: number; maxTokens: number }, outputTokens: number,
  rates: { input: number; output: number }) {
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > model.maxTokens) throw Error('output envelope outside registered model');
  const key = 'max_completion_tokens' in payload ? 'max_completion_tokens' : 'max_tokens';
  const bounded = { ...payload, [key]: outputTokens };
  // UTF-8 bytes upper-bound byte-fallback text tokens. The registered context
  // bounds multimodal inputs; the serialized payload also includes schema and
  // framing, with 4096 tokens for provider chat-template framing. No history is dropped.
  const inputTokens = Math.min(model.contextWindow, Buffer.byteLength(JSON.stringify(bounded), 'utf8') + 4096);
  return { payload: bounded, input_tokens_bound: inputTokens, output_tokens_bound: outputTokens,
    tokens: inputTokens + outputTokens, usd: (inputTokens*rates.input + outputTokens*rates.output)/1e6,
    basis: 'serialized UTF-8 bytes + 4096 chat framing, bounded by registered context; actual output envelope' };
}
