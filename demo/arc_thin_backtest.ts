/**
 * Model backtest for the thin ARC harness: a service that checks the agent's own model skills against
 * the transitions already recorded, so testing a rule does not cost actions.
 *
 * A model is a skill that reads state["proposed_action"] (the existing predictor convention) and returns
 * prediction fields: cells after the action, level_changed, state. The guest replays it on each recorded
 * transition with only what existed before that action (grids and history up to it, the action itself; no
 * outcome, no later moves, no memory). This module scores the replies against what happened. It computes
 * nothing about the game: the model is the agent's, the comparison is the prediction-checking service.
 *
 * Reported separately, so a model fitted to a few moves is not taken as verified:
 * - fit: transitions that existed when this version was saved; later: transitions after it;
 * - reset: RESET transitions (a movement model may rightly not cover them);
 * - abstained: no checkable field; error: the skill failed on that case.
 * Counterexamples are chosen across different actions first, so three failures of one kind do not hide another.
 * Design: docs/plans/2026-10-11-learning-dynamics-optimization-plan.md §2.1 (real failure: hypstrategy ls20,
 * 2026-10-11, retested "move up" by acting at #23, #34, #40–43, #51–55, #57–62).
 */
import { normalizePrediction, scorePrediction, type Grid, type Prediction, type ScoredPrediction } from "./arc_thin_prediction.ts";

export type BacktestRow = { n: number; action: string; x?: number; y?: number; level_changed: boolean; state: string; levels_completed: number };
export type BacktestCase = {
	n: number; proposed_action: { action: string; x?: number; y?: number };
	recent_actions: unknown[]; available_actions: string[]; state: string | null; levels_completed: number;
};
export type GuestCaseResult = { n: number; ok: boolean; value?: unknown; error?: string };
export type CheckOutcome = "right" | "wrong" | "abstained" | "error";
/** One scored transition, as stored in model_checks.jsonl. */
export type ModelCheck = {
	name: string; version: number; n: number; action: string; set: "fit" | "later" | "reset"; outcome: CheckOutcome;
	cells?: number; changes?: number; level_true?: boolean; level_hit?: boolean; detail?: string;
};

/** Transitions to replay, newest last: n in (after, through], each needing the grid before it. */
export function backtestCases(rows: BacktestRow[], grids: Map<number, Grid>, after: number, through: number,
	available: string[], limit = 60, recent = 8): BacktestCase[] {
	const out: BacktestCase[] = [];
	for (let n = Math.max(after + 1, through - limit + 1, 1); n <= through; n += 1) {
		const row = rows[n - 1];
		if (!row || !grids.has(n - 1) || !grids.has(n)) continue;
		const before = rows[n - 2];
		out.push({
			n, proposed_action: { action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}) },
			recent_actions: rows.slice(Math.max(0, n - 1 - recent), n - 1).map((r) => ({
				n: r.n, action: r.action, ...(r.x !== undefined ? { x: r.x, y: r.y } : {}), level_changed: r.level_changed, state: r.state, levels_completed: r.levels_completed })),
			available_actions: available, state: before?.state ?? null, levels_completed: before?.levels_completed ?? 0,
		});
	}
	return out;
}

/** Score one model's replies. savedAt: the number of transitions recorded when this version was saved. */
export function scoreBacktest(name: string, version: number, results: GuestCaseResult[], rows: BacktestRow[],
	grids: Map<number, Grid>, savedAt: number): ModelCheck[] {
	return results.map((result) => {
		const row = rows[result.n - 1];
		const base = { name, version, n: result.n, action: row?.action ?? "?",
			set: (row?.action === "RESET" ? "reset" : result.n <= savedAt ? "fit" : "later") as ModelCheck["set"] };
		if (!result.ok) return { ...base, outcome: "error" as const, detail: String(result.error ?? "failed").slice(0, 160) };
		const prediction: Prediction | undefined = normalizePrediction(result.value);
		const checkable = prediction && (prediction.cells || prediction.level_changed !== undefined || prediction.state !== undefined);
		if (!prediction || !checkable || !row) return { ...base, outcome: "abstained" as const };
		const before = grids.get(result.n - 1);
		const score: ScoredPrediction = scorePrediction(prediction, { before, after: grids.get(result.n), level_changed: row.level_changed, state: row.state });
		const scored = score.hits + score.misses;
		const changes = prediction.cells && before ? prediction.cells.filter(([x, y, v]) => before[y]?.[x] !== undefined && before[y][x] !== v).length : undefined;
		const missed = score.fields.filter((field) => field.hit === false);
		return {
			...base, outcome: scored === 0 ? "abstained" as const : score.misses ? "wrong" as const : "right" as const,
			...(prediction.cells ? { cells: prediction.cells.length, changes } : {}),
			...(prediction.level_changed !== undefined ? { level_true: prediction.level_changed, level_hit: prediction.level_changed === row.level_changed } : {}),
			...(missed.length ? { detail: missed.map((field) => `${field.field} ${field.expected}: ${field.observed ?? ""}`).join("; ").slice(0, 160) } : {}),
		};
	});
}

type Tally = { covered: number; right: number; wrong: number; abstained: number; error: number };
const tally = (checks: ModelCheck[]): Tally => ({
	covered: checks.length, right: checks.filter((c) => c.outcome === "right").length, wrong: checks.filter((c) => c.outcome === "wrong").length,
	abstained: checks.filter((c) => c.outcome === "abstained").length, error: checks.filter((c) => c.outcome === "error").length,
});
const tallyText = (label: string, t: Tally) => t.covered
	? `${label} ${t.right}/${t.covered} right` + (t.wrong ? `, ${t.wrong} wrong` : "") + (t.abstained ? `, ${t.abstained} no prediction` : "") + (t.error ? `, ${t.error} failed` : "")
	: "";

/** Up to `max` wrong or failed cases, one per action first, newest first within an action. */
export function counterexamples(checks: ModelCheck[], max = 3): ModelCheck[] {
	const bad = checks.filter((c) => c.outcome === "wrong" || c.outcome === "error").sort((a, b) => b.n - a.n);
	const picked: ModelCheck[] = [];
	for (const check of bad) if (picked.length < max && !picked.some((p) => p.action === check.action)) picked.push(check);
	for (const check of bad) if (picked.length < max && !picked.includes(check)) picked.push(check);
	return picked.sort((a, b) => a.n - b.n);
}

/** One line per model version for the working set and the save receipt. */
export function renderBacktest(name: string, version: number, checks: ModelCheck[]): string {
	const own = checks.filter((c) => c.name === name && c.version === version);
	if (!own.length) return `- ${name} v${version} (model): no recorded transition to check yet`;
	const fit = tally(own.filter((c) => c.set === "fit")), later = tally(own.filter((c) => c.set === "later"));
	const reset = tally(own.filter((c) => c.set === "reset"));
	const withCells = own.filter((c) => c.cells !== undefined);
	const cells = withCells.reduce((sum, c) => sum + (c.cells ?? 0), 0), changes = withCells.reduce((sum, c) => sum + (c.changes ?? 0), 0);
	const levelTrue = own.filter((c) => c.level_true === true);
	const parts = [tallyText("recorded moves (fit)", fit), tallyText("moves since saving", later), tallyText("RESETs", reset)].filter(Boolean);
	const claims = withCells.length ? `claims ${(cells / withCells.length).toFixed(1)} cells per move, ${(changes / withCells.length).toFixed(1)} of them changes` : "";
	const level = levelTrue.length ? `predicted a level change ${levelTrue.length}×, right ${levelTrue.filter((c) => c.level_hit).length}×` : "";
	const wrong = counterexamples(own).map((c) => `#${c.n} ${c.action}: ${c.detail ?? c.outcome}`);
	return `- ${name} v${version} (model, checked on recorded moves): ${[...parts, claims, level].filter(Boolean).join("; ")}` +
		(wrong.length ? `\n  wrong: ${wrong.join(" | ")}` : "");
}
