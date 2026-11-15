// Deterministic observation over a self ledger: three altitudes of recorded operating facts.
// A1 repeats/cost/losses/rejections, A2 trajectory, A3 outcome paths. Every output states only
// what happened, what it cost, or what was present/absent in a recorded path - never a cause,
// a conclusion or a recommendation. Semantic judgment stays with the agent reading it.
// Standalone and task-neutral: input is plain ledger rows; no task vocabulary in this file.

export interface ObservationRow { ref?: string; type?: string; value?: any }
export interface ObservationSource {
  ledger: ObservationRow[];
  /** Callable capability names granted at observation time (surface tools, self ops, decide:{id}). */
  capabilities?: string[];
  /** Active components, for zero-call listing; chars is the recorded text length when known. */
  components?: { kind: string; name: string; chars?: number }[];
  /** Current orchestration step ids, so zero-execution steps are listed. */
  orchestration?: { steps: string[] };
  /** Per-kind recorded consumption-binding fact and resident chars per request, supplied by the runtime. */
  bindings?: Record<string, { binding: string; rent_chars: number }>;
  /** Compute the inventory/recurrence block (pure counting over recorded rows; off by default). */
  a4?: boolean;
}

export interface ObservationA1 {
  requests: { mode: string; count: number; input_tokens: number; output_tokens: number; cache_read: number; usd: number }[];
  repeats: { address: string; count: number; first: string; last: string }[];
  repeated_inputs: { tool: string; count: number; input_hash: string }[];
  rejections: { head: string; count: number; last: string }[];
  losses: { kind: string; detail: string; ref: string }[];
  stops: { stop: string; count: number }[];
  unused: { tools_never_called: string[]; self_reads: number };
}
export interface ObservationA2 {
  modes: string;
  actions: { name: string; count: number; errors: number }[];
  artifact_touches: { path: string; writes: number }[];
  decide_receipts: number;
  activations: number;
  reviews: { opened: number; closed: number };
  segments: { segment: number | string; line: string }[];
}
export interface ObservationA3 {
  entries: { ref: string; outcome: string; sequence: string; in_path: string[]; available_not_in_path: string[] }[];
}
/** Inventory/recurrence counts: true per-kind counts (0 is 0), recorded bindings, per-step executions,
 * and per-span call coverage. Pure counting over recorded rows; no similarity judgment, no recommendation. */
export interface ObservationA4 {
  inventory: { kinds: { kind: string; count: number; rent_chars: number | null; in_path_spans: number; binding: string | null }[];
    steps: { id: string; executions: number }[]; spans: number; residency_chars: number | null };
  recurrence: { spans: number; calls: { name: string; spans: number; total: number }[]; component_path_spans: number };
}
export interface Observation { a1: ObservationA1; a2: ObservationA2; a3: ObservationA3; a4?: ObservationA4; rows: number }

const NORMAL_STOPS = new Set(['end_turn', 'stop', 'stop_sequence', 'tool_use', 'tool_calls', 'completed']);
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const textOf = (v: any): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
  if (v && typeof v === 'object') return textOf(v.error ?? v.text ?? v.message ?? v.content ?? '');
  return v === undefined || v === null ? '' : String(v);
};
/** Digit-normalized first line of an error text, for mechanical grouping only. */
const headOf = (text: string) => text.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().slice(0, 96);
/** Compact echo of a recorded value: long opaque strings shortened, arrays capped. Mechanical only. */
const compactJson = (value: any, cap = 200): string => {
  const walk = (v: any, depth: number): any => {
    if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 10)}~` : v;
    if (Array.isArray(v)) return (depth > 3 ? [] : v.slice(0, 6).map(x => walk(x, depth + 1))).concat(v.length > 6 ? [`+${v.length - 6}`] : []);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, x] of Object.entries(v).slice(0, 12)) out[k] = depth > 3 ? '~' : walk(x, depth + 1);
      return out;
    }
    return v;
  };
  const s = JSON.stringify(walk(value, 0));
  return s.length > cap ? `${s.slice(0, cap)}~` : s;
};
const runLength = (names: string[], cap = 28): string => {
  const runs: string[] = [];
  let cur = '', n = 0;
  for (const name of [...names, '\u0000']) {
    if (name === cur) { n++; continue; }
    if (n > 0) runs.push(n > 1 ? `${cur}x${n}` : cur);
    cur = name; n = 1;
  }
  return runs.length > cap ? `${runs.slice(0, cap).join(' ')} ... ${runs.length - cap} more runs` : runs.join(' ');
};
const topOf = <T>(map: Map<string, T>, by: (t: T) => number, cap: number): [string, T][] =>
  [...map.entries()].sort((a, b) => by(b[1]) - by(a[1])).slice(0, cap);

export function observe(source: ObservationSource): Observation {
  const ledger = source.ledger ?? [];
  // --- A1 ---
  const reqByMode = new Map<string, { mode: string; count: number; input_tokens: number; output_tokens: number; cache_read: number; usd: number }>();
  const stops = new Map<string, number>();
  const repeats = new Map<string, { count: number; first: string; last: string }>();
  const inputs = new Map<string, { tool: string; count: number; input_hash: string }>();
  const rejections = new Map<string, { count: number; last: string }>();
  const fallbackRejections = new Map<string, { count: number; last: string }>();
  const losses: { kind: string; detail: string; ref: string }[] = [];
  const toolCalls = new Map<string, { count: number; errors: number }>();
  const touches = new Map<string, number>();
  const modeSeq: string[] = [];
  const segments: { segment: number | string; line: string }[] = [];
  let decides = 0, activations = 0, opened = 0, closed = 0, selfReads = 0;

  const addHead = (map: Map<string, { count: number; last: string }>, text: string, ref: string) => {
    const head = headOf(text);
    if (!head) return;
    const r = map.get(head) ?? { count: 0, last: ref };
    r.count++; r.last = ref; map.set(head, r);
  };
  // One rejection per failed call: count error tool results. Rows that re-record the same failure
  // (tool_failed at turn end, transaction_failed on abort) are a fallback for ledgers without tool_result rows.
  const reject = (text: string, ref: string) => addHead(rejections, text, ref);
  const rejectFallback = (text: string, ref: string) => addHead(fallbackRejections, text, ref);

  for (const row of ledger) {
    const v = row.value ?? {}, ref = row.ref ?? '';
    switch (row.type) {
      case 'request_record': {
        const mode = v.pin?.mode ?? 'unknown';
        modeSeq.push(mode);
        const r = reqByMode.get(mode) ?? { mode, count: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, usd: 0 };
        r.count++; r.input_tokens += num(v.tokens?.input); r.output_tokens += num(v.tokens?.output);
        r.cache_read += num(v.tokens?.cache_read); r.usd += num(v.usd_estimate);
        reqByMode.set(mode, r);
        if (v.stop && !NORMAL_STOPS.has(String(v.stop))) stops.set(String(v.stop), (stops.get(String(v.stop)) ?? 0) + 1);
        if (Array.isArray(v.cut_tool_calls) && v.cut_tool_calls.length)
          losses.push({ kind: 'output_cut', detail: `request ${v.request}: ${v.cut_tool_calls.length} tool call(s) cut at output cap ${v.output_cap ?? '?'}`, ref });
        break;
      }
      case 'reflection_activated': {
        if (v.parent === undefined) break; // intent record; the post-activation record carries parent
        activations++;
        for (const address of v.addresses ?? []) {
          const r = repeats.get(address) ?? { count: 0, first: ref, last: ref };
          r.count++; r.last = ref; repeats.set(address, r);
        }
        if (v.restore_source !== undefined && v.restore_source !== null) {
          const list: string[] = v.addresses ?? [];
          losses.push({ kind: 'restore', detail: `restore to definition ${v.restore_source} replaced ${list.length} addresses: ${list.slice(0, 12).join(', ')}${list.length > 12 ? ', ...' : ''}`, ref });
        }
        break;
      }
      case 'tool_result': {
        const name = String(v.tool ?? 'tool');
        const t = toolCalls.get(name) ?? { count: 0, errors: 0 };
        t.count++; if (v.is_error) t.errors++; toolCalls.set(name, t);
        if (name === 'decide' && !v.is_error) decides++;
        if (name === 'read_self' || name === 'read_self_component') selfReads++;
        if (v.input_hash) {
          const key = `${name}|${v.input_hash}`;
          const r = inputs.get(key) ?? { tool: name, count: 0, input_hash: String(v.input_hash) };
          r.count++; inputs.set(key, r);
        }
        if (v.is_error) reject(`${name}: ${textOf(v.result)}`, ref);
        break;
      }
      case 'tool_failed': rejectFallback(`${v.tool ?? 'tool'}: ${textOf(v.error ?? v.content)}`, ref); break;
      case 'transaction_failed': case 'activation_failed': rejectFallback(textOf(v.error), ref); break;
      case 'transaction_interrupted': case 'request_paused': case 'coverage_gap':
        losses.push({ kind: row.type, detail: textOf(v.reason ?? v.error).slice(0, 120), ref }); break;
      case 'artifact_write': {
        const path = String(v.path ?? '');
        if (path) touches.set(path, (touches.get(path) ?? 0) + 1);
        break;
      }
      case 'mode_entered': opened++; break;
      case 'review_closed': closed++; break;
      case 'segment_summary':
        segments.push({ segment: v.segment ?? segments.length, line: `segment ${v.segment ?? '?'}: phase ${v.phase ?? '-'} unit ${v.unit ?? '-'} rows ${Array.isArray(v.ledger) ? v.ledger.join('-') : '-'}` });
        break;
    }
  }

  const rejectionSource = rejections.size ? rejections : fallbackRejections;
  const a1: ObservationA1 = {
    requests: [...reqByMode.values()].sort((a, b) => b.count - a.count),
    repeats: topOf(repeats, r => r.count, 6).filter(([, r]) => r.count >= 3).map(([address, r]) => ({ address, ...r })),
    repeated_inputs: topOf(inputs, r => r.count, 6).filter(([, r]) => r.count >= 3).map(([, r]) => r),
    rejections: topOf(rejectionSource, r => r.count, 8).map(([head, r]) => ({ head, ...r })),
    losses: losses.slice(-10),
    stops: [...stops.entries()].map(([stop, count]) => ({ stop, count })),
    unused: {
      tools_never_called: (source.components ?? []).filter(c => c.kind === 'tool' && !toolCalls.has(c.name)).map(c => c.name),
      self_reads: selfReads,
    },
  };
  const a2: ObservationA2 = {
    modes: runLength(modeSeq),
    actions: topOf(toolCalls, t => t.count, 10).map(([name, t]) => ({ name, ...t })),
    artifact_touches: topOf(touches, n => n, 8).map(([path, writes]) => ({ path, writes })),
    decide_receipts: decides,
    activations,
    reviews: { opened, closed },
    segments: segments.slice(-6),
  };

  // --- A3: one pedigree entry per environment-authority outcome ---
  const capabilities = [...new Set(source.capabilities ?? [])];
  const entries: ObservationA3['entries'] = [];
  const spanData: { seq: string[]; inPath: Set<string> }[] = [];
  let spanStart = 0;
  for (let i = 0; i < ledger.length; i++) {
    if (ledger[i].type !== 'task_outcome') continue;
    const span = ledger.slice(spanStart, i + 1);
    spanStart = i + 1;
    const seq: string[] = [];
    const inPath = new Set<string>();
    for (const row of span) {
      const v = row.value ?? {};
      if (row.type === 'tool_result') { const n = String(v.action ?? v.tool ?? 'tool'); seq.push(n); inPath.add(String(v.tool ?? n)); if (String(v.tool) === 'decide') inPath.add('decide'); }
      else if (row.type === 'reflection_activated' && v.parent !== undefined) for (const a of v.addresses ?? []) inPath.add(a);
    }
    spanData.push({ seq, inPath });
    const used = new Set([...seq, ...inPath]);
    entries.push({
      ref: ledger[i].ref ?? '',
      outcome: compactJson(ledger[i].value ?? null, 200),
      sequence: runLength(seq, 20),
      in_path: [...inPath].slice(0, 12),
      available_not_in_path: capabilities.filter(c => !used.has(c) && !used.has(c.split(':')[0])).slice(0, 8),
    });
  }
  const a3: ObservationA3 = { entries };

  // --- A4: inventory/recurrence counting (only when the source asks for it) ---
  let a4: ObservationA4 | undefined;
  if (source.a4) {
    const comps = source.components ?? [];
    const kindList = ['prompt', 'skill', 'tool', 'memory', 'subagent'];
    const addrOf = (kind: string, name: string) => `components.${kind}.${name}`;
    const spanHasKind = (s: { inPath: Set<string> }, kind: string) =>
      comps.some(c => c.kind === kind && (s.inPath.has(c.name) || s.inPath.has(addrOf(kind, c.name))));
    const stepRuns = new Map<string, number>();
    for (const row of ledger) if (row.type === 'request_record' && row.value?.pin?.step !== undefined) {
      const id = String(row.value.pin.step);
      stepRuns.set(id, (stepRuns.get(id) ?? 0) + 1);
    }
    for (const id of source.orchestration?.steps ?? []) if (!stepRuns.has(id)) stepRuns.set(id, 0);
    const kinds = kindList.map(kind => ({ kind,
      count: new Set(comps.filter(c => c.kind === kind).map(c => c.name)).size,
      rent_chars: source.bindings?.[kind]?.rent_chars ?? null,
      in_path_spans: spanData.filter(s => spanHasKind(s, kind)).length,
      binding: source.bindings?.[kind]?.binding ?? null }));
    const callTotals = new Map<string, { spans: number; total: number }>();
    for (const s of spanData) {
      const counts = new Map<string, number>();
      for (const n of s.seq) counts.set(n, (counts.get(n) ?? 0) + 1);
      for (const [n, c] of counts) { const r = callTotals.get(n) ?? { spans: 0, total: 0 }; r.spans++; r.total += c; callTotals.set(n, r); }
    }
    a4 = {
      inventory: { kinds, steps: [...stepRuns.entries()].map(([id, executions]) => ({ id, executions })), spans: spanData.length,
        residency_chars: source.bindings ? Object.values(source.bindings).reduce((n, b) => n + (b.rent_chars ?? 0), 0) : null },
      recurrence: { spans: spanData.length,
        calls: topOf(callTotals, r => r.spans * 1000 + r.total, 4).map(([name, r]) => ({ name, ...r })),
        component_path_spans: spanData.filter(s => comps.some(c => s.inPath.has(c.name) || s.inPath.has(addrOf(c.kind, c.name)))).length },
    };
  }
  return { a1, a2, a3, ...(a4 ? { a4 } : {}), rows: ledger.length };
}

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** Render as one compact fact-per-line block under a character budget; overflow folds to a pull pointer. */
export function renderObservation(o: Observation, budget = 2800): string {
  const lines: string[] = [];
  const req = o.a1.requests.map(r => `${r.mode} ${r.count} (in ${fmtTokens(r.input_tokens)} out ${fmtTokens(r.output_tokens)})`).join(' | ');
  const cache = o.a1.requests.reduce((n, r) => n + r.cache_read, 0);
  const stop = o.a1.stops.map(s => `${s.stop}x${s.count}`).join(' ');
  lines.push(`[requests] ${req || 'none'}; cache_read ${fmtTokens(cache)}${stop ? `; stops: ${stop}` : ''}`);
  for (const r of o.a1.repeats) lines.push(`[repeat] ${r.address} written ${r.count}x [${r.first}..${r.last}]`);
  for (const r of o.a1.repeated_inputs) lines.push(`[repeat] ${r.tool} called ${r.count}x with identical input`);
  for (const r of o.a1.rejections) lines.push(`[reject] x${r.count} "${r.head}" [last ${r.last}]`);
  for (const l of o.a1.losses) lines.push(`[loss] ${l.kind}: ${l.detail} [${l.ref}]`);
  if (o.a1.unused.tools_never_called.length) lines.push(`[idle] tool components with zero calls: ${o.a1.unused.tools_never_called.join(', ')}`);
  if (o.a4) {
    const inv = o.a4.inventory;
    lines.push(`[inventory] ${inv.kinds.map(k => `${k.kind} ${k.count}${k.rent_chars !== null ? ` (${k.rent_chars} chars/request)` : ''}${inv.spans ? `, in path ${k.in_path_spans}/${inv.spans} spans` : ''}${k.binding ? `; ${k.binding}` : ''}`).join(' | ')}${inv.residency_chars !== null ? `; total residency ${inv.residency_chars} chars/request` : ''}${inv.steps.length ? `; step executions: ${inv.steps.map(s => `${s.id}x${s.executions}`).join(' ')}` : ''}`);
    const rec = o.a4.recurrence;
    lines.push(`[recurrence] ${rec.spans} outcome span(s)${rec.calls.length ? `; calls: ${rec.calls.map(c => `${c.name} in ${c.spans}/${rec.spans} spans x${c.total}`).join(', ')}` : ''}; agent components in path ${rec.component_path_spans}/${rec.spans || 0} spans`);
  }
  lines.push(`[trace] modes: ${o.a2.modes || '-'}`);
  lines.push(`[trace] decide receipts ${o.a2.decide_receipts}; self changes ${o.a2.activations}; reviews ${o.a2.reviews.opened}/${o.a2.reviews.closed}; self reads ${o.a1.unused.self_reads}`);
  if (o.a2.actions.length) lines.push(`[trace] calls: ${o.a2.actions.map(a => `${a.name}x${a.count}${a.errors ? `(${a.errors} err)` : ''}`).join(' ')}`);
  if (o.a2.artifact_touches.length) lines.push(`[trace] artifact writes: ${o.a2.artifact_touches.map(t => `${t.path}x${t.writes}`).join(' ')}`);
  // Outcome pedigrees newest-first so a tight budget keeps the most recent ones.
  for (const e of [...o.a3.entries].reverse()) {
    lines.push(`[outcome ${e.ref}] ${e.outcome}`);
    lines.push(`  path: ${e.sequence || '(no recorded calls in span)'}${e.available_not_in_path.length ? `; available, not in path: ${e.available_not_in_path.join(', ')}` : ''}`);
  }
  const out: string[] = [];
  const reserve = 64; // room for the fold pointer line
  let used = 0, folded = 0;
  for (const line of lines) {
    if (used + line.length + 1 <= budget - reserve) { out.push(line); used += line.length + 1; }
    else folded++;
  }
  if (folded) out.push(`+${folded} more lines: read_self(section="observation")`);
  return out.join('\n');
}

/** One-line digest for non-review request tails. */
export function observationHeads(o: Observation): string {
  const total = o.a1.requests.reduce((n, r) => n + r.count, 0);
  const mix = o.a1.requests.map(r => `${r.mode} ${r.count}`).join('/');
  const top = o.a1.repeats[0];
  const rej = o.a1.rejections.reduce((n, r) => n + r.count, 0);
  const last = o.a3.entries.at(-1);
  return `facts: ${total} requests (${mix || '-'})${top ? `; top repeat ${top.address}x${top.count}` : ''}${rej ? `; rejections ${rej}` : ''}${last ? `; last outcome ${last.ref}` : ''} - read_self(section="observation")`;
}
