# Meta-harness change record: environment-agnostic ledger signals and critic triggers

Date: 2026-10-09 (Asia/Shanghai). Status: **design, reviewed for task-specific content; not implemented, not run.**
Follows [development-workflow.md](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). Builds on the [ledger/critic design](2026-10-09-lightweight-hypothesis-loop-with-critic.md); revision-2 items there (precedents, critic notebook) stay unimplemented and are not part of this record.

## 0. Generality review of the proposed update plan

Goal stated by the user: a **general meta-harness**, no task-specific content in the framework, no fitting to the ARC benchmark. Every candidate change was checked against these rules before design:

| # | Rule | Failing example |
|---|---|---|
| G1 | No game, task or benchmark knowledge in runtime code, prompts, schemas or test expectations: no game names, colours, coordinates, object roles ("player", "bar", "lives", "HUD") or strategy hints. | "Screen counters are move budgets" in the system prompt. |
| G2 | Mechanisms are defined over an environment-agnostic interface (observation, action variant, transition, episode event). An environment adapter supplies only *representation* projections for its observation type (grids, text, DOM), never per-task rules. | Ticker masking hard-coded on 64×64 cells inside the ledger. |
| G3 | Runtime code reports facts and leaves interpretation to agents. It never labels a signal as cost, goal, progress or noise. | "This change is a cost, not progress." |
| G4 | Thresholds and definitions are fixed before evaluation and are not tuned on the run that motivated them. | Picking a stall length so that ls20-C2 fires at #20. |
| G5 | Claims are evaluated on held-out tasks and on negative cases where the signal could mislead; the motivating task is reported separately as in-sample. | Accepting the change because ls20 improves. |
| G6 | Prefer replacing or removing mechanisms over adding reminders, fields or workers (AGENTS.md). | Adding a new critic trigger on top of four existing ones. |

Project-level finding: every run in `runs/` (about 160 summaries) is ls20 or ft09. All diagnosis-driven changes so far have been designed and evaluated on the same two games, so in-sample fitting is the default risk for any new mechanism, not a hypothetical one.

Verdicts on the items proposed in the review of the `thin-hyp-*-20261009` runs:

| Proposal | Verdict | Reason |
|---|---|---|
| Game-general priors in the system prompt (controllable object, counters, lives) | **Dropped** | G1: domain knowledge about ARC-AGI-3 game design, injected by developers. |
| Object-motion description in the action feedback | **Deferred, separate record** | A grid-representation feature (adapter level, deferred item A); allowed under G2 but it is a different factor and needs its own held-out evaluation. |
| Show action-invariant changes, mask them in state hashes | **Kept, generalised** (§2) | The concept (an observation part that changes regardless of the chosen action) is environment-agnostic. The earlier wording "r61-62 one column 11→3" and "evidence against the bar goal" violated G1/G3 and is removed. |
| Treat return-to-start without RESET as a stage event | **Replaced** by a magnitude-outlier event (§2) | "Return to start" needs a tuned similarity threshold and is shaped by one game. An outlier relative to the action's own history is simpler and environment-agnostic. |
| Normalise idea labels (strip numbers) | **Dropped** | A patch for one model's labelling habit. Triggers stop depending on agent-written labels instead (G6). |
| Keep uncited critic lines, cap critic output | **Kept, as a second, separate factor** (§3) | Framework-level; no task content. |
| Rerun with the UTF-8 host fix | **Kept** as evaluation hygiene | Not a design change. |

Existing task-specific content found in the current ledger/critic: `CRITIC_SYSTEM` starts with "an ARC-AGI-3 game (64x64 integer grid…)"; the critic's `suggest:` parser accepts only `ACTION1-7|RESET`; the ledger hashes `number[][]` grids and masks cells. These are moved behind the adapter in §2–§3. The parent system prompt describes the environment *interface* (grid shape, action arguments); that is adapter-supplied interface description, not task knowledge, and stays.

## 1. Problem and claim

- **Real failure and material.**
  - [thin-hyp-ls20-C2-critic-20261009](../../runs/thin-hyp-ls20-C2-critic-20261009/summary.json) (v2 ledger + critic, yibu / qwen3.8-27b, text only): about 40 actions with the same effect (one region moves, one small region changes), 0 levels. The critic was called at #14 and #55 only. The label-based triggers did not fire because labels carried counters (about 20 one- or two-action "experiments"). Repeat and stall did not fire because a part that changed on every action made every state unique (0 masked cells; the mask needs a cell to change on ≥80% of transitions). A transition of 138 cells at #46, against at most 52 before, was not an event for the ledger or the critic. Reconstruction: `tmp/analysis/ledger_view.ts`.
  - [thin-hyp-ft09-C-critic-20261009](../../runs/thin-hyp-ft09-C-critic-20261009/summary.json): the critic's most specific line was dropped for lacking a `#n` citation; its second call spent 8,000 output tokens and returned nothing.
  - Both runs: automatic skill observations failed from the 5th state on (UTF-8 host bug, since fixed), so measurement-based signals were empty.
  - Not established: whether the parent would revise its plans when shown such facts; the critic was mostly ignored when it did speak.
- **Narrow claim.** If the ledger derives its signals from mechanically computed *effect signatures* of transitions rather than from agent-written labels and raw state hashes, then (a) the stall, repetition and stage signals fire on long runs of same-kind effects and on unusual transitions in any environment whose adapter supplies signatures, and (b) the parent and critic receive the fact "this part of the observation changes after every action variant tried" without interpretation.
- **Burden removed.** Triggers no longer depend on the agent labelling consistently. Three ad hoc mechanisms (80 % ticker mask, label-run effort trigger, experiment-closed trigger) are replaced by one signature table. No new agent tools, fields or obligations.
- **Falsified if** (protocol in §5): on held-out tasks the new signals fire no more often at the pre-registered situations than the current triggers; or false alarms (an "every action" part that later proves action-dependent) exceed the pre-set limit; or the parent's behaviour after the signals is indistinguishable from the current version while cost rises.
- **Scope and non-goals.** Ledger signal source and critic triggers on the thin path. No change to memory, skills, prompt overlay, observation rendering or action tools. No ARC- or game-specific content. Not a claim that the model will understand any particular game.

## 2. Design: core signals over an environment interface

**Interface (core, environment-agnostic).** Each transition gives: `variant` (action kind plus arguments, e.g. a click with coordinates is its own variant), `parts` (a list of changed observation parts, each with a position-free `signature` string and a `where` key for display), `magnitude` (number), `episode` markers (reset / terminal / stage from the environment, if reported).

**Adapter projection (ARC grids, representation only).** Parts are the 4-connected changed regions already computed for the action feedback. Signature = cell count, bounding-box shape and the multiset of (before, after) value pairs, without absolute position. Magnitude = changed cells. No colours, positions or region roles are special-cased. Other adapters (text, key-value, DOM) would define parts as changed fields or nodes; a toy key-value adapter is built for tests only, to check that the core has no grid assumptions.

**Core signals (computed by code, shown as facts):**

| Signal | Definition (fixed before evaluation) | Replaces |
|---|---|---|
| Every-variant part | A signature present in ≥ 90 % of transitions of each of ≥ 3 distinct variants, each tried ≥ 2 times | 80 % cell ticker mask |
| Same-kind run (stall) | Number of consecutive transitions whose signatures, excluding every-variant parts, are all already seen. Trigger at 20 | State-hash stall; label effort-run trigger |
| Repetition | Same variant from the same state with every-variant parts masked, same result | Same, with a new mask |
| Outlier transition | Magnitude > 2 × the largest earlier magnitude of the same variant (≥ 3 earlier samples) | Nothing (gap: unreported discontinuities) |
| Stage events | Environment-reported level / terminal / reset, plus outliers | Same, plus outliers |

G4 disclosure: these values were chosen *after* seeing ls20-C2. The stall length 20 is the existing default; 2 × was picked by a designer who knew the #46 ratio (138 / 52 ≈ 2.7); 90 % and ≥ 3 variants were not checked against any run. So ls20 cannot validate them. They are frozen now and judged on held-out tasks only.

**View lines (read-only, about 300 characters added, each omitted when empty):**
```
EVERY ACTION: <signature> at <where> appeared after all <k> action variants tried (<n>/<N> transitions)
SAME-KIND RUN: last <m> actions produced only effect kinds seen before (since #<i>)
UNUSUAL: #<n> changed <magnitude> (largest earlier for this action: <x>)
```
The wording states counts only. It does not say whether a part is a cost, a clock, a goal or noise; a part that changes on every action can be the objective in some tasks (§5 negative cases).

**Kept:** idea/expect fields, IDEAS and expected-vs-observed lines (display only), completion table.

**Removed:** label-based experiment-closed and effort-run triggers; the 80 % ticker mask.

**Lifecycle.** All transitions are mechanical (code); interpretation stays with the parent and the critic. Failures are fail-open: a signature error drops the lines, never the action. Permission, budget, version and environment checks are unchanged.

## 3. Second factor (separate arm, after §2 is judged): critic handling

- `CRITIC_SYSTEM` loses the ARC wording; the adapter supplies the same one-sentence environment description the parent sees. The `suggest:` parser takes the adapter's action vocabulary.
- Lines without `#n` are kept, marked `(uncited)`, at most 2 shown; cited lines keep priority.
- Critic output budget comes from run configuration, not a constant; an empty reply is logged as failed instead of producing a silent note.
- The critic dossier gains the §2 signal lines.

This is evaluated as its own comparison so that §2 and §3 are not confounded.

## 4. Cost

- Parent: about 300 resident characters at most; no new decisions or tool calls.
- Runtime: one region pass per transition (already done for feedback) plus a table update; measured and logged.
- Critic: unchanged call count limits; triggers may fire more often on same-kind runs, bounded by the existing rate limit (≥ 8 actions apart, ≤ 6 per level). Critic tokens remain inside the run token cap.

## 5. Pre-run evaluation protocol

**Step 0: functional and offline (no provider, no actions).**
- Unit fixtures are synthetic, never copied from a real game: (1) toy grid with an object that moves by action plus a part that changes every action; (2) toy grid where each variant has a distinct effect and nothing is shared; (3) toy grid where the every-action part is the goal (reaching zero wins); (4) a single-kind action with arguments (clicks); (5) noisy parts that change randomly; (6) the key-value toy adapter. Expected outputs are written from the fixture definitions.
- Replay over **all** saved thin trajectories (ls20 and ft09) with the frozen thresholds. Report: when each signal would have fired; false-alarm rate for every-variant parts (parts later seen to depend on the variant); outlier precision against level changes and the frames around flagged events. ls20 is in-sample and reported separately. Thresholds are not changed after this step; if they must be, the replay result is marked exploratory and a new held-out check is required.

**Step 1: real provider (needs the user's budget approval; no run starts with blanks).**
- Arms: C (current v2 + UTF-8 fix) vs C' (C + §2). §3 later as C' vs C''.
- Tasks: at least one ARC game never used for design or diagnosis, if the SDK exposes one; ft09; ls20 reported as in-sample. Which public games are reachable must be checked first.
- ≥ 3 independent runs per arm per task, rotated order, same model, caps and deadline.
- Primary measures: actions spent in same-kind runs after the first stall signal; the design record's measure 1 (repeated investment under already-refuted conditions, blind-rated); levels and actions per level; parent + critic tokens and wall time.
- Negative cases: tasks where the every-action part matters (fixture 3 is offline only; in real runs, report any case where the parent abandoned a correct line after a signal); single-variant games; noise.
- Decision: keep §2 only if held-out tasks do not regress beyond the pre-set limit and at least one primary measure improves; in-sample gains alone do not justify keeping it.

## 6. Evidence status

| Layer | Status | Provider / environment | Notes |
|---|---|---|---|
| Functional | Unverified | — | Not implemented |
| Full-chain reachability | Unverified | — | No `arc-harness-smoke` with the new signals |
| Autonomous adoption | Unverified | — | Requires Step 1 |
| Net benefit | Unverified | — | Requires Step 1 with held-out tasks |

## 7. Expected effect on task solving (review, 2026-10-09)

Assessment from saved trajectories; analysis script `tmp/analysis/frame_survey.py`. Conclusion: **§2–§3 are unlikely to raise levels completed**; they fix auxiliary-mechanism defects. Keep them low priority and do not use them as the next solving experiment.

- **The facts the signals would add were already known to the agent.** ls20-A memory before #6: "Any action (1-4) advances bottom bar by 1 column". ls20-C2 called the same change a "side effect" from #7 and tracked its "original/shifted" two-state alternation. It noted the #46 discontinuity itself ("phase transition"). What failed was the interpretation, not the availability of the information.
- **The signals arrive after the interpretation is fixed.** "Every action" needs 3 variants tried twice each (about action 6–8), and same-kind runs need 20 actions. In the 6 real qwen thin ls20 runs that adopted the bar framing, it appears in notes by #2–#5.
- **Advice uptake is low.** The ls20-C2 parent read the critic note and replied "my plan is to keep grinding". More triggers mainly add more advisory notes.
- **ft09 is untouched.** Its limit is wall-clock and reasoning tokens per decision; extra critic calls compete for the same provider.
- **Solving is decided early and varies by run.** Of 9 real qwen thin ls20 runs, the agent navigated the block by #2–#5 in 3 (classified by reading the notes; the regex in the script is only a first pass). One of those cleared level 1 (#20, 2026-10-08), one did not in 50 actions, and one was killed by the blocking v1 critic at #15. The other 6 committed to the bar framing and cleared nothing. Each frame was pursued for the rest of the run; only the 319-action run revised it, after a GAME_OVER.
- **Evaluation power.** With level-1 success near 1 in 9 runs, 3 runs per arm cannot detect a change in levels; even a large effect needs tens of runs per arm. Levels can only be a confirmation measure after a cheaper proxy shows an effect.

Directions that target the observed bottleneck, still general (each would need its own record and §0 review):
1. **Independent early frames.** Before the parent commits, have 2–3 isolated calls each propose a different account of the controls and goal from the raw observations, with the cheapest distinguishing action. They must not see the parent's notes or memory. This attacks the early-commitment variance; it is the Auto-Research responsibility, kept bounded. The ls20-C critic, which saw little parent framing at #5, produced the decisive alternative.
2. **Integrity of hypothesis removal.** Deleting a hypothesis with no evidence is currently allowed, though `rejected` requires a refutation; ls20-A deleted its movement hypothesis at #5 with an empty evidence list. Extending the existing rule to deletion is a data check, not a new prompt.
3. **Goal hypotheses with a resolution horizon.** A goal claim that can only be confirmed after many actions (the bar framing predicted a win after 42) should be compared against cheaper tests. This is a semantic judgement for the agent; the runtime can only show the count of actions since a goal claim was adopted without its predicted outcome.
4. **Per-decision continuity for ft09-type tasks.** Carry the previous decision's derived working result forward, so the agent does not re-derive it with 8–24k reasoning tokens.
5. **Model and perception** (text-only qwen3.8-27b). This is not a framework change, but it must be separated from mechanism effects before attributing failures to the harness.

Cheaper proxy for the next solving experiment: repeat only the opening of a game (about 6 decisions, roughly 0.1 M tokens) 10 or more times per arm on several games. Measure whether the agent's control/goal account at that point is correct, judged by a blind rater with a per-game rubric. Rubrics belong to evaluation, never to the harness.

## 8. Open risks

- Position-free signatures may merge unrelated parts with the same shape and values (counted as false alarms in Step 0).
- A parent may read "every action" as "irrelevant" and abandon a correct line; the line must stay factual and the negative case is measured, not assumed away.
- The thin path has only an ARC adapter. The key-value toy adapter checks core assumptions offline; behaviour in other environments stays unverified.
- More frequent critic calls do not help if the parent ignores the critic, as in ls20-C2; §2 is judged on the parent's behaviour first.
- Related backlog: deferred item A (derived observation features belong to the agent-side observation layer, not adapter semantics) and D (observation representation). Status unchanged by this record.
