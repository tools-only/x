/**
 * The self-evolution loop's read-only facts (docs/plans/2026-11-16-arc-selfloop-migration.md, stage 1).
 *
 * These helpers join rows the run already writes (working_set, context_budget, trajectory, component_runs,
 * claim_checks, refiner, harness_changes) into the files the agent can read under data/self/. They count and copy:
 * no move is judged, no hypothesis ranked, no action suggested. The files are written by the runtime with
 * runtimeWrite, so they are read-only to the agent (data/ is not a component path).
 *
 * Layer order (evo's three layers, ARC form): the meta loop owns which dimensions exist; this file is the second
 * layer's raw material; the task loop reads it through the decision's own context. Stage 2 adds the digest that
 * rides every decision, stage 3 the typed slots, stage 4 the settlement at level boundaries.
 */

export const SELF_CONTEXT_PATH = "data/self/context_budget.jsonl";
export const SELF_WORKING_PATH = "data/self/working_set.jsonl";
export const SELF_OUTCOMES_PATH = "data/self/outcomes.jsonl";

/**
 * Stage 2: the four fields the host gives every decision, unchanged between decisions (evo's self_root_meta_fields,
 * adapted to this harness's own objects). They name the goal, the mechanism and the acceptance and nothing to build.
 */
export const SELF_FIELDS = [
	"SELF-EVOLUTION FIELDS (given by the host, the same every decision)",
	"- The task is the host: a change to yourself counts only when this run's own facts triggered it and it serves this task's delivery.",
	"- You change yourself through the same workspace write path as any component; a saved change activates at the next decision boundary.",
	"- At each level boundary the runtime counts changes / activated / used later from its receipts; the rows are under data/self/.",
].join("\n");

export type SelfDigestInput = {
	decision: number;
	actions: number;
	level: number;
	predictions: { made: number; hits: number; misses: number };
	components: Array<{ path: string; version: number }>;
	/** Rows the agent's own writes recorded in harness_changes.jsonl. */
	changes: number;
	outcomes: Array<{ level?: number; won?: boolean; win_n?: number; win_action?: string }>;
	rows: { budget: number; working: number; outcomes: number };
};

/**
 * Stage 2: one line of the run's own facts, shown with every decision. Counts and names copied from the logs the
 * digest's pointer opens; no judgement, no suggestion.
 */
export function selfDigest(input: SelfDigestInput): string {
	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
	const shown = input.components.slice(0, 3).map((component) => `${component.path} v${component.version}`);
	const more = input.components.length - shown.length;
	const last = input.outcomes.at(-1);
	const outcome = last
		? `level ${last.level ?? "?"} ${last.won ? `won at #${last.win_n ?? "?"} by ${last.win_action ?? "?"}` : "not won"}`
		: "none";
	return `SELF: decision ${input.decision}, ${plural(input.actions, "action")} at level ${input.level}; predictions ${input.predictions.made} ` +
		`(${input.predictions.hits} hit/${input.predictions.misses} miss); your components ${input.components.length}` +
		`${shown.length ? ` (${shown.join(", ")}${more > 0 ? `, +${more} more` : ""})` : ""}; ${plural(input.changes, "self change")}; ` +
		`last outcome ${outcome}; data/self/: ${input.rows.budget} budget, ${input.rows.working} working-set, ` +
		`${plural(input.rows.outcomes, "outcome row")}.`;
}


type Row = Record<string, any>;

/** A working-set row without the message bodies: the section sizes and flags stay, the text does not. */
export function withoutBodies(row: Row): Row {
	const copy: Row = { ...row };
	delete copy.text;
	delete copy.tail;
	return copy;
}

export type SelfActionRow = {
	n?: number; action?: string; state?: string; level_changed?: boolean; levels_completed?: number;
	prediction?: { fields?: Array<{ hit?: boolean }> };
	skill_prediction?: { hits?: number; misses?: number };
	predictors?: Array<{ hits?: number; misses?: number }>;
};

const count = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Predictions carried by recorded actions and how they scored. One count per prediction the action carried (its
 * own, the pinned test's, each predictor tool's); a prediction whose fields are absent made a claim the runtime could
 * not score, so it counts as made and adds nothing to hits or misses.
 */
export function predictionCounts(rows: SelfActionRow[]): { made: number; hits: number; misses: number } {
	let made = 0, hits = 0, misses = 0;
	for (const row of rows) {
		if (row.prediction) {
			made += 1;
			for (const field of row.prediction.fields ?? []) {
				if (field?.hit === true) hits += 1;
				else if (field?.hit === false) misses += 1;
			}
		}
		if (row.skill_prediction) {
			made += 1;
			hits += count(row.skill_prediction.hits);
			misses += count(row.skill_prediction.misses);
		}
		for (const predictor of row.predictors ?? []) {
			made += 1;
			hits += count(predictor?.hits);
			misses += count(predictor?.misses);
		}
	}
	return { made, hits, misses };
}

/** What a span of recorded actions did, by counting only: actions, resets, game overs, predictions scored. */
export function spanFacts(rows: SelfActionRow[]) {
	return {
		actions: rows.length,
		resets: rows.filter((row) => row.action === "RESET").length,
		game_overs: rows.filter((row) => row.state === "GAME_OVER").length,
		predictions: predictionCounts(rows),
	};
}

export type OutcomeInput = {
	/** The level the span belongs to (levels completed before it started). */
	level: number;
	/** Action count at the end of the previous span (0 at the start of the run). */
	from: number;
	/** Action count at the end of this one, the winning action included when the level was won. */
	to: number;
	rows: SelfActionRow[];
	runs?: Array<{ kind?: string; n?: number; path?: string; ok?: boolean }>;
	claims?: Array<{ n?: number; result?: any }>;
	refinements?: Array<{ kind?: string; at?: number }>;
	changes?: Array<{ at?: number; path?: string; version?: number }>;
};

/**
 * One finished level's lineage: what the recorded span did, which of the agent's own components ran in it, how its
 * predictions and hypothesis checks scored, and which harness changes and refinements were written during it. Rows
 * outside (from, to] are ignored, so a caller may pass whole logs.
 */
export function outcomeRow(input: OutcomeInput): Row {
	const inSpan = (at: any) => Number.isFinite(Number(at)) && Number(at) > input.from && Number(at) <= input.to;
	const rows = input.rows.filter((row) => inSpan(row.n));
	const runs = (input.runs ?? []).filter((run) => inSpan(run.n));
	const tools: Record<string, number> = {};
	for (const run of runs) if (run.kind === "tool" && run.path) tools[run.path] = (tools[run.path] ?? 0) + 1;
	const claims = (input.claims ?? []).filter((claim) => inSpan(claim.n));
	const refinements = (input.refinements ?? []).filter((row) => row.kind === "edit" && inSpan(row.at));
	const changes = (input.changes ?? []).filter((row) => inSpan(row.at));
	const win = rows.filter((row) => row.level_changed).at(-1);
	return {
		level: input.level,
		from_at: input.from,
		to_at: input.to,
		...spanFacts(rows),
		won: Boolean(win),
		...(win ? { win_action: win.action ?? null, win_n: win.n ?? null } : {}),
		tools_used: tools,
		python_runs: runs.filter((run) => run.kind === "python").length,
		claims: {
			checks: claims.length,
			held: claims.filter((claim) => claim.result === true).length,
			contradicted: claims.filter((claim) => claim.result === false).length,
		},
		refinements: refinements.length,
		self_changes: changes.map((row) => ({ path: row.path ?? null, version: row.version ?? null })),
	};
}
