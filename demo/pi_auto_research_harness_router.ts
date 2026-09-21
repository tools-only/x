/** Deterministic Auto-Research delivery -> Pi native harness call compiler. */
import { createHash } from "node:crypto";
import { TASK_TOOL_PROGRAM_STEP_KINDS } from "./pi_task_tool_contract.ts";
import { canonicalTextBody, classifyHarnessChangeTargets, type HarnessRouteTarget } from "./pi_harness_protocol.ts";

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

export type ResearchMethodSpecification = {
	problem: string;
	inputs: string[];
	invariants: string[];
	parameters: string[];
	steps: string[];
	decision_points: string[];
	stop_conditions: string[];
	failure_modes: string[];
	construction_evidence_refs: string[];
	contrast_evidence_refs: string[];
	next_use: string;
	predicted_semantic_result: string;
	falsifier: string;
};

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
	prompt_layer?: "task_policy" | "task_state";
	depends_on_refs?: string[];
	supersedes_refs?: string[];
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
	/** Explicit abstraction required for method lifecycle tracking. */
	method?: ResearchMethodSpecification;
};

function schemaFieldType(inputSchema: Record<string, unknown> | undefined, collection: string, field: string): string {
	if (!inputSchema) return "";
	const topProperties = inputSchema.properties;
	const collectionSchema = inputSchema[collection]
		?? (topProperties && typeof topProperties === "object" && !Array.isArray(topProperties)
			? (topProperties as Record<string, unknown>)[collection] : undefined);
	if (!collectionSchema || typeof collectionSchema !== "object" || Array.isArray(collectionSchema)) return "";
	const itemSchema = (collectionSchema as Record<string, unknown>).items;
	if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) return "";
	const direct = (itemSchema as Record<string, unknown>)[field];
	if (typeof direct === "string") return direct;
	if (direct && typeof direct === "object" && !Array.isArray(direct)) {
		return String((direct as Record<string, unknown>).type ?? "");
	}
	const properties = (itemSchema as Record<string, unknown>).properties;
	if (!properties || typeof properties !== "object" || Array.isArray(properties)) return "";
	const nested = (properties as Record<string, unknown>)[field];
	return nested && typeof nested === "object" && !Array.isArray(nested)
		? String((nested as Record<string, unknown>).type ?? "") : String(nested ?? "");
}

/** Normalize only unambiguous agent-authored dataflow aliases. */
export function normalizeComputationProgram(
	program: Record<string, unknown>,
	inputSchema?: Record<string, unknown>,
): Record<string, unknown> {
	if (!Array.isArray(program.steps)) return program;
	let collection = "";
	const steps = program.steps.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
		const step = raw as Record<string, unknown>;
		if (step.kind !== undefined) {
			const kind = String(step.kind);
			if (kind === "adapter_call" && typeof step.impl === "string"
				&& step.implementation_ref === undefined && step.operation === undefined) {
				return { ...step, implementation_ref: step.impl, impl: undefined };
			}
			if (["select", "map"].includes(kind) && typeof step.field === "string"
				&& step.fields === undefined) {
				return { ...step, fields: [step.field], field: undefined };
			}
			if (kind === "pick") collection = String(step.field ?? collection);
			if (kind === "filter" && typeof step.field === "string"
				&& !["equals", "not_equals", "exists"].some((key) => Object.prototype.hasOwnProperty.call(step, key))
				&& schemaFieldType(inputSchema, collection, step.field) === "boolean") {
				return { ...step, equals: true };
			}
			return step;
		}
		const op = String(step.op ?? "");
		if (op === "pick" && typeof step.path === "string") {
			const match = step.path.match(/^(?:(?:input|\$)\.)?([A-Za-z_][A-Za-z0-9_]*)$/);
			if (match) {
				collection = match[1];
				return { kind: "pick", source: "input", field: match[1] };
			}
		}
		if (op === "pick" && typeof step.source === "string") {
			const match = step.source.match(/^(?:input\.|\$\.)([A-Za-z_][A-Za-z0-9_]*)$/);
			if (match) {
				collection = match[1];
				return { kind: "pick", source: "input", field: match[1] };
			}
		}
		if (op === "filter" && typeof step.predicate === "string") {
			const match = step.predicate.trim().match(/^(?:item\.)?([A-Za-z_][A-Za-z0-9_]*)\s*===\s*true$/);
			if (match) return { kind: "filter", field: match[1], equals: true };
		}
		if (op === "filter" && step.predicate && typeof step.predicate === "object"
			&& !Array.isArray(step.predicate)) {
			const predicate = step.predicate as Record<string, unknown>;
			if (typeof predicate.field === "string" && Object.prototype.hasOwnProperty.call(predicate, "equals")) {
				return { kind: "filter", field: predicate.field, equals: predicate.equals };
			}
		}
		if (op === "map" && typeof step.field === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(step.field)) {
			return { kind: "map", fields: [step.field] };
		}
		if (op === "map" && typeof step.expr === "string") {
			if (["1", "constant(1)"].includes(step.expr.trim())) return { kind: "map", fields: [] };
			const match = step.expr.trim().match(/^item\.([A-Za-z_][A-Za-z0-9_]*)$/);
			if (match) return { kind: "map", fields: [match[1]] };
		}
		if (op === "map" && String(step.transform ?? "").trim() === "1") {
			return { kind: "map", fields: [] };
		}
		if (op === "count") return { kind: "count" };
		return step;
	});
	return { ...program, steps };
}

function validateComputationProgram(program: Record<string, unknown>): void {
	const steps = program.steps;
	if (!Array.isArray(steps) || !steps.length) throw new Error("computation program.steps must be a non-empty array");
	for (const [index, raw] of steps.entries()) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error(`computation program step ${index + 1} must be an object`);
		}
		const step = raw as Record<string, unknown>;
		const kind = String(step.kind ?? "");
		if (!(TASK_TOOL_PROGRAM_STEP_KINDS as readonly string[]).includes(kind)) {
			throw new Error(`computation program step ${index + 1} has unsupported or unnormalized kind: ${kind || "<missing>"}`);
		}
		if (["pick", "filter", "group_by"].includes(kind) && !String(step.field ?? "").trim()) {
			throw new Error(`computation program ${kind} step ${index + 1} requires field`);
		}
		if (kind === "filter"
			&& !["equals", "not_equals", "exists"].some((key) => Object.prototype.hasOwnProperty.call(step, key))) {
			throw new Error(`computation program filter step ${index + 1} requires an explicit predicate`);
		}
		if (["select", "map"].includes(kind)
			&& (!Array.isArray(step.fields) || step.fields.some((field) => typeof field !== "string"))) {
			throw new Error(`computation program ${kind} step ${index + 1} requires string fields`);
		}
		if (kind === "adapter_call" && !String(step.implementation_ref ?? step.operation ?? "").trim()) {
			throw new Error(`computation program adapter_call step ${index + 1} requires implementation_ref`);
		}
	}
}

export type HarnessRouteStep = {
	step_id: string;
	order: number;
	target: "memory" | "skill" | "tool" | "subagent" | "system_prompt";
	native_tool: string;
	native_call: { name: string; arguments: Record<string, unknown> };
	depends_on: string[];
	status: "ready" | "unsupported" | "pending_implementation";
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

type ProgramValueShape = {
	type: "object" | "array" | "string" | "number" | "boolean" | "null" | "unknown";
	properties?: Record<string, ProgramValueShape>;
	items?: ProgramValueShape;
};

function valueShape(schema: unknown): ProgramValueShape {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { type: "unknown" };
	const value = schema as Record<string, unknown>;
	let type = String(value.type ?? "");
	if (!type && value.properties && typeof value.properties === "object") type = "object";
	if (!type && Object.keys(value).some((key) => !["required", "description"].includes(key))) type = "object";
	if (type === "array") return { type: "array", items: valueShape(value.items) };
	if (type === "object") {
		const raw = value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)
			? value.properties as Record<string, unknown>
			: Object.fromEntries(Object.entries(value).filter(([key]) => !["type", "required", "description"].includes(key)));
		return { type: "object", properties: Object.fromEntries(Object.entries(raw).map(([key, item]) => [key,
			typeof item === "string" ? { type: item as ProgramValueShape["type"] } : valueShape(item)])) };
	}
	return ["string", "number", "boolean", "null"].includes(type)
		? { type: type as ProgramValueShape["type"] } : { type: "unknown" };
}

/** Prove that a declarative program's value flow matches the native runtime.
 * Unknown adapter output is kept pending instead of being guessed executable. */
export function assessComputationProgramFeasibility(input: {
	program: Record<string, unknown>;
	inputSchema?: Record<string, unknown>;
	implementationOutputSchemas?: Record<string, unknown>;
}): { status: "ready" | "pending_implementation"; reason?: string } {
	const steps = input.program.steps as Array<Record<string, unknown>>;
	const inputShape = valueShape(input.inputSchema ?? { type: "object" });
	let current = inputShape;
	const pending = (index: number, reason: string) => ({
		status: "pending_implementation" as const,
		reason: `program step ${index + 1} cannot be proved executable: ${reason}`,
	});
	for (const [index, step] of steps.entries()) {
		const kind = String(step.kind ?? "");
		const source = step.source === "input" ? inputShape : current;
		if (kind === "adapter_call") {
			const ref = String(step.implementation_ref ?? step.operation ?? "");
			const schema = input.implementationOutputSchemas?.[ref];
			if (!schema) return pending(index, `adapter output schema is not declared for ${ref}`);
			current = valueShape(schema); continue;
		}
		if (kind === "select") {
			if (source.type !== "object") return pending(index, `select requires object input, got ${source.type}`);
			const fields = step.fields as string[];
			const missing = fields.filter((field) => !source.properties?.[field]);
			if (missing.length) return pending(index, `fields are absent from the declared input: ${missing.join(", ")}`);
			current = { type: "object", properties: Object.fromEntries(fields.map((field) => [field, source.properties![field]])) };
			continue;
		}
		if (kind === "pick") {
			if (source.type !== "object") return pending(index, `pick requires object input, got ${source.type}`);
			const field = String(step.field ?? "");
			if (!source.properties?.[field]) return pending(index, `field is absent from the declared input: ${field}`);
			current = source.properties[field]; continue;
		}
		if (["filter", "map", "group_by", "count"].includes(kind)) {
			if (source.type !== "array") return pending(index, `${kind} requires array input, got ${source.type}`);
			if (["filter", "group_by"].includes(kind)) {
				const field = String(step.field ?? "");
				if (source.items?.type !== "object" || !source.items.properties?.[field]) {
					return pending(index, `${kind} field is absent from declared array items: ${field}`);
				}
			}
			if (kind === "count") current = { type: "number" };
			else if (kind === "map" || kind === "group_by") current = { type: "array", items: { type: "object" } };
			else current = source;
			continue;
		}
		if (kind === "diff" || kind === "summarize" || kind === "emit_observation") { current = { type: "object" }; continue; }
		if (kind === "assert") {
			const field = String(step.field ?? "");
			if (field && (source.type !== "object" || !source.properties?.[field])) {
				return pending(index, `assert field is absent from the declared input: ${field}`);
			}
			if (!field && step.truthy !== true) return pending(index, "assert requires field+equals or truthy=true");
		}
	}
	return { status: "ready" };
}

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

export function normalizeMethodSpecification(value: unknown): ResearchMethodSpecification | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("delivery.method must be an object");
	}
	const method = value as Record<string, unknown>;
	const requiredStrings = ["problem", "next_use", "predicted_semantic_result", "falsifier"];
	for (const field of requiredStrings) if (!String(method[field] ?? "").trim()) {
		throw new Error(`delivery.method.${field} is required`);
	}
	const list = (field: string, minimum = 0) => {
		const values = Array.isArray(method[field])
			? [...new Set((method[field] as unknown[]).map(String).map((item) => item.trim()).filter(Boolean))] : [];
		if (values.length < minimum) throw new Error(`delivery.method.${field} requires at least ${minimum} item(s)`);
		return values;
	};
	return {
		problem: String(method.problem).trim(),
		inputs: list("inputs", 1),
		invariants: list("invariants"),
		parameters: list("parameters"),
		steps: list("steps", 1),
		decision_points: list("decision_points"),
		stop_conditions: list("stop_conditions", 1),
		failure_modes: list("failure_modes"),
		construction_evidence_refs: list("construction_evidence_refs", 1),
		contrast_evidence_refs: list("contrast_evidence_refs"),
		next_use: String(method.next_use).trim(),
		predicted_semantic_result: String(method.predicted_semantic_result).trim(),
		falsifier: String(method.falsifier).trim(),
	};
}

export function harnessDeliveryHash(delivery: HarnessDelivery): string {
	return createHash("sha256").update(JSON.stringify(stableValue(delivery))).digest("hex");
}

export function normalizeHarnessDelivery(input: unknown): HarnessDelivery {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("delivery must be an object");
	const value = input as Record<string, any>;
	if (value.format !== "auto-research-harness-delivery-v1") throw new Error("unsupported harness delivery format");
	if (!HARNESS_SEMANTIC_KINDS.includes(value.semantic_kind)) throw new Error(`unknown semantic_kind: ${String(value.semantic_kind)}`);
	const requiredStrings = ["delivery_id", "name", "summary", "trigger", "expected_effect", "reconsider_when"];
	for (const field of requiredStrings) if (!String(value[field] ?? "").trim()) throw new Error(`delivery.${field} is required`);
	const content = canonicalTextBody(value.content, "delivery.content");
	if (!content) throw new Error("delivery.content is required");
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
	// Correct only the unambiguous category-copy error.  This keeps the durable
	// schema strict while avoiding loss of an otherwise complete computation
	// candidate at the model/tool boundary.
	if (value.reasoning === "pure_computation" && value.execution === "pure_computation") {
		value.reasoning = "none";
	}
	if (!["none", "bounded_judgment", "open_ended"].includes(value.reasoning)) throw new Error(`delivery.reasoning is invalid: ${String(value.reasoning)}`);
	if (!["text", "pure_computation", "adapter_operation", "model_delegation"].includes(value.execution)) throw new Error(`delivery.execution is invalid: ${String(value.execution)}`);
	if (!["on_demand", "always"].includes(value.context_visibility)) throw new Error("delivery.context_visibility is invalid");
	if (value.prompt_channel !== undefined && !["system_prompt", "task_prompt"].includes(value.prompt_channel)) {
		throw new Error("delivery.prompt_channel is invalid");
	}
	const activation = normalizeActivation(value.activation);
	const systemPromptBasis = normalizeSystemPromptBasis(value.system_prompt_basis);
	const method = normalizeMethodSpecification(value.method);
	const declaredBasisRefs = Array.isArray(value.basis_refs)
		? [...new Set(value.basis_refs.map(String).map((item) => item.trim()).filter(Boolean))]
		: [];
	// Method evidence fields are a more specific partition of the delivery's
	// own evidence. Their union into basis_refs is lossless and introduces no
	// new claim or evidence; it repairs only a missing redundant index entry.
	const basisRefs = [...new Set([
		...declaredBasisRefs,
		...(method ? [...method.construction_evidence_refs, ...method.contrast_evidence_refs] : []),
	])];
	const systemPromptRequested = value.prompt_channel === "system_prompt";
	const taskPromptRequested = value.prompt_channel === "task_prompt";
	if (value.prompt_layer !== undefined && (!["task_policy", "task_state"].includes(value.prompt_layer)
		|| !["fact", "plan"].includes(value.semantic_kind) || value.context_visibility !== "always" || systemPromptRequested)) {
		throw new Error("prompt_layer requires always-visible task_prompt memory semantics");
	}
	for (const field of ["depends_on_refs", "supersedes_refs"]) if (value[field] !== undefined) {
		if (!["fact", "plan", "procedure"].includes(value.semantic_kind) || !Array.isArray(value[field])
			|| value[field].some((ref: unknown) => typeof ref !== "string" || !/^(memory|skill|system_prompt):[^@]+@v[1-9]\d*$/.test(ref))) {
			throw new Error(`${field} requires exact memory/skill/system_prompt refs on fact, plan or procedure deliveries`);
		}
	}
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
		content,
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
		...(method ? { method } : {}),
		tools: Array.isArray(value.tools) ? [...new Set(value.tools.map(String).map((item) => item.trim()).filter(Boolean))] : undefined,
	} as HarnessDelivery;
	if (delivery.semantic_kind === "computation" && delivery.program) {
		delivery.program = normalizeComputationProgram(delivery.program, delivery.input_schema);
		validateComputationProgram(delivery.program);
		const steps = (delivery.program as Record<string, unknown>).steps as Array<Record<string, unknown>>;
		if (delivery.execution === "pure_computation"
			&& steps.some((step) => step.kind === "adapter_call")) {
			delivery.execution = "adapter_operation";
		}
	}
	if (method && !["procedure", "computation", "plan", "role"].includes(delivery.semantic_kind)) {
		throw new Error("delivery.method is only valid for procedure, computation, plan, or role deliveries");
	}
	if (delivery.semantic_kind === "computation" && !delivery.program && !delivery.implementation_ref) {
		throw new Error("computation delivery requires program or implementation_ref");
	}
	if (delivery.semantic_kind === "computation" && !["pure_computation", "adapter_operation"].includes(delivery.execution)) {
		throw new Error("computation delivery requires pure_computation or adapter_operation execution");
	}
	if (delivery.semantic_kind === "computation" && delivery.program) {
		const steps = (delivery.program as Record<string, unknown>).steps as Array<Record<string, unknown>>;
		const kinds = steps.map((step) => step && typeof step === "object" && !Array.isArray(step)
			? String((step as Record<string, unknown>).kind ?? "") : "");
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

function routeTarget(delivery: HarnessDelivery): HarnessRouteTarget {
	// The shared protocol validates both the base semantic target and any
	// system-prompt overlay. The compiler still emits the base target first so
	// the overlay remains ordered after its supporting resource.
	const targets = classifyHarnessChangeTargets(delivery);
	const target = targets[0];
	const expected = BASE_ROUTE[delivery.semantic_kind];
	// A system-prompt delivery has a durable memory step plus an explicit
	// system-prompt projection step. Keep the route's base target as memory so
	// the dependency ordering remains visible in the compiled plan.
	if (target !== expected && !(target === "system_prompt" && expected === "memory")) {
		throw new Error(`harness protocol/router target mismatch: ${target} != ${expected}`);
	}
	return expected;
}

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
		...(delivery.depends_on_refs !== undefined ? { depends_on_refs: delivery.depends_on_refs } : {}),
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
		...(delivery.depends_on_refs !== undefined ? { depends_on_refs: delivery.depends_on_refs } : {}),
		...(delivery.supersedes_refs !== undefined ? { supersedes_refs: delivery.supersedes_refs } : {}),
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
				...(delivery.prompt_layer ? { layer: delivery.prompt_layer } : {}),
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
	implementationOutputSchemas?: Record<string, unknown>;
}): HarnessRoutePlan {
	const delivery = normalizeHarnessDelivery(input.delivery);
	const deliveryHash = harnessDeliveryHash(delivery);
	const routeId = `${input.runId}:route-${delivery.delivery_id}`;
	const approvalRef = `proposal:${input.approvalId}@v${input.approvalVersion}`;
	const baseTarget = routeTarget(delivery);
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
	if (delivery.semantic_kind === "computation" && delivery.program) {
		const feasibility = assessComputationProgramFeasibility({
			program: delivery.program, inputSchema: delivery.input_schema,
			implementationOutputSchemas: input.implementationOutputSchemas,
		});
		if (feasibility.status !== "ready") {
			const step = makeStep({ routeId, order: 1, target: "tool", delivery, approvalRef,
				capabilities: new Set(input.capabilities) });
			return { ...base, disposition: "materialize", route_status: "partial", steps: [{
				...step, status: "pending_implementation", reason: feasibility.reason,
			}] };
		}
	}
	const capabilities = new Set(input.capabilities);
	// A one-off role is still the native `subagent` component. Invocation via
	// delegate_task is an operation on that component, not another component.
	const actualBaseTarget = baseTarget;
	const steps = [makeStep({ routeId, order: 1, target: actualBaseTarget, delivery, approvalRef, capabilities })];
	const systemPromptStep = classifyHarnessChangeTargets(delivery).includes("system_prompt")
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
