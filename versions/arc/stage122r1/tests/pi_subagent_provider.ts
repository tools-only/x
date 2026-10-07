import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function subagentFixtureProvider(pi: ExtensionAPI) {
	let request = 0;
	let toolCall = 0;
	let configuredSteps: Array<{ name: string; arguments: Record<string, unknown> }> = [];
	try { configuredSteps = JSON.parse(process.env.PI_SUBAGENT_STEPS ?? "[]"); } catch {}
	const configuredReport = process.env.PI_SUBAGENT_REPORT;
	const thinkingChars = Math.max(0, Number(process.env.PI_SUBAGENT_THINKING_CHARS ?? "0") || 0);
	const forceLength = process.env.PI_SUBAGENT_FORCE_LENGTH === "1";
	const forceLengthOnce = process.env.PI_SUBAGENT_FORCE_LENGTH_ONCE === "1";
	const forceLengthCount = Math.max(0, Number(process.env.PI_SUBAGENT_FORCE_LENGTH_COUNT ?? "0") || 0);
	const forceErrorAfterTool = process.env.PI_SUBAGENT_FORCE_ERROR_AFTER_TOOL === "1";
	const forceInvalidReportOnce = process.env.PI_SUBAGENT_FORCE_INVALID_REPORT_ONCE === "1";
	pi.on("before_agent_start", (event) => {
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
		const skills = ((event.systemPromptOptions as any)?.skills ?? []) as Array<Record<string, unknown>>;
		appendFileSync(join(root, "subagent-native-skills.jsonl"), JSON.stringify({
			names: skills.map((skill) => String(skill.name ?? "")),
			count: skills.length,
		}) + "\n", "utf8");
	});
	pi.registerProvider("offline-subagent-test", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: "http://unused.invalid",
		models: [{
			id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		streamSimple(model, context) {
			const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
			const lengthOnceMarker = join(root, "subagent-force-length-once.marker");
			const lengthCountMarker = join(root, "subagent-force-length-count.marker");
			let emittedLengthCount = 0;
			if (existsSync(lengthCountMarker)) emittedLengthCount = Number(readFileSync(lengthCountMarker, "utf8")) || 0;
			const lengthThisProcess = forceLength || (forceLengthOnce && !existsSync(lengthOnceMarker))
				|| emittedLengthCount < forceLengthCount;
			if (forceLengthOnce && lengthThisProcess) writeFileSync(lengthOnceMarker, "length emitted\n", "utf8");
			if (forceLengthCount && lengthThisProcess) writeFileSync(lengthCountMarker, String(emittedLengthCount + 1), "utf8");
			appendFileSync(join(root, "subagent-provider-contexts.jsonl"), JSON.stringify({ context }) + "\n", "utf8");
			const stream = createAssistantMessageEventStream();
			const errorThisRequest = forceErrorAfterTool && request > 0;
			let step = lengthThisProcess || errorThisRequest ? undefined : configuredSteps[request++];
			if (process.env.PI_SUBAGENT_TRAJECTORY_READ_FROM_RESULT === "1" && !lengthThisProcess && !errorThisRequest) {
				const currentStep = request - 1;
				if (currentStep === 0) step = { name: "inspect_arc_trajectory",
					arguments: { projection: "transitions", last_n: 1 } };
				if (currentStep === 1) {
					const messages = Array.isArray(context.messages) ? context.messages : [];
					const texts = messages.flatMap((message: any) =>
						Array.isArray(message.content) ? message.content.map((block: any) => String(block.text ?? "")) : []);
					let read: Record<string, unknown> | undefined;
					for (const item of texts.reverse()) {
						try {
							const parsed = JSON.parse(item);
							if (parsed?.history_access?.read) { read = parsed.history_access.read; break; }
						} catch {}
					}
					if (!read || read.tool !== "task_resource") throw new Error("child trajectory tool did not return a paged history read call");
					step = { name: "task_resource", arguments: { action: "read", ref: read.ref,
						offset: read.offset, limit: read.limit } };
				}
			}
			if (forceInvalidReportOnce && request === 1) {
				step = { name: "submit_research_report", arguments: { report: {
					format: "auto-research-report-v1", status: "provisional",
					conclusion: "Preserve this conclusion while repairing its delivery category.",
					findings: [], evidence_refs: [], alternatives: [], limitations: [],
					validation_plan: "Submit the corrected report.",
					method_candidates: [{ candidate_ref: "invalid-method", name: "invalid",
						semantic_kind: "computation", summary: "invalid", basis_refs: [], method: {
							problem: "invalid fixture method", inputs: ["input"], invariants: [], parameters: [],
							steps: [{ invalid: true }], decision_points: [], stop_conditions: ["stop"], failure_modes: [],
							construction_evidence_refs: [], contrast_evidence_refs: [], next_use: "later",
							predicted_semantic_result: "result", falsifier: "counterexample",
						} }],
				} } };
			}
			if (process.env.PI_SUBAGENT_REPEAT_READ_UNTIL_REPORT_PHASE === "1") {
				const activeTools = new Set((context.tools ?? []).map((tool: any) => String(tool.name)));
				step = activeTools.has("submit_research_report") && !activeTools.has("task_resource")
					? { name: "submit_research_report", arguments: { report: JSON.parse(configuredReport ?? "{}") } }
					: { name: "task_resource", arguments: { action: "read", ref: "memory:chosen@v1", limit: 8000 } };
			}
			const finalReason = errorThisRequest ? "error" : lengthThisProcess ? "length" : step ? "toolUse" : "stop";
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason: finalReason, timestamp: Date.now(),
				usage: {
					input: 11, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 16,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				...(errorThisRequest ? { errorMessage: "fixture provider failure after checkpoint" } : {}),
			};
			stream.push({ type: "start", partial: output });
			if (step) {
				if (thinkingChars) {
					output.content.push({
						type: "thinking",
						thinking: "child-completed-tool-reasoning:" + "x".repeat(thinkingChars),
					} as any);
				}
				const block = { type: "toolCall" as const, id: `subagent-fixture-${++toolCall}`, name: step.name, arguments: step.arguments };
				output.content.push(block);
				const toolCallIndex = output.content.length - 1;
				stream.push({ type: "toolcall_start", contentIndex: toolCallIndex, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex: toolCallIndex, delta: JSON.stringify(step.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex: toolCallIndex, toolCall: block, partial: output });
			} else if (!errorThisRequest) {
				let text = lengthThisProcess
					? "Partial research reasoning preserved for deterministic runtime continuation."
					: configuredReport ?? "Independent read-only analysis complete.";
				if (!lengthThisProcess && process.env.PI_SUBAGENT_SCENE_FROM_CONTEXT === "1") {
					const messages = context.messages as any[];
					const blocks = messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
					const scene = blocks.filter(block => block.type === "text").map(block => String(block.text))
						.find(value => value.includes("PARENT-SELECTED ARC OBSERVATION")) ?? "";
					const match = scene.match(/Grid current_state_frame \((\d+)x(\d+)\)[^\n]*\n([0-9a-f]+(?:\n[0-9a-f]+)*)/);
					const rows = match?.[3].split("\n") ?? [];
					text = JSON.stringify({ rows: rows.length, columns: rows[0]?.length ?? 0,
						first_cell: rows.length ? parseInt(rows[0][0], 16) : null,
						image_count: blocks.filter(block => block.type === "image").length,
						tools: (context.tools ?? []).map(tool => tool.name) });
				}
				output.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
			}
			stream.push({ type: "done", reason: finalReason, message: output });
			stream.end();
			return stream;
		},
	});
}
