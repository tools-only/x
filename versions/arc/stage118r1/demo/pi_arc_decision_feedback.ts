import { arcActionCoordinates } from "./pi_arc_action_input.ts";
import { arcIsDecisionMultiRegion } from "./pi_arc_context_projection.ts";

type RecentAction = {
	action?: unknown;
	observation_id?: unknown;
	changed_cells?: unknown;
	level_changed?: unknown;
	level_after?: unknown;
	x?: unknown;
	y?: unknown;
	target_cell?: unknown;
	change_groups?: unknown;
};

type FrameCell = number | string;

/** Mechanical coverage only: repeated clicks are not new locations or discoveries. */
export function arcProbeCoverage(actions: RecentAction[] | unknown): Record<string, any> {
	if (!Array.isArray(actions)) return { actions: 0, unique_targets: 0, repeated_attempts: 0, targets: [] };
	const boundary = actions.findLastIndex(item => item.action === "RESET" || item.level_changed === true);
	const active = actions.slice(boundary + 1).filter(item => typeof item.changed_cells === "number"
		&& arcActionCoordinates(item));
	const targets = new Map<string, Record<string, any>>();
	for (const item of active) {
		const key = `${item.action}:${item.x},${item.y}`, prior = targets.get(key);
		targets.set(key, { action: item.action, x: item.x, y: item.y, attempts: (prior?.attempts ?? 0) + 1,
			visible_effects: (prior?.visible_effects ?? 0) + Number(item.changed_cells > 0),
			last_observation_ref: item.observation_id ? `observation:${item.observation_id}@v1` : null });
	}
	return { scope: "successful_coordinate_actions_since_reset_or_level_transition", actions: active.length,
		unique_targets: targets.size, repeated_attempts: active.length - targets.size,
		targets: [...targets.values()].slice(-24), omitted_targets: Math.max(0, targets.size - 24),
		interpretation: "Untested coordinates and regions remain unknown; sampling one color does not test that color everywhere." };
}

function contrastProbeSamples(frame: unknown, actions: RecentAction[]): string {
	actions = actions.filter(item => arcActionCoordinates(item));
	if (!actions.length) return "";
	if (!Array.isArray(frame) || !frame.length || !frame.every((row) => Array.isArray(row))) return "";
	const grid = frame as FrameCell[][];
	const height = grid.length, width = Math.min(...grid.map((row) => row.length));
	if (!width || height * width > 65_536) return "";
	const seen = new Uint8Array(height * width);
	const tested = new Set(actions.filter((item) => Number.isInteger(item.x) && Number.isInteger(item.y))
		.map((item) => `${item.x},${item.y}`));
	const testedColors = new Set(actions.map((item) => (item.target_cell as Record<string, unknown> | undefined)?.before)
		.filter((value) => value !== undefined).map(String));
	const byColor = new Map<string, Array<{ x: number; y: number; size: number; distance: number }>>();
	const last = actions.findLast((item) => Number.isInteger(item.x) && Number.isInteger(item.y));
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const start = y * width + x;
		if (seen[start]) continue;
		const color = String(grid[y][x]);
		const queue = [start];
		seen[start] = 1;
		let minX = x, maxX = x, minY = y, maxY = y;
		for (let index = 0; index < queue.length; index += 1) {
			const cell = queue[index], cx = cell % width, cy = Math.floor(cell / width);
			minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
			minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
			for (const next of [cx > 0 ? cell - 1 : -1, cx + 1 < width ? cell + 1 : -1,
				cy > 0 ? cell - width : -1, cy + 1 < height ? cell + width : -1]) {
				if (next < 0 || seen[next] || String(grid[Math.floor(next / width)][next % width]) !== color) continue;
				seen[next] = 1; queue.push(next);
			}
		}
		// Large uniform patches provide a different action surface without
		// asserting that any patch is editable or that its color has a meaning.
		if (queue.length < 9 || queue.length > 256) continue;
		const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
		// One tested point already samples this connected patch. Offer a different
		// patch, rather than nearby pixels in the same surface (even for same color).
		if (queue.some(cell => tested.has(`${cell % width},${Math.floor(cell / width)}`))) continue;
		const sample = queue.map((cell) => ({x:cell % width, y:Math.floor(cell / width)}))
			.filter((cell) => !tested.has(`${cell.x},${cell.y}`))
			.sort((a, b) => (Math.abs(a.x - centerX) + Math.abs(a.y - centerY))
				- (Math.abs(b.x - centerX) + Math.abs(b.y - centerY)) || a.y - b.y || a.x - b.x)[0];
		if (!sample) continue;
		const distance = last ? Math.abs(sample.x - Number(last.x)) + Math.abs(sample.y - Number(last.y)) : 0;
		const entries = byColor.get(color) ?? [];
		entries.push({...sample, size:queue.length, distance});
		byColor.set(color, entries);
	}
	const choices = [...byColor.entries()]
		.map(([color, entries]) => ({color, repeat:entries.length, colorPreviouslyTested:testedColors.has(color),
			best:entries.sort((a, b) => b.distance - a.distance || b.size - a.size)[0]}))
		.sort((a, b) => b.repeat - a.repeat || b.best.distance - a.best.distance || b.best.size - a.best.size)
		.slice(0, 3);
	return choices.length ? ` Untested uniform-patch contrasts (geometry only, not editability claims): ${choices.map((item) =>
		`color ${item.color}, ${item.repeat} patches, sample (${item.best.x},${item.best.y})${item.colorPreviouslyTested ? " (same color tested elsewhere; this patch remains untested)" : ""}`).join("; ")}.` : "";
}

/** A short Agent-side reminder from public pixel deltas, never a progress verdict. */
export function arcDecisionFeedback(actions: RecentAction[] | unknown, frame?: unknown): { signature: string; text: string } | null {
	if (!Array.isArray(actions) || !actions.length) return null;
	const latest = actions.at(-1) as RecentAction;
	if (latest?.level_changed === true || latest?.action === "RESET") return null;
	const changed = latest?.changed_cells;
	if (typeof changed !== "number" || !Number.isFinite(changed)) return null;
	const latestRef = String(latest.observation_id ?? `action-${actions.length}`);
	const boundary = actions.findLastIndex((item: RecentAction) => item.action === "RESET" || item.level_changed === true);
	const active = (actions as RecentAction[]).slice(boundary + 1);
	// A parent may see an eight-action batch only after its final action. Keep
	// one rare, complete public transition from that batch visible at this turn.
	const recentRegionWindow = active.slice(-8);
	const regionIndex = recentRegionWindow.findLastIndex(item => arcIsDecisionMultiRegion(item.change_groups));
	if (regionIndex >= 0) {
		const source = recentRegionWindow[regionIndex];
		const sourceRef = String(source.observation_id ?? `action-${actions.length - recentRegionWindow.length + regionIndex + 1}`);
		const groups = source.change_groups as Array<Record<string, unknown>>;
		const subsequentActions = recentRegionWindow.length - regionIndex - 1;
		const regions = groups.map(group => ({ cells: group.changed_cells, bbox: group.bbox }));
		return { signature: `multi-region-change:${sourceRef}`,
			text: `MULTI-REGION PUBLIC CHANGE at observation:${sourceRef}@v1: ${JSON.stringify(regions)}. ${subsequentActions ? `${subsequentActions} later native actions occurred before this parent turn; those boxes describe the earlier delta, so recheck the complete current frame. ` : ""}One action changed separate public regions without a level transition. Compare the current goal hypothesis and a distinct alternative against this evidence and the current state before extending the route; choose a bounded test if the difference matters. The regions alone do not establish a gate, target, or progress. A reusable calculation or method is optional when this comparison recurs.` };
	}
	if (changed > 0 && !active.slice(0, -1).some((item: RecentAction) =>
		typeof item.changed_cells === "number" && item.changed_cells > 0)) {
		return { signature: `first-visible:${latestRef}`,
			text: `FIRST VISIBLE RESPONSE: ${latestRef} changed ${changed} pixels. This establishes a visible effect, not goal progress. Compare the exact current frame with your prediction; preserve or revise the best-supported route.` };
	}
	if (changed > 0) {
		const positive = active.filter((item) => typeof item.changed_cells === "number" && item.changed_cells > 0);
		const repeated: Array<{ first: RecentAction; second: RecentAction }> = [];
		for (let index = 1; index < positive.length; index += 1) {
			const second = positive[index];
			if (!arcActionCoordinates(second)) continue;
			const first = positive.slice(0, index).findLast((item) => item.action === second.action
				&& item.x === second.x && item.y === second.y);
			if (first) repeated.push({ first, second });
		}
		if (repeated.length && repeated.at(-1)?.second === latest) {
			const pair = repeated.at(-1)!;
			const firstCell = pair.first.target_cell as Record<string, unknown> | undefined;
			const secondCell = pair.second.target_cell as Record<string, unknown> | undefined;
			const reverse = firstCell && secondCell && firstCell.before === secondCell.after
				&& firstCell.after === secondCell.before && firstCell.before !== firstCell.after;
			const cellEvidence = reverse
				? ` The exact clicked pixel followed ${String(firstCell.before)}->${String(firstCell.after)}->${String(secondCell.after)}. This is a reversible observed pixel transition, not a goal verdict.`
				: ` Re-read the exact target-cell before/after values and any changed indicator; intervening state may differ.`;
			const milestone = 2 ** Math.floor(Math.log2(repeated.length));
			return { signature: `repeat-visible:${String(active[0]?.observation_id ?? boundary + 1)}:${milestone}`,
				text: `REPEATED VISIBLE EFFECT AT THE SAME ACTION/COORDINATE: ${String(pair.first.observation_id)} and ${latestRef} both changed pixels at (${String(latest.x)},${String(latest.y)}).${cellEvidence} A one-way or already-solved/no-op method claim now needs a counterexample check; a monotonic indicator might count actions rather than objective progress. Reconcile the working strategy and any selected method if their prediction failed. No reset, component change, or action is required by this reminder.` };
		}
		const visibleCount = positive.length;
		if (visibleCount < 4) return null;
		const milestone = 2 ** Math.floor(Math.log2(visibleCount));
		const firstRef = String(active[0]?.observation_id ?? boundary + 1);
		return { signature: `visible-no-level:${String(latest.level_after ?? "unknown")}:${firstRef}:${milestone}`,
			text: `VISIBLE EFFECTS WITHOUT A LEVEL TRANSITION: ${visibleCount} actions in this attempt changed public pixels, latest ${latestRef}. These deltas are not evidence of level progress. Rebind any candidate goal configuration and predicted next effect to the current frame; compare the best route with a distinct alternative and its falsifier. If the working goal or strategy has changed, reconcile stale task_checkpoint fields and consider a scoped system_prompt or reusable method when it would improve subsequent decisions. No component or action is required by this reminder.` };
	}
	if (changed !== 0) return null;
	let streak = 0;
	for (let index = actions.length - 1; index >= 0; index -= 1) {
		const item = actions[index] as RecentAction;
		if (item.action === "RESET" || item.level_changed === true || item.changed_cells !== 0) break;
		streak += 1;
	}
	if (streak < 2) return null;
	const first = actions[actions.length - streak] as RecentAction;
	// Renew only at exponentially spaced evidence milestones, so a long no-op
	// sequence stays visible without adding a reminder on every action.
	const milestone = 2 ** Math.floor(Math.log2(streak));
	const silentActions = actions.slice(-streak) as RecentAction[];
	const recent = silentActions.slice(-Math.min(streak, 6));
	const resetCount = silentActions.filter((item) => item.action === "RESET").length;
	const coordinates = recent.map((item) => arcActionCoordinates(item)
		? `(${item.x},${item.y})` : "unbound");
	const repeated = [...new Set(coordinates.filter((value) => value !== "unbound"))]
		.filter((value) => coordinates.filter((candidate) => candidate === value).length > 1);
	const coordinateEvidence = coordinates.some((value) => value !== "unbound")
		? ` Recent tested coordinates (oldest to newest, at most 6): ${coordinates.join(" ")}.` +
			(repeated.length ? ` Repeated coordinates in that window: ${repeated.join(" ")}.` : "")
		: "";
	return { signature: `zero-visual-streak:${String(first.observation_id ?? actions.length - streak)}:${milestone}`,
		text: `REPEATED ZERO PIXEL DELTAS: ${streak} consecutive ARC actions without a visible effect or level change, including ${resetCount} RESET actions, latest ${latestRef}.${coordinateEvidence} These results establish only unchanged final public pixels; intermediate animation or buffer fingerprints do not establish persistent effects or goal progress. Reinspect the complete current grid/PNG already supplied; compare tested and visually distinct untested regions. A silent-sequence hypothesis needs a bounded terminal event that distinguishes it from an inert action. If that event fails, do not extend the same sequence using the same evidence.${contrastProbeSamples(frame, active)} Compare predicted effects and falsifiers before choosing a different probe or a provisional route; samples are geometry only, not inferred game rules.` };
}
