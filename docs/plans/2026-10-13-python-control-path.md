# Persistent Python as the parent control path

Date: 2026-10-13, updated 2026-10-14 (Asia/Shanghai). Status: implemented candidate; real-provider evaluation authorized and pending.
Base: `c0c9a70d`, Claude's checkpointed Python workspace. Branch: `codex/arc-query-efficiency-20261013`.

## Problem and claim

The ordinary yibu/qwen3.8-27b/high run `runs/arc-final-20261013/arc-run` recorded 17 parent requests / 303,214 reported tokens for decision 2, and 18 successful Python checkpoints by action 4. Its Python calls repeatedly expanded raw observations. Persistence exists; efficient semantic reuse is unverified. The run's frozen runtime will not be changed.

The current interface grants `env.act` only after publishing code as a tool. The published tool then runs without the parent's namespace. This requires a publication/dependency decision even for a temporary experiment, despite an existing authorized host action boundary. `python(save=...)` already combines save and execution in one request; this proposal does not claim that removing save automatically removes a model request or explains the entire observed cost.

Narrow claim: a parent can reuse its persisted functions and values, execute a feedback-dependent experiment, and return selected evidence in one ordinary Python call, without publishing a component or exporting session dependencies. The host remains responsible for canonical actions and receipts. The model remains responsible for selecting the experiment and interpreting evidence.

The benefit hypothesis is fewer analysis/management requests and less raw-data expansion. It is refuted if ordinary runs still expand grids and delay experiments, if feedback is stale, or if reduced cost damages task progress. Temporary code, existing saved code, and direct actions all remain valid choices. No default object detector, game rules, new worker, compulsory memory record, or forced tool-use quota is added.

## Design and cost

- Reuse the existing `env.act` replay and host action boundary for foreground parent Python. A save is optional; saved tools remain self-contained and versioned.
- Every actual action carries the host's canonical state back into the replay. Update `state`, `grid`, `prev_grid`, `history`, and `env` before the program continues. The initial request and checkpoint remain fixed across replays, so mutations preceding an action run once in the final committed namespace, not once per replay.
- Recovery and checkpoint validation are passive. A failed load stops user code; restoring definitions or unpickling cannot request actions. Read-only children and automatic views cannot act.
- The runtime mechanically handles action replay, state refresh, checkpoint commit, accurate receipts, and decision termination. The parent recognizes the opportunity, writes/selects code, uses results, and retains/revises/abandons the method. Publishing a reusable tool remains a separate optional semantic choice.
- First benefit path: existing persisted helper -> one Python call -> program computes/acts/checks -> selected output + canonical receipts -> next real parent turn. No new schema, management agent, or extra model summary pass. Existing short tool/prompt wording is replaced to describe the available control path.
- Existing action scope, review restrictions, prediction handling, terminal/level stops, per-call execution integrity limits, workspace confinement, session isolation, and source versioning remain. This is not a new unlimited live run.
- Failure/cancellation after an action must preserve receipts of actions already performed; environment history cannot be rolled back. Runtime-owned state follows canonical observations; explicitly copied grids remain snapshots. Unsupported checkpoint values and replay determinism limits remain explicit.

## Evaluation protocol

This change authorizes implementation and local diagnostics, not a new paid ARC run. Earlier user instructions against tests applied to the static design review; no benchmark/provider run will be started here. Focused offline checks exercise the real WASI guest with deterministic host feedback and are diagnostic only.

Functional negative cases: no host action capability, read-only child, denied action, stopped level/terminal sequence, corrupt checkpoint, side effects during unpickle, replay divergence, a computation mutating a persisted value before multiple actions, lazy file reads, and errors after an action.

Future ordinary-provider comparison (not executed): base versus candidate, same yibu/qwen3.8-27b/high, official ls20, query observations, memory/refiner/context settings held constant, no prompt requiring Python use. Three independent runs per arm, alternating run order, same initial public state where supported. Proposed diagnostic allowance per run: 10 minutes, 100k parent-plus-child reported tokens, or 20 actions, whichever occurs first; unknown/pending/failed requests included separately. These are a proposed evaluation protocol, not changes to the user's current uncapped action setting.

Measure parent-plus-child reported/uncached/cached/output/reasoning tokens, wall time, first useful experiment latency, progress/levels, invalid/no-op actions, replay overhead, repeated raw queries, and actual dependency/publication management. A candidate reduction of at least 30% in median cost to a comparable useful experiment is an exploratory retention target, conditional on no observed task-progress regression; three samples do not establish general improvement. Existing logs (`usage`, `request-events`, `context_budget`, `component_runs`, `python_session`, `wasi_runs`, `played_actions`) provide accounting. Capability existence does not establish adoption.

## Implementation and verification

2026-10-14: the user authorized the integrated optimization implementation, limited tests, a real ARC experiment, and continued diagnosis/correction if spending remains excessive. This supersedes the earlier implementation-only scope. The existing branch is reused on the latest Claude base; no existing frozen run is edited.

Implemented: ordinary parent Python action access; canonical grid/state/history refresh; accurate receipts after errors; passive recovery/checkpoint guards; mapping-compatible env measurements; semantic current-memory rendering and refresh each request; 8000-character common-result delivery; archival of old result bodies with exact references; recent reasoning projection preserving signed blocks; same-decision length-recovery projection/accounting; explicit parent output policy removing accidental SDK caps when no limit was configured; stale background refinement rejection. Active prompts already refresh via context_with_system and are reused. No new model worker, compulsory memory write, action quota reward, default game detector or summary call.

Seven focused Node checks passed (three new efficiency cases plus four existing native-context cases); extension import, Python compilation and diff checks passed. The first diagnostic command required transform-types for this repository's parameter-property syntax; one new diagnostic initially used a nonexistent history.latest attribute and was corrected to len(history). These are diagnostics, not autonomous efficiency evidence. The full suite and full five-category harness matrix are deliberately not run; full closure remains unverified.

The integrated pilot is exploratory, not a clean causal comparison of all changes. First use the same yibu/qwen3.8-27b/high and official ls20, query observations, text+image as the latest existing launch. Preserve all capabilities. Screening budget: 20 minutes, 200k reported total model tokens or 20 actions; stop on WIN, environment uncertainty/failure, deadline or user cancellation. These are bounded experiment limits, not new gameplay obligations. Pending/cancelled costs remain unknown where usage is unavailable. Initial target: useful experimentation below the historical 65–100k tokens/action range and reduced repeated retrieval; action count alone is insufficient. If the first completed decision exceeds the budget, stop that pilot and diagnose instead of starting another expensive decision.

Real-run artifacts: D:/autoresearch_pi_project/runs/arc-efficiency-20261014/. Every iteration freezes source hashes/configuration, stores original provider requests with secret redaction, and preserves canonical actions. Subsequent fixes change one observed main factor, with the experiment scope/deviation recorded here. Lower reasoning or a different model is a separate comparison, not silently attributed to the harness.

| Evidence | Status | Provider/environment | Boundary |
| --- | --- | --- | --- |
| Functional correctness | Unverified | Local WASI / deterministic host | Pending |
| Full ARC chain | Unverified | No real runner/provider started | Requires real bridge/Pi/action/subsequent-parent acceptance |
| Autonomous adoption | Unverified | No new ordinary run | Persistent data alone does not establish reuse |
| Net benefit | Unverified | No matched comparison | No promised reduction in reasoning or token cost |

## Delivery decision

Candidate only until verification is recorded. This changes one main factor: access to the existing action path from the default persisted computation workspace. Full within-decision reasoning replay, history summarization, output thresholds, model/provider, and reasoning effort remain comparison factors for later work, not silently bundled changes.

Related backlog: B/D evidence-to-action and cognitive continuity remain open. Next falsifiable question: does the ordinary parent now use one persisted program to execute a useful experiment and emit compact evidence, or does the same repeated analysis persist?
