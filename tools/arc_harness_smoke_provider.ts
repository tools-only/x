/** Deterministic model boundary for the real ARC self-harness smoke runner.
 *
 * Only the provider is mocked.  The official ARC bridge, Pi parent, broker,
 * Pi children, structured report parser, code router, native harness tools,
 * action boundaries, and next-turn context projection are production paths.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Step =
	| { kind: "tool"; name: string; arguments: Record<string, unknown> }
	| { kind: "text"; text: string }
	| { kind: "length"; text: string; thinkingOnly?: boolean };

const scenario = String(process.env.PI_ARC_SMOKE_SCENARIO ?? "memory");
const root = String(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
const evidenceRef = "execution-observation-1";
const researchScope = process.env.PI_ARC_SMOKE_SCOPE ?? "harness_component";
const crossContextMethod = process.env.PI_ARC_SMOKE_CROSS_CONTEXT_METHOD === "1";
const methodLifecycle = process.env.PI_ARC_SMOKE_METHOD_LIFECYCLE === "1" || crossContextMethod;
const methodConstructionRefs = crossContextMethod
	? ["execution-observation-2", "execution-observation-5"] : [evidenceRef];
const methodContrastRefs = crossContextMethod ? ["execution-observation-4"] : [];
const methodEvidenceRefs = [...methodConstructionRefs, ...methodContrastRefs];

function methodForSmoke(): Record<string, unknown> {
	return {
		problem: crossContextMethod
			? "Choose one bounded next ARC action and preserve a visible prediction that can be checked after use."
			: "Count enabled items without retaining unrelated item fields.",
		inputs: [crossContextMethod
			? "reset-separated ARC action cases, one contrast case, and the current available-action set"
			: "a bounded list of items with enabled and value fields"],
		invariants: [crossContextMethod
			? "the chosen action, prediction, and falsifier remain bound to one exact adopted procedure version"
			: "only enabled items contribute to the count"],
		parameters: [crossContextMethod ? "the current pre-state and available actions" : "the input item list"],
		steps: crossContextMethod
			? ["compare the reset-separated action effects", "select one available action", "state a visible prediction and falsifier", "execute once", "compare the result"]
			: ["select items", "filter enabled items", "select values", "count results"],
		decision_points: [crossContextMethod ? "which available action best tests the bounded pattern" : "whether each item is enabled"],
		stop_conditions: [crossContextMethod ? "one selected action has produced a visible transition" : "the numeric count is returned"],
		failure_modes: [crossContextMethod ? "the selected action is unavailable or the prediction is not observable" : "disabled items are counted or enabled items are omitted"],
		construction_evidence_refs: methodConstructionRefs,
		contrast_evidence_refs: methodContrastRefs,
		next_use: crossContextMethod ? "read the adopted procedure and execute its selected action on the next real parent turn"
			: "invoke the routed counter on the next real parent turn",
		predicted_semantic_result: crossContextMethod
			? "the next parent action equals NEXT_ACTION and its visible transition can be compared with PREDICTION"
			: "the fixture input returns numeric count 2",
		falsifier: crossContextMethod
			? "the parent executes a different action, omits the exact procedure version, or records no checkable visible result"
			: "the routed tool returns any value other than 2",
	};
}

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
		prompt_layer: "task_policy",
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
	if (name === "tools" && crossContextMethod) return {
		...common,
		basis_refs: methodEvidenceRefs,
		semantic_kind: "procedure",
		name: "smoke-action-method",
		summary: "Choose and test one bounded ARC action from the compared situations.",
		description: "A bounded action-selection procedure induced from reset-separated evidence.",
		content: [
			"NEXT_ACTION: ACTION2",
			"PREDICTION: the selected action changes at least one visible cell",
			"FALSIFIER: the selected action produces no visible change",
			"Read the current available actions, execute NEXT_ACTION only when it remains available,",
			"then compare the resulting public transition with PREDICTION and FALSIFIER.",
		].join("\n"),
		reasoning: "bounded_judgment",
		execution: "text",
		context_visibility: "on_demand",
		expected_effect: "the later parent ARC decision is selected by this exact procedure version",
	};
	if (name === "tools") return {
		...common, basis_refs: methodEvidenceRefs, semantic_kind: "computation", name: "smoke-counter",
		summary: "Count enabled items after deterministic filtering.",
		content: "Pick items, filter enabled=true, map value, and count the result.",
		description: "Deterministic enabled-item counter.",
		reasoning: "none", execution: "pure_computation", context_visibility: "on_demand",
		input_schema: { type: "object", properties: { items: { type: "array", items: {
			type: "object", properties: { value: { type: "string" }, enabled: { type: "boolean" } },
			required: ["value", "enabled"],
		} } }, required: ["items"] },
		program: { steps: [
			{ kind: "pick", source: "input", field: "items" },
			{ kind: "filter", field: "enabled", equals: true },
			{ kind: "map", fields: ["value"] },
			{ kind: "count" },
		] },
		...(methodLifecycle && !crossContextMethod ? { method: methodForSmoke() } : {}),
		expected_effect: crossContextMethod
			? "the later parent turn returns numeric count 1 for a new bounded case set"
			: "the next parent turn returns numeric count 2 for the smoke input",
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
		conclusion: crossContextMethod
			? "The reset-separated ACTION1 cases support a bounded action-selection procedure; later use remains unvalidated."
			: `The ${scenario} smoke delivery is supported by the selected ARC observation.`,
		findings: [{
			subject_kind: String(delivery.semantic_kind),
			question: `Can ${scenario} be routed and used on the next parent turn?`,
			conclusion: crossContextMethod
				? "ACTION1 changed visible state in both attempt:1 and attempt:2; attempt identity varied while the change predicate held."
				: "Yes, within this deterministic smoke scope.",
			evidence_refs: methodEvidenceRefs,
			uncertainty: crossContextMethod ? "Only two reset-separated attempts are represented." : "none inside the fixture contract",
		}],
		evidence_refs: methodEvidenceRefs,
		alternatives: crossContextMethod ? ["The repeated outcome may depend on unobserved state rather than action identity alone."] : [],
		limitations: [crossContextMethod ? "The inferred invariant is limited to two reset-separated attempts." : "fixture-scoped evidence"],
		validation_plan: "Use the exact routed version on the next real ARC parent turn.",
		...(crossContextMethod ? { method_candidates: [{
			candidate_ref: "cross-context-smoke-method",
			name: "smoke-action-method",
			semantic_kind: "procedure",
			summary: "Select and test one bounded next action after comparing reset-separated ARC situations.",
			basis_refs: methodEvidenceRefs,
			method: methodForSmoke(),
		proposed_delivery_id: "smoke-tools",
		}] } : {}),
		harness_proposals: [{ approval_id: "auto-research-1:proposal-1", delivery }],
	};
}

function feedbackReport(): Record<string, unknown> {
	const actualUseRef = resourceRefForUse("smoke-action-method") ?? "execution-observation-6";
	return {
		format: "auto-research-report-v1",
		status: "supported_within_scope",
		conclusion: "The later ARC action was selected from the exact adopted procedure and produced a visible transition within the bounded smoke scope.",
		findings: [{
			subject_kind: "research_method",
			question: "Did later use support the method induced from reset-separated contexts?",
			conclusion: "Yes. The parent read the exact procedure version, executed its NEXT_ACTION, preserved its prediction and falsifier, and recorded the resulting ARC transition; this does not broaden the two-attempt construction scope.",
				evidence_refs: [...methodEvidenceRefs, actualUseRef],
			uncertainty: "No additional ARC level or game was tested.",
		}],
		evidence_refs: [...methodEvidenceRefs, actualUseRef],
		alternatives: ["The visible transition may still depend on unobserved state rather than the induced pattern."],
		limitations: ["Validation remains bounded to the recorded construction cases and one later use."],
		validation_plan: "Retain the method within scope and seek a counterexample in a later distinct task stage.",
		next_research_question: "Does the predicate remain stable after a level transition?",
		harness_proposals: [],
	};
}

function jsonl(path: string): Record<string, any>[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
		} catch { return []; }
	});
}

function realResearchMethodState(): {
	ready: boolean;
	delivery?: Record<string, any>;
	resourceRef?: string;
	nextAction?: string;
	prediction?: string;
	falsifier?: string;
	actualUseObservationRef?: string;
} {
	const reportRecord = jsonl(join(root, "auto-research-reports.jsonl"))
		.find((item) => item.run_id === "auto-research-1");
	const report = reportRecord?.report as Record<string, any> | undefined;
	const proposal = Array.isArray(report?.harness_proposals)
		? report!.harness_proposals.find((item: any) => item?.delivery?.semantic_kind === "procedure") : undefined;
	const delivery = proposal?.delivery as Record<string, any> | undefined;
	const routes = jsonl(join(root, "auto-research-harness-routes.jsonl"))
		.filter((item) => item.run_id === "auto-research-1" && item.delivery_id === delivery?.delivery_id);
	const ready = routes.some((item) => item.route_status === "ready" || item.route_status === "fulfilled");
	const content = String(delivery?.content ?? "");
	const field = (name: string) => content.match(new RegExp(`^${name}\\s*[:=]\\s*(.+)$`, "im"))?.[1]?.trim();
	const nextAction = field("NEXT_ACTION")?.match(/\b(?:RESET|ACTION\d+)\b/i)?.[0]?.toUpperCase();
	const prediction = field("PREDICTION");
	const falsifier = field("FALSIFIER");
	const actualUseObservationRef = resourceRefForUse(delivery?.name);
	return {
		ready: Boolean(ready && delivery && nextAction && prediction && falsifier),
		...(delivery ? { delivery } : {}),
		...(delivery?.name ? { resourceRef: `skill:${delivery.name}@v1` } : {}),
		...(nextAction ? { nextAction } : {}),
		...(prediction ? { prediction } : {}),
		...(falsifier ? { falsifier } : {}),
		...(actualUseObservationRef ? { actualUseObservationRef } : {}),
	};
}

function resourceRefForUse(name: unknown): string | undefined {
	const resourceRef = String(name ?? "").trim() ? `skill:${String(name).trim()}@v1` : "";
	if (!resourceRef) return undefined;
	return jsonl(join(root, "execution-observations.jsonl")).findLast((item) =>
		item.tool_name === "arc_action" && !item.is_error
		&& Array.isArray(item.input?.decision?.basis_refs)
		&& item.input.decision.basis_refs.includes(resourceRef))?.observation_id;
}

function crossContextCandidateRef(): string | undefined {
	const candidate = jsonl(join(root, "auto-research-opportunities.jsonl"))
		.findLast((item) => item.action_signature === "arc_action:ACTION1");
	return candidate ? `research_candidate:${candidate.candidate_id}@v${candidate.version}` : undefined;
}

function constructionPreActionStateRefs(): string[] {
	const wanted = new Set(methodConstructionRefs);
	return jsonl(join(root, "execution-observations.jsonl"))
		.filter((item) => wanted.has(String(item.observation_id ?? "")))
		.map((item) => String(item.arc_outcome?.pre_action_state?.resource_ref ?? ""))
		.filter(Boolean);
}

function providerStep(request: number, context: any): Step {
	const isChild = process.env.PI_TASK_CHILD === "1";
	if (isChild && process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1") {
		const runId = String(process.env.PI_AUTO_RESEARCH_RUN_ID ?? "auto-research-1");
		if (crossContextMethod) {
			const reads = runId === "auto-research-1"
				? [...constructionPreActionStateRefs(),
					"observation:execution-observation-2@v1", "observation:execution-observation-4@v1",
					"observation:execution-observation-5@v1"]
				: ["observation:execution-observation-2@v1", "observation:execution-observation-4@v1",
					"observation:execution-observation-5@v1",
					`observation:${resourceRefForUse("smoke-action-method") ?? "execution-observation-6"}@v1`,
					"effect_assessment:effect-assessment-1@v1"];
			if (request < reads.length) return { kind: "tool", name: "task_resource", arguments: {
				action: "read", ref: reads[request], offset: 0, limit: 200000,
			} };
			return { kind: "tool", name: "submit_research_report", arguments: {
				report: runId === "auto-research-1" ? reportFor(deliveryFor(scenario)) : feedbackReport(),
			} };
		}
		const lengthMarker = join(root, "arc-smoke-auto-research-length-once.marker");
		if (scenario === "memory" && !existsSync(lengthMarker)) {
			if (request === 0) return { kind: "tool", name: "task_resource", arguments: {
				action: "read", ref: `observation:${evidenceRef}@v1`, offset: 0, limit: 200000,
			} };
			writeFileSync(lengthMarker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "Synthetic reasoning-only interruption", thinkingOnly: true };
		}
		const delivery = deliveryFor(scenario);
		const report = reportFor(delivery);
		if (scenario === "memory" && request === 0) return { kind: "tool", name: "task_resource", arguments: {
			action: "read", ref: `observation:${evidenceRef}@v1`, offset: 0, limit: 200000,
		} };
		const steps: Step[] = [
			{ kind: "tool", name: "submit_research_report", arguments: { report } },
		];
		return steps[request - (scenario === "memory" ? 1 : 0)] ?? { kind: "text", text: "research fixture complete" };
	}
	if (isChild) {
		const marker = join(root, "arc-smoke-delegate-length-once.marker");
		if (scenario === "subagents" && !existsSync(marker)) {
			writeFileSync(marker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "SMOKE_SUBAGENT_PARTIAL" };
		}
		return { kind: "text", text: "SMOKE_SUBAGENT_RESULT" };
	}
	if (crossContextMethod) {
		const commonPrefix: Step[] = [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			{ kind: "tool", name: "arc_state", arguments: { request: "current" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Record ACTION1 in attempt 1." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "RESET", reasoning: "Create a distinct online attempt without rewinding the trajectory." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION2", reasoning: "Change the second attempt's pre-state before repeating ACTION1." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Record the same action from a different pre-state in attempt 2." } },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "auto_research", arguments: {
				action: "start",
				research_candidate_ref: crossContextCandidateRef() ?? "research_candidate:missing@v1",
			} },
		];
		const method = realResearchMethodState();
		return [
			...commonPrefix,
			{ kind: "tool", name: "task_harness", arguments: {
				action: "adopt_research", research_run_ref: "research_run:auto-research-1@v1",
			} },
			{ kind: "tool", name: "task_resource", arguments: {
				action: "read", ref: method.resourceRef ?? "skill:smoke-action-method@v1",
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: method.nextAction ?? "ACTION2",
				reasoning: "Execute the action selected by the adopted cross-context procedure.",
				decision: { basis_refs: [method.resourceRef ?? "skill:smoke-action-method@v1"],
					prediction: method.prediction ?? "the selected action changes at least one visible cell",
					falsifier: method.falsifier ?? "the selected action produces no visible change" } } },
			{ kind: "tool", name: "task_harness", arguments: {
				action: "assess_effect", verdict: "inconclusive",
				observation_refs: method.actualUseObservationRef ? [method.actualUseObservationRef] : [],
				consequence: "The adopted procedure selected and justified the later ARC action; feedback research must compare its visible result with the recorded prediction.",
				remaining_uncertainty: "The scripted parent records use but does not supply the semantic verdict for the child-authored prediction.",
			} },
			{ kind: "tool", name: "auto_research", arguments: { action: "start", interaction_mode: "blocking",
				research_handoff_ref: "research_handoff:method-feedback-effect-assessment-1@v1" } },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION3", reasoning: "Cross a later real parent boundary after feedback research." } },
		][request] ?? { kind: "text", text: "cross-context method fixture complete" };
	}

	const delivery = deliveryFor(scenario);
	const adoptRoute: Step = { kind: "tool", name: "task_harness", arguments: {
		action: "adopt_research", research_run_ref: "research_run:auto-research-1@v1",
	} };
	const parentSteps: Step[] = [
		{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
		{ kind: "tool", name: "arc_state", arguments: { request: "current" } },
		{ kind: "tool", name: "auto_research", arguments: {
			question: `Route the deterministic ${scenario} finding for next-turn use.`,
			...(researchScope ? { scope: researchScope } : {}), evidence_refs: [evidenceRef],
			...(methodLifecycle ? { research_kind: "capability", research_line_ref: "research_line:arc-smoke-counter@v1" } : {}),
		} },
		adoptRoute,
		{ kind: "tool", name: "arc_action", arguments: {
			action: "ACTION1", reasoning: "End the first smoke turn after the routed mutation.",
		} },
	];
	const use: Record<string, Step> = {
		memory: { kind: "tool", name: "task_resource", arguments: { action: "read", ref: "memory:smoke-memory@v1" } },
		skills: { kind: "tool", name: "task_resource", arguments: { action: "read", ref: "skill:smoke-skill@v1" } },
		tools: { kind: "tool", name: "task_tool_smoke-counter_v1", arguments: { input: { items: [
			{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true },
		] } } },
		subagents: { kind: "tool", name: "delegate_task", arguments: {
			agent_name: "smoke-reviewer", task: "Return the deterministic independent smoke result.",
			evidence_refs: [evidenceRef], resource_refs: [],
		} },
		system_prompt: { kind: "tool", name: "task_resource", arguments: { action: "read", ref: "system_prompt:smoke-core-rule@v1" } },
	};
	parentSteps.push(use[scenario]);
	if (methodLifecycle) parentSteps.push({ kind: "tool", name: "task_harness", arguments: {
		action: "assess_effect", verdict: "supported",
		consequence: "The later routed tool invocation returned the predicted semantic result 2.",
		remaining_uncertainty: "Validation is limited to this bounded ARC smoke input.",
	} });
	if (scenario === "memory" && process.env.PI_ARC_SMOKE_PERIODIC !== "1") {
		parentSteps.push(
			{ kind: "tool", name: "task_harness", arguments: { action: "change", changes: [
				{ operation: "create", candidate: { semantic_kind: "skill", name: "smoke-dependent",
					content: "SMOKE_OLD_DEPENDENT", depends_on_refs: ["memory:smoke-memory@v1"] } },
				{ operation: "create", candidate: { semantic_kind: "memory", key: "smoke-state",
					content: "SMOKE_OLD_STATE", depends_on_refs: ["skill:smoke-dependent@v1"],
					projection: { channel: "task_prompt", layer: "task_state" } } },
				{ operation: "create", candidate: { semantic_kind: "policy", name: "smoke-new-policy",
					content: "SMOKE_NEW_POLICY", scope: { kind: "task_wide", statement: "this deterministic ARC smoke task" },
					context_visibility: "always", stability: "stable_in_scope", prompt_channel: "task_prompt",
					prompt_layer: "task_policy", supersedes_refs: ["memory:smoke-memory@v1"] } },
			], decision: { basis_refs: [evidenceRef], reason: "Exercise replacement and dependent suspension through the parent facade.",
				expected: "The new policy replaces the old policy and suspends guidance that depends on it." } } },
		);
	}
	parentSteps.push({ kind: "tool", name: "arc_action", arguments: {
		action: "ACTION2", reasoning: "End the second smoke turn after using the routed component.",
	} });
	if (scenario === "memory" && process.env.PI_ARC_SMOKE_PERIODIC !== "1") {
		parentSteps.push({ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Verify revised policy on a later real parent turn." } });
	}
	if (process.env.PI_ARC_SMOKE_PERIODIC === "1") {
		parentSteps.splice(2, 1,
			...Array.from({length:5}, ():Step => ({kind:"tool",name:"arc_action",arguments:{action:"ACTION1",reasoning:"Collect periodic window evidence."}})),
			{kind:"tool",name:"task_harness",arguments:{action:"review",review:[],transition_analysis:{
				observed_changes:"Five action results were recorded; inspect their canonical deltas.",
				predictive_rules:"No mechanism claimed by the deterministic provider.",
				limiting_uncertainty:"Whether the reusable delivery is effective on a later turn.",
				next_experiment:"Use the routed component and inspect its semantic output.",
				capability_opportunities:"A fixture-scoped reusable capability.",evidence_refs:[evidenceRef],
			}}},
			{kind:"tool",name:"auto_research",arguments:{action:"start",interaction_mode:"blocking"}},
			{kind:"tool",name:"task_harness",arguments:{action:"inspect"}},
		);
	}
	return parentSteps[request] ?? { kind: "text", text: "parent fixture complete" };
}

function contextEvidence(request: number, context: any) {
	const encoded = JSON.stringify(context.messages ?? []);
	const system = String(context.systemPrompt ?? "");
	const projected = (prefix: string) => (context.messages ?? []).flatMap((m: any) =>
		(m.content ?? []).filter((p: any) => p.type === "text" && p.text.startsWith(prefix)).map((p: any) => p.text)).join("\n");
	const tools = context.tools ?? [];
	const submitTool = tools.find((tool: any) => String(tool.name) === "submit_research_report");
	const submitSchema = JSON.stringify(submitTool?.parameters ?? {});
	return {
		format: "arc-real-runner-provider-context-v1",
		scenario, request, child: process.env.PI_TASK_CHILD === "1",
		research_child: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1",
		parent_guide_present: system.includes("# Auto-Research: parent guide"),
		child_guide_present: system.includes("# Auto-Research: child instructions"),
		profile_headings: [...system.matchAll(/^# Research focus: (.+)$/gm)].map((match) => match[1]),
		delivery_guide_in_system: system.includes("# Candidate harness delivery"),
		submission_contract_seen: Boolean(submitTool) && submitSchema.includes("harness_proposals")
			&& submitSchema.includes("method_candidates") && submitSchema.includes("delivery") && submitSchema.includes("method"),
		tool_names: tools.map((tool: any) => String(tool.name)),
		system_has_marker: String(context.systemPrompt ?? "").includes("SMOKE_SYSTEM_MARKER"),
		messages_have_memory_marker: encoded.includes("SMOKE_MEMORY_MARKER"),
		messages_have_skill_marker: encoded.includes("SMOKE_SKILL_MARKER"),
		knowledge_lifecycle_verified: projected("Active task policy:").includes("SMOKE_NEW_POLICY")
			&& !projected("Active task policy:").includes("SMOKE_MEMORY_MARKER")
			&& !projected("Active task-local skills").includes("SMOKE_OLD_DEPENDENT")
			&& !projected("Active dynamic task/user prompt knowledge:").includes("SMOKE_OLD_STATE")
			&& projected("Task-local knowledge requiring review:").includes("memory:smoke-state@v1"),
		checkpoint_reloaded: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1"
			&& existsSync(join(root, "task-context-cache", "auto-research-checkpoints", `${process.env.PI_AUTO_RESEARCH_SESSION_ID}.json`))
			? JSON.parse(readFileSync(join(root, "task-context-cache", "auto-research-checkpoints", `${process.env.PI_AUTO_RESEARCH_SESSION_ID}.json`), "utf8")) : null,
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
			} else if (step.kind === "length" && step.thinkingOnly) {
				output.content.push({ type: "thinking", thinking: step.text });
				stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
				stream.push({ type: "thinking_delta", contentIndex: 0, delta: step.text, partial: output });
				stream.push({ type: "thinking_end", contentIndex: 0, content: step.text, partial: output });
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
