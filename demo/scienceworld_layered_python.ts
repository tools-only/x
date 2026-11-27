import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity } from "./pi_task_python.ts";
import { PythonKernel, type KernelRequest } from "./pi_task_python_kernel.ts";

export type ScienceWorldLayeredConfig = {
  timeoutMs: number; outputChars: number; maxActionsPerCall: number; workDir: string;
};
export type ScienceWorldLayeredState = {
  level: number; levels_completed: number; win_levels: number; state: string;
  step: number; actions_used: number; budget_left: number; level_budget: number; level_budget_left: number;
  valid_actions: string[]; observation: string; look: string; inventory: string;
  task_description: string; score: number; stale_steps: number; unchecked_batches: number;
};
export type ActionBatch = {
  executed: number; actions: string[]; lines: string[]; stop_reason?: string;
  level_changed: boolean; game_over: boolean; win: boolean; reset?: boolean;
  steps?: StepFact[]; notes?: string[];
};
export type StepFact = {
  step: number; action: string; tries: number; same: boolean; last_try: number;
  new: boolean; level: number; changed: boolean; death: boolean; level_up: boolean;
  source: string | null; same_death: boolean | number | null;
};
export type PythonOutcome = {
  text: string; truncated: boolean; acted: ActionBatch | null; error?: string; kernelRestarted?: boolean;
  metrics: Record<string, number>; notes?: string[]; steps?: StepFact[]; decoratedTools?: string[]; usedLibs?: string[];
};
export type MemoryCheckStats = Record<string, {
  support: number; counter: number; checked: number;
  by_level: Record<string, { support: number; counter: number; checked?: number }>;
  witness: string | null; error: string | null;
}>;

const FILE_BYTES = 256 * 1024, WORK_BYTES = 4 * 1024 * 1024;

export class ScienceWorldBridgeClient {
  constructor(private baseUrl: string, private token: string) {}
  private async call(path: string, body?: unknown) {
    const response = await fetch(this.baseUrl + path, body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json", "X-ScienceWorld-Action-Token": this.token },
      body: JSON.stringify(body),
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error(String(data.error ?? response.status));
    return data;
  }
  state() { return this.call("/state"); }
  act(call: { action: string; reasoning?: string }) { return this.call("/action", call); }
}

const obsText = (raw: any) => `TASK: ${raw.task_description ?? ""}\nOBS: ${raw.observation ?? ""}\n` +
  `LOOK: ${raw.look ?? ""}\nINV: ${raw.inventory ?? ""}\nSCORE: ${raw.score ?? 0}`;

export class ScienceWorldLayeredPython {
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
  private calls = 0;
  private unchecked = 0;
  private errors: string[] = [];
  private recentLines: string[] = [];
  private seenSequences = new Set<string>();
  private repeatedSequences = 0;
  private stepsSinceLevel = 0;
  private resets = 0;
  private gameOvers = 0;
  private memoryChecks: Array<{ id: string; expr: string }> = [];
  memoryCheckStats: MemoryCheckStats = {};

  constructor(private bridge: ScienceWorldBridgeClient, private config: ScienceWorldLayeredConfig) {
    const limits = { timeout_ms: config.timeoutMs };
    this.kernel = new PythonKernel({
      format: TASK_PYTHON_FORMAT, limits, effective_limits: taskPythonLimits(limits),
      runtime: taskPythonRuntimeIdentity(),
      source: readFileSync(new URL("./scienceworld_prelude.py", import.meta.url), "utf8"),
    });
    this.workDir = resolve(config.workDir);
    mkdirSync(this.workDir, { recursive: true });
    this.heartbeat = resolve(this.workDir, "..", "harness", "heartbeat");
    mkdirSync(dirname(this.heartbeat), { recursive: true });
  }

  private entry(action: string, raw: any) {
    return { action, observation: raw.observation, look: raw.look, inventory: raw.inventory,
      task_description: raw.task_description, score: raw.score, level: raw.level, step: raw.step,
      state: raw.state, levels_completed: raw.levels_completed, win_levels: raw.win_levels };
  }

  async init() {
    this.raw = await this.bridge.state();
    this.history = [this.entry("", this.raw)];
    this.seenHashes.add(obsText(this.raw));
    this.kernel.prewarm();
    return this.state();
  }

  state(): ScienceWorldLayeredState {
    const raw = this.raw;
    return { level: raw.level, levels_completed: raw.levels_completed, win_levels: raw.win_levels,
      state: raw.state, step: raw.step, actions_used: raw.actions_used, budget_left: raw.budget_left,
      level_budget: raw.level_budget, level_budget_left: raw.level_budget_left,
      valid_actions: raw.valid_actions ?? [], observation: raw.observation, look: raw.look,
      inventory: raw.inventory, task_description: raw.task_description, score: raw.score,
      stale_steps: this.stale, unchecked_batches: this.unchecked };
  }

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
      errors: this.errors.slice(-5),
      artifacts: files.slice(0, 20),
      cost: { actions_used: state.actions_used, budget_left: state.budget_left,
        level_budget_left: state.level_budget_left, python_calls: this.calls },
    };
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
      reset_history: this.sent === 0, valid_actions: this.state().valid_actions, last_action_result: this.lastResult,
      harness_state: this.harnessState(), startup_source: this.startupSource(), transition_results: this.transitionResults };
    const result = await this.kernel.run(request, async req => this.file(req));
    this.sent = this.history.length;
    this.memoryCheckStats = result.result.memory_checks ?? {};
    return this.memoryCheckStats;
  }

  private async act(request: KernelRequest, batch: ActionBatch & { halt?: string }) {
    writeFileSync(this.heartbeat, String(Date.now()));
    const call = request.call as { action: string; reasoning?: string };
    const name = String(call.action);
    if (batch.halt) return { stopped: `previous_${batch.halt}` };
    if (batch.executed >= this.config.maxActionsPerCall)
      return { stopped: `the limit of ${this.config.maxActionsPerCall} actions per call was reached` };
    if (this.raw.state !== "NOT_FINISHED" && name.toUpperCase() !== "RESET")
      return { stopped: "the game is over: only RESET is allowed" };
    let after: any;
    try { after = await this.bridge.act({ action: name, ...(call.reasoning ? { reasoning: call.reasoning } : {}) }); }
    catch (error) { return { stopped: `refused: ${(error as Error).message}` }; }
    const before = this.raw;
    this.raw = after.state;
    this.lastAction = name;
    const beforeText = obsText(before), afterText = obsText(this.raw);
    const changed = beforeText !== afterText;
    if (!changed) this.stale += 1; else this.stale = 0;
    if (name.toUpperCase() === "RESET") this.resets += 1;
    if (this.raw.state === "GAME_OVER" && before.state !== "GAME_OVER") this.gameOvers += 1;
    const entry = this.entry(name, this.raw);
    this.history.push(entry);
    this.sent = this.history.length;
    const levelChanged = this.raw.levels_completed !== before.levels_completed;
    this.stepsSinceLevel = levelChanged ? 0 : this.stepsSinceLevel + 1;
    if (levelChanged) { this.recentLines = []; this.seenSequences.clear(); }
    const result = { action: name, changed, level: entry.level, levels_completed: this.raw.levels_completed,
      state: this.raw.state, level_changed: levelChanged, game_over: this.raw.state === "GAME_OVER",
      win: this.raw.state === "WIN", step: this.raw.step, score: this.raw.score };
    this.transitionResults.push(result);
    this.lastResult = result;
    const line = `${name}: score ${this.raw.score}, level ${entry.level}, ${this.raw.state}`;
    this.recentLines.push(line);
    this.recentLines = this.recentLines.slice(-12);
    batch.executed += 1; batch.actions.push(name); batch.lines.push(line);
    batch.level_changed ||= levelChanged; batch.game_over ||= result.game_over; batch.win ||= result.win;
    batch.halt = result.win ? "win" : result.game_over ? "game_over" : levelChanged ? "level_change" : undefined;
    if (batch.halt) batch.stop_reason ??= batch.halt;
    return { entry, result, line, halt: batch.halt, valid_actions: this.state().valid_actions };
  }

  private file(request: KernelRequest) {
    const clean = String(request.path).replace(/\\/g, "/");
    const relative = clean.replace(/^(\.\/|\/)?work\//, "");
    const target = resolve(this.workDir, relative);
    if (!target.startsWith(this.workDir + sep)) return { error: `only files under work/ are available: ${request.path}` };
    if (request.op === "read") return existsSync(target) ? { data: readFileSync(target, "utf8") } : { error: `no such file: ${request.path}`, missing: true };
    const data = String(request.data ?? ""), bytes = Buffer.byteLength(data);
    if (bytes > FILE_BYTES) return { error: `a work/ file is limited to ${FILE_BYTES} bytes (got ${bytes})` };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, "utf8");
    return { data: null };
  }

  async run(code: string, signal?: AbortSignal, opts?: { forbidActions?: boolean }): Promise<PythonOutcome> {
    const forbidActions = Boolean(opts?.forbidActions);
    if (!this.kernel.alive) this.sent = 0;
    const batch: ActionBatch & { halt?: string } = { executed: 0, actions: [], lines: [], level_changed: false, game_over: false, win: false };
    let attempted = false;
    if (!forbidActions) this.calls += 1;
    const request = { code, new_history: this.history.slice(this.sent), reset_history: this.sent === 0,
      valid_actions: this.state().valid_actions, last_action_result: this.lastResult,
      harness_state: this.harnessState(), forbid_actions: forbidActions,
      startup_source: this.startupSource(), memory_checks: this.memoryChecks,
      transition_results: this.transitionResults };
    this.sent = this.history.length;
    const onRequest = async (req: KernelRequest) => {
      if (req.t === "act") {
        if (forbidActions) return { stopped: "submit_actions is disabled during evolution review" };
        attempted = true;
        return this.act(req, batch);
      }
      return this.file(req);
    };
    let run: { result: Record<string, any>; metrics: Record<string, number> } | undefined;
    let text: string, error: string | undefined, kernelRestarted = false, metrics: Record<string, number> = {};
    try {
      run = await this.kernel.run(request, onRequest, signal);
      error = run.result.error ?? undefined;
      text = run.result.text + (error ? (run.result.text ? "\n" : "") + error : "");
      if (run.result.memory_checks) this.memoryCheckStats = run.result.memory_checks;
      if (run.result.last_result) this.lastResult = run.result.last_result;
      metrics = { ...run.metrics };
    } catch (problem) {
      error = String((problem as Error).message ?? problem);
      kernelRestarted = true;
      text = `${error}\nThe Python kernel ended and the next call starts a new one: names you defined are gone; files in work/ remain.`;
    }
    const truncated = text.length > this.config.outputChars;
    if (truncated) {
      const head = Math.floor(this.config.outputChars * 0.6), tail = this.config.outputChars - head;
      text = `${text.slice(0, head)}\n... [${text.length - this.config.outputChars} chars omitted from the middle] ...\n${text.slice(-tail)}` +
        `\n[output truncated: print concise summaries instead of full observations]`;
    }
    if (!forbidActions && error) {
      this.errors.push(error.slice(0, 200));
      this.errors = this.errors.slice(-5);
    }
    if (attempted) {
      const state = this.state();
      text += `\n[env] executed ${batch.executed}${batch.actions.length ? ` (${batch.actions.join(" | ")})` : ""}` +
        `${batch.stop_reason ? `, stopped: ${batch.stop_reason}` : ""} | level ${state.level}/${state.win_levels} ${state.state}` +
        ` | step ${state.step}, budget left ${state.budget_left} | valid: ${state.valid_actions.length} actions`;
    }
    const { halt: _halt, ...acted } = batch;
    if (batch.executed) {
      const key = batch.actions.join(">");
      if (batch.actions.length >= 2 && this.seenSequences.has(key)) this.repeatedSequences += 1;
      this.seenSequences.add(key);
      this.unchecked = this.unchecked + 1;
    }
    const notes = Array.isArray((run?.result as any)?.notes) ? (run?.result as any).notes.map(String) : [];
    const steps: StepFact[] = Array.isArray((run?.result as any)?.steps) ? (run?.result as any).steps : [];
    if (notes.length) acted.notes = notes;
    if (steps.length) acted.steps = steps;
    return { text, truncated, acted: batch.executed ? acted : null, ...(error ? { error } : {}),
      ...(kernelRestarted ? { kernelRestarted } : {}), metrics: { ...metrics, actions: batch.executed }, notes, steps,
      decoratedTools: Array.isArray(run?.result?.decorated_tools) ? run.result.decorated_tools : [],
      usedLibs: Array.isArray(run?.result?.used_libs) ? run.result.used_libs : [] };
  }

  close() { this.kernel.close(); }
}
