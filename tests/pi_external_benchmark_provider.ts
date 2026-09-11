import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function externalBenchmarkFixture(pi: ExtensionAPI) {
	let request = 0;
	let toolCall = 0;
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	pi.registerTool({
		name: "benchmark_probe",
		label: "Benchmark Probe",
		description: "Return one large deterministic benchmark observation.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "probe:" + "x".repeat(4096) }], details: { fixture: true } };
		},
	});
	const configuredSteps = process.env.PI_EXTERNAL_STEPS ? JSON.parse(process.env.PI_EXTERNAL_STEPS) : undefined;
	const steps = configuredSteps ?? (process.env.PI_AUTORESEARCH_VARIANT === "control" ? [] : [
		{ name: "benchmark_probe", arguments: {} },
		{ name: "research_resource", arguments: {
			action: "record", evidence: "The probe is large and its relevant conclusion is retained.",
			decision: "Compact the cited observation for later requests.",
			evidence_refs: ["execution-observation-1"], assessment_refs: [],
			expected_recurrence: "high", remaining_uses: 2,
		} },
		{ name: "compact_observation_context", arguments: {
			finding_id: "finding-1", target_version: 1,
			observation_ids: ["execution-observation-1"],
			expected_effect: "remove the cited historical tool result from later requests",
			reconsider_when: "the exact observation is needed",
		} },
		{ name: "research_resource", arguments: {
			action: "resolve", finding_id: "finding-1", target_version: 1,
			evidence: "The native context exposure removed the selected historical body.",
			decision: "Retain the task-local representation change.",
			evidence_refs: ["execution-observation-1"],
			assessment_refs: ["effect-assessment-1"], expected_recurrence: "low",
			remaining_uses: 0, resolution: "supported",
		} },
		{ name: "research_resource", arguments: {
			action: "inspect", observation_id: "execution-observation-1",
			evidence_refs: [], assessment_refs: [],
		} },
	]);
	pi.registerProvider("offline-external-test", {
		api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context) {
			appendFileSync(join(root, "provider-contexts.jsonl"), JSON.stringify({ request, context }) + "\n", "utf8");
			const step = steps[request++];
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider,
				model: model.id, content: [], stopReason: step ? "toolUse" : "stop", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "start", partial: output });
			if (step) {
				const block = { type: "toolCall" as const, id: `fixture-${++toolCall}`, name: step.name, arguments: step.arguments };
				output.content.push(block);
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: output });
			} else {
				output.content.push({ type: "text", text: "fixture complete" });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "fixture complete", partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: "fixture complete", partial: output });
			}
			stream.push({ type: "done", reason: step ? "toolUse" : "stop", message: output });
			stream.end();
			return stream;
		},
	});
}
