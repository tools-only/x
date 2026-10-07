/** Compact creator reads only after their exact ref was used by an applied change. */

export const DEFAULT_METHOD_PAGE_CHARS = 8_192;

/** Keep the exact method identity while exposing a large body one page at a time. */
export function projectBaselineMethodPage(result: Record<string, any>, offset = 0, limit = DEFAULT_METHOD_PAGE_CHARS) {
	const body = String(result.content ?? "");
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > body.length) throw new Error("method_offset is outside the method body");
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65_536) throw new Error("method_limit must be 1..65536");
	const end = Math.min(body.length, offset + limit);
	const sections = offset === 0 ? [...body.matchAll(/^#{1,2}\s+(.+)$/gm)].map(match => ({
			heading: match[1].trim(), offset: match.index,
		})) : undefined;
	return {
		...result,
		content: body.slice(offset, end),
		content_offset: offset,
		content_limit: limit,
		total_content_chars: body.length,
		next_content_offset: end < body.length ? end : null,
		content_complete: end === body.length,
		...(sections ? { sections } : {}),
		continue_read_call: end < body.length ? { tool: "task_harness", arguments: {
			action: "read_method", method_name: result.name, method_resource: result.resource,
			expected_sha256: result.sha256, method_offset: end, method_limit: limit,
		} } : null,
	};
}

function jsonResult(message: any): Record<string, any> | undefined {
	const text = (Array.isArray(message?.content) ? message.content : [])
		.find((part: any) => part?.type === "text")?.text;
	if (typeof text !== "string") return undefined;
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	} catch { return undefined; }
}

export function completedCreatorReadCalls(messages: any[]): Set<string> {
	const changedMethods = new Map<string, Set<string>>();
	const earlierReads = new Map<string, Set<string>>();
	const compactable = new Set<string>();
	for (const message of messages) {
		if (message?.role === "assistant") for (const item of Array.isArray(message.content) ? message.content : []) {
			if (String(item?.name ?? item?.toolName ?? "") !== "task_harness") continue;
			const args = item.arguments ?? item.input ?? {};
			if (args.action !== "change") continue;
			const callId = String(item.id ?? item.toolCallId ?? "");
			if (!callId) continue;
			const refs = (Array.isArray(args.changes) ? args.changes : []).map((change: any) => change?.candidate?.authoring_method_ref)
				.filter((ref: unknown): ref is string => typeof ref === "string" && ref.startsWith("baseline_method:"));
			changedMethods.set(callId, new Set(refs));
		}
		if (message?.role !== "toolResult" || !["task_harness", "task_harness_create"].includes(message.toolName)) continue;
		const callId = String(message.toolCallId ?? "");
		if (!callId) continue;
		const result = jsonResult(message);
		if (result?.format === "baseline-method-read-v1" && typeof result.method_ref === "string") {
			const reads = earlierReads.get(result.method_ref) ?? new Set<string>();
			reads.add(callId);
			earlierReads.set(result.method_ref, reads);
		}
		if (result?.format === "task-harness-change-receipt-v1" && result.status === "applied" && !message.isError)
			for (const ref of new Set([...(changedMethods.get(callId) ?? []),
				...(result.results ?? []).filter((row: any) => row.status === "applied")
					.map((row: any) => row.authoring_method_ref).filter((ref: unknown) => typeof ref === "string")]))
				for (const readCall of earlierReads.get(ref) ?? []) compactable.add(readCall);
	}
	return compactable;
}

export function compactCompletedCreatorRead(result: Record<string, any>) {
	return {
		format: "baseline-method-history-receipt-v1", name: result.name,
		resource: result.resource, method_ref: result.method_ref, sha256: result.sha256,
		original_content_chars: Number(result.total_content_chars ?? String(result.content ?? "").length),
		status: "used_in_applied_change_not_utility_evidence",
		read_call: { tool: "task_harness", arguments: {
			action: "read_method", method_name: result.name,
			method_resource: result.resource, expected_sha256: result.sha256,
		} },
	};
}
