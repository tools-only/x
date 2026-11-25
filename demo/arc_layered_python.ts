import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity } from "./pi_task_python.ts";
import { PythonKernel, type KernelRequest } from "./pi_task_python_kernel.ts";

export type LayeredConfig = { numericGrid: boolean; namespaceResetPerCall: boolean; undo: boolean;
  timeoutMs: number; outputChars: number; maxActionsPerCall: number; workDir: string; competition: boolean;
  skipNoops?: boolean; expect?: boolean; graph?: boolean; review?: boolean; reviewStuckSteps?: number;
  reviewTriggers?: string[] };
export type LayeredState = { level: number; levels_completed: number; win_levels: number; state: string;
  step: number; actions_used: number; budget_left?: number; level_budget?: number; level_budget_left?: number;
  valid_actions: string[]; frame: number[][];
  stale_steps: number; unchecked_batches: number; review_required: string | null };
export type ActionBatch = { executed: number; actions: string[]; lines: string[]; stop_reason?: string;
  level_changed: boolean; game_over: boolean; win: boolean; surprise?: boolean; expect_hits?: string | null;
  review_test?: string; review_placement?: string; review_artifact?: string;
  claims_falsified?: string[]; claims_validated?: string[]; claims_inapplicable?: string[] };
export type ShownImage = { grid: number[][]; scale?: number | null };
export type PythonOutcome = { text: string; truncated: boolean; acted: ActionBatch | null; images: ShownImage[]; error?: string;
  kernelRestarted?: boolean; metrics: Record<string, number>; reviews?: Array<Record<string, unknown>> };

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
  private unchecked = 0;
  private expectHits: string | null = null;
  private errors: string[] = [];
  private calls = 0;
  private batchHadExpect = false;
  private reviewRequired: string | null = null;
  private pendingPlacement?: { artifact: string; before: string | null };
  private pendingArtifact: string | null = null;
  private artifactProbes: Record<string, Record<string, unknown>> = {};
  private repeatsSinceReview = 0;
  private idleCalls = 0;
  private pointRepeats = new Map<string, number>();
  private writesThisCall = new Set<string>();
  private claimLedger: Record<string, { source: string; support: number; counter: number; checked: number;
    levels: number[]; state: string; error?: string; flaggedInapplicable?: boolean }> = {};
  private gameOversThisLevel = 0;
  private budgetReviewFired = false;
  private claimReviewsThisLevel = 0;
  private actionsSinceClaimReview = 0;
  private levelStartBudgetLeft: number | undefined;
  private pendingReviews: Array<Record<string, unknown>> = [];
  private reviewLog: Array<Record<string, unknown>> = [];

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
      unchecked_batches: this.unchecked, review_required: this.reviewRequired };
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
      errors: this.errors.slice(-5),
      artifacts: files.slice(0, 20),
      reviews: this.reviewLog.slice(-5),
      claims: Object.fromEntries(Object.entries(this.claimLedger).map(([name, entry]) =>
        [name, { state: entry.state, support: entry.support, counter: entry.counter, checked: entry.checked,
          scale: entry.levels.length >= 2 ? "game" : "level", ...(entry.error ? { error: entry.error } : {}) }])),
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

  private scanClaims(): Array<{ name: string; source: string; fresh?: boolean }> {
    const dir = join(this.workDir, "claims");
    const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".py")) : [];
    const seen = new Set<string>();
    const result = files.map(file => {
      const name = file.slice(0, -3), source = readFileSync(join(dir, file), "utf8");
      seen.add(name);
      const entry = this.claimLedger[name];
      const fresh = !entry || entry.source !== source;
      if (fresh)
        this.claimLedger[name] = { source, support: 0, counter: 0, checked: 0, levels: [], state: "hypothesis" };
      return { name, source, ...(fresh ? { fresh } : {}) };
    });
    for (const name of Object.keys(this.claimLedger)) if (!seen.has(name)) delete this.claimLedger[name];
    return result;
  }

  private scanModelSource(): string | undefined {
    const target = join(this.workDir, "world_model.py");
    return existsSync(target) ? readFileSync(target, "utf8") : undefined;
  }

  private startupSource(): string | undefined {
    const path = join(this.workDir, "startup.py");
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  private async act(request: KernelRequest, batch: ActionBatch & { halt?: string }) {
    writeFileSync(this.heartbeat, String(Date.now()));
    const call = request.call as { action: string; x?: number; y?: number; reasoning?: string };
    const name = call.action, raw = RAW[name] ?? name;
    if (request.expect != null) this.batchHadExpect = true;
    const refuse = (stopped: string) => { batch.stop_reason ??= stopped; return { stopped }; };
    if (batch.halt) return refuse(`previous_${batch.halt}`);
    if (this.config.review && this.reviewRequired) return refuse(`review required: ${this.reviewRequired}`);
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
    const beforeHash = hashGrid(before.frames.at(-1));
    const pointKey = `${beforeHash}:${label}`;
    const pointRepeats = (this.pointRepeats.get(pointKey) ?? 0) + 1;
    this.pointRepeats.set(pointKey, pointRepeats);
    const levelChanged = after.levels_completed !== before.levels_completed;
    this.stepsSinceLevel = levelChanged ? 0 : this.stepsSinceLevel + 1;
    if (!levelChanged) this.actionsSinceClaimReview += 1;
    if (this.config.review) {
      const trig = (name: string) => this.trigEnabled(name);
      if (trig("level") && levelChanged && after.state !== "WIN")
        this.reviewRequired ??= `level ${before.levels_completed + 1} is complete: consolidate what carries over before the next level` +
          this.ledgerDigest();
      if (after.state === "GAME_OVER" && before.state !== "GAME_OVER") {
        this.gameOversThisLevel += 1;
        if (trig("game_over"))
          this.reviewRequired ??= `GAME_OVER number ${this.gameOversThisLevel} on this level`;
      }
      const steps = this.config.reviewStuckSteps ?? 0;
      if (trig("stuck") && steps > 0 && this.stale > 0 && this.stale % steps === 0)
        this.reviewRequired ??= `${this.stale} steps without a new state`;
      const now = this.state();
      const halfSpent = now.level_budget !== undefined && now.level_budget_left !== undefined
        ? now.level_budget_left <= now.level_budget / 2
        : this.levelStartBudgetLeft !== undefined && now.budget_left !== undefined && now.budget_left <= this.levelStartBudgetLeft / 2;
      if (trig("budget") && !levelChanged && !this.budgetReviewFired && halfSpent) {
        this.budgetReviewFired = true;
        this.reviewRequired ??= "half the level budget is spent and the level is not done";
      }
      if (trig("repeats") && pointRepeats >= 3)
        this.reviewRequired ??= `${pointRepeats} times the same action ${label} was sent against the same board ` +
          "since the last review - a belief survived the evidence against it; name the eliminated hypothesis and " +
          "land it as a falsifiable work/claims/ file";
    }
    if (levelChanged) {
      this.gameOversThisLevel = 0;
      this.budgetReviewFired = false;
      this.claimReviewsThisLevel = 0;
      this.actionsSinceClaimReview = 0;
      this.levelStartBudgetLeft = this.state().budget_left;
      this.pointRepeats.clear();
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
      review_required: this.reviewRequired };
  }

  private trigEnabled(name: string) { return !this.config.reviewTriggers || this.config.reviewTriggers.includes(name); }

  /** What the claims ledger and model back-test say right now, for level-boundary consolidation. */
  private ledgerDigest(): string {
    const states = Object.values(this.claimLedger).map(entry => entry.state);
    const count = (name: string) => states.filter(state => state === name).length;
    const model = this.modelReport ? `${this.modelReport.correct}/${this.modelReport.tested}` : "none";
    return ` (claims: ${count("validated")} validated, ${count("falsified")} falsified, ` +
      `${count("hypothesis")} hypotheses; model backtest: ${model})`;
  }

  /** Claims ledger, open experiments and review pointer for compaction summaries, so a compacted
   * context resumes from work/ instead of re-deriving the board from scratch. */
  evolutionDigest(): string | null {
    const names = Object.keys(this.claimLedger);
    const lines: string[] = [];
    if (names.length) {
      lines.push(names.map(name => {
        const entry = this.claimLedger[name];
        return `${name}: ${entry.state} (${entry.support} support / ${entry.counter} counter / ${entry.checked} checked)` +
          (entry.levels.length >= 2 ? " [game scale]" : "");
      }).join("; "));
    }
    const open = names.filter(name => this.claimLedger[name].state === "hypothesis");
    if (open.length) lines.push(`unresolved hypotheses to probe next: ${open.join(", ")}`);
    if (this.modelReport) lines.push(`work/world_model.py backtest: ${this.modelReport.correct}/${this.modelReport.tested}`);
    if (this.reviewLog.length) lines.push("past reviews: work/review_log.md");
    return lines.length ? `Durable knowledge in work/: ${lines.join(" | ")}` : null;
  }

  private review(request: KernelRequest) {
    const review = request.review as Record<string, unknown>;
    const record = { t: new Date().toISOString(), trigger: this.reviewRequired, ...review };
    this.pendingReviews.push(record);
    this.reviewLog.push(record);
    this.repeatsSinceReview = 0;
    this.idleCalls = 0;
    this.actionsSinceClaimReview = 0;
    this.pointRepeats.clear();
    if (typeof review.artifact === "string") {
      this.pendingPlacement = { artifact: review.artifact, before: this.workContent(review.artifact) };
      const relative = review.artifact.replace(/\\/g, "/").replace(/^(\.\/|\/)?work\//, "");
      if (this.writesThisCall.has(relative)) {
        const problem = this.artifactProblem(relative);
        if (problem) {
          this.pendingArtifact = relative;
          this.reviewRequired = problem;
        } else {
          this.reviewRequired = null;
          this.pendingArtifact = null;
        }
      } else {
        this.pendingArtifact = relative;
        this.reviewRequired = `the review declared ${review.artifact} - write that file to complete the review`;
      }
    } else {
      this.reviewRequired = null;
      this.pendingArtifact = null;
    }
    return { ok: true, review_required: this.reviewRequired };
  }

  /** A declared review artifact must hold executable, non-trivial content, not a stub written to unfreeze. */
  private artifactProblem(relative: string): string | null {
    const probe = this.artifactProbes[relative];
    if (!probe) return null;
    if (probe.error) return `work/${relative} failed to load: ${probe.error} - fix it to complete the review`;
    if (probe.kind === "model") {
      const tested = Number(probe.tested ?? 0), correct = Number(probe.correct ?? 0), identity = Number(probe.identity ?? 0);
      if (tested === 0 && probe.error_sample)
        return `work/${relative} raised on every recorded transition (${probe.error_sample}) - fix it to complete the review`;
      if (tested >= 5 && correct <= identity)
        return `work/world_model.py predicts no better than copying the frame (${correct}/${tested} vs identity ${identity}/${tested}) - ` +
          "make predict say what changes, or land the conclusion as a falsifiable work/claims/<name>.py instead";
    }
    if (probe.kind === "claim") {
      const checked = Number(probe.checked ?? 0), support = Number(probe.support ?? 0), counter = Number(probe.counter ?? 0);
      if (checked >= 3 && support === 0 && counter === 0)
        return `work/${relative} returned None on every transition it was checked against (${checked} checked, 0 support) - ` +
          "a rule that never applies cannot be a review conclusion; narrow its guard so it judges a real transition, or land elsewhere";
    }
    return null;
  }

  private workContent(path: string): string | null {
    const target = resolve(this.workDir, path.replace(/\\/g, "/").replace(/^(\.\/|\/)?work\//, ""));
    if (!target.startsWith(this.workDir + sep) || !existsSync(target)) return null;
    return readFileSync(target, "utf8");
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
    this.writesThisCall.add(relative);
    if (request.probe) this.artifactProbes[relative] = request.probe as Record<string, unknown>;
    else delete this.artifactProbes[relative];
    if (this.pendingArtifact !== null && relative === this.pendingArtifact) {
      const problem = this.artifactProblem(relative);
      if (problem) {
        this.reviewRequired = problem;
        return { data: null, review_required: problem };
      }
      this.pendingArtifact = null;
      this.reviewRequired = null;
      return { data: null, review_cleared: true };
    }
    return { data: null };
  }

  async run(code: string, signal?: AbortSignal): Promise<PythonOutcome> {
    if (!this.kernel.alive) this.sent = 0;
    const batch: ActionBatch & { halt?: string } = { executed: 0, actions: [], lines: [], level_changed: false, game_over: false, win: false };
    let attempted = false;
    this.calls += 1;
    this.batchHadExpect = false;
    this.pendingReviews = [];
    this.writesThisCall.clear();
    const claimSources = this.scanClaims();
    const request = { code, new_history: this.history.slice(this.sent), reset_history: this.sent === 0,
      reset_namespace: this.config.namespaceResetPerCall, numeric_grid: this.config.numericGrid,
      valid_actions: this.state().valid_actions, valid_actions_raw: this.valid(this.raw), last_action_result: this.lastResult,
      skip_noops: !!this.config.skipNoops, expect_enabled: !!this.config.expect, graph_enabled: !!this.config.graph,
      harness_state: this.harnessState(), review_enabled: !!this.config.review, review_required: this.reviewRequired,
      startup_source: this.startupSource(), model_source: this.scanModelSource(), claims: claimSources };
    this.sent = this.history.length;
    const onRequest = async (req: KernelRequest) => req.t === "act" ? (attempted = true, this.act(req, batch))
      : req.t === "review" ? this.review(req) : this.file(req);
    let text: string, error: string | undefined, kernelRestarted = false, metrics: Record<string, number> = {}, images: ShownImage[] = [];
    const claimsFalsified: string[] = [], claimsValidated: string[] = [], claimsInapplicable: string[] = [];
    try {
      const run = await this.kernel.run(request, onRequest, signal);
      error = run.result.error ?? undefined;
      text = run.result.text + (error ? (run.result.text ? "\n" : "") + error : "");
      images = Array.isArray(run.result.images) ? run.result.images : [];
      if (run.result.last_result) this.lastResult = run.result.last_result;
      metrics = { ...run.metrics };
      const modelReport = (run.result as any).model;
      if (modelReport) this.modelReport = modelReport;
      const report = (run.result as any).claims;
      if (report) {
        for (const [name, counts] of Object.entries<any>(report.counts ?? {})) {
          const entry = this.claimLedger[name];
          if (!entry) continue;
          entry.support += counts.support ?? 0;
          entry.counter += counts.counter ?? 0;
          entry.checked += counts.checked ?? 0;
          for (const level of counts.levels ?? []) if (!entry.levels.includes(level)) entry.levels.push(level);
          const previous = entry.state;
          entry.state = entry.counter > 0 ? "falsified" : entry.support >= 3 ? "validated" : "hypothesis";
          if (entry.state === "falsified" && previous !== "falsified") claimsFalsified.push(name);
          if (entry.state === "validated" && previous !== "validated") claimsValidated.push(name);
          if (entry.checked >= 20 && entry.support + entry.counter === 0 && !entry.flaggedInapplicable) {
            entry.flaggedInapplicable = true;
            claimsInapplicable.push(name);
          }
        }
        for (const [name, problem] of Object.entries<any>(report.errors ?? {}))
          if (this.claimLedger[name]) this.claimLedger[name].error = String(problem);
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
    if (claimsFalsified.length) acted.claims_falsified = claimsFalsified;
    if (claimsValidated.length) acted.claims_validated = claimsValidated;
    if (claimsInapplicable.length) acted.claims_inapplicable = claimsInapplicable;
    const lastSummary: any = this.lastResult;
    if (batch.executed && lastSummary && typeof lastSummary === "object") {
      if (lastSummary.surprise) acted.surprise = true;
      if (lastSummary.expect_hits) acted.expect_hits = lastSummary.expect_hits;
      if (lastSummary.review_test) {
        acted.review_test = lastSummary.review_test;
        const lastReview = this.reviewLog[this.reviewLog.length - 1];
        if (lastReview) lastReview.test_outcome = lastSummary.review_test;
        if (this.pendingPlacement) {
          const current = this.workContent(this.pendingPlacement.artifact);
          const placed = current !== null && current !== this.pendingPlacement.before;
          acted.review_placement = placed ? "placed" : "unplaced";
          acted.review_artifact = this.pendingPlacement.artifact;
          if (lastReview) lastReview.placed = placed;
          this.pendingPlacement = undefined;
        }
      }
    }
    if (batch.executed) {
      const key = batch.actions.join(">");
      if (batch.actions.length >= 2 && this.seenSequences.has(key)) { this.repeatedSequences += 1; this.repeatsSinceReview += 1; }
      this.seenSequences.add(key);
      if (acted.surprise) this.surprises += 1;
      this.unchecked = this.batchHadExpect ? 0 : this.unchecked + 1;
      if (acted.expect_hits) this.expectHits = acted.expect_hits;
    }
    if (this.config.review) {
      if (batch.executed || this.writesThisCall.size) this.idleCalls = 0;
      else if (!this.reviewRequired) this.idleCalls += 1;
      if (this.trigEnabled("repeats") && this.repeatsSinceReview >= 3)
        this.reviewRequired ??= `${this.repeatsSinceReview} already-tried action routes were re-sent since the last review - ` +
          "a belief survived the evidence against it; name it and land it as a falsifiable work/claims/ file";
      if (this.trigEnabled("idle_calls") && this.idleCalls >= 8)
        this.reviewRequired ??= `${this.idleCalls} python calls in a row produced no action and no work/ write - ` +
          "analysis is repeating without landing anywhere; write what you now believe into work/ or act on it";
      const claimChallenge = claimsFalsified.length + claimsInapplicable.length > 0;
      if (this.trigEnabled("claims") && claimChallenge && this.claimReviewsThisLevel < 3
          && this.actionsSinceClaimReview >= 4) {
        const reasons = [...claimsFalsified, ...claimsInapplicable].join(", ");
        this.reviewRequired ??= `work/claims/ evidence changed: ${reasons} - revise or discard the failed rule`;
        this.claimReviewsThisLevel += 1;
        this.actionsSinceClaimReview = 0;
      }
    }
    const claimEvents = claimsFalsified.length + claimsValidated.length + claimsInapplicable.length > 0;
    return { text, truncated, acted: batch.executed || claimEvents ? acted : null, images, ...(error ? { error } : {}),
      ...(kernelRestarted ? { kernelRestarted } : {}), metrics: { ...metrics, actions: batch.executed },
      ...(this.pendingReviews.length ? { reviews: this.pendingReviews } : {}) };
  }

  close() { this.kernel.close(); }
}
