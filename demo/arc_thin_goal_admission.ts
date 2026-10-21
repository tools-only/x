/** Goal control-plane admission. Pure JSON/state transitions; no model, filesystem or check(t). */
export type GoalAdmissionMode = 'off' | 'shadow' | 'on';
export type GoalState = 'proposed' | 'under_test' | 'supported' | 'retired' | 'contested';
export type GoalAction = { action: string; x?: number; y?: number };
export type Observable = { state?: string; level_changed?: boolean; changed_cells?: number;
  cells?: Array<{ x: number; y: number; value: number }> };
export type GoalClaim = {
  id: string; level: number; claim: string; rivals: Array<{ claim: string; predicts: Observable }>;
  discriminating_move: { actions: GoalAction[]; predicts: Observable };
  kill_condition: Observable; terminal_risk?: { planned_actions: number; remaining_actions: number };
  goal_region?: Array<{ x: number; y: number }>; state: GoalState;
};
export type StatusMask = { rows: Set<number>; cols: Set<number>; ticker: Set<string> };
export type GoalRecord = { goal: GoalClaim; state: GoalState; progress: number; at: number;
  level_confirmed?: boolean; reason?: string; evidence_at?: number };
export type GoalOutcome = GoalAction & { n: number; level: number; state: string; level_changed: boolean;
  changed_cells?: number; after?: number[][]; predicted_level_change?: boolean };
export type Admission = { ok: boolean; wouldRefuse: boolean; reason?: string };
export const GOAL_TEST_MAX_ACTIONS = 4;
export const GOAL_ADMISSION_HELP = '\nGoal admission: strategy Next experiment / Route and rules goal lines cite [goal.<id>] and include one ```goal-claim JSON block. ' +
  'Fields: id (goal.<id>), level (zero-based), claim, rivals [{claim,predicts}], discriminating_move {actions:[{action,x?,y?}],predicts}, ' +
  'kill_condition, state:"proposed"; optional goal_region [{x,y}], terminal_risk {planned_actions,remaining_actions}. ' +
  'Observables: state, level_changed, changed_cells, cells:[{x,y,value}] (conjunction). Use incompatible claim/rival predictions. ' +
  'At most 4 test actions; runtime owns support. Route needs supported evidence on this level; rules goal lines need a confirmed level change and Level N (one-based). ' +
  'On refusal remove Route/goal text or revise the claim/test; read data/goal_claims.json for runtime states.';

export function goalAdmissionMode(value?: string): GoalAdmissionMode {
  if (value === undefined) return 'off';
  if (value !== 'off' && value !== 'shadow' && value !== 'on') throw Error('ARC_THIN_GOAL_ADMISSION must be off, shadow or on');
  return value;
}
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const coord = (v: any) => Number.isInteger(v) && v >= 0 && v < 64;
const text = (v: any) => typeof v === 'string' && v.trim().length > 0;
function observable(v: any): v is Observable {
  return object(v) && Object.keys(v).length > 0 && Object.keys(v).every(k => ['state', 'level_changed', 'changed_cells', 'cells'].includes(k))
    && (v.state === undefined || text(v.state)) && (v.level_changed === undefined || typeof v.level_changed === 'boolean')
    && (v.changed_cells === undefined || Number.isInteger(v.changed_cells) && v.changed_cells >= 0)
    && (v.cells === undefined || Array.isArray(v.cells) && v.cells.length > 0 && v.cells.every((c: any) => object(c) && coord(c.x) && coord(c.y) && Number.isInteger(c.value)))
    && (v.cells === undefined || new Set(v.cells.map((c: any) => `${c.x},${c.y}`)).size === v.cells.length);
}
/** Two conjunctions discriminate only if a common observable must disagree. */
export function discriminates(a: Observable, b: Observable): boolean {
  return (['state', 'level_changed', 'changed_cells'] as const).some(k => a[k] !== undefined && b[k] !== undefined && a[k] !== b[k])
    || Boolean(a.cells?.some(c => b.cells?.some(d => c.x === d.x && c.y === d.y && c.value !== d.value)));
}
export function overlapsStatus(region: Array<{ x: number; y: number }> = [], mask?: StatusMask): boolean {
  return Boolean(mask && region.some(({ x, y }) => mask.rows.has(y) || mask.cols.has(x) || mask.ticker.has(`${x},${y}`)));
}
export function refuseGoal(value: unknown, k = GOAL_TEST_MAX_ACTIONS): string | undefined {
  const g = value as GoalClaim;
  if (!object(g) || !/^goal\.[a-z0-9_.-]{1,40}$/i.test(g.id) || !Number.isInteger(g.level) || g.level < 0 || !text(g.claim)) return 'GoalClaim needs id goal.<name>, level and claim';
  if (!Array.isArray(g.rivals) || !g.rivals.length || g.rivals.some(r => !object(r) || !text(r.claim) || r.claim.trim() === g.claim.trim() || !observable(r.predicts))) return 'GoalClaim needs at least one rival with an observable prediction';
  const d = g.discriminating_move;
  if (!object(d) || !Array.isArray(d.actions) || !d.actions.length || d.actions.length > k || d.actions.some(a => !object(a)
    || !/^ACTION[1-7]$/.test(a.action) || (a.action === 'ACTION6' ? !coord(a.x) || !coord(a.y) : a.x !== undefined || a.y !== undefined))) return `discriminating_move needs 1-${k} valid actions`;
  if (!observable(d.predicts) || g.rivals.some(r => !discriminates(d.predicts, r.predicts))) return 'discriminating_move predictions must disagree with every rival on a common observable';
  if (!observable(g.kill_condition)) return 'kill_condition must name an observable';
  if (g.goal_region !== undefined && (!Array.isArray(g.goal_region) || !g.goal_region.length || g.goal_region.some(c => !object(c) || !coord(c.x) || !coord(c.y)))) return 'goal_region needs grid coordinates';
  if (g.terminal_risk !== undefined) {
    const r = g.terminal_risk;
    if (!object(r) || !Number.isInteger(r.planned_actions) || r.planned_actions < d.actions.length || !Number.isInteger(r.remaining_actions)
      || r.remaining_actions <= 0 || r.planned_actions >= r.remaining_actions) return 'terminal_risk: plan must cover the test and be shorter than estimated remaining actions';
  }
  if (!['proposed', 'under_test', 'supported', 'retired', 'contested'].includes(g.state)) return 'GoalClaim needs a valid state (runtime owns support)';
}
/** Definition excludes author state and id; renaming cannot erase counterevidence. */
function definition(g: GoalClaim): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const { level, claim, rivals, discriminating_move, kill_condition, goal_region } = g;
  return JSON.stringify(canonical({ level, claim, rivals, discriminating_move, kill_condition, goal_region }));
}
export function matches(p: Observable, o: GoalOutcome): boolean {
  return (p.state === undefined || p.state === o.state) && (p.level_changed === undefined || p.level_changed === o.level_changed)
    && (p.changed_cells === undefined || p.changed_cells === o.changed_cells)
    && (p.cells === undefined || p.cells.every(c => o.after?.[c.y]?.[c.x] === c.value));
}
export function falsify(r: GoalRecord, state: 'retired' | 'contested', reason: string, n: number): GoalRecord {
  return { ...r, goal: { ...r.goal, state }, state, progress: 0, reason, evidence_at: n };
}
/** Active claims receive feedback without scheduling, throttle or budget inputs. */
export function applyOutcome(r: GoalRecord, o: GoalOutcome): GoalRecord {
  if (r.goal.level !== o.level || r.state === 'retired' || r.state === 'contested') return r;
  if (o.state === 'GAME_OVER') return falsify(r, 'retired', 'GAME_OVER', o.n);
  if (matches(r.goal.kill_condition, o)) return falsify(r, 'retired', 'kill_condition hit', o.n);
  if (o.predicted_level_change === true && !o.level_changed) return falsify(r, 'contested', 'predicted level_change missed', o.n);
  if (o.action === 'RESET') return { ...r, progress: 0 };
  const actions = r.goal.discriminating_move.actions;
  const same = (a: GoalAction) => a.action === o.action && a.x === o.x && a.y === o.y;
  const progress = same(actions[r.progress] ?? actions[0]) ? r.progress + 1 : same(actions[0]) ? 1 : 0;
  if (progress !== actions.length) return { ...r, progress };
  const prediction = r.goal.discriminating_move.predicts;
  if (prediction.level_changed === true && !o.level_changed) return falsify(r, 'contested', 'discriminating level_change missed', o.n);
  if (!matches(prediction, o)) return falsify(r, 'contested', 'discriminating prediction missed', o.n);
  if (r.goal.rivals.some(v => matches(v.predicts, o))) return falsify(r, 'contested', 'rival not separated', o.n);
  return { ...r, goal: { ...r.goal, state: 'supported' }, state: 'supported', progress: 0, level_confirmed: r.level_confirmed || o.level_changed,
    reason: 'discriminating outcome observed', evidence_at: o.n };
}
const metadata = /```goal-claim[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
export function goalDocument(path: string, source: string): { protected: string; route: boolean; raw?: unknown; error?: string } {
  path = path.toLowerCase();
  if (!['prompts/strategy.md', 'prompts/rules.md'].includes(path)) return { protected: '', route: false };
  const blocks = [...source.matchAll(metadata)];
  const body = source.replace(metadata, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const lines = body.split(/\r?\n/).map(l => l.replace(/[*]{2}|__/g, '').replace(/^([ ]*)[-*][ ]+(?=(?:Next experiments?|Route)\b)/i, '$1'));
  const route = lines.some(l => /^\s*(?:#{1,6}\s*)?Route\b/i.test(l));
  let control: string[];
  if (path === 'prompts/strategy.md') {
    let section = false;
    control = lines.filter(l => {
      if (/^\s*(?:#{1,6}\s*)?(?:Next experiments?|Route)\b/i.test(l)) { section = true; return true; }
      if (/^\s*#{1,6}\s|^\s*(?:Open questions|Failure modes)\b/i.test(l)) section = false;
      return section && l.trim();
    });
    // An empty heading is a valid way to withdraw a plan.
    if (!control.some(l => l.replace(/^\s*(?:#{1,6}\s*)?(?:Next experiments?|Route)\s*:?\s*/i, '').trim())) control = [];
  } else control = lines.filter(l => /\b(goal|win|wins|winning|won|objective|level change|complete|completes|completion|victory|finish)\b|\bLevel\s+\d+\s*:/i.test(l));
  const result = { protected: control.join('\n').trim(), route };
  if (!result.protected) return result;
  if (blocks.length !== 1) return { ...result, error: 'protected control needs exactly one fenced goal-claim JSON block' };
  try { return { ...result, raw: JSON.parse(blocks[0][1]) }; }
  catch { return { ...result, error: 'goal-claim is not valid JSON' }; }
}

/** Callers persist snapshots in a runtime-owned append-only log. */
export class GoalAdmission {
  readonly records = new Map<string, GoalRecord>();
  constructor(readonly mode: GoalAdmissionMode, seed: GoalRecord[] = []) {
    for (const r of seed) this.records.set(r.goal.id, r);
  }
  private verdict(reason?: string): Admission { return { ok: this.mode !== 'on' || !reason, wouldRefuse: Boolean(reason), ...(reason ? { reason } : {}) }; }
  admit(path: string, source: string, level: number, at: number, mask?: StatusMask): Admission {
    path = path.toLowerCase();
    if (this.mode === 'off') return this.verdict();
    const doc = goalDocument(path, source);
    if (!doc.protected) return this.verdict();
    let reason = doc.error ?? refuseGoal(doc.raw);
    if (reason) return this.verdict(reason);
    const g = doc.raw as GoalClaim;
    const old = this.records.get(g.id);
    const equivalents = [...this.records.values()].filter(r => definition(r.goal) === definition(g));
    const equivalent = equivalents[0];
    const known = equivalents.find(r => r.state === 'retired' || r.state === 'contested') ?? old ?? equivalent;
    if (old && definition(old.goal) !== definition(g)) reason = 'claim definition changed: use a new id';
    else if (known?.state === 'retired' || known?.state === 'contested') reason = `${known.goal.id} is ${known.state}: revise or abandon this claim`;
    else if (!doc.protected.includes(`[${g.id}]`)) reason = `protected control must cite [${g.id}]`;
    else if (path === 'prompts/strategy.md' && g.level !== level) reason = 'strategy claim belongs to a different level';
    // TODO: prose-only spatial targets have no reliable coordinates; P0 checks declared regions/cell predictions.
    else if (overlapsStatus(g.goal_region ?? g.discriminating_move.predicts.cells, mask) && !known?.level_confirmed) reason = 'goal overlaps a busy line/ticker without level-change confirmation';
    else if (doc.route && (known?.state !== 'supported' || g.level !== level || doc.protected.split(String.fromCharCode(10)).filter(l => /^ *([#]{1,6} *)?Route\b/i.test(l)).some(l => !l.includes(`[${g.id}]`)))) reason = 'Route requires a runtime-supported claim on this level and its [goal.id] citation';
    else if (path === 'prompts/rules.md' && (!known?.level_confirmed || known.state !== 'supported'
      || doc.protected.split(String.fromCharCode(10)).some(l => !l.includes(`[${g.id}]`) || Number(/Level\s+(\d+)\s*:/i.exec(l)?.[1]) !== g.level + 1))) reason = 'rules goal lines require supported level-change evidence, their [goal.id], and Level N scope';
    if (!reason || this.mode === 'shadow') {
      if (!old && !equivalent) this.records.set(g.id, { goal: { ...g, state: 'under_test' }, state: 'under_test', progress: 0, at });
      else if (!old && equivalent) this.records.set(g.id, { ...equivalent, goal: { ...g, state: equivalent.state } });
    }
    return this.verdict(reason);
  }
  route(path: string, source: string, level: number, mask?: StatusMask): Admission {
    if (this.mode === 'off' || !goalDocument(path, source).route) return this.verdict();
    return this.admit(path, source, level, 0, mask);
  }
  outcome(ids: string[], outcome: GoalOutcome): GoalRecord[] {
    if (this.mode === 'off') return [];
    const changed: GoalRecord[] = [];
    for (const id of new Set(ids)) {
      const r = this.records.get(id);
      if (!r) continue;
      const next = applyOutcome(r, outcome);
      if (JSON.stringify(next) !== JSON.stringify(r)) { this.records.set(id, next); changed.push(next); }
    }
    return changed;
  }
}
