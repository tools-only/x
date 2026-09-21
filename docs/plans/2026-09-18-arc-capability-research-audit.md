# Capability-research manager audit

Acceptance contract: `2026-09-18-arc-capability-research-goal.md`.
This document distinguishes observations from hypotheses and interventions.

## Baseline 01 (running)

Artifacts: `runs/arc-capability-research-20260918/baseline-01`.
Normal gameplay, current grounded guidance, real DeepSeek and real ARC ls20.
60 actions / 2700 seconds experimental cutoff. Source is frozen.

### Observed so far

- At 5-action review (`task-harness-reviews.jsonl`, review `harness-review-1`),
  parent recognized repeated frame decoding/avatar localization/rail counting,
  created `skill:ls20-frame-triage@v1` directly, and deferred tool construction
  because immediate parsing was cheap. This is parent self-harness, NOT an
  Auto-Research-origin method. Its `basis_refs` are empty.
- Parent deferred the first research handoff until 8 more actions. A future cue
  should revisit that decision; defer is not by itself misuse.
- At 10-action review (`harness-review-2`), parent claims the existing procedure
  worked in 5/5 moves and again finds no immediate need for a tool. This is a
  self-reported use claim requiring comparison to actual decisions/outcomes.
- Three management failures observed by action 10: new-memory target_version,
  incomplete periodic review patterns, and missing retire target_version. These
  are interface-contract errors, not evidence that a research method is wrong.
- At action 13, parent starts `research-session-1` non-blocking from the old
  `arc-pattern-5` handoff. Its selected evidence is observations 1..9 and no
  resource_refs, despite the newer blocked-panel counterexample already observed.
  The question still describes that collision condition as untested. The child
  does try live read-only arc_state/trajectory tools; inspect its eventual report
  before concluding that it actually used only stale evidence.
- At action 15, parent starts `research-session-2` on `arc-pattern-15` while the
  first is still active. Both scopes are hypothesis. Question identity remains
  window-based; whether the second is a justified distinct objective or redundant
  work requires comparison of the reports and parent reasoning.

### Hypotheses to test, not findings

1. Deferral conditions may recur without a durable unresolved capability problem
   being reconsidered when their conditions actually hold.
2. Periodic handoff wording may anchor research to retrospective mechanism review
   even when a recurring agent computation is the more useful research target.
3. Computation construction/testing may lack an affordable executable surface.
   Check actual child contract and reported gaps before adding capabilities.
4. A valid delivery may be available but not selected by the parent when relevant.
5. Use outcomes may never return to the research problem; success/creation is then
   mistaken for completion without held-out use or revision.

### Decision discipline

Do not patch the frozen baseline source while it is running. Inspect the first
actual research problem and report, later repetition/counterexamples, and eventual
budget outcome. Choose a targeted intervention only from trace-supported failure.
Do not feed the known game solution, hidden state, or manager-written tool answer
into the agent. Keep resource quotas in the manager acceptance coverage, not the
agent's research objective.

## Intervention candidate 01: selected-window access (implemented, verifying)

Direct evidence: `auto-research-1.events.jsonl` records three denied reads of
observations 15/16. The parent selected a recent observation window but the child
grant list contained only the original explicit observations 1..9. The context
window implementation says truncated excerpts can be paged through task_resource,
yet runChildPi never added those selected observation bodies to the grants.

Red test: `test_research_selected_window_access.py` launches real Pi parent/child;
latest observation selected with recent_observations=1 was unreadable. Green fix:
grant exactly the canonical observations selected into that window, alongside
explicit refs. Older unselected observations and unrelated memory remain denied;
arbitrary checkpoint/basis references are not followed. This changes access
consistency, not game logic, child action permissions, or research success criteria.

At action 24 (1 level completed), `auto-research-2` returned 6 findings, 0 proposals.
The report describes level-0 collision/rail restoration and proposes the action-17
cross-tile experiment after the parent already completed that experiment and
advanced the level. It contains a research_method anomaly-check candidate but
defers helper construction again. This is useful local analysis, not yet an
Auto-Research capability delivery or a fresh-use/feedback loop. `auto-research-1`
was still active at this checkpoint.

Manager-owned runs (existing live runs untouched):
- Baseline launcher tool session 60217, root `baseline-01`, cutoff 2700 seconds.
- Selected-window regression session 71264: completed, 76 passed in 174.23s.
- Five-component runner smoke session 87515: completed, 10/10 cases passed at
  `runtime-smoke-window-access/arc-self-harness-smoke-summary.json` (real SDK,
  deterministic provider; semantic outputs and both continuation paths covered).

At the level-0 boundary the parent made three invalid level_review attempts:
behavior targets were validation refs instead of observations; then some credit
evidence was outside the window; then application_ref named effect-assessments
instead of actual subsequent execution observations. Runtime rejected them
correctly, but the visible schema gives little field-level guidance. Do not relax
the attribution checks to make the benchmark proceed. Inspect whether the parent
recovers and, if needed, improve the contract's actionable descriptions separately.

Next: finish baseline/audit and tests; only then launch one paid successor from a
fresh snapshot. Re-evaluate whether access-only correction is sufficient or a
separately recorded capability-problem/adoption intervention is needed. Preserve
all negative evidence; do not label game progress as capability acceptance.

At action 41, the delayed `auto-research-1` report completed and routed
`skill:arc-frame-triage-5pitch@v1` through approval/route receipt
`auto-research-1:route-arc-frame-triage-5pitch`. This is the first genuinely
Auto-Research-origin harness resource in the baseline. It is only projected so
far: no exact skill read or later semantic use receipt was observed. Its declared
scope embeds level-0 coordinates, HUD and rail values, so it is not yet evidence
of a problem-class method transferring to multiple distinct instances. By this
point the run had 3 completed reports, 2 skills total, 0 tools and 0 tool
invocations; later reports continued to center level-local meter/route mechanics.

## Intervention candidate 02: capability-owned periodic handoff (implemented, verifying)

Trace-supported cause: each periodic review unconditionally generated a new
handoff whose first objective was to investigate a bounded mechanism and whose
incremental scope was `hypothesis`. The reusable capability appeared only as a
secondary opportunity. Baseline sessions therefore followed window identities,
overlapped while older work was active, and usually completed with local mechanism
reports. This runtime structure contradicted the intended ownership model even
though the prose guides mentioned reusable methods.

The handoff now has a structured unresolved `research_problem` of kind
`reusable_capability`; the trajectory window is explicitly an evidence batch.
Incremental handoffs use the `research_method` profile. Their completion contract
requires a parameterized method/representation (or an exact maturity/access gap),
a semantic local evaluation and a next-use feedback requirement; a mechanism
verdict alone is incomplete. The runtime carries up to four recent active/pending/
completed handoffs and exact report/run/session references so the parent/child can
continue, revise or distinguish prior work instead of silently opening a new
window-local identity. Related parent and child guides were aligned.

Red/green evidence: a new handoff test initially failed because no structured
capability problem or prior research refs existed; it now verifies the capability
contract, continuity refs and inherited report access. The full handoff lifecycle
suite passes (12 tests). A fresh real-provider ARC successor remains the behavioral
test; deterministic tests do not establish correct research use.

## Intervention candidate 03: actionable level-review attribution (implemented)

The strict validator remains unchanged. Runtime context now exposes exact legal
behavior/evidence candidates and per-resource application candidates, schema fields
explain their distinct meanings, and `credits: []` is explicitly preferred over
unsupported attribution. A separate terminal marker mismatch (`ARC_TERMINAL_LEVEL_REVIEW`
with versus without a colon) was fixed. Five TypeScript behavior tests and two Pi
integration tests pass. This removes control-plane churn but is not itself a
capability-research success.

### Final verdict

Baseline 01 is a negative capability-acceptance result. It reached the experimental
2700-second cutoff normally (`pi_returncode=124`, no provider/environment errors)
at 41 ARC actions, 1/7 levels, state `NOT_FINISHED`. It produced 3 completed
research reports and one applied Auto-Research-origin skill route, but no task tool,
no task-tool invocation, no held-out multi-instance semantic validation, no linked
use evidence returned to research, and no revision/independent confirmation loop.
The skill's later context exposure is not semantic use. Preserve the run as the
baseline; test intervention 02 in a fresh paid successor. The overall manager goal
remains active.
