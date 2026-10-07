import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Deterministic provider fixture for the restricted-expression native smoke.
 * It intentionally discloses no diagnostic fixture, oracle, or authored
 * program: the only model action is reading the existing tool creator.
 */
export default function restrictedExpressionDiagnosticProvider(pi: ExtensionAPI): void {
	let request = 0;
	let toolCall = 0;
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".";
	const contextPath = join(root, "restricted-expression-provider-contexts.jsonl");
	pi.registerProvider("restricted-expression-diagnostic-test", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: "http://unused.invalid",
		models: [{
			id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		streamSimple(model, context) {
			appendFileSync(contextPath, JSON.stringify({ request, context }) + "\n", "utf8");
			const stream = createAssistantMessageEventStream();
			const step = request++ === 0 ? {
				name: "task_harness",
				arguments: { action: "read_method", method_name: "tool-creator" },
			} : undefined;
			const stopReason = step ? "toolUse" : "stop";
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider,
				model: model.id, content: [], stopReason, timestamp: Date.now(),
				usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			stream.push({ type: "start", partial: output });
			if (step) {
				const block = { type: "toolCall" as const, id: `restricted-expression-${++toolCall}`,
					name: step.name, arguments: step.arguments };
				output.content.push(block);
				const index = output.content.length - 1;
				stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex: index,
					delta: JSON.stringify(step.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
			} else {
				const text = "creator discovery complete";
				output.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
			}
			stream.push({ type: "done", reason: stopReason, message: output });
			stream.end();
			return stream;
		},
	});
}
