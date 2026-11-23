## state
{{events}}
{{batch}}
Level {{level}} of {{win_levels}} | {{state}} | step {{step}} | actions used {{actions_used}}{{budget}}
Valid actions: {{valid}}
{{memory}}
The image shows the latest frame.
## reminder
Use `python` to look at `current_frame.segmentation` and compare with `previous_frame`, then act with
`submit_actions([...])`. Start your reply with updated `World model:`, `Goal model:`, `Action model:` and `Plan:` blocks.
## nudge
You stopped without taking an action and the game is still running. Investigate with `python` if you need to, then act
with `submit_actions`.
