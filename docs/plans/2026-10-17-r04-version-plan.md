# r04: the next version from the su15 loop and the online-correction work (plan, 2026-10-17)

Status: built on `claude/r04-20261017` (worktree `worktrees/r04`, from `009c6825`), items 1–7; offline checks below.
E1 ran on 2026-10-17 and was cut short by a gateway outage after 56 actions; no shakedown criterion failed, and one
recording bug it found is fixed (E1 results below). Later on 2026-10-17 the online-correction session was folded into
this line, which is now the one branch to track: its records and its plan for the hypothesis loop and the self-harness
are in `docs/plans` here, and that plan puts its tests before E2 (see Next, under the E1 results).
User, 2026-10-17: "build r04, then run E1". Base for the build: `claude/r03b-repeat-20261016` at `2b9cc6ac` (r03b +
the su15 loop's fixes). Follows [the development workflow](../development-workflow.md). Inputs: [the su15 level-2 loop](2026-10-17-su15-level2-loop.md),
the online-correction session's records ([refinement ledger](2026-10-16-refinement-ledger.md),
[refinement package](2026-10-17-refinement-package-loop-candidate.md), [merge check](2026-10-17-merge-simple-ledger-repeat.md)),
and the branch inventory below.

## Decisions this plan rests on

- **Agent-native (user, 2026-10-17).** Every component that runs inside a run uses the agent's model, qwen3.8-27b. A
  stronger model may analyze inside our development loop, between runs.
  - L2 as proposed (refinements on gpt-6.1-sol) is withdrawn as a change to the version. `ARC_REFINE_MODEL` stays on
    its branch, for offline replays only.
- **Base.** The integration line stays r03b. R1 (2026-10-16) put the r03b-simple line below it on su15, so that
  line's r2–r10 changes are not brought in.
- **Baseline.** Six full su15 runs of the unchanged agent (L0 and L1; L1 acted on 11 plays): level 1 in 5 of 6,
  level 2 in 2 of 6, level 3 in 1 of 6.
- **One factor per paid test.** Fixes that make the record correct are accepted offline. A change to what the agent
  or its refiner is shown is tested in runs.

## Jev (question of 2026-10-17)

- **What it is.** `pi-jev` 0.5.0 (in `package.json`) calls TypeSafe's hosted judge `jev-latest` (`/v1/systemone`).
  It returns typed answers to questions it is given: a category (`choice`), the probability of a yes/no statement
  (`noul`), or a score. See `docs/pi-jev-core-features-analysis-2026-10-09.md`.
  - Our only adapter, `demo/pi_jev_harness_routing.ts` (`PI_AUTORESEARCH_JEV_ROUTING`), selects Self-Harness
    components and was never switched on.
  - No TypeSafe key is configured on this machine.
- **Agent-native?** No. `jev-latest` is a third model, so inside a run it has gpt-6.1-sol's problem.
- **Would it fix what failed?** No. A judge ranks statements; it does not write them.
  - The failure is that no one proposed the missing test: the qwen refiner did in 0 of 48 replayed refinements.
  - In su15-l1-1 the qwen refiner went the other way and wrote a check for the agent's one-cell move model (#67).
  - A judge choosing among qwen's proposals chooses from a pool that lacks the test.
- **Where the typed-judgment pattern could help, run on qwen.** Narrow yes/no questions that code cannot settle:
  - did the agent play what a refinement proposed (adoption);
  - does an edit repeat a line whose expectation already failed (l0-1's refiner rewrote one goal line seven times).
  - These go to the ledger below, and would be tested by replay before being built. Not in r04.

## What the online-correction session established

- **The carrier.** The scheduled refiner, with two additions built and tested on the r03b-simple line:
  - **EXPECT:** an edit may state what the next moves should show, as a `check(t)`;
  - **the ledger:** each refinement opens with its last edits and what followed (met, contradicted or not seen;
    rewritten or deleted; tool calls; GAME_OVERs).
  - Commits `fe9dccd6` and `009b670c`, the latter making expectation checks strict about missing keys.
- **Real play on qwen** (the F2 source runs): the refiner wrote an EXPECT with every edit (9 of 9). One refinement
  rewrote a strategy because its earlier edit was not followed (src2 #77). No ledger-off comparison exists.
- **Replay.** A measurement step did not help qwen. Only gpt-6.1-sol proposed the missing test, which is now outside
  the version.
- **Open bug, also on the r03b line.** Hypothesis checks run on transitions carrying `action`, `x`, `y`,
  `level_changed`, `state`, `levels_completed` and the grids (`refreshClaimChecks`), not `changed_cells`.
  - A check written as `t.get('changed_cells', 0)` silently reads 0.
  - 6 of the 14 hypotheses refinements wrote in su15 r2–r9 read that key. In su15-r2 one recorded 206 fails and 5
    holds on that default.
  - Those counts decide which rules are promoted or disputed.
- **Merge check.** `claude/merge-20261017` shows the lines merge as code. Its base is the weaker line.
- The r03b line does not log refiner inputs or replies, so L0's and L1's refinements cannot be replayed.

## Branch inventory (2026-10-17)

| Line | Commits that matter | Where |
|---|---|---|
| r03b | `cf419ec3` environment restart on `deecdde6` | `worktrees/r03b-restart` |
| su15 loop | `f581f918`, `5751333a` collapse and `provider_error` stop; `95a3803f` loop guard counts repeats that succeeded; `33f4c5bf` snapshot and stop at a level; `f3d1d2b1` L1 guards | `claude/r03b-repeat-20261016`, an ancestor of r04 |
| online correction | `fe9dccd6` ledger, EXPECT, `ARC_REFINE_MODEL`, refiner logs; `009b670c` strict expectation checks (on r03b-simple `1d60dcf1`) | `claude/refiner-ledger-20261016` |
| loop port | `8686067f` `ARC_REFINE_MODEL`, discriminating charter, refiner logs (on `33f4c5bf`) | `claude/refine-model-r03b-20261017` |
| r03b-simple | r2–r10 (facts in the head, meter lines, click-distance facts, rivals) | `worktrees/r03b` |

When the sessions were folded together (2026-10-17), the worktrees of the su15 loop, the online correction, the loop
port, the merge check and the hypothesis plan were removed; their branches remain.

## r04 composition

| # | Component | From | In r04 | Evidence | Off switch |
|---|---|---|---|---|---|
| 1 | Environment restart | `cf419ec3` | yes | real runs: two restarts recovered | — |
| 2 | Collapse of repeated calls (across prompts), `provider_error` stop, loop guard on repeats that succeeded | `f581f918`, `5751333a`, `95a3803f`, `f3d1d2b1` | yes | gateway replay 2/2; L0 recovery; no provider stop in L1 | `ARC_THIN_COLLAPSE_REPEATS=0`, `ARC_THIN_LOOP_RESULTS=0` |
| 3 | Repeat-without-effect refusal; unavailable action refused with what is available | `f3d1d2b1` | yes, as a guard | L1: claims held, 11 plays affected | `ARC_THIN_NO_EFFECT_REPEATS=0` |
| 4 | Snapshot and stop at a level | `33f4c5bf` | yes (tooling) | fork smoke | — |
| 5 | Hypothesis checks: transitions carry `changed_cells`; a missing key is a check error shown on the hypothesis, not a default | new; expectation side as `009b670c` | yes, as a correctness fix | `tools/arc_thin_recheck_claims.ts` over 14 recorded runs (below) | none: each run's `claim_checks.jsonl` keeps the earlier rule's results, and the recheck tool compares |
| 6 | Refinement ledger and EXPECT, with strict expectation checks | `fe9dccd6`, `009b670c`, ported | yes: **the factor r04 tests** | F2 sources: EXPECT 9/9, one edit acted on | `ARC_REFINE_LEDGER=0` |
| 7 | Refiner input and reply logs; model on usage rows | `fe9dccd6` / `8686067f` | yes (measurement) | — | always on |

**Not in r04:**
- `ARC_REFINE_MODEL`: the agent-native decision.
- The discriminating charter: qwen proposed the missing test in 0 of 48 with it. It would come back only if a replay
  shows it helps qwen.
- r03b-simple's r2–r10: R1, and several are shaped by su15 (r9's click-distance facts, r7/r8's meter lines).
- r10 rivals: no gain in its fork test.
- `env.ask`: runs not authorized.
- Jev.

## Build order (no paid runs)

1. **Branch.** `claude/r04-20261017` from `2b9cc6ac`, worktree `worktrees/r04` with the `node_modules` junction.
   Items 1–4 come with it.
2. **Item 5, then its acceptance.**
   - Unit tests.
   - Re-run the hypotheses refinements wrote in su15 r2–r9 (their sources are in those runs' memory logs) over their
     recorded transitions, with the earlier and the strict rule. List every verdict that changes.
3. **Items 6–7.**
   - Port the ledger and EXPECT onto r04, reusing `8686067f`'s port of the logging without `ARC_REFINE_MODEL`.
   - The ledger tests (8/8 on the source branch), the `schedule` and `promotion` smokes, and the full arc_thin TS suite
     against `2b9cc6ac`.
4. **Development-loop tools,** outside runs; a stronger model is allowed here.
   - The measures move into `tools/` (`l1-measures.mjs`, `level-spend.mjs`, the repeat counter).
   - The refinement replay (`replay_diag.py`), with blind grading.
   - A post-run analyst: one call per finished run to a stronger model, over those measures, the refiner's edits and
     the trajectory. It answers our template (failures, the broken transition, a general candidate change) for us to
     review; nothing returns into the run.

## As built (2026-10-17)

- Items 1–4 of the composition come with the branch (the loop line at `2b9cc6ac`).
- **Item 5, strict checks** (`demo/arc_thin_skill_guest.ts`, `demo/arc_thin_extension.ts`):
  - Hypothesis checks, their controls and expectation checks see a move on which `t.get` of a key the move does not
    carry raises a KeyError that names the keys it has; x and y stay optional.
  - `t['changed_cells']`, `t.get('changed_cells')` and `t.changed_cells` give how many cells differ between the move's
    two grids, counted when a check first reads it.
  - The refinement charter and the legacy memory tool's check description name `changed_cells` and the strict reading.
    The native system prompt is unchanged: a check that reads a wrong key now shows its error, with the keys a move
    has, on the hypothesis line.
  - No switch back: each run's `claim_checks.jsonl` keeps what the earlier rule gave, and
    `tools/arc_thin_recheck_claims.ts` re-runs a run's checks under the strict rule.
- **Items 6–7, ledger, EXPECT and logs,** ported by hand from `fe9dccd6` and `009b670c` (the r03b line's refiner
  differs from the r03b-simple line's):
  - `arc_thin_refiner.ts`: `REFINER_LEDGER_SYSTEM`, `renderEditLedger`, `parseExpect` (with "within N:" as a horizon),
    EXPECT kept on FILE, MEMORY and HYPOTHESIS edits, and MEMORY lines with bracketed `[replaces …]` accepted.
  - `arc_thin_extension.ts`:
    - the refiner's notices are a list carrying the edit's id, and the decision that shows one records `told` in
      `refiner.jsonl`;
    - edits get ids `e<n>` and keep their expectation (`within` defaults to `ARC_REFINE_EVERY`), or why it was not used;
    - each refinement opens with YOUR EARLIER EDITS after ACTIONS SO FAR;
    - `refiner_inputs.jsonl` and `refiner_replies.jsonl` keep every input and reply;
    - usage rows and refinement starts name the model.
  - Differences from the source branch:
    - the ledger's "after #N" is the action count when the refinement ended, as the r03b line's notice says;
    - a hypothesis's check counts include "raised N";
    - an EXPECT that could not be used is listed with its reason.
    Not ported: `ARC_REFINE_MODEL`, the source line's notice wording (`evidenceSince`) and its fixed-step trigger text.
- **Item 4, development-loop tools,** outside runs:
  - `tools/arc_run_measures.mjs`: the loop's measures, per level.
  - `tools/arc_refine_replay.py`: logged refinement inputs under a variant, on the agent's model by default, with
    results shuffled for blind grading.
  - `tools/arc_post_run_analyst.py`: one call to a stronger model over a finished run's digest, answering the
    development template; `--digest-only` makes no call.
  - `tools/arc_thin_recheck_claims.ts` (item 5's acceptance).

### Item 5's acceptance: recorded checks re-run under the strict rule

`tools/arc_thin_recheck_claims.ts` over the 14 su15 runs with recorded checks (`C:/Users/qi/tmp/r04/quick`):

| Runs | Checks re-run | Results compared | Results that change |
|---|---|---|---|
| L0 ×3, L1 ×3 (r03b line) | 9 | 1,484 | 0 |
| r5, r6, r8b | 5 | 1,065 | 0 |
| r2 | 1 | 260 | 211: 206 fails and 5 holds become errors |
| r3 | 2 | 480 | 9: n/a becomes holds |
| r4 | 1 | 48 | 28: n/a becomes errors |
| r7 | 3 | 394 | 23: fails become errors |
| r9 | 2 | 416 | 198: n/a becomes errors |

- Every changed result belongs to one of the 6 checks that read `changed_cells` (5 refinement-written, 1 the agent's).
- Five of them treated it as a list of cells (`len(t.get('changed_cells', []))`, `for c in changed`). Under the
  earlier rule each computed on the empty default, so 460 verdicts were made on nothing. Strictly they raise
  ("object of type 'int' has no len()"), and the error now shows on the hypothesis line.
- r3's check compared the count and gains 9 real holds.
- No check that read only present keys changed. The 9 checks of L0 and L1 were unaffected.

### Checks (2026-10-17, `C:/Users/qi/tmp/r04`)

- **Unit:** new `tests/arc_thin_refine_ledger.test.ts`, 7/7:
  - EXPECT parsing, with "within N:" as a horizon and malformed blocks named;
  - ledger rendering and its size bound;
  - bracketed `[replaces …]`;
  - in the extension:
    - a later refinement is told that an expectation was met (#4) and that the agent deleted a memory entry (#5);
    - `told` rows are recorded when the edit is shown (e1 at 3, e2 at 5);
    - inputs and replies are logged with the model;
    - a refined hypothesis's check counts since it was shown;
    - strict checks: a hypothesis check reads the real `changed_cells`, an expectation reading `changed` and the
      agent's own check reading `predict` raise with the keys a move has;
  - `ARC_REFINE_LEDGER=0` restores the earlier input and charter.
  - The repeat refusal is off in that fixture: its object moves one cell per action, so 2 cells change on every move,
    the known false positive.
- **Full arc_thin TS suite:** 172/178.
  - The 5 known failures (activation, components, receipts ×3) fail on `2b9cc6ac` too; the 7 extra tests are the new
    file's.
  - The sixth, the installed-Pi action-surface test, was a 20 s Pi start timeout under load; alone it passes 2/2.
- **pytest:** 29/29. **Refusal smoke** parts 1–5 and **fork smoke** parts 1–5: pass.
- **Native smokes:** the same outcome as on the L1 tree, each stopping at its known check. `promotion` also checks the
  ledger in the full chain:
  - the hypothesis edit is e1 with its expectation;
  - three `told` rows;
  - later refinements see YOUR EARLIER EDITS, with `memory hyp.right (still as written)`, its check counts, and
    "expected within 3 … met at #";
  - every input and reply is kept with the model.
  - Its run is now 11 decisions instead of 10. The ledger's sandbox check before the model call made the dispute
    refinement take 3.5 s instead of 0.5 s, so the revised rule landed one decision later.
- **Development tools:**
  - `arc_run_measures.mjs` reproduces the loop's measures for su15-l1-1.
  - The analyst's digest of su15-l1-1 is 48,067 characters.
  - The analyst's first real call (gpt-6.1-sol) sent nothing for 15 minutes and timed out, unlike the replay's 15–60 s
    replies. The tool now waits 5 minutes per read and tries once more.
  - End to end: the retry on su15-l1-1 worked (160 s; 16,160 prompt tokens, 16,000 of them cached; 3,667 completion).
    On su15-r04-e1 it answered in 17 s without a retry (7,337 prompt and 3,695 completion tokens; digest 13,431
    characters); its reading is under the E1 results.

### E1 (launched 2026-10-17)

- su15-r04-e1 in `D:/autoresearch_pi_project/runs/arc-r04-20261017`, on the commit that adds r04.
- The su15 loop's settings: `0 6000000 0 SNAPLEVEL=1`, thinking off, yibu / qwen3.8-27b.
- Launcher `C:/Users/qi/tmp/r04/launch-su15-r04.cmd`.
- **Budget:** at most 6M budget tokens.
- **Shakedown measures:**
  - edits with ids and expectations;
  - `told` rows;
  - refinement inputs with YOUR EARLIER EDITS;
  - expectation outcomes;
  - the share of check results that are errors, and whether the agent repairs such checks;
  - inputs and replies logged for every refinement;
  - `refiner:ledger` and `refiner:expect` errors in `errors.jsonl`.

### E1 results (2026-10-17)

Measures `C:/Users/qi/tmp/r04/e1-check` (`status.txt`, `shakedown.json`, `measures.json`); the analyst's reading in the
run's `arc-run/analysis/post-run-gpt-6.1-sol.md`.

| Run | Actions | Levels | GAME_OVERs | RESETs | Budget tokens (refiner) | Stop | Provider errors |
|---|---|---|---|---|---|---|---|
| su15-r04-e1 | 56, on level 1 | 0 | 1 (#56) | 3 | 0.59M (40k) | `provider_error` on level 1 | 4 decisions, 19 failed requests |

- **A gateway outage ended it.** Play ran 12:03–12:29 local. From about 12:31 every request failed: the consolidation
  after the GAME_OVER timed out four times, then three decisions got "Connection error." four times each, and the runner
  stopped on the third identical error at 13:04. A chat probe on qwen3.8-27b during those decisions was cut off after
  62 s; by 13:20 qwen3.8-27b and gpt-6.1-sol answered (2.5 s, 7.0 s). The failed requests report no usage.
  - The stop rule was written for the gateway's refusal of repeated calls, which waiting does not cure. It stops on
    transport errors too, which waiting does.
- **Shakedown: no criterion failed; the plan continues.**

| Criterion | E1 |
|---|---|
| Edits carry ids, some an EXPECT | ids 9 of 9; EXPECT 7 of 9, none malformed |
| `told` rows | 9: each edit shown once (the ninth at decision 30, during the outage) |
| Later inputs show YOUR EARLIER EDITS with outcomes | all 8 inputs after the first edit; across them the expectation lines read met 8, contradicted 2, raised 2, not seen in time 3, not yet decided 2, not yet shown to the agent 4 |
| Inputs and replies logged | 9 and 9, model `qwen3.8-27b` |
| `refiner:ledger`, `refiner:expect` errors | none; no `errors.jsonl` |
| Strict checks: share of errors, repair | not testable: no hypothesis was written in E1. One of 7 expectation checks raised (e3 read `t.get('_n', 0)`); the next two inputs showed the KeyError with the keys a move has. |

- **The edits** (each expectation's last outcome in the ledger):

| Edit | After | Target | Expected (within) | Outcome |
|---|---|---|---|---|
| e1 | #7 | `prompts/rules.md` v1 | ACTION6(20,30) places a 3×3 block (2) | contradicted at #9 |
| e2 | #8 | `prompts/rules.md`, the same three rules again (still v1) | an ACTION6 places a block and erases one (2) | met at #11 |
| e3 | #9 | memory `hyp.border_cost`: refused by memory, recorded as applied (fixed below) | 2 more bar cells erased (3) | its check raised at #11 |
| e4 | #10 | `prompts/strategy.md` v1: a goal test with ACTION7 | ACTION7, or a click on a block (3) | met at #12 |
| e5 | #12 | `prompts/rules.md` v2: ACTION7 is not a no-op | ACTION7 tried in another configuration (3) | not seen in 3 |
| e6 | #15 | `prompts/strategy.md` v2: click another cell | ACTION6 on a cell other than (10,53) (3) | met at #19 |
| e7 | #30 | memory `border_erasure_rule` | — | — |
| e8 | #41 | `prompts/strategy.md` v3: a goal test now; "more than 5 actions on border-cost mapping" as a failure mode | ACTION7 as a goal test (3) | shown at #56, after the GAME_OVER |
| e9 | #56 | memory `border_depletion_gameover`, replacing e7's entry | — | shown at decision 30; the run ended |

- **The refiner with the ledger** (one run; nothing to compare without it):
  - It read the record: two rewrites name a stale next experiment (e6, e8), and e5 replaced the rule "ACTION7 changes
    0 cells" after #12 changed 18.
  - After its two unmet expectations it did not repeat the edit: after e1's contradiction (#9) and e5's miss its next
    edits went elsewhere, and e8 turned e5's open question (what makes ACTION7 act) into a goal test. Nothing here shows
    whether the ledger caused that.
  - A contradicted expectation did not narrow the rule it tested: rules v2 (#12) kept the ACTION6 line e1's expectation
    rested on ("places a 3×3 block … centered on (x,y)"), though the agent's memory had said since #10 that only
    clicks on 0-cells place one.
  - e2 spent a refinement re-issuing rules v1 unchanged, with a new expectation.
  - Expectation checks served as checks of game rules (e1–e3) as well as of the agent's play (e4–e6, e8). The rules
    cite `hyp.action6_mechanic`, `hyp.border_cost` and `hyp.action7_noop`, which never existed, and the one belief
    turned toward a hypothesis was written as `MEMORY hyp.border_cost`, the first such edit in all recorded runs. No
    checked hypothesis came into being, though "no hypothesis carries a check" was a trigger 5 times. The refiner of the
    six base runs wrote 10 checked hypotheses in 150 refinements, at least one per run. One run cannot say whether
    EXPECT takes their place; E2 counts it.
- **The agent.** Level 1 was not completed by #56; the base completed it at #26, #31, #34, #56 and #83, and l0-2 never.
  - It played 2 of the 3 proposed tests that could be judged: e4's goal test at the next action, e6's other cell
    within 3; not e5's.
  - #26–#56: 31 actions in a row each changed only 2 cells of the bottom bar, 30 of them in three python sweeps of
    clicks one cell apart (decisions 25, 26 and 28), until the bar was empty and the game over. Its code printed "LEVEL
    COMPLETE" on the GAME_OVER; the next decision recorded the GAME_OVER correctly, and its memory then read the bar as
    a finite resource, as e9 did.
  - This is su15-l0-2's failure (30 identical clicks that changed only the bar) with the coordinates varied, so L1's
    refusal of identical repeats never fired (`refused_no_effect` 0). The L1 record names this gap.
  - e8, which named that failure mode, landed 2 s after decision 28 began, and that decision's one python call played
    #42–#56. Refinement notices reach the agent at decision starts only.
- **Fix after E1 (record correctness, accepted offline).**
  - A refinement's MEMORY or HYPOTHESIS edit that the memory component refused was recorded as applied:
    `planNativeMemoryUpdate` accepts calls in part, so a set it skips entirely comes back `ok` with no rows. e3 (a
    `hyp.` key belongs to a hypothesis) got an id, a notice to the agent, an expectation check, and the ledger line "no
    longer in memory".
  - Such a reply is now recorded as `invalid` with the memory component's reason: no id, no notice, no ledger line. The
    r03b line has the same code.
  - Checks: `tests/arc_thin_refine_ledger.test.ts` 8/8 (one new), `arc_thin_memory` 23/23, `arc_thin_promotion` 9/9,
    `arc_thin_analyst` 2/2; the promotion smoke passes its ledger checks and stops at its known check
    (`system_chars`), as before.
- **The post-run analyst on E1** (gpt-6.1-sol, development loop): it names the untried ACTION7 test and the missing
  hypotheses. It blames the #42–#56 sweep on the agent continuing after the refiner's warning, which, as it says
  elsewhere, the agent had not been shown. Its proposed change, a structured checkpoint before each repeat after a result
  that did not confirm a prediction, is a standing obligation on the decision path; not adopted. Its digest does not
  contain the agent's code.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional | passed | test fixtures | the unit tests above |
| Full chain | passed | scripted provider; mock SDK; production bridge; real Pi 0.87 | promotion smoke's ledger checks |
| Real provider | mechanisms work in real play | yibu / qwen3.8-27b, thinking off | su15-r04-e1: one run, 56 actions, ended by an outage |
| Autonomous adoption | partial | same | the agent played 2 of 3 judged proposals; after 2 unmet expectations the refiner did not repeat the edit, nor narrow the contradicted rule |
| Net benefit | unverified | — | one truncated run; level 1 not completed |

- **Next** (revised when the sessions were folded together, 2026-10-17):
  - The [hypothesis loop and self-harness plan](2026-10-17-hypothesis-loop-and-self-harness.md) goes first; the user
    ranked those two problems highest. Part H is built on this branch (offline, no provider cost), then the replays R-H
    and R-S (≤1.5M), then E-H (3 su15 runs with `ARC_REFINE_LEDGER=0`, ≤18M, plus one held-out run, ≤6M). Each paid
    step needs the user's approval. Part H was built and checked offline on 2026-10-18 (that plan's §8).
  - E2 follows E-H and E-S, as that plan orders them. E1 does not count as one of its three runs (it did not run to the
    end): three full su15 runs, at most 18M budget tokens.
  - Before any paid run: the runner waits out transport errors ("Connection error.", "Request timed out.") instead of
    counting them toward the refusal stop. Runner only, nothing new for the agent; checked offline with the refusal
    smoke. Runs share one gateway, and E1's outage would have ended all of them. Built 2026-10-18
    ([self-evolve loop](2026-10-18-self-evolve-loop.md), iteration 1): 30 s doubling to 300 s, at most 3600 s per run.
  - Added to E2's measures: checked hypotheses written by the agent and the refiner (base: the refiner's 10 in 6 runs);
    refinement notices that arrive after a decision began; runs of 10 or more consecutive actions with varied arguments
    that change only the cells every action changes.
  - What a paper needs beyond this line: the [publication readiness review](../reports/2026-10-17-publication-readiness-review.md).

## Evaluation (each step needs its own budget)

- **E1: one shakedown run.** One full su15 run on r04, at most 6M budget tokens.
  - Checks: the ledger and EXPECT work on the r03b line in real play; strict checks raise no flood of errors; the
    refiner's inputs are logged.
  - It stops the plan if any of these fails.
- **E2: the ledger test.** Three full su15 runs on r04 against the pooled six, at most 18M (E1 counts as one of the
  three if it ran to the end with the same settings).
  - **Claim:** with its own edits' outcomes in view, the refiner changes line after an unmet expectation, and
    levels per run are no worse than the pooled base (1.33).
  - **Mechanism measures:** EXPECT met, contradicted and not seen; rewrites of a line after its expectation failed
    (l0-1 rewrote one seven times); the agent playing a refinement's proposed test within 10 actions.
  - **Outcome measure:** level 2 completed (base 2 of 6). Three runs separate only a large effect; 2 of 3 at a base of
    1 in 3 happens by chance about 26% of the time.
- **E3: replays between runs.** With item 7, every r04 run logs its refinements, so qwen refiner variants (a typed
  question, a charter) can be replayed on them and graded offline before any is built.

## Deferred items this touches

`docs/deferred-research-todos.md`:
- **B,** a double-check role: the ledger is the refiner reviewing its own edits.
- **C,** hypothesis → experiment → evidence → revised conclusion: EXPECT tracks that chain for refinements, and item 5
  makes the hypothesis side honest.
- **D,** continuity: the collapse rewrites history after repeats.

None of them closes with r04.
