import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function arcActionCaptureFixture(pi: ExtensionAPI) {
	pi.registerTool({
		name: "arc_action",
		label: "Fixture ARC action",
		description: "Emit deterministic public transitions for Memory capture tests.",
		parameters: Type.Object({
			action: Type.String(),
			decision: Type.Optional(Type.Record(Type.String(), Type.Any())),
		}),
		async execute(_id, input) {
			const action = String((input as any).action);
			const details = action === "cross"
				? { state: "state-level-1", level_before: "level-0", level_after: "level-1",
					level_changed: true, changed_cells: [{ x: 1, y: 2, before: 0, after: 1 }],
					public_transition: { level_changed: true, level_before: "level-0", level_after: "level-1" } }
				: action === "RESET"
					? { state: "state-reset", full_reset: true,
						public_transition: { reset: true } }
					: { state: "state-level-1", public_transition: {} };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});
	pi.on("session_start", () => {
		if (process.env.PI_ARC_CAPTURE_COMPACT_TOOLS === "enabled") {
			const registered = new Set(pi.getAllTools().map(tool => tool.name));
			pi.setActiveTools(["task_harness", "task_harness_create", "auto_research", "task_checkpoint", "arc_action"]
				.filter(name => registered.has(name)));
			return;
		}
		pi.setActiveTools([...new Set([...pi.getActiveTools(), "arc_action"])]);
	});
}
