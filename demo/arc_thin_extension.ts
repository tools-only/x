/**
 * Thin ARC-AGI-3 self-harness for Pi.
 *
 * Six tools (arc_action, memory, skill, run_skill, prompt, ask_analyst), five
 * hooks, and append-only JSONL stores under <ARC_RUN_ROOT>/harness/. Every
 * decision is one Pi run: the context hook replaces earlier history with a
 * rebuilt working set (memory, skills, recent actions, current grid), and the
 * run ends with exactly one arc_action. Design:
 * docs/plans/2026-10-08-thin-arc-self-harness-extension.md
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { summarizeArcThinDelta } from "./arc_thin_feedback.ts";
import { renderPrompt } from "./prompt_loader.ts";
import {
	evaluateTaskPython, TASK_PYTHON_FORMAT, TaskPythonError, taskPythonLimits, taskPythonRuntimeIdentity,
	type ValidatedTaskPythonProgram,
} from "./pi_task_python.ts";

const ALL_TOOLS = ["arc_action", "memory", "skill", "run_skill", "prompt", "ask_analyst"];
const CONSOLIDATION_TOOLS = ["memory", "skill", "run_skill", "prompt", "ask_analyst"];
const SOFT_TOOL_CALLS = 12;
const HARD_TOOL_CALLS = 16;
const MAX_MEMORY = 40;
const MAX_SKILLS = 40;
const RECENT_ACTIONS = 8;
const TOOL_RESULT_CHARS = 8000;
const ANALYST_SYSTEM = "You are a careful visual analyst for a 64x64 integer grid. Answer the question precisely; cite coordinates (x,y).";
const SKILL_LIMITS = { input_bytes: 384 * 1024, output_bytes: 64 * 1024, fuel: 4_000_000_000, timeout_ms: 20_000 };

/**
 * Constant guest program. The skill source travels as input data and is
 * compiled as "<skill>", so reported line numbers match the source as saved.
 * The shared task-python runtime is not modified.
 */
const SKILL_GUEST = String.raw`import json

_req = input
_ns = {"__name__": "skill"}


def _where(error, source):
    lines = source.splitlines()
    if isinstance(error, SyntaxError):
        return "line %s: %s" % (error.lineno, (error.text or "").rstrip())
    found = []
    tb = error.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        if code.co_filename == "<skill>":
            number = tb.tb_lineno
            text = lines[number - 1].strip() if 0 < number <= len(lines) else ""
            found.append("line %s in %s: %s" % (number, code.co_name, text))
        tb = tb.tb_next
    return "\n".join(found[-4:])


try:
    _code = compile(_req["source"], "<skill>", "exec")
    exec(_code, _ns)
    if not callable(_ns.get("run")):
        raise ValueError("source must define run(state, args)")
    if _req["mode"] == "check":
        result = {"ok": True}
    else:
        _value = _ns["run"](_req["state"], _req["args"])
        json.dumps(_value, allow_nan=False)
        result = {"ok": True, "value": _value}
except BaseException as _error:
    result = {"ok": False, "error": (type(_error).__name__ + ": " + str(_error))[:600], "where": _where(_error, _req["source"])}
`;

type MemoryEntry = { text: string; confidence: number };
type Skill = { version: number; description: string; source: string };
type ActionRow = {
	n: number; decision: number; action: string; x?: number; y?: number; note?: string;
	changed_cells: number | null; bbox?: unknown; level_changed: boolean; state: string;
	levels_completed: number; budget: any; changes?: string;
};
type GuestResult = { ok: true; value?: unknown } | { ok: false; error: string; where?: string };

/** A model-facing tool error: expected, shown to the model, not logged as a harness fault. */
class Refusal extends Error {}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function arcThinExtension(pi: ExtensionAPI) {
	const control = process.env.ARC_THIN_VARIANT === "control";
	const game = process.env.ARC_GAME ?? "unknown";
	const storeDir = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "harness");
	mkdirSync(storeDir, { recursive: true });

	// ---------------------------------------------------------------- stores

	const memory = new Map<string, MemoryEntry>();
	const skills = new Map<string, Skill>();
	const skillVersions = new Map<string, number>();
	let overlay = "";
	let trajectory: ActionRow[] = [];
	let decision = 0;

	function append(file: string, row: Record<string, unknown>): void {
		appendFileSync(join(storeDir, file), JSON.stringify({ t: new Date().toISOString(), ...row }) + "\n", "utf8");
	}

	function logError(hook: string, error: unknown, fatal = false): void {
		try {
			append("errors.jsonl", {
				hook, message: errorText(error), stack: error instanceof Error ? error.stack : undefined,
				...(fatal ? { fatal: true } : {}),
			});
		} catch { /* Logging must never throw. */ }
	}

	function readRows(file: string): any[] {
		const path = join(storeDir, file);
		if (!existsSync(path)) return [];
		const rows: any[] = [];
		for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			try { rows.push(JSON.parse(line)); } catch { /* Skip a torn line. */ }
		}
		return rows;
	}

	function replay(): void {
		memory.clear();
		for (const row of readRows("memory.jsonl")) {
			if (row.deleted) memory.delete(row.key);
			else memory.set(row.key, { text: row.text, confidence: row.confidence });
		}
		skills.clear();
		skillVersions.clear();
		for (const row of readRows("skills.jsonl")) {
			skillVersions.set(row.name, Math.max(skillVersions.get(row.name) ?? 0, Number(row.version) || 0));
			if (row.deleted) skills.delete(row.name);
			else skills.set(row.name, { version: row.version, description: row.description ?? "", source: row.source });
		}
		overlay = readRows("prompt.jsonl").at(-1)?.text ?? "";
		trajectory = readRows("trajectory.jsonl");
		const decisions = [...trajectory, ...readRows("usage.jsonl")].map((row) => Number(row.decision) || 0);
		decision = Math.max(0, ...decisions);
	}

	function appendUsage(kind: string, message: any): void {
		const usage = message?.usage ?? {};
		append("usage.jsonl", {
			decision, kind, input: usage.input ?? 0, output: usage.output ?? 0, cache_read: usage.cacheRead ?? 0,
			cache_write: usage.cacheWrite ?? 0, reasoning: usage.reasoning ?? 0, total: usage.totalTokens ?? 0,
			stop_reason: message?.stopReason,
		});
	}

	// ---------------------------------------------------------------- bridge and observation

	let observation: Record<string, any> | undefined;
	let previousGrid: number[][] | undefined;

	async function bridgeCall(path: string, body?: unknown, timeoutMs = 10_000): Promise<any> {
		const base = process.env.PI_ARC_BRIDGE_URL;
		if (!base) throw new Error("PI_ARC_BRIDGE_URL is not set");
		const response = await fetch(base + path, body === undefined
			? { signal: AbortSignal.timeout(timeoutMs) }
			: {
				method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
				headers: { "content-type": "application/json", "X-ARC-Action-Token": process.env.PI_ARC_ACTION_TOKEN ?? "" },
			});
		const text = await response.text();
		let value: any;
		try { value = text ? JSON.parse(text) : {}; } catch { value = { error: text.slice(0, 500) }; }
		if (!response.ok) throw new Error(String(value?.error ?? `HTTP ${response.status}`));
		return value;
	}

	const gridOf = (value: Record<string, any> | undefined): number[][] | undefined => {
		const frame = Array.isArray(value?.frames) ? value.frames.at(-1) : undefined;
		return Array.isArray(frame) ? frame : undefined;
	};

	function gridDiff(before: number[][] | undefined, after: number[][] | undefined): number | null {
		if (!before || !after) return null;
		let changed = 0;
		for (let y = 0; y < Math.max(before.length, after.length); y += 1)
			for (let x = 0; x < Math.max(before[y]?.length ?? 0, after[y]?.length ?? 0); x += 1)
				if (before[y]?.[x] !== after[y]?.[x]) changed += 1;
		return changed;
	}

	function gridRuns(grid: number[][]): string {
		return grid.map((row, y) => {
			const runs: string[] = [];
			let start = 0;
			for (let x = 1; x <= row.length; x += 1) {
				if (x < row.length && row[x] === row[start]) continue;
				runs.push(`${start === x - 1 ? `c${start}` : `c${start}-${x - 1}`}=${row[start]}`);
				start = x;
			}
			return `r${y}: ${runs.join(" ")}`;
		}).join("\n");
	}

	const availableActions = (value: Record<string, any> | undefined) =>
		value?.agent_available_actions ?? value?.available_actions ?? [];

	function actionLabel(row: { action: string; x?: number; y?: number }): string {
		return row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;
	}

	function actionLine(row: ActionRow): string {
		const budget = row.budget ?? {};
		return `#${row.n} ${actionLabel(row)} → changed_cells=${row.changed_cells ?? "?"} level_changed=${row.level_changed} ` +
			`state=${row.state} levels=${row.levels_completed} ` +
			`budget=${budget.used ?? "?"}/${budget.maximum ?? "∞"} (total ${budget.total_used ?? "?"}/${budget.total_maximum ?? "∞"})`;
	}

	// ---------------------------------------------------------------- per-decision state

	type Run = {
		consolidating: boolean; assistantMessages: number; toolCalls: number; arcSeenInMessage: number;
		endBatchAt: number; actionDone: boolean;
		workingSet?: { text: string; image?: { type: "image"; data: string; mimeType: string } };
	};
	const freshRun = (): Run => ({
		consolidating: false, assistantMessages: 0, toolCalls: 0, arcSeenInMessage: -1, endBatchAt: -1, actionDone: false,
	});
	let run = freshRun();

	function memoryText(): string {
		if (memory.size === 0) return `MEMORY: empty — save what you learn with memory(op="set").`;
		return [`MEMORY (${memory.size}):`,
			...[...memory].map(([key, entry]) => `- ${key}: ${JSON.stringify(entry.text)} (conf ${entry.confidence})`)].join("\n");
	}

	function skillsText(): string {
		if (skills.size === 0) return `SKILLS: none — write one with skill(op="set") when you repeat a calculation.`;
		return [`SKILLS (${skills.size}):`,
			...[...skills].map(([name, skill]) => `- ${name} v${skill.version} — ${skill.description || "(no description)"}`)].join("\n");
	}

	function recentText(): string {
		if (trajectory.length === 0) return "RECENT ACTIONS: none yet.";
		const recent = trajectory.slice(-RECENT_ACTIONS);
		return [`RECENT ACTIONS (last ${recent.length} of ${trajectory.length}):`,
			...recent.map((row) => actionLine(row) + (row.note ? ` | note: ${row.note}` : ""))].join("\n");
	}

	function buildWorkingSet(ctx: ExtensionContext): Run["workingSet"] {
		const sections = control ? [recentText()] : [memoryText(), skillsText(), recentText()];
		const latest = trajectory.at(-1);
		if (latest?.changes && Number.isInteger(latest.budget?.total_used)
			&& latest.budget.total_used === observation?.action_budget?.total_used)
			sections.push(`LATEST ACTION #${latest.n} ${actionLabel(latest)}\n${latest.changes}`);
		sections.push(observation
			? `CURRENT STATE\n${renderArcLatestFrameRuns(observation)}`
			: "CURRENT STATE: unavailable — do not act on remembered grids.");
		let image: { type: "image"; data: string; mimeType: string } | undefined;
		if (observation && ctx.model?.input?.includes("image")) {
			try { image = renderArcFrameImage(observation).content; }
			catch (error) { logError("context:image", error); }
		}
		return { text: sections.join("\n\n"), image };
	}

	const messageText = (message: any): string => typeof message?.content === "string"
		? message.content
		: (Array.isArray(message?.content) ? message.content : [])
			.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");

	function truncateToolResult(message: any): any {
		if (message?.role !== "toolResult" || !Array.isArray(message.content)) return message;
		return {
			...message,
			content: message.content.map((block: any) => block?.type === "text" && block.text.length > TOOL_RESULT_CHARS
				? { ...block, text: block.text.slice(0, TOOL_RESULT_CHARS) + `\n…(truncated at ${TOOL_RESULT_CHARS} chars)` }
				: block),
		};
	}

	// ---------------------------------------------------------------- skills sandbox

	let skillProgram: ValidatedTaskPythonProgram | undefined;
	async function runGuest(input: Record<string, unknown>, signal?: AbortSignal): Promise<GuestResult> {
		skillProgram ??= {
			format: TASK_PYTHON_FORMAT, source: SKILL_GUEST, limits: SKILL_LIMITS,
			effective_limits: taskPythonLimits(SKILL_LIMITS), runtime: taskPythonRuntimeIdentity(),
		};
		try {
			return (await evaluateTaskPython(skillProgram, input, signal)).value as GuestResult;
		} catch (error) {
			if (!(error instanceof TaskPythonError)) throw error;
			if (error.code === "environment_unavailable" || error.code === "version_conflict") throw error;
			return { ok: false, error: `${error.code}: ${error.message}`.slice(0, 600) };
		}
	}

	const guestFailure = (result: Extract<GuestResult, { ok: false }>) =>
		result.error + (result.where ? `\n${result.where}` : "");

	function skillState(includeFrames: boolean): Record<string, unknown> {
		return {
			grid: gridOf(observation) ?? null,
			prev_grid: previousGrid ?? null,
			...(includeFrames ? { frames: observation?.frames ?? [] } : {}),
			state: observation?.state ?? null,
			levels_completed: observation?.levels_completed ?? null,
			available_actions: availableActions(observation),
			action_budget: observation?.action_budget ?? null,
			recent_actions: trajectory.slice(-RECENT_ACTIONS),
			memory: Object.fromEntries([...memory].map(([key, entry]) => [key, entry])),
		};
	}

	// ---------------------------------------------------------------- tools

	const text = (value: string, details?: unknown, terminate = false) =>
		({ content: [{ type: "text" as const, text: value }], details, terminate });
	/** Non-action tools end the run when they share a message with arc_action. */
	const endsBatch = () => run.endBatchAt === run.assistantMessages;

	/**
	 * Decision boundary, checked synchronously when a tool starts executing (Pi
	 * starts a batch's tools in call order). A tool_call block cannot end a run:
	 * Pi turns it into a non-terminating error result. So a refusal that must end
	 * the decision is returned as a terminating result, marked refused.
	 */
	function gate(name: string): { reason: string; terminate: boolean } | undefined {
		run.toolCalls += 1;
		if (run.toolCalls > HARD_TOOL_CALLS)
			return { reason: `hard tool-call limit (${HARD_TOOL_CALLS}) for this decision reached; the decision ends`, terminate: true };
		if (name === "arc_action") {
			if (run.consolidating) return { reason: "no action during consolidation", terminate: true };
			if (run.actionDone || run.arcSeenInMessage === run.assistantMessages)
				return { reason: "one arc_action per decision; this call was NOT submitted", terminate: true };
			run.arcSeenInMessage = run.assistantMessages;
			return undefined;
		}
		if (run.actionDone && !endsBatch())
			return { reason: "this decision already ended with arc_action", terminate: true };
		if (run.toolCalls > SOFT_TOOL_CALLS)
			return run.consolidating
				? { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for consolidation reached`, terminate: true }
				: { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for this decision reached; call arc_action now`, terminate: false };
		return undefined;
	}

	const refused = (reason: string) => text(reason, { refused: true }, true);

	function guardTool<P>(name: string, fn: (params: P, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<any> | any) {
		return async (_id: string, params: P, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) => {
			const verdict = gate(name);
			if (verdict) {
				// Sharing a message with arc_action: every result must terminate or the run continues.
				if (verdict.terminate || (name !== "arc_action" && endsBatch())) return refused(verdict.reason);
				throw new Refusal(verdict.reason);
			}
			try { return await fn(params, signal, ctx); }
			catch (error) {
				if (!(error instanceof Refusal)) logError(`tool:${name}`, error);
				if (name !== "arc_action" && endsBatch()) return refused(errorText(error));
				throw error;
			}
		};
	}

	pi.registerTool({
		name: "arc_action",
		label: "ARC action",
		description: "Submit one action and end this decision. Only ACTION6 uses x,y (0..63; (x,y)=frame[y][x]). " +
			"Put a one-line rationale in note; it is shown in RECENT ACTIONS on later decisions.",
		parameters: Type.Object({
			action: StringEnum(["ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "RESET"] as const),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			note: Type.Optional(Type.String({ maxLength: 300 })),
		}),
		execute: guardTool("arc_action", async (params: { action: string; x?: number; y?: number; note?: string }) => {
			const beforeGrid = gridOf(observation);
			const label = actionLabel(params);
			const payload: Record<string, unknown> = { action: params.action };
			if (params.x !== undefined && params.y !== undefined) { payload.x = params.x; payload.y = params.y; }
			if (params.note) payload.reasoning = params.note;
			let value: Record<string, any>;
			// No agent abort signal here: an aborted request could still apply an unrecorded action.
			try { value = await bridgeCall("/action", payload, 120_000); }
			catch (error) { throw new Refusal(`arc_action ${label} failed: ${errorText(error)}`); }
			run.actionDone = true;
			previousGrid = beforeGrid;
			observation = value;
			const delta = value.observation_delta ?? {};
			const row: ActionRow = {
				n: trajectory.length + 1, decision, action: params.action,
				...(params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : {}),
				...(params.note ? { note: params.note } : {}),
				changed_cells: typeof delta.changed_cells === "number" ? delta.changed_cells : gridDiff(beforeGrid, gridOf(value)),
				...(delta.bbox ? { bbox: delta.bbox } : {}),
				level_changed: Boolean(value.public_transition?.level_changed),
				state: String(value.state ?? "UNKNOWN"),
				levels_completed: Number(value.levels_completed ?? 0),
				budget: value.action_budget ?? null,
				changes: summarizeArcThinDelta(delta),
			};
			trajectory.push(row);
			append("trajectory.jsonl", row);
			return text(`${actionLine(row)}\n${row.changes}`, row, true);
		}),
	});

	if (!control) {
		pi.registerTool({
			name: "memory",
			label: "Memory",
			description: "Save (upsert by key), delete or list short facts, rules, hypotheses and plans. " +
				"Saved entries are shown at every later decision. Use keys like controls.action1, goal.hyp1, plan.",
			parameters: Type.Object({
				op: StringEnum(["set", "delete", "list"] as const),
				key: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
				text: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
				confidence: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "1=guess, 5=verified" })),
			}),
			execute: guardTool("memory", (params: { op: string; key?: string; text?: string; confidence?: number }) => {
				const keys = () => memory.size ? [...memory.keys()].join(", ") : "(none)";
				if (params.op === "list") return text(memoryText(), undefined, endsBatch());
				if (!params.key) throw new Refusal(`memory(op="${params.op}") needs key. Existing keys: ${keys()}`);
				if (params.op === "delete") {
					if (!memory.has(params.key)) throw new Refusal(`no memory entry '${params.key}'. Existing keys: ${keys()}`);
					memory.delete(params.key);
					append("memory.jsonl", { key: params.key, deleted: true });
					return text(`memory deleted ${params.key} (${memory.size} entries)`, undefined, endsBatch());
				}
				if (!params.text) throw new Refusal(`memory(op="set") needs text`);
				if (!memory.has(params.key) && memory.size >= MAX_MEMORY)
					throw new Refusal(`memory is full (${MAX_MEMORY} entries); delete or merge entries first. Existing keys: ${keys()}`);
				const entry = { text: params.text, confidence: params.confidence ?? memory.get(params.key)?.confidence ?? 3 };
				memory.set(params.key, entry);
				append("memory.jsonl", { key: params.key, ...entry });
				return text(`memory set ${params.key} (${memory.size} entries)`, undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "skill",
			label: "Skill",
			description: "Save (upsert by name), delete, or get the source of a Python skill. Source must define run(state, args) " +
				"and return JSON-serialisable data. state has grid, prev_grid, frames, levels_completed, available_actions, " +
				"recent_actions, memory. Standard library only; no I/O. Call it with run_skill. Example: def run(state, args):\n" +
				"    g=state['grid']\n    return {'count': sum(r.count(args['color']) for r in g)}",
			parameters: Type.Object({
				op: StringEnum(["set", "delete", "get"] as const),
				name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
				description: Type.Optional(Type.String({ maxLength: 200, description: "One line: what it returns; shown in the skill directory." })),
				source: Type.Optional(Type.String({ maxLength: 16384 })),
			}),
			execute: guardTool("skill", async (params: { op: string; name: string; description?: string; source?: string }, signal) => {
				const names = () => skills.size ? [...skills.keys()].join(", ") : "(none)";
				const existing = skills.get(params.name);
				if (params.op === "get") {
					if (!existing) throw new Refusal(`no skill '${params.name}'. Skills: ${names()}`);
					return text(`${params.name} v${existing.version} — ${existing.description || "(no description)"}\n${existing.source}`,
						undefined, endsBatch());
				}
				if (params.op === "delete") {
					if (!existing) throw new Refusal(`no skill '${params.name}'. Skills: ${names()}`);
					skills.delete(params.name);
					append("skills.jsonl", { name: params.name, version: existing.version, deleted: true });
					return text(`skill deleted ${params.name} (${skills.size} skills)`, undefined, endsBatch());
				}
				const notSaved = (reason: string) => new Refusal(
					`skill '${params.name}' not saved: ${reason}\nResubmit the whole source with skill(op="set", ...)`);
				if (!params.source) throw notSaved("source is required");
				if (!/\bdef\s+run\s*\(/.test(params.source)) throw notSaved("source must define run(state, args)");
				if (!existing && skills.size >= MAX_SKILLS)
					throw new Refusal(`skill limit (${MAX_SKILLS}) reached; delete a skill first. Skills: ${names()}`);
				const check = await runGuest({ mode: "check", source: params.source }, signal);
				if (!check.ok) throw notSaved(guestFailure(check));
				const version = (skillVersions.get(params.name) ?? 0) + 1;
				const skill = { version, description: params.description ?? existing?.description ?? "", source: params.source };
				skillVersions.set(params.name, version);
				skills.set(params.name, skill);
				append("skills.jsonl", { name: params.name, ...skill });
				return text(`skill set ${params.name} v${version} (syntax ok)`, undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "run_skill",
			label: "Run skill",
			description: "Run a saved skill on the current state. Returns its JSON result, or the Python error with the failing line.",
			parameters: Type.Object({
				name: Type.String(),
				args: Type.Optional(Type.Record(Type.String(), Type.Any())),
				include_frames: Type.Optional(Type.Boolean({ description: "Also pass all animation frames of the last action (bigger input)." })),
			}),
			execute: guardTool("run_skill", async (params: { name: string; args?: Record<string, unknown>; include_frames?: boolean }, signal) => {
				const skill = skills.get(params.name);
				if (!skill) throw new Refusal(`no skill '${params.name}'. Skills: ${skills.size ? [...skills.keys()].join(", ") : "(none)"}`);
				const started = Date.now();
				const result = await runGuest({
					mode: "run", source: skill.source, state: skillState(Boolean(params.include_frames)), args: params.args ?? {},
				}, signal);
				const output = result.ok ? JSON.stringify(result.value ?? null) : undefined;
				append("skill_runs.jsonl", {
					decision, name: params.name, version: skill.version, ok: result.ok, ms: Date.now() - started,
					...(result.ok ? { result_chars: output!.length } : { error: guestFailure(result) }),
				});
				if (!result.ok) throw new Refusal(`skill '${params.name}' v${skill.version} failed: ${guestFailure(result)}\n` +
					`Fix it with skill(op="set", name="${params.name}", source=...). Line numbers refer to your source as saved.`);
				const shown = output!.length > TOOL_RESULT_CHARS
					? output!.slice(0, TOOL_RESULT_CHARS) + `\n…(result truncated at ${TOOL_RESULT_CHARS} chars; return less)`
					: output!;
				return text(`${params.name} v${skill.version} →\n${shown}`, undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "prompt",
			label: "Prompt overlay",
			description: "Set or clear standing instructions appended to the system prompt for every later decision (max 1500 chars).",
			parameters: Type.Object({
				op: StringEnum(["set", "clear", "get"] as const),
				text: Type.Optional(Type.String({ maxLength: 1500 })),
			}),
			execute: guardTool("prompt", (params: { op: string; text?: string }) => {
				if (params.op === "get") return text(overlay || "(no standing instructions)", undefined, endsBatch());
				if (params.op === "set" && !params.text?.trim()) throw new Refusal(`prompt(op="set") needs text`);
				overlay = params.op === "set" ? params.text!.trim() : "";
				append("prompt.jsonl", { text: overlay });
				return text(params.op === "set"
					? `prompt set (${overlay.length} chars); applies from the next decision`
					: "prompt cleared; applies from the next decision", undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "ask_analyst",
			label: "Ask analyst",
			description: "Ask a fresh, tool-less copy of the model one question about the current grid (and optionally the previous " +
				"grid and memory). Use for a second opinion or a careful visual read you do not want to do inline. Costs one model call.",
			parameters: Type.Object({
				question: Type.String({ minLength: 1, maxLength: 2000 }),
				include_prev_grid: Type.Optional(Type.Boolean()),
				include_memory: Type.Optional(Type.Boolean()),
			}),
			execute: guardTool("ask_analyst", async (params: { question: string; include_prev_grid?: boolean; include_memory?: boolean }, signal, ctx) => {
				if (!ctx.model) throw new Refusal("ask_analyst unavailable: no model is selected");
				if (!observation) throw new Refusal("ask_analyst unavailable: the current state could not be read");
				const parts = [`QUESTION: ${params.question}`, `CURRENT GRID\n${renderArcLatestFrameRuns(observation)}`];
				if (params.include_prev_grid)
					parts.push(previousGrid ? `PREVIOUS GRID (before the last action)\n${gridRuns(previousGrid)}` : "PREVIOUS GRID: none yet.");
				if (params.include_memory) parts.push(memoryText());
				const content: any[] = [{ type: "text", text: parts.join("\n\n") }];
				if (ctx.model.input?.includes("image")) {
					try { content.push(renderArcFrameImage(observation).content); }
					catch (error) { logError("ask_analyst:image", error); }
				}
				const level = ctx.thinkingLevel ?? pi.getThinkingLevel();
				// Same path as Pi's own compaction side call: registry auth + pi-ai completeSimple.
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
				if (!auth.ok) throw new Error(`analyst call failed: ${auth.error}`);
				const reply: any = await completeSimple(ctx.model, {
					systemPrompt: ANALYST_SYSTEM,
					messages: [{ role: "user", content, timestamp: Date.now() }],
				}, {
					signal, apiKey: auth.apiKey, headers: auth.headers, env: auth.env,
					...(ctx.model.reasoning && level && level !== "off" ? { reasoning: level } : {}),
				} as any);
				appendUsage("analyst", reply);
				if (reply.stopReason === "error" || reply.stopReason === "aborted")
					throw new Error(`analyst call failed: ${reply.errorMessage ?? reply.stopReason}`);
				const answer = (reply.content ?? []).filter((block: any) => block?.type === "text")
					.map((block: any) => block.text).join("\n").trim();
				return { ...text(answer || "(the analyst returned no text)", undefined, endsBatch()), usage: reply.usage };
			}),
		});
	}

	// ---------------------------------------------------------------- hooks

	function guard<A extends unknown[], R>(hook: string, fn: (...args: A) => R | Promise<R>) {
		return async (...args: A): Promise<R> => {
			try { return await fn(...args); }
			catch (error) { logError(hook, error); throw error; }
		};
	}

	replay();

	pi.on("session_start", guard("session_start", () => { replay(); }));

	pi.on("before_agent_start", guard("before_agent_start", async (event: any) => {
		run = freshRun();
		decision += 1;
		run.consolidating = !control && String(event.prompt ?? "").trimStart().startsWith("CONSOLIDATE:");
		pi.setActiveTools(control ? ["arc_action"] : run.consolidating ? CONSOLIDATION_TOOLS : ALL_TOOLS);
		try { observation = await bridgeCall("/state"); }
		catch (error) { observation = undefined; logError("before_agent_start:/state", error, true); }
		const systemPrompt = control
			? renderPrompt("arc_thin_control_system.md", { game })
			: renderPrompt("arc_thin_system.md", {
				game, overlay: overlay ? `Your standing instructions (set with prompt):\n${overlay}` : "",
			});
		return { systemPrompt: systemPrompt.trimEnd() + "\n" };
	}));

	pi.on("context", guard("context", (event: any, ctx: ExtensionContext) => {
		const messages: any[] = event.messages ?? [];
		const lastUser = messages.findLastIndex((message) => message?.role === "user");
		if (lastUser < 0) return undefined;
		run.workingSet ??= buildWorkingSet(ctx);
		const user = messages[lastUser];
		const head = {
			...user,
			content: [
				{ type: "text", text: `${messageText(user)}\n\n${run.workingSet!.text}` },
				...(run.workingSet!.image ? [run.workingSet!.image] : []),
			],
		};
		return { messages: [head, ...messages.slice(lastUser + 1).map(truncateToolResult)] };
	}));

	pi.on("message_end", guard("message_end", (event: any) => {
		const message = event.message;
		if (message?.role !== "assistant") return undefined;
		run.assistantMessages += 1;
		if (Array.isArray(message.content)
			&& message.content.some((block: any) => block?.type === "toolCall" && block.name === "arc_action"))
			run.endBatchAt = run.assistantMessages;
		appendUsage("agent", message);
		return undefined;
	}));

	// Refusals returned as terminating results are still errors to the model.
	pi.on("tool_result", guard("tool_result", (event: any) =>
		(event.details as { refused?: boolean } | undefined)?.refused ? { isError: true } : undefined));
}
