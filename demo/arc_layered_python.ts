import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity } from "./pi_task_python.ts";
import { PythonKernel, type KernelRequest } from "./pi_task_python_kernel.ts";

export type LayeredConfig = { numericGrid: boolean; undo: boolean;
  timeoutMs: number; outputChars: number; maxActionsPerCall: number; workDir: string; competition: boolean;
  skipNoops?: boolean; expect?: boolean; graph?: boolean; miniReview?: { maxPerLevel?: number; repeatTries?: number;
    repeatDeaths?: number } };
export type LayeredState = { level: number; levels_completed: number; win_levels: number; state: string;
  step: number; actions_used: number; budget_left?: number; level_budget?: number; level_budget_left?: number;
  valid_actions: string[]; frame: number[][];
  stale_steps: number; unchecked_batches: number; mini_review: string | null;
  action_invariant?: string; causal_briefing?: string };
export type ActionBatch = { executed: number; actions: string[]; lines: string[]; stop_reason?: string;
  level_changed: boolean; game_over: boolean; win: boolean; reset?: boolean; surprise?: boolean; expect_hits?: string | null;
  steps?: StepFact[]; notes?: string[] };
export type StepFact = { step: number; action: string; tries: number; same: boolean; last_try: number;
  new: boolean; level: number; changed: boolean; death: boolean; level_up: boolean;
  source: string | null; fatal: boolean; claims_failed: string[]; claims_held: string[];
  verify_failed?: string[]; changed_cells?: number; change_box?: [number, number, number, number] | null;
  branch_handoff?: { tool: string; suggested: string; actual: string; comparable: boolean; matched?: boolean; plan_index?: number; plan_length?: number; aligned: boolean; repeat_mismatch: boolean };
  changed_symbols?: number[];
  predict_off: number | null; same_death: boolean | number | null; region_tries?: number; ineffective_regions?: number };
export type ShownImage = { grid: number[][]; scale?: number | null };
export type PythonOutcome = { text: string; truncated: boolean; acted: ActionBatch | null; images: ShownImage[]; error?: string; typeCard?: string; environmentError?: string;
  kernelRestarted?: boolean; metrics: Record<string, number>; notes?: string[]; steps?: StepFact[]; decoratedTools?: string[];
  usedLibs?: string[] };
export type MemoryCheckStats = Record<string, { support: number; counter: number; checked: number;
  by_level: Record<string, { support: number; counter: number; checked?: number }>; witness: string | null; error: string | null; unscoped?: boolean }>;

export const COLOR_LEGEND = "W=white, w=light gray, g=gray, G=dark gray, c=charcoal, B=black, M=magenta, P=pink, " +
  "R=red, b=blue, S=sky blue, Y=yellow, O=orange, r=dark red, N=light green, p=purple";
const NATURAL: Record<string, string> = { ACTION1: "UP", ACTION2: "DOWN", ACTION3: "LEFT", ACTION4: "RIGHT",
  ACTION5: "SPACE", ACTION6: "MOUSE", ACTION7: "UNDO", RESET: "RESET" };
const RAW = Object.fromEntries(Object.entries(NATURAL).map(([raw, name]) => [name, raw]));
const FILE_BYTES = 256 * 1024, WORK_BYTES = 4 * 1024 * 1024;

const hashGrid = (grid: number[][]) => {
  let value = 2166136261;
  for (const row of grid) for (const cell of row) value = Math.imul(value ^ cell, 16777619) >>> 0;
  return value.toString(16).padStart(8, "0");
};

export class BridgeClient {
  constructor(private baseUrl: string, private token: string) {}
  private async call(path: string, body?: unknown) {
    const response = await fetch(this.baseUrl + path, body === undefined ? undefined : { method: "POST",
      headers: { "Content-Type": "application/json", "X-ARC-Action-Token": this.token }, body: JSON.stringify(body) });
    const data: any = await response.json();
    if (!response.ok) throw Object.assign(new Error(String(data.error ?? response.status)), { status: response.status });
    return data;
  }
  state() { return this.call("/state"); }
  act(call: { action: string; x?: number; y?: number; reasoning?: string }) { return this.call("/action", call); }
}

export class LayeredPython {
  runtimeTypeCard = "";
  private kernel: PythonKernel;
  private history: Array<Record<string, unknown>> = [];
  private transitionResults: Array<Record<string, unknown>> = [];
  private sent = 0;
  private raw: any;
  private lastResult: Record<string, unknown> = {};
  private lastAction?: string;
  private workDir: string;
  private heartbeat: string;
  private seenHashes = new Set<string>();
  private stale = 0;
  private interiorStale = 0;
  private actionInvariant = "";
  private causalBriefing = "";
  private stepsSinceLevel = 0;
  private resets = 0;
  private gameOvers = 0;
  private recentLines: string[] = [];
  private seenSequences = new Set<string>();
  private repeatedSequences = 0;
  private surprises = 0;
  private modelReport: {
    funcs?: string[];
    tested: number;
    correct: number;
    by_level?: Record<string, { tested: number; correct: number }>;
    live?: Record<string, { tested: number; correct: number }>;
    last_fail?: { step: number; action: string; off: number; level: number } | null;
    runtime_error?: string | null;
    error?: string;
  } | null = null;
  private claimStats: Record<string, { support: number; counter: number; checked: number; levels: number[];
    by_level: Record<string, { support: number; counter: number; checked: number }>; last_fail?: number | null; witness?: string }> = {};
  private unchecked = 0;
  private expectHits: string | null = null;
  private errors: string[] = [];
  private calls = 0;
  private batchHadExpect = false;
  private miniReview: string | null = null;
  private consecutivePythonErrors = 0;
  private failedFileEdits = new Map<string, number>();
  private miniReviewsThisLevel = 0;
  private keyTries = new Map<string, number>();
  private keyDeaths = new Map<string, number>();
  private sourceRepeats = new Map<string, number>();
  private levelStartBudgetLeft: number | undefined;
  private capabilityUsage: Record<string, { loaded: number; invoked: number; action_producing: number }> = {};
  private memoryChecks: Array<{ id: string; expr: string }> = [];
  memoryCheckStats: MemoryCheckStats = {};

  constructor(private bridge: BridgeClient, private config: LayeredConfig) {
    const limits = { timeout_ms: config.timeoutMs };
    this.kernel = new PythonKernel({ format: TASK_PYTHON_FORMAT, limits, effective_limits: taskPythonLimits(limits),
      runtime: taskPythonRuntimeIdentity(), source: readFileSync(new URL("./arc_layered_prelude.py", import.meta.url), "utf8") });
    this.workDir = resolve(config.workDir);
    mkdirSync(this.workDir, { recursive: true });
    this.heartbeat = resolve(this.workDir, "..", "harness", "heartbeat");
    mkdirSync(dirname(this.heartbeat), { recursive: true });
  }

  private entry(action: string, raw: any) {
    return { action, frames: raw.frames, level: Math.min(raw.levels_completed + 1, raw.win_levels), step: raw.action_budget?.total_used ?? 0,
      state: raw.state, levels_completed: raw.levels_completed, win_levels: raw.win_levels };
  }
  private valid(raw: any) {
    const names = (raw.agent_available_actions as string[]).filter(name => this.config.undo || name !== "ACTION7");
    return raw.state === "GAME_OVER" ? names.filter(name => name === "RESET" || name === "ACTION7") : names;
  }

  async init() {
    this.raw = await this.bridge.state();
    this.history = [this.entry("", this.raw)];
    this.seenHashes.add(hashGrid(this.raw.frames.at(-1)));
    this.levelStartBudgetLeft = this.state().budget_left;
    this.kernel.prewarm();
    return this.state();
  }

  state(): LayeredState {
    const raw = this.raw, budget = raw.action_budget ?? {};
    return { level: Math.min(raw.levels_completed + 1, raw.win_levels), levels_completed: raw.levels_completed, win_levels: raw.win_levels,
      state: raw.state, step: budget.total_used ?? 0, actions_used: budget.total_used ?? 0,
      budget_left: budget.total_maximum == null ? undefined : budget.total_maximum - budget.total_used,
      level_budget: budget.maximum == null ? undefined : budget.maximum,
      level_budget_left: budget.maximum == null ? undefined : budget.maximum - (budget.used ?? 0),
      valid_actions: this.valid(raw).map(name => NATURAL[name] ?? name), frame: raw.frames.at(-1),
      stale_steps: Math.max(this.stale, this.interiorStale),
      unchecked_batches: this.unchecked, mini_review: this.miniReview,
      ...(this.actionInvariant ? { action_invariant: this.actionInvariant } : {}),
      ...(this.causalBriefing ? { causal_briefing: this.causalBriefing } : {}) };
  }

  takeMiniReview() {
    const review = this.miniReview;
    this.miniReview = null;
    return review;
  }

  /** Evidence about the run itself, bound as the read-only `harness_state` variable at the start of every call. */
  private harnessState() {
    const state = this.state();
    let files: Array<{ path: string; bytes: number }> = [];
    try {
      files = (readdirSync(this.workDir, { recursive: true }) as string[]).map(name => join(this.workDir, name))
        .filter(path => statSync(path).isFile())
        .map(path => ({ path: "work/" + path.slice(this.workDir.length + 1).replace(/\\/g, "/"), bytes: statSync(path).size }));
    } catch {}
    return {
      progress: { stale_steps: this.stale, steps_since_level: this.stepsSinceLevel, level: state.level,
        levels_completed: state.levels_completed, resets: this.resets, game_overs: this.gameOvers },
      attempts: { recent: this.recentLines.slice(-12), repeated_sequences: this.repeatedSequences },
      predictions: { expect_hits: this.expectHits, surprises: this.surprises, unchecked_batches: this.unchecked },
      ...(this.modelReport ? { model: this.modelReport } : {}),
      claims: this.claimStats,
      capabilities: this.capabilitySummary(),
      errors: this.errors.slice(-5),
      artifacts: files.slice(0, 20),
      cost: { actions_used: state.actions_used, budget_left: state.budget_left ?? null,
        level_budget_left: state.level_budget_left ?? null, python_calls: this.calls },
    };
  }

  private capabilitySummary() {
    const result: Record<string, unknown> = {};
    for (const [name, stats] of Object.entries(this.capabilityUsage)) result[name] = stats;
    for (const [name, stats] of Object.entries(this.claimStats)) {
      const key = `claims/${name}`;
      result[key] = { ...(result[key] as object ?? {}), loaded: 1, invoked: stats.checked,
        action_producing: stats.support + stats.counter };
    }
    if (this.modelReport) result.model = { loaded: 1, invoked: this.modelReport.tested,
      action_producing: this.modelReport.correct };
    return result;
  }

  /** R7 proxy quantities for the always-on gradient line. */
  gradient() {
    const state = this.state();
    return { actions_this_level: this.stepsSinceLevel, budget_left: state.budget_left,
      level_budget: state.level_budget, level_budget_left: state.level_budget_left,
      surprises: this.surprises, unchecked_batches: this.unchecked, repeated_sequences: this.repeatedSequences,
      expect_hits: this.expectHits,
      model: this.modelReport ? `${this.modelReport.correct}/${this.modelReport.tested}` : undefined };
  }

  capabilitySnapshot() {
    return { claims: this.claimStats, model: this.modelReport };
  }

  private scanClaims(): Array<{ name: string; source: string }> {
    const dir = join(this.workDir, "claims");
    const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".py")) : [];
    return files.map(file => {
      const name = file.slice(0, -3), source = readFileSync(join(dir, file), "utf8");
      return { name, source };
    });
  }

  private scanModelSource(): string | undefined {
    const target = join(this.workDir, "model.py");
    return existsSync(target) ? readFileSync(target, "utf8") : undefined;
  }

  private scanLib(): Array<{ name: string; source: string }> {
    const dir = join(this.workDir, "lib");
    const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".py")).sort() : [];
    return files.map(file => ({ name: file.slice(0, -3), source: readFileSync(join(dir, file), "utf8") }));
  }

  private startupSource(): string | undefined {
    const path = join(this.workDir, "startup.py");
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  async syncMemoryChecks(checks: Array<{ id: string; expr: string }>): Promise<MemoryCheckStats> {
    this.memoryChecks = checks;
    if (!this.raw) return this.memoryCheckStats;
    if (!this.kernel.alive) this.sent = 0;
    const request = { sync_only: true, code: "", memory_checks: checks, new_history: this.history.slice(this.sent),
      reset_history: this.sent === 0, numeric_grid: this.config.numericGrid, valid_actions: this.state().valid_actions,
      valid_actions_raw: this.valid(this.raw), last_action_result: this.lastResult, harness_state: this.harnessState(),
      startup_source: this.startupSource(), model_source: this.scanModelSource(),
      claims: this.scanClaims(), lib: this.scanLib(), transition_results: this.transitionResults };
    const result = await this.kernel.run(request, async req => this.file(req));
    this.sent = this.history.length;
    if (result.result.type_card) this.runtimeTypeCard = result.result.type_card;
    if ("model" in result.result) this.modelReport = result.result.model ?? null;
    this.memoryCheckStats = result.result.memory_checks ?? {};
    return this.memoryCheckStats;
  }

  async validateMemoryChecks(checks: Array<{ id: string; expr: string }>): Promise<MemoryCheckStats> {
    if (!this.raw) throw new Error("Python kernel has no current state");
    if (!this.kernel.alive) this.sent = 0;
    const request = { sync_only: true, code: "", validate_memory_checks: checks, new_history: this.history.slice(this.sent),
      reset_history: this.sent === 0, numeric_grid: this.config.numericGrid, valid_actions: this.state().valid_actions,
      valid_actions_raw: this.valid(this.raw), last_action_result: this.lastResult, harness_state: this.harnessState(),
      startup_source: this.startupSource(), model_source: this.scanModelSource(),
      claims: this.scanClaims(), lib: this.scanLib(), transition_results: this.transitionResults };
    const result = await this.kernel.run(request, async req => this.file(req));
    this.sent = this.history.length;
    return result.result.memory_checks ?? {};
  }

  private triage(steps: StepFact[]) {
    const rules = this.config.miniReview ?? {};
    const maxPerLevel = rules.maxPerLevel ?? 2, repeatTries = rules.repeatTries ?? 3;
    if (this.miniReviewsThisLevel >= maxPerLevel) return;
    const death = steps.find(fact => fact.same_death);
    if (death) { this.miniReviewsThisLevel += 1; this.miniReview = `same death: ${death.action} at step ${death.step}`; return; }
    const repeated = steps.find(fact => fact.tries >= repeatTries);
    if (repeated) { this.miniReviewsThisLevel += 1; this.miniReview = `same state + action: ${repeated.action} at step ${repeated.step}`; }
  }

  private async act(request: KernelRequest, batch: ActionBatch & { halt?: string; environmentError?: string }) {
    const call = request.call as { action: string; x?: number; y?: number; reasoning?: string };
    const name = call.action, raw = RAW[name] ?? name;
    if (request.expect != null) this.batchHadExpect = true;
    const refuse = (stopped: string) => { batch.stop_reason ??= stopped; return { stopped }; };
    if (batch.halt) return refuse(`previous_${batch.halt}`);
    if (batch.executed >= this.config.maxActionsPerCall) return refuse(`the limit of ${this.config.maxActionsPerCall} actions per call was reached`);
    if (raw === "ACTION7" && !this.config.undo) return refuse("UNDO is not available");
    if (this.raw.state === "GAME_OVER" && raw !== "RESET") return refuse("the game is over: only RESET is allowed");
    if (raw === "RESET" && this.lastAction === "RESET" && !this.config.competition && !request.confirm_full_reset)
      return refuse("a second consecutive RESET restarts the whole game: pass confirm_full_reset=True if you mean it");
    const payload: Record<string, unknown> = { action: raw };
    if (raw === "ACTION6") Object.assign(payload, { x: call.x, y: call.y });
    if (call.reasoning) payload.reasoning = call.reasoning;
    let after: any;
    try { after = await this.bridge.act(payload as any); } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== undefined && status < 500) return refuse(`refused: ${(error as Error).message}`);
      batch.environmentError = String((error as Error).message ?? error);
      batch.halt = "environment_error";
      return refuse(`refused: ${batch.environmentError}`);
    }
    writeFileSync(this.heartbeat, String(Date.now()));
    const before = this.raw;
    this.raw = after;
    this.lastAction = raw;
    const seen = hashGrid(after.frames.at(-1));
    if (this.seenHashes.has(seen)) this.stale += 1;
    else { this.seenHashes.add(seen); this.stale = 0; }
    if (raw === "RESET") this.resets += 1;
    if (after.state === "GAME_OVER" && before.state !== "GAME_OVER") this.gameOvers += 1;
    const label = raw === "ACTION6" ? `MOUSE(x=${call.x},y=${call.y})` : name;
    const entry = { ...this.entry(label, after), expect: request.expect ?? null };
    this.history.push(entry);
    this.sent = this.history.length;
    const levelChanged = after.levels_completed !== before.levels_completed;
    this.stepsSinceLevel = levelChanged ? 0 : this.stepsSinceLevel + 1;
    if (levelChanged) {
      this.levelStartBudgetLeft = this.state().budget_left;
      this.interiorStale = 0; this.actionInvariant = ""; this.causalBriefing = "";
      this.keyTries.clear(); this.keyDeaths.clear(); this.sourceRepeats.clear(); this.miniReview = null; this.miniReviewsThisLevel = 0;
    }
    const result = { action: label, changed_cells: after.observation_delta?.changed_cells ?? 0, level: entry.level,
      levels_completed: after.levels_completed, state: after.state, level_changed: levelChanged,
      game_over: after.state === "GAME_OVER", win: after.state === "WIN", step: entry.step };
    this.transitionResults.push(result);
    this.lastResult = result;
    const line = `${label}: ${result.changed_cells} cells changed, level ${entry.level}, ${after.state}`;
    this.recentLines.push(line);
    this.recentLines = this.recentLines.slice(-12);
    batch.executed += 1; batch.actions.push(label); batch.lines.push(line);
    batch.level_changed ||= levelChanged; batch.game_over ||= result.game_over; batch.win ||= result.win;
    batch.halt = result.win ? "win" : result.game_over ? "game_over" : levelChanged ? "level_change" : undefined;
    if (batch.halt) batch.stop_reason ??= batch.halt;
    return { entry, result, line, halt: batch.halt, valid_actions: this.state().valid_actions, valid_actions_raw: this.valid(after),
      mini_review: this.miniReview };
  }

  private file(request: KernelRequest, parentReadonlyTools = false) {
    const clean = String(request.path).replace(/\\/g, "/");
    if (/(?:^|\/)harness\/components(?:\/|$)/i.test(clean) || (clean.includes("components/") && !clean.startsWith("work/")))
      return { error: `direct writes to component storage are blocked (${request.path}); use reflect_component(op, kind, name, ...)` };
    const relative = clean.replace(/^(\.\/|\/)?work\//, "");
    const target = resolve(this.workDir, relative);
    if (!target.startsWith(this.workDir + sep)) return { error: `only files under work/ are available: ${request.path}` };
    if (request.op === "read") return existsSync(target) ? { data: readFileSync(target, "utf8") } : { error: `no such file: ${request.path}`, missing: true };
    if (parentReadonlyTools && target.toLowerCase().startsWith((join(this.workDir, "lib") + sep).toLowerCase()))
      return { error: "Only boundary evolution can write tool files" };
    const data = String(request.data ?? ""), bytes = Buffer.byteLength(data);
    if (bytes > FILE_BYTES) return { error: `a work/ file is limited to ${FILE_BYTES} bytes (got ${bytes})` };
    const used = (readdirSync(this.workDir, { recursive: true }) as string[]).map(name => join(this.workDir, name))
      .filter(path => path !== target && statSync(path).isFile()).reduce((sum, path) => sum + statSync(path).size, 0);
    if (used + bytes > WORK_BYTES) return { error: `work/ is limited to ${WORK_BYTES} bytes in total` };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, "utf8");
    if (/^(?:model\.py|(?:claims|lib)\/[^/]+\.py)$/.test(relative)) {
      return { data: { model_source: this.scanModelSource(), claims: this.scanClaims(), lib: this.scanLib() } };
    }
    return { data: null };
  }

  async run(code: string, signal?: AbortSignal, opts?: { forbidActions?: boolean; parentReadonlyTools?: boolean; singleToolWrite?: boolean }): Promise<PythonOutcome> {
    const forbidActions = Boolean(opts?.forbidActions);
    if (!this.kernel.alive) this.sent = 0;
    const batch: ActionBatch & { halt?: string; environmentError?: string } = { executed: 0, actions: [], lines: [], level_changed: false, game_over: false, win: false };
    let attempted = false;
    if (!forbidActions) this.calls += 1;
    this.batchHadExpect = false;
    const claimSources = this.scanClaims();
    const request = { code, new_history: this.history.slice(this.sent), reset_history: this.sent === 0,
      numeric_grid: this.config.numericGrid,
      valid_actions: this.state().valid_actions, valid_actions_raw: this.valid(this.raw), last_action_result: this.lastResult,
      skip_noops: !!this.config.skipNoops, expect_enabled: !!this.config.expect, graph_enabled: !!this.config.graph,
      harness_state: this.harnessState(), forbid_actions: forbidActions, parent_readonly_tools: !!opts?.parentReadonlyTools,
      startup_source: this.startupSource(), model_source: this.scanModelSource(), claims: claimSources, lib: this.scanLib(),
      memory_checks: this.memoryChecks, transition_results: this.transitionResults };
    this.sent = this.history.length;
    let toolWrite: string | undefined;
    const onRequest = async (req: KernelRequest) => {
      if (req.t === "act") {
        if (forbidActions) return { stopped: "submit_actions is disabled during evolution review" };
        attempted = true;
        return this.act(req, batch);
      }
      if (opts?.singleToolWrite && req.op !== "read") {
        const relative = String(req.path).replace(/\\/g, "/").replace(/^(?:\.\/|\/)?work\//, "");
        const target = resolve(this.workDir, relative).toLowerCase();
        if (target.startsWith((join(this.workDir, "lib") + sep).toLowerCase())) {
          if (toolWrite && target !== toolWrite) return { error: "One tool can be changed per audit" };
          toolWrite = target;
        }
      }
      return this.file(req, opts?.parentReadonlyTools);
    };
    let run: { result: Record<string, any>; metrics: Record<string, number> } | undefined;
    let text: string, error: string | undefined, kernelRestarted = false, metrics: Record<string, number> = {}, images: ShownImage[] = [];
    let failedEditNote = "";
    try {
      run = await this.kernel.run(request, onRequest, signal);
      if (run.result.type_card) this.runtimeTypeCard = run.result.type_card;
      error = run.result.error ?? undefined;
      text = run.result.text + (error ? (run.result.text ? "\n" : "") + error : "");
      images = Array.isArray(run.result.images) ? run.result.images : [];
      if (run.result.memory_checks) this.memoryCheckStats = run.result.memory_checks;
      if (run.result.last_result) this.lastResult = run.result.last_result;
      metrics = { ...run.metrics };
      for (const note of run.result.notes ?? []) {
        const match = /^(claims\/[^ ]+|lib\/[^ ]+|model\.py) (?:failed to load|loaded)/.exec(note);
        if (!match) continue;
        const failed = note.includes("failed to load") || /back-test on [1-9]\d* transitions: applied 0/.test(note);
        const count = failed ? (this.failedFileEdits.get(match[1]) ?? 0) + 1 : 0;
        this.failedFileEdits.set(match[1], count);
        if (count === 3) failedEditNote = match[1];
      }
      if ("model" in (run.result as any)) this.modelReport = (run.result as any).model ?? null;
      for (const name of (run.result as any).claims?.reset ?? []) delete this.claimStats[name];
      const claimReport = (run.result as any).claims?.counts ?? {};
      for (const [name, counts] of Object.entries<any>(claimReport)) {
        const current = this.claimStats[name] ??= { support: 0, counter: 0, checked: 0, levels: [], by_level: {} };
        current.support += Number(counts.support ?? 0);
        current.counter += Number(counts.counter ?? 0);
        current.checked += Number(counts.checked ?? 0);
        current.last_fail = counts.last_fail ?? current.last_fail ?? null;
        current.witness = counts.witness ?? current.witness;
        for (const [level, row] of Object.entries<any>(counts.by_level ?? {})) {
          const bucket = current.by_level[level] ??= { support: 0, counter: 0, checked: 0 };
          bucket.support += Number(row.support ?? 0);
          bucket.counter += Number(row.counter ?? 0);
          bucket.checked += Number(row.checked ?? 0);
        }
        for (const level of counts.levels ?? []) if (!current.levels.includes(level)) current.levels.push(level);
      }
    } catch (problem) {
      error = String((problem as Error).message ?? problem);
      kernelRestarted = true;
      text = `${error}\nThe Python kernel ended and the next call starts a new one: names you defined are gone; files in work/ remain.`;
    }
    const truncated = text.length > this.config.outputChars;
    if (truncated) {
      const head = Math.floor(this.config.outputChars * 0.6), tail = this.config.outputChars - head;
      text = `${text.slice(0, head)}\n... [${text.length - this.config.outputChars} chars omitted from the middle] ...\n${text.slice(-tail)}` +
        `\n[output truncated: avoid printing full grids or all frames_of(); aggregate in Python (diff / anim_summary / frame_diff) and print <= 30 lines]`;
    }
    if (!forbidActions) {
      if (error) {
        this.errors.push(error.slice(0, 200));
        this.errors = this.errors.slice(-5);
      }
      this.consecutivePythonErrors = batch.executed ? 0 : error ? this.consecutivePythonErrors + 1 : 0;
      if (this.consecutivePythonErrors >= 2)
        text += `\n[cost note] ${this.consecutivePythonErrors} consecutive Python errors without an action. Check the error or restore the last working file.`;
      if (!batch.executed && failedEditNote)
        text += `\n[cost note] ${failedEditNote} has failed three consecutive edits. Review the error before revising it again.`;
    }
    if (attempted) {
      const state = this.state();
      text += `\n[env] executed ${batch.executed}${batch.actions.length ? ` (${batch.actions.join(" ")})` : ""}` +
        `${batch.stop_reason ? `, stopped: ${batch.stop_reason}` : ""} | level ${state.level}/${state.win_levels} ${state.state}` +
        ` | step ${state.step}${state.budget_left === undefined ? "" : `, budget left ${state.budget_left}`} | valid: ${state.valid_actions.join(" ")}`;
    }
    const { halt: _halt, ...acted } = batch;
    if (batch.executed) {
      const key = batch.actions.join(">");
      if (batch.actions.length >= 2 && this.seenSequences.has(key)) this.repeatedSequences += 1;
      this.seenSequences.add(key);
      if (acted.surprise) this.surprises += 1;
      this.unchecked = this.batchHadExpect ? 0 : this.unchecked + 1;
      if (acted.expect_hits) this.expectHits = acted.expect_hits;
    }
    const lastSummary: any = this.lastResult;
    if (batch.executed && lastSummary && typeof lastSummary === "object") {
      if (lastSummary.surprise) acted.surprise = true;
      if (lastSummary.expect_hits) acted.expect_hits = lastSummary.expect_hits;
    }
    const notes = Array.isArray((run?.result as any)?.notes) ? (run?.result as any).notes.map(String) : [];
    const steps: StepFact[] = Array.isArray((run?.result as any)?.steps) ? (run?.result as any).steps : [];
    if (typeof (run?.result as any)?.action_invariant === "string") this.actionInvariant = (run?.result as any).action_invariant;
    if (typeof (run?.result as any)?.causal_briefing === "string") this.causalBriefing = (run?.result as any).causal_briefing;
    for (const fact of steps) this.interiorStale = fact.new ? 0 : this.interiorStale + 1;
    if (steps.length) this.triage(steps);
    for (const fact of steps) if (fact.source) {
      const stats = this.capabilityUsage[fact.source] ??= { loaded: 1, invoked: 0, action_producing: 0 };
      stats.invoked += 1;
      if (fact.action) stats.action_producing += 1;
    }
    if (notes.length) acted.notes = notes;
    if (steps.length) acted.steps = steps;
    return { text, truncated, acted: batch.executed ? acted : null, images, ...(error ? { error } : {}), ...(batch.environmentError ? { environmentError: batch.environmentError } : {}), typeCard: this.runtimeTypeCard,
      ...(kernelRestarted ? { kernelRestarted } : {}), metrics: { ...metrics, actions: batch.executed }, notes, steps,
      decoratedTools: Array.isArray(run?.result?.decorated_tools) ? run.result.decorated_tools : [],
      usedLibs: Array.isArray(run?.result?.used_libs) ? run.result.used_libs : [] };
  }

  close() { this.kernel.close(); }
}
