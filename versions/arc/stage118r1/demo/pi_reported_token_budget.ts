/** Opt-in shared parent/child stop threshold on reported provider usage. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function reportedUsageTokens(usage: Record<string, any> | undefined): number | undefined {
	if (!usage) return;
	const total = usage.totalTokens ?? usage.total_tokens;
	if (Number.isSafeInteger(total) && total >= 0) return total;
	const input = usage.input ?? usage.input_tokens;
	const output = usage.output ?? usage.output_tokens;
	if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return;
	const cached = [usage.cacheRead ?? usage.cache_read ?? 0, usage.cacheWrite ?? usage.cache_write ?? 0];
	if (cached.some(n => !Number.isSafeInteger(n) || n < 0)) return;
	const computed = input + output + cached[0] + cached[1];
	return Number.isSafeInteger(computed) ? computed : undefined;
}

export function readReportedTokenBudget(path: string, limit: number) {
	let reported = 0, unmeasured = false;
	if (existsSync(path)) {
		try {
			for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
				try {
					const row = JSON.parse(line);
					if (row.event === "unmeasured_usage") unmeasured = true;
					if (row.event === "reported_usage") {
						if (!Number.isSafeInteger(row.tokens) || row.tokens < 0) unmeasured = true;
						else reported += row.tokens;
					}
				} catch { unmeasured = true; }
			}
		} catch { unmeasured = true; }
	}
	// A concurrent partial write or unreadable ledger must not throw from a
	// host-swallowed hook and silently leave the provider loop unbounded.
	return { limit, reported, unmeasured, exhausted: reported >= limit || unmeasured };
}

export function installReportedTokenBudget(pi: ExtensionAPI, root: string) {
	const configured = process.env.PI_PROVIDER_MAX_REPORTED_TOKENS;
	if (!configured) return;
	const limit = Number(configured);
	if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("PI_PROVIDER_MAX_REPORTED_TOKENS must be a positive safe integer");
	// Children inherit this exact root; they must not reset their own allowance.
	const sharedRoot = resolve(process.env.PI_PROVIDER_TOKEN_BUDGET_ROOT ?? root);
	mkdirSync(sharedRoot, { recursive: true });
	const path = join(sharedRoot, "provider-token-budget.jsonl");
	const append = (row: Record<string, any>) => appendFileSync(path, JSON.stringify({ ...row,
		process_id: process.pid, scope: process.env.PI_TASK_CHILD === "1" ? "child" : "parent",
		recordedAt: new Date().toISOString() }) + "\n", "utf8");
	const stopIfExhausted = (ctx: { abort(): void }) => {
		const state = readReportedTokenBudget(path, limit);
		if (state.exhausted) {
			append({ event: "budget_stop", ...state });
			// Throwing in a Pi extension hook is caught by the host and does not
			// stop a request. Abort uses the native shared cancellation signal.
			ctx.abort();
		}
	};
	pi.on("before_agent_start", (_event, ctx) => { stopIfExhausted(ctx); });
	pi.on("context", (_event, ctx) => { stopIfExhausted(ctx); });
	pi.on("before_provider_request", (_event, ctx) => { stopIfExhausted(ctx); });
	pi.on("message_end", (event, ctx) => {
		const message = event.message as any;
		if (message.role !== "assistant") return;
		const tokens = reportedUsageTokens(message.usage);
		// Native providers initialize usage to zero before a request. An error
		// or cancellation can retain that default without proving zero cost.
		const failedDefaultUsage = tokens === 0 && ["error", "aborted"].includes(message.stopReason);
		append(tokens === undefined || failedDefaultUsage ? { event: "unmeasured_usage", stop_reason: message.stopReason }
			: { event: "reported_usage", tokens, stop_reason: message.stopReason });
		stopIfExhausted(ctx);
	});
}
