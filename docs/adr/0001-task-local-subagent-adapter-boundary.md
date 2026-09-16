# ADR-0001: Separate the task-local Pi subagent lifecycle from benchmark adapters

## Status

Proposed. Validate against the active ARC run before changing runtime code.

## Context

The ARC treatment has demonstrated that an Agent-created task-local subagent can run in an isolated native Pi process, expose only read-only benchmark tools, return a decision-relevant result, and leave decision, invocation, usage, and exposure evidence. The current prototype in `demo/pi_arc_task_subagents.ts` mixes that reusable lifecycle with ARC-specific tool names, permission wording, child extension loading, and prompt text.

The active ARC run also shows an operational failure mode: a subagent can return a short structured answer while consuming tens of thousands of model tokens because it first receives and reasons over the full public 64x64 frame. Representation efficiency is an adapter concern; subagent lifecycle and evidence accounting are not.

The design must preserve these constraints:

- Pi owns every model/tool Agent loop and every decision to create, revise, invoke, assess, or stop using a subagent.
- Python starts, isolates, streams artifacts, and evaluates; it does not schedule research or choose harness changes.
- No finding or harness mutation is mandatory, and an empty research basis remains valid.
- A research-linked decision is reported only when the Agent explicitly supplies a valid resource reference.
- Benchmark-specific state, action semantics, permissions, and public representation remain in the adapter.
- The extraction must not introduce a global harness state, policy compiler, unified mutation API, or outer refinement pipeline.

Non-functional requirements are small context overhead, bounded persisted results, process isolation, backwards-compatible evidence, and reuse by a non-ARC adapter without importing ARC code.

## Decision

Extract one shared `task-local Pi subagent` module that owns only:

- versioned Agent-authored definitions and task-local Markdown files;
- create, update, retire, inspect, and delegate tools;
- launching a separate native Pi process;
- bounded canonical evidence excerpts selected by explicit observation IDs;
- streamed NDJSON consumption that discards oversized intermediate events;
- invocation status, token/cost accounting, harness decision, and native exposure records.

Each benchmark adapter injects a small capability description containing:

- adapter identity;
- child extension path;
- allowed and default tool names;
- permission label;
- benchmark-local tool descriptions and child environment;
- any task-local prompt fragment needed to state the public protocol.

The shared module validates the injected allowlist but does not understand tool semantics. ARC continues to inject `arc_state`, `inspect_arc_trajectory`, and `read_only_arc`; another benchmark can inject a different restricted surface without importing ARC modules.

Lossless or causal-neutral compaction of public benchmark observations may be implemented in the benchmark adapter. For ARC, a coordinate-preserving row/run representation is permitted because it changes only the public frame encoding. ARC object detection, win rules, action selection, and research conclusions remain Agent work and must not enter the shared module.

The existing artifact names and causal claims remain stable. Adapter identity may be added to new records, but absence in older records remains valid. No automatic relation is inferred between a finding and a subagent decision.

## Consequences

### Positive

- The self-harness capability becomes reusable without turning ARC behavior into meta policy.
- Native Pi execution, task-local scope, and Agent ownership remain explicit.
- Adapter-local public-state compaction can reduce cost without changing research semantics.
- Existing decision/exposure/effect evidence stays comparable across benchmarks.

### Negative

- Every benchmark that enables delegation must supply and test a restricted child extension.
- Adapter authors remain responsible for preventing hidden-state or unauthorized tool access.
- A generic lifecycle does not guarantee that the Agent will create a useful subagent or link it to research.
- Lossless compaction may reduce payload size but cannot bound a model's private reasoning cost.

### Neutral

- ARC may keep a thin `installArcTaskSubagents` wrapper for compatibility.
- Subagent use remains optional and can be less efficient than direct execution.
- Benchmark improvement still requires a valid paired comparison; invocation success is only mediator evidence.

## Failure modes and mitigations

- **Prompt or tool leakage:** child processes start with sessions, skills, prompt templates, context files, built-ins, and unrelated extensions disabled; the adapter explicitly adds the allowed surface.
- **Oversized event streams:** consume NDJSON incrementally, retain only final assistant messages, and discard oversized intermediate lines.
- **Unbounded result artifacts:** retain a bounded final text and aggregate usage rather than raw child event streams.
- **False causal linkage:** preserve Agent-supplied basis references verbatim and report empty or invalid links honestly.
- **Adapter overreach:** tests must show that the shared module contains no benchmark tool names or task rules.
- **Cost without benefit:** expose invocation usage to the parent and include it in final evaluation; future budgets, if added, must be Agent-selected task-local component settings rather than runner research policy.

## Alternatives considered

**Keep the ARC implementation intact**

Rejected because other benchmarks would have to copy lifecycle, persistence, and process logic, allowing evidence semantics to drift.

**Move subagent scheduling into Python**

Rejected because it would create a second harness above Pi and remove the Agent's decision ownership.

**Introduce a universal `mutate_harness` operation or global HarnessState**

Rejected because it hides the different native effects of memory, skills, tool selection, and delegation and recreates a policy layer above Pi.

**Put ARC feature detection in the shared module**

Rejected because it binds the meta mechanism to one benchmark and risks leaking task solutions. Only lossless public representation belongs in the ARC adapter.

## References

- `docs/plans/2026-09-11-pi-native-research-self-harness-architecture.md`
- `demo/pi_arc_task_subagents.ts`
- `demo/pi_arc_readonly_subagent_extension.ts`
- Active evidence: `runs/arc-deepseek-generic-loop-treatment-20260912-r6/`
