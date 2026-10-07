/** Adapter-bounded task-local tools registered through Pi's public API. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { admitTaskLocalOperation } from "./pi_task_execution_admission.ts";
import { Type } from "typebox";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { memoryValidityContext, memoryValidityReasons, normalizeMemoryValidity, type MemoryValidity } from "./pi_memory_validity.ts";
import { versionConflict } from "./pi_task_resource_store.ts";
import { registerNativeHarnessExecutor } from "./pi_task_harness_route_runtime.ts";
import { assertTaskToolName, TASK_TOOL_PROGRAM_STEP_KINDS } from "./pi_task_tool_contract.ts";
import { assemblySelectsReference, latestHarnessAssembly } from "./pi_task_harness_assembly.ts";
import { methodUseRejection } from "./pi_research_method_runtime.ts";
import {
	evaluateTaskPureExpression, TASK_PURE_EXPRESSION_FORMAT,
	validateTaskPureExpressionInputAccess,
	type PureExpressionLimitRequest,
} from "./pi_task_pure_expression.ts";
import { validateTaskPureExpressionProgram, TASK_PURE_PYTHON_FORMAT, type PureSourceEvidence } from "./pi_task_pure_authoring.ts";
import { preparePureExpressionInput } from "./pi_task_pure_expression_host.ts";
import { assertTaskJsonSchemaValue, TaskJsonSchemaError, validateTaskJsonSchema } from "./pi_task_json_schema.ts";

export type TaskToolResult = {
	content?: Array<{ type: "text"; text: string }>;
	details?: unknown;
};

/** Fresh schema instances for both ordinary pure calls and publication trials. */
export function pureToolInvocationParameters() {
	return Type.Object({
		parameters: Type.Object({}, { additionalProperties: true }),
		bindings: Type.Array(Type.Object({
			name: Type.String(), ref: Type.String(),
			// The runtime also accepts integer segments; gateways require string items.
			path: Type.Array(Type.String()),
		}, { additionalProperties: false })),
	}, { additionalProperties: false });
}

export type TaskToolProgram = {
	steps: Array<Record<string, unknown>>;
} | {
	format: typeof TASK_PURE_EXPRESSION_FORMAT;
	expression: Record<string, unknown>;
	limits: PureExpressionLimitRequest;
};

export type TaskToolAdapter = {
	adapterId: string;
	permission: string;
	allowedImplementations?: readonly string[];
	/** Adapter-owned escape hatch for symbolic refs resolved by its own backend. */
	allowUnlistedImplementations?: boolean;
	execute: (
		implementationRef: string,
		input: Record<string, unknown>,
		context: { root: string; name: string; version: number },
	) => Promise<TaskToolResult>;
};

export type TaskToolDependencies = {
	root: string;
	append: (name: string, value: unknown) => void;
	allocateDecisionId: () => string;
	resolveBasisRefs?: (references: string[]) => string[];
	prepareResourceBindingAuthorization?: () => void;
};

type TaskToolRecord = {
	validity?: MemoryValidity;
	tool_id: string;
	name: string;
	version: number;
	status: "active" | "retired";
	availability?: "loaded" | "unloaded" | "suspended" | "retired";
	description: string;
	input_schema: Record<string, unknown>;
	output_schema?: Record<string, unknown>;
	program_sha256?: string;
	program_authored_sha256?: string;
	program_source_evidence?: PureSourceEvidence;
	program_limits_requested?: PureExpressionLimitRequest;
	program_limits_effective?: Record<string, number>;
	input_schema_sha256?: string;
	output_schema_sha256?: string;
	implementation_ref: string;
	program?: TaskToolProgram;
	adapter_id: string;
	permission: string;
	exposed_name: string;
	basis_refs: string[];
	decision_id: string;
	expected_effect: string;
	reconsider_when: string;
	routing_id?: string;
	source_approval_ref?: string;
	authoring_method_ref?: string;
	recordedAt: string;
};

function compactText(value: unknown, _maximum?: number): string {
	return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nextCounter(records: Record<string, unknown>[], key: string): number {
	let largest = 0;
	for (const record of records) {
		const match = String(record[key] ?? "").match(/(\d+)$/);
		if (match) largest = Math.max(largest, Number(match[1]));
	}
	return largest;
}

function readJsonl(root: string, name: string): Record<string, any>[] {
	const path = join(root, name);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" ? [value] : [];
		} catch {
			return [];
		}
	});
}

function objectSchema(value: unknown, fallback?: Record<string, unknown>): Record<string, unknown> {
	if (value === undefined && fallback) return fallback;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("input_schema must be a JSON object");
	}
	const schema = value as Record<string, unknown>;
	return schema;
}

function normalizeInput(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("task tool input must be a JSON object");
	}
	return value as Record<string, unknown>;
}

function pureProgram(program: TaskToolProgram | undefined): program is Extract<TaskToolProgram, { format: string }> {
	return Boolean(program && "format" in program && program.format === TASK_PURE_EXPRESSION_FORMAT);
}

function structuredPureFailure(error: unknown): Record<string, unknown> {
	const candidate = error as { toJSON?: () => unknown; code?: unknown; path?: unknown; message?: unknown; consumed?: unknown; effective_limits?: unknown };
	if (typeof candidate?.toJSON === "function") {
		const value = candidate.toJSON();
		if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	}
	return {
		format: "task-pure-expression-error-v1",
		code: typeof candidate?.code === "string" ? candidate.code : "invalid_program",
		message: error instanceof Error ? error.message : String(error),
		path: typeof candidate?.path === "string" ? candidate.path : "$",
		...(candidate?.consumed ? { consumed: candidate.consumed } : {}),
		...(candidate?.effective_limits ? { effective_limits: candidate.effective_limits } : {}),
	};
}

function immutableJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function jsonSha256(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function resultValue(result: TaskToolResult): unknown {
	const text = result.content?.map((item) => item.text).join("\n") ?? "";
	try { return text ? JSON.parse(text) : result.details ?? {}; } catch { return result.details ?? text; }
}

function semanticInvocationEvidence(input: Record<string, unknown>, result: TaskToolResult) {
	const output = resultValue(result);
	const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
		? result.details as Record<string, any> : {};
	const transformations = Array.isArray(details.transformations)
		? details.transformations.map(String) : [];
	const outputNotInput = JSON.stringify(output) !== JSON.stringify(input);
	return {
		semantic_effect_observed: outputNotInput,
		semantic_verification: {
			output_not_input: outputNotInput,
			transformations,
			representation: details.representation ?? null,
		},
	};
}

async function executeTaskProgram(
	program: TaskToolProgram,
	input: Record<string, unknown>,
	adapter: TaskToolAdapter,
	context: { root: string; name: string; version: number },
): Promise<TaskToolResult> {
	if (pureProgram(program)) throw new Error("pure expression programs require the host input boundary");
	if (!Array.isArray(program.steps) || !program.steps.length) throw new Error("task tool program requires at least one step");
	let value: unknown = input;
	let analysisOperation = "task_program";
	const transformations: string[] = [];
	const sourceRef = String(input.evidence_ref ?? input.source_ref ?? "");
	const sourceVersion = Number(input.source_version ?? 1);
	const source = (step: Record<string, unknown>): unknown => step.source === "input" ? input : value;
	const fieldValue = (item: unknown, field: string): unknown =>
		item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>)[field] : undefined;
	for (const step of program.steps) {
		// Accept the compact op/args spelling that agents commonly derive from
		// already-disclosed adapter tools, while persisting the original program
		// unchanged for auditability. These are syntax aliases only; authorization
		// still happens against the adapter implementation allowlist below.
		const kind = String(step.kind ?? step.op ?? "");
		if (!(TASK_TOOL_PROGRAM_STEP_KINDS as readonly string[]).includes(kind)) {
			throw new Error(`unknown task tool program step: ${kind}`);
		}
		if (kind === "adapter_call") {
			const implementationRef = String(step.implementation_ref ?? step.operation ?? "").trim();
			if (!implementationRef) throw new Error("adapter_call requires implementation_ref");
			const callInput = step.input === undefined
				? step.args === undefined ? input : normalizeInput(step.args)
				: normalizeInput(step.input);
			if (!adapter.allowedImplementations?.includes(implementationRef) && !adapter.allowUnlistedImplementations) {
				throw new Error(`implementation is not allowed by adapter: ${implementationRef}`);
			}
			value = resultValue(await adapter.execute(implementationRef, callInput, context));
			transformations.push(`adapter_call:${implementationRef}`);
			continue;
		}
		if (kind === "select") {
			const source = step.source === "input" ? input : objectValue(value, "select source");
			const fields = step.fields;
			if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) throw new Error("select requires string fields");
			value = Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(source, field)).map((field) => [field, source[field]]));
			transformations.push("select");
			continue;
		}
		if (kind === "count") {
			const source = step.source === "input" ? input : value;
			if (!Array.isArray(source)) throw new Error("count source must be an array");
			value = source.length;
			transformations.push("count");
			continue;
		}
		if (kind === "pick") {
			const source = step.source === "input" ? input : objectValue(value, "pick source");
			const field = String(step.field ?? "");
			if (!field) throw new Error("pick requires field");
			value = source[field];
			transformations.push("pick");
			continue;
		}
		if (kind === "filter") {
			const candidate = source(step);
			if (!Array.isArray(candidate)) throw new Error("filter source must be an array");
			const field = String(step.field ?? "");
			if (!field) throw new Error("filter requires field");
			value = candidate.filter((item) => {
				const actual = fieldValue(item, field);
				if (Object.prototype.hasOwnProperty.call(step, "equals") && JSON.stringify(actual) !== JSON.stringify(step.equals)) return false;
				if (Object.prototype.hasOwnProperty.call(step, "not_equals") && JSON.stringify(actual) === JSON.stringify(step.not_equals)) return false;
				if (step.exists === true && actual === undefined) return false;
				if (step.exists === false && actual !== undefined) return false;
				return true;
			});
			transformations.push("filter");
			continue;
		}
		if (kind === "map") {
			const candidate = source(step);
			if (!Array.isArray(candidate)) throw new Error("map source must be an array");
			const fields = step.fields;
			if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) throw new Error("map requires string fields");
			value = candidate.map((item) => Object.fromEntries(fields
				.filter((field) => fieldValue(item, field) !== undefined)
				.map((field) => [field, fieldValue(item, field)])));
			transformations.push("map");
			continue;
		}
		if (kind === "group_by") {
			const candidate = source(step);
			if (!Array.isArray(candidate)) throw new Error("group_by source must be an array");
			const field = String(step.field ?? "");
			if (!field) throw new Error("group_by requires field");
			const groups = new Map<string, { key: unknown; count: number; items: unknown[] }>();
			for (const item of candidate) {
				const key = fieldValue(item, field);
				const identity = JSON.stringify(key);
				const group = groups.get(identity) ?? { key, count: 0, items: [] };
				group.count += 1;
				group.items.push(item);
				groups.set(identity, group);
			}
			value = [...groups.values()];
			transformations.push("group_by");
			continue;
		}
		if (kind === "diff") {
			const before = objectValue(step.before ?? fieldValue(input, "before"), "diff before");
			const after = objectValue(step.after ?? fieldValue(input, "after"), "diff after");
			const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
			value = { changed: fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
				.map((field) => ({ field, before: before[field], after: after[field] })),
				unchanged: fields.filter((field) => JSON.stringify(before[field]) === JSON.stringify(after[field])) };
			analysisOperation = "diff";
			transformations.push("diff");
			continue;
		}
		if (kind === "summarize") {
			const candidate = source(step);
			value = Array.isArray(candidate)
				? { type: "array", count: candidate.length, sample: candidate }
				: candidate && typeof candidate === "object"
					? { type: "object", keys: Object.keys(candidate as object), key_count: Object.keys(candidate as object).length }
					: { type: typeof candidate, value: candidate };
			analysisOperation = "summary";
			transformations.push("summary");
			continue;
		}
		if (kind === "assert") {
			const candidate = source(step);
			const field = String(step.field ?? "");
			if (field && JSON.stringify(fieldValue(candidate, field)) !== JSON.stringify(step.equals)) throw new Error(String(step.message ?? `assertion failed for ${field}`));
			if (!field && step.truthy === true && !candidate) throw new Error(String(step.message ?? "assertion failed"));
			transformations.push("assert");
			continue;
		}
		if (kind === "emit_observation") {
			value = { format: "task-analysis-observation-v1", observation: source(step),
				provenance: { format: "task-evidence-provenance-v1", source_ref: sourceRef || null,
					source_version: sourceVersion, derived_ref: `analysis:${context.name}@v${context.version}`,
					operation: analysisOperation, transformations: [...transformations], page: null } };
			analysisOperation = "emit_observation";
			continue;
		}
		throw new Error(`unimplemented task tool program step: ${kind}`);
	}
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		details: { representation: "agent_defined_task_program", step_count: program.steps.length,
			analysis_operation: analysisOperation, transformations,
			...(sourceRef ? { provenance: { format: "task-evidence-provenance-v1", source_ref: sourceRef,
				source_version: sourceVersion, derived_ref: `analysis:${context.name}@v${context.version}`,
				operation: analysisOperation, transformations, page: null } } : {}) },
	};
}

export function installTaskLocalTools(
	pi: ExtensionAPI,
	dependencies: TaskToolDependencies,
	adapter: TaskToolAdapter,
): void {
	const root = resolve(dependencies.root);
	const taskScope = ensureTaskScope(root);
	mkdirSync(root, { recursive: true });
	if (!adapter.adapterId.trim() || !adapter.permission.trim()) {
		throw new Error("task tool adapter id and permission are required");
	}
	const allowedImplementations = new Set(adapter.allowedImplementations ?? []);
	// A task-local program may be pure (select/count/pick) or call an adapter
	// implementation. It does not require the adapter to predeclare a single
	// implementation for the whole tool; each adapter_call remains authorized.
	const implementationAllowed = (reference: string) =>
		allowedImplementations.has(reference) || adapter.allowUnlistedImplementations === true;
	const registerRoutableTool = (definition: any) => {
		pi.registerTool(definition);
		registerNativeHarnessExecutor(pi, String(definition.name), definition.execute);
	};
	const scopedReadJsonl = (name: string) => {
		const values = readJsonl(root, name);
		assertTaskRecordsScope(taskScope, values, name);
		return values;
	};
	const append = (name: string, value: unknown) => dependencies.append(
		name,
		stampTaskRecord(taskScope, value as Record<string, unknown>),
	);
	const records = scopedReadJsonl("task-tools.jsonl") as TaskToolRecord[];
	assertTaskRecordsScope(taskScope, records as unknown as Record<string, unknown>[], "task-tools.jsonl");
	const tools = new Map<string, TaskToolRecord>();
	let toolCounter = nextCounter(records, "tool_id");
	let invocationCounter = nextCounter(scopedReadJsonl("task-tool-events.jsonl"), "invocation_id");
	for (const record of records) {
		const previous = tools.get(record.name);
		if (!previous || Number(record.version) >= previous.version) tools.set(record.name, record);
	}
	const registered = new Set<string>();
	const appendEvent = (value: Record<string, unknown>) => append("task-tool-events.jsonl", value);
	const resolveBasisRefs = (references: unknown): string[] => {
		const values = Array.isArray(references) ? references.map(String) : [];
		return dependencies.resolveBasisRefs ? dependencies.resolveBasisRefs(values) : values;
	};
	const toolNamesFor = (name: string) => records
		.filter((record) => record.name === name)
		.map((record) => record.exposed_name);

	const register = (record: TaskToolRecord) => {
		if (registered.has(record.exposed_name)) return;
		registerRoutableTool({
			name: record.exposed_name,
			label: `Task tool: ${record.name} v${record.version}`,
			description: pureProgram(record.program)
				? `${record.description} Pure JSON computation ${record.name}@v${record.version}. ` +
					`Input schema: ${JSON.stringify(record.input_schema)}. Output schema: ${JSON.stringify(record.output_schema)}. ` +
					"A binding fills its same-named input field: omit that field from parameters (no $binding placeholder). " +
					(record.adapter_id === "arc_agi_3"
						? "For a current ARC frame, use the exact observation_snapshot ref and path [public_state,frames,0]; current_state_frame is only a display label. "
						: "") + "Bindings are parent-only and never grant access."
				: `${record.description} Adapter implementation ${record.implementation_ref} under ${record.permission}; adapter-owned refs are resolved by the adapter. ` +
					`Input object schema: ${JSON.stringify(record.input_schema)}. This task-local tool only accesses the adapter-provided backend.`,
			// Keep the dynamic function schema valid for OpenAI-compatible gateways
			// while allowing analysis tools to receive nested observation JSON.
			// Type.Unknown() emits an open JSON schema object; Type.Any() emits null
			// in some gateways and rejects the whole tool.
			parameters: pureProgram(record.program)
				// Keep the provider-facing envelope deliberately boring.  A number of
				// OpenAI-compatible gateways reject TypeBox's open Record/Unknown and
				// optional/union expansions (they become `null` in required/items
				// positions) even though Pi accepts them locally.  The runtime still
				// performs the strict, richer validation after the call arrives.
				? pureToolInvocationParameters()
				: Type.Object({ input: Type.Object({}, { additionalProperties: true }) }, { additionalProperties: false }),
			async execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) {
				const invocationId = `task-tool-invocation-${++invocationCounter}`;
				const invocation = params as Record<string, unknown>;
				let input: Record<string, unknown> = {};
				let failureEvidence: Record<string, unknown> = {};
				try {
					if (!pureProgram(record.program)) input = normalizeInput(invocation.input);
					const current = tools.get(record.name);
					const methodRejection = methodUseRejection(readJsonl(root, "task-method-lifecycle.jsonl"), [`tool:${record.name}@v${record.version}`], readJsonl(root, "effect-assessments.jsonl"));
					if (methodRejection) throw new Error(methodRejection);
					if (!current || current.exposed_name !== record.exposed_name
						|| current.status !== "active" || (current.availability ?? "loaded") !== "loaded") {
						throw new Error(`task tool is unavailable: ${record.name}@v${record.version}`);
					}
					if (record.validity !== undefined) {
						const reasons = memoryValidityReasons(record.validity,
							memoryValidityContext(ensureTaskScope(root).taskId, readJsonl(root, "execution-observations.jsonl")));
						if (reasons.length) throw new Error(`task tool scope requires review: ${record.name}@v${record.version}: ${reasons.join(", ")}`);
					}
					const assembly = latestHarnessAssembly(readJsonl(root, "task-harness-assemblies.jsonl"));
					if (!assemblySelectsReference(assembly, [
						`tool:${record.name}@v${record.version}`,
						`tool:${record.tool_id}@v${record.version}`,
						`tool:${record.exposed_name}@v${record.version}`,
					])) throw new Error(`task tool is in the component pool but is not selected by the current Harness assembly: ${record.name}@v${record.version}`);
					if (record.program) {
						let result: TaskToolResult;
						if (pureProgram(record.program)) {
							if (signal?.aborted) throw new TaskJsonSchemaError("cancelled", "evaluation cancelled", "$invocation");
							dependencies.prepareResourceBindingAuthorization?.();
							const validatedProgram = validateTaskPureExpressionProgram(record.program);
							failureEvidence = { effective_limits: validatedProgram.effective_limits,
								consumed: { steps: 0, constructed_elements: 0, allocation_bytes: 0, input_bytes: 0, output_bytes: 0 } };
							const prepared = preparePureExpressionInput(pi, root, invocation, {
								max_input_bytes: validatedProgram.effective_limits.input_bytes,
								max_record_bytes: validatedProgram.effective_limits.input_bytes,
								max_preparation_bytes: validatedProgram.effective_limits.allocation_bytes,
							});
							if (signal?.aborted) throw new TaskJsonSchemaError("cancelled", "evaluation cancelled", "$invocation");
							input = prepared.input;
							failureEvidence = { input_provenance: prepared.provenance, preparation: prepared.preparation };
							const schemaOptions = { is_cancelled: () => signal?.aborted === true };
							const inputSchemaUsage = assertTaskJsonSchemaValue(record.input_schema, input, "invalid_input", "$input", schemaOptions);
							failureEvidence = { ...failureEvidence, schema_validation: { input: inputSchemaUsage } };
							const evaluated = evaluateTaskPureExpression(record.program, input, { is_cancelled: schemaOptions.is_cancelled });
							failureEvidence = { ...failureEvidence, effective_limits: evaluated.effective_limits, consumed: evaluated.consumed };
							const outputSchemaUsage = assertTaskJsonSchemaValue(record.output_schema!, evaluated.value, "invalid_output", "$output", schemaOptions);
							const outputSha256 = createHash("sha256").update(evaluated.output_json).digest("hex");
							result = {
								content: [{ type: "text", text: evaluated.output_json }],
									details: {
									representation: TASK_PURE_EXPRESSION_FORMAT,
									tool_ref: `tool:${record.name}@v${record.version}`,
										program_sha256: record.program_sha256,
										program_authored_sha256: record.program_authored_sha256,
										input_schema_sha256: record.input_schema_sha256,
										output_schema_sha256: record.output_schema_sha256,
										program_limits_requested: record.program_limits_requested,
										program_limits_effective: record.program_limits_effective,
									output_sha256: outputSha256,
									program_format: TASK_PURE_EXPRESSION_FORMAT,
									input_provenance: prepared.provenance,
									preparation: prepared.preparation,
									effective_limits: evaluated.effective_limits,
									consumed: evaluated.consumed,
									schema_validation: { input: inputSchemaUsage, output: outputSchemaUsage },
									output_schema_validated: true,
								},
							};
							failureEvidence = { ...failureEvidence,
								schema_validation: { input: inputSchemaUsage, output: outputSchemaUsage }, output_sha256: outputSha256 };
						} else {
							result = await executeTaskProgram(record.program, input, adapter, {
								root, name: record.name, version: record.version,
							});
						}
						const content = result.content?.length
							? result.content
							: [{ type: "text" as const, text: JSON.stringify(result.details ?? {}) }];
						const semanticEvidence = semanticInvocationEvidence(input, result);
						appendEvent({
							event: "invoked", invocation_id: invocationId, toolCallId,
							tool_id: record.tool_id, name: record.name, version: record.version,
							exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
							input, output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
							...semanticEvidence,
							...(pureProgram(record.program) && result.details && typeof result.details === "object"
								? { pure_expression: result.details as Record<string, unknown> } : {}),
							status: "completed", recordedAt: new Date().toISOString(),
						});
						if (record.decision_id) append("harness-observations.jsonl", {
							observation_id: `task-tool-use-${invocationId}`,
							observation_kind: "pi_task_tool_invocation",
							decision_id: record.decision_id,
							resource_refs: [`tool:${record.name}@v${record.version}`],
							basis_resource_ids: record.basis_refs,
							operation: { capability:"pi_task_tool", component:"task_tool", name:record.name, version:record.version },
							actual_use: true, semantic_effect_observed: semanticEvidence.semantic_effect_observed,
							semantic_verification: semanticEvidence.semantic_verification,
							invocation_id: invocationId,
							semantic_output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
							effect_observed: true, recordedAt: new Date().toISOString(),
						});
						return { ...result, content };
					}
					if (!implementationAllowed(record.implementation_ref)) {
						throw new Error(`implementation is not allowed by adapter: ${record.implementation_ref}`);
					}
					const result = await adapter.execute(record.implementation_ref, input, {
						root, name: record.name, version: record.version,
					});
					const content = result.content?.length
						? result.content
						: [{ type: "text" as const, text: JSON.stringify(result.details ?? {}) }];
					const semanticEvidence = semanticInvocationEvidence(input, result);
					appendEvent({
						event: "invoked", invocation_id: invocationId, toolCallId,
						tool_id: record.tool_id, name: record.name, version: record.version,
						exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
						input, output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
						...semanticEvidence,
						status: "completed", recordedAt: new Date().toISOString(),
					});
					if (record.decision_id) append("harness-observations.jsonl", {
						observation_id: `task-tool-use-${invocationId}`,
						observation_kind: "pi_task_tool_invocation",
						decision_id: record.decision_id,
						resource_refs: [`tool:${record.name}@v${record.version}`],
						basis_resource_ids: record.basis_refs,
						operation: { capability:"pi_task_tool", component:"task_tool", name:record.name, version:record.version },
						actual_use: true, semantic_effect_observed: semanticEvidence.semantic_effect_observed,
						semantic_verification: semanticEvidence.semantic_verification,
						invocation_id: invocationId,
						semantic_output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
						effect_observed: true, recordedAt: new Date().toISOString(),
					});
					return { ...result, content };
				} catch (error) {
					const rawPureFailure = pureProgram(record.program) ? structuredPureFailure(error) : undefined;
					const pureFailure = rawPureFailure ? {
						...rawPureFailure,
						consumed: rawPureFailure.consumed ?? failureEvidence.consumed ?? {
							steps: 0, constructed_elements: 0, allocation_bytes: 0,
							input_bytes: 0, output_bytes: 0,
						},
						effective_limits: rawPureFailure.effective_limits
							?? failureEvidence.effective_limits ?? record.program_limits_effective,
					} : undefined;
					appendEvent({
						event: "invoked", invocation_id: invocationId, toolCallId,
						tool_id: record.tool_id, name: record.name, version: record.version,
						exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
						...(pureFailure ? {
							program_sha256: record.program_sha256,
							program_authored_sha256: record.program_authored_sha256,
							input_schema_sha256: record.input_schema_sha256,
							output_schema_sha256: record.output_schema_sha256,
							program_limits_requested: record.program_limits_requested,
							program_limits_effective: record.program_limits_effective,
						} : {}),
						input, status: "failed",
						error: pureFailure ?? (error instanceof Error ? error.message : String(error)),
						...failureEvidence,
						recordedAt: new Date().toISOString(),
					});
					if (pureFailure) throw new Error(JSON.stringify(pureFailure));
					throw error;
				}
			},
		});
		registered.add(record.exposed_name);
		appendEvent({
			event: "registered", tool_id: record.tool_id, name: record.name,
			version: record.version, exposed_name: record.exposed_name,
			implementation_ref: record.implementation_ref, adapter_id: record.adapter_id,
			permission: record.permission, decision_id: record.decision_id,
			recordedAt: new Date().toISOString(),
		});
	};

	for (const record of tools.values()) {
		if (record.status === "active") register(record);
	}

	registerRoutableTool({
		name: "task_tool",
		label: "Task-local tool portfolio",
		description: `Task-local Tool CRUD. Read tool-creator first; pass exact authoring_method_ref. Use program.steps (${TASK_TOOL_PROGRAM_STEP_KINDS.join(", ")}) OR ${TASK_PURE_EXPRESSION_FORMAT}; adapter permissions remain enforced.`,
		parameters: Type.Object({
			validity: Type.Optional(Type.Object({ scope: Type.Union([Type.Literal("task"), Type.Literal("episode"), Type.Literal("level"), Type.Literal("state")]), task_ref: Type.Optional(Type.String()), instance_ref: Type.Optional(Type.String()) })),
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			description: Type.Optional(Type.String()),
			input_schema: Type.Optional(Type.Record(Type.String(), Type.Any())),
			output_schema: Type.Optional(Type.Record(Type.String(), Type.Any())),
			implementation_ref: Type.Optional(Type.String()),
			program: Type.Optional(Type.Record(Type.String(), Type.Any())),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			authoring_method_ref: Type.Optional(Type.String({ description: "Exact tool-creator method_ref." })),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params, signal) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const selected = p.name ? [tools.get(String(p.name))].filter(Boolean) : [...tools.values()];
				return {
					content: [{ type: "text", text: JSON.stringify({
						adapter_id: adapter.adapterId, permission: adapter.permission,
						allowed_implementations: [...allowedImplementations],
						allow_unlisted_implementations: adapter.allowUnlistedImplementations === true,
						tools: selected,
					}) }],
					 details: { adapter_id: adapter.adapterId, permission: adapter.permission, tools: selected },
				};
			}
			const admission = admitTaskLocalOperation("task_tool");
			if (admission) return admission;
			const name = String(p.name ?? "").trim();
			assertTaskToolName(name);
			const previous = tools.get(name);
			if (p.action === "create" && previous) throw new Error("task tool already exists; use update");
			if (p.action !== "create" && !previous) throw new Error("unknown task tool");
			if (previous && Number(p.target_version) !== previous.version) {
				return versionConflict("tool", previous, p.target_version);
			}
			const programWasProvided = p.program !== undefined;
			const program = p.program === undefined
				? previous?.program
				: objectSchema(p.program);
			const isPure = Boolean(program && Object.prototype.hasOwnProperty.call(program, "format"));
			if (signal?.aborted) throw new Error("tool publication cancelled; no component was written");
			const isSource = (program as any)?.format === TASK_PURE_PYTHON_FORMAT;
			const validatedPureProgram = program && isPure ? validateTaskPureExpressionProgram(program) : undefined;
			if (program && !isPure && (!Array.isArray(program.steps) || !program.steps.length)) throw new Error("program.steps must be a non-empty array");
			const implementationRef = String(p.implementation_ref ?? previous?.implementation_ref
				?? (isPure ? "task.local.pure_expression" : program ? "task.local.program" : "")).trim();
			if (!program && !implementationAllowed(implementationRef)) {
				throw new Error(`implementation is not allowed by adapter: ${implementationRef}`);
			}
			const description = String(p.description ?? previous?.description ?? `Task-local tool: ${name}`).replace(/\s+/g, " ").trim();
			if (!description) throw new Error("active task tool requires description");
			// A tool can be created from its program alone. An empty object schema is
			// the safe default, so schema bookkeeping does not become an accidental
			// prerequisite for trying a task-local capability.
			const schema = objectSchema(p.input_schema, previous?.input_schema ?? { type: "object" });
			const outputSchema = p.output_schema === undefined
				? previous?.output_schema ?? (isSource ? {} : undefined) : objectSchema(p.output_schema);
			if (isPure) {
				validateTaskJsonSchema(schema, "$.input_schema");
				if (!outputSchema) throw new Error("pure expression program requires output_schema");
				validateTaskJsonSchema(outputSchema, "$.output_schema");
				validateTaskPureExpressionInputAccess(validatedPureProgram!, schema);
			}
			const authoredProgramSha256 = program
				? (!programWasProvided && previous?.program_authored_sha256
					? previous.program_authored_sha256 : jsonSha256(program))
				: undefined;
			const requestedProgramLimits = validatedPureProgram
				? (!programWasProvided && previous?.program_limits_requested
					? immutableJson(previous.program_limits_requested)
					: immutableJson(validatedPureProgram.limits))
				: undefined;
			// Freeze publication-time defaults into the immutable exact version. A
			// later runtime may enforce a tighter hard ceiling, but changing defaults
			// alone must never alter an already-published tool's budget contract.
			const frozenProgram = validatedPureProgram && programWasProvided
				? { format: validatedPureProgram.format, expression: validatedPureProgram.expression,
					limits: { ...validatedPureProgram.effective_limits } }
				: program;
			const storedProgram = frozenProgram ? immutableJson(frozenProgram) as TaskToolProgram : undefined;
			const storedInputSchema = immutableJson(schema);
			const storedOutputSchema = outputSchema ? immutableJson(outputSchema) : undefined;
			const status = p.action === "retire" ? "retired" : "active";
			const version = (previous?.version ?? 0) + 1;
			const toolId = previous?.tool_id ?? `task-tool-${++toolCounter}`;
			// Each version gets a distinct Pi tool name. This preserves an auditable
			// invocation target while allowing the active set to switch atomically.
			const exposedName = `task_tool_${name}_v${version}`;
			const decisionId = dependencies.allocateDecisionId();
			const record: TaskToolRecord = {
				...(p.validity !== undefined ? { validity: normalizeMemoryValidity(p.validity, memoryValidityContext(ensureTaskScope(root).taskId, scopedReadJsonl("execution-observations.jsonl"))) }
					: previous?.validity ? { validity: previous.validity } : {}),
				tool_id: toolId, name, version, status, availability: status === "retired" ? "retired" : "loaded", description, input_schema: storedInputSchema,
				...(storedOutputSchema ? { output_schema: storedOutputSchema } : {}),
				...(storedProgram ? { program_sha256: jsonSha256(storedProgram) } : {}),
				...(authoredProgramSha256 ? { program_authored_sha256: authoredProgramSha256 } : {}),
				...(validatedPureProgram?.source_evidence
					? { program_source_evidence: immutableJson(validatedPureProgram.source_evidence) }
					: !programWasProvided && previous?.program_source_evidence
						? { program_source_evidence: immutableJson(previous.program_source_evidence) } : {}),
				...(requestedProgramLimits ? { program_limits_requested: requestedProgramLimits } : {}),
				...(validatedPureProgram ? { program_limits_effective: { ...validatedPureProgram.effective_limits } } : {}),
				input_schema_sha256: jsonSha256(storedInputSchema),
				...(storedOutputSchema ? { output_schema_sha256: jsonSha256(storedOutputSchema) } : {}),
				implementation_ref: implementationRef, adapter_id: adapter.adapterId,
				...(storedProgram ? { program: storedProgram } : {}),
				permission: adapter.permission, exposed_name: exposedName,
				basis_refs: resolveBasisRefs(p.basis_refs), decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? (isPure
					? "provide a reusable bounded pure JSON computation" : "provide a reusable adapter-bounded operation")),
				reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when ?? "the tool is unused, contradicted, or no longer relevant"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
				authoring_method_ref: p.authoring_method_ref ? String(p.authoring_method_ref) : previous?.authoring_method_ref,
				recordedAt: new Date().toISOString(),
			};
			if (signal?.aborted) throw new Error("tool publication cancelled; no component was written");
			if (status === "active") register(record);
			tools.set(name, record);
			records.push(record);
			append("task-tools.jsonl", record);
			const previousActive = previous?.status === "active";
			const active = pi.getActiveTools();
			const obsolete = new Set(toolNamesFor(name));
			const nextActive = active.filter((toolName) => !obsolete.has(toolName));
			if (status === "active" || previousActive) nextActive.push(record.exposed_name);
			pi.setActiveTools([...new Set([...nextActive, "task_tool"])]);
			if (status === "retired") appendEvent({
				event: "retired", tool_id: record.tool_id, name: record.name,
				version: record.version, exposed_name: record.exposed_name,
				decision_id: decisionId, recordedAt: record.recordedAt,
			});
			append("harness-decisions.jsonl", {
				decision_id: decisionId, decision_path: "task_tool", choice: p.action,
				applied: true, intervention: "task_local_pi_tool", basis_resource_ids: record.basis_refs,
				operation: {
					capability: "pi.registerTool", component: "task_tool", name,
					version, exposed_name: record.exposed_name, implementation_ref: implementationRef,
					adapter_id: adapter.adapterId, permission: adapter.permission, status,
				},
				expected_effect: record.expected_effect, reconsider_when: record.reconsider_when,
				routing_id: record.routing_id, source_approval_ref: record.source_approval_ref,
				toolCallId, recordedAt: record.recordedAt,
			});
			return { content: [{ type: "text", text: JSON.stringify(record) }], details: record };
		},
	});
}
