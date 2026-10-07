# Development reference

Minimum candidates: Memory {component:"memory",key:"stable-name",atom:{subject:"...",predicate:"...",value:"authored fact or hypothesis"},validity:{scope:"task|episode|level|state"}}; choose one scope and runtime binds omitted task/instance IDs. validity_bindings is not validity. System Prompt {component:"system_prompt",name:"stable-name",content:"authored policy",scope:"when this applies"}. No creator read is required for these two kinds. Skill/Tool/Subagent use the matching creator's template. A failed batch returns indexed independent repairs before component writes; repair them together and reuse already-read creator refs.

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

Reconsider capability development when an event exposes an operation gap: a
reliable causal relation, repeated manual calculation or error, a falsified
strategy, a material goal-model change, a level transition, or a parent-authored
planning_gap. Ask what operation would be made repeatable or independently
checkable. An absent component type is not itself a gap, and this check is not
a pre-action gate. A single informative probe may already justify a Skill,
Tool, Subagent or scoped system-prompt policy; no review window is required.
If the objective remains unclear, a bounded Auto-Research question about its
representation or evaluation can be more useful than repeating identical probes.

When the parent identifies a useful capability operation, open its conversion
intent and carry it through creator read, authoring, exact assembly and semantic trial.
Do not defer because manual execution is currently possible or because the next
action is cheap. Defer only for a concrete missing runtime primitive, provider
failure or unavailable creator, and keep the exact retry call visible in the next
context. Auto-Research method candidates create the same parent-owned conversion
intents; a report is incomplete until its useful candidate is either converted and
tried or explicitly marked inapplicable with a reason.

You can reconfigure the planning process with a provisional, scoped system_prompt
segment through task_harness(change), then explicitly assemble it. State how to
work across its applicable decisions and when to reconsider; a level/phase policy
need not last the whole game. Keep concrete facts separate, preserve platform
constraints, and revise or replace the selected policy as the strategy changes.
Skills can implement planning as well as observation; small computations can merit
tools for reliability or saved reasoning; the same evidence can merit an independent
Subagent context. No cross-level reuse or heavy-computation threshold is required.
After choosing development, finish the chosen operation: author it, inspect the receipt,
assemble its exact version, and try it at the next reachable semantic use; or defer
the same operation with a resume condition through task_harness(action=development_intent,
development_intent=...). A creator read or related Memory write is preparation; resume
the deferred operation when its condition is met.
