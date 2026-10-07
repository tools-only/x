/** Deterministic provider only; runner, native Pi and ARC tools stay real. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function arcRequestAdmissionFixture(pi: ExtensionAPI) {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	let request = 0;
	pi.on("tool_execution_end", event => {
		if (event.toolName === "arc_action") appendFileSync(join(root, "admission-action-receipts.jsonl"),
			JSON.stringify({ toolName: event.toolName, isError: event.isError, result: event.result }) + "\n");
	});
	pi.registerProvider("arc-admission-test", { api: "openai-completions", apiKey: "offline",
		baseUrl: "http://unused.invalid", models: [{ id: "scripted", name: "scripted", reasoning: false,
			input: ["text"], contextWindow: 175000, maxTokens: 100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			request++;
			appendFileSync(join(root, "admission-provider-requests.jsonl"), JSON.stringify({ request,
				abortedAtEntry: Boolean(options?.signal?.aborted), context }) + "\n");
			const lastUser = [...context.messages].reverse().find(message => message.role === "user");
			const review = JSON.stringify(lastUser).includes("ARC_TERMINAL_LEVEL_REVIEW");
			const length = request === 1 && process.env.PI_ARC_ADMISSION_FIRST_LENGTH === "1";
			const output: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider,
				model: model.id, timestamp: Date.now(), stopReason: length ? "length" : review ? "stop" : "toolUse",
				content: review || length ? [{ type: "text", text: "Controlled response complete." }]
					: [{ type: "toolCall", id: `admission-${request}`, name: "arc_action",
						arguments: { action: "ACTION1", reasoning: "Observe the controlled public transition." } }],
				usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "start", partial: output });
			stream.push({ type: "done", reason: output.stopReason as "toolUse" | "stop" | "length", message: output });
			stream.end();
			return stream;
		} });
}
