/** Stop an ordinary child before another request after its reported allowance. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reportedUsageTokens } from "./pi_reported_token_budget.ts";

export default function installDelegateReportedAllowance(pi: ExtensionAPI) {
	const limit = Number(process.env.PI_DELEGATE_REMAINING_REPORTED_TOKENS);
	if (!Number.isSafeInteger(limit) || limit < 1) return;
	let reported = 0;
	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		reported += reportedUsageTokens(event.message.usage) ?? 0;
		if (reported >= limit && ["toolUse", "length"].includes(event.message.stopReason)) ctx.abort();
	});
	pi.on("before_provider_request", (_event, ctx) => {
		if (reported >= limit) {
			ctx.abort();
			throw new Error("delegate_task reported-token budget exhausted; return to the parent");
		}
	});
}
