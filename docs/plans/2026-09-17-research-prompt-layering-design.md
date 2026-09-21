# Safe research prompt layering

Approved direction: retain research semantics while reducing repeated operational
instructions. Do not change the scheduler, evidence authority, child permissions,
structured submission, routing or application lifecycle.

1. Keep parent complexity assessment, initial decomposition, dependency semantics,
   concurrency judgment and effect validation in the always-visible policy.
2. Provide a discoverable, read-only auto_research contract operation for procedural
   details. Preserve existing operations and schemas for compatibility.
3. Project the current child work unit explicitly, including global plan goal,
   completion contract and predecessor result references. Recover its identity on
   resume and keep research checkpoints separate from parent interpretations.
4. Retain selected parent summary provenance, counterexamples in summaries,
   decision capsules and pending operations; page optional source material.

Verification: failing boundary tests first, then research/context/lifecycle
regressions. Run the real ARC runner smoke for five components and both length
continuations. Fixtures do not prove model instruction-following or benchmark
quality. Full provider-token budgeting and semantic consolidation remain separate
follow-ups (deferred-research-todos.md, C/D).

## Verification record

The initial boundary tests failed for missing operations discovery, omitted
research checkpoint fields and absent current-node projection. Tests now cover
these boundaries, summary provenance and node identity across length continuation.
Combined regression: 111 passed across test_research_prompt_layers.py,
test_task_research_context.py, test_auto_research_self_harness_smoke.py and
test_arc_agi_3_e2e.py (168.30 seconds). These remain diagnostic checks.

Real-runner acceptance: `runs/arc-harness-smoke-prompt-layers-verified-20260917/arc-self-harness-smoke-summary.json`
reports passed=true for all eight scenarios, covering five component types,
semantic tool output, later parent turns and both research/delegate length paths.
The provider is deterministic; this does not measure real-model compliance,
token savings, length frequency or game performance.
