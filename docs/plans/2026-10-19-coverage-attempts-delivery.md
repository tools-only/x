# Coverage, attempts and one delivery channel (P1-P4), 2026-10-19

Date: 2026-10-19 (Asia/Shanghai). Status: implemented and checked offline; real runs pending (see the protocol below).
Branch `claude/r04-cov-20261019` (temporary worktree `worktrees/r04-cov`, cut from `claude/r04-20261017` at `40cf299c`;
folded back into r04 when committed). The user's plan (four mechanism changes in priority order, the evaluation arms
and their budget) is the source of the scope; this record follows `docs/templates/meta-harness-change.md`.

## Problem and claim

### What the recorded runs show (offline replay, `C:/Users/qi/tmp/r04/cov/sim.mjs`, rules as implemented)

- **Kinds of clicks per level** (distance from the area the previous move of the attempt changed, counter lines left
  out; "first" = no change yet in the attempt):

  | Run, level | Result | Moves | inside | touching | 2-6 cells | > 6 cells | first |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | su15-g56-1 L2 (gpt-5.6-sol) | lost | 204 | 155 | 1 | 4 | 30 | 7 |
  | su15-g56-2 L2 (gpt-5.6-sol) | lost | 202 | 172 | 0 | 1 | 18 | 8 |
  | su15-q38-1 L2 (qwen) | passed | 106 | 8 | 5 | 41 | 42 | 8 |
  | su15-q38-2 L2 (qwen) | lost | 202 | 26 | 19 | 18 | 111 | 11 |
  | su15-g61-1 L4 (gpt-6.1-sol) | passed | 131 | 33 | 2 | 55 | 25 | 7 |

  The two levels gpt-5.6-sol lost were played almost entirely on the block it had just moved; the levels passed include
  dozens of clicks a few cells away. q38-2 covered every kind and still lost (its failure was elsewhere: the goal).
- **The bridge's change box includes the move counter.** In every su15 run row 63 changed on every move that changed
  anything, so each move's box reached from the moved block to the bottom row. The replay finds that row as a busy line
  in all six runs; the kinds above are computed without it.
- **Rival replies rarely name a move the runtime could check.** Of the 9 rival events answered in su15-g56-2, -q38-2
  and -g61-1, one reply named a click with its cell (g56-2 #13, `ACTION6(46,17)`), three named `ACTION6` without a cell,
  one `ACTION7`, three no move ("click its untested bottom-left cell"); two replies were aborted.
- **Attempts.** su15-g56-1's second level: six GAME_OVERs after 33, 37, 38, 32, 32 and 32 actions. Between them the agent
  rewrote the claim of its movement model (adding that obstacles and the timer end a run) while its check, what is
  tested on the moves, stayed the same from #142 to the end.
- From the plan: the H3a line stood unchanged for 35 decisions in su15-g56-2 and 45 in su15-q38-2; refine and consult
  were called 0 times in 10+ runs; the tool schemas are 6,701 characters per request (g56-2), of which refine and consult
  are about 650.

### Claims (each falsifiable in the runs below)

- **P1.** When a rival event fires while some kinds of moves are rare on the level, the rival the refinement writes
  disagrees with the belief on a rare kind, and names that move.
- **P2.** When two attempts on a level fail under one control model, a refinement writes a rival control model and the
  move that tests it.
- **P3.** A move delivered as the first item of the strategy's next experiment is played within its window (10
  actions) more often than separating moves delivered only in CURRENT KNOWLEDGE were.
- **Outcome.** With P1-P3, the second-level pass rate of gpt-5.6-sol and qwen is not below the pooled base (0 of 2 and 3
  of 8), and budget tokens per action do not rise by more than a tenth.

Burden removed: the agent no longer has to notice, unaided, that its experiments all fall in one kind of move, or that
its attempts fail the same way; the refinement does not have to guess which experiment would be new. The comparison
line no longer stays resident unchanged.

Non-use and falsifiers: P1 is falsified if rival events fire but the agent plays no move of the rare kind within the
window after being told; or if it does and no rival is resolved (no separating move recorded). P2 is falsified if the
events fire and no test move follows, or if it fires mostly where the model was right (the risk named by the parallel
session: g61-1's fourth level, seven failed attempts under the right model). The outcome claim is falsified if levels
fall below the current version for the same model.

Scope: refinement events and their handling, the strategy as delivery channel, one RESOURCES line, the decision view's
comparison line, and the P4 switches. No change to the agent's tools or fields, the action schema, budgets or the
environment boundary.

## Design and cost

- **Coverage (P1), `demo/arc_thin_coverage.ts`.** Per level, each move's kind: a click's region by its Chebyshev
  distance from the box the latest change of its attempt left (0 inside, 1 touching, 2-6, more), another action by
  its name, counted with the grids it was played from (busy lines masked). A row or column that changed on at least 80%
  of the ordinary moves (at least 8) is a counter and is left out of boxes and grid keys (the ledger's ticker rule,
  applied to lines). A kind is rare when it holds at most 5% of the level's moves. Game-agnostic: actions, coordinates,
  grids and the environment's level/terminal signals only. ACTION6 is the coordinate action of the ARC-AGI-3 interface,
  as `takesCoordinates` already says.
- **Rival events** carry the counts and the rare kinds, and ask for the separating move as `ACTION6(x,y)` or `ACTIONn` in
  predicts. Contest events carry the counts and ask for the settling move (in predicts or first in the strategy).
- **One return.** A HYPOTHESIS answer to a rival, contest or repeated-failure event whose predicts names no move, a click
  without its cell, or an unavailable action, or (rival only) a move of a kind the level has already seen while rare
  kinds exist, is sent back once with the reason; the second answer is used as it comes.
- **Delivery (P3).** The move the answer names becomes the first line of the strategy's Next experiment
  (`- First: ACTION6(30,42), a click 2-6 cells from the last changed area; <hypothesis> against <target>: <predicts>`),
  written by the runtime as a versioned strategy edit. It stays the first item of any strategy a refinement writes until
  a move of its kind is played after the agent was told (then the line is removed), the level changes, or three windows
  pass. The agent's notice names it. Once its window (10 actions, or an EXPECT's within up to 30) has passed unplayed, the
  arc_action receipt says so, at most three times. The refinement ledger reports "next experiment <move> (<kind>): played
  at #n / not played in N actions".
- **Repeated failure (P2).** Attempts run between RESETs, GAME_OVERs and level changes. The event fires when a level has
  two attempts ended by GAME_OVER or RESET that were played wholly after the agent last changed a hypothesis about its
  actions, once per level and model. "Changed" means rewritten in what it predicts (its check, or its claim when it has
  none), rejected or deleted; adding a hypothesis beside it does not change it; goal hypotheses (isGoalHypothesis, which
  now also matches "completes") and refinement rows do not count. RESOURCES shows "this attempt: N actions; earlier
  attempts on this level ended after a, b, c actions (GAME_OVER)".
- **Comparison line once (P3).** The H3a line per question is shown when new and again when it changes; a growing count
  of moves both decided alike is not a change.
- **P4 switches.** `ARC_THIN_LEAN=1`: no refine and consult tools, the subagent line of the system prompt removed, the
  skill line shortened; `ARC_THIN_REFINE_TOOL=0` and `ARC_THIN_CONSULT=0` one at a time. With default switches the
  system prompt renders byte-identically to the base (checked).
- **Switch for P1-P3:** `ARC_REFINE_COVERAGE=0` restores the earlier events, delivery and comparison line.
- Added cost: event text (the counts line, about 250 characters, only in the refinement's input); at most one extra
  refiner call per coverage event; one strategy line while a move is pinned; one RESOURCES clause after a failed
  attempt; one receipt line when overdue (three at most). Removed: the resident comparison line while unchanged; with
  P4, about 650 characters of tool schema and about 300 of system prompt per request.

### Deviations from the plan, and why

1. **Counter lines are masked.** The plan measured distance from "the previous move's changed-cell box"; in su15 that
   box always reaches the counter row, so "inside" would cover most of the board. Masking busy lines is the general
   form of the ledger's existing ticker rule.
2. **No separate EXPECT requirement.** The plan asked for EXPECT on these replies, sent back once when missing. A
   refinement's check sees one move and cannot tell a move's region (it does not see the previous move's change), so the
   runtime checks "a move of kind B within K actions" itself; the one return asks for the move instead. A refinement may
   still add an EXPECT (its within sets K).
3. **P2 asks for a rival, not a replacement.** On su15-g61-1's fourth level (gpt-6.1-sol, passed at #193) the trigger
   would fire at #86 under the right model; there one test move refutes the rival. "The plan needs about N" is left
   out: no mechanical source for N.
4. **"Changed claim" is read as changed prediction.** In g56-1 the agent rewrote the claim after each GAME_OVER while
   the check stayed the same; text changes alone would have silenced P2 there.
5. **Considered, not done:** collapsing contested refinement hypotheses that stay unchanged in CURRENT KNOWLEDGE (the
   parallel session saw two sit from #8 to #175 in g61-1). It changes how live knowledge is shown; it needs its own
   claim and check.

## Pre-run protocol

- Evidence level: autonomous adoption (P1-P3 events, moves played) and outcome, on real runs.
- Arms (the plan): r04-cov HEAD with P1-P3 on (default) on su15, gpt-5.6-sol (reasoning medium, openai dialect) and
  qwen3.8-27b (thinking off, qwen dialect), two runs each, 6M budget tokens each (24M), same settings as the base pairs
  (`tools/arc_ls20_loop_pilot.py`, no action cap beyond the game's, no time cap, snapshot at level 1, default native
  history: transcript, `ARC_THIN_NATIVE_HISTORY_CHARS` unset). Then P4 (`ARC_THIN_LEAN=1`) as its own arm, and one
  gpt-5.6-sol run at reasoning high.
- Comparators: su15-g56-1, su15-g56-2 (gpt-5.6-sol: 1, 1 level); su15-q38-1..3 and the six L0/L1 qwen runs (second level
  passed in 3 of 9 qwen runs counting q38-3).
- Mechanism measures: rival events raised and answered; returns and their reasons; pinned moves, played within the window
  or not (by edit); rare-kind moves after an event vs before; separating moves recorded and rival status changes;
  repeated-failure events and what followed (a rival control model, its test move); EXPECT rate on event replies;
  receipts' overdue lines. Outcome: levels, second-level pass, budget tokens per action, refiner share.
- Stop rules: the runner's (token cap, the level budgets, refusal stop, outage wait).
- Limits: two runs per arm separate only large effects; su15 is the motivating game (in-sample).

## Implementation and verification

- Files: `demo/arc_thin_coverage.ts` (new), `demo/arc_thin_extension.ts`, `demo/arc_thin_claims.ts`,
  `demo/arc_thin_refiner.ts`, `demo/arc_thin_ledger.ts` (goal words), `demo/prompts/arc_thin_native_system.md`
  (placeholders), tests `tests/arc_thin_coverage.test.ts`, `tests/arc_thin_coverage_events.test.ts`, and three contest
  answers in `tests/arc_thin_refine_ledger.test.ts` that now name their settling move.
- Offline replay on six recorded runs (above): busy row 63 found in all; P2 would fire in g56-1 (level 1 after #51,
  level 2 after #214), g56-2 (#131), q38-1 (#26, #78, #237), q38-2 (#58), q38-3 (#33) and g61-1 (#86, the level it
  passed).
- Tests (`C:/Users/qi/tmp/r04/cov/t1`-`t5`): `arc_thin_coverage` 6/6 (busy lines, kinds, rare kinds, classification,
  move parsing, attempts, model changes, strategy items), `arc_thin_coverage_events` 3/3 (the real extension on an HTTP
  stand-in bridge with WASI checks: a rival event carries the counts, an answer on a seen kind goes back once with the
  reason, the second answer's move is pinned first in the next experiment, the notice names it, playing it releases it,
  the comparison line is not shown again unchanged; two GAME_OVER attempts under one model raise the repeated-failure
  event and the RESOURCES line; ARC_THIN_LEAN=1 against the default), `arc_thin_refine_ledger` 20/20 (three contest
  answers now name their settling move). Full thin suite: 210 tests, 204 pass; the 5 failures in activation, components
  and receipts fail the same way at the base (`worktrees/r04`), and one action-surface timeout under load passed on two
  reruns. The default system prompt renders byte-identically to the base (3,537 characters; lean: 3,334).

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | passed | unit tests; HTTP stand-in bridge with the real extension and WASI checks | `C:/Users/qi/tmp/r04/cov/t1`-`t5`, `prompt-check.json` |
| Full-chain reachability | not run | — | no smoke (the user's rule for this loop); the first real run is the check |
| Autonomous adoption | unverified | — | the runs above |
| Net benefit | unverified | — | the runs above |

## Decision

Pending the runs. Related backlog: item C (hypothesis → experiment → revision); its status does not change without
real-run evidence.
