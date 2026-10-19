/**
 * Move coverage and attempts (docs/plans/2026-10-19-coverage-attempts-delivery.md). Counting only, over what every move
 * already reports: its action and coordinates, the grids before and after it, and the environment's level and terminal
 * signals. No objects, colours or game rules.
 *
 * Coverage: per level, how many moves of each kind the agent made. A click's kind is its distance from the area the
 * latest move of its attempt changed; another action's kind is the action, with the grids it was played from counted.
 * In su15-g56-2 (gpt-5.6-sol, 2026-10-19) the second level was lost to a belief that held on every click the agent made,
 * all on a block; the rival a refinement wrote differed from it only for clicks off the block, and its separating move
 * was another click on a block.
 *
 * Attempts: the actions between RESETs, GAME_OVERs and level changes. su15-g56-1 ended six attempts on its second level
 * in GAME_OVER; between them the agent noted hazards and kept its movement model.
 */
import { gridChanges } from "./arc_thin_history.ts";
import { gridHash, isGoalHypothesis } from "./arc_thin_ledger.ts";

type Grid = number[][];
/** The one action that takes coordinates in ARC-AGI-3 (the extension's takesCoordinates). */
export const CLICK = "ACTION6";
/** One recorded action, as trajectory rows carry it. */
export type MoveRow = { n: number; action: string; x?: number; y?: number; level_changed: boolean; state: string; levels_completed: number };
export type Box = { top: number; left: number; bottom: number; right: number };
export type Move = { action: string; x?: number; y?: number };

/** A click's distance from the last changed area (cells, Chebyshev): 0 inside, 1 touching, 2-6 near, more far. */
export const REGIONS = ["inside", "touching", "near", "far"] as const;
export type Region = typeof REGIONS[number];
const REGION_TEXT: Record<Region, string> = {
	inside: "inside the last changed area", touching: "touching the last changed area",
	near: "2-6 cells from the last changed area", far: "more than 6 cells from the last changed area",
};
const NEAR_MAX = 6;
export const regionOf = (distance: number): Region => distance <= 0 ? "inside" : distance === 1 ? "touching" : distance <= NEAR_MAX ? "near" : "far";
/** Chebyshev distance from a cell to a box; 0 inside it. */
export const boxDistance = (x: number, y: number, box: Box) =>
	Math.max(box.left - x, 0, x - box.right, box.top - y, y - box.bottom);
export const boxText = (box: Box) => `x${box.left}-${box.right} y${box.top}-${box.bottom}`;

/**
 * A row or column that changed on at least BUSY_SHARE of the ordinary moves (no RESET, level change or GAME_OVER) is a
 * counter or timer, not where a move acted: su15's move counter in row 63 changed on every move that changed anything,
 * so the bridge's box of each move reached down to it. The ledger's ticker cells (arc_thin_ledger.ts) apply the same
 * share to cells; a bar that shrinks changes each of its cells once, so here it is lines.
 */
export const BUSY_SHARE = 0.8;
export const BUSY_MIN_MOVES = 8;
export type Busy = { rows: Set<number>; cols: Set<number> };

const ordinary = (row: MoveRow) => row.action !== "RESET" && !row.level_changed && row.state !== "GAME_OVER";
/** The level an action was taken on (0-based): the levels completed before it. */
const levelOfRow = (row: MoveRow) => Math.max(0, row.levels_completed - (row.level_changed ? 1 : 0));

/** What every move changed, its box without busy lines, and each grid's key with them masked; cached per move. */
export class MoveFacts {
	private grids: Map<number, Grid>;
	private changes = new Map<number, Array<[number, number]> | null>();
	private keys = new Map<number, string>();
	private busyAt = -1;
	busy: Busy = { rows: new Set(), cols: new Set() };
	constructor(grids: Map<number, Grid>) { this.grids = grids; }
	/** Forget everything computed (the grids were reloaded). */
	clear(): void { this.changes.clear(); this.keys.clear(); this.busyAt = -1; this.busy = { rows: new Set(), cols: new Set() }; }
	/** Cells move n changed ([x, y]), or null without both grids (not kept: a grid may be recorded later). */
	changed(n: number): Array<[number, number]> | null {
		if (!this.changes.has(n)) {
			const before = this.grids.get(n - 1), after = this.grids.get(n);
			if (!before || !after) return null;
			const cells = gridChanges(before, after);
			this.changes.set(n, cells ? cells.map(([x, y]) => [x, y] as [number, number]) : null);
		}
		return this.changes.get(n)!;
	}
	/** Busy lines over the ordinary moves in `rows` (recomputed when more moves are recorded). */
	refresh(rows: MoveRow[]): Busy {
		if (this.busyAt === rows.length) return this.busy;
		const rowCounts = new Map<number, number>(), colCounts = new Map<number, number>();
		let moves = 0;
		for (const row of rows) {
			if (!ordinary(row)) continue;
			const cells = this.changed(row.n);
			if (!cells?.length) continue;
			moves += 1;
			for (const y of new Set(cells.map(([, y]) => y))) rowCounts.set(y, (rowCounts.get(y) ?? 0) + 1);
			for (const x of new Set(cells.map(([x]) => x))) colCounts.set(x, (colCounts.get(x) ?? 0) + 1);
		}
		const busy = (counts: Map<number, number>) => new Set(moves >= BUSY_MIN_MOVES
			? [...counts].filter(([, count]) => count >= BUSY_SHARE * moves).map(([line]) => line) : []);
		const next = { rows: busy(rowCounts), cols: busy(colCounts) };
		const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((line) => b.has(line));
		// Grid keys depend on the busy lines only.
		if (!same(next.rows, this.busy.rows) || !same(next.cols, this.busy.cols)) this.keys.clear();
		this.busy = next;
		this.busyAt = rows.length;
		return this.busy;
	}
	/** The box of the cells move n changed outside busy lines, or undefined. */
	box(n: number): Box | undefined {
		const cells = (this.changed(n) ?? []).filter(([x, y]) => !this.busy.rows.has(y) && !this.busy.cols.has(x));
		if (!cells.length) return undefined;
		const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y);
		return { top: Math.min(...ys), left: Math.min(...xs), bottom: Math.max(...ys), right: Math.max(...xs) };
	}
	/** The grid after move n (0: the start), busy lines masked, as a key. */
	key(n: number): string | undefined {
		if (!this.keys.has(n)) {
			const grid = this.grids.get(n);
			if (!grid) return undefined;
			const { rows, cols } = this.busy;
			this.keys.set(n, gridHash(rows.size || cols.size ? grid.map((line, y) => line.map((cell, x) => rows.has(y) || cols.has(x) ? -1 : cell)) : grid));
		}
		return this.keys.get(n);
	}
}

/** Each move's kind as played: "ACTION6:near" (a click, by its distance from the last changed area), "ACTION7"; RESET has none. */
export function moveKinds(rows: MoveRow[], facts: MoveFacts): Map<number, string> {
	facts.refresh(rows);
	const kinds = new Map<number, string>();
	let box: Box | undefined;
	for (const row of rows) {
		if (row.action === "RESET") { box = undefined; continue; }
		const region = row.x !== undefined && row.y !== undefined ? box ? regionOf(boxDistance(row.x, row.y, box)) : "unplaced" : undefined;
		kinds.set(row.n, region ? `${row.action}:${region}` : row.action);
		// The next move is measured from this one's change; an attempt or a level ends the reference.
		box = row.level_changed || row.state === "GAME_OVER" ? undefined : facts.box(row.n) ?? box;
	}
	return kinds;
}

/** The kinds of moves made on one level, with their counts. RESET is not a kind: it ends an attempt. */
export type Coverage = {
	level: number;
	/** Moves on the level (RESET left out). */
	moves: number;
	/** Clicks (moves with coordinates) by region; "unplaced": nothing had changed yet in their attempt. */
	clicks: Record<Region | "unplaced", number>;
	/** Other actions: how often played, and the distinct grids (busy lines masked) they were played from. */
	actions: Map<string, { played: number; grids: Set<string> }>;
	/** Distinct grids (busy lines masked) the level has shown. */
	grids: number;
	/** The area the next click is measured from: the box the latest change of the current attempt left. */
	box?: Box;
	/** The current grid's key (busy lines masked). */
	current?: string;
};

/** Coverage of the level the game is on after the latest move, up to it. */
export function coverage(rows: MoveRow[], facts: MoveFacts): Coverage {
	const kinds = moveKinds(rows, facts);
	const last = rows.at(-1);
	const level = last?.levels_completed ?? 0;
	const out: Coverage = { level, moves: 0, clicks: { inside: 0, touching: 0, near: 0, far: 0, unplaced: 0 }, actions: new Map(), grids: 0 };
	const seen = new Set<string>();
	for (const row of rows) {
		if (levelOfRow(row) !== level) continue;
		const from = facts.key(row.n - 1);
		if (from) seen.add(from);
		if (row.action === "RESET") continue;
		out.moves += 1;
		const region = kinds.get(row.n)!.split(":")[1] as Region | "unplaced" | undefined;
		if (region) { out.clicks[region] += 1; continue; }
		const entry = out.actions.get(row.action) ?? { played: 0, grids: new Set<string>() };
		entry.played += 1;
		if (from) entry.grids.add(from);
		out.actions.set(row.action, entry);
	}
	out.current = facts.key(last?.n ?? 0);
	if (out.current) seen.add(out.current);
	out.grids = seen.size;
	// The reference for the next click: the latest change in the current attempt, on this level.
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		const row = rows[i];
		if (row.action === "RESET" || row.state === "GAME_OVER" || row.level_changed) break;
		const box = facts.box(row.n);
		if (box) { out.box = box; break; }
	}
	return out;
}

/** A kind is rare when it holds at most this share of the level's moves (rounded down: none below 20 moves). */
export const RARE_SHARE = 0.05;

/** The kinds the available actions offer that the level has (almost) not seen. */
export function rareKinds(cov: Coverage, available: string[]): string[] {
	const limit = Math.floor(RARE_SHARE * cov.moves);
	const out: string[] = [];
	if (available.includes(CLICK)) for (const region of REGIONS) if (cov.clicks[region] <= limit) out.push(`${CLICK}:${region}`);
	for (const action of available) if (action !== CLICK && action !== "RESET" && (cov.actions.get(action)?.played ?? 0) <= limit) out.push(action);
	return out;
}

/** "a click 2-6 cells from the last changed area", "ACTION7". */
export function kindText(kind: string): string {
	const [action, region] = kind.split(":");
	return region && region !== "unplaced" ? `${action === CLICK ? "a click" : action} ${REGION_TEXT[region as Region]}` : action;
}

/**
 * The kind a proposed move would have now, and whether the level has (almost) not seen it. A click needs coordinates,
 * and is unplaced when nothing has changed yet in the attempt; another action counts as new from a grid it was never
 * played from.
 */
export function classify(move: Move, cov: Coverage, available: string[]): { kind: string; rare: boolean; placed: boolean; needsXY?: boolean } {
	const rare = rareKinds(cov, available);
	if (move.action === CLICK || (move.x !== undefined && move.y !== undefined)) {
		if (move.x === undefined || move.y === undefined) return { kind: `${move.action}:unplaced`, rare: false, placed: false, needsXY: true };
		if (!cov.box) return { kind: `${move.action}:unplaced`, rare: true, placed: false };
		const kind = `${move.action}:${regionOf(boxDistance(move.x, move.y, cov.box))}`;
		return { kind, rare: rare.includes(kind), placed: true };
	}
	const tried = cov.actions.get(move.action);
	return { kind: move.action, rare: rare.includes(move.action) || !cov.current || !tried?.grids.has(cov.current), placed: true };
}

/**
 * The gaps, as events carry them: "on level 2 (188 moves): 185 clicks by distance from the last changed area (now
 * x24-26 y36-38): inside 140, touching 20, 2-6 cells 0, more than 6 cells 3; ACTION7 played 2 times, from 1 of 9 grids".
 */
export function coverageText(cov: Coverage, available: string[]): string {
	const parts: string[] = [];
	if (available.includes(CLICK)) {
		const clicks = REGIONS.reduce((n, region) => n + cov.clicks[region], 0) + cov.clicks.unplaced;
		parts.push(`${clicks} click${clicks === 1 ? "" : "s"} by distance from the last changed area${cov.box ? ` (now ${boxText(cov.box)})` : ""}: ` +
			`inside ${cov.clicks.inside}, touching ${cov.clicks.touching}, 2-6 cells ${cov.clicks.near}, more than 6 cells ${cov.clicks.far}` +
			(cov.clicks.unplaced ? `, first of an attempt ${cov.clicks.unplaced}` : ""));
	}
	for (const action of available) {
		if (action === CLICK || action === "RESET") continue;
		const entry = cov.actions.get(action);
		parts.push(entry ? `${action} played ${entry.played} time${entry.played === 1 ? "" : "s"}, from ${entry.grids.size} of ${cov.grids} grids` : `${action} never played`);
	}
	return `on level ${cov.level + 1} (${cov.moves} move${cov.moves === 1 ? "" : "s"}): ${parts.join("; ")}`;
}

/** The first move a text names: "ACTION6(30,42)", "ACTION6 at (30, 42)", "ACTION6 x=30 y=42", "ACTION7". */
export function parseMove(text: string): Move | undefined {
	const match = /\b(ACTION\d+)\b/i.exec(text);
	if (!match) return undefined;
	const action = match[1].toUpperCase();
	const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
	const pair = /^\s*(?:at\s*|on\s*)?\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/i.exec(after)
		?? /^\s*(?:at\s*)?\(?\s*x\s*=\s*(\d{1,2})\s*[,;]?\s*y\s*=\s*(\d{1,2})/i.exec(after);
	return pair ? { action, x: Number(pair[1]), y: Number(pair[2]) } : { action };
}
export const moveText = (move: Move) => move.x !== undefined && move.y !== undefined ? `${move.action}(${move.x},${move.y})` : move.action;

// ---------------------------------------------------------------- attempts

export type Attempt = { level: number; start: number; end: number; actions: number; ended: "GAME_OVER" | "RESET" | "level" | "open" };

/** The actions between RESETs, GAME_OVERs and level changes; a RESET belongs to no attempt. */
export function attempts(rows: MoveRow[]): Attempt[] {
	const out: Attempt[] = [];
	let open: Attempt | undefined;
	for (const row of rows) {
		if (row.action === "RESET") {
			if (open) { open.ended = "RESET"; out.push(open); open = undefined; }
			continue;
		}
		open ??= { level: levelOfRow(row), start: row.n, end: row.n, actions: 0, ended: "open" };
		open.end = row.n; open.actions += 1;
		const ended = row.level_changed || row.state === "WIN" ? "level" : row.state === "GAME_OVER" ? "GAME_OVER" : undefined;
		if (ended) { open.ended = ended; out.push(open); open = undefined; }
	}
	if (open) out.push(open);
	return out;
}

/** A memory.jsonl row as the store keeps it. */
export type MemoryRow = { key?: string; hyp?: { claim?: string; question?: string; status?: string; check?: string }; deleted?: boolean; at?: number; by?: string };

/**
 * The action counts at which the agent changed a claim it holds about how its actions work: a hypothesis not about the
 * goal (isGoalHypothesis) rejected, deleted, or rewritten in what it predicts — its check, or its claim when it has none.
 * A new hypothesis beside it does not change it. In su15-g56-1 the agent rewrote hyp.color6_anchor_motion's claim after
 * its GAME_OVERs at #214 and #247, adding that obstacles and the timer can end a run, and added hyp.action7_undo at
 * #181; the check of its movement model, which is what is tested on the moves, stayed the same from #142 to the end.
 * A refinement's or a check's row is not the agent's.
 */
export function modelChanges(rows: MemoryRow[]): number[] {
	const held = new Map<string, { claim?: string; status?: string; question?: string; check?: string }>();
	const at: number[] = [];
	for (const row of rows) {
		if (!row.key?.startsWith("hyp.") || !(row.hyp || row.deleted)) continue;
		const before = held.get(row.key);
		const now = row.deleted ? undefined : { claim: row.hyp!.claim, status: row.hyp!.status, question: row.hyp!.question, check: row.hyp!.check };
		if (now) held.set(row.key, now); else held.delete(row.key);
		if (!before || row.by === "refinement" || row.by === "check") continue;
		if (isGoalHypothesis(row.key, now?.question ?? before.question)) continue;
		const changed = !now || (now.status === "rejected" && before.status !== "rejected")
			|| (now.check || before.check ? (now.check ?? "").trim() !== (before.check ?? "").trim() : before.claim !== now.claim);
		if (changed) at.push(Number(row.at) || 0);
	}
	return at;
}

/**
 * The failed attempts (GAME_OVER or RESET) on `level` played wholly after the agent last changed its model: they failed
 * under one model. A change at action count k (after action k) precedes the attempts that start after k.
 */
export function failedUnderOneModel(list: Attempt[], changes: number[], level: number): Attempt[] {
	const since = changes.reduce((a, b) => Math.max(a, b), -1);
	return list.filter((attempt) => attempt.level === level && (attempt.ended === "GAME_OVER" || attempt.ended === "RESET") && attempt.start > since);
}

/** The resources line: "this attempt: 22 actions; earlier attempts on this level ended after 31, 33, 29 actions (GAME_OVER)". */
export function attemptLine(list: Attempt[], level: number): string {
	const here = list.filter((attempt) => attempt.level === level);
	const ended = here.filter((attempt) => attempt.ended === "GAME_OVER" || attempt.ended === "RESET");
	if (!ended.length) return "";
	const open = here.at(-1)?.ended === "open" ? here.at(-1)!.actions : 0;
	return `this attempt: ${open} action${open === 1 ? "" : "s"}; earlier attempts on this level ended after ` +
		`${ended.slice(-4).map((attempt) => attempt.actions).join(", ")} actions (${[...new Set(ended.map((attempt) => attempt.ended))].join(" or ")})`;
}

/** Failed attempts on one level that start a repeated-failure event (P2); once per level and model. */
export const REPEAT_ATTEMPTS = 2;

/**
 * P2's refinement event: the attempts that failed under one model, and the request for a different control model that
 * fits the level in one attempt, tested by its cheapest move. `target` is the agent's hypothesis in play (the one whose
 * check decided most moves of those attempts), whose question the new model shares. It asks for a rival, not a
 * replacement: on su15-g61-1's fourth level (gpt-6.1-sol, 2026-10-19) seven attempts failed under the right control
 * model, lost to a hazard, the per-attempt timer and a wrong destination; there the test move settles it in one action.
 */
export function repeatEvent(failed: Attempt[], left: number | null, target: { key: string; question?: string; decided: number; holds: number } | undefined,
	gaps: { text: string } | undefined, moveForm: string): string {
	const endings = [...new Set(failed.map((attempt) => attempt.ended))].join(" or ");
	return `attempts on level ${failed[0].level + 1} since the agent last changed a hypothesis about what its actions do: ` +
		`${failed.map((attempt) => attempt.actions).join(", ")} actions, each ended by ${endings}` +
		(left !== null ? ` (${left} actions left in the level's budget)` : "") +
		(target ? `; the model in play is ${target.key} (holds on ${target.holds} of ${target.decided} decided moves in them)` : "") +
		(gaps ? `. Moves ${gaps.text}` : "") +
		`. Write the strongest different control model, one under which the level fits in one attempt, as a rival HYPOTHESIS` +
		(target?.question ? ` under the question "${target.question}"` : "") +
		` whose check disagrees with ${target?.key ?? "the current model"} on some move, and name the cheapest move that tests it in ` +
		`predicts as ${moveForm}: it becomes the first item of the strategy's next experiment, and that move shows which model holds. ` +
		`Not a better route under the current model`;
}
