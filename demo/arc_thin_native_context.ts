/**
 * Project Pi's canonical retained history for the next request. Pi's session file is never changed; only what the
 * model is shown is shaped here.
 *
 * Retaining every decision verbatim grew the request without bound: in foundation-native-ls20-real-20261012-02 the
 * prompt reached ~43k characters by action 21 (52k input tokens per action), mostly old python output and full
 * file reads the agent never looked at again. Configurable bands (enabled by the native extension by default) are counted in decisions
 * (a decision starts at a user message):
 *   - the newest `verbatim` decisions as retained, except that a result over 2000 characters keeps its head;
 *   - the `condensed` decisions before them with long call arguments shortened and results clipped to their head,
 *     so what was done and what came back stays in view;
 *   - older decisions dropped, with a note saying where their record lives.
 * Band edges move in steps of `verbatim` decisions, so the shown prefix stays identical for several decisions and
 * provider prompt caching keeps working between band moves.
 */
export type NativeHistoryOptions = { verbatim?: number; condensed?: number };

const CONDENSED_TEXT_CHARS = 400;
const CONDENSED_RESULT_CHARS = 300;
const CONDENSED_ARGUMENT_CHARS = 200;

const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}… <${text.length} chars>` : text;

function condensedArguments(value: any): any {
  if (typeof value === 'string') return clip(value, CONDENSED_ARGUMENT_CHARS);
  if (Array.isArray(value)) return value.map(condensedArguments);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, condensedArguments(v)]));
  return value;
}

function condense(message: any): any {
  if (message?.role === 'assistant') return { ...message, content: message.content
    .filter((block: any) => block.type !== 'text' || block.text?.trim())
    .map((block: any) => block.type === 'text' ? { ...block, text: clip(block.text, CONDENSED_TEXT_CHARS) }
      : block.type === 'toolCall' ? { ...block, arguments: condensedArguments(block.arguments) } : block) };
  if (message?.role === 'toolResult') return { ...message, content: (Array.isArray(message.content) ? message.content : [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => ({ ...block, text: clip(String(block.text).replace(/\s+/g, ' ').trim(), CONDENSED_RESULT_CHARS) })) };
  return message;
}

const withNote = (message: any, note: string) => ({ ...message, content: typeof message.content === 'string'
  ? `${note}\n${message.content}` : [{ type: 'text', text: note }, ...(Array.isArray(message.content) ? message.content : [])] });

/**
 * Whole-file reads are the one result kind without a receipt cap; in the replayed real run they made the newest
 * band jump by ~20k characters. In earlier decisions of the newest band such a result keeps its first lines.
 */
const RECENT_RESULT_CHARS = 2000;
const clipLongResult = (message: any) => message?.role !== 'toolResult' ? message : { ...message,
  content: (Array.isArray(message.content) ? message.content : []).map((block: any) => block.type === 'text' && block.text.length > RECENT_RESULT_CHARS
    ? { ...block, text: `${block.text.slice(0, RECENT_RESULT_CHARS)}… <${block.text.length} chars; repeat the call for the rest>` } : block) };

/** Pair calls with results and drop thinking, over the whole list. */
function pairCalls(messages: any[], replayReasoning: boolean): any[] {
  const answered = new Set(messages.filter(m => m?.role === 'toolResult').map(m => String(m.toolCallId)));
  const calls = new Set<string>();
  const out: any[] = [];
  for (const message of messages) {
    if (message?.role === 'assistant') {
      const content = (Array.isArray(message.content) ? message.content : []).filter((block: any) => {
        if (block.type === 'thinking') return replayReasoning;
        if (block.type === 'toolCall') return answered.has(String(block.id));
        return true;
      });
      for (const block of content) if (block.type === 'toolCall') calls.add(String(block.id));
      if (content.length) out.push({ ...message, content });
    } else if (message?.role !== 'toolResult' || calls.has(String(message.toolCallId))) out.push(message);
  }
  return out;
}

/**
 * With no options this helper preserves Pi canonical history; the extension supplies its configured bands.
 * `messages` ends with the current decision (its user message and anything after it), which is always verbatim.
 * With no options every decision is kept verbatim (the canonical projection).
 */
export function projectNativeHistory(messages: any[], replayReasoning = false, options: NativeHistoryOptions = {}): any[] {
  const paired = pairCalls(messages, replayReasoning);
  const verbatim = Math.max(1, Math.floor(options.verbatim ?? Infinity));
  if (!Number.isFinite(verbatim)) return paired;
  const condensed = Math.max(0, Math.floor(options.condensed ?? 0));
  const starts = paired.map((m, i) => m?.role === 'user' ? i : -1).filter(i => i >= 0);
  // Earlier decisions: all but the last start, which is the current decision.
  const earlier = Math.max(0, starts.length - 1);
  const step = (n: number) => Math.floor(Math.max(0, n) / verbatim) * verbatim;
  const condensedFrom = step(earlier - verbatim);           // decisions [condensedFrom, ...) not verbatim are condensed
  const droppedBefore = step(earlier - verbatim - condensed);
  const out: any[] = [];
  // Messages before the first decision (system, compaction summary) are kept.
  for (let i = 0; i < (starts[0] ?? paired.length); i++) out.push(paired[i]);
  for (let d = 0; d < starts.length; d++) {
    const slice = paired.slice(starts[d], starts[d + 1] ?? paired.length);
    if (d < droppedBefore) continue;
    if (d < condensedFrom) {
      const body = slice.map(condense);
      if (d === droppedBefore) body[0] = withNote(body[0], (droppedBefore
        ? `(${droppedBefore} earlier decision${droppedBefore === 1 ? '' : 's'} not shown; memory, notes/, data/trajectory.jsonl and data/frames/ hold their record.)\n`
        : '') + `(The ${condensedFrom - droppedBefore} decisions from here are condensed: long call arguments shortened, results clipped. ` +
        `The newest ones after them are complete.)`);
      out.push(...body);
    } else if (d < starts.length - 1) out.push(...slice.map(clipLongResult));
    else out.push(...slice);
  }
  return out;
}

/** Action numbers whose arc_action receipt is in the given messages ("#12 ACTION1 → ..."). */
export function visibleActions(messages: any[]): Set<number> {
  const seen = new Set<number>();
  for (const message of messages) if (message?.role === 'toolResult' && message.toolName === 'arc_action')
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const match = /^#(\d+) /.exec(String(block?.text ?? ''));
      if (match) seen.add(Number(match[1]));
    }
  return seen;
}
