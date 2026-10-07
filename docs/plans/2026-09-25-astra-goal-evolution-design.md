# Goal-directed Harness evolution: detailed design

Date: 2026-09-25. Design: Astra. Implementation: SOL. Independent execution and verification: Luna. Root reviews integration and evidence. This document specifies the change; it does not assert implementation or acceptance. The current branch is dirty and actively edited, so code anchors below name functions as well as approximate inspection locations.

## Intended result and boundaries

The parent should be able to accumulate observations, construct a useful local method, and then recognize the still-missing operation connecting that method to the task goal. It can compose existing methods, task constraints, terrain and competing explanations into a strategy, trial it through its own actions, and revise the resulting Harness. These are available reasoning moves, not required phases or a graduation ladder.

For example, a delta-based object locator can supply positions to a method that evaluates feasible approaches to a goal, selects a discriminating move when feasibility is uncertain, observes the result, and revises its route hypothesis. The second method need not replace the locator. It may be a Skill, cooperating Skills, a supported computation in a Pi Tool, or a saved Subagent context for an independent feasibility question. A task-specific, untested method with uncertainty branches is admissible. Its quality remains an empirical question.

The persistent component kinds remain exactly `system_prompt`, `skill`, `memory`, `tool` and `subagent`. Checkpoints, review intents, research agendas, plans and assessments are control/evidence records. `task_prompt` is an assembly output channel. There is no resource quota, forced research, cross-game generalization requirement, semantic admission judge, automatic model call or new research scheduler.

Parent authors components using the matching creator, selects exact versions, interprets evidence, chooses experiments and owns every ARC action. Child research has read-only evidence access and returns findings, alternatives, method candidates and experiment requests. Runtime validates declarations, persists versions, projects context, assembles explicitly selected resources, routes calls and records receipts. It does not invent a goal, decide a winning explanation, write a component, or execute a child experiment request.

## Diagnosis: what is established

The inspected autonomous-run evidence supplied by root records 351 parent actions, 352 environment calls, two completed levels, one `grid-delta-probe` Skill and no Tool/Subagent definitions. That Skill was cited in 283 observation decisions. Only one effect assessment was recorded, for a direction Memory. Reviews 66–68 justify existing capability coverage using a 50-cell moving group and a 4-cell bar; review 68 specifically cites observations 343–347 as covered. There is no planning-method version. Conversely, the final three research reports contain method candidates for goal-slot reachability, marker/background decomposition and a delta-group ledger, with planning implications involving passability, panel phase and time. Earlier reports already discuss an unreachable goal under plain translation and a lateral route after separating a fixed marker from a cycling background. Therefore higher-order reasoning exists; its absence from persistent methods is the relevant conversion failure. Some implication metadata is empty, which is an advisory quality issue, not justification for a new admission gate. These counts describe this run and are not quality targets.

Current-code observations:

| Location | Established behavior | Implication |
| --- | --- | --- |
| `pi_harness_review.ts::reviewInputContract`, `pi_task_local_self_harness.ts` periodic opportunity prompt | Required transition fields emphasize changes, predictive rules, uncertainty, experiment and local capability opportunities. Historical references are allowed. | Local evidence is available, but cumulative task requirements are not a first-class comparison surface. Existing perceptual coverage can answer the presented question while missing the planning gap. |
| `pi_external_benchmark_research.ts::task_checkpoint` and context projection | Existing parent fields include current subgoal, one hypothesis, next step and a free-form working summary with references. | A representation is possible today, but goals, success conditions, constraints and competing strategies have no explicit, consistently projected slots. This is an interface weakness, not proof the model never remembers them. |
| `pi_external_benchmark_research.ts` compact ARC core tool selection | Compact ARC initially exposes `task_harness` and `auto_research`; registered checkpoint support alone does not make its update action callable. | The new planning state must have a reachable write path in the real ARC parent tool schema. |
| `pi_harness_capability_followup.ts::capabilityFollowups` | Unresolved work is computed by the three carrier slots; it carries a truncated capability-opportunity string and evidence refs. | Reusing a perception Skill can settle the Skill slot while a different planning operation remains unaddressed. Memory and omitted carriers already have some protections; the missing identity is the operation. |
| `pi_task_local_self_harness.ts::capability_review` | Latest decision is selected by opportunity ID; submitted carrier entries merge with earlier carrier entries. | Carrier disposition is durable, but there is no separately identified development objective or explicit operation-completion decision. |
| `pi_task_local_subagents.ts::compactContextWindow` | Checkpoint projection uses a whitelist. `task_harness inspect` shows recent reviews and followups, but not the complete cumulative planning state. | Adding storage alone will not make new context reach either the parent conversion turn or the child. |
| `pi_task_local_subagents.ts` compound start branch; `pi_auto_research_protocol.ts::createResearchPlan` | Compound starts without a research result are rejected; compound plans need at least two nodes. | A useful first planning/composition question faces an artificial prerequisite unrelated to execution safety. The live run encountered the start rejection. |
| `pi_auto_research_agenda.ts::buildAutoResearchAgendaRecord`; `latestAutoResearchAgenda` | One fixed agenda ID, one selected latest agenda, and agenda persistence restricted to open allocations. An open start replaces the selected line from the latest agenda/default. | History is retained, and explicit research lines already exist, but the active summary/selection can hide other live alternatives. This is not wholesale report loss. |
| `pi_task_local_self_harness.ts::assessHarnessEffect` | The pre-change implicit candidate filter excludes previously assessed decisions. | Later use of the same method can bind to another decision or fail instead of recording additional scoped evidence. |

Other plausible contributors need evidence: creator/management cost discouraging publication, the model believing a route plan is too transient for a Skill, context-budget competition, and excessive confidence from repetitive successful perception. Do not present these as measured causes. Inspect actual provider messages and authored bodies before concluding which persists after the interface change.

Concurrent implementation note: on a later read, `knowledgeState` already accepts validity for non-Memory records that explicitly supply it. That is work in progress on this branch, not evidence the whole authoring-to-invocation lifecycle is verified. The original planning document's “memory only” observation must not be repeated as current code fact without rechecking.

## Decision 1: cumulative task context stays in the checkpoint

Status: proposed for this implementation. Add optional parent-authored checkpoint fields using the flat form already begun by SOL:

- `task_goal: string`: what outcome the parent is trying to achieve.
- `success_conditions: string[]`: observable completion conditions, qualified as hypotheses if unknown.
- `task_constraints: string[]`: action, geometry, terrain, budget or mechanism constraints, with uncertainty stated by the parent.
- `strategy_alternatives: string[]`: currently viable or challenged alternatives with their distinguishing conditions. Exact research refs may be included; more structured alternatives are unnecessary initially.
- `current_strategy: string`: the parent's current choice and rationale, not runtime endorsement.
- `planning_gap: string`: the operation or uncertainty presently separating known methods from the objective.

Reuse `working_summary` for cumulative mechanisms and useful method coverage, `summary_basis_refs`/`decision_refs` for exact provenance, and `next_step` for the next trial or development step. All new fields are optional. Unknown, partial and empty values are legitimate. The parent can clear obsolete fields explicitly; omitted keys preserve the prior value. Do not require a complete dossier before authoring or acting.

The checkpoint is authoritative current planning state. A review may include an optional snapshot of these same fields to explain its decision, but is not a second independently editable current-state store. Prefer exposing checkpoint update in the existing tool and copying its current projection into inspect/opportunity context. If review fields are supported for convenience, declare whether they update the checkpoint or only describe that review; never silently make both authoritative.

Runtime supplies environment task/episode/level/state IDs alongside the parent-authored state. A level transition does not cause runtime to rewrite semantic strategy text. It marks the parent state as authored against the earlier context and asks the parent to reconsider level-dependent content. Task objective and general methods may survive; a route or terrain constraint may need revision. Preserve the previous snapshot as history.

Why not add a goal/strategy resource? Existing checkpoint/Memory/Skill distinctions suffice: checkpoint is current reasoning, Memory is a selected scoped fact or hypothesis, Skill is a callable procedure. A new component would duplicate authority and obscure conversion. Why not only strengthen the prompt? An instruction without durable state and projection cannot reliably preserve alternatives across compression and direct action turns.

### Required visibility path

1. Include `task_checkpoint` in the compact ARC core active tools so the parent can actually call it. `task_checkpoint(update)` validates optional field shapes, journals a patch and returns the committed revision. Keep its existing parent-only planning authority; a new facade tool is unnecessary.
2. The `CURRENT TASK STATE` parent projection includes the current fields with `agent_interpretation_not_runtime_fact` attribution and existing provenance refs.
3. `task_harness(inspect)` and periodic review opportunity expose the same reconstructed checkpoint projection, current level binding and existing method refs. Review asks which task-solving operation remains missing even if recent observations are well explained.
4. `compactContextWindow(include_checkpoint=true)` passes these fields to research. Relevant goals/constraints must not vanish in a later working-set whitelist or budget projection.
5. Use `readCurrentTaskCheckpoint` everywhere a cross-module reader needs current data. Reading only the periodically flushed snapshot can omit the last journal patches.
6. The existing lifecycle category `CURRENT TASK STATE` retains the newest state through compression. Verify actual final provider payload after every context hook; a resource on disk or an intermediate hook object is insufficient.

Projection must stay compact: include authored decision state and refs, not repeated full trajectories. Truncation must disclose recoverable refs and must not silently drop every nonselected alternative. No semantic summarizer is added to runtime. State that the parent did not author remains unknown.

## Decision 2: development intent is an operation, not a carrier slot

Status: proposed. Extend existing review/capability-decision records with an optional `development_intent` (equivalent local naming is acceptable):

```json
{
  "operation_id": "compare-feasible-approaches",
  "purpose": "Use localization and terrain constraints to choose a reachable goal approach",
  "status": "open",
  "next_step": "Compose current localization with reachability checks and an uncertainty probe",
  "resource_refs": [],
  "evidence_refs": [],
  "reason": "Perception is covered; approach selection is still manual and uncertain"
}
```

Only explicit parent input creates an intent. Runtime must not parse free prose into operations. An intent can be recorded with no carrier choice. States can be `open`, `trial_pending`, `resolved`, `deferred`, `dropped`; the exact enum is less important than explicit identity and separation from resource category. `resolved` means the parent resolved this development decision, not that runtime proved the method useful or the game solved. Require a reason for an explicit closure/deferral, and allow `reconsider_when` as parent-authored text.

Store updates in the existing `task-capability-decisions.jsonl`; seed intent from the existing review record. Materialize latest by `(opportunity_id, operation_id)`. If several intents are supported, unrelated updates must remain independent; do not use one `findLast(opportunity_id)` for all. A minimal first version may accept one intent per call, with repeated calls adding/updating separate IDs. No new component kind or scheduling queue is needed.

The parent-facing followup combines two existing concerns without conflating them: legacy unresolved carrier judgments and explicit operation intents. An open/trial-pending intent remains visible even if all carrier slots are reuse/defer, Memory is saved, research is deferred/completed, a review window expires, or a creator invocation fails. A later Memory-only review does not overwrite it. An unsuccessful preflight preserves the prior intent and returns the repair path. An authored component records a reference and may advance to trial-pending only when the parent declares it; publication is not successful use.

Deferred intents remain inspectable with their reason/reconsideration condition. They need not be repeated on every action turn. Runtime may project explicit dates/counters only if already supported, but must not interpret arbitrary prose conditions or automatically launch research. The parent can reactivate, revise, resolve or drop an intent. New goal/level evidence is an opportunity to reconsider, never compulsory component creation.

This resolves the central failure mode: `grid-delta-probe` can satisfy “locate the moving object” while “choose a feasible goal approach” remains open. One Skill can cover both if its actual procedure does; the parent records that judgment and exact reference. Runtime does not inspect prose to prove coverage.

## Parent development and feedback behavior

The conversion prompt should lead with a task question: given the current goal, success conditions, known rules, constraints and existing methods, which operation would improve the next meaningful decision? The latest window updates evidence; it does not define the entire scope of that question.

The parent may reuse when an existing procedure covers that operation; revise when its steps or applicability changed; compose when several capabilities supply parts of the operation; create when useful work remains absent; or defer/drop with a concrete reason. A strategy can contain fallback and probe branches. A single situation or a level route can justify a method if another execution can follow the procedure; a copied trajectory recap is only evidence.

Research remains optional. The parent can ask one read-only child to challenge reachability and another to test a competing mechanism, sequentially or concurrently within existing budgets. Each receives the relevant goal context and exact evidence plus its distinct question. Independent agreement is not new environment evidence. Child requests become proposed trials; the parent decides whether they are worth executing.

After a report, parent interprets supported claims, uncertainty and alternatives, then authors through the creator if warranted. The trace is report/ref → parent decision and component version → assembly selection → actual use on an applicable input → parent ARC action/result → scoped assessment → revised component or next research question. A negative trial is valid progress when it eliminates an explanation or corrects applicability. A second method can build on the locator and a tested goal constraint without claiming the entire game is solved.

Use existing component `basis_refs` for historical provenance, `depends_on_refs` only for actual execution dependencies. Evidence that inspired a general method does not necessarily make that method expire when a level-specific Memory expires. A composition depending on the old terrain map must become ineligible when that dependency does.

Assessment must resolve an explicit `decision_id` first. If omitted and use observations identify a unique decision, allow already-assessed decisions and append another assessment. If ambiguous, return candidates. If neither explicit ID nor use refs identifies the decision, retain a conservative unassessed fallback. Keep creation, selection, reading/exposure, actual method use and positive utility distinct. For a Skill, an action decision that cites its exact version and applies its steps is evidence to inspect; a bare read or citation count is not benefit. Retirements need separate absence/projection evidence, not fictional positive invocation.

## Decision 3: preserve competing research in existing records

Status: proposed. Remove the compound prior-result rejection and the minimum-two-nodes rule. Keep well-formed questions, explicit plan dependencies, cycle checks, access limits, concurrency budgets and continuation semantics. A compound question with one bounded milestone can start immediately; decomposition is optional planning assistance.

Replace the singleton active-agenda projection with latest entries by research-line identity in the same `auto-research-agenda.jsonl`. Each line has its own version and report/session references. Keep old singleton IDs and exact refs readable; migrate lazily on the next update or use a compatible per-line projection. Do not rewrite historical rows or silently renumber them.

An explicit `research_line_ref` must be honored, including an open start without a question. When no line is selected, present all active agenda summaries to the child and let the child select/declare the bounded question, or allocate a new line identity for this allocation while preserving links to compared lines. Runtime must not silently treat the most recent topic as the only live research line. Existing report line identity remains useful even when a report has no `research_progress`; do not require progress metadata to retain an explicit session's existence.

If multiple explicit lines have progress, persist each separately even when they were started with a targeted question; the old `open_allocation` guard cannot hide those updates from the multi-line agenda. A report may compare other lines through refs without changing their state. Shared evidence is not shared identity. Resume retains its session and line. Concurrent completion merges against the latest record for the same line, not the global highest version; duplicate completion remains idempotent per run/report.

The main parent needs bounded summaries of live questions, differences and next checks in inspect/context, with exact refs for detail. A `later` or `none` result can still use the existing short receipt. Never suppress a planning implication, experiment request or method candidate merely because another line completed. This change preserves choices; it does not select winners or schedule work.

## Supporting lifecycle contract

Extend optional declared validity consistently across all five component kinds using existing public task/episode/level/state binding. Memory retains its current explicit-scope contract. Absent new validity on an old non-Memory component retains compatible task-local behavior; do not retroactively reject it or infer scope from body text.

Check create/update normalization, persistent record, resource metadata, pool eligibility, assembly validation, prompt projection, Skill load, Tool invocation and Subagent invocation. An expired definition remains readable as history but cannot act as current guidance. A task-level localization Skill survives level change. A level-specific route Skill/Tool/Subagent becomes unavailable until the parent authors an applicable revision. Tool/Subagent callers must use the same validity context as assembly. This is necessary correctness support, not the main solution to goal-directed evolution.

## Minimal implementation map and ordering

| Priority | Files / functions | Change |
| --- | --- | --- |
| P0 | `pi_external_benchmark_research.ts` checkpoint type/tool/update/context; `pi_task_checkpoint_reader.ts` | Optional cumulative goal/constraint/alternative fields, explicit clears, authoritative journal reconstruction and visible provenance. |
| P0 | `pi_task_local_self_harness.ts` inspect/review/capability_review/context; `pi_harness_capability_followup.ts`; `pi_harness_review.ts` | Expose cumulative context and persist operation intent independently of carrier dispositions; retain unresolved work after Memory and repair paths. |
| P0 | `prompts/capability_extraction_process.md`, `self_harness_opportunity.md`, `arc_decision_cycle.md` as needed | Ask about the next goal-relevant operation, composition and trial; preserve uncertainty and easy authoring. No required phase completion or category counts. |
| P1 | `pi_task_local_subagents.ts` checkpoint whitelist/start/agenda persistence; `pi_auto_research_agenda.ts`; `pi_auto_research_protocol.ts` | Deliver cumulative context to child, remove artificial compound gates, honor line selection, preserve separate active agendas. |
| P1 | `pi_auto_research_handoff.ts` and existing report/handoff projections | Include goal context and explicit operation reference as context; preserve report-to-intent correlation without automatic adoption. |
| P1 | `pi_task_local_self_harness.ts::assessHarnessEffect` and assessable view | Repeated scoped assessment with deterministic ID/ref selection and explicit ambiguity. |
| P1 | `pi_task_knowledge_lifecycle.ts`, authoring/router/native Tool/Subagent schemas and runtime boundaries | Complete optional validity propagation and old-definition compatibility already under implementation. |
| Verification | existing context/review/followup/research/lifecycle tests; `arc_harness_smoke.py` and smoke provider | Verify semantic state/use at actual boundaries, then execute current-code ARC. |

Do not expand this into general adapter refactoring, a new knowledge database, autonomous child action authority, broad prompt rewriting or a new automatic research cadence. Those changes would obscure the causal test.

## Verification and acceptance

First use focused diagnostic tests for the failure modes, not mirror tests for every optional field:

1. Record a goal/constraints/alternatives and open planning operation. Reuse the perception Skill, save Memory, defer research, produce a control error and retry. The next actual parent context still has the planning operation and cumulative state. Resolving a different operation cannot remove it; explicit parent closure can.
2. Exercise checkpoint journal updates without flushing, then reconstruct inspect/child/parent context. Force context compression/rotation and check the final provider input still contains current goal, constraints, alternative refs and next trial. Stale level context must be distinguishable from current facts.
3. Start a compound planning question with no earlier research report; allow a one-node compound plan. Preserve dependency/cycle/concurrency checks. Complete two research lines in reverse order, resume one, then inspect/start another allocation. Both line histories and current summaries remain accessible and independent.
4. Create five kinds through native routes. Check task Skill survival, level-bound Skill/Tool/Subagent expiration, exact assembly rejection and historical readability; ensure old records without new scope remain compatible. Verify two assessments can bind to the same decision and ambiguous refs do not select another component.

These tests diagnose wiring only. Per `AGENTS.md`, closure acceptance requires `arc-harness-smoke` through real ARC bridge, Pi parent loop, child broker/process, structured return, code router, native mutation, assembly, ARC action and a later real parent turn. Cover all five persistent kinds and provider `length` continuation for both Auto-Research and ordinary `delegate_task`. Assert semantic Tool/Subagent output and actual downstream use, not only `status=completed` or record counts. Document whether provider and environment are doubles or real SDK/provider; deterministic runner evidence does not establish game quality.

Then run current-code real-provider ARC under the agreed execution settings (SOL implementation; Luna run/validation, no Jev or local step cap as specified in the companion plan). Keep it distinct from the historical run. Inspect method bodies and actual provider messages. Evidence sought is:

- An early capability remains useful, while cumulative goal/constraint evidence gives rise to a distinct planning operation or a substantive revision/composition of that capability.
- A parent-authored method has operational branches tied to goal/constraints, exact creator/native receipt, selected version and a later task use; a generic “think strategically” paragraph is insufficient.
- Research alternatives retain identity, a parent trial tests a relevant claim, and its outcome reaches a later assessment/research or component revision. Unsupported conclusions and negative trials remain visible.
- An actual level boundary preserves a task method and retires/reconsiders level-dependent state appropriately.

Do not force the run to fill all five categories: the deterministic acceptance matrix covers reachability, while the autonomous run demonstrates natural method development. If the real model never takes the opportunity, report that behavioral objective as unproven even if every diagnostic passes. If no relevant level boundary or competing research occurs, those natural-run acceptance items remain open. No game-quality improvement claim without matched comparison; this run can establish a concrete behavioral trace, not causality for benchmark gains.

## Risks, defaults and operational constraints

Optional state can be stale or sparsely authored. Label its origin/context, preserve unknowns and show how to revise it; do not auto-fill semantics. Avoid presenting parent claims as canonical environment truth. A model can still settle for weak procedure text; evaluate bodies and trials instead of adding admission gates.

More context can crowd out evidence. Keep one current checkpoint projection, compact operation summaries, and exact refs. Reuse lifecycle deduplication prefixes and check final provider messages after hook ordering. Keep deferred work inspectable without turning every turn into mandatory bookkeeping.

Partial failures must not erase an intent or imply creation. Preserve existing append-only records, version preflight, repair receipts and session continuation. No destructive migration is needed. Old reviews without intents keep their existing carrier behavior. Old checkpoint fields continue to work. Historical singleton agendas remain resolvable. Resume must preserve the same environment history and must not relaunch a fresh game as if it were continuation.

The relevant deferred backlog items are B (research purpose and alternatives), C (parent-owned trials and feedback), and D (cognitive continuity across compression). This implementation addresses selected mechanisms only. Full adapter separation, richer online child experiment protocols and measured semantic continuity/benchmark benefit remain unfinished; do not mark the backlog complete on the strength of this design or unit tests.
