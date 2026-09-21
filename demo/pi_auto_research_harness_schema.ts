/** TypeBox boundary schema for the canonical Auto-Research harness delivery. */
import { Type } from "typebox";
import { HARNESS_SEMANTIC_KINDS } from "./pi_auto_research_harness_router.ts";

export const ResearchMethodSpecificationSchema = Type.Object({
	problem: Type.String({ minLength: 1 }),
	inputs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	invariants: Type.Array(Type.String({ minLength: 1 })),
	parameters: Type.Array(Type.String({ minLength: 1 })),
	steps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	decision_points: Type.Array(Type.String({ minLength: 1 })),
	stop_conditions: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	failure_modes: Type.Array(Type.String({ minLength: 1 })),
	construction_evidence_refs: Type.Array(Type.String({ minLength: 1 }), {
		description: "May be empty for an explicitly untested method candidate; empty evidence never implies support.",
	}),
	contrast_evidence_refs: Type.Array(Type.String({ minLength: 1 })),
	next_use: Type.String({ minLength: 1 }),
	predicted_semantic_result: Type.String({ minLength: 1 }),
	falsifier: Type.String({ minLength: 1 }),
}, { description: "A reusable research method. It is versioned independently from any proposed Harness component." });

export const ResearchMethodCandidateSchema = Type.Object({
	candidate_ref: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	semantic_kind: Type.Union([
		Type.Literal("procedure"), Type.Literal("computation"),
		Type.Literal("plan"), Type.Literal("role"),
	]),
	summary: Type.String({ minLength: 1 }),
	basis_refs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	method: ResearchMethodSpecificationSchema,
	proposed_delivery_id: Type.Optional(Type.String({ minLength: 1 })),
});

export const ResearchFindingAssessmentSchema = Type.Object({
	target_ref: Type.String({ minLength: 1 }),
	dimension: Type.Union([
		Type.Literal("explanation"), Type.Literal("method_correctness"), Type.Literal("method_utility"),
	]),
	verdict: Type.Union([
		Type.Literal("supported"), Type.Literal("contradicted"), Type.Literal("inconclusive"),
	]),
	scope: Type.String({ minLength: 1 }),
	evidence_kind: Type.Union([
		Type.Literal("historical_observation"), Type.Literal("local_execution"),
		Type.Literal("new_environment_transition"),
	]),
	effect_assessment_ref: Type.Optional(Type.String({ minLength: 1 })),
});

export const HarnessDeliverySchema = Type.Object({
	format: Type.Literal("auto-research-harness-delivery-v1"),
	delivery_id: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$" }),
	semantic_kind: Type.Union(HARNESS_SEMANTIC_KINDS.map((kind) => Type.Literal(kind))),
	operation: Type.Union([
		Type.Literal("create"), Type.Literal("update"), Type.Literal("reuse"), Type.Literal("retire"),
	]),
	name: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$" }),
	summary: Type.String(),
	content: Type.String(),
	validity: Type.Optional(Type.Object({
		scope: Type.Union([Type.Literal("task"), Type.Literal("episode"), Type.Literal("level"), Type.Literal("state")]),
		task_ref: Type.String(), instance_ref: Type.String(),
	})),
	context_recipe: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	description: Type.Optional(Type.String()),
	scope: Type.Object({
		kind: Type.Union([Type.Literal("current_step"), Type.Literal("condition"), Type.Literal("task_wide")]),
		statement: Type.String(),
	}),
	trigger: Type.String(),
	exclusions: Type.Array(Type.String()),
	stability: Type.Union([Type.Literal("transient"), Type.Literal("conditional"), Type.Literal("stable_in_scope")]),
	reuse: Type.Union([Type.Literal("one_off"), Type.Literal("expected_reuse")]),
	// `pure_computation` is accepted only as a narrow input alias for older
	// model-authored deliveries that copied the execution value into this
	// field. normalizeHarnessDelivery canonicalizes it to `none` before any
	// candidate is persisted or routed.
	reasoning: Type.Union([
		Type.Literal("none"), Type.Literal("bounded_judgment"), Type.Literal("open_ended"),
		Type.Literal("pure_computation"),
	]),
	execution: Type.Union([
		Type.Literal("text"), Type.Literal("pure_computation"),
		Type.Literal("adapter_operation"), Type.Literal("model_delegation"),
	]),
	context_visibility: Type.Union([Type.Literal("on_demand"), Type.Literal("always")]),
	system_prompt_basis: Type.Optional(Type.Object({
		source: Type.Union([
			Type.Literal("explicit_task_contract"),
			Type.Literal("validated_environment_invariant"),
		]),
		evidence_refs: Type.Array(Type.String()),
	})),
	prompt_channel: Type.Optional(Type.Union([Type.Literal("system_prompt"), Type.Literal("task_prompt")])),
	activation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	prompt_text: Type.Optional(Type.String()),
	prompt_layer: Type.Optional(Type.Union([Type.Literal("task_policy"), Type.Literal("task_state")])),
	depends_on_refs: Type.Optional(Type.Array(Type.String())),
	supersedes_refs: Type.Optional(Type.Array(Type.String())),
	prompt_operation: Type.Optional(Type.Union([
		Type.Literal("create"), Type.Literal("update"), Type.Literal("reuse"), Type.Literal("retire"),
	])),
	prompt_target_version: Type.Optional(Type.Integer({ minimum: 1 })),
	target_version: Type.Optional(Type.Integer({ minimum: 1 })),
	input_schema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	implementation_ref: Type.Optional(Type.String()),
	program: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	tools: Type.Optional(Type.Array(Type.String())),
	basis_refs: Type.Array(Type.String()),
	expected_effect: Type.String(),
	reconsider_when: Type.String(),
	method: Type.Optional(ResearchMethodSpecificationSchema),
});
