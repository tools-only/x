/** Task-local harness resources implemented through Pi's public extension APIs. */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { OBSERVATION_COMPACTION_TOOL } from "./pi_agent_owned_observation_compaction.ts";
import { installTaskLocalTools, type TaskToolAdapter } from "./pi_task_local_tools.ts";
import { admitTaskLocalOperation } from "./pi_task_execution_admission.ts";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { loadPrompt, renderPrompt } from "./prompt_loader.ts";
import { resourceMetadata, resolveTaskResource, taskRecords, versionConflict } from "./pi_task_resource_store.ts";
import {
	nativeHarnessExecutor,
	registerNativeHarnessExecutor,
	registerNativeHarnessRouteApplier,
} from "./pi_task_harness_route_runtime.ts";
import type { ActivationCondition } from "./pi_auto_research_harness_router.ts";
import { buildPeriodicResearchHandoff, harnessLifecycle, methodResearchContract, periodicReviewWindows, reviewProgress, normalizeHarnessReview, validateTransitionAnalysis, reviewInputContract, REVIEW_COMPONENTS, REVIEW_DISPOSITIONS } from "./pi_harness_review.ts";
import { controlError, eligibleResearchHandoffStatuses, latestControlRecords, selectControlTarget, stableControlJSON, failureClassification } from "./pi_harness_control.ts";
import { advanceResearchHandoff, reconcileResearchHandoffs, resolveResearchHandoff } from "./pi_auto_research_handoff.ts";
import { coherentMemory, knowledgeRef, knowledgeState, normalizeKnowledgeLinks, promptReceipt,
	type KnowledgeEntry, type KnowledgeLinks } from "./pi_task_knowledge_lifecycle.ts";
import { levelReviewInputContract, levelReviewWindows, validateLevelReview, LEVEL_REVIEW_GUIDANCE } from "./pi_level_retrospective.ts";
import {
	advanceMethodApplication, advanceMethodAssessment, buildCrossContextResearchCandidates,
	buildMethodFeedbackHandoff, latestMethodRecords,
} from "./pi_research_method_runtime.ts";
import { assertParentChangeSource, classifyHarnessChangeTargets, classifySemanticKind, normalizeCapabilityRequest, normalizeSemanticCandidate, type HarnessChange } from "./pi_harness_protocol.ts";
import {
	assemblyConflictDetails,
	assemblySelectsReference,
	createHarnessAssembly,
	latestHarnessAssembly,
	renderPromptContributions,
	TASK_PROMPT_LAYERS,
	type HarnessAssembly,
	type HarnessComponentKind,
	type HarnessPoolEntry,
} from "./pi_task_harness_assembly.ts";

export const SELF_HARNESS_MANAGEMENT_TOOLS = [
	"task_harness",
	"task_harness_status",
	"task_tool_policy",
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
	summary?: string;
	memory_id: string;
	key: string;
	version: number;
	status: "active" | "retired";
	content: string;
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
	recordedAt: string;
};

export type SystemPromptRecord = KnowledgeLinks & {
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
	return [["memory", "task-memory.jsonl"], ["skill", "task-skills.jsonl"],
		["system_prompt", "task-system-prompt.jsonl"]].flatMap(([kind, file]) => read(file).map(record => ({ kind, record })));
}

export function renderTaskSystemPromptOverlay(
	records: SystemPromptRecord[], entries?: KnowledgeEntry[], assembly?: HarnessAssembly,
): string {
	const validity = knowledgeState(entries ?? records.map(record => ({ kind: "system_prompt", record })));
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
	const readJsonl = (name: string): Record<string, any>[] => {
		const records = dependencies.readJsonl(name);
		assertTaskRecordsScope(taskScope, records, name);
		return records;
	};
	const append = (name: string, value: unknown) => dependencies.append(
		name,
		stampTaskRecord(taskScope, value as Record<string, unknown>),
	);
	const scopedDependencies: Dependencies = { ...dependencies, readJsonl, append };
	const workspace = join(root, "task-harness");
	const skillsDir = join(workspace, "skills");
	const agentsDir = join(workspace, "agents");

	const memoryRecords = readJsonl("task-memory.jsonl") as MemoryRecord[];
	const memories = latestBy(memoryRecords, "key");
	let memoryCounter = nextCounter(memoryRecords, "memory_id");
	const skillRecords = readJsonl("task-skills.jsonl") as SkillRecord[];
	const skills = latestBy(skillRecords, "name");
	let skillCounter = nextCounter(skillRecords, "skill_id");
	const systemPromptRecords = readJsonl("task-system-prompt.jsonl") as SystemPromptRecord[];
	const systemPrompts = latestBy(systemPromptRecords, "name");
	const knowledgeEntries = () => taskKnowledgeEntries(readJsonl);
	const currentKnowledge = () => knowledgeState(knowledgeEntries());
	const linkParameters = {
		depends_on_refs: Type.Optional(Type.Array(Type.String({ description: "Exact current memory/skill/system_prompt version required for validity; distinct from historical basis_refs." }))),
		supersedes_refs: Type.Optional(Type.Array(Type.String({ description: "Exact current versions explicitly replaced by this resource; dependent guidance requires revalidation." }))),
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
	const registerRoutableTool = (definition: any) => {
		pi.registerTool(definition);
		registerNativeHarnessExecutor(pi, String(definition.name), definition.execute);
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
		append("task-harness-change-requests.jsonl", {
			format: "task-harness-change-request-v1", change_ref: changeRef,
			decision: request.decision, changes: request.changes, status: "applying",
			recordedAt: new Date().toISOString(),
		});
		const results: Record<string, unknown>[] = [];
		const currentVersion = (targetKind: string, candidate: Record<string, any>): number | undefined => {
			const name = String(candidate.key ?? candidate.name ?? "").trim();
			if (!name) return undefined;
			if (targetKind === "memory") return memories.get(name)?.version;
			if (targetKind === "skill") return skills.get(name)?.version;
			if (targetKind === "system_prompt") return systemPrompts.get(name)?.version;
			const file = targetKind === "tool" ? "task-tools.jsonl" : "task-subagents.jsonl";
			return latestBy(readJsonl(file), "name").get(name)?.version;
		};
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
				if (!Object.keys(candidate).length && change.candidate_ref) {
					const candidateRef = String(change.candidate_ref);
					for (const report of readJsonl("auto-research-reports.jsonl")) {
						for (const proposal of (report.report?.harness_proposals ?? [])) {
							if (String(proposal.candidate_ref ?? "") === candidateRef && proposal.delivery) candidate = { ...proposal.delivery, candidate_ref: candidateRef };
						}
					}
					if (!Object.keys(candidate).length) throw new Error(`unknown harness candidate_ref: ${candidateRef}`);
				}
				candidate = normalizeSemanticCandidate(candidate);
				const semanticTarget = classifySemanticKind(candidate);
				if (semanticTarget === "research_only") throw new Error("assessment/evidence changes remain research-only");
				const operation = String(change.operation);
				for (const targetKind of classifyHarnessChangeTargets(candidate)) {
					const target = targetKind === "system_prompt" ? "task_system_prompt" : `task_${targetKind}`;
					const suppliedVersion = targetKind === "system_prompt" ? candidate.prompt_target_version : candidate.target_version;
					const resolvedVersion = operation === "update" && suppliedVersion === undefined
						? currentVersion(targetKind, candidate) : suppliedVersion;
					const common = {
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
						content: candidate.content, summary: candidate.summary, scope: candidate.scope?.statement ?? candidate.scope,
						...(candidate.projection ? { projection: candidate.projection }
							: candidate.context_visibility === "always" && (candidate.prompt_channel ?? "task_prompt") === "task_prompt"
								? { projection: { channel: "task_prompt", ...(candidate.prompt_layer ? { layer: candidate.prompt_layer } : {}),
									...(candidate.prompt_text ? { prompt_text: candidate.prompt_text } : {}), ...(candidate.activation ? { activation: candidate.activation } : {}) } }
								: {}) };
					else if (target === "task_system_prompt") args = { ...common, action: candidate.prompt_operation ?? operation,
						name: candidate.name, content: candidate.prompt_text ?? candidate.content, scope: candidate.scope?.statement ?? candidate.scope };
					else if (target === "task_skill") args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, instructions: candidate.instructions ?? candidate.content };
					else if (target === "task_tool") args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, input_schema: candidate.input_schema ?? { type: "object" },
						implementation_ref: candidate.implementation_ref, program: candidate.program };
					else args = { ...common, action: operation, name: candidate.name,
						description: candidate.description ?? candidate.summary, instructions: candidate.instructions ?? candidate.content, tools: candidate.tools };
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
				results.push({ index, step, native_tool: target, status: result?.isError ? "failed" : "applied", ...(!result?.isError && Object.keys(detail).length ? { resource: resourceMetadata(target.replace("task_", ""), detail) } : {}), ...(result?.isError ? { error: detail } : {}) });
				if (result?.isError) {
					const receipt = { format: "task-harness-change-receipt-v1", change_ref: changeRef, status: "failed", decision: request.decision, results };
					append("task-harness-change-receipts.jsonl", { ...receipt, recordedAt: new Date().toISOString() });
					return { isError: true, content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
			}
		}
		const receipt = { format: "task-harness-change-receipt-v1", change_ref: changeRef, status: "applied", decision: request.decision, results };
		append("task-harness-change-receipts.jsonl", { ...receipt, recordedAt: new Date().toISOString() });
		return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
	};
	pi.registerTool({
		name: HARNESS_BOOTSTRAP_TOOL,
		label: "Task-local harness compatibility entry",
		description: "Compatibility-only activation helper. It does not create content or bypass task_harness(action=change). Component names are activation aliases, not additional persistent harness types; system_prompt, skill, memory, tool and subagent remain the five routable components.",
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
	const protectedManagementTools = new Set<string>(["task_harness", "task_tool_policy"]);
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
		const optionalControlTools = ["task_resource", "task_validation"];
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
	const componentPool = (): Array<HarnessPoolEntry & { aliases: string[]; record: Record<string, any> }> => {
		const validity = currentKnowledge();
		const sources: Array<[HarnessComponentKind, Record<string, any>[]]> = [
			["memory", [...memories.values()]],
			["system_prompt", [...systemPrompts.values()]],
			["skill", [...skills.values()]],
			["tool", [...latestBy(readJsonl("task-tools.jsonl"), "name").values()]],
			["subagent", [...latestBy(readJsonl("task-subagents.jsonl"), "name").values()]],
		];
		return sources.flatMap(([kind, records]) => records.map(record => {
			const reasons = ["memory", "system_prompt", "skill"].includes(kind)
				? validity.reasons(kind, record)
				: [
					...(record.status === "active" ? [] : [`status:${String(record.status)}`]),
					...((record.availability ?? "loaded") === "loaded" ? [] : [`availability:${String(record.availability)}`]),
				];
			return {
				kind,
				resource_ref: resourceMetadata(kind, record).resource_ref,
				name: String(record.name ?? record.key ?? ""),
				version: Number(record.version ?? 1),
				status: String(record.status ?? "active"),
				availability: String(record.availability ?? (record.status === "retired" ? "retired" : "loaded")),
				eligible: reasons.length === 0,
				reasons,
				aliases: resourceRefVariants(kind, record),
				record,
			};
		}));
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
	const resourceIsAssembled = (kind: string, item: Record<string, any>) =>
		assemblySelectsReference(currentAssembly(), resourceRefVariants(kind, item));
	const resourceIsFocused = (kind: string, item: Record<string, any>) =>
		resourceIsAssembled(kind, item)
		&& (focusedResourceRefs === undefined || resourceRefVariants(kind, item).some((ref) => focusedResourceRefs?.has(ref)));
	const resourceIsExplicitlyFocused = (kind: string, item: Record<string, any>) =>
		focusedResourceRefs !== undefined && resourceIsFocused(kind, item);
	const applyAssemblyToolSurface = () => {
		const assembly = currentAssembly();
		if (!assembly) return;
		const allDynamicNames = new Set(readJsonl("task-tools.jsonl")
			.map((item) => String(item.exposed_name ?? "")).filter(Boolean));
		const selectedDynamicNames = componentPool()
			.filter((entry) => entry.kind === "tool" && entry.eligible
				&& assemblySelectsReference(assembly, entry.aliases))
			.map((entry) => String(entry.record.exposed_name ?? "")).filter(Boolean);
		pi.setActiveTools([...new Set([
			...pi.getActiveTools().filter((name) => !allDynamicNames.has(name)),
			...selectedDynamicNames,
			...protectedManagementTools,
		])]);
	};
	const projectTranscriptForAssembly = (messages: any[]): any[] => {
		if (!currentAssembly()) return messages;
		const nativeKinds: Record<string, { kind: string; file: string; key: string }> = {
			task_memory: { kind: "memory", file: "task-memory.jsonl", key: "key" },
			task_system_prompt: { kind: "system_prompt", file: "task-system-prompt.jsonl", key: "name" },
			task_skill: { kind: "skill", file: "task-skills.jsonl", key: "name" },
			task_tool: { kind: "tool", file: "task-tools.jsonl", key: "name" },
			task_subagent: { kind: "subagent", file: "task-subagents.jsonl", key: "name" },
		};
		const selectionByCall = new Map<string, boolean>();
		for (const message of messages) for (const item of Array.isArray(message?.content) ? message.content : []) {
			const toolName = String(item?.name ?? item?.toolName ?? "");
			const descriptor = nativeKinds[toolName];
			if (!descriptor) continue;
			const args = (item?.arguments ?? item?.input ?? {}) as Record<string, any>;
			const identity = String(args[descriptor.key] ?? "").trim();
			const record = identity ? latestBy(readJsonl(descriptor.file), descriptor.key).get(identity) : undefined;
			const callId = String(item?.id ?? item?.toolCallId ?? "");
			if (callId) selectionByCall.set(callId, Boolean(record && resourceIsAssembled(descriptor.kind, record)));
		}
		return messages.map((message) => {
			const callId = String(message?.toolCallId ?? "");
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
	const levelReviewResources = () => ["memory", "skill", "tool", "subagent", "system_prompt"].flatMap(kind =>
		taskRecords(root, kind).map(row => ({ ...resourceMetadata(kind, row), recordedAt: row.recordedAt })));
	const levelReviewContract = (window: Record<string, any>) =>
		levelReviewInputContract(window, levelReviewObservations(), levelReviewResources());
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
		if (event.toolName === "task_resource" || (event.toolName === "task_harness" && ["level_review", "inspect", "status"].includes(action))) return;
		return { block: true, reason: "Terminal level review permits evidence reads and level_review submission only; the environment is finished." };
	});
	const pendingPeriodicReview = () => {
		const settled = new Set(readJsonl("task-harness-reviews.jsonl").map(e => e.window_id).filter(Boolean));
		for (const item of readJsonl("task-harness-review-events.jsonl")) {
			if (item.status === "failed") settled.add(item.window_id);
		}
		return periodicReviewWindows(readJsonl("execution-observations.jsonl")).find(w => !settled.has(w.window_id));
	};
	const latestResearchHandoffs = () => {
		const records = readJsonl("auto-research-handoffs.jsonl");
		const updates = reconcileResearchHandoffs(
			records,
			readJsonl("auto-research-sessions.jsonl"),
			readJsonl("auto-research-reports.jsonl"),
		);
		for (const update of updates) append("auto-research-handoffs.jsonl", update);
		const latest = latestBy([...records, ...updates], "handoff_id");
		const actions = readJsonl("execution-observations.jsonl").filter(row => row.tool_name === "arc_action" && !row.is_error).length;
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
			.filter((row) => !consumed.has(`research_candidate:${row.candidate_id}@v${row.version}`))
			.map((row) => ({
				candidate_ref: `research_candidate:${row.candidate_id}@v${row.version}`,
				reason: row.reason,
				action_signature: row.action_signature,
				evidence_refs: row.evidence_refs,
				situation_count: Array.isArray(row.situation_context_ids) ? row.situation_context_ids.length : 0,
				episode_count: Array.isArray(row.episode_context_ids) ? row.episode_context_ids.length : 0,
				research_call: row.research_call,
			}));
	};
	// Candidate discovery is a deterministic observation-index update. Run it at
	// the environment boundary so the parent does not have to remember to scan
	// old trajectories before a cross-context opportunity can exist.
	pi.on("tool_execution_end", (event) => {
		if (event.toolName === "arc_action" && !event.isError) refreshCrossContextResearchCandidates();
	});
	const controlLimits = { failures:3, calls:12, elapsed_ms:120000, action_deferrals:2 };
	const settleControlBudgets = () => {
		if (!periodicReviewEnabled()) return;
		const events = readJsonl("task-harness-control-events.jsonl");
		const exhausted = (target:string, since:string) => {
			const recent = events.filter(row => row.target === target && row.recordedAt >= since);
			return recent.some(row => row.failure_class === "runtime_failure") ? "runtime_failure"
				: recent.filter(row => row.event === "failure").length >= controlLimits.failures ? "failure_budget"
				: recent.filter(row => row.event === "attempt").length >= controlLimits.calls ? "call_budget"
				: recent.length && Date.now() - Date.parse(recent[0].recordedAt) >= controlLimits.elapsed_ms ? "time_budget" : null;
		};
		const review = pendingPeriodicReview();
		if (review) {
			const opportunity = readJsonl("task-harness-opportunities.jsonl").find(row => row.window?.window_id === review.window_id);
			const reason = opportunity && exhausted(review.window_id, opportunity.recordedAt);
			if (reason) append("task-harness-review-events.jsonl", {window_id:review.window_id,status:"failed",reason,recordedAt:new Date().toISOString()});
		}
		for (const item of latestResearchHandoffs().values()) if (item.status === "proposed") {
			const reason = exhausted(item.handoff_id, item.recordedAt);
			if (reason) append("auto-research-handoffs.jsonl", advanceResearchHandoff(item, {status:"deferred",
				resume_condition:{kind:"manual"}, degraded:true, parent_reason:reason, decided_by:"runtime_budget"}));
		}
	};
	const controlAttempts = new Map<string, string[]>();
	pi.on("tool_execution_start", event => {
		if (!periodicReviewEnabled() || !["task_harness","task_harness_status","auto_research"].includes(event.toolName)) return;
		settleControlBudgets();
		const targets = [pendingPeriodicReview()?.window_id, pendingResearchHandoff()?.handoff_id].filter(Boolean) as string[];
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
	// Reviews and research handoffs are durable advisory events. They are
	// intentionally not an action gate: an irreversible environment must keep
	// advancing under the parent agent's continuous control. The terminal review
	// listener above remains the only semantic block, because no live action is
	// possible after a terminal environment state.

	// --no-skills plus no resources_discover: task-local context is the only skill projection.

	const registerScopedRead = () => {
		pi.registerTool({
			name: "read",
			label: "Read task-local harness resource",
			description: "Read a task-local skill or subagent definition by its exact path. Access is confined to this task's harness workspace.",
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
	const observationsForDecision = (decisionId: string): string[] => readJsonl("harness-observations.jsonl")
		.filter((row) => String(row.decision_id ?? "") === decisionId)
		.map((row) => String(row.observation_id ?? "")).filter(Boolean);
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
			applied: failed === 0, route_count: candidates.length, routes: results };
		append("auto-research-adoption-events.jsonl", { ...result, toolCallId, research_run_ref: requested || null, recordedAt: new Date().toISOString() });
		return { isError: failed > 0, content: [{ type: "text", text: JSON.stringify(result) }], details: result };
	};
	const assessHarnessEffect = async (toolCallId: string, input: Record<string, any>) => {
		const decisions = readJsonl("harness-decisions.jsonl");
		const assessed = new Set(readJsonl("effect-assessments.jsonl").map(row => row.decision_id));
		const eligibleDecisions = decisions.filter(row =>
			!assessed.has(row.decision_id) && observationsForDecision(String(row.decision_id ?? "")).length > 0);
		if (!input.decision_id && eligibleDecisions.length === 0) {
			const result = { format:"task-harness-no-op-v1", action:"assess_effect",
				status:"no_eligible_decision", applied:false,
				reason:"No unassessed harness decision has a later observation yet." };
			return { content:[{type:"text",text:JSON.stringify(result)}], details:result };
		}
		const decision = selectControlTarget(input.decision_id ? decisions : eligibleDecisions, "decision_id", input.decision_id);
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
		const assessment = {
			effect_assessment_id: `effect-assessment-${++assessmentCounter}`,
			decision_id: decisionId,
			observation_refs: observationRefs,
			verdict: String(input.verdict ?? "inconclusive"),
			consequence: String(input.consequence ?? ""),
			remaining_uncertainty: String(input.remaining_uncertainty ?? ""),
			source: "agent_assessment",
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
				if (observation?.tool_name !== "arc_action" || observation.is_error) return false;
				const basis = new Set((observation.input?.decision?.basis_refs ?? []).map(String));
				return [...resources].some((resource) => basis.has(String(resource)));
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
	// Self-Harness owns the only mutation callback. Research code must never
	// retrieve or invoke it; the parent control loop explicitly adopts a
	// compiled proposal through task_harness(action=apply_route).
	registerNativeHarnessRouteApplier(pi, applyCompiledRoute);

	const statusTool = {
		name: "task_harness_status",
		label: "Task-local harness status",
		description: "Inspect task-local control state and reconcile durable research lifecycle. Use task_harness(action='inspect') when this tool is not active. Does not start research or apply resources.",
		parameters: Type.Object({ request: Type.String() }),
		async execute() {
			const crossContextResearchCandidates = refreshCrossContextResearchCandidates();
			const validity = currentKnowledge();
			const active = new Set(pi.getActiveTools());
			const registeredTools = new Set(pi.getAllTools().map((tool) => tool.name));
			const authorized = authorizedTools();
			const latestResearchSessions = latestBy(readJsonl("auto-research-sessions.jsonl"), "session_id");
			const latestResearchReports = latestBy(readJsonl("auto-research-reports.jsonl"), "run_id");
			const latestRouteVersions = latestBy(readJsonl("auto-research-harness-routes.jsonl"), "route_id");
			const pendingResearchAdoptions = [...latestRouteVersions.values()]
				.filter((route) => route.route_status === "ready" && route.disposition === "materialize")
				.reduce((groups: Record<string, any>, route: Record<string, any>) => {
					const runId = String(route.run_id ?? String(route.route_id ?? "").split(":")[0]);
					groups[runId] ??= { research_run_ref: `research_run:${runId}@v1`, candidates: [],
						adoption_call: { action: "adopt_research", research_run_ref: `research_run:${runId}@v1` } };
					groups[runId].candidates.push({ delivery_id: route.delivery_id,
						target: route.steps?.[0]?.target ?? null, name: route.steps?.[0]?.native_call?.arguments?.name ?? null });
					return groups;
				}, {});
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
						candidate_refs: Array.isArray(item.report?.harness_proposals)
							? item.report.harness_proposals.map((proposal: Record<string, any>) => proposal.candidate_ref).filter(Boolean)
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
					use: `Call ${item.exposed_name}(input={...})`,
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
					use: "Automatically projected into the next context; call task_memory(action=inspect,key=...) for the full value.",
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
				knowledge_requires_review: validity.notices,
				review_contract: reviewInputContract(periodicReviewEnabled() ? pendingPeriodicReview() : undefined),
				control_policy: {enabled:periodicReviewEnabled(), ...controlLimits},
				assessable_decisions: readJsonl("harness-decisions.jsonl").filter(row => !readJsonl("effect-assessments.jsonl").some(a => a.decision_id === row.decision_id)
					&& observationsForDecision(String(row.decision_id ?? "")).length > 0)
					.map(row => ({decision_id:row.decision_id,observation_refs:observationsForDecision(String(row.decision_id ?? ""))})),
				reviews: readJsonl("task-harness-reviews.jsonl").slice(-5),
				research_handoffs: [...latestResearchHandoffs().values()].slice(-10).map(item => ({
					handoff_ref: `research_handoff:${item.handoff_id}@v${item.version}`,
					status: item.status, review_id: item.review_id, window_id: item.window_id,
					lane: item.lane, ready_call: item.ready_call, ready_calls: item.ready_calls ?? null,
					interaction_mode_policy: item.interaction_mode_policy ?? null,
					next_call: item.next_call ?? item.ready_call,
					session_ref: item.session_ref ?? null, research_run_ref: item.research_run_ref ?? null,
					confidence_state: item.confidence_state ?? item.current_confidence,
					confidence_update: item.confidence_update ?? null,
					next_experiment: item.experiment_request ?? null,
				})),
				pending_research_handoff: pendingResearchHandoff() ?? null,
				pending_research_adoptions: Object.values(pendingResearchAdoptions),
				cross_context_research_candidates: crossContextResearchCandidates,
				research_experiment_candidates: researchExperimentCandidates,
				pending_pattern_extraction: periodicReviewEnabled() ? pendingPeriodicReview() ?? null : null,
				pending_level_reviews: pendingLevelReviews(),
				latest_level_review: readJsonl("task-level-reviews.jsonl").at(-1) ?? null,
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
				component_pool: componentPool().map(({ record: _record, aliases, ...entry }) => ({
					...entry, selected: assemblySelectsReference(currentAssembly(), aliases),
				})),
				assembly_contract: {
					owner: "main_agent",
					component_pool: "current selectable projection of the committed immutable version store; historical versions remain readable through task_resource",
					selection: "exact current eligible component versions",
					task_prompt: "source-agnostic assembly output channel",
					legacy: "all eligible active components until the first explicit assembly",
					runtime: "validates, projects, exposes, executes, and records receipts without semantic selection",
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
	pi.registerTool(statusTool);
	pi.registerTool({
		name: "task_harness",
			label: "Task-local working methods",
			description: "Task-local Self-Harness facade. action=change creates, updates, or retires immutable component versions in the pool; action=assemble lets the main Agent select exact current versions and source-agnostic task_prompt contributions for later requests. Active pool membership does not imply assembly selection. Code validates versions, applies the selected runtime surface, records receipts, and never chooses semantic composition. Use action=adopt_research only after deciding to adopt a completed result; research output is not guidance until selected. Direct task action does not require reassembly. apply_route is a low-level recovery entry. Periodic reviews require grounded transition_analysis; decide_research only manages handoff lifecycle.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("start"), Type.Literal("inspect"), Type.Literal("status"), Type.Literal("review"), Type.Literal("level_review"), Type.Literal("report_level_reset"), Type.Literal("decide_research"), Type.Literal("enable"), Type.Literal("activate"), Type.Literal("focus"), Type.Literal("assemble"), Type.Literal("change"), Type.Literal("adopt_research"), Type.Literal("apply_route"), Type.Literal("assess_effect")]),
				changes: Type.Optional(Type.Array(Type.Union([
					Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("update")]), candidate: Type.Optional(Type.Record(Type.String(), Type.Any())), candidate_ref: Type.Optional(Type.String()) }),
					Type.Object({ operation: Type.Union([Type.Literal("retire"), Type.Literal("reuse")]), target_ref: Type.String() }),
				]))),
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
						kind: Type.Union([Type.Literal("behavior"), Type.Literal("harness")], { description: "behavior credits an in-window observation; harness credits an exact persisted resource version." }),
						target_ref: Type.String({ description: "behavior: exact ref from behavior_target_ref_candidates. harness: exact ref from harness_targets.target_ref." }),
						verdict: Type.Union([Type.Literal("positive"), Type.Literal("negative"), Type.Literal("uncertain")]),
						evidence_refs: Type.Array(Type.String({ description: "Exact refs from evidence_ref_candidates only; include application_ref for applied harness credit." })),
						reason: Type.String(), counterfactual: Type.String(), next_use: Type.String(),
						use_stage: Type.Optional(Type.String({ description: "Harness only: created_only, exposed, read, or applied. Positive credit requires applied." })),
						application_ref: Type.Optional(Type.String({ description: "Applied harness only: one exact ref from this target's application_ref_candidates; never use an assessment, validation, exposure, or resource ref." })),
					})),
				})),
				opportunity_id: Type.Optional(Type.String({description:"Omit to select the unique pending opportunity. Copy an exact ID from inspect only when selecting explicitly."})),
				research_handoff_ref: Type.Optional(Type.String({description:"Omit for unique eligible handoff; explicit refs must be current research_handoff:<id>@vN."})),
				research_decision: Type.Optional(Type.Union([Type.Literal("defer"), Type.Literal("skip"), Type.Literal("reactivate")])),
				research_reason: Type.Optional(Type.String()),
				resume_condition: Type.Optional(Type.Object({kind:Type.Union([Type.Literal("manual"),Type.Literal("after_actions")]),
					actions:Type.Optional(Type.Integer({minimum:1,description:"Required for after_actions; successful future ARC actions before reactivation."}))})),
			transition_analysis: Type.Optional(Type.Object({
				observed_changes: Type.String(), predictive_rules: Type.String(),
				limiting_uncertainty: Type.String(), next_experiment: Type.String(),
				research_kind: Type.Optional(Type.Union([
					Type.Literal("mechanism"), Type.Literal("representation"), Type.Literal("capability"), Type.Literal("composition"),
					Type.Literal("exploration"), Type.Literal("planning"), Type.Literal("solution"), Type.Literal("recovery"),
				], { description: "Task-level object for optional Auto-Research; does not select a harness component." })),
				capability_opportunities: Type.String(), evidence_refs: Type.Optional(Type.Array(Type.String(), { description: "Exact existing observation IDs; runtime classifies current window/baseline and historical evidence. At least one current reference is required." })),
				window_evidence_refs: Type.Optional(Type.Array(Type.String())), historical_evidence_refs: Type.Optional(Type.Array(Type.String())),
			})),
			review: Type.Optional(Type.Array(Type.Object({
				component: Type.Optional(Type.Union(REVIEW_COMPONENTS.map(value => Type.Literal(value)), {description:"Optional when candidate semantic_kind/type already identifies the component."})), disposition: Type.Union([...REVIEW_DISPOSITIONS,"keep"].map(value => Type.Literal(value)), {description:"keep is a compatibility alias for reuse"}), reason: Type.String({minLength:1}),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				next_use: Type.Optional(Type.String()), validation: Type.Optional(Type.String()),
				candidate: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Complete structured harness candidate. When disposition is create/update, runtime applies it in this same review call; omit when the review only identifies a gap." })),
				patterns: Type.Optional(Type.Array(Type.Object({
					pattern: Type.Optional(Type.String({description:"One-sentence reusable rule; if omitted, the runtime copies candidate for compatibility."})), evidence_refs: Type.Array(Type.String()),
					applicability: Type.String(), counterexamples: Type.String(),
					candidate: Type.String(), next_use: Type.String(), validation: Type.String(),
				}))),
			}))),
				enabled_tools: Type.Optional(Type.Array(Type.String())),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				expected_assembly_revision: Type.Optional(Type.Integer({ minimum: 0 })),
				selected_resource_refs: Type.Optional(Type.Array(Type.String())),
				prompt_contributions: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
				route_ref: Type.Optional(Type.String()),
				expected_delivery_hash: Type.Optional(Type.String()),
				research_run_ref: Type.Optional(Type.String({ description: "For adopt_research only. Omit when exactly one completed research result has materializable routes." })),
				decision_id: Type.Optional(Type.String()),
				observation_refs: Type.Optional(Type.Array(Type.String())),
				verdict: Type.Optional(Type.String()),
				consequence: Type.Optional(Type.String()),
				remaining_uncertainty: Type.Optional(Type.String()),
			}),
		async execute(toolCallId, params) {
			const admission = admitTaskLocalOperation("task_harness");
			if (admission) return admission;
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
				const window = levelWindows().find(row => row.window_id === params.window_id);
				if (!window) throw new Error("Unknown level outcome window; use the pending context window_id");
				const prior = readJsonl("task-level-reviews.jsonl").find(row => row.window_id === window.window_id);
				if (prior) return { content: [{ type: "text", text: JSON.stringify(prior) }], details: prior };
				const report = validateLevelReview(window, params.level_review ?? {}, levelReviewObservations(), levelReviewResources());
				append("task-level-reviews.jsonl", report);
				return { content: [{ type: "text", text: JSON.stringify(report) }], details: report };
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
			if (params.action === "review") {
				recoverReviewCommits();
				const reviews = readJsonl("task-harness-reviews.jsonl");
				const opportunities = readJsonl("task-harness-opportunities.jsonl");
				if (params.opportunity_id) {
					const committed = reviews.find(row => row.opportunity_id === params.opportunity_id);
					if (committed) {
						const result = { ...committed, status:"already_committed", applied:false,
							reason:"This review was already committed; the existing result is returned." };
						return { content:[{type:"text",text:JSON.stringify(result)}], details:result };
					}
				}
				const failedWindows = new Set(readJsonl("task-harness-review-events.jsonl").filter(row => row.status === "failed").map(row => row.window_id));
				const pending = opportunities.filter(row => !reviews.some(review => review.opportunity_id === row.opportunity_id) && !failedWindows.has(row.window?.window_id));
				const opportunity = selectControlTarget(params.opportunity_id ? opportunities : pending, "opportunity_id", params.opportunity_id);
				const errors: Record<string,any>[] = [];
				const entries = normalizeHarnessReview(params.review ?? [], knownTaskResourceRefs(), errors);
				let transition = params.transition_analysis;
				if (opportunity.window) {
					const allowed = new Set([...opportunity.window.evidence_refs, opportunity.window.baseline_ref].filter(Boolean));
					const observations = readJsonl("execution-observations.jsonl");
					const end = observations.findLastIndex(row => allowed.has(row.observation_id));
					const historical = new Set(observations.slice(0,end + 1).map(row => row.observation_id));
					try { transition = validateTransitionAnalysis(transition, allowed, historical); }
					catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						try { errors.push(...JSON.parse(message).errors); } catch { errors.push({path:"transition_analysis",message}); }
					}
					for (const entry of entries) {
						if (!["create", "update"].includes(entry.disposition) || entry.patterns?.length || !entry.candidate || typeof entry.candidate !== "object") continue;
						const candidate = entry.candidate as Record<string, any>;
						const evidenceRefs = (transition?.evidence_refs ?? []).filter((ref: string) => historical.has(ref));
						entry.patterns = [{
							pattern: String(candidate.summary ?? entry.reason),
							evidence_refs: evidenceRefs,
							applicability: String(candidate.applicability ?? candidate.scope?.statement ?? candidate.scope ?? entry.next_use),
							counterexamples: String(candidate.counterexamples ?? transition?.limiting_uncertainty ?? "No counterexample supplied."),
							candidate: String(candidate.instructions ?? candidate.content ?? candidate.summary),
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
				if (errors.length) controlError("invalid_review",errors,reviewInputContract(opportunity.window));
				const fingerprint = stableControlJSON({entries,transition});
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
					...(opportunity.window ? { window_id: opportunity.window.window_id, window: opportunity.window } : {}),
					...(researchHandoff ? { research_handoff_ref: researchHandoff.ready_call.research_handoff_ref } : {}),
					method_research_contract: methodResearchContract(entries, researchHandoff), recordedAt: new Date().toISOString(),
				};
				if (!existing) {
					append("task-harness-review-commits.jsonl",{review,handoff:researchHandoff ?? null,recordedAt:new Date().toISOString()});
					recoverReviewCommits();
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
					...(applicationReceipt ? {application_receipt:applicationReceipt} : {}), ...(liveHandoff ? {research_handoff_ref:`research_handoff:${liveHandoff.handoff_id}@v${liveHandoff.version}`,
					method_research_contract:{...review.method_research_contract,research_handoff_ref:`research_handoff:${liveHandoff.handoff_id}@v${liveHandoff.version}`,
						ready_auto_research_calls:liveHandoff.status === "proposed" ? liveHandoff.ready_calls ?? {start:liveHandoff.next_call} : null},handoff:liveHandoff} : {})};
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (params.action === "change") return applyFacadeChanges(toolCallId, params as Record<string, any>);
			if (params.action === "assemble") {
				try {
					const assembly = createHarnessAssembly({
						input: params as Record<string, any>,
						previous: currentAssembly(),
						resolveComponentRef: resolveCurrentComponentRef,
						resolveSourceRef: resolvePromptSourceRef,
					});
					append("task-harness-assemblies.jsonl", assembly);
					applyAssemblyToolSurface();
					const receipt = {
						format: "task-harness-assembly-receipt-v1", applied: true,
						assembly_ref: `harness_assembly:${assembly.assembly_id}@v${assembly.revision}`,
						current_assembly: assembly,
					};
					append("task-harness-assembly-receipts.jsonl", { ...receipt, recordedAt: new Date().toISOString() });
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				} catch (error) {
					let details: Record<string, any>;
					try { details = assemblyConflictDetails(error) as Record<string, any>; }
					catch { throw error; }
					return { isError: true, content: [{ type: "text", text: JSON.stringify(details) }], details };
				}
			}
			if (params.action === "apply_route") return applyCompiledRoute(toolCallId, params as Record<string, any>);
			if (params.action === "adopt_research") return adoptResearchResult(toolCallId, params as Record<string, any>);
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
						system_prompt: "create a stable task-wide overlay only when it must remain continuously salient",
						skill: "create a repeatable observation or reasoning procedure",
						tool: "create a declarative program with adapter_call/select/count/pick",
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
						message: "These task-local entries are not registered in this run. Inspect task_harness(action='inspect') and request only registered entries." };
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
				focusedResourceRefs = new Set(requested);
			}
			return statusTool.execute();
		},
	});

	registerRoutableTool({
		name: "task_memory",
		label: "Task-local memory",
		description: "Create, revise, retire, or inspect task-local memory. Content is authoritative: changed summary/prompt_text requires content or append_content in the same update. A body write clears omitted custom prompt_text; projection=null disables injection. projection.layer selects task_policy (conditional strategy) or task_state (default). depends_on_refs pins validity dependencies; supersedes_refs explicitly replaces old versions. Historical basis_refs do not imply validity dependencies. New keys omit target_version; updates use CURRENT version. Summaries are agent-authored, not verified truth. Full versions remain in task_resource.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("upsert"), Type.Literal("retire"), Type.Literal("inspect")]),
			...linkParameters,
			key: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1, description: "Current version being edited; runtime increments it after success." })),
			content: Type.Optional(Type.String()),
			append_content: Type.Optional(Type.String()),
			summary: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			pinned: Type.Optional(Type.Boolean()),
			projection: Type.Optional(Type.Union([Type.Null(), Type.Object({
				channel: Type.Literal("task_prompt"),
				layer: Type.Optional(Type.Union([Type.Literal("task_policy"), Type.Literal("task_state")])),
				prompt_text: Type.Optional(Type.String()),
				activation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			})])),
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
			if (previous && Number(p.target_version) !== previous.version) return versionConflict("memory", previous, p.target_version);
			if (!previous && p.target_version !== undefined) throw new Error("target_version is only valid for an existing memory");
			const status = p.action === "retire" ? "retired" : "active";
			if (p.content !== undefined && p.append_content !== undefined) throw new Error("choose content replacement or append_content, not both");
			const content = p.append_content !== undefined
				? `${previous?.content ?? ""}${String(p.append_content)}`
				: String(p.content ?? previous?.content ?? "").trim();
			if (status === "active" && !content) throw new Error("active memory requires content");
			const views = coherentMemory(p, previous);
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "memory", key);
			const decisionId = dependencies.allocateDecisionId();
			const record: MemoryRecord = {
				...links,
				memory_id: previous?.memory_id ?? `memory-${++memoryCounter}`,
				summary: views.summary,
				key,
				version: (previous?.version ?? 0) + 1,
				status,
				content,
				scope: String(p.scope ?? previous?.scope ?? "current task"),
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				pinned: Boolean(p.pinned ?? previous?.pinned ?? false),
				...(views.projection ? { projection: views.projection } : {}),
				decision_id: decisionId,
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
			append("harness-decisions.jsonl", {
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

	registerRoutableTool({
		name: "task_system_prompt",
		label: "Task-local system-prompt overlay",
		description: "Create, revise, retire, or inspect a task-local system-prompt segment. Active segments are appended through Pi's before_agent_start hook on later requests. Fixed host instructions and permissions remain immutable.",
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
			const content = String(p.content ?? previous?.content ?? "").trim();
			if (status === "active" && !content) throw new Error("active system prompt segment requires content");
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "system_prompt", name);
			const decisionId = dependencies.allocateDecisionId();
			const record: SystemPromptRecord = {
				...links,
				segment_id: previous?.segment_id ?? `system-prompt-${++systemPromptCounter}`,
				name, version: (previous?.version ?? 0) + 1, status, content,
				scope: String(p.scope ?? previous?.scope ?? "current task"),
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? "keep a stable task-wide directive in the Pi system prompt"),
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
		const overlay = renderTaskSystemPromptOverlay(active, knowledgeEntries(), assembly);
		append("task-system-prompt-assemblies.jsonl", { format: "task-system-prompt-assembly-v1",
			assembly_ref: assembly ? `harness_assembly:${assembly.assembly_id}@v${assembly.revision}` : null,
			selected: active.map(item => promptReceipt("system_overlay", knowledgeRef("system_prompt", item), item.content)),
			...promptReceipt("system_overlay", "assembled-overlay", overlay), recordedAt: new Date().toISOString() });
		if (!active.length) return {};
		return { systemPrompt: `${event.systemPrompt}\n\n# Task-local system-prompt overlay\n${overlay}` };
	});

	registerRoutableTool({
		name: "task_skill",
		label: "Task-local Pi skill",
		description: "Create, revise, retire, or inspect a task-local Pi-format SKILL.md. Active skill indexes enter later Pi contexts and the skill is usable after read returns its instructions. The Agent may create or update a skill directly from a task observation; no finding is required. Skills are task-local context resources; native skill discovery and loading are disabled. If research actually motivates a change, cite its exact finding, candidate, or observation identifier in basis_refs; an empty basis remains valid but is not research-linked.",
		parameters: Type.Object({
			...linkParameters,
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			description: Type.Optional(Type.String()),
			instructions: Type.Optional(Type.String()),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
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
			const instructions = String(p.instructions ?? previous?.instructions ?? "").trim();
			if (status === "active" && (!description || !instructions)) throw new Error("active skill requires description and instructions");
			const links = normalizeKnowledgeLinks(p, previous, knowledgeEntries(), "skill", name);
			const path = join(skillsDir, name, "SKILL.md");
			const decisionId = dependencies.allocateDecisionId();
			const record: SkillRecord = {
				...links,
				skill_id: previous?.skill_id ?? `skill-${++skillCounter}`,
				name,
				version: (previous?.version ?? 0) + 1,
				status,
				description,
				instructions,
				file: path,
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? "make a reusable task-local method available to later Pi turns"),
				reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when ?? "the skill is unused, contradicted, or no longer relevant"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
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
		description: "Inspect or set the active subset of already registered and authorized Pi tools. The policy tool remains active so the Agent can revise the choice. If research actually motivates a change, cite its exact finding, candidate, or observation identifier in basis_refs; an empty basis remains valid but is not research-linked.",
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
			for (const tool of protectedManagementTools) {
				if (!requested.includes(tool)) requested.push(tool);
			}
			const previous = pi.getActiveTools();
			const decisionId = dependencies.allocateDecisionId();
			pi.setActiveTools(requested);
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
		description: "Record the Agent's interpretation of a prior task-local harness decision after later observations. This is an Agent assessment, not independent proof of task improvement.",
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



	pi.on("context", (event) => {
		applyAssemblyToolSurface();
		const assembledMessages = projectTranscriptForAssembly(event.messages);
		const crossContextCandidates = refreshCrossContextResearchCandidates();
		const pendingOutcomes = pendingLevelReviews();
		const completedOutcomes = readJsonl("task-level-reviews.jsonl");
		const outcomeMessages: any[] = pendingOutcomes.length ? [{ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `${LEVEL_REVIEW_GUIDANCE}\nPending whole-level windows and valid field candidates: ${JSON.stringify(pendingOutcomes.map(window => ({
				window, input_contract: levelReviewContract(window),
			})))}` }] }] : [];
		const lastReview = completedOutcomes.at(-1);
		if (lastReview) outcomeMessages.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `Previous level retrospective (agent-assessed): ${JSON.stringify({ window_id: lastReview.window_id,
				lessons: lastReview.lessons, next_attempt: lastReview.next_attempt, credits: lastReview.credits })}` }] });
		if (terminalReview) return { messages: [...assembledMessages, ...outcomeMessages] };
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
		const checkpointPath = join(root, "task-checkpoint.json");
		const latestCheckpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : {};
		assertTaskRecordsScope(taskScope, [latestCheckpoint], "task-checkpoint.json");
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
		const resources: any[] = [{
			role: "user", timestamp: Date.now(),
			content: [{ type: "text", text:
				compactArc
					? renderPrompt("self_harness_index.md", { active_resources: JSON.stringify(resourceCounts) })
					: `Task-local self-harness is UNLOCKED for this treatment task. Current active resources: ${JSON.stringify(resourceCounts)}. ` +
					  `Creation is available now through ${supportedCreation.join(", ")}; no bootstrap, repeated operation, prior finding, or validation mode is required. ` +
					  "Start with the smallest useful lower-order capability when it will help: memory for durable facts, skill for a repeatable procedure, tool for a structured adapter-bounded operation, or a subagent for an independent read-only question. " +
					  "Create, actually use, inspect the result, and revise only when evidence warrants; choose freely if direct execution has higher value. task_harness provides status and context focus. Auto-Research may study the task path, a component, a composition, a strategy, or the research method itself.",
			}],
		}];
		if (crossContextCandidates.length) resources.push({
			role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `Cross-context research candidates (runtime facts, optional choices): ${JSON.stringify(crossContextCandidates)}` }],
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
						? { instructions: String(item.instructions), focused: true }
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
				description: item.description, input_schema: item.input_schema,
				implementation_ref: item.implementation_ref, permission: item.permission,
				basis_refs: Array.isArray(item.basis_refs) ? item.basis_refs : [],
				invocation_count: taskToolInvocations.filter((event) => event.tool_id === item.tool_id && event.version === item.version).length,
			}));
		if (activeTaskTools.length) resources.push({
			role: "user",
			content: [{ type: "text", text: `Active task-local Pi tools (adapter-bounded): ${JSON.stringify(compactArc ? activeTaskTools.map(({ name, version, exposed_name, description, implementation_ref, basis_refs, invocation_count }) => ({ name, version, exposed_name, description, implementation_ref, basis_refs, invocation_count })) : activeTaskTools)}` }],
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
			const window = pendingPeriodicReview();
			if (window) {
				let opportunity = readJsonl("task-harness-opportunities.jsonl").find(e => e.window?.window_id === window.window_id);
				if (!opportunity) {
					opportunity = { opportunity_id: `harness-opportunity-${++harnessOpportunityCounter}`, trigger: "periodic_pattern_extraction", window, recordedAt: new Date().toISOString() };
					append("task-harness-opportunities.jsonl", opportunity);
				}
				const excerpts = executionObservations.filter(e => window.evidence_refs.includes(e.observation_id)).map(e => ({ ref: e.observation_id, tool: e.tool_name, excerpt: compactText(String(e.result_text ?? ""), 180) }));
				resources.push({ role: "user", content: [{ type: "text", text:
					`Periodic pattern extraction is due before the next ARC action: ${JSON.stringify(opportunity)}. ` +
					loadPrompt("state_transition_induction.md") + "\n" +
					"Include transition_analysis in the review: observed_changes (and invariants), predictive_rules (hypotheses/support/limits), limiting_uncertainty, next_experiment (alternative predictions and falsifier, or reason none is possible/needed), capability_opportunities, and exact evidence_refs from this window. Unknowns are valid; do not invent rules. " +
					`Extract reusable patterns from this exact window, not only facts. Read exact evidence as needed; excerpts are not complete observations: ${JSON.stringify(excerpts)}. ` +
					(window.mode === "consolidation" ? "Consolidate the last 20 actions: check prior candidates' actual use/effects, duplicates, conflicts and obsolete resources. " : "Extract new reusable methods from the last 5 actions. ") +
					`Submit task_harness(action=review, review=[...], transition_analysis={...}); runtime binds the unique opportunity and fills omitted components as deferred. ${JSON.stringify(reviewInputContract(window))}. Choose blocking/non_blocking for the resulting research, or explicitly defer/skip with a reason. Existing historical evidence may support comparisons. Management failures are bounded; inspect control_policy for limits.`
				}], timestamp: Date.now() });
			}
		}
		const inactiveConditionRefs = [...memories.values()].filter(item => validity.eligible("memory", item)
			&& !activationMatches(item.projection?.activation, projectionState)).map(item => knowledgeRef("memory", item));
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
		if (validity.notices.length) resources.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `Task-local knowledge requiring review: ${JSON.stringify(validity.notices)}. These versions are not current guidance. Historical transcript/checkpoint mentions do not reactivate them. Native system overlays refresh at the next agent turn; use task_policy for changing strategies.` }] });
		return resources.length || outcomeMessages.length || assembledMessages !== event.messages
			? { messages: [...assembledMessages, ...resources, ...outcomeMessages] } : {};
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
