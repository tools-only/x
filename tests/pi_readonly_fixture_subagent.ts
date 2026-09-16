/** Minimal non-ARC public-state tool for task-local subagent tests. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function readonlyFixtureSubagent(pi: ExtensionAPI) {
	let configured: unknown = [];
	try { configured = JSON.parse(process.env.PI_TASK_SUBAGENT_TOOLS ?? "[]"); } catch {}
	const allowed = new Set(Array.isArray(configured) ? configured.map(String) : []);
	if (allowed.has("fixture_state")) {
		pi.registerTool({
			name: "fixture_state",
			label: "Fixture state",
			description: "Read the fixture's public state without changing it.",
			parameters: Type.Object({ request: Type.Optional(Type.String()) }),
			async execute() {
				return { content: [{ type: "text", text: "fixture-state:ready" }], details: { ready: true } };
			},
		});
	}
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nYou are a read-only fixture subagent.`,
	}));
}
