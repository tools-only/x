# Auto-Research operations

This is an operation reference, not permission to bypass the parent policy.
All references below are returned by tools; use their current exact versions.

## Choose targeted or open research

For a targeted investigation the parent supplies the bounded question and exact
starting references described below. When constructing a good question would
itself require replaying broad history, the parent may instead allocate one open
turn with `auto_research(action="start")` and optional `current_concern`. Runtime
provides the prior research agenda, a per-kind history cursor and read-only
`task_resource` discovery. The child chooses one question, reads only needed exact
versions, and updates the agenda in its report. A non-actionable update is stored
without injecting its full reasoning into the main context.

## Prepare a bounded investigation

Auto-Research investigates a concrete task-level research problem, including
mechanisms, representations, reusable procedures and the agent's own solving
process, exploration policies, plans, solution algorithms and recovery rules. It
can link evidence across phases; summarizing a time window is not its default
completion criterion, and producing a harness component is not its default end.
Before launch the parent supplies:

1. Grounding: the observed difficulty or concrete task/artifact, known conditions
   and unknowns, exact relevant evidence/resources, and actual reading/computation
   permissions. Include contrasting cases and previous methods when available.
   State which missing observations the parent can feasibly obtain; references do
   not themselves grant access and the child does not inherit the transcript.
2. Objective: one attainable intermediate result and why it helps a future task
   decision. Bound it by prerequisites, scope and available research/action cost.
   Replace "find how to win" with a locally answerable question; unresolved
   prerequisite investigations belong in preceding plan nodes.
3. Evaluation: a reachable local state/stage or representative input, the predicted
   observable output, how success and failure are distinguished, who can run the
   check, and its cost/stop limit. Define checks before seeing the result. If a
   criterion changes, explain why; do not redefine a failed test as success.

These are semantic preparation requirements, not new API fields or an automatic
runtime readiness check. For standalone research put them in question/constraints
and select evidence_refs/resource_refs/context_window. For plans use each node's
question/constraints and completion_contract for its local completion criterion;
do not duplicate the full plan in every node. No new report schema is needed.
If no discriminating check is currently feasible, narrow to a checkable prerequisite,
collect material or defer. Do not promise a conclusive outcome: evidence may still
support a negative or inconclusive result. A locally decisive check does not prove
a universal mechanism, overall task success or the method's causal benefit.

Example (replace descriptions with real accessible refs, never fabricated IDs):

- Grounding: two observed ineffective operations, one successful comparison,
  before/action/after records and current candidate prerequisites. Parent can
  afford at most two further operations in an identified reachable local stage.
- Objective: test which supplied prerequisite explains the difference and propose
  a pre-operation check applicable to that stage; do not ask for a complete solution.
- Evaluation: state alternative predicted observable transitions before the probe;
  parent executes only when the named starting conditions hold and returns exact
  outcomes. Check prediction agreement and any subsequent diagnostic use. Stop
  after two probes or on changed prerequisites; return inconclusive if the cases
  still cannot distinguish explanations. This example does not assert ARC mechanics.

Explain the difficulty, construct candidate methods using relevant prior knowledge,
then evaluate locally. These are reasoning activities, not mandatory separate
children. Keep borrowed ideas, inferred mechanisms and tested methods distinct.
For success transitions, compare a nearby failure and inspect canonical visual or
spatial observations directly. Separate necessary state differences from action
order; if a later counterexample breaks the explanation, revisit the framing while
retaining the old question as provenance.

## Plan and schedule

For a simple question, use start with question, complexity_assessment (level and
rationale), constraints, and selected evidence_refs/resource_refs. scope selects
the research method, not the delivery type. inherit_harness_refs selects exact
harness versions. The child does not inherit the parent transcript.
When task_harness returns a periodic research_handoff_ref, the parent review and
transition_analysis are already durable. Select one of the disclosed blocking or
non_blocking calls explicitly; neither 5-step incremental nor 20-step
consolidation fixes the interaction mode. Runtime expands the question, evidence,
resources, constraints and context window from the durable handoff. Start it or
explicitly defer/skip it through task_harness before the next ARC action.
Check readiness even for generated handoffs. Supplement accessible historical
contrasts and evaluation constraints where needed. If existing research already
covers the problem, explicitly defer/skip the duplicate handoff with that reason
and provide its relevant evidence to the existing investigation; no automatic
handoff/session merge is implied.
The resulting capsule may contain a structured `next_experiment` and
`confidence_update`. Parent executes any environment action, adds the resulting
canonical observation as evidence, and resumes the same pending/failed session. A
confidence increase is rejected unless it cites linked evidence from a new
environment observation, resolved counterexample, or completed discriminating
experiment.

For a compound goal lacking a prior research_run/research_report that bounds the
child question, enqueue a plan: goal, complexity_assessment, concurrency_limit,
and nodes. Each node needs node_id, question, completion_contract; optionally
depends_on, activation_policy, scope, constraints, evidence_refs, resource_refs,
and context_window. Compound plans need at least two nodes and no dependency cycle.

Use inspect_plan(plan_ref) to obtain current state. Start a runnable node with
plan_ref and node_id within available_slots. after_dependencies means completed
predecessors are mechanically sufficient. parent_release means inspect their
conclusions, then release or skip the node. Completion does not imply support.
Pending/blocked nodes cannot be bypassed with a standalone research call.

## Sessions and evidence

Runtime owns mechanical reference selection. Omit opportunity_id for a unique
pending review, or research_handoff_ref for a unique proposed handoff when starting
without question/plan_ref. Choose interaction_mode explicitly. Omit session_ref
or plan_ref only when a unique eligible object exists. Ambiguity returns candidates;
copy one exactly. An explicit stale reference never silently selects a new target.
`auto_research(action=contract)` lists current sessions/plans/handoffs.

Handoff decisions use `task_harness(action=decide_research,
research_decision=defer|skip|reactivate, research_reason="...")`.
defer defaults to manual reactivation; optionally supply
`resume_condition={kind:"after_actions",actions:2}` for deterministic reactivation
after two successful ARC actions. `auto_research(action=skip)` skips a PLAN NODE,
not a handoff. After a runtime failure or exhausted review budget, inspect the
degraded state and continue environment exploration; do not blindly repeat calls.

blocking waits for the current child compute slice; if the child requests future
evidence it returns pending. non_blocking returns a session while the parent
continues. Use inspect(session_ref) for current state, resume(session_ref) for
pending/failed work with additional evidence, or cancel(session_ref).
Resume with the current versioned session_ref; preserve the question's constraints.
Do not restart the research for each trajectory window. A research line can span
phases through an eligible session, or through bounded successor investigations
that cite its exact research_run/research_report resources. Completed/cancelled
sessions cannot resume. A completed blocking report requesting an experiment needs
a new bounded follow-up after the parent obtains the evidence, not an illegal resume.
Inspect active work rather than launching a duplicate. Pause/defer when the next
use or evidence is unavailable; end work whose expected benefit no longer justifies
its cost. Persistence does not mean indefinite investigation.

A non-blocking checkpoint with wait_for=next_parent_evidence is claimed once
by runtime when new canonical evidence arrives. wait_for=manual_resume requires
explicit resume. A blocking child must return an unresolved/inconclusive report
as a pending checkpoint rather than keep a child process waiting for future parent
evidence. Blocking and non-blocking only select whether the parent waits for this
compute slice; cancellation must be confirmed.

context_window selects include_checkpoint, recent_observations, recent_actions,
context_refs and max_chars. Supply decision-critical knowledge in constraints or
the selected checkpoint; observations and full resource bodies are paged on demand.
Keep interpretations separate from observations and preserve evidence versions.
Select evidence by the problem, including nonadjacent successes, failures and
counterexamples. Keep the objective, starting assumptions, candidate method,
competing explanations, local evaluation and next unresolved test in existing
checkpoint/report fields. Evidence-triggered wakeup is not itself research progress;
the child must assess whether the new material bears on its question.

## Recovery and adoption

Runtime continues output-length stops using durable checkpoints and detects
unchanged semantic progress. A stalled/inconclusive result calls for replanning,
not blindly replaying the same work. Read findings, gaps and proposed next tests.

Each run receives a runtime-built cross-context comparison when evidence exists.
It is an index of exact cases and outcome contrasts, not a semantic or causal
conclusion. Auto-Research decides which cases are comparable and may reject the
grouping. A method delivery uses the optional `delivery.method` structure; without
that structure it remains concrete experience for lifecycle purposes.

Reviewed deliveries return as compact harness outputs; route refs, hashes,
versions and native steps remain runtime details. Neither blocking nor background
research applies them. The parent decides whether to adopt the completed result
and calls the returned task_harness(action=adopt_research) interface.
Background results arrive through the parent-owned completion inbox once. Do not
recreate deliveries, repeat child approval, or treat a harness output as a receipt.
A failed/partial change receipt is not success. Use successful capabilities and assess
their actual effects; research completion, approval and application are not proof
of correctness or benefit. Knowledge-only and inconclusive reports are valid.
At the next applicable use, record the exact resource version, input/starting state,
actual semantic output, local stage result, costs and deviations from the proposed
check. Feed those references to eligible ongoing work or a bounded successor.
Revise scope, improve or retire a method on this evidence. Distinguish a passed
local check from benefit on later cases; no component count is an evaluation target.
Planning implications and a bounded next research question are first-class results;
they do not require persistence through Self-Harness. Harness proposals remain an
optional downstream channel selected only when continued reuse is supported.
