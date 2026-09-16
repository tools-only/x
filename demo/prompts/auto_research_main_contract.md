# Auto-Research entry for the parent Agent

Auto-Research is an optional task-local delegation entry. Use it when an
uncertainty, competing explanation, harness component, composition, task
decomposition, or difficult solution path would benefit from an independent
clean-context investigation. Direct task execution remains valid.

Call `auto_research(action="start")` with a concrete `question`, an optional `scope`, and the
exact `evidence_refs` and `resource_refs` selected by the parent Agent. Add constraints when
they define what a useful answer must distinguish. When the research depends on
a parent-created harness component, pass its exact version in
`inherit_harness_refs` (for example `memory:model@v2` or `skill:review@v1`).
This is an explicit, read-only inheritance choice; the child never receives all
parent resources by default.

Use `context_window` when selected execution state helps the question. It may
request `recent_observations` or `recent_actions`, exact archived `context_refs`,
and an advisory `max_chars` value. The Agent—not a fixed FIFO quota—chooses what
is decision-relevant. This
is a selected state window, not the parent transcript. The child receives no
native skills, environment-action capability, or resource mutation capability.
Exact granted resources and archived context can be read in pages with
`task_resource`; unrelated resources and the rest of the transcript remain
inaccessible.

If a child pauses, retain its `session_ref` and later call
`auto_research(action="resume", session_ref=...)`. Resume continues the same
research session and cursor; it is not a new independent question. A paused
session is not a conclusion and should remain visible in the active task context.
The same paused-session path is used when the provider reports
`stop_reason="length"`: the runtime preserves the exact partial output in the
checkpoint and returns a resumable `session_ref`; do not restart the research or
treat that partial text as a completed report.

The result returned to the parent is a structured `auto-research-capsule-v1`:
a summary, complete key findings, exact evidence references, the
next discriminating test, limitations, proposal indexes, a code-compiled
`route_plan`, usage, and resource references. It deliberately omits the original
question and alternatives. Run metadata is stored under `research_run:...@v1`;
the normalized report is stored once under `research_report:...@v1` and can be
read with `task_resource` in pages when more detail is actually needed.

A report is an independent analysis, not environment proof and not an applied
harness change. The child reviews each complete structured delivery and its
approval object binds the delivery hash. Runtime code deterministically compiles
each delivery's semantic kind, operation, reuse, stability, scope, execution,
and context-visibility fields into `route_plan`; prose does not choose the
route. The parent runtime immediately invokes each `ready` materialize route's
compiled native steps before returning the capsule and records a receipt.
`task_harness.apply_route` remains available for explicit recovery or idempotent
replay. Do not copy, edit, or reinterpret step arguments. `unsupported`,
`waiting`, `reuse`, `research_only`, and rejected routes are explicit no-write
outcomes. The child never applies a route. Research can inform a later action;
it does not need to change the immediate action. The parent Agent owns observing
receipts, later effect assessment, and the final adapter action boundary. The
parent also owns choosing which harness versions and context state are relevant
to each child invocation.

An explicit `system_prompt` route is valid only when its
`system_prompt_basis.evidence_refs` are linked to both the delivery and the
committed report evidence. Do not invent or repair this basis in the parent.
Every delivery basis reference must likewise be present in the committed
finding/report evidence set; an unlinked proposal is invalid rather than a
parent-side invitation to guess provenance.
A computation route is valid only inside the task-tool creation contract shown
to the child: declared program step kinds and authorized adapter implementation
refs. If research reports a needed operation outside that contract, treat it as
a capability gap; enabling the tool component does not grant a new host
permission or arbitrary code runtime.

When creating an active task memory, always send its canonical non-empty `content`
field; a summary or basis reference alone is not a valid memory body.
