# Design: evidence continuity on the thin ARC path (ledger, precedents and a stateful critic)

Date: 2026-10-09 (Asia/Shanghai). Status: **design revision 2**; not run with any real provider.

For the currently wired thin branch, see [thin 当前架构与完整流程](2026-10-09-thin-current-architecture.md), including Self-Harness, context rebuilding, consolidation, the analyst and optional Ledger/Critic. That overview describes current code; this record describes revision 2 and its implementation/evaluation status.
- Revision 1 (same date) is implemented in the working tree, uncommitted: `demo/arc_thin_ledger.ts`, `demo/arc_thin_critic.ts`, wiring in `demo/arc_thin_extension.ts` behind `ARC_HARNESS_LEDGER` / `ARC_HARNESS_CRITIC`, tests in `tests/arc_thin_ledger.test.ts`. The revision-2 deltas in §12 are not implemented.
- Revision 2 follows an external review (Codex, 2026-10-09; §14). It narrows the diagnosis, the claims and the scope, and changes the primary measure.

This supersedes the agent-facing parts of the [evidence-board record](2026-10-08-self-harness-evidence-board.md): its `predicts` contract and analyst repair. That record keeps its implementation and run evidence. Unlike revision 1, it does **not** relax the [thin hypothesis memory](2026-10-09-thin-hypothesis-memory.md): batch revision and condition-bearing evidence stay available.

It follows the [development workflow](../development-workflow.md). Scope: a lightweight research mode for the thin ARC path. It is not a replacement for Auto-Research (§2).

## 0. Problem

ARC-AGI-3 is online with a single life: no free experiments, no rollback.

The [319-action diagnosis](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/level0-diagnosis.md) shows that the agent **did** reflect: it questioned assumptions, proposed alternatives (#135, #185, #188) and deleted old strategies (#132). The failure was **continuity**: revisions did not stay binding on later choices.

- **Test conditions were lost.** The top-entry attempts #11/#12/#15/#157 all happened while the pattern did not match. Memory `vertical_range` saved "cannot enter the top, verified #157" at confidence 5 without that condition. After the pattern first matched (#166), the entry was never retried.
- **A contradicted sufficient condition was tested again.** At #223 the state was "pattern matched and bar empty" and the level did not end. Memory kept the next plan, not "matched + empty is not sufficient". The analyst (#265) ranked the same condition first, and #309 reached it again (~40 actions).
- **Evidence was misreported.** Left/right were tested at #3/#4; later, memory and the overlay prompt claimed they had never been tested.
- **Revisions failed at the tool boundary.** 114 of 130 tool errors were memory refusals. Deletions of `strategy_192` at #257/#282 were refused by call caps, yet #307's summary claimed they were done.
- **Mechanisms that need agent effort go unused.** In 2 of 2 real board runs the model declared no predictor. Those runs still produced descriptive and measurement skills.

**Primary acceptance criterion:** does earlier counterevidence correctly constrain later choices, under its original conditions? More reminders, more listed rivals or changed `idea` labels are intermediate signals only.

**First falsifiable claim (B vs A, §11):** under comparable total budgets, automatically presenting relevant earlier evidence together with its original conditions reduces repeated investment under already-refuted conditions, without harming valid routes or task progress.

## 1. Principles

1. **Minimal agent surface.** Optional free text on the action the agent already makes. No new tools, no mandatory fields, no procedures.
2. **Mechanical work is external code, under a budget.** Recording, retrieval, measurement and triggering are code. Their compute and latency are measured and capped (§10); they are not free.
3. **Predictions stay informal.** Code never parses predictions or judges free text.
4. **Code presents evidence; agents judge it.** Code retrieves earlier transitions with their conditions and shows what differs now. Whether the difference matters is a semantic judgement for the parent (and, advisorily, the critic).
5. **No constraint on Self-Harness, and keep low revision friction.** Nothing rejects, rolls back or hides a memory, skill or prompt write; no agent tool calls are consumed. The batch memory update and the optional condition-bearing hypothesis records stay.
6. **Fail-open, scoped.** A failure of this auxiliary layer never blocks an otherwise valid action. Permission, budget, version and environment-integrity checks still apply. Invalid optional fields are dropped **before** tool-schema validation (§3).

## 2. Architecture and scope

```
            ┌──────────────────────────── thin ARC runtime (external code) ────────────────────────────┐
 ARC env ──►│ Ledger: transitions, states, segments, measurements (contemporaneous/replay), completions │
 (bridge)   │ Precedent lookup ──► view lines with original conditions                                 │
            │ Critic trigger ──► Critic call (dossier + its own research notebook) ──► advisory lines   │
            └──────────────▲──────────────────────────────────────────────────────┬────────────────────┘
                           │ actions (+ optional idea/expect), skill/memory writes│ view + critic note
                           │                                                      ▼
                        Parent agent (one decision; ends with one arc_action)
                           │ creates / updates
                           ▼
                Harness components: memory, skills, prompt overlay (unchanged tools)
```

Roles and who advances each transition:
- **Parent agent:** decides actions and all Self-Harness changes; owns every semantic conclusion that drives play. Unchanged.
- **Ledger and precedent lookup (code):** records facts, retrieves earlier transitions, computes differences. Never judges free text.
- **Critic (bounded research responsibility):** successive runtime-triggered calls that share a persisted research notebook (§5). Delivers a few currently relevant lines; never acts, never edits memory or skills.
- **`ask_analyst`:** unchanged, parent-initiated, separate from the critic. (Revision 1 contradicted itself here; it stays.)

Scope limits:
- This is a lightweight research mode for the thin path. It does not establish that rule discovery, counterexample search, evidence requests or cross-stage research continuity are covered; those still need the Auto-Research mechanism ([ADR](2026-10-01-auto-research-mechanism-and-workers.md)) and remain open in [deferred B/C/D](../deferred-research-todos.md).
- Legacy Auto-Research workers stay off **as a configuration of this mode**, not because their responsibilities have been replaced.

## 3. Agent-facing surface (complete)

| Element | Change |
|---|---|
| `arc_action(action, x?, y?, note?, idea?, expect?)` | `idea`: short free-text label of what this move pursues. `expect`: free text at any time scale. Both optional. A `prepareArguments` hook drops non-string values before validation (Pi coerces primitives but rejects objects/arrays, which would otherwise refuse the action); over-long strings are clipped. |
| `memory`, `skill`, `run_skill`, `prompt`, `ask_analyst` | Unchanged, including batch memory updates and optional hypothesis records with `condition` evidence. |
| Decision context | Gains read-only lines (§6) and an occasional critic note (§5). Nothing to answer. |

Expected cost to the agent: a few optional words on some actions; ~1,200 resident characters of view.

## 4. External ledger

| Mechanism | Input | Output |
|---|---|---|
| Transition log | Bridge events | Every action with before/after frames, level, episode; append-only, permanent |
| Action segments | Consecutive actions with the same non-empty `idea` | Bookkeeping spans with close reason (label change, level change, GAME_OVER, RESET). **Not experiments**: one idea may contain several experiments and one experiment may span labels. Unlabelled actions are `unknown`; there is no fallback grouping by action name (the #16–131 run alternated ACTION1/ACTION2 and would have been fragmented). Every `expect` is kept at its action number. |
| Precedent lookup | Current state, transition log, contemporaneous measurements | (a) **per available action:** the earlier transitions with that action from the most similar before-states (same level; masked-grid distance, ticker cells masked), their outcome, and **what differs now** (difference regions; measurement leaves that differ). (b) **similar earlier states:** the nearest earlier state and what followed it in the next 3 transitions (level/state change, GAME_OVER, life loss). (c) **memory citations:** for `#n` cited in memory text or hypothesis evidence, the recorded condition at `#n` and the measurements that differ now. |
| Skill observation | Saved skills run with `args={}` in the persistent sandbox | Rows with skill name, version, `mode` (`contemporaneous` \| `replay`), and an input digest (grid, memory hash, recent actions, budget). Missing, failed and stale rows stay explicit. |
| Completion table | Level completions, GAME_OVER, RESET | Three snapshots per event: before the completing action, the terminal frame, the next level's initial state. Leaves equal at every completion are reported as a **candidate correlation (n=k)**, from contemporaneous rows only. |
| Repetition detector | (masked state, action, outcome) | Same action from the same masked state gave the same outcome ≥2 times in this episode |
| Effort and stall | Segments, state hashes | Diagnostics only. Long commitment to one idea is not a failure signal by itself; a long route may be justified. |

The ledger keeps everything. Only the view (§6) and the dossier (§5) are limited.

**Why precedents and not segments carry the claim.** The decisive missing information in the 319-action run was conditional: #157 failed while the pattern did not match; #223 did not win while matched + empty. Precedent lookup retrieves exactly this kind of earlier transition and states the difference, without code knowing which difference is decisive. It needs no labels and no skills (region differences always exist; measurement differences are added when skills exist).

## 5. Critic: a bounded research responsibility

**Triggers** (code; the agent never calls it):

| Trigger | Condition |
|---|---|
| Stage event | Level change, GAME_OVER, RESET (always) |
| Repetition | The repetition detector fires |
| Precedent conflict | The last action matches a precedent with the same outcome and no region or measurement difference |
| Stall | No new state and no level progress for ≥20 actions |

Removed from revision 1: the effort-imbalance trigger (it penalises valid long routes) and the "experiment closed" trigger (segments are not experiments). Rate limit ≥8 actions between notes except stage events; per-level cap; suppressed triggers are logged.

**Research notebook.** Each call returns (a) ≤4 lines for the parent and (b) a rewrite of its own notebook: ≤8 items, each a *conditional conclusion*, *competing explanation* or *pending distinguishing test*, each citing `#n`. The notebook is stored and given to the next call, so the critic does not reconstruct the research history from scratch. It never enters the parent's context. Items with invalid citations are dropped.

**Dossier** (code-built):
- the precedent tables (§4) for the current state;
- memory citations with their recorded conditions;
- the notebook, with the recorded condition re-attached for every `#n` it cites (so a wrong framing in an earlier note is checked against the log each time);
- segments with every `expect` at its position, next to mechanical outcomes;
- the completion table with snapshot types;
- the last 15 actions, the current state, and earlier notes with what followed delivery.

It excludes the parent's reasoning transcript. This **reduces direct anchoring but does not guarantee independent judgement**: the critic still sees parent-written memory, parent-made skills and labels. The dossier marks those as parent-written; original conditions are supplied from the log. Known limit: a decisive condition that is neither in a precedent nor in a citation is not supplied. A retrieval tool for the critic is a later variant, not part of this revision.

**Output.** ≤4 plain lines citing `#n`, optional `suggest: <action>`. Code drops lines citing nonexistent actions (mechanical grounding, not semantic).

**Timing.** Each note records `evidence_through` (last action in the dossier) and `delivered_at` (action index and decision when the parent first sees it). The parent sees `CRITIC (evidence through #n, shown at #m, advisory)`. A note is withheld if a level change happened between the two; it is marked stale if more than 8 actions passed.

**Effects** are measured from `delivered_at`, not from the call.

**Model and budget.** Configurable model; usage logged as `critic` and counted in the run's token cap.

## 6. Decision view (about 1,200 characters, read-only; each line omitted when empty)

```
PRECEDENTS (same action from the most similar earlier state; what differs now):
  ACTION1: #157 no change | now differs: face_state.match false→true; region x1-10,y55-60
  ACTION2: #222 bar 1→0 | no difference recorded
SIMILAR STATE: #223 (6 cells differ: x13-14,y61-62) → #224 life lost, level unchanged
MEMORY CITES: vertical_range cites #157 — then face_state.match=false, now true
IDEAS: strip-goal — 12 in a row (#298–#309); box-entry — last #157; 41 unlabelled
CRITIC (evidence through #309, shown at #310, advisory): matched+empty at #223 did not win (#224 life lost); entry under match never tried (#157 was unmatched). suggest: ACTION1
```

Precedent lines are capped (≤3 actions, 1 similar state, ≤2 memory citations) and ordered by smallest difference. The view sits before the current grid; full detail stays in ledger files. The `face_state` names above are the agent's own skill outputs; with no skills, only region differences appear. Nothing game-specific is written by developers.

## 7. Across stages

- Segments and the transition log continue across levels; level changes and GAME_OVERs close segments and trigger the critic.
- Precedent lookup searches the current level by default; earlier levels contribute through the completion table and the notebook.
- RESET to the same level keeps everything.

## 8. Relation to Self-Harness

Invariants: no component write is rejected, rolled back or hidden; no agent tool calls are used; tool-call caps are unchanged.

Effects: saved skills become tracked measurements, which makes precedent differences more informative. The critic may suggest consolidating a conclusion that held across levels; the agent decides.

## 9. Retired or kept

| Item | Decision | Reason |
|---|---|---|
| Board `predicts` contract and board analyst repair | Remove from agent-facing tools; reuse replay engine, transition source and persistent sandbox | Unused in real runs |
| Hypothesis memory (batch update, optional condition evidence) | **Keep** | Reduces revision friction, the failure seen at #257/#282 |
| `ask_analyst` | **Keep**, parent-initiated | Separate from the critic |
| Legacy Auto-Research workers | Off in this mode (configuration) | Not shown to be replaced |

## 10. Budgets and safety

- **Skill observation:** contemporaneous rows first; replay only when the queue is idle. Per-state wall budget 1.5 s serial (an estimate from the ~129 ms median: 40 calls ≈ 5.2 s would exceed it), queue cap with oldest-replay-dropped policy, per-call timeout 5 s, skip a version after 3 errors. Measured compute and queue drops are logged; the decision waits ≤5 s.
- **Replay** passes current memory and available actions, so it is marked `replay`, excluded from completion correlations and from precedent differences, and shown only with that mark.
- **Critic:** rate-limited, per-level cap, counted in the token cap, configurable off.
- **Failures:** logged non-fatally; the action proceeds unless a permission, budget, version or environment check fails.

## 11. Evaluation (pre-run protocol)

**Step 0: functional, offline, before any paid run.** Replay the precedent lookup over the saved states of the 319-action run (region differences only; that run has no contemporaneous observations in ledger form). Pre-stated pass criteria:
- at decisions after #166 where the bottom pattern matches, the ACTION1 precedent near the top entry is one of #11/#12/#15/#157 with a difference that includes the pattern region;
- at the decision before #309, SIMILAR STATE retrieves #223 with #224's outcome;
- false alarms: the share of decisions whose precedent lines flag retries where a recorded difference later proved decisive is reported, not hidden.
This is diagnostic evidence for the lookup only; it says nothing about adoption or benefit.

**Arms** (frozen commits, ls20 and ft09):
- A: thin baseline with current hypothesis memory.
- B: A plus §3, §4 and §6 (ledger and precedents), no critic.
- C: B plus the critic with notebook.
The first claim compares B with A; C vs B tests the critic's increment.

**Fixed before running** (to fill with the user's budget approval; no run starts with blanks): model qwen3.8-27b via yibu, official SDK; per-run action cap and token cap (parent plus critic); exploratory pairs first, then ≥3 independent runs per arm per game for confirmation, in rotated order A/B/C; acceptable regression in levels and in total cost.

**Primary measures:**
1. Repeated investment under already-refuted conditions: actions spent pursuing an outcome from a state whose decisive condition matches an earlier recorded failure. Labelled by a rater blind to arm, with a written rubric from public frames and the agent's own earlier statements, because code cannot know which condition is decisive.
2. Continuity quality: conditional conclusions kept with their condition in memory or the notebook; false alarms against legitimate retries (a condition did differ).
3. Distinguishing experiments and task progress: actions whose outcome separated alternatives the agent had stated; levels, actions per level.
4. Cost: parent plus critic tokens, observation compute, per-decision latency, management turns.

**Secondary diagnostics only:** field fill rate, suggestion uptake after delivery, component activity, repetition firings.

**Decision rules:**
- Keep B if measure 1 falls against A with no level regression beyond the pre-set limit and cost within limit.
- Keep C only if it improves measure 1 or 2 over B, within the cost limit, and its rated false alarms do not coincide with lost progress.
- Low field fill retires the `idea`/`expect` fields only; precedents do not depend on them.
- No rule rewards or punishes component counts or suggestion uptake; ignoring a wrong suggestion may be correct.

## 12. Implementation deltas from revision 1

1. `arc_action` `prepareArguments`: drop non-string `idea`/`expect` before validation.
2. Segments: no action-name fallback (`label()` in `arc_thin_ledger.ts`); keep every `expect` with its position (currently only the first is kept).
3. Precedent lookup and memory citations (new ledger functions and view lines); Step 0 check.
4. Observations: `mode` and input digest; mark `backfillSkill` rows as replay; per-state budget and queue policy.
5. Completion table with three snapshots and "candidate correlation" wording.
6. Critic: replace effort and experiment triggers with the precedent-conflict trigger; notebook store and re-grounding; `evidence_through` / `delivered_at`; withhold or mark stale; `criticEffect` from delivery (currently from `note.at`).

Order: 1–2, then 3 with Step 0, then 4–5, then 6. `arc_thin_extension.ts` is shared with other sessions; freeze a commit per arm.

## 13. Evidence status and open risks

| Layer | Status | Provider / environment | Notes |
|---|---|---|---|
| Functional | Unverified for revision 2 | — | Revision-1 tests exist; not re-run for this document |
| Full-chain reachability | Unverified | — | No `arc-harness-smoke` with ledger/critic enabled |
| Autonomous adoption | Unverified | — | No real-provider run of either revision |
| Net benefit | Unverified | — | Requires §11 arms |

Risks:
- Similarity may retrieve irrelevant precedents (false alarms) or miss decisive ones when the condition is not visible in the grid.
- The notebook can carry critic errors forward; re-grounding checks citations against the log, not interpretations.
- Rater labelling of measure 1 costs effort and needs a rubric fixed before unblinding.
- qwen may ignore the view; that is measured, not assumed.

## 14. Review record

Codex review (2026-10-09), accepted points: diagnosis framed as continuity rather than missing reflection; keep batch memory; segments are bookkeeping, unlabelled is unknown, keep all expectations; critic independence claim weakened and original conditions supplied; separate evidence cutoff and delivery; skill observations carry version, mode and input, with a compute budget; three completion snapshots and "candidate correlation"; remove proxy stop rules; narrower scope; `ask_analyst` conflict resolved; scoped fail-open; a stateful critic responsibility; the first falsifiable claim.

Design choices made here that the review left open: original conditions are attached by code to precedents and to cited `#n` rather than retrieved by the critic through a tool (cheaper, single call; misses uncited conditions); precedents are tested first (B vs A) and the stateful critic second (C vs B), so one main factor changes per comparison.
