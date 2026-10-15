# r03b simple context: the runtime's facts in the head, refinement on a fixed step, a bounded history

Date: 2026-10-15 (Asia/Shanghai). Status: implemented on `claude/r03b-simple-20261015` (commit `83276f8b`), cut from tag
`ls20-r03b-deecdde6`; offline checks and the deterministic foundation smoke done; real su15 runs on the user's request
(§Real runs). Paired comparisons R1/R2 are not run.

Change record per [the development workflow](../development-workflow.md). Sources: the user's priority list in
`C:/Users/qi/tmp/ls20-r03b-vs-ch-prime-context.md` (push spend facts, stop zero-information batches, Prime-style
refinement, memory index first, cache and context, harness state as the continuity source), GLM's analysis of r03b on
su15 (relayed by the user; its raw logs are not on this machine), the frozen ls20-r03b run
(`demo/.claude/worktrees/kernel-20261014/tmp/arc-kernel-20261014/ls20-r03b/arc-run`) and
[the r03b weaknesses report](../reports/2026-10-15-r03b-weaknesses-and-plan.md). None of the
`claude/r03b-phase01-20261015` fixes are included.

## Problem and claim

- **Observed.**
  - The runtime already counts what the agent spends (per action, streaks, budget left, goal tests, repeats), but
    only into `data/ledger.md`. ls20-r03b read that file once in 288 actions. GLM's su15 analysis reports 25 clicks in
    a row that changed nothing.
  - On su15 a refinement that ended with `stop_reason=error` was logged as an invalid reply, and the agent was never
    told. In ls20-r03b a strategy a refinement wrote before #229 RESET was shown after it, with nothing saying so.
  - Refinements started on about a dozen event kinds plus a 15-action fallback that every refinement reset.
  - The memory view clipped facts at 600 characters; at the end of ls20-r03b it left 8 of 15 entries out, unnamed.
  - The prompt said predicting "keeps a wrong plan from spending the rest of its steps", which holds for `then` lists
    only; env.act runs on. The `<carry>` ask was answered about twice in ls20-r03b's 102 requests and never in
    ls20-r01, ls20-r02 or su15.
  - A refusal said only "not currently available"; ls20-r03b turned one into the memory "RESET is ONE-TIME".
  - One python call could play 24 actions whatever was left of the budget.
  - The transcript of earlier decisions grew to 269,863 characters by d29 of ls20-r03b (109,126 of them call arguments,
    not counted in `history_text_chars`).
- **Claim (to be tested, not shown).** With the counts pushed into the head, a refinement on a fixed step whose
  failures the agent sees, and the disputed memory first, qwen3.8-27b spends fewer actions in no-change streaks and
  exact repeats and tests the goal earlier, at no higher budget tokens per action. Bounding the history (package 2,
  off by default) lowers decision-start uncached input without losing what later decisions refer to.
- **Burden removed.** The agent no longer has to fetch and recount the ledger; refinement no longer depends on which
  event fired; failures and stale refinements are stated instead of silent; omitted memory is named; an inert ask is
  gone. Nothing new is asked of the agent.
- **Overturned by.** R1 below: levels or actions per level worse, or tokens per action higher, than deecdde6 on the same
  forks; facts read but no-change streaks unchanged.
- **Scope.** Implementation, offline checks and the deterministic smoke; one exploratory real run requested by the
  user. Not in scope: the deferred items in §Not built.

## Design and cost

| # | Change | Where | Default | Restore earlier behaviour |
|---|---|---|---|---|
| 1.1 | RUNTIME FACTS block (≤900 chars) first in each native head: budget left (level and run), this level's actions per action name with "changed nothing" counts, current streak, stall (masked hashes), goal tests, latest miss, repeats across attempts. RECENT ACTIONS dropped: the transcript holds those receipts | `renderFacts`, `levelRepeats` in `demo/arc_thin_ledger.ts`; `prepareLedger`, `buildWorkingSet` | on when the ledger is on | `ARC_THIN_FACTS=0` |
| 1.2 | Refiner reply classified before parsing: `error`/`aborted` → `failed`, `length` → `truncated`; failed, truncated and invalid replies are told to the agent; "no edit" only when the agent asked; an edit says which actions followed its record ("It was made from the record up to #2; since then: #3 ACTION1.") | `runRefiner`, `takeRefinerNotice` | on | — (a fix) |
| 1.3 | Fixed step: a refinement every K actions (multiples of K, `scheduleDue`), at a level change and on `refine(focus)`; the former event conditions and the facts block are its input (`ALSO ON RECORD`); over the 10% token share a scheduled one is skipped, level changes still start one | `fixedTriggers`, `conditionParts`; prompt sentence | `ARC_REFINE_TRIGGERS=fixed`, K = `ARC_REFINE_EVERY` = 15 | `ARC_REFINE_TRIGGERS=events` |
| 1.4 | Memory disputed-first: a hypothesis whose own check fails, a contested/rejected premise of the active strategy; then open experiments, the strategy, other live hypotheses and refuted rivals, facts (200 chars), the rest one line each; omitted keys listed; "HYPOTHESES: none · STRATEGY: none active" | `renderDecisionMemory` in `demo/arc_thin_memory.ts` | priority | `ARC_THIN_MEMORY_VIEW=legacy` |
| 1.5 | `PLAYED #a–#b: ACTION6 ×24; 22 changed nothing` above the receipts of a call with ≥3 actions | `actedSummary` in `demo/arc_thin_native_runtime.ts` | on | — |
| 1.6 | One acting call may play `max(1, min(24, ceil(left × share)))` actions, read before its first action; `left` is the nearer of level and run | `actLimit` | share 0.25 | `ARC_THIN_ACT_SHARE=0` |
| 1.7 | Prompt: "A then list stops at the first missed prediction; env.act returns `missed` and your code decides whether to go on." The `<carry>` ask and `<carry-missing>` reminder off; a carry the model writes is still lifted | `demo/prompts/arc_thin_native_system.md`, extension, `carryFields(remind)` | off | `ARC_THIN_CARRY_ASK=1` |
| 1.8 | Refusal: "action 'RESET' is not currently available. Available now: ACTION1, …; last action played: #229 RESET." | `submitAction` | on | — |
| 1.9 | Measurement: `history_args_chars`, `facts_chars`, window counters in `context_budget.jsonl`; `extension_env`, `native_history.decisions/max_chars`, `continuity_decisions_scope` in `run-config.json`; evaluator `decision_start`, `changed_nothing`, `refinements`, `goal_tests`, `history`; pilot `PILOT_GAME`, `FORK`, `SNAPSHOT`, `MAXDEC`, `ARC_REFINE_*` variables | runner, `tools/arc_ls20_loop_eval.py`, `tools/arc_ls20_loop_pilot.py` | — | — |
| P2 | History window: the newest `ARC_THIN_NATIVE_HISTORY_DECISIONS` earlier decisions within `ARC_THIN_NATIVE_HISTORY_MAX_CHARS` (text and call arguments), whole decisions, oldest dropped first; recovery prompts are not decisions; a compaction summary in front is kept; the first kept prompt names where the dropped record is | `boundHistory` in `demo/arc_thin_native_context.ts`; context hook | unset = every decision (deecdde6) | — |

- **Resident cost.** Facts 290–660 characters per head (replay max 657); RECENT ACTIONS (up to 8 receipt lines) removed;
  memory view still ≤4,000. System prompt in fields mode 3,715 vs 3,903 at deecdde6 (smoke `system_chars`): the carry
  ask and the then-list sentence are shorter, the refine sentence slightly shorter. No new tool, field, gate or worker.
  `arc_action` is unchanged.
- **Deviation from the plan, P2.** The newest earlier decision is kept even when it alone exceeds `MAX_CHARS`
  (`oversize`): with RECENT ACTIONS gone it is the only place the last action's receipts are. The plan's "≤24k at every
  decision start" therefore holds at 28 of 29 ls20-r03b decision starts (d21: 26,406).
- **Lifecycle.** Counting, scheduling and classification are the runtime's; whether a fact matters, and every edit, stay
  with the agent and the refiner. Integrity checks (budget, environment refusals, versions, refinement ownership and
  staleness) are unchanged.

## Experimental protocol

- **Evidence targets.** Functional (done offline), full-chain wiring (deterministic smoke), autonomous adoption and net
  benefit (real runs below; not yet).
- **R1** deecdde6 vs this branch, su15 and one held-out game chosen in advance by a fixed rule, forks from decision 4,
  3 forks per arm, ≤40 actions / ≤350k budget tokens / ≤60 min each. Keep if levels and actions per level are no worse
  and tokens per action (refiner included) not higher; refiner failures and evidence points visible in the inputs.
- **R2** this branch vs + `ARC_THIN_NATIVE_HISTORY_DECISIONS=6`, `ARC_THIN_NATIVE_HISTORY_MAX_CHARS=24000`, ls20 and
  su15 forks at decision 15. Keep if decision-start uncached input falls ≥40%, budget tokens per action ≥25%, levels not
  lower, references to past actions at decision start not up >25%.
- R1 and R2 need their own budget authorization; neither is run here.

## Implementation and verification

- **Unit tests** (Node 25.5 `--experimental-transform-types`, Windows, each `tests/arc_thin_*.test.ts` file alone):
  39 files, 189 tests, 184 pass. The 5 failures also fail on a clean deecdde6 worktree run the same way: activation
  "saved code acts in a closed loop" (unsaved code now acts), components "python session never stores runtime
  objects", receipts ×3. Two other first-pass failures were environmental and pass on rerun: compaction (no
  `node_modules` in the worktree; a junction to the project's was added) and action_surface (installed-Pi timeout).
  New: `tests/arc_thin_facts.test.ts` (5), `arc_thin_memory_priority` (4), `arc_thin_history_cap` (6),
  `arc_thin_act_limit` (3), `arc_thin_fixed_refine` (4: the schedule, notices with what followed, a classified failure,
  the over-share skip, events mode and the earlier head, the refusal text, no facts without the ledger). Logs:
  `C:/Users/qi/tmp/r03b-simple/tests-branch*`, `tests-base`.
- **Offline replay of the frozen ls20-r03b run** (`C:/Users/qi/tmp/r03b-simple/replay.ts` → `replay.json`; reads the
  run, writes nothing there):
  - facts at every decision start: ≤657 characters; d19 reads `GOAL TESTS … #97 MISS, #139 MISS`, `LATEST MISS: #139
    level_changed=true (saw false)`, `REPEATS on this level: 37 action(s)…`.
  - memory at the end: priority view names all 15 keys (14 rendered, `L0 layout` listed); `hyp.strip_eat` with
    `fails 259` first. The legacy view rendered 7 and left 8 out unnamed.
  - history: unbounded 269,863 characters at d29 (109,126 call arguments); with 6 decisions / 24,000 characters at most
    26,406 (d21, newest decision alone over the limit), 22,635 at d29 with 2 decisions kept.
- **Deterministic foundation smoke** (mock ARC SDK, production bridge, installed Pi, scripted provider;
  `C:/Users/qi/tmp/r03b-simple/smokes*`):
  - new `schedule` (ARC_REFINE_EVERY=2): refinements start at #2 and later multiples or the first decision after a
    running one; the strategy edit is told with "It was made from the record up to #2; since then: 7 actions (#3
    ACTION1, #4 ACTION4, …, #9 ACTION1)"; the provider error is told as "failed: SCRIPTED_PROVIDER_ERROR; nothing
    changed."; no `invalid`; facts in every head, no RECENT ACTIONS; the refiner input has the facts; the edited strategy
    reaches the system prompt.
  - existing scripts, now run with `ARC_REFINE_TRIGGERS=events`; the activation script pins `ARC_THIN_REASONING_MODE=all`
    (it checks reasoning kept within a decision, and the runner now picks `fields` on the Responses route; at deecdde6
    it fails on that check). With that, activation and activation-defaults (event triggers, `ACTED 2 action(s)`, the
    absent-words list, refinement edits) pass all their own checks, on this branch and on deecdde6.
  - every native script then stops at the shared final check `system_chars <= 3000`, on deecdde6 as here: the native
    prompt is 3,903 characters at deecdde6 and 3,715–3,734 here. `components` stops earlier, at
    `NATIVE_SKILL_DESCRIPTION in head`, on deecdde6 too. Neither check is changed by this work.
- **Not run.** `arc-harness-smoke` (no closure claim is made), R1, R2.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional correctness | Passed offline | local Node/Python, no provider | unit tests and replay above |
| Full-chain reachability | Passed for the new paths, with two shared stale smoke checks | mock ARC SDK, real bridge, installed Pi 0.87.0, scripted provider | `smokes2`/`smokes-branch2` `schedule`, activation; not the real ARC service |
| Autonomous adoption | Partly observed, one run | yibu / qwen3.8-27b, thinking off, real ARC service | su15-s04: batches in 14 of 27 action decisions (3.4 actions per decision); 7 refinement edits reached later decisions; 0 of 94 predictions checkable; use of the facts not attributable (no reasoning text; code comments cite receipts). Not a causal effect |
| Net benefit | Unverified | — | needs R1/R2 |

## Real runs (user request, 2026-10-15)

`su15-s02`: `PILOT_GAME=su15`, source commit `83276f8b`, this branch's defaults (history window off), yibu /
qwen3.8-27b, thinking high, Responses route, query observations; 300 actions, safety caps 6,000,000 budget tokens and
36,000 s. Output `D:/autoresearch_pi_project/runs/arc-r03b-simple-20261015/su15-s02`. Stopped by the user's decision
after 20 actions (about 70 minutes), 0 levels, to change the configuration. What it showed:

- time: 94% of the wall time of the first 10 actions was the model generating (2,944 s), about 12k output tokens per
  action (90% reasoning) at 41–51 tokens/s; waits for headers and first tokens 5%; python 11 s. One action per decision
  throughout; ls20-r03b had the same 2–10 minutes per decision early but played 4–19 actions per decision from d5.
- budget tokens about 33k per action; decision-start uncached input 13k–16k (no cache hit across minutes-long decisions).
- one provider stall (a request silent for 5 minutes, then ended; the retry worked); two calls lost to the tool-name
  mix-up of the Responses route (python carrying read's arguments and the reverse).
- the facts block was in every head; its stall and repeat lines never fired because the bottom line erased new cells on
  every action, so each state counted as new, although only that line changed on 9 of the first 12 clicks.
- the first scheduled refinement started at #17 (due at #15; the decision before played two actions) with three
  conditions as input and wrote `hyp.timer_goal` with a check.

`su15-s01`, the first launch, ended during its first request (0 actions) because it was started from a terminal tab
that was then closed, which ended its process tree; that request's cost is unknown. Later runs are started through WMI
(`C:/Users/qi/tmp/r03b-simple/launch-su15-s0*.cmd`), outside any tab.

**Changes after su15-s02 (user request).**
- Tool-name repair: phase01's `1abf7c7e` and `adb08483` cherry-picked (`9f26025f`, `513da14c`). A later call that
  arrived under the first call's name gets its own back before Pi validates it; repairs go to `tool_call_repairs.jsonl`.
- Batches (`782781cd`): in native mode `arc_action` takes `actions`, a list played in order, as Continual Harness's
  take_actions; up to 24 and at most the act share of the budget left; it stops early only at a level change, the game's
  end or a refusal (`ARC_THIN_BATCH_STOP=miss` restores the stop at a missed prediction). The earlier `action` + `then`
  shape is turned into a batch before validation. Tests `tests/arc_thin_batch.test.ts` (3); the smokes activation,
  activation-defaults, schedule and foundation pass their own checks (the batch from the activation script's then form
  plays 3 of 3) and stop at the shared `system_chars` check as before.
- Thinking off: the user asked not to run with high reasoning but with it off. This reverses the 2026-10-11 decision
  ("close llm reasoning is not the right decision"), and the 2026-10-11 thinking-off ls20 run spent 2–3 actions per
  fact; it is recorded here, not argued. `PILOT_THINKING=off` with `PILOT_THINKING_FORMAT=qwen` sends
  `enable_thinking=false` on the Completions route, the encoding that reached qwen on 2026-10-02/10-11.

`su15-s03`: commit `782781cd`, thinking off (Completions, `enable_thinking=false`), otherwise as su15-s02; 300 actions,
caps 6,000,000 budget tokens and 36,000 s. Output `D:/autoresearch_pi_project/runs/arc-r03b-simple-20261015/su15-s03`.
Stopped when the user asked for a rerun, after 13 actions in 10 decisions (about 8 minutes from the first completed
request to the last action), 0 levels:

- reasoning 0 on all 30 completed requests, 101–1,580 output tokens each; under a minute per decision, against about
  3.5 minutes per action over su15-s02's 20.
- two requests failed before any stream arrived (`stop_reason=error`, decisions 2 and 9); each retry worked.
- every action went through `arc_action`: two batches (decision 1: 2 of 2; decision 10: 3 of 3), the other eight
  decisions one action each; 4 of the 13 actions changed nothing.
- `protocol.json` names the route `openai-responses (native default)`, but `run-config.json` records the one used,
  `openai-completions`: the pilot's label ignored the declared dialect. The label is fixed for later pilots; su15-s04's
  `protocol.json` has the same wrong label.

`su15-s04`: the rerun, same settings, commit `64a9f580` (code as `782781cd`), launched 23:10 Asia/Shanghai;
`run-config.json`: thinking off, `thinking_format` qwen, `openai-completions`; reasoning 0 on every request. It ended
at 94 actions after 27.4 minutes: the ARC SDK's step for #95 did not return within 90 s and the runner stopped with
`environment_outcome_unknown`, 206 actions unused. Level 1 was completed at #92 (23 minutes, 26 decisions). Evaluator
output: `C:/Users/qi/tmp/r03b-simple/eval-su15-s04.txt`.

- cost and pace: 692,531 budget tokens, 7,367 per action, of which 412,449 (60%) were decision-start uncached input
  (14.7k per decision); 17.5 s per action; 3.4 actions per decision; 7 refinements (34,861 tokens), all edits.
- what the actions did: 17 of 94 changed something other than the bottom row (block moves, an undo, RESETs that put
  blocks back); 60 changed only the bottom row, 2 cells each, which fills from one end and ended the game when full
  (GAME_OVER at #45); 17 changed nothing. The facts block and the evaluator's `changed_nothing` (17) count only the
  last group: the ledger's ticker mask is per cell (changed on ≥80% of transitions), and each cell of a filling row
  changes once, so every fill made a new state and the stall and repeat lines stayed silent, as in s02.
- batches: 14 calls played more than one action. Four calls of 8–10 clicks (#6–#45) played 10 clicks that changed
  nothing and then 28 that only filled the row, up to GAME_OVER; after resets, two more calls (#57–#78) tested fills of
  24 and 32 cells (19 more such actions). The batch that completed level 1 (#84–#92, a block moved step by step to a
  target) played 7 and then 2, cut by the act share. Every wasteful batch stated its target ("fill y63: x54-55 become
  5"; "y63 now fully filled, expect level change or win"). All 94 predictions were text, so none was checked.
- refinements: #15 and #45 sent the agent to a goal test, #37 turned its belief about the bottom row into a hypothesis
  with a check, #78 kept the fill-to-32 test; #45 also named the objects not yet tried, after which the agent probed them
  and found the mechanic at #51; at the level change the refiner wrote the solution as a rule. The #37 edit arrived 5 s
  after the agent had issued #38–#45.

## After su15-s04: candidate mechanisms (analysis, not built)

The user's direction: batch only for a plan that needs several actions to reach a position or state. In su15-s04 every
wasteful batch had such a plan; the plans were wrong, and nothing checked what each step achieved. The candidates judge
steps by their outcome, not by what was declared.

| # | Mechanism | Where | su15-s04's recorded calls | Cost |
|---|---|---|---|---|
| M1 | A batch returns control after a step that made no progress: the masked state after it was already seen in this attempt (nothing changed outside masked cells, or an earlier state came back); RESET is exempt. A checkable prediction (cells, level_changed, state) that misses also stops it, as `ARC_THIN_BATCH_STOP=miss` does now; text is not checked. env.act reports progress and the code decides; the act share still caps a call | `batchStop` in `demo/arc_thin_extension.ts`; env.act result | returns control in 7 of 14 batches, after #6, #18, #28, #38, #48, #59 and #69; 53 of their actions not played; no GAME_OVER in #38–#45; the level-1 batch unchanged | one decision (~15k uncached input) each time it fires |
| M2 | The ticker mask also covers a line: a row or column in which ≥4 consecutive non-RESET actions that changed anything, ≥2 of them distinct, each changed ≤4 cells that had not changed before in the attempt. Stall, repeats, "changed nothing" and M1 ignore it; the facts add one counted line (at #27: "row 63 changed on all 14 actions that changed anything since #3, 2 cells each, none back; 28 of 64 changed") | `maskedHashes`, `renderFacts` in `demo/arc_thin_ledger.ts` | found after #16; "changed nothing" 77 instead of 17; stall and repeats fire during the fills | one facts line |
| M3 | Refinement for discrimination: the next experiment is the cheapest action that tells the premise of the current line of play from a rival (a goal test when that is cheap); a hypothesis it writes names its rival; condition lines state counts, not instructions ("turn a belief … into a HYPOTHESIS with a check") | `REFINER_SYSTEM` in `demo/arc_thin_refiner.ts`; conditions in the extension | #37 and #78 would weigh the fills against a rival | refiner input only |

- Not proposed: a declared plan or checkable prediction as the condition for a batch (su15-s04's wasteful batches
  declared targets; it would add decisions to the winning batch and an obligation to `arc_action`); a stop on repeated
  identical actions (cuts navigation by repeated moves, where each step does make progress).
- Generality: no colours, positions or labels in code or prompts; M2 is defined on diffs and the facts state counts,
  not meaning. The pattern is in-sample (su15-s02/s04; the 2026-10-09 ls20 runs also took a move bar for the goal).
- Protocol (needs its own budget; one main factor at a time): E1 = M1+M2 (M1 needs M2's mask) against `64a9f580` on
  su15 forks from a snapshot after decision 5, 3 forks per arm, each ≤60 actions, ≤30 min, ≤600k budget tokens;
  negative cases: ls20 (navigation with repeated moves and a move bar), 2 forks per arm, ≤40 actions, and a held-out
  game chosen by a fixed rule before the runs. Keep if the share of actions with no change outside masked lines falls
  by at least half from su15-s04's 0.82, actions to level 1 (or levels within 60 actions) are no worse, budget tokens per
  action rise by at most 25%, ls20 actions per decision fall by at most 25%, and M2 stays silent where no line qualifies.
  E2 = M3 on top of E1.
- Separate: the timeout that ended su15-s04 is a real remote fault of the kind deferred item A handled only with mocks;
  reconciling an unknown step by reading the environment's state, if the SDK exposes it, would keep such a run going.

## M1 + M2 built (2026-10-16, user request "implement M1+M2, then run E1")

| Item | Where | Default | Earlier behaviour |
|---|---|---|---|
| M1: a batch stops after an action that changed nothing apart from masked cells (ticker cells, meter lines) or brought back the state the batch started from, and after a checked prediction (cells, level_changed, state) that missed; a RESET or a level change always counts as progress; the stop line says why ("#18 changed only cells that change on (nearly) every action (row 63)"); env.act returns `progress` (and `no_progress`) and the code decides; tool description and the system prompt's batch sentence say so | `progressAt` in `demo/arc_thin_ledger.ts`; `stillReason`, `batchStop`, `actForCode`, `{{batch}}` in `demo/arc_thin_extension.ts` and `demo/prompts/arc_thin_native_system.md` | `ARC_THIN_BATCH_STOP=progress` | `ARC_THIN_BATCH_STOP=end` (782781cd), `=miss` (miss stop only) |
| M2: `meterLines`: a row or column changed by ≥4 consecutive non-RESET actions that changed anything (≥2 of them different, none a click on the line), each changing 1–4 cells not changed before in the attempt; masked per level with the ticker cells for stall, repeats and M1; facts count "N only recurring cells" apart from "changed nothing" and add one `RECURRING CHANGE` line | `meterLines`, `maskedHashes`, `buildLedger(…, { lines })`, `renderFacts` | `ARC_THIN_METER_LINES` on | `ARC_THIN_METER_LINES=0` |
| Measurement: the same detection over any run, whatever its flags: no-change share after the fork point, batch stops by kind, python actions without progress, actions to the first level change | `tools/arc_thin_progress_eval.ts` | — | — |

- **Deviation from the analysis.** M1 was to stop at any state seen earlier in the attempt. That would cut a planned
  path that crosses where it has been (backtracking in a maze), and su15-s04 had no such stop, so M1 stops only at a
  return to the state the batch started from. Recorded before any real run.
- **Relation to earlier work.** M2 is a narrow instance of the every-variant-part design of
  [2026-10-09](2026-10-09-ledger-critic-general-signals.md) (not implemented): lines instead of position-free region
  signatures, and different thresholds. That design's thresholds (≥3 variants each tried twice) would not have found
  su15-s04's row before #45. G4 disclosure: METER_RUN = 4 and METER_CELLS = 4 were chosen after reading su15-s02–s04, so
  su15 is in-sample; they are frozen for E1.
- **Generality.** No colour, position or role in code, prompts or tests; the unit fixtures are synthetic boards (a
  filling row, an object moved by one action, clicks that paint the clicked row, a toggled cell); the facts state counts.
  A negative case it cannot rule out: a game whose goal is to fill such a line has every step stopped (the agent can
  still play one per call or loop in code with `progress` in view).
- **Offline evidence.**
  - Unit: `tests/arc_thin_meter_lines.test.ts` (5, new), `arc_thin_batch.test.ts` (4: the 782781cd stops under
    `end`, the share cap, `miss`, and the new default with "changed nothing", a checked miss, text not checked, and a
    loop back to the batch's start), `arc_thin_native_context.test.ts` (prompt contract). Full suite: 41 files, 198
    tests, 193 pass; the 5 failures are the ones that also fail at deecdde6 (activation, components, receipts ×3;
    `C:/Users/qi/tmp/r03b-simple/tests-m12-full`).
  - Real runs, read only: the eval finds row 63 as a meter line in su15-s02 (since #2), s03 (#8) and s04 (#3); s04's
    actions after it: 17 changed nothing and 57 only the row (share 0.787; RESETs and level 2 not counted). M1 over
    s04's 14 recorded batch calls (`C:/Users/qi/tmp/r03b-simple/m1-counterfactual-s04.json`): control back 7 times,
    53 actions not played, the batch that completed level 1 unchanged.
  - Smoke (mock SDK with `MOCK_ARC_METER=1`, production bridge, installed Pi, scripted provider): new `progress` script
    — four moves show row 7 as a meter, "batch: 1 of 3 played; stopped: #5 changed only cells that change on (nearly)
    every action (row 7)", env.act `progress=False` with its reason, "#8 brought back the state this batch started
    from", the RECURRING line and "only recurring cells" in the heads, the new batch sentence in the system prompt.
    `activation`, `activation:defaults`, `schedule`, `foundation` pass their own checks under the new defaults. Every
    native script still stops at the shared `system_chars <= 3000` check, as before
    (`C:/Users/qi/tmp/r03b-simple/smokes-m12b`).

**E1 protocol (fixed before the runs).**
- Arms on one commit: A = `ARC_THIN_BATCH_STOP=end ARC_THIN_METER_LINES=0` (782781cd behaviour), B = defaults. yibu /
  qwen3.8-27b, thinking off (`enable_thinking=false`, Completions), query observations, text+image.
- Sources (A flags, so the shared prefix plays as before): su15 snapshotted after decision 5; ls20 (negative case:
  moves by keys, a move bar) and ar25 (held-out: the first id, alphabetically, of the 25 games the API lists that no
  run in `D:/autoresearch_pi_project/runs` used) after decision 3.
- Forks per arm: su15 3 (each ≤60 actions after the fork, ≤600k budget tokens, ≤1,800 s); ls20 and ar25 2 (≤40,
  ≤400k, ≤1,500 s). A and B of the same index run at the same time. Budget ≤ 8.0M budget tokens in all.
- Measures (`tools/arc_thin_progress_eval.ts`, the same detection for both arms): no-change share after the fork,
  levels and actions to the first level change, budget tokens per action, actions per decision, batch stops by kind,
  lines found.
- Keep M1+M2 as the default if on su15 B's mean no-change share is at most half of A's, levels and actions to the
  first level change are no worse, and budget tokens per action rise by at most 25%; and if on ls20 B's actions per
  decision are at least 0.75 of A's; ar25 and ls20 report every line found and whether it is a line that fills on
  every action (inspected in the frames). Exploratory: 2–3 forks per arm, all reported.

**E1 results (2026-10-16; stopped after the first pairs, commit `c5d0110c`).** Output
`D:/autoresearch_pi_project/runs/arc-e1-20261016`; measured with `tools/arc_thin_progress_eval.ts`
(`C:/Users/qi/tmp/r03b-simple/e1-summary.json`). Sources: su15 17 actions at decision 5 (the last 10 one batch on one
cell: the counter row half full at the fork), ls20 20, ar25 3.

| Fork | Actions after the fork | No-change share | Levels | Budget tokens per action | Actions per decision | Notes |
|---|---|---|---|---|---|---|
| su15 A1 | 60 | 0.683 | 0 | 4,702 | 3.3 | |
| su15 A2 | 11 | — | 0 | — | — | ended by an ARC step over 90 s (`environment_outcome_unknown`) |
| su15 B1 | 46 | 0.652 | 0 | 13,220 | 1.9 | token cap; 31 python actions, 28 without progress |
| su15 B2 | 57+ | 0.632 | 0 | 7,485 | 2.4 | 15 python actions, all without progress |
| ls20 A1 | 40 | 0.100 | 0 | 9,958 | 2.9 | lines found: rows 61, 62 |
| ls20 B1 | 40 | 0.025 | 0 | 9,847 | 2.7 | stops: 4 returns to the batch's start (the agent cycled moves to drain the bar), 1 move that changed only the bar |

- **Verdict: not kept as built.** On su15 the no-change share did not fall (B 0.64 against A 0.68) and tokens per action
  rose 1.6–2.8×. ls20 actions per decision stayed within the limit (0.93 of A), and its stops hit real loops.
- **Broken transition: the stop was not taken as evidence.** After the first stop, both su15 B forks played the same
  presses from python, which reported `progress=False` and went on; B1 wrote: "the harness treats row-63 changes as
  recurring and won't let a multi-action batch ride on them. I'll drive the fill via Python." The goal belief ("fill
  the row") formed after five clicks and held until the row was full, as in s04.
- Not run: su15 pair 3, ls20 pair 2, ar25 (held-out) pairs. M2 found the bar in ls20 too (rows 61–62); its false-line
  check on a held-out game is still open.

**r2 (2026-10-16, the user's loop: fix, then run su15 again).**
- Acting code: a python call stops acting after `ARC_THIN_STILL_LIMIT` (3) actions without progress
  (`NativeRuntime.stillCounter`; `stillLimit` host); the system prompt says so.
- The stop says what the agent needs: "#18 changed only cells that change on (nearly) every action (row 63); outside
  them the board has not changed on this level" (`progressAt`).
- M3, refinement for discrimination: `REFINER_SYSTEM` asks first what the current line of play assumes and, when the
  record has no rival for it, for the rival and the cheapest action that separates them; the next experiment is the
  cheapest separating action, a goal test only when it is cheap; the promotion events ask for the untested rival as a
  checked hypothesis instead of the agent's own belief.
- Environment: the bridge's SDK step timeout is `ARC_BRIDGE_STEP_TIMEOUT_SECONDS` (default 90 s; the pilots set 300 s)
  and the extension waits that long plus 30 s for an action; an expired call is still never replayed.
- Checks: the targeted suites (meter lines, batch, facts, fixed refine, native runtime, kernel, act limit, promotion,
  native context) pass 44/44; the `progress` smoke now also checks "STOPPED 3 actions of this call moved nothing on";
  `progress`, `activation`, `schedule` and `promotion` pass their own checks.

**Held-out check, ar25 (r2 code, one pair).** Both arms completed level 1 (A 26 actions after the fork, B 28); no-change
share A 0.226, B 0.133. M2 found column 63 in both: the frames show a bar that fills one cell from the top per action
and resets at RESET and at the level change, a counter, so no false line (`C:/Users/qi/tmp/r03b-simple/ar25-col63.txt`).

**su15-r2 (r2 `51b1ae6b`, no run caps, thinking off; `D:/autoresearch_pi_project/runs/arc-loop-20261016/su15-r2`).**
Ended by level 2's budget at 261 actions, 62 minutes, 3.84M budget tokens, 1 level.
- Level 1 at #51 (su15-s04: #92): the click that moves the block found at #7 and the solution played as one python
  loop of 20 moves (#32–#51). All 261 actions went through python; the 3-action stop fired 8 times.
- Level 2: 210 actions without the level. The agent worked out the new pieces (clicks create 2×2 blocks, move them,
  pull the nearest one into the large shape; ACTION7 undoes), tested many goal ideas by text predictions, and reset
  20 times. At #152 and #165 the refiner rewrote the strategy to "complete row 63"; the agent filled the row twice
  (GAME_OVER at #207 and #240). The facts said "GOAL TESTS: none" and the refiner was told "no goal test yet", since
  only predict fields count; a hypothesis whose check failed on 174 of 179 moves stood in full at the top of every head.
- No-change share 0.335 by #170 (s04 0.79).

**r3 (`b80023c7`).** The facts line and the refiner condition say that only predict fields count as goal tests; a
hypothesis whose own check fails on ≥10 and ≥90% of the moves it bears on is shown as one line asking to revise or
delete it. Suites touched pass 53/53. su15-r3 started 02:25 (Asia/Shanghai) with the same settings as r2.

## Not built (only if runs show the need)

Stopping a batch on an exact repeat (now inside M1 above); an old-event view, decision transcript files or
previous-decision-only history; animation frames in the head; moving prompt sections or continuing responses across
decisions; a JSON or repair refiner; phase01's reuse pack and its contested-on-failed-check status.

## Delivery decision

- Supported: the implementation and its offline behaviour; wiring of the fixed schedule, notices, facts and refusal
  through the real bridge and Pi with a scripted provider.
- Not supported yet: that the agent reads and uses the facts or notices, and any task or cost effect.
- Next falsifiable checks: E1 (M1+M2 against `64a9f580`, §After su15-s04), then E2 (M3); R1 and R2 remain. Each needs
  its own budget.
- Backlog ([deferred-research-todos](../deferred-research-todos.md)): A (RESET semantics) — the refusal reports public
  facts only, no rule; A also covers the environment-fault contract, which the su15-s04 timeout exercised for real, and
  keeping action sequences above the adapter: batches and M1 stay in the extension, the bridge still takes one action
  per call. C/D (carry and continuity across compaction) — the carry ask is off, and the history window is the R2
  experiment. None closes.
