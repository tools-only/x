/**
 * Agent-facing ARC contract shared by the Pi ARC extension.
 *
 * The SDK bridge supplies `model_prompt` rendered by the Python adapter.  This
 * small module keeps the Pi-side system prompt and a deterministic fallback in
 * the same adapter, so treatment cannot silently invent a different ARC view.
 */

export const ARC_SYSTEM_PROMPT =
	"You are playing a game. Your goal is to win. Include any context you want " +
	"to carry forward in your reply, along with the action you want to take. " +
	"The final action mentioned in your reply will be executed next turn.";

function rowText(row: unknown): string {
	if (!Array.isArray(row)) return String(row);
	return `[${row.map((value) => String(value)).join(", ")}]`;
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
