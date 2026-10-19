/**
 * Round 2 of the offline world model (docs/plans/2026-10-19-offline-world-model.md): a test-driven loop against the
 * three failures of phase 0.
 *
 * - Copying: the last 30% of each attempt's fit moves are validation. They are never shown; `test` scores a step() on
 *   them by counts only, and the version best on them is the result, so a lookup of the moves shown gains nothing.
 * - Effort: a loop of tool calls instead of one reply. `python` runs code on the record shown, `test` scores a step(),
 *   `submit` ends with the code and the situations the record does not decide, each with the move that would decide it.
 * - The data limit: the prompt counts the moves shown by kind (the kinds of
 *   docs/plans/2026-10-19-coverage-attempts-delivery.md: a click by its distance from the area the previous move of its
 *   attempt changed). `experiment` gives a finished fit the outcomes of moves of a kind its record lacks, recorded in
 *   another play of the same level, and scores the code before and after on a third recording of that level.
 *
 * agent <out> <model> [--calls 14] [--budget 400000] [--effort medium|off] [--max-tokens n] [--label name]
 *   <out> is a window directory (tools/arc_world_model.ts window). Writes <out>/<label>/.
 * experiment <out> <label> <experiment run> <from>-<to> <test run> <from>-<to> [--k 3] [--calls 5] [--budget 150000]
 *   continues <out>/<label>; writes <out>/<label>/experiment/.
 * check <out>: the tools on fixed code (the grid unchanged, the oracle), no model call.
 * Usage: node --experimental-transform-types --no-warnings tools/arc_world_model_agent.ts agent|experiment|check ...
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { budgetTokens, buildWindow, busyCell, delta, flags, gateway, guestProgram, hex, isMain, label, load, maskedKey, moves,
  oracleSource, runs, scoreSource, summarize, summaryLine, verdict, type Grid, type Move, type Result, type Window } from './arc_world_model.ts';

type Box = { top: number; left: number; bottom: number; right: number };
/** Moves of one recording that play one part: shown, validation, or experiments. */
type MoveSet = { name: string; window: Window; grids: Map<number, Grid>; moves: Move[]; kinds: Map<number, string> };
type Scored = { sets: Map<string, Map<number, Result>>; compileError?: string };
type Rank = number[];
type Version = { test: number; code: string; rank: Rank; feedback: string };
type Exchange = { messages: any[]; notes: string[]; calls: string[] };
type Loop = {
  model: string; effort: string; maxTokens: number; maxCalls: number; budget: number; dir: string;
  shown: MoveSet[]; validation: MoveSet; novel: Set<number>;
  head: any[]; log: string[]; tail: Exchange[];
  calls: number; spent: number; tests: number; versions: Version[]; returned: boolean;
  submitted?: { test: number; code: string; unknowns: string }; stop?: string;
};

// ---------------------------------------------------------------- coverage (the coverage record's kinds)

const REGIONS: Record<string, string> = { inside: 'inside the last changed area', touching: 'touching the last changed area',
  near: '2-6 cells from the last changed area', far: 'more than 6 cells from the last changed area', first: 'before any change in its attempt' };
const regionOf = (distance: number) => distance <= 0 ? 'inside' : distance === 1 ? 'touching' : distance <= 6 ? 'near' : 'far';
const boxDistance = (x: number, y: number, box: Box) => Math.max(box.left - x, 0, x - box.right, box.top - y, y - box.bottom);
const kindText = (kind: string) => { const [action, region] = kind.split(':'); return region ? `a click ${REGIONS[region]}` : action; };

/**
 * Each move's kind, and after each move the box the latest change of its attempt left (busy lines out). Re-implements
 * moveKinds of demo/arc_thin_coverage.ts (branch claude/r04-cov-20261019) until that module is in this branch.
 */
function coverageOf(window: Window, grids: Map<number, Grid>) {
  const kinds = new Map<number, string>(), boxes = new Map<number, Box | undefined>();
  for (const attempt of window.attempts) {
    let box: Box | undefined;
    for (const move of attempt.moves) {
      kinds.set(move.n, move.x !== undefined && move.y !== undefined
        ? `${move.action}:${box ? regionOf(boxDistance(move.x, move.y, box)) : 'first'}` : move.action);
      const cells = delta(grids.get(move.n - 1)!, grids.get(move.n)!).filter(([x, y]) => !busyCell(window, x, y));
      if (move.state === 'GAME_OVER') box = undefined;
      else if (cells.length) box = { top: Math.min(...cells.map((c) => c[1])), left: Math.min(...cells.map((c) => c[0])),
        bottom: Math.max(...cells.map((c) => c[1])), right: Math.max(...cells.map((c) => c[0])) };
      boxes.set(move.n, box);
    }
  }
  return { kinds, boxes };
}

/** "34 moves: clicks inside the last changed area 20, touching it 1, ...; ACTION7 4; clicked cells by colour: 5: 12, 6: 9". */
function coverageText(set: MoveSet): string {
  const count = new Map<string, number>();
  for (const move of set.moves) count.set(set.kinds.get(move.n)!, (count.get(set.kinds.get(move.n)!) ?? 0) + 1);
  const click = set.moves.find((move) => move.x !== undefined)?.action;
  const parts: string[] = [];
  if (click) parts.push('clicks ' + Object.keys(REGIONS).map((region) => `${REGIONS[region]}: ${count.get(`${click}:${region}`) ?? 0}`).join(', '));
  for (const [kind, n] of [...count].filter(([kind]) => !kind.includes(':')).sort()) parts.push(`${kind}: ${n}`);
  const colours = new Map<number, number>();
  for (const move of set.moves) if (move.x !== undefined && move.y !== undefined) {
    const colour = set.grids.get(move.n - 1)![move.y][move.x];
    colours.set(colour, (colours.get(colour) ?? 0) + 1);
  }
  if (colours.size) parts.push('clicked cells by colour before the click: ' + [...colours].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c.toString(16)}: ${n}`).join(', '));
  return `${set.moves.length} moves; ${parts.join('; ')}`;
}

// ---------------------------------------------------------------- the split

/** Validation: the last 30% (rounded down) of each attempt's fit moves, when it has at least 3; its other fit moves are shown. */
function splitOf(out: string) {
  const window: Window = JSON.parse(readFileSync(join(out, 'window.json'), 'utf8'));
  const { grids } = load(window.harness);
  const { kinds, boxes } = coverageOf(window, grids);
  const train: Move[] = [], val: Move[] = [];
  for (const attempt of window.attempts) {
    const fit = attempt.moves.filter((move) => move.kind === 'fit');
    const held = fit.length >= 3 ? Math.floor(0.3 * fit.length) : 0;
    fit.forEach((move, i) => (i >= fit.length - held ? val : train).push(move));
  }
  const shownKeys = new Set(train.map((move) => maskedKey(window, grids.get(move.n - 1)!, move)));
  const novel = new Set(val.filter((move) => !shownKeys.has(maskedKey(window, grids.get(move.n - 1)!, move))).map((move) => move.n));
  return { window, grids, kinds, boxes, shown: { name: 'shown', window, grids, moves: train, kinds } as MoveSet,
    validation: { name: 'validation', window, grids, moves: val, kinds } as MoveSet, novel };
}

// ---------------------------------------------------------------- prompts

const SYSTEM = 'You find the rules of a deterministic turn-based grid game in a record of its moves and write them as a Python '
  + 'function step(grid, action, x, y, history) that predicts the grid after any move. You work with tools: python runs code on '
  + 'the record shown, test scores a step() on the moves shown and on validation moves you have not seen, submit ends the work.\n'
  + 'Rules are statements over what a grid shows: colours, shapes, sizes, counts, and positions relative to each other and to '
  + 'the acted-on cell. Code that recognises recorded moves (by move number, by the coordinates of particular recorded moves, '
  + 'or by the sequence of earlier actions) reproduces the moves shown and fails on moves never seen, which is how you are '
  + 'scored. Use history only for what the game itself could remember, such as an earlier grid.\n'
  + 'Find one regularity at a time with python, write it into step, test, and look at what is still wrong. Partial rules earn '
  + 'credit; a placeholder earns none.';

function agentPrompt(setup: ReturnType<typeof splitOf>, maxCalls: number): string {
  const { window, grids, shown, validation } = setup;
  const all = moves(window);
  const actions = [...new Set(all.map((move) => move.action))].sort()
    .map((action) => all.some((move) => move.action === action && move.x !== undefined) ? `${action} (with x, y)` : action);
  const shownSet = new Set(shown.moves.map((move) => move.n));
  const attempts = window.attempts.filter((attempt) => attempt.moves.some((move) => shownSet.has(move.n)));
  const lines = (window.busy.rows.length ? [`rows ${window.busy.rows.join(', ')}`] : []).concat(window.busy.cols.length ? [`columns ${window.busy.cols.join(', ')}`] : []);
  const parts = [
    'A record of one level of a turn-based game follows. The game is deterministic: the same grid, earlier moves and action always '
      + 'give the same result. Its rules are not given; find them in the record.',
    `GRID: ${window.width} columns (x = 0..${window.width - 1}, left to right) and ${window.height} rows (y = 0..${window.height - 1}, top to `
      + 'bottom); each cell holds a colour 0-15, written as one hex digit.',
    `ACTIONS in the record: ${actions.join(', ')}. An action with coordinates acts on the cell (x, y). RESET, which restarts the level, `
      + 'is not part of your model.',
    ...(lines.length ? [`LINES THAT CHANGE ON MOST MOVES: ${lines.join('; ')} (each changed on at least 80% of the moves: a counter or timer, by the record).`] : []),
    `THE RECORD SHOWN: the first moves of each of ${attempts.length} attempts at the level, each from the grid shown at its start. A move `
      + 'lists the cells it changed, row by row: "y12 x3-5 4>9" means cells x = 3..5 of row 12 changed from colour 4 to colour 9; '
      + '"no change" means none did. GAME_OVER marks a move that ended the attempt.',
  ];
  const starts: Array<{ index: number; grid: Grid }> = [];
  for (const attempt of attempts) {
    const list = attempt.moves.filter((move) => shownSet.has(move.n));
    const grid = grids.get(attempt.start)!;
    const same = starts.find((earlier) => JSON.stringify(earlier.grid) === JSON.stringify(grid));
    const text = [`ATTEMPT ${attempt.index}: moves #${list[0].n}-#${list.at(-1)!.n}, `
      + (same ? `from the same grid as attempt ${same.index}` : 'from this grid:') + (same ? '' : `\n${hex(grid)}`)];
    if (!same) starts.push({ index: attempt.index, grid });
    for (const move of list)
      text.push(`#${move.n} ${label(move)}${move.state ? ` [${move.state}]` : ''}: ${runs(grids.get(move.n - 1)!, grids.get(move.n)!)}`);
    parts.push(text.join('\n'));
  }
  const heldOut = all.filter((move) => move.kind !== 'fit').length;
  const example = all.find((move) => move.x !== undefined)?.action ?? all[0].action;
  parts.push(`KINDS OF MOVES SHOWN (what the record can teach; a click by its distance from the area the previous move of its `
    + `attempt changed, the lines above left out): ${coverageText(shown)}. The record decides nothing about kinds it lacks.`);
  parts.push(`NOT SHOWN: the next ${validation.moves.length} moves of these attempts (validation: test scores your code on them, `
    + `counts only), and ${heldOut} further moves (the final test).`);
  parts.push(`TASK: write Python 3 (standard library only) defining

def step(grid, action, x, y, history):
    """Returns the grid after one move, as a new list of rows.
    grid: the current grid, a list of ${window.height} rows of ${window.width} ints (grid[y][x]).
    action: the action's name, e.g. "${example}"; x, y: its coordinates, or None for an action without them.
    history: the earlier moves of this attempt, oldest first, each {"grid": the grid before it, "action", "x", "y"};
    the current grid is the result of the last one (history is [] at the start of an attempt)."""

It runs in a sandboxed CPython 3.12 without third-party modules, with a time limit of a few seconds for a whole attempt.

You have up to ${maxCalls} replies; each may call tools. Use them: study the record with python, test each version, and fix what
test shows wrong. Submit when validation stops improving or your replies run out; the version best on validation counts.`);
  return parts.join('\n\n');
}

const TOOLS = [
  { type: 'function', function: { name: 'python', description: 'Run Python 3 on the record shown (read only). `record` is a list of '
    + 'attempts {"attempt": label, "start": grid, "moves": [{"n", "action", "x", "y", "before": grid, "after": grid, "state"}]}; '
    + 'a grid is a list of rows (grid[y][x]); `busy_rows` and `busy_cols` list the lines that change on most moves. Returns what '
    + 'was printed and the value of a final expression, each cut to 3000 characters.',
    parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'test', description: 'Score a complete source defining step(grid, action, x, y, history): on '
    + 'the moves shown, with the moves it gets wrong (the recorded change against yours), and on the validation moves you have not '
    + 'seen, counts only.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'submit', description: 'End the work with your final step() source and the situations the '
    + 'record does not decide.', parameters: { type: 'object', properties: {
      code: { type: 'string' },
      unknowns: { type: 'string', description: 'Up to three situations the record does not decide (kinds of moves with few or no '
        + 'examples, cases your code guesses): for each, what your code predicts, an alternative the record cannot rule out, and '
        + 'the one move that would tell them apart, written ACTION6(x,y) after #n or ACTIONk after #n, #n being a move shown.' } },
      required: ['code', 'unknowns'] } } },
];

// ---------------------------------------------------------------- tools

const EXPLORE = String.raw`import ast, contextlib, io
req = input
src = req["code"]


def where(error):
    if isinstance(error, SyntaxError):
        return "line %s: %s" % (error.lineno, (error.text or "").strip())
    lines = src.splitlines()
    found = []
    tb = error.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "<python>":
            number = tb.tb_lineno
            found.append("line %s: %s" % (number, lines[number - 1].strip() if 0 < number <= len(lines) else ""))
        tb = tb.tb_next
    return "; ".join(found[-3:])


record = []
for segment in req["segments"]:
    grid = [list(row) for row in segment["grid"]]
    start = [row[:] for row in grid]
    played = []
    for move in segment["moves"]:
        after = [row[:] for row in grid]
        for x, y, value in move["delta"]:
            after[y][x] = value
        played.append({"n": move["n"], "action": move["action"], "x": move.get("x"), "y": move.get("y"), "before": grid,
                       "after": after, "state": move.get("state") or "NOT_FINISHED"})
        grid = after
    record.append({"attempt": segment["attempt"], "start": start, "moves": played})
ns = {"__name__": "explore", "record": record, "busy_rows": req["busy_rows"], "busy_cols": req["busy_cols"]}
buffer = io.StringIO()
out = {}
try:
    tree = ast.parse(src, "<python>", "exec")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    with contextlib.redirect_stdout(buffer):
        exec(compile(tree, "<python>", "exec"), ns)
        if last is not None:
            out["value"] = repr(eval(compile(ast.Expression(last.value), "<python>", "eval"), ns))[:4000]
except BaseException as error:
    out["error"] = ((type(error).__name__ + ": " + str(error))[:300] + " " + where(error)).strip()
out["printed"] = buffer.getvalue()[:6000]
out
`;
const explorer = guestProgram(EXPLORE);

/** The record the python tool sees: each shown set's moves, an attempt's from its start, an experiment's from its own grid. */
function recordSegments(shown: MoveSet[]) {
  const segments: any[] = [];
  for (const set of shown) {
    const picked = new Set(set.moves.map((move) => move.n));
    for (const attempt of set.window.attempts) {
      const list = attempt.moves.filter((move) => picked.has(move.n));
      if (!list.length) continue;
      const contiguous = set.name === 'shown';
      const parts = contiguous ? [{ start: attempt.start, list }] : list.map((move) => ({ start: move.n - 1, list: [move] }));
      for (const part of parts) segments.push({ attempt: contiguous ? attempt.index : `${set.name} #${part.list[0].n}`,
        grid: set.grids.get(part.start), moves: part.list.map((move) => ({ n: move.n, action: move.action,
          ...(move.x !== undefined ? { x: move.x, y: move.y } : {}), ...(move.state ? { state: move.state } : {}),
          delta: delta(set.grids.get(move.n - 1)!, set.grids.get(move.n)!) })) });
    }
  }
  return segments;
}

async function python(loop: Loop, code: string): Promise<string> {
  try {
    const value: any = (await evaluateTaskPython(explorer, { code, segments: recordSegments(loop.shown),
      busy_rows: loop.validation.window.busy.rows, busy_cols: loop.validation.window.busy.cols })).value;
    return [value.printed ? `printed:\n${value.printed}` : 'printed nothing', value.value !== undefined ? `value: ${value.value}` : '',
      value.error ? `error: ${value.error}` : ''].filter(Boolean).join('\n').slice(0, 3000);
  } catch (error) {
    return `the sandbox stopped: ${String((error as Error).message ?? error).slice(0, 300)}`;
  }
}

/** One sandbox pass per recording over the moves of all its sets. */
async function scoreSets(sets: MoveSet[], code: string): Promise<Scored> {
  const out: Scored = { sets: new Map() };
  for (const window of new Set(sets.map((set) => set.window))) {
    const group = sets.filter((set) => set.window === window);
    const picked = new Set(group.flatMap((set) => set.moves.map((move) => move.n)));
    const scored = await scoreSource(window, group[0].grids, code, (move) => picked.has(move.n));
    for (const set of group) out.sets.set(set.name, new Map(set.moves.flatMap((move) => scored.results.has(move.n) ? [[move.n, scored.results.get(move.n)!]] : [])));
    out.compileError ??= scored.compileError;
  }
  return out;
}

type Tally = { moves: number; exact: number; other: number; busy: number; errors: number; cells: number };
function tally(list: Move[], results: Map<number, Result>): Tally {
  const t: Tally = { moves: list.length, exact: 0, other: 0, busy: 0, errors: 0, cells: 0 };
  for (const move of list) {
    const r = results.get(move.n);
    if (!r || r.error !== undefined || r.wrong_other === undefined) { t.errors += 1; t.cells += move.changed; continue; }
    t.other += Number(r.wrong_other === 0); t.busy += Number(r.wrong_busy === 0);
    t.exact += Number(r.wrong_other === 0 && r.wrong_busy === 0); t.cells += r.wrong_other;
  }
  return t;
}
const share = (part: number, whole: number) => whole ? part / whole : 0;

/** Validation first (exact moves, then right outside busy lines, then fewer wrong cells), then the moves shown. */
function rankOf(loop: Loop, scored: Scored): Rank {
  const v = tally(loop.validation.moves, scored.sets.get('validation')!);
  const s = loop.shown.map((set) => tally(set.moves, scored.sets.get(set.name)!));
  const extra = s.slice(1).reduce((n, t) => n + t.other, 0);
  return [v.exact, v.other + extra, -v.cells, s[0].exact];
}
const better = (a: Rank, b: Rank) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i]; return true; };

function testFeedback(loop: Loop, scored: Scored, test: number): string {
  if (scored.compileError) return `test #${test}: the code did not run: ${scored.compileError}`;
  const v = tally(loop.validation.moves, scored.sets.get('validation')!);
  const vn = tally(loop.validation.moves.filter((move) => loop.novel.has(move.n)), scored.sets.get('validation')!);
  const lines: string[] = [];
  const shownTallies = loop.shown.map((set) => ({ set, t: tally(set.moves, scored.sets.get(set.name)!) }));
  const [own] = shownTallies;
  lines.push(`test #${test}: every cell right on ${own.t.exact} of ${own.t.moves} moves shown and on ${v.exact} of ${v.moves} `
    + `validation moves you have not seen (${vn.exact} of ${vn.moves} unlike any move shown).`);
  lines.push(`Outside the lines that change on most moves: shown ${own.t.other}/${own.t.moves}, validation ${v.other}/${v.moves}; `
    + `on those lines: shown ${own.t.busy}/${own.t.moves}, validation ${v.busy}/${v.moves}. Errors: shown ${own.t.errors}, validation ${v.errors}.`);
  for (const { set, t } of shownTallies.slice(1))
    lines.push(`${set.name}: every cell right on ${t.exact} of ${t.moves} (outside those lines ${t.other}).`);
  const kindLine = (set: MoveSet, results: Map<number, Result>) => {
    const groups = new Map<string, Move[]>();
    for (const move of set.moves) groups.set(set.kinds.get(move.n)!, [...(groups.get(set.kinds.get(move.n)!) ?? []), move]);
    return [...groups].map(([kind, list]) => `${kindText(kind)} ${tally(list, results).other}/${list.length}`).join(', ');
  };
  lines.push(`Right outside those lines, by kind: shown: ${kindLine(own.set, scored.sets.get('shown')!)}; validation: `
    + `${kindLine(loop.validation, scored.sets.get('validation')!)}.`);
  if (share(own.t.other, own.t.moves) - share(v.other, v.moves) >= 0.25 && share(own.t.other, own.t.moves) >= 0.5)
    lines.push('The code fits the moves shown much better than the validation moves: it reproduces recorded moves rather than rules that hold elsewhere.');
  const wrong: Array<{ set: MoveSet; move: Move; r: Result; cells: number }> = [];
  for (const { set } of shownTallies) for (const move of set.moves) {
    const r = scored.sets.get(set.name)!.get(move.n);
    if (!r) continue;
    const cells = r.error !== undefined ? Infinity : (r.wrong_other ?? 0) + (r.wrong_busy ?? 0);
    if (cells > 0) wrong.push({ set, move, r, cells });
  }
  wrong.sort((a, b) => b.cells - a.cells);
  if (wrong.length) lines.push(`Moves shown it gets wrong (${wrong.length}), most wrong cells first:`);
  for (const { set, move, r, cells } of wrong.slice(0, 5)) {
    const before = set.grids.get(move.n - 1)!;
    const head = `${set.name === 'shown' ? '' : `${set.name} `}#${move.n} ${label(move)} (${kindText(set.kinds.get(move.n)!)})`;
    if (r.error !== undefined) { lines.push(`${head}: ${r.error}`); continue; }
    const yours = before.map((row) => [...row]);
    for (const [x, y, value] of r.changes ?? []) if (typeof value === 'number') yours[y][x] = value;
    const cut = (text: string) => text.length > 420 ? `${text.slice(0, 420)}...` : text;
    lines.push(`${head}: ${cells} cells wrong\n  recorded: ${cut(runs(before, set.grids.get(move.n)!))}\n  yours:    ${cut(runs(before, yours))}`);
  }
  const best = loop.versions.reduce<Version | undefined>((b, version) => !b || better(version.rank, b.rank) ? version : b, undefined);
  if (best) lines.push(`Best on validation so far: test #${best.test}.`);
  return lines.join('\n').slice(0, 3600);
}

async function testTool(loop: Loop, code: string): Promise<{ text: string; version: Version }> {
  loop.tests += 1;
  const scored = await scoreSets([...loop.shown, loop.validation], code);
  const version: Version = { test: loop.tests, code, rank: scored.compileError ? [-1, -1, -Infinity, -1] : rankOf(loop, scored), feedback: '' };
  loop.versions.push(version);
  version.feedback = testFeedback(loop, scored, loop.tests);
  return { text: version.feedback, version };
}

// ---------------------------------------------------------------- the model

/** One streamed chat completion with tools; tool-call fragments are joined by index. */
async function completeTools(loop: Loop, messages: any[]) {
  const { base, key } = gateway();
  const body = { model: loop.model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: loop.maxTokens, stream: true,
    stream_options: { include_usage: true },
    ...(loop.model.startsWith('qwen') ? { enable_thinking: loop.effort !== 'off' } : loop.effort !== 'off' ? { reasoning_effort: loop.effort } : {}) };
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
      const calls: Array<{ id: string; name: string; arguments: string }> = [];
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
            const d = choice.delta ?? {};
            if (d.content) content.push(d.content);
            if (d.reasoning_content) reasoning += d.reasoning_content.length;
            for (const call of d.tool_calls ?? []) {
              const slot = (calls[call.index ?? 0] ??= { id: '', name: '', arguments: '' });
              if (call.id) slot.id = call.id;
              if (call.function?.name) slot.name += call.function.name;
              if (call.function?.arguments) slot.arguments += call.function.arguments;
            }
            finish = choice.finish_reason ?? finish;
          }
        }
      }
      if (streamError && !content.length && !calls.length) { lastError = `stream error: ${streamError}`; continue; }
      return { text: content.join(''), calls: calls.filter(Boolean).map((call, i) => ({ ...call, id: call.id || `call_${Date.now()}_${i}` })),
        finish, usage, reasoning_chars: reasoning, seconds: Math.round((Date.now() - started) / 1000), stream_error: streamError };
    } catch (error) {
      lastError = String((error as Error).message ?? error).slice(0, 400);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`no reply from ${loop.model}: ${lastError}`);
}

/**
 * The request: the head (system, task), a log of folded steps with the best version's code when that step was folded,
 * and the latest exchanges in full. More than 6 exchanges fold the oldest 4, so the prefix stays the same between folds;
 * an exchange whose tool call is repeated later is folded too (the gateway refuses a history repeating a call).
 */
function requestMessages(loop: Loop): any[] {
  const keys = loop.tail.map((exchange) => exchange.calls);
  const repeated = keys.findLastIndex((list, i) => list.some((key) => keys.slice(i + 1).some((later) => later.includes(key))));
  const foldTo = Math.max(loop.tail.length > 6 ? loop.tail.length - 3 : 0, repeated + 1);
  for (const exchange of loop.tail.splice(0, foldTo)) loop.log.push(...exchange.notes);
  const best = loop.versions.reduce<Version | undefined>((b, version) => !b || better(version.rank, b.rank) ? version : b, undefined);
  const bestInTail = best && loop.tail.some((exchange) => exchange.notes.some((note) => note.startsWith(`test #${best.test}:`) || note.startsWith(`submit (test #${best.test})`)));
  const log = loop.log.length ? [{ role: 'user', content: `EARLIER STEPS (folded):\n${loop.log.slice(-40).join('\n')}`
    + (best && !bestInTail ? `\n\nYOUR VERSION BEST ON VALIDATION SO FAR (test #${best.test}):\n\`\`\`python\n${best.code}\n\`\`\`` : '') }] : [];
  return [...loop.head, ...log, ...loop.tail.flatMap((exchange) => exchange.messages)];
}

const first = (text: string, n: number) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > n ? `${line.slice(0, n)}...` : line; };

async function runLoop(loop: Loop) {
  mkdirSync(loop.dir, { recursive: true });
  while (!loop.stop) {
    if (loop.calls >= loop.maxCalls) { loop.stop = `replies used (${loop.calls})`; break; }
    if (loop.spent >= loop.budget) { loop.stop = `budget spent (${loop.spent} of ${loop.budget})`; break; }
    const messages = requestMessages(loop);
    let reply;
    try { reply = await completeTools(loop, messages); } catch (error) {
      appendFileSync(join(loop.dir, 'calls.jsonl'), JSON.stringify({ call: loop.calls + 1, error: String((error as Error).message) }) + '\n');
      loop.stop = `call failed: ${String((error as Error).message).slice(0, 200)}`;
      break;
    }
    loop.calls += 1;
    const tokens = budgetTokens(reply.usage);
    loop.spent += tokens;
    appendFileSync(join(loop.dir, 'calls.jsonl'), JSON.stringify({ call: loop.calls, finish: reply.finish, seconds: reply.seconds,
      usage: reply.usage, budget_tokens: tokens, reasoning_chars: reply.reasoning_chars, tools: reply.calls.map((call) => call.name),
      request_chars: JSON.stringify(messages).length, ...(reply.stream_error ? { stream_error: reply.stream_error } : {}) }) + '\n');
    const exchange: Exchange = { messages: [], notes: [], calls: [] };
    if (!reply.calls.length) {
      exchange.messages.push({ role: 'assistant', content: reply.text },
        { role: 'user', content: 'Use the tools: python to study the record, test to score a step(), submit to end.' });
      exchange.notes.push(`reply ${loop.calls}: no tool call (${first(reply.text, 120)})`);
      loop.tail.push(exchange);
      continue;
    }
    exchange.messages.push({ role: 'assistant', content: reply.text,
      tool_calls: reply.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });
    for (const call of reply.calls) {
      exchange.calls.push(createHash('sha1').update(call.name + call.arguments).digest('hex'));
      let args: any;
      try { args = JSON.parse(call.arguments || '{}'); } catch {
        const text = `the arguments were not complete JSON${reply.finish === 'length' ? ' (the reply hit its token limit: send shorter code)' : ''}`;
        exchange.messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        exchange.notes.push(`${call.name}: ${text}`);
        continue;
      }
      const started = Date.now();
      let text: string;
      if (call.name === 'python') {
        text = await python(loop, String(args.code ?? ''));
        exchange.notes.push(`python: ${first(String(args.code ?? ''), 100)} -> ${first(text, 160)}`);
      } else if (call.name === 'test' || call.name === 'submit') {
        const { text: feedback, version } = await testTool(loop, String(args.code ?? ''));
        const v = version.rank;
        if (call.name === 'test') {
          text = feedback;
          exchange.notes.push(`test #${version.test}: validation ${v[0]}/${loop.validation.moves.length} exact (${feedback.split('\n')[1] ?? ''})`);
        } else {
          const left = loop.maxCalls - loop.calls;
          const weak = (v[0] ?? 0) < 0.9 * loop.validation.moves.length;
          if (left >= 4 && weak && !loop.returned) {
            loop.returned = true;
            text = `${feedback}\n\nNot ended: validation is ${v[0]} of ${loop.validation.moves.length} with ${left} replies left. Continue `
              + 'improving with python and test, or call submit again to end.';
            exchange.notes.push(`submit (test #${version.test}) returned once: validation ${v[0]}/${loop.validation.moves.length}`);
          } else {
            loop.submitted = { test: version.test, code: version.code, unknowns: String(args.unknowns ?? '') };
            loop.stop = 'submitted';
            text = 'Submitted.';
            exchange.notes.push(`submit (test #${version.test}): validation ${v[0]}/${loop.validation.moves.length}`);
          }
        }
      } else {
        text = `no tool ${call.name}; the tools are python, test and submit`;
        exchange.notes.push(text);
      }
      exchange.messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      appendFileSync(join(loop.dir, 'steps.jsonl'), JSON.stringify({ call: loop.calls, tool: call.name, seconds: Math.round((Date.now() - started) / 1000),
        code: args.code ?? null, ...(args.unknowns ? { unknowns: args.unknowns } : {}), result: text }) + '\n');
    }
    loop.tail.push(exchange);
    console.log(`reply ${loop.calls} (${tokens} budget tokens, ${reply.seconds} s): ${exchange.notes.join(' | ').slice(0, 300)}`);
  }
}

const bestVersion = (loop: Loop) => loop.versions.reduce<Version | undefined>((b, version) => !b || better(version.rank, b.rank) ? version : b, undefined);

/** The moves the unknowns name, each with its kind from the grid after the move it names, and whether that kind is rare. */
function proposals(unknowns: string, setup: ReturnType<typeof splitOf>) {
  const count = new Map<string, number>();
  for (const move of setup.shown.moves) count.set(setup.kinds.get(move.n)!, (count.get(setup.kinds.get(move.n)!) ?? 0) + 1);
  const limit = Math.floor(0.05 * setup.shown.moves.length);
  const shownN = new Set(setup.shown.moves.map((move) => move.n));
  const out: Array<{ text: string; action: string; x?: number; y?: number; after?: number; kind: string; shown_of_kind: number; rare: boolean }> = [];
  for (const match of unknowns.matchAll(/\b(ACTION\d+)\s*(?:\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))?[^#\n]{0,24}?#(\d+)/gi)) {
    const [text, action, x, y, after] = match;
    const n = Number(after);
    const box = shownN.has(n) ? setup.boxes.get(n) : undefined;
    const kind = x !== undefined ? `${action.toUpperCase()}:${box ? regionOf(boxDistance(Number(x), Number(y), box)) : 'first'}` : action.toUpperCase();
    const shownOf = count.get(kind) ?? 0;
    out.push({ text, action: action.toUpperCase(), ...(x !== undefined ? { x: Number(x), y: Number(y) } : {}), after: n, kind,
      shown_of_kind: shownOf, rare: shownOf <= limit });
  }
  return out;
}

function summaryOf(setup: ReturnType<typeof splitOf>, results: Map<number, Result>) {
  const summary = summarize(setup.window, results);
  const train = tally(setup.shown.moves, results), val = tally(setup.validation.moves, results);
  return { summary, verdict: verdict(summary), shown: train, validation: val,
    gap_outside_busy: share(train.other, train.moves) - share(val.other, val.moves) };
}

async function agent(out: string, model: string, options: Record<string, string>) {
  const setup = splitOf(out);
  const effort = options.effort ?? (model.startsWith('qwen') ? 'off' : 'medium');
  const maxCalls = Number(options.calls ?? 14);
  const loop: Loop = { model, effort, maxTokens: Number(options['max-tokens'] ?? (model.startsWith('qwen') ? 8_000 : 16_000)), maxCalls,
    budget: Number(options.budget ?? 400_000), dir: join(out, options.label ?? `agent-${model}-${effort}`),
    shown: [setup.shown], validation: setup.validation, novel: setup.novel,
    head: [{ role: 'system', content: SYSTEM }, { role: 'user', content: agentPrompt(setup, maxCalls) }],
    log: [], tail: [], calls: 0, spent: 0, tests: 0, versions: [], returned: false };
  mkdirSync(loop.dir, { recursive: true });
  writeFileSync(join(loop.dir, 'prompt.txt'), `${SYSTEM}\n\n${loop.head[1].content}`);
  await runLoop(loop);
  const best = bestVersion(loop);
  const report: any = { model, effort, calls: loop.calls, tests: loop.tests, spent: loop.spent, stop: loop.stop,
    shown: setup.shown.moves.length, validation: setup.validation.moves.length, novel_validation: setup.novel.size,
    best_test: best?.test ?? null, submitted_test: loop.submitted?.test ?? null, unknowns: loop.submitted?.unknowns ?? null,
    proposals: loop.submitted ? proposals(loop.submitted.unknowns, setup) : [] };
  if (best) {
    writeFileSync(join(loop.dir, 'final.py'), best.code);
    report.final = summaryOf(setup, (await scoreSource(setup.window, setup.grids, best.code)).results);
    if (loop.submitted && loop.submitted.test !== best.test)
      report.submitted = summaryOf(setup, (await scoreSource(setup.window, setup.grids, loop.submitted.code)).results);
  }
  writeFileSync(join(loop.dir, 'agent.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(loop.dir, 'state.json'), JSON.stringify({ model, effort, maxTokens: loop.maxTokens, best_code: best?.code ?? null,
    best_feedback: best?.feedback ?? null, unknowns: loop.submitted?.unknowns ?? null, proposals: report.proposals }, null, 1));
  console.log(JSON.stringify({ model, effort, calls: loop.calls, tests: loop.tests, spent: loop.spent, stop: loop.stop, best_test: report.best_test,
    verdict: report.final?.verdict ?? null, gap: report.final?.gap_outside_busy ?? null }));
  if (report.final) console.log(summaryLine(report.final.summary));
}

// ---------------------------------------------------------------- experiments (the data limit)

function byKind(window: Window, kinds: Map<number, string>, results: Map<number, Result>) {
  const groups: Record<string, Tally> = {};
  const all: Move[] = moves(window);
  for (const kind of new Set(all.map((move) => kinds.get(move.n)!)))
    groups[kind] = tally(all.filter((move) => kinds.get(move.n) === kind), results);
  groups.all = tally(all, results);
  return groups;
}

/**
 * Busy lines over all of a recording's moves that changed something. A recording used only for experiments or testing
 * has no fit moves, from which buildWindow takes them, and without them the counter row would stretch every change box.
 */
function busyOver(window: Window, grids: Map<number, Grid>) {
  const rows = new Map<number, number>(), cols = new Map<number, number>();
  let changed = 0;
  for (const move of moves(window)) {
    const cells = delta(grids.get(move.n - 1)!, grids.get(move.n)!);
    if (!cells.length) continue;
    changed += 1;
    for (const y of new Set(cells.map(([, y]) => y))) rows.set(y, (rows.get(y) ?? 0) + 1);
    for (const x of new Set(cells.map(([x]) => x))) cols.set(x, (cols.get(x) ?? 0) + 1);
  }
  const busy = (counts: Map<number, number>) => [...counts].filter(([, count]) => changed >= 8 && count >= 0.8 * changed).map(([line]) => line).sort((a, b) => a - b);
  window.busy = { rows: busy(rows), cols: busy(cols) };
}

/**
 * The outcomes of k moves of a kind the shown record lacks, taken from another recording of the same level, are given
 * to a finished fit; it continues for a few replies. Both versions are scored on a third recording of the level, by
 * kind. The kind is the first rare kind the fit's unknowns named, if the experiment recording has k moves of it, else
 * the click kind the shown record has fewest of (ties: near).
 */
async function experiment(out: string, labelName: string, expRun: string, expSpan: string, testRun: string, testSpan: string, options: Record<string, string>) {
  const setup = splitOf(out);
  const dir = join(out, labelName);
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  if (!state.best_code) throw new Error(`${dir} has no tested version`);
  const k = Number(options.k ?? 3);
  const span = (text: string) => text.split('-').map(Number) as [number, number];
  const ew = buildWindow(expRun, ...span(expSpan)), tw = buildWindow(testRun, ...span(testSpan));
  const eg = load(ew.harness).grids, tg = load(tw.harness).grids;
  busyOver(ew, eg);
  busyOver(tw, tg);
  const ecov = coverageOf(ew, eg), tcov = coverageOf(tw, tg);
  const ofKind = (kind: string) => moves(ew).filter((move) => ecov.kinds.get(move.n) === kind);
  const named = (state.proposals ?? []).find((p: any) => p.rare && ofKind(p.kind).length >= k)?.kind;
  const shownCount = (kind: string) => setup.shown.moves.filter((move) => setup.kinds.get(move.n) === kind).length;
  const click = setup.shown.moves.find((move) => move.x !== undefined)?.action ?? 'ACTION6';
  const fallback = ['near', 'touching', 'far', 'inside'].map((region) => `${click}:${region}`)
    .filter((kind) => ofKind(kind).length >= k).sort((a, b) => shownCount(a) - shownCount(b))[0];
  const kind = named ?? fallback;
  if (!kind) throw new Error('the experiment recording has no kind with enough moves');
  const chosen = ofKind(kind).slice(0, k);
  const xdir = join(dir, 'experiment');
  mkdirSync(xdir, { recursive: true });
  const experiments: MoveSet = { name: 'experiments', window: ew, grids: eg, moves: chosen, kinds: ecov.kinds };
  const outcomes = chosen.map((move, i) => `EXPERIMENT ${i + 1}: ${label(move)}, ${kindText(kind)}, from this grid:\n${hex(eg.get(move.n - 1)!)}\n`
    + `changed: ${runs(eg.get(move.n - 1)!, eg.get(move.n)!)}`).join('\n\n');
  const maxCalls = Number(options.calls ?? 5);
  const loop: Loop = { model: state.model, effort: state.effort, maxTokens: state.maxTokens, maxCalls, budget: Number(options.budget ?? 150_000),
    dir: xdir, shown: [setup.shown, experiments], validation: setup.validation, novel: setup.novel,
    head: [{ role: 'system', content: SYSTEM }, { role: 'user', content: agentPrompt(setup, maxCalls) },
      { role: 'user', content: `YOUR SUBMITTED WORK (best on validation):\n\`\`\`python\n${state.best_code}\n\`\`\`\n\n${state.best_feedback}\n\n`
        + `YOUR UNKNOWNS: ${state.unknowns ?? '(none)'}` },
      { role: 'user', content: `NEW: the outcomes of ${chosen.length} moves of a kind the record shown had ${shownCount(kind)} of (${kindText(kind)}), `
        + `made in another play of this same level, so from other grids. python's record has them as attempts "experiments #n"; test `
        + `scores them with the moves shown.\n\n${outcomes}\n\nRevise your step() with what they show, test it, and submit.` }],
    log: [], tail: [], calls: 0, spent: 0, tests: 0, versions: [], returned: true };
  writeFileSync(join(xdir, 'prompt.txt'), loop.head.slice(1).map((m: any) => m.content).join('\n\n'));
  const beforeX = (await scoreSource(tw, tg, state.best_code)).results;
  await runLoop(loop);
  const best = bestVersion(loop);
  const after = best?.code ?? state.best_code;
  writeFileSync(join(xdir, 'final.py'), after);
  const afterX = (await scoreSource(tw, tg, after)).results;
  const report = { kind, kind_text: kindText(kind), named_by_unknowns: Boolean(named), k: chosen.length, experiments: chosen.map((move) => move.n),
    experiment_run: ew.harness, test_run: tw.harness, calls: loop.calls, tests: loop.tests, spent: loop.spent, stop: loop.stop,
    before: { test_recording: byKind(tw, tcov.kinds, beforeX), window: summaryOf(setup, (await scoreSource(setup.window, setup.grids, state.best_code)).results) },
    after: { test_recording: byKind(tw, tcov.kinds, afterX), window: summaryOf(setup, (await scoreSource(setup.window, setup.grids, after)).results) } };
  writeFileSync(join(xdir, 'experiment.json'), JSON.stringify(report, null, 1));
  const line = (g: Record<string, Tally>) => Object.entries(g).map(([name, t]) => `${name === 'all' ? 'all' : kindText(name)} ${t.other}/${t.moves}`).join(', ');
  console.log(`kind ${kindText(kind)} (${named ? 'named by the unknowns' : 'fallback'}), experiments ${chosen.map((m) => `#${m.n}`).join(' ')}`);
  console.log(`test recording, right outside busy lines by kind: before ${line(report.before.test_recording)}`);
  console.log(`                                                  after  ${line(report.after.test_recording)}`);
  console.log(JSON.stringify({ spent: loop.spent, calls: loop.calls, stop: loop.stop, window_before: report.before.window.verdict, window_after: report.after.window.verdict }));
}

// ---------------------------------------------------------------- check

async function check(out: string) {
  const setup = splitOf(out);
  const loop: Loop = { model: 'none', effort: 'off', maxTokens: 0, maxCalls: 0, budget: 0, dir: join(out, 'check'), shown: [setup.shown],
    validation: setup.validation, novel: setup.novel, head: [], log: [], tail: [], calls: 0, spent: 0, tests: 0, versions: [], returned: false };
  console.log(`shown ${setup.shown.moves.length}, validation ${setup.validation.moves.length} (${setup.novel.size} unlike any shown); `
    + `coverage: ${coverageText(setup.shown)}`);
  console.log('--- python');
  console.log(await python(loop, 'print(len(record), [len(a["moves"]) for a in record])\n'
    + 'm = record[0]["moves"][0]\nprint(m["n"], m["action"], m["x"], m["y"], sum(a != b for ra, rb in zip(m["before"], m["after"]) for a, b in zip(ra, rb)))\n'
    + 'sorted({a["attempt"] for a in record})'));
  console.log('--- python error');
  console.log(await python(loop, 'x = 1\ny = record[99]'));
  console.log('--- test: the grid unchanged');
  console.log((await testTool(loop, 'def step(grid, action, x, y, history):\n    return [row[:] for row in grid]\n')).text);
  console.log('--- test: the oracle');
  console.log((await testTool(loop, oracleSource(setup.window, setup.grids))).text);
  console.log('--- test: a syntax error');
  console.log((await testTool(loop, 'def step(grid, action, x, y, history)\n    return grid\n')).text);
  console.log('--- proposals parsed from a sample text');
  const sample = setup.shown.moves.at(-1)!;
  console.log(JSON.stringify(proposals(`try ACTION6(1,1) after #${sample.n}; also ACTION7 after #${sample.n}`, setup)));
}

if (isMain(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'agent') await agent(args[0], args[1], flags(args.slice(2)));
  else if (command === 'experiment') await experiment(args[0], args[1], args[2], args[3], args[4], args[5], flags(args.slice(6)));
  else if (command === 'check') await check(args[0]);
  else { console.error('usage: arc_world_model_agent.ts agent <out> <model> ... | experiment <out> <label> <run> <a-b> <run> <a-b> ... | check <out>'); process.exit(2); }
}
