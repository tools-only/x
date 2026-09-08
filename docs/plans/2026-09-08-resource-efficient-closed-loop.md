# Resource-Efficient Contract Disclosure and Email-Batch Loop

## Goal

Reduce OfficeBench model turns, resource probes, and bridge processes while preserving an optional, evidence-backed Auto-Research → Pi-native execution change → observed-effect loop.

## Selected design

Use a task-local hybrid resource catalog. The runner inspects only the freshly prepared testbed and task text, then writes `task-resource-catalog.json` before Pi starts. It contains a bounded relative-path inventory, relevant application names, the matching exact action contracts, generic task-language conventions, and a reference to the complete canonical `artifact-contract.json`. The Pi extension injects this compact catalog once at agent start. It does not expose evaluator data, sibling runs, source code, absolute paths, or hidden answers. The full contract remains an audit artifact rather than a repeatedly queried model tool.

Add an initially inactive `email_batch_action`. When the task catalog says email is relevant, a successful structured-source read can expose decision support for `email_batch`. The agent may cite that observation in `research_resource`, choose apply or keep, and—only on apply—use Pi's native `setActiveTools()` so the next model request sees the batch tool. One batch call performs 2–16 real `email.send_email` operations in one Python bridge process, preserves per-item non-atomic results, and starts the existing bounded effect-assessment path with an `email_batch_utilization` metric. Direct completion and no-change remain valid.

## Outputs and verification

1. `task-resource-catalog.json` exists before the Pi runner and is projected compactly in `summary.json`.
2. Initial model context contains the inventory and exact relevant action arguments; `task_artifact_contract` is absent from the active tool surface.
3. Email batch is absent initially, appears only after a valid finding-backed decision, and remains compatible with calendar work.
4. Effect assessment records attempted/completed email work units, batch calls, bridge-process compression, and supported/contradicted/inconclusive verdict.
5. Summary reports model turns, resource/action calls, semantic errors, bridge processes, completed work units, compression, and resource-disclosure reads.
6. Full pytest passes, then a fresh JIT-conda `3-6-0` run is compared with the current 27-observation / 9-turn result. A harness change is evidence only if the agent autonomously selects it; task success does not require it.

## Non-goals

- No generic mutation API, kernel research scheduler, evaluator disclosure, cross-task memory, or forced research.
- No claim of general harness improvement from one case.
- No unrestricted shell restoration.
