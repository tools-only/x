/**
 * External critic for the thin ARC harness. Code decides when it runs: only when something went wrong (GAME_OVER,
 * a missed level/WIN prediction, repeated prediction misses, a long stretch without a goal check while predictions
 * miss, repeated results, a stall, a review that was not acted on). It is asked one falsifying question about the
 * agent's own claims, its input is built from the ledger and the stores (never the agent's reasoning), and its reply
 * is filtered by checking cited action numbers and keys. The note is advisory and shown once.
 * Design: docs/plans/2026-10-09-lightweight-hypothesis-loop-with-critic.md; the challenge-first
 * instructions and the escalation after an unanswered review: docs/plans/2026-10-10-self-harness-priority-plan.md §10.11;
 * failure-only triggers, the structured reply and key-based follow-up: docs/reports/2026-10-12-tu93-new-design-analysis.md §4
 */
import {
	actionKey, budgetLeft, goalCoverageLine, goalPredictionRows, measurementChanges, constantAtCompletions,
	type GoalHypothesisRef, type LedgerState,
} from "./arc_thin_ledger.ts";

// A real ls20 note (2026-10-10, #22) led with a correction of the agent's own move count; the agent took that
// line ("the critic was right") and kept its plan, ignoring the untested rival and the suggested action.
// Open reviews (2026-10-11) produced label complaints repeated in 7 of 15 notes; the question is now one: which
// claim does the record contradict or leave untested, and what observation would separate it from a rival.
export const CRITIC_SYSTEM = "You review an agent that is playing an ARC-AGI-3 game (64x64 integer grid, hidden rules, hidden win condition). " +
	"You are called because something went wrong (WHY YOU ARE CALLED NOW). You see its record: actions, how its predictions scored, " +
	"its hypotheses and strategy and measurements from its own skills, not its private reasoning. " +
	"Find the claims the agent relies on that the record contradicts or leaves untested: a hypothesis or strategy key (hyp.x, strat.y), " +
	"or goal for its model of how a level is won. Reply with at most 3 lines, the most important first, each exactly: " +
	"target | status | evidence | cheapest test. status is contradicted, untested, stalled or weakened. evidence cites recorded actions (#12, #3-#7). " +
	"cheapest test names the observation that would separate the claim from a rival, not an action sequence. " +
	"Do not correct counts or positions unless that changes a status. Do not repeat an earlier review unless new evidence changed it. No other text.";

export type CriticConfig = {
	minGap: number; effortRun: number; experimentMin: number; stall: number; perLevel: number;
	maxOutputTokens: number; timeoutMs: number;
};
export const DEFAULT_CRITIC: CriticConfig = {
	minGap: 8, effortRun: 15, experimentMin: 5, stall: 20, perLevel: 6,
	// The critic is asked for at most three structured lines. Keep its independent
	// request bounded so an in-flight review cannot remain invisible for most
	// of a short ARC run (P050/P051 had checks but no completed notes).
	maxOutputTokens: 2000, timeoutMs: 60_000,
};

export type CriticNote = {
	at: number; level: number; triggers: string[]; lines: string[]; dropped: string[];
	suggest?: { action: string; x?: number; y?: number }; idea_at?: string; repeat_keys?: string[];
	/** Keys (or "goal") the kept lines are about: the note counts as acted on when the agent revises one of them. */
	targets?: string[];
};

/** Did the agent write any of these memory keys after action `from` and up to action `to`? */
export type TouchedKeys = (keys: string[], from: number, to: number) => boolean;

const missed = (row: LedgerState["rows"][number]) => (row.prediction?.fields ?? []).some(field => field.hit === false);

/** Triggers among actions after `checkedThrough`, honouring the rate limit. Only failures trigger a review. */
export function criticTriggers(state: LedgerState, notes: CriticNote[], checkedThrough: number, _hypotheses: number,
	config: CriticConfig = DEFAULT_CRITIC, touched?: TouchedKeys): { triggers: string[]; suppressed: string[] } {
	const now = state.rows.at(-1)?.n ?? 0;
	if (now <= checkedThrough) return { triggers: [], suppressed: [] };
	const fresh = state.rows.filter(row => row.n > checkedThrough);
	const lastNote = notes.at(-1)?.at ?? 0;
	const stage: string[] = [];
	for (const row of fresh) if (row.state === "GAME_OVER") stage.push(`GAME_OVER at #${row.n}`);
	for (const item of goalPredictionRows(state)) if (item.row.n > checkedThrough && item.result === "MISS")
		stage.push(`#${item.row.n}: the predicted ${item.row.predict?.level_changed === true ? "level change" : "WIN"} did not happen`);
	const other: string[] = [];
	const recentMisses = state.rows.slice(-5).filter(missed);
	if (recentMisses.length >= 2 && recentMisses.some(row => row.n > checkedThrough))
		other.push(`predictions missed at ${recentMisses.map(row => `#${row.n}`).join(", ")} (of the last 5 actions)`);
	// A long stretch on one level with no level/WIN prediction is reported only while predictions also miss:
	// a plan whose predictions keep hitting is left alone.
	const levelStart = [...state.rows].reverse().find(row => row.level_changed)?.n ?? 0;
	const since = now - levelStart;
	const goalChecked = goalPredictionRows(state).some(item => item.row.n > levelStart);
	const spanMisses = state.rows.filter(row => row.n > levelStart && missed(row)).length;
	if (since >= config.effortRun && !goalChecked && spanMisses > 0 && now - Math.max(lastNote, levelStart) >= config.effortRun)
		other.push(`${since} actions on this level without a level/WIN prediction; ${spanMisses} of them had prediction misses`);
	for (const item of state.repeats) if (item.n > checkedThrough)
		other.push(`#${item.n} repeated the result of ${item.earlier.map(n => `#${n}`).join(", ")} from the same state`);
	if (state.stall >= config.stall && now - lastNote >= config.stall) other.push(`no new state for ${state.stall} actions`);
	const level = state.rows.at(-1)?.levels_completed ?? 0;
	const levelNotes = notes.filter(note => note.level === level).length;
	if (stage.length) return { triggers: [...stage, ...other], suppressed: [] };
	// A review the agent did not act on is reported once, when the fifth action after it is first seen,
	// without waiting out the rate limit (a failed critic call writes no note and must not make this repeat).
	const last = notes.at(-1);
	const ignored = last && last.at + 5 > checkedThrough && last.at + 5 <= now ? ignoredReview(state, last, touched) : undefined;
	if (ignored && levelNotes < config.perLevel) return { triggers: [ignored, ...other], suppressed: [] };
	if (!other.length) return { triggers: [], suppressed: [] };
	if (now - lastNote < config.minGap || levelNotes >= config.perLevel) return { triggers: [], suppressed: other };
	return { triggers: other, suppressed: [] };
}

/** Marks a trigger raised because the previous review was not acted on. */
export const IGNORED_REVIEW = "the review at #";

/**
 * Whether the 5 actions after a review left it unanswered; a factual line saying so, otherwise undefined. A note about
 * keys is answered when the agent wrote one of those keys (touched) or took the suggestion; a note about the goal
 * when a level/WIN prediction followed. A note with no targets falls back to the idea labels: every one of the 5
 * actions kept the label the note was given under. Whether the review was right is not judged.
 */
export function ignoredReview(state: LedgerState, note: CriticNote, touched?: TouchedKeys): string | undefined {
	if (!note.lines.length && !note.suggest) return undefined;
	const effect = criticEffect(state, note);
	if (!effect.complete || effect.suggestion_taken) return undefined;
	const span = `#${note.at + 1}–#${note.at + 5}`;
	const keys = (note.targets ?? []).filter(target => target !== "goal");
	if (note.targets?.length) {
		if (keys.length && touched?.(keys, note.at, note.at + 5)) return undefined;
		if (note.targets.includes("goal") && goalPredictionRows(state).some(item => item.row.n > note.at && item.row.n <= note.at + 5)) return undefined;
		const about = [...keys, ...(note.targets.includes("goal") ? ["the goal (no level/WIN prediction)"] : [])];
		return `${IGNORED_REVIEW}${note.at} was not acted on: ${span} did not revise ${about.join(", ")}` +
			(note.suggest ? ` or try ${actionKey(note.suggest)}` : "");
	}
	if (!effect.idea_kept) return undefined;
	return `${IGNORED_REVIEW}${note.at} was not acted on: ${span} kept the idea "${note.idea_at}"` +
		(note.suggest ? ` and did not try ${actionKey(note.suggest)}` : "");
}

/** What followed a note within the next 5 actions. idea_kept: every one of them carried the idea label the note was given under. */
export function criticEffect(state: LedgerState, note: CriticNote): { complete: boolean; idea_changed: boolean; idea_kept: boolean;
	suggestion_taken: boolean; repeat_recurred: boolean } {
	const after = state.rows.filter(row => row.n > note.at && row.n <= note.at + 5);
	const ideaAfter = after.map(row => (row.idea ?? "").trim().toLowerCase()).filter(Boolean);
	const ideaAt = (note.idea_at ?? "").trim().toLowerCase();
	return {
		complete: after.length >= 5,
		idea_changed: ideaAfter.some(idea => idea !== ideaAt),
		idea_kept: Boolean(ideaAt) && after.length >= 5 && ideaAfter.length === after.length && ideaAfter.every(idea => idea === ideaAt),
		suggestion_taken: Boolean(note.suggest && after.some(row => row.action === note.suggest!.action
			&& (note.suggest!.x === undefined || (row.x === note.suggest!.x && row.y === note.suggest!.y)))),
		repeat_recurred: Boolean(note.repeat_keys?.length && state.repeats.some(item => item.n > note.at && item.n <= note.at + 5
			&& note.repeat_keys!.includes(item.key.split("|").slice(1).join("|")))),
	};
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The critic's input, built only from the ledger and the stores. Kept small (about 6-9k characters; the open review's
 * dossier was 21-27k): the claims, the failures, the last actions with their prediction scores and the budget. The
 * effort-by-idea and experiment sections are gone with the label-based triggers.
 */
export function buildDossier(input: {
	state: LedgerState; triggers: string[]; memoryText: string; skills: string[]; notes: CriticNote[];
	recentLines: string[]; currentState: string; goalHypotheses?: GoalHypothesisRef[];
}): string {
	const { state } = input;
	const completions = state.completions.slice(-4).map(item => `#${item.n} ${item.kind === "level" ? `level ${item.from}→${item.to}` : "GAME_OVER"}: ` +
		`${Object.entries(item.leaves).slice(0, 6).map(([key, value]) => `${key}=${value}`).join(", ") || "(no measurements)"}`);
	const constant = constantAtCompletions(state.completions, state.index);
	const lastN = state.rows.at(-1)?.n ?? 0;
	const trend = measurementChanges(state.index, Math.max(0, lastN - 10), lastN, 6);
	const repeats = state.repeats.slice(-4).map(item => `#${item.n} same result from same state as ${item.earlier.map(n => `#${n}`).join(", ")}`);
	const notes = input.notes.slice(-2).map(note => `note at #${note.at}: ${note.lines.join(" / ") || "(nothing kept)"}`);
	return [
		`WHY YOU ARE CALLED NOW: ${input.triggers.join("; ")}`,
		`ACTIONS SO FAR: ${lastN}; levels completed: ${state.rows.at(-1)?.levels_completed ?? 0}` +
			(budgetLeft(state) !== null ? `; actions left in budget: ${budgetLeft(state)}` : ""),
		goalCoverageLine(state, input.goalHypotheses),
		`AGENT HYPOTHESES, STRATEGY AND NOTES:\n${clip(input.memoryText, 3200)}`,
		`AGENT SKILLS: ${clip(input.skills.join(", ") || "(none)", 600)}`,
		`LEVEL COMPLETIONS AND GAME_OVERS (the agent's skills on the state before that action):\n${completions.join("\n") || "(none yet)"}` +
			(constant.length ? `\nSame at every level completion: ${constant.join(", ")}` : ""),
		`MEASUREMENT CHANGES OVER THE LAST 10 ACTIONS: ${trend.join(", ") || "(none)"}`,
		`REPEATED RESULTS: ${repeats.join("; ") || "(none)"}`,
		`EARLIER REVIEWS:\n${notes.join("\n") || "(none)"}`,
		`LAST ACTIONS (with how their predictions scored):\n${input.recentLines.join("\n")}`,
		`CURRENT STATE (summary):\n${clip(input.currentState, 2400)}`,
	].join("\n\n");
}

const STATUS_WORDS = new Set(["contradicted", "untested", "stalled", "weakened"]);
const KEY = /\b(?:hyp|strat)\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g;

/**
 * Keep at most 3 lines that are grounded in the run, and parse an optional suggestion.
 * A structured line ("target | status | evidence | cheapest test") is kept when its target is one of the agent's
 * hypothesis/strategy keys or "goal" and its evidence cites existing actions; it is shown as
 * "target status: evidence; cheapest test: …". A plain line is kept when it cites existing actions (#12, #3–#7),
 * names one of the agent's keys, or counts actions within the run ("22 actions"). A line citing an action or key that
 * does not exist is dropped, as is a line that cites nothing, or one that repeats an earlier kept line word for word.
 *
 * The citation rule used to accept only "#N". In a real run (hypstrategy ls20, 2026-10-11) it dropped every
 * "goal model hyp.goal_right is unresolved: 22 actions spent… zero WIN checks" line and passed only the label
 * complaints that happened to cite an action, so the critic's main finding never reached the agent.
 */
export function parseCriticReply(text: string, actionCount: number, available: string[],
	keys: string[] = [], earlier: string[] = []): Pick<CriticNote, "lines" | "dropped" | "suggest" | "targets"> {
	const lines: string[] = [], dropped: string[] = [], targets: string[] = [];
	const known = new Set(keys.map((key) => key.toLowerCase()));
	const norm = (line: string) => line.toLowerCase().replace(/\s+/g, " ").trim();
	const seen = new Set(earlier.map(norm));
	const citedIn = (line: string) => [...line.matchAll(/#(\d+)/g)].map(match => Number(match[1]));
	const validCites = (cited: number[]) => cited.every(n => n >= 1 && n <= actionCount);
	let suggest: CriticNote["suggest"];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, "").trim();
		if (!line) continue;
		const s = /^suggest\s*:\s*(ACTION[1-7]|RESET)(?:\s*\(?\s*(\d{1,2})\s*[, ]\s*(\d{1,2})\s*\)?)?/i.exec(line);
		if (s) {
			const action = s[1].toUpperCase();
			if (available.includes(action)) suggest = { action, ...(s[2] !== undefined ? { x: Number(s[2]), y: Number(s[3]) } : {}) };
			continue;
		}
		const keep = (shown: string, about: string[]) => {
			if (lines.length >= 3 || seen.has(norm(shown))) { dropped.push(clip(line, 300)); return; }
			lines.push(clip(shown, 300));
			seen.add(norm(shown));
			for (const target of about) if (!targets.includes(target)) targets.push(target);
		};
		const fields = line.split("|").map(field => field.trim());
		if (fields.length >= 3) {
			const target = fields[0].toLowerCase().replace(/^target\s*:\s*/, "");
			const status = fields[1].toLowerCase();
			const cited = citedIn(fields[2]);
			const targetOk = target === "goal" || known.has(target);
			if (!targetOk || !cited.length || !validCites(cited) || citedIn(line).some(n => n < 1 || n > actionCount)) {
				dropped.push(clip(line, 300));
				continue;
			}
			keep(`${target} ${STATUS_WORDS.has(status) ? status : `(${status})`}: ${fields[2]}${fields[3] ? `; cheapest test: ${fields.slice(3).join(" | ")}` : ""}`, [target]);
			continue;
		}
		const cited = citedIn(line);
		const named = [...line.matchAll(KEY)].map(match => match[0].toLowerCase());
		const counts = [...line.matchAll(/\b(\d+)\s+actions?\b/gi)].map(match => Number(match[1]));
		const invented = !validCites(cited) || named.some(key => !known.has(key));
		const grounded = cited.length > 0 || named.length > 0 || counts.some(n => n >= 1 && n <= actionCount);
		if (grounded && !invented) keep(line, named);
		else dropped.push(clip(line, 300));
	}
	return { lines, dropped, ...(suggest ? { suggest } : {}), ...(targets.length ? { targets } : {}) };
}
