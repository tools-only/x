/**
 * Offline scripted provider for the thin ARC self-harness smoke
 * (src/autoresearch_pi/arc_thin_e2e.py run_arc_thin_smoke).
 *
 * One script step per agent request. Requests whose system prompt is the
 * ask_analyst prompt are answered with text and do not advance the script.
 * Every request, with its full tool schemas, is recorded in
 * <ARC_RUN_ROOT>/smoke-requests.jsonl so the runner can check what the model
 * actually saw.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

type Step = { kind: "decide" | "consolidate"; calls?: Array<[string, Record<string, unknown>]>; text?: string };

const COUNT_COLOR = "def run(state, args):\n    g = state['grid']\n    return {'count': sum(r.count(args['color']) for r in g)}\n";

const DEFAULT_SCRIPT: Step[] = [
	// Decision 1: exercise every authoring tool, then two actions in one message.
	{ kind: "decide", calls: [["memory", { op: "set", key: "controls.action1", text: "ACTION1 changes cell (0,0)", confidence: 2 }]] },
	// Batch without op; `set` arrives as a JSON string, as some models send it. Three rivals for one question.
	{ kind: "decide", calls: [["memory", {
		set: JSON.stringify([{ key: "state_1", text: "per-step note 1" }, { key: "state_2", text: "per-step note 2" }]),
		hypotheses: [
			{ key: "hyp.counter", question: "controls", claim: "cell (0,0) counts actions", predicts: "every action changes cell (0,0)", next_test: "ACTION4" },
			{ key: "hyp.mover", question: "controls", claim: "ACTION1 moves an object", predicts: "a shape changes position" },
			{ key: "hyp.paint", question: "controls", claim: "actions recolor a region" },
		],
	}]] },
	// Invalid as a whole: rejecting without a refutation; the valid set must not be applied either.
	{ kind: "decide", calls: [["memory", {
		set: [{ key: "atomic_probe", text: "must not be saved" }],
		hypotheses: [{ key: "counter", status: "rejected" }],
	}]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: "def run(state, args)\n    return 1\n" }]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: COUNT_COLOR }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color" }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color", args: { color: 0 } }]] },
	// A strategy names its premise and the components it uses; an unknown component is ignored, not refused.
	{ kind: "decide", calls: [["memory", { strategies: [{ key: "track", plan: "follow the moving object",
		depends_on: ["hyp.mover"], uses: ["skill:count_color", "prompt", "skill:nope"] }] }]] },
	// Never saved: rejected by the run_skill schema; the decision continues.
	{ kind: "decide", calls: [["run_skill", { name: "bottom_row" }]] },
	{ kind: "decide", calls: [["prompt", { op: "set", text: "SMOKE-OVERLAY: check memory controls.* before acting." }]] },
	{ kind: "decide", calls: [["ask_analyst", { question: "Which cells are non-zero?", include_memory: true }]] },
	{ kind: "decide", calls: [
		["arc_action", { action: "ACTION1", note: "probe ACTION1" }],
		["arc_action", { action: "ACTION2", note: "second action in one message must be blocked" }],
	] },
	// Decision 2: one test against the rivals it bears on; an untested rival is deleted (kept as a note).
	// Evidence arrives as a list, a shape the schema rejects; the boundary repair turns it into one entry per result.
	{ kind: "decide", calls: [["memory", { delete: ["hyp.paint"], tests: [{ action: 1, condition: "first action of the game",
		observed: "cell (0,0) changed; nothing moved", verdicts: { "hyp.counter": "supports" } }],
		hypotheses: [{ key: "hyp.counter", evidence: [{ action: 1, condition: "first action of the game", observed: "cell (0,0) changed", verdict: "supports" }] }] }]] },
	// A second skill widens the run_skill name enum; deleting it narrows it again. The save omits op (inferred as set).
	{ kind: "decide", calls: [["skill", { name: "scratch", description: "temporary", source: "def run(state, args):\n    return 0\n" }]] },
	{ kind: "decide", calls: [["skill", { op: "delete", name: "scratch" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "probe ACTION4" }]] },
	// Consolidation: one call records evidence, rejects rivals with their scope, cleans up per-step entries.
	// Rejecting hyp.mover suspends strat.track, which depends on it.
	{ kind: "consolidate", calls: [["memory", {
		set: [{ key: "plan", text: "test ACTION3 next", confidence: 2 }],
		delete: ["state_*"],
		hypotheses: [
			{ key: "hyp.counter", next_test: "ACTION3",
				evidence: { action: 2, condition: "after ACTION1", observed: "cell (0,0) changed again", verdict: "supports" } },
			{ key: "hyp.static", claim: "actions change nothing", status: "rejected",
				evidence: { action: 1, condition: "first action of the game", observed: "3 cells changed", verdict: "refutes" } },
			{ key: "hyp.mover", status: "rejected",
				evidence: { action: 2, condition: "after ACTION1", observed: "no shape moved", verdict: "refutes" } },
		],
	}]] },
	{ kind: "consolidate", text: "Consolidated." },
	// Decision 3: one message carries the updates and the action. A hypothesis sent through set with an
	// over-long text is routed and clipped; an invalid test fails without blocking the action.
	{ kind: "decide", calls: [
		["memory", { strategies: [{ key: "strat.probe", plan: "probe ACTION3 against hyp.counter", depends_on: ["counter"] }] }],
		["memory", { set: [{ key: "hyp.probe2", text: `ACTION3 ${"repeats ".repeat(80)}` }] }],
		["memory", { tests: [{ action: 2, condition: "c", observed: "o", verdicts: { "hyp.nope": "supports" } }] }],
		["arc_action", { action: "ACTION3", note: "probe ACTION3" }],
	] },
	// Decision 4: REVISIONS now shows what followed the suspension; the batched results are shown once.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION2", note: "probe ACTION2" }]] },
];

// Ledger + critic: in the mock game the 9 on row 3 moves right on ACTION1/4 and left on ACTION2/3.
const POSITION = "def run(state, args):\n    return state['grid'][3].index(9)\n";
const LEDGER_SCRIPT: Step[] = [
	{ kind: "decide", calls: [["skill", { op: "set", name: "pos", description: "x of the 9 on row 3", source: POSITION }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", idea: "move right", expect: "the 9 moves right by one" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", idea: "move right", expect: "x".repeat(400) }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", idea: "move right" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", idea: "move left", expect: "the 9 moves left" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION2", idea: "move left" }]] },
];
const CRITIC_REPLY = "- #2 and #3 moved the 9 right; move left was tried only once (#4).\n- #99 shows a pattern that does not exist.\nsuggest: ACTION2";
// Environment failure (MOCK_ARC_FAIL_AFTER=1): the second and later steps return no frame. Each failed
// decision must end at once; a retry inside the same decision would consume the next step.
const ENVIRONMENT_SCRIPT: Step[] = [
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "works" }]] },
	{ kind: "decide", calls: [["memory", { set: [{ key: "plan", text: "keep probing" }] }], ["arc_action", { action: "ACTION2", note: "environment fails" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", note: "environment fails again" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "must never be requested" }]] },
];
const SCRIPT = process.env.ARC_THIN_SMOKE_SCRIPT === "ledger" ? LEDGER_SCRIPT
	: process.env.ARC_THIN_SMOKE_SCRIPT === "environment" ? ENVIRONMENT_SCRIPT : DEFAULT_SCRIPT;

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
			const critic = String(context.systemPrompt ?? "").includes("You review an agent");
			const head = textOf(messages[0]);
			const consolidating = head.trimStart().startsWith("CONSOLIDATE:");
			let planned: Step | undefined;
			if (analyst) planned = { kind: "decide", text: "ANALYST: only cell (0,0) is non-zero; it counts actions." };
			else if (critic) planned = { kind: "decide", text: CRITIC_REPLY };
			else {
				planned = SCRIPT[step];
				if (planned && (planned.kind === "consolidate") === consolidating) step += 1;
				else planned = consolidating
					? { kind: "consolidate", text: "Script exhausted or out of order during consolidation." }
					: { kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "fallback after script" }]] };
			}
			appendFileSync(log, JSON.stringify({
				t: new Date().toISOString(), analyst, critic, consolidating, step,
				message_count: messages.length, roles: messages.map((message) => message?.role),
				tools: (context.tools ?? []).map((tool: any) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
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
