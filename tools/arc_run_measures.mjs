// Measures of finished or running ARC runs (r04 development loop; from the su15 level-2 loop's l1-measures and
// level-spend scripts): per run its levels and actions per level, budget tokens, GAME_OVERs, RESETs, the longest streak of
// one action repeated while changing at most 2 cells, provider errors, environment restarts, how often the guards fired
// (refusals of a repeat without effect, of an unavailable action, decisions ended by the loop guard), and per level how
// the actions were played (single, then steps, by code) and how many click steps moved one cell.
// Usage: node tools/arc_run_measures.mjs <runs dir> <label> [<label> ...]    (a run is <runs dir>/<label>/arc-run)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, ...labels] = process.argv.slice(2);
const read = (path) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const name = (row) => row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;
const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
  .filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n');

function levels(rows) {
  const out = [];
  let part = [];
  for (const row of rows) {
    part.push(row);
    if (row.level_changed) { out.push({ rows: part, done: true }); part = []; }
  }
  if (part.length) out.push({ rows: part, done: false });
  return out.map(({ rows: played, done }, i) => {
    const then = played.filter((row) => /^then \d+ of \d+$/.test(String(row.note ?? ''))).length;
    const code = played.filter((row) => row.via).length;
    const steps = [];
    for (let k = 1; k < played.length; k++) {
      const a = played[k - 1], b = played[k];
      if (a.x !== undefined && b.x !== undefined) steps.push(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    }
    return { level: i + 1, done, actions: played.length, decisions: new Set(played.map((row) => row.decision)).size,
      single: played.length - then - code, then, code, resets: played.filter((row) => row.action === 'RESET').length,
      game_overs: played.filter((row) => row.state === 'GAME_OVER').length,
      one_cell_click_steps: steps.filter((s) => s === 1).length, click_steps: steps.length };
  });
}

const out = [];
for (const label of labels) {
  const root = join(base, label, 'arc-run');
  const summary = existsSync(join(root, 'summary.json')) ? JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8')) : { partial: true };
  const rows = read(join(root, 'harness', 'trajectory.jsonl'));
  const changes = rows.filter((row) => row.level_changed).map((row) => row.n);
  let longest = { length: 0 }, current = { length: 0 };
  for (const row of rows) {
    const still = typeof row.changed_cells === 'number' && row.changed_cells <= 2;
    current = still && current.length && current.action === name(row) ? { ...current, length: current.length + 1, to: row.n }
      : still ? { action: name(row), length: 1, from: row.n, to: row.n } : { length: 0 };
    if (current.length > longest.length) longest = current;
  }
  const usage = read(join(root, 'harness', 'usage.jsonl'));
  const tokens = (kind) => usage.filter((row) => !kind || row.kind === kind).reduce((sum, row) => sum + Number(row.input || 0) + Number(row.output || 0), 0);
  const results = read(join(root, 'session.jsonl')).filter((entry) => entry?.message?.role === 'toolResult').map((entry) => textOf(entry.message));
  const refiner = read(join(root, 'harness', 'refiner.jsonl'));
  out.push({
    label, stop: summary.stop_reason ?? 'running', actions: rows.length, levels: rows.at(-1)?.levels_completed ?? 0, level_changes: changes,
    budget_tokens: tokens(), refiner_tokens: tokens('refiner'),
    game_overs: rows.filter((row) => row.state === 'GAME_OVER').length, resets: rows.filter((row) => row.action === 'RESET').length,
    longest_still_streak: longest, provider_errors: summary.provider_errors ?? null, restarts: (summary.environment_restarts ?? []).length,
    refused_no_effect: results.filter((text) => /was NOT played: the last \d+ actions/.test(text)).length,
    refused_unavailable: results.filter((text) => /is not currently available \(available now/.test(text)).length,
    loop_guard_ends: results.filter((text) => /^Repeated unchanged error; decision ends|Three identical observations\/errors/.test(text)).length,
    refinements: { started: refiner.filter((row) => row.kind === 'start').length, edits: refiner.filter((row) => row.kind === 'edit').length,
      with_expect: refiner.filter((row) => row.kind === 'edit' && row.expect).length, told: refiner.filter((row) => row.kind === 'told').length },
    per_level: levels(rows),
  });
}
console.log(JSON.stringify(out, null, 1));
