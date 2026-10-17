# Merge check: the r03b-simple line with the refinement ledger and the repeat fixes

Imported into `claude/r04-20261017` on 2026-10-17, as committed on `claude/merge-20261017` (`a595bf01`); unchanged
below. Superseded by r04, which brings the ledger onto the r03b line instead ([r04 plan](2026-10-17-r04-version-plan.md)).

Date: 2026-10-17 (Asia/Shanghai). Status: merged and checked offline on `claude/merge-20261017` (worktree
`worktrees/merge-20261017`); not run on ARC. Follows [the development workflow](../development-workflow.md).

User request (2026-10-17): "combined with [the session on r03b and Continual Harness context management], check if they
can merge together and optimize until the version can solve ARC in the certain level". That session's lines are
`claude/r03b-simple-20261015` (this branch's base, [record](2026-10-15-r03b-simple-context-plan.md)) and
`claude/r03b-repeat-20261016` (from `r03b`, [record](2026-10-16-provider-repeat-refusal.md)); this session's is
`claude/refiner-ledger-20261016` ([record](2026-10-16-refinement-ledger.md)).

## What was merged

- Base: `claude/refiner-ledger-20261016` (`693272bc`) = the simple line at `1d60dcf1` + the ledger, EXPECT and
  `ARC_REFINE_MODEL`.
- `claude/r03b-simple-20261015` merged (`7fe9184e`): its two later commits are docs only (R1).
- The repeat branch's three commits cherry-picked (`-x`), not merged: the branch starts from `r03b`, whose one commit
  over `deecdde6` (`cf419ec3`) is a hand port of the environment restart this line already has (`af976326`); a merge
  would bring the same feature twice.
  - `f581f918` → `c32a1cd4`: collapse of repeated calls in the frozen history, the stop after 3 identical provider
    errors. Conflicts in three files, each the two sides' additions next to each other: the extension's history
    options (the history window's settings and `collapseRepeats` both kept; the frozen history is collapsed, then
    bounded), the runner's run-config and its loop (the provider-error stop placed before the level snapshot), the smoke
    provider's script table. `canonical` was already exported here (r5).
  - `5751333a` → `8eec7e7d`: clean.
  - `95a3803f` → `365669f8`: the loop guard counts calls that succeeded with the same result. One conflict at the call
    site: the simple line's r5 records the call that ended a decision (refused in the next decision while nothing
    changed); both kept, so a decision ended by three identical successful calls also has that call refused at the next
    decision's start. That closes the gap the repeat record names ("base has no refusal of the call that ended a
    decision").

## Checks (`C:/Users/qi/tmp/merge-20261017/verify`)

| Check | Result |
|---|---|
| Every `tests/arc_thin_*.test.ts` alone | 42 files, 215 tests, 210 pass; the 5 failures are the ones that fail at `deecdde6` and on both parent branches (activation "saved code acts in a closed loop", components "python session never stores runtime objects", receipts ×3) |
| pytest (lifecycle stats, recovery, request accounting, foundation config, bridge deadline) | 30/30 |
| `run_repeat_refusal_smoke.py` | collapse: 1 refusal, then the next decision acts; every copy: 3 refusals, `provider_error`; defaults: the third identical call ends the decision, no refusal |
| `run_fork_smoke.py` | parts 1–5 pass (fork, tampered snapshot refused, level fork with review, restart after a hung step) |
| Foundation smokes `schedule`, `schedule refinemodel`, `promotion`, `progress`, `activation`, `levelreview`, `foundation` | each passes its own checks and stops at the shared `system_chars <= 3000` check, as on both parents |

## Can they merge? Code yes; performance not shown

- The code merges with small, local conflicts, and the merged tree passes everything its parents pass.
- Whether the merged version plays better is not shown, and the evidence so far points the other way for its base:
  R1 (2026-10-16) found the simple line below `r03b` on su15 (level 1 in 1 of 3 forks against 3 of 3; one of its forks
  was lost to the gateway refusal the repeat fixes now prevent). The su15 level-2 loop (the other session; plan
  `docs/plans/2026-10-17-su15-level2-loop.md` on `claude/r03b-repeat-20261016`) therefore runs `r03b` + the repeat fixes.
- So this branch is kept as a candidate line, not as "the version". Pieces of it go to the loop's version one at a time,
  each with its own paired test: the first is the refinement package (`claude/refine-model-r03b-20261017`, record
  `docs/plans/2026-10-17-refinement-package-loop-candidate.md` on that branch).

| Evidence layer | Status |
|---|---|
| Functional correctness | Passed (suite, pytest) |
| Full-chain reachability | Passed offline (mock ARC SDK, production bridge, installed Pi 0.87.0, scripted provider) |
| Autonomous adoption | Not applicable to the merge itself |
| Net benefit | Unverified; R1 is evidence against the simple line as a base |
