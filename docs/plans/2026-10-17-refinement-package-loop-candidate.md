# The refinement package on the su15 loop's version (ARC_REFINE_MODEL, ARC_REFINE_CHARTER), and its test L1-R

Imported into `claude/r04-20261017` on 2026-10-17, as committed on `claude/refine-model-r03b-20261017` (`e1dd0a26`);
unchanged below. Superseded: the user held L1-R, then ruled out a refiner on another model inside runs (agent-native,
2026-10-17). The code stays on its branch, for offline replays only.

Date: 2026-10-17 (Asia/Shanghai). Status: implemented on `claude/refine-model-r03b-20261017` (worktree
`worktrees/refine-model-r03b-20261017`), cut from `claude/r03b-repeat-20261016` at `33f4c5bf`, the version the su15
level-2 loop runs ([loop plan](2026-10-17-su15-level2-loop.md)); default off; offline checks below. The test L1-R is
fixed below and not launched: it needs a budget decision. Follows [the development workflow](../development-workflow.md).

## Problem and claim

- **What the loop's L0 shows so far** (`runs/arc-l2-20261017`, read 2026-10-17 01:35–01:50; the runs were still going):
  - su15-l0-3 clicked 2–7 cells from an object 3 times on level 1 (#34), then won level 2 in 45 actions (baseline 42)
    and level 3 in 19: three levels by #98.
  - su15-l0-1 completed level 1 at #26 with every click on an object or next to one. On level 2 its first click 4–7
    cells from an object came at level action 4, and by #62 its memory held the mechanics (dots turn into blocks; a
    click within about 7 cells drags a block there). It then spent the level on the goal: 16 RESETs by #134, no step
    with a level-change prediction, and goal ideas tried as plans ("fill the blob", "move a block into the blob", "deeper
    into the blob", "a connected dot path"). Its refinements (qwen3.8-27b, the version's charter) rewrote the strategy
    seven times along the "move a block into the blob" line and never named a rival goal.
  - su15-l0-2 did not complete level 1 within its 110 actions (GAME_OVER at #45; 63 of its 64 clicks on an object).
- **Evidence for a lever.** In a blind-graded replay of su15's logged level-2 refinement inputs (2026-10-16, record
  `docs/plans/2026-10-16-refinement-ledger.md` on `claude/refiner-ledger-20261016`), gpt-6.1-sol proposed the test
  the runs were missing (a click's reach) in 6 of 48 refinements and qwen3.8-27b in 0 of 48, both with the charter of
  the r03b-simple line, which asks first for the untested rival of the current line of play and the cheapest action that
  separates them, and says that an experiment ending the attempt is never the cheapest. The loop's version has qwen
  refinements and an older charter that sends the strategy to a goal test whenever none has been made.
- **Claim (L1-R).** With refinements on gpt-6.1-sol under that charter, the version completes su15 level 2 within its
  budget in at least 2 of 3 runs (the loop's rung 1), where L0 does in at most 1 of 3.
- **Burden removed.** The diagnosis we make after a run (the untested rival belief about the goal or about what an
  action reaches) is proposed during the run by the refinement role.

## Change (default off: the loop's version unchanged)

| Item | Where | Default |
|---|---|---|
| `ARC_REFINE_MODEL=<id>`: refinements run on another model of the agent's provider. The runner lists it in `.pi-agent/models.json` beside the agent's model, text only, `"reasoning": false` (the qwen dialect's `enable_thinking` stays out of its calls, as in the replay); `run-config.json` records `refine_model`. A model the provider does not have fails the refinement before any call (`refiner.jsonl` `failed` with the reason). Ported from `claude/refiner-ledger-20261016` | `sideCall(…, { model })`, `runRefiner`, `_write_models_json` | unset: the agent's model |
| `ARC_REFINE_CHARTER=discriminate`: the r03b-simple line's charter, `REFINER_SYSTEM_DISCRIMINATE`, identical (4,386 characters) to the one su15-r9 logged and the replay sent | `demo/arc_thin_refiner.ts` | unset: `REFINER_SYSTEM` |
| Logging in every run: `refiner_inputs.jsonl` (model, system, input) and `refiner_replies.jsonl` (model, stop reason, text) per refinement; `model` on `usage.jsonl` rows and refinement `start` rows | `runRefiner`, `appendUsage`, `startRefiner` | always |

No game content in code, prompts or tests; the charter text is general (arguments, rivals, the cost of ending an
attempt). Nothing is added to the agent's context.

## Checks (`C:/Users/qi/tmp/merge-20261017/port-verify`)

- New `tests/arc_thin_refine_model.test.ts` (2): with `ARC_REFINE_MODEL=strong` and the charter option the refinement
  calls `strong`, its input carries the discriminating charter, and the start row, input, reply and usage rows name the
  model; unset, the agent's model and `REFINER_SYSTEM`; an absent model fails the refinement with no call.
- pytest: the models.json entry (`test_arc_thin_lifecycle_stats.py`).
- Smokes: `promotion` with the agent's model and with `refinemodel` (the scripted provider's second model); fork smoke
  parts 1–5; the refusal smoke's three parts; `activation`, `foundation`.

### Results of the checks

| Check | Result |
|---|---|
| Every `tests/arc_thin_*.test.ts` alone | 35 files, 171 tests, 166 pass. The 5 failures are the ones that fail on `r03b` and on `33f4c5bf` (activation "saved code acts in a closed loop", components "python session never stores runtime objects", receipts ×3); the loop session's run of `33f4c5bf` had 163 of 169, its sixth failure an action-surface timeout that passes here. `arc_thin_refine_model` 2/2 |
| pytest (lifecycle stats with the new models.json test, recovery, request accounting, foundation config, bridge deadline) | 30/30 |
| Refusal smoke | its three parts pass (collapse and recovery; every copy and a `provider_error` stop; defaults, the third identical call ends the decision) |
| Fork smoke | parts 1–5 pass |
| `promotion` / `promotion refinemodel` | 3 refinements each; their start rows, inputs, replies and usage name `scripted` / `scripted-refiner`, the agent's requests `scripted`; each then stops at the shared `system_chars <= 3000` check, as on `33f4c5bf` |
| `activation`, `foundation` | stop where they stop on `33f4c5bf` (activation at its check of reasoning kept within a decision, foundation at the shared `system_chars` check) |

Not checked here: a refinement on gpt-6.1-sol inside a real run. The same models.json entry, written by the same runner
code on `claude/refiner-ledger-20261016`, answered one real request through Pi on 2026-10-16
(`C:/Users/qi/tmp/refiner-ledger/pi-model-probe.json`).

## L1-R protocol (fixed before any run; not launched)

- **Arms.** A = L0 (su15-l0-1..3, this branch's base code `33f4c5bf`, which behaves as this branch with both options
  unset). B = three new full su15 runs on this branch's commit with `ARC_REFINE_MODEL=gpt-6.1-sol
  ARC_REFINE_CHARTER=discriminate`, launched together. Settings as L0: yibu / qwen3.8-27b, thinking off (Completions,
  qwen dialect), text+image, query observations, 300 s step timeout, no action cap beyond the game's per-level
  budgets, `SNAPLEVEL=1`.
- **Caps.** Each B run stops once level 2 is completed (`MAXLEVEL=2`) or at a level budget, with a 5.0M budget-token
  safety cap and no time cap.
- **Measures** (the same for A, counted to the end of level 2): level 1 and level 2 completed and their actions;
  GAME_OVERs per level; budget tokens to the end of level 2, refinements included; refinements (count, model, tokens,
  failures, kinds of edit); level-change predictions on level 2. Read blind afterwards, as in the replay: whether a
  refinement named a rival (a goal, or what an action reaches with other arguments) and its separating test, and whether
  the agent played a proposed test within 10 actions.
- **Claim holds if** B completes level 2 in at least 2 of 3 runs and A in at most 1 of 3. If A also completes it in 2
  of 3, B is kept only if it is no worse in levels and in actions per level, with fewer GAME_OVERs.
- **Negative cases.** No difference; or B's refinements name rivals and their tests but the agent does not play them
  within 10 actions (the break is the agent's use of refinements); or B's refinements reach the 10% share ceiling and
  are skipped (reported with the result).
- **Limits.** Three runs per arm separate only a large effect; runs on one commit spread widely (L0: 3, ≥1 and 0
  levels so far). B changes two things, model and charter, the configuration the replay supports (qwen with this
  charter: 0 of 48). A is not paired by prefix with B; L1-R measures whole runs, as rung 1 is stated.
- **Budget.** At most 15M budget tokens (3 × 5.0M); expected 7–12M (L0: su15-l0-1 1.75M by #104, su15-l0-3 2.27M for
  three levels, su15-l0-2 0.47M). 9.36M remain of F2's authorization (2026-10-16, ≤11.0M, for refinements on
  gpt-6.1-sol against qwen; 1,637,238 spent on three disqualified sources), enough for two runs.
- **F2b, prepared earlier the same night and dropped before launch.** It forked su15-l0-1's level-1 snapshot (it meets
  F2's source rule) with 100-action windows and measured the first click 4–7 cells from an object. su15-l0-1's own level
  2 made that click at level action 4, so the measure could not separate arms there, and a 100-action window cannot
  measure level 2's completion; forks over level 2's whole budget cost more than whole runs (about 4M each).
- **Relation to the loop.** L1-R would be the loop's "one general change" for L1 if the loop adopts it; it reads none
  of L0's files and writes to `runs/arc-l1r-20261017`.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional correctness | Passed | local Node, real WASI guest; pytest | `port-verify/suite`, `pytest.txt` |
| Full-chain reachability | Passed offline for both options | mock ARC SDK, production bridge, installed Pi 0.87.0, scripted provider with a second model | `port-verify/smokes`; gpt-6.1-sol inside a real run not yet |
| Autonomous adoption | Unverified | — | L1-R reads whether the agent plays what the refinements propose |
| Net benefit | Unverified | — | L1-R; the replay (6/48 against 0/48) measured proposals, not play |

## Delivery decision

- Kept on `claude/refine-model-r03b-20261017`, both options off by default, so the branch plays as the loop's version.
- Held (2026-10-17, the user's decision): L1-R is not launched from this session; the su15 loop's session picks its own
  next change. The protocol and launchers (`C:/Users/qi/tmp/merge-20261017/l1r/`) stay available to it.
