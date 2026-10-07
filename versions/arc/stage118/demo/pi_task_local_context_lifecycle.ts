/**
 * Generic task-local context lifecycle for long-running Pi tasks.
 *
 * The provider transcript is treated as a projection, not the canonical task
 * store. Older messages are replaced by a small recoverability marker while
 * raw observations and task resources remain in the run-local artifacts.
 * This module deliberately knows nothing about ARC, shopping, or any other
 * adapter.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeTaskScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { grantOwnContextRefs, installTaskResourceReader } from "./pi_task_resource_store.ts";

type ContextMessage = Record<string, any>;

export type TaskLocalContextLifecycleOptions = {
	root: string;
	/** Real model transport envelope; disclosed to the Agent, not a content quota. */
	contextWindowTokens?: number;
	reservedOutputTokens?: number;
	maxChars?: number;
	keepRecentMessages?: number;
	headMessages?: number;
	maxMessageChars?: number;
	/** Omit private reasoning from completed tool transactions in the provider projection. */
	compactCompletedToolReasoning?: boolean;
	reasoningHistoryPolicy?: "preserve" | "discard_unsigned_thinking" | "summarize_openai_field" | "summarize_completed_openai_field";
	/** Operator-verified providers whose plain reasoning_content history is editable. */
	editableReasoningProviders?: string[];
	enabled?: boolean;
};

const DEFAULT_MAX_CHARS = 400_000;
const DEFAULT_KEEP_RECENT_MESSAGES = 24;
const DEFAULT_HEAD_MESSAGES = 1;
const DEFAULT_MAX_MESSAGE_CHARS = 80_000;

function estimatedTokensFromChars(chars: number): number {
	return Math.ceil(Math.max(0, chars) / 4);
}

// These are generated projections from the shared task-local harness. Keep
// the newest instance of each projection category; the canonical resources
// remain in their JSONL/SKILL.md artifacts.
const PROJECTION_PREFIXES: Array<[string, string]> = [
	["periodic_pattern_review", "Periodic pattern extraction due:"],
	["periodic_pattern_review", "Periodic evidence available:"],
	["research_opportunities", "OPEN RESEARCH OPPORTUNITIES"],
	["memory_candidates", "MEMORY SELECTION CANDIDATES"],
	["research_evidence_update", "Auto-Research evidence update:"],
	["archive", "[Task-local context archive]"],
	["self_harness", "Task-local harness index:"],
	["task_state", "CURRENT TASK STATE"],
	["competition", "CURRENT COMPETITION VIEW:"],
	["task_policy", "Active task policy:"],
	["dynamic_task_state", "Active dynamic task/user prompt knowledge:"],
	["knowledge_review", "Task-local knowledge requiring review:"],
	["validation", "Task-local validation index:"],
	["recovery", "Task-local operation recovery:"],
	["memory", "Active task-local memory index:"],
	["self_harness", "Task-local self-harness is "],
	["pending_effects", "Unassessed task-local harness effects:"],
	["memory", "Active task-local memory:"],
	["skills", "Active task-local skills"],
	["tools", "Active task-local Pi tools"],
	["subagents", "Active task-local Pi subagents"],
	["open_research", "Open task-local research questions:"],
	["active_findings", "Active task-local research findings"],
	["patterns", "Automatically derived task-local pattern candidates:"],
	["pending_research_effects", "Pending task-local execution-condition effects:"],
	["child_context_continuity", "Child context continuity:"],
	["capability_extraction_process", "# Derive capabilities from experience"],
	["capability_workflow_reference", "Capability workflow reference:"],
	["pending_parent_capability_decisions", "Pending parent capability decisions ("],
	["baseline_authoring_methods", "Baseline authoring methods:"],
];

const FULL_TEXT_GUIDANCE_CATEGORIES = new Set([
	"periodic_pattern_review",
	"research_evidence_update",
	"competition",
	"capability_extraction_process",
	"pending_parent_capability_decisions",
	"baseline_authoring_methods",
]);

function protectedGuidanceProjection(message: ContextMessage): boolean {
	return FULL_TEXT_GUIDANCE_CATEGORIES.has(projectionCategory(message) ?? "");
}

function protectedProjection(message: ContextMessage): boolean {
	return Boolean(message.read_workset_required) || protectedGuidanceProjection(message)
		|| ["task_state", "recovery", "task_policy", "dynamic_task_state", "knowledge_review"].includes(projectionCategory(message) ?? "");
}

function messageText(message: ContextMessage): string {
	if (!Array.isArray(message.content)) return "";
	return message.content
		.map((item: any) => item?.type === "text" && typeof item.text === "string" ? item.text : "")
		.join("\n");
}

function projectionCategory(message: ContextMessage): string | undefined {
	const text = messageText(message);
	return PROJECTION_PREFIXES.find(([, prefix]) => text.startsWith(prefix))?.[0];
}

function hasToolCall(message: ContextMessage): boolean {
	return message.role === "assistant" && Array.isArray(message.content)
		&& message.content.some((item: any) => item?.type === "toolCall");
}

// A retained suffix must begin at a message boundary accepted by common chat
// APIs. An assistant tool-call message is a valid boundary only when it stays
// with the following tool results. `projectBoundedContext` enforces that
// transaction-level rule below; a tool result can never start a suffix.
function isSafeSuffixStart(message: ContextMessage): boolean {
	return message.role !== "toolResult";
}

function jsonChars(value: unknown): number {
	try { return JSON.stringify(value).length; }
	catch { return String(value).length; }
}

function boundedText(value: string, allowance: number): string {
	if (value.length <= allowance) return value;
	const marker = "… [truncated; recover from task artifacts]";
	if (allowance <= marker.length) return value.slice(0, Math.max(0, allowance));
	const available = allowance - marker.length;
	const head = Math.ceil(available * 0.6);
	const tail = Math.floor(available * 0.4);
	return `${value.slice(0, head)}${marker}${tail ? value.slice(-tail) : ""}`;
}

function positiveNumber(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function compactOversizedMessage(message: ContextMessage, maxChars: number): ContextMessage {
	if (jsonChars(message) <= maxChars || protectedProjection(message) || (message as any).read_workset_required
		|| message.role === "assistant") return message;
	const copy: ContextMessage = { ...message };
	if (Array.isArray(copy.content)) {
		copy.content = copy.content.map((item: any) => {
			if (item?.type !== "text" || typeof item.text !== "string") return item;
			const allowance = Math.max(256, Math.floor(maxChars / Math.max(1, copy.content.length)));
			return item.text.length <= allowance
				? item
				: { type: "text", text: boundedText(item.text, allowance) };
		});
	}
	if (jsonChars(copy) > maxChars) {
		// Details are useful for the canonical event sink but are not required by
		// the provider transcript. Preserve only their top-level shape here.
		if (copy.details && typeof copy.details === "object") {
			copy.details = { archived_detail_keys: Object.keys(copy.details).slice(0, 32) };
		}
	}
	return copy;
}

function compactMessages(messages: ContextMessage[], maxMessageChars: number): ContextMessage[] {
	return messages.map((message) => compactOversizedMessage(message, maxMessageChars));
}

function toolTransactionStarts(messages: ContextMessage[]): number[] {
	const starts: number[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		if (hasToolCall(messages[index])) starts.push(index);
	}
	return starts;
}

function toolCallIds(message: ContextMessage): string[] {
	if (!hasToolCall(message)) return [];
	return (message.content as any[])
		.filter((item) => item?.type === "toolCall" && typeof item.id === "string")
		.map((item) => item.id);
}

function hasToolResultAfter(messages: ContextMessage[], start: number): boolean {
	const expectedIds = new Set(toolCallIds(messages[start]));
	if (!expectedIds.size) return false;
	const resultIds = new Set<string>();
	for (let index = start + 1; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "toolResult") {
			if (typeof message.toolCallId === "string") resultIds.add(message.toolCallId);
			continue;
		}
		if (message.role === "assistant" || message.role === "user" || message.role === "system") {
			return [...expectedIds].every((id) => resultIds.has(id));
		}
	}
	return [...expectedIds].every((id) => resultIds.has(id));
}

function isReasoningContentBlock(item: any): boolean {
	if (!item || typeof item !== "object" || typeof item.type !== "string") return false;
	return item.type === "thinking" && !item.thinkingSignature && !item.signature && !item.encrypted_content;
}

// Projection eligibility only: this does not require the Agent to author a
// capsule. If public decision state is absent, keep the latest reasoning.
function hasPublicDecisionCapsule(message: ContextMessage): boolean {
	return message.content.some((item: any) => item?.type === "toolCall"
		&& ["subgoal", "hypothesis", "prediction", "falsifier", "next_step"].every(key =>
			typeof item.arguments?.decision?.[key] === "string" && item.arguments.decision[key].trim().length > 0));
}

function latestExchangeIsComplete(messages: ContextMessage[], start: number): boolean {
	const calls = messages[start].content.filter((item: any) => item?.type === "toolCall");
	const ids = calls.map((item: any) => item.id);
	if (!ids.length || ids.some((id: any) => typeof id !== "string" || !id)
		|| new Set(ids).size !== ids.length) return false;
	const receipts = new Set<string>();
	for (const message of messages.slice(start + 1)) {
		if (["assistant", "user", "system"].includes(message.role)) break;
		if (message.role !== "toolResult" || !ids.includes(message.toolCallId)) continue;
		if (message.isError || receipts.has(message.toolCallId)) return false;
		receipts.add(message.toolCallId);
	}
	return receipts.size === ids.length;
}

function summarizeCompletedOpenAIReasoning(messages: ContextMessage[], providers: string[], includeLatest = false): {
	messages: ContextMessage[]; summarizedBlocks: number;
} {
	let summarizedBlocks = 0;
	const latestToolIndex = messages.findLastIndex(hasToolCall);
	return { messages: messages.map((message, index) => {
		// Field-name markers are editable routing metadata, not true signatures.
		// The historical-only policy still requires a later assistant. The scoped
		// completed policy can project the latest exchange once public decision
		// state and every native tool receipt are present; this is a structural
		// completion check, not a claim that a later model consumed the result.
		if (message.api !== "openai-completions" || !providers.includes(message.provider)
			|| ["length", "error", "aborted"].includes(message.stopReason)
			|| !hasToolCall(message) || !hasToolResultAfter(messages, index)) return message;
		if (index === latestToolIndex) {
			if (!includeLatest || message.stopReason !== "toolUse" || !hasPublicDecisionCapsule(message)
				|| !latestExchangeIsComplete(messages, index)
				|| message.content.some((item: any) => item.signature || item.encrypted_content
					|| (item.type === "thinking" && item.thinkingSignature && item.thinkingSignature !== "reasoning_content"))) return message;
		} else if (!messages.slice(index + 1).some(m => m.role === "assistant")) return message;
		const content = message.content.map((item: any) => {
			if (item?.type !== "thinking" || item.thinkingSignature !== "reasoning_content"
				|| item.signature || item.encrypted_content || typeof item.thinking !== "string"
				|| item.thinking.length <= 3000) return item;
			summarizedBlocks += 1;
			const ref = `context:msg-${createHash("sha256").update(JSON.stringify(message)).digest("hex")}@v1`;
			const label = index === latestToolIndex ? "Completed pre-result reasoning excerpt" : "Older completed reasoning excerpt";
			return { type: "text", text: `[${label}; may contain superseded hypotheses. Exact source ${ref}. Current decision state and observations take precedence. Recover only for a specific missing fact.]\n${item.thinking.slice(-2500)}` };
		});
		return content.every((part: any, n: number) => part === message.content[n]) ? message : { ...message, content };
	}), summarizedBlocks };
}

function compactCompletedToolReasoning(messages: ContextMessage[]): {
	messages: ContextMessage[];
	removedBlocks: number;
} {
	let removedBlocks = 0;
	const projected = messages.map((message, index) => {
		if (["length", "error", "aborted"].includes(message.stopReason)
			|| !hasToolCall(message) || !hasToolResultAfter(messages, index)) return message;
		const content = (message.content as any[]).filter((item) => {
			if (!isReasoningContentBlock(item)) return true;
			removedBlocks += 1;
			return false;
		});
		return content.length === message.content.length ? message : { ...message, content };
	});
	return { messages: projected, removedBlocks };
}

const STRUCTURAL_STRING_KEYS = new Set([
	"id", "toolCallId", "name", "type", "role", "api", "provider", "model", "stopReason",
	"timestamp", "isError", "arguments",
]);

// Tool results commonly use `content[].text`, but model providers may also
// attach a large `thinking`, reasoning, or provider-specific string to the
// assistant message that made a tool call. The emergency projection must
// shrink those fields too. Do not rewrite IDs, call links, tool names, or
// arguments: those are the transaction topology and provider call shape.
function shortenNonStructuralStrings(value: any, allowance: number, key?: string): any {
	if (value?.role === "assistant") return value;
	if (key === "arguments") return value;
	if (typeof value === "string") {
		if (key && STRUCTURAL_STRING_KEYS.has(key)) return value;
		return boundedText(value, allowance);
	}
	if (Array.isArray(value)) return value.map((item) => shortenNonStructuralStrings(item, allowance));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [
		entryKey,
		shortenNonStructuralStrings(item, allowance, entryKey),
	]));
}

// A single protected transaction can still exceed a deliberately tiny test or
// provider budget. Keep its message topology and a bounded, recoverable text
// view rather than silently discarding the interaction.
function forceFitMessages(messages: ContextMessage[], maxChars: number): ContextMessage[] {
	if (jsonChars(messages) <= maxChars) return messages;
	// Provider-only details can be reconstructed from the canonical task log;
	// release them before shortening the visible result text.
	const reduced = messages.map((message) => message.details && typeof message.details === "object"
		? { ...message, details: { archived_detail_keys: Object.keys(message.details).slice(0, 32) } }
		: message);
	if (jsonChars(reduced) <= maxChars) return reduced;
	const serializableStringCount = JSON.stringify(reduced).match(/"(?:text|thinking|reasoning|content)"\s*:\s*"/g)?.length ?? 1;
	let allowance = Math.max(16, Math.floor(maxChars / serializableStringCount) - 160);
	let fitted = reduced;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		fitted = reduced.map((message, index) => index === 0 || message.role === "system" || protectedProjection(message)
			? message : shortenNonStructuralStrings(message, allowance));
		if (jsonChars(fitted) <= maxChars || allowance <= 16) return fitted;
		allowance = Math.max(16, Math.floor(allowance * 0.55));
	}
	return fitted;
}

function dedupeProjections(messages: ContextMessage[]): ContextMessage[] {
	const latest = new Map<string, number>();
	for (let index = 0; index < messages.length; index += 1) {
		const category = projectionCategory(messages[index]);
		if (category) latest.set(category, index);
	}
	return messages.filter((message, index) => {
		const category = projectionCategory(message);
		return !category || latest.get(category) === index;
	});
}

function firstUserHead(messages: ContextMessage[], requested: number): number {
	let end = Math.min(requested, messages.length);
	// Keep the initial task prompt and any immediately attached startup context.
	while (end < messages.length && end < requested + 4 && messages[end]?.role !== "assistant") end += 1;
	return Math.max(0, end);
}

function archiveMarker(archived: ContextMessage[], artifactPath: string): ContextMessage {
	const roleCounts: Record<string, number> = {};
	const toolNames: string[] = [];
	for (const message of archived) {
		const role = String(message.role ?? "unknown");
		roleCounts[role] = (roleCounts[role] ?? 0) + 1;
		if (role === "assistant" && Array.isArray(message.content)) {
			for (const item of message.content) if (item?.type === "toolCall" && item.name) toolNames.push(String(item.name));
		}
	}
	return {
		role: "user",
		content: [{ type: "text", text: `[Task-local context archive] Archived ${archived.length} historical messages (${JSON.stringify(roleCounts)}). ` +
			`Tool calls represented in the archive: ${JSON.stringify([...new Set(toolNames)])}. ` +
			`Canonical observations and resources remain recoverable from ${artifactPath}; retrieve by exact ID when needed.` }],
		timestamp: Date.now(),
	};
}

function projectBoundedContext(
	messages: ContextMessage[],
	maxChars: number,
	keepRecentMessages: number,
	headMessages: number,
	maxMessageChars: number,
	artifactPath: string,
	compactCompletedReasoning: boolean,
): {
	messages: ContextMessage[];
	beforeChars: number;
	afterChars: number;
	archivedCount: number;
	dedupedCount: number;
	retainedToolTransactions: number;
	latestToolTransactionPreserved: boolean;
	latestToolResultPreserved: boolean;
	budgetDegraded: boolean;
	completedToolReasoningBlocksRemoved: number;
} {
	// Different provider serializers may add separators or escape characters
	// differently. Reserve a small margin so the configured bound is strict
	// outside this extension too, instead of relying on JSON.stringify's exact
	// byte shape.
	const safetyMargin = Math.min(1024, Math.max(128, Math.floor(maxChars * 0.02)));
	const projectionBudget = Math.max(256, maxChars - safetyMargin);
	const beforeChars = jsonChars(messages);
	const deduped = dedupeProjections(messages);
	const dedupedCount = messages.length - deduped.length;
	const completedReasoning = compactCompletedReasoning
		? compactCompletedToolReasoning(deduped)
		: { messages: deduped, removedBlocks: 0 };
	const providerMessages = completedReasoning.messages;
	// Retain complete call/result transactions for leased pages, never orphan tool results.
	const leaseTransactions = toolTransactionStarts(providerMessages);
	for (let t = 0; t < leaseTransactions.length; t++) {
		const start = leaseTransactions[t], end = leaseTransactions[t + 1] ?? providerMessages.length;
		if (providerMessages.slice(start, end).some(message => message.read_workset_required))
			for (let index = start; index < end; index++) providerMessages[index] = { ...providerMessages[index], read_workset_required: true };
	}
	const headEnd = firstUserHead(providerMessages, headMessages);
	const minimumTail = Math.min(providerMessages.length, Math.max(headEnd, providerMessages.length - keepRecentMessages));
	let preferredStart = Math.min(providerMessages.length - 1, minimumTail);
	while (preferredStart > headEnd && !isSafeSuffixStart(providerMessages[preferredStart])) preferredStart -= 1;
	if (preferredStart <= headEnd) preferredStart = Math.min(providerMessages.length - 1, headEnd + 1);
	const transactions = toolTransactionStarts(providerMessages);
	const latestToolStart = transactions.at(-1);
	// A new user continuation can arrive after the latest tool result. Do not
	// let it become the archive boundary: that would remove the very result the
	// next turn needs in order to choose an action.
	const maximumStart = latestToolStart === undefined
		? providerMessages.length - 1
		: latestToolStart;
	const firstCandidateStart = Math.min(preferredStart, maximumStart);

	const candidate = (start: number) => {
		const middle = providerMessages.slice(headEnd, start);
		const protectedCards = middle.filter(protectedProjection);
		const archived = middle.filter((message) => !protectedProjection(message));
		const tail = compactMessages(providerMessages.slice(start), maxMessageChars);
		// A protected head may consume the entire short transcript. A required
		// tail starting inside it must not duplicate the overlapping messages.
		return [...providerMessages.slice(0, Math.min(headEnd, start)), ...(archived.length ? [archiveMarker(archived, artifactPath)] : []), ...protectedCards, ...tail];
	};

	let projected = compactMessages(providerMessages, maxMessageChars);
	let archivedCount = 0;
	let selectedStart = headEnd;
	let selected = false;
	let budgetDegraded = false;
	if (jsonChars(projected) > projectionBudget || providerMessages.length > headEnd + keepRecentMessages) {
		const starts: number[] = [];
		for (let index = firstCandidateStart; index <= maximumStart; index += 1) {
			if (isSafeSuffixStart(providerMessages[index])) starts.push(index);
		}
		for (const start of starts) {
			const next = candidate(start);
			if (jsonChars(next) <= projectionBudget) {
				projected = next;
				selectedStart = start;
				archivedCount = Math.max(0, start - headEnd);
				selected = true;
				break;
			}
		}
		if (!selected) {
			const requiredStart = latestToolStart ?? firstCandidateStart;
			projected = forceFitMessages(candidate(requiredStart), projectionBudget);
			selectedStart = requiredStart;
			archivedCount = Math.max(0, requiredStart - headEnd);
			budgetDegraded = true;
		}
	}
	const retainedToolTransactions = transactions.filter((start) => start >= selectedStart).length;
	const latestToolTransactionPreserved = latestToolStart === undefined || latestToolStart >= selectedStart;
	let latestProjectedToolStart = -1;
	for (let index = projected.length - 1; index >= 0; index -= 1) {
		if (hasToolCall(projected[index])) {
			latestProjectedToolStart = index;
			break;
		}
	}
	const latestToolResultPreserved = latestToolStart === undefined
		|| !hasToolResultAfter(providerMessages, latestToolStart)
		|| (latestToolStart >= selectedStart && latestProjectedToolStart >= 0
			&& hasToolResultAfter(projected, latestProjectedToolStart));

	return {
		messages: projected,
		beforeChars,
		afterChars: jsonChars(projected),
		archivedCount,
		dedupedCount,
		retainedToolTransactions,
		latestToolTransactionPreserved,
		latestToolResultPreserved,
		budgetDegraded,
		completedToolReasoningBlocksRemoved: completedReasoning.removedBlocks,
	};
}

export function installTaskLocalContextLifecycle(
	pi: ExtensionAPI,
	options: TaskLocalContextLifecycleOptions,
): void {
	const enabled = options.enabled ?? process.env.PI_AUTORESEARCH_CONTEXT_LIFECYCLE !== "disabled";
	if (!enabled) return;
	const root = resolve(options.root);
	const scope = ensureTaskScope(root);
	installTaskResourceReader(pi, root);
	pi.on("session_shutdown", (event) => {
		if (event.reason === "quit" && process.env.PI_AUTORESEARCH_OWNS_TASK === "print"
			&& process.env.PI_TASK_CHILD !== "1") closeTaskScope(root);
	});
	mkdirSync(root, { recursive: true });
	const configuredContextTokens = Number(options.contextWindowTokens
		?? process.env.PI_AUTORESEARCH_MODEL_CONTEXT_TOKENS);
	const reservedOutputTokens = Math.max(0, Number(options.reservedOutputTokens
		?? process.env.PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS) || 0);
	const transportInputTokens = Number.isFinite(configuredContextTokens) && configuredContextTokens > 0
		? Math.max(1, Math.floor(configuredContextTokens - reservedOutputTokens))
		: undefined;
	// The model window is a transport allowance, not an override of the
	// operator's smaller working-context budget. Explicit settings may narrow
	// that allowance but cannot expand it. Protected evidence still reports
	// overflow rather than being discarded to satisfy this soft character bound.
	const transportMaxChars = transportInputTokens ? transportInputTokens * 4 : undefined;
	const configuredMaxChars = positiveNumber(options.maxChars, positiveNumber(
		Number(process.env.PI_AUTORESEARCH_CONTEXT_MAX_CHARS), transportMaxChars ?? DEFAULT_MAX_CHARS,
	));
	const maxChars = transportMaxChars === undefined
		? configuredMaxChars : Math.min(configuredMaxChars, transportMaxChars);
	const keepRecent = positiveNumber(
		options.keepRecentMessages ?? Number(process.env.PI_AUTORESEARCH_CONTEXT_KEEP_RECENT),
		DEFAULT_KEEP_RECENT_MESSAGES,
	);
	const headMessages = positiveNumber(options.headMessages, DEFAULT_HEAD_MESSAGES);
	const maxMessageChars = positiveNumber(
		options.maxMessageChars ?? Number(process.env.PI_AUTORESEARCH_CONTEXT_MAX_MESSAGE_CHARS),
		DEFAULT_MAX_MESSAGE_CHARS,
	);
	const logPath = join(root, "task-context-compactions.jsonl");
	// Compact before the hard envelope is full, leaving room for fresh tool
	// results and research steps. This is representation headroom, not an action
	// or management-call quota. Protected state may exceed this soft target.
	const workingTarget = Math.floor(maxChars * 0.8);
	const artifactPath = "task-local artifacts (execution-observations.jsonl, task-memory.jsonl, task-harness resources)";
	let projectionCount = 0;
	let lastBudgetNoticeBucket = -1;
	const archivedHashes = new Set<string>();

	pi.on("context", (event) => {
		const sourceMessages: ContextMessage[] = event.messages as ContextMessage[];
		const historyPolicy = options.reasoningHistoryPolicy ?? process.env.PI_PROVIDER_REASONING_HISTORY_POLICY;
		const history = ["summarize_openai_field", "summarize_completed_openai_field"].includes(historyPolicy ?? "")
			? summarizeCompletedOpenAIReasoning(sourceMessages, options.editableReasoningProviders
				?? (process.env.PI_PROVIDER_EDITABLE_REASONING_PROVIDERS ?? "").split(",").map(p => p.trim()).filter(Boolean),
				historyPolicy === "summarize_completed_openai_field")
			: { messages: sourceMessages, summarizedBlocks: 0 };
		const result = projectBoundedContext(
			history.messages, workingTarget, keepRecent, headMessages, maxMessageChars, artifactPath,
			Boolean(options.compactCompletedToolReasoning
				&& (options.reasoningHistoryPolicy ?? process.env.PI_PROVIDER_REASONING_HISTORY_POLICY) === "discard_unsigned_thinking"),
		);
		result.beforeChars = jsonChars(sourceMessages);
		// Persist the exact source before reducing it, including assistant-only
		// reasoning/text that is absent from observation artifacts. Hash references
		// are task-local and paged by task_resource; the owning runner clears this
		// transient cache only at task shutdown, never on session rotation.
		let archiveRef: string | undefined;
		if (result.archivedCount || result.budgetDegraded || result.beforeChars > result.afterChars) {
			const source = JSON.stringify(sourceMessages);
			const hash = createHash("sha256").update(source).digest("hex");
			archiveRef = `context:${hash}@v1`;
			if (!archivedHashes.has(hash)) {
				mkdirSync(join(root, "task-context-cache"), { recursive: true });
				const cachePath = join(root, "task-context-cache", "messages.jsonl");
				const messageRefs = sourceMessages.map((message) => {
					const id = `msg-${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`;
					if (!archivedHashes.has(id)) {
						appendFileSync(cachePath, JSON.stringify(stampTaskRecord(scope, {
							archive_id: id, version: 1, summary: "Exact archived transcript message", message,
						})) + "\n");
						archivedHashes.add(id);
					}
					return `context:${id}@v1`;
				});
				appendFileSync(cachePath, JSON.stringify(stampTaskRecord(scope, {
					archive_id: hash, version: 1, summary: `Exact pre-projection transcript index (${sourceMessages.length} messages)`,
					message_refs: messageRefs,
				})) + "\n");
				grantOwnContextRefs(pi, [archiveRef, ...messageRefs]);
				archivedHashes.add(hash);
			}
			const marker = result.messages.find((m) => messageText(m).startsWith("[Task-local context archive]"));
			if (marker) marker.content = [{ type: "text", text: `[Task-local context archive] ${archiveRef}. ${result.archivedCount} messages archived. Use task_resource(action='read', ref=..., offset=..., limit=...) only when the native context lacks evidence required for the current decision; do not replay the archive by default. Context and resource indexes are working summaries, not proof. Research and clean-context delegation remain available.` }];
			result.afterChars = jsonChars(result.messages);
		}
		const noticeThreshold = transportInputTokens
			? Math.min(120_000, Math.floor(transportInputTokens * 4 * 0.55)) : 120_000;
		const projectedChars = jsonChars(result.messages);
		const noticeBucket = projectedChars > noticeThreshold
			? Math.floor((projectedChars - noticeThreshold) / 50_000) : -1;
		if (noticeBucket < 0) lastBudgetNoticeBucket = -1;
		if (noticeBucket >= 0 && noticeBucket !== lastBudgetNoticeBucket
			&& projectedChars + 350 < maxChars) {
			lastBudgetNoticeBucket = noticeBucket;
			result.messages.push({ role: "user", timestamp: Date.now(), content: [{ type: "text",
				text: `Context high-water: ~${estimatedTokensFromChars(projectedChars)} estimated input tokens after projection (provider usage may differ). ${process.env.PI_TASK_CHILD === "1" ? "Use child_context(action='inspect')" : "Use task_harness(action='context')"} to select recoverable old results and relevant resources; preserve current decision evidence.` }] });
			result.afterChars = jsonChars(result.messages);
		}
		if (result.beforeChars !== result.afterChars || result.dedupedCount > 0 || result.afterChars > maxChars) {
			appendFileSync(logPath, JSON.stringify({
				compaction_id: `context-compaction-${++projectionCount}`,
				kind: "task_local_context_projection",
				before_chars: result.beforeChars,
				after_chars: result.afterChars,
				before_messages: sourceMessages.length,
				after_messages: result.messages.length,
				archived_messages: result.archivedCount,
				deduplicated_projection_messages: result.dedupedCount,
				retained_tool_transactions: result.retainedToolTransactions,
				latest_tool_transaction_preserved: result.latestToolTransactionPreserved,
				latest_tool_result_preserved: result.latestToolResultPreserved,
				budget_degraded: result.budgetDegraded,
				completed_tool_reasoning_blocks_removed: result.completedToolReasoningBlocksRemoved,
				completed_field_reasoning_blocks_summarized: history.summarizedBlocks,
				reasoning_history_policy: historyPolicy ?? "preserve",
				protected_overflow: result.afterChars > maxChars,
				archive_ref: archiveRef,
				max_chars: maxChars,
				working_target_chars: workingTarget,
				keep_recent_messages: keepRecent,
				provider_context_window_tokens: Number.isFinite(configuredContextTokens) && configuredContextTokens > 0 ? Math.floor(configuredContextTokens) : null,
				reserved_output_tokens: reservedOutputTokens || null,
				transport_input_token_allowance: transportInputTokens ?? null,
				recoverability: artifactPath,
				recordedAt: new Date().toISOString(),
			}) + "\n", "utf8");
		}
		return { messages: result.messages };
	});
}
