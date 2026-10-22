/**
 * Scored predictions for the thin ARC harness.
 *
 * The agent may state, on the action call it already makes, what it expects the
 * action to produce (arc_action.predict), or name one of its skills to state it
 * (arc_action.predict_skill). Each supplied field is checked against the
 * observation the environment returns: cell values after the action, whether the
 * level changed, and the resulting state. The runtime does no cross-frame
 * analysis of its own (no change counts, no region tracking): comparisons
 * between frames are tools the agent writes from state["prev_grid"] and
 * state["history"]. It never judges a hypothesis and never blocks an action; a
 * malformed prediction is dropped, not refused.
 *
 * `text` is the informal part of the same prediction (what the agent expects, at
 * any time scale). It is kept for the ledger and the critic and never parsed or
 * scored: there is one place to say what an action should do, and the parts of
 * it that can be checked against the observation are.
 * Design: docs/plans/2026-10-10-self-harness-priority-plan.md (P1, P2, §10.9, §10.11)
 */
import { Type } from "typebox";

export type Grid = number[][];
export type Prediction = {
	text?: string;
	/** Hypothesis key this action tests; runtime pins the current checked version. */
	hypothesis?: string;
	/** Runtime-pinned check version; input values are ignored. */
	hypothesis_version?: string;
	cells?: Array<[number, number, number]>;
	level_changed?: boolean;
	state?: string;
};
/** hit is null when the field could not be compared (no grid, cell outside the grid). */
export type FieldScore = { field: string; hit: boolean | null; expected: string; observed?: string };
export type ScoredPrediction = { fields: FieldScore[]; hits: number; misses: number; unscorable: number };
/** What the environment returned for the action: the resulting grid and its reported flags (before: the grid it acted on). */
export type Outcome = { after?: Grid; level_changed: boolean; state: string; before?: Grid };

/**
 * A few cells are enough to tell a prediction right from wrong; in P048 the agent listed 30 one by
 * one and re-verified each in its reasoning. Extra entries are dropped, never a reason to refuse.
 */
export const MAX_PREDICTED_CELLS = 12;
export const MAX_PREDICTION_TEXT = 300;

export const predictionSchema = () => Type.Object({
	text: Type.Optional(Type.String({ description: "what you expect, in words, at any time scale (kept, not checked)" })),
	hypothesis: Type.Optional(Type.String({ maxLength: 48, description: "existing hypothesis key with an executable check that this action tests" })),
	cells: Type.Optional(Type.Array(Type.Array(Type.Integer(), { minItems: 3, maxItems: 4 }),
		{ maxItems: MAX_PREDICTED_CELLS, description: "[x,y,value] after; [x,y,before,after] from an agent diff is also accepted" })),
	level_changed: Type.Optional(Type.Boolean()),
	state: Type.Optional(Type.String({ maxLength: 24 })),
}, { description: "Optional; cells, level_changed and state are checked against the result" });

const int = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const parse = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try { return JSON.parse(value); } catch { return undefined; }
};

/**
 * Keep the well-formed fields of a prediction and drop the rest. Accepts the
 * agent's argument (possibly a JSON string, or plain words, which become text)
 * or a skill's return value. Returns undefined when nothing usable is left.
 */
export function normalizePrediction(raw: unknown): Prediction | undefined {
	const value = parse(raw);
	if (value === undefined && typeof raw === "string" && raw.trim())
		return { text: raw.replace(/\s+/g, " ").trim().slice(0, MAX_PREDICTION_TEXT) };
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const source = value as Record<string, unknown>;
	const out: Prediction = {};
	if (typeof source.text === "string" && source.text.trim()) out.text = source.text.replace(/\s+/g, " ").trim().slice(0, MAX_PREDICTION_TEXT);
	if (typeof source.hypothesis === "string" && source.hypothesis.trim()) out.hypothesis = source.hypothesis.trim().slice(0, 48);
	const list = parse(source.cells);
	const cells = Array.isArray(list)
		? list.flatMap((item) => {
			if (!Array.isArray(item) || !item.every(int) || (item.length !== 3 && item.length !== 4) || item[0] < 0 || item[1] < 0)
				return [];
			// Agent-authored frame-diff skills commonly return [x,y,before,after].
			// The prediction surface checks only the post-action value, so accepting
			// that representation here is a boundary compatibility fix, not runtime
			// frame analysis.
			return [[item[0], item[1], item.length === 4 ? item[3] : item[2]] as [number, number, number]];
		}).slice(0, MAX_PREDICTED_CELLS) as Array<[number, number, number]>
		: [];
	if (cells.length) out.cells = cells;
	if (typeof source.level_changed === "boolean") out.level_changed = source.level_changed;
	if (typeof source.state === "string" && source.state.trim()) out.state = source.state.trim().slice(0, 24);
	return Object.keys(out).length ? out : undefined;
}

/** Check each supplied field against the observation returned for the action. */
export function scorePrediction(prediction: Prediction, outcome: Outcome): ScoredPrediction {
	const fields: FieldScore[] = [];
	const add = (field: string, hit: boolean | null, expected: string, observed?: string) =>
		fields.push({ field, hit, expected, ...(hit === true || observed === undefined ? {} : { observed }) });
	if (prediction.cells) {
		const wrong: string[] = [];
		let known = 0;
		for (const [x, y, value] of prediction.cells) {
			const seen = outcome.after?.[y]?.[x];
			if (seen === undefined) continue;
			known += 1;
			if (seen !== value) wrong.push(`(${x},${y})=${seen}`);
		}
		// "N predicted value(s)", not "N cell(s)": in P048 the agent twice read "cells=16 cell(s) ok" as
		// "16 cells changed", which contradicted the grid and cost several paragraphs of reasoning.
		// With the grid before the action, the label also says how many of the values claim a change: a cell
		// predicted to keep its value is usually right and tells little, so "4 ok" alone overstates support.
		const changes = outcome.before
			? prediction.cells.filter(([x, y, value]) => outcome.before?.[y]?.[x] !== undefined && outcome.before[y][x] !== value).length : undefined;
		add("cells", known ? wrong.length === 0 : null,
			`${prediction.cells.length} predicted value(s)${changes !== undefined ? ` [${changes} as change]` : ""}`,
			known ? `${known - wrong.length}/${known} right; ${wrong.slice(0, 3).join(" ")}${wrong.length > 3 ? " …" : ""}` : "no grid");
	}
	if (prediction.level_changed !== undefined)
		add("level_changed", outcome.level_changed === prediction.level_changed, String(prediction.level_changed), String(outcome.level_changed));
	if (prediction.state !== undefined)
		add("state", outcome.state.toUpperCase() === prediction.state.toUpperCase(), prediction.state, outcome.state);
	return {
		fields, hits: fields.filter((item) => item.hit === true).length,
		misses: fields.filter((item) => item.hit === false).length, unscorable: fields.filter((item) => item.hit === null).length,
	};
}

/** One short clause for RECENT ACTIONS, e.g. "cells=2 predicted value(s) ok; level_changed=true MISS (saw false)". */
export function renderScore(score: ScoredPrediction): string {
	return score.fields.map((item) => `${item.field}=${item.expected} ` +
		(item.hit === true ? "ok" : item.hit === false ? `MISS (saw ${item.observed})` : `not scored (${item.observed})`)).join("; ");
}
