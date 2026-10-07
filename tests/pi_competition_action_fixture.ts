import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function competitionActions(pi: ExtensionAPI) {
	pi.registerTool({ name: "arc_action", label: "Comparison fixture", description: "Diagnostic public outcomes",
		parameters: Type.Object({ action: Type.String(), decision: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
		async execute(_id, p) {
			const changed = p.action === "visible" ? 4 : 0;
			const level = p.action === "level" ? 1 : 0;
			const details = { state: "NOT_FINISHED", levels_completed: level,
				public_transition: { level_changed: level === 1, level_before: 0, level_after: level },
				observation_delta: { changed_cells: changed, frame_available: true } };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		} });
	pi.registerTool({ name: "arc_actions", label: "Comparison batch fixture", description: "Diagnostic action sequence",
		parameters: Type.Object({ actions: Type.Array(Type.Object({ action: Type.String() })) }),
		async execute(_id, p) {
			const completed = p.actions.map((action, index) => ({
				index, action: action.action, state: "NOT_FINISHED", levels_completed: 0,
				action_budget: { total_used: index + 1, total_maximum: 10 },
				public_transition: { level_changed: false, level_before: 0, level_after: 0 },
				observation_delta: { changed_cells: action.action === "visible" ? 4 : 0, frame_available: true },
			}));
			return { content: [{ type: "text", text: JSON.stringify(completed) }], details: { completed } };
		} });
	pi.on("session_start", () => pi.setActiveTools([...new Set([...pi.getActiveTools(), "arc_action", "arc_actions"])]));
}
