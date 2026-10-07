import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installReportedTokenBudget } from "../demo/pi_reported_token_budget.ts";
import { installProviderTelemetry } from "../demo/pi_provider_telemetry.ts";

/** Local HTTP fixture: Pi's native adapter owns usage defaults and cancellation. */
export default function reportedTokenBudgetHttpFixture(pi: ExtensionAPI) {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
    installProviderTelemetry(pi, { root, scope: process.env.PI_TASK_CHILD === "1" ? "child" : "parent" });
	pi.registerProvider("reported-budget-http-test", {
		api: "openai-completions", apiKey: "offline",
		baseUrl: process.env.PI_REPORTED_BUDGET_HTTP_BASE_URL!,
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") appendFileSync(join(root, "native-provider-messages.jsonl"),
			JSON.stringify(event.message) + "\n", "utf8");
	});
	pi.on("message_update", (event, ctx) => {
		if (process.env.PI_REPORTED_BUDGET_CANCEL_ON_TEXT === "1"
			&& event.assistantMessageEvent.type === "text_delta") ctx.abort();
	});
	installReportedTokenBudget(pi, root);
}
