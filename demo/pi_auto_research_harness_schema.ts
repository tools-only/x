/** TypeBox boundary schema for the canonical Auto-Research harness delivery. */
import { Type } from "typebox";
import { HARNESS_SEMANTIC_KINDS } from "./pi_auto_research_harness_router.ts";

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
	description: Type.Optional(Type.String()),
	scope: Type.Object({
		kind: Type.Union([Type.Literal("current_step"), Type.Literal("condition"), Type.Literal("task_wide")]),
		statement: Type.String(),
	}),
	trigger: Type.String(),
	exclusions: Type.Array(Type.String()),
	stability: Type.Union([Type.Literal("transient"), Type.Literal("conditional"), Type.Literal("stable_in_scope")]),
	reuse: Type.Union([Type.Literal("one_off"), Type.Literal("expected_reuse")]),
	reasoning: Type.Union([Type.Literal("none"), Type.Literal("bounded_judgment"), Type.Literal("open_ended")]),
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
	prompt_operation: Type.Optional(Type.Union([
		Type.Literal("create"), Type.Literal("update"), Type.Literal("reuse"), Type.Literal("retire"),
	])),
	prompt_target_version: Type.Optional(Type.Integer({ minimum: 1 })),
	target_version: Type.Optional(Type.Integer({ minimum: 1 })),
	input_schema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	implementation_ref: Type.Optional(Type.String()),
	program: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	tools: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
	basis_refs: Type.Array(Type.String()),
	expected_effect: Type.String(),
	reconsider_when: Type.String(),
});
