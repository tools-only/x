/**
 * Offline scripted provider for the thin ARC self-harness smoke
 * (src/autoresearch_pi/arc_thin_e2e.py run_arc_thin_smoke).
 *
 * One script step per agent request. Requests whose system prompt is the
 * ask_analyst prompt are answered with text and do not advance the script.
 * Every request is recorded in <ARC_RUN_ROOT>/smoke-requests.jsonl so the
 * runner can check what the model actually saw.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

type Step = { kind: "decide" | "consolidate"; calls?: Array<[string, Record<string, unknown>]>; text?: string };

const COUNT_COLOR = "def run(state, args):\n    g = state['grid']\n    return {'count': sum(r.count(args['color']) for r in g)}\n";

const SCRIPT: Step[] = [
	// Decision 1: exercise every authoring tool, then two actions in one message.
	{ kind: "decide", calls: [["memory", { op: "set", key: "controls.action1", text: "ACTION1 changes cell (0,0)", confidence: 2 }]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: "def run(state, args)\n    return 1\n" }]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: COUNT_COLOR }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color" }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color", args: { color: 0 } }]] },
	{ kind: "decide", calls: [["prompt", { op: "set", text: "SMOKE-OVERLAY: check memory controls.* before acting." }]] },
	{ kind: "decide", calls: [["ask_analyst", { question: "Which cells are non-zero?", include_memory: true }]] },
	{ kind: "decide", calls: [
		["arc_action", { action: "ACTION1", note: "probe ACTION1" }],
		["arc_action", { action: "ACTION2", note: "second action in one message must be blocked" }],
	] },
	// Decision 2.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "probe ACTION4" }]] },
	// Consolidation.
	{ kind: "consolidate", calls: [["memory", { op: "set", key: "plan", text: "test ACTION3 next", confidence: 2 }]] },
	{ kind: "consolidate", text: "Consolidated." },
	// Decision 3.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", note: "probe ACTION3" }]] },
];

const textOf = (message: any): string => typeof message?.content === "string"
	? message.content
	: (Array.isArray(message?.content) ? message.content : [])
		.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");

export default function arcThinSmokeProvider(pi: ExtensionAPI) {
	const log = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "smoke-requests.jsonl");
	let step = 0;
	let toolCall = 0;

	pi.registerProvider("offline-arc-thin-smoke", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: "http://unused.invalid",
		models: [{
			id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 175000, maxTokens: 16384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		streamSimple: scriptedProviderTransport((model, context, options) => {
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason: "stop", timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = "aborted";
				stream.push({ type: "error", reason: "aborted", error: output });
				stream.end();
				return stream;
			}
			const messages: any[] = context.messages ?? [];
			const analyst = String(context.systemPrompt ?? "").includes("careful visual analyst");
			const head = textOf(messages[0]);
			const consolidating = head.trimStart().startsWith("CONSOLIDATE:");
			let planned: Step | undefined;
			if (analyst) planned = { kind: "decide", text: "ANALYST: only cell (0,0) is non-zero; it counts actions." };
			else {
				planned = SCRIPT[step];
				if (planned && (planned.kind === "consolidate") === consolidating) step += 1;
				else planned = consolidating
					? { kind: "consolidate", text: "Script exhausted or out of order during consolidation." }
					: { kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "fallback after script" }]] };
			}
			appendFileSync(log, JSON.stringify({
				t: new Date().toISOString(), analyst, consolidating, step,
				message_count: messages.length, roles: messages.map((message) => message?.role),
				tools: (context.tools ?? []).map((tool: any) => tool.name),
				system_prompt: String(context.systemPrompt ?? ""), head,
				last_tool_results: messages.filter((message) => message?.role === "toolResult")
					.map((message) => ({ tool: message.toolName, is_error: message.isError, text: textOf(message).slice(0, 1200) })),
				planned,
			}) + "\n", "utf8");

			stream.push({ type: "start", partial: output });
			if (planned.calls?.length) {
				output.stopReason = "toolUse";
				for (const [name, args] of planned.calls) {
					const contentIndex = output.content.length;
					const block = { type: "toolCall" as const, id: `arc-thin-smoke-${++toolCall}`, name, arguments: args };
					output.content.push(block);
					stream.push({ type: "toolcall_start", contentIndex, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(args), partial: output });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
			} else {
				const text = planned.text ?? "";
				output.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
			}
			stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
			stream.end();
			return stream;
		}),
	});
}
