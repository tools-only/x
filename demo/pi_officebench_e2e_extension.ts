/** Pi-native task tools for the real OfficeBench end-to-end smoke. */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type EvidencePolicy = "summary_only" | "source_and_date";
type ExpectedRecurrence = "low" | "medium" | "high";
type SurfaceChoice = "apply" | "keep";
type SurfaceMode = "general" | "calendar_focused" | "calendar_batch" | "email_batch";
type EffectMetric = "semantic_error_rate" | "focused_tool_use_rate" | "calendar_batch_utilization" | "email_batch_utilization";
type ResearchAction = "record" | "open" | "update" | "resolve" | "reopen";
type ResearchStatus = "open" | "active" | "resolved";
type SurfaceDecisionInput = {
	choice: SurfaceChoice;
	mode: SurfaceMode;
	expected_effect: string;
	effect_metric: EffectMetric;
	observation_horizon: number;
	reconsider_when: string;
};
type SurfaceDecisionParams = SurfaceDecisionInput & { basis_resource_ids: string[] };
type ObservationOutcome = "success" | "semantic_error" | "transport_error";
type DecisionSupport = {
	capability_id: "execution_tool_surface";
	current_surface: SurfaceMode;
	candidate_mode: "calendar_batch" | "email_batch";
	reason: "direct_calendar_path_observed" | "calendar_path_error_observed" | "structured_email_source_observed" | "direct_email_path_observed";
	next_request_effect: string;
	consider_if: string;
	skip_if: string;
	evidence_ref: string;
	record_with: "research_resource";
	decide_with: "research_resource.continue_with or decide_execution_surface";
	one_step_if_worthwhile: string;
	cost_model: {
		direct_bridge_processes: "remaining_uses";
		batch_bridge_processes: 1;
		decision_model_requests: 1;
		break_even_remaining_uses: number;
	};
	input_shape: string;
	no_change_valid: true;
};
type ExecutionObservation = {
	event_id: string;
	tool: string;
	operation: string;
	status: "completed" | "failed";
	outcome: ObservationOutcome;
	error_kind?: string;
	category: "task_action" | "resource";
	relevant_capability?: "execution_tool_surface";
	decision_support?: DecisionSupport;
	attempted_work_units?: number;
	completed_work_units?: number;
	result_summary: string;
	recordedAt: string;
};
type BridgeResult = { text: string; outcome: "success" | "semantic_error"; error_kind?: string };
type BridgeBatchResult = { batch: true; results: BridgeResult[] };
type PendingEffectWindow = {
	decisionId: string;
	toolCallId: string;
	basisResourceIds: string[];
	basisSnapshots: Array<Record<string, unknown>>;
	expectedEffect: string;
	effectMetric: EffectMetric;
	horizon: number;
	mode: SurfaceMode;
	baselineCalls: number;
	baselineSemanticErrors: number;
	observationIds: string[];
	semanticErrors: number;
	focusedToolCalls: number;
	batchToolCalls: number;
	attemptedWorkUnits: number;
	completedWorkUnits: number;
};
type ResearchFinding = {
	research_event_id: string;
	action: ResearchAction;
	version: number;
	supersedes_event_id?: string;
	goal_id: string;
	finding_id: string;
	question: string;
	scope: string;
	uncertainty: string;
	evidence_plan: string[];
	evidence: string;
	decision: string;
	evidence_refs: string[];
	assessment_refs: string[];
	expected_recurrence: ExpectedRecurrence;
	remaining_uses: number;
	status: ResearchStatus;
	resolution?: "supported" | "contradicted" | "inconclusive" | "no_longer_relevant";
	recordedAt: string;
	source: "task_agent";
};

class TaskResourceBoundaryError extends Error {}

export default function officeBenchE2EExtension(pi: ExtensionAPI) {
	const toolSurfaces: Record<SurfaceMode, string[]> = {
		general: ["officebench_action", "calendar_action", "email_action", "workspace_file_action", "task_notes", "research_resource", "decide_execution_surface", "set_evidence_policy"],
		calendar_focused: ["calendar_action", "email_action", "workspace_file_action", "task_notes", "research_resource", "decide_execution_surface", "set_evidence_policy"],
		calendar_batch: ["calendar_action", "calendar_batch_action", "email_action", "workspace_file_action", "task_notes", "research_resource", "decide_execution_surface", "set_evidence_policy"],
		email_batch: ["calendar_action", "email_action", "email_batch_action", "workspace_file_action", "task_notes", "research_resource", "decide_execution_surface", "set_evidence_policy"],
	};
	let evidencePolicy: EvidencePolicy = "summary_only";
	let baselineWritten = false;
	let lastEvidenceMutationCallId: string | undefined;
	let lastSurfaceMutationCallId: string | undefined;
	let lastSurfaceAdjustment: {
		decisionId: string;
		choice: SurfaceChoice;
		basisResourceIds: string[];
		expectedEffect: string;
		effectMetric: EffectMetric;
		observationHorizon: number;
		reconsiderWhen: string;
		previous: SurfaceMode;
		value: SurfaceMode;
	} | undefined;
	let findingCounter = 0;
	let researchEventCounter = 0;
	let decisionCounter = 0;
	let harnessObservationCounter = 0;
	let effectAssessmentCounter = 0;
	const executionObservations = new Map<string, ExecutionObservation>();
	const findings = new Map<string, ResearchFinding>();
	const effectAssessments = new Map<string, Record<string, unknown>>();
	const absorbedEffectAssessments = new Set<string>();
	const decisionSupportEmitted = new Set<"calendar_batch" | "email_batch">();
	const observedSurfaceCalls = new Set<string>();
	let pendingEffectWindow: PendingEffectWindow | undefined;
	let taskNotes = "";
	let executionSurface: SurfaceMode = "general";
	const method = readFileSync(fileURLToPath(new URL("./auto_research_method.md", import.meta.url)), "utf8");
	const outputRoot = resolve(process.env.PI_OFFICEBENCH_E2E_ROOT ?? ".");
	const nativeRoot = join(outputRoot, "pi-native");
	const workspace = resolve(process.env.PI_OFFICEBENCH_WORKSPACE ?? ".");
	const testbedRoot = resolve(workspace, "testbed");
	const jitRoot = resolve(process.env.JIT_ROOT ?? "D:\\JIT");
	const jitPython = process.env.JIT_PYTHON ?? "python";
	const bundledContractPath = fileURLToPath(new URL("./officebench_artifact_contract.json", import.meta.url));
	const runContractPath = join(outputRoot, "artifact-contract.json");
	const artifactContract = JSON.parse(readFileSync(
		existsSync(runContractPath) ? runContractPath : bundledContractPath, "utf8",
	)) as Record<string, unknown>;
	const runTaskCatalogPath = join(outputRoot, "task-resource-catalog.json");
	const taskResourceCatalog = existsSync(runTaskCatalogPath)
		? JSON.parse(readFileSync(runTaskCatalogPath, "utf8")) as Record<string, unknown>
		: {
			format: "officebench-task-resource-catalog-v1",
			scope: "current_case_testbed_only",
			inventory: { root: ".", entries: [], truncated: false },
			relevant_apps: ["calendar", "email", "excel"],
			action_contracts: {},
			task_language_conventions: artifactContract.task_language_conventions,
			canonical_contract: { path: "artifact-contract.json", format: artifactContract.format },
			disclosure: { timing: "initial_model_request", dynamic_contract_lookup_needed: false },
		};
	const relevantApps = Array.isArray(taskResourceCatalog.relevant_apps)
		? taskResourceCatalog.relevant_apps.filter((value): value is string => typeof value === "string") : [];
	const catalogInventory = taskResourceCatalog.inventory as { entries?: Array<{ path?: string; kind?: string }>; truncated?: boolean } | undefined;
	const inventoryFiles = catalogInventory?.entries?.filter((entry) => entry.kind === "file") ?? [];
	const textFilePattern = /\.(?:txt|md|json|jsonl|csv|tsv|xml|html?|ya?ml)$/i;
	const completeBinaryOnlyInventory = existsSync(runTaskCatalogPath)
		&& catalogInventory?.truncated === false
		&& inventoryFiles.length > 0
		&& inventoryFiles.every((entry) => typeof entry.path === "string" && !textFilePattern.test(entry.path));
	if (completeBinaryOnlyInventory) {
		for (const tools of Object.values(toolSurfaces)) {
			const index = tools.indexOf("workspace_file_action");
			if (index >= 0) tools.splice(index, 1);
		}
	}
	mkdirSync(nativeRoot, { recursive: true });
	writeFileSync(join(outputRoot, "capability-catalog.json"), `${JSON.stringify({
		format: "task-local-capability-catalog-v1",
		recordedAt: new Date().toISOString(),
		scope: "one_pi_agent_process",
		effect_timing: "next_model_request",
		initial_surface: "general",
		active_tools: toolSurfaces.general,
		available_inactive: [{
			tool: "calendar_batch_action",
			kind: "task_action",
			changes: "perform 2-16 real calendar creates through one Pi tool call and one Python bridge process",
			enabled_by: "pi.setActiveTools via a finding-backed calendar_batch decision",
			effective_at: "next_model_request",
			scope: "current Pi task process",
		}, {
			tool: "email_batch_action",
			kind: "task_action",
			changes: "perform 2-16 real email sends through one Pi tool call and one Python bridge process",
			input: "shared sender/subject/content_template plus 2-16 recipient variable maps",
			enabled_by: "pi.setActiveTools via a finding-backed email_batch decision",
			effective_at: "next_model_request",
			scope: "current Pi task process",
		}],
		resources: [
			{ id: "artifact_contract", kind: "task_resource", optional: false,
				path: "artifact-contract.json", changes_execution: false,
				read_with: "not_on_initial_active_surface", disclosed_at: "via_task-resource-catalog.json",
				describes: "backend action, artifact path, naming, verification, task-language, and task-workspace boundary semantics" },
			{ id: "task_resource_boundary", kind: "execution_boundary", optional: false,
				changes: "deny backend paths outside the current testbed and reject unconfined broad shell execution",
				effective_at: "every OfficeBench bridge request", scope: "current case testbed" },
			{ id: "task_notes", kind: "task_resource", optional: true, changes_execution: false },
			{ id: "research_resource", kind: "task_resource", optional: true,
				produces: ["versioned research-goal-N", "versioned finding-N"],
				lifecycle: ["open", "update", "resolve", "reopen"],
				changes_execution: "only when an active evidence-backed version supplies optional continue_with" },
			{ id: "execution_tool_surface", kind: "self_harness_capability", optional: true,
				pi_native_operation: "pi.setActiveTools", effective_at: "next_model_request" },
			{ id: "evidence_policy", kind: "context_guidance", optional: true,
				pi_native_operation: "context hook", effective_at: "next_model_request" },
		],
		surface_modes: toolSurfaces,
	}, null, 2)}\n`, "utf8");
	const appendJsonl = (name: string, value: unknown) =>
		appendFileSync(join(outputRoot, name), `${JSON.stringify(value)}\n`, "utf8");
	const summarize = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);
	const finishEffectWindow = (completionReason: "horizon_reached" | "task_settled" | "superseded") => {
		if (!pendingEffectWindow) return;
		const window = pendingEffectWindow;
		const exposureObserved = observedSurfaceCalls.has(window.toolCallId);
		let verdict: "supported" | "contradicted" | "inconclusive" = "inconclusive";
		if (completionReason === "horizon_reached" && exposureObserved && window.observationIds.length) {
			if (["calendar_batch_utilization", "email_batch_utilization"].includes(window.effectMetric)) {
				const expectedMode = window.effectMetric === "calendar_batch_utilization" ? "calendar_batch" : "email_batch";
				if (window.mode === expectedMode && window.batchToolCalls > 0
					&& window.completedWorkUnits >= 2
					&& window.completedWorkUnits === window.attemptedWorkUnits
					&& window.observationIds.length < window.completedWorkUnits) {
					verdict = "supported";
				} else if (window.batchToolCalls === 0 || window.completedWorkUnits < window.attemptedWorkUnits) {
					verdict = "contradicted";
				}
			} else if (window.effectMetric === "focused_tool_use_rate") {
				if (window.mode === "calendar_focused" && window.focusedToolCalls === window.observationIds.length) {
					verdict = "supported";
				} else if (window.focusedToolCalls === 0) {
					verdict = "contradicted";
				}
			} else if (window.baselineCalls > 0) {
				const baselineRate = window.baselineSemanticErrors / window.baselineCalls;
				const observedRate = window.semanticErrors / window.observationIds.length;
				verdict = observedRate < baselineRate ? "supported"
					: observedRate > baselineRate ? "contradicted" : "inconclusive";
			}
		}
		const windowAssessment: Record<string, unknown> = {
			horizon: window.horizon, completion_reason: completionReason,
			relevant_calls: window.observationIds.length, semantic_errors: window.semanticErrors,
			focused_tool_calls: window.focusedToolCalls, observation_ids: window.observationIds,
		};
		if (["calendar_batch_utilization", "email_batch_utilization"].includes(window.effectMetric)) {
			windowAssessment.batch_tool_calls = window.batchToolCalls;
			windowAssessment.attempted_work_units = window.attemptedWorkUnits;
			windowAssessment.completed_work_units = window.completedWorkUnits;
			windowAssessment.tool_call_compression = window.batchToolCalls
				? window.completedWorkUnits / window.batchToolCalls : 0;
		}
		const assessment = {
			effect_assessment_id: `effect-assessment-${++effectAssessmentCounter}`,
			decision_id: window.decisionId,
			toolCallId: window.toolCallId,
			basis_resource_ids: window.basisResourceIds,
			basis_snapshots: window.basisSnapshots,
			effect_metric: window.effectMetric,
			expected_effect: window.expectedEffect,
			exposure_observed: exposureObserved,
			baseline: { evidence_calls: window.baselineCalls, semantic_errors: window.baselineSemanticErrors },
			window: windowAssessment,
			verdict,
			improvement: "not_established",
			attribution: {
				kind: "bounded_temporal_window",
				intervention: "execution_tool_surface",
				decision_id: window.decisionId,
				basis_resource_ids: window.basisResourceIds,
				basis_snapshots: window.basisSnapshots,
				confounders_controlled: false,
				scope: "current Pi task process",
			},
			recordedAt: new Date().toISOString(),
		};
		appendJsonl("effect-assessments.jsonl", assessment);
		effectAssessments.set(assessment.effect_assessment_id, assessment);
		pendingEffectWindow = undefined;
	};
	const observeEffectWindow = (observation: ExecutionObservation) => {
		const window = pendingEffectWindow;
		if (!window || observation.category !== "task_action") return;
		// pi.setActiveTools affects the next model request. Tool calls emitted in
		// the same assistant response were selected from the old surface and must
		// not consume the post-change observation horizon.
		if (!observedSurfaceCalls.has(window.toolCallId)) return;
		const metricRelevant = window.effectMetric === "email_batch_utilization"
			? observation.tool === "email_action" || observation.tool === "email_batch_action"
				|| observation.operation.startsWith("email.")
			: ["calendar_batch_utilization", "focused_tool_use_rate"].includes(window.effectMetric)
				? observation.tool === "calendar_action" || observation.tool === "calendar_batch_action"
					|| observation.operation.startsWith("calendar.")
				: true;
		if (!metricRelevant) return;
		window.observationIds.push(observation.event_id);
		if (observation.outcome !== "success") window.semanticErrors += 1;
		if (window.mode === "calendar_focused" && observation.tool === "calendar_action") {
			window.focusedToolCalls += 1;
		}
		const expectedBatchTool = window.effectMetric === "calendar_batch_utilization"
			? "calendar_batch_action" : window.effectMetric === "email_batch_utilization"
				? "email_batch_action" : undefined;
		if (expectedBatchTool && observation.tool === expectedBatchTool) {
			window.batchToolCalls += 1;
			window.attemptedWorkUnits += observation.attempted_work_units ?? 0;
			window.completedWorkUnits += observation.completed_work_units ?? 0;
		}
		if (window.observationIds.length >= window.horizon) finishEffectWindow("horizon_reached");
	};
	const recordExecutionObservation = (
		toolCallId: string,
		tool: string,
		operation: string,
		status: "completed" | "failed",
		result: string,
		outcome: ObservationOutcome = status === "failed" ? "transport_error" : "success",
		errorKind?: string,
		category: "task_action" | "resource" = "task_action",
		workUnits?: { attempted: number; completed: number },
	) => {
		const calendarRelevant = tool === "calendar_action" || operation.startsWith("calendar.");
		const emailBatchEvidence = relevantApps.includes("email") && outcome === "success"
			&& (operation === "excel.read_file" || tool === "email_action" && operation === "send_email"
				|| operation === "email.send_email");
		let decisionSupport: DecisionSupport | undefined = category === "task_action"
			&& executionSurface === "general" && emailBatchEvidence
			? {
				capability_id: "execution_tool_surface",
				current_surface: executionSurface,
				candidate_mode: "email_batch",
				reason: operation === "excel.read_file" ? "structured_email_source_observed" : "direct_email_path_observed",
				next_request_effect: "pi.setActiveTools can enable email_batch_action before the next model request; one Pi call can perform multiple real email sends",
				consider_if: "remaining_uses >= 4, sends are similar, and per-item non-atomic results are acceptable",
				skip_if: "remaining_uses < 4 unless another concrete benefit exceeds the decision cost, messages cannot be prepared together, or partial-failure handling makes batching unsuitable",
				evidence_ref: toolCallId,
				record_with: "research_resource",
				decide_with: "research_resource.continue_with or decide_execution_surface",
				one_step_if_worthwhile: `If remaining_uses >= 4 and this observation is sufficient evidence, call research_resource once with action=record, evidence_refs=["${toolCallId}"], and continue_with mode=email_batch; otherwise continue directly without research or change.`,
				cost_model: { direct_bridge_processes: "remaining_uses", batch_bridge_processes: 1,
					decision_model_requests: 1, break_even_remaining_uses: 4 },
				input_shape: "sender, subject, content_template, recipients[{recipient,variables}]",
				no_change_valid: true,
			}
			: category === "task_action" && executionSurface === "general" && calendarRelevant
			? {
				capability_id: "execution_tool_surface",
				current_surface: executionSurface,
				candidate_mode: "calendar_batch",
				reason: outcome === "success" ? "direct_calendar_path_observed" : "calendar_path_error_observed",
				next_request_effect: "pi.setActiveTools can enable calendar_batch_action before the next model request; one Pi call can perform multiple real calendar creates",
				consider_if: "remaining_uses >= 3, creates are similar, and the observed direct calendar path is suitable for them",
				skip_if: "remaining_uses < 3 unless another concrete benefit exceeds the decision cost, creates are not similar, or partial-failure handling makes batching unsuitable",
				evidence_ref: toolCallId,
				record_with: "research_resource",
				decide_with: "research_resource.continue_with or decide_execution_surface",
				one_step_if_worthwhile: `If remaining_uses >= 3 and this observation is sufficient evidence, call research_resource once with action=record, evidence_refs=["${toolCallId}"], and continue_with mode=calendar_batch; otherwise continue directly without research or change.`,
				cost_model: { direct_bridge_processes: "remaining_uses", batch_bridge_processes: 1,
					decision_model_requests: 1, break_even_remaining_uses: 3 },
				input_shape: "events[{user,summary,time_start,time_end}]",
				no_change_valid: true,
			}
			: undefined;
		if (decisionSupport) {
			if (decisionSupportEmitted.has(decisionSupport.candidate_mode)) decisionSupport = undefined;
			else decisionSupportEmitted.add(decisionSupport.candidate_mode);
		}
		const record: ExecutionObservation = { event_id: toolCallId, tool, operation, status, outcome,
			error_kind: errorKind, category,
			relevant_capability: category === "task_action" ? "execution_tool_surface" : undefined,
			decision_support: decisionSupport,
			attempted_work_units: workUnits?.attempted,
			completed_work_units: workUnits?.completed,
			result_summary: summarize(result), recordedAt: new Date().toISOString() };
		executionObservations.set(toolCallId, record);
		appendJsonl("execution-observations.jsonl", record);
		observeEffectWindow(record);
		return record;
	};
	const visibleObservation = (text: string, observation: ExecutionObservation) => {
		const card = { observation_id: observation.event_id, operation: observation.operation,
			outcome: observation.outcome, error_kind: observation.error_kind,
			attempted_work_units: observation.attempted_work_units,
			completed_work_units: observation.completed_work_units,
			relevant_capability: observation.relevant_capability,
			decision_support: observation.decision_support };
		return `${text}\n\nEXECUTION_OBSERVATION: ${JSON.stringify(card)}`;
	};

	const snapshot = (stage: "before" | "after" | "observed", observedBy: string) => {
		const value = {
			stage,
			primitive: "evidence_policy",
			value: evidencePolicy,
			scope: "one_pi_agent_process",
			observedBy,
			toolCallId: lastEvidenceMutationCallId,
			activeTools: pi.getActiveTools(),
		};
		writeFileSync(join(nativeRoot, `${stage}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
		return value;
	};
	const surfaceSnapshot = (stage: "before" | "after" | "observed", observedBy: string) => {
		const activeTools = pi.getActiveTools();
		const value = { stage, primitive: "execution_tool_surface", value: executionSurface,
			scope: "one_pi_agent_process", observedBy, toolCallId: lastSurfaceMutationCallId,
			activeTools,
			decision_id: lastSurfaceAdjustment?.decisionId,
			basis_resource_ids: lastSurfaceAdjustment?.basisResourceIds,
			basis: lastSurfaceAdjustment?.basisResourceIds.join(", "),
			expected: lastSurfaceAdjustment?.expectedEffect,
			reconsider_when: lastSurfaceAdjustment?.reconsiderWhen,
			operation: lastSurfaceAdjustment ? {
				capability: "pi.setActiveTools", previous: lastSurfaceAdjustment.previous,
				value: lastSurfaceAdjustment.value,
			} : undefined,
			consequence: stage === "observed"
				? { status: "observed_by_next_model_request", activeTools }
				: { status: "pending_next_model_request", activeTools },
		};
		writeFileSync(join(nativeRoot, `surface-${stage}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
		return value;
	};
	const recordSurfaceDecision = (
		toolCallId: string,
		params: SurfaceDecisionParams,
		decisionPath: "decide_execution_surface" | "research_resource.continue_with",
	) => {
		const unknown = params.basis_resource_ids.filter((findingId) => !findings.has(findingId));
		if (unknown.length) throw new Error(`Unknown task-local finding refs: ${unknown.join(", ")}`);
		const unavailable = params.basis_resource_ids.filter(
			(findingId) => findings.get(findingId)?.status !== "active",
		);
		if (unavailable.length) {
			throw new Error(`Harness decisions require latest active finding versions: ${unavailable.join(", ")}`);
		}
		const basisSnapshots = params.basis_resource_ids.map((findingId) => {
			const finding = findings.get(findingId)!;
			return {
				finding_id: finding.finding_id,
				goal_id: finding.goal_id,
				version: finding.version,
				research_event_id: finding.research_event_id,
				evidence_refs: finding.evidence_refs,
				assessment_refs: finding.assessment_refs,
			};
		});
		if (pendingEffectWindow) finishEffectWindow("superseded");
		const previous = executionSurface;
		const decisionId = `decision-${++decisionCounter}`;
		if (params.choice === "keep" && params.mode !== previous) {
			throw new Error(`keep must name the current execution surface (${previous})`);
		}
		const batchPairIsValid =
			(params.mode === "calendar_batch" && params.effect_metric === "calendar_batch_utilization")
			|| (params.mode === "email_batch" && params.effect_metric === "email_batch_utilization")
			|| (!params.mode.endsWith("_batch") && !params.effect_metric.endsWith("_batch_utilization"));
		if (!batchPairIsValid) throw new Error("batch surface and utilization metric must match");
		const applied = params.choice === "apply";
		if (applied) {
			executionSurface = params.mode;
			lastSurfaceMutationCallId = toolCallId;
			lastSurfaceAdjustment = { decisionId, choice: params.choice,
				basisResourceIds: params.basis_resource_ids, expectedEffect: params.expected_effect,
				effectMetric: params.effect_metric, observationHorizon: params.observation_horizon,
				reconsiderWhen: params.reconsider_when, previous, value: params.mode };
			pi.setActiveTools(toolSurfaces[params.mode]);
			surfaceSnapshot("after", `${decisionPath}_tool`);
			const evidenceIds = basisSnapshots.flatMap((snapshot) => snapshot.evidence_refs);
			const baseline = evidenceIds.map((eventId) => executionObservations.get(eventId))
				.filter((observation): observation is ExecutionObservation => Boolean(observation));
			pendingEffectWindow = {
				decisionId, toolCallId, basisResourceIds: params.basis_resource_ids,
				basisSnapshots,
				expectedEffect: params.expected_effect, effectMetric: params.effect_metric,
				horizon: params.observation_horizon, mode: params.mode,
				baselineCalls: baseline.length,
				baselineSemanticErrors: baseline.filter((observation) => observation.outcome !== "success").length,
				observationIds: [], semanticErrors: 0, focusedToolCalls: 0,
				batchToolCalls: 0, attemptedWorkUnits: 0, completedWorkUnits: 0,
			};
		}
		const decision = { decision_id: decisionId, capability_id: "execution_tool_surface",
			toolCallId, decision_path: decisionPath, choice: params.choice, applied,
			basis_resource_ids: params.basis_resource_ids, basis_snapshots: basisSnapshots,
			previous, value: applied ? params.mode : previous,
			expected_effect: params.expected_effect, effect_metric: params.effect_metric,
			observation_horizon: params.observation_horizon, reconsider_when: params.reconsider_when,
			recordedAt: new Date().toISOString() };
		appendJsonl("harness-decisions.jsonl", decision);
		const details = { primitive: "execution_tool_surface", previous, value: decision.value,
			choice: params.choice, applied, changed: applied && previous !== params.mode, decision_id: decisionId,
			decision_path: decisionPath, basis_resource_ids: params.basis_resource_ids,
			basis_snapshots: basisSnapshots,
			expected: params.expected_effect, reconsider_when: params.reconsider_when,
			effectiveAt: applied ? "next_model_request" : "not_changed", activeTools: pi.getActiveTools(),
			consequence: applied ? "pending_observation" : "kept_current_surface",
			improvement: "not_established" };
		return { decision, details };
	};

	pi.on("before_agent_start", async (event) => {
		if (!baselineWritten) {
			// Registered tools can be held inactive by Pi without changing its protocol.
			// This establishes the initial surface; only an agent decision can enable batch later.
			pi.setActiveTools(toolSurfaces.general);
			snapshot("before", "before_agent_start");
			surfaceSnapshot("before", "before_agent_start");
			baselineWritten = true;
		}
		return {
			systemPrompt:
				`${event.systemPrompt}\n\n` +
				`${method}\n\n` +
				`Current task resource catalog (bounded authoritative initial disclosure): ${JSON.stringify(taskResourceCatalog)}\n\n` +
				"This catalog already contains the relevant exact action contracts, task-language conventions, and bounded relative-path inventory. Use its listed paths directly and do not spend calls rediscovering the inventory or querying the complete canonical contract. Treat the catalog as settled execution semantics and proceed without searching for alternate hidden interpretations. " +
				`Initial task-local Pi tools: ${pi.getActiveTools().join(", ")}. The live tool schema is authoritative if this set changes. ` +
				"The current case testbed is the only task workspace. Do not inspect sibling runs, benchmark data or scoring sources, or project implementation files; they are outside the task-resource boundary and are unnecessary because the artifact contract states the supported behavior. " +
				"The listed Pi tools describe actual task-local capabilities. task_notes and research_resource are optional current-task resources, not required research steps. When a material uncertainty must be investigated before a later decision, research_resource can open a bounded goal, then update, resolve, or reopen its stable versioned finding as evidence arrives. A direct evidence-backed record remains valid when no prospective goal would help. " +
				"Task-action results end with compact EXECUTION_OBSERVATION cards whose observation_id can be cited by research_resource. " +
				"A decision_support field makes a relevant finding-to-capability connection visible; it is an option, not a requirement or proof that changing is worthwhile. " +
				"Initially inactive calendar_batch_action and email_batch_action capabilities can each perform 2-16 real repeated writes through one Pi call and one Python bridge process. A successful structured source read or direct action may expose decision_support for the relevant batch mode. When remaining work meets that card's disclosed break-even and the observation is sufficient evidence, one research_resource action=record with continue_with can record the finding and apply or keep in the same call; the selected batch mode becomes visible on the next request. The separate decide_execution_surface tool remains available when the choice is deferred. No research or change remains valid when its benefit does not exceed the decision cost. calendar_focused only removes the broad tool. " +
				"Pi automatically requests the model again after each tool result. Therefore, when a batch adjustment is worthwhile, call research_resource.continue_with once, end that deliberation, and use the newly visible batch tool on the immediately following request; do not repeatedly reconsider before the declared reconsider condition. " +
				"An apply takes effect before the next model request and starts the declared bounded effect window; its assessment is returned to this task when available. A system assessment remains pending until an agent-authored research update or resolution cites its assessment ID; absorb, reject, or leave it pending explicitly instead of treating the runtime metric as an automatic research conclusion. " +
				"Routine one-off observations need no finding or decision, and no research or harness change is required. " +
				"Use workspace_file_action for bounded testbed listing and text reads; broad shell execution is unavailable because it cannot be reliably confined. All task actions must use an available task tool. Finish with a concise natural-language answer after required artifact changes are complete.",
		};
	});

	// Public Pi hook: the next model request sees the current policy, including
	// continuations within the same prompt. This is guidance, not enforcement.
	pi.on("context", async (event) => {
		const guidance = evidencePolicy === "source_and_date"
			? "Retain source identifiers and dates/times when interpreting evidence. Before drawing a conclusion, check that records refer to the relevant participants and date range; mark missing provenance or temporal ambiguity explicitly."
			: "Summarize relevant evidence concisely while preserving facts necessary for the task. Do not invent missing facts.";
		if (lastEvidenceMutationCallId) snapshot("observed", "context_hook_before_model_request");
		const shouldObserveSurface = lastSurfaceMutationCallId
			&& !observedSurfaceCalls.has(lastSurfaceMutationCallId);
		const surfaceObservation = shouldObserveSurface
			? surfaceSnapshot("observed", "context_hook_before_model_request")
			: undefined;
		const messages = [...event.messages, {
			role: "user" as const,
			content: [{ type: "text" as const, text: `Current task-local evidence guidance (${evidencePolicy}): ${guidance}` }],
			timestamp: Date.now(),
		}];
		if (surfaceObservation) {
			observedSurfaceCalls.add(lastSurfaceMutationCallId!);
			const persistedObservation = {
				observation_id: `harness-observation-${++harnessObservationCounter}`,
				decision_id: surfaceObservation.decision_id,
				toolCallId: surfaceObservation.toolCallId,
				basis_resource_ids: surfaceObservation.basis_resource_ids,
				effect_observed: true,
				operation: surfaceObservation.operation,
				consequence: surfaceObservation.consequence,
				recordedAt: new Date().toISOString(),
			};
			appendJsonl("harness-observations.jsonl", persistedObservation);
			messages.push({
				role: "user" as const,
				content: [{ type: "text" as const, text: `Task-local execution condition observation: ${JSON.stringify({
					basis_resource_ids: surfaceObservation.basis_resource_ids,
					decision_id: surfaceObservation.decision_id,
					operation: surfaceObservation.operation,
					consequence: surfaceObservation.consequence,
				})}` }],
				timestamp: Date.now(),
			});
		}
		const pendingAssessments = [...effectAssessments.values()]
			.filter((assessment) => !absorbedEffectAssessments.has(String(assessment.effect_assessment_id)))
			.slice(-5)
			.map((assessment) => {
				const window = assessment.window as Record<string, unknown> | undefined;
				return {
					effect_assessment_id: assessment.effect_assessment_id,
					decision_id: assessment.decision_id,
					basis_resource_ids: assessment.basis_resource_ids,
					effect_metric: assessment.effect_metric,
					verdict: assessment.verdict,
					observation_ids: window?.observation_ids,
					completed_work_units: window?.completed_work_units,
					tool_call_compression: window?.tool_call_compression,
				};
			});
		if (pendingAssessments.length) {
			messages.push({
				role: "user" as const,
				content: [{ type: "text" as const,
					text: `Pending task-local execution condition effects (cite assessment_refs in research_resource to absorb): ${JSON.stringify(pendingAssessments)}` }],
				timestamp: Date.now(),
			});
		}
		if (findings.size) {
			const digest = [...findings.values()].filter((finding) => finding.status !== "resolved").slice(-5)
				.map(({ goal_id, finding_id, version, status, question, scope, uncertainty, evidence_plan,
					evidence, evidence_refs, assessment_refs, expected_recurrence, remaining_uses, decision }) =>
					({ goal_id, finding_id, version, status, question, scope, uncertainty,
						evidence_plan: status === "open" ? evidence_plan : undefined,
						evidence, evidence_refs, assessment_refs, expected_recurrence, remaining_uses, decision }));
			if (digest.length) {
				messages.push({
					role: "user" as const,
					content: [{ type: "text" as const, text: `Active task-local execution findings: ${JSON.stringify(digest)}` }],
					timestamp: Date.now(),
				});
			}
		}
		return {
			messages,
		};
	});

	pi.on("agent_settled", async () => {
		if (pendingEffectWindow) finishEffectWindow("task_settled");
	});

	pi.registerTool({
		name: "task_artifact_contract",
		label: "Task Artifact Contract",
		description: "Read the formal current-task backend contract without inspecting implementation or scoring sources. query='index' lists action keys; query='scope' returns the resource boundary; query='task_language_conventions' returns generic task-language mapping rules; or query an exact action such as calendar.create_event, email.send_email, excel.read_file, word.write_to_file, or pdf.read_file. This resource does not change execution conditions.",
		parameters: Type.Object({ query: Type.String() }),
		async execute(toolCallId, params) {
			const actions = (artifactContract.actions ?? {}) as Record<string, unknown>;
			let value: unknown;
			if (params.query === "index") value = { actions: Object.keys(actions), sections: ["scope", "task_language_conventions"] };
			else if (params.query === "scope") value = artifactContract.scope;
			else if (params.query === "task_language_conventions") value = artifactContract.task_language_conventions;
			else value = actions[params.query];
			const found = value !== undefined;
			const text = JSON.stringify(found ? { query: params.query, contract: value }
				: { semantic_error: "unknown_contract_entry", query: params.query, available_actions: Object.keys(actions) });
			const observation = recordExecutionObservation(toolCallId, "task_artifact_contract", params.query,
				"completed", text, found ? "success" : "semantic_error", found ? undefined : "unknown_contract_entry", "resource");
			return { content: [{ type: "text", text: visibleObservation(text, observation) }],
				details: { query: params.query, found, observation } };
		},
	});

	const resolveTaskFile = (rawPath: string) => {
		if (!rawPath.trim() || isAbsolute(rawPath)) {
			throw new TaskResourceBoundaryError("path must be relative to the current testbed");
		}
		const candidate = resolve(testbedRoot, rawPath);
		const lexicalRelative = relative(testbedRoot, candidate);
		if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
			|| isAbsolute(lexicalRelative)) {
			throw new TaskResourceBoundaryError("path leaves the current testbed");
		}
		if (existsSync(candidate)) {
			if (lstatSync(candidate).isSymbolicLink()) throw new TaskResourceBoundaryError("symbolic links are outside the task-resource contract");
			const actual = realpathSync(candidate);
			const actualRelative = relative(realpathSync(testbedRoot), actual);
			if (actualRelative === ".." || actualRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
				|| isAbsolute(actualRelative)) {
				throw new TaskResourceBoundaryError("resolved path leaves the current testbed");
			}
		}
		return candidate;
	};

	pi.registerTool({
		name: "workspace_file_action",
		label: "Task Workspace Files",
		description: "Inspect files only inside the current OfficeBench testbed. action=list_files lists up to 200 entries under a relative directory without following symbolic links. action=read_text reads one UTF-8 text file up to 262144 bytes. Use OfficeBench excel/word/pdf/ocr actions for binary documents. Attempts to use absolute paths, .. traversal, symlinks, sibling runs, benchmark sources, scoring sources, or project source return task_resource_boundary_violation.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list_files"), Type.Literal("read_text")]),
			path: Type.String(),
			recursive: Type.Optional(Type.Boolean()),
		}),
		async execute(toolCallId, params) {
			try {
				const target = resolveTaskFile(params.path || ".");
				let text: string;
				if (params.action === "read_text") {
					const stat = lstatSync(target);
					if (!stat.isFile()) throw new Error("read_text target is not a regular file");
					if (stat.size > 262_144) throw new Error("read_text target exceeds 262144 bytes");
					text = readFileSync(target, "utf8");
				} else {
					const stat = lstatSync(target);
					if (!stat.isDirectory()) throw new Error("list_files target is not a directory");
					const entries: Array<{ path: string; kind: "file" | "directory"; size?: number }> = [];
					const walk = (directory: string) => {
						for (const entry of readdirSync(directory, { withFileTypes: true })) {
							if (entries.length >= 200) return;
							const child = join(directory, entry.name);
							if (entry.isSymbolicLink()) continue;
							const childRelative = relative(testbedRoot, child).replace(/\\/g, "/");
							if (entry.isDirectory()) {
								entries.push({ path: `${childRelative}/`, kind: "directory" });
								if (params.recursive) walk(child);
							} else if (entry.isFile()) {
								entries.push({ path: childRelative, kind: "file", size: lstatSync(child).size });
							}
						}
					};
					walk(target);
					text = JSON.stringify({ root: params.path || ".", entries, truncated: entries.length >= 200 });
				}
				const observation = recordExecutionObservation(toolCallId, "workspace_file_action", params.action,
					"completed", text, "success", undefined, "resource");
				return { content: [{ type: "text", text: visibleObservation(text, observation) }],
					details: { action: params.action, path: params.path, observation } };
			} catch (error) {
				const errorKind = error instanceof TaskResourceBoundaryError
					? "task_resource_boundary_violation" : "resource_access_error";
				const text = JSON.stringify({ semantic_error: errorKind, reason: String(error) });
				const observation = recordExecutionObservation(toolCallId, "workspace_file_action", params.action,
					"completed", text, "semantic_error", errorKind, "resource");
				return { content: [{ type: "text", text: visibleObservation(text, observation) }],
					details: { action: params.action, path: params.path, observation } };
			}
		},
	});

	pi.registerTool({
		name: "research_resource",
		label: "Research Resource",
		description: "Optional versioned current-task research resource. Always choose action. action=open records a bounded question, scope, uncertainty and evidence_plan before evidence exists. action=record creates one active evidence-backed finding when exploration already produced a conclusion. action=update adds known task observation IDs or pending effect assessment IDs; action=resolve records the final supported, contradicted, inconclusive, or no-longer-relevant judgment; action=reopen resumes a resolved goal after new evidence. When exactly one unresolved goal exists, update/resolve may omit finding_id and target_version; otherwise cite both from the active digest. Only an active evidence-backed record/update may use continue_with. Runtime effect assessments remain pending until cited in assessment_refs.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("record"), Type.Literal("open"), Type.Literal("update"), Type.Literal("resolve"), Type.Literal("reopen")]),
			finding_id: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			question: Type.Optional(Type.String()), scope: Type.Optional(Type.String()),
			uncertainty: Type.Optional(Type.String()),
			evidence_plan: Type.Array(Type.String(), { maxItems: 8 }),
			evidence: Type.Optional(Type.String()), decision: Type.Optional(Type.String()),
			evidence_refs: Type.Array(Type.String()),
			assessment_refs: Type.Array(Type.String()),
			expected_recurrence: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			remaining_uses: Type.Optional(Type.Integer({ minimum: 0 })),
			resolution: Type.Optional(Type.Union([Type.Literal("supported"), Type.Literal("contradicted"), Type.Literal("inconclusive"), Type.Literal("no_longer_relevant")])),
			continue_with: Type.Optional(Type.Object({
				choice: Type.Union([Type.Literal("apply"), Type.Literal("keep")]),
				mode: Type.Union([Type.Literal("general"), Type.Literal("calendar_focused"), Type.Literal("calendar_batch"), Type.Literal("email_batch")]),
				expected_effect: Type.String(),
				effect_metric: Type.Union([Type.Literal("semantic_error_rate"), Type.Literal("focused_tool_use_rate"), Type.Literal("calendar_batch_utilization"), Type.Literal("email_batch_utilization")]),
				observation_horizon: Type.Integer({ minimum: 1, maximum: 8 }),
				reconsider_when: Type.String(),
			})),
		}),
		async execute(toolCallId, params) {
			const action = params.action as ResearchAction;
			const requiredString = (value: unknown, name: string) => {
				if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required for research action ${action}`);
				return value.trim();
			};
			const evidenceRefs = [...new Set(params.evidence_refs ?? [])];
			const assessmentRefs = [...new Set(params.assessment_refs ?? [])];
			const unknownEvidence = evidenceRefs.filter((eventId) => !executionObservations.has(eventId));
			if (unknownEvidence.length) throw new Error(`Unknown task-local evidence refs: ${unknownEvidence.join(", ")}`);
			const unknownAssessments = assessmentRefs.filter((assessmentId) => !effectAssessments.has(assessmentId));
			if (unknownAssessments.length) throw new Error(`Unknown task-local assessment refs: ${unknownAssessments.join(", ")}`);
			const continueWith = params.continue_with;
			let record: ResearchFinding;
			if (action === "open") {
				if (params.finding_id) throw new Error("open creates a new finding_id; do not supply one");
				if (continueWith) throw new Error("open cannot change the harness before evidence is recorded");
				const question = requiredString(params.question, "question");
				const scope = requiredString(params.scope, "scope");
				const uncertainty = requiredString(params.uncertainty, "uncertainty");
				const evidencePlan = params.evidence_plan.map((value) => requiredString(value, "evidence_plan item"));
				if (!evidencePlan.length) throw new Error("evidence_plan is required for research action open");
				const findingOrdinal = ++findingCounter;
				record = {
					research_event_id: `research-event-${++researchEventCounter}`,
					action, version: 1,
					goal_id: `research-goal-${findingOrdinal}`, finding_id: `finding-${findingOrdinal}`,
					question, scope, uncertainty, evidence_plan: evidencePlan,
					evidence: params.evidence?.trim() || "", decision: params.decision?.trim() || "",
					evidence_refs: evidenceRefs, assessment_refs: assessmentRefs,
					expected_recurrence: params.expected_recurrence ?? "medium",
					remaining_uses: params.remaining_uses ?? 0,
					status: "open", recordedAt: new Date().toISOString(), source: "task_agent",
				};
			} else if (action === "record") {
				if (!evidenceRefs.length) throw new Error("evidence_refs is required for the evidence-backed record form");
				const question = requiredString(params.question, "question");
				const uncertainty = requiredString(params.uncertainty, "uncertainty");
				const evidence = requiredString(params.evidence, "evidence");
				const decision = requiredString(params.decision, "decision");
				const findingOrdinal = ++findingCounter;
				record = {
					research_event_id: `research-event-${++researchEventCounter}`,
					action, version: 1,
					goal_id: `research-goal-${findingOrdinal}`, finding_id: `finding-${findingOrdinal}`,
					question,
					scope: params.scope?.trim() || "current task execution decision",
					uncertainty, evidence_plan: params.evidence_plan,
					evidence, decision,
					evidence_refs: evidenceRefs, assessment_refs: assessmentRefs,
					expected_recurrence: params.expected_recurrence ?? "medium",
					remaining_uses: params.remaining_uses ?? 0,
					status: "active", recordedAt: new Date().toISOString(), source: "task_agent",
				};
			} else {
				let findingId = params.finding_id?.trim();
				if (!findingId) {
					const unresolved = [...findings.values()].filter((finding) => finding.status !== "resolved");
					if (unresolved.length !== 1) {
						throw new Error(`finding_id is required when ${unresolved.length} unresolved findings exist`);
					}
					findingId = unresolved[0].finding_id;
				}
				const current = findings.get(findingId);
				if (!current) throw new Error(`Unknown task-local finding ref: ${findingId}`);
				if (params.target_version !== undefined && params.target_version !== current.version) {
					throw new Error(`target_version must match latest ${findingId} version ${current.version}`);
				}
				if (action === "reopen" && current.status !== "resolved") throw new Error("reopen requires a resolved finding");
				if (action !== "reopen" && current.status === "resolved") throw new Error("resolved findings can only be reopened");
				if (!evidenceRefs.length && !assessmentRefs.length) {
					throw new Error(`${action} must cite new evidence_refs or assessment_refs`);
				}
				if (continueWith && action !== "update") throw new Error("only an active update may use continue_with");
				const status: ResearchStatus = action === "resolve" ? "resolved" : action === "reopen" ? "open" : "active";
				record = {
					...current,
					research_event_id: `research-event-${++researchEventCounter}`,
					action, version: current.version + 1, supersedes_event_id: current.research_event_id,
					question: params.question?.trim() || current.question,
					scope: params.scope?.trim() || current.scope,
					uncertainty: params.uncertainty?.trim() || current.uncertainty,
					evidence_plan: params.evidence_plan ?? current.evidence_plan,
					evidence: params.evidence?.trim() || current.evidence,
					decision: params.decision?.trim() || current.decision || (continueWith
						? `${continueWith.choice} ${continueWith.mode}: ${continueWith.expected_effect}` : ""),
					evidence_refs: [...new Set([...current.evidence_refs, ...evidenceRefs])],
					assessment_refs: [...new Set([...current.assessment_refs, ...assessmentRefs])],
					expected_recurrence: params.expected_recurrence ?? current.expected_recurrence,
					remaining_uses: params.remaining_uses ?? current.remaining_uses,
					status,
					resolution: action === "resolve" ? params.resolution : undefined,
					recordedAt: new Date().toISOString(), source: "task_agent",
				};
				if (action === "resolve" && !record.resolution) throw new Error("resolution is required for research action resolve");
				if (action === "update") requiredString(record.evidence, "evidence");
				if (action === "resolve") requiredString(record.decision, "decision");
			}
			findings.set(record.finding_id, record);
			appendJsonl("research-resources.jsonl", record);
			for (const assessmentId of assessmentRefs) absorbedEffectAssessments.add(assessmentId);
			if (continueWith) {
				if (record.status !== "active" || !record.evidence_refs.length) {
					throw new Error("continue_with requires an active finding with execution evidence_refs");
				}
				const surfaceDecision = recordSurfaceDecision(toolCallId, {
					...continueWith, basis_resource_ids: [record.finding_id],
				}, "research_resource.continue_with");
				const text = `${JSON.stringify(record)}\n\nEXECUTION_SURFACE_DECISION: ${JSON.stringify(surfaceDecision.details)}`;
				return { content: [{ type: "text", text }],
					details: { ...record, surface_decision: surfaceDecision.details } };
			}
			if (record.status !== "active") {
				const marker = record.status === "resolved" ? "RESEARCH_GOAL_RESOLVED" : "RESEARCH_GOAL_OPEN";
				const text = `${JSON.stringify(record)}\n\n${marker}: ${JSON.stringify({
					goal_id: record.goal_id, finding_id: record.finding_id, version: record.version,
					status: record.status, next_action: record.status === "open" ? "gather planned evidence, then update" : "none",
				})}`;
				return { content: [{ type: "text", text }], details: record };
			}
			const alternativeModes = (["general", "calendar_focused", "calendar_batch", "email_batch"] as SurfaceMode[])
				.filter((mode) => mode !== executionSurface);
			const decisionPoint = {
				finding_id: record.finding_id,
				capability_id: "execution_tool_surface",
				current_surface: executionSurface,
				decision_tool: "decide_execution_surface",
				choices: [
					{ choice: "keep", mode: executionSurface, effect: "record the reason and leave later model requests unchanged" },
					...alternativeModes.map((mode) => ({ choice: "apply", mode,
						effect: mode === "calendar_batch"
							? "call pi.setActiveTools now; enable one-call multi-event creation before the next model request"
							: mode === "email_batch"
								? "call pi.setActiveTools now; enable one-call multi-email sending before the next model request"
							: "call pi.setActiveTools now; the changed tool set is visible before the next model request" })),
				],
				weigh: { expected_recurrence: record.expected_recurrence, remaining_uses: record.remaining_uses },
				no_change_valid: true,
			};
			const text = `${JSON.stringify(record)}\n\nEXECUTION_DECISION_POINT: ${JSON.stringify(decisionPoint)}`;
			return { content: [{ type: "text", text }], details: { ...record, decision_point: decisionPoint } };
		},
	});

	pi.registerTool({
		name: "task_notes",
		label: "Task Working Notes",
		description: "Read the current task's working notes (text=''), or append a free-text note. Optional place for questions, evidence references, findings, adjustment reasons and later observations. These are agent-authored claims, not independently verified findings. No required format; no cross-task inheritance.",
		// Keep the parameter required: some OpenAI-compatible gateways reject the
		// null/optional schema emitted for an empty tool parameter object.
		parameters: Type.Object({ text: Type.String() }),
		async execute(toolCallId, params) {
			if (params.text.trim()) {
				appendFileSync(join(outputRoot, "task-notes.md"), `${params.text}\n\n`, "utf8");
				taskNotes += `${params.text}\n\n`;
			}
			const text = taskNotes || "No task notes recorded.";
			const observation = recordExecutionObservation(toolCallId, "task_notes",
				params.text.trim() ? "append" : "read", "completed", text, "success", undefined, "resource");
			return { content: [{ type: "text", text: visibleObservation(text, observation) }],
				details: { appended: Boolean(params.text.trim()), observation } };
		},
	});

	pi.registerTool({
		name: "decide_execution_surface",
		label: "Decide Execution Tool Surface",
		description: "After recording a relevant task finding, explicitly choose apply or keep. A non-empty basis_resource_ids list must reference prior active findings. apply changes later Pi requests with pi.setActiveTools; keep records why the current surface remains preferable and makes no change. calendar_batch and email_batch enable the matching initially inactive repeated-write tool, calendar_focused removes broad officebench_action, and general restores the initial tools. Declare an effect metric, a bounded observation horizon, and when to reconsider. Pair each batch surface with its matching utilization metric. Research and this decision are optional.",
		parameters: Type.Object({
			choice: Type.Union([Type.Literal("apply"), Type.Literal("keep")]),
			mode: Type.Union([Type.Literal("general"), Type.Literal("calendar_focused"), Type.Literal("calendar_batch"), Type.Literal("email_batch")]),
			basis_resource_ids: Type.Array(Type.String(), { minItems: 1 }),
			expected_effect: Type.String(),
			effect_metric: Type.Union([Type.Literal("semantic_error_rate"), Type.Literal("focused_tool_use_rate"), Type.Literal("calendar_batch_utilization"), Type.Literal("email_batch_utilization")]),
			observation_horizon: Type.Integer({ minimum: 1, maximum: 8 }),
			reconsider_when: Type.String(),
		}),
		async execute(toolCallId, params) {
			const { details } = recordSurfaceDecision(
				toolCallId, params as SurfaceDecisionParams, "decide_execution_surface",
			);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	const runOfficeBenchAction = (params: { app: string; action: string; args: Record<string, unknown> }): BridgeResult => {
		const child = spawnSync(jitPython, ["-m", "autoresearch_pi.officebench_tool_bridge"], {
			cwd: jitRoot, encoding: "utf8", input: JSON.stringify({ workspace, ...params }), env: process.env, timeout: 120_000,
		});
		if (child.error || child.status !== 0) throw new Error(child.error?.message ?? (child.stderr || `OfficeBench bridge exited ${child.status}`));
		const result = JSON.parse(child.stdout) as BridgeResult;
		if (!result || typeof result.text !== "string" || !["success", "semantic_error"].includes(result.outcome)) {
			throw new Error("OfficeBench bridge returned an invalid structured result");
		}
		return result;
	};
	const runOfficeBenchBatch = (
		app: "calendar" | "email", action: "create_event" | "send_email", items: Array<Record<string, unknown>>,
	): BridgeResult[] => {
		const actions = items.map((args) => ({ app, action, args }));
		const child = spawnSync(jitPython, ["-m", "autoresearch_pi.officebench_tool_bridge"], {
			cwd: jitRoot, encoding: "utf8", input: JSON.stringify({ workspace, actions }), env: process.env, timeout: 120_000,
		});
		if (child.error || child.status !== 0) throw new Error(child.error?.message ?? (child.stderr || `OfficeBench batch bridge exited ${child.status}`));
		const result = JSON.parse(child.stdout) as BridgeBatchResult;
		if (!result || result.batch !== true || !Array.isArray(result.results)
			|| result.results.length !== items.length
			|| result.results.some((item) => typeof item.text !== "string" || !["success", "semantic_error"].includes(item.outcome))) {
			throw new Error("OfficeBench batch bridge returned an invalid structured result");
		}
		return result.results;
	};

	pi.registerTool({
		name: "calendar_batch_action",
		label: "Calendar Batch Action",
		description: "Execute 2-16 real JIT calendar.create_event operations through one Pi tool call and one Python bridge process. This tool is initially inactive and appears only after a finding-backed calendar_batch surface decision. Results remain per-user and non-atomic: inspect every item because successful earlier writes are not rolled back if a later item fails.",
		parameters: Type.Object({
			events: Type.Array(Type.Object({
				user: Type.String(), summary: Type.String(),
				time_start: Type.String(), time_end: Type.String(),
			}), { minItems: 2, maxItems: 16 }),
		}),
		async execute(toolCallId, params) {
			let results: Array<{ index: number; user: string; outcome: ObservationOutcome; error_kind?: string; text: string }>;
			try {
				results = runOfficeBenchBatch("calendar", "create_event", params.events).map((result, index) => ({
					index, user: params.events[index].user, outcome: result.outcome,
					error_kind: result.error_kind, text: result.text,
				}));
			} catch (error) {
				results = params.events.map((event, index) => ({ index, user: event.user,
					outcome: "transport_error", error_kind: "bridge_failure", text: String(error) }));
			}
			const completed = results.filter((result) => result.outcome === "success").length;
			const outcome: ObservationOutcome = completed === results.length ? "success"
				: results.some((result) => result.outcome === "transport_error") ? "transport_error" : "semantic_error";
			const text = JSON.stringify({ non_atomic: true, bridge_processes: 1, attempted: results.length, completed, results });
			const observation = recordExecutionObservation(toolCallId, "calendar_batch_action", "create_events",
				"completed", text, outcome, outcome === "success" ? undefined : "partial_batch_failure",
				"task_action", { attempted: results.length, completed });
			return { content: [{ type: "text", text: visibleObservation(text, observation) }],
				details: { executionSurface, nonAtomic: true, bridgeProcesses: 1, results, observation } };
		},
	});

	pi.registerTool({
		name: "email_batch_action",
		label: "Email Batch Action",
		description: "Execute 2-16 real JIT email.send_email operations through one Pi tool call and one Python bridge process. Supply one shared sender, subject, and content_template with {{variable}} placeholders plus one variables map per recipient; Pi expands each message before the bridge call. This tool is initially inactive and appears only after a finding-backed email_batch surface decision. Results are non-atomic and preserve each recipient result. Repeated same-subject sender copies are overwritten, so put a sender's self-addressed personalized recipient last when needed.",
		parameters: Type.Object({
			sender: Type.String(),
			subject: Type.String(),
			content_template: Type.String(),
			recipients: Type.Array(Type.Object({
				recipient: Type.String(),
				variables: Type.Record(Type.String(), Type.String()),
			}), { minItems: 2, maxItems: 16 }),
		}),
		async execute(toolCallId, params) {
			let results: Array<{ index: number; recipient: string; outcome: ObservationOutcome; error_kind?: string; text: string }>;
			const messages = params.recipients.map((item) => ({
				sender: params.sender,
				recipient: item.recipient,
				subject: params.subject,
				content: params.content_template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,
					(_match, key: string) => Object.prototype.hasOwnProperty.call(item.variables, key)
						? item.variables[key] : `{{${key}}}`),
			}));
			try {
				results = runOfficeBenchBatch("email", "send_email", messages).map((result, index) => ({
					index, recipient: messages[index].recipient, outcome: result.outcome,
					error_kind: result.error_kind, text: result.text,
				}));
			} catch (error) {
				results = messages.map((message, index) => ({ index, recipient: message.recipient,
					outcome: "transport_error", error_kind: "bridge_failure", text: String(error) }));
			}
			const completed = results.filter((result) => result.outcome === "success").length;
			const outcome: ObservationOutcome = completed === results.length ? "success"
				: results.some((result) => result.outcome === "transport_error") ? "transport_error" : "semantic_error";
			const text = JSON.stringify({ non_atomic: true, bridge_processes: 1, attempted: results.length, completed, results });
			const observation = recordExecutionObservation(toolCallId, "email_batch_action", "send_emails",
				"completed", text, outcome, outcome === "success" ? undefined : "partial_batch_failure",
				"task_action", { attempted: results.length, completed });
			return { content: [{ type: "text", text: visibleObservation(text, observation) }],
				details: { executionSurface, nonAtomic: true, bridgeProcesses: 1, results, observation } };
		},
	});

	pi.registerTool({
		name: "calendar_action",
		label: "Calendar Action",
		description: "Execute one real JIT OfficeBench calendar action through one Python bridge process. Use action=list_events with args={username:string}, action=create_event with args={user:string,summary:string,time_start:'YYYY-MM-DD HH:MM:SS',time_end:'YYYY-MM-DD HH:MM:SS'}, or action=delete_event with args={user:string,summary:string}. Each create_event changes only that user's calendar. Multiple direct calls in one response still start separate bridge processes. If a prior observation establishes 2-16 similar remaining creates, the optional finding-backed calendar_batch surface may reduce that execution cost; keeping this direct tool is valid. This direct tool remains enabled in calendar_focused and calendar_batch modes.",
		parameters: Type.Object({ action: Type.String(), args: Type.Record(Type.String(), Type.Unknown()) }),
		async execute(toolCallId, params) {
			try {
				const result = runOfficeBenchAction({ app: "calendar", action: params.action, args: params.args });
				const observation = recordExecutionObservation(toolCallId, "calendar_action", params.action,
					"completed", result.text, result.outcome, result.error_kind);
				return { content: [{ type: "text", text: visibleObservation(result.text, observation) }],
					details: { executionSurface, app: "calendar", action: params.action, observation } };
			} catch (error) {
				recordExecutionObservation(toolCallId, "calendar_action", params.action, "failed", String(error), "transport_error", "bridge_failure");
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "email_action",
		label: "Email Action",
		description: "Execute one real JIT OfficeBench email action through one Python bridge process. Use action=send_email with args={sender:string,recipient:string,subject:string,content:string}; exactly one recipient is supported per call and the backend writes a .eml copy for sender and recipient. Use action=list_emails with args={username:string}, or action=read_email with args={username:string,email_id:string}. This direct task tool remains active in general, calendar_focused, and calendar_batch surfaces so a calendar optimization does not remove required email work.",
		parameters: Type.Object({ action: Type.String(), args: Type.Record(Type.String(), Type.Unknown()) }),
		async execute(toolCallId, params) {
			try {
				const result = runOfficeBenchAction({ app: "email", action: params.action, args: params.args });
				const observation = recordExecutionObservation(toolCallId, "email_action", params.action,
					"completed", result.text, result.outcome, result.error_kind);
				return { content: [{ type: "text", text: visibleObservation(result.text, observation) }],
					details: { executionSurface, app: "email", action: params.action, observation } };
			} catch (error) {
				recordExecutionObservation(toolCallId, "email_action", params.action, "failed", String(error),
					"transport_error", "bridge_failure");
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "set_evidence_policy",
		label: "Set Evidence Policy",
		description:
			"Optionally change task-local evidence guidance. summary_only asks for concise relevant evidence; source_and_date asks to retain provenance/time and flag ambiguity. Pi's context hook applies the current setting before the next model request, including within this prompt. Does not change backend data, enforce correctness, or prove improvement. No change is a valid choice; use task_notes for supporting evidence and subsequent observations when useful.",
		parameters: Type.Object({
			value: Type.Union([Type.Literal("summary_only"), Type.Literal("source_and_date")]),
		}),
		async execute(toolCallId, params) {
			const previous = evidencePolicy;
			evidencePolicy = params.value;
			lastEvidenceMutationCallId = toolCallId;
			const result = snapshot("after", "set_evidence_policy_tool");
			const details = { ...result, previous, changed: previous !== evidencePolicy, effectiveAt: "next_model_request", improvement: "not_established" };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	pi.registerTool({
		name: "officebench_action",
		label: "OfficeBench Action",
		description:
			"Execute one real JIT OfficeBench action inside the current case testbed. Inputs are app, action, and args; use relative data/, calendar/, or emails/ paths. Absolute paths and traversal outside the testbed return task_resource_boundary_violation. " +
			"Broad shell.command is unavailable because it cannot reliably enforce the task-resource boundary. Use workspace_file_action for safe listing/text reads and the direct excel/word/pdf/ocr actions for document work. The injected artifact contract is authoritative; do not inspect sibling runs, benchmark/scoring sources, or implementation files. " +
			"For calendar tasks use calendar.list_events with args={username:string}, calendar.create_event with args={user:string,summary:string,time_start:'YYYY-MM-DD HH:MM:SS',time_end:'YYYY-MM-DD HH:MM:SS'}, or calendar.delete_event with args={user:string,summary:string}. " +
			"For email tasks prefer email_action; the equivalent broad actions are email.send_email with args={sender:string,recipient:string,subject:string,content:string}, email.list_emails with args={username:string}, and email.read_email with args={username:string,email_id:string}. " +
			"Each calendar.create_event call changes only the named user's calendar. A singular event request targets the current user; create other users' calendar entries only when the task explicitly asks for them, because email recipients are not implicit calendar targets. " +
			"Use these calendar actions directly; do not inspect the tool implementation or create helper scripts to discover its interface. Shell is only for tasks that actually require filesystem work.",
		parameters: Type.Object({
			app: Type.String(),
			action: Type.String(),
			args: Type.Record(Type.String(), Type.Unknown()),
		}),
		async execute(toolCallId, params) {
			try {
				const result = runOfficeBenchAction(params);
				const observation = recordExecutionObservation(toolCallId, "officebench_action",
					`${params.app}.${params.action}`, "completed", result.text, result.outcome, result.error_kind);
				return { content: [{ type: "text", text: visibleObservation(result.text, observation) }],
					details: { evidencePolicy, app: params.app, action: params.action, observation } };
			} catch (error) {
				recordExecutionObservation(toolCallId, "officebench_action",
					`${params.app}.${params.action}`, "failed", String(error), "transport_error", "bridge_failure");
				throw error;
			}
		},
	});
}
