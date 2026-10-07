/** Task-local harness resources implemented through Pi's public extension APIs. */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactToolSchema } from "./pi_compact_tool_schema.ts";
import { registerManagementTool } from "./pi_management_schema_surface.ts";
import { installHarnessArgumentIntegrity, installHarnessBatchIntegrity } from "./pi_harness_tool_batch.ts";
import { conversionWorkset } from "./pi_harness_conversion_workset.ts";
import { installParentContextControl } from "./pi_parent_context_control.ts";
import { OBSERVATION_COMPACTION_TOOL } from "./pi_agent_owned_observation_compaction.ts";
import { arcDecisionFeedback } from "./pi_arc_decision_feedback.ts";
import { latestArcObservationSnapshot } from "./pi_arc_observation_snapshot.ts";
import { installTaskLocalTools, pureToolInvocationParameters, type TaskToolAdapter } from "./pi_task_local_tools.ts";
import { assertTaskToolName } from "./pi_task_tool_contract.ts";
import { validateTaskPureExpressionInputAccess, validateTaskPureExpressionProgram } from "./pi_task_pure_expression.ts";
import { preparePureExpressionInput } from "./pi_task_pure_expression_host.ts";
import { validateTaskJsonSchema } from "./pi_task_json_schema.ts";
import { admitTaskLocalOperation } from "./pi_task_execution_admission.ts";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { loadPrompt, renderPrompt } from "./prompt_loader.ts";
import { harnessOperatingReference } from "./pi_harness_operating_reference.ts";
import { harnessStateView, harnessStatusSection, harnessStatusSummary } from "./pi_harness_status_views.ts";
import { completedCreatorReadCalls, compactCompletedCreatorRead, DEFAULT_METHOD_PAGE_CHARS, projectBaselineMethodPage } from "./pi_harness_method_history_projection.ts";
import { compactSupersededCandidate, supersededFailedCandidateCalls } from "./pi_harness_candidate_history_projection.ts";
import { capabilityFollowups, carrierPreparation, currentDirectDevelopmentIntents, currentDevelopmentIntents, directDevelopmentFollowups, projectCapabilityFollowupQueue } from "./pi_harness_capability_followup.ts";
import { baselineMethodCatalog, readBaselineMethod, BASELINE_AUTHORING_GUIDANCE, creatorCandidateTemplate, creatorForHarnessKind, researchAuthoringPrerequisite } from "./pi_harness_baseline_methods.ts";
import { memoryValidityContext, normalizeMemoryValidity, type MemoryValidity, type MemoryValidityContext } from "./pi_memory_validity.ts";
import { readCurrentTaskCheckpoint } from "./pi_task_checkpoint_reader.ts";
import { researchContinuationCard } from "./pi_auto_research_agenda.ts";
import { buildAutoResearchHistoryCatalog } from "./pi_auto_research_history.ts";
import { assertParentTaskResourceBindingHost, resourceMetadata, resolveTaskResource, taskRecords, versionConflict } from "./pi_task_resource_store.ts";
import {
	nativeHarnessExecutor,
	registerNativeHarnessExecutor,
	registerNativeHarnessRouteApplier,
} from "./pi_task_harness_route_runtime.ts";
import type { ActivationCondition } from "./pi_auto_research_harness_router.ts";
import { assessMethodAbstraction, normalizeMethodSpecification, type ResearchMethodSpecification } from "./pi_auto_research_harness_router.ts";
import { buildPeriodicResearchHandoff, duplicateReviewDirectChangeFallback, harnessLifecycle, methodResearchContract, periodicReviewWindows, periodicReviewQueue, periodicReviewBatch, successfulArcActions, reviewProgress, normalizeHarnessReview, validateTransitionAnalysis, reviewInputContract, reviewRepairContract, REVIEW_COMPONENTS, REVIEW_DISPOSITIONS } from "./pi_harness_review.ts";
import { researchWorkers, routeWorkerEvidence, researchWorkerWindowCoverage } from "./pi_auto_research_workers.ts";
import { controlError, eligibleResearchHandoffStatuses, latestControlRecords, selectControlTarget, stableControlJSON, failureClassification } from "./pi_harness_control.ts";
import { advanceResearchHandoff, reconcileResearchHandoffs, resolveResearchHandoff } from "./pi_auto_research_handoff.ts";
import { coherentMemory, knowledgeRef, knowledgeState, normalizeKnowledgeLinks, promptReceipt,
	type KnowledgeEntry, type KnowledgeLinks } from "./pi_task_knowledge_lifecycle.ts";
import { levelReviewInputContract, levelReviewWindows, validateLevelReview, LEVEL_REVIEW_GUIDANCE } from "./pi_level_retrospective.ts";
import { buildOutcomeCostIndex } from "./pi_outcome_cost_index.ts";
import {
	advanceMethodApplication, advanceMethodAssessment, buildCrossContextResearchCandidates,
	buildMethodFeedbackHandoff, latestMethodRecords, parentMethodRecord, methodUseRejection,
} from "./pi_research_method_runtime.ts";
import { assertParentChangeSource, canonicalTextBody, classifyHarnessChangeTargets, classifySemanticKind,
	normalizeCapabilityRequest, normalizeHarnessMemoryAtom, normalizeSemanticCandidate,
	type HarnessChange, type HarnessMemoryAtom } from "./pi_harness_protocol.ts";
import {
	assemblyConflictDetails,
	assemblyInputContract,
	assemblyInputErrorDetails,
	assemblySelectsReference,
	createHarnessAssembly,
	latestHarnessAssembly,
	renderPromptContributions,
	TASK_PROMPT_LAYERS,
	type HarnessAssembly,
	type HarnessComponentKind,
	type HarnessPoolEntry,
} from "./pi_task_harness_assembly.ts";
import {
	jevRoutingMode,
	routeHarnessComponents,
	routingStateFromMessages,
	type JevHarnessCandidate,
} from "./pi_jev_harness_routing.ts";

type HarnessPreflightIssue = { path: string; message: string };
class HarnessPreflightError extends Error {
	constructor(readonly issues: HarnessPreflightIssue[]) {
		super(issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
	}
}

function harnessPreflightDetails(changeRef: string, issues: HarnessPreflightIssue[]) {
	return { format: "task-harness-preflight-error-v1", change_ref: changeRef,
		status: "failed", phase: "preflight", issues, no_component_written: true,
		recovery: "Repair these fields together and resubmit the same call. Reuse already-read creator refs; no contract read is required." };
}

const MINIMUM_CANDIDATE_FIELDS = "Memory: component=memory,key,atom={subject,predicate,value},validity={scope:task|episode|level|state}; IDs auto-bind. System Prompt: component=system_prompt,name,content,scope text. Skill/Tool/Subagent: fill its read creator; reuse creator_ref.";

export const SELF_HARNESS_MANAGEMENT_TOOLS = [
	"task_harness",
	"task_harness_create",
	"task_harness_status",
	"task_tool_policy",
	"task_memory_pool",
	"assess_harness_effect",
	"auto_research",
] as const;

/** Registered native executors. They are intentionally omitted from the
 * parent model's ordinary active surface; task_harness is their facade. */
export const INTERNAL_NATIVE_HARNESS_TOOLS = [
	"task_memory", "task_system_prompt", "task_skill", "task_tool", "task_subagent",
] as const;

/** Compatibility activation entrypoint; it does not bypass the change facade. */
export const HARNESS_BOOTSTRAP_TOOL = "harness_bootstrap";

const publicationAssemblyParameters = Type.Optional(Type.Object({
	expected_assembly_revision: Type.Integer({minimum:0}),
	selected_resource_refs: Type.Array(Type.String()),
	prompt_contributions: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
}, {additionalProperties:false, description:"create/change: select all versions written here plus these refs. Omit for pool-only publication."}));

function normalizeDirectCreateProgramMetadata(params: Record<string, any>): {
	value: Record<string, any>; movedFields: string[]; conflict?: string;
} {
	const candidate = params.candidate;
	const program = candidate?.program;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
		|| candidate.semantic_kind !== "tool"
		|| !program || typeof program !== "object" || Array.isArray(program)
		|| program.format !== "task-pure-expression-v1") return { value: params, movedFields: [] };
	const movedFields = ["assembly", "decision"].filter(field => Object.hasOwn(program, field));
	if (!movedFields.length) return { value: params, movedFields };
	for (const field of movedFields) {
		if (params[field] !== undefined && JSON.stringify(params[field]) !== JSON.stringify(program[field]))
			return { value: params, movedFields: [], conflict: `candidate.program.${field}` };
	}
	const executable = { ...program };
	const value = { ...params, candidate: { ...candidate, program: executable } };
	for (const field of movedFields) {
		value[field] = params[field] ?? executable[field];
		delete executable[field];
	}
	return { value, movedFields };
}

function normalizeDirectCreateMetadata(params: Record<string, any>) {
	const normalized = normalizeDirectCreateProgramMetadata(params);
	const candidate = normalized.value.candidate;
	if (normalized.conflict || !candidate || typeof candidate !== "object" || Array.isArray(candidate)
		|| !Object.hasOwn(candidate, "trial")) return normalized;
	if (normalized.value.trial !== undefined
		&& stableControlJSON(normalized.value.trial) !== stableControlJSON(candidate.trial)) {
		return { value: params, movedFields: [], conflict: "candidate.trial" };
	}
	// Invocation data belongs to the call, not the reusable component body.
	const authored = { ...candidate };
	delete authored.trial;
	return { value: { ...normalized.value, candidate: authored,
		trial: normalized.value.trial ?? candidate.trial },
		movedFields: [...normalized.movedFields, "candidate.trial"] };
}

	const SUBAGENT_MANAGEMENT_TOOLS = ["delegate_task", "auto_research"] as const;

type Dependencies = {
	root: string;
	append: (name: string, value: unknown) => void;
	readJsonl: (name: string) => Record<string, any>[];
	allocateDecisionId: () => string;
	getObservation: (id: string) => Record<string, unknown> | undefined;
	resolveBasisRefs?: (references: string[]) => string[];
	pendingAssessments: Map<string, Record<string, unknown>>;
	taskToolAdapter?: TaskToolAdapter;
};

type MemoryRecord = KnowledgeLinks & {
    validity?: MemoryValidity;
	summary?: string;
	memory_id: string;
	key: string;
	version: number;
	status: "active" | "retired";
	content: string;
	/** Absent only on historical records written before atomic memory. */
	atom?: HarnessMemoryAtom;
	scope: string;
	basis_refs: string[];
	pinned: boolean;
	projection?: {
		// Dynamic user/task context projection owned by this memory record. This
		// does not add a sixth persistent harness component.
		channel: "task_prompt";
		layer?: "task_policy" | "task_state";
		prompt_text?: string;
		activation?: ActivationCondition;
	};
	decision_id?: string;
	expected_effect?: string;
	reconsider_when?: string;
	routing_id?: string;
	source_approval_ref?: string;
	recordedAt: string;
};

type SkillRecord = KnowledgeLinks & {
	validity?: MemoryValidity;
	method?: ResearchMethodSpecification;
	authoring_status?: "structured_grounded_candidate" | "structured_untested_candidate" | "creator_authored_untested_candidate" | "unstructured_requires_review";
	skill_id: string;
	name: string;
	version: number;
	status: "active" | "retired";
	description: string;
	instructions: string;
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

export type SystemPromptRecord = KnowledgeLinks & {
	validity?: MemoryValidity;
	segment_id: string;
	name: string;
	version: number;
	status: "active" | "retired";
	content: string;
	scope: string;
	basis_refs: string[];
	decision_id?: string;
	expected_effect: string;
	reconsider_when: string;
	routing_id?: string;
	source_approval_ref?: string;
	recordedAt: string;
};

export function taskKnowledgeEntries(read: (name: string) => Record<string, any>[]): KnowledgeEntry[] {
	const methods = read("task-method-lifecycle.jsonl");
	const assessments = read("effect-assessments.jsonl");
	return [["memory", "task-memory.jsonl"], ["skill", "task-skills.jsonl"],
		["system_prompt", "task-system-prompt.jsonl"], ["tool", "task-tools.jsonl"],
		["subagent", "task-subagents.jsonl"]].flatMap(([kind, file]) => read(file).map(record => ({ kind,
			record: methodUseRejection(methods, [knowledgeRef(kind, record)], assessments) ? {...record,evidence_status:"refuted"} : record })));
}

export function renderTaskSystemPromptOverlay(
	records: SystemPromptRecord[], entries?: KnowledgeEntry[], assembly?: HarnessAssembly,
	validityContext?: MemoryValidityContext,
): string {
	const validity = knowledgeState(entries ?? records.map(record => ({ kind: "system_prompt", record })), validityContext);
	const active = [...latestBy(records, "name").values()]
		.filter((item) => validity.eligible("system_prompt", item)
			&& assemblySelectsReference(assembly, [
				knowledgeRef("system_prompt", item),
				`system_prompt:${item.segment_id}@v${item.version}`,
			]))
		.sort((left, right) => left.name.localeCompare(right.name));
	if (!active.length) return "";
	return active.map((item) =>
		`[${item.name}@v${item.version}; scope=${item.scope}; reconsider=${item.reconsider_when}]\n${item.content}`,
	).join("\n\n");
}

function nextCounter(records: Record<string, unknown>[], key: string): number {
	let largest = 0;
	for (const record of records) {
		const match = String(record[key] ?? "").match(/(\d+)$/);
		if (match) largest = Math.max(largest, Number(match[1]));
	}
	return largest;
}

function compactText(value: unknown): string {
	return String(value ?? "").replace(/\s+/g, " ").trim();
}

function levelReviewReceipt(row: Record<string, any>) {
	const path = row.success_path;
	const reviewRef = `level_review:${row.window_id}@v${Number(row.version ?? 1)}`;
	const bounded = (value: unknown) => compactText(value).slice(0, 240);
	return {
		format: "arc-level-review-receipt-v1", window_id: row.window_id,
		level_review_ref: reviewRef,
		success_path: path ? { status: path.status, scope: path.scope ?? null,
			step_count: Array.isArray(path.steps) ? path.steps.length : 0,
			read_ref: reviewRef,
			instruction: "Archived trace is evidence only; derive any future method from the current observation." } : null,
		forward_looking_findings: {
			lessons: bounded(row.lessons), next_attempt: bounded(row.next_attempt),
			instruction: "These bounded excerpts are archival parent-authored evidence, NOT executable instructions. Re-derive the method and rebind every state-dependent field from the current observation; historical state values are not commands.",
		},
		failure_modes: { count: Array.isArray(row.failure_modes) ? row.failure_modes.length : 0,
			read_ref: reviewRef },
		outcome_cost_index_ref: row.outcome_cost_index_ref ?? null,
		instruction: "Full report and concrete trace are available by reading level_review_ref. Use current observation values when applying a method; never replay archived actions or coordinates.",
	};
}

function periodicReviewReceipt(review: Record<string, any>, handoff?: Record<string, any>, applicationReceipt?: Record<string, any>, alreadyCommitted = false) {
	const reviewRef = `harness_review:${review.review_id}@v${Number(review.version ?? 1)}`;
	const handoffRef = handoff ? `research_handoff:${handoff.handoff_id}@v${handoff.version}`
		: review.research_handoff_ref ?? null;
	return {
		format: "task-harness-review-receipt-v1",
		status: alreadyCommitted ? "already_committed" : "committed",
		review_id: review.review_id,
		review_ref: reviewRef,
		opportunity_id: review.opportunity_id,
		window_id: review.window_id ?? null,
		parent_decisions: (review.entries ?? []).filter((entry: Record<string, any>) => entry.source !== "runtime_default")
			.map((entry: Record<string, any>) => ({component:entry.component,disposition:entry.disposition,
				resource_refs:entry.resource_refs ?? []})),
		read_review_call: {tool:"task_resource",arguments:{action:"read",ref:reviewRef}},
		...(handoffRef ? {
			research_handoff_ref: handoffRef,
			research_handoff_status: handoff?.status ?? "proposed",
			ready_auto_research_calls: handoff?.status === "proposed" ? handoff.ready_calls : null,
			read_handoff_call: {tool:"task_resource",arguments:{action:"read",ref:handoffRef}},
		} : {}),
		...(applicationReceipt ? {application_receipt:applicationReceipt} : {}),
	};
}

function readPath(value: unknown, path: string): unknown {
	let current: unknown = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function activationMatches(condition: ActivationCondition | undefined, state: Record<string, unknown>): boolean {
	if (!condition) return true;
	const type = String(condition.type ?? "always");
	if (type === "always") return true;
	if (type === "state_match") {
		const actual = readPath(state, String(condition.path ?? ""));
		const operator = String(condition.operator ?? "eq");
		if (operator === "exists") return actual !== undefined;
		if (operator === "eq") return JSON.stringify(actual) === JSON.stringify(condition.value);
		if (operator === "neq") return JSON.stringify(actual) !== JSON.stringify(condition.value);
		if (operator === "in") return Array.isArray(condition.value)
			&& condition.value.some((candidate) => JSON.stringify(candidate) === JSON.stringify(actual));
		return false;
	}
	if (type === "all") return Array.isArray(condition.conditions)
		&& condition.conditions.every((item) => item && typeof item === "object"
			&& activationMatches(item as ActivationCondition, state));
	if (type === "any") return Array.isArray(condition.conditions)
		&& condition.conditions.some((item) => item && typeof item === "object"
			&& activationMatches(item as ActivationCondition, state));
	if (type === "not") return condition.condition && typeof condition.condition === "object"
		? !activationMatches(condition.condition as ActivationCondition, state) : false;
	if (type === "agent_asserted") {
		const assertion = readPath(state, `assertions.${String(condition.assertion_ref ?? "")}`);
		return condition.value === undefined ? assertion === true : JSON.stringify(assertion) === JSON.stringify(condition.value);
	}
	return false;
}

function latestBy<T extends Record<string, any>>(records: T[], key: keyof T): Map<string, T> {
	const result = new Map<string, T>();
	for (const record of records) {
		const id = String(record[key] ?? "");
		const previous = result.get(id);
		if (id && (!previous || Number(record.version ?? 0) >= Number(previous.version ?? 0))) {
			result.set(id, record);
		}
	}
	return result;
}

function assertSafeName(name: string): void {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.includes("--")) {
		throw new Error("name must use lowercase letters, digits, or single hyphens");
	}
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}

function isInside(path: string, parent: string): boolean {
	const rel = relative(parent, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Task skills are ordinary task resources, never native loader contributions.

function unassessedHarnessEffects(dependencies: Dependencies): Record<string, unknown>[] {
	const latestAssessmentByDecision = new Map<string, Record<string, any>>();
	for (const assessment of dependencies.readJsonl("effect-assessments.jsonl")) {
		const decisionId = String(assessment.decision_id ?? "");
		if (decisionId) latestAssessmentByDecision.set(decisionId, assessment);
	}
	const exposuresByDecision = new Map<string, Record<string, any>[]>();
	for (const observation of dependencies.readJsonl("harness-observations.jsonl")) {
		const decisionId = String(observation.decision_id ?? "");
		if (!decisionId || observation.effect_observed !== true) continue;
		const prior = exposuresByDecision.get(decisionId) ?? [];
		prior.push(observation);
		exposuresByDecision.set(decisionId, prior);
	}
	const pending: Record<string, unknown>[] = [];
	for (const decision of [...dependencies.readJsonl("harness-decisions.jsonl")].reverse()) {
		const decisionId = String(decision.decision_id ?? "");
		const exposures = exposuresByDecision.get(decisionId) ?? [];
		const priorAssessment = latestAssessmentByDecision.get(decisionId);
		const assessedAt = String(priorAssessment?.recordedAt ?? "");
		const unassessedExposures = assessedAt
			? exposures.filter((item) => String(item.recordedAt ?? "") > assessedAt)
			: exposures;
		if (!decisionId || !unassessedExposures.length) continue;
		const basisRefs = decision.basis_resource_ids ?? [];
		pending.push({
			decision_id: decisionId,
			decision_path: decision.decision_path,
			intervention: decision.intervention,
			basis_refs: basisRefs,
			research_link_status: basisRefs.length ? "linked" : "unlinked",
			operation: decision.operation,
			expected_effect: decision.expected_effect,
			reconsider_when: decision.reconsider_when,
			native_exposure_count: exposures.length,
			unassessed_native_exposure_count: unassessedExposures.length,
			latest_native_observation_refs: unassessedExposures
				.map((item) => String(item.observation_id ?? ""))
				.filter(Boolean),
			...(priorAssessment ? {
				prior_effect_assessment: {
					effect_assessment_id: priorAssessment.effect_assessment_id,
					verdict: priorAssessment.verdict,
				},
			} : {}),
		});
	}
	return pending.reverse();
}

export function installTaskLocalSelfHarness(pi: ExtensionAPI, dependencies: Dependencies): void {
	const root = resolve(dependencies.root);
	const taskScope = ensureTaskScope(root);
	const parentResults = installParentContextControl(pi, root);
	const readJsonl = (name: string): Record<string, any>[] => {
		const records = dependencies.readJsonl(name);
		assertTaskRecordsScope(taskScope, records, name);
		return records;
	};
	const append = (name: string, value: unknown) => dependencies.append(
		name,
		stampTaskRecord(taskScope, value as Record<string, unknown>),
	);
	installHarnessArgumentIntegrity(pi, record => append("task-harness-argument-errors.jsonl", record));
	const scopedDependencies: Dependencies = { ...dependencies, readJsonl, append };
	const pendingReviewDrafts = () => {
		const committed = new Set(readJsonl("task-harness-reviews.jsonl").map(row => row.opportunity_id));
		return [...new Map(readJsonl("task-harness-review-drafts.jsonl")
			.map(row => [row.opportunity_id, row])).values()].filter(row => !committed.has(row.opportunity_id));
	};
	const capabilityReviewSources = () => [
		...readJsonl("task-harness-reviews.jsonl"), ...pendingReviewDrafts(),
		...[...latestBy(readJsonl("parent-authoring-handoffs.jsonl"), "handoff_id").values()]
			.filter(row => row.status === "awaiting_parent_authoring")
			.map(row => ({
				opportunity_id: `parent-authoring:${row.handoff_id}`,
				review_id: `parent-authoring:${row.handoff_id}`,
				research_authoring_handoff: {
					resource_ref: row.resource_ref,
					recommended_component_kind: row.recommended_component_kind,
					method_ref: row.source?.method_ref,
					report_ref: row.source?.report_ref,
				},
				transition_analysis: {
					capability_opportunities: row.candidate_summary,
					evidence_refs: [row.source?.method_ref, row.source?.report_ref].filter(Boolean),
				},
			}))
	];
	const workspace = join(root, "task-harness");
	const skillsDir = join(workspace, "skills");
	const agentsDir = join(workspace, "agents");
	let scopedReadRegistered = false;

	const memoryRecords = readJsonl("task-memory.jsonl") as MemoryRecord[];
	const memories = latestBy(memoryRecords, "key");
	let memoryCounter = nextCounter(memoryRecords, "memory_id");
	const skillRecords = readJsonl("task-skills.jsonl") as SkillRecord[];
	const skills = latestBy(skillRecords, "name");
	let skillCounter = nextCounter(skillRecords, "skill_id");
	const systemPromptRecords = readJsonl("task-system-prompt.jsonl") as SystemPromptRecord[];
	const systemPrompts = latestBy(systemPromptRecords, "name");
	const knowledgeEntries = () => taskKnowledgeEntries(readJsonl);
	const currentValidityContext = () => memoryValidityContext(taskScope.taskId, readJsonl("execution-observations.jsonl"));
	const currentKnowledge = () => knowledgeState(knowledgeEntries(), currentValidityContext());
	const linkParameters = {
		validity: Type.Optional(Type.Object({ scope: Type.Union([Type.Literal("task"), Type.Literal("episode"), Type.Literal("level"), Type.Literal("state")]), task_ref: Type.Optional(Type.String()), instance_ref: Type.Optional(Type.String()) }, { description: "Public-state lifetime." })),
		depends_on_refs: Type.Optional(Type.Array(Type.String({ description: "Current dependencies, not basis refs." }))),
		supersedes_refs: Type.Optional(Type.Array(Type.String({ description: "Exact replaced versions." }))),
	};
	const developmentIntentParameters = Type.Optional(Type.Object({
		operation_id: Type.String({ minLength: 1 }),
		purpose: Type.String({ minLength: 1 }),
		status: Type.Union([Type.Literal("open"), Type.Literal("trial_pending"), Type.Literal("resolved"), Type.Literal("deferred"), Type.Literal("dropped")]),
		next_step: Type.Optional(Type.String()), reason: Type.Optional(Type.String()),
		resource_refs: Type.Optional(Type.Array(Type.String())),
		reconsider_when: Type.Optional(Type.String()),
	}));
	const directDevelopmentIntents = () => {
		const direct = readJsonl("task-development-intents.jsonl");
		const current = new Map(currentDevelopmentIntents(capabilityReviewSources(), readJsonl("task-capability-decisions.jsonl"), direct)
			.map(intent => [String(intent.operation_id), intent]));
		return currentDirectDevelopmentIntents(direct).map(intent => current.get(String(intent.operation_id)) ?? intent);
	};
	const allCapabilityFollowups = () => {
		const reviews = capabilityReviewSources();
		const decisions = readJsonl("task-capability-decisions.jsonl");
		const direct = readJsonl("task-development-intents.jsonl");
		return [
			...capabilityFollowups(reviews, decisions, baselineMethodCatalog(), direct),
			...directDevelopmentFollowups(direct, reviews, decisions),
		];
	};
	const recordDirectDevelopmentIntent = (intent: Record<string, any>, source: string, requireDeferredDetails = true) => {
		if (!intent?.operation_id?.trim() || !intent?.purpose?.trim()) {
			if (!requireDeferredDetails) return undefined; // Do not reject an already-committed legacy review.
			throw new Error("development_intent requires a parent-authored operation_id and purpose");
		}
		if (requireDeferredDetails && intent.status === "deferred" && (!intent.reason?.trim() || !intent.reconsider_when?.trim()))
			throw new Error("A deferred development_intent requires reason and reconsider_when");
		const prior = directDevelopmentIntents().find(row => row.operation_id === intent.operation_id);
		const record = { ...intent, source, ...(prior ? {previous_status:prior.status} : {}),
			recordedAt:new Date().toISOString() };
		append("task-development-intents.jsonl", record);
		return record;
	};
	let systemPromptCounter = nextCounter(systemPromptRecords, "segment_id");
	let assessmentCounter = nextCounter(readJsonl("effect-assessments.jsonl"), "effect_assessment_id");
	let pendingToolDecision: { decisionId: string; toolCallId: string } | undefined;
	let harnessStarted = readJsonl("task-harness-entry-events.jsonl")
		.some((item) => item.event === "self_harness_started");
	const resolveBasisRefs = (references: unknown): string[] => {
		const values = Array.isArray(references) ? references.map(String) : [];
		return dependencies.resolveBasisRefs ? dependencies.resolveBasisRefs(values) : values;
	};
	const actionUsesComponentRefs = (row: Record<string, any>, references: string[]): boolean => {
		if (row.tool_name !== "arc_action" || row.is_error) return false;
		return (row.input?.decision?.basis_refs ?? []).some((ref: string) => {
			if (references.includes(ref)) return true;
			const kind = String(ref).split(":")[0];
			if (!["memory", "skill", "tool", "subagent", "system_prompt"].includes(kind)) return false;
			try { return references.includes(resourceMetadata(kind, resolveTaskResource(root, ref)).resource_ref); }
			catch { return false; }
		});
	};
	const requireCreatorRead = (kind: "skill" | "tool" | "subagent", candidate: Record<string, any>) => {
		const methodName = creatorForHarnessKind(kind);
		if (!methodName) return;
		let supplied = String(candidate.authoring_method_ref ?? "").trim();
		const catalogEntry = baselineMethodCatalog().find((item) => item.name === methodName);
		const expected = catalogEntry?.method_ref ?? "";
		const reads = readJsonl("task-baseline-method-reads.jsonl");
		const currentRead = reads.some((row) => row.name === methodName && row.method_ref === expected
			&& row.sha256 === catalogEntry?.sha256 && row.actor !== "child" && row.source !== "arc_open_admission");
		if (!supplied && currentRead) {
			supplied = expected;
			candidate.authoring_method_ref = expected;
		}
		if (!supplied) {
			throw new Error(`authoring_method_ref is required for ${kind} creation/update; first call task_harness(action=read_method, method_name=${methodName}) and pass its method_ref`);
		}
		if (supplied !== expected) {
			if (currentRead && expected && supplied.startsWith(`baseline_method:${methodName}@sha256:`)) {
				// A provider may copy a stale hash from an earlier catalog snapshot
				// even after reading the current creator in this run. The read is the
				// authoritative parent preparation event; normalize the candidate to
				// that exact immutable ref and keep the conversion moving.
				candidate.authoring_method_ref = expected;
				supplied = expected;
			} else {
				throw new Error(`authoring_method_ref does not match the current ${methodName} baseline; expected_ref=${expected}; creator_read_in_run=${currentRead}. ${currentRead ? "Reuse expected_ref on the corrected candidate; do not reread the creator." : `Call task_harness(action=read_method, method_name=${methodName}) once.`}`);
			}
		}
		if (!currentRead) {
			throw new Error(`creator method ${methodName} was not read in this run; call task_harness(action=read_method, method_name=${methodName}) before creating ${kind}`);
		}
		return supplied;
	};
	const registerRoutableTool = (definition: any) => {
		pi.registerTool(definition);
		registerNativeHarnessExecutor(pi, String(definition.name), definition.execute);
	};
	// Collect independent content errors without inventing missing authored data.
	// Native callers use the same checks; the facade prefixes them with batch indices.
	const preflightContentIssues = (kind: string, candidate: Record<string, any>, boundFields = new Set<string>()): HarnessPreflightIssue[] => {
		const issues: HarnessPreflightIssue[] = [];
		const check = (field: string, validate: () => unknown) => {
			try { validate(); } catch (error) {
				const validatorPath = (error as { path?: unknown })?.path;
				const path = typeof validatorPath === "string" && validatorPath.startsWith("$.")
					? validatorPath === `$.${field}` || validatorPath.startsWith(`$.${field}.`)
						? validatorPath.slice(2) : `${field}${validatorPath.slice(1)}`
					: field;
				let message = error instanceof Error ? error.message : String(error);
				if (field === "program" && message.startsWith("undeclared variable:"))
					message += ' Input fields/bindings use get(value={op:"input"},key={op:"literal",value:"field"}); var names must be declared lexical bindings (let/map/filter).';
				issues.push({ path, message });
			}
		};
		if (candidate.validity !== undefined) check("validity", () => {
			const binding = normalizeMemoryValidity(candidate.validity, currentValidityContext());
			const context = currentValidityContext();
			if (binding.task_ref !== context.task || binding.instance_ref !== context[binding.scope])
				throw new Error("component validity must bind the current scope instance");
		});
		if (kind === "memory") {
			check("key", () => { if (!String(candidate.key ?? candidate.name ?? "").trim()) throw new Error("memory requires a stable key or name"); });
			check("atom", () => normalizeHarnessMemoryAtom(candidate.atom));
			if (candidate.validity === undefined) check("validity", () => {
				throw new Error("memory requires validity={scope:task|episode|level|state}; choose the evidence scope. Runtime binds omitted task/instance IDs; validity_bindings is not validity.");
			});
		}
		if (kind === "skill") {
			check("name", () => assertSafeName(String(candidate.name ?? "").trim()));
			check("description", () => { if (!String(candidate.description ?? candidate.summary ?? "").trim())
				throw new Error("skill requires a creator-authored description that states when the procedure should be used"); });
			check("instructions", () => { if (!canonicalTextBody(candidate.instructions ?? candidate.content, "skill instructions").trim())
				throw new Error("skill requires creator-authored executable instructions or content as its loadable SKILL.md body"); });
		}
		if (kind === "tool") {
			check("name", () => assertTaskToolName(String(candidate.name ?? "").trim()));
			check("description", () => { if (!String(candidate.description ?? candidate.summary ?? "").trim()) throw new Error("tool requires a creator-authored description"); });
			const pure = Boolean(candidate.program && Object.prototype.hasOwnProperty.call(candidate.program, "format"));
			check("program", () => {
				if (candidate.program !== undefined) {
					if (!candidate.program || typeof candidate.program !== "object" || Array.isArray(candidate.program)) throw new Error("tool program must be a JSON object");
					if (pure) validateTaskPureExpressionProgram(candidate.program);
					else if (!Array.isArray(candidate.program.steps) || !candidate.program.steps.length) throw new Error("program.steps must be a non-empty array");
				} else if (!String(candidate.implementation_ref ?? "").trim()) throw new Error("tool requires a program or authorized implementation_ref");
			});
			for (const field of ["input_schema", "output_schema"]) check(field, () => {
				const value = candidate[field];
				if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`tool ${field} must be a JSON object`);
				if (pure) {
					if (field === "output_schema" && value === undefined) throw new Error("pure expression program requires output_schema");
					validateTaskJsonSchema(value ?? { type: "object" }, `$.${field}`);
				}
			});
			if (pure && !issues.some(issue => issue.path.startsWith("program") || issue.path.startsWith("input_schema"))) {
				// The original schema is validated above. Only explicit bound names
				// can defer an absent-field check; these placeholders are never published.
				const inputSchema = candidate.input_schema ?? { type: "object" };
				const properties = { ...inputSchema.properties };
				for (const name of boundFields) if (!Object.hasOwn(properties, name))
					Object.defineProperty(properties, name, { value: {}, enumerable: true, configurable: true });
				check("program", () => validateTaskPureExpressionInputAccess(
					validateTaskPureExpressionProgram(candidate.program), { ...inputSchema, properties }));
			}
		}
		if (kind === "subagent") {
			check("name", () => assertSafeName(String(candidate.name ?? "").trim()));
			check("description", () => { if (!String(candidate.description ?? candidate.summary ?? "").trim()) throw new Error("subagent requires a creator-authored use description"); });
			check("instructions", () => { if (!canonicalTextBody(candidate.instructions ?? candidate.content, "subagent instructions").trim()) throw new Error("subagent requires creator-authored instructions"); });
			check("tools", () => { if (!Array.isArray(candidate.tools) || candidate.tools.some((tool: unknown) => typeof tool !== "string")) throw new Error("subagent requires an explicit tools array; [] is valid for pure reasoning"); });
			check("context_recipe", () => { if (candidate.context_recipe !== undefined
				&& (!candidate.context_recipe || typeof candidate.context_recipe !== "object" || Array.isArray(candidate.context_recipe))) {
				throw new Error("subagent context_recipe must be an object when supplied");
			} });
		}
		if (kind === "system_prompt") {
			check("name", () => assertSafeName(String(candidate.name ?? "").trim()));
			check("content", () => { if (!canonicalTextBody(candidate.prompt_text ?? candidate.content, "system prompt content").trim()) throw new Error("system_prompt requires parent-authored content"); });
			check("scope", () => {
				const scope = candidate.scope && typeof candidate.scope === "object" && !Array.isArray(candidate.scope)
					? candidate.scope.statement : candidate.scope;
				if (typeof scope !== "string" || !scope.trim()) throw new Error("system_prompt requires scope=authored applicability text or scope.statement");
			});
		}
		if (["skill", "tool", "subagent"].includes(kind) && candidate.method !== undefined) {
			// Optional quality metadata is never invented. Validate and preserve every
			// supplied canonical field, while allowing an explicitly untested minimum
			// component contract to enter the pool.
			check("method", () => normalizeMethodSpecification(candidate.method));
		}
		return issues;
	};
	const preflightContent = (kind: string, candidate: Record<string, any>) => {
		const issues = preflightContentIssues(kind, candidate);
		if (issues.length) throw new HarnessPreflightError(issues);
	};
	const preflightCreators = (changes: Array<Record<string, any>>, boundFields = new Set<string>()) => {
		const issues: HarnessPreflightIssue[] = [];
		for (const [index, change] of changes.entries()) {
			if (!["create", "update"].includes(change.operation)) continue;
			let candidate = change.candidate;
			const path = `changes[${index}].candidate`;
			const add = (field: string, error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				// A route and a content validator may detect the same missing atom.
				const issuePath = field ? `${path}.${field}` : path;
				const duplicate = issues.find(issue => (issue.path === path || issue.path === issuePath) && issue.message === message);
				if (duplicate) { if (field) duplicate.path = issuePath; }
				else issues.push({ path: issuePath, message });
			};
			if (!candidate && change.candidate_ref) add("", "candidate_ref cannot be materialized. Submit a complete parent-authored candidate.");
			if (!candidate) continue;
			if (candidate.trial !== undefined) add("trial", "candidate.trial is only supported by task_harness_create");
			let kinds: string[] = [];
			try {
				candidate = normalizeSemanticCandidate(candidate);
				kinds = classifyHarnessChangeTargets(candidate);
			} catch (error) {
				add("", error);
				// Diagnostic hints only: never route or write from this fallback.
				// It lets invalid atoms/roles expose independent validity/body errors.
				const alias = String(candidate.semantic_kind ?? candidate.component ?? candidate.kind ?? candidate.type ?? "").toLowerCase();
				const hints: Record<string, string> = { memory: "memory", task_memory: "memory", fact: "memory", plan: "memory", task_state: "memory", policy: "memory", task_prompt: "memory",
					skill: "skill", task_skill: "skill", procedure: "skill", tool: "tool", task_tool: "tool", computation: "tool",
					subagent: "subagent", task_subagent: "subagent", role: "subagent", system_prompt: "system_prompt", task_system_prompt: "system_prompt" };
				if (hints[alias]) kinds = [hints[alias]];
			}
			for (const kind of kinds) {
				if (["skill", "tool", "subagent"].includes(kind)) {
					try { requireCreatorRead(kind as "skill" | "tool" | "subagent", candidate); }
					catch (error) { add("authoring_method_ref", error); }
				}
				for (const issue of preflightContentIssues(kind, candidate, boundFields)) add(issue.path, issue.message);
			}
		}
		if (issues.length) throw new HarnessPreflightError(issues);
	};
	const hideNativeMutationTools = () => {
		const internal = new Set<string>(INTERNAL_NATIVE_HARNESS_TOOLS);
		pi.setActiveTools([...new Set([...pi.getActiveTools().filter((name) => !internal.has(name)), "task_harness"])]);
	};
	/**
	 * The only model-visible write boundary.  Component tools remain native
	 * executors for compatibility and route application, but this compiler is
	 * the parent-facing protocol: semantic attributes select the component and
	 * the executor receives one deterministic call.
	 */
	const applyFacadeChanges = async (toolCallId: string, input: Record<string, any>) => {
		assertParentChangeSource("parent", "change");
		const request = normalizeCapabilityRequest({
			action: "change", changes: input.changes, decision: input.decision,
		}) as { action: "change"; changes: HarnessChange[]; decision: Record<string, any> };
		const changeRef = `harness-change:${toolCallId}`;
		// Persist the parent intent before creator/content preflight.  Preflight is
		// deliberately allowed to reject an incomplete candidate, but that rejection
		// must never erase the operation the parent selected for development.  The
		// durable intent is a recovery surface for the next parent turn; it is not a
		// component and it never authorizes the runtime to invent missing content.
		const intentKinds = [...new Set(request.changes.flatMap((change: any) => {
			if (change.operation === "retire" || change.operation === "reuse") {
				return String(change.target_ref ?? "").split(":", 1)[0];
			}
			try { return classifyHarnessChangeTargets(normalizeSemanticCandidate(change.candidate ?? {})); }
			catch { return []; }
		}).filter((kind: string) => ["memory", "system_prompt", "skill", "tool", "subagent"].includes(kind)))];
		const intentPurpose = String(request.decision.reason ?? "").trim();
		const intentRecord = {
			format: "task-harness-conversion-intent-v1",
			intent_id: changeRef,
			status: "accepted",
			phase: "preflight",
			owner: "parent",
			carrier: intentKinds,
			purpose: intentPurpose || "Parent-selected Harness capability development",
			decision: request.decision,
			changes: request.changes,
			retry: {
				tool: "task_harness",
				arguments: { action: "change", changes: request.changes,
					decision: request.decision },
			},
			recordedAt: new Date().toISOString(),
		};
		append("task-harness-conversion-intents.jsonl", intentRecord);
		const currentVersion = (targetKind: string, candidate: Record<string, any>): number | undefined => {
			const name = String(candidate.key ?? candidate.name ?? "").trim();
			if (!name) return undefined;
			if (targetKind === "memory") return latestBy(readJsonl("task-memory.jsonl"), "key").get(name)?.version;
			if (targetKind === "skill") return latestBy(readJsonl("task-skills.jsonl"), "name").get(name)?.version;
			if (targetKind === "system_prompt") return latestBy(readJsonl("task-system-prompt.jsonl"), "name").get(name)?.version;
			const file = targetKind === "tool" ? "task-tools.jsonl" : "task-subagents.jsonl";
			return latestBy(readJsonl(file), "name").get(name)?.version;
		};
		try {
			preflightCreators(request.changes);
			// Validate every target/version before the first native write. Native
			// executors still perform their own CAS checks, but this batch-level
			// preflight prevents a late duplicate/version conflict from leaving an
			// earlier change applied and an ambiguous whole-batch retry.
			const seenTargets = new Set<string>();
			for (const change of request.changes) {
				if (change.operation === "reuse") {
					resolveTaskResource(root, change.target_ref);
					continue;
				}
				if (change.operation === "retire") {
					resolveTaskResource(root, change.target_ref);
					continue;
				}
				const candidate = normalizeSemanticCandidate(change.candidate ?? {});
				for (const targetKind of classifyHarnessChangeTargets(candidate)) {
					const identity = String(targetKind === "memory" ? candidate.key ?? candidate.name : candidate.name ?? "").trim();
					if (!identity) continue;
					const key = `${targetKind}:${identity}`;
					if (seenTargets.has(key)) throw new Error(`duplicate target in one Harness change batch: ${key}`);
					seenTargets.add(key);
					const current = currentVersion(targetKind, candidate);
					if (change.operation === "create" && current !== undefined)
						throw new Error(`${targetKind} already exists: ${identity}; use update with the current version`);
					if (change.operation === "update") {
						const supplied = targetKind === "system_prompt" ? candidate.prompt_target_version : candidate.target_version;
						if (current === undefined) throw new Error(`cannot update missing ${targetKind}: ${identity}`);
						if (supplied !== undefined && Number(supplied) !== Number(current)) {
							const conflict = versionConflict(targetKind, { name: identity, key: identity, version: current }, supplied);
							throw new Error(String((conflict as any).details?.recovery ?? `version conflict for ${targetKind}:${identity}`));
						}
					}
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const kindHints = [...new Set(request.changes.flatMap((change: any) => {
				const candidate = change?.candidate ?? {};
				try { return classifyHarnessChangeTargets(normalizeSemanticCandidate(candidate)); }
				catch { return []; }
			}))];
			append("task-harness-conversion-intents.jsonl", {
				...intentRecord,
				version: 2,
				status: "awaiting_parent_repair",
				phase: "preflight_failed",
				error: message,
				component_hints: kindHints,
				recovery: "Repair the same parent-authored candidate (read the matching creator once when required), then resubmit the exact retry call; no component was written.",
				recordedAt: new Date().toISOString(),
			});
			append("task-harness-change-receipts.jsonl", {
				format: "task-harness-change-receipt-v1", change_ref: changeRef, status: "failed",
				decision: request.decision, results: [], error: message, recordedAt: new Date().toISOString(),
			});
			if (error instanceof HarnessPreflightError) {
				const details = harnessPreflightDetails(changeRef, error.issues);
				// Pi marks thrown execute errors as failed tool results; a returned
				// isError property alone is ignored by the SDK.
				throw new Error(JSON.stringify(details));
			}
			throw error;
		}
		append("task-harness-change-requests.jsonl", {
			format: "task-harness-change-request-v1", change_ref: changeRef,
			decision: request.decision, changes: request.changes, status: "applying",
			recordedAt: new Date().toISOString(),
		});
		const results: Record<string, unknown>[] = [];
		for (const [index, change] of request.changes.entries()) {
			if (change.operation === "reuse") {
				resolveTaskResource(root, change.target_ref);
				results.push({ index, operation: "reuse", target_ref: change.target_ref, status: "no_change" });
				continue;
			}
			const nativeChanges: Array<{ target: string; args: Record<string, any> }> = [];
			if (change.operation === "retire") {
				const match = String(change.target_ref).match(/^(memory|skill|tool|subagent|system_prompt):(.+)@v([1-9]\d*)$/);
				if (!match) throw new Error("retire target_ref must identify a task resource");
				const [, kind, , version] = match;
				const selected = resolveTaskResource(root, change.target_ref) as Record<string, any>;
				const name = kind === "memory" ? selected.key : selected.name;
				const target = kind === "system_prompt" ? "task_system_prompt" : `task_${kind}`;
				const args = { action: "retire", ...(kind === "memory" ? { key: name } : { name }), target_version: Number(version),
					routing_id: changeRef, source_approval_ref: changeRef,
					basis_refs: request.decision.basis_refs, expected_effect: request.decision.expected,
					reconsider_when: "when the parent decision is contradicted or obsolete" };
				nativeChanges.push({ target, args });
			} else {
				let candidate = { ...(change.candidate ?? {}) } as Record<string, any>;
				if (!Object.keys(candidate).length && change.candidate_ref) throw new Error("candidate_ref cannot be materialized. Runtime never copies a research candidate into a component; submit the complete parent-authored candidate.");
				candidate = normalizeSemanticCandidate(candidate);
				const semanticTarget = classifySemanticKind(candidate);
				if (semanticTarget === "research_only") throw new Error("assessment/evidence changes remain research-only");
				const operation = String(change.operation);
				for (const targetKind of classifyHarnessChangeTargets(candidate)) {
					if (["skill", "tool", "subagent"].includes(targetKind) && ["create", "update"].includes(operation)) {
						requireCreatorRead(targetKind as "skill" | "tool" | "subagent", candidate);
					}
					const target = targetKind === "system_prompt" ? "task_system_prompt" : `task_${targetKind}`;
					const suppliedVersion = targetKind === "system_prompt" ? candidate.prompt_target_version : candidate.target_version;
					const resolvedVersion = operation === "update" && suppliedVersion === undefined
						? currentVersion(targetKind, candidate) : suppliedVersion;
					const common = {
						...(candidate.validity !== undefined ? { validity: candidate.validity } : {}),
						...(candidate.method ? { method: normalizeMethodSpecification(candidate.method) } : {}),
						basis_refs: [...new Set([...(candidate.basis_refs ?? []), ...request.decision.basis_refs])],
						...(Array.isArray(candidate.depends_on_refs) ? { depends_on_refs: candidate.depends_on_refs } : {}),
						...(Array.isArray(candidate.supersedes_refs) ? { supersedes_refs: candidate.supersedes_refs } : {}),
						expected_effect: String(candidate.expected_effect ?? request.decision.expected).trim(),
						reconsider_when: String(candidate.reconsider_when ?? "").trim(),
						routing_id: candidate.routing_id ?? changeRef,
						source_approval_ref: candidate.source_approval_ref ?? changeRef,
						target_version: resolvedVersion,
					};
					let args: Record<string, any>;
					if (target === "task_memory") args = { ...common, action: "upsert", key: candidate.key ?? candidate.name,
						content: candidate.content, atom: candidate.atom, summary: candidate.summary, scope: candidate.scope?.statement ?? candidate.scope, validity: candidate.validity,
						...(candidate.projection ? { projection: candidate.projection }
							: candidate.context_visibility === "always" && (candidate.prompt_channel ?? "task_prompt") === "task_prompt"
								? { projection: { channel: "task_prompt", ...(candidate.prompt_layer ? { layer: candidate.prompt_layer } : {}),
									...(candidate.prompt_text ? { prompt_text: candidate.prompt_text } : {}), ...(candidate.activation ? { activation: candidate.activation } : {}) } }
								: {}) };
					else if (target === "task_system_prompt") args = { ...common, action: candidate.prompt_operation ?? operation,
						name: candidate.name, content: candidate.prompt_text ?? candidate.content, scope: candidate.scope?.statement ?? candidate.scope };
					else if (target === "task_skill") args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, instructions: candidate.instructions ?? candidate.content, method: candidate.method,
						authoring_method_ref: candidate.authoring_method_ref };
					else if (target === "task_tool") args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, input_schema: candidate.input_schema ?? { type: "object" },
						output_schema: candidate.output_schema,
						implementation_ref: candidate.implementation_ref, program: candidate.program,
						authoring_method_ref: candidate.authoring_method_ref };
					else args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, instructions: candidate.instructions ?? candidate.content, tools: candidate.tools, context_recipe: candidate.context_recipe,
						authoring_method_ref: candidate.authoring_method_ref };
					nativeChanges.push({ target, args });
				}
			}
			for (const [step, { target, args }] of nativeChanges.entries()) {
				const executor = nativeHarnessExecutor(pi, target);
				if (!executor) throw new Error(`native harness executor is unavailable: ${target}`);
				let result: any;
				try { result = await executor(`${toolCallId}:change-${index}-${step}`, args); }
				catch (error) { result = { isError: true, details: { error: error instanceof Error ? error.message : String(error) } }; }
				hideNativeMutationTools();
				const detail = result?.details && typeof result.details === "object" ? result.details : {};
				if (!result?.isError && ["create", "update"].includes(String(args.action))) {
					const ref = resourceMetadata(target.replace("task_", ""), detail).resource_ref;
					const sourceMethodRef = (args.basis_refs ?? []).map(String).find((item: string) => item.startsWith("method:"));
					if (args.method) {
						const prior = readJsonl("task-method-lifecycle.jsonl").findLast(row => row.author === "parent"
							&& String(row.source_component_ref).split("@v")[0] === ref.split("@v")[0]);
						let sourceMethod: Record<string, any> | undefined;
						try { if (sourceMethodRef) sourceMethod = resolveTaskResource(root, sourceMethodRef); } catch {}
						const authored = parentMethodRecord({resourceRef:ref,name:String(args.name),method:args.method,
							decisionId:String(detail.decision_id),researchLineRef:sourceMethod?.research_line_ref ?? prior?.research_line_ref,
							sourceMethodRef, sourceReportRef: sourceMethod?.source_report_ref});
						append("task-method-lifecycle.jsonl", authored);
						append("task-method-lifecycle.jsonl", advanceMethodApplication(authored, {resourceRefs:[ref],applicationRef:changeRef}));
					}
					if (sourceMethodRef) {
						const handoff = readJsonl("parent-authoring-handoffs.jsonl").findLast(row => row.source?.method_ref === sourceMethodRef);
						if (handoff && handoff.status === "awaiting_parent_authoring"
							&& ["skill", "tool", "subagent", "system_prompt"].includes(target.replace("task_", ""))) append("parent-authoring-handoffs.jsonl", {
							...handoff, version: Number(handoff.version ?? 1) + 1,
							resource_ref: `authoring_handoff:${handoff.handoff_id}@v${Number(handoff.version ?? 1) + 1}`,
							status: "authored",
							component_ref: ref, parent_change_ref: changeRef, authoredAt: new Date().toISOString(), recordedAt: new Date().toISOString(),
						});
					}
				}
				results.push({ index, step, native_tool: target, status: result?.isError ? "failed" : "applied",
					...(!result?.isError && Object.keys(detail).length ? {
						resource: resourceMetadata(target.replace("task_", ""), detail),
						...(detail.authoring_method_ref ? { authoring_method_ref: detail.authoring_method_ref } : {}),
					} : {}), ...(result?.isError ? { error: detail } : {}) });
				if (result?.isError) {
					const receipt = { format: "task-harness-change-receipt-v1", change_ref: changeRef, status: "failed", decision: request.decision, results };
					append("task-harness-change-receipts.jsonl", { ...receipt, recordedAt: new Date().toISOString() });
					const appliedResults = results.filter((row: any) => row.status === "applied");
					const remainingChanges = request.changes.filter((_change, changeIndex) =>
						!results.some((row: any) => Number(row.index) === changeIndex && row.status === "applied"));
					append("task-harness-conversion-intents.jsonl", {
						...intentRecord, version: 2, status: "awaiting_parent_repair", phase: "apply_failed",
						error: detail.error ?? "native harness mutation failed",
						partial_applied: appliedResults.length > 0,
						applied_results: appliedResults,
						remaining_changes: remainingChanges,
						retry: { tool: "task_harness", arguments: { action: "change", changes: remainingChanges,
							decision: request.decision } },
						recovery: appliedResults.length > 0
							? "Some changes were applied. Inspect the receipt and retry only remaining_changes; do not replay applied targets."
							: "Repair or revise the same parent-authored candidate, then resubmit the exact retry call; inspect the failed receipt before retrying.",
						recordedAt: new Date().toISOString(),
					});
					return { isError: true, content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
			}
		}
		const createdResourceRefs = results.map(row => (row.resource as any)?.resource_ref).filter(Boolean) as string[];
		const receipt = { format: "task-harness-change-receipt-v1", change_ref: changeRef, status: "applied", decision: request.decision, results,
			activation: {
				instruction: "Creation adds pool versions only. Explicitly assemble applicable exact versions, then follow their use_after_selection entries. Cite exact versions used in a later decision; assess the actual outcome separately.",
				created_resource_refs: createdResourceRefs,
				created_resources: createdResourceRefs.map(ref => {
					const entry = componentPool().find(item => item.resource_ref === ref);
					return entry ? componentReadiness(entry) : {resource_ref:ref};
				}),
				current_assembly: currentAssembly() ?? null,
				assemble_template: { action: "assemble", expected_assembly_revision: currentAssembly()?.revision ?? 0,
					selected_resource_refs: currentAssembly()?.selected_resource_refs ?? [],
					prompt_contributions: currentAssembly()?.prompt_contributions ?? [] },
				required_agent_fields: ["selected_resource_refs (choose exact eligible versions)", "decision (basis_refs, reason, expected)"],
			} };
		append("task-harness-change-receipts.jsonl", { ...receipt, recordedAt: new Date().toISOString() });
		append("task-harness-conversion-intents.jsonl", {
			...intentRecord, version: 2, status: "applied_pending_assembly", phase: "pool_written",
			resource_refs: createdResourceRefs,
			recovery: "Select exact eligible versions with task_harness(action=assemble), then invoke a selected skill/tool/subagent or project the system prompt and record the downstream trial.",
			recordedAt: new Date().toISOString(),
		});
		return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
	};
	pi.registerTool({
		name: HARNESS_BOOTSTRAP_TOOL,
		label: "Task-local harness compatibility entry",
		description: "Compatibility activation aliases only; cannot create or bypass task_harness(change).",
		parameters: Type.Object({
			component: Type.Union([
				Type.Literal("research"), Type.Literal("memory"),
				Type.Literal("system_prompt"),
				Type.Literal("skill"), Type.Literal("tool"), Type.Literal("subagent"),
				Type.Literal("policy"), Type.Literal("compaction"), Type.Literal("assessment"),
				Type.Literal("status"),
			]),
			reason: Type.String(),
		}),
		async execute(_toolCallId, params) {
			const component = String(params.component);
			const names: Record<string, string[]> = {
				research: ["research_resource"],
				memory: ["task_harness"],
				system_prompt: ["task_harness"],
				skill: ["task_harness", "read"],
				tool: ["task_harness"],
				subagent: ["task_harness", "delegate_task"],
				policy: ["task_tool_policy"],
				compaction: [OBSERVATION_COMPACTION_TOOL],
				assessment: ["assess_harness_effect"],
				status: ["task_harness_status"],
			};
			const requested = names[component];
			if (!requested) throw new Error(`unknown harness component: ${component}`);
			const registered = new Set(pi.getAllTools().map((tool) => tool.name));
			const unavailable = requested.filter((name) => !registered.has(name));
			if (unavailable.length) throw new Error(`harness component is unsupported by this adapter: ${unavailable.join(", ")}`);
			const active = [...new Set([...pi.getActiveTools(), ...requested, HARNESS_BOOTSTRAP_TOOL])];
			pi.setActiveTools(active);
			const record = {
				event: "component_activated",
				component,
				reason: String(params.reason),
				active_tools: active,
				recordedAt: new Date().toISOString(),
			};
			append("task-harness-bootstrap.jsonl", record);
			return { content: [{ type: "text", text: JSON.stringify(record) }], details: record };
		},
	});
	if (dependencies.taskToolAdapter) {
		installTaskLocalTools(pi, {
			root,
			append,
			allocateDecisionId: dependencies.allocateDecisionId,
			resolveBasisRefs,
		}, dependencies.taskToolAdapter);
	}
	// Pi keeps excluded built-ins discoverable through getAllTools(), and its
	// active set is not complete while extensions are loading. Capture the
	// post-initial-request active set, then keep runner-denied host capabilities
	// out even if a Pi version reports them as active during startup.
	const runnerDeniedNativeTools = new Set(["bash", "edit", "write", "grep", "find", "ls"]);
	let initiallyAuthorizedTools: Set<string> | undefined;
	const protectedManagementTools = new Set<string>(process.env.PI_ARC_EXECUTION_GATE === "enabled"
		? ["task_harness", "task_harness_create"]
		: ["task_harness", "task_harness_create", "task_tool_policy", "task_memory_pool"]);
	const captureAuthorization = () => {
		if (!initiallyAuthorizedTools) {
			const registeredTools = new Set(pi.getAllTools().map((tool) => tool.name));
			initiallyAuthorizedTools = new Set(
				pi.getActiveTools().filter((tool) => !runnerDeniedNativeTools.has(tool)),
			);
			for (const tool of protectedManagementTools) {
				// Optional adapters (notably task_subagent) must not become
				// phantom authorized tools merely because the shared harness knows
				// their names.
				if (registeredTools.has(tool)) initiallyAuthorizedTools.add(tool);
			}
		}
		return initiallyAuthorizedTools;
	};
	const authorizedTools = () => {
		// Authorization and disclosure are separate concerns. After the compact
		// two-level ARC entry, legitimate creation tools are intentionally not
		// active yet, but they must still be enable-able. Restrict this expansion
		// to registered task-local tools; never authorize arbitrary/inactive host
		// capabilities.
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		// These are registered by the shared research layer when present. They
		// are control-plane capabilities, not resources, and must be enable-able
		// from ARC's compact initial surface without being eagerly disclosed.
		const optionalControlTools = ["task_resource", "task_validation", OBSERVATION_COMPACTION_TOOL];
		const result = new Set([...SELF_HARNESS_MANAGEMENT_TOOLS, ...SUBAGENT_MANAGEMENT_TOOLS, ...optionalControlTools]
			.filter((tool) => registered.has(tool)));
		// `read` is the scoped task-local reader registered below.  It is not a
		// host filesystem capability: it can only read files under this run's
		// task-harness/skills and task-harness/agents directories.  Keep it out of
		// the compact initial surface, but make it reachable when the Agent chooses
		// the skill/subagent resource path.
		if (registered.has("read")) result.add("read");
		for (const tool of captureAuthorization()) result.add(tool);
		for (const item of readJsonl("task-tools.jsonl")) {
			if (item.status === "active" && typeof item.exposed_name === "string") result.add(item.exposed_name);
		}
		return result;
	};
	// Capture after all startup hooks have chosen the adapter-specific surface.
	pi.on("context", () => { captureAuthorization(); return {}; });
	let focusedResourceRefs: Set<string> | undefined;
	const latestProviderContext = () => readJsonl("context-token-debug.jsonl")
		.filter((row) => row.event === "provider_request_context" && row.scope === "treatment")
		.at(-1);
	const contextModuleCosts = (snapshot: Record<string, any> | undefined) =>
		Object.entries(snapshot?.modules ?? {})
			.map(([name, stats]) => ({ name, estimated_tokens: Number((stats as any)?.estimated_tokens ?? 0),
				items: Number((stats as any)?.item_count ?? 0) }))
			.sort((left, right) => right.estimated_tokens - left.estimated_tokens);
	const contextChoiceBaseline = () => {
		const snapshot = latestProviderContext();
		return snapshot ? {
			request_id: snapshot.request_id, turn: snapshot.turn,
			estimated_input_tokens: snapshot.estimated_input_tokens,
			measurement_basis: snapshot.measurement_basis,
			modules: contextModuleCosts(snapshot),
		} : null;
	};
	const recordContextChoice = (control: string, toolCallId: string, before: Record<string, any>, after: Record<string, any>) => {
		append("task-context-choices.jsonl", {
			format: "agent-context-choice-v1", control, toolCallId,
			before, after, baseline: contextChoiceBaseline(), recordedAt: new Date().toISOString(),
		});
	};
	const contextCostReport = () => {
		const current = latestProviderContext();
		const usage = current ? readJsonl("context-token-debug.jsonl")
			.filter((row) => row.event === "provider_response_usage" && row.request_id === current.request_id)
			.at(-1) : undefined;
		const childSnapshots = new Map<string, Record<string, any>>();
		for (const row of readJsonl("subagent-context-token-debug.jsonl")) {
			if (row.event !== "provider_request_context") continue;
			const id = String(row.child_context_id ?? `pid:${String(row.process_id ?? "unknown")}`);
			childSnapshots.set(id, row);
		}
		const childCosts = [...childSnapshots.entries()].map(([id, row]) => ({
			child_context_id:id, scope:row.scope, request_id:row.request_id,
			estimated_input_tokens:row.estimated_input_tokens,
			measurement_basis:row.measurement_basis,
		}));
		const choice = readJsonl("task-context-choices.jsonl").at(-1);
		const baseline = choice?.baseline;
		const comparisonReady = Boolean(current && baseline?.request_id && current.request_id !== baseline.request_id);
		const comparable = comparisonReady && current?.measurement_basis === baseline?.measurement_basis;
		const oldModules = new Map<string, number>((baseline?.modules ?? [])
			.map((item: any): [string, number] => [String(item.name), Number(item.estimated_tokens ?? 0)]));
		const moduleDeltas = comparable ? contextModuleCosts(current).map((item) => ({
			name: item.name, estimated_token_delta: item.estimated_tokens - (oldModules.get(item.name) ?? 0),
		})).filter((item) => item.estimated_token_delta !== 0)
			.sort((left, right) => Math.abs(right.estimated_token_delta) - Math.abs(left.estimated_token_delta)) : [];
		return {
			format: "agent-context-cost-report-v1",
			latest_request: current ? {
				request_id: current.request_id, turn: current.turn,
				measurement_basis: current.measurement_basis,
				estimated_input_tokens: current.estimated_input_tokens,
				actual_usage: usage ? { input_tokens: usage.actual_input_tokens,
					output_tokens: usage.actual_output_tokens, cache_read_tokens: usage.cache_read_tokens,
					cache_write_tokens: usage.cache_write_tokens } : null,
				message_count: current.message_count,
				tool_definition_count: current.tool_definition_count,
				modules: contextModuleCosts(current),
				largest_tool_definitions: [...(current.tool_definition_sizes ?? [])]
					.sort((left: any, right: any) => Number(right.json_chars ?? 0) - Number(left.json_chars ?? 0))
					.slice(0, 8).map((tool: any) => ({name: tool.name, estimated_tokens: Math.ceil(Number(tool.json_chars ?? 0) / 4)})),
			} : null,
			child_sessions: {count:childCosts.length, recent:childCosts.slice(-8)},
			historical_results: parentResults.inspect(),
			last_choice: choice ? {control: choice.control, before: choice.before, after: choice.after,
				baseline, later_request_observed: comparisonReady, comparable_measurement_basis: comparable,
				...(comparable ? { estimated_token_delta: Number(current?.estimated_input_tokens ?? 0)
					- Number(baseline.estimated_input_tokens ?? 0), module_deltas: moduleDeltas } : {})} : null,
			current_controls: {
				focused_resource_refs: focusedResourceRefs === undefined ? null : [...focusedResourceRefs].sort(),
				active_tools: pi.getActiveTools(),
			},
			available_actions: {
				assembly_refs: {tool:"task_harness",arguments:{action:"inspect",section:"current_assembly"}},
				focus: {tool:"task_harness",arguments:{action:"focus",resource_refs:["<exact assembled resource ref>"]}},
				compact_results: {tool:"task_harness",arguments:{action:"compact_results",result_refs:["<tool_result ref>"],result_reason:"<why the current decision no longer needs this body>"}},
				restore_results: {tool:"task_harness",arguments:{action:"restore_results",result_refs:["<tool_result ref>"]},effect:"Pin exact saved result in subsequent model context."},
				restore_all_assembled_resources: {tool:"task_harness",arguments:{action:"focus",resource_refs:[]}},
				tool_policy: pi.getActiveTools().includes("task_tool_policy")
					? {tool:"task_tool_policy",arguments:{action:"inspect"}}
					: {tool:"task_harness",arguments:{action:"activate",enabled_tools:["task_tool_policy"]}},
				...(pi.getAllTools().some((tool) => tool.name === OBSERVATION_COMPACTION_TOOL) ? {
					observation_representation: pi.getActiveTools().includes(OBSERVATION_COMPACTION_TOOL)
						? {tool:OBSERVATION_COMPACTION_TOOL,prerequisite:"active finding citing exact observation IDs"}
						: {tool:"task_harness",arguments:{action:"activate",enabled_tools:["compaction"]}},
				} : {}),
				continuity_checkpoint: pi.getActiveTools().includes("task_checkpoint")
					? {tool:"task_checkpoint",arguments:{action:"update",working_summary:"<current hypotheses, counterevidence, plan and next test>",summary_basis_refs:["<exact evidence ref>"]}}
					: null,
				exact_evidence: pi.getActiveTools().includes("task_resource")
					? {tool:"task_resource",arguments:{action:"read",ref:"<exact task resource ref>",offset:0,limit:2000}}
					: {tool:"task_harness",arguments:{action:"activate",enabled_tools:["task_resource"]}},
			},
			note: "Costs are heuristic per provider request, not cumulative usage. Select controls only if their content is irrelevant to the current decision; preserve hypotheses, counterevidence, plans and recovery refs. Reopen exact evidence when needed. Compare a later request after a choice; changes in task state may also affect the total.",
		};
	};
	const resourceRefVariants = (kind: string, item: Record<string, any>) => {
		const idField = ({ skill: "skill_id", memory: "memory_id",
			system_prompt: "segment_id", tool: "tool_id", subagent: "agent_id" } as Record<string, string>)[kind];
		const identifiers = [item[idField], item.name, item.key, item.exposed_name].filter((value): value is string => typeof value === "string" && value.length > 0);
		return identifiers.map((identifier) => `${kind}:${identifier}@v${String(item.version ?? 1)}`);
	};
	const knownTaskResourceRefs = () => new Set([
		...readJsonl("task-skills.jsonl").flatMap((item) => resourceRefVariants("skill", item)),
		...readJsonl("task-memory.jsonl").flatMap((item) => resourceRefVariants("memory", item)),
		...readJsonl("task-system-prompt.jsonl").flatMap((item) => resourceRefVariants("system_prompt", item)),
		...readJsonl("task-tools.jsonl").flatMap((item) => resourceRefVariants("tool", item)),
		...readJsonl("task-subagents.jsonl").flatMap((item) => resourceRefVariants("subagent", item)),
	]);
	const currentAssembly = () => latestHarnessAssembly(readJsonl("task-harness-assemblies.jsonl"));
	const preparedAuthoringTemplate = (name:any,creatorRef:string) => {
		const template=creatorCandidateTemplate(name,creatorRef);
		return template ? {...template,change_call:{...template.change_call,
			assembly:{expected_assembly_revision:currentAssembly()?.revision ?? 0,
				selected_resource_refs:currentAssembly()?.selected_resource_refs ?? []}}} : undefined;
	};
	const currentConversionWorkset = () => {
		const trials = readJsonl("harness-observations.jsonl").filter(row => row.actual_use === true)
			.map(row => ({observation_ref:String(row.observation_id),resource_refs:row.resource_refs ?? []}));
		for (const row of readJsonl("execution-observations.jsonl")) {
			if (row.tool_name !== "arc_action" || row.is_error) continue;
			const refs = (row.input?.decision?.basis_refs ?? []).flatMap((ref: string) => {
				const kind = String(ref).split(":")[0];
				if (!["memory", "skill", "tool", "subagent", "system_prompt"].includes(kind)) return [];
				try { return [resourceMetadata(kind, resolveTaskResource(root, ref)).resource_ref]; } catch { return []; }
			});
			if (refs.length) trials.push({observation_ref:String(row.observation_id),resource_refs:refs});
		}
		return conversionWorkset(readJsonl("task-harness-conversion-intents.jsonl"),
			currentAssembly()?.selected_resource_refs ?? [], {
				eligibleRefs:componentPool().filter(entry => entry.eligible).map(entry => entry.resource_ref), trials,
			});
	};
	const componentPool = (): Array<HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }> => {
		const validity = currentKnowledge();
		const methods = [...latestMethodRecords(readJsonl("task-method-lifecycle.jsonl")).values()];
		const sources: Array<[HarnessComponentKind, Record<string, any>[]]> = [
			["memory", [...memories.values()]],
			["system_prompt", [...systemPrompts.values()]],
			["skill", [...skills.values()]],
			["tool", [...latestBy(readJsonl("task-tools.jsonl"), "name").values()]],
			["subagent", [...latestBy(readJsonl("task-subagents.jsonl"), "name").values()]],
		];
		return sources.flatMap(([kind, records]) => records.map(record => {
			const resourceRef = resourceMetadata(kind, record).resource_ref;
			const method = methods.findLast(row => (row.resource_refs ?? []).includes(resourceRef));
			const reasons = validity.reasons(kind, record);
			const methodRejection = methodUseRejection(methods, [resourceRef], readJsonl("effect-assessments.jsonl"));
			if (methodRejection) reasons.push(methodRejection);
			return {
				kind,
				resource_ref: resourceRef,
				...(method ? {method_trial: {method_ref:`method:${method.method_id}@v${method.version}`,
					maturity:method.maturity, next_use:method.method?.next_use, falsifier:method.method?.falsifier,
					actual_use_refs:method.actual_use_observation_refs ?? [], validation_refs:method.validation_refs ?? [],
					research_line_ref:method.research_line_ref}} : {}),
				name: String(record.name ?? record.key ?? ""),
				version: Number(record.version ?? 1),
				status: String(record.status ?? "active"),
				availability: String(record.availability ?? (record.status === "retired" ? "retired" : "loaded")),
				eligible: reasons.length === 0,
				reasons,
				...(record.summary ? { summary: compactText(record.summary) } : {}),
				...(record.scope ? { scope: record.scope } : {}),
				...(kind === "memory" && record.atom ? { atom: {
					subject: String(record.atom.subject), predicate: String(record.atom.predicate),
					value_preview: compactText(canonicalTextBody(record.atom.value, "memory atom.value")).slice(0, 240),
				} } : {}),
				aliases: resourceRefVariants(kind, record),
				record,
			};
		}));
	};
	const useEntrypoint = (entry: HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }) => {
		if (entry.kind === "skill" && scopedReadRegistered)
			return {tool:"read",arguments:{path:entry.record.file}};
		if (entry.kind === "skill") return {tool:"task_harness",arguments:{action:"focus",resource_refs:[entry.resource_ref]},
			...(pi.getActiveTools().includes("read") ? {optional_scoped_read:{tool:"read",arguments:{path:entry.record.file}}} : {})};
		if (entry.kind === "tool") {
			const pureGrid = entry.record.program?.format === "task-pure-expression-v1"
				&& entry.record.adapter_id === "arc_agi_3"
				&& Object.prototype.hasOwnProperty.call(entry.record.input_schema?.properties ?? {}, "grid");
			return {tool:String(entry.record.exposed_name),arguments:pureGrid
				? "For a grid from the current snapshot: {parameters:{},bindings:[{name:'grid',ref:'<exact current observation_snapshot ref>',path:['public_state','frames','0']}]}. Add other literal input fields only to parameters. The binding fills input.grid; omit parameters.grid and any $binding placeholder. current_state_frame is a display label, not a snapshot field."
				: entry.record.program?.format === "task-pure-expression-v1"
					? "Use {parameters:{<literal input fields>},bindings:[{name:'<bound input field>',ref:'<exact authorized ref>',path:[...]}]}; omit any same-named parameter and any $binding placeholder."
					: "<supply input matching the inspected input_schema>"};
		}
		if (entry.kind === "subagent") {
			// An editable call template, not an invocation or implicit data grant.
			// Omit the optional locator if preparing it exceeds the bounded scan.
			let sceneRef: string | undefined;
			if (process.env.PI_ARC_EXECUTION_GATE === "enabled") {
				try { sceneRef = latestArcObservationSnapshot(root, 8 * 1024 * 1024)?.ref; } catch {}
			}
			return {tool:"delegate_task",arguments:{agent_name:entry.name,task:"<concrete bounded task>",
				...(sceneRef ? {evidence_refs:[sceneRef]} : {})}};
		}
		return {effect: entry.kind === "system_prompt"
			? "Applied to the system prompt at the next parent turn."
			: "Selected scoped knowledge is projected into the task context; no extra read is required."};
	};
	const lastFailureForComponent = (entry: HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }) => {
		const matches = readJsonl("task-operation-failures.jsonl").filter(failure => {
			const input = failure.attempted_input ?? {};
			const refs = [
				...(Array.isArray(input.selected_resource_refs) ? input.selected_resource_refs : []),
				...(Array.isArray(input.resource_refs) ? input.resource_refs : []),
				...(Array.isArray(input.review) ? input.review.flatMap((item: Record<string,any>) => item.resource_refs ?? []) : []),
			];
			if (refs.some((ref: string) => entry.aliases.includes(String(ref)))) return true;
			return (input.changes ?? []).some((change: Record<string,any>) =>
				String(change?.candidate?.name ?? change?.candidate?.key ?? "") === entry.name);
		});
		const failure = matches.at(-1);
		return failure ? {failure_ref:failure.resource_ref,error:failure.error,
			retryable:failure.retryable,required_next_call:failure.required_next_call ?? null} : null;
	};
	const componentReadiness = (entry: HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }) => {
		const assembly = currentAssembly();
		const identity = `${entry.kind}:${entry.name}@v`;
		const conflictingSelections = (assembly?.selected_resource_refs ?? [])
			.filter(ref => ref.startsWith(identity) && ref !== entry.resource_ref);
		const selectionCall = !entry.eligible || conflictingSelections.length || assemblySelectsReference(assembly,entry.aliases) ? null : {tool:"task_harness",arguments:{
			action:"assemble",expected_assembly_revision:Number(assembly?.revision ?? 0),
			selected_resource_refs:[...new Set([...(assembly?.selected_resource_refs ?? []),entry.resource_ref])],
			decision:{basis_refs:[entry.resource_ref],reason:"<why this exact component applies now>",expected:"<observable result at its next use>"},
		}};
		return {
			resource_ref:entry.resource_ref,
			eligible:entry.eligible,
			reasons:entry.reasons,
			selection_call:selectionCall,
			...(conflictingSelections.length ? {selection_repair_required:{
				conflicting_exact_refs:conflictingSelections,
				instruction:"A different version of this component remains selected. Main must explicitly choose the desired exact version and submit the complete assembly; runtime will not replace or delete a selection.",
			}} : {}),
			use_after_selection:entry.eligible ? useEntrypoint(entry) : null,
			last_failure:lastFailureForComponent(entry),
		};
	};
	const resolveCurrentComponentRef = (reference: string): string | undefined => {
		const item = componentPool().find(entry => entry.eligible
			&& (entry.resource_ref === reference || entry.aliases.includes(reference)));
		return item?.resource_ref;
	};
	const resolvePromptSourceRef = (reference: string): string | undefined => {
		const kind = String(reference).split(":", 1)[0];
		if ((["memory", "system_prompt", "skill", "tool", "subagent"] as string[]).includes(kind)) {
			return resolveCurrentComponentRef(reference);
		}
		try {
			const record = resolveTaskResource(root, reference);
			return resourceMetadata(kind, record).resource_ref;
		} catch {
			return undefined;
		}
	};
	const referenceAvailable = (reference: string): boolean => Boolean(resolvePromptSourceRef(reference));
	let lastJevRoutingSignature = "";
	let currentJevPrompt = "";
	const jevCandidate = (entry: HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }): JevHarnessCandidate => {
		const record = entry.record;
		const description = [
			record.description,
			record.summary,
			record.scope ? `scope=${String(record.scope)}` : "",
			record.applicability ? `applicability=${String(record.applicability)}` : "",
			record.atom ? `memory=${canonicalTextBody(record.atom.value, "memory atom.value")}` : "",
			record.instructions,
			record.content,
		].map(value => compactText(value)).filter(Boolean).join("; ").slice(0, 900);
		return {
			resource_ref: entry.resource_ref,
			kind: entry.kind,
			name: entry.name,
			description: description || `${entry.kind} ${entry.name}`,
			metadata: {
				version: entry.version,
				...(record.expected_effect ? { expected_effect: compactText(record.expected_effect) } : {}),
				...(record.reconsider_when ? { reconsider_when: compactText(record.reconsider_when) } : {}),
			},
		};
	};
	const routeCurrentHarness = async (agentState: string) => {
		const mode = jevRoutingMode();
		if (mode === "disabled") return;
		const candidates = componentPool().filter(entry => entry.eligible).map(jevCandidate);
		const checkpoint = readCurrentTaskCheckpoint(root);
		const state = {
			current_agent_request: agentState.slice(-12_000),
			task_checkpoint: checkpoint,
			recent_execution_observations: readJsonl("execution-observations.jsonl").slice(-6).map(row => ({
				observation_id: row.observation_id,
				tool_name: row.tool_name,
				result: compactText(row.result_text ?? row.output ?? "").slice(0, 500),
			})),
			current_selection: currentAssembly()?.selected_resource_refs ?? [],
		};
		const signature = JSON.stringify([mode, state, candidates]);
		if (signature === lastJevRoutingSignature) return;
		lastJevRoutingSignature = signature;
		const receipt = await routeHarnessComponents({ mode, state, candidates });
		const recordedAt = new Date().toISOString();
		if (mode !== "active" || receipt.status !== "selected") {
			append("task-harness-jev-routing.jsonl", { ...receipt, applied: false, recordedAt });
			return;
		}
		const previous = currentAssembly();
		const contributionDependencies = (previous?.prompt_contributions ?? [])
			.map(item => item.source_ref)
			.filter(ref => /^(memory|system_prompt|skill|tool|subagent):/.test(ref));
		const selectedResourceRefs = [...new Set([
			...receipt.selected_resource_refs,
			...contributionDependencies,
		])];
		const currentRefs = previous?.selected_resource_refs ?? [];
		if (JSON.stringify([...currentRefs].sort()) === JSON.stringify([...selectedResourceRefs].sort())) {
			append("task-harness-jev-routing.jsonl", {
				...receipt, applied: false, applied_resource_refs: selectedResourceRefs,
				reason: "selection_unchanged", recordedAt,
			});
			return;
		}
		try {
			const assembly = createHarnessAssembly({
				input: {
					expected_assembly_revision: Number(previous?.revision ?? 0),
					selected_resource_refs: selectedResourceRefs,
					decision: {
						basis_refs: [],
						reason: "pi-jev selected the exact eligible component versions for the current provider request",
						expected: "Expose only the selected Harness knowledge and capabilities on this request",
					},
				},
				previous,
				selectionMode: "jev",
				resolveComponentRef: resolveCurrentComponentRef,
				resolveSourceRef: resolvePromptSourceRef,
			});
			focusedResourceRefs = undefined;
			append("task-harness-assemblies.jsonl", assembly);
			append("task-harness-assembly-receipts.jsonl", {
				format: "task-harness-assembly-receipt-v1", applied: true, source: "jev",
				assembly_ref: `harness_assembly:${assembly.assembly_id}@v${assembly.revision}`,
				current_assembly: assembly, recordedAt,
			});
			append("task-harness-jev-routing.jsonl", {
				...receipt, applied: true, applied_resource_refs: selectedResourceRefs,
				assembly_ref: `harness_assembly:${assembly.assembly_id}@v${assembly.revision}`,
				recordedAt,
			});
		} catch (error) {
			append("task-harness-jev-routing.jsonl", {
				...receipt, applied: false, apply_error: error instanceof Error ? error.message : String(error),
				recordedAt,
			});
		}
	};
	pi.on("before_agent_start", async event => {
		currentJevPrompt = String(event.prompt ?? "");
		await routeCurrentHarness(currentJevPrompt);
		return {};
	});
	const resourceIsAssembled = (kind: string, item: Record<string, any>) =>
		assemblySelectsReference(currentAssembly(), resourceRefVariants(kind, item));
	const resourceIsFocused = (kind: string, item: Record<string, any>) =>
		resourceIsAssembled(kind, item)
		&& (focusedResourceRefs === undefined || resourceRefVariants(kind, item).some((ref) => focusedResourceRefs?.has(ref)));
	const resourceIsExplicitlyFocused = (kind: string, item: Record<string, any>) =>
		focusedResourceRefs !== undefined && resourceIsFocused(kind, item);
	const applyAssemblyToolSurface = () => {
		const assembly = currentAssembly();
		const allDynamicNames = new Set(readJsonl("task-tools.jsonl")
			.map((item) => String(item.exposed_name ?? "")).filter(Boolean));
		const pool = componentPool();
		const selectedDynamicNames = pool
			.filter((entry) => entry.kind === "tool" && entry.eligible
				&& assemblySelectsReference(assembly, entry.aliases))
			.map((entry) => String(entry.record.exposed_name ?? "")).filter(Boolean);
		const selectedSubagent = pool.some((entry) => entry.kind === "subagent" && entry.eligible
			&& assemblySelectsReference(assembly, entry.aliases));
		const selectedSkill = pool.some((entry) => entry.kind === "skill" && entry.eligible
			&& assemblySelectsReference(assembly, entry.aliases));
		const memoryManagementNeeded = pool.some((entry) => entry.kind === "memory"
			&& (!entry.record.probe_record || assemblySelectsReference(assembly, entry.aliases)));
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		pi.setActiveTools([...new Set([
			...pi.getActiveTools().filter((name) => !allDynamicNames.has(name)),
			...selectedDynamicNames,
			...(selectedSubagent && registered.has("delegate_task") ? ["delegate_task"] : []),
			...(selectedSkill && scopedReadRegistered && registered.has("read") ? ["read"] : []),
			...(memoryManagementNeeded
				&& registered.has("task_memory_pool") ? ["task_memory_pool"] : []),
			...protectedManagementTools,
		])]);
	};
	const validateParentAssembly = (input: Record<string, any>) => createHarnessAssembly({
		input, previous:currentAssembly(), resolveComponentRef:resolveCurrentComponentRef,
		resolveSourceRef:resolvePromptSourceRef,
	});
	const applyParentAssembly = (input: Record<string, any>) => {
		try {
			const assembly = validateParentAssembly(input);
			focusedResourceRefs = undefined;
			append("task-harness-assemblies.jsonl", assembly);
			applyAssemblyToolSurface();
			const receipt = {format:"task-harness-assembly-receipt-v1",applied:true,
				assembly_ref:`harness_assembly:${assembly.assembly_id}@v${assembly.revision}`, current_assembly:assembly,
				components:componentPool().filter(entry => entry.eligible && assemblySelectsReference(assembly,entry.aliases))
					.map(entry => ({resource_ref:entry.resource_ref,kind:entry.kind,use:useEntrypoint(entry)}))};
			append("task-harness-assembly-receipts.jsonl", {...receipt,recordedAt:new Date().toISOString()});
			return {content:[{type:"text" as const,text:JSON.stringify(receipt)}],details:receipt};
		} catch(error) {
			let details:Record<string,any>;
			try {details=assemblyConflictDetails(error) as Record<string,any>;}
			catch {details=assemblyInputErrorDetails(error,input,currentAssembly()) as Record<string,any>;}
			return {isError:true,content:[{type:"text" as const,text:JSON.stringify(details)}],details};
		}
	};
	const publishParentChanges = async (toolCallId:string,input:Record<string,any>) => {
		if (input.assembly === undefined) return applyFacadeChanges(toolCallId,input);
		const request = normalizeCapabilityRequest({action:"change",changes:input.changes,decision:input.decision});
		if (request.action !== "change" || request.changes.some(change => !["create","update"].includes(change.operation)))
			throw new Error("assembly publication only accepts create/update changes; use separate assembly for retirement or reuse");
		const selection = {...input.assembly,decision:request.decision};
		// Validate current CAS, retained refs and contributions before any write.
		validateParentAssembly(selection);
		const changed = await applyFacadeChanges(toolCallId,input);
		if (changed.isError) return changed;
		const written = changed.details.activation.created_resource_refs;
		const compiled = {...selection,selected_resource_refs:[...new Set([...selection.selected_resource_refs,...written])]};
		const assembled = applyParentAssembly(compiled);
		const receipt = {...changed.details,requested_assembly:input.assembly,assembly_receipt:assembled.details,
			activation:{created_resource_refs:written,
				created_resources:written.map((ref:string) => {
					const entry=componentPool().find(item=>item.resource_ref===ref);
					return entry ? componentReadiness(entry) : {resource_ref:ref};
				}),current_assembly:currentAssembly() ?? null,
				...(assembled.isError ? {assemble_template:{action:"assemble",...compiled}} : {}),
				instruction:assembled.isError
					? "Component writes succeeded; assembly failed. Preserve the written versions and repair selection with a separate assemble call. Do not recreate the components."
					: "These written versions are explicitly assembled. Follow the use entries in assembly_receipt, apply them to the task, and inspect feedback. Creation and selection do not prove utility."}};
		append("task-harness-publication-receipts.jsonl",{...receipt,recordedAt:new Date().toISOString()});
		return {...(assembled.isError ? {isError:true} : {}),content:[{type:"text" as const,text:JSON.stringify(receipt)}],details:receipt};
	};
	pi.on("before_agent_start", () => {
		// Host first-turn initialization may hide lazy use interfaces on resume.
		// Restore the committed composition before Pi snapshots provider tools;
		// the context hook runs too late for that first request's tool schema.
		if (currentAssembly() || memories.size > 0 || successfulArcActions(readJsonl("execution-observations.jsonl")).length > 0)
			applyAssemblyToolSurface();
		return {};
	});
	const projectTranscriptForAssembly = (messages: any[]): any[] => {
		const nativeKinds: Record<string, { kind: string; file: string; key: string }> = {
			task_memory: { kind: "memory", file: "task-memory.jsonl", key: "key" },
			task_system_prompt: { kind: "system_prompt", file: "task-system-prompt.jsonl", key: "name" },
			task_skill: { kind: "skill", file: "task-skills.jsonl", key: "name" },
			task_tool: { kind: "tool", file: "task-tools.jsonl", key: "name" },
			task_subagent: { kind: "subagent", file: "task-subagents.jsonl", key: "name" },
		};
		const selectionByCall = new Map<string, boolean>();
		const memoryCaptureCalls = new Map<string, Record<string, any>>();
		const committedLevelReviewCalls = new Map<string, Record<string, any>>();
		for (const message of messages) for (const item of Array.isArray(message?.content) ? message.content : []) {
			const toolName = String(item?.name ?? item?.toolName ?? "");
			if (toolName === "task_memory_pool") {
				const args = (item?.arguments ?? item?.input ?? {}) as Record<string, any>;
				if (args.action === "capture") {
					const callId = String(item?.id ?? item?.toolCallId ?? "");
					if (callId) memoryCaptureCalls.set(callId, args);
				}
			}
			if (toolName === "task_harness") {
				const args = (item?.arguments ?? item?.input ?? {}) as Record<string, any>;
				if (args.action === "level_review") {
					const report = readJsonl("task-level-reviews.jsonl").find(row => row.window_id === args.window_id);
					const callId = String(item?.id ?? item?.toolCallId ?? "");
					if (report && callId) committedLevelReviewCalls.set(callId, report);
				}
			}
			const descriptor = nativeKinds[toolName];
			if (!descriptor) continue;
			const args = (item?.arguments ?? item?.input ?? {}) as Record<string, any>;
			const identity = String(args[descriptor.key] ?? "").trim();
			const record = identity ? latestBy(readJsonl(descriptor.file), descriptor.key).get(identity) : undefined;
			const callId = String(item?.id ?? item?.toolCallId ?? "");
			if (callId) selectionByCall.set(callId, Boolean(record && resourceIsAssembled(descriptor.kind, record)));
		}
		const completedCreatorReads = completedCreatorReadCalls(messages);
		const supersededFailedCandidates = supersededFailedCandidateCalls(messages);
		return messages.map((message) => {
			const callId = String(message?.toolCallId ?? "");
			if (message?.role === "toolResult") {
				const text = message.content?.find((part: any) => part?.type === "text")?.text;
				if (typeof text === "string") {
					let receipt: Record<string, any> | undefined;
					try { receipt = JSON.parse(text); } catch { /* Leave non-JSON results untouched. */ }
					if (message.toolName === "task_harness" && receipt?.format === "baseline-method-read-v1"
						&& completedCreatorReads.has(callId)) {
						const history = compactCompletedCreatorRead(receipt);
						return { ...message, content: [{ type: "text", text: JSON.stringify(history) }], details: history };
					}
					if (message.toolName === "task_harness" && receipt?.format === "baseline-method-read-v1"
						&& !Object.hasOwn(receipt, "content_offset")
						&& String(receipt.content ?? "").length > DEFAULT_METHOD_PAGE_CHARS) {
						const page = projectBaselineMethodPage(receipt);
						const detailKeys = message.details && typeof message.details === "object"
							? Object.keys(message.details) : [];
						const details = detailKeys.length && detailKeys.every(key =>
							Object.hasOwn(page, key) && JSON.stringify(page[key]) === JSON.stringify(message.details[key]))
							? { same_as_content_fields: detailKeys } : message.details;
						return { ...message, content: [{ type: "text", text: JSON.stringify(page) }], details };
					}
					if (message.toolName === "task_harness" && receipt?.format === "task-harness-control-receipt-v1")
						return { ...message, details: receipt };
					// The original tool result remains intact; the provider copy needs
					// only one of two byte-identical JSON representations.
					if (receipt && message.details) {
						try {
							if (text === JSON.stringify(message.details))
								return { ...message, details: { same_as_content: true } };
							if (typeof message.details === "object" && !Array.isArray(message.details)) {
								const keys = Object.keys(message.details);
								if (keys.length && keys.every(key => Object.hasOwn(receipt, key)
									&& JSON.stringify(receipt[key]) === JSON.stringify(message.details[key])))
									return { ...message, details: { same_as_content_fields: keys } };
							}
						} catch { /* Non-serializable details retain their original projection. */ }
					}
				}
			}
			const archivedReview = committedLevelReviewCalls.get(callId);
			if (message?.role === "toolResult" && archivedReview) {
				const receipt = levelReviewReceipt(archivedReview);
				return { ...message, content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			}
			if (message?.role === "toolResult" && callId && selectionByCall.get(callId) === false) {
				const projection = {
					format: "task-harness-transcript-projection-v1", selected: false,
					reason: "component_not_selected_by_current_assembly",
				};
				return { ...message, content: [{ type: "text", text: JSON.stringify(projection) }], details: projection };
			}
			if (!Array.isArray(message?.content)) return message;
			let changed = false;
			const content = message.content.map((item: Record<string, any>) => {
				const facadeToolName = String(item?.name ?? item?.toolName ?? "");
				const facadeArgsKey = item.arguments !== undefined ? "arguments" : item.input !== undefined ? "input" : undefined;
				const currentCallId = String(item?.id ?? item?.toolCallId ?? "");
				if (facadeToolName === "task_harness_create" && facadeArgsKey
					&& supersededFailedCandidates.has(currentCallId)) {
					const args = item[facadeArgsKey] as Record<string, any>;
					changed = true;
					return { ...item, [facadeArgsKey]: { ...args, candidate: compactSupersededCandidate(
						args.candidate, supersededFailedCandidates.get(currentCallId)!) } };
				}
				if (facadeToolName === "task_memory_pool" && facadeArgsKey && memoryCaptureCalls.has(currentCallId)) {
					const args = memoryCaptureCalls.get(currentCallId)!;
					changed = true;
					return { ...item, [facadeArgsKey]: { action: "capture", capture_id: args.capture_id ?? currentCallId,
						items: (args.items ?? []).map((entry: Record<string, any>, index: number) => ({
							index, key: entry.key ?? null, scope: entry.scope, claim_kind: entry.claim_kind ?? "observation",
							content: "<captured content retained in task-memory.jsonl>",
						})) } };
				}
				const review = committedLevelReviewCalls.get(currentCallId);
				if (facadeToolName === "task_harness" && facadeArgsKey && review) {
					const receipt = levelReviewReceipt(review);
					changed = true;
					return { ...item, [facadeArgsKey]: { action: "level_review", window_id: review.window_id,
						archived_review_ref: receipt.level_review_ref,
						success_path: receipt.success_path,
						failure_modes: receipt.failure_modes,
						outcome_cost_index_ref: receipt.outcome_cost_index_ref } };
				}
				if (facadeToolName === "task_harness" && facadeArgsKey) {
					const facadeArgs = { ...(item[facadeArgsKey] ?? {}) } as Record<string, any>;
					if (facadeArgs.action === "change" && Array.isArray(facadeArgs.changes)) {
						const projectedChanges = facadeArgs.changes.map((change: Record<string, any>) => {
							if (!change?.candidate || typeof change.candidate !== "object") return change;
							try {
								const candidate = normalizeSemanticCandidate(change.candidate);
								const target = classifySemanticKind(candidate);
								if (target === "research_only") return change;
								const kind = target === "system_prompt" ? "system_prompt" : target;
								const identity = String(kind === "memory" ? candidate.key ?? candidate.name : candidate.name ?? "").trim();
								const file = ({ memory: "task-memory.jsonl", system_prompt: "task-system-prompt.jsonl",
									skill: "task-skills.jsonl", tool: "task-tools.jsonl", subagent: "task-subagents.jsonl" } as Record<string, string>)[kind];
								const key = kind === "memory" ? "key" : "name";
								const record = file && identity ? latestBy(readJsonl(file), key).get(identity) : undefined;
								if (record && resourceIsAssembled(kind, record)) return change;
								changed = true;
								const redacted = { ...change.candidate } as Record<string, any>;
								for (const field of ["content", "append_content", "prompt_text", "instructions", "description", "program"]) {
									if (field in redacted) redacted[field] = "[omitted: component is not selected by the current Harness assembly]";
								}
								if (redacted.atom && typeof redacted.atom === "object") {
									redacted.atom = { ...redacted.atom, value: "[omitted: unselected memory atom]" };
								}
								return { ...change, candidate: redacted };
							} catch {
								return change;
							}
						});
						if (changed) return { ...item, [facadeArgsKey]: { ...facadeArgs, changes: projectedChanges } };
					}
				}
				const itemCallId = String(item?.id ?? item?.toolCallId ?? "");
				if (!itemCallId || selectionByCall.get(itemCallId) !== false) return item;
				const argsKey = item.arguments !== undefined ? "arguments" : item.input !== undefined ? "input" : undefined;
				if (!argsKey) return item;
				changed = true;
				const args = { ...(item[argsKey] ?? {}) };
				for (const key of ["content", "append_content", "prompt_text", "instructions", "description", "program"]) {
					if (key in args) args[key] = "[omitted: component is not selected by the current Harness assembly]";
				}
				return { ...item, [argsKey]: args };
			});
			return changed ? { ...message, content } : message;
		});
	};
	const recordResourceRead = (kind: string, item: Record<string, any>, via: string, access = "read") => {
		append("task-resource-access.jsonl", {
			access_id: `resource-access-${kind}-${item.decision_id ?? item.memory_id ?? item.skill_id ?? Date.now()}-${Date.now()}`,
			access,
			via,
			resource_kind: kind,
			resource_id: item.memory_id ?? item.skill_id,
			name: item.name ?? item.key,
			version: item.version,
			decision_id: item.decision_id,
			recordedAt: new Date().toISOString(),
		});
	};
	let lastResourceSignature = "";
	let capabilityExtractionAttempted = false;
	let lastParentGapReminder: string | null = null;
	let lastGoalModelReminder: string | null = null;
	let lastArcFeedbackSignature: string | null = null;

	const projectedSkills = new Set<string>();
	const projectedSystemPrompts = new Set<string>();
	const readSkills = new Set<string>();
	const projectedMemories = new Set(
		readJsonl("harness-observations.jsonl")
			.filter((item) => item.observation_kind === "pi_task_memory_context")
			.map((item) => String(item.decision_id ?? ""))
		.filter(Boolean),
	);
	const projectedTaskPromptMemories = new Set(
		readJsonl("harness-observations.jsonl")
			.filter((item) => item.observation_kind === "pi_task_prompt_projection")
			.map((item) => String(item.decision_id ?? ""))
			.filter(Boolean),
	);
	const compactionEnabled = process.env.PI_AUTORESEARCH_CONTEXT_COMPACTION === "enabled";
	let lastHarnessTriggerSignature = String(readJsonl("task-harness-opportunities.jsonl").at(-1)?.signature ?? "");
	let harnessOpportunityCounter = nextCounter(
		readJsonl("task-harness-opportunities.jsonl"), "opportunity_id",
	);
	// One durable commit is authoritative; the two public indexes are replayable projections.
	const recoverReviewCommits = () => {
		const reviews = new Set(readJsonl("task-harness-reviews.jsonl").map(row => row.review_id));
		const handoffs = new Set(readJsonl("auto-research-handoffs.jsonl").map(row => row.handoff_id));
		for (const commit of readJsonl("task-harness-review-commits.jsonl")) {
			if (commit.handoff && !handoffs.has(commit.handoff.handoff_id)) {
				append("auto-research-handoffs.jsonl", commit.handoff); handoffs.add(commit.handoff.handoff_id);
			}
			if (commit.review && !reviews.has(commit.review.review_id)) {
				append("task-harness-reviews.jsonl", commit.review); reviews.add(commit.review.review_id);
			}
		}
	};
	recoverReviewCommits();
	const periodicReviewEnabled = () => process.env.PI_HARNESS_PERIODIC_REVIEW === "enabled" && pi.getAllTools().some(tool => tool.name === "arc_action");
	const levelReviewObservations = () => {
		const resetReports = new Map(readJsonl("task-level-reset-reports.jsonl").map(row => [row.boundary_ref, row]));
		return readJsonl("execution-observations.jsonl").map(row => {
			const report = resetReports.get(row.observation_id);
			return report ? { ...row, arc_outcome: { ...row.arc_outcome, reset_report: report,
				public_transition: { ...row.arc_outcome?.public_transition, reset: true } } } : row;
		});
	};
	const levelWindows = () => levelReviewWindows(levelReviewObservations());
	const levelOutcomeCostIndex = (window: Record<string, any>, windows = levelWindows()) =>
		buildOutcomeCostIndex(window, windows, readJsonl("pi-events.jsonl"), levelReviewObservations());
	const persistLevelOutcomeCostIndex = (window: Record<string, any>, windows = levelWindows()) => {
		const current = levelOutcomeCostIndex(window, windows);
		const previous = readJsonl("task-outcome-cost-index.jsonl").filter(row => row.window_id === window.window_id);
		const matching = previous.find(row => row.source_cutoff_event === current.source_cutoff_event
			&& JSON.stringify(row.source_hashes) === JSON.stringify(current.source_hashes));
		const index = matching ?? { ...current,
			version: Math.max(0, ...previous.map(row => Number(row.version ?? 1))) + 1 };
		if (!matching) append("task-outcome-cost-index.jsonl", index);
		return { index, ref: `outcome_cost_index:${window.window_id}@v${index.version}` };
	};
	const levelReviewResources = () => ["memory", "skill", "tool", "subagent", "system_prompt"].flatMap(kind =>
		taskRecords(root, kind).map(row => ({ ...resourceMetadata(kind, row), recordedAt: row.recordedAt })));
	const levelReviewContract = (window: Record<string, any>) => {
		const { index, ref } = persistLevelOutcomeCostIndex(window);
		return { ...levelReviewInputContract(window, levelReviewObservations(), levelReviewResources()),
			outcome_cost_index_ref: ref, tool_call_count: index.calls.length,
			tool_call_ref_candidates_preview: index.calls.slice(-12).map((call: Record<string, any>) => call.call_ref),
			tool_call_index_summary: { coverage: index.coverage, gaps: index.gaps,
				whole_level: index.whole_level, since_previous_boundary: index.since_previous_boundary,
				provider_cost: index.provider_cost },
			instruction: "Read outcome_cost_index_ref with task_resource for the complete paged call list and exact call_refs before proposing omissions." };
	};
	const pendingLevelReviews = () => {
		const settled = new Set(readJsonl("task-level-reviews.jsonl").map(row => row.window_id));
		return levelWindows().filter(row => !settled.has(row.window_id));
	};
	let terminalReview = false;
	pi.on("before_agent_start", event => {
		terminalReview = String(event.prompt ?? "").trimStart().startsWith("ARC_TERMINAL_LEVEL_REVIEW");
		// A terminal review is a deterministic read-only phase.  The parent no
		// longer has to notice that the normal thin ARC surface hid the resource
		// reader, nor can it enable unrelated management tools at this boundary.
		if (terminalReview) pi.setActiveTools([...new Set([...pi.getActiveTools(), "task_harness", "task_resource"])]);
	});
	pi.on("tool_call", event => {
		if (!terminalReview) return;
		const action = (event.input as any)?.action;
		if (event.toolName === "task_resource" || (event.toolName === "task_harness" && ["level_review", "inspect", "status", "contract", "context"].includes(action))) return;
		return { block: true, reason: "Terminal level review permits evidence reads and level_review submission only; the environment is finished." };
	});
	const patternReviewQueue = () => {
		const queue = periodicReviewQueue(readJsonl("execution-observations.jsonl"),
			readJsonl("task-harness-reviews.jsonl"), readJsonl("task-harness-review-events.jsonl"));
		for (const worker of researchWorkers(root)) if (worker.handle_periodic_reviews) routeWorkerEvidence(root, worker);
		const assigned = queue.due.filter(window => researchWorkerWindowCoverage(root, window.evidence_refs).length);
		for (const window of assigned) if (!readJsonl("task-harness-review-events.jsonl")
			.some(row => row.window_id === window.window_id && row.status === "assigned"))
			append("task-harness-review-events.jsonl", { window_id: window.window_id, status: "assigned",
				worker_refs: researchWorkerWindowCoverage(root, window.evidence_refs), decided_by: "parent_worker_authorization",
				meaning: "historical analysis delegated; no review, semantic consumption or component adoption claimed",
				recordedAt: new Date().toISOString() });
		const due = queue.due.filter(window => !assigned.includes(window));
		return { ...queue, due, current: due.at(-1), assigned };
	};
	const pendingPeriodicReview = () => patternReviewQueue().current;
	const latestResearchHandoffs = () => {
		const records = readJsonl("auto-research-handoffs.jsonl");
		const updates = reconcileResearchHandoffs(
			records,
			readJsonl("auto-research-sessions.jsonl"),
			readJsonl("auto-research-reports.jsonl"),
		);
		for (const update of updates) append("auto-research-handoffs.jsonl", update);
		const latest = latestBy([...records, ...updates], "handoff_id");
		const actions = successfulArcActions(readJsonl("execution-observations.jsonl")).length;
		for (const [id, item] of latest) if (item.status === "deferred" && item.resume_condition?.kind === "after_actions"
			&& actions >= Number(item.resume_after_action_count)) {
			const reopened = advanceResearchHandoff(item, {status:"proposed", degraded:false, reactivated_by:"runtime_action_count"});
			append("auto-research-handoffs.jsonl", reopened); latest.set(id, reopened);
		}
		return latest;
	};
	const pendingResearchHandoff = () => [...latestResearchHandoffs().values()]
		.find(item => item.status === "proposed");
	const refreshCrossContextResearchCandidates = () => {
		const existing = latestBy(readJsonl("auto-research-opportunities.jsonl"), "candidate_id");
		for (const draft of buildCrossContextResearchCandidates({
			observations: readJsonl("execution-observations.jsonl"),
		})) {
			const previous = existing.get(String(draft.candidate_id));
			if (previous?.fingerprint === draft.fingerprint) continue;
			const version = Number(previous?.version ?? 0) + 1;
			const record = {
				...draft,
				version,
				research_line_ref: `research_line:${draft.candidate_id}@v1`,
				research_call: {
					action: "start",
					authoring_method_ref: researchAuthoringPrerequisite().authoring_method_ref,
					research_candidate_ref: `research_candidate:${draft.candidate_id}@v${version}`,
				},
				recordedAt: new Date().toISOString(),
			};
			append("auto-research-opportunities.jsonl", record);
			existing.set(String(record.candidate_id), record);
		}
		const consumed = new Set(readJsonl("auto-research-sessions.jsonl")
			.filter((row) => ["active", "pending", "completed"].includes(String(row.status ?? "")))
			.map((row) => String(row.research_candidate_ref ?? "")).filter(Boolean));
		return [...existing.values()]
			.filter((row) => row.status !== "skipped")
			.filter((row) => !String(row.action_signature ?? "").startsWith("arc_state:"))
			.filter((row) => !consumed.has(`research_candidate:${row.candidate_id}@v${row.version}`))
			.map((row) => ({
				candidate_ref: `research_candidate:${row.candidate_id}@v${row.version}`,
				reason: row.reason,
				action_signature: row.action_signature,
				evidence_refs: row.evidence_refs,
				situation_count: Array.isArray(row.situation_context_ids) ? row.situation_context_ids.length : 0,
				episode_count: Array.isArray(row.episode_context_ids) ? row.episode_context_ids.length : 0,
				research_call: row.research_call,
				skip_call: { tool: "auto_research", arguments: { action: "skip",
					research_candidate_ref: `research_candidate:${row.candidate_id}@v${row.version}`,
					research_reason: "<why this evidence does not justify research>" } },
				authoring_prerequisite: researchAuthoringPrerequisite(),
			}));
	};
	const exposeDecisionSurfacesForOpenWork = (candidateCount: number, intents: Record<string, any>[]) => {
		// The compact ARC entry remains small. Once the runtime has produced a
		// concrete research or conversion opportunity, however, hiding the
		// corresponding parent controls creates a dangling mechanism: the parent
		// can see the opportunity but cannot start/delegate/inspect it in the same
		// loop. Open only registered task-local controls; native component writers
		// remain behind task_harness(change).
		if (!candidateCount && !intents.length) return;
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		// An observation-derived research opportunity does not require every
		// status, validation and filesystem schema. Existing enable remains the
		// explicit discovery path; authorization and execution checks are intact.
		const onDemand = process.env.PI_ARC_EXECUTION_GATE === "enabled" && process.env.PI_ARC_TOOL_DISCLOSURE !== "existing";
		const open = (onDemand ? [...(candidateCount ? ["delegate_task"] : []), "task_resource"]
			: ["delegate_task", "task_harness_status", "task_tool_policy", "task_resource", "task_validation", "read"])
			.filter((name) => registered.has(name));
		if (open.length) pi.setActiveTools([...new Set([...pi.getActiveTools(), ...open, "task_harness", "auto_research"])]);
	};
	// Candidate discovery is a deterministic observation-index update. Run it at
	// the environment boundary so the parent does not have to remember to scan
	// old trajectories before a cross-context opportunity can exist.
	pi.on("tool_execution_end", (event) => {
		if (["arc_action", "arc_actions"].includes(event.toolName) && !event.isError) refreshCrossContextResearchCandidates();
	});
	const controlLimits = { failures:3, calls:12, elapsed_ms:null, action_deferrals:2 };
	pi.on("tool_call", event => {
		if (terminalReview || !periodicReviewEnabled() || process.env.PI_HARNESS_REVIEW_DECISION_REQUIRED !== "enabled") return;
		const input = event.input as Record<string, any>;
		const movesEnvironment = ["arc_action", "arc_actions"].includes(event.toolName)
			|| (event.toolName === "delegate_task" && Number(input?.action_authorization?.max_actions) > 0);
		if (!movesEnvironment) return;
		const window = pendingPeriodicReview();
		if (!window) return;
		const attempts = readJsonl("task-harness-control-events.jsonl")
			.filter(row => row.target === window.window_id && row.event === "action_deferred").length;
		if (attempts >= controlLimits.action_deferrals) {
			append("task-harness-review-events.jsonl", { window_id: window.window_id, status: "failed",
				reason: "parent_review_decision_not_recorded_within_control_budget", decided_by: "runtime",
				recordedAt: new Date().toISOString() });
			return;
		}
		append("task-harness-control-events.jsonl", { target: window.window_id, event: "action_deferred",
			toolCallId: event.toolCallId, recordedAt: new Date().toISOString() });
		return { block: true, reason: `Harness judgment due for ${window.window_id}. Before the next action, submit task_harness(action='review', ...) or task_harness(action='defer_review', review_reason='<evidence or missing prerequisite>', resume_condition={kind:'after_actions',actions:5}). Creation is optional. This decision boundary has a bounded recovery budget.` };
	});
	const settleControlBudgets = () => {
		if (!periodicReviewEnabled()) return;
		const events = readJsonl("task-harness-control-events.jsonl");
		const exhausted = (target:string, since:string) => {
			const recent = events.filter(row => row.target === target && row.recordedAt >= since);
			return recent.some(row => row.failure_class === "runtime_failure") ? "runtime_failure"
				: recent.filter(row => row.event === "failure").length >= controlLimits.failures ? "failure_budget"
				: recent.filter(row => row.event === "attempt").length >= controlLimits.calls ? "call_budget" : null;
		};
		const review = pendingPeriodicReview();
		if (review) {
			const opportunity = readJsonl("task-harness-opportunities.jsonl").find(row => row.window?.window_id === review.window_id);
			const reason = opportunity && exhausted(review.window_id, opportunity.recordedAt);
			if (reason) append("task-harness-review-events.jsonl", {window_id:review.window_id,status:"failed",reason,recordedAt:new Date().toISOString()});
		}
		// Research handoffs are advisory, not action gates. Unrelated harness
		// calls and elapsed parent thinking time must never decide research for
		// the parent or make an unstarted opportunity require manual reactivation.
		// Actual child execution retains its own execution budgets and failures.
	};
	const controlAttempts = new Map<string, string[]>();
	pi.on("tool_execution_start", event => {
		if (!periodicReviewEnabled() || !["task_harness","task_harness_status","auto_research"].includes(event.toolName)) return;
		settleControlBudgets();
		const targets = [pendingPeriodicReview()?.window_id].filter(Boolean) as string[];
		controlAttempts.set(event.toolCallId, targets);
		for (const target of targets) append("task-harness-control-events.jsonl", {target,event:"attempt",toolCallId:event.toolCallId,recordedAt:new Date().toISOString()});
	});
	pi.on("tool_execution_end", event => {
		const targets = controlAttempts.get(event.toolCallId) ?? [];
		controlAttempts.delete(event.toolCallId);
		if (event.isError) for (const target of targets) append("task-harness-control-events.jsonl", {target,event:"failure",toolCallId:event.toolCallId,
			...failureClassification(((event.result as any)?.content ?? []).map((part:any) => part.text ?? "").join("\n")),recordedAt:new Date().toISOString()});
		if (targets.length) settleControlBudgets();
	});
	// Research handoffs remain advisory. Periodic windows can require a bounded
	// parent review/defer decision when enabled; creation itself remains optional.
	// The terminal review listener handles the final review when no live action is
	// possible after a terminal environment state.

	// --no-skills plus no resources_discover: task-local context is the only skill projection.

	const registerScopedRead = () => {
		scopedReadRegistered = true;
		pi.registerTool({
			name: "read",
			label: "Read task-local harness resource",
			description: "Read task-local skill/subagent by exact path.",
			parameters: Type.Object({ path: Type.String() }),
			async execute(_toolCallId, params) {
				const path = resolve(params.path);
				if ((!isInside(path, skillsDir) && !isInside(path, agentsDir)) || !existsSync(path)) {
					throw new Error("read is confined to existing task-local skill and agent files");
				}
				const skill = [...skills.values()].find(item => resolve(item.file) === path);
				if (skill && !currentKnowledge().eligible("skill", skill)) {
					throw new Error("skill requires review or is retired/superseded; inspect its exact task_resource version as historical evidence");
				}
				if (skill && !resourceIsAssembled("skill", skill)) {
					throw new Error("skill is in the component pool but is not selected by the current Harness assembly");
				}
				const content = readFileSync(path, "utf8");
				return { content: [{ type: "text", text: content }], details: { path, characters: content.length } };
			},
		});
	};
	// ARC intentionally starts without built-in tools. Register its confined
	// replacement during extension loading so task-local skill reads can use a
	// tool named `read`. Terminal-Bench leaves this flag unset and
	// keeps Pi's normal read implementation.
	// When the host disabled Pi's built-in tools, preserve the task-local
	// resource reader as the only `read` capability. ARC sets the explicit
	// scoped-read flag, while installed-Pi fixtures and other adapters may use
	// `--no-builtin-tools` without setting an ARC-specific environment variable.
	// Never shadow an existing host read tool.
	if (process.env.PI_AUTORESEARCH_SCOPED_READ === "enabled") registerScopedRead();
	else pi.on("session_start", () => {
		// getAllTools is a runtime action, unavailable during extension loading.
		if (!pi.getAllTools().some((tool) => tool.name === "read")) registerScopedRead();
	});
	pi.on("tool_result", (event) => {
		if (event.toolName !== "read" || event.isError) return {};
		const rawPath = (event.input as Record<string, unknown> | undefined)?.path;
		if (typeof rawPath !== "string") return {};
		const path = resolve(rawPath);
			const skill = [...skills.values()].find((item) => resolve(item.file) === path);
			if (!skill) return {};
			// Reading proves access to the exact instructions, not that a later
			// decision followed them. Keep it separate from actual-use evidence until
			// an action/decision explicitly cites this skill version.
			recordResourceRead("skill", skill, "read");
			const readKey = `${skill.skill_id}@${skill.version}`;
		if (readSkills.has(readKey)) return {};
		readSkills.add(readKey);
		append("task-skill-events.jsonl", {
			event: "read_by_agent",
			skill_id: skill.skill_id,
			name: skill.name,
			version: skill.version,
			decision_id: skill.decision_id,
			file: path,
			recordedAt: new Date().toISOString(),
		});
		if (skill.decision_id) {
			append("harness-observations.jsonl", {
				observation_id: `skill-read-${skill.decision_id}`,
				observation_kind: "pi_skill_read",
				decision_id: skill.decision_id,
				basis_resource_ids: skill.basis_refs,
				operation: {
					capability: "pi.read",
					component: "task_skill",
					name: skill.name,
					version: skill.version,
				},
				actual_use: false,
				semantic_effect_observed: false,
				effect_observed: true,
				recordedAt: new Date().toISOString(),
			});
		}
		return {};
	});
	const applyCompiledRoute = async (toolCallId: string, input: Record<string, any>) => {
		const routeRef = String(input.route_ref ?? "").trim();
		const expectedHash = String(input.expected_delivery_hash ?? "").trim();
		if (!routeRef || !expectedHash) throw new Error("apply_route requires route_ref and expected_delivery_hash");
		const selected = resolveTaskResource(root, routeRef) as Record<string, any>;
		if (selected.format !== "auto-research-harness-route-v1") throw new Error("route_ref is not a compiled harness route");
		if (selected.delivery_hash !== expectedHash) throw new Error("route delivery hash mismatch");
		const versions = taskRecords(root, "harness_route")
			.filter((item) => item.route_id === selected.route_id)
			.sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0));
		const current = versions[0] ?? selected;
		if (current.delivery_hash !== selected.delivery_hash) throw new Error("route identity changed across versions");
		if (current.route_status === "fulfilled") {
			const result = { format: "auto-research-harness-apply-result-v1", route_id: current.route_id,
				route_status: "fulfilled", idempotent: true, version: current.version };
			return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
		}
		if (current.disposition !== "materialize" || !Array.isArray(current.steps) || !current.steps.length) {
			throw new Error(`route is not materializable: ${String(current.disposition)}`);
		}
		const receipts = taskRecords(root, "route_receipt")
			.filter((item) => item.route_id === current.route_id && item.delivery_hash === expectedHash);
		const appliedSteps = new Set(receipts.filter((item) => item.status === "applied").map((item) => String(item.step_id)));
		const orderedSteps = [...current.steps].sort((left: any, right: any) => Number(left.order) - Number(right.order));
		const nativeKinds: Record<string, { kind: string; file: string; key: string }> = {
			task_memory: { kind: "memory", file: "task-memory.jsonl", key: "key" },
			task_system_prompt: { kind: "system_prompt", file: "task-system-prompt.jsonl", key: "name" },
			task_skill: { kind: "skill", file: "task-skills.jsonl", key: "name" },
			task_tool: { kind: "tool", file: "task-tools.jsonl", key: "name" },
			task_subagent: { kind: "subagent", file: "task-subagents.jsonl", key: "name" },
		};
		let preflightFailure: Record<string, any> | undefined;
		const reachable = new Set(appliedSteps);
		for (const step of orderedSteps) {
			const stepId = String(step.step_id ?? "");
			if (appliedSteps.has(stepId)) { reachable.add(stepId); continue; }
			const executor = nativeHarnessExecutor(pi, String(step.native_tool));
			const structurallyValid = Boolean(stepId) && step.status === "ready"
				&& step.native_call?.name === step.native_tool
				&& step.native_call?.arguments?.routing_id === current.route_id
				&& step.native_call?.arguments?.source_approval_ref === current.approval_ref
				&& (step.depends_on ?? []).every((dependency: unknown) => reachable.has(String(dependency)));
			if (!executor || !structurallyValid || !nativeKinds[String(step.native_tool)]) {
				preflightFailure = { step_id: stepId, status: "failed",
					reason: !executor ? "native_harness_executor_unavailable" : "route_step_integrity_failure" };
				break;
			}
			const descriptor = nativeKinds[String(step.native_tool)];
			const args = step.native_call.arguments as Record<string, any>;
			if (["create", "update", "upsert"].includes(String(args.action))) preflightContent(descriptor.kind, args);
			if (["skill", "tool", "subagent"].includes(descriptor.kind) && ["create", "update"].includes(String(args.action))) {
				// Reject before changing route state, so reading the creator allows retry.
				requireCreatorRead(descriptor.kind as "skill" | "tool" | "subagent", args);
			}
			const identity = String(args[descriptor.key] ?? "").trim();
			const latest = identity ? latestBy(readJsonl(descriptor.file), descriptor.key).get(identity) : undefined;
			const mutatesExisting = latest && ["update", "upsert", "retire"].includes(String(args.action));
			if (mutatesExisting && args.target_version === undefined) args.target_version = Number(latest.version);
			if (mutatesExisting && Number(args.target_version) !== Number(latest.version)) {
				preflightFailure = {
					step_id: stepId, status: "failed", reason: "component_version_conflict",
					current_version: Number(latest.version), requested_version: Number(args.target_version),
					resource_ref: resourceMetadata(descriptor.kind, latest).resource_ref,
				};
				break;
			}
			reachable.add(stepId);
		}
		if (preflightFailure) {
			const failedVersion = Number(current.version ?? 1) + 1;
			append("auto-research-harness-route-receipts.jsonl", {
				format: "auto-research-harness-route-receipt-v1",
				receipt_id: `${current.route_id}:${String(preflightFailure.step_id)}:${toolCallId}:preflight`,
				route_id: current.route_id, step_id: preflightFailure.step_id,
				delivery_hash: expectedHash, status: "failed", applied: false,
				phase: "preflight", ...preflightFailure,
				source_approval_ref: current.approval_ref, recordedAt: new Date().toISOString(),
			});
			append("auto-research-harness-routes.jsonl", {
				...current, version: failedVersion, route_status: "failed",
				application_tool_call_id: toolCallId, application_completed_at: new Date().toISOString(),
				applied_step_ids: [...appliedSteps], step_results: [preflightFailure],
			});
			const result = { format: "auto-research-harness-apply-result-v1", route_id: current.route_id,
				route_status: "failed", idempotent: false, version: failedVersion, steps: [preflightFailure] };
			return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
		}
		let routeVersion = Number(current.version ?? 1) + 1;
		append("auto-research-harness-routes.jsonl", {
			...current, version: routeVersion, route_status: "applying",
			application_tool_call_id: toolCallId, application_started_at: new Date().toISOString(),
		});
		const stepResults: Record<string, unknown>[] = [];
		let failed = false;
		for (const step of orderedSteps) {
			const stepId = String(step.step_id ?? "");
			if (appliedSteps.has(stepId)) {
				stepResults.push({ step_id: stepId, status: "already_applied" });
				continue;
			}
			const dependenciesReady = (step.depends_on ?? []).every((dependency: unknown) => appliedSteps.has(String(dependency)));
			const executor = nativeHarnessExecutor(pi, String(step.native_tool));
			const structurallyValid = step.status === "ready"
				&& step.native_call?.name === step.native_tool
				&& step.native_call?.arguments?.routing_id === current.route_id
				&& step.native_call?.arguments?.source_approval_ref === current.approval_ref;
			if (!dependenciesReady || !executor || !structurallyValid) {
				const reason = !dependenciesReady ? "route step dependency is not applied"
					: !executor ? `native harness executor is unavailable: ${String(step.native_tool)}`
					: "compiled native call failed integrity validation";
				append("auto-research-harness-route-receipts.jsonl", {
					format: "auto-research-harness-route-receipt-v1", receipt_id: `${current.route_id}:${stepId}:${toolCallId}`,
					route_id: current.route_id, step_id: stepId, delivery_hash: expectedHash,
					native_tool: String(step.native_tool), status: "failed", applied: false, reason,
					source_approval_ref: current.approval_ref, recordedAt: new Date().toISOString(),
				});
				stepResults.push({ step_id: stepId, status: "failed", reason });
				failed = true;
				break;
			}
			let result: any;
			try {
				result = await executor(`${toolCallId}:${stepId}`, { ...step.native_call.arguments });
			} catch (error) {
				result = { isError: true, details: { error: error instanceof Error ? error.message : String(error) } };
			}
			const details = result?.details && typeof result.details === "object" ? result.details as Record<string, any> : {};
			const kind = ({ task_memory: "memory", task_system_prompt: "system_prompt",
				task_skill: "skill", task_tool: "tool", task_subagent: "subagent" } as Record<string, string>)[String(step.native_tool)];
			let resourceRef: string | undefined;
			try { if (!result?.isError && Object.keys(details).length) resourceRef = resourceMetadata(kind, details).resource_ref; } catch {}
			const status = result?.isError ? "failed" : "applied";
			append("auto-research-harness-route-receipts.jsonl", {
				format: "auto-research-harness-route-receipt-v1", receipt_id: `${current.route_id}:${stepId}:${toolCallId}`,
				route_id: current.route_id, step_id: stepId, delivery_hash: expectedHash,
				native_tool: String(step.native_tool), status, applied: status === "applied",
				source_approval_ref: current.approval_ref,
				...(resourceRef ? { resource_ref: resourceRef } : {}),
				...(result?.isError ? { failure: details } : {}), recordedAt: new Date().toISOString(),
			});
			stepResults.push({ step_id: stepId, status, ...(resourceRef ? { resource_ref: resourceRef } : {}) });
			if (status === "applied") appliedSteps.add(stepId);
			else { failed = true; break; }
		}
		const allApplied = current.steps.every((step: any) => appliedSteps.has(String(step.step_id)));
		hideNativeMutationTools();
		const finalStatus = allApplied ? "fulfilled" : appliedSteps.size ? "partial" : "failed";
		routeVersion += 1;
		const completed = {
			...current, version: routeVersion, route_status: finalStatus,
			application_tool_call_id: toolCallId, application_completed_at: new Date().toISOString(),
			applied_step_ids: [...appliedSteps], step_results: stepResults,
		};
		append("auto-research-harness-routes.jsonl", completed);
		const result = { format: "auto-research-harness-apply-result-v1", route_id: current.route_id,
			route_status: finalStatus, idempotent: false, version: routeVersion, steps: stepResults };
		return { isError: failed || !allApplied, content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
	};
	const observationsForDecision = (decisionId: string): string[] => {
		const refs = new Set(["memory", "skill", "tool", "subagent", "system_prompt"].flatMap(kind =>
			taskRecords(root, kind).filter(row => row.decision_id === decisionId).map(row => resourceMetadata(kind, row).resource_ref)));
		return [...new Set([
			...readJsonl("harness-observations.jsonl").filter(row => row.decision_id === decisionId).map(row => String(row.observation_id ?? "")),
			...readJsonl("execution-observations.jsonl").filter(row => actionUsesComponentRefs(row, [...refs])).map(row => String(row.observation_id ?? "")),
		].filter(Boolean))];
	};
	/**
	 * Parent-facing adoption boundary.  The parent chooses whether a completed
	 * research result should change the harness; it does not need to copy route
	 * refs, hashes, versions, or native step calls.  Those are resolved and
	 * applied deterministically here.
	 */
	const adoptResearchResult = async (toolCallId: string, input: Record<string, any>) => {
		const requested = String(input.research_run_ref ?? input.run_ref ?? "").trim();
		const routeRows = taskRecords(root, "harness_route");
		const latestRoutes = new Map<string, Record<string, any>>();
		for (const row of routeRows) {
			const prior = latestRoutes.get(String(row.route_id));
			if (!prior || Number(row.version ?? 0) >= Number(prior.version ?? 0)) latestRoutes.set(String(row.route_id), row);
		}
		const runId = requested.match(/^research_run:([^@]+)@v\d+$/)?.[1]
			?? (requested || undefined);
		let candidates = [...latestRoutes.values()].filter(row => row.route_status === "ready" && row.disposition === "materialize");
		if (runId) candidates = candidates.filter(row => String(row.route_id).startsWith(`${runId}:`));
		if (!runId && candidates.length > 1) {
			const runs = [...new Set(candidates.map(row => String(row.route_id).split(":")[0]))];
			if (runs.length > 1) throw new Error(`adopt_research requires research_run_ref when multiple completed research results are awaiting adoption: ${runs.join(", ")}`);
		}
		if (!candidates.length) {
			const result = { format: "auto-research-adoption-v1", status: "no_routes", applied: false,
				reason: "There is no completed materializable research route awaiting adoption." };
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		}
		const results: Record<string, any>[] = [];
		for (const route of candidates) {
			for (const step of route.steps ?? []) {
				const kind = String(step.native_tool ?? "").replace(/^task_/, "");
				const args = step.native_call?.arguments ?? {};
				if (["create", "update", "upsert"].includes(String(args.action))) preflightContent(kind, args);
				if (["skill", "tool", "subagent"].includes(kind) && ["create", "update"].includes(args.action)) {
					requireCreatorRead(kind as "skill" | "tool" | "subagent", args);
				}
			}
		}
		for (const route of candidates) {
			const routeRef = String(route.route_ref ?? `harness_route:${route.route_id}@v${route.version}`);
			try {
				const applied = await applyCompiledRoute(`${toolCallId}:${route.route_id}`, {
					route_ref: routeRef, expected_delivery_hash: String(route.delivery_hash ?? ""),
				});
				results.push({ route_id: route.route_id, ...(applied.details ?? {}) });
			} catch (error) {
				results.push({ route_id: route.route_id, route_status: "failed", error: error instanceof Error ? error.message : String(error) });
			}
		}
		const failed = results.filter(item => ["failed", "partial"].includes(String(item.route_status))).length;
		const methods = latestMethodRecords(readJsonl("task-method-lifecycle.jsonl"));
		for (const route of candidates) {
			const method = [...methods.values()].find((item) => item.delivery_id === route.delivery_id
				&& (!runId || String(item.source_run_ref ?? "").startsWith(`research_run:${runId}@`)));
			if (!method) continue;
			const application = results.find((item) => item.route_id === route.route_id);
			if (!application || application.route_status !== "fulfilled") continue;
			const resourceRefs = (application.steps ?? []).map((step: Record<string, any>) => step.resource_ref).filter(Boolean);
			const advanced = advanceMethodApplication(method, {
				resourceRefs,
				applicationRef: `research_adoption:${String(route.run_id ?? runId)}:${toolCallId}`,
			});
			append("task-method-lifecycle.jsonl", advanced);
			methods.set(String(method.method_id), advanced);
		}
		const adoptedRunIds = [...new Set(candidates.map(row => String(row.route_id).split(":")[0]).filter(Boolean))];
		for (const id of adoptedRunIds) {
			const sessions = latestBy(readJsonl("auto-research-sessions.jsonl"), "session_id");
			for (const session of sessions.values()) {
				if (String(session.run_id ?? "") !== id) continue;
				append("auto-research-sessions.jsonl", {
					...session, version: Number(session.version ?? 0) + 1,
					reconciliation_status: failed ? "partial_adoption" : "adopted",
					adoption_ref: `research_adoption:${id}:${toolCallId}`,
					recordedAt: new Date().toISOString(),
				});
			}
		}
		const result = { format: "auto-research-adoption-v1", status: failed ? "partial" : "adopted",
			applied: failed === 0, route_count: candidates.length, routes: results,
			activation: {
				instruction: "Adoption creates pool versions. Choose applicable exact versions with assemble before use; then focus a selected skill, invoke a selected tool/subagent, or add a source-linked prompt contribution. Cite the exact skill ref in action decision.basis_refs when following its procedure.",
				created_resource_refs: results.flatMap(route => (route.steps ?? []).map((step: any) => step.resource_ref)).filter(Boolean),
				assemble_template: { action: "assemble", expected_assembly_revision: currentAssembly()?.revision ?? 0,
					selected_resource_refs: currentAssembly()?.selected_resource_refs ?? [],
					prompt_contributions: currentAssembly()?.prompt_contributions ?? [] },
				required_agent_fields: ["selected_resource_refs (choose exact eligible versions)", "decision (basis_refs, reason, expected)"],
			} };
		append("auto-research-adoption-events.jsonl", { ...result, toolCallId, research_run_ref: requested || null, recordedAt: new Date().toISOString() });
		return { isError: failed > 0, content: [{ type: "text", text: JSON.stringify(result) }], details: result };
	};
		const assessHarnessEffect = async (toolCallId: string, input: Record<string, any>) => {
		const decisions = readJsonl("harness-decisions.jsonl");
		const requestedRefs = Array.isArray(input.observation_refs) ? input.observation_refs.map(String).filter(Boolean) : [];
		const explicitObservations = readJsonl("harness-observations.jsonl");
		const priorAssessments = readJsonl("effect-assessments.jsonl");
		const inferredDecisions = !input.decision_id && requestedRefs.length
			? decisions.filter(row => requestedRefs.some((ref: string) => {
				if (explicitObservations.some(observation => observation.observation_id === ref && observation.decision_id === row.decision_id)) return true;
				if (priorAssessments.some(assessment => assessment.decision_id === row.decision_id && assessment.observation_refs?.includes(ref))) return true;
				const execution = dependencies.getObservation(ref) as Record<string, any> | undefined;
				if (!execution) return false;
				const resourceRefs = ["memory", "skill", "tool", "subagent", "system_prompt"]
					.flatMap(kind => taskRecords(root, kind).filter(item => item.decision_id === row.decision_id)
						.map(item => resourceMetadata(kind, item).resource_ref));
				return actionUsesComponentRefs(execution, resourceRefs);
			})) : [];
		const assessed = new Set(priorAssessments.map(row => row.decision_id));
		const eligibleDecisions = decisions.filter(row =>
			!assessed.has(row.decision_id) && observationsForDecision(String(row.decision_id ?? "")).length > 0);
		const candidates = requestedRefs.length && inferredDecisions.length ? inferredDecisions : eligibleDecisions;
		if (!input.decision_id && candidates.length === 0) {
			const result = { format:"task-harness-no-op-v1", action:"assess_effect",
				status:"no_eligible_decision", applied:false,
				reason:"No unassessed harness decision has a later observation yet, and the supplied references did not identify an earlier decision." };
			return { content:[{type:"text",text:JSON.stringify(result)}], details:result };
		}
		if (!input.decision_id && candidates.length > 1) {
			const result = { action: "assess_effect", status: "selection_required", applied: false,
				candidates: candidates.map(row => ({ decision_id: row.decision_id,
					operation: row.operation, observation_refs: observationsForDecision(String(row.decision_id)),
					retry: { ...input, action: "assess_effect", decision_id: row.decision_id } })),
				instruction: "Choose the decision you intended to assess, or continue the task and assess later. No assessment was recorded." };
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		}
		const decision = selectControlTarget(input.decision_id ? decisions : candidates, "decision_id", input.decision_id);
		const decisionId = String(decision.decision_id);
		const observationRefs = Array.isArray(input.observation_refs) && input.observation_refs.length
			? input.observation_refs.map(String)
			: observationsForDecision(decisionId);
		if (!observationRefs.length) throw new Error("observation_refs must contain at least one reference");
		const observations = readJsonl("harness-observations.jsonl");
		const harnessObservationIds = new Set(
			observations.map((item) => String(item.observation_id ?? "")).filter(Boolean),
		);
		const availableForDecision = observations
			.filter((item) => String(item.decision_id ?? "") === decisionId)
			.map((item) => String(item.observation_id ?? ""))
			.filter(Boolean);
		for (const reference of observationRefs) {
			// Execution observations come from the adapter-owned observation store;
			// native harness exposures are persisted in harness-observations.jsonl.
			// Both are legitimate evidence for an Agent-authored effect assessment.
			if (!dependencies.getObservation(reference) && !harnessObservationIds.has(reference)) {
				const hint = availableForDecision.length
					? ` Available observation_refs for ${decisionId}: ${availableForDecision.join(", ")}.`
					: ` No native exposure has been recorded for ${decisionId} yet; inspect task_harness_status and retry after the resource is exposed.`;
				throw new Error(`unknown observation reference: ${reference}.${hint}`);
			}
		}
		const assessedResourceRefs = ["memory", "skill", "tool", "subagent", "system_prompt"]
			.flatMap(kind => taskRecords(root, kind).filter(item => String(item.decision_id ?? "") === decisionId)
				.map(item => resourceMetadata(kind, item).resource_ref));
		const linkedUseRefs = observationRefs.filter((ref: string) => {
			if (observations.some(row => row.observation_id === ref && row.decision_id === decisionId && row.actual_use === true)) return true;
			const row = dependencies.getObservation(ref) as Record<string, any> | undefined;
			return Boolean(row && actionUsesComponentRefs(row, assessedResourceRefs));
		});
		if (input.verdict === "supported" && assessedResourceRefs.length && !linkedUseRefs.length)
			throw new Error("supported utility requires actual-use evidence for this exact component version: invoke the selected tool/subagent or cite its exact ref in a later arc_action decision.basis_refs. Read/exposure alone is inconclusive.");
		const assessment = {
			effect_assessment_id: `effect-assessment-${++assessmentCounter}`,
			decision_id: decisionId,
			observation_refs: observationRefs,
			verdict: String(input.verdict ?? "inconclusive"),
			consequence: String(input.consequence ?? ""),
			remaining_uncertainty: String(input.remaining_uncertainty ?? ""),
			source: "agent_assessment",
			actual_use_refs: linkedUseRefs,
			resource_refs: assessedResourceRefs,
			assessment_scope: linkedUseRefs.length ? "observed_use_only_not_general_truth" : "exposure_only",
			recordedAt: new Date().toISOString(),
		};
		if (!["supported", "unsupported", "inconclusive"].includes(assessment.verdict)) {
			throw new Error("verdict must be supported, unsupported, or inconclusive; use observation evidence to choose one");
		}
		if (!assessment.consequence.trim()) throw new Error("consequence is required");
		append("effect-assessments.jsonl", assessment);
		const decisionResourceRefs = ["memory", "skill", "tool", "subagent", "system_prompt"]
			.flatMap((kind) => taskRecords(root, kind)
				.filter((item) => String(item.decision_id ?? "") === decisionId)
				.map((item) => resourceMetadata(kind, item).resource_ref));
		const actualUseIds = new Set(readJsonl("harness-observations.jsonl")
			.filter((item) => String(item.decision_id ?? "") === decisionId && item.actual_use === true)
			.map((item) => String(item.observation_id ?? "")));
		const explicitActualUseRefs = observationRefs.filter((reference: string) => actualUseIds.has(reference));
		const methods = latestMethodRecords(readJsonl("task-method-lifecycle.jsonl"));
		for (const method of methods.values()) {
			const resources = new Set(method.resource_refs ?? []);
			if (!decisionResourceRefs.some((reference) => resources.has(reference))) continue;
			// A later environment action counts as method use only when the parent
			// cited the exact adopted resource in that action's decision basis.
			// Mere prompt exposure remains insufficient.
			const actionUseRefs = observationRefs.filter((reference: string) => {
				const observation = dependencies.getObservation(reference) as Record<string, any> | undefined;
				return Boolean(observation && actionUsesComponentRefs(observation, [...resources].map(String)));
			});
			const actualUseRefs = [...new Set([...explicitActualUseRefs, ...actionUseRefs])];
			const advanced = advanceMethodAssessment(method, {
				verdict: assessment.verdict,
				assessmentRef: `effect_assessment:${assessment.effect_assessment_id}@v1`,
				observationRefs,
				actualUseRefs,
			});
			append("task-method-lifecycle.jsonl", advanced);
			const handoff = buildMethodFeedbackHandoff(advanced, assessment);
			if (handoff && !readJsonl("auto-research-handoffs.jsonl").some((item) => item.handoff_id === handoff.handoff_id)) {
				append("auto-research-handoffs.jsonl", handoff);
			}
		}
		dependencies.pendingAssessments.set(assessment.effect_assessment_id, assessment);
		return { content: [{ type: "text", text: JSON.stringify(assessment) }], details: assessment };
	};
	// Kept only to read/reconcile legacy route artifacts. New research runs never
	// compile component routes, and the parent-facing task_harness schema exposes
	// no route-application action.
	registerNativeHarnessRouteApplier(pi, applyCompiledRoute);

	const statusTool = {
		name: "task_harness_status",
		label: "Task-local harness status",
		description: "Current task-local state; no mutation. request=full includes manuals. Alias: task_harness(status).",
		parameters: Type.Object({ request: Type.String() }),
		async execute() {
			const crossContextResearchCandidates = refreshCrossContextResearchCandidates();
			const validity = currentKnowledge();
			const active = new Set(pi.getActiveTools());
			const registeredTools = new Set(pi.getAllTools().map((tool) => tool.name));
			const authorized = authorizedTools();
			const latestResearchSessions = latestBy(readJsonl("auto-research-sessions.jsonl"), "session_id");
			const latestResearchReports = latestBy(readJsonl("auto-research-reports.jsonl"), "run_id");
			const parentAuthoringHandoffs = [...latestBy(readJsonl("parent-authoring-handoffs.jsonl"), "handoff_id").values()]
				.filter((item) => item.status === "awaiting_parent_authoring");
			const experimentObservations = readJsonl("execution-observations.jsonl")
				.filter((item) => item.tool_name === "arc_action" && item.input?.decision?.research_request_ref)
				.map((item) => ({
					request_ref: String(item.input.decision.research_request_ref),
					evidence_ref: String(item.observation_id ?? item.event_id ?? ""),
					is_error: Boolean(item.is_error),
				}))
				.filter((item) => item.evidence_ref);
			const researchExperimentCandidates = [...latestResearchReports.values()]
				.filter((item) => item.status === "completed"
					&& item.experiment_request && typeof item.experiment_request === "object")
				.slice(-10)
				.map((item) => {
					const session = [...latestResearchSessions.values()].find((candidate) => String(candidate.run_id ?? "") === String(item.run_id ?? ""));
					const request = item.experiment_request as Record<string, any>;
					return {
						request_ref: request.request_ref ?? `research-experiment:${item.run_id}`,
						as_of_event: request.as_of_event ?? null,
						request,
						run_ref: `research_run:${item.run_id}@v${item.version ?? 1}`,
						report_ref: `research_report:${item.run_id}@v${item.version ?? 1}`,
						session_ref: session ? `research_session:${session.session_id}@v${session.version ?? 1}` : null,
						status: session?.status ?? item.status,
						research_kind: item.research_kind ?? session?.research_kind ?? null,
						research_line_ref: item.research_line_ref ?? session?.research_line_ref ?? null,
						planning_implications: item.planning_implications ?? item.report?.planning_implications ?? [],
						next_research_question: item.next_research_question ?? item.report?.next_research_question ?? "",
					candidate_refs: Array.isArray(item.report?.method_candidates)
						? item.report.method_candidates.map((candidate: Record<string, any>) => candidate.candidate_ref).filter(Boolean)
							: [],
						experiment_evidence_refs: experimentObservations
							.filter((observation) => observation.request_ref === String(request.request_ref ?? `research-experiment:${item.run_id}`))
							.map((observation) => ({ evidence_ref: observation.evidence_ref, is_error: observation.is_error })),
					};
				});
		const latestTaskTools = latestBy(readJsonl("task-tools.jsonl"), "name");
		const latestSubagents = latestBy(readJsonl("task-subagents.jsonl"), "name");
			const activeTaskTools = [...latestTaskTools.values()]
				.filter((item) => item.status === "active")
				.map((item) => ({
					name: item.name, version: item.version, resource_ref: `tool:${item.tool_id ?? item.name}@v${item.version}`,
					exposed_name: item.exposed_name, description: compactText(item.description),
					program_format: item.program?.format ?? "legacy-steps",
					use: item.program?.format === "task-pure-expression-v1"
						? `Call ${item.exposed_name}(parameters={...},bindings=[{name,ref,path}])`
						: `Call ${item.exposed_name}(input={...})`,
				}));
			const activeSubagents = [...latestSubagents.values()]
				.filter((item) => item.status === "active")
				.map((item) => ({
					name: item.name, version: item.version, resource_ref: `subagent:${item.agent_id ?? item.name}@v${item.version}`,
					use: `Call delegate_task(agent_name=${item.name}, task=...)`,
				}));
			const activeMemories = [...memories.values()]
				.filter((item) => validity.eligible("memory", item))
				.map((item) => ({
					key: item.key, version: item.version, resource_ref: `memory:${item.memory_id ?? item.key}@v${item.version}`,
					use: "Available in the pool; explicitly assemble the exact version for context projection. Call task_memory(action=inspect,key=...) for the full value.",
				}));
			const activeSystemPrompts = [...systemPrompts.values()]
				.filter((item) => validity.eligible("system_prompt", item))
				.map((item) => ({ name: item.name, version: item.version,
					resource_ref: `system_prompt:${item.segment_id}@v${item.version}`,
					use: "Appended to later Pi system prompts through before_agent_start." }));
			const activeSkills = [...skills.values()]
				.filter((item) => validity.eligible("skill", item))
				.map((item) => ({
					name: item.name, version: item.version, resource_ref: `skill:${item.skill_id ?? item.name}@v${item.version}`,
					path: item.file, use: `Call read(path=${item.file}) or task_harness(action=focus,resource_refs=[skill:${item.skill_id ?? item.name}@v${item.version}]).`,
				}));
		const latestResearch = latestBy(readJsonl("research-resources.jsonl"), "finding_id");
			const activeResearch = [...latestResearch.values()]
				.filter((item) => item.status === "open" || item.status === "active")
				.map((item) => ({
					finding_id: item.finding_id, version: item.version,
					resource_ref: `finding:${item.finding_id}@v${item.version}`,
					use: `Call research_resource(action=inspect,finding_id=${item.finding_id})`,
				}));
			const registered = (name: string) => registeredTools.has(name);
			const module = (name: string, entrypoint: string, mutable: boolean, supported = true) => ({
				name, entrypoint, mutable, supported, registered: registered(entrypoint), active: active.has(entrypoint),
			});
			const status = {
				format: "task-local-harness-status-v1",
				task_solving_context: (() => { const checkpoint = readCurrentTaskCheckpoint(root); return {
					task_goal: checkpoint.task_goal ?? null, task_constraints: checkpoint.task_constraints ?? [],
					success_conditions: checkpoint.success_conditions ?? [],
					planning_gap: checkpoint.planning_gap ?? null, strategy_alternatives: checkpoint.strategy_alternatives ?? [],
					current_strategy: checkpoint.current_strategy ?? null, current_subgoal: checkpoint.current_subgoal ?? null,
					next_step: checkpoint.next_step ?? null, basis_refs: checkpoint.summary_basis_refs ?? [],
				}; })(),
				knowledge_requires_review: validity.notices,
				review_contract: reviewInputContract(periodicReviewEnabled() ? pendingPeriodicReview() : undefined),
				control_policy: {enabled:periodicReviewEnabled(), ...controlLimits,
					scope:"periodic_review_only", research_handoff_expiry:"none; parent decides defer/skip/start"},
				assessable_decisions: readJsonl("harness-decisions.jsonl").filter(row => !readJsonl("effect-assessments.jsonl").some(a => a.decision_id === row.decision_id)
					&& observationsForDecision(String(row.decision_id ?? "")).length > 0)
					.map(row => ({decision_id:row.decision_id,observation_refs:observationsForDecision(String(row.decision_id ?? "")),
						assessment_call: {tool:"task_harness", arguments:{action:"assess_effect",decision_id:row.decision_id}},
						required_agent_fields:["observation_refs (actual use, not exposure, for supported utility)","verdict (supported|unsupported|inconclusive)","consequence (expected versus observed, scope, retain/revise/retire decision)","remaining_uncertainty"]})),
				reviews: readJsonl("task-harness-reviews.jsonl").slice(-5),
				research_handoffs: [...latestResearchHandoffs().values()].slice(-10).map(item => ({
					handoff_ref: `research_handoff:${item.handoff_id}@v${item.version}`,
					status: item.status, review_id: item.review_id, window_id: item.window_id,
					lane: item.lane, ready_call: item.ready_call, ready_calls: item.ready_calls ?? null,
					authoring_prerequisite: item.authoring_prerequisite ?? null,
					interaction_mode_policy: item.interaction_mode_policy ?? null,
					next_call: item.next_call ?? item.ready_call,
					session_ref: item.session_ref ?? null, research_run_ref: item.research_run_ref ?? null,
					confidence_state: item.confidence_state ?? item.current_confidence,
					confidence_update: item.confidence_update ?? null,
					next_experiment: item.experiment_request ?? null,
				})),
				pending_research_handoff: pendingResearchHandoff() ?? null,
				parent_authoring_handoffs: parentAuthoringHandoffs,
				conversion_intents: currentConversionWorkset().map((item) => ({
					intent_id: item.intent_id ?? item.operation_id, operation_id: item.operation_id ?? null,
					status: item.status, recorded_status: item.recorded_status, phase: item.phase,
					carrier: item.carrier ?? null, purpose: item.purpose ?? null,
					candidate_ref: item.candidate_ref ?? null,
					authoring_handoff_ref: item.authoring_handoff_ref ?? null,
					resource_refs: item.resource_refs ?? [],
					pending_trial_refs: item.pending_trial_refs ?? [], trial_evidence_refs: item.trial_evidence_refs ?? [],
					component_hints: item.component_hints ?? [], error: item.error ?? null,
					retry: item.status === "applied_pending_assembly" ? null : item.retry ?? null,
					recovery: item.status === "applied_pending_assembly"
					? "Explicitly assemble the exact created resource version, then trial its semantic effect."
					: item.recovery ?? item.next_step ?? null,
				})),
				review_drafts: pendingReviewDrafts(),
				capability_followups: allCapabilityFollowups(),
				direct_development_intents: directDevelopmentIntents(),
				baseline_methods: baselineMethodCatalog(),
				authoring_guidance: BASELINE_AUTHORING_GUIDANCE,
				memory_validity_context: currentValidityContext(),
				cross_context_research_candidates: crossContextResearchCandidates,
				research_experiment_candidates: researchExperimentCandidates,
				pending_pattern_extraction: periodicReviewEnabled() ? pendingPeriodicReview() ?? null : null,
				pending_pattern_queue: periodicReviewEnabled() ? (() => {
					const queue = patternReviewQueue();
					return { action_count: queue.action_count, due_window_ids: queue.due.map(row => row.window_id),
						deferred: queue.deferred.map(row => ({ window_id: row.window_id, parent_reason: row.parent_reason,
							resume_after_action_count: row.resume_after_action_count })) };
				})() : null,
				pending_level_reviews: pendingLevelReviews(),
				latest_level_review: (() => { const latest = readJsonl("task-level-reviews.jsonl").at(-1); return latest ? levelReviewReceipt(latest) : null; })(),
				pattern_extraction_events: readJsonl("task-harness-review-events.jsonl").slice(-10),
				latest_opportunity: readJsonl("task-harness-opportunities.jsonl").at(-1) ?? null,
				lifecycle: harnessLifecycle(readJsonl),
				scope: "current task",
				modules: [
					module("task_harness", "task_harness", true),
					module("research", "research_resource", true),
					module("task_memory", "task_memory", true),
					module("task_system_prompt", "task_system_prompt", true),
					module("task_skill", "task_skill", true),
					module("task_tool", "task_tool", true, Boolean(dependencies.taskToolAdapter)),
					module("task_tool_policy", "task_tool_policy", true),
				module("task_subagent", "task_subagent", true, registered("task_subagent")),
				module("delegate_task", "delegate_task", false, registered("delegate_task")),
				module("auto_research", "auto_research", false, registered("auto_research")),
				module("observation_compaction", OBSERVATION_COMPACTION_TOOL, true, compactionEnabled),
					module("harness_effect_assessment", "assess_harness_effect", true),
				],
				authorized_tools: [...authorized].sort(),
				active_tools: [...active].sort(),
				focused_resource_refs: focusedResourceRefs === undefined ? null : [...focusedResourceRefs].sort(),
				current_assembly: currentAssembly() ?? null,
				memory_pool: (() => {
					const memoryEntries = componentPool().filter((entry) => entry.kind === "memory");
					const assembly = currentAssembly();
					return {
						historical_versions: readJsonl("task-memory.jsonl").length,
						current_keys: memories.size,
						eligible: memoryEntries.filter((entry) => entry.eligible).length,
						selected: memoryEntries.filter((entry) => entry.eligible && assemblySelectsReference(assembly, entry.aliases)).length,
						retired_or_expired: memoryEntries.filter((entry) => !entry.eligible).length,
						directory_call: { tool: "task_memory_pool", arguments: { action: "list", scope: "level", limit: 20 } },
					};
				})(),
				component_pool: (() => {
					const all = componentPool();
					const memory = all.filter((entry) => entry.kind === "memory")
						.sort((a, b) => String(b.record.recordedAt ?? "").localeCompare(String(a.record.recordedAt ?? "")))
						.slice(0, 10);
					const includedMemoryRefs = new Set(memory.map((entry) => entry.resource_ref));
					return all.filter((entry) => entry.kind !== "memory" || includedMemoryRefs.has(entry.resource_ref))
						.map(({ record: _record, aliases, ...entry }) => ({
							...entry, selected: assemblySelectsReference(currentAssembly(), aliases),
						}));
				})(),
				assembly_contract: {
					owner: jevRoutingMode() === "active" ? "jev" : "main_agent",
					component_pool: "current selectable projection of the committed immutable version store; historical versions remain readable through task_resource",
					selection: jevRoutingMode() === "active"
						? "Jev selects exact current eligible component versions before each provider request"
						: "main selects exact current eligible component versions",
					task_prompt: "source-agnostic assembly output channel",
					default_selection: "none until the main Agent commits the first explicit assembly",
					runtime: "validates, projects, exposes, executes, and records receipts without semantic selection",
					...assemblyInputContract(currentAssembly()),
				},
				resources: {
					research: activeResearch,
					memory: activeMemories,
					system_prompt: activeSystemPrompts,
					skill: activeSkills,
					tool: activeTaskTools,
					subagent: activeSubagents,
				},
			};
			return { content: [{ type: "text", text: JSON.stringify(status) }], details: status };
		},
	};
	pi.registerTool({ ...statusTool,
		async execute(_toolCallId, params) {
			const result = await statusTool.execute();
			if (process.env.PI_ARC_EXECUTION_GATE !== "enabled" || params.request === "full") return result;
			const state = harnessStateView(result.details);
			return { content: [{ type: "text", text: JSON.stringify(state) }], details: state };
		},
	});
	pi.registerTool({
		name: "task_harness_create", label: "Create task-local capability",
		executionMode: "sequential",
		description: "Publish a component; read Skill/Tool/Subagent creator. assembly selects; pure trial returns a result.",
		parameters: compactToolSchema(Type.Object({
			candidate: Type.Record(Type.String(), Type.Any(), { description: MINIMUM_CANDIDATE_FIELDS }),
			decision: Type.Optional(Type.Object({ basis_refs: Type.Array(Type.String()), reason: Type.String(), expected: Type.String() })),
			assembly: publicationAssemblyParameters,
			trial: Type.Optional(pureToolInvocationParameters()),
		})),
		async execute(toolCallId, params, signal) {
			const admission = admitTaskLocalOperation("task_harness");
			if (admission) return admission;
			const normalized = normalizeDirectCreateMetadata(params);
			if (normalized.conflict) {
				const details = { format: "task-harness-create-metadata-conflict-v1", status: "failed",
					path: normalized.conflict, no_component_written: true,
					message: "Publication metadata conflicts with the top-level value; no component was written." };
				// Pi propagates thrown errors to its tool/action integrity boundary.
				throw new Error(JSON.stringify(details));
			}
			const firstCall = normalized.value.trial;
			const authored = { ...normalized.value.candidate };
			let bindingInputNormalization: Record<string, any> | undefined;
			if (firstCall !== undefined) {
				const issues: HarnessPreflightIssue[] = [];
				const missingBoundFields = new Set<string>();
				let targets: string[] = [];
				try { targets = classifyHarnessChangeTargets(normalizeSemanticCandidate(normalized.value.candidate)); }
				catch (error) { issues.push({ path: "candidate", message: error instanceof Error ? error.message : String(error) }); }
				if (targets.length !== 1 || targets[0] !== "tool"
					|| normalized.value.candidate?.program?.format !== "task-pure-expression-v1")
					issues.push({ path: "trial", message: "trial requires one pure-expression Tool" });
				if (normalized.value.assembly === undefined)
					issues.push({ path: "assembly", message: "trial requires explicit assembly={expected_assembly_revision,selected_resource_refs}; choose the current revision and retained refs." });
				if (!firstCall || typeof firstCall !== "object" || Array.isArray(firstCall)
					|| Object.keys(firstCall).some(key => !["parameters", "bindings"].includes(key))
					|| !firstCall.parameters || typeof firstCall.parameters !== "object" || Array.isArray(firstCall.parameters)
					|| !Array.isArray(firstCall.bindings))
					issues.push({ path: "trial", message: "trial requires only parameters (object) and bindings (array)" });
				else {
					// Caller parameters retain their authored contract. Explicit bindings
					// may supply a root type from the authorized host preparation below.
					const schema = normalized.value.candidate?.input_schema;
					if (schema?.additionalProperties === false) {
						const properties = schema.properties ?? {};
						for (const field of Object.keys(firstCall.parameters)) if (!Object.hasOwn(properties, field))
							issues.push({ path: `changes[0].candidate.input_schema.properties.${field}`,
								message: `trial supplies input.${field}, which is absent from closed input_schema.properties; declare its type or remove that trial input.` });
						for (const binding of firstCall.bindings) if (typeof binding?.name === "string" && !Object.hasOwn(properties, binding.name))
							missingBoundFields.add(binding.name);
					}
				}
				if (issues.length || missingBoundFields.size) {
					// An invalid publication option must not hide independently repairable
					// creator/name/program/schema errors behind another model round trip.
					try { preflightCreators([{ operation: "create", candidate: authored }], missingBoundFields); }
					catch (error) {
						if (error instanceof HarnessPreflightError) issues.push(...error.issues);
						else issues.push({ path: "candidate", message: error instanceof Error ? error.message : String(error) });
					}
					if (issues.length) throw new Error(JSON.stringify(harnessPreflightDetails(`harness-change:${toolCallId}`, issues)));
				}
				if (missingBoundFields.size) {
					const checkCancellation = () => {
						if (signal?.aborted) throw new Error("binding input preparation cancelled; no component was written");
					};
					try {
						checkCancellation();
						const request = normalizeCapabilityRequest({ action: "change", changes: [{ operation: "create", candidate: authored }], decision: normalized.value.decision });
						validateParentAssembly({ ...normalized.value.assembly, decision: request.decision });
						const name = String(authored.name ?? "").trim();
						if (componentPool().some(entry => entry.kind === "tool" && entry.record.name === name))
							throw new Error(`tool already exists: ${name}; use update with the current version`);
						const validated = validateTaskPureExpressionProgram(authored.program);
						const prepared = preparePureExpressionInput(pi, root, firstCall, {
							max_input_bytes: validated.effective_limits.input_bytes,
							max_record_bytes: validated.effective_limits.input_bytes,
							max_preparation_bytes: validated.effective_limits.allocation_bytes,
						});
						checkCancellation();
						const sourceSchema = authored.input_schema;
						const properties = { ...sourceSchema.properties };
						const added = [...missingBoundFields].map(name => {
							const value = prepared.input[name];
							const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
							properties[name] = { type };
							return { name, type };
						});
						authored.input_schema = { ...sourceSchema, properties };
						preflightCreators([{ operation: "create", candidate: authored }]);
						const schemaHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
						bindingInputNormalization = { added_properties: added,
							source_schema_sha256: schemaHash(sourceSchema), compiled_schema_sha256: schemaHash(authored.input_schema),
							provenance: prepared.provenance, preparation: prepared.preparation };
						checkCancellation();
					} catch (error) {
						const failures = error instanceof HarnessPreflightError ? error.issues
							: [{ path: "trial", message: error instanceof Error ? error.message : String(error) }];
						throw new Error(JSON.stringify(harnessPreflightDetails(`harness-change:${toolCallId}`, failures)));
					}
				}
			}
			let publication = await publishParentChanges(toolCallId, { changes: [{ operation: "create", candidate: authored }],
				decision: normalized.value.decision,
				...(normalized.value.assembly !== undefined ? { assembly: normalized.value.assembly } : {}) });
			if (normalized.movedFields.length || bindingInputNormalization) append("task-harness-create-normalizations.jsonl", {
				format: "task-harness-create-normalization-v1", tool_call_id: toolCallId,
				moved_fields: normalized.movedFields,
				...(bindingInputNormalization ? { binding_input_normalization: bindingInputNormalization } : {}),
				outcome: publication.details?.activation?.created_resource_refs?.length
					? (publication.isError ? "published_unassembled" : "published") : "rejected",
				recordedAt: new Date().toISOString(),
			});
			if (bindingInputNormalization) {
				const { provenance: _provenance, preparation: _preparation, ...summary } = bindingInputNormalization;
				const details = { ...publication.details, binding_input_normalization: summary };
				publication = { ...publication, content: [{ type: "text", text: JSON.stringify(details) }], details };
			}
			if (firstCall !== undefined && !publication.isError) {
				const refs = publication.details?.activation?.created_resource_refs ?? [];
				const entry = refs.length === 1 ? componentPool().find(item => item.resource_ref === refs[0]) : undefined;
				let result: any;
				try {
					if (!entry || entry.kind !== "tool" || entry.record.program?.format !== "task-pure-expression-v1")
						throw new Error("initial trial requires this publication's exact pure Tool version");
					const execute = nativeHarnessExecutor(pi, String(entry.record.exposed_name));
					if (!execute) throw new Error("published pure Tool executor is unavailable");
					result = await execute(`${toolCallId}:trial`, firstCall, signal);
				} catch (error) {
					result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
				}
				const trial = { status: result?.isError ? "failed" : "completed", tool_ref: refs[0], result };
				append("task-harness-initial-trials.jsonl", { ...trial, toolCallId, recordedAt: new Date().toISOString() });
				// Publication has committed. A failed pure trial must not become a
				// mutation error and trip the existing same-batch action integrity gate.
				const receipt = { ...publication.details, trial };
				return { ...publication, content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			}
			return publication;
		},
	});
	installHarnessBatchIntegrity(pi);
	registerManagementTool(pi, root, {
		name: "task_harness",
		executionMode: "sequential",
			label: "Task-local working methods",
			description: "Manage capabilities/context. contract(topic=review|level_review) loads typed fields; level_review needs window_id. Pool entry is not use.",
			parameters: compactToolSchema(Type.Object({
				action: Type.Union([Type.Literal("contract"), Type.Literal("methods"), Type.Literal("read_method"), Type.Literal("development_intent"), Type.Literal("start"), Type.Literal("summary"), Type.Literal("inspect"), Type.Literal("status"), Type.Literal("review"), Type.Literal("defer_review"), Type.Literal("capability_review"), Type.Literal("level_review"), Type.Literal("report_level_reset"), Type.Literal("decide_research"), Type.Literal("enable"), Type.Literal("activate"), Type.Literal("focus"), Type.Literal("context"), Type.Literal("compact_results"), Type.Literal("restore_results"), Type.Literal("assemble"), Type.Literal("change"), Type.Literal("assess_effect")]),
				topic: Type.Optional(Type.String({ description: "Contract topic; level_review needs window_id." })),
				section: Type.Optional(Type.String({ description: "One status section; all returns complete state and manuals." })),
				method_name: Type.Optional(Type.String()),
				method_resource: Type.Optional(Type.String()),
				expected_sha256: Type.Optional(Type.String()),
				method_offset: Type.Optional(Type.Integer({ minimum: 0, description: "Continue a large creator read at this exact character offset." })),
				method_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536, description: "Characters to return from a large creator; default first page is 8192." })),
				changes: Type.Optional(Type.Array(Type.Union([
					Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("update")]), candidate: Type.Record(Type.String(), Type.Any(), { description: "Complete parent-authored body, not refs alone." }) }),
					Type.Object({ candidate: Type.Record(Type.String(), Type.Any(), { description: "Complete body; default operation=create." }) }),
					Type.Object({ operation: Type.Union([Type.Literal("retire"), Type.Literal("reuse")]), target_ref: Type.String() }),
				]), { description: MINIMUM_CANDIDATE_FIELDS })),
				assembly: publicationAssemblyParameters,
				decision: Type.Optional(Type.Object({
					basis_refs: Type.Array(Type.String()), reason: Type.String(), expected: Type.String(),
				})),
				boundary_ref: Type.Optional(Type.String()), reset_reason: Type.Optional(Type.String()),
				window_id: Type.Optional(Type.String()),
				level_review: Type.Optional(Type.Object({
					summary: Type.String(),
					mechanisms: Type.Union([Type.String(), Type.Array(Type.String())]),
					shortcomings: Type.Union([Type.String(), Type.Array(Type.String())]),
					lessons: Type.Union([Type.String(), Type.Array(Type.String())]),
					next_attempt: Type.Union([Type.String(), Type.Array(Type.String())]),
					credits: Type.Array(Type.Object({
						kind: Type.Union([Type.Literal("behavior"), Type.Literal("harness")]),
						target_ref: Type.String({ description: "Exact observation/component ref." }),
						verdict: Type.Union([Type.Literal("positive"), Type.Literal("negative"), Type.Literal("uncertain")]),
						evidence_refs: Type.Array(Type.String({ description: "Window refs; include application_ref if applied." })),
						reason: Type.String(), counterfactual: Type.String(), next_use: Type.String(),
						use_stage: Type.Optional(Type.String({ description: "created_only|exposed|read|applied; positive=applied." })),
						application_ref: Type.Optional(Type.String({ description: "Applied execution observation ref." })),
					})),
					success_path: Type.Optional(Type.Object({
						status: Type.Union([Type.Literal("candidate"), Type.Literal("insufficient_evidence")]),
						scope: Type.String(), preconditions: Type.Array(Type.String()),
						steps: Type.Array(Type.Object({ operation: Type.String(), input_or_condition: Type.String(),
							output_or_check: Type.String(), evidence_refs: Type.Array(Type.String()),
							call_refs: Type.Optional(Type.Array(Type.String())),
							role: Type.Union([Type.Literal("discovery"), Type.Literal("repeat_execution"), Type.Literal("validation"), Type.Literal("uncertain")]),
						})),
						success_check: Type.String(), uncertainty: Type.String(), reuse_advice: Type.String(),
						proposed_omissions: Type.Optional(Type.Array(Type.Object({ call_refs: Type.Array(Type.String()),
							rationale: Type.String(), risk: Type.String(), confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
						}))),
					})),
					failure_modes: Type.Optional(Type.Array(Type.Object({ symptom: Type.String(), trigger: Type.String(),
						falsified_hypothesis: Type.Optional(Type.String()), evidence_refs: Type.Array(Type.String()),
						recovery_or_next_test: Type.String(), applicability: Type.String(),
						confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
						evidence_status: Type.Optional(Type.String()),
					}))),
				})),
				opportunity_id: Type.Optional(Type.String({description:"Omit if unique; else exact inspect ID."})),
				review_reason: Type.Optional(Type.String({description:"Parent reason for deferring the current evidence window."})),
				research_handoff_ref: Type.Optional(Type.String({description:"Omit if unique; else exact current ref."})),
				research_decision: Type.Optional(Type.Union([Type.Literal("defer"), Type.Literal("skip"), Type.Literal("reactivate")])),
				research_reason: Type.Optional(Type.String()),
				resume_condition: Type.Optional(Type.Object({kind:Type.Union([Type.Literal("manual"),Type.Literal("after_actions")]),
					actions:Type.Optional(Type.Integer({minimum:1,description:"Required after_actions count."}))})),
			transition_analysis: Type.Optional(Type.Object({
				observed_changes: Type.String(), predictive_rules: Type.String(),
				limiting_uncertainty: Type.String(), next_experiment: Type.String(),
				research_kind: Type.Optional(Type.Union([
					Type.Literal("mechanism"), Type.Literal("representation"), Type.Literal("capability"), Type.Literal("composition"),
					Type.Literal("exploration"), Type.Literal("planning"), Type.Literal("solution"), Type.Literal("recovery"),
				], { description: "Research object, not component kind." })),
				capability_opportunities: Type.String(), evidence_refs: Type.Optional(Type.Array(Type.String(), { description: "Exact IDs; one current-window ref required." })),
				window_evidence_refs: Type.Optional(Type.Array(Type.String())), historical_evidence_refs: Type.Optional(Type.Array(Type.String())),
			})),
			development_intent: developmentIntentParameters,
			review: Type.Optional(Type.Array(Type.Object({
				component: Type.Optional(Type.Union(REVIEW_COMPONENTS.map(value => Type.Literal(value)), {description:"Omit if candidate identifies kind."})), disposition: Type.Union([...REVIEW_DISPOSITIONS,"keep"].map(value => Type.Literal(value)), {description:"keep=reuse"}), reason: Type.String({minLength:1}),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				result_refs: Type.Optional(Type.Array(Type.String())),
				result_reason: Type.Optional(Type.String()),
				next_use: Type.Optional(Type.String()), validation: Type.Optional(Type.String()),
				candidate: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Complete create/update body; omit for gap." })),
				patterns: Type.Optional(Type.Array(Type.Object({
					pattern: Type.Optional(Type.String({description:"Rule; omitted copies candidate."})), evidence_refs: Type.Array(Type.String()),
					applicability: Type.String(), counterexamples: Type.String(),
					candidate: Type.String(), next_use: Type.String(), validation: Type.String(),
				}))),
			}))),
				enabled_tools: Type.Optional(Type.Array(Type.String())),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				expected_assembly_revision: Type.Optional(Type.Integer({ minimum: 0 })),
				selected_resource_refs: Type.Optional(Type.Array(Type.String())),
				prompt_contributions: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
				decision_id: Type.Optional(Type.String()),
				observation_refs: Type.Optional(Type.Array(Type.String())),
				verdict: Type.Optional(Type.String()),
				consequence: Type.Optional(Type.String()),
				remaining_uncertainty: Type.Optional(Type.String()),
			})),
		async execute(toolCallId, params) {
			if (params.assembly !== undefined && params.action !== "change")
				throw new Error("assembly is only valid on create/change publication; use action=assemble for existing resources");
			if (params.action === "compact_results" || params.action === "restore_results") {
				const before = parentResults.inspect();
				const receipt = parentResults.choose(params.action, params.result_refs ?? [], params.result_reason);
				recordContextChoice(params.action, toolCallId, before, parentResults.inspect());
				return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			}
			if (params.action === "context") {
				const report = contextCostReport();
				return { content: [{ type: "text", text: JSON.stringify(report) }], details: report };
			}
			if (params.action === "contract") {
				if (params.topic === "level_review") {
					const window = pendingLevelReviews().find(row => row.window_id === params.window_id);
					if (!window) throw new Error("Unknown pending level outcome window; inspect current pending_level_reviews");
					const result = { format: "arc-level-review-contract-v1", guidance: LEVEL_REVIEW_GUIDANCE,
						window, input_contract: levelReviewContract(window) };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				const latestOpportunity = params.topic === "opportunity"
					? readJsonl("task-harness-opportunities.jsonl").at(-1) : undefined;
				const reference = harnessOperatingReference(params.topic, params.topic === "opportunity" ? {
					observation_count: String(latestOpportunity?.observation_count ?? readJsonl("execution-observations.jsonl").length),
					repeated_operations: JSON.stringify(latestOpportunity?.repeated_operations ?? []),
					missing_components: JSON.stringify(latestOpportunity?.missing_components ?? []),
				} : {}, params.section);
				const assembly = params.topic === "assembly" ? currentAssembly() : undefined;
				const result = { ...reference, ...(params.topic === "assembly" ? {
					current_assembly: assembly ?? null,
					assemble_template: { action: "assemble", expected_assembly_revision: assembly?.revision ?? 0,
						selected_resource_refs: assembly?.selected_resource_refs ?? [],
						prompt_contributions: assembly?.prompt_contributions ?? [] },
				} : {}) };
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (params.action === "methods") return { content: [{ type: "text", text: JSON.stringify({ methods: baselineMethodCatalog() }) }] };
			if (params.action === "read_method") {
				const method = readBaselineMethod(params.method_name ?? "", params.method_resource ?? "SKILL.md", params.expected_sha256);
				const { content, ...receipt } = method;
				const intent = params.development_intent
					? recordDirectDevelopmentIntent(params.development_intent, `method_read:${method.name}`) : undefined;
				append("task-baseline-method-reads.jsonl", { ...receipt, actor: "parent", toolCallId, recordedAt: new Date().toISOString() });
				// Keep the method body available to the author while making the exact
				// immutable reference machine-readable in the model-visible result.
				// `details` alone is not a reliable provider surface.
				const authoringTemplate = params.method_resource && params.method_resource !== "SKILL.md"
					? undefined : preparedAuthoringTemplate(method.name,method.method_ref);
				const handoff = authoringTemplate ? {status:"prepared_not_published",
					instruction:"Fill the candidate. Keep/edit the template's assembly option to explicitly select the exact versions written by this call plus its listed existing refs, or omit it to write only the pool. Await successful creation/assembly receipts, then trial. Reading is preparation, not benefit.",
					assembly_revision: currentAssembly()?.revision ?? 0,
					selected_resource_refs: currentAssembly()?.selected_resource_refs ?? [],
					...(intent ? {development_intent:intent} : {}),
					...(intent ? {next_change_call:{tool:"task_harness",arguments:authoringTemplate.change_call},
					defer_call:{tool:"task_harness",arguments:{action:"development_intent",development_intent:{
						operation_id:intent?.operation_id ?? "<same parent-authored operation_id>",
						purpose:intent?.purpose ?? "<same parent-authored purpose>",status:"deferred",
							reason:"<why development is deferred>",reconsider_when:"<concrete resumption condition>"}}}} : {}),
				} : undefined;
				const result = { format: "baseline-method-read-v1", ...receipt,
					creator_ref: method.method_ref, ...(handoff ? {authoring_handoff:handoff} : {}),
					...(authoringTemplate ? { authoring_template: authoringTemplate } : {}), content };
				const visibleResult = params.method_offset !== undefined || params.method_limit !== undefined
					? projectBaselineMethodPage(result, params.method_offset ?? 0, params.method_limit ?? DEFAULT_METHOD_PAGE_CHARS)
					: result;
				const details = { ...receipt, creator_ref: method.method_ref,
					...(authoringTemplate ? { authoring_template: authoringTemplate } : {}) };
				return { content: [{ type: "text", text: JSON.stringify(visibleResult) }], details };
			}
			if (params.action === "development_intent") {
				if (!params.development_intent) throw new Error("development_intent is required; runtime does not infer a development operation.");
				const record = recordDirectDevelopmentIntent(params.development_intent, "direct_parent_control");
				const result = {action:"development_intent", status:"parent_intent_recorded", intent:record,
					instruction:"This is a parent-owned control record, not a component, selection, use, or action gate."};
				return {content:[{type:"text",text:JSON.stringify(result)}],details:result};
			}
			const admission = admitTaskLocalOperation("task_harness");
			if (admission) return admission;
			if (params.action === "defer_review") {
				const queue = patternReviewQueue();
				const opportunity = params.opportunity_id ? readJsonl("task-harness-opportunities.jsonl")
					.find(row => row.opportunity_id === params.opportunity_id) : undefined;
				const window = params.window_id || opportunity?.window?.window_id
					? queue.due.find(row => row.window_id === (params.window_id ?? opportunity?.window?.window_id)) : queue.current;
				if (!window) throw new Error("defer_review requires a current due window; inspect pending_pattern_extraction");
				if (!params.review_reason?.trim()) throw new Error("defer_review requires review_reason from the parent");
				const actions = params.resume_condition?.actions;
				if (params.resume_condition?.kind !== "manual"
					&& (params.resume_condition?.kind !== "after_actions" || !Number.isInteger(actions) || Number(actions) < 1))
					throw new Error("defer_review requires manual or after_actions with positive actions");
				const receipt = { window_id: window.window_id, status: "deferred", decided_by: "parent",
					parent_reason: params.review_reason, evidence_refs: window.evidence_refs,
					resume_condition: params.resume_condition,
					...(params.resume_condition.kind === "after_actions" ? { resume_after_action_count: queue.action_count + Number(actions) } : {}),
					recordedAt: new Date().toISOString() };
				append("task-harness-review-events.jsonl", receipt);
				return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			}
			if (params.action === "report_level_reset") {
				const observation = readJsonl("execution-observations.jsonl").find(row => row.observation_id === params.boundary_ref);
				if (!observation || observation.tool_name !== "arc_action" || observation.is_error || !params.reset_reason?.trim())
					throw new Error("Reset report requires an executed ARC action reference and evidence-based reason");
				if (!readJsonl("task-level-reset-reports.jsonl").some(row => row.boundary_ref === params.boundary_ref))
					append("task-level-reset-reports.jsonl", { boundary_ref: params.boundary_ref, reason: params.reset_reason,
						status: "agent_reported_not_environment_confirmed", recordedAt: new Date().toISOString() });
				return { content: [{ type: "text", text: JSON.stringify(pendingLevelReviews()) }] };
			}
			if (params.action === "level_review") {
				const windows = levelWindows();
				const rawWindow = windows.find(row => row.window_id === params.window_id);
				const window = rawWindow ? { ...rawWindow, tool_call_index: levelOutcomeCostIndex(rawWindow, windows) } : undefined;
				if (!window) throw new Error("Unknown level outcome window; use the pending context window_id");
				const prior = readJsonl("task-level-reviews.jsonl").find(row => row.window_id === window.window_id);
				if (prior) {
					const receipt = levelReviewReceipt(prior);
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
				const report = validateLevelReview(window, params.level_review ?? {}, levelReviewObservations(), levelReviewResources());
				report.outcome_cost_index_ref = persistLevelOutcomeCostIndex(window, windows).ref;
				append("task-level-reviews.jsonl", report);
				const receipt = levelReviewReceipt(report);
				return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			}
			if (params.action === "decide_research") {
				latestResearchHandoffs();
				const eligible = eligibleResearchHandoffStatuses(params.research_decision);
				const candidates = latestControlRecords(readJsonl("auto-research-handoffs.jsonl"), "handoff_id")
					.filter(row => eligible.includes(row.status));
				if (!params.research_handoff_ref && candidates.length === 0) {
					const result = { format:"task-harness-no-op-v1", action:"decide_research",
						status:"no_eligible_handoff", applied:false,
						reason:"There is no research handoff requiring a parent decision." };
					return { content:[{type:"text",text:JSON.stringify(result)}], details:result };
				}
				const current = resolveResearchHandoff(readJsonl("auto-research-handoffs.jsonl"), params.research_handoff_ref, eligible);
				if (!eligible.includes(current.status)) controlError("invalid_transition",[{path:"research_handoff_ref",message:`research handoff is already decided: ${current.status}`}]);
				if (!["defer", "skip", "reactivate"].includes(String(params.research_decision))) throw new Error("research_decision must be defer, skip or reactivate");
				if (!String(params.research_reason ?? "").trim()) throw new Error("research_reason is required");
				const condition = params.resume_condition ?? {kind:"manual"};
				if (condition.kind === "after_actions" && (!Number.isInteger(condition.actions) || Number(condition.actions) < 1)) controlError("invalid_resume_condition",[{path:"resume_condition.actions",message:"Positive integer required"}]);
				const decided = advanceResearchHandoff(current, {
					status: params.research_decision === "reactivate" ? "proposed" : params.research_decision === "skip" ? "skipped" : "deferred",
					parent_reason: String(params.research_reason),
					decided_by:"parent", degraded:false,
					resume_condition:condition,
					...(condition.kind === "after_actions" ? {resume_after_action_count:readJsonl("execution-observations.jsonl").filter(row => row.tool_name === "arc_action" && !row.is_error).length + Number(condition.actions)} : {}),
				});
				append("auto-research-handoffs.jsonl", decided);
				return { content: [{ type: "text", text: JSON.stringify(decided) }], details: decided };
			}
			if (params.action === "capability_review") {
				const reviews = capabilityReviewSources();
				const source = reviews.find(r => r.opportunity_id === params.opportunity_id);
				if (!source) throw new Error("Use an existing capability_followups opportunity_id from inspect.");
				const entries = normalizeHarnessReview(params.review ?? [], knownTaskResourceRefs());
				const explicit = entries.filter(entry => ["system_prompt", "skill", "tool", "subagent"].includes(entry.component)
					&& entry.source !== "runtime_default");
				if (!explicit.length && !params.development_intent) {
					const result = { action: "capability_review", status: "no_decision_submitted", applied: false,
						opportunity_id: source.opportunity_id,
						instruction: "No capability decision was submitted. Continue the task; when useful, author a component through change or record a carrier decision here." };
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				}
				for (const entry of explicit) {
					const component = entry.component;
					if (entry.candidate) throw new Error("capability_review records decisions only; submit authored candidates through change.");
					if (!["reuse", "defer", "not_applicable"].includes(entry.disposition)) throw new Error("Author with read_method and change first, then record reuse with exact resource_refs; otherwise defer with the missing prerequisite.");
					if (entry.disposition === "reuse" && (!entry.resource_refs?.length || entry.resource_refs.some((ref: string) => !ref.startsWith(`${component}:`)))) throw new Error(`reuse requires existing exact ${component} resource_refs.`);
					if (entry.disposition === "reuse" && entry.resource_refs.some((ref: string) => !componentPool().some(item => item.kind === component && item.eligible && item.aliases.includes(ref)))) throw new Error("reuse requires current eligible pool versions; inspect the component pool.");
				}
				const prior = readJsonl("task-capability-decisions.jsonl").findLast(row => row.opportunity_id === source.opportunity_id);
				const includeSystemPrompt = explicit.some(entry => entry.component === "system_prompt")
					|| prior?.entries?.some((entry: Record<string, any>) => entry.component === "system_prompt" && entry.source !== "runtime_default")
					|| source.entries?.some((entry: Record<string, any>) => entry.component === "system_prompt" && entry.source !== "runtime_default");
				const componentOrder = source.research_authoring_handoff
					? [...new Set([source.research_authoring_handoff.recommended_component_kind, ...explicit.map(entry => entry.component)])]
					: [...(includeSystemPrompt ? ["system_prompt"] : []), "skill", "tool", "subagent"];
				const merged = componentOrder.map(component =>
					explicit.find(entry => entry.component === component)
					?? prior?.entries?.find((entry: Record<string, any>) => entry.component === component)
					?? (component === "system_prompt" ? source.entries?.find((entry: Record<string, any>) => entry.component === component && entry.source !== "runtime_default") : undefined)
					?? { component, disposition:"defer", source:"runtime_default",
						reason:"No parent judgment recorded for this carrier; the operation remains unresolved." });
				const result = { opportunity_id: source.opportunity_id, review_id: source.review_id, entries: merged,
					...(params.development_intent ? { development_intent: params.development_intent } : {}),
					carrier_preparation:carrierPreparation(explicit, baselineMethodCatalog()),
					status: "parent_decision_recorded", utility_verified: false, recordedAt: new Date().toISOString() };
				append("task-capability-decisions.jsonl", result);
				if (params.development_intent)
					recordDirectDevelopmentIntent(params.development_intent, `capability_review:${source.opportunity_id}`, false);
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (params.action === "review") {
				recoverReviewCommits();
				const reviews = readJsonl("task-harness-reviews.jsonl");
				const opportunities = readJsonl("task-harness-opportunities.jsonl");
				if (params.opportunity_id) {
					const committed = reviews.find(row => row.opportunity_id === params.opportunity_id);
					if (committed) {
						if (process.env.PI_ARC_EXECUTION_GATE === "enabled") {
							const currentHandoff = [...latestResearchHandoffs().values()].find(row => row.review_id === committed.review_id);
							const receipt = periodicReviewReceipt(committed, currentHandoff, undefined, true);
							return { content:[{type:"text",text:JSON.stringify(receipt)}], details:receipt };
						}
						const result = { ...committed, status:"already_committed", applied:false,
							reason:"This review was already committed; the existing result is returned." };
						return { content:[{type:"text",text:JSON.stringify(result)}], details:result };
					}
				}
				const failedWindows = new Set(readJsonl("task-harness-review-events.jsonl").filter(row => row.status === "failed").map(row => row.window_id));
				const pending = opportunities.filter(row => !reviews.some(review => review.opportunity_id === row.opportunity_id) && !failedWindows.has(row.window?.window_id));
				const fallbackChanges = (params.review ?? [])
					.filter((entry: Record<string, any>) => ["create", "update"].includes(String(entry.disposition))
						&& entry.candidate && typeof entry.candidate === "object")
					.map((entry: Record<string, any>) => ({operation:entry.disposition,
						candidate:{component:entry.component,...entry.candidate}}));
				const directChangeFallback = {
					action:"change", changes:fallbackChanges,
					decision:{basis_refs:[...new Set([
						...(params.transition_analysis?.evidence_refs ?? []),
						...fallbackChanges.flatMap((change: Record<string, any>) => change.candidate?.basis_refs ?? []),
					])], reason:"<reconfirm why the submitted operation and carrier remain useful now>",
						expected:"<observable result at the still-reachable next use>"},
					instruction:"The review window does not own direct authoring. Reconfirm current applicability, preserve the parent-authored candidate, then submit this through task_harness(action=change). Runtime will not apply it automatically.",
				};
				const requestedPending = params.opportunity_id
					? pending.some(row => row.opportunity_id === params.opportunity_id) : pending.length > 0;
				if (!requestedPending) controlError("review_window_unavailable", [{path:"opportunity_id",
					message:"No eligible review opportunity remains. This does not block direct parent authoring."}],
					{candidates:pending.map(row => row.opportunity_id),direct_change_fallback:directChangeFallback});
				const currentWindow = pendingPeriodicReview();
				const defaultOpportunity = currentWindow && pending.find(row => row.window?.window_id === currentWindow.window_id);
				const opportunity = selectControlTarget(pending, "opportunity_id", params.opportunity_id ?? defaultOpportunity?.opportunity_id);
				const intentById = new Map<string, Record<string, any>>();
				for (const draft of readJsonl("task-harness-review-drafts.jsonl").filter(row => row.opportunity_id === opportunity.opportunity_id))
					for (const intent of [...(draft.development_intents ?? []), draft.development_intent].filter(Boolean))
						if (intent.operation_id) intentById.set(String(intent.operation_id), intent);
				if (params.development_intent?.operation_id) intentById.set(String(params.development_intent.operation_id), params.development_intent);
				const developmentIntents = [...intentById.values()];
				try {
				const errors: Record<string,any>[] = [];
				const entries = normalizeHarnessReview(params.review ?? [], knownTaskResourceRefs(), errors);
				let transition = params.transition_analysis;
				if (opportunity.window) {
					const allowed = new Set([...opportunity.window.evidence_refs, opportunity.window.baseline_ref].filter(Boolean));
					const observations = readJsonl("execution-observations.jsonl");
					// A delayed review can use evidence acquired after its window.
					// Window membership stays fixed; contextual refs must exist now.
					const historical = new Set(observations.map(row => row.observation_id));
					try { transition = validateTransitionAnalysis(transition, allowed, historical); }
					catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						try { errors.push(...JSON.parse(message).errors); } catch { errors.push({path:"transition_analysis",message}); }
					}
					for (const entry of entries) {
						if (!["create", "update"].includes(entry.disposition) || entry.patterns?.length || !entry.candidate || typeof entry.candidate !== "object") continue;
						const candidate = normalizeSemanticCandidate(entry.candidate as Record<string, any>);
						const evidenceRefs = (transition?.evidence_refs ?? []).filter((ref: string) => historical.has(ref));
						entry.patterns = [{
							pattern: String(candidate.summary ?? entry.reason),
							evidence_refs: evidenceRefs,
							applicability: String(candidate.applicability ?? candidate.scope?.statement ?? candidate.scope ?? entry.next_use),
							counterexamples: String(candidate.counterexamples ?? transition?.limiting_uncertainty ?? "No counterexample supplied."),
							candidate: canonicalTextBody(candidate.instructions ?? candidate.content ?? candidate.summary, "review candidate"),
							next_use: String(entry.next_use), validation: String(entry.validation),
						}];
					}
					for (const entry of entries) {
						if (["create", "update"].includes(entry.disposition) && !entry.patterns?.length) errors.push({path:`review.${entry.component}.patterns`,message:"Periodic candidates require evidence-linked patterns and usable candidate bodies"});
						for (const pattern of entry.patterns ?? []) {
							if (!pattern.evidence_refs.length || pattern.evidence_refs.some((ref:string) => !historical.has(ref))) errors.push({path:`review.${entry.component}.patterns.evidence_refs`,message:"Pattern evidence must exist in this task at or before the window endpoint"});
							if ([pattern.pattern, pattern.applicability, pattern.candidate, pattern.next_use, pattern.validation].some(value => !String(value ?? "").trim())) errors.push({path:`review.${entry.component}.patterns`,message:"Pattern body, applicability, next use and validation must be nonempty"});
						}
					}
				}
				if (errors.length) {
					const directChangeFallback = duplicateReviewDirectChangeFallback(
						params.review ?? [], params.transition_analysis?.evidence_refs ?? []);
					controlError("invalid_review",errors,{...reviewRepairContract(opportunity.window),
						...(directChangeFallback ? {direct_change_fallback:directChangeFallback} : {})});
				}
				preflightCreators(entries.filter(entry => entry.candidate && ["create", "update"].includes(entry.disposition))
					.map(entry => ({ operation: entry.disposition, candidate: { component: entry.component, ...entry.candidate } })));
				const fingerprint = stableControlJSON({entries,transition,development_intents:developmentIntents});
				const existing = reviews.find(e => e.opportunity_id === opportunity.opportunity_id);
				if (existing && (existing.fingerprint ?? stableControlJSON({entries:existing.entries,transition:existing.transition_analysis})) !== fingerprint)
					controlError("already_reviewed",[{path:"opportunity_id",message:"This opportunity already has a committed review; inspect it instead of creating another handoff"}],{review_id:existing.review_id});
				const reviewId = existing?.review_id ?? `harness-review-${readJsonl("task-harness-reviews.jsonl").length + 1}`;
				const priorResearch = latestControlRecords(readJsonl("auto-research-handoffs.jsonl"), "handoff_id")
					.filter(item => ["active", "pending", "completed"].includes(String(item.status)))
					.slice(-4)
					.map(item => ({
						status: item.status,
						report_ref: item.report_ref ?? null,
						research_run_ref: item.research_run_ref ?? null,
						session_ref: item.session_ref ?? null,
						result_summary: compactText(item.result_summary ?? item.question ?? "").slice(0, 1200),
						research_line_ref: item.research_line_ref ?? null,
						research_kind: item.research_kind ?? item.research_problem?.kind ?? null,
						research_problem: item.research_problem ?? null,
					}));
				const researchHandoff = opportunity.window
					? buildPeriodicResearchHandoff(reviewId, opportunity.window, transition!, entries, priorResearch) : undefined;
				const componentApplicationPlan = entries
					.filter((entry) => ["create", "update"].includes(String(entry.disposition)))
					.map((entry) => ({
						component: entry.component,
						disposition: entry.disposition,
						status: entry.candidate && typeof entry.candidate === "object" ? "ready_for_runtime_application" : "pending_candidate_body",
						...(entry.candidate && typeof entry.candidate === "object" ? { candidate: normalizeSemanticCandidate({
							component:entry.component, ...entry.candidate,
							basis_refs:Array.isArray(entry.candidate.basis_refs) && entry.candidate.basis_refs.length
								? entry.candidate.basis_refs
								: [...new Set((entry.patterns ?? []).flatMap((pattern: Record<string, any>) => pattern.evidence_refs ?? []))],
						}) } : {}),
						next_tool: "task_harness",
						next_action: "change",
						instruction: "Submit the reviewed content through task_harness(action=change); include semantic routing attributes and the parent decision basis, then verify the native receipt and later use.",
					}));
				const review = existing ?? {
					review_id: reviewId,
					opportunity_id: opportunity.opportunity_id, entries, fingerprint,
					component_application_plan: componentApplicationPlan,
					...(transition ? { transition_analysis: transition } : {}),
					...(developmentIntents.length ? { development_intents: developmentIntents } : {}),
					...(opportunity.window ? { window_id: opportunity.window.window_id, window: opportunity.window } : {}),
					...(researchHandoff ? { research_handoff_ref: researchHandoff.ready_call.research_handoff_ref } : {}),
					method_research_contract: methodResearchContract(entries, researchHandoff), recordedAt: new Date().toISOString(),
				};
				if (!existing) {
					append("task-harness-review-commits.jsonl",{review,handoff:researchHandoff ?? null,recordedAt:new Date().toISOString()});
					recoverReviewCommits();
					// Only this call's explicit parent update advances the canonical
					// status. Inherited failed-draft content remains recoverable, but
					// cannot silently reopen a previously resolved operation.
					if (params.development_intent)
						recordDirectDevelopmentIntent(params.development_intent, `review:${review.opportunity_id}`, false);
				}
				const liveHandoff = researchHandoff ? latestResearchHandoffs().get(researchHandoff.handoff_id) : undefined;
				let applicationReceipt: Record<string, any> | undefined;
				const applicable = (review.component_application_plan ?? componentApplicationPlan)
					.filter((entry: Record<string, any>) => entry.status === "ready_for_runtime_application");
				if (!existing && applicable.length) {
					const applied = await applyFacadeChanges(`${toolCallId}:review-application`, {
						changes: applicable.map((entry: Record<string, any>) => ({ operation: entry.disposition, candidate: entry.candidate })),
						decision: {
							basis_refs: [...new Set(applicable.flatMap((entry: Record<string, any>) => entry.candidate?.basis_refs ?? []))],
							reason: `Apply complete structured candidates selected in ${reviewId}.`,
							expected: "Make the reviewed task-local capability available for its declared next use and validation.",
						},
					});
					applicationReceipt = applied.details as Record<string, any>;
				}
				const result = {...review, component_application_plan: review.component_application_plan ?? componentApplicationPlan,
					carrier_preparation:carrierPreparation(entries.filter(entry => entry.source !== "runtime_default"), baselineMethodCatalog()),
					...(applicationReceipt ? {application_receipt:applicationReceipt} : {}), ...(liveHandoff ? {research_handoff_ref:`research_handoff:${liveHandoff.handoff_id}@v${liveHandoff.version}`,
					method_research_contract:{...review.method_research_contract,research_handoff_ref:`research_handoff:${liveHandoff.handoff_id}@v${liveHandoff.version}`,
						ready_auto_research_calls:liveHandoff.status === "proposed" ? liveHandoff.ready_calls ?? {start:liveHandoff.next_call} : null},handoff:liveHandoff} : {})};
				if (process.env.PI_ARC_EXECUTION_GATE === "enabled") {
					const receipt = periodicReviewReceipt(review, liveHandoff, applicationReceipt);
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				} catch (error) {
					append("task-harness-review-drafts.jsonl", {
						opportunity_id: opportunity.opportunity_id, status: "invalid",
						entries: params.review ?? [], transition_analysis: params.transition_analysis,
						...(developmentIntents.length ? { development_intents: developmentIntents } : {}),
						direct_change_fallback: directChangeFallback,
						error: error instanceof Error ? error.message : String(error),
						recordedAt: new Date().toISOString(),
					});
					throw error;
				}
			}
			if (params.action === "change") return publishParentChanges(toolCallId, params as Record<string, any>);
			if (params.action === "assemble") return applyParentAssembly(params as Record<string, any>);
			if (params.action === "assess_effect") return assessHarnessEffect(toolCallId, params as Record<string, any>);
			if (params.action === "start") {
				const latestTaskTools = latestBy(readJsonl("task-tools.jsonl"), "name");
				const latestSubagents = latestBy(readJsonl("task-subagents.jsonl"), "name");
				const activeResources = {
					memory: [...memories.values()].filter((item) => item.status === "active").length,
					system_prompt: [...systemPrompts.values()].filter((item) => item.status === "active").length,
					skill: [...skills.values()].filter((item) => item.status === "active").length,
					tool: [...latestTaskTools.values()].filter((item) => item.status === "active").length,
					subagent: [...latestSubagents.values()].filter((item) => item.status === "active").length,
				};
				if (harnessStarted) {
					const status = {
						format: "task-local-self-harness-entry-v1",
						status: "already_started",
						active_resources: activeResources,
						message: "The task-local self-harness is already started. Use task_harness(action=change/inspect/focus); do not repeat kickoff.",
					};
					return { content: [{ type: "text", text: JSON.stringify(status) }], details: status };
				}
				harnessStarted = true;
				const entry = {
					format: "task-local-self-harness-entry-v1",
					status: "unlocked",
					active_resources: activeResources,
					creation_calls: ["task_harness(action=change)"],
					minimal_recipes: {
						memory: "upsert a concise task fact or control mapping; omit target_version for a new key, and use the inspected current version only when updating an existing key",
						system_prompt: "author an explicit working directive with the appropriate task, phase, or level validity; select its exact version through assemble for later parent context",
						skill: "create a repeatable observation or reasoning procedure",
						tool: "create either a task-pure-expression-v1 JSON AST with explicit input/output schemas, or a legacy adapter-bounded program.steps contract; never combine both formats",
						subagent: "create a read-only independent reviewer, then delegate a decision-relevant question",
					},
					lifecycle: "Creation is agent-owned and immediate. A new skill, tool version, or subagent definition is exposed to the model on the next provider context; use it then and record the result before revising.",
					safety: "Task-local resources remain confined to the current task. Adapter allowlists, read-only ARC delegation, and host/network/filesystem boundaries remain enforced.",
				};
				append("task-harness-entry-events.jsonl", {
					event: "self_harness_started",
					entry,
					recordedAt: new Date().toISOString(),
				});
				const compactEntry = {
					format: entry.format, status: entry.status, active_resources: entry.active_resources,
					creation_calls: entry.creation_calls,
					message: "Harness control plane enabled. Use task_harness(action='activate', enabled_tools=[...]) only for a concrete decision; 'enable' remains a compatibility alias.",
				};
				return { content: [{ type: "text", text: JSON.stringify(compactEntry) }], details: entry };
			}
			if (params.action === "enable" || params.action === "activate") {
				const aliases: Record<string, string> = {
					memory: "task_harness", skill: "read",
					tool: "task_harness", subagent: "delegate_task", delegate: "delegate_task",
					research: "research_resource",
					status: "task_harness_status", policy: "task_tool_policy",
					validation: "task_validation", assessment: "assess_harness_effect",
					trajectory: "inspect_arc_trajectory",
					compaction: OBSERVATION_COMPACTION_TOOL,
				};
				// Accept resource-kind shorthands in addition to exact tool names.
				// Models naturally emit `memory` after reading the portfolio; the
				// control plane should resolve that to the real callable entry rather
				// than producing an avoidable error and losing a decision turn.
				const requested = (params.enabled_tools ?? []).map((name) => aliases[name] ?? name);
				// Selecting the task-tool portfolio restores every persisted active dynamic tool so
				// a new Pi session can use previously-created tools without a separate
				// resource-level `use` operation.
				if ((params.enabled_tools ?? []).some((name: string) => name === "tool") || requested.includes("task_tool")) {
					const latestTaskTools = latestBy(readJsonl("task-tools.jsonl"), "name");
					for (const item of latestTaskTools.values()) {
						if (item.status === "active" && typeof item.exposed_name === "string") requested.push(item.exposed_name);
					}
				}
				const directNative = requested.filter((name) => (INTERNAL_NATIVE_HARNESS_TOOLS as readonly string[]).includes(name));
				if (directNative.length && process.env.PI_EXTERNAL_STEPS === undefined) throw new Error(`component mutation tools are internal; use task_harness(action=change): ${directNative.join(", ")}`);
				const allowed = authorizedTools();
				const unknown = requested.filter((name) => !allowed.has(name));
				if (unknown.length) {
					const rejected = { format: "task-local-harness-rejection-v1", action: params.action, unknown_tools: unknown,
						message: "These task-local entries are not registered in this run. Inspect task_harness(action='summary') or task_harness(action='status') and request only registered entries." };
					return { content: [{ type: "text", text: JSON.stringify(rejected) }], details: rejected };
				}
				pi.setActiveTools([...new Set([...pi.getActiveTools(), ...requested, "task_harness"])]);
			}
			if (params.action === "focus") {
				const requested = params.resource_refs ?? [];
				const unknown = requested.filter((reference) => !knownTaskResourceRefs().has(reference));
				if (unknown.length) {
					const rejected = { format: "task-local-harness-rejection-v1", action: "focus", unknown_resource_refs: unknown,
						message: "These resource references do not exist in the current task run. Do not reuse references from another run; continue from the current checkpoint." };
					return { content: [{ type: "text", text: JSON.stringify(rejected) }], details: rejected };
				}
				const before = {focused_resource_refs: focusedResourceRefs === undefined ? null : [...focusedResourceRefs].sort()};
				focusedResourceRefs = requested.length ? new Set(requested) : undefined;
				recordContextChoice("focus", toolCallId, before,
					{focused_resource_refs: focusedResourceRefs === undefined ? null : [...focusedResourceRefs].sort()});
			}
			if (params.action === "summary" || ((params.action === "inspect" || params.action === "status") && params.section !== undefined)) {
				const fullStatus = (await statusTool.execute()).details as Record<string, any>;
				const fullStatusAction = process.env.PI_ARC_EXECUTION_GATE === "enabled" ? "status" : "inspect";
				const result = params.action === "summary"
					? harnessStatusSummary(fullStatus, fullStatusAction)
					: harnessStatusSection(fullStatus, params.section, fullStatusAction);
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (params.action === "inspect" || params.action === "status") {
				if (process.env.PI_ARC_EXECUTION_GATE === "enabled") {
					const fullStatus = (await statusTool.execute()).details as Record<string, any>;
					const state = harnessStateView(fullStatus);
					return {content:[{type:"text",text:JSON.stringify(state)}],details:state};
				}
				return statusTool.execute();
			}
			const status = await statusTool.execute();
			const fullStatus = status.details as Record<string, any>;
			const receipt = {
				format: "task-harness-control-receipt-v1", action: params.action, applied: true,
				active_tools: fullStatus.active_tools,
				focused_resource_refs: fullStatus.focused_resource_refs,
				current_assembly: fullStatus.current_assembly ? {
					assembly_ref: `harness_assembly:${fullStatus.current_assembly.assembly_id}@v${fullStatus.current_assembly.revision}`,
					selected_resource_refs: fullStatus.current_assembly.selected_resource_refs,
				} : null,
				full_status_call: { tool: "task_harness", arguments: {
					...(process.env.PI_ARC_EXECUTION_GATE === "enabled" ? { action: "status", section: "all" } : { action: "inspect" }) } },
			};
			// Preserve the complete programmatic status while keeping routine
			// enable/focus acknowledgements small in the model-visible content.
			return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: fullStatus };
		},
	});

	registerRoutableTool({
		name: "task_memory",
		label: "Task-local memory",
		description: "Versioned Memory CRUD. Body edits need content/append_content; projection=null disables injection. Updates use current target_version. See contract(memory).",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("upsert"), Type.Literal("retire"), Type.Literal("inspect")]),
			...linkParameters,
			key: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1, description: "Current version for update (CAS)." })),
			content: Type.Optional(Type.String()),
			append_content: Type.Optional(Type.String()),
			summary: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			validity: Type.Optional(Type.Object({ scope: Type.Union([Type.Literal("task"), Type.Literal("episode"), Type.Literal("level"), Type.Literal("state")]), task_ref: Type.Optional(Type.String()), instance_ref: Type.Optional(Type.String()) })),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			pinned: Type.Optional(Type.Boolean()),
			projection: Type.Optional(Type.Union([Type.Null(), Type.Object({
				channel: Type.Literal("task_prompt"),
				layer: Type.Optional(Type.Union([Type.Literal("task_policy"), Type.Literal("task_state")])),
				prompt_text: Type.Optional(Type.String()),
				activation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			})])),
			atom: Type.Optional(Type.Object({
				subject: Type.String(),
				predicate: Type.String(),
				value: Type.Unknown(),
			})),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const selected = p.key ? [memories.get(String(p.key))].filter(Boolean) : [...memories.values()];
				const inspected = selected.map((item) => resourceMetadata("memory", item!));
				for (const item of selected) if (item) recordResourceRead("memory", item, "task_memory.inspect", "metadata_inspect");
				return { content: [{ type: "text", text: JSON.stringify({ memories: inspected }) }], details: { memories: inspected } };
			}
			const admission = admitTaskLocalOperation("task_memory");
			if (admission) return admission;
			const key = String(p.key ?? "").trim();
			if (!key) throw new Error("key is required");
			const previous = memories.get(key);
			let validity = p.validity !== undefined
				? normalizeMemoryValidity(p.validity, currentValidityContext())
				: previous?.validity;
			if (p.action_decision_capture === true) {
				const observationId = String(p.action_decision_observation_id ?? "");
				const source = readJsonl("execution-observations.jsonl");
				const sourceIndex = source.findIndex((row) => row.observation_id === observationId);
				const sourceRow = source[sourceIndex];
				if (sourceIndex < 0 || sourceRow?.tool_name !== "arc_action" || sourceRow.is_error
					|| !sourceRow.input?.decision || (sourceRow.input?.decision?.hypothesis === undefined && sourceRow.input?.decision?.prediction === undefined))
					throw new Error("action decision capture must reference a persisted successful arc_action with parent decision text");
				const preAction = memoryValidityContext(taskScope.taskId, source.slice(0, sourceIndex));
				const expected = { scope: "level", task_ref: preAction.task, instance_ref: preAction.level };
				if (!validity || validity.scope !== expected.scope || validity.task_ref !== expected.task_ref || validity.instance_ref !== expected.instance_ref)
					throw new Error("action decision capture validity must bind the pre-action level instance");
				if (key !== `action-decision:${observationId}`) throw new Error("action decision capture key must bind its exact observation id");
				if (p.probe_record?.decision_capsule === undefined || p.probe_record?.observed_outcome === undefined)
					throw new Error("action decision capture requires separate decision_capsule and observed_outcome fields");
				const capsule = p.probe_record.decision_capsule as Record<string, any>;
				if (Object.keys(capsule).some((field) => !["hypothesis", "prediction", "falsifier", "subgoal", "next_step"].includes(field)
					|| JSON.stringify(capsule[field]) !== JSON.stringify(sourceRow.input.decision[field]))
					|| !["hypothesis", "prediction"].some((field) => typeof capsule[field] === "string" && capsule[field].trim()))
					throw new Error("action decision capsule must copy the supported parent-authored fields verbatim");
				if (previous?.action_decision_observation_id === observationId) {
					return { content: [{ type: "text", text: JSON.stringify(resourceMetadata("memory", previous)) }],
						details: { ...previous, idempotent: true } };
				}
			}
			if (previous && Number(p.target_version) !== previous.version) return versionConflict("memory", previous, p.target_version);
			if (!previous && p.target_version !== undefined) throw new Error("target_version is only valid for an existing memory");
			const status = p.action === "retire" ? "retired" : "active";
			if (p.content !== undefined && p.append_content !== undefined) throw new Error("choose content replacement or append_content, not both");
			if (p.append_content !== undefined && (p.atom !== undefined || previous?.atom)) {
				throw new Error("atomic memory cannot append text; revise the atom as one versioned unit");
			}
			const atom = p.atom !== undefined ? normalizeHarnessMemoryAtom(p.atom) : previous?.atom;
			// The key/version identifies the record. Parent-authored subject/predicate
			// wording may evolve with evidence; prior atoms remain in the version log.
			const content = p.append_content !== undefined
				? `${previous?.content ?? ""}${canonicalTextBody(p.append_content, "memory append_content", false)}`
				: atom ? canonicalTextBody(atom.value, "memory atom.value")
					: canonicalTextBody(p.content ?? previous?.content, "memory content");
			if (status === "active" && !content) throw new Error("active memory requires content");
			const views = coherentMemory(p, previous);
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "memory", key, currentValidityContext());
			const decisionId = dependencies.allocateDecisionId();
			const record: MemoryRecord = {
				...links,
				memory_id: previous?.memory_id ?? `memory-${++memoryCounter}`,
				summary: views.summary,
				key,
				version: (previous?.version ?? 0) + 1,
				status,
				content,
				...(atom ? { atom } : {}),
				...(validity ? { validity } : {}),
				scope: String(p.scope ?? previous?.scope ?? "current task"),
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				pinned: Boolean(p.pinned ?? previous?.pinned ?? false),
				...(views.projection ? { projection: views.projection } : {}),
				decision_id: decisionId,
				...(p.memory_capture === true ? {
					capture_id: String(p.capture_id ?? ""),
					capture_item_index: Number(p.capture_item_index ?? -1),
					capture_hash: String(p.capture_hash ?? ""),
					claim_kind: String(p.claim_kind ?? "observation"),
					claim_status: Array.isArray(p.basis_refs) && p.basis_refs.length ? "basis_cited_unverified" : "unverified_hypothesis",
					...(p.probe_record !== undefined ? { probe_record: p.probe_record } : {}),
					...(p.action_decision_observation_id ? { action_decision_observation_id: String(p.action_decision_observation_id) } : {}),
				} : {}),
				expected_effect: String(p.expected_effect ?? (status === "active"
					? "make concise task state available in later Pi contexts"
					: "remove obsolete task state from later Pi contexts")),
				reconsider_when: String(p.reconsider_when ?? "new evidence changes the retained task state"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
				recordedAt: new Date().toISOString(),
			};
			memories.set(key, record);
			append("task-memory.jsonl", record);
			append("harness-decisions.jsonl", p.memory_capture === true ? {
				decision_id: decisionId,
				decision_path: p.action_decision_capture === true ? "action_decision_capture" : "memory_capture",
				choice: status === "active" ? "capture" : "retire",
				applied: true,
				intervention: "memory_pool_write",
				basis_resource_ids: record.basis_refs,
				operation: { capability: "task.memory_pool", component: "task_memory", version: record.version },
				effect_metric: "memory_available_for_selection",
				expected_effect: "make this exact memory version available for later parent selection",
				reconsider_when: "new evidence changes the retained memory",
				capture_id: String(p.capture_id ?? ""), capture_item_index: Number(p.capture_item_index ?? -1),
				capture_hash: String(p.capture_hash ?? ""),
				toolCallId, recordedAt: record.recordedAt,
			} : {
				decision_id: decisionId,
				decision_path: "task_memory",
				choice: status === "active" ? "upsert" : "retire",
				applied: true,
				intervention: "task_memory_context",
				basis_resource_ids: record.basis_refs,
				operation: { capability: "pi.context", component: "task_memory", version: record.version },
				effect_metric: status === "active" ? "memory_visible_on_later_context" : "memory_absent_from_later_context",
				expected_effect: record.expected_effect,
				reconsider_when: record.reconsider_when,
				toolCallId,
				recordedAt: record.recordedAt,
			});
			return { content: [{ type: "text", text: JSON.stringify(resourceMetadata("memory", record)) }], details: record };
		},
	});

	const memoryPoolTool = {
		name: "task_memory_pool",
		label: "Task memory pool",
		description: "Capture/list/retire scoped Memory. Read exact refs with task_resource; explicitly assemble selections.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("capture"), Type.Literal("list"), Type.Literal("retire")]),
			capture_id: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
			items: Type.Optional(Type.Array(Type.Object({
				content: Type.String({ minLength: 1 }),
				scope: Type.Union([Type.Literal("state"), Type.Literal("level"), Type.Literal("episode"), Type.Literal("task")]),
				key: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
				summary: Type.Optional(Type.String({ maxLength: 500 })),
				basis_refs: Type.Optional(Type.Array(Type.String())),
				claim_kind: Type.Optional(Type.Union([Type.Literal("observation"), Type.Literal("hypothesis"), Type.Literal("plan"), Type.Literal("retrospective")])),
				target_version: Type.Optional(Type.Integer({ minimum: 1 })),
				supersedes_refs: Type.Optional(Type.Array(Type.String())),
			}), { minItems: 1, maxItems: 50 })),
			key: Type.Optional(Type.String()),
			memory_ref: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			scope: Type.Optional(Type.Union([Type.Literal("state"), Type.Literal("level"), Type.Literal("episode"), Type.Literal("task")])),
			claim_kind: Type.Optional(Type.String()),
			status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("retired"), Type.Literal("all")])),
			after: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(toolCallId: string, params: Record<string, any>) {
			assertParentTaskResourceBindingHost(pi, root);
			if (params.action === "list") {
				const all = [...memories.values()].map((record) => ({ record, metadata: resourceMetadata("memory", record) }))
					.sort((a, b) => String(a.metadata.resource_ref).localeCompare(String(b.metadata.resource_ref)));
				const assembly = currentAssembly();
				const eligibleEntries = new Map(componentPool().filter((entry) => entry.kind === "memory")
					.map((entry) => [entry.resource_ref, entry]));
				const query = all.filter(({ record, metadata }) => {
					const validity = record.validity as MemoryValidity | undefined;
					return (!params.scope || validity?.scope === params.scope)
						&& (!params.claim_kind || record.claim_kind === params.claim_kind)
						&& (!params.status || params.status === "all" || record.status === params.status)
						&& (!params.after || String(metadata.resource_ref) > String(params.after));
				});
				const limit = Math.min(100, Math.max(1, Number(params.limit ?? 20)));
				const resources = query.slice(0, limit).map(({ record, metadata }) => {
					const entry = eligibleEntries.get(metadata.resource_ref);
					const content = String(record.content ?? "");
					return {
						resource_ref: metadata.resource_ref, key: record.key, version: record.version,
						summary: record.summary ?? content.slice(0, 240), excerpt: content.slice(0, 240),
						scope: record.validity?.scope ?? null, task_ref: record.validity?.task_ref ?? null,
						instance_ref: record.validity?.instance_ref ?? null, claim_kind: record.claim_kind ?? null,
						claim_status: record.claim_status ?? (record.basis_refs?.length ? "basis_cited_unverified" : "unverified_hypothesis"),
						basis_refs: record.basis_refs ?? [], eligible: Boolean(entry?.eligible),
						eligibility_reasons: entry?.reasons ?? ["not_current_or_retired"],
						selected: assemblySelectsReference(assembly, [metadata.resource_ref]),
						updated_at: record.recordedAt,
						read_call: { tool: "task_resource", arguments: { action: "read", ref: metadata.resource_ref, offset: 0, limit: 2000 } },
					};
				});
				const next = query.length > resources.length ? resources.at(-1)?.resource_ref ?? null : null;
				const counts = {
					historical_versions: readJsonl("task-memory.jsonl").length,
					current_keys: memories.size,
					eligible: [...eligibleEntries.values()].filter((entry) => entry.eligible).length,
					selected: [...eligibleEntries.values()].filter((entry) => entry.eligible && assemblySelectsReference(assembly, entry.aliases)).length,
					retired_or_expired: [...eligibleEntries.values()].filter((entry) => !entry.eligible).length,
					action_decision_capture: (() => {
						const events = readJsonl("task-memory-pool-action-capture-events.jsonl");
						return { eligible: events.length, applied: events.filter((row) => row.status === "applied").length,
							duplicate_skipped: events.filter((row) => row.status === "duplicate_skipped").length,
							failed: events.filter((row) => row.status === "failed").length };
					})(),
				};
				const result = { format: "task-memory-pool-directory-v1", counts, total: query.length,
					resources, next_after: next, current_validity_context: currentValidityContext() };
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			const writer = nativeHarnessExecutor(pi, "task_memory");
			if (!writer) throw new Error("native task_memory writer is unavailable");
			if (params.action === "retire") {
				const key = String(params.key ?? "").trim();
				const ref = String(params.memory_ref ?? "").trim();
				const parsed = ref.match(/^memory:(.+)@v(\d+)$/);
				const referenced = parsed ? [...memories.values()].find((row) =>
					row.key === parsed[1] || row.memory_id === parsed[1]
					|| resourceMetadata("memory", row).resource_ref === ref) : undefined;
				const targetKey = key || String(referenced?.key ?? "");
				if (!targetKey) throw new Error("retire requires key or exact memory_ref");
				const current = memories.get(targetKey);
				if (!current) throw new Error(`unknown memory key: ${targetKey}`);
				const expected = Number(params.target_version ?? parsed?.[2]);
				if (!Number.isInteger(expected) || expected !== current.version) return versionConflict("memory", current, params.target_version ?? parsed?.[2]);
				return writer(toolCallId, { action: "retire", key: targetKey, target_version: expected,
					memory_capture: true, capture_id: `retire-${toolCallId}`, capture_item_index: 0,
					capture_hash: "", content: current.content, validity: current.validity,
					basis_refs: current.basis_refs, claim_kind: current.claim_kind ?? "observation" });
			}
			const rawItems = params.items;
			if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) throw new Error("capture requires 1..50 items");
			const captureId = String(params.capture_id ?? toolCallId).trim();
			if (!captureId || captureId.length > 160) throw new Error("capture_id must contain 1..160 characters");
			const prior = readJsonl("task-memory-pool-receipts.jsonl").filter((row) => row.capture_id === captureId);
			const priorBatch = readJsonl("task-memory-pool-captures.jsonl").find((row) => row.capture_id === captureId);
			const items = rawItems.map((raw: Record<string, any>, index: number) => {
				if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`items[${index}] must be an object`);
				const content = String(raw.content ?? "").trim();
				if (!content) throw new Error(`items[${index}].content is required`);
				if (Buffer.byteLength(content, "utf8") > 8192) throw new Error(`items[${index}].content exceeds 8192 bytes; keep the source trace in task_resource`);
				const scope = String(raw.scope ?? "");
				if (!["state", "level", "episode", "task"].includes(scope)) throw new Error(`items[${index}].scope must be state, level, episode or task`);
				const key = String(raw.key ?? `capture-${createHash("sha256").update(captureId).digest("hex").slice(0, 20)}-${index}`).trim();
				if (!key || key.length > 160) throw new Error(`items[${index}].key must contain 1..160 characters`);
				const claimKind = String(raw.claim_kind ?? "observation");
				if (!["observation", "hypothesis", "plan", "retrospective"].includes(claimKind)) throw new Error(`items[${index}].claim_kind is invalid`);
				const basisRefs = raw.basis_refs === undefined ? [] : raw.basis_refs;
				if (!Array.isArray(basisRefs) || basisRefs.some((ref: unknown) => typeof ref !== "string" || !ref.trim())) throw new Error(`items[${index}].basis_refs must be an array of nonempty exact references`);
				const targetVersion = raw.target_version;
				const previous = memories.get(key);
				const refs = resolveBasisRefs(basisRefs);
				const observations = new Set(readJsonl("execution-observations.jsonl").flatMap((row) => [row.observation_id, row.event_id].filter(Boolean).map(String)));
				for (const ref of refs) {
					if (observations.has(ref)) continue;
					try { resolveTaskResource(root, ref); } catch { throw new Error(`items[${index}] has unknown basis_ref: ${ref}`); }
				}
				const payload = { key, content, scope, claim_kind: claimKind, basis_refs: refs,
					summary: raw.summary === undefined ? undefined : String(raw.summary), target_version: targetVersion,
					supersedes_refs: raw.supersedes_refs };
				const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
				const existingReceipt = prior.find((row) => Number(row.item_index) === index);
				const persistedRetry = previous?.capture_id === captureId && Number(previous.capture_item_index) === index;
				if (existingReceipt && existingReceipt.payload_hash !== hash) throw new Error(`capture_id ${captureId} was already used with different item ${index}`);
				if (persistedRetry && previous?.capture_hash !== hash) throw new Error(`capture_id ${captureId} conflicts with persisted item ${index}`);
				if (previous && targetVersion !== undefined && !existingReceipt && !persistedRetry
					&& (!Number.isInteger(Number(targetVersion)) || Number(targetVersion) !== previous.version))
					throw new Error(`items[${index}] version conflict for ${key}; current=${previous.version}, target_version must name current`);
				if (!previous && targetVersion !== undefined) throw new Error(`items[${index}].target_version requires existing key ${key}`);
				const boundValidity = priorBatch?.bindings?.[index];
				if (boundValidity && boundValidity.scope !== scope) throw new Error(`capture_id ${captureId} item ${index} changed scope`);
				return { ...payload, index, hash,
					validity: boundValidity ?? normalizeMemoryValidity({ scope }, currentValidityContext()) };
			});
			if (new Set(items.map((item) => item.key)).size !== items.length) throw new Error("each capture batch may mention a key only once");
			const batchHash = createHash("sha256").update(JSON.stringify(items.map(({ index, hash }) => ({ index, hash })))).digest("hex");
			if (priorBatch && priorBatch.payload_hash !== batchHash) throw new Error(`capture_id ${captureId} was already used with a different batch`);
			if (!priorBatch) append("task-memory-pool-captures.jsonl", {
				capture_id: captureId, payload_hash: batchHash, bindings: items.map((item) => item.validity),
				recordedAt: new Date().toISOString(),
			});
			const results: Record<string, any>[] = [];
			for (const item of items) {
				const existingReceipt = prior.find((row) => Number(row.item_index) === item.index);
				if (existingReceipt) {
					if (existingReceipt.payload_hash !== item.hash) throw new Error(`capture_id ${captureId} was already used with different item ${item.index}`);
					results.push({ ...existingReceipt.result, idempotent: true });
					continue;
				}
				const current = memories.get(item.key);
				if (current?.capture_id === captureId && Number(current.capture_item_index) === item.index) {
					if (current.capture_hash !== item.hash) throw new Error(`capture_id ${captureId} conflicts with persisted item ${item.index}`);
					const result = { resource_ref: resourceMetadata("memory", current).resource_ref, key: current.key,
						version: current.version, idempotent: true, available_for_selection: true };
					append("task-memory-pool-receipts.jsonl", { capture_id: captureId, item_index: item.index, payload_hash: item.hash, result, recordedAt: new Date().toISOString() });
					results.push(result);
					continue;
				}
				const written = await writer(`${toolCallId}:${item.index}`, {
					action: "upsert", key: item.key, content: item.content, summary: item.summary,
					validity: item.validity, scope: item.scope, basis_refs: item.basis_refs,
					target_version: item.target_version ?? current?.version, supersedes_refs: item.supersedes_refs,
					claim_kind: item.claim_kind, memory_capture: true, capture_id: captureId,
					capture_item_index: item.index, capture_hash: item.hash,
					expected_effect: "retain this parent-authored candidate for later explicit selection",
				});
				if (written.isError) {
					results.push({ item_index: item.index, applied: false, error: written.details ?? written.content?.[0]?.text });
					break;
				}
				const record = (written.details ?? {}) as Record<string, any>;
				const result = { resource_ref: resourceMetadata("memory", record).resource_ref, key: item.key,
					version: record.version, decision_id: record.decision_id, applied: true, available_for_selection: true,
					selected: false, exposed: false, used: false };
				append("task-memory-pool-receipts.jsonl", { capture_id: captureId, item_index: item.index, payload_hash: item.hash, result, recordedAt: new Date().toISOString() });
				results.push(result);
			}
			const applied = results.filter((result) => result.applied !== false).length;
			const response = { format: "task-memory-pool-capture-receipt-v1", capture_id: captureId,
				applied, requested: items.length, complete: applied === items.length, atomic: false, items: results,
				note: "Pool presence is not prompt exposure, assembly selection or actual use." };
			return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
		},
	};
	pi.registerTool(memoryPoolTool);

	registerRoutableTool({
		name: "task_system_prompt",
		label: "Task-local system-prompt overlay",
		description: "Task-local System Prompt CRUD; fixed host instructions remain immutable.",
		parameters: Type.Object({
			...linkParameters,
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			content: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const selected = p.name ? [systemPrompts.get(String(p.name))].filter(Boolean) : [...systemPrompts.values()];
				for (const item of selected) if (item) recordResourceRead("system_prompt", item, "task_system_prompt.inspect");
				return { content: [{ type: "text", text: JSON.stringify({ system_prompt_segments: selected }) }], details: { system_prompt_segments: selected } };
			}
			const admission = admitTaskLocalOperation("task_system_prompt");
			if (admission) return admission;
			const name = String(p.name ?? "").trim();
			assertSafeName(name);
			const previous = systemPrompts.get(name);
			if (p.action === "create" && previous) throw new Error("system prompt segment already exists; use update");
			if (p.action !== "create" && !previous) throw new Error("unknown system prompt segment");
			if (previous && Number(p.target_version) !== previous.version) return versionConflict("system_prompt", previous, p.target_version);
			const status = p.action === "retire" ? "retired" : "active";
			const content = canonicalTextBody(p.content ?? previous?.content, "system prompt content");
			if (status === "active" && !content) throw new Error("active system prompt segment requires content");
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "system_prompt", name, currentValidityContext());
			const decisionId = dependencies.allocateDecisionId();
			const record: SystemPromptRecord = {
				...links,
				...(p.validity !== undefined ? { validity: normalizeMemoryValidity(p.validity, currentValidityContext()) }
					: previous?.validity ? { validity: previous.validity } : {}),
				segment_id: previous?.segment_id ?? `system-prompt-${++systemPromptCounter}`,
				name, version: (previous?.version ?? 0) + 1, status, content,
				scope: String(p.scope ?? previous?.scope ?? "current task"),
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? "project the selected directive while its stated scope remains valid"),
				reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when ?? "the directive becomes invalid, harmful, or out of scope"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
				recordedAt: new Date().toISOString(),
			};
			systemPrompts.set(name, record);
			append("task-system-prompt.jsonl", record);
			append("harness-decisions.jsonl", {
				decision_id: decisionId, decision_path: "task_system_prompt", choice: p.action, applied: true,
				intervention: "task_system_prompt_context", basis_resource_ids: record.basis_refs,
				operation: { capability: "pi.before_agent_start", component: "task_system_prompt", name, version: record.version, status },
				expected_effect: record.expected_effect, reconsider_when: record.reconsider_when,
				routing_id: record.routing_id, source_approval_ref: record.source_approval_ref,
				toolCallId, recordedAt: record.recordedAt,
			});
			return { content: [{ type: "text", text: JSON.stringify(resourceMetadata("system_prompt", record)) }], details: record };
		},
	});

	pi.on("before_agent_start", (event) => {
		const validity = currentKnowledge();
		const active = [...systemPrompts.values()]
			.filter((item) => validity.eligible("system_prompt", item) && resourceIsAssembled("system_prompt", item))
			.sort((left, right) => left.name.localeCompare(right.name));
		for (const item of active) {
			const key = `${item.segment_id}@${item.version}`;
			if (projectedSystemPrompts.has(key)) continue;
			projectedSystemPrompts.add(key);
			append("harness-observations.jsonl", {
				observation_id: `system-prompt-exposure-${item.decision_id}`,
				observation_kind: "pi_system_prompt_overlay", decision_id: item.decision_id,
				basis_resource_ids: item.basis_refs,
				operation: { capability: "pi.before_agent_start", component: "task_system_prompt", name: item.name, version: item.version },
				effect_observed: true, recordedAt: new Date().toISOString(),
			});
			append("harness-observations.jsonl", {
				observation_id: `context-projection-${item.decision_id}`,
				observation_kind: "pi_context_projection", decision_id: item.decision_id,
				basis_resource_ids: item.basis_refs,
				operation: { capability: "pi.context", component: "task_system_prompt", name: item.name, version: item.version },
				effect_observed: true, recordedAt: new Date().toISOString(),
			});
		}
		const assembly = currentAssembly();
		const overlay = renderTaskSystemPromptOverlay(active, knowledgeEntries(), assembly, currentValidityContext());
		append("task-system-prompt-assemblies.jsonl", { format: "task-system-prompt-assembly-v1",
			assembly_ref: assembly ? `harness_assembly:${assembly.assembly_id}@v${assembly.revision}` : null,
			selected: active.map(item => promptReceipt("system_overlay", knowledgeRef("system_prompt", item), item.content)),
			...promptReceipt("system_overlay", "assembled-overlay", overlay), recordedAt: new Date().toISOString() });
		if (!active.length) return {};
		const overlaySection = `\n\n# Task-local system-prompt overlay\n${overlay}`;
		// The shared benchmark hook may have already appended this exact section.
		// Keep validity/assembly computation and exposure receipts above unchanged.
		if (event.systemPrompt.endsWith(overlaySection)) return {};
		return { systemPrompt: `${event.systemPrompt}${overlaySection}` };
	});

	registerRoutableTool({
		name: "task_skill",
		label: "Task-local Pi skill",
		description: "Task-local Skill CRUD. Read skill-creator first; pass exact authoring_method_ref; assemble before use.",
		parameters: Type.Object({
			...linkParameters,
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			description: Type.Optional(Type.String()),
			instructions: Type.Optional(Type.String()),
			method: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			authoring_method_ref: Type.Optional(Type.String({ description: "Exact skill-creator method_ref." })),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const selected = p.name ? [skills.get(String(p.name))].filter(Boolean) : [...skills.values()];
				for (const item of selected) if (item) recordResourceRead("skill", item, "task_skill.inspect");
				return { content: [{ type: "text", text: JSON.stringify({ skills: selected }) }], details: { skills: selected } };
			}
			const admission = admitTaskLocalOperation("task_skill");
			if (admission) return admission;
			const name = String(p.name ?? "").trim();
			assertSafeName(name);
			const previous = skills.get(name);
			if (p.action === "create" && previous) throw new Error("skill already exists; use update");
			if (p.action !== "create" && !previous) throw new Error("unknown task-local skill");
			if (previous && Number(p.target_version) !== previous.version) return versionConflict("skill", previous, p.target_version);
			const status = p.action === "retire" ? "retired" : "active";
			const description = String(p.description ?? previous?.description ?? `Task-local skill: ${name}`).replace(/\s+/g, " ").trim();
			const instructions = canonicalTextBody(p.instructions ?? previous?.instructions, "skill instructions");
			const method = normalizeMethodSpecification(p.method ?? (p.instructions === undefined ? previous?.method : undefined));
			if (status === "active" && (!description || !instructions)) throw new Error("active skill requires description and instructions");
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "skill", name, currentValidityContext());
			const path = join(skillsDir, name, "SKILL.md");
			const decisionId = dependencies.allocateDecisionId();
			const record: SkillRecord = {
				...links,
				...(p.validity !== undefined ? { validity: normalizeMemoryValidity(p.validity, currentValidityContext()) }
					: previous?.validity ? { validity: previous.validity } : {}),
				skill_id: previous?.skill_id ?? `skill-${++skillCounter}`,
				name,
				version: (previous?.version ?? 0) + 1,
				status,
				description,
				instructions,
				...(method ? { method } : {}),
				authoring_status: method
					? ((method.construction_evidence_refs ?? []).length
						? "structured_grounded_candidate" : "structured_untested_candidate")
					: String(p.authoring_method_ref ?? previous?.authoring_method_ref ?? "").trim()
						? "creator_authored_untested_candidate" : "unstructured_requires_review",
				file: path,
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? "make a reusable task-local method available to later Pi turns"),
				reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when ?? "the skill is unused, contradicted, or no longer relevant"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
				authoring_method_ref: String(p.authoring_method_ref ?? previous?.authoring_method_ref ?? "").trim(),
				recordedAt: new Date().toISOString(),
			};
			if (status === "active") {
				atomicWrite(path, `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`);
			}
			skills.set(name, record);
			append("task-skills.jsonl", record);
			append("task-skill-events.jsonl", {
				event: status === "active" ? "file_written" : "retired",
				skill_id: record.skill_id,
				name,
				version: record.version,
				file: path,
				recordedAt: record.recordedAt,
			});
			append("harness-decisions.jsonl", {
				decision_id: decisionId,
				decision_path: "task_skill",
				choice: p.action,
				applied: true,
				intervention: "task_local_pi_skill",
				basis_resource_ids: record.basis_refs,
				operation: {
					capability: "pi.context",
					component: "task_skill_index",
					resource_format: "task-local SKILL.md",
					native_loader_on_startup: false,
					name,
					version: record.version,
					status,
				},
				effect_metric: status === "active" ? "skill_context_index_exposed" : "skill_absent_from_later_context",
				expected_effect: record.expected_effect,
				reconsider_when: record.reconsider_when,
				toolCallId,
				recordedAt: record.recordedAt,
			});
			return { content: [{ type: "text", text: JSON.stringify({ ...record, instructions }) }], details: record };
		},
	});

	pi.registerTool({
		name: "task_tool_policy",
		label: "Task-local Pi tool policy",
		description: "Set/inspect active authorized tools; this policy tool stays active. Cite research refs in basis_refs when relevant.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("inspect"), Type.Literal("apply")]),
			enabled_tools: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			if (params.action === "inspect") {
				const result = {
					active_tools: pi.getActiveTools(),
					authorized_tools: [...authorizedTools()],
					all_tools: pi.getAllTools().map((tool) => tool.name),
				};
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			const available = authorizedTools();
			const requested = [...new Set(params.enabled_tools ?? [])];
			const unknown = requested.filter((name) => !available.has(name));
			if (unknown.length) throw new Error(`unknown tools: ${unknown.join(", ")}`);
			if (!requested.includes("task_tool_policy")) requested.push("task_tool_policy");
			for (const tool of protectedManagementTools) {
				if (!requested.includes(tool)) requested.push(tool);
			}
			const previous = pi.getActiveTools();
			const decisionId = dependencies.allocateDecisionId();
			pi.setActiveTools(requested);
			recordContextChoice("tool_policy", toolCallId, {active_tools: previous},
				{active_tools: pi.getActiveTools()});
			append("harness-decisions.jsonl", {
				decision_id: decisionId,
				decision_path: "task_tool_policy",
				choice: "apply",
				applied: true,
				intervention: "active_tool_set",
				basis_resource_ids: resolveBasisRefs(params.basis_refs),
				previous,
				value: requested,
				operation: { capability: "pi.setActiveTools" },
				effect_metric: "active_tools_on_later_context",
				expected_effect: params.expected_effect ?? "reduce irrelevant tool choices",
				reconsider_when: params.reconsider_when ?? "a disabled tool becomes necessary",
				toolCallId,
				recordedAt: new Date().toISOString(),
			});
			pendingToolDecision = { decisionId, toolCallId };
			const result = { decision_id: decisionId, active_tools: pi.getActiveTools() };
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "assess_harness_effect",
		label: "Assess task-local harness effect",
		description: "Record parent assessment of later effect; not independent proof.",
		parameters: Type.Object({
			decision_id: Type.Optional(Type.String({description:"Omit to select the unique unassessed decision; inspect task_harness for candidates."})),
			observation_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Omit to bind all recorded native exposure observations for the selected decision." })),
			verdict: Type.Union([Type.Literal("supported"), Type.Literal("unsupported"), Type.Literal("inconclusive")]),
			consequence: Type.String(),
			remaining_uncertainty: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
			return assessHarnessEffect(toolCallId, params as Record<string, any>);
		},
	});

	const routedNativeTools = new Set([
		"task_memory", "task_system_prompt", "task_skill", "task_tool", "task_subagent",
	]);
	pi.on("tool_result", (event) => {
		if (!routedNativeTools.has(event.toolName)) return {};
		const input = (event.input as Record<string, unknown> | undefined) ?? {};
		const routingId = String(input.routing_id ?? "").trim();
		if (!routingId) return {};
		const sourceApprovalRef = String(input.source_approval_ref ?? "").trim();
		const details = event.details && typeof event.details === "object"
			? event.details as Record<string, any> : {};
		const kind = ({ task_memory: "memory", task_system_prompt: "system_prompt",
			task_skill: "skill", task_tool: "tool", task_subagent: "subagent" } as Record<string, string>)[event.toolName];
		let resourceRef: string | undefined;
		try {
			if (!event.isError && details && Object.keys(details).length) resourceRef = resourceMetadata(kind, details).resource_ref;
		} catch {}
		append("auto-research-harness-route-receipts.jsonl", {
			format: "auto-research-harness-route-receipt-v1",
			receipt_id: `${routingId}:${event.toolCallId}`,
			route_id: routingId,
			native_tool: event.toolName,
			toolCallId: event.toolCallId,
			status: event.isError ? "failed" : "applied",
			applied: !event.isError,
			...(sourceApprovalRef ? { source_approval_ref: sourceApprovalRef } : {}),
			...(resourceRef ? { resource_ref: resourceRef } : {}),
			recordedAt: new Date().toISOString(),
		});
		return {};
	});



	pi.on("context", async (event) => {
		await routeCurrentHarness(currentJevPrompt || routingStateFromMessages(event.messages));
		applyAssemblyToolSurface();
		const assembledMessages = projectTranscriptForAssembly(event.messages);
		const crossContextCandidates = refreshCrossContextResearchCandidates();
		const openIntents = [...new Map(readJsonl("task-harness-conversion-intents.jsonl")
			.filter((item) => item.intent_id || item.operation_id)
			.map((item) => [String(item.intent_id ?? item.operation_id), item])).values()]
			.filter((item) => !["resolved", "dropped"].includes(String(item.status)))
			.filter((item) => {
				const carrier = item.carrier ?? item.component_hints ?? [];
				return (Array.isArray(carrier) ? carrier : [carrier])
					.some((kind: unknown) => ["skill", "tool", "subagent", "system_prompt"].includes(String(kind)));
			});
		exposeDecisionSurfacesForOpenWork(crossContextCandidates.length, openIntents);
		// A committed periodic review exposes exact review and research-handoff
		// references. Keep their reader available while the handoff is pending;
		// the full records remain on demand instead of being echoed in the receipt.
		if (pendingResearchHandoff() && pi.getAllTools().some(tool => tool.name === "task_resource"))
			pi.setActiveTools([...new Set([...pi.getActiveTools(), "task_resource"])]);
		const pendingOutcomes = pendingLevelReviews();
		const completedOutcomes = readJsonl("task-level-reviews.jsonl");
		const outcomeMessages: any[] = pendingOutcomes.length ? [{ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `Pending whole-level windows (review is advisory, never an ARC action gate): ${JSON.stringify(pendingOutcomes.map(window => {
				const { index, ref } = persistLevelOutcomeCostIndex(window);
				return { window_id: window.window_id, level: window.level, reasons: window.reasons,
					boundary_ref: window.boundary_ref, evidence_count: window.evidence_refs?.length ?? 0,
					outcome_cost_index_ref: ref, tool_call_count: index.calls.length,
					inspect_call: { tool: "task_harness", arguments: { action: "inspect", section: "pending_level_reviews" } },
					contract_call: { tool: "task_harness", arguments: { action: "contract", topic: "level_review", window_id: window.window_id } } };
			}))}. Continue from the live observation; read a window's contract only when submitting its evidence-linked review. Success_path is required only for confirmed success and must be nested in level_review; credits:[] is valid.` }] }] : [];
		const lastReview = completedOutcomes.at(-1);
		if (lastReview) {
			const latestSuccessReview = [...completedOutcomes].reverse()
				.find((review) => review.success_path?.status === "candidate");
			const latestReceipt = levelReviewReceipt(lastReview);
			const successRef = latestSuccessReview
				? `level_review:${latestSuccessReview.window_id}@v${Number(latestSuccessReview.version ?? 1)}` : null;
			outcomeMessages.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `Previous level outcome index: ${JSON.stringify({ ...latestReceipt,
					prior_successful_review_ref: successRef,
					parent_action: "Continue from the live task state. If a past review suggests a useful method, read its exact ref, author or revise through the existing Creator and task_harness(action='change'), assemble the exact version, then trial it using parameters read from the current observation. No review adapter or action replay is required. If the goal and success conditions are now clear enough to test, revise a scoped planning System Prompt directly; do not wait for a phase gate." })}` }] });
		}
		const freshLevelSuccess = [...pendingOutcomes].reverse()
			.find(window => Array.isArray(window.reasons) && window.reasons.includes("level_success"));
		if (freshLevelSuccess) outcomeMessages.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `FRESH LEVEL TRANSITION (parent decision, not an action gate): ${JSON.stringify({window_id:freshLevelSuccess.window_id,
				boundary_ref:freshLevelSuccess.boundary_ref,level_before:freshLevelSuccess.level,
				level_after:freshLevelSuccess.outcome?.public_transition?.level_after})}. Read the current public observation before the next action. Rebind the prior successful method's state-dependent inputs to this new level, update the working goal/strategy and consider a scoped planning System Prompt or method revision only if it helps. The pending review can archive the old path now; submit its success_path nested inside level_review, not as a sibling argument. Review and component creation are optional, not an action gate. Never replay old coordinates.` }] });
		if (terminalReview) {
			return { messages: [...assembledMessages, ...outcomeMessages] };
		}
		const validity = currentKnowledge();
		for (const item of [...systemPrompts.values()].filter((entry) => validity.eligible("system_prompt", entry)
			&& resourceIsAssembled("system_prompt", entry))) {
			const key = `${item.segment_id}@${item.version}`;
			if (!projectedSystemPrompts.has(key)) {
				projectedSystemPrompts.add(key);
				append("harness-observations.jsonl", {
					observation_id: `context-projection-${item.decision_id}`,
					observation_kind: "pi_context_projection", decision_id: item.decision_id,
					basis_resource_ids: item.basis_refs,
					operation: { capability: "pi.context", component: "task_system_prompt", name: item.name, version: item.version },
					effect_observed: true, recordedAt: new Date().toISOString(),
				});
			}
		}
		const compactArc = process.env.PI_ARC_EXECUTION_GATE === "enabled";
		const latestCheckpoint = readCurrentTaskCheckpoint(root);
		assertTaskRecordsScope(taskScope, [latestCheckpoint], "task-checkpoint.json");
		const taskSolvingContext = {
			task_goal: latestCheckpoint.task_goal ?? null,
			success_conditions: latestCheckpoint.success_conditions ?? [],
			task_constraints: latestCheckpoint.task_constraints ?? [],
			planning_gap: latestCheckpoint.planning_gap ?? null,
			strategy_alternatives: latestCheckpoint.strategy_alternatives ?? [],
			current_strategy: latestCheckpoint.current_strategy ?? null,
			current_subgoal: latestCheckpoint.current_subgoal ?? null,
			next_step: latestCheckpoint.next_step ?? null,
			basis_refs: latestCheckpoint.summary_basis_refs ?? [],
		};
		const projectionState: Record<string, unknown> = {
			checkpoint: latestCheckpoint, environment: latestCheckpoint.latest_environment ?? {},
			assertions: latestCheckpoint.assertions ?? {},
		};
		const memoryEligible = (item: MemoryRecord) => validity.eligible("memory", item)
			&& activationMatches(item.projection?.activation, projectionState);
		const latestTaskToolsForPrompt = latestBy(readJsonl("task-tools.jsonl"), "name");
		const latestSubagentsForPrompt = latestBy(readJsonl("task-subagents.jsonl"), "name");
		const resourceCounts = {
			memory: [...memories.values()].filter(memoryEligible).length,
			system_prompt: [...systemPrompts.values()].filter((item) => validity.eligible("system_prompt", item)).length,
			skills: [...skills.values()].filter((item) => validity.eligible("skill", item)).length,
			tools: [...latestTaskToolsForPrompt.values()].filter((item) => item.status === "active").length,
			subagents: [...latestSubagentsForPrompt.values()].filter((item) => item.status === "active").length,
		};
		const supportedCreation = [
			"task_memory.upsert", "task_system_prompt.create", "task_skill.create",
			...(dependencies.taskToolAdapter ? ["task_tool.create"] : []),
			...(pi.getAllTools().some((tool) => tool.name === "task_subagent")
				? ["task_subagent.create", "delegate_task"] : []),
		];
		const methodDiscovery = compactArc
			? baselineMethodCatalog().map(({ name }) => name)
			: baselineMethodCatalog();
		const resources: any[] = [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text:
			`Baseline authoring methods: ${JSON.stringify(methodDiscovery)}. ${compactArc
				? 'task_harness(action="read_method", method_name="<name>") returns the creator template/version; read once when authoring and reuse creator_ref. Memory scope IDs bind automatically when omitted.'
				: `${BASELINE_AUTHORING_GUIDANCE} Memory validity bindings: ${JSON.stringify(currentValidityContext())}.`}` }] }, {
			role: "user", timestamp: Date.now(),
			content: [{ type: "text", text:
				compactArc
					? renderPrompt("self_harness_index.md", { active_resources: JSON.stringify(resourceCounts) })
					: `Task-local self-harness is UNLOCKED for this treatment task. Current active resources: ${JSON.stringify(resourceCounts)}. ` +
						`Creation is available now through ${supportedCreation.join(", ")}; memory may be recorded directly, but skill/tool/subagent creation first requires reading its fixed creator with task_harness(action=read_method) and passing the returned method_ref as authoring_method_ref. Auto-Research first requires reading research-orchestration and passing its method_ref. ` +
						"Start with the smallest useful lower-order capability when it will help: memory for durable facts, skill for a repeatable procedure, tool for a bounded pure-JSON computation or adapter operation, or a subagent for an independent read-only question. " +
					  "Create, actually use, inspect the result, and revise only when evidence warrants; choose freely if direct execution has higher value. task_harness provides status and context focus. Auto-Research may study the task path, a component, a composition, a strategy, or the research method itself.",
			}],
		}];
		const memoryAssembly = currentAssembly();
		const eligibleUnselectedMemory = componentPool().filter(entry => entry.kind === "memory" && entry.eligible
			&& !entry.record.probe_record
			&& memoryEligible(entry.record as MemoryRecord)
			&& !assemblySelectsReference(memoryAssembly, entry.aliases));
		const scopeRank: Record<string, number> = { state: 0, level: 1, episode: 2, task: 3 };
		eligibleUnselectedMemory.sort((a, b) =>
			(scopeRank[String(a.record.validity?.scope)] ?? 4) - (scopeRank[String(b.record.validity?.scope)] ?? 4)
			|| String(b.record.recordedAt ?? "").localeCompare(String(a.record.recordedAt ?? ""))
			|| a.resource_ref.localeCompare(b.resource_ref));
		if (eligibleUnselectedMemory.length) resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `MEMORY SELECTION CANDIDATES (not assembled): ${JSON.stringify({ total: eligibleUnselectedMemory.length,
				candidates: eligibleUnselectedMemory.slice(0, 5).map(entry => ({ resource_ref: entry.resource_ref,
					key: entry.record.key, scope: entry.record.validity?.scope, claim_kind: entry.record.claim_kind,
					claim_status: entry.record.claim_status, eligible: true,
					...(entry.record.summary ? { summary: compactText(entry.record.summary).slice(0, 140) } : {}),
					read_call: { tool: "task_resource", arguments: { action: "read", ref: entry.resource_ref } } })),
				omitted: Math.max(0, eligibleUnselectedMemory.length - 5),
				directory_call: { tool: "task_memory_pool", arguments: { action: "list" } } })}. Select exact relevant versions with task_harness(action='assemble'); pool membership is not prompt exposure.` }] });
		if (compactArc) {
			const latestSnapshot = readJsonl("observation-snapshots.jsonl").at(-1);
			const frame = Array.isArray(latestSnapshot?.public_state?.frames)
				? latestSnapshot.public_state.frames.at(-1) : undefined;
			const feedback = arcDecisionFeedback(latestCheckpoint.recent_actions, frame);
			const latestArcAction = Array.isArray(latestCheckpoint.recent_actions)
				? latestCheckpoint.recent_actions.at(-1) : null;
			if (!feedback && (latestArcAction?.level_changed === true || latestArcAction?.action === "RESET"))
				lastArcFeedbackSignature = null;
			else if (feedback && feedback.signature !== lastArcFeedbackSignature) {
				lastArcFeedbackSignature = feedback.signature;
				resources.push({role:"user",timestamp:Date.now(),content:[{type:"text",text:feedback.text}]});
			}
		}
		const capabilityQueue = allCapabilityFollowups();
		const activeCapabilityQueue = capabilityQueue.filter(entry => entry.status !== "operation_development_deferred");
		const deferredDevelopment = directDevelopmentIntents().filter(row => row.status === "deferred")
			.map(row => ({operation_id:row.operation_id,purpose:row.purpose,
				reason:row.reason,reconsider_when:row.reconsider_when,next_step:row.next_step}));
		if (deferredDevelopment.length) resources.push({role:"user",timestamp:Date.now(),content:[{type:"text",
			text:`DEFERRED PARENT DEVELOPMENT (review conditions, not a component quota): ${JSON.stringify(deferredDevelopment.slice(-6))}. Compare each parent-authored reconsider_when against the latest actual ARC observation and task goal. If the condition occurred, update the SAME operation_id to status=open with task_harness(action=development_intent), then finish its creator/change/assembly/semantic-trial path or explicitly drop it with evidence. If not, leave it deferred. Runtime does not infer whether the condition occurred or author a component.`}]});
		// A creator read is an explicit parent preparation step, but it is not a
		// component. Keep that unfinished step visible until a matching candidate
		// is submitted or the parent explicitly declines the operation. Otherwise
		// long ARC observations bury the read and the parent repeatedly rereads a
		// creator without ever reaching the change boundary.
		const creatorReads = readJsonl("task-baseline-method-reads.jsonl")
			.filter(row => row.actor === "parent" && row.source !== "arc_open_admission");
		const createdByMethod = [
			...readJsonl("task-skills.jsonl"), ...readJsonl("task-tools.jsonl"),
			...readJsonl("task-subagents.jsonl"),
		].filter(row => row.authoring_method_ref);
		const preparedCreators = ["skill-creator", "tool-creator", "subagent-creator"].flatMap(name => {
			const creator = baselineMethodCatalog().find(item => item.name === name)!;
			const latestRead = creatorReads.findLast(row => row.name === name && row.method_ref === creator.method_ref);
			if (!latestRead) return [];
			const authoredLater = createdByMethod.some(row => row.authoring_method_ref === latestRead.method_ref
				&& String(row.recordedAt ?? "") >= String(latestRead.recordedAt ?? ""));
			if (authoredLater) return [];
			const explicitDecline = readJsonl("task-development-intents.jsonl").some(row =>
				(row.source === `method_read:${name}` || String(row.next_step ?? "").includes(name))
				&& ["deferred", "dropped", "resolved"].includes(String(row.status))
				&& String(row.recordedAt ?? "") >= String(latestRead.recordedAt ?? ""));
			if (explicitDecline) return [];
			const resident = assembledMessages.some((message: any) => {
				if (message.role !== "toolResult" || message.toolName !== "task_harness") return false;
				try {
					const result = JSON.parse(message.content?.find((p: any) => p.type === "text")?.text ?? "");
					return result.format === "baseline-method-read-v1" && result.method_ref === creator.method_ref
						&& result.authoring_template && typeof result.content === "string";
				} catch { return false; }
			});
			return [{name, method_ref:latestRead.method_ref,
				...(resident ? {authoring_entry:"Use the complete creator and authoring_template already in the tool result."}
					: {content:readBaselineMethod(name).content,
						authoring_template:preparedAuthoringTemplate(name, latestRead.method_ref)})}];
		});
		if (preparedCreators.length) resources.push({ role:"user", timestamp:Date.now(), content:[{type:"text",
			text:`UNFINISHED CREATOR PREPARATION: ${JSON.stringify(preparedCreators)}. Reuse creator refs and complete templates; author and explicitly assemble a useful candidate, or defer an unsuitable operation. Reading is not creation or a component quota.`}] });
		// Conversion intents are a first-class parent work queue, separate from
		// review carrier slots.  Surface them on every parent context so a Skill or
		// Memory decision cannot accidentally hide a higher-order Tool/Subagent/
		// strategy opportunity emitted by Auto-Research.  The runtime only reports
		// durable records; the parent still authors, assembles and trials them.
		const allOpenConversionIntents = currentConversionWorkset()
			.filter((item) => !["resolved", "dropped"].includes(String(item.status)));
		const conversionIntents = allOpenConversionIntents.slice(-12)
			.map((item) => ({
				intent_id: item.intent_id ?? item.operation_id, status: item.status,
				carrier: item.carrier ?? item.component_hints ?? [], purpose: item.purpose ?? null,
				candidate_ref: item.candidate_ref ?? null, resource_refs: item.resource_refs ?? [],
				pending_trial_refs:item.pending_trial_refs ?? [], trial_evidence_refs:item.trial_evidence_refs ?? [],
				next_step: item.next_step ?? item.recovery ?? item.retry ?? null,
			}));
		if (conversionIntents.length) resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `OPEN HARNESS CONVERSION INTENTS: ${JSON.stringify({total_count:allOpenConversionIntents.length,omitted_count:allOpenConversionIntents.length-conversionIntents.length,recent:conversionIntents,full_directory_call:{tool:"task_harness",arguments:{action:"inspect",section:"conversion_intents"}}})}. Follow each current next_step; preserve successful writes and exact selections. Main chooses trial, revision or stopping. Runtime does not infer utility or auto-apply research candidates.` }] });
		const pendingMethodHandoffs = [...latestBy(readJsonl("parent-authoring-handoffs.jsonl"), "handoff_id").values()]
			.filter(row => row.status === "awaiting_parent_authoring")
			.slice(-4).map(row => ({handoff_ref:row.resource_ref,
				method_ref:row.source?.method_ref,report_ref:row.source?.report_ref,
				proposed_carrier:row.recommended_component_kind,
				candidate_summary:compactText(row.candidate_summary),
				creator_read_call:row.creator?.read_call ?? null}));
		if (pendingMethodHandoffs.length) resources.push({role:"user",timestamp:Date.now(),content:[{type:"text",
			text:`RESEARCH METHOD CANDIDATES FOR PARENT DECISION: ${JSON.stringify(pendingMethodHandoffs)}. These are unadopted inputs. If relevant, read the exact method/report and creator_read_call, author the smallest executable version through task_harness(change), assemble and trial it, then record semantic effect. If contradicted or inapplicable, continue; do not pretend report completion is adoption. No cross-scene proof or review adapter is required.`}]});
		// A component kind being empty is not evidence of a capability gap. Surface
		// only a gap the parent actually recorded, and only when that judgment
		// changes; the checkpoint remains the durable source between reminders.
		// A testable goal model can warrant planning before any level transition.
		// The parent still chooses the policy and its exact component carrier.
		const goalModelSignature = taskSolvingContext.task_goal
			&& taskSolvingContext.success_conditions.length
			? JSON.stringify({goal:taskSolvingContext.task_goal,
				success:taskSolvingContext.success_conditions,
				constraints:taskSolvingContext.task_constraints,
				alternatives:taskSolvingContext.strategy_alternatives}) : null;
		if (!goalModelSignature) lastGoalModelReminder = null;
		else if (goalModelSignature !== lastGoalModelReminder) {
			lastGoalModelReminder = goalModelSignature;
			resources.push({ role:"user", timestamp:Date.now(), content:[{type:"text",
				text:`TESTABLE GOAL MODEL (parent reassessment, not an action gate): ${goalModelSignature}. Compare current evidence against the success conditions and constraints. If the working route is now expressible, consider a scoped planning System Prompt that maintains candidate strategies, each candidate's visible prediction and falsifier, and the smallest current-state experiment that distinguishes them. Author and assemble it through the existing Harness path only if it improves the next decisions; revise it on counterevidence. Tool and Skill candidates may implement bounded checks, while Memory keeps instance values. Runtime does not choose the phase or fill a component quota.`}]});
		}
		const parentGap = compactText(latestCheckpoint.planning_gap);
		const parentGapSignature = parentGap ? JSON.stringify({goal:taskSolvingContext.task_goal,
			strategy:taskSolvingContext.current_strategy,gap:parentGap}) : null;
		if (!parentGapSignature) lastParentGapReminder = null;
		else if (parentGapSignature !== lastParentGapReminder) {
			lastParentGapReminder = parentGapSignature;
			resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `PARENT-DECLARED OPERATION GAP: ${JSON.stringify({task_goal:taskSolvingContext.task_goal,
					current_strategy:taskSolvingContext.current_strategy,planning_gap:parentGap,
					next_step:taskSolvingContext.next_step})}. Continue the best-supported live solution route unless this gap changes the next decision. If a repeatable operation would improve task progress, choose and author its Skill, Tool, Subagent or scoped System Prompt through the existing Creator/change/assembly/semantic-trial path. If evidence does not yet justify development, continue a discriminating action and update the checkpoint; no component-type quota or pre-action gate exists.` }] });
		}
		const initialCapabilityDiscovery = !capabilityExtractionAttempted;
		const capabilityExtractionTrigger = initialCapabilityDiscovery
			? "initial_discovery"
			: activeCapabilityQueue.length || (!compactArc && periodicReviewEnabled() && pendingPeriodicReview())
				? "capability_queue_or_periodic_review"
				: undefined;
		if (capabilityExtractionTrigger) {
			capabilityExtractionAttempted = true;
			resources.push({
			role: "user", timestamp: Date.now(), content: [{ type: "text", text: compactArc
					? "Capability workflow reference: task_harness(action=contract, topic=development) supplies authoring, trial and recovery guidance when needed."
				: loadPrompt("capability_extraction_process.md") }],
			});
		}
		if (activeCapabilityQueue.length) resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: projectCapabilityFollowupQueue(activeCapabilityQueue) }] });
		const unselectedCapabilities = componentPool().filter(entry => (entry.kind !== "memory" || !entry.record.probe_record) && entry.eligible
			&& !assemblySelectsReference(currentAssembly(), entry.aliases));
		const unselectedCounts = {memory:0,system_prompt:0,skill:0,tool:0,subagent:0};
		for (const entry of unselectedCapabilities) unselectedCounts[entry.kind]++;
		const recentUnselected = [...unselectedCapabilities]
			.sort((left, right) => String(right.record.recordedAt ?? "").localeCompare(String(left.record.recordedAt ?? ""))
				|| left.resource_ref.localeCompare(right.resource_ref))
			.slice(0, 5).map(componentReadiness);
		if (jevRoutingMode() !== "active" && unselectedCapabilities.length) resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `Authored capabilities awaiting parent selection: ${JSON.stringify({unselected_counts:unselectedCounts,recent:recentUnselected,full_pool_call:{tool:"task_harness",arguments:{action:"inspect",section:"component_pool"}}})}. Each item gives the current CAS-safe selection call, the legal load/invoke entrypoint after selection, and the latest related failure when one exists. Reconfirm applicability and preserve other selections you still need; leave unsuitable capabilities unselected. Pool creation alone does not enable them.` }] });
		if (crossContextCandidates.length) resources.push({
			role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `OPEN RESEARCH OPPORTUNITIES (optional): ${JSON.stringify(compactArc ? {
					total:crossContextCandidates.length,
					candidates:crossContextCandidates.slice(-5).map(candidate => ({
						candidate_ref:candidate.candidate_ref,reason:compactText(candidate.reason).slice(0,160),
						evidence_refs:candidate.evidence_refs.slice(-4),
						additional_evidence_count:Math.max(0,candidate.evidence_refs.length-4),
						research_call:candidate.research_call,
					})),omitted:Math.max(0,crossContextCandidates.length-5),
					directory_call:{tool:"task_harness",arguments:{action:"inspect",section:"cross_context_research_candidates"}},
				} : crossContextCandidates)}. Research when a candidate helps current or anticipated task work; otherwise continue. No start, skip or acknowledgment is required. Read research-orchestration before starting research; full evidence and controls remain in the directory.` }],
		});
		const pendingEffects = unassessedHarnessEffects(dependencies);
		if (pendingEffects.length) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Unassessed task-local harness effects: ${JSON.stringify(pendingEffects)}`,
				}, {
					type: "text",
					text: "After relevant task evidence, you may assess, revise, retire, or ignore these interventions. If an active research resource truly motivated an unlinked decision, revise that component with the exact basis_refs; never add a retroactive link merely to complete a trace.",
				}],
				timestamp: Date.now(),
			});
		}
		const activeMemories = [...memories.values()]
			.filter((item) => memoryEligible(item) && resourceIsFocused("memory", item))
			.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.recordedAt.localeCompare(left.recordedAt))
			.map((item) => ({
				memory_id: item.memory_id,
				...resourceMetadata("memory", item),
				key: item.key,
				version: item.version,
				// A memory without evidence refs is an agent hypothesis, not an
				// established task fact. Preserve it, but make its epistemic status
				// explicit so task-local memory cannot silently rewrite observation.
				content: resourceIsExplicitlyFocused("memory", item) ? item.content : undefined,
				scope: item.scope,
				basis_refs: item.basis_refs,
				pinned: item.pinned,
				decision_id: item.decision_id,
				reconsider_when: item.reconsider_when,
				// Keep the epistemic warning in every task-memory projection. An
				// unlinked memory is an UNVERIFIED HYPOTHESIS, never a runtime fact.
				...(item.basis_refs.length
					? { epistemic_status: "agent_authored_not_independently_verified" }
					: { epistemic_status: "unverified_hypothesis", epistemic_label: "UNVERIFIED HYPOTHESIS" }),
			}));
		const activeTaskPromptMemories = [...memories.values()]
			.filter((item) => memoryEligible(item)
				&& resourceIsFocused("memory", item)
				&& item.projection?.channel === "task_prompt"
				&& activationMatches(item.projection.activation, projectionState))
			.sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.recordedAt.localeCompare(right.recordedAt))
			.map((item) => ({
				memory_id: item.memory_id,
				key: item.key,
				version: item.version,
				content: item.projection?.prompt_text ?? item.content,
				layer: item.projection?.layer ?? "task_state",
				scope: item.scope,
				basis_refs: item.basis_refs,
				decision_id: item.decision_id,
				reconsider_when: item.reconsider_when,
				epistemic_status: item.basis_refs.length
					? "agent_authored_not_independently_verified"
					: "unverified_hypothesis",
			}));
		if (activeMemories.length) {
			const projectedMemories = activeMemories;
			resources.push({ role: "user", content: [{ type: "text", text: `Active task-local memory${compactArc ? " index" : ""}: ${JSON.stringify(projectedMemories)}` }], timestamp: Date.now() });
		}
		for (const layer of ["task_policy", "task_state"]) {
			const selected = activeTaskPromptMemories.filter(item => item.layer === layer);
			if (!selected.length) continue;
			resources.push({
				role: "user",
				content: [{ type: "text", text: `${layer === "task_policy" ? "Active task policy" : "Active dynamic task/user prompt knowledge"}: ${JSON.stringify(selected)}` }],
				timestamp: Date.now(),
			});
		}
		const promptContributionSelection = renderPromptContributions(currentAssembly(), projectionState, referenceAvailable);
		const promptLayerTitles: Record<string, string> = {
			task_policy: "Active task policy",
			method: "Active task-prompt method guidance",
			working_plan: "Active task-prompt working plan",
			hypothesis: "Active task-prompt hypotheses",
			task_state: "Active dynamic task/user prompt knowledge",
			research_inbox: "Active task-prompt research inbox",
		};
		for (const layer of TASK_PROMPT_LAYERS) {
			const selected = promptContributionSelection.selected.filter((item) => item.layer === layer);
			if (!selected.length) continue;
			resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `${promptLayerTitles[layer]}: ${JSON.stringify(selected)}` }] });
		}
		const activeSkills = [...skills.values()]
			.filter((item) => validity.eligible("skill", item) && existsSync(item.file) && resourceIsFocused("skill", item))
			.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
			.map((item) => ({
				skill_id: item.skill_id,
				name: item.name,
				version: item.version,
					description: item.description,
					path: item.file,
					instructions: item.instructions,
					basis_refs: item.basis_refs,
				}));
		if (activeSkills.length) {
				const projectedSkills = activeSkills.map((item) => ({
				skill_id: item.skill_id, name: item.name, version: item.version,
				resource_ref: `skill:${item.name}@v${item.version}`,
					description: compactText(item.description), path: item.path, basis_refs: item.basis_refs,
				...((!compactArc && ![...readSkills].some((key) => key.startsWith(`${item.skill_id}@`)))
					|| resourceIsExplicitlyFocused("skill", item)
						? { instructions: canonicalTextBody(item.instructions, "stored skill instructions"), focused: true }
					: {}),
			}));
			resources.push({
				role: "user",
				content: [{ type: "text", text: `Active task-local skills${compactArc ? " index" : " (read exact path when needed)"}: ${JSON.stringify(projectedSkills)}` }],
				timestamp: Date.now(),
			});
		}
		const latestTaskTools = new Map<string, Record<string, any>>();
		for (const item of readJsonl("task-tools.jsonl")) {
			const name = String(item.name ?? "");
			const previous = latestTaskTools.get(name);
			if (name && (!previous || Number(item.version ?? 0) >= Number(previous.version ?? 0))) latestTaskTools.set(name, item);
		}
		const taskToolInvocations = readJsonl("task-tool-events.jsonl")
			.filter((item) => item.event === "invoked" && item.status === "completed");
		const activeTaskTools = [...latestTaskTools.values()]
			.filter((item) => item.status === "active" && resourceIsFocused("tool", item))
			.sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)))
			.map((item) => ({
				name: item.name, version: item.version, exposed_name: item.exposed_name,
				description: item.description, input_schema: item.input_schema, output_schema: item.output_schema,
				program_format: item.program?.format ?? "legacy-steps",
				implementation_ref: item.implementation_ref, permission: item.permission,
				basis_refs: Array.isArray(item.basis_refs) ? item.basis_refs : [],
				invocation_count: taskToolInvocations.filter((event) => event.tool_id === item.tool_id && event.version === item.version).length,
			}));
		if (activeTaskTools.length) resources.push({
			role: "user",
			content: [{ type: "text", text: `Active task-local Pi tools (bounded pure JSON or adapter operations): ${JSON.stringify(compactArc ? activeTaskTools.map(({ name, version, exposed_name, description, program_format, implementation_ref, basis_refs, invocation_count }) => ({ name, version, exposed_name, description, program_format, implementation_ref, basis_refs, invocation_count })) : activeTaskTools)}` }],
			timestamp: Date.now(),
		});
		const unreviewedToolUses = activeTaskTools.filter((item) => Number(item.invocation_count ?? 0) > 0);
		if (unreviewedToolUses.length) resources.push({
			role: "user",
			content: [{ type: "text", text:
				`Task-local tool feedback is available for agent review: ${JSON.stringify(unreviewedToolUses)}. ` +
				"Compare each completed output with its expected effect. If the tool is useful but its contract or projection should change, update it with the exact current version and test the new version on subsequent real task data; if it is already adequate, keep it and continue.",
			}],
			timestamp: Date.now(),
		});
		const latestSubagents = new Map<string, Record<string, any>>();
		for (const item of readJsonl("task-subagents.jsonl")) {
			const name = String(item.name ?? "");
			const previous = latestSubagents.get(name);
			if (name && (!previous || Number(item.version ?? 0) >= Number(previous.version ?? 0))) latestSubagents.set(name, item);
		}
		const subagentInvocations = readJsonl("subagent-invocations.jsonl");
		const activeSubagents = [...latestSubagents.values()]
			.filter((item) => item.status === "active" && resourceIsFocused("subagent", item))
			.sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)))
			.map((item) => {
				const uses = subagentInvocations.filter((invocation) => invocation.agent_id === item.agent_id && invocation.agent_version === item.version && invocation.status === "completed");
				return {
					name: item.name, version: item.version, description: item.description,
					instructions: item.instructions, tools: item.tools,
					basis_refs: Array.isArray(item.basis_refs) ? item.basis_refs : [],
					invocation_count: uses.length,
					cumulative_cost: uses.reduce((sum, invocation) => sum + Number(invocation.result?.usage?.cost?.total ?? 0), 0),
				};
			});
		if (activeSubagents.length) resources.push({
			role: "user",
			content: [{ type: "text", text: `Active task-local subagents (clean-context analysis and validation): ${JSON.stringify(activeSubagents.map(({ name, version, description, tools, basis_refs, invocation_count }) => ({ name, version, description: compactText(description), tools, basis_refs, invocation_count, resource_ref: `subagent:${name}@v${version}` })))}` }],
			timestamp: Date.now(),
		});
		// Review all portfolios, including fully populated ones. Logarithmic count
		// buckets bound reminders; persisted signatures deduplicate session resume.
		// Review cues never create resources, start children or gate native actions.
		const executionObservations = readJsonl("execution-observations.jsonl");
		const callsByTool = new Map<string, number>();
		for (const observation of executionObservations) {
			const name = String(observation.tool_name ?? "").trim();
			if (name) callsByTool.set(name, (callsByTool.get(name) ?? 0) + 1);
		}
		const repeatedOperations = [...callsByTool.entries()]
			.filter(([, count]) => count >= 2)
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
		const hasActiveMemory = [...memories.values()].some((item) => item.status === "active");
		const hasActiveSkill = [...skills.values()].some((item) => item.status === "active");
		const hasActiveTaskTool = [...latestTaskTools.values()].some((item) => item.status === "active");
		const hasActiveSubagent = [...latestSubagents.values()].some((item) => item.status === "active");
		const missingComponents = [
			...(hasActiveMemory ? [] : ["memory"]),
			...(hasActiveSkill ? [] : ["skill"]),
			...(hasActiveTaskTool ? [] : (dependencies.taskToolAdapter ? ["tool"] : [])),
			...(hasActiveSubagent ? [] : (dependencies.taskToolAdapter ? ["subagent"] : [])),
		];
		const triggerSignature = JSON.stringify({
			progress: reviewProgress(readJsonl("execution-signals.jsonl")),
			missing_components: missingComponents,
			repeated_operation_tools: repeatedOperations.map(([name, count]) => [name, Math.floor(Math.log2(count))]),
			failure_count: readJsonl("task-operation-failures.jsonl").length,
			execution_failure_count: executionObservations.filter(e => e.is_error).length,
			delegation_count_bucket: Math.floor(Math.log2(1 + subagentInvocations.length)),
		});
		const initialSurface = executionObservations.length === 0;
		const repeatedOperationSurface = repeatedOperations.length > 0;
		// The opportunity message is informational only.  It never gates a native
		// mutation, and it must not wait for a fixed number of observations or
		// repeated operations: the Agent decides when the available evidence is
		// sufficient and may call any registered task_* tool from the first turn.
		if (!periodicReviewEnabled() && triggerSignature !== lastHarnessTriggerSignature) {
			const previousTrigger = lastHarnessTriggerSignature ? JSON.parse(lastHarnessTriggerSignature) : null;
			const currentTrigger = JSON.parse(triggerSignature);
			const trigger = previousTrigger && currentTrigger.progress.last_advance !== previousTrigger.progress?.last_advance
				? "public_progress"
				: previousTrigger && currentTrigger.progress.no_progress_bucket > (previousTrigger.progress?.no_progress_bucket ?? 0)
					? "no_public_progress"
					: previousTrigger && (currentTrigger.failure_count > previousTrigger.failure_count || currentTrigger.execution_failure_count > previousTrigger.execution_failure_count)
						? "recorded_failure"
						: initialSurface ? "initial_surface" : repeatedOperationSurface ? "repeated_operation" : "missing_component_surface";
			lastHarnessTriggerSignature = triggerSignature;
			append("task-harness-opportunities.jsonl", {
				signature: triggerSignature,
				opportunity_id: `harness-opportunity-${++harnessOpportunityCounter}`,
				trigger,
				trigger_evidence: JSON.parse(triggerSignature),
				observation_count: executionObservations.length,
				repeated_operations: repeatedOperations,
				missing_components: missingComponents,
				decision: "agent_choice_required",
				recordedAt: new Date().toISOString(),
			});
			resources.push({
				role: "user",
				content: [{ type: "text", text: renderPrompt("self_harness_opportunity.md", {
					observation_count: String(executionObservations.length),
					repeated_operations: JSON.stringify(repeatedOperations),
					missing_components: JSON.stringify(missingComponents),
				}) }],
				timestamp: Date.now(),
			});
		}
		if (periodicReviewEnabled()) {
			const queue = patternReviewQueue();
			for (const dueWindow of queue.due) {
				if (!readJsonl("task-harness-opportunities.jsonl").some(e => e.window?.window_id === dueWindow.window_id))
					append("task-harness-opportunities.jsonl", { opportunity_id: `harness-opportunity-${++harnessOpportunityCounter}`,
						trigger: "periodic_pattern_extraction", window: dueWindow, recordedAt: new Date().toISOString() });
			}
			const window = queue.current;
			if (window) {
				let opportunity = readJsonl("task-harness-opportunities.jsonl").find(e => e.window?.window_id === window.window_id);
				if (!opportunity) {
					opportunity = { opportunity_id: `harness-opportunity-${++harnessOpportunityCounter}`, trigger: "periodic_pattern_extraction", window, recordedAt: new Date().toISOString() };
					append("task-harness-opportunities.jsonl", opportunity);
				}
				if (compactArc && process.env.PI_HARNESS_REVIEW_DECISION_REQUIRED !== "enabled") {
					resources.push({role:"user", content:[{type:"text", text:
						`Periodic evidence available: ${JSON.stringify({opportunity_id:opportunity.opportunity_id,
							window_id:window.window_id,mode:window.mode,action_count:queue.action_count,
							baseline_ref:window.baseline_ref,evidence_refs:window.evidence_refs.slice(-8),
							additional_evidence_count:Math.max(0,window.evidence_refs.length-8)})}. ` +
						"Continue task work; no review, deferral or acknowledgment is required. This is an evidence index, not a task milestone. If a retrospective helps a current decision, read task_harness(action=inspect, section=review_contract); prior windows remain in pending_pattern_queue."
					}],timestamp:Date.now()});
				} else resources.push({ role: "user", content: [{ type: "text", text:
					`Periodic pattern extraction due: ${JSON.stringify({opportunity_id:opportunity.opportunity_id,
						window_id:window.window_id,mode:window.mode,action_count:queue.action_count,
						baseline_ref:window.baseline_ref, evidence_refs:window.evidence_refs.slice(-8),
						additional_evidence_count:Math.max(0,window.evidence_refs.length-8),
						older_pending_window_ids:queue.due.slice(0,-1).slice(-4).map(row=>row.window_id),
						older_pending_count:queue.due.length-1, deferred_count:queue.deferred.length,
						resumed_parent_reason:window.resumed_from?.parent_reason ?? null,
						batch: periodicReviewBatch(queue)})}. ` +
					"Compare before/action/after, invariants, competing predictive rules and counterexamples; identify limiting uncertainty, the next discriminating experiment and reusable capability opportunities. Unknowns are valid. " +
					"Read inspect(section=review_contract) when reviewing. A fixed old window may be deferred with resume_condition={kind:'manual'}; use after_actions only for an intentional timed revisit. New windows retain independent evidence. " +
					(process.env.PI_HARNESS_REVIEW_DECISION_REQUIRED === "enabled"
						? "Record review or defer before the next environment action; the decision boundary has a bounded recovery budget. No component quota."
						: "The review is advisory, not an ARC action gate.")
				}], timestamp: Date.now() });
			}
		}
		const agendas = latestControlRecords(readJsonl("auto-research-agenda.jsonl"), "agenda_id");
		const researchSessions = latestControlRecords(readJsonl("auto-research-sessions.jsonl"), "session_id");
		const researchReports = latestControlRecords(readJsonl("auto-research-reports.jsonl"), "run_id");
		const trackedLines = new Map(agendas.map(agenda => [String(agenda.research_line_ref), agenda]));
		for (const session of [...researchSessions].sort((a,b) => String(a.recordedAt ?? "").localeCompare(String(b.recordedAt ?? "")))) {
			if (session.status !== "completed" || !session.history_cursor || !session.research_line_ref) continue;
			const prior = trackedLines.get(session.research_line_ref);
			if (prior?.status === "drop") continue;
			if (prior && String(prior.recordedAt ?? "") >= String(session.recordedAt ?? "")) continue;
			const report = researchReports.find(row => row.run_id === session.run_id);
			trackedLines.set(session.research_line_ref, { ...session, ...(prior ? {
				agenda_id: prior.agenda_id, version: prior.version, status: prior.status, next_step: prior.next_step,
			} : { status: "reported", next_step: session.next_research_question ?? "" }),
				history_cursor: session.history_cursor, last_report_ref: session.report_ref
					?? (report ? `research_report:${report.run_id}@v${report.version ?? 1}` : prior?.last_report_ref),
			});
		}
		const continuationCards = [...trackedLines.values()].flatMap(agenda => {
			const newActions = successfulArcActions(executionObservations.slice(Number(agenda.history_cursor?.observation ?? 0)));
			const card = researchContinuationCard({ agenda,
				catalog: buildAutoResearchHistoryCatalog(root, agenda.history_cursor ?? {}),
				newActionRefs: newActions.map(row => resourceMetadata("observation", row).resource_ref),
				stageBoundaryRefs: newActions.filter(row => row.arc_outcome?.public_transition?.level_changed
					|| row.input?.action === "RESET").map(row => resourceMetadata("observation", row).resource_ref),
				active: researchSessions.some(session => session.research_line_ref === agenda.research_line_ref
					&& ["active", "pending"].includes(session.status)),
			});
			return card ? [card] : [];
		}).slice(-3);
		if (continuationCards.length) resources.push({ role: "user", content: [{ type: "text", text:
			`Auto-Research evidence update: ${JSON.stringify(continuationCards)}. ` +
			"Choose whether to continue the same research line now or after a discriminating experiment. New evidence is not proof of a prior rule. Recheck goal, rule, plan and competing predictions across stage changes. Read the cited agenda/report as needed; read research-orchestration before research. For useful findings, read the matching creator, create or update a component, assemble its exact version, trial it on later actions and return actual use/assessment evidence to this line. No component quota."
		}], timestamp: Date.now() });
		const inactiveConditionRefs = [...memories.values()].filter(item => validity.eligible("memory", item)
			&& !activationMatches(item.projection?.activation, projectionState)).map(item => knowledgeRef("memory", item));
		const guidanceSpecs = [
			{ name: "research_evidence_update", prefix: "Auto-Research evidence update:", trigger: "new_research_line_evidence" },
			{ name: "periodic_pattern_review", prefix: compactArc && process.env.PI_HARNESS_REVIEW_DECISION_REQUIRED !== "enabled"
				? "Periodic evidence available:" : "Periodic pattern extraction due:", trigger: "native_action_window" },
			{ name: compactArc ? "capability_workflow_reference" : "capability_extraction_process",
				prefix: compactArc ? "Capability workflow reference:" : loadPrompt("capability_extraction_process.md").split(/\r?\n/, 1)[0], trigger: capabilityExtractionTrigger },
			{ name: "pending_parent_capability_decisions", prefix: "Pending parent capability decisions (", trigger: "pending_parent_capability_decisions" },
			{ name: "baseline_authoring_methods", prefix: "Baseline authoring methods:", trigger: "every_treatment_context" },
		];
		const guidanceExposures = resources.flatMap((message) => (message.content ?? []).flatMap((part: any) => {
			if (part?.type !== "text" || typeof part.text !== "string") return [];
			const spec = guidanceSpecs.find((item) => part.text.startsWith(item.prefix));
			if (!spec) return [];
			return [{
				name: spec.name,
				...(spec.name === "periodic_pattern_review" ? { window_ids: [patternReviewQueue().current?.window_id].filter(Boolean) } : {}),
				...(spec.name === "research_evidence_update" ? { research_line_refs: continuationCards.map(card => card.research_line_ref) } : {}),
				sha256: createHash("sha256").update(part.text).digest("hex"),
				chars: part.text.length,
				trigger: spec.trigger,
				boundary: "task_local_self_harness_context",
			}];
		}));
		const signature = JSON.stringify({
			assembly: currentAssembly() ? [currentAssembly()!.assembly_id, currentAssembly()!.revision] : null,
			inactive_condition_refs: inactiveConditionRefs,
			knowledge_notices: validity.notices,
			pendingEffects: pendingEffects.map((item) => [item.decision_id, item.native_exposure_count]),
			activeMemories,
			dynamicTaskPromptMemories: activeTaskPromptMemories,
			promptContributions: promptContributionSelection,
			systemPrompts: [...systemPrompts.values()].filter((item) => validity.eligible("system_prompt", item))
				.map((item) => [item.segment_id, item.version]),
			skills: activeSkills.map((item) => [item.skill_id, item.version]),
			taskTools: activeTaskTools.map((item) => [item.name, item.version, item.invocation_count]),
			subagents: activeSubagents.map((item) => [item.name, item.version, item.invocation_count, item.cumulative_cost]),
			guidanceExposures,
		});
		if (resources.length && signature !== lastResourceSignature) {
			lastResourceSignature = signature;
			append("task-prompt-assemblies.jsonl", {
				format: "task-prompt-assembly-v1",
				assembly_ref: currentAssembly()
					? `harness_assembly:${currentAssembly()!.assembly_id}@v${currentAssembly()!.revision}` : null,
				selected: [
					...activeTaskPromptMemories.map(item => promptReceipt(item.layer,
						`memory:${item.key}@v${item.version}`, item.content)),
					...promptContributionSelection.selected.map(item => ({
						...promptReceipt(item.layer, item.source_ref, item.content),
						contribution_id: item.contribution_id, source_ref: item.source_ref,
					})),
				],
				suppressed: [...validity.notices, ...promptContributionSelection.suppressed],
				inactive_condition_refs: inactiveConditionRefs,
				recordedAt: new Date().toISOString(),
			});
			append("task-harness-context-exposures.jsonl", {
				exposure_id: `task-context-${Date.now()}`,
				pending_effect_decisions: pendingEffects.map((item) => ({
					decision_id: item.decision_id,
					native_exposure_count: item.native_exposure_count,
				})),
				memory_versions: activeMemories.map((item) => ({ memory_id: item.memory_id, version: item.version })),
				dynamic_task_prompt_memory_versions: activeTaskPromptMemories.map((item) => ({ memory_id: item.memory_id, version: item.version })),
				system_prompt_versions: [...systemPrompts.values()].filter((item) => validity.eligible("system_prompt", item))
					.map((item) => ({ segment_id: item.segment_id, name: item.name, version: item.version })),
				skill_versions: activeSkills.map((item) => ({ skill_id: item.skill_id, name: item.name, version: item.version })),
				task_tools: activeTaskTools.map((item) => ({ name: item.name, version: item.version, exposed_name: item.exposed_name })),
				subagents: activeSubagents.map((item) => ({ name: item.name, version: item.version, invocation_count: item.invocation_count, cumulative_cost: item.cumulative_cost })),
				message_count_before: event.messages.length,
				message_count_after: event.messages.length + resources.length,
				guidance_exposures: guidanceExposures,
				recordedAt: new Date().toISOString(),
			});
		}
		for (const active of activeMemories) {
			if (!active.decision_id || projectedMemories.has(active.decision_id)) continue;
			projectedMemories.add(active.decision_id);
			append("harness-observations.jsonl", {
				observation_id: `memory-exposure-${active.decision_id}`,
				observation_kind: "pi_task_memory_context",
				decision_id: active.decision_id,
				basis_resource_ids: active.basis_refs,
				operation: {
					capability: "pi.context",
					component: "task_memory",
					memory_id: active.memory_id,
					version: active.version,
				},
				effect_observed: true,
				recordedAt: new Date().toISOString(),
			});
		}
		for (const active of activeTaskPromptMemories) {
			if (!active.decision_id || projectedTaskPromptMemories.has(active.decision_id)) continue;
			projectedTaskPromptMemories.add(active.decision_id);
			append("harness-observations.jsonl", {
				observation_id: `task-prompt-projection-${active.decision_id}`,
				observation_kind: "pi_task_prompt_projection",
				decision_id: active.decision_id,
				basis_resource_ids: active.basis_refs,
				operation: {
					capability: "pi.context",
					component: "task_memory",
					projection: "task_prompt",
					memory_id: active.memory_id,
					version: active.version,
				},
				effect_observed: true,
				recordedAt: new Date().toISOString(),
			});
		}
		for (const active of activeSkills) {
			const projectionKey = `${active.skill_id}@${active.version}`;
			if (projectedSkills.has(projectionKey)) continue;
			projectedSkills.add(projectionKey);
			const current = skills.get(active.name);
			append("task-skill-events.jsonl", {
				event: "projected_to_context",
				skill_id: active.skill_id,
				name: active.name,
				version: active.version,
				decision_id: current?.decision_id,
				file: active.path,
				recordedAt: new Date().toISOString(),
			});
			if (current?.decision_id) {
				append("harness-observations.jsonl", {
					observation_id: `skill-projection-${current.decision_id}`,
					observation_kind: "pi_skill_context_index",
					decision_id: current.decision_id,
					basis_resource_ids: current.basis_refs,
					operation: {
						capability: "pi.context",
						component: "task_skill_index",
						name: current.name,
						version: current.version,
					},
					effect_observed: true,
					recordedAt: new Date().toISOString(),
				});
			}
		}
		if (pendingToolDecision) {
			append("harness-observations.jsonl", {
				observation_id: `tool-exposure-${pendingToolDecision.decisionId}`,
				observation_kind: "pi_active_tools",
				decision_id: pendingToolDecision.decisionId,
				toolCallId: pendingToolDecision.toolCallId,
				operation: { capability: "pi.setActiveTools" },
				effect_observed: true,
				active_tools: pi.getActiveTools(),
				recordedAt: new Date().toISOString(),
			});
			pendingToolDecision = undefined;
		}
		if (validity.notices.length) {
			const selected = new Set(currentAssembly()?.selected_resource_refs ?? []);
			const affected = validity.notices.filter((item) => selected.has(item.resource_ref));
			const notice = { total: validity.notices.length, selected_affected: affected.slice(0, 5)
				.map((item) => ({ resource_ref: item.resource_ref, reasons: item.reasons })),
				remaining_affected: Math.max(0, affected.length - 5),
				inspect: { tool: "task_harness", arguments: { action: "inspect", section: "knowledge_requires_review" } } };
			resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `Task-local knowledge requiring review: ${JSON.stringify(notice)}. Invalid versions are not current guidance.` }] });
		}
		const contextResult = resources.length || outcomeMessages.length || assembledMessages !== event.messages
			? { messages: [...assembledMessages, ...resources, ...outcomeMessages] } : {};
		return contextResult;
	});
	// The scripted external fixture still invokes native component tools to
	// verify executor compatibility. Production/model contexts expose only the
	// facade; fixture compatibility is opt-in through PI_EXTERNAL_STEPS.
	pi.on("session_start", () => {
		if (process.env.PI_EXTERNAL_STEPS !== undefined) {
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...INTERNAL_NATIVE_HARNESS_TOOLS])]);
		} else {
			hideNativeMutationTools();
		}
	});

}
