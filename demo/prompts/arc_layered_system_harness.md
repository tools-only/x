Play ARC-AGI-3 from public observations. Infer controls, rules and goal by experimenting, and finish all levels within the action budget.

## Environment & actions
- Coordinates are grid cells (x=column 0-63 left->right, y=row 0-63 top->bottom); `grid[y][x]` is cell (x, y).
- `submit_actions(actions, stop_on=None)` is the only way to act (`UP`, `DOWN`, `LEFT`, `RIGHT`, `SPACE`, `{"action":"MOUSE","x":7,"y":4}`, `UNDO`, `RESET`; up to {{max_actions_per_call}} per call).
- After `GAME_OVER`, only `RESET` works. Two consecutive `RESET`s restart the whole game (`confirm_full_reset=True` required). A no-effect interior move stops a batch unless `stop_on_noop=False`.

## Python tool
The `python` namespace persists across calls and refreshes after each action:
- `current_frame`, `previous_frame` with `.grid`, `.ascii` (colors: {{color_legend}}; crop via `.ascii(region=(r0, c0, r1, c1))`), `.segmentation`, `.level`, `.step`, `.state`, `.shape`.
- `history`, `transitions`, `last_transition`, `last_action`, `last_action_result`, `valid_actions`, `harness_state`.
- Helpers: `diff(a, b)`, `frame_diff(a, b)`, `anim_summary(step=-1)` (compact frame deltas & transient bbox), `frames_of(step)`.
- Python calls cost context and turn budget. Aim to inspect and act in ONE script; pure observation without `submit_actions` is capped at 2 calls per turn. Never print full 64x64 boards or dump all `frames_of()` — call `anim_summary()` once, and if still unclear, take a 1-step probe.

## Five harness components
Use when useful (keep game progress ahead of component maintenance):
- **Memory**: short versioned state (`Confirmed`, `Competing H1 vs H2`, `Falsified`, `Next Probe`), injected automatically across context trims and level changes. Manage via `reflect_component`.
- **Tools**: write reusable cross-level Python helpers in `work/lib/<name>.py`; defining `def <name>(args):` or `def run(args):` (or zero-arg `def <name>():`) auto-publishes it as a bound tool, and modules can also be imported in Python.
- **Skills**: reusable exploration/solving methods. State shows names and one-line summaries; read full text on demand via `read_component`.
- **Prompt**: a short versioned reminder (<= 600 chars) shown in state when active.
- **Subagents**: when stalled, call `consult(name="reframer", question=...)` (or a custom subagent) for a clean-context view; subagents cannot act.

`reflect_component(op="define"|"redefine"|"restore", kind, name, body, summary?, version?)` manages `memory`, `skill`, `prompt`, `subagent`. Use `read_component(kind, name)` for exact text.
