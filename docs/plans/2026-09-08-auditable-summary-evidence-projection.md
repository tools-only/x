# Auditable Summary Evidence Projection

## Goal

Make each OfficeBench `summary.json` independently useful for auditing the task-local Auto-Research → Self-Harness loop without duplicating full traces or inventing unrecorded model reasoning.

## Design

Canonical JSONL files remain the source of truth. The summary adds a compact `closed_loop_evidence` projection containing:

- every agent-declared structured research goal and its finding;
- the execution observations cited as evidence, using their already-bounded summaries;
- the task-local capability catalog at the decision boundary, including initially inactive capabilities, scope, and effect timing;
- every self-harness decision, its finding basis, exact Pi-native operation, before/after surfaces, next-request observation, and bounded effect;
- an ordered chain of record IDs and paths back to canonical sources.

The projection never copies `pi-events.jsonl`, full tool output, or hidden model reasoning. Exploration that the agent did not declare through `research_resource` is not inferred and is reported as outside structured-goal coverage.

## Boundaries

- No required research stages or scheduler.
- No automatic finding or mutation.
- No generic mutation API or Pi protocol rewrite.
- No-change remains valid and is represented with an empty change list plus the available capability catalog.
- `execution_condition_effect=supported` remains task-local; `harness_improvement` remains `not_established` without broader comparative evidence.

## Verification

1. Offline native Pi test checks that the capability catalog is persisted before the first model request and each research resource receives a stable goal ID.
2. Python unit test builds a linked finding/decision/exposure/effect chain and checks the self-contained projection.
3. Full test suite.
4. Fresh JIT Level 3 run; inspect its generated summary and canonical records.
