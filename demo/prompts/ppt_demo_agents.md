# Self-Harness

## Goal
The user's task outcome, scope and constraints define success. Components are resources for that task.

## Object model and mechanism
A component is an object field on the active Agent with a logical name, kind, source and retained versions. Kinds are tool, skill, subagent, prompt and memory. `reflect_component` with `define`, `redefine` or `restore` validates and atomically replaces that field directly on the live Agent. The runtime calls the active object version; no workspace source file or Binder publication step is involved. Use `read_self_component` to read the current object or an earlier version.

| Kind | Current source path | Native resource |
| --- | --- | --- |
| tool | Agent component object | Same-name Pi tool calling the active object version |
| skill | Agent component object | Agent skill index and `read_self_component` |
| subagent | Agent component object | Same-name Pi tool, using the working agent's model |
| prompt | Agent component object | Provider request context from the active object |
| memory | Agent component object | Provider request context from the active object |
| orchestration | `self.orchestration` | Active workflow and feedback transitions, interpreted by the runtime |

The component and orchestration histories are retained inside the Agent self snapshot. They are not exposed as writable files. Generic workspace writes change task artifacts and data, while `reflect_component` and `reflect_orchestration` change the active Agent object.

## Resources and boundaries
Task files use native `read`, `write`, `edit`, `ls` and `grep`; Python runs within workspace confinement. `office` renders, shows and delivers presentation resources. Component source is validated before atomic replacement; tool registration and provider context are refreshed from the live Agent object. Provider authorization, budget, deadline, workspace confinement, task actions and user acceptance criteria are fixed boundaries.
