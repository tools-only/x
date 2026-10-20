# Loop-bound artifacts: no dangling components, then computed experience (plan, 2026-10-20)

Date: 2026-10-20 (Asia/Shanghai). Status: implemented (the user: "confirm and implement"), functional checks only, no
run yet. Record format: `docs/templates/meta-harness-change.md`. Part A is the fix the user asked to put first; Part B
(rival predictors, a hidden-state signal, review outputs as experiments) builds on it and was proposed earlier the same
day. Implementation and its deviations from this plan: "Implementation" below.

Revised the same day: the first version removed `refine` and `consult` from the default tools. The user: "Removal does not
fix the root problem that these tools are never invoked. Instead, we need a mechanism to ensure they get called, because
they can genuinely produce progress and improve the agent." A5 now gives them call points.

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

If every artifact is bound to a fixed point of the agent loop where the runtime runs or shows it, every service the
agent can call has a point in the loop where the call is made, and outcomes are recorded and fed back, artifacts stop
dangling:
- what the agent or a refinement writes is used without being recalled;
- `refine` and `consult` are called at their call points, on the agent's own focus and question, and what they produce
  reaches a slot;
- review outputs become experiments the agent plays;
- what never helps is retired.

On qwen's level 2, concretely:
- review candidates are played as pinned tests that predict a level change;
- at least 2 distinct win conditions are tested in the first 30 actions;
- every bound artifact type shows non-zero delivered use;
- every call point gets its call, and in each run at least one agent-focused refinement or consult answer leads to a
  played pin or a met expectation;
- budget tokens per action rise by under 20%.

- **Burden removed:**
  - recall: the agent no longer has to remember its tools;
  - delegation: when to refine or consult is set by the loop; what to ask stays the agent's;
  - translation: turning its own review prose into moves;
  - bookkeeping: whether a candidate was tested.

  The runtime does these mechanically; the agent still decides what to write, what to ask and what to play.
- **Falsifiers:**
  - pins from reviews expire unplayed, or are played without predicting the level change they test;
  - bound views or predictors are shown, but the actions do not change (same win-condition tests as the sources);
  - the call points' calls are made but are empty in effect: no edit lands in a slot, no answer reaches a pin or
    hypothesis, or what lands is never played;
  - cost per action rises by more than 20% with no rise in use;
  - qwen binds nothing itself and the refinements bind nothing new.
- **Reasonable non-use:**
  - a candidate made moot by an earlier win;
  - a view whose output never changes (shown once);
  - a level completed before any review.
- **Scope:** the native foundation's runtime (extension, binder, runner prompts for reviews). Not in scope: CH
  observation code (another session owns it), new workers, prompt reminders.

## Design (Part A: bind, deliver, call, account)

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
- **Code that takes arguments stays callable by name.** Its call point is the moment of need: when a python cell
  computes what a saved tool computes, the cell's result names the tool and the call that does it (A5, the reuse hint
  fixed).
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

**A5. Call points: a moment in the loop where each callable service is called.**

The services stay; what they lacked is what the saved tools lacked: a moment in the loop that calls for them, and a place
for what they produce. Today the scheduled refinement runs every 15 actions (`ARC_REFINE_EVERY`) on triggers the runtime
picks, so `refine(focus)` only duplicates it; `consult` has had no subagent to ask (`agents/` empty in every run). The loop
sets the moment and makes sure the call happens; the content (the focus, the question, the subagent) is the agent's.

- **refine: the scheduled step becomes the agent's call (Prime's /refine).**
  - Every 15 actions, on the existing schedule, the decision opens with a refine point. Before acting, the agent calls
    `refine(focus)`: what it wants changed in its harness now. Examples: a computation it keeps redoing, a prediction that
    keeps missing, a check or rule to write, a candidate to test.
  - The refine point shows what the agent can choose from:
    - the last refinement's outcome (its edit, whether its expectation held, whether its pin was played);
    - the artifacts that fired without helping (A4);
    - the python it repeated.
  - Until `refine` has been called in that decision, `arc_action` and `env.act` are refused with the reason, as a second
    `arc_action` is.
  - The refinement works on that focus instead of a runtime-picked one, and applies at the next turn boundary. Its edit
    must land in a slot (A1: a view, a predictor, a check, the pin, a rule) and carries the expectation the refinement
    ledger already checks.
  - Event refinements (level change, contested checks, rivals) stay. A refinement in flight at the refine point makes
    the agent's start after it (as today).
- **consult: at every review, with a subagent made when none exists.**
  - Level, stall and GAME_OVER reviews ask the agent to put one question about the record to a subagent before
    writing its review. If `agents/` holds none, the agent writes one first (name, description, tools: read and
    python). It stays for later reviews, which may reuse or rewrite it.
  - Until `consult` has been called in the turn, the review's writes are refused with the reason. The review's call
    bound rises from 8 to 10 to cover the subagent and the question.
  - The subagent reads the record and the refs in its own context, so the agent's anchoring does not carry over.
  - The answer is read in the turn. What the agent takes from it goes into the review's pins and hypotheses (A3), marked
    with the subagent's name so its use can be counted.
- **Saved tools that take arguments: the reuse hint, fixed.** When a python cell recomputes what a saved tool computes,
  the cell's result names the tool and the call. Today it fired 0 times in 8 runs: every save reset its count, and its
  advice ("call x(args={...})") was wrong for arg-less tools, which A2 turns into views.
- **What is recorded per call point:**
  - the call: made or not, the focus or question, its cost;
  - its yield: the refinement's edit and its slot, the expectation met or not, its pin played or not;
  - for consult: the subagent, the answer's size, and the pins and hypotheses that cite it.

Cost:
- **No extra refinement:** the agent-directed one takes the scheduled one's place, within the existing refinement share
  (`ARC_REFINE_MAX_SHARE`, 10% of the agent's budget tokens).
- **refine:** one more tool call per 15 actions.
- **consult:** one subagent call per review: 2-6 per run, an estimated 20-60k budget tokens each.

Resident text should not grow much:
- added: view outputs when they change, the receipt's candidate line, the refine point's lines;
- removed: most of the review files' prose.

**Lifecycle and who advances it:**

| Step | Who |
| --- | --- |
| Opportunity, recognition | the agent, or a refinement's trigger on repeated python; for services, the call point |
| Investment | the agent, or a refinement, writes the artifact; at a call point, the agent's focus or question |
| Assembly | the binding at save; the runtime validates it |
| Semantic use | slot delivery (runtime); the action (agent) |
| Feedback | the outcome slot (runtime); the call point's yield (runtime) |
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
  - call points: calls made out of call points reached; refinements on the agent's focus against those on the runtime's
    triggers (edits that landed in a slot, expectations met, pins played), set beside the refinement ledger of the runs on
    record; consult answers cited by review pins or hypotheses, and those pins played;
  - distinct win conditions tested in level 2's first 30 actions;
  - level 2 completed and actions to complete it;
  - budget tokens per action, resident characters per request.
- **Decision rule, fixed now:**
  - **adoption:** in both qwen forks, review pins are played and at least 2 distinct win conditions are tested in the
    first 30 actions;
  - **call points:** every call point reached gets its call, and in each qwen fork at least one agent-focused
    refinement or consult answer leads to a played pin or a met expectation;
  - **benefit:** level 2 is completed in at least one qwen fork where its source failed, without gpt losing levels;
  - **failure:** pins expire unplayed, the early tests repeat the sources', or the calls yield nothing that is played.

  Two forks per arm only separate large effects.
- **Negative cases:** a fork whose level falls before any review; views that never change; a level where the first
  candidate wins.
- **Functional checks before any run use the recorded failure inputs**, not only synthetic fixtures. Example: 47fd11cd's
  list repair passed its fixtures and reads 0 of the 8 malformed lists recorded in su15-ch-q38-1.

## Implementation (2026-10-20)

The user confirmed the three open points ("confirm and implement"): the call points with their refusals, arg-less saves
as views by default, and the fork budget. Built on r04 after the Continual Harness merge (`305ca1b0`).

| Part | Where | What it does |
| --- | --- | --- |
| A2 binding | `demo/arc_thin_components.ts` (`_inspect`, `_reads_args`, `_predictor`, `_call`) | A saved tool that reads no args, does not act and predicts nothing is a view unless it says `# view: off`. A tool with a top-level `predict(state, action)` is a predictor; one execution answers one action or a list. |
| A2 predictors | `demo/arc_thin_native_runtime.ts` (`predict`, `predictMany`); `demo/arc_thin_extension.ts` (`submitAction`) | The predictors run in the view pool on the state before each action, while the environment answers; each prediction is scored against the outcome, kept in the trajectory row (`predictors`) and shown in the receipt. |
| A3 tests | extension (`reviewTests`, `settleReviewTests`, `pinNextTest`, `releasePin`); runner prompts | The level and stall review prompts ask for `- test: <move> — <what it tests>` lines. A new version of `prompts/lessons.md` or `prompts/review.md` replaces the queued tests; they are pinned one at a time as exact moves (a level review's as goal tests carrying `level_changed: true`); a test move played without the agent's own prediction carries the test's. When a test is played, expires or its level ends, the next decision says so and pins the next one. The save receipt of a review file says how many of its test lines will be pinned and why the others will not (no move, a click without its cell, not available, already played on the level); a test played on the level is not pinned again when the file is rewritten (the agent rewrote `prompts/lessons.md` 10 times during one level in su15-lr-cb-q38). Test lines may carry markdown emphasis or a numbered bullet. The level review no longer asks for how the win was found, what moved progress or what wasted actions. |
| A4 accounting | runtime (`viewStats`, view change counts); extension (`artifactUsage`, `reviewArtifactLines`, `retireBrokenPredictors`); `demo/arc_thin_binder.ts` (`index`) | The capability index says where each tool enters the decision and what it did there: a view's runs and output changes, a predictor's predictions and how many were right, a callable tool's calls since it was saved. Review records list the tools and the tests pinned on the level. Views raising on 6 states in a row are restored or retired whoever wrote them (before: only refinements' views); predictors without a prediction on 6 actions in a row are moved under `_off/`. |
| A5 refine point | extension (`run.refinePoint`, `refinePointText`, `gate`, `actForCode`, the `refine` tool) | Every `ARC_REFINE_EVERY` (15) actions since the agent's last refine call, the decision's head opens with REFINE POINT: the last refinement's ledger line, what ran without helping, the python redone on the level. `arc_action` is refused (the decision goes on) and `env.act` stopped until `refine(focus)` is called; the runtime's own scheduled refinement no longer runs (event refinements do). `ARC_THIN_REFINE_POINT=0` turns it off. |
| A5 consult | extension (`run.consultPoint`, `consultFirstText`, the write/edit/memory refusal, the consult wrap, `noteConsultUse`); `LEVEL_REVIEW_CALLS` 8 → 10 | Every native review (level, stall, GAME_OVER) opens with CONSULT FIRST; the record is written to `data/record.md` for the subagent; `write`, `edit` (except under `agents/`) and `memory` are refused until a consult has answered. `(from <name>)` marks left in the review files and memory are counted after the review. `ARC_THIN_REVIEW_CONSULT=0` turns it off. A review that has not saved its own file by its last call may still write it with one more call (Runs, below). |
| A5 reuse hint | runtime (`runPython`) | Counts all of the level's python calls, not only those since the saved tools last changed, and names a view as a view. |
| B1 disagreement | extension (`pinDisagreement`, `candidateActions`, `regionCells`, `disagreement`) | With two or more predictors and nothing pinned, the first candidate (offered actions other than RESET and ACTION6, then a click on each object region, largest first) on which two predictions contradict each other is pinned, once per move and predictor versions. |
| B2 hidden state | extension (`divergentFrom`), `demo/arc_thin_level_review.ts` | When the board before an action (status cells masked as the ledger masks them) and the action equal an earlier move's but the result differs, the receipt and the review record say so. |
| Accounting | runner (`_loop_bound_stats` → `summary.harness.loop_bound`); `harness/call_points.jsonl` | Refine points and calls, consult points, consults and marks, tests pinned and their outcomes, disagreement pins, predictions and how many were right, diverged moves. |

Deviations from the plan above:
- **Unchanged view output is still shown**, marked "(output unchanged since #n)". A decision sees only its own head (earlier
  heads are not in the transcript), so hiding an unchanged output would take it away. A view whose output has been the
  same on every state since it was saved is a snapshot: after 5 states its line keeps only its first 160 characters and
  says so ("# view: off" makes it a tool to call). The recorded inputs below are why.
- **Rival predictors are predictor tools**, not a field of hypotheses; a hypothesis's check is not derived from them. The
  tool binding already runs, scores and retires them, and the agent can name the hypothesis in the tool's description.
- **The consult refusal covers `write`, `edit` and `memory`**, not python's file writes.
- **Agent-set pins from the strategy file** (A3, last bullet) are not built: the review files' test lines are the agent's
  route to a pin.

Checks (node 22 and pytest, this machine, 2026-10-20):
- `tests/arc_thin_loop_bound.test.ts` (4, real extension with an HTTP stand-in bridge, the WASI sandbox and a stubbed model):
  - a saved arg-less tool is a view, shown with the state and counted in the index; a predictor tool is scored in the
    receipt and counted;
  - a refine point refuses the action and stops `env.act` until `refine(focus)`, takes the scheduled refinement's place, and
    comes back `REFINE_EVERY` actions after the call;
  - a level review refuses `write` and `memory` until a subagent written in the turn has answered from `data/record.md`; its
    test lines become the strategy's next experiment one at a time, the pinned test's prediction is scored when its move is
    played, and the next decision reports the result and pins the next test;
  - the same board and action with a different result is said in the receipt; two predictors that disagree pin the
    separating action, and a disagreement already tested is not pinned again.
- `tests/arc_thin_components.test.ts`: default views, predictor detection, the one-action and list predict contract.
- `tests/test_arc_thin_loop_bound.py` (the summary's counts), `tests/test_arc_thin_level_review.py` and
  `tests/test_arc_thin_stall_review.py` (the prompts' test lines).
- Recorded inputs (`C:/Users/qi/tmp/r04/lb/classify.mjs`, output `classify.txt`): the last good version of every saved
  tool in the su15 runs on record, 28 tools in 15 runs, read by this branch's validator. 10 were saved as views; 24 are
  views under the new rule (14 newly, none lost), 2 stay callable because they act and 2 because they say "# view: off";
  none reads args and none is a predictor. qwen's tools were already views by their own "# view: on" (one no-op helper
  aside); 13 of the 14 new ones are gpt-5.6-sol and gpt-6.1-sol snapshots, about half of them reading fixed frames
  (`for n in range(28,36): history.grid(n)`, `json.load(open('data/observations/2.json'))`), so their output never
  changes: the snapshot rule above.
- The review-file parser on the lessons the earlier qwen forks wrote: the old prompt's candidates named moves as "Move:
  ACTION6 on a dot near blob", without a cell. Such a test line is now named in the save receipt instead of being dropped
  silently.
- `tests/arc_thin_action_surface.test.ts`: its installed-Pi test timed out at 20 s while Pi started, on this branch and on
  the base `305ca1b0` alike (`worktrees/run-lb-base`, 2026-10-20), and passed in the full run below.
- Full thin suite, one file at a time (`C:/Users/qi/tmp/r04/lb/full`): 42 files, 239 tests, 234 pass; the 5 failures
  (activation 1, components 1, receipts 3) are the same tests failing the same way on the base. pytest, the runner's 8
  files: 42 passed.

## Runs (2026-10-20, `runs/arc-lb-20261020`)

One fork pair within the confirmed budget, both from su15-cb-q38-1's level-1 snapshot (`after-decision-20`), qwen3.8-27b
thinking off (qwen dialect), 1.5M budget tokens each after the fork, `MAXLEVEL=2`; launchers
`C:/Users/qi/tmp/r04/lb/launch-*.cmd`, monitor `watch.mjs`. Off arm: `su15-lb0-cb-q38`, r04 at `305ca1b0`
(`worktrees/run-lb-base`).

**First on-arm launch, `su15-lb-cb-q38` (`0ca16629`), stopped at #22.** Its level review used the consult call point
(it wrote `agents/reviewer.md` and consulted it), then read the record and ran seven python calls; its eleventh call, the
write of `prompts/lessons.md` with four test lines in the asked form (`- test: ACTION6(41,37) — dot closest to red
circle; ...`), was refused by the review's 10-call cap. The cap's last-call note came with the tenth call's result, so
"finish now" left no call to write with (the level-review forks never met it: they wrote first and had no consult). With
no lessons file nothing could be pinned, so the run was stopped after about 0.26M budget tokens. Its first level-2
decision was a refine point (the 20-action prefix had no refine call): the agent called `refine`; its first focus, over
the 300-character schema limit, was refused, the second ran.

Fixed for the second launch:
- A level or stall review that has not saved its own file by its last call may write it with one more call, and only it;
  the tenth call's note says so. The consult-first refusal still holds for that write.
- Write and edit receipts use the workspace-relative path: a write to `./prompts/lessons.md` was saved as a plain file,
  not the prompt, with no receipt.

Spend with the restart: about 0.26M on the stopped launch beyond the pair's 3M, so up to about 3.26M in all.

## Evidence layers

| Layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passing (tests above) | offline: node, WASI, stand-in bridge, stubbed model | the runner's loop is not run end to end |
| Full-chain reachability | partial | real su15 (online ARC), yibu, qwen3.8-27b, the real runner, Pi, bridge and refiner | first on-arm launch: the consult point and the refine point were reached and called; the review's lessons write was refused by its cap (fixed); the rest pending the second launch |
| Autonomous adoption | unverified | — | — |
| Net benefit | unverified | — | — |

## Decisions (the user, 2026-10-20)

1. The call points (A5): a refine point every 15 actions with acting refused until `refine` is called, and a consult at
   every review with the review's writes refused until `consult` is called: confirmed.
2. Arg-less saves are views by default (A2): confirmed.
3. Budget: confirmed as stated in the conversation, "roughly 3M budget tokens" for one fork pair: one qwen fork per arm
   from su15-cb-q38-1's level-1 snapshot, 1.5M each. The second qwen pair (from su15-q38-1 of 10-20) and the gpt-6.1-sol
   pair have no budget yet. With one pair, "both qwen forks" in the decision rule reads as the one fork, and the gpt
   condition stays unverified.

Related: deferred item C (hypothesis → requested experiment → new evidence → revision: A3 and B1 are its online form) and
D (review outputs kept as tracked slots instead of prose); `docs/deferred-research-todos.md`.
