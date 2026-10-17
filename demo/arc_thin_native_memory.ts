/** Partial acceptance for the native surface; action evidence integrity remains atomic. */
import { emptyMemory, applyRows, planMemoryUpdate, type MemoryState, type MemoryParams, type MemoryPlan,
  type MemoryRow, type ComponentContext, HYP_PREFIX, STATUSES, STRATEGY_STATUSES } from './arc_thin_memory.ts';

/** Python that defines check (def check(…) or check = lambda); anything else in a check field is a sentence. */
const definesCheck = (source: string) => /\bdef\s+check\s*\(|\bcheck\s*=\s*lambda\b/.test(source);

/**
 * su15-l1-1 (2026-10-16) saved "after an ACTION6 or ACTION7, does the 9-blob move? record direction" as a check three
 * times: it never compiled, and the hypothesis kept no test. A sentence in check is kept as the next test instead, after
 * one given with it, and an existing check stays.
 */
function proseCheckAsNextTest(fields: Record<string, any>): string | undefined {
  if (typeof fields.check !== 'string' || !fields.check.trim() || definesCheck(fields.check)) return undefined;
  const prose = fields.check.trim();
  const given = typeof fields.next_test === 'string' && fields.next_test.trim() ? fields.next_test.trim() : '';
  fields.next_test = given ? `${given}; ${prose}` : prose;
  delete fields.check;
  const key = String(fields.key ?? '').trim();
  return `${key.startsWith(HYP_PREFIX) ? key : HYP_PREFIX + key}: the check is not Python; it was kept as next_test. ` +
    'A check is def check(t): returning True, False or None';
}

export function planNativeMemoryUpdate(state: MemoryState, params: MemoryParams, actionCount: number, ctx: ComponentContext = {}): MemoryPlan {
  for (const item of [...(params.hypotheses ?? []).map(h => h?.evidence), ...(params.tests ?? [])]) {
    const action = item?.action;
    if (action !== undefined && !(Number.isInteger(Number(action)) && Number(action) >= 1 && Number(action) <= actionCount))
      return { ok: false, error: `memory NOT changed: action #${action} does not exist (actions so far: ${actionCount})` };
  }
  if (params.op === 'list') return planMemoryUpdate(state, params, actionCount, {...ctx, factProvenance:true, checkSources:true});
  const working = emptyMemory(); working.facts = new Map(state.facts); working.hypotheses = new Map(state.hypotheses);
  working.strategies = new Map(state.strategies); working.dropped = [...state.dropped]; working.revisions = [...state.revisions];
  const rows: MemoryRow[] = []; const receipts: string[] = []; const skipped: string[] = [];
  const apply = (name: string, partial: MemoryParams) => {
    try {
      for (const h of partial.hypotheses ?? []) {
        if (h.status !== undefined && !STATUSES.includes(h.status)) throw Error('unknown hypothesis status');
        for (const key of ['key', 'claim', 'question', 'predicts', 'next_test', 'check'] as const)
          if (h[key] !== undefined && typeof h[key] !== 'string') throw Error(`${key} must be a string`);
      }
      for (const s of partial.strategies ?? []) if (s.status !== undefined && !STRATEGY_STATUSES.includes(s.status)) throw Error('unknown strategy status');
      const plan = planMemoryUpdate(working, partial, actionCount, ctx);
      if (!plan.ok) { skipped.push(`${name}: ${plan.error}`); return false; }
      applyRows(working, plan.rows); rows.push(...plan.rows); receipts.push(plan.receipt); return true;
    } catch (error) { skipped.push(`${name}: ${String(error)}`); return false; }
  };
  if (params.key !== undefined || params.text !== undefined || (params.op === 'delete' && !params.delete?.length))
    apply('entry', { op: params.op, key: params.key, text: params.text, confidence: params.confidence });
  for (const [index, key] of (params.delete ?? []).entries()) apply(`delete[${index}]`, { delete: [key] });
  for (const [index, item] of (params.set ?? []).entries()) apply(`set[${index}]`, { set: [item] });
  for (const [index, item] of (params.hypotheses ?? []).entries()) {
    if (!item || typeof item !== 'object') { skipped.push(`hypotheses[${index}]: needs an entry`); continue; }
    const { evidence, ...fields } = item;
    const prose = proseCheckAsNextTest(fields);
    const applied = apply(`hypotheses[${index}]`, { hypotheses: [fields] });
    if (applied && prose) receipts.push(prose);
    if (applied && evidence !== undefined)
      apply(`hypotheses[${index}].evidence`, { hypotheses: [{ key: item.key, evidence }] });
  }
  for (const [index, item] of (params.tests ?? []).entries()) apply(`tests[${index}]`, { tests: [item] });
  for (const [index, item] of (params.strategies ?? []).entries()) apply(`strategies[${index}]`, { strategies: [item] });
  if (!rows.length && !skipped.length) return { ok: false, error: 'memory call had nothing to change' };
  return { ok: true, rows: rows.map(row => ({...row, at:actionCount})), receipt: [...receipts, ...skipped.map(s => 'not applied: ' + s)].join('\n') };
}
