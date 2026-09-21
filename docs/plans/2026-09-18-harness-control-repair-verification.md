# Harness control repair verification

Scope: source repair and mock ARC tests. No live run was stopped or restarted.

## Implemented behavior

- Deterministic selection of unique pending opportunity/handoff/session/plan/node
  and unassessed decision. Ambiguity returns candidates including complete refs;
  explicit unknown/stale references do not silently rebind.
- Review normalization fills omitted components with explicitly runtime-authored
  deferrals, aliases keep to reuse, and inherits complete pattern validation/use
  text. Semantic omissions return aggregated field errors and a repair template.
- Current-window and historical comparison evidence are classified separately.
  Historical references must exist in the task at or before the window endpoint.
- Handoff reader allowlist repaired; legal transitions, manual/action-count
  reactivation, version-checked cancellation, and replayable review commits added.
- Review/handoff budgets release auxiliary obligations after failures, excessive
  control calls, elapsed time at runtime boundaries, or action deferrals. All
  proposed handoffs are checked before an action proceeds. Infrastructure errors
  degrade immediately. Periodic policy requires an explicit runner setting.
- Failure correlation includes task, action, target and version. Resolution links
  identify the actual successful call; unrelated successes do not clear failures.
  A rejected resource version may recover only through its runtime-reported
  current version. Unknown application state is recorded as unknown.
- Child worksets reconstruct the latest parent checkpoint from snapshot plus
  durable patches, preserving current subgoals before snapshot flush.
- Schemas, status templates and parent/operation prompts describe the same rules.

## Executed checks

All commands used `D:/conda/python.exe` and unique workspace pytest basetemp roots.

1. Related regression suite: **211 passed** across harness control/review/entry,
   Auto-Research smoke, native benchmark extension, task research context, ARC e2e
   and prompt-layer tests (`.pytest-control-repair-final5`).
2. Final control/review boundary checks after the multi-handoff gate correction:
   **34 passed** (`.pytest-control-repair-last-gate9`).
3. Final prompt/entry checks: **18 passed**
   (`.pytest-control-repair-prompts-final10`). These suites overlap; counts are not
   additive unique-test totals.
4. `arc-harness-smoke --mock-environment`: **10 scenarios, 197 checks passed**.
   Final report: `runs/arc-control-repair-mock-20260918-verified/arc-self-harness-smoke-summary.json`.

The smoke uses the production ARC bridge, Pi parent, broker/process, structured
child return, code router, native harness mutation, ARC action boundary and a
later parent turn. SDK environment calls and model-provider responses are mocked.
The matrix covers memory/task_prompt projection, skills, tools (semantic output
2), subagents, system_prompt, periodic handoff without model-copied refs, and
provider-length continuation for both research and ordinary delegation.

Reproduction from the project root:

```powershell
$env:PYTHONPATH='D:/autoresearch_pi_project/src'
D:/conda/python.exe -m autoresearch_pi.cli arc-harness-smoke --mock-environment --root runs/<new-empty-run-root>
```

This verifies wiring and lifecycle behavior under deterministic inputs. It does
not establish real-provider instruction following, real-game quality or benchmark
performance. The existing deferred research-mode/independent-review work remains
outside this repair.

During regression diagnosis, older assertions expecting always-loaded research
guides, eagerly inlined child bodies and initially exposed scoped read were
aligned with the configured adapter, on-demand resource model and actual
enable/read sequence. Actual child context loss caused by stale checkpoint
snapshots was repaired in source, rather than relaxing that assertion.
