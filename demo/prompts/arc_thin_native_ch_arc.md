
## INPUT FORMAT
Each decision shows the game as follows:
- **Observations since last query**: when actions were executed after the previous decision's prompt, the prompt includes one ACTION/RESULT block per action. These blocks summarize state/score changes and animation behavior. For token efficiency, if an action changed the final grid, only that action's final frame is rendered; if an action's final grid returned unchanged but intermediate animation changed, selected keyframes are rendered and labeled with their original frame indices from that action's returned `frame` list. Use `state["observations"]` in python to see the full frames.
- **Recent history**: level- and attempt-grouped action log with effects (score deltas, cell changes, level transitions). `state["recent_trajectory"]` in python holds the step records: `grid_change` rows [from, to, count, r0, r1, c0, c1], `grid_delta` rows [x, y, from, to].
- **Current state**: game state (NOT_FINISHED/WIN/GAME_OVER), score (how many levels completed), available actions with their meanings, and the authoritative current grid `latest_frame.frame[-1]` rendered exactly once.
- **Grid format**: grids are rendered as a **hex map** — one dense string per row, each character a hex digit `0-f` = color `0-15` (e.g. `e` = color 14). In python a grid is a list of int rows: `grid[y][x]` is the color int, `int(ch, 16)` of the hex digit.
- **Images**: attached PNG images correspond exactly, in prompt order, to the grids rendered in text.

## COORDINATE SYSTEM
Zero-based, origin top-left. Rows increase downward (r0 top, r63 bottom). Columns increase rightward (c0 left, c63 right). Cell at r25 c34 = x=34, y=25. For ACTION6 pass x=column, y=row.

## GAME CONTROL
**arc_action**
- **Required:** `reasoning` (string), `actions` (array of action objects)
- Each action object: `{name, x?, y?, predict?}` — `name` is required; `x` and `y` (0-63) required only for ACTION6.
- **Action key:** ACTION1=Up/W · ACTION2=Down/S · ACTION3=Left/A · ACTION4=Right/D · ACTION5=Enter/Space/Delete · ACTION6=Click(x,y) · ACTION7=Undo/Back · RESET=restart the level
- The current frame's prompt lists which actions are available this turn — calling an unavailable action is rejected.
- Keep lists **SHORT** (1-4 actions, prefer 1 when the next state is hard to predict). Long sequences are risky: a single wrong assumption mid-batch wastes every action after it. If a step becomes invalid mid-sequence (level transition, game ended), the remainder is skipped.
- Python acts the same way: env.act(action, x, y, predict) plays one action and returns its feedback; env.act([{"name": ..., "x": ..., "y": ...}, ...]) plays a list like arc_action and returns {executed_count, last_frame, terminal, level_changed, state, score, available_actions}. Re-check `terminal` and `level_changed` before acting again: a level transition makes any precomputed plan stale.

## GAME SETTING
Multiple levels share the SAME underlying rule. The game is completely new — do NOT hallucinate rules from known games. Pay close attention to environment feedback: how the grid changes after each action is your primary signal.

Every level may have a hard action cap. Spend each action wisely: avoid long and unpredictable action sequences, and do NOT burn actions on filler. Take an experimental action only when a specific hypothesis needs that exact observation.
