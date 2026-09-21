---
name: subagent-creator
description: Design an independent or preconfigured context for a separable reasoning task, blind review, planning or evidence analysis. Use for a one-off clean-context delegate as well as reusable saved roles; recurrence is not a prerequisite. Not for expanding environment permissions.
---

# Subagent creator

Modified Pi adaptation of Anthropic's official agent-development skill. See
SOURCES.json for the pinned source and license. Claude-specific model/color and
file-discovery settings do not apply to Pi.

1. Extract intent, success criterion and the reason for separation. A fresh
   context can reduce anchoring or isolate a large analysis even on its first use.
2. Write precise trigger conditions, responsibilities, a method, output format,
   self-checks and failure/uncertainty handling. Include representative scenarios;
   avoid a generic expert persona without a concrete task.
3. Design a context_recipe: whether to include a checkpoint, counts of recent
   observations/actions, explicit inherited resource refs, and output_contract.
   For blind analysis leave checkpoint and parent hypotheses out, and select raw
   evidence explicitly. Do not promise blindness if selected reports already reveal
   the parent's conclusion. Instructions alone do not enforce data isolation.
4. Grant the minimum actual tools. Explicit tools=[] means pure reasoning; omitted
   tools use the adapter's default set. Tools and snapshots cannot grant live ARC
   control or harness mutation rights to a child.
5. For one-off work call delegate_task with instructions and context_recipe; no
   persistent component is necessary. Save a role only when its procedure/context
   recipe warrants reuse. Bind current exact resource versions at invocation,
   not stale transcript text in a template. Main assembles a saved role before use.
6. Test a representative task and a near-miss: verify the child sees the selected
   materials, returns the required deliverable and identifies missing evidence.
   Agreement with main is not independent evidence. Inspect costs and results
   before deciding to reuse or revise the role.

Missing material should yield an explicit request or limitation, not improvised
state. Runtime budgets, structured return and continuation are execution mechanics,
not capabilities that a role can add through its instructions.
