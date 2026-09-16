/** Thin ARC adapter for the shared task-local Pi subagent lifecycle. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalSubagents } from "./pi_task_local_subagents.ts";

export function installArcTaskSubagents(
	pi: ExtensionAPI,
	enabled: boolean,
	resolveBasisRefs?: (references: string[]) => string[],
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
	}, resolveBasisRefs);
}
