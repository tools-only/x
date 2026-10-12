/**
 * Agent-facing ARC contract shared by the Pi ARC extension.
 *
 * The SDK bridge supplies `model_prompt` rendered by the Python adapter.  This
 * small module keeps the Pi-side system prompt and a deterministic fallback in
 * the same adapter, so treatment cannot silently invent a different ARC view.
 */

import { loadPrompt } from "./prompt_loader.ts";
import { renderArcCoarseLayout, renderArcUniformTileMap } from "./pi_arc_observation_layout.ts";

export const ARC_SYSTEM_PROMPT = loadPrompt("arc_system_prompt.md");

/**
 * Optional foundation exposed only to ARC-authored Skills.  It deliberately
 * accepts explicit coordinate sets and has no grid, colour, frame, object, or
 * goal knowledge.  Cross-frame comparison and semantic movement remain the
 * Skill's responsibility over state["history"].
 */
export const ARC_SKILL_FOUNDATION_VERSION = "arc-agi-3-foundation-v1";
export const ARC_SKILL_FOUNDATION_PYTHON = String.raw`
class _ArcFoundation:
    version = "${ARC_SKILL_FOUNDATION_VERSION}"

    @staticmethod
    def _coords(raw):
        if not isinstance(raw, (list, tuple, set, frozenset)):
            raise TypeError("arc coordinates must be an explicit iterable of [x, y] pairs")
        out = set()
        for item in raw:
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                raise ValueError("arc coordinates must contain [x, y] pairs")
            x, y = item
            if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
                raise ValueError("arc coordinates must use integer x and y")
            out.add((x, y))
        return sorted(out, key=lambda p: (p[1], p[0]))

    @staticmethod
    def _steps(connectivity):
        if connectivity == 4:
            return ((1, 0), (-1, 0), (0, 1), (0, -1))
        if connectivity == 8:
            return tuple((dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx, dy) != (0, 0))
        raise ValueError("connectivity must be 4 or 8")

    def bbox(self, coords):
        points = self._coords(coords)
        if not points:
            return None
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return {"min_x": min(xs), "min_y": min(ys), "max_x": max(xs), "max_y": max(ys),
                "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1, "count": len(points)}

    def translate(self, coords, dx, dy):
        if isinstance(dx, bool) or isinstance(dy, bool) or not isinstance(dx, int) or not isinstance(dy, int):
            raise ValueError("translation dx and dy must be integers")
        return [[x + dx, y + dy] for x, y in self._coords(coords)]

    def normalize(self, coords):
        points = self._coords(coords)
        if not points:
            return []
        box = self.bbox(points)
        return self.translate(points, -box["min_x"], -box["min_y"])

    def neighbors(self, coords, connectivity=4):
        points = self._coords(coords)
        present = set(map(tuple, points))
        steps = self._steps(connectivity)
        return [{"coord": [x, y], "neighbors": [[x + dx, y + dy] for dx, dy in steps if (x + dx, y + dy) in present]}
                for x, y in points]

    def components(self, coords, connectivity=4):
        points = self._coords(coords)
        present = set(map(tuple, points))
        steps = self._steps(connectivity)
        out = []
        while present:
            start = min(present, key=lambda p: (p[1], p[0]))
            present.remove(start)
            queue = [start]
            component = [start]
            while queue:
                x, y = queue.pop(0)
                for dx, dy in steps:
                    nxt = (x + dx, y + dy)
                    if nxt in present:
                        present.remove(nxt)
                        queue.append(nxt)
                        component.append(nxt)
            out.append([[x, y] for x, y in sorted(component, key=lambda p: (p[1], p[0]))])
        return out

arc = _ArcFoundation()
`;

function rowText(row: unknown): string {
	if (!Array.isArray(row)) return String(row);
	return `[${row.map((value) => String(value)).join(", ")}]`;
}

function runEncodedRow(row: unknown[], rowIndex: number, columnWidth: number): string {
	const runs: string[] = [];
	let start = 0;
	for (let column = 1; column <= row.length; column += 1) {
		if (column < row.length && row[column] === row[start]) continue;
		const left = String(start).padStart(columnWidth, "0");
		const right = String(column - 1).padStart(columnWidth, "0");
		const span = start === column - 1 ? `c${left}` : `c${left}-${right}`;
		runs.push(`${span}=${String(row[start])}`);
		start = column;
	}
	return `r${String(rowIndex).padStart(2, "0")}: ${runs.join(" ")}`;
}

/** Lossless, coordinate-preserving projection of only the current ARC frame. */
export function renderArcLatestFrameRuns(value: Record<string, any>, options: { derived?: boolean } = {}): string {
	const frames = Array.isArray(value.frames) ? value.frames : [];
	const current = frames.at(-1);
	if (!Array.isArray(current)) return renderArcFrame(value);
	const width = Math.max(0, ...current.map((row: unknown) => Array.isArray(row) ? row.length : 0));
	const columnWidth = Math.max(2, String(Math.max(0, width - 1)).length);
	const parts = [
		`State: ${String(value.state ?? "UNKNOWN")}`,
		`Levels completed: ${Number(value.levels_completed ?? 0)}`,
		`Current frame is the last rendered frame (${frames.length} of ${frames.length}); earlier frames are animation context.`,
		`Coordinate convention: x is column, y is row; (x,y) addresses current frame[y][x].`,
		...(options.derived === false ? [] : renderArcCoarseLayout(current)),
		...(options.derived === false ? [] : renderArcUniformTileMap(current)),
		`Lossless coordinate runs (inclusive columns), size=${current.length}x${width}:`,
		...current.map((row: unknown, index: number) => runEncodedRow(Array.isArray(row) ? row : [row], index, columnWidth)),
	];
	const budget = value.action_budget;
	if (budget && typeof budget === "object") {
		parts.push(
			`Action budget: level ${String(budget.used ?? 0)}/${String(budget.maximum ?? "unlimited")}, ` +
			`total ${String(budget.total_used ?? 0)}/${String(budget.total_maximum ?? "unlimited")}`,
		);
	}
	const actions = Array.isArray(value.agent_available_actions)
		? value.agent_available_actions
		: (value.available_actions ?? []);
	parts.push(`Available actions: ${actions.map((action: unknown) => String(action)).join(", ")}`);
	return parts.join("\n");
}

export function renderArcFrame(value: Record<string, any>): string {
	if (typeof value.model_prompt === "string") return value.model_prompt;
	const parts: string[] = [
		`State: ${String(value.state ?? "UNKNOWN")}\nLevels completed: ${Number(value.levels_completed ?? 0)}`,
	];
	const frames = Array.isArray(value.frames) ? value.frames : [];
	frames.forEach((frame: any, index: number) => {
		const rows = Array.isArray(frame) ? frame.map((row: unknown) => `  ${rowText(row)}`) : [];
		parts.push([`Frame ${index}:`, ...rows].join("\n"));
	});
	const actions = Array.isArray(value.agent_available_actions)
		? value.agent_available_actions
		: (value.available_actions ?? []);
	parts.push(`Available actions:\n${actions.map((action: unknown) => `- ${String(action)}`).join("\n")}`);
	return parts.join("\n\n");
}
