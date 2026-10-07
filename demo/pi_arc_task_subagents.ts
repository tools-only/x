/** Thin ARC adapter for the shared task-local Pi subagent lifecycle. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalSubagents } from "./pi_task_local_subagents.ts";
import { canonicalArcPublicState } from "./pi_arc_observation_snapshot.ts";
import { resolveTaskResource } from "./pi_task_resource_store.ts";

export function installArcTaskSubagents(
	pi: ExtensionAPI,
	enabled: boolean,
	resolveBasisRefs?: (references: string[]) => string[],
	publishStateSnapshot?: () => Promise<Record<string, unknown>>,
	publishTrajectorySnapshot?: () => Promise<{ ref: string }>,
): void {
	installTaskLocalSubagents(pi, enabled, {
		adapterId: "arc_agi_3",
		childExtension: join(dirname(fileURLToPath(import.meta.url)), "pi_arc_readonly_subagent_extension.ts"),
		// `task_resource` is a read-only control-plane tool installed by the
		// child validation extension.  It does not grant arbitrary files or live
		// ARC access: the parent passes exact resource refs for the invocation.
		// Keeping it out of the adapter allow-list made a perfectly valid saved
		// auditor impossible to create (and forced the parent to paste large
		// frames or abandon delegation).
		allowedTools: ["arc_state", "inspect_arc_trajectory", "task_resource", "arc_action"],
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
		async publishSelectedStateSnapshot(ref) {
			if (!/^observation_snapshot:[^@]+@v[1-9]\d*$/.test(ref))
				throw new Error("selected ARC scene must be one exact observation_snapshot ref");
			const record = resolveTaskResource(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".", ref);
			if (record.format !== "task-observation-snapshot-v1" || !record.public_state
				|| typeof record.public_state !== "object" || Array.isArray(record.public_state))
				throw new Error("selected ARC snapshot has no canonical public state");
			return canonicalArcPublicState(record.public_state);
		},
		stateSnapshotTools: ["arc_state"],
		publishTrajectorySnapshot,
		trajectorySnapshotTools: ["inspect_arc_trajectory"],
	}, resolveBasisRefs);
}
