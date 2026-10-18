# Self-evolve loop (2026-10-18): what the refiner, checks and ledger fail at, and the fixes

Date: 2026-10-18 (Asia/Shanghai). Status: iteration 1 implemented and checked offline; adoption and benefit unverified
(no paid run is authorized). Branch `claude/r04-20261017`, on top of Part H
([plan](2026-10-17-hypothesis-loop-and-self-harness.md) §8).

The user's loop: after Part H, find the current drawback of the self-evolving parts (refiner, critic, ledger, checks),
and change what makes the agent pass more levels. Each iteration below names its material, one main factor, the checks
it passed and what stays unverified. Paid runs (R-H, E-H) wait for a budget.

## Iteration 1: a refinement can revise its own contested hypothesis; an outage is waited out

### Problem and claim

- Material (recorded runs, no new runs):
  - Refiner profile of 7 su15 runs (`arc-l2-20261017` su15-l0-1..3 and su15-l1-1..3, `arc-r04-20261017` su15-r04-e1):
    159 refinements, 144 edits. Edit targets: `prompts/strategy.md` 91, `prompts/rules.md` 32, hypotheses with a check
    10, `tools/*.py` 8, memory 3. Triggers: no step predicted a level change 37, unclassified 36, schedule 26, no
    hypothesis carries a check 23, rule in dispute 22, repeated python 15, level reached 8, GAME_OVER 8, candidate rule 2.
    Other outcomes: invalid 8, refused 4, none 2, stale 1. Levels: l0 2, 0, 3; l1 1, 1, 1; e1 0 (56 actions).
  - The H2a contest rule replayed on 17 su15 runs since 2026-10-15: 25 hypothesis checks, all 25 written by
    refinements; 12 would be contested (at least 5 decided moves, at least half failing), e.g. su15-r2
    `hyp.action6_requires_nonzero_target` failing 206 of 211, su15-r7 `hyp.l1_wall_contact_triggers` 139 of 141,
    su15-l1-3 `hyp.action6_moves_bottom` 172 of 233. All 25 ended `open`.
  - Part H's contest event told the refiner to "write a narrower HYPOTHESIS under a new key", and a refinement's
    HYPOTHESIS edit of any existing key was refused ("exists; a refinement adds hypotheses, it does not rewrite them").
    The hypotheses a contest flags are the refinements' own, and the only writer of them could not revise them: the
    contested one stays first in the decision view with its failing check, beside any narrower copy.
  - The refiner did not see the check it was asked to narrow: the trigger names the key and the counts; the source is in
    `data/memory.md` (H1d), which the refiner input does not include.
  - su15-r04-e1 (E1, 2026-10-17) stopped at 56 actions as `provider_error` after three decisions of "Connection error."
    in a ~35-minute yibu outage: the stop for a provider that refuses the run (3 identical errors) took an unreachable
    gateway for a refusal. Pi retries such a request 3 times itself (2 s, 4 s, 8 s), so each lost decision was 4 failures.
- Claims. (A) When a hypothesis whose latest write is a refinement's is contested by its check, the next refinement is
  told it may rewrite it under the same key and sees its check; the rewrite replaces claim and check, starts `open`, and
  the runtime reruns the new check on every recorded move. (B) A transport error is waited out (30 s, doubling, at most
  300 s per wait and 3600 s per run) and its decisions do not count toward the no-action stop; refusals stop as before.
- Burden removed: (A) a contested refinement hypothesis beside its narrower copy, two keys for one question at the top of
  CURRENT KNOWLEDGE; (B) a run's remaining budget lost to an outage.
- Non-use and falsifiers: the agent's own hypotheses stay the agent's (a refinement only adds a narrower one under a new
  key). (A) is falsified in a real run if contested refinement hypotheses are not rewritten, or the rewrites decide
  almost no moves (a check that returns None everywhere holds vacuously). (B) is falsified if an outage still ends a run
  inside the allowance, or a refusal is waited out.
- Scope: refiner input and edit handling, contest event text, the runner's stop rule. No change to the agent's tools,
  system prompt or the contest rule. No paid run.

### Design and cost

- Choice: reuse the ownership rule refinements already follow for files ("a refinement rewrites only files refinements
  wrote"). `refinementOwned(key)`: the latest memory row of the key that is not a contest by check (`by: "check"`, no
  one's write) is a refinement's and not a delete.
- Lifecycle: contest by check (runtime) → event naming the key, its check and whether a refinement wrote it (runtime) →
  rewrite under the same key or a narrower one under a new key (refiner, qwen) → memory row `by: "refinement"`,
  refiner row `rewrote: true`, check rerun on recorded moves (runtime) → a new check version can be contested again
  (runtime) → the agent reads it in CURRENT KNOWLEDGE.
- Added: refiner input `CHECKS NAMED ABOVE` (the check source of each hypothesis named in the triggers, only when one
  is); event wording by owner; runner parameters `max_provider_outage_seconds` (3600, 0 = off) and
  `provider_outage_backoff_seconds` (30), summary field `provider_outage_seconds`, run-config field. Nothing resident in
  the agent's context, no new field, gate or worker.
- Kept: the agent's hypotheses refused to refinements, with a reason naming the owner; refusal stop, deadline and token
  cap; a wait is never past the deadline.

### Implementation and verification

- `demo/arc_thin_extension.ts` (`refinementOwned`, contest event wiring, refiner input, HYPOTHESIS edits),
  `demo/arc_thin_claims.ts` (`contestEvents`), `src/autoresearch_pi/arc_thin_e2e.py` (`_outage_wait`, run loop),
  `tools/arc_thin_smoke_provider.ts` (`ARC_THIN_SMOKE_OUTAGE="after:count"`), `tools/run_repeat_refusal_smoke.py`
  parts 6-7, tests.
- Checks (`C:/Users/qi/tmp/r04/h/l1`, `l1b`): `arc_thin_claims` 6/6, `arc_thin_promotion` 9/9,
  `arc_thin_refine_ledger` 20/20 including the rewrite test (RED before the change: the edit was refused); pytest 31
  passed (the outage helper RED, then GREEN); refusal smoke parts 1-7 pass (an outage of 12 requests waited out over 3
  decisions with the no-action stop at 2, 0.35 s; an outage of 16 requests with a 0.05 s allowance stops as
  `provider_error` after 4). The `hypotheses` and `promotion` smokes pass their own checks (the full chain shows
  `CHECKS NAMED ABOVE` and the agent-owned wording) and stop at the shared `system_chars <= 3000` check as on the base
  (3903 characters since 2026-10-16).
- The rewrite branch itself is checked in the unit fixture (HTTP stand-in), not in a full-chain smoke.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | passed | test fixtures, HTTP stand-in | the tests above |
| Full-chain reachability | partial | scripted provider, mock SDK, production bridge, real Pi 0.87, WASI | event wording and check sources reach the refiner (`hypotheses` smoke); the outage wait (refusal smoke); the rewrite only in the fixture |
| Autonomous adoption | unverified | — | R-H, E-H |
| Net benefit | unverified | — | E-H |

### Decision

- Keep, experimental, evaluated inside R-H and E-H (no separate arm). Next falsifiable check: R-H replays the refiner
  input at the 12 would-contest points (now with the check source) to qwen and counts rewrites that parse, decide at
  least 5 recorded moves and fail fewer than half.
- Backlog: item C (hypothesis → check → revision) gains a revision path for refinement-written hypotheses; its status
  does not change without a real run.
