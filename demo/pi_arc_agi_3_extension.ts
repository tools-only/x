/** ARC-AGI-3 environment adapter with a task-local self-harness entry. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import externalBenchmarkResearch from "./pi_external_benchmark_research.ts";
import { ARC_SYSTEM_PROMPT, renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { installArcTaskSubagents } from "./pi_arc_task_subagents.ts";
import { installArcTrajectoryResource } from "./pi_arc_trajectory_resource.ts";
import { createArcTaskToolAdapter } from "./pi_arc_task_tools.ts";
import { bridge } from "./pi_arc_bridge_client.ts";

function durableSelfHarnessPreludeCompleted(): boolean {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
	if (!root) return false;
	const path = join(root, "task-harness-entry-events.jsonl");
	if (!existsSync(path)) return false;
	try {
		return readFileSync(path, "utf8").split(/\r?\n/).some((line) => {
			try { return JSON.parse(line)?.event === "self_harness_started"; }
			catch { return false; }
		});
	} catch {
		return false;
	}
}

// The rendered text is the model-facing frame representation. Keep raw frame
// matrices in the bridge/artifact log, but do not duplicate them in Pi tool
// details: Pi includes details in later model requests and the duplicate would
// grow the context once per action. These are the public fields needed for
// execution signals and task-local adapter programs.
function publicToolDetails(value: Record<string, unknown>): Record<string, unknown> {
	const fields = [
		"game_id", "state", "levels_completed", "win_levels", "available_actions",
		"agent_available_actions", "action_budget", "guid", "full_reset",
		"observation_delta", "public_transition", "autoresearch_signals",
	];
	const details = Object.fromEntries(fields
		.filter((field) => Object.prototype.hasOwnProperty.call(value, field))
		.map((field) => [field, value[field]]));
	// Exact changed cells are already losslessly persisted by the bridge and
	// execution-observation artifact. Do not duplicate them in Pi tool details,
	// which are carried into every later provider request.
	const delta = details.observation_delta as Record<string, unknown> | undefined;
	if (delta && Array.isArray(delta.cells)) {
		details.observation_delta = {
			...delta,
			cells: undefined,
			cells_in_artifact: true,
		};
		delete (details.observation_delta as Record<string, unknown>).cells;
	}
	return details;
}

function compactDeltaCells(delta: Record<string, unknown>): string {
	const cells = Array.isArray(delta.cells) ? delta.cells as Array<Record<string, unknown>> : [];
	if (!cells.length) return "[]";
	const byRow = new Map<number, Array<[number, string]>>();
	for (const cell of cells) {
		const row = Number(cell.row), col = Number(cell.col);
		if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
		const list = byRow.get(row) ?? [];
		list.push([col, String(cell.value)]);
		byRow.set(row, list);
	}
	return JSON.stringify([...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([row, entries]) => {
		entries.sort((a, b) => a[0] - b[0]);
		const runs: string[] = [];
		let start = entries[0]?.[0], end = start, value = entries[0]?.[1];
		for (const [col, nextValue] of entries.slice(1)) {
			if (col === end! + 1 && nextValue === value) { end = col; continue; }
			runs.push(start === end ? `${start}=${value}` : `${start}-${end}=${value}`);
			start = end = col; value = nextValue;
		}
		if (start !== undefined) runs.push(start === end ? `${start}=${value}` : `${start}-${end}=${value}`);
		return { row, runs };
	}));
}

type ChangedComponent = {
	changed_cells: number;
	bbox: { top: number; left: number; bottom: number; right: number } | null;
	shape_signature: string;
	centroid: { row: number; col: number } | null;
	// Assigned only after comparing this component with prior effects in the
	// same state epoch. It is deliberately causal-neutral: it says whether
	// the geometry recurred across different actions, not what the object is.
	role?: "cross_action_common_candidate" | "action_specific_candidate";
};

type EffectRecord = {
	state_epoch: number;
	changed_cells: number | null;
	bbox: unknown;
	components: ChangedComponent[];
	classification: string[];
	last_action_index: number;
};

function changedComponents(delta: Record<string, unknown> | undefined): ChangedComponent[] {
	const raw = Array.isArray(delta?.cells) ? delta?.cells as Array<Record<string, unknown>> : [];
	const cells = raw
		.map((cell) => ({ row: Number(cell.row), col: Number(cell.col), value: String(cell.value) }))
		.filter((cell) => Number.isInteger(cell.row) && Number.isInteger(cell.col));
	const byCoordinate = new Map(cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
	const visited = new Set<string>();
	const components: ChangedComponent[] = [];
	for (const seed of cells) {
		const seedKey = `${seed.row}:${seed.col}`;
		if (visited.has(seedKey)) continue;
		const queue = [seed];
		visited.add(seedKey);
		const component: typeof cells = [];
		while (queue.length) {
			const current = queue.shift()!;
			component.push(current);
			for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
				const neighbor = byCoordinate.get(`${current.row + dr}:${current.col + dc}`);
				if (!neighbor) continue;
				const key = `${neighbor.row}:${neighbor.col}`;
				if (!visited.has(key)) { visited.add(key); queue.push(neighbor); }
			}
		}
		const rows = component.map((cell) => cell.row), cols = component.map((cell) => cell.col);
		const top = Math.min(...rows), left = Math.min(...cols), bottom = Math.max(...rows), right = Math.max(...cols);
		const values = component.map((cell) => cell.value).sort();
		components.push({
			changed_cells: component.length,
			bbox: { top, left, bottom, right },
			shape_signature: JSON.stringify({
				cells: component.length, height: bottom - top + 1, width: right - left + 1,
				values,
			}),
			centroid: {
				row: component.reduce((sum, cell) => sum + cell.row, 0) / component.length,
				col: component.reduce((sum, cell) => sum + cell.col, 0) / component.length,
			},
		});
	}
	return components;
}

function effectSignature(effect: EffectRecord): string {
	return JSON.stringify({
		state_epoch: effect.state_epoch,
		changed_cells: effect.changed_cells,
		bbox: effect.bbox,
		components: effect.components.map((component) => ({
			changed_cells: component.changed_cells,
			shape_signature: component.shape_signature,
		})),
	});
}

function isRenderedArcFrame(message: Record<string, any>): boolean {
	if (message.role !== "toolResult" || !Array.isArray(message.content)) return false;
	return message.content.some((item: any) =>
		item?.type === "text" && String(item.text ?? "").includes("Lossless coordinate runs"));
}

function compactHistoricalArcFrames(messages: any[]): any[] {
	let latestFrameIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isRenderedArcFrame(messages[index])) {
			latestFrameIndex = index;
			break;
		}
	}
	const actionResults = messages
		.map((message, index) => ({ message, index }))
		.filter(({ message }) => message.role === "toolResult" && Array.isArray(message.content)
			&& message.content.some((item: any) => item?.type === "text" && String(item.text ?? "").includes("Current transition:")));
	const retainedActionResults = new Set(actionResults.map(({ index }) => index));
	// Once an action result exists after the last full frame, the frame is no
	// longer the current decision boundary: the action result contains the
	// authoritative transition and lossless delta.  Retaining the old 64x64
	// frame here makes every recovery prompt replay a large immutable payload,
	// which is especially harmful after a provider stops with `length`.
	const hasActionAfterLatestFrame = latestFrameIndex >= 0
		&& actionResults.some(({ index }) => index > latestFrameIndex);
	return messages.map((message, index) => {
		if (actionResults.some((item) => item.index === index) && !retainedActionResults.has(index)) {
			return {
				...message,
				content: [{ type: "text", text: "[Historical ARC action result omitted; authoritative transition and delta are retained in bridge-events.jsonl and execution-observations.jsonl. Use the latest action result or arc_state(current).]" }],
			};
		}
		if (index === latestFrameIndex && !hasActionAfterLatestFrame) return message;
		if (!isRenderedArcFrame(message)) return message;
		return {
			...message,
			content: [{
				type: "text",
				text: "[Historical ARC frame omitted from model context; the complete result is retained in execution-observations.jsonl and bridge-events.jsonl and is recoverable by its canonical observation ID.]",
			}],
		};
	});
}

export default function arcAgi3Extension(pi: ExtensionAPI) {
	const treatment = process.env.PI_AUTORESEARCH_VARIANT !== "control";
	// The real ARC gate requires a one-time self-harness prelude before the
	// first observation/action. Later cycles use the projected portfolio and
	// checkpoint without repeating kickoff.
	const selfHarnessPreludeRequired = treatment && process.env.PI_ARC_EXECUTION_GATE === "enabled";
	let selfHarnessPreludeComplete = !selfHarnessPreludeRequired || durableSelfHarnessPreludeCompleted();
	const recentActions: Array<Record<string, unknown>> = [];
	const actionEffects = new Map<string, { attempts: number; distinct_effects: EffectRecord[] }>();
	let actionCount = 0;
	let stateEpoch = 0;
	let lastFullFrameActionCount = -1;
	// ARC tool content contains the latest lossless frame, while every prior
	// frame is already durable in the bridge and execution-observation logs.
	// Keep only the latest rendered frame in future model requests so the
	// benchmark's observation history cannot crowd out task-local self-harness
	// decisions. This is context representation, not resource creation.
	pi.on("context", (event) => ({ messages: compactHistoricalArcFrames(event.messages) }));
	pi.registerTool({
		name: "arc_state", label: "ARC state",
		description: "Read the current native ARC-AGI-3 frame, state, available actions, and remaining action budget.",
		// The configured OpenAI-compatible gateway rejects an empty object schema
		// (it serializes it as null). Keep one harmless required field, matching
		// the existing project adapters' gateway-compatible tool contracts.
		parameters: Type.Object({ request: Type.String() }),
		async execute(_toolCallId, params) {
			if (!selfHarnessPreludeComplete) {
				return {
					content: [{ type: "text", text: "SELF_HARNESS_PRELUDE_REQUIRED: call task_harness(action='start') before reading ARC state." }],
					details: { format: "arc-self-harness-prelude-v1", admitted: false, next: "task_harness" },
					isError: true,
				};
			}
			const value = await bridge("/state");
			const request = String((params as Record<string, unknown> | undefined)?.request ?? "current");
			const requestedFull = ["current", "full", "frame"].includes(request);
			// A full frame is expensive and immutable until an action occurs. Make
			// repeated reads idempotent: the first request after each action may
			// obtain the lossless frame, while a duplicate request receives the
			// compact state card. This preserves an explicit recovery path without
			// allowing a read loop to inflate every subsequent provider context.
			const full = request === "full" || (requestedFull && actionCount > lastFullFrameActionCount);
			if (full) lastFullFrameActionCount = actionCount;
			// A compact response to a repeated full request is not new evidence
			// and must not satisfy the reconstruction prerequisite.
			const repeatedFullRequest = requestedFull && !full;
			const text = full
				? renderArcLatestFrameRuns(value)
				: `ARC state summary: state=${String(value.state ?? "UNKNOWN")}, levels_completed=${String(value.levels_completed ?? 0)}, available_actions=${JSON.stringify(value.agent_available_actions ?? value.available_actions ?? [])}, action_budget=${JSON.stringify(value.action_budget ?? {})}. ${repeatedFullRequest ? "This frame version was previously supplied. request='full' retrieves it again if the earlier content is no longer in context." : "This response is metadata only. request='full' retrieves the complete current frame."}`;
			return { content: [{ type: "text", text }], details: { ...publicToolDetails(value),
				frame_returned: full, frame_version: actionCount, full_frame_request: { request: "full" } } };
		},
	});
	pi.registerTool({
		name: "arc_action", label: "ARC action",
		description: "Submit exactly one currently available native ARC action. Complex actions require x/y coordinates in 0..63.",
		parameters: Type.Object({
			action: Type.String(),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			reasoning: Type.Optional(Type.String()),
			decision: Type.Optional(Type.Object({
				hypothesis_id: Type.Optional(Type.String()),
				hypothesis_version: Type.Optional(Type.Integer({ minimum: 1 })),
				subgoal: Type.Optional(Type.String()),
				hypothesis: Type.Optional(Type.String()),
				prediction: Type.Optional(Type.String()),
				falsifier: Type.Optional(Type.String()),
				next_step: Type.Optional(Type.String()),
				decision_refs: Type.Optional(Type.Array(Type.String())),
				validation_window: Type.Optional(Type.Object({
					actions: Type.Integer({ minimum: 1 }),
					replace: Type.Optional(Type.Boolean()),
					expected: Type.Optional(Type.String()),
					on_expiry: Type.Optional(Type.Union([
						Type.Literal("falsify"), Type.Literal("inconclusive"),
					])),
				})),
			})),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			if (!selfHarnessPreludeComplete) {
				return {
					content: [{ type: "text", text: "SELF_HARNESS_PRELUDE_REQUIRED: call task_harness(action='start') before submitting an ARC action." }],
					details: { format: "arc-self-harness-prelude-v1", admitted: false, next: "task_harness" },
					isError: true,
				};
			}
			// Decision metadata is for the task checkpoint only. Never forward it
			// to the official ARC action parser, which accepts only action data.
			const { decision: decisionCapsule, ...actionPayload } = params as Record<string, unknown>;
			const value = await bridge("/action", actionPayload);
			actionCount += 1;
			const delta = value.observation_delta as Record<string, unknown> | undefined;
			const transition = value.public_transition as Record<string, unknown> | undefined;
			const budget = value.action_budget as Record<string, unknown> | undefined;
			const actions = value.agent_available_actions ?? value.available_actions ?? [];
			const totalUsed = Number(budget?.total_used ?? 0);
			const totalMaximum = Number(budget?.total_maximum ?? 0);
			const budgetExhausted = totalMaximum > 0 && totalUsed >= totalMaximum;
			const actionName = String((params as Record<string, unknown>).action ?? "UNKNOWN");
			const deltaText = delta
				? `Observation delta (deterministic): changed_cells=${String(delta.changed_cells ?? 0)}, bbox=${JSON.stringify(delta.bbox ?? null)}, row_runs=${compactDeltaCells(delta)}`
				: "Observation delta unavailable for this action.";
			const transitionCard = `Current transition: state=${String(value.state ?? "UNKNOWN")}, levels_completed=${String(value.levels_completed ?? 0)}, action_budget=${JSON.stringify(budget ?? {})}, available_actions=${JSON.stringify(actions)}, public_transition=${JSON.stringify(transition ?? {})}`;
			recentActions.push({
				action: actionName,
				level: value.levels_completed ?? 0,
				changed_cells: delta?.changed_cells ?? null,
				bbox: delta?.bbox ?? null,
				level_changed: transition?.level_changed ?? false,
			});
			if (actionName === "RESET") stateEpoch += 1;
			if (transition?.level_changed === true) stateEpoch += 1;
			const components = changedComponents(delta);
			const priorEffects = [...actionEffects.entries()]
				.filter(([name]) => name !== actionName)
				.flatMap(([name, record]) => record.distinct_effects.map((effect) => ({ actionName: name, effect })))
				.filter(({ effect }) => effect.state_epoch === stateEpoch);
			const classifiedComponents = components.map((component) => {
				const matchingActionNames = new Set<string>([actionName]);
				for (const { actionName: priorActionName, effect } of priorEffects) {
					if (effect.components.some((prior) => prior.shape_signature === component.shape_signature)) {
						matchingActionNames.add(priorActionName);
					}
				}
				return {
					...component,
					role: matchingActionNames.size >= 2
						? "cross_action_common_candidate" as const
						: "action_specific_candidate" as const,
				};
			});
			const hasCommonShape = classifiedComponents.some((component) =>
				component.role === "cross_action_common_candidate");
			const hasSpecificShape = classifiedComponents.some((component) =>
				component.role === "action_specific_candidate");
			const classification = [
				...(hasCommonShape ? ["action_invariant_candidate"] : []),
				...(hasSpecificShape ? ["action_conditioned_candidate"] : []),
				...(hasCommonShape && hasSpecificShape ? ["mixed_component_effect"] : []),
			];
			const effect: EffectRecord = {
				state_epoch: stateEpoch,
				changed_cells: typeof delta?.changed_cells === "number" ? delta.changed_cells : null,
				bbox: delta?.bbox ?? null,
				components: classifiedComponents,
				classification,
				last_action_index: actionCount,
			};
			const priorEffect = actionEffects.get(actionName);
			const distinctEffects = [...(priorEffect?.distinct_effects ?? [])];
			if (!distinctEffects.some((item) => effectSignature(item) === effectSignature(effect))) distinctEffects.push(effect);
			actionEffects.set(actionName, {
				attempts: (priorEffect?.attempts ?? 0) + 1,
			distinct_effects: distinctEffects,
			});
			const trajectoryCard = `Recent action trajectory (latest first): ${JSON.stringify([...recentActions].reverse())}`;
			const effectLedger = `Compact action-effect ledger: ${JSON.stringify(Object.fromEntries(actionEffects))}. Classifications are action_invariant_candidate/action_conditioned_candidate only; they are observed evidence, not object identification or semantic labels such as budget.`;
			const previous = recentActions.at(-2) as Record<string, any> | undefined;
			const currentBox = delta?.bbox as Record<string, number> | undefined;
			const previousBox = previous?.bbox as Record<string, number> | undefined;
			const motionCard = currentBox && previousBox
				? `Changed-region geometry since prior action: dx=${((currentBox.left + currentBox.right) - (previousBox.left + previousBox.right)) / 2}, dy=${((currentBox.top + currentBox.bottom) - (previousBox.top + previousBox.bottom)) / 2}. This describes only changed cells, not an identified object's motion.`
				: "";
			// The action result is retained in Pi's transcript.  Repeating a full
			// 64x64 lossless frame here makes every later provider request carry
			// another copy of the same-sized observation.  The authoritative frame
			// remains available through arc_state; the next decision turn is
			// explicitly required to refresh it.  This keeps action evidence and
			// decision state separate without changing the native environment.
			const continuation = budgetExhausted
				? "ARC action budget is exhausted. This is the terminal result for this run; do not call arc_state, arc_action, research, or task-local harness tools again."
				: "The delta is recorded evidence, not an interpretation. arc_state(request='full') retrieves the complete current frame when needed.";
			return {
				// Pi's agent loop treats this as a completed tool batch.  It emits
				// agent_end without asking the provider for another turn, while the
				// outer ARC runner can explicitly submit the next decision prompt.
				// This is the authoritative action boundary; ctx.abort() below is
				// only a compatibility fallback for older Pi versions.
				terminate: true,
				content: [{ type: "text", text: `${transitionCard}\n${trajectoryCard}\n${effectLedger}\n${motionCard}\n${deltaText}\n${continuation}` }],
				details: {
					...publicToolDetails(value),
					arc_action_boundary: true,
					...(decisionCapsule ? { decision_capsule: decisionCapsule } : {}),
					...(budgetExhausted ? { arc_terminal: true, terminal_reason: "total_action_budget_exhausted" } : {}),
					autoresearch_signals: [
						...(typeof delta?.changed_cells === "number" ? [{
							layer: "environment_state",
							outcome: delta.changed_cells > 0 ? "changed" : "unchanged",
							labels: [delta.changed_cells > 0 ? "visible_state_changed" : "visible_state_unchanged"],
							pattern_key: `arc_action:${String((params as Record<string, unknown>).action ?? "UNKNOWN")}`,
						}] : []),
						...(typeof transition?.level_changed === "boolean" ? [{
							layer: "task_progress",
							outcome: transition.level_changed ? "advanced" : "not_advanced",
							labels: [transition.level_changed ? "public_progress_advanced" : "public_progress_not_advanced"],
							pattern_key: `arc_action:${String((params as Record<string, unknown>).action ?? "UNKNOWN")}`,
						}] : []),
					],
				},
			};
		},
	});
	installArcTrajectoryResource(pi, treatment);
	const research = externalBenchmarkResearch(pi, treatment
		? { baseTools: ["arc_state", "arc_action", "inspect_arc_trajectory"], taskToolAdapter: createArcTaskToolAdapter(() => bridge("/state"), (params) => bridge("/action", params)) }
		: {});
	installArcTaskSubagents(pi, treatment, research?.resolveBasisRefs);
	// `tool_result` is emitted before Pi finalizes the tool execution and before
	// the next provider turn is scheduled. Stop here, after the bridge result is
	// available to the shared research/checkpoint middleware. The later
	// tool_execution_end event is too late: by then Pi may already have queued a
	// post-action provider request. The Python runner keeps its abort fallback
	// for Pi versions that do not honor this boundary.
	pi.on("tool_result", (event, ctx) => {
		if (selfHarnessPreludeRequired && !event.isError
			&& (event.toolName === "task_harness"
				&& ["start", "inspect", "focus"].includes(String((event.input as Record<string, unknown> | undefined)?.action ?? "")))) {
			selfHarnessPreludeComplete = true;
		}
		if (event.toolName === "arc_action" && !event.isError
			&& process.env.PI_ARC_ACTION_BOUNDARY !== "disabled") {
			ctx.abort();
		}
		return {};
	});
	pi.on("before_agent_start", (event) => {
		const durableStarted = selfHarnessPreludeComplete || durableSelfHarnessPreludeCompleted();
		if (durableStarted) selfHarnessPreludeComplete = true;
		const prelude = durableStarted
			? "SELF-HARNESS PRELUDE STATUS: completed for this task. Do not repeat task_harness(start); inspect or use the current task-local portfolio only when useful. "
			: "SELF-HARNESS PRELUDE: on the first decision cycle, call task_harness(action='start') before arc_state or arc_action. This kickoff is one-time; ";
		return {
		systemPrompt: `${ARC_SYSTEM_PROMPT}\n\n${event.systemPrompt}\n\n${prelude}` +
			"Each arc_action returns a deterministic observation delta; call arc_state(request='current') " +
			"when the latest frame is needed for the next decision. Treat each response as a decision cycle: " +
			"analyze evidence, use bounded research or task-local self-harness when useful, and make arc_action " +
			"the final call. The bridge requires one action per cycle, not action-first behavior. " +
			(treatment
				? "The task-local self-harness starts empty, is not a native skill loader, and its creation interfaces are available from the first treatment request. Components and compositions can be created, used, researched and revised across decision cycles; immediate next-action benefit is not required. "
				: "") +
			"When an arc_action tests a hypothesis, include a compact decision object with the hypothesis, prediction, and falsifier so the native runtime can preserve it across context compaction; this metadata is not sent to the ARC environment. If the hypothesis has a bounded research test, add validation_window={actions,expected,on_expiry}; reuse the same hypothesis_id to accumulate its window, and set replace=true or increase hypothesis_version only to begin a distinct test. Expiry records an elapsed window awaiting assessment, not a semantic verdict, and never stops ARC actions.",
		};
	});
	if (!treatment) pi.on("before_agent_start", () => {
		pi.setActiveTools(["arc_state", "arc_action"]);
		return {};
	});
}
