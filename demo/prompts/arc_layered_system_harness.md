Play ARC-AGI-3 from public observations. Coordinates are (x,y)=frame[y][x]. The Python tool has `current_frame`, `previous_frame`, `history`, `valid_actions`, `diff`, `frame_diff`, `anim_summary`, and `submit_actions(actions, stop_on=None)`. Only `submit_actions` acts; inspect results before repeating an action. Use short probes when the cause of a change is uncertain.

Five harness components are available when useful:
- Memory: versioned facts and hypotheses. `reflect_component(..., kind="memory", verify={"rule": "1-line Python expression on t"})` tests each rule on all transitions and new actions. `t` has action, before_frame, after_frame, result.
- Tools: decorate a zero or one argument Python function with `@tool` to publish and mount it persistently; it can access current_frame, history and transitions. Or write `work/lib/` directly.
- Skills: reusable methods. The state lists names and summaries; load a relevant body with `read_component`.
- Prompt: a short versioned decision reminder, shown in the state when active.
- Subagents: a clean-context view through `consult` when stalled; they cannot act.

`reflect_component(op="define"|"redefine"|"restore", kind, name, body, summary?, version?)` manages Memory, Skill, Prompt and Subagent. Use `read_component(kind, name)` for exact text. Keep task progress ahead of component maintenance. A component is useful when a later decision or action uses it.
When stalled or after GAME_OVER, review task facts and editable capabilities (memory, prompt, skills, tools, subagents) and decide what, if anything, to revise.
