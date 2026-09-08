# Research-to-Harness Decision Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make optional Auto-Research findings directly referenceable by concrete Pi-native self-harness decisions, return observed effects to the same task, and evaluate the loop without conflating it with task correctness or improvement.

**Architecture:** Keep `PiKernel` transport-only. The OfficeBench Pi extension owns task-local observations, findings, decisions, active-finding context, and the concrete `pi.setActiveTools()` call; the Python runner derives change-aware correctness and loop-integrity reports from task artifacts and Pi events. Research and mutation remain optional, but a surface mutation requires a valid prior finding reference.

**Tech Stack:** Python 3.10+, pytest, TypeScript Pi extension API, TypeBox, Pi CLI offline provider fixture.

---

### Task 1: Referenceable execution findings

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Test: `tests/test_pi_officebench_native.py`

**Steps:**

1. Change the offline `surface` scenario to perform a calendar observation, then create a finding with `evidence_refs`, `expected_recurrence`, and `remaining_uses`.
2. Assert that the finding receives a stable `finding_id`, references the earlier Pi tool-call ID, is written to `research-resources.jsonl`, and appears once in the next provider context as an active-finding digest.
3. Run the focused installed-Pi test and confirm it fails because the current tool has neither observation tracking nor finding IDs.
4. Add extension-local observation and finding maps. Record task action observations with their Pi `toolCallId`; validate all finding references before appending the finding.
5. Inject a bounded digest of active findings from extension-local task state in the `context` hook.
6. Re-run the focused test and confirm it passes.

### Task 2: Finding-backed Pi-native decision and consequence

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Test: `tests/test_pi_officebench_native.py`

**Steps:**

1. Update the scripted surface adjustment to pass `basis_resource_ids`, `expected_effect`, and `reconsider_when`.
2. Assert that unknown IDs are rejected, valid decisions are written with a stable `decision_id`, and the next provider request receives one observation linking finding, decision, `pi.setActiveTools()`, and active tools.
3. Run the focused test and confirm the old free-text interface fails.
4. Make `basis_resource_ids` non-empty and required for `set_execution_surface`; validate IDs against extension-local findings.
5. Persist `harness-decisions.jsonl`; on the first subsequent context call, persist `harness-observations.jsonl` and inject the linked consequence once.
6. Re-run the focused test and confirm it passes.

### Task 3: Change-aware correctness and loop-integrity evaluation

**Files:**
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Test: `tests/test_officebench_e2e.py`

**Steps:**

1. Add a failing test where the legacy evaluator passes although every evaluator-targeted file is unchanged.
2. Add a failing test for a linked finding/decision/observation artifact set and assert a separate `loop_integrity` result.
3. Capture a SHA-256 manifest before task execution and compare evaluator-targeted paths after execution.
4. Report `required_paths`, `changed_required_paths`, and `all_required_paths_changed` under task correctness while keeping independent semantic verification false.
5. Parse task-local finding, decision, and harness-observation JSONL resources; report `not_attempted`, `invalid_basis`, `applied_unobserved`, or `linked_effect_observed` without converting any state into `harness_improvement`.
6. Re-run the focused tests and confirm they pass.

### Task 4: Three decision-quality fixtures and full verification

**Files:**
- Modify: `tests/pi_offline_context_provider.ts`
- Modify: `tests/test_pi_officebench_native.py`
- Modify: `docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md`
- Modify: `handoff.md`

**Steps:**

1. Keep `baseline` as the simple no-research/no-change case.
2. Use `surface` as the recurring-benefit case with an observation-backed finding and surface change.
3. Add `transient` as a one-off finding with no mutation and assert successful completion without a decision artifact.
4. Run both installed-Pi integration tests, then the complete pytest suite.
5. Document exactly what the fixtures establish and that scripted decisions do not establish real-model autonomy or causal improvement.

No commits are performed automatically from the current dirty working tree; isolate and commit these changes only after reviewing the combined user-owned state.
