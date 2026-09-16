# Agent-Owned Task-Local Harness Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task agent turn observations into independently versioned task-local memory, skills, bounded tools, and subagents, then let Auto-Research verify or revise those components through the same Pi-native loop.

**Architecture:** Keep Pi as the only model and tool runtime. Extend the existing task-local resource stores with component references and a bounded adapter-owned task-tool registry; research resources remain optional, evidence-backed, and able to describe or verify component hypotheses. The Python runner only supplies isolation, event persistence, and evaluation.

**Tech Stack:** TypeScript Pi extensions, TypeBox schemas, JSONL task-local stores, Python pytest integration fixtures.

**Spec:** `docs/plans/2026-09-11-pi-native-research-self-harness-architecture.md`

## Global Constraints

- Agent decides whether to explore, research, create, update, combine, retire, or ignore a component.
- Research finding is not a prerequisite for creating or using a component; `basis_refs=[]` remains valid.
- No Python scheduler, global `HarnessState`, generic `mutate_harness`, policy compiler, or external refiner.
- Pi-native loop, hooks, dynamic tools, resource loading, and child Pi loops remain the execution mechanisms.
- Task tools may execute only adapter-provided implementations and may not load arbitrary host extensions.
- Control runs receive the common benchmark adapter but no task-local research or harness management surface.
- Append-only JSONL history remains the source of truth; summaries are derived projections.

### Task 1: Add component references to research resources

**Files:**
- Modify: `demo/pi_external_benchmark_research.ts:18-44,243-286,357-435,471-538`
- Test: `tests/test_pi_external_benchmark_native.py`

**Interfaces:**
- Consumes: task-local component version identifiers emitted by memory, skill, and subagent stores.
- Produces: optional `component_refs` on research resource versions and in the active finding digest.

- [ ] **Step 1: Write the failing test**

Add a fixture step that records a finding with `component_refs=["memory:route@v1", "skill:probe@v2"]`, then assert the persisted finding and later context digest retain those exact references.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pytest tests/test_pi_external_benchmark_native.py -k component_refs -v`

Expected: FAIL because the research tool schema and finding record omit `component_refs`.

- [ ] **Step 3: Implement the minimal behavior**

Extend the finding type, TypeBox schema, record/update merge logic, and active/open digests with a bounded optional string array. Preserve unknown references as explicit agent claims; do not invent a second component registry or force a finding gate.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pytest tests/test_pi_external_benchmark_native.py -k component_refs -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/pi_external_benchmark_research.ts tests/test_pi_external_benchmark_native.py
git commit -m "feat: link research findings to task components"
```

### Task 2: Implement adapter-bounded task-local tool lifecycle

**Files:**
- Create: `demo/pi_task_local_tools.ts`
- Modify: `demo/pi_task_local_self_harness.ts:15-21,23-31,172-764`
- Modify: `demo/pi_external_benchmark_research.ts:188-194,450-458`
- Test: `tests/test_pi_external_benchmark_native.py`

**Interfaces:**
- Consumes: a `TaskToolAdapter` with `adapterId`, allowed implementation references, and an executor factory.
- Produces: `task_tool(action=create|update|retire|inspect, ...)`, versioned `task-tools.jsonl`, dynamic Pi tools with unique versioned names, and `task-tool-events.jsonl` registration/invocation/retirement facts.

- [ ] **Step 1: Write the failing test**

Add a fixture adapter whose only implementation is `fixture.echo`. Have the scripted agent create `echo`, invoke its returned `task_tool_echo_v1` name, update it to v2, retire it, and assert that an unsupported implementation is rejected and the event store contains registration, invocation, and retirement facts.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pytest tests/test_pi_external_benchmark_native.py -k task_tool -v`

Expected: FAIL because no `task_tool` management tool or dynamic task-tool store exists.

- [ ] **Step 3: Implement the minimal behavior**

Define the adapter interface and a task-tool installer. Validate names, descriptions, bounded schemas, adapter implementation allowlists, and optimistic version targets. Register each active version through `pi.registerTool` with a bounded `input` object schema, include the stored schema and implementation reference in the tool description, activate the new version with `pi.setActiveTools`, remove retired versions from the active set, and append immutable lifecycle events. Keep `task_tool` active so the agent can revise its portfolio. Add `task_tool` to the management-tool exclusion list so management calls are not mistaken for environment observations.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pytest tests/test_pi_external_benchmark_native.py -k task_tool -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/pi_task_local_tools.ts demo/pi_task_local_self_harness.ts demo/pi_external_benchmark_research.ts tests/test_pi_external_benchmark_native.py
git commit -m "feat: add adapter-bounded task tool portfolio"
```

### Task 3: Connect the ARC adapter to the bounded task-tool surface

**Files:**
- Create: `demo/pi_arc_task_tools.ts`
- Modify: `demo/pi_arc_agi_3_extension.ts:1-80`
- Test: `tests/test_arc_agi_3_e2e.py`

**Interfaces:**
- Consumes: `TaskToolAdapter` and the ARC bridge state reader.
- Produces: one adapter-allowed read-only implementation, `arc_state_projection`, which can be created as a task-local versioned tool without exposing hidden ARC state or arbitrary code execution.

- [ ] **Step 1: Write the failing test**

Add a static/integration assertion that treatment exposes `task_tool`, control does not, and an ARC task tool can only use the adapter implementation reference and returns public state fields.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pytest tests/test_arc_agi_3_e2e.py -k task_tool -v`

Expected: FAIL because ARC does not provide a task-tool adapter.

- [ ] **Step 3: Implement the minimal behavior**

Create an ARC adapter with a single public-state projection executor. Pass it to `externalBenchmarkResearch`; keep the control branch disabled and leave `arc_action` semantics unchanged. Record the adapter id, permission, and implementation reference in task-tool records.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pytest tests/test_arc_agi_3_e2e.py -k task_tool -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/pi_arc_task_tools.ts demo/pi_arc_agi_3_extension.ts tests/test_arc_agi_3_e2e.py
git commit -m "feat: expose bounded ARC task tools"
```

### Task 4: Expose component usage and cost without creating a scheduler

**Files:**
- Modify: `demo/pi_task_local_self_harness.ts:599-763`
- Modify: `demo/pi_task_local_subagents.ts:300-430`
- Test: `tests/test_pi_external_benchmark_native.py`

**Interfaces:**
- Consumes: component lifecycle stores and native Pi context/tool events.
- Produces: compact context cards showing active component versions, usage counts, and subagent cumulative cost; append-only usage observations that distinguish created, exposed, read, invoked, and assessed states.

- [ ] **Step 1: Write the failing test**

Create a skill and invoke a subagent in the fixture. Assert that later context exposes the active skill and subagent version with bounded usage facts, while no automatic creation or review call is emitted.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pytest tests/test_pi_external_benchmark_native.py -k usage_card -v`

Expected: FAIL because subagent usage is not included in the compact context card and skill/subagent states are not uniformly exposed.

- [ ] **Step 3: Implement the minimal behavior**

Add bounded counts and costs to the existing context projection, derive them from append-only invocation/event stores, and retain the existing agent-owned decision boundary. Do not add review_due flags, automatic triggers, or a cross-component ledger.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pytest tests/test_pi_external_benchmark_native.py -k usage_card -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/pi_task_local_self_harness.ts demo/pi_task_local_subagents.ts tests/test_pi_external_benchmark_native.py
git commit -m "feat: disclose bounded task component usage"
```

### Task 5: Verify the end-to-end research-to-component loop

**Files:**
- Modify: `tests/test_pi_external_benchmark_native.py`
- Modify: `tests/test_arc_agi_3_e2e.py`
- Modify: `docs/research-resource-agent-view.md`

**Interfaces:**
- Consumes: component references, adapter-bounded task tools, existing finding/effect stores, and Pi-native context projections.
- Produces: regression coverage for direct exploration-to-component creation, finding-based component revision, unchanged direct execution, and control/treatment isolation.

- [ ] **Step 1: Write the failing tests**

Add a scripted sequence that creates a memory or skill before any finding, uses it, records a finding that references its exact version, updates the component after a contradictory observation, and asserts that the resulting context shows the new version. Add a control assertion that task-tool and research resources remain absent.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pytest tests/test_pi_external_benchmark_native.py tests/test_arc_agi_3_e2e.py -k "component_loop or isolation" -v`

Expected: FAIL until all prior slices are wired together.

- [ ] **Step 3: Implement documentation and compatibility fixes**

Update the agent-view document to describe components as directly creatable task resources, findings as optional verification/interpretation resources, and task tools as adapter-bounded Pi registrations. Keep JSONL as storage and context/tool calls as the agent interface.

- [ ] **Step 4: Run focused and full verification**

Run: `pytest tests/test_pi_external_benchmark_native.py tests/test_arc_agi_3_e2e.py -v`

Then run: `pytest -q`

Expected: all focused and existing tests pass; control remains free of research/harness resources; no benchmark action semantics change.

- [ ] **Step 5: Commit**

```bash
git add tests/test_pi_external_benchmark_native.py tests/test_arc_agi_3_e2e.py docs/research-resource-agent-view.md
git commit -m "test: verify agent-owned research and component loop"
```

