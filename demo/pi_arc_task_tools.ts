/** Adapter-bounded task-local tools for public ARC-AGI-3 state. */

import type { TaskToolAdapter } from "./pi_task_local_tools.ts";

function publicState(value: Record<string, unknown>): Record<string, unknown> {
	// Keep task tools bounded to fields and actions already exposed by the
	// official ARC adapter. Hidden evaluator data and raw bridge internals never
	// become part of the agent-created tool surface.
	const allowed = [
		"game_id", "state", "levels_completed", "win_levels", "available_actions",
		"agent_available_actions", "action_budget", "guid", "full_reset",
	];
	return Object.fromEntries(allowed
		.filter((key) => Object.prototype.hasOwnProperty.call(value, key))
		.map((key) => [key, value[key]]));
}

export function createArcTaskToolAdapter(
	getState: () => Promise<Record<string, unknown>>,
): TaskToolAdapter {
	return {
		adapterId: "arc_agi_3",
		permission: "arc_adapter_bounded",
		// The canonical refs are used in new programs. The short aliases are
		// accepted because the native ARC tools are disclosed as arc_state and
		// arc_action; this keeps agent-authored programs composable with the
		// vocabulary already present in the same context.
		allowedImplementations: [
			"arc.public_state", "arc.action_sequence", "arc_state", "arc_action_sequence",
		],
		execute: async (implementationRef, input) => {
			if (implementationRef === "arc.public_state" || implementationRef === "arc_state") {
				const state = publicState(await getState());
				const requested = typeof input.fields === "string"
					? input.fields.split(",").map((field) => field.trim()).filter(Boolean)
					: [];
				const result = requested.length
					? Object.fromEntries(requested
						.filter((field) => Object.prototype.hasOwnProperty.call(state, field))
						.map((field) => [field, state[field]]))
					: state;
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					details: { representation: "arc_public_state_projection", fields: Object.keys(result) },
				};
			}
			if (implementationRef !== "arc.action_sequence" && implementationRef !== "arc_action_sequence") {
				throw new Error(`unsupported ARC task tool implementation: ${implementationRef}`);
			}
			const actions = Array.isArray(input.actions)
				? input.actions.map(String).map((action) => action.trim()).filter(Boolean)
				: [];
			if (!actions.length) {
				throw new Error("arc.action_sequence requires at least one action");
			}
			const initial = publicState(await getState());
			const available = new Set(
				(Array.isArray(initial.agent_available_actions) ? initial.agent_available_actions :
					Array.isArray(initial.available_actions) ? initial.available_actions : []).map(String),
			);
			const unknown = actions.filter((action) => !available.has(action));
			if (unknown.length) throw new Error(`ARC actions are not currently available: ${unknown.join(", ")}`);
			// A task-local program may construct a bounded action plan, but it may
			// never execute live environment actions. The parent agent must submit
			// one action through the native arc_action boundary, observe its result,
			// and decide whether to continue. This prevents a model-generated tool
			// batch from advancing an irreversible environment several times before
			// the parent sees an observation.
			return {
				content: [{ type: "text", text: JSON.stringify({
					actions,
					requested_actions: actions,
					status: "planned",
					boundary: "parent_arc_action",
				}) }],
				details: {
					representation: "arc_bounded_action_plan",
					attempted_actions: 0,
					requested_actions: actions.length,
					live_execution: false,
					boundary: "parent_arc_action",
				},
			};
		},
	};
}
