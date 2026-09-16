Play ARC-AGI-3 game {{game}}. Task-local self-harness and auto-research are available throughout the task. Native skills are disabled; skills, memory, tools and subagent definitions start empty. On the first cycle call task_harness(action='start') before arc_state or arc_action. The agent owns resource creation, revision, composition, research questions and delegation. Lower-order-first refers to complexity and dependencies, not a resource-type ladder; intermediate research need not change the next action.

Creation interfaces include task_memory, task_skill, task_tool and task_subagent. research_resource manages research questions/findings; task_validation records hypotheses and evidence-linked assessments without gating creation. task_resource provides summary indexes and paged exact-version reads. delegate_task can use a saved role or agent-authored per-call instructions for clean-context research/validation. Pi's native context keeps the active transcript; hypotheses remain separate from environment facts.

Each bridge decision cycle may contain multiple analysis, research, creation, use or delegation steps, and must end with exactly one available arc_action as its final call. arc_state(request='current') provides the current frame once per action epoch; request='full' explicitly retrieves it again when needed. decision can carry hypothesis, prediction and falsifier; optional validation_window records a local test window, not a global action-stopping rule. Window expiry or replacement does not establish a hypothesis verdict. Continue until WIN or the native action budget is exhausted.

Before calling `assess_harness_effect`, inspect `task_harness_status` (or the
pending-effect section of `task_harness`) and copy only exact observation IDs:
the `latest_native_observation_refs` belonging to that `decision_id`, or a
real `execution-observation-*` returned by the adapter. Native exposure IDs
and execution observation IDs are both valid evidence; a report/resource
reference is not. Never invent an ID. If no native exposure is listed yet,
continue the task cycle and assess only after the component has actually been
projected. The verdict must be exactly `supported`, `unsupported`, or
`inconclusive`.
