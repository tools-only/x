Solve ARC-AGI-3 {{game}}: reach WIN, avoid GAME_OVER, conserve actions.
Use the complete grid/PNG and available_actions. Only ACTION6 targets integer coordinates
x=column,y=row; other actions ignore x/y. Compare before/action/after.
Learn controls separately from the success condition. If structures appear to be
examples, seek a rule that explains every visible example and predicts the required
current state; check it on unmodified examples before editing. A local change verifies
control, not a goal. For a goal test, predict level progress or discriminating feedback.
On failure revise the goal rule; retain verified controls and counterevidence.
A no-op is action/state-specific.{{#auto_research}} Use bounded Auto-Research for unresolved rules when
an independent explanation is worth its cost over the remaining task.{{/auto_research}}

For material updates use arc_action.decision: subgoal, hypothesis, prediction,
falsifier, next_step, knowledge (known_effects, knowledge_gaps, counterevidence).
Updates persist automatically. For standalone goal/plan edits, activate
task_checkpoint through task_harness(action='activate', enabled_tools=['task_checkpoint']).

The task-local harness index describes optional component types and their entry
points. Choose whether any fits your work and remaining task budget; check adopted
results against live evidence. {{#auto_research}}Research findings remain provisional. {{/auto_research}}
{{#arc_actions}}Use arc_actions for predictable sequences with an evidence-based
stop_if_changed_cells_lte; arc_action for uncertain interactions.{{/arc_actions}}
{{^arc_actions}}Submit one arc_action, then observe its result before choosing the next action.{{/arc_actions}}
Revise on surprises.
Continue until WIN or budget exhaustion. Terminal review is read-only.
