import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function taskScopeTransitionFixture(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	pi.registerTool({
		name: "fixture_level_transition",
		label: "Fixture level transition",
		description: "Record a successful public level transition for scope-invocation regression testing.",
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute() {
			appendFileSync(join(root, "execution-observations.jsonl"), JSON.stringify({
				observation_id: "execution-observation-level-transition",
				tool_name: "arc_action",
				input: { action: "ACTION1" },
				arc_outcome: { public_transition: { level_changed: true, level_before: 0, level_after: 1 } },
			}) + "\n", "utf8");
			return { content: [{ type: "text", text: "Recorded successful transition from level 0 to 1." }] };
		},
	});
}
