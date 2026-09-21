/** Thin ARC adapter for the shared task-local Pi subagent lifecycle. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalSubagents } from "./pi_task_local_subagents.ts";

export function installArcTaskSubagents(
	pi: ExtensionAPI,
	enabled: boolean,
	resolveBasisRefs?: (references: string[]) => string[],
	publishStateSnapshot?: () => Promise<Record<string, unknown>>,
): void {
	installTaskLocalSubagents(pi, enabled, {
		adapterId: "arc_agi_3",
		childExtension: join(dirname(fileURLToPath(import.meta.url)), "pi_arc_readonly_subagent_extension.ts"),
		allowedTools: ["arc_state", "inspect_arc_trajectory"],
		defaultTools: ["arc_state", "inspect_arc_trajectory"],
		permission: "read_only_arc",
		definitionLabel: "Task-local ARC subagent definition",
		delegationLabel: "Delegate read-only ARC analysis",
		autoResearch: true,
		autoResearchLabel: "Auto-Research in clean ARC context",
		taskToolAllowedImplementations: [
			"arc.public_state", "arc.action_sequence", "arc_state", "arc_action_sequence",
		],
		taskToolImplementationOutputSchemas: {
			"arc.public_state": { type: "object", properties: {
				game_id: { type: "string" }, state: { type: "string" }, levels_completed: { type: "number" },
				win_levels: { type: "number" }, available_actions: { type: "array", items: { type: "string" } },
				agent_available_actions: { type: "array", items: { type: "string" } },
				action_budget: { type: "object" }, guid: { type: "string" }, full_reset: { type: "boolean" },
			} },
			arc_state: { type: "object", properties: {
				game_id: { type: "string" }, state: { type: "string" }, levels_completed: { type: "number" },
				win_levels: { type: "number" }, available_actions: { type: "array", items: { type: "string" } },
				agent_available_actions: { type: "array", items: { type: "string" } },
				action_budget: { type: "object" }, guid: { type: "string" }, full_reset: { type: "boolean" },
			} },
			"arc.action_sequence": { type: "object", properties: {
				actions: { type: "array", items: { type: "string" } }, requested_actions: { type: "array", items: { type: "string" } },
				status: { type: "string" }, boundary: { type: "string" },
			} },
			arc_action_sequence: { type: "object", properties: {
				actions: { type: "array", items: { type: "string" } }, requested_actions: { type: "array", items: { type: "string" } },
				status: { type: "string" }, boundary: { type: "string" },
			} },
		},
		publishStateSnapshot,
		stateSnapshotTools: ["arc_state"],
	}, resolveBasisRefs);
}
