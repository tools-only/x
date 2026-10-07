# ARC timeout and minimal admission repair

## Diagnosis

The previous run, `runs/arc-full-nojev-20260923-220010/run`, was NOT a full
benchmark run. Its summary records an explicitly configured 1200-second runtime
limit and 20-action limit. It timed out after 15 actions; provider errors and
environment errors were both zero. The experiment cutoff, not bridge readiness
or provider failure, explains this termination.

Separate parent operation errors interrupted useful work: research start omitted
the creator reference; capability review contained no carrier decisions; effect
assessment omitted its target when two decisions were eligible. Research method
quality checks could additionally reject a partial method before parent authoring.

## Changes and boundaries

- Skill/Tool/Subagent creation reuses a recorded read of the current creator when
  the candidate omits its reference. Explicit stale/wrong references still fail.
  The resolved reference is persisted. Creator reading and semantic authoring
  remain the parent's responsibility.
- Research start without a creator read returns the full research-orchestration
  method and the original request as a retry. It starts no child. The parent reads,
  confirms or revises, then resubmits; later calls may omit the reference.
- Partial research methods survive normalization and reach parent authoring
  handoffs and candidate lifecycle records. Abstraction quality is advisory, not
  admission policy. They are not labelled validated, grounded, or native components.
- Empty carrier reviews return an explicit non-applied result. Omitted carriers
  remain unresolved; runtime does not invent a parent decision.
- Ambiguous effect assessments return candidate targets and callable retries.
  No assessment is recorded until the parent selects the intended target.
- Failed review candidates and transition analysis are retained as drafts and
  exposed through inspect and parent followups. Their direct-change fallback
  remains usable after the periodic review window expires. This does not apply
  an invalid component or bypass creator/runtime checks.

Pool membership is still distinct from activation. Exact-version selection,
execution permissions, executable schemas, lifecycle scope, and real observation
references remain enforced. A full method dossier, cross-situation reuse, prior
success, or completed research is not a component admission prerequisite.

## Verification

Initial real-runner smoke: `runs/arc-minimal-admission-smoke-20260924/arc-self-harness-smoke-summary.json`:
15/15 passed with the actual ARC environment, bridge, Pi parent and child broker.
The provider is deterministic. Coverage includes five component types, semantic
tool/subagent results, later parent turns, and research/delegation length continuation.
This verifies runtime wiring, not autonomous model behavior or game performance.

Final-code repeat: `runs/arc-minimal-admission-smoke-20260924-final/`: 15/15 passed,
environment_mocked=false, provider_mocked=true.
Focused regression: 82 passed (`runs/pytest-minimal-admission-20260924-final/`).
Three additional research lifecycle checks passed. The expanded failed-review
recovery test also passed: after window expiry and parent restart, the parent
recovers the stored body, reads the creator, supplies the missing use description,
and creates the exact skill version through the public change API.

Real-provider run: `runs/arc-full-nojev-20260924-minimal/run`.
Launched with Jev disabled and without `--max-actions` or `--experiment-timeout`.
The environment's native action budget still applies. Completion and autonomous
component quality must be assessed from this run's actual artifacts, not inferred
from smoke results. Skill projection alone does not demonstrate use or utility.
