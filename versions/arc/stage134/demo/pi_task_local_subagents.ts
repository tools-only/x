/** Agent-owned task-local delegation using a separate native Pi process. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai/compat";
import { admitTaskLocalOperation } from "./pi_task_execution_admission.ts";
import { bindExperimentRequest, buildAutoResearchCapsule, buildParentAuthoringHandoffs, normalizeAutoResearchReport, researchActionContinuation } from "./pi_auto_research_output.ts";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { Type } from "typebox";
import { compactToolSchema } from "./pi_compact_tool_schema.ts";
import { registerManagementTool } from "./pi_management_schema_surface.ts";
import { installTaskResultSemantics, resolveTaskResource, resourceMetadata, taskRecords, versionConflict } from "./pi_task_resource_store.ts";
import { registerNativeHarnessExecutor } from "./pi_task_harness_route_runtime.ts";
import { TASK_TOOL_PROGRAM_STEP_KINDS } from "./pi_task_tool_contract.ts";
import { loadPrompt } from "./prompt_loader.ts";
import { canonicalEvidenceSnapshot, parentEvidenceSnapshot, evidenceRefsAfter } from "./pi_auto_research_evidence.ts";
import { applyResearchHandoff, resolveResearchHandoff, researchHandoffReference, reconcileResearchHandoffs } from "./pi_auto_research_handoff.ts";
import { controlError, latestControlRecords, selectControlTarget } from "./pi_harness_control.ts";
import { readCurrentTaskCheckpoint } from "./pi_task_checkpoint_reader.ts";
import { materializeStrategyCandidates, readTaskStrategyState, taskStrategyIndex, updateTaskStrategyState } from "./pi_task_strategy_state.ts";
import { buildCompetitionView, competitionProjection, persistCompetitionView } from "./pi_task_competition.ts";
import { auditResearchConfidence } from "./pi_research_confidence.ts";
import { researchRequestIdentity } from "./pi_research_request_identity.ts";
import {
	buildResearchWorkset, compareResearchProgress, createResearchPlan, releaseResearchNode,
	researchPlanView, transitionResearchNode, type ResearchPlan, type ResearchNodeStatus,
} from "./pi_auto_research_protocol.ts";
import { buildCrossContextComparison, crossContextComparisonForChild, methodRecordsFromReport, methodUseRejection, bindResearchCandidateParameters } from "./pi_research_method_runtime.ts";
import {
	buildAutoResearchAgendaRecord, buildAutoResearchProgressReceipt, researchReportNeedsParentAttention,
} from "./pi_auto_research_agenda.ts";
import { autoResearchHistoryGrants, buildAutoResearchHistoryCatalog } from "./pi_auto_research_history.ts";
import { assemblySelectsReference, latestHarnessAssembly } from "./pi_task_harness_assembly.ts";
import { canonicalTextBody } from "./pi_harness_protocol.ts";
import { normalizeContextRecipe, normalizeDelegateOutputContract, type SubagentContextRecipe } from "./pi_subagent_context_recipe.ts";
import { memoryValidityContext, memoryValidityReasons, normalizeMemoryValidity, type MemoryValidity } from "./pi_memory_validity.ts";
import { baselineMethodCatalog, readBaselineMethod } from "./pi_harness_baseline_methods.ts";
import { bridge } from "./pi_arc_bridge_client.ts";
import { WORKER_EVIDENCE_KINDS, assignResearchWorker, researchWorkers, workerRef, resolveWorker,
	updateWorker, routeWorkerEvidence, pendingWorkerEvidence } from "./pi_auto_research_workers.ts";
import { advanceResearchWorkers, deliverResearchIncrements } from "./pi_auto_research_worker_runtime.ts";

const CONTEXT_RECIPE_BRIEF = "Only include_checkpoint, recent_observations, recent_actions, inherit_harness_refs, output_contract, max_chars; recent observations are excerpts.";

type AgentDefinition = {
	validity?: MemoryValidity;
	adapter_id?: string;
	agent_id: string;
	name: string;
	version: number;
	status: "active" | "retired";
	availability?: "loaded" | "unloaded" | "suspended" | "retired";
	description: string;
	instructions: string;
	tools: string[];
	context_recipe?: SubagentContextRecipe;
	file: string;
	basis_refs: string[];
	decision_id?: string;
	expected_effect?: string;
	reconsider_when?: string;
	routing_id?: string;
	source_approval_ref?: string;
	authoring_method_ref?: string;
	recordedAt: string;
};

export type TaskSubagentAdapter = {
	adapterId: string;
	childExtension: string;
	allowedTools: string[];
	defaultTools?: string[];
	permission: string;
	definitionLabel?: string;
	delegationLabel?: string;
	autoResearch?: boolean;
	autoResearchLabel?: string;
	taskToolAllowedImplementations?: string[];
	taskToolAllowUnlistedImplementations?: boolean;
	/** Declared public result shapes used to prove model-authored program dataflow. */
	taskToolImplementationOutputSchemas?: Record<string, unknown>;
	/** Parent-runtime capture of the read-only environment boundary supplied to a child. */
	publishStateSnapshot?: () => Promise<Record<string, unknown>>;
	/** Resolve exactly one parent-selected immutable observation; never substitute live state. */
	publishSelectedStateSnapshot?: (ref: string) => Promise<Record<string, unknown>>;
	stateSnapshotTools?: string[];
	/** Publish one immutable, exact-cutoff read-only trajectory for this child launch. */
	publishTrajectorySnapshot?: () => Promise<{ ref: string }>;
	trajectorySnapshotTools?: string[];
};

type AutoResearchContextWindow = {
	include_checkpoint?: boolean;
	recent_observations?: number;
	recent_actions?: number;
	context_refs?: string[];
	max_chars?: number;
};

type ResearchSessionStatus = "active" | "pending" | "completed" | "failed" | "cancelled";
type ResearchInteractionMode = "blocking" | "non_blocking";

const RESEARCH_RECORD_FILES = new Set([
	"subagent-context-bindings.jsonl",
	"auto-research-sessions.jsonl", "auto-research-runs.jsonl", "auto-research-reports.jsonl",
	"auto-research-plans.jsonl", "auto-research-handoffs.jsonl",
	"parent-authoring-handoffs.jsonl",
	"auto-research-agenda.jsonl",
	"task-method-lifecycle.jsonl",
	"effect-assessments.jsonl",
	"auto-research-opportunities.jsonl",
	"auto-research-harness-routes.jsonl", "auto-research-harness-route-receipts.jsonl",
	"subagent-progress.jsonl", "execution-observations.jsonl", "task-memory.jsonl", "task-skills.jsonl",
	"task-tools.jsonl", "task-subagents.jsonl", "task-system-prompt.jsonl",
	"task-harness-assemblies.jsonl",
]);

function readResearchRecords(root: string, filename: string): Record<string, any>[] {
	if (!RESEARCH_RECORD_FILES.has(filename)) throw new Error(`research runtime cannot read ${filename}`);
	const path = join(root, filename);
	if (!existsSync(path)) return [];
	const records = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
		} catch { return []; }
	});
	assertTaskRecordsScope(ensureTaskScope(root), records, filename);
	return records;
}

function inferResearchLineRef(root: string, params: Record<string, any>): string | undefined {
	if (typeof params.research_line_ref === "string" && params.research_line_ref.trim()) {
		return params.research_line_ref.trim();
	}
	// Exact, unique, existing identifiers are explicit selection, not semantic
	// inference from prose. Never invent a line or merge distinct identifiers.
	const mentionedLines = [...new Set(String(params.question ?? "").match(/\bresearch_line:[A-Za-z0-9_.-]+@v[1-9]\d*\b/g) ?? [])];
	const knownLines = new Set([...readResearchRecords(root, "auto-research-reports.jsonl"),
		...readResearchRecords(root, "auto-research-runs.jsonl")].map(row => row.research_line_ref));
	if (mentionedLines.length === 1 && knownLines.has(mentionedLines[0])) return mentionedLines[0];
	const explicitRefs = [
		...(Array.isArray(params.resource_refs) ? params.resource_refs : []),
		...(Array.isArray(params.evidence_refs) ? params.evidence_refs : []),
	];
	const mentionedRefs = String(params.question ?? "")
		.match(/\b(?:research_report|research_run):[A-Za-z0-9_.-]+@v\d+\b/g) ?? [];
	const selected = [...new Set([...explicitRefs, ...mentionedRefs].map(String)
		.filter((ref) => /^(research_report|research_run):[^@]+@v\d+$/.test(ref)))];
	if (selected.length !== 1) return undefined;
	const parsed = /^(research_report|research_run):([^@]+)@v\d+$/.exec(selected[0]);
	if (!parsed) return undefined;
	const [, kind, runId] = parsed;
	const records = kind === "research_report"
		? readResearchRecords(root, "auto-research-reports.jsonl")
		: readResearchRecords(root, "auto-research-runs.jsonl");
	const match = records.filter((record) => String(record.run_id ?? "") === runId).at(-1);
	const lineRef = match?.research_line_ref;
	return typeof lineRef === "string" && lineRef.trim() ? lineRef.trim() : undefined;
}

function researchSessionReference(reference: unknown): { sessionId: string; version?: number } {
	const value = String(reference ?? "").trim();
	const match = value.match(/^(?:research_session:)?([^@]+?)(?:@v([1-9]\d*))?$/);
	return match ? { sessionId: match[1], ...(match[2] ? { version: Number(match[2]) } : {}) } : { sessionId: "" };
}

function researchSessionId(reference: unknown): string {
	return researchSessionReference(reference).sessionId;
}

function latestResearchSession(root: string, sessionId: string): Record<string, any> | undefined {
	return readResearchRecords(root, "auto-research-sessions.jsonl")
		.filter((item) => item.session_id === sessionId)
		.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
}

function latestAutoResearchAgenda(root: string, researchLineRef?: string): Record<string, any> | undefined {
	return readResearchRecords(root, "auto-research-agenda.jsonl")
		.filter(item => !researchLineRef || item.research_line_ref === researchLineRef).at(-1);
}

function currentAutoResearchAgendas(root: string): Record<string, any>[] {
	const byLine = new Map<string, Record<string, any>>();
	for (const row of readResearchRecords(root, "auto-research-agenda.jsonl"))
		byLine.set(String(row.research_line_ref ?? row.agenda_id), row);
	return [...byLine.values()];
}

/** A topic is durable; each invocation/session is only one bounded worker run. */
function researchTopicIndex(root: string, offset = 0, limit = 8, excludeLine?: string): Record<string, any> {
	const agendas = currentAutoResearchAgendas(root);
	const sessions = latestControlRecords(readResearchRecords(root, "auto-research-sessions.jsonl"), "session_id");
	const byLine = new Map<string, Record<string, any>>();
	for (const agenda of agendas) {
		const line = String(agenda.research_line_ref ?? "");
		if (line && line !== excludeLine) byLine.set(line, { line, agenda, sessions: [] });
	}
	for (const session of sessions) {
		const line = String(session.research_line_ref ?? "");
		if (!line || line === excludeLine) continue;
		if (!byLine.has(line)) byLine.set(line, { line, agenda: null, sessions: [] });
		byLine.get(line)!.sessions.push(session);
	}
	const all = [...byLine.values()].sort((a, b) => String(b.agenda?.recordedAt ?? b.sessions.at(-1)?.recordedAt ?? "")
		.localeCompare(String(a.agenda?.recordedAt ?? a.sessions.at(-1)?.recordedAt ?? "")));
	const topics = all.slice(offset, offset + limit).map((item) => {
		const agenda = item.agenda;
		const live = item.sessions.filter((session: Record<string, any>) => ["active", "pending"].includes(String(session.status)));
		const failed = item.sessions.filter((session: Record<string, any>) => session.status === "failed");
		return { topic_ref: item.line,
			agenda_ref: agenda ? `research_agenda:${agenda.agenda_id}@v${agenda.version}` : null,
			status: live.length ? "in_progress" : failed.length ? "needs_attention" : agenda?.status ?? "unreported",
			topic: String(agenda?.topic ?? "").slice(0, 100),
			question: String(agenda?.question ?? "").slice(0, 140),
			last_report_ref: agenda?.last_report_ref ?? null,
			live_session_count: live.length, failed_session_count: failed.length };
	});
	return { format: "auto-research-topic-index-v1", total: all.length, offset,
		next_offset: offset + topics.length < all.length ? offset + topics.length : null, topics };
}

function researchPlanReference(reference: unknown): { planId: string; version?: number } {
	const value = String(reference ?? "").trim();
	const match = value.match(/^(?:research_plan:)?([^@]+?)(?:@v([1-9]\d*))?$/);
	return match ? { planId: match[1], ...(match[2] ? { version: Number(match[2]) } : {}) } : { planId: "" };
}

function latestResearchPlan(root: string, planId: string): ResearchPlan | undefined {
	return readResearchRecords(root, "auto-research-plans.jsonl")
		.filter((item) => item.plan_id === planId)
		.sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] as ResearchPlan | undefined;
}

const CONTEXT_WINDOW_FILES = new Set(["task-checkpoint.json", "execution-observations.jsonl"]);

function readJsonl(root: string, filename: string): Record<string, any>[] {
	if (!CONTEXT_WINDOW_FILES.has(filename)) throw new Error(`context window cannot read ${filename}`);
	const path = join(root, filename);
	if (!existsSync(path)) return [];
	const raw = readFileSync(path, "utf8");
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return [parsed as Record<string, any>];
	} catch {}
	return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value as Record<string, any>] : [];
		} catch { return []; }
	});
}

function clipContextText(value: unknown): string {
	return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function compactContextWindow(root: string, requested?: AutoResearchContextWindow): Record<string, unknown> | undefined {
	if (!requested) return undefined;
	const maxChars = Number(requested.max_chars ?? 0);
	const observationCount = Math.max(0, Number(requested.recent_observations ?? 0));
	const actionCount = Math.max(0, Number(requested.recent_actions ?? 0));
	const result: Record<string, any> = {
		format: "parent-selected-context-window-v1",
		max_chars: maxChars,
		context_refs: [...new Set((requested.context_refs ?? []).map(String))],
	};
	if (requested.include_checkpoint) {
		const checkpoint = readCurrentTaskCheckpoint(root);
		const selected: Record<string, unknown> = {};
		for (const key of ["revision", "harness_started", "latest_environment", "task_goal", "success_conditions", "task_constraints", "planning_gap", "strategy_alternatives", "current_strategy", "current_subgoal", "hypothesis", "next_step", "working_summary", "summary_basis_refs", "decision_refs", "decision_capsule", "pending_operations"]) {
			if (checkpoint[key] !== undefined && !(checkpoint.reasoning_state?.stale_fields ?? []).includes(key)) selected[key] = checkpoint[key];
		}
		if (checkpoint.reasoning_state) selected.reasoning_state = checkpoint.reasoning_state;
		if (actionCount > 0) selected.recent_actions = Array.isArray(checkpoint.recent_actions)
			? checkpoint.recent_actions.slice(-actionCount) : [];
		result.checkpoint = selected;
	}
	if (observationCount > 0) {
		result.recent_observations = readJsonl(root, "execution-observations.jsonl").slice(-observationCount).map((record) => {
			const excerpt = clipContextText(record.result_text ?? record.result ?? record.result_excerpt);
			return {
			observation_id: record.observation_id ?? record.event_id,
			tool_name: record.tool_name ?? record.tool,
			is_error: Boolean(record.is_error),
			result_excerpt: excerpt,
			result_excerpt_chars: excerpt.length,
			result_excerpt_offset: 0,
		};
		});
	}
	// max_chars is a caller-selected provider projection budget, not a limit on
	// the canonical observation. Fit only the inlined excerpts and expose the
	// omitted range so the child can page the exact observation through the
	// read-only resource surface. Never mutate or truncate the source artifact.
	if (Number.isFinite(maxChars) && maxChars > 0) {
		const observations = (result.recent_observations ?? []) as Array<Record<string, any>>;
		const originalChars = observations.reduce((sum, item) => sum + Number(item.result_excerpt_chars ?? 0), 0);
		const projection: Record<string, unknown> = {
			format: "lossless-context-projection-v1",
			requested_max_chars: maxChars,
			serialized_chars: 0,
			truncated: false,
			canonical_source: "execution-observations.jsonl",
			page_with: "task_resource or adapter read-only observation surface",
		};
		result.projection = projection;
		let serialized = JSON.stringify(result);
		while (true) {
			// Account for the projection metadata itself.  A projection that fits
			// before adding this record would otherwise exceed the caller's
			// provider budget by the size of the metadata.
			const measured = JSON.stringify(result);
			projection.serialized_chars = measured.length;
			const finalMeasurement = JSON.stringify(result);
			if (finalMeasurement.length <= maxChars) {
				serialized = finalMeasurement;
				break;
			}
			const candidate = observations
				.filter((item) => String(item.result_excerpt ?? "").length > 0)
				.sort((a, b) => String(b.result_excerpt).length - String(a.result_excerpt).length)[0];
			if (!candidate) {
				serialized = measured;
				break;
			}
			const current = String(candidate.result_excerpt);
			const nextLength = Math.max(0, Math.floor(current.length * 0.7));
			candidate.result_excerpt = current.slice(0, nextLength);
			candidate.result_excerpt_truncated = nextLength < current.length;
			candidate.next_offset = nextLength;
			serialized = JSON.stringify(result);
		}
		const projectedChars = observations.reduce((sum, item) => sum + String(item.result_excerpt ?? "").length, 0);
		// Keep the diagnostic field truthful even when the value's digit count
		// changed during the final measurement.
		projection.serialized_chars = JSON.stringify(result).length;
		projection.truncated = projectedChars < originalChars || serialized.length > maxChars;
	}
	return result;
}

function fitPromptContextWindow(value: Record<string, unknown>, maxChars: number): Record<string, unknown> {
	const projected = JSON.parse(JSON.stringify(value)) as Record<string, any>;
	delete projected.checkpoint;
	const projection = projected.projection && typeof projected.projection === "object"
		? projected.projection as Record<string, any>
		: (projected.projection = { format: "lossless-context-projection-v1" });
	while (JSON.stringify(projected).length > maxChars) {
		const observations = Array.isArray(projected.recent_observations) ? projected.recent_observations : [];
		const candidate = observations
			.filter((item: Record<string, any>) => String(item.result_excerpt ?? "").length > 0)
			.sort((left: Record<string, any>, right: Record<string, any>) =>
				String(right.result_excerpt ?? "").length - String(left.result_excerpt ?? "").length)[0];
		if (candidate) {
			const current = String(candidate.result_excerpt);
			const nextLength = Math.max(0, Math.floor(current.length * 0.65));
			candidate.result_excerpt = current.slice(0, nextLength);
			candidate.result_excerpt_truncated = true;
			candidate.next_offset = nextLength;
			projection.truncated = true;
			projection.retrieve_on_demand = true;
			continue;
		}
		if (observations.length) {
			projected.recent_observations = [];
			projection.truncated = true;
			projection.retrieve_on_demand = true;
			continue;
		}
		// Exact observations and resources are separately granted by reference.
		// If optional parent metadata is still too large, retain only locators
		// instead of rejecting an otherwise valid research request.
		const minimal: Record<string, unknown> = {
			format: String(projected.format ?? "parent-selected-context-window-v1"),
			context_refs: Array.isArray(projected.context_refs) ? projected.context_refs : [],
			projection: { format:"reference-only-context-v1", truncated:true,
				retrieve_on_demand:true, omitted:"optional_parent_metadata" },
		};
		while (JSON.stringify(minimal).length > maxChars && (minimal.context_refs as unknown[]).length) {
			(minimal.context_refs as unknown[]).pop();
		}
		if (JSON.stringify(minimal).length > maxChars) throw new Error("child input budget is too small for evidence references");
		return minimal;
	}
	projection.serialized_chars = JSON.stringify(projected).length;
	return projected;
}

async function withPublishedStateSnapshot(
	adapter: TaskSubagentAdapter,
	contextWindow?: Record<string, unknown>,
	tools: string[] = [],
	selectedRefs: string[] = [],
): Promise<Record<string, unknown> | undefined> {
	const sceneRefs = [...new Set(selectedRefs.map(ref => String(ref).trim())
		.filter(ref => ref.startsWith("observation_snapshot:")))];
	const selectedRef = adapter.publishSelectedStateSnapshot && sceneRefs.length === 1 ? sceneRefs[0] : undefined;
	const snapshotTools = new Set(adapter.stateSnapshotTools ?? []);
	const trajectoryTools = new Set(adapter.trajectorySnapshotTools ?? []);
	const needsState = !!selectedRef || (!!adapter.publishStateSnapshot && tools.some((tool) => snapshotTools.has(tool)));
	const needsTrajectory = !!adapter.publishTrajectorySnapshot && tools.some((tool) => trajectoryTools.has(tool));
	if (!needsState && !needsTrajectory) return contextWindow;
	const base = contextWindow ?? { format: "parent-selected-context-window-v1", context_refs: [] };
	if (needsState) {
		const snapshot = selectedRef
			? await adapter.publishSelectedStateSnapshot!(selectedRef)
			: await adapter.publishStateSnapshot!();
		// Transport the snapshot out-of-band. It must reach the child process but
		// must not be serialized into the child prompt/workset.
		Object.defineProperty(base, "__publishedStateSnapshot", {
			value: snapshot, enumerable: false, configurable: false, writable: false,
		});
		if (selectedRef) Object.defineProperty(base, "__publishedStateSnapshotRef", {
			value: selectedRef, enumerable: false, configurable: false, writable: false,
		});
	}
	if (needsTrajectory) {
		const snapshot = await adapter.publishTrajectorySnapshot!();
		Object.defineProperty(base, "__publishedTrajectoryRef", {
			value: snapshot.ref, enumerable: false, configurable: false, writable: false,
		});
	}
	return base;
}

function safeName(name: string): void {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.includes("--")) {
		throw new Error("agent name must use lowercase letters, digits, or single hyphens");
	}
}

function textOf(message: Record<string, any>): string {
	return Array.isArray(message.content)
		? message.content.map((item: any) => item?.type === "text" ? String(item.text ?? "") : "").filter(Boolean).join("\n")
		: "";
}

function parseAutoResearchReport(text: string): Record<string, any> {
	const candidates = [text.trim(), text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? ""];
	for (const candidate of candidates) {
		try {
			const value = JSON.parse(candidate);
			if (value && typeof value === "object" && !Array.isArray(value)) return value;
		} catch {}
	}
	return {
		format: "auto-research-report-v1",
		status: "unstructured_report",
		conclusion: text,
		evidence_refs: [], alternatives: [], method_candidates: [], limitations: ["Child did not return valid JSON; inspect the full report."],
	};
}

function selectedEvidence(root: string, evidenceRefs: string[]): Record<string, unknown>[] {
	const path = join(root, "execution-observations.jsonl");
	if (!existsSync(path) || !evidenceRefs.length) return [];
	const selected = new Set(evidenceRefs);
	const latest = new Map<string, Record<string, any>>();
	for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			const record = JSON.parse(line) as Record<string, any>;
			const id = String(record.observation_id ?? record.event_id ?? "");
			if (selected.has(id)) latest.set(id, record);
		} catch {}
	}
	return evidenceRefs.flatMap((id) => {
		const record = latest.get(id);
		if (!record) return [];
		const result = String(record.result_text ?? record.result ?? "");
		return [{
			observation_id: id,
			tool_name: record.tool_name,
			is_error: Boolean(record.is_error),
			result_excerpt: result,
		}];
	});
}

function selectedResources(root: string, resourceRefs: string[]): Record<string, unknown>[] {
	if (!resourceRefs.length) return [];
	const files: Record<string, string> = {
		memory: "task-memory.jsonl",
		skill: "task-skills.jsonl",
		tool: "task-tools.jsonl",
		subagent: "task-subagents.jsonl",
		finding: "research-resources.jsonl",
	};
	const records = new Map<string, Record<string, any>>();
	for (const [kind, filename] of Object.entries(files)) {
		const path = join(root, filename);
		if (!existsSync(path)) continue;
		for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
			try {
				const record = JSON.parse(line) as Record<string, any>;
				const name = String(record.key ?? record.name ?? record.finding_id ?? "");
				if (name) records.set(`${kind}:${name}@v${Number(record.version)}`, { kind, ...record });
			} catch {}
		}
	}
	return resourceRefs.map((ref) => {
		const normalized = String(ref).trim();
		const match = normalized.match(/^(memory|skill|tool|subagent|finding):([^@]+)@v(\d+)$/);
		if (!match) throw new Error(`resource_refs must use kind:name@vN: ${normalized}`);
		const resource = records.get(`${match[1]}:${match[2]}@v${Number(match[3])}`);
		if (!resource) throw new Error(`unknown task-local resource reference: ${normalized}`);
		return { resource_ref: normalized, ...resource };
	});
}

function normalizeEvidenceRef(root: string, supplied: string): {
	ref: string; metadata: Record<string, unknown>;
} {
	const value = String(supplied).trim();
	const exact = /^[a-z_]+:[^@]+@v[1-9]\d*$/.test(value)
		? value : `observation:${value}@v1`;
	const kind = exact.split(":", 1)[0];
	const record = resolveTaskResource(root, exact);
	return { ref: exact, metadata: { ...resourceMetadata(kind, record), supplied_ref: value } };
}

/** Normalize parent-selected context references before handing them to a child.
 * Context windows commonly carry bare observation IDs for readability, while
 * the child resource reader is deliberately version-addressed.  Convert only
 * that shorthand; preserve exact refs byte-for-byte so approval/hash and CAS
 * provenance remain stable.
 */
function normalizeChildResourceRef(supplied: string): string {
	const value = String(supplied).trim();
	if (/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(value)) return value;
	return `observation:${value}@v1`;
}

function processErrorDetails(error: unknown): Record<string, unknown> {
	if (!error || typeof error !== "object") return { message: String(error) };
	const value = error as Record<string, unknown>;
	return {
		message: String(value.message ?? error),
		code: value.code ?? null,
		errno: value.errno ?? null,
		syscall: value.syscall ?? null,
		path: value.path ?? null,
		spawnargs: Array.isArray(value.spawnargs) ? value.spawnargs : null,
	};
}

/**
 * Start a child through the runner-owned loopback broker.  Some managed
 * Windows runtimes deny nested CreateProcess calls from the Pi Node process
 * (EPERM), while the Python ARC runner is permitted to create the same child.
 * The broker preserves the child stdout/stderr/close surface used below.
 */
function brokerChild(brokerUrl: string, payload: Record<string, unknown>): any {
	const child: any = new EventEmitter();
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.exitCode = null;
	let request: any;
	let closed = false;
	const endpoint = new URL("/spawn", brokerUrl);
	const jobId = String(payload.job_id ?? "");
	const body = JSON.stringify(payload);
	const fail = (error: Error) => {
		if (closed) return;
		child.emit("error", error);
	};
	request = httpRequest(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
	}, (response) => {
		let pending = "";
		response.setEncoding("utf8");
		response.on("data", (chunk: string) => {
			pending += chunk;
			while (true) {
				const newline = pending.indexOf("\n");
				if (newline < 0) break;
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (!line.trim()) continue;
				let envelope: Record<string, any>;
				try { envelope = JSON.parse(line); } catch { continue; }
				if (response.statusCode && response.statusCode >= 400) {
					fail(new Error(String(envelope.error ?? `subagent broker HTTP ${response.statusCode}`)));
					continue;
				}
				if (envelope.event === "started") {
					child.pid = envelope.pid ?? null;
				} else if (envelope.event === "stdout") {
					child.stdout.emit("data", String(envelope.data ?? ""));
				} else if (envelope.event === "stderr") {
					child.stderr.emit("data", String(envelope.data ?? ""));
				} else if (envelope.event === "exit") {
					closed = true;
					child.exitCode = envelope.code == null ? null : Number(envelope.code);
					child.emit("close", child.exitCode);
				}
			}
		});
		response.on("end", () => {
			if (!closed && !response.statusCode?.toString().startsWith("2")) {
				fail(new Error(`subagent broker HTTP ${response.statusCode ?? "unknown"}`));
			}
		});
		response.on("error", (error) => fail(error));
	});
	request.on("error", (error: Error) => fail(error));
	request.write(body);
	request.end();
	child.kill = () => {
		const cancel = httpRequest(new URL("/cancel", brokerUrl), {
			method: "POST",
			headers: { "content-type": "application/json", "content-length": Buffer.byteLength(JSON.stringify({ job_id: jobId })) },
		}, () => undefined);
		cancel.on("error", () => undefined);
		cancel.write(JSON.stringify({ job_id: jobId }));
		cancel.end();
	};
	return child;
}

function brokerJsonRequest(brokerUrl: string, endpoint: string, payload: Record<string, unknown>): Promise<Record<string, any>> {
	return new Promise((resolvePromise, rejectPromise) => {
		const body = JSON.stringify(payload);
		const request = httpRequest(new URL(endpoint, brokerUrl), {
			method: "POST",
			headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
		}, (response) => {
			let text = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => { text += chunk; });
			response.on("end", () => {
				let value: Record<string, any> = {};
				try { value = JSON.parse(text || "{}"); } catch {}
				if ((response.statusCode ?? 500) >= 400) rejectPromise(new Error(String(value.error ?? `subagent broker HTTP ${response.statusCode}`)));
				else resolvePromise(value);
			});
		});
		request.on("error", rejectPromise);
		request.write(body);
		request.end();
	});
}

function runChildPi(
	root: string,
	definition: AgentDefinition,
	adapter: TaskSubagentAdapter,
	task: string | Record<string, unknown>,
	evidenceRefs: string[],
	resourceRefs: string[],
	signal: AbortSignal | undefined,
	contextWindow?: Record<string, unknown>,
	researchProtocol = false,
	researchRunId?: string,
	researchSessionId?: string,
	progressId?: string,
	nativeSessionId?: string,
	researchScope = "unspecified",
	researchInteractionMode: "blocking" | "non_blocking" = "blocking",
	detached = false,
	additionalResourceGrants: string[] = [],
	arcActionLeaseToken?: string,
): Promise<Record<string, unknown>> {
	const cli = process.env.PI_AUTORESEARCH_PI_CLI;
	// A subagent is another session of the same configured agent runtime. Its
	// role, tools and evidence differ, while provider/model settings are inherited.
	const provider = process.env.PI_AUTORESEARCH_PROVIDER;
	const model = process.env.PI_AUTORESEARCH_MODEL;
	if (!cli || !provider || !model) throw new Error("subagent Pi CLI, provider, or model is not configured");
	const childNativeSessionId = nativeSessionId ?? randomUUID();
	const args = [
		cli,
		"--mode", "json", "-p",
		"--provider", provider,
		"--model", model,
		// A provider output-length boundary is a continuation of this child,
		// not a new child with a prose checkpoint.  Persist the native Pi
		// transcript for audit/retrieval. Provider serialization may discard
		// thinking-only messages, so semantic recovery uses saved checkpoints.
		"--session-dir", join(root, ".task-child-sessions"),
		"--session-id", childNativeSessionId,
		"--no-extensions", "--no-skills", "--no-prompt-templates",
		"--no-context-files", "--no-builtin-tools",
		// Keep the child surface deterministic even when a provider/CLI build
		// re-enables its default filesystem tools after an extension registers a
		// tool.  Auto-Research is read-only and must never receive a writable
		// host tool as a side effect of a later turn.
		"--exclude-tools", "read,bash,edit,write,grep,find,ls",
		"--extension", resolve(adapter.childExtension),
	];
	// Thinking level is an explicit provider/runtime choice, not a hidden
	// Auto-Research quota. Leave the provider default untouched unless the
	// operator exposes a value (for example, `minimal` or `off`) in the task
	// environment so long analyses can be tuned without changing report
	// cardinality, body length, or evidence semantics.
	const thinking = String(process.env.PI_AUTORESEARCH_THINKING ?? "").trim();
	if (thinking) args.push("--thinking", thinking);
	const providerExtension = process.env.PI_AUTORESEARCH_PROVIDER_EXTENSION
		?? (process.env.PI_EXTERNAL_STEPS !== undefined
			? process.env.PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION
			: undefined);
	if (providerExtension) args.push("--extension", providerExtension);
	const evidence = evidenceRefs.map((ref) => normalizeEvidenceRef(root, ref));
	// Selecting recent observations is a parent access decision, not merely a
	// reference mentioned in prose. Grant exactly those canonical bodies so a
	// truncated window can be paged; do not follow checkpoint/basis references or
	// grant the rest of the archive implicitly.
	const windowObservations = Array.isArray(contextWindow?.recent_observations)
		? contextWindow.recent_observations as Array<Record<string, unknown>> : [];
	const windowObservationRefs = windowObservations
		.map(item => typeof item.observation_id === "string" ? item.observation_id : "")
		.filter(Boolean).map(normalizeChildResourceRef);
	const normalizedResourceRefs = [...new Set([...resourceRefs.map(normalizeChildResourceRef), ...windowObservationRefs])];
	const resources = normalizedResourceRefs.map((ref) => resourceMetadata(ref.split(":")[0], resolveTaskResource(root, ref)));
	// An index is a locator, not a copy of an arbitrarily large observation
	// summary. Exact granted versions remain available through task_resource.
	const childIndex = (r: Record<string, any>) => ({ resource_ref: r.resource_ref,
		version: r.version, chars: r.chars, provenance: r.provenance });
	const grantedRefs = [...new Set([
		...normalizedResourceRefs, ...resources.map((r) => r.resource_ref), ...evidence.map((item) => item.ref),
		...additionalResourceGrants,
		...(typeof contextWindow?.__publishedTrajectoryRef === "string"
			? [contextWindow.__publishedTrajectoryRef] : []),
	])];
	// Retained only for scripted compatibility fixtures that explicitly invoke
	// the retired research_approval tool. Production research children must not
	// receive component schemas, programs, or creator inputs: they return
	// findings and method metadata for the parent to author from.
	const legacyToolCreationContract = {
		memory_validity_context: memoryValidityContext(ensureTaskScope(root).taskId, readResearchRecords(root, "execution-observations.jsonl")),
		declarative_program_steps: TASK_TOOL_PROGRAM_STEP_KINDS,
		step_shapes: {
			pick: { kind: "pick", source: "input", field: "items" },
			filter: { kind: "filter", field: "enabled", equals: true },
			map: { kind: "map", fields: ["value"] },
			count: { kind: "count" },
		},
		program_shape: { steps: [
			{ kind: "pick", source: "input", field: "items" },
			{ kind: "filter", field: "enabled", equals: true },
			{ kind: "map", fields: ["value"] },
			{ kind: "count" },
		] },
		proposal_shape: { candidate_ref: "candidate-name@v1", delivery: "<complete auto-research-harness-delivery-v1 object>" },
		optional_field_rule: "Omit optional delivery fields when unused; do not send null.",
		assessment_rule: "Use method_utility only with an existing effect_assessment_ref from the granted effect ledger; use method_correctness or explanation for historical-observation judgments.",
		experiment_request_rule: "When experiment_request is present, include parent_action as a plain-language action request; suggested_next_action does not replace it.",
		allowed_implementation_refs: adapter.taskToolAllowedImplementations ?? [],
		allow_unlisted_implementations: adapter.taskToolAllowUnlistedImplementations === true,
	};
	const legacyApprovals = String(process.env.PI_SUBAGENT_STEPS ?? "").includes('"research_approval"');
	const researchEnvironment = researchProtocol ? {
		PI_AUTO_RESEARCH_SCOPE: researchScope,
		PI_AUTO_RESEARCH_INTERACTION_MODE: researchInteractionMode,
		// Scripted compatibility fixtures may still exercise the retired child
		// approval ledger. Production children receive neither it nor its former
		// component-creation contract.
		...(legacyApprovals ? {
			PI_AUTO_RESEARCH_LEGACY_APPROVALS: "1",
			PI_AUTO_RESEARCH_TOOL_CONTRACT: JSON.stringify(legacyToolCreationContract),
		} : {}),
	} : {};
	args.push("--extension", join(dirname(fileURLToPath(import.meta.url)), "pi_task_validation_child.ts"));
	const promptPrefix = researchProtocol ? "# Research task workset\n" : "# Delegated task workset\n";
	const contextMarker = "\nParent-selected context window (bounded state, not the parent transcript): ";
	// Current children receive the report schema through submit_research_report;
	// no component-creation contract is injected into their environment.
	const promptSuffix = `\n\n# Available access\nUse exposed tools under permission ${arcActionLeaseToken ? "bounded_arc_action_delegate" : adapter.permission}; retrieve only the evidence needed for the question.\n`
		+ (typeof contextWindow?.__publishedTrajectoryRef === "string"
			? `Fixed ARC trajectory cutoff: ${contextWindow.__publishedTrajectoryRef}. inspect_arc_trajectory uses this immutable evidence. For history beyond its 256-action projection limit, page this exact resource with task_resource.\n`
			: "")
		+ (researchProtocol
			? "Return findings, method candidates, planning implications, or experiment requests only; the parent owns all Harness authoring.\n" : "");
	const inputMaxChars = Math.max(1024, Math.floor(Number(
		process.env.PI_AUTORESEARCH_CHILD_INPUT_MAX_CHARS
			?? process.env.PI_AUTORESEARCH_CHILD_CONTEXT_MAX_CHARS
			?? 80_000,
	) || 80_000));
	const worksetBudget = inputMaxChars - promptPrefix.length - contextMarker.length - promptSuffix.length - 256;
	if (worksetBudget < 256) throw new Error("child provider input budget leaves no room for the required research workset");
	const researchTask = researchProtocol && typeof task === "object" ? task : {};
	const continuationAttempt = Number((researchTask.research_state as Record<string, any> | undefined)?.continuation_attempt ?? 1);
	const baseContextWindow = continuationAttempt > 1
		? { format: "parent-selected-context-continuation-v1",
			context_refs: Array.isArray(contextWindow?.context_refs) ? contextWindow.context_refs : [],
			native_session_retains_prior_context: true }
		: contextWindow ?? { format: "parent-selected-context-window-v1", context_refs: [] };
	const comparison = researchTask.cross_context_comparison as Record<string, any> | undefined;
	const comparisonCardRefs = new Set((comparison?.evidence_cards ?? [])
		.map((card: Record<string, any>) => String(card.observation_ref ?? "")).filter(Boolean));
	const comparisonSelectedRefs = Array.isArray(comparison?.selected_evidence_refs)
		? comparison!.selected_evidence_refs.map(String).filter(Boolean) : [];
	const comparisonCardsCoverSelected = comparisonSelectedRefs.length > 0
		&& comparisonSelectedRefs.every((reference: string) => comparisonCardRefs.has(reference));
	const workset = buildResearchWorkset({
		...researchTask,
		...(() => {
			const binding = readResearchRecords(root, "subagent-context-bindings.jsonl")
				.find(r => r.native_child_session_id === childNativeSessionId && r.competition_view_ref);
			if ((continuationAttempt > 1 || /:continuation-(?:[2-9]|[1-9]\d+)/.test(String(progressId ?? ""))) && binding) {
				grantedRefs.push(binding.competition_view_ref);
				return { competition_view_ref: binding.competition_view_ref };
			}
			const view = buildCompetitionView(root, new Set(grantedRefs));
			if (!view) return {};
			persistCompetitionView(root, view);
			grantedRefs.push(view.view_ref);
			appendFileSync(join(root, "subagent-context-bindings.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(root), {
				native_child_session_id: childNativeSessionId, competition_view_ref: view.view_ref,
				progress_id: progressId, recordedAt: new Date().toISOString(),
			})) + "\n");
			return { competition_view: competitionProjection(view) };
		})(),
		goal: researchProtocol ? (researchTask.goal ?? task)
			: `Role: ${definition.name}\n${definition.instructions}\nCanonical role resource: subagent:${definition.name}@v${definition.version}\nDelegated task: ${task}`,
		constraints: researchTask.constraints ?? [],
		checkpoint: (baseContextWindow as Record<string, any>).checkpoint ?? null,
		resource_refs: normalizedResourceRefs,
		evidence_refs: evidenceRefs,
		selected_context: continuationAttempt > 1 || comparisonCardsCoverSelected ? "" : JSON.stringify({
			selected_canonical_evidence_index: evidence.map((item) => childIndex(item.metadata)),
			selected_task_local_resource_index: resources.map(childIndex),
		}),
	}, worksetBudget);
	const contextBudget = inputMaxChars - promptPrefix.length - JSON.stringify(workset).length
		- contextMarker.length - promptSuffix.length;
	if (contextBudget < 64) throw new Error("child provider input budget leaves no room for parent context metadata");
	const promptContextWindow = fitPromptContextWindow(baseContextWindow, contextBudget);
	const childPrompt = `${promptPrefix}${JSON.stringify(workset)}${contextMarker}${JSON.stringify(promptContextWindow)}${promptSuffix}`;
	if (childPrompt.length > inputMaxChars) {
		throw new Error(`child provider input budget exceeded after workset projection: ${childPrompt.length} > ${inputMaxChars}`);
	}
	// Pass the prompt through Pi's @file input instead of a command-line
	// argument.  Real ARC observations can be large enough to exceed Windows'
	// CreateProcess command-line limit (WinError 206), even though the broker
	// itself is healthy.  The file is canonical task-local input, not a quota or
	// truncation boundary.
	const promptKey = String(progressId ?? researchRunId ?? `child-${Date.now()}`)
		.replace(/[^A-Za-z0-9_.-]/g, "_");
	const promptDir = join(root, ".task-child-prompts");
	mkdirSync(promptDir, { recursive: true });
	mkdirSync(join(root, ".task-child-sessions"), { recursive: true });
	const promptPath = join(promptDir, `${promptKey}.txt`);
	writeFileSync(promptPath, childPrompt, "utf8");
	appendFileSync(join(root, "auto-research-context-budgets.jsonl"), JSON.stringify({
		format: "auto-research-context-budget-v1",
		progress_id: progressId ?? null,
		research_run_id: researchRunId ?? null,
		research_session_id: researchSessionId ?? null,
		input_max_chars: inputMaxChars,
		serialized_prompt_chars: childPrompt.length,
		workset_projection: workset.projection,
		selected_resource_index_omitted_for_evidence_cards: comparisonCardsCoverSelected,
		resource_refs: normalizedResourceRefs,
		evidence_refs: evidenceRefs,
		recordedAt: new Date().toISOString(),
	}) + "\n", "utf8");
	args.push(`@${promptPath}`);
	const progressKey = String(progressId ?? researchRunId ?? `child-pid-pending`);
	const brokerUrl = String(process.env.PI_AUTORESEARCH_SUBAGENT_BROKER_URL ?? "").trim();
	const childEnv = {
		...process.env,
		// A child receives a parent-published observation boundary, never the
		// moving live ARC bridge. The snapshot is optional; task_resource remains
		// the canonical fallback when no environment frame was published.
		...(contextWindow && typeof (contextWindow as any).__publishedStateSnapshot === "object"
			? { PI_TASK_CHILD_STATE_SNAPSHOT: JSON.stringify((contextWindow as any).__publishedStateSnapshot) }
			: { PI_TASK_CHILD_STATE_SNAPSHOT: "" }),
		PI_TASK_CHILD_STATE_SNAPSHOT_REF: typeof contextWindow?.__publishedStateSnapshotRef === "string"
			? contextWindow.__publishedStateSnapshotRef : "",
		PI_EXTERNAL_STEPS: "[]",
		PI_AUTORESEARCH_VARIANT: "control",
		PI_TASK_SUBAGENT_TOOLS: JSON.stringify(arcActionLeaseToken
			? [...new Set([...definition.tools, "arc_action"])] : definition.tools),
		PI_TASK_CHILD_RESOURCE_REFS: JSON.stringify(grantedRefs),
		PI_TASK_CHILD_CONTEXT_ID: childNativeSessionId,
		PI_TASK_CHILD_CONTEXT_SCOPE: adapter.adapterId === "arc_agi_3"
			? arcActionLeaseToken ? "arc-action-delegate" : "arc-readonly-subagent" : "task-child",
		PI_TASK_CHILD_TRAJECTORY_REF: typeof contextWindow?.__publishedTrajectoryRef === "string"
			? contextWindow.__publishedTrajectoryRef : "",
		PI_TASK_CHILD_RESEARCH_PROTOCOL: researchProtocol ? "1" : "0",
		PI_AUTO_RESEARCH_OPEN_ALLOCATION: researchProtocol && researchTask.research_state?.open_allocation ? "1" : "0",
		PI_AUTO_RESEARCH_WORKER: researchProtocol && researchTask.research_state?.worker
			? JSON.stringify({ ...researchTask.research_state.worker,
				run_ids: [...researchTask.research_state.worker.run_ids, researchRunId].filter(Boolean) }) : "",
		// A blocking exact-evidence comparison has two terminal choices: submit
		// the current result, or return a bounded parent experiment request in that
		// report. Provider length is resumed by the runtime/native Pi session, so
		// exposing a manual checkpoint tool here adds protocol surface without a
		// capability. Open-ended/non-blocking research keeps the tool.
		PI_AUTO_RESEARCH_CHECKPOINT_TOOL: researchProtocol && comparisonCardsCoverSelected
			&& researchInteractionMode === "blocking" ? "0" : "1",
		...researchEnvironment,
		...(researchRunId ? { PI_AUTO_RESEARCH_RUN_ID: researchRunId } : {}),
		...(researchSessionId ? { PI_AUTO_RESEARCH_SESSION_ID: researchSessionId } : {}),
		...(process.env.PI_AUTORESEARCH_CHILD_CONTEXT_MAX_CHARS
			? { PI_AUTORESEARCH_CONTEXT_MAX_CHARS: process.env.PI_AUTORESEARCH_CHILD_CONTEXT_MAX_CHARS }
			: {}),
		PI_TASK_CHILD: "1",
	} as Record<string, string>;
	// Do not inherit the parent's live bridge credential into a read-only child.
	delete childEnv.PI_ARC_BRIDGE_URL;
	delete childEnv.PI_ARC_ACTION_TOKEN;
	delete childEnv.ARC_BRIDGE_ACTION_TOKEN;
	if (arcActionLeaseToken) {
		childEnv.PI_ARC_BRIDGE_URL = String(process.env.PI_ARC_BRIDGE_URL ?? "");
		childEnv.PI_ARC_ACTION_TOKEN = arcActionLeaseToken;
	}
	// Child-specific model routing is unsupported. Remove stale legacy variables
	// so extensions cannot accidentally reintroduce a split runtime.
	delete childEnv.PI_AUTORESEARCH_CHILD_PROVIDER;
	delete childEnv.PI_AUTORESEARCH_CHILD_MODEL;
	delete childEnv.PI_AUTORESEARCH_CHILD_MAX_OUTPUT_TOKENS;
	if (detached) {
		if (!brokerUrl) throw new Error("non-blocking Auto-Research requires the persistent subagent broker");
		const brokerDir = join(root, "task-context-cache", "auto-research-broker");
		mkdirSync(brokerDir, { recursive: true });
		return brokerJsonRequest(brokerUrl, "/enqueue", {
			job_id: progressKey, command: [process.execPath, ...args], cwd: root, env: childEnv,
			status_path: join(brokerDir, `${researchRunId}.json`),
			events_path: join(brokerDir, `${researchRunId}.events.jsonl`),
			checkpoint_path: join(root, "task-context-cache", "auto-research-checkpoints", `${researchSessionId ?? researchRunId}.json`),
			max_stagnant_continuations: Math.max(1,
				Math.floor(Number(process.env.PI_AUTORESEARCH_MAX_STAGNANT_CONTINUATIONS ?? 3) || 3)),
			continue_on_length: researchProtocol,
		});
	}
	return new Promise((resolvePromise, rejectPromise) => {
		const progressPath = join(root, "subagent-progress.jsonl");
		const progressStartedAtMs = Date.now();
		let child: any;
		try {
		child = brokerUrl ? brokerChild(brokerUrl, {
			job_id: progressKey,
			command: [process.execPath, ...args],
			cwd: root,
			env: childEnv,
		}) : spawn(process.execPath, args, {
			cwd: root,
			env: childEnv,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		} catch (error) {
			const details = processErrorDetails(error);
			rejectPromise(new Error(`subagent process creation failed: ${JSON.stringify(details)}`));
			return;
		}
		// Observation-only child liveness probe. It never steers, interrupts, or
		// caps the child; it makes a long provider turn diagnosable before the
		// parent/session deadline produces only a bare timeout code.
		// The broker may not know the PID until its first streamed envelope.
		let eventCount = 0;
		let progressSequence = 0;
		let lastProgressWriteAtMs = progressStartedAtMs;
		let lastChildEventAtMs = progressStartedAtMs;
		let progressPhase = "starting";
		let lastEventType = "spawned";
		let lastToolName: string | undefined;
		let lastToolCallId: string | undefined;
		let lastStopReason: string | undefined;
		let lastProviderError: string | undefined;
		let assistantMessageCount = 0;
		let toolStartCount = 0;
		let toolEndCount = 0;
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let reportSubmitObserved = false;
		// Ordinary delegated children are synchronous helpers, not open-ended
		// research sessions.  Bound their lifetime at the runtime boundary so a
		// provider that keeps returning toolUse cannot hold the parent ARC turn
		// forever.  Auto-Research uses its own broker/continuation policy and is
		// intentionally unaffected by these limits.
		const maxToolStartsRaw = Number(process.env.PI_AUTORESEARCH_DELEGATE_MAX_TOOL_CALLS ?? 24);
		const maxToolStarts = Number.isFinite(maxToolStartsRaw) && maxToolStartsRaw > 0
			? Math.floor(maxToolStartsRaw) : 24;
		const maxRuntimeRaw = Number(process.env.PI_AUTORESEARCH_DELEGATE_MAX_RUNTIME_MS ?? 120_000);
		const maxRuntimeMs = Number.isFinite(maxRuntimeRaw) && maxRuntimeRaw > 0
			? maxRuntimeRaw : 120_000;
		let guardReason: string | undefined;
		let guardTimer: NodeJS.Timeout | undefined;
		const appendProgress = (event: string, extra: Record<string, unknown> = {}) => {
			const now = Date.now();
			lastProgressWriteAtMs = now;
			try {
				appendFileSync(progressPath, JSON.stringify({
					format: "subagent-progress-v1",
					progress_id: progressKey,
					...(researchRunId ? { research_run_id: researchRunId } : {}),
					...(researchSessionId ? { research_session_id: researchSessionId } : {}),
					pid: child.pid ?? null,
					sequence: ++progressSequence,
					event,
					phase: progressPhase,
					last_event_type: lastEventType,
					last_tool_name: lastToolName ?? null,
					last_tool_call_id: lastToolCallId ?? null,
					last_stop_reason: lastStopReason ?? null,
					assistant_message_count: assistantMessageCount,
					tool_start_count: toolStartCount,
					tool_end_count: toolEndCount,
					event_count: eventCount,
					stdout_bytes: stdoutBytes,
					stderr_bytes: stderrBytes,
					report_submit_observed: reportSubmitObserved,
					child_alive: child.exitCode === null,
					started_at_ms: progressStartedAtMs,
					last_activity_at_ms: lastProgressWriteAtMs,
					last_child_event_at_ms: lastChildEventAtMs,
					elapsed_ms: Math.max(0, now - progressStartedAtMs),
					recordedAt: new Date(now).toISOString(),
					...extra,
				}) + "\n", "utf8");
			} catch {
				// Diagnostics must never turn a valid child result into a failure.
			}
		};
		appendProgress("spawned");
		const progressIntervalRaw = Number(process.env.PI_AUTORESEARCH_PROGRESS_INTERVAL_MS ?? 5000);
		const progressIntervalMs = Number.isFinite(progressIntervalRaw) && progressIntervalRaw > 0
			? progressIntervalRaw : 5000;
		const progressTimer = setInterval(() => appendProgress("heartbeat", {
			no_event_for_ms: Math.max(0, Date.now() - lastChildEventAtMs),
		}), progressIntervalMs);
		progressTimer.unref?.();
		let stderr = "";
		let pendingLine = "";
		let discardingOversizedLine = false;
		const assistantMessages: Record<string, any>[] = [];
		const processLine = (line: string) => {
			if (!line.trim()) return;
			eventCount += 1;
			try {
				const event = JSON.parse(line) as Record<string, any>;
				lastChildEventAtMs = Date.now();
				lastEventType = String(event.type ?? "unknown");
				if (event.type === "turn_start" || event.type === "message_start" || event.type === "agent_start") {
					progressPhase = "provider_turn_in_flight";
				} else if (event.type === "tool_execution_start") {
					progressPhase = "tool_running";
					toolStartCount += 1;
					lastToolName = String(event.toolName ?? event.tool_name ?? "unknown");
					lastToolCallId = String(event.toolCallId ?? event.tool_call_id ?? "") || undefined;
					if (!researchProtocol && toolStartCount > maxToolStarts && !guardReason) {
						guardReason = `delegate_task tool-call budget exceeded (${maxToolStarts})`;
						appendProgress("budget_exceeded", { budget: "tool_calls", limit: maxToolStarts });
						child.kill();
					}
				} else if (event.type === "tool_execution_end") {
					progressPhase = "tool_completed";
					toolEndCount += 1;
					lastToolName = String(event.toolName ?? event.tool_name ?? lastToolName ?? "unknown");
					lastToolCallId = String(event.toolCallId ?? event.tool_call_id ?? lastToolCallId ?? "") || undefined;
					if (lastToolName === "submit_research_report" && !event.isError) reportSubmitObserved = true;
				} else if (event.type === "message_end" && event.message?.role === "assistant") {
					progressPhase = "provider_turn_completed";
					assistantMessageCount += 1;
					lastStopReason = event.message.stopReason ? String(event.message.stopReason) : undefined;
					if (lastStopReason === "error") {
						lastProviderError = String(event.message.errorMessage ?? "provider returned stopReason=error");
					}
				}
				if (event.type !== "turn_start" && event.type !== "message_start" && event.type !== "agent_start"
					&& event.type !== "tool_execution_start" && event.type !== "tool_execution_end"
					&& !(event.type === "message_end" && event.message?.role === "assistant")) {
					progressPhase = "provider_event";
				}
				// Pi emits high-frequency streaming fragments (especially
				// `message_update`) while a provider turn is in flight.  They are
				// counted and reflected by the heartbeat, but are not persisted one
				// by one; doing so can grow the observation log by hundreds of MB per
				// minute without adding a new lifecycle state or tool transition.
				const streamingFragment = event.type === "message_update"
					|| event.type === "text_delta" || event.type === "thinking_delta";
				if (!streamingFragment) appendProgress("event", {
					is_error: event.isError === true,
				});
				if (event.type === "message_end" && event.message?.role === "assistant") {
					assistantMessages.push(event.message as Record<string, any>);
				}
			} catch {}
		};
		const abort = () => {
			guardReason = guardReason ?? "delegate_task aborted";
			progressPhase = "aborting";
			appendProgress("abort_requested");
			child.kill();
		};
		if (!researchProtocol) {
			guardTimer = setTimeout(() => {
				if (guardReason) return;
				guardReason = `delegate_task runtime budget exceeded (${maxRuntimeMs}ms)`;
				appendProgress("budget_exceeded", { budget: "runtime_ms", limit: maxRuntimeMs });
				child.kill();
			}, maxRuntimeMs);
			guardTimer.unref?.();
		}
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdoutBytes += Buffer.byteLength(String(chunk));
			let remaining = String(chunk);
			while (remaining.length) {
				const newline = remaining.indexOf("\n");
				const segment = newline >= 0 ? remaining.slice(0, newline) : remaining;
				if (!discardingOversizedLine) {
					pendingLine += segment;
				}
				if (newline < 0) break;
				if (discardingOversizedLine) eventCount += 1;
				else processLine(pendingLine);
				pendingLine = "";
				discardingOversizedLine = false;
				remaining = remaining.slice(newline + 1);
			}
		});
		child.stderr.on("data", (chunk) => { const text = String(chunk); stderrBytes += Buffer.byteLength(text); stderr += text; });
		child.on("error", (error) => {
			const details = processErrorDetails(error);
			progressPhase = "failed";
			child.exitCode = -1;
			appendProgress("process_error", { error: details.message, error_details: details });
			clearInterval(progressTimer);
			rejectPromise(new Error(`subagent process error: ${JSON.stringify(details)}`));
		});
		child.on("close", (code) => {
			clearInterval(progressTimer);
			if (guardTimer) clearTimeout(guardTimer);
			signal?.removeEventListener("abort", abort);
			if (pendingLine && !discardingOversizedLine) processLine(pendingLine);
			else if (discardingOversizedLine) eventCount += 1;
			progressPhase = signal?.aborted ? "aborted" : code === 0 ? "completed" : "failed";
			appendProgress("process_closed", {
				child_exit_code: code,
				final_stop_reason: lastStopReason ?? null,
			});
			if (signal?.aborted) return rejectPromise(new Error("subagent aborted"));
			if (guardReason && guardReason !== "delegate_task aborted") {
				return rejectPromise(new Error(`${guardReason}; retry with a smaller bounded task (for large ARC frames: ask for one region, one statistic, or one hypothesis at a time; do not request a full-frame exhaustive report)`));
			}
			const usage = assistantMessages.reduce((total, message) => ({
				input: total.input + Number(message.usage?.input ?? 0),
				output: total.output + Number(message.usage?.output ?? 0),
				cacheRead: total.cacheRead + Number(message.usage?.cacheRead ?? 0),
				cacheWrite: total.cacheWrite + Number(message.usage?.cacheWrite ?? 0),
				cost: {
					input: total.cost.input + Number(message.usage?.cost?.input ?? 0),
					output: total.cost.output + Number(message.usage?.cost?.output ?? 0),
					cacheRead: total.cost.cacheRead + Number(message.usage?.cost?.cacheRead ?? 0),
					cacheWrite: total.cost.cacheWrite + Number(message.usage?.cost?.cacheWrite ?? 0),
					total: total.cost.total + Number(message.usage?.cost?.total ?? 0),
				},
			}), {
				input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			});
			const submittedPath = researchRunId
				? join(root, "task-context-cache", "auto-research-child-results", `${researchRunId}.json`) : "";
			const submittedAuditPath = researchRunId
				? join(root, "task-context-cache", "auto-research-child-results", `${researchRunId}.audit.json`) : "";
			const checkpointPath = researchRunId
				? join(root, "task-context-cache", "auto-research-checkpoints", `${researchSessionId ?? researchRunId}.json`) : "";
			if (code === 0 && submittedPath && existsSync(submittedPath)) {
				try {
					const submitted = JSON.parse(readFileSync(submittedPath, "utf8"));
					let evidenceAudit: Record<string, unknown> | null = null;
					if (submittedAuditPath && existsSync(submittedAuditPath)) {
						const audit = JSON.parse(readFileSync(submittedAuditPath, "utf8"));
						if (audit && typeof audit === "object" && !Array.isArray(audit)) evidenceAudit = audit;
					}
					// A provider may return a structured report as its final message
					// without running the child protocol's submit tool (for example a
					// resumed/legacy child). Treat the selected inherited resources as
					// unverified rather than silently recording a complete read audit.
					if (!evidenceAudit) {
						const selectedRefs = [...new Set([...resourceRefs, ...evidenceRefs]
							.filter((ref) => /^(memory|skill|tool|subagent|finding|context):/.test(String(ref)))
							.filter((ref) => !/^subagent:(auto-research|ephemeral-auto-research)@v\d+$/.test(String(ref))))];
						evidenceAudit = {
							format: "research-evidence-audit-v1",
							status: selectedRefs.length ? "partial" : "no_selected_refs",
							required_refs: selectedRefs,
							complete_refs: [],
							incomplete_refs: selectedRefs,
							read_count: 0,
							repeated_read_count: 0,
							review_checkpoint_count: 0,
							threshold_reached: false,
						};
					}
					return resolvePromise({
						text: JSON.stringify(submitted), stop_reason: "submitted_report", usage,
						provider, model, event_count: eventCount, progress_ref: "subagent-progress.jsonl", progress_id: progressKey,
						resolved_evidence_refs: evidenceRefs,
						adapter_id: adapter.adapterId, evidence_audit: evidenceAudit,
					});
				} catch (error) {
					return rejectPromise(new Error(`submitted research report is unreadable: ${String(error)}`));
				}
			}
			const finalMessage = assistantMessages.at(-1);
			// A successfully persisted report above wins even if the provider emits
			// a later transport error.  Without a report, provider failure is a hard
			// boundary and must not be disguised as a paused/checkpointed run merely
			// because an older checkpoint exists.
			if (code === 0 && finalMessage?.stopReason === "error") {
				return rejectPromise(new Error(`subagent provider error: ${lastProviderError ?? finalMessage.errorMessage ?? "unknown provider error"}`));
			}
			let existingCheckpoint: Record<string, any> | undefined;
			if (checkpointPath && existsSync(checkpointPath)) {
				try {
					existingCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
				} catch (error) {
					return rejectPromise(new Error(`research checkpoint is unreadable: ${String(error)}`));
				}
				if (existingCheckpoint?.status === "pending") return resolvePromise({
					text: "", stop_reason: "paused", checkpoint: existingCheckpoint, child_exit_code: code, usage, provider, model,
					event_count: eventCount, progress_ref: "subagent-progress.jsonl", progress_id: progressKey,
					resolved_evidence_refs: evidenceRefs, adapter_id: adapter.adapterId,
				});
			}
			// A research child may produce useful partial analysis but hit its own
			// output boundary before submitting the structured report. Preserve that
			// result in a resumable session checkpoint. Do not throw a tool error
			// that encourages the parent to restart the same expensive research loop.
			if (code === 0 && researchRunId && finalMessage?.stopReason === "length") {
				const partialOutput = textOf(finalMessage);
				const checkpoint = {
					...(existingCheckpoint ?? {}),
					format: "auto-research-checkpoint-v1",
					session_id: researchSessionId ?? researchRunId,
					status: "active",
					cursor: existingCheckpoint?.cursor || "provider-output-length",
					evidence_refs: evidenceRefs,
					selected_resource_refs: resourceRefs,
					unresolved_questions: existingCheckpoint?.unresolved_questions ?? ["The provider stopped at its output boundary before the structured report was submitted."],
					draft_findings: existingCheckpoint?.draft_findings ?? [],
					next_step: existingCheckpoint?.next_step || "Use saved findings and evidence to submit the supported answer, including unresolved parts; do not reconstruct missing private reasoning.",
					pause_reason: "provider_stop_reason_length",
					resume_condition: "automatic continuation by the Auto-Research runtime in this research_session",
					partial_output: partialOutput || existingCheckpoint?.partial_output || "",
					evidence_read_count: existingCheckpoint?.evidence_read_count ?? 0,
					evidence_audit: existingCheckpoint?.evidence_audit ?? {
						format: "research-evidence-audit-v1",
						status: [...new Set([...resourceRefs, ...evidenceRefs])].length ? "partial" : "no_selected_refs",
						required_refs: [...new Set([...resourceRefs, ...evidenceRefs])],
						complete_refs: [],
						incomplete_refs: [...new Set([...resourceRefs, ...evidenceRefs])],
						read_count: 0, repeated_read_count: 0, review_checkpoint_count: 0, threshold_reached: false,
					},
					recordedAt: new Date().toISOString(),
				};
				const childCheckpointPath = join(root, "task-context-cache", "auto-research-checkpoints", `${researchSessionId ?? researchRunId}.json`);
				mkdirSync(dirname(childCheckpointPath), { recursive: true });
				const temporaryCheckpoint = `${childCheckpointPath}.tmp`;
				writeFileSync(temporaryCheckpoint, JSON.stringify(checkpoint) + "\n", "utf8");
				renameSync(temporaryCheckpoint, childCheckpointPath);
				return resolvePromise({
					text: partialOutput, stop_reason: "length", checkpoint, usage,
					provider, model, event_count: eventCount, progress_ref: "subagent-progress.jsonl", progress_id: progressKey,
					resolved_evidence_refs: evidenceRefs,
					adapter_id: adapter.adapterId,
				});
			}
			// Ordinary delegated agents use the same native-session continuation
			// boundary as Auto-Research.  Returning a typed length result lets the
			// owning delegate_task keep one logical invocation instead of marking a
			// healthy provider boundary as a failed subagent.
			if (code === 0 && !researchRunId && finalMessage?.stopReason === "length") {
				return resolvePromise({
					text: textOf(finalMessage), stop_reason: "length", usage,
					provider, model, event_count: eventCount,
					progress_ref: "subagent-progress.jsonl", progress_id: progressKey,
					resolved_evidence_refs: evidenceRefs, adapter_id: adapter.adapterId,
				});
			}
			if (code === 0 && researchRunId && existingCheckpoint?.status === "active") {
				return resolvePromise({
					text: finalMessage ? textOf(finalMessage) : "", stop_reason: "checkpointed",
					checkpoint: existingCheckpoint, usage, provider, model, event_count: eventCount,
					progress_ref: "subagent-progress.jsonl", progress_id: progressKey,
					resolved_evidence_refs: evidenceRefs, adapter_id: adapter.adapterId,
				});
			}
			if (code !== 0 || !finalMessage || finalMessage.stopReason !== "stop") {
				const reason = finalMessage?.stopReason
					? `final stop reason ${String(finalMessage.stopReason)}`
					: stderr || "no final assistant message";
				return rejectPromise(new Error(`subagent failed with code ${String(code)}: ${reason}`));
			}
			resolvePromise({
				text: textOf(finalMessage),
				stop_reason: finalMessage.stopReason,
				usage,
				provider,
				model,
				event_count: eventCount,
				progress_ref: "subagent-progress.jsonl",
				progress_id: progressKey,
				resolved_evidence_refs: evidenceRefs,
				adapter_id: adapter.adapterId,
			});
		});
	});
}

export function installTaskLocalSubagents(
	pi: ExtensionAPI,
	enabled: boolean,
	adapter: TaskSubagentAdapter,
	resolveBasisRefs: (references: string[]) => string[] = (references) => references,
): void {
	if (!enabled) return;
	installTaskResultSemantics(pi);
	if (!adapter.adapterId.trim()) throw new Error("task-subagent adapterId is required");
	if (!adapter.permission.trim()) throw new Error("task-subagent permission is required");
	if (!adapter.allowedTools.length) throw new Error("task-subagent adapter requires at least one allowed tool");
	const allowedTools = new Set(adapter.allowedTools);
	const defaultTools = adapter.defaultTools ?? adapter.allowedTools;
	if (!defaultTools.length || defaultTools.some((name) => !allowedTools.has(name))) {
		throw new Error("task-subagent default tools must be a non-empty subset of allowed tools");
	}
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	const taskScope = ensureTaskScope(root);
	const readBaselineMethodReceipts = () => {
		const path = join(root, "task-baseline-method-reads.jsonl");
		if (!existsSync(path)) return [] as Record<string, any>[];
		return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try { const value = JSON.parse(line); return value && typeof value === "object" && !Array.isArray(value) ? [value] : []; }
			catch { return []; }
		});
	};
	const requireResearchOrchestrationRead = (params: Record<string, any>) => {
		const catalogEntry = baselineMethodCatalog().find((item) => item.name === "research-orchestration");
		const expected = catalogEntry?.method_ref ?? "";
		const supplied = String(params.authoring_method_ref ?? expected).trim();
		if (!supplied) throw new Error("authoring_method_ref is required for Auto-Research; first call task_harness(action=read_method, method_name=research-orchestration) and pass its method_ref");
		if (supplied !== expected) throw new Error("authoring_method_ref does not match the current research-orchestration baseline; read it again before starting Auto-Research");
		const reads = readBaselineMethodReceipts();
		if (!reads.some((row) => row.name === "research-orchestration" && row.method_ref === supplied && row.sha256 === catalogEntry?.sha256 && row.actor !== "child")) {
			throw new Error("research-orchestration was not read in this run; call task_harness(action=read_method, method_name=research-orchestration) before starting Auto-Research");
		}
		return supplied;
	};
	const agentsDir = join(root, "task-harness", "agents");
	const path = join(root, "task-subagents.jsonl");
	const records = existsSync(path)
		? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try { const value = JSON.parse(line); return value && typeof value === "object" ? [value as AgentDefinition] : []; }
			catch { return []; }
		})
		: [];
	assertTaskRecordsScope(taskScope, records as unknown as Record<string, unknown>[], "task-subagents.jsonl");
	const agents = new Map<string, AgentDefinition>();
	let counter = 0;
	for (const record of records) {
		const match = record.agent_id.match(/(\d+)$/);
		if (match) counter = Math.max(counter, Number(match[1]));
		const previous = agents.get(record.name);
		if (!previous || record.version >= previous.version) agents.set(record.name, record);
	}
	const append = (name: string, value: unknown) => appendFileSync(
		join(root, name),
		JSON.stringify(stampTaskRecord(taskScope, value as Record<string, unknown>)) + "\n",
		"utf8",
	);
	const registerRoutableTool = (definition: any) => {
		pi.registerTool(definition);
		registerNativeHarnessExecutor(pi, String(definition.name), definition.execute);
	};
	let invocationCounter = 0;
	const invocationPath = join(root, "subagent-invocations.jsonl");
	if (existsSync(invocationPath)) {
		for (const line of readFileSync(invocationPath, "utf8").split(/\r?\n/).filter(Boolean)) {
			let value: any;
			try { value = JSON.parse(line); } catch { continue; }
			if (value && typeof value === "object") {
				assertTaskRecordsScope(taskScope, [value as Record<string, unknown>], "subagent-invocations.jsonl");
			}
			const match = String(value?.invocation_id ?? "").match(/(\d+)$/);
			if (match) invocationCounter = Math.max(invocationCounter, Number(match[1]));
		}
	}

	registerRoutableTool({
		name: "task_subagent",
		label: adapter.definitionLabel ?? "Task-local subagent definition",
		description: "Task-local Subagent CRUD. Read subagent-creator first; pass exact authoring_method_ref. Definitions run only via delegate_task.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			description: Type.Optional(Type.String()),
			instructions: Type.Optional(Type.String()),
			tools: Type.Optional(Type.Array(Type.String())),
			context_recipe: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: CONTEXT_RECIPE_BRIEF })),
			validity: Type.Optional(Type.Object({ scope: Type.Union([Type.Literal("task"), Type.Literal("episode"), Type.Literal("level"), Type.Literal("state")]), task_ref: Type.Optional(Type.String()), instance_ref: Type.Optional(Type.String()) })),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			authoring_method_ref: Type.Optional(Type.String({ description: "Exact subagent-creator method_ref." })),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			if (params.action === "inspect") {
				const selected = params.name ? [agents.get(params.name)].filter(Boolean) : [...agents.values()];
				return { content: [{ type: "text", text: JSON.stringify({ agents: selected }) }], details: { agents: selected } };
			}
			const admission = admitTaskLocalOperation("task_subagent");
			if (admission) return admission;
			const name = String(params.name ?? "").trim();
			safeName(name);
			const previous = agents.get(name);
			if (params.action === "create" && previous) throw new Error("subagent already exists; use update");
			if (params.action !== "create" && !previous) throw new Error("unknown subagent");
			if (previous && params.target_version !== previous.version) return versionConflict("subagent", previous, params.target_version);
			const status = params.action === "retire" ? "retired" : "active";
			const description = String(params.description ?? previous?.description ?? `Task-local independent reviewer: ${name}`).trim();
			const instructions = canonicalTextBody(params.instructions ?? previous?.instructions, "subagent instructions");
			if (status === "active" && (!description || !instructions)) throw new Error("active subagent requires description and instructions");
			const tools = params.tools ?? previous?.tools ?? defaultTools;
			const unknownTools = tools.filter((tool) => !allowedTools.has(tool));
			if (unknownTools.length) {
				throw new Error(`subagent tools must be a subset of adapter tools; unknown: ${unknownTools.join(", ")}`);
			}
			const file = join(agentsDir, `${name}.md`);
			const version = (previous?.version ?? 0) + 1;
			const decisionId = `subagent-decision-${previous?.agent_id ?? `subagent-${counter + 1}`}-v${version}`;
			const record: AgentDefinition = {
				...(params.validity !== undefined ? { validity: normalizeMemoryValidity(params.validity, memoryValidityContext(ensureTaskScope(root).taskId, readResearchRecords(root, "execution-observations.jsonl"))) }
					: previous?.validity ? { validity: previous.validity } : {}),
				adapter_id: adapter.adapterId,
				agent_id: previous?.agent_id ?? `subagent-${++counter}`,
				name,
				version,
				status,
				availability: status === "retired" ? "retired" : "loaded",
				description,
				instructions,
				tools,
				...(params.context_recipe !== undefined ? { context_recipe: normalizeContextRecipe(params.context_recipe) }
					: previous?.context_recipe ? { context_recipe: previous.context_recipe } : {}),
				file,
				basis_refs: params.basis_refs ? resolveBasisRefs(params.basis_refs) : previous?.basis_refs ?? [],
				decision_id: decisionId,
				expected_effect: params.expected_effect ?? previous?.expected_effect ?? "obtain independent read-only analysis that changes a later parent choice",
				reconsider_when: params.reconsider_when ?? previous?.reconsider_when ?? "delegation does not add decision-relevant evidence",
				routing_id: params.routing_id ? String(params.routing_id) : previous?.routing_id,
				source_approval_ref: params.source_approval_ref ? String(params.source_approval_ref) : previous?.source_approval_ref,
				authoring_method_ref: params.authoring_method_ref ? String(params.authoring_method_ref) : previous?.authoring_method_ref,
				recordedAt: new Date().toISOString(),
			};
			if (status === "active") {
				mkdirSync(agentsDir, { recursive: true });
				const temporary = `${file}.tmp`;
				writeFileSync(temporary, `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\ntools: ${tools.join(",")}\n---\n\n${instructions}\n`, "utf8");
				renameSync(temporary, file);
			}
			agents.set(name, record);
			append("task-subagents.jsonl", record);
			append("harness-decisions.jsonl", {
				decision_id: decisionId,
				decision_path: "task_subagent",
				choice: params.action,
				applied: true,
				intervention: "task_local_pi_subagent",
				basis_resource_ids: record.basis_refs,
				operation: {
					capability: "pi_subprocess_agent_loop",
					component: "task_subagent",
					adapter_id: adapter.adapterId,
					agent_name: name,
					version: record.version,
					status,
					permission: adapter.permission,
				},
				effect_metric: status === "active" ? "subagent_invoked_and_returned" : "subagent_unavailable_to_delegate",
				expected_effect: record.expected_effect,
				reconsider_when: record.reconsider_when,
				routing_id: record.routing_id,
				source_approval_ref: record.source_approval_ref,
				toolCallId,
				recordedAt: record.recordedAt,
			});
			return { content: [{ type: "text", text: JSON.stringify(record) }], details: record };
		},
	});

	// Preserve the native object schema; the compatibility field stays unadvertised.
	const delegateParameters = Type.Object({
			agent_name: Type.Optional(Type.String()),
			instructions: Type.Optional(Type.String()),
			task: Type.String(),
			tools: Type.Optional(Type.Array(Type.String(), { description: "ARC scene: include arc_state or one exact observation_snapshot ref; [] alone has no frame." })),
			context_recipe: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: CONTEXT_RECIPE_BRIEF })),
			evidence_refs: Type.Optional(Type.Array(Type.String())),
			resource_refs: Type.Optional(Type.Array(Type.String())),
			action_authorization: Type.Optional(Type.Object({ max_actions: Type.Integer({ minimum: 1, maximum: 16 }) })),
		}, { additionalProperties: false });
	pi.registerTool({
		name: "delegate_task",
		label: adapter.delegationLabel ?? "Delegate task-local analysis",
		description: "Run a clean-context child. ARC evidence is read-only unless this ordinary delegate_task explicitly grants a bounded action_authorization; Auto-Research remains read-only.",
		parameters: delegateParameters,
		prepareArguments(args) {
			try {
				const saved = typeof (args as any)?.agent_name === "string"
					? agents.get((args as any).agent_name)?.context_recipe : undefined;
				const normalized = normalizeDelegateOutputContract(args, saved);
				const input = validateToolArguments({ name: "delegate_task", description: "", parameters: delegateParameters },
					{ type: "toolCall", id: "delegate-input", name: "delegate_task", arguments: normalized as Record<string, any> }) as Record<string, any>;
				if (input.context_recipe !== undefined) normalizeContextRecipe(input.context_recipe);
				return input as any;
			} catch (error) {
				// No invocation, snapshot publication or child process exists yet.
				controlError("rejected_input", [{ path: "delegate_task", message: String(error instanceof Error ? error.message : error) }], {
					retryable: false, required_next_call: undefined,
					recovery_hint: "Rejected before delegation. Correct the reported fields in a new call; inspect only if a reference is unknown.",
				});
			}
		},
		async execute(toolCallId, params, signal) {
			const admission = admitTaskLocalOperation("delegate_task");
			if (admission) return admission;
			if (process.env.PI_TASK_CHILD === "1") throw new Error("recursive delegation is not enabled");
			if (params.action_authorization && adapter.adapterId !== "arc_agi_3")
				throw new Error("action_authorization is supported only for ARC delegate_task");
			if (params.agent_name && params.instructions) throw new Error("choose a saved agent_name or ephemeral instructions, not both");
			const perCallInstructions = params.instructions?.trim()
				|| "Complete the supplied task as a read-only task-local analyst. Use only granted resources and tools, distinguish observations from inference, and return the requested deliverable with uncertainty.";
			const definition: AgentDefinition | undefined = params.agent_name ? agents.get(params.agent_name)
				: perCallInstructions ? {
					agent_id: "ephemeral", name: "ephemeral-validator", version: 1, status: "active",
					description: "Agent-authored per-call research/validation role", instructions: perCallInstructions,
					tools: params.tools ?? defaultTools, file: "", basis_refs: [], recordedAt: new Date().toISOString(),
				} : undefined;
			if (!definition || definition.status !== "active" || (definition.availability ?? "loaded") !== "loaded") controlError("required_selection",[{path:"agent_name|instructions",message:"Supply an existing loaded active agent_name or a nonempty task/instructions value"}],
				{candidates:[...agents.values()].filter(row => row.status === "active").map(row => ({agent_name:row.name,description:row.description})),
				 repair_template:{tool:"delegate_task",arguments:{instructions:"<role instructions>",task:params.task}}});
			if (params.agent_name) {
				if (definition.validity !== undefined) {
					const reasons = memoryValidityReasons(definition.validity,
						memoryValidityContext(ensureTaskScope(root).taskId, readResearchRecords(root, "execution-observations.jsonl")));
					if (reasons.length) throw new Error(`saved subagent scope requires review: ${definition.name}@v${definition.version}: ${reasons.join(", ")}`);
				}
				const methodRejection = methodUseRejection(readResearchRecords(root, "task-method-lifecycle.jsonl"), [`subagent:${definition.name}@v${definition.version}`], readResearchRecords(root, "effect-assessments.jsonl"));
				if (methodRejection) throw new Error(methodRejection);
				const assembly = latestHarnessAssembly(readResearchRecords(root, "task-harness-assemblies.jsonl"));
				const selected = assemblySelectsReference(assembly, [
					`subagent:${definition.agent_id}@v${definition.version}`,
					`subagent:${definition.name}@v${definition.version}`,
				]);
				if (!selected) controlError("required_selection", [{ path: "agent_name",
					message: "Saved subagent is in the component pool but is not selected by the current Harness assembly" }],
					{ current_assembly: assembly, repair_template: { tool: "task_harness", arguments: {
						action: "assemble", expected_assembly_revision: assembly?.revision,
						selected_resource_refs: assembly?.selected_resource_refs ?? [],
					} } });
			}
			const startedAt = new Date().toISOString();
			const invocationId = `subagent-invocation-${++invocationCounter}`;
			const nativeChildSessionId = randomUUID();
			if (params.agent_name && params.tools !== undefined) throw new Error("Revise saved agent tools through task_harness; per-call tools are for ephemeral roles");
			if (definition.tools.some(name => !allowedTools.has(name))) throw new Error("delegate tools exceed the adapter allowlist");
			if (definition.tools.includes("arc_action") && !params.action_authorization)
				throw new Error("arc_action requires this delegate_task call to specify action_authorization");
			const recipe = params.context_recipe !== undefined ? normalizeContextRecipe(params.context_recipe) : definition.context_recipe;
			const resourceRefs = [...new Set([...(params.resource_refs ?? []), ...(recipe?.inherit_harness_refs ?? [])])];
			const childContextWindow = await withPublishedStateSnapshot(adapter, recipe ? compactContextWindow(root, recipe) : undefined,
				definition.tools, [...(params.evidence_refs ?? []), ...resourceRefs]);
			const actionGrant = params.action_authorization;
			const delegatedActions: Array<Record<string, unknown>> = [];
			const delegatedTask = (recipe?.output_contract ? `${params.task}\n\nRequired output: ${recipe.output_contract}` : params.task)
				+ (actionGrant ? `\n\nExplicit ARC action lease: at most ${actionGrant.max_actions} native actions for this invocation. Stop on an unknown result; never retry it automatically.` : "");
			append("subagent-context-bindings.jsonl", { invocation_id: invocationId, context_recipe: recipe ?? null,
				evidence_refs: params.evidence_refs ?? [], resource_refs: resourceRefs, tools: definition.tools,
				effective_tools: actionGrant ? [...new Set([...definition.tools, "arc_action"])] : definition.tools,
				action_authorization: actionGrant ?? null,
				recordedAt: startedAt });
			const arcCursor = actionGrant ? Number((await bridge("/events?after=0")).next) : 0;
			const lease = actionGrant ? await bridge("/action-lease", {
				max_actions: actionGrant.max_actions,
				expected_fingerprint: String((await bridge("/state")).state_fingerprint ?? ""),
			}) : undefined;
			const leaseToken = typeof lease?.token === "string" ? lease.token : undefined;
			let result: Record<string, unknown>;
			try {
				let continuationAttempt = 0;
				const maxContinuationsRaw = Number(process.env.PI_AUTORESEARCH_DELEGATE_MAX_CONTINUATIONS ?? 2);
				const maxContinuations = Number.isFinite(maxContinuationsRaw) && maxContinuationsRaw > 0
					? Math.floor(maxContinuationsRaw) : 2;
				const cumulativeUsage: Record<string, any> = {
					input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
				while (true) {
					continuationAttempt += 1;
					const continuationTask = continuationAttempt === 1
						? delegatedTask
						: `${delegatedTask}\n\nNative Pi session continuation after provider output-length. ` +
							"Continue from the existing transcript and return the requested result now; do not restart completed inspection or repeat prior reasoning.";
					result = await runChildPi(
						root, definition, adapter, continuationTask,
						params.evidence_refs ?? [], resourceRefs, signal,
						childContextWindow, false, undefined, undefined,
						`${invocationId}:continuation-${continuationAttempt}`,
						nativeChildSessionId,
						"unspecified", "blocking", false, [], leaseToken,
					);
					const usage = result.usage && typeof result.usage === "object"
						? result.usage as Record<string, any> : {};
					for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
						cumulativeUsage[key] += Number(usage[key] ?? 0);
					}
					const cost = usage.cost && typeof usage.cost === "object" ? usage.cost : {};
					for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
						cumulativeUsage.cost[key] += Number(cost[key] ?? 0);
					}
					append("subagent-continuations.jsonl", {
						format: "subagent-continuation-v1", invocation_id: invocationId,
						native_session_id: nativeChildSessionId, attempt: continuationAttempt,
						stop_reason: result.stop_reason ?? null, usage,
						cumulative_usage: JSON.parse(JSON.stringify(cumulativeUsage)),
						progress_ref: result.progress_ref ?? "subagent-progress.jsonl",
						progress_id: result.progress_id ?? `${invocationId}:continuation-${continuationAttempt}`,
						recordedAt: new Date().toISOString(),
					});
					if (result.stop_reason !== "length") break;
					if (continuationAttempt >= maxContinuations) {
						throw new Error(`delegate_task continuation budget exceeded (${maxContinuations})`);
					}
				}
				result.usage = cumulativeUsage;
			} catch (error) {
				append("subagent-invocations.jsonl", {
					invocation_id: invocationId,
					toolCallId,
					agent_id: definition.agent_id,
					agent_name: definition.name,
					agent_version: definition.version,
					adapter_id: adapter.adapterId,
					task: params.task,
					evidence_refs: params.evidence_refs ?? [],
					resource_refs: params.resource_refs ?? [],
					permission: adapter.permission,
					progress_ref: "subagent-progress.jsonl",
					progress_id: invocationId,
					native_session_id: nativeChildSessionId,
					status: "failed",
					startedAt,
					completedAt: new Date().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			} finally {
				if (leaseToken) {
					try {
					const window = await bridge(`/events?after=${arcCursor}`);
					const actions = (Array.isArray(window.events) ? window.events : [])
						.filter((item: any) => item?.event === "action");
					for (const item of actions) {
						const frame = { ...(item.frame && typeof item.frame === "object" ? item.frame : {}),
							pre_action_state: item.pre_action_state ?? item.frame?.pre_action_state,
							observation_delta: item.observation_delta ?? item.frame?.observation_delta,
							action_budget: { ...(item.frame?.action_budget ?? {}), total_used: Number(item.index) } };
						delegatedActions.push({ action_id: `arc-action-${String(item.index)}`,
							action: item.action, state: frame.state, levels_completed: frame.levels_completed,
							observation_delta: item.observation_delta, public_transition: frame.public_transition });
						append("execution-observations.jsonl", {
							observation_id: `delegated-arc-action-${String(item.index)}`,
							tool_name: "arc_action", toolCallId,
							input: { action: item.action, ...(item.coordinates ?? {}),
								delegated_invocation_id: invocationId },
							arc_outcome: Object.fromEntries(["state", "levels_completed", "pre_action_state",
								"public_transition", "action_budget", "observation_delta", "action_target_cell"]
								.filter((key) => frame[key] !== undefined).map((key) => [key, frame[key]])),
							result_text: `Delegated ARC action ${String(item.index)}: ${String(item.action)}; ` +
								`state=${String(frame.state ?? "UNKNOWN")}; level=${String(frame.levels_completed ?? "?")}; ` +
								`changed_cells=${String(item.observation_delta?.changed_cells ?? "unknown")}`,
							is_error: false, recordedAt: new Date().toISOString(),
						});
					}
					append("delegated-arc-action-windows.jsonl", {
						invocation_id: invocationId, action_count: actions.length,
						action_ids: actions.map((item: any) => `arc-action-${String(item.index)}`),
						recordedAt: new Date().toISOString(),
					});
					} finally {
						await bridge("/action-lease", { operation: "revoke", lease_token: leaseToken });
					}
				}
			}
			if (delegatedActions.length) result.arc_action_receipts = delegatedActions;
			const invocation = {
				version: 1,
				ephemeral: definition.agent_id === "ephemeral",
				invocation_kind: definition.agent_id === "ephemeral"
					? "one_off_delegation" : "assembled_subagent_component_use",
				component_ref: definition.agent_id === "ephemeral"
					? null : `subagent:${definition.name}@v${definition.version}`,
				component_created: false,
				invocation_id: invocationId,
				toolCallId,
				agent_id: definition.agent_id,
				agent_name: definition.name,
				agent_version: definition.version,
				adapter_id: adapter.adapterId,
				task: params.task,
				evidence_refs: params.evidence_refs ?? [],
				resource_refs: params.resource_refs ?? [],
				permission: adapter.permission,
				...(actionGrant ? { action_authorization: actionGrant } : {}),
				progress_ref: "subagent-progress.jsonl",
				progress_id: String(result.progress_id ?? invocationId),
				native_session_id: nativeChildSessionId,
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				result,
			};
			append("subagent-invocations.jsonl", invocation);
			if (definition.decision_id) {
				const hasSemanticReport = typeof result.text === "string" && result.text.trim().length > 0;
				append("harness-observations.jsonl", {
					observation_id: `subagent-use-${invocation.invocation_id}`,
					observation_kind: "pi_subagent_invocation",
					decision_id: definition.decision_id,
					resource_refs: [`subagent:${definition.name}@v${definition.version}`],
					basis_resource_ids: definition.basis_refs,
					inherited_resource_refs: params.resource_refs ?? [],
					operation: {
						capability: "pi_subprocess_agent_loop",
						adapter_id: adapter.adapterId,
						agent_name: definition.name,
						version: definition.version,
						permission: adapter.permission,
					},
					actual_use: true,
					semantic_effect_observed: hasSemanticReport,
					effect_observed: hasSemanticReport,
					invocation_id: invocation.invocation_id,
					recordedAt: invocation.completedAt,
				});
			}
			const usage = result.usage && typeof result.usage === "object"
				? result.usage as Record<string, any>
				: {};
			const usageSummary = {
				input: Number(usage.input ?? 0),
				output: Number(usage.output ?? 0),
				cacheRead: Number(usage.cacheRead ?? 0),
				cacheWrite: Number(usage.cacheWrite ?? 0),
				cost_total: Number(usage.cost?.total ?? 0),
			};
			return {
				...(delegatedActions.length ? { terminate: true } : {}),
				content: [
					{ type: "text", text: JSON.stringify({ ...resourceMetadata("delegation", invocation),
						invocation_kind: invocation.invocation_kind,
						component_ref: invocation.component_ref,
						component_created: false,
						...(invocation.ephemeral ? { optional_persistence: {
							automatic: false,
							creator_call: { tool: "task_harness", arguments: {
								action: "read_method", method_name: "subagent-creator",
							} },
							note: "Only the parent may author, pool, and assemble a reusable Subagent if this one-off role proves useful.",
						} } : {}),
						report_excerpt: String(result.text ?? ""),
						report_truncated: false,
						assessment: "agent_report_not_independent_verification",
						...(delegatedActions.length ? { arc_action_receipts: delegatedActions } : {}) }) },
					{ type: "text", text: `SUBAGENT_USAGE: ${JSON.stringify(usageSummary)}` },
				],
				details: { ...invocation, arc_action_count: delegatedActions.length,
					...(delegatedActions.length ? { arc_action_boundary: true,
						arc_action_receipts: delegatedActions } : {}) },
			};
		},
	});

	if (adapter.autoResearch) {
		let researchRunCounter = 0;
		for (const line of (existsSync(join(root, "auto-research-runs.jsonl"))
			? readFileSync(join(root, "auto-research-runs.jsonl"), "utf8").split(/\r?\n/).filter(Boolean) : [])) {
			try { researchRunCounter = Math.max(researchRunCounter, Number(String(JSON.parse(line).run_id ?? "").match(/(\d+)$/)?.[1] ?? 0)); } catch {}
		}
		let researchSessionCounter = 0;
		for (const line of (existsSync(join(root, "auto-research-sessions.jsonl"))
			? readFileSync(join(root, "auto-research-sessions.jsonl"), "utf8").split(/\r?\n/).filter(Boolean) : [])) {
			try {
				const item = JSON.parse(line);
				researchSessionCounter = Math.max(researchSessionCounter, Number(String(item.session_id ?? "").match(/(\d+)$/)?.[1] ?? 0));
				researchRunCounter = Math.max(researchRunCounter, Number(String(item.run_id ?? "").match(/(\d+)$/)?.[1] ?? 0));
			} catch {}
		}
		let researchPlanCounter = 0;
		for (const plan of readResearchRecords(root, "auto-research-plans.jsonl")) {
			researchPlanCounter = Math.max(researchPlanCounter,
				Number(String(plan.plan_id ?? "").match(/(\d+)$/)?.[1] ?? 0));
		}
		const persistPlan = (plan: ResearchPlan) => {
			append("auto-research-plans.jsonl", plan);
			return plan;
		};
		const resolvePlan = (reference: unknown): ResearchPlan => {
			if (!reference) return selectControlTarget(latestControlRecords(readResearchRecords(root,"auto-research-plans.jsonl"),"plan_id"),"plan_id") as ResearchPlan;
			const parsed = researchPlanReference(reference);
			if (!parsed.planId) throw new Error("plan_ref must use research_plan:<id>@vN");
			const plan = latestResearchPlan(root, parsed.planId);
			if (!plan) throw new Error(`unknown research plan: ${String(reference ?? "")}`);
			if (parsed.version !== undefined && parsed.version !== plan.version) {
				throw new Error(`research plan version conflict: expected v${parsed.version}, current v${plan.version}`);
			}
			return plan;
		};
		const syncPlanFromSession = (session: Record<string, any>) => {
			const planId = String(session.plan_id ?? "");
			const nodeId = String(session.plan_node_id ?? "");
			if (!planId || !nodeId) return;
			const plan = latestResearchPlan(root, planId);
			const node = plan?.nodes.find((candidate) => candidate.node_id === nodeId);
			if (!plan || !node) return;
			let status: ResearchNodeStatus | undefined;
			let patch: Record<string, unknown> = {};
			if (session.status === "completed") {
				status = "completed";
				patch = { result_ref: session.research_run_ref ?? `research_run:${session.run_id}@v1`,
					session_ref: `research_session:${session.session_id}@v${session.version}` };
			} else if (session.status === "failed") {
				status = "failed";
				patch = { failure_reason: session.error ?? session.failure_code ?? "background research failed" };
			} else if (session.status === "cancelled") {
				status = "skipped";
				patch = { wait_reason: "cancelled" };
			} else if (session.status === "pending") {
				status = "pending";
				patch = { wait_reason: "child_pending", session_ref: `research_session:${session.session_id}@v${session.version}` };
			}
			if (!status || node.status === status) return;
			persistPlan(transitionResearchNode(plan, nodeId, status, patch));
		};
		const persistAgendaFromReport = (
			session: Record<string, any>, report: Record<string, any>, runId: string,
			reportRef: string, recordedAt: string,
		): Record<string, any> | undefined => {
			if (report.candidate_updates?.length) updateTaskStrategyState(root, {
				candidate_updates: report.candidate_updates, source_ref: reportRef,
			});
			if (!report.research_progress) return undefined;
			const previous = latestAutoResearchAgenda(root, String(session.research_line_ref ?? "research_line:task-auto-research-agenda@v1"));
			if (previous?.last_run_ref === `research_run:${runId}@v1`) return previous;
			const historyCursor = session.history_cursor && typeof session.history_cursor === "object"
				? session.history_cursor : buildAutoResearchHistoryCatalog(root, previous?.history_cursor ?? {}).cursor;
			const agenda = buildAutoResearchAgendaRecord({
				previous, progress: report.research_progress, historyCursor, runId, reportRef,
				researchLineRef: String(session.research_line_ref ?? "research_line:task-auto-research-agenda@v1"),
				recordedAt,
			});
			append("auto-research-agenda.jsonl", agenda);
			return agenda;
		};
		const readJsonObject = (path: string): Record<string, any> | undefined => {
			if (!existsSync(path)) return undefined;
			try {
				const value = JSON.parse(readFileSync(path, "utf8"));
				return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
			} catch { return undefined; }
		};
		const failDetachedSession = (session: Record<string, any>, code: string, error: string) => {
			const failed = { ...session, version: Number(session.version ?? 0) + 1,
				status: "failed" as ResearchSessionStatus, failure_code: code, error,
				reconciliation_status: "not_applicable", recordedAt: new Date().toISOString() };
			append("auto-research-sessions.jsonl", failed);
			return failed;
		};
		// A publication and its terminal report can carry the same candidate.
		// Preserve its exact method version and any completed parent handoff; a
		// scientific revision gets a new version, never another conflicting v1.
		const persistWorkerCandidates = (runId: string, reportRef: string, line: string, report: Record<string, any>) => {
			const comparison = buildCrossContextComparison({ researchLineRef: line,
				observations: readResearchRecords(root, "execution-observations.jsonl"), explicitEvidenceRefs: report.evidence_refs ?? [],
				reports: readResearchRecords(root, "auto-research-reports.jsonl"), methods: readResearchRecords(root, "task-method-lifecycle.jsonl") });
			const methods = methodRecordsFromReport({ runId, reportRef, researchLineRef: line, report, comparison,
				recordedAt: new Date().toISOString() });
			const refs = new Map<string, string>();
			for (const method of methods) {
				const candidate = report.method_candidates.find((c: any) => c.candidate_ref === method.candidate_ref);
				const signature = JSON.stringify(candidate);
				const prior = readResearchRecords(root, "task-method-lifecycle.jsonl").filter(m => m.method_id === method.method_id).at(-1);
				const version = prior?.publication_signature === signature ? Number(prior.version) : Number(prior?.version ?? 0) + 1;
				if (prior?.publication_signature !== signature) append("task-method-lifecycle.jsonl", { ...method, version, publication_signature: signature });
				refs.set(String(method.candidate_ref), `method:${method.method_id}@v${version}`);
			}
			return buildParentAuthoringHandoffs({ runId, reportRef, researchLineRef: line, report }).map(handoff => {
				const methodRef = refs.get(String(handoff.source.method_candidate_ref)) ?? handoff.source.method_ref;
				const previous = readResearchRecords(root, "parent-authoring-handoffs.jsonl").filter(h => h.handoff_id === handoff.handoff_id).at(-1);
				if (previous?.source?.method_ref === methodRef) return previous;
				const version = Number(previous?.version ?? 0) + 1;
				const next = { ...handoff, version, resource_ref: `authoring_handoff:${handoff.handoff_id}@v${version}`,
					source: { ...handoff.source, method_ref: methodRef } };
				next.change_call_template.arguments.changes[0].candidate_seed.basis_refs = [reportRef, methodRef];
				next.change_call_template.arguments.decision_seed.basis_refs = [reportRef, methodRef];
				append("parent-authoring-handoffs.jsonl", next);
				return next;
			});
		};
		const refreshDetachedSession = async (session: Record<string, any>): Promise<Record<string, any>> => {
			if (session.status !== "active" || session.interaction_mode !== "non_blocking") return session;
			const runId = String(session.run_id ?? "");
			const brokerPath = join(root, "task-context-cache", "auto-research-broker", `${runId}.json`);
			let brokerStatus = readJsonObject(brokerPath);
			if (brokerStatus?.status === "active") {
				const brokerUrl = String(process.env.PI_AUTORESEARCH_SUBAGENT_BROKER_URL ?? "").trim();
				if (!brokerUrl) return failDetachedSession(session, "background_broker_unavailable", "active child has no reachable broker");
				try {
					const live = await brokerJsonRequest(brokerUrl, "/inspect", { job_id: `${runId}:continuation-1` });
					if (live.status === "active") return session;
					brokerStatus = readJsonObject(brokerPath) ?? live;
					if (brokerStatus.status === "active") brokerStatus = live;
				} catch (error) {
					return failDetachedSession(session, "background_broker_unreachable",
						error instanceof Error ? error.message : String(error));
				}
			}
			const nextVersion = Number(session.version ?? 0) + 1;
			const recordedAt = new Date().toISOString();
			const checkpoint = readJsonObject(join(root, "task-context-cache", "auto-research-checkpoints", `${session.session_id}.json`));
			const reportPath = join(root, "task-context-cache", "auto-research-child-results", `${runId}.json`);
			const rawReport = readJsonObject(reportPath);
			if (brokerStatus?.status === "cancelled") {
				const cancelled = { ...session, version: nextVersion, status: "cancelled" as ResearchSessionStatus,
					reconciliation_status: "not_applicable", cancelledAt: recordedAt, recordedAt };
				append("auto-research-sessions.jsonl", cancelled);
				return cancelled;
			}
			if (brokerStatus?.status === "completed" && !rawReport && checkpoint?.status === "pending") {
				const fallbackCursor = canonicalEvidenceSnapshot(root);
				const runtimeCheckpoint = { ...checkpoint,
					after_evidence_sequence: Number(checkpoint.after_evidence_sequence ?? fallbackCursor.sequence),
					after_evidence_refs: Array.isArray(checkpoint.after_evidence_refs) ? checkpoint.after_evidence_refs : fallbackCursor.refs,
					recorded_at: recordedAt };
				const pending = { ...session, version: nextVersion, status: "pending" as ResearchSessionStatus,
					checkpoint: runtimeCheckpoint, reconciliation_status: "not_applicable", recordedAt };
				append("auto-research-sessions.jsonl", pending);
				append("auto-research-runs.jsonl", { run_id: runId, version: 1, session_id: session.session_id,
					status: "pending", question: session.question, scope: session.scope, evidence_refs: session.evidence_refs ?? [],
					resource_refs: session.resource_refs ?? [], checkpoint: runtimeCheckpoint, startedAt: session.recordedAt,
					completedAt: recordedAt, summary: "Research is pending without a conclusion." });
				return pending;
			}
			if (brokerStatus?.status === "completed" && rawReport) {
				let report: Record<string, any>;
				try { report = auditResearchConfidence(root, bindExperimentRequest(normalizeAutoResearchReport(rawReport), runId, session.evidence_refs ?? [])); }
				catch (error) {
					return failDetachedSession(session, "invalid_background_report",
						error instanceof Error ? error.message : String(error));
				}
				const reportRef = `research_report:${runId}@v1`;
				const agenda = persistAgendaFromReport(session, report, runId, reportRef, recordedAt);
				const parentAttention = session.open_allocation !== true || researchReportNeedsParentAttention(report);
				const authoringHandoffs = session.worker_id ? persistWorkerCandidates(runId, reportRef, session.research_line_ref, report)
					: buildParentAuthoringHandoffs({ runId, reportRef, researchLineRef: session.research_line_ref ?? undefined, report });
				const existingHandoffs = new Set(readResearchRecords(root, "parent-authoring-handoffs.jsonl")
					.map((item) => String(item.handoff_id)));
				for (const handoff of authoringHandoffs) if (!existingHandoffs.has(String(handoff.handoff_id))) {
					append("parent-authoring-handoffs.jsonl", handoff);
				}
				const audit = readJsonObject(join(root, "task-context-cache", "auto-research-child-results", `${runId}.audit.json`));
				const summary = String(report.conclusion ?? report.status ?? "completed");
				if (!readResearchRecords(root, "auto-research-reports.jsonl").some((item) => item.run_id === runId)) {
					append("auto-research-reports.jsonl", { run_id: runId, version: 1, status: "completed", summary,
						research_line_ref: session.research_line_ref ?? null,
						research_kind: session.research_kind ?? null,
						experiment_request: report.experiment_request ?? null,
						planning_implications: report.planning_implications ?? [],
						next_research_question: report.next_research_question ?? "",
						research_progress: report.research_progress ?? null,
						agenda_ref: agenda ? `research_agenda:${agenda.agenda_id}@v${agenda.version}` : null,
						parent_attention: parentAttention,
						report, evidence_audit: audit ?? null, recordedAt });
					const comparison = buildCrossContextComparison({
						researchLineRef: session.research_line_ref ?? null,
						observations: readResearchRecords(root, "execution-observations.jsonl"),
						explicitEvidenceRefs: session.evidence_refs ?? [],
						reports: readResearchRecords(root, "auto-research-reports.jsonl"),
						methods: readResearchRecords(root, "task-method-lifecycle.jsonl"),
					});
					append("auto-research-comparison-bundles.jsonl", { ...comparison, session_id:session.session_id, run_id:runId });
					for (const methodRecord of session.worker_id ? [] : methodRecordsFromReport({ runId, reportRef,
						researchLineRef:session.research_line_ref ?? null, report, comparison, recordedAt })) {
						append("task-method-lifecycle.jsonl", methodRecord);
					}
				}
				if (!readResearchRecords(root, "auto-research-runs.jsonl").some((item) => item.run_id === runId && item.status === "completed")) append("auto-research-runs.jsonl", { run_id: runId, version: 1, session_id: session.session_id,
						status: "completed", request_signature: session.request_signature,
						question: session.question, scope: session.scope, evidence_refs: session.evidence_refs ?? [],
					resource_refs: session.resource_refs ?? [], report_ref: reportRef, finding_count: report.findings.length,
					method_candidate_count: report.method_candidates.length,
					parent_authoring_handoff_count: authoringHandoffs.length,
					route_execution_count: 0, evidence_audit: audit ?? null,
					experiment_request: report.experiment_request ?? null,
					planning_implications: report.planning_implications ?? [],
					next_research_question: report.next_research_question ?? "",
					research_progress: report.research_progress ?? null,
					agenda_ref: agenda ? `research_agenda:${agenda.agenda_id}@v${agenda.version}` : null,
					parent_attention: parentAttention,
					startedAt: session.recordedAt, completedAt: recordedAt, summary });
				const completed = { ...session, version: nextVersion, status: "completed" as ResearchSessionStatus,
					research_run_ref: `research_run:${runId}@v1`, report_ref: reportRef, summary,
					experiment_request: report.experiment_request ?? null,
					planning_implications: report.planning_implications ?? [],
					next_research_question: report.next_research_question ?? "",
					research_progress: report.research_progress ?? null,
					agenda_ref: agenda ? `research_agenda:${agenda.agenda_id}@v${agenda.version}` : null,
					parent_attention: parentAttention,
					reconciliation_status: authoringHandoffs.length ? "awaiting_parent_authoring" : "not_applicable", recordedAt };
				append("auto-research-sessions.jsonl", completed);
				return completed;
			}
			return failDetachedSession(session,
				brokerStatus?.status === "stalled" ? "background_child_stalled"
					: brokerStatus?.status === "failed" ? "background_child_failed" : "orphaned_active_session",
				brokerStatus?.status === "stalled"
					? `background child made no semantic checkpoint progress across ${brokerStatus.stagnant_continuations} length continuations`
					: brokerStatus?.status === "failed" && brokerStatus.last_stop_reason === "error"
						? "background child provider returned stopReason=error"
						: brokerStatus?.status === "failed" ? `background child exited with ${brokerStatus.exit_code}`
					: `background child is not live (${String(brokerStatus?.status ?? "missing")})`);
		};
		const claimResearchSession = (session: Record<string, any>, runId: string, evidenceRefs: string[]) => {
			const claimDir = join(root, "task-context-cache", "auto-research-claims");
			mkdirSync(claimDir, { recursive: true });
			const claimPath = join(claimDir, `${session.session_id}@v${session.version}.json`);
			try {
				writeFileSync(claimPath, JSON.stringify({ session_id: session.session_id, expected_version: session.version,
					run_id: runId, claimedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flag: "wx" });
			} catch (error: any) {
				if (error?.code === "EEXIST") throw new Error(`research session version was already claimed: ${session.session_id}@v${session.version}`);
				throw error;
			}
			const latest = latestResearchSession(root, String(session.session_id));
			if (!latest || Number(latest.version) !== Number(session.version) || latest.status !== session.status) {
				throw new Error(`research session version conflict: expected v${session.version}, current v${latest?.version ?? "missing"}`);
			}
			const active = { ...session, version: Number(session.version) + 1, status: "active" as ResearchSessionStatus,
				run_id: runId, evidence_refs: evidenceRefs, checkpoint: session.checkpoint,
				reconciliation_status: "not_applicable", recordedAt: new Date().toISOString() };
			append("auto-research-sessions.jsonl", active);
			return active;
		};
		// Active records are refreshed from durable broker results at parent-owned
		// runtime points (before_agent_start and inspect), never during extension
		// loading when native tool capabilities are not initialized yet.
		let autoResearchTool: any;
		autoResearchTool = {
			name: "auto_research",
			label: adapter.autoResearchLabel ?? "Auto-Research in clean context",
			description: "Bounded read-only research (start) or continuing workers (assign). Parent owns actions/adoption. contract(schema_action=enqueue) loads typed plan fields.",
			parameters: (() => {
				const schema = Type.Object({
				action: Type.Optional(Type.Union([
					Type.Literal("contract"), Type.Literal("start"), Type.Literal("inspect"), Type.Literal("resume"), Type.Literal("cancel"),
					Type.Literal("enqueue"), Type.Literal("inspect_plan"), Type.Literal("release"), Type.Literal("skip"),
					Type.Literal("topics"), Type.Literal("topic"),
					Type.Literal("assign"), Type.Literal("workers"), Type.Literal("revoke"),
				])),
				worker_ref: Type.Optional(Type.String()),
				assignment: Type.Optional(Type.Object({
					worker_id: Type.String(), responsibility: Type.String(), stop_when: Type.String(),
					handle_periodic_reviews: Type.Optional(Type.Boolean({ description: "Assign historical-window analysis; parent still owns adoption." })),
					max_runs: Type.Integer({ minimum: 1, maximum: 100 }),
					max_output_tokens: Type.Integer({ minimum: 1 }),
					evidence_kinds: Type.Optional(Type.Array(Type.Union(WORKER_EVIDENCE_KINDS.map(k => Type.Literal(k))))),
					notification_policy: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("index_only")])),
				})),
				interaction_mode: Type.Optional(Type.Union([
					Type.Literal("blocking"), Type.Literal("non_blocking"),
				], { description: "blocking waits; non_blocking returns session immediately." })),
				question: Type.Optional(Type.String({ minLength: 1 })),
				research_line_ref: Type.Optional(Type.String({ minLength: 1, description: "Durable topic identity; reuse it across independent research sessions." })),
				offset: Type.Optional(Type.Integer({ minimum: 0 })),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
				current_concern: Type.Optional(Type.String({ minLength: 1, description: "Optional concern; child scopes question." })),
					research_candidate_ref: Type.Optional(Type.String({ description: "Exact cross-context candidate ref." })),
				research_reason: Type.Optional(Type.String({ minLength: 1, description: "Parent reason for skipping an exact research candidate." })),
				authoring_method_ref: Type.Optional(Type.String({ description: "Exact research-orchestration method_ref." })),
				research_handoff_ref: Type.Optional(Type.String()),
				session_ref: Type.Optional(Type.String()),
				plan_ref: Type.Optional(Type.String()),
				node_id: Type.Optional(Type.String()),
				plan: Type.Optional(Type.Object({
					goal:Type.String({minLength:1}),
					complexity_assessment:Type.Object({level:Type.Union([Type.Literal("simple"),Type.Literal("compound")]),rationale:Type.String({minLength:1})}),
					concurrency_limit:Type.Optional(Type.Integer({minimum:1})),
					nodes:Type.Array(Type.Object({
						node_id:Type.String({pattern:"^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$",description:"Plan-local ID; dependencies match node_id."}),
						question:Type.String({minLength:1}),completion_contract:Type.String({minLength:1}),
						research_kind:Type.Optional(Type.Union([
							Type.Literal("mechanism"),Type.Literal("representation"),Type.Literal("capability"),Type.Literal("composition"),
							Type.Literal("exploration"),Type.Literal("planning"),Type.Literal("solution"),Type.Literal("recovery"),
						])),
						depends_on:Type.Optional(Type.Array(Type.String())),
						activation_policy:Type.Optional(Type.Union([Type.Literal("after_dependencies"),Type.Literal("parent_release")])),
						scope:Type.Optional(Type.String()),constraints:Type.Optional(Type.Array(Type.String())),
						evidence_refs:Type.Optional(Type.Array(Type.String())),resource_refs:Type.Optional(Type.Array(Type.String())),
					}, {additionalProperties:true}), {minItems:1,description:"Dependencies must be acyclic."}),
				})),
				complexity_assessment: Type.Optional(Type.Object({
					level: Type.Union([Type.Literal("simple"), Type.Literal("compound")]),
					rationale: Type.String({ minLength: 1 }),
				}, { additionalProperties: true })),
				// Scope is a topic label passed through to the child and durable
				// session. No runtime branch depends on a closed taxonomy. Keeping
				// it open avoids rejecting grounded parent questions such as
				// "problem_understanding" before the child can inspect evidence.
				scope: Type.Optional(Type.String({ minLength: 1, maxLength: 120,
					description: "Research focus/topic (e.g. exploration, strategy); not a Harness component." })),
				research_kind: Type.Optional(Type.Union([
					Type.Literal("mechanism"), Type.Literal("representation"), Type.Literal("capability"), Type.Literal("composition"),
					Type.Literal("exploration"), Type.Literal("planning"), Type.Literal("solution"), Type.Literal("recovery"),
				], { description: "Task research object; not a component choice." })),
				evidence_refs: Type.Optional(Type.Array(Type.String())),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				inherit_harness_refs: Type.Optional(Type.Array(Type.String())),
				context_window: Type.Optional(Type.Object({
					include_checkpoint: Type.Optional(Type.Boolean()),
					recent_observations: Type.Optional(Type.Integer({ minimum: 0 })),
					recent_actions: Type.Optional(Type.Integer({ minimum: 0 })),
					context_refs: Type.Optional(Type.Array(Type.String())),
					max_chars: Type.Optional(Type.Integer({ minimum: 0 })),
				})),
				constraints: Type.Optional(Type.Array(Type.String())),
				review_reason: Type.Optional(Type.String({ maxLength: 600, description: "New objective/check/method permitting re-review of unchanged evidence." })),
				});
				// Some OpenAI-compatible gateways reject TypeBox's null `required`
				// marker when every field is optional (resume may inherit question).
				// An explicit empty array preserves the optional API and valid JSON
				// Schema semantics.
				if (!Array.isArray((schema as any).required)) (schema as any).required = [];
				return compactToolSchema(schema);
			})(),
			async execute(toolCallId, params, signal) {
				if (process.env.PI_TASK_CHILD === "1") throw new Error("recursive auto-research is not enabled");
				const action = String(params.action ?? "start");
				if (["start", "enqueue", "assign"].includes(action)) {
					const method = readBaselineMethod("research-orchestration");
					const alreadyRead = readBaselineMethodReceipts().some(row => row.method_ref === method.method_ref
						&& row.actor !== "child" && row.sha256 === method.sha256);
					if (!alreadyRead) {
						const { content, ...receipt } = method;
						append("task-baseline-method-reads.jsonl", { ...receipt, actor: "parent", toolCallId,
							source: "auto_research_start_preparation", recordedAt: new Date().toISOString() });
						if (process.env.PI_HARNESS_OPEN_ADMISSION !== "enabled"
							&& !pi.getAllTools().some((tool) => tool.name === "arc_action")) {
							const result = { status: "authoring_method_supplied", started: false, method,
								retry: { ...params, action, authoring_method_ref: method.method_ref },
								instruction: "Read this research-orchestration method, then confirm or revise the proposed research by calling start/enqueue again. No research has started. Later calls may omit authoring_method_ref." };
							return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
						}
						params.authoring_method_ref = method.method_ref;
					}
				}
				const authoringMethodRef = ["start", "enqueue", "assign"].includes(action)
					? requireResearchOrchestrationRead(params as Record<string, any>) : String(params.authoring_method_ref ?? "").trim() || undefined;
				if (["start", "assign"].includes(action) && !params.research_line_ref) {
					params.research_line_ref = inferResearchLineRef(root, params);
				}
				if (action === "start" && params.research_candidate_ref) {
					const match = /^research_candidate:([^@]+)@v([1-9]\d*)$/.exec(String(params.research_candidate_ref));
					if (!match) throw new Error("research_candidate_ref must be an exact versioned research_candidate reference");
					const [, candidateId, versionText] = match;
					const candidate = readResearchRecords(root, "auto-research-opportunities.jsonl")
						.find((row) => String(row.candidate_id) === candidateId && Number(row.version) === Number(versionText));
					if (!candidate) throw new Error(`unknown research candidate: ${String(params.research_candidate_ref)}`);
					const preset = candidate.research_parameters as Record<string, any> | undefined;
					if (!preset) throw new Error("research candidate has no runtime parameters");
					Object.assign(params, bindResearchCandidateParameters(preset, params));
				}
				if (action === "contract") {
					const topics = researchTopicIndex(root, 0, 3);
					const allSessions = latestControlRecords(readResearchRecords(root,"auto-research-sessions.jsonl"),"session_id");
					const contract = { format: "auto-research-operations-v1",
						instructions: loadPrompt("auto_research_operations.md"),
						agenda: topics.total === 1 ? latestAutoResearchAgenda(root) ?? null : null,
						topics,
						handoffs:latestControlRecords(readResearchRecords(root,"auto-research-handoffs.jsonl"),"handoff_id").map(row => ({ref:researchHandoffReference(row),status:row.status,next_call:row.next_call ?? row.ready_call})),
						sessions:allSessions.filter(row => ["active", "pending", "failed"].includes(String(row.status)))
						.slice(-8).map(row => ({session_ref:`research_session:${row.session_id}@v${row.version}`,
							topic_ref:row.research_line_ref ?? null,status:row.status})),
						session_count:allSessions.length,
						plans:latestControlRecords(readResearchRecords(root,"auto-research-plans.jsonl"),"plan_id").map(row => researchPlanView(row as ResearchPlan)) };
					return { content: [{ type: "text", text: JSON.stringify(contract) }], details: contract };
				}
				if (action === "workers") {
					const result = { format: "auto-research-workers-index-v1", workers: researchWorkers(root).map(w => ({
						worker_ref: workerRef(w), responsibility: w.responsibility, research_line_ref: w.research_line_ref,
						status: w.status, started_runs: w.started_runs, max_runs: w.max_runs,
						queued_evidence: pendingWorkerEvidence(w).length, consumed_evidence: w.consumed_refs.length,
						session_id: w.session_id, last_report_ref: w.last_report_ref, stop_reason: w.stop_reason ?? null })) };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				if (action === "assign") {
					const admission = admitTaskLocalOperation("auto_research"); if (admission) return admission;
					if (params.plan_ref) {
						const plan = resolvePlan(params.plan_ref); const view = researchPlanView(plan);
						if (!params.node_id || !view.runnable_node_ids.includes(params.node_id))
							throw new Error("assignment plan node must be explicitly selected and released/runnable");
						const node = plan.nodes.find(n => n.node_id === params.node_id)!;
						params.question ??= node.question; params.scope ??= node.scope;
						params.resource_refs ??= node.resource_refs; params.constraints ??= node.constraints;
					}
					const worker = routeWorkerEvidence(root, assignResearchWorker(root, { ...params, ...params.assignment,
						authoring_method_ref: authoringMethodRef }));
					const result = { format: "auto-research-assigned-v1", worker_ref: workerRef(worker),
						status: worker.status, research_line_ref: worker.research_line_ref,
						instruction: "Authorized evidence is queued at each parent model boundary. No research cursor has been consumed yet. Parent continues acting and receives bounded current updates; details stay with this worker." };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				if (action === "revoke") {
					const w = resolveWorker(root, String(params.worker_ref ?? ""));
					const session = w.session_id ? latestResearchSession(root, w.session_id) : undefined;
					let stopped = updateWorker(root, w, { status: "revoked", stop_reason: "parent_revoked" });
					try {
					if (session && ["active", "pending"].includes(session.status)) await autoResearchTool.execute(toolCallId + ":cancel", {
						action: "cancel", session_ref: `research_session:${session.session_id}@v${session.version}`,
						__worker_cancel_run_id: session.run_id }, signal);
					} catch (error) { stopped = updateWorker(root, stopped, { stop_error: String(error) }); }
					const result = { worker_ref: workerRef(stopped), status: stopped.status, ...(stopped.stop_error ? { stop_error: stopped.stop_error } : {}) };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				if (action === "topics") {
					const result = researchTopicIndex(root, Number(params.offset ?? 0), Number(params.limit ?? 8));
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				if (action === "topic") {
					const line = String(params.research_line_ref ?? "").trim();
					if (!line) throw new Error("topic inspection requires research_line_ref");
					const agenda = latestAutoResearchAgenda(root, line) ?? null;
					const sessions = latestControlRecords(readResearchRecords(root, "auto-research-sessions.jsonl"), "session_id")
						.filter(row => row.research_line_ref === line)
						.sort((a, b) => Number(["active", "pending", "failed"].includes(String(b.status)))
							- Number(["active", "pending", "failed"].includes(String(a.status)))
							|| String(b.recordedAt ?? "").localeCompare(String(a.recordedAt ?? "")));
					if (!agenda && !sessions.length) throw new Error(`unknown research topic: ${line}`);
					const result = { format: "auto-research-topic-v1", topic_ref: line, agenda,
						sessions: sessions.slice(0, 8).map(row => ({ session_ref: `research_session:${row.session_id}@v${row.version}`,
							status: row.status, report_ref: row.report_ref ?? null })),
						omitted_session_count: Math.max(0, sessions.length - 8) };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				if (action === "enqueue") {
					const admission = admitTaskLocalOperation("auto_research");
					if (admission) return admission;
					const plan = persistPlan(createResearchPlan(params.plan as Record<string, any>,
						`research-plan-${++researchPlanCounter}`));
					const view = researchPlanView(plan);
					return { content: [{ type: "text", text: JSON.stringify(view) }], details: view };
				}
				if (action === "skip" && params.research_candidate_ref) {
					const admission = admitTaskLocalOperation("auto_research");
					if (admission) return admission;
					const match = /^research_candidate:([^@]+)@v([1-9]\d*)$/.exec(String(params.research_candidate_ref));
					if (!match) throw new Error("research_candidate_ref must be an exact versioned research_candidate reference");
					const candidate = latestControlRecords(readResearchRecords(root,"auto-research-opportunities.jsonl"),"candidate_id")
						.find(row => String(row.candidate_id) === match[1]);
					if (!candidate) throw new Error(`unknown research candidate: ${String(params.research_candidate_ref)}`);
					if (Number(candidate.version) !== Number(match[2])) return versionConflict("research_candidate",candidate,Number(match[2]));
					const reason = String(params.research_reason ?? params.review_reason ?? "").trim();
					if (!reason) throw new Error("Skipping a research candidate requires research_reason");
					const decision = { ...candidate, version: Number(candidate.version) + 1, status: "skipped",
						decided_by: "parent", parent_reason: reason, skipped_candidate_ref: params.research_candidate_ref,
						recordedAt: new Date().toISOString() };
					append("auto-research-opportunities.jsonl",decision);
					const receipt = { format: "auto-research-candidate-decision-v1", status: "skipped", decided_by: "parent",
						candidate_ref: `research_candidate:${candidate.candidate_id}@v${decision.version}`,
						parent_reason: reason, resume_condition: "changed_candidate_evidence", starts_research: false };
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
				if (["inspect_plan", "release", "skip"].includes(action)) {
					if (params.research_handoff_ref) controlError("wrong_target_type",[{path:"research_handoff_ref",message:"skip/release operates on a plan node; handoff decisions belong to task_harness"}],
						{required_next_call:{tool:"task_harness",arguments:{action:"decide_research",research_handoff_ref:params.research_handoff_ref,research_decision:"skip",research_reason:"<why skip>"}}});
					let plan = resolvePlan(params.plan_ref);
					if (["release", "skip"].includes(action)) {
						const admission = admitTaskLocalOperation("auto_research");
						if (admission) return admission;
						const node = selectControlTarget(params.node_id ? plan.nodes : plan.nodes.filter(node => action === "release" ? node.status === "pending" : !["completed","skipped","active"].includes(node.status)),"node_id",params.node_id);
						plan = persistPlan(action === "release"
							? releaseResearchNode(plan, String(node.node_id))
							: transitionResearchNode(plan, String(node.node_id), "skipped", { wait_reason: "parent_skipped" }));
					}
					const view = researchPlanView(plan);
					return { content: [{ type: "text", text: JSON.stringify(view) }], details: view };
				}
				if (["inspect", "cancel"].includes(action)) {
					const explicitSessionReference = Boolean(params.session_ref);
					if (!params.session_ref) {
						const session = selectControlTarget(latestControlRecords(readResearchRecords(root,"auto-research-sessions.jsonl"),"session_id")
							.filter(row => action === "inspect" || !["completed","cancelled"].includes(row.status)),"session_id");
						params.session_ref = `research_session:${session.session_id}@v${session.version}`;
					}
					const requestedRef = researchSessionReference(params.session_ref);
					const sessionId = requestedRef.sessionId;
					if (!sessionId) throw new Error(`${action} requires session_ref`);
					let session = latestResearchSession(root, sessionId);
					if (!session) throw new Error(`unknown research session: ${String(params.session_ref ?? "")}`);
					const ownedRunId = session.worker_id && (params as any).__worker_cancel_run_id === session.run_id
						? session.run_id : undefined;
					if (action === "inspect" || action === "cancel") session = await refreshDetachedSession(session);
					if (action === "cancel") {
						const admission = admitTaskLocalOperation("auto_research");
						if (admission) return admission;
						const boundCancellation = ownedRunId && ownedRunId === session.run_id;
						if (!boundCancellation && explicitSessionReference && requestedRef.version !== undefined && requestedRef.version !== Number(session.version))
							controlError("version_conflict",[{path:"session_ref",message:`research session version conflict: expected v${requestedRef.version}, current v${session.version}`}],
								{current_ref:`research_session:${sessionId}@v${session.version}`});
						if (["completed", "cancelled"].includes(String(session.status))) {
							if (!boundCancellation) throw new Error(`research session is not cancellable: ${session.status}`);
							const result = { session_ref: `research_session:${sessionId}@v${session.version}`, status: session.status,
								cancellation_required: false, run_id: ownedRunId };
							return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
						}
						const brokerUrl = String(process.env.PI_AUTORESEARCH_SUBAGENT_BROKER_URL ?? "").trim();
						if (session.status === "active") {
							if (!brokerUrl || !session.run_id) throw new Error("cannot confirm cancellation without the active child broker");
							const cancelledJob = await brokerJsonRequest(brokerUrl, "/cancel", { job_id: `${session.run_id}:continuation-1` });
							if (cancelledJob.cancelled !== true || cancelledJob.status !== "cancelled") {
								throw new Error(`background child cancellation was not confirmed: ${String(cancelledJob.status ?? "unknown")}`);
							}
						}
						const cancelled = { ...session, version: Number(session.version) + 1, status: "cancelled" as ResearchSessionStatus,
							reconciliation_status: "not_applicable", cancelledAt: new Date().toISOString(), recordedAt: new Date().toISOString() };
						append("auto-research-sessions.jsonl", cancelled);
						return { content: [{ type: "text", text: JSON.stringify({ format: "auto-research-session-v1",
							session_ref: `research_session:${sessionId}@v${cancelled.version}`, status: cancelled.status }) }], details: cancelled };
					}
					const runId = String(session.run_id ?? "");
					const progress = readResearchRecords(root, "subagent-progress.jsonl")
						.filter((item) => !runId || String(item.progress_id ?? "") === runId || String(item.progress_id ?? "").startsWith(`${runId}:`)).at(-1)
						?? readJsonObject(join(root, "task-context-cache", "auto-research-broker", `${runId}.json`)) ?? null;
					const report = readResearchRecords(root, "auto-research-reports.jsonl").find((item) => item.run_id === runId) ?? null;
					const authoringHandoffs = readResearchRecords(root, "parent-authoring-handoffs.jsonl")
						.filter((item) => item.source?.research_run_ref === `research_run:${runId}@v1`);
					const inspected = { format: "auto-research-session-v1", session_ref: `research_session:${sessionId}@v${session.version}`,
						status: session.status, interaction_mode: session.interaction_mode ?? "blocking", reconciliation_status: session.reconciliation_status ?? "not_applicable",
						failure_code: session.failure_code ?? null, error: session.error ?? null,
						checkpoint: session.checkpoint ?? null, progress, report, parent_authoring_handoffs: authoringHandoffs };
					return { content: [{ type: "text", text: JSON.stringify(inspected) }], details: inspected };
				}
				const admission = admitTaskLocalOperation("auto_research");
				if (admission) return admission;
				if (action === "start" && params.node_id && !params.plan_ref) {
					const plan = resolvePlan(undefined);
					params.plan_ref = `research_plan:${plan.plan_id}@v${plan.version}`;
				}
				let openAllocation = false;
				if (["start", "resume"].includes(action) && params.research_handoff_ref) {
					const records = readResearchRecords(root,"auto-research-handoffs.jsonl");
					const updates = reconcileResearchHandoffs(records,readResearchRecords(root,"auto-research-sessions.jsonl"),readResearchRecords(root,"auto-research-reports.jsonl"));
					for (const update of updates) append("auto-research-handoffs.jsonl",update);
					const handoff = resolveResearchHandoff(
						[...records,...updates],
						params.research_handoff_ref,
						action === "resume" ? ["pending","failed"] : ["proposed","failed"],
					);
					params.research_handoff_ref = researchHandoffReference(handoff);
					if (action === "resume" && !params.session_ref) params.session_ref = handoff.session_ref;
					params = applyResearchHandoff(params, handoff) as typeof params;
				}
				if (action === "start" && !params.question && !params.plan_ref && !params.session_ref
					&& !params.research_candidate_ref && !params.research_handoff_ref) {
					openAllocation = true;
					params.question = "Choose and investigate one high-value bounded question for this research topic. Use the durable history and this topic's prior agenda when present. Compare alternatives, preserve exact references, and report one useful step.";
					params.scope = params.scope ?? "research_method";
					params.research_kind = params.research_kind ?? "capability";
					params.constraints = [...new Set([
						"Choose a question from the topic agenda or history catalog; do not treat a prior conclusion as mandatory.",
						"Read only evidence needed for the chosen question and return research_progress even without an immediate parent decision.",
						...(params.current_concern ? [`Optional parent concern: ${params.current_concern}.`] : []),
						...(params.constraints ?? []),
					])];
				}
				if (action === "resume" && !params.session_ref) {
					const session = selectControlTarget(latestControlRecords(readResearchRecords(root,"auto-research-sessions.jsonl"),"session_id").filter(row => ["pending","failed"].includes(row.status)),"session_id");
					params.session_ref = `research_session:${session.session_id}@v${session.version}`;
				}
				let boundPlan: ResearchPlan | undefined;
				let boundNodeId: string | undefined;
				const transitionBoundNode = (status: ResearchNodeStatus, patch: Record<string, unknown> = {}) => {
					if (!boundPlan || !boundNodeId) return;
					const current = latestResearchPlan(root, boundPlan.plan_id) ?? boundPlan;
					boundPlan = persistPlan(transitionResearchNode(current, boundNodeId, status, patch));
				};
				if (action === "start" && params.plan_ref) {
					boundPlan = resolvePlan(params.plan_ref);
					const view = researchPlanView(boundPlan);
					boundNodeId = String(selectControlTarget(params.node_id ? boundPlan.nodes : boundPlan.nodes.filter(node => view.runnable_node_ids.includes(node.node_id)),"node_id",params.node_id).node_id);
					const node = view.nodes[boundNodeId] as Record<string, any> | undefined;
					if (!node) throw new Error(`unknown research plan node: ${boundNodeId}`);
					if (!view.runnable_node_ids.includes(boundNodeId) || Number(view.available_slots ?? 0) < 1) {
						const pending = { format: "auto-research-queued-v1", plan_ref: view.plan_ref,
							node_id: boundNodeId, status: Number(view.available_slots ?? 0) < 1 ? "pending" : node.status,
							wait_reason: Number(view.available_slots ?? 0) < 1 ? "concurrency" : node.wait_reason };
						return { content: [{ type: "text", text: JSON.stringify(pending) }], details: pending };
					}
					params.question = node.question;
					params.scope = node.scope ?? params.scope;
					params.research_kind = node.research_kind ?? params.research_kind;
					// Goal and completion contract belong to current_node, not a
					// second prose copy in the caller's constraints.
					params.constraints = [...(node.constraints ?? params.constraints ?? [])];
					params.evidence_refs = node.evidence_refs ?? params.evidence_refs;
					const dependencyResultRefs = (boundPlan.nodes ?? [])
						.filter((candidate) => node.depends_on.includes(candidate.node_id))
						.map((candidate) => candidate.result_ref).filter(Boolean);
					params.resource_refs = [...new Set([
						...(node.resource_refs ?? params.resource_refs ?? []), ...dependencyResultRefs,
					])];
					params.context_window = node.context_window ?? params.context_window;
					boundPlan = persistPlan(transitionResearchNode(boundPlan, boundNodeId, "active"));
				}
				const alreadyActive = (params as any).__background_claimed === true;
				let priorSession: Record<string, any> | undefined;
				if (action === "resume") {
					const requested = String(params.session_ref ?? "");
					const requestedRef = researchSessionReference(requested);
					const sessionId = requestedRef.sessionId;
					if (!sessionId) throw new Error("resume requires session_ref");
					priorSession = latestResearchSession(root, sessionId);
					if (!priorSession) throw new Error(`unknown research session: ${requested}`);
					if (priorSession.worker_id && !(params as any).__worker) {
						throw new Error("Assigned sessions are resumed by their authorized worker. Inspect workers or revoke the exact worker_ref; create a new bounded assignment to change its authorization.");
					}
					if (requestedRef.version !== undefined && requestedRef.version !== Number(priorSession.version)) {
						throw new Error(`research session version conflict: expected v${requestedRef.version}, current v${priorSession.version}`);
					}
					if ((!alreadyActive && !["pending", "failed"].includes(String(priorSession.status)))
						|| (alreadyActive && priorSession.status !== "active")) {
						throw new Error(`research session is not resumable: ${priorSession.status}`);
					}
				}
				const sessionId = priorSession?.session_id ?? `research-session-${++researchSessionCounter}`;
				const nativeChildSessionId = String(priorSession?.native_child_session_id ?? randomUUID());
				const runId = alreadyActive ? String(priorSession?.run_id ?? "") : `auto-research-${++researchRunCounter}`;
				if (!runId) throw new Error("background research resume lost its durable run id");
				const requestTopicRef = params.research_line_ref ?? priorSession?.research_line_ref ?? null;
				params.research_line_ref ??= priorSession?.research_line_ref ?? `research_line:${runId}@v1`;
				const question = String(params.question ?? priorSession?.question ?? "").trim();
				const researchScope = String(params.scope ?? priorSession?.scope ?? "unspecified");
				const researchKind = String(params.research_kind ?? priorSession?.research_kind ?? params.research_problem?.kind ?? "capability");
				const interactionMode = (alreadyActive ? "non_blocking" : String(params.interaction_mode ?? priorSession?.interaction_mode ?? "blocking")) as ResearchInteractionMode;
				if (!["blocking", "non_blocking"].includes(interactionMode)) throw new Error(`unsupported interaction_mode: ${interactionMode}`);
				if (!question) throw new Error("start requires question; resume may inherit it from session_ref");
				const requestSignature = priorSession?.request_signature ?? researchRequestIdentity(root, {
					...params, question, scope: researchScope, research_kind: researchKind, research_line_ref: requestTopicRef });
				if (action === "start" && !openAllocation && !boundPlan && !params.review_reason?.trim()) {
					const reusable = readResearchRecords(root, "auto-research-runs.jsonl")
						.filter(r => r.status === "completed" && r.request_signature === requestSignature).at(-1);
					if (reusable) {
						const existing = readResearchRecords(root, "auto-research-reports.jsonl").find(r => r.run_id === reusable.run_id);
						const receipt = { format: "auto-research-reused-v1", status: "completed", started: false, reused: true,
							question: reusable.question, scope: reusable.scope,
							resource_ref: `research_run:${reusable.run_id}@v1`, report_ref: reusable.report_ref,
							summary: String(reusable.summary ?? "").slice(0, 500), limitations: (existing?.report?.limitations ?? []).slice(0, 3),
							continuation: existing?.report ? researchActionContinuation(existing.report, reusable.report_ref,
								readResearchRecords(root, "execution-observations.jsonl"), existing.recordedAt) : undefined,
							gap: "No changed question, parent premise or evidence. Supply review_reason for an independent check or new analysis method; this receipt is not new evidence." };
						return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
					}
				}
				openAllocation = openAllocation || priorSession?.open_allocation === true;
			const previousAgenda = openAllocation ? latestAutoResearchAgenda(root, String(params.research_line_ref ?? "")) : undefined;
			const otherTopicIndex = openAllocation
				? researchTopicIndex(root, 0, 3, String(params.research_line_ref ?? "")) : undefined;
				// Every bounded invocation records its evidence cursor, including
				// explicitly named questions. Only open allocation receives the catalog.
				const historyCatalog = buildAutoResearchHistoryCatalog(root, previousAgenda?.history_cursor ?? {});
				// Page coverage and read signatures are restored by the child runtime,
				// not reasoning instructions. Keep them out of the provider prompt.
				const checkpointPrompt = (checkpoint: Record<string, unknown>) => {
					// Runtime-only page coverage and provider partial output are already
					// durable and the native Pi session retains its prior assistant turn.
					// Reinjecting either duplicates context and can turn one length
					// continuation into a larger request than the original research turn.
					const { evidence_progress, partial_output, ...semanticState } = checkpoint;
					return semanticState;
				};
				// Restore the work-unit identity on resume, without changing scheduling.
				const taskPlan = boundPlan ?? (priorSession?.plan_id
					? latestResearchPlan(root, String(priorSession.plan_id)) : undefined);
				const taskNode = taskPlan?.nodes.find((node) => node.node_id === (boundNodeId ?? priorSession?.plan_node_id));
			const strategyIndex = taskStrategyIndex(readTaskStrategyState(root));
			materializeStrategyCandidates(root);
			const buildTask = (checkpoint: Record<string, unknown> | undefined, continuationAttempt: number) => continuationAttempt > 1 ? {
					goal: "Complete the existing research turn from the native session and call submit_research_report. Preserve uncertainty; submit unresolved or inconclusive if the existing evidence does not support a method.",
					constraints: [
						"Do not restart the analysis or repeat the prior workset; it remains in this native session.",
						"Use task_resource only for a specific missing fact needed by the final claim.",
					],
					current_node: taskNode ? {
						node_id: taskNode.node_id,
						completion_contract: taskNode.completion_contract,
					} : null,
					research_state: { scope: researchScope, research_kind: researchKind,
						review_reason: params.review_reason ?? null,
						research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						session_id: sessionId, action, continuation_attempt: continuationAttempt,
						open_allocation: openAllocation, ...(authoringMethodRef ? { authoring_method_ref: authoringMethodRef } : {}),
						completion_mode: checkpoint?.report_submission_error
							? "repair_report_submission" : "converge_to_report" },
					research_checkpoint: checkpoint ? checkpointPrompt(checkpoint) : null,
					cross_context_comparison: {
						format: "auto-research-cross-context-continuation-v1",
						selected_evidence_refs: comparison.selected_evidence_refs ?? [],
						canonical_access: "task_resource",
					},
				} : {
					goal: question,
					constraints: params.constraints ?? priorSession?.constraints ?? [],
					current_node: taskNode ? {
						node_id: taskNode.node_id, plan_goal: taskPlan!.goal,
						completion_contract: taskNode.completion_contract,
						dependencies: taskPlan!.nodes.filter((node) => taskNode.depends_on.includes(node.node_id))
							.map((node) => ({ node_id: node.node_id, status: node.status, result_ref: node.result_ref })),
					} : null,
					research_state: { scope: researchScope, research_kind: researchKind,
						research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						...((params as any).__worker ? { worker: (params as any).__worker } : {}),
						session_id: sessionId, action, continuation_attempt: continuationAttempt,
						open_allocation: openAllocation,
						review_reason: params.review_reason ?? null,
						...(otherTopicIndex ? { other_topic_count: otherTopicIndex.total } : {}),
						current_concern: params.current_concern ?? priorSession?.current_concern ?? null,
						completion_mode: checkpoint?.report_submission_error
							? "repair_report_submission"
							: continuationAttempt > 1 ? "converge_to_report" : "open_research" },
					research_checkpoint: checkpoint ? checkpointPrompt(checkpoint) : null,
					...(openAllocation ? { research_agenda: previousAgenda ?? null,
						competing_research_agendas: otherTopicIndex?.topics ?? [], history_catalog: historyCatalog } : {}),
					cross_context_comparison: crossContextComparisonForChild(comparison),
				};
				const definition: AgentDefinition = {
					agent_id: "ephemeral-auto-research", name: "auto-research", version: 1, status: "active",
					description: "Clean-context Auto-Research worker", instructions: "Follow the Auto-Research child protocol and return a structured report.",
					tools: defaultTools, file: "", basis_refs: [], recordedAt: new Date().toISOString(),
				};
				const inheritedRefs = [...new Set([
					...(params.resource_refs ?? priorSession?.resource_refs ?? []),
					...(params.inherit_harness_refs ?? []),
			])];
				const evidenceRefs = [...new Set([
					...(action === "resume" ? priorSession?.evidence_refs ?? [] : []),
					...(params.evidence_refs ?? []),
				])];
				const comparison = buildCrossContextComparison({
					researchLineRef: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
					observations: readResearchRecords(root, "execution-observations.jsonl"),
					explicitEvidenceRefs: evidenceRefs,
					reports: readResearchRecords(root, "auto-research-reports.jsonl"),
					methods: readResearchRecords(root, "task-method-lifecycle.jsonl"),
				});
				const comparisonCardRefs = new Set((comparison.evidence_cards ?? [])
					.map((card: Record<string, any>) => String(card.observation_ref ?? "")).filter(Boolean));
				const selectedComparisonRefs = (comparison.selected_evidence_refs ?? []).map(String).filter(Boolean);
				const cardsCoverSelectedEvidence = selectedComparisonRefs.length > 0
					&& selectedComparisonRefs.every((reference: string) => comparisonCardRefs.has(reference));
				// Exact action cards cover the selected historical actions, not the
				// full scene needed for goal inference. Retain already-authorized
				// immutable state readers; only the broader trajectory is redundant.
				if (cardsCoverSelectedEvidence) definition.tools = defaultTools.filter(
					name => (adapter.stateSnapshotTools ?? []).includes(name));
				append("auto-research-comparison-bundles.jsonl", {
					...comparison, session_id: sessionId, run_id: runId,
					adapter_tools: definition.tools,
					adapter_tools_omitted_for_exact_comparison: cardsCoverSelectedEvidence,
					state_reader_retained_for_scene_evidence: cardsCoverSelectedEvidence && definition.tools.length > 0,
				});
				const contextWindow = await withPublishedStateSnapshot(adapter, compactContextWindow(
					root,
					(params.context_window ?? { include_checkpoint: true, max_chars: 2000 }) as AutoResearchContextWindow,
				), definition.tools);
				const resolvedContextWindow = contextWindow && typeof contextWindow === "object"
					? contextWindow
					: undefined;
				// Selected observations already appear as compact exact-ref evidence
				// cards in cross_context_comparison. Avoid injecting the same large
				// excerpts again. Their canonical bodies remain granted below and can
				// still be paged when a card lacks a detail needed for semantic judgment.
				const cardRefs = comparisonCardRefs;
				const deduplicatedContextWindow = cardRefs.size && Array.isArray(resolvedContextWindow?.recent_observations)
					? { ...resolvedContextWindow,
						recent_observations: cardsCoverSelectedEvidence ? []
							: resolvedContextWindow.recent_observations.filter((item: Record<string, any>) =>
								!cardRefs.has(String(item.observation_id ?? ""))),
						comparison_card_deduplication: {
							removed_observation_refs: resolvedContextWindow.recent_observations
								.filter((item: Record<string, any>) => cardsCoverSelectedEvidence
									|| cardRefs.has(String(item.observation_id ?? "")))
								.map((item: Record<string, any>) => String(item.observation_id ?? "")).filter(Boolean),
							omission_scope: cardsCoverSelectedEvidence
								? "all_recent_observations_outside_exact_comparison"
								: "duplicate_card_observations",
							canonical_access: "task_resource",
						},
					} : resolvedContextWindow;
				// Object spread above excludes the out-of-band immutable ARC cutoffs.
				if (deduplicatedContextWindow && deduplicatedContextWindow !== resolvedContextWindow
					&& resolvedContextWindow) {
					for (const key of ["__publishedStateSnapshot", "__publishedTrajectoryRef"]) {
						const descriptor = Object.getOwnPropertyDescriptor(resolvedContextWindow, key);
						if (descriptor) Object.defineProperty(deduplicatedContextWindow, key, descriptor);
					}
				}
				const contextRefs = params.context_window?.context_refs ?? [];
				const candidateIds = new Set((strategyIndex?.candidates ?? []).map((c: Record<string, any>) => c.id));
				const latestTests = new Map<string, Record<string, any>>();
				for (const r of taskRecords(root, "validation")) if (r.experiment && candidateIds.has(r.source_hypothesis_id)) latestTests.set(r.validation_id, r);
				const selectedTests = [...latestTests.values()].filter(r => r.experiment.status === "open")
					.concat([...latestTests.values()].filter(r => r.experiment.status !== "open").slice(-2));
				const childResourceRefs = [...new Set([
					...inheritedRefs, ...contextRefs, ...(comparison.selected_evidence_refs ?? []),
					...(comparison.pre_action_state_refs ?? []),
					...(strategyIndex?.candidates ?? []).map((c: Record<string, any>) => `strategy_candidate:${c.id}@v${c.version ?? 1}`),
					...selectedTests.flatMap(r => [`validation:${r.validation_id}@v${r.version}`,
						...r.experiment.samples.slice(-1).map((s: Record<string, any>) => s.ref)]),
				].map(normalizeChildResourceRef))];
				const startedAt = new Date().toISOString();
				let continuationCheckpoint = (priorSession?.checkpoint ?? (params as any).__worker_checkpoint) as Record<string, unknown> | undefined;
				let activeVersion = alreadyActive ? Number(priorSession?.version ?? 1) : Number(priorSession?.version ?? 0) + 1;
				if (!alreadyActive) {
					if (action === "resume" && priorSession) {
						const claimed = claimResearchSession(priorSession, runId, evidenceRefs);
						activeVersion = Number(claimed.version);
					} else {
						append("auto-research-sessions.jsonl", { session_id: sessionId, version: activeVersion, status: "active" as ResearchSessionStatus,
							request_signature: requestSignature,
							interaction_mode: interactionMode, question, scope: researchScope, research_kind: researchKind,
							research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
							...((params as any).__worker ? { worker_id: (params as any).__worker.worker_id } : {}),
							research_candidate_ref: params.research_candidate_ref ?? priorSession?.research_candidate_ref ?? null,
							research_handoff_ref: params.research_handoff_ref ?? priorSession?.research_handoff_ref ?? null,
							constraints: params.constraints ?? priorSession?.constraints ?? [], evidence_refs: evidenceRefs, resource_refs: inheritedRefs,
							open_allocation: openAllocation, ...(authoringMethodRef ? { authoring_method_ref: authoringMethodRef } : {}),
							current_concern: params.current_concern ?? priorSession?.current_concern ?? null,
							history_cursor: historyCatalog?.cursor ?? priorSession?.history_cursor ?? null,
							run_id: runId, native_child_session_id: nativeChildSessionId, reconciliation_status: "not_applicable",
							...(boundPlan && boundNodeId ? { plan_id: boundPlan.plan_id, plan_node_id: boundNodeId } : {}),
							recordedAt: startedAt });
					}
				}
				const terminalVersion = activeVersion + 1;
				if (interactionMode === "non_blocking") {
					try {
						if (continuationCheckpoint) {
							const checkpointPath = join(root, "task-context-cache", "auto-research-checkpoints", `${sessionId}.json`);
							mkdirSync(dirname(checkpointPath), { recursive: true });
							const temporary = `${checkpointPath}.tmp`;
							writeFileSync(temporary, JSON.stringify({ ...continuationCheckpoint,
								status: "active", pause_reason: null, wait_for: null }) + "\n", "utf8");
							renameSync(temporary, checkpointPath);
						}
						await runChildPi(
							root, definition, adapter, buildTask(continuationCheckpoint, 1), evidenceRefs, childResourceRefs, undefined,
							deduplicatedContextWindow, true, runId, sessionId, `${runId}:continuation-1`, nativeChildSessionId,
							researchScope, interactionMode, true,
							openAllocation ? autoResearchHistoryGrants() : [],
						);
					} catch (error) {
						failDetachedSession(latestResearchSession(root, sessionId)!, "background_enqueue_failed",
							error instanceof Error ? error.message : String(error));
						throw error;
					}
					const accepted = { format: "auto-research-accepted-v1", accepted: true,
						session_ref: `research_session:${sessionId}@v${activeVersion}`, run_id: runId,
						research_handoff_ref: params.research_handoff_ref ?? priorSession?.research_handoff_ref ?? null,
						research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						status: "active", interaction_mode: interactionMode };
					return { content: [{ type: "text", text: JSON.stringify(accepted) }], details: accepted };
				}
				let result: Record<string, unknown>;
				let continuationAttempt = 0;
				let stagnantContinuationCount = 0;
				const maxStagnantContinuations = Math.max(1,
					Math.floor(Number(process.env.PI_AUTORESEARCH_MAX_STAGNANT_CONTINUATIONS ?? 3) || 3));
				const cumulativeUsage: Record<string, any> = {
					input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
				const accumulateUsage = (value: unknown) => {
					const usage = value && typeof value === "object" ? value as Record<string, any> : {};
					for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
						cumulativeUsage[key] += Number(usage[key] ?? 0);
					}
					const cost = usage.cost && typeof usage.cost === "object" ? usage.cost : {};
					for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
						cumulativeUsage.cost[key] += Number(cost[key] ?? 0);
					}
				};
				try {
					while (true) {
						continuationAttempt += 1;
						// Preserve semantic state and evidence coverage across processes. Only
						// reset the pause marker; the child reloads this durable checkpoint.
						const staleCheckpoint = join(root, "task-context-cache", "auto-research-checkpoints", `${sessionId}.json`);
						if (continuationCheckpoint) {
							mkdirSync(dirname(staleCheckpoint), { recursive: true });
							const temporary = `${staleCheckpoint}.tmp`;
							writeFileSync(temporary, JSON.stringify({ ...continuationCheckpoint, status: "active", pause_reason: null }) + "\n", "utf8");
							renameSync(temporary, staleCheckpoint);
						}
						result = await runChildPi(
							root, definition, adapter, buildTask(continuationCheckpoint, continuationAttempt),
							evidenceRefs, childResourceRefs, signal,
							deduplicatedContextWindow, true, runId, sessionId, `${runId}:continuation-${continuationAttempt}`,
							nativeChildSessionId, researchScope, interactionMode,
							false, openAllocation ? autoResearchHistoryGrants() : [],
						);
						accumulateUsage(result.usage);
						const stopReason = String(result.stop_reason ?? "unknown");
						const generatedCheckpoint = result.checkpoint && typeof result.checkpoint === "object"
							? result.checkpoint as Record<string, unknown> : undefined;
						const progress = compareResearchProgress(continuationCheckpoint, generatedCheckpoint);
						if (["length", "checkpointed"].includes(stopReason)) {
							stagnantContinuationCount = progress.advanced ? 0 : stagnantContinuationCount + 1;
						}
						append("auto-research-continuations.jsonl", {
							format: "auto-research-continuation-v1", run_id: runId, session_id: sessionId,
							native_session_id: nativeChildSessionId,
							attempt: continuationAttempt, stop_reason: stopReason,
							checkpoint: generatedCheckpoint ?? null, usage: result.usage ?? {},
							cumulative_usage: JSON.parse(JSON.stringify(cumulativeUsage)),
							progress_ref: result.progress_ref ?? "subagent-progress.jsonl",
							progress_id: result.progress_id ?? `${runId}:continuation-${continuationAttempt}`,
							progress_status: progress.advanced ? "advanced" : "stalled",
							stagnant_continuations: stagnantContinuationCount,
							recordedAt: new Date().toISOString(),
						});
						if (!["length", "checkpointed"].includes(stopReason)) break;
						if (stagnantContinuationCount >= maxStagnantContinuations) {
							const conclusion = `Research stopped after ${stagnantContinuationCount} consecutive output-length continuations without a semantic checkpoint advance.`;
							result = { ...result, stop_reason: "stalled", text: JSON.stringify({
								format: "auto-research-report-v1", status: "inconclusive", conclusion,
								findings: [], evidence_refs: generatedCheckpoint?.evidence_refs ?? evidenceRefs,
								alternatives: [], limitations: [
									"The provider repeatedly exhausted its output allowance before producing a structured conclusion.",
									"No semantic checkpoint advance was observed; completed tool output and durable checkpoint state remain available by reference.",
								],
								validation_plan: "Replan or split the current research node before resuming; do not replay the same continuation unchanged.",
								method_candidates: [],
							}) };
							break;
						}
						continuationCheckpoint = generatedCheckpoint ?? continuationCheckpoint;
					}
					result.usage = cumulativeUsage;
				} catch (error) {
					if (latestResearchSession(root, sessionId)?.status === "cancelled") {
						transitionBoundNode("skipped", { wait_reason: "cancelled" });
						return { content: [{ type: "text", text: JSON.stringify({ format: "auto-research-result-v1",
							session_ref: `research_session:${sessionId}@v${latestResearchSession(root, sessionId)?.version}`,
							status: "cancelled", run_id: runId }) }], details: { status: "cancelled", run_id: runId } };
					}
					const failureRef = `research_run:${runId}@v1`;
					append("auto-research-runs.jsonl", { run_id: runId, version: 1, session_id: sessionId, status: "failed", question,
						scope: researchScope, research_kind: researchKind,
						open_allocation: openAllocation,
						research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						evidence_refs: evidenceRefs, resource_refs: inheritedRefs,
						inherited_harness_refs: params.inherit_harness_refs ?? [], context_window: contextWindow,
						toolCallId, startedAt, completedAt: new Date().toISOString(),
						progress_ref: "subagent-progress.jsonl", progress_id: `${runId}:continuation-${continuationAttempt}`,
						continuation_attempts: continuationAttempt, cumulative_usage: cumulativeUsage,
						error: error instanceof Error ? error.message : String(error),
						summary: "Auto-Research child failed before producing a structured report.",
					});
					append("auto-research-sessions.jsonl", { session_id: sessionId, version: terminalVersion, status: "failed", question, scope: researchScope,
						interaction_mode: interactionMode, reconciliation_status: "not_applicable",
						research_kind: researchKind, research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						research_handoff_ref: params.research_handoff_ref ?? priorSession?.research_handoff_ref ?? null,
						constraints: params.constraints ?? priorSession?.constraints ?? [],
						open_allocation: openAllocation,
						current_concern: params.current_concern ?? priorSession?.current_concern ?? null,
						history_cursor: historyCatalog?.cursor ?? priorSession?.history_cursor ?? null,
						evidence_refs: evidenceRefs, resource_refs: inheritedRefs,
						run_id: runId, native_child_session_id: nativeChildSessionId, recordedAt: new Date().toISOString() });
					transitionBoundNode("failed", { failure_reason: error instanceof Error ? error.message : String(error) });
					throw new Error(`Auto-Research failed; inspect ${failureRef} with task_resource before retrying: ${error instanceof Error ? error.message : String(error)}`);
				}
				const reportText = String(result.text ?? "");
				if (result.stop_reason === "paused") {
					const generatedCheckpoint = result.checkpoint as Record<string, unknown> | undefined;
					const checkpoint = generatedCheckpoint ?? {
						format: "auto-research-checkpoint-v1", session_id: sessionId, status: "pending",
						cursor: "agent-requested-pause", evidence_refs: evidenceRefs,
						selected_resource_refs: inheritedRefs, unresolved_questions: [], draft_findings: [],
						next_step: "Resume this research session when the declared condition is satisfied.",
						pause_reason: "agent_requested_pause",
						wait_for: "manual_resume", resume_condition: "manual_resume",
						evidence_audit: {
							format: "research-evidence-audit-v1",
							status: [...new Set([...inheritedRefs, ...evidenceRefs])].length ? "partial" : "no_selected_refs",
							required_refs: [...new Set([...inheritedRefs, ...evidenceRefs])],
							complete_refs: [],
							incomplete_refs: [...new Set([...inheritedRefs, ...evidenceRefs])],
							read_count: 0, repeated_read_count: 0, review_checkpoint_count: 0, threshold_reached: false,
						},
						recordedAt: new Date().toISOString(),
					};
					const waitFor = ["next_parent_evidence", "manual_resume"].includes(String(checkpoint.wait_for))
						? String(checkpoint.wait_for) : "manual_resume";
					const evidenceCursor = canonicalEvidenceSnapshot(root);
					const environmentCursor = parentEvidenceSnapshot(root);
					const runtimeCheckpoint = { ...checkpoint, status: "pending", wait_for: waitFor,
						after_evidence_sequence: evidenceCursor.sequence, after_evidence_refs: evidenceCursor.refs,
						after_environment_sequence: environmentCursor.sequence, after_environment_refs: environmentCursor.refs,
						recorded_at: new Date().toISOString() };
					const sessionRecord = { session_id: sessionId, version: terminalVersion, status: "pending" as ResearchSessionStatus, question, scope: researchScope,
						interaction_mode: interactionMode, reconciliation_status: "not_applicable",
						research_kind: researchKind, research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
						research_handoff_ref: params.research_handoff_ref ?? priorSession?.research_handoff_ref ?? null,
						constraints: params.constraints ?? priorSession?.constraints ?? [],
						native_child_session_id: nativeChildSessionId,
						open_allocation: openAllocation,
						current_concern: params.current_concern ?? priorSession?.current_concern ?? null,
						history_cursor: historyCatalog?.cursor ?? priorSession?.history_cursor ?? null,
						run_id: runId, evidence_refs: evidenceRefs, resource_refs: inheritedRefs,
						checkpoint: runtimeCheckpoint, cursor: runtimeCheckpoint.cursor ?? null, recordedAt: new Date().toISOString() };
					append("auto-research-sessions.jsonl", sessionRecord);
					append("auto-research-runs.jsonl", { run_id: runId, version: 1, session_id: sessionId, status: "pending", question,
						scope: researchScope, research_kind: researchKind, research_line_ref: sessionRecord.research_line_ref,
						open_allocation: openAllocation,
						evidence_refs: sessionRecord.evidence_refs,
						resource_refs: inheritedRefs, checkpoint: runtimeCheckpoint, result_summary: { stop_reason: result.stop_reason ?? "paused", usage: result.usage ?? {},
							provider: result.provider ?? null, model: result.model ?? null, event_count: result.event_count ?? 0,
							adapter_id: result.adapter_id ?? adapter.adapterId, progress_ref: result.progress_ref ?? "subagent-progress.jsonl", progress_id: result.progress_id ?? runId },
						startedAt, completedAt: new Date().toISOString(), summary: "Research paused; no conclusion was declared." });
					transitionBoundNode("pending", { wait_reason: "child_pending", session_ref: `research_session:${sessionId}@v${sessionRecord.version}` });
					return { content: [{ type: "text", text: JSON.stringify({ format: "auto-research-result-v1", resource_ref: `research_session:${sessionId}@v${sessionRecord.version}`, session_ref: `research_session:${sessionId}@v${sessionRecord.version}`, run_id: runId, status: "pending", question, checkpoint: runtimeCheckpoint, adoption: "Pending research is not complete and no proposal was applied." }) }], details: { resource_ref: `research_session:${sessionId}@v${sessionRecord.version}`, session_ref: `research_session:${sessionId}@v${sessionRecord.version}`, run_id: runId, status: "pending", question, report_summary: "Research is pending without a conclusion.", proposal_count: 0 } };
				}
				// submit_research_report persists the schema-checked read-only research
				// body. Prefer it over provider prose so the parent receives the exact
				// findings/method candidates the child submitted.
				const submittedReport = readJsonObject(join(root, "task-context-cache", "auto-research-child-results", `${runId}.json`));
				const parsedReport = submittedReport && Object.keys(submittedReport).length
					? submittedReport : parseAutoResearchReport(reportText);
				const report = auditResearchConfidence(root, bindExperimentRequest(normalizeAutoResearchReport(parsedReport), runId, evidenceRefs));
				const selectedAuditRefs = [...new Set([...evidenceRefs, ...inheritedRefs]
					.filter((ref) => /^(memory|skill|tool|subagent|finding|context):/.test(String(ref))))];
				const evidenceAudit = result.evidence_audit ?? (selectedAuditRefs.length ? {
					format: "research-evidence-audit-v1", status: "partial", required_refs: selectedAuditRefs,
					complete_refs: [], incomplete_refs: selectedAuditRefs, read_count: 0,
					repeated_read_count: 0, review_checkpoint_count: 0, threshold_reached: false,
				} : { format: "research-evidence-audit-v1", status: "no_selected_refs", required_refs: [], complete_refs: [], incomplete_refs: [], read_count: 0, repeated_read_count: 0, review_checkpoint_count: 0, threshold_reached: false });
				const reportStatus = parsedReport.status === "unstructured_report" ? "invalid_report" : "completed";
				const reportRef = `research_report:${runId}@v1`;
				const authoringHandoffs = buildParentAuthoringHandoffs({ runId, reportRef,
					researchLineRef: params.research_line_ref ?? priorSession?.research_line_ref ?? undefined, report });
				for (const handoff of authoringHandoffs) append("parent-authoring-handoffs.jsonl", handoff);
				// Research results must remain actionable after the completion receipt is
				// compacted. Persist one resumable conversion intent per method candidate.
				// This is a parent-owned queue entry, never a component mutation: the
				// parent still reads the matching creator, authors the complete candidate,
				// explicitly assembles its exact version, and performs the semantic trial.
				for (const candidate of report.method_candidates ?? []) {
					const handoff = authoringHandoffs.find((item: Record<string, any>) =>
						String(item.source?.method_candidate_ref ?? "") === String(candidate.candidate_ref ?? ""));
					const carrier = ({ procedure: "skill", computation: "tool", role: "subagent", plan: "system_prompt" } as Record<string, string>)[String(candidate.semantic_kind ?? "")];
					if (!carrier) continue;
					// Keep a stable identity separate from the human-facing operation id.
					// The inspect path de-duplicates conversion intents by intent_id; the
					// old research writer omitted it, so all method candidates with an
					// undefined key collapsed into one entry and most high-order
					// opportunities disappeared after a research turn/restart.
					const candidateRef = String(candidate.candidate_ref ?? candidate.name ?? "candidate");
					const intentId = `research:${runId}:${candidateRef}`;
					append("task-harness-conversion-intents.jsonl", {
						format: "task-harness-conversion-intent-v1",
						intent_id: intentId,
						operation_id: intentId,
						status: "awaiting_parent_authoring",
						carrier, semantic_kind: candidate.semantic_kind,
						purpose: candidate.summary || candidate.name,
						candidate_ref: candidate.candidate_ref, candidate_name: candidate.name,
						method_candidate: candidate,
						research_run_ref: `research_run:${runId}@v1`, report_ref: reportRef,
						authoring_handoff_ref: handoff?.resource_ref ?? null,
						next_step: handoff?.change_call_template?.required_before_execution ?? ["Read the matching creator and author a complete candidate", "Submit task_harness(action=change)", "Explicitly assemble and semantically trial the exact version"],
						reconsider_when: "at the next parent turn with a reachable semantic use or when the current strategy needs this capability",
						recordedAt: new Date().toISOString(),
					});
				}
				const agendaSession = {
					...(priorSession ?? {}), open_allocation: openAllocation,
					history_cursor: historyCatalog?.cursor ?? priorSession?.history_cursor ?? null,
					research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
				};
				const agenda = persistAgendaFromReport(agendaSession, report, runId, reportRef, new Date().toISOString());
				const parentAttention = !openAllocation || researchReportNeedsParentAttention(report);
				const resultSummary = {
					stop_reason: result.stop_reason ?? null,
					usage: result.usage ?? {},
					provider: result.provider ?? null,
					model: result.model ?? null,
					event_count: result.event_count ?? 0,
					progress_ref: result.progress_ref ?? "subagent-progress.jsonl",
					progress_id: result.progress_id ?? runId,
					adapter_id: result.adapter_id ?? adapter.adapterId,
					continuation_attempts: continuationAttempt,
					stagnant_continuations: stagnantContinuationCount,
				};
				const record = {
					run_id: runId, version: 1, session_id: sessionId, status: reportStatus, question,
					request_signature: requestSignature,
					scope: researchScope, research_kind: researchKind,
					research_line_ref: params.research_line_ref ?? priorSession?.research_line_ref ?? null,
					evidence_refs: evidenceRefs, resource_refs: inheritedRefs,
					inherited_harness_refs: params.inherit_harness_refs ?? [], context_window: contextWindow,
					report_ref: reportRef, finding_count: report.findings.length,
					method_candidate_count: report.method_candidates.length,
					parent_authoring_handoff_count: authoringHandoffs.length,
					route_execution_count: 0,
					evidence_audit: evidenceAudit, result_summary: resultSummary,
					experiment_request: report.experiment_request ?? null,
					planning_implications: report.planning_implications ?? [],
					next_research_question: report.next_research_question ?? "",
					research_progress: report.research_progress ?? null,
					agenda_ref: agenda ? `research_agenda:${agenda.agenda_id}@v${agenda.version}` : null,
					parent_attention: parentAttention,
					open_allocation: openAllocation, ...(authoringMethodRef ? { authoring_method_ref: authoringMethodRef } : {}),
					toolCallId, startedAt,
					continuation_attempts: continuationAttempt,
					completedAt: new Date().toISOString(), summary: String(report.conclusion ?? report.status ?? "completed"),
				};
				append("auto-research-reports.jsonl", {
					run_id: runId, version: 1, status: reportStatus, summary: record.summary,
					research_line_ref: record.research_line_ref, research_kind: record.research_kind,
					experiment_request: record.experiment_request,
					planning_implications: record.planning_implications,
					next_research_question: record.next_research_question,
					research_progress: record.research_progress,
					agenda_ref: record.agenda_ref,
					parent_attention: record.parent_attention,
					report, evidence_audit: record.evidence_audit, recordedAt: record.completedAt,
				});
				for (const methodRecord of methodRecordsFromReport({
					runId, reportRef,
					researchLineRef: record.research_line_ref,
					report, comparison, recordedAt: record.completedAt,
				})) append("task-method-lifecycle.jsonl", methodRecord);
				append("auto-research-runs.jsonl", record);
				const sessionVersion = terminalVersion;
				const reconciliationStatus = authoringHandoffs.length ? "awaiting_parent_authoring" : "not_applicable";
				append("auto-research-sessions.jsonl", { session_id: sessionId, version: sessionVersion, status: "completed", question, run_id: runId,
					request_signature: requestSignature,
					interaction_mode: interactionMode, reconciliation_status: reconciliationStatus,
					research_kind: researchKind, research_line_ref: record.research_line_ref,
					research_candidate_ref: params.research_candidate_ref ?? priorSession?.research_candidate_ref ?? null,
					research_handoff_ref: params.research_handoff_ref ?? priorSession?.research_handoff_ref ?? null,
					native_child_session_id: nativeChildSessionId,
					research_run_ref: `research_run:${runId}@v1`, evidence_refs: record.evidence_refs, scope: record.scope,
					experiment_request: record.experiment_request,
					planning_implications: record.planning_implications,
					next_research_question: record.next_research_question,
					research_progress: record.research_progress,
					agenda_ref: record.agenda_ref,
					parent_attention: record.parent_attention,
					open_allocation: openAllocation,
					current_concern: params.current_concern ?? priorSession?.current_concern ?? null,
					history_cursor: historyCatalog?.cursor ?? priorSession?.history_cursor ?? null,
					summary: record.summary, report_status: record.status, recordedAt: record.completedAt });
				transitionBoundNode("completed", { result_ref: `research_run:${runId}@v1`,
					session_ref: `research_session:${sessionId}@v${sessionVersion}` });
				const sessionRef = `research_session:${sessionId}@v${sessionVersion}`;
				const capsule = buildAutoResearchCapsule({
					runId, sessionRef, status: record.status, scope: record.scope,
					researchLineRef: record.research_line_ref ?? undefined,
					researchProblem: params.research_problem,
					reportRef, report, usage: result.usage as Record<string, any> | undefined,
					parentAuthoringHandoffs: authoringHandoffs,
				});
				(capsule as Record<string, any>).reconciliation_status = reconciliationStatus;
				(capsule as Record<string, any>).parent_authoring_required = authoringHandoffs.length > 0;
				const parentResult = parentAttention || !agenda
					? capsule
					: buildAutoResearchProgressReceipt({
						runId, sessionRef, reportRef,
						agendaRef: `research_agenda:${agenda.agenda_id}@v${agenda.version}`,
						researchLineRef: String(record.research_line_ref),
					});
				return {
					content: [{ type: "text", text: JSON.stringify(parentResult) }],
					details: {
						...resourceMetadata("research_run", record), run_id: runId,
						status: record.status, question: record.question,
						summary: parentAttention ? record.summary : "Cross-stage research progress was saved without an immediate parent decision.",
						report_summary: parentAttention ? record.summary : "Cross-stage research progress was saved without an immediate parent decision.",
						method_candidate_count: report.method_candidates.length,
						parent_attention: parentAttention,
						agenda_ref: record.agenda_ref,
						parent_authoring_handoff_count: authoringHandoffs.length,
						parent_authoring_required: authoringHandoffs.length > 0,
						report_ref: reportRef,
					},
				};
			},
		};
		registerManagementTool(pi, root, autoResearchTool);
		const reconcileCompletion = async (session: Record<string, any>): Promise<Record<string, any> | undefined> => {
			if (session.interaction_mode !== "non_blocking" || session.status !== "completed"
				|| session.completion_delivery_status === "delivered") return undefined;
			let reconciliationStatus = String(session.reconciliation_status ?? "not_applicable");
			const runId = String(session.run_id ?? "");
			const reportRecord = readResearchRecords(root, "auto-research-reports.jsonl")
				.filter((item) => String(item.run_id ?? "") === runId)
				.sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
			const report = reportRecord?.report && typeof reportRecord.report === "object"
				? reportRecord.report as Record<string, any> : reportRecord;
			const parentAttention = session.open_allocation !== true || researchReportNeedsParentAttention(report ?? {});
			const experimentRequest = report?.experiment_request ?? session.experiment_request ?? null;
			const authoringHandoffs = readResearchRecords(root, "parent-authoring-handoffs.jsonl")
				.filter((item) => item.source?.research_run_ref === `research_run:${runId}@v1`);
			if (authoringHandoffs.length) reconciliationStatus = "awaiting_parent_authoring";
			const delivered = { ...session, version: Number(session.version) + 1,
				experiment_request: experimentRequest,
				planning_implications: report?.planning_implications ?? session.planning_implications ?? [],
				next_research_question: report?.next_research_question ?? session.next_research_question ?? "",
				parent_attention: parentAttention,
				reconciliation_status: reconciliationStatus, completion_delivery_status: "delivered",
				completion_delivered_at: new Date().toISOString(), recordedAt: new Date().toISOString() };
			append("auto-research-sessions.jsonl", delivered);
			const agendaRef = String(session.agenda_ref ?? reportRecord?.agenda_ref ?? "");
			if (!parentAttention && agendaRef) {
				return buildAutoResearchProgressReceipt({
					runId,
					sessionRef: `research_session:${session.session_id}@v${delivered.version}`,
					reportRef: String(session.report_ref ?? `research_report:${runId}@v1`),
					agendaRef,
					researchLineRef: String(session.research_line_ref ?? "research_line:task-auto-research-agenda@v1"),
				});
			}
			return {
				format: "auto-research-completion-v1",
				topic_ref: session.research_line_ref ?? null,
				session_ref: `research_session:${session.session_id}@v${delivered.version}`,
				run_id: runId, status: session.status, summary: session.summary,
				report_ref: session.report_ref ?? null, reconciliation_status: reconciliationStatus,
				experiment_request: experimentRequest,
				planning_implications: report?.planning_implications ?? [],
				next_research_question: report?.next_research_question ?? "",
				method_candidate_refs: Array.isArray(report?.method_candidates)
					? report.method_candidates.map((item: Record<string, any>) => item.candidate_ref).filter(Boolean)
					: [],
				parent_authoring_handoffs: authoringHandoffs,
			};
		};
		const pumpWorkers = () => advanceResearchWorkers(root, {
				refresh: async session => { const next = await refreshDetachedSession(session); syncPlanFromSession(next); return next; },
				session: id => latestResearchSession(root, id), execute: autoResearchTool.execute.bind(autoResearchTool),
				integrate: row => {
					const report = row.report; const reportRef = `research_update:${row.update_id}@v${row.version}`;
					if (row.lifecycle === "completed") return; // Final routing already occurs in refreshDetachedSession.
					persistWorkerCandidates(row.run_id, reportRef, row.research_line_ref, report);
				},
			});
		pi.on("tool_execution_end", async event => {
			if (event.isError || !["arc_action", "arc_actions"].includes(event.toolName)) return;
			const env = readResearchRecords(root, "execution-observations.jsonl").at(-1)?.arc_outcome ?? {};
			if (["WIN", "GAME_OVER"].includes(String(env.state)) || (Number(env.action_budget?.total_maximum) > 0
				&& Number(env.action_budget?.total_used) >= Number(env.action_budget?.total_maximum))) await pumpWorkers();
		});
		pi.on("context", async (event) => {
			await pumpWorkers();
			const inbox = deliverResearchIncrements(root);
			if (!inbox.length) return {};
			return { messages: [...event.messages, { role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `AUTO-RESEARCH COMPLETION INBOX (runtime-delivered once): ${JSON.stringify(inbox)}` }] }] };
		});
		pi.on("before_agent_start", async (event) => {
			const latest = new Map<string, Record<string, any>>();
			for (const item of readResearchRecords(root, "auto-research-sessions.jsonl")) {
				const previous = latest.get(String(item.session_id));
				if (!previous || Number(item.version) > Number(previous.version)) latest.set(String(item.session_id), item);
			}
			const completions: Record<string, any>[] = [];
			const notices: Record<string, any>[] = [];
			const queueInbox = (item: Record<string, any>) => { if (notices.length < 1) notices.push(item); };
			for (const original of latest.values()) {
				if (original.worker_id) continue; // Assigned responsibilities own their continuation/delivery.
				let session = await refreshDetachedSession(original);
				syncPlanFromSession(session);
				if (session.status === "pending" && session.checkpoint?.wait_for === "next_parent_evidence") {
						const currentEvidence = parentEvidenceSnapshot(root);
						const newEvidenceRefs = evidenceRefsAfter(currentEvidence, session.checkpoint);
					if (currentEvidence.sequence > Number(session.checkpoint.after_environment_sequence ?? session.checkpoint.after_evidence_sequence ?? currentEvidence.sequence)
						&& newEvidenceRefs.length) {
						const runId = `auto-research-${++researchRunCounter}`;
						const evidenceRefs = [...new Set([...(session.evidence_refs ?? []), ...newEvidenceRefs])];
						session = claimResearchSession(session, runId, evidenceRefs);
						try {
							await autoResearchTool.execute(`auto-research-runtime-resume:${session.session_id}:v${session.version}`, {
								action: "resume", session_ref: `research_session:${session.session_id}@v${session.version}`,
								__background_claimed: true,
							}, undefined);
							queueInbox({ format: "auto-research-resumed-v1",
								session_ref: `research_session:${session.session_id}@v${session.version}`,
								run_id: runId, new_evidence_refs: newEvidenceRefs });
						} catch (error) {
							queueInbox({ format: "auto-research-resume-failed-v1", session_id: session.session_id,
								run_id: runId, error: error instanceof Error ? error.message : String(error) });
						}
					}
				}
				const current = latestResearchSession(root, String(session.session_id)) ?? session;
				const completion = completions.length < 1 ? await reconcileCompletion(current) : null;
				if (completion) completions.push(completion);
			}
			const inbox = [...completions, ...notices].slice(0, 1);
			if (!inbox.length) return {};
			return { systemPrompt: `${event.systemPrompt}\n\nAUTO-RESEARCH COMPLETION INBOX (runtime-delivered once): ${JSON.stringify(inbox)}` };
		});
	}
}
