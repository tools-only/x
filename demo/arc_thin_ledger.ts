/**
 * Deterministic ledger for the thin ARC harness. It turns the trajectory (with
 * the agent's optional free-text idea/expect) and the outputs of the agent's own
 * skills into experiments, effort per idea, expected-vs-observed lines, a table of
 * measurements at level completions, and repetition/stall signals. Pure functions;
 * it never judges free text. Design: docs/plans/2026-10-09-lightweight-hypothesis-loop-with-critic.md
 */
import { createHash } from "node:crypto";

export type LedgerRow = {
	n: number; action: string; x?: number; y?: number; idea?: string; expect?: string;
	/** The agent's structured action prediction; only level/WIN fields are used by goal coverage. */
	predict?: { level_changed?: boolean; state?: string };
	prediction?: { fields?: Array<{ field: string; hit: boolean | null; expected?: string; observed?: string }> };
	changed_cells: number | null; level_changed: boolean; state: string; levels_completed: number;
	before_hash?: string; after_hash?: string;
	/** As the bridge reports it after the action: used/maximum for the level, total_used/total_maximum for the run. */
	budget?: { used?: number; maximum?: number | null; total_used?: number; total_maximum?: number | null } | null;
};
export type Observation = { n: number; skill: string; version: number; ok: boolean; value?: unknown; error?: string; warnings?: string[] };
export type Experiment = {
	label: string; labelled: boolean; start: number; end: number; actions: number;
	open: boolean; close_reason?: "idea_changed" | "level_changed" | "game_over" | "reset"; expect?: string;
};
export type IdeaEffort = { label: string; actions: number; last: number; longest: number };
export type Repetition = { n: number; earlier: number[]; key: string };
export type Completion = { n: number; kind: "level" | "game_over"; from: number; to: number; idea?: string; leaves: Record<string, string> };
export type GoalHypothesisRef = { key: string; evidence?: Array<{ action?: number }> };

/**
 * Whether a hypothesis is about the goal, by the words of its own question or key. A compatibility heuristic,
 * not recognition: coverage used to require the question to be exactly "goal", so a run whose agent asked
 * "what is the goal?" was told there were no untested goal hypotheses for 68 actions (hypstrategy ls20, 2026-10-11).
 */
export const isGoalHypothesis = (key: string, question?: string) =>
	/\b(goal|win|wins|winning|objective|level change|complete|completion)\b/i.test(`${question ?? ""} ${key.replace(/[._]/g, " ")}`);

export const gridHash = (grid: unknown) => createHash("sha256").update(JSON.stringify(grid ?? null)).digest("hex").slice(0, 16);
export const actionKey = (row: { action: string; x?: number; y?: number }) =>
	row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;
export const normIdea = (idea: unknown) => typeof idea === "string" ? idea.replace(/\s+/g, " ").trim().slice(0, 80) : "";
const label = (row: LedgerRow) => normIdea(row.idea) || row.action;

/** Consecutive actions with the same idea form one experiment; unlabelled actions group by action name. */
export function groupExperiments(rows: LedgerRow[]): Experiment[] {
	const out: Experiment[] = [];
	for (const row of rows) {
		const current = out.at(-1);
		const name = label(row);
		if (current && current.open && current.label.toLowerCase() === name.toLowerCase()) {
			current.end = row.n; current.actions += 1;
			if (!current.expect && row.expect) current.expect = row.expect;
		} else {
			if (current?.open) { current.open = false; current.close_reason = "idea_changed"; }
			out.push({ label: name, labelled: Boolean(normIdea(row.idea)), start: row.n, end: row.n, actions: 1, open: true,
				...(row.expect ? { expect: row.expect } : {}) });
		}
		const last = out.at(-1)!;
		const reason = row.state === "GAME_OVER" ? "game_over" : row.level_changed ? "level_changed" : row.action === "RESET" ? "reset" : undefined;
		if (reason) { last.open = false; last.close_reason = reason; }
	}
	return out;
}

export function ideaEffort(experiments: Experiment[]): IdeaEffort[] {
	const map = new Map<string, IdeaEffort>();
	for (const e of experiments) {
		const key = e.label.toLowerCase();
		const item = map.get(key) ?? { label: e.label, actions: 0, last: 0, longest: 0 };
		item.actions += e.actions; item.last = Math.max(item.last, e.end); item.longest = Math.max(item.longest, e.actions);
		map.set(key, item);
	}
	return [...map.values()].sort((a, b) => b.last - a.last);
}

/** Same action from the same state gave the same result as an earlier action in this episode. */
export function repetitions(rows: LedgerRow[]): Repetition[] {
	const seen = new Map<string, number[]>();
	const out: Repetition[] = [];
	let episode = 0;
	for (const row of rows) {
		if (row.action === "RESET" || row.state === "GAME_OVER") { episode += 1; seen.clear(); continue; }
		if (!row.before_hash || !row.after_hash) continue;
		const key = `${episode}|${row.before_hash}|${actionKey(row)}|${row.after_hash}`;
		const earlier = seen.get(key) ?? [];
		if (earlier.length) out.push({ n: row.n, earlier: [...earlier], key });
		seen.set(key, [...earlier, row.n]);
	}
	return out;
}

/**
 * Same action from the same state with the same result as earlier on this level, across attempts: unlike
 * repetitions(), a RESET does not clear what was seen, since a line replayed after a reset is what the facts block
 * counts. RESET rows themselves are not compared.
 */
export function levelRepeats(rows: LedgerRow[]): Repetition[] {
	const seen = new Map<string, number[]>();
	const out: Repetition[] = [];
	for (const row of rows) {
		if (row.action === "RESET" || !row.before_hash || !row.after_hash) continue;
		const key = `${row.before_hash}|${actionKey(row)}|${row.after_hash}`;
		const earlier = seen.get(key) ?? [];
		if (earlier.length) out.push({ n: row.n, earlier: [...earlier], key });
		seen.set(key, [...earlier, row.n]);
	}
	return out;
}

/** Actions since the last new state or level progress. */
export function stallLength(rows: LedgerRow[]): number {
	const states = new Set<string>();
	let since = 0;
	for (const row of rows) {
		const fresh = row.after_hash !== undefined && !states.has(row.after_hash);
		if (row.after_hash) states.add(row.after_hash);
		since = fresh || row.level_changed ? 0 : since + 1;
	}
	return since;
}

/** Flatten a JSON value to at most `limit` scalar leaves with short string values. */
export function leaves(value: unknown, limit = 48): Record<string, string> {
	const out: Record<string, string> = {};
	const visit = (item: unknown, path: string, depth: number) => {
		if (Object.keys(out).length >= limit) return;
		if (item === null || typeof item !== "object") { out[path || "value"] = JSON.stringify(item ?? null).slice(0, 40); return; }
		if (depth >= 3) { out[path] = `#${gridHash(item).slice(0, 6)}`; return; }
		if (Array.isArray(item)) {
			if (item.length > 8 || item.some(entry => entry !== null && typeof entry === "object")) { out[path] = `len${item.length}#${gridHash(item).slice(0, 6)}`; return; }
			out[path] = JSON.stringify(item).slice(0, 40); return;
		}
		for (const [key, entry] of Object.entries(item as Record<string, unknown>)) visit(entry, path ? `${path}.${key}` : key, depth + 1);
	};
	visit(value, "", 0);
	return out;
}

/** Observations keyed by state index n (0 = before the first action), then by skill. */
export function observationIndex(rows: Observation[]): Map<number, Map<string, Record<string, string>>> {
	const index = new Map<number, Map<string, Record<string, string>>>();
	for (const row of rows) {
		if (!row.ok) continue;
		const at = index.get(row.n) ?? new Map();
		at.set(row.skill, leaves(row.value));
		index.set(row.n, at);
	}
	return index;
}

function flat(index: Map<number, Map<string, Record<string, string>>>, n: number): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [skill, values] of index.get(n) ?? []) for (const [path, value] of Object.entries(values)) out[`${skill}.${path}`] = value;
	return out;
}

/** Leaf changes between two states, e.g. "strip_status.remaining 14→13". */
export function measurementChanges(index: Map<number, Map<string, Record<string, string>>>, from: number, to: number, limit = 4): string[] {
	const a = flat(index, from), b = flat(index, to);
	const changes = Object.keys(b).filter(key => key in a && a[key] !== b[key]).map(key => `${key} ${a[key]}→${b[key]}`);
	return changes.length > limit ? [...changes.slice(0, limit), `(+${changes.length - limit} more)`] : changes;
}

/** Measurements at the state where each level completion or GAME_OVER happened (the state before that action). */
export function completions(rows: LedgerRow[], experiments: Experiment[], index: Map<number, Map<string, Record<string, string>>>): Completion[] {
	return rows.filter(row => row.level_changed || row.state === "GAME_OVER").map(row => ({
		n: row.n, kind: row.state === "GAME_OVER" ? "game_over" as const : "level" as const,
		from: row.levels_completed - (row.level_changed ? 1 : 0), to: row.levels_completed,
		idea: experiments.find(e => e.start <= row.n && row.n <= e.end)?.label,
		leaves: flat(index, row.n - 1),
	}));
}

/** Leaves equal at every level completion (>= 2) and rarer than half of the other observed states. */
export function constantAtCompletions(done: Completion[], index: Map<number, Map<string, Record<string, string>>>, limit = 4): string[] {
	const levels = done.filter(item => item.kind === "level" && Object.keys(item.leaves).length);
	if (levels.length < 2) return [];
	const at = new Set(levels.map(item => item.n - 1));
	const others = [...index.keys()].filter(n => !at.has(n));
	const out: string[] = [];
	for (const [key, value] of Object.entries(levels[0].leaves)) {
		if (!levels.every(item => item.leaves[key] === value)) continue;
		const same = others.filter(n => flat(index, n)[key] === value).length;
		if (!others.length || same / others.length < 0.5) out.push(`${key}=${value}`);
		if (out.length >= limit) break;
	}
	return out;
}

export type LedgerState = {
	rows: LedgerRow[]; experiments: Experiment[]; effort: IdeaEffort[]; repeats: Repetition[]; stall: number;
	index: Map<number, Map<string, Record<string, string>>>; completions: Completion[]; ticker_cells: number;
	/** Meter lines of the level of the last row, when they were looked for (`lines_on`). */
	lines: MeterLine[]; lines_on: boolean;
};

/** A row or column that fills (or drains) a few cells on nearly every action that changes anything (meterLines). */
export type MeterLine = {
	axis: "row" | "column"; index: number; length: number;
	/** The first action of the run of actions that showed it. */
	since: number;
	/** Non-RESET actions from `since` on that changed anything, and how many of them changed this line. */
	changing: number; hits: number;
	/** Fewest and most cells of the line that one of those actions changed. */
	min: number; max: number;
	/** Whether an action changed a cell of the line that had already changed in the same attempt. */
	again: boolean;
	/** Cells of the line that differ from the state the current attempt started from (the level's start or a RESET). */
	differs: number;
};

export const METER_RUN = 4;
export const METER_CELLS = 4;
export const lineLabel = (line: { axis: "row" | "column"; index: number }) => `${line.axis} ${line.index}`;
const onLine = (line: { axis: "row" | "column"; index: number }, x: number, y: number) => line.axis === "row" ? y === line.index : x === line.index;

function changedCells(before: number[][], after: number[][]): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let y = 0; y < Math.max(before.length, after.length); y += 1)
		for (let x = 0; x < Math.max(before[y]?.length ?? 0, after[y]?.length ?? 0); x += 1)
			if (before[y]?.[x] !== after[y]?.[x]) out.push([x, y]);
	return out;
}

/**
 * Rows and columns that change a few cells on each action whatever the action is: over METER_RUN consecutive non-RESET
 * actions that changed anything, at least two of them different (or one action repeated that changed nothing but the
 * line), each changed 1..METER_CELLS cells of the line that had not changed before in the attempt, and none was a click
 * on the line itself. A bar that fills changes each of its cells once, so the per-cell ticker mask (cells changed on ≥80%
 * of transitions) never covers it: in su15-s04 every press made a new state, and the stall and repeat counts stayed
 * silent while 60 of 94 actions changed only the bottom row (2026-10-16). In su15-r6 one click repeated 32 times changed
 * nothing but that row until the attempt ended, and no line was found, as all 32 were the same action. Counts only:
 * whether such a line is a budget, a clock or the goal is the agent's call. `rows` are one level's actions (the action
 * that completed the level is skipped).
 */
export function meterLines(rows: Array<{ n: number; action: string; x?: number; y?: number; level_changed?: boolean }>,
	grids: Map<number, number[][]>): MeterLine[] {
	type Track = { run: number; keys: Set<string>; start: number; min: number; max: number; alone: boolean };
	const tracks = new Map<string, Track>();
	const found: MeterLine[] = [];
	let changed = new Set<string>();
	const ordered = [...rows].sort((a, b) => a.n - b.n);
	let attemptStart = ordered.length ? ordered[0].n - 1 : 0;
	for (const row of ordered) {
		if (row.level_changed) continue;
		if (row.action === "RESET") { tracks.clear(); changed = new Set(); attemptStart = row.n; continue; }
		const before = grids.get(row.n - 1), after = grids.get(row.n);
		if (!before || !after) continue;
		const diff = changedCells(before, after);
		if (!diff.length) continue;
		const byLine = new Map<string, Array<[number, number]>>();
		for (const [x, y] of diff) {
			byLine.set(`row ${y}`, [...(byLine.get(`row ${y}`) ?? []), [x, y]]);
			byLine.set(`column ${x}`, [...(byLine.get(`column ${x}`) ?? []), [x, y]]);
		}
		for (const line of found) {
			const cells = byLine.get(lineLabel(line));
			line.changing += 1;
			if (!cells) continue;
			line.hits += 1; line.min = Math.min(line.min, cells.length); line.max = Math.max(line.max, cells.length);
			if (cells.some(([x, y]) => changed.has(`${x},${y}`))) line.again = true;
		}
		const clicked = row.x !== undefined && row.y !== undefined;
		for (const [key, cells] of byLine) {
			if (found.some((line) => lineLabel(line) === key)) continue;
			const [axis, at] = key.split(" ");
			const line = { axis: axis as "row" | "column", index: Number(at) };
			const fits = cells.length <= METER_CELLS && cells.every(([x, y]) => !changed.has(`${x},${y}`)) && !(clicked && onLine(line, row.x!, row.y!));
			if (!fits) { tracks.delete(key); continue; }
			const track = tracks.get(key) ?? { run: 0, keys: new Set<string>(), start: row.n, min: cells.length, max: cells.length, alone: true };
			track.run += 1; track.keys.add(actionKey(row));
			track.min = Math.min(track.min, cells.length); track.max = Math.max(track.max, cells.length);
			track.alone &&= cells.length === diff.length;
			tracks.set(key, track);
			if (track.run >= METER_RUN && (track.keys.size >= 2 || track.alone)) {
				const grid = after;
				found.push({ ...line, length: line.axis === "row" ? grid[line.index]?.length ?? 0 : grid.length, since: track.start,
					changing: track.run, hits: track.run, min: track.min, max: track.max, again: false, differs: 0 });
				tracks.delete(key);
			}
		}
		// A run is consecutive: a line this action did not change (in a way that fits) starts over.
		for (const key of [...tracks.keys()]) if (!byLine.has(key)) tracks.delete(key);
		for (const [x, y] of diff) changed.add(`${x},${y}`);
	}
	const start = grids.get(attemptStart), last = ordered.length ? grids.get(ordered.at(-1)!.n) : undefined;
	for (const line of found) {
		if (!start || !last) continue;
		let differs = 0;
		for (let i = 0; i < line.length; i += 1) {
			const [x, y] = line.axis === "row" ? [i, line.index] : [line.index, i];
			if (start[y]?.[x] !== last[y]?.[x]) differs += 1;
		}
		line.differs = differs;
	}
	return found;
}

export type ChangeOnLines = { lines: string[]; on: number; rest: number; box?: { left: number; right: number; top: number; bottom: number } };
/**
 * Action n's change split by the meter lines its level showed by then (`rows`: this level's actions up to n): how many
 * changed cells lie on those lines, and the count and box of the rest. Undefined when no line is known, the action
 * changed none of its cells, or it completed the level. In su15-r7 every receipt's box ran down to the bottom row
 * ("changed=8 in x39-47 y35-63" for a block that moved within x39-41 y35-37).
 */
export function changeOnLines(rows: Array<{ n: number; action: string; x?: number; y?: number; level_changed?: boolean }>,
	grids: Map<number, number[][]>, n: number): ChangeOnLines | undefined {
	const upTo = rows.filter((row) => row.n <= n);
	const row = upTo.find((item) => item.n === n);
	const before = grids.get(n - 1), after = grids.get(n);
	if (!row || row.level_changed || !before || !after) return undefined;
	const found = meterLines(upTo, grids);
	if (!found.length) return undefined;
	const touched = new Set<string>();
	const rest: Array<[number, number]> = [];
	let on = 0;
	for (const [x, y] of changedCells(before, after)) {
		const line = found.find((item) => onLine(item, x, y));
		if (line) { on += 1; touched.add(lineLabel(line)); } else rest.push([x, y]);
	}
	if (!on) return undefined;
	const xs = rest.map(([x]) => x), ys = rest.map(([, y]) => y);
	return { lines: [...touched], on, rest: rest.length,
		...(rest.length ? { box: { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) } } : {}) };
}

/** Meter lines per level (each level searched on its own) and the level each state belongs to. */
function linesByLevel(rows: LedgerRow[], grids: Map<number, number[][]>): { at: (n: number) => MeterLine[]; current: MeterLine[] } {
	const stateLevel = new Map<number, number>();
	const groups = new Map<number, LedgerRow[]>();
	for (const row of [...rows].sort((a, b) => a.n - b.n)) {
		const before = row.levels_completed - (row.level_changed ? 1 : 0);
		if (!stateLevel.has(row.n - 1)) stateLevel.set(row.n - 1, before);
		stateLevel.set(row.n, row.levels_completed);
		groups.set(before, [...(groups.get(before) ?? []), row]);
	}
	const lines = new Map<number, MeterLine[]>();
	for (const [level, group] of groups) lines.set(level, meterLines(group, grids));
	const last = rows.at(-1);
	return { at: (n) => lines.get(stateLevel.get(n) ?? -1) ?? [], current: last ? lines.get(last.levels_completed) ?? [] : [] };
}

/**
 * State hashes that ignore "ticker" cells: cells that changed on at least 80% of
 * the transitions so far (step counters, timers). Without this, a counter makes
 * every state unique and repetition can never be seen. grids[n] is the state after
 * action n (grids[0] before the first action). `linesAt(n)` adds the meter lines
 * that state n's level showed (meterLines).
 */
export function maskedHashes(grids: Map<number, number[][]>, linesAt: (n: number) => MeterLine[] = () => []):
	{ hash: Map<number, string>; ticker: number } {
	const ns = [...grids.keys()].sort((a, b) => a - b);
	const counts = new Map<string, number>();
	let transitions = 0;
	for (let i = 1; i < ns.length; i += 1) {
		const a = grids.get(ns[i - 1])!, b = grids.get(ns[i])!;
		if (ns[i] !== ns[i - 1] + 1) continue;
		transitions += 1;
		for (let y = 0; y < Math.max(a.length, b.length); y += 1)
			for (let x = 0; x < Math.max(a[y]?.length ?? 0, b[y]?.length ?? 0); x += 1)
				if (a[y]?.[x] !== b[y]?.[x]) counts.set(`${x},${y}`, (counts.get(`${x},${y}`) ?? 0) + 1);
	}
	const ticker = new Set(transitions >= 8 ? [...counts].filter(([, count]) => count / transitions >= 0.8).map(([key]) => key) : []);
	const hash = new Map<number, string>();
	for (const [n, grid] of grids) {
		const lines = linesAt(n);
		hash.set(n, gridHash(ticker.size || lines.length
			? grid.map((row, y) => row.map((cell, x) => ticker.has(`${x},${y}`) || lines.some((line) => onLine(line, x, y)) ? -1 : cell)) : grid));
	}
	return { hash, ticker: ticker.size };
}

/** `lines`: also mask the meter lines each level shows (meterLines); off, only ticker cells are masked (until 2026-10-16). */
export function buildLedger(rows: LedgerRow[], observations: Observation[], grids: Map<number, number[][]> = new Map(),
	options: { lines?: boolean } = {}): LedgerState {
	const levels = options.lines ? linesByLevel(rows, grids) : undefined;
	const { hash, ticker } = maskedHashes(grids, levels?.at);
	const hashed = rows.map(row => ({ ...row, before_hash: hash.get(row.n - 1) ?? row.before_hash, after_hash: hash.get(row.n) ?? row.after_hash }));
	const experiments = groupExperiments(hashed);
	const index = observationIndex(observations);
	return { rows: hashed, experiments, effort: ideaEffort(experiments), repeats: repetitions(hashed), stall: stallLength(hashed),
		index, completions: completions(hashed, experiments, index), ticker_cells: ticker,
		lines: levels?.current ?? [], lines_on: Boolean(options.lines) };
}

/**
 * Whether action n moved the state on, for a batch (2026-10-16): the state after it, with ticker cells and (with
 * `lines`) meter lines left out, differs from the state before it and, given `from` (the state the batch started
 * from), from that one too. A RESET and a level change always count. `rows` are this level's actions up to n.
 * A batch that revisits an older state is not stopped: a planned path may cross where it has been. The reason says
 * when the board outside the masked cells last changed: in su15-e1-B1 the agent read the bare stop as a rule of the
 * harness and played the same presses from python.
 */
export function progressAt(rows: LedgerRow[], grids: Map<number, number[][]>, n: number, lines = true, from?: number):
	{ progress: true } | { progress: false; why: string } {
	const upTo = [...rows].filter((row) => row.n <= n).sort((a, b) => a.n - b.n);
	const row = upTo.find((item) => item.n === n);
	if (!row || row.action === "RESET" || row.level_changed) return { progress: true };
	const found = lines ? meterLines(upTo, grids) : [];
	const { hash, ticker } = maskedHashes(grids, () => found);
	const where = [...found.map(lineLabel), ...(ticker ? [`${ticker} cell${ticker === 1 ? "" : "s"} that change on most actions`] : [])];
	const since = () => {
		const last = [...upTo].reverse().find((item) => item.n < n && hash.has(item.n) && hash.has(item.n - 1) && hash.get(item.n) !== hash.get(item.n - 1));
		return `; outside ${where.length ? "them" : "recurring cells"} the board has not changed ${last ? `since #${last.n}` : "on this level"}`;
	};
	if (row.changed_cells === 0) return { progress: false, why: `#${n} changed nothing${since()}` };
	const after = hash.get(n);
	if (after === undefined) return { progress: true };
	if (hash.get(n - 1) === after)
		return { progress: false, why: `#${n} changed only cells that change on (nearly) every action${where.length ? ` (${where.join(", ")})` : ""}${since()}` };
	if (from !== undefined && from < n - 1 && hash.get(from) === after) return { progress: false, why: `#${n} brought back the state this batch started from` };
	return { progress: true };
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Counts over exact grids (no masking): where the current grid was seen before, what was tried from it with how
 * many distinct results, which available actions were never tried from it, and how many grids in the last 10
 * actions were new. Counting only; broader "same situation" is the agent's to define in a skill.
 * Real failure: hypstrategy ls20 (2026-10-11) reset to the same start grid 15 times and tried the same action
 * from it again and again ("move up" at #23, #34, #40, #51, #57).
 */
export function explorationLine(rows: Array<{ n: number; action: string; x?: number; y?: number }>, grids: Map<number, unknown>,
	current: number, available: string[], window = 10): string {
	const grid = grids.get(current);
	if (grid === undefined || rows.length < 3) return "";
	const hashes = new Map<number, string>();
	for (const [n, g] of grids) hashes.set(n, gridHash(g));
	const here = hashes.get(current)!;
	const seen = [...hashes].filter(([n, h]) => h === here && n !== current).map(([n]) => n).sort((a, b) => a - b);
	const tried = new Map<string, Set<string>>();
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (hashes.get(row.n - 1) !== here || !hashes.has(row.n)) continue;
		const key = actionKey(row);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		tried.set(key, (tried.get(key) ?? new Set()).add(hashes.get(row.n)!));
	}
	const firstSeen = new Map<string, number>();
	for (const n of [...hashes.keys()].sort((a, b) => a - b)) if (!firstSeen.has(hashes.get(n)!)) firstSeen.set(hashes.get(n)!, n);
	const recent = [...hashes].filter(([n]) => n > current - window && n <= current);
	const fresh = recent.filter(([n, h]) => firstSeen.get(h) === n).length;
	const never = available.filter((action) => action !== "ACTION6" && ![...counts.keys()].some((key) => key === action));
	const parts = [seen.length ? `this exact grid was also seen at ${seen.slice(-6).map((n) => n === 0 ? "the start" : `#${n}`).join(", ")}` : "this exact grid is new"];
	if (counts.size) parts.push(`from it: ${[...counts].map(([key, count]) => `${key} ${count}× (${tried.get(key)!.size} distinct result${tried.get(key)!.size === 1 ? "" : "s"})`).join(", ")}`);
	if (counts.size && never.length) parts.push(`never tried from it: ${never.join(", ")}`);
	parts.push(`new grids in the last ${Math.min(window, recent.length)} states: ${fresh}`);
	return `EXPLORATION (exact grids): ${parts.join("; ")}`;
}

/** Actions left before the tighter of the level and run budgets is spent, as last reported; null when unbounded or unknown. */
export function budgetLeft(state: LedgerState): number | null {
	const budget = state.rows.at(-1)?.budget;
	if (!budget) return null;
	const left = [
		typeof budget.maximum === "number" && typeof budget.used === "number" ? budget.maximum - budget.used : null,
		typeof budget.total_maximum === "number" && typeof budget.total_used === "number" ? budget.total_maximum - budget.total_used : null,
	].filter((value): value is number => value !== null);
	return left.length ? Math.max(0, Math.min(...left)) : null;
}

/** A goal check is counted only when the agent supplied a structured level/WIN prediction. */
export function goalPredictionRows(state: LedgerState): Array<{ row: LedgerRow; result: "hit" | "MISS" | "unscored" }> {
	return state.rows.flatMap(row => {
		const prediction = row.predict;
		const field = prediction?.level_changed === true ? "level_changed"
			: prediction?.state?.toUpperCase() === "WIN" ? "state" : undefined;
		if (!field) return [];
		const score = row.prediction?.fields?.find(item => item.field === field);
		return [{ row, result: score?.hit === true ? "hit" : score?.hit === false ? "MISS" : "unscored" }];
	});
}

/**
 * Mechanical coverage line for the parent and critic. It reports explicit
 * level/WIN checks and effort spans that contain no such check; it never
 * decides whether an idea or hypothesis is correct.
 */
export function goalCoverageLine(state: LedgerState, hypotheses: GoalHypothesisRef[] = []): string {
	const checks = goalPredictionRows(state);
	const checkedActions = new Set(checks.map(item => item.row.n));
	const checked = checks.length
		? checks.slice(-6).map(item => `#${item.row.n} ${item.result}`).join(", ")
		: "none";
	const untestedHypotheses = hypotheses.filter(item =>
		!(item.evidence ?? []).some(evidence => evidence.action !== undefined && checkedActions.has(Number(evidence.action))))
		.map(item => item.key).slice(0, 4);
	const untestedEffort = state.experiments.filter(experiment =>
		!checks.some(item => item.row.n >= experiment.start && item.row.n <= experiment.end))
		.slice(-4).map(experiment => `${experiment.label}(${experiment.actions})`).join(", ") || "none";
	return `GOAL CHECKS: ${checked}; goal hypotheses without a matching level/WIN prediction: ${untestedHypotheses.join(", ") || "none"}; ` +
		`effort without a level/WIN check: ${untestedEffort}`;
}

export function observedSummary(state: LedgerState, e: Experiment): string {
	const span = state.rows.filter(row => row.n >= e.start && row.n <= e.end);
	const first = span[0], last = span.at(-1);
	const parts: string[] = [];
	if (!first || !last) return "no actions";
	const levelBefore = first.levels_completed - (first.level_changed ? 1 : 0);
	parts.push(last.levels_completed !== levelBefore ? `levels ${levelBefore}→${last.levels_completed}` : "level unchanged");
	if (last.state !== "NOT_FINISHED") parts.push(`state ${last.state}`);
	parts.push(`${span.reduce((sum, row) => sum + (row.changed_cells ?? 0), 0)} cells changed over ${span.length} action(s)`);
	const changes = measurementChanges(state.index, e.start - 1, e.end);
	if (changes.length) parts.push(changes.join(", "));
	return parts.join("; ");
}

/** Read-only working-set lines; each omitted when empty. */
export function renderLedgerView(state: LedgerState, hypothesisKeys: string[], maxChars = 900,
	goalHypotheses: GoalHypothesisRef[] = []): string {
	const lines: string[] = [];
	const current = state.experiments.at(-1);
	if (state.rows.length || goalHypotheses.length) lines.push(goalCoverageLine(state, goalHypotheses));
	if (state.effort.length) {
		const parts = state.effort.slice(0, 5).map(item => {
			const now = current && current.open && current.label.toLowerCase() === item.label.toLowerCase();
			return now ? `${item.label} — ${current!.actions} in a row (#${current!.start}–#${current!.end}), ${item.actions} total`
				: `${item.label} — ${item.actions} actions, last #${item.last}`;
		});
		const labels = new Set(state.effort.map(item => item.label.toLowerCase()));
		const unpursued = hypothesisKeys.filter(key => !labels.has(key.toLowerCase()) && !labels.has(key.replace(/^hyp\./, "").toLowerCase()));
		const left = budgetLeft(state);
		lines.push(`IDEAS: ${parts.join("; ")}${unpursued.length ? `; not pursued by idea label: ${unpursued.slice(0, 4).join(", ")}` : ""}` +
			(left !== null ? `; actions left in budget: ${left}` : ""));
	}
	const shown = [...state.experiments].reverse().find(e => !e.open || e.actions >= 3);
	if (shown && (shown.labelled || shown.expect)) {
		lines.push(`${shown.open ? "CURRENT" : "LAST"} EXPERIMENT ${shown.label} #${shown.start}–#${shown.end}: ` +
			`expected ${shown.expect ? JSON.stringify(clip(shown.expect, 160)) : "(not stated)"} | observed: ${observedSummary(state, shown)}`);
	}
	if (state.completions.length) {
		const items = state.completions.slice(-3).map(item => {
			const values = Object.entries(item.leaves).slice(0, 3).map(([key, value]) => `${key}=${value}`).join(", ");
			return `#${item.n} (${item.kind === "level" ? `level ${item.from}→${item.to}` : "GAME_OVER"}${item.idea ? `, idea=${item.idea}` : ""}${values ? `, ${values}` : ""})`;
		});
		const constant = constantAtCompletions(state.completions, state.index);
		lines.push(`AT COMPLETIONS: ${items.join("; ")}${constant.length ? `; same at every level completion: ${constant.join(", ")}` : ""}`);
	}
	const lastN = state.rows.at(-1)?.n ?? 0;
	const recent = state.repeats.filter(item => item.n > lastN - 10).slice(-2);
	if (recent.length) lines.push(`REPEATS: ${recent.map(item => `#${item.n} gave the same result from the same state as ${item.earlier.map(n => `#${n}`).join(", ")}`).join("; ")}`);
	const text = lines.join("\n");
	return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** The bridge's action budget as reported: used/maximum for the level, total_used/total_maximum for the run. */
export type BudgetReport = LedgerRow["budget"];

const budgetPart = (name: string, used: unknown, maximum: unknown) => typeof used !== "number" ? `${name} unknown`
	: typeof maximum === "number" ? `${name} ${used} of ${maximum} used, ${Math.max(0, maximum - used)} left`
	: `${name} ${used} used, limit unknown`;

/**
 * The runtime's counts for the current level, at the top of each native decision (2026-10-15). In ls20-r03b they were
 * only in data/ledger.md, which the agent read once in 288 actions; r03b on su15 (as GLM's analysis of that run reports
 * it) clicked 25 times in a row with nothing changing. Counts and action numbers only: what they mean is the agent's
 * call. `state` is the ledger over this level's actions.
 */
export function renderFacts(state: LedgerState, budget: BudgetReport, maxChars = 900): string {
	const rows = state.rows;
	const lines = ["RUNTIME FACTS (counted from this level's record; data/ledger.md has more):",
		`ACTION BUDGET (a resource, not the goal): ${budget ? `${budgetPart("level", budget.used, budget.maximum)}; ` +
			budgetPart("run", budget.total_used, budget.total_maximum) : "unknown"}`];
	if (!rows.length) lines.push("EFFORT on this level: no actions yet");
	else {
		// With meter lines on, an action that changed only masked cells (ticker cells, meter lines) is counted apart.
		const byAction = new Map<string, { n: number; quiet: number; masked: number }>();
		for (const row of rows) {
			const item = byAction.get(row.action) ?? { n: 0, quiet: 0, masked: 0 };
			item.n += 1;
			if (row.changed_cells === 0) item.quiet += 1;
			else if (state.lines_on && row.action !== "RESET" && row.before_hash && row.before_hash === row.after_hash) item.masked += 1;
			byAction.set(row.action, item);
		}
		const mix = [...byAction].sort((a, b) => b[1].n - a[1].n);
		const counted = (item: { quiet: number; masked: number }) => [...(item.quiet ? [`${item.quiet} changed nothing`] : []),
			...(item.masked ? [`${item.masked} only recurring cells`] : [])].join(", ");
		const parts = mix.slice(0, 5).map(([action, item]) => `${action} ${item.n}${counted(item) ? ` (${counted(item)})` : ""}`);
		if (mix.length > 5) parts.push(`${mix.length - 5} other actions`);
		const last = rows.at(-1)!;
		let streak = 1;
		while (streak < rows.length && rows[rows.length - 1 - streak].action === last.action) streak += 1;
		const now = [...(streak >= 3 ? [`now ${last.action} ×${streak} in a row since #${rows[rows.length - streak].n}`] : []),
			...(state.stall >= 3 ? [`no new state for the last ${state.stall}`] : [])];
		lines.push(`EFFORT on this level: ${rows.length} action${rows.length === 1 ? "" : "s"} — ${parts.join(", ")}${now.length ? `; ${now.join("; ")}` : ""}`);
	}
	if (state.lines_on && (state.lines.length || state.ticker_cells)) {
		const each = (line: MeterLine) => `${lineLabel(line)} changed on ${line.hits} of the ${line.changing} non-RESET actions that changed ` +
			`anything since #${line.since}, ${line.min === line.max ? line.min : `${line.min}-${line.max}`} cell${line.max === 1 ? "" : "s"} each` +
			`${line.again ? "" : ", each cell once"}; ${line.differs} of its ${line.length} cells differ from this attempt's start`;
		lines.push(`RECURRING CHANGE (left out of the changed-nothing, stall and repeat counts): ${[...state.lines.slice(0, 2).map(each),
			...(state.ticker_cells ? [`${state.ticker_cells} cell${state.ticker_cells === 1 ? "" : "s"} that changed on ≥80% of transitions`] : [])].join("; ")}`);
	}
	const goals = goalPredictionRows(state);
	// Only predict fields count: in su15-r2 the agent tested goal ideas with text predictions, the line said "none", and the
	// refiner, reading "no goal test yet", proposed filling the counter row as a goal test (2026-10-16).
	lines.push(`GOAL TESTS on this level (actions whose predict had level_changed=true or state WIN; text predictions are not counted): ${goals.length
		? (goals.length > 6 ? `${goals.length - 6} earlier, then ` : "") + goals.slice(-6).map(item => `#${item.row.n} ${item.result}`).join(", ")
		: "none"}`);
	const missed = [...rows].reverse().find(row => (row.prediction?.fields ?? []).some(field => field.hit === false));
	if (missed) lines.push(`LATEST MISS: #${missed.n} ` + missed.prediction!.fields!.filter(field => field.hit === false).slice(0, 2)
		.map(field => `${field.field}=${clip(String(field.expected ?? "?"), 60)} (saw ${clip(String(field.observed ?? "?"), 60)})`).join("; "));
	const repeats = levelRepeats(rows);
	if (repeats.length) lines.push(`REPEATS on this level: ${repeats.length} action(s) gave the same result from the same state as an earlier one; ` +
		`latest #${repeats.at(-1)!.n} (as ${repeats.at(-1)!.earlier.slice(-3).map(n => `#${n}`).join(", ")})`);
	const text = lines.join("\n");
	return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
