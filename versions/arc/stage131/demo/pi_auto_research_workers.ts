/** Durable responsibilities, exact evidence batches and bounded worker scheduling.
 * Scientific choices are supplied by the parent/worker; this module only routes facts.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ensureTaskScope, stampTaskRecord, assertTaskRecordsScope } from "./pi_task_scope.ts";
import { taskRecords, resourceMetadata } from "./pi_task_resource_store.ts";

export const WORKER_EVIDENCE_KINDS = ["observation", "pre_action_state", "validation",
	"effect_assessment", "harness_observation", "harness_assembly", "level_review",
	"memory", "skill", "tool", "subagent", "system_prompt"] as const;
export type ResearchWorker = Record<string, any>;
const files = { worker: "auto-research-workers.jsonl", batch: "auto-research-evidence-batches.jsonl",
	update: "auto-research-updates.jsonl", delivery: "auto-research-deliveries.jsonl" };
export function workerRecords(root: string, kind: keyof typeof files): Record<string, any>[] {
	const path = join(root, files[kind]);
	if (!existsSync(path)) return [];
	const rows = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
		try { return [JSON.parse(line)]; } catch { return []; } // A live writer may still be appending the last line.
	});
	assertTaskRecordsScope(ensureTaskScope(root), rows, files[kind]);
	return rows;
}
export function appendWorkerRecord(root: string, kind: keyof typeof files, row: Record<string, any>) {
	appendFileSync(join(root, files[kind]), JSON.stringify(stampTaskRecord(ensureTaskScope(root), {
		...row, recordedAt: new Date().toISOString(),
	})) + "\n", "utf8");
}
export function researchWorkers(root: string): ResearchWorker[] {
	return [...new Map(workerRecords(root, "worker").map(row => [row.worker_id, row])).values()];
}
export function workerRef(w: ResearchWorker): string { return `research_worker:${w.worker_id}@v${w.version}`; }
export function updateWorker(root: string, w: ResearchWorker, patch: Record<string, any>): ResearchWorker {
	const latest = researchWorkers(root).find(row => row.worker_id === w.worker_id);
	if (latest && latest.version !== w.version) throw new Error("research worker version conflict");
	const next = { ...w, ...patch, version: Number(w.version ?? 0) + 1 };
	appendWorkerRecord(root, "worker", next);
	return next;
}
export function resolveWorker(root: string, ref: string): ResearchWorker {
	const match = /^research_worker:([A-Za-z0-9_.-]+)@v([1-9]\d*)$/.exec(ref);
	const w = match && researchWorkers(root).find(row => row.worker_id === match[1]);
	if (!w || Number(match![2]) !== w.version) throw new Error("unknown or stale research_worker reference");
	return w;
}
export function assignResearchWorker(root: string, input: Record<string, any>): ResearchWorker {
	for (const field of ["worker_id", "responsibility", "question", "research_line_ref", "stop_when"])
		if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`assignment requires ${field}`);
	if (!/^[A-Za-z0-9_.-]+$/.test(input.worker_id)) throw new Error("invalid worker_id");
	if (!/^research_line:[^@]+@v[1-9]\d*$/.test(input.research_line_ref)) throw new Error("invalid research_line_ref");
	if (researchWorkers(root).some(w => w.worker_id === input.worker_id))
		throw new Error("worker_id already assigned; revoke explicitly before assigning a new identity");
	const kinds = [...new Set(input.evidence_kinds ?? ["observation", "validation", "effect_assessment", "harness_observation"])];
	if (!kinds.length || kinds.some(k => !WORKER_EVIDENCE_KINDS.includes(k as any))) throw new Error("unsupported evidence_kinds");
	for (const key of ["max_runs", "max_output_tokens"]) if (!Number.isSafeInteger(input[key]) || input[key] < 1)
		throw new Error(`assignment requires a positive ${key}`);
	const w: ResearchWorker = { format: "auto-research-worker-v1", worker_id: input.worker_id, version: 0,
		status: "authorized", responsibility: input.responsibility, question: input.question,
		research_line_ref: input.research_line_ref, stop_when: input.stop_when, evidence_kinds: kinds,
		max_runs: input.max_runs, max_output_tokens: input.max_output_tokens,
		scope: input.scope ?? "research_method", research_kind: input.research_kind ?? "exploration",
		constraints: input.constraints ?? [], resource_refs: input.resource_refs ?? [],
		plan_ref: input.plan_ref ?? null, node_id: input.node_id ?? null,
		authoring_method_ref: input.authoring_method_ref,
		notification_policy: input.notification_policy ?? "current",
		handle_periodic_reviews: input.handle_periodic_reviews === true,
		started_runs: 0, consumed_refs: [], seen_refs: [], session_id: null, last_report_ref: null };
	return updateWorker(root, w, {});
}
export function workerEvidence(root: string, w: ResearchWorker): string[] {
	return [...new Set(w.evidence_kinds.flatMap((kind: string) => taskRecords(root, kind)
		// Orchestration reads are not evidence updates, and cannot drive a loop.
		.filter(row => kind !== "observation" || (!row.is_error && !/^(task_|auto_research$|delegate_task$|research_)/.test(String(row.tool_name ?? ""))))
		.map(row => resourceMetadata(kind, row).resource_ref)))];
}
/** Queueing/read grants are distinct from the worker's explicit consumption receipt. */
export function routeWorkerEvidence(root: string, w: ResearchWorker): ResearchWorker {
	if (w.status !== "authorized") return w;
	const known = new Set(w.seen_refs);
	const refs = workerEvidence(root, w).filter(ref => !known.has(ref));
	if (!refs.length) return w;
	const id = createHash("sha256").update(JSON.stringify([w.worker_id, refs])).digest("hex").slice(0, 20);
	appendWorkerRecord(root, "batch", { format: "auto-research-evidence-batch-v1", batch_id: id, version: 1,
		worker_id: w.worker_id, research_line_ref: w.research_line_ref, evidence_refs: refs,
		cutoff_refs: refs.slice(-1), status: "queued", consumed: false });
	return updateWorker(root, w, { seen_refs: [...w.seen_refs, ...refs] });
}
export function pendingWorkerEvidence(w: ResearchWorker): string[] {
	const consumed = new Set(w.consumed_refs);
	return w.seen_refs.filter((ref: string) => !consumed.has(ref));
}
export function acknowledgeWorkerEvidence(root: string, w: ResearchWorker, refs: string[]): ResearchWorker {
	const offered = new Set([...(w.offered_refs ?? []), ...w.consumed_refs]);
	if (refs.some(ref => !offered.has(ref))) throw new Error("worker cannot consume evidence outside its exact offered batch");
	const merged = [...new Set([...w.consumed_refs, ...refs])];
	return merged.length === w.consumed_refs.length ? w : updateWorker(root, w, { consumed_refs: merged });
}
export function workerOwnUpdates(root: string, workerId: string): Record<string, any>[] {
	return workerRecords(root, "update").filter(row => row.worker_id === workerId);
}
/** Short parent projection. Full reports and independent disagreements stay addressable. */
export function projectWorkerUpdate(row: Record<string, any>): Record<string, any> {
	const r = row.report ?? {};
	return { format: "auto-research-increment-v1", update_ref: `research_update:${row.update_id}@v${row.version}`,
		worker_id: row.worker_id, research_line_ref: row.research_line_ref, run_id: row.run_id,
		lifecycle: row.lifecycle, priority: row.priority, revises_ref: row.revises_ref ?? null,
		withdraws_ref: row.withdraws_ref ?? null, evidence_cutoff: row.evidence_cutoff,
		conclusion: String(r.conclusion ?? ""), status: r.status,
		alternatives: r.alternatives ?? [], limitations: r.limitations ?? [],
		counterevidence: r.counterevidence ?? [], uncertainty: r.uncertainty ?? null,
		evidence_refs: (r.evidence_refs ?? []).slice(-3),
		parent_request: r.experiment_request ?? null,
		method_candidates: (r.method_candidates ?? []).slice(0, 3).map((m: any) => m.candidate_ref),
		planning_implications: (r.planning_implications ?? []).length ? "Read update_ref before changing the current plan" : null,
		next_step: String(r.research_progress?.next_step ?? "").slice(0, 180),
		adoption: "Parent checks live state, reads creator, creates/changes, assembles exact versions, trials and feeds results to this line." };
}
export function researchWorkerWindowCoverage(root: string, evidenceRefs: string[]): string[] {
	const canonical = (ref: string) => ref.startsWith("observation:") ? ref : `observation:${ref}@v1`;
	return researchWorkers(root).filter(w => w.handle_periodic_reviews && w.evidence_kinds.includes("observation")
		&& (evidenceRefs.every(ref => w.consumed_refs.includes(canonical(ref)))
			|| (w.status === "authorized" && (w.started_runs < w.max_runs || w.session_id)
				&& evidenceRefs.every(ref => w.seen_refs.includes(canonical(ref)))))).map(w => workerRef(w));
}
