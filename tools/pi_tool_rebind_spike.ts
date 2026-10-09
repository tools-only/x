/**
 * Pi spike for docs/plans/2026-10-09-thin-skill-call-binding.md (no paid model).
 *
 * One Pi print-mode run with a scripted provider. It checks on the installed Pi:
 * (a) re-registering a tool with the same name and a new parameter schema
 *     mid-run changes the schema in the next provider request;
 * (b) pi.setActiveTools inside a tool's execute applies to the next turn;
 * (c) for reschema + probe in one message, which schema validates the probe call;
 * (d) the validation error text for a value outside the enum;
 * (e) whether a tool registered mid-run under a new name is active next turn.
 * Every request's full context.tools is appended to $SPIKE_LOG.
 *
 *   node <pi>/dist/cli.js -p go --provider spike --model scripted --no-session --no-extensions
 *     --no-skills --no-prompt-templates --no-context-files --no-builtin-tools
 *     --extension tools/pi_tool_rebind_spike.ts
 */
import { appendFileSync } from "node:fs";
import { StringEnum, createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

const SCRIPT: Array<Array<[string, Record<string, unknown>]>> = [
	[["reschema", { values: ["a", "b"] }]],
	[["deactivate", {}]],
	[["reschema", { values: ["a", "b", "c"] }], ["probe", { name: "c" }]],
	[["probe", { name: "zzz" }]],
	[["register_new", {}]],
	[["fresh_v1", {}]],
];

export default function spike(pi: ExtensionAPI) {
	const log = process.env.SPIKE_LOG ?? "spike-requests.jsonl";
	const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
	const registerProbe = (values: string[]) => pi.registerTool({
		name: "probe", label: "probe", description: `probe with names ${values.join(",")}`,
		parameters: Type.Object({ name: StringEnum(values as [string, ...string[]]) }),
		execute: async (_id: string, params: { name: string }) => text(`probe ok name=${params.name}`),
	});
	registerProbe(["a"]);
	pi.registerTool({
		name: "reschema", label: "reschema", description: "re-register probe with new names",
		parameters: Type.Object({ values: Type.Array(Type.String()) }),
		execute: async (_id: string, params: { values: string[] }) => { registerProbe(params.values); return text(`probe now ${params.values}`); },
	});
	pi.registerTool({
		name: "extra", label: "extra", description: "to be deactivated", parameters: Type.Object({}),
		execute: async () => text("extra"),
	});
	pi.registerTool({
		name: "deactivate", label: "deactivate", description: "setActiveTools without extra", parameters: Type.Object({}),
		execute: async () => { pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "extra")); return text("deactivated extra"); },
	});
	pi.registerTool({
		name: "register_new", label: "register_new", description: "register fresh_v1", parameters: Type.Object({}),
		execute: async () => {
			pi.registerTool({ name: "fresh_v1", label: "fresh", description: "fresh tool", parameters: Type.Object({}),
				execute: async () => text("fresh ok") });
			return text("registered fresh_v1");
		},
	});

	let step = 0;
	let id = 0;
	pi.registerProvider("spike", {
		api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple: scriptedProviderTransport((model, context) => {
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "stop",
				timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			const calls = SCRIPT[step];
			const messages: any[] = context.messages ?? [];
			appendFileSync(log, JSON.stringify({
				step,
				tools: (context.tools ?? []).map((tool: any) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
				results: messages.filter((message) => message?.role === "toolResult").slice(-2).map((message) => ({
					tool: message.toolName, is_error: message.isError,
					text: (message.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n"),
				})),
				calls: calls ?? null,
			}) + "\n", "utf8");
			step += 1;
			stream.push({ type: "start", partial: output });
			if (calls) {
				output.stopReason = "toolUse";
				for (const [name, args] of calls) {
					const contentIndex = output.content.length;
					const block = { type: "toolCall" as const, id: `spike-${++id}`, name, arguments: args };
					output.content.push(block);
					stream.push({ type: "toolcall_start", contentIndex, partial: output });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
			} else {
				output.content.push({ type: "text", text: "done" });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: "done", partial: output });
			}
			stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
			stream.end();
			return stream;
		}),
	});
}
