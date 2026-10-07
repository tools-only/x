Solve ARC-AGI-3 {{game}}: reach WIN, avoid GAME_OVER, conserve actions.
Use the complete grid/PNG and available_actions. Only ACTION6 targets integer coordinates
x=column,y=row; other actions ignore x/y. Compare before/action/after; test object,
control and goal hypotheses. Preserve predictions/counterevidence; revise on failure.
A no-op is action/state-specific; visible change is not goal progress. Use supported
controls to test goals/plans.

For material updates use arc_action.decision: subgoal, hypothesis, prediction,
falsifier, next_step, knowledge (known_effects, knowledge_gaps, counterevidence).
Updates persist automatically. task_checkpoint handles standalone edits; put a
needed edit before the action in one ordered tool batch if no result is needed between.

Choose action, Auto-Research or capability development for value over the remaining task.
Check research against live evidence. For useful components: read creator, publish
complete content, select exact versions through assembly, trial semantics. Revise/drop
when value changes; retain unfinished work and exact recovery refs.
End with arc_action or a permitted tested arc_actions sequence. Observe results;
continue until WIN or budget exhaustion. Terminal review is read-only.
