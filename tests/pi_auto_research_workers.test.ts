import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assignResearchWorker, researchWorkers, routeWorkerEvidence, workerRecords, appendWorkerRecord,
	pendingWorkerEvidence, acknowledgeWorkerEvidence, resolveWorker, workerRef, updateWorker,
	researchWorkerWindowCoverage } from "../demo/pi_auto_research_workers.ts";
import { advanceResearchWorkers, selectResearchIncrements, acknowledgeResearchIncrementPayload,
	RESEARCH_INCREMENT_PREFIX } from "../demo/pi_auto_research_worker_runtime.ts";
import { ensureTaskScope, stampTaskRecord } from "../demo/pi_task_scope.ts";
import { resolveTaskResource } from "../demo/pi_task_resource_store.ts";
import { installProviderTelemetry } from "../demo/pi_provider_telemetry.ts";

function root() { const base = resolve(".tmp/worker-tests"); mkdirSync(base, { recursive: true }); return mkdtempSync(join(base, "case-")); }
function assign(p: string, extra = {}) { return assignResearchWorker(p, { worker_id: "rules", responsibility: "Track competing rules",
	question: "Which rule explains the observed transitions?", research_line_ref: "research_line:rules@v1",
	stop_when: "Decisive counterexample or run bound", max_runs: 3, max_output_tokens: 1000,
	evidence_kinds: ["observation", "effect_assessment"], handle_periodic_reviews: true, ...extra }); }
function observation(p: string, id: string, extra = {}) {
	appendFileSync(join(p, "execution-observations.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(p), {
		observation_id: id, version: 1, tool_name: "arc_action", ...extra })) + "\n");
}
test("queue/read grants never consume evidence; duplicate routing and CAS", () => {
	const p = root(); let w = assign(p); observation(p, "o1");
	w = routeWorkerEvidence(p, w); assert.deepEqual(w.consumed_refs, []);
	assert.equal(workerRecords(p, "batch").length, 1);
	assert.equal(routeWorkerEvidence(p, w).version, w.version);
	assert.throws(() => resolveWorker(p, "research_worker:rules@v1"), /stale/);
	assert.throws(() => acknowledgeWorkerEvidence(p, w, ["observation:o1@v1"]), /offered/);
	w = updateWorker(p, w, { offered_refs: pendingWorkerEvidence(w) });
	w = acknowledgeWorkerEvidence(p, w, ["observation:o1@v1"]);
	assert.deepEqual(pendingWorkerEvidence(w), []);
	assert.equal(resolveTaskResource(p, workerRef(w)).worker_id, "rules");
});
test("new stages and assessment versions stay exact; orchestration cannot drive a loop", () => {
	const p = root(); let w = assign(p); observation(p, "read", { tool_name: "task_resource" });
	observation(p, "first"); observation(p, "reset", { arc_outcome: { public_transition: { level_changed: true } } });
	appendFileSync(join(p, "effect-assessments.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(p), {
		effect_assessment_id: "a1", version: 2 })) + "\n");
	w = routeWorkerEvidence(p, w);
	assert.deepEqual(w.seen_refs, ["observation:first@v1", "observation:reset@v1", "effect_assessment:a1@v2"]);
	assert.throws(() => acknowledgeWorkerEvidence(p, w, ["effect_assessment:a1@v1"]), /offered/);
});
test("two responsibilities preserve disagreement and delivery overflow does not lose a tail", () => {
	const p = root(); assign(p); assign(p, { worker_id: "counterexamples" });
	for (let i = 0; i < 3; i++) appendWorkerRecord(p, "update", { update_id: `u${i}`, version: 1,
		worker_id: i === 1 ? "counterexamples" : "rules", research_line_ref: "research_line:rules@v1",
		lifecycle: "active", priority: i === 1 ? "urgent" : "current", report: { conclusion: `hypothesis ${i}` } });
	const ack = (items: any[]) => acknowledgeResearchIncrementPayload(p,
		{ messages: [{ role: "user", content: RESEARCH_INCREMENT_PREFIX + JSON.stringify(items) }] });
	const first = selectResearchIncrements(p); assert.equal(first.length, 2);
	assert.equal(first[0].worker_id, "counterexamples");
	assert.deepEqual(selectResearchIncrements(p), first);
	assert.equal(workerRecords(p, "delivery").length, 0);
	ack(first);
	const tail = selectResearchIncrements(p); assert.equal(tail.length, 1);
	ack(tail);
	assert.deepEqual(selectResearchIncrements(p), []);
	assert.equal(workerRecords(p, "delivery").length, 3);
	assert.equal(resolveTaskResource(p, "research_update:u1@v1").update_id, "u1");
});
test("revoking a worker preserves analyzed windows, but leaves unanalyzed windows pending", () => {
	const p = root(); let w = assign(p); observation(p, "o1"); observation(p, "o2");
	w = routeWorkerEvidence(p, w); w = updateWorker(p, w, { offered_refs: w.seen_refs });
	w = acknowledgeWorkerEvidence(p, w, ["observation:o1@v1"]);
	w = updateWorker(p, w, { status: "revoked" });
	assert.equal(researchWorkerWindowCoverage(p, ["o1"]).length, 1);
	assert.equal(researchWorkerWindowCoverage(p, ["o2"]).length, 0);
});
test("scheduler freezes an active cutoff while queueing new evidence", async () => {
	const p = root(); let w = assign(p); observation(p, "o1"); w = routeWorkerEvidence(p, w);
	w = updateWorker(p, w, { session_id: "s1", offered_refs: ["observation:o1@v1"], started_runs: 1 });
	observation(p, "o2"); let launches = 0;
	await advanceResearchWorkers(p, { session: () => ({ session_id: "s1", status: "active", run_id: "r1" }),
		refresh: async s => s, execute: async () => { launches++; }, integrate: () => {} });
	const current = researchWorkers(p)[0]; assert.equal(launches, 0);
	assert.deepEqual(current.offered_refs, ["observation:o1@v1"]);
	assert.deepEqual(current.seen_refs, ["observation:o1@v1", "observation:o2@v1"]);
});
test("exhausted run budget stops without spawning; task termination cancels active worker", async () => {
	const p = root(); let w = assign(p, { max_runs: 1 });
	w = updateWorker(p, w, { started_runs: 1 }); let calls = 0;
	const cb = { session: () => undefined, refresh: async (s: any) => s, execute: async () => { calls++; }, integrate: () => {} };
	await advanceResearchWorkers(p, cb); assert.equal(calls, 0); assert.equal(researchWorkers(p)[0].stop_reason, "run_budget");
	const p2 = root(); let w2 = assign(p2); w2 = updateWorker(p2, w2, { session_id: "s1" });
	observation(p2, "terminal", { arc_outcome: { state: "WIN" } });
	await advanceResearchWorkers(p2, { ...cb, session: () => ({ session_id: "s1", version: 1, status: "active" }),
		execute: async (_id, args) => { assert.equal(args.action, "cancel"); calls++; } });
	assert.equal(calls, 1); assert.equal(researchWorkers(p2)[0].stop_reason, "task_ended");
});
test("serial telemetry clears a cancelled attempt and counts reasoning only within output", () => {
	const p = root(); const hooks: Record<string, Function> = {};
	const pi = { on: (name: string, fn: Function) => { hooks[name] = fn; } };
	installProviderTelemetry(pi as any, { root: p, scope: "test" });
	hooks.before_provider_request({ payload: { messages: [], tools: [] } });
	hooks.message_end({ message: { role: "assistant", stopReason: "aborted", usage: { input: 0, output: 0 } } });
	hooks.before_provider_request({ payload: { messages: [], tools: [] } });
	hooks.after_provider_response({ status: 200, headers: {} });
	hooks.message_end({ message: { role: "assistant", stopReason: "stop", usage: { input: 5, output: 10, reasoning: 7 } } });
	const rows = readFileSync(join(p, "provider-telemetry.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
	const header = rows.find(r => r.event === "provider_response");
	const messages = rows.filter(r => r.event === "assistant_message");
	assert.equal(header.request_id, "test-provider-2"); assert.equal(messages[1].request_id, header.request_id);
	assert.equal(messages[1].usage.reasoning, 7); assert.equal(messages[1].usage.non_reasoning_output, 3);
	assert.equal(messages[0].usage.reasoning, null);
	assert.equal(header.measurement_basis, "response_headers_only");
});
test("attempt replaced without message_end is retired before subsequent response", () => {
	const p = root(); const hooks: Record<string, Function> = {};
	installProviderTelemetry({ on: (name, fn) => { hooks[name] = fn; } } as any, { root: p, scope: "retry" });
	hooks.before_provider_request({ payload: {} }); hooks.before_provider_request({ payload: {} });
	hooks.after_provider_response({ status: 200, headers: {} });
	const rows = readFileSync(join(p, "provider-telemetry.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
	assert.equal(rows.find(r => r.event === "provider_attempt_superseded").request_id, "retry-provider-1");
	assert.equal(rows.find(r => r.event === "provider_response").request_id, "retry-provider-2");
});
test("output budget stops scheduling even when the child never submitted a report", async () => {
	const p = root(); let w = assign(p, { max_output_tokens: 10 });
	w = updateWorker(p, w, { run_ids: ["auto-research-1"], started_runs: 1 });
	appendFileSync(join(p, "subagent-provider-telemetry.jsonl"), JSON.stringify({ event: "assistant_message",
		run_id: "auto-research-1", usage: { output: 10, reasoning: 8 } }) + "\n");
	let launched = false;
	await advanceResearchWorkers(p, { session: () => undefined, refresh: async s => s,
		execute: async () => { launched = true; }, integrate: () => {} });
	assert.equal(launched, false); assert.equal(researchWorkers(p)[0].stop_reason, "output_budget");
});
test("broker cancellation failure is recorded without losing the stop decision", async () => {
	const p = root(); let w = assign(p); w = updateWorker(p, w, { session_id: "s1" });
	observation(p, "terminal", { arc_outcome: { state: "WIN" } });
	await advanceResearchWorkers(p, { session: () => ({ session_id: "s1", status: "active", version: 1 }),
		refresh: async s => s, execute: async () => { throw new Error("broker unavailable"); }, integrate: () => {} });
	const final = researchWorkers(p)[0]; assert.equal(final.status, "stopped");
	assert.match(final.stop_error, /broker unavailable/);
});

test("failed child cancellation keeps its concurrency slot for the next authorized responsibility", async () => {
	const p = root(); let w = assign(p, { max_output_tokens: 10 });
	w = updateWorker(p, w, { session_id: "s1", run_ids: ["r1"], started_runs: 1 });
	assign(p, { worker_id: "later" });
	appendFileSync(join(p, "subagent-provider-telemetry.jsonl"), JSON.stringify({
		event: "assistant_message", run_id: "r1", usage: { output: 10 } }) + "\n");
	const prior = process.env.PI_AUTORESEARCH_WORKER_CONCURRENCY;
	process.env.PI_AUTORESEARCH_WORKER_CONCURRENCY = "1";
	const dispatches: string[] = [];
	try {
		await advanceResearchWorkers(p, {
			session: id => id === "s1" ? { session_id: "s1", status: "active", version: 1 } : undefined,
			refresh: async s => s, integrate: () => {}, execute: async (_id, params) => {
				dispatches.push(params.action);
				if (params.action === "cancel") throw new Error("broker unavailable");
				return { content: [{ type: "text", text: JSON.stringify({ session_id: "s2", status: "active" }) }] };
			},
		});
		assert.deepEqual(dispatches, ["cancel"]);
		const workers = researchWorkers(p);
		assert.equal(workers.find(row => row.worker_id === "rules")?.status, "stopped");
		assert.equal(workers.find(row => row.worker_id === "later")?.started_runs, 0);
	} finally {
		if (prior === undefined) delete process.env.PI_AUTORESEARCH_WORKER_CONCURRENCY;
		else process.env.PI_AUTORESEARCH_WORKER_CONCURRENCY = prior;
	}
});
