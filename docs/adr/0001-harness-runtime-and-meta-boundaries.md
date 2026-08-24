# ADR 0001: Harness Runtime and Meta-Harness Boundaries

## Status

Accepted

## Context

Meta-Harness studies executable Harnesses and their evolution. A Harness may define its
feedback loop at action, phase, episode, task, batch, or another explicit checkpoint
boundary. Treating TaskRun completion as the only boundary prevents faithful adapters for
online self-evolving baselines such as Continual Harness.

## Decision

Introduce a Kernel-backed `HarnessRuntime` contract. The concrete Task Harness owns loop
semantics and decides when to observe or checkpoint. Kernel persists events, immutable
objects, lineage, validated mutations, and separate capability projections. Meta-Harness
operates only on immutable Harness versions and projected evidence; it never mutates Task
state directly.

Candidate, current, evaluated, and promoted references remain distinct. Every mutation is
stale-base guarded and records its parent and trigger context. Task-local state is not
automatically promoted to methodology knowledge.

## Consequences

External baselines can preserve their native online behavior while using HOS persistence
and audit facilities. Experiments gain comparable version lineage and controlled promotion.
The Runtime adapter must provide any baseline-specific tools, sandbox, budgets, and inner
loops; these are not inferred by Kernel.

## Rejected alternative

Keeping evolution exclusively in the experiment loop after a complete TaskRun is simpler,
but it hard-codes one closure definition and cannot represent real-time Harness versions.
