---
name: tool-creator
description: Author an executable bounded computation or check using the supported Pi task-local substrate.
---
# Pi Tool creator

Author name, description and program={"format":"task-pure-python-v1","source":"<expression>"}. Use the returned authoring_call for publication and first computation. Reading this template is optional. If supplied, authoring_method_ref must match the current creator_ref; omit a stale citation when submitting complete content. Example source: {"height":len(input["grid"])}.

Source is parsed into bounded JSON operations, never executed as Python. Supported: input["field"], constants/lists/objects, integer array indexing, + - *, == < <=, boolean and/or/not, conditional expressions, len, range(stop) or range(start,stop), one-generator list comprehensions with optional if predicate, and immediately called lambdas for local bindings. No attributes, arbitrary calls, imports, eval, shell, filesystem or network. Boolean conditions are strict, indices nonnegative, equality follows strict JSON types, and len accepts string/array. Optional program.limits tightens bounded defaults.

input merges parameters and read-only bindings. The prepared ARC trial binds the snapshot's final numeric grid as input["grid"]: index [y][x], never copy hex rows. Edit/remove bindings for your expression. Optional earlier_input locates a captured final grid at the listed action boundary, possibly across a batch/level; it is not necessarily the previous action. Snapshots stay immutable.

input_schema and output_schema are optional for this format: defaults are open object and bounded strict JSON. Supply stronger contracts when useful: type/properties/required/additionalProperties/items and scalar/length bounds. With additionalProperties:false, declare accessed fields. No $ref/oneOf or prototype-related keys.

Call task_harness_create with {"candidate":{"name":"<name>","description":"<when useful>","program":{"format":"task-pure-python-v1","source":"<expression>"}},"assembly":true,"trial":{"parameters":{},"bindings":[]}}. Fill authored text and the authorized inputs. assembly=true adds the new exact version to the current selection; trial returns its first value. Omit assembly/trial for pool-only publication. Omit optional fields for defaults; explicit null and conflicting values are rejected. Trial failure preserves the published version. Verify a value and contrast; keep only useful components. Creation is not task benefit; this computation performs no environment actions.

For advanced operations, grid_reachability, JSON AST, legacy steps or implementation_ref, read references/pi-task-local-tool-contract.md. Never mix source/AST/steps. Unsupported operations need a Skill, decomposition or a recorded gap. Optional background: references/authoring-background.md.
