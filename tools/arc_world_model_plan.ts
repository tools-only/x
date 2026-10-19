/**
 * Phase 1 of the offline world model (docs/plans/2026-10-19-offline-world-model.md, round 3): dream the next level.
 *
 * fit: a model writes step() from the record of a level it passed, the move that completed it included, with validation
 *   from another recording of the same level (counts only), in round 2's loop (tools/arc_world_model_agent.ts).
 * plan: from the next level's first grid, the model studies the level in its own model (python with its step() and
 *   simulate()), may revise the model, and submits one plan; no real action is played before that. The plan is played
 *   once in a local copy of the game (tools/arc_local_judge.py), a black box: nothing of it reaches the model.
 * baseline: plays a recording's actions as a plan: the earlier level's moves copied (a negative case) or the target
 *   level's own recorded moves (the judge's positive control).
 *
 * fit <out> <model> <source run> <a>-<b> <validation run> <a>-<b> [--calls 14] [--budget 250000] [--effort ..] [--label name]
 *   <a>-<b> of the source spans the level's moves and ends with the move that completed it.
 * plan <out> <label> <target run> <entry n> [--calls 8] [--budget 150000] [--max-actions 60] [--name dir] [--env dir] [--game g]
 *   plans the level the target run entered with its move #n (the grid after #n is the plan's start), with <out>/<label>'s fit.
 * baseline <out> <name> <target run> <entry n> <actions run> <a>-<b> [--env dir] [--game g]
 * check <out> <run> <source a-b> <entry n> <control a-b>: the planner's tools on fixed code and both baselines, no model call.
 * Usage: node --experimental-transform-types --no-warnings tools/arc_world_model_plan.ts fit|plan|baseline|check ...
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { budgetTokens, buildWindow, busyCell, delta, flags, guestProgram, hex, isMain, label, load, maskedKey, moves, runs,
  scoreSource, type Grid, type Move, type Window } from './arc_world_model.ts';
import { bestVersion, busyOver, completeTools, coverageOf, coverageText, recordSegments, runLoop, SYSTEM, tally, type Loop,
  type MoveSet } from './arc_world_model_agent.ts';

type PlanAction = [string] | [string, number, number];
const DEFAULT_ENV = 'D:/autoresearch_pi_project/runs/arc-dream-20261019/env';
const span = (text: string) => text.split('-').map(Number) as [number, number];
const harnessOf = (run: string) => /harness[\\/]?$/.test(run) ? run : join(run, 'arc-run', 'harness');
const actionOf = (row: any): PlanAction => row.x != null && row.y != null ? [row.action, Number(row.x), Number(row.y)] : [row.action];
const busyText = (window: Window) => [...(window.busy.rows.length ? [`rows ${window.busy.rows.join(', ')}`] : []),
  ...(window.busy.cols.length ? [`columns ${window.busy.cols.join(', ')}`] : [])].join('; ');

/** A recording's moves #a-#b. A passed level is one attempt, which buildWindow holds out whole, so busy lines come from all its moves. */
function sourceOf(run: string, range: string) {
  const window = buildWindow(run, ...span(range));
  const { rows, grids } = load(window.harness);
  busyOver(window, grids);
  const set: MoveSet = { name: 'shown', window, grids, moves: moves(window), kinds: coverageOf(window, grids).kinds };
  return { window, rows, grids, set };
}
type Source = ReturnType<typeof sourceOf>;

// ---------------------------------------------------------------- fit

function fitPrompt(source: Source, validation: MoveSet, completion: any, maxCalls: number): string {
  const { window, grids, set } = source;
  const all = moves(window);
  const actions = [...new Set([...all.map((move) => move.action), completion.action])].sort()
    .map((action) => all.some((move) => move.action === action && move.x !== undefined) || (completion.action === action && completion.x !== undefined)
      ? `${action} (with x, y)` : action);
  const lines = busyText(window);
  const parts = [
    'A record of one level of a turn-based game follows: every move a player made on it, from the level\'s first grid until the '
      + 'move that completed it. The game is deterministic: the same grid, earlier moves and action always give the same result. '
      + 'Its rules are not given; find them in the record.',
    `GRID: ${window.width} columns (x = 0..${window.width - 1}, left to right) and ${window.height} rows (y = 0..${window.height - 1}, top to `
      + 'bottom); each cell holds a colour 0-15, written as one hex digit.',
    `ACTIONS in the record: ${actions.join(', ')}. An action with coordinates acts on the cell (x, y). RESET, which restarts the level, `
      + 'is not part of your model.',
    ...(lines ? [`LINES THAT CHANGE ON MOST MOVES: ${lines} (each changed on at least 80% of the moves: a counter or timer, by the record).`] : []),
    'THE RECORD: a move lists the cells it changed, row by row: "y12 x3-5 4>9" means cells x = 3..5 of row 12 changed from colour 4 '
      + 'to colour 9; "no change" means none did. GAME_OVER marks a move that ended an attempt.',
  ];
  for (const attempt of window.attempts) {
    const text = [`ATTEMPT ${attempt.index}: moves #${attempt.moves[0].n}-#${attempt.moves.at(-1)!.n}, from this grid:\n${hex(grids.get(attempt.start)!)}`];
    for (const move of attempt.moves)
      text.push(`#${move.n} ${label(move)}${move.state ? ` [${move.state}]` : ''}: ${runs(grids.get(move.n - 1)!, grids.get(move.n)!)}`);
    parts.push(text.join('\n'));
  }
  parts.push(`THE MOVE THAT COMPLETED THE LEVEL: #${completion.n} ${label(completion)}, played on the grid after #${completion.n - 1} `
    + '(in python: record[-1]["moves"][-1]["after"]); the next grid was a new level. Your step() need not predict that move.');
  parts.push(`KINDS OF MOVES SHOWN (a click by its distance from the area the previous move of its attempt changed, the lines above `
    + `left out): ${coverageText(set)}.`);
  parts.push(`VALIDATION: ${validation.moves.length} moves of this same level recorded in another play, from other grids: test scores `
    + 'your code on them, counts only. The version best on them counts.');
  const example = all.find((move) => move.x !== undefined)?.action ?? all[0].action;
  parts.push(`TASK: write Python 3 (standard library only) defining

def step(grid, action, x, y, history):
    """Returns the grid after one move, as a new list of rows.
    grid: the current grid, a list of ${window.height} rows of ${window.width} ints (grid[y][x]).
    action: the action's name, e.g. "${example}"; x, y: its coordinates, or None for an action without them.
    history: the earlier moves of this attempt, oldest first, each {"grid": the grid before it, "action", "x", "y"};
    the current grid is the result of the last one (history is [] at the start of an attempt)."""

It runs in a sandboxed CPython 3.12 without third-party modules, with a time limit of a few seconds for a whole attempt.

The record is already loaded in python as \`record\`, grids included: for example \`m = record[0]["moves"][0]\` is the first
move, and \`m["before"][m["y"]][m["x"]]\` the colour of the cell it acted on. Read grids from it; do not copy them from this text.

Afterwards you will plan moves on another level of this game with your step(), without playing it first: model what moves
do in general, and what led to the completion, rather than this level's layout.

You have up to ${maxCalls} replies; each may call tools. Use them: study the record with python, test each version, and fix what
test shows wrong. Submit when validation stops improving or your replies run out.`);
  return parts.join('\n\n');
}

async function fit(out: string, model: string, sourceRun: string, sourceRange: string, valRun: string, valRange: string, options: Record<string, string>) {
  const source = sourceOf(sourceRun, sourceRange), valid = sourceOf(valRun, valRange);
  const done = source.window.excluded.find((entry) => entry.why === 'level change');
  if (!done || done.n !== source.window.to) throw new Error('the source span must end with the move that completed the level');
  const completion = { n: done.n, ...Object.fromEntries(['action', 'x', 'y'].map((key, i) => [key, actionOf(source.rows.get(done.n))[i]])) };
  const validation: MoveSet = { ...valid.set, name: 'validation' };
  const shownKeys = new Set(source.set.moves.map((move) => maskedKey(source.window, source.grids.get(move.n - 1)!, move)));
  const novel = new Set(validation.moves.filter((move) => !shownKeys.has(maskedKey(valid.window, valid.grids.get(move.n - 1)!, move))).map((move) => move.n));
  const effort = options.effort ?? (model.startsWith('qwen') ? 'off' : 'medium');
  const maxCalls = Number(options.calls ?? 14);
  const loop: Loop = { model, effort, maxTokens: Number(options['max-tokens'] ?? (model.startsWith('qwen') ? 8_000 : 16_000)), maxCalls,
    budget: Number(options.budget ?? 250_000), dir: join(out, options.label ?? `fit-${model}-${effort}`), shown: [source.set], validation, novel,
    head: [{ role: 'system', content: SYSTEM }, { role: 'user', content: fitPrompt(source, validation, completion, maxCalls) }],
    log: [], tail: [], calls: 0, spent: 0, tests: 0, versions: [], returned: false, persist: options.persist !== '0',
    studyLimit: Number(options['study-limit'] ?? 0) };
  mkdirSync(loop.dir, { recursive: true });
  writeFileSync(join(loop.dir, 'prompt.txt'), `${SYSTEM}\n\n${loop.head[1].content}`);
  await runLoop(loop);
  const best = bestVersion(loop);
  const report: any = { model, effort, calls: loop.calls, tests: loop.tests, spent: loop.spent, stop: loop.stop, best_test: best?.test ?? null,
    source: { harness: source.window.harness, range: sourceRange, moves: source.set.moves.length, completion },
    validation: { harness: valid.window.harness, range: valRange, moves: validation.moves.length, novel: novel.size } };
  if (best) {
    writeFileSync(join(loop.dir, 'final.py'), best.code);
    const s = (await scoreSource(source.window, source.grids, best.code)).results, v = (await scoreSource(valid.window, valid.grids, best.code)).results;
    report.on_source = tally(source.set.moves, s);
    report.on_validation = tally(validation.moves, v);
    report.on_validation_novel = tally(validation.moves.filter((move) => novel.has(move.n)), v);
  }
  writeFileSync(join(loop.dir, 'fit.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(loop.dir, 'state.json'), JSON.stringify({ model, effort, maxTokens: loop.maxTokens, code: best?.code ?? null,
    source: report.source }, null, 1));
  console.log(JSON.stringify({ model, effort, calls: loop.calls, tests: loop.tests, spent: loop.spent, stop: loop.stop, best_test: report.best_test,
    on_source: report.on_source ?? null, on_validation: report.on_validation ?? null, on_validation_novel: report.on_validation_novel ?? null }));
}

// ---------------------------------------------------------------- the planner's tools

const PLAN_GUEST = String.raw`import ast, contextlib, io
req = input


def describe(error, files):
    if isinstance(error, SyntaxError):
        return ("SyntaxError: %s (%s line %s: %s)" % (error.msg, error.filename, error.lineno, (error.text or "").strip()))[:400]
    found = []
    tb = error.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename in files:
            found.append("%s line %s" % (tb.tb_frame.f_code.co_filename, tb.tb_lineno))
        tb = tb.tb_next
    return ((type(error).__name__ + ": " + str(error))[:300] + " " + "; ".join(found[-3:])).strip()


out = {}
model_ns = {"__name__": "world_model"}
try:
    exec(compile(req["model"], "<model>", "exec"), model_ns)
    if not callable(model_ns.get("step")):
        raise ValueError("the model defines no step(grid, action, x, y, history)")
except BaseException as error:
    out["model_error"] = describe(error, ("<model>",))
start = [list(row) for row in req["start"]]
height, width = len(start), len(start[0])
record = []
for segment in req["segments"]:
    grid = [list(row) for row in segment["grid"]]
    first = [row[:] for row in grid]
    played = []
    for move in segment["moves"]:
        after = [row[:] for row in grid]
        for x, y, value in move["delta"]:
            after[y][x] = value
        played.append({"n": move["n"], "action": move["action"], "x": move.get("x"), "y": move.get("y"), "before": grid,
                       "after": after, "state": move.get("state") or "NOT_FINISHED"})
        grid = after
    record.append({"attempt": segment["attempt"], "start": first, "moves": played})


def checked(grid):
    if not isinstance(grid, (list, tuple)) or len(grid) != height or any(
            not isinstance(row, (list, tuple)) or len(row) != width for row in grid):
        raise ValueError("step returned %s, not a grid of %d rows of %d cells" % (type(grid).__name__, height, width))
    return [list(row) for row in grid]


def one_step(model, current, item, history):
    if isinstance(item, str):
        item = [item]
    action = item[0]
    x = item[1] if len(item) > 2 else None
    y = item[2] if len(item) > 2 else None
    past = [{"grid": [row[:] for row in h["grid"]], "action": h["action"], "x": h["x"], "y": h["y"]} for h in history]
    nxt = checked(model([row[:] for row in current], action, x, y, past))
    history.append({"grid": current, "action": action, "x": x, "y": y})
    return nxt


def simulate(actions, grid=None, step=None):
    model = step or model_ns["step"]
    current = [list(row) for row in (grid if grid is not None else start)]
    history, grids = [], []
    for item in actions:
        current = one_step(model, current, item, history)
        grids.append([row[:] for row in current])
    return grids


if "model_error" not in out and req.get("simulate") is not None:
    current = [row[:] for row in start]
    history, deltas = [], []
    try:
        for item in req["simulate"]:
            nxt = one_step(model_ns["step"], current, item, history)
            deltas.append([[x, y, v if isinstance(v, int) else -1] for y, row in enumerate(nxt) for x, v in enumerate(row)
                           if v != current[y][x]])
            current = nxt
    except BaseException as error:
        out["error"] = describe(error, ("<model>",))
        out["error_at"] = len(deltas) + 1
    out["deltas"] = deltas
elif "model_error" not in out:
    ns = {"__name__": "plan", "step": model_ns["step"], "start": [row[:] for row in start], "record": record,
          "simulate": simulate, "busy_rows": req["busy_rows"], "busy_cols": req["busy_cols"]}
    buffer = io.StringIO()
    try:
        tree = ast.parse(req["code"], "<python>", "exec")
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(buffer):
            exec(compile(tree, "<python>", "exec"), ns)
            if last is not None:
                out["value"] = repr(eval(compile(ast.Expression(last.value), "<python>", "eval"), ns))[:4000]
    except BaseException as error:
        out["error"] = describe(error, ("<python>", "<model>"))
    out["printed"] = buffer.getvalue()[:6000]
out
`;
const planner = guestProgram(PLAN_GUEST);

type Context = {
  code: string; original: string; revisions: number; source: Source; segments: any[]; busy: Window['busy'];
  start: Grid; entry: number; prefix: PlanAction[]; agentActions: number | null; maxActions: number;
  env: string; game: string; python: string; clicks: Set<string>; actions: string[];
};

/** The level the target run entered with its move #entry: its first grid, the actions before it, and the run's own count. */
function targetOf(targetRun: string, entry: number) {
  const target = load(harnessOf(targetRun));
  const start = target.grids.get(entry);
  if (!start) throw new Error(`${targetRun} has no grid after #${entry}`);
  const rows = [...target.rows.values()].sort((a, b) => a.n - b.n);
  const done = rows.find((row) => row.n > entry && row.level_changed);
  return { start, prefix: rows.filter((row) => row.n <= entry).map(actionOf), agentActions: done ? done.n - entry : null };
}

function contextOf(state: any, targetRun: string, entry: number, options: Record<string, string>): Context {
  const source = sourceOf(state.source.harness, state.source.range);
  const all = [...moves(source.window), state.source.completion];
  return { code: state.code, original: state.code, revisions: 0, source, segments: recordSegments([source.set]), busy: source.window.busy,
    ...targetOf(targetRun, entry), entry, maxActions: Number(options['max-actions'] ?? 60), env: options.env ?? DEFAULT_ENV,
    game: options.game ?? 'su15', python: options.python ?? 'python',
    clicks: new Set(all.filter((move) => move.x !== undefined).map((move) => move.action)), actions: [...new Set(all.map((move) => move.action))].sort() };
}

async function guest(ctx: Context, request: Record<string, unknown>, code = ctx.code): Promise<any> {
  return (await evaluateTaskPython(planner, { model: code, start: ctx.start, segments: ctx.segments, busy_rows: ctx.busy.rows,
    busy_cols: ctx.busy.cols, code: 'None', ...request })).value;
}

async function pythonTool(ctx: Context, code: string): Promise<string> {
  try {
    const value = await guest(ctx, { code });
    if (value.model_error) return `your model does not run: ${value.model_error}`;
    return [value.printed ? `printed:\n${value.printed}` : 'printed nothing', value.value !== undefined ? `value: ${value.value}` : '',
      value.error ? `error: ${value.error}` : ''].filter(Boolean).join('\n').slice(0, 3000);
  } catch (error) {
    return `the sandbox stopped: ${String((error as Error).message ?? error).slice(0, 300)}`;
  }
}

const sourceLine = (t: ReturnType<typeof tally>) => `every cell right on ${t.exact} of ${t.moves}, right outside the lines that change on most moves on ${t.other}`
  + (t.errors ? `, errors on ${t.errors}` : '');

async function reviseTool(ctx: Context, code: string): Promise<string> {
  let value: any;
  try { value = await guest(ctx, {}, code); } catch (error) { return `Not revised: the sandbox stopped: ${String((error as Error).message ?? error).slice(0, 300)}`; }
  if (value.model_error) return `Not revised: ${value.model_error}`;
  const [before, after] = await Promise.all([ctx.code, code].map(async (each) => tally(ctx.source.set.moves,
    (await scoreSource(ctx.source.window, ctx.source.grids, each)).results)));
  ctx.code = code;
  ctx.revisions += 1;
  return `Revised: python and the check of the plan now use this model. On the earlier level's moves it gets ${sourceLine(after)} `
    + `(the model it replaced: ${sourceLine(before)}).`;
}

/**
 * "ACTION6(3,4) ACTION6 x=5 y=6 ACTION7" or a JSON list [["ACTION6", 3, 4], ["ACTION7"]]; a problem when the plan is
 * empty, too long, holds RESET, a click without its cell or a cell outside the grid.
 */
function parsePlan(text: string, ctx: Pick<Context, 'clicks' | 'maxActions' | 'start'>): { actions: PlanAction[]; problem?: string } {
  let actions: PlanAction[] = [];
  if (text.trim().startsWith('[')) {
    try {
      const list = JSON.parse(text.trim());
      if (Array.isArray(list)) actions = list.map((item: any): PlanAction => Array.isArray(item) && item.length >= 3
        ? [String(item[0]).toUpperCase(), Number(item[1]), Number(item[2])] : [String(Array.isArray(item) ? item[0] : item).toUpperCase()]);
    } catch { /* read as text below */ }
  }
  if (!actions.length) for (const m of text.matchAll(/\b(ACTION\d+|RESET)\b\s*(?:\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)|x\s*=\s*(\d{1,3})\s*,?\s*y\s*=\s*(\d{1,3}))?/gi)) {
    const x = m[2] ?? m[4], y = m[3] ?? m[5];
    actions.push(x !== undefined ? [m[1].toUpperCase(), Number(x), Number(y)] : [m[1].toUpperCase()]);
  }
  const click = [...ctx.clicks][0] ?? 'ACTION6';
  const outside = (a: PlanAction) => a.length === 3 && !(a[1] >= 0 && a[1] < ctx.start[0].length && a[2] >= 0 && a[2] < ctx.start.length);
  const problem = !actions.length ? 'it holds no action' : actions.length > ctx.maxActions ? `it holds ${actions.length} actions, more than ${ctx.maxActions}`
    : actions.some((a) => a[0] === 'RESET') ? 'RESET is not part of a plan'
    : actions.some((a) => ctx.clicks.has(a[0]) && a.length < 3) ? `${click} needs its cell, written ${click}(x,y)`
    : actions.some(outside) ? 'a cell lies outside the grid' : undefined;
  return { actions, problem };
}

function planTools(ctx: Context) {
  const click = [...ctx.clicks][0], other = ctx.actions.find((action) => !ctx.clicks.has(action));
  const listed = [click ? `["${click}", 3, 4]` : '', other ? `["${other}"]` : ''].filter(Boolean).join(', ');
  const written = [click ? `${click}(3,4) ${click}(10,4)` : '', other ?? ''].filter(Boolean).join(' ');
  const code = { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] };
  return [
    { type: 'function', function: { name: 'python', description: 'Run Python 3 (standard library). Available: step (your model), start (the '
      + `new level's first grid), simulate(actions, grid=start, step=step) -> the list of grids after each action, actions written like [${listed}], `
      + 'record (the earlier level: attempts {"attempt", "start", "moves": [{"n", "action", "x", "y", "before", "after", "state"}]}), busy_rows '
      + 'and busy_cols. A grid is a list of rows (grid[y][x]). Each call starts afresh. Returns what was printed and the value of a final '
      + 'expression, each cut to 3000 characters.', parameters: code } },
    { type: 'function', function: { name: 'revise', description: 'Replace your model with a complete new source defining step(grid, action, '
      + 'x, y, history), for later python calls and for the check of the plan. Returns how it does on the earlier level\'s moves.', parameters: code } },
    { type: 'function', function: { name: 'submit_plan', description: 'Submit the plan, played once in the real game from the new level\'s '
      + `first grid until it ends, the level is completed or the game is over. Write it as actions separated by spaces, e.g. "${written}".`,
      parameters: { type: 'object', properties: { plan: { type: 'string' }, why: { type: 'string', description: 'How the plan completes the '
        + 'level, and which of its steps your model guesses.' } }, required: ['plan', 'why'] } } },
  ];
}

const PLAN_SYSTEM = 'You plan moves in a deterministic turn-based grid game with a model of its rules that you wrote earlier from the '
  + 'record of another level: a Python function step(grid, action, x, y, history). You cannot play the new level before you submit. '
  + 'You study it in your model with python, may revise the model, and submit one plan, which is played once in the real game. '
  + 'Prefer steps that rest on what the earlier level showed; say in why where your model guesses.';

function planPrompt(ctx: Context, completion: any, maxCalls: number): string {
  const { window, grids } = ctx.source;
  const lines = busyText(window);
  const record = window.attempts.map((attempt) => [`ATTEMPT ${attempt.index}, from this grid:\n${hex(grids.get(attempt.start)!)}`,
    ...attempt.moves.map((move) => `#${move.n} ${label(move)}${move.state ? ` [${move.state}]` : ''}: ${runs(grids.get(move.n - 1)!, grids.get(move.n)!)}`)].join('\n'));
  return [
    `YOUR MODEL of the game, written from the record of an earlier level:\n\`\`\`python\n${ctx.code}\n\`\`\``,
    'THE EARLIER LEVEL (in python: record). A move lists the cells it changed, row by row: "y12 x3-5 4>9" means cells x = 3..5 of '
      + `row 12 went from colour 4 to colour 9.\n\n${record.join('\n\n')}`,
    `#${completion.n} ${label(completion)} then completed the earlier level: the next grid was a new level. It was played on this grid `
      + `(in python: record[-1]["moves"][-1]["after"]):\n${hex(grids.get(completion.n - 1)!)}`,
    ...(lines ? [`LINES THAT CHANGE ON MOST MOVES: ${lines} (a counter or timer, by the record).`] : []),
    `THE NEW LEVEL starts from this grid (in python: start):\n${hex(ctx.start)}`,
    `TASK: find a sequence of at most ${ctx.maxActions} actions that completes the new level. You cannot play it before you submit. `
      + 'Study it in your model with python; where the new level needs what your model does not hold, or your model holds what fits '
      + 'only the earlier level, revise it. Then call submit_plan once: the plan is played once in the real game from the new level\'s '
      + `first grid, until it ends, the level is completed or the game is over. You have up to ${maxCalls} replies; each may call tools.`,
  ].join('\n\n');
}

// ---------------------------------------------------------------- judging a plan

function judge(ctx: Pick<Context, 'env' | 'game' | 'python' | 'prefix'>, plan: PlanAction[]) {
  const script = fileURLToPath(new URL('./arc_local_judge.py', import.meta.url));
  const child = spawnSync(ctx.python, ['-I', script], { input: JSON.stringify({ env_dir: ctx.env, game: ctx.game, prefix: ctx.prefix, plan }),
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: 600_000 });
  if (child.error || child.status !== 0) throw new Error(`the judge failed: ${child.error?.message ?? ''} ${(child.stderr || child.stdout || '').slice(-800)}`);
  return JSON.parse(child.stdout.trim().split('\n').at(-1)!) as { start: { grid: Grid; levels_completed: number }; completed_at: number | null;
    game_over_at: number | null; steps: Array<{ grid?: Grid; state?: string; levels_completed?: number; refused?: string }> };
}

const outsideWrong = (a: Grid, b: Grid, busy: Window['busy']) => {
  let wrong = 0;
  for (let y = 0; y < b.length; y += 1) for (let x = 0; x < b[y].length; x += 1)
    if (!busy.rows.includes(y) && !busy.cols.includes(x) && a[y][x] !== b[y][x]) wrong += 1;
  return wrong;
};

/**
 * One play of the plan in the local game, and the model against it: each move predicted from the real grid before it
 * (the fitted model, and the revised one if any), and the dream: the plan simulated in the final model from the start,
 * against the real grids, outside the busy lines. The move that completes the level leaves its grids and is not compared.
 */
async function judged(ctx: Context, actions: PlanAction[]) {
  const result = judge(ctx, actions);
  const real = result.steps.flatMap((step) => step.grid ? [step.grid] : []);
  const compared = result.completed_at ? result.completed_at - 1 : real.length;
  const played: Move[] = actions.slice(0, real.length).map((action, i) => ({ n: i + 1, action: action[0],
    ...(action.length === 3 ? { x: action[1], y: action[2] } : {}), attempt: 1, index: i, kind: 'later' as const, changed: 0, changed_busy: 0, seen: false }));
  const window: Window = { harness: '', from: 1, to: played.length, width: ctx.start[0].length, height: ctx.start.length,
    attempts: played.length ? [{ index: 1, start: 0, moves: played }] : [], excluded: [], busy: ctx.busy };
  const grids = new Map<number, Grid>([[0, result.start.grid], ...real.map((grid, i) => [i + 1, grid] as [number, Grid])]);
  for (const move of played) {
    const cells = delta(grids.get(move.n - 1)!, grids.get(move.n)!);
    move.changed_busy = cells.filter(([x, y]) => busyCell(window, x, y)).length;
    move.changed = cells.length - move.changed_busy;
  }
  const pick = (move: Move) => move.n <= compared;
  const report: any = { start_matches_record: JSON.stringify(result.start.grid) === JSON.stringify(ctx.start), played: real.length,
    completed_at: result.completed_at, game_over_at: result.game_over_at, refused: result.steps.find((step) => step.refused)?.refused ?? null,
    real: result.steps.map((step, i) => ({ step: i + 1, state: step.state, levels_completed: step.levels_completed,
      changed_outside: step.grid ? outsideWrong(grids.get(i)!, step.grid, ctx.busy) : null })) };
  const models: Array<[string, string]> = [['fitted', ctx.original], ...(ctx.code !== ctx.original ? [['revised', ctx.code] as [string, string]] : [])];
  for (const [name, code] of models)
    report[`${name}_on_real_moves`] = tally(played.filter(pick), (await scoreSource(window, grids, code, pick)).results);
  const dreamed = await guest(ctx, { simulate: actions });
  const dreamGrids: Grid[] = [];
  let current = ctx.start;
  for (const cells of dreamed.deltas ?? []) {
    current = current.map((row) => [...row]);
    for (const [x, y, value] of cells) current[y][x] = value;
    dreamGrids.push(current);
  }
  const wrong = dreamGrids.slice(0, compared).map((grid, i) => outsideWrong(grid, real[i], ctx.busy));
  const firstWrong = wrong.findIndex((cells) => cells > 0);
  report.dream = { compared: wrong.length, wrong_cells_by_step: wrong, first_wrong_step: firstWrong >= 0 ? firstWrong + 1 : null,
    error: dreamed.model_error ?? dreamed.error ?? null, error_at: dreamed.model_error ? 1 : dreamed.error_at ?? null };
  return report;
}

// ---------------------------------------------------------------- plan

async function plan(out: string, labelName: string, targetRun: string, entryText: string, options: Record<string, string>) {
  const dir = join(out, labelName);
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  if (!state.code) throw new Error(`${dir} has no fitted step()`);
  const ctx = contextOf(state, targetRun, Number(entryText), options);
  const pdir = join(dir, options.name ?? `plan-${ctx.entry}`);
  mkdirSync(pdir, { recursive: true });
  const maxCalls = Number(options.calls ?? 8), budget = Number(options.budget ?? 150_000);
  const head = [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content: planPrompt(ctx, state.source.completion, maxCalls) }];
  writeFileSync(join(pdir, 'prompt.txt'), head.map((message) => message.content).join('\n\n'));
  const loop = { model: state.model, effort: options.effort ?? state.effort, maxTokens: state.maxTokens, dir: pdir } as Loop;
  const tools = planTools(ctx);
  const exchanges: Array<{ messages: any[]; keys: string[] }> = [];
  let spent = 0, calls = 0, stop = '';
  let submitted: { actions: PlanAction[]; text: string; why: string } | undefined;
  while (!submitted) {
    if (calls >= maxCalls) { stop = `replies used (${calls})`; break; }
    if (spent >= budget) { stop = `budget spent (${spent} of ${budget})`; break; }
    // An exchange whose tool call is repeated later is left out: the gateway refuses a history that repeats a call.
    const live = exchanges.filter((exchange, i) => !exchange.keys.some((key) => exchanges.slice(i + 1).some((later) => later.keys.includes(key))));
    const messages = [...head, ...live.flatMap((exchange) => exchange.messages)];
    let reply;
    try { reply = await completeTools(loop, messages, tools); } catch (error) {
      appendFileSync(join(pdir, 'calls.jsonl'), JSON.stringify({ call: calls + 1, error: String((error as Error).message) }) + '\n');
      stop = `call failed: ${String((error as Error).message).slice(0, 200)}`;
      break;
    }
    calls += 1;
    const tokens = budgetTokens(reply.usage);
    spent += tokens;
    appendFileSync(join(pdir, 'replies.jsonl'), JSON.stringify({ call: calls, text: reply.text, tools: reply.calls.map((call) => call.name) }) + '\n');
    appendFileSync(join(pdir, 'calls.jsonl'), JSON.stringify({ call: calls, finish: reply.finish, seconds: reply.seconds, usage: reply.usage,
      budget_tokens: tokens, reasoning_chars: reply.reasoning_chars, tools: reply.calls.map((call) => call.name),
      request_chars: JSON.stringify(messages).length }) + '\n');
    const exchange = { messages: [] as any[], keys: [] as string[] };
    exchanges.push(exchange);
    if (!reply.calls.length) exchange.messages.push({ role: 'assistant', content: reply.text },
      { role: 'user', content: 'Use the tools: python to study the new level in your model, revise to change the model, submit_plan to end.' });
    else {
      exchange.messages.push({ role: 'assistant', content: reply.text,
        tool_calls: reply.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });
      for (const call of reply.calls) {
        exchange.keys.push(createHash('sha1').update(call.name + call.arguments).digest('hex'));
        let args: any, text: string;
        try { args = JSON.parse(call.arguments || '{}'); } catch { args = undefined; }
        if (args === undefined) text = `the arguments were not complete JSON${reply.finish === 'length' ? ' (the reply hit its token limit: send shorter code)' : ''}`;
        else if (submitted) text = 'Not run: the plan is submitted.';
        else if (call.name === 'python') text = await pythonTool(ctx, String(args.code ?? ''));
        else if (call.name === 'revise') text = await reviseTool(ctx, String(args.code ?? ''));
        else if (call.name === 'submit_plan') {
          const parsed = parsePlan(String(args.plan ?? ''), ctx);
          if (parsed.problem) text = `Not submitted: ${parsed.problem}.`;
          else { submitted = { actions: parsed.actions, text: String(args.plan), why: String(args.why ?? '') }; text = 'Submitted.'; }
        } else text = `no tool ${call.name}; the tools are python, revise and submit_plan`;
        exchange.messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        appendFileSync(join(pdir, 'steps.jsonl'), JSON.stringify({ call: calls, tool: call.name, code: args?.code ?? null, plan: args?.plan ?? null,
          why: args?.why ?? null, result: text }) + '\n');
      }
    }
    const left = maxCalls - calls;
    if (!submitted) exchange.messages.at(-1).content += `\n\n[replies left: ${left}]` + (left === 1 ? ' Your next reply is the last: submit your plan in it.' : '');
    console.log(`reply ${calls} (${tokens} budget tokens, ${reply.seconds} s): ${reply.calls.map((call) => call.name).join(', ') || 'no tool call'}`);
  }
  writeFileSync(join(pdir, 'messages.json'), JSON.stringify([...head, ...exchanges.flatMap((exchange) => exchange.messages)], null, 1));
  const report: any = { model: state.model, effort: loop.effort, calls, spent, stop: submitted ? 'submitted' : stop, target: targetRun, entry: ctx.entry,
    max_actions: ctx.maxActions, agent_actions_on_level: ctx.agentActions, revisions: ctx.revisions };
  if (ctx.code !== ctx.original) writeFileSync(join(pdir, 'revised.py'), ctx.code);
  if (submitted) Object.assign(report, { plan: submitted.actions, plan_text: submitted.text, why: submitted.why }, await judged(ctx, submitted.actions));
  writeFileSync(join(pdir, 'plan.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ calls, spent, stop: report.stop, revisions: ctx.revisions, plan_length: report.plan?.length ?? null,
    completed_at: report.completed_at ?? null, game_over_at: report.game_over_at ?? null, agent_actions_on_level: ctx.agentActions,
    fitted_on_real_moves: report.fitted_on_real_moves ?? null, revised_on_real_moves: report.revised_on_real_moves ?? null,
    dream_first_wrong_step: report.dream?.first_wrong_step ?? null }));
}

// ---------------------------------------------------------------- baselines and the check

function baseline(out: string, name: string, targetRun: string, entryText: string, actionsRun: string, range: string, options: Record<string, string>) {
  const target = targetOf(targetRun, Number(entryText));
  const [a, b] = span(range);
  const actions = [...load(harnessOf(actionsRun)).rows.values()].filter((row) => row.n >= a && row.n <= b && row.action !== 'RESET')
    .sort((p, q) => p.n - q.n).map(actionOf);
  const result = judge({ env: options.env ?? DEFAULT_ENV, game: options.game ?? 'su15', python: options.python ?? 'python', prefix: target.prefix }, actions);
  const report = { name, target: targetRun, entry: Number(entryText), actions_from: `${actionsRun} #${a}-#${b}`, actions: actions.length,
    start_matches_record: JSON.stringify(result.start.grid) === JSON.stringify(target.start), played: result.steps.length,
    completed_at: result.completed_at, game_over_at: result.game_over_at, agent_actions_on_level: target.agentActions };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `baseline-${name}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
  return report;
}

async function check(out: string, run: string, sourceRange: string, entryText: string, controlRange: string) {
  const source = sourceOf(run, sourceRange);
  const done = source.window.excluded.find((entry) => entry.why === 'level change')!;
  const [action, x, y] = actionOf(source.rows.get(done.n));
  console.log(`source ${sourceRange}: ${source.set.moves.length} moves, busy ${busyText(source.window) || 'none'}, completion #${done.n} `
    + `${action} ${x} ${y}; coverage: ${coverageText(source.set)}`);
  const identity = 'def step(grid, action, x, y, history):\n    return [row[:] for row in grid]\n';
  const state = { code: identity, source: { harness: source.window.harness, range: sourceRange, completion: { n: done.n, action, x, y } } };
  const ctx = contextOf(state, run, Number(entryText), {});
  const click = [...ctx.clicks][0];
  console.log(`target: entry #${ctx.entry}, ${ctx.prefix.length} actions before it, the run took ${ctx.agentActions}; actions ${ctx.actions.join(', ')}`);
  console.log('--- python');
  console.log(await pythonTool(ctx, `print(len(record), len(record[0]["moves"]), len(start), len(start[0]), busy_rows)\n`
    + `g = simulate([["${click}", 10, 26], ["${click}", 3, 4]])\nprint(len(g), g[-1] == start)\n`
    + 'def other(grid, action, x, y, history):\n    out = [row[:] for row in grid]\n    out[0][0] = 7\n    return out\n'
    + `simulate([["${click}", 1, 1]], step=other)[0][0][0]`));
  console.log('--- python error');
  console.log(await pythonTool(ctx, 'x = 1\ny = record[99]'));
  console.log('--- a step that returns no grid; revise: a syntax error, then another identity');
  console.log(await pythonTool(ctx, `simulate([["${click}", 1, 1]], step=lambda g, a, x, y, h: None)`));
  console.log(await reviseTool(ctx, 'def step(grid, action, x, y, history)\n    return grid\n'));
  console.log(await reviseTool(ctx, 'def step(grid, action, x, y, history):\n    out = [row[:] for row in grid]\n    return out\n'));
  console.log('--- the planner prompt (start) and tool descriptions (ends)');
  console.log(planPrompt(ctx, state.source.completion, 8).slice(0, 300).replace(/\n/g, ' | '));
  console.log(JSON.stringify(planTools(ctx).map((tool) => tool.function.description.slice(-150))));
  console.log('--- parsePlan');
  for (const text of [`${click}(3,4) ${click} x=5 y=6 ACTION7`, `[["${click}", 3, 4], ["ACTION7"]]`, `${click} ${click}(1,2)`, 'RESET', `${click}(70,2)`, ''])
    console.log(JSON.stringify(text), '->', JSON.stringify(parsePlan(text, ctx)));
  console.log('--- baselines: the target level\'s recorded moves (positive control), the earlier level\'s moves copied (negative)');
  const control = baseline(out, 'control', run, entryText, run, controlRange, {});
  baseline(out, 'copy', run, entryText, run, sourceRange, {});
  console.log(control.completed_at === control.agent_actions_on_level ? 'control: completed where the run did' : 'control: MISMATCH');
  console.log('--- judged: the control\'s moves against the identity model');
  const [a, b] = span(controlRange);
  const actions = [...load(harnessOf(run)).rows.values()].filter((row) => row.n >= a && row.n <= b).sort((p, q) => p.n - q.n).map(actionOf);
  const report = await judged(ctx, actions);
  console.log(JSON.stringify({ ...report, real: report.real.slice(0, 3), dream: { ...report.dream, wrong_cells_by_step: report.dream.wrong_cells_by_step.slice(0, 6) } }));
}

if (isMain(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'fit') await fit(args[0], args[1], args[2], args[3], args[4], args[5], flags(args.slice(6)));
  else if (command === 'plan') await plan(args[0], args[1], args[2], args[3], flags(args.slice(4)));
  else if (command === 'baseline') baseline(args[0], args[1], args[2], args[3], args[4], args[5], flags(args.slice(6)));
  else if (command === 'check') await check(args[0], args[1], args[2], args[3], args[4]);
  else { console.error('usage: arc_world_model_plan.ts fit|plan|baseline|check ... (see the header)'); process.exit(2); }
}
