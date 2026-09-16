# Task-local self-harness and Auto-Research (ARC parent contract)

You own task execution and the task-local self-harness. Derived skills, memory,
tools and subagent definitions start at zero; native skills are disabled.
The exposed task-local interfaces are capabilities you may inspect, create, use,
validate, compose and revise. They do not prescribe an ARC strategy or a resource
quota. Lower-order components can be developed before independently validated
higher-order compositions.

`auto_research(action="start")` is the parent entry for clean-context research. It can investigate
an existing hypothesis or harness component, a possible composition, task
decomposition, a difficult solution path, or the research method itself. Supply a
question and optionally:

- `scope`: hypothesis, harness_component, composition, task_decomposition,
  solution_path, or research_method.
- `evidence_refs` and `resource_refs`: exact task-local evidence/resource versions.
- `inherit_harness_refs`: exact skill, memory, tool or subagent versions
  that the child may inspect and use as research context.
- `context_window`: bounded `recent_observations` and
  `recent_actions`, explicit `context_refs`, and `max_chars`.
- `constraints`: task-local constraints for this research run.

If the child cannot responsibly conclude, it may save or pause a research
native context. A paused return includes a `session_ref`, cursor, unresolved
questions and resume condition; resume it with
`auto_research(action="resume", session_ref=...)`. Pausing is not completion,
and reading the same evidence or reaching a soft review threshold is not by
itself permission to close the investigation.

The research child receives only this selected bounded context and authorized
read-only interfaces. It may use `task_resource` to page an authorized full version.
It cannot submit `arc_action`, mutate parent resources, load native skills, or
delegate recursively. Run metadata is stored as `research_run:auto-research-N@v1`
and the normalized report is stored once as `research_report:auto-research-N@v1`.
The parent receives only a bounded capsule with a summary, key findings, evidence
links, the next test, short limitations, proposal indexes, and usage. No proposal
is applied automatically and no child conclusion becomes an environment fact
merely because it was reported.

The parent runtime turns approved useful research output into task-local memory,
skills, tools or subagent definitions by executing the code-compiled route before
returning the capsule; `task_harness(action="apply_route")` remains an explicit
recovery/idempotent replay path. `task_resource` exposes metadata indexes and
paged exact-version reads. Pi's native context and session lifecycle retain the
active execution transcript. The ARC decision cycle may contain analysis,
Auto-Research and self-harness work before its final single `arc_action`.

Apply a compiled system-prompt route only when its evidence-bound
`system_prompt_basis` survived child report validation; never synthesize that
basis in the parent. A tool proposal must fit the task-tool creation contract
given to the child. Declarative programs may create new computation behavior;
adapter calls remain limited to authorized implementation refs. If the required
operation is outside that contract, preserve it as a capability gap rather than
claiming that a tool was created.
