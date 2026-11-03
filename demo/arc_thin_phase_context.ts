/**
 * Small, transport-neutral continuity projection for a phase boundary.
 *
 * Event rows keep their source-local line identity. There is no cross-file ordering claim: the caller supplies the
 * order in which source-local facts should be offered. A cursor advances only when its exact event receipt or pointer
 * is included in the returned projection. Cursor progress is committed by the owner only after ADAPT settles.
 */

export type PhaseEventCursor = Record<string, number>;

export type PhaseEvent = {
  source: string;
  line: number;
  /** A factual receipt authored by the source adapter, not a runtime interpretation. */
  receipt: string;
};

export type PhaseContinuityOptions = {
  maxChars: number;
  maxEvents: number;
};

export type PhaseContinuity = {
  text: string;
  /** Cursor after exactly the receipts/pointers returned in text. */
  nextCursor: PhaseEventCursor;
  delivered: Array<{ source: string; line: number; requiresRead: boolean }>;
  pending: number;
};

/**
 * Build a bounded ADAPT/event delta while carrying current task state independently.
 *
 * `events` must contain source-local line numbers and caller-selected factual receipts. Its order is preserved; sources
 * that have no stable line reference must not be passed as durable cursor events. When an event is larger than the
 * remaining budget, a pointer-only receipt is emitted if possible and names the exact source/line for read-back.
 */
export function projectPhaseContinuity<T>(
  cursor: PhaseEventCursor,
  events: PhaseEvent[],
  options: PhaseContinuityOptions,
): PhaseContinuity {
  if (!Number.isInteger(options.maxChars) || options.maxChars < 64 || !Number.isInteger(options.maxEvents) || options.maxEvents < 1)
    throw new Error('phase continuity bounds must be positive integers (maxChars >= 64, maxEvents >= 1)');

  const nextCursor = { ...cursor };
  const delivered: PhaseContinuity['delivered'] = [];
  const blockedSources = new Set<string>();
  const pendingEvents = events.filter(event => {
    if (!event.source || !Number.isInteger(event.line) || event.line < 1 || typeof event.receipt !== 'string')
      throw new Error('phase events require source, positive line, and factual receipt text');
    return event.line > (cursor[event.source] ?? 0);
  });
  const lines: string[] = ['EVENT DELTA (source-local order only; refs are exact):'];
  let used = lines[0].length;

  for (let index = 0; index < pendingEvents.length; index++) {
    const event = pendingEvents[index];
    if (blockedSources.has(event.source) || delivered.length >= options.maxEvents) continue;
    const ref = `${event.source}:${event.line}`;
    const full = `- ${ref} | ${event.receipt}`;
    const remaining = options.maxChars - used - 1;
    let line = full;
    let requiresRead = false;
    if (line.length > remaining) {
      const pointer = `- ${ref} | receipt omitted (${event.receipt.length} chars); read exact source row.`;
      if (pointer.length > remaining) {
        // Do not advance this source past an event whose pointer was not delivered.
        blockedSources.add(event.source);
        continue;
      }
      line = pointer;
      requiresRead = true;
    }
    lines.push(line);
    used += line.length + 1;
    delivered.push({ source: event.source, line: event.line, requiresRead });
    nextCursor[event.source] = Math.max(nextCursor[event.source] ?? 0, event.line);
  }

  const deliveredKeys = new Set(delivered.map(event => `${event.source}\0${event.line}`));
  const pending = pendingEvents.filter(event => !deliveredKeys.has(`${event.source}\0${event.line}`)).length;
  if (pending) {
    const note = `\n${pending} event row(s) remain beyond this bounded delivery; their source cursors were not advanced.`;
    if (used + note.length <= options.maxChars) lines.push(note.trimStart());
  }

  return { text: lines.length > 1 ? lines.join('\n') : '', nextCursor, delivered, pending };
}
