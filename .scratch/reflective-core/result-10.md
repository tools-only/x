# Reflective core round 10: minimal process layer

## Change record

**Opportunity.** The PPT agent had to choose between continue, resume, and stop in a hard-coded runner loop. It had no reusable agent-owned workflow for render and delivery boundaries. The seeded `deck_workflow` skill also supplied workflow guidance before the agent chose to create it.

**Claim.** A session-local process envelope, published through the existing `reflect_component` lifecycle, can supply strategy and optional isolated hooks at existing workflow and settled-round boundaries. A bounded offline production-path check can falsify bad activation, lost last-good recovery, an integrity bypass, or false evidence credit.

**Burden removed.** Process revisions can replace repeated settled-round and render/delivery transition choices with an agent-authored version, while keeping model-call construction and fixed host controls unchanged.

**Bounded evaluation.** No-provider tests on the local Windows checkout: publish v1, stage v2 while work is in flight, check next-boundary activation and exact references, exercise invalid source/reference and hook error/timeout recovery, retain stale-render delivery protection, and reject text-only use credit. This evaluation covers wiring and function only.

## Implementation

- Added `kind=process` to the existing `reflect_component` define/redefine/restore/inspect path. Process envelopes are Binder-versioned and require the existing mutation note and lifecycle entry. Both `workflow` and `loop` carry strategy text, optional TypeScript hook source, and exact component references. Invalid shape, TypeScript, export contract, or references return a receipt before staging and leave the active version unchanged.
- Isolated hooks run in a permission-restricted Node child and a VM context with string code generation disabled, bounded execution time and output, and no exposed filesystem, network, or process globals. The host retains effects and fixed checks. A process activates as a whole at the next render/delivery or settled-round boundary. Activation rechecks references; an incompatible staged revision is rejected with a receipt.
- Workflow hooks run before render and deliver. Loop hooks run at `agent_end`; the runner consumes the resulting choice and guidance for the next prompt. With no process, the existing hard-coded choice remains. Hook failure restores the last-good process for future boundaries, records a failure receipt, and fails the workflow transition or stops the runner.
- Active strategy text enters the next provider request after activation. Boundary logs include process version, input state, references, and outcome. The checker adds `--mode process`: a noted agent definition, a noted redefinition, and a subsequent boundary where the enforced hook actually changes the choice are required. Strategy-only publication/use does not pass.
- Removed the `deck_workflow` startup seed. No process object is seeded. `d1-kickoff.txt` was not changed or run.

Fixed host behavior remains in place, including Pi, the reflect API and validation, the evidence checker, deadline/budget/permission guards, provider identity, user brief, and the render SHA-256 delivery check. No DSL, scheduler, recursive hooks, or Pi changes were added.

## Files

- `demo/ppt_demo_extension.ts`
- `src/autoresearch_pi/ppt_demo.py`
- `tools/check_reflective_core_evidence.py`
- `tests/ppt_demo.test.ts`
- `tests/test_ppt_demo.py`
- `tests/test_reflective_core_evidence.py`

## Verification and smoke evidence

Provider/environment: local Windows checkout, Node v25.5.0, Python pytest, in-process test doubles, and the local PPT renderer. No provider task, az provider call, or model API call occurred. No secret was written to a file.

- `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py tests/test_reflective_core_evidence.py -q` — passed, **6 tests**.
- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` — passed, **7 tests**, 0 failures.
- `git diff --check` — passed before implementation commit.
- The Node production-path test published process v1, revised a referenced component, staged process v2, and observed v2 at the next settle boundary with the exact v2 reference. It also exercised invalid TypeScript, a missing reference, a runtime throw, and a timeout; last-good v2 remained active after failures.
- The local render/delivery scenario ran with an allowing workflow hook, then changed the source after render. Delivery still rejected the stale source by its existing SHA-256 check.
- The Python runner test supplied a settled `adapt` choice and observed `PPT_NEXT` with its guidance at the next prompt. The checker test accepted a noted define/redefine followed by a changed hook action and rejected a text-only boundary.
- `reflect_component(op="inspect")` and initial-registry assertions confirmed there was no seeded `deck_workflow` and no prepublished process.

## Evidence levels and limits

- **Functional correctness:** passed for the offline cases listed above.
- **Full-chain reachability:** the extension hook, Binder publication path, local runner handoff, and local render/delivery path were exercised with test doubles and the local renderer. Provider-request behavior is unverified.
- **Autonomous adoption:** unverified; no model task ran.
- **Net benefit:** unverified; no matched task results, parent-plus-child cost, latency, or quality comparison was collected.
- Deferred checklist D remains open. The tests check same-session next-request strategy injection and version activation; they do not establish what survives provider compaction or session rotation.

## Proposed bounded real-run protocol for George to authorize

Run three matched baseline/treatment pairs on the same full-deck brief, source material, pinned Pi, model settings, and comparable total parent-plus-child budget. Use **qwen3.8-27b on the az provider** for all runs and same-model children. Randomize each pair's order. Do not prescribe or require process creation; record reasonable non-use. Freeze the delivery and factual-traceability rubric before the runs.

Cap each run at 45 minutes and USD 12 total parent-plus-child spend (USD 72 maximum for six runs). Stop at either cap, or when unknown usage could exceed the spend cap; retain failed and pending work in cost accounting. Report delivery quality, process definition/revision and actual changed-action evidence, repeated decisions, elapsed time, tokens, spend, management turns, failures, and child work separately. Treat no applicable process opportunity as inconclusive. Claim net benefit only if treatment quality remains acceptable and the matched aggregate cost or latency improves without exceeding the fixed budget. One observed use is adoption evidence, not net-benefit evidence.

## Commits

- `1a0e38bb` — `Add reflective process hooks to PPT harness`
- `Record reflective process evidence` — this report is committed separately after the implementation.
