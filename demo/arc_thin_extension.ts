/**
 * Thin ARC-AGI-3 self-harness for Pi.
 *
 * Six tools (arc_action, memory, skill, run_skill, prompt, ask_analyst), five
 * hooks, and append-only JSONL stores under <ARC_RUN_ROOT>/harness/. Every
 * decision is one Pi run: the context hook replaces earlier history with a
 * rebuilt working set (hypotheses, memory, skills, recent actions, current
 * grid), and the run ends with exactly one arc_action. run_skill is exposed
 * only while skills exist, and its name parameter is bound to the saved names.
 * Design: docs/plans/2026-10-08-thin-arc-self-harness-extension.md; memory
 * format: docs/plans/2026-10-09-thin-hypothesis-memory.md; hypotheses, strategies
 * and revisions: docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md; skill binding:
 * docs/plans/2026-10-09-thin-skill-call-binding.md. Optional ledger and critic
 * (ARC_HARNESS_LEDGER / ARC_HARNESS_CRITIC): docs/plans/2026-10-09-lightweight-hypothesis-loop-with-critic.md
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
import { evaluateTaskPython, TaskPythonError, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";
import { SKILL_LIMITS, guestFailure, skillGuestProgram, type GuestResult } from "./arc_thin_skill_guest.ts";
import { sharedTaskPythonPool } from "./pi_task_python_pool.ts";
import { buildLedger, leaves, normIdea, renderLedgerView, type LedgerState, type Observation } from "./arc_thin_ledger.ts";
import {
	CRITIC_SYSTEM, DEFAULT_CRITIC, buildDossier, criticTriggers, parseCriticReply, type CriticConfig, type CriticNote,
} from "./arc_thin_critic.ts";
import {
	MAX_EVIDENCE, MAX_HYPOTHESES, MAX_STRATEGIES, STATUSES, STRATEGY_STATUSES, VERDICTS, applyRow, applyRows, emptyMemory, memoryForSkills,
	planMemoryUpdate, renderMemory, resetMemory, type ComponentContext, type MemoryParams,
} from "./arc_thin_memory.ts";
import { isEnvironmentFailure, repairActionArguments, repairMemoryArguments, repairSkillArguments } from "./arc_thin_boundary.ts";

/** run_skill is added to these while at least one skill is saved (refreshSkillSurface). */
const DECISION_TOOLS = ["arc_action", "memory", "skill", "prompt", "ask_analyst"];
const CONSOLIDATION_TOOLS = ["memory", "skill", "prompt", "ask_analyst"];
const SOFT_TOOL_CALLS = 12;
const HARD_TOOL_CALLS = 16;
const MAX_SKILLS = 40;
const RECENT_ACTIONS = 8;
const TOOL_RESULT_CHARS = 8000;
const ANALYST_SYSTEM = "You are a careful visual analyst for a 64x64 integer grid. Answer the question precisely; cite coordinates (x,y).";
/** Shown only when the ledger is enabled (the prompt's {{board}} slot). */
const LEDGER_PROMPT = `
Ideas
- On arc_action you may add idea (a short name for what the move pursues) and
  expect (what you think will happen, at any time scale). The runtime groups
  your moves by idea, tracks effort per idea and what your skills measure, and
  shows it under IDEAS. You do not need to record results yourself.
`;
const CRITIC_PROMPT = `- At important moments a CRITIC note from an independent reviewer may appear.
  It is advisory.
`;
const OBSERVE_LIMITS = { ...SKILL_LIMITS, timeout_ms: 5000 };
const OBSERVE_WAIT_MS = 5000;
const OBSERVE_BACKFILL = 200;
const CRITIC_GRACE_MS = 3000;

type Skill = { version: number; description: string; source: string };
type ActionRow = {
	n: number; decision: number; action: string; x?: number; y?: number; note?: string; idea?: string; expect?: string;
	changed_cells: number | null; bbox?: unknown; level_changed: boolean; state: string;
	levels_completed: number; budget: any; changes?: string;
};

/** A model-facing tool error: expected, shown to the model, not logged as a harness fault. */
class Refusal extends Error {}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function arcThinExtension(pi: ExtensionAPI) {
	const control = process.env.ARC_THIN_VARIANT === "control";
	const criticOn = !control && process.env.ARC_HARNESS_CRITIC === "enabled";
	const ledgerOn = !control && (process.env.ARC_HARNESS_LEDGER === "enabled" || criticOn);
	const game = process.env.ARC_GAME ?? "unknown";
	const storeDir = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "harness");
	mkdirSync(storeDir, { recursive: true });

	// ---------------------------------------------------------------- stores

	const memory = emptyMemory();
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
		resetMemory(memory);
		for (const row of readRows("memory.jsonl")) applyRow(memory, row);
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
		if (!response.ok) throw Object.assign(new Error(String(value?.error ?? `HTTP ${response.status}`)), { status: response.status });
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
		/** Results of tools that shared the message with arc_action: the agent never sees them in this decision. */
		batchResults: string[];
		workingSet?: { text: string; image?: { type: "image"; data: string; mimeType: string } };
	};
	const freshRun = (): Run => ({
		consolidating: false, assistantMessages: 0, toolCalls: 0, arcSeenInMessage: -1, endBatchAt: -1, actionDone: false,
		batchResults: [],
	});
	let run = freshRun();
	/** Batched results carried into the next decision's working set (shown once). */
	let carriedResults: string[] = [];
	const CARRIED_RESULT_CHARS = 400;

	/** Skills and the overlay, as strategies reference them (uses: "skill:<name>", "prompt"). */
	const components = (): ComponentContext => ({
		skills: Object.fromEntries([...skills].map(([name, skill]) => [name, skill.version])), overlay,
	});
	const memoryText = () => renderMemory(memory, trajectory.length, trajectory.map(actionLabel), components());

	function skillsText(): string {
		if (skills.size === 0)
			return `SKILLS: none saved, so run_skill is not available yet — write one with skill(op="set") when you repeat a calculation.`;
		const usedBy = (name: string) => [...memory.strategies].filter(([, s]) => s.uses.includes(`skill:${name}`))
			.map(([key, s]) => `${key} (${s.status})`);
		return [`SKILLS (${skills.size}):`,
			...[...skills].map(([name, skill]) => `- ${name} v${skill.version} — ${skill.description || "(no description)"}` +
				(usedBy(name).length ? ` [used by ${usedBy(name).join(", ")}]` : ""))].join("\n");
	}

	function recentText(): string {
		if (trajectory.length === 0) return "RECENT ACTIONS: none yet.";
		const recent = trajectory.slice(-RECENT_ACTIONS);
		return [`RECENT ACTIONS (last ${recent.length} of ${trajectory.length}):`,
			...recent.map((row) => actionLine(row) + (row.note ? ` | note: ${row.note}` : ""))].join("\n");
	}

	function buildWorkingSet(ctx: ExtensionContext): Run["workingSet"] {
		const sections = control ? [recentText()] : [memoryText(), skillsText(), recentText()];
		if (carriedResults.length)
			sections.push(["RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION:", ...carriedResults.map((line) => `- ${line}`)].join("\n"));
		const latest = trajectory.at(-1);
		if (latest?.changes && Number.isInteger(latest.budget?.total_used)
			&& latest.budget.total_used === observation?.action_budget?.total_used)
			sections.push(`LATEST ACTION #${latest.n} ${actionLabel(latest)}\n${latest.changes}`);
		if (ledgerText) sections.push(ledgerText);
		if (criticText) sections.push(criticText);
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
		skillProgram ??= skillGuestProgram(SKILL_LIMITS);
		try {
			return (await evaluateTaskPython(skillProgram, input, signal)).value as GuestResult;
		} catch (error) {
			if (!(error instanceof TaskPythonError)) throw error;
			if (error.code === "environment_unavailable" || error.code === "version_conflict") throw error;
			return { ok: false, error: `${error.code}: ${error.message}`.slice(0, 600) };
		}
	}

	/** Syntax-check and save one skill version. */
	async function saveSkill(name: string, description: string, source: string,
		signal?: AbortSignal): Promise<{ ok: true; version: number } | { ok: false; reason: string }> {
		if (!/\bdef\s+run\s*\(/.test(source)) return { ok: false, reason: "source must define run(state, args)" };
		if (!skills.has(name) && skills.size >= MAX_SKILLS)
			return { ok: false, reason: `skill limit (${MAX_SKILLS}) reached; delete a skill first` };
		const check = await runGuest({ mode: "check", source }, signal);
		if (!check.ok) return { ok: false, reason: guestFailure(check) };
		const version = (skillVersions.get(name) ?? 0) + 1;
		const skill: Skill = { version, description, source };
		skillVersions.set(name, version);
		skills.set(name, skill);
		append("skills.jsonl", { name, ...skill });
		refreshSkillSurface();
		if (ledgerOn) backfillSkill(name, skill);
		return { ok: true, version };
	}

	// ---------------------------------------------------------------- skill call surface

	/**
	 * Bind the calling interface to the skill registry: run_skill is active only
	 * while skills exist, and its name parameter is an enum of exactly the saved
	 * names. Re-registering a tool mid-run changes its schema from the next
	 * provider request, and setActiveTools applies from the next turn (Pi 0.80.6
	 * spike, tools/pi_tool_rebind_spike.ts). A call in the same message as the
	 * save is validated against the schema the message was written for.
	 */
	let boundNames: string | undefined;
	let toolsReady = false;
	let lastSurface = "";
	function refreshSkillSurface(base?: string[]): void {
		if (control) return;
		const names = [...skills.keys()].sort();
		if (names.length && names.join(",") !== boundNames) {
			registerRunSkill(names);
			boundNames = names.join(",");
		}
		// pi.setActiveTools is unavailable while the extension loads.
		if (!toolsReady) return;
		const tools = (base ?? pi.getActiveTools()).filter((name) => name !== "run_skill");
		if (names.length) tools.push("run_skill");
		pi.setActiveTools(tools);
		const surface = JSON.stringify([tools.includes("run_skill"), names]);
		if (surface === lastSurface) return;
		lastSurface = surface;
		append("skill_surface.jsonl", { decision, turn: run.assistantMessages, active: tools, names });
	}

	// ---------------------------------------------------------------- ledger, skill observation and critic
	// All of this is advisory and external to the agent's workflow: failures are
	// logged and the decision proceeds unchanged.

	const pool = sharedTaskPythonPool();
	const observeProgram = skillGuestProgram(OBSERVE_LIMITS);
	const grids = new Map<number, number[][]>();
	let observations: Observation[] = [];
	const observeStats = new Map<string, { ok: number; error: number }>();
	let observer: Promise<void> = Promise.resolve();
	let ledgerText = "";
	let criticText = "";
	let criticNotes: CriticNote[] = [];
	let criticCheckedThrough = 0;
	let criticShownDecision = -10;
	let criticInFlight: Promise<void> | undefined;
	let criticPending: CriticNote | undefined;
	const envNumber = (name: string, fallback: number) => Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback;
	const criticConfig: CriticConfig = {
		...DEFAULT_CRITIC,
		minGap: envNumber("ARC_CRITIC_MIN_GAP", DEFAULT_CRITIC.minGap),
		effortRun: envNumber("ARC_CRITIC_EFFORT_RUN", DEFAULT_CRITIC.effortRun),
		experimentMin: envNumber("ARC_CRITIC_EXPERIMENT_MIN", DEFAULT_CRITIC.experimentMin),
		stall: envNumber("ARC_CRITIC_STALL", DEFAULT_CRITIC.stall),
		perLevel: envNumber("ARC_CRITIC_PER_LEVEL", DEFAULT_CRITIC.perLevel),
	};
	const observeKey = (name: string, version: number) => `${name}@v${version}`;

	function loadLedgerStores(): void {
		grids.clear();
		for (const row of readRows("states.jsonl")) if (Array.isArray(row.grid)) grids.set(Number(row.n), row.grid);
		observations = readRows("observations.jsonl");
		observeStats.clear();
		for (const row of observations) {
			const stats = observeStats.get(observeKey(row.skill, row.version)) ?? { ok: 0, error: 0 };
			row.ok ? stats.ok += 1 : stats.error += 1;
			observeStats.set(observeKey(row.skill, row.version), stats);
		}
		const critic = readRows("critic.jsonl");
		criticNotes = critic.filter((row) => row.kind === "note");
		criticCheckedThrough = Math.max(0, ...critic.filter((row) => row.kind === "check").map((row) => Number(row.through) || 0));
	}

	function recordState(n: number, grid: number[][] | undefined): void {
		if (!ledgerOn || !grid || grids.has(n)) return;
		grids.set(n, grid);
		append("states.jsonl", { n, grid });
	}

	/** Run one saved skill with args={} on one state. A version that never succeeds is skipped after 3 errors. */
	async function observeOne(n: number, name: string, skill: Skill, state: Record<string, unknown>): Promise<void> {
		const key = observeKey(name, skill.version);
		const stats = observeStats.get(key) ?? { ok: 0, error: 0 };
		if (stats.ok === 0 && stats.error >= 3) return;
		if (observations.some((row) => row.n === n && row.skill === name && row.version === skill.version)) return;
		let row: Observation;
		try {
			const result = (await pool.evaluate(observeProgram, { mode: "run", source: skill.source, state, args: {} })).value as GuestResult;
			row = result.ok
				? { n, skill: name, version: skill.version, ok: true, value: JSON.stringify(result.value ?? null).length <= 4000 ? result.value : leaves(result.value) }
				: { n, skill: name, version: skill.version, ok: false, error: guestFailure(result).slice(0, 200) };
		} catch (error) { row = { n, skill: name, version: skill.version, ok: false, error: errorText(error).slice(0, 200) }; }
		row.ok ? stats.ok += 1 : stats.error += 1;
		observeStats.set(key, stats);
		observations.push(row);
		append("observations.jsonl", row);
	}

	function enqueueObservation(task: () => Promise<void>): void {
		observer = observer.then(task).catch((error) => logError("ledger:observe", error));
	}

	function observeState(n: number, state: Record<string, unknown>): void {
		if (!ledgerOn) return;
		const current = [...skills];
		enqueueObservation(async () => { for (const [name, skill] of current) await observeOne(n, name, skill, state); });
	}

	/** Replay a newly saved skill on earlier states (memory is the current memory). */
	function backfillSkill(name: string, skill: Skill): void {
		const ns = [...grids.keys()].sort((a, b) => a - b).slice(-OBSERVE_BACKFILL);
		enqueueObservation(async () => {
			for (const n of ns) {
				const grid = grids.get(n);
				if (!grid) continue;
				const row = trajectory[n - 1];
				await observeOne(n, name, skill, {
					grid, prev_grid: grids.get(n - 1) ?? null, state: row?.state ?? null, levels_completed: row?.levels_completed ?? 0,
					available_actions: availableActions(observation), action_budget: row?.budget ?? null,
					recent_actions: trajectory.slice(Math.max(0, n - RECENT_ACTIONS), n), ...memoryForSkills(memory),
				});
			}
		});
	}

	const decisionLine = (row: ActionRow) => actionLine(row) + (row.idea ? ` | idea: ${row.idea}` : "")
		+ (row.expect ? ` | expect: ${row.expect}` : "") + (row.note ? ` | note: ${row.note}` : "");

	async function runCritic(ctx: ExtensionContext | undefined, state: LedgerState, triggers: string[], previous: number): Promise<void> {
		if (!ctx?.model) return;
		const dossier = buildDossier({
			state, triggers, memoryText: memoryText(),
			skills: [...skills].map(([name, skill]) => `${name} v${skill.version} — ${skill.description || "(no description)"}`),
			notes: criticNotes, recentLines: trajectory.slice(-15).map(decisionLine),
			currentState: observation ? renderArcLatestFrameRuns(observation) : "(unavailable)",
		});
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok) throw new Error(`critic call failed: ${auth.error}`);
		const level = ctx.thinkingLevel ?? pi.getThinkingLevel();
		const reply: any = await completeSimple(ctx.model, {
			systemPrompt: CRITIC_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: dossier }], timestamp: Date.now() }],
		} as any, {
			signal: AbortSignal.timeout(criticConfig.timeoutMs), apiKey: auth.apiKey, headers: auth.headers, env: auth.env,
			maxTokens: criticConfig.maxOutputTokens,
			...(ctx.model.reasoning && level && level !== "off" ? { reasoning: level } : {}),
		} as any);
		appendUsage("critic", reply);
		const answer = (reply.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");
		const parsed = parseCriticReply(answer, trajectory.length, availableActions(observation));
		const current = state.experiments.at(-1);
		const note: CriticNote = {
			at: trajectory.length, level: trajectory.at(-1)?.levels_completed ?? 0, triggers, ...parsed,
			...(current?.labelled ? { idea_at: current.label } : {}),
			repeat_keys: state.repeats.filter((item) => item.n > previous).map((item) => item.key.split("|").slice(1).join("|")),
		};
		criticNotes.push(note);
		append("critic.jsonl", { kind: "note", ...note, stop_reason: reply.stopReason,
			...(reply.errorMessage ? { error: String(reply.errorMessage).slice(0, 300) } : {}), dossier_chars: dossier.length });
		if (note.lines.length || note.suggest) criticPending = note;
	}

	/**
	 * Start the critic without waiting: a slow critic must never delay a decision.
	 * At most one call runs; its note is shown at the first decision after it completes.
	 */
	function startCritic(ctx: ExtensionContext | undefined, state: LedgerState, triggers: string[], previous: number): void {
		if (criticInFlight) { append("critic.jsonl", { kind: "suppressed", at: trajectory.length, reason: "critic busy", triggers }); return; }
		criticInFlight = runCritic(ctx, state, triggers, previous)
			.catch((error) => { logError("critic", error); append("critic.jsonl", { kind: "failed", at: state.rows.at(-1)?.n ?? 0, triggers, error: errorText(error).slice(0, 300) }); })
			.finally(() => { criticInFlight = undefined; });
	}

	/** Before each decision: bounded wait for observations, the ledger view, and the critic when triggered. */
	async function prepareLedger(ctx: ExtensionContext | undefined): Promise<void> {
		ledgerText = ""; criticText = "";
		if (!ledgerOn) return;
		const grid = gridOf(observation);
		if (grid && !grids.has(trajectory.length)) {
			recordState(trajectory.length, grid);
			observeState(trajectory.length, skillState(false));
		}
		await Promise.race([observer, new Promise((resolve) => setTimeout(resolve, OBSERVE_WAIT_MS))]);
		const state = buildLedger(trajectory, observations, grids);
		ledgerText = renderLedgerView(state, [...memory.hypotheses.keys()]);
		if (!criticOn) return;
		const previous = criticCheckedThrough;
		const { triggers, suppressed } = criticTriggers(state, criticNotes, previous, memory.hypotheses.size, criticConfig);
		if (suppressed.length) append("critic.jsonl", { kind: "suppressed", at: trajectory.length, triggers: suppressed });
		if (trajectory.length > previous) {
			criticCheckedThrough = trajectory.length;
			append("critic.jsonl", { kind: "check", through: trajectory.length });
		}
		if (triggers.length) startCritic(ctx, state, triggers, previous);
		// A fast critic is shown in this decision; a slow one at the first decision after it finishes.
		if (criticInFlight) await Promise.race([criticInFlight, new Promise((resolve) => setTimeout(resolve, CRITIC_GRACE_MS))]);
		if (criticPending) {
			const note = criticPending;
			criticPending = undefined;
			criticShownDecision = decision;
			append("critic.jsonl", { kind: "shown", note_at: note.at, at: trajectory.length, decision });
			criticText = [`CRITIC (independent review at #${note.at}${note.at < trajectory.length ? `, ${trajectory.length - note.at} action(s) ago` : ""}, advisory):`,
				...note.lines.map((line) => `- ${line}`),
				...(note.suggest ? [`suggest: ${note.suggest.x !== undefined ? `${note.suggest.action}(${note.suggest.x},${note.suggest.y})` : note.suggest.action}`] : [])].join("\n");
		} else if (criticNotes.length && criticShownDecision > 0 && decision - criticShownDecision <= 2)
			criticText = `CRITIC: last review at #${criticNotes.at(-1)!.at} (shown once).`;
	}

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
			...memoryForSkills(memory),
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
		/** A result produced alongside arc_action is carried into the next decision; the agent cannot see it now. */
		const carry = (result: any, failed: boolean) => {
			if (name === "arc_action" || !endsBatch()) return result;
			const body = String(result?.content?.[0]?.text ?? "").replace(/\s+/g, " ").trim();
			run.batchResults.push(`${name}${failed ? " FAILED" : ""}: ` +
				(body.length > CARRIED_RESULT_CHARS ? `${body.slice(0, CARRIED_RESULT_CHARS - 1)}…` : body));
			append("batch_results.jsonl", { decision, tool: name, failed });
			return result;
		};
		return async (_id: string, params: P, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) => {
			const verdict = gate(name);
			if (verdict) {
				// Sharing a message with arc_action: every result must terminate or the run continues.
				if (verdict.terminate || (name !== "arc_action" && endsBatch())) return carry(refused(verdict.reason), true);
				throw new Refusal(verdict.reason);
			}
			try { return carry(await fn(params, signal, ctx), false); }
			catch (error) {
				if (!(error instanceof Refusal)) logError(`tool:${name}`, error);
				if (name !== "arc_action" && endsBatch()) return carry(refused(errorText(error)), true);
				throw error;
			}
		};
	}

	pi.registerTool({
		name: "arc_action",
		label: "ARC action",
		description: "Submit one action and end this decision. Only ACTION6 uses x,y (0..63; (x,y)=frame[y][x]). " +
			"Put a one-line rationale in note; it is shown in RECENT ACTIONS on later decisions. Other tool calls in the same " +
			"message (e.g. memory updates) are executed too, and their results are shown at your next decision." +
			(ledgerOn ? " Optional idea and expect are tracked for you under IDEAS." : ""),
		parameters: Type.Object({
			action: StringEnum(["ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "RESET"] as const),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			note: Type.Optional(Type.String({ maxLength: 300 })),
			// No length limits here: an over-long value is clipped, never a reason to reject the action.
			...(ledgerOn ? {
				idea: Type.Optional(Type.String({ description: "Short name for what this move pursues, e.g. \"map the controls\"." })),
				expect: Type.Optional(Type.String({ description: "What you think will happen, at any time scale." })),
			} : {}),
		}),
		prepareArguments: repairActionArguments,
		execute: guardTool("arc_action", async (params: { action: string; x?: number; y?: number; note?: string; idea?: unknown; expect?: unknown }) => {
			const beforeGrid = gridOf(observation);
			const label = actionLabel(params);
			const payload: Record<string, unknown> = { action: params.action };
			if (params.x !== undefined && params.y !== undefined) { payload.x = params.x; payload.y = params.y; }
			if (params.note) payload.reasoning = params.note;
			const idea = ledgerOn ? normIdea(params.idea) : "";
			const expect = ledgerOn && typeof params.expect === "string" ? params.expect.replace(/\s+/g, " ").trim().slice(0, 300) : "";
			let value: Record<string, any>;
			// No agent abort signal here: an aborted request could still apply an unrecorded action.
			try { value = await bridgeCall("/action", payload, 120_000); }
			catch (error) {
				// The environment failing is not the agent's to fix: end the decision instead of
				// letting it retry the same call (each retry is a full model turn plus the timeout).
				if (isEnvironmentFailure(error)) {
					append("errors.jsonl", { hook: "arc_action:environment", environment: true, decision, action: label, message: errorText(error).slice(0, 500) });
					return refused(`arc_action ${label} failed because the environment did not respond (${errorText(error).slice(0, 200)}). ` +
						`This decision ends; the runner checks the environment before the next one.`);
				}
				throw new Refusal(`arc_action ${label} failed: ${errorText(error)}`);
			}
			run.actionDone = true;
			previousGrid = beforeGrid;
			observation = value;
			const delta = value.observation_delta ?? {};
			const row: ActionRow = {
				n: trajectory.length + 1, decision, action: params.action,
				...(params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : {}),
				...(params.note ? { note: params.note } : {}),
				...(idea ? { idea } : {}),
				...(expect ? { expect } : {}),
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
		const text600 = Type.String({ minLength: 1, maxLength: 600 });
		const confidence = Type.Integer({ minimum: 1, maximum: 5, description: "1=guess, 5=verified" });
		const line = (maxLength: number, description: string) => Type.String({ maxLength, description });
		pi.registerTool({
			name: "memory",
			label: "Memory",
			description: "Facts, competing hypotheses and strategies shown at every later decision. One call is one atomic batch: " +
				"set=[{key,text}] upserts facts, delete=[keys] removes entries (\"state_*\" removes every key with that prefix), " +
				"hypotheses=[{key:\"hyp.<name>\", question, claim, predicts, next_test, status, evidence}] creates or updates hypotheses " +
				"(the same question = rivals), tests=[{action, condition, observed, verdicts:{\"hyp.<name>\": verdict}}] records one test " +
				"against every rival it bears on, strategies=[{key:\"strat.<name>\", plan, depends_on, uses, status}] records what you " +
				"pursue and what it rests on. Evidence is appended, never overwritten. Rejecting or deleting a hypothesis suspends the " +
				"active strategy that depends on it. If any part is invalid nothing is applied. " +
				"Single form: key+text (set), op=\"delete\"+key, op=\"list\".",
			parameters: Type.Object({
				op: Type.Optional(StringEnum(["set", "delete", "list", "update"] as const)),
				key: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
				text: Type.Optional(text600),
				confidence: Type.Optional(confidence),
				set: Type.Optional(Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 64 }), text: text600, confidence: Type.Optional(confidence),
				}), { maxItems: 12 })),
				delete: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 40 })),
				hypotheses: Type.Optional(Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 48, description: "hyp.<name>" }),
					question: Type.Optional(line(40, "What it answers, e.g. \"controls\" or \"goal\". Hypotheses with the same question are rivals.")),
					claim: Type.Optional(line(300, "What you think is true (a control rule or the goal).")),
					predicts: Type.Optional(line(300, "What a specific action should do if the claim is true.")),
					status: Type.Optional(StringEnum(STATUSES)),
					next_test: Type.Optional(line(300, "The cheapest action that would tell this apart from its rivals.")),
					evidence: Type.Optional(Type.Object({
						action: Type.Optional(Type.Integer({ minimum: 1, description: "Action number #n of the test." })),
						condition: line(200, "The state that mattered when you tested, e.g. 'before object A was touched'."),
						observed: line(300, "What actually happened."),
						verdict: StringEnum(VERDICTS),
					}, { description: `One test result for this hypothesis, appended (latest ${MAX_EVIDENCE} kept; refutations kept first).` })),
				}), { maxItems: MAX_HYPOTHESES })),
				tests: Type.Optional(Type.Array(Type.Object({
					action: Type.Optional(Type.Integer({ minimum: 1, description: "Action number #n of the test." })),
					condition: line(200, "The state that mattered when you tested."),
					observed: line(300, "What actually happened."),
					verdicts: Type.Record(Type.String(), StringEnum(VERDICTS), {
						description: "One verdict per hypothesis this test bears on, e.g. {\"hyp.a\": \"refutes\", \"hyp.b\": \"inconclusive\"}.",
					}),
				}), { maxItems: 4 })),
				strategies: Type.Optional(Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 48, description: "strat.<name>" }),
					plan: Type.Optional(line(300, "What you are doing and until when.")),
					depends_on: Type.Optional(Type.Array(Type.String({ maxLength: 48 }), { maxItems: 4, description: "hyp.<name> keys it rests on." })),
					uses: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), {
						maxItems: 6, description: "Components it relies on: \"skill:<name>\", \"memory:<key>\", \"prompt\".",
					})),
					status: Type.Optional(StringEnum(STRATEGY_STATUSES, { description: "A new strategy is active by default; one active at a time." })),
				}), { maxItems: MAX_STRATEGIES })),
			}),
			prepareArguments: repairMemoryArguments,
			execute: guardTool("memory", (params: MemoryParams) => {
				const plan = planMemoryUpdate(memory, params, trajectory.length, components());
				if (!plan.ok) throw new Refusal(plan.error);
				for (const row of plan.rows) append("memory.jsonl", row);
				applyRows(memory, plan.rows);
				return text(plan.receipt, undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "skill",
			label: "Skill",
			description: "Save (upsert by name), delete, or get the source of a Python skill. Source must define run(state, args) " +
				"and return JSON-serialisable data. state has grid, prev_grid, frames, levels_completed, available_actions, " +
				"recent_actions, memory, hypotheses. Standard library only; no I/O. Once saved, call it with run_skill " +
				"from your next step. Example: def run(state, args):\n" +
				"    g=state['grid']\n    return {'count': sum(r.count(args['color']) for r in g)}",
			parameters: Type.Object({
				op: StringEnum(["set", "delete", "get"] as const),
				name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
				description: Type.Optional(Type.String({ maxLength: 200, description: "One line: what it returns; shown in the skill directory." })),
				source: Type.Optional(Type.String({ maxLength: 16384 })),
			}),
			prepareArguments: repairSkillArguments,
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
					refreshSkillSurface();
					return text(`skill deleted ${params.name} (${skills.size} skills); run_skill(name="${params.name}") is no longer callable`,
						undefined, endsBatch());
				}
				const notSaved = (reason: string) => new Refusal(
					`skill '${params.name}' not saved: ${reason}\nResubmit the whole source with skill(op="set", ...)`);
				if (!params.source) throw notSaved("source is required");
				const saved = await saveSkill(params.name, params.description ?? existing?.description ?? "", params.source, signal);
				if (!saved.ok) throw saved.reason.startsWith("skill limit")
					? new Refusal(`${saved.reason}. Skills: ${names()}`) : notSaved(saved.reason);
				return text(`skill set ${params.name} v${saved.version} (syntax ok); run_skill(name="${params.name}") is callable ` +
					`from your next step`, undefined, endsBatch());
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

	/** (Re-)register run_skill with name bound to `names` (non-empty). Activation is refreshSkillSurface's job. */
	function registerRunSkill(names: string[]): void {
		pi.registerTool({
			name: "run_skill",
			label: "Run skill",
			description: "Run one of your saved skills on the current state. Returns its JSON result, or the Python error with the failing line.",
			parameters: Type.Object({
				name: StringEnum(names as [string, ...string[]]),
				args: Type.Optional(Type.Record(Type.String(), Type.Any())),
				include_frames: Type.Optional(Type.Boolean({ description: "Also pass all animation frames of the last action (bigger input)." })),
			}),
			execute: guardTool("run_skill", async (params: { name: string; args?: Record<string, unknown>; include_frames?: boolean }, signal) => {
				// The schema already restricts name; this covers a call validated before a delete.
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
	}

	// ---------------------------------------------------------------- hooks

	function guard<A extends unknown[], R>(hook: string, fn: (...args: A) => R | Promise<R>) {
		return async (...args: A): Promise<R> => {
			try { return await fn(...args); }
			catch (error) { logError(hook, error); throw error; }
		};
	}

	replay();
	if (ledgerOn) loadLedgerStores();
	refreshSkillSurface();

	pi.on("session_start", guard("session_start", () => {
		replay();
		if (ledgerOn) loadLedgerStores();
		toolsReady = true;
		refreshSkillSurface();
	}));

	pi.on("before_agent_start", guard("before_agent_start", async (event: any, ctx: ExtensionContext) => {
		carriedResults = run.batchResults;
		run = freshRun();
		decision += 1;
		run.consolidating = !control && String(event.prompt ?? "").trimStart().startsWith("CONSOLIDATE:");
		toolsReady = true;
		if (control) pi.setActiveTools(["arc_action"]);
		else refreshSkillSurface(run.consolidating ? CONSOLIDATION_TOOLS : DECISION_TOOLS);
		try { observation = await bridgeCall("/state"); }
		catch (error) { observation = undefined; logError("before_agent_start:/state", error, true); }
		// The ledger and critic are advisory: any failure leaves the decision unchanged.
		try { await prepareLedger(ctx); } catch (error) { ledgerText = ""; criticText = ""; logError("ledger:prepare", error); }
		const systemPrompt = control
			? renderPrompt("arc_thin_control_system.md", { game })
			: renderPrompt("arc_thin_system.md", {
				game, overlay: overlay ? `Your standing instructions (set with prompt):\n${overlay}` : "",
				board: ledgerOn ? LEDGER_PROMPT + (criticOn ? CRITIC_PROMPT : "") : "",
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
