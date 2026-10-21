/** Typed goal-check admission. The runtime records predictions; it never edits hypothesis status. */
export type GoalMode = 'off' | 'shadow' | 'on';
export const GOAL_QUESTION = 'goal';
export const GOAL_CHECK_HELP = 'For a goal hypothesis, add check(t) that predicts a level change from t.before and t.action.\n' +
  'A goal check cannot read the after grid or outcome fields.\n' +
  'Only a check that predicted a real level change supports the goal.';
export const goalHiddenFields = ['after', 'changed_cells', 'bbox', 'level_changed', 'state', 'levels_completed', 'budget', 'state_before', 'levels_before', 'grid_change', 'grid_delta', 'diff', 'outcome'] as const;
export type GoalCheckRow = { key: string; version: string; n: number; level: number; met: boolean | null; verdict: 'win_held' | 'false_win' | 'missed_win' | 'quiet'; error?: string };

export function goalVerdict(met: boolean | null, row: { level_changed?: boolean }): GoalCheckRow['verdict'] {
  if (met === true && row.level_changed) return 'win_held';
  if (met === true) return 'false_win';
  if (row.level_changed) return 'missed_win';
  return 'quiet';
}
export function goalStanding(rows: GoalCheckRow[], key: string, version: string, level: number): 'supported' | 'falsified' | 'untested' {
  const own = rows.filter(row => row.key === key && row.version === version && row.level === level);
  if (own.some(row => row.verdict === 'false_win' || row.verdict === 'missed_win')) return 'falsified';
  return own.some(row => row.verdict === 'win_held') ? 'supported' : 'untested';
}
export function goalSupportRefusal(key: string, hyp: { question?: string; status?: string; version?: string }, rows: GoalCheckRow[], level: number, win?: { level: number; n: number; action: string }): string | undefined {
  if (hyp.question?.trim().toLowerCase() !== GOAL_QUESTION || hyp.status !== 'supported') return undefined;
  const versions = hyp.version ? [hyp.version] : [...new Set(rows.filter(row => row.key === key).map(row => row.version))];
  const supported = versions.find(version => [...new Set(rows.filter(row => row.key === key && row.version === version).map(row => row.level))]
    .some(atLevel => goalStanding(rows, key, version, atLevel) === 'supported'));
  const currentFalsification = versions.map(version => ({ version, last: rows.filter(row => row.key === key && row.version === version && row.level === level && ['false_win','missed_win'].includes(row.verdict)).at(-1) }))
    .find(item => item.last);
  if (supported && !currentFalsification) return undefined;
  const falsified = versions.map(version => ({ version, last: rows.filter(row => row.key === key && row.version === version && row.level === level && ['false_win','missed_win'].includes(row.verdict)).at(-1) }))
    .find(item => item.last);
  return `goal hypotheses become supported only when their goal check predicted a real level change; ${key} has ` +
    (falsified ? `standing falsified on level ${level + 1} at #${falsified.last!.n}` : 'no goal check with a supported standing') +
    (win ? `; the previous level ${win.level + 1} win was #${win.n} (${win.action})` : '') +
    '. Retry with status "open", or add check(t) over the before grid and the action. A GAME_OVER condition is not the goal: give it another question.';
}
export const goalAdmissionMode = (value?: string): GoalMode => {
  if (value === undefined) return 'shadow';
  if (value !== 'off' && value !== 'shadow' && value !== 'on') throw Error('ARC_THIN_GOAL_ADMISSION must be off, shadow or on');
  return value;
};

export function recurringGoalCheckAsk(input: {
  mode: GoalMode; actions: number; noPrediction: boolean; hasLiveGoalCheck: boolean;
  levelStart: number; lastAskedAt: number; win?: { level: number; n: number; action: string };
}, after = 12): string | undefined {
  if (input.actions < after) return undefined;
  const due = input.mode === 'off' ? input.noPrediction : (input.noPrediction || !input.hasLiveGoalCheck);
  if (!due || !(input.lastAskedAt < input.levelStart || input.actions - input.lastAskedAt >= 2 * after)) return undefined;
  if (input.mode === 'off' || !input.win)
    return input.actions + ' actions on this level and no step predicted a level change (no goal test yet)';
  return input.actions + ' actions on this level and no live goal check: write question "goal" with check(t) over t.before and t.action; it is judged against the level-' +
    input.win.level + ' win at #' + input.win.n + ' (' + input.win.action + ') and every move on this level';
}

export function levelGoalCheckAsk(mode: GoalMode, win: { level: number; n: number; action: string }, hasWinningCheck: boolean): string | undefined {
  if (mode === 'off' || hasWinningCheck) return undefined;
  return 'no goal check predicted the win at #' + win.n + ' (' + win.action + '): write question "goal" with check(t) over t.before and t.action; it is judged against this win and every move on level ' + (win.level + 1);
}

export function formatGoalOutcome(row: Pick<GoalCheckRow, 'key' | 'verdict' | 'n' | 'level'>): string {
  return 'GOAL_OUTCOME ' + row.key + ': ' + row.verdict + ' at #' + row.n + ' (level ' + (row.level + 1) + ')';
}
