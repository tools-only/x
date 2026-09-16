/** Read-only, version-addressed task data. No arbitrary filesystem access. */
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";

const FILES: Record<string, string> = {
	memory: "task-memory.jsonl", skill: "task-skills.jsonl",
	tool: "task-tools.jsonl", subagent: "task-subagents.jsonl", finding: "research-resources.jsonl",
	observation: "execution-observations.jsonl", validation: "task-validations.jsonl",
	delegation: "subagent-invocations.jsonl", context: "task-context-cache/messages.jsonl",
	proposal: "task-harness-proposals.jsonl", system_prompt: "task-system-prompt.jsonl",
	harness_route: "auto-research-harness-routes.jsonl",
	route_receipt: "auto-research-harness-route-receipts.jsonl",
	failure: "task-operation-failures.jsonl",
	research_run: "auto-research-runs.jsonl",
	research_report: "auto-research-reports.jsonl",
	research_session: "auto-research-sessions.jsonl",
};

const installedSemantics = new WeakSet<object>();
const installedReaders = new WeakSet<object>();
const readerGrants = new WeakMap<object, Set<string>>();
export function grantOwnContextRefs(pi: ExtensionAPI, refs: string[]) {
	const grants = readerGrants.get(pi);
	for (const ref of refs) if (ref.startsWith("context:")) grants?.add(ref);
}
export function installTaskResultSemantics(pi: ExtensionAPI) {
	if (installedSemantics.has(pi)) return;
	installedSemantics.add(pi);
	// Pi does not interpret an execute() return's isError flag. The supported
	// result hook is required to preserve structured conflicts as real failures.
	pi.on("tool_result", (event) => {
		if ((event.details as any)?.format === "task-resource-version-conflict-v1") return { isError: true };
		if ((event.details as any)?.format === "auto-research-harness-apply-result-v1"
			&& ["partial", "failed"].includes(String((event.details as any)?.route_status))) return { isError: true };
		return {};
	});
}

export function resourceSummary(record: Record<string, any>, _maximum?: number): string {
	const source = String(record.summary ?? record.description ?? record.content ?? record.instructions
		?? record.question ?? record.hypothesis ?? record.proposal?.summary ?? record.error ?? record.result_text ?? record.result?.text ?? "");
	return source.replace(/\s+/g, " ").trim();
}

export function resourceName(record: Record<string, any>): string {
	return String(record.key ?? record.name ?? record.finding_id
		?? record.approval_id ?? record.receipt_id ?? record.route_id ?? record.observation_id ?? record.validation_id ?? record.invocation_id ?? record.failure_id ?? record.run_id ?? record.session_id ?? record.archive_id ?? "");
}

export function resourceMetadata(kind: string, record: Record<string, any>) {
	const ref = `${kind}:${resourceName(record)}@v${Number(record.version ?? 1)}`;
	const serialized = JSON.stringify(record);
	const unverifiedMemory = kind === "memory" && !(Array.isArray(record.basis_refs) && record.basis_refs.length);
	return {
		resource_ref: ref, version: Number(record.version ?? 1), status: record.status,
		summary: resourceSummary(record), summary_kind: record.summary ? "agent_authored" : "extractive_excerpt",
		chars: serialized.length, sha256: createHash("sha256").update(serialized).digest("hex"),
		basis_refs: record.basis_refs ?? record.evidence_refs ?? [],
		epistemic_status: unverifiedMemory ? "unverified_hypothesis"
			: ["observation", "failure"].includes(kind) ? "recorded_tool_output_not_causal_interpretation"
			: kind === "context" ? "recorded_transcript" : "agent_authored_not_independently_verified",
		...(unverifiedMemory ? { epistemic_label: "UNVERIFIED HYPOTHESIS" } : {}),
		read: { tool: "task_resource", action: "read", ref, offset: 0, limit: 2000 },
		provenance: {
			format: "task-evidence-provenance-v1", source_ref: ref,
			source_version: Number(record.version ?? 1), derived_ref: ref,
			operation: "resource_index", transformations: [],
			page: { offset: 0, limit: 2000, total: serialized.length,
				truncated: serialized.length > 2000, next_offset: serialized.length > 2000 ? 2000 : null },
		},
	};
}

export function evidenceProvenance(input: {
	ref: string; sourceVersion?: number; operation: string; offset?: number;
		limit?: number; total?: number; nextOffset?: number | null;
		transformations?: string[]; derivedRef?: string; checkpointRef?: string;
}) {
	const offset = Math.max(0, Number(input.offset ?? 0));
	const limit = Math.max(1, Number(input.limit ?? 2000));
	const total = Math.max(0, Number(input.total ?? 0));
	return {
		format: "task-evidence-provenance-v1", source_ref: input.ref,
		source_version: Number(input.sourceVersion ?? 1), derived_ref: input.derivedRef ?? input.ref,
		operation: input.operation, transformations: [...(input.transformations ?? [])],
		page: { offset, limit, total, truncated: input.nextOffset !== null && input.nextOffset !== undefined,
			next_offset: input.nextOffset ?? null },
		...(input.checkpointRef ? { checkpoint_ref: input.checkpointRef } : {}),
	};
}

export function taskRecords(root: string, kind: string): Record<string, any>[] {
	if (!(kind in FILES)) throw new Error(`unknown task resource kind: ${kind}`);
	const scope = ensureTaskScope(root);
	const path = join(scope.root, FILES[kind]);
	if (!existsSync(path)) return [];
	const actual = relative(realpathSync(scope.root), realpathSync(path));
	if (actual.startsWith("..") || isAbsolute(actual)) throw new Error("resource file resolves outside this task");
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		let record: any;
		try { record = JSON.parse(line); } catch { return []; }
		if (!record || typeof record !== "object") return [];
		assertTaskRecordScope(scope, record, FILES[kind]);
		return [record];
	});
}

export function resolveTaskResource(root: string, ref: string): Record<string, any> {
	const match = ref.match(/^([a-z_]+):([^@]+)@v([1-9]\d*)$/);
	if (!match || !(match[1] in FILES)) throw new Error("ref must be kind:name@vN from this task's index");
	const record = taskRecords(root, match[1]).find((r) =>
		(resourceName(r) === match[2] || r.memory_id === match[2] || r.skill_id === match[2] || r.agent_id === match[2])
		&& Number(r.version ?? 1) === Number(match[3]));
	if (!record) throw new Error(`unknown task-local resource version: ${ref}`);
	return record;
}

/** Explicit CAS conflict; a failed write never promotes the requested version. */
export function versionConflict(kind: string, record: Record<string, any>, requested: unknown) {
	const details = {
		format: "task-resource-version-conflict-v1", applied: false,
		requested_version: requested ?? null, current_version: record.version,
		current: resourceMetadata(kind, record),
		recovery: "target_version means the CURRENT version, not the new version. Read current if needed, merge intentionally, then retry with current_version. No write was applied.",
	};
	return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

export function installTaskResourceReader(pi: ExtensionAPI, root: string, allowedRefs?: string[]) {
	if (installedReaders.has(pi)) return;
	installedReaders.add(pi);
	installTaskResultSemantics(pi);
	const scope = ensureTaskScope(root);
	const allowed = allowedRefs ? new Set(allowedRefs) : undefined;
	if (allowed) readerGrants.set(pi, allowed);
	pi.registerTool({
		name: "task_resource", label: "Task-local resource index and paged read",
		description: "Inspect metadata or read exact task-local resource versions in pages. Full resources and observations remain outside context. No files from another task or arbitrary host paths are accessible. offset/limit are character offsets in serialized JSON.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("inspect"), Type.Literal("read")]),
			kind: Type.Optional(Type.String()), ref: Type.Optional(Type.String()),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_id, p) {
			if (p.action === "read") {
				const ref = String(p.ref ?? "");
				if (allowed && !allowed.has(ref)) throw new Error("resource was not granted to this child invocation");
				const record = resolveTaskResource(root, ref);
				const serialized = JSON.stringify(record);
				const offset = p.offset ?? 0, limit = p.limit ?? 2000;
				const text = serialized.slice(offset, offset + limit);
				const nextOffset = offset + text.length < serialized.length ? offset + text.length : null;
				const provenance = evidenceProvenance({ ref, sourceVersion: Number(record.version ?? 1), operation: "paged_read",
					offset, limit, total: serialized.length, nextOffset });
				const result = {
					ref, offset, limit, total: serialized.length, total_chars: serialized.length, text,
					next_offset: nextOffset,
					truncated: nextOffset !== null,
					provenance,
					// These fields describe what this read established. They do not
					// interpret the resource or claim that the research question is
					// answerable.
					page_end: offset + text.length,
					complete: nextOffset === null,
					has_more: nextOffset !== null,
				};
				appendFileSync(join(root, "task-resource-access.jsonl"), JSON.stringify(stampTaskRecord(scope, {
					resource_ref: ref, operation: "paged_read", offset, chars: result.text.length,
					limit, total: serialized.length, next_offset: nextOffset, truncated: nextOffset !== null, provenance,
					reader: allowed ? "subagent" : "parent", recordedAt: new Date().toISOString(),
				})) + "\n");
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
	const kinds = p.kind ? [p.kind] : Object.keys(FILES);
			const index = kinds.flatMap((kind) => {
				const latest = new Map<string, Record<string, any>>();
				for (const record of taskRecords(root, kind)) {
					const metadata = resourceMetadata(kind, record);
					if (allowed && !allowed.has(metadata.resource_ref)) continue;
					latest.set(resourceName(record), metadata);
				}
				return [...latest.values()];
			});
			const offset = p.offset ?? 0;
			const count = p.limit ?? Number.MAX_SAFE_INTEGER;
			const result = { total: index.length, resources: index.slice(offset, offset + count),
				next_offset: offset + count < index.length ? offset + count : null };
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
}
