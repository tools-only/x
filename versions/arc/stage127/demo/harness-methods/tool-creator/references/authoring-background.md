---
name: tool-creator
description: Design or revise an executable task-local Pi tool for a useful computation, check or bounded operation, including small or first-use work where precision, consistency or reasoning cost matters. Use this runtime's declarative programs or approved adapter operations; not for storing observations or claiming unavailable host code.
---

# Pi task-local tool creator

Create a tool when executing an explicit computation or check would help the task.
Small arithmetic, consistency checks and one-use transformations can qualify;
neither heavy computation nor prior repetition is required. Compare likely accuracy,
inspection effort and reasoning cost with direct execution, including errors already
encountered. Inputs and semantic result must be expressible, and a supported
implementation must actually run inside the current Pi task.

1. Define the next useful call. State the operation, constrained input, semantic
   output, failure behavior, bounded cost, permissions, and why main should call
   it instead of reasoning manually. Prefer one composable capability over a
   large workflow hidden behind one call.
2. Inspect `task_harness`, `task_tool`, and the available adapter implementations.
   Choose exactly one executable form:
   - a `task-pure-expression-v1` JSON AST for deterministic JSON-to-JSON work;
   - a legacy declarative `program.steps` contract using only `adapter_call`,
     `select`, `count`, `pick`, `filter`, `map`, `group_by`, `diff`, `summarize`,
     `assert`, and `emit_observation`; or
   - an approved `implementation_ref`.
   Never combine `format`/`expression` and `steps` in one program. Pure ASTs have
   no adapter, resolver, filesystem, process, network, clock, randomness, or eval
   access. They support `input`, `literal`, `var`, lexical `let`, `get`, `index`,
   `object`, `array`, bounded arithmetic/comparison/boolean/`if`, `range`, `map`,
   `flat_map`, `filter`, `all`, `length`, and `assert`.
   Confirm that every promised transform is expressible before authoring the Tool.
   If a primitive is missing, do not publish or claim execution: either package the
   agent-executed reasoning as a Skill, decompose the operation into supported Tool
   calls plus an explicit agent step, or defer the Tool while naming the exact
   missing primitive and a reachable reconsideration condition. `pending_implementation`
   is an implementation-gap record, not Tool coverage.
3. Specify the Pi contract. Use supported strict JSON `input_schema` and
   `output_schema` contracts for a pure AST; both are validated on every call.
   Pure calls pass inline values under `parameters` and may bind explicitly named
   values from exact task-resource versions with `bindings=[{name,ref,path}]`.
   Initially this dynamic binding surface is parent-only. ARC observation bindings
   use an automatically announced exact `observation_snapshot:<id>@vN`; never
   substitute a wildcard or silently rebind an old ref to the latest state.
   An ARC observation snapshot exposes the structured numeric frame at
   `path:["public_state","frames",0]` (latest/current frame when the snapshot
   contains one frame). Bind it as a named JSON input; do not assume the
   model-facing coordinate-run text must be string-parsed inside the AST.
   Bind only the row, region or cell the program actually needs when possible;
   use a whole frame only for a genuinely whole-frame computation. Derive each
   point from the current observation's row/column convention and verify one
   known cell before trusting a coordinate transform. A completed identity or
   passthrough program is not a successful query or statistic.
   Legacy tools keep their `input={...}` call envelope. Use an action-oriented
   description and stable structured `content`/`details`.
   Errors must be actionable and must throw. Preserve source identity and version
   in derived observations. Support cancellation and progress only when the
   operation can actually honor them.
4. Plan the first semantic trial: one representative input, an empty or invalid input,
   and a contrast capable of exposing a false assumption. For pure tools, also
   plan output-schema rejection and any exact-version binding. Creation requires
   an executable program/schema/permission contract, not prior proof of utility.
   Check the returned semantic value against the expected cell, count or
   contrast; schema validity and `completed` are not correctness evidence.
5. Publish through the unified parent boundary
   `task_harness(action="change", changes=[...])`, which routes the complete
   candidate to `task_tool`. Use the native writer directly only after an explicit
   activation for a concrete native operation. Then let main select the exact
   `tool:name@vN` with `task_harness(action="assemble", ...)`. Invocation before selection must
   fail. Run the planned semantic trial after selection and assert the actual
   output, hashes, provenance and failures—not merely registration or
   `status=completed`. Treat the first successful call as use evidence, not proof of utility;
   assess the downstream result and revise or retire on evidence.

The runtime—not the creator—enforces schema, exact versions, assembly selection,
adapter allowlists, permissions, and the main-only ARC action boundary. The task
tool substrate does not load arbitrary TypeScript, shell code, packages, or Pi
extensions. A full extension may use `pi.registerTool`, but authoring one requires
normal project implementation and verification outside the dynamic component API.

For exact Pi and project contracts, read
`references/pi-task-local-tool-contract.md` with `task_harness(action="read_method",
method_name="tool-creator", method_resource="references/pi-task-local-tool-contract.md")`.
