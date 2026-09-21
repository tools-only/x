# Task-local harness review

## State-transition induction guidance

The cognitive progression is observation/measurement → competing effect hypotheses
→ conditional predictive rules → composed behaviors and strategies. It does not
prescribe action meanings, an exhaustive exploration phase or a component order.
The parent decision prompt carries a compact guide; periodic extraction and the
returned method research contract share `state_transition_induction.md`. Child
instructions carry the same comparison/causality boundaries for relevant questions.

Periodic receipts require `transition_analysis`: observed_changes (including
invariants), predictive_rules (support, uncertainty and scope), limiting_uncertainty,
next_experiment (alternative predictions/falsifier or an explicit limitation),
capability_opportunities and window evidence_refs. Runtime checks completeness and
reference membership, not the truth of prose or quality of the experiment. Unknown
rules remain valid. This record complements component dispositions; it does not
automatically mutate resources or establish causal validity.

Each accepted periodic review creates one durable
`periodic-auto-research-handoff-v1` in `auto-research-handoffs.jsonl`. It combines
three linked deliverables under one completion contract: independent assessment
of the current mechanism hypothesis, one higher-information next sample, and a
validated harness delivery or explicit gap. Both five-step and twenty-step handoffs
require the parent to choose blocking or non_blocking; consolidation includes component
composition. The handoff selects exact window evidence and current resource
versions; Auto-Research receives no hidden parent transcript.

Before the next ARC action, the parent must start the exact ready call or record
`task_harness(action="decide_research", research_decision="defer"|"skip")` with a
reason. Starting Auto-Research links the handoff to its session. If the child
requests an environment experiment, the parent executes it and resumes the same
session with canonical new evidence. Completion, agreement or a generated proposal
never changes epistemic status without evidence. Approved deliveries continue
through the existing router, native mutation, exposure, use and effect-assessment
path.

The report/capsule carries `experiment_request`/`next_experiment` as structured
fields (prerequisites, requested parent action, alternative outcomes, falsifier,
information gain, cost and stop condition). An optional `confidence_update` is
validated separately: an increase must cite report-linked evidence and use one of
new environment evidence, resolved counterexample or completed discriminating
experiment as its basis. Session-to-handoff state is reconciled from the durable
session ledger at parent runtime boundaries, so non-blocking background completion
does not depend on a second tool-result event.

Incremental review prioritizes predictive explanations, decision-limiting unknowns
and reusable work. Consolidation checks composition, contradictions, dependencies
and actual capability use. This implements guidance for deferred method-induction
work without claiming the broader research-mode comparisons are complete.

For ARC, the default is deterministic periodic extraction: every 5 successful
`arc_action` calls inspect the last 5 actions; every 20 inspect the last 20 instead.
Reads, failed calls and repeated records of the same tool call do not advance the
counter. Windows persist through unique `arc-pattern-N` identifiers. Pending
windows remain visible until submitted. Before another action, the parent must
submit the review. The runner explicitly enables this policy through
`PI_HARNESS_PERIODIC_REVIEW=enabled`. Each pending review/handoff has bounds of
three failed management calls, twelve management calls, or 120 seconds measured
at runtime boundaries after management begins. Runtime failures immediately
degrade the handoff. Two action deferrals also exhaust the action-delay allowance;
all pending gates are checked before returning control to the environment.
These bounds settle auxiliary obligations; they do not terminate an in-flight
provider call, impose a task-wide quota, or override safety admission.
No child is launched. Immediate creation remains available. Terminal runs do not
start a new parent turn merely to review their trailing window.

Each window provides exact action/evidence references and a baseline reference.
Incremental extraction can produce multiple patterns per component. Candidates
require existing evidence, applicability, counterexamples, usable content and a
next-use validation plan. Consolidation also reviews earlier resources and effects.
The status lifecycle links remain available for that purpose.

For non-ARC tasks, the parent receives deduplicated review opportunities for portfolio changes,
repeated operation/delegation count buckets, recorded failures, public progress
and bounded intervals without public progress. No-progress is a review cue, not a
claim that exploration is useless. Detection lives in the agent runtime; it does
not change the environment adapter, launch research or gate actions.

Inspect `task_harness(action="inspect")`, then submit
`task_harness(action="review", review=[...], transition_analysis={...})`.
Runtime binds a unique pending opportunity. Ambiguity returns candidate IDs;
explicit bad/stale references never silently bind another target.
Submit only components with an opinion; runtime expands omitted memory,
task_prompt, system_prompt, skill, tool and subagent entries to marked runtime deferrals.
Each entry carries component, disposition and reason. Create/update candidates
also require next_use and validation, inherited from complete pattern entries if
omitted at entry level. `keep` is a compatibility alias for `reuse`.
Existing resource_refs must resolve to exact
task-local versions. Missing evidence permits defer; creation quotas are absent.
One opportunity commits one review/handoff. Identical canonical submissions reuse
the receipt and return the current handoff version. Divergent repeat submissions
return already_reviewed rather than creating duplicate research. The append-only
`task-harness-review-commits.jsonl` journal repairs missing index projections after
interruption. This is replayable consistency, not a cross-file atomic transaction.

Transition evidence must contain a current-window/baseline reference. Existing
historical observations up to the window endpoint are allowed as comparisons;
runtime returns window_evidence_refs and historical_evidence_refs separately.
Unknown, future and cross-task evidence is rejected. No causal truth is inferred.

Handoff decisions use defer/skip/reactivate. defer defaults to manual resumption;
`resume_condition={kind:"after_actions",actions:2}` reopens after two successful
ARC actions. Contract/schema errors contain field paths, allowed values and a
repair template. Failure keys include task/action/target/version. Successful
corresponding operations append resolution links; a version-conflict recovery
may use only the runtime-reported current version of the same target.

Child handoff context reconstructs the latest checkpoint from its snapshot and
durable patches, so recent subgoals and pending operations survive delayed
snapshot writes.

`task-harness-reviews.jsonl` persists the review and a method_research_contract.
The parent can use its goal, candidates, completion contract and required material
to construct a bounded Auto-Research question or plan. This is an explicit parent
decision, not an automatic child launch. Existing approval/routing checks remain.

`task_harness_status.lifecycle` joins every stored resource version with its
decision, source approval/route identifiers where present, native exposure refs,
tool/subagent invocations, skill reads and agent-authored effect assessments.
For memory it separately reports requested task-prompt projection and recorded
task-prompt exposure. Reading instructions is not proof they were followed;
completed calls and output transformations are not proof of semantic correctness.
Assessments retain their agent-authored provenance and evidence references.

Diagnostic tests cover validation, idempotency, native status integration,
version-specific joins and progress bucketing. These do not establish ARC closure
or improved provider behavior. Full acceptance still requires arc-harness-smoke
through the real bridge/parent/child/router/action lifecycle and real-provider
comparison for activation quality and task benefit. Existing live runs are not
restarted by this change.
