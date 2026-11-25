/** Apply the declared output envelope using the selected provider API's request field. */
export function applyParentOutputLimit(payload: Record<string, any>, api: string | undefined, limit: number) {
  if (!limit) {
    delete payload.max_tokens;
    delete payload.max_completion_tokens;
    delete payload.max_output_tokens;
  } else if (api === 'openai-responses' || api === 'openai-codex-responses') {
    delete payload.max_tokens;
    delete payload.max_completion_tokens;
    payload.max_output_tokens = limit;
  } else if ('max_completion_tokens' in payload) payload.max_completion_tokens = limit;
  else payload.max_tokens = limit;
}
