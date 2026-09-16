# ADR 0003: Lossless Auto-Research report storage

## Status

Accepted (the earlier count/length-cap proposal is superseded)

## Context

The `arc-full-20260915-ls20` run invoked Auto-Research 32 times. Twenty-eight
runs ended at the model output boundary, while the child runs accumulated
450,741 output tokens. The report-phase provider hook raised the available
output to at least 12,000 tokens, and successful results were duplicated across
the parent tool result, parsed run fields, the serialized report, and
`result.text`.

Research iteration count, evidence access, finding count, proposal count, and
delivery/report body length are Agent-owned and remain unrestricted. Provider
transport and context envelopes can still be finite, but those boundaries are
observable and the Agent chooses how to page, focus, archive, or defer; runtime
code must not silently discard canonical research content.

## Decision

1. Do not impose a local output-token cap on provider requests. Provider
   limits and `length` outcomes remain observable through telemetry.
2. Normalize submitted reports without count or character caps. Every finding,
   evidence reference, alternative, limitation, and approved proposal remains
   addressable in the canonical report. The capsule is an index/projection,
   not a lossy replacement; the complete report is recoverable through its
   exact `research_report:*` reference and paging.
3. Return `auto-research-capsule-v1` to the parent as a transport projection.
   Its fields may be projected for context fit, but no canonical field is
   deleted or rewritten to satisfy a local quota. The parent Agent can read
   the complete report when the projection is insufficient.
4. Store run metadata in `auto-research-runs.jsonl` and store the normalized
   report once in `auto-research-reports.jsonl`. Expose the latter as
   `research_report:<run-id>@v1` through paged `task_resource` reads.
5. Keep research call count, evidence-read count, and total evidence pages
   unrestricted. Existing read review thresholds remain advisory, not quotas.

## Consequences

### Positive

- Parent context growth is independent of the full report representation.
- Run records no longer duplicate report text in parsed fields and child
  result text.
- Exact normalized reports remain auditable and recoverable by reference.

### Negative

- The parent may need to page the complete report when the context projection
  is insufficient; this is an Agent-controlled retrieval decision.
- Harness proposals retain their complete canonical delivery in the approval
  ledger, so the parent does not need to reconstruct implementation details.
- Existing consumers that read full reports from `research_run:*` must follow
  the new `report_ref` to `research_report:*`.

### Neutral

- This decision does not schedule research, cap research iterations, limit
  evidence reads, or change benchmark action authority.
- Canonical environment observations and existing context archives are not
  compacted by this report policy.

## Alternatives Considered

**Prompt-only concision note**

Retained as a prompt note, but it is not treated as a token-limit enforcement
mechanism. If the provider returns `length`, the Auto-Research runtime preserves
the checkpoint and partial output, records a continuation receipt, and resumes
the same run/session without asking the parent model to rediscover that control
flow. This adds no local continuation count or output quota; explicit child
pause, cancellation, the official task deadline, and hard provider/transport
failures remain visible terminal boundaries.

**Per-task research, evidence-read, finding, and report quotas**

Rejected because the requirement is to preserve unrestricted research behavior
and let the Agent choose what is decision-relevant under provider constraints.

**Store every raw child stream and summarize later**

Rejected for the default path because it preserves the disk-growth failure and
does not prevent provider output truncation.

## References

- `demo/pi_auto_research_output.ts`
- `demo/pi_task_validation_child.ts`
- `demo/pi_task_local_subagents.ts`
- `docs/adr/0002-generic-task-local-context-lifecycle.md`
