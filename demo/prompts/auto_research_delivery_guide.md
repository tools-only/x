# Candidate harness delivery

Use the delivery schema on submit_research_report. Describe the content you actually
validated; do not choose attributes merely to force a destination. The research
focus does not determine the delivery type.

## Classify from the work and evidence

- semantic_kind: fact records knowledge; plan describes goals, order, or branches;
  procedure supplies reusable steps involving judgment; computation supplies an
  executable transformation; role defines continuing open-ended model work;
  assessment evaluates a claim or result; evidence supplies supporting material.
- Every fact or plan supplies one `atom={subject,predicate,value}`. One atom may
  have structured values such as an action mapping or a route, but it cannot mix
  subjects whose evidence, scope, invalidation or selection can change separately.
  The atom value is authoritative; content is its deterministic text form.
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
  `reasoning` describes whether judgment is needed; it is not an execution mode.
  A deterministic adapter-backed computation therefore uses reasoning=none and
  execution=adapter_operation.
- context_visibility: always only when subsequent decisions throughout the
  applicable scope need the content; otherwise on_demand.
- basis_refs identify the observations or resources supporting these choices.
  Include each in the relevant report/finding evidence_refs. expected_effect states
  the predicted benefit; reconsider_when states evidence or changes that would
  require revisiting it. Predictions are not observed benefits. A provisional
  delivery is allowed when its scope, uncertainty, falsifier and next bounded use
  are explicit. Routing or applying it enables trial; it does not prove the
  mechanism or task benefit.

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

For procedures, specify inputs, judgment branches, outputs and stopping conditions.
For computations, specify a representative input and expected semantic output;
check the program against that case when execution is available, otherwise state
the untested limitation. For roles, specify the return contract and required
evidence access as well as tools; a tool allowlist alone does not grant archive
access. Reuse or revise existing resources before adding near-duplicates.

Connect validation to the research's local evaluation: starting conditions or
representative input, expected versus actual observable result, executor and
cost/stop bound. State which stage criterion passed, failed or remains untested;
separate a useful local check from later transfer and task-level benefit. Include
the evidence needed from the next applicable use so the parent can feed it back
to ongoing research or a bounded follow-up. Use existing report/delivery fields;
an evaluation plan or an inconclusive result is not a validated capability.

Use expected_effect to describe the next applicable use and the observable check
that would distinguish useful output from mere invocation. Use reconsider_when
for failure, changed prerequisites or contradictory evidence. These are plans for
later evaluation, not claims of benefit. Conditional decision guidance may use
prompt_channel=task_prompt with appropriate visibility and activation; it need
not satisfy the stronger system_prompt invariant requirement.

For always-visible fact/plan deliveries, prompt_layer=task_policy carries a
conditional decision procedure; task_state (default) carries the live state or
plan. Use activation for executable conditions. Full evidence belongs in scoped
resources. Keep changing strategies out of stable system overlays.

When validity relies on another harness resource, declare its exact current
version in depends_on_refs. These are validity prerequisites, not historical
basis_refs. A revised/retired/replaced prerequisite suspends dependent guidance
until explicitly revalidated. supersedes_refs names exact current memory, skill
or system_prompt versions that this delivery replaces. Cite only replacements
supported by evidence; the runtime cannot infer semantic contradictions. Keep
content, summary and optional prompt_text coherent in the same delivery.

Return the complete body and a stable candidate_ref when the proposal may be
resumed. Parent-side code validates and later adopts the candidate through the
single task_harness(action="change") boundary. This report never changes the
parent Harness. An empty proposal list is valid, and a proposal is not evidence
of correctness or benefit.
