/**
 * The level review (docs/plans/2026-10-20-level-review-lessons.md). When a level is completed, the runner gives the
 * agent one turn without actions to rewrite prompts/lessons.md: how the win was found, the win condition literally (for
 * that level only) and as a pattern, what moved progress, what wasted actions, and the win conditions to test first on
 * the next level. The file is the agent's own active prompt, so it is in front of every later decision; refinements do
 * not write it. In su15-cb-q38-1 (2026-10-19) the first level's win, written into the rules prompt as a general rule,
 * was the only win condition tested in the second level's first 30 actions, and the second level was never completed.
 *
 * This module is what that turn is shown: the completed level's actions by attempt, the move that completed it, the moves
 * that predicted a level change, its RESETs and GAME_OVERs, the hypotheses written or judged on it, the moves that gave
 * an earlier move's result again, and python run again with the same code. It counts and lists; what the record means is
 * the agent's to write.
 */
import { attempts } from "./arc_thin_coverage.ts";
import { claimVersion, levelOf, type ClaimRow } from "./arc_thin_claims.ts";

export const LESSONS_PATH = "prompts/lessons.md";
/** What the review asks prompts/lessons.md to stay under: it is sent with every decision. */
export const LESSONS_CHARS = 1200;
/** Tool calls one level review may make: enough to look something up, write the file and correct memory. */
export const LEVEL_REVIEW_CALLS = 8;
/** Moves listed per attempt: all of a short attempt, the first and last ones of a longer one. */
const HEAD = 12, TAIL = 24;
/** The same, for an attempt that did not complete the level. */
const OTHER_HEAD = 6, OTHER_TAIL = 10;
const MAX_HYPOTHESES = 10;

export type ReviewRow = {
	n: number; action: string; x?: number; y?: number; note?: string; changed_cells: number | null; bbox?: unknown;
	level_changed: boolean; state: string; levels_completed: number; predict?: { text?: string; level_changed?: boolean };
};
export type ReviewMemoryRow = { key?: string; hyp?: { claim?: string; status?: string; check?: string }; deleted?: boolean; at?: number; by?: string };
export type ReviewPython = { kind?: string; level?: number; shape?: string; gist?: string };

const clip = (text: string, max: number) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const label = (row: ReviewRow) => row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;
/** One move as the record lists it: "ACTION6(12,40)→7" (cells it changed), with * when it predicted a level change. */
const token = (row: ReviewRow) => `${label(row)}${row.predict?.level_changed === true ? "*" : ""}→${row.changed_cells ?? "?"}`;
const boxText = (row: ReviewRow) => {
	const box = row.bbox as { top?: number; left?: number; bottom?: number; right?: number } | undefined;
	return row.changed_cells && box && [box.top, box.left, box.bottom, box.right].every(Number.isFinite)
		? ` in x${box.left}-${box.right} y${box.top}-${box.bottom}` : "";
};

/** Consecutive equal moves as one, with their count: "ACTION6(33,27)→2 ×5". */
function runs(tokens: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < tokens.length;) {
		let j = i;
		while (j + 1 < tokens.length && tokens[j + 1] === tokens[i]) j += 1;
		out.push(j > i ? `${tokens[i]} ×${j - i + 1}` : tokens[i]);
		i = j + 1;
	}
	return out;
}
const shown = (tokens: string[], head: number, tail: number) => tokens.length <= head + tail ? tokens.join(", ")
	: `${tokens.slice(0, head).join(", ")}, … ${tokens.length - head - tail} more …, ${tokens.slice(-tail).join(", ")}`;

/**
 * The record for the level `completed` levels in: its rows are those played while `completed - 1` levels were complete
 * (levelOf), up to the move that completed it. `repeated`: moves that gave an earlier move's result again from the same
 * state (the ledger's repetitions); `python`: the run's python calls (component_runs.jsonl).
 */
export function levelRecord(input: {
	rows: ReviewRow[]; completed: number; memoryRows?: ReviewMemoryRow[]; checks?: ClaimRow[]; repeated?: number[]; python?: ReviewPython[];
}): string {
	const { completed } = input;
	const level = input.rows.filter((row) => levelOf(row) === completed - 1);
	const head = `LEVEL ${completed} RECORD (the level you just completed; level ${completed + 1} is on screen now). ` +
		"The runtime's counts; what they mean is yours to write.";
	if (!level.length) return `${head}\n- No action of this level is recorded.`;
	const win = level.find((row) => row.level_changed);
	const first = level[0].n, last = (win ?? level.at(-1)!).n;
	const overs = level.filter((row) => row.state === "GAME_OVER").map((row) => `#${row.n}`);
	const resets = level.filter((row) => row.action === "RESET").length;
	const tries = attempts(level);
	const lines = [head, `- #${first}–#${last}: ${plural(level.length, "action")} in ${plural(tries.length, "attempt")}; ` +
		`${resets ? plural(resets, "RESET") : "no RESET"}; ${overs.length ? `GAME_OVER at ${overs.join(", ")}` : "no GAME_OVER"}.`];
	if (win) lines.push(`- Completed by #${win.n} ${label(win)}, action ${level.indexOf(win) + 1} of the level: changed=${win.changed_cells ?? "?"}${boxText(win)}; ` +
		(win.predict?.level_changed === true ? "it predicted the level change" : "it did not predict a level change") +
		(win.note ? `; note: "${clip(win.note, 160)}"` : "") + (win.predict?.text ? `; predicted: "${clip(win.predict.text, 200)}"` : "") + ".");
	const tests = level.filter((row) => row.predict?.level_changed === true && row !== win);
	lines.push(tests.length ? `- Other moves that predicted a level change: ${tests.slice(0, 10).map((row) => `#${row.n} ${label(row)}` +
		(row.predict?.text ? ` ("${clip(row.predict.text, 80)}")` : "")).join("; ")}${tests.length > 10 ? `; and ${tests.length - 10} more` : ""}.`
		: "- No other move of the level predicted a level change.");
	// The level's moves by attempt; consecutive attempts that played the same moves to the same end are one line.
	lines.push("- Moves by attempt (→n: cells the move changed; *: it predicted a level change):");
	const listed = tries.map((attempt) => ({ attempt, tokens: runs(level.filter((row) => row.action !== "RESET" && row.n >= attempt.start
		&& row.n <= attempt.end).map(token)) }));
	const ending = { level: "completed the level", GAME_OVER: "ended in GAME_OVER", RESET: "ended by RESET", open: "not ended" };
	for (let i = 0; i < listed.length;) {
		let j = i;
		while (j + 1 < listed.length && listed[j + 1].attempt.ended === listed[i].attempt.ended
			&& listed[j + 1].tokens.join() === listed[i].tokens.join()) j += 1;
		const { attempt, tokens } = listed[i];
		const done = attempt.ended === "level";
		const moves = shown(tokens, done ? HEAD : OTHER_HEAD, done ? TAIL : OTHER_TAIL);
		lines.push(j > i
			? `  - attempts ${i + 1}–${j + 1}, #${attempt.start}–#${listed[j].attempt.end}: the same ${plural(attempt.actions, "move")} each time, each ${ending[attempt.ended]}: ${moves}`
			: `  - attempt ${i + 1}, #${attempt.start}–#${attempt.end}, ${plural(attempt.actions, "move")}, ${ending[attempt.ended]}: ${moves}`);
		i = j + 1;
	}
	lines.push(...hypothesisLines(input.memoryRows ?? [], input.checks ?? [], completed - 1, first, last));
	const repeated = (input.repeated ?? []).filter((n) => n >= first && n <= last);
	if (repeated.length) lines.push(`- ${plural(repeated.length, "move")} gave the same result from the same state as an earlier move of ` +
		`their attempt: ${repeated.slice(0, 12).map((n) => `#${n}`).join(", ")}${repeated.length > 12 ? ", …" : ""}.`);
	const families = new Map<string, { gist: string; count: number }>();
	for (const run of input.python ?? []) {
		if (run.kind !== "python" || Number(run.level) !== completed - 1 || !run.shape) continue;
		const family = families.get(run.shape) ?? { gist: String(run.gist ?? ""), count: 0 };
		family.count += 1;
		families.set(run.shape, family);
	}
	const again = [...families.values()].filter((family) => family.count >= 3).sort((a, b) => b.count - a.count);
	// A cell with nothing to run (comments only) has no first line: qwen with thinking off writes its reasoning that way.
	if (again.length) lines.push(`- Python run again with the same code (numbers aside): ${again.slice(0, 3).map((family) =>
		`${family.gist.trim() ? `\`${clip(family.gist, 60)}\`` : "cells with comments only"} ×${family.count}`).join(", ")}.`);
	return lines.join("\n");
}

/**
 * The hypotheses written, judged by their checks, or deleted while the level was played (memory rows whose action count
 * lies in [first - 1, last]), each with how it stood when the level was completed.
 */
function hypothesisLines(rows: ReviewMemoryRow[], checks: ClaimRow[], level: number, first: number, last: number): string[] {
	const keys = new Set<string>();
	const during = (row: ReviewMemoryRow) => row.at !== undefined && row.at >= first - 1 && row.at <= last;
	for (const row of rows) if (row.key?.startsWith("hyp.") && during(row)) keys.add(row.key);
	for (const row of checks) if (row.level === level) keys.add(row.key);
	const out: string[] = [];
	for (const key of keys) {
		const own = rows.filter((row) => row.key === key && (row.at ?? 0) <= last);
		const written = own.filter((row) => row.by !== "check" && !row.deleted);
		const end = own.at(-1);
		const latest = written.at(-1)?.hyp;
		if (!end || !latest) continue;
		const origin = written.find(during) && !written.some((row) => (row.at ?? 0) < first - 1)
			? `${written.find(during)!.by === "refinement" ? "a refinement's" : "yours"}, written at #${written.find(during)!.at}`
			: `${written[0].by === "refinement" ? "a refinement's" : "yours"}, from before this level`;
		const rejected = end.hyp?.status === "rejected" ? own.find((row) => during(row) && row.hyp?.status === "rejected") : undefined;
		const state = end.deleted ? `deleted at #${end.at}` : rejected ? `rejected at #${rejected.at}` : `${end.hyp?.status ?? "open"} when the level was completed`;
		const version = latest.check ? claimVersion(latest.check) : undefined;
		const results = version ? checks.filter((row) => row.key === key && row.version === version && row.level === level) : [];
		const count = (value: unknown) => results.filter((row) => row.result === value).length;
		out.push(`  - ${key} (${origin}): "${clip(latest.claim ?? "", 140)}" → ${state}` + (!version ? "; no check"
			: results.length ? `; its check on this level: holds ${count(true)}, fails ${count(false)}, n/a ${count(null)}${count("error") ? `, raised ${count("error")}` : ""}`
			: "; its check did not run on this level"));
		if (out.length >= MAX_HYPOTHESES) break;
	}
	return out.length ? ["- Hypotheses written, checked or deleted on this level:", ...out] : ["- No hypothesis was written, checked or deleted on this level."];
}
