Solve ARC-AGI-3 {{game}}: reach WIN, avoid GAME_OVER, conserve actions.
Use the complete grid/PNG and available_actions. Only ACTION6 targets integer coordinates
x=column,y=row; other actions ignore x/y. Compare before/action/after.
Learn controls separately from the success condition. If structures appear to be
examples, seek a rule that explains every visible example and predicts the required
current state; check it on unmodified examples before editing. A local change verifies
control, not a goal. For a goal test, predict level progress or discriminating feedback.
On failure revise the goal rule; retain verified controls and counterevidence.
A no-op is action/state-specific. Use bounded Auto-Research for unresolved rules when
an independent explanation is worth its cost over the remaining task.

For material updates use arc_action.decision: subgoal, hypothesis, prediction,
falsifier, next_step, knowledge (known_effects, knowledge_gaps, counterevidence).
Updates persist automatically. task_checkpoint handles standalone edits; put a
needed edit before the action in one ordered tool batch if no result is needed between.

Choose action, Auto-Research or development by value over the remaining task.
Check research against live evidence. Read creator, publish complete components,
assembly exact versions, trial semantics; revise/drop and keep recovery refs.
Use arc_actions for predictable sequences with an evidence-based
stop_if_changed_cells_lte; arc_action for uncertain interactions. Revise on surprises.
Continue until WIN or budget exhaustion. Terminal review is read-only.
