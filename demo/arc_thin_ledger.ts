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
	changed_cells: number | null; level_changed: boolean; state: string; levels_completed: number;
	before_hash?: string; after_hash?: string;
};
export type Observation = { n: number; skill: string; version: number; ok: boolean; value?: unknown; error?: string };
export type Experiment = {
	label: string; labelled: boolean; start: number; end: number; actions: number;
	open: boolean; close_reason?: "idea_changed" | "level_changed" | "game_over" | "reset"; expect?: string;
};
export type IdeaEffort = { label: string; actions: number; last: number; longest: number };
export type Repetition = { n: number; earlier: number[]; key: string };
export type Completion = { n: number; kind: "level" | "game_over"; from: number; to: number; idea?: string; leaves: Record<string, string> };

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

/**
 * State hashes that ignore "ticker" cells: cells that changed on at least 80% of
 * the transitions so far (step counters, timers). Without this, a counter makes
 * every state unique and repetition can never be seen. grids[n] is the state after
 * action n (grids[0] before the first action).
 */
export function maskedHashes(grids: Map<number, number[][]>): { hash: Map<number, string>; ticker: number } {
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
	for (const [n, grid] of grids) hash.set(n, gridHash(ticker.size
		? grid.map((row, y) => row.map((cell, x) => ticker.has(`${x},${y}`) ? -1 : cell)) : grid));
	return { hash, ticker: ticker.size };
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
export function renderLedgerView(state: LedgerState, hypothesisKeys: string[], maxChars = 900): string {
	const lines: string[] = [];
	const current = state.experiments.at(-1);
	if (state.effort.length) {
		const parts = state.effort.slice(0, 5).map(item => {
			const now = current && current.open && current.label.toLowerCase() === item.label.toLowerCase();
			return now ? `${item.label} — ${current!.actions} in a row (#${current!.start}–#${current!.end}), ${item.actions} total`
				: `${item.label} — ${item.actions} actions, last #${item.last}`;
		});
		const labels = new Set(state.effort.map(item => item.label.toLowerCase()));
		const unpursued = hypothesisKeys.filter(key => !labels.has(key.toLowerCase()) && !labels.has(key.replace(/^hyp\./, "").toLowerCase()));
		lines.push(`IDEAS: ${parts.join("; ")}${unpursued.length ? `; not pursued by idea label: ${unpursued.slice(0, 4).join(", ")}` : ""}`);
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
