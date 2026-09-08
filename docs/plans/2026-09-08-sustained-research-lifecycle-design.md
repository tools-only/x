# Sustained Task-Local Research Lifecycle

## Goal

Extend the current finding-driven execution-surface loop into a sustained,
auditable Auto-Research lifecycle without making research or harness mutation
mandatory and without adding a kernel research scheduler.

The lifecycle must distinguish four facts:

1. an agent opened a bounded question before or during exploration;
2. later task observations changed the agent's current conclusion;
3. a finding version, not merely a finding ID, justified a harness decision;
4. a system-computed effect assessment was explicitly absorbed, rejected, or
   left pending by the agent.

## Chosen design

`research-resources.jsonl` remains the append-only canonical resource. Each
line is now a complete versioned snapshot with a stable `goal_id` and
`finding_id`, plus a unique `research_event_id`, `version`, `action`, and
`supersedes_event_id`. Supported actions are `open`, `update`, `resolve`, and
`reopen`. The existing one-call record form remains compatible and is stored as
an active version-one `record` event.

An open goal records `question`, `scope`, `uncertainty`, and `evidence_plan`
without requiring evidence that does not exist yet. Updates and resolutions
must cite known task-local execution observations or known effect assessments.
Only the latest active finding version may justify a harness decision.
Decisions snapshot the exact finding version and evidence references used, so a
later update cannot retroactively change the decision basis.

System effect assessments remain separate, independently recomputable records.
They enter a compact pending-feedback digest on later model requests until an
agent-authored research update references their IDs. This prevents the runtime
from silently converting its own metric into an agent conclusion while also
preventing one-shot feedback from disappearing before it is incorporated.

## Context and storage efficiency

The model receives only:

- up to five latest unresolved research snapshots;
- up to five unabsorbed effect assessments, projected to IDs, verdicts, metric,
  relevant observations, work units, and compression.

Old versions and full assessment bodies stay on disk. Resolved goals disappear
from the repeated context digest. `summary.json` projects the latest state,
version history references, pending feedback, and lifecycle integrity without
duplicating full trace content.

## Closure semantics

The existing behavioral loop can establish that a finding-backed Pi mutation
was exposed and had a bounded observed effect. A stronger research lifecycle is
closed only when the relevant effect assessment is cited by a later
agent-authored update or resolution. A single case still cannot establish
general harness improvement.

## Failure handling

- Unknown execution or assessment references are rejected.
- Updates must target the latest known version.
- Decisions cannot use open or resolved findings.
- A decision stores immutable basis snapshots for later recomputation.
- Unabsorbed assessments remain visible as pending rather than being inferred
  as accepted.
- Append-only events survive timeout and preserve earlier versions.

## Verification

Tests cover legacy recording, open/update/apply/effect/resolve, compact context
disclosure, immutable decision bases, unknown references, no-change behavior,
and summary lifecycle projection. A real JIT high-recurrence case should then
confirm that the model can close the lifecycle without extra inventory or
contract reads.
