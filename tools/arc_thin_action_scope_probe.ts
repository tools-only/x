/** Scripted, unpaid provider for the action-scope regression. Never used by ordinary ARC runs. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

export default function scopeProbe(pi: ExtensionAPI) {
	let step = 0;
	const calls = [{ action: "ACTION5" }, { action: "ACTION6", x: 10, y: 10 }, { action: "ACTION1" },
		{ action: "ACTION6", x: 10, y: 10 }, { action: "RESET" }, { action: "ACTION3" }];
	pi.registerProvider("offline-arc-action-scope", {
		api: "openai-completions", apiKey: "diagnostic", baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"], contextWindow: 175000,
			maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple: scriptedProviderTransport((model, context) => {
			const parameters = calls[step++];
			appendFileSync(join(process.env.ARC_RUN_ROOT!, "scope-provider-requests.jsonl"), JSON.stringify({
				step, tools: context.tools ?? getCurrentTools(context.messages), messages: context.messages, parameters,
			}) + "\n");
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: parameters ? [{ type: "toolCall", id: `scope-${step}`, name: "arc_action", arguments: parameters }]
					: [{ type: "text", text: "No action is currently available." }],
				stopReason: parameters ? "toolUse" : "stop", timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "start", partial: output });
			if (parameters) {
				const call = output.content[0] as any;
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(parameters), partial: output });
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: output });
			}
			stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
			stream.end();
			return stream;
		}),
	});
}
