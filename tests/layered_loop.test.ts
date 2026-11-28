import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLoopChecks, formatPassResult, LOOP_LIMITS, parseLoopSpec } from "../demo/layered_loop.ts";
import { arcEnvAdapter } from "../demo/arc_env_adapter.ts";

test("parseLoopSpec reads JSON loop fields with clamping", () => {
  const spec = parseLoopSpec(JSON.stringify({
    goal: "prove the win condition",
    completion_check: "goal_reached",
    method: "controlled_probe",
    max_iterations: 99,
    max_actions_per_pass: 1,
    no_progress_after: 50,
    max_batch: 2,
    mode: "EXPLORE",
    reframe_after_failures: 3,
  }));
  assert.equal(spec.goal, "prove the win condition");
  assert.equal(spec.completion_check, "goal_reached");
  assert.equal(spec.method, "controlled_probe");
  assert.equal(spec.max_iterations, LOOP_LIMITS.max_iterations.max);
  assert.equal(spec.max_actions_per_pass, LOOP_LIMITS.max_actions_per_pass.min);
  assert.equal(spec.no_progress_after, LOOP_LIMITS.no_progress_after.max);
  assert.equal(spec.max_batch, 2);
  assert.equal(spec.mode, "EXPLORE");
  assert.equal(spec.reframe_after_failures, 3);
  assert.equal(spec.reframe_after_deaths, 3);
});

test("parseLoopSpec keeps legacy text orchestration fields", () => {
  const spec = parseLoopSpec("mode: REFRAME\nhandoff: consult before retry\nbatch_hint: 1-2 steps\nreframe_after_deaths: 1");
  assert.equal(spec.mode, "REFRAME");
  assert.equal(spec.handoff, "consult before retry");
  assert.equal(spec.batch_hint, "1-2 steps");
  assert.equal(spec.reframe_after_deaths, 1);
  assert.equal(spec.reframe_after_failures, 1);
});

test("parseLoopSpec reads the six loop fields from text orchestration", () => {
  const spec = parseLoopSpec(
    "goal: reach the exit\ncompletion_check: exit_reached\nmethod: path_scan\n" +
    "max_iterations: 5\nmax_actions_per_pass: 8\nno_progress_after: 3\nmax_batch: 6",
  );
  assert.equal(spec.goal, "reach the exit");
  assert.equal(spec.completion_check, "exit_reached");
  assert.equal(spec.method, "path_scan");
  assert.equal(spec.max_iterations, 5);
  assert.equal(spec.max_actions_per_pass, 8);
  assert.equal(spec.no_progress_after, 3);
  assert.equal(spec.max_batch, 6);
});

test("parseLoopSpec clamps max_batch to the global call cap", () => {
  const spec = parseLoopSpec(JSON.stringify({ max_batch: 99, max_actions_per_pass: 99 }));
  assert.equal(spec.max_batch, LOOP_LIMITS.max_batch.max);
  assert.equal(spec.max_actions_per_pass, LOOP_LIMITS.max_actions_per_pass.max);
});

test("parseLoopSpec rejects invalid JSON without throwing", () => {
  assert.deepEqual(parseLoopSpec("{not json"), {});
  assert.deepEqual(parseLoopSpec(""), {});
});

test("evaluateLoopChecks orders completion, hard budgets, iterations, then no progress", () => {
  const base = { pass: 1, max_iterations: 3, budget_exhausted: false, time_exhausted: false, no_progress_streak: 0, no_progress_after: 4, completed: false };
  assert.equal(evaluateLoopChecks({ ...base, completed: true }).kind, "completed");
  assert.deepEqual(evaluateLoopChecks({ ...base, budget_exhausted: true }), { kind: "brake", reason: "budget" });
  assert.deepEqual(evaluateLoopChecks({ ...base, time_exhausted: true }), { kind: "brake", reason: "time" });
  assert.deepEqual(evaluateLoopChecks({ ...base, pass: 3 }), { kind: "brake", reason: "max_iterations" });
  assert.deepEqual(evaluateLoopChecks({ ...base, no_progress_streak: 4 }), { kind: "brake", reason: "no_progress" });
  assert.equal(evaluateLoopChecks(base).kind, "continue");
});

test("formatPassResult caps at 400 characters and reports facts", () => {
  const text = formatPassResult({ pass: 2, max_iterations: 3, executed: 5, new_states: 1, failures: 2, surprises: 0, completed: false, no_progress: true, facts: ["rule_a confirmed", "rule_b contradicted"] });
  assert.match(text, /LOOP PASS 2\/3/);
  assert.match(text, /check: no_progress/);
  assert.match(text, /rule_a confirmed/);
  assert.ok(text.length <= 400);
});

test("arcEnvAdapter.loopSignals maps batch/state into Loop gate signals", () => {
  const signals = arcEnvAdapter.loopSignals?.({
    batch: { executed: 3, surprise: true, level_changed: false, steps: [{ new: true }, { new: false, death: true }, { new: false }] },
    state: "NOT_FINISHED", budget_left: 1, level_budget_left: 0,
  });
  assert.deepEqual(signals, {
    executed: 3, new_states: 1, failures: 1, surprises: 1, completed: false,
    budget_exhausted: true, time_exhausted: false, facts: [],
  });
  assert.equal(arcEnvAdapter.loopSignals?.({ batch: { level_changed: true }, state: "NOT_FINISHED" })?.completed, true);
  assert.equal(arcEnvAdapter.loopSignals?.({ batch: null, state: "WIN" })?.completed, true);
});
