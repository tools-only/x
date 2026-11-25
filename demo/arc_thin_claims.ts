/**
 * Claims checked against history (docs/plans/2026-10-12-falsifiable-self-harness-plan.md). A hypothesis may carry a
 * small Python check(t) over one transition; the runtime runs it over the recorded history when it is saved and on
 * every new transition, and keeps the results as runtime-owned evidence: holds, fails at an action number, or does not
 * apply. What the claim means, and what a counterexample implies, stays with the agent. Pure helpers: the extension
 * owns the sandbox calls and the store (claim_checks.jsonl).
 */
import { createHash } from "node:crypto";
import { gridChanges, type CellChange } from "./arc_thin_history.ts";
import type { Grid } from "./arc_thin_prediction.ts";

/** One check result: true holds, false fails, null does not apply, "error" the check raised or returned something else. */
export type ClaimValue = true | false | null | "error";
export type ClaimRow = { key: string; version: string; n: number; level: number; result: ClaimValue; error?: string };
export type ClaimSummary = {
	holds: number; fails: number; na: number; errors: number;
	failing: number[]; firstError?: string;
	/** The same counts for transitions on the current level, when earlier levels also have results. */
	level?: { level: number; holds: number; fails: number; na: number; errors: number; failing: number[] };
};
/** What the environment reported for one action, as a check sees it besides the two grids. */
export type TransitionMeta = { n: number; action: string; x?: number; y?: number; level_changed: boolean; state: string; levels_completed: number };

export const claimVersion = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 12);

/** The level an action was taken on (0-based): the levels completed before it. */
export const levelOf = (row: Pick<TransitionMeta, "level_changed" | "levels_completed">) =>
	Math.max(0, row.levels_completed - (row.level_changed ? 1 : 0));

export type ClaimSegment = { start: number; grid: Grid; steps: Array<{ n: number; delta?: CellChange[]; grid?: Grid }> };

/**
 * The grids for checking transitions `ns`, in batches that fit the sandbox input: each segment starts from the grid
 * before its first transition and carries each later grid as its cell changes (or whole, when the shape changed).
 * Transitions without both grids are skipped and returned in `missing`.
 */
export function claimSegments(ns: number[], grids: Map<number, Grid>, maxChars = 200_000):
	{ batches: ClaimSegment[][]; missing: number[] } {
	const batches: ClaimSegment[][] = [];
	const missing: number[] = [];
	let batch: ClaimSegment[] = [], used = 0, segment: ClaimSegment | undefined, last = -1;
	const close = () => { segment = undefined; };
	for (const n of [...new Set(ns)].sort((a, b) => a - b)) {
		const before = grids.get(n - 1), after = grids.get(n);
		if (!before || !after) { missing.push(n); close(); continue; }
		const delta = segment && last === n - 1 ? gridChanges(before, after) : undefined;
		const step = delta ? { n, delta } : { n, grid: after };
		const size = JSON.stringify(step).length + (segment && last === n - 1 ? 0 : JSON.stringify(before).length);
		if (used + size > maxChars && batch.length) { batches.push(batch); batch = []; used = 0; close(); }
		if (!segment || last !== n - 1) {
			segment = { start: n, grid: before, steps: [] };
			batch.push(segment);
			segment.steps.push({ n, grid: after });
			used += JSON.stringify(before).length + JSON.stringify(after).length;
		} else {
			segment.steps.push(step);
			used += size;
		}
		last = n;
	}
	if (batch.length) batches.push(batch);
	return { batches, missing };
}

/** Counts over the current version's results; the level split only once the claim has results on another level too. */
export function summarizeClaim(rows: ClaimRow[], currentLevel: number): ClaimSummary {
	const count = (list: ClaimRow[]) => ({
		holds: list.filter((r) => r.result === true).length, fails: list.filter((r) => r.result === false).length,
		na: list.filter((r) => r.result === null).length, errors: list.filter((r) => r.result === "error").length,
		failing: list.filter((r) => r.result === false).map((r) => r.n),
	});
	const all = count(rows);
	const here = rows.filter((r) => r.level === currentLevel);
	const firstError = rows.find((r) => r.result === "error")?.error;
	return {
		...all, ...(firstError ? { firstError } : {}),
		...(here.length && here.length < rows.length ? { level: { level: currentLevel, ...count(here) } } : {}),
	};
}

const failures = (ns: number[]) => ns.length <= 4 ? ns.map((n) => `#${n}`).join(", ")
	: `${ns.slice(0, 2).map((n) => `#${n}`).join(", ")}, …, #${ns.at(-1)}`;

/** One line under the hypothesis: the runtime's record, not a verdict. */
export function renderClaimSummary(summary: ClaimSummary | undefined, compileError?: string): string {
	if (compileError) return `check: not usable (${compileError.slice(0, 160)})`;
	if (!summary) return "check: not run yet";
	const total = summary.holds + summary.fails + summary.na + summary.errors;
	if (!total) return "check: no transitions to check yet";
	const part = (s: { holds: number; fails: number; na: number; errors: number; failing: number[] }) =>
		`holds ${s.holds}` + (s.fails ? ` · fails ${s.fails} (${failures(s.failing)})` : " · fails 0") +
		(s.na ? ` · n/a ${s.na}` : "") + (s.errors ? ` · errors ${s.errors}` : "");
	return `check on ${total} recorded move(s): ${part(summary)}` +
		(summary.level ? ` | on level ${summary.level.level + 1}: ${part(summary.level)}` : "") +
		(summary.holds === 0 && summary.fails === 0 && summary.na > 0 ? " · never applied" : "") +
		(summary.firstError ? ` · first error: ${summary.firstError.slice(0, 120)}` : "");
}
