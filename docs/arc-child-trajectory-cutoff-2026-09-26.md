# ARC child trajectory cutoff: diagnosis, contract, and verification

## Real-run finding

In `runs/arc-capability-closure-ft09-20260926-v2/run`, the first Auto-Research child had `inspect_arc_trajectory` in its provider tool definitions, but its tool result was an error: `PI_ARC_BRIDGE_URL is not configured`. Its report therefore said it could not read action history. This was a wiring defect: `pi_task_local_subagents.ts` deliberately removes the live bridge URL from child processes, while `pi_arc_trajectory_resource.ts` previously required that URL. `arc_state` already had a separate parent-published snapshot path. The historical ARC bridge log had the missing action coordinates and outcomes; task execution observations did not preserve that exact trajectory projection.

## Implemented boundary

When an ARC child has `inspect_arc_trajectory`, the parent reads the canonical bridge `transitions` projection once at launch and appends a versioned `arc_trajectory_snapshot` resource in the task root. The resource contains the complete canonical transition list at that moment, including action IDs, coordinates, state and level changes, changed-cell counts, and bounding boxes. It records the last action ID, source count, digest, and `bridge-events.jsonl` provenance. A unique exact ref is granted to the child and passed outside the workset through `PI_TASK_CHILD_TRAJECTORY_REF`; the prompt names the ref as a locator. Child launch still deletes `PI_ARC_BRIDGE_URL` and grants no action tool.

The child `inspect_arc_trajectory` tool reads only that exact resource. Its default view is the latest 20 actions and any requested view is limited to 256 actions, with the bridge-compatible `transitions`, `repeated_actions`, and `level_boundaries` shapes. This is an output limit, not an archive retention limit: the complete immutable resource is pageable through `task_resource` under the exact grant. `arc_trajectory_snapshot:*` cannot authorize later snapshots. New child launches get new cutoffs; a resumed child process using the same invocation context keeps the prior ref. The parent's own `inspect_arc_trajectory` keeps its live, read-only bridge behavior.

No historical v2 log was rewritten. The v2 process was still running while source changed: its child-2 continuation at 20:11:32Z loaded the changed child tool and reported `parent-published ARC trajectory snapshot is not available` instead of the earlier `PI_ARC_BRIDGE_URL is not configured`. That later v2 segment is a mixed-source run, not valid evidence that a clean launch exercised snapshot publication. The v2 run was stopped at 04:16:37. A fresh launch is required for this fix to be evaluated end to end. This change does not imply that the ARC self-harness acceptance matrix or real-provider benchmark performance has passed.

## Checks

- `node tests/pi_arc_trajectory_snapshot_fixture.ts`: fixed cutoff after a later parent action, action/outcome fields, all three projections, 256-action output bound, older-history pagination, exact-grant rejection, wildcard rejection, and cross-task rejection.
- `python -m pytest tests/test_pi_external_benchmark_native.py -k selected_subagent_reads_fixed_trajectory -q`: real Pi parent, valid explicit Harness assembly, child broker/process, semantic child tool result, and exact resource pagination. The child saw action 3 at `(3,4)` with two changed cells, then followed the returned `history_access.read` call to recover actions 1 and 2 with their coordinates and outcomes. The mock bridge saw exactly one `/trajectory` request, from parent publication.
- `python -m pytest tests/test_arc_agi_3_e2e.py -k trajectory_projection -q`: canonical bridge projection contract.
- Import check for the ARC extension and shared subagent modules.
- `python -m autoresearch_pi.cli arc-harness-smoke --root runs/arc-trajectory-cutoff-subagents-smoke-20260926 --case subagents` with the current real ARC SDK: the real-bridge subagents case passed 22/22 checks (`environment_mocked=false`, deterministic provider). That case verifies the broker, route, native mutation, assembly, ARC action boundary, and later parent turn; it does not by itself call the trajectory tool. The native integration check above directly covers the trajectory tool.

Two older native delegation fixtures currently fail before child launch because their scripted provider creates a saved subagent and immediately delegates it without selecting it in the current Harness assembly. The recorded failure is `required_selection`; these fixtures do not exercise the trajectory path and need protocol updates separately.

For end-to-end closure, run a fresh `arc-harness-smoke` through the real bridge/Pi parent/child broker/router/action boundary and a later parent turn. Assert that the child receives semantic trajectory content rather than only a completed status, and include provider-length continuation for Auto-Research and ordinary `delegate_task` as required by `AGENTS.md`. A real-provider run remains necessary for claims about provider behavior or game quality.

This work is related to deferred items A and B/C in `docs/deferred-research-todos.md`: separating read-only trajectory evidence from environment action authority, and allowing child research to cite exact public observations. It does not implement child-owned experiment actions or semantic trajectory interpretation.
