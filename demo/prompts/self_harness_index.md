Task-local harness index: active resources={{active_resources}}. Retrieve full contents through task_harness/focus, resource inspection or an exposed scoped read; invoke tools/subagents through their exposed interfaces.
Keep stable system directives separate from changing task policies and state: memory projection.layer=task_policy|task_state, optionally gated by activation. Update canonical content alongside changed summaries/projections. Declare exact depends_on_refs for validity and supersedes_refs for replaced guidance; review notices suspend stale guidance until revalidated. Historical basis_refs alone do not imply a validity dependency.

For a direct change, submit one `task_harness(action=change)` call. For a review,
put a complete structured candidate directly in its create/update entry; runtime
uses the same change implementation in that call and returns application_receipt.
An entry without a complete candidate remains pending_candidate_body. Do not
count a review, handoff, exposure or projection as a converted capability.
