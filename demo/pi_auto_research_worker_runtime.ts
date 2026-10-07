/** Parent-boundary scheduler. It never changes the environment or adopts findings. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { researchWorkers, workerRef, updateWorker, routeWorkerEvidence, pendingWorkerEvidence,
	acknowledgeWorkerEvidence, workerOwnUpdates, workerRecords, appendWorkerRecord,
	projectWorkerUpdate } from "./pi_auto_research_workers.ts";
import { taskRecords } from "./pi_task_resource_store.ts";

type Callbacks = {
	refresh: (session: Record<string, any>) => Promise<Record<string, any>>;
	session: (id: string) => Record<string, any> | undefined;
	execute: (id: string, params: any, signal?: AbortSignal) => Promise<any>;
	integrate: (row: Record<string, any>) => void;
};
function childCheckpoint(root: string, id: string) {
	const path = join(root, "task-context-cache", "auto-research-checkpoints", `${id}.json`);
	try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; } catch { return {}; }
}
function outputSpent(root: string, runIds: string[]): number {
	const path = join(root, "subagent-provider-telemetry.jsonl");
	return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
		.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
		.filter(row => row.event === "assistant_message" && runIds.includes(row.run_id))
		.reduce((sum, row) => sum + Number(row.usage?.output ?? 0), 0) : 0;
}
export async function advanceResearchWorkers(root: string, cb: Callbacks): Promise<void> {
	const observation = taskRecords(root, "observation").at(-1);
	const env = observation?.arc_outcome ?? {};
	const budget = env.action_budget ?? {};
	const terminal = ["WIN", "GAME_OVER"].includes(String(env.state))
		|| (Number(budget.total_maximum) > 0 && Number(budget.total_used) >= Number(budget.total_maximum));
	const limit = Math.max(1, Math.min(4, Number(process.env.PI_AUTORESEARCH_WORKER_CONCURRENCY ?? 2) || 2));
	let active = researchWorkers(root).filter(w => cb.session(w.session_id)?.status === "active").length;
	for (let w of researchWorkers(root)) {
		if (w.status !== "authorized") continue;
		w = routeWorkerEvidence(root, w);
		let session = w.session_id ? cb.session(w.session_id) : undefined;
		if (session) {
			const wasActive = session.status === "active";
			session = await cb.refresh(session);
			if (wasActive && session.status !== "active") active--;
			const checkpoint = childCheckpoint(root, session.session_id);
			w = acknowledgeWorkerEvidence(root, w, checkpoint.consumed_evidence_refs ?? []);
			if (["completed", "pending"].includes(session.status) && w.settled_run_id !== session.run_id) {
				const report = taskRecords(root, "research_report").find(row => row.run_id === session!.run_id)?.report;
				if (report) {
					const alreadyPublished = workerOwnUpdates(root, w.worker_id).some(row => row.run_id === session!.run_id
						&& row.lifecycle === "active" && JSON.stringify(row.report) === JSON.stringify(report));
					appendWorkerRecord(root, "update", { format: "auto-research-update-v1", update_id: `${session.run_id}-final`, version: 1,
						worker_id: w.worker_id, research_line_ref: w.research_line_ref, session_id: session.session_id,
						run_id: session.run_id, lifecycle: "completed", priority: !alreadyPublished && (report.research_progress?.parent_relevance === "now"
							|| report.method_candidates?.length || report.experiment_request || report.planning_implications?.length) ? "current" : "later",
						evidence_cutoff: w.evidence_cutoff, report, report_ref: session.report_ref });
				}
				const gained = w.consumed_refs.length - Number(w.consumed_before_run ?? 0);
				w = updateWorker(root, w, { settled_run_id: session.run_id,
					last_report_ref: session.report_ref ?? w.last_report_ref,
					stagnant_runs: gained ? 0 : Number(w.stagnant_runs ?? 0) + 1 });
			}
		}
		for (const update of workerOwnUpdates(root, w.worker_id)) {
			if ((w.integrated_updates ?? []).includes(update.update_id)) continue;
			cb.integrate(update);
			w = updateWorker(root, w, { integrated_updates: [...(w.integrated_updates ?? []), update.update_id] });
		}
		const latestProgress = workerOwnUpdates(root, w.worker_id).at(-1)?.report?.research_progress;
		const reason = terminal ? "task_ended" : session?.status === "failed" || session?.status === "cancelled"
			? `session_${session.status}` : outputSpent(root, w.run_ids ?? []) >= w.max_output_tokens ? "output_budget"
			: Number(w.stagnant_runs ?? 0) >= 2 ? "no_consumption_progress"
			: latestProgress?.status === "drop" || latestProgress?.status === "complete" ? `worker_${latestProgress.status}`
			: session?.status !== "active" && w.started_runs >= w.max_runs ? "run_budget" : null;
		if (reason) {
			let stopError: string | undefined;
			try {
				if (session && ["active", "pending"].includes(session.status)) await cb.execute(`worker-stop:${w.worker_id}`, {
					action: "cancel", session_ref: `research_session:${session.session_id}@v${session.version}`,
					__worker_cancel_run_id: session.run_id });
			} catch (error) { stopError = String(error); }
			if (session?.status === "active" && !stopError) active--;
			updateWorker(root, w, { status: "stopped", stop_reason: reason, ...(stopError ? { stop_error: stopError } : {}) });
			continue;
		}
		// An active snapshot stays immutable. New material waits in this worker's queue.
		if (session?.status === "active" || active >= limit) continue;
		if (session?.status === "pending" && session.checkpoint?.wait_for !== "next_parent_evidence") continue;
		const pending = pendingWorkerEvidence(w);
		if (session?.status === "pending" && !pending.some(ref => !(session!.evidence_refs ?? []).includes(ref))) continue;
		if (w.started_runs && !pending.length) continue;
		const offered = pending.slice(0, 32);
		const resume = session?.status === "pending";
		const ownUpdates = workerOwnUpdates(root, w.worker_id);
		const continuity = [...w.resource_refs, ...w.consumed_refs, w.last_report_ref,
			...ownUpdates.slice(-3).map(row => `research_update:${row.update_id}@v${row.version}`)].filter(Boolean);
		w = updateWorker(root, w, { offered_refs: offered, evidence_cutoff: offered.at(-1) ?? null,
			consumed_before_run: w.consumed_refs.length, started_runs: w.started_runs + 1 });
		try {
			const boundPlanId = /^research_plan:([^@]+)/.exec(w.plan_ref ?? "")?.[1];
			const currentPlan = boundPlanId ? taskRecords(root, "research_plan").filter(p => p.plan_id === boundPlanId).at(-1) : undefined;
			const result = await cb.execute(`worker-dispatch:${w.worker_id}:v${w.version}`, {
				action: resume ? "resume" : "start", ...(resume ? { session_ref: `research_session:${session!.session_id}@v${session!.version}` } : {}),
				question: w.question, research_line_ref: w.research_line_ref, scope: w.scope, research_kind: w.research_kind,
				authoring_method_ref: w.authoring_method_ref, interaction_mode: "non_blocking",
				...(w.started_runs === 1 && currentPlan ? { plan_ref: `research_plan:${currentPlan.plan_id}@v${currentPlan.version}`, node_id: w.node_id } : {}),
				constraints: [...w.constraints, `Assigned responsibility: ${w.responsibility}. Stop when: ${w.stop_when}.`,
					"Keep alternatives, counterexamples and unresolved tests in your durable checkpoint/report. Read exact previous refs to recover cross-stage state.",
					"Acknowledge only actually analyzed offered refs via consumed_evidence_refs in research_checkpoint or publish_research_update. Publish current implications before continuing long analysis; propose further work within this authorization, never create child jobs yourself."],
				evidence_refs: offered, resource_refs: continuity, review_reason: "Authorized responsibility receiving its exact queued evidence batch.",
				context_window: { include_checkpoint: false, max_chars: 800 },
				__worker: { worker_id: w.worker_id, research_line_ref: w.research_line_ref,
					plan_ref: w.plan_ref, node_id: w.node_id,
					offered_refs: offered, evidence_cutoff: w.evidence_cutoff,
					max_output_tokens: w.max_output_tokens, run_ids: w.run_ids ?? [] },
				__worker_checkpoint: session ? childCheckpoint(root, session.session_id) : undefined,
			});
			const details = result.details;
			if (!details?.accepted) throw new Error("worker dispatch was not accepted");
			const sessionId = /^research_session:([^@]+)/.exec(details.session_ref)?.[1];
			if (!sessionId) throw new Error("worker dispatch omitted session identity");
			updateWorker(root, w, { session_id: sessionId, run_ids: [...(w.run_ids ?? []), details.run_id] });
			active++;
		} catch (error) {
			updateWorker(root, w, { status: "stopped", stop_reason: "dispatch_failed", error: String(error) });
		}
	}
}

export const RESEARCH_INCREMENT_PREFIX = "AUTO-RESEARCH COMPLETION INBOX (runtime-delivered once): ";
function incrementItem(row: Record<string, any>, workers: Map<string, Record<string, any>>) {
	const current = workers.get(row.worker_id)?.notification_policy !== "index_only" && row.priority !== "later";
	let item = current ? projectWorkerUpdate(row) : { format: "auto-research-saved-index-v1",
		worker_id: row.worker_id, research_line_ref: row.research_line_ref,
		update_ref: `research_update:${row.update_id}@v${row.version}`, parent_attention: false };
	if (JSON.stringify(item).length > 3600) item = { format: "auto-research-saved-index-v1",
		worker_id: row.worker_id, research_line_ref: row.research_line_ref,
		update_ref: `research_update:${row.update_id}@v${row.version}`, parent_attention: current, details_required: true };
	return item;
}
/** Select only what fits. Preparation leaves the durable delivery cursor untouched. */
export function selectResearchIncrements(root: string): Record<string, any>[] {
	const delivered = new Set(workerRecords(root, "delivery").map(row => row.update_ref));
	const workers = new Map(researchWorkers(root).map(w => [w.worker_id, w]));
	const pending = workerRecords(root, "update").filter(row => !delivered.has(`research_update:${row.update_id}@v${row.version}`))
		.sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"));
	const inbox: Record<string, any>[] = [];
	for (const row of pending) {
		const item = incrementItem(row, workers);
		if (inbox.length >= 2 || JSON.stringify([...inbox, item]).length > 4000) break;
		inbox.push(item);
	}
	return inbox;
}

/** Confirm exact short-card exposure only after the final provider request is accepted. */
export function acknowledgeResearchIncrementPayload(root: string, payload: unknown): void {
	const items: Record<string, any>[] = [];
	const seen = new Set<unknown>();
	const visit = (value: unknown) => {
		if (typeof value === "string" && value.startsWith(RESEARCH_INCREMENT_PREFIX)) {
			try {
				const inbox = JSON.parse(value.slice(RESEARCH_INCREMENT_PREFIX.length));
				if (Array.isArray(inbox)) items.push(...inbox.filter(item => item && typeof item === "object"));
			} catch {} // A clipped or malformed card was not delivered completely.
		} else if (value && typeof value === "object" && !seen.has(value)) {
			seen.add(value);
			for (const child of Object.values(value)) visit(child);
		}
	};
	visit(payload);
	if (!items.length) return;
	const workers = new Map(researchWorkers(root).map(w => [w.worker_id, w]));
	const updates = new Map(workerRecords(root, "update").map(row => [`research_update:${row.update_id}@v${row.version}`, row]));
	const delivered = new Set(workerRecords(root, "delivery").map(row => row.update_ref));
	for (const item of items) {
		const row = updates.get(item.update_ref);
		if (!row || delivered.has(item.update_ref) || JSON.stringify(item) !== JSON.stringify(incrementItem(row, workers))) continue;
		appendWorkerRecord(root, "delivery", { update_ref: item.update_ref, worker_id: row.worker_id,
			status: "delivered", measurement_basis: "accepted_final_provider_payload",
			delivery_kind: item.format === "auto-research-increment-v1" ? "current_increment" : "saved_index" });
		delivered.add(item.update_ref);
	}
}
