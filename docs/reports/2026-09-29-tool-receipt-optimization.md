# Harness tool receipt optimization — 2026-09-29

Baseline: `runs/context-optimization-final-20260929/`. Final run:
`runs/creator-history-optimization-20260929/`. The baseline is the prior working tree,
not Git HEAD; unrelated changes were preserved.

## Implementation

- Later provider contexts replace a tool result's `details` with
  `{same_as_content:true}` only when the result's JSON text exactly matches the
  serialized `details`. The original tool result and its details remain intact.
  The existing control-receipt projection continues to handle `enable`,
  `activate`, and `focus` before this equality case.
- `task_harness(action="summary")` gives a compact live status directory.
  `task_harness(action="inspect", section="<name>")` returns one exact top-level
  section. `inspect` without `section`, `status`, and `task_harness_status`
  retain the full status and their existing schema/meaning. The resident index
  and short opportunity prompts point to the summary and section path.
- Creator reads still return their complete version-bound instructions. No
  method hash, parent authoring prerequisite, stored observation, or native
  mutation contract was changed.
- A creator read is shortened in later provider contexts only after a successful
  `task_harness(change)` uses that exact `authoring_method_ref`. The historical
  receipt includes the method hash and exact `read_method` recovery call. Reads
  without a matching applied change remain complete; original tool results are
  never rewritten.

## Evidence

- Final deterministic real-runner ARC smoke: 16/16 scenarios passed. Scenario
  identities, research scopes and every check result match the baseline.
  All 16 bridge-result and bridge-events files are byte-identical. The matrix
  includes all five component types, semantic tool output, later parent turns,
  and provider `length` continuation for Auto-Research and ordinary delegation.
- Across 205 matched parent provider requests, the peak fell from 209,315 to
  145,332 JSON characters (30.6%). The original `minimal-five-pool` peak fell
  from 209,315 to 103,891 characters; its tool results fell from 165,766 to
  59,245 characters. The largest individual request reduction from the previous
  pass was 63,568 characters. The sum over repeated requests fell by another
  2,293,453 JSON characters relative to the previous pass. This adds savings
  across repeated requests; it is `context_hook_fallback` JSON measurement,
  not tokenizer output or unique text saved.
- Focused suites passed: `test_pi_harness_entry.py` 43/43,
  `test_harness_review.py` 21/21, `test_research_prompt_layers.py` 9/9,
  `test_context_continuity.py` 12/12, and `test_arc_context_budget.py` 5/5.
  The continuity assertion now checks the prior optimization's on-demand
  induction read path instead of expecting its full body in every periodic prompt.
  These are diagnostic checks, not ARC closure evidence.

The remaining 145,332-character peak is a periodic review request. Its largest
parts are recent tool results (85,968), tool definitions (19,509), other
messages (12,904), an ARC observation projection (8,712), and the current
checkpoint (5,061). The live review/status result and recent action evidence
are still needed at this decision point. Their exact state is not yet stored as
an independent, version-addressed status snapshot, so this change does not
silently remove them from the current provider request.

The smoke uses a deterministic provider and mocked environment while running
the real bridge, Pi parent and child process, router, native Harness mutation,
ARC action boundary and later parent turn. It verifies wiring/lifecycle
reachability, not real-provider strategy quality. Deferred item D in
`docs/deferred-research-todos.md` remains open: exact recovery exists, but
semantic continuity across compaction requires a separate assessment.
