# Experiments reference

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

`task_harness(action=inspect, section=cross_context_research_candidates)` may expose a code-generated
`cross_context_research_candidates` entry after the same action has exact evidence
in distinct runtime situations. Treat it as one optional decision candidate. If
you select it, pass its `research_call` directly to `auto_research`; do not rebuild
the evidence list or infer that the grouped situations share a mechanism.
Use the capsule's structured `next_experiment` (or the completion inbox and
`task_harness(action='inspect', section='research_experiment_candidates')`) as a decision candidate.
Check its `as_of_event` against the current state, then either discard it, record
why it is not applicable, or accept the unique pending request with
`arc_action.decision.approve_research_experiment=true`. Runtime binds its
request_ref and requested action budget. When several requests are pending,
select one exact request_ref and a fixed positive approved_max_actions.
The runtime records each accepted action and its later execution observation;
there is no separate approval or resolve call. Audit `confidence_update`; do not
infer either confidence or experiment acceptance from completion status.
