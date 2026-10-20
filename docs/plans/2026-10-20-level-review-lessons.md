# Level review and prompts/lessons.md, 2026-10-20

Date: 2026-10-20 (Asia/Shanghai). Status: implemented and checked offline; real runs await the user's budget (protocol
below). Branch `claude/zen-dewdney-513a92`, cut from `claude/r04-20261017` at `fd306b9c` and folded back into it.
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

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | passed | node tests with the real extension, HTTP stand-in bridge, WASI, scripted refiner; pytest | `C:/Users/qi/tmp/lessons/out/full`, `t1`-`t7`, `records.txt` |
| Full-chain reachability | not run | — | no smoke (the user's rule); the first real run is the check |
| Autonomous adoption | unverified | — | needs the runs above |
| Net benefit | unverified | — | needs the runs above |

## Decision

Implemented with the review on by default. Real runs wait for the user's budget. Until then the claim is unverified at
every layer above function.

## Related backlog

`docs/deferred-research-todos.md` D ("评估归档前语义 consolidation"): this is a per-level semantic consolidation written by
the agent into a versioned prompt; it does not touch compaction or checkpoints. Its status does not change on this
evidence.
