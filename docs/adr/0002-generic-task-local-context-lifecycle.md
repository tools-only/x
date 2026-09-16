# ADR 0002: Generic task-local context lifecycle

## Status

Accepted

## Context

Task-local memory, system-prompt overlays, skills, tools, subagents, research findings, and
execution results are durable run artifacts, but Pi's provider transcript is a
finite working projection. Re-appending those projections on every context
event, together with historical tool results, causes unbounded provider
payload growth. The ARC `ls20` treatment reached one completed level and then
timed out while the provider request grew to roughly 2.45 million characters.

The problem is shared by ARC, Terminal-Bench, OfficeBench, research, and other
long-running tasks. An adapter-specific frame compactor cannot control the
whole transcript.

## Decision

Install one adapter-independent task-local context lifecycle in the shared
external benchmark extension. Before each provider request it:

1. keeps the initial task prompt and a recent valid message suffix;
2. deduplicates generated task-local projection messages, retaining the newest
   version of each category;
3. replaces older history with a small archive marker containing role/tool
   counts and recoverability references;
4. treats an assistant tool-call message and its following tool results as an
   indivisible provider-transcript transaction.  A suffix may start at that
   assistant message, never at a tool result.  In particular, a later user
   continuation must not cause the immediately preceding call/result pair to
   be archived;
5. bounds oversized retained messages; and
6. records before/after metrics in `task-context-compactions.jsonl` without
   modifying canonical task artifacts.

The shared external task surface also writes a compact
`task-checkpoint.json`. Runtime facts (latest observation, bounded recent
observations, environment fields, and harness-start state) are updated after
tool results. The Agent may update only the decision fields: current subgoal,
hypothesis, next step, and evidence/decision references. The checkpoint is
projected as one deduplicated context resource on every request.

PiKernel adapters may configure a generic agent-loop watchdog with read-only
tools and progress tools. Its mutable state is session-scoped rather than
turn-scoped because Pi can open a new turn after each tool result. It
canonicalizes each read operation's inputs and semantic evidence version,
recognizes alternating read sequences, injects a compact steering request
after a bounded number of repeated reads, and aborts the active turn after a
second failed intervention so the outer runner can resume from the
checkpoint. New evidence or a progress operation clears the stagnant-read
counter. The watchdog never selects a task action or creates a task resource.

The default projection budget is 400,000 JSON characters, with environment
overrides for controlled experiments. If the initial prompt, archive marker,
and protected latest transaction do not fit, the lifecycle first removes
provider-only `details` and then shortens visible text, reasoning, and other
non-structural provider strings while retaining the tool-call IDs and
`toolCallId` links. This is a degraded but recoverable
projection, not permission to drop the transaction. The compaction audit
records `budget_degraded`, retained transaction count, and whether the latest
transaction and result were preserved.

`PI_AUTORESEARCH_CONTEXT_LIFECYCLE=disabled` is reserved for ablations. Native
Pi skill loading remains disabled.

## Trade-offs

This deterministic lifecycle avoids extra model calls and is predictable, but
its archive marker is not a semantic summary. Exact historical content must be
retrieved from task-local artifacts when needed. Prioritising a complete latest
transaction can retain slightly less ordinary recent prose than a pure
message-count policy; this is deliberate because orphaning a tool result breaks
the next decision. A future semantic summarizer may be added behind the same
projection interface, but must preserve IDs, evidence references, and complete
tool-call/result links.

## Failure handling

If a message cannot be serialized, its string representation is counted. If a
single message exceeds the per-message budget, text is truncated and details
are reduced to their top-level keys. If a protected transaction exceeds the
total budget, the audit is marked degraded rather than silently removing its
tool topology. Raw event sinks remain authoritative.
