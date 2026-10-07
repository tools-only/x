# Pi task-local tool contract

Use this reference when a tool candidate needs an exact implementation or review.
The authoritative runtime files are `demo/pi_task_local_tools.ts` and
`demo/pi_task_tool_contract.ts`; this document is a routing summary, not a second
schema definition.

The default authoring entry uses `task-pure-python-v1`: a restricted expression
is mechanically lowered to the bounded JSON AST below, never executed by Python.
It accepts optional limits and schemas (open object input, strict JSON output).
`task_harness_create(..., assembly=true, trial={parameters,bindings})` requests
publication, addition of the new exact version to the current selection, and a
first pure computation. CAS, resource authorization and existing trial failure
recovery still apply. Legacy AST callers retain their explicit output contract.

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

`task_tool` does not accept arbitrary source code. It materializes one of three
mutually exclusive forms:

1. A pure JSON program with exactly `format`, `limits`, and `expression`:

   ```json
   {
     "format": "task-pure-expression-v1",
     "limits": {},
     "expression": {"op": "input"}
   }
   ```

   Supported operators are `input`, `literal`, `var`, lexical `let`, `get`,
   `index`, `object`, `array`, `add`, `subtract`, `multiply`, `eq`, `lt`, `lte`,
   `and`, `or`, `not`, lazy `if`, `range`, `map`, `flat_map`, `filter`, `all`,
   `length`, `assert`, and `grid_reachability`. Operator objects use exact keys, all AST branches are
   validated at publication, and collection/allocation/step/depth/input/output
   limits are enforced. Publication freezes the resolved limit contract into the
   exact tool version; a later runtime may only apply a tighter hard ceiling.
2. A legacy declarative program with a non-empty `steps` array. Supported kinds are
   `adapter_call`, `select`, `count`, `pick`, `filter`, `map`, `group_by`, `diff`,
   `summarize`, `assert`, and `emit_observation`.
3. An `implementation_ref` already permitted by the current task adapter.

Do not put `steps` on a pure program or `format`/`expression` on a legacy program.
Pure programs never receive the task adapter or a host resolver. They require
supported `input_schema` and `output_schema` objects. The accepted schema subset
uses exact supported keywords (`type`, `properties`, `required`,
`additionalProperties`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`,
`minLength`, and `maxLength` as applicable); unsupported composition such
as `$ref` or `oneOf` is rejected instead of ignored.

Pure invocations use this envelope:

```json
{
  "parameters": {"delta": 1},
  "bindings": [{
    "name": "grid",
    "ref": "observation_snapshot:parent-state-1@v1",
    "path": ["public_state", "frames", 0]
  }]
}
```

`parameters` and resolved bindings become one input object. Names must be unique
and cannot collide. Binding refs are exact, authorization-scoped task resources;
paths traverse own JSON properties only. The initial dynamic binding surface is
parent-only. Historical snapshot refs remain immutable and readable (with stale
provenance) rather than silently resolving to the latest observation. Pure
failures are real tool failures and include stable code/path/consumption/limit
receipts; failed calls do not create actual-use observations.

### Pure expression operand grammar

Every expression is an object with `op` plus exactly the operands below. Every
operand marked `expr` is another expression object; literal values appear only
inside `literal.value`. Binding names are nonempty strings other than
`__proto__`, `prototype`, and `constructor`.

| `op` | Exact remaining keys | Runtime contract |
| --- | --- | --- |
| `input` | none | Return the complete prepared input object. |
| `literal` | `value` | `value` is strict bounded JSON. |
| `var` | `name` | Read a lexically bound name. |
| `let` | `name`, `value`, `body` | Evaluate `value`, bind `name` only within `body`. |
| `get` | `value`, `key` | `value` expr yields an object; `key` expr yields a permitted string naming an own field. |
| `index` | `array`, `index` | `array` expr yields an array; `index` expr yields an in-range safe integer. |
| `object` | `fields` | `fields` is an array of exactly `{ "key": string, "value": expr }`; keys are unique and permitted. |
| `array` | `items` | `items` is an array of expressions. |
| `add`, `subtract`, `multiply` | `left`, `right` | Both exprs yield finite numbers; result remains finite. |
| `eq` | `left`, `right` | Metered structural equality over strict JSON values. |
| `lt`, `lte` | `left`, `right` | Both exprs yield finite numbers. |
| `and`, `or` | `left`, `right` | Boolean exprs with lazy right-hand evaluation. |
| `not` | `value` | `value` expr yields a boolean. |
| `if` | `condition`, `then`, `else` | Boolean condition; only the selected branch executes, though both are publication-validated. |
| `range` | `start`, `stop` | Safe-integer exprs; yields `[start, stop)` and requires `stop >= start`. |
| `map`, `flat_map` | `array`, `as`, `body` | Bind each source-array item to string `as`. `flat_map` requires each `body` result to be an array. |
| `filter`, `all` | `array`, `as`, `predicate` | Bind each array item to `as`; `predicate` yields boolean. `all` short-circuits. |
| `length` | `value` | Array length or Unicode code-point length of a string. |
| `assert` | `condition`, `value`, `message` | On true return `value`; otherwise fail with literal string `message`. |
| `grid_reachability` | `grid`, `start`, `target`, `footprint`, `offsets`, `passable`, `max_nodes` | Each operand is an expr. On a rectangular integer grid, search anchors `[x,y]` with candidate moves from `offsets=[[dx,dy],...]`. `footprint=[width,height]`; every destination cell must be in the integer `passable` array. The occupied start anchor is accepted without testing its own pixels. Return `target_status` (`reachable`, `unreachable`, or `unknown_limit`), shortest `path` as offset indices or `null`, `nearest_anchor`, `nearest_path`, `reachable_count`, and `truncated`. An exhausted `max_nodes` search never declares an undiscovered target unreachable. No target/game meaning is inferred. |

For this operator, a Tool can bind a public `grid` resource and use input fields
`start`, `target`, `footprint`, `offsets`, `passable`, and `max_nodes`. Build each
operand as `{"op":"get","value":{"op":"input"},"key":{"op":"literal","value":"field_name"}}`.
The caller supplies current, evidence-backed movement and passability assumptions;
change the Tool or inputs when a new level or counterexample invalidates them.

### Pure limits and failure receipt

`limits` accepts only positive safe integers for these fields. Omitted values are
resolved and frozen when the exact tool version is published.

| Field | Default | Hard ceiling | Measures |
| --- | ---: | ---: | --- |
| `ast_nodes` | 2,048 | 8,192 | Published expression nodes. |
| `ast_depth` | 32 | 64 | Published expression nesting. |
| `json_depth` | 32 | 64 | JSON literal/input/output nesting. |
| `input_bytes` | 131,072 | 524,288 | Prepared input JSON bytes. |
| `steps` | 250,000 | 1,000,000 | Metered evaluator work. |
| `collection_length` | 8,192 | 32,768 | Any bounded collection/range length. |
| `constructed_elements` | 100,000 | 500,000 | Cumulative constructed elements. |
| `allocation_bytes` | 8,388,608 | 33,554,432 | Cumulative metered allocation/copy work. |
| `output_bytes` | 65,536 | 262,144 | Serialized JSON output bytes. |

Failures use `task-pure-expression-error-v1` with `code`, `message`, `path`,
`consumed`, and `effective_limits`. Stable codes are `invalid_program`,
`invalid_input`, `invalid_output`, `type_error`, `missing_field`,
`index_out_of_bounds`, `assertion_failed`, `budget_exhausted`,
`output_too_large`, and `cancelled`. Consumption reports `steps`,
`constructed_elements`, `allocation_bytes`, `input_bytes`, and `output_bytes`.
Publication and invocation receipts also expose exact program/input-schema/
output-schema hashes, authored-program hash, requested limits, and the frozen
effective limit contract.

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
- For pure programs, what exact output schema is guaranteed and which mismatch fails?
- What semantic result and provenance will the parent inspect?
- Can output size and execution cost be bounded?
- Which permission and environment boundary applies?
- Which exact version should assembly select, and what invalidates it?

If any advertised step is absent from the supported kinds/allowlist, stop before
publication. Record the precise input/output contract and missing primitive, then
choose an agent-executed Skill, a composition of supported computations, or an
explicit deferral. Do not encode the unavailable operation as prose in a Tool or
claim that a Skill caused runtime execution.

After publishing, execute the assembled version with representative and contrasting
inputs. Assert decoded values and expected errors. A `completed` event without a
correct semantic result is a failed tool evaluation.
