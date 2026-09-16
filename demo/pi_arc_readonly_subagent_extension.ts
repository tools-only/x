/** Read-only ARC capability surface for a task-local Pi subagent. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ARC_SYSTEM_PROMPT, renderArcFrame, renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { installArcTrajectoryResource } from "./pi_arc_trajectory_resource.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { renderPrompt } from "./prompt_loader.ts";

async function bridgeState() {
	const base = process.env.PI_ARC_BRIDGE_URL;
	if (!base) throw new Error("PI_ARC_BRIDGE_URL is not configured");
	const response = await fetch(`${base}/state`);
	const value = await response.json() as Record<string, unknown>;
	if (!response.ok) throw new Error(String(value.error ?? `ARC bridge HTTP ${response.status}`));
	return value;
}

export default function arcReadonlySubagent(pi: ExtensionAPI) {
	installProviderTelemetry(pi, {
		fileName: "subagent-provider-telemetry.jsonl",
		contextTokenFileName: "subagent-context-token-debug.jsonl",
		scope: "arc-readonly-subagent",
	});
	const usesSharedLifecycle = process.env.PI_TASK_SUBAGENT_TOOLS !== undefined;
	let configured: unknown = ["arc_state", "inspect_arc_trajectory"];
	try {
		configured = JSON.parse(
			process.env.PI_TASK_SUBAGENT_TOOLS ?? process.env.PI_ARC_SUBAGENT_TOOLS ?? "[]",
		);
	} catch {}
	const allowed = new Set(Array.isArray(configured) ? configured.map(String) : []);
	if (allowed.has("arc_state")) {
		pi.registerTool({
			name: "arc_state",
			label: "ARC state (read only)",
			description: "Read the current native ARC frame without submitting an environment action.",
			parameters: Type.Object({ request: Type.String() }),
			async execute() {
				const value = await bridgeState();
				if (!usesSharedLifecycle) {
					return { content: [{ type: "text", text: renderArcFrame(value) }], details: value };
				}
				const frameCount = Array.isArray(value.frames) ? value.frames.length : 0;
				return {
					content: [{ type: "text", text: renderArcLatestFrameRuns(value) }],
					details: {
						state: value.state,
						levels_completed: value.levels_completed,
						frame_count: frameCount,
						current_frame_index: frameCount ? frameCount - 1 : null,
						representation: "lossless_current_frame_coordinate_runs",
					},
				};
			},
		});
	}
	installArcTrajectoryResource(pi, allowed.has("inspect_arc_trajectory"));
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${ARC_SYSTEM_PROMPT}\n\n${event.systemPrompt}\n\n` + renderPrompt("arc_readonly_subagent.md", {
			frame_context: usesSharedLifecycle
				? "The last rendered frame is current; earlier rendered frames are animation context. arc_state returns a lossless coordinate-run view of only that current frame. "
				: "",
			allowed_tools: JSON.stringify([...allowed]),
		}),
	}));
}
