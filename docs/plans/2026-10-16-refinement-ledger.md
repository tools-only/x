# Refinement ledger, and a replay of who can diagnose online

Imported into `claude/r04-20261017` on 2026-10-17, as committed on `claude/refiner-ledger-20261016` (`693272bc`), when
the session that wrote it was folded into the r04 line; unchanged below. Links to the r03b-simple line's records resolve
on `claude/r03b-simple-20261015`. r04 took the ledger, EXPECT and the strict expectation checks (`fe9dccd6`,
`009b670c`; [r04 plan](2026-10-17-r04-version-plan.md) item 6), not `ARC_REFINE_MODEL`. F2 is not continued: it tested a
refiner on gpt-6.1-sol, which the user ruled out inside runs (agent-native, 2026-10-17).

Date: 2026-10-16 (Asia/Shanghai), updated 2026-10-17. Status: implemented and committed on
`claude/refiner-ledger-20261016` (worktree `worktrees/refiner-ledger-20261016`, cut from `1d60dcf1`, the tip of
`claude/r03b-simple-20261015`); unit tests and deterministic smokes; the refinement replay (real provider, logged inputs,
no ARC actions) done; the refinement model option (`ARC_REFINE_MODEL`) built and checked against the real gateway with
one request. F2 not run: none of three source attempts qualified (1,637,238 of its 11.0M budget tokens spent). The
attempts ran the ledger in real su15 play; two defects found there are fixed (see
[F2 outcome](#f2-outcome-and-what-the-source-runs-showed-2026-10-17)).

Change record per [the development workflow](../development-workflow.md). It follows the user's question of 2026-10-16:
can the loop we run after each ARC run (read the logs, find what the agent got wrong, locate the cause, change the
harness) be internalized as an agent-driven mechanism in r03b, for online correction? The answer given then: the
scheduled refiner ([2026-10-15 plan](2026-10-15-r03b-simple-context-plan.md)) is already the online corrector; it lacks
three steps of our loop: measuring with code, feedback on its own edits, and a correct diagnosis. This record covers the
replay that tested the diagnosis step (and measurement), and the first build: the feedback step.

## Problem and claim

- **Observed.**
  - Refinement edits are never checked. In su15-r2 the refiner rewrote the strategy to "complete row 63" at #152 and
    #165, and the agent filled the row twice into GAME_OVER (#207, #240); no later refinement was told.
  - The scheduled refiner is the only online corrector that works: no real run has an agent-called refinement (0 of 121
    refinement starts in su15 r2–r9), and su15-r9's workspace holds no agent-written tool, skill or `prompts/refine.md`.
  - Diagnosis: of 98 refinements in su15 r3–r9, one proposed a click-distance test, on level 1
    ([failure analysis](../reports/2026-10-16-su15-r3-r9-failure-analysis.md)). su15-r9's level-2 refinements at #30–#120
    had "4-7 away 0" in their input (the r9 facts line) and none proposed such a click.
  - The refinement form the user chose on 2026-10-14 included "a small durable record it reads on each wake: its past
    edits and whether the agent used them". r03b does not have it.
- **Claims.**
  - R1 (replay, diagnostic): on su15's logged level-2 refinement inputs, which refiner finds the missing test — the run's
    model, the same with one measurement round, a stronger model, the stronger model with measurement.
  - L1 (ledger, to be tested on forks): with the ledger, refinements revise or replace edits the agent did not use or
    whose expectation failed, instead of adding unrelated edits, at no more than 15% more refinement tokens; levels and
    actions per level no worse.
- **Burden removed.** Finding out, after the run, that an edit was ignored or harmful (our post-run work) moves into the
  run: the refiner is told. Nothing is added to the agent's context.
- **Overturned by (L1).** Forks in which refinements do not react to failed expectations or unused edits, or in which
  the ledger raises refinement cost without changing the edits.

## R1: the refinement replay

Protocol fixed before any call: `C:/Users/qi/tmp/refiner-ledger/replay-protocol.md`. Script
`C:/Users/qi/tmp/refiner-ledger/replay_diag.py`; measurement host `measure.ts` (the project's WASI skill guest,
`mode: exec`, read-only `history`, `record`, `memory_log`, `refinements`); results `.../replay/results.jsonl`.

- **Inputs** (fixed rule): logged level-2 refinement inputs taken before the run's first click 4–7 cells from an object
  on level 2: su15-r9 #30, #46, #60, #76, #92, #109, #120, #135; su15-r8b #76, #141, #195, #255. Two samples each.
- **Arms.** A qwen3.8-27b, `enable_thinking=false` (as the runs); B as A plus one optional measurement round (one clause
  added to the logged charter; it names no game content and no kind of measurement); C gpt-6.1-sol, gateway default
  reasoning; D as C plus measurement. yibu gateway, Completions route.
- **Measure.** R: the edit proposes a click at a stated distance of 2+ cells from a block it means to move or test,
  clicks at different distances compared, or a claim or rival about how far from a block a click still moves it.
  S1: the edit's next experiment deliberately runs out the attempt. Graded on a sheet of 96 edits under random ids
  (`grading/sheet.txt`, `grades.json`) before unblinding (`key.json`, `tally.py` → `grading/tally.txt`).

| Arm | R | Inputs with R | S1 | Invalid replies | Measured (code ran) | Budget tokens per sample | Median seconds per call |
|---|---|---|---|---|---|---|---|
| A qwen, as run | 0/24 | — | 2 (+2 as a fallback) | 2 | — | 6,107 | 26.9 |
| B qwen + measurement | 0/24 | — | 1 | 2 | 20 (19) | 8,979 | 14.3 (2 calls) |
| C gpt-6.1-sol | **4/24** | 4 | 0 | 0 | — | 6,165 | 30.7 |
| D gpt-6.1-sol + measurement | 2/24 | 2 | 0 | 1 | 3 (2) | 6,520 | 32.8 |

- **Decision by the predefined rule** (an arm finds it with R in at least 4 of 24 samples on at least 2 inputs): only C
  does. Rule outcome: the refiner role needs a stronger model; measurement is not the lever. Pooled, gpt-6.1-sol 6/48
  against qwen 0/48 (Fisher two-sided p ≈ 0.026).
- **The R edits.** "How far from a block may the destination click be? … click (40,35) … if not, test shorter off-block
  distances" (C, r9 #120); "an unrestricted nearest-block teleport, rather than a local slide? … (6,11) … test a shorter
  displacement next" (C, r9 #135); "(24,34), a currently blank location away from the existing blocks", ~7 cells (C, r8b
  #76); an adjacent click, then "a farther background destination to determine whether movement can jump" (C, r9 #109);
  "empty background 4–12 cells from the nearest movable block steers that block" (D, r8b #141); the next trail point
  (+2,−2) from a block (D, r9 #135; meets the letter of R, not its intent). The stronger model also proposed an
  off-object click next to a block in 9 samples (qwen: 1).
- **Measurement did not help the run's model.** B measured in 20 of 24 samples, and its code listed block positions, row
  63's fill and grid dumps: the state the input already described, never click distances. D measured in 3 of 24.
- **Attempt-ending proposals.** qwen proposed filling row 63 as a goal test in 3 samples (A 2, B 1; GAME_OVER in su15),
  against the charter's sentence that such an experiment is never the cheapest; gpt-6.1-sol in none of 48 (one more in a
  probe outside the protocol).
- **A parse defect.** All 5 invalid replies (4 qwen, 1 gpt) were `MEMORY <key> <n> [replaces <key>]` with the brackets
  that the charter uses to mark the optional part. Real runs logged 18 invalid refinements across 12 run files since
  2026-10-15; their text is not logged, so the share with this cause there is unknown. Fixed (below).
- **Limits.** In-sample: su15, the failure the earlier analysis already named. One grader, blind to arm; model style and a
  WHY citing a measurement can unblind partly. R counts what a refinement proposes, not whether the agent would act on
  it. Samples are small (a rate near 12% per refinement for the stronger model). Cost: 684,179 budget tokens (uncached
  input + output), including two probes and one retried timeout; the stated budget was about 1M.

## L1: the ledger — design and cost

| Item | Where | Default | Earlier behaviour |
|---|---|---|---|
| A refinement edit may carry `EXPECT within <N> actions: <sentence>` (since 2026-10-17 also `within <N>:`) and a `check(t)` (the hypothesis check signature: True shows it, False contradicts it, None does not bear on it; since 2026-10-17 `t.get` of a key the move does not carry raises, `x` and `y` excepted), before or after the edit; kept on the edit's row in `refiner.jsonl` (`expect`: claim, within, check); `within` defaults to `ARC_REFINE_EVERY`, at most 60; a malformed one is logged (`expect_error`) and the edit still applies | `parseExpect`, `parseRefinerReply` in `demo/arc_thin_refiner.ts`; `ledgerFields` in `runRefiner`; `_StrictTransition` in `demo/arc_thin_skill_guest.ts` | on | `ARC_REFINE_LEDGER=0` (the charter no longer mentions it) |
| Edit ids (`e1`, `e2`, … continuing a fork's source) on edit rows; a `told` row (id, action count, decision) when the decision start shows the notice | `refinerEdits`, `tell`, `takeRefinerNotice` | always | — (logging; both arms of a comparison are measured alike) |
| `YOUR EARLIER EDITS` in each refinement's input, after `ACTIONS SO FAR`: the latest `ARC_REFINE_LEDGER_EDITS` (5) edits, newest first, ≤1,800 characters. Per edit: target and version; what became of it (still current, rewritten by a refinement or by the agent, retired, deleted by the agent at #n); since the agent was told: actions, RESETs, GAME_OVERs, level changes; calls of a refined tool, a refined view's output, a refined hypothesis's current check results and status; the expectation's result (met or contradicted at #n, not seen in N actions, not seen yet; a check that could not run, or that raised: on how many moves, the first, the error) | `editLedgerText`, `expectationResults`, `expectationText`, `sinceText` in `demo/arc_thin_extension.ts`; `renderEditLedger` in `demo/arc_thin_refiner.ts` | on | `ARC_REFINE_LEDGER=0` |
| The charter gains one paragraph (`REFINER_LEDGER_SYSTEM`, about 670 characters): revise or replace an edit that was not used or whose expectation failed before adding another; the EXPECT form | `demo/arc_thin_refiner.ts` | on | `ARC_REFINE_LEDGER=0` |
| `MEMORY <key> <n> [replaces <key>, …]` with brackets is accepted | `parseRefinerReply` | — | — (a fix) |

- **Cost.** Agent context: nothing. Refinement input: at most 1,800 characters; charter: about 670 characters (together at
  most ~700 tokens per refinement, inside the 10% refinement share). Expectations are checked when a refinement starts,
  in the claims guest the hypothesis checks use, over the moves from the telling to the horizon; this runs off the
  decision path (refinements run in the background) and adds about 1–3 s (one WASI start) to a refinement.
- **Lifecycle.** The runtime counts and runs the checks; whether to revise, replace or leave an edit stays with the
  refinement; the agent's own edits, the refinement's ownership rules and staleness checks are unchanged. The ledger
  reads only the runtime's own stores (`refiner.jsonl`, `memory.jsonl`, `component_runs.jsonl`, claim results).
- **Generality.** No game content in code, charter or tests (the unit board is synthetic). Expectations are written by
  the refinement for its game, so analyses that we wrote into the framework after the fact (r6–r9) can now be stated by
  the run itself.
- **Not built.** The measurement round: the replay gave no support for it.

## The refinement model option (`ARC_REFINE_MODEL`, built after the replay)

| Item | Where | Default | Earlier behaviour |
|---|---|---|---|
| `ARC_REFINE_MODEL=<id>`: refinements run on another model of the agent's provider. The runner lists it in `.pi-agent/models.json` beside the agent's model, text only and `"reasoning": false`, so the thinking dialect's parameter (`enable_thinking` for qwen) stays out of its calls and the gateway's default applies, as in the replay; `run-config.json` records `refine_model` | `_write_models_json`, `run_arc_thin_e2e` in `src/autoresearch_pi/arc_thin_e2e.py` | unset: the agent's model | — |
| The extension finds the model by id (`ctx.modelRegistry.find`); one that is not configured fails the refinement, which the agent is told ("ARC_REFINE_MODEL x is not a model of provider p"), instead of falling back quietly to the agent's model | `runRefiner`, `sideCall(…, { model })` in `demo/arc_thin_extension.ts` | — | — |
| `ARC_REFINE_MAX_TOKENS` (the refinement's output cap, 6,000 as before) | same | 6000 | — |
| The model is logged where cost is counted: `usage.jsonl` rows (`model`), refinement `start` rows and `refiner_inputs.jsonl`, so refinement tokens can be priced apart from the agent's | same | always | — |
| `refiner_replies.jsonl`: every refinement reply as it came (model, stop reason, text): the 18 refinements logged as invalid since 2026-10-15 left only their parse error | `runRefiner` | always | — |

- **Checks.** `arc_thin_refine_ledger` 7/7 (the configured model is used; unset, the agent's; an unknown one fails
  the refinement before any call, and the agent is told; the reply log). pytest `test_arc_thin_lifecycle_stats.py` 8/8
  (the models.json entry; none when the model is the agent's). `schedule` smoke with the agent's model and with
  `refinemodel` (the scripted provider's second model): refinement inputs, `start` rows and usage name the refinement
  model, the agent's requests keep theirs, and the replies are logged (the provider failure as `stop_reason: error`).
  One request through Pi against the real gateway, on `gpt-6.1-sol` from the runner's models.json with the qwen dialect
  at provider level: reply "OK", `stop`, 428 tokens (`C:/Users/qi/tmp/refiner-ledger/pi-model-probe.json`).
- **Not checked.** A refinement on `gpt-6.1-sol` inside a real run: the F2 sources ran arm A's settings, and arm B's
  forks, which would have been the first, did not run.

## Implementation and verification

- **Files.** `demo/arc_thin_refiner.ts`, `demo/arc_thin_extension.ts` (`transitionsFor` factored out of
  `refreshClaimChecks`, behaviour unchanged), `tests/arc_thin_refine_ledger.test.ts` (new), `tools/arc_thin_smoke_provider.ts`
  (the schedule script's first edit carries an EXPECT; a step may answer late, `delayMs`, and the last 8 of now 16
  schedule decisions do, so that the refinements they start reach the provider), `tools/run_foundation_smoke.py`
  (schedule: 16 decisions and the ledger checks).
- **Unit tests** (Node 25.5 `--experimental-transform-types`, each file alone): `arc_thin_refine_ledger` 6/6 — EXPECT
  before and after an edit, fenced, clamped and malformed; the bracketed MEMORY form; the ledger's rendering and
  truncation; through the extension with the real WASI guest: an expectation met at #4 on the first move after the agent
  was told at #3, a memory entry the agent deleted at #5, a refinement's hypothesis followed by its check results, the
  `told` rows, `ARC_REFINE_LEDGER=0`. Full suite on the ledger code: 42 files, 211 tests, 206 pass; the 5 failures
  (activation "saved code acts in a closed loop", components "python session never stores runtime objects", receipts ×3)
  fail the same way on the base worktree (code of `1d60dcf1`); `action_surface` timed out once under load and passed
  alone. The files that touch refinements (`refine_ledger`, `fixed_refine`, `promotion`, `claims`, `memory`,
  `activation`) were run again on the final code: 49/50, the one failure the activation test above. Logs:
  `C:/Users/qi/tmp/refiner-ledger/suite`, `tests`, `base-tests`.
- **Deterministic smokes** (mock ARC SDK, production bridge, installed Pi 0.87.0, scripted provider;
  `C:/Users/qi/tmp/refiner-ledger/smokes/final-*`):
  - `schedule`: edit `e1` keeps `expect` (within 4); `told` e1 at #5; the refinement that starts in the same decision lists
    e1 as "not shown to the agent yet"; the next lists "since #5: 4 actions, no level change · expected within 4: "the
    agent plays ACTION4" — met at #…"; the charter paragraph is in every refinement's system prompt.
  - `promotion` and `activation` (refinements on events): their own checks pass with the ledger on; the promotion
    refinements list "memory hyp.right (still as written) … its check since: holds 1 · fails 0 · n/a 0; status open" and
    the rules edit.
  - All three stop at the shared final check `system_chars <= 3000`, as every native script does on the base.
- **Not run.** `arc-harness-smoke` (no closure claim), forks.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional correctness | Passed, again after the 2026-10-17 fixes | local Node, real WASI guest; pytest | unit tests above; `tests3/` |
| Full-chain reachability | Passed for the ledger, EXPECT and the refinement model option; the ledger and EXPECT also ran in two real su15 runs, where two defects showed (fixed, the fixes again through the smokes) | mock ARC SDK, production bridge, installed Pi 0.87.0, scripted provider; one real-gateway request through Pi for the models.json entry; real ARC service and yibu qwen3.8-27b for su15-f2-src1, src2 | `smokes/final-*`, `model-own`, `model-second`, `final-model`, `strict-*`; `runs/arc-f2-refiner-model/`; `ARC_REFINE_MODEL` and the fixes not yet inside a real run |
| Autonomous adoption | The form: the qwen refiner wrote an expectation with every edit in two real runs (9/9). Its use of the ledger: unverified (no ledger-off arm). R1: a stronger refinement model proposed the missing test in 6/48 replayed refinements, qwen in 0/48 | yibu: qwen3.8-27b, gpt-6.1-sol; logged su15 inputs, no actions; two su15 source runs | `replay/results.jsonl`, `grading/`; in-sample, proposals only; `f2/ledger-su15-f2-src*.txt` |
| Net benefit | Unverified | — | F2 not run (no qualifying source); F1 not run |

## Experiment protocol (fixed before any run; F2 not run, see its outcome below; F1 not run)

**F2, the refinement model — first.**
- **Arms**, one commit of this branch, ledger on in both: A refinements on the agent's model (qwen3.8-27b); B
  `ARC_REFINE_MODEL=gpt-6.1-sol`. Everything else as the su15 runs since r2: yibu, thinking off (Completions, qwen
  dialect), text+image, query observations, 300 s step timeout, r10 off, the fixed 15-action refinement step.
- **Source.** su15 from its start on A's settings, `SNAPLEVEL=1 MAXLEVEL=1`, at most 110 actions (level 1's budget),
  1.0M budget tokens and 60 minutes. Kept only if it completes level 1 with no click 2–7 cells from the nearest object
  (`f2-source-check.ts`): the r10 fork test's source made one click 4–7 cells away and two 2–3 away on level 1, and then
  every fork, arm A included, found the reach, which left nothing to fix (r5, r6, r7 and r9 played level 1 without
  such clicks; r3 and r8b did not). At most two attempts; if neither qualifies, F2 is reported as not run.
- **Forks.** 3 per arm from the kept snapshot, A and B of one index started together: at most 100 actions after the
  fork, 1.5M budget tokens after the fork and 90 minutes each; each stops at level 2's completion (`MAXLEVEL=2`).
- **Measures** (`f2-measures.ts`, checked against the r10 fork test's runs: it gives their table's values): level 2
  completed and its level actions; the first click 4–7 cells from the nearest object (level action; none = 100); clicks
  by distance; GAME_OVERs; budget tokens after the fork; refinements started, edits, failures, invalid and stale
  replies, their tokens and model; expectations met, contradicted, not seen. Read afterwards, blind to arm as in the
  replay: whether each refinement proposed the reach test (R), and whether the agent played a proposed test within 10
  actions.
- **Claim.** B's first 4–7-cell click comes at least 30 level actions earlier than A's in at least 2 of 3 pairs, or B
  completes level 2 within the 100 actions in at least 2 forks and A in at most 1.
- **Negative cases.** No difference: the stronger refinement does not move the agent. B's refinements propose the test
  (R) but the agent does not play it within 10 actions: the break moves to the agent's use of refinements. B's
  refinements reach the 10% share ceiling, which skips scheduled refinements: reported with the result.
- **Risks.** The gateway refuses every request once the transcript repeats an identical tool call, without usage, so a
  fork can spin without spending (R1's su15 B2); the 90-minute deadline ends it, and a fork that spins is reported as
  such, not dropped. A step timeout restarts the environment between decisions (up to 3).
- **Budget.** At most 2.0M for sources (two attempts) and 9.0M for six forks: at most 11.0M budget tokens. Expected
  about 6–8M (level 2 at r9's ~13k per action, 100 actions per fork).
- **Prepared** (`C:/Users/qi/tmp/refiner-ledger/f2/`): `launch-f2-src.cmd <label>`; `launch-f2-fork.cmd <label>
  <snapshot> A|B <action cap>` (the cap counts the replayed prefix: prefix + 100); `f2-source-check.ts`;
  `f2-measures.ts`. The pilot freezes a committed tree, so this branch is committed before the source starts.
- **Base.** R1 (2026-10-16) found that `claude/r03b-simple-20261015`, this branch's base, does not merge as it stands
  (su15: 1 of 3 forks to level 1 against the base's 3 of 3). F2 compares two arms of one commit, so its answer does not
  depend on that; a merge of this work would need the same test on `r03b`.
- **Authorized** 2026-10-16 ("yes, go on"): at most 11.0M budget tokens. Code `fe9dccd6`, protocol `393fc58f`.
- **Deviations, each recorded before the runs it affects.**
  - 23:40. Neither source attempt qualified. su15-f2-src1 ended at the 1.0M token cap after 94 actions without
    completing level 1 (1,037,245 budget tokens). su15-f2-src2 had made 5 clicks 2–7 cells from an object by #77 (3 at
    2–3, 2 at 4–7) and was stopped by hand at #81, since it could no longer qualify (434,457). A third attempt runs with
    the same settings; if it does not qualify, F2 is reported as not run.
  - To keep the total within 11.0M (1.47M spent), each fork's token cap goes from 1.5M to 1.35M, in both arms.
- **Outcome.** The third attempt did not qualify either: F2 is reported as not run ([below](#f2-outcome-and-what-the-source-runs-showed-2026-10-17)).

**F1, the ledger — after F2.** One commit; arm A `ARC_REFINE_LEDGER=0`, arm B default; the refinement model F2 keeps.
The same kind of source; 3 forks per arm, each ≤100 actions after the fork. Measures: of edits whose expectation failed
or that went unused, the share revised or replaced by the next two refinements (B), and the same judged by reading for
A; attempt-ending proposals; refinement tokens; levels, level-2 actions, first click 4–7 cells away. Keep if B's share is
at least twice A's at ≤15% more refinement tokens, and levels and level-2 actions are no worse.

## F2 outcome, and what the source runs showed (2026-10-17)

No source qualified (final checks `C:/Users/qi/tmp/refiner-ledger/f2/final-check-*.json`; runs
`runs/arc-f2-refiner-model/`):

| Attempt | Level-1 actions | Level 1 | Level-1 clicks by distance from the nearest object (0 · 1 · 2–3 · 4–7 · 8+) | Stop | Budget tokens (of them refinements) |
|---|---|---|---|---|---|
| su15-f2-src1 | 94 | not completed | 57 · 18 · 1 · 1 · 0 | 1.0M token cap | 1,037,245 (36,733) |
| su15-f2-src2 | 81 | not completed | 44 · 3 · 3 · 2 · 1 | by hand at #81 | 434,457 (28,368) |
| su15-f2-src3 | 12 | not completed | 8 · 0 · 1 · 0 · 0 | by the watcher at #12 | 165,536 (no refinement yet) |

- **F2 not run.** Spent 1,637,238 of the 11.0M; no fork ran. All three clicked 2–7 cells from an object on level 1
  (src3 at #10, before any refinement), which su15 r5, r6, r7 and r9 on the base had not; three attempts cannot tell
  chance from an effect of this branch.
- **The ledger in real play** (refinements on qwen3.8-27b; two runs, no ledger-off arm;
  `f2/ledger-su15-f2-src1.txt`, `ledger-su15-f2-src2.txt`):
  - Every applied edit carried an expectation (9 of 9; one more came with an edit refused for rewriting an existing
    hypothesis), with horizons of 3–5 actions. Later inputs reported: src1 e1 met at #47, e2 not seen in 5 actions, e3
    not seen in 3; src2 e1 met at #19, e2 contradicted at #37 (wrongly, below), e3 contradicted at #50, e4 contradicted
    at #73. Each run's last edit came after its last refinement.
  - Of the five refinements whose input listed an earlier edit as contradicted or not seen, two rewrote that edit's file
    (src2 #45 and #77, the strategy; #77's WHY: "the strategy v3 said to stop this after #45 but the agent repeated it 15
    more times"); three edited something else (two new hypotheses, and a strategy whose own expectation had been met).
    Two runs without the other arm say nothing about L1's effect.
- **Two defects, fixed after the runs** (no run used the fixes):
  - Checks computed on defaults. 4 of the 9 expectation checks read, with `t.get(key, default)`, keys a move does not
    carry (`changed_cells` twice, `changed`, `predict`: src1 e2–e4, src2 e2). src2's e2, `bool(t.get('predict') and …)`,
    was reported contradicted at #37: the first move after the agent was told, and a goal test off the transform, which
    is what it expected. Expectation checks now see moves on which `t.get` of an absent key (`x` and `y` excepted)
    raises, naming the keys a move has; the ledger reports a check that raised (on how many moves, the first, the
    error) also when another move decided it.
  - src2 #62 wrote `EXPECT within 5: …`, without "actions"; the horizon was read as part of the sentence and the default
    15 applied. `within <N>:` is now a horizon.
- **Not changed: hypothesis checks have the same silent default** (the same move object, `_Transition`). Of the 14
  hypotheses refinements wrote in su15 r2–r9, 6 read `changed_cells` (one more in src1); su15-r2's
  `hyp.action6_requires_nonzero_target` recorded 206 fails and 5 holds, each with `changed_cells` read as an empty list.
  Strict moves there would reach the agent's own checks and the promotion of checks into rules: a separate change with
  its own acceptance.
- **Checks of the fixes.** `arc_thin_refine_ledger` 8/8 (new: the `within <N>:` horizon; an expectation check reading
  `changed_cells` reported as raising on the move, with the move's keys, while a hypothesis check in the same input still
  reads the default). The files that run the guest or refinements, each alone (`claims`, `fixed_refine`, `promotion`,
  `memory`, `native_memory`, `activation`, `skill_surface`, `skill_provenance`, `history`, `arc_agi_3_foundation`), with
  the ledger file: 69 tests, 68 pass; the failure is the activation test that fails on the base (`tests3/`). Smokes
  `schedule` and `promotion` on the changed guest: their own checks pass (the schedule smoke's expectation is met through
  the production bridge and Pi), and both stop at the shared `system_chars` check as on the base (`smokes/strict-*`).
- **Next.** F2 needs a source its rule accepts, or a rule amended before new runs; the choice is open. Of the authorized
  11.0M, 9.36M remain; the six forks need at most 8.1M, which leaves 1.26M for sources.

## Delivery decision

- **Supported:** the ledger and EXPECT work offline and through the real bridge and Pi with a scripted provider; the
  bracketed MEMORY form is accepted. On su15's logged inputs, a stronger refinement model proposed the missing test in
  6 of 48 refinements and qwen in 0 of 48, and a measurement round did not change qwen's result. In two real su15 runs
  the qwen refiner wrote an expectation with every edit and the ledger reported them; the two defects those runs showed
  are fixed.
- **Not supported:** that a real refinement model uses the ledger well; any task or cost effect; that a stronger
  refinement model helps the agent (the agent may not act on its proposals); anything beyond su15. F2 did not run.
- **Decision:** kept on this branch, on by default (`ARC_REFINE_LEDGER=0` is arm A); experimental until F1 runs. The
  measurement round is not built. `ARC_REFINE_MODEL` is off unless set. F2, the next falsifiable check, did not run for
  want of a qualifying source; whether to continue it with more attempts or an amended rule is open (2026-10-17).
- **Backlog** ([deferred-research-todos](../deferred-research-todos.md)): B (a role that double-checks and searches for
  the untested rival: the refinement with its ledger), C (a helper's proposed experiment, the agent's action, the result:
  what EXPECT tracks), D (the ledger carries the refinements' own conclusions forward). None closes.
