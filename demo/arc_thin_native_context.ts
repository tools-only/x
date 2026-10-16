/**
 * What the model is shown of its earlier decisions in native mode. Pi's session file is never changed.
 *
 * Default (2026-10-14): earlier decisions are a transcript placed before the current decision's head (freezeHistory),
 * the Prime Agent arrangement. A summary rebuilt inside the head (summarizeHistory, ARC_THIN_NATIVE_HISTORY_CHARS > 0)
 * changed every decision, so every decision began with a full cache miss, and it lost results that did not fit
 * (pilot-01). The transcript is bounded by clipping each earlier result and by Pi's compaction.
 */
import { LONG_LINE_CHARS, stubLongLines } from './arc_thin_workspace.ts';
import { canonical } from './arc_thin_native_loop.ts';

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

/** The size cap applied to a short-field block that had to be lifted out of a reasoning block. */
export const CARRY_CHARS = 700;

/**
 * The model's own short-field block as it wrote it (Continual Harness's carry), or undefined. Nothing is rewritten or
 * summarised: the marked region is returned verbatim, clipped only when it was lifted out of a reasoning block.
 */
export function carryText(text: string, limit = CARRY_CHARS): string | undefined {
  // The last block wins: the model is asked to rewrite the fields, so a later one supersedes an earlier one.
  const matches = [...String(text ?? '').matchAll(/<carry>([\s\S]*?)<\/carry>/gi)];
  const body = matches.at(-1)?.[1].trim();
  if (!body) return undefined;
  return `<carry>\n${body.length > limit ? `${body.slice(0, limit)}… <${body.length} chars>` : body}\n</carry>`;
}

/** Asked for once per projection when a tool-calling message carried no short fields, so the gap is visible where it
 * is felt (the next result) rather than only in the system prompt. Position-based, so earlier rounds keep their bytes. */
export const CARRY_REMINDER = '<carry-missing>\nYour last message left no <carry> block, so its reasoning is gone and\n'
  + 'only its call and this result remain. Write one (premises, eliminated, probe, open) in your reasoning or your\n'
  + 'text from now on; what is not in it you will have to derive again.\n</carry-missing>';

/**
 * Within one decision the model's reasoning prose is not replayed; the `<carry>` fields it writes itself are. A message
 * that wrote them inside its thinking instead of its text has them lifted onto the result that follows it, because that
 * assistant message is already final when its result first appears: every earlier round therefore renders to the same
 * bytes on every later request (the projection stays append-only and no turn is collapsed or dropped).
 *
 * A tool-calling message with no fields at all gets the reminder above on its result, once per projection. One is a
 * probe, not a nag: the agent either starts writing the block or it does not, and `carry_blocks` measures which.
 */
export function carryFields(messages: any[], limit = CARRY_CHARS): any[] {
  let lifted: string | undefined;
  let reminded = false;
  return messages.map(message => {
    if (message?.role === 'assistant') {
      const blocks: any[] = Array.isArray(message.content) ? message.content : [];
      const thinking = blocks.filter(b => b?.type === 'thinking').map(b => String(b.thinking ?? '')).join('\n');
      lifted = thinking && !carryText(textOf(message)) ? carryText(thinking, limit) : undefined;
      if (!lifted && !carryText(textOf(message)) && blocks.some(b => b?.type === 'toolCall') && !reminded) {
        lifted = CARRY_REMINDER;
        reminded = true;
      }
      const content = blocks.filter(b => b?.type !== 'thinking');
      return content.length === blocks.length ? message : { ...message, content };
    }
    if (message?.role !== 'toolResult' || !lifted) return message;
    const carry = lifted;
    lifted = undefined;
    return { ...message, content: [{ type: 'text', text: carry }, ...(Array.isArray(message.content) ? message.content : [])] };
  });
}

/** Retire old raw results without changing the durable Pi transcript. Explicit reads still return actual bodies. */
export function projectNativeDecision(messages: any[], options: {
 reasoning?: 'all' | 'recent' | 'fields' | 'none'; fullResults?: number; carryChars?: number;
 archive?: (message: any, text: string) => string;
} = {}): any[] {
 const paired = options.reasoning === 'fields' ? carryFields(projectNativeHistory(messages, true), options.carryChars)
  : projectNativeHistory(messages, options.reasoning !== 'none');
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
 * Rounds in a row that repeat the same tool calls (names and arguments) render as the last of them, with how many times
 * it ran; the action receipts of the results left out are kept. A round is an assistant message with tool calls and the
 * results that answer them. A run goes on across decision prompts and assistant messages without calls, which stay in
 * place; a different call or any other message ends it. A call that was refused is not a repeat of one that ran: in
 * su15-r1-B2 calls 17-20 were refused by the decision's call cap, and showing only their refusal would have hidden what
 * the 16 before them returned.
 *
 * The yibu gateway refuses every request whose messages repeat an identical call across consecutive rounds. In
 * su15-r1-B2 (2026-10-16) the agent ran one python call 20 times in a row in one decision; the transcript of earlier
 * decisions carried the repetition into every later request, so every one was refused and the run never acted again
 * (su15-r4 failed the same way). The gateway also counts across decision prompts: su15-l0-1 (2026-10-17) played one
 * action once per decision 20 times and was refused until the run stopped. Keeping the last round means a run that
 * grows into the next decision changes the transcript only from its previous end on.
 */
export function collapseRepeatedCalls(messages: any[]): any[] {
  type Round = { message: any; ids: string[]; results: any[]; calls: string };
  // Rounds and the other messages, in order.
  const items: Array<Round | { other: any }> = [];
  for (const message of messages) {
    const calls = message?.role === 'assistant' && Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'toolCall') : [];
    const last = items.at(-1);
    if (calls.length) items.push({ message, ids: calls.map((block: any) => String(block.id)), results: [],
      calls: JSON.stringify(calls.map((block: any) => [block.name, canonical(block.arguments ?? {})])) });
    else if (message?.role === 'toolResult' && last && 'ids' in last && last.ids.includes(String(message.toolCallId)))
      last.results.push(message);
    else items.push({ other: message });
  }
  const key = (round: Round) => round.calls + JSON.stringify(round.results.map(result => Boolean(result.isError)));
  // What a run goes on across: decision prompts, and assistant messages without calls.
  const passes = (other: any) => other?.role === 'user' || other?.role === 'assistant';
  const out: any[] = [];
  for (let i = 0; i < items.length;) {
    const item = items[i];
    if (!('ids' in item)) { out.push(item.other); i += 1; continue; }
    let end = i;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if ('ids' in next ? key(next) !== key(item) : !passes(next.other)) break;
      if ('ids' in next) end = j;
    }
    const span = items.slice(i, end + 1);
    i = end + 1;
    const run = span.filter((entry): entry is Round => 'ids' in entry);
    const passed = span.flatMap(entry => 'ids' in entry ? [] : [entry.other]);
    const kept = run.at(-1)!;
    out.push(...passed);
    if (run.length === 1) { out.push(kept.message, ...kept.results); continue; }
    const decisions = 1 + passed.filter(message => message?.role === 'user').length;
    const times = `This call was made ${run.length} times in a row${decisions > 1 ? `, in ${decisions} decisions` : ''}`;
    out.push(kept.message);
    kept.ids.forEach((id, k) => {
      const results = run.map(round => round.results.find(result => String(result.toolCallId) === round.ids[k]));
      const texts = results.map(textOf);
      const same = texts.every(text => text === texts[0]);
      const receipts = same ? [] : texts.slice(0, -1).flatMap(actionLines);
      const note = same ? `(${times}; every result was the same:)`
        : `(${times}; ${run.length - 1} earlier results are not shown` +
          (receipts.length ? `; their action receipts:\n${receipts.join('\n')}` : '') + '\nThe last result:)';
      const result = results.at(-1);
      if (result) out.push({ ...result, toolCallId: id, content: [{ type: 'text', text: `${note}\n${texts.at(-1)}` }] });
    });
  }
  return out;
}

/**
 * Earlier decisions as a transcript: what the agent wrote, called and got back, no reasoning, each result clipped by
 * clipEnds and without images. A finished decision renders to the same bytes on every request, so the provider's cached
 * prefix covers it, until Pi's compaction rewrites it or a run of repeated calls it ends with goes on in the next
 * decision. Rounds that repeated the same calls show once with their count (collapseRepeatedCalls);
 * `collapseRepeats: false` keeps every copy.
 */
export function freezeHistory(messages: any[], options: { resultChars?: number; save?: SaveResult; collapseRepeats?: boolean } = {}): any[] {
  const limit = options.resultChars ?? HISTORY_RESULT_CHARS;
  const projected = projectNativeHistory(messages);
  return (options.collapseRepeats === false ? projected : collapseRepeatedCalls(projected)).map(message => {
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
