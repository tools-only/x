# tu93-new (round 5): why the agent hand-computed, why the new mechanisms were not used, and what to change (2026-10-12)

Run: `runs/thin-sh-r5-tu93-new-20261011` (freeze `self-harness-20261011-b`, reasoning on). Level 1 cleared in 22 actions (human baseline 19); deadline at 31 actions.

Evidence: [tmp/tu93-story.txt](../../tmp/tu93-story.txt), reasoning excerpts [tmp/tu93-reasoning.txt](../../tmp/tu93-reasoning.txt) and [tmp/tu93-reasoning-b.txt](../../tmp/tu93-reasoning-b.txt), and `harness/skills.jsonl` of the run. Quotes are the agent's own reasoning.

## 1. Why the map was hard-coded into the skill

`cellmap v1` contains `x0 = 15; y0 = 15; for j in range(11): for i in range(11)`. These are the numbers the agent had already worked out by hand at decision 1 (23k reasoning tokens transcribing the grid). The skill was written afterwards, to display a parse already done. It was not written to perform the parse.

Causes, in order:

1. **Understanding comes first, the tool second.** The agent parses in its reasoning and then writes a skill so that it can "easily read state each turn". The skill encodes the conclusions of that parse (origin, cell size, board size) as constants. A detector of the lattice was never needed while one board was in view.
2. **The agent does not know what `state` looks like.**
   - "Exact API unclear … write defensively" (d3).
   - "what shape does the skill's state have? Unknown. Defensively: try state["grid"]; if not, scan state values for a 64x64 list" (d6).

   Half of `cellmap` and all of `frames_traj` are code that searches `state` for something that looks like a grid. The effort went into guessing the interface, not into generality.
3. **Nothing told the skill, or the agent, that a new board had arrived.** On level 2 the skill printed an 11×11 map with a 13-character row, no sprite and no goal. It was shown at every decision as if valid.
4. **Our review prompt blocked the repair.** At the review after the level change the agent wrote: "cellmap skill is broken on level 2 (hardcodes level 1 geometry) … I can't update the skill this turn (exactly one memory call)". It recorded `fact.skill_l2` and deferred the fix. Later decisions re-derived the level-2 map by hand.
5. **There is no place for a product of a skill.** The parsed map lived as memory text (`fact.map11`, then `fact.l2_map`), where no other skill can read it. A method that produces an artifact needs somewhere to put the artifact.

The user's distinction is the design fix: **the skill is the method; the map is its artifact.** The harness offers the method part (skills) but not the artifact part.

## 2. Why planning and parsing stayed manual, and why the new mechanisms were not used

What was adopted:
- three skills (`cellmap`, `frames_traj`, `enemy_hist`), one of which scans `history`;
- predictions on every action;
- the review turns.

What was not adopted:
- a model skill (so the backtest never ran);
- `replaces` in memory;
- a planner. BFS was computed in the reasoning, twice.

Causes:

1. **Only actions look costly to the agent.**
   - "Running a skill doesn't cost an action… Tool calls in my turn are free" (d6).
   - "the skill can compute this — but I should be able to reason it through, and I can also write a small skill later" (d7, about the route search).

   The budget the agent sees is actions. Wall time and reasoning tokens are invisible, so a 20k-token hand BFS looks free, and the 2 h deadline ended the run with 119 actions unused.
2. **Building a tool costs rounds.**
   - "message 1: skill set. Message 2: run_skill … Message 3: arc_action" (d6).
   - The first save failed on escaped newlines (`\\n`).
   - A planner would also need the map as input, but maps are not artifacts and skills cannot call skills. A planner would have to re-implement the parse.
3. **The model convention never met a need it obviously served.**
   - Controls were learned in 6 cheap probes on level 1, so there was nothing to backtest.
   - The convention ("a skill that reads `proposed_action` is a model") is one sentence in a 2.7k system prompt.
   - Writing a model means writing a simulator, a large upfront cost with no visible payoff.
   - The agent already had per-action prediction checking by filling `predict` by hand ("the prediction check is useful mainly as a self-check", d6).
   - On level 2 the open question (does the enemy move on a timer or chase?) concerns the environment's own dynamics. The "predict the result of the proposed action" framing does not suggest itself for that. A history scan (`enemy_hist`) does, and the agent wrote one.
4. **`replaces` had no work to do.** The agent already used `delete` and `set` in one atomic call. Non-use here is reasonable, not a failure.

## 3. Memory: what went wrong, and a structural fix

**Observed:**
- 5 of 36 decisions ended with memory or skill calls and no action, although the reasoning said "memory updates + arc_action together". Each one cost a new decision.
- The memory section averaged 7.0k characters, partly per-step progress facts (`fact.path_state`, `fact.path16_progress`, `fact.l2_progress`) rewritten almost every action.
- Memory arguments arrived as long JSON strings.

**Diagnosis (corrected 2026-10-12, after reading the code path):**
- The lost actions were caused by the runtime, not by the model. Since 2026-10-11 a successful `memory` call set `run.endBatchAt`, so its result terminated the Pi run whenever no `arc_action` was in the same message.
- A decision that wrote memory first, meaning to act after reading the receipt, ended there. The runner then sent the forced action-only prompt.
- The same rule ended every review after its first memory call. That is why "I can't update the skill this turn" was true (§1, cause 4).
- Progress through a plan has no home other than memory, so the agent rewrites it.

**Fix (the user rejected attaching memory to `arc_action`: the action stays an action):**

1. **A committed memory update no longer ends the decision or the review.** The agent sees the receipt and continues. The decision still ends with `arc_action`, the tool-call limits (6 soft, 8 hard) or the model stopping. The forced action-only follow-up remains for a decision that stops without acting.
2. **Planned steps on a strategy.** A strategy may carry `steps` (action names). The runtime shows under STRATEGY: "steps planned after #7: 9/16 followed; next ACTION4, …", and where the moves left the steps. It only compares labels; no semantic judgement is made. Per-step progress then needs no memory writes.

## 4. The critic

**Observed across the last runs:**

| Run | What went wrong |
| --- | --- |
| Round 4 | Its first line corrected a move count, which the agent took as support for its plan |
| hypstrategy | Every "goal unresolved / strategy stalled" line was dropped for lacking `#N` (fixed); 7 of 15 notes repeated a label complaint |
| Round 5 | 4 of 4 calls spent the whole output budget on reasoning and returned nothing (fixed) |
| All | Notes reach the agent 2–17 decisions after the trigger (asynchronous call, 3 s grace); the dossier is 21–27k characters; 133k tokens for 15 notes in hypstrategy; effort triggers depend on idea labels, which the agent changes per action |

**Optimisation:**

1. **Reliability first.**
   - No reasoning for the side call (done).
   - An empty or length-stopped reply is a failure: retry once with a shorter dossier.
   - Report notes delivered per call.
2. **One question per call, as a falsifier.** Instead of an open review, ask: "the agent's current main claim is X (active strategy premise or goal hypothesis); what recorded action contradicts it, and what is the cheapest next observation that would?"
   - Structured reply: key, status, evidence #s, cheapest test.
   - Parsed into fields and rendered as one line per finding.
3. **Speak on failure, stay quiet on progress.** Trigger on:
   - a scored miss of a goal or level prediction;
   - GAME_OVER;
   - N actions on a goal hypothesis without a level/WIN check;
   - repeated identical results.

   Do not trigger while predictions hit and a plan executes (tu93 level 1, where the critic had nothing to add).
4. **Deliver on time.** For stage triggers, wait for the critic at the next decision boundary. Without reasoning the call takes about 10–20 s; the wait is capped at 30 s.
5. **Small dossier.** The claim, its evidence, the relevant actions and the budget: about 6k characters instead of 25k.
6. **Acted-on by keys, not labels.** A note counts as acted on if the next memory write or the next five actions touch the key it cited. The single escalation keys on that rather than on `idea_kept`.

## Proposed changes (general, no game content)

| # | Change | Answers |
| --- | --- | --- |
| A | Artifact store: a skill may return `{"artifacts": {name: value}}`; the runtime keeps each artifact with its producer (skill, version), state number and level, passes all artifacts to skills as `state["artifacts"]`, and lists them (name, producer, age, level) | Q1, Q2 composition |
| B | The `skill` tool description shows the exact `state` keys and shapes (one compact line) | Q1 guessing |
| C | Level change marks skills and artifacts made on an earlier level; skill output lines say "first run on level k" | Q1 stale output |
| D | Review turns may revise skills (the consolidation prompt no longer limits them to "exactly one memory call") | Q1 blocked repair |
| E | Resource facts: time left and the last decision's reasoning tokens and seconds, next to the action budget | Q2 cost blindness |
| F | Skill-source escape repair (`\\n` to newline when the source has no real newline) | Q2 friction |
| G | ~~`arc_action.memory`~~ (rejected by the user: the action stays an action). Instead, a committed memory update no longer ends the decision or review, and a strategy may carry planned `steps` whose progress is shown | Q3 |
| H | Critic: falsifier question, structured reply, failure-only triggers, synchronous delivery for stage events, 6k dossier, key-based acted-on | Q4 |

Each is a service or a foundation; none interprets the game. The model and backtest stay as they are. A and E make them cheaper to justify (a model can read the map artifact), and the plan's §6 measures their adoption.

## Change record (2026-10-12): A–H implemented

Status: implemented; functional and scripted full-chain checks pass. Adoption and net benefit are unverified, and no paid run has been made. The user approved A–F and H, and G as revised.

### Claim and burden
- **Claim.** On the real model, these changes remove two costs:
  - the hand work behind each decision (parsing the board in reasoning, searching routes by hand, rewriting progress facts);
  - the decisions lost to runtime artifacts (memory-only turns, notes delivered late or empty).

  Concretely, we expect more actions per hour and fewer reasoning tokens per action at the same or better level progress. We also expect at least one skill to read another skill's artifact, and at least one strategy to carry `steps`.
- **Burden removed.**
  - The runtime ended a decision after each memory commit. That forced an extra full-context decision, 5 times in tu93.
  - The review allowed one memory call, which blocked skill repair.
  - Guessing the skill `state` interface.
  - Re-parsing a board inside each new skill.
  - Per-step progress facts.
  - The agent could not see the cost of its reasoning.
  - Critic notes arrived empty, late or about labels.
- **Disproved if:**
  - on comparable tu93/ls20 runs, the median time per action and reasoning per action do not fall;
  - artifacts and steps go unused;
  - the critic's delivered notes are not followed by edits to the keys they cite.

### What changed
| Item | Files | Behaviour |
| --- | --- | --- |
| A artifacts | `demo/arc_thin_artifacts.ts` (new), extension, guest | A skill result's `artifacts` dict is split off and stored in `artifacts.jsonl` with skill, version, state and level. A value is stored only when it changed. Skills get `state["artifacts"]` and `state["artifact_info"]`. A replayed model gets the artifacts as of state n-1. The working set has an ARTIFACTS list. Shown skill output names the artifacts instead of repeating them. Limits: 16k chars per artifact, 64k in total, 16 names. |
| B state keys | `skill` tool description | Lists the state keys, adds `grid[y][x]`, and explains how to return artifacts. |
| C level marks | extension | `saved_level` on skills. SKILLS and skill output lines say "[written on level k; now level m]". ARTIFACTS lines say "made on level k" and whether the producer is newer or was deleted. |
| D reviews | runner `CONSOLIDATE_PROMPT` | "No action this turn … skills can be fixed or replaced here too … then stop". Memory no longer ends the review. |
| E resources | extension, runner (`ARC_RUN_DEADLINE_MS`) | A RESOURCES line: time left, the last turn's seconds and output/reasoning tokens, recent seconds per action and how many more fit at that pace, then "Reasoning and tool calls cost time, not actions." Not shown in the control variant. |
| F escapes | `repairSkillArguments` | A single-line source with literal `\n` is unescaped once. A source with real line breaks is never changed. |
| G' memory/steps | extension, `arc_thin_memory.ts` | A memory commit no longer sets `endBatchAt`. Strategies take `steps` (normalised action names, at most 64, `[]` clears them). The active strategy shows "steps planned after #k: i/N followed; next …" or the first move that differed. |
| H critic | `arc_thin_critic.ts`, extension | **Triggers:** GAME_OVER; a missed level or WIN prediction; ≥2 misses in the last 5 actions; ≥15 actions on a level without a goal check while predictions miss; repeats; stall; an unanswered review. Level change, RESET, closed experiments and label effort no longer trigger. **Reply:** structured lines `target \| status \| evidence \| cheapest test`, where the target must be a known key or `goal` and the evidence must cite existing actions; plain lines are still accepted under the old rule. **Retry and wait:** one retry with a shorter dossier after an empty or length-stopped reply; a wait of up to 30 s (`ARC_CRITIC_WAIT_MS`) instead of 3 s. **Input:** the dossier is about 6–9k chars (no idea/experiment sections, memory clipped to 3.2k, 10 actions with prediction scores, the state summary without coordinate runs). **Follow-up:** an "unanswered review" is judged by memory writes to the cited keys, or by a level/WIN prediction for `goal`; idea labels are only the fallback. **Logging:** `critic.jsonl` records `attempts` and `delivered`. |

**Prompt.** System prompt with the ledger/critic board: 3,225 chars (round 5: 3,096); without it 2,819. It gains one sentence on artifacts and a clause on steps; the analyst/predict lines were trimmed. Memory rows now carry `at` (the action count).

### Checks (2026-10-12, Windows, Node 25.5 `--experimental-transform-types`, Python 3.12)

**Node tests: 82/82 pass.**
- New: `tests/arc_thin_artifacts.test.ts`.
- Steps test in `tests/arc_thin_memory.test.ts`; escape test in `tests/arc_thin_boundary.test.ts`.
- Critic trigger, parse and follow-up tests in `tests/arc_thin_ledger.test.ts` were rewritten.
- Two tests in `tests/arc_thin_self_harness.test.ts` were rewritten from "memory commit terminates" to "continues". The working-set section list now includes `resources`.

**pytest:** `test_arc_thin_lifecycle_stats.py` and `test_pi_kernel_idle_timeout.py`, 8/8 pass.

**Scripted full-chain smokes** (real bridge, mock ARC SDK, real Pi, scripted provider; output in `tmp/checks-out.txt`):

| Smoke | Run | Result |
| --- | --- | --- |
| self-harness | `runs/arc-thin-self-harness-smoke-20261011170812` | 21/21 checks |
| ledger | `runs/arc-thin-ledger-smoke-20261011170812` | 14/14 |
| environment | `runs/arc-thin-environment-smoke-20261011170812` | 5/5 |
| default | `runs/arc-thin-default-smoke-20261011170812` | 19/32 |

New self-harness checks:
- `artifact_produced_and_read`: `board` returns `{"x":2,"artifacts":["row3"]}`, a later `reader` returns `{"nine_at":2,"from":"board"}`, and `artifacts.jsonl` holds one record.
- `artifacts_listed`, `plan_steps_tracked` and `resources_shown`.

New ledger check:
- `critic_structured_after_failure`: the note was triggered by the missed level change at #3 and kept `goal contradicted: #3…`; the unknown-key/#99 line was dropped; dossier 2,344 chars.

**Default smoke: 13/32 checks fail, not from this change.** Its decision 1 makes 13 tool calls. The 6/8 tool-call limits added on 2026-10-11 end that decision at the 7th call. Before this change it ended even earlier, at the first memory commit. Restructuring that script is a separate task.

### Evidence layers
| Layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | pass | unit tests | As above. A level flag on a real level change is not exercised: the mock game has no levels. |
| Full chain | pass (scripted) | mock ARC SDK, real bridge/Pi/sandbox, scripted provider | Self-harness and ledger smokes. The default smoke fails for the reason above. Not `arc-harness-smoke` (legacy child-broker path). |
| Autonomous adoption | unverified | — | Needs real-provider runs. |
| Net benefit | unverified | — | Needs paired runs at a fixed budget. |

### Next falsifiable check (needs the user's budget)
- **Runs.** Frozen tree; two real-provider runs per game (tu93, ls20) with reasoning on, the current deadline, the same `max_output_tokens`; compared with round 5 (`runs/thin-sh-r5-*`).
- **Primary outcomes:** levels and actions per hour.
- **Secondary outcomes:**
  - reasoning tokens per action;
  - memory-only decisions (expected 0 except deliberate stops);
  - artifacts read by another skill;
  - strategies with `steps`;
  - critic delivered/total and the share of notes whose keys were written within 5 actions.
- **Confound.** Many factors change at once. This round can show reachability and adoption but cannot attribute any gain to a single factor.
