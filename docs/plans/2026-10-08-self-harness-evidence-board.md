# Meta-harness change record: Self-Harness evidence board and maintainer layer (Auto-Research repositioned)

Date: 2026-10-08 (Asia/Shanghai). Status: P0–P2 implemented on the thin ARC path on 2026-10-09, opt-in and off by default. Functional and wiring checks pass; autonomous use and net benefit are unverified. See §15 for what changed from this design and the evidence. Sections 1–14 are the design as written on 2026-10-08.
This record follows the [development workflow](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). The code observations in §4 come from reading the legacy-path source on 2026-10-08.

## 1. Problem and claim

### Real failures and opportunities

- **Auto-Research is off by default in ARC.** The last real run with research on (B30: official ft09, qwen3.8-27b via yibu) spent 605,955 of its 787,385 reported tokens in the child, delivered nothing, and stopped at 10 actions and 0 levels ([switch record](2026-10-08-auto-research-switch.md)).
- **Autonomous component adoption has been near zero for about a month.** The most recent failures happen when the parent writes components (B33–B36: rejected or invalid source, 8 repeated same-name creates in B34), not at assembly ([deferred backlog](../deferred-research-todos.md)).
- **The lifecycle step "feedback → retain/revise/retire" has never happened in a real run.** Nothing produces predictive evidence for a component version.
- **Mechanical checks against the trajectory have worked; LLM tracking has not.**
  - stage64: an offline 5×5 footprint calculation matched 14 real moves, 7 of them blocked. ACTION3 could already be shown to be blocked, yet the parent tried it three more times.
  - stage80: a parent-written Tool, replayed on a separate public trajectory, matched all 11 frames.
- **The current worker runtime has defects specific to online play.**
  - GAME_OVER permanently stops every worker ([pi_auto_research_worker_runtime.ts:30](../../demo/pi_auto_research_worker_runtime.ts)), even though the runner then RESETs.
  - Evidence is fed to workers oldest-first.
  - Updates say nothing about how stale they are.
  - Updates that were revised or withdrawn are still delivered.
  - The action allowance for a research experiment is kept only in process memory.

### Diagnosis (interpretation, not measured)

Classic autoresearch relies on experiments that are cheap, repeatable and isolated. ARC-AGI-3 gives one irreversible history, and the only experiments available are the actor's own actions. Read-only research by the same model looking at the same pixels therefore adds little beyond extra reasoning, and asynchronous workers report after the actions they could have informed.

The experiment step can come back in three forms:

1. **History as a dataset.** Every past transition (state, action) → next state is a free test of any executable hypothesis.
2. **Executable models as a sandbox.** Planning and "what if" questions run inside a model.
3. **Future actions as tests declared in advance.** Each action is checked against every live prediction. Where surviving models disagree, that action is informative.

### Narrow claim

Suppose at least one executable predictor is registered. The runtime replays it against history, scores it at every action, and reports falsifications and disagreements through a single digest. Then:

- the actor repeats fewer transitions already shown to fail;
- the actor needs fewer actions to reach the first level;
- total parent-plus-child reported tokens stay at or below the ordinary research-off baseline under the same budget;
- Self-Harness never ends up unable to create, select or call a component.

### Burden removed

- The actor no longer tracks long-range evidence in its own context.
- The actor no longer manages workers. Today `assign` needs 6 fields plus an existing research line.
- The actor no longer has to write the first component itself; analysts register candidates.
- Model compute grows with surprises (falsifications, level changes), not with the number of actions.

### Overturn conditions

- Fewer than 50% of registered predictors reach `supported` in replay.
- The actor doesn't use digest entries.
- No improvement on the primary metrics, or total tokens above the baseline.
- Any run in which a board effect blocks create, select or a tool call. This counts as a design failure, not as a model result.

### Non-goals

- Real-time environments.
- Scoring strategies off-policy.
- Game-specific rules or routes in prompts.
- Any new environment action capability for a child.
- Fixing the existing blockers in §4.2. Those are tracked separately; this design must only avoid making them worse.

## 2. Architecture

| Layer | Contents | Who drives it | Calls a model? |
|---|---|---|---|
| Components | Memory, Skill, Tool, Subagent, system_prompt, unchanged. A Tool may also declare a prediction contract. | Written, versioned, assembled | — |
| Infrastructure | Transition log, replay, scoring, board ledger, digest injection, trigger executor | Runtime only, mechanical | No |
| Maintainers | Analyst roles that create, repair and generalize board candidates. They are ordinary Subagent components. | Run only under a standing authorization (§3.6) | Yes |

Principles:

- **Keep the generator, not its output.** Predictors, lenses, planners and methods become components. Plans, disagreement flags and "informative action" lists are short-lived outputs, tied to the model version and state that produced them.
- **One source of truth.** A "research line" becomes a predictor's version history plus its board ledger. No worker keeps private state that acts as a second harness.
- **Score models, not strategies.** A strategy is a model plus a planner. Only the model's predictions are tested.
- **The board is advisory and fails open.** It changes only what the digest shows. It never changes eligibility, assembly, or whether a tool can be called (§6).

## 3. Core objects

### 3.1 Transition log (not tied to ARC)

Each record: `{t, level_index, epoch, state_ref, state_hash, action, next_state_ref, next_state_hash, outcome, flags}`.

- `level_index` is the native `levels_completed` before the action. `epoch` increments on RESET.
- `flags` mark `reset`, `level_changed` and `game_over`.
- For ARC the log is built from the bridge's canonical events and its existing transitions projection ([arc_agi_3_bridge.py:185](../../src/autoresearch_pi/arc_agi_3_bridge.py)). `state_ref` always points at the final frame, so animation frames are never scored.
- The scorer reads only these records. This moves deferred item A forward: the adapter emits canonical transitions, and the agent side interprets them.

### 3.2 Prediction contract (optional, validated separately)

A pure Tool may declare:

```
predicts: {
  lens_ref:  tool:<lens>@vN    # L(state) -> feature (JSON)
  predictor: this tool         # P(state, actions[]) -> {action_key: feature | null}; null = abstain
  scope:     task | level      # level = keyed by level_index (§3.3), never by RESET instance
  covers:    []                # optional: "reset", "level_changed" to opt into those transitions
}
```

- A prediction is correct when `P(s, a)` equals `L(s')` exactly, compared as canonical JSON. The comparison is mechanical and never judges meaning.
- `P` takes a list of actions so that one call covers every available action (§6.3). For ACTION6, the predictor itself declares the coordinates it covers.
- If the `predicts` block is invalid, the Tool is still created as normal and the contract gets its own rejection receipt. The contract stays out of the default tool-creator template.
- Inputs reuse the existing pure-Tool runtime: the `current_grid` binding, exact historical bindings, and `output_schema` validation ([pi_task_local_tools.ts](../../demo/pi_task_local_tools.ts)).

### 3.3 Board ledger (separate from component records)

The ledger is a new file, `harness-board.jsonl`. It is append-only and keyed by exact version. It holds:

- counters `{applicable, correct, wrong, abstain, error}`, separately for replay and for live scoring;
- the first counterexample (transition ref, predicted value, observed value);
- the replay cursor.

| Board status | Condition |
|---|---|
| `replaying` | Background replay is not finished (shown as k/n) |
| `untested` | No applicable transition yet |
| `supported` | At least m applicable, 0 wrong (m = 3 initially, configurable) |
| `falsified` | At least one wrong, with an exact counterexample |
| `erroring` | Repeated infrastructure errors (timeout, runtime error). These never count as `wrong` |
| `inactive_level` | A `level`-scoped predictor whose `level_index` differs from the current one. It becomes active again if play returns to that level index |

- The ledger never writes component `status`, `availability`, evidence status, method maturity or effect assessments.
- By default, transitions flagged `reset` or `level_changed` are not scored unless the predictor lists them in `covers`.
- Treating ARC games as deterministic on final frames is an assumption. If a real game is nondeterministic, the ledger records it and the m or tolerance rule is changed openly, never quietly loosened.

### 3.4 Service outputs and staleness

Outputs such as planned paths or disagreement sets record `{producer_ref, predictor_refs, state_hash, predicted_steps}`. An output is marked stale when:

- a predictor it used becomes `falsified`; or
- the observed state no longer matches the predicted step.

The digest marks stale outputs. Nothing is deleted, and none of this touches components.

### 3.5 Digest (the only new resident content)

- **How it is delivered:** as a context-hook message, the same pattern as the existing completion inbox ([pi_task_local_subagents.ts:3203–3227](../../demo/pi_task_local_subagents.ts)). It is not an assembly revision.
- **Size:** at most about 1,500 characters, and it appears only when it has content.
- **What it contains:**
  - board predictors with status and counters, including `replaying` and `untested` ones, so a new level's predictors are visible straight away;
  - new falsifications since the last delivery: predicted value, observed value, transition ref and raw before/after frame refs, each delivered once;
  - disagreements: for the current state, the predicted outcome of each available action under every live predictor, and the actions where predictions differ, with their action cost;
  - stale service outputs, and notes on components that cite a falsified predictor in `basis_refs`;
  - `pending`, when the board's time slice for this turn ran out.
- **What it never does:** recommend an action, or point the actor at a component that hasn't been installed.

### 3.6 Standing triggers for maintainers

- **Authorization record:** `{event, analyst_ref, max_output_tokens, max_wall_ms, max_runs_per_level, cooldown_actions, expires}`.
- **Events:** `falsified`, `all_predictors_dead`, `level_changed`, `game_over`, `actor_query`.
- **Who grants it:** the actor, with one call, or the user, in run configuration.
- **What the runtime does:** it checks the event, the limits and the budget preflight (§6.4). It then runs the analyst before the actor's next turn, with hard limits. ARC only advances when the actor acts, so a short synchronous run costs wall-clock time, not game state.
- **Analyst inputs:**
  - the counterexample;
  - relevant lens outputs;
  - the current state;
  - its own earlier `board.*` versions;
  - paging of exact transitions on demand. Analysts do not get raw history dumps.
- **Analyst outputs:** a new or repaired `board.*` candidate, a Skill candidate at a level change, or "no supportable repair". All three are valid outcomes.
- **Failure:** any failure, timeout or skip is recorded, and the actor proceeds unchanged.
- GAME_OVER triggers analysis. It never stops board maintenance.

## 4. Fit with the existing Self-Harness (code review, 2026-10-08)

### 4.1 Existing mechanisms the board must not use

| # | Existing behavior | Location | Risk if the board used it |
|---|---|---|---|
| 1 | Any eligibility reason makes a component ineligible | [pi_task_local_self_harness.ts:1335–1349](../../demo/pi_task_local_self_harness.ts), [pi_task_knowledge_lifecycle.ts:101–116](../../demo/pi_task_knowledge_lifecycle.ts) | The next assembly silently drops ineligible selections ([pi_task_harness_assembly.ts:344–349](../../demo/pi_task_harness_assembly.ts)), and selecting one explicitly throws ([:383](../../demo/pi_task_harness_assembly.ts)). A falsified predictor would become impossible to inspect or call. |
| 2 | A contradicted method or an "unsupported" use assessment rejects the call | [pi_task_local_tools.ts:443](../../demo/pi_task_local_tools.ts), [pi_research_method_runtime.ts:594](../../demo/pi_research_method_runtime.ts) | Tool use would be hard-blocked |
| 3 | Replacing a version makes everything that depends on the old version ineligible | [pi_task_knowledge_lifecycle.ts:111–116](../../demo/pi_task_knowledge_lifecycle.ts) | Each analyst repair would cascade through dependent knowledge |
| 4 | `depends_on_refs` may only point at memory, skill or system_prompt | [pi_task_knowledge_lifecycle.ts:142](../../demo/pi_task_knowledge_lifecycle.ts) | Making knowledge depend on a predictor Tool needs an extension that brings #3 with it |
| 5 | A tool call needs the exact selected version to also be the latest; the pool keeps only the latest version per name | [pi_task_local_tools.ts:445–459](../../demo/pi_task_local_tools.ts), [pi_task_local_self_harness.ts:1329](../../demo/pi_task_local_self_harness.ts) | An analyst updating a tool the actor selected breaks it until the actor reassembles |
| 6 | Creating an existing name throws; updates need a CAS `target_version` | [pi_task_local_tools.ts:664–667](../../demo/pi_task_local_tools.ts) | Two authors in one name space collide |
| 7 | Assembly changes require a matching `expected_assembly_revision` (CAS) | [pi_task_harness_assembly.ts:370–375](../../demo/pi_task_harness_assembly.ts) | Assembly revisions made by the runtime would make the actor's next assemble fail |
| 8 | Unassembled tools can't be called | [pi_task_local_tools.ts:455–459](../../demo/pi_task_local_tools.ts) | Digest entry points to `board.*` tools would fail |
| 9 | Each Python call starts a host process plus WASI Python; default timeout 20 s; input limit 128 KB by default, 512 KB hard | [pi_task_python.ts:10–19, 99](../../demo/pi_task_python.ts) | Naive replay and disagreement checks would stall turns; replaying the whole history in one call exceeds the input limit |
| 10 | Parent and children share one reported-token budget with a cautious per-request reservation | [pi_provider_request_admission.ts:87–97](../../demo/pi_provider_request_admission.ts) | Analyst runs could starve the actor's next request |
| 11 | Each RESET starts a new episode and a new level instance | [pi_memory_validity.ts:14–16](../../demo/pi_memory_validity.ts) | Anything level- or episode-scoped expires when the same level is retried |
| 12 | Child output-length loops have occurred (B10: 6 in a row) | Run evidence | A synchronous analyst could hold up the actor |

### 4.2 Existing possible blockers, independent of this design

- **#3:** dependents become ineligible whenever a dependency gets a new version.
- **#11:** level-scoped Memory, which always carries a validity scope, expires on GAME_OVER→RESET even when the agent is retrying the same level.

These may be contributing to today's low adoption. They should be diagnosed separately, using real run artifacts, before anyone changes their semantics. They are not in this design's scope.

## 5. Authority changes (need user confirmation)

| ID | Change | Current rule | Recommendation |
|---|---|---|---|
| A1 | Analysts register unexposed candidates, only under `board.*` names | Research writes only isolated artifacts; the parent writes components through creator → create → assemble | Adopt. This removes the writing step that failed in B33–B36. Because analysts use their own name space, the actor's components can't collide with or break theirs. |
| A2 | The runtime injects one digest message per request through the context hook | The actor assembles each component explicitly | Adopt. It is one bounded block of mechanical facts, not an assembly revision. |
| A3 | The runtime runs analyst Subagents under a standing authorization | Self-Harness never calls models ([single-life design](2026-09-20-agent-native-single-life-harness.md), rules 5–6) | Adopt. Granting the authorization stays a judgment call; running it is mechanical. |

These remain unchanged:

- The actor is the only environment caller, and analysts only read the environment.
- No action leases.
- Version, permission, budget and environment checks remain hard blocks.
- Selecting or calling any component other than the digest still requires the actor's existing assembly.

## 6. Non-blocking guarantees

### 6.1 Invariants

1. The board never changes component status, availability, evidence status, method maturity, effect assessments, dependencies or assembly.
2. A falsified, erroring or inactive predictor can always be inspected, selected and called through the normal paths.
3. Analysts never update a component outside `board.*`. Actor components are never written by the board.
4. The board never delays the actor's provider request beyond its time slice. Nothing waits for an acknowledgement.
5. Infrastructure errors never count as falsification.
6. Any trigger failure, timeout or budget skip leaves the actor's turn unchanged.

### 6.2 Corrections to the first draft

| First draft | Corrected design | Reason |
|---|---|---|
| Derived Memory/prompt content declares `depends_on_refs` on the predictor and is suppressed on falsification | No new dependency edges; components may cite predictors in `basis_refs`, and the digest notes when the cited predictor is falsified | §4.1 #1, #3, #4 |
| The digest offers one-call entry points | The board runs board predictors itself and puts the results in the digest; calling a planner directly still uses the existing install path | §4.1 #8 |
| Analysts may update candidates in the shared pool | Analysts write only `board.*` names | §4.1 #5, #6 |
| Level scope via existing validity | Board scope keyed by `level_index` | §4.1 #11 |
| Replay and scoring with no compute model | Incremental, batched, time-sliced (§6.3) | §4.1 #9 |
| Synchronous analysts with only a token cap | Budget preflight plus time, length, per-level and cooldown limits (§6.4) | §4.1 #10, #12 |

### 6.3 Compute model

- **Live scoring:** after each action, score only the newest transition, one batched call per predictor.
- **Lens results:** cached by `state_hash`.
- **Replay:** runs in background chunks that fit the input limit. The status shows `replaying k/n`, and the cursor survives restarts.
- **Disagreement:** one call per predictor with the current state and all available actions.
- **Per-turn time slice:** for example 5 s total for board work before a provider request. Work that doesn't fit is reported as `pending` and finished later.
- **Prerequisite:** the go/no-go latency measurement in §10.

### 6.4 Trigger preflight and limits

An analyst runs only if all of these hold:

- the remaining reported budget after its cap still covers at least 3 actor requests at the latest actor reservation size;
- `max_runs_per_level` is not exhausted and the cooldown has passed;
- no other trigger has run at this action boundary.

While it runs:

- it stops at `max_wall_ms` (initially 120 s), with at most one length continuation;
- the same predictor lineage can be repaired at most K times per level, to prevent falsify→repair→falsify loops.

Skips and failures are recorded with their reasons.

## 7. Lifecycle and who moves each step

| Step | Mover | Completion evidence | Failure or stop |
|---|---|---|---|
| Opportunity (surprise, repeated failure, level change) | Runtime for mechanical events; actor or analyst for semantic ones | Transition ref | With no predictors and no registrations, recorded as reasonable non-use |
| Candidate registration | Analyst (A1, `board.*`) or actor | Version ref; contract receipt | The tool is still created; the contract is rejected separately |
| Replay | Runtime | Ledger counters, status | `erroring` or `pending`; never `supported` by default |
| Exposure | Digest (A2); fuller exposure by the actor's assembly | Final provider payload contains the digest entry | `pending` when over the time slice |
| Semantic use | Actor | Later action or tool call citing it | Ignoring it is allowed and counted |
| Feedback | Runtime live scoring | Ledger update, falsification | — |
| Revise | Analyst under a trigger (A3) | `board.*` v+1, replayed | Skip or failure recorded |
| Retire | Actor or analyst through existing retire | Status change by an agent, not by the board | History is never undone |

Actor decisions needed before the first benefit:

- **zero**, if run configuration authorizes an analyst;
- **one**, if the actor writes a predictor itself.

## 8. Cost and what changes

- **Resident:** the digest only. The `predicts` field is optional on Tool create. No new actor tool, no assembly change, no new gate.
- **Compute:** as in §6.3. LLM calls happen only on triggers.
- **Reused:**
  - pure-Tool execution (CPython/WASI);
  - the context-hook injection pattern;
  - the subagent broker and length continuation;
  - provider telemetry and budget reservation;
  - the bridge's canonical events.
- **New:**
  - one runtime module: transition log adapter, replay/scoring, ledger, digest, trigger executor;
  - the optional contract field;
  - `harness-board.jsonl`.
- **Shrink, but only after evaluation:**
  - worker queues and consumption cursors ([pi_auto_research_workers.ts](../../demo/pi_auto_research_workers.ts), [pi_auto_research_worker_runtime.ts](../../demo/pi_auto_research_worker_runtime.ts));
  - periodic research windows and handoffs;
  - research lines tied to sessions;
  - most of [auto_research_operations.md](../../demo/prompts/auto_research_operations.md).

  Until then the old path stays behind `--auto-research` and is never combined with the board in an experiment. If the old path is re-enabled, its GAME_OVER stop bug is fixed first.

## 9. Risks

| Risk | What you'd see | Response |
|---|---|---|
| qwen-27B writes poor predictors | Low replay survival | Measured separately from the mechanism; single-feature predictors first |
| The lens hides the relevant feature | A falsification that looks inexplicable | The digest always attaches raw before/after frame refs |
| Only 0–1 predictors exist | No disagreement entries | Still useful as Tool plus replay; don't claim competing hypotheses are working |
| Exact matching is too strict | Spurious falsifications | Final frames only; revise the rule openly |
| The digest is ignored | Low use rate | Record it as an adoption result; change one factor at a time, add no gate |
| Analyst cost or stalls | Child tokens dominate; long pre-turn waits | §6.4 limits; skips recorded |
| Python latency too high | Constant `pending` | The §10 go/no-go; a long-lived sandbox process becomes a prerequisite |

## 10. Go/no-go checks before P0

1. **Measure Python call latency on the target machine** (Windows, host process plus wasmtime): cold and warm, with a 64×64 grid input. If the median call takes more than about 1 s, a long-lived sandbox process becomes a prerequisite for P0.
2. **Confirm A1–A3.**
3. **Agree whether the existing blockers in §4.2 get diagnosed first or in parallel.**

## 11. Staged implementation

Each stage reports its own evidence level.

1. **P0, mechanics only.**
   - Build: transition log, optional contract, batched replay and live scoring, ledger.
   - Diagnostic checks on public trajectories:
     - the stage80 Tool scores 11/11;
     - a stage64-style predictor reproduces the 14 matches, including the 7 blocked moves;
     - a deliberately wrong variant is falsified with its exact counterexample;
     - a predictor that times out shows `erroring`, not `falsified`.
2. **P1, exposure.**
   - Build: digest injection, staleness, `basis_refs` notes.
   - Add these scenarios to the end-to-end smoke test `arc-harness-smoke` (real bridge, Pi, broker; scripted provider):
     - registration → replay → digest appears in a real parent turn;
     - a falsifying action → the digest updates, and the falsified tool is still selectable and callable;
     - the digest causes no assembly CAS conflict;
     - a stale-plan flag;
     - a board time-slice overrun → `pending`, with the actor's request not delayed.
   - The full existing matrix must still pass: all five component types, plus output-length continuation for both Auto-Research and ordinary delegation.
3. **P2, maintainers.**
   - Build: trigger table and an analyst Subagent.
   - Scenarios:
     - falsification → analyst → `board.*` v+1 → replay → digest;
     - an analyst repair doesn't break the actor's selected tool;
     - a skip on low budget;
     - the time/length caps on an analyst stuck in length loops;
     - the per-level limit and cooldown;
     - GAME_OVER→RESET on the same level keeps level-scoped predictors applicable;
     - an invalid `predicts` block doesn't prevent the tool from being created.
4. **P3, real-provider evaluation (§12).** Needs a separate budget authorization.

## 12. Pre-registered experiment protocol (P3)

- **Target evidence levels:** autonomous use, then net benefit.
- **Comparator:**
  - the current ordinary configuration (research off, single action) at the same commit, without the board;
  - one ablation: the digest without disagreement entries.
- **Model and task:**
  - qwen3.8-27b via yibu, reasoning as currently configured;
  - official ARC SDK, games ft09 and ls20;
  - each run: 50 actions or 1800 s;
  - the user sets the reported-token cap and the cumulative budget before launch; any new unknown usage stops the run.
- **Samples:**
  - one exploratory pair per game, to confirm the observation conditions actually occur;
  - then at least 3 independent confirmatory pairs per game, alternating the order;
  - exploratory and confirmatory results are reported separately.
- **Primary metrics:**
  - actions to the first level, and levels completed;
  - repeated failed transitions: actions repeating a (state feature, action) pair that already failed in the same epoch, computed identically for both arms from logs.
- **Secondary metrics:**
  - total parent+child reported tokens and wall-clock time;
  - board time per turn and `pending` rate;
  - predictor registrations and replay survival;
  - digest exposures;
  - analyst triggers, skips and outcomes.
- **Integrity metric:** the number of create, select or call failures attributable to the board must be 0.
- **Acceptance:**
  - confirmatory medians improve on the primary metrics;
  - total tokens are no more than 10% above the comparator median;
  - the integrity metric is 0.

  Otherwise change one factor or retire the design.
- **Negative cases kept:**
  - no predictor registered;
  - all predictors falsified;
  - an analyst finds no repair;
  - skips on low budget;
  - budget stop;
  - GAME_OVER;
  - the digest ignored.

## 13. Evidence status

| Evidence level | Status | Provider / environment | Notes |
| --- | --- | --- | --- |
| Functional correctness | Not verified | — | Design only; §4 is source reading |
| End-to-end reachability | Not verified | — | Needs P1/P2 `arc-harness-smoke` |
| Autonomous use | Not verified | — | Needs P3 |
| Net benefit | Not verified | — | Needs P3 confirmatory pairs |

## 14. Decisions requested and follow-ups

- Confirm or modify A1–A3 and the §10 checks.
- Authorize the P0–P2 scope. P3 needs its own budget authorization.
- After confirmation, update the docs that define the current boundaries:
  - the Auto-Research section of [AGENTS.md](../../AGENTS.md);
  - rules 5–6 of the [single-life design](2026-09-20-agent-native-single-life-harness.md);
  - mark the [2026-10-01 Auto-Research decision record](2026-10-01-auto-research-mechanism-and-workers.md) as superseded for ARC.
- Related backlog items in [deferred research todos](../deferred-research-todos.md):
  - A: the adapter emits canonical transitions;
  - B: competing hypotheses as executable models;
  - C: experiment selection through disagreement, with the actor still the only one acting;
  - D: hypothesis state kept outside the actor's context.

  All stay open until the evidence above exists.

## 15. Implementation record (2026-10-09)

The user asked to implement the design and granted the authority changes A1–A3 ("I give you all the permissions"). The board is opt-in: `arc-thin-e2e --harness-board` (environment `ARC_HARNESS_BOARD=enabled`). Without the flag, the thin harness behaves exactly as before.

### 15.1 Deviations from the design, and why

| Design | Implemented | Reason |
|---|---|---|
| Integrate into the legacy path (`pi_arc_agi_3_extension.ts`, Tool records, assembly) | Integrated into the thin path (`arc_thin_extension.ts`); the legacy path is untouched | The branch's active path is the thin extension. Its plan keeps the legacy path frozen as the comparison arm. On the thin path, saved means active, with no assembly, eligibility or CAS. That removes the §4.1 hazards #1, #3, #4, #5, #7 and #8 by construction. |
| Predictor = pure Tool with `predicts` | Predictor = thin skill `run(state, args)` with an optional `predicts` field on the `skill` tool. `args={'actions':[...]}` predicts a list; `args={}` observes. A separate lens is given as `lens: "<skill name>"` and pinned to its exact version at registration. | It reuses the thin skill guest and store. The field is added to the schema only when the board is enabled. |
| Analyst namespace `board.*` | `board_<name>` | Thin skill names allow only `[a-z0-9_]`. |
| A3 standing authorization by actor call or user config | Actor: `predicts.repair=true` on the same `skill` call (no extra call or tool). User: `--board-analyst all\|contract\|disabled`, default `contract`. | This adds zero management turns. |
| Triggers on falsified, all_predictors_dead, level_changed, game_over, actor_query | Only `falsified` is implemented. `all_predictors_dead` is covered, because each falsified predictor is a trigger. | `level_changed`/`game_over` would generate new predictors, not repair one; that is not designed. `actor_query` already exists as `ask_analyst`. |
| Analyst length continuation (one) | Not implemented. A `length` stop is recorded as `failed`. | This keeps the analyst one-shot. |
| Service-output staleness (planned paths) | Not implemented. Board predictions are recomputed for each state, so they are never stale. | The thin path has no planner output to track. Tracking actor-called skill outputs needs a new interception, which the design did not specify. |
| `basis_refs` notes | Not applicable | Thin memory and skills have no `basis_refs`. |
| Ledger with task-scope stamps | `harness/board.jsonl`, plain rows | The thin path does not use the legacy task-scope marker. |

### 15.2 Files

- `demo/pi_harness_board.ts`: environment-agnostic core. It contains the transition source from bridge events (with a fetcher for `/events`, a pre-action-state fallback and an initial-state seed), contract validation, replay and live scoring, status, current predictions and comparable-feature disagreement, and the digest.
- `demo/arc_thin_board.ts`: the thin integration. It contains the skill catalog, the guest evaluator, background work with a 5 s pre-decision wait, the bounded analyst repair (budget preflight, at most 2 repairs per lineage per level, one per action boundary, 120 s wall cap, output cap), and the skill-tool receipt.
- `demo/arc_thin_extension.ts`: an optional `predicts` field, a shared `saveSkill`, a board kick after each action, `prepare` in `before_agent_start`, and the digest section in the working set. All board failures are caught, logged non-fatally and leave the decision unchanged.
- `demo/arc_thin_skill_guest.ts`: the skill guest moved out of the extension, unchanged.
- `demo/pi_task_python_server.py` and `demo/pi_task_python_pool.ts`: a persistent WASI host. Each request still runs in a fresh instance, store, fuel, memory and epoch deadline. It imports the pinned runner rather than modifying it, so saved runtime identities are unchanged. `pi_task_python.ts` exports its result checks unchanged.
- `src/autoresearch_pi/arc_thin_e2e.py` and `cli.py`: flags, `board` stats in the summary, and `arc-thin-smoke --board`.
- `tools/arc_thin_smoke_provider.ts`: a board script and a scripted repair analyst.

### 15.3 Evidence

**Go/no-go latency**, Windows, `tmp/board-latency-measure.ts`:

| Mode | Cold | Warm median |
|---|---|---|
| Spawn per call | 2066 ms | 1713 ms |
| Persistent host | 1643 ms | 129 ms |

**Functional** (`tests/pi_harness_board.test.ts`, 10/10 pass, real WASI guest):
- stage80 public trajectory: a footprint predictor written by the development agent from the stage64/stage80 audit hypothesis scores 11/11 on level 1, including blocked steps 36, 37, 39 and 43. This is not the model-authored stage70 program the design named.
- stage60: 14/14.
- The always-move variant is falsified at action 36 (predicted [24,40], observed [29,40]). The digest shows the details once, then a compact line.
- A 200 ms timeout predictor ends `erroring` with 0 wrong.
- Comparable-feature disagreement is reported.
- A missing lens rejects only the contract.
- The lens is pinned to its exact version.
- An expired deadline leaves the predictor `replaying` with no scores.
- The board writes only its ledger.

**Wiring**, real bridge, Pi, thin extension and WASI; scripted provider; mock ARC SDK (`tools/mock_arc_sdk`):
- Thin smoke regression: 14/14 (`tmp/thin-smoke-regression-20261009/summary.json`).
- Board smoke: 13/13 (`tmp/thin-board-smoke-20261009/summary.json`):
  - contracts accepted, and the receipt appears;
  - the digest appears in the working set;
  - `Disagreement [pos] on ACTION2/ACTION3` appears before any falsification;
  - the falsification at action 3 is delivered once, then compact;
  - one board-analyst call is logged in `usage.jsonl`;
  - the repair is saved as `board_pos_naive v1` and replayed 3/3 within the same pre-decision slice;
  - the repair note is shown;
  - the agent's skills are untouched;
  - all 5 scripted actions are executed;
  - 0 harness errors.

**Other regressions:** `arc_thin_feedback.test.ts` 5/5; `test_cli.py` + `test_external_benchmark_cli.py` 13/13.

**Not run:**
- the legacy `arc-harness-smoke` matrix, which is unaffected because the legacy path is untouched;
- the official ARC SDK;
- any real provider.

| Evidence level | Status | Provider / environment | Notes |
| --- | --- | --- | --- |
| Functional correctness | Pass | Node + real WASI sandbox; saved public stage60/stage80 trajectories | Predictors are development-agent written |
| End-to-end reachability (thin path) | Pass | Real bridge/Pi/thin extension/WASI; scripted provider; mock ARC SDK | Not the official SDK; the analyst is scripted |
| Autonomous use | Not verified | — | Needs P3 (§12) with a real provider |
| Net benefit | Not verified | — | Needs P3 confirmatory pairs |

### 15.4 Next falsifiable check

Run P3 (§12) on the thin path: `arc-thin-e2e --harness-board` against the same runner without the flag, with qwen3.8-27b on ft09 and ls20. The first exploratory pair answers the earliest open transition: does a real model declare `predicts` without being prompted? If it does not, the next single factor is discoverability (the skill-tool description or the system prompt), not more mechanism. Budget and token caps need the user's authorization before launch.

### 15.5 Real ARC runs (2026-10-09, user-requested)

Setup for both runs: official ARC SDK through the real bridge, game ls20, qwen3.8-27b via yibu, thin treatment, `--harness-board`, analyst `contract`, caps of 1.5M reported tokens and 3600 s, and no action cap (the setup of the user's preceding uncapped thin run).

| Run | Change | Actions / levels | Reported tokens | Skills saved | Skills declaring `predicts` | Board ledger | Stop |
|---|---|---|---|---|---|---|---|
| r1 (`runs/pi-arc-thin-ls20-board-real-20261009`) | Board enabled; the contract appears only in the `skill` tool schema | 47 / 0 | 860,164 | `analyze` v1 (region summary) | 0 | empty | `decision_timeout` |
| r2 (`runs/pi-arc-thin-ls20-board-real-r2-20261009`) | Plus a 6-line "Predictions" paragraph in the system prompt, shown only when the board is on | 44 / 0 | 677,499 | `strip_status` v1–v3 (bottom-strip counter) | 0 | empty | `decision_timeout` |

**Findings:**
- **The earliest missing step is recognition.** In 91 real decisions the model wrote 4 skill versions, all descriptive or measuring, and never declared a predictor. The board was never exercised by a real model, so its mechanics have no real-model evidence yet.
- **The stops were not caused by the board.** Both runs stopped because the ARC environment stopped answering:
  - r1: 24 `arc_action ... aborted due to timeout` results from decision 49;
  - r2: 16 such results;
  - in both runs every retry waited 120 s until the 900 s decision timeout, and the bridge close also timed out.

  The user's earlier uncapped thin run without the board (319 actions) ended with the same signature. Neither board run logged a harness error.
- **r2 is not a clean single-factor comparison.** Another session edited `arc_thin_extension.ts` and `prompts/arc_thin_system.md` during these runs (competing-hypothesis memory). The prompt file is re-read at every decision, so part of r2 saw that session's prompt. The board paragraph was present throughout, because both prompt versions keep the `{{board}}` placeholder.

**Evidence status:**
- Autonomous use: **failed at recognition** (0/2 runs, ls20, qwen3.8-27b).
- Net benefit: not testable until a model declares predictors.

**Next single factor** (not run):
1. Freeze one commit per arm, as the other session's note also requires.
2. Then test whether a predictor is created when its value is concrete, without forcing it. The candidate is to make the board's first output useful without any declaration: the runtime offers the agent's existing skills as predictor candidates when a skill's output for the after-state equals a value it could have computed from the before-state. Alternatively, accept this negative result for qwen-27B and run one stronger model, separating "mechanism unused" from "model too weak".
