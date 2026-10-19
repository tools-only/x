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
	prediction?: { fields?: Array<{ field: string; hit: boolean | null }> };
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
 * su15-g56-1 (2026-10-19) asked "what completes level 1?", which "complete" alone did not match; "completed" stays
 * out (its control question was "how are completed color-6 blocks moved").
 */
export const isGoalHypothesis = (key: string, question?: string) =>
	/\b(goal|win|wins|winning|won|objective|level change|complete|completes|completion)\b/i.test(`${question ?? ""} ${key.replace(/[._]/g, " ")}`);

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
};

/** One changed cell: [x, y, value before, value after] (undefined where a grid has no such cell). */
export type CellChangeOf = [x: number, y: number, from: number | undefined, to: number | undefined];

/**
 * The status cells and lines of a run, from the cells each of its transitions changed: "ticker" cells that changed on
 * at least 80% of the transitions (step counters, timers), and rows or columns whose cells other than tickers were
 * recoloured one way (no value both left and arrived in the line) on at least 80% of them; none before 8 transitions.
 * A bar that shrinks by a few cells per action changes each of its cells once, so none of them is a ticker, but its
 * line is recoloured on every action; an object moving along a line takes its values with it, so its track is not
 * masked. Record: docs/plans/2026-10-19-ledger-busy-lines.md. The ledger's state hashes and the move coverage's boxes
 * and grid keys (arc_thin_coverage.ts) mask the same cells, each over its own transitions.
 */
export function statusMask(transitions: CellChangeOf[][]): { ticker: Set<string>; rows: Set<number>; cols: Set<number> } {
	/** Keys found among the changes of at least 80% of the transitions (none before 8 transitions). */
	const frequent = <K>(lists: K[][]) => {
		const counts = new Map<K, number>();
		for (const keys of lists) for (const key of new Set(keys)) counts.set(key, (counts.get(key) ?? 0) + 1);
		return new Set(lists.length >= 8 ? [...counts].filter(([, count]) => count / lists.length >= 0.8).map(([key]) => key) : []);
	};
	const ticker = frequent(transitions.map(changed => changed.map(([x, y]) => `${x},${y}`)));
	// Lines count only the changes of their other cells: a ticker cell alone would hide its whole row and column.
	const other = transitions.map(changed => changed.filter(([x, y]) => !ticker.has(`${x},${y}`)));
	const recoloured = (changed: CellChangeOf[], line: (change: CellChangeOf) => number) => {
		const values = new Map<number, { from: Set<number | undefined>; to: Set<number | undefined> }>();
		for (const change of changed) {
			const item = values.get(line(change)) ?? { from: new Set(), to: new Set() };
			item.from.add(change[2]); item.to.add(change[3]); values.set(line(change), item);
		}
		return [...values].filter(([, { from, to }]) => ![...from].some(value => to.has(value))).map(([key]) => key);
	};
	return { ticker, rows: frequent(other.map(changed => recoloured(changed, ([, y]) => y))),
		cols: frequent(other.map(changed => recoloured(changed, ([x]) => x))) };
}

/**
 * State hashes that ignore the status cells and lines (statusMask) over the transitions so far. Without this, a counter
 * or a timer bar makes every state unique and repetition can never be seen. grids[n] is the state after action n
 * (grids[0] before the first action).
 */
export function maskedHashes(grids: Map<number, number[][]>): { hash: Map<number, string>; ticker: number; busy: { rows: number[]; cols: number[] } } {
	const ns = [...grids.keys()].sort((a, b) => a - b);
	const changes: CellChangeOf[][] = [];
	for (let i = 1; i < ns.length; i += 1) {
		const a = grids.get(ns[i - 1])!, b = grids.get(ns[i])!;
		if (ns[i] !== ns[i - 1] + 1) continue;
		const changed: CellChangeOf[] = [];
		for (let y = 0; y < Math.max(a.length, b.length); y += 1)
			for (let x = 0; x < Math.max(a[y]?.length ?? 0, b[y]?.length ?? 0); x += 1)
				if (a[y]?.[x] !== b[y]?.[x]) changed.push([x, y, a[y]?.[x], b[y]?.[x]]);
		changes.push(changed);
	}
	const { ticker, rows, cols } = statusMask(changes);
	const hash = new Map<number, string>();
	for (const [n, grid] of grids) hash.set(n, gridHash(ticker.size || rows.size || cols.size
		? grid.map((row, y) => row.map((cell, x) => ticker.has(`${x},${y}`) || rows.has(y) || cols.has(x) ? -1 : cell)) : grid));
	return { hash, ticker: ticker.size, busy: { rows: [...rows].sort((a, b) => a - b), cols: [...cols].sort((a, b) => a - b) } };
}

export function buildLedger(rows: LedgerRow[], observations: Observation[], grids: Map<number, number[][]> = new Map()): LedgerState {
	const { hash, ticker } = maskedHashes(grids);
	const hashed = rows.map(row => ({ ...row, before_hash: hash.get(row.n - 1) ?? row.before_hash, after_hash: hash.get(row.n) ?? row.after_hash }));
	const experiments = groupExperiments(hashed);
	const index = observationIndex(observations);
	return { rows: hashed, experiments, effort: ideaEffort(experiments), repeats: repetitions(hashed), stall: stallLength(hashed),
		index, completions: completions(hashed, experiments, index), ticker_cells: ticker };
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
