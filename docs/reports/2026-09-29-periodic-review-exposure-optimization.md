# Periodic review exposure optimization — 2026-09-29

## Scope

The ARC parent still submits the same evidence-linked periodic review. The
complete review, transition analysis, research handoff and child contract remain
durable. This change reduces what the parent receives by default at the review
boundary and makes exact detail reads explicit.

- ARC `task_harness(review)` returns a short receipt with the review ref,
  parent dispositions, current research handoff ref/status, ready research calls
  and any native application receipt. The complete review is readable as
  `harness_review:<review_id>@v1`; the existing research handoff is readable by
  its exact `research_handoff` ref. Non-ARC review results remain unchanged.
- ARC `task_harness(inspect)` without a section returns the status directory.
  `inspect(section=...)` returns one exact section; `status` and
  `task_harness_status` retain the complete status. Non-ARC `inspect` remains
  complete. The directory preserves `null` for an unset focus.
- The task resource reader now resolves a research handoff by its own
  `handoff_id` even when that record also contains a related `review_id`.
  It likewise resolves whole-level reviews by the advertised `window_id`.
- ARC prompts and deterministic smoke calls use explicit status sections where
  the component pool or a specific queue is needed. The smoke's selected
  Memory check now requires the actual memory projection rather than matching
  the same text anywhere in the transcript.

The review cadence, evidence validation, research choice, component authoring,
assembly, ARC action gate and child execution contract were not changed.
`task_resource` is exposed while a research handoff is pending so the receipt's
exact read calls are immediately reachable. Full status remains an explicit
choice when multiple sections are needed together.

## Evidence

Baseline: `runs/creator-history-optimization-20260929/`.
Final: `runs/periodic-review-verified-20260929/`.
Both use the deterministic provider and mocked game environment through the real
ARC bridge, Pi parent, child broker/process and native Harness/action boundaries.

| Matched parent provider requests | Before | After |
| --- | ---: | ---: |
| Count | 205 | 205 |
| Largest request, JSON chars | 145,332 | 122,461 |
| Sum across requests, JSON chars | 13,326,869 | 12,184,266 |
| `periodic-tools` largest request, JSON chars | 145,332 | 93,446 |
| `periodic-tools` peak recent tool results, JSON chars | 85,968 | 34,002 |

The global peak moved to `cross-context-method` turn 10. These are
`context_hook_fallback` JSON measurements, not exact tokenizer output. The sum
counts repeated input across requests; it is not unique text saved.
In the matched `periodic-tools` trace, the review result text fell from 18,795
to 1,194 characters, and the subsequent unsectioned `inspect` result fell
from 33,804 to 2,157 characters. Complete records remain readable by exact
refs or explicit full status calls.

The final real-runner smoke passed all 16 scenarios, including the five
component types, semantic routed Tool output, later parent turns and provider
`length` continuation for Auto-Research and ordinary delegation. All 16
`bridge-events.jsonl` files are byte-identical to the baseline. Three optional
diagnostics passed: round-two review recovery, direct development intent and
online retrospective. The relevant integration suites passed 91/91 tests.

This proves wiring and lifecycle reachability under a deterministic provider.
It does not measure real-provider decision quality or ARC game performance.
Deferred item D in `docs/deferred-research-todos.md` remains open: exact
recoverability alone does not prove semantic continuity after compaction.
