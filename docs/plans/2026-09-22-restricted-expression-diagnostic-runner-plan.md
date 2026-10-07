# Restricted-Expression Diagnostic Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a minimal diagnostic runner that measures whether a main agent can author, bind, invoke, inspect, and boundedly repair a domain-neutral restricted JSON-expression Tool through Pi's native task-local interfaces.

**Architecture:** Reuse the approved SOL evaluator in `demo/pi_task_pure_expression.ts` and the native `task_tool`/harness/resource-store integration. The runner only supplies domain-neutral fixtures and an external semantic oracle, launches the real Pi native interface, records provenance, and bounds the provider interaction. It must not create a parallel interpreter, diagnostic adapter, private execution route, or ARC bridge path.

**Tech Stack:** Existing TypeScript pure-expression evaluator and native Pi task tools, `PiKernel` launch pattern, versioned task resources, pytest, and JSONL run telemetry.

---

## Scope and non-goals

This plan is design-only. It does not invoke a provider or change production code now. It does not implement ARC acceptance, change the ARC bridge, add environment actions, or claim evidence about ARC score or game quality. The task and oracle contract are specified in [the diagnostic contract](D:/autoresearch_pi_project/docs/plans/2026-09-22-restricted-expression-real-provider-diagnostic.md); the real-run comparison remains in [the comparison report](D:/autoresearch_pi_project/docs/plans/2026-09-22-meta-capability-real-run-comparison.md).

The deferred A/B/C/D items remain open. This diagnostic is an Agent-runtime usability measurement, not evidence that adapter separation, parent-child research communication, or compressed-context continuity is complete.

## Readiness gate

Before any real-provider invocation, use the existing SOL conformance suite and native integration checks. The provider phase is blocked unless they cover:

- the `task-pure-expression-v1` AST in `demo/pi_task_pure_expression.ts`: lexical bindings, nested variable-length transforms, dynamic fields/indices, strict types, empty collections, lazy conditions, deterministic ordering, output limits, cancellation, and structured errors;
- immutable Tool/program/schema/limits versions through the native creator/change and assembly path;
- exact resource binding through the existing task resource store and native task-tool path, including bounded paths, input/schema validation, duplicate-name/parameter collisions, missing/forbidden paths, and child-grant checks;
- invocation provenance containing exact Tool/resource refs, paths, hashes, state boundaries, prepared-input hash, output/error, effective limits, and consumption;
- preserve all existing native admission checks, including dependency validity, permissions, semantic suspension, creator prerequisites, and exact-version selection. Staleness alone is not an execution rejection: a boundary mismatch on a previously captured resource is reported as historical/stale; it remains readable for an explicitly requested historical computation and is never silently rebound to a current snapshot.

The existing [pure-expression module](D:/autoresearch_pi_project/demo/pi_task_pure_expression.ts) and [conformance tests](D:/autoresearch_pi_project/tests/test_task_pure_expression.py) are the implementation and vocabulary source of truth. If native `task_tool` integration cannot carry this program and binding contract, record that as a readiness blocker. Do not add a substitute adapter or private route merely to make the diagnostic pass.

## Future implementation tasks

### Task 1: Freeze domain-neutral fixtures and the external oracle

**Files:**

- Create: `tests/fixtures/restricted_expression_diagnostic/normal.json`
- Create: `tests/fixtures/restricted_expression_diagnostic/contrast.json`
- Create: `tests/fixtures/restricted_expression_diagnostic/invalid.json`
- Create: `tests/test_restricted_expression_diagnostic_oracle.py`
- Reference: `docs/plans/2026-09-22-restricted-expression-real-provider-diagnostic.md`

1. Add normal, contrast, and invalid resources with different per-group `rule.minimum` values, nested records, inactive records, empty matches, and changed order.
2. Implement only the runner-side semantic oracle. It checks identity preservation, threshold membership, order, per-group counts, inactive-record suppression, empty-group behavior, and invalid structured-error semantics. It must never be shipped in the provider prompt or used as the Tool's execution engine.
3. Hash every resource and expected oracle input/output. Include an exact historical resource case whose captured boundary is earlier than the current observation; expected behavior is a stale/historical receipt plus a successful intentional historical evaluation, not rejection.
4. Run `pytest tests/test_restricted_expression_diagnostic_oracle.py -q`; this validates fixtures/oracle only and does not establish provider or ARC acceptance.

### Task 2: Exercise the existing SOL and native task-tool path

**Files:**

- Reference: `demo/pi_task_pure_expression.ts`
- Reference: `demo/pi_task_local_tools.ts`
- Reference: `demo/pi_task_harness_route_runtime.ts`
- Reference: `demo/pi_task_resource_store.ts`
- Reference: `demo/pi_task_harness_assembly.ts`
- Reference: `demo/pi_task_local_self_harness.ts`
- Add only focused integration coverage under `tests/` if the native path lacks it.

1. Run `pytest tests/test_task_pure_expression.py -q` and preserve its AST/limit/error semantics; do not rename its operators to the old step-program vocabulary (`select`, `count`, `pick`, `group_by`, `diff`, `summarize`, or `emit_observation`).
2. Through the native Pi interface, require the main-agent sequence: `task_harness(read_method, tool-creator)`; `task_harness(change)` with the provider-authored AST/schema/limits; exact `task_harness(assemble)` selection; exact resource binding; normal, contrast, invalid, and intentional historical invocations.
3. Ensure the native path records semantic output and structured errors, not only completion status. Preserve failed candidates and allow at most two repairs and one replacement immutable Tool version.
4. Verify that the native path preserves every existing admission check: unselected/retired exact Tool refs, dependency/permission failures, semantic suspension, creator prerequisites, missing paths, collisions, and invalid input may fail structurally; stale boundary alone is provenance/status for historical evidence, not an automatic execution ban.
5. If the existing entry cannot independently install the task tools, a thin bootstrap extension may call the native installer only. It must not contain a parallel executor, replacement route, pre-authored AST, or diagnostic-only adapter. If native evaluation or resource binding still cannot be reached, stop at this gate and report the missing integration.

### Task 3: Add the minimal Pi runner and report

**Files:**

- Create: `tools/restricted_expression_diagnostic.py`
- Create: `tests/test_restricted_expression_diagnostic_runner.py`
- Reference: `src/autoresearch_pi/pi_kernel.py` and the native task-tool launch fixtures.

1. Write runner tests for provider configuration, bounded turns/tokens/wall time, fixture/resource hashes, local JSONL logs, provider-reported usage labeling, cancellation, and deterministic replay of native Pi calls. These tests may use a provider double only to validate orchestration; they must still call the same native Pi surface.
2. Launch the existing Pi native extension using the `PiKernel` pattern. If a standalone entry is required, load only a thin bootstrap extension that invokes the native installer. Do not import ARC e2e orchestration or install a parallel adapter, evaluator, bridge, `arc_action`, environment, or child process.
3. Give the provider only the task statement, schemas, resources, and creator contract. Keep the oracle and expected results runner-side. The main agent owns AST authoring, version selection, resource binding, invocation, semantic inspection, and repairs.
4. Emit a reproducible report with creator-read, authoring, assembly, binding, invocation, semantic-output-use, invalid-input, historical-use, and repair events; exact refs/hashes; runtime consumption; failures; and any main-side duplication.

### Task 4: Run the real-provider diagnostic only after approval

**Files:**

- Create at run time only: a new diagnostic output directory under `runs/`.

1. Review the deterministic SOL and native-interface evidence and confirm the prompt contains no AST, fixed answer algorithm, or hidden oracle.
2. Start one bounded real-provider run through the minimal native Pi runner. Do not reuse `tools/arc_capability_experiment.py` or ARC e2e as the semantic runner.
3. Inspect normal/contrast oracle results, invalid structured error, intentional historical receipt, provenance, consumption, repair count, and stop reason. A provider result is usability/repair evidence only.
4. Keep the result separate from the ARC real-run comparison and do not claim closure of A/B/C/D.

## Verification commands

Before any provider invocation:

```powershell
pytest tests/test_task_pure_expression.py -q
pytest tests/test_restricted_expression_diagnostic_oracle.py tests/test_restricted_expression_diagnostic_runner.py -q
```

Expected result: the existing SOL conformance suite and native-interface runner checks pass with semantic assertions, structured errors, historical/stale provenance, and exact Tool selection. A missing native integration blocks the real-provider phase; it is not a reason to add a parallel runtime or weaken the contract.

## 2026-09-23 bounded-run evidence and runner correction

The first approved provider attempt is preserved at
`runs/restricted-expression-diagnostic-real-provider-20260923-0130`. It reached
five native provider turns and 11,717 measured output tokens under limits of
eight turns, 30,000 output tokens, and 180 seconds. The final assistant message
stopped with `stopReason=length` before any Tool was authored, so this attempt
does not establish semantic success or a method-quality failure. The runner had
issued only one `kernel.prompt`; after `agent_settled` it did not start a bounded
continuation despite remaining turn/token/wall budget.

The raw event artifact was 333,016,457 bytes. Of 11,515 events, 11,445
`message_update` records accounted for 332,205,648 bytes because streaming
updates retained growing message bodies. The CLI then attempted to print the
entire event/report structure and hit Windows GBK encoding. The correction in
`tools/restricted_expression_diagnostic.py` therefore:

- observes raw events only for budget accounting, while passing a bounded
  projector to `PiKernel` so its own event list and wait results also exclude
  streaming updates;
- persists a size/count-bounded event projection with hashes/outlines for
  oversized events and retains assistant/tool/settlement terminal evidence;
- prints and saves a compact summary rather than replaying `events` and
  `settled` on stdout, while explicitly configuring UTF-8 output;
- after a settled `length` stop, starts another prompt in the same Pi session
  only while wall, turn, and token budgets remain. The continuation text asks
  only to finish the unfinished diagnostic from the existing transcript; it
  supplies no AST, oracle result, or task algorithm; and
- writes the bounded journal and summary before re-raising an unexpected wait
  or transport failure.

Local regression evidence after this correction: runner tests `16 passed` and
native/oracle tests `9 passed`. No paid provider was invoked for the correction.
A separate real ARC attempt `ARC010818-683` ended at its first provider request
with HTTP 402 insufficient balance. That is an external funding blocker, not a
quality result. A new provider or ARC run requires restored balance and explicit
authorization; historical runs must not be overwritten.
