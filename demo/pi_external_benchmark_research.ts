/** Shared task-local Auto-Research resources for external Pi benchmarks. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { arcActionCoordinates } from "./pi_arc_action_input.ts";
import { compactToolSchema } from "./pi_compact_tool_schema.ts";
import { installAgentOwnedObservationCompaction, OBSERVATION_COMPACTION_TOOL } from "./pi_agent_owned_observation_compaction.ts";
import { classifyExecutionSignals, summarizeExecutionSignals, type ExecutionSignal } from "./pi_task_execution_signals.ts";
import {
	derivePatternCandidateUpdates,
	deriveResearchRevisionCandidateUpdates,
	patternCandidateDigest,
	type PatternCandidate,
} from "./pi_task_pattern_candidates.ts";
import { buildResearchGraph, validateResearchRelations } from "./pi_task_research_graph.ts";
import {
	HARNESS_BOOTSTRAP_TOOL,
	installTaskLocalSelfHarness,
	renderTaskSystemPromptOverlay,
	taskKnowledgeEntries,
	SELF_HARNESS_MANAGEMENT_TOOLS,
	INTERNAL_NATIVE_HARNESS_TOOLS,
} from "./pi_task_local_self_harness.ts";
import type { TaskToolAdapter } from "./pi_task_local_tools.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";
import { installTaskLocalContextLifecycle } from "./pi_task_local_context_lifecycle.ts";
import { installTaskResourceReader, resolveTaskResource } from "./pi_task_resource_store.ts";
import { readWorkset } from "./pi_read_workset.ts";
import { decisionCardV2 } from "./pi_decision_card.ts";
import { checkpointDecisionPatch, decisionForecastProperties, decisionStateSchema, normalizeDecisionKnowledge, patchDecisionState } from "./pi_decision_state.ts";
import { reviewProgress } from "./pi_harness_review.ts";
import { installTaskValidation } from "./pi_task_validation.ts";
import { loadPrompt } from "./prompt_loader.ts";
import { admitTaskLocalOperation, noteArcActionCompleted } from "./pi_task_execution_admission.ts";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { bindOperationIdentity, controlError, controlOperationKey, eligibleResearchHandoffStatuses, failureClassification, failureReceipt, pendingFailureProjection, latestControlRecords } from "./pi_harness_control.ts";
import { latestHarnessAssembly } from "./pi_task_harness_assembly.ts";
import { nativeHarnessExecutor } from "./pi_task_harness_route_runtime.ts";
import { memoryValidityContext } from "./pi_memory_validity.ts";
import { readTaskStrategyState, recordTaskStrategyAction, taskStrategyIndex, updateTaskStrategyState } from "./pi_task_strategy_state.ts";
import { buildCompetitionView, persistCompetitionView, recordCompetitionChoice, competitionProjection } from "./pi_task_competition.ts";

type Finding = {
	subject_kind?: "task" | "component" | "composition" | "strategy" | "research_method";
	hypothesis?: string;
	falsifier?: string;
	kind?: "research_goal" | "finding";
	goal_id: string;
	finding_id: string;
	version: number;
	research_event_id: string;
	evidence_refs: string[];
	assessment_refs: string[];
	status: "open" | "active" | "resolved";
	question: string;
	scope: string;
	uncertainty: string;
	evidence_to_seek?: string;
	evidence: string;
	decision: string;
	expected_recurrence: "low" | "medium" | "high";
	remaining_uses: number;
	pinned?: boolean;
	reconsider_when?: string;
	used_in_observation_refs?: string[];
	use_note?: string;
	subject_refs?: string[];
	component_refs?: string[];
	pattern_candidate_refs?: string[];
	parent_goal_id?: string;
	depends_on?: string[];
	resolution?: string;
	recordedAt: string;
};

function textContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content.map((item: any) => item?.type === "text" && typeof item.text === "string" ? item.text : "").join("\n");
}

function compactText(value: unknown, _maximum?: number): string {
	// Normalization only; harness and research payloads have no agent-facing
	// length quota. Provider transport may project/ archive separately, while
	// canonical records remain complete and recoverable.
	return String(value ?? "").replace(/\s+/g, " ").trim();
}

function boundedText(value: unknown, maximum: number): string {
	return compactText(value).slice(0, Math.max(0, maximum));
}

function nextCounter(records: Record<string, unknown>[], key: string): number {
	let largest = 0;
	for (const record of records) {
		const match = String(record[key] ?? "").match(/(\d+)$/);
		if (match) largest = Math.max(largest, Number(match[1]));
	}
	return largest;
}

function projectedFindings(findings: Map<string, Finding>, status: Finding["status"]): Finding[] {
	const newestFirst = [...findings.values()]
		.filter((finding) => finding.status === status && finding.remaining_uses > 0)
		.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)));
	const selected = [
		...newestFirst.filter((finding) => finding.pinned === true),
		...newestFirst.filter((finding) => finding.pinned !== true),
	];
	return selected.sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)));
}

function activeFindingDigest(findings: Map<string, Finding>): Record<string, unknown>[] {
	return projectedFindings(findings, "active")
		.map((finding) => ({
			goal_id: finding.goal_id,
			finding_id: finding.finding_id,
			version: finding.version,
			resource_ref: `${finding.finding_id}@v${finding.version}`,
			...(finding.subject_kind ? { subject_kind: finding.subject_kind } : {}),
			...(finding.hypothesis ? { hypothesis: finding.hypothesis } : {}),
			...(finding.falsifier ? { falsifier: finding.falsifier } : {}),
			question: finding.question,
			scope: finding.scope,
			uncertainty: finding.uncertainty,
			evidence: finding.evidence,
			decision: finding.decision,
			evidence_refs: finding.evidence_refs,
			assessment_refs: finding.assessment_refs,
			expected_recurrence: finding.expected_recurrence,
			remaining_uses: finding.remaining_uses,
			...(finding.pinned ? { pinned: true } : {}),
			...(finding.reconsider_when ? { reconsider_when: finding.reconsider_when } : {}),
			...(finding.used_in_observation_refs?.length
				? { used_in_observation_refs: finding.used_in_observation_refs }
				: {}),
			...(finding.use_note ? { use_note: finding.use_note } : {}),
			...(finding.subject_refs?.length ? { subject_refs: finding.subject_refs } : {}),
			...(finding.component_refs?.length ? { component_refs: finding.component_refs } : {}),
			...(finding.pattern_candidate_refs?.length
				? { pattern_candidate_refs: finding.pattern_candidate_refs }
				: {}),
		}));
}

function openResearchDigest(findings: Map<string, Finding>): Record<string, unknown>[] {
	return projectedFindings(findings, "open")
		.map((finding) => ({
			goal_id: finding.goal_id,
			resource_id: finding.finding_id,
			version: finding.version,
			...(finding.subject_kind ? { subject_kind: finding.subject_kind } : {}),
			...(finding.hypothesis ? { hypothesis: finding.hypothesis } : {}),
			...(finding.falsifier ? { falsifier: finding.falsifier } : {}),
			question: finding.question,
			scope: finding.scope,
			uncertainty: finding.uncertainty,
			evidence_to_seek: finding.evidence_to_seek,
			decision: finding.decision,
			remaining_uses: finding.remaining_uses,
			...(finding.pinned ? { pinned: true } : {}),
			...(finding.reconsider_when ? { reconsider_when: finding.reconsider_when } : {}),
			...(finding.subject_refs?.length ? { subject_refs: finding.subject_refs } : {}),
			...(finding.component_refs?.length ? { component_refs: finding.component_refs } : {}),
		}));
}

export type ExternalBenchmarkResearchHandle = {
	resolveBasisRefs: (references: string[]) => string[];
};

export type ExternalBenchmarkResearchOptions = {
	taskToolAdapter?: TaskToolAdapter;
	baseTools?: string[];
};

export default function externalBenchmarkResearch(
	pi: ExtensionAPI,
	options: ExternalBenchmarkResearchOptions = {},
): ExternalBenchmarkResearchHandle | undefined {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	const taskScope = ensureTaskScope(root);
	installReportedTokenBudget(pi, root);
	const control = process.env.PI_AUTORESEARCH_VARIANT === "control";
	if (control) {
		installProviderTelemetry(pi, { root, scope: "control" });
		return;
	}
	mkdirSync(root, { recursive: true });
	installTaskResourceReader(pi, root);
	const validationLedger = installTaskValidation(pi, root);
	let surfaceInitialized = false;
	let harnessWindowOpen = false;
	const arcCoreTools = () => ["arc_state", "arc_action", "inspect_arc_trajectory", "task_harness", "task_harness_status", "research_resource"]
		.filter((name) => pi.getAllTools().some((tool) => tool.name === name));
	pi.on("before_agent_start", (event) => {
		// Describe Auto-Research only when this adapter actually installed the
		// executable parent entry. This keeps adapters such as Terminal-Bench
		// from advertising a child lifecycle they do not provide.
		const autoResearchAvailable = pi.getAllTools().some((tool) => tool.name === "auto_research");
		// Do not replay the long research operating manual into every parent
		// decision.  The parent needs only the choice boundary; the full contract
		// is available on demand through auto_research(action='contract'), while
		// the child receives its own complete contract when it is actually run.
		const projectedMethod = autoResearchAvailable
			? "AUTO-RESEARCH: start runs bounded read-only research; assign authorizes continuing workers. Runtime delivers core updates; workers retain details. They cannot act or create Harness. Check conclusions against live evidence; preserve disagreement. contract covers budgets, permissions and continuity."
			: "";
		if (!surfaceInitialized) {
			surfaceInitialized = true;
			const compactArc = process.env.PI_ARC_EXECUTION_GATE === "enabled";
			const registered = new Set(pi.getAllTools().map((tool) => tool.name));
			// Keep only the compact control-plane entry on the initial ARC
			// request.  The previous implementation added every management schema
			// here, so "lazy disclosure" was effectively eager and cost ~14KB on
			// every provider request.  task_harness(action="enable") is the real
			// second-level entry: it restores exactly the tools chosen by the
			// Agent, and creation remains available from the next request.
			// Pi may emit several calls from one provider response and does not
			// resolve a newly enabled tool until a later request. Keep every
			// registered task-local entry callable on ARC so the advertised surface
			// cannot diverge from the executable surface; execution admission and
			// the compact method still bound unnecessary management work.
		// The execution checkpoint is part of the task control plane, not a
		// preloaded task resource. Keep it available from the first ARC request
		// so compaction/session recovery cannot erase the agent's hypothesis and
		// next experiment. Research remains lazy and is enabled through the
		// task_harness entry when it has a concrete decision benefit.
		// ARC exposes action, Harness control, parent-authored checkpoint updates,
		// and Auto-Research from the first request. Resource indexes, validation,
		// and detailed status remain available through task_harness activation.
			const core = compactArc ? ["task_harness", "task_harness_create", "task_checkpoint", "auto_research"] : ["task_harness", "task_harness_create", "task_harness_status", "task_checkpoint", "task_resource", "task_validation"];
			// Only ARC uses the compact first-turn surface.  Ordinary benchmark
			// adapters rely on the original direct task-local lifecycle and must
			// see the registered component operations immediately; otherwise their
			// task-local fixture calls are silently absent from the provider tool
			// schema.  This does not load native skills and does not pre-create any
			// task-local resource.
			// ARC still starts with zero task-local resources, but the agent must
			// be able to reason about and create them in the same decision cycle.
			// Keep the resource portfolio empty while exposing its bounded control
			// interfaces from the first request; context compaction preserves the
			// resulting bodies, so lazy disclosure is not a prerequisite for
			// context efficiency.
			const ordinaryManagement = [
				...SELF_HARNESS_MANAGEMENT_TOOLS,
				// The scripted external fixture uses explicit PI_EXTERNAL_STEPS to
				// exercise native executors. Preserve that diagnostic surface while
				// real provider runs receive only the task_harness facade.
				...(process.env.PI_EXTERNAL_STEPS !== undefined ? INTERNAL_NATIVE_HARNESS_TOOLS : []),
				"research_resource", "delegate_task", "read",
			];
			// ARC's first provider request exposes only semantic controls and the
			// deterministic task control plane.  Bookkeeping/index operations are
			// still registered (and can be reached through task_harness inspect or
			// enable), but they are not independent choices in the initial schema.
			const compactInitialExcluded = compactArc ? new Set([
				"task_harness_status", "task_tool_policy", "research_resource",
				"task_validation", "assess_harness_effect", "compact_observation_context", "read",
			]) : new Set<string>();
			const initialManagement = (compactArc
				? ["task_harness", "task_harness_create", "auto_research"]
				: ordinaryManagement).filter((name) => !compactInitialExcluded.has(name));
			const initialCore = core.filter((name) => !compactInitialExcluded.has(name));
			const requested = (options.baseTools ?? pi.getActiveTools().filter((name) =>
				name !== HARNESS_BOOTSTRAP_TOOL && name !== OBSERVATION_COMPACTION_TOOL))
				.filter((name) => !compactInitialExcluded.has(name));
			pi.setActiveTools([...new Set([...initialManagement, ...initialCore, ...requested,
				...(process.env.PI_AUTORESEARCH_CONTEXT_COMPACTION === "enabled" && !compactArc ? [OBSERVATION_COMPACTION_TOOL] : []),
			])].filter((name) => registered.has(name)
				&& (process.env.PI_EXTERNAL_STEPS !== undefined
					|| !(INTERNAL_NATIVE_HARNESS_TOOLS as readonly string[]).includes(name))));
			append("task-harness-entry.jsonl", {
				format: "task-local-direct-entry-v1", native_skill_loading: false,
				main_contract_sha256: autoResearchAvailable
					? createHash("sha256").update(loadPrompt("auto_research_main_contract.md")).digest("hex")
					: null,
				active_tools: pi.getActiveTools(),
				initial_resource_counts: Object.fromEntries(
					["skills", "memory", "tools", "subagents"].map((kind) =>
						[kind, readJsonl(`task-${kind}.jsonl`).length])),
				recordedAt: new Date().toISOString(),
			});
		}
		// A harness enable opens one bounded decision window.  The window is
		// deliberately consumed by the next tool result, so creation remains
		// agent-owned but a management surface cannot stay resident for the
		// remainder of an ARC game.
		// Put the task-local method and its prelude before the benchmark prompt.
		// The benchmark still defines the environment contract, but the first
		// planning frame is now self-harness/research oriented.
		const overlay = renderTaskSystemPromptOverlay(
			readJsonl("task-system-prompt.jsonl") as any,
			taskKnowledgeEntries(readJsonl),
			latestHarnessAssembly(readJsonl("task-harness-assemblies.jsonl")),
		);
		return { systemPrompt: `${projectedMethod}\n\n${event.systemPrompt}${overlay ? `\n\n# Task-local system-prompt overlay\n${overlay}` : ""}` };
	});
	const readJsonl = (name: string): Record<string, any>[] => {
		const path = join(root, name);
		if (!existsSync(path)) return [];
		return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			let value: unknown;
			try { value = JSON.parse(line); } catch { return []; }
			if (!value || typeof value !== "object") return [];
			assertTaskRecordsScope(taskScope, [value as Record<string, unknown>], name);
			return [value as Record<string, any>];
		});
	};
	const scopedArtifactFiles = new Set([
		"task-memory.jsonl", "task-skills.jsonl", "task-tools.jsonl",
		"task-subagents.jsonl", "research-resources.jsonl", "harness-decisions.jsonl",
		"task-harness-proposals.jsonl", "task-system-prompt.jsonl",
		"auto-research-harness-routes.jsonl", "auto-research-harness-route-receipts.jsonl",
		"effect-assessments.jsonl", "task-resource-access.jsonl", "task-harness-entry.jsonl",
		"task-harness-entry-events.jsonl", "task-harness-bootstrap.jsonl", "task-harness-opportunities.jsonl",
		"task-harness-context-exposures.jsonl", "task-skill-events.jsonl", "task-tool-events.jsonl",
		"task-prompt-assemblies.jsonl", "task-system-prompt-assemblies.jsonl",
			"subagent-invocations.jsonl", "harness-observations.jsonl", "auto-research-adoption-events.jsonl",
			"task-checkpoint-resources.jsonl",
	]);
	const append = (name: string, value: unknown) => appendFileSync(
		join(root, name),
		JSON.stringify(scopedArtifactFiles.has(name)
			? stampTaskRecord(taskScope, value as Record<string, unknown>)
			: value) + "\n",
		"utf8",
	);
	const checkpointPath = join(root, "task-checkpoint.json");
	type TaskCheckpoint = {
		format: "task-local-checkpoint-v1";
		revision: number;
		patch_sequence: number;
		harness_started: boolean;
		latest_observation?: Record<string, unknown>;
		recent_observations: Record<string, unknown>[];
		latest_environment?: Record<string, unknown>;
		current_subgoal?: string | null;
		task_goal?: string | null;
		success_conditions?: string[];
		task_constraints?: string[];
		planning_gap?: string | null;
		strategy_alternatives?: string[];
		current_strategy?: string | null;
		hypothesis?: string | null;
		next_step?: string | null;
		working_summary?: string | null;
		decision_state?: Record<string, unknown>;
		reasoning_state?: { stale_fields: string[]; trigger_ref: string; reason: string };
		summary_basis_refs?: string[];
		pending_operations?: Array<Record<string, unknown>>;
		decision_refs: string[];
		decision_capsule?: Record<string, unknown>;
		decision_capsule_observation_ref?: string;
		recent_actions?: Array<Record<string, unknown>>;
		latest_research_run_ref?: string;
		research_session_ref?: string;
		research_status?: string;
		research_question?: string;
		research_cursor?: string;
		research_resume_condition?: string;
		research_checkpoint_revision?: number;
		research_report_summary?: string;
		harness_proposal_count?: number;
		recordedAt: string;
	};
	type TaskCheckpointPatch = {
		format: "task-local-checkpoint-patch-v1";
		sequence: number;
		revision: number;
		patch: Partial<TaskCheckpoint>;
		recordedAt: string;
	};
	const checkpointPatchPath = join(root, "task-checkpoint-patches.jsonl");
	const emptyCheckpoint = (): TaskCheckpoint => ({
		format: "task-local-checkpoint-v1", revision: 0, patch_sequence: 0, harness_started: false,
		recent_observations: [], decision_refs: [], recent_actions: [], recordedAt: new Date().toISOString(),
	});
	let checkpointSnapshotNeedsRefresh = false;
	const normalizeCheckpointObservation = (value: unknown): Record<string, unknown> | undefined => {
		if (!value || typeof value !== "object") return undefined;
		const source = value as Record<string, unknown>;
		const originalExcerpt = String(source.result_excerpt ?? "");
		const resultExcerpt = boundedText(originalExcerpt, 720);
		if (resultExcerpt !== originalExcerpt) checkpointSnapshotNeedsRefresh = true;
		return { ...source, result_excerpt: resultExcerpt };
	};
	const normalizeCheckpoint = (value: Record<string, unknown>): TaskCheckpoint => {
		const originalRecent = Array.isArray(value.recent_observations) ? value.recent_observations : [];
		if (originalRecent.length > 5) checkpointSnapshotNeedsRefresh = true;
		const recentObservations = originalRecent.slice(-5)
			.map(normalizeCheckpointObservation)
			.filter((item): item is Record<string, unknown> => Boolean(item));
		const latestObservation = normalizeCheckpointObservation(value.latest_observation);
		const patchSequence = Math.max(0, Number(value.patch_sequence ?? 0));
		if (!("patch_sequence" in value)) checkpointSnapshotNeedsRefresh = true;
		return {
			...emptyCheckpoint(), ...value,
			patch_sequence: patchSequence,
			recent_observations: recentObservations,
			...(latestObservation ? { latest_observation: latestObservation } : {}),
		} as TaskCheckpoint;
	};
	const readCheckpoint = (): TaskCheckpoint => {
		if (!existsSync(checkpointPath)) return emptyCheckpoint();
		try {
			const value = JSON.parse(readFileSync(checkpointPath, "utf8"));
			if (value && typeof value === "object") return normalizeCheckpoint(value);
		} catch { /* recover from the last valid runtime state */ }
		return emptyCheckpoint();
	};
	const readCheckpointPatches = (): TaskCheckpointPatch[] => {
		if (!existsSync(checkpointPatchPath)) return [];
		return readFileSync(checkpointPatchPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try {
				const value = JSON.parse(line);
				return value?.format === "task-local-checkpoint-patch-v1"
					&& value.patch && typeof value.patch === "object" ? [value as TaskCheckpointPatch] : [];
			} catch { return []; }
		});
	};
	const applyCheckpointPatch = (
		current: TaskCheckpoint,
		record: TaskCheckpointPatch,
		patchSequence: number,
	): TaskCheckpoint => ({
		...current,
		...record.patch,
		format: "task-local-checkpoint-v1",
		revision: Math.max(Number(current.revision ?? 0) + 1, Number(record.revision ?? 0)),
		patch_sequence: patchSequence,
		recordedAt: record.recordedAt,
	});
	let checkpoint = readCheckpoint();
	let checkpointResourceRevision = readJsonl("task-checkpoint-resources.jsonl")
		.reduce((latest, row) => Math.max(latest, Number(row.state?.revision ?? -1)), -1);
	const checkpointRef = () => `checkpoint:checkpoint@v${checkpoint.revision + 1}`;
	const persistCheckpointResource = () => {
		if (checkpointResourceRevision >= checkpoint.revision) return;
		append("task-checkpoint-resources.jsonl", {
			checkpoint_id: "checkpoint", version: checkpoint.revision + 1,
			format: "task-local-checkpoint-resource-v1",
			summary: `Agent-authored checkpoint revision ${checkpoint.revision}`,
			state: checkpoint, recordedAt: checkpoint.recordedAt,
		});
		checkpointResourceRevision = checkpoint.revision;
	};
	let checkpointSnapshotSequence = checkpoint.patch_sequence;
	const startupPatches = readCheckpointPatches();
	for (let index = checkpointSnapshotSequence; index < startupPatches.length; index += 1) {
		checkpoint = applyCheckpointPatch(checkpoint, startupPatches[index], index + 1);
	}
	let checkpointPatchSequence = startupPatches.length;
	let checkpointWriteCounter = 0;
	let lastDecisionProgress = "";
	let noProgressTurns = 0;
	let lastNoProgressCue = "";
	const decisionProgressSignature = () => {
		const strategy = readTaskStrategyState(root);
		return JSON.stringify({ actions: checkpoint.recent_actions?.length ?? 0,
			latest_observation: checkpoint.latest_observation?.observation_id,
			strategy_revision: strategy.revision,
			current_subgoal: checkpoint.current_subgoal,
			next_step: checkpoint.next_step,
			working_summary: checkpoint.working_summary,
			decision_refs: checkpoint.decision_refs });
	};
	lastDecisionProgress = decisionProgressSignature();
	const flushCheckpoint = (reason: "agent_end" | "periodic") => {
		const patches = readCheckpointPatches();
		let refreshed = readCheckpoint();
		for (let index = refreshed.patch_sequence; index < patches.length; index += 1) {
			refreshed = applyCheckpointPatch(refreshed, patches[index], index + 1);
		}
		checkpoint = refreshed;
		checkpointPatchSequence = patches.length;
		if (existsSync(checkpointPath) && checkpointSnapshotSequence >= patches.length
			&& !checkpointSnapshotNeedsRefresh) return;
		const serialized = JSON.stringify(checkpoint) + "\n";
		const temporary = `${checkpointPath}.${process.pid}.${++checkpointWriteCounter}.tmp`;
		writeFileSync(temporary, serialized, "utf8");
		try {
			renameSync(temporary, checkpointPath);
		} catch (error) {
			// Leave the uniquely named staging file for recovery diagnostics; the
			// patch log remains authoritative for all changes after the last snapshot.
			throw error;
		}
		checkpointSnapshotSequence = checkpoint.patch_sequence;
		checkpointSnapshotNeedsRefresh = false;
		append("task-checkpoint-events.jsonl", {
			event: "snapshot_saved", reason, revision: checkpoint.revision,
			patch_sequence: checkpoint.patch_sequence, snapshot_bytes: Buffer.byteLength(serialized, "utf8"),
			recordedAt: checkpoint.recordedAt,
		});
	};
	const saveCheckpoint = (patch: Partial<TaskCheckpoint>) => {
		const recordedAt = new Date().toISOString();
		const revision = Number(checkpoint.revision ?? 0) + 1;
		const sequence = checkpointPatchSequence + 1;
		const record: TaskCheckpointPatch = {
			format: "task-local-checkpoint-patch-v1", sequence, revision, patch, recordedAt,
		};
		appendFileSync(checkpointPatchPath, JSON.stringify(record) + "\n", "utf8");
		checkpoint = {
			...checkpoint, ...patch, format: "task-local-checkpoint-v1",
			revision, patch_sequence: sequence, recordedAt,
		};
		checkpointPatchSequence = sequence;
		persistCheckpointResource();
		if (checkpointPatchSequence - checkpointSnapshotSequence >= 32) flushCheckpoint("periodic");
	};
	pi.on("agent_end", async () => {
		flushCheckpoint("agent_end");
		const signature = decisionProgressSignature();
		noProgressTurns = signature === lastDecisionProgress
			? noProgressTurns + 1 : 0;
		lastDecisionProgress = signature;
	});
	pi.on("tool_call", (event) => {
		if (event.toolName !== "arc_action") return;
		const input = event.input as Record<string, any>;
		const decision = input?.decision as Record<string, any> | undefined;
		if (decision?.plan_id === undefined && decision?.plan_step === undefined) {
			try { if (decision) validationLedger.prepareDecision(decision); }
			catch (error) { return { block: true, reason: String(error) }; }
			return;
		}
		const plan = readTaskStrategyState(root).plan;
		if (!plan || plan.status !== "active" || decision?.plan_id !== plan.plan_id
			|| decision?.plan_step !== plan.current_step || plan.needs_reconciliation || plan.needs_assessment) {
			return { block: true, reason: "Planned ARC action has an outdated or unresolved plan step. Inspect task_checkpoint(action='inspect',detail='strategy'), revise with evidence, or omit plan identity for an explicit exploratory action." };
		}
		const step = plan.steps[plan.current_step];
		if (step && typeof step === "object" && ["action", "x", "y"].some((key) =>
			step[key] !== undefined && step[key] !== input[key])) {
			return { block: true, reason: "Planned ARC action does not match the Agent-authored structured step. Revise the plan or submit the intended step." };
		}
		try { if (decision) validationLedger.prepareDecision(decision); }
		catch (error) { return { block: true, reason: String(error) }; }
	});
	const trackedResourceTools = new Set<string>([...SELF_HARNESS_MANAGEMENT_TOOLS,
		...INTERNAL_NATIVE_HARNESS_TOOLS, "research_resource", "task_validation", "task_checkpoint", "delegate_task", "auto_research"]);
	let failureCounter = nextCounter(readJsonl("task-operation-failures.jsonl"), "failure_id");
	const operationKey = (tool: string, input: Record<string, any>) =>
		controlOperationKey(tool, input, taskScope.taskId);
	const failedOperation = (tool: string, input: Record<string, any>, toolCallId: string, error: string,
		executionStage?: "before_tool_call") => {
		const key = operationKey(tool, input);
		const failureId = `failure-${++failureCounter}`;
		const classification = failureClassification(error, executionStage);
		const candidates = Array.isArray(classification.candidates) ? classification.candidates : [];
		const recoveryOperationKeys = candidates
			.map((candidate: Record<string, any>) => candidate.research_handoff_ref)
			.filter(Boolean)
			.map((research_handoff_ref: string) => operationKey(tool, {...input, research_handoff_ref}));
		const failure = { operation_key: key, tool, action: input.action, toolCallId, error,
			...(executionStage ? {execution_stage: executionStage} : {}),
			...(classification.failure_class === "version_conflict" && Number.isInteger(classification.current_version)
				? {recovery_operation_key:operationKey(tool,{...input,target_version:classification.current_version})} : {}),
			...(recoveryOperationKeys.length ? {recovery_operation_keys: recoveryOperationKeys} : {}),
			failure_id:failureId, recordedAt:new Date().toISOString(), resolved_by:null,
			failure_class:classification.failure_class, retryable:classification.retryable, required_next_call:classification.required_next_call,
			applied:classification.applied,
			recovery_hint:classification.recovery_hint ?? null,
			resource_ref: `failure:${failureId}@v1`,
			note: classification.retryable === false
				? "This attempt is terminal; retained for evidence and cost, with no pending repair obligation."
				: "Follow required_next_call; only success for the same action and bound target resolves this failure." };
		append("task-operation-failures.jsonl", { ...failure, failure_id: failureId, version: 1, status: "failed",
			error, attempted_input: input,
			applied: classification.applied });
		// A new no-write rejection says nothing about an older unresolved attempt,
		// even if the operation identity is the same. Preserve that recovery.
		const pending = classification.retryable === false ? [...(checkpoint.pending_operations ?? [])]
			: (checkpoint.pending_operations ?? []).filter((r) => r.operation_key !== key);
		if (classification.retryable !== false) pending.push(failure);
		saveCheckpoint({ pending_operations: pending });
	};
	const reconcilePendingOperations = () => {
		const pending = checkpoint.pending_operations ?? [];
		if (!pending.length) return;
		const reviews = readJsonl("task-harness-reviews.jsonl");
		const levelReviews = readJsonl("task-level-reviews.jsonl");
		const failedAttempts = readJsonl("task-operation-failures.jsonl");
		const opportunities = readJsonl("task-harness-opportunities.jsonl");
		const reviewEvents = readJsonl("task-harness-review-events.jsonl");
		const handoffs = latestControlRecords(readJsonl("auto-research-handoffs.jsonl"), "handoff_id");
		const obsolete = (record: Record<string, any>) => {
			const classification = failureClassification(String(record.error ?? ""));
			if (classification.retryable === false || record.retryable === false) return true;
			let operation: Record<string, any>;
			try { operation = JSON.parse(String(record.operation_key)); } catch { return false; }
			const target = operation.target ?? {};
			if (record.tool === "task_harness" && record.action === "level_review") {
				// Older failure keys hashed the whole input even when window_id was
				// present. A completed review for that exact window is conclusive.
				const windowId = target.window_id ?? failedAttempts
					.find((item) => item.failure_id === record.failure_id)?.attempted_input?.window_id;
				return Boolean(windowId && levelReviews.some((item) => item.window_id === windowId));
			}
			if (record.tool === "task_harness" && record.action === "review" && target.opportunity_id) {
				const opportunity = opportunities.find((item) => item.opportunity_id === target.opportunity_id);
				return reviews.some((item) => item.opportunity_id === target.opportunity_id)
					|| Boolean(opportunity?.window?.window_id && reviewEvents.some((item) => item.window_id === opportunity.window.window_id && item.status === "failed"));
			}
			if (record.tool === "task_harness" && record.action === "decide_research" && target.research_decision) {
				const statuses = eligibleResearchHandoffStatuses(target.research_decision);
				if (target.research_handoff_ref) return !handoffs.some((item) => {
					const ref = `research_handoff:${item.handoff_id}@v${item.version}`;
					return ref === target.research_handoff_ref && statuses.includes(item.status);
				});
				return !handoffs.some((item) => statuses.includes(item.status));
			}
			return false;
		};
		const retired = pending.filter(obsolete);
		if (!retired.length) return;
		for (const prior of retired) append("task-operation-resolutions.jsonl", {
			failure_ref: prior.resource_ref,
			operation_key: prior.operation_key,
			resolution_kind: "retired",
			resolved_by: "runtime_reconciliation",
			reason: "The failed target is no longer eligible for the same repair operation.",
			recordedAt: new Date().toISOString(),
		});
		saveCheckpoint({ pending_operations: pending.filter((item) => !retired.includes(item)) });
	};
	reconcilePendingOperations();
	const inFlightResourceInputs = new Map<string, Record<string, any>>();
	const validatedResourceCalls = new Set<string>();
	const handledResourceFailures = new Set<string>();
	pi.on("tool_call", (event) => {
		if (trackedResourceTools.has(event.toolName)) validatedResourceCalls.add(event.toolCallId);
	});
	pi.on("tool_execution_start", (event) => {
		if (trackedResourceTools.has(event.toolName)) inFlightResourceInputs.set(event.toolCallId, bindOperationIdentity(event.toolName, event.args as Record<string, any>, readJsonl));
	});
	pi.on("tool_execution_end", (event) => {
		const input = inFlightResourceInputs.get(event.toolCallId);
		inFlightResourceInputs.delete(event.toolCallId);
		const handled = handledResourceFailures.delete(event.toolCallId);
		const validated = validatedResourceCalls.delete(event.toolCallId);
		// SDK validation and length rejection skip validated dispatch and execute.
		// Execution exceptions can also reach this boundary; retain unknown effects
		// whenever dispatch occurred instead of guessing from the error's text.
		if (input && event.isError && !handled) failedOperation(event.toolName, input, event.toolCallId,
			textContent((event.result as any)?.content), validated ? undefined : "before_tool_call");
	});
	const environmentProjection = (details: unknown): Record<string, unknown> | undefined => {
		if (!details || typeof details !== "object") return undefined;
		const source = details as Record<string, unknown>;
		const fields = [
			"version", "revision", "state", "status", "progress", "levels_completed", "action_budget",
			"available_actions", "agent_available_actions", "public_transition", "observation_delta",
		];
		const projected = Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]));
		// Checkpoints are projected into every later provider context. Keep the
		// delta shape, not its per-cell payload; exact cells remain in the action
		// result and canonical bridge event for explicit recovery.
		const delta = projected.observation_delta;
		if (delta && typeof delta === "object") {
			const value = delta as Record<string, unknown>;
			projected.observation_delta = Object.fromEntries(
				["changed_cells", "bbox", "frame_available", "cells_truncated"]
					.filter((key) => key in value).map((key) => [key, value[key]]),
			);
			if (Array.isArray(value.changed_cells)) {
				const compact = projected.observation_delta as Record<string, unknown>;
				compact.changed_cells = value.cells_truncated || value.frame_available === false ? undefined : value.changed_cells.length;
				if (value.cells_truncated) compact.returned_cell_count = value.changed_cells.length;
			}
		}
		return Object.keys(projected).length ? projected : undefined;
	};
	const checkpointObservation = (event: any, observationId: string, resultText: string) => {
		const item = {
			observation_id: observationId,
			tool_name: String(event.toolName ?? "unknown"),
			is_error: Boolean(event.isError),
			result_excerpt: boundedText(resultText, 720),
		};
		const recent = [...(checkpoint.recent_observations ?? []), item].slice(-5);
		const details = event.details as Record<string, unknown> | undefined;
		const transition = details?.public_transition as Record<string, unknown> | undefined;
		const delta = details?.observation_delta as Record<string, unknown> | undefined;
		const actionInput = event.toolName === "arc_action"
			? (event.input as Record<string, unknown> | undefined) : undefined;
		const decisionCapsule = actionInput?.decision && typeof actionInput.decision === "object"
			? actionInput.decision as Record<string, unknown> : undefined;
		const actionRecord = actionInput ? {
			action: String(actionInput.action ?? "UNKNOWN"),
			// This is the Agent's public action rationale, not inferred knowledge or
			// hidden model reasoning. Keep the latest intent after transcript retirement.
			...(typeof actionInput.reasoning === "string" ? { reasoning: actionInput.reasoning } : {}),
			...arcActionCoordinates(actionInput),
			...(arcActionCoordinates(actionInput) && details?.action_target_cell && typeof details.action_target_cell === "object"
				? { target_cell: details.action_target_cell } : {}),
			observation_id: observationId,
			changed_cells: typeof delta?.changed_cells === "number" ? delta.changed_cells : undefined,
			bbox: delta?.bbox,
			...(Array.isArray(delta?.change_groups) ? { change_groups: delta.change_groups } : {}),
			level_changed: transition?.level_changed,
			level_after: transition?.level_after,
			state: details?.state,
		} : undefined;
		const stateBoundary = actionInput && !event.isError
			&& (transition?.level_changed === true || actionInput.action === "RESET");
		const updatedDecisionFields = decisionCapsule ? [
			"decision_capsule",
			...Object.keys((decisionCapsule.knowledge as Record<string, unknown>) ?? {}).map(field => `decision_state.${field}`),
			...(typeof decisionCapsule.subgoal === "string" ? ["current_subgoal"] : []),
			...(typeof decisionCapsule.hypothesis === "string" ? ["hypothesis"] : []),
			...(typeof decisionCapsule.next_step === "string" ? ["next_step"] : []),
		] : [];
		const staleFields = stateBoundary
			? ["task_goal", "current_subgoal", "current_strategy", "hypothesis", "next_step", "working_summary",
				"decision_capsule", "decision_state.known_effects", "decision_state.knowledge_gaps",
				"decision_state.counterevidence", "decision_state.next_decision"]
			: (checkpoint.reasoning_state?.stale_fields ?? []).filter(field => !updatedDecisionFields.includes(field));
		saveCheckpoint({
			latest_observation: item,
			recent_observations: recent,
			latest_environment: environmentProjection(event.details) ?? checkpoint.latest_environment,
			...(stateBoundary ? { reasoning_state: { stale_fields: staleFields,
				trigger_ref: `observation:${observationId}@v1`, reason: transition?.level_changed === true ? "level_changed" : "reset" } }
				: checkpoint.reasoning_state ? { reasoning_state: { ...checkpoint.reasoning_state, stale_fields: staleFields } } : {}),
			...(decisionCapsule ? {
				decision_capsule: decisionCapsule,
				decision_capsule_observation_ref: `observation:${observationId}@v1`,
				...(!event.isError && decisionCapsule.knowledge !== undefined ? {
					decision_state: patchDecisionState(checkpoint.decision_state,
						normalizeDecisionKnowledge(decisionCapsule.knowledge, ref => resolveTaskResource(root, ref)),
						ref => resolveTaskResource(root, ref)),
				} : {}),
				...(typeof decisionCapsule.subgoal === "string" ? { current_subgoal: decisionCapsule.subgoal } : {}),
				...(typeof decisionCapsule.hypothesis === "string" ? { hypothesis: decisionCapsule.hypothesis } : {}),
				...(typeof decisionCapsule.next_step === "string" ? { next_step: decisionCapsule.next_step } : {}),
				...(Array.isArray(decisionCapsule.decision_refs) ? { decision_refs: decisionCapsule.decision_refs.map(String) } : {}),
			} : {}),
			...(actionRecord ? { recent_actions: [...(checkpoint.recent_actions ?? []), actionRecord] } : {}),
		});
		if (actionInput && !event.isError) {
			const state = recordTaskStrategyAction(root, decisionCapsule, observationId, actionInput,
				details as Record<string, unknown> | undefined);
			if (state?.plan?.status === "active") {
				const step = state.plan.steps[state.plan.current_step];
				const nextStep = typeof step === "string" ? step : JSON.stringify(step);
				if (checkpoint.next_step !== nextStep) saveCheckpoint({ next_step: nextStep });
			}
			recordCompetitionChoice(root, decisionCapsule, `observation:${observationId}@v1`);
		}
		if (actionInput) {
			validationLedger.observeAction(observationId, decisionCapsule, actionInput, details ?? {}, Boolean(event.isError));
			const plan = readTaskStrategyState(root).plan;
			if (plan?.status === "active" && (plan.needs_reconciliation || plan.needs_assessment)) saveCheckpoint({
				reasoning_state: { stale_fields: [...new Set([...(checkpoint.reasoning_state?.stale_fields ?? []), "next_step", "current_strategy"])],
					trigger_ref: plan.experiment_outcome_ref ?? `observation:${observationId}@v1`,
					reason: plan.needs_reconciliation ? "plan_requires_reconciliation" : "plan_requires_assessment" },
			});
		}
	};
	// The checkpoint is a native task control-plane resource.  It is deliberately
	// separate from research findings and harness resources: compaction may
	// project its decision-bearing fields, while the complete JSON remains
	// durable and recoverable on disk.  Updates are agent-authored state, never
	// environment facts, and are persisted atomically through saveCheckpoint.
	const checkpointParameters = compactToolSchema(Type.Object({
			action: Type.Union([Type.Literal("update"), Type.Literal("inspect")]),
				detail: Type.Optional(Type.Union([Type.Literal("strategy"), Type.Literal("full")])),
				offset: Type.Optional(Type.Integer({ minimum: 0 })),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536 })),
			candidate_id: Type.Optional(Type.String()),
			candidate_updates: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()))),
			selected_candidate_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			selection: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional registered-candidate assessment: view_ref,candidate_id/version,evidence_refs,rationale,branches,disposition,addressed_trigger_refs,next_check." })),
			plan_update: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "plan_id,candidate_id,status,current_step,steps:[{action,x,y,expected:{target_before,target_after,level_changed,level_after}}]. Only checked matching steps advance." })),
			current_subgoal: Type.Optional(Type.String()),
			task_goal: Type.Optional(Type.String()),
			success_conditions: Type.Optional(Type.Array(Type.String())),
			task_constraints: Type.Optional(Type.Array(Type.String())),
			planning_gap: Type.Optional(Type.String()),
			strategy_alternatives: Type.Optional(Type.Array(Type.String())),
			current_strategy: Type.Optional(Type.String()),
			hypothesis: Type.Optional(Type.String()),
			...decisionForecastProperties(),
			next_step: Type.Optional(Type.String()),
			working_summary: Type.Optional(Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())])),
			summary_basis_refs: Type.Optional(Type.Array(Type.String())),
			decision_refs: Type.Optional(Type.Array(Type.String())),
			consumed_result_refs: Type.Optional(Type.Array(Type.String(), { description: "Exact tool_result refs analyzed here; reading alone is not consumption." })),
			decision_state: Type.Optional(decisionStateSchema()),
			clear_fields: Type.Optional(Type.Array(Type.Union([
				Type.Literal("current_subgoal"), Type.Literal("task_goal"), Type.Literal("planning_gap"),
				Type.Literal("current_strategy"), Type.Literal("hypothesis"), Type.Literal("next_step"),
				Type.Literal("working_summary"),
				Type.Literal("success_conditions"), Type.Literal("task_constraints"),
				Type.Literal("strategy_alternatives"), Type.Literal("summary_basis_refs"),
				Type.Literal("decision_refs"),
			]), { description: "Clear claims; supplied values replace clears. Clearing summary also clears refs." })),
		}));
	pi.registerTool({
		name: "task_checkpoint",
		label: "Task-local execution checkpoint",
		description: "Persist or inspect agent-authored task planning state; projected on later turns.",
		parameters: checkpointParameters,
		prepareArguments(args) {
			try {
				// Check authored values before Pi's generic conversion can coerce them.
				const previous = checkpoint.reasoning_state?.stale_fields.includes("decision_state.next_decision")
					? undefined : checkpoint.decision_state;
				const rawPatch = (args as Record<string, any>)?.action === "update"
					? checkpointDecisionPatch(args as Record<string, any>, Object.keys(checkpointParameters.properties), previous)
					: undefined;
				// Reuse Pi's own pure validator so every rejected checkpoint input,
				// including missing fields, carries conclusive no-write provenance.
				const input = validateToolArguments({ name: "task_checkpoint", description: "", parameters: checkpointParameters },
					{ type: "toolCall", id: "checkpoint-input", name: "task_checkpoint", arguments: args }) as Record<string, any>;
				if (input.action !== "update") return input as any;
				const patch = rawPatch;
				if (patch === undefined) return input as any;
				const decision_state = normalizeDecisionKnowledge(patch, ref => resolveTaskResource(root, ref));
				return { ...input, decision_state } as any;
			} catch (error) {
				// Preparation is pure: a corrected input is a new submission, not
				// an impossible exact-hash retry obligation resident in every turn.
				controlError("rejected_input", [{ path: "task_checkpoint", message: String(error instanceof Error ? error.message : error) }], {
					retryable: false, required_next_call: undefined,
					recovery_hint: "This input was rejected before any write. Correct the reported fields in a new update; inspect only if a reference is unknown.",
				});
			}
		},
		async execute(_toolCallId, params) {
			const input = params as Record<string, any>;
			if (input.action === "inspect") {
				if (input.detail === "strategy" || input.candidate_id) {
					const state = readTaskStrategyState(root);
					const result = input.candidate_id
						? { candidate: (state.candidates ?? []).find((item: Record<string, any>) => item.id === input.candidate_id) ?? null,
							plan: state.plan?.candidate_id === input.candidate_id ? state.plan : null }
						: state;
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				persistCheckpointResource();
				if (input.detail === "full") {
					const serialized = JSON.stringify(checkpoint);
					const offset = Math.min(serialized.length, Math.max(0, Number(input.offset ?? 0)));
					const limit = Math.min(65536, Math.max(1, Number(input.limit ?? 2000)));
					const result = { checkpoint_ref: checkpointRef(), revision: checkpoint.revision,
						offset, total_chars: serialized.length, text: serialized.slice(offset, offset + limit),
						next_offset: offset + limit < serialized.length ? offset + limit : null };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				const result = { checkpoint_ref: checkpointRef(), revision: checkpoint.revision,
					latest_environment: checkpoint.latest_environment,
					strategy: taskStrategyIndex(readTaskStrategyState(root)),
					recent_action_count: checkpoint.recent_actions?.length ?? 0,
					pending_operation_count: checkpoint.pending_operations?.length ?? 0,
					read_full: { tool: "task_checkpoint", arguments: { action: "inspect", detail: "full", offset: 0, limit: 2000 } } };
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			const decisionPatch = checkpointDecisionPatch(input, Object.keys(checkpointParameters.properties),
				checkpoint.reasoning_state?.stale_fields.includes("decision_state.next_decision") ? undefined : checkpoint.decision_state);
			const patch: Partial<TaskCheckpoint> = {};
			const consumedIds = (input.consumed_result_refs ?? []).map((ref: string) => {
				const match = /^tool_result:(.+)@v1$/.exec(ref);
				if (!match) throw new Error("consumed_result_refs requires exact tool_result refs");
				return match[1];
			});
			readWorkset(pi, root).validateRelease(consumedIds);
			for (const field of input.clear_fields ?? []) {
				patch[field as keyof TaskCheckpoint] = (["success_conditions", "task_constraints", "strategy_alternatives",
					"summary_basis_refs", "decision_refs"].includes(field) ? [] : null) as never;
				if (field === "working_summary" && !Object.prototype.hasOwnProperty.call(input, "summary_basis_refs")) {
					patch.summary_basis_refs = [];
				}
			}
			for (const key of ["current_subgoal", "task_goal", "planning_gap", "current_strategy", "hypothesis", "next_step", "working_summary"] as const) {
				if (typeof input[key] === "string") patch[key] = input[key];
				else if (key === "working_summary" && input[key] && typeof input[key] === "object") patch[key] = JSON.stringify(input[key]);
			}
			if (Array.isArray(input.summary_basis_refs)) patch.summary_basis_refs = input.summary_basis_refs.map(String);
			if (Array.isArray(input.task_constraints)) patch.task_constraints = input.task_constraints.map(String);
			if (Array.isArray(input.success_conditions)) patch.success_conditions = input.success_conditions.map(String);
			if (Array.isArray(input.strategy_alternatives)) patch.strategy_alternatives = input.strategy_alternatives.map(String);
			if (Array.isArray(input.decision_refs)) patch.decision_refs = input.decision_refs.map(String);
			if (decisionPatch !== undefined) patch.decision_state = patchDecisionState(checkpoint.decision_state, decisionPatch,
				ref => resolveTaskResource(root, ref));
			const strategyState = updateTaskStrategyState(root, {
				candidate_updates: input.candidate_updates,
				selected_candidate_id: input.selected_candidate_id,
				plan_update: input.plan_update,
				source_ref: `task_checkpoint:${Number(checkpoint.revision ?? 0) + 1}`,
			});
			if (input.plan_update && strategyState.plan) {
				if (strategyState.plan.status === "active") {
					if (input.current_strategy === undefined) patch.current_strategy = strategyState.candidates
						.find((item: Record<string, any>) => item.id === strategyState.plan.candidate_id)?.claim ?? null;
					if (input.next_step === undefined) patch.next_step = typeof strategyState.plan.steps[strategyState.plan.current_step] === "string"
						? strategyState.plan.steps[strategyState.plan.current_step]
						: JSON.stringify(strategyState.plan.steps[strategyState.plan.current_step]);
				} else {
					if (input.current_strategy === undefined) patch.current_strategy = null;
					if (input.next_step === undefined) patch.next_step = null;
				}
			}
			if (checkpoint.reasoning_state) patch.reasoning_state = { ...checkpoint.reasoning_state,
				stale_fields: checkpoint.reasoning_state.stale_fields.filter(field => !Object.prototype.hasOwnProperty.call(patch, field)
					&& !(field.startsWith("decision_state.") && decisionPatch !== undefined
						&& Object.hasOwn(decisionPatch, field.slice("decision_state.".length)))) };
			saveCheckpoint(patch);
			if (consumedIds.length) readWorkset(pi, root).release(consumedIds, { covered_by: checkpointRef() });
			const selectionReceipt = input.selection ? recordCompetitionChoice(root, { selection: input.selection }, checkpointRef()) : undefined;
			const receipt = { checkpoint_revision: checkpoint.revision, checkpoint_ref: checkpointRef(),
				updated_fields: Object.keys(patch), strategy: taskStrategyIndex(strategyState),
				...(selectionReceipt ? { selection_review: { status: selectionReceipt.status,
					review_gaps: selectionReceipt.review_gaps,
					choice_ref: `competition_view:${selectionReceipt.view_id}@v${selectionReceipt.version}` } } : {}),
				read_full: { tool: "task_checkpoint", arguments: { action: "inspect", detail: "full", offset: 0, limit: 2000 } } };
			return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
		},
	});

	const observationRecords = readJsonl("execution-observations.jsonl");
	const observations = new Map(observationRecords.map((item) => [String(item.observation_id), item]));
	const signalRecords = readJsonl("execution-signals.jsonl") as ExecutionSignal[];
	const latestSignalByIdentity = new Map(
		signalRecords.map((item) => [`${String(item.observation_id)}:${String(item.layer ?? "tool_execution")}`, item]),
	);
	const patternRecords = readJsonl("pattern-candidates.jsonl") as PatternCandidate[];
	const patternCandidatesByKey = new Map<string, PatternCandidate>();
	const patternCandidatesById = new Map<string, PatternCandidate>();
	for (const item of patternRecords) {
		const previous = patternCandidatesByKey.get(String(item.candidate_key));
		if (!previous || Number(item.version) >= previous.version) {
			patternCandidatesByKey.set(String(item.candidate_key), item);
			patternCandidatesById.set(String(item.candidate_id), item);
		}
	}
	const findingRecords = readJsonl("research-resources.jsonl");
	const findings = new Map<string, Finding>();
	const findingVersions = new Set<string>();
	for (const item of findingRecords) {
		findingVersions.add(`${String(item.finding_id)}@v${Number(item.version)}`);
		const previous = findings.get(String(item.finding_id));
		if (!previous || Number(item.version) >= previous.version) findings.set(String(item.finding_id), item as Finding);
	}
	const resolveBasisRefs = (references: string[]): string[] => references.map((reference) => {
		if (/@v\d+$/.test(reference)) return reference;
		const finding = findings.get(reference);
		if (finding) return `${finding.finding_id}@v${finding.version}`;
		const candidate = patternCandidatesById.get(reference);
		if (candidate) return `${candidate.candidate_id}@v${candidate.version}`;
		return reference;
	});
	let observationCounter = nextCounter(observationRecords, "observation_id");
	let signalCounter = nextCounter(signalRecords as unknown as Record<string, unknown>[], "signal_id");
	let patternCounter = nextCounter(patternRecords as unknown as Record<string, unknown>[], "candidate_id");
	let findingCounter = nextCounter(findingRecords, "finding_id");
	let researchCounter = nextCounter(findingRecords, "research_event_id");
	let decisionCounter = nextCounter(readJsonl("harness-decisions.jsonl"), "decision_id");
	let exposureCounter = nextCounter(readJsonl("research-exposures.jsonl"), "exposure_id");
	let lastExposureSignature = "";
	const pendingAssessments = new Map<string, Record<string, unknown>>();
	const absorbedAssessmentIds = new Set(
		findingRecords.flatMap((item) => Array.isArray(item.assessment_refs) ? item.assessment_refs.map(String) : []),
	);
	for (const assessment of readJsonl("effect-assessments.jsonl")) {
		const id = String(assessment.effect_assessment_id);
		if (!absorbedAssessmentIds.has(id)) pendingAssessments.set(id, assessment);
	}

	const handleResearchToolResult = async (event: any): Promise<any> => {
		if (event.toolName === "delegate_task") {
			// The child lease writes exact receipts before the parent tool result.
			// Absorb them through the same checkpoint/experiment path without rewriting them.
			for (const receipt of readJsonl("execution-observations.jsonl").filter(row =>
				row.toolCallId === event.toolCallId && row.input?.delegated_invocation_id && !row.is_error
				&& !observations.has(row.observation_id))) {
				await handleResearchToolResult({ toolName: "arc_action", toolCallId: `${event.toolCallId}:${receipt.observation_id}`,
					input: receipt.input, content: [{ type: "text", text: receipt.result_text }],
					details: receipt.arc_outcome, isError: false, observation_id: receipt.observation_id,
					already_recorded: true, delegated_invocation_id: receipt.input.delegated_invocation_id });
			}
		}
		if (event.toolName === "arc_actions" && !event.isError) {
			const completed = (event.details as Record<string, any> | undefined)?.completed;
			const actions = (event.input as Record<string, any> | undefined)?.actions;
			if (Array.isArray(completed) && Array.isArray(actions)) {
				for (const result of completed) {
					const index = Number(result.index);
					if (!Number.isInteger(index) || index < 0 || index >= actions.length) continue;
					await handleResearchToolResult({
						toolName: "arc_action", toolCallId: `${event.toolCallId}:${index}`,
						input: actions[index], isError: false,
						content: [{ type: "text", text: JSON.stringify(result) }],
						details: result, batch_tool_call_id: event.toolCallId, batch_index: index,
					});
				}
				return {};
			}
		}
		if (event.toolName === "arc_action" && !event.isError) noteArcActionCompleted();
		const toolInput = inFlightResourceInputs.get(event.toolCallId) ?? (event.input as Record<string, unknown> | undefined) ?? {};
		if (event.toolName === "task_harness" && ["enable", "activate"].includes(String(toolInput.action ?? ""))) {
			harnessWindowOpen = true;
		}
		if (harnessWindowOpen && event.toolName !== "task_harness") {
			harnessWindowOpen = false;
			// Do not remove tools from the active set here: Pi may already have
			// emitted additional calls in the same provider response. The execute
			// boundary admission gate handles those calls without turning them into
			// "tool not found" errors; the next provider context can be compacted.
		}
		if (event.toolName === "task_harness" && toolInput.action === "start" && !checkpoint.harness_started) {
			saveCheckpoint({ harness_started: true });
		}
		if (event.toolName === "auto_research" && !event.isError) {
			const details = (event.details as Record<string, unknown> | undefined) ?? {};
			const resourceRef = String(details.resource_ref ?? "");
			saveCheckpoint({
				...(resourceRef ? { latest_research_run_ref: resourceRef } : {}),
				...(details.session_ref ? { research_session_ref: String(details.session_ref) } : {}),
				research_status: String(details.status ?? "completed"),
				research_question: compactText(details.question, 600),
				research_report_summary: compactText(details.report_summary ?? details.summary, 600),
				harness_proposal_count: Number(details.proposal_count ?? 0),
				...(details.checkpoint && typeof details.checkpoint === "object" ? {
					research_cursor: String((details.checkpoint as any).cursor ?? ""),
					research_resume_condition: String((details.checkpoint as any).resume_condition ?? ""),
					research_checkpoint_revision: Number((details.checkpoint as any).revision ?? checkpoint.revision),
				} : {}),
			});
			append("task-checkpoint-events.jsonl", {
				event: "auto_research_completed", revision: checkpoint.revision,
				resource_ref: checkpoint.latest_research_run_ref,
				session_ref: checkpoint.research_session_ref,
				status: checkpoint.research_status, question: checkpoint.research_question,
				cursor: checkpoint.research_cursor, resume_condition: checkpoint.research_resume_condition,
				report_summary: checkpoint.research_report_summary,
				harness_proposal_count: checkpoint.harness_proposal_count,
				recordedAt: checkpoint.recordedAt,
			});
		}
		const rawPath = (event.input as Record<string, unknown> | undefined)?.path;
		const rel = typeof rawPath === "string" ? relative(join(root, "task-harness"), resolve(rawPath)) : undefined;
		const taskHarnessRead = event.toolName === "read" && rel !== undefined
			&& (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)));
		if (trackedResourceTools.has(event.toolName)) {
			if (event.isError) {
				failedOperation(event.toolName, toolInput, event.toolCallId, textContent(event.content));
				handledResourceFailures.add(event.toolCallId);
			} else if (toolInput.action !== "inspect") {
				const pendingOperations = checkpoint.pending_operations ?? [];
				const resolvedKey = operationKey(event.toolName, toolInput);
				const remainingOperations = pendingOperations
					.filter((r) => r.operation_key !== resolvedKey
						&& r.recovery_operation_key !== resolvedKey
						&& !(Array.isArray(r.recovery_operation_keys) && r.recovery_operation_keys.includes(resolvedKey)));
				if (remainingOperations.length !== pendingOperations.length) {
					for (const prior of pendingOperations.filter(r => !remainingOperations.includes(r)))
						append("task-operation-resolutions.jsonl",{failure_ref:prior.resource_ref,operation_key:prior.operation_key,
							resolved_operation_key:operationKey(event.toolName,toolInput),resolved_by:event.toolCallId,recordedAt:new Date().toISOString()});
					saveCheckpoint({ pending_operations: remainingOperations });
				}
			}
		}
		if (taskHarnessRead || ["task_checkpoint", "task_resource", "task_validation", "research_resource", "auto_research", OBSERVATION_COMPACTION_TOOL, HARNESS_BOOTSTRAP_TOOL, ...SELF_HARNESS_MANAGEMENT_TOOLS, ...INTERNAL_NATIVE_HARNESS_TOOLS].includes(event.toolName as any)) return {};
		const observationId = event.observation_id ?? `execution-observation-${++observationCounter}`;
		const preActionValidity = event.toolName === "arc_action" && !event.isError
			? memoryValidityContext(taskScope.taskId, [...observations.values()]) : undefined;
		const resultText = textContent(event.content);
		const observation = {
			observation_id: observationId,
			event_id: observationId,
			tool_name: event.toolName,
			toolCallId: event.toolCallId,
			...(event.batch_tool_call_id ? { batch_tool_call_id: event.batch_tool_call_id,
				batch_index: event.batch_index } : {}),
			...(event.delegated_invocation_id ? { delegated_invocation_id: event.delegated_invocation_id } : {}),
			input: event.input,
			result_text: resultText,
			result: resultText,
			...(event.toolName === "arc_action" ? { arc_outcome: Object.fromEntries(
				["state", "levels_completed", "pre_action_state", "public_transition", "action_budget", "full_reset", "observation_delta", "action_target_cell"]
					.filter(key => Object.prototype.hasOwnProperty.call(event.details ?? {}, key))
					.map(key => [key, (event.details as Record<string, unknown>)[key]]),
			) } : {}),
			is_error: Boolean(event.isError),
			recordedAt: new Date().toISOString(),
		};
		observations.set(observationId, observation);
		if (!event.already_recorded) append("execution-observations.jsonl", observation);
		if (event.toolName === "arc_action" && !event.isError) {
			const input = (event.input ?? {}) as Record<string, any>;
			const parentDecision = input.decision && typeof input.decision === "object" && !Array.isArray(input.decision)
				? input.decision as Record<string, any> : undefined;
			const hasParentText = ["hypothesis", "prediction"].some((field) =>
				typeof parentDecision?.[field] === "string" && parentDecision[field].trim().length > 0);
			if (parentDecision && hasParentText) {
				const writer = nativeHarnessExecutor(pi, "task_memory");
				const fields = ["hypothesis", "prediction", "falsifier", "subgoal", "next_step"];
				const decisionCapsule = Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(parentDecision, field))
					.map((field) => [field, parentDecision[field]]));
				const details = (event.details ?? {}) as Record<string, any>;
				const observedOutcome: Record<string, any> = {};
				const smallValue = (value: unknown) => {
					if (typeof value === "boolean" || typeof value === "number") return value;
					if (typeof value === "string" && value.length <= 200) return value;
					return undefined;
				};
				for (const field of ["state", "levels_completed", "action_budget", "full_reset", "level_before", "level_after", "level_changed"])
					if (Object.prototype.hasOwnProperty.call(details, field) && smallValue(details[field]) !== undefined)
						observedOutcome[field] = smallValue(details[field]);
				if (typeof details.pre_action_state === "string" && details.pre_action_state.length <= 200)
					observedOutcome.pre_action_state_ref = details.pre_action_state;
				const transition = details.public_transition && typeof details.public_transition === "object"
					? details.public_transition as Record<string, any> : {};
				const compactTransition = Object.fromEntries(["reset", "level_changed", "level_before", "level_after", "levels_completed"]
					.filter((field) => smallValue(transition[field]) !== undefined)
					.map((field) => [field, smallValue(transition[field])]));
				if (Object.keys(compactTransition).length) observedOutcome.public_transition = compactTransition;
				const delta = details.observation_delta && typeof details.observation_delta === "object"
					? details.observation_delta as Record<string, any> : {};
				const changedCells = Array.isArray(details.changed_cells) ? details.changed_cells
					: Array.isArray(delta.changed_cells) ? delta.changed_cells : undefined;
				const changedCount = typeof delta.changed_cells === "number" ? delta.changed_cells
					: typeof details.changed_cells === "number" ? details.changed_cells : undefined;
				if (changedCount !== undefined && delta.frame_available !== false) observedOutcome.changed_cells = changedCount;
				if (changedCells) {
					const boundedCells = changedCells.slice(0, 50).filter((cell: unknown) => JSON.stringify(cell).length <= 256);
					observedOutcome.changed_cells = boundedCells;
					if (changedCells.length > boundedCells.length) observedOutcome.changed_cells_omitted = changedCells.length - boundedCells.length;
				}
			if (delta.bbox !== undefined && JSON.stringify(delta.bbox).length <= 300) observedOutcome.bbox = delta.bbox;
				const deltaAvailable = delta.frame_available !== false && (changedCount !== undefined || changedCells !== undefined || delta.bbox !== undefined);
				const probeRecord = {
					format: "arc-action-probe-record-v1",
					decision_capsule: decisionCapsule,
					action: (() => {
						const parameters = Object.fromEntries(Object.entries(input).filter(([name]) => name !== "decision"));
						return JSON.stringify(parameters).length <= 2048
							? { name: input.action ?? null, parameters }
							: { name: input.action ?? null, parameters_omitted: true, serialized_length: JSON.stringify(parameters).length };
					})(),
					observed_outcome: { ...observedOutcome, delta_status: deltaAvailable ? "available_as_returned" : "unavailable" },
				};
				const preAction = preActionValidity!;
				const basisRefs = [observationId,
					...(typeof details.pre_action_state === "string" && details.pre_action_state.trim() ? [details.pre_action_state] : [])];
				const key = `action-decision:${observationId}`;
				const captureHash = createHash("sha256").update(JSON.stringify(probeRecord)).digest("hex");
				try {
					if (!writer) throw new Error("native task_memory writer unavailable");
					const result = await writer(`action-decision:${observationId}`, {
						action: "upsert", key, content: JSON.stringify(probeRecord),
						summary: `Parent prediction: ${String(decisionCapsule.prediction ?? decisionCapsule.hypothesis).slice(0, 240)}; observed: ${JSON.stringify(observedOutcome).slice(0, 240)}`,
						scope: "level", validity: { scope: "level", task_ref: preAction.task, instance_ref: preAction.level },
						basis_refs: basisRefs, claim_kind: "probe_record", memory_capture: true,
						action_decision_capture: true, action_decision_observation_id: observationId,
						capture_id: `action-decision:${observationId}`, capture_item_index: 0, capture_hash: captureHash,
						probe_record: probeRecord,
						expected_effect: "index this parent decision and its public action receipt for later selection",
					});
					append("task-memory-pool-action-capture-events.jsonl", {
						observation_id: observationId, memory_ref: (result.details as any)?.memory_id
							? `memory:${(result.details as any).memory_id}@v${(result.details as any).version}` : null,
						status: result.isError ? "failed" : (result.details as any)?.idempotent ? "duplicate_skipped" : "applied",
						decision_id: (result.details as any)?.decision_id ?? null,
						is_error: Boolean(result.isError), error: result.isError ? textContent(result.content) : null,
						recordedAt: new Date().toISOString(),
					});
				} catch (error) {
					append("task-memory-pool-action-capture-events.jsonl", {
						observation_id: observationId, memory_ref: null, status: "failed", is_error: true,
						error: error instanceof Error ? error.message : String(error), recordedAt: new Date().toISOString(),
					});
				}
			}
		}
		const experimentDecision = event.toolName === "arc_action"
			&& event.input && typeof (event.input as Record<string, unknown>).decision === "object"
			? (event.input as Record<string, any>).decision as Record<string, any> : undefined;
		const experimentRequestRef = String(experimentDecision?.research_request_ref ?? "").trim();
		if (experimentRequestRef) {
			append("research-experiment-events.jsonl", {
				format: "research-experiment-observation-v1",
				request_ref: experimentRequestRef,
				evidence_ref: observationId,
				observation_summary: {
					state: event.details?.state,
					levels_completed: event.details?.levels_completed,
					public_transition: event.details?.public_transition,
					action_budget: event.details?.action_budget,
					observation_delta: event.details?.observation_delta,
				},
				is_error: Boolean(event.isError),
				recordedAt: new Date().toISOString(),
			});
		}
		checkpointObservation(event, observationId, resultText);
		const newSignals = classifyExecutionSignals(
			observation,
			event.details,
			() => `execution-signal-${++signalCounter}`,
		);
		for (const signal of newSignals) {
			signalRecords.push(signal);
			append("execution-signals.jsonl", signal);
		}
		// Generic error candidates use the tool signal; adapter-declared public
		// state/progress pattern keys can also produce conditional contrasts.
		const toolSignal = newSignals.find((signal) => signal.layer === "tool_execution")!;
		latestSignalByIdentity.set(`${observationId}:tool_execution`, toolSignal);
		for (const signal of newSignals.filter((item) => item.layer !== "tool_execution")) {
			latestSignalByIdentity.set(`${observationId}:${signal.layer}`, signal);
		}
		for (const candidate of derivePatternCandidateUpdates({
			observations,
			signalsByObservation: latestSignalByIdentity,
			candidatesByKey: patternCandidatesByKey,
			toolName: String(event.toolName),
			allocateCandidateId: () => `pattern-candidate-${++patternCounter}`,
			recordedAt: observation.recordedAt,
		})) {
			patternCandidatesById.set(candidate.candidate_id, candidate);
			append("pattern-candidates.jsonl", candidate);
		}
		const metadata = `EXECUTION_OBSERVATION: ${JSON.stringify({ observation_id: observationId, outcome: event.isError ? "error" : "success" })}`;
		// The complete result is canonical evaluator data in
		// execution-observations.jsonl. Returning it again through tool details
		// makes Pi place a second full copy in every later provider request. ARC
		// frames are especially large, so expose only a recoverable ID and a
		// bounded excerpt to the model while preserving the full artifact above.
		const modelObservation = {
			observation_id: observationId,
			event_id: observationId,
			tool_name: event.toolName,
			toolCallId: event.toolCallId,
			is_error: Boolean(event.isError),
			result_excerpt: compactText(resultText),
		};
		const details = event.details && typeof event.details === "object"
			? { ...(event.details as Record<string, unknown>), observation: modelObservation }
			: { observation: modelObservation };
		return { content: [...event.content, { type: "text", text: metadata }], details };
	};
	pi.on("tool_result", handleResearchToolResult);

	pi.registerTool({
		name: "research_resource",
		label: "Task-local Research Resource",
		description: "Agent-authored research resource: open question, record/update finding, resolve, or inspect. Usage refs are claims, not proof; no change is valid.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("open"), Type.Literal("record"), Type.Literal("update"), Type.Literal("resolve"), Type.Literal("inspect")]),
			finding_id: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			observation_id: Type.Optional(Type.String()),
			subject_kind: Type.Optional(Type.Union([
				Type.Literal("task"), Type.Literal("component"), Type.Literal("composition"),
				Type.Literal("strategy"), Type.Literal("research_method"),
			])),
			hypothesis: Type.Optional(Type.String()),
			falsifier: Type.Optional(Type.String()),
			question: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			uncertainty: Type.Optional(Type.String()),
			evidence_to_seek: Type.Optional(Type.String()),
			evidence: Type.Optional(Type.String()),
			decision: Type.Optional(Type.String()),
			evidence_refs: Type.Optional(Type.Array(Type.String())),
			assessment_refs: Type.Optional(Type.Array(Type.String())),
			expected_recurrence: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			remaining_uses: Type.Optional(Type.Integer({ minimum: 0 })),
			pinned: Type.Optional(Type.Boolean()),
			reconsider_when: Type.Optional(Type.String()),
			used_in_observation_refs: Type.Optional(Type.Array(Type.String())),
			subject_refs: Type.Optional(Type.Array(Type.String())),
				use_note: Type.Optional(Type.String()),
				component_refs: Type.Optional(Type.Array(Type.String())),
				pattern_candidate_refs: Type.Optional(Type.Array(Type.String())),
			parent_goal_id: Type.Optional(Type.String()),
			depends_on: Type.Optional(Type.Array(Type.String())),
			resolution: Type.Optional(Type.String()),
			query: Type.Optional(Type.String()),
			status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("active"), Type.Literal("resolved")])),
			goal_id: Type.Optional(Type.String()),
			pinned_only: Type.Optional(Type.Boolean()),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1 })),
			include_pattern_candidates: Type.Optional(Type.Boolean()),
			pattern_kind: Type.Optional(Type.Union([
				Type.Literal("repeated_error"), Type.Literal("repeated_success"), Type.Literal("outcome_contrast"),
				Type.Literal("structured_outcome_contrast"), Type.Literal("repeated_structured_outcome"),
				Type.Literal("research_revision_churn"), Type.Literal("repeated_action_cycle"),
			])),
			tool_name: Type.Optional(Type.String()),
			include_graph: Type.Optional(Type.Boolean()),
			focus_finding_id: Type.Optional(Type.String()),
			focus_goal_id: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action !== "inspect") {
				const admission = admitTaskLocalOperation("research_resource");
				if (admission) return admission;
			}
			if (p.action === "inspect") {
				const query = String(p.query ?? "").trim().toLocaleLowerCase();
				const offset = Number(p.offset ?? 0);
				const limit = p.limit === undefined ? Number.MAX_SAFE_INTEGER : Number(p.limit);
				const searchableText = (finding: Finding) => [
					finding.finding_id, finding.goal_id, finding.question, finding.scope,
					finding.uncertainty, finding.evidence_to_seek, finding.evidence,
					finding.decision, finding.reconsider_when, finding.use_note,
				].filter(Boolean).join("\n").toLocaleLowerCase();
				const matchedFindings = [...findings.values()]
					.filter((finding) => !p.finding_id || finding.finding_id === p.finding_id)
					.filter((finding) => !p.goal_id || finding.goal_id === p.goal_id)
					.filter((finding) => !p.status || finding.status === p.status)
					.filter((finding) => p.pinned_only !== true || finding.pinned === true)
					.filter((finding) => !query || searchableText(finding).includes(query))
					.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)));
				const selectedFindings = matchedFindings.slice(offset, offset + limit);
				const selectedObservations = p.observation_id ? [observations.get(p.observation_id)].filter(Boolean) : [];
				const selectedSignals = p.observation_id
					? signalRecords.filter((signal) => signal.observation_id === p.observation_id)
					: [];
				const selectedPatternCandidates = p.include_pattern_candidates === true
					? [...patternCandidatesById.values()]
						.filter((candidate) => !p.pattern_kind || candidate.kind === p.pattern_kind)
						.filter((candidate) => !p.tool_name || candidate.tool_name === p.tool_name)
						.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)))
						.slice(0, Math.max(0, limit))
					: [];
				const researchGraph = p.include_graph === true
					? buildResearchGraph(findings, {
						focusFindingId: p.focus_finding_id,
						focusGoalId: p.focus_goal_id,
					})
					: null;
				const result = { read_only: true, findings: selectedFindings, observations: selectedObservations,
					signals: selectedSignals,
					signal_summary: summarizeExecutionSignals(signalRecords),
					pattern_candidates: selectedPatternCandidates,
					research_graph: researchGraph,
					page: { offset, limit, total: matchedFindings.length,
						next_offset: offset + limit < matchedFindings.length ? offset + limit : null },
					prior_decisions: readJsonl("harness-decisions.jsonl"),
					exposure_observations: readJsonl("harness-observations.jsonl"),
					effect_assessments: readJsonl("effect-assessments.jsonl") };
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			let previous: Finding | undefined;
			if (!["open", "record"].includes(p.action)) {
				previous = findings.get(String(p.finding_id));
				if (!previous) throw new Error("unknown finding_id");
				if (previous.version !== p.target_version) throw new Error("target_version must match the current research resource version");
			}
			// Observation references are optional so research can also preserve an
			// Agent-authored hypothesis before a tool result exists. Any references
			// supplied still resolve against canonical task observations.
			const evidenceRefs = Array.isArray(p.evidence_refs) ? p.evidence_refs.slice() : [...(previous?.evidence_refs ?? [])];
			if (typeof p.observation_id === "string" && p.observation_id && !evidenceRefs.includes(p.observation_id)) {
				evidenceRefs.push(p.observation_id);
			}
			if (evidenceRefs.some((id: string) => !observations.has(id))) throw new Error("findings require known execution observation IDs");
			if (p.action === "open" && (!String(p.question ?? "").trim() || !String(p.evidence_to_seek ?? "").trim())) {
				throw new Error("open requires a question and evidence_to_seek");
			}
			const newAssessmentRefs = Array.isArray(p.assessment_refs) ? p.assessment_refs.map(String) : [];
			if (newAssessmentRefs.some((id: string) => !pendingAssessments.has(id))) throw new Error("unknown effect assessment reference");
			const assessmentRefs = Array.isArray(p.assessment_refs)
				? [...new Set([...(previous?.assessment_refs ?? []), ...newAssessmentRefs])]
				: [...(previous?.assessment_refs ?? [])];
			const newUseRefs = Array.isArray(p.used_in_observation_refs) ? p.used_in_observation_refs.map(String) : [];
			if (newUseRefs.some((id: string) => !observations.has(id))) {
				throw new Error("used_in_observation_refs require known execution observation IDs");
			}
			const usedInObservationRefs = [...new Set([...(previous?.used_in_observation_refs ?? []), ...newUseRefs])];
			const newSubjectRefs = Array.isArray(p.subject_refs)
				? p.subject_refs.map(String).map((value: string) => value.trim()).filter(Boolean)
				: [];
			const subjectRefs = [...new Set([...(previous?.subject_refs ?? []), ...newSubjectRefs])];
			const newComponentRefs = Array.isArray(p.component_refs)
					? p.component_refs.map(String).map((value: string) => value.trim()).filter(Boolean)
					: [];
			const componentRefs = [...new Set([...(previous?.component_refs ?? []), ...newComponentRefs])];
				const newPatternCandidateRefs = Array.isArray(p.pattern_candidate_refs) ? p.pattern_candidate_refs.map(String) : [];
			if (newPatternCandidateRefs.some((id: string) => !patternCandidatesById.has(id))) {
				throw new Error("pattern_candidate_refs require known automatic pattern candidate IDs");
			}
			const patternCandidateRefs = Array.isArray(p.pattern_candidate_refs)
				? [...new Set([...(previous?.pattern_candidate_refs ?? []), ...newPatternCandidateRefs])]
				: [...(previous?.pattern_candidate_refs ?? [])];
			const nextFindingNumber = findingCounter + 1;
			const findingId = previous?.finding_id ?? `finding-${nextFindingNumber}`;
			const goalId = previous?.goal_id ?? `research-goal-${nextFindingNumber}`;
			const parentGoalId = p.parent_goal_id ?? previous?.parent_goal_id;
			const dependsOn = Array.isArray(p.depends_on)
				? [...new Set(p.depends_on.map(String))]
				: [...(previous?.depends_on ?? [])];
			validateResearchRelations({
				candidateFindingId: findingId,
				candidateGoalId: goalId,
				parentGoalId,
				dependsOn,
				findings,
				knownVersions: findingVersions,
			});
			if (!previous) findingCounter = nextFindingNumber;
			const status: Finding["status"] = p.action === "resolve"
				? "resolved"
				: evidenceRefs.length || p.action === "record"
					? "active"
					: "open";
			const finding: Finding = {
				...((p.subject_kind ?? previous?.subject_kind) ? { subject_kind: p.subject_kind ?? previous?.subject_kind } : {}),
				...((p.hypothesis ?? previous?.hypothesis) ? { hypothesis: p.hypothesis ?? previous?.hypothesis } : {}),
				...((p.falsifier ?? previous?.falsifier) ? { falsifier: p.falsifier ?? previous?.falsifier } : {}),
				kind: status === "open" ? "research_goal" : "finding",
				goal_id: goalId,
				finding_id: findingId,
				version: (previous?.version ?? 0) + 1,
				research_event_id: `research-event-${++researchCounter}`,
				evidence_refs: evidenceRefs,
				assessment_refs: assessmentRefs,
				status,
				question: String(p.question ?? previous?.question ?? "What task-local observation should change a later execution decision?"),
				scope: String(p.scope ?? previous?.scope ?? "current benchmark task"),
				uncertainty: String(p.uncertainty ?? previous?.uncertainty ?? "bounded task-local uncertainty"),
				evidence_to_seek: String(p.evidence_to_seek ?? previous?.evidence_to_seek ?? ""),
				evidence: String(p.evidence ?? previous?.evidence ?? ""),
				decision: String(p.decision ?? previous?.decision ?? ""),
				expected_recurrence: p.expected_recurrence ?? previous?.expected_recurrence ?? "medium",
				remaining_uses: Number(p.remaining_uses ?? previous?.remaining_uses ?? 1),
				...(Boolean(p.pinned ?? previous?.pinned ?? false) ? { pinned: true } : {}),
				...(String(p.reconsider_when ?? previous?.reconsider_when ?? "").trim()
					? { reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when) }
					: {}),
				...(usedInObservationRefs.length ? { used_in_observation_refs: usedInObservationRefs } : {}),
				...(String(p.use_note ?? previous?.use_note ?? "").trim()
					? { use_note: String(p.use_note ?? previous?.use_note) }
					: {}),
				...(subjectRefs.length ? { subject_refs: subjectRefs } : {}),
					...(componentRefs.length ? { component_refs: componentRefs } : {}),
					...(patternCandidateRefs.length ? { pattern_candidate_refs: patternCandidateRefs } : {}),
				...(parentGoalId ? { parent_goal_id: String(parentGoalId) } : {}),
				...(dependsOn.length ? { depends_on: dependsOn } : {}),
				...(p.resolution ? { resolution: String(p.resolution) } : {}),
				recordedAt: new Date().toISOString(),
			};
			findings.set(findingId, finding);
			findingVersions.add(`${findingId}@v${finding.version}`);
			append("research-resources.jsonl", finding);
			for (const candidate of deriveResearchRevisionCandidateUpdates({
				finding,
				candidatesByKey: patternCandidatesByKey,
				allocateCandidateId: () => `pattern-candidate-${++patternCounter}`,
				recordedAt: finding.recordedAt,
			})) {
				patternCandidatesById.set(candidate.candidate_id, candidate);
				append("pattern-candidates.jsonl", candidate);
			}
			for (const id of newAssessmentRefs) pendingAssessments.delete(id);
			return { content: [{ type: "text", text: JSON.stringify(finding) }], details: finding };
		},
	});

	const compaction = installAgentOwnedObservationCompaction(pi, {
		enabled: process.env.PI_AUTORESEARCH_CONTEXT_COMPACTION === "enabled",
		scope: "current external benchmark task",
		getFinding: (id) => {
			const finding = findings.get(id);
			return !finding || finding.status === "open" ? undefined : finding;
		},
		getObservation: (id) => observations.get(id),
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		append,
		pendingAssessments,
	});
	installTaskLocalSelfHarness(pi, {
		root,
		append,
		readJsonl,
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		getObservation: (id) => observations.get(id),
		resolveBasisRefs,
		pendingAssessments,
		taskToolAdapter: options.taskToolAdapter,
	});
	pi.on("context", async (event) => {
		const resources: any[] = [];
		// SDK preparation failures bypass tool_result hooks. Project their actual
		// transcript results here, after preserving exact audit evidence. Match
		// both call identity and error body because providers can reuse call IDs.
		const failures = readJsonl("task-operation-failures.jsonl");
		event.messages = event.messages.map((message: any) => {
			if (message.role !== "toolResult" || !message.isError) return message;
			const text = textContent(message.content);
			const failure = failures.findLast((row: Record<string, any>) => row.toolCallId === message.toolCallId
				&& row.tool === message.toolName && text.startsWith(row.error));
            // Preserve already-short structured recovery contracts verbatim.
            // Their commit/preflight semantics must survive context projection.
            return failure && String(failure.error).length > 1200
                ? { ...message, content: [{ type: "text", text: JSON.stringify(failureReceipt(failure)) }] } : message;
		});
		event.messages = event.messages.filter((message: any) => !Array.isArray(message.content)
			|| !message.content.some((item: any) => item.type === "text" && item.text?.startsWith("CURRENT COMPETITION VIEW:")));
		// A non-blocking child can finish after the tool result that originally
		// marked it active. Refresh the projected status from the append-only
		// session ledger so later parent turns do not keep seeing stale "active".
		if (checkpoint.research_session_ref) {
			const match = checkpoint.research_session_ref.match(/^research_session:([^@]+)@v\d+$/);
			if (match) {
				const latest = readJsonl("auto-research-sessions.jsonl")
					.filter(row => row.session_id === match[1])
					.sort((a, b) => Number(a.version ?? 0) - Number(b.version ?? 0)).at(-1);
				if (latest && (checkpoint.research_status !== latest.status
					|| checkpoint.research_session_ref !== `research_session:${latest.session_id}@v${latest.version}`)) {
					saveCheckpoint({ research_status:String(latest.status),
						research_session_ref:`research_session:${latest.session_id}@v${latest.version}`,
						...(latest.summary ? {research_report_summary:compactText(latest.summary,600)} : {}) });
				}
			}
		}
		// The checkpoint is an exact resource; the provider sees a current decision
		// card. Plan state takes precedence over legacy free-text next_step fields.
		persistCheckpointResource();
		const strategyIndex = taskStrategyIndex(readTaskStrategyState(root));
		const competition = buildCompetitionView(root);
		if (competition) {
			persistCompetitionView(root, competition);
			const projectedCompetition = competitionProjection(competition);
			resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `CURRENT COMPETITION VIEW: ${JSON.stringify(projectedCompetition)}` }] });
			append("task-competition-exposure.jsonl", { event: "intended_exposure", view_ref: competition.view_ref,
				sha256: competition.sha256, recordedAt: new Date().toISOString() });
		}
		const activePlan = strategyIndex?.plan?.status === "active";
		const lastAction = checkpoint.recent_actions?.at(-1);
		const pendingOps = checkpoint.pending_operations ?? [];
		const staleReasoning = new Set(checkpoint.reasoning_state?.stale_fields ?? []);
		const currentReasoning = (field: keyof TaskCheckpoint, limit: number) =>
			staleReasoning.has(field) ? undefined : boundedText(checkpoint[field], limit);
		const checkpointProjection = {
			format: "task-decision-card-v1",
			revision: checkpoint.revision,
			checkpoint_ref: checkpointRef(),
			harness_started: checkpoint.harness_started,
			latest_environment: checkpoint.latest_environment,
			last_action: lastAction ?? null,
			last_action_ref: lastAction?.observation_id
				? `observation:${String(lastAction.observation_id)}@v1` : null,
			action_count: checkpoint.recent_actions?.length ?? 0,
			current_subgoal: currentReasoning("current_subgoal", 300),
			task_goal: currentReasoning("task_goal", 350),
			...(staleReasoning.size ? { reasoning_state_update: { ...checkpoint.reasoning_state,
				previous_interpretations: Object.fromEntries([...staleReasoning].map(field => [field,
					boundedText(checkpoint[field as keyof TaskCheckpoint], 180)])),
				instruction: "Review these prior interpretations against the current environment. Persist applicable subgoal/hypothesis/next_step through arc_action.decision; use task_checkpoint for other plan edits. Preserve transferable knowledge with its evidence and scope." } } : {}),
			success_conditions: (checkpoint.success_conditions ?? []).slice(0, 4).map(item => boundedText(item, 220)),
			task_constraints: (checkpoint.task_constraints ?? []).slice(0, 4).map(item => boundedText(item, 160)),
			planning_gap: boundedText(checkpoint.planning_gap, 300),
			...(!activePlan ? {
				current_strategy: currentReasoning("current_strategy", 350),
				hypothesis: currentReasoning("hypothesis", 350),
				next_step: currentReasoning("next_step", 250),
				strategy_alternatives: (checkpoint.strategy_alternatives ?? []).slice(0, 3).map(item => boundedText(item, 180)),
				working_summary: checkpoint.working_summary && !staleReasoning.has("working_summary") ? {
					text: boundedText(checkpoint.working_summary, 650),
					basis_refs: (checkpoint.summary_basis_refs ?? []).slice(-6),
					epistemic_status: "agent_interpretation_not_runtime_fact",
				} : undefined,
			} : {}),
			decision_refs: (checkpoint.decision_refs ?? []).slice(-8),
			omitted_decision_ref_count: Math.max(0, (checkpoint.decision_refs ?? []).length - 8),
			...(strategyIndex ? { strategy_state: competition ? { revision: strategyIndex.revision,
				selected_candidate_id: strategyIndex.selected_candidate_id, plan: strategyIndex.plan } : strategyIndex } : {}),
			pending_operation_count: pendingOps.length,
			pending_operations: pendingOps.slice(-2).map(pendingFailureProjection),
			decision_capsule: checkpoint.decision_capsule ? {
				hypothesis_id: checkpoint.decision_capsule.hypothesis_id,
				prediction: boundedText(checkpoint.decision_capsule.prediction, 240),
				falsifier: boundedText(checkpoint.decision_capsule.falsifier, 240),
			} : undefined,
			latest_research_run: checkpoint.latest_research_run_ref ? {
				resource_ref: checkpoint.latest_research_run_ref,
				status: checkpoint.research_status,
				session_ref: checkpoint.research_session_ref,
				question: checkpoint.research_question,
				cursor: checkpoint.research_cursor,
				resume_condition: checkpoint.research_resume_condition,
				report_summary: boundedText(checkpoint.research_report_summary, 220),
				harness_proposal_count: checkpoint.harness_proposal_count ?? 0,
				epistemic_status: "child_report_not_automatically_adopted",
			} : undefined,
		};
		resources.push({
			role: "user",
			content: [{
				type: "text",
				text: `CURRENT TASK STATE (environment fields are runtime facts; hypotheses, plans and summaries are agent-authored): ${JSON.stringify(
					process.env.PI_CONTEXT_DECISION_CARD_V2 === "disabled" ? checkpointProjection
					: decisionCardV2(checkpoint, readTaskStrategyState(root), checkpointRef(), readWorkset(pi, root).gaps(),
						reviewProgress(readJsonl("execution-signals.jsonl")),
						readJsonl("auto-research-reports.jsonl").filter(row =>
							checkpoint.latest_research_run_ref?.startsWith(`research_run:${row.run_id}@`)).at(-1), readJsonl("execution-observations.jsonl"),
							competition ? competitionProjection(competition) : undefined))}`,
			}],
			timestamp: Date.now(),
		});
		const lastUsage = readJsonl("context-token-debug.jsonl")
			.filter(row => row.event === "provider_response_usage" && row.scope === "treatment").at(-1);
		const longOutputWithoutProgress = noProgressTurns >= 1
			&& Number(lastUsage?.actual_output_tokens ?? 0) >= 20_000;
		if (noProgressTurns >= 2 || longOutputWithoutProgress) {
			const cue = JSON.stringify({ progress: lastDecisionProgress,
				plan_step: strategyIndex?.plan?.current_step,
				last_outcome: strategyIndex?.plan?.last_step_outcome,
				long_output: longOutputWithoutProgress });
			if (cue !== lastNoProgressCue) {
				lastNoProgressCue = cue;
				resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
					text: `${activePlan ? "Active plan" : "Current investigation"} has had ${noProgressTurns} completed turns without new action or strategy evidence${longOutputWithoutProgress ? `; the latest completed response used ${Number(lastUsage?.actual_output_tokens)} output tokens` : ""}. CURRENT TASK STATE keeps goal knowledge separate from operation effects. Use the next discriminating action, revise with exact evidence, assign bounded research when useful, or read a specific missing ref. This is an advisory cue, not an action gate.` }] });
			}
		}
		const activeFindings = activeFindingDigest(findings);
		const openResearch = openResearchDigest(findings);
		const acceptedPatternCandidateIds = new Set(
			[...findings.values()].flatMap((finding) => finding.pattern_candidate_refs ?? []),
		);
		const patternCandidates = patternCandidateDigest(
			patternCandidatesById.values(), acceptedPatternCandidateIds,
		);
		const pending = [...pendingAssessments.values()];
		if (openResearch.length) {
			resources.push({
				role: "user",
				content: [{ type: "text", text: `Open task-local research questions: ${JSON.stringify(openResearch)}` }],
				timestamp: Date.now(),
			});
		}
		if (activeFindings.length) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Active task-local research findings for later decisions: ${JSON.stringify(activeFindings)}`,
				}],
				timestamp: Date.now(),
			});
		}
		if (patternCandidates.length) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Automatically derived task-local pattern candidates: ${JSON.stringify(patternCandidates)}. These are causal-neutral candidates, not findings; inspect, test, accept into a finding, or ignore them.`,
				}],
				timestamp: Date.now(),
			});
		}
		if (pending.length) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Pending task-local execution-condition effects: ${JSON.stringify(pending)}`,
				}],
				timestamp: Date.now(),
			});
		}
		if (!resources.length) return {};
		const exposureState = {
			finding_ids: activeFindings.map((finding) => ({ finding_id: finding.finding_id, version: finding.version })),
			open_goal_ids: openResearch.map((item) => ({ goal_id: item.goal_id, version: item.version })),
			pattern_candidate_ids: patternCandidates.map((item) => ({ candidate_id: item.candidate_id, version: item.version })),
			pending_assessment_ids: pending.map((assessment) => assessment.effect_assessment_id),
		};
		const exposureSignature = JSON.stringify(exposureState);
		if (exposureSignature !== lastExposureSignature) {
			lastExposureSignature = exposureSignature;
			append("research-exposures.jsonl", {
				exposure_id: `exposure-${++exposureCounter}`,
				...exposureState,
				message_count_before: event.messages.length,
				message_count_after: event.messages.length + resources.length,
				recordedAt: new Date().toISOString(),
			});
		}
		return { messages: [...event.messages, ...resources] };
	});
	// The provider transcript is only a bounded working projection. Register
	// this after research and harness projections so it can deduplicate their
	// repeated messages as well as archive old tool turns.
	installTaskLocalContextLifecycle(pi, {
		root,
	});
	// Register telemetry last among the task-local context handlers. For custom
	// providers that do not emit before_provider_request, its context fallback
	// then sees the same final projection that the model sees.
	installProviderTelemetry(pi, { root, scope: "treatment" });
	return { resolveBasisRefs };
}
