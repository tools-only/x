# Level review and prompts/lessons.md, 2026-10-20

Date: 2026-10-20 (Asia/Shanghai). Status: implemented; evaluated on four matched-prefix forks (results at the end): the
claim fails for qwen3.8-27b, gpt-6.1-sol kept its source's four levels in the same budget. Branch
`claude/zen-dewdney-513a92`, cut from `claude/r04-20261017` at `fd306b9c` and folded back into it (fast-forward to
`1a1a763d`; another session then merged it into its Continual Harness alignment, `4985fedb`; the dispute fix found by the
evaluation is `9e6a9a45` on r04).
The user asked for it as "optimize 2" (the level-completion review) with five points; this record follows
`docs/templates/meta-harness-change.md`.

## Problem and claim

### What the recorded runs show

The second level of su15 is where qwen3.8-27b stops: of the five recent qwen runs that reached it, one completed it.
How each run opened that level (first 30 actions after the first level change; `C:/Users/qi/tmp/lessons/level2.mjs`,
outputs `out/l2-*.txt`):

| Run (model) | Level 1 at | Level 2 | Win conditions tested in level 2's first 30 actions | From level 1's win |
| --- | --- | --- | --- | --- |
| su15-cb-q38-1 (qwen, bc4761a5) | #20 | lost (210 actions) | 1: a piece overlapping the circle (#49, predicted) | yes |
| su15-q38-1, arc-su15-20261020 (qwen, bc4761a5 + studio edits) | #26 | lost (154 actions, provider refusal) | 2: all dots cleared (#31, predicted); a block placed on the blob (#39-#55: the same two moves and RESET, six times) | the second |
| su15-q38-1, arc-models-20261019 (qwen) | #40 | completed at #151 (111 actions) | 3: one block in the blob (#46-#47); every block in it (#58-#66); the first level's token colour at its centre (#68, predicted) | all three are variants |
| su15-q38-2, arc-models-20261019 (qwen) | #21 | lost (210) | 0 (no move predicted a level change; #36-#51 clicks that changed only the bar) | — |
| su15-p13-q38-1 (qwen) | #57 | lost (210) | 1: the square reaching the circle (#64-#85, 22 moves walking a square toward it) | yes |
| su15-g61-1 (gpt-6.1-sol) | #22 | completed at #38 (16 actions) | 2: the central target itself (#27, predicted, failed); the required block delivered to the goal (#38, predicted, won) | the first |

A win condition counts when the agent played a move that it said (prediction, note or predict text) would complete the
level under that condition; variants that differ only in position count once. Read by hand; the rows quote the moves.

- **The first level's win stands as a rule.** In su15-cb-q38-1 the refinement at the level change (#20, "level 1
  reached") wrote `prompts/rules.md` v2 with "Level completes when the blue square reaches/overlaps the red-circle region"
  and then `hyp.reach_circle_goal` ("A level is completed when ..."): both general. Its check returned None for any move
  that changed fewer than 50 cells, so the failed test at #49 never contested it. In su15-p13-q38-1 the agent itself
  wrote the fact "CONFIRMED WIN CONDITION: ... When the 15-square reaches/overlaps the 9-diamond, the level completes"
  (#57); in arc-su15-20261020 it wrote "LEVEL 0 WIN: walk the 3x3 blue square ... to the red blob's core" (#26).
- **No review at the level change.** The native foundation has had no forced review after a level change since
  2026-10-12 (`docs/plans/2026-10-12-harness-foundation-refactor-plan.md`, decision D2: "the claims re-check on new
  moves and continuity cover it"). The runs above show they did not: the goal checks did not fail on level 2, and the
  carried-over belief was tested first and longest. arc-su15-20261020 ran 0 review turns; per the outside analysis its
  agent never proposed another win condition after #30 and ended in identical trajectory reads and RESETs.
- **The strong model abstracts.** gpt-6.1-sol tested the obvious target, saw it fail, merged pieces and delivered "the
  required" one: a pattern (bring the right piece to the goal), not the literal first-level move.
- **The review slot exists and is costly when unbounded.** Native GAME_OVER reviews (CONSOLIDATE prompt, no tool-call
  cap) cost 53k-337k budget tokens in the runs on record, median 141k, with 7-18 agent requests (the refinement that ran
  in the same turn included): su15-cb-q38-1 131k and 215k, su15-p13-q38-1 53k and 92k, arc-models su15-q38-1 141k, 275k,
  337k and 92k, su15-g61-1 315k (`C:/Users/qi/tmp/lessons/reviews.mjs`, `out/reviews-*.txt`). In su15-cb-q38-1's first
  GAME_OVER review qwen wrote its own rules prompt with "# Level 1 (CONFIRMED)" and "# Level 2 (PARTIAL)" sections: with
  a review turn it does scope.

### Claim

At each level change the agent gets one turn without actions, with the completed level's record in front of it, to
rewrite its own `prompts/lessons.md`: how the win was found, the win condition literally (that level only) and as a
pattern, what moved progress, what wasted actions, and 2-4 candidate win conditions for the next level. The file is an
active prompt, so it is in front of every later decision. Then, on the next level, qwen tests more than one distinct win
condition in its first 30 actions, mostly ones it listed, and completes the second level more often than 1 in 5; each
review costs about 0.1M budget tokens.

Burden removed: on a new level, under action pressure, the agent no longer has to recall unaided that the last win was
specific to its level and invent alternatives; that moves to a turn with no action budget at stake and the record shown.

Falsifiers: the second level stays unsolved and its first tests look like the rows above (one carried-over condition);
`prompts/lessons.md` is not written, or not loaded; its candidates are not the ones tested; a review costs more than 0.3M
budget tokens. Reasonable non-use: on a level whose first candidate wins at once, the other candidates go untested.

Scope: the runner's review after a level change, the extension's handling of that turn, the record it shows, the
refinements' rule after a level change, and accounting. Not in scope (the user's list): the cross-decision loop guard and
the agent-owned observation layer. The GAME_OVER review is unchanged.

## Design and cost

Reused slots: the runner's review turn (`CONSOLIDATE` path), the binder's active prompts (bound at each decision start and
sent as system-prompt sections), the refinements' one return (`NOT APPLIED`, as for unchanged files and coverage events).
No new tool, field, action gate or worker.

1. **The review is on for the native foundation, with its own prompt.** `review_at_level_change` now defaults to on for
   both foundations (`--no-level-change-review`, or `ARC_THIN_LEVEL_REVIEW=0` for pilots, turns it off). After a level
   change the native runner sends `LEVEL_REVIEW_PROMPT` (legacy keeps CONSOLIDATE): rewrite `prompts/lessons.md` whole in
   one write call, under 1,200 characters, with the frontmatter shown; (1) how the win was found, after how many of the
   level's actions; (2) the win condition literally, marked "(level N only)", and as a pattern; (3) what moved progress;
   (4) what wasted actions (rituals, repeated reads, beliefs kept too long); (5) for the next level, 2-4 candidate win
   conditions with the move that would show each, the last level's pattern being one candidate, not a rule; keep earlier
   lessons only where they help; scope or delete memory that states the win as a general rule. Its length and stall
   recoveries are `RECOVER LEVEL REVIEW`. The turn has no `arc_action`, and `env.act` is refused, as in every review.
2. **The runtime supplies the record** (`demo/arc_thin_level_review.ts`, shown instead of "ACTIONS SINCE YOUR LAST
   REVIEW"): the level's span, action count, attempts, RESETs and GAME_OVERs; the completing move, its number within the
   level, its change, note and prediction; the other moves that predicted a level change; every move by attempt
   (`ACTION6(33,27)→2`, `*` when it predicted a level change; equal consecutive moves counted; consecutive attempts that
   played the same moves to the same end on one line, which is how a ritual shows); the hypotheses written, checked or
   deleted on the level, whose they are, how each stood at the end (rejected at #n, deleted at #n, status) and its check's
   results on the level; moves that gave an earlier move's result again from the same state (the ledger's repetitions,
   status cells masked); python run again with the same code (numbers aside), comment-only cells named as such. Counting
   and listing only. Replayed on 13 completed levels of 7 recorded runs (`C:/Users/qi/tmp/lessons/record.ts`,
   `out/records.txt`): 1.0k-4.9k characters.
3. **The file is pushed and rewritten.** `prompts/lessons.md` with `active: true` is bound and sent like the strategy and
   rules prompts; the system prompt's prompt line names it ("your review of the last level you completed, rewritten at
   each level change", +97 characters). It is the agent's: refinements read it (their input gains it, up to 2,400
   characters) and a refinement's FILE reply for it is refused. A save over 1,200 characters gets a note in its receipt;
   nothing truncates it.
4. **The level-change refinement scopes its rule.** The refiner's charter: a goal rule only after a level change
   confirmed it, "and for that level only: '- Level N: <how level N was won> (hyp.<name>)'; a line added after a level
   change names its level". A refinement started by a level change whose rules-prompt reply adds a rule line without
   "level <digit>" goes back once with the reason; the second reply is used as it comes. The agent's own writes to the
   rules prompt are not checked.
5. **Cost is bounded and reported.** A level review may make 8 tool calls; the eighth result says it is the last, a
   ninth ends the turn. `summary.json` gains `level_reviews` (count) and `harness.level_reviews` (per review: requests,
   budget tokens; lessons versions saved and failed, current size).

Two fixes so that a fork from a level's snapshot replays what the source run would have done next: the fork starts with
the level review (the runner reads whether the snapshot's last action changed the level), and the level-change refinement
still fires after a restart (`refinedThrough` restarts before a level change that no refinement has started since;
before, events up to the restart were treated as refined, so a fork from a level snapshot never refined that level change).

Added per run: one turn per completed level (expected 2-5 requests; the first carries the whole context, about 45-100k
tokens for qwen when the provider cache misses), the prompt (about 1k characters) and record (1-5k) once per level,
up to 1.2k characters of lessons per request from the second level on, 97 characters of system prompt per request, up to
2.4k characters per refinement input, at most one extra refiner call per level change. Estimated 0.05-0.3M budget tokens
per level (the uncapped GAME_OVER reviews: median 141k); for gpt-6.1-sol, whose requests rarely hit the cache, toward the
top of that range, four times in a four-level run. Removed: nothing.

Abandon or roll back: `ARC_THIN_LEVEL_REVIEW=0` (or `--no-level-change-review`) restores the previous native behaviour
except for the scoped refinement rule and the restart fix, which stay.

Lifecycle: opportunity (a level change, mechanical) → the runner starts the review (mechanical) → the extension shows the
record (mechanical) → the agent writes its lessons (semantic, the agent) → the binder sends them at every decision
(mechanical) → the agent chooses which candidate to test (semantic) → the next level change: the agent rewrites the file
(semantic). The refinement reads the file and never edits it.

## Pre-run protocol

- Evidence level: autonomous adoption and outcome on the second level, real provider and real ARC (su15).
- Settings as in `C:/Users/qi/tmp/r04/cov/launch-cb.cmd`: `tools/arc_ls20_loop_pilot.py`, yibu, su15, qwen3.8-27b with
  thinking off (qwen dialect); gpt-6.1-sol with reasoning medium (openai dialect); 6M budget-token cap, no action cap
  beyond the game's per-level budgets, no time cap, snapshot at level 1. Source: this branch's commit (the pilot refuses
  `worktrees/r04` while the studio session's files are uncommitted there).
- Arms, proposed to the user (budget to be confirmed before any run):
  - A, matched prefix (recommended): forks from the level-1 snapshots of su15-cb-q38-1 (`after-decision-20`) and
    arc-su15-20261020 su15-q38-1 (`after-decision-13`), both on the base code apart from this change, plus
    su15-p13-q38-1 (`after-decision-35`, a3ad22e8: also without the busy-lines, C and B changes). Each fork replays level 1
    (no model tokens), starts with the level review, and plays until level 2 is completed (`MAXLEVEL=2`) or its 210
    actions are spent; the comparator is the source run's own level 2 (same state, same model). Their level 2 cost 3.3M,
    2.4M (cut short) and 4.4M budget tokens. gpt-6.1-sol: a fork of su15-g61-1 (`after-decision-18`) with a cap of 5.80M,
    the source's remaining budget (its 6.08M less the 0.20M prefix), no level stop; comparator: its 3 further levels.
  - B, fresh runs as first proposed: 2-3 qwen runs and 1 gpt-6.1-sol run, 6M each; comparators: the five qwen runs above
    (level 2 completed in 1 of 5) and su15-g61-1 (4 levels).
- Measures, per run: on the second level, the distinct win conditions tested in its first 30 actions (rule above), how
  many are among the candidates in `prompts/lessons.md`, the actions to complete it, and whether it was completed; per
  review: requests, budget tokens, whether the file was written and loaded, its size, tool calls used; refinement
  returns for unscoped rules and what the second reply wrote; budget tokens per action against the source run.
- Decision rule, fixed now: the claim is supported if level 2 is completed in at least 2 of 3 qwen arms; adoption
  without outcome if at least 2 of 3 test at least 2 distinct win conditions in level 2's first 30 actions, one of them
  from the file; it fails if level 2 stays unsolved in every arm and the early tests look like the rows above. A review
  costing more than 0.3M budget tokens counts against it whatever the levels. gpt-6.1-sol: no fewer levels than its
  source within the same budget. Three runs separate only large effects; su15 shaped the change (in-sample).

## Implementation and verification

- Files: `src/autoresearch_pi/arc_thin_e2e.py` (prompts, default, prompt choice, recovery, fork, summary),
  `src/autoresearch_pi/cli.py` (help), `demo/arc_thin_level_review.ts` (new: the record), `demo/arc_thin_extension.ts`
  (the review turn, its cap, the record, the refinement's input, return and refusal, the receipt note, the restart),
  `demo/arc_thin_native_context.ts` (a level-review recovery stays in its turn), `demo/arc_thin_refiner.ts` (charter),
  `demo/prompts/arc_thin_native_system.md` (one clause). Tests: `tests/arc_thin_level_review.test.ts` (3),
  `tests/test_arc_thin_level_review.py` (5).
- Functional checks: the record on synthetic rows (attempts collapsed, completing move, goal tests, hypotheses, repeats,
  python); the real extension with an HTTP stand-in bridge, the WASI sandbox and a scripted refiner: the review turn has
  no `arc_action`, shows the record, logs `level_review`; the level-change refinement's unscoped rule goes back once and
  the scoped one is written; the agent's `prompts/lessons.md` is saved, loaded and in the next two decisions' system
  prompt; the eighth call says it is the last and the ninth ends the turn; a restarted run refines the level change it
  starts after (this test failed with the old restart rule, as it should). Runner: default and switch, prompt text,
  recovery mapping (also through the idle recovery), fork flag, summary statistics.
- Results (`C:/Users/qi/tmp/lessons/out/`): `arc_thin_level_review` 3/3; pytest 29/29 (`test_arc_thin_level_review`,
  `test_arc_thin_recovery`, `test_arc_foundation_config`, `test_arc_thin_lifecycle_stats`, `test_arc_thin_request_accounting`).
  Full thin suite, one file at a time: 39 files, 218 tests, 212 pass. The 6 failures: activation 1, components 1 and
  receipts 3 fail the same way in `worktrees/r04` (base, rerun today), and `arc_thin_action_surface` timed out starting
  Pi on its first runs (2/2 on two reruns).
- The dispute fix (`9e6a9a45`, after the forks): its test failed first (5 dispute refinements for 5 failing moves) and
  passes after; `arc_thin_promotion` 9/9, `arc_thin_claims` 8/8, `arc_thin_refine_ledger` 20/20,
  `arc_thin_coverage_events` 3/3 (`t8`, `t9`). On r04 after the Continual Harness merge: `arc_thin_level_review` 4/4,
  `arc_thin_ch_mode` 7/7, pytest 18/18 (`t10`).

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | passed | node tests with the real extension, HTTP stand-in bridge, WASI, scripted refiner; pytest | `C:/Users/qi/tmp/lessons/out/full`, `t1`-`t10`, `records.txt` |
| Full-chain reachability | passed | real su15 (online ARC), yibu, the real runner, Pi, bridge and refiner | 4 of 4 forks below |
| Autonomous adoption | partial | qwen3.8-27b thinking off; gpt-6.1-sol medium | below |
| Net benefit | not shown | same | below |

## Results of the forks (2026-10-20, r04 `1a1a763d`, `runs/arc-lessons-20261020`)

The user chose arm A and its budget (cap 23.8M). The four forks were launched from `C:/Users/qi/tmp/lessons/launch-lr-*.cmd`
with the clean worktree at `1a1a763d` as the pilot's source (the r04 worktree held the studio session's uncommitted
files). Spent after the fork points: 16.3M budget tokens (cb 4.02M, 1020 4.46M, p13 2.02M, g61 5.85M). Measures:
`C:/Users/qi/tmp/lessons/compare.mjs`, `cache.mjs`, `kinds.mjs`, `reviews.mjs`; outputs `out/compare-final.txt`,
`cache-final.txt`, `kinds-final.txt`, `rv-lr-*.txt`.

| Fork (source) | Level 2 in the fork | in the source | Win conditions tested in level 2's first 30 actions, fork / source | Agent budget tokens per level-2 action, fork / source | Fork ended by |
| --- | --- | --- | --- | --- | --- |
| su15-lr-cb-q38 (su15-cb-q38-1) | not completed in 203 actions, 6 GAME_OVER | not completed in 210, 2 GAME_OVER | 1 (#24: "possibly level completes when all dots are gone") / 1 (#49) | 17.0k / 15.3k | the bridge's `/state` timed out at #223 (harness_fatal) |
| su15-lr-1020-q38 (su15-q38-1 of 10-20) | not completed in 210 actions, 48 RESETs | not completed in 154, 38 RESETs | 0 / 2 | 20.1k / 14.8k | level 2's 210 actions spent |
| su15-lr-p13-q38 (su15-p13-q38-1) | not completed in 27 actions | not completed in 210 | 0 / 0 | 53.6k / 20.2k | three gateway refusals of repeated identical calls |
| su15-lr-g61 (su15-g61-1, gpt-6.1-sol) | completed at its 12th action | completed at its 16th | 1 (#34, won) / 2 (#27, #38) | 5.8k / 9.7k | the token cap, 91 actions into level 5 |

gpt-6.1-sol level by level, fork / source: level 2 in 12 / 16 actions, level 3 in 20 / 17, level 4 in 121 / 138 (5 / 7
attempts); within the same budget the fork reached the same four levels (#175 against #193) and played 91 actions of
level 5 before the cap. Its code also differs from the source's (P1-P3, busy lines, C and B came in between).

**The review turn.** It ran in all four forks, first thing after the fork point, and at each of gpt's three later level
changes. Cost: qwen 42.7k, 48.1k and 83.5k budget tokens (9 requests each); gpt 18k, 23k, 18k and 127k (2-4 requests).
Every review wrote `prompts/lessons.md` and every version loaded. qwen's first versions were 1,568, 1,958 and 2,135
characters; after the receipt's size note it rewrote them to 690, 1,425 and 1,344, and in 1020 and p13 then wrote the same
text twice more ("unchanged"): the note costs qwen up to four write calls and does not get it under 1,200. Each file kept
the literal win under its level (a level heading, "L1 only") and wrote a pattern; qwen listed 4 candidates (with test
moves in 1020 and p13), gpt 3-4 with moves. In the cb review qwen also rescoped its memory fact ("Level 1 (complete):
...") and rewrote the rules prompt without the win line.

**Adoption.** qwen's first candidate was always the first level's pattern ("same pattern: carry a square along the path
to the blob"), and the early play followed it (cb, p13) or probed candidates as mechanics (1020: top squares, the blob
centre) without saying any move would complete the level: none of the three qwen forks predicted a level change in level
2's first 30 actions, where two of the three sources did. In cb the agent kept rewriting `prompts/lessons.md` during level
2 (10 versions), turning it into its record of rejected win conditions ("all blocks in circle → NO WIN; blue square
reaches circle → NO WIN; one block fully in circle → NO WIN; bar depletion → GAME_OVER"); it ended concluding the level
"PROVABLY UNWINNABLE". gpt-6.1-sol's patterns were right and carried forward: after level 2 "progressively merge matching
pieces and deliver the resulting piece", after level 3 "complete multiple marked destinations with progressively merged
pieces", after level 4 "merge matching pieces into a required final color, then deliver it to a marked destination".

**The rule a level-change refinement writes.** No fork's rules prompt held a level's literal win as a general rule. The
return fired in cb and p13 (first replies added unscoped mechanics lines; in cb the first reply had already scoped its win
line). In 1020 the refinement wrote "- Level 0: ..." in the agent's 0-based numbering. In p13 the scoped line cited
`hyp.merge_migrates_15`, a level-1 check that failed on every level-2 move; the dispute event was raised again at each new
failing move: 18 refinements in 27 actions, the rules prompt (and with it the system prompt) rewritten almost every action,
the first request of 20 of 27 decisions missed the provider's cache (33 of 111 in the source), 2.7 times the source's cost
per action. Fixed for later runs in `9e6a9a45`: a rule in dispute is raised once per check version and level (test: 5
refinements before, 1 after). Not run since.

**Cost.** Reviews: 18k-127k, median about 45k, inside the 0.3M bound. Agent cost per level-2 action rose in the qwen forks
(+11% cb, +36% 1020, +166% p13), and fell for gpt (-40%). Besides p13's thrash, the qwen forks played many more decisions
per action than their sources (cb 145 decisions for 203 actions against 65 for 210; 1020 218 for 210 against 88 for 154):
fewer `then` chains, a difference in play this design cannot attribute.

**Against the rule fixed before the runs.** qwen: level 2 completed in 0 of 3 forks (the sources: 0 of 3), and the early
tests did not widen (1, 0, 0 against 1, 2, 0): the claim fails, and the adoption-without-outcome condition is not met
either. gpt-6.1-sol: no fewer levels than its source in the same budget: met, with no extra level. Review cost: met.

Where qwen's level 2 breaks, from these runs: it lists alternatives but does not turn them into goal tests (no predicted
level change in 30 actions in any fork); it repeats rituals (1020: 48 RESETs, the same probe of the blob centre six times);
it loops on identical reads until the gateway refuses (p13, the cross-decision loop, out of scope here); it holds the first
level's pattern first and longest. The review moved the literal win out of the rules and gave the agent a place it used as
a hypothesis log in one run of three; it did not change which experiments qwen ran first.

Limits: one fork per source; su15 shaped the change (in-sample); the forks ran `1a1a763d`, before r04 made the Continual
Harness mode the default (`e79898f9`; in that mode `prompts/lessons.md` opens the working prompt, `4985fedb`), so behaviour
on r04's current default is untested; two qwen forks ended on environment or gateway failures (cb at #223 of 230, p13 at
#84).

## Decision

The pre-registered rule says the claim fails for qwen. The change stays on by default on r04 pending the user's choice:
keep it (it does what the five points asked, costs about 45k per level, keeps the literal win out of the rules, and
gpt-6.1-sol writes lessons that match the game), switch it off (`ARC_THIN_LEVEL_REVIEW=0` in the pilots), or revise one
factor. A revision would target the transition that broke, candidates → goal tests, not more review content; and the size
note could go (it costs qwen up to four rewrites). Next falsifiable check if kept: on r04's current default, a qwen fork
from the same snapshots predicts a level change for at least one listed candidate within level 2's first 30 actions.

## Related backlog

`docs/deferred-research-todos.md` D ("评估归档前语义 consolidation"): this is a per-level semantic consolidation written by
the agent into a versioned prompt; it does not touch compaction or checkpoints. Its status does not change on this
evidence.
