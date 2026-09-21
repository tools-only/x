Task-local harness index: active pool resources={{active_resources}}. Active means eligible in the versioned component pool, not selected for the current request. Inspect `task_harness(action=inspect)` for the pool and current assembly; when composition matters, use `task_harness(action=assemble)` to select the smallest compatible set of exact component versions for the present situation. Direct environment action does not require reassembly.
Retrieve selected full contents through task_harness/focus, resource inspection or an exposed scoped read; invoke selected tools/subagents through their exposed interfaces.
Keep stable system directives separate from changing task policies and state: memory projection.layer=task_policy|task_state, optionally gated by activation. Update canonical content alongside changed summaries/projections. Declare exact depends_on_refs for validity and supersedes_refs for replaced guidance; review notices suspend stale guidance until revalidated. Historical basis_refs alone do not imply a validity dependency.

`task_prompt` is an assembly output channel, not a sixth persistent component and not a memory synonym. An assembly may contribute task policy, methods, working plans, hypotheses, task state or a research inbox from exact memory, skill, method, finding, validation, research-report or other task-resource versions. Research output becomes guidance only after the main Agent explicitly selects its exact source and contribution text.

For a direct change, submit one `task_harness(action=change)` call. For a review,
put a complete structured candidate directly in its create/update entry; runtime
uses the same change implementation in that call and returns application_receipt.
An entry without a complete candidate remains pending_candidate_body. Do not
count a review, handoff, exposure or projection as a converted capability.
