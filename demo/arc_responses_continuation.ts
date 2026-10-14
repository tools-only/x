/** Stored Responses continuation with exact local-prefix and output verification.
 * Pi's own session is never changed, and nothing here rewrites history: only the HTTP projection changes. What the
 * decision chooses to replay locally is the caller's policy (see arc_thin_native_context.ts); this helper verifies
 * that whatever it does replay still matches the stored response before standing on its ID.
 */
type Payload = Record<string, any>;

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
const copy = (value: any) => JSON.parse(JSON.stringify(value));

export function plainReasoningChars(input: any): number {
  if (!Array.isArray(input)) return 0;
  return input.filter(item => item?.type === 'reasoning').reduce((n, item) => n +
    [...(item.content ?? []), ...(item.summary ?? [])].reduce((m: number, part: any) => m + String(part.text ?? '').length, 0), 0);
}

function matchesOutput(item: any, block: any): boolean {
  if (block.type === 'thinking') {
    if (!block.thinkingSignature) return false;
    try { return canonical(item) === canonical(JSON.parse(block.thinkingSignature)); } catch { return false; }
  }
  if (block.type === 'toolCall') {
    try { return item.type === 'function_call' && item.call_id === block.id.split('|')[0]
      && item.name === block.name && canonical(JSON.parse(item.arguments)) === canonical(block.arguments); }
    catch { return false; }
  }
  if (block.type === 'text') {
    let id = block.textSignature;
    try { id = JSON.parse(id).id; } catch {}
    return !!id && item.id === id && item.role === 'assistant' && item.type === 'message'
      && (item.content ?? []).map((p: any) => p.text ?? '').join('') === block.text;
  }
  return false;
}

export class ResponsesContinuation {
  private pending?: { input: any[]; identity: string; instructions: any };
  private previous?: { input: any[]; identity: string; instructions: any; responseId: string; blocks: any[] };

  project(payload: Payload, identity: string) {
    const input = Array.isArray(payload.input) ? payload.input : [];
    const previous = this.previous;
    let reason = 'first_request';
    let consumed = 0;
    if (previous) {
      reason = previous.identity !== identity ? 'decision_or_model_changed' :
        canonical(previous.instructions) !== canonical(payload.instructions ?? null) ? 'instructions_changed' :
        input.length < previous.input.length || canonical(input.slice(0, previous.input.length)) !== canonical(previous.input)
          ? 'prefix_changed' : 'previous_output_changed';
      if (reason === 'previous_output_changed') {
        // Match the previous output item by item. A reasoning block the decision's projection chose not to replay is
        // simply absent, and the stored response still holds it, so it may be skipped; an altered one matches nothing
        // and rebases, as does any missing or altered tool call or text. At least one item must actually match.
        let at = previous.input.length;
        let intact = true;
        for (const block of previous.blocks) {
          if (at < input.length && matchesOutput(input[at], block)) { at += 1; continue; }
          if (block.type !== 'thinking') { intact = false; break; }
        }
        if (intact && at > previous.input.length) {
          consumed = at;
          reason = input.length > consumed ? 'continued' : 'no_new_input';
        }
      }
    }
    const wire = { ...payload, store: true, tools: payload.tools ?? [], input: reason === 'continued' ? input.slice(consumed) : input };
    delete wire.previous_response_id;
    if (reason === 'continued') wire.previous_response_id = previous!.responseId;
    // Copy before a downstream handler can mutate input; signatures can contain plain reasoning.
    this.pending = { input: copy(input), identity, instructions: copy(payload.instructions ?? null) };
    return { payload: wire, audit: { mode: reason === 'continued' ? 'response_id_delta' : 'full', reason,
      previous_response_id: wire.previous_response_id ?? null, local_input_items: input.length,
      wire_input_items: wire.input.length, local_reasoning_chars: plainReasoningChars(input),
      wire_reasoning_chars: plainReasoningChars(wire.input), omitted_items: reason === 'continued' ? consumed : 0,
      // Reasoning blocks of the previous output the projection did not replay at all: the stored response is the only
      // copy this request's context has of them.
      unreplayed_reasoning_blocks: reason === 'continued' ? previous!.blocks.length - (consumed - previous!.input.length) : 0 } };
  }

  accept(message: any): void {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || message?.api !== 'openai-responses' || message.stopReason !== 'toolUse'
      || typeof message.responseId !== 'string' || !message.responseId) {
      this.previous = undefined;
      return;
    }
    const blocks = (message.content ?? []).filter((block: any) =>
      block.type === 'toolCall' || (block.type === 'thinking' && block.thinkingSignature)
      || (block.type === 'text' && block.text?.trim()));
    this.previous = { ...pending, responseId: message.responseId, blocks: copy(blocks) };
  }
}
