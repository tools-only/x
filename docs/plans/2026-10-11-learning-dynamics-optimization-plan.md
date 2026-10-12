# Learning-dynamics optimisation plan for the thin ARC self-harness (final, 2026-10-11)

Status: design, revised after review by Codex (GPT-6 Astra) and a check of its claims against the code and the run logs. Supersedes the first version of this file.

Principles held (memory and user direction):
- general mechanisms only, with no game content;
- derived analysis (objects, motion, goal inference) is the agent's own tool; the project supplies foundations and services;
- the ledger, critic and board are services and keep running;
- capability statements, not directives;
- reasoning stays on. The yibu/qwen route accepts only an on/off flag (`enable_thinking`), so "on, provider default" is the fixed setting; no level can be set.

Evidence:
- `runs/pi-arc-thin-critic-hypstrategy-ls20-real-20261011` (68 actions, reasoning off; [review](../reports/2026-10-11-hypstrategy-ls20-review.md));
- `runs/thin-sh-r4-ls20-reason-20261011` (110 actions, reasoning on; priority plan §10.29);
- `runs/thin-sh-d3-ls20-20261010` (62 actions, reasoning on, the only thin run that cleared a level);
- the load analysis ([report](../reports/2026-10-11-agent-load-analysis.md)).

## 1. Diagnosis

Learning a game's dynamics is a loop: observe → find what an action did → state a model → test it cheaply → keep beliefs current → explore what is unknown → test the goal. The table checks each step against what the agent was actually given.

| Step | What the agent gets | Gap, with evidence | Kind of gap |
| --- | --- | --- | --- |
| Observe | the current grid as run-length text; no image | a moved 5×5 block was read as "extends up" and "toggles a region" for 40 actions | capability untested (image) |
| What an action did | nothing from the project; the agent's own diff skill, run with `args={}` and shown every decision | the skill's default compared with **frame 0**, so the standing reading was "difference from the start"; the agent reset before every experiment to make it meaningful: 15 of 68 actions were RESETs | convenience: the foundation (`prev_grid`, `history.grid(n)`) exists; the default was the agent's, and nothing explained what the observer runs on |
| State a model | free-text facts and claims | no executable form; "A2 minimal" stayed for 40 actions | capability: the agent could write one as a skill, never has in ~30 runs |
| Test it cheaply | only by acting (`predict` checks the next action) | "A1 moves up 5" was tested by acting at #23, #34, #40–43, #51–55, #57–62 | convenience: `history.transitions()`/`grid(n)` exist, so a backtest is writable; no run ever wrote one and nothing shows its value |
| Prediction feedback | hit/miss per field | 281 of 291 fields right in round 4, 0 goal checks: almost all predictions were "nothing happens" and read as confirmation | accounting |
| Keep beliefs current | facts by key, compact view | `obs.action1_alone` ("toggles"), `obs.action_model_v2` ("extends"), `obs.action_model_v3` ("corrected") shown together at decision 77 | convenience: `set`+`delete` in one call exists; replacing is not the natural path |
| Explore the unknown | REPEATS line (fired 4 times), IDEAS effort | no view of which actions were tried from the current observation | missing count |
| Action costs | action list, budget | RESET's effect and cost are not stated; it was used as a free baseline | environment documentation |
| Test the goal | GOAL CHECKS line | **defect:** counts only hypotheses whose question is exactly `"goal"`; the agent wrote "what is the goal?", so the line said "none" all run while `hyp.goal_right` was never tested | bug |
| Critique | critic notes | **defect:** every substantive line ("goal unresolved, zero WIN checks", "strategy stalled", at #10, #22, #39, #56, #67) was **dropped by the parser** for lacking a `#N` citation; the label complaints, which cited actions, got through | bug |
| Management | review every 4 actions, 96 memory writes | 16 reviews + 18 action-less decisions for 68 actions; ≈15k input tokens per action; token cap at 68/100 | cost |

Answer to the question: no. The foundations for learning dynamics mostly exist, but the path from "I have a rule" to "checked against what already happened", and from "I corrected a belief" to "the old one is gone", is neither visible nor automatic; two services that should have caught the untested goal were broken; and the feedback cannot distinguish an informative prediction from a trivial one. Reasoning lets the model use what it gets; it does not supply these.

## 2. Plan

Order: repairs first, then the backtest, then belief replacement and exploration counts, then perception and continuity as separate A/Bs. Each item names its gap, who advances it, and its falsifier. None adds runtime analysis of the game.

### Phase 1: repair feedback delivery (small, no new surface)

**1.1 Goal coverage recognises the agent's own goal questions.** Treat a hypothesis as a goal hypothesis when its question or key mentions goal, win, objective or level (compatibility heuristic, not recognition); show the line only when it has content. Falsifier: replaying the hypstrategy memory log must list `hyp.goal_right` as untested from #1.

**1.2 Critic delivery.** Keep lines that cite an action (`#N`, `#N–#M`), a hypothesis or strategy key (`hyp.x`, `strat.y`), or an action count ("N actions"); drop only lines that cite nothing. Drop exact repeats of an earlier kept line; the instruction asks for new points unless evidence changed. No overlap-based dedup. The dossier carries the previous notes (already does). Falsifier: on the hypstrategy critic replies, the "goal unresolved / zero WIN checks" lines are kept; fabricated-citation lines are still dropped.

**1.3 What the observer runs on.** The capability text states how automatic runs work: each saved skill runs with `args={}` on every new state with `grid`, `prev_grid`, `history` and the action index; the default computation is the agent's choice, and what it returns is what it reads at every decision. No instruction to compute a diff.

**1.4 RESET at the adapter boundary.** Verify at the bridge what RESET does and costs (deferred item A); then state it in the action surface and count resets in the budget line.

**1.5 Review cadence from mechanical triggers.** A review is due on a scored miss, a level change, GAME_OVER, or N actions without a recorded test; otherwise every 25. No "new state class" trigger (it would need a judgement). Evaluate cadence on its own.

Not changed: the `idea_kept` escalation (a trigger that has never fired; its label-based logic is crude but harmless).

### Phase 2: models checked against recorded history (main lever)

**2.0 Reuse check first.** Inspect the unwired evidence-board replay (`demo/pi_harness_board.ts`) and `predictWithSkill`/`buildHistory`; build on them if they fit.

**2.1 Backtest service.** The agent may save a skill as a model: `run(state, args)` with `args={"action": …}` returning predicted cells (or a region) for the next state, or for a goal model, whether the level should change. The runtime replays it over recorded transitions and shows, under the skill line: transitions covered, predicted right, predicted wrong, abstained (no output), and up to three counterexamples chosen from different outcomes. Full results on demand via `run_skill`.
- Hygiene (from the review): the model sees only the state before each transition (no outcome, no later transitions, no later memory); results are split into **fit** (transitions that existed when the model was saved) and **later** (transitions after it); RESET transitions are reported separately; replay once at save and once per new action after that; a few correct background cells do not count as "predicted exactly" — the comparison is over the cells the model claims.
- Goal models: a counterexample is a recorded transition where the model's stated condition held and the level did not change. A transition where the condition did not hold is not evidence either way. The report says which.
- Who advances: the agent writes and revises the model; the runtime replays and compares (the existing prediction-checking service applied to history). No game analysis by the project.
- Burden removed: testing a rule costs zero actions and covers all past evidence; the reset-and-retest pattern loses its reason.
- Falsifiers: (a) adoption: a model skill saved, and revised after a counterexample, in a real run; (b) effect: actions until the agent has a movement model with no counterexamples in the fit set, against 48 (hypstrategy) and the round-4 figure; (c) later-set accuracy must be reported, not only fit.
- Limit: a backtest cannot test unseen conditions (a wall the block never reached). That exploration still costs actions, and the coverage figure says so.

**2.2 Prediction accounting.** Beside each scored prediction, report how many predicted values claim a change from the current grid and how many claim no change, with their outcomes; and for `level_changed`/`state`, whether the value was the "nothing happens" outcome. Counts only; no ratio and nothing rewarded. The agent and critic judge whether a prediction separates explanations.

### Phase 3: current beliefs and directed exploration

**3.1 Replacing a belief.** `memory(set=[{key, text, replaces:["old.key", …]}])` retires the named facts in the same atomic call; the view shows "N facts superseded since #n" instead of them. The boundary repair does not infer replacement from names. Falsifier: facts with the same key stem shown together per decision, against the decision-77 case.

**3.2 Exploration counts.** From identical observations (exact grid hash, not the masked one): "from this observation: ACTION1 tried 3× (same result each time), ACTION3 never". Novelty: "new observations in the last 10 actions: k". Broader state equivalence is the agent's to define in a skill. Falsifier: identical experiments (same observation, action, result) per 100 actions.

### Phase 4: perception and continuity (separate A/Bs)

**4.1 Frame image as raw observation.** `--input-modalities text,image` for the parent (P040 shows the gateway accepts it). Measure retracted claims about what an action did, and input tokens per decision.

**4.2 Carried conclusion** (`--carry-reasoning`, already built). Measure re-derivation share and reasoning tokens per action.

### Out of scope

Project-side object detection or grid helpers (user decision 2026-10-11); runtime frame differencing; switching reasoning off; gates that block actions; game-specific hints; child-agent model fitting (deferred C; 2.1 is its in-process precursor).

## 3. Evaluation protocol

- Reasoning on (provider default), declared format. Review per 1.5 or every 25.
- Budget: this plan proposes 150 actions, 3M reported tokens, 2 h per run as a new protocol for level-capable runs; the earlier 1.2M ceiling remains the diagnostic budget. Frozen tree per arm, detached launch.
- Games: `ls20` and held-out `tu93`.
- One main factor per comparison; the comparator is the same reasoning and budget configuration without the factor. The historical reasoning-off run is not a causal baseline.
- Primary: levels cleared; actions per level against the human baseline (ls20 level 1: 22). Secondary: actions until a correct movement model; RESETs per 100 actions; identical experiments per 100 actions; goal checks per 25 actions; reasoning and input tokens per action; seconds per action.
- One run per arm shows large differences only; where a decision depends on it, run two per arm. A level cleared once is not a rate.

## 4. Will this solve the reset-and-retest failure?

The failure, from the hypstrategy run: the agent could not keep track of the block across moves, reset before every experiment and compared with the starting frame (2–3 actions per fact), and retested "move up" at #23, #34, #40–43, #51–55 and #57–62.

Causes and the mechanism that addresses each:

| Cause | Mechanism | Expected effect |
| --- | --- | --- |
| No reasoning, so no running picture of the state | reasoning on | Round 4 (reasoning on, same tree) used no resets as baselines and learned the controls in 4 actions; D3 in about 6. This cause is removed. |
| The standing skill reading was "difference from frame 0" | 1.3 (what the observer runs on), save-then-run (done) | the agent sees at save time what its default returns, and knows the default is read every decision; a default that reports the last action or the current object positions removes the reason to reset |
| RESET looked free | 1.4 | the cost is visible in the budget line |
| No trusted model, so every belief was retested by acting | 2.1 backtest | one saved model answers "A1 = up 5" against all recorded moves at once; retesting a rule with a clean backtest record has no purpose. Fit/later split stops a model fitted to the first moves from counting as verified |
| Contradictory beliefs stayed resident | 3.1 replaces | "extends" and "moves" cannot both be shown |
| No record of what was tried from here | 3.2 counts | "ACTION1 tried 9×, same result" is in front of the agent |
| The critic's "stalled, zero goal checks" lines never arrived | 1.2 | the advice reaches the agent from the first note |

Expected numbers, unverified: controls and a backtested movement model within about 10 actions (against 48); resets as baselines near 0 per 100 (against 22 per 100); re-tests of a backtested rule near 0 (against 5 series).

What this does not solve:
- **Adoption.** The gain from 2.1 and 3.1 exists only if the agent writes a model skill and uses `replaces`. Capability statements, the save-then-run receipt and the critic make the path visible; nothing forces it. Falsifier (a) in 2.1 tests exactly this.
- **Perception errors feed the model.** A model written from a misread ("A1 extends") is wrong but checkable: the backtest will show counterexamples, which is the point. It cannot fix a misread of the current grid itself; 4.1 tests whether an image helps.
- **Unseen conditions.** Walls and boundaries still have to be found by acting. The plan only stops paying for facts already known.
- **Goal discovery** remains the main open failure after this plan (round 4: 75 actions on an untested goal with reasoning on). 1.1, 1.2 and the goal-model backtest give it a cost; whether that changes behaviour is what the first Phase-2 run must show.

## 5. Implementation record (2026-10-11, evening)

Phases 1–3 are implemented. Phase 4 needs runs only (flags already exist).

| Item | Change | Files |
| --- | --- | --- |
| 1.1 | `isGoalHypothesis(key, question)`: goal, win, objective, level change, completion in the question or key | `demo/arc_thin_ledger.ts`, `demo/arc_thin_extension.ts` |
| 1.2 | `parseCriticReply` keeps lines that cite existing actions, a known `hyp.`/`strat.` key, or an action count within the run; drops invented citations, uncited lines and exact repeats of earlier kept lines. Critic instruction updated to match | `demo/arc_thin_critic.ts` |
| 1.3 | prompt states what automatic runs receive and that the agent chooses what a skill's default reports | `demo/prompts/arc_thin_system.md` |
| 1.4 | the `arc_action` description states RESET's effect and cost (the bridge counts it like any action; recorded runs returned to the level start); `resets=N` in the action line once a reset happened | `demo/arc_thin_extension.ts` |
| 1.5 | opt-in `--review-on-miss`: a scored miss makes a review due, at most every 4 actions; default off for a separate evaluation | `src/autoresearch_pi/arc_thin_e2e.py`, `cli.py` |
| 2.0 | Reuse: `predictWithSkill`'s convention (`state["proposed_action"]`), `buildHistory`, `scorePrediction`. The evidence board's replay was not reused: it replays board evidence, not transitions | — |
| 2.1 | Guest mode `backtest`: one sandbox call replays a model on recorded transitions, each case seeing only grids and history up to the move before it (`_History.upto`), the action, recent actions, no memory. `arc_thin_backtest.ts` scores replies as right / wrong / abstained / failed, splits fit / later / RESET, counts claimed cells and claimed changes and level predictions, and picks counterexamples across actions. Replayed on save (the receipt shows the result) and incrementally before each decision; rows in `model_checks.jsonl`; section `YOUR MODELS ON RECORDED MOVES` | `demo/arc_thin_skill_guest.ts`, `demo/arc_thin_backtest.ts`, `demo/arc_thin_extension.ts` |
| 2.2 | `cells=N predicted value(s) [k as change]` in every scored prediction once the grid before the action is known | `demo/arc_thin_prediction.ts` |
| 3.1 | `memory(set=[{key, text, replaces:[…]}])` deletes the replaced keys in the same atomic call; the receipt says "X replaces Y" | `demo/arc_thin_memory.ts`, schema in the extension |
| 3.2 | `explorationLine`: exact-grid counts (seen before at, tried from here with distinct results, never tried, new grids in the last 10) as section `EXPLORATION` | `demo/arc_thin_ledger.ts`, extension |

**Checks.**
- Node: 82/82, including the new `tests/arc_thin_backtest.test.ts`:
  - case construction without later moves; incremental cases;
  - the four outcomes and three sets;
  - goal-model level counting; a background-only claim showing 0 changes;
  - counterexample spread; exploration counts; goal-question matching;
  - critic grounding, invention and repeat;
  - `replaces`.
- The self-harness integration test checks the save receipt and the later per-move result of a real sandbox replay.
- pytest passes, including the idle-timeout tests.
- Self-harness, ledger and environment smokes pass. The self-harness smoke shows `YOUR MODELS ON RECORDED MOVES` and `EXPLORATION` reaching the provider request through the real Pi and bridge path.
- The default smoke fails on "Tool skill not found". The same failure appeared before this change (verify runs s1–s3, after the other session's staged tool surface of 14:10); it is not caused by these items.

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass (82 node, pytest) | local |
| Full-chain reachability | Pass for model replay, exploration and prediction labels through the real Pi and bridge with the scripted provider; critic delivery and goal coverage are unit-level only | scripted smoke |
| Autonomous adoption | Unverified: does the agent write a model skill, read its counterexamples, use `replaces`? | real run needed |
| Net benefit | Unverified | real runs per §3 |

## 6. Round 5 (2026-10-11 20:48–23:20): results and weaknesses found

Freeze `self-harness-20261011-b` (Phases 1–3) against `-a` (before them). Reasoning on in all arms. Budget 150 actions, 3M tokens, 2 h.

| Run | End | Actions | Levels | s/action | Note |
| --- | --- | --- | --- | --- | --- |
| tu93, new | deadline (2 h) | 31 | **1** (at #22; human baseline 19) | 213 | GAME_OVER at #26 in level 2, RESET at #27 |
| tu93, base | stopped at the user's request, 21:40 | 14 | 0 | 210 | no comparison possible |
| ls20, new | bridge process died at 21:11, no error output | 5 | 0 | 209 | excluded |
| ls20, new (retry by the other session) | running at 23:27 | 21 | 0 | 290 | not analysed here |

No comparison between versions is possible from this round (baseline stopped early, ls20 lost). What the tu93-new log shows about the current version follows. Digest: [tmp/tu93-story.txt](../../tmp/tu93-story.txt); load: [tmp/r5-load.txt](../../tmp/r5-load.txt).

**What worked.**
- Level 1 in 22 actions against a human baseline of 19, the best efficiency of any thin run. Controls (with a 2-cell step) were learned in 6 actions.
- The agent built the full cell map and a 16-press route in its reasoning, then executed it at 3–4k output tokens per step, with 3/3 prediction hits on every step.
- After the unexpected GAME_OVER it:
  - recorded the hazard (`hyp.enemy_8`);
  - kept two rival timing explanations (`hyp.enemy_pattern`: timer vs chase);
  - wrote `enemy_hist`, a history-scanning skill;
  - verified RESET's effect;
  - planned a discriminating move (#31).
- No `length` stops, no idle aborts; 13% of input spent re-reading within a decision (32–57% in the P0xx runs).

**Weaknesses, most costly first.**

1. **Actions forgotten after a memory batch.**
   - 5 of 36 decisions (d1, d26, d28, d32, d36) ended with memory/skill calls and no `arc_action`. The reasoning said it would act ("Let me issue memory updates + arc_action A4 together") but the message contained only the memory calls.
   - Each lost decision costs a full context re-read plus a new deliberation: 3.7k–12.8k output tokens and 2–6 minutes, about 15% of the run.
   - The pattern: long memory arguments (JSON strings), action left to the end of the message.
2. **Throughput is the binding limit.**
   - 213 s and 11k reasoning tokens per action; the 2 h deadline ended the run with 119 actions of budget left, after only 9 actions in level 2.
   - The heaviest decisions are productive: planning the route (d6–d9, ≈20k each) and analysing the hazard (d31–d36, 46–57k characters each). The cost is in how much hand computation they contain (next item), not in thinking itself.
3. **Planning and perception by hand.**
   - The 11×11 map was transcribed cell by cell in reasoning (d1: 23k tokens). The shortest route was computed by a BFS in the reasoning, twice (36-move plan, then 16-press plan after the 2-step discovery). 35% of reasoning is grid and coordinate arithmetic.
   - Each step's prediction listed 12 exact pixels, computed by hand (`[x,y,before,after]`), although a model skill could produce them.
4. **Skills do not survive a level change.**
   - `cellmap v1` hard-coded level 1's geometry (origin 15,15; 11×11). On level 2 (13×5, origin 12,21) it printed a garbled map that stayed in `YOUR SKILLS ON THE CURRENT STATE`.
   - The agent noted it (`fact.skill_l2`) but never revised it, and re-derived the level-2 map by hand (d24, d26, d28).
5. **The backtest was not adopted.**
   - No skill read `proposed_action`, so `model_checks.jsonl` was never written.
   - The enemy-timing question (timer vs chase) is exactly what a model replayed on the recorded grids could separate without acting. The agent scanned history with `enemy_hist` and then tested by acting (#31 "dive").
   - `replaces` was never used either: the agent deleted old facts with `delete` lists.
6. **Critic produced nothing.**
   - 4 of 4 critic calls spent the 2,000-token limit on reasoning (thinking `high` was passed to side calls) and returned no text. Fixed in the working tree (side calls without reasoning); this run had no critic.
7. **Skill save failed on escaping.** The first `skill set` failed: the source arrived with literal `\\n` sequences instead of newlines, a double-escaping slip, and the receipt cost a round.
8. **Low-value sections.**
   - `EXPLORATION` said "this exact grid is new" at nearly every decision: a moving sprite makes every grid new.
   - Per-step progress facts (`fact.path_state`, `fact.l2_progress`) were rewritten almost every action (memory section 7.0k characters on average) despite the prompt saying recent actions already record steps.

**Candidate fixes (general, no task content), in order of expected gain:**
- (1) Action first, updates after. Capability wording in the prompt: tools after `arc_action` in the same message still run and are reported at the next decision. Also a runtime check of the ordering: a message that has tool calls but no `arc_action` is answered within the same decision by one short continuation ("no action was submitted"), instead of a new decision with a rebuilt context. To be measured as lost decisions per 100 actions.
- (4) Skills marked with the level they were written in. After a level change, each skill line says "written in level N; its output on this level is unchecked", a mechanical fact. The agent decides whether to revise.
- (7) Boundary repair: a skill source with no real newline but with literal `\n` sequences is unescaped before the syntax check.
- (5) Adoption of model skills: the save receipt of any skill that reads `history` could mention that a skill reading `proposed_action` is replayed on recorded moves. This is a capability statement at the moment the agent works with history, not a directive. Measure: model skills written per run.
- (8) Hide the `EXPLORATION` line when the current grid is new and nothing was tried from it (it then says nothing).
- (2) For level-capable comparisons, either a longer deadline or acceptance that 2 h covers about 30 actions at this reasoning load; record it in the protocol.

**Next check.** A clean rerun: a fresh freeze with the critic fix and (1), (4), (7), (8); tu93 and ls20; a baseline that runs to completion; the same 150/3M budget. The deadline needs a decision (2 h ends at about 30 actions).
