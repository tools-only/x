# r03b simple context: the runtime's facts in the head, refinement on a fixed step, a bounded history

Date: 2026-10-15 (Asia/Shanghai). Status: implemented on `claude/r03b-simple-20261015` (commit `83276f8b`), cut from tag
`ls20-r03b-deecdde6`; offline checks and the deterministic foundation smoke done; one real su15 run started on the
user's request (§Real run). Paired comparisons R1/R2 are not run.

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
| Autonomous adoption | Unverified | — | su15-s02/s03 are single ordinary runs; they can show whether facts, notices and batches are used, not a causal effect |
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
caps 6,000,000 budget tokens and 36,000 s. Output `D:/autoresearch_pi_project/runs/arc-r03b-simple-20261015/su15-s03`;
evaluate with `PILOT_OUT=D:/autoresearch_pi_project/runs/arc-r03b-simple-20261015 python tools/arc_ls20_loop_eval.py su15-s03`.

## Not built (only if runs show the need)

Stopping a batch on an exact repeat; an old-event view, decision transcript files or previous-decision-only history;
animation frames in the head; moving prompt sections or continuing responses across decisions; a JSON or repair
refiner; phase01's reuse pack and its contested-on-failed-check status.

## Delivery decision

- Supported: the implementation and its offline behaviour; wiring of the fixed schedule, notices, facts and refusal
  through the real bridge and Pi with a scripted provider.
- Not supported yet: that the agent reads and uses the facts or notices, and any task or cost effect.
- Next falsifiable checks: su15-s02 (facts cited in reasoning or notes; no-change share and streaks; refiner
  outcomes), then R1 and R2 under their own budgets.
- Backlog ([deferred-research-todos](../deferred-research-todos.md)): A (RESET semantics) — the refusal reports public
  facts only, no rule; C/D (carry and continuity across compaction) — the carry ask is off, and the history window is
  the R2 experiment. None closes.
