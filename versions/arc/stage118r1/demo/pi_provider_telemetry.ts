/** Size-only provider telemetry, with an explicit opt-in full-payload debug dump. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPrompt } from "./prompt_loader.ts";
import { competitionPayloadExposure } from "./pi_task_competition.ts";
import { readWorkset } from "./pi_read_workset.ts";

type TelemetryOptions = {
	root?: string;
	fileName?: string;
	contextTokenFileName?: string;
	scope?: string;
};

type RequestRecord = {
	requestId: string;
	requestIndex: number;
	startedAtMs: number;
	usageLogged?: boolean;
	firstDeltaAtMs?: number;
};

type ContextModuleName =
	| "system_prompt"
	| "task_prompt"
	| "checkpoint"
	| "competition"
	| "memory"
	| "skills"
	| "tools"
	| "subagents"
	| "research"
	| "self_harness"
	| "arc_observation"
	| "tool_results"
	| "assistant_messages"
	| "other_messages";

type ContextModuleStats = {
	json_chars: number;
	string_chars: number;
	estimated_tokens: number;
	item_count: number;
};

const CONTEXT_MODULES: ContextModuleName[] = [
	"system_prompt", "task_prompt", "checkpoint", "competition", "memory", "skills",
	"tools", "subagents", "research", "self_harness", "arc_observation", "tool_results",
	"assistant_messages", "other_messages",
];

function emptyModuleStats(): ContextModuleStats {
	return { json_chars: 0, string_chars: 0, estimated_tokens: 0, item_count: 0 };
}

function newModuleStats(): Record<ContextModuleName, ContextModuleStats> {
	return Object.fromEntries(CONTEXT_MODULES.map((name) => [name, emptyModuleStats()])) as Record<ContextModuleName, ContextModuleStats>;
}

/**
 * Tokenizer-independent estimate used only for diagnostics. The actual
 * provider usage is recorded separately when the provider returns it. JSON
 * characters are used because this is the closest representation available at
 * the provider boundary, and the factor is intentionally explicit in the log.
 */
function estimatedTokens(jsonCharacterCount: number): number {
	return Math.ceil(Math.max(0, jsonCharacterCount) / 4);
}

function firstArray(value: Record<string, unknown>, keys: string[]): unknown[] {
	for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
	return [];
}

function messageRole(message: unknown): string {
	return message && typeof message === "object"
		? String((message as Record<string, unknown>).role ?? "unknown")
		: "unknown";
}

function messageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const value = message as Record<string, unknown>;
	if (typeof value.content === "string") return value.content;
	if (!Array.isArray(value.content)) return "";
	return value.content.map((part: any) => {
		if (typeof part === "string") return part;
		if (part?.type === "text" && typeof part.text === "string") return part.text;
		if (typeof part?.text === "string") return part.text;
		return "";
	}).join("\n");
}

function hasPrefix(text: string, prefixes: string[]): boolean {
	return prefixes.some((prefix) => text.startsWith(prefix));
}

function isArcObservation(message: unknown, text: string): boolean {
	const value = message && typeof message === "object" ? message as Record<string, unknown> : {};
	const toolName = String(value.name ?? value.toolName ?? value.tool_name ?? "");
	return toolName === "arc_state" || toolName === "arc_action"
		|| /(?:ARC_OBSERVATION_IMAGE|ARC_OBSERVATION_VIEW|ARC state summary|Current transition:|Observation delta \(deterministic\)|Recent action trajectory|ARC action budget)/.test(text);
}

function classifyMessage(message: unknown, firstUserMessage: boolean): ContextModuleName {
	const role = messageRole(message);
	const text = messageText(message);
	if (["system", "developer"].includes(role)) return "system_prompt";
	if (firstUserMessage && role === "user") return "task_prompt";
	if (hasPrefix(text, ["CURRENT COMPETITION VIEW:"])) return "competition";
	if (hasPrefix(text, ["CURRENT DECISION CHECKPOINT", "CURRENT TASK STATE", "Task-local execution checkpoint:"])) return "checkpoint";
	if (hasPrefix(text, ["Active task-local memory:", "Active task-local memory index:"])) return "memory";
	if (hasPrefix(text, ["Active task-local skills"])) return "skills";
	if (hasPrefix(text, ["Active task-local Pi tools", "Task-local tool feedback is available"])) return "tools";
	if (hasPrefix(text, ["Active task-local Pi subagents"])) return "subagents";
	if (hasPrefix(text, [
		"Open task-local research questions:", "Active task-local research findings",
		"Automatically derived task-local pattern candidates:",
		"Pending task-local execution-condition effects:",
	])) return "research";
	if (hasPrefix(text, ["Task-local harness index:", "Task-local self-harness is ", "Unassessed task-local harness effects:"])) return "self_harness";
	if (isArcObservation(message, text)) return "arc_observation";
	if (["tool", "toolResult", "function"].includes(role)) return "tool_results";
	if (role === "assistant") return "assistant_messages";
	return "other_messages";
}

function addModuleValue(
	modules: Record<ContextModuleName, ContextModuleStats>,
	name: ContextModuleName,
	value: unknown,
): void {
	const stats = modules[name];
	const json = jsonChars(value);
	stats.json_chars += json;
	stats.string_chars += stringChars(value);
	stats.estimated_tokens += estimatedTokens(json);
	stats.item_count += 1;
}

function contextTokenStats(payload: unknown): Record<string, unknown> {
	const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
	const messages = firstArray(value, ["messages", "input"]);
	const hasSystemMessage = messages.some((message) => ["system", "developer"].includes(messageRole(message)));
	// Some Pi/provider adapters expose the pre-serialization Context shape
	// (`systemPrompt` + `messages`) instead of an OpenAI-style system message.
	// Normalize that shape for accounting without logging its contents.
	const effectiveMessages = typeof value.systemPrompt === "string" && !hasSystemMessage
		? [...messages, { role: "system", content: value.systemPrompt }]
		: messages;
	const tools = Array.isArray(value.tools) ? value.tools : [];
	const modules = newModuleStats();
	let firstUserSeen = false;
	for (const message of effectiveMessages) {
		const isFirstUser = messageRole(message) === "user" && !firstUserSeen;
		if (isFirstUser) firstUserSeen = true;
		addModuleValue(modules, classifyMessage(message, isFirstUser), message);
	}
	if (tools.length) addModuleValue(modules, "tools", tools);
	const messageJsonChars = jsonChars(effectiveMessages);
	const toolJsonChars = jsonChars(tools);
	const contextJsonChars = messageJsonChars + toolJsonChars;
	const imageTransportChars = payloadStringLeaves(payload)
		.filter((leaf) => leaf.startsWith("data:image/") && leaf.includes(";base64,"))
		.reduce((total, leaf) => total + leaf.length, 0);
	const accountedJsonChars = Object.values(modules).reduce((total, item) => total + item.json_chars, 0);
	return {
		context_json_chars: contextJsonChars,
		context_string_chars: stringChars(messages) + stringChars(tools),
		estimated_input_tokens: estimatedTokens(contextJsonChars),
		image_transport_chars: imageTransportChars,
		token_estimate: { method: "ceil(json_chars / 4)", tokenizer: "provider-independent-heuristic",
			...(imageTransportChars ? { image_note: "Includes base64 transport characters; use provider usage for actual image token cost." } : {}) },
		message_count: effectiveMessages.length,
		tool_definition_count: tools.length,
		tool_definition_sizes: tools.map((tool: any) => ({
			name: String(tool?.name ?? tool?.function?.name ?? "unknown"), json_chars: jsonChars(tool),
		})),
		modules,
		unattributed_context_json_chars: Math.max(0, contextJsonChars - accountedJsonChars),
	};
}

function activeToolDefinitions(ctx: { getActiveTools?: () => string[]; getAllTools?: () => Array<Record<string, unknown>> }): unknown[] {
	const active = new Set(typeof ctx.getActiveTools === "function" ? ctx.getActiveTools() : []);
	const allTools = typeof ctx.getAllTools === "function" ? ctx.getAllTools() : [];
	return allTools
		.filter((tool) => active.has(String(tool.name ?? "")))
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			promptGuidelines: tool.promptGuidelines,
		}));
}

function usageNumber(usage: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
	if (!usage) return undefined;
	for (const key of keys) {
		if (usage[key] === null || usage[key] === undefined) continue;
		const number = Number(usage[key]);
		if (Number.isFinite(number)) return number;
	}
	return undefined;
}

function jsonChars(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return 0;
	}
}

function stringChars(value: unknown, seen = new Set<object>()): number {
	if (typeof value === "string") return value.length;
	if (!value || typeof value !== "object" || seen.has(value)) return 0;
	seen.add(value);
	if (Array.isArray(value)) return value.reduce((total, item) => total + stringChars(item, seen), 0);
	return Object.values(value as Record<string, unknown>)
		.reduce((total, item) => total + stringChars(item, seen), 0);
}

function roleCounts(messages: unknown[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const message of messages) {
		const role = typeof message === "object" && message !== null
			? String((message as Record<string, unknown>).role ?? "unknown")
			: "unknown";
		counts[role] = (counts[role] ?? 0) + 1;
	}
	return counts;
}

function messageStats(payload: unknown): Record<string, unknown> {
	if (!payload || typeof payload !== "object") {
		return { source: "none", count: 0, json_chars: 0, string_chars: 0, role_counts: {} };
	}
	const value = payload as Record<string, unknown>;
	const source = Array.isArray(value.messages)
		? "messages"
		: Array.isArray(value.input) ? "input" : "none";
	const messages = source === "messages"
		? value.messages as unknown[]
		: source === "input" ? value.input as unknown[] : [];
	return {
		source,
		count: messages.length,
		json_chars: jsonChars(messages),
		string_chars: stringChars(messages),
		role_counts: roleCounts(messages),
		system_json_chars: jsonChars(messages.filter((message) => (
			message && typeof message === "object" && ["system", "developer"].includes(
				String((message as Record<string, unknown>).role ?? ""),
			)
		))),
		tool_result_json_chars: jsonChars(messages.filter((message) => (
			message && typeof message === "object" && String((message as Record<string, unknown>).role ?? "") === "tool"
		))),
	};
}

function payloadStats(payload: unknown): Record<string, unknown> {
	const value = payload && typeof payload === "object"
		? payload as Record<string, unknown>
		: {};
	const messages = messageStats(payload);
	const tools = Array.isArray(value.tools) ? value.tools : [];
	return {
		payload_type: Array.isArray(payload) ? "array" : typeof payload,
		payload_json_chars: jsonChars(payload),
		payload_string_chars: stringChars(payload),
		payload_keys: Object.keys(value).sort(),
		model: typeof value.model === "string" ? value.model : undefined,
		max_tokens: typeof value.max_tokens === "number"
			? value.max_tokens
			: typeof value.max_completion_tokens === "number" ? value.max_completion_tokens : undefined,
		reasoning_effort: value.reasoning_effort ?? value.reasoning?.effort ?? null,
		enable_thinking: value.enable_thinking ?? value.chat_template_kwargs?.enable_thinking ?? null,
		message_count: messages.count,
		message_json_chars: messages.json_chars,
		message_string_chars: messages.string_chars,
		message_source: messages.source,
		message_role_counts: messages.role_counts,
		system_message_json_chars: messages.system_json_chars,
		tool_result_json_chars: messages.tool_result_json_chars,
		tool_definition_count: tools.length,
		tool_definition_names: tools.flatMap((tool: any) => {
			const name = tool?.name ?? tool?.function?.name;
			return typeof name === "string" ? [name] : [];
		}),
		tool_definitions_sha256: createHash("sha256").update(JSON.stringify(tools)).digest("hex"),
		tool_definition_json_chars: jsonChars(tools),
	};
}

function resourceRefsInPayload(payload: unknown): string[] {
	const text = JSON.stringify(payload ?? "");
	const refs = text.match(/(?:memory|skill|tool|subagent|system_prompt|finding|context|research_update|research_worker):[a-zA-Z0-9._:@/-]+/g) ?? [];
	return [...new Set(refs)].sort();
}

type GuidanceExposureDescriptor = {
	name: string;
	sha256: string;
	chars: number;
	window_ids?: string[];
	research_line_refs?: string[];
};

const GUIDANCE_PREFIXES: Record<string, string> = {
	research_evidence_update: "Auto-Research evidence update:",
	periodic_pattern_review: "Periodic pattern extraction due:",
	capability_workflow_reference: "Capability workflow reference:",
	capability_extraction_process: loadPrompt("capability_extraction_process.md").split(/\r?\n/, 1)[0],
	pending_parent_capability_decisions: "Pending parent capability decisions (",
	baseline_authoring_methods: "Baseline authoring methods:",
};

function latestExpectedGuidanceExposure(root: string): {
	exposure_id: string | null;
	descriptors: GuidanceExposureDescriptor[];
} {
	const path = join(root, "task-harness-context-exposures.jsonl");
	if (!existsSync(path)) return { exposure_id: null, descriptors: [] };
	const records = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try { return [JSON.parse(line) as Record<string, unknown>]; }
		catch { return []; }
	});
	const latest = records.findLast((record) => Array.isArray(record.guidance_exposures));
	const descriptors = Array.isArray(latest?.guidance_exposures)
		? latest.guidance_exposures.flatMap((item: any) => (
			typeof item?.name === "string" && typeof item?.sha256 === "string"
				&& Number.isFinite(Number(item?.chars))
				? [{ name: item.name, sha256: item.sha256, chars: Number(item.chars),
					...(Array.isArray(item.window_ids) ? { window_ids: item.window_ids.map(String) } : {}),
					...(Array.isArray(item.research_line_refs) ? { research_line_refs: item.research_line_refs.map(String) } : {}) }]
				: []
		)) : [];
	return { exposure_id: typeof latest?.exposure_id === "string" ? latest.exposure_id : null, descriptors };
}

function payloadStringLeaves(value: unknown, seen = new Set<object>()): string[] {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object" || seen.has(value)) return [];
	seen.add(value);
	if (Array.isArray(value)) return value.flatMap((item) => payloadStringLeaves(item, seen));
	return Object.values(value as Record<string, unknown>)
		.flatMap((item) => payloadStringLeaves(item, seen));
}

function providerImageCarriers(value: unknown, seen = new Set<object>()): Array<{ kind: string; encoded: string }> {
	if (!value || typeof value !== "object" || seen.has(value)) return [];
	seen.add(value);
	if (Array.isArray(value)) return value.flatMap((item) => providerImageCarriers(item, seen));
	const item = value as Record<string, any>;
	const kind = String(item.type ?? "");
	const url = kind === "input_image" ? item.image_url
		: kind === "image_url" ? item.image_url?.url ?? item.image_url : undefined;
	const source = kind === "image" && item.source?.type === "base64"
		? item.source.data : kind === "image" && item.mimeType === "image/png" ? item.data : undefined;
	const direct = typeof url === "string" && url.startsWith("data:image/png;base64,")
		? [{ kind, encoded: url.slice("data:image/png;base64,".length) }]
		: typeof source === "string" && source.startsWith("iVBORw0KGgo")
			? [{ kind, encoded: source }] : [];
	return [...direct, ...Object.values(item).flatMap((child) => providerImageCarriers(child, seen))];
}

/** Check the serialized provider payload, not just the intended context view. */
function arcObservationPayloadExposure(payload: unknown): Record<string, unknown> | null {
	const leaves = payloadStringLeaves(payload);
	const imageLabel = leaves.findLast((value) => value.includes("ARC_OBSERVATION_IMAGE {"));
	if (imageLabel) {
		const match = /ARC_OBSERVATION_IMAGE (\{[^\n]+\})/.exec(imageLabel);
		let metadata: Record<string, unknown> = {};
		try { metadata = match ? JSON.parse(match[1]) as Record<string, unknown> : {}; } catch {}
		const imageSha = String(metadata.image_sha256 ?? "");
		const carriers = providerImageCarriers(payload);
		const matchingImageCount = carriers.filter(({ encoded }) => encoded.length <= 4_000_000
			&& imageSha && createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex") === imageSha).length;
		return {
			codec: metadata.codec ?? null, canonical_ref: metadata.canonical_ref ?? null,
			frame_sha256: metadata.frame_sha256 ?? null, image_sha256: imageSha || null,
			image_bytes: metadata.image_bytes ?? null,
			image_carrier_kinds: [...new Set(carriers.map((item) => item.kind))],
			matching_image_content_count: matchingImageCount,
			effective_image_exposure: matchingImageCount > 0,
		};
	}
	const textView = leaves.find((value) => value.includes("ARC_OBSERVATION_VIEW {"));
	if (!textView) return null;
	const match = /ARC_OBSERVATION_VIEW (\{[^\n]+\})\n([\s\S]*?)\nARC_OBSERVATION_END ([a-f0-9]{64})/.exec(textView);
	if (!match) return { codec: "arc-spatial-v1", effective_text_exposure: false };
	let metadata: Record<string, unknown> = {};
	try { metadata = JSON.parse(match[1]) as Record<string, unknown>; } catch {}
	const bodySha = createHash("sha256").update(match[2]).digest("hex");
	return {
		codec: metadata.codec ?? null, canonical_ref: metadata.canonical_ref ?? null,
		frame_sha256: metadata.frame_sha256 ?? null, body_chars: match[2].length,
		effective_text_exposure: bodySha === match[3] && bodySha === metadata.body_sha256,
	};
}

function guidanceExposureJoin(root: string, payload?: unknown): Record<string, unknown> {
	const expected = latestExpectedGuidanceExposure(root);
	const inspectable = payload !== undefined && payload !== null && typeof payload === "object";
	const leaves = inspectable ? payloadStringLeaves(payload) : [];
	const fullTextPresent = (descriptor: GuidanceExposureDescriptor): boolean => {
		const prefix = GUIDANCE_PREFIXES[descriptor.name];
		for (const text of leaves) {
			if (text.length === descriptor.chars
				&& createHash("sha256").update(text).digest("hex") === descriptor.sha256) return true;
			if (!prefix || descriptor.chars > text.length) continue;
			let offset = text.indexOf(prefix);
			while (offset >= 0) {
				const candidate = text.slice(offset, offset + descriptor.chars);
				if (candidate.length === descriptor.chars
					&& createHash("sha256").update(candidate).digest("hex") === descriptor.sha256) return true;
				offset = text.indexOf(prefix, offset + prefix.length);
			}
		}
		return false;
	};
	return {
		runtime_expected_exposure_id: expected.exposure_id,
		guidance_exposures: expected.descriptors.map((descriptor) => ({
			...descriptor,
			full_text_present: inspectable ? fullTextPresent(descriptor) : null,
		})),
	};
}

/** Install observation-only telemetry without changing provider behavior. */
export function installProviderTelemetry(
	pi: ExtensionAPI,
	options: TelemetryOptions = {},
): void {
	const root = resolve(options.root ?? process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	const fileName = options.fileName ?? "provider-telemetry.jsonl";
	const contextTokenFileName = options.contextTokenFileName ?? "context-token-debug.jsonl";
	const scope = options.scope ?? "external-benchmark";
	const path = join(root, fileName);
	const contextTokenPath = join(root, contextTokenFileName);
	// Explicit opt-in: a full provider payload may contain private task content.
	const promptCapture = process.env.PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE;
	const captureMode = promptCapture === "first" || promptCapture === "all" ? promptCapture : "off";
	mkdirSync(root, { recursive: true });
	const append = (value: Record<string, unknown>) => appendFileSync(
		path,
		JSON.stringify({ scope, process_id: process.pid,
			...(process.env.PI_AUTO_RESEARCH_RUN_ID ? { run_id: process.env.PI_AUTO_RESEARCH_RUN_ID } : {}),
			...(process.env.PI_TASK_CHILD_CONTEXT_ID ? { child_context_id: process.env.PI_TASK_CHILD_CONTEXT_ID } : {}),
			...value }) + "\n",
		"utf8",
	);
	const appendContextTokenDebug = (value: Record<string, unknown>) => appendFileSync(
		contextTokenPath,
		JSON.stringify({ scope, process_id: process.pid,
			...(process.env.PI_TASK_CHILD_CONTEXT_ID ? { child_context_id: process.env.PI_TASK_CHILD_CONTEXT_ID } : {}),
			...value }) + "\n",
		"utf8",
	);
	let requestIndex = 0;
	// Pi's hooks carry no request ID. Its provider attempts are serial; a new
	// payload supersedes a cancelled/retried attempt which never got message_end.
	let activeRequest: RequestRecord | undefined;
	let pendingContextStats: Record<string, unknown> | undefined;
	let previousPrefixHash: string | undefined;

	// Custom providers can bypass the provider-payload hook (notably
	// `streamSimple` fixtures and some gateway adapters). The native context
	// hook still exposes the final projected messages and effective system
	// prompt, so retain a size-only snapshot as a fallback for message_end.
	pi.on("context", (event, ctx) => {
		const extensionContext = ctx as typeof ctx & { getSystemPrompt?: () => string };
		pendingContextStats = contextTokenStats({
			systemPrompt: typeof extensionContext.getSystemPrompt === "function"
				? extensionContext.getSystemPrompt() : "",
			messages: event.messages,
			// Tool inventory is exposed on ExtensionAPI, not on the narrower
			// ExtensionContext passed to event handlers.
			tools: activeToolDefinitions(pi),
		});
	});

	pi.on("before_provider_request", (event) => {
		const startedAtMs = Date.now();
		const record = {
			requestId: `${scope}-provider-${++requestIndex}`,
			requestIndex,
			startedAtMs,
		};
		if (activeRequest && !activeRequest.usageLogged) append({ event: "provider_attempt_superseded",
			request_id: activeRequest.requestId, replaced_by: record.requestId,
			outcome: "no_completed_message", recordedAt: new Date(startedAtMs).toISOString() });
		activeRequest = record;
		if (captureMode === "all" || (captureMode === "first" && record.requestIndex === 1)) {
			const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, "_");
			const capturePath = join(root,
				`provider-prompt-${safeScope}-${startedAtMs}-${process.pid}-${record.requestIndex}.json`);
			try {
				writeFileSync(capturePath, JSON.stringify({
					scope,
					request_id: record.requestId,
					request_index: record.requestIndex,
					captured_at: new Date(startedAtMs).toISOString(),
					measurement_basis: "provider_payload",
					payload: event.payload,
				}, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
			} catch (error) {
				console.error(`Provider prompt capture failed for ${record.requestId}:`, error);
			}
		}
		const contextStats = contextTokenStats(event.payload);
		const readCoverage = readWorkset(pi, root).payload(event.payload, record.requestId);
		const requestPayload = event.payload as Record<string, any>;
		const prefixHash = createHash("sha256").update(JSON.stringify({
			system: requestPayload?.systemPrompt ?? (requestPayload?.messages ?? []).filter((m: any) => ["system", "developer"].includes(m.role)),
			tools: requestPayload?.tools ?? [],
		})).digest("hex");
		append({ event: "stable_prefix", request_id: record.requestId, sha256: prefixHash,
			changed: previousPrefixHash === undefined ? null : previousPrefixHash !== prefixHash,
			measurement_basis: "provider_payload", cache_effect: "unmeasured" });
		previousPrefixHash = prefixHash;
		// The provider payload is authoritative when this hook exists; do not
		// emit a second fallback snapshot for this request.
		pendingContextStats = undefined;
		appendContextTokenDebug({
			event: "provider_request_context",
			turn: record.requestIndex,
			request_id: record.requestId,
			measurement_basis: "provider_payload",
			started_at_ms: startedAtMs,
			recordedAt: new Date(startedAtMs).toISOString(),
			...contextStats,
		});
		append({
			event: "provider_request",
			request_id: record.requestId,
			request_index: requestIndex,
			started_at_ms: startedAtMs,
			recordedAt: new Date(startedAtMs).toISOString(),
			...payloadStats(event.payload),
		});
		// This is the first boundary where the provider payload is authoritative.
		// Keep a compact assembly join here so a later action/effect can point to
		// the exact request that exposed a resource. If an adapter bypasses this
		// hook, the fallback telemetry remains explicitly non-effective.
		append({
			event: "harness_assembly",
			assembly_ref: `${scope}-assembly-${record.requestIndex}`,
			request_id: record.requestId,
			request_index: record.requestIndex,
			measurement_basis: "provider_payload",
			resource_refs: resourceRefsInPayload(event.payload),
			competition_views: competitionPayloadExposure(event.payload, root),
			read_workset: readCoverage,
			arc_observation_view: arcObservationPayloadExposure(event.payload),
			provider_payload_sha256: createHash("sha256").update(JSON.stringify(event.payload ?? null)).digest("hex"),
			arc_decision_feedback_markers: [
				"FIRST VISIBLE RESPONSE", "VISIBLE EFFECTS WITHOUT A LEVEL TRANSITION",
				"REPEATED VISIBLE EFFECT AT THE SAME ACTION/COORDINATE", "REPEATED ZERO PIXEL DELTAS",
			].filter((marker) => JSON.stringify(event.payload ?? null).includes(marker)),
			...guidanceExposureJoin(root, event.payload),
			recordedAt: new Date(startedAtMs).toISOString(),
		});
	});

	pi.on("after_provider_response", (event) => {
		const record = activeRequest;
		const completedAtMs = Date.now();
		appendContextTokenDebug({
			event: "provider_response",
			turn: record?.requestIndex,
			request_id: record?.requestId,
			status: event.status,
			latency_ms: record ? Math.max(0, completedAtMs - record.startedAtMs) : undefined,
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
		append({
			event: "provider_response",
			measurement_basis: "response_headers_only", pairing_basis: "serial_latest_attempt",
			request_id: record?.requestId,
			status: event.status,
			latency_ms: record ? Math.max(0, completedAtMs - record.startedAtMs) : undefined,
			response_header_names: Object.keys(event.headers ?? {}).sort(),
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
	});

	pi.on("message_update", (event) => {
		const delta = event.assistantMessageEvent;
		if (!activeRequest || activeRequest.firstDeltaAtMs !== undefined
			|| !["text_delta", "thinking_delta", "toolcall_delta"].includes(delta?.type)
			|| !(delta as any).delta) return;
		const now = Date.now();
		activeRequest.firstDeltaAtMs = now;
		append({ event: "provider_first_model_delta", request_id: activeRequest.requestId,
			measurement_basis: "first_native_model_delta_not_network_chunk", delta_kind: delta.type,
			latency_ms: Math.max(0, now - activeRequest.startedAtMs), recordedAt: new Date(now).toISOString() });
	});

	pi.on("message_end", (event) => {
		const message = event.message as Record<string, unknown>;
		if (message?.role !== "assistant") return;
		const completedAtMs = Date.now();
		const contextFallback = pendingContextStats;
		pendingContextStats = undefined;
		let fallbackAssemblyRecorded = false;
		let record = activeRequest;
		if (record?.usageLogged) record = undefined;
		if (!record) {
			const startedAtMs = completedAtMs;
			const fallbackStats = contextFallback;
			record = {
				requestId: `${scope}-provider-${++requestIndex}`,
				requestIndex,
				startedAtMs,
			};
			readWorkset(pi, root).payload(undefined, record.requestId, false);
			appendContextTokenDebug({
				event: "provider_request_context",
				turn: record.requestIndex,
				request_id: record.requestId,
				measurement_basis: contextFallback ? "context_hook_fallback" : "unavailable",
				...(contextFallback ?? contextTokenStats(undefined)),
				recordedAt: new Date(startedAtMs).toISOString(),
			});
			append({
				event: "harness_assembly",
				assembly_ref: `${scope}-assembly-${record.requestIndex}`,
				request_id: record.requestId,
				request_index: record.requestIndex,
				measurement_basis: "context_hook_fallback",
				resource_refs: [],
				context_stats: fallbackStats ?? null,
				...guidanceExposureJoin(root),
				recordedAt: new Date(startedAtMs).toISOString(),
			});
			fallbackAssemblyRecorded = true;
		}
		if (contextFallback && record && !fallbackAssemblyRecorded) {
			append({
				event: "harness_assembly",
				assembly_ref: `${scope}-assembly-${record.requestIndex}`,
				request_id: record.requestId,
				request_index: record.requestIndex,
				measurement_basis: "context_hook_fallback",
				resource_refs: [],
				context_stats: contextFallback,
				...guidanceExposureJoin(root),
				recordedAt: new Date(completedAtMs).toISOString(),
			});
		}
		const usage = message.usage && typeof message.usage === "object"
			? message.usage as Record<string, unknown>
			: undefined;
		const reasoningTokens = usageNumber(usage, "reasoning", "reasoning_tokens");
		const outputTokens = usageNumber(usage, "output", "output_tokens");
		appendContextTokenDebug({
			event: "provider_response_usage",
			turn: record?.requestIndex,
			request_id: record?.requestId,
			actual_input_tokens: usageNumber(usage, "input", "input_tokens"),
			actual_output_tokens: usageNumber(usage, "output", "output_tokens"),
			reasoning_tokens: reasoningTokens,
			non_reasoning_output_tokens: reasoningTokens !== undefined && outputTokens !== undefined
				? Math.max(0, outputTokens - reasoningTokens) : null,
			cache_read_tokens: usageNumber(usage, "cacheRead", "cache_read", "cache_read_input_tokens"),
			cache_write_tokens: usageNumber(usage, "cacheWrite", "cache_write", "cache_creation_input_tokens"),
			total_tokens: usageNumber(usage, "totalTokens", "total_tokens"),
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
		record.usageLogged = true;
		append({
			event: "assistant_message",
			requested_tools: Array.isArray(message.content) ? (message.content as any[])
				.filter(p => p.type === "toolCall").map(p => p.name) : [],
			attribution: "descriptive_request_group_not_causal_reasoning_cost",
			request_id: record?.requestId,
			stop_reason: message.stopReason,
			message_content_json_chars: jsonChars(message.content),
			usage: usage ? {
				input: usage.input,
				output: usage.output,
				reasoning: reasoningTokens ?? null,
				non_reasoning_output: reasoningTokens !== undefined && outputTokens !== undefined
					? Math.max(0, outputTokens - reasoningTokens) : null,
				cache_read: usage.cacheRead,
				cache_write: usage.cacheWrite,
				total_tokens: usage.totalTokens,
				cost: usage.cost,
			} : undefined,
			elapsed_ms: record ? Math.max(0, completedAtMs - record.startedAtMs) : undefined,
			first_model_delta_ms: record?.firstDeltaAtMs !== undefined ? record.firstDeltaAtMs - record.startedAtMs : null,
			stream_after_first_delta_ms: record?.firstDeltaAtMs !== undefined ? completedAtMs - record.firstDeltaAtMs : null,
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
		activeRequest = undefined;
	});
}
