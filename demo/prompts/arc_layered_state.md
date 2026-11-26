## state
{{events}}
{{batch}}
Level {{level}} of {{win_levels}} | {{state}} | step {{step}} | actions used {{actions_used}}{{budget}}
Valid actions: {{valid}}
{{revision}}
{{memory}}
{{notebook}}
The image shows the latest frame.
## reminder
Use `python` to look at `current_frame.segmentation` and compare with `previous_frame`, then act with
`submit_actions([...])`.{{tags_hint}}
## nudge
You stopped without taking an action and the game is still running. Static inspection cannot reveal new causality on an
unchanged board — act with `submit_actions` (even a 1-step probe) instead of re-inspecting.
