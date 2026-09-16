/** Deterministic Auto-Research delivery -> Pi native harness call compiler. */
import { createHash } from "node:crypto";
import { TASK_TOOL_PROGRAM_STEP_KINDS } from "./pi_task_tool_contract.ts";

export const HARNESS_SEMANTIC_KINDS = [
	"fact", "plan", "procedure", "computation", "role", "assessment", "evidence",
] as const;

export type PromptChannel = "system_prompt" | "task_prompt";
export type SystemPromptBasis = {
	source: "explicit_task_contract" | "validated_environment_invariant";
	evidence_refs: string[];
};

/**
 * Agent-authored activation AST for task-prompt projection.  It is metadata on
 * an existing memory, not a sixth harness component.  The AST deliberately
 * has no count/length policy; it is evaluated against the current Pi context
 * by the extension hook.
 */
export type ActivationCondition = Record<string, unknown>;

export type HarnessDelivery = {
	format: "auto-research-harness-delivery-v1";
	delivery_id: string;
	semantic_kind: typeof HARNESS_SEMANTIC_KINDS[number];
	operation: "create" | "update" | "reuse" | "retire";
	name: string;
	summary: string;
	content: string;
	description?: string;
	scope: { kind: "current_step" | "condition" | "task_wide"; statement: string };
	trigger: string;
	exclusions: string[];
	stability: "transient" | "conditional" | "stable_in_scope";
	reuse: "one_off" | "expected_reuse";
	reasoning: "none" | "bounded_judgment" | "open_ended";
	execution: "text" | "pure_computation" | "adapter_operation" | "model_delegation";
	context_visibility: "on_demand" | "always";
	/** Evidence-bound justification required only for a system-prompt projection. */
	system_prompt_basis?: SystemPromptBasis;
	/** Optional prompt projection channel; default is task_prompt for always-visible deliveries. */
	prompt_channel?: PromptChannel;
	/** Structured predicate used by the task/user prompt context projection. */
	activation?: ActivationCondition;
	prompt_text?: string;
	prompt_operation?: "create" | "update" | "reuse" | "retire";
	prompt_target_version?: number;
	target_version?: number;
	input_schema?: Record<string, unknown>;
	implementation_ref?: string;
	program?: Record<string, unknown>;
	tools?: string[];
	basis_refs: string[];
	expected_effect: string;
	reconsider_when: string;
};

export type HarnessRouteStep = {
	step_id: string;
	order: number;
	target: "memory" | "skill" | "tool" | "subagent" | "system_prompt";
	native_tool: string;
	native_call: { name: string; arguments: Record<string, unknown> };
	depends_on: string[];
	status: "ready" | "unsupported";
	reason?: string;
};

export type HarnessRoutePlan = {
	format: "auto-research-harness-route-v1";
	route_id: string;
	route_ref: string;
	version: 1;
	run_id: string;
	delivery_id: string;
	delivery_hash: string;
	approval_ref: string;
	review_status: string;
	disposition: "materialize" | "reuse" | "research_only" | "waiting" | "closed";
	route_status: "ready" | "partial" | "no_change" | "waiting";
	/** Parent-runtime result; absent before a ready route is executed. */
	execution_status?: "fulfilled" | "partial" | "failed";
	execution_applied?: boolean;
	base_target: string;
	steps: HarnessRouteStep[];
	apply_call?: { name: "task_harness"; arguments: { action: "apply_route"; route_ref: string; expected_delivery_hash: string } };
	router: { implementation: "code"; policy_version: "harness-router-v1" };
};

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, stableValue(item)]));
	}
	return value;
}

function normalizeActivation(value: unknown): ActivationCondition | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("delivery.activation must be an object");
	}
	return value as ActivationCondition;
}

function normalizeSystemPromptBasis(value: unknown): SystemPromptBasis | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("delivery.system_prompt_basis must be an object");
	}
	const basis = value as Record<string, unknown>;
	if (!["explicit_task_contract", "validated_environment_invariant"].includes(String(basis.source ?? ""))) {
		throw new Error("delivery.system_prompt_basis.source is invalid");
	}
	const evidenceRefs = Array.isArray(basis.evidence_refs)
		? [...new Set(basis.evidence_refs.map(String).map((item) => item.trim()).filter(Boolean))]
		: [];
	if (!evidenceRefs.length) throw new Error("delivery.system_prompt_basis requires evidence_refs");
	return { source: basis.source as SystemPromptBasis["source"], evidence_refs: evidenceRefs };
}

export function harnessDeliveryHash(delivery: HarnessDelivery): string {
	return createHash("sha256").update(JSON.stringify(stableValue(delivery))).digest("hex");
}

export function normalizeHarnessDelivery(input: unknown): HarnessDelivery {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("delivery must be an object");
	const value = input as Record<string, any>;
	if (value.format !== "auto-research-harness-delivery-v1") throw new Error("unsupported harness delivery format");
	if (!HARNESS_SEMANTIC_KINDS.includes(value.semantic_kind)) throw new Error(`unknown semantic_kind: ${String(value.semantic_kind)}`);
	const requiredStrings = ["delivery_id", "name", "summary", "content", "trigger", "expected_effect", "reconsider_when"];
	for (const field of requiredStrings) if (!String(value[field] ?? "").trim()) throw new Error(`delivery.${field} is required`);
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(String(value.delivery_id))
		|| !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(String(value.name))
		|| String(value.delivery_id).includes("--") || String(value.name).includes("--")) {
		throw new Error("delivery_id and name must use lowercase letters, digits, and single hyphens");
	}
	if (!["create", "update", "reuse", "retire"].includes(value.operation)) throw new Error("delivery.operation is invalid");
	if (["update", "retire"].includes(value.operation) && !Number.isInteger(value.target_version)) {
		throw new Error(`delivery.${value.operation} requires target_version`);
	}
	if (!value.scope || !["current_step", "condition", "task_wide"].includes(value.scope.kind)
		|| !String(value.scope.statement ?? "").trim()) throw new Error("delivery.scope is invalid");
	if (!["transient", "conditional", "stable_in_scope"].includes(value.stability)) throw new Error("delivery.stability is invalid");
	if (!["one_off", "expected_reuse"].includes(value.reuse)) throw new Error("delivery.reuse is invalid");
	if (!["none", "bounded_judgment", "open_ended"].includes(value.reasoning)) throw new Error("delivery.reasoning is invalid");
	if (!["text", "pure_computation", "adapter_operation", "model_delegation"].includes(value.execution)) throw new Error("delivery.execution is invalid");
	if (!["on_demand", "always"].includes(value.context_visibility)) throw new Error("delivery.context_visibility is invalid");
	if (value.prompt_channel !== undefined && !["system_prompt", "task_prompt"].includes(value.prompt_channel)) {
		throw new Error("delivery.prompt_channel is invalid");
	}
	const activation = normalizeActivation(value.activation);
	const systemPromptBasis = normalizeSystemPromptBasis(value.system_prompt_basis);
	const basisRefs = Array.isArray(value.basis_refs)
		? [...new Set(value.basis_refs.map(String).map((item) => item.trim()).filter(Boolean))]
		: [];
	const systemPromptRequested = value.prompt_channel === "system_prompt";
	const taskPromptRequested = value.prompt_channel === "task_prompt";
	if (taskPromptRequested && !["fact", "plan"].includes(value.semantic_kind)) {
		throw new Error("task_prompt projection requires fact or plan memory semantics");
	}
	if (taskPromptRequested && value.context_visibility !== "always") {
		throw new Error("task_prompt projection requires always context_visibility");
	}
	const systemPromptEligible = systemPromptRequested
		&& value.context_visibility === "always"
		&& value.scope.kind === "task_wide" && value.stability === "stable_in_scope";
	if (systemPromptRequested && !systemPromptEligible) {
		throw new Error("system_prompt projection requires always-visible stable task-wide delivery");
	}
	if (systemPromptRequested && ["assessment", "evidence"].includes(value.semantic_kind)) {
		throw new Error("assessment and evidence deliveries are research_only and cannot become system_prompt");
	}
	if (systemPromptRequested && !systemPromptBasis) {
		throw new Error("system_prompt projection requires system_prompt_basis");
	}
	if (!systemPromptRequested && systemPromptBasis) {
		throw new Error("system_prompt_basis is only valid with prompt_channel system_prompt");
	}
	if (systemPromptBasis && systemPromptBasis.evidence_refs.some((reference) => !basisRefs.includes(reference))) {
		throw new Error("system_prompt_basis.evidence_refs must be included in delivery.basis_refs");
	}
	if (systemPromptEligible && !["create", "update", "reuse", "retire"].includes(value.prompt_operation)) {
		throw new Error("system_prompt projection requires prompt_operation");
	}
	if (systemPromptEligible && ["update", "retire"].includes(value.prompt_operation)
		&& !Number.isInteger(value.prompt_target_version)) {
		throw new Error(`prompt ${value.prompt_operation} requires prompt_target_version`);
	}
	const delivery = {
		...value,
		delivery_id: String(value.delivery_id).trim(),
		name: String(value.name).trim(),
		summary: String(value.summary).trim(),
		content: String(value.content).trim(),
		description: value.description === undefined ? undefined : String(value.description).trim(),
		scope: { kind: value.scope.kind, statement: String(value.scope.statement).trim() },
		trigger: String(value.trigger).trim(),
		exclusions: Array.isArray(value.exclusions) ? [...new Set(value.exclusions.map(String).map((item) => item.trim()).filter(Boolean))] : [],
		basis_refs: basisRefs,
		expected_effect: String(value.expected_effect).trim(),
		reconsider_when: String(value.reconsider_when).trim(),
		...(value.prompt_channel !== undefined ? { prompt_channel: value.prompt_channel as PromptChannel } : {}),
		...(systemPromptBasis ? { system_prompt_basis: systemPromptBasis } : {}),
		...(activation ? { activation } : {}),
		tools: Array.isArray(value.tools) ? [...new Set(value.tools.map(String).map((item) => item.trim()).filter(Boolean))] : undefined,
	} as HarnessDelivery;
	if (delivery.semantic_kind === "computation" && !delivery.program && !delivery.implementation_ref) {
		throw new Error("computation delivery requires program or implementation_ref");
	}
	if (delivery.semantic_kind === "computation" && !["pure_computation", "adapter_operation"].includes(delivery.execution)) {
		throw new Error("computation delivery requires pure_computation or adapter_operation execution");
	}
	if (delivery.semantic_kind === "computation" && delivery.program) {
		const steps = (delivery.program as Record<string, unknown>).steps;
		if (!Array.isArray(steps) || !steps.length) throw new Error("computation program.steps must be a non-empty array");
		const kinds = steps.map((step) => step && typeof step === "object" && !Array.isArray(step)
			? String((step as Record<string, unknown>).kind ?? (step as Record<string, unknown>).op ?? "") : "");
		const unknown = kinds.filter((kind) => !(TASK_TOOL_PROGRAM_STEP_KINDS as readonly string[]).includes(kind));
		if (unknown.length) throw new Error(`computation program has unsupported steps: ${[...new Set(unknown)].join(", ")}`);
		if (delivery.execution === "pure_computation" && kinds.includes("adapter_call")) {
			throw new Error("pure_computation program cannot contain adapter_call");
		}
	}
	if (delivery.semantic_kind === "role" && delivery.execution !== "model_delegation") {
		throw new Error("role delivery requires model_delegation execution");
	}
	if (delivery.semantic_kind === "role" && !delivery.tools?.length) {
		throw new Error("role delivery requires an explicit native subagent tool set");
	}
	if (delivery.semantic_kind === "role" && delivery.reuse === "one_off" && delivery.operation !== "create") {
		throw new Error("one-off role delivery only supports create (ephemeral delegation)");
	}
	return delivery;
}

const BASE_ROUTE: Record<HarnessDelivery["semantic_kind"], HarnessRouteStep["target"] | "research_only"> = {
	fact: "memory",
	// A plan is task knowledge. It is stored in memory and, when requested,
	// projected into the dynamic user/task context. It is not elevated to the
	// host system prompt merely because it describes a next step.
	plan: "memory",
	procedure: "skill",
	computation: "tool",
	role: "subagent",
	// These are research artifacts, not mutable PI harness components. Preserve
	// them in the research report/approval ledger without fabricating a sixth
	// native component or silently routing every finding to memory.
	assessment: "research_only",
	evidence: "research_only",
};

function actionFor(delivery: HarnessDelivery, target: HarnessRouteStep["target"]): string {
	if (target === "memory") return delivery.operation === "retire" ? "retire" : "upsert";
	if (target === "system_prompt") return delivery.prompt_operation ?? (delivery.operation === "create" ? "create" : delivery.operation);
	return delivery.operation;
}

function nativeArguments(
	delivery: HarnessDelivery,
	target: HarnessRouteStep["target"],
	routeId: string,
	approvalRef: string,
): Record<string, unknown> {
	if (target === "system_prompt") return {
		action: delivery.prompt_operation ?? (delivery.operation === "create" ? "create" : delivery.operation),
		...(delivery.prompt_target_version ? { target_version: delivery.prompt_target_version } : {}),
		name: delivery.name,
		content: delivery.prompt_text ?? delivery.content,
		scope: delivery.scope.statement,
		basis_refs: [...new Set([...delivery.basis_refs, approvalRef])],
		expected_effect: delivery.expected_effect,
		reconsider_when: delivery.reconsider_when,
		routing_id: routeId,
		source_approval_ref: approvalRef,
	};
	const common = {
		action: actionFor(delivery, target),
		...(delivery.target_version ? { target_version: delivery.target_version } : {}),
		basis_refs: [...new Set([...delivery.basis_refs, approvalRef])],
		expected_effect: delivery.expected_effect,
		reconsider_when: delivery.reconsider_when,
		routing_id: routeId,
		source_approval_ref: approvalRef,
	};
	if (target === "memory") return { ...common, key: delivery.name, content: delivery.content,
		summary: delivery.summary, scope: delivery.scope.statement,
		...(delivery.context_visibility === "always" && (delivery.prompt_channel ?? "task_prompt") === "task_prompt" ? {
			projection: {
				channel: "task_prompt",
			...(delivery.prompt_text ? { prompt_text: delivery.prompt_text } : {}),
			...(delivery.activation ? { activation: delivery.activation } : {}),
			},
		} : {}) };
	if (target === "skill") return { ...common, name: delivery.name,
		description: delivery.description ?? delivery.summary, instructions: delivery.content };
	if (target === "tool") return { ...common, name: delivery.name,
		description: delivery.description ?? delivery.summary,
		input_schema: delivery.input_schema ?? { type: "object" },
		...(delivery.implementation_ref ? { implementation_ref: delivery.implementation_ref } : {}),
		...(delivery.program ? { program: delivery.program } : {}) };
	if (target === "subagent") return { ...common, name: delivery.name,
		description: delivery.description ?? delivery.summary, instructions: delivery.content,
		...(delivery.tools ? { tools: delivery.tools } : {}) };
	return common;
}

function makeStep(input: {
	routeId: string; order: number; target: HarnessRouteStep["target"];
	delivery: HarnessDelivery; approvalRef: string; capabilities: Set<string>; dependsOn?: string[];
}): HarnessRouteStep {
	const nativeTool = ({
		memory: "task_memory", skill: "task_skill", tool: "task_tool",
		subagent: "task_subagent", system_prompt: "task_system_prompt",
	} as const)[input.target];
	const stepId = `${input.routeId}:step-${input.order}`;
	const supported = input.capabilities.has(nativeTool);
	return {
		step_id: stepId, order: input.order, target: input.target, native_tool: nativeTool,
		native_call: { name: nativeTool, arguments: nativeArguments(input.delivery, input.target, input.routeId, input.approvalRef) },
		depends_on: input.dependsOn ?? [], status: supported ? "ready" : "unsupported",
		...(supported ? {} : { reason: `Pi native harness tool is not registered: ${nativeTool}` }),
	};
}

export function compileHarnessRoute(input: {
	runId: string;
	approvalId: string;
	approvalVersion: number;
	approvalStatus: string;
	delivery: unknown;
	capabilities: Iterable<string>;
}): HarnessRoutePlan {
	const delivery = normalizeHarnessDelivery(input.delivery);
	const deliveryHash = harnessDeliveryHash(delivery);
	const routeId = `${input.runId}:route-${delivery.delivery_id}`;
	const approvalRef = `proposal:${input.approvalId}@v${input.approvalVersion}`;
	const baseTarget = BASE_ROUTE[delivery.semantic_kind];
	const base = {
		format: "auto-research-harness-route-v1" as const, route_id: routeId, version: 1 as const,
		route_ref: `harness_route:${routeId}@v1`,
		run_id: input.runId, delivery_id: delivery.delivery_id, delivery_hash: deliveryHash,
		approval_ref: approvalRef, review_status: input.approvalStatus, base_target: baseTarget,
		router: { implementation: "code" as const, policy_version: "harness-router-v1" as const },
	};
	if (input.approvalStatus === "pending" || input.approvalStatus === "deferred") {
		return { ...base, disposition: "waiting", route_status: "waiting", steps: [] };
	}
	if (input.approvalStatus === "rejected") {
		return { ...base, disposition: "closed", route_status: "no_change", steps: [] };
	}
	if (input.approvalStatus !== "approved") throw new Error(`unknown approval status: ${input.approvalStatus}`);
	if (delivery.operation === "reuse") {
		return { ...base, disposition: "reuse", route_status: "no_change", steps: [] };
	}
	if (baseTarget === "research_only") {
		return { ...base, disposition: "research_only", route_status: "no_change", steps: [] };
	}
	const capabilities = new Set(input.capabilities);
	// A one-off role is still the native `subagent` component. Invocation via
	// delegate_task is an operation on that component, not another component.
	const actualBaseTarget = baseTarget;
	const steps = [makeStep({ routeId, order: 1, target: actualBaseTarget, delivery, approvalRef, capabilities })];
	const systemPromptStep = delivery.prompt_channel === "system_prompt"
		&& delivery.prompt_operation !== "reuse"
		&& actualBaseTarget !== "system_prompt";
	if (systemPromptStep) {
		steps.push(makeStep({ routeId, order: 2, target: "system_prompt", delivery, approvalRef,
			capabilities, dependsOn: [steps[0].step_id] }));
	}
	const routeStatus = steps.every((step) => step.status === "ready") ? "ready" : "partial";
	return {
		...base,
		disposition: "materialize",
		route_status: routeStatus,
		steps,
		...(routeStatus === "ready" ? { apply_call: {
			name: "task_harness" as const,
			arguments: { action: "apply_route" as const, route_ref: base.route_ref, expected_delivery_hash: deliveryHash },
		} } : {}),
	};
}
