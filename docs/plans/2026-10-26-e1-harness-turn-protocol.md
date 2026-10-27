# Meta-harness change: harness turn with an action-boundary place (E1 protocol)

Date: 2026-10-26 (Asia/Shanghai). Status: R1–R6 done; stage 1's G1 pair ran on 10-26. On 10-27, E1b added the hook
place and fixed the EXPECT feedback; G1-B′ (gpt, stopped early) and Q1-B′ (qwen low) ran on it. The results are under
"E1b runs". No run is in flight.

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

## Stage 1 runs (approved 2026-10-26: 9.0M, G1 then Q1, the fixed conditions above)

- **18:23 local, g1-a and g1-b:** launched together; both stopped at their first request with `provider_error`. The
  project `.env` gained `ARC_OPENAI_API_BASE`/`ARC_OPENAI_API_KEY` for OpenRouter after 10-21, and those take precedence
  for ARC runs; OpenRouter answered 402 (the key has no credits). No tokens were spent.
- **18:40, g1-a2 and g1-b2:** the protocol's one relaunch after an infrastructure failure. ARC's endpoint is pinned to
  yibu for these processes only by `tmp/e1/launch/yibu_pilot.py`, which copies the `.env`'s `OPENAI_API_BASE` and
  `OPENAI_API_KEY` (yibu) into `ARC_OPENAI_*` and then runs the pilot; the `.env` is unchanged. yibu's `/models` lists
  both E1 models. After 3 minutes: g1-a2 8 actions and 120k budget tokens; g1-b2 14 actions, 139k, and level 2.
- **Q1:** launchers prepared (`tmp/e1/launch/q1-a.cmd`, `q1-b.cmd`, pinned to yibu the same way). Not launched: held
  after G1 (see E1b).

### G1 results (gpt-6.1-sol from S-g, frozen `5c86748d`, both runs stopped at the 2.5M cap)

| | G1-A (today's reviews) | G1-B (harness turn + guard place) |
| --- | --- | --- |
| levels completed after the fork | 4 (2 to 5) | 3 (2 to 4) |
| post-fork actions; budget tokens | 138; 2,523,332 | 147; 2,526,840 |
| tokens per action (P3) | 18.3k | 17.2k (0.94 of A) |
| review turns at action | 22, 42, 62, 99, 133 | 22, 36, 53, 93, 135, 153 |
| what the agent wrote at them | `prompts/lessons.md` v1–v5 | lessons v1–v2, strategy v3, v9, v18; one tool: `tools/inventory.py` at #135 |
| executable components written (P1) | 0 | 1 in 6 turns (1/6): a view, "positions are measured, not inferred" |
| guards written; guard answers | — | 0; 0 |
| EXPECT checks recorded; that ran | — | 5; 0 (the 4 that came due all failed: `IndentationError`) |

- **Gate after G1:** passed narrowly (one executable component, not none).
- **P1:** neither supported (needs at least 1/3 of turns and 2 components) nor refuted (1/10 or less).
- **P2:** not computed: there is one component.
- **P3:** met.
- Levels: one pair, so no claim either way.
- **What broke in arm B:**
  - **The feedback channel never closed.** The agent wrote every trailer's check as ` def check(t):` with one leading
    space. The parser kept it, and each check failed to run, so no harness turn ever saw a verdict.
  - **The one tool's trailer was never recorded.** An HTML comment is not Python, so the agent wrote that trailer as
    `#` comments, and the parser did not recognise it.
  - **The view stopped at the next level change.** `tools/inventory.py` ran on 19 states (#135–#153); the level-scoping
    rule then stopped it, and the agent did not save it again.
  - **5 of the 6 changes were prose.** The agent wrote prompts, the only place where something it writes persists and
    is pushed into later decisions.
- **Spent:** 5.05M of stage 1's 9.0M (the first pair's 402s cost nothing). Q1 needs 4.0M at its caps.

## E1b: the meta layer's missing place, and the feedback fix (2026-10-27)

### Problem

The user, restating the meta-layer goal after E1 ("still don't achieve this with the minimal modification"), describes the
target behaviour:
- At runtime, the agent recognises that it needs a Python-validated, structured level map for authoritative state.
- It creates and maintains that map, and includes it in the decision state.
- It changes the harness so that the harness hosts the validation of pinned experiments and backfills hypothesis
  `check(t)` automatically.

Here is that example traced against r04's places with both E1 flags on:

| step of the example | can the agent do it at runtime? |
| --- | --- |
| analyse its own loop | yes: the harness turn, LOOP AUDIT and `data/loop/` |
| a structured, measured map shown with the state | partly: a view can recompute one from `history` each state (G1-B wrote one) |
| maintain the map across actions | no: views, predictors and guards are read-only functions; nothing of the agent's runs by itself and keeps or writes anything |
| validate a pinned experiment when it is played, and backfill its hypothesis | no: the same gap. Backfilling is a memory write, and no place lets the agent's code write automatically. Pins from `- test:` lines are reported as text, with no link to a hypothesis. |
| make the experiment come first | yes: a guard (unused in G1-B) |
| learn whether its change worked | no: the EXPECT channel failed on whitespace (G1-B 0 of 4) |

So two transitions are broken, and both are the meta layer's, not the game's:
- **(1) Hosting.** The harness hosts agent code only as read-only functions. Developers could add stateful,
  writing behaviour (pins, claim checks, ledgers) only in TypeScript, so that part of the developer loop cannot move into
  the run.
- **(2) Feedback.** The verdict on a change never reached the next harness turn.

### Claim and change (minimal)

- **Hook place** (`ARC_THIN_HOOKS=1`, native treatment only). A saved tool that defines `def after(state, t)` is a hook:
  - **When it runs.** The runtime runs it once for each action recorded since its last run, in order, before the next
    decision's head is built. A hook starts with the first action after it was saved.
  - **What `t` is.** The same transition a hypothesis `check(t)` gets (action, x, y, level_changed, state,
    levels_completed, n, before, after; changed_cells and bbox derived).
  - **What it may write.** Plain workspace files: `artifacts/<name>.json` reaches every component and Python cell as
    `artifacts[name]`. It may also update memory with `env.remember`: facts, hypotheses, tests with verdicts.
  - **What it may not do.** It never acts. A write to a component, or a restore, is refused and named, so a hook cannot
    rewrite the harness on every action.
  - **Where its output goes.** What it returns is shown at the tail of the head, with the views. A failed or overtime
    run (15 s) keeps nothing.
  - **Like the other auto-run places,** it is level-scoped, logged (`hook_runs.jsonl`, also under `data/loop/`), counted
    in the HARNESS index and LOOP AUDIT, named in the contract's places and on the system prompt's Tool line, and refused
    at save if it acts.
- **Feedback fix (both arms):**
  - An EXPECT check loses the indentation all its lines share.
  - A `.py` trailer may be written as `#` comment lines; the contract says so.
  - The contract's sentence that no component output is ever "authoritative" is gone. What code measures is state;
    `predict()` scores claims about what actions do.
- **Not built into the harness:** no level map, no experiment queue, no pin validation, no backfill policy. These are
  the agent's to write in the hook place. The runtime provides only the place.
- **Burden removed:**
  - The parent no longer re-derives its map and hand-records each experiment's result at every decision.
  - Developers no longer add such behaviour in TypeScript.
- **Loop-bound** (`docs/plans/2026-10-20-loop-bound-artifacts.md`):
  - **Pushed:** its output is shown in every decision while it is active.
  - **Feeds back:** the next real action runs it again.
  - **Reported:** its EXPECT verdict and its counts reach the next harness turn.
  - **Retires:** on deletion, on a move to `_off/`, on a new version, or at a level change until saved again.
- **Refuted if:**
  - in a real arm-B run with hooks on, harness turns still produce no component that runs by itself (view, predictor,
    guard or hook) in at least 1/3 of turns;
  - or the hooks the agent writes fail in at least half their runs;
  - or EXPECT checks still do not run.

### Verification (free)

| check | result | where |
| --- | --- | --- |
| Node tests: all 45 `tests/arc_thin_*.test.ts` files | The same 5 tests fail as at `73cddb12`: activation 1, components 1, receipts 3. `action_surface` timed out in the full run (Pi did not start within 20 s) and passed when run alone. Everything else passes, including the new tests: the hook keeps a file, backfills a hypothesis, has its prompt write refused, and its output is shown; hooks off; a hook that acts is refused; scoping covers hooks; the indented and commented trailers. | per-file output under `tmp/e1/` |
| pytest (the 10 ARC runner files) | 49 passed | — |
| Scripted smoke `meta`: real Pi 0.87.0, production bridge, mock SDK, WASI, scripted provider; all three flags on; stall reviews every 2 actions | Every meta check passed. At the first harness turn the scripted agent wrote: hypothesis `hyp.right`; an experiment queue `notes/experiments.json`; hook `tools/level_map.py`, which keeps `artifacts/level_map.json`, asserts it against each grid, and carries a commented EXPECT trailer; hook `tools/experiments.py`, which checks the pinned experiment and backfills `hyp.right` with `env.remember`; and guard `tools/pin_guard.py`, which plays the experiment first. Then: ACTION3 was refused (the experiment comes first); ACTION1 played (#3); the next head showed `experiments v1 after #3: {"checked":"ACTION1","verdict":"supports","next":null}` and `level_map v1 after #3: {"nine":[5,3],"visited":1}`; memory holds the backfilled test; the map ended at `{"nine":[6,3],"visited":[[5,3],[6,3]]}`, and the queue ended empty. At the second harness turn: the LOOP AUDIT lists each component's runs, writes and refusals, and the EXPECT result reads "check(t) returned true at #3". The run then fails only the shared `system_chars <= 3000` assert (4,611 characters with the guard and hook lines on). | `runs/e1-smoke-20261027/meta-1` |
| Scripted smoke `guard` (no hooks) | unchanged: every guard check passed, then the same shared assert | `runs/e1-smoke-20261027/guard-3` |

This is function and wiring with a scripted agent. Whether gpt-6.1-sol or qwen writes such components unasked is the
open question for the next pair.

### E1b runs (2026-10-27, frozen `3dce172a`, all three flags, query, consult and refine points off, cap 2.5M, 6 h)

- **G1-B′, gpt-6.1-sol medium from S-g:** launched at 10:53. Stopped at 11:10 by the user's switch to qwen ("go with
  provider az and using model qwen 3.8-27b with low reasoning effort").
  - Progress: 79 post-fork actions; levels 2, 3 and 4 at #39, #60 and #101; 207k budget tokens.
  - Harness turns: 4 (#22, #39, #60, #101). All four wrote prose (lessons v1–v3, strategy v3); no view, hook or guard.
  - The gateway cached 83% of the input this morning (889k cache reads against 179k uncached), against 15% and 8% for
    G1-A and G1-B on 10-26 evening. Budget tokens per action (2.6k against 18.3k and 17.2k) are therefore not comparable
    across these days; levels and actions are.
- **Q1-B′, qwen3.8-27b, thinking low in the qwen dialect:** launched at 11:12, from S-q (the protocol's qwen start: qwen's
  own level-1 prefix).
  - The gateway is az.gptplus5.com, the same endpoint and settings as the "az" provider of Codex's runs; this pilot
    labels it yibu.
  - In this dialect, "low" turns thinking on (`enable_thinking: true`). No effort level is sent: the models.json compat
    has no `supportsReasoningEffort`.

#### Q1-B′ results, compared (stopped at the 2.5M cap at 13:03)

| | G1-A | G1-B | G1-B′ (stopped at #101) | Q1-B′ |
| --- | --- | --- | --- | --- |
| model; commit; arm | gpt-6.1-sol; `5c86748d`; A | gpt-6.1-sol; `5c86748d`; B | gpt-6.1-sol; `3dce172a`; B + hooks | qwen3.8-27b low; `3dce172a`; B + hooks |
| start | S-g | S-g | S-g | S-q |
| levels after the fork (at action) | 4 (42, 62, 99, 133) | 3 (36, 53, 153) | 3 (39, 60, 101) | 0 |
| post-fork actions; budget tokens | 138; 2.52M | 147; 2.53M | 79; 0.21M | 168; 2.52M |
| cache share of input | 15% | 8% | 83% | 77% |
| harness turns, and those followed by an executable component in the turn or within 40 actions (P1) | 5 reviews; 0 | 6; 1 | 4; 0 | 4; 2 |
| components that run by themselves | none | `inventory` view: 19 runs | none | `color_report` view: 168 runs; `blocks6_view` view: 136 runs |
| hooks; guards | — | —; 0 | 0; 0 | 0; 0 |
| EXPECT checks that ran | — | 0 of 4 (indentation) | 3 of 3 that came due, each `check(t)` true | 2 came due: one returned None by design, one could not run (a claim written over several lines was read as code) |
| known-result replays in the 20 actions after each turn | 0, 0, 0, 0, 0 | 0, 0, 1, 0, 0, 0 | 0, 0, 1, 0 | 0, 11, 1, 2 |

- **Q1-B′ against the earlier qwen forks from S-q:** level 2 is still unsolved (now 0 of 6), here in 168 actions.
- **P1:**
  - Q1-B′ meets the protocol's "supports" threshold (2 of 4 turns, two components). Both components are views: a
    per-colour report, and a block map with distances, reachability and clicks left — the agent's own structured state,
    shown on every state from then on.
  - gpt-6.1-sol wrote no executable component in G1-B′ (0 of 4 turns), and 1 of 6 in G1-B.
  - There is no qwen arm A on this commit, so the comparison with A is historical only (E0, 0 of 58).
- **Hooks: 0 in 8 harness turns across both models.**
  - The place reached the model: the contract and the system prompt's hook line are in the logged provider inputs.
  - So the meta layer's maintained-map and backfill path was available, but no agent built it. Every component the
    agents built is read-only (views), and every other change was prose.
  - The user's target behaviour is reachable (scripted smoke) but not adopted (these runs).
- **P2 (binding):**
  - (a) holds: both qwen views ran on every state after they were saved.
  - (b) does not: 11 of the 20 actions after the turn that revised `blocks6_view` replayed known results.
  - P2 is not supported.
- **EXPECT:**
  - The E1b fix works for gpt: three checks ran and reported.
  - qwen's two checks show two remaining defects:
    - **Window claims.** qwen wrote loop claims ("no further calls to re-derive…") that a single transition cannot
      decide, and returned None on purpose.
    - **Multi-line claims.** A claim continued onto three more lines, and the parser read those lines as part of the
      check.
- **Errors:** Q1-B′ logged 23 `claims:run` sandbox crashes. These are the existing hypothesis checks, not E1b code; the
  run went on.
- **Budget:** stage 1 has now spent 7.78M of 9.0M (G1 pair 5.05M, G1-B′ 0.21M, Q1-B′ 2.52M).

**Next falsifiable check (not run):**
- **Close the EXPECT channel for loop claims.**
  - Accept a claim written over several lines.
  - Let a check read the window: either `check(t)` gets the window's moves, or a component may define
    `check_window(ts)`.
- **Test whether a hook is ever chosen when the audit names the cost it removes.** Today's LOOP AUDIT counts replays,
  but not hypotheses whose results were never recorded.
- Both need one more arm-B run to measure. Stage 1 has 1.22M left.

## Evidence

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Verified (function and wiring) | node tests, pytest | Both Verification tables; the failing tests also fail at `73cddb12` |
| Full-chain reachability | Verified with the scripted provider, and fork loading on the ARC environment | real Pi 0.87.0, production bridge, mock SDK, WASI; the real bridge and ARC environment for the fork loads | `runs/e1-smoke-20261026/guard-2`, `runs/e1-smoke-20261027/meta-1`; `D:/autoresearch_pi_project/runs/arc-e1-20261026/forkload-*` |
| Autonomous adoption | E1: weak (one pair). E1b: views adopted by qwen (2 of 4 turns); hooks not adopted (0 of 8 turns, both models) | az.gptplus5.com; gpt-6.1-sol medium (S-g), qwen3.8-27b low (S-q); su15 | G1-B: 1 view in 6 turns. G1-B′ (stopped): 0 in 4. Q1-B′: 2 views in 4. `D:/autoresearch_pi_project/runs/arc-e1-20261026/g1-a2`, `g1-b2`, `g1-bp`, `q1-bp` |
| Net benefit | Not shown | as above | G1 levels: A 4, B 3; Q1-B′ 0 levels (qwen from S-q: 0 of 6) |

## Decisions still open

1. **The EXPECT fixes** (multi-line claims, window checks) and the audit line that names hypotheses whose results were
   never recorded. Both are small and free to test; measuring them needs one more arm-B run (stage 1 has 1.22M left).
2. **Held-out game:** ls20, or ar25 (stage 2).
3. **Stage 2:** 10.0M after the gate.
