# Self-Harness

## Goal
The user's task outcome, scope and constraints define success. Components are resources for that task.

## Object model and mechanism
A component has one logical name, kind, source, saved versions and a mutation note. Kinds are tool, skill, subagent, prompt, memory and process. `reflect_component` has only `define`, `redefine` and `restore` operations. It is the single component modification primitive. Validated published components become native task resources; current files, saved versions and the latest publication failure are readable with the ordinary `read` tool.

| Kind | Current source path | Native resource |
| --- | --- | --- |
| tool | `tools/<name>.py` | Same-name Pi tool |
| skill | `skills/<name>/SKILL.md` | Pi skill index entry and readable body |
| subagent | `agents/<name>.md` | Same-name Pi tool, using the working agent's model |
| prompt | `prompts/<name>.md` | Subsequent provider request context |
| memory | `notes/memory/<name>.md` | Subsequent provider request context |
| process | `processes/<name>.json` | Active or pending provider request context |

For each component, saved sources are `components/<kind>/<name>/v<N>.source`; the latest rejection or publication failure is `components/<kind>/<name>/last-failure.md`. Current source is at the kind's current source path in the table. These files are read-only through generic workspace writes; `reflect_component` controls publication and binding.

## Resources and boundaries
Task files use native `read`, `write`, `edit`, `ls` and `grep`; Python runs within workspace confinement. `office` renders, shows and delivers presentation resources. Component names, source formats and publication validation follow their native resource contracts. Provider authorization, budget, deadline, workspace confinement, task actions and user acceptance criteria are fixed boundaries. Publication, exposure, reading, context injection and execution are distinct facts.
