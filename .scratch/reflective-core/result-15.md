# Native component sources without inspection: change 15

**Implementation commit:** `da86bf8c090a22632feef3b2eab39a49b89a1259` on `codex/ppt-reflective-core-20261108`.

## Opportunity and claim

`reflect_component(op="inspect")` duplicated source and version information already stored by Binder and added a component inventory interface. The change removes that operation and exposes published source history as workspace files that the task Agent can read natively.

The falsifiable claim is that one installed Pi scripted session can define, redefine, restore and reject components while current source, saved versions, native bindings and rejection notes remain readable or unchanged at their stable workspace paths.

## Changes

- `reflect_component` exposes only `define`, `redefine` and `restore`; its inspection implementation and inventory response were deleted.
- The existing native source paths remain the current source files. Binder's saved version bytes are exposed as `components/<kind>/<name>/v<N>.source`; the latest rejected publication note is `components/<kind>/<name>/last-failure.md`.
- Startup exposes saved versions for already-published components. Failed candidates are excluded from the published version files. Generic write/edit and Python writes to component and history paths are blocked; publication and binding still go through `reflect_component`.
- The agent Markdown, system prompt and tool description state the goal, object model, mechanism, resources and boundaries.
- Tests cover the schema, same-session define/redefine/restore, failed candidate preservation, and native reads. Evidence joins required no schema migration; existing offline evidence tests remain in the validation set.

## Verification

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts tests/ppt_trials.test.ts` — 13 passed.
- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts tests/arc_thin_binder.test.ts` — 21 passed.
- `PYTHONPATH=src python -m pytest tests/test_reflective_core_evidence.py tests/test_ppt_native_pi.py -q` — 12 passed. Installed Pi 0.87.0 with `offline-external-test` verified schema and lifecycle in one scripted session; no paid or real-provider run.
- `git diff --check` — passed.

## Evidence status and limitations

**Functional correctness:** passed for targeted offline tests, including rejected skill publication retaining the active file and binding, and ordinary Pi `read` of published sources and versions.

**Full-chain reachability:** passed for the tested installed-Pi scripted session. Startup reload and the publication/read path are covered. Persisted Pi-session resume is unverified.

**Autonomous adoption:** unverified. **Net benefit:** unverified. No real-provider or ARC task evaluation was run. The checks establish function and wiring only.

## Final agent-facing text

### Agent Markdown: `demo/prompts/ppt_demo_agents.md`

```markdown
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
```

### System prompt: `demo/prompts/ppt_demo_system.md`

```markdown
# Self-Harness

The user's task outcome, scope and constraints define success. Components are resources for the task. Each component has one logical name, kind, source and saved versions; `reflect_component` is the single modification primitive with `define`, `redefine` and `restore`. Validated published components become native task resources. Current source stays at its documented component path; saved sources and the latest publication failure are plain files under `components/<kind>/<name>/`, readable with native `read`. Generic writes to component files do not change active bindings.

The task workspace provides ordinary file tools, confined Python, and `office` for rendering, viewing and delivery. Component kinds are tool, skill, subagent, prompt, memory and process. Workspace confinement, provider authorization, budget, deadline, environment actions and user acceptance criteria are fixed boundaries.
```

### Tool description

> Define, redefine, or restore a harness component or process. Published sources and saved versions are workspace files under their documented component paths.
