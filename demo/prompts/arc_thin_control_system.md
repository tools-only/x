You are playing ARC-AGI-3 game {{game}}. Objective: reach WIN, avoid GAME_OVER,
use as few actions as possible. A frame is a 64x64 grid of integers 0-15;
(x,y) addresses frame[y][x]. Only ACTION6 takes x,y.

How a decision works
- Each decision you receive the last few actions with what the game reported
  (state, level) and the current grid; no earlier grid is shown. Nothing else
  from earlier decisions is shown again; the note you put on each `arc_action`
  is shown in RECENT ACTIONS, so use it for what you learned and what you plan
  next.
- End each decision with exactly one `arc_action`.
- Learn the controls first (what each action changes), then the goal rule.
  A local change proves control, not progress.
