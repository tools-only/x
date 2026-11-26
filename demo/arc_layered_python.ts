import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity } from "./pi_task_python.ts";
import { PythonKernel, type KernelRequest } from "./pi_task_python_kernel.ts";

export type LayeredConfig = { numericGrid: boolean; namespaceResetPerCall: boolean; undo: boolean;
  timeoutMs: number; outputChars: number; maxActionsPerCall: number; workDir: string; competition: boolean;
  skipNoops?: boolean; expect?: boolean; graph?: boolean; miniReview?: { maxPerLevel?: number; repeatTries?: number;
    repeatDeaths?: number } };
export type LayeredState = { level: number; levels_completed: number; win_levels: number; state: string;
  step: number; actions_used: number; budget_left?: number; level_budget?: number; level_budget_left?: number;
  valid_actions: string[]; frame: number[][];
  stale_steps: number; unchecked_batches: number; mini_review: string | null };
export type ActionBatch = { executed: number; actions: string[]; lines: string[]; stop_reason?: string;
  level_changed: boolean; game_over: boolean; win: boolean; surprise?: boolean; expect_hits?: string | null;
  steps?: StepFact[]; notes?: string[] };
export type StepFact = { step: number; action: string; tries: number; same: boolean; last_try: number;
  new: boolean; level: number; changed: boolean; death: boolean; level_up: boolean;
  source: string | null; fatal: boolean; claims_failed: string[]; claims_held: string[];
  predict_off: number | null; same_death: boolean };
export type ShownImage = { grid: number[][]; scale?: number | null };
export type PythonOutcome = { text: string; truncated: boolean; acted: ActionBatch | null; images: ShownImage[]; error?: string;
  kernelRestarted?: boolean; metrics: Record<string, number>; notes?: string[]; steps?: StepFact[] };

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
    if (!response.ok) throw new Error(String(data.error ?? response.status));
    return data;
  }
  state() { return this.call("/state"); }
  act(call: { action: string; x?: number; y?: number; reasoning?: string }) { return this.call("/action", call); }
}

export class LayeredPython {
  private kernel: PythonKernel;
  private history: Array<Record<string, unknown>> = [];
  private sent = 0;
  private raw: any;
  private lastResult: Record<string, unknown> = {};
  private lastAction?: string;
  private workDir: string;
  private heartbeat: string;
  private seenHashes = new Set<string>();
  private stale = 0;
  private stepsSinceLevel = 0;
  private resets = 0;
  private gameOvers = 0;
  private recentLines: string[] = [];
  private seenSequences = new Set<string>();
  private repeatedSequences = 0;
  private surprises = 0;
  private modelReport: { tested: number; correct: number; error?: string } | null = null;
  private claimStats: Record<string, { support: number; counter: number; checked: number; levels: number[]; last_fail?: number | null }> = {};
  private unchecked = 0;
  private expectHits: string | null = null;
  private errors: string[] = [];
  private calls = 0;
  private batchHadExpect = false;
  private miniReview: string | null = null;
  private miniReviewsThisLevel = 0;
  private keyTries = new Map<string, number>();
  private keyDeaths = new Map<string, number>();
  private sourceRepeats = new Map<string, number>();
  private levelStartBudgetLeft: number | undefined;

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
      valid_actions: this.valid(raw).map(name => NATURAL[name] ?? name), frame: raw.frames.at(-1), stale_steps: this.stale,
      unchecked_batches: this.unchecked, mini_review: this.miniReview };
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
      errors: this.errors.slice(-5),
      artifacts: files.slice(0, 20),
      cost: { actions_used: state.actions_used, budget_left: state.budget_left ?? null,
        level_budget_left: state.level_budget_left ?? null, python_calls: this.calls },
    };
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

  private triage(steps: StepFact[]) {
    const rules = this.config.miniReview ?? {};
    const maxPerLevel = rules.maxPerLevel ?? 2, repeatTries = rules.repeatTries ?? 3;
    if (this.miniReviewsThisLevel >= maxPerLevel) return;
    const death = steps.find(fact => fact.same_death);
    if (death) { this.miniReviewsThisLevel += 1; this.miniReview = `same death: ${death.action} at step ${death.step}`; return; }
    const repeated = steps.find(fact => fact.tries >= repeatTries);
    if (repeated) { this.miniReviewsThisLevel += 1; this.miniReview = `same state + action: ${repeated.action} at step ${repeated.step}`; }
  }

  private async act(request: KernelRequest, batch: ActionBatch & { halt?: string }) {
    writeFileSync(this.heartbeat, String(Date.now()));
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
    try { after = await this.bridge.act(payload as any); } catch (error) { return refuse(`refused: ${(error as Error).message}`); }
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
      this.keyTries.clear(); this.keyDeaths.clear(); this.sourceRepeats.clear(); this.miniReview = null; this.miniReviewsThisLevel = 0;
    }
    const result = { action: label, changed_cells: after.observation_delta?.changed_cells ?? 0, level: entry.level,
      levels_completed: after.levels_completed, state: after.state, level_changed: levelChanged,
      game_over: after.state === "GAME_OVER", win: after.state === "WIN", step: entry.step };
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

  private file(request: KernelRequest) {
    const relative = String(request.path).replace(/\\/g, "/").replace(/^(\.\/|\/)?work\//, "");
    const target = resolve(this.workDir, relative);
    if (!target.startsWith(this.workDir + sep)) return { error: `only files under work/ are available: ${request.path}` };
    if (request.op === "read") return existsSync(target) ? { data: readFileSync(target, "utf8") } : { error: `no such file: ${request.path}`, missing: true };
    const data = String(request.data ?? ""), bytes = Buffer.byteLength(data);
    if (bytes > FILE_BYTES) return { error: `a work/ file is limited to ${FILE_BYTES} bytes (got ${bytes})` };
    const used = (readdirSync(this.workDir, { recursive: true }) as string[]).map(name => join(this.workDir, name))
      .filter(path => path !== target && statSync(path).isFile()).reduce((sum, path) => sum + statSync(path).size, 0);
    if (used + bytes > WORK_BYTES) return { error: `work/ is limited to ${WORK_BYTES} bytes in total` };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, "utf8");
    return { data: null };
  }

  async run(code: string, signal?: AbortSignal): Promise<PythonOutcome> {
    if (!this.kernel.alive) this.sent = 0;
    const batch: ActionBatch & { halt?: string } = { executed: 0, actions: [], lines: [], level_changed: false, game_over: false, win: false };
    let attempted = false;
    this.calls += 1;
    this.batchHadExpect = false;
    const claimSources = this.scanClaims();
    const request = { code, new_history: this.history.slice(this.sent), reset_history: this.sent === 0,
      reset_namespace: this.config.namespaceResetPerCall, numeric_grid: this.config.numericGrid,
      valid_actions: this.state().valid_actions, valid_actions_raw: this.valid(this.raw), last_action_result: this.lastResult,
      skip_noops: !!this.config.skipNoops, expect_enabled: !!this.config.expect, graph_enabled: !!this.config.graph,
      harness_state: this.harnessState(),
      startup_source: this.startupSource(), model_source: this.scanModelSource(), claims: claimSources, lib: this.scanLib() };
    this.sent = this.history.length;
    const onRequest = async (req: KernelRequest) => req.t === "act" ? (attempted = true, this.act(req, batch)) : this.file(req);
    let run: { result: Record<string, any>; metrics: Record<string, number> } | undefined;
    let text: string, error: string | undefined, kernelRestarted = false, metrics: Record<string, number> = {}, images: ShownImage[] = [];
    try {
      run = await this.kernel.run(request, onRequest, signal);
      error = run.result.error ?? undefined;
      text = run.result.text + (error ? (run.result.text ? "\n" : "") + error : "");
      images = Array.isArray(run.result.images) ? run.result.images : [];
      if (run.result.last_result) this.lastResult = run.result.last_result;
      metrics = { ...run.metrics };
      const modelReport = (run.result as any).model;
      if (modelReport) this.modelReport = modelReport;
      const claimReport = (run.result as any).claims?.counts ?? {};
      for (const [name, counts] of Object.entries<any>(claimReport)) {
        const current = this.claimStats[name] ??= { support: 0, counter: 0, checked: 0, levels: [] };
        current.support += Number(counts.support ?? 0);
        current.counter += Number(counts.counter ?? 0);
        current.checked += Number(counts.checked ?? 0);
        current.last_fail = counts.last_fail ?? current.last_fail ?? null;
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
      text = `${text.slice(0, head)}\n... [${text.length - this.config.outputChars} chars omitted from the middle] ...\n${text.slice(-tail)}`;
    }
    if (error) {
      this.errors.push(error.slice(0, 200));
      this.errors = this.errors.slice(-5);
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
    const steps = Array.isArray((run?.result as any)?.steps) ? (run?.result as any).steps : [];
    if (steps.length) this.triage(steps);
    if (notes.length) acted.notes = notes;
    if (steps.length) acted.steps = steps;
    return { text, truncated, acted: batch.executed ? acted : null, images, ...(error ? { error } : {}),
      ...(kernelRestarted ? { kernelRestarted } : {}), metrics: { ...metrics, actions: batch.executed }, notes, steps };
  }

  close() { this.kernel.close(); }
}
