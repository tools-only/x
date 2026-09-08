# Visible Research-to-Harness Effect Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make real task observations directly usable by the model, support explicit apply/keep execution-surface decisions, and evaluate a bounded post-change behavior window without claiming causal improvement.

**Architecture:** Keep `PiKernel` transport-only. The local OfficeBench bridge classifies backend strings into structured action outcomes; the Pi extension exposes compact observation cards, owns task-local findings/decisions/effect windows, and invokes `pi.setActiveTools()` only for apply decisions. The Python runner removes stale capability disclosure and separately reports task correctness, loop integrity, task-local effect evidence, and still-unestablished harness improvement.

**Tech Stack:** Python 3.10+, pytest, TypeScript, TypeBox, Pi extension API, Pi `setActiveTools()`, installed Pi offline provider fixture.

## Post-real-run refinement: visible decision support

The JIT-environment run of `2-13-0` completed 12 calendar writes after a successful direct calendar probe, but recorded no finding or decision. Three approaches were considered: stronger method prose alone, automatic finding/mutation, and a typed optional connection carried by action results. Method prose alone had already proved too weak; automatic mutation would invalidate no-change autonomy. The selected approach adds a compact `decision_support` object only when a general-surface observation demonstrates a calendar-relevant path. It identifies the evidence reference, candidate Pi capability, next-request effect, apply/keep conditions, and explicitly says no change is valid.

When the agent chooses to create a finding, `research_resource` returns an `EXECUTION_DECISION_POINT` tied to the stable finding ID. The runner independently reports whether the chain stopped at candidate, finding, keep/apply, or observed effect. This is diagnostic feedback, not a kernel scheduler and not evidence of general harness improvement.

## Second real-run refinement: a surface change with actual task benefit

The real JIT run `effect-high-2-13-0-real-4-decision-support` made the connection visible but still produced no finding or decision. That was a rational outcome: `calendar_focused` only hid a broad tool the model was already avoiding, while recording a finding and decision cost two additional model turns. The model could also emit many direct calendar calls in one turn, so a next-request surface change could not improve calls already emitted.

The selected refinement registers an initially inactive Pi tool, `calendar_batch_action`. A finding-backed `decide_execution_surface` apply decision can enable it with the official `pi.setActiveTools()` API for the next request. One Pi tool call then performs multiple real JIT calendar writes, returns per-item results, and records attempted/completed work units. Nothing creates the finding or applies the change automatically; keep and no-research remain valid.

The bounded effect metric `calendar_batch_utilization` is supported only when the changed surface is observed by a later request and the window contains a successful batch call completing at least two work units with fewer Pi calls than completed work units. This establishes a task-local behavioral consequence and call compression, not general harness improvement or cross-task learning.

---

### Task 1: Model-visible structured action observations

**Files:**
- Modify: `src/autoresearch_pi/officebench_tool_bridge.py`
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Test: `tests/test_officebench_e2e.py`
- Test: `tests/test_pi_officebench_native.py`

**Steps:**

1. Add a failing test that classifies a successful action separately from `Error:`, `Failed to ...`, and strong shell-error output.
2. Return `{text, outcome, error_kind}` JSON from the bridge and verify the test passes.
3. Add a failing installed-Pi test asserting the action tool's model-visible content contains its stable observation ID and semantic outcome.
4. Append one compact `EXECUTION_OBSERVATION` card to action tool content while keeping the canonical record in `execution-observations.jsonl`.
5. Add a failing task-prompt test for the stale “only two tools” sentence, replace it locally with accurate initial capability disclosure, and verify it passes without editing `D:/JIT`.

### Task 2: Finding-backed apply/keep decision

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Test: `tests/test_pi_officebench_native.py`

**Steps:**

1. Change the recurring-benefit fixture to call one failing broad action, create a finding referencing the visible observation, and choose `apply` with an effect metric and horizon.
2. Change the transient fixture to create a low-recurrence finding and explicitly choose `keep`.
3. Run focused tests and confirm the current set-only tool/schema fails.
4. Replace the ambiguous setter with capability-specific `decide_execution_surface`; validate finding IDs for both choices, persist both, and call `pi.setActiveTools()` only for apply.
5. Verify apply changes the next request, keep does not, and invalid references produce neither a decision nor a change.

### Task 3: Bounded task-local effect assessment

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Test: `tests/test_pi_officebench_native.py`
- Test: `tests/test_officebench_e2e.py`

**Steps:**

1. Add a failing fixture assertion for two successful focused actions after an apply decision and a persisted `effect-assessment-N` linked to the decision.
2. Track only real task actions after apply; close the window at the requested horizon and classify it as `supported`, `contradicted`, or `inconclusive` against the declared metric.
3. Inject each completed assessment into the next model context once and retain the canonical JSONL record once.
4. Add a failing Python runner test for valid and invalid effect-assessment links.
5. Report task-local `execution_condition_effect` separately; never derive `harness_improvement` from one run.

### Task 4: Regression, documentation, and manual-run handoff

**Files:**
- Modify: `docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md`
- Modify: `handoff.md`

**Steps:**

1. Run focused bridge, runner, and installed-Pi tests.
2. Run the full pytest suite.
3. Document what scripted fixtures establish and why a real paid-model batch remains a separate manual test.
4. Do not create a commit from the existing dirty user-owned worktree unless explicitly requested.

### Task 5: Initially inactive batch capability and real JIT validation

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Test: `tests/test_pi_officebench_native.py`
- Test: `tests/test_officebench_e2e.py`

**Steps:**

1. Add a scripted fixture proving `calendar_batch_action` is absent initially and appears only after a valid finding-backed apply decision.
2. Register the batch tool, invoke the real JIT bridge once per item, preserve per-item outcomes, and record attempted/completed work units in one canonical execution observation.
3. Add and independently recompute `calendar_batch_utilization`; require observed surface exposure, at least two completed work units, no partial failure, and fewer Pi calls than work units.
4. Run the full offline suite, then run a fresh real JIT case. Accept the closed loop only if the model itself records the finding and decision, the next request observes the changed Pi surface, the batch tool is used, and the independent assessment validates the effect.
