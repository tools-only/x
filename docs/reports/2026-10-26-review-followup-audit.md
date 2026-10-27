# E0: what the stall and level reviews led to (audit, 2026-10-26)

Date: 2026-10-26 (Asia/Shanghai). Status: diagnosis from existing real-provider run logs. No runtime change, no new run, no
provider tokens spent. No mechanism is tested here.

Question, from the meta-layer discussion (`docs/plans/2026-10-26-meta-layer-self-harness.md` and Codex's
`runtime-meta-self-harness-design.md`): when a review names a cost in the agent's own way of working, does a harness
component follow, and is it used? If reviews name such costs and nothing executable follows, the first meta-layer
experiment should change what a review turn delivers. If they do not name them, it should change what the turn sees.

## Data and method

- Runs: every run from 2026-10-19 on whose `harness/working_set.jsonl` marks a level or stall review, found in `runs/` and
  in the worktrees' `runs/`. Spin reviews are stall reviews. That is 28 runs, 20 of them forks; a fork's copied prefix is
  counted once, in its source run. 74 review turns: 49 stall, 25 level. Models: qwen3.8-27b 66 (thinking off, except one
  run at high), nemotron-3.5-super-vl 4, gpt-6.1-sol 4. All 74 are on su15.
- Script: [`tools/arc_review_followup_audit.py`](../../tools/arc_review_followup_audit.py) reads each run's session tool
  calls, binder versions, refiner log, observer runs and trajectory. Generated tables, including one row per review:
  [data](2026-10-26-review-followup-audit-data.md). Regenerate with
  `python tools/arc_review_followup_audit.py --out <dir> --labels docs/reports/2026-10-26-review-followup-labels.json <run roots>`.
- Window: the review turn, then up to 40 actions or until the next review.
- Component: an agent-authored write, edit or `python(save=)` under `tools/`, `lib/`, `skills/` or `agents/`, a prompt
  other than the review's own file, or a memory hypothesis with a check. Refiner edits and the agent's `refine(focus)`
  requests are counted apart: the refiner is a service, a request is the agent's.
- Use: a view shown with content, a tool called, a predictor scored, a subagent consult answered, a check decided. A prompt
  is delivered at every decision; whether it was used cannot be read from the logs.
- Whether a review names a loop-level cost is a semantic judgment. I labelled every review file; the rubric and a quote per
  review are in the [labels](2026-10-26-review-followup-labels.json).

## Results

1. **Output.** 58 of 74 turns wrote their review file. 16 did not:
   - 8: the consult-first call point refused the write, and every consult failed (ga-p0-shadow-1, codex-eff-su15);
   - 1: the turn hit its tool-call limit;
   - 7: no write at all (4 of these are forks that ended at the review).
2. **Recognition.** 46 of the 58 name at least one loop-level cost: 39 of 41 stall reviews and 7 of 17 level reviews.
   By category (a review can name several):

   | category | reviews |
   |---|---|
   | repeated moves with known results | 32 |
   | a belief kept without evidence, or the previous level's frame carried over | 18 |
   | a counter or budget run down without noticing | 18 |
   | a misread direction or position | 17 |
   | probes or resets without a hypothesis | 4 |
   | its own prompt left stale | 2 |
   | decision overhead | 2 |
   | the same analysis repeated | 2 |

   gpt-6.1-sol's level reviews also name process fixes, e.g. "Inspect exact differences rather than guessing centers".
3. **Investment.** None of the 46 was followed by an executable component the agent wrote for the named cost.
   - 9 got a prose follow-up: a strategy or rules edit, or a `refine(focus)` asking for one ("STOP repeating known
     slides", "delete the stale level-1 hypotheses").
   - 37 got nothing.

   The stall and level review prompts ask for prose plus `- test: <move>` lines
   ([arc_thin_e2e.py:84](../../src/autoresearch_pi/arc_thin_e2e.py:84)), and that is what came back.
4. **What did appear.** In review turns and their windows the agent made 8 writes of executable files:
   - 7 subagent writes in 6 review turns, all to satisfy the consult-first gate. codex-eff-su15's reviewer got 22
     consult failures and no answer.
   - 1 view rewrite (described in item 6).

   It also asked the refiner for components 9 times: views of a piece's position and its distance to a target, colour
   counts, fixing a view, adding a check. Each request followed a review that wrote no file or named no loop cost. The
   agent asks for views while it is re-deriving positions in ordinary decisions, not when a review names a cost.
   ga-p0-shadow-1 alone accounts for 5 agent-asked tool edits; its 14 forks inherit the views built before their fork
   point.
5. **The prose channel became a loop of its own.** The same `refine(focus)` text was sent:
   - 8 times (R2-A, after review d91);
   - 20 times (R2-A, after d113);
   - 19 times each for 3 variants (ga-p0-shadow-1, after d123);
   - 60 times (su15-chm, after d51).
6. **Use and effect.**
   - **The reviews' own tests:** 144 listed, 26 pinned (one at a time), 15 played, 4 expired, 5 replaced by a later
     review, 14 skipped as already played from that board.
   - **Replays:** 22 reviews name repeated moves and have work-memory data. In those runs, 31% of the 20 actions before
     the review replayed a known result (135/436), and 36% of the 20 after it (107/301). The share did not fall in 14 of
     the 22.
   - **Named costs stay named:** 58 of 70 named categories reappear in the run's next review. Review files mostly carry
     their earlier "Wasted" lines forward, so this shows costs left unresolved, not new occurrences.
   - **A delivered view did not bind** (R2-A, level 2):
     - A view requested in level 1 printed the countdown at every state. After #96 it read "2 zeros remain (x0-1);
       ~1 ACTION6 clicks to clear". That text reached the provider input (`runtime-audit/provider-inputs.jsonl`).
     - The active lessons prompt said "Never empty row 63 — that's GAME_OVER, not progress".
     - #97 emptied the counter: GAME_OVER. Its note was about a hypothesis test, and its prediction had no state field.
     - The agent then rewrote the view to print "EMPTY (GAME_OVER risk!)". Its next six stall reviews blamed "~17
       structural clicks without tracking row-63 budget".

## What this supports, and what it does not

- **Recognition is not the broken transition for these runs; the step from a named loop cost to an executable change is**
  (0 of 46). Prose follow-ups happen, but replays did not fall after the reviews that named them.
- **The precondition for the harness-turn experiment holds.** It should change what a review delivers (a component, or a
  reasoned "none") and add loop facts and a stated expectation. More analysis alone is not the fix: the analysis is
  already there.
- **Pushed state alone may not be enough.** In the R2-A case a delivered view and a resident rule both stated the
  constraint, and the action broke it. That is one observation. Still, a first experiment that adds only a state mount
  (M1 in both designs) is likely to re-measure it.
- **The most-named costs sit at the action boundary.** Repeated moves (32) and run-down counters (18) are what a review
  names most, so the first experiment needs a place there: an agent-written guard checked before an action is sent, and
  possibly an experiment the runtime plays.
- **Separate defect:** the consult-first gate cost 8 reviews their whole output (known since the 10-22 report, F3). The
  repeated `refine(focus)` sends match its Tier-1 remedy 2 (return the earlier receipt for an identical focus).
- **Not shown:**
  - whether a harness turn would produce components;
  - whether those components would change actions;
  - any benefit in levels or cost.

## Limits

- One game (su15) and mostly one model. The gpt sample is 4 level reviews from one run.
- The labels are one agent's judgment; the rubric and quotes are in the labels file for re-checking.
- Spin reviews come a few actions apart, so their windows overlap.
- Forks share prefixes; a fork's window is its own continuation.
- Work-memory novelty data exists only for runs since 2026-10-21 (22 of the 32 reviews that name repeated moves).
- "Used" is mechanical (shown, called, scored). Whether a shown view changed a decision is not measured here beyond the one
  traced case.

## Next falsifiable check

E1, which needs the user's budget: matched-prefix forks at stall points, including one held-out game.

- **Arm A:** today's reviews.
- **Arm B:**
  - a harness turn (one harness change or a reasoned "none");
  - loop facts and the refiner's `EXPECT` reused for agent-written components;
  - level scoping of views;
  - an agent-writable guard.

Run the stronger model first, then qwen. Measures:

- components created → delivered → changed the next action;
- replay share and counter run-downs after each review;
- guard refusals and the agent's revisions of its guards.
