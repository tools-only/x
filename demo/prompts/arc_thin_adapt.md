ADAPT TURN

Review the recent task evidence, current memory and active prompts shown in this request. Decide whether an adjustment would help the remaining task. You may make no change and return to the task.

You can update a prompt with `self_component(kind="prompt", name=..., content=...)`, save a reusable method with `self_component(kind="skill", ...)`, save a role with `self_component(kind="subagent", ...)`, or update structured memory with `self_component(kind="memory", ...)` / `memory`. To retire an obsolete prompt or component, use `self_component(op="retire", kind=..., name=...)`. New prompt and memory versions are used by the next task decision.

Do not take an environment action. Preserve unresolved alternatives and useful counter-evidence. Do not rewrite sound material merely to show activity. Finish with `skip(reason_code="no_reusable_logic")` when no change is useful, or `skip(reason_code="need_more_task_signal")` when the evidence is insufficient.
