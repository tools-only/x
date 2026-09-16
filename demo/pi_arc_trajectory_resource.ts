/** Bounded, read-only projections over the canonical ARC bridge trajectory. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const ARC_TRAJECTORY_TOOL = "inspect_arc_trajectory";

export function installArcTrajectoryResource(pi: ExtensionAPI, enabled: boolean): void {
	if (!enabled) return;
	pi.registerTool({
		name: ARC_TRAJECTORY_TOOL,
		label: "Inspect ARC trajectory",
		description:
			"Read a deterministic projection of prior ARC actions from bridge-events.jsonl. " +
			"It reports transitions, repeated action/outcome groups, or level boundaries with canonical " +
			"action IDs. It does not recommend an action, create a finding, or change execution.",
		parameters: Type.Object({
			projection: Type.Union([
				Type.Literal("transitions"),
				Type.Literal("repeated_actions"),
				Type.Literal("level_boundaries"),
			]),
			last_n: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_toolCallId, params) {
			const base = process.env.PI_ARC_BRIDGE_URL;
			if (!base) throw new Error("PI_ARC_BRIDGE_URL is not configured");
			const query = new URLSearchParams({
				projection: params.projection,
				...(params.last_n === undefined ? {} : { last_n: String(params.last_n) }),
			});
			const response = await fetch(`${base}/trajectory?${query.toString()}`);
			const value = await response.json() as Record<string, unknown>;
			if (!response.ok) throw new Error(String(value.error ?? `ARC bridge HTTP ${response.status}`));
			return {
				content: [{ type: "text", text: JSON.stringify(value) }],
				details: value,
			};
		},
	});
}
