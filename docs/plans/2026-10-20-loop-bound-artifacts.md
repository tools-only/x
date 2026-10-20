# Loop-bound artifacts: no dangling components, then computed experience (plan, 2026-10-20)

Date: 2026-10-20 (Asia/Shanghai). Status: plan, not built (the user: "don't build it now"). Record format:
`docs/templates/meta-harness-change.md`. Part A is the fix the user asked to put first; Part B (rival predictors, a
hidden-state signal, review outputs as experiments) builds on it and was proposed earlier the same day.

## Problem and claim

### One problem behind three symptoms

The user named three symptoms as one problem (2026-10-20):

| Artifact | Symptom on record | Where the chain breaks |
| --- | --- | --- |
| Saved tools (`python(code, save=)`, `tools/<name>.py`) | Callable components (saved tools, skills, subagents, refine, consult) were called 5 times in total across the su15 runs on record up to 2026-10-19 (L0, L1 and 9 runs on r04, three models). The published tools take no arguments and print fixed comparisons (13 of 13 gpt-saved tools read no args); g61-2 retyped the same per-move diff in 26 of 46 python cells; ls20-r03b defined `find_block` 14 times. The runtime's "tools/x.py already computes this" hint fired 0 times in 8 runs. | The agent must recall the tool at the moment of need and call it (pull). It does not. |
| `refine(focus)`, `consult(agent, question, refs)` | 0 calls in 10 or more su15 runs, both models (P4, 2026-10-19). `agents/` stayed empty. | Pull, and the payoff is later and unseen. |
| `prompts/lessons.md` (level review) | Written and loaded in every fork (`runs/arc-lessons-20261020`), qwen listing 4 candidate win conditions, in two forks with test moves. Yet qwen's first candidate was always level 1's pattern, no move in level 2's first 30 actions predicted a level change, win conditions tested 1, 0, 0 (sources 1, 2, 0), level 2 completed 0 of 3. One fork kept the file as a log of rejected win conditions (10 versions). | Pushed as prose. It reaches the context but no decision variable: nothing turns a candidate into a move, nothing tracks whether it was tested, nothing reports the result. |

The common cause: **an artifact sits outside the decision path**. A pull artifact never reaches the decision; a prose
artifact reaches the context but not the action. And none of the three has a feedback or retirement path, so nothing
records whether it helped and it stays: dangling.

The same runs show what does reach the decision:
- **Shown or run by the runtime:** views shown after every state, hypothesis checks run on every move, the strategy
  prompt. These were consumed in every run, mostly in the versions refinements wrote.
- **The pinned next experiment (P3, `docs/plans/2026-10-19-coverage-attempts-delivery.md`):** one concrete move,
  first in the strategy's next experiment, reminded in receipts when overdue, released when played, when its level ends
  or when it expires. In the 7 runs since it exists, 10 pins were set, 7 were played, 1 expired, 1 was replaced and 1 was
  still open at the end. qwen played 4 of its 6 resolved pins. "Played" means a move of the pinned kind came after the
  agent was told; the kinds are coarse, so some may be coincidence.
- **Receipts:** prediction scores after each action.

### Claim (Part A)

If every artifact is bound to a fixed point of the agent loop where the runtime runs or shows it, and its outcome is
recorded and fed back, artifacts stop dangling:
- what the agent or a refinement writes is used without being recalled;
- review outputs become experiments the agent plays;
- what never helps is retired.

On qwen's level 2, concretely:
- review candidates are played as pinned tests that predict a level change;
- at least 2 distinct win conditions are tested in the first 30 actions;
- every bound artifact type shows non-zero delivered use;
- budget tokens per action rise by under 20%.

- **Burden removed:**
  - recall: the agent no longer has to remember its tools;
  - translation: turning its own review prose into moves;
  - bookkeeping: whether a candidate was tested.

  The runtime does these mechanically; the agent still decides what to write and what to play.
- **Falsifiers:**
  - pins from reviews expire unplayed, or are played without predicting the level change they test;
  - bound views or predictors are shown, but the actions do not change (same win-condition tests as the sources);
  - cost per action rises by more than 20% with no rise in use;
  - qwen binds nothing itself and the refinements bind nothing new.
- **Reasonable non-use:**
  - a candidate made moot by an earlier win;
  - a view whose output never changes (shown once);
  - a level completed before any review.
- **Scope:** the native foundation's runtime (extension, binder, runner prompts for reviews). Not in scope: CH
  observation code (another session owns it), new workers, prompt reminders.

## Design (Part A: bind, deliver, account, trim)

**A1. Five loop slots.** All exist today; no new one is added.

| Slot | When the runtime acts | Artifacts that deliver there |
| --- | --- | --- |
| observe | each new state, before the decision | views: their output is shown with the state |
| act | each action | predictors: a prediction for the action |
| outcome | each result | checks (hypotheses), receipts |
| next | every decision until settled | the pinned next experiment: a move, the hypothesis it tests, and optionally its prediction |
| review | level review, stall review, GAME_OVER review | the record; the review's outputs go to `next` and `outcome` |

**A2. Binding when an artifact is made.**

An artifact is a capability only when it names its slot:
- **Arg-less saved code becomes a view** by default. The tools agents published are exactly that: fixed comparisons of
  the current state. It is shown after each state, and only when its output changed.
- **`run(state, action)` returning a partial prediction becomes a predictor** (marked `# predict: on`). The skill-predictor
  scoring that exists (`predict_skill`) scores it, but on every action, without being named.
- **Code that needs arguments stays callable by name, but the plan does not rely on it.**
- **Unbound helpers live in `lib/`:** importable from python, not listed in the capability index, no schema.

The agent decides the binding; the runtime runs it at its slot. No component is chosen by the runtime
(`services-support-agent-decides`).

**A3. Review outputs become slot items, not prose.**

- **Level review:** the candidate win conditions become pinned goal tests. The first candidate is the next experiment;
  its move carries `level_changed: true` as its prediction. The others are queued after it. This is the level-review
  record's own open item, "candidates → goal tests".
- **Stall review:** the first direction is pinned the same way.
- **The files shrink:** `lessons.md` and `review.md` keep only what a pin cannot carry: the literal win and the pattern.
- **Pin outcomes:**
  - When a pinned test is played, its prediction is scored. If the agent's own action states none, the pin's prediction
    is used.
  - The receipt says which candidate it tested and what happened: "candidate 1 (reach the circle): played #64, level did
    not change".
  - Then the next queued candidate moves up.
- **Agent-set pins:** the agent can pin a move itself by writing it first in the strategy's next experiment in the move
  form the runtime parses (`MOVE_FORM`). It is tracked like a refinement's pin.

**A4. Account and retire.**

- **Record per artifact (path@version):**
  - fired, and shown (output changed);
  - errors;
  - outcomes: predictor right/wrong, pin played/expired/replaced, check holds/fails.
- **Show it:** one count per artifact in the capability index line. Skill predictors already show `[as predictor: h/s]`.
- **Retire mechanically:**
  - a view or predictor erroring on 6 states in a row is restored or moved to `_off/`. This exists for refinement views
    (`ARC_REFINE_VIEW_RESTORE`); extend it to the agent's.
  - unchanged output is not re-shown;
  - pins expire (exists);
  - a candidate whose test was played and failed leaves the queue.
- **The agent decides the rest at review:** the review record lists artifacts that fired without changing an action or
  winning a test.

**A5. Trim the pull surface.**

- **refine and consult leave the default tool list** (the existing `ARC_THIN_LEAN` path made default). Their functions
  are reached through slots:
  - the agent's open questions in the strategy and its review directions are already in the scheduled refinement's
    input;
  - a subagent gets a slot only once one has a use with evidence.

  This departs from the earlier preference for an agent-called `refine` (Prime-style); it is listed for the user's
  decision below.
- **The "tools/x.py already computes this" hint goes:** it fired 0 times and its advice is wrong for arg-less tools.

Net resident text should not grow:
- added: view outputs when they change, and the receipt's candidate line;
- removed: the refine and consult schemas, the hint, and most of the review files' prose.

**Lifecycle and who advances it:**

| Step | Who |
| --- | --- |
| Opportunity, recognition | the agent, or a refinement's trigger on repeated python |
| Investment | the agent, or a refinement, writes the artifact |
| Assembly | the binding at save; the runtime validates it |
| Semantic use | slot delivery (runtime); the action (agent) |
| Feedback | the outcome slot (runtime) |
| Retain / revise / retire | mechanical rules (runtime); otherwise the agent at review |

## Part B, built on Part A

**B1. Rival predictors and the computed disagreement.**
- A hypothesis may carry a predictor; its check can be derived from it.
- Live rivals under one question predict every action at the act slot and are scored at the outcome slot. The receipt
  says which rival was right.
- The runtime evaluates their predictions over a candidate set: non-click actions, plus one click per object region. The
  first action where they disagree becomes the pinned next experiment, with each rival's prediction.
- The case it addresses, from the rival events' own record: su15-g56-2's correct rival differed from the belief only for
  clicks off a block, its named test was a click on a block, and 163 of the level's 188 clicks were on a block.

**B2. Hidden-state signal.** When the same board (status cells masked) and the same action give different results, the
receipt of that move says so, next to the prediction it breaks. It is shown once per pair, and the stall review's record
lists it.

**B3. Stall review into the pin.** Covered by A3.

Order: A first. Without it, B's predictors would be one more pull artifact.

## Experiment protocol (online; no run without the user's budget)

- **Layer:** autonomous adoption and outcome, real su15, real provider. The user wants mechanisms judged in the agent's
  online runtime.
- **Arms:** matched-prefix forks from qwen level-1 snapshots, as in the level-review evaluation: r04 as it is against
  r04 with Part A. Two qwen forks per arm, plus one gpt-6.1-sol fork per arm to check the strong model does not regress.
- **Budget:** about 1.5M budget tokens per qwen fork, plus the gpt forks' share. To be set with the user.
- **Stop rule:**
  - a fork ends at level 2's completion, its action budget, or its token share;
  - a Part-A fork in which nothing is bound by its 60th action is stopped and reported as non-adoption.
- **Measures, from the logs:**
  - per artifact type: bound (by agent / by refinement), fired, shown, outcomes;
  - pins: set (by review / agent / refinement), played, expired, and whether the played move stated the prediction;
  - distinct win conditions tested in level 2's first 30 actions;
  - level 2 completed and actions to complete it;
  - budget tokens per action, resident characters per request.
- **Decision rule, fixed now:**
  - **adoption:** in both qwen forks, review pins are played and at least 2 distinct win conditions are tested in the
    first 30 actions;
  - **benefit:** level 2 is completed in at least one qwen fork where its source failed, without gpt losing levels;
  - **failure:** pins expire unplayed or the early tests repeat the sources'.

  Two forks per arm only separate large effects.
- **Negative cases:** a fork whose level falls before any review; views that never change; a level where the first
  candidate wins.
- **Functional checks before any run use the recorded failure inputs**, not only synthetic fixtures. Example: 47fd11cd's
  list repair passed its fixtures and reads 0 of the 8 malformed lists recorded in su15-ch-q38-1.

## Evidence layers

| Layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | not built | — | — |
| Full-chain reachability | not built | — | — |
| Autonomous adoption | not built | — | — |
| Net benefit | not built | — | — |

## Open for the user

1. Remove `refine` and `consult` from the default tool list (A5), against the earlier Prime-style preference for an
   agent-called refine.
2. Make arg-less saves views by default (A2): saved code is shown after each state when its output changes.
3. Budget for the fork pairs.

Related: deferred item C (hypothesis → requested experiment → new evidence → revision: A3 and B1 are its online form) and
D (review outputs kept as tracked slots instead of prose); `docs/deferred-research-todos.md`.
