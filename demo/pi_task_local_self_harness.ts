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
import { renderPrompt } from "./prompt_loader.ts";
import { resourceMetadata, resolveTaskResource, taskRecords, versionConflict } from "./pi_task_resource_store.ts";
import {
	nativeHarnessExecutor,
	registerNativeHarnessExecutor,
	registerNativeHarnessRouteApplier,
} from "./pi_task_harness_route_runtime.ts";
import type { ActivationCondition } from "./pi_auto_research_harness_router.ts";

export const SELF_HARNESS_MANAGEMENT_TOOLS = [
	"task_harness",
	"task_harness_status",
	"task_memory",
	"task_system_prompt",
	"task_skill",
	"task_tool",
	"task_tool_policy",
	"assess_harness_effect",
	"auto_research",
] as const;

/** Compatibility entrypoint; core component operations are directly available. */
export const HARNESS_BOOTSTRAP_TOOL = "harness_bootstrap";

	const SUBAGENT_MANAGEMENT_TOOLS = ["task_subagent", "delegate_task", "auto_research"] as const;

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

type MemoryRecord = {
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

type SkillRecord = {
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

export type SystemPromptRecord = {
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

export function renderTaskSystemPromptOverlay(records: SystemPromptRecord[]): string {
	const active = [...latestBy(records, "name").values()]
		.filter((item) => item.status === "active")
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
	pi.registerTool({
		name: HARNESS_BOOTSTRAP_TOOL,
		label: "Task-local harness compatibility entry",
		description: "Compatibility-only activation helper. Direct task-local creation tools are already exposed from the first treatment request; this helper is not required, does not create content, and never waits for a finding or repeated operation. The component names are activation aliases, not additional persistent harness types; only system_prompt, skill, memory, tool, and subagent are routable components.",
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
				memory: ["task_memory"],
				system_prompt: ["task_system_prompt"],
				skill: ["task_skill", "read"],
				tool: ["task_tool"],
				subagent: ["task_subagent", "delegate_task"],
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
	const resourceIsFocused = (kind: string, item: Record<string, any>) =>
		focusedResourceRefs === undefined || resourceRefVariants(kind, item).some((ref) => focusedResourceRefs?.has(ref));
	const resourceIsExplicitlyFocused = (kind: string, item: Record<string, any>) =>
		focusedResourceRefs !== undefined && resourceIsFocused(kind, item);
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
	let lastHarnessTriggerSignature = "";
	let harnessOpportunityCounter = nextCounter(
		readJsonl("task-harness-opportunities.jsonl"), "opportunity_id",
	);

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
		if (event.toolName !== "read") return {};
		const rawPath = (event.input as Record<string, unknown> | undefined)?.path;
		if (typeof rawPath !== "string") return {};
		const path = resolve(rawPath);
			const skill = [...skills.values()].find((item) => resolve(item.file) === path);
			if (!skill) return {};
			// Reading the file is the skill's explicit use boundary.  Projection of
			// its index/instructions is context exposure; this event records that the
			// Agent actually opened the task-local instructions.
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
		let routeVersion = Number(current.version ?? 1) + 1;
		append("auto-research-harness-routes.jsonl", {
			...current, version: routeVersion, route_status: "applying",
			application_tool_call_id: toolCallId, application_started_at: new Date().toISOString(),
		});
		const stepResults: Record<string, unknown>[] = [];
		let failed = false;
		for (const step of [...current.steps].sort((left: any, right: any) => Number(left.order) - Number(right.order))) {
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
	const assessHarnessEffect = async (toolCallId: string, input: Record<string, any>) => {
		const decisionId = String(input.decision_id ?? "");
		const observationRefs = Array.isArray(input.observation_refs) ? input.observation_refs.map(String) : [];
		const decision = readJsonl("harness-decisions.jsonl").find((item) => item.decision_id === decisionId);
		if (!decision) throw new Error("unknown decision_id");
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
		dependencies.pendingAssessments.set(assessment.effect_assessment_id, assessment);
		return { content: [{ type: "text", text: JSON.stringify(assessment) }], details: assessment };
	};
	// Auto-Research invokes this internal callback after child approval.  The
	// public task_harness(action=apply_route) remains available for explicit
	// replay/recovery, but normal parent flow no longer needs to copy route_ref
	// and hash out of the returned capsule.
	registerNativeHarnessRouteApplier(pi, applyCompiledRoute);

	const statusTool = {
		name: "task_harness_status",
		label: "Task-local harness status",
		description: "Inspect which task-local research and self-harness modules are available in this Pi session, their mutable entrypoints, and the current active tool set. Read-only; it never changes execution.",
		parameters: Type.Object({ request: Type.String() }),
		async execute() {
			const active = new Set(pi.getActiveTools());
			const registeredTools = new Set(pi.getAllTools().map((tool) => tool.name));
			const authorized = authorizedTools();
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
				.filter((item) => item.status === "active")
				.map((item) => ({
					key: item.key, version: item.version, resource_ref: `memory:${item.memory_id ?? item.key}@v${item.version}`,
					use: "Automatically projected into the next context; call task_memory(action=inspect,key=...) for the full value.",
				}));
			const activeSystemPrompts = [...systemPrompts.values()]
				.filter((item) => item.status === "active")
				.map((item) => ({ name: item.name, version: item.version,
					resource_ref: `system_prompt:${item.segment_id}@v${item.version}`,
					use: "Appended to later Pi system prompts through before_agent_start." }));
			const activeSkills = [...skills.values()]
				.filter((item) => item.status === "active")
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
		description: "Task-local decision-support control plane. Inspect or focus saved resources, activate selected native entries, and apply hash-bound routes. Every ARC decision cycle still ends with one native arc_action, but action is the final call rather than the first step. It never loads native skills and starts with an empty portfolio.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("start"), Type.Literal("inspect"), Type.Literal("enable"), Type.Literal("activate"), Type.Literal("focus"), Type.Literal("apply_route"), Type.Literal("assess_effect")]),
			enabled_tools: Type.Optional(Type.Array(Type.String())),
			resource_refs: Type.Optional(Type.Array(Type.String())),
				route_ref: Type.Optional(Type.String()),
				expected_delivery_hash: Type.Optional(Type.String()),
				decision_id: Type.Optional(Type.String()),
				observation_refs: Type.Optional(Type.Array(Type.String())),
				verdict: Type.Optional(Type.String()),
				consequence: Type.Optional(Type.String()),
				remaining_uncertainty: Type.Optional(Type.String()),
			}),
		async execute(toolCallId, params) {
			const admission = admitTaskLocalOperation("task_harness");
			if (admission) return admission;
			if (params.action === "apply_route") return applyCompiledRoute(toolCallId, params as Record<string, any>);
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
						message: "The task-local self-harness is already started. Use the component tools or task_harness(action=inspect/focus); do not repeat kickoff.",
					};
					return { content: [{ type: "text", text: JSON.stringify(status) }], details: status };
				}
				harnessStarted = true;
				const supported = new Set(pi.getAllTools().map((tool) => tool.name));
				const entry = {
					format: "task-local-self-harness-entry-v1",
					status: "unlocked",
					active_resources: activeResources,
					creation_calls: [
						"task_memory(action=upsert)",
						"task_system_prompt(action=create)", "task_skill(action=create)",
						...(dependencies.taskToolAdapter && supported.has("task_tool") ? ["task_tool(action=create)"] : []),
						...(supported.has("task_subagent") && supported.has("delegate_task")
							? ["task_subagent(action=create)", "delegate_task"] : []),
					],
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
					memory: "task_memory", skill: "task_skill",
					tool: "task_tool", subagent: "task_subagent", delegate: "delegate_task",
					research: "research_resource",
					status: "task_harness_status", policy: "task_tool_policy",
					validation: "task_validation", assessment: "assess_harness_effect",
					compaction: OBSERVATION_COMPACTION_TOOL,
				};
				// Accept resource-kind shorthands in addition to exact tool names.
				// Models naturally emit `memory` after reading the portfolio; the
				// control plane should resolve that to the real callable entry rather
				// than producing an avoidable error and losing a decision turn.
				const requested = (params.enabled_tools ?? []).map((name) => aliases[name] ?? name);
				// Selecting a skill resource also selects its confined reader.  Selecting
				// the task-tool portfolio restores every persisted active dynamic tool so
				// a new Pi session can use previously-created tools without a separate
				// resource-level `use` operation.
				if (requested.includes("task_skill") && pi.getAllTools().some((tool) => tool.name === "read")) {
					requested.push("read");
				}
				if (requested.includes("task_tool")) {
					const latestTaskTools = latestBy(readJsonl("task-tools.jsonl"), "name");
					for (const item of latestTaskTools.values()) {
						if (item.status === "active" && typeof item.exposed_name === "string") requested.push(item.exposed_name);
					}
				}
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
		description: "Create, revise, retire, or inspect task-local memory. Only summaries and versioned metadata are projected; task_resource reads full versions in pages. For a new key omit target_version; for update/retire target_version is the CURRENT version, not the new version. Optional append_content builds longer memory in small writes. A summary is agent-authored, not verified truth; no finding is required before creation.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("upsert"), Type.Literal("retire"), Type.Literal("inspect")]),
			key: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1, description: "Current version being edited; runtime increments it after success." })),
			content: Type.Optional(Type.String()),
			append_content: Type.Optional(Type.String()),
			summary: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			pinned: Type.Optional(Type.Boolean()),
			projection: Type.Optional(Type.Object({
				channel: Type.Literal("task_prompt"),
				prompt_text: Type.Optional(Type.String()),
				activation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
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
			if (previous && Number(p.target_version) !== previous.version) return versionConflict("memory", previous, p.target_version);
			if (!previous && p.target_version !== undefined) throw new Error("target_version is only valid for an existing memory");
			const status = p.action === "retire" ? "retired" : "active";
			if (p.content !== undefined && p.append_content !== undefined) throw new Error("choose content replacement or append_content, not both");
			const content = p.append_content !== undefined
				? `${previous?.content ?? ""}${String(p.append_content)}`
				: String(p.content ?? previous?.content ?? "").trim();
			if (status === "active" && !content) throw new Error("active memory requires content");
			const decisionId = dependencies.allocateDecisionId();
			const record: MemoryRecord = {
				memory_id: previous?.memory_id ?? `memory-${++memoryCounter}`,
				summary: p.summary === undefined ? undefined : String(p.summary),
				key,
				version: (previous?.version ?? 0) + 1,
				status,
				content,
				scope: String(p.scope ?? previous?.scope ?? "current task"),
				basis_refs: Array.isArray(p.basis_refs) ? resolveBasisRefs(p.basis_refs) : previous?.basis_refs ?? [],
				pinned: Boolean(p.pinned ?? previous?.pinned ?? false),
				...(p.projection ? {
					projection: {
						channel: "task_prompt" as const,
						...(p.projection.prompt_text !== undefined ? { prompt_text: String(p.projection.prompt_text) } : {}),
						...(p.projection.activation && typeof p.projection.activation === "object" && !Array.isArray(p.projection.activation)
							? { activation: p.projection.activation as ActivationCondition } : {}),
					},
				} : previous?.projection ? { projection: previous.projection } : {}),
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
			const decisionId = dependencies.allocateDecisionId();
			const record: SystemPromptRecord = {
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
		const active = [...systemPrompts.values()]
			.filter((item) => item.status === "active")
			.sort((left, right) => left.name.localeCompare(right.name));
		if (!active.length) return {};
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
		const overlay = renderTaskSystemPromptOverlay(active);
		return { systemPrompt: `${event.systemPrompt}\n\n# Task-local system-prompt overlay\n${overlay}` };
	});

	registerRoutableTool({
		name: "task_skill",
		label: "Task-local Pi skill",
		description: "Create, revise, retire, or inspect a task-local Pi-format SKILL.md. Active skill indexes enter later Pi contexts and the skill is usable after read returns its instructions. The Agent may create or update a skill directly from a task observation; no finding is required. Skills are task-local context resources; native skill discovery and loading are disabled. If research actually motivates a change, cite its exact finding, candidate, or observation identifier in basis_refs; an empty basis remains valid but is not research-linked.",
		parameters: Type.Object({
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
			const path = join(skillsDir, name, "SKILL.md");
			const decisionId = dependencies.allocateDecisionId();
			const record: SkillRecord = {
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
			decision_id: Type.String(),
			observation_refs: Type.Array(Type.String(), { minItems: 1 }),
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
		for (const item of [...systemPrompts.values()].filter((entry) => entry.status === "active")) {
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
		const latestTaskToolsForPrompt = latestBy(readJsonl("task-tools.jsonl"), "name");
		const latestSubagentsForPrompt = latestBy(readJsonl("task-subagents.jsonl"), "name");
		const resourceCounts = {
			memory: [...memories.values()].filter((item) => item.status === "active").length,
			system_prompt: [...systemPrompts.values()].filter((item) => item.status === "active").length,
			skills: [...skills.values()].filter((item) => item.status === "active").length,
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
			.filter((item) => item.status === "active" && resourceIsFocused("memory", item))
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
		const latestCheckpoint = readJsonl("task-checkpoint.json").at(-1) ?? {};
		const projectionState: Record<string, unknown> = {
			checkpoint: latestCheckpoint,
			environment: latestCheckpoint.latest_environment ?? {},
			assertions: latestCheckpoint.assertions ?? {},
		};
		const activeTaskPromptMemories = [...memories.values()]
			.filter((item) => item.status === "active"
				&& item.projection?.channel === "task_prompt"
				&& activationMatches(item.projection.activation, projectionState))
			.sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.recordedAt.localeCompare(right.recordedAt))
			.map((item) => ({
				memory_id: item.memory_id,
				key: item.key,
				version: item.version,
				content: item.projection?.prompt_text ?? item.content,
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
		if (activeTaskPromptMemories.length) {
			resources.push({
				role: "user",
				content: [{ type: "text", text: `Active dynamic task/user prompt knowledge: ${JSON.stringify(activeTaskPromptMemories)}` }],
				timestamp: Date.now(),
			});
		}
		const activeSkills = [...skills.values()]
			.filter((item) => item.status === "active" && existsSync(item.file) && resourceIsFocused("skill", item))
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
		// Surface a compact, neutral trigger whenever a component is still missing.
		// Earlier versions waited for three observations and a repeated operation,
		// which made that observation pattern an accidental creation gate. The
		// trigger never creates a resource or requires one; the Agent still decides
		// whether to act and must validate any change. Exclude observation count and
		// operation counts from the signature so an unchanged surface is not spammed
		// into every long ARC turn; creating/retiring a component or first seeing a
		// repeated operation exposes the next prompt.
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
			missing_components: missingComponents,
			repeated_operation_tools: repeatedOperations.map(([name]) => name),
		});
		const initialSurface = executionObservations.length === 0;
		const repeatedOperationSurface = repeatedOperations.length > 0;
		// The opportunity message is informational only.  It never gates a native
		// mutation, and it must not wait for a fixed number of observations or
		// repeated operations: the Agent decides when the available evidence is
		// sufficient and may call any registered task_* tool from the first turn.
		if (missingComponents.length && triggerSignature !== lastHarnessTriggerSignature) {
			lastHarnessTriggerSignature = triggerSignature;
			append("task-harness-opportunities.jsonl", {
				opportunity_id: `harness-opportunity-${++harnessOpportunityCounter}`,
				trigger: initialSurface ? "initial_surface" : repeatedOperationSurface ? "repeated_operation" : "missing_component_surface",
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
		const signature = JSON.stringify({
			pendingEffects: pendingEffects.map((item) => [item.decision_id, item.native_exposure_count]),
			activeMemories,
			dynamicTaskPromptMemories: activeTaskPromptMemories,
			systemPrompts: [...systemPrompts.values()].filter((item) => item.status === "active")
				.map((item) => [item.segment_id, item.version]),
			skills: activeSkills.map((item) => [item.skill_id, item.version]),
			taskTools: activeTaskTools.map((item) => [item.name, item.version, item.invocation_count]),
			subagents: activeSubagents.map((item) => [item.name, item.version, item.invocation_count, item.cumulative_cost]),
		});
		if (resources.length && signature !== lastResourceSignature) {
			lastResourceSignature = signature;
			append("task-harness-context-exposures.jsonl", {
				exposure_id: `task-context-${Date.now()}`,
				pending_effect_decisions: pendingEffects.map((item) => ({
					decision_id: item.decision_id,
					native_exposure_count: item.native_exposure_count,
				})),
				memory_versions: activeMemories.map((item) => ({ memory_id: item.memory_id, version: item.version })),
				dynamic_task_prompt_memory_versions: activeTaskPromptMemories.map((item) => ({ memory_id: item.memory_id, version: item.version })),
				system_prompt_versions: [...systemPrompts.values()].filter((item) => item.status === "active")
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
		return resources.length ? { messages: [...event.messages, ...resources] } : {};
	});

}
