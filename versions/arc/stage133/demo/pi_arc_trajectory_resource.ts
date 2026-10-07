/** Bounded, read-only projections over the canonical ARC bridge trajectory. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadArcTrajectorySnapshot, projectArcTrajectorySnapshot } from "./pi_arc_trajectory_snapshot.ts";

export const ARC_TRAJECTORY_TOOL = "inspect_arc_trajectory";

export function installArcTrajectoryResource(pi: ExtensionAPI, enabled: boolean): void {
	if (!enabled) return;
	const child = process.env.PI_TASK_CHILD === "1";
	pi.registerTool({
		name: ARC_TRAJECTORY_TOOL,
		label: "Inspect ARC trajectory",
		description:
			"Read a deterministic projection of prior ARC actions from bridge-events.jsonl. " +
			"It reports transitions, repeated action/outcome groups, or level boundaries with canonical " +
			"action IDs. It does not recommend an action, create a finding, or change execution." +
			(child ? " Child results default to 20 actions and allow at most 256; use the returned history_access.read task_resource call to page older actions from the fixed snapshot." : ""),
		parameters: Type.Object({
			projection: Type.Union([
				Type.Literal("transitions"),
				Type.Literal("repeated_actions"),
				Type.Literal("level_boundaries"),
			]),
			last_n: Type.Optional(Type.Integer(child ? { minimum: 1, maximum: 256 } : { minimum: 1 })),
		}),
		async execute(_toolCallId, params) {
			if (process.env.PI_TASK_CHILD === "1") {
				const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
				const ref = process.env.PI_TASK_CHILD_TRAJECTORY_REF;
				if (!root || !ref) throw new Error("parent-published ARC trajectory snapshot is not available");
				const value = projectArcTrajectorySnapshot(loadArcTrajectorySnapshot(root, ref), params.projection, params.last_n);
				return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
			}
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
