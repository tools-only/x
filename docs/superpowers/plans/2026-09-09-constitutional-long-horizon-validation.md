# Constitutional Long-Horizon Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish removal of the weak OfficeBench evidence-policy primitive, then add an offline, stratified validation projection that measures correctness-gated Agent decision calibration without entering the Pi control plane.

**Architecture:** Pi remains the only task runtime and continues to own the existing observation → versioned finding → Agent apply/keep → `pi.setActiveTools()` → next-request exposure → bounded effect → Agent absorption chain. A new pure Python evaluation module consumes completed control/treatment summaries plus a hidden validation manifest and emits descriptive calibration evidence; it cannot create findings, choose capabilities, schedule retries, or write anything back into a running task. Existing OfficeBench and Shopping experiment runners call the module only after both arms have completed.

**Tech Stack:** Python 3.11, TypeScript Pi extensions, pytest, installed Pi CLI, JIT OfficeBench and DeepPlanning Shopping.

**Spec:** `docs/plans/2026-09-08-long-horizon-auto-research-meta-analysis.md`

## Global Constraints

- Pi is the only Agent runtime.
- Research, finding, apply, keep, no-change, reopen, and termination remain Agent decisions.
- No-research and no-mutation remain valid outcomes.
- Runner responsibilities remain isolation, append-only persistence, evaluation, and aggregation.
- Do not introduce a scheduler, automatic finding, candidate controller, rollback manager, generic mutation API, semantic retrieval policy, second harness, or cross-task memory.
- Validation strata and evaluator outcomes are never injected into the Agent context.
- Correctness, evaluator score, Pi behavior effect, paired cost delta, calibration evidence, and general harness improvement remain separate.
- A validation projection may describe evidence but must leave `harness_improvement=not_established` unless repeated held-out evidence is reviewed outside the task runtime.

---

### Task 1: Remove the Weak OfficeBench Evidence-policy Primitive

**Files:**
- Modify: `demo/pi_officebench_e2e_extension.ts`
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Modify: `tests/pi_offline_context_provider.ts`
- Modify: `tests/test_officebench_e2e.py`
- Test: `tests/test_pi_officebench_native.py`
- Modify: `demo/README.md`

**Interfaces:**
- Consumes: current OfficeBench Pi events and execution-surface snapshots.
- Produces: summaries and handoffs that expose only the behavior-changing `execution_tool_surface` primitive in the real OfficeBench runtime; the standalone `pi_native_harness_extension.ts` mechanical context-hook demo remains unchanged.

- [x] **Step 1: Verify the existing installed-Pi negative test fails for the intended reason**

Run:

```powershell
D:\conda\python.exe -m pytest -q tests/test_pi_officebench_native.py::test_installed_pi_task_runtime_omits_weak_evidence_policy --basetemp test-tmp-current\evidence-policy-plan-red
```

Expected historical RED: the real OfficeBench tool schema still contains `set_evidence_policy`. If the current partial edit already makes it green, retain the prior recorded RED and proceed with the remaining projection cleanup.

- [x] **Step 2: Remove stale real-runtime projections**

Delete OfficeBench-only evidence-policy event counting and handoff claims from `_mutation_evidence`, `_separate_outcomes`, and `_render_handoffs`. Preserve `PiOfficeBenchRun.before/after/observed` temporarily only if removing them would churn unrelated fixtures; they must not produce user-visible claims. Remove fallback scripted OfficeBench calls to the deleted tool while retaining explicit scenarios and the standalone meta-harness demo.

- [x] **Step 3: Update behavior tests**

Replace fixtures that expect `set_evidence_policy` with literal execution-surface/no-change events. The break each test catches is: a deleted text-only primitive being counted as a real OfficeBench harness change.

- [x] **Step 4: Verify focused GREEN**

Run:

```powershell
D:\conda\python.exe -m pytest -q tests/test_pi_officebench_native.py tests/test_officebench_e2e.py --basetemp test-tmp-current\evidence-policy-plan-green
```

Expected: all focused tests pass and the installed Pi schema omits `set_evidence_policy`.

### Task 2: Pure Offline Calibration Projection

**Files:**
- Create: `src/autoresearch_pi/validation_evidence.py`
- Create: `tests/test_validation_evidence.py`

**Interfaces:**
- Consumes: one literal validation stratum and the already projected `control` and `treatment` dictionaries from a completed pair.
- Produces: `project_pair_evidence(stratum: dict[str, str], pair: dict[str, object]) -> dict[str, object]` and `aggregate_validation_evidence(records: Sequence[dict[str, object]]) -> dict[str, object]`.

- [x] **Step 1: Write failing pure behavior tests**

Add table-driven tests with hand-derived fixtures covering:

```python
{
    "stratum": "future_independent_work",
    "expected_posture": "apply_if_supported",
    "control": {"passed": True},
    "treatment": {
        "passed": True,
        "finding_count": 1,
        "decision_count": 1,
        "applied_decision_count": 1,
        "correctness_gated_effect": "supported",
    },
}
```

and low-benefit/feedback-dependent cases where a correct no-change is recorded as `no_change`, not as missing research. Assert separately on `correctness_gate`, `agent_posture`, `mediator_chain`, `effect`, and paired cost deltas. Assert that no output field recommends, schedules, applies, or rolls back a capability.

- [x] **Step 2: Verify RED**

Run:

```powershell
D:\conda\python.exe -m pytest -q tests/test_validation_evidence.py --basetemp test-tmp-current\validation-evidence-red
```

Expected: import failure because `validation_evidence.py` does not exist.

- [x] **Step 3: Implement the minimal projection**

Use only deterministic field projection. Supported strata are `future_independent_work`, `low_next_request_benefit`, and `feedback_dependent`; supported hypotheses are `apply_if_supported` and `no_change_is_valid`. Unknown values fail closed. The module must not inspect task prompts, infer task semantics, read run directories, or mutate input records.

- [x] **Step 4: Verify GREEN**

Run the focused test and expect all cases to pass.

### Task 3: Hidden Manifest and Existing Runner Integration

**Files:**
- Create: `experiments/constitutional-validation-v1.json`
- Modify: `src/autoresearch_pi/officebench_e2e.py`
- Modify: `src/autoresearch_pi/shopping_e2e.py`
- Modify: `src/autoresearch_pi/cli.py`
- Modify: `tests/test_officebench_e2e.py`
- Modify: `tests/test_shopping_e2e.py`
- Modify: `tests/test_cli.py`

**Interfaces:**
- Consumes: optional runner-only `validation_strata` mappings keyed by `officebench:<case>` or `shopping:<level>:<case>`.
- Produces: a `validation_evidence` section in experiment/cohort summaries after completed pairs; Agent prompts and extension environment remain byte-identical with and without the projection.

- [x] **Step 1: Write failing integration tests**

Use fake completed pair summaries to assert:

- OfficeBench and Shopping attach the correct hidden stratum after both arms complete.
- The same task prompt digest is retained across arms.
- `validation_evidence` never appears in per-task Agent resources, prompts, Pi environment variables, or extension inputs.
- Omitting the manifest produces the previous experiment behavior, enabling a clean annotation-only ablation of the evaluator module.
- Incremental summaries survive runner failure and mark incomplete evidence as `unavailable`, not negative.

- [x] **Step 2: Verify RED**

Run the named runner/CLI tests and confirm failure because the optional manifest interface is absent.

- [x] **Step 3: Integrate after pair completion**

Parse the manifest at the CLI boundary, pass only its runner-side mapping to experiment aggregation, and persist its SHA-256 plus projected evidence in the parent experiment summary. Do not pass the mapping to `run_officebench_e2e`, `run_shopping_e2e`, Pi extension environment, or task prompt construction.

- [x] **Step 4: Verify GREEN and projection ablation**

Run focused tests once with the manifest and once without it. The underlying paired metrics and all task prompt hashes must be identical; only the parent offline projection may differ.

### Task 4: Long-task Explicit Recall Pressure Test

**Files:**
- Modify only if RED proves a gap: `demo/pi_officebench_e2e_extension.ts`
- Modify only if RED proves a gap: `demo/pi_shopping_e2e_extension.ts`
- Test: `tests/test_pi_officebench_native.py`
- Test: `tests/test_pi_shopping_native.py`

**Interfaces:**
- Consumes: more active/resolved task-local finding versions than the repeated context digest retains, followed by a supported same-task Pi restart.
- Produces: Agent-invoked `research_resource(action="inspect", finding_id=...)` retrieval of the canonical latest version without reapplying prior execution state.

- [x] **Step 1: Write an installed-Pi pressure test**

Create more findings than the digest limit, resolve some, restart the extension against the same task directory, explicitly inspect an older finding ID, and assert the latest canonical version is returned while the active tool surface starts from baseline.

- [x] **Step 2: Verify whether RED exists**

If the current exact-ID inspect and hydration already pass, record that no new runtime mechanism is necessary. Do not manufacture a failing test. If exact retrieval fails because the record is outside the bounded digest, retain the observed failure.

- [x] **Step 3: Implement only the proven minimum if required**

Add exact-ID lookup or mechanical pagination inside the owning extension. Do not add semantic ranking, embeddings, automatic relevance selection, proactive recall, cross-task state, or kernel APIs.

- [x] **Step 4: Verify both benchmark extensions**

Run installed-Pi tests and assert explicit inspect remains read-only and never restores a prior mutation automatically.

### Task 5: Real JIT Smoke, Paired Ablation, and Evidence Record

**Files:**
- Modify: `docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md`

**Interfaces:**
- Consumes: fresh JIT OfficeBench and Shopping runs selected from the hidden manifest.
- Produces: Markdown evidence separating mechanism trigger, lifecycle closure, task correctness, paired cost, decision calibration, non-uptake, and limitations.

- [x] **Step 1: Run regressions**

Run the focused suites, full pytest suite with a fresh `--basetemp`, and `git diff --check`.

- [x] **Step 2: Run smoke tasks before expensive cohorts**

Use at least one OfficeBench future-independent-work case, one OfficeBench low-next-request-benefit case, and one Shopping feedback-dependent case. Each uses a fresh root and the JIT conda Python. Stop escalating a capability after repeated autonomous non-uptake; do not add reminders or automatic findings.

- [x] **Step 3: Run paired evaluator ablation**

For completed stored pairs, compute the parent projection once with the hidden manifest and once without it. Confirm task execution artifacts, prompt digests, and Pi events are unchanged. This proves the evaluator module is observational only; it does not prove harness improvement.

- [x] **Step 4: Run repeated correctness-gated pairs only for eligible tasks**

Eligibility requires real trace evidence that observations arrive before at least two future, independent, capability-covered work units. Report no-change as valid for ineligible or low-benefit tasks.

- [x] **Step 5: Record exact results**

Append commands, run roots, case semantics, correctness, finding versions, decisions, Pi exposure, effect assessments, Agent absorption, model turns, bridge processes, projection overhead, and causal limitations to the optimization track.

### Task 6: Release Gate

**Files:**
- Modify: `docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md`

**Interfaces:**
- Consumes: all test and real-run evidence from Tasks 1–5.
- Produces: either a documented retain/remove decision per mechanism or a verified release tag and remote push.

- [x] **Step 1: Apply retention gates**

Retain a runtime mechanism only if a real Agent autonomously triggers it and it produces a correctness-gated useful effect. Retain an evaluator-only mechanism only if it changes analysis quality while leaving task execution byte-for-byte unaffected. Remove mechanisms with repeated non-uptake or no measurable value.

- [x] **Step 2: Verify release scope**

Run the complete suite, `git diff --check`, inspect the staged diff, and confirm all canonical Markdown evidence exists.

- [x] **Step 3: Tag and push only if every retained mechanism passes**

If any retained mechanism lacks repeated correctness-gated positive evidence, do not tag or push. Otherwise create a descriptive release tag and push the branch and tag to `https://github.com/tools-only/meta-harness`.
