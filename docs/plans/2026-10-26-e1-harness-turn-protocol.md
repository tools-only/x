# Meta-harness change: harness turn with an action-boundary place (E1 protocol)

Date: 2026-10-26 (Asia/Shanghai). Status: R1–R6 approved and done (see Implementation and Verification); the free
checks ran. Nothing paid has been launched, and no run budget is authorized.

## Problem and claim

- **Failure.** E0 ([report](../reports/2026-10-26-review-followup-audit.md)) covered 74 review turns from 28 su15 runs.
  - 46 of 58 written reviews name a cost in the agent's own way of working. The most named:
    - repeated moves with known results: 32
    - a belief kept without evidence: 18
    - a counter run down without noticing: 18
    - a misread direction: 17
  - None of the 46 was followed by an executable component.
  - Replays of known results went from 31% before such reviews to 36% after.
  - In one traced case, a delivered countdown view and a resident rule both stated the constraint, and the next action
    broke it.
- **Narrow claim.** A review turn (stall, spin or level) whose deliverable is one harness change will turn named loop
  costs into executable components that bind, when it has three things the current review lacks:
  - loop facts it can see;
  - an expectation that is checked and reported back;
  - a place at the action boundary: a guard the agent writes and the runtime checks before each action.

  Today's reviews deliver prose and `- test:` lines.
- **Burden removed.** The parent no longer has to remember and obey its own review at every decision. What it decided
  runs or refuses by itself.
- **Refuted if any of these hold:**
  - B's harness turns yield executable components at most as often as A's reviews (E0: 0 of 58).
  - The components B creates do not lower replays or counter run-downs relative to A.
  - B costs more than 1.3x A's tokens per action with no behavioural difference.
- **Scope.** Arms, starting states, caps, measures and stop rules; the code changes arm B needs (listed, not done).
- **Not in scope:**
  - the `probe` place (an experiment the runtime plays);
  - owner registry, editable policy files, manifests, leases;
  - any game content;
  - any `arc_action` field.

## Design and cost

- **Arm A (control).** Today's review prompts (prose plus `- test:` lines). No loop facts, no component EXPECT, no guard
  place.
- **Arm B (treatment), one factor: the harness turn and its places.**
  - The same stall, spin and level review turns. Each must make the one harness change that best removes a cost in the
    loop record, revise or retire one that did not help, or end with `NO HARNESS CHANGE: <reason>`.
  - The turn shows a LOOP AUDIT (at most 1.2k characters, facts only) and the run's loop logs read-only under
    `data/loop/`.
  - Components may carry the refiner's `EXPECT … check(t) … END` block. The runtime reports the verdict at the next
    harness turn and in the HARNESS index.
  - Places listed, never what to build: prompt, view, predictor, callable tool, guard.
  - A guard is `admit(state, action)` in `tools/*.py`. The runtime calls it before every action from `arc_action` or
    `env.act`. A returned reason refuses the action, and the receipt says so: "<action> was NOT played: refused by your
    guard tools/x.py vN: <reason>. This is your own rule, not the game's: the game did not see this action." A refusal
    never ends the decision. A guard that refused 2 actions within one decision is not asked again in that decision,
    and the receipt says so. A guard that fails, or takes longer than 8 s, lets the action pass, and the receipt says
    that too.
- **Held fixed in both arms:**
  - **Level scoping:** views and predictors saved on an earlier level stop running until re-saved. This is the G2 defect
    fix.
  - **View output at the tail,** next to THIS BOARD.
  - **`ARC_THIN_REVIEW_CONSULT=0`:** in E0 the consult-first gate cost 8 reviews their whole output.
  - **`ARC_THIN_REFINE_POINT=0`:** this avoids the refine-point deadlock (F2 in the 10-22 report). The scheduled
    refinement every 15 actions stays, so the refiner is still on.
  - **Today's defaults** for stall review (40), spin review (2), level review (on), work memory and the no-effect refusal
    (3 in query mode).
- **Lifecycle.**
  - The runtime pushes the turn (existing review schedule).
  - The agent diagnoses and writes or revises one component, or gives a reason for none.
  - The binder validates and mounts it at the next boundary.
  - The runtime runs or delivers it and records refusals and EXPECT checks.
  - The next harness turn shows the verdicts, and the agent keeps, revises or retires.
  - A component retires on the agent's deletion, at a level change (views, predictors, guards), or on suspension within
    a decision (guards).
- **First benefit.** One parent decision: the harness turn's own write. No extra call points, forms or workers.
- **Added and removed.**
  - Added in B: the contract text at review turns, one system-prompt line naming the guard place, and the LOOP AUDIT at
    review turns only.
  - Added in both: the fixed defect fixes above.
  - Removed in B: the prose template and the `- test:` lines as the required output (a prompt with tests is still
    allowed).
- **Boundaries unchanged:** budgets, the environment boundary, binder versions, read-only `data/`, the `arc_action`
  schema. A guard can refuse an action; it cannot act, write, or reach past the bridge.
- **Abandonment.** Each switch is an env flag, and off means today's behaviour. Environment history is never rolled back.

## Pre-run experiment protocol

- **Target evidence:** autonomous adoption (does the harness turn produce components) and binding (do they change actions).
  Levels are reported, but this n cannot support a net-benefit claim.
- **Comparator:** A against B on the same frozen commit. Within a pair, the start state and every setting other than the
  B flags are identical. Both runs of a pair are launched together, so they share gateway conditions.
- **Common settings:**
  - provider yibu; text and image input; `ARC_THIN_OBSERVATION=query`;
  - refiner, ledger and critic on;
  - launched with `tools/arc_ls20_loop_pilot.py` from a clean, detached checkout of the E1 commit;
  - token cap measure: uncached input plus output, counting only usage after the fork.

### Starting states

| id | game | start | why |
|---|---|---|---|
| S-q | su15 | `runs/arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1/arc-run/snapshots/after-decision-25` (63 actions; level 1 complete at #63; query) | The next turn is the level-1 level review, so the first turn is already a harness turn in B. Level 2 then stalls for qwen: 0 passes in the 5 earlier forks from this snapshot that played 23 to 112 actions (R2h-A, R2h-B, su15-chm, chm-r3, o2o6). Stall and spin reviews followed after about 37 to 40 level-2 actions. The workspace holds views the agent asked for in level 1, plus a stale level-1 view. |
| S-g | su15 | `runs/arc-models-20261019/su15-g61-1/arc-run/snapshots/after-decision-18` (22 actions; level 1 complete) | gpt-6.1-sol's own level-1 prefix. The lessons fork from it reached level 4, with 121 actions and 4 resets on level 4, so level reviews come early and stalls come later. |
| H | ls20 | game start, no fork | The held-out game: not used for any mechanism since 2026-10-16, and not in E0. qwen has 0 levels in 40 to 110 actions on recent ls20 runs, so stall reviews will fire. Alternative if you want level reviews too: ar25 (qwen passed level 1 in about 30 actions on 10-16). |

There is no snapshot inside a level-2 stall, and building one would mean a paid source run. Starting at the level-2 start
of a prefix that stalled in every earlier fork puts the first stall review within about 40 actions, and the first turn of
each fork is already a review.

### Runs and token caps

The cap is in budget tokens (uncached input plus output, after the fork). Per-action estimates come from these logs:
- qwen query, level 2: 22k (R2h-A) and 27k (R2h-B), including reviews at 60 to 75k each;
- gpt-6.1-sol query: 24k (lr-g61);
- qwen query ls20: 10 to 13k on 10-15/16 code, assumed 15 to 20k now.

| run | stage | model, reasoning | start | arm | cap | wall clock | expected harness turns |
|---|---|---|---|---|---|---|---|
| G1-A | 1 | gpt-6.1-sol, medium (`PILOT_THINKING_FORMAT=openai`) | S-g | A | 2.5M | 6 h | 3–5 |
| G1-B | 1 | gpt-6.1-sol, medium | S-g | B | 2.5M | 6 h | 3–5 |
| Q1-A | 1 | qwen3.8-27b, off (`PILOT_THINKING_FORMAT=qwen`) | S-q | A | 2.0M | 6 h | 4–9 |
| Q1-B | 1 | qwen3.8-27b, off | S-q | B | 2.0M | 6 h | 4–9 |
| Q2-A | 2 | qwen3.8-27b, off | S-q | A | 2.0M | 6 h | 4–9 |
| Q2-B | 2 | qwen3.8-27b, off | S-q | B | 2.0M | 6 h | 4–9 |
| H1-A | 2 | qwen3.8-27b, off | H | A | 1.5M | 4 h | 2–5 |
| H1-B | 2 | qwen3.8-27b, off | H | B | 1.5M | 4 h | 2–5 |
| H2-A | 2 | qwen3.8-27b, off | H | A | 1.5M | 4 h | 2–5 |
| H2-B | 2 | qwen3.8-27b, off | H | B | 1.5M | 4 h | 2–5 |
| HG-A, HG-B (optional) | 2 | gpt-6.1-sol, medium | H | A, B | 1.5M each | 4 h | 2–5 |

- **Stage 1:** 9.0M (G1 5.0M, Q1 4.0M).
- **Stage 2:** 10.0M, plus 3.0M optional.
- **Total:** 19.0M, or 22.0M with HG.
- **Relaunches:** a run that dies of infrastructure before 20 actions may be relaunched once. Its tokens count against
  its stage total; beyond that total, I ask you first.

### Order and concurrency

- **Order:**
  1. Stage 0: the free checks below.
  2. G1.
  3. Q1.
  4. The gate.
  5. Q2, then H1, then H2, then optionally HG.
- **Concurrency:**
  - At most 2 runs on yibu at a time, one pair. Three concurrent runs coincided with the 300 s stalls of 10-21.
  - Avoid 20:00–01:00 local.
  - Launch detached (`wmic process call create` plus a `.cmd`), never from a Terminal tab.

### Stop rules

- **Per run:**
  - the token cap or the wall clock;
  - provider errors and outage as runner defaults (3 in a row; 3600 s per run);
  - 3 environment restarts.
  - A gateway "repetitive tool calls" refusal ends the run, which is recorded as lost.
- **Stop B if** guard refusals end a run, or three decisions in a row have every action refused. That is a defect: fix
  it, then rerun the pair.
- **Gate after G1:** if G1-B produced no executable component in 3 or more harness turns, stop E1. The contract or the
  interface fails even for the strong model, so go back to design and do not run qwen.
- **Gate after Q1:** if Q1-B produced none in 6 or more harness turns, run no more qwen pairs. Report a capability floor
  or contract failure for qwen; HG is your call.

### Primary measures

Fixed in advance. Each review window is the harness turn plus 20 actions; results are per run and pooled per model.

| | measure | supports | refutes |
|---|---|---|---|
| P1 conversion | harness turns followed (in the turn or within 40 actions) by an executable component the agent wrote: view, predictor, tool, guard or check. A prompt-only change and `NO HARNESS CHANGE` are counted apart. | B ≥ 1/3 of its turns, and ≥ 2 such components, while A stays near E0's 0 | B ≤ 1/10 over ≥ 6 turns (qwen) or ≥ 3 turns (gpt) |
| P2 binding | (a) each B component is delivered after creation (shown with content, scored, or refusing); (b) actions replaying a known result in the 20 actions after each harness turn, B against A | (a) holds and (b) B ≤ A − 10 points | B ≥ A on (b) |
| P3 guardrail | budget tokens per action, B/A within a pair; runs lost to guard defects; guard refusals the agent later records as game rules (read in memory/rules) | ≤ 1.3x and 0 lost | > 1.3x with no P2 effect, or any run lost |

**Secondary measures:**
- levels completed and actions per level;
- GAME_OVERs and RESETs (counter run-downs);
- tokens in harness turns;
- EXPECT verdicts (held, failed, unused) and the agent's revisions or retirements;
- pins listed, pinned and played (B may write fewer tests);
- reasoned no-change turns.

**Comparisons with history:**
- qwen level 2 from S-q: 0 of 5;
- gpt from S-g: levels 2 to 4 within about 220 actions;
- E0 rates.

### Negative cases to look for

- A guard refuses a move that later appears in a level-completing sequence (harm).
- A guard is suspended every decision (noise).
- The agent records a guard's refusal as an environment rule.
- B writes components whose EXPECT fails and never revises them.
- B replaces reviews with prompt-only changes, so P1 fails while costs rise.
- Harness turns hit the 10-call review limit before saving.
- Stale-view effects persist despite the scoping fix.

### Telemetry

- **Existing:**
  - `trajectory.jsonl` (`novelty`, `known_from`);
  - `working_set.jsonl`;
  - `observer_runs.jsonl`, `component_runs.jsonl`;
  - `refiner.jsonl` (pins, EXPECT);
  - `usage.jsonl`;
  - `runtime-audit/provider-inputs.jsonl` (what reached the model).
- **From Codex's implementation:** `harness_decisions.jsonl`, `harness_changes.jsonl`, `harness_expectations.jsonl`,
  `tool_refusals.jsonl`. All four are written in both arms; only arm B is shown them.
- **New:** `guard_runs.jsonl`, one row per guard answer (action, guard, version, verdict allow, refuse or error, reason or
  error). Guard refusals are also tool refusals.
- **Analysis:** `tools/arc_review_followup_audit.py`, extended to read those files, with the E0 rubric for labels and the
  labels file kept for re-checking. Report: `docs/reports/<date>-e1-harness-turn-results.md`.

## Implementation (R1–R6, approved and done 2026-10-26)

Codex's diff from `codex/meta-devloop-20261026` (base `73cddb12`) was applied to r04, reviewed, and changed as below.
Files: `demo/arc_thin_binder.ts`, `demo/arc_thin_components.ts`, `demo/arc_thin_expectation.ts` (Codex's),
`demo/arc_thin_extension.ts`, `demo/arc_thin_native_runtime.ts`, `demo/prompts/arc_thin_native_system.md`,
`src/autoresearch_pi/arc_thin_e2e.py`, `tools/arc_thin_smoke_provider.ts`, `tools/run_foundation_smoke.py`, and tests.

- **R1, Codex's work folded; review findings fixed:**
  - Level scoping narrowed. Components that run by themselves (views, predictors, guards) stop on a later level until
    saved again, and the index says "stale, not running on this level (save it again to run it)". Prompts, callable
    tools, skills and subagents stay active; the index calls them stale, as before.
  - Python-side deletes and moves were lost. Codex's op loop called `workspace.mutate` only for writes, so `os.remove`
    and `os.rename(..., '_off/...')` changed nothing, and the agent could not retire a component from Python. Restored;
    `tests/arc_thin_activation.test.ts` caught it.
  - Flag off restores today's review: the one extra write of the review's own file after its last call, the lessons
    length note, and the receipt as it was.
  - View output at the tail is unflagged, as protocol section "Held fixed" says, but `ARC_THIN_CONTEXT_LAYOUT=0` keeps
    the old placement. Codex moved it in both layouts.
  - `data/loop/` gets no copy of `working_set.jsonl` (the agent's own context, megabytes per run). It gets
    `observer_runs.jsonl` and `guard_runs.jsonl`.
- **R2, `ARC_THIN_HARNESS_TURN=1`** (native treatment only; the runner and the extension read the same variable):
  - the contract prompts and their recovery prompts (`HARNESS_TURN_CONTRACT`, `_harness_contract`);
  - the LOOP AUDIT and the raw logs under `data/loop/` at review turns;
  - the EXPECT results at review turns;
  - the harness turn's budget note at its last call.

  Off, the prompts and recovery prompts are today's, byte for byte; the Python tests for them are back to `73cddb12`.
  `run-config.json` records `harness_turn` and `guards`. In both arms an EXPECT trailer is stripped from the saved
  component and recorded, and the receipt confirms it ("EXPECT recorded for vN: … within N actions", plus "the next
  review says what check(t) returned" when the flag is on). No prompt asks arm A for a trailer.
- **R3, `ARC_THIN_GUARDS=1`** (native treatment only):
  - The inspector marks a tool with a top-level `def admit(state, action)` as a guard. A guard that calls `env.act` is
    refused at save. A guard is never a default view.
  - `NativeRuntime.admit()` asks each active guard in the view pool, on the state before the action, for at most 8 s.
  - `submitAction` asks every guard not suspended in this decision, after the no-effect check and before the bridge.
    This covers `arc_action`, its then list and `env.act`.
  - The refusal receipt is as described under Design. `GUARD_REFUSALS_PER_DECISION = 2`.
  - Every answer is logged to `guard_runs.jsonl`. A failed guard adds a receipt clause, and the action is sent.
  - The HARNESS index line reads "guard, asked before each action is sent · asked N×, refused R[, failed F×]". A guard
    that failed on half of 5 or more answers is listed under "Ran without helping".
  - The system prompt's Tool line names `admit` when the flag is on. The contract lists the guard place only when
    both flags are on.
  - Off, a tool that defines `admit` is indexed "not asked: guards are off in this run" and is never asked.
- **R4, LOOP AUDIT facts (≤1,200 characters):**
  - Window: since the previous review. Reviews are counted by the action count they began at, so a review's recovery
    turn is not a second review.
  - Actions in the window: known-result replays, actions that changed at most 2 cells, GAME_OVERs and RESETs.
  - Earlier reviews: those followed by a component change in the same turn, and explicit no-change turns.
  - Python calls and pinned tests.
  - Tool refusals, with the guards' share, and mean agent tokens per decision.
  - The agent's own components (the latest 6 it wrote; refinements are excluded) with their use from the index counts.
  - The raw logs present.
- **R6:** see Launch.

Two departures from the protocol text above, both in the guard design. Suspension counts refusals within a decision,
not refusals in a row. The log is `guard_runs.jsonl`, with every answer, not a refusal-only file.

## Verification (free: no provider tokens)

| check | result | where |
| --- | --- | --- |
| Node tests: all 44 `tests/arc_thin_*.test.ts` files, one process each | 5 tests fail in 3 files, and all 5 fail the same way on a clean checkout of `73cddb12`: activation "saved code acts in a closed loop … unsaved code cannot act", components "python session never stores runtime objects …", and the 3 receipts tests. The rest pass, including the new and changed tests: binder scoping, harness turn with the flag on and off, guard refusal and suspension, failed guard, guards off, EXPECT strip on Python save. action_surface timed out once while a worktree was being created, and passed on rerun. | per-file output under `tmp/e1/` (not committed) |
| pytest: the 8 `test_arc_thin_*` files, `test_arc_foundation_config.py`, `test_arc_bridge_deadline.py` | 49 passed | — |
| Scripted smoke `guard`: real Pi 0.87.0, production bridge, mock SDK, WASI, scripted provider; both flags on; a stall review after 2 actions | Every guard check passed. The review shows the contract with the guard place and a LOOP AUDIT. The saved guard has no trailer; `harness_changes` and a candidate EXPECT are recorded, and the receipt confirms them. ACTION3 is refused before the bridge with the receipt above. Trajectory: ACTION1, ACTION4, ACTION1, ACTION4. `guard_runs`: refuse, allow, allow. The run then fails the shared `system_chars <= 3000` assert, as every native smoke has since 10-16: 4,312 characters here, of which the guard line adds about 170 when it is on. | `runs/e1-smoke-20261026/guard-2` |
| Scripted smoke `foundation`, flags off | Its own checks pass, then the same shared assert fails. | `runs/e1-smoke-20261026/foundation-1` |
| Scripted smoke `components`, flags off | Fails at `NATIVE_STANDING_RULE in system_prompt`, and fails the same way at `73cddb12`: the prompts have been in the head since `3ff04b13`. The view rows it checks after that line match its expectation: (1, 3), (2, 4), (4, 777), (5, 777). | `runs/e1-smoke-20261026/components-1`, `components-base` |
| Fork-load S-q and S-g, `MAXDEC=0`, frozen checkout of `5c86748d`, arm B flags, query observation | Both passed with stop `max_decisions` and 0 decisions. The prefixes replayed on the ARC environment with the scorecard verified: S-q 63 actions, S-g 22, level 1 complete in both. Reported tokens equal the prefix's (S-q 1,785,674; S-g 219,292), so no provider request was made. 0 extension errors. `run-config.json` records `harness_turn` and `guards` true. | `D:/autoresearch_pi_project/runs/arc-e1-20261026/forkload-sq-B`, `forkload-sg-B` |

## Launch (prepared, not run)

- **Frozen source (R6):** the E1 commit `5c86748d` on `claude/r04-20261017`, checked out detached at
  `D:/autoresearch_pi_project/worktrees/e1-frozen`, with a `node_modules` junction to the project's. Before removing
  that worktree, run `cmd /c rmdir` on the junction first.
- **Every run:**
  - environment: `PILOT_SOURCE` = the frozen checkout, `PILOT_OUT=D:/autoresearch_pi_project/runs/arc-e1-20261026`,
    `PILOT_GAME=su15` (or the held-out game), and the model settings in the runs table;
  - command: `python <frozen>/tools/arc_ls20_loop_pilot.py <label> 0 <cap> 21600 FORK=<start>`;
  - variables in both arms: `ARC_THIN_OBSERVATION=query ARC_THIN_REVIEW_CONSULT=0 ARC_THIN_REFINE_POINT=0`.
- **Arm B** adds `ARC_THIN_HARNESS_TURN=1 ARC_THIN_GUARDS=1`. Arm A adds nothing.

## Evidence

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Verified (function and wiring) | node tests, pytest | Verification table; 5 failing tests also fail at `73cddb12` |
| Full-chain reachability | Verified with the scripted provider, and fork loading on the ARC environment | real Pi 0.87.0, production bridge, mock SDK, WASI; the real bridge and ARC environment for the fork loads | `runs/e1-smoke-20261026/guard-2`; `D:/autoresearch_pi_project/runs/arc-e1-20261026/forkload-*`; no real provider request, so nothing about model behaviour |
| Autonomous adoption | Unverified | — | E0 baseline only: 0 of 58 written reviews followed by an executable component |
| Net benefit | Unverified | — | Not targeted by E1 |

## Decisions still open

1. **Fixed conditions** (section "Held fixed"):
   - query observation (cheaper, and qwen passed level 1 in 8 of 9 query runs against 0 of 3 with ch);
   - review consult and refine points off in both arms.

   Scoping and the tail view are already r04 defaults with R1.
2. **Held-out game:** ls20, or ar25.
3. **Budget:**
   - Stage 1: 9.0M (G1 2 × 2.5M; Q1 2 × 2.0M).
   - Stage 2: 10.0M after the gate.
   - Optional: HG at 3.0M.
