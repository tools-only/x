# Minimal reflective evolution v1 — offline implementation

2026-11-09 (Asia/Shanghai). Implemented and committed locally. No paid/provider task runs, no push. All model traffic below used local scripted providers; ARC used the mock SDK. No yibu changes, no CPU-temperature routine changes, and no real secrets written to files/logs.

## Problem, claim and bounded scope

The approved [design](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/design-evolution-task-path.md) identified three disconnected transitions: the saved process did not own continuation, declared compute was not automatically executed on the reflective path, and the next task consequence was not attributed to its producer. The narrow implemented claim is mechanical: one current process replaces its predecessor, exact referenced decision/feedback compute runs once per input/event, and the next canonical task result returns with the producing method/resource identities. This removes repeated selection/argument assembly and evidence reconstruction. It does not establish that a model chooses useful methods, trusts correct outputs, replaces its own reasoning, or improves a task.

Scope was implementation plus offline function/wiring acceptance. Direct work and reasonable non-use remain valid. There is no new Agent tool, DSL, supervisor, forced reflection phase, action/deny/guard mount, or component-count reward.

## Worktrees, branches and commits

| Worktree / branch | Local commits |
| --- | --- |
| `D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109`, `codex/arc-reflective-core-20261109`, base `e0fd805a` | Shared initial `9cdd29c88504e35ee0e89a0aac1a24a193b3508a`; shared settlement/activation `28f301d62f8f50d157060f719f7653ef05c4eb25`; ARC adapter `edf7ba9a39eceaf56e17d22713acc1a13abd4367` |
| `D:/autoresearch_pi_project/worktrees/ppt-reflective-core-20261108`, `codex/ppt-reflective-core-20261108`, base `e0e02194` | Shared initial cherry-pick `043eb0e7c3d4436122b48cda38c8b4983456e7dc`; same shared refinements `be97a69766cb14fdf9011c45874ee5c77da6723d`; PPT adapter `88e331b92906fd8eab0330e38cad1a7a5fd4134b` |

Shared code was implemented first in ARC and brought to PPT (initial commit cherry-picked, subsequent shared corrections mirrored). Adapter changes stayed in their respective worktrees. The pre-existing `registerSubagents` active/candidates difference between branches was preserved. Pre-existing scratch files, including PPT's modified `real-task-result.md`, were not included in these commits. A subsequent ARC documentation commit contains this report and its compact evidence files.

## Changes and lifecycle

Shared paths, present in both worktrees:

- `demo/arc_thin_binder.ts`: process/memory use the same Component/source/hash/version store as other kinds. `publish` validates captured source before updating its live file. One selected saved process occupies the Binder's method binding; a pending definition cannot replace it early. Activation failure preserves the old binding/source. Restores record their saved origin and create future versions or unchanged receipts; costs and task history are not rewound.
- `demo/ppt_reflective_core.ts`: exact refs, one current strategy, producing identity, input/scope and output references. Activation clears stale legacy next choices. Ref/scope mismatches pause automatic work while native task work stays available. Current strategy replaces the previous context position.
- `demo/arc_thin_native_runtime.ts`: existing native decision/feedback execution is restricted to exact current-process refs on the new path. Source/dependencies are pinned for each producing execution. Same owner/source/input/event reuses the settled result, including errors; interrupted executions remain unknown and are not replayed. Private local state and compute allowance survive serialization. Full outputs are ordinary immutable result files, returned unasked in the next request; subsequent task receipts link back to them. Retired refs/mounts leave the current result slot, with historical feedback still attributed to its producer.
- `demo/arc_thin_components.ts`: reflective validation rejects action/guard mounts. Ordinary parent tools retain their existing native action capability; automatic code and children cannot acquire it.
- `demo/arc_thin_workspace.ts`: native `read` pretty-prints large single-line JSON for ordinary line paging, without changing original bytes or adding domain analysis. Edit/Python still access original bytes.
- `demo/prompts/reflective_native_contract.md`: on-demand source/interface/identity/binding contract, copied to read-only `data/native-components.md`. Agent md contains only outcome/mechanism/resources/boundaries and the limited runtime-semantics statement.
- `tests/reflective_evolution.test.ts`: replacement, identity, atomic activation failure, invalid source, restore, dependency/scope mismatch, bounded compute, error/empty/timeout settlement, serialized-restart dedupe, pinned late feedback, and native JSON paging.

ARC-only paths:

- `demo/arc_reflective_extension.ts`: awaits decision compute before requests; both direct `arc_action` and native foreground `env.act` share the same action/feedback boundary. The native `ActCall.action` mismatch was fixed. Receipts carry producer/input/output links, before/after immutable observation refs, existing `changed_cells`/`bbox`, and an explicit Agent-interpretation label for `decision_text`. Memory and process exposure hashes come from Binder identities. Parent/child request reservations retain owner identities and settled-request IDs on restart.
- `src/autoresearch_pi/arc_thin_e2e.py`: only the reflective extension path receives neutral continuation/length facts and skips periodic ADAPT/checkpoint scheduling. Reflection never clears the existing no-action streak. Other paths retain their existing prompts and switches. Run config records the automatic allowance and shared-core source hashes.
- `demo/prompts/arc_reflective_task.md`, `tools/arc_reflective_smoke_provider.ts`, `tests/test_arc_reflective_core.py`: mechanism surface and scripted real-Pi/mock-bridge regressions, including both action paths and repeated reflection without task progress.

PPT-only paths:

- `demo/ppt_demo_extension.ts`: modern process/native compute uses source/render facts; render receipts return to the producing method with source hash and file/component lineage. The `agent_end` legacy `loop.refs` access is fixed for modern sources. Live context replacement removes old strategies. Shared parent/child accounting uses distinct request identities. Render/look/deliver integrity is retained.
- `demo/prompts/ppt_demo_agents.md`, `demo/prompts/ppt_demo_system.md`: current method and native binding semantics, without reflection recipes.
- `src/autoresearch_pi/ppt_demo.py`: modern continuation ignores stale legacy hook choices; NEXT/RESUME remain transport. Protocol records the automatic allowance and shared sources.
- `tests/ppt_demo.test.ts`, `tests/test_ppt_native_pi.py`: await the now-asynchronous provider boundary; exercise installed Pi, modern end/resume, render feedback, and a three-page rev2 render/look/deliver path with **zero Agent component publications**.

`component_consumed` remains exposure/read accounting. It was not renamed or promoted to semantic success. Publication, context exposure, execution, task consequence and causal value remain separate facts.

## Budgets and operational setting

At most one decision tool and one feedback tool are allowed in current-process refs. More are rejected, rather than silently selecting some. Automatic work uses the existing read-only native execution surface, a maximum five-second call allowance, the shorter remaining task deadline, and a persisted cumulative allowance. Allowance is reserved before execution, so interrupted calls cannot receive free retries after restart. Exhaustion is shown once; cached settled outputs remain readable. Reflection/compute do not replenish task budgets or count as task progress.

`REFLECTIVE_AUTO_COMPUTE_MS` must specify a finite run allowance and the adapter must have a finite deadline. The default allowance is **0**; this intentionally does not inherit an old paid-run authorization. Tests configured 60000 ms for full-chain fixtures (unit fixtures used 30000 ms). Future authorized run manifests must fix this value alongside total parent/child and wall limits. Existing parent/child monetary guards remain shared. No new paid experiment was authorized or launched.

The combined current decision/feedback compute projection is capped at 2400 characters. Full output and failure refs are retained; canonical observations/images are not removed by that cap.

## Offline verification

Commands run from the indicated checkout. Python commands used `PYTHONPATH=src`. All Pi model replies were local scripts, not remote providers.

| Checkout | Command | Result / evidence |
| --- | --- | --- |
| ARC | `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_binder.test.ts tests/reflective_evolution.test.ts` | **12 passed**; [shared final log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-shared-final.txt) |
| ARC | `node --experimental-transform-types --test --test-name-pattern="native compute dedupes" tests/reflective_evolution.test.ts` | **1 passed**, after strengthening restart to serialize/reload state; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-restart-final.txt) |
| ARC | `python -m pytest tests/test_arc_reflective_core.py -q --basetemp=.scratch/evolution-v1-arc-accept` | **9 passed**; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-arc-accept.txt); actual Pi 0.87.0, scripted provider, mock ARC SDK |
| ARC | `python -m pytest tests/test_arc_thin_request_accounting.py tests/test_arc_thin_recovery.py tests/test_reflective_core_evidence.py -q` | **34 passed**; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-python-support.txt) |
| PPT | `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts tests/ppt_trials.test.ts tests/reflective_evolution.test.ts` | **20 passed**; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-ppt-node-accept.txt) |
| PPT | `python -m pytest tests/test_ppt_native_pi.py tests/test_ppt_demo.py tests/test_reflective_core_evidence.py -q --basetemp=.scratch/evolution-v1-ppt-accept` | **17 passed**; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-ppt-python-accept.txt); includes real office renderer and three-page rev2 direct delivery |
| ARC | `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_binder.test.ts tests/arc_thin_components.test.ts tests/arc_thin_workspace.test.ts tests/arc_thin_native_runtime.test.ts tests/arc_thin_native_loop.test.ts tests/arc_thin_native_context.test.ts tests/arc_thin_activation.test.ts tests/arc_thin_boundary.test.ts tests/reflective_evolution.test.ts` | **67 passed, 1 pre-existing failure**; [log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-node-tests.txt) |
| ARC | `python -m pytest tests/test_arc_reflective_core.py tests/test_arc_thin_request_accounting.py tests/test_arc_thin_recovery.py tests/test_arc_thin_decide_prompt.py tests/test_reflective_core_evidence.py -q --basetemp=.scratch/evolution-v1-arc-final` | Initial **42 passed, 2 failed**: one fixture/action-contract integration failure subsequently fixed and covered by the 9-pass rerun; one pre-existing prompt assertion. [Initial log](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-python-tests.txt) |

The two outstanding baseline assertions are `arc_thin_native_context.test.ts` expecting “same-named Task tool” while unchanged native guidance says “same-named native tool”, and `test_arc_thin_decide_prompt.py` expecting an older `WINDOW_DECIDE` sentence. [Baseline check](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-baseline-check.json) confirms unchanged test/prompt/projection files and identical `WINDOW_DECIDE_PROMPT` against `e0fd805a`. These non-reflective comparison-arm instructions were not changed to satisfy obsolete string assertions. The full suite is therefore **not claimed all green**.

Early fixture/test-harness issues were corrected: JSON paging expectation was off by one; synchronous test hooks needed awaiting; the foreground fixture needed `run(args,env)`; then the new integration test exposed the real ARC `name`/`action` mismatch. Failed attempts were retained as development evidence, not counted as passing acceptance.

`git diff --check` passed in both worktrees. No tests or commands inspected game implementation source.

## Costs and evidence layers

[Offline metrics](D:/autoresearch_pi_project/worktrees/arc-reflective-core-20261109/.scratch/reflective-core/evolution-v1-offline-metrics.json) come from existing `component_runs` and `wasi_runs` logs, not a new runtime analysis service:

| Fixture | Actual mounts / feedback mounts | Sum of recorded mount wall time | Snapshot calls / total snapshot time / maximum | Maximum snapshot text bytes |
| --- | --- | --- | --- | --- |
| ARC closed loop | 6 / 3 | 7316 ms | 7 / 1455.05 ms / 373.61 ms | 12183 |
| PPT mounted render loop | 7 / 2 | 10100 ms | 7 / 1351.43 ms / 304.37 ms | 111882 |

Snapshot work is measurable overhead; mount elapsed time already includes its snapshots, so these columns must not be added together. These small offline fixtures do not establish cheap execution on long workspaces. Parent/child model usage in these runs is scripted/synthetic and cannot estimate real inference cost or net benefit.

| Layer | Status and limits |
| --- | --- |
| Functional correctness | Passed for the changed v1 contracts and listed negative cases; the two unrelated baseline string failures remain disclosed. |
| Full-chain reachability | Passed **offline** for installed Pi → native publish/binding → automatic compute → real mock-ARC action or real office render → producing-version feedback. Scripted creation is a wiring diagnostic. |
| Autonomous adoption | **Unverified**. No real provider was run. Preset process and scripted publications do not count as evolution. |
| Net benefit | **Unverified**. No matched-budget real-model comparison, semantic replacement measurement, held-out performance, or independent PPT quality acceptance. |

## Deviations, open issues and next check

No deliberate expansion of the approved loop. Initial shared code was cherry-picked; final shared fixes were mirrored because adapter development was already in progress in both checkouts. Automatic execution defaults to zero until a finite allowance/deadline is supplied, rather than choosing a new paid-run budget. The old explicitly authored legacy workflow/loop compatibility code remains isolated; preset and documented v1 sources use modern `{strategy,refs}` and do not invoke those hooks. No new legacy/shim execution path was added.

Remaining uncertainty: actual provider length/compaction continuity, historical pre-v1 state migration, generalization to large workspaces/new tasks, semantic use of output, harmful-method recovery decisions, and parent-plus-child net cost. Serialized restart/cache retention and scripted resume prove mechanics only; they do not prove cognitive continuity. Restore changes future binding and does not erase learned information, environment state or delivery history.

The next falsifiable behavioral check, only after a separately authorized budget, is the design's single-loop matched comparison: ordinary task goal, no component quota or reflection trigger, evidence of actual repeated work replaced by the Agent's own bound compute, subsequent task behavior, and total parent/child cost. If the model executes compute and then repeats the old work, record adoption/replacement failure and stop expansion. A/C/D backlog items remain open.

No paid runs, no az/provider task launches, no push; no yibu or CPU-temperature-routine changes. This report is also copied byte-for-byte to `C:/Users/qi/grok-out/result-evolution-v1.md`.
