/** ARC-AGI-3 environment adapter with a task-local self-harness entry. */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactToolSchema } from "./pi_compact_tool_schema.ts";
import externalBenchmarkResearch from "./pi_external_benchmark_research.ts";
import { ARC_SYSTEM_PROMPT, renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { installArcTaskSubagents } from "./pi_arc_task_subagents.ts";
import { installArcTrajectoryResource } from "./pi_arc_trajectory_resource.ts";
import { publishArcTrajectorySnapshot } from "./pi_arc_trajectory_snapshot.ts";
import { createArcTaskToolAdapter } from "./pi_arc_task_tools.ts";
import { bridge } from "./pi_arc_bridge_client.ts";
import { registerArcObservationSnapshot } from "./pi_arc_observation_snapshot.ts";
import { arcRecordActionEffect, arcSparseDecisionChangeGroups, compactHistoricalArcFrames, renderArcDecisionDelta, renderArcEffectLedger, type ArcEffectRecord as EffectRecord } from "./pi_arc_context_projection.ts";
import { arcBatchDeltaStopReason } from "./pi_arc_batch_guard.ts";
import { arcUniqueRegionTranslations, arcAnchoredPatternChanges, ArcTranslationWitnesses, renderArcSmallColorRegions } from "./pi_arc_transition_geometry.ts";
import { renderArcObservationView } from "./pi_arc_observation_view.ts";
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { ARC_OBSERVATION_WINDOW_CODEC, arcHexGrid, renderArcObservationWindow } from "./pi_arc_observation_window.ts";
import { arcActionCoordinateText, nativeArcActionPayload, normalizeArcActionArguments, validateArcActionCoordinates } from "./pi_arc_action_input.ts";
import { decisionStateSchema, normalizeDecisionKnowledge, patchDecisionState } from "./pi_decision_state.ts";
import { resolveTaskResource } from "./pi_task_resource_store.ts";
import { readCurrentTaskCheckpoint } from "./pi_task_checkpoint_reader.ts";

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

function uniquePendingResearchExperiment(root: string | undefined): Record<string, any> | undefined {
	if (!root) return undefined;
	const reportPath = join(root, "auto-research-reports.jsonl");
	if (!existsSync(reportPath)) return undefined;
	const reports = new Map<string, Record<string, any>>();
	for (const line of readFileSync(reportPath, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			const row = JSON.parse(line);
			if (!row?.run_id) continue;
			const prior = reports.get(String(row.run_id));
			if (!prior || Number(row.version ?? 0) >= Number(prior.version ?? 0)) reports.set(String(row.run_id), row);
		} catch { /* ignore damaged trailing diagnostic lines */ }
	}
	const observed = new Map<string, number>();
	const eventPath = join(root, "research-experiment-events.jsonl");
	if (existsSync(eventPath)) for (const line of readFileSync(eventPath, "utf8").split(/\r?\n/).filter(Boolean)) {
		try { const row = JSON.parse(line); if (row?.request_ref) observed.set(String(row.request_ref), (observed.get(String(row.request_ref)) ?? 0) + 1); } catch {}
	}
	const requests = [...reports.values()].flatMap(row => {
		const request = row.experiment_request ?? row.report?.experiment_request;
		return request && typeof request === "object" ? [{ ...request, request_ref: request.request_ref ?? `research-experiment:${row.run_id}` }] : [];
	}).filter(request => {
		const max = Number(request.requested_max_actions ?? 0);
		return max > 0 && (observed.get(String(request.request_ref)) ?? 0) < max;
	});
	return requests.length === 1 ? requests[0] : undefined;
}

// The rendered text is the model-facing frame representation. Keep raw frame
// matrices in the bridge/artifact log, but do not duplicate them in Pi tool
// details: Pi includes details in later model requests and the duplicate would
// grow the context once per action. These are the public fields needed for
// execution signals and task-local adapter programs.
function publicToolDetails(value: Record<string, unknown>,
	components: Array<{ changed_cells: number; bbox: unknown }> | undefined, action: string): Record<string, unknown> {
	const fields = [
		"game_id", "state", "levels_completed", "win_levels", "available_actions",
		"agent_available_actions", "action_budget", "guid", "full_reset",
		"pre_action_state", "observation_delta", "action_target_cell", "public_transition", "autoresearch_signals",
	];
	const details = Object.fromEntries(fields
		.filter((field) => Object.prototype.hasOwnProperty.call(value, field))
		.map((field) => [field, value[field]]));
	// Exact changed cells are already losslessly persisted by the bridge and
	// execution-observation artifact. Do not duplicate them in Pi tool details,
	// which are carried into every later provider request.
	const delta = details.observation_delta as Record<string, unknown> | undefined;
	if (delta && Array.isArray(delta.cells)) {
		const groups = arcSparseDecisionChangeGroups(delta, components, action,
			(details.public_transition as Record<string, unknown> | undefined)?.level_changed === true);
		details.observation_delta = {
			...delta,
			cells: undefined,
			cells_in_artifact: true,
			...(groups ? { change_groups: groups } : {}),
		};
		delete (details.observation_delta as Record<string, unknown>).cells;
	}
	return details;
}

export default function arcAgi3Extension(pi: ExtensionAPI) {
	const treatment = process.env.PI_AUTORESEARCH_VARIANT !== "control";
	const imageInput = String(process.env.PI_ARC_INPUT_MODALITIES ?? "text").split(",").map((item) => item.trim()).includes("image");
	let currentImage: ReturnType<typeof renderArcFrameImage> | undefined;
	let observationImages: Array<ReturnType<typeof renderArcFrameImage>> = [];
	let observationEventCursor = (() => {
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
		const file = root ? join(root, "arc-observation-view-events.jsonl") : "";
		if (!file || !existsSync(file)) return 0;
		try {
			const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
			const cursor = Number(JSON.parse(lines.at(-1) ?? "{}").bridge_event_cursor);
			return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
		} catch { return 0; }
	})();
	let latestObservationWindow = (() => {
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
		const file = root ? join(root, "arc-observation-window-latest.json") : "";
		if (!file || !existsSync(file)) return "";
		try {
			const saved = JSON.parse(readFileSync(file, "utf8"));
			return saved.codec === ARC_OBSERVATION_WINDOW_CODEC
				&& saved.bridge_event_cursor === observationEventCursor && typeof saved.text === "string"
				? saved.text : "";
		} catch { return ""; }
	})();
	let currentObservationText = "";
	// The real ARC gate requires a one-time self-harness prelude before the
	// first observation/action. Later cycles use the projected portfolio and
	// checkpoint without repeating kickoff.
	// Self-Harness is available from the first turn, but it is not a semantic
	// precondition for reading or acting in the live environment. Requiring a
	// kickoff would hand control of the irreversible trajectory to bookkeeping.
	const selfHarnessPreludeRequired = false;
	let selfHarnessPreludeComplete = !selfHarnessPreludeRequired || durableSelfHarnessPreludeCompleted();
	const recentActions: Array<Record<string, unknown>> = [];
	const researchExperimentBudgets = new Map<string, { approved: number; used: number }>();
	const actionEffects = new Map<string, { attempts: number; distinct_effects: EffectRecord[] }>();
	let actionCount = 0;
	let stateEpoch = 0;
	const translationWitnesses = new ArcTranslationWitnesses();
	let witnessLevel = 0;
	function persistGeometryFacts() {
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
		if(root)try { writeFileSync(join(root,"arc-geometry-facts.json"), JSON.stringify({
			level:witnessLevel,facts:translationWitnesses.facts()})+"\n","utf8"); }
		catch { /* Optional allocation evidence must not fail a committed action. */ }
	}
	function recordTranslations(action: string, value: Record<string, any>, index: number, persistFacts = true) {
		let translations: ReturnType<typeof arcUniqueRegionTranslations> = [];
		let patterns: ReturnType<typeof arcAnchoredPatternChanges> = {changes:[],omitted:0};
		let frames: {before:unknown;after:unknown}|undefined;
		const boundary = value.public_transition?.level_changed === true;
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
		const ref = value.pre_action_state?.resource_ref;
		if (root && ref && action !== "RESET" && !boundary) {
			try {
				const before = resolveTaskResource(root, String(ref));
				translations = arcUniqueRegionTranslations(before.public_state?.frames?.at(-1), value.frames?.at(-1));
				patterns = arcAnchoredPatternChanges(before.public_state?.frames?.at(-1), value.frames?.at(-1));
				frames = {before:before.public_state?.frames?.at(-1),after:value.frames?.at(-1)};
			} catch { /* Optional public geometry cannot interfere with a committed action. */ }
		}
		translationWitnesses.record(action, translations, { action_index: index, pre_action_ref: String(ref ?? "") }, boundary, patterns, frames);
		if(Number.isInteger(value.levels_completed))witnessLevel=value.levels_completed;
		if(persistFacts)persistGeometryFacts();
		return translations;
	}
	// Recover mechanical evidence from this run's canonical history only.
	const witnessRoot = process.env.PI_AUTORESEARCH_E2E_ROOT;
	const witnessHistory = witnessRoot ? join(witnessRoot, "bridge-events.jsonl") : "";
	if (witnessHistory && existsSync(witnessHistory)) {
		for (const line of readFileSync(witnessHistory, "utf8").split(/\r?\n/).filter(Boolean)) {
			try {
				const row = JSON.parse(line);
				if (["action", "forced_action"].includes(row.event)) recordTranslations(String(row.action),
					{ ...row.frame, pre_action_state: row.pre_action_state ?? row.frame?.pre_action_state }, Number(row.index ?? 0), false);
			} catch { /* Ignore a partial trailing diagnostic line. */ }
		}
		persistGeometryFacts();
	}
	let latestTranslations: ReturnType<typeof arcUniqueRegionTranslations> = [];
	function recordCommittedAction(action: string, value: Record<string, any>) {
		const delta = value.observation_delta;
		latestTranslations = recordTranslations(action, value, actionCount);
		recentActions.push({ action, level: value.levels_completed ?? 0,
			changed_cells: delta?.changed_cells ?? null, bbox: delta?.bbox ?? null,
			level_changed: value.public_transition?.level_changed ?? false });
		const effect = arcRecordActionEffect(actionEffects, { action, action_index: actionCount,
			state_epoch: stateEpoch, delta, level_changed: value.public_transition?.level_changed === true });
		stateEpoch = effect.state_epoch;
		return effect.components;
	}

	// ARC tool content contains the latest lossless frame, while every prior
	// frame is already durable in the bridge and execution-observation logs.
	// Keep only the latest rendered frame in future model requests so the
	// benchmark's observation history cannot crowd out task-local self-harness
	// decisions. This is context representation, not resource creation.
	pi.on("context", (event) => ({ messages: compactHistoricalArcFrames(event.messages) }));
	pi.registerTool({
		name: "arc_action", label: "ARC action",
		description: "Submit one available native action. Only ACTION6 uses integer x/y in 0..63; other actions ignore x/y. (x,y) addresses frame[y][x].",
		parameters: compactToolSchema(Type.Object({
			action: Type.String(),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			reasoning: Type.Optional(Type.String()),
			decision: Type.Optional(Type.Object({
				plan_id: Type.Optional(Type.String({ description: "Active checkpoint plan executed by this step." })),
				plan_step: Type.Optional(Type.Integer({ minimum: 0 })),
				hypothesis_id: Type.Optional(Type.String({ description: "Optional action/test label; does not register a strategy candidate." })),
				hypothesis_version: Type.Optional(Type.Integer({ minimum: 1 })),
				subgoal: Type.Optional(Type.String()),
				hypothesis: Type.Optional(Type.String()),
				prediction: Type.Optional(Type.String()),
				falsifier: Type.Optional(Type.String()),
				next_step: Type.Optional(Type.String()),
				knowledge: Type.Optional(decisionStateSchema()),
				basis_refs: Type.Optional(Type.Array(Type.String({ description: "Exact adopted harness resource versions that influenced this action." }))),
				decision_refs: Type.Optional(Type.Array(Type.String())),
				selection: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional assessment of a registered candidate: view_ref,candidate_id/version,evidence_refs,rationale,branches,disposition,addressed_trigger_refs,next_check." })),
				validation_window: Type.Optional(Type.Object({
					actions: Type.Integer({ minimum: 1 }),
					test_id: Type.Optional(Type.String()), question_id: Type.Optional(Type.String()),
					mode: Type.Optional(Type.Union([Type.Literal("any"), Type.Literal("each"), Type.Literal("final")])),
					scope: Type.Optional(Type.Union([Type.Literal("level"), Type.Literal("task")])),
					predicate: Type.Optional(Type.Object({ field: Type.String(), op: Type.String(), value: Type.Union([Type.Number(), Type.Boolean(), Type.String()]) })),
					candidate_predictions: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()))),
					retry_reason: Type.Optional(Type.String()),
					replace: Type.Optional(Type.Boolean()),
					expected: Type.Optional(Type.String()),
					on_expiry: Type.Optional(Type.Union([
						Type.Literal("falsify"), Type.Literal("inconclusive"),
					])),
				})),
				research_request_ref: Type.Optional(Type.String()),
				approve_research_experiment: Type.Optional(Type.Boolean({ description: "Approve the unique pending research experiment; runtime binds request_ref." })),
				approved_max_actions: Type.Optional(Type.Integer({ minimum: 1 })),
			})),
		})),
		prepareArguments(args) {
			const input = normalizeArcActionArguments(args as Record<string, any>);
			if (input?.decision?.knowledge === undefined) return input as any;
			// Pi's generic Value.Convert can wrap objects or coerce numeric entries.
			// Normalize authored knowledge before it, preserving the actual contract.
			const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
			const knowledge = normalizeDecisionKnowledge(input.decision.knowledge,
				ref => resolveTaskResource(root, ref));
			return { ...input, decision: { ...input.decision, knowledge } } as any;
		},
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const normalized = normalizeArcActionArguments(params as Record<string, any>);
			const decision = normalized.decision as Record<string, unknown> | undefined;
			if (decision?.knowledge !== undefined) {
				// Reject malformed/unknown evidence before touching the live environment.
				// The successful action observer applies this patch to the same checkpoint.
				const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
				const lookup = (ref: string) => resolveTaskResource(root, ref);
				const patch = normalizeDecisionKnowledge(decision.knowledge, lookup);
				patchDecisionState(readCurrentTaskCheckpoint(root).decision_state, patch, lookup);
			}
			const activeExperiments = [...researchExperimentBudgets.entries()]
				.filter(([, budget]) => budget.used < budget.approved)
				.map(([request_ref, budget]) => ({ request_ref, requested_max_actions: budget.approved }));
			const pendingRequest = decision?.approve_research_experiment === true
				? activeExperiments.length === 1
					? activeExperiments[0]
					: uniquePendingResearchExperiment(process.env.PI_AUTORESEARCH_E2E_ROOT)
				: undefined;
			if (decision?.approve_research_experiment === true && !pendingRequest) {
				throw new Error("approve_research_experiment requires exactly one pending research experiment; inspect task_harness_status only when selection is ambiguous");
			}
			const requestRef = String(decision?.research_request_ref ?? pendingRequest?.request_ref ?? "").trim();
			const approvedMax = Number(decision?.approved_max_actions ?? pendingRequest?.requested_max_actions ?? 0);
			if (requestRef) {
				if (!Number.isInteger(approvedMax) || approvedMax < 1) throw new Error("research_request_ref requires approved_max_actions");
				const current = researchExperimentBudgets.get(requestRef) ?? { approved: approvedMax, used: 0 };
				if (current.approved !== approvedMax) throw new Error(`research request budget cannot change after acceptance: ${requestRef}`);
				if (current.used >= current.approved) throw new Error(`research request action budget exhausted: ${requestRef}`);
				researchExperimentBudgets.set(requestRef, current);
			}
			// Decision metadata is for the task checkpoint only. Never forward it
			// to the official ARC action parser, which accepts only action data.
			const decisionCapsule = decision;
			const actionPayload = nativeArcActionPayload(normalized);
			const value = await bridge("/action", actionPayload);
			actionCount += 1;
			currentImage = undefined;
			observationImages = [];
			if (requestRef) {
				const current = researchExperimentBudgets.get(requestRef)!;
				current.used += 1;
				const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
				if (root) appendFileSync(join(root, "research-experiment-events.jsonl"), JSON.stringify({
					format: "research-experiment-action-v1", request_ref: requestRef,
					action_index: current.used, approved_max_actions: current.approved,
					tool_call_id: _toolCallId, action: actionPayload.action, recordedAt: new Date().toISOString(),
				}) + "\n", "utf8");
			}
			const delta = value.observation_delta as Record<string, unknown> | undefined;
			const transition = value.public_transition as Record<string, unknown> | undefined;
			const budget = value.action_budget as Record<string, unknown> | undefined;
			const actions = value.agent_available_actions ?? value.available_actions ?? [];
			const totalUsed = Number(budget?.total_used ?? 0);
			const totalMaximum = Number(budget?.total_maximum ?? 0);
			const budgetExhausted = totalMaximum > 0 && totalUsed >= totalMaximum;
			const actionName = String((params as Record<string, unknown>).action ?? "UNKNOWN");
			const actionCoordinates = arcActionCoordinateText(actionPayload, value.action_target_cell);
			const deltaText = delta
				? renderArcDecisionDelta(delta, transition?.level_changed === true)
				: "Observation delta unavailable for this action.";
			const transitionCard = `Current transition: state=${String(value.state ?? "UNKNOWN")}, levels_completed=${String(value.levels_completed ?? 0)}, action_budget=${JSON.stringify(budget ?? {})}, available_actions=${JSON.stringify(actions)}, public_transition=${JSON.stringify(transition ?? {})}.${actionCoordinates}`;
			const matchedComponents = recordCommittedAction(actionName, value);
			const trajectoryCard = `Recent action trajectory (latest first, up to 8; full history in execution-observations.jsonl): ${JSON.stringify(recentActions.slice(-8).reverse())}`;
			const effectLedger = renderArcEffectLedger(actionEffects);
			const translations = latestTranslations;
			const translationCard = translations.length
				? `Exact same-color/same-shape region offsets [dx,dy]: ${JSON.stringify(translations)}. Unique pixel-region matches, not proof of object identity or goal.\n` : "";
			const changeShapeCard = `Changed groups: ${JSON.stringify({count:matchedComponents.length,
				sizes:matchedComponents.map(component => component.changed_cells),
				boxes:matchedComponents.map(component => component.bbox)})}. These are separate groups of changed cells; they do not by themselves identify movement, blocking, a counter, or a goal.`;
			// The action result is retained in Pi's transcript.  Repeating a full
			// 64x64 lossless frame here makes every later provider request carry
			// another copy of the same-sized observation.  The authoritative frame
			// is supplied automatically to the next decision turn. This keeps action evidence and
			// decision state separate without changing the native environment.
			const continuation = budgetExhausted
				? "ARC action budget is exhausted. Do not call environment actions or research again. The runner may request a final read-only level retrospective through task_resource and task_harness(action='level_review')."
				: "The delta is recorded evidence, not an interpretation. The complete current public frame is supplied automatically at the next decision cycle.";
			return {
				// Pi's agent loop treats this as a completed tool batch.  It emits
				// agent_end without asking the provider for another turn, while the
				// outer ARC runner can explicitly submit the next decision prompt.
				// This is the authoritative action boundary; ctx.abort() below is
				// only a compatibility fallback for older Pi versions.
				terminate: true,
				content: [{ type: "text", text: `${transitionCard}\n${translationCard}${trajectoryCard}\n${effectLedger}\n${changeShapeCard}\n${deltaText}\n${continuation}` }],
				details: {
					...publicToolDetails(value, matchedComponents, actionName),
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
	pi.registerTool({
		name: "arc_actions", label: "ARC action sequence",
		description: "Execute 1-8 actions, recording each. Stop on level/terminal/budget/error boundaries. stop_if_changed_cells_lte stops when changed cells <= threshold or count is missing. Never retry an unknown action.",
		parameters: Type.Object({ actions: Type.Array(Type.Object({
			action: Type.String(),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			reasoning: Type.Optional(Type.String()),
		}), { minItems: 1, maxItems: 8 }),
			stop_if_changed_cells_lte: Type.Optional(Type.Integer({ minimum: 0, maximum: 4096 })),
		}),
		executionMode: "sequential",
		async execute(toolCallId, params) {
			// Validate before committing the first irreversible environment action.
			params.actions.forEach(validateArcActionCoordinates);
			arcBatchDeltaStopReason(undefined, params.stop_if_changed_cells_lte, 0);
			const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
			if (root) {
				const strategyFile = join(root, "task-strategy-state.json");
				const strategy = existsSync(strategyFile) ? JSON.parse(readFileSync(strategyFile, "utf8")) : {};
				if (strategy.plan?.status === "active") throw new Error("arc_actions requires no active structured plan; use arc_action for checked plan steps");
				const validationFile = join(root, "research-validation-windows.jsonl");
				const windows = existsSync(validationFile) ? readFileSync(validationFile, "utf8").split(/\r?\n/)
					.filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } }) : [];
				const latestWindows = new Map<string, Record<string, unknown>>();
				for (const row of windows) latestWindows.set(String(row.test_id ?? row.window_id ?? ""), row);
				if ([...latestWindows.values()].some((row) => row.status === "open" || row.status === "progress"))
					throw new Error("arc_actions requires no active validation window; use arc_action for checked experiment steps");
			}
			const completed: Array<Record<string, unknown>> = [];
			let stopped: string = "all_actions_completed";
			for (const [index, action] of params.actions.entries()) {
				try {
					const value = await bridge("/action", action as Record<string, unknown>);
					actionCount += 1;
					const matchedComponents = recordCommittedAction(String(action.action), value);
					currentImage = undefined;
					observationImages = [];
					const summary = {
						index, action: action.action, x: action.x, y: action.y,
						...publicToolDetails(value, matchedComponents, String(action.action)),
					};
					completed.push(summary);
					const budget = value.action_budget as Record<string, unknown> | undefined;
					if ((value.public_transition as Record<string, unknown> | undefined)?.level_changed === true) {
						stopped = "level_changed"; break;
					}
					if (value.state === "WIN" || value.state === "GAME_OVER") {
						stopped = "terminal_state"; break;
					}
					if (Number(budget?.total_maximum ?? 0) > 0
						&& Number(budget?.total_used ?? 0) >= Number(budget?.total_maximum)) {
						stopped = "action_budget_exhausted"; break;
					}
					const deltaStop = arcBatchDeltaStopReason(value.observation_delta,
						params.stop_if_changed_cells_lte, index);
					if (deltaStop) { stopped = deltaStop; break; }
				} catch (error) {
					stopped = `action_${index}_failed_or_unknown: ${error instanceof Error ? error.message : String(error)}`;
					break;
				}
			}
			if (completed.length === 0) throw new Error(`ARC batch did not complete an action; ${stopped}. Do not retry an unknown action automatically.`);
			return { terminate: true,
				content: [{ type: "text" as const, text: `ARC batch completed ${completed.length}/${params.actions.length} actions. Stop: ${stopped}. Exact per-action results follow in order: ${JSON.stringify(completed)}. The next parent observation includes all canonical action events and the current hex grid.` }],
				details: { arc_action_boundary: true, completed, stopped,
					partial: completed.length < params.actions.length,
					retryable: false },
			};
		},
	});
	installArcTrajectoryResource(pi, treatment);
	const research = externalBenchmarkResearch(pi, treatment
		? { baseTools: ["arc_action", "arc_actions"], taskToolAdapter: createArcTaskToolAdapter(() => bridge("/state")) }
		: {});
	installArcTaskSubagents(pi, treatment, research?.resolveBasisRefs, () => bridge("/state"),
		() => {
			const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
			if (!root) throw new Error("ARC task root is required to publish child trajectory");
			return publishArcTrajectorySnapshot(root, () => bridge("/trajectory?projection=transitions"));
		});
	// Images are ephemeral current-view slots. Register this after the
	// transcript lifecycle so base64 does not enter history or compaction costs.
	pi.on("context", (event) => {
		const images = observationImages.length ? observationImages : currentImage ? [currentImage] : [];
		return images.length || currentObservationText ? { messages: [...event.messages, {
			role: "user" as const, timestamp: Date.now(), content: [
				...(currentObservationText ? [{ type: "text" as const, text: currentObservationText }] : []),
				...images.flatMap((image) => [{ type: "text" as const, text: image.label }, image.content]),
			],
		}] } : {};
	});
	// Pi ends natively when all calls in a response request termination. Mixed
	// batches close after their final receipts, preserving tool-call pairs and
	// preventing an internal continuation from seeing the old observation.
	let responseActionBoundaryCompleted = false;
	let responseToolCallCount = 0, responseNativeBoundaryCount = 0;
	pi.on("turn_start", () => {
		responseActionBoundaryCompleted = false;
		responseToolCallCount = responseNativeBoundaryCount = 0;
	});
	pi.on("message_end", event => {
		if (event.message.role === "assistant")
			responseToolCallCount = event.message.content.filter(part => part.type === "toolCall").length;
	});
	pi.on("tool_call", () => {
		if (responseActionBoundaryCompleted) return { block: true,
			reason: JSON.stringify({ format: "task-control-error-v1", code: "rejected_input", applied: false,
				retryable: false, errors: [{ path: "$", message: "ARC action boundary already completed in this response; no trailing tool operation was applied." }],
				recovery_hint: "Use the new observation in the next parent turn. If the operation remains useful, submit it before the next ARC action." }) };
	});
	pi.on("tool_result", event => {
		if (selfHarnessPreludeRequired && !event.isError
			&& (event.toolName === "task_harness"
				&& ["start", "inspect", "focus"].includes(String((event.input as Record<string, unknown> | undefined)?.action ?? "")))) {
			selfHarnessPreludeComplete = true;
		}
		if ((["arc_action", "arc_actions"].includes(event.toolName)
			|| (event.toolName === "delegate_task" && Number((event.details as Record<string, unknown> | undefined)?.arc_action_count ?? 0) > 0)) && !event.isError
			&& process.env.PI_ARC_ACTION_BOUNDARY !== "disabled") {
			responseActionBoundaryCompleted = true;
			if ((event.details as Record<string, unknown> | undefined)?.arc_action_boundary === true)
				responseNativeBoundaryCount++;
		}
		return {};
	});
	pi.on("turn_end", (_event, ctx) => {
		// Pi terminates natively only when every finalized call requests it.
		// Mixed batches need cancellation after all tool receipts are finalized,
		// before another model request; this preserves complete tool-call pairs.
		if (responseActionBoundaryCompleted && responseNativeBoundaryCount < responseToolCallCount) ctx.abort();
	});
	pi.on("before_agent_start", async (event) => {
		// The public state is a deterministic input to every irreversible ARC
		// decision.  Supplying it here keeps the parent context continuous and
		// removes a redundant model-controlled read/action round trip.  The
		// bridge still records the pre-action state for every executed action.
		const currentState = await bridge("/state");
		actionCount = Math.max(actionCount, Number((currentState.action_budget as Record<string, unknown> | undefined)?.total_used ?? 0));
		const eventWindow = await bridge(`/events?after=${observationEventCursor}`);
		const nextCursor = Number(eventWindow.next);
		if (!Number.isSafeInteger(nextCursor) || nextCursor < observationEventCursor) {
			throw new Error("ARC bridge returned an invalid observation event cursor");
		}
		const snapshot = treatment && process.env.PI_AUTORESEARCH_E2E_ROOT
			? registerArcObservationSnapshot(process.env.PI_AUTORESEARCH_E2E_ROOT, currentState, {
				decision_cycle_id: `parent-decision-cycle-after-action-${actionCount}`,
			})
			: undefined;
		const frames = Array.isArray(currentState.frames) ? currentState.frames : [];
		const hasCurrentFrame = Array.isArray(frames.at(-1)) && frames.at(-1).length > 0;
		currentImage = imageInput && hasCurrentFrame ? renderArcFrameImage(currentState, snapshot?.ref) : undefined;
		const observationWindow = hasCurrentFrame ? renderArcObservationWindow(
			Array.isArray(eventWindow.events) ? eventWindow.events as Record<string, any>[] : [],
			currentState, { includeImages: imageInput,
				exactRegions: process.env.PI_ARC_EXACT_REGION_TABLE === "enabled"
					|| (process.env.PI_ARC_EXACT_REGION_TABLE === "after_action" && actionCount > 0) },
		) : undefined;
		const newActions = Array.isArray(eventWindow.events) && eventWindow.events.some((item: any) => item?.event === "action" || item?.event === "forced_action");
		if (observationWindow) {
			const currentHex = arcHexGrid(frames.at(-1) as number[][], "current_state_frame");
			if (newActions || !latestObservationWindow || !latestObservationWindow.includes(currentHex))
				latestObservationWindow = observationWindow.text;
			const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
			if (root) writeFileSync(join(root, "arc-observation-window-latest.json"), JSON.stringify({
				codec: ARC_OBSERVATION_WINDOW_CODEC, bridge_event_cursor: nextCursor, text: latestObservationWindow,
			}) + "\n", "utf8");
		}
		observationImages = observationWindow?.images ?? [];
		if (currentImage && observationImages.length) observationImages[observationImages.length - 1] = currentImage;
		observationEventCursor = nextCursor;
		const currentTextView = !hasCurrentFrame || currentImage ? undefined
			: renderArcObservationView(currentState, { canonicalRef: snapshot?.ref });
		const currentFrame = observationWindow
			? `State=${String(currentState.state ?? "UNKNOWN")}; levels_completed=${String(currentState.levels_completed ?? 0)}; action_budget=${JSON.stringify(currentState.action_budget ?? {})}; available_actions=${JSON.stringify(currentState.agent_available_actions ?? currentState.available_actions ?? [])}. Exact state: ${snapshot?.ref ?? "bridge /state"}.\n\n` +
				`RECENT ACTION OBSERVATION WINDOW (${newActions ? observationWindow.actionCount : 0} new actions):\n${latestObservationWindow}`
			: currentTextView?.text ?? renderArcLatestFrameRuns(currentState);
		const geometricEvidence = [actionCount > 0 ? renderArcSmallColorRegions(frames.at(-1), snapshot?.ref ?? "bridge /state") : "",
			translationWitnesses.renderCurrent(frames.at(-1), snapshot?.ref ?? "bridge /state"),
			translationWitnesses.render()].filter(Boolean).join("\n\n");
		currentObservationText = "CURRENT PUBLIC ARC OBSERVATION (complete, ephemeral view):\n" + currentFrame +
			(geometricEvidence ? `\n\n${geometricEvidence}` : "") +
			(snapshot ? `\n\nImmutable exact resource for this same observed state: ${snapshot.ref}. Use its public_state paths for task-local pure-tool bindings; this reference is evidence, not an action capability.` : "");
		const root = process.env.PI_AUTORESEARCH_E2E_ROOT;
		if (root) appendFileSync(join(root, "arc-observation-view-events.jsonl"), JSON.stringify({
			event: "intended_parent_view", action_count: actionCount,
			bridge_event_cursor: observationEventCursor,
			included_action_count: observationWindow?.actionCount ?? 0,
			included_image_count: observationImages.length,
			...(currentImage?.metadata ?? currentTextView?.metadata ?? {
				codec: "bridge-status-fallback", canonical_ref: snapshot?.ref ?? null, coverage: "no_current_frame",
			}), recordedAt: new Date().toISOString(),
		}) + "\n", "utf8");
		const durableStarted = selfHarnessPreludeComplete || durableSelfHarnessPreludeCompleted();
		if (durableStarted) selfHarnessPreludeComplete = true;
		const prelude = !treatment ? "" : durableStarted
			? "SELF-HARNESS STATUS: available. "
			: "SELF-HARNESS STATUS: initially empty; creation is available now. ";
		return {
		systemPrompt: `${ARC_SYSTEM_PROMPT}\n\n${event.systemPrompt}\n\n${prelude}` +
			(currentImage
				? "Each continuation carries the complete current grid/PNG and exact transitions. Hex 0-f=colors 0-15. "
				: hasCurrentFrame
					? "Each continuation carries the complete current grid and exact transitions. Hex 0-f=colors 0-15. "
					: "The bridge returned no current frame; use the public state below and do not infer hidden pixels. ") +
			(treatment
				? "Act from CURRENT PUBLIC ARC OBSERVATION. Candidate selection is optional and applies only to registered candidates."
				: "End with arc_action or bounded arc_actions; use CURRENT PUBLIC ARC OBSERVATION."),
		};
	});
	if (!treatment) pi.on("before_agent_start", () => {
		pi.setActiveTools(["arc_action", "arc_actions"]);
		return {};
	});
}
