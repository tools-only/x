/** Pi runtime adapter for the core context policy (art. 6-4, 10-1).
 * Converts Pi messages into task-neutral ContextItems, applies the core plan to the outgoing request, and resolves
 * read-only retrieval of omitted items. The Agent changes policy.context and its methods, never individual items. */
import { contextStub, type ContextAction, type ContextItem } from './self_root.ts';

export type ContextSectionText = { section: string; text: string };
const size = (x: unknown) => typeof x === 'string' ? x.length : JSON.stringify(x ?? '').length;
const SHORT_FIELD = 200;

/** Provider stop reasons normalized to the core vocabulary. */
export function normalizeStop(stopReason: unknown): string | null {
  if (stopReason === undefined || stopReason === null) return null;
  return ({ length: 'output_cap', toolUse: 'tool_use', stop: 'end', error: 'error', aborted: 'aborted' } as Record<string, string>)[String(stopReason)] ?? String(stopReason);
}
/** Whether the registered model reports prompt caching; zero-priced cache reads are reported as unknown, not as false. */
export function cacheSupported(model: any): boolean | 'unknown' {
  return Number(model?.cost?.cacheRead) > 0 ? true : 'unknown';
}

export function createPiContextAdapter() {
  let transcript: any[] = [];
  const ids = new WeakMap<object, string>(); let nextId = 1;
  const partsOf = (m: any): any[] => typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];

  /** Items of one request: declared system sections, tool schemas and every history message part. */
  function items(messages: any[], sections: ContextSectionText[], toolSchemas: unknown, segmentOf?: (m: any) => number | undefined): ContextItem[] {
    transcript = messages;
    const out: ContextItem[] = sections.filter(s => s.text).map(s => ({ ref: `sys:${s.section}`, section: s.section, chars: s.text.length, images: 0, turn_age: 0 }));
    out.push({ ref: 'sys:tool_schemas', section: 'tool_schemas', chars: size(toolSchemas), images: 0, turn_age: 0 });
    const assistants = messages.map((m, i) => m?.role === 'assistant' ? i : -1).filter(i => i >= 0);
    const latest = assistants.at(-1) ?? -1;
    for (let i = 1; i < messages.length; i++) {
      const m = messages[i];
      const turn_age = assistants.filter(a => a > i).length;
      const section = typeof m.contextSection === 'string' ? m.contextSection : 'history';
      const segment = segmentOf?.(m);
      partsOf(m).forEach((p: any, j: number) => {
        const messageId = ids.get(m) ?? (() => { const id = `item:${nextId++}`; ids.set(m, id); return id; })();
        const base = { ref: `${messageId}.${j}`, section, role: m.role, turn_age, ...(segment !== undefined ? { segment } : {}) };
        if (m.role === 'assistant' && p.type === 'thinking') out.push({ ...base, kind: 'reasoning', source: 'assistant', chars: size(p.thinking ?? p.text ?? ''), images: 0, latest_assistant: i === latest });
        else if (m.role === 'assistant' && p.type === 'toolCall') out.push({ ...base, kind: 'tool_call_args', source: p.name, pair: p.id, chars: size(p.arguments), images: 0 });
        else if (m.role === 'toolResult' && p.type === 'image') out.push({ ...base, kind: 'tool_result_image', source: m.toolName, pair: m.toolCallId, chars: 0, image_bytes: Buffer.byteLength(String(p.data ?? ''), 'utf8'), images: 1 });
        else if (m.role === 'toolResult') out.push({ ...base, kind: 'tool_result_text', source: m.toolName, pair: m.toolCallId, chars: size(p.text ?? p), images: 0 });
        else out.push({ ...base, kind: 'text', source: m.customType ?? m.role, chars: p.type === 'image' ? 0 : size(p.text ?? p), image_bytes: p.type === 'image' ? Buffer.byteLength(String(p.data ?? ''), 'utf8') : 0, images: p.type === 'image' ? 1 : 0 });
      });
    }
    return out;
  }

  const shortenArgs = (value: any, max: number, note: (cut: number) => string): any => {
    if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}${note(value.length - max)}` : value;
    if (Array.isArray(value)) return value.map(v => shortenArgs(v, max, note));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shortenArgs(v, max, note)]));
    return value;
  };

  /** Apply the core plan to the outgoing messages; call/result ids and JSON arguments stay valid. */
  function apply(messages: any[], list: ContextItem[], actions: Record<string, ContextAction>, policyHash: string) {
    const byRef = new Map(list.map(i => [i.ref, i]));
    const out: any[] = [messages[0]];
    for (let i = 1; i < messages.length; i++) {
      const m = messages[i], parts = partsOf(m);
      const messageId = ids.get(m) ?? `item:${i}`;
      const acts = parts.map((_p: any, j: number) => actions[`${messageId}.${j}`] ?? 'include');
      if (acts.every((a: ContextAction) => a === 'include')) { out.push(m); continue; }
      if (acts.every((a: ContextAction) => a === 'drop') && !['assistant', 'toolResult'].includes(m.role)) continue;
      const next: any[] = [];
      parts.forEach((p: any, j: number) => {
        const a = acts[j], item = byRef.get(`${messageId}.${j}`)!;
        if (a === 'include') { next.push(p); return; }
        const stub = contextStub(item, policyHash, { chars: item.chars, images: item.images });
        const truncNote = (cut: number) => ` [... ${cut} chars truncated by policy.context@${policyHash.slice(0, 12)}; read_self(section="context_item", ref="${item.ref}")]`;
        if (p.type === 'thinking') return; // reasoning is dropped or stubbed by omission
        if (p.type === 'toolCall') { next.push({ ...p, arguments: shortenArgs(p.arguments, typeof a === 'object' ? a.truncate : SHORT_FIELD, typeof a === 'object' ? truncNote : () => ` ${stub}`) }); return; }
        if (a === 'drop' && m.role !== 'toolResult') return;
        if (p.type === 'image' || a === 'stub' || a === 'drop') { next.push({ type: 'text', text: stub }); return; }
        const t = String(p.text ?? '');
        next.push({ ...p, text: t.length > a.truncate ? `${t.slice(0, a.truncate)}${truncNote(t.length - a.truncate)}` : t });
      });
      if (!next.length && m.role === 'toolResult') next.push({ type: 'text', text: '[omitted by context policy]' });
      out.push({ ...m, content: typeof m.content === 'string' ? next.map((p: any) => p.text ?? '').join('') : next });
    }
    return out;
  }

  /** Read-only retrieval for read_self(section="context_item", ref). */
  function resolve(ref: string) {
    const match = /^(item:\d+)\.(\d+)$/.exec(ref);
    if (!match) throw Error(`context_item ref must be a stable item id; system sections and tool schemas are always present`);
    const m = transcript.find(x => ids.get(x) === match[1]);
    const p = m ? partsOf(m)[Number(match[2])] : undefined;
    if (!p) return { ref, available: false, status: 'unavailable' };
    const content = p.type === 'image' ? { type: 'image', data: p.data, mimeType: p.mimeType ?? 'image/png' }
      : p.type === 'toolCall' ? { tool: p.name, arguments: p.arguments } : p.type === 'thinking' ? { reasoning: p.thinking ?? p.text } : { text: p.text ?? p };
    return { ref, role: m.role, source: m.toolName ?? m.customType ?? m.role, content };
  }

  return { items, apply, resolve };
}
