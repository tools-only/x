/**
 * Thin ARC-AGI-3 self-harness for Pi.
 *
 * Six registered tools (arc_action, memory, skill, run_skill, prompt,
 * ask_analyst), five hooks, and append-only JSONL stores under
 * <ARC_RUN_ROOT>/harness/. Only the phase-relevant tools are active in a
 * provider request: action turns use the core action/self-harness surface;
 * review turns add the low-frequency prompt and analyst tools. Every
 * decision is one Pi run: the context hook replaces earlier history with a
 * rebuilt working set (hypotheses, memory, skills, recent actions, current
 * grid), and the run ends with exactly one arc_action. run_skill is exposed
 * only while skills exist, and its name parameter is bound to the saved names.
 * Design: docs/plans/2026-10-08-thin-arc-self-harness-extension.md; memory
 * format: docs/plans/2026-10-09-thin-hypothesis-memory.md; hypotheses, strategies
 * and revisions: docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md; skill binding:
 * docs/plans/2026-10-09-thin-skill-call-binding.md. Ledger and critic, on by default
 * (ARC_HARNESS_LEDGER / ARC_HARNESS_CRITIC = "disabled" to turn off): docs/plans/2026-10-09-lightweight-hypothesis-loop-with-critic.md.
 * Scored predictions, state.history for skills, the working-set log and the
 * opt-in comparison variable ARC_THIN_CARRY_REASONING:
 * docs/plans/2026-10-10-self-harness-priority-plan.md. The agent is shown the
 * current grid and what the environment reported; it gets no frame comparison or
 * derived view from the project. Cross-frame analysis is a tool the agent writes
 * from state["prev_grid"] and state["history"] (§10.9 of that plan).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { renderPrompt } from "./prompt_loader.ts";
import { evaluateTaskPython, TaskPythonError, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";
import { SKILL_LIMITS, arcSkillFoundation, guestFailure, arcSkillGuestProgram, type GuestResult } from "./arc_thin_skill_guest.ts";
import { backtestCases, renderBacktest, scoreBacktest, type GuestCaseResult, type ModelCheck } from "./arc_thin_backtest.ts";
import { sharedTaskPythonPool } from "./pi_task_python_pool.ts";
import { buildLedger, explorationLine, goalCoverageLine, isGoalHypothesis, leaves, normIdea, renderLedgerView, type GoalHypothesisRef, type LedgerState, type Observation } from "./arc_thin_ledger.ts";
import {
	CRITIC_SYSTEM, DEFAULT_CRITIC, IGNORED_REVIEW, buildDossier, criticTriggers, parseCriticReply, type CriticConfig, type CriticNote,
} from "./arc_thin_critic.ts";
import {
	MAX_EVIDENCE, MAX_HYPOTHESES, MAX_STEPS, MAX_STRATEGIES, STATUSES, STRATEGY_STATUSES, VERDICTS, applyRow, applyRows, emptyMemory, memoryForSkills,
	planMemoryUpdate, renderFactsCompact, renderMemory, resetMemory, type ComponentContext, type MemoryParams,
} from "./arc_thin_memory.ts";
import { isEnvironmentFailure, repairActionArguments, repairMemoryArguments, repairSkillArguments, unescapeSource } from "./arc_thin_boundary.ts";
import {
	normalizePrediction, predictionSchema, renderScore, scorePrediction, type Outcome, type Prediction, type ScoredPrediction,
} from "./arc_thin_prediction.ts";
import { buildHistory, type CellChange } from "./arc_thin_history.ts";
import { ANALYST_SYSTEM, analystMessage, analystReceipt, type AnalystInputs } from "./arc_thin_analyst.ts";
import { artifactHistory, artifactInputs, newArtifactRecords, renderArtifacts, splitArtifacts, type ArtifactRecord } from "./arc_thin_artifacts.ts";
import { claimSegments, claimVersion, levelOf, renderClaimSummary, summarizeClaim, type ClaimRow, type ClaimValue } from "./arc_thin_claims.ts";

/** run_skill is added to these while at least one skill is saved (refreshSkillSurface). */
// Keep action requests small. Prompt editing and the one-shot analyst remain
// available on the existing consolidation turn, where there is no action
// boundary to compete with and their schemas are not resident on every move.
const DECISION_TOOLS = ["arc_action", "memory", "skill", "python"];
const LOW_FREQUENCY_TOOLS = ["prompt", "ask_analyst"];
const EXPANDED_DECISION_TOOLS = [...DECISION_TOOLS, ...LOW_FREQUENCY_TOOLS];
const CONSOLIDATION_TOOLS = ["memory", "skill", "python", "prompt", "ask_analyst"];
// A tool-only chain is a new provider request with the whole projected context.
// Keep the escape hatch for a short repair, but stop before a model can spend a
// dozen requests measuring the same frame instead of submitting an action.
const SOFT_TOOL_CALLS = 6;
const HARD_TOOL_CALLS = 8;
const MAX_EXPLICIT_SKILL_CALLS = 4;
const MAX_SKILLS = 40;
const RECENT_ACTIONS = 8;
/** A consolidation turn sees every action since the previous one, up to this many. */
const REVIEW_ACTIONS = 40;
const TOOL_RESULT_CHARS = 4000;
const SKILL_RESULT_CHARS = 2400;
/** Shown only when the ledger is enabled (the prompt's {{board}} slot). */
const LEDGER_PROMPT = `
Ideas
- On arc_action you may add idea (a short name for what the move pursues). The
  runtime groups your moves by idea, keeps what you wrote in predict.text next
  to what happened, tracks effort per idea and what your skills measure, and
  shows it under IDEAS. You do not need to record results yourself.
`;
const CRITIC_PROMPT = `- At important moments a CRITIC note from an independent reviewer may appear.
  It is advisory.
`;
const OBSERVE_LIMITS = { ...SKILL_LIMITS, timeout_ms: 5000 };
const OBSERVE_WAIT_MS = 5000;
const OBSERVE_BACKFILL = 200;
/** What one skill's automatic result, and all of them together, may take in the working set. */
const SKILL_OUTPUT_CHARS = 900;
const SKILL_OUTPUTS_CHARS = 2400;
const clipJson = (value: unknown, max: number) => {
	let json: string;
	try { json = JSON.stringify(value ?? null); }
	catch (error) { return `(result could not be serialized: ${errorText(error).slice(0, 180)})`; }
	if (typeof json !== "string") return "(result could not be serialized)";
	return json.length > max ? `${json.slice(0, Math.max(0, max - 1))}… (${json.length} chars)` : json;
};
const CRITIC_WAIT_MS = Number(process.env.ARC_CRITIC_WAIT_MS) > 0 ? Number(process.env.ARC_CRITIC_WAIT_MS) : 30_000;
const ANALYST_MAX_OUTPUT_TOKENS = 512;

/** saved_at: actions taken when this version was saved; saved_level: levels completed then; observe: false = not run automatically. */
type Skill = { version: number; description: string; source: string; saved_at?: number; saved_level?: number; observe?: boolean };
/** A skill named as the predictor of one action: its scored prediction, or why there was none. */
type SkillPrediction = { name: string; version?: number; error?: string } & Partial<ScoredPrediction>;
/**
 * One action as stored in trajectory.jsonl. changed_cells and bbox come from the
 * bridge and are kept for evaluation only: the agent is never shown a frame
 * comparison it did not compute itself.
 */
type ActionRow = {
	n: number; decision: number; action: string; x?: number; y?: number; note?: string; idea?: string; expect?: string;
	changed_cells: number | null; bbox?: unknown; level_changed: boolean; state: string;
	levels_completed: number; budget: any;
	predict?: Prediction; prediction?: ScoredPrediction; skill_prediction?: SkillPrediction;
};
/** What the environment reported for an action, as skills and history see it. */
const reportedAction = (row: ActionRow) => ({
	n: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
	...(row.note ? { note: row.note } : {}),
	level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed, budget: row.budget,
});

/** A model-facing tool error: expected, shown to the model, not logged as a harness fault. */
class Refusal extends Error {}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const duration = (ms: number) => {
	const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
	return h ? `${h}h${String(m).padStart(2, "0")}m` : m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const tokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function arcThinExtension(pi: ExtensionAPI) {
	const control = process.env.ARC_THIN_VARIANT === "control";
	// Diagnostic smoke suites can request the legacy all-tools surface so they
	// can exercise low-frequency tools in scripted ordinary turns. Real runs
	// default to the phase-specific surface below.
	const expandedDecisionTools = process.env.ARC_THIN_EXPANDED_TOOLS === "enabled";
	// The ledger and the critic are services to the agent's self-harness and run by default in the treatment
	// variant. ARC_HARNESS_LEDGER / ARC_HARNESS_CRITIC = "disabled" turns one off; the critic needs the ledger.
	const criticOn = !control && process.env.ARC_HARNESS_CRITIC !== "disabled";
	const ledgerOn = !control && (process.env.ARC_HARNESS_LEDGER !== "disabled" || criticOn);
	const game = process.env.ARC_GAME ?? "unknown";
	// Comparison variable, off unless the run asks for it (the runner records it in run-config.json).
	const carryChars = control ? 0 : Math.max(0, Math.floor(Number(process.env.ARC_THIN_CARRY_REASONING) || 0));
	// ARC_THIN_CONTINUITY=session keeps the agent's earlier decisions in Pi's session in front of the model (their text,
	// tool calls and results, without reasoning), up to ARC_THIN_CONTINUITY_DECISIONS of them; "rebuild" (the default
	// since 2026-10-08) shows only the rebuilt working set. docs/reports/2026-10-12-memory-mechanism-review.md.
	const continuity = process.env.ARC_THIN_CONTINUITY === "session" ? "session" : "rebuild";
	const continuityDecisions = Math.max(1, Math.floor(Number(process.env.ARC_THIN_CONTINUITY_DECISIONS) || 8));
	const storeDir = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "harness");
	mkdirSync(storeDir, { recursive: true });

	// ---------------------------------------------------------------- stores

	const memory = emptyMemory();
	const skills = new Map<string, Skill>();
	const skillVersions = new Map<string, number>();
	let overlay = "";
	let trajectory: ActionRow[] = [];
	let decision = 0;
	let systemChars = 0;
	/** grids.get(n) is the grid after action n (0 = before the first action); persisted in states.jsonl. */
	const grids = new Map<number, number[][]>();
	const changeCache = new Map<number, CellChange[] | null>();
	/** Action count at the latest consolidation turn. */
	let reviewedThrough = 0;
	/** The agent's model skills replayed on recorded transitions (model_checks.jsonl). */
	let modelChecks: ModelCheck[] = [];
	/** Values skills returned under "artifacts" (artifacts.jsonl); see arc_thin_artifacts.ts. */
	let artifactLog: ArtifactRecord[] = [];
	/** Results of the agent's hypothesis checks on recorded transitions (claim_checks.jsonl); see arc_thin_claims.ts. */
	let claimRows: ClaimRow[] = [];
	/** "key@version" → why that check could not be used (it is not run again). */
	const claimCompileErrors = new Map<string, string>();
	/** Transitions whose grids are not available: never checked, so not asked for again. */
	const claimGridsMissing = new Set<number>();
	/** Memory keys written, with the action count at the time: the critic's notes are followed up by key. */
	let memoryTouches: Array<{ key: string; at: number }> = [];
	/** Wall-clock time of each action (actionTimes[n-1] for action n) and the previous decision's cost, for RESOURCES. */
	let actionTimes: number[] = [];
	let lastDecisionCost: { ms: number; output: number; reasoning: number } | undefined;
	const deadlineMs = Number(process.env.ARC_RUN_DEADLINE_MS) || 0;

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
		memoryTouches = [];
		for (const row of readRows("memory.jsonl")) {
			applyRow(memory, row);
			if (row.at !== undefined && row.key) memoryTouches.push({ key: String(row.key), at: Number(row.at) || 0 });
		}
		skills.clear();
		skillVersions.clear();
		for (const row of readRows("skills.jsonl")) {
			skillVersions.set(row.name, Math.max(skillVersions.get(row.name) ?? 0, Number(row.version) || 0));
			if (row.deleted) skills.delete(row.name);
			else skills.set(row.name, { version: row.version, description: row.description ?? "", source: row.source,
				...(row.saved_at !== undefined ? { saved_at: Number(row.saved_at) } : {}),
				...(row.saved_level !== undefined ? { saved_level: Number(row.saved_level) } : {}),
				...(row.observe === false ? { observe: false } : {}) });
		}
		modelChecks = readRows("model_checks.jsonl");
		artifactLog = readRows("artifacts.jsonl");
		claimRows = [];
		claimCompileErrors.clear();
		for (const row of readRows("claim_checks.jsonl")) {
			if (row.compile_error) claimCompileErrors.set(`${row.key}@${row.version}`, String(row.compile_error));
			else if (row.key && row.version && Number.isInteger(row.n)) claimRows.push(row as ClaimRow);
		}
		overlay = readRows("prompt.jsonl").at(-1)?.text ?? "";
		trajectory = readRows("trajectory.jsonl");
		actionTimes = trajectory.map((row: any) => Date.parse(row.t) || 0);
		grids.clear();
		changeCache.clear();
		for (const row of readRows("states.jsonl")) if (Array.isArray(row.grid)) grids.set(Number(row.n), row.grid);
		const workingSets = readRows("working_set.jsonl");
		reviewedThrough = Math.max(0, ...workingSets.filter((row) => row.consolidating).map((row) => Number(row.actions) || 0));
		const decisions = [...trajectory, ...readRows("usage.jsonl"), ...workingSets].map((row) => Number(row.decision) || 0);
		decision = Math.max(0, ...decisions);
	}

	function appendUsage(kind: string, message: any): void {
		const usage = message?.usage ?? {};
		if (kind === "agent") { run.output += Number(usage.output) || 0; run.reasoningTokens += Number(usage.reasoning) || 0; }
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

	/** The current grid as lossless coordinate runs, without the adapter's derived layout views. */
	const renderState = (value: Record<string, any>) => renderArcLatestFrameRuns(value, { derived: false });

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

	const availableActions = (value: Record<string, any> | undefined): string[] => {
		const scope = value?.agent_available_actions ?? value?.available_actions;
		return Array.isArray(scope) ? [...new Set(scope.filter((name): name is string => typeof name === "string" && name.length > 0))] : [];
	};

	function actionLabel(row: { action: string; x?: number; y?: number }): string {
		return row.x !== undefined && row.y !== undefined ? `${row.action}(${row.x},${row.y})` : row.action;
	}

	/** What the environment reported for an action. No frame comparison: that is a tool the agent writes. */
	function actionLine(row: ActionRow): string {
		const budget = row.budget ?? {};
		const resets = trajectory.filter((item) => item.n <= row.n && item.action === "RESET").length;
		return `#${row.n} ${actionLabel(row)} → level_changed=${row.level_changed} ` +
			`state=${row.state} levels=${row.levels_completed} ` +
			`budget=${budget.used ?? "?"}/${budget.maximum ?? "∞"} (total ${budget.total_used ?? "?"}/${budget.total_maximum ?? "∞"})` +
			(resets ? ` resets=${resets}` : "");
	}

	// ---------------------------------------------------------------- per-decision state

	type Run = {
		consolidating: boolean; forceAction: boolean; assistantMessages: number; toolCalls: number; arcSeenInMessage: number;
		endBatchAt: number; actionDone: boolean;
		memoryCommitted: boolean; skillCalls: number; skillSignatures: Set<string>;
		/** Results of tools that shared the message with arc_action: the agent never sees them in this decision. */
		batchResults: string[];
		/** Consolidation only: the action count at the previous consolidation. */
		reviewFrom: number;
		/** Reasoning (or, without it, text) of this decision's assistant messages, in order. */
		reasoning: string[];
		/** For RESOURCES at the next decision: when this one started and the tokens its replies used. */
		startedAt: number; endedAt: number; output: number; reasoningTokens: number;
		workingSet?: { text: string; image?: { type: "image"; data: string; mimeType: string } };
	};
	const freshRun = (): Run => ({
		consolidating: false, forceAction: false, assistantMessages: 0, toolCalls: 0, arcSeenInMessage: -1, endBatchAt: -1, actionDone: false,
		memoryCommitted: false, skillCalls: 0, skillSignatures: new Set(), batchResults: [], reviewFrom: 0, reasoning: [],
		startedAt: Date.now(), endedAt: 0, output: 0, reasoningTokens: 0,
	});
	let run = freshRun();
	/** Batched results carried into the next decision's working set (shown once). */
	let carriedResults: string[] = [];
	const CARRIED_RESULT_CHARS = 400;
	/** ARC_THIN_CARRY_REASONING: the end of the previous decision's reasoning, shown for one decision. */
	let carriedReasoning = "";

	/** Skills and the overlay, as strategies reference them (uses: "skill:<name>", "prompt"), and each check's record. */
	const components = (): ComponentContext => ({
		skills: Object.fromEntries([...skills].map(([name, skill]) => [name, skill.version])), overlay, checks: claimLines(),
	});
	const memoryText = () => {
		const full = renderMemory(memory, trajectory.length, trajectory.map(actionLabel), components());
		// Keep hypothesis/strategy/revision reasoning intact; bound only the old
		// fact prose that otherwise grows without affecting the live rivals.
		const marker = "MEMORY (";
		const index = full.indexOf(marker);
		if (index < 0) return full;
		const head = full.slice(0, index).trimEnd();
		return `${head}\n\n${renderFactsCompact(memory)}`;
	};

	const currentLevel = () => Number(observation?.levels_completed ?? trajectory.at(-1)?.levels_completed ?? 0) || 0;
	/** A skill written before the level changed may encode the earlier board; said once per line, not judged. */
	const levelFlag = (skill: Skill) => skill.saved_level !== undefined && skill.saved_level !== currentLevel()
		? ` [written on level ${skill.saved_level + 1}; now level ${currentLevel() + 1}]` : "";

	function skillsText(): string {
		if (skills.size === 0)
			return `SKILLS: none saved (run_skill becomes available once a skill is saved with skill(op="set")).`;
		const usedBy = (name: string) => [...memory.strategies].filter(([, s]) => s.uses.includes(`skill:${name}`))
			.map(([key, s]) => `${key} (${s.status})`);
		return [`SKILLS (${skills.size}):`,
			...[...skills].map(([name, skill]) => {
				const score = skillScore(name, skill.version);
				return `- ${name} v${skill.version} — ${skill.description || "(no description)"}${levelFlag(skill)}` +
					(skill.observe === false ? " [not run automatically]" : "") +
					(usedBy(name).length ? ` [used by ${usedBy(name).join(", ")}]` : "") +
					(score.scored ? ` [as predictor: ${score.hits}/${score.scored} fields right]` : "");
			})].join("\n");
	}

	/** How the predictions made with one action scored (the agent's own, and the skill it named). */
	function predictionClause(row: ActionRow): string {
		const skill = row.skill_prediction;
		return (row.prediction ? ` | predicted: ${renderScore(row.prediction)}` : "") +
			(skill ? ` | ${skill.name}${skill.version ? ` v${skill.version}` : ""} predicted: ` +
				(skill.fields ? renderScore(skill as ScoredPrediction) : `nothing (${skill.error})`) : "");
	}

	/** One action as shown on later decisions: the facts, the agent's note, and how its predictions scored. */
	const recentLine = (row: ActionRow) => actionLine(row) + (row.note ? ` | note: ${row.note}` : "") + predictionClause(row);

	function recentText(): string {
		if (trajectory.length === 0) return "RECENT ACTIONS: none yet.";
		// A consolidation turn reviews every action since the previous one, not only the last few.
		if (run.consolidating) {
			const rows = trajectory.slice(run.reviewFrom).slice(-REVIEW_ACTIONS);
			return [`ACTIONS SINCE YOUR LAST REVIEW (#${rows[0]?.n ?? trajectory.length}–#${trajectory.length}, ${rows.length} of ${trajectory.length}):`,
				...rows.map(recentLine)].join("\n");
		}
		const recent = trajectory.slice(-RECENT_ACTIONS);
		return [`RECENT ACTIONS (last ${recent.length} of ${trajectory.length}):`, ...recent.map(recentLine)].join("\n");
	}

	/**
	 * A scored miss is a factual counterexample to the supplied prediction.  Keep
	 * the adapter's role mechanical: report the fields and observed values, but
	 * leave the meaning, hypothesis update, and any component investment to the
	 * gameplay agent.  This short section makes the broken transition visible at
	 * the next decision instead of burying it in a long recent-action line.
	 */
	function predictionChallengeText(): string {
		// Only for the action just taken. Showing the last miss until the next one kept calling a
		// counterexample "unresolved" for four decisions after the agent had revised its plan and
		// predicted correctly twice (P048 #4, shown at decisions 5-8); the MISS stays in RECENT ACTIONS.
		const row = trajectory.at(-1);
		const missed = row && ((row.prediction?.fields ?? []).some((field) => field.hit === false) || (row.skill_prediction?.misses ?? 0) > 0);
		if (!row || !missed) return "";
		const direct = (row.prediction?.fields ?? [])
			.filter((field) => field.hit === false)
			.map((field) => `${field.field}: expected ${field.expected}, observed ${field.observed ?? "(unavailable)"}`);
		const skill = row.skill_prediction && row.skill_prediction.misses > 0
			? [`predictor ${row.skill_prediction.name} v${row.skill_prediction.version ?? "?"}: ${row.skill_prediction.misses} field(s) missed`]
			: [];
		return [
			`PREDICTION CHALLENGE (mechanical counterexample from action #${row.n}; this does not decide the goal):`,
			...direct.concat(skill).map((line) => `- ${line}`),
			"Treat this as unresolved evidence before repeating the same explanation.",
		].join("\n");
	}

	/**
	 * Time and tokens next to the action budget. Only actions were visible as a cost: in tu93 (2026-10-11) the agent
	 * reasoned "tool calls in my turn are free", did route searches by hand at ~20k reasoning tokens a decision, and
	 * the 2 h deadline ended the run with 119 actions unused. Facts only; what to do about them is the agent's call.
	 */
	function resourcesText(): string {
		const parts: string[] = [];
		const left = deadlineMs ? Math.max(0, deadlineMs - Date.now()) : undefined;
		if (left !== undefined) parts.push(`${duration(left)} of run time left`);
		if (lastDecisionCost) parts.push(`your last turn took ${duration(lastDecisionCost.ms)} and ${tokens(lastDecisionCost.output)} output tokens` +
			(lastDecisionCost.reasoning ? ` (${tokens(lastDecisionCost.reasoning)} of them reasoning)` : ""));
		const times = actionTimes.slice(-6).filter((t) => t > 0);
		if (times.length >= 3) {
			const pace = (times.at(-1)! - times[0]) / (times.length - 1);
			parts.push(`the last ${times.length - 1} actions took ${duration(pace)} each` +
				(left !== undefined && pace > 0 ? `, so about ${Math.floor(left / pace)} more fit in the time left at that pace` : ""));
		}
		return parts.length ? `RESOURCES: ${parts.join("; ")}. Reasoning and tool calls cost time, not actions.` : "";
	}

	function buildWorkingSet(ctx: ExtensionContext): Run["workingSet"] {
		const sections: Array<[string, string]> = control ? [["recent", recentText()]]
			: [["memory", memoryText()], ["skills", skillsText()], ["recent", recentText()]];
		if (!control) {
			const skillOutputs = latestSkillOutputsText();
			if (skillOutputs) sections.splice(2, 0, ["skill_outputs", skillOutputs]);
			const models = modelChecksText();
			if (models) sections.splice(skillOutputs ? 3 : 2, 0, ["models", models]);
			const artifacts = renderArtifacts(artifactLog, { n: trajectory.length, level: currentLevel(), skills });
			if (artifacts) sections.splice(2 + (skillOutputs ? 1 : 0) + (models ? 1 : 0), 0, ["artifacts", artifacts]);
			const explore = explorationText();
			if (explore) sections.push(["explore", explore]);
		}
		const resources = control ? "" : resourcesText();
		if (resources) sections.push(["resources", resources]);
		if (carriedReasoning)
			sections.push(["reasoning", `YOUR REASONING AT THE PREVIOUS DECISION (its last ${carryChars} characters; it is not kept after ` +
				`this decision, so save what must last with memory):\n${carriedReasoning}`]);
		// With session continuity those results are already in the shown history.
		if (carriedResults.length && continuity !== "session")
			sections.push(["carried", ["RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION:", ...carriedResults.map((line) => `- ${line}`)].join("\n")]);
		const challenge = predictionChallengeText();
		if (challenge) sections.push(["challenge", challenge]);
		if (ledgerText) sections.push(["ledger", ledgerText]);
		if (criticText) sections.push(["critic", criticText]);
		const stateText = observation
			? `CURRENT STATE\n${renderState(observation)}`
			: "CURRENT STATE: unavailable — do not act on remembered grids.";
		let image: { type: "image"; data: string; mimeType: string } | undefined;
		if (observation && ctx.model?.input?.includes("image")) {
			try { image = renderArcFrameImage(observation).content; }
			catch (error) { logError("context:image", error); }
		}
		// What the agent was given this decision, for auditing what later reasoning restates or ignores.
		// The grid is in states.jsonl, so only its size and hash are logged here.
		const body = sections.map(([, value]) => value).join("\n\n");
		try {
			append("working_set.jsonl", {
				decision, consolidating: run.consolidating, actions: trajectory.length,
				sections: Object.fromEntries([...sections, ["state", stateText] as [string, string]].map(([name, value]) => [name, value.length])),
				state_sha256: createHash("sha256").update(stateText).digest("hex").slice(0, 16), text: body,
			});
		} catch (error) { logError("context:working_set", error); }
		return { text: `${body}\n\n${stateText}`, image };
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
		skillProgram ??= arcSkillGuestProgram(SKILL_LIMITS);
		try {
			return (await evaluateTaskPython(skillProgram, {
				...input, _foundation: arcSkillFoundation.version,
			}, signal)).value as GuestResult;
		} catch (error) {
			if (!(error instanceof TaskPythonError)) throw error;
			if (error.code === "environment_unavailable" || error.code === "version_conflict") throw error;
			return { ok: false, error: `${error.code}: ${error.message}`.slice(0, 600) };
		}
	}

	/** Syntax-check and save one skill version. */
	async function saveSkill(name: string, description: string, source: string,
		signal?: AbortSignal, observe?: boolean): Promise<{ ok: true; version: number } | { ok: false; reason: string }> {
		if (!/\bdef\s+run\s*\(/.test(source)) return { ok: false, reason: "source must define run(state, args)" };
		if (!skills.has(name) && skills.size >= MAX_SKILLS)
			return { ok: false, reason: `skill limit (${MAX_SKILLS}) reached; delete a skill first` };
		const check = await runGuest({ mode: "check", source }, signal);
		if (!check.ok) return { ok: false, reason: guestFailure(check) };
		const version = (skillVersions.get(name) ?? 0) + 1;
		// Whether it runs after every action carries over from the previous version unless the save says otherwise.
		const keepObserve = observe ?? skills.get(name)?.observe;
		const skill: Skill = { version, description, source, saved_at: trajectory.length, saved_level: currentLevel(),
			...(keepObserve === false ? { observe: false } : {}) };
		skillVersions.set(name, version);
		skills.set(name, skill);
		append("skills.jsonl", { name, ...skill });
		refreshSkillSurface();
		return { ok: true, version };
	}

	/** A model skill predicts the result of a proposed action (the predictor convention), so it can be replayed. */
	const isModel = (skill: Skill) => /\bproposed_action\b/.test(skill.source);

	/**
	 * Replay one model version on the recorded transitions it has not been checked on, through `through`.
	 * One sandbox call; each case sees only what existed before its action (arc_thin_backtest.ts). Returns the new checks.
	 */
	async function checkModel(name: string, skill: Skill, through: number, signal?: AbortSignal): Promise<ModelCheck[]> {
		const done = Math.max(0, ...modelChecks.filter((c) => c.name === name && c.version === skill.version).map((c) => c.n));
		const cases = backtestCases(trajectory, grids, done, through, availableActions(observation));
		if (!cases.length) return [];
		const history = buildHistory(trajectory.slice(0, through), grids, changeCache);
		const result = await runGuest({ mode: "backtest", source: skill.source, history, cases,
			artifact_history: artifactHistory(artifactLog.filter((record) => record.n < through)) }, signal);
		if (!result.ok) {
			append("model_checks.jsonl", { name, version: skill.version, failed: true, error: guestFailure(result).slice(0, 300), through });
			return [];
		}
		const checks = scoreBacktest(name, skill.version, (result.value as GuestCaseResult[]) ?? [], trajectory, grids, skill.saved_at ?? 0);
		for (const check of checks) { modelChecks.push(check); append("model_checks.jsonl", check); }
		return checks;
	}

	/** Bring every current model up to the latest transition (incremental: only transitions not checked yet). */
	async function refreshModelChecks(): Promise<void> {
		for (const [name, skill] of skills) if (isModel(skill)) {
			try { await checkModel(name, skill, trajectory.length); } catch (error) { logError("model:check", error); }
		}
	}

	// ---------------------------------------------------------------- claims (arc_thin_claims.ts)

	/** The current hypotheses that carry a check, with the version their results are kept under. */
	const claimChecks = () => [...memory.hypotheses].filter(([, h]) => h.check)
		.map(([key, h]) => ({ key, source: h.check!, version: claimVersion(h.check!) }));

	/**
	 * Run the checks of `keys` (default: every hypothesis with a check) on the recorded transitions they have no result
	 * for yet. One sandbox call per batch of grids; a check that does not compile is recorded once and skipped.
	 */
	async function refreshClaimChecks(keys?: string[], signal?: AbortSignal): Promise<void> {
		const claims = claimChecks().filter((claim) => !keys || keys.includes(claim.key))
			.filter((claim) => !claimCompileErrors.has(`${claim.key}@${claim.version}`));
		if (!claims.length || !trajectory.length) return;
		const done = new Set(claimRows.map((row) => `${row.key}@${row.version}#${row.n}`));
		const wanted = new Set<number>();
		for (const claim of claims) for (const row of trajectory)
			if (!done.has(`${claim.key}@${claim.version}#${row.n}`) && !claimGridsMissing.has(row.n)) wanted.add(row.n);
		if (!wanted.size) return;
		const { batches, missing } = claimSegments([...wanted], grids);
		for (const n of missing) claimGridsMissing.add(n);
		if (missing.length) logError("claims:grids", new Error(`no grids for transitions ${missing.slice(0, 8).join(", ")}`));
		const meta = Object.fromEntries(trajectory.map((row) => [String(row.n), {
			action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
			level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed,
		}]));
		const byN = new Map(trajectory.map((row) => [row.n, row]));
		for (const segments of batches) {
			const ns = new Set(segments.flatMap((segment) => segment.steps.map((step) => step.n)));
			const result = await runGuest({
				mode: "claims", claims: claims.map(({ key, source }) => ({ key, source })), segments,
				transitions: Object.fromEntries([...ns].map((n) => [String(n), meta[String(n)]])),
			}, signal);
			if (!result.ok) { logError("claims:run", new Error(guestFailure(result))); return; }
			const value = result.value as Record<string, { results: Array<[number, ClaimValue, string?]>; error: string | null }>;
			for (const claim of claims) {
				const out = value[claim.key];
				if (!out) continue;
				if (out.error) {
					claimCompileErrors.set(`${claim.key}@${claim.version}`, out.error);
					append("claim_checks.jsonl", { key: claim.key, version: claim.version, compile_error: out.error });
					continue;
				}
				for (const [n, verdict, error] of out.results) {
					if (done.has(`${claim.key}@${claim.version}#${n}`)) continue;
					const row: ClaimRow = { key: claim.key, version: claim.version, n, level: levelOf(byN.get(n)!), result: verdict,
						...(error ? { error } : {}) };
					claimRows.push(row);
					done.add(`${claim.key}@${claim.version}#${n}`);
					append("claim_checks.jsonl", row);
				}
			}
		}
	}

	/** The rendered check line per hypothesis key, for the memory view and receipts. */
	function claimLines(): Record<string, string> {
		const level = currentLevel();
		return Object.fromEntries(claimChecks().map(({ key, version }) => {
			const compileError = claimCompileErrors.get(`${key}@${version}`);
			const rows = claimRows.filter((row) => row.key === key && row.version === version);
			return [key, renderClaimSummary(rows.length ? summarizeClaim(rows, level) : undefined, compileError)];
		}));
	}

	const explorationText = () => explorationLine(trajectory, grids, trajectory.length, availableActions(observation));

	function modelChecksText(): string {
		const lines = [...skills].filter(([, skill]) => isModel(skill)).map(([name, skill]) => renderBacktest(name, skill.version,
			modelChecks.filter((check) => check.name === name && check.version === skill.version)));
		return lines.length ? `YOUR MODELS ON RECORDED MOVES (each move replayed with only what existed before it):\n${lines.join("\n")}` : "";
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
	const observeProgram = arcSkillGuestProgram(OBSERVE_LIMITS);
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

	/** Every state the agent sees is kept: skills read it as state.history, and the ledger reads it when enabled. */
	function recordState(n: number, grid: number[][] | undefined): void {
		if (!grid || grids.has(n)) return;
		grids.set(n, grid);
		append("states.jsonl", { n, grid });
	}

	/** Levels completed at state n (0 = before the first action). */
	const levelAt = (n: number) => n >= trajectory.length ? currentLevel() : n >= 1 ? trajectory[n - 1]?.levels_completed ?? 0 : 0;

	/**
	 * Keep what a skill run returned under "artifacts" and give back the result as shown: the artifacts replaced by
	 * their names, and any that could not be stored reported as warnings.
	 */
	function keepArtifacts(result: GuestResult, at: { n: number; level: number; skill: string; version: number }): GuestResult {
		if (!result.ok) return result;
		const split = splitArtifacts(result.value);
		if (split.shown === result.value) return result;
		const { records, errors } = newArtifactRecords(artifactLog, split.artifacts, at);
		for (const record of records) { artifactLog.push(record); append("artifacts.jsonl", record); }
		const problems = [...split.errors, ...errors];
		return { ...result, value: split.shown, ...(problems.length ? { warnings: [...(result.warnings ?? []), ...problems] } : {}) };
	}

	/** Run one saved skill with args={} on one state. A version that never succeeds is skipped after 3 errors. */
	async function observeOne(n: number, name: string, skill: Skill, state: Record<string, unknown>): Promise<void> {
		const key = observeKey(name, skill.version);
		const stats = observeStats.get(key) ?? { ok: 0, error: 0 };
		if (stats.ok === 0 && stats.error >= 3) return;
		// A predictor reads state["proposed_action"], which exists only when an action names it: it is not an observer.
		if (/\bproposed_action\b/.test(skill.source)) return;
		// The agent turned automatic runs off for this skill (observe=false); run_skill and python still call it.
		if (skill.observe === false) return;
		if (observations.some((row) => row.n === n && row.skill === name && row.version === skill.version)) return;
		let row: Observation;
		try {
			// Artifacts are read when the run starts, so a skill sees what the skills observed before it produced.
			const result = (await pool.evaluate(observeProgram, {
				mode: "run", source: skill.source, state: { ...state, ...artifactInputs(artifactLog, n) }, args: {},
				_foundation: arcSkillFoundation.version,
			})).value as GuestResult;
			row = observationFromResult(n, name, skill.version, keepArtifacts(result, { n, level: levelAt(n), skill: name, version: skill.version }));
		} catch (error) { row = { n, skill: name, version: skill.version, ok: false, error: errorText(error).slice(0, 200) }; }
		appendObservation(row, stats, key);
	}

	/** Convert a guest result into the durable ledger shape without allowing an
	 * exotic result to break the parent turn. */
	function observationFromResult(n: number, name: string, version: number, result: GuestResult): Observation {
		if (!result.ok) return { n, skill: name, version, ok: false, error: guestFailure(result).slice(0, 200) };
		let size = Number.POSITIVE_INFINITY;
		try { size = JSON.stringify(result.value ?? null)?.length ?? 0; } catch { /* leaves() gives a bounded fallback below. */ }
		return {
			n, skill: name, version, ok: true,
			value: size <= 4000 ? result.value : leaves(result.value),
			...(result.warnings?.length ? { warnings: result.warnings.slice(0, 4) } : {}),
		};
	}

	function appendObservation(row: Observation, stats = observeStats.get(observeKey(row.skill, row.version)) ?? { ok: 0, error: 0 }, key = observeKey(row.skill, row.version)): void {
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
		// Automatic observation is normally lightweight. A self-authored skill that
		// explicitly uses the foundation history API needs that input to be
		// meaningful; omitting it turns a valid history tool into a repeated
		// KeyError (P058). Reuse one bounded snapshot for all such skills.
		const historyState = current.some(([, skill]) => /\bhistory\b/.test(skill.source))
			? skillState(false, true) : state;
		enqueueObservation(async () => {
			for (const [name, skill] of current)
				await observeOne(n, name, skill, /\bhistory\b/.test(skill.source) ? historyState : state);
		});
	}

	/**
	 * The ledger already runs each saved skill, with args={}, on every state the agent sees. Showing that
	 * result makes a skill standing perception: what it computes about the current state is in front of
	 * the agent at every decision, with no run_skill message (which re-reads the whole context) and no
	 * recalculation by hand. The value is the skill's own output, clipped by size only; the project adds
	 * no analysis. A failure is shown as the feedback it is. run_skill remains for other arguments.
	 */
	function latestSkillOutputsText(): string {
		if (!skills.size || !observations.length) return "";
		const lines: string[] = [];
		let room = SKILL_OUTPUTS_CHARS;
		for (const [name, skill] of skills) {
			if (skill.observe === false) continue;
			// Backfill appends older states after the immediate save receipt. Select
			// by state number, rather than append order, so a late historical result
			// cannot make the current standing perception look stale.
			const matching = observations.filter(row => row.skill === name && row.version === skill.version);
			const latest = matching.reduce<Observation | undefined>((best, row) =>
				!best || row.n > best.n ? row : best, undefined);
			if (!latest) continue;
			// The observer may still be running: say which state the result belongs to when it is not the current one.
			const behind = trajectory.length - latest.n;
			const where = (behind > 0 ? ` (from the state ${behind} action(s) ago; not yet rerun)` : "") + levelFlag(skill);
			if (!latest.ok) {
				const stats = observeStats.get(observeKey(name, skill.version));
				const stopped = stats && stats.ok === 0 && stats.error >= 3 ? " (no longer run automatically after 3 failures)" : "";
				lines.push(`- ${name} v${skill.version}${levelFlag(skill)}: FAILED with args={}${stopped}: ${latest.error ?? "unknown error"}`);
				continue;
			}
			const value = JSON.stringify(latest.value ?? null);
			const previous = matching.filter(row => row.n < latest.n).reduce<Observation | undefined>((best, row) =>
				!best || row.n > best.n ? row : best, undefined);
			const unchanged = previous?.ok && JSON.stringify(previous.value ?? null) === value;
			if (unchanged) {
				lines.push(`- ${name} v${skill.version}${where}: unchanged from the prior state (${value.length} chars; run_skill returns the full result)`);
				continue;
			}
			const shown = value.length > Math.min(SKILL_OUTPUT_CHARS, room)
				? `${value.slice(0, Math.max(0, Math.min(SKILL_OUTPUT_CHARS, room) - 1))}… (${value.length} chars; run_skill returns all of it)` : value;
			room = Math.max(120, room - shown.length);
			lines.push(`- ${name} v${skill.version}${where}: ${shown}`);
		}
		return lines.length ? `YOUR SKILLS ON THE CURRENT STATE (each run with args={} after your last action):\n${lines.join("\n")}` : "";
	}

	function goalHypothesisRefs(): GoalHypothesisRef[] {
		return [...memory.hypotheses].filter(([key, hypothesis]) => isGoalHypothesis(key, hypothesis.question))
			.map(([key, hypothesis]) => ({ key, evidence: hypothesis.evidence.map(item => ({ action: item.action })) }));
	}

	/** Replay a newly saved skill on earlier states (memory is the current memory). */
	function backfillSkill(name: string, skill: Skill): void {
		const ns = [...grids.keys()].sort((a, b) => a - b).slice(-OBSERVE_BACKFILL);
		const usesHistory = /\bhistory\b/.test(skill.source);
		enqueueObservation(async () => {
			for (const n of ns) {
				const grid = grids.get(n);
				if (!grid) continue;
				const row = trajectory[n - 1];
				const state: Record<string, unknown> = {
					grid, prev_grid: grids.get(n - 1) ?? null, state: row?.state ?? null, levels_completed: row?.levels_completed ?? 0,
					available_actions: availableActions(observation), action_budget: row?.budget ?? null,
					recent_actions: trajectory.slice(Math.max(0, n - RECENT_ACTIONS), n).map(reportedAction), ...memoryForSkills(memory),
				};
				// A history Skill is valid at save time as well as on later states.
				// Backfill used to omit the foundation API and create a false
				// KeyError receipt before observeState could supply it on the next turn.
				if (usesHistory) state.history = buildHistory(trajectory, grids, changeCache);
				await observeOne(n, name, skill, state);
			}
		});
	}

	/**
	 * The critic is a service to the agent's self-harness, not part of the agent's interface: its dossier keeps
	 * the frame facts and the adapter's derived views it was designed with (plan §10.9).
	 */
	const decisionLine = (row: ActionRow) => actionLine(row).replace(" → ", ` → changed_cells=${row.changed_cells ?? "?"} `)
		+ (row.idea ? ` | idea: ${row.idea}` : "")
		+ (row.expect ? ` | expect: ${row.expect}` : "") + (row.note ? ` | note: ${row.note}` : "") + predictionClause(row);

	/** The critic's view of the current state: the adapter's derived layout views, without the full coordinate runs. */
	const criticStateText = () => observation ? renderArcLatestFrameRuns(observation).split(/\nLossless coordinate runs/)[0] : "(unavailable)";

	/** Did the agent write any of these memory keys after action `from`, up to action `to`? */
	const touchedKeys = (keys: string[], from: number, to: number) => {
		const wanted = new Set(keys.map((key) => key.toLowerCase()));
		return memoryTouches.some((touch) => touch.at >= from && touch.at <= to && wanted.has(touch.key.toLowerCase()));
	};

	/**
	 * One side call to the agent's own model (critic, analyst). Pi 0.87's registry stream resolves the configured
	 * provider and its authentication, including providers registered by extensions (the scripted smoke provider);
	 * pi-ai/compat's completeSimple, used until 2026-10-12, could not see those registrations.
	 */
	async function sideCall(ctx: ExtensionContext, systemPrompt: string, content: any[], options: { signal?: AbortSignal; maxTokens: number }): Promise<any> {
		const stream: any = ctx.modelRegistry.streamSimple(ctx.model!, {
			systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }],
		} as any, { signal: options.signal, maxTokens: options.maxTokens } as any);
		return await stream.result();
	}

	async function askCritic(ctx: ExtensionContext, dossier: string): Promise<{ reply: any; answer: string }> {
		// No reasoning for this short side call: with the parent's level passed on (round 5, "high"), every critic
		// call spent its whole output budget on reasoning and stopped at length with no text (4 of 4 in tu93).
		const reply: any = await sideCall(ctx, CRITIC_SYSTEM, [{ type: "text", text: dossier }],
			{ signal: AbortSignal.timeout(criticConfig.timeoutMs), maxTokens: criticConfig.maxOutputTokens });
		appendUsage("critic", reply);
		const answer = (reply.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");
		return { reply, answer };
	}

	async function runCritic(ctx: ExtensionContext | undefined, state: LedgerState, triggers: string[], previous: number): Promise<void> {
		if (!ctx?.model) return;
		const dossierFor = (recent: number, withState: boolean) => buildDossier({
			state, triggers, memoryText: memoryText(),
			skills: [...skills].map(([name, skill]) => `${name} v${skill.version} — ${skill.description || "(no description)"}`),
			notes: criticNotes, recentLines: trajectory.slice(-recent).map(decisionLine),
			currentState: withState ? criticStateText() : "(left out)", goalHypotheses: goalHypothesisRefs(),
		});
		let dossier = dossierFor(10, true);
		let { reply, answer } = await askCritic(ctx, dossier);
		let attempts = 1;
		const keys = [...memory.hypotheses.keys(), ...memory.strategies.keys()];
		let parsed = parseCriticReply(answer, trajectory.length, availableActions(observation), keys, criticNotes.flatMap((item) => item.lines));
		// A reply with nothing usable after a length stop or an empty answer is a failed delivery: one retry, shorter input.
		if (!parsed.lines.length && (reply.stopReason === "length" || !answer.trim())) {
			append("critic.jsonl", { kind: "retry", at: trajectory.length, stop_reason: reply.stopReason, answer_chars: answer.length, dossier_chars: dossier.length });
			dossier = dossierFor(5, false);
			({ reply, answer } = await askCritic(ctx, dossier));
			attempts = 2;
			parsed = parseCriticReply(answer, trajectory.length, availableActions(observation), keys, criticNotes.flatMap((item) => item.lines));
		}
		const current = state.experiments.at(-1);
		const note: CriticNote = {
			at: trajectory.length, level: trajectory.at(-1)?.levels_completed ?? 0, triggers, ...parsed,
			...(current?.labelled ? { idea_at: current.label } : {}),
			repeat_keys: state.repeats.filter((item) => item.n > previous).map((item) => item.key.split("|").slice(1).join("|")),
		};
		criticNotes.push(note);
		append("critic.jsonl", { kind: "note", ...note, stop_reason: reply.stopReason, attempts, delivered: note.lines.length > 0 || Boolean(note.suggest),
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
		// The state itself is recorded for every run (before_agent_start); observeOne skips states already observed.
		if (gridOf(observation)) observeState(trajectory.length, skillState(false, false));
		await Promise.race([observer, new Promise((resolve) => setTimeout(resolve, OBSERVE_WAIT_MS))]);
		const state = buildLedger(trajectory, observations, grids);
		const goalRefs = goalHypothesisRefs();
		ledgerText = renderLedgerView(state, [...memory.hypotheses.keys()], 900, goalRefs);
		if (!criticOn) return;
		const previous = criticCheckedThrough;
		const { triggers, suppressed } = criticTriggers(state, criticNotes, previous, memory.hypotheses.size, criticConfig, touchedKeys);
		if (suppressed.length) append("critic.jsonl", { kind: "suppressed", at: trajectory.length, triggers: suppressed });
		if (trajectory.length > previous) {
			criticCheckedThrough = trajectory.length;
			append("critic.jsonl", { kind: "check", through: trajectory.length });
		}
		if (triggers.length) startCritic(ctx, state, triggers, previous);
		// Triggers are failures, so the note is wanted now: wait for it (bounded) rather than show it decisions later.
		// With a 3 s grace, notes reached the agent 2-17 decisions after their trigger (2026-10-10/11 runs).
		if (criticInFlight) await Promise.race([criticInFlight, new Promise((resolve) => setTimeout(resolve, CRITIC_WAIT_MS))]);
		if (criticPending) {
			const note = criticPending;
			criticPending = undefined;
			criticShownDecision = decision;
			append("critic.jsonl", { kind: "shown", note_at: note.at, at: trajectory.length, decision });
			// When the review follows one that was not acted on, that fact comes first, in the runtime's words.
			const ignored = note.triggers.find((trigger) => trigger.startsWith(IGNORED_REVIEW));
			criticText = [`CRITIC (independent review at #${note.at}${note.at < trajectory.length ? `, ${trajectory.length - note.at} action(s) ago` : ""}, advisory):`,
				...(ignored ? [`- Note: ${ignored}.`] : []),
				...note.lines.map((line) => `- ${line}`),
				...(note.suggest ? [`suggest: ${note.suggest.x !== undefined ? `${note.suggest.action}(${note.suggest.x},${note.suggest.y})` : note.suggest.action}`] : [])].join("\n");
		} else if (criticNotes.length && criticShownDecision > 0 && decision - criticShownDecision <= 2)
			criticText = `CRITIC: last review at #${criticNotes.at(-1)!.at} (shown once).`;
	}

	/** What a skill receives as `state`. history is left out of the ledger's automatic observation runs. */
	function skillState(includeFrames: boolean, includeHistory = true): Record<string, unknown> {
		return {
			grid: gridOf(observation) ?? null,
			prev_grid: previousGrid ?? null,
			...(includeFrames ? { frames: observation?.frames ?? [] } : {}),
			state: observation?.state ?? null,
			levels_completed: observation?.levels_completed ?? null,
			available_actions: availableActions(observation),
			action_budget: observation?.action_budget ?? null,
			recent_actions: trajectory.slice(-RECENT_ACTIONS).map(reportedAction),
			...memoryForSkills(memory),
			...artifactInputs(artifactLog),
			// Frames can be large; leave them room in the sandbox input.
			...(includeHistory ? { history: buildHistory(trajectory, grids, changeCache, includeFrames ? 60_000 : undefined) } : {}),
		};
	}

	/** Fields of the current version of each skill that were scored as its prediction of an action. */
	function skillScore(name: string, version: number): { hits: number; scored: number } {
		let hits = 0, scored = 0;
		for (const row of trajectory) {
			const p = row.skill_prediction;
			if (p?.name !== name || p.version !== version) continue;
			hits += p.hits ?? 0;
			scored += (p.hits ?? 0) + (p.misses ?? 0);
		}
		return { hits, scored };
	}

	/**
	 * Ask a saved skill what the proposed action will do. The skill sees the usual
	 * state plus state["proposed_action"]; whatever prediction fields it returns
	 * are scored after the action. A failure is recorded and never delays or
	 * blocks the action beyond the observation time limit.
	 */
	async function predictWithSkill(name: string, proposed: Record<string, unknown>): Promise<{ row: SkillPrediction; prediction?: Prediction }> {
		const skill = skills.get(name);
		if (!skill) return { row: { name, error: "no such skill" } };
		const row = { name, version: skill.version };
		try {
			const result = (await pool.evaluate(observeProgram, {
				mode: "run", source: skill.source, state: { ...skillState(false), proposed_action: proposed }, args: {},
				_foundation: arcSkillFoundation.version,
			})).value as GuestResult;
			if (!result.ok) return { row: { ...row, error: guestFailure(result).slice(0, 200) } };
			const prediction = normalizePrediction(result.value);
			const checkable = prediction && (prediction.cells || prediction.level_changed !== undefined || prediction.state !== undefined);
			return checkable ? { row, prediction } : { row: { ...row, error: "returned no checkable field (cells, level_changed, state)" } };
		} catch (error) { return { row: { ...row, error: errorText(error).slice(0, 200) } }; }
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
				? { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for consolidation reached; the review ends`, terminate: true }
				: { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for this decision reached; submit arc_action in the next decision`, terminate: true };
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

	function registerArcAction(actions: string[]): void {
		const hasCoordinates = actions.includes("ACTION6");
		pi.registerTool({
			name: "arc_action",
			label: "ARC action",
			description: `Submit one available action and end this decision.${hasCoordinates ? " ACTION6 accepts x,y." : ""} ` +
				// Environment fact, checked in the bridge and the recorded runs: RESET is counted like any action.
				(actions.includes("RESET") ? "RESET returns the level to its starting grid and counts as one action against both budgets. " : "") +
				"Optional note, prediction and memory/idea updates are recorded for the next decision.",
			parameters: Type.Object({
				action: StringEnum(actions),
				...(hasCoordinates ? {
					x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
					y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
				} : {}),
				note: Type.Optional(Type.String({ maxLength: 300 })),
				// A malformed prediction is dropped before validation (repairActionArguments), never a reason to reject the action.
				...(control ? {} : {
					predict: Type.Optional(predictionSchema()),
					predict_skill: Type.Optional(Type.String({ maxLength: 40 })),
				}),
				// No length limits here: an over-long value is clipped, never a reason to reject the action.
				// What the move should do goes in predict (text and checked fields): one prediction surface, not two.
				...(ledgerOn ? {
					idea: Type.Optional(Type.String()),
				} : {}),
			}),
			prepareArguments: repairActionArguments,
			execute: guardTool("arc_action", async (params: {
				action: string; x?: number; y?: number; note?: string; idea?: unknown;
				predict?: Prediction; predict_skill?: string;
			}) => {
				if (!availableActions(observation).includes(params.action))
					throw new Refusal(`action '${params.action}' is not currently available`);
				const beforeGrid = gridOf(observation);
				const label = actionLabel(params);
				const payload: Record<string, unknown> = { action: params.action };
				if (params.x !== undefined && params.y !== undefined) { payload.x = params.x; payload.y = params.y; }
				const bySkill = !control && params.predict_skill ? await predictWithSkill(params.predict_skill, { ...payload }) : undefined;
				if (params.note) payload.reasoning = params.note;
				const idea = ledgerOn ? normIdea(params.idea) : "";
				// The ledger keeps the informal part of the prediction as the experiment's expectation.
				const expect = ledgerOn && !control && params.predict?.text ? params.predict.text : "";
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
				const afterGrid = gridOf(value);
				const row: ActionRow = {
					n: trajectory.length + 1, decision, action: params.action,
					...(params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : {}),
					...(params.note ? { note: params.note } : {}),
					...(idea ? { idea } : {}),
					...(expect ? { expect } : {}),
					// Evaluation only (never rendered for the agent): how much the frame changed, per the bridge.
					changed_cells: typeof delta.changed_cells === "number" ? delta.changed_cells : gridDiff(beforeGrid, afterGrid),
					...(delta.bbox ? { bbox: delta.bbox } : {}),
					level_changed: Boolean(value.public_transition?.level_changed),
					state: String(value.state ?? "UNKNOWN"),
					levels_completed: Number(value.levels_completed ?? 0),
					budget: value.action_budget ?? null,
				};
				// Check what the agent, or the skill it named, said this action would produce, against what came back.
				const outcome: Outcome = { before: beforeGrid, after: afterGrid, level_changed: row.level_changed, state: row.state };
				if (!control && params.predict) {
					row.predict = params.predict;
					// Text alone is kept, not checked: a score exists only when there was something to check.
					const score = scorePrediction(params.predict, outcome);
					if (score.fields.length) row.prediction = score;
				}
				if (bySkill) row.skill_prediction = { ...bySkill.row, ...(bySkill.prediction ? scorePrediction(bySkill.prediction, outcome) : {}) };
				trajectory.push(row);
				actionTimes.push(Date.now());
				append("trajectory.jsonl", row);
				recordState(row.n, afterGrid);
				refreshActionSurface();
				return text(`${actionLine(row)}${predictionClause(row)}`,
					{ ...reportedAction(row), prediction: row.prediction, skill_prediction: row.skill_prediction }, true);
			}),
		});
	}
	// No action vocabulary is invented before the environment has supplied its scope.
	registerArcAction([]);
	let boundActionScope = "[]";
	function refreshActionSurface(): void {
		const actions = availableActions(observation);
		const signature = JSON.stringify(actions);
		if (signature !== boundActionScope) {
			registerArcAction(actions);
			boundActionScope = signature;
		}
		if (!toolsReady) return;
		const active = pi.getActiveTools().filter(name => name !== "arc_action");
		if (actions.length && !run.consolidating) active.unshift("arc_action");
		pi.setActiveTools(active);
	}

	if (!control) {
		const text600 = Type.String({ minLength: 1, maxLength: 600 });
		const confidence = Type.Integer({ minimum: 1, maximum: 5 });
		const line = (maxLength: number, _description = "") => Type.String({ maxLength });
		pi.registerTool({
			name: "memory",
			label: "Memory",
			description: "Atomic facts/hypotheses/tests/strategies update. Invalid batches do not apply; evidence is appended.",
			parameters: Type.Object({
				op: Type.Optional(StringEnum(["set", "delete", "list", "update"] as const)),
				key: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
				text: Type.Optional(text600),
				confidence: Type.Optional(confidence),
				set: Type.Optional(Type.Union([Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 64 }), text: text600, confidence: Type.Optional(confidence),
					replaces: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 8, description: "keys this entry corrects; they are deleted" })),
				}), { maxItems: 12 }), Type.String({ maxLength: 12000, description: "JSON array accepted" })])),
				delete: Type.Optional(Type.Union([Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 40 }), Type.String({ maxLength: 3000, description: "JSON array or key accepted" })])),
				// A replacement batch may carry old entries plus deletes and new rivals.
				// planMemoryUpdate still enforces MAX_HYPOTHESES for the committed state;
				// this larger input bound avoids rejecting an atomic replace before the
				// deletes can be applied.
				hypotheses: Type.Optional(Type.Union([Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 48, description: "hyp.<name>" }),
					question: Type.Optional(line(40, "What it answers, e.g. \"controls\" or \"goal\". Hypotheses with the same question are rivals.")),
					claim: Type.Optional(line(300, "Claim.")),
					predicts: Type.Optional(line(300, "Test prediction.")),
					status: Type.Optional(StringEnum(STATUSES)),
					next_test: Type.Optional(line(300, "Cheapest separating action.")),
					check: Type.Optional(Type.String({ maxLength: 4000, description:
						"Optional Python: def check(t) -> True/False/None (holds/fails/does not apply) for one transition t " +
						"(t.n, t.action, t.x, t.y, t.before, t.after grids [y][x], t.level_changed, t.state, t.levels_completed). " +
						"Run on every recorded and later move; results are shown with the hypothesis. \"\" removes it." })),
					evidence: Type.Optional(Type.Object({
						action: Type.Optional(Type.Integer({ minimum: 1, description: "Test action number." })),
						condition: line(200, "Condition."),
						observed: line(300, "Observed result."),
						verdict: StringEnum(VERDICTS),
					}, { description: `Evidence appended.` })),
				}), { maxItems: MAX_HYPOTHESES * 2 }), Type.String({ maxLength: 24000, description: "JSON array accepted" })])),
				tests: Type.Optional(Type.Union([Type.Array(Type.Object({
					action: Type.Optional(Type.Integer({ minimum: 1, description: "Test action number." })),
					condition: line(200, "Condition."),
					observed: line(300, "Observed result."),
					verdicts: Type.Record(Type.String(), StringEnum(VERDICTS), {
						description: "One verdict per hypothesis this test bears on, e.g. {\"hyp.a\": \"refutes\", \"hyp.b\": \"inconclusive\"}.",
					}),
				}), { maxItems: 4 }), Type.String({ maxLength: 12000, description: "JSON array accepted" })])),
				strategies: Type.Optional(Type.Union([Type.Array(Type.Object({
					key: Type.String({ minLength: 1, maxLength: 48, description: "strat.<name>" }),
					plan: Type.Optional(line(300, "Plan.")),
					depends_on: Type.Optional(Type.Array(Type.String({ maxLength: 48 }), { maxItems: 4, description: "Premise keys." })),
					uses: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), {
						maxItems: 6, description: "Components it relies on: \"skill:<name>\", \"memory:<key>\", \"prompt\".",
					})),
					status: Type.Optional(StringEnum(STRATEGY_STATUSES, { description: "One active strategy." })),
					steps: Type.Optional(Type.Union([Type.Array(Type.String({ maxLength: 16 }), { maxItems: MAX_STEPS }), Type.String({ maxLength: 1200 })], {
						description: "Planned action sequence, e.g. [\"ACTION4\",\"ACTION4\",\"ACTION2\"]; the runtime shows how far your moves follow it. [] clears.",
					})),
				}), { maxItems: MAX_STRATEGIES }), Type.String({ maxLength: 12000, description: "JSON array accepted" })])),
			}),
			prepareArguments: repairMemoryArguments,
			execute: guardTool("memory", async (params: MemoryParams, signal) => {
				const plan = planMemoryUpdate(memory, params, trajectory.length, components());
				if (!plan.ok) throw new Refusal(plan.error);
				const checksBefore = new Map([...memory.hypotheses].map(([key, h]) => [key, h.check ? claimVersion(h.check) : ""]));
				for (const row of plan.rows) {
					append("memory.jsonl", { ...row, at: trajectory.length });
					memoryTouches.push({ key: row.key, at: trajectory.length });
				}
				applyRows(memory, plan.rows);
				// A committed update does not end the decision: the agent may still need its receipt before acting.
				// Ending the decision here (2026-10-11) turned 5 ordinary tu93 decisions into memory-only turns
				// although the reasoning planned the action next, each followed by a forced action-only decision.
				run.memoryCommitted = true;
				// A new or changed check is run over the whole recorded history now, so its record comes with the receipt.
				// A broken check is reported and never undoes the committed update.
				const changed = [...memory.hypotheses].filter(([key, h]) => h.check && claimVersion(h.check) !== checksBefore.get(key))
					.map(([key]) => key);
				let checkLines: string[] = [];
				if (changed.length) {
					try { await refreshClaimChecks(changed, signal); }
					catch (error) { logError("claims:save", error); }
					const lines = claimLines();
					checkLines = changed.map((key) => `${key} ${lines[key] ?? "check: not run yet"}`);
				}
				return text([plan.receipt, ...checkLines].join("\n"), undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "skill",
			label: "Skill",
			description: "Save/delete/get a Python skill run(state,args). state keys: grid (rows; grid[y][x]), prev_grid, state, levels_completed, " +
				"available_actions, action_budget, recent_actions, history, memory, hypotheses, strategies, artifacts, artifact_info " +
				"(a model also gets proposed_action). Return JSON data; {\"artifacts\": {name: value}} in the result keeps values for every skill. " +
				"ARC Skills may call arc.bbox/translate/normalize/neighbors/components on explicit [x,y] lists. run_skill executes it.",
			parameters: Type.Object({
				op: StringEnum(["set", "delete", "get"] as const),
				name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
				description: Type.Optional(Type.String({ maxLength: 200 })),
				source: Type.Optional(Type.String({ maxLength: 16384 })),
				observe: Type.Optional(Type.Boolean({ description: "Run it with args={} after every action and show the output (default true). " +
					"set with observe and no source changes only this." })),
			}),
			prepareArguments: repairSkillArguments,
			execute: guardTool("skill", async (params: { op: string; name: string; description?: string; source?: string; observe?: boolean }, signal) => {
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
				// Turning automatic runs on or off is a flag change on the current version, not a new version.
				if (!params.source && existing && typeof params.observe === "boolean") {
					if (params.observe) delete existing.observe; else existing.observe = false;
					append("skills.jsonl", { name: params.name, ...existing, observe: params.observe });
					return text(`skill ${params.name} v${existing.version}: ${params.observe ? "runs" : "no longer runs"} automatically after every action` +
						(params.observe ? "" : `; run_skill(name="${params.name}") and python still call it`), undefined, endsBatch());
				}
				if (!params.source) throw notSaved("source is required");
				const saved = await saveSkill(params.name, params.description ?? existing?.description ?? "", params.source, signal, params.observe);
				if (!saved.ok) throw saved.reason.startsWith("skill limit")
					? new Refusal(`${saved.reason}. Skills: ${names()}`) : notSaved(saved.reason);
				// Saving also tries the new version once on the current state with args={}.
				// This is feedback, never a second commit gate: infrastructure errors,
				// missing proposed_action and cancellation leave the saved version intact.
				let trial: GuestResult | undefined;
				let trialError: string | undefined;
				// Bind provenance before yielding: a batched arc_action may finish
				// while the guest is running. Completion time is not input state.
				const stateN = trajectory.length;
				const trialLevel = currentLevel();
				const trialState = skillState(false);
				const predictor = /\bproposed_action\b/.test(params.source);
				if (!predictor) {
					try { trial = await runGuest({ mode: "run", source: params.source, state: trialState, args: {} }, signal); }
					catch (error) { trialError = errorText(error).slice(0, 600); }
					if (trial?.ok) trial = keepArtifacts(trial, { n: stateN, level: trialLevel, skill: params.name, version: saved.version });
				}
				if (predictor) {
					append("skill_runs.jsonl", { decision, name: params.name, version: saved.version, automatic: "save", deferred: true, reason: "requires proposed_action" });
				} else if (trial) {
					append("skill_runs.jsonl", {
						decision, name: params.name, version: saved.version, automatic: "save", state_n: stateN, ok: trial.ok,
						...(trial.ok ? { result_chars: clipJson(trial.value, Number.MAX_SAFE_INTEGER).length, warnings: trial.warnings } : { error: guestFailure(trial) }),
					});
					// The automatic ledger observation and the save receipt share this
					// result. Backfill skips this exact version/state, avoiding duplicate
					// execution while retaining earlier states.
					if (ledgerOn) appendObservation(observationFromResult(stateN, params.name, saved.version, trial));
				} else if (trialError) {
					append("skill_runs.jsonl", { decision, name: params.name, version: saved.version, automatic: "save", state_n: stateN, deferred: true, error: trialError });
				}
				if (ledgerOn) backfillSkill(params.name, { version: saved.version, description: params.description ?? existing?.description ?? "", source: params.source });
				// A model (a skill that reads proposed_action) is replayed at once on the recorded moves.
				let modelText = "";
				if (predictor) {
					const model = skills.get(params.name);
					try {
						if (model) await checkModel(params.name, model, trajectory.length, signal);
						modelText = `\n${renderBacktest(params.name, saved.version, modelChecks.filter((check) => check.name === params.name && check.version === saved.version))}`;
					} catch (error) { modelText = `\nreplay on recorded moves failed: ${errorText(error).slice(0, 200)}`; }
				}
				const trialWhere = trajectory.length === stateN ? "the current state" : `input state ${stateN}`;
				const provenance = trajectory.length !== stateN ? `\nEvaluation used state ${stateN}; current state is ${trajectory.length}.` : "";
				const trialText = predictor ? modelText : trial
					? trial.ok
						? `\non ${trialWhere} with args={} it returns: ${clipJson(trial.value, SKILL_OUTPUT_CHARS)}${trial.warnings?.length ? ` (warning: ${trial.warnings.join("; ")})` : ""}`
						: `\non ${trialWhere} with args={} it fails: ${guestFailure(trial)}`
					: trialError ? `\ninitial run deferred: ${trialError}` : "";
				return text(`skill set ${params.name} v${saved.version} (syntax ok); run_skill(name="${params.name}") is callable ` +
					`from your next step${provenance}${trialText}`, undefined, endsBatch());
			}),
		});

		/**
		 * One-off computation: run code once and get the answer, with nothing to name or save. Computation had to go
		 * through creating a skill (2026-10-12 review: 28-38% of reasoning was coordinate work done by hand, and a route
		 * search was done "in my head" because a skill felt like a commitment). Saved skills remain callable from here.
		 */
		pi.registerTool({
			name: "python",
			label: "Python",
			description: "Run Python once (nothing is saved). Names available: state (same keys as a skill's state), history " +
				"(history.grid(n), history.transitions()), grid, prev_grid, artifacts, skill(name, **args) to call a saved skill. " +
				"Returns what you print and the value of a final expression. Standard library only; no files or network.",
			parameters: Type.Object({ code: Type.String({ minLength: 1, maxLength: 16384 }) }),
			prepareArguments: (args: any) => args && typeof args === "object" && typeof args.code === "string"
				? { ...args, code: unescapeSource(args.code) } : args,
			execute: guardTool("python", async (params: { code: string }, signal) => {
				const started = Date.now();
				const result = await runGuest({
					mode: "exec", code: params.code, state: skillState(false, true),
					skills: Object.fromEntries([...skills].map(([name, skill]) => [name, skill.source])),
				}, signal);
				if (!result.ok) {
					append("python_runs.jsonl", { decision, ok: false, ms: Date.now() - started, code_chars: params.code.length, error: guestFailure(result).slice(0, 300) });
					throw new Refusal(`python failed: ${guestFailure(result)}`);
				}
				const value = result.value as { stdout: string; value: unknown; has_value: boolean };
				const printed = value.stdout.length > SKILL_RESULT_CHARS
					? `${value.stdout.slice(0, SKILL_RESULT_CHARS)}\n…(output cut at ${SKILL_RESULT_CHARS} of ${value.stdout.length} chars)` : value.stdout;
				const shown = [printed.trimEnd(), value.has_value ? `→ ${clipJson(value.value, SKILL_RESULT_CHARS)}` : ""].filter(Boolean).join("\n");
				append("python_runs.jsonl", { decision, ok: true, ms: Date.now() - started, code_chars: params.code.length,
					stdout_chars: value.stdout.length, has_value: value.has_value });
				return text(shown || "(no output; print something or end with an expression)", undefined, endsBatch());
			}),
		});

		pi.registerTool({
			name: "prompt",
			label: "Prompt overlay",
			description: "Set, clear or get standing instructions for later decisions.",
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
			description: "Ask a fresh model for a second reading of current grid, optionally with previous grid or memory.",
			parameters: Type.Object({
				question: Type.String({ minLength: 1, maxLength: 2000 }),
				include_prev_grid: Type.Optional(Type.Boolean()),
				include_memory: Type.Optional(Type.Boolean()),
			}),
			execute: guardTool("ask_analyst", async (params: { question: string; include_prev_grid?: boolean; include_memory?: boolean }, signal, ctx) => {
				if (!ctx.model) throw new Refusal("ask_analyst unavailable: no model is selected");
				if (!observation) throw new Refusal("ask_analyst unavailable: the current state could not be read");
				const inputs: AnalystInputs = {
					question: params.question, current: renderState(observation), actions: trajectory.length,
					...(params.include_prev_grid ? { previous: previousGrid ? gridRuns(previousGrid) : null } : {}),
					...(params.include_memory ? { memory: memoryText() } : {}),
				};
				const content: any[] = [{ type: "text", text: analystMessage(inputs) }];
				if (ctx.model.input?.includes("image")) {
					try { content.push(renderArcFrameImage(observation).content); }
					catch (error) { logError("ask_analyst:image", error); }
				}
				// No reasoning: a 512-token answer cannot fit a reasoning pass (see the critic call).
				const reply: any = await sideCall(ctx, ANALYST_SYSTEM, content, { signal, maxTokens: ANALYST_MAX_OUTPUT_TOKENS });
				appendUsage("analyst", reply);
				if (reply.stopReason === "error" || reply.stopReason === "aborted")
					throw new Error(`analyst call failed: ${reply.errorMessage ?? reply.stopReason}`);
				const answer = (reply.content ?? []).filter((block: any) => block?.type === "text")
					.map((block: any) => block.text).join("\n").trim();
				return { ...text(analystReceipt(answer || "(the analyst returned no text)", inputs), undefined, endsBatch()), usage: reply.usage };
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
				include_full: Type.Optional(Type.Boolean({ description: "Return the complete JSON result; default is a short context-safe preview." })),
			}),
			execute: guardTool("run_skill", async (params: { name: string; args?: Record<string, unknown>; include_frames?: boolean; include_full?: boolean }, signal) => {
				// The schema already restricts name; this covers a call validated before a delete.
				const skill = skills.get(params.name);
				if (!skill) throw new Refusal(`no skill '${params.name}'. Skills: ${skills.size ? [...skills.keys()].join(", ") : "(none)"}`);
				const signature = JSON.stringify([params.name, params.args ?? {}, Boolean(params.include_frames)]);
				if (run.skillSignatures.has(signature)) {
					append("skill_runs.jsonl", { decision, name: params.name, version: skill.version, duplicate: true, signature });
					return text(`run_skill ${params.name} v${skill.version} already ran with these arguments in this decision; ` +
						`reuse that result or submit arc_action`, { duplicate: true }, true);
				}
				if (run.skillCalls >= MAX_EXPLICIT_SKILL_CALLS) {
					return text(`run_skill budget (${MAX_EXPLICIT_SKILL_CALLS}) for this decision reached; ` +
						`submit arc_action in the next decision`, { refused: true }, true);
				}
				run.skillCalls += 1;
				run.skillSignatures.add(signature);
				const started = Date.now();
				const stateN = trajectory.length;
				const inputLevel = currentLevel();
				const result = keepArtifacts(await runGuest({
					mode: "run", source: skill.source, state: skillState(Boolean(params.include_frames)), args: params.args ?? {},
				}, signal), { n: stateN, level: inputLevel, skill: params.name, version: skill.version });
				const notStored = result.ok ? (result.warnings ?? []).filter((warning) => /\bartifact/.test(warning)) : [];
				const output = result.ok ? JSON.stringify(result.value ?? null) + (notStored.length ? `\n(${notStored.join("; ")})` : "") : undefined;
				if (!result.ok) {
					append("skill_runs.jsonl", { decision, name: params.name, version: skill.version, state_n: stateN,
						ok: false, ms: Date.now() - started, error: guestFailure(result) });
					throw new Refusal(`skill '${params.name}' v${skill.version} failed: ${guestFailure(result)}\n` +
						`Fix it with skill(op="set", name="${params.name}", source=...). Line numbers refer to your source as saved.`);
				}
				const full = Boolean(params.include_full);
				const shown = !full && output!.length > SKILL_RESULT_CHARS
					? output!.slice(0, SKILL_RESULT_CHARS) + `\n…(preview truncated at ${SKILL_RESULT_CHARS} chars; ` +
						`call run_skill(..., include_full=true) if the omitted cells are needed)`
					: output!;
				append("skill_runs.jsonl", {
					decision, name: params.name, version: skill.version, state_n: stateN, ok: true, ms: Date.now() - started,
					result_chars: output!.length, shown_chars: shown.length, preview: !full,
				});
				return text(`${params.name} v${skill.version}${trajectory.length !== stateN ? `\nEvaluation used state ${stateN}; current state is ${trajectory.length}.` : ""} →\n${shown}`, undefined, endsBatch());
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
	let compactStarted = 0;
	if (continuity === "session") {
		pi.on("session_before_compact", guard("session_before_compact", (event: any) => {
			compactStarted = Date.now();
			const receiptsDir = join(storeDir, "compaction-receipts");
			for (const message of event.preparation.messagesToSummarize) {
				if (message.role !== "toolResult" || !Array.isArray(message.content)) continue;
				for (const block of message.content) {
					if (block.type !== "text" || block.text.length <= 1800) continue;
					mkdirSync(receiptsDir, { recursive: true });
					const original = block.text;
					const digest = createHash("sha256").update(original).digest("hex");
					const path = join(receiptsDir, `${digest}.txt`);
					if (!existsSync(path)) writeFileSync(path, original, { encoding: "utf8", flag: "wx" });
					const compressed = original.replace(/(.)\1{39,}/gs,
						(match: string, character: string) => `${character} [repeated ${match.length} times]`);
					const complete = compressed.length <= 1400;
					const excerpt = complete ? compressed : `${compressed.slice(0, 650)}\n[omitted middle; consult artifact]\n${compressed.slice(-650)}`;
					block.text = `Compaction receipt: tool=${message.toolName}; error=${Boolean(message.isError)}; ` +
						`original_chars=${original.length}; sha256=${digest}; coverage=${complete ? "complete run-length encoding" : "partial excerpt"}; ` +
						`artifact=${path}\n${excerpt}`;
					append("compaction_receipts.jsonl", { tool: message.toolName, is_error: Boolean(message.isError),
						original_chars: original.length, replacement_chars: block.text.length, coverage: complete ? "complete" : "partial",
						artifact: path, sha256: digest });
				}
			}
		}));
		pi.on("session_compact", guard("session_compact", (event: any) => {
			const entry = event.compactionEntry;
			append("context_budget.jsonl", { compaction_event: true, reason: event.reason,
				tokensBefore: entry.tokensBefore, summary_chars: entry.summary.length,
				usage: { input_tokens: entry.usage?.input ?? null, output_tokens: entry.usage?.output ?? null },
				wall_ms: compactStarted ? Date.now() - compactStarted : null });
		}));
		pi.on("session_compact_failed", guard("session_compact_failed", (event: any) => {
			append("context_budget.jsonl", { compaction_event: true, reason: event.reason,
				aborted: event.aborted, error: event.errorMessage,
				wall_ms: compactStarted ? Date.now() - compactStarted : null });
		}));
	}

	replay();
	if (ledgerOn) loadLedgerStores();
	refreshSkillSurface();

	pi.on("session_start", guard("session_start", () => {
		replay();
		if (ledgerOn) loadLedgerStores();
		toolsReady = true;
		refreshSkillSurface();
		refreshActionSurface();
	}));

	pi.on("before_agent_start", guard("before_agent_start", async (event: any, ctx: ExtensionContext) => {
		carriedResults = run.batchResults;
		// Keep the end of the reasoning: conclusions come last.
		const reasoning = carryChars ? run.reasoning.join("\n").replace(/\n{3,}/g, "\n\n").trim() : "";
		carriedReasoning = reasoning.length > carryChars ? `…${reasoning.slice(-carryChars)}` : reasoning;
		if (run.assistantMessages) lastDecisionCost = { ms: (run.endedAt || Date.now()) - run.startedAt, output: run.output, reasoning: run.reasoningTokens };
		run = freshRun();
		decision += 1;
		// The runner's review prompts: "CONSOLIDATE…" and, after a length stop, "RECOVER CONSOLIDATION…".
		const prompt = String(event.prompt ?? "").trimStart();
		run.consolidating = !control && /^(CONSOLIDATE\b|RECOVER CONSOLIDATION\b)/.test(prompt);
		// A tool-only decision is already complete from the runner's perspective.
		// The next turn must be an action turn; leaving memory/skill exposed here
		// invites the model to repeat the same measurement and consumes another full
		// provider request before it can reach the native action boundary.
		run.forceAction = !run.consolidating && /previous decision ended without arc_action|^RECOVER ACTION\b/.test(prompt);
		if (run.consolidating) {
			run.reviewFrom = reviewedThrough;
			reviewedThrough = trajectory.length;
		}
		toolsReady = true;
		if (control || run.forceAction) pi.setActiveTools(["arc_action"]);
		else refreshSkillSurface(run.consolidating
			? CONSOLIDATION_TOOLS
			: (expandedDecisionTools ? EXPANDED_DECISION_TOOLS : DECISION_TOOLS));
		try { observation = await bridgeCall("/state"); }
		catch (error) { observation = undefined; logError("before_agent_start:/state", error, true); }
		refreshActionSurface();
		recordState(trajectory.length, gridOf(observation));
		// Model skills are checked on the transition just recorded (incremental; failures leave the decision unchanged).
		if (!control) await refreshModelChecks();
		// So are the hypotheses' checks: each new transition is one more test of every claim.
		if (!control) { try { await refreshClaimChecks(); } catch (error) { logError("claims:refresh", error); } }
		// The ledger and critic are advisory: any failure leaves the decision unchanged.
		try { await prepareLedger(ctx); } catch (error) { ledgerText = ""; criticText = ""; logError("ledger:prepare", error); }
		const systemPrompt = control
			? renderPrompt("arc_thin_control_system.md", { game })
			: renderPrompt("arc_thin_system.md", {
				game, overlay: overlay ? `Your standing instructions (set with prompt):\n${overlay}` : "",
				board: ledgerOn ? LEDGER_PROMPT + (criticOn ? CRITIC_PROMPT : "") : "",
				continuity: continuity === "session"
					? `Your last ${continuityDecisions} decisions stay in view (what you wrote, called and got back, not your\nreasoning); older ones and all reasoning are not carried forward.`
					: "Earlier conversation and unsaved reasoning are not carried forward.",
			});
		const rendered = systemPrompt.trimEnd() + "\n";
		systemChars = rendered.length;
		return { systemPrompt: rendered };
	}));

	/** A tool result as kept from an earlier decision: the receipt, not the full output. */
	const HISTORY_RESULT_CHARS = 400;
	/** Tool-call arguments as kept from an earlier decision: a skill's source is replaced by its size. */
	function historyArguments(name: string, args: any): any {
		if (name === "skill" && args && typeof args === "object" && typeof args.source === "string")
			return { ...args, source: `<${args.source.length} chars>` };
		return args;
	}

	/**
	 * Session continuity: the decisions before the current one, as the model sees them. Each kept decision keeps its
	 * prompt, the assistant's text and tool calls (reasoning blocks are dropped; a skill's source is replaced by its
	 * size) and its tool results clipped to receipts. Only the last `continuityDecisions` decisions are kept; the
	 * first kept prompt says how many were dropped. The grids and images those decisions saw were never stored in the
	 * session (the working set is added at projection time), so nothing large survives here.
	 */
	function historyMessages(messages: any[], lastUser: number): any[] {
		const starts = messages.slice(0, lastUser).map((message, index) => message?.role === "user" ? index : -1).filter((index) => index >= 0);
		const kept = starts.slice(-continuityDecisions);
		const dropped = starts.length - kept.length;
		const checkpoint = messages.slice(0, lastUser).findLastIndex((message) => message?.role === "compactionSummary");
		const out: any[] = checkpoint >= 0 ? [messages[checkpoint]] : [];
		if (!kept.length) return out;
		// A tool call is kept only with its result (an aborted reply can leave calls that never ran): providers refuse
		// a call without a result, and a result without its call.
		const answered = new Set(messages.slice(kept[0], lastUser).filter((message) => message?.role === "toolResult" && message.toolCallId)
			.map((message) => String(message.toolCallId)));
		const keptCalls = new Set<string>();
		for (let index = kept[0]; index < lastUser; index += 1) {
			const message = messages[index];
			if (message?.role === "user") {
				const note = index === kept[0] && dropped > 0
					? `(${dropped} earlier decision${dropped === 1 ? "" : "s"} not shown; memory and the action record hold what was saved.)\n` : "";
				out.push({ ...message, content: [{ type: "text", text: note + messageText(message) }] });
			} else if (message?.role === "assistant") {
				const blocks = (Array.isArray(message.content) ? message.content : [])
					.filter((block: any) => block?.type === "text" ? Boolean(block.text?.trim())
						: block?.type === "toolCall" && block.id !== undefined && answered.has(String(block.id)))
					.map((block: any) => block.type === "toolCall" ? { ...block, arguments: historyArguments(block.name, block.arguments) } : block);
				// Reasoning blocks are dropped; a reply with nothing left (aborted, reasoning only) is left out.
				if (!blocks.length) continue;
				for (const block of blocks) if (block.type === "toolCall") keptCalls.add(String(block.id));
				out.push({ ...message, content: blocks });
			} else if (message?.role === "toolResult") {
				if (!keptCalls.has(String(message.toolCallId))) continue;
				out.push({
					...message,
					content: (Array.isArray(message.content) ? message.content : []).filter((block: any) => block?.type === "text")
						.map((block: any) => block.text.length > HISTORY_RESULT_CHARS
							? { ...block, text: `${block.text.slice(0, HISTORY_RESULT_CHARS)}…` } : block),
				});
			}
		}
		return out;
	}

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
		const history = continuity === "session" && !control ? historyMessages(messages, lastUser) : [];
		const projected = [...history, head, ...messages.slice(lastUser + 1).map(truncateToolResult)];
		// Developer-only accounting, never added to the model context.
		// JSON characters exclude image bytes and are not a tokenizer estimate.
		try {
			const active = new Set(pi.getActiveTools());
			const tools = pi.getAllTools?.().filter((tool) => active.has(tool.name))
				.map(({ name, description, parameters }) => ({ name, description, parameters }));
			append("context_budget.jsonl", {
				decision, system_chars: systemChars,
				tools_json_chars: tools ? JSON.stringify(tools).length : null,
				tool_names: [...active], messages: projected.length, history_messages: history.length,
				history_text_chars: history.reduce((n, message) => n + messageText(message).length, 0),
				message_text_chars: projected.reduce((n, message) => n + messageText(message).length, 0),
				images: projected.reduce((n, message) => n + (Array.isArray(message.content)
					? message.content.filter((block: any) => block.type === "image").length : 0), 0),
			});
		} catch (error) { logError("context:budget", error); }
		return { messages: projected };
	}));

	pi.on("before_provider_request", guard("before_provider_request", (event: any) => {
		// Audit the actual wire policy without credentials, model content or image data.
		const payload = event.payload ?? {};
		append("provider_policy.jsonl", {
			decision, max_tokens: payload.max_tokens ?? payload.max_completion_tokens ?? null,
			enable_thinking: payload.enable_thinking ?? payload.chat_template_kwargs?.enable_thinking ?? null,
			reasoning_effort: payload.reasoning_effort ?? null,
		});
	}));

	pi.on("message_end", guard("message_end", (event: any) => {
		const message = event.message;
		if (message?.role !== "assistant") return undefined;
		run.assistantMessages += 1;
		run.endedAt = Date.now();
		const blocks: any[] = Array.isArray(message.content) ? message.content : [];
		if (blocks.some((block) => block?.type === "toolCall" && block.name === "arc_action"))
			run.endBatchAt = run.assistantMessages;
		if (carryChars) {
			const pick = (type: string, field: string) => blocks.filter((block) => block?.type === type && typeof block[field] === "string")
				.map((block) => block[field]).join("\n").trim();
			const said = pick("thinking", "thinking") || pick("text", "text");
			if (said) run.reasoning.push(said);
		}
		appendUsage("agent", message);
		return undefined;
	}));

	// Refusals returned as terminating results are still errors to the model.
	pi.on("tool_result", guard("tool_result", (event: any) =>
		(event.details as { refused?: boolean } | undefined)?.refused ? { isError: true } : undefined));
}
