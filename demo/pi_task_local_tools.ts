/** Adapter-bounded task-local tools registered through Pi's public API. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { admitTaskLocalOperation } from "./pi_task_execution_admission.ts";
import { Type } from "typebox";
import { assertTaskRecordsScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { versionConflict } from "./pi_task_resource_store.ts";
import { registerNativeHarnessExecutor } from "./pi_task_harness_route_runtime.ts";
import { TASK_TOOL_PROGRAM_STEP_KINDS } from "./pi_task_tool_contract.ts";
import { assemblySelectsReference, latestHarnessAssembly } from "./pi_task_harness_assembly.ts";

export type TaskToolResult = {
	content?: Array<{ type: "text"; text: string }>;
	details?: unknown;
};

export type TaskToolProgram = {
	steps: Array<Record<string, unknown>>;
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
};

type TaskToolRecord = {
	tool_id: string;
	name: string;
	version: number;
	status: "active" | "retired";
	availability?: "loaded" | "unloaded" | "suspended" | "retired";
	description: string;
	input_schema: Record<string, unknown>;
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
	recordedAt: string;
};

function safeName(name: string): void {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.includes("--")) {
		throw new Error("task tool name must use lowercase letters, digits, or single hyphens");
	}
}

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
		pi.registerTool({
			name: record.exposed_name,
			label: `Task tool: ${record.name} v${record.version}`,
			description:
				`${record.description} ` +
				`Adapter implementation ${record.implementation_ref} under ${record.permission}; adapter-owned refs are resolved by the adapter. ` +
				`Input object schema: ${JSON.stringify(record.input_schema)}. ` +
				"This task-local tool only accesses the adapter-provided backend.",
			// Keep the dynamic function schema valid for OpenAI-compatible gateways
			// while allowing analysis tools to receive nested observation JSON.
			// Type.Unknown() emits an open JSON schema object; Type.Any() emits null
			// in some gateways and rejects the whole tool.
			parameters: Type.Object({
				input: Type.Record(Type.String(), Type.Unknown()),
			}),
			async execute(toolCallId, params) {
				const invocationId = `task-tool-invocation-${++invocationCounter}`;
				const input = normalizeInput((params as Record<string, unknown>).input);
				try {
					const current = tools.get(record.name);
					if (!current || current.exposed_name !== record.exposed_name
						|| current.status !== "active" || (current.availability ?? "loaded") !== "loaded") {
						throw new Error(`task tool is unavailable: ${record.name}@v${record.version}`);
					}
					const assembly = latestHarnessAssembly(readJsonl(root, "task-harness-assemblies.jsonl"));
					if (!assemblySelectsReference(assembly, [
						`tool:${record.name}@v${record.version}`,
						`tool:${record.tool_id}@v${record.version}`,
						`tool:${record.exposed_name}@v${record.version}`,
					])) throw new Error(`task tool is in the component pool but is not selected by the current Harness assembly: ${record.name}@v${record.version}`);
					if (record.program) {
						const result = await executeTaskProgram(record.program, input, adapter, {
							root, name: record.name, version: record.version,
						});
						const content = result.content?.length
							? result.content
							: [{ type: "text" as const, text: JSON.stringify(result.details ?? {}) }];
						appendEvent({
							event: "invoked", invocation_id: invocationId, toolCallId,
							tool_id: record.tool_id, name: record.name, version: record.version,
							exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
							input, output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
							...semanticInvocationEvidence(input, result),
							status: "completed", recordedAt: new Date().toISOString(),
						});
						if (record.decision_id) append("harness-observations.jsonl", {
							observation_id: `task-tool-use-${invocationId}`,
							observation_kind: "pi_task_tool_invocation",
							decision_id: record.decision_id,
							basis_resource_ids: record.basis_refs,
							operation: { capability:"pi_task_tool", component:"task_tool", name:record.name, version:record.version },
							actual_use: true, semantic_effect_observed: true,
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
					appendEvent({
						event: "invoked", invocation_id: invocationId, toolCallId,
						tool_id: record.tool_id, name: record.name, version: record.version,
						exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
						input, output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
						...semanticInvocationEvidence(input, result),
						status: "completed", recordedAt: new Date().toISOString(),
					});
					if (record.decision_id) append("harness-observations.jsonl", {
						observation_id: `task-tool-use-${invocationId}`,
						observation_kind: "pi_task_tool_invocation",
						decision_id: record.decision_id,
						basis_resource_ids: record.basis_refs,
						operation: { capability:"pi_task_tool", component:"task_tool", name:record.name, version:record.version },
						actual_use: true, semantic_effect_observed: true,
						invocation_id: invocationId,
						semantic_output_excerpt: compactText(content.map((item) => item.text).join("\n"), 2_000),
						effect_observed: true, recordedAt: new Date().toISOString(),
					});
					return { ...result, content };
				} catch (error) {
					appendEvent({
						event: "invoked", invocation_id: invocationId, toolCallId,
						tool_id: record.tool_id, name: record.name, version: record.version,
						exposed_name: record.exposed_name, implementation_ref: record.implementation_ref,
						input, status: "failed", error: error instanceof Error ? error.message : String(error),
						recordedAt: new Date().toISOString(),
					});
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
		description:
			"Create, revise, retire, or inspect an agent-defined task-local Pi tool. " +
			"The agent may create or update a tool directly from a task observation; no finding is required. " +
			`Use program.steps for a new declarative behavior with ${TASK_TOOL_PROGRAM_STEP_KINDS.join(", ")} steps; adapter calls remain permission checked. Analysis outputs include evidence provenance when input carries evidence_ref/source_version. Arbitrary host code and extensions are never loaded.`,
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("retire"), Type.Literal("inspect")]),
			name: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			description: Type.Optional(Type.String()),
			input_schema: Type.Optional(Type.Record(Type.String(), Type.Any())),
			implementation_ref: Type.Optional(Type.String()),
			program: Type.Optional(Type.Record(Type.String(), Type.Any())),
			basis_refs: Type.Optional(Type.Array(Type.String())),
			expected_effect: Type.Optional(Type.String()),
			reconsider_when: Type.Optional(Type.String()),
			routing_id: Type.Optional(Type.String()),
			source_approval_ref: Type.Optional(Type.String()),
		}),
		async execute(toolCallId, params) {
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
			safeName(name);
			const previous = tools.get(name);
			if (p.action === "create" && previous) throw new Error("task tool already exists; use update");
			if (p.action !== "create" && !previous) throw new Error("unknown task tool");
			if (previous && Number(p.target_version) !== previous.version) {
				return versionConflict("tool", previous, p.target_version);
			}
			const program = p.program === undefined
				? previous?.program
				: objectSchema(p.program);
			if (program && (!Array.isArray(program.steps) || !program.steps.length)) {
				throw new Error("program.steps must be a non-empty array");
			}
			const implementationRef = String(p.implementation_ref ?? previous?.implementation_ref ?? (program ? "task.local.program" : "")).trim();
			if (!program && !implementationAllowed(implementationRef)) {
				throw new Error(`implementation is not allowed by adapter: ${implementationRef}`);
			}
			const description = String(p.description ?? previous?.description ?? `Task-local tool: ${name}`).replace(/\s+/g, " ").trim();
			if (!description) throw new Error("active task tool requires description");
			// A tool can be created from its program alone. An empty object schema is
			// the safe default, so schema bookkeeping does not become an accidental
			// prerequisite for trying a task-local capability.
			const schema = objectSchema(p.input_schema, previous?.input_schema ?? { type: "object" });
			const status = p.action === "retire" ? "retired" : "active";
			const version = (previous?.version ?? 0) + 1;
			const toolId = previous?.tool_id ?? `task-tool-${++toolCounter}`;
			// Each version gets a distinct Pi tool name. This preserves an auditable
			// invocation target while allowing the active set to switch atomically.
			const exposedName = `task_tool_${name}_v${version}`;
			const decisionId = dependencies.allocateDecisionId();
			const record: TaskToolRecord = {
				tool_id: toolId, name, version, status, availability: status === "retired" ? "retired" : "loaded", description, input_schema: schema,
				implementation_ref: implementationRef, adapter_id: adapter.adapterId,
				...(program ? { program: program as TaskToolProgram } : {}),
				permission: adapter.permission, exposed_name: exposedName,
				basis_refs: resolveBasisRefs(p.basis_refs), decision_id: decisionId,
				expected_effect: String(p.expected_effect ?? previous?.expected_effect ?? "provide a reusable adapter-bounded operation"),
				reconsider_when: String(p.reconsider_when ?? previous?.reconsider_when ?? "the tool is unused, contradicted, or no longer relevant"),
				routing_id: p.routing_id ? String(p.routing_id) : previous?.routing_id,
				source_approval_ref: p.source_approval_ref ? String(p.source_approval_ref) : previous?.source_approval_ref,
				recordedAt: new Date().toISOString(),
			};
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
