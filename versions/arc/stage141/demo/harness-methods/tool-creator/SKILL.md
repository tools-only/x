---
name: tool-creator
description: Author an executable bounded computation or check using the supported Pi task-local substrate.
---
# Pi Tool creator

Author name, description and program={"format":"task-pure-python-v1","source":"<expression>"}. Use returned authoring_call for publication and first computation. The recorded creator read supplies authoring_method_ref. Example source: {"height":len(input["grid"])}.

Source is parsed into bounded JSON operations, never executed as Python. Supported: input["field"], constants/lists/objects, integer array indexing, + - *, == < <=, boolean and/or/not, conditional expressions, len, range(stop) or range(start,stop), one-generator list comprehensions with optional if predicate, and immediately called lambdas for local bindings. No attributes, arbitrary calls, imports, eval, shell, filesystem or network. Boolean conditions are strict, indices nonnegative, equality follows strict JSON types, and len accepts string/array. Optional program.limits tightens bounded defaults.

input merges parameters and read-only bindings. The prepared ARC trial binds the snapshot's final numeric grid as input["grid"]: index [y][x], never copy hex rows. Edit/remove bindings for your expression. Optional earlier_input locates a captured final grid at the listed action boundary, possibly across a batch/level; it is not necessarily the previous action. Snapshots stay immutable.

input_schema and output_schema are optional for this format: defaults are open object and bounded strict JSON. Supply stronger contracts when useful: type/properties/required/additionalProperties/items and scalar/length bounds. With additionalProperties:false, declare accessed fields. No $ref/oneOf or prototype-related keys.

task_harness_create(candidate,assembly=true,trial={parameters,bindings}) adds the new exact version to the current selection and returns its first value. Omit assembly/trial for pool-only publication. Trial failure preserves the published version. Verify a value and contrast; keep only useful components. Creation is not task benefit; this computation performs no environment actions.

For advanced operations, grid_reachability, JSON AST, legacy steps or implementation_ref, read references/pi-task-local-tool-contract.md. Never mix source/AST/steps. Unsupported operations need a Skill, decomposition or a recorded gap. Optional background: references/authoring-background.md.
