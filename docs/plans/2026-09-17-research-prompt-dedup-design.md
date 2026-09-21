# Research prompt deduplication, round 2

Scope approved after the prompt-size review: reduce repeated data and instruction
text without removing research capabilities. Tool schemas, availability, scheduler
gates, evidence rules and native delivery routing remain unchanged.

- Parent policy retains complexity assessment, initial decomposition, semantic
  release, concurrency, recovery and effect judgment in a shorter formulation.
- Child instructions merge repeated checkpoint, counterexample and missing-evidence
  guidance. Explicit inconclusive outcomes and blocking/non-blocking boundaries stay.
- New planned runs put plan_goal and completion_contract only in current_node,
  not generated constraints. Caller/node constraints are preserved. Existing saved
  sessions are not rewritten or cleaned with a string heuristic.
- Dynamic harness index/opportunity notices carry state and access hints, not a
  repeated capability catalog. Portfolio counts remain non-prescriptive.

Tests: first reproduce duplicate workset fields in initial and length-continuation
inputs, then assert one copy with user constraints and checkpoint provenance intact.
Replace the old prose-format assertion with parsed current_node values. Run prompt,
research, ARC, harness-entry regressions and real ARC runner smoke. Deterministic
provider checks establish wiring only, not model compliance or token savings.

Deferred: staged tool exposure and full provider-token budgeting require separate
compatibility work; no tool is hidden in this round. Cognitive continuity follow-ups
remain in deferred-research-todos.md (C/D).

## Size comparison

Compared with the working tree immediately before round 2, normalized to LF with
one trailing newline. Counts are characters, not provider tokens.

| Template | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| auto_research_main_contract.md | 3310 | 2214 | 33.1% |
| auto_research_child_contract.md | 2961 | 2142 | 27.7% |
| self_harness_index.md | 432 | 220 | 49.1% |
| self_harness_opportunity.md | 548 | 298 | 45.6% |

These percentages do not describe the complete request: tools, other instructions,
observations and history still consume context. Planned-child savings also depend
on the removed duplicate goal/contract length.

For the same memory smoke scenario's first requests, context-hook JSON telemetry
changed from 25031 to 23442 characters for parent (-6.3%) and 16863 to 16011 for
child (-5.1%). Tool definitions remained 13583/8671 characters respectively.
These are context_hook_fallback measurements, not provider-token accounting or a
real-model performance comparison; run-specific values also affect serialization.

## Acceptance

Real ARC runner smoke: all eight scenarios passed in
`runs/arc-harness-smoke-prompt-dedup-20260917/arc-self-harness-smoke-summary.json`.
This covers five component types, semantic tool output, later parent turns and
Auto-Research/ordinary delegate length continuation with a deterministic provider.

Expanded pytest regression: 173 passed, 5 failed (265.89s); all 111 tests in the
four directly affected research/context/ARC suites passed. The five failures were
reproduced at the same assertions using an isolated copy with this round's prompt
and runtime changes reverted (`.tmp/prompt-dedup-baseline-20260917`, 12.30s).
They predate this round and were not suppressed or used to expand permissions:

- test_empty_task_has_direct_creation_and_method_at_first_request: expects an
  Auto-Research guide despite no registered Auto-Research adapter.
- test_compact_arc_focus_projects_memory_body_after_creation: expects the ARC
  research contract in the same unregistered-adapter setup.
- test_actual_arc_skill_creation_has_a_reachable_read_use_boundary: expects read
  in the initial compact tool schema (the actual create/read calls succeeded).
- test_shared_external_extension_closes_finding_compaction_effect_loop: expects
  a historical parent prompt heading in the no-adapter system prompt.
- test_arc_task_subagent_runs_an_isolated_read_only_pi_loop: expects inline raw
  evidence rather than the current index/on-demand projection.
