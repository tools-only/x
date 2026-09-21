/**
 * Pure domain boundary for task-local Harness assembly.
 *
 * A component pool contains committed immutable component versions. An assembly
 * selects exact current versions from that pool for one or more later provider
 * requests. `task_prompt` is an output channel of the assembly, not a component
 * kind and not a synonym for memory.
 *
 * This module performs validation and deterministic selection only. It contains
 * no Pi calls, model calls, filesystem access, environment actions, or research
 * scheduling.
 */

export const HARNESS_COMPONENT_KINDS = [
	"memory", "system_prompt", "skill", "tool", "subagent",
] as const;
export type HarnessComponentKind = typeof HARNESS_COMPONENT_KINDS[number];

export const TASK_PROMPT_LAYERS = [
	"task_policy", "method", "working_plan", "hypothesis", "task_state", "research_inbox",
] as const;
export type TaskPromptLayer = typeof TASK_PROMPT_LAYERS[number];

export type HarnessDecision = {
	basis_refs: string[];
	reason: string;
	expected: string;
};

export type PromptContribution = {
	contribution_id: string;
	source_ref: string;
	layer: TaskPromptLayer;
	content: string;
	priority: number;
	activation?: Record<string, unknown>;
	depends_on_refs: string[];
	basis_refs: string[];
	reconsider_when: string;
};

export type HarnessAssembly = {
	format: "task-harness-assembly-v1";
	assembly_id: "task-harness-assembly";
	revision: number;
	status: "active";
	selection_mode: "explicit";
	selected_resource_refs: string[];
	prompt_contributions: PromptContribution[];
	decision: HarnessDecision;
	recordedAt: string;
};

export type HarnessPoolEntry = {
	kind: HarnessComponentKind;
	resource_ref: string;
	name: string;
	version: number;
	status: string;
	availability: string;
	eligible: boolean;
	reasons: string[];
};

type CreateAssemblyInput = {
	expected_assembly_revision?: number;
	selected_resource_refs?: unknown;
	prompt_contributions?: unknown;
	decision?: unknown;
};

type CreateAssemblyOptions = {
	input: CreateAssemblyInput;
	previous?: HarnessAssembly;
	resolveComponentRef: (reference: string) => string | undefined;
	resolveSourceRef: (reference: string) => string | undefined;
	recordedAt?: string;
};

type AssemblyConflict = {
	format: "task-harness-assembly-version-conflict-v1";
	applied: false;
	requested_revision: number;
	current_revision: number;
	recovery: string;
};

class HarnessAssemblyConflictError extends Error {
	readonly details: AssemblyConflict;
	constructor(requested: number, current: number) {
		super(`assembly revision conflict: expected ${requested}, current ${current}`);
		this.name = "HarnessAssemblyConflictError";
		this.details = {
			format: "task-harness-assembly-version-conflict-v1",
			applied: false,
			requested_revision: requested,
			current_revision: current,
			recovery: "Inspect the current component pool and assembly, merge the intended selection, then retry with the current revision. No assembly was applied.",
		};
	}
}

function requiredText(value: unknown, field: string): string {
	const result = String(value ?? "").trim();
	if (!result) throw new Error(`${field} is required`);
	return result;
}

function exactReference(value: unknown, field: string): string {
	const result = requiredText(value, field);
	if (!/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(result)) {
		throw new Error(`${field} must be an exact kind:name@vN reference`);
	}
	return result;
}

function uniqueStrings(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
		throw new Error(`${field} must be an array of strings`);
	}
	return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

function normalizeDecision(value: unknown): HarnessDecision {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("assembly decision is required");
	}
	const input = value as Record<string, unknown>;
	return {
		basis_refs: uniqueStrings(input.basis_refs, "decision.basis_refs"),
		reason: requiredText(input.reason, "decision.reason"),
		expected: requiredText(input.expected, "decision.expected"),
	};
}

function normalizeContribution(
	value: unknown,
	index: number,
	resolveSourceRef: (reference: string) => string | undefined,
): PromptContribution {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`prompt_contributions.${index} must be an object`);
	}
	const input = value as Record<string, unknown>;
	const contributionId = requiredText(input.contribution_id ?? `prompt-contribution-${index + 1}`,
		`prompt_contributions.${index}.contribution_id`);
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(contributionId) || contributionId.includes("--")) {
		throw new Error(`prompt_contributions.${index}.contribution_id must use lowercase letters, digits, or single hyphens`);
	}
	const source = exactReference(input.source_ref, `prompt_contributions.${index}.source_ref`);
	const sourceRef = resolveSourceRef(source);
	if (!sourceRef) throw new Error(`unknown prompt contribution source: ${source}`);
	const layer = String(input.layer ?? "");
	if (!(TASK_PROMPT_LAYERS as readonly string[]).includes(layer)) {
		throw new Error(`prompt_contributions.${index}.layer is invalid`);
	}
	const priority = input.priority === undefined ? 0 : Number(input.priority);
	if (!Number.isSafeInteger(priority)) throw new Error(`prompt_contributions.${index}.priority must be an integer`);
	const dependencies = uniqueStrings(input.depends_on_refs, `prompt_contributions.${index}.depends_on_refs`)
		.map(reference => exactReference(reference, `prompt_contributions.${index}.depends_on_refs`));
	for (const dependency of dependencies) {
		if (!resolveSourceRef(dependency)) throw new Error(`unknown prompt contribution dependency: ${dependency}`);
	}
	const activation = input.activation;
	if (activation !== undefined && (!activation || typeof activation !== "object" || Array.isArray(activation))) {
		throw new Error(`prompt_contributions.${index}.activation must be an object`);
	}
	return {
		contribution_id: contributionId,
		source_ref: sourceRef,
		layer: layer as TaskPromptLayer,
		content: requiredText(input.content, `prompt_contributions.${index}.content`),
		priority,
		...(activation ? { activation: activation as Record<string, unknown> } : {}),
		depends_on_refs: dependencies,
		basis_refs: uniqueStrings(input.basis_refs, `prompt_contributions.${index}.basis_refs`),
		reconsider_when: String(input.reconsider_when ?? "the source, dependency, scope, or current task situation changes").trim(),
	};
}

export function createHarnessAssembly(options: CreateAssemblyOptions): HarnessAssembly {
	const currentRevision = Number(options.previous?.revision ?? 0);
	if (options.input.expected_assembly_revision !== undefined
		&& Number(options.input.expected_assembly_revision) !== currentRevision) {
		throw new HarnessAssemblyConflictError(Number(options.input.expected_assembly_revision), currentRevision);
	}
	const rawSelected = options.input.selected_resource_refs === undefined
		? options.previous?.selected_resource_refs ?? []
		: uniqueStrings(options.input.selected_resource_refs, "selected_resource_refs");
	const selected = rawSelected.map(reference => {
		const exact = exactReference(reference, "selected_resource_refs");
		const resolved = options.resolveComponentRef(exact);
		if (!resolved) throw new Error(`resource is not a current eligible Harness component: ${exact}`);
		return resolved;
	});
	const rawContributions = options.input.prompt_contributions === undefined
		? options.previous?.prompt_contributions ?? []
		: options.input.prompt_contributions;
	if (!Array.isArray(rawContributions)) throw new Error("prompt_contributions must be an array");
	const contributions = rawContributions.map((item, index) =>
		normalizeContribution(item, index, options.resolveSourceRef));
	const contributionIds = new Set<string>();
	for (const item of contributions) {
		if (contributionIds.has(item.contribution_id)) throw new Error(`duplicate prompt contribution: ${item.contribution_id}`);
		contributionIds.add(item.contribution_id);
	}
	return {
		format: "task-harness-assembly-v1",
		assembly_id: "task-harness-assembly",
		revision: currentRevision + 1,
		status: "active",
		selection_mode: "explicit",
		selected_resource_refs: [...new Set(selected)],
		prompt_contributions: contributions,
		decision: normalizeDecision(options.input.decision),
		recordedAt: options.recordedAt ?? new Date().toISOString(),
	};
}

export function assemblyConflictDetails(error: unknown): AssemblyConflict {
	if (error instanceof HarnessAssemblyConflictError) return error.details;
	throw error;
}

export function latestHarnessAssembly(records: Record<string, any>[]): HarnessAssembly | undefined {
	return records
		.filter(record => record?.format === "task-harness-assembly-v1" && record.status === "active")
		.sort((left, right) => Number(right.revision ?? 0) - Number(left.revision ?? 0))[0] as HarnessAssembly | undefined;
}

function readPath(value: unknown, path: string): unknown {
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function assemblyActivationMatches(condition: Record<string, any> | undefined, state: Record<string, unknown>): boolean {
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
			&& condition.value.some(candidate => JSON.stringify(candidate) === JSON.stringify(actual));
		return false;
	}
	if (type === "all") return Array.isArray(condition.conditions)
		&& condition.conditions.every(item => item && typeof item === "object" && assemblyActivationMatches(item, state));
	if (type === "any") return Array.isArray(condition.conditions)
		&& condition.conditions.some(item => item && typeof item === "object" && assemblyActivationMatches(item, state));
	if (type === "not") return condition.condition && typeof condition.condition === "object"
		? !assemblyActivationMatches(condition.condition, state) : false;
	if (type === "agent_asserted") {
		const assertion = readPath(state, `assertions.${String(condition.assertion_ref ?? "")}`);
		return condition.value === undefined ? assertion === true
			: JSON.stringify(assertion) === JSON.stringify(condition.value);
	}
	return false;
}

export function renderPromptContributions(
	assembly: HarnessAssembly | undefined,
	state: Record<string, unknown>,
	referenceAvailable: (reference: string) => boolean,
) {
	const selected: PromptContribution[] = [];
	const suppressed: Array<{ contribution_id: string; source_ref: string; reason: string }> = [];
	for (const contribution of assembly?.prompt_contributions ?? []) {
		if (!referenceAvailable(contribution.source_ref)) {
			suppressed.push({ contribution_id: contribution.contribution_id, source_ref: contribution.source_ref,
				reason: `source_unavailable:${contribution.source_ref}` });
			continue;
		}
		const unavailable = contribution.depends_on_refs.find(reference => !referenceAvailable(reference));
		if (unavailable) {
			suppressed.push({ contribution_id: contribution.contribution_id, source_ref: contribution.source_ref,
				reason: `dependency_unavailable:${unavailable}` });
			continue;
		}
		if (!assemblyActivationMatches(contribution.activation, state)) {
			suppressed.push({ contribution_id: contribution.contribution_id, source_ref: contribution.source_ref,
				reason: "activation_not_matched" });
			continue;
		}
		selected.push(contribution);
	}
	selected.sort((left, right) => TASK_PROMPT_LAYERS.indexOf(left.layer) - TASK_PROMPT_LAYERS.indexOf(right.layer)
		|| right.priority - left.priority || left.contribution_id.localeCompare(right.contribution_id));
	return { selected, suppressed };
}

export function assemblySelectsReference(assembly: HarnessAssembly | undefined, variants: string[]): boolean {
	if (!assembly) return true;
	const selected = new Set(assembly.selected_resource_refs);
	return variants.some(reference => selected.has(reference));
}
