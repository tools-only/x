# Real ARC capability-research goal

Status: active. Owner: manager agent. Model: existing DeepSeek V4 Flash,
confirmed by user. This is an empirical optimization goal, not a prompt-only task.

## Acceptance contract (fixed before baseline)

Auto-Research owns an unresolved capability problem across bounded sessions.
Windows supply evidence; completing a window summary is not solving the problem.

1. Parent frames a grounded missing capability with known/unknown conditions,
   accessible canonical evidence, attainable milestone, next use, local observable
   success/failure test and cost/stop bound before receiving its outcome.
2. Child organizes relevant contrasting evidence, constructs a parameterizable
   method, declares applicability/exclusions, proposes a discriminating check,
   and distinguishes tested findings from hypotheses and missing capabilities.
3. At least one research-origin skill and one research-origin executable tool
   are routed into the native harness. Their inputs, outputs, branches and limits
   describe a problem class, not a fixed coordinate/action answer or memory lookup.
   This is the manager's coverage criterion, NOT a child creation quota.
4. Parent actually applies the skill and invokes the tool on at least two distinct
   later applicable instances per capability. At least one instance per capability
   is outside the evidence used to construct it. Exact resource version, input,
   output, subsequent ARC action/outcome and semantic success check are retained.
   Reading a skill, exposing a tool, or status=completed alone does not count.
5. Parent returns new use/experiment evidence to the same unresolved problem via
   an eligible session or linked successor. Research re-evaluates the method,
   scope or remaining test; countersigning its old report is insufficient.
6. A fresh confirmation run reproduces grounded research, non-memory capability
   creation/use and successful transfer on a distinct applicable instance. It is
   not coached with the development run's solution. Native game progress and cost
   are reported separately; do not claim causal performance improvement without
   a matched control. Inconclusive studies are legitimate, but do not satisfy this
   goal's positive capability demonstration.

Primary audit: exact trace references and manager semantic review. Mechanical
counts shortlist evidence; no keyword-based automatic success verdict.

## Design decision

Use baseline -> evidence audit -> targeted patch -> regression -> real rerun.
Keep experiment supervision and read-only audit outside the ARC adapter.
Preserve current native research/routing APIs; add runtime state only if traces
show a missing continuity/adoption affordance that guidance cannot express.

Alternatives: prompt-only iteration is cheaper but can hide lifecycle failures;
an upfront new research scheduler is broader and risks confounding the baseline.
Start with current behavior and change the smallest evidenced bottleneck.

Flow: unresolved problem -> bounded research -> native capability -> new use ->
canonical result -> research revision -> independent confirmation.

## Safety, cost and provenance

- Each experiment has a new root; never resume/edit the two existing live runs.
- First batch: real ARC ls20, treatment, normal gameplay (not forced harness
  validation), context compaction, at most 60 actions and 2700 seconds Pi runtime.
- Run one paid experiment at a time. Review observed use/cost before another;
  retain the same per-run caps unless an explicit decision is recorded. Provider
  token-price metadata can be estimates; distinguish it from actual billing.
- Read credentials from existing project configuration into process environment;
  never print, copy into reports or alter credential files. No hidden SDK solution
  inspection or private evaluator state is supplied to the agents.
- Snapshot source/prompts and hash them per run; changes during a run are noted.
- Deadlines are experimental cutoffs, not official ARC rules or model failures.
- Preserve dirty worktree changes; no commits or broad cleanup requested.

## Execution plan

- [x] Add tested opt-in experiment deadline to runner/CLI; preserve default native
  allowance. Run runner/CLI deadline and existing recovery regression tests.
- [x] Snapshot current guidance/code, launch baseline with existing DeepSeek
  config, and record model/game/time/action caps without secrets.
- [ ] Audit calls, reports, approvals, routes, resources, actual uses, feedback and
  native outcomes. Record failed gates with exact references, not conjecture.
- [ ] For each diagnosed bottleneck, write a focused failing regression, implement
  the smallest correction and run relevant tests. Prompt quality is tested by
  subsequent real consumer behavior, not word-presence assertions.
- [ ] Rerun fresh real ARC under recorded configuration; repeat until positive
  capability transfer and feedback are observed. Preserve negative runs.
- [ ] Run five-resource arc-harness-smoke after runtime/routing changes (including
  semantic outputs and both length continuation paths), then fresh real-model
  confirmation. Complete the goal only after the acceptance contract is met.

## Experiment ledger

Baseline 01 started 2026-09-18 01:45 Asia/Shanghai at
`runs/arc-capability-research-20260918/baseline-01`. Its `source/` contains frozen
runtime/prompts, `experiment.json` contains hashes and nonsecret parameters,
`run/` contains native evidence, and `audit-progress.json` is a read-only evidence
index generated by `tools/arc_capability_audit.py`. Model and environment are real.
No manager-supplied game solution or mandatory capability-count prompt was added.

Historical live runs predate the latest guidance and are diagnostic context only,
not the baseline for current-source behavior. The old DeepSeek run's single
research report was a failed historical-coordinate retrieval with 142 reads and
46 repeats, no proposals; it cannot validate the latest capability-oriented prompt.

Experiment support verification: deadline/CLI/ARC runner regression 61 passed;
credential-free frozen snapshot test 1 passed; conservative evidence index tests
3 passed. The index separates resource revisions, reads, invocations and semantic
acceptance, and uses canonical action budget rather than duplicated bridge events.
None of these tests constitutes behavioral acceptance of the real agent.

Runtime regression `runtime-smoke-01`: 10/10 scenarios and 201 checks passed using
the real ARC SDK/bridge/Pi/broker/router, deterministic provider. This verifies
compatibility, not the real-model capability objective.

Baseline interim at action 6: parent created `skill:ls20-frame-triage@v1` itself
(no research provenance, empty basis_refs), deferred the first research handoff
for 8 more actions, and deferred a parser tool because direct parsing was cheap.
These are observations, not a final failure verdict. Check whether the declared
reconsideration condition leads to research at later repetition/phase changes.

Baseline 01 ended at the 2700-second experimental cutoff with 41 actions, 1/7
levels and `NOT_FINISHED`; provider and environment error counts were zero. Three
research reports completed. Delayed `auto-research-1` routed one condition-scoped
frame-triage skill, but the parent only received its index/context exposure before
cutoff; there was no exact read, semantic multi-instance use, feedback revision,
task tool or tool invocation. The fixed acceptance contract therefore failed.
Detailed evidence and the capability-owned handoff intervention are recorded in
`2026-09-18-arc-capability-research-audit.md`.
