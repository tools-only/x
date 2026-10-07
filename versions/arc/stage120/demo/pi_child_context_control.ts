/** Agent-selected context representation for isolated, read-only Pi children. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readWorksetConsumer } from "./pi_read_workset_lifetime.ts";
import { readWorkset } from "./pi_read_workset.ts";

type Source = { ref: string; tool_name: string; result: unknown; chars: number; transient?: boolean };
const TRANSIENT_RESULT_MIN_CHARS = 2000;
type Choice = { control: string; before: unknown; after: unknown; baseline: Record<string, any> | null };

export function installChildContextControl(pi: ExtensionAPI, rootPath: string): void {
	const root = resolve(rootPath);
	const workset = readWorkset(pi, root);
	const contextId = process.env.PI_TASK_CHILD_CONTEXT_ID ?? `pid-${process.pid}`;
	const key = createHash("sha256").update(contextId).digest("hex");
	const directory = join(root, "task-context-cache", "child-context");
	const ledgerPath = join(directory, `${key}.jsonl`);
	const telemetryPath = join(root, "subagent-context-token-debug.jsonl");
	mkdirSync(directory, { recursive: true });
	const sources = new Map<string, Source>();
	const consumptionInputs = new Map<string, any>();
	pi.on("tool_execution_start", event => consumptionInputs.set(event.toolCallId, event.args));
	pi.on("tool_execution_end", event => {
		const input = consumptionInputs.get(event.toolCallId); consumptionInputs.delete(event.toolCallId);
		if (event.isError || !["research_checkpoint", "publish_research_update"].includes(event.toolName)
			|| !Array.isArray(input?.consumed_evidence_refs)) return;
		workset.releaseEvidence(input.consumed_evidence_refs, {
			release_reason: `Agent explicitly acknowledged evidence in successful ${event.toolName}`,
		});
	});
	const compacted = new Set<string>();
	const pinned = new Set<string>();
	let continuitySummary = "";
	let lastTransientProjection = { result_count: 0, saved_chars: 0 };
	let lastChoice: Choice | undefined;
	let selectedReadTools: string[] | undefined;
	const records = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean) : [];
	for (const line of records) {
		let row: Record<string, any>;
		try { row = JSON.parse(line); } catch { continue; }
		if (row.event === "source" && typeof row.ref === "string") sources.set(row.ref, row as Source);
		if (row.event === "choice") {
			for (const ref of row.compact_refs ?? []) { compacted.add(String(ref)); pinned.delete(String(ref)); }
			for (const ref of row.restore_refs ?? []) { compacted.delete(String(ref)); pinned.add(String(ref)); }
			continuitySummary = typeof row.summary === "string" ? row.summary : continuitySummary;
			lastChoice = row as Choice;
			if (row.control === "tools" && Array.isArray(row.after)) selectedReadTools = row.after.map(String);
		}
	}
	const append = (row: Record<string, unknown>) => appendFileSync(ledgerPath,
		JSON.stringify({ ...row, recordedAt: new Date().toISOString() }) + "\n", "utf8");
	const moduleCosts = (snapshot: Record<string, any> | undefined) => Object.entries(snapshot?.modules ?? {})
		.map(([name, stats]) => ({ name, estimated_tokens: Number((stats as any)?.estimated_tokens ?? 0) }))
		.sort((left, right) => right.estimated_tokens - left.estimated_tokens);
	const latestRequest = () => {
		if (!existsSync(telemetryPath)) return undefined;
		let latest: Record<string, any> | undefined;
		for (const line of readFileSync(telemetryPath, "utf8").split(/\r?\n/)) {
			if (!line) continue;
			let row: Record<string, any>;
			try { row = JSON.parse(line); } catch { continue; }
			if (row.event !== "provider_request_context") continue;
			if (process.env.PI_TASK_CHILD_CONTEXT_ID
				? row.child_context_id !== contextId : row.process_id !== process.pid) continue;
			latest = row;
		}
		return latest;
	};
	const requestKey = (request: Record<string, any> | null | undefined) =>
		request ? `${String(request.process_id ?? "")}:${String(request.request_id ?? "")}` : "";
	const baseline = () => {
		const request = latestRequest();
		return request ? {
			process_id: request.process_id, request_id: request.request_id,
			measurement_basis: request.measurement_basis,
			estimated_input_tokens: request.estimated_input_tokens,
			modules: moduleCosts(request),
		} : null;
	};
	const recordChoice = (control: string, before: unknown, after: unknown,
		change: Record<string, unknown> = {}) => {
		const row = {event:"choice", control, before, after, baseline:baseline(),
			summary:continuitySummary, ...change};
		append(row);
		lastChoice = row;
	};
	const allowedReadTools = () => {
		let configured: unknown = [];
		try { configured = JSON.parse(process.env.PI_TASK_SUBAGENT_TOOLS ?? "[]"); } catch {}
		const names = new Set(Array.isArray(configured) ? configured.map(String) : []);
		names.add("task_resource");
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		return [...names].filter((name) => registered.has(name));
	};
	const protectedTools = () => ["child_context", "submit_research_report", "research_checkpoint"]
		.filter((name) => pi.getAllTools().some((tool) => tool.name === name));
	pi.on("session_start", () => {
		if (!selectedReadTools) return;
		const allowed = new Set(allowedReadTools());
		pi.setActiveTools([...new Set([...selectedReadTools.filter((name) => allowed.has(name)), ...protectedTools()])]);
	});

	pi.registerTool({
		name: "child_context", label: "Child context control",
		description: "Inspect request costs; task_resource pages remain until explicit consumption or compact, and while the active plan depends on them. Other large reads expire after one continuation. Restore pins results; read pages saved output; tools selects schemas. No parent mutation.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("inspect"), Type.Literal("compact"), Type.Literal("restore"), Type.Literal("read"), Type.Literal("tools")]),
			refs: Type.Optional(Type.Array(Type.String())),
			summary: Type.Optional(Type.String()),
			ref: Type.Optional(Type.String()),
			offset: Type.Optional(Type.Integer({minimum:0})),
			limit: Type.Optional(Type.Integer({minimum:1,maximum:8192})),
			enabled_tools: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, params) {
			const output = (value: Record<string, unknown>) =>
				({content:[{type:"text" as const,text:JSON.stringify(value)}],details:value});
			if (params.action === "inspect") {
				const request = latestRequest();
				const before = lastChoice?.baseline;
				const comparable = Boolean(request && before && requestKey(request) !== requestKey(before)
					&& request.measurement_basis === before.measurement_basis);
				const priorModules = new Map<string, number>((before?.modules ?? [])
					.map((item: any): [string, number] => [String(item.name), Number(item.estimated_tokens ?? 0)]));
				const moduleDeltas = comparable ? moduleCosts(request).map((item) => ({name:item.name,
					estimated_token_delta:item.estimated_tokens - (priorModules.get(item.name) ?? 0)}))
					.filter((item) => item.estimated_token_delta !== 0)
					.sort((a, b) => Math.abs(b.estimated_token_delta) - Math.abs(a.estimated_token_delta)) : [];
				const offset = Math.max(0, Number(params.offset ?? 0));
				const candidates = [...sources.values()].sort((a, b) => b.chars - a.chars);
				const page = candidates.slice(offset, offset + 12).map((source) => ({
					ref:source.ref, tool:source.tool_name, estimated_tokens:Math.ceil(source.chars / 4),
					compacted:compacted.has(source.ref), transient:Boolean(source.transient),
					pinned:pinned.has(source.ref),
				}));
				return output({format:"child-context-report-v1",
					latest_request:request ? {request_id:request.request_id, measurement_basis:request.measurement_basis,
						estimated_input_tokens:request.estimated_input_tokens, modules:moduleCosts(request),
						tool_definitions:request.tool_definition_count,
						largest_tool_definitions:[...(request.tool_definition_sizes ?? [])]
							.sort((a: any, b: any) => Number(b.json_chars ?? 0) - Number(a.json_chars ?? 0))
							.slice(0, 6).map((tool: any) => ({name:tool.name,
								estimated_tokens:Math.ceil(Number(tool.json_chars ?? 0) / 4)}))} : null,
					last_choice:lastChoice ? {control:lastChoice.control, before:lastChoice.before, after:lastChoice.after,
						baseline:before, later_request_observed:Boolean(request && before && requestKey(request) !== requestKey(before)),
						...(comparable ? {estimated_token_delta:Number(request!.estimated_input_tokens ?? 0)
							- Number(before!.estimated_input_tokens ?? 0),module_deltas:moduleDeltas} : {})} : null,
					active_tools:pi.getActiveTools(), allowed_read_tools:allowedReadTools(),
					compacted_count:compacted.size, pinned_count:pinned.size,
					transient_projection:lastTransientProjection,
					compacted_refs_preview:[...compacted].slice(-12),
					continuity_summary:continuitySummary || null,
					result_candidates:{total:candidates.length, offset, next_offset:offset + page.length < candidates.length ? offset + page.length : null, items:page},
					instruction:"task_resource pages remain until explicit consumption or compact, and while the active plan depends on them; other large reads expire after one continuation. Explicit compact requires an Agent-authored continuity summary. Restore pins a result; read retrieves its saved output. The initial workset remains immutable; cost deltas are heuristic."});
			}
			if (params.action === "read") {
				const source = sources.get(String(params.ref ?? ""));
				if (!source) throw new Error("unknown child result ref");
				const raw = JSON.stringify(source.result);
				const offset = Math.min(raw.length, Math.max(0, Number(params.offset ?? 0)));
				const limit = Math.min(8192, Math.max(1, Number(params.limit ?? 2000)));
				return output({format:"child-context-result-page-v1", ref:source.ref, tool:source.tool_name,
					offset, page_end:Math.min(raw.length, offset + limit), total_chars:raw.length,
					text:raw.slice(offset, offset + limit)});
			}
			if (params.action === "compact") {
				const refs = [...new Set((params.refs ?? []).map(String))];
				if (!refs.length || refs.length !== (params.refs ?? []).length) throw new Error("compact requires unique result refs");
				if (!refs.every((ref) => sources.has(ref))) throw new Error("compact requires exact known child result refs; inspect first");
				const summary = String(params.summary ?? "").trim();
				if (!summary) throw new Error("compact requires an Agent-authored continuity summary covering the whole compacted set");
				const before = [...compacted];
				for (const ref of refs) {
					if (sources.get(ref)?.tool_name === "task_resource") workset.release([ref.slice("child_result:".length)], { release_reason: params.summary });
					compacted.add(ref); pinned.delete(ref);
				}
				continuitySummary = summary;
				recordChoice("compact", before, [...compacted], {compact_refs:refs});
				return output({applied:true, compacted_refs:[...compacted],
					effective_at:"next_provider_request", restore_call:{tool:"child_context",arguments:{action:"restore",refs}}});
			}
			if (params.action === "restore") {
				const refs = params.refs?.length ? [...new Set(params.refs.map(String))] : [...compacted];
				const before = [...compacted];
				for (const ref of refs) { compacted.delete(ref); pinned.add(ref); }
				if (!compacted.size) continuitySummary = "";
				recordChoice("restore", before, [...compacted], {restore_refs:refs});
				return output({applied:true, compacted_refs:[...compacted],effective_at:"next_provider_request"});
			}
			const allowed = new Set(allowedReadTools());
			const selected = [...new Set((params.enabled_tools ?? []).map(String))];
			const unknown = selected.filter((name) => !allowed.has(name));
			if (unknown.length) throw new Error(`unknown or unauthorized child read tools: ${unknown.join(", ")}`);
			const before = pi.getActiveTools();
			pi.setActiveTools([...new Set([...selected, ...protectedTools()])]);
			selectedReadTools = [...selected];
			recordChoice("tools", before, pi.getActiveTools());
			return output({applied:true, active_tools:pi.getActiveTools(),
				effective_at:"next_provider_request", restore_hint:"Pass the earlier read-tool names to child_context(action='tools',enabled_tools=[...])."});
		},
	});

	pi.on("tool_execution_end", (event) => {
		if (!allowedReadTools().includes(event.toolName) || !event.result || event.isError) return;
		const ref = `child_result:${event.toolCallId}`;
		if (sources.has(ref)) return;
		let raw: string;
		try { raw = JSON.stringify(event.result); } catch { return; }
		const source = {event:"source",ref,tool_name:event.toolName,result:event.result,chars:raw.length,
			transient:raw.length >= TRANSIENT_RESULT_MIN_CHARS};
		sources.set(ref, source);
		append(source);
	});
	pi.on("context", (event) => {
		let restoredAny = false;
		const withoutOldCard = event.messages.filter((message) => {
			const value = message as any;
			return !value?.content?.some?.((part: any) => part?.type === "text"
				&& typeof part.text === "string" && part.text.startsWith("Child context continuity:"));
		});
		let laterAssistant = false;
		let laterConsumer = false;
		let transientCount = 0, savedChars = 0;
		let messages = [...withoutOldCard].reverse().map((message) => {
			const value = message as any;
			if (value?.role === "assistant") laterAssistant = true;
			if (readWorksetConsumer(value)) laterConsumer = true;
			const ref = value?.role === "toolResult" ? `child_result:${String(value.toolCallId ?? value.tool_call_id ?? "")}` : "";
			const source = sources.get(ref);
			const leased = source?.tool_name === "task_resource" && workset.required(ref.slice("child_result:".length));
			const duplicatePage = source?.tool_name === "task_resource" && workset.superseded(ref.slice("child_result:".length));
			const expired = Boolean(!pinned.has(ref) && (duplicatePage || (source?.transient && !leased
				&& (source.tool_name === "task_resource" ? laterConsumer : laterAssistant))));
			if (!compacted.has(ref) && !expired) {
				const wasCompacted = value?.content?.some?.((part: any) => part?.type === "text"
					&& typeof part.text === "string" && part.text.startsWith(`[Child result ${ref} `));
				const original = sources.get(ref)?.result as Record<string, any> | undefined;
				if (wasCompacted && original) {
					restoredAny = true;
					return {...value, content:original.content, details:original.details};
				}
				return leased ? { ...value, read_workset_required: true } : message;
			}
			const replacement = {...value, content:[{type:"text",text:`[Child result ${ref} ${expired && !compacted.has(ref) ? (source?.tool_name === "task_resource" ? "released after response or action" : "expired after one model continuation") : "compacted by child Agent"}. Read exact output with child_context(action='read',ref='${ref}',offset=0,limit=2000); child_context(action='restore',refs=['${ref}']) pins it in context.]`}],
				details:{child_context_ref:ref,transient_expired:expired}};
			if (expired && !compacted.has(ref)) {
				transientCount += 1;
				savedChars += Math.max(0, JSON.stringify(value).length - JSON.stringify(replacement).length);
			}
			return replacement;
		}).reverse();
		messages = workset.restore(messages as any[], [...sources.entries()]
			.filter(([ref, source]) => source.tool_name === "task_resource" && !compacted.has(ref))
			.map(([ref, source]) => ({ id: ref.slice("child_result:".length), result: source.result }))) as any;
		lastTransientProjection = { result_count: transientCount, saved_chars: savedChars };
		if (!compacted.size) return restoredAny || messages.length !== event.messages.length || messages.some((message, index) => message !== event.messages[index])
			? {messages} : {};
		return {messages:[...messages,{role:"user",timestamp:Date.now(),content:[{type:"text",
			text:`Child context continuity: ${JSON.stringify({epistemic_status:"agent_interpretation_not_runtime_fact",
				summary:continuitySummary.slice(0, 2000),
				summary_chars:continuitySummary.length,
				summary_truncated:continuitySummary.length > 2000,
				full_summary_call:{tool:"child_context",arguments:{action:"inspect"}},
				compacted_count:compacted.size,
				recent_result_refs:[...compacted].slice(-8),
				read_call:{tool:"child_context",arguments:{action:"read",ref:"<child_result ref>",offset:0,limit:2000}}})}`}]}]};
	});
}
