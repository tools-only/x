---
name: subagent-creator
description: Author a saved role for an independent bounded reasoning task or a prepared context.
---
# Pi Subagent creator

For one-off analysis prefer delegate_task(task,output_contract?,stop_when?,budget?,tools?,context_recipe?); no saved role or creator read is needed. budget can tighten max_runtime_ms, max_tool_calls, max_continuations (total attempts including the initial one), and max_reported_tokens. Limits belong to the invocation across length resumes; reported-token thresholds can overshoot the last in-flight response. Return a supported answer or precise limitation within the allowance. Save a role only when reusing its responsibility helps.

To save a role, main fills name, description and instructions with responsibility, method, answer, evidence linking, uncertainty, stop and failure behavior. This template is optional. A supplied authoring_method_ref must match the current creator_ref. Agreement with the parent is not independent evidence.

Supply an explicit tools array; use tools=[] for pure reasoning. Grant only registered permitted tools. A child cannot gain live environment control, creators or Harness mutation through its instructions. Missing evidence must produce a request or limitation.

Optional context_recipe controls include_checkpoint, recent_observations, recent_actions, inherit_harness_refs and output_contract. Bind exact evidence at invocation. For a blind comparison, leave the parent's checkpoint/hypotheses out and pass raw evidence; do not claim blindness when a selected report reveals the answer. Omission uses the runtime's default recipe.

Publish and install through task_harness_create. Optional run:{task,evidence_refs?,resource_refs?,context_recipe?} saves the role and performs its first read-only delegation in the same call; receipt.run contains the native report and usage. Failure or cancellation after publication preserves the role and does not rerun it. run requires installation and cannot be combined with a Tool trial.

For custom selection, assembly=false stages only; task_harness(change) without assembly also stages only. An explicit assembly object selects exact versions using the current revision. The receipt's delegate_task(agent_name=...,task=...) entry remains available for later independent calls and custom context_recipe. Inspect the child's semantic answer, evidence, cost and limitations before a parent action; completed alone proves no usefulness. Check a representative task and a near-miss; revise or retire if it fails to help.

Detailed background is optional: read_method(method_name="subagent-creator", method_resource="references/authoring-background.md"). It is not required to author a complete small role.
