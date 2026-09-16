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
	performAction?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>,
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
			if ((implementationRef !== "arc.action_sequence" && implementationRef !== "arc_action_sequence") || !performAction) {
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
			const results: Record<string, unknown>[] = [];
			for (const action of actions) {
				const value = await performAction({ action });
				const transition = value.public_transition as Record<string, unknown> | undefined;
				const delta = value.observation_delta as Record<string, unknown> | undefined;
				results.push({
					action,
					state: value.state,
					levels_completed: value.levels_completed,
					changed_cells: delta?.changed_cells,
					level_changed: transition?.level_changed,
				});
				if (value.state === "GAME_OVER" || value.state === "WIN") break;
			}
			const finalState = publicState(await getState());
			const executedActions = results.map((result) => String(result.action));
			return {
				content: [{ type: "text", text: JSON.stringify({
					actions: executedActions,
					requested_actions: actions,
					results,
					final_state: finalState,
				}) }],
				details: {
					representation: "arc_bounded_action_sequence",
					attempted_actions: executedActions.length,
					requested_actions: actions.length,
					results,
				},
			};
		},
	};
}
