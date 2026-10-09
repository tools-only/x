# Meta-harness change record: thin-harness memory keeps competing hypotheses with condition-scoped evidence

Date: 2026-10-09 (Asia/Shanghai). Status: **implemented; real-provider evaluation not run** (paid run needs a budget from the user).
Follows [development-workflow.md](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). Runtime design of the thin path: [2026-10-08-thin-arc-self-harness-extension.md](2026-10-08-thin-arc-self-harness-extension.md).

## Problem and claim

- **Real failure and material.** Run [pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/summary.json): yibu / qwen3.8-27b, official ARC SDK online, 319 actions, 0/7 levels, 7.78 M reported tokens, 13 consolidations. Diagnosis: [level0-diagnosis.md](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/level0-diagnosis.md) (supplement section) and [reflection-audit.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/reflection-audit.json).
  - Observed: the agent did reflect and propose alternatives (#45, #50/#75, #132, #224, #310; analyst listed hypotheses A–E). What failed was keeping alternatives in competition and carrying counterevidence forward. All 116 actions #16–#131 were ACTION1/ACTION2.
  - Observed: the #157 top-box failure was saved as conf-5 "cannot enter the top box" without the test condition (pattern did not match). At #132 horizontal actions were described as never tested, though #3/#4 tested them.
  - Observed: memory was used as a per-step scratchpad: 284 writes, 92 deletes; keys `current_state` ×~40, `state_168…state_232`, `plan_v4_progress` ×9, `v6_progress_268…281`. Memory reached its 40-entry cap.
  - Observed: 114 of 130 tool errors were rejected memory calls; **106 of those were tool-call limits** hit while deleting stale entries one per call (e.g. #178 tried 25 deletes in one decision). At #257 and #282 `strategy_192` could not be deleted and survived to the end; the #307 consolidation text claimed deletions the store did not contain. Others: 3 missing `op`, 4 texts over 600 chars, 1 memory-full.
  - Not established: the relative causal contribution of weak experiment selection vs. lost conditional counterevidence vs. revision friction.
- **Narrow claim.** If memory holds a few hypotheses as records (claim, prediction, appended test results each with the condition they were tested under, status, next distinguishing test) and one memory call can clean up and revise atomically, then in an ordinary qwen3.8-27b ls20 run (a) refutations keep their condition across decisions, (b) memory corrections stop failing at the tool boundary, and (c) action allocation spreads across more hypotheses than in the baseline.
- **Burden removed.** One call replaces N per-key deletes (cleanup no longer competes with the 12/16 tool-call caps). Conditions no longer need to be re-derived from free text. The receipt lists exactly what changed, so a summary cannot silently disagree with the store.
- **Falsified if** (on the bounded protocol below): the model writes no hypotheses in 150 actions; memory tool-limit refusals do not drop; refuted hypotheses are re-tested under the same recorded condition as often as before; or reported tokens per decision rise by more than 25% with no change in (a)–(c).
- **Scope.** Thin path only (`demo/arc_thin_extension.ts`); the legacy extension and the evidence board are unchanged. This change does not add per-action reflection, workers, or action gates.

## Design and cost

- **Choice.** Reuse the existing `memory` tool and `memory.jsonl` store, not a new tool or worker. Pure logic in [arc_thin_memory.ts](../../demo/arc_thin_memory.ts); the extension persists rows and renders.
- **Interface** (one call = one atomic batch; nothing applied if any part is invalid):
  - `set=[{key, text, confidence?}]` upserts facts.
  - `delete=[key | "prefix*"]` removes facts or hypotheses; a missing key is reported, not an error.
  - `hypotheses=[{key: "hyp.<name>", claim?, predicts?, status?: open|supported|rejected, next_test?, evidence?: {action?, condition, observed, verdict: supports|refutes|inconclusive}}]` creates or updates hypotheses. Evidence is appended, never overwritten.
  - The legacy single form (`op="set"|"delete"|"list"`, `key`, `text`) still works; `op` is now optional and inferred.
  - `prepareArguments` repairs JSON-string arrays/objects and a scalar `delete`.
- **Integrity checks (data, not action gates):**
  - `status: "rejected"` requires at least one `refutes` result, which carries a non-empty `condition`. This targets the #157 failure.
  - `evidence.action` must be an existing action number.
  - Caps: 40 facts, 6 hypotheses, 6 results per hypothesis (refutations are dropped last).
- **Working set.** A new `HYPOTHESES` section is rendered before `MEMORY`. Each entry shows its status, claim, prediction, each result as `#n verdict when "condition": observed`, and a mechanical `last tested: #n (k actions ago) · next test: …`. The "k actions ago" makes a neglected competitor visible without a reminder.
- **Prompts.**
  - System prompt: the decision paragraph now lists hypotheses, and a new "Hypotheses and memory" block (≈11 lines) says to keep 2–4 competitors with distinguishing next tests, append results with conditions, and not save per-step state (RECENT ACTIONS already records it).
  - The consolidation prompt asks for one memory call with the same content. No new consolidation turns were added.
- **Added/removed resident cost.**
  - Added: the system-prompt block, the memory schema (larger: nested arrays), and the HYPOTHESES section (one line when empty; worst case about 6 × 2 k chars).
  - Removed: the per-key delete round trips and the per-step entries the model was persisting.
  - Not measured yet.
- **Unchanged.** Tool-call caps (12/16), `arc_action` boundary, skill sandbox, board, control variant.
- **Who advances each transition.**
  - The model owns all semantic decisions: proposing, testing, recording, rejecting.
  - The runtime only validates, persists, computes "last tested", and returns exact receipts.
  - The runtime never infers a refutation from game state.
- **Abandon/restore.** Old `memory.jsonl` rows replay as facts. Reverting the extension makes stored hypothesis rows invisible but harmless.

## Pre-run experiment protocol (not executed)

- **Target layer:** autonomous adoption, plus an exploratory signal on task effect.
- **Variable and comparator:** this change vs. the 2026-10-09 HEAD `69607a25` memory tool, everything else equal. Run both arms fresh. The 319-action run is only historical context: its code differs, and four source files had drifted at launch.
- **Concurrent-edit confound:** other sessions were editing the same extension and system prompt on 2026-10-09 (e.g. `run_skill` exposure after a skill is saved). Freeze one commit per arm and record the source hash at launch.
- **Model and task:** yibu / qwen3.8-27b, provider-default thinking, ls20, treatment variant, `--consolidate-after 25`, no board.
- **Budget:** 150 actions per arm (`--max-actions 150`), a reported-token cap agreed with the user, and the experiment timeout. One run per arm is exploratory; claims need repeats.
- **Primary metrics:**
  1. Memory tool refusals by cause (tool-limit, validation) from `summary.harness.tool_errors` and `pi-events.jsonl`.
  2. Hypothesis writes; results with conditions; rejected hypotheses that keep a `refutes` condition.
  3. Re-tests of a refuted claim under the same condition; statements contradicted by the trajectory (e.g. "never tested").
  4. Action allocation: longest run of actions serving one hypothesis family, and number of distinct hypotheses tested per 25 actions (audited from `note` and evidence).
  5. Levels, actions, reported tokens per decision.
- **Negative cases:** the model ignores hypotheses (legacy facts only); a hypothesis record with a wrong condition (the record is only as good as the model's judgement; audit samples by hand); oversized HYPOTHESES sections.

## Implementation and verification

- **Entry points:**
  - [demo/arc_thin_memory.ts](../../demo/arc_thin_memory.ts) (new)
  - [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts): memory tool, replay, working set, skill `state.hypotheses`
  - [demo/prompts/arc_thin_system.md](../../demo/prompts/arc_thin_system.md)
  - [src/autoresearch_pi/arc_thin_e2e.py](../../src/autoresearch_pi/arc_thin_e2e.py): consolidation prompt; `harness.hypotheses`, `memory_deletes` and `tool_errors` in `summary.json`; 4 new smoke checks
  - [tools/arc_thin_smoke_provider.ts](../../tools/arc_thin_smoke_provider.ts): scripted calls
- **Functional checks:**
  - `node --experimental-transform-types --test tests/arc_thin_memory.test.ts tests/arc_thin_feedback.test.ts tests/pi_arc_frame_image.test.ts`: 13/13 pass.
  - The 7 new tests cover: legacy replay; prefix cleanup of 40 `state_*` entries in one call; an atomic refusal; a #157-style rejection without a condition being refused; evidence order and caps; key separation; argument repair.
  - `pytest tests/test_cli.py tests/test_external_benchmark_cli.py`: 13 passed.
- **Real-chain smoke** (mock ARC SDK, real bridge, real Pi, real extension, scripted provider):
  - [arc-thin-hypothesis-memory-smoke-20261009-b](../../runs/arc-thin-hypothesis-memory-smoke-20261009-b/summary.json): 18/18 checks pass. New checks:
    - a batch without `op` where `set` is sent as a JSON string;
    - an atomic refusal, after which `atomic_probe` is absent from the store;
    - a single consolidation call that deletes `state_*`, appends a supporting result and rejects a rival with its refutation;
    - the next decision's provider input shows both hypotheses with `#2 supports when "after ACTION1"`, `#1 refutes when "first action of the game"` and `last tested: #2 (0 actions ago) · next test: ACTION3`, and no `state_*` entries.
  - Board scenario regression: [arc-thin-hypothesis-memory-board-smoke-20261009](../../runs/arc-thin-hypothesis-memory-board-smoke-20261009/summary.json) passes.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Pass | node unit tests; no provider | `tests/arc_thin_memory.test.ts`; covers validation, atomicity, replay, rendering |
| Full-chain reachability | Pass (thin path) | Scripted provider, mock ARC SDK, real bridge / Pi / extension | Smoke runs above. Not the five-component `arc-harness-smoke` closure matrix, which targets the legacy path. |
| Autonomous adoption | Unverified | — | Needs the bounded qwen run above |
| Net benefit | Unverified | — | Needs paired, repeated runs |

## Delivery decision

- **Supported:** the interface, its integrity checks, and delivery of scoped evidence into the next decision's provider input.
- **Not supported:** that qwen3.8-27b will keep competing hypotheses, record correct conditions, or allocate experiments differently; any task benefit.
- **Decision:** keep as experimental on the thin path. Next falsifiable check: the 150-action paired protocol above, once the user sets a budget.
- **Next candidate factor (not implemented, kept separate for attribution):** a mechanical per-action usage line in the working set (count, last use and changed-cell range for each action). It targets the "#132 claimed horizontal actions were never tested" continuity error and the 116-action ACTION1/ACTION2 streak without relying on the model's memory.
- **Backlog:** relates to [deferred-research-todos.md](../deferred-research-todos.md) §D (preserving key hypotheses, excluded explanations and unfinished experiments across context rebuilds). Status unchanged: this provides a carrier, not evidence of continuity.
- **Follow-up (same day):** rival grouping, joint tests, `contested`, dropped-alternative notes and strategies with premises built on this store: [thin-hypothesis-strategy-lifecycle](2026-10-09-thin-hypothesis-strategy-lifecycle.md). Its status vocabulary adds `contested`, and the `plan`-fact advice in the system prompt was replaced by strategies.
