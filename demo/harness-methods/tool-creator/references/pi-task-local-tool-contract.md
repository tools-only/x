# Pi task-local tool contract

Use this reference when a tool candidate needs an exact implementation or review.
The authoritative runtime files are `demo/pi_task_local_tools.ts` and
`demo/pi_task_tool_contract.ts`; this document is a routing summary, not a second
schema definition.

## Pi-native definition

Pi extensions register an LLM-callable tool with `pi.registerTool({ ... })`.
The relevant fields in Pi 0.80.6 are:

- `name`, `label`, and `description` identify and explain the callable operation.
- `parameters` is a TypeBox schema. Prefer a strict object. Use Pi's documented
  string-enum helper where provider compatibility requires it; avoid schemas that
  serialize differently across configured providers.
- `promptSnippet` optionally adds a one-line entry to the available-tools prompt.
  `promptGuidelines` adds flat bullets while active, so every bullet must name the
  tool explicitly. These fields guide selection but grant no permission.
- `execute(toolCallId, params, signal, onUpdate, ctx)` returns `content` and
  optional structured `details`. Check `signal` for cancellable work and use
  `onUpdate` only for meaningful progress. Throw on operational or validation
  failure so callers do not confuse error text with a successful result.
- Dynamic registration is visible in the same session. `pi.getActiveTools()` and
  `pi.setActiveTools(names)` control exposure. Registration alone is not evidence
  that a tool was selected, invoked, semantically correct, or useful.

Source: `@earendil-works/pi-coding-agent` 0.80.6 extension documentation, pinned
in `SOURCES.json`.

## Dynamic component substrate in this project

`task_tool` does not accept arbitrary source code. It materializes one of:

1. A declarative program with a non-empty `steps` array. Supported kinds are
   `adapter_call`, `select`, `count`, `pick`, `filter`, `map`, `group_by`, `diff`,
   `summarize`, `assert`, and `emit_observation`.
2. An `implementation_ref` already permitted by the current task adapter.

Each saved version receives a distinct Pi name such as `task_tool_probe_v2`.
Creating or updating a component registers that name, but calls are accepted only
when the current Harness assembly selects the matching exact resource version.
Updates use compare-and-swap through `target_version`; old versions remain audit
records and are not silently rebound.

The runtime validates permissions for every adapter call. Program output can carry
`task-analysis-observation-v1` provenance, including source reference/version,
derived tool version, operation, and transformations. A deterministic transform
does not establish the semantic identity or causal meaning of its input.

## Authoring checklist

Before publishing, answer:

- What repeated decision becomes easier after this call?
- Is every advertised operation implemented by a supported step or allowlisted
  adapter reference?
- What exact input schema is accepted, and which malformed cases fail?
- What semantic result and provenance will the parent inspect?
- Can output size and execution cost be bounded?
- Which permission and environment boundary applies?
- Which exact version should assembly select, and what invalidates it?

After publishing, execute the assembled version with representative and contrasting
inputs. Assert decoded values and expected errors. A `completed` event without a
correct semantic result is a failed tool evaluation.
