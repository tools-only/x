/**
 * Transition history for the thin ARC harness: a foundation for tools the agent
 * writes, not an analysis.
 *
 * Every state the agent has seen is kept (states.jsonl). A skill receives it as
 * state["history"]: one row per action with what the environment reported
 * (action, coordinates, resulting state and level), and history.grid(n), the
 * grid after action n. Comparing grids (what changed, what moved) is left to the
 * agent's own skills. To fit the sandbox input budget the grids travel as one
 * base grid plus the exact cell changes of each later transition; the guest
 * rebuilds grids from them and does not expose them as rows.
 * Design: docs/plans/2026-10-10-self-harness-priority-plan.md (L1, §10.9)
 */
import type { Grid } from "./arc_thin_prediction.ts";

/** [x, y, before, after] */
export type CellChange = [number, number, number, number];
/** What the environment reported for one action; no frame comparison. */
export type HistoryRow = {
	n: number; action: string; x?: number; y?: number; level_changed: boolean; state: string; levels_completed: number;
};
export type HistoryPayload = {
	/** Grids can be rebuilt for action numbers base_n..latest; null when no grid is available. */
	base_n: number | null; base_grid: Grid | null;
	transitions: HistoryRow[];
	/** Transport only: the cell changes of action n, used by the guest to rebuild history.grid(n). */
	deltas: Record<string, CellChange[]>;
};

/** JSON characters the cell changes and the base grid may take in one skill input. */
export const HISTORY_CHARS = 160_000;

/** Exact cell changes between two grids; undefined when their shapes differ. */
export function gridChanges(before: Grid, after: Grid): CellChange[] | undefined {
	if (before.length !== after.length) return undefined;
	const changes: CellChange[] = [];
	for (let y = 0; y < before.length; y += 1) {
		if (before[y].length !== after[y].length) return undefined;
		for (let x = 0; x < before[y].length; x += 1)
			if (before[y][x] !== after[y][x]) changes.push([x, y, before[y][x], after[y][x]]);
	}
	return changes;
}

/**
 * grids.get(n) is the grid after action n (n=0: before the first action).
 * Grids are made available from the latest action backwards until the budget is
 * used or a grid is missing; every row is always included.
 * `cache` holds the changes already computed for an action number.
 */
export function buildHistory(rows: HistoryRow[], grids: Map<number, Grid>, cache: Map<number, CellChange[] | null>,
	budget = HISTORY_CHARS): HistoryPayload {
	const latest = rows.length;
	const deltas: Record<string, CellChange[]> = {};
	let base = grids.has(latest) ? latest : null;
	let used = base === null ? 0 : JSON.stringify(grids.get(latest)).length;
	for (let n = latest; base !== null && n >= 1; n -= 1) {
		if (!cache.has(n)) {
			const before = grids.get(n - 1), after = grids.get(n);
			cache.set(n, before && after ? gridChanges(before, after) ?? null : null);
		}
		const delta = cache.get(n);
		if (!delta) break;
		const size = delta.length * 14 + 8;
		if (used + size > budget) break;
		used += size;
		deltas[String(n)] = delta;
		base = n - 1;
	}
	return {
		base_n: base, base_grid: base === null ? null : grids.get(base)!, deltas,
		transitions: rows.map((row) => ({
			n: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
			level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed,
		})),
	};
}
