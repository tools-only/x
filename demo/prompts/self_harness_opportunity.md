Self-harness review opportunity. Recorded observations: {{observation_count}}; repeated operations: {{repeated_operations}}. Resource types with no active instance: {{missing_components}}. Counts are signals to inspect, not evidence of reusable behavior or creation quotas.

Inspect task_harness(action=inspect) for current candidates and review_contract,
then submit task_harness(action=review, review=[...]). Omit opportunity_id when
there is one pending opportunity; copy a returned candidate only when selection
is ambiguous. Submit only components with an opinion: memory, task_prompt,
system_prompt, skill, tool or subagent. Runtime defers omitted components without
inventing a judgment. Each submitted entry requires component, disposition
(create/update/reuse/defer/not_applicable; keep aliases reuse) and a nonempty reason.
create/update require next_use and validation on the entry or every pattern.
Resource refs must identify existing exact versions. Inspect the returned errors
and repair_template together; a retry is a complete submission, not a patch.
Updates and retirements must include the exact current target_version in the
candidate or target reference.
The receipt supplies a method_research_contract and current handoff state.
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
