/** Small, pure policy helpers for exposing action cost and bounding unverified batches. */
export const ACTION_EFFICIENCY_ENABLED = process.env.ARC_THIN_ACTION_EFFICIENCY !== '0';
export const UNVERIFIED_BATCH_MAX = (() => {
  const value = Number(process.env.ARC_THIN_UNVERIFIED_BATCH_MAX ?? 4);
  return Number.isInteger(value) ? Math.min(4, Math.max(1, value)) : 4;
})();

/** A completed level's recorded winning sequence is an executable route when the review carries its mechanism. */
export function carriedReviewRoute(lessons: string, winningActions: Array<{ action: string; x?: number; y?: number; level_changed?: boolean; state?: string }>): string[] {
  if (!/Mechanism\s*\(confirmed\)/i.test(lessons) || !/Carried to Level\s+\d+/i.test(lessons)) return [];
  let end = -1;
  for (let index = winningActions.length - 1; index >= 0; index -= 1) {
    if (winningActions[index].level_changed) { end = index; break; }
  }
  if (end < 0) return [];
  let start = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (winningActions[index].level_changed || winningActions[index].action === 'RESET' || winningActions[index].state === 'GAME_OVER') {
      start = index + 1; break;
    }
  }
  return winningActions.slice(start, end + 1).map(({ action, x, y }) =>
    x !== undefined && y !== undefined ? `${action}(${x},${y})` : action);
}

export function executionRouteReady(confirmedMechanism: boolean, routeActions: number): boolean {
  return confirmedMechanism && Number.isInteger(routeActions) && routeActions > 0;
}

export function shouldDeferExplorationPin(executionReady: boolean): boolean {
  return ACTION_EFFICIENCY_ENABLED && executionReady;
}

export function actionBatchLimit(verifiedReplay: boolean, defaultMax = UNVERIFIED_BATCH_MAX): number {
  return verifiedReplay ? 24 : Math.min(4, Math.max(1, Math.floor(defaultMax)));
}

export function isVerifiedReplay(actions: Array<{ action: string; x?: number; y?: number }>, history: Array<{
  action: string; x?: number; y?: number; level_changed?: boolean; levels_completed?: number;
}>): boolean {
  if (actions.length <= 4) return false;
  return verifiedReplayPrefix(actions, history);
}

export function verifiedReplayPrefix(actions: Array<{ action: string; x?: number; y?: number }>, history: Array<{
  action: string; x?: number; y?: number; level_changed?: boolean; levels_completed?: number;
}>): boolean {
  if (actions.length <= 4) return false;
  const same = (a: { action: string; x?: number; y?: number }, b: { action: string; x?: number; y?: number }) =>
    a.action === b.action && a.x === b.x && a.y === b.y;
  for (let start = 0; start + actions.length <= history.length; start += 1) {
    const segment = history.slice(start, start + actions.length);
    if (!segment.every((row, index) => same(row, actions[index]))) continue;
    if (history.slice(start + actions.length - 1, start + actions.length + 24).some((row) => row.level_changed)) return true;
  }
  return false;
}

export function actionBudgetWithBaseline(rowBudget: any, currentBudget: any, rowLevel: number, levelChanged: boolean): any {
  return {
    ...(rowBudget ?? {}),
    baseline_actions: rowBudget?.baseline_actions ?? currentBudget?.baseline_actions,
    level: rowBudget?.level ?? Math.max(0, rowLevel - (levelChanged ? 1 : 0)),
  };
}

export function actionBudgetText(budget: any): string {
  const used = typeof budget?.used === 'number' ? budget.used : undefined;
  const baselines = budget?.baseline_actions;
  const level = Number.isInteger(budget?.level) ? budget.level : 0;
  const baseline = Array.isArray(baselines) && typeof baselines[level] === 'number' ? baselines[level] : undefined;
  const parts = [used === undefined ? 'actions_used=?' : `actions_used=${used}`];
  if (baseline !== undefined && baseline > 0) {
    parts.push(`baseline=${baseline}`, `used_vs_baseline=${(used! / baseline).toFixed(2)}x`);
  }
  if (typeof budget?.maximum === 'number') parts.push(`level_cap=${budget.maximum}`);
  if (typeof budget?.total_used === 'number' && typeof budget?.total_maximum === 'number')
    parts.push(`run=${budget.total_used}/${budget.total_maximum}`);
  if (Number.isInteger(budget?.attempt)) parts.push(`attempt=${budget.attempt}`);
  if (Number.isInteger(budget?.prev_level_actions)) parts.push(`prev_level_actions=${budget.prev_level_actions}`);
  return parts.join(' ');
}

export function resetCostText(budget: any, replayedSinceReset: number): string {
  const cost = typeof budget?.used === 'number' ? budget.used : undefined;
  return `RESET cumulative_level_cost=${cost ?? '?'}; actions_since_reset=${replayedSinceReset}`;
}

export function knownResetReplay(history: Array<{ action: string; x?: number; y?: number; novelty?: string }>): boolean {
  let reset = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].action === 'RESET') { reset = index; break; }
  }
  const replay = history.slice(reset + 1).filter((row) => row.action !== 'RESET');
  if (reset < 0 || replay.length < 2) return false;
  const same = (a: typeof replay[number], b: typeof replay[number]) => a.action === b.action && a.x === b.x && a.y === b.y;
  for (let start = 0; start + replay.length <= reset; start += 1) {
    if (replay.every((row, offset) => same(row, history[start + offset]))) return true;
  }
  return false;
}
