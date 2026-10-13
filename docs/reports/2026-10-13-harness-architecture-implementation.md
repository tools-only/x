# Change record: five-capability harness architecture on the native ARC runtime

Date: 2026-10-13. Status: implemented. Functional and scripted full-chain checks pass; real-provider behaviour is unverified.
Branch `claude/harness-activation-20261013`, on top of the [activation change](2026-10-13-harness-activation.md) (9c315713).
Design: [harness architecture](../plans/2026-10-13-harness-architecture.md). It aligns with the principles of Prime Agent and
Continual Harness (P1–P4, C1–C5, guardrails G1–G4, deviations D1–D6).

2026-10-13 integration: the Codex query-observation change adds default metadata/refs delivery, automatic full-frame/PNG
storage, explicit image reads and current animation frames in Python. The execution/session/refinement changes below are
retained. This changes model observation delivery, not the deferred host-served guest protocol. See
[query-observation record](../plans/2026-10-13-query-observation-context.md) and the
[merge record](2026-10-13-query-claude-merge.md). Scripted wiring does not establish autonomous adoption or net benefit.

## Problem and claim

- **Real failure.** Codex's activation run (ls20, yibu/qwen3.8-27b, 25 actions, analysed 2026-10-13):
  - 96% of actions came from saved tools, and tokens per action fell from 87.6k to about 31.5k;
  - reasoning per action was still 9.5k (10.6k before), and coordinate reasoning stayed at 35.3%;
  - defects from our own runtime, not from the model:
    - returned action lists were played blind (open loop);
    - unannotated `run(args)` saves failed schema derivation;
    - per-file fetch restarts cancelled calls;
    - removing a tool mid-decision stalled the decision;
    - one verbose decision exceeded the history budget, so the history dropped everything (`history_messages=0`);
    - no step tested a goal.
- **Claim (native mode).**
  1. Saved code can act in a closed loop through `env.act`, so a routine that needs feedback no longer needs one parent
     decision per action.
  2. One argument contract removes save failures caused by annotations.
  3. A summarised history keeps recent decisions within a fixed budget instead of dropping all of them.
  4. One refinement pipeline can edit any category, including prompts and memory. It is triggered by events, including a
     missing goal test, and the agent can start and shape it.
  5. The tool list stays fixed within a decision.
- **Burden removed.** Per-action parent decisions for feedback-driven routines; rewrites after failed saves; re-derivation after
  history loss; a separate role file and critic text to manage.
- **Non-goals.**
  - Unchanged: `arc_action`, the bridge, budgets and refusals. Reasoning stays on. Nothing is game-specific.
  - Not done, see the end of this record:
    - a registry shared with the general self-harness path;
    - host-served data instead of folder prefetch.

## Design as implemented

1. **Five categories** (`demo/arc_thin_binder.ts` `componentKind`):

   | Category | Place |
   |---|---|
   | Prompt | `prompts/` |
   | Memory | the memory store and `data/memory.md` |
   | Tool | `tools/` (`observers/` still loads) |
   | Skill | `skills/<name>/SKILL.md` |
   | Subagent | `agents/` (`roles/` still loads) |

   - `lib/` is a library, a tool dependency.
   - A view is a tool with `# view: on`; `observers/` files are views.
   - The capability index groups prompt, tool, skill and subagent lines under one HARNESS header, within 1,200 characters.
2. **One tool contract** (`demo/arc_thin_components.ts`).
   - Every tool's schema is `{args: object}`; the docstring or first comment is the description.
   - Accepted forms:
     - a script reading `args` and `env`;
     - `run(args)` or `run(args, env)`;
     - older `run(**kwargs)`, `run(state, args)` and `observe(state)`.
   - A call with top-level inputs is wrapped into `args`, for the parent and for subagents.
3. **Closed-loop `env.act`.**
   - `env` has `state`, `grid`, `history`, `frame(n)`, `act(action, x, y, predict)` and `restore(path, version)`.
   - Each new `act()` stops the guest with a request. The host takes the action through `actForCode`, which uses the same
     `submitAction` path as `arc_action`, and replays the code with the recorded observations.
     - It returns `grid`, `changed_cells`, `level_changed`, `state`, `missed` and `available_actions`.
     - The code decides whether to go on.
   - The runtime ends the call after:
     - a level change or a terminal state;
     - a refusal;
     - 24 actions.
     Code that swallows `ActStopped` cannot act again.
   - Only saved code acts: `python(save=)` or a saved tool. Unsaved and read-only (subagent) calls cannot.
   - Acting ends the decision, and the result lists one receipt per action.
   - Replay requires deterministic code: `random` is seeded, and a diverging replay is an error.
4. **Lifecycle.** Every write is versioned through the binder. `env.restore(path, version)` brings back any earlier version as
   the newest. Tools are only added mid-decision, never removed from the list the model was given.
5. **Context** (`demo/arc_thin_native_context.ts` `summarizeHistory`).
   - Each request carries one decision: the current prompt plus the working set:
     - memory index;
     - RECENT HISTORY;
     - recent actions not in it;
     - refinement notices;
     - RESOURCES, now including the size of the last request;
     - capabilities with view outputs;
     - state.
   - RECENT HISTORY covers earlier decisions within `ARC_THIN_NATIVE_HISTORY_CHARS` (default 12,000):
     - what the agent said and each call, with clipped arguments;
     - the newest two non-action results whole (up to 2,000 characters);
     - older results as one line, but action receipts are always kept;
     - decisions are added newest first; the newest is always shown, clipped if needed;
     - a note says where older records live.
   - Pi's compaction summary, when one exists, stays in front. `ARC_THIN_NATIVE_HISTORY_CHARS=0` replays the whole session.
6. **Refinement pipeline** (`demo/arc_thin_refiner.ts`; extension `refinerTriggers` / `runRefiner` / `startRefiner`).
   - It is runtime machinery; there is no role file.
   - Triggers:
     - the critic's failure triggers;
     - a level change;
     - repeated python work;
     - 12 actions on a level with no step predicting a level change;
     - at least 30% coordinate reasoning while no view tool exists;
     - every 15 actions;
     - the agent's `refine(focus)`.
   - An agent request made while a refinement runs is queued, not dropped. Notices that were not yet shown accumulate.
   - Each run makes one edit:
     - `FILE` for a prompt, tool, lib or skill, through the binder;
     - or `MEMORY <key> <confidence>`, through the native memory planner.
   - Edits are logged in `refiner.jsonl` with trigger, category and outcome.
   - The agent shapes the pipeline with `prompts/refine.md`, active or not. `prompts/strategy.md`, Continual Harness's p, is
     an active prompt capped at 1,500 characters.
7. **Decision budget.**
   - One cap of 16 tool calls. Call 16 says so.
   - Up to four further calls are refused without ending the decision, so it can still act; the next ends it.
   - The tool list does not change. The split look/record budget is gone.
8. **Prompt** (`demo/prompts/arc_thin_native_system.md`, 2.7k characters with its slots).
   - Covers the five categories, `env.act`, `python(save=)`, views, `env.restore`, `prompts/strategy.md`, subagents and
     refinement. The refinement paragraph appears only when refinements are on.
   - Keeps the reuse and amortisation principles that the tests require.
9. **Measurement** (`src/autoresearch_pi/arc_thin_reuse_report.py`, format v2):
   - `categories`: created, versions, failed saves, active at end and used, per category. Use is the category's own kind of
     use: an active prompt, a tool call or view run, a SKILL.md read, a consult, a memory write.
   - `offload.actions_by_component`;
   - refinement edits by category.

Removed:
- observer, note and role as types;
- `roles/refiner.md`;
- `notes/strategy.md`;
- returned action lists (`playActions`);
- type-hint schemas;
- history bands (`ARC_THIN_NATIVE_VERBATIM` / `CONDENSED`);
- the split budget (`ARC_THIN_NATIVE_SPLIT_BUDGET`);
- tool removal mid-decision.

`run-config.json` records `native_history: {summary_chars, decision_tool_calls}`.

## Verification

- **Node tests:** 126 pass in the full run before the last two edits, which were the refinement queue and the notice
  accumulation. The rerun of the full suite under parallel smoke load failed one legacy-path timing test
  (`arc_thin_self_harness.test.ts`, model checks), which the isolated rerun below covers. Updated or new:
  - `arc_thin_components.test.ts`:
    - the args contract and tool forms;
    - views;
    - the `env.act` replay protocol: request, ordered observations, the code stopping itself, a runtime stop, swallowed
      stops, integer grids, a diverging replay;
    - `env.restore`.
  - `arc_thin_activation.test.ts`:
    - closed-loop acting through `python(save=)` and a saved tool;
    - unsaved and read-only calls refused;
    - level-change and action-limit stops;
    - restore through the runtime;
    - tools only added mid-decision;
    - FILE, MEMORY and NONE replies.
  - `arc_thin_native_context.test.ts`: the summary format, budget, kept receipts, oversize decision, empty history.
  - `arc_thin_binder.test.ts`: a failed save with an earlier good version is labelled stale, not failed.
- **Pytest thin subset:** 8 passed.
- **Foundation smokes** (real runner, Pi 0.87.0, mock SDK, scripted provider): see the verification table below for the final
  list. The `activation` smoke asserts:
  - the probe tool acts twice through `env.act`, twice again when called;
  - unsaved code is refused;
  - code that sees its prediction miss stops after one action (`played_actions.jsonl` records `missed`);
  - one user message per request and no runtime analyses in context;
  - an `agents/` directory and no `roles/`.

  With refinements on, it also asserts:
  - a prompt edit and a tool edit, both loaded;
  - triggers from retyped saved code and repeated python;
  - the agent's `refine(focus)` started, after a queue if needed;
  - the strategy applied in the system prompt;
  - `prompts/refine.md` reaching the pipeline but not the agent (inactive);
  - report categories and actions by component.
- **Smoke-only change:** the automatic-compaction probe now counts checkpoint requests, not checkpoint messages, because a
  request no longer carries earlier prompts.

| Evidence layer | Status | Provider / environment | Limits |
| --- | --- | --- | --- |
| Functional | passed | node tests, pytest | listed above |
| Full chain | passed (scripted) | offline-arc-thin-smoke, Pi 0.87.0, mock ARC SDK | wiring only; the scripted model never reasons |
| Autonomous adoption | unverified | — | real run needed |
| Net benefit | unverified | — | real run needed |

## Real run r2 and the follow-up fix

The user ran this version on ls20 (`runs/arc-activation-all-uncapped-20261013/arc-run-r2` in the main tree, yibu/qwen3.8-27b,
uncapped). It was stopped after 3 actions, 27 minutes and about 237k tokens. At 2 actions it had used 166,844 tokens.

**Where the tokens went**

| | Tokens | Share | Notes |
|---|---|---|---|
| Agent input | 169k | 71% | 19 requests, 5–13k each; about 6 requests per action |
| Agent output | 62k | 26% | 56k of it reasoning |
| Refinement | 5.9k | 2% | — |

**Where the time went:** almost all of it was model generation, at about 37 output tokens per second. Python runs took about
30 seconds in total.

**What the agent did:** every action repeated the same cycle:
1. a hand-typed grid diff;
2. a `read` of the overflowing result;
3. memory prose;
4. `arc_action`.

It saved one acting tool, never called it, and played single `arc_action`s.

**Comparison with the first 3 decisions of the previous version** (`real-ls20` in Codex's evaluation directory):

| | Previous version | r2 |
|---|---|---|
| Tokens per decision | ~72k | ~79k |
| Actions per decision | 5.3, from returned lists played blind | 1 |

So the cost per decision was unchanged, and this version removed the one mechanism that made actions cheap. The closed-loop
replacement was not adopted.

**A defect:** the refinement at action 3 overwrote the agent's acting tool `tools/probe.py` with an unrelated view.

**Fix (the user chose only this one):**
- A refinement may create files, or rewrite `prompts/strategy.md` and files a refinement wrote. A write to any other existing
  file is refused and logged as `refused`. Its input marks each tool as AGENT'S or REFINED.
- Separately, from the earlier smoke failures: the runtime runs at most 4 python executions at once, and a call's 20-second
  allowance starts only once it runs. Before this, 16 parallel calls in one message were cancelled while they waited for CPU.

**Not done (the user declined it):** bringing back returned action lists played open-loop.

**Still not addressed:** reasoning per decision (20–28k tokens, about 10 minutes at this provider speed), which is the cost
floor in both versions, and the per-action cycle of diff, read and memory.

## Making the cheap path the default

After Codex's root-cause analysis (`runs/arc-activation-all-uncapped-20261013/diagnostics/efficiency-20261013/analysis.md` in
the main tree: 8 actions, 419,539 tokens, 92% of output reasoning, a 13.6-minute request that named ACTION2 67 times without
acting), the user asked to implement the mechanism-level differences from Prime Agent and Continual Harness. In both, the
efficient path is the default; here it needed a deliberate choice that itself costs reasoning.

**Claim.** Each change below removes one source of uncertainty or repeated derivation from the parent's reasoning, without
lowering the reasoning setting (the user's standing preference). Unverified until a real run.

| Change | Reference | Where |
|---|---|---|
| The current decision keeps its reasoning between tool rounds; earlier decisions still carry none. `ARC_THIN_DECISION_REASONING=0` turns it off. | CH keeps "the local reasoning chain" until the next state change; Qwen's chat template renders reasoning only after the last user message | context hook; `reasoning_chars` in `context_budget.jsonl` |
| What a python call defines stays defined in later python calls: imports, functions and classes are re-run from source; JSON values are restored (16k per value, 48k for definitions and 96k for values in total, oldest dropped first). The receipt names what was kept. Subagents read the session but do not change it. `ARC_THIN_PYTHON_SESSION=0` turns it off. | Prime's persistent kernel, adapted: each call still runs in a fresh sandbox | `arc_thin_components.ts` `_session_load` / `_session_delta`; `NativeRuntime.keepSession` |
| Native receipts give the bridge's changed-cell count and box (`changed=52 in x13-38 y40-62`). Coordinates on actions other than ACTION6 are dropped and the receipt says they were ignored. | CH returns the observation with every action | `actionLine`, `submitAction`, `reportedAction` |
| `arc_action` takes `then`: up to 11 further actions in the same call. They are played in order, and the sequence stops at a missed prediction, a level change, the game's end or a refusal. Logged in `action_sequences.jsonl`. | CH's `take_actions` | `registerArcAction`, `sequenceStop`, `repairActionArguments` |
| Bookkeeping moves to refinements: the prompt asks the agent to run the next experiment once it is known and to write memory only for what would otherwise be lost. Refinements consolidate memory with `MEMORY <key> <conf> replaces <keys>`. | CH's Refiner consolidates; the orchestrator acts on p | prompt; `REFINER_SYSTEM`, `parseRefinerReply` |
| A view that becomes active runs on the current state at the next request. A view that calls `env.act` is refused at save. | Codex's findings 4 and the r2 follow-up | context hook; `_inspect` |

**Verification (functional and scripted full chain only).**
- Node: 129/129 in one full run with no other load. The installed-Pi scope probe in `arc_thin_action_surface.test.ts` timed out once under parallel load and passed when run alone.
- Pytest thin subset: 8 passed.
- Foundation smokes on the scripted provider, Pi 0.87.0 and the mock ARC SDK:
  - `activation` and `activation:defaults` (refinements on) assert:
    - kept reasoning appears in the next request of the same decision only;
    - a function and a value defined in decision 3 give 42 in decision 5;
    - `ignored_xy` and the "x,y ignored" receipt;
    - `changed=` in receipts;
    - one `arc_action` with `then` playing 3 actions in one decision.
  - Also passing: `components` (views now also run on the state they became active at: #1 and #4), `reuse:defaults`, `budget`, `history`, `foundation:defaults` / `disabled` / `tight`, `receipts`, `receipts:automatic`, `migration`, `nativeclaims`.
  - Legacy `smoke:default` and `smoke:ledger` pass.
- Legacy behaviour is unchanged. Receipts, coordinates and `then` are native-only; legacy skill state keeps its old fields.

**Costs to watch.**
- Kept reasoning raises input within a decision, by up to the reasoning of each earlier round.
- The python session adds the kept definitions and values to every python call's input.
- A `then` sequence spends actions without a new decision; it stops at the first missed prediction.

**Next check.** One bounded real ls20 run on the same model and setting, with a budget approved by the user. Compare with r2
and Codex's run on:
- time from naming an experiment to running it;
- reasoning per request and per decision;
- requests and actions per decision;
- re-derived facts;
- levels.

## Risks, deviations and the next falsifiable check

- **Replay cost.** An acting call is re-executed once per action, so cost grows quadratically with its action count. Each attempt
  has 20 seconds; the call has at most 24 actions. Check the `acts` and `attempts` columns of `wasi_runs.jsonl`.
- **Parallel python under load.** Under parallel test load, 16 python calls in one message each hit the 20-second limit and
  were cancelled. This happened once in a smoke run beside the node suite; it did not happen when the smoke ran alone. A real
  run with many parallel calls could see the same.
- **Sandbox protocol changed without Codex's agreement.** The design (§7 step 3) asked for this agreement first. Codex should
  review `need_act`, `acts`/`allow_act` and the `restore` op before merging.
- **Not done:**
  - the registry shared with `pi_task_local_self_harness.ts` (§7 step 2);
  - host-served `env` data. Files are still shipped on request, now with their folder prefetched up to 120 KB.
- **Continuity (backlog D).** Earlier decisions are now a summary. What the agent did not save, and what fell outside 12,000
  characters, is only in files. Check for re-derived facts after decisions leave the summary.
- **Next check:** one real ls20 run, with the budget approved by the user, compared with both earlier ls20 runs on:
  - the per-category funnel and actions from tools;
  - reasoning per decision and per action, and coordinate share;
  - goal-test predictions per level;
  - parent and child tokens;
  - levels and actions per hour;
  - refinement edits loaded and later used.
