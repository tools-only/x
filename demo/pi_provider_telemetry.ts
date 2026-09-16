/** Generic, privacy-preserving provider request telemetry for Pi extensions. */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
};

type ContextModuleName =
	| "system_prompt"
	| "task_prompt"
	| "checkpoint"
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
	"system_prompt", "task_prompt", "checkpoint", "memory", "skills",
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
		|| /(?:ARC state summary|Current transition:|Observation delta \(deterministic\)|Recent action trajectory|ARC action budget)/.test(text);
}

function classifyMessage(message: unknown, firstUserMessage: boolean): ContextModuleName {
	const role = messageRole(message);
	const text = messageText(message);
	if (["system", "developer"].includes(role)) return "system_prompt";
	if (firstUserMessage && role === "user") return "task_prompt";
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
	const accountedJsonChars = Object.values(modules).reduce((total, item) => total + item.json_chars, 0);
	return {
		context_json_chars: contextJsonChars,
		context_string_chars: stringChars(messages) + stringChars(tools),
		estimated_input_tokens: estimatedTokens(contextJsonChars),
		token_estimate: { method: "ceil(json_chars / 4)", tokenizer: "provider-independent-heuristic" },
		message_count: effectiveMessages.length,
		tool_definition_count: tools.length,
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
	mkdirSync(root, { recursive: true });
	const append = (value: Record<string, unknown>) => appendFileSync(
		path,
		JSON.stringify({ scope, ...value }) + "\n",
		"utf8",
	);
	const appendContextTokenDebug = (value: Record<string, unknown>) => appendFileSync(
		contextTokenPath,
		JSON.stringify({ scope, ...value }) + "\n",
		"utf8",
	);
	let requestIndex = 0;
	const inFlight: RequestRecord[] = [];
	let lastResponse: RequestRecord | undefined;
	let pendingContextStats: Record<string, unknown> | undefined;

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
		inFlight.push(record);
		const contextStats = contextTokenStats(event.payload);
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
	});

	pi.on("after_provider_response", (event) => {
		const record = inFlight.shift();
		lastResponse = record;
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
			request_id: record?.requestId,
			status: event.status,
			latency_ms: record ? Math.max(0, completedAtMs - record.startedAtMs) : undefined,
			response_header_names: Object.keys(event.headers ?? {}).sort(),
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
	});

	pi.on("message_end", (event) => {
		const message = event.message as Record<string, unknown>;
		if (message?.role !== "assistant") return;
		const completedAtMs = Date.now();
		let record = lastResponse ?? inFlight.at(-1);
		if (record?.usageLogged) record = undefined;
		if (!record) {
			const startedAtMs = completedAtMs;
			record = {
				requestId: `${scope}-provider-${++requestIndex}`,
				requestIndex,
				startedAtMs,
			};
			appendContextTokenDebug({
				event: "provider_request_context",
				turn: record.requestIndex,
				request_id: record.requestId,
				measurement_basis: pendingContextStats ? "context_hook_fallback" : "unavailable",
				...(pendingContextStats ?? contextTokenStats(undefined)),
				recordedAt: new Date(startedAtMs).toISOString(),
			});
			pendingContextStats = undefined;
		}
		const usage = message.usage && typeof message.usage === "object"
			? message.usage as Record<string, unknown>
			: undefined;
		appendContextTokenDebug({
			event: "provider_response_usage",
			turn: record?.requestIndex,
			request_id: record?.requestId,
			actual_input_tokens: usageNumber(usage, "input", "input_tokens"),
			actual_output_tokens: usageNumber(usage, "output", "output_tokens"),
			cache_read_tokens: usageNumber(usage, "cacheRead", "cache_read", "cache_read_input_tokens"),
			cache_write_tokens: usageNumber(usage, "cacheWrite", "cache_write", "cache_creation_input_tokens"),
			total_tokens: usageNumber(usage, "totalTokens", "total_tokens"),
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
		record.usageLogged = true;
		append({
			event: "assistant_message",
			request_id: record?.requestId,
			stop_reason: message.stopReason,
			message_content_json_chars: jsonChars(message.content),
			usage: usage ? {
				input: usage.input,
				output: usage.output,
				cache_read: usage.cacheRead,
				cache_write: usage.cacheWrite,
				total_tokens: usage.totalTokens,
			} : undefined,
			elapsed_ms: record ? Math.max(0, completedAtMs - record.startedAtMs) : undefined,
			completed_at_ms: completedAtMs,
			recordedAt: new Date(completedAtMs).toISOString(),
		});
	});
}
