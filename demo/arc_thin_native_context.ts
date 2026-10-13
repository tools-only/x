/**
 * What the model is shown of its earlier decisions in native mode. Pi's session file is never changed.
 *
 * The decision context is rebuilt at every state change (Continual Harness: the prompt is rebuilt after a call that
 * changes the game state, and analysis is appended within the decision). Earlier decisions are not replayed as a
 * transcript; they appear as one summarised section inside a fixed character budget, with the latest tool results in
 * full and older ones as one line each. Raw transcript bands (2026-10-12/13) dropped everything once a single verbose
 * decision exceeded the budget (history_messages=0 in the first activation run); a summary degrades gradually.
 */

/** Pair calls with results and drop thinking, over the whole list (the canonical projection). */
export function projectNativeHistory(messages: any[], replayReasoning = false): any[] {
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

/** Retire old raw results without changing the durable Pi transcript. Explicit reads still return actual bodies. */
export function projectNativeDecision(messages: any[], options: {
 reasoning?: 'all' | 'recent' | 'none'; fullResults?: number; archive?: (message: any, text: string) => string;
} = {}): any[] {
 const paired = projectNativeHistory(messages, options.reasoning !== 'none');
 const latestThinking = paired.findLastIndex(m => m.role === 'assistant' && m.content?.some((b: any) => b.type === 'thinking'));
 const results = paired.filter(m => m.role === 'toolResult');
 const recent = new Set(results.slice(-(options.fullResults ?? 2)).map(m => m.toolCallId));
 const lastImage = results.findLast(m => m.content?.some((b: any) => b.type === 'image'))?.toolCallId;
 return paired.map((m, i) => {
  if (m.role === 'assistant' && options.reasoning === 'recent' && i !== latestThinking)
   return {...m, content: m.content.filter((b: any) => b.type !== 'thinking' || b.signature || b.thinkingSignature)};
  if (m.role !== 'toolResult' || recent.has(m.toolCallId) || m.toolCallId === lastImage || !options.archive) return m;
  const text = textOf(m);
  if (text.length <= 400) return m;
  return {...m, content: [{type: 'text', text: options.archive(m, text)}]};
 }).filter(m => m.role !== 'assistant' || m.content.length);
}

/** A length recovery remains in the unfinished decision's projection, rather than moving its thinking before a new user. */
export function nativeDecisionStart(messages: any[]): number {
 let at = messages.findLastIndex(m => m.role === 'user');
 while (at >= 0 && /^RECOVER (?:ACTION|CONSOLIDATION)\b/.test(textOf(messages[at])))
  at = messages.findLastIndex((m, i) => i < at && m.role === 'user');
 return at;
}

export type HistoryOptions = { budget?: number; fullResults?: number; resultChars?: number };
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}… <${text.length} chars>` : text;
const textOf = (message: any) => typeof message?.content === 'string' ? message.content
  : (Array.isArray(message?.content) ? message.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('\n');
/** Lines of a result that record an action ("#12 ACTION1 → ..."): always kept whole. */
const actionLines = (text: string) => text.split('\n').filter(line => /^#\d+ (?:ACTION\d|RESET)\b/.test(line));

/**
 * The decisions before the current one as text: per decision what the agent said, each call with a short form of its
 * arguments, and what came back. The newest `fullResults` results (default 2) are whole up to `resultChars`; older
 * ones keep their first line and any action receipts. Decisions are added newest first until the budget is used.
 */
export function summarizeHistory(messages: any[], options: HistoryOptions = {}): { text: string; decisions: number; omitted: number } {
  const budget = options.budget ?? 12000, fullResults = options.fullResults ?? 2, resultChars = options.resultChars ?? 2000;
  const paired = projectNativeHistory(messages);
  const starts = paired.map((m, i) => m?.role === 'user' ? i : -1).filter(i => i >= 0);
  const results = new Map(paired.filter(m => m?.role === 'toolResult').map(m => [String(m.toolCallId), m]));
  // arc_action's receipt is one line and always whole; a saved tool that acted ended its decision, so this summary is
  // the only place its output is seen.
  const newest = new Set(paired.filter(m => m?.role === 'toolResult' && m.toolName !== 'arc_action').slice(-fullResults).map(m => String(m.toolCallId)));
  const blocks: string[] = [];
  for (let d = 0; d < starts.length; d++) {
    const slice = paired.slice(starts[d], starts[d + 1] ?? paired.length);
    const lines: string[] = [];
    for (const message of slice) {
      if (message.role !== 'assistant') continue;
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type === 'text' && block.text?.trim()) lines.push(`said: ${clip(flat(block.text), 300)}`);
        if (block.type !== 'toolCall') continue;
        const result = results.get(String(block.id));
        const body = result ? textOf(result) : '';
        const acted = actionLines(body);
        const shown = newest.has(String(block.id)) ? clip(body.trim(), resultChars)
          : [clip(flat(body.split('\n')[0] ?? ''), 200), ...acted.filter(line => line !== body.split('\n')[0])].join('\n');
        lines.push(`${block.name}(${clip(flat(JSON.stringify(block.arguments ?? {})), 160)})${result?.isError ? ' FAILED' : ''} → ${shown}`);
      }
    }
    if (lines.length) blocks.push(lines.join('\n'));
  }
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    // The newest decision is always shown, clipped to the budget if it alone exceeds it.
    const block = kept.length ? blocks[i] : blocks[i].slice(0, budget);
    if (kept.length && used + block.length > budget) break;
    kept.unshift(block); used += block.length;
  }
  const omitted = blocks.length - kept.length;
  if (!kept.length) return { text: '', decisions: 0, omitted: 0 };
  const head = `RECENT HISTORY (your last ${kept.length} decision${kept.length === 1 ? '' : 's'}, summarised, newest last` +
    (omitted ? `; ${omitted} older not shown: memory, your prompts and tools, data/trajectory.jsonl and data/frames/ hold what they established` : '') + '):';
  return { text: [head, ...kept.map((block, i) => `[decision -${kept.length - i}]\n${block}`)].join('\n'), decisions: kept.length, omitted };
}

/** Action numbers whose receipt ("#12 ACTION1 → ...") is in the given text. */
export function visibleActions(text: string): Set<number> {
  const seen = new Set<number>();
  for (const match of text.matchAll(/(?:^|→ )#(\d+) (?:ACTION\d|RESET)\b/gm)) seen.add(Number(match[1]));
  return seen;
}
