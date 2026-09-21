---
name: tool-creator
description: Design or revise an executable task-local Pi tool when a repeated analysis or bounded operation should become a callable capability. Use for pi.registerTool contracts and this runtime's declarative programs or approved adapter operations; not for storing observations or claiming unavailable host code.
---

# Pi task-local tool creator

Create a tool only when execution is more useful than another explanation: the
operation is repeatable, its inputs and semantic result can be stated, and a
supported implementation can actually run inside the current Pi task.

1. Define the next useful call. State the operation, constrained input, semantic
   output, failure behavior, bounded cost, permissions, and why main should call
   it instead of reasoning manually. Prefer one composable capability over a
   large workflow hidden behind one call.
2. Inspect `task_harness`, `task_tool`, and the available adapter implementations.
   Choose either an approved `implementation_ref` or a declarative `program` made
   only from supported steps: `adapter_call`, `select`, `count`, `pick`, `filter`,
   `map`, `group_by`, `diff`, `summarize`, `assert`, and `emit_observation`.
   Missing primitives mean `pending_implementation`, not an executable tool.
3. Specify the Pi contract. Use a provider-compatible TypeBox object schema,
   an action-oriented description, and stable structured `content`/`details`.
   Errors must be actionable and must throw. Preserve source identity and version
   in derived observations. Support cancellation and progress only when the
   operation can actually honor them.
4. Test actual execution: one representative input, an empty or invalid input,
   and a contrast capable of exposing a false assumption. Assert semantic output,
   provenance and failures—not merely registration or `status=completed`.
5. Publish through `task_tool`, then let main select the exact `tool:name@vN`
   with `task_harness(action="assemble", ...)`. Invocation before selection must
   fail. Treat the first successful call as use evidence, not proof of utility;
   assess the downstream result and revise or retire on evidence.

The runtime—not the creator—enforces schema, exact versions, assembly selection,
adapter allowlists, permissions, and the main-only ARC action boundary. The task
tool substrate does not load arbitrary TypeScript, shell code, packages, or Pi
extensions. A full extension may use `pi.registerTool`, but authoring one requires
normal project implementation and verification outside the dynamic component API.

For exact Pi and project contracts, read
`references/pi-task-local-tool-contract.md` with `task_harness(action="read_method",
method_name="tool-creator", method_resource="references/pi-task-local-tool-contract.md")`.
