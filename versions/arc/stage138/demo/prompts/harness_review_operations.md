# Review reference

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

In a harness review, include a complete structured candidate on a create/update
entry when its content is already decided. Runtime applies it through the same
change implementation and returns application_receipt in that review call.
Without a candidate body, the entry remains pending_candidate_body and no
component is invented. Use task_harness(action='change') for a separate direct
change. Only the native receipt establishes application; later use and effect
still require evidence.

At level success, first read the fresh live frame and compare it with the
pre-success state: which part of the prior method remains applicable, which
parameters must be rebound, and what is the next testable goal? Update the
checkpoint and, if the work policy needs to change, author and assemble a
scoped planning System Prompt directly. Then submit the pending whole-level
review while its evidence is fresh; neither the review nor a component change
is an action gate. At RESET or game failure, inspect the pending whole-level
outcome window and review it when its evidence is useful. In each review include earlier attempts,
decisive behaviors, actually applied harness versions, wasted work, mechanisms,
shortcomings, lessons and next-attempt recommendations. Positive credit requires
application evidence, not creation or exposure alone; preserve uncertainty about
causality. If public observations suggest an automatic reset, report its action
observation with task_harness(action='report_level_reset', boundary_ref=...,
reset_reason=...). This opens an explicitly agent-reported review, not a confirmed
environment event. Do not infer reset solely from changed-cell counts. The final
ARC_TERMINAL_LEVEL_REVIEW turn is read-only and does not require an ARC action.

Treat an archived level_review and its success_path.steps as evidence about the
past state, never as commands to replay. If a review points to a useful operation,
derive a prospective method: identify variables from the current observation,
check that its conditions apply, then choose the next action from the live state.
In a later parent turn, read the exact level_review ref and, when worthwhile,
author directly through the relevant Creator and task_harness(action='change'),
assemble the exact version, and trial it online. The runtime does not add a review
adapter or require a component disposition. When the goal and success conditions
become testable, update the scoped task-planning System Prompt directly; phase
changes are parent decisions, not fixed action-count gates.

Runtime creates a compact review opportunity every 5 successful native ARC actions,
including each batch/delegated action, and uses a 20-action boundary for consolidation.
The current cue identifies the newest due window; older windows remain accessible.
When the cue requires a decision, submit task_harness(action=review) before the next
action, or task_harness(action=defer_review, review_reason='<evidence-based reason>',
resume_condition={kind:'after_actions',actions:5}). A deferral reopens after that many
new successful actions. The runtime has a bounded recovery budget for missing decisions.
Component creation remains an Agent choice, with no quota. Inspect the full contract
only when needed; use the current evidence to compare predictions and reusable methods.
Omit opportunity_id to bind the current window. Submit only
components with an opinion. An omitted component is a runtime-default unresolved
placeholder, not a parent judgment and not evidence that no capability is useful. Use the
returned review_contract for legal dispositions, required semantic fields and a
complete submission template. Include current-window evidence; existing older
observations may be cited separately for historical comparison.
Extract reusable methods and computations as well as facts. Submit exactly one
review entry per component. `patterns` may describe multiple research or method
patterns, but they do not materialize multiple component bodies. To create several
complete resources of one type, submit them together in one direct
`task_harness(action=change, changes=[...])` call; afterward, one review `reuse`
entry may cite all exact created resource refs. Consolidation checks prior use,
duplication, conflicts and obsolescence. Creation remains available immediately
between these windows.
