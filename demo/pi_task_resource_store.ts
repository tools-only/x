/** Read-only, version-addressed task data. No arbitrary filesystem access. */
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { canonicalTextBody } from "./pi_harness_protocol.ts";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { taskResourceName } from "./pi_task_resource_identity.ts";
import { readWorkset } from "./pi_read_workset.ts";

const FILES: Record<string, string> = {
	competition_view: "task-competition-views.jsonl", strategy_candidate: "task-strategy-candidates.jsonl",
	memory: "task-memory.jsonl", skill: "task-skills.jsonl",
	checkpoint: "task-checkpoint-resources.jsonl",
	tool_result: "task-parent-tool-results.jsonl",
	level_review: "task-level-reviews.jsonl",
	harness_review: "task-harness-reviews.jsonl",
	outcome_cost_index: "task-outcome-cost-index.jsonl",
	tool: "task-tools.jsonl", subagent: "task-subagents.jsonl", finding: "research-resources.jsonl",
	observation: "execution-observations.jsonl", validation: "task-validations.jsonl",
	pre_action_state: "pre-action-states.jsonl",
	observation_snapshot: "observation-snapshots.jsonl",
	arc_trajectory_snapshot: "arc-trajectory-snapshots.jsonl",
	delegation: "subagent-invocations.jsonl", context: "task-context-cache/messages.jsonl",
	proposal: "task-harness-proposals.jsonl", system_prompt: "task-system-prompt.jsonl",
	harness_route: "auto-research-harness-routes.jsonl",
	route_receipt: "auto-research-harness-route-receipts.jsonl",
	failure: "task-operation-failures.jsonl",
	research_run: "auto-research-runs.jsonl",
	research_report: "auto-research-reports.jsonl",
	research_session: "auto-research-sessions.jsonl",
	research_plan: "auto-research-plans.jsonl",
	research_handoff: "auto-research-handoffs.jsonl",
	research_candidate: "auto-research-opportunities.jsonl",
	research_agenda: "auto-research-agenda.jsonl",
	research_worker: "auto-research-workers.jsonl",
	research_update: "auto-research-updates.jsonl",
	harness_assembly: "task-harness-assemblies.jsonl",
	method: "task-method-lifecycle.jsonl",
	authoring_handoff: "parent-authoring-handoffs.jsonl",
	effect_assessment: "effect-assessments.jsonl",
	harness_observation: "harness-observations.jsonl",
};

const installedSemantics = new WeakSet<object>();
const installedReaders = new WeakSet<object>();
type ReaderAuthorization = { root: string; role: "parent" | "restricted"; grants: Set<string> };
const readerAuthorizations = new WeakMap<object, ReaderAuthorization>();
export function grantOwnContextRefs(pi: ExtensionAPI, refs: string[]) {
	const authorization = readerAuthorizations.get(pi);
	for (const ref of refs) if (ref.startsWith("context:") && authorization?.role === "restricted") authorization.grants.add(ref);
}
export function installTaskResultSemantics(pi: ExtensionAPI) {
	if (installedSemantics.has(pi)) return;
	installedSemantics.add(pi);
	// Pi does not interpret an execute() return's isError flag. The supported
	// result hook is required to preserve structured conflicts as real failures.
	pi.on("tool_result", (event) => {
		if ((event.details as any)?.format === "task-resource-version-conflict-v1") return { isError: true };
		if ((event.details as any)?.format === "task-harness-assembly-version-conflict-v1") return { isError: true };
		if ((event.details as any)?.format === "task-harness-assembly-input-error-v1") return { isError: true };
		if ((event.details as any)?.format === "auto-research-harness-apply-result-v1"
			&& ["partial", "failed"].includes(String((event.details as any)?.route_status))) return { isError: true };
		if ((event.details as any)?.format === "auto-research-adoption-v1"
			&& ["partial", "failed"].includes(String((event.details as any)?.status))) return { isError: true };
		return {};
	});
}

export function resourceSummary(record: Record<string, any>, _maximum?: number): string {
	const raw = record.summary ?? record.description ?? record.content ?? record.instructions
		?? record.question ?? record.hypothesis ?? record.proposal?.summary ?? record.error ?? record.result_text ?? record.result?.text ?? "";
	const source = raw === "" ? "" : canonicalTextBody(raw, "resource summary");
	return source.replace(/\s+/g, " ").trim();
}

export function resourceName(record: Record<string, any>): string {
	return taskResourceName(record);
}

function addressedResourceName(kind: string, record: Record<string, any>): string {
	if (kind === "research_worker") return String(record.worker_id ?? "");
	if (kind === "research_update") return String(record.update_id ?? "");
	if (kind === "competition_view") return String(record.view_id ?? "");
	if (kind === "checkpoint") return String(record.checkpoint_id ?? "");
	if (kind === "tool_result") return String(record.result_id ?? "");
	// These records carry both their own ID and a related review ID. The exact
	// read address must use the ID advertised by their own handoff/review receipt.
	if (kind === "research_handoff") return String(record.handoff_id ?? "");
	if (kind === "level_review") return String(record.window_id ?? "");
	return resourceName(record);
}

export function resourceMetadata(kind: string, record: Record<string, any>) {
	const ref = `${kind}:${addressedResourceName(kind, record)}@v${Number(record.version ?? 1)}`;
	const serialized = JSON.stringify(record);
	const unverifiedMemory = kind === "memory" && !(Array.isArray(record.basis_refs) && record.basis_refs.length);
	return {
		resource_ref: ref, version: Number(record.version ?? 1), status: record.status,
		summary: resourceSummary(record), summary_kind: record.summary ? "agent_authored" : "extractive_excerpt",
		chars: serialized.length, sha256: createHash("sha256").update(serialized).digest("hex"),
		basis_refs: record.basis_refs ?? record.evidence_refs ?? [],
		...(record.depends_on_refs ? { depends_on_refs: record.depends_on_refs } : {}),
		...(record.supersedes_refs ? { supersedes_refs: record.supersedes_refs } : {}),
		epistemic_status: unverifiedMemory ? "unverified_hypothesis"
			: ["observation", "pre_action_state", "failure", "arc_trajectory_snapshot"].includes(kind) ? "recorded_tool_output_not_causal_interpretation"
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
		(addressedResourceName(match[1], r) === match[2] || r.memory_id === match[2] || r.skill_id === match[2] || r.agent_id === match[2])
		&& Number(r.version ?? 1) === Number(match[3]));
	if (!record) throw new Error(`unknown task-local resource version: ${ref}`);
	return record;
}

export type BoundedTaskResourceResolution = {
	record: Record<string, any>;
	scan: { file_bytes: number; scanned_bytes: number; parsed_records: number; record_bytes: number };
};

/**
 * Exact, authorization-aware lookup for host-side bindings. This deliberately
 * does not call taskRecords(): the binding path admits the JSONL size before a
 * read and reports the scan/parse work to the caller's preparation budget.
 */
export function resolveAuthorizedTaskResourceForBinding(
	pi: ExtensionAPI,
	rootInput: string,
	ref: string,
	options: { max_scan_bytes: number; max_record_bytes: number },
): BoundedTaskResourceResolution {
	const scope = ensureTaskScope(rootInput);
	const root = scope.root;
	const authorization = readerAuthorizations.get(pi);
	if (!authorization) throw new Error("task resource binding authorization is uninitialized");
	if (authorization.root !== root) throw new Error("task resource binding root does not match the initialized reader scope");
	if (authorization.role === "restricted" && !authorization.grants.has(ref)) {
		throw new Error("resource was not granted to this child invocation");
	}
	const match = ref.match(/^([a-z_]+):([^@/\\*]+)@v([1-9]\d*)$/);
	if (!match || !(match[1] in FILES)) throw new Error("binding ref must be one exact kind:name@vN from this task's index");
	const path = join(root, FILES[match[1]]);
	if (!existsSync(path)) throw new Error(`unknown task-local resource version: ${ref}`);
	const actual = relative(realpathSync(root), realpathSync(path));
	if (actual.startsWith("..") || isAbsolute(actual)) throw new Error("resource file resolves outside this task");
	const fileBytes = statSync(path).size;
	if (!Number.isSafeInteger(options.max_scan_bytes) || options.max_scan_bytes < 1 || fileBytes > options.max_scan_bytes) {
		throw new Error(`resource scan exceeds binding preparation limit: ${fileBytes} bytes`);
	}
	const text = readFileSync(path, "utf8");
	let scannedBytes = 0;
	let parsedRecords = 0;
	for (const line of text.split(/\r?\n/)) {
		if (!line) continue;
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		scannedBytes += lineBytes;
		if (lineBytes > options.max_record_bytes) throw new Error(`resource record exceeds binding preparation limit: ${lineBytes} bytes`);
		let record: Record<string, any>;
		try { record = JSON.parse(line); } catch { continue; }
		if (!record || typeof record !== "object" || Array.isArray(record)) continue;
		parsedRecords += 1;
		assertTaskRecordScope(scope, record, FILES[match[1]]);
		if ((addressedResourceName(match[1], record) === match[2] || record.memory_id === match[2]
			|| record.skill_id === match[2] || record.agent_id === match[2])
			&& Number(record.version ?? 1) === Number(match[3])) {
			return { record, scan: { file_bytes: fileBytes, scanned_bytes: scannedBytes, parsed_records: parsedRecords, record_bytes: lineBytes } };
		}
	}
	throw new Error(`unknown task-local resource version: ${ref}`);
}

/** First release of dynamic pure tools is parent-only. Fail closed before any metadata scan. */
export function assertParentTaskResourceBindingHost(pi: ExtensionAPI, rootInput: string): void {
	const root = ensureTaskScope(rootInput).root;
	const authorization = readerAuthorizations.get(pi);
	if (!authorization) throw new Error("task resource binding authorization is uninitialized");
	if (authorization.root !== root) throw new Error("task resource binding root does not match the initialized reader scope");
	if (authorization.role !== "parent") throw new Error("dynamic task resource bindings are not exposed to child invocations");
}

/** Explicit installer hook for a trusted parent-only task-tool extension wrapper. */
export function initializeParentTaskResourceBindingAuthorization(pi: ExtensionAPI, rootInput: string): void {
	const root = ensureTaskScope(rootInput).root;
	if (process.env.PI_TASK_CHILD === "1") throw new Error("child invocations cannot initialize parent task resource authorization");
	const existing = readerAuthorizations.get(pi);
	if (existing && existing.root !== root) throw new Error("task resource binding root does not match the initialized reader scope");
	if (existing?.role === "restricted") throw new Error("restricted task resource authorization cannot be widened");
	readerAuthorizations.set(pi, { root, role: "parent", grants: new Set() });
}

/** Explicit CAS conflict; a failed write never promotes the requested version. */
export function versionConflict(kind: string, record: Record<string, any>, requested: unknown) {
	const details = {
		format: "task-resource-version-conflict-v1", applied: false,
		requested_version: requested ?? null, current_version: record.version,
		current: resourceMetadata(kind, record),
		recovery: "target_version means the CURRENT version, not the new version. Read current if needed, merge intentionally, then retry with target_version. No write was applied.",
	};
	return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

export function installTaskResourceReader(pi: ExtensionAPI, root: string, allowedRefs?: string[]) {
	const scope = ensureTaskScope(root);
	const restricted = allowedRefs !== undefined || process.env.PI_TASK_CHILD === "1";
	const requestedGrants = new Set(allowedRefs ?? []);
	const existingAuthorization = readerAuthorizations.get(pi);
	if (existingAuthorization && existingAuthorization.root !== scope.root) {
		throw new Error("task resource reader cannot be reused across task roots");
	}
	if (!existingAuthorization) {
		readerAuthorizations.set(pi, {
			root: scope.root,
			role: restricted ? "restricted" : "parent",
			grants: requestedGrants,
		});
	} else if (restricted) {
		// A later explicit child install may add its fixed cutoff after another
		// child extension initialized the reader. It can never widen to parent.
		existingAuthorization.role = "restricted";
		for (const ref of requestedGrants) existingAuthorization.grants.add(ref);
	}
	if (installedReaders.has(pi)) return;
	installedReaders.add(pi);
	installTaskResultSemantics(pi);
	const seenPages = new Set<string>();
	const isAllowed = (ref: string) => {
		const authorization = readerAuthorizations.get(pi);
		if (ref.startsWith("tool_result:") && authorization?.role !== "parent") return false;
		if (ref.startsWith("checkpoint:") && authorization?.role === "restricted"
			&& !authorization.grants.has(ref)) return false;
		return authorization?.root === scope.root && (authorization.role === "parent"
			|| authorization.grants.has(ref)
			// Time-indexed evidence cutoffs cannot use a wildcard: later snapshots
			// may include parent actions taken after this child was launched.
			|| (!ref.startsWith("observation_snapshot:")
				&& !ref.startsWith("arc_trajectory_snapshot:")
				&& authorization.grants.has(`${String(ref).split(":", 1)[0]}:*`)));
	};
	pi.registerTool({
		name: "task_resource", label: "Task-local resource index and paged read",
		description: "A ref reads that exact version with either action; offset/limit count JSON characters. Inspect without ref lists up to 20 metadata entries per page; offset/limit then count entries. Full bodies use read.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("inspect"), Type.Literal("read")]),
			kind: Type.Optional(Type.String()), ref: Type.Optional(Type.String()),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536 })),
			force_full: Type.Optional(Type.Boolean({ description: "Compatibility option; read always returns the requested exact page." })),
		}),
		async execute(_id, p) {
			if (p.action === "read" || p.ref !== undefined) {
				const ref = String(p.ref ?? "");
				if (!isAllowed(ref)) throw new Error("resource was not granted to this child invocation");
				const record = resolveTaskResource(root, ref);
				const serialized = JSON.stringify(record);
				const offset = p.offset ?? 0, limit = p.limit ?? 2000;
				const pageKey = JSON.stringify([ref, offset, limit]);
				const repeated = seenPages.has(pageKey);
				// Access history cannot establish final provider-payload coverage.
				// A downstream hook or session rotation may have removed this page.
				// Until exact coverage is known, deliver its body on every read.
				const text = serialized.slice(offset, offset + limit);
				seenPages.add(pageKey);
				const nextOffset = offset + text.length < serialized.length ? offset + text.length : null;
				const provenance = evidenceProvenance({ ref, sourceVersion: Number(record.version ?? 1), operation: "paged_read",
					offset, limit, total: serialized.length, nextOffset });
				const result = {
					ref, offset, limit, total: serialized.length, total_chars: serialized.length, text,
					next_offset: nextOffset,
					truncated: nextOffset !== null,
					provenance,
					visibility: "unknown",
					page_sha256: createHash("sha256").update(text).digest("hex"),
					// These fields describe what this read established. They do not
					// interpret the resource or claim that the research question is
					// answerable.
					page_end: offset + text.length,
					complete: nextOffset === null,
					has_more: nextOffset !== null,
				};
				readWorkset(pi, root).read(_id, result);
				appendFileSync(join(root, "task-resource-access.jsonl"), JSON.stringify(stampTaskRecord(scope, {
					resource_ref: ref, operation: "paged_read", offset, chars: result.text.length,
					limit, total: serialized.length, next_offset: nextOffset, truncated: nextOffset !== null, provenance,
					reader: readerAuthorizations.get(pi)?.role === "restricted" ? "subagent" : "parent",
					repeated_page_request: repeated, visibility: "unknown", page_sha256: result.page_sha256,
					...(readerAuthorizations.get(pi)?.role === "restricted" && process.env.PI_AUTO_RESEARCH_RUN_ID ? {
						research_run_id: process.env.PI_AUTO_RESEARCH_RUN_ID,
						research_session_id: process.env.PI_AUTO_RESEARCH_SESSION_ID ?? null,
					} : {}),
					recordedAt: new Date().toISOString(),
				})) + "\n");
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (p.kind === "tool_result" && readerAuthorizations.get(pi)?.role !== "parent") {
				throw new Error("parent tool results are not available to child invocations");
			}
			const kinds = p.kind ? [p.kind] : Object.keys(FILES)
				.filter((kind) => kind !== "tool_result" && kind !== "checkpoint");
			const index = kinds.flatMap((kind) => {
				const latest = new Map<string, Record<string, any>>();
				for (const record of taskRecords(root, kind)) {
					const metadata = resourceMetadata(kind, record);
					if (!isAllowed(metadata.resource_ref)) continue;
					latest.set(addressedResourceName(kind, record), { ...metadata,
						summary: metadata.summary.slice(0, 240),
						...(metadata.summary.length > 240 ? { summary_truncated: true } : {}),
					});
				}
				return [...latest.values()];
			});
			const offset = p.offset ?? 0;
			const count = Math.min(p.limit ?? 20, 20);
			const result = { total: index.length, resources: index.slice(offset, offset + count),
				additional_kinds: p.kind ? undefined : readerAuthorizations.get(pi)?.role === "parent"
					? ["checkpoint", "tool_result"] : [],
				next_offset: offset + count < index.length ? offset + count : null };
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
}
