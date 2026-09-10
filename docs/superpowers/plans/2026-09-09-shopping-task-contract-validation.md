# Shopping Task Contract Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the canonical JIT Shopping level contract to both experiment arms, make model-visible observation-cost accounting comparable, and rerun a fair Level-3 paired smoke without expanding the task runtime control plane.

**Architecture:** A small read-only loader extracts the level-specific Shopping system prompt from JIT's canonical adapter source and combines it with the dataset query before the task is submitted to Pi. The Pi extension continues to own only task-local research and a capability-specific surface; the runner only submits identical task semantics, persists facts, evaluates, and aggregates. Observation characters are counted at the actual tool-result boundary in both arms.

**Tech Stack:** Python 3.11, `ast`, pytest, TypeScript Pi extension, installed Pi CLI, JIT conda environment.

**Spec:** `docs/plans/2026-09-06-autoresearch-pi-task-local-architecture.md`; `docs/plans/2026-09-08-long-horizon-auto-research-meta-analysis.md`

## Global Constraints

- Pi is the only agent runtime.
- Research, finding, apply, keep, no-change, and termination remain Agent decisions.
- No-research and no-mutation remain valid outcomes.
- Runner responsibilities remain isolation, event persistence, evaluation, and aggregation.
- Do not introduce a scheduler, candidate controller, rollback manager, generic mutation API, causal DAG, or cross-task memory.
- Control and treatment receive identical benchmark task semantics; ground truth and evaluator internals remain hidden.
- Correctness, evaluator score, Pi behavior effect, and harness improvement remain separate.

---

### Task 1: Canonical JIT Shopping Contract

**Files:**
- Modify: `src/autoresearch_pi/shopping_e2e.py`
- Test: `tests/test_shopping_e2e.py`

**Interfaces:**
- Consumes: `JIT_ROOT/benchmark/adapter/deepplanning.py`, Shopping level, raw query.
- Produces: `_load_jit_shopping_system_prompt(jit_root: Path, level: str) -> str`, the submitted canonical task prompt, and `task-contract.json` digests.

- [x] **Step 1: Write failing tests**

Add literal fixture prompts for Levels 1–3 and assert that each case gets the matching canonical contract, that Level 3 includes coupon/cart semantics, and that the raw query remains separately available.

- [x] **Step 2: Verify RED**

Run: `D:\conda\python.exe -m pytest -q tests/test_shopping_e2e.py -k "canonical_contract or task_prompt"`

Expected: FAIL because `_load_jit_shopping_system_prompt` and `task_prompt` do not exist.

- [x] **Step 3: Implement minimal loader and prompt composition**

Parse only top-level string assignments in the canonical JIT adapter with `ast`; reject missing, non-string, or unsupported levels. Submit `task_prompt`, while summaries continue to retain the raw query as `question`.

- [x] **Step 4: Verify GREEN**

Run the same focused tests and expect PASS.

### Task 2: Comparable Model-visible Cost Metric

**Files:**
- Modify: `demo/pi_shopping_e2e_extension.ts`
- Test: `tests/test_pi_shopping_native.py`

**Interfaces:**
- Consumes: exact text returned to the model by each Shopping tool.
- Produces: `model-visible-observation-metrics.json.observation_chars` for both control and treatment.

- [x] **Step 1: Write failing installed-Pi test**

Run the same deterministic Shopping tool scenario in control and treatment, assert both report positive character counts, and assert treatment exceeds control only by the neutral provenance metadata actually appended.

- [x] **Step 2: Verify RED**

Run: `D:\conda\python.exe -m pytest -q tests/test_pi_shopping_native.py -k "counts_visible_chars_in_both_arms"`

Expected: FAIL because control currently reports zero.

- [x] **Step 3: Count the returned text in both branches**

Build the exact visible string first, add its length once, and return it. Do not add projection, recommendation, or candidate logic.

- [x] **Step 4: Verify GREEN**

Run the focused native test and expect PASS.

### Task 3: Regression and Real Paired Smoke

**Files:**
- Modify: `docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md`

**Interfaces:**
- Consumes: fair Level-3 control/treatment summaries and canonical event/resource JSONL.
- Produces: a recorded result separating correctness, autonomous uptake, Pi-native effect, cost, and causal limitations.

- [x] **Step 1: Run focused and full regressions**

Run: `D:\conda\python.exe -m pytest -q`

Run: `git diff --check`

- [x] **Step 2: Run a new Level-3 case 15 pair**

Run with the JIT Python and a fresh output directory through `shopping-experiment`, one repeat, Level 3 case 15.

- [x] **Step 3: Audit canonical evidence**

Check both prompts received the coupon contract; then inspect cart/evaluation, finding versions, decisions, Pi exposure, post-exposure observations, and effect assessment. Treat no-research/no-mutation as valid and do not infer improvement from an evaluator score alone.

- [x] **Step 4: Record the outcome**

Append the exact commands, run paths, task result, mechanism uptake, costs, and limitations to the optimization track. Do not tag or push unless autonomous uptake and a correctness-gated positive paired effect are actually established.

### Task 4: Agent-selected Shopping Detail Surface

**Final status: rejected and removed after the planned autonomous gate.** The
mechanical chain worked, but two canonical high-opportunity Level-1 runs produced
no finding, decision, selective call, or effect. See
`docs/plans/2026-09-09-agent-selected-shopping-details.md`. The unchecked boxes
below are retained as historical plan steps, not remaining production work.

**Files:**
- Modify: `demo/pi_shopping_e2e_extension.ts`
- Modify: `tests/pi_offline_context_provider.ts`
- Modify: `src/autoresearch_pi/shopping_e2e.py`
- Test: `tests/test_pi_shopping_native.py`
- Test: `tests/test_shopping_e2e.py`
- Spec: `docs/plans/2026-09-09-agent-selected-shopping-details.md`

**Interfaces:**
- Consumes: Agent-selected product IDs and dot-path fields, a cited full-detail finding, and Pi's public active-tool surface.
- Produces: a task-local `selective_details` surface and independently auditable `selective_detail_compression` effect.

- [ ] **Step 1: Write failing installed-Pi and runner-link tests**

The installed-Pi fixture must create one full detail observation, cite it in a finding, apply the selective surface, observe it on a later request, and retrieve the same products with explicit fields. The runner fixture must reject mismatched basis/exposure/window data and accept a literal recomputation.

- [ ] **Step 2: Verify RED**

Run the two focused tests and confirm failure because `selective_details`, `shopping_selective_details`, and its audit metric are unsupported.

- [ ] **Step 3: Implement the minimum capability-specific surface**

Keep the full backend result in canonical JSONL, return only Agent-named fields, use immutable finding snapshots and the existing exposure gate, and assess literal characters per product. Do not add automatic relevance or candidate logic.

- [ ] **Step 4: Verify GREEN and regressions**

Run focused native/audit tests, all Shopping tests, the full suite, and `git diff --check`.

- [ ] **Step 5: Run autonomous smoke and isolated ablation**

Use fresh high-opportunity Shopping tasks. Record whether the Agent creates the finding before affected actions, whether Pi exposes the surface, whether the effect is valid and correctness-gated, and whether task/cost deltas are positive. Remove or revise the capability after repeated negative evidence; do not force uptake.
