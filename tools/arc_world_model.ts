/**
 * Offline world model ("dreaming"), phase 0 of docs/plans/2026-10-19-offline-world-model.md: from the transitions a
 * run recorded, a model writes the game's rules as Python step(grid, action, x, y, history), and the sandbox runs it on
 * every recorded move of a window, each from the recorded grid before the move. No game action is played.
 *
 * window <run or harness dir> <from>-<to> <out>: splits the window's moves into attempts (a RESET starts one; RESET and
 *   level-changing moves are not scored), holds out the last attempt and the second half of every earlier one, finds
 *   busy lines (rows or columns changed on at least 80% of the fit moves: counters, timers) and scores two baselines:
 *   no change, and replay (a move whose grid outside busy lines and whose action occur among the fit moves gets the
 *   change recorded there). Writes <out>/window.json.
 * score <out> <file.py> | --oracle [--changes] [--name n]: scores a step() source. --oracle scores a lookup of every recorded
 *   move by grid and action, a check of the scoring itself: it is exact wherever the grid and action decide the result.
 * fit <out> <model> [--rounds 3] [--budget 300000] [--effort medium|off] [--max-tokens n] [--prompt v1|v2] [--label name]:
 *   a prompt with the fit moves, then up to --rounds repairs showing the fit moves the code gets most wrong. Every round's
 *   code is scored on all moves; the round best on the fit moves is the result. Writes <out>/<label>/.
 * Usage: node --experimental-transform-types --no-warnings tools/arc_world_model.ts window|score|fit ...
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTaskPython, TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity,
  type ValidatedTaskPythonProgram } from '../demo/pi_task_python.ts';

type Grid = number[][];
type Kind = 'fit' | 'half' | 'later';
type Move = { n: number; action: string; x?: number; y?: number; state?: string; attempt: number; index: number; kind: Kind;
  changed: number; changed_busy: number; seen: boolean };
type Attempt = { index: number; start: number; moves: Move[] };
type Window = { harness: string; from: number; to: number; width: number; height: number; attempts: Attempt[];
  excluded: Array<{ n: number; why: string }>; busy: { rows: number[]; cols: number[] }; baselines?: Record<string, Summary> };
type Result = { n: number; wrong_other?: number; wrong_busy?: number; changed?: number; changes?: number[][]; error?: string };
type Group = { moves: number; exact: number; exact_other: number; exact_busy: number; errors: number; wrong_other_cells: number;
  changed_other_cells: number };
type Summary = Record<string, Group>;

const read = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const harnessOf = (dir: string) => existsSync(join(dir, 'arc-run', 'harness')) ? join(dir, 'arc-run', 'harness') : dir;
const moves = (window: Window) => window.attempts.flatMap((attempt) => attempt.moves);
const label = (move: { action: string; x?: number; y?: number }) => move.x !== undefined ? `${move.action} x=${move.x} y=${move.y}` : move.action;
const hex = (grid: Grid) => grid.map((row) => row.map((cell) => cell.toString(16)).join('')).join('\n');

function load(harness: string) {
  const rows = new Map<number, any>(read(join(harness, 'trajectory.jsonl')).map((row) => [Number(row.n), row]));
  const grids = new Map<number, Grid>(read(join(harness, 'states.jsonl')).filter((row) => Array.isArray(row.grid))
    .map((row) => [Number(row.n), row.grid]));
  return { rows, grids };
}

/** The cells that differ, as [x, y, after]. */
function delta(before: Grid, after: Grid): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < after.length; y += 1) for (let x = 0; x < after[y].length; x += 1)
    if (before[y][x] !== after[y][x]) out.push([x, y, after[y][x]]);
  return out;
}

/** Changed cells row by row, as runs of one colour change: "y12 x3-5 4>9". */
function runs(before: Grid, after: Grid): string {
  const parts: string[] = [];
  for (let y = 0; y < after.length; y += 1) {
    for (let x = 0; x < after[y].length;) {
      if (before[y][x] === after[y][x]) { x += 1; continue; }
      const start = x, from = before[y][x], to = after[y][x];
      while (x < after[y].length && before[y][x] === from && after[y][x] === to) x += 1;
      parts.push(`y${y} x${start}${x - 1 > start ? `-${x - 1}` : ''} ${from.toString(16)}>${to.toString(16)}`);
    }
  }
  return parts.join('; ') || 'no change';
}

const busyCell = (window: Window, x: number, y: number) => window.busy.rows.includes(y) || window.busy.cols.includes(x);
const maskedKey = (window: Window, grid: Grid, move: { action: string; x?: number; y?: number }) => createHash('sha256')
  .update(JSON.stringify(grid.map((row, y) => row.map((cell, x) => busyCell(window, x, y) ? -1 : cell)))).digest('hex').slice(0, 16)
  + `|${move.action}|${move.x ?? ''}|${move.y ?? ''}`;

function buildWindow(dir: string, from: number, to: number): Window {
  const harness = resolve(harnessOf(dir));
  const { rows, grids } = load(harness);
  const attempts: Attempt[] = [];
  const excluded: Array<{ n: number; why: string }> = [];
  let current: Move[] = [], start = from - 1;
  const close = (next: number) => { if (current.length) attempts.push({ index: attempts.length + 1, start, moves: current }); current = []; start = next; };
  for (let n = from; n <= to; n += 1) {
    const row = rows.get(n);
    if (!row || !grids.has(n - 1) || !grids.has(n)) throw new Error(`#${n} has no recorded row or grids; choose a window without gaps`);
    if (row.action === 'RESET') { excluded.push({ n, why: 'RESET' }); close(n); continue; }
    if (row.level_changed) { excluded.push({ n, why: 'level change' }); close(n); continue; }
    current.push({ n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
      ...(row.state && row.state !== 'NOT_FINISHED' ? { state: row.state } : {}), attempt: 0, index: current.length, kind: 'fit',
      changed: 0, changed_busy: 0, seen: false });
  }
  close(to);
  for (const [i, attempt] of attempts.entries()) for (const move of attempt.moves) {
    move.attempt = attempt.index;
    move.kind = i === attempts.length - 1 ? 'later' : move.index < Math.ceil(attempt.moves.length / 2) ? 'fit' : 'half';
  }
  const first = grids.get(from - 1)!;
  const window: Window = { harness, from, to, width: first[0].length, height: first.length, attempts, excluded, busy: { rows: [], cols: [] } };
  // Busy lines, from the fit moves only: a row or column with a changed cell on at least 80% of them.
  const fit = moves(window).filter((move) => move.kind === 'fit');
  const rowCount = new Map<number, number>(), colCount = new Map<number, number>();
  for (const move of fit) {
    const cells = delta(grids.get(move.n - 1)!, grids.get(move.n)!);
    for (const y of new Set(cells.map(([, y]) => y))) rowCount.set(y, (rowCount.get(y) ?? 0) + 1);
    for (const x of new Set(cells.map(([x]) => x))) colCount.set(x, (colCount.get(x) ?? 0) + 1);
  }
  const busy = (counts: Map<number, number>) => [...counts].filter(([, count]) => count >= 0.8 * fit.length).map(([line]) => line).sort((a, b) => a - b);
  window.busy = { rows: busy(rowCount), cols: busy(colCount) };
  const seen = new Set(fit.map((move) => maskedKey(window, grids.get(move.n - 1)!, move)));
  for (const move of moves(window)) {
    const cells = delta(grids.get(move.n - 1)!, grids.get(move.n)!);
    move.changed_busy = cells.filter(([x, y]) => busyCell(window, x, y)).length;
    move.changed = cells.length - move.changed_busy;
    move.seen = move.kind !== 'fit' && seen.has(maskedKey(window, grids.get(move.n - 1)!, move));
  }
  return window;
}

const GROUPS: Record<string, (move: Move) => boolean> = {
  fit: (move) => move.kind === 'fit', heldout: (move) => move.kind !== 'fit', heldout_novel: (move) => move.kind !== 'fit' && !move.seen,
  heldout_seen: (move) => move.kind !== 'fit' && move.seen, half: (move) => move.kind === 'half', later: (move) => move.kind === 'later',
};

function summarize(window: Window, results: Map<number, Result>): Summary {
  const out: Summary = {};
  for (const [name, test] of Object.entries(GROUPS)) {
    const group: Group = { moves: 0, exact: 0, exact_other: 0, exact_busy: 0, errors: 0, wrong_other_cells: 0, changed_other_cells: 0 };
    for (const move of moves(window).filter(test)) {
      const result = results.get(move.n);
      group.moves += 1;
      group.changed_other_cells += move.changed;
      if (!result || result.error !== undefined || result.wrong_other === undefined) { group.errors += 1; group.wrong_other_cells += move.changed; continue; }
      group.exact_other += Number(result.wrong_other === 0);
      group.exact_busy += Number(result.wrong_busy === 0);
      group.exact += Number(result.wrong_other === 0 && result.wrong_busy === 0);
      group.wrong_other_cells += result.wrong_other;
    }
    out[name] = group;
  }
  return out;
}

/** The two comparators, from the record alone: no change, and replay of a fit move with the same masked grid and action. */
function baselines(window: Window, grids: Map<number, Grid>): Record<string, Summary> {
  const fitByKey = new Map<string, Move>();
  for (const move of moves(window).filter((m) => m.kind === 'fit')) {
    const key = maskedKey(window, grids.get(move.n - 1)!, move);
    if (!fitByKey.has(key)) fitByKey.set(key, move);
  }
  const score = (predict: (move: Move, before: Grid) => Grid) => new Map(moves(window).map((move) => {
    const before = grids.get(move.n - 1)!, after = grids.get(move.n)!, predicted = predict(move, before);
    let wrongOther = 0, wrongBusy = 0;
    for (let y = 0; y < after.length; y += 1) for (let x = 0; x < after[y].length; x += 1)
      if (predicted[y][x] !== after[y][x]) { if (busyCell(window, x, y)) wrongBusy += 1; else wrongOther += 1; }
    return [move.n, { n: move.n, wrong_other: wrongOther, wrong_busy: wrongBusy }];
  }));
  const replay = (move: Move, before: Grid) => {
    const source = move.kind === 'fit' ? undefined : fitByKey.get(maskedKey(window, before, move));
    const out = before.map((row) => [...row]);
    if (source) for (const [x, y, value] of delta(grids.get(source.n - 1)!, grids.get(source.n)!)) out[y][x] = value;
    return out;
  };
  return { identity: summarize(window, score((_move, before) => before)), replay: summarize(window, score(replay)) };
}

/** The constant guest: the model's source travels as data and is compiled as "<model>", so error lines match it. */
const GUEST = String.raw`req = input
src = req["source"]
busy_rows = set(req["busy_rows"])
busy_cols = set(req["busy_cols"])
cap = req.get("cap", 150)


def where(error):
    if isinstance(error, SyntaxError):
        return "line %s: %s" % (error.lineno, (error.text or "").strip())
    lines = src.splitlines()
    found = []
    tb = error.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        if code.co_filename == "<model>":
            number = tb.tb_lineno
            text = lines[number - 1].strip() if 0 < number <= len(lines) else ""
            found.append("line %s in %s: %s" % (number, code.co_name, text))
        tb = tb.tb_next
    return "; ".join(found[-3:])


def describe(error):
    return ((type(error).__name__ + ": " + str(error))[:240] + " " + where(error)).strip()


def compare(before, after, pred):
    height, width = len(after), len(after[0])
    if not isinstance(pred, (list, tuple)) or len(pred) != height:
        return None
    wrong_other = wrong_busy = changed = 0
    changes = []
    for y in range(height):
        row = pred[y]
        if not isinstance(row, (list, tuple)) or len(row) != width:
            return None
        b_row, a_row, busy = before[y], after[y], y in busy_rows
        for x in range(width):
            value = row[x]
            if value != b_row[x]:
                changed += 1
                if len(changes) < cap:
                    changes.append([x, y, value if isinstance(value, int) else str(value)])
            if value != a_row[x]:
                if busy or x in busy_cols:
                    wrong_busy += 1
                else:
                    wrong_other += 1
    return {"wrong_other": wrong_other, "wrong_busy": wrong_busy, "changed": changed, "changes": changes}


out = {"moves": []}
ns = {"__name__": "world_model"}
try:
    exec(compile(src, "<model>", "exec"), ns)
    step = ns.get("step")
    if not callable(step):
        raise ValueError("the code defines no step(grid, action, x, y, history)")
except BaseException as error:
    out["compile_error"] = describe(error)
    step = None
if step is not None:
    for segment in req["segments"]:
        grid = [list(row) for row in segment["grid"]]
        history = []
        for move in segment["moves"]:
            after = [row[:] for row in grid]
            for x, y, value in move["delta"]:
                after[y][x] = value
            if move["score"]:
                record = {"n": move["n"]}
                try:
                    past = [{"grid": [row[:] for row in h["grid"]], "action": h["action"], "x": h["x"], "y": h["y"]} for h in history]
                    pred = step([row[:] for row in grid], move["action"], move.get("x"), move.get("y"), past)
                    result = compare(grid, after, pred)
                    if result is None:
                        record["error"] = "step returned %s, not a grid of %d rows of %d cells" % (type(pred).__name__, len(after), len(after[0]))
                    else:
                        record.update(result)
                except BaseException as error:
                    record["error"] = describe(error)
                out["moves"].append(record)
            history.append({"grid": grid, "action": move["action"], "x": move.get("x"), "y": move.get("y")})
            grid = after
out
`;

const LIMITS = { input_bytes: 512 * 1024, output_bytes: 256 * 1024, memory_bytes: 256 * 1024 * 1024, fuel: 4_000_000_000, timeout_ms: 30_000 };
const program: ValidatedTaskPythonProgram = { format: TASK_PYTHON_FORMAT, source: GUEST, limits: LIMITS,
  effective_limits: taskPythonLimits(LIMITS), runtime: taskPythonRuntimeIdentity() };

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/**
 * Runs a step() source on every move of the window, one sandbox call per attempt (4 at a time). The moves before the
 * scored ones are replayed as history. A call that times out or runs out of fuel is retried on halves of its moves, at
 * most three times deep; moves still unscored then count as errors.
 */
async function scoreSource(window: Window, grids: Map<number, Grid>, source: string) {
  const started = Date.now();
  const results = new Map<number, Result>();
  let compileError: string | undefined;
  const segment = (attempt: Attempt, scored: Set<number>) => ({ grid: grids.get(attempt.start), moves: attempt.moves.map((move) => ({
    n: move.n, action: move.action, ...(move.x !== undefined ? { x: move.x, y: move.y } : {}),
    delta: delta(grids.get(move.n - 1)!, grids.get(move.n)!), score: scored.has(move.n) })) });
  const run = async (attempt: Attempt, ns: number[], depth: number): Promise<void> => {
    try {
      const value: any = (await evaluateTaskPython(program, { source, segments: [segment(attempt, new Set(ns))],
        busy_rows: window.busy.rows, busy_cols: window.busy.cols })).value;
      if (value.compile_error) compileError = value.compile_error;
      for (const row of value.moves ?? []) results.set(row.n, row);
    } catch (error) {
      const message = String((error as Error).message ?? error).slice(0, 200);
      if (depth < 3 && ns.length > 1) {
        const half = Math.ceil(ns.length / 2);
        await run(attempt, ns.slice(0, half), depth + 1);
        await run(attempt, ns.slice(half), depth + 1);
      } else for (const n of ns) results.set(n, { n, error: `the sandbox stopped (${message}) on a batch of ${ns.length} moves` });
    }
  };
  await pool(window.attempts, 4, (attempt) => run(attempt, attempt.moves.map((move) => move.n), 0));
  if (compileError) for (const move of moves(window)) results.set(move.n, { n: move.n, error: compileError });
  return { results, compileError, seconds: Math.round((Date.now() - started) / 1000) };
}

/** A lookup of every recorded move by its grid and action (no busy mask): exact unless the result depends on more. */
function oracleSource(window: Window, grids: Map<number, Grid>): string {
  const table: Record<string, number[][]> = {};
  const collisions: number[] = [];
  for (const move of moves(window)) {
    const before = grids.get(move.n - 1)!;
    const key = createHash('sha1').update(Buffer.from(before.flat())).digest('hex').slice(0, 16)
      + `|${move.action}|${move.x ?? 'None'}|${move.y ?? 'None'}`;
    const change = delta(before, grids.get(move.n)!);
    if (key in table) { if (JSON.stringify(table[key]) !== JSON.stringify(change)) collisions.push(move.n); continue; }
    table[key] = change;
  }
  return `# Oracle: the recorded change of every move, by grid and action. Same key, other result: ${collisions.map((n) => `#${n}`).join(' ') || 'none'}\n`
    + `import hashlib\nTABLE = ${JSON.stringify(table)}\n\n\ndef step(grid, action, x, y, history):\n`
    + `    key = hashlib.sha1(bytes(c for row in grid for c in row)).hexdigest()[:16] + "|%s|%s|%s" % (action, x, y)\n`
    + `    out = [row[:] for row in grid]\n    for cx, cy, value in TABLE.get(key, []):\n        out[cy][cx] = value\n    return out\n`;
}

const SYSTEM = 'You infer the rules of a deterministic turn-based grid game from a record of its moves, and write them as a Python '
  + 'function that predicts the grid after any move.';

/**
 * v1 is the prompt the record's protocol fixed. Under it gpt-6.1-sol answered with a placeholder (the grid unchanged)
 * and then declined to write code at all; v2 adds one sentence asking for the most complete model the record supports.
 */
const PROMPTS = ['v1', 'v2'];
const BEST_EFFORT = ' Each rule you capture makes more moves exact, so write the most complete model the record supports, never a\n'
  + 'placeholder that returns the grid unchanged; where the record leaves a case open, choose the simplest rule consistent with it.';

function recordPrompt(window: Window, grids: Map<number, Grid>, version = 'v2'): string {
  const all = moves(window);
  const actions = [...new Set(all.map((move) => move.action))].sort()
    .map((action) => all.some((move) => move.action === action && move.x !== undefined) ? `${action} (with x, y)` : action);
  const shown = window.attempts.filter((attempt) => attempt.moves.some((move) => move.kind === 'fit'));
  const parts = [
    'A record of one level of a turn-based game follows. The game is deterministic: the same grid, earlier moves and action always '
      + 'give the same result. Its rules are not given; infer them from the record.',
    `GRID: ${window.width} columns (x = 0..${window.width - 1}, left to right) and ${window.height} rows (y = 0..${window.height - 1}, top to `
      + 'bottom); each cell holds a colour 0-15, written as one hex digit.',
    `ACTIONS in the record: ${actions.join(', ')}. An action with coordinates acts on the cell (x, y). RESET, which restarts the level, `
      + 'is not part of your model.',
    `THE RECORD: the first half of each of ${shown.length} attempts at the level, each from the grid shown at its start; their later `
      + `moves${window.attempts.length > shown.length ? ' and one more attempt' : ''} are kept out to test your code. A move lists the cells `
      + 'it changed, row by row: "y12 x3-5 4>9" means cells x = 3..5 of row 12 changed from colour 4 to colour 9; "no change" means '
      + 'none did. GAME_OVER marks a move that ended the attempt.',
  ];
  const starts: Array<{ index: number; grid: Grid }> = [];
  for (const attempt of shown) {
    const fit = attempt.moves.filter((move) => move.kind === 'fit');
    const grid = grids.get(attempt.start)!;
    const same = starts.find((earlier) => JSON.stringify(earlier.grid) === JSON.stringify(grid));
    const lines = [`ATTEMPT ${attempt.index}: moves #${fit[0].n}-#${fit.at(-1)!.n}, `
      + (same ? `from the same grid as attempt ${same.index}` : 'from this grid:') + (same ? '' : `\n${hex(grid)}`)];
    if (!same) starts.push({ index: attempt.index, grid });
    for (const move of fit)
      lines.push(`#${move.n} ${label(move)}${move.state ? ` [${move.state}]` : ''}: ${runs(grids.get(move.n - 1)!, grids.get(move.n)!)}`);
    parts.push(lines.join('\n'));
  }
  const example = all.find((move) => move.x !== undefined)?.action ?? all[0].action;
  parts.push(`TASK: write Python 3 (standard library only) defining

def step(grid, action, x, y, history):
    """Returns the grid after one move, as a new list of rows.
    grid: the current grid, a list of ${window.height} rows of ${window.width} ints (grid[y][x]).
    action: the action's name, e.g. "${example}"; x, y: its coordinates, or None for an action without them.
    history: the earlier moves of this attempt, oldest first, each {"grid": the grid before it, "action", "x", "y"};
    the current grid is the result of the last one (history is [] at the start of an attempt)."""

The function will be run on every move of these attempts from the recorded grid before it, including the moves kept out, and
scored on exact agreement of every cell with the recorded grid after the move.${version === 'v1' ? '' : BEST_EFFORT} It runs in a sandboxed CPython 3.12 without
third-party modules, with a time limit of a few seconds for a whole attempt. Before the code, state briefly the rules you
found. Then give the complete code in one \`\`\`python block.`);
  return parts.join('\n\n');
}

/** Feedback from the fit moves only: the totals, and the moves with the most wrong cells, recorded change against the code's. */
function repairPrompt(window: Window, grids: Map<number, Grid>, results: Map<number, Result>, compileError?: string): string {
  if (compileError) return `Your code did not run: ${compileError}\nGive the complete corrected code again in one \`\`\`python block.`;
  const fit = moves(window).filter((move) => move.kind === 'fit');
  const wrong = (move: Move) => { const r = results.get(move.n); return r?.error !== undefined || !r ? Infinity : r.wrong_other! + r.wrong_busy!; };
  const failing = fit.filter((move) => wrong(move) > 0).sort((a, b) => wrong(b) - wrong(a));
  const errors = failing.filter((move) => wrong(move) === Infinity);
  const lines = [`Your code, run on the ${fit.length} moves shown: every cell right on ${fit.length - failing.length}; `
    + `${failing.length - errors.length} with wrong cells; ${errors.length} raised an error.`];
  if (failing.length) lines.push('Wrong: ' + failing.map((move) => `#${move.n} (${wrong(move) === Infinity ? 'error' : wrong(move)})`).join(', '));
  for (const move of [...errors.slice(0, 3), ...failing.filter((m) => wrong(m) !== Infinity).slice(0, 8 - Math.min(3, errors.length))]) {
    const result = results.get(move.n)!;
    const before = grids.get(move.n - 1)!;
    const head = `#${move.n} ${label(move)} (attempt ${move.attempt}, move ${move.index + 1})`;
    if (result.error !== undefined) { lines.push(`${head}: ${result.error}`); continue; }
    const yours = before.map((row) => [...row]);
    for (const [x, y, value] of result.changes ?? []) if (typeof value === 'number') yours[y][x] = value;
    const capped = (result.changed ?? 0) > (result.changes?.length ?? 0) ? ` (the first ${result.changes!.length} of ${result.changed} changed cells)` : '';
    lines.push(`${head}: ${wrong(move)} cells wrong\n  recorded: ${runs(before, grids.get(move.n)!)}\n  yours:    ${runs(before, yours)}${capped}`);
  }
  lines.push('Revise the rules where the record contradicts them and give the complete code again in one ```python block.');
  return lines.join('\n');
}

function extractCode(text: string): string | undefined {
  const blocks = [...text.matchAll(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
  return blocks.reverse().find((block) => /\bdef\s+step\s*\(/.test(block));
}

function gateway() {
  const env: Record<string, string | undefined> = { ...process.env };
  const local = fileURLToPath(new URL('../.env', import.meta.url));
  const path = existsSync(local) ? local : 'D:/autoresearch_pi_project/.env';
  if (existsSync(path)) for (const raw of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    let value = line.slice(line.indexOf('=') + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    env[key] ??= value;
  }
  const base = env.ARC_OPENAI_API_BASE || env.OPENAI_API_BASE, key = env.ARC_OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!base || !key) throw new Error('no gateway base URL or key in the environment or .env');
  return { base: base.replace(/\/$/, ''), key };
}

/**
 * Uncached input plus output. Some backends behind one gateway model name leave reasoning out of completion_tokens and
 * count it only in total_tokens (prompt 16,135 + completion 18,248, total 50,790 with 16,407 reasoning), so the larger
 * of the two readings counts.
 */
const budgetTokens = (usage: any) => {
  if (!usage) return 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return Math.max(Math.max(0, (usage.prompt_tokens ?? 0) - cached) + (usage.completion_tokens ?? 0), (usage.total_tokens ?? 0) - cached);
};

/** One streamed chat completion. Qwen's dialect carries the thinking switch, GPT models reasoning_effort (as the runs did). */
async function complete(model: string, messages: any[], effort: string, maxTokens: number) {
  const { base, key } = gateway();
  const body = { model, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true },
    ...(model.startsWith('qwen') ? { enable_thinking: effort !== 'off' } : effort !== 'off' ? { reasoning_effort: effort } : {}) };
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20 * 60_000);
    try {
      const response = await fetch(`${base}/chat/completions`, { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`;
        if (response.status < 500) break;
        continue;
      }
      const decoder = new TextDecoder();
      const content: string[] = [];
      let buffer = '', usage: any, finish: string | undefined, reasoning = 0, streamError: string | undefined;
      for await (const chunk of response.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
          let data: any;
          try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (data.error) streamError = JSON.stringify(data.error).slice(0, 400);
          usage = data.usage ?? usage;
          for (const choice of data.choices ?? []) {
            if (choice.delta?.content) content.push(choice.delta.content);
            if (choice.delta?.reasoning_content) reasoning += choice.delta.reasoning_content.length;
            finish = choice.finish_reason ?? finish;
          }
        }
      }
      if (streamError && !content.length) { lastError = `stream error: ${streamError}`; continue; }
      return { text: content.join(''), finish, usage, reasoning_chars: reasoning, seconds: Math.round((Date.now() - started) / 1000),
        ...(streamError ? { stream_error: streamError } : {}) };
    } catch (error) {
      lastError = String((error as Error).message ?? error).slice(0, 400);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`no reply from ${model}: ${lastError}`);
}

const verdict = (summary: Summary) => {
  const novel = summary.heldout_novel, heldout = summary.heldout;
  return { p1_novel_exact_other: novel.moves ? novel.exact_other / novel.moves : null, p2_heldout_exact_busy: heldout.moves ? heldout.exact_busy / heldout.moves : null,
    pass: novel.moves > 0 && novel.exact_other >= 0.7 * novel.moves && heldout.exact_busy >= 0.9 * heldout.moves };
};
const summaryLine = (summary: Summary) => Object.entries(summary).map(([name, g]) =>
  `${name} ${g.exact}/${g.moves} exact (outside busy ${g.exact_other}, busy ${g.exact_busy}, errors ${g.errors}, wrong cells ${g.wrong_other_cells}/${g.changed_other_cells})`).join('; ');

async function fit(out: string, model: string, options: Record<string, string>) {
  const window: Window = JSON.parse(readFileSync(join(out, 'window.json'), 'utf8'));
  const { grids } = load(window.harness);
  const rounds = Number(options.rounds ?? 3), budget = Number(options.budget ?? 300_000);
  const effort = options.effort ?? (model.startsWith('qwen') ? 'off' : 'medium');
  const maxTokens = Number(options['max-tokens'] ?? (model.startsWith('qwen') ? 16_000 : 32_000));
  const prompt = options.prompt ?? 'v2';
  if (!PROMPTS.includes(prompt)) throw new Error(`--prompt is one of ${PROMPTS.join(', ')}`);
  const dir = join(out, options.label ?? `${model}-${effort}`);
  mkdirSync(dir, { recursive: true });
  const calls = join(dir, 'calls.jsonl');
  let spent = read(calls).reduce((sum, row) => sum + (row.budget_tokens ?? 0), 0);
  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: recordPrompt(window, grids, prompt) }];
  writeFileSync(join(dir, 'prompt.txt'), messages[1].content);
  let best: { round: number; summary: Summary } | undefined;
  const rank = (summary: Summary) => [summary.fit.exact, summary.fit.exact_other, -summary.fit.wrong_other_cells];
  const better = (a: number[], b: number[]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];
  let stop = 'rounds done';
  for (let round = 0; round <= rounds; round += 1) {
    if (spent >= budget) { stop = `budget spent (${spent} of ${budget})`; break; }
    let reply;
    try { reply = await complete(model, messages, effort, maxTokens); } catch (error) {
      appendFileSync(calls, JSON.stringify({ round, error: String((error as Error).message) }) + '\n');
      stop = `call failed: ${String((error as Error).message).slice(0, 200)}`;
      break;
    }
    const tokens = budgetTokens(reply.usage);
    spent += tokens;
    appendFileSync(calls, JSON.stringify({ round, model, effort, finish: reply.finish, seconds: reply.seconds, usage: reply.usage,
      budget_tokens: tokens, reasoning_chars: reply.reasoning_chars, ...(reply.stream_error ? { stream_error: reply.stream_error } : {}) }) + '\n');
    writeFileSync(join(dir, `reply-${round}.md`), reply.text);
    messages.push({ role: 'assistant', content: reply.text });
    const code = extractCode(reply.text);
    if (!code) {
      console.log(`round ${round}: no code (finish ${reply.finish}, ${tokens} budget tokens)`);
      messages.push({ role: 'user', content: 'Your reply had no ```python block defining step(grid, action, x, y, history). Give the complete code in one block.' });
      continue;
    }
    writeFileSync(join(dir, `code-${round}.py`), code);
    const scored = await scoreSource(window, grids, code);
    const summary = summarize(window, scored.results);
    writeFileSync(join(dir, `score-${round}.json`), JSON.stringify({ round, seconds: scored.seconds, compile_error: scored.compileError ?? null,
      summary, verdict: verdict(summary), results: [...scored.results.values()].map(({ changes, ...rest }) => rest) }, null, 1));
    console.log(`round ${round} (${tokens} budget tokens, ${reply.seconds} s, scored in ${scored.seconds} s): ${summaryLine(summary)}`);
    if (!best || better(rank(summary), rank(best.summary))) best = { round, summary };
    if (summary.fit.exact === summary.fit.moves) { stop = 'every fit move exact'; break; }
    if (round < rounds) messages.push({ role: 'user', content: repairPrompt(window, grids, scored.results, scored.compileError) });
  }
  writeFileSync(join(dir, 'messages.json'), JSON.stringify(messages, null, 1));
  const report = { model, effort, prompt, rounds, budget, spent, stop, best_round: best?.round ?? null, summary: best?.summary ?? null,
    verdict: best ? verdict(best.summary) : null, baselines: window.baselines };
  writeFileSync(join(dir, 'fit.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ model, effort, prompt, spent, stop, best_round: report.best_round, verdict: report.verdict }));
}

const [command, ...args] = process.argv.slice(2);
const flags = (list: string[]) => Object.fromEntries(list.flatMap((arg, i) => arg.startsWith('--') ? [[arg.slice(2), list[i + 1]?.startsWith('--') || list[i + 1] === undefined ? 'true' : list[i + 1]]] : []));
if (command === 'window') {
  const [dir, span, out] = args;
  const [from, to] = span.split('-').map(Number);
  const window = buildWindow(dir, from, to);
  const { grids } = load(window.harness);
  window.baselines = baselines(window, grids);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'window.json'), JSON.stringify(window, null, 1));
  writeFileSync(join(out, 'prompt.txt'), recordPrompt(window, grids));
  console.log(JSON.stringify({ attempts: window.attempts.map((a) => `${a.index}: #${a.moves[0].n}-#${a.moves.at(-1)!.n} (${a.moves.length})`),
    excluded: window.excluded, busy: window.busy, prompt_chars: recordPrompt(window, grids).length }));
  for (const [name, summary] of Object.entries(window.baselines)) console.log(`${name}: ${summaryLine(summary)}`);
} else if (command === 'score') {
  const [out, file, ...rest] = args;
  const options = flags(rest);
  const window: Window = JSON.parse(readFileSync(join(out, 'window.json'), 'utf8'));
  const { grids } = load(window.harness);
  const source = file === '--oracle' ? oracleSource(window, grids) : readFileSync(file, 'utf8');
  if (file === '--oracle') writeFileSync(join(out, 'oracle.py'), source);
  const scored = await scoreSource(window, grids, source);
  const summary = summarize(window, scored.results);
  const name = options.name ?? (file === '--oracle' ? 'oracle' : file.split(/[\\/]/).at(-1)!.replace(/\.py$/, ''));
  // --changes keeps each move's predicted changes (the first 150 cells) for analysis of what the code gets wrong.
  writeFileSync(join(out, `score-${name}.json`), JSON.stringify({ seconds: scored.seconds, compile_error: scored.compileError ?? null, summary,
    verdict: verdict(summary), results: [...scored.results.values()].map(({ changes, ...rest }) => options.changes ? { ...rest, changes } : rest) }, null, 1));
  console.log(`${name} (scored in ${scored.seconds} s): ${summaryLine(summary)}`);
} else if (command === 'fit') {
  const [out, model, ...rest] = args;
  await fit(out, model, flags(rest));
} else {
  console.error('usage: arc_world_model.ts window <run> <from>-<to> <out> | score <out> <file.py>|--oracle | fit <out> <model> [--rounds 3] ...');
  process.exit(2);
}
