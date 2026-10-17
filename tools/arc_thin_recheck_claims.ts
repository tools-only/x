/**
 * Re-runs the hypothesis checks a run recorded (harness/claim_checks.jsonl) under r04's strict rule: a move carries
 * changed_cells, counted from its two grids, and t.get of a key a move does not carry fails (x and y excepted).
 * Prints per run the checks re-run, the results compared and every change, recorded result -> strict result
 * (docs/plans/2026-10-17-r04-version-plan.md, item 5's acceptance). Controls (mismatched moves) are not re-run.
 * Usage: node --experimental-transform-types --no-warnings tools/arc_thin_recheck_claims.ts <harness dir> [...]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { arcSkillFoundation, arcSkillGuestProgram, SKILL_LIMITS } from '../demo/arc_thin_skill_guest.ts';
import { claimSegments, claimVersion } from '../demo/arc_thin_claims.ts';

type Value = true | false | null | 'error';
const read = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const program = arcSkillGuestProgram(SKILL_LIMITS);
const name = (value: Value | undefined) => value === true ? 'holds' : value === false ? 'fails' : value === null ? 'n/a' : value ?? 'none';

async function recheck(dir: string) {
  const trajectory = read(join(dir, 'trajectory.jsonl'));
  const byN = new Map(trajectory.map((row) => [Number(row.n), row]));
  const grids = new Map<number, any>(read(join(dir, 'states.jsonl')).filter((row) => Array.isArray(row.grid)).map((row) => [Number(row.n), row.grid]));
  // Every check source that ever stood in memory, by key and version (the agent's and the refinements' writes).
  const sources = new Map<string, { key: string; source: string; by: string }>();
  for (const row of read(join(dir, 'memory.jsonl'))) if (typeof row?.hyp?.check === 'string' && row.hyp.check)
    sources.set(`${row.key}@${claimVersion(row.hyp.check)}`, { key: row.key, source: row.hyp.check, by: row.by === 'refinement' ? 'refinement' : 'agent' });
  const recorded = new Map<string, Map<number, Value>>();
  for (const row of read(join(dir, 'claim_checks.jsonl'))) {
    if (row.control || !('result' in row) || typeof row.n !== 'number') continue;
    const id = `${row.key}@${row.version}`;
    if (!recorded.has(id)) recorded.set(id, new Map());
    recorded.get(id)!.set(row.n, row.result);
  }
  const report: any = { dir, checks: 0, results: 0, changed: 0, transitions: {} as Record<string, number>, reads_changed_cells: 0, missing_source: 0, details: [] as any[] };
  for (const [id, old] of recorded) {
    const found = sources.get(id);
    if (!found) { report.missing_source += 1; continue; }
    report.checks += 1;
    if (/changed_cells/.test(found.source)) report.reads_changed_cells += 1;
    const strict = new Map<number, [Value, string?]>();
    const failures: string[] = [];
    // The extension's batching (200,000 characters of grids); a batch the sandbox could not finish (fuel, time) is run
    // again in smaller batches, and what still fails is reported.
    const run = async (ns: number[], maxChars: number): Promise<boolean> => {
      for (const segments of claimSegments(ns, grids, maxChars).batches) {
        const batch = segments.flatMap((segment) => segment.steps.map((step: any) => step.n));
        const transitions = Object.fromEntries(batch.map((n: number) => {
          const row = byN.get(n);
          return [String(n), row && { action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
            level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed }];
        }));
        let result: any;
        try {
          result = (await evaluateTaskPython(program, { mode: 'claims', strict: true, claims: [{ key: found.key, source: found.source }],
            segments, transitions, _foundation: arcSkillFoundation.version })).value;
        } catch (error) {
          if (batch.length > 1 && maxChars > 4000) { if (!(await run(batch, Math.floor(maxChars / 4)))) return false; continue; }
          failures.push(`#${batch[0]}-#${batch.at(-1)}: ${String((error as Error).message ?? error).split('\n').find((line) => /fuel|timeout|Error/i.test(line)) ?? ''}`.slice(0, 200));
          continue;
        }
        if (!result?.ok) { failures.push(String(result?.error ?? '').slice(0, 200)); continue; }
        const out = result.value[found.key];
        if (out?.error) { failures.push(`compile: ${String(out.error).slice(0, 200)}`); return false; }
        for (const [n, value, error] of out?.results ?? []) strict.set(n, [value, error]);
      }
      return true;
    };
    await run([...old.keys()], 200_000);
    if (failures.length) report.details.push({ id, failures: failures.slice(0, 3), failed_batches: failures.length });
    const changes: Record<string, number[]> = {};
    let firstError: string | undefined;
    for (const [n, before] of old) {
      const now = strict.get(n);
      if (!now) continue;
      report.results += 1;
      if (now[0] === before) continue;
      const kind = `${name(before)} -> ${name(now[0])}`;
      (changes[kind] ??= []).push(n);
      report.transitions[kind] = (report.transitions[kind] ?? 0) + 1;
      report.changed += 1;
      if (now[0] === 'error' && !firstError) firstError = now[1];
    }
    if (Object.keys(changes).length) report.details.push({ id, by: found.by, reads_changed_cells: /changed_cells/.test(found.source),
      changes: Object.fromEntries(Object.entries(changes).map(([kind, ns]) => [kind, `${ns.length} (#${ns.slice(0, 6).join(', #')}${ns.length > 6 ? ', ...' : ''})`])),
      ...(firstError ? { first_error: firstError.slice(0, 160) } : {}) });
  }
  return report;
}

for (const dir of process.argv.slice(2)) console.log(JSON.stringify(await recheck(dir), null, 1));
