/** Deterministic model boundary for the real ARC self-harness smoke runner.
 *
 * Only the provider is mocked.  The official ARC bridge, Pi parent, broker,
 * Pi children, structured report parser, code router, native harness tools,
 * action boundaries, and next-turn context projection are production paths.
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Step =
	| { kind: "tool"; name: string; arguments: Record<string, unknown> }
	| { kind: "text"; text: string }
	| { kind: "length"; text: string };

const scenario = String(process.env.PI_ARC_SMOKE_SCENARIO ?? "memory");
const root = String(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
const evidenceRef = "execution-observation-1";

function deliveryFor(name: string): Record<string, unknown> {
	const common = {
		format: "auto-research-harness-delivery-v1",
		delivery_id: `smoke-${name.replaceAll("_", "-")}`,
		operation: "create",
		scope: { kind: "task_wide", statement: "this deterministic ARC smoke task" },
		trigger: "the routed component is exercised on the next real parent turn",
		exclusions: ["outside this ARC smoke task"],
		stability: "stable_in_scope",
		reuse: "expected_reuse",
		basis_refs: [evidenceRef],
		reconsider_when: "the deterministic smoke contract changes",
	};
	if (name === "memory") return {
		...common, semantic_kind: "fact", name: "smoke-memory",
		summary: "A routed fact visible to the next ARC turn.",
		content: "SMOKE_MEMORY_MARKER: route-to-memory succeeded.",
		reasoning: "none", execution: "text", context_visibility: "always",
		prompt_channel: "task_prompt",
		expected_effect: "the next parent turn receives SMOKE_MEMORY_MARKER",
	};
	if (name === "skills") return {
		...common, semantic_kind: "procedure", name: "smoke-skill",
		summary: "A routed procedure visible to the next ARC turn.",
		content: "SMOKE_SKILL_MARKER: inspect the current state, then make one ARC action.",
		description: "Deterministic next-turn smoke procedure.",
		reasoning: "bounded_judgment", execution: "text", context_visibility: "on_demand",
		expected_effect: "the next parent turn can inspect SMOKE_SKILL_MARKER",
	};
	if (name === "tools") return {
		...common, semantic_kind: "computation", name: "smoke-counter",
		summary: "Count enabled items after deterministic filtering.",
		content: "Pick items, filter enabled=true, map value, and count the result.",
		description: "Deterministic enabled-item counter.",
		reasoning: "none", execution: "pure_computation", context_visibility: "on_demand",
		input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] },
		program: { steps: [
			{ kind: "pick", source: "input", field: "items" },
			{ kind: "filter", field: "enabled", equals: true },
			{ kind: "map", fields: ["value"] },
			{ kind: "count" },
		] },
		expected_effect: "the next parent turn returns numeric count 2 for the smoke input",
	};
	if (name === "subagents") return {
		...common, semantic_kind: "role", name: "smoke-reviewer",
		summary: "An independent read-only ARC reviewer.",
		content: "Return one concise independent result for the delegated ARC question.",
		description: "Deterministic routed subagent role.",
		reasoning: "open_ended", execution: "model_delegation", context_visibility: "on_demand",
		tools: ["arc_state"],
		expected_effect: "the next parent turn delegates and receives SMOKE_SUBAGENT_RESULT",
	};
	return {
		...common, semantic_kind: "fact", name: "smoke-core-rule",
		summary: "A continuously salient ARC execution rule.",
		content: "SMOKE_SYSTEM_MARKER: use only actions advertised by the current ARC state.",
		reasoning: "none", execution: "text", context_visibility: "always",
		prompt_channel: "system_prompt", prompt_operation: "create",
		system_prompt_basis: { source: "validated_environment_invariant", evidence_refs: [evidenceRef] },
		expected_effect: "the next parent system prompt contains SMOKE_SYSTEM_MARKER",
	};
}

function reportFor(delivery: Record<string, unknown>): Record<string, unknown> {
	return {
		format: "auto-research-report-v1",
		status: "supported_within_scope",
		conclusion: `The ${scenario} smoke delivery is supported by the selected ARC observation.`,
		findings: [{
			subject_kind: String(delivery.semantic_kind),
			question: `Can ${scenario} be routed and used on the next parent turn?`,
			conclusion: "Yes, within this deterministic smoke scope.",
			evidence_refs: [evidenceRef], uncertainty: "none inside the fixture contract",
		}],
		evidence_refs: [evidenceRef], alternatives: [], limitations: ["fixture-scoped evidence"],
		validation_plan: "Use the exact routed version on the next real ARC parent turn.",
		harness_proposals: [{ approval_id: "auto-research-1:proposal-1", delivery }],
	};
}

function providerStep(request: number, context: any): Step {
	const isChild = process.env.PI_TASK_CHILD === "1";
	if (isChild && process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1") {
		const lengthMarker = join(root, "arc-smoke-auto-research-length-once.marker");
		if (scenario === "memory" && !existsSync(lengthMarker)) {
			writeFileSync(lengthMarker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "SMOKE_AUTO_RESEARCH_PARTIAL" };
		}
		const delivery = deliveryFor(scenario);
		const report = reportFor(delivery);
		const steps: Step[] = [
			{ kind: "tool", name: "research_approval", arguments: {
				action: "propose", approval_id: "auto-research-1:proposal-1", delivery,
			} },
			{ kind: "tool", name: "research_approval", arguments: {
				action: "approve", approval_id: "auto-research-1:proposal-1", target_version: 1,
			} },
			{ kind: "tool", name: "submit_research_report", arguments: { report } },
		];
		return steps[request] ?? { kind: "text", text: "research fixture complete" };
	}
	if (isChild) {
		const marker = join(root, "arc-smoke-delegate-length-once.marker");
		if (scenario === "subagents" && !existsSync(marker)) {
			writeFileSync(marker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "SMOKE_SUBAGENT_PARTIAL" };
		}
		return { kind: "text", text: "SMOKE_SUBAGENT_RESULT" };
	}

	const parentSteps: Step[] = [
		{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
		{ kind: "tool", name: "arc_state", arguments: { request: "current" } },
		{ kind: "tool", name: "auto_research", arguments: {
			question: `Route the deterministic ${scenario} finding for next-turn use.`,
			scope: "harness_component", evidence_refs: [evidenceRef],
		} },
		{ kind: "tool", name: "arc_action", arguments: {
			action: "ACTION1", reasoning: "End the first smoke turn after the routed mutation.",
		} },
	];
	const use: Record<string, Step> = {
		memory: { kind: "tool", name: "task_memory", arguments: { action: "inspect", key: "smoke-memory" } },
		skills: { kind: "tool", name: "task_skill", arguments: { action: "inspect", name: "smoke-skill" } },
		tools: { kind: "tool", name: "task_tool_smoke-counter_v1", arguments: { input: { items: [
			{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true },
		] } } },
		subagents: { kind: "tool", name: "delegate_task", arguments: {
			agent_name: "smoke-reviewer", task: "Return the deterministic independent smoke result.",
			evidence_refs: [evidenceRef], resource_refs: [],
		} },
		system_prompt: { kind: "tool", name: "task_system_prompt", arguments: { action: "inspect", name: "smoke-core-rule" } },
	};
	parentSteps.push(use[scenario]);
	parentSteps.push({ kind: "tool", name: "arc_action", arguments: {
		action: "ACTION2", reasoning: "End the second smoke turn after using the routed component.",
	} });
	return parentSteps[request] ?? { kind: "text", text: "parent fixture complete" };
}

function contextEvidence(request: number, context: any) {
	const encoded = JSON.stringify(context.messages ?? []);
	return {
		format: "arc-real-runner-provider-context-v1",
		scenario, request, child: process.env.PI_TASK_CHILD === "1",
		research_child: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1",
		tool_names: (context.tools ?? []).map((tool: any) => String(tool.name)),
		system_has_marker: String(context.systemPrompt ?? "").includes("SMOKE_SYSTEM_MARKER"),
		messages_have_memory_marker: encoded.includes("SMOKE_MEMORY_MARKER"),
		messages_have_skill_marker: encoded.includes("SMOKE_SKILL_MARKER"),
	};
}

export default function arcHarnessSmokeProvider(pi: ExtensionAPI) {
	let request = 0;
	let toolCall = 0;
	pi.registerProvider("offline-arc-harness-smoke", {
		api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 175000, maxTokens: 16384,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context) {
			appendFileSync(join(root, "arc-smoke-provider-contexts.jsonl"),
				JSON.stringify(contextEvidence(request, context)) + "\n", "utf8");
			const step = providerStep(request++, context);
			const stream = createAssistantMessageEventStream();
			const stopReason = step.kind === "tool" ? "toolUse" : step.kind === "length" ? "length" : "stop";
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason, timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			stream.push({ type: "start", partial: output });
			if (step.kind === "tool") {
				const block = { type: "toolCall" as const, id: `arc-smoke-${++toolCall}`, name: step.name, arguments: step.arguments };
				output.content.push(block);
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: output });
			} else {
				output.content.push({ type: "text", text: step.text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: output });
			}
			stream.push({ type: "done", reason: stopReason, message: output });
			stream.end();
			return stream;
		},
	});
}
