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
import { REFINED_ONLY } from "./arc_thin_workspace.ts";

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

// ---------------------------------------------------------------- promotion (docs/plans/2026-10-14-knowledge-promotion.md)
//
// A checked hypothesis becomes a standing rule, and a standing rule goes back to dispute, by the evidence the checks
// already keep. The runtime only counts; a refinement writes the rule into prompts/rules.md (a prompt component) or
// revises it, so what persists is always a versioned harness component.

/** Where established rules live: a prompt the refinements maintain, applied at every decision while active. */
export const RULES_PATH = REFINED_ONLY;
export const RULES_CHARS = 1500;
/** Holds needed before a check is offered for promotion (with no fails, no errors, and a check that discriminates). */
export const PROMOTE_HOLDS = 4;
/** Control transitions per check: each pairs the grid before one move with the grid after a different move. */
export const CONTROL_PAIRS = 6;
/** Control ids are far above any action number, so their results never mix with real transitions. */
export const CONTROL_BASE = 1_000_000;

/** The hypothesis keys a rules prompt cites ("hyp.move_up"): the link from a rule to the check that keeps it. */
export const citedKeys = (rules: string) => [...new Set(rules.match(/\bhyp\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g) ?? [])];

/**
 * Mismatched transitions for testing whether a check discriminates: the grid before move `a` with the grid after a
 * different move `b` whose result differs, under `a`'s action. A check of a real transition rule should fail on some of
 * them; one that holds on all of them tests nothing (a check that returns True whatever happened).
 */
export function controlSegments(ns: number[], grids: Map<number, Grid>, count = CONTROL_PAIRS): { segments: ClaimSegment[]; sources: Map<number, number> } {
	const usable = [...new Set(ns)].sort((a, b) => a - b).filter((n) => grids.get(n - 1) && grids.get(n));
	const segments: ClaimSegment[] = [];
	const sources = new Map<number, number>();
	for (let i = 0; i < usable.length && segments.length < count; i++) {
		const a = usable[i];
		const after = JSON.stringify(grids.get(a));
		const b = [...usable.slice(i + 1), ...usable.slice(0, i)].find((m) => JSON.stringify(grids.get(m)) !== after);
		if (b === undefined) continue;
		const id = CONTROL_BASE + segments.length;
		segments.push({ start: id, grid: grids.get(a - 1)!, steps: [{ n: id, grid: grids.get(b)! }] });
		sources.set(id, a);
	}
	return { segments, sources };
}

/** A check's results on its control transitions: it discriminates when at least one control fails. */
export type ControlRecord = { key: string; version: string; results: ClaimValue[] };
export const discriminates = (record: ControlRecord | undefined) => record ? record.results.includes(false) : undefined;

export type PromotionView = {
	/** Checked hypotheses that qualify and are not yet cited by the rules prompt. */
	candidates: Array<{ key: string; version: string; holds: number; levels: number }>;
	/** Qualifying except that their controls have not run yet (the extension runs them). */
	needControls: Array<{ key: string; version: string }>;
	/** Qualifying but holding on mismatched transitions too. */
	vacuous: string[];
	/** Cited rules whose current check failed: the rule is in dispute. */
	refuted: Array<{ key: string; failing: number[] }>;
	/** Cited keys with no hypothesis or no check: a rule nothing keeps. */
	unchecked: string[];
	overCap: boolean;
};

/**
 * What the evidence says about promotion and demotion, from the checks' own records. `hypotheses` maps each key to its
 * current check version (undefined: no check) and status.
 */
export function promotionView(hypotheses: Map<string, { version?: string; status: string }>, rows: ClaimRow[],
	controls: Map<string, ControlRecord>, rules: string): PromotionView {
	const cited = new Set(citedKeys(rules));
	const view: PromotionView = { candidates: [], needControls: [], vacuous: [], refuted: [], unchecked: [], overCap: rules.length > RULES_CHARS };
	for (const [key, h] of hypotheses) {
		if (!h.version) continue;
		const mine = rows.filter((r) => r.key === key && r.version === h.version);
		const held = mine.filter((r) => r.result === true);
		const failing = mine.filter((r) => r.result === false).map((r) => r.n);
		const errors = mine.filter((r) => r.result === "error").length;
		if (cited.has(key)) { if (failing.length) view.refuted.push({ key, failing }); continue; }
		if (h.status === "rejected" || held.length < PROMOTE_HOLDS || failing.length || errors) continue;
		const ok = discriminates(controls.get(`${key}@${h.version}`));
		if (ok === undefined) view.needControls.push({ key, version: h.version });
		else if (!ok) view.vacuous.push(key);
		else view.candidates.push({ key, version: h.version, holds: held.length, levels: new Set(held.map((r) => r.level)).size });
	}
	for (const key of cited) if (!hypotheses.get(key)?.version) view.unchecked.push(key);
	return view;
}

/** The refinement's reasons, one per finding, in the runtime's words. */
export function promotionTriggers(view: PromotionView): string[] {
	return [
		...view.candidates.map((c) => `${c.key} held on ${c.holds} recorded moves${c.levels > 1 ? ` across ${c.levels} levels` : ""}, ` +
			`never failed, and fails on mismatched moves: a candidate rule for ${RULES_PATH}`),
		...view.refuted.map((r) => `${r.key}, cited in ${RULES_PATH}, failed at ${r.failing.slice(-3).map((n) => `#${n}`).join(", ")}: the rule is in dispute`),
		...(view.overCap ? [`${RULES_PATH} is over ${RULES_CHARS} characters: merge its rules`] : []),
	];
}
