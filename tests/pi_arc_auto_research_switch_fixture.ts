import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installArcTaskSubagents } from "../demo/pi_arc_task_subagents.ts";

export default function arcResearchSwitchFixture(pi: ExtensionAPI) {
	installArcTaskSubagents(pi, true);
}
