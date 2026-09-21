# Harness Boundaries and Assembly Implementation Plan

**Goal:** Separate Harness component mutation, the committed component pool, per-turn assembly, and the deterministic runtime, while making `task_prompt` a source-agnostic assembly channel.

**Architecture:** Keep the five persisted component kinds (`memory`, `system_prompt`, `skill`, `tool`, `subagent`) and add a versioned assembly manifest over their exact current versions. Prompt contributions live in that manifest and may cite any exact task-local source, including research reports, methods, findings, skills, or memories. The main Agent owns selection and contribution text; deterministic runtime code validates versions, renders the next request, applies tool/subagent availability, and records receipts.

**Constraints:** Implement on the current branch, preserve unrelated working-tree changes, keep the ARC adapter unaware of research/assembly policy, and treat component/offline tests as diagnostics rather than ARC closure.

---

### Task 1: Define the domain boundary

**Files:**
- Create: `demo/pi_task_harness_assembly.ts`
- Test: `tests/test_harness_assembly.py`

1. Add failing tests for exact-version component selection, non-memory prompt sources, activation, deterministic layer order, and assembly revision conflicts.
2. Implement pure types and functions for component-pool entries, prompt contributions, assembly manifests, selection, rendering, and structured conflicts.
3. Run the focused pure tests.

### Task 2: Add the main-Agent assembly interface

**Files:**
- Modify: `demo/pi_task_local_self_harness.ts`
- Modify: `demo/pi_task_resource_identity.ts`
- Modify: `demo/pi_task_resource_store.ts`
- Test: `tests/test_pi_harness_entry.py`

1. Add failing integration tests for `task_harness(action="assemble")`, pool inspection, exact selected versions, non-memory prompt projection, and stale assembly revision rejection.
2. Persist `task-harness-assemblies.jsonl` records and return an application receipt.
3. Keep legacy all-active behavior until the first explicit assembly exists.
4. Once an assembly exists, filter component exposure and dynamic tool availability by its exact selected refs.
5. Record selected and suppressed prompt contributions in the existing prompt-assembly receipts.

### Task 3: Enforce assembly at use boundaries

**Files:**
- Modify: `demo/pi_task_local_self_harness.ts`
- Modify: `demo/pi_task_local_subagents.ts`
- Modify: `demo/pi_external_benchmark_research.ts`
- Test: `tests/test_pi_harness_entry.py`

1. Prevent an unselected saved skill or saved subagent from being used while preserving ephemeral delegation.
2. Filter task system-prompt overlays using the same assembly manifest.
3. Reapply the selected dynamic-tool surface on later contexts so newly created tools do not bypass assembly.
4. Verify that pool membership, assembly selection, exposure, and actual use remain distinct.

### Task 4: Preflight versioned route application

**Files:**
- Modify: `demo/pi_task_local_self_harness.ts`
- Test: `tests/test_pi_harness_entry.py`

1. Add a failing test where an Auto-Research route was compiled against an older component version.
2. Preflight every route step before applying any step.
3. Bind an omitted update target to the current version, but reject an explicitly stale target without partial mutation.
4. Return current-version recovery data and preserve idempotent route receipts.

### Task 5: Teach the main Agent the new contract

**Files:**
- Modify: `demo/prompts/auto_research_method.md`
- Modify: `demo/prompts/self_harness_index.md`
- Modify: `demo/prompts/arc_decision_cycle.md`
- Modify: `docs/deferred-research-todos.md`

1. Define pool versus assembly, state that active does not mean selected, and describe `task_prompt` as an assembly channel.
2. Tell the Agent to choose the smallest compatible exact-version configuration for the current situation, while allowing direct action without reassembly.
3. Record which A/C/D backlog boundaries this implementation advances and which acceptance work remains.

### Task 6: Verify proportionally

1. Run pure assembly tests.
2. Run focused Pi integration tests for facade, lifecycle, adoption, context projection, subagent use, and provider-length continuation.
3. Run the broader related regression set.
4. If feasible in the current environment, run `arc-harness-smoke`; report deterministic wiring separately from real-provider quality.
