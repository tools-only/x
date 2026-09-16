/**
 * Agent-facing ARC contract shared by the Pi ARC extension.
 *
 * The SDK bridge supplies `model_prompt` rendered by the Python adapter.  This
 * small module keeps the Pi-side system prompt and a deterministic fallback in
 * the same adapter, so treatment cannot silently invent a different ARC view.
 */

import { loadPrompt } from "./prompt_loader.ts";

export const ARC_SYSTEM_PROMPT = loadPrompt("arc_system_prompt.md");

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
export function renderArcLatestFrameRuns(value: Record<string, any>): string {
	const frames = Array.isArray(value.frames) ? value.frames : [];
	const current = frames.at(-1);
	if (!Array.isArray(current)) return renderArcFrame(value);
	const width = Math.max(0, ...current.map((row: unknown) => Array.isArray(row) ? row.length : 0));
	const columnWidth = Math.max(2, String(Math.max(0, width - 1)).length);
	const parts = [
		`State: ${String(value.state ?? "UNKNOWN")}`,
		`Levels completed: ${Number(value.levels_completed ?? 0)}`,
		`Current frame is the last rendered frame (${frames.length} of ${frames.length}); earlier frames are animation context.`,
		`Lossless coordinate runs (inclusive columns), size=${current.length}x${width}:`,
		...current.map((row: unknown, index: number) => runEncodedRow(Array.isArray(row) ? row : [row], index, columnWidth)),
	];
	const budget = value.action_budget;
	if (budget && typeof budget === "object") {
		parts.push(
			`Action budget: level ${String(budget.used ?? 0)}/${String(budget.maximum ?? 0)}, ` +
			`total ${String(budget.total_used ?? 0)}/${String(budget.total_maximum ?? 0)}`,
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
