/**
 * What the model is shown of its earlier decisions in native mode. Pi's session file is never changed.
 *
 * Default (2026-10-14): earlier decisions are a transcript placed before the current decision's head (freezeHistory),
 * the Prime Agent arrangement. A summary rebuilt inside the head (summarizeHistory, ARC_THIN_NATIVE_HISTORY_CHARS > 0)
 * changed every decision, so every decision began with a full cache miss, and it lost results that did not fit
 * (pilot-01). The transcript is bounded by clipping each earlier result and by Pi's compaction.
 */
import { LONG_LINE_CHARS, stubLongLines } from './arc_thin_workspace.ts';

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
   // OpenAI-compatible providers use these strings to select a wire field, not to sign a reasoning block.
   return {...m, content: m.content.filter((b: any) => b.type !== 'thinking' || b.signature ||
    (b.thinkingSignature && !['reasoning_content', 'reasoning', 'reasoning_text'].includes(b.thinkingSignature)))};
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

/** Stores a whole result and returns the workspace path it can be read back from. */
export type SaveResult = (text: string) => string;
export type HistoryOptions = { budget?: number; fullResults?: number; resultChars?: number; save?: SaveResult };
/** Continual Harness's per-result cap. */
export const HISTORY_RESULT_CHARS = 5000;
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}… <${text.length} chars>` : text;
const textOf = (message: any) => typeof message?.content === 'string' ? message.content
  : (Array.isArray(message?.content) ? message.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('\n');
/** Lines of a result that record an action ("#12 ACTION1 → ..."): always kept whole. */
const actionLines = (text: string) => text.split('\n').filter(line => /^#\d+ (?:ACTION\d|RESET)\b/.test(line));

/**
 * A long result as its start and its end, with the size of the middle and where the whole text is. Code tends to print
 * its inputs first and its findings last; head-only clipping kept a dumped grid and lost the diffs (pilot-01, 2026-10-14).
 * Action receipts from the omitted middle are kept.
 */
export function clipEnds(text: string, limit: number, save?: SaveResult): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.3), tail = limit - head;
  const middle = text.slice(head, text.length - tail);
  const receipts = actionLines(middle);
  return `${text.slice(0, head)}\n… <${middle.length} of ${text.length} chars omitted${save ? `; full: ${save(text)}` : ''}> …\n` +
    (receipts.length ? receipts.join('\n') + '\n…\n' : '') + text.slice(-tail);
}

/**
 * An earlier result as kept in history: lines of dumped data (over LONG_LINE_CHARS) become one-line stubs, so the
 * history keeps what the code printed as findings, then the ends are clipped. In pr-01 (2026-10-14) about 5,000 of the
 * 6,700 characters summarising decision 1 were four printed lists of changed cells. When anything was stubbed, the
 * whole result's saved path is given.
 */
export function historyResult(text: string, limit: number, save?: SaveResult): string {
  const { lines, stubs } = stubLongLines(text.split('\n'));
  if (!stubs) return clipEnds(text, limit, save);
  const kept = lines.join('\n');
  return kept.length <= limit ? `${kept}${save ? `\n(full result: ${save(text)})` : ''}` : clipEnds(kept, limit, save ? () => save(text) : undefined);
}

/**
 * Earlier decisions as a transcript that only grows: what the agent wrote, called and got back, no reasoning, each
 * result clipped by clipEnds and without images. A finished decision renders to the same bytes on every request, so the
 * provider's cached prefix covers all of them; only Pi's compaction rewrites it.
 */
export function freezeHistory(messages: any[], options: { resultChars?: number; save?: SaveResult } = {}): any[] {
  const limit = options.resultChars ?? HISTORY_RESULT_CHARS;
  return projectNativeHistory(messages).map(message => {
    if (message.role === 'user' && Array.isArray(message.content) && message.content.some((b: any) => b?.type === 'image'))
      return { ...message, content: message.content.filter((b: any) => b?.type !== 'image') };
    if (message.role !== 'toolResult') return message;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = textOf(message);
    if (text.length <= limit && blocks.every((b: any) => b?.type === 'text') && !text.split('\n').some(line => line.length > LONG_LINE_CHARS)) return message;
    return { ...message, content: [{ type: 'text', text: historyResult(text, limit, options.save) }] };
  });
}

/**
 * The decisions before the current one as text: per decision what the agent said, each call with a short form of its
 * arguments, and what came back. The newest `fullResults` results (default 2) are whole up to `resultChars`; older
 * ones keep their first line and any action receipts. Decisions are added newest first until the budget is used.
 */
export function summarizeHistory(messages: any[], options: HistoryOptions = {}): { text: string; decisions: number; omitted: number } {
  const budget = options.budget ?? 12000, fullResults = options.fullResults ?? 2, resultChars = options.resultChars ?? HISTORY_RESULT_CHARS;
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
        const shown = newest.has(String(block.id)) ? historyResult(body.trim(), resultChars, options.save)
          : [clip(flat(body.split('\n')[0] ?? ''), 200), ...acted.filter(line => line !== body.split('\n')[0])].join('\n');
        lines.push(`${block.name}(${clip(flat(JSON.stringify(block.arguments ?? {})), 160)})${result?.isError ? ' FAILED' : ''} → ${shown}`);
      }
    }
    if (lines.length) blocks.push(lines.join('\n'));
  }
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    // The newest decision is always shown, clipped to the budget if it alone exceeds it. Labels count toward the budget.
    const label = `[decision -${blocks.length - i}]\n`.length + 1;
    const block = kept.length ? blocks[i] : blocks[i].slice(0, budget - label);
    if (kept.length && used + label + block.length > budget) break;
    kept.unshift(block); used += label + block.length;
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
