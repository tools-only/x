import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";
import { readWorkset } from "../demo/pi_read_workset.ts";

/** Qwen field-routing shape; synthetic content contains no game solution. */
export default async function latestReasoningNativeFixture(pi: ExtensionAPI) {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	// The red run can use an immutable earlier source without swapping live code.
	const sourceRoot = process.env.PI_LATEST_REASONING_FIXTURE_RUNTIME_ROOT;
	const lifecycle = sourceRoot ? (await import(pathToFileURL(join(sourceRoot,
		"demo/pi_task_local_context_lifecycle.ts")).href)).installTaskLocalContextLifecycle : installTaskLocalContextLifecycle;
	const getWorkset = sourceRoot ? (await import(pathToFileURL(join(sourceRoot,
		"demo/pi_read_workset.ts")).href)).readWorkset : readWorkset;
	const thinking = "SYNTHETIC_REASONING_HEAD\n" + "local-public-evidence-analysis;".repeat(190) + "\nSYNTHETIC_REASONING_TAIL";
	const publicText = "Decision: inspect the public probe. Counterevidence: its prediction is provisional. Next step: compare the semantic receipt.";
	const argumentsValue = { operation: "first", decision: {
		subgoal: "Compare a public semantic receipt", hypothesis: "The local probe returns the specified value",
		prediction: "The value will equal 42", falsifier: "The semantic receipt has another value",
		next_step: "Compare the returned value before deciding again",
		counterevidence: ["The prediction remains provisional until the tool completes"],
	} };
	const semanticText = JSON.stringify({ operation: "first", value: 42, evidence: "deterministic public fixture" });
	writeFileSync(join(root, "fixture-material.json"), JSON.stringify({ thinking, publicText, argumentsValue, semanticText }) + "\n");
	lifecycle(pi, { root, maxChars: 400_000, maxMessageChars: 400_000,
		reasoningHistoryPolicy: process.env.PI_PROVIDER_REASONING_HISTORY_POLICY as any,
		editableReasoningProviders: ["yibu"] });
	pi.registerTool({ name: "latest_reasoning_probe", label: "Public semantic probe",
		description: "Return a deterministic public semantic value.",
		parameters: Type.Object({ operation: Type.String(), decision: Type.Any() }),
		async execute(_id, params) {
			return { content: [{ type: "text", text: params.operation === "first" ? semanticText : "semantic follow-up: 43" }],
				details: { value: params.operation === "first" ? 42 : 43 } };
		} });
	pi.on("message_end", event => {
		appendFileSync(join(root, "native-messages.jsonl"), JSON.stringify(event.message) + "\n");
	});
	let request = 0;
	pi.registerProvider("yibu", { api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
		models: [{ id: "qwen3.8-27b", name: "qwen3.8-27b", reasoning: true, input: ["text"],
			contextWindow: 175000, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			if (options?.signal?.aborted) throw new Error("Unexpected cancellation in reasoning projection fixture");
			request++;
			appendFileSync(join(root, "provider-contexts.jsonl"), JSON.stringify({ request, context,
				read_workset: getWorkset(pi, root).payload(context, `local-provider-${request}`) }) + "\n");
			const messagesText = JSON.stringify(context.messages);
			const ref = /context:msg-[a-f0-9]{64}@v1/.exec(messagesText)?.[0];
			const call = request === 1
				? { type: "toolCall" as const, id: "public-call-1", name: "latest_reasoning_probe", arguments: argumentsValue }
				: request === 2 && ref
					? { type: "toolCall" as const, id: "public-call-2", name: "task_resource",
						arguments: { action: "read", ref, offset: 0, limit: 8000 } }
					: request === 3
						? { type: "toolCall" as const, id: "public-call-3", name: "latest_reasoning_probe",
							arguments: { ...argumentsValue, operation: "after-recovery" } } : undefined;
			const content: any[] = request === 1 ? [
				{ type: "thinking", thinking, thinkingSignature: "reasoning_content" }, { type: "text", text: publicText },
			] : [{ type: "text", text: call ? "Consume the exact public evidence once." : "Local fixture complete." }];
			if (call) content.push(call);
			const output: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider,
				model: model.id, content, stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "start", partial: output });
			stream.push({ type: "done", reason: output.stopReason as "toolUse" | "stop", message: output });
			stream.end();
			return stream;
		} });
}
