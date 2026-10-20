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
import { createHash, randomBytes } from "node:crypto";
import { ResponsesContinuation } from "./arc_responses_continuation.ts";
import { projectNativeHistory, projectNativeDecision, nativeDecisionStart, summarizeHistory, visibleActions, freezeHistory, carryText, CARRY_CHARS as NATIVE_CARRY_CHARS, HISTORY_RESULT_CHARS as NATIVE_HISTORY_RESULT_CHARS } from "./arc_thin_native_context.ts";
import { coordinateSentences } from "./arc_thin_reuse.ts";
import { REFINE_GUIDE_PATH, REFINER_LEDGER_SYSTEM, REFINER_SYSTEM, STRATEGY_PATH, memoryEditNow, nextExperimentText, parseRefinerReply, renderEditLedger,
	withNextItem, withoutNextItem, type LedgerEntry } from "./arc_thin_refiner.ts";
import { Workspace } from "./arc_thin_workspace.ts";
import { observationReference, storeObservation } from "./arc_thin_observation.ts";
import { CURRENT_STATE_GRID_LABEL, FULL_HISTORY_MAX_LIMIT, HISTORY_MAX_CHARS, NOTHING_EXECUTED, TAKE_ACTIONS_DESCRIPTION, TAKE_ACTIONS_TEXT,
	buildObservationSection, computeGridDelta, currentStateBlock, gridImage, renderRecentHistory, sandboxObservation, summarizeGridTransitions,
	validateActionSequence, type PendingObservation, type RejectedStep, type StepRecord } from "./arc_thin_ch_view.ts";
import { Binder } from "./arc_thin_binder.ts";
import { validatePythonComponent } from "./arc_thin_components.ts";
import { NativeRuntime } from "./arc_thin_native_runtime.ts";
import { planNativeMemoryUpdate } from "./arc_thin_native_memory.ts";
import { NativeLoopGuard } from "./arc_thin_native_loop.ts";
import { RequestTrace, usageRecord } from "./arc_thin_requests.ts";
import { migrateWorkspace } from "./arc_thin_migration.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringEnum, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { compact as piCompact, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { loadPrompt, renderPrompt } from "./prompt_loader.ts";
import { evaluateTaskPython, TaskPythonError, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";
import { SKILL_LIMITS, arcSkillFoundation, guestFailure, arcSkillGuestProgram, type GuestResult } from "./arc_thin_skill_guest.ts";
import { backtestCases, renderBacktest, scoreBacktest, type GuestCaseResult, type ModelCheck } from "./arc_thin_backtest.ts";
import { sharedTaskPythonPool } from "./pi_task_python_pool.ts";
import { buildLedger, explorationLine, goalCoverageLine, isGoalHypothesis, leaves, normIdea, renderLedgerView, type GoalHypothesisRef, type LedgerState, type Observation } from "./arc_thin_ledger.ts";
import {
	CRITIC_SYSTEM, NATIVE_CRITIC_SYSTEM, DEFAULT_CRITIC, IGNORED_REVIEW, buildDossier, criticTriggers, parseCriticReply, type CriticConfig, type CriticNote,
} from "./arc_thin_critic.ts";
import {
	MAX_EVIDENCE, MAX_HYPOTHESES, MAX_STEPS, MAX_STRATEGIES, STATUSES, STRATEGY_STATUSES, VERDICTS, applyRow, applyRows, emptyMemory, memoryForSkills,
	planMemoryUpdate, renderFactsCompact, renderMemory, renderDecisionMemory, resetMemory, type ComponentContext, type MemoryParams,
} from "./arc_thin_memory.ts";
import { isEnvironmentFailure, repairActionArguments, repairActionList, repairMemoryArguments, repairSkillArguments, unescapeSource } from "./arc_thin_boundary.ts";
import {
	normalizePrediction, predictionSchema, renderScore, scorePrediction, type Outcome, type Prediction, type ScoredPrediction,
} from "./arc_thin_prediction.ts";
import { buildHistory, gridChanges, type CellChange } from "./arc_thin_history.ts";
import { ANALYST_SYSTEM, analystMessage, analystReceipt, type AnalystInputs } from "./arc_thin_analyst.ts";
import { artifactHistory, artifactInputs, newArtifactRecords, renderArtifacts, splitArtifacts, type ArtifactRecord } from "./arc_thin_artifacts.ts";
import { claimSegments, claimVersion, levelOf, renderClaimSummary, summarizeClaim, type ClaimRow, type ClaimValue,
	RULES_PATH, citedKeys, controlSegments, promotionView, promotionTriggers, type ControlRecord, type PromotionView,
	CONTEST_MIN_DECIDED, MOVE_FORM, checkContest, contestEvents, renderContest, rivalEvents, rivalLines, unchallenged, type Gaps } from "./arc_thin_claims.ts";
import { MoveFacts, REPEAT_ATTEMPTS, attemptLine, attempts, classify, coverage, coverageText, failedUnderOneModel, kindText, modelChanges, moveKinds,
	moveText, parseMove, rareKinds, repeatEvent, type Attempt, type Move } from "./arc_thin_coverage.ts";
import { LESSONS_CHARS, LESSONS_PATH, LEVEL_REVIEW_CALLS, levelRecord } from "./arc_thin_level_review.ts";

/**
 * A hypothesis check as the native memory tool describes it where the agent writes one: the keys a move carries (strict:
 * any other fails) and the goal form. The agent put a check in 10 of its 72 hypothesis writes in su15 since 2026-10-15,
 * 3 of them English; the interface was described only in the legacy schema.
 */
const NATIVE_CHECK_DESCRIPTION = "Python def check(t), run on every recorded and later move: True holds, False fails, None does not apply. " +
	"t: n, action, x, y (t.get: may be absent), changed_cells, bbox ({top,left,bottom,right} or None), level_changed, state, levels_completed, " +
	"before, after (grids [y][x]); other keys fail. A goal claim: False when its condition holds after a move and the level did not change.";

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
/**
 * Native decisions: one cap on tool calls, and the tool list never changes within a decision (Continual Harness keeps
 * six fixed tools; a decision ends at a state change). The split look/record budgets of 2026-10-12 removed tools in
 * the middle of a decision; in the first activation run the model kept calling the removed python ("Tool python not
 * found" three times) and a decision stalled for 26 messages. At the cap the decision ends and the next one acts.
 */
const NATIVE_DECISION_CALLS = 16;
/** Further actions one arc_action may carry (its then list). */
const THEN_STEPS = 11;
/**
 * An action that changed at most this many cells did nothing visible beyond what every action changes (2026-10-17: the
 * clicks su15-l0-1 repeated 20 times and su15-l0-2 30 times changed 1-2 cells each). Native decisions refuse such an
 * action after it was played that way several times in a row (ARC_THIN_NO_EFFECT_REPEATS, see submitAction).
 */
const NO_EFFECT_CELLS = 2;
/**
 * Pi checks arguments against the action enum of the current state before a tool runs, and its message ("must be equal
 * to one of the allowed values") does not say what is available. su15-l0-1 (2026-10-17) sent RESET 20 times in a row
 * just after a RESET, each rejected there and unseen by the decision's guards. prepareArguments carries such an action
 * past that check under this key, and the tool refuses it with what is available, as it refuses a call made against an
 * outdated schema.
 */
const UNAVAILABLE_KEY = "unavailable_action";
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
 * One action as stored in trajectory.jsonl. changed_cells and bbox come from the bridge. Native receipts show them
 * (since 2026-10-13: without them the agent took a 52-cell change for "nothing happened"); the legacy path keeps them
 * for evaluation only. Neither path shows a frame comparison the agent did not compute itself.
 */
type ActionRow = {
	n: number; decision: number; action: string; x?: number; y?: number; note?: string; idea?: string; expect?: string;
	/** The saved tool whose returned actions included this one (native mode); absent for arc_action. */
	via?: string;
	/** Coordinates were given for an action that takes none; the environment ignored them. */
	ignored_xy?: boolean;
	changed_cells: number | null; bbox?: unknown; level_changed: boolean; state: string;
	levels_completed: number; budget: any;
	predict?: Prediction; prediction?: ScoredPrediction; skill_prediction?: SkillPrediction;
	/**
	 * Continual Harness's step record (ARC_THIN_OBSERVATION=ch): who played it (arc_action, python, tool: <name>), its
	 * place in an action list (the list's reasoning is the first entry's note, the entries it cut its batch_rejected),
	 * the state and levels before it, and the change as colour transitions and cells.
	 */
	source?: string; batch_id?: string; batch_position?: number; batch_total?: number; batch_rejected?: RejectedStep[];
	state_before?: string; levels_before?: number; grid_change?: number[][] | null; grid_delta?: number[][] | null;
};
/** What the environment reported for an action, as skills and history see it. */
const reportedAction = (row: ActionRow, facts = false) => ({
	n: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
	...(row.note ? { note: row.note } : {}),
	// Native mode: what the environment reported changing, a count and its bounding box (no comparison of frames).
	...(facts ? { changed_cells: row.changed_cells, ...(row.bbox ? { bbox: row.bbox } : {}) } : {}),
	level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed, budget: row.budget,
});
/** The bridge's change report as receipt text: "changed=52 in x13-38 y40-62", or "changed=0". */
const changeText = (row: ActionRow) => {
	const box = row.bbox as { top?: number; left?: number; bottom?: number; right?: number } | undefined;
	return `changed=${row.changed_cells ?? "?"}` + (row.changed_cells && box && [box.top, box.left, box.bottom, box.right].every(Number.isFinite)
		? ` in x${box.left}-${box.right} y${box.top}-${box.bottom}` : "");
};
/** Only ACTION6 takes coordinates; the environment ignores them on every other action. */
const takesCoordinates = (action: string) => action === "ACTION6";

/** A model-facing tool error: expected, shown to the model, not logged as a harness fault. */
class Refusal extends Error {}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const duration = (ms: number) => {
	const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
	return h ? `${h}h${String(m).padStart(2, "0")}m` : m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const tokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function arcThinExtension(pi: ExtensionAPI) {
  const responsesContinuation = new ResponsesContinuation();
  const native = process.env.ARC_THIN_FOUNDATION === "native";
  // How the game is shown: "query" (the extension's own default, kept for tests that build it directly), "inline", or
  // "ch", Continual Harness's observation and action tool inside this harness's decision (the runner's native default
  // since 2026-10-20; arc_thin_ch_view.ts).
  const observationMode = native ? process.env.ARC_THIN_OBSERVATION ?? 'query' : 'inline';
  if (!['query', 'inline', 'ch'].includes(observationMode)) throw Error('ARC_THIN_OBSERVATION must be query, inline or ch');
  const queryObservation = native && observationMode === 'query';
  const chView = native && observationMode === 'ch';
  const replayReasoning = native && process.env.ARC_THIN_REPLAY_REASONING === "1";
  /** Reasoning kept within the current decision (default on in native mode; ARC_THIN_DECISION_REASONING=0 strips it). */
  const decisionReasoning = native && process.env.ARC_THIN_DECISION_REASONING !== "0";
  // How that reasoning is carried between the tool rounds of one decision. "all" replays its text; "fields" (the runner's
  // default on the Responses route, where the stored response keeps the reasoning server-side) replays only the short
  // <carry> block the model writes itself. Continual Harness / Prime keep the conclusions, not the deliberation.
  const reasoningMode = process.env.ARC_THIN_REASONING_MODE ?? 'all';
  if (!['all', 'recent', 'fields', 'none'].includes(reasoningMode)) throw Error('invalid ARC_THIN_REASONING_MODE');
  const carryFieldChars = Math.max(80, Math.floor(Number(process.env.ARC_THIN_CARRY_FIELD_CHARS ?? NATIVE_CARRY_CHARS)));
  const archiveResults = process.env.ARC_THIN_ARCHIVE_RESULTS === '1';
	const control = process.env.ARC_THIN_VARIANT === "control";
	// Diagnostic smoke suites can request the legacy all-tools surface so they
	// can exercise low-frequency tools in scripted ordinary turns. Real runs
	// default to the phase-specific surface below.
	const expandedDecisionTools = process.env.ARC_THIN_EXPANDED_TOOLS === "enabled";
  // The historical default smoke has >8 tool calls before its first action. Its explicit
  // scripted-only budget keeps that diagnostic valid; ordinary legacy/native limits stay 6/8.
  const scriptedBudget = Math.min(40, Math.max(0, Number(process.env.ARC_THIN_SCRIPTED_TOOL_BUDGET) || 0));
  const scriptedConfig = join(process.env.ARC_RUN_ROOT ?? process.cwd(), 'run-config.json');
  const diagnosticBudget = expandedDecisionTools && scriptedBudget && existsSync(scriptedConfig)
    && JSON.parse(readFileSync(scriptedConfig, 'utf8')).provider === 'offline-arc-thin-smoke' ? scriptedBudget : 0;
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
	const continuity = native || process.env.ARC_THIN_CONTINUITY === "session" ? "session" : "rebuild";
	const continuityDecisions = Math.max(1, Math.floor(Number(process.env.ARC_THIN_CONTINUITY_DECISIONS) || 8));
	// Native history (2026-10-14): earlier decisions as a transcript before the current head, each earlier result clipped
	// to ARC_THIN_HISTORY_RESULT_CHARS (default 5,000, Continual Harness's cap). ARC_THIN_NATIVE_HISTORY_CHARS > 0 restores
	// the summarised section inside the head (the default before 2026-10-14), within that many characters.
	const nativeHistoryChars = Math.max(0, Math.floor(Number(process.env.ARC_THIN_NATIVE_HISTORY_CHARS ?? 0)));
	const historyResultChars = Math.max(200, Math.floor(Number(process.env.ARC_THIN_HISTORY_RESULT_CHARS ?? NATIVE_HISTORY_RESULT_CHARS)));
	// Rounds of earlier decisions that repeated the same calls are shown once with their count, also across decision
	// prompts (2026-10-16: a gateway refused every request carrying such a repetition; 2026-10-17: it counts across
	// prompts). ARC_THIN_COLLAPSE_REPEATS=0 keeps every copy.
	const collapseRepeats = process.env.ARC_THIN_COLLAPSE_REPEATS !== "0";
	// Native: an action played this many times in a row, each changing at most NO_EFFECT_CELLS cells, is refused the next
	// time until another action is played (2026-10-17). ARC_THIN_NO_EFFECT_REPEATS=0 turns the refusal off.
	const noEffectRepeats = !native ? 0 : process.env.ARC_THIN_NO_EFFECT_REPEATS === undefined ? 3
		: Math.max(0, Math.floor(Number(process.env.ARC_THIN_NO_EFFECT_REPEATS) || 0));
	// The python session as a live kernel (2026-10-14, Prime's persistent REPL): one sandbox instance keeps the namespace
	// in memory, env.act waits for feedback where it is called, and the working set lists what the session holds.
	// ARC_THIN_PYTHON_KERNEL=0 restores a fresh sandbox per call restored from the checkpoint, with acting replayed;
	// ARC_THIN_SESSION_VIEW=0 leaves the listing out.
	const pythonKernel = native && process.env.ARC_THIN_PYTHON_KERNEL !== "0" && process.env.ARC_THIN_PYTHON_SESSION !== "0";
	const sessionView = native && process.env.ARC_THIN_SESSION_VIEW !== "0";
	// P4 (2026-10-19): the agent called refine and consult 0 times in 10 or more su15 runs with either model. ARC_THIN_LEAN=1
	// leaves both tools out, with the system prompt's subagent line and the long form of its skill line (one at a time:
	// ARC_THIN_REFINE_TOOL=0, ARC_THIN_CONSULT=0). The scheduled refinements and the views stay: what they show is acted on.
	const lean = process.env.ARC_THIN_LEAN === "1";
	const refineTool = !lean && process.env.ARC_THIN_REFINE_TOOL !== "0";
	const consultTool = !lean && process.env.ARC_THIN_CONSULT !== "0";
	const storeDir = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "harness");
	mkdirSync(storeDir, { recursive: true });
  const workspace = native ? new Workspace(process.env.ARC_RUN_ROOT ?? process.cwd(), {
    inlineChars: Number(process.env.ARC_THIN_INLINE_RESULT_CHARS ?? 8000) }) : undefined;
  const archivedResults = new Map<string, string>();
  const historyRefs = new Map<string, string>();
  const saveHistoryResult = (text: string): string => {
    const hash = createHash('sha256').update(text).digest('hex');
    if (!historyRefs.has(hash)) historyRefs.set(hash, workspace!.saveResult(text).ref);
    return historyRefs.get(hash)!;
  };
  const archiveResult = (message: any, body: string): string => {
    const key = String(message.toolCallId) + createHash('sha256').update(body).digest('hex');
    if (!archivedResults.has(key)) {
      const saved = workspace!.saveResult(body);
      const actions = body.split('\n').filter(line => /^#\d+ (ACTION\d|RESET)\b/.test(line));
      archivedResults.set(key, `Earlier ${message.toolName} result archived (${body.length} chars${message.isError ? '; FAILED' : ''}).\n` +
        `${actions.join('\n')}${actions.length ? '\n' : ''}First line (preview): ${body.split('\n')[0].slice(0, 160)}\n` +
        `Exact content: ${saved.ref}; read with offset/limit if needed.`);
    }
    return archivedResults.get(key)!;
  };
  const binder = workspace ? new Binder(workspace, validatePythonComponent) : undefined;
  let nativeRuntime: NativeRuntime | undefined;

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
	/** What each move changed, outside counter lines, for the kinds of moves made (arc_thin_coverage.ts). */
	const moveFacts = new MoveFacts(grids);
	/** Action count at the latest consolidation turn. */
	let reviewedThrough = 0;
	/** The agent's model skills replayed on recorded transitions (model_checks.jsonl). */
	let modelChecks: ModelCheck[] = [];
	/** Values skills returned under "artifacts" (artifacts.jsonl); see arc_thin_artifacts.ts. */
	let artifactLog: ArtifactRecord[] = [];
	/** Results of the agent's hypothesis checks on recorded transitions (claim_checks.jsonl); see arc_thin_claims.ts. */
	let claimRows: ClaimRow[] = [];
	/** "key@version" → the check's results on mismatched transitions (claim_checks.jsonl rows with control: true). */
	const claimControls = new Map<string, ControlRecord>();
	/** "key@version" → why that check could not be used (it is not run again). */
	const claimCompileErrors = new Map<string, string>();
	/** Transitions whose grids are not available: never checked, so not asked for again. */
	const claimGridsMissing = new Set<number>();
	/** "key@check version@claim" that its check has contested once (H2a): a status set afterwards stands. */
	const contestedByCheck = new Set<string>();
	const contestId = (key: string, h: { check?: string; claim: string }) =>
		`${key}@${claimVersion(h.check ?? "")}@${createHash("sha256").update(h.claim).digest("hex").slice(0, 12)}`;
	/** Memory keys written, with the action count at the time: the critic's notes are followed up by key. */
	let memoryTouches: Array<{ key: string; at: number }> = [];
	/** Wall-clock time of each action (actionTimes[n-1] for action n) and the previous decision's cost, for RESOURCES. */
	let actionTimes: number[] = [];
	let lastDecisionCost: { ms: number; output: number; reasoning: number; coordinateShare?: number } | undefined;
	/** Characters of the last request (system prompt and messages), shown in RESOURCES so the agent sees its context size. */
	let lastContextChars = 0;
	/** Budget tokens (uncached input + output) spent so far, by usage kind (agent, refiner, …). */
	const spentTokens = new Map<string, number>();
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
		contestedByCheck.clear();
		for (const row of readRows("memory.jsonl")) {
			applyRow(memory, row);
			if (row.at !== undefined && row.key && row.by !== "check") memoryTouches.push({ key: String(row.key), at: Number(row.at) || 0 });
			if (row.by === "check" && row.hyp?.check) contestedByCheck.add(contestId(String(row.key), row.hyp));
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
		claimControls.clear();
		for (const row of readRows("claim_checks.jsonl")) {
			if (row.compile_error) claimCompileErrors.set(`${row.key}@${row.version}`, String(row.compile_error));
			else if (row.control && Array.isArray(row.results)) claimControls.set(`${row.key}@${row.version}`, { key: row.key, version: row.version, results: row.results });
			else if (row.key && row.version && Number.isInteger(row.n)) claimRows.push(row as ClaimRow);
		}
		// A hypothesis already contested when its check would contest it: that check's contest is spent (H2a).
		for (const [key, h] of memory.hypotheses) if (h.status === "contested" && currentContest(key, h)) contestedByCheck.add(contestId(key, h));
		overlay = readRows("prompt.jsonl").at(-1)?.text ?? "";
		trajectory = readRows("trajectory.jsonl");
		actionTimes = trajectory.map((row: any) => Date.parse(row.t) || 0);
		grids.clear();
		changeCache.clear();
		moveFacts.clear();
		for (const row of readRows("states.jsonl")) if (Array.isArray(row.grid)) grids.set(Number(row.n), row.grid);
		const workingSets = readRows("working_set.jsonl");
		reviewedThrough = Math.max(0, ...workingSets.filter((row) => row.consolidating).map((row) => Number(row.actions) || 0));
		const decisions = [...trajectory, ...readRows("usage.jsonl"), ...workingSets].map((row) => Number(row.decision) || 0);
		decision = Math.max(0, ...decisions);
		spentTokens.clear();
		for (const row of readRows("usage.jsonl")) if (row.kind)
			spentTokens.set(row.kind, (spentTokens.get(row.kind) ?? 0) + (Number(row.input) || 0) + (Number(row.output) || 0));
	}

	const requestTrace = new RequestTrace(row => append('request-events.jsonl', row));
	let parentRequest: string | undefined;
	function appendUsage(kind: string, message: any): void {
		const usage = message?.usage ?? {};
		if (kind === "agent") { run.output += Number(usage.output) || 0; run.reasoningTokens += Number(usage.reasoning) || 0; }
		// Budget tokens (uncached input + output) by kind, for the refinements' cost ceiling.
		spentTokens.set(kind, (spentTokens.get(kind) ?? 0) + (Number(usage.input) || 0) + (Number(usage.output) || 0));
		if (native) {
			if (kind === 'agent' && parentRequest) { requestTrace.finish(parentRequest,message); parentRequest=undefined; }
			// The model that answered, per row: the agent's and its side calls' tokens can be told apart afterwards.
			append('usage.jsonl',{decision,kind,...usageRecord(message),model:message?.model ?? null,request_id:requestTrace.idFor(message) ?? null});
			return;
		}
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

	/** Actions left under whichever limit is nearer: the level's or the run's (pilot-01 read "1/110 (total 1/20)" as two budgets). */
	function budgetText(budget: any): string {
		const limits = ([["level", budget.used, budget.maximum], ["run", budget.total_used, budget.total_maximum]] as const)
			.filter(([, used, maximum]) => typeof used === "number" && typeof maximum === "number") as [string, number, number][];
		if (!limits.length) return `actions_used=${budget.total_used ?? budget.used ?? "?"}`;
		const [name, used, maximum] = limits.reduce((a, b) => b[2] - b[1] < a[2] - a[1] ? b : a);
		return `actions_left=${Math.max(0, maximum - used)} (${name} limit ${maximum})`;
	}

	/** What the environment reported for an action. No frame comparison: that is a tool the agent writes. */
	function actionLine(row: ActionRow): string {
		const budget = row.budget ?? {};
		const resets = trajectory.filter((item) => item.n <= row.n && item.action === "RESET").length;
		// Native receipts say what changed (the bridge's count and box) and when given coordinates were ignored.
		return `#${row.n} ${actionLabel(row)} → ${native ? `${changeText(row)} ` : ""}level_changed=${row.level_changed} ` +
			`state=${row.state} levels=${row.levels_completed} ${budgetText(budget)}` +
			(resets ? ` resets=${resets}` : "") + (native && row.ignored_xy ? ` (x,y ignored: ${row.action} takes no coordinates)` : "");
	}

	// ---------------------------------------------------------------- per-decision state

	type Run = {
		consolidating: boolean; forceAction: boolean; assistantMessages: number; toolCalls: number; arcSeenInMessage: number;
		/** A review after a level change (the runner's "LEVEL REVIEW" prompt): the level record, at most LEVEL_REVIEW_CALLS calls. */
		levelReview: boolean;
		/** Native decisions: calls that look things up or compute, and calls that record (see gate). */
		budgetNote?: string;
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
		/** Reasoning sentences in this decision, and those locating cells or coordinates (coordinateSentences). */
		reasoningSentences: number; coordinateSentences: number;
		/** ARC_THIN_OBSERVATION=ch: the grids the head renders go with it as PNGs, in order. */
		workingSet?: { text: string; image?: { type: "image"; data: string; mimeType: string }; images?: Array<{ type: "image"; data: string; mimeType: string }> };
		/** Native: the decision's first message as built once (kept byte-identical for the provider's prefix cache). */
		head?: any; headKey?: string;
		/** The model answered this decision's prompt (an assistant message that was not a provider error). */
		answered: boolean;
	};
	const freshRun = (): Run => ({
		consolidating: false, levelReview: false, forceAction: false, assistantMessages: 0, toolCalls: 0, arcSeenInMessage: -1, endBatchAt: -1, actionDone: false,
		memoryCommitted: false, skillCalls: 0, skillSignatures: new Set(), batchResults: [], reviewFrom: 0, reasoning: [],
		startedAt: Date.now(), endedAt: 0, output: 0, reasoningTokens: 0, reasoningSentences: 0, coordinateSentences: 0, answered: false,
	});
	let run = freshRun();
	/**
	 * ARC_THIN_OBSERVATION=ch: the actions since the last decision's prompt (its OBSERVATIONS SINCE LAST QUERY), those the
	 * current decision shows (python's state["observations"]), and the counter of action-list ids.
	 */
	let pendingObservations: PendingObservation[] = [];
	let decisionObservations: PendingObservation[] = [];
	let batchCounter = 0;
	/** ARC_THIN_OBSERVATION=ch: the bridge's RESET before the first frame, CH's step 0 (shown once, kept in RECENT HISTORY). */
	let initialReset: { observation: PendingObservation; record: StepRecord } | undefined;
	/** Batched results carried into the next decision's working set (shown once). */
	let carriedResults: string[] = [];
	const CARRIED_RESULT_CHARS = 400;
	/** ARC_THIN_CARRY_REASONING: the end of the previous decision's reasoning, shown for one decision. */
	let carriedReasoning = "";

	/** Skills and the overlay, as strategies reference them (uses: "skill:<name>", "prompt"), and each check's record. */
	const components = (): ComponentContext => ({
		skills: Object.fromEntries([...skills].map(([name, skill]) => [name, skill.version])), overlay, checks: claimLines(),
		...(native ? {factProvenance:true} : {}),
	});
	const memoryText = () => {
		const full = renderMemory(memory, trajectory.length, trajectory.map(actionLabel), components());
		// Keep hypothesis/strategy/revision reasoning intact; bound only the old
		// fact prose that otherwise grows without affecting the live rivals.
		const marker = "MEMORY (";
		const index = full.indexOf(marker);
		if (index < 0) return full;
		const head = full.slice(0, index).trimEnd();
		return `${head}\n\n${renderFactsCompact(memory, 2200, native)}`;
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

	/** `shown`: actions whose receipts are already in the history in view (native mode); they are not listed again. */
	function recentText(shown?: Set<number>): string {
		if (trajectory.length === 0) return shown ? "" : "RECENT ACTIONS: none yet.";
		// A consolidation turn reviews every action since the previous one, not only the last few; a level review, the level.
		if (run.consolidating) {
			if (run.levelReview) return levelReviewText();
			const rows = trajectory.slice(run.reviewFrom).slice(-REVIEW_ACTIONS);
			return [`ACTIONS SINCE YOUR LAST REVIEW (#${rows[0]?.n ?? trajectory.length}–#${trajectory.length}, ${rows.length} of ${trajectory.length}):`,
				...rows.map(recentLine)].join("\n");
		}
		const recent = trajectory.slice(-RECENT_ACTIONS).filter((row) => !shown?.has(row.n));
		if (shown && !recent.length) return "";
		return [shown ? `RECENT ACTIONS not in the conversation above (${recent.length} of the last ${RECENT_ACTIONS}; ${trajectory.length} in total):`
			: `RECENT ACTIONS (last ${recent.length} of ${trajectory.length}):`, ...recent.map(recentLine)].join("\n");
	}

	/**
	 * What a level review starts from (arc_thin_level_review.ts): the level just completed, by attempt, with its hypotheses,
	 * the moves that gave an earlier move's result again (the ledger's repetitions, status cells masked) and python run
	 * again with the same code.
	 */
	function levelReviewText(): string {
		let repeated: number[] = [];
		try { repeated = buildLedger(trajectory, [], grids).repeats.map((repeat) => repeat.n); }
		catch (error) { logError("review:repeats", error); }
		return levelRecord({ rows: trajectory, completed: currentLevel(), memoryRows: readRows("memory.jsonl"), checks: claimRows,
			repeated, python: readRows("component_runs.jsonl") });
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
		// P2 (2026-10-19): this attempt beside the earlier ones on the level, which ended in GAME_OVER or RESET.
		const tries = native && COVERAGE ? attemptLine(attempts(trajectory), currentLevel()) : "";
		if (tries) parts.push(tries);
		const left = deadlineMs ? Math.max(0, deadlineMs - Date.now()) : undefined;
		if (left !== undefined) parts.push(`${duration(left)} of run time left`);
		if (lastDecisionCost) parts.push(`your last turn took ${duration(lastDecisionCost.ms)} and ${tokens(lastDecisionCost.output)} output tokens` +
			(lastDecisionCost.reasoning ? ` (${tokens(lastDecisionCost.reasoning)} of them reasoning)` : ""));
		// Prime shows the agent its context fill; here, the size of the last request.
		if (native && lastContextChars) parts.push(`your last request carried ${tokens(lastContextChars)} characters of context`);
		const times = actionTimes.slice(-6).filter((t) => t > 0);
		if (times.length >= 3) {
			const pace = (times.at(-1)! - times[0]) / (times.length - 1);
			parts.push(`the last ${times.length - 1} actions took ${duration(pace)} each` +
				(left !== undefined && pace > 0 ? `, so the time left allows about ${Math.floor(left / pace)} more at that pace` : ""));
		}
		return parts.length ? `RESOURCES: ${parts.join("; ")}. Reasoning and tool calls cost time, not actions.` : "";
	}

	function buildWorkingSet(ctx: ExtensionContext, historyText?: string): Run["workingSet"] {
		const recent = recentText(historyText === undefined ? undefined : visibleActions(historyText));
		// Native mode: the context is the harness plus the present (Continual Harness rebuilds each decision from its
		// state; Prime keeps data out of context). The strategy and other active prompts are in the system prompt; here
		// come the memory index, a summarised history, recent actions it does not cover, what a refinement changed, and
		// resources. The runtime's own analyses are files under data/, not resident text.
		const nativeSections = (): Array<[string, string]> => {
			// Rivals with checks, compared on the recorded moves (H3a): one line per question, shown when it is new or changed
			// (P3: "no recorded move separates …" stood unchanged in 35 decisions of su15-g56-2 and 45 of su15-q38-2). A count
			// of moves both decided alike is not a change.
			const rivals = rivalLines(checkedHypotheses(), claimRows).filter((line) => {
				if (!COVERAGE) return true;
				const question = line.slice(0, line.indexOf('": ') + 1), seen = line.replace(/both decided \d+ moves?/g, "both decided");
				if (shownRivals.get(question) === seen) return false;
				shownRivals.set(question, seen);
				return true;
			});
			const out: Array<[string, string]> = [["memory", [renderDecisionMemory(memory, trajectory.length, claimLines(), undefined, contestNotes()), ...rivals].join("\n")]];
			const rules = ruleChecksText();
			if (rules) out.push(["rules", rules]);
			// What the python session holds, so the agent uses those names instead of re-reading or recomputing them.
			const held = sessionView ? nativeRuntime?.sessionView() ?? "" : "";
			if (held) out.push(["python", held]);
			if (historyText) out.push(["history", historyText]);
			// ARC_THIN_OBSERVATION=ch: a decision's actions are CH's RECENT HISTORY, in the observation below; a review keeps
			// its own material (the actions since the last review, or the level record).
			if (recent && (!chView || run.consolidating)) out.push(["recent", recent]);
			if (refinerNotices.length) {
				out.push(["refiner", refinerNotices.map(({ text }) => text).join("\n")]);
				// When the agent is told of an edit: the ledger counts what it did from this decision on.
				for (const { editId } of refinerNotices) if (editId) {
					append("refiner.jsonl", { kind: "told", id: editId, at: trajectory.length, decision });
					toldAt.set(editId, trajectory.length);
				}
				refinerNotices = [];
			}
			return out;
		};
		const sections: Array<[string, string]> = control ? [["recent", recent]]
			: native ? nativeSections()
      : [["memory", memoryText()], ["skills", skillsText()], ["recent", recent]];
		if (!control && !native) {
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
		const challenge = native ? "" : predictionChallengeText();
		if (challenge) sections.push(["challenge", challenge]);
		if (ledgerText && !native) sections.push(["ledger", ledgerText]);
		if (criticText && !native) sections.push(["critic", criticText]);
		// ARC_THIN_OBSERVATION=ch: the game as Continual Harness shows it, in place of this harness's current-state block.
		const seen = chView ? chObservation(ctx) : undefined;
		const stateText = seen ? seen.text : observation
			? queryObservation ? observationReference(observation, trajectory.length) : `CURRENT STATE\n${renderState(observation)}`
			: "CURRENT STATE: unavailable — do not act on remembered grids.";
		let image: { type: "image"; data: string; mimeType: string } | undefined;
		if (!seen && !queryObservation && observation && ctx.model?.input?.includes("image")) {
			try { image = renderArcFrameImage(observation).content; }
			catch (error) { logError("context:image", error); }
		}
		// What the agent was given this decision, for auditing what later reasoning restates or ignores.
		// The grid is in states.jsonl, so only its size and hash are logged here.
		const body = sections.map(([, value]) => value).join("\n\n");
		try {
			append("working_set.jsonl", {
				decision, consolidating: run.consolidating, ...(run.levelReview ? { level_review: true } : {}), actions: trajectory.length, observation_delivery: observationMode,
				sections: Object.fromEntries([...sections, ["state", stateText] as [string, string]].map(([name, value]) => [name, value.length])),
				...(seen ? { images: seen.images.length, rendered_grids: seen.labels } : {}),
				state_sha256: createHash("sha256").update(stateText).digest("hex").slice(0, 16), text: body,
			});
		} catch (error) { logError("context:working_set", error); }
		return { text: `${body}\n\n${stateText}`, image, ...(seen ? { images: seen.images } : {}) };
	}

	/** Who played an action, as CH's history labels it: arc_action, python, or tool: <name>. */
	const sourceLabel = (row: ActionRow) => row.source ?? (row.via
		? row.via === "python" ? "python" : `tool: ${row.via.replace(/^tools\//, "").replace(/\.py$/, "")}` : "arc_action");
	/** An action as Continual Harness's step record (rows recorded in another observation mode get their change from the grids). */
	function stepRecordOf(row: ActionRow, previous: ActionRow | undefined): StepRecord {
		const score = row.levels_before ?? (previous ? previous.levels_completed : row.levels_completed - (row.level_changed ? 1 : 0));
		const pre = grids.get(row.n - 1), post = grids.get(row.n);
		return {
			step: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { data: { x: row.x, y: row.y } } : {}),
			source: sourceLabel(row), score, state: row.state_before ?? previous?.state ?? "NOT_FINISHED", stateAfter: row.state,
			scoreDelta: row.levels_completed - score,
			gridChange: row.grid_change !== undefined ? row.grid_change : summarizeGridTransitions(pre, post),
			gridDelta: row.grid_delta !== undefined ? row.grid_delta : computeGridDelta(pre, post),
		};
	}
	/** The bridge's own first RESET is CH's step 0; a resumed run gets it from its first row. */
	const resetRecord = (): StepRecord => initialReset?.record ?? { step: 0, action: "RESET", source: "auto_reset", score: 0,
		state: "NOT_PLAYED", stateAfter: trajectory[0]?.state_before ?? "NOT_FINISHED", scoreDelta: 0, gridChange: null, gridDelta: null };
	const stepRecords = (rows: ActionRow[]) => [resetRecord(), ...rows.map((row, i) => stepRecordOf(row, rows[i - 1]))];
	/** trajectory.StepRecord as CH's sandbox lists it (asdict), with this harness's sources; colours stay ints here. */
	const stepRecordDict = (record: StepRecord, row: ActionRow | undefined) => ({
		game_id: game, action_counter: record.step, state: record.state, score: record.score, chosen_action: record.action,
		chosen_action_data: record.data ?? {}, reasoning: null, tool_calls: [], vlm_attempts: 1, error: null, source: record.source,
		batch_id: row?.batch_id ?? null, batch_position: row?.batch_position ?? null, batch_total: row?.batch_total ?? null,
		batch_reasoning: row?.batch_position === 1 && row.source === "arc_action" ? row.note ?? null : null,
		batch_rejected: row?.batch_rejected ?? null,
		skill_id: row?.via && row.via !== "python" ? sourceLabel(row).replace(/^tool: /, "") : null,
		score_delta: record.scoreDelta ?? null, state_after: record.stateAfter ?? null,
		grid_delta: record.gridDelta ?? null, grid_change: record.gridChange ?? null,
	});
	/**
	 * ARC_THIN_OBSERVATION=ch: what CH's sandbox state adds for code: `observations`, one entry per action shown in this
	 * decision's OBSERVATIONS with its whole animation (hex rows here, int grids in python), and `recent_trajectory`, the
	 * last FULL_HISTORY_MAX_LIMIT step records.
	 */
	const chSandboxState = () => {
		const rows: Array<ActionRow | undefined> = [undefined, ...trajectory];
		return {
			observations: decisionObservations.map(sandboxObservation),
			recent_trajectory: stepRecords(trajectory).map((record, i) => stepRecordDict(record, rows[i])).slice(-FULL_HISTORY_MAX_LIMIT),
		};
	};

	/**
	 * ARC_THIN_OBSERVATION=ch: the game as Continual Harness shows it (context.build_working_prompt's observation blocks):
	 * RECENT HISTORY, the step, OBSERVATIONS SINCE LAST QUERY with its key frames, and CURRENT STATE (state, levels, the
	 * offered actions with their meanings, the grid as a hex map), with a PNG of each grid rendered as text, in order. It
	 * takes the place of the current-state block in this harness's working set; everything around it is this harness's.
	 * A review sees the current state only: its own material covers the actions, and what happened since the last
	 * decision is left for the next one.
	 */
	function chObservation(ctx: ExtensionContext): { text: string; images: Array<{ type: "image"; data: string; mimeType: string }>; labels: string[] } {
		const blocks: string[] = [];
		let shown: Array<{ label: string; grid: number[][] }> = [];
		if (!run.consolidating) {
			blocks.push("## RECENT HISTORY\n" + renderRecentHistory(stepRecords(trajectory), HISTORY_MAX_CHARS));
			// CH's action_counter counts the starting RESET, so it is the number the next action gets.
			blocks.push(`# Step: ${trajectory.length + 1}`);
			const observed = buildObservationSection(decisionObservations);
			if (observed.text.trim()) blocks.push("## OBSERVATIONS SINCE LAST QUERY\n" + observed.text.trimEnd());
			shown = observed.grids;
		}
		const grid = gridOf(observation);
		blocks.push(observation
			? currentStateBlock(String(observation.state ?? "UNKNOWN"), Number(observation.levels_completed ?? 0), availableActions(observation), grid)
			: "## CURRENT STATE\n(unavailable — do not act on remembered grids)");
		const rendered = [...shown, ...(grid?.length ? [{ label: CURRENT_STATE_GRID_LABEL, grid }] : [])];
		const images = ctx.model?.input?.includes("image") ? rendered.map((g) => gridImage(g.grid)) : [];
		return { text: blocks.join("\n\n"), images, labels: rendered.map((g) => g.label) };
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
	 * What the environment reported for the transitions `ns`, as a check sees it besides the two grids (the guest adds
	 * changed_cells from them). Checks run strict (r04, 2026-10-17): t.get of a key a move does not carry fails. Before,
	 * 6 of the 14 hypotheses refinements wrote in su15 r2-r9 read changed_cells, which a move did not carry, and were
	 * judged on the default; one recorded 206 fails and 5 holds so, and those counts decide promotion.
	 */
	function transitionsFor(ns: Iterable<number>): Record<string, unknown> {
		const byN = new Map(trajectory.map((row) => [row.n, row]));
		return Object.fromEntries([...ns].map((n) => {
			const row = byN.get(n);
			return [String(n), row && {
				action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
				level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed,
			}];
		}));
	}

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
		const byN = new Map(trajectory.map((row) => [row.n, row]));
		for (const segments of batches) {
			const ns = new Set(segments.flatMap((segment) => segment.steps.map((step) => step.n)));
			const result = await runGuest({
				mode: "claims", strict: true, claims: claims.map(({ key, source }) => ({ key, source })), segments, transitions: transitionsFor(ns),
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

	/** The contest a hypothesis's current check makes on its results (H2a), if any. */
	function currentContest(key: string, h: { check?: string }) {
		if (!h.check) return undefined;
		const version = claimVersion(h.check);
		if (claimCompileErrors.has(`${key}@${version}`)) return undefined;
		return checkContest(claimRows.filter((row) => row.key === key && row.version === version), CHECK_CONTEST_MIN);
	}

	/** Each hypothesis's question and status, and its check version when the check compiles (H3a, rival events). */
	const checkedHypotheses = () => new Map([...memory.hypotheses].map(([key, h]) => [key, { ...(h.question ? { question: h.question } : {}), status: h.status,
		...(h.check && !claimCompileErrors.has(`${key}@${claimVersion(h.check)}`) ? { version: claimVersion(h.check) } : {}) }]));

	/**
	 * H2a: a hypothesis whose current check fails on at least half of at least ARC_CHECK_CONTEST_MIN decided moves
	 * becomes contested, through the memory row an unanswered refutation leads to. Once per check version and claim, so a
	 * status the agent sets afterwards stands; narrowing, fixing or rejecting it stays the agent's (or a refinement's).
	 * Returns a receipt line per hypothesis contested now.
	 */
	function contestByChecks(): string[] {
		const lines: string[] = [];
		for (const [key, h] of [...memory.hypotheses]) {
			if (h.status === "rejected" || contestedByCheck.has(contestId(key, h))) continue;
			const contest = currentContest(key, h);
			if (!contest) continue;
			contestedByCheck.add(contestId(key, h));
			// Already contested (by a refutation, or by an earlier version of its check): this check's contest is spent, so a
			// status the agent sets afterwards stands.
			if (h.status === "contested") continue;
			const next = { ...h, status: "contested" as const, contested_at: contest.at };
			append("memory.jsonl", { key, hyp: next, at: trajectory.length, by: "check" });
			applyRows(memory, [{ key, hyp: next }]);
			lines.push(`${key} contested: ${renderContest(contest)}`);
		}
		return lines;
	}

	/** Whether a hypothesis is a refinement's own: its latest write (a contest by its check is no one's) was a refinement's. */
	function refinementOwned(key: string): boolean {
		const last = readRows("memory.jsonl").filter((row) => row.key === key && row.by !== "check").at(-1);
		return Boolean(last && !last.deleted && last.hyp && last.by === "refinement");
	}

	/** The decision view's line under each contested hypothesis with a check: what its current check says (H2a). */
	function contestNotes(): Record<string, string> {
		const notes: Record<string, string> = {};
		for (const [key, h] of memory.hypotheses) {
			if (h.status !== "contested" || !h.check) continue;
			const contest = currentContest(key, h);
			notes[key] = contest
				? `! ${renderContest(contest)}: narrow the claim and its check to where it held, fix the check, or reject it; then restate its status`
				: `! contested at #${h.contested_at ?? "?"}; its current check does not contest it: narrow the claim, reject it, or restate its status`;
		}
		return notes;
	}

	/** The rules prompt as written (the agent and refinements maintain it; it applies while its frontmatter says active). */
	function rulesText(): string {
		if (!workspace) return "";
		try { return workspace.read(RULES_PATH); } catch { return ""; }
	}

	/** Promotion and demotion as the checks' records show them (docs/plans/2026-10-14-knowledge-promotion.md). */
	function promotion(): PromotionView {
		const hypotheses = new Map([...memory.hypotheses].map(([key, h]) => [key, { status: h.status,
			...(h.check && !claimCompileErrors.has(`${key}@${claimVersion(h.check)}`) ? { version: claimVersion(h.check) } : {}) }]));
		return promotionView(hypotheses, claimRows, claimControls, rulesText());
	}

	/**
	 * Run each qualifying check once on mismatched transitions (the grid before one move with the grid after another),
	 * so a check that holds whatever happened is not offered as a rule. Recorded as one claim_checks.jsonl row per check.
	 */
	async function refreshClaimControls(signal?: AbortSignal): Promise<void> {
		const due = promotion().needControls;
		if (!due.length) return;
		const { segments, sources } = controlSegments(trajectory.map((row) => row.n), grids);
		const sourceOf = new Map(trajectory.map((row) => [row.n, row]));
		const transitions = Object.fromEntries([...sources].map(([id, n]) => {
			const row = sourceOf.get(n)!;
			return [String(id), { action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
				level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed }];
		}));
		const claims = claimChecks().filter((claim) => due.some((d) => d.key === claim.key && d.version === claim.version));
		// Too little history to pair moves: decided again once there is.
		if (!segments.length || !claims.length) return;
		const result = await runGuest({ mode: "claims", strict: true, claims: claims.map(({ key, source }) => ({ key, source })), segments, transitions }, signal);
		if (!result.ok) { logError("claims:controls", new Error(guestFailure(result))); return; }
		const value = result.value as Record<string, { results: Array<[number, ClaimValue, string?]>; error: string | null }>;
		for (const claim of claims) {
			const out = value[claim.key];
			if (!out || out.error) continue;
			const record: ControlRecord = { key: claim.key, version: claim.version, results: out.results.map(([, verdict]) => verdict) };
			claimControls.set(`${claim.key}@${claim.version}`, record);
			append("claim_checks.jsonl", { ...record, control: true, pairs: [...sources].map(([id, n]) => [n, id]) });
		}
	}

	/** The rules' checks on the latest move, for the working set: a rule is seen being kept, or failing, as play goes on. */
	function ruleChecksText(): string {
		const keys = citedKeys(rulesText());
		if (!keys.length || !trajectory.length) return "";
		const n = trajectory.length;
		const versions = new Map(claimChecks().map((claim) => [claim.key, claim.version]));
		const latest = keys.map((key) => [key, claimRows.find((row) => row.key === key && row.version === versions.get(key) && row.n === n)?.result] as const);
		const failed = latest.filter(([, result]) => result === false).map(([key]) => key);
		const held = latest.filter(([, result]) => result === true).length;
		// A cited key that names no hypothesis is not the same as one without a check (H2c).
		const missing = keys.filter((key) => !memory.hypotheses.has(key));
		const unchecked = keys.filter((key) => memory.hypotheses.has(key) && !versions.has(key));
		return `RULE CHECKS (${RULES_PATH}) on #${n}: ${held} held, ${failed.length ? `failed: ${failed.join(", ")}` : "0 failed"}` +
			(missing.length ? `; cites ${missing.join(", ")}, which ${missing.length > 1 ? "do" : "does"} not exist` : "") +
			(unchecked.length ? `; no check behind ${unchecked.join(", ")}` : "");
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
    if (nativeRuntime && toolsReady) {
      nativeRuntime.register();
      // One fixed list for the whole decision: the built-in tools and the agent's saved tools. ls and grep are left
      // out (python lists and searches the workspace, and every schema is resent on each call).
      pi.setActiveTools([...(run.consolidating ? [] : ['arc_action']), 'memory', 'python', 'read', 'write', 'edit', ...(consultTool ? ['consult'] : []),
        ...(criticOn && refineTool ? ['refine'] : []), ...nativeRuntime.toolNames(), ...(skills.size ? ['run_skill'] : [])]);
      return;
    }
		const names = [...skills.keys()].sort();
		if (names.length && names.join(",") !== boundNames) {
			registerRunSkill(names);
			boundNames = names.join(",");
		}
		// pi.setActiveTools is unavailable while the extension loads.
		if (!toolsReady) return;
		const tools = (base ?? pi.getActiveTools()).filter((name) => name !== "run_skill");
		if (names.length) tools.push("run_skill");
    if (workspace) for (const name of ['read', 'write', 'edit', 'ls', 'grep']) if (!tools.includes(name)) tools.push(name);
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
		const refiner = readRows("refiner.jsonl").filter((row) => row.kind === "start");
		refineNotes = refiner.map((row) => ({ at: Number(row.at) || 0, level: 0, triggers: row.triggers ?? [], lines: [], dropped: [] }));
		lastRefineAt = Math.max(0, ...refineNotes.map((note) => note.at));
		// After a restart, events before the restart are not refined again, except a level change that no refinement has
		// started since: a fork from a level's snapshot starts right after the decision that completed the level.
		const lastLevel = trajectory.findLast((row) => row.level_changed);
		refinedThrough = lastLevel && !refiner.some((row) => Number(row.at) >= lastLevel.n) ? lastLevel.n - 1 : trajectory.length;
		// When the agent was told of each edit, and the next experiment still pinned when the run stopped (P3).
		const rows = readRows("refiner.jsonl");
		toldAt.clear();
		for (const row of rows) if (row.kind === "told" && row.id !== undefined) toldAt.set(String(row.id), Number(row.at) || 0);
		const last = rows.filter((row) => row.kind === "next").at(-1);
		pin = last && !rows.some((row) => row.kind === "next_done" && row.edit === last.edit)
			? { edit: String(last.edit), move: last.move, kind: String(last.move_kind), line: String(last.line), within: Number(last.within) || NEXT_WITHIN,
				level: Number(last.level) || 0, at: Number(last.at) || 0, nagged: 0 } : undefined;
	}

	/** Every state the agent sees is kept: skills read it as state.history, and the ledger reads it when enabled. */
	function recordState(n: number, grid: number[][] | undefined): void {
    if (workspace) storeObservation(workspace, observation, n);
    if (workspace && grid) {
      workspace.runtimeWrite(`data/frames/${n}.json`, JSON.stringify({ n, grid }) + '\n');
      workspace.runtimeWrite('data/trajectory.jsonl', trajectory.map(row => JSON.stringify(reportedAction(row, true))).join('\n') + '\n');
    }
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
					recent_actions: trajectory.slice(Math.max(0, n - RECENT_ACTIONS), n).map((row) => reportedAction(row, native)), ...memoryForSkills(memory),
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
	const decisionLine = (row: ActionRow) => (native ? actionLine(row) : actionLine(row).replace(" → ", ` → changed_cells=${row.changed_cells ?? "?"} `))
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
		const create = (onResponse?:any) => ctx.modelRegistry.streamSimple(ctx.model!, {
			systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }],
		} as any, { signal: options.signal, maxTokens: options.maxTokens,...(onResponse?{onResponse}:{}) } as any);
		return native ? await requestTrace.run(systemPrompt.startsWith(REFINER_SYSTEM) ? 'refiner' : systemPrompt === CRITIC_SYSTEM || systemPrompt === NATIVE_CRITIC_SYSTEM ? 'critic' : 'analyst', decision, create) : await create().result();
	}

	async function askCritic(ctx: ExtensionContext, dossier: string): Promise<{ reply: any; answer: string }> {
		// No reasoning for this short side call: with the parent's level passed on (round 5, "high"), every critic
		// call spent its whole output budget on reasoning and stopped at length with no text (4 of 4 in tu93).
		const reply: any = await sideCall(ctx, native ? NATIVE_CRITIC_SYSTEM : CRITIC_SYSTEM, [{ type: "text", text: dossier }],
			{ signal: AbortSignal.timeout(criticConfig.timeoutMs), maxTokens: criticConfig.maxOutputTokens });
		appendUsage("critic", reply);
		const answer = (reply.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");
		return { reply, answer };
	}

	async function runCritic(ctx: ExtensionContext | undefined, state: LedgerState, triggers: string[], previous: number): Promise<void> {
		if (!ctx?.model) return;
		const dossierFor = (recent: number, withState: boolean) => buildDossier({
			state, triggers, memoryText: memoryText(),
			...(native ? {evidenceLines:trajectory.slice(-2).map(row => {
				const before=grids.get(row.n-1), after=grids.get(row.n);
				const changes=before && after ? gridChanges(before,after) : undefined;
				return `#${row.n}: actual changed_cells=${row.changed_cells ?? '?'}; ` +
					(changes ? JSON.stringify(changes.slice(0,40)) + (changes.length>40 ? ' [partial; omitted changes]' : '') : 'grids unavailable') +
					`; exact frames data/frames/${row.n-1}.json and data/frames/${row.n}.json`;
			})} : {}),
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

	/**
	 * The refinement pipeline (native mode; arc_thin_refiner.ts). Events start one background side call that makes one
	 * harness edit; it replaces the advisory critic and the reuse-gap review, never delays a decision, and the agent is
	 * told once what changed. Events: the failures the critic used to review, a level change, repeated python work, a
	 * level played without any goal test, reasoning spent locating cells with no view tool, REFINE_EVERY actions
	 * without a refinement, and the agent's own refine(focus).
	 */
	const REFINE_EVERY = envNumber("ARC_REFINE_EVERY", 15);
	const GOAL_TEST_AFTER = envNumber("ARC_REFINE_GOAL_TEST_AFTER", 12);
	/** A fact rewritten this often while no hypothesis has a check: the agent restates a belief instead of testing it. */
	const BELIEF_REWRITES = envNumber("ARC_REFINE_BELIEF_REWRITES", 3);
	const UNCHECKED_AFTER = envNumber("ARC_REFINE_UNCHECKED_AFTER", 8);
	/** Decided moves a check needs before it contests its hypothesis (H2a); 0 leaves check results out of status. */
	const CHECK_CONTEST_MIN = /^\d+$/.test(process.env.ARC_CHECK_CONTEST_MIN ?? "") ? Number(process.env.ARC_CHECK_CONTEST_MIN) : CONTEST_MIN_DECIDED;
	/** A refinement writes a rival for a hypothesis that holds unchallenged (self-evolve loop, 2026-10-19); 0: off. */
	const RIVAL_EVENTS = process.env.ARC_REFINE_RIVALS !== "0";
	/** Refinements' cost ceiling as a share of the agent's budget tokens (Continual Harness spends about 5%). */
	const REFINER_SHARE = envNumber("ARC_REFINE_MAX_SHARE", 0.1);
	/** Below this many refinement tokens the share is not applied: early in a run one call is a large share. */
	const REFINER_MIN_TOKENS = envNumber("ARC_REFINE_MIN_TOKENS", 20_000);
	/**
	 * The refinement ledger (r04; from claude/refiner-ledger-20261016): each refinement is given what became of the
	 * refinements' latest edits, and an edit may carry an expectation that the runtime checks on the moves that follow.
	 * ARC_REFINE_LEDGER=0 restores the earlier input and charter.
	 */
	const REFINE_LEDGER = process.env.ARC_REFINE_LEDGER !== "0";
	const LEDGER_EDITS = envNumber("ARC_REFINE_LEDGER_EDITS", 5);
	/**
	 * P1-P3 (docs/plans/2026-10-19-coverage-attempts-delivery.md): rival, contest and repeated-failure events carry the kinds
	 * of moves the level has seen and ask for their test move as a move; a rival's must be of a kind the level has not
	 * seen. The move becomes the first item of the strategy's next experiment until it is played, and the comparison of
	 * rivals is shown when it changes. ARC_REFINE_COVERAGE=0 turns all of it off.
	 */
	const COVERAGE = native && process.env.ARC_REFINE_COVERAGE !== "0";
	/** Actions the agent has to play a pinned move once told of it (an EXPECT's within, up to 30, overrides). */
	const NEXT_WITHIN = envNumber("ARC_REFINE_NEXT_WITHIN", 10);
	/** A pinned move is dropped after PIN_EXPIRES times its window; its overdue line is added to at most PIN_NAGS receipts. */
	const PIN_EXPIRES = 3;
	const PIN_NAGS = 3;
	/**
	 * A view a refinement wrote that raised on this many states in a row goes back to its newest version that showed
	 * something, or under _off/ when none did (restoreBrokenViews); 0: off.
	 */
	const VIEW_RESTORE_STATES = envNumber("ARC_REFINE_VIEW_RESTORE", 6);
	/** The next experiment a coverage event delivered: the move, its kind when pinned, and the strategy line carrying it. */
	type Pin = { edit: string; move: Move; kind: string; line: string; within: number; level: number; at: number; nagged: number };
	let pin: Pin | undefined;
	/** The action count at which the agent was told of each edit (the decision that showed its notice). */
	const toldAt = new Map<string, number>();
	/** H3a lines already shown, by question: each is shown when new and again only when it changes. */
	const shownRivals = new Map<string, string>();
	let refineNotes: CriticNote[] = [];
	let refinedThrough = 0;
	let lastRefineAt = 0;
	const refinedFamilies = new Set<string>();
	let goalTestAskedAt = -1;
	let viewAskedLevel = -1;
	let refinerInFlight: Promise<void> | undefined;
	/** Refinement outcomes not yet shown, with the id of the edit each reports (the ledger follows it from there). */
	let refinerNotices: Array<{ text: string; editId?: string }> = [];
	/** Edits made so far in this run (and the source run of a fork): the next edit's id is e<count + 1>. */
	let refinerEdits = readRows("refiner.jsonl").filter((row) => row.kind === "edit").length;
	/** Files a refinement wrote: later refinements may rewrite them; other existing files belong to the agent. */
	const refinedPaths = new Set<string>(readRows("refiner.jsonl").filter((row) => row.kind === "edit" && typeof row.path === "string").map((row) => row.path));
	/** path@version of the versions refinements wrote, and those the runtime restored for them (restoreBrokenViews). */
	const refinedVersions = new Set<string>(readRows("refiner.jsonl").filter((row) => (row.kind === "edit" || row.kind === "view_restored")
		&& row.loaded !== false && typeof row.path === "string" && row.version !== undefined).map((row) => `${row.path}@${row.version}`));
	const ownedByRefinement = (path: string) => path === STRATEGY_PATH || path === RULES_PATH || refinedPaths.has(path) || !workspace!.files().includes(path);
	const refinerActive = () => Boolean(native && criticOn && nativeRuntime && binder);
	function readStrategy(): { text: string; version?: number } | undefined {
		if (!workspace) return undefined;
		try { return { text: workspace.read(STRATEGY_PATH), version: binder?.versionMap()[STRATEGY_PATH] }; }
		catch { return undefined; }
	}

	// ---------------------------------------------------------------- coverage events and the pinned next experiment

	/** The kinds of moves made on the current level and those it has (almost) not seen (P1), as events carry them. */
	function gapsNow(): Gaps & { cov: ReturnType<typeof coverage>; available: string[] } {
		const available = availableActions(observation);
		const cov = coverage(trajectory, moveFacts);
		return { cov, available, text: coverageText(cov, available), rare: rareKinds(cov, available) };
	}

	/** How many moves of `kind` the level has seen. */
	const kindCount = (cov: ReturnType<typeof coverage>, kind: string) => {
		const [action, region] = kind.split(":");
		return region ? cov.clicks[region as keyof typeof cov.clicks] ?? 0 : cov.actions.get(action)?.played ?? 0;
	};

	/**
	 * Why a coverage event's HYPOTHESIS answer cannot be used as written: its predicts names no move in a form the runtime
	 * can classify, a click without its cell, an action not available, or (rival events) a kind of move the level has
	 * already seen while other kinds are missing. The answer goes back to the refinement once with the reason.
	 */
	function moveProblem(id: string, predicts: string | undefined): string | undefined {
		const move = parseMove(predicts ?? "");
		if (!move) return `its predicts names no move: write the move that tests it as ${MOVE_FORM}`;
		const gaps = gapsNow();
		if (gaps.available.length && !gaps.available.includes(move.action))
			return `${move.action} is not available (available now: ${gaps.available.join(", ")}): write an available move as ${MOVE_FORM}`;
		const { kind, rare, needsXY } = classify(move, gaps.cov, gaps.available);
		if (needsXY) return `${move.action} needs the cell it acts on: write it as ${move.action}(x,y)`;
		if (id.startsWith("rival:") && gaps.rare.length && !rare)
			return `${moveText(move)} is ${kindText(kind)}, a kind of move this level has seen ${kindCount(gaps.cov, kind)} times; the rival must ` +
				`disagree with it on a kind the level has not seen: ${gaps.rare.map(kindText).join("; ")}`;
		return undefined;
	}

	/** Whether move `row` is the pinned move's kind (a click unplaced when pinned: that same cell). */
	const playsPin = (row: ActionRow, kinds: Map<number, string>, p: Pick<Pin, "move" | "kind">) => p.kind.endsWith(":unplaced")
		? row.action === p.move.action && row.x === p.move.x && row.y === p.move.y : kinds.get(row.n) === p.kind;

	/** When the agent was told of the pinned move, and the first move of its kind played since. */
	function pinStatus(current: Pin): { told?: number; met?: number } {
		const told = toldAt.get(current.edit);
		if (told === undefined) return {};
		const kinds = moveKinds(trajectory, moveFacts);
		return { told, met: trajectory.find((row) => row.n > told && playsPin(row, kinds, current))?.n };
	}

	/** The strategy written by the runtime (the pinned line added or taken out), versioned like a refinement's edit. */
	async function writeStrategy(content: string): Promise<void> {
		workspace!.mutate({ op: "write", path: STRATEGY_PATH, content: content.endsWith("\n") ? content : content + "\n" });
		refinedPaths.add(STRATEGY_PATH);
		nativeRuntime!.noteSave(STRATEGY_PATH, await binder!.save(STRATEGY_PATH, currentLevel()));
	}

	/**
	 * Pin `move` (P3): record it and return its strategy line, which writers put first in the next experiment (pinned()).
	 * An earlier pinned move is replaced.
	 */
	function setPin(editId: string, move: Move, kind: string, why: string, within: number, rare?: boolean): Pin | undefined {
		const old = pin;
		if (old) append("refiner.jsonl", { kind: "next_done", edit: old.edit, outcome: "replaced", at: trajectory.length });
		const reason = why.replace(/\s+/g, " ").trim();
		const line = `- First: ${moveText(move)}${kind.endsWith(":unplaced") ? "" : `, ${kindText(kind)}`}` +
			(reason ? `; ${reason.length > 240 ? `${reason.slice(0, 239)}…` : reason}` : "");
		pin = { edit: editId, move, kind, line, within, level: currentLevel(), at: trajectory.length, nagged: 0 };
		append("refiner.jsonl", { kind: "next", edit: editId, move, move_kind: kind, ...(rare !== undefined ? { rare } : {}), line, within,
			level: pin.level, at: pin.at });
		return old;
	}

	/** A strategy text with the pinned line first in its next experiment, and a replaced pin's line taken out. */
	function pinned(content: string, old?: Pin): string {
		const text = old ? withoutNextItem(content, old.line) : content;
		return pin && !text.includes(pin.line) ? withNextItem(text, pin.line) : text;
	}

	/** Drop the pinned move and its strategy line: it was played, its level ended, or its time ran out. */
	async function releasePin(outcome: "met" | "level" | "expired", n?: number): Promise<void> {
		if (!pin) return;
		const done = pin;
		pin = undefined;
		append("refiner.jsonl", { kind: "next_done", edit: done.edit, outcome, at: trajectory.length, ...(n !== undefined ? { n } : {}) });
		const strategy = readStrategy()?.text;
		if (strategy?.includes(done.line)) await writeStrategy(withoutNextItem(strategy, done.line));
	}

	/** At a decision's start, before the active prompts are bound: release the pinned move once it is settled. */
	async function settlePin(): Promise<void> {
		if (!pin || !workspace) return;
		if (currentLevel() !== pin.level) return releasePin("level");
		const { told, met } = pinStatus(pin);
		if (met !== undefined) return releasePin("met", met);
		if (told !== undefined && trajectory.length - told >= PIN_EXPIRES * pin.within) return releasePin("expired");
	}

	/** The receipt's line while the pinned move is overdue (told at least its window ago, not played), at most PIN_NAGS times. */
	function pinNag(): string {
		if (!pin || pin.nagged >= PIN_NAGS || currentLevel() !== pin.level) return "";
		const { told, met } = pinStatus(pin);
		if (told === undefined || met !== undefined || trajectory.length - told < pin.within) return "";
		pin.nagged += 1;
		return `(The strategy's next experiment, ${moveText(pin.move)}${pin.kind.endsWith(":unplaced") ? "" : ` (${kindText(pin.kind)})`}, ` +
			`has not been played in the ${trajectory.length - told} actions since it was set.)`;
	}

	/**
	 * P2: the level's failed attempts since the agent last changed a hypothesis about what its actions do, when there are
	 * REPEAT_ATTEMPTS of them; once per level and model. The model in play is the agent's live hypothesis whose check
	 * decided most moves of those attempts.
	 */
	const repeatTargets = new Map<string, string>();
	function repeatDue(gaps: Gaps | undefined): [string, string] | undefined {
		const level = currentLevel();
		const changes = modelChanges(readRows("memory.jsonl"));
		const failed = failedUnderOneModel(attempts(trajectory), changes, level);
		if (failed.length < REPEAT_ATTEMPTS) return undefined;
		const id = `repeat:${level}:${changes.reduce((a, b) => Math.max(a, b), -1)}`;
		const inside = (n: number) => failed.some((attempt: Attempt) => n >= attempt.start && n <= attempt.end);
		const versions = checkedHypotheses();
		const target = [...versions].filter(([key, h]) => h.version && h.status !== "rejected" && !isGoalHypothesis(key, h.question)).map(([key, h]) => {
			const decided = claimRows.filter((row) => row.key === key && row.version === h.version && inside(row.n) && (row.result === true || row.result === false));
			return { key, question: h.question, decided: decided.length, holds: decided.filter((row) => row.result === true).length };
		}).filter((t) => t.decided > 0).sort((a, b) => b.decided - a.decided)[0];
		if (target) repeatTargets.set(id, target.key);
		const budget = trajectory.at(-1)?.budget;
		const left = typeof budget?.maximum === "number" && typeof budget?.used === "number" ? Math.max(0, budget.maximum - budget.used) : null;
		return [id, repeatEvent(failed, left, target, gaps, MOVE_FORM)];
	}

	function refinerTriggers(state: LedgerState): { triggers: string[]; samples: string[] } {
		const triggers: string[] = [];
		let samples: string[] = [];
		triggers.push(...criticTriggers(state, refineNotes, refinedThrough, memory.hypotheses.size, criticConfig, touchedKeys).triggers);
		for (const row of trajectory.slice(refinedThrough)) if (row.level_changed) triggers.push(`level ${row.levels_completed} reached at #${row.n}`);
		for (const family of nativeRuntime?.repeatedWork(currentLevel()) ?? []) {
			if (refinedFamilies.has(family.key)) continue;
			refinedFamilies.add(family.key);
			// The agent calls saved tools seldom (3 calls in 9 su15 runs, 2026-10-19) but reads what a view shows.
			triggers.push((family.covered ? `\`${family.gist}\` retyped ${family.calls} times although ${family.covered} covers it`
				: `python computation \`${family.gist}\` redone ${family.calls} times`) +
				"; if it reads the state, a view ('# view: on') shows its result at every decision, while a tool waits to be called");
			samples = family.samples;
			break;
		}
		// No step on this level has predicted a level change: the moves explore, none tests how the level is won.
		const levelStart = trajectory.findLastIndex((row) => row.level_changed) + 1;
		const onLevel = trajectory.slice(levelStart);
		if (onLevel.length >= GOAL_TEST_AFTER && !onLevel.some((row) => row.predict?.level_changed === true)
			&& (goalTestAskedAt < levelStart || trajectory.length - goalTestAskedAt >= 2 * GOAL_TEST_AFTER)) {
			goalTestAskedAt = trajectory.length;
			triggers.push(`${onLevel.length} actions on this level and no step predicted a level change (no goal test yet)`);
		}
		// Reasoning spent reading positions off the grid, with no view tool reporting them.
		const share = lastDecisionCost?.coordinateShare ?? 0;
		if (share >= 0.3 && (lastDecisionCost?.reasoning ?? 0) >= 3000 && viewAskedLevel !== currentLevel()
			&& !binder!.active().some((c) => c.kind === "tool" && c.view)) {
			viewAskedLevel = currentLevel();
			triggers.push(`about ${Math.round(100 * share)}% of the agent's reasoning sentences in its last decision located cells or coordinates, and no view tool reports them`);
		}
		triggers.push(...promotionEvents(refinerOverBudget()));
		if (!triggers.length && trajectory.length - lastRefineAt >= REFINE_EVERY) triggers.push(`${trajectory.length - lastRefineAt} actions since the last refinement`);
		refinedThrough = trajectory.length;
		// Over the cost ceiling only a level change and a rule in dispute still start a refinement (the agent's own
		// refine(focus) is not counted here: it starts one directly).
		if (refinerOverBudget()) {
			const kept = triggers.filter((t) => /^level \d+ reached|the rule is in dispute/.test(t));
			if (kept.length < triggers.length) append("refiner.jsonl", { kind: "over_budget", at: trajectory.length, dropped: triggers.filter((t) => !kept.includes(t)),
				refiner_tokens: spentTokens.get("refiner") ?? 0, agent_tokens: spentTokens.get("agent") ?? 0 });
			return { triggers: kept, samples };
		}
		return { triggers, samples };
	}

	/** Refinements have used more than REFINER_SHARE of the agent's own budget tokens (and more than a few calls' worth). */
	const refinerOverBudget = () => (spentTokens.get("refiner") ?? 0) > Math.max(REFINER_MIN_TOKENS, REFINER_SHARE * (spentTokens.get("agent") ?? 0));

	/**
	 * The promotion path's events (docs/plans/2026-10-14-knowledge-promotion.md): a rule whose check failed, a check
	 * ready to become a rule, a belief restated in memory with no check behind it, a view that shows nothing, an
	 * over-long rules prompt. A refinement makes one edit, so one event is raised per refinement, most urgent first;
	 * each is raised once. Counting is the runtime's; the edit is the refinement's.
	 */
	const promotionAsked = new Set<string>();
	let uncheckedAskedAt = -1;
	function promotionEvents(urgentOnly = false): string[] {
		const due: Array<[string, string]> = [];
		const view = promotion();
		const findings = promotionTriggers(view);
		// The kinds of moves the level has seen (P1), carried by the contest, repeated-failure and rival events.
		const gaps = COVERAGE && !urgentOnly ? gapsNow() : undefined;
		// A rule in dispute is raised once per check version and level, as a contested check is once per version. Raised at
		// every new failing move, a rule scoped to level 1 whose check failed on every level-2 move started 18 refinements in
		// 27 actions of su15-lr-p13-q38 (2026-10-20), each rewriting the rules prompt and so the system prompt.
		view.refuted.forEach((r, i) => {
			const check = memory.hypotheses.get(r.key)?.check;
			const version = check ? claimVersion(check) : "";
			const level = claimRows.find((row) => row.key === r.key && row.version === version && row.n === r.failing.at(-1))?.level ?? currentLevel();
			due.push([`refuted:${r.key}@${version}:${level}`, findings[view.candidates.length + i]]);
		});
		// A hypothesis its own check contests (H2a), once per check version: only the agent rewrites it; a refinement can
		// add a narrower one or set the next experiment.
		if (!urgentOnly) due.push(...contestEvents([...memory.hypotheses].flatMap(([key, h]) => {
			const contest = h.status === "contested" ? currentContest(key, h) : undefined;
			return contest ? [{ key, version: claimVersion(h.check!), contest, ownedByRefinement: refinementOwned(key) }] : [];
		}), view.refuted.map((r) => r.key), gaps));
		// A rule citing a hypothesis that does not exist (H2c): only refinements write the rules prompt.
		if (!urgentOnly) for (const key of view.missing)
			due.push([`missing:${key}`, `${RULES_PATH} cites ${key}, which does not exist: write it as a HYPOTHESIS with a check, or take the line out`]);
		// Attempts on this level keep failing under one model (P2): a rival control model and its test move.
		const repeat = gaps ? repeatDue(gaps) : undefined;
		if (repeat) due.push(repeat);
		// A hypothesis that holds with no rival beside it gets one before it can become a rule (ARC_REFINE_RIVALS=0: off).
		if (!urgentOnly && RIVAL_EVENTS) due.push(...rivalEvents(unchallenged(checkedHypotheses(), claimRows), gaps, kindText));
		(urgentOnly ? [] : view.candidates).forEach((c, i) => due.push([`promote:${c.key}@${c.version}`, findings[i]]));
		if (!urgentOnly && ![...memory.hypotheses.values()].some((h) => h.check)) {
			const touches = new Map<string, number>();
			for (const t of memoryTouches) if (memory.facts.has(t.key)) touches.set(t.key, (touches.get(t.key) ?? 0) + 1);
			const churned = [...touches].filter(([, n]) => n >= BELIEF_REWRITES).sort((a, b) => b[1] - a[1])[0];
			if (churned) due.push([`churn:${churned[0]}`, `memory ${churned[0]} was rewritten ${churned[1]} times and no hypothesis carries a check: ` +
				"turn the belief it restates most into a HYPOTHESIS with a check"]);
			else if (trajectory.length >= UNCHECKED_AFTER && (uncheckedAskedAt < 0 || trajectory.length - uncheckedAskedAt >= 2 * UNCHECKED_AFTER))
				due.push([`unchecked:${trajectory.length}`, `${trajectory.length} actions and no hypothesis carries a check: turn a belief the agent has stated into a HYPOTHESIS with a check`]);
		}
		for (const broken of urgentOnly ? [] : nativeRuntime?.emptyViews() ?? [])
			due.push([`view:${broken.path}@${broken.version}`, `view ${broken.path} v${broken.version} showed nothing on states ${broken.states.map((n) => `#${n}`).join(", ")}` +
				(broken.error ? ` (${broken.error.slice(0, 120)})` : "") + ": fix it so it returns what it reports, or retire it"]);
		if (view.overCap && !urgentOnly) due.push([`cap:${rulesText().length}`, findings.at(-1)!]);
		const next = due.find(([id]) => !promotionAsked.has(id));
		if (!next) return [];
		promotionAsked.add(next[0]);
		pendingPromotion = next[0];
		if (next[0].startsWith("unchecked:")) uncheckedAskedAt = trajectory.length;
		return [next[1]];
	}
	/** The promotion event in the refinement now running, to raise again if its one edit went elsewhere. */
	let pendingPromotion: string | undefined;
	const promotionRetries = new Map<string, number>();
	/**
	 * The hypothesis an event's answer is a rival of, sharing its question so H3a compares them: "rival:hyp.x@<version>"
	 * names hyp.x; a repeated-failure event names the model in play (repeatTargets).
	 */
	const rivalTarget = (id: string | undefined) => id?.startsWith("rival:") ? id.slice(6).replace(/@[^@]*$/, "")
		: id?.startsWith("repeat:") ? repeatTargets.get(id) : undefined;
	/**
	 * pr-02 (2026-10-14): "no hypothesis carries a check" came with another trigger, the refinement wrote a view for the
	 * other, and the event counted as raised. An event the edit did not address is raised again (twice at most).
	 */
	function settlePromotion(id: string | undefined, edit: { kind: string; path?: string; key?: string }): void {
		if (!id) return;
		const addressed = /^(churn|unchecked):/.test(id) ? edit.kind === "hypothesis"
			: id.startsWith("rival:") ? edit.kind === "hypothesis" && edit.key !== rivalTarget(id)
			: /^(contested|repeat):/.test(id) ? edit.kind === "hypothesis" || (edit.kind === "file" && edit.path === STRATEGY_PATH)
			: id.startsWith("missing:") ? edit.kind === "hypothesis" || (edit.kind === "file" && edit.path === RULES_PATH)
			: /^(promote|refuted|cap):/.test(id) ? edit.kind === "file" && edit.path === RULES_PATH
			: id.startsWith("view:") ? edit.kind === "file" && edit.path === id.slice(5).replace(/@\d+$/, "") : true;
		const retryKey = id.startsWith("unchecked:") ? "unchecked" : id;
		const tries = promotionRetries.get(retryKey) ?? 0;
		if (addressed || tries >= 2) return;
		promotionRetries.set(retryKey, tries + 1);
		promotionAsked.delete(id);
		if (id.startsWith("unchecked:")) uncheckedAskedAt = -1;
	}

	/**
	 * A view a refinement wrote that keeps raising goes back to its newest version that showed something, or is moved under
	 * _off/ when no version did; the agent is told. In su15-p13-q38-1 tools/elements.py v3 raised on all 86 remaining states:
	 * the refinement asked to fix it returned the same file, and the event is raised once per version. The runtime only
	 * undoes refinements' output; a view the agent wrote stays the agent's, who sees what it shows.
	 */
	const restoredViews = new Set<string>();
	async function restoreBrokenViews(): Promise<void> {
		if (!VIEW_RESTORE_STATES || !nativeRuntime || !workspace || !binder) return;
		for (const broken of nativeRuntime.emptyViews()) {
			const key = `${broken.path}@${broken.version}`;
			if (broken.failed < VIEW_RESTORE_STATES || !refinedVersions.has(key) || restoredViews.has(key)) continue;
			restoredViews.add(key);
			const why = `view ${broken.path} v${broken.version}, a refinement's, raised on ${broken.failed} states in a row` +
				(broken.error ? ` (${broken.error.replace(/\s+/g, " ").slice(0, 120)})` : "");
			const back = nativeRuntime.lastShowingVersion(broken.path, broken.version);
			const source = back === undefined ? undefined : binder.sourceOf(broken.path, back);
			if (source !== undefined) {
				// The same content failing again is not the view's doing (the sandbox, say): nothing to restore.
				if (workspace.read(broken.path) === source) continue;
				workspace.mutate({ op: "write", path: broken.path, content: source });
				const receipt = await binder.save(broken.path, currentLevel());
				nativeRuntime.noteSave(broken.path, receipt);
				const version = binder.versionMap()[broken.path];
				if (version !== undefined) refinedVersions.add(`${broken.path}@${version}`);
				append("refiner.jsonl", { kind: "view_restored", at: trajectory.length, decision, path: broken.path, from: broken.version, to: back, version,
					states: broken.states.slice(-VIEW_RESTORE_STATES), error: broken.error?.slice(0, 300), receipt });
				refinerNotices.push({ text: `HARNESS UPDATE by the runtime after #${trajectory.length}: ${why}; v${back}, its newest version that ` +
					`showed something, is back as v${version}. Revise, restore or delete it like your own edits.` });
			} else {
				const destination = `_off/${broken.path}`;
				workspace.mutate({ op: "move", path: broken.path, destination });
				append("refiner.jsonl", { kind: "view_retired", at: trajectory.length, decision, path: broken.path, version: broken.version, destination,
					states: broken.states.slice(-VIEW_RESTORE_STATES), error: broken.error?.slice(0, 300) });
				refinerNotices.push({ text: `HARNESS UPDATE by the runtime after #${trajectory.length}: ${why}, and no version of it showed anything; ` +
					`it is moved to ${destination}.` });
			}
		}
	}

	/** The agent's own guidance for refinements: the body of prompts/refine.md, whether or not that prompt is active. */
	function refineGuide(): string {
		if (!workspace) return "";
		try { return workspace.read(REFINE_GUIDE_PATH).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim().slice(0, 1500); }
		catch { return ""; }
	}

	/** The body of the agent's prompts/lessons.md (its review of the last completed level), for refinements to read. */
	function lessonsText(): string {
		if (!workspace) return "";
		try { return workspace.read(LESSONS_PATH).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim().slice(0, 2 * LESSONS_CHARS); }
		catch { return ""; }
	}

	/**
	 * A refinement started by a level change writes each rule line it adds to the rules prompt for the level that showed it
	 * ("- Level 1: …"). In su15-cb-q38-1 (2026-10-19) the refinement at the first level change added "Level completes when
	 * the blue square reaches/overlaps the red-circle region" as a rule for every level; it was the only win condition the
	 * agent tested in the second level's first 30 actions. Why such an answer goes back once, or undefined.
	 */
	function unscopedRules(edit: ReturnType<typeof parseRefinerReply>, triggers: string[]): string | undefined {
		if (edit.kind !== "file" || edit.path !== RULES_PATH || !triggers.some((trigger) => /^level \d+ reached at #\d+/.test(trigger))) return undefined;
		const before = new Set(rulesText().split(/\r?\n/).map((line) => line.trim()));
		const bare = edit.content.split(/\r?\n/).map((line) => line.trim())
			.filter((line) => /^-\s+\S/.test(line) && !before.has(line) && !/\blevels?\s*\d/i.test(line));
		if (!bare.length) return undefined;
		return `each rule line added after a level change names the level that showed it, as "- Level ${currentLevel()}: <the rule> (hyp.<name>)": ` +
			`a later level is not won or played the same way until its own moves show it; ${bare.length === 1 ? "this line does" : `${bare.length} lines do`} ` +
			`not: "${bare[0].length > 120 ? `${bare[0].slice(0, 119)}…` : bare[0]}"`;
	}

	/** "14 actions (1 RESET, GAME_OVER at #92), no level change" for the recorded actions `rows`. */
	function sinceText(rows: ActionRow[]): string {
		if (!rows.length) return "no actions";
		const resets = rows.filter((row) => row.action === "RESET").length;
		const over = rows.filter((row) => row.state === "GAME_OVER").map((row) => `#${row.n}`);
		const levels = rows.filter((row) => row.level_changed).map((row) => `level ${row.levels_completed} reached at #${row.n}`);
		const marks = [...(resets ? [`${resets} RESET`] : []), ...(over.length ? [`GAME_OVER at ${over.join(", ")}`] : [])];
		return `${rows.length} action${rows.length === 1 ? "" : "s"}${marks.length ? ` (${marks.join(", ")})` : ""}, ${levels.length ? levels.join(", ") : "no level change"}`;
	}

	/** Each expectation's check run on the moves (start, end] (claims mode, strict, as hypothesis checks): the results per id. */
	async function expectationResults(list: Array<{ id: string; source: string; start: number; end: number }>) {
		const out = new Map<string, { results: Array<[number, ClaimValue, string?]>; error?: string }>();
		const ns = new Set<number>();
		for (const item of list) for (let n = item.start + 1; n <= item.end; n += 1) ns.add(n);
		if (!ns.size) return out;
		for (const segments of claimSegments([...ns], grids).batches) {
			const steps = new Set(segments.flatMap((segment) => segment.steps.map((step) => step.n)));
			const result = await runGuest({ mode: "claims", strict: true, claims: list.map(({ id, source }) => ({ key: id, source })), segments, transitions: transitionsFor(steps) });
			if (!result.ok) { logError("refiner:expect", new Error(guestFailure(result))); break; }
			const value = result.value as Record<string, { results: Array<[number, ClaimValue, string?]>; error: string | null }>;
			for (const item of list) {
				const got = value[item.id];
				if (!got) continue;
				const entry = out.get(item.id) ?? { results: [] };
				if (got.error) entry.error = got.error;
				entry.results.push(...got.results.filter(([n]) => n > item.start && n <= item.end));
				out.set(item.id, entry);
			}
		}
		return out;
	}

	/** What an expectation's results say, first move first: met, contradicted, a failing check, or not seen yet. */
	function expectationText(expect: { claim: string; within: number }, moves: number, got?: { results: Array<[number, ClaimValue, string?]>; error?: string }): string {
		const head = `expected within ${expect.within}: "${expect.claim.replace(/\s+/g, " ").slice(0, 160)}" — `;
		if (got?.error) return head + `its check could not run (${got.error.replace(/\s+/g, " ").slice(0, 120)})`;
		const results = [...(got?.results ?? [])].sort((a, b) => a[0] - b[0]);
		const decided = results.find(([, value]) => value === true || value === false);
		const errors = results.filter(([, value]) => value === "error");
		// A check that raises only on the moves it means to judge would otherwise read as "not seen".
		const raised = errors.length ? `its check raised on ${errors.length} of ${results.length} move(s), first at #${errors[0][0]} (${String(errors[0][2] ?? "").replace(/\s+/g, " ").slice(0, 140)})` : "";
		if (decided) return head + `${decided[1] ? "met" : "contradicted"} at #${decided[0]}` + (raised ? `; ${raised}` : "");
		if (raised) return head + raised;
		return head + (moves >= expect.within ? `not seen in ${expect.within} actions` : `not seen yet (${moves} of ${expect.within} actions)`);
	}

	/**
	 * The refinement ledger: the refinements' latest edits, what became of each (still current, rewritten, deleted), what
	 * the agent did since it was told of it (actions, resets, GAME_OVERs, level changes, calls of a refined tool, a view's
	 * output, a refined hypothesis's check results) and whether its expectation was met. The runtime counts; what an
	 * outcome means is left to the refinement.
	 */
	async function editLedgerText(): Promise<string> {
		const rows = readRows("refiner.jsonl");
		const edits = rows.filter((row) => row.kind === "edit").slice(-LEDGER_EDITS).reverse();
		if (!edits.length) return "";
		const toldAt = new Map<string, number>(rows.filter((row) => row.kind === "told").map((row) => [String(row.id), Number(row.at) || 0]));
		const memoryRows = readRows("memory.jsonl");
		const toolRuns = readRows("component_runs.jsonl").filter((row) => row.kind === "tool");
		const versions = binder!.versionMap();
		const views = new Set(binder!.active().filter((c) => c.kind === "tool" && c.view).map((c) => c.path));
		const empty = new Set((nativeRuntime?.emptyViews() ?? []).map((view) => view.path));
		const told = (edit: any) => edit.id === undefined ? undefined : toldAt.get(String(edit.id));
		const horizon = (edit: any) => Math.max(1, Number(edit.expect?.within) || REFINE_EVERY);
		const expectations = edits.filter((edit) => edit.expect?.check && told(edit) !== undefined).map((edit) => ({
			id: String(edit.id), source: String(edit.expect.check), start: told(edit)!, end: Math.min(trajectory.length, told(edit)! + horizon(edit)),
		}));
		const results = await expectationResults(expectations);
		// The kinds of the moves played, for the next experiments edits pinned (P3).
		const kinds = rows.some((row) => row.kind === "next") ? moveKinds(trajectory, moveFacts) : new Map<number, string>();
		const entries = edits.map((edit): LedgerEntry => {
			const from = told(edit);
			const path = String(edit.path ?? "");
			const entry: LedgerEntry = { at: Number(edit.at) || 0, ...(from !== undefined ? { told: from } : {}),
				target: path, why: String(edit.why ?? ""), now: "still current" };
			if (from !== undefined) entry.since = sinceText(trajectory.filter((row) => row.n > from));
			if (path.startsWith("memory:")) {
				const key = path.slice("memory:".length);
				entry.target = `memory ${key}`;
				const later = memoryRows.filter((row) => row.key === key && String(row.t ?? "") > String(edit.t ?? ""));
				entry.now = memoryEditNow(later, memory.facts.has(key) || memory.hypotheses.has(key) || memory.strategies.has(key));
				const hypothesis = memory.hypotheses.get(key);
				if (hypothesis && from !== undefined) {
					// The current check's results only: a rewritten check starts a new count.
					const version = hypothesis.check ? claimVersion(hypothesis.check) : undefined;
					const checks = claimRows.filter((row) => row.key === key && row.version === version && row.n > from);
					const count = (value: ClaimValue) => checks.filter((row) => row.result === value).length;
					entry.use = (!version ? "no check" : checks.length ? `its check since: holds ${count(true)} · fails ${count(false)} · n/a ${count(null)}` +
						(count("error") ? ` · raised ${count("error")}` : "") : "its check has not run on a move since") + `; status ${hypothesis.status}`;
				}
			} else {
				const current = versions[path];
				entry.target = `${path} v${edit.version ?? "?"}`;
				entry.now = current === undefined ? "retired"
					: current === edit.version ? "still current"
					: rows.some((row) => row.kind === "edit" && row.path === path && row.version === current) ? `rewritten by a refinement (now v${current})`
					: `changed by the agent (now v${current})`;
				if (/^tools\/[^/]+\.py$/.test(path) && from !== undefined && current !== undefined) entry.use = views.has(path)
					? (empty.has(path) ? "a view that has shown nothing on its latest states" : "a view, shown at each decision")
					: `called ${toolRuns.filter((row) => row.path === path && Number(row.n) > from).length} time(s) since`;
			}
			if (edit.expect?.claim && from !== undefined) entry.expect = expectationText({ claim: String(edit.expect.claim), within: horizon(edit) },
				trajectory.length - from, results.get(String(edit.id)));
			else if (edit.expect?.claim) entry.expect = `expected within ${horizon(edit)}: "${String(edit.expect.claim).slice(0, 160)}"`;
			else if (edit.expect_error) entry.expect = `its EXPECT was not used: ${String(edit.expect_error)}`;
			// The move this edit made the strategy's next experiment, and whether the agent played its kind since it was told.
			const next = rows.find((row) => row.kind === "next" && row.edit === edit.id);
			if (next) {
				const p = { move: next.move as Move, kind: String(next.move_kind) };
				const played = from === undefined ? undefined : trajectory.find((row) => row.n > from && playsPin(row, kinds, p))?.n;
				const window = Number(next.within) || NEXT_WITHIN;
				const status = from === undefined ? "not shown yet" : played !== undefined ? `played at #${played}`
					: `not played in ${trajectory.length - from} action(s)${trajectory.length - from >= window ? `, past its ${window}` : ""}`;
				entry.expect = [entry.expect, `next experiment ${moveText(p.move)}${p.kind.endsWith(":unplaced") ? "" : ` (${kindText(p.kind)})`}: ${status}`]
					.filter(Boolean).join(" · ");
			}
			return entry;
		});
		return renderEditLedger(entries);
	}

	async function runRefiner(ctx: ExtensionContext, triggers: string[], samples: string[]): Promise<void> {
		const promotionId = pendingPromotion;
		pendingPromotion = undefined;
		// The ledger first: its checks run in the sandbox, and the record below is read after them.
		let ledger = "";
		if (REFINE_LEDGER) {
			try { ledger = await editLedgerText(); }
			catch (error) { logError("refiner:ledger", error); }
		}
		const evidenceAt = trajectory.length, evidenceLevel = currentLevel();
		const sourceVersions = binder!.versionMap();
		const memoryBefore = JSON.stringify(memoryForSkills(memory));
		const sourceBefore = new Map(workspace!.files().filter(path => /^(prompts|tools|lib|skills)\//.test(path)).map(path => [path, workspace!.read(path)]));
		const strategy = readStrategy();
		const saved = binder!.active().filter((c) => /^(tools|observers|lib)\/[^/]+\.py$/.test(c.path));
		const input = [
			`WHY NOW: ${triggers.join("; ")}`,
			// The checks of the hypotheses the triggers name (a contested one, a disputed rule's), to narrow or fix them.
			...((named) => named.length ? [`CHECKS NAMED ABOVE:\n${named.map((key) => `--- ${key}\n${memory.hypotheses.get(key)!.check!.replace(/\s+$/, "")}`).join("\n")}`] : [])(
				[...new Set(triggers.join(" ").match(/\bhyp\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g) ?? [])].filter((key) => memory.hypotheses.get(key)?.check)),
			`ACTIONS SO FAR: ${trajectory.length}; levels completed: ${currentLevel()}; state: ${observation?.state ?? "unknown"}`,
			...(ledger ? [ledger] : []),
			`CURRENT ${STRATEGY_PATH}${strategy ? ` (v${strategy.version ?? "?"})` : " (not written yet)"}:\n${strategy?.text || "(empty)"}`,
			`CURRENT ${RULES_PATH}${rulesText() ? ` (v${binder!.versionMap()[RULES_PATH] ?? "?"})` : " (not written yet)"}:\n${rulesText() || "(empty)"}`,
			...((lessons) => lessons ? [`THE AGENT'S ${LESSONS_PATH} (its own review of the last level it completed; refinements do not edit it):\n${lessons}`] : [])(lessonsText()),
			`AGENT MEMORY:\n${renderMemory(memory, trajectory.length, trajectory.map(actionLabel), components()).slice(0, 4000)}`,
			`SAVED TOOLS:\n${saved.map((c) => `--- ${c.path} v${c.version}${c.view ? " (view)" : ""} ${refinedPaths.has(c.path) ? "REFINED" : "AGENT'S"}: ${c.description || "(no description)"}\n${c.source.slice(0, 1200)}`).join("\n") || "(none)"}`,
			...(samples.length ? [`REPEATED PYTHON (latest calls):\n${samples.map((code) => `---\n${code.slice(0, 1500)}`).join("\n")}`] : []),
			`LAST ACTIONS (with how their predictions scored):\n${trajectory.slice(-20).map(recentLine).join("\n") || "(none yet)"}`,
			`CURRENT STATE:\n${observation ? queryObservation ? observationReference(observation, trajectory.length) : renderState(observation) : "(unavailable)"}`,
      ...(queryObservation ? ['Raw frames are not included in this refinement. Use the supplied memory and action reports; references alone are not pixel evidence.'] : []),
		].join("\n\n");
		const guide = refineGuide();
		const system = REFINER_SYSTEM + (REFINE_LEDGER ? REFINER_LEDGER_SYSTEM : "") + (guide ? `\n\nTHE AGENT'S GUIDANCE FOR REFINEMENTS (${REFINE_GUIDE_PATH}):\n${guide}` : "");
		// Each refinement's input and reply as they were, so refinements can be read and replayed afterwards (L0's and L1's
		// could not: the r03b line did not keep them).
		append("refiner_inputs.jsonl", { at: evidenceAt, decision, triggers, model: ctx.model?.id ?? null, system, input });
		const ask = async (text: string, returned = false) => {
			const reply: any = await sideCall(ctx, system, [{ type: "text", text }], { signal: AbortSignal.timeout(180_000), maxTokens: 6000 });
			appendUsage("refiner", reply);
			const answer: string = (reply.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");
			append("refiner_replies.jsonl", { at: evidenceAt, decision, model: ctx.model?.id ?? null, stop_reason: reply.stopReason ?? null,
				text: answer.slice(0, 20_000), ...(returned ? { returned: true } : {}) });
			return { reply, answer };
		};
		let { reply, answer } = await ask(input);
		let edit = parseRefinerReply(answer);
		/** Why a FILE reply would change nothing: it is the current file again (whitespace at line ends aside). */
		const unchangedFile = (e: typeof edit): string | undefined => {
			if (e.kind !== "file" || !workspace!.files().includes(e.path)) return undefined;
			const normal = (text: string) => text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
			return normal(workspace!.read(e.path)) === normal(e.content)
				? `it is the same as the current ${e.path} v${binder!.versionMap()[e.path] ?? "?"}, so nothing would change` : undefined;
		};
		// A coverage event's answer names its test move in a form the runtime classifies, a rival's of a kind the level has
		// not seen (P1); a FILE answer changes the file (su15-p13-q38-1 #183: the repair of a crashing view returned it as it
		// was, and was recorded and announced as an edit). Otherwise it goes back once with the reason, and the second
		// answer is used as it comes.
		const coverageEvent = COVERAGE && /^(rival|contested|repeat):/.test(promotionId ?? "");
		const problem = (coverageEvent && edit.kind === "hypothesis" ? moveProblem(promotionId!, edit.predicts) : undefined) ?? unchangedFile(edit)
			?? unscopedRules(edit, triggers);
		if (problem) {
			append("refiner.jsonl", { kind: "returned", at: trajectory.length, decision, event: promotionId, why: problem });
			const again = `${input}\n\nYOUR REPLY WAS:\n${answer.trim()}\n\nNOT APPLIED: ${problem}. Reply again with the whole edit in the same form.`;
			append("refiner_inputs.jsonl", { at: evidenceAt, decision, triggers, model: ctx.model?.id ?? null, system, input: again, returned: true });
			({ reply, answer } = await ask(again, true));
			edit = parseRefinerReply(answer);
		}
		/** Pin the move `text` names (P3); the notice's clause for it, or "" when it names none the runtime can place. */
		const pinFrom = (text: string, editId: string, why: string, within?: number): { clause: string; old?: Pin } => {
			const move = parseMove(text);
			if (!move) return { clause: "" };
			const gaps = gapsNow();
			const { kind, rare, needsXY } = classify(move, gaps.cov, gaps.available);
			if (needsXY || (gaps.available.length && !gaps.available.includes(move.action))) return { clause: "" };
			const old = setPin(editId, move, kind, why, Math.min(30, within ?? NEXT_WITHIN), rare);
			return { old, clause: `; its test move ${moveText(move)} is the first item of ${STRATEGY_PATH}'s next experiment` };
		};
		// The promotion event is answered by the edit as applied: a reply that is refused, invalid or discarded as stale
		// leaves it to be raised again (Part H review: a narrower hypothesis under the contested key is refused).
		let applied = false;
		try {
			const at = trajectory.length;
			const base = { at, evidence_at: evidenceAt, evidence_level: evidenceLevel, decision, triggers, stop_reason: reply.stopReason, input_chars: input.length };
			if (currentLevel() !== evidenceLevel || ((edit.kind === 'memory' || edit.kind === 'hypothesis') && JSON.stringify(memoryForSkills(memory)) !== memoryBefore)
				|| (edit.kind === 'file' && (binder!.versionMap()[edit.path] !== sourceVersions[edit.path]
					|| (workspace!.files().includes(edit.path) ? workspace!.read(edit.path) : undefined) !== sourceBefore.get(edit.path)))) {
				append('refiner.jsonl', {kind: 'stale', ...base, why: 'scope or target changed while refinement was running'});
				return;
			}
			// Notices not yet shown are kept: two refinements between decisions are both reported. The event that started the
			// refinement is named by its first 200 characters (coverage events carry the level's counts after them).
			const cause = triggers[0]?.length > 200 ? `${triggers[0].slice(0, 199)}…` : triggers[0];
			const told = (what: string, why: string, editId: string) => refinerNotices.push({ editId, text: `HARNESS UPDATE by a refinement after #${at} (${cause}): ${what}` +
				(why ? ` — ${why}` : "") + ". Revise, restore or delete it like your own edits." });
			// An applied edit gets an id (the ledger follows it from the decision that shows it) and keeps its expectation.
			const ledgerFields = (id: string) => ({ id, ...(edit.kind === "file" || edit.kind === "memory" || edit.kind === "hypothesis"
				? { ...(edit.expect ? { expect: { ...edit.expect, within: edit.expect.within ?? REFINE_EVERY } } : {}),
					...(edit.expectError ? { expect_error: edit.expectError } : {}) } : {}) });
			if (edit.kind === "memory") {
				const plan = planNativeMemoryUpdate(memory, { set: [{ key: edit.key, text: edit.text, confidence: edit.confidence,
					...(edit.replaces ? { replaces: edit.replaces.filter((key) => memory.facts.has(key) || memory.hypotheses.has(key) || memory.strategies.has(key)) } : {}) }] },
					trajectory.length, components());
				if (!plan.ok) { append("refiner.jsonl", { kind: "invalid", ...base, why: plan.error }); return; }
				// The native plan accepts a call in part and reports what it skipped; a set it skips entirely changes nothing.
				// su15-r04-e1 #9: "MEMORY hyp.border_cost" was refused (a hyp. key is a hypothesis's), yet recorded as an edit, the
				// agent was told of an entry that did not exist, and the ledger then said it was "no longer in memory".
				if (!plan.rows.length) { append("refiner.jsonl", { kind: "invalid", ...base, why: plan.receipt }); return; }
				for (const row of plan.rows) { append("memory.jsonl", { ...row, at: trajectory.length, by: "refinement" }); memoryTouches.push({ key: row.key, at: trajectory.length }); }
				applyRows(memory, plan.rows);
				const retired = plan.rows.filter((row: any) => row.deleted).map((row) => row.key);
				const id = `e${++refinerEdits}`;
				append("refiner.jsonl", { kind: "edit", ...base, category: "memory", path: `memory:${edit.key}`, why: edit.why, loaded: true, ...(retired.length ? { replaces: retired } : {}), ...ledgerFields(id) });
				applied = true;
				told(`memory ${edit.key} (conf ${edit.confidence})${retired.length ? `, replacing ${retired.join(", ")}` : ""}`, edit.why, id);
				return;
			}
			// A belief turned into a checked hypothesis goes through the memory component like the agent's own: the runtime
			// then runs its check on every recorded move, which is what promotion counts. A refinement rewrites only
			// hypotheses that refinements wrote (as it rewrites only files refinements wrote); the rewrite starts open.
			if (edit.kind === "hypothesis") {
				const rewrote = memory.hypotheses.has(edit.key);
				if (rewrote && !refinementOwned(edit.key)) { append("refiner.jsonl", { kind: "refused", ...base, path: `memory:${edit.key}`, why: `${edit.key} is the agent's; a refinement adds hypotheses and rewrites only its own` }); return; }
				// A rival answering a rival event shares its target's question as stored, so H3a compares the two on the
				// same moves whatever wording the reply gave the question.
				const target = rivalTarget(promotionId);
				const question = target && target !== edit.key ? memory.hypotheses.get(target)?.question ?? edit.question : edit.question;
				const plan = planNativeMemoryUpdate(memory, { hypotheses: [{ key: edit.key, claim: edit.claim, ...(question ? { question } : {}),
					...(edit.predicts ? { predicts: edit.predicts } : {}), ...(edit.check ? { check: edit.check } : {}), ...(rewrote ? { status: "open" as const } : {}) }] },
					trajectory.length, components());
				if (!plan.ok) { append("refiner.jsonl", { kind: "invalid", ...base, why: plan.error }); return; }
				if (!plan.rows.length) { append("refiner.jsonl", { kind: "invalid", ...base, why: plan.receipt }); return; }
				for (const row of plan.rows) { append("memory.jsonl", { ...row, at: trajectory.length, by: "refinement" }); memoryTouches.push({ key: row.key, at: trajectory.length }); }
				applyRows(memory, plan.rows);
				const id = `e${++refinerEdits}`;
				append("refiner.jsonl", { kind: "edit", ...base, category: "memory", path: `memory:${edit.key}`, why: edit.why, loaded: true, check: Boolean(edit.check),
					...(rewrote ? { rewrote: true } : {}), ...ledgerFields(id) });
				applied = true;
				// The test move a coverage event's answer named becomes the first item of the strategy's next experiment (P3).
				const { clause, old } = coverageEvent && edit.predicts
					? pinFrom(edit.predicts, id, `${edit.key}${target && target !== edit.key ? ` against ${target}` : ""}: ${edit.predicts}`, edit.expect?.within)
					: { clause: "", old: undefined };
				if (clause) await writeStrategy(pinned(readStrategy()?.text ?? "", old));
				told(`hypothesis ${edit.key}${rewrote ? " rewritten" : ""}${edit.check ? " with a check, run on every recorded move" : ""}${clause}`, edit.why, id);
				return;
			}
			if (edit.kind !== "file") { append("refiner.jsonl", { kind: edit.kind, ...base, why: edit.why }); return; }
			// prompts/lessons.md is the agent's own review of its levels: refinements read it and never write it.
			if (edit.path === LESSONS_PATH) {
				append("refiner.jsonl", { kind: "refused", ...base, path: edit.path, why: `${LESSONS_PATH} is the agent's level review` });
				return;
			}
			// A refinement adds; it never replaces what the agent wrote (on 2026-10-13 one turned the agent's acting tool
			// tools/probe.py into an unrelated view). It may rewrite the strategy, the rules prompt and files that refinements wrote.
			if (!ownedByRefinement(edit.path)) {
				append("refiner.jsonl", { kind: "refused", ...base, path: edit.path, why: `would replace the agent's ${edit.path}` });
				return;
			}
			// The same file again is not an edit: nothing is written, and the agent is not told of one.
			if (unchangedFile(edit)) {
				append("refiner.jsonl", { kind: "unchanged", ...base, path: edit.path, version: binder!.versionMap()[edit.path], why: edit.why });
				return;
			}
			// A coverage event answered in the strategy pins the first move its next experiment names (P3), and a pinned move
			// stays the first item of any strategy a refinement writes until it is played.
			let content = edit.content, clause = "";
			if (edit.path === STRATEGY_PATH && COVERAGE) {
				const from: { clause: string; old?: Pin } = coverageEvent
					? pinFrom(nextExperimentText(content), `e${refinerEdits + 1}`, edit.why, edit.expect?.within) : { clause: "" };
				clause = from.clause;
				content = pinned(content, from.old);
			}
			workspace!.mutate({ op: "write", path: edit.path, content });
			refinedPaths.add(edit.path);
			const receipt = await binder!.save(edit.path, currentLevel());
			nativeRuntime!.noteSave(edit.path, receipt);
			nativeRuntime!.register();
			const loaded = !/NOT loaded/.test(receipt ?? "");
			const version = binder!.versionMap()[edit.path];
			if (loaded && version !== undefined) refinedVersions.add(`${edit.path}@${version}`);
			const id = `e${++refinerEdits}`;
			append("refiner.jsonl", { kind: "edit", ...base, category: edit.path.split("/")[0].replace(/s$/, ""), path: edit.path, version, why: edit.why, loaded, receipt, ...ledgerFields(id) });
			applied = true;
			told(`${edit.path}${version ? ` v${version}` : ""}${loaded ? "" : " failed validation; the previous version still applies"}${clause}`, edit.why, id);
		} finally {
			settlePromotion(promotionId, applied ? edit as { kind: string; path?: string; key?: string } : { kind: "none" });
		}
	}

	/** Start one refinement unless one is running; true when it was started. */
	/** The agent's own request made while a refinement ran: it runs next, so asking is never lost. */
	let queuedFocus: string[] | undefined;
	function startRefiner(ctx: ExtensionContext | undefined, triggers: string[], samples: string[], asked = false): boolean {
		if (!ctx?.model) return false;
		if (refinerInFlight) {
			if (asked) queuedFocus = triggers;
			append("refiner.jsonl", { kind: asked ? "queued" : "suppressed", at: trajectory.length, reason: "refiner busy", triggers });
			return false;
		}
		refineNotes.push({ at: trajectory.length, level: currentLevel(), triggers, lines: [], dropped: [] });
		lastRefineAt = trajectory.length;
		append("refiner.jsonl", { kind: "start", at: trajectory.length, decision, triggers, model: ctx.model.id ?? null });
		refinerInFlight = runRefiner(ctx, triggers, samples)
			.catch((error) => { logError("refiner", error); append("refiner.jsonl", { kind: "failed", at: trajectory.length, triggers, error: errorText(error).slice(0, 300) }); })
			.finally(() => {
				refinerInFlight = undefined;
				const next = queuedFocus; queuedFocus = undefined;
				if (next) startRefiner(ctx, next, [], true);
			});
		return true;
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
		if (native && workspace) {
			// Native mode keeps the runtime's own analyses out of the resident context: the ledger is a file the agent,
			// its components and its refiner can read, and the refiner replaces the critic's advisory notes.
			try { workspace.runtimeWrite("data/ledger.md", renderLedgerView(state, [...memory.hypotheses.keys()], 6000, goalRefs) + "\n"); }
			catch (error) { logError("ledger:file", error); }
			ledgerText = "";
			// While a refinement runs, events wait for the next decision instead of being dropped.
			if (refinerActive() && !refinerInFlight) {
				const { triggers, samples } = refinerTriggers(state);
				if (triggers.length) startRefiner(ctx, triggers, samples);
			}
			return;
		}
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
			recent_actions: trajectory.slice(-RECENT_ACTIONS).map((row) => reportedAction(row, native)),
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
		// A level review is bounded like a decision: its last call says so, and a call after it ends the review.
		if (native && run.levelReview) {
			if (run.toolCalls > LEVEL_REVIEW_CALLS) return { reason: `this review used its ${LEVEL_REVIEW_CALLS} tool calls; it ends here`, terminate: true };
			if (run.toolCalls === LEVEL_REVIEW_CALLS) run.budgetNote = `(This was tool call ${LEVEL_REVIEW_CALLS} of ${LEVEL_REVIEW_CALLS} for this review: finish now.)`;
		}
		const nativeCap = native && !run.consolidating && !diagnosticBudget;
		if (!native && run.toolCalls > (diagnosticBudget || HARD_TOOL_CALLS))
			return { reason: `hard tool-call limit (${diagnosticBudget || HARD_TOOL_CALLS}) for this decision reached; the decision ends`, terminate: true };
		if (name === "arc_action") {
			if (run.consolidating) return { reason: "no action during consolidation", terminate: true };
			if (run.actionDone || run.arcSeenInMessage === run.assistantMessages)
				return { reason: "one arc_action per decision; this call was NOT submitted", terminate: true };
			run.arcSeenInMessage = run.assistantMessages;
			return undefined;
		}
		if (run.actionDone && !endsBatch())
			return { reason: "this decision already acted", terminate: true };
		if (nativeCap) {
			// One cap, a fixed tool list: the last allowed call says so; later calls are not run, so the decision can
			// still act with what it has, and a decision that keeps calling ends.
			if (run.toolCalls > NATIVE_DECISION_CALLS + 4)
				return { reason: `this decision used its ${NATIVE_DECISION_CALLS} tool calls and kept calling; the decision ends. The next decision must act.`, terminate: true };
			if (run.toolCalls > NATIVE_DECISION_CALLS)
				return { reason: `this decision used its ${NATIVE_DECISION_CALLS} tool calls; this call was NOT run. Act now with arc_action.`, terminate: false };
			if (run.toolCalls === NATIVE_DECISION_CALLS)
				run.budgetNote = `(This was tool call ${NATIVE_DECISION_CALLS} of ${NATIVE_DECISION_CALLS} for this decision: act now.)`;
			return undefined;
		}
		if (!native && run.toolCalls > (diagnosticBudget || SOFT_TOOL_CALLS))
			return run.consolidating
				? { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for consolidation reached; the review ends`, terminate: true }
				: { reason: `tool-call limit (${SOFT_TOOL_CALLS}) for this decision reached; submit arc_action in the next decision`, terminate: true };
		return undefined;
	}

	const refused = (reason: string) => text(reason, { refused: true }, true);
	// A call that succeeded counts as a repeat when its result is the same too (2026-10-16); ARC_THIN_LOOP_RESULTS=0
	// restores the earlier rule, under which only failed calls and reads counted.
	const nativeLoop = new NativeLoopGuard({ results: process.env.ARC_THIN_LOOP_RESULTS !== "0" });
	const resultText = (result: any) => (Array.isArray(result?.content) ? result.content : [])
		.map((block: any) => block?.type === "text" ? String(block.text) : String(block?.type)).join("\n");
	const loopEpoch = () => JSON.stringify([decision, trajectory.length, binder?.versionMap(),
		[...memory.facts], [...memory.hypotheses], [...memory.strategies]]);

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
			const epoch = native ? loopEpoch() : '';
			try {
				const result = await fn(params, signal, ctx);
				if (native && nativeLoop.record(name, params, epoch, Boolean(result?.isError), resultText(result)))
					return carry({...result, terminate:true, details:{...result.details, no_progress:true},
						content:[...(result.content ?? []), {type:'text', text:'Three identical observations/errors without a state or workspace change; this decision ends. Use the recorded evidence or change the investigation.'}]}, Boolean(result?.isError));
				const carried = carry(result, Boolean(result?.isError));
				const note = run.budgetNote; run.budgetNote = undefined;
				return note && Array.isArray(carried?.content)
					? { ...carried, content: [...carried.content, { type: "text" as const, text: note }] } : carried;
			}
			catch (error) {
				if (native && nativeLoop.record(name, params, epoch, true))
					return carry({...refused('Repeated unchanged error; decision ends: ' + errorText(error)), isError:true}, true);
				if (!(error instanceof Refusal)) logError(`tool:${name}`, error);
				if (name !== "arc_action" && endsBatch()) return carry(refused(errorText(error)), true);
				throw error;
			}
		};
	}

	/** An action the current state does not offer goes past Pi's enum check to the tool's own refusal (UNAVAILABLE_KEY). */
	function carryUnavailable(args: any): any {
		const available = availableActions(observation);
		const carry = (call: any) => available.length && call && typeof call === "object" && typeof call.action === "string"
			&& !available.includes(call.action) ? { ...call, action: available[0], [UNAVAILABLE_KEY]: call.action } : call;
		const out = carry(args);
		return out && typeof out === "object" && Array.isArray(out.then) ? { ...out, then: out.then.map(carry) } : out;
	}
	/** The action a call named, also when prepareArguments carried it past the enum check. */
	const namedAction = (call: { action: string }) => String((call as any)[UNAVAILABLE_KEY] ?? call.action);

	/** _mint_batch_id: b_<counter>_<4 hex>, one per action list. */
	const mintBatchId = () => `b_${String(++batchCounter).padStart(4, "0")}_${randomBytes(2).toString("hex")}`;

	/**
	 * ARC_THIN_OBSERVATION=ch: arc_action takes Continual Harness's take_actions arguments (tools.TAKE_ACTIONS_TOOL):
	 * reasoning and a list of actions, checked once and cut at the first entry that is not an offered action, then played
	 * in order through this harness's boundary, each step rechecked against what is offered now. As in CH the list stops
	 * at WIN, GAME_OVER or a level change; as the then list did, it also stops at a missed prediction, and one call plays
	 * at most THEN_STEPS + 1 actions. An entry may carry this harness's predict; the list's reasoning is its first
	 * action's note. A list that plays nothing is refused with CH's message, and the decision goes on.
	 */
	function registerChArcAction(): void {
		pi.registerTool({
			name: "arc_action",
			label: "ARC action",
			description: `${TAKE_ACTIONS_DESCRIPTION} RESET returns the level to its starting grid and counts as one action against both budgets. ` +
				(control ? "" : "An entry's optional predict says what that action should produce ({text, cells: [[x,y,value],...], " +
					"level_changed, state}); the list stops at a missed prediction. ") +
				`At most ${THEN_STEPS + 1} actions per call; the call ends this decision.`,
			parameters: Type.Object({
				reasoning: Type.String({ description: TAKE_ACTIONS_TEXT.reasoning }),
				actions: Type.Array(Type.Object({
					name: Type.String({ description: TAKE_ACTIONS_TEXT.name }),
					x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63, description: TAKE_ACTIONS_TEXT.x })),
					y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63, description: TAKE_ACTIONS_TEXT.y })),
					// A malformed prediction is dropped before validation (repairActionList), never a reason to reject the action.
					...(control ? {} : { predict: Type.Optional(Type.Unknown()) }),
				}), { minItems: 1, description: TAKE_ACTIONS_TEXT.actions }),
				...(control ? {} : { predict_skill: Type.Optional(Type.String({ maxLength: 40 })) }),
				...(ledgerOn ? { idea: Type.Optional(Type.String()) } : {}),
			}),
			prepareArguments: repairActionList,
			execute: guardTool("arc_action", async (params: { reasoning: string; actions: Array<Record<string, unknown>>; predict_skill?: string; idea?: unknown }) => {
				const offered = availableActions(observation);
				const { steps: valid, rejected } = validateActionSequence(params.actions, offered);
				const steps = valid.slice(0, THEN_STEPS + 1), cut = valid.length - steps.length;
				if (!steps.length)
					throw new Refusal(`${NOTHING_EXECUTED.replace(/^take_actions/, "arc_action")}` +
						`${rejected[0] ? ` (entry ${rejected[0].position}: ${rejected[0].reason})` : ""}; available now: ${offered.join(", ") || "none"}`);
				const batchId = mintBatchId();
				const note = String(params.reasoning ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
				const lines: string[] = [];
				let last: ActionRow | undefined, played = 0, stopped: string | undefined;
				for (const step of steps) {
					stopped = last ? sequenceStop(last) : undefined;
					if (stopped) break;
					if (!availableActions(observation).includes(step.action)) { stopped = `${step.action} is no longer available`; break; }
					const predict = control || step.raw.predict === undefined ? undefined : normalizePrediction(step.raw.predict);
					const first = step.position === 1;
					const done = await submitAction({ action: step.action, ...(step.x !== undefined ? { x: step.x, y: step.y } : {}),
						...(first && note ? { note } : {}), ...(predict ? { predict } : {}),
						...(first && params.predict_skill ? { predict_skill: params.predict_skill } : {}),
						...(first && params.idea !== undefined ? { idea: params.idea } : {}) }, undefined,
						{ batchId, batchPosition: step.position, batchTotal: steps.length, ...(first && rejected.length ? { rejected } : {}) });
					if ("refusal" in done) {
						if (!played) {
							if (done.environment) return refused(done.refusal);
							throw new Refusal(done.refusal);
						}
						stopped = done.refusal;
						break;
					}
					last = done.row; played += 1;
					lines.push(`${actionLine(last)}${predictionClause(last)}`);
				}
				if (played < steps.length && stopped) lines.push(`played ${played} of ${steps.length}; stopped: ${stopped}`);
				if (rejected.length) lines.push(`not played: entry ${rejected[0].position} and the rest (${rejected[0].reason})`);
				if (cut) lines.push(`not played: the last ${cut} entr${cut === 1 ? "y" : "ies"}, past ${THEN_STEPS + 1} actions per call`);
				append("action_sequences.jsonl", { decision, n: last!.n, batch_id: batchId, planned: steps.length, played,
					stopped: stopped ?? null, rejected: rejected.length ? rejected : null, ...(cut ? { cut } : {}) });
				// The strategy's pinned next experiment, once overdue (P3: its expected move not played within its window).
				const overdue = COVERAGE ? pinNag() : "";
				if (overdue) { lines.push(overdue); append("refiner.jsonl", { kind: "next_overdue", edit: pin?.edit, at: trajectory.length, decision }); }
				return text(lines.join("\n"),
					{ ...reportedAction(last!, native), prediction: last!.prediction, skill_prediction: last!.skill_prediction, batch_id: batchId, played }, true);
			}),
		});
	}

	function registerArcAction(actions: string[]): void {
		if (chView) { registerChArcAction(); return; }
		const hasCoordinates = actions.includes("ACTION6");
		pi.registerTool({
			name: "arc_action",
			label: "ARC action",
			description: `Submit one available action and end this decision.${hasCoordinates ? " ACTION6 accepts x,y." : ""} ` +
				// Environment fact, checked in the bridge and the recorded runs: RESET is counted like any action.
				(actions.includes("RESET") ? "RESET returns the level to its starting grid and counts as one action against both budgets. " : "") +
				(native ? `then: up to ${THEN_STEPS} further actions played in order after it, stopping at a missed prediction, a level change or the game's end. ` : "") +
				"Optional note, prediction and memory/idea updates are recorded for the next decision.",
			parameters: Type.Object({
				action: StringEnum(actions),
				...(hasCoordinates ? {
					x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
					y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
				} : {}),
				// Continual Harness's take_actions: a planned sequence costs one decision, not one per action.
				...(native ? {
					then: Type.Optional(Type.Array(Type.Object({
						action: StringEnum(actions),
						...(hasCoordinates ? { x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })), y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })) } : {}),
						predict: Type.Optional(Type.Unknown()),
					}), { maxItems: THEN_STEPS })),
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
			prepareArguments: (args: unknown) => carryUnavailable(repairActionArguments(args)),
			execute: guardTool("arc_action", async (params: {
				action: string; x?: number; y?: number; note?: string; idea?: unknown;
				predict?: Prediction; predict_skill?: string;
				then?: Array<{ action: string; x?: number; y?: number; predict?: Prediction }>;
			}) => {
				const done = await submitAction({ ...params, action: namedAction(params) });
				if ("refusal" in done) {
					if (done.environment) return refused(done.refusal);
					throw new Refusal(done.refusal);
				}
				const row = done.row;
				const lines = [`${actionLine(row)}${predictionClause(row)}`];
				// Further planned actions, each through the same path; the plan stops once what it assumed no longer holds.
				const steps = native ? (params.then ?? []).slice(0, THEN_STEPS) : [];
				let last = row, played = 0, stopped: string | undefined;
				for (const step of steps) {
					stopped = sequenceStop(last);
					if (stopped) break;
					const next = await submitAction({ action: namedAction(step), ...(step.x !== undefined && step.y !== undefined ? { x: step.x, y: step.y } : {}),
						note: `then ${played + 1} of ${steps.length}`, ...(step.predict ? { predict: step.predict } : {}) });
					if ("refusal" in next) { stopped = next.refusal; break; }
					last = next.row; played += 1;
					lines.push(`${actionLine(last)}${predictionClause(last)}`);
				}
				if (played < steps.length) lines.push(`then: ${played} of ${steps.length} played; stopped: ${stopped}.`);
				if (steps.length) append("action_sequences.jsonl", { decision, n: row.n, planned: steps.length + 1, played: played + 1, stopped: stopped ?? null });
				// The strategy's pinned next experiment, once overdue (P3: its expected move not played within its window).
				const overdue = COVERAGE ? pinNag() : "";
				if (overdue) { lines.push(overdue); append("refiner.jsonl", { kind: "next_overdue", edit: pin?.edit, at: trajectory.length, decision }); }
				return text(lines.join("\n"),
					{ ...reportedAction(last, native), prediction: last.prediction, skill_prediction: last.skill_prediction }, true);
			}),
		});
	}

	/**
	 * One action through the environment boundary, recorded like every other: arc_action and the actions a saved tool
	 * returns both come here (`via` names the tool). The bridge, its budget and its refusals stay the only way to act.
	 */
	async function submitAction(params: {
		action: string; x?: number; y?: number; note?: string; idea?: unknown; predict?: Prediction; predict_skill?: string;
	}, via?: string, meta: { batchId?: string; batchPosition?: number; batchTotal?: number; rejected?: RejectedStep[] } = {}):
		Promise<{ row: ActionRow } | { refusal: string; environment?: boolean }> {
		const available = availableActions(observation);
		const previous = trajectory.at(-1);
		if (!available.includes(params.action))
			return { refusal: `action '${params.action}' is not currently available (available now: ${available.join(", ") || "none"}` +
				`${previous ? `; last action played: #${previous.n} ${actionLabel(previous)}` : ""}); nothing was played` };
		// The environment ignores coordinates on actions that take none; recording them made later receipts read like
		// clicks at different places (2026-10-13). They are dropped, and the receipt says so.
		const givenXY = params.x !== undefined && params.y !== undefined;
		const ignoredXY = native && givenXY && !takesCoordinates(params.action);
		if (ignoredXY) params = { ...params, x: undefined, y: undefined };
		const beforeGrid = gridOf(observation);
		const before = observation;
		const label = actionLabel(params);
		// The same action again after it changed at most NO_EFFECT_CELLS cells each of the last noEffectRepeats times in a
		// row. Every play was a new state to the loop guard, so su15-l0-2 played one click 30 times and su15-l0-1 another
		// 20 times (2026-10-17). Any other action lifts this; a refusal ends the decision at the third, like any repeated
		// failed call. The refusal does not say what lifts it, so that it does not invite one filler action per three.
		const repeats = noEffectRepeats ? trajectory.slice(-noEffectRepeats) : [];
		if (repeats.length && repeats.length === noEffectRepeats && repeats.every((row) => actionLabel(row) === label
			&& typeof row.changed_cells === "number" && row.changed_cells <= NO_EFFECT_CELLS))
			return { refusal: `${label} was NOT played: the last ${noEffectRepeats} actions (#${repeats[0].n}-#${repeats.at(-1)!.n}) were ` +
				`this same action and each changed at most ${NO_EFFECT_CELLS} cells; play a different action` };
		const payload: Record<string, unknown> = { action: params.action };
		if (params.x !== undefined && params.y !== undefined) { payload.x = params.x; payload.y = params.y; }
		const bySkill = !control && params.predict_skill ? await predictWithSkill(params.predict_skill, { ...payload }) : undefined;
		if (params.note) payload.reasoning = params.note;
		const idea = ledgerOn ? normIdea(params.idea) : "";
		// The ledger keeps the informal part of the prediction as the experiment's expectation.
		const expect = ledgerOn && !control && params.predict?.text ? params.predict.text : "";
		const by = via ? `${via} action` : "arc_action";
		let value: Record<string, any>;
		// No agent abort signal here: an aborted request could still apply an unrecorded action.
		try { value = await bridgeCall("/action", payload, 120_000); }
		catch (error) {
			// The environment failing is not the agent's to fix: end the decision instead of
			// letting it retry the same call (each retry is a full model turn plus the timeout).
			if (isEnvironmentFailure(error)) {
				append("errors.jsonl", { hook: "arc_action:environment", environment: true, decision, action: label, message: errorText(error).slice(0, 500) });
				return { environment: true, refusal: `${by} ${label} failed because the environment did not respond (${errorText(error).slice(0, 200)}). ` +
					`This decision ends; the runner checks the environment before the next one.` };
			}
			return { refusal: `${by} ${label} failed: ${errorText(error)}` };
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
			...(via ? { via } : {}),
			...(ignoredXY ? { ignored_xy: true } : {}),
			// How much the frame changed, per the bridge (shown in native receipts, evaluation only in the legacy path).
			changed_cells: typeof delta.changed_cells === "number" ? delta.changed_cells : gridDiff(beforeGrid, afterGrid),
			...(delta.bbox ? { bbox: delta.bbox } : {}),
			level_changed: Boolean(value.public_transition?.level_changed),
			state: String(value.state ?? "UNKNOWN"),
			levels_completed: Number(value.levels_completed ?? 0),
			budget: value.action_budget ?? null,
			// Continual Harness's step record (ARC_THIN_OBSERVATION=ch): source, list position, the state before, and the change.
			...(chView ? {
				source: via ? (via === "python" ? "python" : `tool: ${via.replace(/^tools\//, "").replace(/\.py$/, "")}`) : "arc_action",
				...(meta.batchId ? { batch_id: meta.batchId, batch_position: meta.batchPosition, batch_total: meta.batchTotal } : {}),
				...(meta.rejected?.length ? { batch_rejected: meta.rejected } : {}),
				state_before: String(before?.state ?? "UNKNOWN"), levels_before: Number(before?.levels_completed ?? 0),
				grid_change: summarizeGridTransitions(beforeGrid, afterGrid), grid_delta: computeGridDelta(beforeGrid, afterGrid),
			} : {}),
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
		// ARC_THIN_OBSERVATION=ch: the next decision's OBSERVATIONS show what this action did, frame by frame.
		if (chView) pendingObservations.push({
			step: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { data: { x: row.x, y: row.y } } : {}),
			source: row.source ?? "arc_action",
			...(meta.batchId ? { batchId: meta.batchId, batchPosition: meta.batchPosition, batchTotal: meta.batchTotal } : {}),
			preState: String(before?.state ?? "UNKNOWN"), preScore: Number(before?.levels_completed ?? 0), preGrid: beforeGrid,
			postState: row.state, postScore: row.levels_completed,
			animation: Array.isArray(value.frames) ? value.frames.filter((frame: unknown) => Array.isArray(frame)) : [],
			validFrame: Array.isArray(value.frames) && value.frames.length > 0,
		});
		if (nativeRuntime) nativeRuntime.observe(row.n);
		refreshActionSurface();
		return { row };
	}

	/** Set by an action that changed the level or ended the game: later env.act calls of the same decision are refused. */
	let actingStopped: string | undefined;
	/** ARC_THIN_OBSERVATION=ch: the batch id of the list code is playing (env.act with a list), or of its last single env.act. */
	let codeBatch: string | undefined;
	/** Why a planned sequence (arc_action's then list, or its action list) must not go on after this action, or undefined. */
	const sequenceStop = (row: ActionRow): string | undefined => row.level_changed ? `the level changed at #${row.n}`
		: /^(GAME_OVER|WIN|FINISHED)$/.test(row.state) ? `state ${row.state} at #${row.n}`
		: row.prediction?.fields.some((field) => field.hit === false) ? `#${row.n}'s prediction missed` : undefined;
	const hexRows = (grid: number[][] | undefined) => grid?.map((row) => row.map((cell) => (cell & 15).toString(16)).join(""));
	/**
	 * One action for saved code (env.act in a tool): the same path as arc_action, so the bridge, its budget and its
	 * refusals stay the only way to act. The code gets the observation back and decides whether to go on (closed loop,
	 * as Continual Harness skills call take_actions); the runtime itself stops the call after a level change or a
	 * terminal state, since what the code assumed no longer holds.
	 */
	async function actForCode(call: { action: string; x?: number; y?: number; predict?: unknown; batch?: unknown }, via: string):
		Promise<{ observation?: Record<string, unknown>; stopped?: string; line?: string }> {
		if (run.consolidating) return { stopped: "no action during a review" };
		if (actingStopped) return { stopped: actingStopped };
		const compact = String(call.action ?? "").toUpperCase().replace(/\s+/g, "").replace(/^A(\d)/, "ACTION$1");
		const labelled = /^ACTION(\d)\((\d{1,2}),(\d{1,2})\)$/.exec(compact);
		const action = labelled ? `ACTION${labelled[1]}` : compact;
		const x = labelled ? Number(labelled[2]) : Number.isInteger(call.x) ? call.x : undefined;
		const y = labelled ? Number(labelled[3]) : Number.isInteger(call.y) ? call.y : undefined;
		// ARC_THIN_OBSERVATION=ch: code acts as CH's skills do (tools.take_actions): ACTION6 needs x and y, and each env.act
		// call is one batch (a list given to env.act is one batch of its entries).
		let batch: { batchId: string; batchPosition: number; batchTotal: number } | undefined;
		if (chView) {
			if (action === "ACTION6" && (x === undefined || y === undefined))
				return { stopped: "ACTION6 was not played: it needs x and y in 0..63" };
			const [position, total] = Array.isArray(call.batch) && call.batch.length === 2 ? call.batch.map(Number) : [1, 1];
			if (position <= 1 || !codeBatch) codeBatch = mintBatchId();
			batch = { batchId: codeBatch, batchPosition: Math.max(1, position), batchTotal: Math.max(1, total) };
		}
		const predict = call.predict === undefined ? undefined : normalizePrediction(call.predict);
		const done = await submitAction({ action, ...(x !== undefined && y !== undefined ? { x, y } : {}), note: `by ${via}`, ...(predict ? { predict } : {}) }, via, batch);
		if ("refusal" in done) return { stopped: done.refusal };
		const row = done.row;
		const missed = Boolean(row.prediction?.fields.some((field) => field.hit === false));
		append("played_actions.jsonl", { decision, via, n: row.n, action: actionLabel(row), changed_cells: row.changed_cells, missed });
		if (row.level_changed) actingStopped = "the level changed";
		else if (/^(GAME_OVER|WIN|FINISHED)$/.test(row.state)) actingStopped = `state ${row.state}`;
		return {
			line: `${actionLine(row)}${predictionClause(row)}`,
			observation: {
				n: row.n, action: actionLabel(row), grid: hexRows(gridOf(observation)), state: row.state, levels_completed: row.levels_completed,
				frames: (observation?.frames ?? []).map((frame: any) => hexRows(frame)), action_budget: observation?.action_budget ?? null,
				transition: { n: row.n, action: row.action, ...(row.x !== undefined && row.y !== undefined ? { x: row.x, y: row.y } : {}),
					level_changed: row.level_changed, state: row.state, levels_completed: row.levels_completed },
				level_changed: row.level_changed, changed_cells: row.changed_cells, ...(row.bbox ? { bbox: row.bbox } : {}),
				available_actions: availableActions(observation), missed,
			},
		};
	}
  if (workspace) for (const tool of workspace.fileTools()) pi.registerTool({ ...tool,
    execute: guardTool(tool.name, async (params, signal, ctx) => {
      try { return await tool.execute('workspace', params as any, signal, undefined, ctx); }
      catch (error) { throw new Refusal(errorText(error)); }
    }) });
	// No action vocabulary is invented before the environment has supplied its scope.
	registerArcAction([]);
	let boundActionScope = chView ? "ch" : "[]";
	function refreshActionSurface(): void {
		const actions = availableActions(observation);
		// ARC_THIN_OBSERVATION=ch: one schema whatever is offered (take_actions names actions in a plain string).
		const signature = chView ? "ch" : JSON.stringify(actions);
		if (signature !== boundActionScope) {
			registerArcAction(actions);
			boundActionScope = signature;
		}
		if (!toolsReady) return;
		const active = pi.getActiveTools().filter(name => name !== "arc_action");
		if (actions.length && !run.consolidating) active.unshift("arc_action");
		pi.setActiveTools(active);
	}

	let pythonMemory: ((params: unknown, signal?: AbortSignal) => Promise<string>) | undefined;
	if (!control) {
		const text600 = Type.String({ minLength: 1, maxLength: 600 });
		const confidence = Type.Integer({ minimum: 1, maximum: 5 });
		const line = (maxLength: number, _description = "") => Type.String({ maxLength });
		pi.registerTool({
			name: "memory",
			label: "Memory",
			description: native ? 'Record beliefs, hypotheses with optional checks, tests and strategies. Partial entries apply valid fields; fabricated action evidence is refused.'
        : "Atomic facts/hypotheses/tests/strategies update. Invalid batches do not apply; evidence is appended.",
			parameters: native ? Type.Object({
        op: Type.Optional(StringEnum(['set', 'delete', 'list', 'update'])),
        key: Type.Optional(Type.String({ maxLength: 48 })), text: Type.Optional(Type.String({ maxLength: 600 })), confidence: Type.Optional(Type.Number()),
        set: Type.Optional(Type.Array(Type.Any(), { maxItems: 40 })), delete: Type.Optional(Type.Array(Type.String(), { maxItems: 40 })),
        // Each field documented where the agent writes it, without tightening what validates: the planner reports a
        // malformed field per entry (partial acceptance) instead of a schema error refusing the whole call.
        hypotheses: Type.Optional(Type.Array(Type.Object({
          key: Type.Optional(Type.Any({ description: "hyp.<name>" })),
          question: Type.Optional(Type.Any({ description: "What it answers (\"goal\"); rivals share it." })),
          claim: Type.Optional(Type.Any({ description: "One sentence." })),
          predicts: Type.Optional(Type.Any({ description: "What a move shows if it holds." })),
          next_test: Type.Optional(Type.Any({ description: "Cheapest action separating it from rivals." })),
          status: Type.Optional(Type.Any({ description: "open|supported|contested|rejected" })),
          check: Type.Optional(Type.Any({ description: NATIVE_CHECK_DESCRIPTION })),
        }, { additionalProperties: true }), { maxItems: 16 })), tests: Type.Optional(Type.Array(Type.Any(), { maxItems: 4 })),
        strategies: Type.Optional(Type.Array(Type.Any(), { maxItems: 4 })),
      }) : Type.Object({
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
						"(t.n, t.action, t.x, t.y, t.before, t.after grids [y][x], t.level_changed, t.state, t.levels_completed, " +
						"t.changed_cells, t.bbox {top,left,bottom,right} of the changed cells or None; t.get of any other key fails). " +
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
			execute: guardTool("memory", async (params: MemoryParams, signal) => text(await commitMemory(params, signal), undefined, endsBatch())),
		});
		/** One committed memory update, from the memory tool or python's env.remember: its receipt, or a Refusal. */
		async function commitMemory(params: MemoryParams, signal?: AbortSignal): Promise<string> {
		const plan = (native ? planNativeMemoryUpdate : planMemoryUpdate)(memory, params, trajectory.length, components());
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
				// A saved check that already fails on most of the recorded moves contests its hypothesis now (H2a).
				return [plan.receipt, ...checkLines, ...contestByChecks()].join("\n");
		}
		// Python's env.remember goes through the same update as the memory tool, so bookkeeping and an action can share
		// one cell (Prime Agent's programmatic tool calling) instead of costing a separate request each.
		pythonMemory = (params, signal) => commitMemory(repairMemoryArguments(params) as MemoryParams, signal);

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
			description: native
				? "Run Python once. Names: state, grid, prev_grid, history (history.grid(n)), artifacts, args. Returns what you print and the " +
					"value of a final expression. save=\"name\" also keeps this code as tools/name.py, callable later as the tool name(args={...}); " +
					"Names persist automatically. env.act(action, predict=...) takes an action and returns feedback; grid/state/history update. " +
						(pythonKernel ? "The session is a live kernel: what you define stays in memory across calls and decisions, so keep data in " +
							"names and print only what you need to read; the final value is also _. " : "") +
					"Combine computation and feedback checks in code; print or return selected evidence. Saved tools run without this namespace."
				: "Run Python once (nothing is saved). Names available: state (same keys as a skill's state), history " +
					"(history.grid(n), history.transitions()), grid, prev_grid, artifacts, skill(name, **args) to call a saved skill. " +
					"Returns what you print and the value of a final expression. Standard library only; no files or network.",
			parameters: native
				? Type.Object({ code: Type.String({ minLength: 1, maxLength: 16384 }), save: Type.Optional(Type.String({ maxLength: 41 })) })
				: Type.Object({ code: Type.String({ minLength: 1, maxLength: 16384 }) }),
			prepareArguments: (args: any) => args && typeof args === "object" && typeof args.code === "string"
				? { ...args, code: unescapeSource(args.code) } : args,
			execute: guardTool("python", async (params: { code: string; save?: string }, signal) => {
        if (nativeRuntime) {
          try { return await nativeRuntime.python(params.code, signal, false, params.save || undefined); }
          catch (error) { throw new Refusal(errorText(error)); }
        }
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
        if (nativeRuntime) {
          append('legacy_alias.jsonl', { name: params.name, decision });
          return nativeRuntime.legacyAlias(params.name, params.args ?? {}, signal);
        }
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
		pi.on("session_before_compact", guard("session_before_compact", async (event: any, ctx: ExtensionContext) => {
			compactStarted = Date.now();
      if (native) {
        const instructions = [event.customInstructions, 'Preserve controls, hypotheses with check records, refuted claims and their test conditions, open questions, active strategy and planned steps, what the last actions were testing, and exact workspace result references. Do not infer success from component creation.',
          // Prime's compaction note: the summary replaces the calls that defined the session's names, not the names.
          ...(pythonKernel ? ['The python session keeps running after this summary: every name and function the calls defined stays available. Name the ones that hold results worth reusing and what they hold, so they are used instead of recomputed.'] : [])].filter(Boolean).join('\n');
        event.preparation.messagesToSummarize = projectNativeHistory(event.preparation.messagesToSummarize, replayReasoning);
        event.preparation.turnPrefixMessages = projectNativeHistory(event.preparation.turnPrefixMessages, replayReasoning);
        for (const message of [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages])
          if (message.role === 'toolResult') message.content = message.content.map((block: any) =>
            block.type === 'text' ? { ...block, text: workspace!.receipt(block.text, message.isError ? 'error' : 'ok') } : block);
        // Pi's split-turn generator does not accept customInstructions. Supply the requirements
        // only to its summary input, without inserting a message into the gameplay session.
        if (event.preparation.isSplitTurn && event.preparation.turnPrefixMessages.length)
          event.preparation.turnPrefixMessages.push({ role: 'user', content: `Compaction checkpoint requirements:\n${instructions}`, timestamp: Date.now() });
        append('compaction_probe.jsonl', { native: true, messages: event.preparation.messagesToSummarize,
          turnPrefixMessages: event.preparation.turnPrefixMessages, tokensBefore: event.preparation.tokensBefore, instructions });
        if (!ctx.model) throw Error('Native compaction requires the current Pi model');
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
        if (!auth.ok) throw Error(auth.error);
        // Pi 0.87.0 consumes {compaction}, not {customInstructions}, from this hook.
        // Use Pi's native engine; Pi still schedules, persists and restores the checkpoint.
        return { compaction: await piCompact(event.preparation, ctx.model, auth.apiKey, auth.headers,
          instructions, event.signal, pi.getThinkingLevel(),
          (model, context, options) => {
            return {result:() => requestTrace.run('compaction', decision, onResponse =>
              ctx.modelRegistry.streamSimple(model, context, {...options,onResponse:async(response,m)=>{
                onResponse(response);await options?.onResponse?.(response,m);
              }}))} as any;
          }, auth.env) };
      }
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
      if (native && entry.usage) appendUsage('compaction', { usage: entry.usage, stopReason: 'stop' });
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
  if (workspace && binder && !control) {
    const migrationMarker = join(storeDir, '..', '.harness', 'migration.json');
    if (!existsSync(migrationMarker)) {
      const migrated = migrateWorkspace(workspace, { skills, overlay, notes: memory.facts,
        artifacts: (artifactInputs(artifactLog) as any).artifacts ?? {} });
      writeFileSync(migrationMarker, JSON.stringify({ migrated, at: new Date().toISOString() }) + '\n');
    }
    nativeRuntime = new NativeRuntime({ pi, workspace, binder,
      state: () => ({ ...skillState(false, true), frames: observation?.frames ?? [], ...(chView ? chSandboxState() : {}) }),
      level: currentLevel, actionCount: () => trajectory.length, decision: () => decision, log: append, usage: appendUsage,
      act: (call, via) => actForCode(call, via),
      ...(pythonMemory ? { remember: pythonMemory } : {}),
      pythonSession: process.env.ARC_THIN_PYTHON_SESSION !== "0",
      pythonKernel,
      // Checkpoints of the python namespace sit with the binder's version store, outside the agent's workspace.
      sessionDir: join(storeDir, '..', '.harness', 'python_session'),
      modelResult:create => requestTrace.run('consult', decision, create),
      artifacts: (result, component, n) => {
        const count = artifactLog.length;
        const kept = keepArtifacts(result, { n, level: levelAt(n), skill: component.name, version: component.version });
        const current = artifactInputs(artifactLog).artifacts;
        for (const record of artifactLog.slice(count)) workspace.runtimeWrite(`artifacts/${record.name}.json`, JSON.stringify(current[record.name]) + '\n');
        return kept;
      },
      receipt: body => workspace.receipt(body),
      wrap: (name, fn) => guardTool(name, async (params, signal, ctx) => {
        try { return await fn(params, signal, ctx); } catch (error) { throw new Refusal(errorText(error)); }
      }) });
    nativeRuntime.seedPython(readRows('component_runs.jsonl'));
    nativeRuntime.seedViews(readRows('observer_runs.jsonl'));
    // refine(focus): the agent starts a refinement itself (Prime's refine.run); it runs in the background.
    if (criticOn && refineTool) pi.registerTool({
      name: 'refine', label: 'Refine',
      description: 'Start a background refinement of your harness with a focus (e.g. "turn the route search into a tool" or ' +
        '"write a goal test into the strategy"). It makes one edit to a prompt, memory entry, tool or skill; the next decision says what changed.',
      parameters: Type.Object({ focus: Type.String({ minLength: 3, maxLength: 300 }) }),
      execute: guardTool('refine', async (params: { focus: string }, _signal, ctx) =>
        text(startRefiner(ctx, [`the agent asked: ${params.focus}`], [], true)
          ? 'Refinement started in the background; a later decision says what it changed.'
          : 'A refinement is running; yours starts after it, and a later decision says what it changed.', undefined, endsBatch())),
    });
    workspace.onWrite = async path => {
      const receipt = await binder.save(path, currentLevel()); nativeRuntime!.register();
      nativeRuntime!.noteSave(path, receipt);
      if (toolsReady) refreshSkillSurface();
      const promptChars = binder.candidates().filter(c => c.kind === 'prompt').reduce((n, c) => n + (c.body?.length ?? 0), 0);
      // The level review asks for a short file: it is sent with every decision.
      const lessons = path === LESSONS_PATH && receipt && !/NOT loaded/.test(receipt) ? workspace.read(path).length : 0;
      return receipt ? receipt + (lessons > LESSONS_CHARS ? `\nnote: ${LESSONS_PATH} is ${lessons} chars, over the ${LESSONS_CHARS} the review asks for; it is sent with every decision` : '')
        + (promptChars > 2500 ? `\nwarning: active prompts ${promptChars} chars exceed the 2500-char budget` : '') : undefined;
    };
  }
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
		// A pinned next experiment that was played, or whose level or time ended, leaves the strategy before it is bound (P3).
		if (COVERAGE && refinerActive()) { try { await settlePin(); } catch (error) { logError("pin:settle", error); } }
		// A refinement's view that keeps raising goes back to a version that showed something, before it is bound.
		if (refinerActive()) { try { await restoreBrokenViews(); } catch (error) { logError("view:restore", error); } }
    if (binder) { await binder.scan(currentLevel()); binder.boundary(); nativeRuntime?.register(); }
		const prompt = String(event.prompt ?? "").trimStart();
		const continuing = native && !run.actionDone && /^RECOVER (?:ACTION|CONSOLIDATION|LEVEL REVIEW)\b/.test(prompt);
		if (!continuing) {
		carriedResults = run.batchResults;
		// ARC_THIN_OBSERVATION=ch: observations a decision showed but the model never answered (a provider error) are shown
		// again, as CH clears them only after a response.
		if (chView && !run.consolidating && !run.answered && decisionObservations.length) {
			pendingObservations = [...decisionObservations, ...pendingObservations];
			decisionObservations = [];
		}
		// Keep the end of the reasoning: conclusions come last.
		const reasoning = carryChars ? run.reasoning.join("\n").replace(/\n{3,}/g, "\n\n").trim() : "";
		carriedReasoning = reasoning.length > carryChars ? `…${reasoning.slice(-carryChars)}` : reasoning;
		if (run.assistantMessages) lastDecisionCost = { ms: (run.endedAt || Date.now()) - run.startedAt, output: run.output, reasoning: run.reasoningTokens,
			coordinateShare: run.reasoningSentences ? run.coordinateSentences / run.reasoningSentences : 0 };
		run = freshRun();
		actingStopped = undefined;
		decision += 1;
		} else {
			run.endedAt = 0;
			append('continuations.jsonl', {decision, n: trajectory.length, reason: 'provider length', tool_calls: run.toolCalls});
		}
		// The runner's review prompts: "CONSOLIDATE…" and, after a length stop, "RECOVER CONSOLIDATION…"; after a level change
		// (native), "LEVEL REVIEW…" and "RECOVER LEVEL REVIEW…".
		run.consolidating = !control && /^(CONSOLIDATE\b|RECOVER CONSOLIDATION\b|LEVEL REVIEW\b|RECOVER LEVEL REVIEW\b)/.test(prompt);
		run.levelReview = native && run.consolidating && /^(LEVEL REVIEW|RECOVER LEVEL REVIEW)\b/.test(prompt);
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
		if (control || run.forceAction && !native) pi.setActiveTools(["arc_action"]);
		else refreshSkillSurface(run.consolidating
			? CONSOLIDATION_TOOLS
			: (expandedDecisionTools ? EXPANDED_DECISION_TOOLS : DECISION_TOOLS));
		try { observation = await bridgeCall("/state"); }
		catch (error) { observation = undefined; logError("before_agent_start:/state", error, true); }
		if (chView && !continuing && !run.consolidating) {
			// CH's first decision shows the RESET that started the game; its pre-frame is NOT_PLAYED's empty frame.
			if (!initialReset && trajectory.length === 0 && observation) {
				const frames = Array.isArray(observation.frames) ? observation.frames.filter((frame: unknown) => Array.isArray(frame)) : [];
				const state = String(observation.state ?? "UNKNOWN"), score = Number(observation.levels_completed ?? 0);
				initialReset = {
					observation: { step: 0, action: "RESET", source: "auto_reset", preState: "NOT_PLAYED", preScore: 0, postState: state,
						postScore: score, animation: frames, validFrame: true },
					record: { step: 0, action: "RESET", source: "auto_reset", score: 0, state: "NOT_PLAYED", stateAfter: state, scoreDelta: score,
						gridChange: null, gridDelta: null },
				};
				pendingObservations.unshift(initialReset.observation);
			}
			// What happened since the last decision's prompt is this decision's OBSERVATIONS SINCE LAST QUERY.
			decisionObservations = pendingObservations;
			pendingObservations = [];
		}
		refreshActionSurface();
		recordState(trajectory.length, gridOf(observation));
		// Model skills are checked on the transition just recorded (incremental; failures leave the decision unchanged).
		if (!control) await refreshModelChecks();
		// So are the hypotheses' checks: each new transition is one more test of every claim.
		if (!control) { try { await refreshClaimChecks(); await refreshClaimControls(); contestByChecks(); } catch (error) { logError("claims:refresh", error); } }
		// The ledger and critic are advisory: any failure leaves the decision unchanged.
		try { await prepareLedger(ctx); } catch (error) { ledgerText = ""; criticText = ""; logError("ledger:prepare", error); }
		if (native && workspace) {
			try { workspace.runtimeWrite("data/memory.md", renderMemory(memory, trajectory.length, trajectory.map(actionLabel), { ...components(), checkSources: true }) + "\n"); }
			catch (error) { logError("memory:file", error); }
		}
		const systemPrompt = native && !control ? renderPrompt('arc_thin_native_system.md', { game,
      observation: chView ? "the game as described under INPUT FORMAT below" : queryObservation
        ? "the current grid as row runs; show(g, x0, y0, x1, y1) prints any grid or region so (digit rows cost a token per cell)"
        : "current grid" + (ctx.model?.input?.includes('image') ? " and its PNG" : ""),
      // ARC_THIN_OBSERVATION=ch: arc_action takes CH's action list, and the ARC information CH's system instruction gives
      // (input format, coordinates, the action key, the game setting) closes the prompt (arc_thin_native_ch_arc.md).
      acting: chView ? "arc_action, which plays its list of actions in order, or Python calling env.act"
        : "arc_action, whose then list plays further actions, or Python calling env.act",
      predict_on: chView ? "on each entry of arc_action's list and on env.act" : "on arc_action, on each step of its then list, and on env.act",
      list_stop: chView ? "An action list" : "A then list",
      arc: chView ? loadPrompt("arc_thin_native_ch_arc.md") : "",
      // What of a decision's own thinking comes back to it on its next call, and what the agent must write to keep the
      // rest. The requirement is a short field block the agent authors; nothing summarises or rewrites its reasoning.
      // ls20-r01 and ls20-r02 measured carry_blocks=0 over 16 and 21 projected messages, with the long form of this ask
      // and a <carry-missing> note on the result: this model does not author the block. The ask is kept to one line --
      // the lift path and the note still pick one up if it ever writes one -- rather than spending the prompt's
      // attention on an instruction two rounds have shown to be inert.
      carry: reasoningMode === 'fields'
        ? 'Your reasoning is not read back to you after the call it was written for; your text, calls and results are. '
          + 'A <carry>premises / eliminated / probe / open</carry> block, in your text or your reasoning, is kept; what '
          + 'is not in it you will have to derive again.'
        : 'Your reasoning stays in view until the decision ends; earlier decisions keep your text, calls and results.',
      refine: criticOn ? `Refinements run in the background (level changes, missing goal tests, stalls, repeated work${refineTool ? ', refine(focus)' : ''}); each makes one edit to a prompt, memory entry, tool or skill (prompts/refine.md guides them) and consolidates the memory and strategy you write. ` : '',
      // P4 (ARC_THIN_LEAN, ARC_THIN_CONSULT): without consult, subagents have no way to be asked, so their line goes (below).
      kinds: consultTool ? 'five' : 'four',
      nonacting: consultTool ? 'subagents or views' : 'views',
      skill: lean ? 'skills/<name>/SKILL.md, a procedure read on demand.' : 'skills/<name>/SKILL.md (name, description), a procedure read on demand.' }) : control
			? renderPrompt("arc_thin_control_system.md", { game })
			: renderPrompt("arc_thin_system.md", {
				game, overlay: overlay ? `Your standing instructions (set with prompt):\n${overlay}` : "",
				board: ledgerOn ? LEDGER_PROMPT + (criticOn ? CRITIC_PROMPT : "") : "",
				continuity: continuity === "session"
					? `Your last ${continuityDecisions} decisions stay in view (what you wrote, called and got back, not your\nreasoning); older ones and all reasoning are not carried forward.`
					: "Earlier conversation and unsaved reasoning are not carried forward.",
			});
		const rendered = (native && !consultTool ? systemPrompt.replace(/^- Subagent:.*\r?\n/m, "") : systemPrompt).trimEnd() + "\n";
		systemChars = rendered.length;
    if (native) {
      event.systemPromptOptions.customPrompt = rendered;
      event.systemPromptOptions.cwd = workspace!.root;
      // The active prompts are taken once per decision: the system prompt is the first thing in every request, and a
      // change mid-decision made each later request of that decision miss the provider's cache (pr-01, 2026-10-14).
      decisionPrompts = promptSections();
      for (const prompt of binder?.active().filter(c => c.kind === 'prompt') ?? [])
        event.systemPromptOptions.sections[`prompt_${prompt.name.replace(/[^a-zA-Z0-9_]/g, '_')}`] = prompt.body!;
      return;
    }
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

	pi.on("context", guard("context", async (event: any, ctx: ExtensionContext) => {
    if (binder) binder.boundary();
    // A view that became active at this boundary runs on the current state now, not only after the next action
    // (2026-10-13: a refinement's view showed nothing while the agent deliberated). Runs already done are skipped.
    if (nativeRuntime) nativeRuntime.observe(trajectory.length);
		const messages: any[] = event.messages ?? [];
		const lastUser = native ? nativeDecisionStart(messages) : messages.findLastIndex((message) => message?.role === "user");
		if (lastUser < 0) return undefined;
		const user = messages[lastUser];
		// Native mode: earlier decisions are a transcript in front of the current head (freezeHistory), so they stay
		// byte-identical and cacheable; ARC_THIN_NATIVE_HISTORY_CHARS > 0 puts a summary inside the head instead.
		// A compaction summary Pi made stays in front either way.
		const summarised = native && nativeHistoryChars > 0;
		const summary = summarised ? summarizeHistory(messages.slice(0, lastUser),
			{ budget: nativeHistoryChars, resultChars: historyResultChars, ...(workspace ? { save: saveHistoryResult } : {}) }) : undefined;
		// Native mode builds the head of a decision once and keeps it byte-identical until the decision ends: the
		// provider reuses its cached prefix only while everything before the newest message is unchanged. Rebuilding it
		// per request (run time left, last request size, refreshed memory) dropped the cache hit rate to ~1% on
		// 2026-10-14. Changes made during the decision reach the agent in the results of the calls that made them.
		const headKey = `${decision}:${lastUser}`;
		if (!native || run.headKey !== headKey) {
			if (native && workspace) workspace.runtimeWrite('data/memory.md', renderMemory(memory, trajectory.length, trajectory.map(actionLabel), { ...components(), checkSources: true }) + '\n');
			if (native || !run.workingSet) run.workingSet = buildWorkingSet(ctx, summarised ? summary!.text : undefined);
			const capabilities = binder ? [binder.index(currentLevel()),
				nativeRuntime ? await nativeRuntime.observerText() : ''].filter(Boolean).join('\n') : '';
			run.head = {
				...user,
				content: [
					{ type: "text", text: `${messageText(user)}\n\n${run.workingSet!.text}${capabilities ? '\n\n' + capabilities : ''}` },
					...(run.workingSet!.images ?? (run.workingSet!.image ? [run.workingSet!.image] : [])),
				],
			};
			run.headKey = headKey;
		}
		const head = { ...run.head, content: run.head.content.map((block: any) => ({ ...block })) };
		const prefix = summarised ? messages.slice(0, lastUser).filter((message) => message?.role === "compactionSummary").slice(-1) : [];
		const history = native ? (summarised ? prefix : replayReasoning ? projectNativeHistory(messages.slice(0, lastUser), true)
			: freezeHistory(messages.slice(0, lastUser), { resultChars: historyResultChars, collapseRepeats, ...(workspace ? { save: saveHistoryResult } : {}) }))
      : continuity === "session" && !control ? historyMessages(messages, lastUser) : [];
		// The current decision keeps its reasoning between tool rounds (Continual Harness preserves "the local reasoning
		// chain" until the next state change; Qwen's chat template renders reasoning only after the last user message).
		// Stripping it made every round re-derive what the previous one had settled (2026-10-13). Earlier decisions
		// still carry none.
		const recovery = messages.slice(lastUser + 1).filter(m => m.role === 'user').map(messageText).join('\n');
		if (native && recovery) head.content[0].text += '\n\n' + recovery;
		// Within a decision the projection only appends, so the provider's cached prefix stays valid: reasoning is either
		// all kept ("all"), replaced by the model's own short <carry> fields ("fields": the Responses route keeps the
		// reasoning itself in the stored response, so re-sending its text only grows the request) or all dropped
		// (ARC_THIN_REASONING_MODE=none), and earlier results are not replaced by archive stubs (ARC_THIN_ARCHIVE_RESULTS=1
		// restores that). "recent" reasoning and archiving rewrite earlier messages on every request; with them the
		// 2026-10-14 pilots reached a 1-2% cache hit rate.
		const projected = native ? [...projectNativeHistory(history, replayReasoning),
			...projectNativeDecision([head, ...messages.slice(lastUser + 1).filter(m => m.role !== 'user')], {
        reasoning: replayReasoning ? 'all' : decisionReasoning ? reasoningMode as 'all' | 'recent' | 'fields' | 'none' : 'none',
        fullResults: 2, carryChars: carryFieldChars, ...(archiveResults ? { archive: archiveResult } : {}) })]
      : [...history, head, ...messages.slice(lastUser + 1).map(truncateToolResult)];
		lastContextChars = projected.reduce((n, message) => n + messageText(message).length, 0) + systemChars;
		// Developer-only accounting, never added to the model context.
		// JSON characters exclude image bytes and are not a tokenizer estimate.
		try {
			const active = new Set(pi.getActiveTools());
			const tools = pi.getAllTools?.().filter((tool) => active.has(tool.name))
				.map(({ name, description, parameters }) => ({ name, description, parameters }));
			append("context_budget.jsonl", {
				decision, system_chars: systemChars, foundation: native ? 'native' : 'legacy', observation_delivery: observationMode,
        capability_index_chars: binder?.index(currentLevel()).length ?? 0,
        active_prompt_chars: binder?.active().filter(c => c.kind === 'prompt').reduce((n, c) => n + (c.body?.length ?? 0), 0) ?? 0,
        agent_tool_schemas: binder?.active().filter(c => c.kind === 'tool').map(c => ({ name: c.name, chars: JSON.stringify(c.parameters).length })) ?? [],
				tools_json_chars: tools ? JSON.stringify(tools).length : null,
				tool_names: [...active], messages: projected.length, history_messages: history.length,
				...(native ? { history_mode: summarised ? 'summary' : 'transcript' } : {}),
				history_text_chars: summary ? summary.text.length : history.reduce((n, message) => n + messageText(message).length, 0),
				...(summary ? { history_decisions: summary.decisions, history_omitted: summary.omitted } : {}),
				message_text_chars: projected.reduce((n, message) => n + messageText(message).length, 0),
				reasoning_chars: projected.reduce((n, message) => n + (Array.isArray(message.content)
					? message.content.filter((block: any) => block.type === "thinking").reduce((m: number, block: any) => m + String(block.thinking ?? "").length, 0) : 0), 0),
				// Whether the short fields the agent is asked to write actually reach the next request of this decision:
				// one count per projected message that has a <carry> block, and one per assistant message that called a
				// tool without leaving any. Non-compliance is visible here instead of being patched silently.
				...(native ? { decision_reasoning_mode: reasoningMode,
					carry_blocks: projected.filter(message => carryText(messageText(message))).length,
					carry_missing: projected.filter(message => message.role === 'assistant' && !carryText(messageText(message))
						&& (Array.isArray(message.content) ? message.content : []).some((block: any) => block.type === 'toolCall')).length } : {}),
				images: projected.reduce((n, message) => n + (Array.isArray(message.content)
					? message.content.filter((block: any) => block.type === "image").length : 0), 0),
			});
		} catch (error) { logError("context:budget", error); }
		return { messages: projected };
	}));

  /** The active prompts as system-prompt sections. */
  const promptSections = (): Record<string, string> => Object.fromEntries((binder?.active() ?? []).filter(c => c.kind === 'prompt').map(c =>
    [`prompt_${c.name.replace(/[^a-zA-Z0-9_]/g, '_')}`, `<prompt_${c.name.replace(/[^a-zA-Z0-9_]/g, '_')}>\n${c.body}\n</prompt_${c.name.replace(/[^a-zA-Z0-9_]/g, '_')}>`]));
  /** The prompt sections fixed at the start of the current decision (native mode); undefined before the first. */
  let decisionPrompts: Record<string, string> | undefined;
  if (binder) pi.on('context_with_system', (event: any) => {
    const current = getCurrentSystemMessage(event.messages)?.sections ?? {};
    const desired = native && decisionPrompts ? decisionPrompts : promptSections();
    const patch: Record<string, string | null> = {};
    for (const key of new Set([...Object.keys(current).filter(k => k.startsWith('prompt_')), ...Object.keys(desired)]))
      if (current[key] !== desired[key]) patch[key] = desired[key] ?? null;
    return Object.keys(patch).length ? { messages: [...event.messages, { role: 'system', content: '', sections: patch, timestamp: Date.now() }] } : undefined;
  });
  if (nativeRuntime) pi.on('session_shutdown', () => nativeRuntime?.close());
	pi.on("before_provider_request", guard("before_provider_request", (event: any, ctx: any) => {
		if (native) {
			if (parentRequest) requestTrace.finish(parentRequest);
			parentRequest=requestTrace.start('parent',decision);
		}
		// Audit the actual wire policy without credentials, model content or image data.
		const payload = event.payload ?? {};
		// The runner explicitly declares the parent policy; an omitted registry field otherwise inherits 16,384.
		const outputPolicy = process.env.ARC_THIN_PARENT_OUTPUT_TOKENS;
		if (native && outputPolicy !== undefined) {
			const limit = Number(outputPolicy);
			if (!Number.isInteger(limit) || limit < 0) throw Error('invalid parent output-token policy');
			if (!limit) { delete payload.max_tokens; delete payload.max_completion_tokens; delete payload.max_output_tokens; }
			else if (ctx.model?.api === 'openai-responses') payload.max_output_tokens = limit;
			else if ('max_completion_tokens' in payload) payload.max_completion_tokens = limit;
			else payload.max_tokens = limit;
		}
		append("provider_policy.jsonl", {
			decision, max_tokens: payload.max_output_tokens ?? payload.max_tokens ?? payload.max_completion_tokens ?? null,
			enable_thinking: payload.enable_thinking ?? payload.chat_template_kwargs?.enable_thinking ?? null,
			reasoning_effort: payload.reasoning?.effort ?? payload.reasoning_effort ?? null,
		});
		if (ctx.model?.api === 'openai-responses' && process.env.ARC_THIN_RESPONSES_CONTINUATION !== '0') {
			const projection = responsesContinuation.project(payload, `${decision}:${ctx.model.provider}:${ctx.model.id}`);
			append('responses_transport.jsonl', { decision, ...projection.audit,
				wire_json_chars: JSON.stringify(projection.payload).length, recordedAt: new Date().toISOString() });
			return projection.payload;
		}
	}));
	if (native) {
    pi.on('before_provider_headers',()=>{
      if(parentRequest)requestTrace.note(parentRequest,'provider_headers_ready');
    });
    pi.on('after_provider_response',(event:any)=>{
      if(parentRequest)requestTrace.headers(parentRequest,event.status);
    });
		pi.on('message_update', (event:any) => {
			if (parentRequest) requestTrace.chunk(parentRequest, typeof event.assistantMessageEvent?.delta==='string' ? event.assistantMessageEvent.delta.length : 0);
		});
		pi.on('message_start', (event:any) => {
			if (parentRequest && event.message?.role==='assistant') requestTrace.note(parentRequest,'pi_message_start');
		});
	}

	pi.on("message_end", guard("message_end", (event: any) => {
		const message = event.message;
		if (message?.role !== "assistant") return undefined;
		responsesContinuation.accept(message);
		run.assistantMessages += 1;
		run.endedAt = Date.now();
		if (message.stopReason !== "error" && message.stopReason !== "aborted") run.answered = true;
		const blocks: any[] = Array.isArray(message.content) ? message.content : [];
		if (blocks.some((block) => block?.type === "toolCall" && block.name === "arc_action"))
			run.endBatchAt = run.assistantMessages;
		if (carryChars) {
			const pick = (type: string, field: string) => blocks.filter((block) => block?.type === type && typeof block[field] === "string")
				.map((block) => block[field]).join("\n").trim();
			const said = pick("thinking", "thinking") || pick("text", "text");
			if (said) run.reasoning.push(said);
		}
		for (const block of blocks) if (block?.type === "thinking" && typeof block.thinking === "string") {
			const counted = coordinateSentences(block.thinking);
			run.reasoningSentences += counted.sentences; run.coordinateSentences += counted.coordinate;
		}
		appendUsage("agent", message);
		return undefined;
	}));

	// Refusals returned as terminating results are still errors to the model.
	pi.on("tool_result", guard("tool_result", (event: any) =>
		(event.details as { refused?: boolean } | undefined)?.refused ? { isError: true } : undefined));
  if (workspace) pi.on('tool_result', (event: any) => {
    // Exact readback is explicitly ranged by the caller; do not replace it with another receipt. An unranged read is
    // capped like any other result and points back at the file itself (kernel-02: one unranged read of an 18k-char
    // result was re-sent in six requests).
    if (event.toolName === 'read' && (event.input?.offset != null || event.input?.limit != null)) return;
    const source = event.toolName === 'read' ? String(event.input?.path ?? '').replace(/\\/g, '/') || undefined : undefined;
    const content = event.content.map((block: any) => block.type === 'text'
      ? { ...block, text: workspace.receipt(block.text, event.isError ? 'error' : 'ok', [], source) } : block);
    return { content };
  });
}
