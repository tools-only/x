# Memory reference

For immediate availability, activate `task_memory_pool` if absent with
`task_harness(action="activate", enabled_tools=["task_memory_pool"])`, then call
`task_memory_pool(action="capture", select=true, items=[{content:"<your note>",scope:"task"}])`.
This saves and selects exact versions for the next parent model request while
preserving other valid selections. Omit `select` or set it false to archive only.
Free-form capture does not require a creator, formal review or atom. Use it for
observations, provisional hypotheses, plans or partial retrospectives.

Choose `state`, `level`, `episode` or `task` scope; runtime binds current scope
identifiers. Evidence refs are optional: absent refs remain unverified, cited
evidence establishes traceability rather than truth. `claim_kind` is your label.
Keep current frame, position and budget in runtime state; keep raw traces in their
evidence resources. Selection/exposure does not establish semantic use.

To choose a custom subset later, `task_memory_pool(action="list")` returns exact
refs; `task_resource(action="read", ref=...)` recovers missing full contents.
Replace the selection with `task_harness(action="assemble")`, using the current
assembly revision, chosen `selected_resource_refs` and `prompt_contributions`.
Deselection does not delete saved notes; runtime never selects the whole pool or
restores deselected entries automatically. Revise an existing key with its exact
`target_version`, or retire it when evidence changes. New keys are not merged by
presumed meaning. Superseding notes remain separate from canonical observations.

For a formal reusable fact/plan, use `task_harness_create` or `task_harness(change)`
with stable `key`, `validity.scope` and one `atom={subject,predicate,value}` per
independently changing claim; retain its key on revision. Create installs by
default; `assembly=false` stages only. Change without assembly stages only.
Either path supports explicit exact assembly. Skills hold procedures for deriving
or using facts; `task_prompt` is an assembly output channel, not a saved kind.
