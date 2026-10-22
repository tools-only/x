/**
 * Work memory (docs/plans/2026-10-20-work-memory.md): each piece of the agent's work exists once, and a repeat becomes a
 * reference to it instead of new text. Idle spinning and re-typed code have one cause: the agent's own past work reached
 * it only as raw transcript text, which is the cheapest thing to copy, and nothing recorded that it was already done or
 * what came of it. Pure functions shared by the runtime (python addresses), the transcript of earlier decisions (repeats
 * rendered as references) and the extension (what this board already showed, the spin streak).
 */
import { createHash } from 'node:crypto';
import { canonical } from './arc_thin_native_loop.ts';

const hash = (text: string, n = 12) => createHash('sha1').update(text).digest('hex').slice(0, n);

// ---------------------------------------------------------------- code

export type PyLine = { key: string; indent: string; starts: boolean };

/**
 * Python code line by line as it computes: each raw line's code without its comment, whitespace outside strings dropped
 * except one space between two word characters (the tokens stay the same), strings (triple-quoted ones across lines too)
 * as typed. `starts`: a top-level statement starts on the line (no indent, not inside brackets, a string or after a
 * backslash, and not an else/elif/except/finally clause).
 */
export function pythonLines(code: string): PyLine[] {
  const out: PyLine[] = [];
  let quote = '', depth = 0, continued = false;
  for (const line of code.split(/\r?\n/)) {
    const inside = quote !== '' || depth > 0 || continued;
    const indent = inside ? '' : /^[ \t]*/.exec(line)![0];
    let key = '', space = false;
    continued = false;
    for (let i = indent.length; i < line.length; i += 1) {
      const ch = line[i];
      if (quote) {
        key += ch;
        if (ch === '\\' && i + 1 < line.length) { key += line[i + 1]; i += 1; }
        else if (line.startsWith(quote, i)) { key += quote.slice(1); i += quote.length - 1; quote = ''; }
        continue;
      }
      if (ch === '#') break;
      if (ch === ' ' || ch === '\t') { space = true; continue; }
      if (space && /\w/.test(key.at(-1) ?? '') && /\w/.test(ch)) key += ' ';
      space = false;
      if (ch === '"' || ch === "'") { quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch; key += quote; i += quote.length - 1; continue; }
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === '\\' && i === line.length - 1) continued = true;
      key += ch;
    }
    // A one-quote string ends with its line (an unterminated one does not parse).
    if (quote.length === 1) quote = '';
    out.push({ key, indent, starts: !inside && indent === '' && key !== '' && !/^(?:else|elif|except|finally)\b/.test(key) });
  }
  return out;
}

/** A python call's computation: its lines as pythonLines reads them, blank and comment lines dropped, indentation kept. */
export const codeKey = (code: string): string => pythonLines(code).filter((line) => line.key).map((line) => line.indent + line.key).join('\n');

export type Statement = { start: number; end: number; key: string; lines: number };

/**
 * The top-level statements of a cell: raw lines [start, end) without trailing blank or comment lines, the code lines they
 * hold and their key. A decorator belongs to the definition under it.
 */
export function topStatements(code: string): Statement[] {
  const lines = pythonLines(code);
  const out: Statement[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].starts) { i += 1; continue; }
    let j = i + 1, last = i + 1, decorated = lines[i].key.startsWith('@');
    for (; j < lines.length; j += 1) {
      if (lines[j].starts) {
        if (!decorated) break;
        decorated = lines[j].key.startsWith('@');
      }
      if (lines[j].key) last = j + 1;
    }
    const held = lines.slice(i, last).filter((line) => line.key);
    out.push({ start: i, end: last, key: held.map((line) => line.indent + line.key).join('\n'), lines: held.length });
    i = j;
  }
  return out;
}

/** Raw lines `from`-`to` of a call (1-based, inclusive) that repeat lines `a`-`b` of call `id`, or all of it (no a, b). */
export type BlockRepeat = { from: number; to: number; id: number; a?: number; b?: number };

/**
 * Runs of whole top-level statements of `code`, at least `min` code lines and not the whole cell, that an earlier call
 * typed in the same order (su15-l0-3 typed one diff loop in 5 cells among other lines). The longest run wins, then the
 * earliest call. Running those lines of that call where they stand computes the same: the session is one namespace.
 */
export function repeatedBlocks(code: string, earlier: Array<{ id: number; code: string }>, min = 4): BlockRepeat[] {
  const key = codeKey(code);
  if (earlier.some((call) => codeKey(call.code) === key)) return [];
  const here = topStatements(code);
  const total = here.reduce((n, s) => n + s.lines, 0);
  const others = earlier.map((call) => ({ id: call.id, statements: topStatements(call.code) }));
  const out: BlockRepeat[] = [];
  for (let i = 0; i < here.length;) {
    let best: { length: number; lines: number; other: typeof others[number]; j: number } | undefined;
    for (const other of others) for (let j = 0; j < other.statements.length; j += 1) {
      let length = 0, lines = 0;
      while (i + length < here.length && j + length < other.statements.length && here[i + length].key === other.statements[j + length].key) {
        lines += here[i + length].lines;
        length += 1;
      }
      if (length && (!best || lines > best.lines)) best = { length, lines, other, j };
    }
    if (!best || best.lines < min || best.lines === total) { i += 1; continue; }
    const { length, other, j } = best;
    const whole = j === 0 && length === other.statements.length;
    out.push({ from: here[i].start + 1, to: here[i + length - 1].end, id: other.id,
      ...(whole ? {} : { a: other.statements[j].start + 1, b: other.statements[j + length - 1].end }) });
    i += length;
  }
  return out;
}

/** "lines 3-11 = P7 lines 2-10; lines 14-18 = all of P9", for a python result's address. */
export const blockNote = (blocks: BlockRepeat[]) =>
  blocks.map((b) => `lines ${b.from}-${b.to} = ${b.a === undefined ? 'all of ' : ''}P${b.id}${b.a === undefined ? '' : ` lines ${b.a}-${b.b}`}`).join('; ');
/** The executable reference to a repeated block: cell(9) for all of P9, cell(7, 2, 10) for its lines 2 to 10. */
const blockCall = (b: BlockRepeat) => b.a === undefined ? `cell(${b.id})` : `cell(${b.id}, ${b.a}, ${b.b})`;

/** The comment lines of a cell, in order (a qwen cell often carries its reasoning there). */
export const commentLines = (code: string) => code.split(/\r?\n/).filter((line) => /^\s*#/.test(line)).map((line) => line.trimEnd());

export type DefBlock = { name: string; signature: string; start: number; end: number; key: string };

/** `def` blocks by indentation, nested ones included: name, signature, line range [start, end) and the body's key. */
export function defBlocks(code: string): DefBlock[] {
  const lines = code.split(/\r?\n/);
  const out: DefBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->[^:]*)?:/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim()) continue;
      if (/^(\s*)/.exec(lines[j])![1].length <= indent) break;
      end = j + 1;
    }
    out.push({ name: m[2], signature: `${m[2]}(${m[3].replace(/\s+/g, ' ').trim()})`, start: i, end,
      key: hash(codeKey(lines.slice(i, end).map((line) => line.slice(Math.min(indent, /^(\s*)/.exec(line)![1].length))).join('\n'))) });
  }
  return out;
}

/**
 * The address the runtime puts first in every python result: "[P12]", for a repeat "[P15 = P12: same code]" (same
 * comments too), "[P15 = P12: same code, other comments]" or "[P15 = P12: same code on the same state, not run again]",
 * and for a cell with repeated blocks "[P15: lines 3-11 = P7 lines 2-10]" (blockNote).
 */
export const PYTHON_MARK = /^\[P(\d+)(?: = P(\d+)(?::([^\]\n]*))?|: (lines [^\]\n]*))?\]/;
export function pythonMark(text: string): { id: number; same?: number; note?: string; blocks?: BlockRepeat[] } | undefined {
  const m = PYTHON_MARK.exec(text.trimStart());
  if (!m) return undefined;
  const blocks = [...(m[4] ?? '').matchAll(/lines (\d+)-(\d+) = (?:all of )?P(\d+)(?: lines (\d+)-(\d+))?/g)]
    .map((b) => ({ from: Number(b[1]), to: Number(b[2]), id: Number(b[3]), ...(b[4] ? { a: Number(b[4]), b: Number(b[5]) } : {}) }));
  return { id: Number(m[1]), ...(m[2] ? { same: Number(m[2]) } : {}), ...(m[3] ? { note: m[3].trim() } : {}), ...(blocks.length ? { blocks } : {}) };
}
/** Ids of earlier calls a cell runs with cell(k) or cell(k, a, b). */
export const cellRefs = (code: string) => [...new Set([...codeKey(code).matchAll(/\bcell\((\d+)[,)]/g)].map((m) => Number(m[1])))];

// ---------------------------------------------------------------- the transcript of earlier decisions

const textOf = (message: any): string => typeof message?.content === 'string' ? message.content
  : (Array.isArray(message?.content) ? message.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('\n');
const calls = (message: any): any[] => message?.role === 'assistant' && Array.isArray(message.content)
  ? message.content.filter((b: any) => b?.type === 'toolCall') : [];

/**
 * Repeats as references. A python call whose result says it repeats an earlier one (PYTHON_MARK) is shown as
 * `cell(<earlier>)`, an executable call, with its own comment lines when they were new; lines it says repeat an earlier
 * call's are shown as `cell(<earlier>, a, b)`; a function defined again with the same body is shown as a one-line stub
 * naming where it was defined; an arc_action whose arguments repeat an earlier call's keeps its actions and drops its
 * reasoning text. What the model can copy from its history is then the call, not the body. A message renders the same
 * way on every request: each decision is fixed by its own call and result.
 */
export function referenceRepeats(messages: any[]): any[] {
  const results = new Map<string, any>();
  for (const message of messages) if (message?.role === 'toolResult') results.set(String(message.toolCallId), message);
  const defs = new Map<string, number>();
  const actions = new Set<string>();
  const topDefs = (code: string) => { const all = defBlocks(code); return all.filter((d) => !all.some((o) => o.start < d.start && o.end >= d.end)); };
  return messages.map((message) => {
    const blocks = calls(message);
    if (!blocks.length) return message;
    let changed = false;
    const content = message.content.map((block: any) => {
      if (block?.type !== 'toolCall') return block;
      const args = block.arguments ?? {};
      if (block.name === 'python' && typeof args.code === 'string') {
        const mark = pythonMark(textOf(results.get(String(block.id))));
        const code: string = args.code;
        if (mark?.same !== undefined) {
          const comments = mark.note && /other comments/.test(mark.note) ? commentLines(code).slice(0, 8) : [];
          changed = true;
          return { ...block, arguments: { ...args, code: [...comments, `cell(${mark.same})`].join('\n') } };
        }
        // Lines that repeat an earlier call's: the call that runs them instead of their text.
        let lines = code.split(/\r?\n/);
        if (mark?.blocks?.length) {
          const kept: string[] = [];
          let at = 0;
          for (const repeat of [...mark.blocks].sort((x, y) => x.from - y.from)) {
            if (repeat.from - 1 < at || repeat.to > lines.length) continue;
            kept.push(...lines.slice(at, repeat.from - 1), blockCall(repeat));
            at = repeat.to;
          }
          lines = [...kept, ...lines.slice(at)];
        }
        // A function defined again with the body it already had: one line instead of the body.
        const stubbed: string[] = [];
        let at = 0;
        for (const def of topDefs(lines.join('\n'))) {
          const where = defs.get(`${def.name}|${def.key}`);
          if (where === undefined || where === mark?.id) continue;
          stubbed.push(...lines.slice(at, def.start), `${/^(\s*)/.exec(lines[def.start])![1]}def ${def.signature}: ...  # same as in P${where}`);
          at = def.end;
        }
        if (mark) for (const def of topDefs(code)) if (!defs.has(`${def.name}|${def.key}`)) defs.set(`${def.name}|${def.key}`, mark.id);
        const shown = [...stubbed, ...lines.slice(at)].join('\n');
        if (shown === code.split(/\r?\n/).join('\n')) return block;
        changed = true;
        return { ...block, arguments: { ...args, code: shown } };
      }
      if (block.name === 'arc_action') {
        const key = JSON.stringify(canonical(args));
        const seen = actions.has(key);
        actions.add(key);
        if (!seen) return block;
        const out: Record<string, unknown> = { ...args };
        for (const field of ['reasoning', 'note']) delete out[field];
        changed = true;
        return { ...block, arguments: out };
      }
      return block;
    });
    return changed ? { ...message, content } : message;
  });
}

/** Lines of a result that record an action ("#12 ACTION1 → ..."). */
const receiptLines = (text: string) => text.split('\n').filter((line) => /^#\d+ (?:ACTION\d|RESET)\b/.test(line));

/**
 * Consecutive decisions with the same prompt and the same calls (after referenceRepeats) are shown once: the last of them,
 * whose first result says how many times it was made and lists the action receipts of the others. su15-chm-q38-1 made one
 * decision of three calls 29 times; each copy made the next one likelier and the request grew to about 90k tokens.
 */
export function collapseRepeatedDecisions(messages: any[]): any[] {
  const starts = messages.map((m, i) => m?.role === 'user' ? i : -1).filter((i) => i >= 0);
  if (starts.length < 2) return messages;
  const segments = starts.map((start, k) => messages.slice(start, starts[k + 1] ?? messages.length));
  const signature = (segment: any[]) => {
    const sent = segment.flatMap(calls);
    if (!sent.length) return '';
    const errors = segment.filter((m) => m?.role === 'toolResult').map((m) => Boolean(m.isError));
    return JSON.stringify([textOf(segment[0]), sent.map((b) => [b.name, canonical(b.arguments ?? {})]), errors]);
  };
  const out: any[] = messages.slice(0, starts[0]);
  for (let i = 0; i < segments.length;) {
    const key = signature(segments[i]);
    let j = i;
    while (key && j + 1 < segments.length && signature(segments[j + 1]) === key) j += 1;
    if (j === i) { out.push(...segments[i]); i += 1; continue; }
    const dropped = segments.slice(i, j).flatMap((segment) => segment.filter((m: any) => m?.role === 'toolResult').flatMap((m: any) => receiptLines(textOf(m))));
    const same = dropped.length > 0 && dropped.every((line) => line.replace(/^#\d+/, '') === dropped[0].replace(/^#\d+/, ''));
    const receipts = !dropped.length ? '' : same
      ? `; their actions: ${dropped[0].replace(/^#\d+/, `#${/^#(\d+)/.exec(dropped[0])![1]}–#${/^#(\d+)/.exec(dropped.at(-1)!)![1]}`)} (×${dropped.length})`
      : `; their actions:\n${dropped.slice(-12).join('\n')}`;
    const note = `(this decision was made ${j - i + 1} times in a row with the same prompt and calls; the earlier ${j - i} are not shown${receipts})`;
    let noted = false;
    for (const message of segments[j]) {
      if (!noted && message?.role === 'toolResult') {
        noted = true;
        out.push({ ...message, content: [{ type: 'text', text: `${note}\n${textOf(message)}` }] });
      } else out.push(message);
    }
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------- the board

export type Played = { n: number; action: string; x?: number; y?: number; decision?: number; changed_cells?: number | null;
  level_changed?: boolean; state?: string; novelty?: Novelty; known_from?: number };
export type Novelty = 'new' | 'known' | 'diverged';
const label = (row: { action: string; x?: number; y?: number }) =>
  row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;

/**
 * Whether move `row` told anything new: `known` when an earlier move from the same board (hash of the state before it)
 * with the same action gave the same board after it, `diverged` when every such earlier move gave a different one (the
 * board does not hold all that decides the outcome), `new` when none was played from that board. `hashes` maps a state
 * index (0 = before the first action) to its board hash, status cells masked as the ledger masks them.
 */
export function noveltyOf(row: Played, earlier: Played[], hashes: Map<number, string>): { novelty: Novelty; known_from?: number; diverged_from?: number } {
  const before = hashes.get(row.n - 1), after = hashes.get(row.n);
  if (before === undefined || after === undefined) return { novelty: 'new' };
  const same = earlier.filter((e) => e.n < row.n && label(e) === label(row) && hashes.get(e.n - 1) === before && hashes.has(e.n));
  if (!same.length) return { novelty: 'new' };
  const known = same.find((e) => hashes.get(e.n) === after);
  return known ? { novelty: 'known', known_from: known.n } : { novelty: 'diverged', diverged_from: same.at(-1)!.n };
}

export type Region = { x: number; y: number; size: number; colour: number; cells: Set<number> };

/**
 * Object regions of a grid: 4-connected cells of one colour other than the grid's most common one, largest first, each with
 * the member nearest its centre as the cell to click and its cells as y*64+x.
 */
export function objectRegions(grid: number[][], limit = 32, mask?: { rows: Set<number>; cols: Set<number>; ticker: Set<string> }): Region[] {
  const hidden = (x: number, y: number) => Boolean(mask && (mask.rows.has(y) || mask.cols.has(x) || mask.ticker.has(`${x},${y}`)));
  const counts = new Map<number, number>();
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[y].length; x += 1) if (!hidden(x, y)) counts.set(grid[y][x], (counts.get(grid[y][x]) ?? 0) + 1);
  const background = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const seen = new Set<number>(), regions: Array<{ colour: number; cells: Array<[number, number]> }> = [];
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[y].length; x += 1) {
    if (hidden(x, y) || grid[y][x] === background || seen.has(y * 64 + x)) continue;
    const colour = grid[y][x], cells: Array<[number, number]> = [], stack: Array<[number, number]> = [[x, y]];
    seen.add(y * 64 + x);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      cells.push([cx, cy]);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as Array<[number, number]>) {
        if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length || hidden(nx, ny) || seen.has(ny * 64 + nx) || grid[ny][nx] !== colour) continue;
        seen.add(ny * 64 + nx);
        stack.push([nx, ny]);
      }
    }
    regions.push({ colour, cells });
  }
  return regions.sort((a, b) => b.cells.length - a.cells.length).slice(0, limit).map(({ colour, cells }) => {
    const mx = cells.reduce((s, [x]) => s + x, 0) / cells.length, my = cells.reduce((s, [, y]) => s + y, 0) / cells.length;
    const [x, y] = cells.reduce((best, cell) => Math.hypot(cell[0] - mx, cell[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? cell : best);
    return { x, y, size: cells.length, colour, cells: new Set(cells.map(([cx, cy]) => cy * 64 + cx)) };
  });
}

export type BoardFacts = {
  /** Earlier state indices with this board (0 = the start). */
  seen: number[];
  tried: Array<{ label: string; count: number; outcome: string; results: number; last: number }>;
  untried: Array<{ action: string; x?: number; y?: number }>;
  objects: number;
};

/**
 * What the board at state `current` already showed: where it was seen before, what was played from it and what came of it,
 * and the candidates never played from it: the offered actions other than RESET and ACTION6, then a click on each object
 * region no click from this board hit.
 */
export function boardFacts(rows: Played[], hashes: Map<number, string>, current: number, grid: number[][] | undefined, available: string[], mask?: { rows: Set<number>; cols: Set<number>; ticker: Set<string> }): BoardFacts {
  const here = hashes.get(current);
  const empty: BoardFacts = { seen: [], tried: [], untried: [], objects: 0 };
  if (here === undefined) return empty;
  const seen = [...hashes].filter(([n, h]) => h === here && n !== current && n <= current).map(([n]) => n).sort((a, b) => a - b);
  const from = rows.filter((row) => row.n <= current && hashes.get(row.n - 1) === here);
  const groups = new Map<string, Played[]>();
  for (const row of from) groups.set(label(row), [...(groups.get(label(row)) ?? []), row]);
  const tried = [...groups].map(([name, list]) => {
    const last = list.at(-1)!;
    const results = new Set(list.map((row) => hashes.get(row.n) ?? `?${row.n}`)).size;
    const outcome = last.level_changed ? 'the level changed' : last.state === 'GAME_OVER' ? 'GAME_OVER'
      : last.changed_cells === 0 ? 'no change' : hashes.get(last.n) === here ? 'only status cells changed'
      : `${last.changed_cells ?? '?'} cells changed`;
    return { label: name, count: list.length, outcome, results, last: last.n };
  }).sort((a, b) => b.count - a.count || b.last - a.last);
  const regions = grid && available.includes('ACTION6') ? objectRegions(grid, 32, mask) : [];
  const clicked = from.filter((row) => row.action === 'ACTION6' && row.x !== undefined && row.y !== undefined).map((row) => row.y! * 64 + row.x!);
  const untried = [
    ...available.filter((name) => name !== 'RESET' && name !== 'ACTION6' && !groups.has(name)).map((action) => ({ action })),
    ...regions.filter((region) => !clicked.some((cell) => region.cells.has(cell))).map((region) => ({ action: 'ACTION6', x: region.x, y: region.y })),
  ];
  return { seen, tried, untried, objects: regions.length };
}

const moveLabel = (move: { action: string; x?: number; y?: number }) => label(move);

/** THIS BOARD, for the head of a decision whose board was seen before; empty otherwise. */
export function boardText(facts: BoardFacts, limit = 450): string {
  if (!facts.seen.length) return '';
  const where = facts.seen.length > 4 ? `${facts.seen.slice(0, 2).map(at).join(', ')}, … ${at(facts.seen.at(-1)!)} (${facts.seen.length} times)`
    : facts.seen.map(at).join(', ');
  const parts = [`THIS BOARD (status cells masked) was here before: ${where}.`];
  if (facts.tried.length) parts.push(`From it: ${facts.tried.slice(0, 6).map((t) => `${t.label}${t.count > 1 ? ` ×${t.count}` : ''} → ${t.outcome}` +
    (t.results > 1 ? ` (${t.results} different results)` : '')).join('; ')}${facts.tried.length > 6 ? `; ${facts.tried.length - 6} more` : ''}.`);
  if (facts.untried.length) {
    const keys = facts.untried.filter((m) => m.action !== 'ACTION6').map(moveLabel);
    const clicks = facts.untried.filter((m) => m.action === 'ACTION6').map(moveLabel);
    parts.push(`Never tried from it: ${[...keys, ...(clicks.length ? [`clicks on ${clicks.length} of ${facts.objects} objects: ${clicks.slice(0, 5).join(', ')}${clicks.length > 5 ? ', …' : ''}`] : [])].join('; ')}.`);
  }
  const text = parts.join(' ');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
const at = (n: number) => n === 0 ? 'the start' : `#${n}`;

/**
 * Decisions in a row, latest first, whose actions all gave results already known from the same board: nothing new was
 * learned. A RESET is neutral (it is how a new attempt starts), and so is a decision without actions; a level change or a
 * new or diverging result ends the streak.
 */
export function spinStreak(rows: Played[]): { streak: number; decisions: number[]; moves: string[]; since?: number } {
  const byDecision = new Map<number, Played[]>();
  for (const row of rows) if (row.decision !== undefined) byDecision.set(row.decision, [...(byDecision.get(row.decision) ?? []), row]);
  const order = [...byDecision.keys()].sort((a, b) => a - b);
  const decisions: number[] = [], moves: string[] = [];
  let since: number | undefined;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const played = byDecision.get(order[i])!.filter((row) => row.action !== 'RESET');
    if (!played.length) continue;
    if (played.some((row) => row.level_changed || row.novelty !== 'known')) break;
    decisions.push(order[i]);
    for (const row of played) { if (!moves.includes(label(row))) moves.push(label(row)); since = Math.min(since ?? Infinity, row.known_from ?? row.n); }
  }
  return { streak: decisions.length, decisions, moves, ...(since !== undefined && Number.isFinite(since) ? { since } : {}) };
}
