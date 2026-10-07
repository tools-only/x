# 2026-09-29 Agent context optimization

The comparison baseline is the working tree snapshot in
`tmp/context-optimization-baseline-20260929/`, not Git HEAD. Existing unrelated
working-tree changes were preserved.

## Changes

- The recurring self-harness opportunity message is 949 characters / 113 words,
  down from 5,994 characters / 784 words. Its former text is byte-identical to
  `demo/prompts/harness_opportunity_reference.md` and is available through
  `task_harness(action="contract", topic="opportunity")`.
- Periodic review still names the transition-analysis fields and current evidence
  entry point. It now links to the complete induction method through
  `topic="induction"` and to the live review schema through `action="inspect"`,
  instead of repeating the 4,559-character method and review schema each time.
- `enable`, `activate`, and `focus` return short model-facing control receipts.
  The original full status remains in the tool result details and is available to
  the Agent through `action="inspect"`. Transcript projection replaces repeated
  full details only for these receipts. The control-receipt probe observed about
  395-398 characters for both content and projected details; explicit inspect
  still returned the full status.

## Acceptance evidence

- The final deterministic ARC runner smoke is
  `runs/context-optimization-final-20260929/arc-self-harness-smoke-summary.json`:
  16/16 scenarios passed. All scenario/check results match
  `runs/context-optimization-before-20260929/arc-self-harness-smoke-summary.json`.
  All 16 bridge-result and bridge-events files are byte-identical. Provider
  context summaries match after removing only `recordedAt` timestamps. The
  matrix covers all five component types, semantic tool output, later parent
  turns, and provider `length` continuation for Auto-Research and ordinary
  `delegate_task`.
- Final focused tests: `test_pi_harness_entry.py` 41 passed,
  `test_research_prompt_layers.py` 9 passed, and `test_harness_review.py` passed
  on its final run. These are diagnostic checks, not ARC closure evidence.
- Across 205 matched parent provider requests in the smoke, 53 requests fell by
  more than 100 JSON characters. The largest single-request reduction was
  63,397 characters. The largest context changed from 248,843 to 209,315 JSON
  characters. The repeated-request total fell by 1,671,711 JSON characters;
  this is a sum across requests, not unique text or tokenizer-measured tokens.
  The measurement basis is `context_hook_fallback`.

The smoke uses deterministic provider and mock environment, while exercising the
real ARC bridge, Pi loops, child broker/process, router, native Harness mutation,
action boundary, and later parent turn. It proves wiring and lifecycle reachability;
it cannot establish real-model strategy quality or game performance. The initial
tool schemas remain a major context cost. Deferred item D in
`docs/deferred-research-todos.md` still requires a cross-compaction test of
semantic continuity and evidence recovery.
