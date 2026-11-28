/** Domain-agnostic outer loop control: LoopSpec parsing/clamping, deterministic pass gating, and PassResult carry-over. */

export type OrchestrationMode = "EXPLORE" | "EXPLOIT" | "REFRAME";

export type LoopSpec = {
  goal?: string;
  completion_check?: string;
  method?: string;
  max_iterations?: number;
  max_actions_per_pass?: number;
  no_progress_after?: number;
  max_batch?: number;
  mode?: OrchestrationMode;
  handoff?: string;
  batch_hint?: string;
  reframe_after_failures?: number;
  reframe_after_deaths?: number;
  note?: string;
};

export type PassResult = {
  pass: number;
  max_iterations: number;
  executed: number;
  new_states: number;
  failures: number;
  surprises: number;
  completed: boolean;
  completion_done?: boolean;
  completion_progress?: number;
  no_progress: boolean;
  facts: string[];
};

export const LOOP_LIMITS = {
  max_iterations: { min: 1, max: 10, default: 3 },
  max_actions_per_pass: { min: 2, max: 24, default: 12 },
  no_progress_after: { min: 1, max: 12, default: 4 },
  max_batch: { min: 1, max: 16, default: 16 },
} as const;

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function parseLoopSpec(body: string): LoopSpec {
  const trimmed = body.trim();
  if (!trimmed) return {};
  const parsed: LoopSpec = {};
  const read = (obj: Record<string, unknown>) => {
    const goal = text(obj.goal, 280);
    if (goal) parsed.goal = goal;
    const completion = text(obj.completion_check, 120);
    if (completion) parsed.completion_check = completion;
    const method = text(obj.method, 120);
    if (method) parsed.method = method;
    const maxIter = clampInt(obj.max_iterations, LOOP_LIMITS.max_iterations.min, LOOP_LIMITS.max_iterations.max);
    if (maxIter !== undefined) parsed.max_iterations = maxIter;
    const maxActions = clampInt(obj.max_actions_per_pass, LOOP_LIMITS.max_actions_per_pass.min, LOOP_LIMITS.max_actions_per_pass.max);
    if (maxActions !== undefined) parsed.max_actions_per_pass = maxActions;
    const noProgress = clampInt(obj.no_progress_after, LOOP_LIMITS.no_progress_after.min, LOOP_LIMITS.no_progress_after.max);
    if (noProgress !== undefined) parsed.no_progress_after = noProgress;
    const maxBatch = clampInt(obj.max_batch, LOOP_LIMITS.max_batch.min, LOOP_LIMITS.max_batch.max);
    if (maxBatch !== undefined) parsed.max_batch = maxBatch;
    const mode = String(obj.mode ?? "").toUpperCase();
    if (mode === "EXPLORE" || mode === "EXPLOIT" || mode === "REFRAME") parsed.mode = mode as OrchestrationMode;
    const handoff = text(obj.handoff, 140);
    if (handoff) parsed.handoff = handoff;
    const batchHint = text(obj.batch_hint, 80);
    if (batchHint) parsed.batch_hint = batchHint;
    const reframe = clampInt(obj.reframe_after_failures ?? obj.reframe_after_deaths, 1, 20);
    if (reframe !== undefined) {
      parsed.reframe_after_failures = reframe;
      parsed.reframe_after_deaths = reframe;
    }
  };
  if (trimmed.startsWith("{")) {
    try {
      read(JSON.parse(trimmed) as Record<string, unknown>);
      return parsed;
    } catch {
      return {};
    }
  }
  const modeMatch = /^\s*mode\s*[:=]\s*(EXPLORE|EXPLOIT|REFRAME)\b/mi.exec(trimmed);
  if (modeMatch) parsed.mode = modeMatch[1].toUpperCase() as OrchestrationMode;
  const handoffMatch = /^\s*handoff\s*[:=]\s*(.+)$/mi.exec(trimmed);
  if (handoffMatch) parsed.handoff = handoffMatch[1].trim().slice(0, 140);
  const batchMatch = /^\s*batch_hint\s*[:=]\s*(.+)$/mi.exec(trimmed);
  if (batchMatch) parsed.batch_hint = batchMatch[1].trim().slice(0, 80);
  const reframeMatch = /^\s*reframe_after_(?:failures|deaths)\s*[:=]\s*(\d+)\b/mi.exec(trimmed);
  if (reframeMatch) {
    const value = clampInt(reframeMatch[1], 1, 20);
    if (value !== undefined) parsed.reframe_after_failures = parsed.reframe_after_deaths = value;
  }
  const goalMatch = /^\s*goal\s*[:=]\s*(.+)$/mi.exec(trimmed);
  if (goalMatch) parsed.goal = goalMatch[1].trim().slice(0, 280);
  const completionMatch = /^\s*completion_check\s*[:=]\s*(.+)$/mi.exec(trimmed);
  if (completionMatch) parsed.completion_check = completionMatch[1].trim().slice(0, 120);
  const methodMatch = /^\s*method\s*[:=]\s*(.+)$/mi.exec(trimmed);
  if (methodMatch) parsed.method = methodMatch[1].trim().slice(0, 120);
  const maxIterText = /^\s*max_iterations\s*[:=]\s*(\d+)\b/mi.exec(trimmed);
  if (maxIterText) {
    const value = clampInt(maxIterText[1], LOOP_LIMITS.max_iterations.min, LOOP_LIMITS.max_iterations.max);
    if (value !== undefined) parsed.max_iterations = value;
  }
  const maxActionsText = /^\s*max_actions_per_pass\s*[:=]\s*(\d+)\b/mi.exec(trimmed);
  if (maxActionsText) {
    const value = clampInt(maxActionsText[1], LOOP_LIMITS.max_actions_per_pass.min, LOOP_LIMITS.max_actions_per_pass.max);
    if (value !== undefined) parsed.max_actions_per_pass = value;
  }
  const noProgressText = /^\s*no_progress_after\s*[:=]\s*(\d+)\b/mi.exec(trimmed);
  if (noProgressText) {
    const value = clampInt(noProgressText[1], LOOP_LIMITS.no_progress_after.min, LOOP_LIMITS.no_progress_after.max);
    if (value !== undefined) parsed.no_progress_after = value;
  }
  const maxBatchText = /^\s*max_batch\s*[:=]\s*(\d+)\b/mi.exec(trimmed);
  if (maxBatchText) {
    const value = clampInt(maxBatchText[1], LOOP_LIMITS.max_batch.min, LOOP_LIMITS.max_batch.max);
    if (value !== undefined) parsed.max_batch = value;
  }
  if (!parsed.mode && !parsed.handoff && !parsed.batch_hint && !parsed.reframe_after_failures && !parsed.goal
      && !parsed.completion_check && !parsed.method && !parsed.max_iterations && !parsed.max_actions_per_pass
      && !parsed.no_progress_after && !parsed.max_batch) {
    parsed.note = trimmed.replace(/\s+/g, " ").slice(0, 140);
  }
  return parsed;
}

export function effectiveLoopSpec(spec: LoopSpec | undefined): LoopSpec {
  return {
    max_iterations: spec?.max_iterations ?? LOOP_LIMITS.max_iterations.default,
    max_actions_per_pass: spec?.max_actions_per_pass ?? LOOP_LIMITS.max_actions_per_pass.default,
    no_progress_after: spec?.no_progress_after ?? LOOP_LIMITS.no_progress_after.default,
    ...(spec ?? {}),
  };
}

export type LoopCheck = {
  pass: number;
  max_iterations: number;
  budget_exhausted: boolean;
  time_exhausted: boolean;
  no_progress_streak: number;
  no_progress_after: number;
  completed: boolean;
};

export type LoopDecision =
  | { kind: "continue" }
  | { kind: "brake"; reason: "max_iterations" | "budget" | "time" | "no_progress" }
  | { kind: "completed" };

export function evaluateLoopChecks(check: LoopCheck): LoopDecision {
  if (check.completed) return { kind: "completed" };
  if (check.budget_exhausted || check.time_exhausted) return { kind: "brake", reason: check.time_exhausted ? "time" : "budget" };
  if (check.pass >= check.max_iterations) return { kind: "brake", reason: "max_iterations" };
  if (check.no_progress_streak >= check.no_progress_after) return { kind: "brake", reason: "no_progress" };
  return { kind: "continue" };
}

export function formatPassResult(result: PassResult): string {
  const parts = [
    `LOOP PASS ${result.pass}/${result.max_iterations}`,
    `delta: executed=${result.executed} new_states=${result.new_states} failures=${result.failures} surprises=${result.surprises}`,
    `check: ${result.completed ? "completed" : result.no_progress ? "no_progress" : "continuing"}`,
  ];
  if (result.completion_done !== undefined || result.completion_progress !== undefined) {
    parts.push(`completion: ${result.completion_done ? "done" : "pending"}${result.completion_progress !== undefined ? ` progress=${result.completion_progress}` : ""}`);
  }
  if (result.facts.length) parts.push(`facts: ${result.facts.join("; ")}`);
  return parts.join(" | ").slice(0, 400);
}
