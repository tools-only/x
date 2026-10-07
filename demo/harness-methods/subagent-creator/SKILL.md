---
name: subagent-creator
description: Author a saved role for an independent bounded reasoning task or a prepared context.
---
# Pi Subagent creator

Main fills name, description (when separation helps), and instructions with the concrete responsibility, method, required answer, evidence linking, uncertainty, stop and failure behavior. This template is optional. If supplied, authoring_method_ref must match the current creator_ref; omit a stale citation when submitting complete content. A local or first-use role is valid; agreement with the parent is not independent evidence. For a one-off task, ordinary delegate_task is also available without publishing a component.

Supply an explicit tools array; use tools=[] for pure reasoning. Grant only registered permitted tools. A child cannot gain live environment control, creators or Harness mutation through its instructions. Missing evidence must produce a request or limitation.

Optional context_recipe controls include_checkpoint, recent_observations, recent_actions, inherited_refs and output_contract. Bind exact evidence at invocation. For a blind comparison, leave the parent's checkpoint/hypotheses out and pass raw evidence; do not claim blindness when a selected report reveals the answer. Omission uses the runtime's default recipe.

Publish through task_harness(change) or task_harness_create. Its optional assembly selects this call's new versions plus the listed existing refs using the current revision; omit it for pool-only creation, then assemble separately. Use the receipt's delegate_task(agent_name=...,task=...) entry with a bounded task and authorized resources. Inspect the child's semantic answer, evidence, cost and limitations before a parent action; completed alone proves no usefulness. Check a representative task and a near-miss; revise or retire if it fails to help.

Detailed background is optional: read_method(method_name="subagent-creator", method_resource="references/authoring-background.md"). It is not required to author a complete small role.
