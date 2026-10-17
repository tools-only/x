# Plan: a hypothesis loop whose checks matter, and a self-harness with a payoff

Date: 2026-10-17 (Asia/Shanghai). Status: Part H built and checked offline on 2026-10-18 (§8); Part S not built;
nothing run on the real provider. Written on
`claude/r04-hypothesis-harness-20261017` (from `009c6825`) and committed on `claude/r04-20261017` when its session was
folded into the r04 line; updated there to r04 at `6c513fd4` and E1. Follows
[the development workflow](../development-workflow.md); it extends the [r04 plan](2026-10-17-r04-version-plan.md):
r04's item 5 (strict checks, `7d2533bc`) is H1a less the box, item 7 (refiner logs) is reused for measurement, and
item 6 (the ledger) is switched off in E-H's runs.

User request (2026-10-17): hypothesis checks and the self-harness are the most important problems; plan their fix.
Constraints kept throughout: no game content; in-run components use the agent's own model (qwen3.8-27b);
`arc_action` stays as it is; nothing tells the agent what to build or when; one main factor per paid test.

## 1. What the runs show (diagnosis)

Data: every su15 run since 2026-10-15 (26 runs for hypotheses: L0/L1, su15-r2–r9, s02–s04, the fork test, the F2
sources; 56 runs of all games for components). Scripts and outputs: `C:/Users/qi/tmp/pub-20261017/`
(`agent-checks.txt`, `why-l2.json`, `why-loop.json`, `runs-aggregate*.json`).

### Hypothesis checks

| Observation | Evidence |
|---|---|
| The agent rarely writes a check | 72 hypothesis writes by the agent, 10 with a check; 3 of those were English, not Python ("after an ACTION6 or ACTION7, does the 9-blob move? record direction", su15-l1-1), failed to compile and never ran. The agent was shown "check: not usable (SyntaxError …)" and rewrote the claim twice more with the same text |
| Checks come from refinements | 48 hypothesis writes by refinements, all with checks: the runtime's event "N actions and no hypothesis carries a check: turn a belief the agent has stated into a HYPOTHESIS with a check" asks for one |
| The agent keeps its beliefs as prose | 230 fact writes, 65 of them using words such as "CONFIRMED", "definitive" or "CRITICAL"; its goal ideas are hypotheses without checks; refuted goals are kept by hand in the strategy file ("CONVERTING ALL 10s DOES NOT WIN (#194-#197)", "BLOCK AT DIAMOND CENTER ≠ WIN (#213, #227)", su15-l1-3) |
| Checks go to the regular, unimportant effect | of 29 refinement hypotheses in 18 runs, 10 are about the row that changes on every action and 4 about the goal (by keyword) |
| Check results reach no one | su15-l1-3 `hyp.action6_moves_bottom` was in 314 requests, the last reading "holds 60 · fails 158"; it stayed `[open]` and nobody revised or retired it |
| A wrong belief is confirmed by its own moves | su15-l1-1 `hyp.block_movement` (a click on a block moves it one cell, the belief that lost level 2; a refinement wrote it from the agent's statement) held on 109 of 111 decided moves: its check returns None unless the click is on a block cell, and the agent clicked block cells because it believed it |
| Rules cite what is not there | su15-l1-1's final rules cite `hyp.game_model` four times; the agent deleted it, and its check never compiled. su15-l1-3's rules cite `hyp.action6_level1_window`, which never existed. su15-r04-e1's refinements wrote rules citing `hyp.action6_mechanic`, `hyp.border_cost` and `hyp.action7_noop`, none of which existed |
| No hypothesis at all (r04 E1) | su15-r04-e1 (56 actions, ledger and EXPECT on): the agent wrote no hypothesis and no refinement wrote one, though "no hypothesis carries a check" was a trigger 5 times. The one attempt came as `MEMORY hyp.border_cost` and was refused (recorded as applied until `6c513fd4`); the refiner put its checks of beliefs into EXPECT blocks instead |
| Silent defaults | 6 of 14 refinement hypotheses in su15 r2–r9 read `changed_cells`, which a check's move did not carry; su15-r2's recorded 206 fails and 5 holds on an empty list. Fixed in r04 (`7d2533bc`): 460 recorded verdicts become errors under the strict rule |

Causes in the code (r04 at `6c513fd4`):
- The native memory tool's `hypotheses` parameter is `Array(Any)` with a one-line description
  (`demo/arc_thin_extension.ts:2069-2076`); the check's signature and fields are described only in the non-native
  schema (2091-2102). The system prompt says "optionally with check(t): True/False/None on transition t".
- No check's code is ever shown: the decision view (`renderDecisionMemory`, `demo/arc_thin_memory.ts:852`) and
  `data/memory.md` show the claim and the counts. The refiner's 48 working checks teach the agent nothing.
- Until r04, a check's move had `n, action, x, y, level_changed, state, levels_completed, before, after` while
  receipts, `data/trajectory.jsonl` and `env.act` report `changed_cells` and a box. r04 (`transitionsFor`,
  `demo/arc_thin_extension.ts:777`, and the guest's strict move) adds `changed_cells` and makes a missing key an error
  naming the keys a move has; the box is still missing.
- `contested` exists, but only the agent's own recorded refutations set it (`demo/arc_thin_memory.ts:433-444`);
  check results are a separate channel that changes no status, and an uncited failing hypothesis raises no event.
- A per-move check suits local mechanics; nobody has said how a goal claim is checked, so goals stay prose.
- Checks run only on the moves the agent chose, and nothing compares rivals on them.

### Self-harness

| Observation | Evidence |
|---|---|
| No tools, skills, subagents or libraries by the agent | 0 in 56 runs; 0 `save=`; 0 `consult`; 0 of 467 refinements requested by the agent; every saved tool in a run workspace was written by a refinement |
| Prompts are adopted | the agent wrote `prompts/strategy.md` or `rules.md` in 5 of the 6 latest runs (up to 10 writes): they are shown at every decision |
| Code stays inline and is retyped | 106-191 python cells per run (l0-2: 12); the L1 runs defined 0-1 functions; su15-l0-1 redefined functions 51 times, 36 identically, and reused none across decisions; 11-53% of non-trivial code lines were retyped from earlier cells |
| The one exception | su15-l0-3, the three-level run, reused its own helper functions in 35 cells |
| Inspection rounds are the cost | 1.44-3.02 requests per action decision; 24-65% of a run's tokens are spent after a decision's first request (L1: 57-65%), each round resending the context (up to ~51k characters) |

Causes:
- **Saving is dominated.** The python namespace persists across calls, decisions and restarts ("Names persist
  automatically"); a saved tool loses it ("Saved tools run without this namespace"), is called as a separate tool with
  `args={...}` (`demo/arc_thin_extension.ts:2104-2110`), and gives the agent nothing it can see.
- **The cost of re-deriving is invisible.** Nothing tells the agent that a cell repeats an earlier one or that a
  decision spent two inspection rounds before acting; the repeated-work detector feeds only the refiner.
- **Recognition.** The session header lists names only (`demo/arc_thin_python_session.ts:100`); in su15-l1-2 it held
  about 60 data names and no function.
- **The refiner occupies the role.** The system prompt says refinements edit prompts, memory, tools and skills in the
  background, and they do.
- **No payoff within one run** for skills and subagents while one agent has its whole transcript in view.

## 2. Claims

- **H (the hypothesis loop).** If a check's interface is documented where it is written, its move carries what the
  rest of the harness reports, a check that mostly fails marks its hypothesis contested and reaches a refinement, and
  rivals are compared on recorded moves, then the agent writes working checks and revises or retires hypotheses that
  its checks contradict, instead of keeping them open.
- **S (a self-harness with a payoff).** If making a component from code the agent already ran costs one call, a
  component can run itself before each decision (a view), and the agent is told plainly when it repeats work or spends
  rounds before acting, then the agent turns some repeated work into components and uses them, and decisions need fewer
  requests.
- **Overturned by:** the agent still writing prose or no checks, contested hypotheses staying untouched, no component
  created or none used, or levels per run below the base.

## 3. Design

### Part H

| # | Change | Where | Resident cost | Off switch |
|---|---|---|---|---|
| H1a | A check's move carries the environment-reported fields the receipts show: `n, action, x, y, changed_cells, bbox, level_changed, state, levels_completed, before, after`. Reading any other key raises and is shown on the hypothesis ("check error at #n: a move has no 'foo'; it has …"). Done in r04 (`7d2533bc`) except `bbox`: `changed_cells` is counted when a check first reads it, and the error names the keys a move has | `transitionsFor`, `demo/arc_thin_skill_guest.ts` (`_StrictTransition`) | none | none in r04: `claim_checks.jsonl` keeps the earlier results and `tools/arc_thin_recheck_claims.ts` compares |
| H1b | The native memory tool's hypothesis items get a schema: `key` (hyp.<name>), `question` (rivals share it), `claim`, `predicts`, `next_test`, `status`, `check` described as "Python `def check(t)` → True/False/None; t has n, action, x, y, changed_cells, bbox, level_changed, state, levels_completed, before, after (grids, [y][x]); a goal claim returns False when its condition holds after a move and the level did not change" | memory tool schema | ≈450 characters per request | the earlier `Array(Any)` |
| H1c | A check without `def check(` is not compiled: its text is kept as `next_test`, and the receipt says so with the signature, instead of a SyntaxError | `planNativeMemoryUpdate` | none | — |
| H1d | Check code is readable on demand: `data/memory.md` and `memory list` of one key include each check's source, so the refinements' checks serve as examples | `renderMemory` | none in the head | — |
| H2a | A hypothesis whose current check has decided at least 5 moves and failed on at least half becomes `contested` through the existing path, with `contested_at` at the move where that happened; the decision view puts it first with "its check fails on 158 of 218 decided moves (#51, …): narrow the claim to where it held, fix the check, or reject it". Only the agent or a refinement narrows or rejects | `arc_thin_memory.ts:433-444`, `claimLines`, `renderDecisionMemory` | one line per contested hypothesis | thresholds 0 |
| H2b | Each check-contested hypothesis raises one refinement event (per hypothesis and check version), cited by a rule or not | `promotionEvents` | refiner input only | — |
| H2c | A rule line citing a key that is not in memory is reported under RULE CHECKS ("cites hyp.x, which does not exist") | rule checks | when it applies | — |
| H3a | For hypotheses sharing a question, each with a check, one line per question: "no recorded move separates hyp.a from hyp.b (both decided 40 moves, same results)" or "#n separates them: hyp.a holds, hyp.b fails" | `renderDecisionMemory` | one line per question with rivals | — |

H1b documents the goal form ("False when its condition holds after a move without a level change"), which turns the
agent's hand-kept "does not win" notes into checks the runtime runs; no other mechanism is added for goals.

Not proposed in Part H: choosing which belief the refinement formalizes (that is the refinement's judgment, and the
charter is r04's E3 replay question); deciding status from a check without a threshold; any field on `arc_action`.

| Transition | Who advances it | Evidence |
|---|---|---|
| opportunity → candidate | the agent (or a refinement) writes a hypothesis with a check | memory row, compiled check |
| assembly → use | the runtime runs the check on every recorded and later move | `claim_checks.jsonl` |
| feedback | the runtime marks contested (H2a), raises the event (H2b), compares rivals (H3a) | status, event, view line |
| revise / retire | the agent or a refinement narrows, fixes, replaces or rejects | memory rows, refiner edits |

### Part S

| # | Change | Where | Resident cost | Off switch |
|---|---|---|---|---|
| S0 | Measure the opportunity before building, on recorded runs: share of decisions whose first python cell repeats most lines of an earlier decision's first cell; requests per action decision and tokens after the first request; identical redefinitions; the repeated-work detector's families | offline tool in `tools/` | none | — |
| S1a | Publishing a function the agent already ran costs one call: port `codex/kernel-reuse-20261016`'s `env.publish("symbol@revision", name=...)` to the r04 line (its base is the r03b-simple line; there it is functional: extraction without replaying the cell, refusal of functions that depend on mutable state) | python session, runtime, workspace | none | — |
| S1b | `env.publish(…, view=True)` publishes it as a view: run after every new state, its output shown at the next decision, so a decision's recurring opening inspection can be in place before the first request | same; existing `# view: on` path | the view's output, capped as views are | — |
| S1c | The session header lists the agent's functions first (signature, first docstring line, calls so far), then data names | `arc_thin_python_session.ts:100`, as in the codex branch | within the existing 900 characters | — |
| S2a | A cell's receipt states repetition when it occurs: "find_block: identical to its definition in decision 7" or "8 of 10 lines as in the cell at #41"; facts only, no advice | python receipts; the repeated-work detector | only when it fires | variable |
| S2b | The resources line states a decision's rounds before acting when there were two or more: "this decision: 3 requests before acting (2 python calls), 38k input tokens" | resources line | ≈80 characters when it fires | variable |

Not proposed in Part S: reminders to save, quotas, mandatory fields, removing the kernel's persistence, or stopping
the refiner from writing tools (a separate factor; authorship is recorded either way).

**S3, later, its own plan:** components carried across games (an agent library, versioned, loaded read-only into the
next game). Within one run the kernel is always at least as good as a component; across games it is not. That is
where a publishable self-harness result is most likely. It needs the benchmark split first: no test game may help grow
the library.

| Transition | Who advances it | Evidence |
|---|---|---|
| opportunity | repeated cells and inspection rounds (S0 counts them) | S0 measures |
| recognition | the agent reads S2's facts | later calls |
| investment → candidate | the agent publishes (S1a/S1b) | `function_publications.jsonl` |
| assembly | the binder registers it; a view runs at each state | binder versions, view rows |
| semantic use | calls, view outputs read in later decisions | `component_runs.jsonl`, later code and reasoning |
| feedback / retire | the agent edits, restores or retires it | binder versions |

## 4. Build order (no paid runs)

1. Base: `claude/r04-20261017` at `6c513fd4`, the su15 loop's version with r04's items 1–7. The ledger (item 6) stays
   in the code and is switched off in E-H's runs (`ARC_REFINE_LEDGER=0`), to keep the factors apart.
2. Part H: H1a-H1d, H2a-H2c, H3a, each with unit tests; the `promotion` and `nativeclaims` smokes; a scripted smoke
   that writes a prose check, a check that mostly fails and two rivals.
3. Part S: S1a-S1c (port and tests from the codex branch), S2a-S2b, unit tests, and a scripted smoke that publishes a
   function and a view and shows the view's output at the next decision.
4. Offline acceptance:
   - H0: re-run every recorded check (both authors) with H1a's move; list every verdict that changes.
     `tools/arc_thin_recheck_claims.ts` does this; r04's item-5 table (14 su15 runs) is the result for everything but
     `bbox`.
   - Simulate H2a on the recorded check results: which hypotheses would have become contested, and when (su15-l1-3's
     `hyp.action6_moves_bottom` should cross; su15-l1-2's `hyp.floor_erosion`, 24 fails in 201, should not).
   - S0 on the recorded runs.
   - Full arc_thin TS suite against `6c513fd4`; the native smokes; the fork and refusal smokes.

## 5. Evaluation

**Replays first** (real provider, no ARC actions; ≤1.5M budget tokens):
- **R-H:** the decisions in which the agent wrote hypotheses, sent again with H1's schema and receipts, 2 samples
  each. Measure: the share of hypothesis writes with a Python check that compiles and decides at least one recorded
  move. Base: 7 of 72.
- **R-S:** decisions that opened with a repeated inspection (from S0), sent again with S1's API and S2's facts, 2
  samples each. Measure: publications and views the reply makes. Base: 0.
- Pass to the paid test only if R-H reaches at least 30% working checks, and R-S makes at least one publication in 10%
  of samples. A replay measures what one reply does, not whether the run uses it.

**E-H, the hypothesis loop** (one factor: H1-H3; ≤18M budget tokens):
- 3 full su15 runs (6M cap each, settings as L0/L1, `ARC_REFINE_LEDGER=0`) against the pooled six (L0, L1).
- Mechanism measures:
  - agent hypothesis writes with a working check;
  - hypotheses contested by their check that are narrowed, fixed, replaced or rejected within 15 actions;
  - rival pairs separated by a recorded move;
  - goal claims refuted by their checks.
- Outcome measures: levels per run (base 1.33), level 2 (base 2 of 6), budget tokens per action, GAME_OVERs.
- Claim holds if all three hold: at least 30% of agent hypothesis writes carry a working check; in at least 2 of 3
  runs every check-contested hypothesis is acted on within 15 actions; levels per run are not below the base.

**E-S, the payoff** (one factor: S1-S2; ≤18M budget tokens; after E-H, on the version E-H leaves):
- 3 full su15 runs, against E-H's three runs if Part H is kept, otherwise against the pooled six.
- Measures:
  - components the agent publishes and their later use;
  - identical redefinitions;
  - repeated opening inspections;
  - requests per action decision, and tokens after a decision's first request;
  - budget tokens per action;
  - levels.
- Claim holds if all three hold: in at least 2 of 3 runs the agent publishes a component it uses later (base: 0 in
  56); requests per action decision fall by at least 15%; levels are not below the base.

**Negative cases:**
- H: a contested hypothesis whose claim is right but whose check is wrong. The view says the check fails; whether the
  agent fixes the check or rejects the claim is counted.
- H: rivals are rare, so H3a seldom fires; its count is reported.
- H: the schema's resident cost raises tokens per action; this is measured.
- S: publications are made and not used (clutter).
- S: views grow the head.
- S: S2's facts are read and ignored.
- Both: thinking is off, which may limit planning; this stays as is and is recorded as a condition.

**Held-out check:** each E adds one run on a held-out game chosen by the fixed rule (≤6M), reported for its
mechanism measures only; one run says nothing about levels. The rule is not written yet; the game split is the first
item of the [publication review](../reports/2026-10-17-publication-readiness-review.md).

**Ordering against r04:** E-H and E-S come before r04's E2 (the ledger test). The ledger reports on the
refinements' EXPECT checks, which use the same check interface, so it is better tested on the interface H fixes.
r04's E1 points the same way: no hypothesis was written, so strict checks went untested, and the refiner used EXPECT
checks for beliefs and rules citing hypotheses that did not exist (H2c).

**Before any paid run:** the runner should wait out transport errors instead of counting them toward the refusal stop;
r04's E1 was ended by a gateway outage after 56 actions, and three runs share one gateway.

## 6. Budget

- Offline build and acceptance: no provider cost.
- Replays R-H and R-S: ≤1.5M.
- E-H ≤18M + 6M held-out; E-S ≤18M + 6M held-out.
- Each step needs its own authorization before it runs.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional correctness | Part H: passed; Part S: unverified (not built) | test fixtures, HTTP stand-in | §8 |
| Full-chain reachability | Part H: passed | scripted provider, mock SDK, production bridge, real Pi 0.87, WASI | §8, the `hypotheses` smoke |
| Autonomous adoption | Unverified | — | R-H, R-S, E-H, E-S |
| Net benefit | Unverified | — | E-H, E-S against the pooled base |

## 7. Relation to the backlog

`docs/deferred-research-todos.md`:
- **C** (hypothesis → experiment → evidence → revised conclusion): Part H supplies its missing steps, the evidence that
  reaches someone and the revision it asks for.
- **D** (continuity): S's components and H's checks are state that survives outside the transcript.
- **B** (double-check role): H3a compares rivals mechanically; judging them stays with the agent.

None of them closes with this plan.

## 8. Part H as built (2026-10-18)

On `claude/r04-20261017`, commits `5ca52682`–`575997a7` from `d473cb7f`, built test-first (each test seen failing
first). Nothing was run on the real provider. Part S is not built. The build ledger (rulings, test runs) is in the
worktree's `.superpowers/sdd/2026-10-17-hypothesis-loop-and-self-harness/progress.md`.

| # | As built | Where | Resident cost | Off switch |
|---|---|---|---|---|
| H1a | `bbox` on a check's move: `{top, left, bottom, right}` of the changed cells, None when none changed or the shapes differ, counted when first read; among the keys the strict KeyError lists; named in the refiner charter and the legacy check description | guest `_StrictTransition`, `_bbox` | none | — |
| H1b | The native memory tool's hypothesis items name key, question, claim, predicts, next_test, status and check (the move's keys and the goal form). The fields stay loosely typed, so the planner still reports a malformed field per entry | `NATIVE_CHECK_DESCRIPTION`, memory tool schema | +805 characters per request (the hypotheses property, 41 → 846), not the ≈450 estimated | — |
| H1c | A check field that defines no check (`def check(`, `check = lambda`) is kept as next_test, after one given with it; an existing check stays; the receipt shows the form | `planNativeMemoryUpdate` | none | — |
| H1d | Each check's source in `data/memory.md` and in native `memory(op="list")` | `renderHypotheses`, `ComponentContext.checkSources` | none in the head | — |
| H2a | A current check with ≥5 decided moves failing on at least half contests its hypothesis: a memory row `by: "check"`, `contested_at` the move where it first held; once per key, check version and claim; at each decision start and when a check is saved (receipt line). The decision view lists contested hypotheses first, with "! its check fails on F of D decided moves (…): narrow the claim to where it held, fix the check, or reject it" | `checkContest`, `contestByChecks`, `contestNotes`, `renderDecisionMemory` | one line per contested hypothesis | `ARC_CHECK_CONTEST_MIN=0` |
| H2b | One refinement event per check-contested hypothesis and check version ("… is contested: …; write a narrower HYPOTHESIS for where it held, or make the strategy's next experiment settle it"), answered by a HYPOTHESIS edit or a strategy rewrite; none for a key whose citing rule is already in dispute; not raised over the refiner budget | `contestEvents`, `promotionEvents`, `settlePromotion` | refiner input only | with H2a |
| H2c | RULE CHECKS says "cites hyp.x, which does not exist" apart from "no check behind hyp.y"; one refinement event per missing cited key, answered by a HYPOTHESIS edit or a rules rewrite | `ruleChecksText`, `PromotionView.missing` | when it applies | — |
| H3a | One line per question whose rivals carry checks: the latest recorded move separating two of them, or "no recorded move separates …" (both decided N moves / no move decided by both); at most 4 pairs | `rivalLines` | one line per such question | — |

- **Departures from the design** (the ledger's rulings): the refinements cannot rewrite a hypothesis, so H2b asks for a
  narrower one or the next experiment; H2c also raises a refinement event (only refinements write the rules prompt);
  all contested hypotheses come first in the view, not only those contested by checks; the contest is once per claim as
  well as check version; `memory(op="list")` lists every source (it has no key filter); H3a's lines sit after the
  CURRENT KNOWLEDGE block, outside its 4,000-character budget.

### Offline acceptance (2026-10-18, `C:/Users/qi/tmp/r04/h/`)

- **Unit:** 14 new tests; the files they are in pass: `arc_thin_refine_ledger` 15/15, `arc_thin_claims` 6/6,
  `arc_thin_native_memory` 6/6, `arc_thin_memory` 24/24, `arc_thin_promotion` 9/9.
- **Full arc_thin TS suite:** 188/193 (`checks/ts`). The 5 failures are the known ones, by name the same as at
  `7d2533bc` (activation 1, components 1, receipts 3); the installed-Pi action-surface test passed this time.
- **pytest:** 29/29. **Refusal smoke:** parts 1–5 as before. **Fork smoke:** as before.
- **Native smokes:** the same outcome as at `7d2533bc`, each stopping at its known check. The new `hypotheses` smoke
  passes its own checks in the full chain (real Pi, production bridge, mock SDK, WASI): the prose check kept as
  next_test and the contest in the receipt; the memory row `by: "check"` with `contested_at` 5; a later head with the
  contested hypothesis first, its line, and "#5 separates hyp.right (holds) from hyp.left (fails)"; sources in
  `data/memory.md`, none in the head; the contest answered by a refinement's narrower hypothesis. The promotion smoke
  now makes 4 refinement edits (3 before), as the new events add refinements.
- **H0 (the strict recheck, now with bbox):** none of the 29 check sources in these runs' memory logs reads `bbox`, so
  H1a changes no recorded verdict. The re-run with `tools/arc_thin_recheck_claims.ts` matched r04's item-5 table on the
  9 runs it finished (L0, L1, r2–r4: the same result and change counts) and was not completed for the other five.
- **H2a simulated on the recorded checks** (17 su15 runs, 25 checks, all refinement-written; `contest-sim.json`):
  - 12 of 25 checks would have contested their hypothesis; every one of the 12 stayed `open` in its run.
  - su15-l1-3's `hyp.action6_moves_bottom` crosses at #114 (233 decided, 172 fails), as the plan expected; su15-l1-2's
    `hyp.floor_erosion` (24 fails in 201) does not.
  - The results are as recorded: before r04, checks ran without the strict rule. su15-r2's
    `hyp.action6_requires_nonzero_target` (206 fails of 211) failed on a default the strict rule turns into errors, so
    11 of 25 under it.
  - Most crossings come early (#6–#15 in five runs), so in those runs the contest and its refinement would have come
    in the first refinements.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional correctness | passed | test fixtures, HTTP stand-in | the unit tests above |
| Full-chain reachability | passed | scripted provider, mock SDK, production bridge, real Pi 0.87, WASI | the `hypotheses` smoke |
| Autonomous adoption | unverified | — | R-H (replay), then E-H |
| Net benefit | unverified | — | E-H against the pooled base |

**Next** (each needs the user's budget): the replay R-H (≤1.5M of the replays' budget; R-S waits for Part S), then
E-H (3 su15 runs with `ARC_REFINE_LEDGER=0`, ≤18M, plus one held-out run, ≤6M). Before E-H: the runner's wait on
transport errors.
