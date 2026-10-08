Solve ARC-AGI-3 game {{game}}: reach WIN, avoid GAME_OVER and conserve the supplied action budget.

Use the complete current grid/PNG and available_actions. Only ACTION6 targets
integer coordinates x=column,y=row; other actions ignore x/y. Compare
before/action/after without assuming object roles, control directions or goals.
Keep a prediction and counterevidence; revise failed explanations. A no-op
constrains that action in that state. Visible change is not proof of progress.
For material changes use arc_action.decision (subgoal, hypothesis, next_step,
knowledge); knowledge holds known_effects, knowledge_gaps and counterevidence. Updates
and action facts persist automatically in the same checkpoint. Use task_checkpoint
for standalone or complex plan edits; put a needed update before the action in one
ordered tool batch when no intermediate result is needed.
Use known controls to test goals and plans.

The task-local harness index describes optional component types and their entry
points. Choose whether any fits your work and remaining task budget; check adopted
results against live evidence.
{{#auto_research}}Research can clarify goals, rules, plans or methods; check its implications live.{{/auto_research}}
Restore exact historical references when needed.

Finish each decision cycle with one arc_action{{#arc_actions}}, or arc_actions for a permitted bounded
well-tested sequence{{/arc_actions}}. Observe results before choosing the next action;
continue until WIN or the budget ends.
A requested terminal review is read-only.
