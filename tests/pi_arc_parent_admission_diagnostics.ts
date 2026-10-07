/** Native adapter diagnostic only; no synthetic streamSimple output. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installReportedTokenBudget } from "../demo/pi_reported_token_budget.ts";

export default function parentAdmissionDiagnostics(pi: ExtensionAPI) {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	pi.registerProvider("parent-admission-native", { api: "openai-completions", apiKey: "local",
		baseUrl: process.env.PI_ADMISSION_HTTP_BASE_URL!, models: [{ id: "scripted", name: "scripted",
			reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 64,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
	pi.registerTool({ name: "native_admission_probe", label: "Public semantic probe", description: "Return 42.",
		parameters: Type.Object({}), async execute() {
			return { content: [{ type: "text", text: "42" }], details: { value: 42 } };
		} });
	pi.on("tool_execution_end", event => {
		appendFileSync(join(root, "diagnostic-tool-receipts.jsonl"), JSON.stringify(event) + "\n");
		if (process.env.PI_ADMISSION_APPEND_INVALID_LEDGER) appendFileSync(join(root, "provider-token-budget.jsonl"),
			process.env.PI_ADMISSION_APPEND_INVALID_LEDGER + "\n");
	});
	installReportedTokenBudget(pi, root);
}
