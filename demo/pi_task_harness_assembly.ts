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
	selection_mode: "explicit" | "jev";
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
	selectionMode?: "explicit" | "jev";
	resolveComponentRef: (reference: string) => string | undefined;
	resolveSourceRef: (reference: string) => string | undefined;
	recordedAt?: string;
};

type AssemblyConflict = {
	format: "task-harness-assembly-version-conflict-v1";
	applied: false;
	requested_revision: number | null;
	current_revision: number;
	recovery: string;
};

type AssemblyInputIssue = { path: string; message: string; allowed?: readonly string[] };

type AssemblyInputError = {
	format: "task-harness-assembly-input-error-v1";
	applied: false;
	retryable: true;
	requires_parent_confirmation: true;
	errors: AssemblyInputIssue[];
	repair_template: Record<string, unknown>;
	instruction: string;
};

class HarnessAssemblyConflictError extends Error {
	readonly details: AssemblyConflict;
	constructor(requested: number | null, current: number) {
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

class HarnessAssemblyInputError extends Error {
	readonly issues: AssemblyInputIssue[];
	constructor(issues: AssemblyInputIssue[]) {
		super(issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
		this.name = "HarnessAssemblyInputError";
		this.issues = issues;
	}
}

function assemblyTextIssue(value: unknown, path: string): AssemblyInputIssue | undefined {
	return typeof value !== "string" || !value.trim()
		? {path,message:"Expected a nonempty string."} : undefined;
}

function validateAssemblySemanticInput(
	input: CreateAssemblyInput,
	previous: HarnessAssembly | undefined,
	resolveComponentRef: (reference: string) => string | undefined,
	resolveSourceRef: (reference: string) => string | undefined,
) {
	const issues: AssemblyInputIssue[] = [];
	const selected = input.selected_resource_refs === undefined
		? previous?.selected_resource_refs ?? [] : input.selected_resource_refs;
	if (!Array.isArray(selected)) issues.push({path:"selected_resource_refs",message:"Expected an array of exact current component refs."});
	else for (const [index, value] of selected.entries()) {
		const path = `selected_resource_refs[${index}]`;
		if (typeof value !== "string" || !value.trim()) issues.push({path,message:"Expected a nonempty exact component ref."});
		else if (!/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(value)) issues.push({path,message:"Expected an exact kind:name@vN reference."});
		else if (!resolveComponentRef(value)) issues.push({path,message:`Resource is not a current eligible Harness component: ${value}`});
	}
	const decision = input.decision;
	if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
		issues.push({path:"decision",message:"Expected an object with basis_refs, reason, and expected."});
	} else {
		const item = decision as Record<string,unknown>;
		if (!Array.isArray(item.basis_refs) || item.basis_refs.some(ref => typeof ref !== "string"))
			issues.push({path:"decision.basis_refs",message:"Expected an array of strings."});
		for (const field of ["reason", "expected"] as const) {
			const issue = assemblyTextIssue(item[field], `decision.${field}`);
			if (issue) issues.push(issue);
		}
	}
	const contributions = input.prompt_contributions === undefined
		? previous?.prompt_contributions ?? [] : input.prompt_contributions;
	if (!Array.isArray(contributions)) issues.push({path:"prompt_contributions",message:"Expected an array."});
	else for (const [index, value] of contributions.entries()) {
		const path = `prompt_contributions[${index}]`;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			issues.push({path,message:"Expected an object."});
			continue;
		}
		const item = value as Record<string,unknown>;
		if (item.contribution_id !== undefined) {
			const issue = assemblyTextIssue(item.contribution_id, `${path}.contribution_id`);
			if (issue) issues.push(issue);
		}
		const sourceIssue = assemblyTextIssue(item.source_ref, `${path}.source_ref`);
		if (sourceIssue) issues.push(sourceIssue);
		else {
			const source = String(item.source_ref);
			if (!/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(source)) issues.push({path:`${path}.source_ref`,message:"Expected an exact kind:name@vN reference."});
			else if (!resolveSourceRef(source)) issues.push({path:`${path}.source_ref`,message:`Unknown prompt contribution source: ${source}`});
		}
		const layer = typeof item.layer === "string" ? item.layer : "";
		if (!(TASK_PROMPT_LAYERS as readonly string[]).includes(layer)) issues.push({
			path:`${path}.layer`, message:"Invalid task-prompt layer.", allowed:TASK_PROMPT_LAYERS,
		});
		const contentIssue = assemblyTextIssue(item.content, `${path}.content`);
		if (contentIssue) issues.push(contentIssue);
		if (item.priority !== undefined && !Number.isSafeInteger(item.priority))
			issues.push({path:`${path}.priority`,message:"Expected an integer."});
		for (const field of ["depends_on_refs", "basis_refs"] as const) if (item[field] !== undefined
			&& (!Array.isArray(item[field]) || (item[field] as unknown[]).some(ref => typeof ref !== "string")))
			issues.push({path:`${path}.${field}`,message:"Expected an array of strings."});
		if (item.activation !== undefined && (!item.activation || typeof item.activation !== "object" || Array.isArray(item.activation)))
			issues.push({path:`${path}.activation`,message:"Expected an object."});
		if (item.reconsider_when !== undefined && typeof item.reconsider_when !== "string")
			issues.push({path:`${path}.reconsider_when`,message:"Expected a string."});
	}
	if (issues.length) throw new HarnessAssemblyInputError(issues);
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
		throw new HarnessAssemblyInputError([{
			path:`prompt_contributions[${index}].layer`,
			message:"Invalid task-prompt layer.",
			allowed:TASK_PROMPT_LAYERS,
		}]);
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

export function assemblyInputErrorDetails(
	error: unknown,
	input: CreateAssemblyInput,
	previous?: HarnessAssembly,
): AssemblyInputError {
	if (!(error instanceof HarnessAssemblyInputError)) throw error;
	return {
		format:"task-harness-assembly-input-error-v1",
		applied:false,
		retryable:true,
		requires_parent_confirmation:true,
		errors:error.issues,
		repair_template:{
			action:"assemble",
			expected_assembly_revision:input.expected_assembly_revision ?? Number(previous?.revision ?? 0),
			selected_resource_refs:input.selected_resource_refs ?? previous?.selected_resource_refs ?? [],
			prompt_contributions:input.prompt_contributions ?? previous?.prompt_contributions ?? [],
			decision:input.decision,
		},
		instruction:"No assembly was applied. Preserve the parent-selected refs, CAS revision, decision, and every contribution exactly; the parent must choose a legal layer and confirm the complete retry. Runtime will not delete, rewrite, or auto-classify a contribution.",
	};
}

export function assemblyInputContract(previous?: HarnessAssembly) {
	return {
		input_schema:{
			required:["action", "expected_assembly_revision", "selected_resource_refs", "decision"],
			action:"assemble",
			expected_assembly_revision:"integer CAS revision from current_assembly, or 0 before the first assembly",
			selected_resource_refs:"array of exact current eligible component refs chosen by main",
			decision:{basis_refs:"array of exact evidence/resource refs",reason:"nonempty parent reason",expected:"nonempty observable expectation"},
			prompt_contributions:"optional array; omission preserves prior contributions, [] explicitly clears them",
			task_prompt_layers:TASK_PROMPT_LAYERS,
		},
		select_only_template:{
			action:"assemble",
			expected_assembly_revision:Number(previous?.revision ?? 0),
			selected_resource_refs:previous?.selected_resource_refs ?? ["<exact current eligible component ref>"],
			decision:{basis_refs:["<exact existing ref>"],reason:"<why these exact components apply now>",expected:"<observable result at the next use>"},
		},
		optional_prompt_contribution_template:{
			contribution_id:"<stable-lowercase-id>",
			source_ref:"<exact existing source ref>",
			layer:"<choose one task_prompt_layers value>",
			content:"<parent-authored contribution text>",
			priority:0,
			depends_on_refs:[],
			basis_refs:[],
			reconsider_when:"<when main should revisit this contribution>",
		},
		instruction:"Use the select-only template when exact component selection is sufficient. Add prompt_contributions only when main independently chooses source-linked task-prompt text; runtime never authors or classifies that text.",
	};
}

/** Extend a parent's composition without letting obsolete selections block creation.
 * Never choose replacements: explicit assembly inputs still use the strict validator.
 */
export function prepareHarnessCreationAssembly(
	previous: HarnessAssembly | undefined,
	resolveComponentRef: (reference: string) => string | undefined,
	resolveSourceRef: (reference: string) => string | undefined,
) {
	const removed_resource_refs: string[] = [];
	const selected_resource_refs = (previous?.selected_resource_refs ?? []).flatMap(reference => {
		const current = resolveComponentRef(reference);
		if (current) return [current];
		removed_resource_refs.push(reference);
		return [];
	});
	const selected = new Set(selected_resource_refs);
	const removed_prompt_contribution_ids: string[] = [];
	const prompt_contributions = (previous?.prompt_contributions ?? []).filter(contribution => {
		const source = resolveSourceRef(contribution.source_ref);
		const componentSource = (HARNESS_COMPONENT_KINDS as readonly string[])
			.includes(contribution.source_ref.split(":", 1)[0]);
		if (source && (!componentSource || selected.has(source))
			&& contribution.depends_on_refs.every(reference => Boolean(resolveSourceRef(reference)))) return true;
		removed_prompt_contribution_ids.push(contribution.contribution_id);
		return false;
	});
	return {
		selection: { expected_assembly_revision: previous?.revision ?? 0,
			selected_resource_refs, prompt_contributions },
		cleanup: { removed_resource_refs, removed_prompt_contribution_ids },
	};
}

export function createHarnessAssembly(options: CreateAssemblyOptions): HarnessAssembly {
	const currentRevision = Number(options.previous?.revision ?? 0);
	if (options.input.expected_assembly_revision === undefined) {
		throw new HarnessAssemblyConflictError(null, currentRevision);
	}
	if (Number(options.input.expected_assembly_revision) !== currentRevision) {
		throw new HarnessAssemblyConflictError(Number(options.input.expected_assembly_revision), currentRevision);
	}
	validateAssemblySemanticInput(options.input, options.previous, options.resolveComponentRef, options.resolveSourceRef);
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
	const selectedSet = new Set(selected);
	const contributionIds = new Set<string>();
	for (const item of contributions) {
		if (contributionIds.has(item.contribution_id)) throw new Error(`duplicate prompt contribution: ${item.contribution_id}`);
		const sourceKind = item.source_ref.split(":", 1)[0];
		if ((HARNESS_COMPONENT_KINDS as readonly string[]).includes(sourceKind)
			&& !selectedSet.has(item.source_ref)) {
			throw new Error(`prompt contribution component source must also be selected: ${item.source_ref}`);
		}
		contributionIds.add(item.contribution_id);
	}
	return {
		format: "task-harness-assembly-v1",
		assembly_id: "task-harness-assembly",
		revision: currentRevision + 1,
		status: "active",
		selection_mode: options.selectionMode ?? "explicit",
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
	// Pool membership never means runtime selection. Until the parent creates
	// the first explicit assembly, no component content or capability is active.
	if (!assembly) return false;
	const selected = new Set(assembly.selected_resource_refs);
	return variants.some(reference => selected.has(reference));
}
