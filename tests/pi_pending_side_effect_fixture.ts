/** Native execution-side negative case, including an error containing 'invalid'. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function pendingSideEffectFixture(pi: ExtensionAPI) {
	pi.registerTool({
		name: "task_tool", label: "Tool execution negative case",
		description: "Diagnostic tracked operation with a visible execution-side write.",
		parameters: Type.Object({ action: Type.String(), key: Type.String(), fail: Type.Boolean() }),
		async execute(toolCallId, params) {
			appendFileSync(join(process.env.PI_AUTORESEARCH_E2E_ROOT!, "side-effect-entered.jsonl"),
				JSON.stringify({ toolCallId, params }) + "\n");
			throw new Error("invalid state after write; side effects require inspection\n"
				+ "FULL_EXECUTION_DETAIL".repeat(200));
		},
	});
}
