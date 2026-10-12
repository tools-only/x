# Plan: self-harness priorities on the thin path, 2026-10-10

Date: 2026-10-10 (Asia/Shanghai). Status: **implemented (all no-budget items, §10); real-provider evaluation not run**. Follows [development-workflow.md](../development-workflow.md); §10 is the change record for this implementation round (template sections), and later paid rounds append to it. Sources: the [related-work survey](../reports/2026-10-10-related-work-survey-self-harness.md) and the thin-path records of 2026-10-08/09 ([decision loop](2026-10-09-thin-decision-loop-efficiency.md), [lifecycle](2026-10-09-thin-hypothesis-strategy-lifecycle.md), [hypothesis memory](2026-10-09-thin-hypothesis-memory.md), [ledger/critic design](2026-10-09-lightweight-hypothesis-loop-with-critic.md)).

## 0. Principles this plan is held to

The self-harness is the product. The agent owns its memory, hypotheses, strategies, skills, prompt overlay and (later) subagents; the runtime stores, versions, routes, scores and reports. Every item below is therefore stated as: *what general capability is exposed to the agent, and how it lets the agent maintain better components*. Items that would have the runtime judge, hide, block or rewrite a component are excluded.

1. **Mechanical, not semantic.** The runtime computes facts about the agent's own artefacts (did this prediction match; does this test discriminate; was this state seen before) and shows them. It never decides that a hypothesis is wrong, a skill is bad, or a goal is X.
2. **No task content.** Mechanisms are defined over the adapter interface (observation, action, transition, level/terminal signals). No game names, colours, coordinates, object roles or strategy hints in code, prompts, schemas or tests ([rubric](2026-10-09-ledger-critic-general-signals.md) §0). Representation-level facts (cells changed, regions moved) are the adapter's; interpretation is the agent's.
3. **Optional surfaces, scored not gated.** Nothing new is required of the agent. A new field or accessor is a capability; using it earns a scored receipt. The only hard stops stay permission, budget, version and environment integrity.
4. **Resident cost is paid every decision.** Each item states its resident characters and the measured or expected benefit. Prefer on-demand accessors (sandbox data, `run_skill`) over resident text.
5. **One factor per change, evidence per layer.** Functional → full-chain smoke → autonomous adoption → net benefit, each reported separately with provider/environment named. Paid runs need a budget from the user. ls20/ft09 are in-sample; a held-out game decides.
6. **Who advances each transition.** Agent: opportunity recognition, investment, candidate content, semantic use, revision. Runtime: storage, replay, scoring, carrying receipts, counting. Nothing in this plan adds a worker, gate, reminder turn or automatic model call.

## 1. Programme overview

| Phase | Item | What the agent gains | Runtime work | Resident cost | Evidence target | Cost to run |
| --- | --- | --- | --- | --- | --- | --- |
| 0 Diagnose | D1 working-set log + carried-conclusion audit | — (measurement) | log the working set per decision; offline script | 0 | diagnostic | 0 |
| 0 | D2 blind-policy control arms | — (evaluation floor) | scripted policies through the real bridge | 0 | diagnostic | ARC actions only |
| 0 | D3 adoption probe (existing next step 1) | — | none new | 0 | adoption | 1 paid run × 2 games |
| 1 Continuity | C1 carried reasoning window | its last decision's reasoning is in front of it | clip and carry one block | ≤1,500 chars | adoption + cost | paired runs |
| 1 | C2 consolidation produces lifecycle rows | memory rows from the log, failures included | prompt of the existing consolidation turn only | 0 | adoption | within D3/C1 runs |
| 2 Prediction | P1 scored prediction on `arc_action` | its hypotheses and skills get scored by the environment | per-field scoring, running tallies | schema ≈400 chars; ≈60 chars/recent action | adoption, then benefit | paired runs |
| 2 | P2 `predict_skill`: a saved skill supplies the prediction | its skills become scored predictors | run skill before action, score after | SKILLS line +≈30 chars/skill | adoption | within P1 runs |
| 3 Hypotheses | H1 diagnosticity of recorded tests | sees which of its tests discriminate rivals | compute from `tests` verdicts | ≤1 line/question | adoption | within runs above |
| 3 | H2 deletion receipt with evidence summary | knows what it is dropping | receipt only | 0 | adoption | — |
| 4 History | L1 queryable history in the skill sandbox | can write its own precedent/condition skills | expose transitions/grids lazily to the Python host | 0 | adoption | paired runs |
| 4 | L2 moved regions as displacement (W7) | reads motion, not colour counts | adapter delta summary | ±0 | benefit | paired runs |
| 5 Evaluate | E1 protocol, metrics, funnel | — | summary fields; audit scripts | 0 | all | per run |

Order of execution: **D1, D2 first (zero model cost), then D3. The D1/D3 readings choose between Phase 1 and Phase 4 as the next paid comparison; P1 is built in parallel because it is independent of that choice.** H1/H2 are built only if D3 shows `question`/`tests` are written at all. The ledger/critic and the board's `predicts` contract stay at experimental status and are not extended by this plan.

## 2. Phase 0 — Diagnostics

### D1. Working-set log and carried-conclusion audit

- **Failure/material.** ft09 runs: 7–14k output tokens per decision, 89–93% reasoning (W6); the context is rebuilt each decision. Not known: whether the reasoning restates what the working set already carries (storage is fine, reading is the problem) or derives things the working set lacks (storage is the problem).
- **Claim (diagnostic).** We can measure, per decision, the share of the agent's reasoning that restates working-set content, and the share of working-set hypotheses/tests that the reasoning cites.
- **Implementation.**
  - [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts) `buildWorkingSet`: append `{decision, chars, sha256, sections: {memory, skills, recent, carried, latest, ledger, critic, state}}` to `harness/working_set.jsonl`, plus the full text (the grid section can be stored as a hash since `states.jsonl` has it).
  - New script `tmp/thin_restatement_audit.mjs`: for each decision, take the assistant's thinking/text blocks from `pi-events.jsonl`, split into sentences, and match against working-set lines (normalised token overlap ≥0.6, no model call). Output per run: `restated_share`, `cited_hypotheses_share`, `reasoning_chars_before_first_tool`, and the ten longest restated passages for hand review.
  - Run on the 12 existing real runs where `pi-events.jsonl` has thinking blocks; otherwise the field is "not measurable in this run" and D3 provides it.
- **Readings and what they decide.** High `restated_share` (say >40%) with high citation: the agent re-derives what it already has → Phase 1 (C1) first. Low restatement with low citation: the working set is not read as settled → change how it is rendered (C2), not what it stores. Low restatement, reasoning derives board facts from the grid each time → Phase 4 (L1/L2) first.
- **Cost.** One JSONL file per run; no model calls. Thresholds fixed before the audit runs.

### D2. Blind-policy control arms

- **Failure/material.** AERA reports every public ARC-AGI-3 game is reachable by a trivial policy ([survey §1.7](../reports/2026-10-10-related-work-survey-self-harness.md)). Our arm comparisons report levels without a floor.
- **Claim (diagnostic).** For every game used in a comparison, the level count reachable by three scripted non-model policies is known and reported next to each arm.
- **Implementation.**
  - [tools/arc_thin_smoke_provider.ts](../../tools/arc_thin_smoke_provider.ts) already scripts a provider. Add a `--policy` mode in `src/autoresearch_pi/arc_thin_e2e.py` that bypasses the model and drives the bridge directly: `repeat_each` (each available action k=50 times in turn), `probe_then_each` (one of each action, then each action k times), `uniform_random` (seeded). No Pi process, no tokens.
  - Output `summary.json` with `policy`, `levels`, `actions`, `levels_at_action[]`, `stop_reason`.
  - Run on every game in the evaluation set (E1), once per policy per seed.
- **Use.** An arm whose level count does not exceed the best blind policy on that game is reported as "no evidence of mechanism effect". This is part of E1 and of every later protocol.
- **Cost.** ARC actions and wall time only. Must respect the environment's rate limits and scorecard budget; the runner's `--max-actions` applies.

### D3. Adoption probe

Already defined as next step 1 in the [decision-loop record](2026-10-09-thin-decision-loop-efficiency.md). Unchanged, with two additions: D1 logging on, and the five questions extended by "does the agent write `question`, `tests`, `strategies` at all, and are deletions still mostly unrefuted?" One held-out game + ls20, 100 actions each, current tree frozen. This is the gate for Phase 3.

## 3. Phase 1 — Continuity of conclusions

### C1. Carried reasoning window

- **Failure/material.** W6; OpenAI's retained-reasoning result (13.3→38.3%, −6× output tokens) attributes most of the loss to dropping reasoning at the action boundary. The thin path drops everything.
- **Claim.** With the previous decision's reasoning (clipped) shown at the next decision, output tokens per decision fall and task progress does not, in ordinary qwen3.8-27b runs.
- **What the agent gains.** Its own last reasoning is in front of it; it decides what to keep by writing memory, as now. Nothing is required.
- **Mechanism.** Mechanical carry of the last assistant message's thinking block (or text when thinking is absent), clipped to `CARRY_REASONING_CHARS` (1,500; the clip keeps the *end*, where conclusions usually are), shown as `YOUR REASONING AT THE LAST DECISION (#n, clipped):`. One decision window only. Not stored in memory; not editable; disappears next decision.
  - Provider check first: whether yibu accepts `reasoning_content` on prior assistant turns (Pi's `thinkingSignature` routing). If it does, a variant C1b passes the block through the provider's own channel rather than as text, and the two are compared. If not, C1 as text.
- **Implementation.** `message_end` already sees the assistant message (`appendUsage`). Keep `lastReasoning = {decision, text}`; `buildWorkingSet` inserts the section between memory and skills. `arc_thin_e2e.py` adds `harness.continuity.carried_reasoning_chars` and the restatement audit fields per decision. Flag `ARC_THIN_CARRY_REASONING=0|chars` so the control arm is the same tree.
- **Resident cost.** ≤1,500 chars per decision. Removed: nothing. No prompt change beyond one sentence stating the section exists.
- **Falsified if** output tokens per decision do not fall ≥15% on paired runs, or `restated_share` does not fall, or levels per 100 actions fall beyond the blind floor's noise. Negative cases: a carried wrong conclusion that was not written to memory steers the next decision (audit: decisions whose action follows the carried text against a working-set hypothesis); the clipped head loses the conclusion (audit sample of 20 clips).
- **Abandon.** Flag off; no data format depends on it.

### C2. Consolidation turn produces lifecycle rows from the log

- **Failure/material.** 19/24 deletions unrefuted; conditions lost; the decision turn is where bookkeeping is skipped. ReasoningBank/ACE put extraction in a separate, cheaper pass; our `CONSOLIDATE:` turn already exists (`--consolidate-after N`) but its benefit is unmeasured (W5).
- **Claim.** When the consolidation turn is asked to produce `tests` and `question` rows for the last N actions — successes and failures alike — rather than to tidy facts, the share of hypotheses with ≥1 recorded test rises, without adding decisions.
- **What the agent gains.** A moment, outside the action loop, where it reviews its own trajectory and writes the rows it skipped. It is still the agent writing its own memory.
- **Mechanism.** Prompt-only change to the consolidation turn in `arc_thin_e2e.py`: show the last N `RECENT ACTIONS` with their change summaries and the current hypotheses, ask for `memory(tests=…, hypotheses=…)` updates, explicitly including actions whose outcome contradicted an expectation. No new tool, no new turn; cadence unchanged.
- **Resident cost.** 0 in decisions. The consolidation turn's own cost is measured (`harness.consolidation.tokens`, already partly in W5 numbers).
- **Falsified if** tests-per-hypothesis does not rise, or consolidation tokens rise >30% with no change in deletions-without-refutation.

## 4. Phase 2 — Scored prediction on the action

### P1. `arc_action.predict`

- **Failure/material.** `expect` is unscored free text; `predicts` on the board was never declared in 2/2 real runs; hypotheses are "supported" by non-discriminating evidence. Twin, Tycho and Rodionov all score predictions mechanically and all found it helped (at a cost).
- **Claim.** When the action call accepts an optional structured prediction and the receipt and `RECENT ACTIONS` show hit/miss per field, ordinary qwen runs use it on a material share of actions, and hypothesis deletions become more often preceded by a scored miss.
- **What the agent gains.** Its hypotheses get tested by the environment at no extra call: it writes what it expects *in the call it already makes*, and the harness tells it whether it was right. Over time it can see which of its hypotheses and skills predict.
- **Agent-facing surface (environment-agnostic contract).** The adapter declares a `PredictionSchema` and a `scorePrediction(prediction, before, after, meta)` function. For the ARC thin adapter the schema is representation-level only:

  ```
  predict?: {
    changed_cells?: integer | [min,max]      // count of cells that change
    cells?: [[x,y,value], ...]  (≤32)        // specific after-values
    unchanged?: [[x,y], ...]  (≤32)          // cells that must not change
    moved?: {dx, dy}                         // the dominant changed region's displacement
    level_changed?: boolean
    state?: string                           // terminal state label as the adapter reports it
  }
  ```

  Every field is optional; each supplied field is scored independently (`hit`/`miss`/`unscorable`). No field names objects, colours, goals or roles. `expect` (free text) stays as is for the ledger arm.
- **Runtime does.** In `arc_action.execute`: after the bridge returns, score the supplied fields against `beforeGrid`/`gridOf(value)` and the transition flags; attach `prediction: {fields, hits, misses}` to the `ActionRow`; append to `trajectory.jsonl`. `actionLine` renders a short suffix: `pred: changed=50 ✓, moved=(0,-1) ✗(observed (0,0))`. Keep running tallies `harness.prediction = {actions_with_prediction, fields_scored, hits, by_field}` in `summary.json`. The receipt for a miss is a fact; the agent decides what it means.
- **Not done.** No gate on unpredicted actions; no automatic refutation of any hypothesis; no parsing of hypothesis text to match predictions.
- **Implementation.** New module [demo/arc_thin_prediction.ts](../../demo/arc_thin_prediction.ts): `PredictionSchema` (TypeBox), `scorePrediction`, `renderPredictionSuffix`, `dominantDisplacement(before, after)` (reuse the P1 feedback module's 4-connected region code from [2026-10-08-thin-arc-action-feedback.md](2026-10-08-thin-arc-action-feedback.md)). `arc_action` parameters gain `predict`; `repairActionArguments` drops a malformed `predict` instead of refusing the action (same rule as `note`). Prompt: one sentence under "How a decision works": *"You may add `predict` to `arc_action`; each field you give is scored after the action and shown in RECENT ACTIONS."* Tests: unit tests for each field and the unscorable cases; smoke check `prediction_scored_in_recent_actions`.
- **Resident cost.** Schema ≈400 chars once per request; ≈60 chars per recent action that carried a prediction; one prompt sentence. Removed: nothing yet (if P1 is adopted and the ledger arm is not, `expect` is retired).
- **Falsified if** after 150 actions <10% of actions carry a prediction (then the surface is not natural for this model and P2 is the fallback), or if hit rate and later hypothesis handling are unrelated (deletions preceded by a miss do not rise from the baseline's 5/24 refuted deletions). Negative cases: predictions written to match a plan rather than a hypothesis (audit 20); `cells` lists that are trivially always-hit (unchanged background) — report `unchanged` and `cells` hit rates separately against a "no-change" baseline predictor computed by the runtime for reference only.

### P2. `predict_skill`: a saved skill supplies the prediction

- **Failure/material.** The board asked the agent to declare `predicts` on a skill; never happened. In the 319-action run skills were run 183× and their outputs never checked. PoE-World/OneLife/Twin keep programmatic predictors scored by replay.
- **Claim.** If a skill can be named in the action call as the predictor, the agent's skills become scored components without a declaration step, and skills with poor agreement stop being called.
- **What the agent gains.** `arc_action(…, predict_skill: "name")` runs that skill with the current `state` plus the proposed action before the action is sent; the skill's returned dict is treated as a P1 prediction and scored. `SKILLS` shows `[pred: 7/9]` per skill. A skill can thus be a world-model fragment the agent maintains and sees scored, which is the self-harness form of the board's evidence loop.
- **Runtime does.** Run the skill in the persistent host (≈0.13 s), pass `state.proposed_action = {action, x, y}`, take the returned object's P1 fields, score as in P1, attach `prediction.skill = {name, version}`, update per-skill tallies in `skills.jsonl` metadata. A skill error is reported as `unscorable`, never blocks the action.
- **Resident cost.** +≈30 chars per skill line; schema +1 field.
- **Falsified if** no skill is ever named as predictor across D3+paired runs (then keep P1 only), or if named skills with <50% agreement keep being called at the same rate (the agent does not read the tally; try the tally in the `run_skill` receipt before retiring).

## 5. Phase 3 — Hypothesis bookkeeping (only if D3 shows the rows are written)

### H1. Diagnosticity of recorded tests

- **Failure/material.** ls20 A #5: `hyp.progressive` "supported" and four control hypotheses deleted on evidence that did not discriminate them. Heuer's ACH: evidence consistent with all rivals has no diagnostic value; EMR-ACH computes it from the verdict row.
- **Claim.** Showing, per question, which recorded tests gave different verdicts to different rivals lowers the share of deletions with no discriminating test.
- **What the agent gains.** A property of its own `tests` it would otherwise have to re-derive: "3 tests on Q, 1 discriminating (#11)". It still chooses what to do.
- **Runtime does.** In [demo/arc_thin_memory.ts](../../demo/arc_thin_memory.ts) `renderHypotheses`: for each question, count tests whose `verdicts` include ≥2 rivals with differing verdicts; render `Q "controls": 3 tests, 1 discriminating (#11)`; mark each hypothesis line with `(0 discriminating tests)` when true. Add `harness.lifecycle.deletions_without_discriminating_test` to the stats in `arc_thin_e2e.py`.
- **Resident cost.** ≤1 line per question, ≤30 chars per hypothesis. No schema change, no refusal.
- **Falsified if** the deletion metric does not fall vs. the lifecycle baseline on paired runs, or if the lines are crowding (hand review).

### H2. Deletion receipt with evidence summary

Already partly present (dropped notes). Add to the memory receipt, on deleting or rejecting a hypothesis: the count of tests recorded against it and how many discriminated. Receipt only; no refusal. Cost 0 resident. Falsified if receipts are never followed by a re-creation or a test within 10 actions in any run (then the information is not used; keep as data only).

## 6. Phase 4 — History as data the agent's skills can query

### L1. Queryable history in the skill sandbox

- **Failure/material.** Memory claimed "left/right never tested" when #3/#4 had tested them; a contradicted condition was re-tested 40 actions later; the ledger's precedent lookup was designed to fix this with runtime views (resident text). PRO-LONG/ACM/Prime Agent keep the complete log and let the agent query it with code.
- **Claim.** When skills can read the full transition history, the agent writes and uses its own "what happened when I did A under condition C" skills, and false "never tested" claims fall.
- **What the agent gains.** `state.history` in the sandbox: `history.transitions(action=None, since=None, until=None)` → list of `{n, action, x, y, before: grid, after: grid, changed_cells, level_changed, state}`; `history.grid(n)`; `history.find(predicate)` evaluated in-guest. The agent can build precedent tables, condition checks, repetition detectors — its own versions of what the ledger did in TypeScript — as skills it can fix and delete.
- **Runtime does.** The persistent Python host ([demo/pi_task_python_pool.ts](../../demo/pi_task_python_pool.ts)) receives grids and rows incrementally (`states.jsonl` already records them when the ledger is on; make recording unconditional). The guest exposes a lazy `history` object; no grid is serialised into the model context unless a skill returns it (existing 4,000-char return clip applies).
- **Resident cost.** 0. One sentence in the Skills section of the prompt: *"`state.history` gives every earlier transition; use it to check what you already tried."*
- **Falsified if** no skill touches `history` in 2 ordinary runs (adoption), or if claims contradicted by the log do not fall (benefit; measured by the existing hand audit extended with a script that matches "never"/"not yet tested" claims against `trajectory.jsonl` actions).
- **Relation to the ledger/critic.** This is the self-harness form of §4 of the ledger design: the same data, exposed as a capability instead of a resident view. If L1 is adopted, the ledger's precedent view is not needed; if not, the ledger stays an experimental alternative.

### L2. Moved regions as displacement (W7)

Already next step 2 in the decision-loop record. Representation only: a changed region >16 cells whose cells reappear translated is reported as `moved (dx,dy)` with its size, instead of a colour histogram. This also feeds P1's `moved` field. Unchanged scope and protocol; listed here for ordering.

## 7. Phase 5 — Evaluation protocol (E1), shared by all items

- **Games.** Evaluation set = ls20, ft09 (in-sample, reported as such) + at least two games never used in any diagnosis (held-out; decide the result). Candidate non-ARC held-out family for later: DiG-bench public games (string environments, hidden rules and goals) — needs an adapter; not in this plan.
- **Floors.** D2 blind policies per game, reported in every table.
- **Model/provider.** yibu / qwen3.8-27b, provider-default thinking, as in all 2026-10-09 runs. Frozen commit per arm, `source_sha256` in `run-config.json`; no concurrent edits to the thin files during a comparison.
- **Budget.** 100–150 actions per run, decision timeout as configured, reported-token cap set with the user per round. Exploratory: 1 run/arm/game. Confirmation: ≥3, order rotated.
- **Primary metrics** (all from `summary.json` or the audit scripts):
  - task: levels, actions per level, levels vs. blind floor;
  - cost: reported tokens per decision, output tokens per decision, wall time per action;
  - continuity: `restated_share`, `cited_hypotheses_share` (D1);
  - hypotheses: deletions without refutation, without discriminating test (H1), tests per hypothesis, contested settled within 10 actions;
  - prediction: share of actions with a prediction, hit rate by field, deletions preceded by a miss;
  - components: skills created / executed / named as predictor / agreement; `history` use; overlay changes;
  - funnel (per workflow §4): opportunities (hand-audited sample), recognised, invested, candidate, assembled, semantically used, fed back; justified non-use counted.
- **Negative cases to audit every round.** Wrong carried conclusion followed (C1); predictions written to match plans (P1); trivially-hit predictions (P1); crowding lines (H1); `history` skills that return whole grids into context (L1); consolidation that rewrites rather than adds (C2).
- **Decision rules.** Keep an item when its own falsification conditions are not met on held-out games and the guard metrics hold; revise one factor when a specific transition is identified as broken; retire when adoption is absent after the stated action budget in two ordinary runs. Record all three outcomes.

## 8. What this plan deliberately does not do

- No automatic world-model builder, no trigger-based repair (Tycho: worse and dearer).
- No unit-test gate on skill writes, no required fields, no "you must predict" reminder (adoption is the thing being measured).
- No runtime judgement of hypotheses: `contested`, `hit/miss`, `discriminating` are computed properties of the agent's own records, shown back.
- No EIG or probability over free-text hypotheses.
- No game priors in prompts; representation facts only.
- No extension of the ledger/critic or the board's `predicts` contract until P1/L1 adoption is known; both keep experimental status.
- No new worker or management turn; C2 reuses the existing consolidation turn.

## 9. Sequencing and authorisation

1. **Now, no budget:** D1 logging + audit script, D2 policy runner and floors on the evaluation set, P1/P2 implementation with unit tests and smoke (mock SDK, scripted provider), H1/H2 implementation behind the lifecycle stats (cheap, no resident cost until rendered), L1 host plumbing. Each with its own change record and functional/full-chain evidence; adoption and benefit marked unverified.
2. **First paid round (needs budget):** D3 on the current tree with D1 logging — one held-out game + ls20. Reads: lifecycle-field use, restatement share, batching, refusals.
3. **Second paid round:** paired, single factor, chosen by D3: C1 (if restatement is high) or L1+L2 (if reasoning re-derives board facts). P1 rides along only as an unpaired adoption reading in both arms (it is present in both; it is not the variable).
4. **Third round:** the item not chosen in 3, or H1 if rows are being written. Then the lifecycle record's own paired protocol.
5. After each round: update the item's record, the [deferred backlog](../deferred-research-todos.md) B/C/D links with evidence status, and this plan's table.

Everything above "paid round" is deliverable as "implemented and wired; adoption and benefit unverified", which is a legitimate completion state under the workflow.

## 10. Implementation record (2026-10-10)

Scope authorised by the user: implement the plan; leave the provider reasoning-continuation channel (C1b) out. No paid run, no real ARC environment call.

### 10.1 What was built, and what each item exposes to the agent

| Item | Default | What the agent can do now | What the runtime does (mechanical only) | Entry points |
| --- | --- | --- | --- | --- |
| P1 scored prediction | on (treatment) | add `predict` to `arc_action`: `changed_cells`, `changed_cells_range`, `cells [[x,y,value]]`, `unchanged [[x,y]]`, `moved {dx,dy}`, `level_changed`, `state` | scores each supplied field after the action (`hit` / `miss` / `not scored` when no grid); shows it in the receipt and RECENT ACTIONS; a malformed prediction is dropped, never refuses the action | [demo/arc_thin_prediction.ts](../../demo/arc_thin_prediction.ts), `arc_action` in [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts), `repairActionArguments` in [demo/arc_thin_boundary.ts](../../demo/arc_thin_boundary.ts) |
| P2 predictor skill | on | `predict_skill: "<name>"`: a saved skill receives `state["proposed_action"]` and returns predict fields | runs it in the persistent host (5 s limit) before the action, scores it like P1, keeps a per-version tally shown in SKILLS (`[as predictor: h/n fields right]`); an unknown skill or a failure is recorded, never blocks | `predictWithSkill`, `skillScore` in the extension |
| L1 history | on | `state["history"]` in every skill run: `transitions(action=, since=, until=)`, `find(fn)`, `grid(n)` | keeps every state (`states.jsonl`, now written in every run); sends the action rows plus exact cell changes and one base grid for the latest stretch that fits 160k chars; `grid(n)` outside that stretch raises a readable error, never a wrong grid | [demo/arc_thin_history.ts](../../demo/arc_thin_history.ts), `_History` in [demo/arc_thin_skill_guest.ts](../../demo/arc_thin_skill_guest.ts) |
| H1 separating tests | on | sees, per question, how many recorded tests gave rivals different verdicts (`N test(s) recorded, k told rivals apart (#…)`), and `supported/rejected without a test that told it apart from a rival` on a hypothesis | counts the agent's own records (same action number, or same condition+observation); no verdict, no refusal | `questionTests`, `toldApart`, `testsToldApart`, `renderHypotheses` in [demo/arc_thin_memory.ts](../../demo/arc_thin_memory.ts) |
| H2 receipts | on | the deletion receipt says what the dropped hypothesis held (`deleted with: hyp.x n result(s), r refuting, k that told it apart from a rival`); a rejection with no separating test is noted | receipt text only | `planMemoryUpdate` |
| C2 review window | on | the consolidation turn shows every action since the previous review (≤40), with predictions and moved regions, under `ACTIONS SINCE YOUR LAST REVIEW`; the prompt asks to record tests for surprising results too | tracks the action count at each review; survives a restart via `working_set.jsonl` | `recentText`, `CONSOLIDATE_PROMPT` in [src/autoresearch_pi/arc_thin_e2e.py](../../src/autoresearch_pi/arc_thin_e2e.py) |
| C1 carried reasoning | **off** (`--carry-reasoning N`) | sees the last N characters of its previous decision's reasoning (text blocks when there is no reasoning), once | clips and carries; not stored | `message_end` / `before_agent_start` hooks |
| L2 moved regions | **off** (`--moved`) | sees `MOVED (same colour and shape…): color c ×k (x,y)→(x',y') d=(dx,dy)` in LATEST ACTION and the review | geometry only; ambiguous pairings are left out; never across a level change. Moves are always computed (P1 `moved` scoring needs them) and stored on trajectory rows | `movedRegions`, `renderMoves` |
| D1 working-set log | on | — | `working_set.jsonl` per decision: section sizes, the text given (grid by hash); summary `harness.working_set`; audit script | `buildWorkingSet`; [tmp/thin_restatement_audit.mjs](../../tmp/thin_restatement_audit.mjs) |
| D2 blind floor | CLI | — | `arc-blind-policy --policy repeat_each|probe_then_each|uniform_random`: plays through the real bridge from the available-action list only, seeded clicks, RESET on GAME_OVER; reports levels and when | [src/autoresearch_pi/arc_blind_policy.py](../../src/autoresearch_pi/arc_blind_policy.py), [cli.py](../../src/autoresearch_pi/cli.py) |

Summary fields added to `summary.json` `harness`: `prediction` (actions with a prediction, fields scored/hit by field, predictor skills by version, failures), `history` (states recorded, skill versions whose source reads history and their runs), `working_set`, and in `lifecycle`: `deleted_with_rivals`, `deleted_without_separating_test`, `settled_with_rivals`, `settled_without_separating_test`. `run-config.json` records `carry_reasoning_chars` and `moved`.

Also changed:
- **Bug fix (lifecycle tombstones).** A hypothesis deleted while *contested* (it had a recorded refutation) was kept under "dropped without a recorded refutation" and counted in `deleted_without_refutation`. Found by the new smoke. The rule now matches its comment: only a hypothesis with no refutation leaves a note. This lowers that metric for future runs relative to the old code; earlier run summaries are unchanged.
- `_ledger_stats` decides by the run configuration, because `states.jsonl` is now written in every run.
- Refactor: bridge start/stop moved into `_start_bridge` / `_stop_bridge` (shared with the blind runner); behaviour unchanged, the environment smoke covers the stop path.

Generality review against the [rubric](2026-10-09-ledger-critic-general-signals.md) §0: no game names, colours, coordinates, object roles or strategy hints in code, prompts or schemas. Prediction fields and `MOVED` are representation facts (cells, counts, displacement, flags). Mock-game content appears only in the scripted smoke provider and test fixtures.

### 10.2 Resident cost (measured)

From the provider-side request logs of the default smoke, final tree (`runs/arc-thin-default-smoke-20261010-c`) vs. the 2026-10-09 decision-loop smoke, with [tmp/thin_resident_cost.mjs](../../tmp/thin_resident_cost.mjs):

| | 2026-10-09 | 2026-10-10 | Δ |
| --- | --- | --- | --- |
| System prompt chars | 2,921 | 3,282 | +361 |
| `arc_action` schema chars | 649 | 1,655 | +1,006 |
| `skill` schema chars | 830 | 1,057 | +227 |
| All tool schemas | 6,539 | 7,772 | +1,233 |
| Decision heads (4 decisions) | 1,423 / 2,314 / 3,186 / 4,302 | 1,423 / 2,314 / 3,231 / 4,405 | +0–103 (H1 lines) |

About +1.6k characters per request, above the plan's estimate (≈400 for the schema). A first version was +2.3k; field descriptions that repeated the prompt were cut. Most of what remains is JSON Schema structure for the nested arrays. On the real runs' 15–50k-token inputs this is roughly 1–3 %. Not measured: provider tokens on a real run. Per-action additions when used: ≈60–120 chars per predicted action in RECENT ACTIONS; the review window adds up to 40 action lines once per consolidation; C1 adds ≤N chars when enabled. `state.history` adds up to 160k characters to the sandbox input of each skill run; that is not model input.

Removed: nothing. Not added: tools, workers, model calls, gates, required fields, reminder turns.

### 10.3 Verification

All on the final tree; logs in [tmp/verify-20261010/](../../tmp/verify-20261010/) (driver [tmp/verify_20261010.mjs](../../tmp/verify_20261010.mjs)).

- **Node, 61/61**: `node --experimental-transform-types --test tests/arc_thin_{prediction,history,self_harness,boundary,memory,feedback,ledger,skill_surface}.test.ts tests/pi_harness_board.test.ts`. New: [arc_thin_prediction.test.ts](../../tests/arc_thin_prediction.test.ts) (overlapping moves, two-colour objects, recolouring is not a move, ambiguous identical regions left out, per-field scoring, unscorable fields, malformed predictions dropped), [arc_thin_history.test.ts](../../tests/arc_thin_history.test.ts) (changes, budget cut, missing grid, guest queries and grid rebuild in the real sandbox, readable error outside the stretch), [arc_thin_self_harness.test.ts](../../tests/arc_thin_self_harness.test.ts) (the real extension against a local HTTP bridge stand-in: scored receipts, predictor tally, unknown predictor not blocking, history skill, working-set log, one-decision carry, review window across a restart, control variant has no prediction surface), and 2 memory tests (separating-test counts, H2 receipts) plus the tombstone regression.
- **pytest, 18/18**: `tests/test_arc_thin_lifecycle_stats.py` (separating tests, prediction stats), `tests/test_arc_blind_policy.py` (policies; one offline run through the real bridge with the mock SDK), `tests/test_cli.py`, `tests/test_external_benchmark_cli.py`.
- **Real-chain smokes** (mock ARC SDK, real bridge, real Pi, real extension and sandbox, scripted provider):
  - new [arc-thin-self-harness-smoke-20261010-c](../../runs/arc-thin-self-harness-smoke-20261010-c/summary.json), 17/17, with C1 and L2 enabled: from the provider-side request log, the action schema carries `predict`/`predict_skill`; the agent's prediction is scored and shown at the next decision; a wrong agent prediction is a MISS while the predictor skill is right; the tally reads `4/4`; the previous decision's reasoning appears once and not again; `MOVED` is reported; the question shows `1 test(s) recorded, 1 told rivals apart (#1)`; the deletion receipt arrives under the carried batch results and no false "dropped without a recorded refutation" line appears; the history skill returns `{"tried": ["ACTION1","ACTION2"], "xs": [2,3,2]}`; the review shows `#1–#3`; 5 working-set rows; summary counts as expected; ledger stats `null`; no harness errors. The first attempt ([…-20261010](../../runs/arc-thin-self-harness-smoke-20261010/summary.json)) failed two checks. One was a check string expecting spaced JSON. The other looked in the wrong place: a memory call batched with an action reports at the next decision. Its detail exposed the tombstone bug above.
  - regressions: [default](../../runs/arc-thin-default-smoke-20261010-c/summary.json) 31/31, [ledger/critic](../../runs/arc-thin-ledger-smoke-20261010-c/summary.json) 11/11, [environment failure](../../runs/arc-thin-environment-smoke-20261010-c/summary.json) 5/5.

### 10.4 D1 on the existing real runs (zero model cost)

[tmp/thin_restatement_audit.mjs](../../tmp/thin_restatement_audit.mjs) on all 12 real thin runs ([output](../../tmp/thin_restatement_audit.json); per-decision detail for ft09 C in [this file](../../tmp/thin_restatement_audit_ft09C_detail.json)). These runs predate `working_set.jsonl`, so only the cross-decision measure exists: the share of a decision's reasoning sentences (≥8 tokens) that restate a sentence of the previous decision (≥60 % token overlap).

- Median per run: 0.17–0.26 (ls20 board r2: 0). Share of decisions above 40 %: 0.02–0.26, except ls20 C (15 decisions) at 0.50.
- ft09 decisions are long: medians of 11.9k–21.1k reasoning characters per decision. Their repeat shares are still only 0.18–0.25. In ft09 C the longest decisions (44k and 66k characters) repeat 24 % and 38 %.
- **Reading against the pre-registered rule (§2 D1: >40 % → C1 first):** not met. Most of each decision's reasoning is new text, not a restatement of the previous decision. This is consistent with re-deriving facts from the grid, which points first to Phase 4 (L1/L2: data and representation) rather than C1. That is a direction, not a verdict.
- **Limits:** the measure is lexical, so paraphrased re-derivation (same conclusion, other words or coordinates) is not counted, and it compares only with the previous decision. The working-set measures (`restated_ws`, `hyps_cited`) need D3.

### 10.5 Evidence layers

| Layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Pass | node + pytest; real sandbox; local HTTP bridge stand-in | §10.3. The stand-in bridge is not the production bridge |
| Full-chain reachability | Pass (thin path) | scripted provider; mock ARC SDK; real bridge / Pi / extension / sandbox | Four smokes in §10.3. D2 was run only through the mock SDK |
| Autonomous adoption | Unverified | — | Whether qwen writes `predict`, names a predictor skill, reads `state.history`, or uses the separating-test counts: D3 |
| Net benefit | Unverified | — | Needs the §7 protocol with held-out games and blind floors |

### 10.6 Delivery decision and next checks

- **Supported:** the capabilities and their wiring as listed in 10.1. The D1 cross-decision reading on 12 existing runs.
- **Not supported:** any adoption by a real model; any change in tokens, actions per level or levels.
- **Decision:** keep. P1, P2, L1, H1, H2, C2 and D1 are on by default as capabilities; C1 and L2 stay off as comparison variables. The tombstone fix is kept.
- **Next, in order (each needs the user's go-ahead):**
  1. **D2 on the real ARC environment.** It costs ARC actions and scorecards, no model tokens: three policies × the evaluation games, so every later arm has a floor. Choose and reserve ≥2 held-out games first.
  2. **D3 adoption probe (paid).** The current tree on one held-out game and ls20, 100 actions each. It reads `harness.prediction`, `history`, `working_set`, `lifecycle` and the D1 audit with `restated_ws`.
  3. **Second paid round.** Given §10.4, the default candidate is **L2 (`--moved`) as the single variable**, paired, on held-out games. C1 (`--carry-reasoning`) is next only if D3's `restated_ws` exceeds the 40 % threshold.
- **Backlog:** [deferred-research-todos.md](../deferred-research-todos.md) has a dated entry under 后续更新; the B/C/D status is unchanged.

### 10.7 First real runs: D3 adoption probe and D2 floors (2026-10-10, 13:15–14:10)

The user asked to run ARC to test the new mechanism.

**Setup**
- Source frozen in `tmp/freeze/self-harness-20261010/`: hashes in its `FREEZE.json`; script [tmp/freeze_self_harness_20261010.mjs](../../tmp/freeze_self_harness_20261010.mjs).
- Held-out games picked by a rule fixed before any game was looked at. Drop the diagnosed games (ls20, ft09), the preview-era game (vc33) and the five games AERA reports as won by a trivial policy. Order the rest by sha256 of the id. Result: **ka59** for this probe, **tu93** reserved. In the Twin paper ka59 was their most expensive game; it was kept because the rule chose it.
- Agent runs: yibu / qwen3.8-27b, provider-default thinking, text only, default configuration (C1 and L2 off). Budget per run: 100 actions, 1.2M reported tokens, 3600 s. Both ran in parallel.
- Floors: the three blind policies, 100 actions each, on both games.

**Results**

| Run | Stop | Actions | Levels | Blind floor (3 policies) | Reported tokens | Tokens / action | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ka59](../../runs/thin-sh-d3-ka59-20261010/summary.json) (held-out) | deadline | 24 | 0 | 0 / 0 / 0 (GAME_OVER at action 100 in each) | 594,459 | 24.8k | 3,602 s (≈150 s per action) |
| [ls20](../../runs/thin-sh-d3-ls20-20261010/summary.json) (in-sample) | token cap | 62 | **1** (at #62) | 0 / 0 / 0 | 1,205,290 | 19.4k | 3,262 s |

Floor runs: `runs/blind-{repeat_each,probe_then_each,uniform_random}-{ka59,ls20}-20261010/`. Total reported tokens 1.80M, within the 2.4M the two caps allowed. The ls20 scorecard close timed out on arcprize.org (`ReadTimeout`); the bridge state had already recorded the level.

**Adoption of each capability** (ordinary runs; nothing told the model to use any of them):

| Capability | ka59 | ls20 | Reading |
| --- | --- | --- | --- |
| P1 `predict` | 19/24 actions; 44/50 fields right | 56/62 actions; 192/206 fields right | **Adopted** on both games without prompting beyond the one prompt line. Predictions were mostly of fields the agent was sure of; misses are where they mattered (below). |
| P2 `predict_skill` | 0 | 0 (3 skills saved, 13 runs) | Not adopted. |
| L1 `state.history` | 0 skills | 0 of 3 skills read it | Not adopted through skills. In ls20 the agent knew about history but asked `ask_analyst` to read `history.grid(0)`; see negative cases. |
| H1/H2 separating tests | 2 of 3 settled hypotheses without a test that told rivals apart | 3 of 3 | Shown; behaviour not visibly changed. No deletions in either run, so the H2 receipt was never triggered. |
| C2 review window | no review (24 actions < 25) | 2 reviews | Reachable; effect not assessed. |
| D1 log | 25 rows | 64 rows | Working set mean 11.9k / 12.8k chars; memory section about 5–6k of that. |

**What the predictions did, from the trajectories** (digests: [ls20](../../tmp/d3_ls20_digest.txt), [ka59](../../tmp/d3_ka59_digest.txt); ls20 reasoning around the turn: [extract](../../tmp/d3_ls20_reasoning_43_45.txt))
- *ka59:* the first two actions predicted "nothing moves" and were scored MISS (saw (0,-3), then (0,3)). From #3 on, the agent predicted the 3-cell moves of the object it controls correctly. Click actions (ACTION6) were mostly made without a prediction.
- *ls20 #1–#43, bar-as-goal again:* the agent took the bottom colour-11 bar (the move budget) as a track to fill, the same misreading as in the 2026-10-09 runs. Its predictions were about the bar and were right.
- *ls20 #43, falsified:* it predicted `level_changed: true, state: WIN` for the move that emptied the bar, and both were scored MISS. The next decision's reasoning begins "state is NOT_FINISHED and level_changed=false … So the goal hypothesis may be wrong". It abandoned `strat.fill`, made the movable block the object of a new goal hypothesis, navigated it, and cleared level 1 at #62.
- In the earlier thin runs the bar emptying was reframed as "round 2" and the grind repeated.
- **Attribution is uncertain.** The reasoning cites the outcome, not the MISS label, and the agent might have noticed the missing win anyway. What is new is that the agent wrote down a falsifiable expectation at the decisive moment, and the runtime scored it.

**Negative cases**
- **A miss explained by an invented rule.** At ls20 #11 an action changed 0 cells (the block hit a wall). The agent recorded `hyp.stall_rule` ("7 consecutive same actions stall") as supported and then rotated actions to stay "stall-safe" for 30 actions. A scored miss does not ensure a correct revision.
- **History through the wrong channel, and a fabricated fact accepted.** At ls20 decision 45 the agent asked the analyst to use `state['history']` to read the starting grid. The analyst cannot see it: it is a tool-less call given the current and previous grid. It answered "the starting grid had NO 11 cells", and the agent wrote this into memory and the goal hypothesis. [tmp/thin_state_colors.mjs](../../tmp/thin_state_colors.mjs) on `states.jsonl` shows the starting grid had 84 cells of colour 11. The right conclusion (the bar is not the goal) was reached partly on a false premise.
- **Life loss not recognised.** At #44 the bar refilled (11: 0 → 84), the block jumped (-5,+5) and an 8-coloured indicator lost 4 cells. The agent read this as "the track reset".
- **ka59 is limited by wall time.** 24 actions in an hour at a median of 14.4k reasoning characters per decision, the same profile as ft09 on 2026-10-09.

**D1 with the working-set measure** ([output](../../tmp/thin_restatement_audit_d3.json)):

| Run | Restated from the previous decision (median) | Restated from the working set (median) | Decisions above 40% vs previous | Hypothesis keys named in reasoning |
| --- | --- | --- | --- | --- |
| ka59 | 0.41 | **0.42** | 52% | 0 |
| ls20 | 0.15 | 0.20 | 14% | 0 |

The pre-registered 40% threshold is crossed on ka59 (the deliberation-heavy, time-bound game) and not on ls20. The key-based "hypothesis keys named" measure reads 0 in both: the agent refers to hypotheses in words, not by key, so this measure is uninformative and should be replaced or dropped.

**Evidence layers after this round**

| Layer | Status | Provider / environment | Limits |
| --- | --- | --- | --- |
| Autonomous adoption | **P1 pass** (2/2 runs, one held-out). P2, L1: not adopted. H1/H2, C2: reachable, no visible effect | real yibu / qwen3.8-27b; official ARC SDK online | One run per game; no comparator |
| Net benefit | Unverified | — | ls20 cleared level 1 (above the 0-level floor), but the earlier base rate for level 1 on thin ls20 was about 1 in 9 runs, so one run cannot show a benefit. ka59 equals its floor |

**Next checks** (each one factor):
1. **Analyst boundary, a robustness fix with no new surface.** The observed failure is history routed to a channel that cannot see it, and a fabricated answer that was accepted.
   - The analyst system prompt states that it only sees the grids it is given and must say so when asked about others.
   - The `ask_analyst` description points to a skill with `state["history"]` for earlier states.
   - Check: the replayed ls20 decision-45 question now gets a refusal rather than a claim.
2. **C1 (`--carry-reasoning`), paired on ka59 and the reserved tu93.** The D1 threshold was met on ka59. The target is actions per hour and output tokens per decision, with levels as a guard.
3. **L2 (`--moved`), paired on ls20 and tu93.** In ls20 the runtime's moved-region detection saw the block's ±5 moves from #1, while the agent took 43 actions to treat the block as the thing to move.
4. If P2 and L1 stay at 0 use after these, retire them or cut their resident cost. They cost about 300 schema characters per request.

### 10.8 Analyst boundary fix (2026-10-10, after the D3 probe)

**Failure and material.** ls20 decision 45 of [thin-sh-d3-ls20-20261010](../../runs/thin-sh-d3-ls20-20261010/summary.json): `pi-events.jsonl` line 808, `usage.jsonl` row 63, `memory.jsonl` rows 44/45/47; full texts in [tmp/d3_ls20_analyst_calls.txt](../../tmp/d3_ls20_analyst_calls.txt).
- The agent asked `ask_analyst` to "examine the FIRST grid (history.grid(0))".
- The analyst call carried only the current grid (state after #43; 3,460 input tokens, against 6,043 for the call that included the previous grid).
- The reply was headed "Starting Grid (history.grid(0))" and stated "There are zero cells of color 11 in the starting grid".
- `states.jsonl` n=0 has 84 cells of colour 11; n=43, the grid actually sent, has 0.
- The agent wrote "start had 0 color-11 cells" into `state.progress` and the `hyp.goal` claim, and reasoned from it two decisions later.

**Cause.** Nothing in the request said what the analyst could not see:
- the system prompt was one sentence about being a careful analyst;
- the message held the question and an unlabelled "CURRENT GRID";
- the grid rendering's line "Current frame is the last rendered frame (1 of 1)" was read as "the session has only 1 frame, so the grid shown is the starting state" (both replayed "before" answers say this);
- the tool description did not say where earlier states can be read.

**Claim.** With the inputs named in the request, the analyst states what is missing instead of answering about a different grid. The receipt tells the agent what an answer was based on.

**Change** (no new tool, field, call or gate):
- New [demo/arc_thin_analyst.ts](../../demo/arc_thin_analyst.ts):
  - `ANALYST_SYSTEM` says the analyst has no tools, sees only the inputs listed under INPUTS, must first say which input is missing, and must never present a given grid as a different one;
  - `analystMessage` opens with `INPUTS: the current grid (after action #n)[, the grid before action #n][, the agent's memory]. Nothing else from this run is visible to you.` and labels each grid with its action number;
  - `analystReceipt` appends `(analyst saw only: …)` to the answer the agent receives.
- `ask_analyst` description gains "It sees nothing else: for earlier states, write a skill that reads state["history"]."
- Resident cost: tool schemas 7,772 → 7,859 chars (+87). The analyst call itself grows by about 600 characters of system prompt and header; that is paid per analyst call, not per decision.

**Verification**
- Unit: [tests/arc_thin_analyst.test.ts](../../tests/arc_thin_analyst.test.ts), 2 tests.
- Full chain: all four smokes on the changed tree (`runs/arc-thin-*-smoke-20261010-e`). The default smoke gained `analyst_inputs_named`, which checks the provider-side request (system prompt and `INPUTS:` header) and the receipt suffix. In the same driver run ([tmp/verify-20261010/](../../tmp/verify-20261010/)): node 63/63, pytest 18/18.
- **Real provider replay**, yibu / qwen3.8-27b, thinking `medium` (Pi's default, as in the run): the exact decision-45 question on the exact grid, script [tmp/analyst_replay_20261010.ts](../../tmp/analyst_replay_20261010.ts), answers in [tmp/analyst-replay-20261010.json](../../tmp/analyst-replay-20261010.json). Judged by reading the answers; the script's regex flag missed one of the two fabrications.

| Request | Calls | Outcome | Reported tokens per call | Seconds per call |
| --- | --- | --- | --- | --- |
| Before (old system prompt and message) | 2 | 2/2 present the current grid as the starting grid and state that colour 11 is absent from it | 11,298 / 15,502 | 129 / 183 |
| After | 3 | 3/3 open with "Missing input: `state['history']` … was not provided"; none makes a claim about the starting grid; each then reports the current grid, labelled as current | 4,786 / 5,353 / 5,080 | 26 / 32 / 27 |

Replay cost: 42,019 reported tokens.

**Limits**
- Five calls on one question and one grid.
- The "after" answers still contain errors about the *current* grid (approximate cell counts; one misdescribes the 5×5 block). The fix addresses which grid an answer is about, not the analyst's accuracy.
- Not tested: whether the agent now routes history questions to a skill, and whether it reads the receipt line. That needs an ordinary run.

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass | node unit tests |
| Full-chain reachability | Pass | scripted provider, mock ARC SDK, real bridge / Pi / extension |
| Analyst behaviour on the failing case | Pass (3/3 vs 0/2) | real yibu / qwen3.8-27b, replay outside the game loop |
| Agent adoption (history via skills) and net benefit | Unverified | — |

**Decision:** keep. This removes item 1 from the next-checks list above; items 2–4 stand. The frozen source of the D3 probe (`tmp/freeze/self-harness-20261010/`) predates this fix, so the next paired runs need a new freeze.

### 10.9 Cross-frame analysis is the agent's own tool (2026-10-10, user direction)

**Principle (user):**
- Cross-frame differencing, and any similar derived feature, is a tool the agent creates when it judges it needs one.
- The project provides the foundations to build it on: the current grid, the previous grid, and the history of frames.
- The project does not provide a predefined analysis interface.

**What the project computed for the agent before this change, and what happened to it:**

| Feature | Where | Now |
| --- | --- | --- |
| PIXEL CHANGES summary (4-connected regions, bbox, colour transitions, pixels) | action receipt, LATEST ACTION section | **Removed.** Module `demo/arc_thin_feedback.ts`, its test and fixture deleted (`git rm`; recoverable from history) |
| MOVED region tracking (`--moved`, L2) | LATEST ACTION, review window; `moves` on trajectory rows | **Removed**, CLI flag and runner variable retired |
| `changed_cells=N` on every action line | receipt, RECENT ACTIONS, review | **Removed from view.** The bridge's count stays in `trajectory.jsonl` for evaluation only |
| Diff-based prediction fields (`changed_cells`, `changed_cells_range`, `unchanged`, `moved`) | `arc_action.predict` | **Removed.** Kept: `cells` (values after), `level_changed`, `state`, which are read from the returned observation |
| Precomputed per-transition `changes` and `changed_cells` in history rows | `state["history"]` | **Removed from rows.** Rows hold what the environment reported; the per-step deltas remain only as transport for `history.grid(n)` |
| Coarse colour layout and 2×2 tile map | every rendered grid (adapter's derived views) | **Removed in the thin path** (`renderArcLatestFrameRuns(…, { derived: false })`), for the working set, the analyst and the critic dossier. About 500–520 characters per decision on real ka59/ls20 grids ([tmp/state_render_size.ts](../../tmp/state_render_size.ts)) |
| `recent_actions` in skill state carried stored rows with the summaries above | skills | Reduced to reported facts (`reportedAction`) |

**Foundations the agent builds on (unchanged or clarified):**
- The current grid as lossless coordinate runs, plus the image when the model takes images.
- What the environment reported per action: level change, state, levels and budget.
- In skills: `state["grid"]`, `state["prev_grid"]`, `frames` (animation of the last action, on request), `state["history"]` with `transitions(...)` and `history.grid(n)`, and memory.

The system prompt now says that no earlier grid and no change summary is shown, and that "to know what an action changed, or anything else across frames, write that comparison as a skill". The control variant (`arc_action` only) has no skills, so it has no way to compare frames at all. That is consistent with its role as the no-harness baseline; its prompt was reworded to match.

**Prompt form: capabilities, not directives (user correction, same day).**
- The first version of this change told the agent what to build: "To know what an action changed, or anything else across frames, write that comparison as a skill."
- In the round-2 runs both agents saved a diff skill right after their first action, and their reasoning quotes that prompt text back. That is prompted behaviour, not recognition of a need.
- The user rejected this form. The project should state what resources and services it provides and that the agent can create anything from them.
- Rewritten in [demo/prompts/arc_thin_system.md](../../demo/prompts/arc_thin_system.md). The "Skills" and "Prompt overlay" sections became one section, "Your harness":
  - what the agent can build: tools, standing instructions, knowledge;
  - "You can create anything from the resources and services below, whenever you judge it worth having, and revise or delete it later. The project provides these and adds no analysis of its own.";
  - the resources in every skill's `state`: `grid`, `prev_grid`, `history` with `history.grid(n)`, `frames`, the agent's own records, the sandboxed standard library;
  - the services the project runs: `ask_analyst`, prediction checking, the review turn, plus the ledger and critic text when enabled.
- Removed directive text:
  - "No earlier grid and no summary of what changed is shown";
  - "Write one when you find yourself counting, locating, comparing or searching by hand";
  - "To know what an action changed … write that comparison as a skill";
  - the empty-skills line "write one with skill(op="set") when you repeat a calculation", now a plain statement of when `run_skill` becomes available;
  - the `ask_analyst` description's "write a skill that reads state["history"]", now "earlier grids are available to skills (prev_grid, history)".
- Not changed: the "Hypotheses, strategy and memory" section and the empty-state hints in the memory view are still directive ("Keep 2-4 competing hypotheses…"). They belong to the lifecycle design and were left for a separate decision.
- Checks on the rewritten prompt (`runs/arc-thin-*-smoke-20261010-h`): node 56/56, pytest 18/18, four smokes pass. System prompt 3,477 → 3,764 chars (+287).
- The round-2 runs in progress use the directive wording (freeze `self-harness-20261010-b`). They can show whether agent-built comparisons are sufficient, not whether the agent finds the need unprompted. That needs a run on the rewritten prompt.

**Services that continue (user clarification, same day).** The ledger, the critic and the evidence board are not tools for the agent to build. They are services the project runs to support the agent's self-harness, and they continue unchanged.
- The principle above governs the agent's own interface: the working set, receipts, skill state and analyst input.
- It does not govern what these services compute for themselves, or what they deliver as their output.
- An intermediate edit had switched the critic dossier to the reduced grid rendering and dropped `changed_cells` from its action lines. Both were restored: `decisionLine` and `currentState` as before.
- New ledger-smoke check `critic_dossier_keeps_frame_facts`: the critic request carries `changed_cells=` and the derived layout, while no agent decision head does.
- Ledger and critic remain opt-in (`--ledger`, `--critic`).

**Ledger and critic on by default (user direction, same day).**
- The treatment variant now runs both services unless they are switched off:
  - CLI `--no-ledger` / `--no-critic`;
  - runner `ledger=False` / `critic=False`;
  - extension `ARC_HARNESS_LEDGER` / `ARC_HARNESS_CRITIC` = `disabled`.
- The critic needs the ledger, so the critic alone keeps it on. The control variant never has them.
- The runner always sets both variables explicitly. `run-config.json` records the actual state.
- Costs that now apply to every default run:
  - the ledger view in the working set;
  - the optional `idea`/`expect` fields and Ideas section in the prompt;
  - skill observation runs in the sandbox;
  - critic model calls at its triggers (rate-limited, non-blocking; see the ledger/critic design record §5).
- The base, environment and self-harness smokes pin both services off, because they check other mechanisms against exact text. The ledger smoke now passes no flags, so it exercises the default configuration. `run-config.json` confirms `ledger: true, critic: true`.
- New tests:
  - `the ledger and the critic run by default…`: services on with nothing set, off when disabled, critic alone keeps the ledger, never in control;
  - a pytest on the runner defaults.
- Results: node 57/57, pytest 19/19, four smokes pass (`runs/arc-thin-*-smoke-20261010-i`).
- Real runs before this change (D3, round 2) ran without these services, so later default runs differ from them by both the services and any other change in between.
- The evidence board module (`demo/pi_harness_board.ts`) is intact and its tests pass. It is not wired into the thin runner or extension. That was already the case in the committed tree before this work (commit `24b31116`; no `--harness-board` option exists in `src/` or `demo/`). Re-wiring it is a separate change.

**Verification**
- Node 56/56. The suite count fell because the feedback test file was deleted. New checks: no runtime analysis text in any decision head, receipt or review; the predict schema is limited to `cells`/`level_changed`/`state`; skill `recent_actions` hold only reported fields; and the agent's own skill computes the exact changes of the last action from `prev_grid` and earlier positions from history.
- pytest 18/18.
- Smokes on the changed tree (`runs/arc-thin-*-smoke-20261010-f`), all passed:
  - default smoke: new `no_runtime_frame_analysis` and `current_grid_and_report_shown`;
  - self-harness smoke: new `agent_built_frame_diff` (the scripted agent's own skill on `state["history"]` returns `[{n:1, changed:[[0,0,0,1],[2,3,9,0],[3,3,0,9]]}, {n:2, …}]`), and `no_runtime_frame_analysis`;
  - ledger and environment smokes unchanged.
- Resident cost, default smoke against the previous tree (`-d`):
  - system prompt 3,282 → 3,477 (+195);
  - `arc_action` schema 1,655 → 1,142 (−513);
  - all tool schemas 7,859 → 7,341 (−518);
  - per decision, the derived grid views (≈500 chars on 64×64 grids) and the PIXEL CHANGES block (up to 1,200 chars) are gone.

**Expected behaviour and risk (unverified):**
- Until the agent writes a comparison skill, it only sees the current grid and the reported flags, so the effect of an action on the board is not visible.
- In D3 the agent wrote skills in ls20 (3) but none in ka59, and in earlier runs zero-change actions (wall hits) were noticed from `changed_cells=0`.
- This is the test of the principle: does the agent recognise the need and build the tool?
- Measures for the next ordinary run:
  - whether and when a skill reading `prev_grid` or `history` appears;
  - how often it is run;
  - actions before the first such skill;
  - repeated no-effect actions before and after it exists.

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass | node, pytest |
| Full-chain reachability | Pass | scripted provider, mock ARC SDK, real bridge / Pi / extension / sandbox |
| Autonomous adoption (does the agent build its own frame comparison) | Unverified | — |
| Net benefit | Unverified | — |

**Effect on the next checks:**
- L2 (`--moved`) is withdrawn as a variable.
- C1 (`--carry-reasoning`) stands.
- The next ordinary run is now first of all the adoption test of this principle, on a fresh freeze.

### 10.10 Round 3: capability prompt, ledger and critic on (2026-10-10, 17:28–18:05)

Freeze `tmp/freeze/self-harness-20261010-c` (capability prompt of §10.9, ledger and critic on by default, the other session's memory fix). qwen3.8-27b via yibu; budget 100 actions, 1.2M reported tokens, 3600 s per run.

| Run | Actions | Levels | Tokens | End |
| --- | --- | --- | --- | --- |
| [ls20](../../runs/thin-sh-r3-ls20-20261010/summary.json) | 35 | 0 | 468,625 | `bridge_unavailable` at 17:47 (bridge close timed out) |
| ka59 (`runs/thin-sh-r3-ka59-20261010`) | 13 | 0 | — | stopped writing at 18:05; no summary, no process left |

Both runs ended from outside, as the round-2 runs did at 17:08. The cause is not known, so these are partial runs and say nothing about final performance.

Observations (adoption, not benefit):
- Frame comparison: both agents saved a history/grid diff skill after their second action, under the capability prompt with no directive. ls20 ran its `diff_grids` 5 times. The ledger's own observation runs of it failed 3/3, because those runs leave `history` out of skill state.
- ls20 repeated the earlier bar-filling failure (the 2026-10-09 thin-hyp runs took the move-budget bar as the goal): strategy `strat.accumulate_moves`, ACTION1/ACTION2 alternating from #5. One idea label covered 31 consecutive actions.
- Critic: 1 note (at #22), shown at the next decision, 3 triggers suppressed by the rate limit. Its first line corrected the agent's move count. The agent took that line ("the critic was right — I need 19 more moves") and kept the plan. The untested rival and the suggested action were not taken: the note confirmed the plan it was meant to question.
- Prediction surface: ls20 checked predictions on 0/35 actions while `expect` (free text) was written on 33/35. ka59 had 2/9. The two fields competed, and the free-text one won.
- ka59 is slow: about 2.5 minutes per action.

These observations are the input to §10.11.

### 10.11 Optimisation from the round-3 log (2026-10-10)

Each item names the failure it answers, the change, and how it is checked.

1. **One prediction surface.**
   - Failure: `expect` (free text, 33/35) displaced `predict` (checked, 0/35) in ls20 r3.
   - Change: `predict` gains `text` (kept for the ledger and critic, never parsed or scored, ≤300 chars). `expect` is removed from the `arc_action` schema.
   - A legacy `expect` argument, or a plain-string `predict`, is folded into `predict.text` at the tool boundary (`repairActionArguments`) instead of being dropped.
   - The ledger reads `predict.text` as the experiment's expectation; trajectory rows keep `expect` for the ledger, critic and runner statistics.
   - A text-only prediction gets no score row: `row.prediction` exists only when a field was checked.
   - `predict_skill` must return a checkable field (`cells`, `level_changed`, `state`); text alone is reported as "returned no checkable field".
   - Prompt: the services line describes `predict` as words plus checked fields. The ledger prompt says predict.text is kept next to what happened.
   - Expected effect (unverified): a model that writes what it expects now writes it in the place where checked fields sit, so adding one is a smaller step.
2. **The critic leads with challenges.**
   - Failure: the #22 note led with a count correction, which the agent read as endorsement.
   - Change in `CRITIC_SYSTEM`:
     - most important line first, chosen from: a competing idea stopped or never tested, a contradiction with memory, an unacted conclusion, a repeating action pattern;
     - when the current idea pays off far ahead, name the cheapest test of the same claim and compare its cost with the budget left;
     - do not correct counts or positions unless that changes the next action ("a correction of that kind makes a doubtful plan look sound").
3. **A review that was not acted on is said so, once.**
   - Change: when the 5 actions after a note all keep the note's idea label and none takes its suggestion, the next check raises a trigger: `the review at #N was not acted on: #N+1–#N+5 kept the idea "X" and did not try ACTIONk`.
   - It bypasses the minimum gap (it is raised at the fifth action, once), but not the per-level cap.
   - The runtime states this fact in its own words as the first line of the next note shown ("- Note: …").
   - The test is mechanical counting only: whether the review was right is not judged. Unlabelled actions do not count as keeping the idea.
   - `criticEffect` gains `idea_kept`.
4. **Budget left is visible to the services.**
   - Change: `budgetLeft` takes the tighter of the level and run budgets, as last reported. It is appended to the ledger IDEAS line and to the critic dossier.
   - This lets the critic compare a long plan with the actions that remain, which item 2 asks for.
5. **C1 paired run (ka59).** Not done. It needs a run budget and a slot that does not clash with the other session's runs.
6. **Partial summaries.**
   - Failure: the round-2 and round-3 runs killed from outside left no `summary.json` (ka59 r3: 13 actions, no statistics).
   - Change: the runner writes `summary.json` every 10 decisions with `"partial": true, "stop_reason": "running"`. The write is atomic (temporary file, then replace). The final write replaces it without `partial`.
   - The summary assembly is one helper, `_write_summary`. It does not change the runner's own record.

**Tests and smokes** (`runs/arc-thin-*-smoke-20261010-k2`, all passed):
- Node: 65/65. New or changed tests:
  - one prediction surface (plain string → text, expect fold, text precedence, text not scored);
  - schema keys include `text`;
  - default-services test (no `expect` in the schema, legacy expect lands in `row.expect`, text + `level_changed` is scored on one field);
  - ignored-review trigger (raised once at the fifth action, not when the suggestion was taken, the idea changed or labels are missing, per-level cap kept);
  - `budgetLeft` in the view and the dossier.
- pytest: 20/20, including a partial-then-final summary test.
- Ledger smoke, through real Pi argument preparation:
  - `long_legacy_expect_folded_and_clipped` (400 chars → 300 in `predict.text` and `expect`);
  - `plain_predict_kept_as_text_not_scored`.
- Self-harness, default and environment smokes unchanged and passing.
- Resident cost (default smoke, services pinned off): system prompt 3,818 chars (§10.9: 3,764; +54 from the longer prediction line); `arc_action` schema 1,114 (−28).

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass | node, pytest |
| Full-chain reachability | Pass for items 1, 6; items 2–4 only through unit tests (the scripted critic reply does not exercise the new instructions, and the smoke has no ignored review) | scripted provider, mock ARC SDK, real bridge / Pi / extension |
| Autonomous adoption (does `predict` with checked fields rise; does the agent act on an escalated review) | Unverified | — |
| Net benefit | Unverified | — |

**Next falsifiable check.** A real ls20 run on a fresh freeze of this tree, same budget as r3. Two claims would fail on this run:
- Item 1 fails if fewer than 10 of the first 35 actions carry a checked field.
- Items 2–3 fail if a note or an escalation is shown and none of the next 5 actions changes the idea or takes the suggestion.

The external kills must be explained or avoided first: two rounds have now ended early.

### 10.12 Counterexample-bound transition (P048 candidate, 2026-10-10)

- **Observed failure:** P047 (`P047-ls20-length-rescue-wired`, real official ARC, `yibu/qwen3.8-27b`) reached the real length-rescue path and produced five canonical actions, but no Skill/Prompt/Tool/Subagent candidate. The parent received a general optional opportunity and continued probing; after an action whose stated block-motion explanation was not supported, the next context did not explicitly bind that miss to hypothesis revision or a competing test. `game_won=false`, 0/7 levels, 160,289 known reported tokens plus one unknown/in-flight request. This is an observation; it does not prove the model would have adopted a component with stronger evidence.
- **Narrow claim:** when a structured prediction has a mechanically scored MISS, a short next-decision counterexample section will increase the chance that the parent records the affected test and changes or separates its explanation before repeating it, while leaving action authority and component choice with the Agent.
- **Burden removed:** the parent no longer has to infer from a long recent-action line that a falsifiable prediction failed; the runtime carries only the exact expected/observed fields. It does not compute frame differences, judge the goal, create a component, or add a mandatory review turn.
- **Implementation:** `demo/arc_thin_extension.ts` now renders `PREDICTION CHALLENGE` only for the latest scored miss and records its section size. `demo/prompts/arc_thin_system.md` tells the Agent to record a condition-scoped verdict, reject/narrow the affected claim, retain competing explanations, and consider a minimal history/prev-grid Skill when repeated calculation is the actual need. This remains advisory and non-gating.
- **Negative cases:** a hit produces no challenge; an unscorable field is not treated as a miss; a miss is explicitly not a goal verdict; a reasonable decision may still defer component creation. Cross-frame fields remain absent from the runtime surface, so any diff calculation must be Agent-authored.

**Local evidence:** Node self-harness/prediction/memory tests 30/30, lifecycle pytest 5/5, default offline thin self-harness smoke passed with the new `challenge` working-set section; `git diff --check` passed. The offline smoke demonstrates wiring only.

**Real-run protocol:** fresh real `ls20-9607627b`, treatment, official ARC bridge, `yibu/qwen3.8-27b`, ledger+critic enabled, thinking off, matched bounded run (20 actions, 1,200,000 reported-token cap, 1,800-second wall-clock cap, no more than 4 decisions without a consolidation). Audit the first scored miss, subsequent hypothesis verdicts/rivals, candidate creation/assembly/use, canonical actions, and unknown usage. This run tests autonomous adoption, not game-quality benefit.

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass | Node, pytest, offline real bridge/Pi/extension |
| Full-chain reachability | Unverified before the real run | official ARC bridge / Pi / real provider |
| Autonomous adoption | Unverified | real Qwen run required |
| Net benefit | Unverified | no matched quality comparison in this bounded diagnostic |

**Falsification:** if the challenge reaches the real provider but the parent repeats the contradicted explanation without recording a condition-scoped verdict, or if it records the verdict but still never changes/separates the next test, this factor does not close the transition. If the parent does revise/separate but still reasonably declines a component because no reusable calculation exists, that is a valid non-use and the next factor must address value recognition rather than add stronger reminders.

### 10.13 P048 result and prediction-boundary repair (2026-10-10)

P048 reached the real bridge, Pi parent, official ARC environment, and `yibu/qwen3.8-27b` with ledger and critic enabled. It stopped at the declared 1,800-second boundary after 8 canonical actions, 8 action decisions, 0/7 levels, and 309,007 known reported tokens; no usage was filled in for unknown requests. The run is a failed game outcome, but it supplied the targeted mechanism evidence:

- The Agent created `diff_grid` v1 from `history`/`prev_grid`, assembled it into three strategies, and ran it three times with semantically correct changed-cell results.
- After action #4's scored cells MISS, the next parent turn recorded `state.blocked_rule`, created `hyp.floor3`, and replaced the blocked route with A3→A3→A1.
- After action #7's `level_changed=true` and `state=FINISHED` MISS, the next turn abandoned `strat.solve`, rejected the socket/exit interpretations, created `strat.plus_test`, and tested the competing plus hypothesis at action #8. This is real competitive transition and semantic Skill use; it is not a WIN or net-benefit result.
- The first action's four-value diff tuples (`[x,y,before,after]`) were silently dropped by the prediction boundary. That is an interface compatibility defect: the Agent's own diff tool produced a valid after value, but the runtime discarded it before scoring. P049 accepts that agent-authored representation by retaining only its post-action value; it does not compute any diff itself.

| Layer | P048 status | Boundary repair status |
| --- | --- | --- |
| Functional correctness | Pass for challenge rendering and existing lifecycle tests | Pass after 10/10 Node prediction/self-harness tests and 5/5 lifecycle pytest |
| Full-chain reachability | Pass for challenge→memory→strategy→Skill use in the real run | Fresh real run required for four-tuple path |
| Autonomous adoption | Positive diagnostic evidence, not a Gate C acceptance run | Recheck whether four-tuples are scored and acted on |
| Net benefit | Unverified; game lost | Unverified |

P049's single factor is boundary compatibility. `normalizePrediction` and its schema accept `[x,y,before,after]` from an Agent-authored diff and normalize it to `[x,y,after]`; ordinary three-tuples remain unchanged, and no cross-frame field is added. The negative case is malformed tuples, which remain discarded. A fresh bounded real run must inspect provider payload, trajectory scoring, and later behavior before this repair is retained.

**P049 real result:** official ARC / real `yibu/qwen3.8-27b`, same `ls20-9607627b`, treatment, ledger+critic, 12-action and 1,200-second bounds. It stopped at the deadline after 3 canonical actions, 0/7 levels, and 90,074 known reported tokens plus an incomplete request. The parent created and used `diff_grids` v1 and all submitted predictions were ordinary three-tuples; no four-tuple reached the live trajectory, so the new compatibility branch remains locally verified but real-provider reachability is unverified. The run is retained as a diagnostic failure and does not establish game benefit. P048 remains the evidence for autonomous counterexample handling; P049 neither strengthens nor weakens that claim.

### 10.14 Goal claims after a legal move (2026-10-10)

- **Observed symptom:** In P048, the parent inferred that placing the moving 5x5 object into a visually matching 3-slot would WIN. The move was mechanically successful, but action #7 returned `level_changed=false` and `state=NOT_FINISHED`. The next turn did revise the goal and test the plus hypothesis, so this is a demonstrated failure mode with a successful recovery, not evidence that the existing counterexample transition is absent. P049 did not reach a goal test: it stopped after three control probes.
- **Narrow claim:** A short goal-specific reminder will reduce the chance that a legal placement or pattern match is promoted to a WIN claim without an independent terminal discriminator, while leaving the Agent free to choose the goal and action.
- **Burden removed:** The parent need not infer from the generic prediction warning that movement evidence and goal evidence are different. The runtime still does no semantic goal judgment and does not block actions.
- **One factor changed:** `demo/prompts/arc_thin_system.md` adds a paragraph that applies only before a predicted WIN: keep a live competing goal explanation, name its cheapest discriminator, and after a missed WIN reject/narrow the claim and take that discriminator rather than repeat the route.
- **Negative case:** ordinary movement predictions and actions without a WIN claim receive no new step; a legal move may still be useful evidence; a reasonable goal with no accessible rival remains an explicitly unverified hypothesis rather than an automatic rejection.
- **Local checks:** the existing prediction/self-harness and lifecycle suites remain the diagnostic check; a fresh real `ls20` run is required for provider adoption.

| Layer | Status before next run | Evidence |
| --- | --- | --- |
| Functional correctness | unverified for this prompt-only factor | existing prompt and extension tests |
| Full-chain reachability | unverified | real official ARC run required |
| Autonomous adoption | unverified | inspect first predicted-WIN action and next turn |
| Net benefit | unverified | no matched quality/cost comparison |

**Prospective falsifier:** if the new paragraph is present in the provider input and the parent again predicts WIN from a legal placement without a competing goal/discriminator, or repeats the same route after a missed WIN, this factor is rejected; if no predicted-WIN event occurs, coverage remains untested rather than passing.

### 10.15 Replacement goals must remain competitive (P050 result and next factor, 2026-10-11)

- **Observed result from P050:** the §10.14 prompt reached the real provider and changed behavior at the first goal counterexample. After action #9 predicted `WIN` but returned `NOT_FINISHED`, the parent recorded the condition-scoped test, rejected `hyp.goal_dot`, created `hyp.goal_maroon`, and changed the route. This closes the specific transition “missed WIN → reject the claim → change the next route” for this run.
- **Remaining failure:** the replacement was the only open goal hypothesis. The memory receipt explicitly reported `hyp.goal_maroon [open] (no recorded rival for "goal")`; its `next_test` was a 6-action route to the top box, and the parent spent actions #10–#12 on that route without an intermediate goal discriminator. The route was mechanically predicted correctly, but the run hit the 1,800-second deadline at 12/20 actions and 0/7 levels. This is evidence about competitive coverage and latency, not proof that the top box target was wrong.
- **Narrow claim:** after a goal claim is rejected, a short prompt reminder to preserve a different open goal explanation and test it at the cheapest intermediate observation will reduce commitment to a single untested replacement target, without runtime goal judgment or action gating.
- **Burden removed:** the parent need not infer from the generic “keep a rival” rule that a newly promoted replacement is itself provisional. The runtime still does no semantic target inference, creates no hypothesis, and does not block a chosen action.
- **One factor changed:** `demo/prompts/arc_thin_system.md` adds one paragraph after the missed-WIN rule. It asks for a different open goal explanation before a replacement route, treats that route as evidence gathering until an intermediate discriminator, and provides an explicit `other target/transition` fallback when no concrete rival is yet plausible.
- **Negative cases:** no goal claim is rejected; no concrete rival is available and the Agent records the fallback; a short route whose first action is itself the cheapest discriminator; or a justified decision to keep exploring mechanics. These cases do not establish adoption failure.
- **P050 harness evidence:** 1 Skill (`diff_grids v1`) was created and run twice with semantic changed-cell results; 25 hypothesis writes, 18 evidence rows, 6 refutations; `goal_dot` was rejected and `goal_maroon` remained open; critic produced 0 notes. No new Skill was warranted because the repeated calculation was already captured by `diff_grids`.

| Layer | P050 result / next status |
| --- | --- |
| Functional correctness | Unverified for this prompt-only factor; existing prompt, prediction and lifecycle checks remain the diagnostic baseline |
| Full-chain reachability | P050 passed through official ARC bridge, Pi parent, ledger, critic, Skill creation/use, prediction scoring, memory revision and later parent turns; the new paragraph itself needs a fresh real run |
| Autonomous adoption | Partial positive: counterexample transition adopted; replacement-goal competition failed to remain open |
| Net benefit | Unverified; P050 ended at deadline, 0/7 levels, 12/20 actions, 287,652 reported tokens |

**Next real check:** use the same official `ls20`/`yibu/qwen3.8-27b` treatment protocol with ledger and critic enabled, and inspect whether a missed-WIN replacement keeps two goal rivals and performs an intermediate discriminator before a multi-action route. Do not treat the prompt's presence, a saved hypothesis, or a correct mechanical route as success. If the provider again records only one open replacement or spends the route without a discriminator, revise this factor rather than adding another reminder.

**P051 result:** the changed prompt reached the real official bridge and provider. After four control probes and the first consolidation, the parent kept three open goal hypotheses (`hyp.g_pocket`, `hyp.g_marker_target`, `hyp.g_match`) and assembled a pocket-probe strategy that checked state after each move. It created and semantically used `diff_actions v1`; the first pocket move at action #6 produced a scored cell MISS and the next working set exposed the challenge. The run then hit the 1,800-second deadline while waiting for the parent turn that should have recorded the MISS and revised the route: 6/20 actions, 0/7 levels, 199,595 reported tokens, critic notes 0. This supports autonomous replacement-rival creation and Skill use, but leaves post-MISS revision and net benefit unverified. The repeated deadline is now a separate lifecycle bottleneck: the next experiment must bound or continue parent output so that a scored counterexample can reach a later action; changing the goal prompt again would confound that check.

### 10.16 Parent-turn latency as a separate reachability factor (P052 protocol, 2026-10-11)

- **Observed bottleneck:** P050 and P051 both ended at the 1,800-second deadline while waiting for the next Pi parent turn, before the latest scored counterexample could be acted on in P051. P051 produced 6 actions and 199,595 reported tokens; the final pending turn had no action or recovery record. This prevents judging the post-MISS transition even though the prompt and harness state were present.
- **Narrow claim:** lowering the per-response parent output cap from the provider-default 65,536 to 16,384, with the same prompt, task, total token cap and deadline, will increase the number of completed parent turns after a scored MISS without breaking structured `arc_action` reachability.
- **Burden removed:** a single parent response cannot consume most of the wall-clock budget in hidden reasoning; the Agent still owns hypothesis choice, Skill use and action selection. This is a reachability experiment, not a quality claim.
- **One factor changed:** only `--max-output-tokens 16384` changes in P052; source, provider, game, ledger, critic, action budget, total reported-token cap and 1,800-second deadline remain P051-compatible.
- **Negative cases:** a length stop, malformed/incomplete tool call, fewer completed turns, or a scored counterexample still not followed by a later parent action falsifies the claim. A shorter response that simply harms game quality does not establish net benefit.
- **Protocol:** official ARC bridge, `ls20`, treatment, `yibu/qwen3.8-27b`, thinking off, 20 actions, 1,200,000 reported tokens, 1,800 seconds, consolidation every 4 actions, ledger and critic enabled. Record usage stop reasons, action count, first scored MISS and whether a subsequent parent turn revises the affected hypothesis and changes action/strategy.

| Layer | P052 status before run |
| --- | --- |
| Functional correctness | Existing runner and action-boundary tests pass; per-response cap path requires the real run |
| Full-chain reachability | P050/P051 bridge and self-harness path passed; cap-specific reachability unverified |
| Autonomous adoption | P051 positive before the MISS, post-MISS unverified due deadline |
| Net benefit | Unverified; this bounded run is a reachability diagnostic, not a matched quality comparison |

### 10.17 Atomic hypothesis replacement input (P052 result and P053 factor, 2026-10-11)

- **Observed failure:** P052's parent correctly tried to replace stale control hypotheses with a new creature-based control set and new goal rivals. Its single memory batch contained 11 hypothesis entries, including entries intended to be deleted. The tool schema rejected the batch at `maxItems=8` before the memory planner could apply the deletes; a follow-up strategy call then referenced hypotheses that had never been created. P052 ended with 4 memory errors, 3 Skill errors, 3 actions and 0/7 levels.
- **Narrow claim:** allowing an atomic replacement request to carry up to `2 * MAX_HYPOTHESES` entries, while retaining the resident `MAX_HYPOTHESES=8` check in `planMemoryUpdate`, will let the Agent replace old rivals and create new rivals in one authorized call and reduce schema-induced retries.
- **Burden removed:** the Agent does not have to split one semantic change into fragile delete-then-create rounds or predict which entries the boundary will validate before deletion. No hypotheses are silently dropped and no resident/context cap is increased.
- **One factor changed:** `demo/arc_thin_extension.ts` changes only the `memory.hypotheses` input schema from `maxItems: MAX_HYPOTHESES` to `maxItems: MAX_HYPOTHESES * 2`; the committed-state cap and all prompt, provider and action behavior remain unchanged.
- **Negative cases:** a batch whose post-delete state still exceeds 8 remains refused by `planMemoryUpdate`; malformed hypotheses remain refused; a real run with no replacement opportunity cannot establish the claim.
- **Local checks:** run the memory/boundary suites and an offline self-harness smoke; specifically verify that a replacement batch over 8 input entries can be normalized and that the resident state remains capped.
- **P053 protocol:** official ARC bridge, `ls20`, treatment, `yibu/qwen3.8-27b`, thinking off, `max-output-tokens=16384`, 20 actions, 1,200,000 reported tokens, 1,800 seconds, consolidation every 4 actions, ledger and critic enabled. Inspect whether the replacement batch is accepted, memory/tool errors fall, a later action follows the revised hypotheses, and whether any game/level progress changes. This is a self-harness reachability test, not a net-benefit claim.

| Layer | P053 status before run |
| --- | --- |
| Functional correctness | Unverified for the wider input schema; resident cap logic already covered by memory tests |
| Full-chain reachability | P052 reached real provider/bridge and exposed the pre-execution rejection; P053 must exercise the repaired path |
| Autonomous adoption | P052 attempted the replacement autonomously; it was blocked by schema friction |
| Net benefit | Unverified; no performance or game-quality conclusion is authorized |

### 10.17 Goal-test coverage and latest Skill receipts (implementation, 2026-10-11)

- **Observed opportunity:** The latest real-run diagnosis separates two remaining costs. A wrong goal can consume many actions before any structured `level_changed=true` or `state="WIN"` prediction tests it; meanwhile the ledger already runs each Agent-authored Skill on observed states but the parent sees only the Skill directory, so stale or failed outputs are easy to miss. P052 is an earlier latency-cap run and does not contain this change; its source hash is retained in its run configuration.
- **Narrow claims:** (1) a compact mechanical ledger/dossier line showing explicit goal checks, goal hypotheses whose evidence has no matching check, and idea effort spans without a level/WIN check will make the cheapest untested goal experiment visible to the critic and parent; (2) showing the latest automatic output or failure for each current Skill will reduce repeated manual recalculation and expose stale components without adding a read turn.
- **Mechanism:** `demo/arc_thin_ledger.ts` counts only structured `predict.level_changed=true` or `predict.state="WIN"`; it does not parse free text or judge goals. `demo/arc_thin_critic.ts` receives the same line and is instructed to name a cheapest goal check when effort is untested. `demo/arc_thin_extension.ts` renders the most recent per-version Skill observation, including failures, in every treatment working set where one exists. The Agent still decides whether to create, use, revise, or retire a Skill and which goal is correct.
- **Negative cases and cost:** ordinary movement predictions do not count as goal checks; text-only predictions do not count; a stale/error receipt is displayed as feedback rather than success; no action or component is gated. The additional working-set sections are bounded and omitted when empty.
- **Local checks:** Node ledger/self-harness/prediction suites 20/20, lifecycle pytest 5/5, `git diff --check`, plus the existing offline self-harness and ledger smokes. These prove function and deterministic wiring only.

| Layer | Status before a fresh real run |
| --- | --- |
| Functional correctness | Pass for local unit/integration checks |
| Full-chain reachability | Unverified for the new ledger line and Skill-output section with a real provider |
| Autonomous adoption | Unverified; inspect critic use, goal-test decisions, and later Skill use |
| Net benefit | Unverified; needs a correctly budgeted matched or held-out run |

**Next bounded check:** use a fresh source snapshot after P052, with enough actions and wall-clock for level 1 (the proposed 150 actions / 2 hours / 3M reported tokens is suitable if approved), then inspect levels/actions per level, first goal prediction and its result, critic response, and semantic Skill output use. The old P048 20-action/1,800-second run is diagnostic only because its settings made level 1 unreachable.

### 10.18 Provider-length recovery for parent reviews (P053 result and P054 factor, 2026-10-11)

- **Observed failure:** P053 exercised the widened atomic hypothesis input without memory/schema errors, but the first four-action consolidation consumed the provider output limit before its required memory call. The next three ordinary parent turns also stopped at `length`; no action followed, and the run reached the 1,800-second deadline with 4 actions, 0/7 levels, one incomplete consolidation and 175,898 reported tokens. The persistent working set remained valid, but the live Pi session kept retrying the same overlong context.
- **Narrow claim:** when a parent turn ends with provider `stopReason=length`, rotating only the native Pi model session and issuing a short recovery instruction that requires one memory call (for consolidation) or one `arc_action` (for ordinary play) will convert at least one such boundary into a completed lifecycle transition within the same ARC run, without losing the durable harness state.
- **Burden removed:** the parent does not have to reconstruct a long interrupted deliberation or spend repeated turns explaining it. The extension-owned memory, observations, trajectory and working set remain authoritative; the fresh model session receives the normal rebuilt context and a single immediate next step.
- **One factor changed:** `src/autoresearch_pi/arc_thin_e2e.py` now detects native message `stopReason=length`, records the event, rotates the Pi session, and sends a bounded recovery prompt. The consolidation prompt is also shortened so the first tool call can be emitted before hidden reasoning exhausts the provider budget. No game rule, hypothesis schema, or action boundary changed.
- **Negative cases:** if the provider never emits `length`, this path is inert; if the recovery also stops at `length`, the run records the failed recovery rather than looping indefinitely; a recovered memory call or action proves reachability only, not autonomous adoption quality or game improvement.
- **P054 protocol:** official ARC bridge, `ls20`, treatment, `yibu/qwen3.8-27b`, thinking off, 20 actions, 1,200,000 reported-token cap, 1,800-second cap, consolidation every 4 actions, ledger and critic enabled, `max-output-tokens=16384`. Inspect `length_stops`, `length_recoveries`, whether consolidation writes memory, whether a post-recovery action occurs, and whether autonomous components remain semantically used. Preserve P053 as the negative diagnostic.

| Layer | P053 result / P054 status |
| --- | --- |
| Functional correctness | Local Python compile plus existing lifecycle/smoke suites; recovery path requires targeted runner check |
| Full-chain reachability | P053 reached official bridge and provider but stalled at parent length; P054 must exercise native session rotation and durable-state rebuild |
| Autonomous adoption | P053 showed Skill and hypothesis adoption before the stall; post-length continuation unverified |
| Net benefit | Unverified; the bounded run is a lifecycle diagnostic, not a game-quality comparison |

**P054 partial result:** the real provider completed one action and one follow-up `skill`/`run_skill` batch (23,627 reported tokens), then remained in the same parent turn without a new usage row, `length` stop, or action for more than the usable observation window. The owned bridge/Pi processes were stopped and a `partial-summary.json` was written; no canonical bridge close was claimed. This is a distinct provider/parent hang after a non-action tool result, so it neither passes nor falsifies the length-recovery claim. A short real diagnostic with a lower per-response cap is needed to force a scored `length` boundary before spending another 1,800-second run.

### 10.19 Bounded real length-boundary diagnostic (P055, 2026-10-11)

P055 is a diagnostic of the same recovery path, not a matched game-quality comparison: official `ls20` bridge, real `yibu/qwen3.8-27b`, treatment, ledger+critic, thinking off, 4-action cap, 1,200,000 reported-token cap, 600-second wall-clock cap, consolidation every 2 actions, and `max-output-tokens=4096`. The purpose is to observe a native `length` event and whether the fresh-session recovery commits one memory call or one action; if the provider hangs before emitting a terminal event, preserve the partial log and stop without claiming recovery.

### 10.20 Bounded recovery for a provider turn with no terminal event (P054 factor, 2026-10-11)

- **Observed failure:** P054 completed one action and a follow-up `skill`/`run_skill` batch. Pi then emitted a new assistant `message_start` after the tool result but no subsequent `message_end`, `turn_end`, `agent_end`, or usage row. The thin runner waited in the same parent turn until its long decision timeout; the owned processes had to be stopped and only a partial summary could be written. This is distinct from provider `stopReason=length` and is not fixed by the P055 session-rotation path.
- **Narrow claim:** when a real Pi turn emits no event for a bounded idle interval, one abort plus fresh-session recovery will prevent that non-action turn from consuming the remainder of the ARC wall-clock budget, preserve already committed bridge/harness state, and allow at least one later lifecycle operation; repeated idle recovery is capped so a faulty provider cannot loop indefinitely.
- **Burden removed:** the runner no longer treats a silent provider/Pi request as an unobservable 900-second decision. The Agent still owns the choice between a memory update and the next action; the runner only bounds transport/lifecycle waiting and rotates in-memory model context.
- **One factor changed:** `PiKernel.wait_for_agent_events` accepts an opt-in idle timeout and reports `PiTurnIdleTimeout`; thin ARC uses a 180-second default (configurable as `--turn-idle-timeout`), performs at most two abort/session recoveries per run, and records timeout/recovery/failure counts. No ARC action schema, hypothesis rule, critic trigger, or game prompt was changed.
- **Negative cases:** normal provider responses that emit events inside the interval remain unchanged; a timeout after a committed action must not replay that action; an abort or recovery that fails is recorded and stops the run; a recovered turn proves lifecycle reachability only, not game quality or net benefit.
- **Local checks:** targeted idle-timeout unit test, action-settlement native test, lifecycle stats tests, Python compile and `git diff --check`. A fresh real `ls20` run must inspect whether the P054 event signature is bounded, whether a later action/memory operation follows, and whether any duplicate action or unknown-action event appears.

| Layer | Status before P056 | Evidence boundary |
| --- | --- | --- |
| Functional correctness | Pass for the local idle exception and bounded runner path | Tests cover detection and existing native settlement; real provider behavior remains open |
| Full-chain reachability | P055 passed length continuation; P054 silent-turn recovery untested | Requires official bridge, Pi, provider, durable state and a later parent turn |
| Autonomous adoption | Unverified | Recovery prompt is runner-issued diagnostic assistance, not autonomous harness creation |
| Net benefit | Unverified | Requires comparable real runs with parent-plus-child cost and task outcome |

### 10.21 Critic completion latency and visible feedback (P050/P051 factor, 2026-10-11)

- **Observed failure:** P050 and P051 recorded per-action critic checks, but no critic note, failure, or usage row before the runs stopped. Older runs show that the trigger path can produce notes; the current signature is an in-flight review that outlives the short run. The extension starts the critic asynchronously, waits only 3 seconds before the next parent context, permits up to 8,000 output tokens and 240 seconds, and has no final wait when Pi closes.
- **Narrow claim:** bounding the critic request to the four cited lines it is asked to produce (2,000 output tokens and 60 seconds) will make a triggered review complete and become visible in a later parent decision more often, without blocking ordinary decisions on an unbounded reviewer.
- **Burden removed:** the parent no longer spends an entire short run with a review that exists only as a `check` record; the critic remains advisory and does not gate actions. The request budget is reduced to match its semantic output, rather than adding a mandatory parent turn.
- **One factor changed:** only `DEFAULT_CRITIC.maxOutputTokens` and `timeoutMs` changed from `8000/240000` to `2000/60000`; trigger thresholds, dossier, parser and parent prompt remain unchanged.
- **Negative cases:** a provider that cannot complete within 60 seconds records a failed review and remains advisory; a note with no valid action citations is not shown; no note in a run with no trigger is evidence against the claim.
- **P058 diagnostic protocol:** official `ls20`, real `yibu/qwen3.8-27b`, treatment, ledger+critic, thinking off, `max-output-tokens=4096`, 8 actions, 600-second cap, consolidation every 2 actions, and a 120-second turn-idle cap. Use the existing trigger thresholds unless the run has no eligible trigger; record checks, notes, failures, usage, shown decision, and total parent/critic cost separately.

| Layer | Status before P058 | Evidence boundary |
| --- | --- | --- |
| Functional correctness | Local TypeScript/critic tests required | Defaults only; no parser or trigger semantics changed |
| Full-chain reachability | Trigger path exists in older real runs | P058 must show a current provider note and later parent exposure |
| Autonomous adoption | Unverified | A shown note is exposure; subsequent action change must be audited separately |
| Net benefit | Unverified | Needs matched quality/cost comparison; critic completion alone is not benefit |

### 10.22 History-aware automatic observation for agent-authored Skills (P058 result, 2026-10-11)

- **Observed failure:** P058's provider successfully saved and manually ran `diff v1`, but the ledger recorded three automatic observation errors because the skill reads `state['history']` while the automatic observer intentionally supplied `skillState(false, false)`. The parent then saw a latest-skill failure even though the agent's explicit run was valid. This is a broken runtime-to-tool evidence transition, not a tool-authorship failure.
- **Narrow claim:** when an agent-authored Skill explicitly references the foundation `history` API, supplying the bounded history snapshot during automatic observation will remove this false failure and preserve successful semantic output, without adding history to unrelated Skills.
- **Burden removed:** the parent does not have to diagnose a runtime-created `KeyError` or re-save a correct history tool merely to make the ledger observe it. The Agent still decides the Skill's algorithm and explicit arguments; the runtime only provides the API it already documents.
- **One factor changed:** `observeState` now detects `history` references in each saved Skill and reuses one `buildHistory` snapshot for those observations; non-history Skills keep the previous lightweight state. Follow-up inspection found the save-time `backfillSkill` path still omitted the same API, so it now injects the bounded history snapshot there too. Non-history Skills keep the previous lightweight state. No Skill schema, history semantics, action boundary, or prompt changed.
- **Negative cases:** a history Skill with invalid arguments can still fail its automatic run; a Skill that hides a required dependency without referencing `history` is not inferred; automatic success remains diagnostic and does not prove the parent will use the Skill.
- **Local checks:** self-harness, critic, lifecycle and idle recovery tests pass. A fresh real run must inspect observation errors, explicit `skill_runs`, and whether the history output affects a later action.

| Layer | Status after P058/local fix | Evidence boundary |
| --- | --- | --- |
| Functional correctness | Pass for existing native self-harness tests, bounded history selection, and a focused backfill/current-observation fixture | New real observation path still needs a real run |
| Full-chain reachability | P055/P058 showed agent Skill creation and explicit use; automatic history observation was false-failing | Real provider follow-up required |
| Autonomous adoption | Unverified | A clean observation does not imply later semantic use |
| Net benefit | Unverified | Compare parent cost, errors and task outcome against P058/old observer |

### 10.23 Provider-serialized memory lists at the tool boundary (P059 result, 2026-10-11)

- **Observed result:** P059 verified the history-aware observer in the real official bridge: `diff_history v1` was created, automatically evaluated four times with `ok=4/error=0`, and its source used `state['history']`. The same run still recorded two memory tool errors. One was a provider `length` truncation before a complete call; another complete call supplied `strategies` as a JSON string and was rejected by the runtime schema even though `repairMemoryArguments` can normalize that shape. The failed strategy batch was therefore not committed. The Skill was never explicitly run (`skill_runs=0`), so automatic observation remains diagnostic rather than autonomous semantic use.
- **Narrow claim:** accepting JSON-string forms for the five top-level memory list fields at the public schema boundary, followed by the existing repair hook, will eliminate schema-only format refusals while preserving the same atomic commit semantics for valid normalized input.
- **Burden removed:** the Agent need not spend a recovery turn re-encoding a complete array after a provider serializes it as a string. Truncated or semantically invalid content still fails; no memory row is invented.
- **One factor changed:** `set`, `delete`, `hypotheses`, `tests`, and `strategies` now accept either their structured array or a bounded string compatibility branch; `repairMemoryArguments` remains the normalizer. No lifecycle rules, caps, or prompt guidance changed.
- **Negative cases:** an unparseable string remains invalid; a provider response cut off at `stopReason=length` is still a transport failure; semantic memory validation still rejects invalid entries atomically.

| Layer | Status after P059 / local schema change |
| --- | --- |
| Functional correctness | Local memory/self-harness suites 36/36 pass; real schema acceptance needs a fresh provider run |
| Full-chain reachability | History observation passed P059; serialized-list path remains to be verified in production |
| Autonomous adoption | `diff_history` creation positive, explicit semantic use unverified (`skill_runs=0`) |
| Net benefit | Unverified; P059 ended 0/7 levels, 150,254 reported tokens, 601.7s |

**P060 result:** the first real provider memory call supplied both `hypotheses` and `strategies` as JSON strings. With the compatibility branch, the call committed, `tool_errors.memory=0`, and the normalized hypotheses/strategy appeared in `memory.jsonl`. This is positive full-chain functional evidence for the schema repair. P060 still created no Skill and reached 0/7 levels after 4 actions, so it says nothing about autonomous Skill adoption or ARC quality.

**Next falsifiable check:** a fresh bounded official `ls20` run after the wording change. Inspect whether a history Skill is explicitly run after creation separately from automatic observation.

### 10.24 Distinguish automatic Skill diagnostics from semantic use (P059 result, 2026-10-11)

- **Observed failure:** P059's `diff_history v1` was automatically evaluated successfully four times, but `skill_runs=0`. The parent later reasoned from the automatically rendered diff while never calling `run_skill`; the existing wording (“inspect before repeating a calculation”) did not mark automatic observation as non-semantic. This is an adoption-accounting and discoverability gap, not evidence that the Skill runtime failed.
- **Narrow claim:** labeling automatic Skill observations as diagnostic-only in both the Skill directory and working-set section, and explicitly stating that a result used for a claim/action requires `run_skill`, will increase the chance that a newly saved reusable Skill is explicitly invoked before the next dependent action without making invocation a hard gate.
- **Burden removed:** the Agent no longer has to infer whether an automatic ledger receipt counts as its own calculation. The Agent still chooses whether the Skill is useful, and may reasonably decline it.
- **One factor changed:** only the treatment working-set text and system prompt wording changed; automatic observation, Skill execution, action authority, and lifecycle semantics are unchanged.
- **Negative cases:** a Skill can remain unused when its output is not needed; automatic observation still catches syntax/runtime failures; a prompt phrase alone is exposure, not autonomous adoption or task benefit.

| Layer | Status before a fresh run |
| --- | --- |
| Functional correctness | Local self-harness/memory suites 26/26 pass |
| Full-chain reachability | P059 proved history observation; explicit-use path already exists but did not occur in P059 |
| Autonomous adoption | Unverified for the revised wording; require `skill_runs` and downstream use |
| Net benefit | Unverified; P059 remained 0/7 levels and 150,254 reported tokens |

**Next falsifiable check:** one bounded real `ls20` run after this wording change. A newly created Skill followed by no `run_skill` remains an adoption miss; a successful call whose result changes a later memory/action is positive diagnostic evidence, not a Gate D quality result.

### 10.25 Provider output envelope as a single-factor lifecycle diagnostic (P061 result and P062 protocol, 2026-10-11)

- **P061 coverage result:** the revised automatic-observation wording was not reached by the real provider: the run stopped after 2 actions with `skill_versions_saved=0`, `skill_runs=0`, 4 `length_stops`, 4 recoveries, 2 recovery failures, one memory error, 112,545 reported tokens, and 601.7 seconds. This is an exposure miss caused by the parent lifecycle boundary, not evidence against the wording.
- **Observed failure:** P059/P060/P061 repeatedly spend their short `ls20` runs at provider `stopReason=length`; session recovery records lifecycle activity but often does not reach a later action or Skill creation. The current 4,096-token per-response envelope is therefore a plausible transport bottleneck, while changing prompts and task rules would confound the diagnosis.
- **Narrow claim:** reducing only the configured provider output envelope to 2,048 tokens will allow at least one additional settled parent lifecycle operation (action or harness mutation) after the first length boundary within the same bounded run, without increasing duplicate actions or transport errors.
- **Burden removed:** a single parent deliberation has less opportunity to consume the whole bounded decision window before emitting its required tool call. The Agent still chooses actions and components; the runner only supplies a smaller provider envelope.
- **One factor changed:** P062 changes `max_output_tokens` from 4,096 to 2,048. Game, model, thinking mode, ledger/critic defaults, prompts, recovery logic, action cap, idle timeout, consolidation cadence, and wall-clock/token caps remain those of P061.
- **Protocol:** official ARC bridge, real `yibu/qwen3.8-27b`, `ls20`, treatment, ledger and critic enabled, thinking off, 4 actions, 500,000 reported-token cap, 600-second cap, consolidation every 2 actions, 120-second idle timeout. Record actions, levels, length stops/recoveries, memory/Skill/critic evidence, and parent-plus-child reported usage.
- **Negative cases:** fewer output tokens can truncate a useful response or reduce game quality; a normal response with no `length` event is not a test of the claim; an additional action proves lifecycle reachability only. No ARC score or self-harness adoption gain is claimed without the corresponding semantic evidence.

| Layer | P061 status / P062 evidence boundary |
| --- | --- |
| Functional correctness | Existing local recovery and schema/self-harness checks pass; the smaller envelope is a configuration diagnostic |
| Full-chain reachability | P061 stalled before the revised Skill wording; P062 must show whether a later action or harness mutation is reachable |
| Autonomous adoption | Unverified; inspect creation, explicit `run_skill`, and downstream use separately from automatic observation |
| Net benefit | Unverified; compare task progress and parent-plus-child cost only after a matched quality sample |

### 10.26 Length recovery must preserve the assembled-to-used Skill transition (P062 result and P063 protocol, 2026-10-11)

- **Observed failure:** P062 reached real Agent-authored assembly: `diff_grids v1` was saved, its automatic diagnostics were `ok=3/error=0`, and the parent recorded three competing hypotheses plus an active strategy. It then hit six length boundaries and four failed recoveries; `skill_runs=0`, `runs_of_skills_reading_history=0`, only 2 actions completed, and the run stopped on `no_action_streak` after 509.1 seconds. The recovery prompt required an immediate `arc_action`, while `run_skill` is an ends-batch tool that must be used in a separate assistant message. The lifecycle failed at assembly → semantic use, not at Skill creation or automatic observation.
- **Narrow claim:** allowing the length-recovery prompt to choose one explicit `run_skill` call when a saved Skill is present and has not yet been semantically run will produce a real `skill_runs` row in at least one such recovery without changing ordinary action selection or counting automatic observation as use.
- **Burden removed:** a provider-truncated turn no longer forces the Agent to choose between the recovery instruction and the newly available Skill tool. The Agent still decides whether the Skill is relevant in ordinary turns; the recovery branch only offers the missing lifecycle continuation after transport failure.
- **One factor changed:** `DECIDE_RECOVERY_PROMPT` now permits exactly one `run_skill` call for an unrun saved Skill; otherwise it retains the previous one-`arc_action` recovery. No tool schema, automatic observer, normal system prompt, action budget, model, or game configuration changed.
- **P063 protocol:** official ARC bridge, real `yibu/qwen3.8-27b`, `ls20`, treatment, ledger and critic enabled, thinking off, 4 actions, 500,000 reported-token cap, 600-second cap, consolidation every 2 actions, 120-second idle timeout, `max_output_tokens=2,048`. Inspect explicit `skill_runs`, downstream memory/action use, duplicate actions, length recovery counts, and task progress. Any recovery-forced run is diagnostic evidence of lifecycle reachability, not ordinary autonomous adoption.
- **Negative cases:** if no Skill is saved, recovery remains action-only; if a saved Skill is irrelevant, forcing its use would be a burden and counts against the claim; a `skill_runs` row without a later decision that uses its output is only partial semantic-use evidence. No task-quality or net-benefit claim follows from this probe.

| Layer | P062 result / P063 evidence boundary |
| --- | --- |
| Functional correctness | Local prompt/module syntax and existing recovery tests required; no semantic tool change |
| Full-chain reachability | P062 proved creation/automatic observation but not explicit use; P063 must cross the recovery-to-run_skill boundary |
| Autonomous adoption | Diagnostic only when recovery prompt causes the call; ordinary-turn use remains unverified |
| Net benefit | Unverified; P062 reached 0/7 and no quality comparison exists |

### 10.27 P063 opportunity censoring and P064 follow-up

- **P063 result:** the recovery-prompt change was not causally testable in this sample. The run reached 4/4 actions and 0/7 levels, then saved `diff_actions v1` at the terminal action boundary; no later parent turn existed to exercise the new branch. `skill_runs=0` therefore records right-censoring at the action cap, not a prompt failure. The run had 7 length stops/recoveries, 4 failed recoveries, 150,483 reported tokens, 569.8 seconds, one memory tool error, and no critic note.
- **Follow-up boundary:** preserve the recovery prompt and increase only the diagnostic action window to 8 so a Skill saved before the terminal boundary can reach a later parent turn. This is a reachability probe, not a quality comparison with the 4-action P062/P063 samples; report the budget change explicitly and do not infer net benefit.
- **P064 protocol:** same official bridge, provider/model, `ls20`, treatment, ledger/critic, thinking off, `max_output_tokens=2,048`, 500,000 reported-token cap, 600-second cap, consolidation every 2 actions, and 120-second idle timeout; only `max_actions=8` changes from P063. Inspect the first Skill-save action, the following recovery prompt, `skill_runs`, automatic observations, the next action's semantic use, and total parent-plus-child cost.

| Layer | P063 interpretation / P064 boundary |
| --- | --- |
| Functional correctness | Recovery prompt is syntactically covered; no production Skill-use crossing yet |
| Full-chain reachability | P063 right-censored after Skill creation; P064 must provide a later parent turn |
| Autonomous adoption | If recovery causes `run_skill`, classify as diagnostic adoption, not ordinary autonomous behavior |
| Net benefit | Unverified; max-actions change makes quality/cost comparison invalid |

### 10.28 History transition ergonomics after P064 (P064 result and P065 protocol, 2026-10-11)

- **Observed failure:** P064 reached explicit semantic use six times, but the first three Skill versions failed because the Agent authored `h.transitions()[n-1].action` while the guest exposed plain dictionaries. The fourth version had to introspect the row type/keys before the fifth version returned useful diff output. Automatic observations recorded 8 successes and 9 errors; `skill_runs=6` included 3 failures. The failure is at foundation API ergonomics and consumes multiple authoring/use turns, not at Agent willingness to create or run a Skill.
- **Narrow claim:** making each history transition support both documented mapping access (`row['action']`) and common attribute access (`row.action`) will let an otherwise valid authored Skill cross its first semantic run without an avoidable API-shape failure, while preserving JSON/dict behavior.
- **Burden removed:** the Agent need not spend revisions discovering whether a transition is a dict or object. The history API remains a foundation; it still computes no frame difference or goal interpretation.
- **One factor changed:** the guest `_History` wraps transition dictionaries in a dict-compatible `_Transition` with `__getattr__`. No grid reconstruction, history fields, Skill limits, recovery behavior, or action boundary changed; the exposed API wording documents the compatibility form.
- **Local checks:** self-harness suite passes 6/6, including an attribute-style transition run; Python compile and `git diff --check` pass.
- **P065 protocol:** repeat a bounded official `ls20` run with the P064 8-action window and P064 provider settings after this API change. Inspect first-version Skill run errors, successful explicit output, revision count, downstream action/memory use, and task outcome. A lower error count supports API reachability; it does not prove autonomous task benefit.
- **Negative cases:** malformed Skill source, wrong grid indices, unsupported history ranges, and semantically wrong calculations can still fail. Attribute compatibility must not be counted as a derived analysis tool or as a goal solution.

| Layer | P064 result / P065 evidence boundary |
| --- | --- |
| Functional correctness | P065 local compatibility path passes; real guest/provider behavior remains open |
| Full-chain reachability | P064 passed create → run → revise → successful run but with 3 avoidable API failures; P065 checks the corrected first run |
| Autonomous adoption | P064 positive for creation and explicit use, but revision was partly error recovery; P065 should audit ordinary tool choice and downstream use |
| Net benefit | Unverified; P064 ended 0/7 levels, 3 actions, 276,407 reported tokens, 600.7s |

**P065 result:** the run was right-censored before a Skill opportunity. It completed 5 actions with 0/7 levels, then stopped at the 600-second deadline after 7 `length` stops/recoveries and 3 recovery failures. No Skill was saved or run, so the transition wrapper was not exercised by the provider. It recorded 8 memory writes, one memory error, 157,250 reported tokens, and no critic note. The API change remains locally verified but real-provider effectiveness is unverified; do not count P065 as support or failure for the compatibility claim.


**P062 result:** lowering the envelope to 2,048 did not remove truncation: 6 `length_stops`, 6 recoveries and 4 failures. It nevertheless reached an Agent-authored `diff_grids v1`, 3 successful automatic observations, 3 competing hypotheses and one active strategy; explicit `skill_runs=0`, 2 actions, 0/7 levels, 160,946 reported tokens, 509.1 seconds, one memory error, and `no_action_streak` stop. This supports lifecycle reachability for creation/automatic diagnostics but rejects the claim that a smaller envelope alone solves the transport boundary or semantic use.

### 10.29 Log review of P048–P065: three runtime defects behind the length/latency series (2026-10-11, Claude session)

Scope: the 18 real `ls20` runs P048–P065 and the two earlier reference runs (D3 `thin-sh-d3-ls20`, the only thin run that cleared a level, and round 3). Scripts: [tmp/thin_throughput.mjs](../../tmp/thin_throughput.mjs), [tmp/thin_decision_cost.mjs](../../tmp/thin_decision_cost.mjs). No new model cost.

**Measured.**

| Run | Reasoning requested | Output cap | Actions | s / action | Output per decision (median) | Reasoning share | `length` stops |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D3 ls20 (1 level) | provider default | 65,536 | 62 | 51 | 979 | 84% | 0 / 91 messages |
| Round 3 ls20 | provider default | 65,536 | 35 | 24 | 515 | 74% | 0 / 46 |
| P048 | off | 65,536 | 8 | 203 | 9,058 | 85% | 0 / 17 |
| P050 | off | 65,536 | 12 | 131 | 4,999 | 87% | 0 / 18 |
| P052 | off | 16,384 | 3 | 519 | 14,036 | 92% | 3 / 14 |
| P060 | off | 4,096 | 4 | 117 | 4,096 | 94% | 5 / 10 |
| P062 | off | 2,048 | 2 | 228 | 2,048 | 94% | 10 / 16 |
| P065 | off | 2,048 | 5 | 108 | 2,048 | 95% | 10 / 16 |
| P040 (other tree, `thinkingFormat: qwen`) | off | 8,192 | 47 | 15 | 82 | 0% | 0 / 72 |

**Defect 1: "thinking off" never reached the model.**
- The thin runner sent `set_thinking_level off`, but its `models.json` had no `compat.thinkingFormat`. For an OpenAI-Completions gateway Pi then sends nothing (`openai-completions.js`: the qwen branch sets `enable_thinking` only when the format is declared), so the provider's default applied: reasoning on.
- Evidence: P048–P065 report 85–95% of output as reasoning tokens; P040, run from a tree that wrote `thinkingFormat: qwen`, reports 0%.
- Consequence: §10.16–§10.28 lowered the output cap (65,536 → 16,384 → 4,096 → 2,048) to bound latency. With reasoning actually on, the cap truncated the reasoning before any tool call, which produced the `length` stops that the recovery work then addressed. The cap was treating a symptom of the missing flag.
- Fix: `--thinking-format` on `arc-thin-e2e` (runner argument `thinking_format`), and `thinking_format` / `thinking_reaches_provider` recorded in `run-config.json` and the summary. A later edit by the other session adds `_thinking_format_for_route`, which selects `qwen` for the known yibu/qwen route when a level is requested.

**Defect 2: the idle timeout counted only projected events.**
- `PiKernel.wait_for_agent_events` reset its idle clock only for events the caller's projector kept. The thin runner drops `message_update` (the streaming deltas), so a response that streamed for longer than the idle interval looked silent and was aborted. At about 54 tokens/s, 180 s is roughly 9,700 output tokens and 120 s roughly 6,500; decisions of that size are common with reasoning on (D3 had eight above 5,000).
- Fix: any line from Pi resets the clock; a dropped event is still not returned. New test `test_a_streaming_turn_is_not_idle_when_the_projector_drops_its_deltas`.
- This may also explain part of the "provider turn with no terminal event" signature of §10.20: `message_update` is not persisted either, so a long stream leaves no trace in `pi-events.jsonl`. Not verified against P054.

**Defect 3: review turns have not been recognised since the 04:07 prompt edit.**
- §10.18 changed the runner prompt from `CONSOLIDATE: …` to `CONSOLIDATE. …`. The extension (and the scripted smoke provider) still tested `startsWith("CONSOLIDATE:")`. From then on a review turn was an ordinary decision: `arc_action` stayed available and the review window (`ACTIONS SINCE YOUR LAST REVIEW`) was not built.
- Found by the default and self-harness smokes (`consolidation_ran`, `review_sees_all_actions` failed on the tree as it stood at 10:20).
- Fix: both detectors accept `CONSOLIDATE…` and `RECOVER CONSOLIDATION…`.

**Other changes in the same pass (each answers a logged cost).**
- **Skill results as standing perception.** `LATEST SKILL OUTPUTS` rendered 12 flattened leaves (a list of changed cells became `len52#hash`) and was labelled "diagnostics only; explicit run_skill is required", with the same instruction on every Skill line and in the system prompt. That re-imposed the extra message the section was meant to remove. It now shows the Skill's own JSON (≤900 chars each, ≤2,400 together) under `YOUR SKILLS ON THE CURRENT STATE`, says when a result is from an older state, and marks a version that is no longer run after 3 failures. Predictor Skills (they read `state["proposed_action"]`) are not run as observers. The prompt states the capability and no longer tells the agent to call `run_skill`.
  - This reverses the wording of §10.24. Its accounting concern stands: `skill_runs` no longer captures every semantic use; the `skill_outputs` section size in `working_set.jsonl` records exposure.
- **`PREDICTION CHALLENGE` only for the action just taken.** It showed the last miss until the next one: P048 #4 was called "unresolved" at decisions 5–8, after the agent had revised its plan and predicted correctly twice.
- **Receipt wording.** `cells=16 cell(s) ok` → `cells=16 predicted value(s) ok`. P048 read the old form as "16 cells changed" in both of its most expensive decisions.
- **Predicted cells capped at 12** (was 32). P048 #6 listed 30 and re-verified them in its reasoning.

**Checks.** Node, pytest and the four smokes passed on the tree at about 12:00 (`runs/arc-thin-*-smoke-20261010-p`). At 13:40 the default smoke fails again on the live tree after the other session lowered the tool-call limits to 6/8 (its scripted decision makes more calls); that change is not part of this record.

| Layer | Status | Provider / environment |
| --- | --- | --- |
| Functional correctness | Pass for the items above | node, pytest |
| Full-chain reachability | Pass for review detection, receipts and Skill-result display through real Pi/bridge with the scripted provider; the thinking format and the idle fix need a real provider | scripted provider; real run below |
| Autonomous adoption | Unverified | — |
| Net benefit | Unverified | — |

**Real check started 13:43 (round 4).** Freeze `tmp/freeze/self-harness-20261011-a` (includes the other session's 6/8 tool-call limits and force-action mode as they stood). Two `ls20` runs, each 150 actions, 3,000,000 reported tokens, 7,200 s, review every 25 actions, launched detached ([tmp/launch_thin_run.mjs](../../tmp/launch_thin_run.mjs)):
- `runs/thin-sh-r4-ls20-reason-20261011`: provider-default reasoning, the D3 configuration.
- `runs/thin-sh-r4-ls20-nothink-20261011`: `--thinking off --thinking-format qwen`, the first thin run of this tree with reasoning really off.

Compare levels cleared and actions per level (human baseline for level 1: 22), then seconds per action, `length` stops and idle recoveries. The comparison is one run per arm, so it can show a large difference only.

**Round-4 result (ended 15:40; checked 17:17).**
- **No-reasoning arm:** stopped by hand at 13:56 after the user rejected switching reasoning off. It reached 41 actions, 0 levels, 18 s/action, with 30 of 73 decisions ending without an action. There is no final summary. It is not evidence for or against anything.
- **Reasoning arm** (`runs/thin-sh-r4-ls20-reason-20261011`):

| Measure | Value |
| --- | --- |
| Stop | `budget_exhausted` at 110 actions: the level-1 action budget (5 × the 22-action human baseline) ran out |
| Levels | 0 |
| Speed | 63 s per action, 6,977 s in total |
| Tokens | 1,738,187 reported; median 1,613 output tokens per decision |
| Recoveries and reviews | 0 `length` stops, 0 idle timeouts; 4 reviews; 6 no-action decisions |
| Predictions | 109 of 110 actions; 281 of 291 checked fields right |
| Goal checks | 2 actions predicted a level change |
| Skills | 5 versions saved, 6 explicit runs; results shown at every decision |
| Critic | 6 notes, 3 shown |

- **What happened.** The lifecycle defects of this record are gone: no truncation, no aborted streams, reviews recognised, and 1.6k tokens of output per decision instead of 5–15k. The agent learned the controls and predicted mechanics almost perfectly. It still spent actions #7–#88 (about 75 actions, idea label "clear all 11s") pursuing an untested goal: filling the bottom bar. This is the same failure as D3 and round 3.
  - The GOAL CHECKS ledger line and the critic were present.
  - The critic's #39 note said the run "has zero level/WIN prediction".
  - The critic's #78 note was again a count correction ("12 bounces remain … continue A2"). That is the confirming-correction pattern §10.11 item 2 was meant to stop, so the challenge-first instruction did not hold on this provider.
  - After the bar episode, the agent switched to navigation goals (#96–#110) and the budget ran out.
- **Interpretation.** Load is no longer what limits this agent. The limit is goal formation: an untested goal survives about 75 actions while every movement prediction succeeds. The mechanisms of the load analysis ([report](../reports/2026-10-11-agent-load-analysis.md); B and C implemented 2026-10-11) make each decision cheaper, but they do not by themselves make a wrong goal fail sooner.
- **Next falsifiable check.** Whether goal pursuit without a level/WIN prediction can be made expensive to continue, by the agent's own records rather than a gate. The ledger already counts it ("effort without a level/WIN check"); the critic named it once and was ignored.
