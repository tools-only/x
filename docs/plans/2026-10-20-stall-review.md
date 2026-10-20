# Stall review and prompts/review.md, 2026-10-20

Date: 2026-10-20 (Asia/Shanghai). Status: implemented on `claude/r04-ch-20261020` (folded into `claude/r04-20261017`),
on by default in native runs; kept when r04 took the other Continual Harness implementation (`ARC_THIN_OBSERVATION=ch`,
`docs/plans/2026-10-20-ch-observation-adapter-alignment.md`, "Merge"); one real run, su15-chm-q38-1 (below). Record format:
`docs/templates/meta-harness-change.md`.

## Problem and claim

- **Request.** After su15-ch-q38-1 (below) the user rejected blocking repeated actions as the answer: "Duplicate-action
  blocking is neither a fundamental fix nor sufficiently general. A sound mechanism should work as follows: when no task
  progress is observed over an extended period, the ledger, refiner, critic or similar components notify the agent to
  review recent and historical trajectories, summarize current problems and bottlenecks, and identify directions for
  improvement."
- **Failures on record.** su15-ch-q38-1 (2026-10-20, qwen3.8-27b, thinking off, the first Continual Harness version,
  no-effect refusal off): 53 actions, 0 levels; the same click 25 times (2 cells changed each) into GAME_OVER at #34, and
  no step back before or after it. On the earlier path, the level-2 openings in
  `docs/plans/2026-10-20-level-review-lessons.md` show the same shape over longer stretches: "the same two moves and
  RESET, six times" (#39-#55, arc-su15-20261020), clicks that changed only the bar (#36-#51, su15-q38-2), 22 moves
  walking a square toward one target (#64-#85, su15-p13-q38-1), and in arc-su15-20261020 no new win condition after
  #30 until the run ended in identical trajectory reads and RESETs. The runner's only reviews were the GAME_OVER
  consolidation (memory upkeep, no record of the level) and, since 2026-10-20, the level review, which needs a level to
  be completed first.
- **Narrow claim.** When a native run has played `stall_review_after` actions (default 40) without completing a level,
  counted from the level's first action or the last stall review, the agent gets one turn without actions, with the
  record of the level so far in front of it, to rewrite its own `prompts/review.md`: what it tried and what each try
  showed, the bottleneck, what wasted actions, and 2-4 directions not tested yet, each with the move that would show it.
  The file is an active prompt, so it is in front of every later decision. Then, within the next 15 actions, the agent
  tests a direction it listed; same-move repeats without effect fall below the pre-review stretch's rate; a review costs
  under 0.15M budget tokens.
- **Burden removed.** Stepping back from a failing line no longer depends on the agent noticing it mid-decision under
  action pressure; the count is mechanical, and the record (attempts, repeated results, hypothesis checks, repeated
  python) is assembled by the runtime instead of re-read by hand.
- **Falsifiers.** `prompts/review.md` is not written or not loaded; none of its directions is tested in the next 20
  actions; repeats continue at the same rate; a review costs over 0.3M budget tokens; matched forks with the review off
  complete as many levels at lower cost. **Reasonable non-use:** a level completed within 40 actions never triggers
  it; a direction already under test when the review comes may be kept as the first one.
- **Scope.** The runner's trigger and prompt, the extension's handling of the turn, the record it shows, refinements'
  read-only access, accounting. Not in scope: blocking or rate-limiting repeats (the no-effect refusal is off by default
  with `ARC_THIN_OBSERVATION=ch`; `ARC_THIN_NO_EFFECT_REPEATS=3` turns it on), and any judgment of the record by the
  runtime.

## Design and cost

- **Reuse.** The runner's review slot (the consolidation path that the level review uses), `levelRecord` from
  `demo/arc_thin_level_review.ts` with `ongoing: true` (the level on screen: no completing move, hypotheses "open now"),
  the binder's active prompts, the level review's bound (`LEVEL_REVIEW_CALLS` = 8). No new tool, field, action gate or
  worker.
- **Who does what.** The runner counts and prompts (mechanical); the ledger supplies the repeated results (moves that
  gave an earlier move's result again from the same state), the claim checks the hypothesis verdicts, coverage the
  attempts, the component log the repeated python; the agent reads, judges and writes. Refinements read
  `prompts/review.md` (it is in their input) and never write it (refused like `prompts/lessons.md`).
- **Trigger and priority** (`src/autoresearch_pi/arc_thin_e2e.py`): due when `len(trajectory) - max(level start, last
  stall review) >= stall_review_after`. A level review comes first when both are due (a level change also restarts the
  count); a due stall review takes the place of the GAME_OVER consolidation; otherwise it is its own turn. A fork
  continues its source's count (the last `stall_review` row of the copied working-set log).
- **Prompt.** `STALL_REVIEW_PROMPT` names the level, the count and what it runs from, and asks for the four parts in
  one write, under 1,200 characters, then for memory entries the record contradicts to be corrected or deleted. A length
  stop resumes with `STALL_REVIEW_RECOVERY_PROMPT`. The extension shows the record in place of RECENT ACTIONS; with
  `ARC_THIN_OBSERVATION=ch` the game is shown as CH's CURRENT STATE beside it, and what happened since the last decision
  is left for the next decision.
- **After the level.** The level review of a completed level notes an active `prompts/review.md`: the agent deletes it
  or keeps in `prompts/lessons.md` what still helps. Nothing deletes it automatically.
- **Added and removed.** Resident: one clause in the system prompt's Prompt line (the native template); the file
  itself while active (≤ 1,200 characters asked; the write receipt says when it is longer). One review turn per 40
  stalled actions, at most 8 tool calls. Config: `stall_review_after` (`--stall-review-after`, `ARC_THIN_STALL_REVIEW`
  for pilots; 0 turns it off; the legacy foundation and the control variant have none), recorded in run-config.json;
  `summary.stall_reviews` (count) and `summary.harness.stall_reviews` (per-turn requests and budget tokens, review.md
  versions and size).
- **Integrity.** Review turns take no action (arc_action inactive, env.act refused, the gate's consolidation refusal);
  budgets and the token cap are unchanged.

## Experiment protocol (not run)

- Target layer: autonomous adoption and net benefit on su15 level 2 with qwen3.8-27b (thinking off, images,
  `ARC_THIN_OBSERVATION=ch`, the native default).
- Comparison: matched-prefix forks from the start of a level the source run lost, stall review on vs off
  (`ARC_THIN_STALL_REVIEW=0`), everything else equal; 2 forks per arm; 1.5M budget tokens per fork (6M total).
- Primary: level completed within the budget. Secondary: actions from a review to the first test of a listed
  direction; same-move-no-effect repeats per 10 actions before and after; review cost; review.md written/loaded.
- Negative cases: a fork whose level is completed before the 40th action (no review; counts as non-use, not failure).

## Implementation and checks

- `src/autoresearch_pi/arc_thin_e2e.py`: `STALL_REVIEW_PROMPT`, `STALL_REVIEW_RECOVERY_PROMPT`, `STALL_REVIEW_AFTER`,
  `_stall_review_after`, `_level_start`, `_stall_review_due`, `_stall_review_prompt`, `_review_recovery`, `_review_stats`;
  the loop's trigger and priority. `src/autoresearch_pi/cli.py`: `--stall-review-after`.
- `demo/arc_thin_extension.ts`: `run.stallReview` for "STALL REVIEW" and "RECOVER STALL REVIEW" prompts, the record in
  place of RECENT ACTIONS, the 8-call bound, `stall_review` in working_set.jsonl, review.md in the refiner's input and
  refused as a refinement edit, the length note on write. `demo/arc_thin_native_context.ts`: a stall-review recovery stays
  in its decision. `demo/arc_thin_level_review.ts`: `REVIEW_PATH`, `levelRecord({ongoing})`.
- Checks (node 22, this machine, 2026-10-20): `tests/test_arc_thin_stall_review.py` (default, due counting from the
  level start and the last review, prompt text, recovery, stats); `tests/arc_thin_level_review.test.ts` (the ongoing
  record); `tests/arc_thin_ch_observation.test.ts` (a STALL REVIEW turn: record and current state shown, arc_action
  inactive, the observations left for the next decision, review.md then a system-prompt section).

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passing unit tests | none (offline) | the tests above |
| Full-chain reachability | reached twice | yibu qwen3.8-27b, thinking off, su15, r04 `305ca1b0` | `runs/arc-chm-20261020/su15-chm-q38-1`: STALL REVIEW at 40 and 80 actions (decisions 20, 53) |
| Autonomous adoption | partial | same run | review.md written both times (6 versions, 1,190 chars) and loaded; 3 of the first review's directions tested within 3 actions; none of the second's in the 30 actions left |
| Net benefit | none in this run | same run | 0 levels (level 1's 110-action budget ran out); one run |

## Run su15-chm-q38-1 (2026-10-20)

Against the falsifiers above: review.md was written and loaded (not falsified); the first review's directions were
tested (#41-#43) but the second's were not in the 30 actions that remained (falsified for that review); repeats did not
fall: after the second review the agent clicked ACTION6(31,5), which changes nothing, 30 times in a row (falsified); the
reviews cost 98k and 170k budget tokens (under the 0.3M falsifier; the second over the 0.15M aim). The reviews were
accurate: the second named the loop ("Been REPEATING known objects instead of exploring untested ones", the square
"confirmed dead (9 clicks, 0 change)"). The decisions after it reproduced the decision before the review verbatim: the
same two python cells and the same arc_action call, 46 calls identical to the one before them in the run, against none
in the earlier qwen su15 runs, where the no-effect refusal answered the fourth unchanged click. A review between such
decisions changes an active prompt, not the decision's immediate context, and here that was not enough. Details and the
next checks: `docs/plans/2026-10-20-ch-observation-adapter-alignment.md`, "Run of the merged version".

## Decision

- Supported: the trigger, prompt, record and accounting work as specified, offline and in one real run; qwen writes an
  accurate review.md. Not supported: that the review changes what the agent does once its decisions copy each other, or
  that it gains levels.
- Next falsifiable check: the checks listed in the alignment record's run section, after the user chooses one and
  approves a budget; the fork pair above is still open.
- Backlog: relates to deferred item A (adapter boundary) only through the no-effect refusal being off by default with
  `ARC_THIN_OBSERVATION=ch`.
