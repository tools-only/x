/**
 * Saved subagents for the thin ARC self-harness.
 *
 * A subagent is a saved role (its instructions), a tool subset and a persisted
 * conversation. Each ask is a short tool loop through pi-ai completeSimple: the
 * subagent sees its notes, the actions since its last call, the current grid and
 * its last few exchanges. It never takes game actions. A subagent saved with
 * `every` is consulted before a decision once that many actions have passed
 * since its last turn; its reply is shown once in the agent's working set.
 * Design: docs/plans/2026-10-09-thin-tools-subagents-prompt.md
 */
import { validateToolArguments } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** A model-facing tool error: expected, shown to the model, not logged as a harness fault. */
export class Refusal extends Error {}

export const SUBAGENT_LIMITS = {
	subagents: 6, historyTurns: 4, toolRounds: 6, resultChars: 4000, actionLines: 20,
	roleChars: 2000, notesChars: 1500, reportChars: 2000,
};
export const ANALYST_SYSTEM = "You are a careful visual analyst for a 64x64 integer grid. Answer the question precisely; cite coordinates (x,y).";
/** Tools a subagent may be given besides the agent's custom tools. arc_action, prompt and subagents are never grantable. */
export const GRANTABLE = ["run_skill", "skill", "tool", "memory"];

export type SubagentConfig = { version: number; role: string; tools: string[]; include_memory: boolean; every: number };
export type SubagentTool = {
	name: string; description: string; parameters: any;
	prepare?: (args: any) => any;
	run: (args: any, signal?: AbortSignal) => Promise<string>;
};
type Turn = { n: number; action_n: number; message: string; reply: string; scheduled: boolean };
export type AskParams = { name?: string; message: string; include_memory?: boolean; include_prev_grid?: boolean };
export type SetParams = { op: string; name: string; role?: string; tools?: string[]; include_memory?: boolean; every?: number };

export type SubagentHost = {
	game: string;
	append(row: Record<string, unknown>): void;
	rows(): any[];
	usage(kind: string, message: any, extra: Record<string, unknown>): void;
	/** Resolve a granted tool by name; undefined if it does not exist (any more). */
	tool(name: string, caller: string): SubagentTool | undefined;
	/** Custom tool names that exist now. */
	customTools(): string[];
	actionCount(): number;
	/** One line per recorded action with n > after. */
	actionLines(after: number): string[];
	/** Current grid (and optional memory / previous grid); undefined when the state is unavailable. */
	briefing(options: { memory: boolean; prevGrid: boolean }): { text: string; image?: any } | undefined;
	decision(): number;
	logError(hook: string, error: unknown): void;
};

const textOf = (message: any): string => (Array.isArray(message?.content) ? message.content : [])
	.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n").trim();

const NOTES_TOOL = {
	name: "notes",
	description: "Replace your notes (shown at the top of every later call). Keep what you must remember beyond your last exchanges.",
	parameters: { type: "object", properties: { text: { type: "string", maxLength: SUBAGENT_LIMITS.notesChars } }, required: ["text"] },
};

function systemPrompt(game: string, name: string, role: string): string {
	return `You are subagent "${name}". You help an agent that plays ARC-AGI-3 game ${game}: a 64x64 grid of integers 0-15, ` +
		`(x,y) = frame[y][x]. The agent takes every game action; you cannot. Your last ${SUBAGENT_LIMITS.historyTurns} ` +
		`exchanges with the agent and your notes are kept between calls.\n\nYour responsibility:\n${role}\n\n` +
		"Each call shows your notes, the actions since your last call, the current grid and the agent's message. " +
		"Answer with your conclusions first, then the evidence (cite coordinates). If a test would decide a question, " +
		"name the action the agent should take and what each outcome would mean. Save what you must remember longer with `notes`.";
}

export function createSubagents(host: SubagentHost) {
	const configs = new Map<string, SubagentConfig>();
	const versions = new Map<string, number>();
	const notes = new Map<string, string>();
	const turns = new Map<string, Turn[]>();
	/** Scheduled replies not yet shown to the agent. */
	let reports: Array<{ name: string; after: number; reply: string }> = [];

	function replay(): void {
		configs.clear(); versions.clear(); notes.clear(); turns.clear(); reports = [];
		for (const row of host.rows()) {
			if (typeof row?.name !== "string") continue;
			if (row.kind === "config") {
				versions.set(row.name, Math.max(versions.get(row.name) ?? 0, Number(row.version) || 0));
				if (row.deleted) { configs.delete(row.name); notes.delete(row.name); turns.delete(row.name); continue; }
				configs.set(row.name, { version: row.version, role: row.role ?? "", tools: row.tools ?? [],
					include_memory: Boolean(row.include_memory), every: Number(row.every) || 0 });
			} else if (row.kind === "notes" && configs.has(row.name)) notes.set(row.name, String(row.text ?? ""));
			else if (row.kind === "turn" && configs.has(row.name)) {
				const list = turns.get(row.name) ?? [];
				list.push({ n: row.n, action_n: row.action_n, message: row.message, reply: row.reply, scheduled: Boolean(row.scheduled) });
				turns.set(row.name, list.slice(-SUBAGENT_LIMITS.historyTurns));
			}
		}
	}

	function lastActionN(name: string): number {
		return turns.get(name)?.at(-1)?.action_n ?? 0;
	}

	function describe(name: string, config: SubagentConfig): string {
		const role = config.role.replace(/\s+/g, " ");
		const last = turns.get(name)?.at(-1);
		return `- ${name} v${config.version} — ${role.length > 100 ? role.slice(0, 100) + "…" : role}` +
			` [tools: ${config.tools.join(", ") || "none"}${config.every ? `; reports every ${config.every} actions` : ""}` +
			`${last ? `; last turn ${last.n} after action #${last.action_n}` : ""}]`;
	}

	function directory(): string {
		if (configs.size === 0)
			return `SUBAGENTS: none — subagent(op="set") saves a helper with its own instructions, tools and a conversation that persists between calls.`;
		return [`SUBAGENTS (${configs.size}):`, ...[...configs].map(([name, config]) => describe(name, config))].join("\n");
	}

	/** Scheduled replies since the last call; each is shown once. */
	function takeReports(): string {
		const shown = reports.map((report) => `SUBAGENT REPORT ${report.name} (scheduled, after action #${report.after}):\n` +
			(report.reply.length > SUBAGENT_LIMITS.reportChars
				? report.reply.slice(0, SUBAGENT_LIMITS.reportChars) + "\n…(truncated; ask it for details)" : report.reply));
		reports = [];
		return shown.join("\n\n");
	}

	function configure(params: SetParams): string {
		const names = () => configs.size ? [...configs.keys()].join(", ") : "(none)";
		const existing = configs.get(params.name);
		if (params.op === "get") {
			if (!existing) throw new Refusal(`no subagent '${params.name}'. Subagents: ${names()}`);
			const history = turns.get(params.name) ?? [];
			return `${describe(params.name, existing)}\nrole:\n${existing.role}\nnotes: ${notes.get(params.name) || "(none)"}\n` +
				(history.length ? `last exchange (turn ${history.at(-1)!.n}):\n> ${history.at(-1)!.message}\n${history.at(-1)!.reply}` : "no turns yet");
		}
		if (params.op === "delete") {
			if (!existing) throw new Refusal(`no subagent '${params.name}'. Subagents: ${names()}`);
			configs.delete(params.name); notes.delete(params.name); turns.delete(params.name);
			host.append({ kind: "config", name: params.name, version: existing.version, deleted: true });
			return `subagent deleted ${params.name} (${configs.size} subagents)`;
		}
		const role = (params.role ?? existing?.role ?? "").trim();
		if (!role) throw new Refusal(`subagent '${params.name}' not saved: role is required (its instructions and responsibility)`);
		if (!existing && configs.size >= SUBAGENT_LIMITS.subagents)
			throw new Refusal(`subagent limit (${SUBAGENT_LIMITS.subagents}) reached; delete one first. Subagents: ${names()}`);
		const tools = [...new Set(params.tools ?? existing?.tools ?? [])];
		const custom = host.customTools();
		const unknown = tools.filter((name) => !GRANTABLE.includes(name) && !custom.includes(name));
		if (unknown.length) throw new Refusal(`subagent '${params.name}' not saved: cannot grant ${unknown.join(", ")}. ` +
			`Grantable: ${[...GRANTABLE, ...custom].join(", ")}`);
		const every = params.every ?? existing?.every ?? 0;
		const version = (versions.get(params.name) ?? 0) + 1;
		const config: SubagentConfig = { version, role, tools, include_memory: params.include_memory ?? existing?.include_memory ?? false, every };
		versions.set(params.name, version);
		configs.set(params.name, config);
		host.append({ kind: "config", name: params.name, ...config });
		return `subagent set ${params.name} v${version}${existing ? " (conversation kept)" : ""}; ` +
			`tools: ${tools.join(", ") || "none"}${every ? `; reports every ${every} actions` : ""}. Ask it with ask_subagent(name="${params.name}", message=...)`;
	}

	async function runTool(name: string, call: any, tools: SubagentTool[], signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
		if (call.name === "notes" && name) {
			const text = String(call.arguments?.text ?? "").slice(0, SUBAGENT_LIMITS.notesChars);
			notes.set(name, text);
			host.append({ kind: "notes", name, text });
			return { text: `notes saved (${text.length} chars)`, isError: false };
		}
		const tool = tools.find((candidate) => candidate.name === call.name);
		if (!tool) return { text: `Tool ${call.name} not found`, isError: true };
		try {
			const prepared = tool.prepare ? { ...call, arguments: tool.prepare(call.arguments) } : call;
			const args = validateToolArguments(tool as any, prepared);
			const text = await tool.run(args, signal);
			return { text: text.length > SUBAGENT_LIMITS.resultChars
				? text.slice(0, SUBAGENT_LIMITS.resultChars) + `\n…(truncated at ${SUBAGENT_LIMITS.resultChars} chars)` : text, isError: false };
		} catch (error) {
			if (!(error instanceof Refusal)) host.logError(`subagent:${name || "one-off"}:${call.name}`, error);
			return { text: error instanceof Error ? error.message : String(error), isError: true };
		}
	}

	/** One ask: a bounded tool loop. Throws Refusal when the subagent cannot be asked. */
	async function ask(ctx: ExtensionContext, level: string | undefined, params: AskParams, scheduled = false,
		signal?: AbortSignal): Promise<{ text: string; usage: { input: number; output: number; totalTokens: number } }> {
		if (!ctx.model) throw new Refusal("ask_subagent unavailable: no model is selected");
		const name = params.name ?? "";
		const config = name ? configs.get(name) : undefined;
		if (name && !config) throw new Refusal(`no subagent '${name}'. Subagents: ${configs.size ? [...configs.keys()].join(", ") : "(none)"}` +
			`. Omit name to ask a one-off analyst, or save one with subagent(op="set").`);
		const briefing = host.briefing({ memory: Boolean(params.include_memory ?? config?.include_memory), prevGrid: Boolean(params.include_prev_grid) });
		if (!briefing) throw new Refusal("ask_subagent unavailable: the current state could not be read");

		const actionN = host.actionCount();
		const parts: string[] = [];
		if (config) {
			parts.push(`YOUR NOTES: ${notes.get(name) || "(none)"}`);
			const after = lastActionN(name);
			const lines = host.actionLines(after);
			const shown = lines.slice(-SUBAGENT_LIMITS.actionLines);
			parts.push(lines.length === 0 ? `ACTIONS SINCE YOUR LAST CALL: none (now at action #${actionN}).`
				: [`ACTIONS SINCE YOUR LAST CALL (${lines.length}${shown.length < lines.length ? `, last ${shown.length} shown` : ""}):`, ...shown].join("\n"));
		}
		parts.push(briefing.text, `${scheduled ? "SCHEDULED CHECK" : "AGENT"}: ${params.message}`);

		const messages: any[] = [];
		for (const turn of config ? turns.get(name) ?? [] : []) {
			messages.push({ role: "user", content: [{ type: "text", text: `[turn ${turn.n}, after action #${turn.action_n}] ` +
				`${turn.scheduled ? "SCHEDULED CHECK" : "AGENT"}: ${turn.message}` }], timestamp: Date.now() });
			messages.push({ role: "assistant", content: [{ type: "text", text: turn.reply }], api: ctx.model.api,
				provider: ctx.model.provider, model: ctx.model.id, stopReason: "stop", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		}
		messages.push({ role: "user", content: [{ type: "text", text: parts.join("\n\n") }, ...(briefing.image ? [briefing.image] : [])],
			timestamp: Date.now() });

		const granted = (config?.tools ?? []).map((tool) => host.tool(tool, name)).filter((tool): tool is SubagentTool => Boolean(tool));
		const declarations = config ? [NOTES_TOOL, ...granted.map(({ name, description, parameters }) => ({ name, description, parameters }))] : [];
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok) throw new Error(`subagent call failed: ${auth.error}`);
		const usage = { input: 0, output: 0, totalTokens: 0 };
		const toolCalls: string[] = [];
		let reply: any;
		let calls = 0;
		for (let round = 0; ; round += 1) {
			reply = await completeSimple(ctx.model, {
				systemPrompt: config ? systemPrompt(host.game, name, config.role) : ANALYST_SYSTEM,
				messages, ...(declarations.length ? { tools: declarations } : {}),
			} as any, {
				signal, apiKey: auth.apiKey, headers: auth.headers, env: auth.env,
				...(ctx.model.reasoning && level && level !== "off" ? { reasoning: level } : {}),
			} as any);
			calls += 1;
			host.usage("subagent", reply, { subagent: name || null, scheduled, round });
			usage.input += reply.usage?.input ?? 0;
			usage.output += reply.usage?.output ?? 0;
			usage.totalTokens += reply.usage?.totalTokens ?? 0;
			if (reply.stopReason === "error" || reply.stopReason === "aborted")
				throw new Error(`subagent call failed: ${reply.errorMessage ?? reply.stopReason}`);
			const requested = (reply.content ?? []).filter((block: any) => block?.type === "toolCall");
			if (!requested.length || reply.stopReason !== "toolUse" || round >= SUBAGENT_LIMITS.toolRounds) break;
			messages.push(reply);
			for (const call of requested) {
				toolCalls.push(call.name);
				const result = await runTool(name, call, granted, signal);
				messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name,
					content: [{ type: "text", text: result.text }], isError: result.isError, timestamp: Date.now() });
			}
		}
		let text = textOf(reply) || "(the subagent returned no text)";
		if (reply.stopReason === "length") text += "\n…(reply cut at the output limit)";
		else if (reply.stopReason === "toolUse") text += `\n…(stopped after ${SUBAGENT_LIMITS.toolRounds} tool rounds)`;

		const n = (config ? turns.get(name)?.at(-1)?.n ?? 0 : 0) + 1;
		host.append({ kind: "turn", name: name || null, n: config ? n : undefined, decision: host.decision(), action_n: actionN,
			message: params.message, reply: text, scheduled, tool_calls: toolCalls, calls, tokens: usage.totalTokens,
			stop: reply.stopReason });
		if (config) {
			turns.set(name, [...(turns.get(name) ?? []), { n, action_n: actionN, message: params.message, reply: text, scheduled }]
				.slice(-SUBAGENT_LIMITS.historyTurns));
			if (scheduled) reports.push({ name, after: actionN, reply: text });
		}
		const header = config ? `subagent ${name} (turn ${n}; ${calls} model call${calls === 1 ? "" : "s"}, ${usage.totalTokens} tokens` +
			`${toolCalls.length ? `; used ${toolCalls.join(", ")}` : ""}) →` : `one-off analyst (${usage.totalTokens} tokens) →`;
		return { text: `${header}\n${text}`, usage };
	}

	/** Consult at most one subagent whose `every` is due. Failures are logged and never block the decision. */
	async function consultDue(ctx: ExtensionContext, level: string | undefined, signal?: AbortSignal): Promise<void> {
		const actionN = host.actionCount();
		const due = [...configs].filter(([name, config]) => config.every > 0 && actionN - lastActionN(name) >= config.every)
			.sort(([a], [b]) => lastActionN(a) - lastActionN(b))[0];
		if (!due) return;
		const [name, config] = due;
		try {
			await ask(ctx, level, { name, message: `${config.every} or more actions have passed since your last turn. ` +
				"Report what is new for your responsibility, briefly; say 'nothing new' if nothing is." }, true, signal);
		} catch (error) { host.logError(`subagent:scheduled:${name}`, error); }
	}

	return { replay, directory, takeReports, configure, ask, consultDue, count: () => configs.size };
}
