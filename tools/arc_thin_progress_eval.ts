/**
 * Progress measures of thin ARC runs, with the ledger's meter-line detection applied the same way to every run,
 * whatever flags the run itself had (E1, docs/plans/2026-10-15-r03b-simple-context-plan.md): of the actions after the
 * fork point, how many changed nothing, or nothing apart from recurring cells (ticker cells and meter lines); batches
 * and what stopped them; actions until the first level change; cost and time.
 *
 * Usage: node --experimental-transform-types tools/arc_thin_progress_eval.ts <run dir> [<run dir> ...]
 * A run dir is a pilot output (holding arc-run/) or an arc-run directory. Read-only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLedger, lineLabel, meterLines, type LedgerRow } from '../demo/arc_thin_ledger.ts';
import { levelOf } from '../demo/arc_thin_claims.ts';

const rows = (path: string): any[] => existsSync(path)
  ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
  : [];
const json = (path: string): any => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

/** What stopped a batch, by kind (action_sequences.jsonl `stopped`). */
const stopKind = (stopped: unknown) => {
  const text = String(stopped ?? '');
  return !stopped ? 'played all'
    : /share of the budget|limit of \d+ actions/.test(text) ? 'act share'
    : /level changed/.test(text) ? 'level change'
    : /^state /.test(text) ? 'game end'
    : /prediction missed/.test(text) ? 'prediction missed'
    : /changed nothing$/.test(text) ? 'changed nothing'
    : /changed only cells/.test(text) ? 'only recurring cells'
    : /brought back/.test(text) ? 'earlier state'
    : /not currently available/.test(text) ? 'refusal'
    : /environment/.test(text) ? 'environment'
    : 'other';
};

export function report(dir: string) {
  const root = existsSync(join(dir, 'arc-run')) ? join(dir, 'arc-run') : dir;
  const harness = join(root, 'harness');
  const config = json(join(root, 'run-config.json'));
  const summary = json(join(root, 'summary.json'));
  const fork = config.fork ?? summary.fork ?? null;
  const from = Number(fork?.actions ?? 0);
  const trajectory: LedgerRow[] = rows(join(harness, 'trajectory.jsonl'));
  const grids = new Map<number, number[][]>();
  for (const row of rows(join(harness, 'states.jsonl'))) if (Array.isArray(row.grid)) grids.set(Number(row.n), row.grid);
  const state = buildLedger(trajectory, [], grids, { lines: true });
  const after = state.rows.filter((row) => row.n > from);
  const quiet = after.filter((row) => row.changed_cells === 0).length;
  const recurring = after.filter((row) => row.changed_cells !== 0 && row.action !== 'RESET' && row.before_hash && row.before_hash === row.after_hash).length;
  const levels = new Map<number, LedgerRow[]>();
  for (const row of trajectory) levels.set(levelOf(row), [...(levels.get(levelOf(row)) ?? []), row]);
  const lines = [...levels].map(([level, group]) => ({ level, lines: meterLines(group, grids).map((line) => `${lineLabel(line)} since #${line.since}`) }))
    .filter((item) => item.lines.length);
  const startLevel = from ? Number(trajectory.find((row) => row.n === from)?.levels_completed ?? 0) : 0;
  const firstChange = after.find((row) => row.level_changed);
  const batches = rows(join(harness, 'action_sequences.jsonl')).filter((row) => Number(row.n) > from);
  const stops: Record<string, number> = {};
  for (const row of batches) stops[stopKind(row.stopped)] = (stops[stopKind(row.stopped)] ?? 0) + 1;
  const python = rows(join(harness, 'played_actions.jsonl')).filter((row) => Number(row.n) > from);
  const usage = rows(join(harness, 'usage.jsonl'));
  const budget = usage.reduce((sum, row) => sum + Number(row.input ?? 0) + Number(row.output ?? 0), 0) - Number(fork?.prefix_budget_tokens ?? 0);
  const decisions = new Set(rows(join(harness, 'context_budget.jsonl')).map((row) => row.decision).filter((d) => d !== undefined && d !== null));
  const forkDecision = Number(fork?.decision ?? 0);
  const newDecisions = [...decisions].filter((d) => Number(d) > forkDecision).length;
  const n = after.length;
  return {
    run: dir, flags: config.extension_env ?? {}, fork: fork ? { source: fork.source, decision: fork.decision, actions: from } : null,
    stop_reason: summary.stop_reason ?? null, elapsed_seconds: summary.elapsed_seconds ?? null,
    actions: n, decisions: newDecisions, actions_per_decision: newDecisions ? Math.round((n / newDecisions) * 100) / 100 : null,
    levels: { at_fork: startLevel, end: Number(trajectory.at(-1)?.levels_completed ?? startLevel),
      first_change_after: firstChange ? firstChange.n - from : null },
    no_change: { nothing: quiet, only_recurring: recurring, share: n ? Math.round(((quiet + recurring) / n) * 1000) / 1000 : null },
    meter_lines: lines,
    batches: { calls: batches.length, planned: batches.reduce((s, r) => s + Number(r.planned ?? 0), 0),
      played: batches.reduce((s, r) => s + Number(r.played ?? 0), 0), stopped_by: stops },
    python_actions: { actions: python.length, without_progress: python.filter((row) => row.progress === false).length },
    budget_tokens: budget, budget_tokens_per_action: n ? Math.round(budget / n) : null,
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('arc_thin_progress_eval.ts')) {
  for (const dir of process.argv.slice(2)) console.log(JSON.stringify(report(dir), null, 2));
}
