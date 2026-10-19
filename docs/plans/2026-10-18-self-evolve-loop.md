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

- Keep, experimental, evaluated inside R-H and E-H (no separate arm). Next falsifiable check: the contest replay
  (iteration 2) sends the refiner input at each point where a check would have contested its hypothesis, with the
  contest event and the check source, to qwen, and counts rewrites that parse, decide at least 5 recorded moves and fail
  on fewer than half.
- Backlog: item C (hypothesis → check → revision) gains a revision path for refinement-written hypotheses; its status
  does not change without a real run.

## Iteration 2 (2026-10-19): where the actions go, and the contest replay

Analysis only; no runtime change. Scripts and outputs in `C:/Users/qi/tmp/r04/loop/` (`noeffect-runs`, `chains`,
`window`, `quiet-decisions`).

### What the recorded runs show

- **Quiet runs into GAME_OVER.** Runs of at least 10 actions that each changed at most 2 cells (`NO_EFFECT_CELLS`, the
  runtime's "nothing beyond what every action changes") occur in 8 of 18 su15 runs; four ended in GAME_OVER:
  su15-l1-3 #1-#33 (from #9 two clicks alternated in then-chains of 9), su15-l1-2 #26-#40 (a then-chain stepping y by 2),
  su15-r04-e1 #26-#56 (python loops of 10 and 15 clicks), su15-l0-2 #14-#45 (one click 30 times, refused since L1).
  Level 0's action budget is 110 (5 × baseline): su15-l0-2 ran out of it with 0 levels, su15-l1-3 used 83 of it. No
  refinement trigger named such a run. In E1 the refiner explained the row that empties by 2 cells per action only at the
  GAME_OVER (#56); its strategy pivot written at #41 became active at decision 29, after decision 28's 15-click loop.
- **Level 1 is where runs fail.** Of the 13 recorded su15 runs that reached it, 3 passed it, 8 spent its 210 actions
  (5 × its baseline of 42) without passing, and 2 ended earlier for other reasons. Among the six L0/L1 runs (the only
  ones with then-chains), the two that passed it used few chained actions there (su15-l0-3: 0 of 45, one action per
  decision; su15-l0-1: 11 of 160) and the three that failed used 119-153 of 210. In su15-l1-1 the agent moved blocks
  one cell per click in chains of 8-11 and found at #211 that a click near a block moves it there; the refinements
  rewrote the strategy 17 times on that level under the one-cell model and never proposed that experiment. This is a
  correlation in the same agent's samples; chains may follow from the slow model rather than cause it.
- **Refinement checks contradict the record when written.** Under r04's strict rule, of 31 check versions in the 15
  runs that logged refinement inputs, 30 compile and 9 would be contested while current, all written by refinements;
  7 of the 9 were contested at the move they were written (e.g. su15-fB3 `hyp.L1_gameover_on_block_click`: fails on
  111 of 112 recorded moves at #200). Over all 17 earlier runs, 8 of 32 versions would be contested under the strict
  rule, not 12 as the non-strict replay of the recorded results said.
- **Generality.** `NO_EFFECT_CELLS = 2` was set from su15, whose move counter changes 1-2 cells per action; a one-cell
  object moving one step also changes 2 cells. A stop on quiet sequences keyed to it would fit su15 further, so none is
  built; a game-independent notion of the per-action change would come first.

### The contest replay (`tools/arc_contest_replay.ts`)

- `build` runs every recorded check under the strict rule on the run's moves, finds where H2a would contest it while
  current, and takes the first logged refinement input from then on: its WHY NOW becomes the contest event in the
  current wording, with the check under CHECKS NAMED ABOVE, and the system prompt the current charter. `grade` parses
  each reply as the runtime does and runs a HYPOTHESIS check on the moves up to the input and after it.
- Dry run (no provider): 9 cases (su15-r8b 2, su15-fA3 1, su15-fB2 3, su15-fB3 2, su15-f2-src2 1); graded as their own
  replies, all 9 come out contested with the counts above, so the grader reproduces the runtime's contest.
- Sending them: `python -I tools/arc_refine_replay.py <out> --input <out>/harness:0,1,2,3,4,5,6,7,8 --samples 2`,
  18 qwen calls of about 3-4k input tokens each; at most 0.1M budget tokens. Not run: it needs the user's budget.

### Decision

- No runtime change in this iteration. The next candidate with the strongest evidence is a refinement hypothesis whose
  check already contests on the recorded moves being returned to the refiner instead of applied (7 of 9 above), to be
  written as its own change after the contest replay shows what qwen does with the contest event.

## Iteration 3 (2026-10-19): a stronger model on the same harness, and what both models use

The user's rules from here (2026-10-19): no smoke tests for minor changes, the real ARC result is the gold test; optimize
the practical use of the harness components and avoid mechanisms that stay unused or produce output the agent does not
adopt; other models on the same gateway may be run to tell model limits from mechanism defects. Real runs are part of
the loop, each with a 6M budget-token cap as before.

### The comparison (r04 at `8f44f7f9`, su15, `runs/arc-models-20261019`)

Same harness, same settings as the su15 loop (no action cap beyond the game's per-level budgets, 6M budget tokens, no
time cap); `tools/arc_ls20_loop_pilot.py` now takes `PILOT_MODEL` (the refinements use the session's model).

| Run | Model | Levels | Actions | Budget tokens | Per action | Stop |
| --- | --- | --- | --- | --- | --- | --- |
| su15-g56-1 | gpt-5.6-sol, reasoning medium | 1 (#71) | 281, 210 on the second level | 4.55M | 16.2k | the second level's 210 actions spent |
| su15-q38-1 | qwen3.8-27b, thinking off | 2 (#40, #151) | 267, 116 on the third level | 6.05M | 22.6k | token cap |

What the agent used (`tools/arc_adoption.mjs`; a component counts only when the agent called it or acted on it):

| | g56-1 | q38-1 | six earlier qwen runs (L0, L1) |
| --- | --- | --- | --- |
| python cells | 12 | 173 | 12-191 per run |
| saved tools called by the agent | 0 | 0 | 3 calls, one run |
| tools and views written by refinements | 1 view (shown at 81 decisions) | 1 tool (0 calls) | 8 tools |
| refine / consult calls | 0 / 0 | 0 / 0 | 0 / 0 |
| agent hypotheses with a check | 5 (with statuses kept up to date) | 7 | 3, one run |
| refinement edits (strategy) | 18 (16) | 29 (22) | 144 (91) in 7 runs |
| refinement replies refused because the check had no `def` line | 4 of 23 | 0 | — |

- **Where the second level was lost.** gpt-5.6-sol settled on "the clicked corner of a 2x2 block moves it one cell
  (top-left: up-left, top-right: up, bottom-left: left)": 151 of its 185 click steps there moved a block one cell, six
  GAME_OVERs. Its `hyp.color6_anchor_motion` was marked supported, and its check held on every click the agent made;
  the first refinement hypothesis (`hyp.color6_block_moves_up_left`) restated it. No click a few cells away from a
  block was made, which is the move that shows the mechanic. qwen tested distances on the first level ("can the token
  move 4 cells", "distance limit 6", #14-#22) and on the second level moved blocks by clicking points 4-7 cells away.
  su15-l1-1 (qwen, 2026-10-16) lost the same level to the same one-cell belief, also restated by a refinement.
- **Reading.** One run each: the stronger model did not pass more levels here (pooled qwen base for the second level:
  2 of 6). Both models use memory and whatever the runtime shows them (strategy, views, CURRENT KNOWLEDGE), and neither
  calls saved tools, refine or consult. The refinement step that turns the agent's stated belief into a checked
  hypothesis reinforces the belief instead of testing it, with either model: a check that runs only on the moves the
  agent chose collects holds from them. That is a mechanism defect, not a model limit.

### Changes

- `withCheckDef`: a check written as the body of `check(t)` gets its `def` line (refinement HYPOTHESIS and EXPECT, the
  memory tool).
- Rival events: a hypothesis with a check that holds on at least 5 decided moves (fewer than half failing), with a
  question and no other live hypothesis with a check under it, raises one refinement event per check version, before
  promotion to a rule: "write the strongest rival HYPOTHESIS, another explanation of the same moves, whose check
  disagrees with hyp.x on a move not made yet; say in predicts which move would separate them". The rival is stored
  under the target's question as stored, so H3a compares the two on the same moves in CURRENT KNOWLEDGE ("no recorded
  move separates …" / "#n separates …"); the event is answered by a hypothesis under a new key. The charter says why.
  `ARC_REFINE_RIVALS=0` turns it off.
- The repeated-python trigger adds: "if it reads the state, a view ('# view: on') shows its result at every decision,
  while a tool waits to be called". The view gpt's refinement wrote was shown at every decision; the tools were not
  called.
- Nothing removed: the five capability kinds stay in the system prompt (the user's self-defining direction); trimming
  consult, skills and subagents from it is the candidate if they stay unused.

### Evaluation

- The same pair on the new commit (`su15-g56-2`, `su15-q38-2`), 6M budget tokens each.
- Mechanism: rival events raised; rivals written (and refused or invalid); moves on which a rival and its target were
  both decided with different results, made after the rival appeared; views written, and repeated python after them.
- Outcome: levels and budget tokens per action against the first pair and the pooled base.
- Falsifiers: no rival event fires (no unchallenged hypothesis with a question); rivals are written but no separating
  move is made within the level; levels fall below the first pair's for the same model.
- Replayed on recorded runs (memory and check results as recorded, `C:/Users/qi/tmp/r04/loop/rival-sim.mjs`), the rule
  fires 1-3 times per run, on the beliefs in question: su15-g56-1 at #89 (the refinement's restatement, 9 of 9) and at
  #104 and #142 (the agent's `hyp.color6_anchor_motion`, 23 of 23, then 51 of 51 under its next check); su15-l1-1 at
  #67 (`hyp.block_movement`, 25 of 25); su15-q38-1 twice, su15-l1-3 and su15-l0-1 once each. The second pair runs on
  `2a836c30`.

### The second pair (r04 at `2a836c30`, rival events on)

| Run | Model | Levels | Actions | Budget tokens | Stop |
| --- | --- | --- | --- | --- | --- |
| su15-g56-2 | gpt-5.6-sol, medium | 1 (#28) | 238, 210 on the second level | 4.60M | the second level's 210 actions spent |
| su15-q38-2 | qwen3.8-27b, off | 1 (#21) | 231, 210 on the second level | 4.96M | the second level's 210 actions spent |

- **Rival events fired and were used.** g56-2: five rival events, three rivals written (two replies invalid). On the
  second level the rival `hyp.level2_clicked_cell_becomes_bottom_right` ("clicking any cell of a 2x2 block repositions
  it so the clicked cell becomes its bottom-right corner") was compared with the refinement's restatement of the
  agent's belief ("only the top-left cell moves it, one cell up-left") in CURRENT KNOWLEDGE; the agent's next moves
  separated them (#69, #80, #84, #91, #92), the restatement was contested by its check, and the agent rejected it and
  wrote "the clicked corner commands a direction". q38-2: two rival goal hypotheses ("erasing the bottom row wins",
  "all dots must reach the circle"); the agent tested and dropped both, a reset showed the row is a life bar.
- **Neither run found the mechanic.** The rival that matched the game ("repositions so the clicked cell becomes its
  bottom-right") differs from "corner commands" only for clicks off the block, and every proposed separating move was a
  click on a block. In g56-2 163 of 188 click steps on the second level moved a block one cell; the H3a line "no
  recorded move separates … (no move decided by both)" stood for the last 35 decisions without effect.
- **A defect the comparison exposed:** qwen rejected hypotheses by rewriting the claim ("REJECTED: #89 proved …") and
  left the status open, so two dead hypotheses were compared as rivals in CURRENT KNOWLEDGE for 45 decisions. Fix: a
  claim that opens with a status word (REJECTED, REFUTED, DISPROVED, FALSIFIED, CONTESTED, DISPUTED, SUPPORTED,
  CONFIRMED) sets that status when none is given, and the receipt says so.
- **Totals so far on r04 (four runs):** gpt-5.6-sol 1 and 1 level; qwen 2 and 1. With pooled qwen L0/L1 the second
  level is passed in 3 of 8 qwen runs and 0 of 2 gpt-5.6-sol runs. Next: gpt-6.1-sol, the gateway's strongest GPT, on
  the same harness (`su15-g61-1`), with one more qwen run (`su15-q38-3`).

## Iteration 4 (2026-10-19): the strongest model, and what limits it

### Third pair (r04 at `85280ac2`)

| Run | Model | Levels (at) | Actions | Budget tokens | Per action | Stop |
| --- | --- | --- | --- | --- | --- | --- |
| su15-g61-1 | gpt-6.1-sol, medium | **4** (#22, #38, #55, #193) | 206 | 6.08M | 29.5k | token cap, on the fifth level, 45 minutes |
| su15-q38-3 | qwen3.8-27b, off | 0 | 110 | 1.87M | 17.0k | the first level's 110 actions spent |

- **The su15 record.** Four levels; the best before was three (su15-l0-3, qwen, 194 actions). The first three took 55
  actions, the fourth 138. The model played almost without code: 136 `arc_action` decisions, 14 python cells, 2 memory
  calls; it published two tools of its own (the first agent-written tools in these runs) and called neither later; no
  `refine` or `consult`. The refinements wrote 13 strategy versions and 4 hypotheses (two rewritten by the iteration-1
  path); two rival events fired.
- **Reading for the user's question 3.** With the same harness the strongest model passes four levels, gpt-5.6-sol one
  and qwen zero to two. The harness carries a capable model; the weaker models are limited by what they infer, and the
  mechanisms added for them (rivals, contests) move their beliefs only within what they think to test.
- **What limits the strong model: the cost of its context.** The agent's uncached input per request grew from 7k
  tokens in the first 20 requests to 80k in the last 11: native history keeps the whole transcript of earlier decisions
  (results clipped to 5,000 characters) in front of the head, and Pi compacts only near the 175k window. The
  transcript is kept byte-stable for the provider's cache, which pays for qwen on this gateway (cache reads 2-4 times
  its uncached input) but not for the GPT models (gpt-6.1-sol: 1.06M cache reads against 5.82M uncached; gpt-5.6-sol:
  0.46M against 4.35M). Under the 6M cap the run stopped on the fifth level after 206 actions.
- **Run 4b:** `su15-g61-2`, the same with `ARC_THIN_NATIVE_HISTORY_CHARS=16000` (the summarised history in the head,
  the native default before 2026-10-14, bounded): falsified if budget tokens per action do not fall by at least a third,
  or if the first four levels take markedly more actions than in g61-1.

## Iteration 5 (2026-10-19): diagnosis only

From here the user's rules are: keep the refiner on, no change to the current version's mechanism or structure, no
repeated costly runs; find the drawbacks from the agent's runtime trajectory against the previous and best runs.

### su15-g61-2 against su15-g61-1 (the best run)

g61-2 was stopped at the user's request after 151 actions: 2 levels (#68, #94), three GAME_OVERs (#40, #112, #143),
2.06M budget tokens (12.7k per action against g61-1's 29.5k), 57 actions on its third level, which g61-1 passed in 17.
The falsifier of run 4b holds: the cost fell by more than a third, and the levels came markedly slower.

1. **The timer read as the click's effect.** 26 of the first 40 actions changed only the 2 cells by which the bottom bar
   shrinks; the agent recorded "the same diagonal coordinate (42,21) cleared (62,63)-(63,63) at #1 but (16,63)-(17,63)
   at #32" and swept the diagonal markers twice, losing the first life to the timer at #40 and calling that GAME_OVER
   "a terminal goal/failure signal". g61-1 clicked next to the token at #1 and saw 20 cells change. The same misreading
   occurred in qwen runs (su15-r04-e1's "border erasure rule"; ls20 runs taking the move bar for the goal).
2. **The refiner amplified it.** Its first hypothesis (#14) was the bar's change as the click's effect; the rival
   events (iteration 3) produced two more bar-based rivals (x and y projections); promotion made it a rule at #22, removed
   at #40 after nine disputes. Refinement checks gravitate to the most regular change, which is the counter.
3. **The refiner's budget gate dropped the GAME_OVER trigger at #40**: with the agent 2.6 times cheaper per action, the
   refiner's 10% share of the agent's tokens was exceeded early.
4. **Bounded history means re-derivation**: 46 python cells (g61-1: 17), mostly the same per-move diff recomputed from
   `history.grid`, and 1.68 requests per action (0.93).
5. **On its third level the agent took the one-cell model**: after finding on the second level that a click sends a
   block to a remote target (#76), it recorded at #143 "clicks on the movable object's footprint select
   object-relative steps: blue 2x2 top-left gives up-left" and moved blocks one cell per click (#122-#139), the belief
   that cost gpt-5.6-sol its second levels. g61-1 passed this level clicking destinations several cells away.
6. Memory was written only in the reviews after GAME_OVER (#40, #112, #143), as in g61-1.

### Why the components the agent creates go unused

Across the su15 runs on record (L0, L1 and the 9 runs on r04): callable components (saved tools, skills, subagents,
`refine`, `consult`) were called 5 times in total (one refinement tool 3 times in su15-l0-1; the agent's own tool twice
in su15-g61-2). Components the runtime runs or shows by itself were consumed in every run: the strategy prompt (read
at every decision, followed or explicitly skipped in the agents' notes), hypothesis checks (run on every move; the
agents rejected hypotheses after contests and separations), views (su15-g56-1's view shown at 81 decisions).

- What the agent saves are snapshots, not functions: all three tools the agents published (g61-1 `initial_compare`
  and `lvl2inspect`, g61-2 `inspect_l1`) take no arguments and print a fixed comparison or fixed regions of the grid.
  The python session held only data, never a function, in g61-2.
- The computations are short, situation-specific queries: a per-move diff is one comprehension; g61-2 typed it in 26 of
  its 46 python cells up to #112 rather than defining it once, because writing it costs one call, the same as calling a
  tool, and needs no recall of a tool's interface. The saving a saved function would bring is the line itself (about 40
  output tokens per use, about 1k over the run against 2.06M). The free form of reuse was not taken either: the python
  session persists between calls, and g61-2 never defined a function in it.
- The bottleneck is inference, not computation: g61-1 passed four levels with 17 python cells in 206 actions. Its
  losses came from what it believed (goal, timer, hazard), which no saved computation addresses.
- What is consumed is mostly what the services wrote: in g61-1 the strategy prompt had 18 versions, 17 of them
  refinements'; su15-g56-1's view was a refinement's; in g61-2 all 5 hypotheses with a check were refinements' (g61-1:
  4 of 8). The agents read that material and judged it (followed or skipped in their notes). The agent's own part,
  deciding what to codify and when to call it, is where little happened (g61-1 and g61-2: 3 tools saved, 2 calls; no
  function in g61-2's python session).

### Who holds which decision

The user's division (2026-10-19): the runtime, refiner, ledger and the other modules are services that provide
interfaces, execution and material; the agent makes the decisions, chooses what to invoke, and acts. A remedy for
unused components is then not the runtime choosing components by state, which it cannot judge. Checked against it:

- `prompts/rules.md` reverses the division. The system prompt lists it as "rules your checks established", and a
  refinement's edit of it is announced with "Revise, restore or delete it like your own edits", but the workspace
  refuses the agent's writes (`demo/arc_thin_workspace.ts`, since pr-01 on 2026-10-14, where the agent wrote it three
  times in one decision as a notebook). In the 7 runs of `arc-models-20261019` agents wrote it 5 times, in 4 runs, and were
  refused each time: su15-q38-1 after #102 and #174, su15-q38-2 after #89 and su15-q38-3 after #105 wrote their own
  mechanics as rules (785-1560 characters); su15-g61-2 after #40 tried to empty it while a refinement's disputed rule
  stood (a refinement removed it at the next decision). The cost here was small: q38-2 and q38-3 moved the content to
  memory or the strategy, q38-1's was in memory already (and its movement rule proved wrong at #180). It is the one
  standing component the agents set out to build on their own, and the one they may not write.
- Iteration 3's repeated-python text steers refinements to views, which run at every decision, over tools, which the
  agent calls: the service then chooses what the agent looks at. The agent can switch a view off, so this is milder.
- Not changed in this iteration (no mechanism changes). The options: let the agent write `prompts/rules.md` (the
  division's answer, a mechanism change that reopens pr-01's notebook use), or keep it refinement-only and correct the
  two texts that say otherwise. The user chose the first: iteration 6.

## Iteration 6: the agent writes `prompts/rules.md` (user agreed, 2026-10-19)

- Problem: the refusal above. Its reasons in pr-01 (one 10-action qwen run of 2 decisions; the agent wrote the file
  three times in its second decision, with colours, layout, open questions and that decision's plan): each write
  changed the system prompt and lost the cache, and a refinement could not overwrite a file the agent wrote, so
  promotions had nowhere to go. Both are now met otherwise: prompts apply from the next decision, and refinements may
  rewrite `prompts/rules.md` whoever wrote it (`ownedByRefinement`). The notebook use did not recur in the refused
  writes of the 7 runs above: four were rules, one removed a disputed rule.
- Claim: the agent's writes and deletions of `prompts/rules.md` are accepted and versioned as for
  `prompts/strategy.md`; refinements keep writing promotions to it and narrowing or removing disputed lines; the two
  texts that promised the agent this (system prompt, refinement notice) become true. Burden removed: a refused call,
  and the agent's rules moved elsewhere, at the moments it consolidates what it learned.
- Change: the workspace no longer refuses the path; `RULES_PATH` is defined in `arc_thin_claims.ts`; a refinement's
  rules edit is written like its other file edits. No prompt text changed. One factor: nothing else in promotion
  changes.
- Falsifiers, for the next authorized run (none is run for this alone): the agent writes the file in more than 1
  decision in 10, or puts plans and open questions there (pr-01's notebook use); a promoted line the agent deleted is
  promoted again while its hypothesis is not rejected (the guard then: do not re-promote a check version whose line the
  agent removed). Not expected: a level gain from this alone; the refused writes cost little.
- Checks: unit tests, 10 files, 70 tests, 69 pass (`arc_thin_promotion` now asserts the agent's writes through
  `mutate` and the write tool; `arc_thin_refine_ledger` writes a refinement's rules edit the new way); the one failure,
  in `arc_thin_components` (a restored python session refuses a writing class body the test expects kept), fails the
  same way on the base since r03b. No smoke (a minor change). Unverified: whether the agent writes its rules there in
  play, whether they are right and followed, and any benefit.

### A third gpt-5.6-sol run (2026-10-19, from the coverage session)

su15-p13-g56-1 (gpt-5.6-sol; branch `claude/r04-cov-20261019` at a3ad22e8, P1-P3 on; `runs/arc-p13-20261019`) passed
3 levels (#27, #78, #125) and stopped at the token cap; by that session's reading its levels came before any P1-P3
event fired, and it found the click-relocates-block mechanic itself at #41. gpt-5.6-sol on this harness is therefore
1, 1, 3: iteration 3's single-run reading ("the stronger model did not pass more levels here") is inside the
variance. The paired qwen run passed 1. At the user's "merge" the branch was merged into r04 (e0b3e3a6): its one
conflict, in the refinement's file write in `arc_thin_extension.ts`, keeps the branch's P3 pinning and then writes
every path with `workspace.mutate`. r04 now runs P1-P3 by default (`ARC_REFINE_COVERAGE=0` turns them off; P4 needs
`ARC_THIN_LEAN=1`). Full unit suite after the merge: 38 files, 210 tests, 205 pass; the 5 failures (activation 1,
components 1, receipts 3) are the base's own (r04 before the merge: 193 tests, 188 pass, the same 5).
