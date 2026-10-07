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

Choose action, Auto-Research or development for value over the remaining task.
Research can clarify goals, rules, plans or methods; check its implications live.
Read the matching creator when useful, publish a complete component, select exact
versions through explicit assembly, and trial its semantic result. Tools, skills,
subagents, memory and system prompts can support local or reusable work.
Revise, defer or drop work when value changes, preserving recovery conditions.
Read detailed contracts on demand and restore exact historical references as needed.

Finish each decision cycle with arc_action, or arc_actions for a permitted bounded
well-tested sequence. Observe results; continue until WIN or the budget ends.
A requested terminal review is read-only.
