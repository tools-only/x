/** Parent-selected replacement of completed, recoverable tool results. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { readWorksetConsumer } from "./pi_read_workset_lifetime.ts";
import { readWorkset } from "./pi_read_workset.ts";
import { controlResultView } from "./pi_result_views.ts";

type Source = { result_id: string; version: 1; tool_name: string; result: unknown; chars: number; result_sha256: string; transient?: boolean };

const TRANSIENT_RESULT_MIN_CHARS = 2000;
function transientRead(toolName: string, input: unknown): boolean {
	const action = String((input as Record<string, unknown> | undefined)?.action ?? "");
	return toolName === "task_resource" || toolName === "research_resource"
		|| toolName === "task_harness_status"
		|| (toolName === "task_checkpoint" && action === "inspect")
		|| (toolName === "task_harness" && ["inspect", "status", "methods"].includes(action));
}

export function installParentContextControl(pi: ExtensionAPI, rootPath: string) {
	if (process.env.PI_TASK_CHILD === "1") throw new Error("parent context control cannot be installed in a child");
	const scope = ensureTaskScope(resolve(rootPath));
	const workset = readWorkset(pi, scope.root);
	const resultPath = join(scope.root, "task-parent-tool-results.jsonl");
	const choicePath = join(scope.root, "task-parent-tool-result-choices.jsonl");
	const sources = new Map<string, Source>();
	const compacted = new Set<string>();
	const pinned = new Set<string>();
	let recentResultRefs = new Set<string>();
	let lastTransientProjection = { result_count: 0, saved_chars: 0 };
	for (const [path, consume] of [
		[resultPath, (row: Record<string, any>) => {
			if (row.result_id && row.version === 1) sources.set(`tool_result:${row.result_id}@v1`, row as Source);
		}],
		[choicePath, (row: Record<string, any>) => {
			for (const ref of row.compact_refs ?? []) { compacted.add(String(ref)); pinned.delete(String(ref)); }
			for (const ref of row.restore_refs ?? []) { compacted.delete(String(ref)); pinned.add(String(ref)); }
		}],
	] as const) {
		if (!existsSync(path)) continue;
		for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
			let row: Record<string, any>;
			try { row = JSON.parse(line); } catch { continue; }
			assertTaskRecordScope(scope, row, path);
			consume(row);
		}
	}
	const append = (path: string, row: Record<string, unknown>) => appendFileSync(path,
		JSON.stringify(stampTaskRecord(scope, { ...row, recordedAt: new Date().toISOString() })) + "\n", "utf8");
	const toolInputs = new Map<string, unknown>();
	pi.on("tool_execution_start", (event) => {
		toolInputs.set(event.toolCallId, event.args);
	});
	pi.on("tool_execution_end", (event) => {
		const input = toolInputs.get(event.toolCallId);
		toolInputs.delete(event.toolCallId);
		if (!event.result || event.isError || ["arc_action", "arc_state"].includes(event.toolName)) return;
		const ref = `tool_result:${event.toolCallId}@v1`;
		if (sources.has(ref)) return;
		let serialized: string;
		try { serialized = JSON.stringify(event.result); } catch { return; }
		const source: Source = { result_id: event.toolCallId, version: 1,
			tool_name: event.toolName, result: event.result, chars: serialized.length,
			result_sha256: createHash("sha256").update(serialized).digest("hex"),
			transient: serialized.length >= TRANSIENT_RESULT_MIN_CHARS && transientRead(event.toolName, input) };
		sources.set(ref, source);
		append(resultPath, source);
	});
	pi.on("context", (event) => {
		// The downstream lifecycle normally retains only a recent tool suffix.
		// Offer the parent that suffix first; old archived results remain readable
		// by exact ref even if they no longer cost provider input.
		recentResultRefs = new Set(event.messages.slice(-30)
			.filter((message: any) => message?.role === "toolResult")
			.map((message: any) => `tool_result:${String(message.toolCallId ?? message.tool_call_id ?? "")}@v1`));
		let laterAssistant = false;
		let laterConsumer = false;
		let transientCount = 0, savedChars = 0;
		const projected = [...event.messages].reverse().map((message: any) => {
			if (message?.role === "assistant") laterAssistant = true;
			if (readWorksetConsumer(message)) laterConsumer = true;
			if (message?.role !== "toolResult") return message;
			const ref = `tool_result:${String(message.toolCallId ?? message.tool_call_id ?? "")}@v1`;
			const source = sources.get(ref);
			if (!source) return message;
			if (source.chars >= 4000 && process.env.PI_CONTEXT_TYPED_RESULTS !== "disabled" && !pinned.has(ref)) {
				const view = controlResultView(source.tool_name, source.result as Record<string, any>, ref);
				if (view) return { ...message, content: [{ type: "text", text: JSON.stringify(view) }],
					details: view };
			}
			const leased = source.tool_name === "task_resource" && workset.required(source.result_id);
			const duplicatePage = source.tool_name === "task_resource" && workset.superseded(source.result_id);
			const expired = Boolean(!pinned.has(ref) && (duplicatePage || (source.transient && !leased
				&& (source.tool_name === "task_resource" ? laterConsumer : laterAssistant))));
			if (compacted.has(ref) || expired) {
				const replacement = { ...message,
					content: [{ type: "text", text: `[Historical ${source.tool_name} result ${expired && !compacted.has(ref) ? (source.tool_name === "task_resource" ? "released after response or action" : "expired after one model continuation") : "selected out of context by parent Agent"}; exact ${ref}, ${source.chars} stored characters. Read with task_resource(action='read',ref='${ref}',offset=0,limit=2000); task_harness(action='restore_results',result_refs=['${ref}']) keeps it in the working set.]` }],
					details: { result_ref: ref, compacted: true, transient_expired: expired } };
				if (expired && !compacted.has(ref)) {
					transientCount += 1;
					savedChars += Math.max(0, JSON.stringify(message).length - JSON.stringify(replacement).length);
				}
				return replacement;
			}
			const wasCompacted = message.content?.some?.((part: any) =>
				part?.type === "text" && String(part.text ?? "").startsWith(`[Historical ${source.tool_name} result `));
			if (!wasCompacted) return leased ? { ...message, read_workset_required: true } : message;
			const original = source.result as Record<string, any>;
			return { ...message, content: original.content, details: original.details, read_workset_required: leased };
		}).reverse();
		lastTransientProjection = { result_count: transientCount, saved_chars: savedChars };
		return { messages: workset.restore(projected, [...sources.entries()]
			.filter(([ref, source]) => source.tool_name === "task_resource" && !compacted.has(ref))
			.map(([, source]) => ({ id: source.result_id, result: source.result }))) };
	});
	return {
		inspect(offset = 0) {
			const candidates = [...sources.entries()]
				.filter(([ref, source]) => source.chars >= 1000 && recentResultRefs.has(ref))
				.sort((a, b) => b[1].chars - a[1].chars);
			const start = Math.max(0, Math.floor(offset));
			return { total: candidates.length, compacted_count: compacted.size, pinned_count: pinned.size,
				transient_projection: lastTransientProjection, offset: start,
				items: candidates.slice(start, start + 8).map(([ref, source]) => ({
					ref, tool: source.tool_name, chars: source.chars,
					result_sha256: source.result_sha256, compacted: compacted.has(ref),
					transient: Boolean(source.transient), pinned: pinned.has(ref),
				})), next_offset: start + 8 < candidates.length ? start + 8 : null };
		},
		choose(action: "compact_results" | "restore_results", refs: string[], reason?: string) {
			const unique = [...new Set(refs.map(String))];
			if (!unique.length || unique.length !== refs.length || unique.some((ref) => !sources.has(ref))) {
				throw new Error("select exact known tool_result refs from task_harness(action='context')");
			}
			if (action === "compact_results" && (!reason?.trim() || reason.length > 500)) {
				throw new Error("compact_results requires a concise reason (1..500 characters)");
			}
			for (const ref of unique) {
				if (action === "compact_results") {
					const source = sources.get(ref)!;
					if (source.tool_name === "task_resource") workset.release([source.result_id], { release_reason: reason });
					compacted.add(ref); pinned.delete(ref);
				}
				else { compacted.delete(ref); pinned.add(ref); }
			}
			append(choicePath, { action, reason: reason?.trim() ?? null,
				...(action === "compact_results" ? { compact_refs: unique } : { restore_refs: unique }) });
			return { applied: true, action, refs: unique, compacted_count: compacted.size,
				recent_history_matches: unique.filter((ref) => recentResultRefs.has(ref)).length,
				exact_read: { tool: "task_resource", arguments: { action: "read", ref: unique[0], offset: 0, limit: 2000 } },
				effective_at: "next_provider_request" };
		},
	};
}
