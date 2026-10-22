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

// ---------------------------------------------------------------- contest by checks (plan 2026-10-17, H2a)
//
/** Decided moves (holds + fails) a check needs before it can contest its hypothesis; 0 turns contesting off. */
export const CONTEST_MIN_DECIDED = 5;
/** An explicitly conditional check returns null out of scope; a single false is its counterexample. */
export const COUNTEREXAMPLE_MIN_DECIDED = 1;

/** A check failing on at least half its decided moves: the counts, the failing moves, and where that first held. */
export type CheckContest = { decided: number; fails: number; failing: number[]; at: number };

/**
 * Whether a check's own results contest its hypothesis: at least `min` decided moves, failing on at least half of
 * them now. `at` is the move at which that first held, counting moves in order. n/a and errors are not decided.
 */
export function checkContest(rows: ClaimRow[], min = CONTEST_MIN_DECIDED): CheckContest | undefined {
	if (min <= 0) return undefined;
	const decided = rows.filter((r) => r.result === true || r.result === false).sort((a, b) => a.n - b.n);
	let fails = 0, at: number | undefined;
	decided.forEach((r, i) => {
		if (r.result === false) fails += 1;
		if (at === undefined && i + 1 >= min && 2 * fails >= i + 1) at = r.n;
	});
	if (at === undefined || 2 * fails < decided.length) return undefined;
	return { decided: decided.length, fails, failing: decided.filter((r) => r.result === false).map((r) => r.n), at };
}

/** "its check fails on 158 of 218 decided moves (#51, #52, …, #70)" */
export const renderContest = (contest: CheckContest) =>
	`its check fails on ${contest.fails} of ${contest.decided} decided moves (${failures(contest.failing)})`;

/**
 * What events carry about the kinds of moves made on the level (arc_thin_coverage.ts): the counts, and the kinds the
 * level has (almost) not seen, in words. The test move an event asks for is named in a form the runtime can classify.
 */
export type Gaps = { text: string; rare: string[] };
export const MOVE_FORM = "ACTION6(x,y) or ACTIONn";

/**
 * H2b: one refinement event per check-contested hypothesis and check version. None for a key in `refuted`: a rule that
 * cites it is in dispute, and that event asks for the same edit. A refinement rewrites only hypotheses refinements
 * wrote (all 25 checks recorded in su15 since 2026-10-15 were); the agent's it can only narrow under a new key.
 */
export function contestEvents(contests: Array<{ key: string; version: string; contest: CheckContest; ownedByRefinement?: boolean }>,
	refuted: string[], gaps?: Gaps): Array<[string, string]> {
	return contests.filter(({ key }) => !refuted.includes(key)).map(({ key, version, contest, ownedByRefinement }) => [`contested:${key}@${version}`,
		`${key} is contested: ${renderContest(contest)}; ` + (ownedByRefinement
			? `a refinement wrote it, so rewrite it with HYPOTHESIS ${key}, narrower where it held, or make the strategy's next experiment settle it`
			: "write a narrower HYPOTHESIS under a new key for where it held, or make the strategy's next experiment settle it") +
		(gaps ? `. Moves ${gaps.text}. Name the move that settles it as ${MOVE_FORM} (in predicts, or first in the strategy's Next experiment)` : "")]);
}

/** Rival pairs named per question; the rest are counted. */
const RIVAL_PAIRS = 4;

/**
 * H3a: hypotheses that share a question, each with a check, compared on the recorded moves: one line per question. A
 * move separates two rivals when both checks decided it and differ; the latest such move is named. Counting only: a
 * check runs on the moves the agent chose, and a belief collects holds from its own consequences (su15-l1-1's
 * hyp.block_movement held on 109 of 111) unless a rival is judged on the same moves.
 */
export function rivalLines(hypotheses: Map<string, { question?: string; version?: string; status: string }>, rows: ClaimRow[]): string[] {
	const byQuestion = new Map<string, string[]>();
	for (const [key, h] of hypotheses)
		if (h.question && h.version && h.status !== "rejected") byQuestion.set(h.question, [...(byQuestion.get(h.question) ?? []), key]);
	const lines: string[] = [];
	for (const [question, keys] of byQuestion) {
		if (keys.length < 2) continue;
		const decided = new Map(keys.map((key) => [key, new Map(rows
			.filter((r) => r.key === key && r.version === hypotheses.get(key)!.version && (r.result === true || r.result === false))
			.map((r) => [r.n, r.result === true]))]));
		const parts: string[] = [];
		for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
			const [a, b] = [keys[i], keys[j]];
			const both = [...decided.get(a)!].filter(([n]) => decided.get(b)!.has(n)).sort((x, y) => x[0] - y[0]);
			const apart = both.filter(([n, held]) => decided.get(b)!.get(n) !== held);
			if (apart.length) {
				const [n, held] = apart.at(-1)!;
				parts.push(`#${n} separates ${a} (${held ? "holds" : "fails"}) from ${b} (${held ? "fails" : "holds"})`);
			} else parts.push(`no recorded move separates ${a} from ${b} (${both.length
				? `both decided ${both.length} move${both.length === 1 ? "" : "s"}, same results` : "no move decided by both"})`);
		}
		lines.push(`question "${question}": ${parts.slice(0, RIVAL_PAIRS).join("; ")}` +
			(parts.length > RIVAL_PAIRS ? `; … (${parts.length - RIVAL_PAIRS} more pairs)` : ""));
	}
	return lines;
}

/**
 * A hypothesis whose check holds with no rival beside it: at least `min` decided moves, failing on fewer than half, and
 * no other live hypothesis with a check under its question. Its holds come from the moves the agent chose: in
 * su15-g56-1 (gpt-5.6-sol, 2026-10-19) and su15-l1-1 (qwen, 2026-10-16) the belief that lost the second level ("a click
 * on a block moves it one cell") held on the clicks the agent made, and the click that would have refuted it (a few
 * cells away from a block) was never tried. A refinement is asked for the rival, which H3a then compares on the moves.
 */
export function unchallenged(hypotheses: Map<string, { question?: string; version?: string; status: string }>, rows: ClaimRow[],
	min = CONTEST_MIN_DECIDED): Array<{ key: string; version: string; question: string; decided: number; holds: number }> {
	if (min <= 0) return [];
	const out: Array<{ key: string; version: string; question: string; decided: number; holds: number }> = [];
	for (const [key, h] of hypotheses) {
		if (!h.question || !h.version || h.status === "rejected" || h.status === "contested") continue;
		if ([...hypotheses].some(([other, r]) => other !== key && r.question === h.question && r.version && r.status !== "rejected")) continue;
		const decided = rows.filter((r) => r.key === key && r.version === h.version && (r.result === true || r.result === false));
		const holds = decided.filter((r) => r.result === true).length;
		if (decided.length >= min && 2 * holds > decided.length)
			out.push({ key, version: h.version, question: h.question, decided: decided.length, holds });
	}
	return out;
}

/**
 * The refinement event for an unchallenged hypothesis, once per hypothesis and check version. With `gaps` (P1,
 * 2026-10-19) the rival must disagree on a kind of move the level has not seen: in su15-g56-2 the rival that matched the
 * game differed from the belief only for clicks off a block, its predicts named another click on a block, and 163 of 188
 * clicks on that level were on a block. `kindText` puts a kind in words.
 */
export const rivalEvents = (found: ReturnType<typeof unchallenged>, gaps?: Gaps, kindText: (kind: string) => string = (kind) => kind):
	Array<[string, string]> => found.map(({ key, version, question, decided, holds }) =>
	[`rival:${key}@${version}`, `${key} holds on ${holds} of ${decided} decided moves, all moves the agent chose, and no other hypothesis ` +
		`with a check answers "${question}"` + (gaps ? `. Moves ${gaps.text}` : "") + `: write the strongest rival HYPOTHESIS, another ` +
		`explanation of the same moves, whose check disagrees with ${key} on ` + (gaps?.rare.length
			? `a kind of move this level has not seen (${gaps.rare.map(kindText).join("; ")}); name that move in predicts as ${MOVE_FORM}: ` +
				"it becomes the first item of the strategy's next experiment"
			: gaps ? `a move not made yet; name that move in predicts as ${MOVE_FORM}: it becomes the first item of the strategy's next experiment`
			: "a move not made yet; say in predicts which move would separate them")]);

/**
 * A check written as the body of check(t), without its def line, gets the def line: gpt-5.6-sol wrote 4 of its 23
 * refinement replies in su15-g56-1 (2026-10-19) that way, and each was refused. Anything else is returned as it is.
 */
export function withCheckDef(source: string): string {
	if (/\bdef\s+check\s*\(|\bcheck\s*=\s*lambda\b/.test(source) || !/^[ \t]*return\b/m.test(source)) return source;
	return "def check(t):\n" + source.split(/\r?\n/).map((line) => (line.trim() ? `    ${line}` : line)).join("\n");
}

// ---------------------------------------------------------------- promotion (docs/plans/2026-10-14-knowledge-promotion.md)
//
// A checked hypothesis becomes a standing rule, and a standing rule goes back to dispute, by the evidence the checks
// already keep. The runtime only counts; a refinement writes the rule into prompts/rules.md (a prompt component) or
// revises it, so what persists is always a versioned harness component. The agent writes and revises the file too
// (2026-10-19: its writes had been refused since pr-01, and in the next 7 runs every refused write was a rule).

/** Where established rules live: a prompt the agent and the refinements maintain, applied at every decision while active. */
export const RULES_PATH = "prompts/rules.md";
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
	/** Cited keys that name no hypothesis at all (H2c): su15-r04-e1's rules cited three that never existed. */
	missing: string[];
	overCap: boolean;
};

/**
 * What the evidence says about promotion and demotion, from the checks' own records. `hypotheses` maps each key to its
 * current check version (undefined: no check) and status.
 */
export function promotionView(hypotheses: Map<string, { version?: string; status: string }>, rows: ClaimRow[],
	controls: Map<string, ControlRecord>, rules: string): PromotionView {
	const cited = new Set(citedKeys(rules));
	const view: PromotionView = { candidates: [], needControls: [], vacuous: [], refuted: [], unchecked: [], missing: [], overCap: rules.length > RULES_CHARS };
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
	for (const key of cited) {
		if (!hypotheses.has(key)) view.missing.push(key);
		if (!hypotheses.get(key)?.version) view.unchecked.push(key);
	}
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
