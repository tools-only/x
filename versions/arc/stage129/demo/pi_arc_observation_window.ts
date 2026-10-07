/** Deterministic ARC observation window assembled from canonical bridge events. */
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { renderExactArcRegions } from "./pi_arc_structural_regions.ts";
import { arcHasExactSmallTransition, renderArcDecisionDelta } from "./pi_arc_context_projection.ts";

export const ARC_OBSERVATION_WINDOW_CODEC = "arc-observation-window-v2";
type Grid = number[][];
type ArcEvent = Record<string, any>;

export type ArcObservationWindow = {
	text: string;
	images: Array<ReturnType<typeof renderArcFrameImage>>;
	actionCount: number;
};

function grid(value: unknown): Grid | undefined {
	return Array.isArray(value) && value.length > 0 && value.every((row) =>
		Array.isArray(row) && row.length > 0 && row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 15))
		? value as Grid : undefined;
}

export function arcHexGrid(value: Grid, label: string): string {
	const width = value[0]?.length ?? 0;
	if (!width || value.some((row) => row.length !== width)) throw new Error("ARC grid must be rectangular");
	// Keep every pixel literal. Two decimal column rulers and sparse row labels
	// make large grids addressable without a reader tool or another model turn.
	const indexed = width >= 32 && width <= 99 && value.length >= 32 && value.length <= 99;
	const rulers = indexed ? [
		Array.from({ length: width }, (_, x) => String(Math.floor(x / 10))).join("") + " x tens",
		Array.from({ length: width }, (_, x) => String(x % 10)).join("") + " x ones",
	] : [];
	return [`Grid ${label} (${value.length}x${width}) [hex 0-f = color 0-15]:`,
		...rulers,
		...value.map((row, y) => row.map((cell) => cell.toString(16)).join("") +
			(indexed && y % 8 === 0 ? ` y=${String(y).padStart(2, "0")}` : ""))].join("\n");
}

function keyframeText(value: Grid, current: Grid, label: string): string {
	const full = arcHexGrid(value, label);
	if (value.length !== current.length || value.some((row, y) => row.length !== current[y].length)) return full;
	const spans: Array<[number, number, string]> = [];
	for (let y = 0; y < value.length; y += 1) {
		let x = 0;
		while (x < value[y].length) {
			if (value[y][x] === current[y][x]) { x += 1; continue; }
			const start = x;
			let hex = "";
			while (x < value[y].length && value[y][x] !== current[y][x]) {
				hex += value[y][x].toString(16); x += 1;
			}
			spans.push([y, start, hex]);
		}
	}
	const patch = `Grid ${label} (${value.length}x${value[0].length}) relative to current_state_frame [zero-based replacement spans [y,x_start,hex_values], hex 0-f = color 0-15; copy current_state_frame and replace spans; unlisted cells unchanged]:\n${JSON.stringify(spans)}`;
	return patch.length < full.length ? patch : full;
}

function difference(left: Grid, right: Grid): { count: number; bbox: number[] | null; colors: number[] } {
	let count = 0, minY = Infinity, minX = Infinity, maxY = -1, maxX = -1;
	const colors = new Set<number>();
	const height = Math.max(left.length, right.length);
	for (let y = 0; y < height; y += 1) {
		const width = Math.max(left[y]?.length ?? 0, right[y]?.length ?? 0);
		for (let x = 0; x < width; x += 1) {
			if (left[y]?.[x] === right[y]?.[x]) continue;
			count += 1;
			minY = Math.min(minY, y); minX = Math.min(minX, x);
			maxY = Math.max(maxY, y); maxX = Math.max(maxX, x);
			if (left[y]?.[x] !== undefined) colors.add(left[y][x]);
			if (right[y]?.[x] !== undefined) colors.add(right[y][x]);
		}
	}
	return { count, bbox: count ? [minY, minX, maxY, maxX] : null,
		colors: [...colors].sort((a, b) => a - b) };
}

function imageOf(value: Grid, label: string) {
	const image = renderArcFrameImage({ frames: [value] });
	return { ...image, label: `${label}\n${image.label}` };
}

/** The canonical bridge event list remains complete; only this provider view is bounded. */
export function renderArcObservationWindow(
	events: ArcEvent[], current: Record<string, any>,
	options: { includeImages?: boolean; maxDetailedActions?: number; maxKeyframeGrids?: number; exactRegions?: boolean } = {},
): ArcObservationWindow {
	const currentFrame = grid(Array.isArray(current.frames) ? current.frames.at(-1) : undefined);
	if (!currentFrame) throw new Error("current public ARC frame is unavailable");
	const emittedGrids = new Map([[JSON.stringify(currentFrame), "current_state_frame"]]);
	const actions = events.filter((item) => item.event === "action" || item.event === "forced_action");
	const detailLimit = options.maxDetailedActions ?? 15;
	const gridLimit = options.maxKeyframeGrids ?? 4;
	const detailed = actions.slice(-detailLimit);
	const collapsed = actions.length - detailed.length;
	const lines: string[] = [];
	const images: ArcObservationWindow["images"] = [];
	// Reserve grid slots for the most recent actions. Every action still keeps
	// its factual RESULT line even when its large grid is omitted.
	const eligible = detailed.map((item) => {
		const frames = Array.isArray(item.frame?.frames) ? item.frame.frames.map(grid).filter(Boolean) as Grid[] : [];
		const final = frames.at(-1);
		const delta = item.observation_delta ?? {};
		const needsFinalGrid = Number(delta.changed_cells ?? 0) > 0 && !arcHasExactSmallTransition(delta);
		return needsFinalGrid || Boolean(final && frames.slice(0, -1).some((candidate) => difference(candidate, final).count > 0));
	});
	const selected = new Set(eligible.flatMap((yes, index) => yes ? [index] : []).slice(-gridLimit));
	if (collapsed) lines.push(`Earlier actions since last observation: ${collapsed} (exact bridge events remain available).`);
	for (const [actionIndex, item] of detailed.entries()) {
		const frame = item.frame && typeof item.frame === "object" ? item.frame : {};
		const frames = Array.isArray(frame.frames) ? frame.frames.map(grid).filter(Boolean) as Grid[] : [];
		const final = frames.at(-1);
		const delta = item.observation_delta && typeof item.observation_delta === "object" ? item.observation_delta : {};
		const finalChanged = typeof delta.changed_cells === "number" ? delta.changed_cells > 0 : false;
		const transient = final ? frames.slice(0, -1).map((candidate, index) => ({
			index, ...difference(candidate, final), grid: candidate,
		})).filter((candidate) => candidate.count > 0) : [];
		const peak = [...transient].sort((a, b) => b.count - a.count || a.index - b.index)[0];
		const actionId = item.event === "action" ? `arc-action-${String(item.index)}` : `forced-${String(item.action ?? "RESET")}`;
		lines.push(`ACTION/RESULT ${actionId}: ${String(item.action ?? "UNKNOWN")}; state ${String(item.state_before ?? "UNKNOWN")} -> ${String(frame.state ?? "UNKNOWN")}; levels ${String(item.level_before ?? "?")} -> ${String(frame.levels_completed ?? "?")}; final_grid_changed=${finalChanged}; transient_animation=${transient.length > 0}.`);
		lines.push(`TRANSITION ${actionId}: ${renderArcDecisionDelta(delta, item.level_before !== undefined && frame.levels_completed !== undefined && item.level_before !== frame.levels_completed)}`);
		if (frames.length > 1) lines.push(`ANIMATION SUMMARY ${actionId}: frame_count=${frames.length}, frames_different_from_final=${JSON.stringify(transient.map((entry) => entry.index))}, peak_changed=${peak?.count ?? 0}, peak_frame_index=${peak?.index ?? null}, peak_bbox=${JSON.stringify(peak?.bbox ?? null)}, colors_seen=${JSON.stringify([...new Set(transient.flatMap((entry) => entry.colors))].sort((a, b) => a - b))}.`);
		const needsFinalGrid = finalChanged && !arcHasExactSmallTransition(delta);
		// Exact sparse changes plus the current grid preserve past final pixels.
		// Keep visual keyframes when the sparse representation is insufficient,
		// and retain intermediate animation evidence even for sparse final changes.
		const chosen = needsFinalGrid ? [{ index: frames.length - 1, grid: final }]
			: peak ? [{ index: peak.index, grid: peak.grid }] : [];
		for (const candidate of chosen) {
			if (!candidate.grid || !selected.has(actionIndex)) break;
			const label = `${actionId}_frame_${candidate.index}`;
			const fingerprint = JSON.stringify(candidate.grid);
			const sameGrid = emittedGrids.get(fingerprint);
			if (sameGrid) {
				lines.push(`Grid ${label}: same exact pixels as ${sameGrid}; its action/result or transient role remains as recorded above.`);
				continue;
			}
			emittedGrids.set(fingerprint, label);
			lines.push(keyframeText(candidate.grid, currentFrame, label));
			if (options.includeImages) images.push(imageOf(candidate.grid, label));
		}
	}
	lines.push(arcHexGrid(currentFrame, "current_state_frame"));
	if (options.exactRegions) {
		const regions = renderExactArcRegions(currentFrame);
		if (regions) lines.push(regions);
	}
	if (options.includeImages) images.push(imageOf(currentFrame, "current_state_frame"));
	return { text: lines.join("\n\n"), images, actionCount: actions.length };
}
