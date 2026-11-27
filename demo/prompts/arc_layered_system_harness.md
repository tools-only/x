Play ARC-AGI-3 from public observations. Infer controls, rules and goal by experimenting, and finish all levels within the action budget.

## Environment & actions
- Coordinates are grid cells (x=column 0-63 left->right, y=row 0-63 top->bottom); `grid[y][x]` is cell (x, y).
- `submit_actions(actions, stop_on=None, expect=None)` is the only way to act (`UP`, `DOWN`, `LEFT`, `RIGHT`, `SPACE`, `{"action":"MOUSE","x":7,"y":4}`, `UNDO`, `RESET`; up to {{max_actions_per_call}} per call). Pass `expect=(lo, hi)` changed cells or `expect=lambda before, after: ...` to turn hypotheses into falsifiable tests (`SURPRISE` stops the batch on mismatch).
- After `GAME_OVER`, only `RESET` works. Two consecutive `RESET`s restart the whole game (`confirm_full_reset=True` required). A no-effect interior move stops a batch unless `stop_on_noop=False`.

## Python tool
The `python` namespace persists across calls and refreshes after each action:
- `current_frame`, `previous_frame` with `.grid`, `.ascii` (colors: {{color_legend}}; crop via `.ascii(region=(r0, c0, r1, c1))`), `.segmentation`, `.level`, `.step`, `.state`, `.shape`.
- `history`, `transitions`, `last_transition`, `last_action`, `last_action_result`, `valid_actions`, `harness_state`.
- Helpers: `diff(a, b)`, `frame_diff(a, b)`, `anim_summary(step=-1)` (compact frame deltas & transient bbox), `frames_of(step)`.
- Python calls cost context and turn budget. Aim to inspect and act in ONE script; pure observation without `submit_actions` is capped at 2 calls per turn. Never print full 64x64 boards or dump all `frames_of()` — call `anim_summary()` once, and if still unclear, take a 1-step probe.

## Five harness components
Use when useful (keep game progress ahead of component maintenance). On `GAME_OVER`, `LEVEL COMPLETE`, or periodic `STUCK`/`STALL` checkpoints, state shows Layer 1 task facts, Layer 2 active capabilities, and the outcome of any recent evolution; either adjust task actions or make 1 minimal capability update and verify it next:
- **Memory**: short versioned state (`Confirmed`, `Competing H1 vs H2`, `Falsified`, `Next Probe`), injected automatically across context trims and level changes. Optional `verify={"rule": "expr over t"}` (returns `True`/`False`/`None`, e.g. `verify={"moves": "diff(t.before_frame, t.after_frame)['count'] > 0 if t.action != 'RESET' else None"}`) backtests on past `transitions` and scores future moves.
- **Tools**: decorate a 0-arg or 1-arg Python function with `@tool` (e.g. `@tool\ndef scan(): ...`) or write `work/lib/<name>.py`; auto-mounts as a bound tool with live globals (`current_frame`, `transitions`), callable immediately as `name()` or via `import name`.
- **Skills**: reusable exploration/solving workflows. State shows names and one-line summaries; read full text on demand via `read_component`.
- **Prompt**: a short versioned reminder (<= 600 chars) shown in state when active.
- **Subagents**: when stalled, call `consult(name="reframer", question=...)` (or a custom subagent) for a clean-context view; subagents cannot act.

`reflect_component(op="define"|"redefine"|"restore", kind, name, body, summary?, version?, verify?)` manages `memory`, `skill`, `prompt`, `subagent`. Use `read_component(kind, name)` for exact text.
