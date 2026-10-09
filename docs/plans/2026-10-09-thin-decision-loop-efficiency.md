# Meta-harness change record: decision-loop efficiency and robustness on the thin path

Date: 2026-10-09 (Asia/Shanghai). Status: **implemented; real-provider evaluation not run** (a paid run needs a budget from the user).
Follows [development-workflow.md](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). Thin path design: [2026-10-08-thin-arc-self-harness-extension.md](2026-10-08-thin-arc-self-harness-extension.md).

## Problem and claim

Scope of the review: every real thin-path run on disk, 12 runs and 756 actions, all yibu / qwen3.8-27b:
- `pi-arc-thin-ls20-treatment`
- `pi-arc-thin-ls20-treatment-p1-real-20261008`
- `pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009`
- `pi-arc-thin-ls20-board-real{,-r2}-20261009`
- `thin-hyp-{ls20-A,B,C,C2,ft09-A,B,C}-*-20261009`

The question was which weaknesses of the framework (not of one game) the logs show. All findings below are counted over all 12 runs. None depends on game content.

Audit scripts and outputs:
- [tmp/thin_mechanism_audit.mjs](../../tmp/thin_mechanism_audit.mjs) → [tmp/thin_mechanism_audit.json](../../tmp/thin_mechanism_audit.json)
- [tmp/thin_turn_cost.mjs](../../tmp/thin_turn_cost.mjs) → [tmp/thin_turn_cost.json](../../tmp/thin_turn_cost.json)
- [tmp/replay_refused_memory.ts](../../tmp/replay_refused_memory.ts) → [tmp/replay_refused_memory.json](../../tmp/replay_refused_memory.json) and [tmp/replay_refused_memory_norepair.json](../../tmp/replay_refused_memory_norepair.json)

### Observed weaknesses

**W1. An environment failure is retried by the model until the decision times out.**
- 4 of 12 runs ended this way: ft09-A, ls20 board, ls20 board-r2, and the 319-action run (`bridge_close_error: timed out` in each summary). ls20 C also ended in `decision_timeout`, but from a Pi RPC timeout, not the environment.
- The remote SDK stopped returning frames (`EnvironmentReturnedNoFrame`, HTTP 502) or the bridge timed out.
- `arc_action` failed with a non-terminating refusal, so the model called it again in the same decision: 4–12 failed calls per run, each a full model turn plus up to 120 s.
- The run stopped only at the 900 s decision timeout, and `stop_reason` read `decision_timeout`, hiding the cause.
- `actions_on_bridge` equals the trajectory length in all 12 runs, so no unrecorded action was applied.

**W2. The tool boundary rejects recoverable argument slips.**
- 48 memory calls in the 12 runs were refused because of their arguments. Gate refusals such as call limits were excluded.
- Common slips:
  - evidence sent as a list (the schema wants one object);
  - text over a length limit;
  - a `hyp.` key sent through `set`;
  - an `op` the schema does not know (`get`, `update` with a key).
- Each refusal costs a full model round trip with the whole context re-read: 15–50k input tokens in these runs.

**W3. Bookkeeping is paid for in round trips.**
- The agent usually writes memory in its own message and acts in the next. Every extra message re-reads the whole context (system prompt, schema, working set, grid).
- Messages whose only tool calls were memory writes carried 19–44% of all agent tokens per run (median ≈ 34%). Examples: ls20 A 42%, ls20 B 42%, ft09-B 44%, the 319-action run 20%.
- The model can batch: 71 messages across 11 runs already put `memory` and `arc_action` together. But the runtime then drops the write's receipt or refusal: the decision ends, and the next decision's context is rebuilt without it. A failed batched write is invisible.
- The prompt also encouraged the sequential pattern ("call … any number of times, then end the decision with exactly one arc_action").

### Also observed, not addressed here (kept separate for attribution)

- **W4. Repeated `run_skill` calls.** 183 calls in the 319-action run took 17% of agent tokens. Only 26% of them passed no arguments, so auto-running skills would help only partly.
- **W5. Consolidation turns are costly.** Non-action decision tokens were 13% of the 319-action run and 37% of board-r2. Their benefit is unmeasured.
- **W6. Heavy reasoning per decision.** ft09 used a median of 7–14k output tokens per decision, 89–93% of it reasoning. The working set is rebuilt each decision, and only memory and notes carry conclusions forward.
- **W7. Moved shapes are summarised as colour counts.** Changes larger than 16 cells are given as a bbox and a colour histogram, so a moved shape reads as recolouring. This is an adapter representation issue, deferred item A.

### Claim and burden

**Narrow claim.** With W1–W3 removed, an ordinary qwen3.8-27b run on any thin-path game will:
- (a) stop within two decisions of a persistent environment failure, labelled `environment_error`, with no model retries inside a decision;
- (b) lose fewer memory calls at the boundary: in the offline replay, refusals avoided on the same calls rise from 11/48 to 42/48;
- (c) spend fewer model messages per action decision, with fewer tokens after the first message, at no cost to task progress.

**Burden removed.**
- Wasted model turns and wall time on a dead environment.
- A round trip per format slip.
- A round trip per bookkeeping write.
- Lost receipts for batched writes.

**Falsified if** (real runs):
- an environment failure still produces more than one model request inside a decision;
- memory refusals from argument shape do not fall;
- messages per action decision and `tokens_after_first_message_pct` do not fall;
- batched writes fail silently (a FAILED line never reaches the next decision);
- levels per action fall beyond noise.

**Scope.** Thin path only. Game-agnostic: no game names, colours, coordinates or object roles appear in the code, prompt or tests of this change. The unit tests use generic keys; the smoke uses the mock SDK.

## Design and cost

| Weakness | Change | Who advances it | Resident cost |
| --- | --- | --- | --- |
| W1 | `bridgeCall` keeps the HTTP status. `isEnvironmentFailure` (new [demo/arc_thin_boundary.ts](../../demo/arc_thin_boundary.ts)) classifies timeouts, aborts, connection errors and 5xx as environment failures; 4xx (an action that is not available, bad coordinates) stays the agent's to fix. `arc_action` then logs `errors.jsonl {environment: true}` and returns a terminating refusal: the decision ends. The runner stops with `environment_error` after `max_environment_failures` (2) consecutive decisions that failed this way without an action. | Runtime (mechanical) | none |
| W2 | `prepareArguments` repair before Pi's schema validation (confirmed order in `pi-agent-core` `prepareToolCall`: `prepareArguments` → `validateToolArguments`). Memory: JSON-string repair (existing) and op aliases (`get`/`read`→`list`, `add`/`put`/`save`→`set`, `remove`→`delete`; an unknown op is dropped and inferred). A `hyp.`/`strat.` key sent through `set`, or as key+text, is routed to hypotheses or strategies. An evidence list becomes one entry per result. Over-long strings are clipped to the documented limit. Skill: a missing or unknown `op` is inferred (`source` present → `set`, else `get`). `arc_action`: an over-long `note` is clipped instead of refusing the action. Repairs never invent content. | Runtime (mechanical) | none (schemas unchanged) |
| W3 | Results of tools that share the message with `arc_action` are kept and shown once at the next decision under "RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION", with failures marked FAILED. The prompt and the `arc_action` description say: use a separate message only when you need a tool's answer before acting (run_skill, ask_analyst); put updates in the same message as `arc_action`. `batch_results.jsonl` and `summary.json` `harness.decision_loop` measure it. | Agent chooses to batch; runtime carries results | system prompt +~280 chars; `arc_action` description +~150 chars; one working-set section only after a batched decision (≤400 chars per result) |

**Permission and integrity are unchanged.**
- One `arc_action` per decision and the tool-call caps still apply.
- The memory store is still atomic per call: a repaired call is still validated by Pi's schema and by `planMemoryUpdate`.
- Unrepairable calls still fail with the same messages: a set with no text, evidence with no condition, a non-existent action number, memory full.

**Removed.** The sequential "call any number of times, then act" guidance.

**Not added.** No tools, workers, model calls, gates, reminders or schema fields.

**Concurrency note.** Another session ("ARC agent performance analysis") edited `demo/arc_thin_memory.ts`, its tests, `arc_thin_e2e.py` and the lifecycle record during this change: review fixes for dropped notes, `MAX_HYPOTHESES = 8`, and contested-outcome metrics. All new logic here is in a separate module, and the memory module is used only through its exported functions. Both sets of edits were merged into one tree, tested together and committed together (see Merge below).

**Abandon/restore.**
- Each part can be reverted on its own: the boundary module hook-ups, the carried-results section with its prompt lines, and the environment classification with the runner stop.
- No stored data format changed. The only additions are new files (`batch_results.jsonl`) and new error-row fields.

## Pre-run experiment protocol (not executed)

- **Target layers:** autonomous adoption (does qwen batch updates with the action when told to?) and cost. Task effect is a guard metric, not the claim.
- **Comparator:** the commit before this change vs. this change, everything else equal, frozen commits. Record `run-config.json` `source_sha256`.
- **Games.** At least one game not used in any earlier diagnosis (held-out), plus ls20/ft09 reported as in-sample. Under the [generality rubric](2026-10-09-ledger-critic-general-signals.md) G5, a held-out result decides.
- **Model and budget:** yibu / qwen3.8-27b, provider-default thinking, 100 actions per arm, a token cap set with the user, the experiment timeout. Exploratory: one run per arm per game; confirmation needs ≥3.
- **Primary metrics** (all in `summary.json`):
  - `harness.decision_loop.messages_per_action_decision`
  - `harness.decision_loop.tokens_after_first_message_pct`
  - reported tokens per action
  - memory/skill argument refusals by cause (`harness.tool_errors` plus the replay script)
  - `batched_tool_results`, `batched_tool_failures`
  - `stop_reason` and `environment_errors`
- **Guard metrics:** levels, actions per level, the share of decisions where the batched write was later contradicted by the action's result (hand audit of 20 samples).
- **Negative cases:**
  - Batching too much: writes made before seeing the action's result could record predictions as facts. Audit batched writes for statements about the action they accompany.
  - A transient environment error now costs the decision instead of being retried. Watch for `environment_error` stops where the environment recovers.
  - A repair changes the meaning, e.g. a clipped claim loses its key part. Audit every clipped write in a run.
  - The model stops making necessary separate calls (run_skill before acting).

## Implementation and verification

**Entry points.**
- [demo/arc_thin_boundary.ts](../../demo/arc_thin_boundary.ts) (new).
- [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts): `bridgeCall` status, `arc_action` environment path and `prepareArguments`, memory/skill `prepareArguments`, carried results in `guardTool` and the working set, `batch_results.jsonl`.
- [demo/prompts/arc_thin_system.md](../../demo/prompts/arc_thin_system.md).
- [src/autoresearch_pi/arc_thin_e2e.py](../../src/autoresearch_pi/arc_thin_e2e.py): `environment_error` stop, `_environment_errors`, `harness.decision_loop`, `environment_errors`, new smoke checks, environment scenario.
- [src/autoresearch_pi/cli.py](../../src/autoresearch_pi/cli.py): `arc-thin-smoke --environment`.
- [tools/arc_thin_smoke_provider.ts](../../tools/arc_thin_smoke_provider.ts): repaired-shape calls, a batched decision, the environment script.
- [tools/mock_arc_sdk/arc_agi.py](../../tools/mock_arc_sdk/arc_agi.py): `MOCK_ARC_FAIL_AFTER`.

**Functional checks.**
- `node --experimental-transform-types --test tests/arc_thin_boundary.test.ts tests/arc_thin_memory.test.ts tests/arc_thin_feedback.test.ts tests/arc_thin_ledger.test.ts`: 32/32 pass.
- The 6 boundary tests cover each repair, the unrepairable cases, and environment-vs-agent error classification by HTTP status.

**Offline replay of real refusals** ([script](../../tmp/replay_refused_memory.ts)). Each refused memory call from the 12 runs was replayed against the memory state rebuilt up to that call, with Pi's rejected shapes checked by hand-written rules:

| Refused calls | Succeed with current code, no repair | Succeed with the repair |
| --- | --- | --- |
| 48 (30 schema, 17 store, 1 other) | 11 | 42 |

- The 11 without repair come from earlier changes: `op` became optional, and the hypothesis cap rose to 8 (another session).
- The 6 that still fail are legitimate refusals: a set with no text (2), evidence with no condition (2), action #0 (1), memory full (1).
- This is diagnostic: it shows the calls would pass, not that the model's next steps would be better.

**Real-chain smoke** (mock ARC SDK, real bridge, Pi, extension and sandbox, scripted provider):
- [arc-thin-decision-loop-smoke-20261009](../../runs/arc-thin-decision-loop-smoke-20261009/summary.json): passed, all checks. New checks:
  - `boundary_repairs_pass_schema`: a skill save without `op` and evidence as a list reach the store, with no schema refusal;
  - `batched_results_carried_once`: decision 3 sends a strategy write, a `hyp.` key through `set` with 600+ chars (routed and clipped), an invalid test and `arc_action` in one message. Decision 4's provider input shows the results, with the failure marked FAILED. The decision before shows none;
  - `decision_loop_in_summary`: 3 batched results, 1 failure.
- [arc-thin-environment-failure-smoke-20261009](../../runs/arc-thin-environment-failure-smoke-20261009/summary.json): passed, 5/5. `MOCK_ARC_FAIL_AFTER=1` makes the bridge raise the real `EnvironmentReturnedNoFrame` (HTTP 502). Each failed decision had exactly one model request; the spare scripted step was never requested; the run stopped as `environment_error` after 2 decisions with 2 environment rows and no fatal error. A memory update batched with the failed action was shown at the next decision.

**Regressions.**
- Ledger/critic smoke [arc-thin-decision-loop-ledger-smoke-20261009](../../runs/arc-thin-decision-loop-ledger-smoke-20261009/summary.json): passed.
- `pytest tests/test_cli.py tests/test_external_benchmark_cli.py`: 13 passed.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Pass | node unit tests; offline replay of 48 real refused calls | Replay uses hand-written stand-ins for Pi's schema checks |
| Full-chain reachability | Pass (thin path) | Scripted provider, mock ARC SDK, real bridge / Pi / extension / sandbox | Two smokes above. Environment failure simulated by the mock returning no frame, not by a real remote outage |
| Autonomous adoption | Unverified | — | Whether qwen batches updates with the action is the main open question |
| Net benefit | Unverified | — | Needs the protocol above, with a held-out game |

## Merge with the concurrent session (2026-10-09)

Two sessions edited the thin path at the same time in one working tree. There were no textual conflicts. Reconciled:
- **Code:** the other session's memory review fixes (dropped notes from the last 3 deleting actions, `MAX_HYPOTHESES = 8`, contested-outcome metrics, the G1 fix to the `idea` example) and this change (boundary repair, carried batch results, environment stop) touch different functions. The decision-loop smoke ran after the other session's last edit and covers both.
- **Docs:**
  - The lifecycle record's table and cost section described the superseded "last 3 dropped notes" rule; now corrected.
  - Its delivery decision named a 150-action ls20 run while its own review said not to spend the next paid run on it. It now defers to the single "Next steps" list above.
  - Its protocol is marked in-sample for ls20/ft09, with a held-out game deciding.
- **Combined checks:**
  - node 47/47 (boundary, memory, feedback, ledger, skill surface, board, frame image);
  - pytest 16 passed (lifecycle stats, task-python server, CLI, external-benchmark CLI);
  - smokes run on the combined tree: [decision loop](../../runs/arc-thin-decision-loop-smoke-20261009/summary.json), [environment failure](../../runs/arc-thin-environment-failure-smoke-20261009/summary.json), [ledger/critic](../../runs/arc-thin-decision-loop-ledger-smoke-20261009/summary.json), all passed.

## Delivery decision

- **Supported:**
  - environment failures end the decision and the run without model retries;
  - recoverable argument slips no longer cost a round trip;
  - results of batched tools reach the next decision, failures included;
  - the measurements needed to evaluate this exist in `summary.json`.
- **Not supported:**
  - that qwen will batch updates with its action;
  - any change in tokens per action or in task progress.
- **Decision:** keep. W1 and W2 are robustness fixes with no resident cost. W3 is experimental until the protocol runs.
- **Next steps for the thin path.** This is the single ordered list; the [hypothesis-strategy lifecycle record](2026-10-09-thin-hypothesis-strategy-lifecycle.md) defers to it. Each step changes one factor; paid runs need a budget from the user.
  1. **Adoption probe (paid, exploratory, unpaired).** The current tree on one held-out game and on ls20 (in-sample), 100 actions each. It answers questions that need no comparator:
     - Does qwen batch updates with the action?
     - Do repaired calls replace refusals?
     - Does an environment failure stop cleanly?
     - Are the lifecycle fields (`question`, `tests`, `strategies`) used at all?
     All of these are read from `summary.json` (`decision_loop`, `lifecycle`, `tool_errors`, `stop_reason`).
  2. **W7, observation representation (implementation, then a paired run).** Report a moved shape as a displacement instead of a colour histogram. Both reviews (this record and the lifecycle review) name it as the largest suspected effect on task quality. Paired against the tree from step 1, on held-out games.
  3. **The lifecycle record's own paired protocol**, only if step 1 shows the fields are used and step 2 makes evidence readings reliable.
  4. **W4 and W5** (auto-run observer skills; consolidation cadence), one at a time.
- **Backlog:** [deferred-research-todos.md](../deferred-research-todos.md) A (adapter boundary: the environment-error classification is a bridge-contract concern) and D (context rebuild: W6 is a continuity cost). The status of both is unchanged.
