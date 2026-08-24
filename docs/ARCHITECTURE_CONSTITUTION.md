# Meta-Harness Architecture Constitution

This document is normative. A refactor is invalid if it violates one of these rules, even
when the implementation is otherwise functional.

## 1. Layer ownership

The system has three layers with non-overlapping responsibilities:

* **Task Harness** executes tasks, owns task-local state, chooses its feedback boundary,
  and may evolve itself at any supported runtime boundary.
* **Kernel** owns persistence, content-addressed objects, immutable versions, lineage,
  schema validation, transactional mutation, event audit, and capability projections.
* **Meta-Harness** proposes hypotheses, creates candidate Harness versions, runs controlled
  comparisons, evaluates evidence, and promotes or rejects versions.

Meta-Harness never replaces Task Harness execution. Task Harness never writes Meta
methodology directly. Kernel never decides when a Harness should evolve.

## 2. Harness-first rule

There is no Meta-Harness without an executable Harness. Every Meta experiment must name an
immutable Task Harness version and must execute that version under a reproducible job.

## 3. Closure autonomy

The unit of a feedback loop is Harness-defined. It may be an action, tool result, phase,
episode, task, batch, or explicit checkpoint. Kernel APIs must support all of these units;
they must not force task-completion-only evolution.

## 4. Immutable versioning

Published Harness, Agent, Policy, Skill, Subagent, Memory, and mutation objects are
immutable. Any change creates a successor with `parent_harness`, `created_by_run`, trigger
event, evidence references, and an auditable mutation record. Candidate creation never
changes the current ref.

## 5. Evidence authority

Only the environment/evaluator produces authoritative outcome metrics. Model claims,
messages, reasoning, and Meta judgments are diagnostics unless explicitly projected into a
validated evidence schema.

## 6. Information isolation

Task may read raw task state and task-local trajectory. Meta receives only Kernel-approved
projections containing version identity, diffs, authoritative metrics, usage, and validated
task-agnostic methodology. Raw commands, paths, answers, environment details, and raw
transcripts must not enter Meta knowledge by default.

## 7. Scope isolation

Task-local mutations use `scope=task-local`. Methodology changes use
`scope=methodology-reviewed` and require explicit Meta evidence and promotion. A task-local
memory entry is never automatically promoted to methodology memory.

## 8. Transactional mutation

Every mutation is validated before publication, records rejection reasons, is based on an
explicit Harness digest, and is committed with stale-base protection. `current`,
`candidate`, `evaluated`, and `promoted` refs are distinct concepts.

## 9. Algorithm fidelity

An external baseline adapter must preserve its closure triggers, component schemas, tool
permissions, budgets, sandboxing, rollback behavior, and observation semantics. Kernel
infrastructure may enforce safety and persistence, but may not silently change baseline
behavior.

## 10. Required negative guarantees

The test suite must prove that Task cannot write Meta methodology, Meta cannot bypass Kernel
to mutate current Harness, non-evaluable runs cannot promote versions, stale mutations cannot
overwrite newer refs, deleted components do not reappear, and raw Task evidence is absent
from Meta projections.

Any change that weakens a rule requires a new architecture decision record and an explicit
experimental compatibility profile.
