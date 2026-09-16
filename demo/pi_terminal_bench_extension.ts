/** Terminal-Bench uses Pi's native terminal tools plus shared task-local research. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import externalBenchmarkResearch from "./pi_external_benchmark_research.ts";
import { loadPrompt } from "./prompt_loader.ts";

export default function terminalBenchExtension(pi: ExtensionAPI) {
	externalBenchmarkResearch(pi);
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${loadPrompt("terminal_bench.md")}`,
	}));
}
