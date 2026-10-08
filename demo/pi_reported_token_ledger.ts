/** Shared reported usage and final-request reservations; no Agent-facing protocol. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export function reportedRequestAdmissionEnabled(): boolean {
	const configured = process.env.PI_PROVIDER_REPORTED_ADMISSION;
	if (configured !== undefined && !["enabled", "disabled"].includes(configured))
		throw new Error("PI_PROVIDER_REPORTED_ADMISSION must be enabled or disabled");
	return configured !== "disabled" && process.env.PI_PROVIDER_CONTEXT_ADMISSION === "enabled"
		&& !!process.env.PI_PROVIDER_MAX_REPORTED_TOKENS;
}

export function readReportedTokenBudget(path: string, limit: number) {
	let reported = 0, unmeasured = false;
	let stopped = existsSync(join(dirname(path), "provider-token-budget-stop.json"));
	const reservations = new Map<string, number>();
	if (existsSync(path)) {
		try {
			for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
				try {
					const row = JSON.parse(line);
					if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid budget record");
					if (row.event === "unmeasured_usage") unmeasured = true;
					if (row.event === "budget_stop" && row.evaluation_stopped === true) stopped = true;
					if (row.event === "request_reserved") {
						if (typeof row.reservation_id !== "string" || !row.reservation_id
							|| reservations.has(row.reservation_id) || !Number.isSafeInteger(row.tokens) || row.tokens <= 0)
							throw new Error("invalid request reservation");
						reservations.set(row.reservation_id, row.tokens);
					}
					if (["reported_usage", "unmeasured_usage", "request_declined"].includes(row.event) && row.reservation_id !== undefined) {
						if (!reservations.delete(row.reservation_id)) throw new Error("unknown request settlement");
					}
					if (row.event === "reported_usage") {
						if (!Number.isSafeInteger(row.tokens) || row.tokens < 0) unmeasured = true;
						else {
							reported += row.tokens;
							if (!Number.isSafeInteger(reported)) unmeasured = true;
						}
					}
				} catch { unmeasured = true; }
			}
		} catch { unmeasured = true; }
	}
	const reserved = [...reservations.values()].reduce((sum, value) => sum + value, 0);
	if (!Number.isSafeInteger(reserved) || !Number.isSafeInteger(reported + reserved)) unmeasured = true;
	// Crashed requests stay reserved. Never infer a free request from PID death.
	return { limit, reported, reserved, unmeasured, stopped, exhausted: reported >= limit || unmeasured || stopped };
}

function withReportedBudgetLock<T>(path: string, work: () => T): T {
	const lockPath = path + ".lock";
	const deadline = Date.now() + 500;
	const sleeper = new Int32Array(new SharedArrayBuffer(4));
	for (;;) {
		try { mkdirSync(lockPath); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
			// Separate parent/child processes may briefly settle concurrently.
			Atomics.wait(sleeper, 0, 0, 5);
		}
	}
	try { return work(); }
	finally { rmdirSync(lockPath); }
}

export function appendReportedTokenBudget(path: string, row: Record<string, unknown>): void {
	const append = () => appendFileSync(path, JSON.stringify(row) + "\n", "utf8");
	if (reportedRequestAdmissionEnabled()) withReportedBudgetLock(path, append);
	else append();
}

export function reserveReportedTokenBudget(path: string, limit: number, tokens: number) {
	return withReportedBudgetLock(path, () => {
		const state = readReportedTokenBudget(path, limit);
		const remaining = limit - state.reported - state.reserved;
		const reason = !Number.isSafeInteger(limit) || limit <= 0 ? "reported_budget_limit_invalid"
			: !Number.isSafeInteger(tokens) || tokens <= 0 ? "reported_request_reserve_invalid"
				: state.unmeasured ? "reported_usage_unknown" : state.stopped ? "reported_evaluation_stopped"
					: state.exhausted || tokens > remaining ? "reported_request_reserve_exceeded" : null;
		const reservationId = reason ? undefined : randomUUID();
		if (reservationId) appendFileSync(path, JSON.stringify({ event: "request_reserved",
			reservation_id: reservationId, tokens, process_id: process.pid,
			scope: process.env.PI_TASK_CHILD === "1" ? "child" : "parent", recordedAt: new Date().toISOString() }) + "\n", "utf8");
		return { ...state, remaining, reason, reservation_id: reservationId };
	});
}
