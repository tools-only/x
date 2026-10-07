# Real ARC monitoring: research opportunities expired by unrelated calls

Source run: `runs/arc-full-nojev-20260924-minimal/run`.

## Observed component conversion and use

The real provider authored `skill:arc-grid-avatar-nav@v1` after reading
skill-creator, selected it in assembly revision 1, and cited it in later ARC
action decisions (observations 6 onward). `effect-assessments.jsonl` links the
parent's supported assessment to `execution-observation-6` through actual_use_refs.
This is evidence of adoption and claimed use, not an independent proof of the
procedure's general correctness. The skill contains executable navigation steps,
but assumptions about sprite identity, blocked movement and HUD meaning remain
provisional. No authored artifact was rewritten by the monitoring agent.

## Root cause

Three research handoffs became deferred with `parent_reason=time_budget`,
`decided_by=runtime_budget`, and `resume_condition.kind=manual`. They included
the first periodic review, feedback from Skill assessment, and the next review.

The control event listener charged every task_harness/status/auto_research call
to the pending research handoff. For example the Skill assembly call at
2026-09-23T18:20:50.681Z counted against research-handoff-harness-review-1.
Elapsed wall time since that call then exhausted the 120000 ms management limit,
even though research had never started. Unrelated management calls could also
exhaust the 12-call limit. Runtime replaced the parent's research choice with an
automatic manual-only deferral.

The parent also expressed a research deferral in review arguments. That is not
evidence that the separate runtime-budget transitions were parent decisions.

## Targeted repair

Research handoffs no longer inherit periodic-review control budgets or expire
automatically. They stay proposed until explicit parent scheduling/decision.
Actual child execution budgets and permission boundaries remain unchanged.
Inspect exposes the control policy as periodic_review_only and research expiry
as none. This does not force the parent to start research or manufacture output.

Regression seeds a proposed handoff with old timestamps and 12 prior management
attempts, then runs public Pi inspection/method discovery. The handoff stays
proposed and no automatic state mutation occurs. Seven focused tests passed.
Real-runner acceptance artifacts: `runs/arc-research-budget-smoke-20260924/`.
Result: 15/15 passed, actual ARC environment and runtime boundaries, deterministic
provider. This does not certify autonomous provider behavior.

The old run and all artifacts are preserved when restarting with the repair.
Restarted run: `runs/arc-full-nojev-20260924-research-budget-fix/run`, PID 38768.
The old verified process tree (34648, 33376, 34716, 34264, 16240) was stopped;
no run artifacts were deleted. Jev remains disabled; neither an artificial action
limit nor an experiment total-time cutoff was supplied.
The session has no callable automation scheduling tool; monitoring during this
conversation is not a promise of unattended checks after the session ends.

## Post-restart observation

At 2026-09-24 02:49 Asia/Shanghai, the new run had seven ARC actions and no
environment errors. Main authored `skill:arc-frame-delta-decoder@v1`, selected it
alongside three memory versions at 02:48:34, and cited it in actions 6 and 7.
The skill is a parameterized delta-decoding procedure with worked trajectory
examples; this establishes conversion and action-linked use, not correctness of
every assumption (notably palette identification and HUD classification).

The first research handoff was deferred at 02:49:29 by an explicit parent
decision (`decided_by=parent`), not by runtime_budget. No research child result
was available at this checkpoint. One missing-name Memory submission was
corrected by the parent and all three memories entered the pool; it did not
prevent subsequent Skill authoring. This recoverable error did not trigger a
second restart. The new real-provider run remains active.
