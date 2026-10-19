# Ledger: busy status lines masked with ticker cells, so a timer bar no longer hides repeats

Date: 2026-10-19 (Asia/Shanghai). Status: implemented and checked offline on `claude/eloquent-clarke-791d8a` (cut from
r04 `5e998182`); not merged into `claude/r04-20261017`. The user said on 2026-10-19 not to change the current version's
mechanism or structure without asking, so the change and its evidence go to the user first. No paid run.

Change record per [the development workflow](../development-workflow.md), with the sections of
[the template](../templates/meta-harness-change.md).

## Problem and claim

- **Observation.** `maskedHashes` (`demo/arc_thin_ledger.ts`) masks "ticker" cells, cells that changed on at least 80%
  of the transitions, so that a counter does not make every state unique. su15's timer is a bar in row 63 that fills by
  1-8 cells per action and empties with the attempt. Each of its cells changes once per attempt, so the rule finds no
  ticker cell in any of the seven su15 runs of `runs/arc-models-20261019`, and the bar enters every state hash. Found as
  a side finding of [the offline world model record](2026-10-19-offline-world-model.md).
- **Where it acts.** `buildLedger` turns the hashes into repeats (same masked state, same action, same masked result,
  within an attempt) and the stall (actions since the last new masked state). Both feed `criticTriggers`, which in native
  runs is part of the refiner's events (its `WHY NOW` line). A repeat counts there only 8 or more actions after the last
  refinement, while the level has had fewer than 6 refinements; a stall, 20 actions after the last refinement. They
  also give the `REPEATS` line of `data/ledger.md`, which the agent reads on demand.
- **Claim.** Masking, besides ticker cells, every row or column whose cells other than tickers are recoloured one way
  (no value both leaves and arrives in the line) on at least 80% of the transitions makes repeats and stalls visible in
  games with a bar timer, and merges no states that differ outside status lines.
- **Burden removed.** Nothing for the agent directly. The ledger is a service; it stops hiding repeated moves and
  stalls behind the timer. Whether the refiner or the agent makes use of that is not tested here.
- **Falsifiers**, fixed before the held-out results were read: N1, a line masked over a whole held-out run that is not a
  counter or timer by its content; N2, a new repeat whose full grids differ outside status lines.
- **Scope.** `maskedHashes` and its tests. No prompt, field, schema, tool, gate or worker. Not claimed: adoption, levels.

## Design and cost

- **First version, as asked.** Rows or columns with a changed cell on at least 80% of the transitions, with the ticker
  rule's threshold and its 8-transition minimum (the line rule of `tools/arc_world_model.ts`). Ticker cells are left
  out of the line counts: otherwise one ticker cell hides its whole row and column.
- **Rejected by the held-out recheck** (below). An ls20 player sprite that walks up and down a corridor on most moves
  makes the corridor's columns busy, and its positions merge: 90 false repeats in 8 of the 27 held-out records.
- **Revision, one factor.** A line counts on a transition only when it was recoloured one way. A bar or a counter
  recolours its cells (0→5, 11→3); a moving object carries its values, so the same values leave and arrive in its lines.
  The revision was made after reading the held-out results, so ls20, which prompted it, counts as in-sample for it.
  For the other five held-out games the comparison was made with the rule already fixed, but they had been read once.
- **Not taken.** Layout priors (lines at the grid's edge) would fit the games seen. A denominator of transitions that
  changed something, as `MoveFacts.busy` uses on `claude/r04-cov-20261019`, would be a second factor; it is reported as
  a variant below.
- **Lifecycle.** The runtime rebuilds the ledger before each decision. Repeat and stall triggers keep `criticTriggers`'
  rate limits; the refiner model decides what, if anything, to do with them.
- **Added.** `maskedHashes` also returns the masked lines (`busy`), read only by tests so far.
- **Cost.** Rebuilding the ledger takes about 3.5 times as long: su15-g61-1 from 15 to 54 ms per decision on average
  (164 decisions, this machine).
- **Known limits.**
  - Everything on a masked line is ignored: ls20's lives sit beside its bar in rows 61-62.
  - An object that jumps between places that share no line recolours its lines one way. su15-g61-1 had row 52 and
    column 11 masked at one decision (#8); no repeat depended on it.
  - The denominator counts transitions that changed nothing, so a bar that does not move on such transitions can fall
    under 80%: su15-q38-2's row 63 was masked at 57 of its 78 decisions, q38-3's never.
- **Reverting** is one commit; recorded runs are not affected.

## Pre-run protocol (offline: no model call, no ARC action)

- **Evidence level.** Functional checks, and an offline replay of recorded runs.
- **Comparator.** The ledger the runs used (`acaf2d8e…` sha256, r04 `5e998182`; the same file as in the `runtime/demo`
  of su15-g61-1, -g56-1 and -q38-1, and as recorded in su15-g61-2's `run-config.json`) against the candidate.
- **Data.**
  - In-sample: the seven su15 runs of `runs/arc-models-20261019`.
  - Held out: every recorded run of another game with at least 20 grids, 27 records of six games (ls20 15, bp35 6,
    ar25 2, ka59 2, ft09 1, tu93 1). Some are forks that share their first moves.
- **Measures.**
  - The side finding's definition: same masked state and same action seen earlier in the run.
  - The ledger's repeats over the whole run.
  - A replay decision by decision: the ledger rebuilt from the moves of the decisions before, its new repeats, its
    stall, and `criticTriggers`' repeat and stall triggers. Recorded refinement starts are the notes; a trigger where no
    start was recorded adds one.
  - Every line masked at any decision, and for each new repeat, where the full grids differ.
- **Script and outputs.** `C:/Users/qi/tmp/busy-lines/recheck.ts` with `recheck-su15.cmd` and `recheck-heldout.cmd`;
  `su15.jsonl` and `heldout.jsonl` (candidate), `su15-plain.jsonl` and `heldout-plain.jsonl` (first version).

## Implementation and verification

- **Code.** `demo/arc_thin_ledger.ts` (`maskedHashes`), `tests/arc_thin_ledger.test.ts`.
- **Tests.** Three new tests, each seen failing first: a bar that loses one cell per action (not masked before); a
  ticker cell sharing a row with the state (the row was masked without the exclusion); an object moving up and down a
  column (masked by the first version). `arc_thin_ledger` and `arc_thin_critic` tests: 16/16.
- **Regression.** The 36 `tests/arc_thin_*.test.ts` files, each in its own process (`C:/Users/qi/tmp/busy-lines/
  run-tests.mjs`; logs `tests-after.log`, `tests-after-rerun.log`, `tests-base.log`, `compaction.log`):
  - 33 pass. Among them, `arc_thin_refine_ledger` (20/20) runs the extension with the ledger and refinements on, and
    `arc_thin_self_harness` (13/13) runs it with the ledger on in some cases and off in others.
    - `arc_thin_action_surface` (a 20 s Pi timeout) and `arc_thin_kernel` (600 s cap) failed on the first pass and
      passed when rerun alone.
    - `arc_thin_compaction` reads the worktree's own `node_modules`; it passed with a junction made for that run and
      removed after it.
  - 3 fail, identically on an untouched checkout of `5e998182`: `arc_thin_activation` (1 of 6), `arc_thin_components`
    (1 of 9), `arc_thin_receipts` (3 of 3). None of them imports the ledger, the critic or the extension.

### su15, in-sample

| Run | Levels | Cited definition: ledger mask / line mask / candidate | Ledger repeats | New repeats, decision by decision | Repeat or stall trigger decisions | Longest stall |
| --- | --- | --- | --- | --- | --- | --- |
| g61-1 (gpt-6.1-sol) | 4 | 16 / 23 / 23 | 1 → 5 | 1 → 5 | 0 → 1 | 5 → 12 |
| g56-1 (gpt-5.6-sol) | 1 | 36 / 66 / 66 | 0 → 6 | 0 → 5 | 0 → 1 | 25 → 25 |
| g61-2 (gpt-6.1-sol) | 2 | 4 / 19 / 19 | 1 → 4 | 1 → 4 | 0 → 0 | 9 → 29 |
| q38-1 (qwen3.8-27b) | 2 | 14 / 21 / 21 | 0 → 1 | 0 → 1 | 0 → 1 | 5 → 8 |
| g56-2 (gpt-5.6-sol) | 1 | 16 / 19 / 19 | 0 → 2 | 0 → 1 | 0 → 1 | 3 → 4 |
| q38-2 (qwen3.8-27b) | 1 | 1 / 1 / 1 | 0 → 0 | 0 → 7 | 0 → 0 | 10 → 18 |
| q38-3 (qwen3.8-27b) | 0 | 32 / 32 / 32 | 0 → 0 | 0 → 0 | 0 → 0 | 12 → 12 |

- The cited counts reproduce exactly, and the candidate gives the line mask's counts under that definition.
- The ledger's own repeats are fewer: they need the same result within the same attempt, and su15 attempts are short.
- Row 63 is masked from #14-#36 on in the first five runs, and at 57 of q38-2's 78 decisions. The only other lines
  masked are g61-1's row 52 and column 11, at #8 alone. Every new repeat's full grids differ in row 63 only, or not at
  all.
- In the replay, a repeat would have reached the refiner's `WHY NOW` at most once per run (g61-1 #105, g56-1 #80, q38-1
  #60, g56-2 #236). No stall line fired: the stall trigger needs 20 actions after the last refinement, and these runs
  refined at least every 15 actions while under their refinement budget. `data/ledger.md` would have shown a `REPEATS`
  line at 22, 26, 29, 4, 2, 10 and 0 decisions instead of 7, 0, 10, 0, 0, 0 and 0.

### Held-out games

| Game (records) | Lines masked, by content | Ledger repeats (sum) | False repeats: first version / candidate | Trigger decisions (sum) |
| --- | --- | --- | --- | --- |
| ls20 (15) | rows 61-62: a bar (11→3) beside the lives; first version also columns 34-38, the player's corridor, in 3 runs | 7 → 388 | 87 in 7 records / 0 | 4 → 45 |
| bp35 (6) | row 63: a bar (15 growing over 0) | 0 → 10 | 3 in 1 record / 0 | 0 → 4 |
| ar25 (2) | column 63: a bar (5 over 11) | 2 → 3 | 0 / 0 | 0 → 0 |
| ft09 (1) | row 63: a bar (12 beside 11), at 8 decisions | 0 → 0 | 0 / 0 | 0 → 0 |
| tu93 (1) | row 63: a bar (6 over 0) | 0 → 0 | 0 / 0 | 0 → 0 |
| ka59 (2) | none | 0 → 0 | 0 / 0 | 0 → 0 |

- N1 holds for the candidate: every line masked at any decision of a held-out record is a bar or status row.
- N2 holds for the candidate: no new repeat of the decision-by-decision replay has full grids that differ outside rows
  61-63. The first version fails both.
- ls20 is where the ledger changes most. Its agents bump walls and walk known corridors; behind the bar the ledger saw
  7 repeats in 15 records, now 388, and stalls of 21-84 actions in 8 records (none before). 11 of the 15 records have
  no refiner log, so their trigger counts rest on the replay's own notes.
  - Example: ls20-e1-A1 (qwen3.8-27b, 2026-10-16) played ACTION1, 2, 3 and 4 in turn from #1 to at least #42, back to
    the same position every four moves. The ledger it ran with saw no repeat. The candidate finds the first at #5, and
    reports #5-#13 at the decision after #13, when rows 61-62 first qualify.
- Three ls20 records have 25-50 ticker cells under both versions (multiples of the player's 5×5 size; not inspected
  further). No new repeat's grids differ in them.
- Variant with a denominator of transitions that changed something: also masks row 63 in su15-q38-2 and -q38-3 (q38-3:
  0 → 44 ledger repeats), column 63 in ar25-A1, row 63 in ft09, rows 61-62 in the one ls20 record left; nothing else.
  Not adopted here.

| Evidence level | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed | local Node 25.5.0 | the tests above (3 failing files fail the same way on `5e998182`); recorded grids replayed through both versions |
| Full chain | not run | — | no smoke (the user's rule for minor changes); the change is in a pure function on the existing path |
| Autonomous adoption | not tested | — | no run; whether the refiner or agent acts on repeat and stall lines is open |
| Net benefit | not tested | — | no run |

## Delivery decision

- **Supported.** On the recorded runs, the candidate masks the bars of su15, ls20, bp35, ar25, ft09 and tu93 and
  nothing else for more than one decision, makes the ledger's repeats and stalls visible behind them, and merges no
  states that differ outside status lines.
- **Not supported.** That the extra repeat and stall lines help: in su15 they would reach the refiner about once per
  run, and nothing shows yet what a refinement does with them.
- **Decision.** Waiting for the user: merge the candidate into `claude/r04-20261017` as one commit, or not.
- **Next falsifiable check**, in the next authorized r04 run: count repeat and stall triggers, the refinements they
  start, and repeated moves in the 10 actions after each such refinement against the 10 before. No fewer repeats after
  them would mean the signal reaches the refiner without effect.
- **Related.**
  - `MoveFacts.busy` in `demo/arc_thin_coverage.ts` (`claude/r04-cov-20261019`, not yet on r04) defines busy lines over
    the moves that changed something, with no ticker exclusion and no one-way condition. A player walking a corridor
    would make its columns busy there too. Once both are on r04, one definition should serve both.
  - [Deferred research todos](../deferred-research-todos.md) (moving derived features such as an effect ledger to the
    agent's side): unchanged. The ledger stays a runtime service by the user's 2026-10-19 division of roles.
