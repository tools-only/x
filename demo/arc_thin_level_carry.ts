/** Pure typed carry from a completed level. No prose inference or model calls. */
import { createHash } from 'node:crypto';
import { claimVersion } from './arc_thin_claims.ts';
export type CarryMode = 'off' | 'shadow' | 'on';
export type PieceKind = 'goal' | 'check' | 'view' | 'rule' | 'operator' | 'attempt';
export type PieceState = 'prior' | 'held' | 'changed' | 'dropped' | 'new';
export type GoalVerdict = 'win_held' | 'false_win' | 'missed_win' | 'quiet';
export type BackStanding = { level: number; win_n: number; standing: 'explains' | 'contradicts' | 'silent'; n?: number; verdict?: GoalVerdict };
export type CarryPiece = { ref: string; kind: PieceKind; from: { level: number; evidence: string }; state: PieceState;
  at?: number; line?: string; cites?: string[]; back?: BackStanding };
export type LevelCarry = { from_level: number; to_level: number; win: { n: number; action: string };
  cost: { actions: number; resets: number; game_overs: number }; pieces: CarryPiece[] };
export type CarryDelta = { at: number; level: number; ref: string; kind: PieceKind; from: PieceState; to: PieceState; why: string };
export type CarryInput = { trajectory: any[]; memoryRows: any[]; claimRows: any[]; goalRows: any[]; observerRuns: any[]; effects?: any[]; rulesText: string };
export const HELD_MIN = 3, CHANGED_MIN = 2, CARRY_CHARS = 900;
const actionLabel = (row: any) => row.action === 'ACTION6' && row.x !== undefined ? `ACTION6(${row.x},${row.y})` : row.action;
const renderedActionLabel = (row: any) => row.action === 'ACTION6' && row.x !== undefined ? `ACTION6 ${row.x},${row.y}` : row.action;
const levelOf = (row: any) => Number(row.level ?? row.levels_before ?? (Number(row.levels_completed ?? 0) - (row.level_changed ? 1 : 0)));
const hypOf = (row: any) => row.hyp ?? row.hypothesis;
const hash8 = (line: string) => createHash('sha256').update(line).digest('hex').slice(0, 8);
const nOf = (row: any) => Number(String(row.key ?? '').split('@').at(-1));
export function ruleScope(line: string): number | undefined {
  const match = /^\s*-\s+Level\s+(\d+)(?:\s+\([^)]*\))?\s*:/i.exec(line);
  return match ? Number(match[1]) - 1 : undefined;
}
const ruleCites = (line: string) => [...line.matchAll(/\(hyp\.([A-Za-z0-9_.-]+)\)/g)].map(match => `hyp.${match[1]}`);
const latestMemory = (rows: any[], through: number) => {
  const latest = new Map<string, any>();
  for (const row of rows) if (row.key && Number(row.at ?? 0) <= through) latest.set(row.key, row);
  return latest;
};

export function buildLevelCarry(input: CarryInput, level: number): LevelCarry {
  const winRow = input.trajectory.find(row => row.level_changed && levelOf(row) === level);
  if (!winRow) throw Error(`no level change recorded for level ${level + 1}`);
  const winN = Number(winRow.n);
  const fromRows = input.trajectory.filter(row => levelOf(row) === level && Number(row.n) <= winN);
  const pieces: CarryPiece[] = [];
  const live = latestMemory(input.memoryRows, winN);
  for (const [key, event] of live) {
    const hyp = hypOf(event);
    if (event.deleted || !hyp || hyp.status === 'rejected' || !hyp.check) continue;
    const version = claimVersion(hyp.check);
    const rows = input.claimRows.filter(row => row.key === key && row.version === version && row.level === level && Number(row.n) <= winN);
    if (!rows.length) continue;
    const goal = String(hyp.question ?? '').trim().toLowerCase() === 'goal';
    if (goal) {
      const standing = input.goalRows.filter(row => row.key === key && row.version === version && row.level === level && Number(row.n) <= winN);
      if (standing.some(row => row.n === winN && row.verdict === 'win_held') && !standing.some(row => row.verdict === 'false_win' || row.verdict === 'missed_win'))
        pieces.push({ ref: `${key}@${version}`, kind: 'goal', from: { level, evidence: `win_held #${winN}` }, state: 'prior',
          back: { level, win_n: winN, standing: 'explains', n: winN, verdict: 'win_held' } });
    }
    pieces.push({ ref: `${key}@${version}`, kind: 'check', from: { level, evidence: `holds ${rows.filter(row => row.result === true).length} fails ${rows.filter(row => row.result === false || row.result === 'error').length}` }, state: 'prior' });
  }
  const tools = new Map<string, number>();
  for (const row of input.observerRuns.filter(item => {
    const n = nOf(item); const transition = input.trajectory.find(t => Number(t.n) === n);
    return n <= winN && transition && levelOf(transition) === level;
  })) {
    const path = String(row.key ?? '').split('@')[0];
    if (!path.startsWith('tools/')) continue;
    tools.set(path, Math.max(tools.get(path) ?? 0, Number(row.version ?? pathVersion(path, input.observerRuns)) || 1));
  }
  for (const [path, version] of tools) {
    const ref = `${path}@${version}`;
    const runs = input.observerRuns.filter(row => {
      if (!String(row.key ?? '').startsWith(`${path}@`)) return false;
      const n = nOf(row); const transition = input.trajectory.find(t => Number(t.n) === n);
      return n <= winN && transition && levelOf(transition) === level;
    });
    const ok = runs.filter(row => row.ok).length, errors = runs.filter(row => !row.ok).length;
    pieces.push({ ref, kind: 'view', from: { level, evidence: `ran ${ok} ok ${errors} errors` }, state: 'prior' });
  }
  for (const line of input.rulesText.split(/\r?\n/)) {
    if (ruleScope(line) !== level || !line.trim()) continue;
    pieces.push({ ref: `rule:${hash8(line)}`, kind: 'rule', from: { level, evidence: 'scoped rule' }, state: 'prior', line: line.slice(0, 160), cites: ruleCites(line) });
  }
  const lastAttemptStart = Math.max(-1, ...fromRows.filter(row => (row.action === 'RESET' || row.state === 'GAME_OVER') && Number(row.n) < winN).map(row => Number(row.n)));
  const effects = (input.effects ?? []).filter(row => row.level === level && row.n > lastAttemptStart && row.n <= winN);
  const operators = new Set(effects.map(row => `${row.kind}:${row.dest ?? 'none'}`));
  const steps = effects.flatMap(row => row.steps ?? []).filter((step: unknown) => typeof step === 'number');
  const bins = Object.fromEntries(['0','1','2-3','4-7','8-15','16+','unplaced'].map(bin => [bin, effects.filter(row => row.targetBin === bin).length]));
  pieces.push({ ref: `operator:${level + 1}`, kind: 'operator', from: { level, evidence: JSON.stringify({ effects: Object.fromEntries([...new Set(effects.map(row => row.kind))].map(kind => [kind, effects.filter(row => row.kind === kind).length])), classes: operators.size, step_median: steps.length ? steps.sort((a:number,b:number)=>a-b)[Math.floor(steps.length/2)] : null, bins }) }, state: 'prior' });
  const attemptBoundaries = fromRows.filter(row => row.action === 'RESET' || row.state === 'GAME_OVER').length;
  const attempts = Math.max(1, attemptBoundaries + (fromRows[0]?.action === 'RESET' ? 0 : 1));
  pieces.push({ ref: `attempt:${level + 1}`, kind: 'attempt', from: { level, evidence: `${attempts} attempt(s); ${fromRows.filter(row => row.action === 'RESET').length} reset(s)` }, state: 'prior' });
  return { from_level: level, to_level: level + 1, win: { n: winN, action: actionLabel(winRow) },
    cost: { actions: fromRows.length, resets: fromRows.filter(row => row.action === 'RESET').length,
      game_overs: fromRows.filter(row => row.state === 'GAME_OVER').length }, pieces };
}
function pathVersion(path: string, rows: any[]) { return Math.max(1, ...rows.filter(row => String(row.key).startsWith(`${path}@`)).map(row => Number(row.version) || 1)); }

function backStanding(rows: any[], piece: CarryPiece, carry: LevelCarry): BackStanding | undefined {
  const [key, version] = piece.ref.split('@');
  const prior = rows.filter(row => row.key === key && row.version === version && row.level === carry.from_level);
  const falseWin = prior.find(row => row.verdict === 'false_win');
  if (falseWin) return { level: carry.from_level, win_n: carry.win.n, standing: 'contradicts', n: Number(falseWin.n), verdict: 'false_win' };
  const atWin = prior.find(row => Number(row.n) === carry.win.n);
  if (!atWin) return undefined;
  if (atWin.error || atWin.met === null || atWin.met === undefined) return { level: carry.from_level, win_n: carry.win.n, standing: 'silent', n: carry.win.n, verdict: atWin.verdict };
  if (atWin.verdict === 'missed_win') return { level: carry.from_level, win_n: carry.win.n, standing: 'contradicts', n: carry.win.n, verdict: 'missed_win' };
  if (atWin.verdict === 'win_held') return { level: carry.from_level, win_n: carry.win.n, standing: 'explains', n: carry.win.n, verdict: 'win_held' };
  return undefined;
}

export function advanceCarry(carry: LevelCarry, input: CarryInput): { carry: LevelCarry; deltas: CarryDelta[] } {
  const level = carry.to_level, deltas: CarryDelta[] = [];
  const nextPieces = carry.pieces.map(piece => ({ ...piece }));
  const latest = latestMemory(input.memoryRows, Number(input.trajectory.at(-1)?.n ?? carry.win.n));
  const note = (piece: CarryPiece, to: PieceState, at: number, why: string) => {
    if (piece.state === to) return;
    const from = piece.state; piece.state = to; piece.at = at;
    deltas.push({ at, level, ref: piece.ref, kind: piece.kind, from, to, why });
  };
  for (const piece of nextPieces) {
    if (piece.state === 'dropped') continue;
    const key = piece.ref.split('@')[0], current = latest.get(key);
    if (current && (current.deleted || hypOf(current)?.status === 'rejected')) {
      note(piece, 'dropped', Number(current.at ?? input.trajectory.at(-1)?.n ?? 0), current.deleted ? 'deleted' : 'rejected');
      continue;
    }
    if (piece.kind === 'goal' || piece.kind === 'check') {
      const parts = piece.ref.split('@'), hypKey = parts[0], version = parts[1];
      const rows = (piece.kind === 'goal' ? input.goalRows : input.claimRows).filter(row => row.key === hypKey && row.version === version && row.level === level);
      if (piece.kind === 'goal' && piece.state === 'new' && current && hypOf(current)?.check && claimVersion(hypOf(current).check) === version) {
        const back = backStanding(input.goalRows, piece, carry);
        if (back && !piece.back) {
          piece.back = back;
          const at = Number(current.at ?? input.trajectory.at(-1)?.n ?? 0);
          const reason = back.standing === 'explains' ? 'explains the level-' + (back.level + 1) + ' win at #' + back.win_n + ' (' + carry.win.action.replace(/^ACTION6\((\d+),(\d+)\)$/, 'ACTION6 $1,$2') + ')'
            : back.standing === 'contradicts' ? (back.verdict === 'false_win' ? 'false win' : 'missed win') + ' on level ' + (back.level + 1) + ' at #' + back.n
              : 'silent on level ' + (back.level + 1);
          if (!deltas.some(delta => delta.ref === piece.ref && delta.to === 'new'))
            deltas.push({ at, level, ref: piece.ref, kind: piece.kind, from: 'prior', to: 'new', why: reason });
        }
      } else if (piece.kind === 'goal') {
        const held = rows.find(row => row.verdict === 'win_held');
        const falsified = rows.find(row => row.verdict === 'false_win' || row.verdict === 'missed_win');
        if (held) note(piece, 'held', held.n, 'predicted level change at #' + held.n);
        else if (falsified) note(piece, 'changed', falsified.n, falsified.verdict + ' at #' + falsified.n);
      } else {
        const decided = rows.filter(row => row.result === true || row.result === false);
        const fails = decided.filter(row => row.result === false).length;
        if (decided.length >= HELD_MIN && fails === 0) note(piece, 'held', decided.at(-1)!.n, 'holds ' + decided.length + ' of ' + decided.length + ' on level ' + (level + 1));
        else if (fails >= CHANGED_MIN && fails > decided.length - fails) note(piece, 'changed', decided.filter(row => row.result === false).at(-1)!.n, 'fails ' + fails + ' of ' + decided.length + ' on level ' + (level + 1));
      }
    } else if (piece.kind === 'view') {
      const path = piece.ref.split('@')[0];
      const levelRows = input.observerRuns.filter(row => {
        if (!String(row.key ?? '').startsWith(path + '@')) return false;
        const n = nOf(row), tr = input.trajectory.find(t => Number(t.n) === n);
        return tr && levelOf(tr) === level;
      });
      const firstOk = levelRows.find(row => row.ok);
      // Execution success is not evidence that the view's meaning carries to this level.
      // Keep it reviewable as prior evidence; applicability remains the parent's decision.
      if (firstOk && piece.state === 'prior') piece.at = nOf(firstOk);
    }
  }
  const priorViews = new Set(nextPieces.filter(piece => piece.kind === 'view').map(piece => piece.ref.split('@')[0]));
  const newViews = new Map<string, any>();
  for (const row of input.observerRuns) {
    const key = String(row.key ?? ''), path = key.split('@')[0], n = nOf(row);
    const transition = input.trajectory.find(item => Number(item.n) === n);
    if (!path.startsWith('tools/') || !transition || levelOf(transition) !== level || priorViews.has(path)) continue;
    if (!newViews.has(path) || n < Number(newViews.get(path).n)) newViews.set(path, { ...row, n });
  }
  for (const [path, row] of newViews) {
    const piece: CarryPiece = { ref: path + '@' + (Number(row.version) || 1), kind: 'view',
      from: { level, evidence: 'first run at #' + row.n }, state: 'new', at: row.n };
    nextPieces.push(piece);
    deltas.push({ at: row.n, level, ref: piece.ref, kind: 'view', from: 'prior', to: 'new', why: 'first run on this level' });
  }
  const seenKeys = new Set(nextPieces.map(piece => piece.ref.split('@')[0]));
  for (const [key, row] of latest) {
    const hyp = hypOf(row);
    if (!key.startsWith('hyp.') || !hyp || row.deleted || hyp.status === 'rejected' || Number(row.at ?? 0) <= carry.win.n || seenKeys.has(key)) continue;
    const kind: PieceKind = String(hyp.question ?? '').trim().toLowerCase() === 'goal' ? 'goal' : 'check';
    const version = hyp.check ? claimVersion(hyp.check) : '1';
    const piece: CarryPiece = { ref: key + '@' + version, kind, from: { level, evidence: 'written at #' + row.at }, state: 'new', at: Number(row.at) };
    nextPieces.push(piece); seenKeys.add(key);
    if (kind !== 'goal' || !hyp.check) deltas.push({ at: piece.at!, level, ref: piece.ref, kind, from: 'prior', to: 'new', why: 'first written on this level' });
    else {
      const back = backStanding(input.goalRows, piece, carry);
      if (back) {
        piece.back = back;
        const reason = back.standing === 'explains' ? 'explains the level-' + (back.level + 1) + ' win at #' + back.win_n + ' (' + carry.win.action.replace(/^ACTION6\((\d+),(\d+)\)$/, 'ACTION6 $1,$2') + ')'
          : back.standing === 'contradicts' ? (back.verdict === 'false_win' ? 'false win' : 'missed win') + ' on level ' + (back.level + 1) + ' at #' + back.n
            : 'silent on level ' + (back.level + 1);
        deltas.push({ at: piece.at!, level, ref: piece.ref, kind, from: 'prior', to: 'new', why: reason });
      }
    }
  }
  return { carry: { ...carry, pieces: nextPieces }, deltas };
}
export function renderCarry(carry: LevelCarry, maxChars = CARRY_CHARS): string {
  const lines = ['CARRIED FROM LEVEL ' + (carry.from_level + 1) + ' (won at #' + carry.win.n + ' by ' + carry.win.action + '; ' + carry.cost.actions + ' actions, ' + carry.cost.resets + ' RESET, ' + carry.cost.game_overs + ' GAME_OVER) — base; level-' + (carry.to_level + 1) + ' changes arrive in receipts:'];
  if (!carry.pieces.some(piece => piece.kind === 'goal')) lines.push('- goal: none carried — no goal check predicted the level-' + (carry.from_level + 1) + ' win (#' + carry.win.n + ')');
  const winAction = carry.win.action.replace(/^ACTION6\((\d+),(\d+)\)$/, 'ACTION6 $1,$2');
  for (const piece of carry.pieces) {
    const name = piece.ref.split('@')[0];
    if (piece.kind === 'goal' && piece.state === 'new' && piece.back) {
      const back = piece.back;
      const suffix = back.standing === 'explains' ? 'explains the level-' + (back.level + 1) + ' win at #' + back.win_n + ' (' + winAction + ')'
        : back.standing === 'contradicts' ? 'contradicts: ' + (back.verdict === 'false_win' ? 'false win' : 'missed the') + ' level-' + (back.level + 1) + ' win at #' + back.n
          : 'silent on level ' + (back.level + 1);
      lines.push('- goal ' + name + ': new -- ' + suffix);
    } else if (piece.kind === 'goal') lines.push('- goal ' + name + ': ' + piece.from.evidence + ' → ' + piece.state);
    else if (piece.kind === 'check') lines.push('- check ' + name + ': level ' + (carry.from_level + 1) + ' ' + piece.from.evidence + ' → level ' + (carry.to_level + 1) + ': ' + piece.state.toUpperCase() + (piece.at ? ' at #' + piece.at : ''));
    else if (piece.kind === 'view') lines.push('- view ' + name + ': level ' + (carry.from_level + 1) + ' ' + piece.from.evidence + ' → level ' + (carry.to_level + 1) + ': ' + piece.state);
    else if (piece.kind === 'rule') lines.push('- rule "' + (piece.line ?? '') + '" (' + (piece.cites?.join(', ') ?? 'uncited') + '): ' + piece.state);
    else lines.push('- ' + piece.kind + ': ' + piece.from.evidence);
  }
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - 1)) + '…';
  return text;
}
export function renderDeltas(deltas: CarryDelta[]): string {
  return deltas.map(delta => 'CARRY DELTA (level ' + (delta.level + 1) + '): ' + delta.kind + ' ' + delta.ref + ' ' + delta.to + ' — ' + delta.why).join('\n');
}
export function partitionRules(rules: string, carry: LevelCarry, level: number): { rules: string; carried: string; counts: Record<string, number> } {
  const kept: string[] = [], carried: string[] = [];
  for (const line of rules.split(/\r?\n/)) {
    const scope = ruleScope(line);
    if (scope === undefined || scope >= level) { if (line) kept.push(line); continue; }
    const cites = ruleCites(line);
    const check = cites.map(ref => carry.pieces.find(item => item.kind === 'check' && item.ref.startsWith(ref + '@'))).find(Boolean);
    if (check?.state === 'held') kept.push(line + ' [held on level ' + (level + 1) + ': ' + (check.at ?? 0) + ']');
    else if (check?.state === 'changed') carried.push(line + ' [fails on level ' + (level + 1) + ' since #' + (check.at ?? 0) + ']');
    else carried.push(line + ' [carried from level ' + (scope + 1) + ' (prior; not checked here)]');
  }
  return { rules: kept.join('\n'), carried: carried.join('\n'), counts: { rules: kept.filter(Boolean).length, carried: carried.filter(Boolean).length } };
}
