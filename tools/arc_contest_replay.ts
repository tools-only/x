/**
 * The contest replay (docs/plans/2026-10-18-self-evolve-loop.md, iteration 1's falsifiable check): does the agent's model,
 * as the refiner, rewrite a hypothesis whose check contests it into one that works, when told it may and shown the check?
 *
 * build <out> <harness dir> [...]: under r04's strict rule, runs every hypothesis check a run recorded (both authors) on
 *   the run's moves, finds the move at which H2a would have contested it while it was current, and takes the first
 *   logged refinement input from then on. Its WHY NOW becomes the contest event as the runtime words it now, with the
 *   check under CHECKS NAMED ABOVE, and the system prompt is the current charter. Writes <out>/harness/refiner_inputs.jsonl
 *   (for tools/arc_refine_replay.py) and <out>/cases.json. No provider call.
 * grade <out> [results.jsonl]: parses each reply as the runtime would; a HYPOTHESIS with a check is run on the moves
 *   recorded up to its input and on the moves after it, and compared with the contested check on the same moves.
 *   Working: it compiles, decides at least 5 moves up to its input and fails on fewer than half of them.
 *   Without a results file it grades the contested checks themselves (the dry run: every case should come out contested).
 * Usage: node --experimental-transform-types --no-warnings tools/arc_contest_replay.ts build|grade <out> [...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { arcSkillFoundation, arcSkillGuestProgram, SKILL_LIMITS } from '../demo/arc_thin_skill_guest.ts';
import { checkContest, claimSegments, claimVersion, contestEvents } from '../demo/arc_thin_claims.ts';
import { parseRefinerReply, REFINER_SYSTEM } from '../demo/arc_thin_refiner.ts';

type Value = true | false | null | 'error';
const read = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const program = arcSkillGuestProgram(SKILL_LIMITS);

/**
 * A check's strict results on the moves `ns` of a run; undefined if it does not compile. Batches are a quarter of the
 * extension's (50,000 characters of grids): on this machine a full batch took 6-25 s against the sandbox's 20 s. A
 * batch that still does not finish is tried once more in quarters, then counts as errors on its moves (the recheck
 * tool's unbounded splitting made a first build run past 20 minutes). Failed batches are printed.
 */
async function results(dir: string, key: string, source: string, ns: number[]): Promise<Map<number, Value> | undefined> {
  const started = Date.now();
  const trajectory = read(join(dir, 'trajectory.jsonl'));
  const byN = new Map(trajectory.map((row) => [Number(row.n), row]));
  const grids = new Map<number, any>(read(join(dir, 'states.jsonl')).filter((row) => Array.isArray(row.grid)).map((row) => [Number(row.n), row.grid]));
  const out = new Map<number, Value>();
  const failures: string[] = [];
  let compiles = true;
  const run = async (picked: number[], maxChars: number, retry: boolean) => {
    for (const segments of claimSegments(picked, grids, maxChars).batches) {
      const batch = segments.flatMap((segment) => segment.steps.map((step: any) => step.n));
      const transitions = Object.fromEntries(batch.map((n: number) => {
        const row = byN.get(n);
        return [String(n), row && { action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
          level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed }];
      }));
      let result: any;
      try {
        result = (await evaluateTaskPython(program, { mode: 'claims', strict: true, claims: [{ key, source }], segments, transitions,
          _foundation: arcSkillFoundation.version })).value;
      } catch (error) {
        if (retry) { await run(batch, Math.floor(maxChars / 4), false); continue; }
        failures.push(`#${batch[0]}-#${batch.at(-1)}: ${String((error as Error).message ?? error).slice(0, 160)}`);
        for (const n of batch) out.set(n, 'error');
        continue;
      }
      if (!result?.ok) { failures.push(`#${batch[0]}-#${batch.at(-1)}: ${String(result?.error ?? 'no result').slice(0, 160)}`); continue; }
      const value = result.value[key];
      if (value?.error) { compiles = false; return; }
      for (const [n, v] of value?.results ?? []) out.set(n, v);
    }
  };
  await run(ns, 50_000, true);
  console.error(`${dir.split(/[\\/]/).slice(-3, -2)[0]} ${key}@${claimVersion(source)}: ${ns.length} moves, ` +
    `${Math.round((Date.now() - started) / 1000)} s${failures.length ? `; failed batches: ${failures.join(' | ')}` : ''}`);
  return compiles ? out : undefined;
}

const decided = (values: Map<number, Value>, upTo = Infinity, from = 0) => {
  const picked = [...values].filter(([n, v]) => n > from && n <= upTo && (v === true || v === false));
  return { decided: picked.length, fails: picked.filter(([, v]) => v === false).length };
};
const rows = (values: Map<number, Value>) => [...values].map(([n, result]) => ({ n, result }));

async function build(out: string, dirs: string[]) {
  const system = REFINER_SYSTEM;
  const inputs: any[] = [];
  const cases: any[] = [];
  const report: any[] = [];
  for (const dir of dirs) {
    const trajectory = read(join(dir, 'trajectory.jsonl'));
    const all = trajectory.map((row) => Number(row.n));
    const memory = read(join(dir, 'memory.jsonl'));
    const logged = read(join(dir, 'refiner_inputs.jsonl'));
    // Each check version, from its write to the next write of its key.
    const writes = memory.filter((row) => row.by !== 'check' && (row.hyp || row.deleted) && typeof row.key === 'string' && row.key.startsWith('hyp.'));
    for (const [i, row] of writes.entries()) {
      if (typeof row?.hyp?.check !== 'string' || !row.hyp.check) continue;
      const next = writes.slice(i + 1).find((later) => later.key === row.key);
      const from = Number(row.at ?? 0), until = next ? Number(next.at ?? Infinity) : Infinity;
      const values = await results(dir, row.key, row.hyp.check, all);
      const version = claimVersion(row.hyp.check);
      const entry: any = { dir, key: row.key, version, by: row.by === 'refinement' ? 'refinement' : 'agent', written_at: from };
      if (!values) { report.push({ ...entry, compiles: false }); continue; }
      // The first move, from the write on and while the version was current, at which the check contests it.
      let at: number | undefined;
      for (const n of all) {
        if (n < from || n >= until) continue;
        if (checkContest(rows(new Map([...values].filter(([m]) => m <= n))))) { at = n; break; }
      }
      const total = decided(values);
      report.push({ ...entry, ...total, contested_at: at ?? null });
      if (at === undefined) continue;
      const input = logged.find((logRow) => Number(logRow.at) >= at! && Number(logRow.at) < until);
      if (!input) { report.at(-1).no_input_after = true; continue; }
      const contest = checkContest(rows(new Map([...values].filter(([m]) => m <= Number(input.at)))))!;
      const [[, event]] = contestEvents([{ key: row.key, version, contest, ownedByRefinement: entry.by === 'refinement' }], []);
      const text = String(input.input).replace(/^WHY NOW: .*$/m, `WHY NOW: ${event}\n\nCHECKS NAMED ABOVE:\n--- ${row.key}\n${row.hyp.check.replace(/\s+$/, '')}`);
      cases.push({ row: inputs.length, ...entry, contested_at: at, input_at: Number(input.at), claim: row.hyp.claim, check: row.hyp.check,
        contest: { decided: contest.decided, fails: contest.fails } });
      inputs.push({ at: Number(input.at), system, input: text, case: `${row.key}@${version}` });
    }
  }
  mkdirSync(join(out, 'harness'), { recursive: true });
  writeFileSync(join(out, 'harness', 'refiner_inputs.jsonl'), inputs.map((row) => JSON.stringify(row)).join('\n') + (inputs.length ? '\n' : ''));
  writeFileSync(join(out, 'cases.json'), JSON.stringify({ cases, checks: report }, null, 1));
  console.log(JSON.stringify({ checks: report.length, compiling: report.filter((r) => r.compiles !== false).length,
    contested: report.filter((r) => r.contested_at !== null && r.contested_at !== undefined).length, cases: cases.length,
    rows: inputs.length ? `0-${inputs.length - 1}` : 'none' }));
}

async function grade(out: string, resultsPath?: string) {
  const { cases } = JSON.parse(readFileSync(join(out, 'cases.json'), 'utf8'));
  const replies = resultsPath ? read(resultsPath) : cases.map((c: any) => ({ id: `dry-${c.row}`, index: c.row,
    text: `HYPOTHESIS ${c.key}\nclaim: ${c.claim}\ncheck:\n${c.check}END\nWHY dry run` }));
  const graded: any[] = [];
  const originals = new Map<number, Map<number, Value>>();
  for (const reply of replies) {
    const c = cases.find((x: any) => x.row === reply.index);
    if (!c) continue;
    const edit: any = reply.error ? { kind: 'error' } : parseRefinerReply(String(reply.text ?? ''));
    const row: any = { id: reply.id, case: `${c.key}@${c.version}`, kind: edit.kind, ...(edit.path ? { path: edit.path } : {}) };
    if (edit.kind === 'hypothesis') {
      row.key = edit.key; row.same_key = edit.key === c.key; row.with_check = Boolean(edit.check);
      if (edit.check) {
        const all = read(join(c.dir, 'trajectory.jsonl')).map((r) => Number(r.n));
        const values = await results(c.dir, edit.key, edit.check, all);
        if (!originals.has(c.row)) originals.set(c.row, (await results(c.dir, c.key, c.check, all))!);
        const original = originals.get(c.row)!;
        row.compiles = Boolean(values);
        if (values) {
          row.then = decided(values, c.input_at); row.later = decided(values, Infinity, c.input_at);
          row.working = row.then.decided >= 5 && 2 * row.then.fails < row.then.decided;
        }
        row.original = { then: decided(original, c.input_at), later: decided(original, Infinity, c.input_at) };
      }
    }
    graded.push(row);
  }
  const count = (f: (r: any) => boolean) => graded.filter(f).length;
  console.log(JSON.stringify({ replies: graded.length, hypotheses: count((r) => r.kind === 'hypothesis'), same_key: count((r) => r.same_key),
    with_check: count((r) => r.with_check), compiling: count((r) => r.compiles), working: count((r) => r.working),
    by_kind: graded.reduce((acc, r) => ({ ...acc, [r.kind + (r.path ? ` ${r.path}` : '')]: (acc[r.kind + (r.path ? ` ${r.path}` : '')] ?? 0) + 1 }), {} as Record<string, number>),
    graded }, null, 1));
}

const [command, out, ...rest] = process.argv.slice(2);
if (command === 'build') await build(out, rest);
else if (command === 'grade') await grade(out, rest[0]);
else { console.error('usage: arc_contest_replay.ts build|grade <out> [...]'); process.exit(2); }
