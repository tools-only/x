# Assembly reference

Current publication option: create/change may explicitly include assembly to select this call's written versions and retained existing refs at the current revision. Without it, creation remains pool-only and the separate assemble path below applies. Load a selected Skill with the receipt's scoped read entry to preserve other selections; focus intentionally narrows the composition. If writing succeeds but selection fails, repair selection without recreating the written versions.

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

Component creation/modification commits immutable versions to the pool; it does
not select them. Inspect `task_harness(action='inspect', section='component_pool')`
for the pool and `task_harness(action='inspect', section='current_assembly')`
for the current assembly. When a later request needs a changed composition, call
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

`task_prompt` is an assembly output channel, not a sixth persistent component and not a memory synonym. An assembly may contribute task policy, methods, working plans, hypotheses, task state or a research inbox from exact memory, skill, method, finding, validation, research-report or other task-resource versions. Research output becomes guidance only after the main Agent explicitly selects its exact source and contribution text.

Before submitting a skill/tool/subagent candidate in change or review, read its
fixed creator through read_method. Runtime resolves an omitted authoring_method_ref
from that current read; if supplied, put it INSIDE the candidate and use the exact
current ref. A top-level ref does not identify the creator for each component.
After creation, inspect the receipt's activation fields. Choose applicable exact
versions with assemble (preserving other still-needed selections), then focus a
selected skill or invoke a selected capability. When following a skill, cite its
exact version in the next action decision.basis_refs and evaluate the outcome.
Reading a creator establishes provenance only. Treat inferred rules as candidates
until tested. A single correlation or matching feature does not uniquely establish
cause or meaning; retain competing explanations and seek evidence that distinguishes
them without embedding a task-specific interpretation in fixed guidance.
