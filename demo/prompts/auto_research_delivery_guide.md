# Candidate harness delivery

Use the delivery schema on research_approval. Describe the content you actually
validated; do not choose attributes merely to force a destination. The research
focus does not determine the delivery type.

## Classify from the work and evidence

- semantic_kind: fact records knowledge; plan describes goals, order, or branches;
  procedure supplies reusable steps involving judgment; computation supplies an
  executable transformation; role defines continuing open-ended model work;
  assessment evaluates a claim or result; evidence supplies supporting material.
- operation: create a new resource, update a supplied existing version, reuse it
  unchanged, or retire it when the evidence supports removal. For updates/retirement,
  use the observed target_version, not an invented future version.
- scope: current_step for the present decision, condition for stated prerequisites,
  task_wide only when supported throughout the task. State the actual applicability.
  trigger names when to use it; exclusions name observed or known non-applicable
  conditions, not an assertion that all counterexamples have been eliminated.
- stability: transient for current-state information, conditional when applicability
  depends on changing prerequisites, stable_in_scope when supported throughout the
  declared scope. reuse is expected_reuse when identifiable future situations need
  it; otherwise one_off. Do not infer either property from confidence alone.
- reasoning: none for lookup or deterministic execution, bounded_judgment for a
  defined procedure with decisions, open_ended for investigation requiring a model.
  execution is text for instructions/knowledge, pure_computation for a declared
  program without adapter_call, adapter_operation for an authorized adapter call,
  or model_delegation for role instructions executed by a model.
- context_visibility: always only when subsequent decisions throughout the
  applicable scope need the content; otherwise on_demand.
- basis_refs identify the observations or resources supporting these choices.
  Include each in the relevant report/finding evidence_refs. expected_effect states
  the predicted benefit; reconsider_when states evidence or changes that would
  require revisiting it. Predictions are not observed benefits.

## Supply a usable body

content is the actual knowledge, plan, procedure, or role instructions; summary
and description explain its purpose but do not replace it. For computation, include
input_schema and a program using the returned declarative_program_steps, or an
implementation_ref permitted by the returned tool_creation_contract.
An unsupported operation is a capability gap, not an executable delivery.
For model_delegation, specify role instructions and the intended authorized tools.
Use exact existing versions when referencing dependencies.

Conditional plans and changing state belong in task_prompt or retrievable memory.
Request system_prompt only for a stable, task-wide foundation needed throughout
the task. system_prompt_basis.source is explicit_task_contract when the provided
contract directly states the rule, goal, mechanism or constraint; it is
validated_environment_invariant when observations support the same invariant with
no unresolved direct counterexample. Link its evidence_refs in both basis_refs and
the report/finding evidence. Importance alone is insufficient. Omit this field
when not requesting system_prompt. Optional activation/prompt fields describe the
intended projection; they must not broaden the supported applicability.

## Review and return

Propose the complete body. Use the returned approval_id and current version to
approve, reject, or defer that exact proposal before proposing another. Approval
means your evidence supports the delivery within its stated limits; reject a
contradicted/invalid delivery, and defer one awaiting necessary evidence.
Inspect an existing proposal when resuming instead of recreating it.
Submit decided approval identifiers in harness_proposals; do not repeat bodies.
An empty proposal list is valid. Parent-side code routes and applies approved
deliveries and reports the outcome; your review never changes the parent harness.
