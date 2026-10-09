/**
 * External critic for the thin ARC harness. Code decides when it runs (stage
 * events, closed experiments, effort imbalance, repetition, stall), builds its
 * input from the ledger (never the agent's reasoning), and filters its reply by
 * checking cited action numbers. The note is advisory and shown once.
 * Design: docs/plans/2026-10-09-lightweight-hypothesis-loop-with-critic.md
 */
import { actionKey, observedSummary, measurementChanges, constantAtCompletions, type LedgerState } from "./arc_thin_ledger.ts";

export const CRITIC_SYSTEM = "You review an agent that is playing an ARC-AGI-3 game (64x64 integer grid, hidden rules, hidden win condition). " +
	"You see a summary of its trajectory, its ideas, its memory and measurements from its own skills, not its private reasoning. " +
	"Name at most 4 things it is likely missing right now: a conclusion it already reached but is not acting on, a contradiction " +
	"between its memory and what happened, a competing idea it stopped testing, or an action pattern that keeps giving the same result. " +
	"Every line must cite action numbers like #12. Optionally end with one line: suggest: ACTIONn (or suggest: ACTION6 x y). " +
	"No preamble, no headings, plain short lines.";

export type CriticConfig = {
	minGap: number; effortRun: number; experimentMin: number; stall: number; perLevel: number;
	maxOutputTokens: number; timeoutMs: number;
};
export const DEFAULT_CRITIC: CriticConfig = {
	minGap: 8, effortRun: 15, experimentMin: 5, stall: 20, perLevel: 6, maxOutputTokens: 8000, timeoutMs: 240_000,
};

export type CriticNote = {
	at: number; level: number; triggers: string[]; lines: string[]; dropped: string[];
	suggest?: { action: string; x?: number; y?: number }; idea_at?: string; repeat_keys?: string[];
};

/** Triggers among actions after `checkedThrough`, honouring the rate limit. */
export function criticTriggers(state: LedgerState, notes: CriticNote[], checkedThrough: number, hypotheses: number,
	config: CriticConfig = DEFAULT_CRITIC): { triggers: string[]; suppressed: string[] } {
	const now = state.rows.at(-1)?.n ?? 0;
	if (now <= checkedThrough) return { triggers: [], suppressed: [] };
	const fresh = state.rows.filter(row => row.n > checkedThrough);
	const lastNote = notes.at(-1)?.at ?? 0;
	const stage: string[] = [];
	for (const row of fresh) {
		if (row.level_changed) stage.push(`level change at #${row.n}`);
		if (row.state === "GAME_OVER") stage.push(`GAME_OVER at #${row.n}`);
		if (row.action === "RESET") stage.push(`RESET at #${row.n}`);
	}
	const other: string[] = [];
	// An experiment closed by a new idea is only known to be closed at the next action.
	for (const e of state.experiments) if (!e.open && (e.close_reason === "idea_changed" ? e.end + 1 : e.end) > checkedThrough
		&& (e.actions >= config.experimentMin || e.close_reason === "game_over"))
		other.push(`experiment "${e.label}" #${e.start}–#${e.end} closed (${e.close_reason})`);
	const current = state.experiments.at(-1);
	if (current?.open) {
		const since = current.end - Math.max(current.start - 1, lastNote);
		if (since >= config.effortRun && (state.effort.length >= 2 || hypotheses > 0))
			other.push(`${since} consecutive actions on "${current.label}" since the last review`);
	}
	for (const item of state.repeats) if (item.n > checkedThrough)
		other.push(`#${item.n} repeated the result of ${item.earlier.map(n => `#${n}`).join(", ")} from the same state`);
	if (state.stall >= config.stall && now - lastNote >= config.stall) other.push(`no new state for ${state.stall} actions`);
	const level = state.rows.at(-1)?.levels_completed ?? 0;
	const levelNotes = notes.filter(note => note.level === level).length;
	if (stage.length) return { triggers: [...stage, ...other], suppressed: [] };
	if (!other.length) return { triggers: [], suppressed: [] };
	if (now - lastNote < config.minGap || levelNotes >= config.perLevel) return { triggers: [], suppressed: other };
	return { triggers: other, suppressed: [] };
}

/** What followed a note within the next 5 actions. */
export function criticEffect(state: LedgerState, note: CriticNote): { complete: boolean; idea_changed: boolean;
	suggestion_taken: boolean; repeat_recurred: boolean } {
	const after = state.rows.filter(row => row.n > note.at && row.n <= note.at + 5);
	const ideaAfter = after.map(row => (row.idea ?? "").trim().toLowerCase()).filter(Boolean);
	return {
		complete: after.length >= 5,
		idea_changed: ideaAfter.some(idea => idea !== (note.idea_at ?? "").trim().toLowerCase()),
		suggestion_taken: Boolean(note.suggest && after.some(row => row.action === note.suggest!.action
			&& (note.suggest!.x === undefined || (row.x === note.suggest!.x && row.y === note.suggest!.y)))),
		repeat_recurred: Boolean(note.repeat_keys?.length && state.repeats.some(item => item.n > note.at && item.n <= note.at + 5
			&& note.repeat_keys!.includes(item.key.split("|").slice(1).join("|")))),
	};
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The critic's input, built only from the ledger and the stores. */
export function buildDossier(input: {
	state: LedgerState; triggers: string[]; memoryText: string; skills: string[]; notes: CriticNote[];
	recentLines: string[]; currentState: string;
}): string {
	const { state } = input;
	const effort = state.effort.slice(0, 8).map(item => `${item.label}: ${item.actions} actions, longest run ${item.longest}, last #${item.last}`);
	const experiments = state.experiments.slice(-6).map(e => `${e.label} #${e.start}–#${e.end}${e.open ? " (open)" : ` (${e.close_reason})`}: ` +
		`expected ${e.expect ? JSON.stringify(clip(e.expect, 200)) : "(not stated)"} | observed: ${observedSummary(state, e)}`);
	const completions = state.completions.map(item => `#${item.n} ${item.kind === "level" ? `level ${item.from}→${item.to}` : "GAME_OVER"}` +
		`${item.idea ? ` during "${item.idea}"` : ""}: ${Object.entries(item.leaves).slice(0, 8).map(([key, value]) => `${key}=${value}`).join(", ") || "(no measurements)"}`);
	const constant = constantAtCompletions(state.completions, state.index);
	const lastN = state.rows.at(-1)?.n ?? 0;
	const trend = measurementChanges(state.index, Math.max(0, lastN - 10), lastN, 8);
	const repeats = state.repeats.slice(-5).map(item => `#${item.n} same result from same state as ${item.earlier.map(n => `#${n}`).join(", ")}`);
	const notes = input.notes.slice(-3).map(note => {
		const effect = criticEffect(state, note);
		return `note at #${note.at}: ${note.lines.join(" / ")}${note.suggest ? ` / suggest ${actionKey(note.suggest)}` : ""}` +
			` → then: idea changed ${effect.idea_changed}, suggestion taken ${effect.suggestion_taken}${effect.complete ? "" : " (fewer than 5 actions since)"}`;
	});
	return [
		`WHY YOU ARE CALLED NOW: ${input.triggers.join("; ")}`,
		`ACTIONS SO FAR: ${lastN}; levels completed: ${state.rows.at(-1)?.levels_completed ?? 0}`,
		`EFFORT BY IDEA (the agent's own labels; unlabelled moves are grouped by action):\n${effort.join("\n") || "(none)"}`,
		`RECENT EXPERIMENTS:\n${experiments.join("\n") || "(none)"}`,
		`LEVEL COMPLETIONS AND GAME_OVERS (measurements are the agent's skills on the state before that action):\n${completions.join("\n") || "(none yet)"}` +
			(constant.length ? `\nSame at every level completion: ${constant.join(", ")}` : ""),
		`MEASUREMENT CHANGES OVER THE LAST 10 ACTIONS: ${trend.join(", ") || "(none)"}`,
		`REPEATED RESULTS: ${repeats.join("; ") || "(none)"}`,
		`AGENT MEMORY:\n${input.memoryText}`,
		`AGENT SKILLS: ${input.skills.join(", ") || "(none)"}`,
		`EARLIER REVIEWS:\n${notes.join("\n") || "(none)"}`,
		`LAST ACTIONS:\n${input.recentLines.join("\n")}`,
		`CURRENT STATE:\n${input.currentState}`,
	].join("\n\n");
}

/** Keep at most 4 lines that cite only existing actions; parse an optional suggestion. */
export function parseCriticReply(text: string, actionCount: number, available: string[]): Pick<CriticNote, "lines" | "dropped" | "suggest"> {
	const lines: string[] = [], dropped: string[] = [];
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
		const cited = [...line.matchAll(/#(\d+)/g)].map(match => Number(match[1]));
		if (cited.length && cited.every(n => n >= 1 && n <= actionCount) && lines.length < 4) lines.push(clip(line, 300));
		else dropped.push(clip(line, 300));
	}
	return { lines, dropped, ...(suggest ? { suggest } : {}) };
}
