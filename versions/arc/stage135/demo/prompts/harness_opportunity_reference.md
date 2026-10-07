Self-harness review opportunity. Recorded observations: {{observation_count}}; repeated operations: {{repeated_operations}}. Resource types with no active instance: {{missing_components}}. Counts are signals to inspect, not evidence of reusable behavior or creation quotas.

Choose useful work from current understanding. If the environment or objective is
still unclear, induction, informative probes and provisional local methods are
appropriate. As a working goal becomes clearer, compare actual progress with it:
observation coverage does not settle a planning, strategy or goal-interpretation
gap. A scoped system_prompt can reorganize the parent's approach; Skill, Tool and
Subagent can supply the needed operations. These can be small, first-use or
provisional. Reconsider your own deferrals when their conditions are met, and
revisit the strategy when locally predicted actions do not achieve its objective.
Use task_checkpoint for current judgments; development_intent can preserve a
worthwhile open operation independently of carrier choices. No fixed stage or
complete goal statement is required before exploration, authoring or research.

Use task_harness(action=summary) for current work and
task_harness(action=inspect, section=review_contract) for the review contract,
then submit task_harness(action=review, review=[...]). Omit opportunity_id when
there is one pending opportunity; copy a returned candidate only when selection
is ambiguous. Submit only components with an opinion: memory, task_prompt,
system_prompt, skill, tool or subagent. Runtime records omitted components as
unresolved placeholders without inventing a parent judgment. Each submitted entry requires component, disposition
(create/update/reuse/defer/not_applicable; keep aliases reuse) and a nonempty reason.
create/update require next_use and validation on the entry or every pattern.
Resource refs must identify existing exact versions. Inspect the returned errors
and repair_template together; a retry is a complete submission, not a patch.
Prefer one review entry per component. Compatible pure `reuse` entries for the
same component are merged, retaining all exact refs, reasons and next uses;
mixed dispositions or duplicate write candidates remain invalid. `patterns` may describe multiple
research or method patterns, but cannot create multiple component bodies. Create
multiple complete same-type resources together with one direct
task_harness(action=change, changes=[...]) call, then record one `reuse` entry
containing all exact created resource refs.
Updates and retirements must include the exact current target_version in the
candidate or target reference.
The receipt supplies exact review and research handoff refs, current handoff state,
and ready research calls. Read the full records only when needed.
Review does not itself start research. For create/update, include a complete
structured `candidate` in the review entry when you have already decided its
content. Runtime routes and applies it in this same call and returns
`application_receipt`; do not repeat the decision through a second change call.
Fact and plan candidates require one `atom={subject,predicate,value}`. Split a
stage recap into independently selectable facts, hypotheses and plans whenever
their evidence, scope or invalidation differs.
If the review only identifies a gap, omit candidate and runtime records
`pending_candidate_body` without inventing a component. Only an applied native
receipt is application evidence.

Prioritize repeated manual analysis, recurring delegation, failed capabilities and repeated decision errors. Identify one worthwhile change or explain the concrete evidence/capability gap. Creation remains optional and no review blocks environment actions. For a candidate, identify its next applicable use and a local semantic check; after application, use it when applicable and inspect actual output before assessing benefit.

When you identify a procedure, computation or useful isolated context, explicitly
decide the operation-relevant skill/tool/subagent/system_prompt carrier. You do not need to fill
an empty category table in one call; unmentioned carriers remain unresolved rather
than being silently dropped. Omission leaves a durable capability
followup, even after the periodic review or research handoff expires. Resolve it
through task_harness(action=capability_review, opportunity_id=..., review=[...])
with the relevant explicit reuse/defer/not_applicable entries. System-prompt
development is included; you need not decide every carrier in one call.
For reuse cite exact existing resource_refs; for defer state the prerequisite and
when to reconsider. This records your decision, not evidence of utility.

For a worthwhile capability, read skill-creator/tool-creator/subagent-creator,
author a complete candidate with task_harness(action=change), then assemble its
exact version. Read the selected Skill or invoke the selected tool/subagent on
the next applicable input and assess the actual result. Auto-Research is optional
and is never a prerequisite for parent authoring. A single-situation method is a
valid Skill: explain how to perform the work, with observations as separate evidence.
First-use, level-local and manually possible operations can merit development.
Save a matching Subagent role when a reusable independent context is worth its
cost; ephemeral delegation is execution evidence, not component conversion.
When evidence, task priorities or remaining investment change, narrow, defer or
drop the same operation_id. Deferral keeps a reason and retry condition;
abandonment does not claim successful creation or use.
System-prompt guidance can be an exploratory or planning policy for its declared
task/level/phase, including a provisional approach across the next applicable
decisions; publish content and scope via change, then assemble its exact version.
It does not need a Skill/Tool/Subagent creator. Memory holds scoped facts/hypotheses.
Relative balance means fitting responsibility,
not equal counts. Auto-Research failure or deferral never blocks direct authoring.
