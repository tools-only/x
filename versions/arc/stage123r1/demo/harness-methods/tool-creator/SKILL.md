---
name: tool-creator
description: Author an executable bounded computation or check using the supported Pi task-local substrate.
---
# Pi Tool creator

Main fills the returned candidate: name, description (operation and when useful), input_schema, output_schema, and a complete program. Reuse creator_ref. JSON schemas support type, properties, required, additionalProperties, items, minItems/maxItems, minimum/maximum and minLength/maxLength. No $ref or oneOf. Input and output are checked at invocation. Name the next useful computation; registration is not a semantic test.

With additionalProperties:false, declare every field read by get(input,"field") in input_schema.properties, including fields supplied by bindings.

Use program={"format":"task-pure-expression-v1","limits":{},"expression":...} for deterministic JSON work. limits={} uses bounded defaults. No JavaScript, shell, network, filesystem, randomness or eval. All nodes have op plus exactly the keys below. expr means another node; constants require {"op":"literal","value":...}.

- input: no extra keys; full prepared input.
- literal: value (strict JSON); var: name declared by let/map/filter, never an implicit input field. Read parameters or bindings with {"op":"get","value":{"op":"input"},"key":{"op":"literal","value":"field-name"}}.
- let: name, value(expr), body(expr).
- get: value(expr object), key(expr string).
- index: array(expr), index(expr integer).
- object: fields array of {key:string,value:expr}; array: items array of expr.
- add/subtract/multiply/eq/lt/lte/and/or: left(expr), right(expr). and/or are lazy and require booleans.
- not/length: value(expr); length accepts string or array.
- if: condition(expr boolean), then(expr), else(expr).
- range: start(expr integer), stop(expr integer), end exclusive.
- map/flat_map: array(expr), as(string), body(expr); flat_map body returns array.
- filter/all: array(expr), as(string), predicate(expr boolean).
- assert: condition(expr boolean), value(expr), message(literal string).
- grid_reachability: grid, start, target, footprint, offsets, passable, max_nodes (all expr). It searches bounded integer-grid footprint paths and returns a shortest offset-index path or a distinct unreachable/limit status; read references/pi-task-local-tool-contract.md for its exact contract before authoring it.

Do not use prototype-related keys/names. Read-only pure calls use {"parameters":{...},"bindings":[{"name":"grid","ref":"<exact authorized snapshot ref>","path":["public_state","frames",0]}]}. Bindings merge with parameters; names cannot collide. Snapshots are immutable; use the announced current exact ref. Confirm row/column conventions against a known cell. Check actual counts/values, not just status=completed or a passthrough.

For one Tool, publish with task_harness_create(candidate,assembly); decision is optional. Use task_harness(change) for a batch. Keep program limited to format, limits and expression. The optional assembly selects this call's new versions plus the listed existing refs using the current revision; omit it for pool-only creation, then assemble separately. Invoke the receipt's exposed versioned tool. Check a representative value and a contrast; failure throws and is not use evidence. Assess downstream task benefit and revise/retire as needed.

For grid_reachability, a legacy steps program, or an allowed implementation_ref, read references/pi-task-local-tool-contract.md only when choosing that alternative. Never combine steps with format/expression. If an operation is unsupported, use an agent-executed Skill, decompose it or record the implementation gap; do not claim execution. Detailed background: references/authoring-background.md. Read optional files with read_method and this method_name.
