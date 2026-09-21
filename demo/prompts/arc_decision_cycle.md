Play ARC-AGI-3 game {{game}}. The current public state is supplied automatically at the start of every decision cycle. Task-local self-harness and auto-research are available from the first cycle. Native skills are disabled; skills, memory, tools and subagent definitions start empty. Use task_harness only when the current decision justifies a change or inspection; it is not a prerequisite for arc_action. The agent owns resource creation, revision, composition, research questions and delegation. Lower-order-first refers to complexity and dependencies, not a resource-type ladder; intermediate research need not change the next action.

Learn from before-state/action/after-state transitions: distinguish changes and
invariants from hypotheses about their causes. Compare different actions in
comparable states and the same action under different conditions; consider elapsed
time, autonomous dynamics and hidden conditions. Prioritize experiments that
distinguish competing explanations of decision-relevant uncertainty. Build local
predictive rules before relying on their composition into higher-level behaviors;
record unresolved dependencies and revise them on counterexamples. Do not assume
action meanings, require exhaustive exploration, or postpone all planning until
certainty. Turn repeated computation into tools and reusable observation/testing
procedures into skills; saving facts alone is not capability development.

Use Auto-Research for a grounded uncertainty or missing solving capability. Before
starting supply concrete conditions and accessible materials, an attainable
intermediate objective, and a reachable local stage/input with an observable
success/failure check, executor and cost/stop bound. Gather prerequisites, narrow
or defer when these are missing; do not delegate an unsupported "how to win" goal.
Research may compare granted evidence across phases and construct candidate
methods from prior knowledge, then test them locally. Feed later applicable use
and stage results back into the research; a local check is not whole-game benefit.

Harness writes use one parent boundary: `task_harness(action='change', changes=[...], decision={reason,expected,basis_refs})`. The semantic candidate routes deterministically to one of five persistent component kinds: memory, system_prompt, skill, adapter-bounded tool, or read-only subagent. `task_prompt` is not a sixth kind; it is the current assembly's source-agnostic output channel. The native component writers, checkpoint, validation, resource index and ordinary delegation are runtime support operations, not first-line model choices. Open one through `task_harness(action='activate')` only when a concrete decision needs its exact output. Pi's native context keeps the active transcript; hypotheses remain separate from environment facts.

Every fact or plan memory change must contain exactly one structured
`atom={subject,predicate,value}`. The atom is the smallest unit whose evidence,
scope, invalidation or selection may change independently. Split controls,
geometry, mechanism hypotheses and routes into separate changes; do not store a
whole stage recap as one memory. Current position, frame and action budget come
from runtime state and do not belong in Harness memory. Skills describe how to
derive or use facts and may depend on exact memory refs; they must not copy the
facts into their instructions.

Component creation/modification commits immutable versions to the pool; it does
not select them. Inspect `task_harness(action='inspect')` for the pool and current
assembly. When a later request needs a changed composition, call
`task_harness(action='assemble')` with the expected assembly revision, the
smallest compatible exact-version selection, and any exact-source prompt
contributions. Active is not selected. The deterministic runtime validates,
projects and executes the declared assembly; the main Agent owns semantic choice.
With no assembly, the selected component set is empty. An assembly persists
across turns, so reassemble only when the needed composition or an exact selected
version changes. Structured activation may suppress a selected contribution when
its state condition no longer holds, but code never chooses relevance.
Direct `arc_action` remains valid without reassembly. Research reports, methods,
plans and hypotheses become prompt guidance only after explicit parent selection.

In a harness review, include a complete structured candidate on a create/update
entry when its content is already decided. Runtime applies it through the same
change implementation and returns application_receipt in that review call.
Without a candidate body, the entry remains pending_candidate_body and no
component is invented. Use task_harness(action='change') for a separate direct
change. Only the native receipt establishes application; later use and effect
still require evidence.

At level success, RESET or game failure, inspect the pending whole-level outcome
window and submit task_harness(action='level_review'). Include earlier attempts,
decisive behaviors, actually applied harness versions, wasted work, mechanisms,
shortcomings, lessons and next-attempt recommendations. Positive credit requires
application evidence, not creation or exposure alone; preserve uncertainty about
causality. If public observations suggest an automatic reset, report its action
observation with task_harness(action='report_level_reset', boundary_ref=...,
reset_reason=...). This opens an explicitly agent-reported review, not a confirmed
environment event. Do not infer reset solely from changed-cell counts. The final
ARC_TERMINAL_LEVEL_REVIEW turn is read-only and does not require an ARC action.

Each bridge decision cycle may contain multiple analysis, research, creation, use or delegation steps, and must end with exactly one available arc_action as its final call. The complete current frame is already in the decision context; do not spend a tool call refreshing it. decision can carry hypothesis, prediction and falsifier; optional validation_window records a local test window, not a global action-stopping rule. Window expiry or replacement does not establish a hypothesis verdict. Continue until WIN or the native action budget is exhausted.

Runtime creates a compact review opportunity every 5 completed ARC actions and
uses a 20-action boundary for consolidation. These are advisory, never action
gates: inspect task_harness(action=inspect) only when the current decision would
benefit from a Harness or research judgment, then submit an evidence-linked
task_harness(action=review) when warranted.
Omit opportunity_id when there is one pending review; runtime binds it. Submit only
components with an opinion; runtime marks omitted components deferred. Use the
returned review_contract for legal dispositions, required semantic fields and a
complete submission template. Include current-window evidence; existing older
observations may be cited separately for historical comparison.
Extract reusable methods and computations as well as facts; multiple candidates
per component are allowed. Consolidation checks prior use, duplication, conflicts
and obsolescence. Creation remains available immediately between these windows.
The review persists the parent's own transition_analysis and returns a
research_handoff_ref plus explicit blocking and non_blocking Auto-Research call
templates. Auto-Research validates or challenges that summary; it does not replace
the 5/20 parent induction. Before the next action, autonomously choose the mode
from current decision urgency and start that handoff, or explicitly defer/skip it
with a reason. Omit research_handoff_ref for a unique eligible handoff. Multiple
targets return complete reference candidates for selection; never assemble or
guess versioned refs. Defer can be reactivated manually or after a declared number
of successful actions. If runtime reports budget exhaustion or infrastructure
degradation, continue the parent task rather than repeatedly repairing that gate.
Incremental handoffs own the structured `research_problem`: a reusable capability
bottleneck grounded by the current window. They construct and locally evaluate a
parameterized method, representation, computation or role, or return an exact
maturity/access gap. The mechanism hypothesis and discriminating environment sample
are evidence for that problem, not a sufficient window-summary deliverable.
Consolidation also examines methods using relevant accessible cross-phase contrasts. Check the
research preparation conditions even for generated handoffs; explicitly defer/skip
duplicate handoffs and carry useful evidence to existing research. Execute ARC
experiments only in the parent, then resume eligible pending/failed sessions with
the new evidence. Completed work needs a bounded follow-up citing its exact prior
research_run/research_report, not resume. Inspect active work rather than duplicating it.
Research agreement or completion never raises confidence without cited evidence.
`task_harness(action=inspect)` may also expose a code-generated
`cross_context_research_candidates` entry after the same action has exact evidence
in distinct runtime situations. Treat it as one optional decision candidate. If
you select it, pass its `research_call` directly to `auto_research`; do not rebuild
the evidence list or infer that the grouped situations share a mechanism.
Use the capsule's structured `next_experiment` (or the completion inbox and
`task_harness(action='inspect').research_experiment_candidates`) as a decision candidate.
Check its `as_of_event` against the current state, then either discard it, record
why it is not applicable, or accept the unique pending request with
`arc_action.decision.approve_research_experiment=true`. Runtime binds its
request_ref and requested action budget. When several requests are pending,
select one exact request_ref and a fixed positive approved_max_actions.
The runtime records each accepted action and its later execution observation;
there is no separate approval or resolve call. Audit `confidence_update`; do not
infer either confidence or experiment acceptance from completion status.

For effect assessment, provide the semantic verdict, consequence and remaining
uncertainty. Omit decision_id when exactly one exposed decision is unassessed;
the runtime binds that decision and all of its recorded native exposure refs.
Select a decision only when several candidates exist. Supply observation_refs
only when deliberately adding an execution observation beyond the automatically
bound native exposures. The verdict must be exactly `supported`, `unsupported`,
or `inconclusive`.
