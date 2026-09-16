/** Non-ARC adapter fixture for the shared task-local Pi subagent lifecycle. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalSubagents } from "../demo/pi_task_local_subagents.ts";

export default function nonArcTaskSubagents(pi: ExtensionAPI) {
	installTaskLocalSubagents(pi, true, {
		adapterId: "fixture",
		childExtension: join(dirname(fileURLToPath(import.meta.url)), "pi_readonly_fixture_subagent.ts"),
		allowedTools: ["fixture_state"],
		defaultTools: ["fixture_state"],
		permission: "read_only_fixture",
		autoResearch: true,
		autoResearchLabel: "Auto-Research in clean fixture context",
		taskToolAllowedImplementations: ["fixture.echo"],
	});
}
