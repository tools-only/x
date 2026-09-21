/** Shared task-local Auto-Research resources for external Pi benchmarks. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
import { installTaskLocalContextLifecycle } from "./pi_task_local_context_lifecycle.ts";
import { installTaskResourceReader } from "./pi_task_resource_store.ts";
import { installTaskValidation } from "./pi_task_validation.ts";
import { loadPrompt } from "./prompt_loader.ts";
import { admitTaskLocalOperation, noteArcActionCompleted } from "./pi_task_execution_admission.ts";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { bindOperationIdentity, controlOperationKey, eligibleResearchHandoffStatuses, failureClassification, latestControlRecords } from "./pi_harness_control.ts";

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
		const projectedMethod = autoResearchAvailable
			? loadPrompt("auto_research_main_contract.md") + (process.env.PI_ARC_EXECUTION_GATE === "enabled"
				? "\n\n" + loadPrompt("auto_research_arc_contract.md") : "")
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
		const core = ["task_harness", "task_harness_status", "task_checkpoint", "task_resource", "task_validation"];
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
			const initialManagement = ordinaryManagement.filter((name) => !compactInitialExcluded.has(name));
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
		const overlay = renderTaskSystemPromptOverlay(readJsonl("task-system-prompt.jsonl") as any, taskKnowledgeEntries(readJsonl));
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
		current_subgoal?: string;
		hypothesis?: string;
		next_step?: string;
		working_summary?: string;
		summary_basis_refs?: string[];
		pending_operations?: Array<Record<string, unknown>>;
		decision_refs: string[];
		decision_capsule?: Record<string, unknown>;
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
	let checkpointSnapshotSequence = checkpoint.patch_sequence;
	const startupPatches = readCheckpointPatches();
	for (let index = checkpointSnapshotSequence; index < startupPatches.length; index += 1) {
		checkpoint = applyCheckpointPatch(checkpoint, startupPatches[index], index + 1);
	}
	let checkpointPatchSequence = startupPatches.length;
	let checkpointWriteCounter = 0;
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
		if (checkpointPatchSequence - checkpointSnapshotSequence >= 32) flushCheckpoint("periodic");
	};
	pi.on("agent_end", async () => {
		flushCheckpoint("agent_end");
	});
	const trackedResourceTools = new Set<string>([...SELF_HARNESS_MANAGEMENT_TOOLS,
		...INTERNAL_NATIVE_HARNESS_TOOLS, "research_resource", "task_validation", "task_checkpoint", "delegate_task", "auto_research"]);
	let failureCounter = nextCounter(readJsonl("task-operation-failures.jsonl"), "failure_id");
	const operationKey = (tool: string, input: Record<string, any>) =>
		controlOperationKey(tool, input, taskScope.taskId);
	const failedOperation = (tool: string, input: Record<string, any>, toolCallId: string, error: string) => {
		const key = operationKey(tool, input);
		const failureId = `failure-${++failureCounter}`;
		const classification = failureClassification(error);
		const candidates = Array.isArray(classification.candidates) ? classification.candidates : [];
		const recoveryOperationKeys = candidates
			.map((candidate: Record<string, any>) => candidate.research_handoff_ref)
			.filter(Boolean)
			.map((research_handoff_ref: string) => operationKey(tool, {...input, research_handoff_ref}));
		const failure = { operation_key: key, tool, action: input.action, toolCallId, error,
			...(classification.failure_class === "version_conflict" && Number.isInteger(classification.current_version)
				? {recovery_operation_key:operationKey(tool,{...input,target_version:classification.current_version})} : {}),
			...(recoveryOperationKeys.length ? {recovery_operation_keys: recoveryOperationKeys} : {}),
			failure_id:failureId, recordedAt:new Date().toISOString(), resolved_by:null,
			failure_class:classification.failure_class, retryable:classification.retryable, required_next_call:classification.required_next_call,
			recovery_hint:classification.recovery_hint ?? null,
			resource_ref: `failure:${failureId}@v1`,
			note: "Follow required_next_call; only success for the same action and bound target resolves this failure." };
		append("task-operation-failures.jsonl", { ...failure, failure_id: failureId, version: 1, status: "failed",
			error, attempted_input: input,
			applied: classification.applied });
		const pending = (checkpoint.pending_operations ?? []).filter((r) => r.operation_key !== key);
		if (classification.retryable !== false) pending.push(failure);
		saveCheckpoint({ pending_operations: pending });
	};
	const reconcilePendingOperations = () => {
		const pending = checkpoint.pending_operations ?? [];
		if (!pending.length) return;
		const reviews = readJsonl("task-harness-reviews.jsonl");
		const opportunities = readJsonl("task-harness-opportunities.jsonl");
		const reviewEvents = readJsonl("task-harness-review-events.jsonl");
		const handoffs = latestControlRecords(readJsonl("auto-research-handoffs.jsonl"), "handoff_id");
		const obsolete = (record: Record<string, any>) => {
			const classification = failureClassification(String(record.error ?? ""));
			if (classification.retryable === false || record.retryable === false) return true;
			let operation: Record<string, any>;
			try { operation = JSON.parse(String(record.operation_key)); } catch { return false; }
			const target = operation.target ?? {};
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
	const handledResourceFailures = new Set<string>();
	pi.on("tool_execution_start", (event) => {
		if (trackedResourceTools.has(event.toolName)) inFlightResourceInputs.set(event.toolCallId, bindOperationIdentity(event.toolName, event.args as Record<string, any>, readJsonl));
	});
	pi.on("tool_execution_end", (event) => {
		const input = inFlightResourceInputs.get(event.toolCallId);
		inFlightResourceInputs.delete(event.toolCallId);
		const handled = handledResourceFailures.delete(event.toolCallId);
		// Pi skips execute/tool_result entirely for length-truncated arguments.
		// Capture that failure at its actual completion boundary, without replay.
		if (input && event.isError && !handled) failedOperation(event.toolName, input, event.toolCallId,
			textContent((event.result as any)?.content));
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
		if (decisionCapsule && !event.isError) validationLedger.observeDecision(observationId, decisionCapsule);
		const actionRecord = actionInput ? {
			action: String(actionInput.action ?? "UNKNOWN"),
			observation_id: observationId,
			changed_cells: typeof delta?.changed_cells === "number" ? delta.changed_cells : undefined,
			bbox: delta?.bbox,
			level_changed: transition?.level_changed,
			level_after: transition?.level_after,
			state: details?.state,
		} : undefined;
		saveCheckpoint({
			latest_observation: item,
			recent_observations: recent,
			latest_environment: environmentProjection(event.details) ?? checkpoint.latest_environment,
			...(decisionCapsule ? {
				decision_capsule: decisionCapsule,
				...(typeof decisionCapsule.subgoal === "string" ? { current_subgoal: decisionCapsule.subgoal } : {}),
				...(typeof decisionCapsule.hypothesis === "string" ? { hypothesis: decisionCapsule.hypothesis } : {}),
				...(typeof decisionCapsule.next_step === "string" ? { next_step: decisionCapsule.next_step } : {}),
				...(Array.isArray(decisionCapsule.decision_refs) ? { decision_refs: decisionCapsule.decision_refs.map(String) } : {}),
			} : {}),
			...(actionRecord ? { recent_actions: [...(checkpoint.recent_actions ?? []), actionRecord] } : {}),
		});
	};
	// The checkpoint is a native task control-plane resource.  It is deliberately
	// separate from research findings and harness resources: compaction may
	// project its decision-bearing fields, while the complete JSON remains
	// durable and recoverable on disk.  Updates are agent-authored state, never
	// environment facts, and are persisted atomically through saveCheckpoint.
	pi.registerTool({
		name: "task_checkpoint",
		label: "Task-local execution checkpoint",
		description: "Persist or inspect the current task execution checkpoint. Checkpoint fields are agent-authored planning state unless explicitly marked as runtime environment data; they are durable and projected into later provider context.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("update"), Type.Literal("inspect")]),
			current_subgoal: Type.Optional(Type.String()),
			hypothesis: Type.Optional(Type.String()),
			next_step: Type.Optional(Type.String()),
			working_summary: Type.Optional(Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())])),
			summary_basis_refs: Type.Optional(Type.Array(Type.String())),
			decision_refs: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, params) {
			const input = params as Record<string, any>;
			if (input.action === "inspect") {
				return { content: [{ type: "text", text: JSON.stringify(checkpoint) }], details: checkpoint };
			}
			const patch: Partial<TaskCheckpoint> = {};
			for (const key of ["current_subgoal", "hypothesis", "next_step", "working_summary"] as const) {
				if (typeof input[key] === "string") patch[key] = input[key];
				else if (key === "working_summary" && input[key] && typeof input[key] === "object") patch[key] = JSON.stringify(input[key]);
			}
			if (Array.isArray(input.summary_basis_refs)) patch.summary_basis_refs = input.summary_basis_refs.map(String);
			if (Array.isArray(input.decision_refs)) patch.decision_refs = input.decision_refs.map(String);
			saveCheckpoint(patch);
			return { content: [{ type: "text", text: JSON.stringify(checkpoint) }], details: checkpoint };
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

	pi.on("tool_result", async (event) => {
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
		const observationId = `execution-observation-${++observationCounter}`;
		const resultText = textContent(event.content);
		const observation = {
			observation_id: observationId,
			event_id: observationId,
			tool_name: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
			result_text: resultText,
			result: resultText,
			...(event.toolName === "arc_action" ? { arc_outcome: Object.fromEntries(
				["state", "levels_completed", "pre_action_state", "public_transition", "action_budget", "full_reset"]
					.filter(key => Object.prototype.hasOwnProperty.call(event.details ?? {}, key))
					.map(key => [key, (event.details as Record<string, unknown>)[key]]),
			) } : {}),
			is_error: Boolean(event.isError),
			recordedAt: new Date().toISOString(),
		};
		observations.set(observationId, observation);
		append("execution-observations.jsonl", observation);
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
	});

	pi.registerTool({
		name: "research_resource",
		label: "Task-local Research Resource",
		description: "Optional Agent-authored current-task research resource. action=open preserves a question before evidence exists; record creates a finding from an observation or an Agent hypothesis; update may revise either; resolve closes it. Observation references are optional for hypotheses and validated when supplied. inspect is read-only and supports bounded search. An update may cite later task observations in which the finding was actually used; this is an Agent-authored usage claim, not proof of benefit. No research and no change are valid.",
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
		// Project only decision-bearing checkpoint fields. The full checkpoint is
		// durable on disk, but replaying five 720-character observation excerpts
		// on every context hook needlessly reintroduces the history growth that
		// this lifecycle is meant to prevent.
		const checkpointProjection = {
			format: checkpoint.format,
			revision: checkpoint.revision,
			harness_started: checkpoint.harness_started,
			latest_environment: checkpoint.latest_environment,
			recent_actions: checkpoint.recent_actions ?? [],
			current_subgoal: checkpoint.current_subgoal,
			hypothesis: checkpoint.hypothesis,
			next_step: checkpoint.next_step,
			decision_refs: checkpoint.decision_refs,
			working_summary: checkpoint.working_summary ? {
				text: checkpoint.working_summary, basis_refs: checkpoint.summary_basis_refs ?? [],
				epistemic_status: "agent_interpretation_not_runtime_fact",
			} : undefined,
			pending_operations: checkpoint.pending_operations ?? [],
			decision_capsule: checkpoint.decision_capsule ? {
				hypothesis_id: checkpoint.decision_capsule.hypothesis_id,
				prediction: checkpoint.decision_capsule.prediction,
				falsifier: checkpoint.decision_capsule.falsifier,
			} : undefined,
			latest_research_run: checkpoint.latest_research_run_ref ? {
				resource_ref: checkpoint.latest_research_run_ref,
				status: checkpoint.research_status,
				session_ref: checkpoint.research_session_ref,
				question: checkpoint.research_question,
				cursor: checkpoint.research_cursor,
				resume_condition: checkpoint.research_resume_condition,
				report_summary: checkpoint.research_report_summary,
				harness_proposal_count: checkpoint.harness_proposal_count ?? 0,
				epistemic_status: "child_report_not_automatically_adopted",
			} : undefined,
		};
		resources.push({
			role: "user",
			content: [{
				type: "text",
				text: `CURRENT TASK STATE (environment fields are runtime facts; hypotheses, plans and summaries are agent-authored): ${JSON.stringify(checkpointProjection)}`,
			}],
			timestamp: Date.now(),
		});
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
	installTaskLocalContextLifecycle(pi, { root });
	// Register telemetry last among the task-local context handlers. For custom
	// providers that do not emit before_provider_request, its context fallback
	// then sees the same final projection that the model sees.
	installProviderTelemetry(pi, { root, scope: "treatment" });
	return { resolveBasisRefs };
}
