---
name: tool-creator
description: Author an executable bounded computation or check using the supported Pi task-local substrate.
---
# Pi Tool creator

Fill name, description, input_schema, output_schema and program; reuse creator_ref. Describe the next useful computation. Schemas support type/properties/required/additionalProperties/items, minItems/maxItems, minimum/maximum and minLength/maxLength; no $ref/oneOf. Invocation validates input/output; registration is not a semantic test.

With additionalProperties:false, declare all accessed/bound fields in input_schema.properties.

Use program={"format":"task-pure-expression-v1","limits":{},"expression":...}; limits={} selects bounded defaults. No JavaScript, shell, network, filesystem, randomness or eval. Each node has op and exactly the listed keys. expr is another node; constants use {"op":"literal","value":...}.

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

Reject prototype-related keys/names. Call with {"parameters":{...},"bindings":[{"name":"grid","ref":"<exact snapshot>","path":["public_state","frames",0]}]}; omit bound parameters. Bindings are read-only and snapshots immutable. Use current ref; verify coordinates and actual values.

Publish with task_harness_create(candidate,assembly), or task_harness(change). decision is optional. assembly selects new versions and listed refs at its expected revision; omit for pool-only creation. Verify a value and contrast, assess benefit, then revise/retire.

task_harness_create(candidate,assembly,trial={parameters,bindings}) returns the first pure result after explicit assembly. Legacy candidate.trial is accepted; conflicting values are rejected. Trial failure preserves publication. No environment actions.

For grid_reachability, legacy steps or implementation_ref, read references/pi-task-local-tool-contract.md when choosing that alternative. Never mix steps with format/expression. Unsupported operations need a Skill, decomposition or a recorded gap; do not claim execution. Optional background: references/authoring-background.md, via read_method with this method_name.
