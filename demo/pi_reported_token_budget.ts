/** Opt-in shared parent/child stop threshold on reported provider usage. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { providerWindowRequestDeclined, takeReportedRequestReservation } from "./pi_provider_request_admission.ts";
import { readReportedTokenBudget, appendReportedTokenBudget } from "./pi_reported_token_ledger.ts";
export { readReportedTokenBudget } from "./pi_reported_token_ledger.ts";
import { join, resolve } from "node:path";
import { get } from "node:http";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const admissionStates = new WeakMap<object, { declined: boolean; responseSeen: boolean }>();
export function reportedBudgetRequestDeclined(pi: ExtensionAPI): boolean {
	const state = admissionStates.get(pi);
	return state?.declined === true && !state.responseSeen;
}

export function reportedUsageTokens(usage: Record<string, any> | undefined, countCache = true): number | undefined {
	if (!usage) return;
	const total = usage.totalTokens ?? usage.total_tokens;
	if (countCache && Number.isSafeInteger(total) && total >= 0) return total;
	const input = usage.input ?? usage.input_tokens;
	const output = usage.output ?? usage.output_tokens;
	if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return;
	const cached = [usage.cacheRead ?? usage.cache_read ?? 0, usage.cacheWrite ?? usage.cache_write ?? 0];
	if (cached.some(n => !Number.isSafeInteger(n) || n < 0)) return;
	const computed = input + output + (countCache ? cached[0] + cached[1] : 0);
	return Number.isSafeInteger(computed) ? computed : undefined;
}

export function installReportedTokenBudget(pi: ExtensionAPI, root: string, options: { countCache?: boolean } = {}) {
	const countCache = options.countCache ?? true;
	const checkpointScope = process.env.PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE ?? "outer_prompt_dispatch";
	if (!["outer_prompt_dispatch", "parent_provider_requests"].includes(checkpointScope)) throw new Error("invalid PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE");
	const configured = process.env.PI_PROVIDER_MAX_REPORTED_TOKENS;
	if (checkpointScope === "parent_provider_requests" && (!configured || !process.env.PI_ARC_NO_LEVEL_REPORTED_TOKENS))
		throw new Error("parent_provider_requests requires shared reported usage and a no-level checkpoint");
	if (!configured) return;
	const limit = Number(configured);
	if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("PI_PROVIDER_MAX_REPORTED_TOKENS must be a positive safe integer");
	// Children inherit this exact root; they must not reset their own allowance.
	const sharedRoot = resolve(process.env.PI_PROVIDER_TOKEN_BUDGET_ROOT ?? root);
	mkdirSync(sharedRoot, { recursive: true });
	const path = join(sharedRoot, "provider-token-budget.jsonl");
	const append = (row: Record<string, any>) => appendReportedTokenBudget(path, { ...row,
		process_id: process.pid, scope: process.env.PI_TASK_CHILD === "1" ? "child" : "parent",
		recordedAt: new Date().toISOString() });
	const writeFirstStop = (stopPath: string, row: Record<string, any>) => {
		try { writeFileSync(stopPath, JSON.stringify(row, null, 2) + "\n", { flag: "wx" }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
	};
	let stoppedLocally = false;
	const admissionState = { declined: false, responseSeen: false };
	admissionStates.set(pi, admissionState);
	const persistStop = (row: Record<string, any>, evaluationStopped = false) => {
		if (evaluationStopped) stoppedLocally = true;
		const stop = { ...row, event: "budget_stop", ...(evaluationStopped ? { evaluation_stopped: true } : {}) };
		try { append(stop); }
		catch {
			// Retain a local cancellation even when both durable writes fail.
			// The independent sibling marker also stops fresh shared readers.
			stoppedLocally = true;
			try { writeFirstStop(join(sharedRoot, "provider-token-budget-stop.json"), { ...stop,
				evaluation_stopped: true, process_id: process.pid, recordedAt: new Date().toISOString() }); } catch {}
		}
	};
	const stopIfExhausted = (ctx: { abort(): void }, admission = false) => {
		const state = readReportedTokenBudget(path, limit);
		if (admission) {
			admissionState.declined = state.exhausted || stoppedLocally;
			admissionState.responseSeen = false;
		}
		if (state.exhausted || stoppedLocally) {
			// Throwing in a Pi extension hook is caught by the host and does not
			// stop a request. Abort uses the native shared cancellation signal.
			ctx.abort();
			if (!state.stopped) persistStop(state, stoppedLocally);
		}
	};
	const parentCheckpoint = checkpointScope === "parent_provider_requests" && process.env.PI_TASK_CHILD !== "1";
	const checkpoint = Number(process.env.PI_ARC_NO_LEVEL_REPORTED_TOKENS);
	if (parentCheckpoint && (!Number.isSafeInteger(checkpoint) || checkpoint <= 0)) throw new Error("invalid no-level checkpoint");
	// Use node:http directly: bridge reads must not enter provider fetch hooks.
	const publicLevels = () => new Promise<number>((accept, reject) => {
		let url: URL;
		try {
			url = new URL(`${process.env.PI_ARC_BRIDGE_URL}/state`);
			if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("local ARC bridge required");
		} catch (error) { reject(error); return; }
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: unknown, levels?: number) => {
			clearTimeout(deadline);
			if (error !== undefined) reject(error); else accept(levels!);
		};
		const request = get(url, response => {
			let body = "", bytes = 0;
			response.setEncoding("utf8");
			response.on("data", part => {
				bytes += Buffer.byteLength(part, "utf8");
				if (bytes > 1024 * 1024) {
					request.destroy(new Error("ARC state body limit exceeded"));
					return;
				}
				body += part;
			});
			response.on("error", error => finish(error));
			response.on("end", () => {
				try {
					if (response.statusCode !== 200) throw new Error(`ARC state HTTP ${response.statusCode}`);
					const value = JSON.parse(body)?.levels_completed;
					if (!Number.isSafeInteger(value) || value < 0) throw new Error("unknown public ARC levels");
					finish(undefined, value);
				} catch (error) { finish(error); }
			});
		});
		request.on("error", error => finish(error));
		deadline = setTimeout(() => request.destroy(new Error("ARC state deadline")), 5000);
		request.on("close", () => clearTimeout(deadline));
	});
	const admitParent = async (ctx: { abort(): void }, hook: string) => {
		if (!parentCheckpoint) return true;
		const started = Date.now();
		let levels: number | null = null, stateError: string | null = null;
		const prior = readReportedTokenBudget(path, checkpoint);
		if (!prior.stopped && !stoppedLocally) {
			try { levels = await publicLevels(); } catch (error) { stateError = String(error); }
		}
		const state = readReportedTokenBudget(path, checkpoint);
		const reason = hook === "session_before_compact" ? "native compaction usage is not measured by shared ledger"
			: state.stopped || stoppedLocally ? "evaluation previously stopped"
				: state.unmeasured ? "unknown provider usage" : stateError ? "unknown current public ARC levels"
				: levels === 0 && state.reported >= checkpoint ? "no first level by declared cost checkpoint" : null;
		const audit = { event: "parent_provider_admission", scope: checkpointScope, hook,
			status: reason ? "declined" : "admitted", reason, limit: checkpoint, reported_tokens: state.reported,
			unmeasured_usage: state.unmeasured, levels_completed: levels, state_error: stateError,
			provider_http_started: false, check_duration_ms: Date.now() - started,
			native_compaction_policy: "decline_unmeasured", process_id: process.pid, recordedAt: new Date().toISOString() };
		if (reason) {
			admissionState.declined = true;
			ctx.abort();
			if (!state.stopped) persistStop({ reason, hook, ...state }, true);
		}
		try {
			appendFileSync(join(root, "arc-parent-provider-admission.jsonl"), JSON.stringify(audit) + "\n", "utf8");
			if (reason) {
				writeFirstStop(join(root, "arc-parent-provider-admission-stop.json"), audit);
			}
		} catch {
			admissionState.declined = true;
			ctx.abort();
			const failed = { ...audit, status: "declined", reason: reason ?? "parent admission audit write failed" };
			if (!state.stopped) persistStop({ reason: failed.reason, hook, ...state }, true);
			try { writeFirstStop(join(root, "arc-parent-provider-admission-stop.json"), failed); } catch {}
			return false;
		}
		return !reason;
	};
	pi.on("before_agent_start", (_event, ctx) => { stopIfExhausted(ctx, true); });
	pi.on("context", async (_event, ctx) => { stopIfExhausted(ctx, true); await admitParent(ctx, "context"); });
	pi.on("before_provider_request", async (_event, ctx) => { stopIfExhausted(ctx, true); await admitParent(ctx, "before_provider_request"); });
	pi.on("after_provider_response", () => { admissionState.responseSeen = true; });
	pi.on("session_before_compact", async (_event, ctx) => {
		if (parentCheckpoint && !await admitParent(ctx, "session_before_compact")) return { cancel: true };
	});
	pi.on("message_end", (event, ctx) => {
		const message = event.message as any;
		if (message.role !== "assistant") return;
		const tokens = reportedUsageTokens(message.usage, countCache);
		const reservationId = takeReportedRequestReservation(pi);
		const reservation = reservationId ? { reservation_id: reservationId } : {};
		// Pi emits a synthetic aborted message for a declined request. This is
		// distinct from a request whose accepted HTTP response omitted usage.
		if ((reportedBudgetRequestDeclined(pi) || providerWindowRequestDeclined(pi)) && message.stopReason === "aborted" && (tokens === undefined || tokens === 0)) {
			try { append({ ...reservation, event: "request_declined", stop_reason: message.stopReason, provider_request_admitted: false }); }
			catch {
				ctx.abort();
				persistStop({ reason: "declined request settlement write failed" }, true);
			}
			return;
		}
		// Native providers initialize usage to zero; even normal completion can
		// retain that default. Nonempty requests with all-zero usage are unmeasured.
		try {
			append(tokens === undefined || tokens === 0 ? { ...reservation, event: "unmeasured_usage", stop_reason: message.stopReason }
				: { ...reservation, event: "reported_usage", tokens, stop_reason: message.stopReason });
		} catch {
			ctx.abort();
			persistStop({ reason: "reported usage ledger write failed", stop_reason: message.stopReason }, true);
			return;
		}
		stopIfExhausted(ctx);
	});
}
