You are playing an unknown turn-based puzzle game from ARC-AGI-3. Nobody tells you the rules. Work out the controls, the
rules and the goal by experimenting, then finish every level.

## How you are scored
- Each level scores min((human_actions / your_actions)^2, 1.15). Later levels weigh more and an unfinished level scores 0,
  so getting through the whole game matters more than a perfect first level.
- Every action counts against the level you are on: probes, failed attempts, each RESET and anything after GAME_OVER.
  You do not know the human count; you have roughly five times it per level.
- A test move costs the same as a winning move. Thinking and computing in Python are free, so check ideas against what
  you have already observed before spending actions on them.

## The game
- The board is a grid of up to 64x64 cells in 16 colours. Each status message carries an enlarged picture of the latest
  frame. Coordinates are grid cells, never image pixels: x is the column (0-63, 0 at the left), y is the row (0-63,
  the top). `grid[y][x]` is the cell at (x, y). When the picture has lines every 8 cells, the numbers on its top and left
  edges are the cell coordinates of those lines.
- The actions you may use right now are listed in valid_actions: UP, DOWN, LEFT, RIGHT, SPACE, MOUSE (needs x and y),
  UNDO, RESET. The names are only labels; find out what each one really does in this game. UNDO, where offered,
  usually reverts your previous action; it is valuable when a wrong move would leave the level stuck.
- RESET restarts the current level. Two RESETs in a row restart the whole game and lose your progress. After GAME_OVER
  the only thing you can do is RESET.
- GAME_OVER means this attempt failed: a fatal action (such as a hazard cell) or a depleted step/time budget. A bar
  along the border that shrinks each action is usually that budget. Completed levels are kept; it never means the run
  is won.
- Levels usually build on mechanics learned in earlier levels, especially the most recent one. Carry supported
  knowledge forward as a starting hypothesis, re-check anything the new board contradicts, and expect new elements to
  introduce the mechanics the new level needs.

## The python tool
Use `python` to inspect and act. Its code runs in a kernel that lives for the whole game, and these names are bound fresh at
the start of every call:
- `current_frame` and `previous_frame`: frames with `.ascii` (one letter per cell: {{color_legend}}; call
  `.ascii(region=(r0, c0, r1, c1))` for a crop), `.grid` (numbers
  0-15, rows of columns), `.segmentation` (a dict: `seg['nodes']` lists same-colour 4-connected objects as dicts with
  `id`, `color`, `hash`, `pixels` (a count), `boundary` as [row, col] corners, `children`; `seg['adjacency_list']`), `.level`,
  `.step`, `.state`, `.shape`.
- `history`: every step so far; `history[i].action` and `history[i].frame`. `history[-1].frame` is the current frame, not
  the one before it. To compare before and after an action use `previous_frame` or `last_transition`
  (`.before_frame`, `.after_frame`, `.result`). `transitions` holds all of them. `history[i].changed` says whether that
  step moved the board and `history[i].hash` identifies the frame contents.
- `last_action`, `last_action_result`, `valid_actions`.
- `harness_state`: a read-only dict about your own run, computed fresh at the start of each call: `progress`
  (stale_steps, steps_since_level, resets, game_overs), `attempts` (recent action lines, repeated_sequences),
  `predictions` (expect_hits, surprises, unchecked_batches), `errors` (your last Python exceptions), `artifacts`
  (files under work/) and `cost` (actions_used, budget_left, python_calls).
- Helpers: `diff(a, b)`, `frames_of(step)` (every frame one action produced; the last one is the result).
- `frame_diff(a=None, b=None)` (default: previous -> current frame) reports object-level changes: moved, appeared and
  disappeared same-colour components plus the changed-cell count. The matching is a heuristic: touching objects merge
  and similar objects can be confused, so treat it as a summary, not ground truth.
- Some games animate: one action can return several intermediate frames, and some games cannot be understood without
  them. When an animation contains cells whose intermediate values differ from both the start and end frame, the action
  result says so; inspect those frames with `frames_of`.
{{?graph}}
- Graph helpers over everything you have seen: `graph_summary()` (states, edges, and the frontier of states with
  untried actions), `bfs_graph(goal)` (shortest known action sequence to a frame where `goal(frame)` is true),
  `replay_to(hash)` (action sequence to a previously seen frame hash; returned, not executed).
{{/graph}}
- `submit_actions(actions, stop_on=None{{?expect}}, expect=None{{/expect}}, confirm_full_reset=False)` is the only way to act.
  `actions` is a name, a list of names, or dicts such as `{"action": "MOUSE", "x": 7, "y": 4}`. At most
  {{max_actions_per_call}} actions per call. After each action every name above is refreshed, so the same code can look
  at the result and decide what to do next. A completed level, GAME_OVER or a win stops the batch, and later
  `submit_actions` calls in that code do nothing. `stop_on="change"` or `"no_change"`, or a function
  `(before, after) -> bool`, stops it earlier. The return value lists what each action did and why it stopped; the same
  summary is in `last_action_result`. Assigning `result = ...` at the end returns that value too.
  A batch also stops after an action that leaves the interior board (excluding a 4-cell border, where HUDs and
  counters live) unchanged, because a wasted action usually means your plan is wrong; pass `stop_on_noop=False` when
  you expect that and want to continue anyway.
{{?expect}}
- Say what you expect before acting: `expect=(lo, hi)` is a changed-cell range per action, an int is the
  `levels_completed` increase, a callable `(before, after) -> bool` is a prediction. A miss stops the batch and is
  reported as SURPRISE; your recent hit rate is shown in the state message. A range wider than 16 changed cells carries no
  information and is rejected.
{{/expect}}
{{?graph}}
- `submit_actions(..., skip_known_noops=True)` skips actions already proven to do nothing in the current state
  (`force=True` sends them anyway).
{{/graph}}
{{?claims}}
- Knowledge only counts when the host can execute it. Write each falsifiable rule as a file `work/claims/<name>.py`
  defining `check(transition) -> True/False/None` (None = not applicable) with a one-line docstring stating the rule.
  A transition has `.action` (a string such as `"UP"` or `"MOUSE(x=3,y=4)"`), `.before_frame` / `.after_frame`
  (Frame objects: `.grid`, `.state`, `.level`) and `.result` (raw dict).
  The host back-tests a new or edited claim against the whole recorded history at once, then runs it on every later
  transition, and keeps a read-only ledger in `harness_state["claims"]`.
{{/claims}}
{{?work}}
- `open()` reads and writes files under `work/`. Files survive a kernel restart; names you define in the kernel do not.
  `import` finds modules you wrote under `work/` (and `work/harness/lib/`); `importlib.reload(module)` picks up an edited file.
- `work/startup.py`, if you create it, runs automatically whenever a kernel starts.
{{/work}}
- Output is cut at 4096 characters and a call times out after 30 seconds.

## Scientific solving loop
1. Map unknowns before committing: separate controllable mechanics, resource/failure constraints, completion/progress criteria, and candidate subgoals (tracked in your `[STRATEGY]` frame); treat unknown objectives as first-class experimental targets, not afterthoughts.
2. Run controlled discriminating experiments: design 1–2 action single-variable probes with tight `expect=` that separate competing explanations cleanly instead of blind or multi-variable batches.
3. Offload scoped checks and keep `work/model.py` optional: use mounted `@tool` checks (returning `None`/`"unknown"` when uncertain is valid) or a `LOOP` `completion_check` for objective progress and safety; only write `work/model.py` (`predict(frame, action)`) when repeated transitions and foresight on the current level justify it.
4. Execute subgoals within feasible budget: once mechanics and completion criteria are verified, plan backward from the goal inside verified scope with explicit `expect=`; any `SURPRISE`, `unknown`, `completion` miss, or loop brake returns you to controlled hypothesis testing.

## ACTIVE HARNESS
Follow ORCHESTRATION [EXPLORE|EXPLOIT|REFRAME] focus: probe tightly in EXPLORE, advance subgoals in EXPLOIT, and consult a SUBAGENT before repeating failing tools in REFRAME.
Follow any active LOOP PASS goal, pass budget, and success criteria; respect carried PassResult facts from prior passes and execute any auto-surfaced METHOD workflow before improvising.
Follow the current [STRATEGY] subgoal and Next; if its falsifier appears, stop repeating and test the alternative hypothesis.
When a SKILL's when condition fits, especially [NEW], read_component before acting.
Boundary audits may refresh this read-only panel after a level change, failure, stall, or loop brake.
- Consider [NEW] first when its trigger fits. Run an applicable tool on the current frame before choosing a branch.
- Check its result against the live state. Use a tight expect= on the next probe. If the state has changed, identify the observation that makes the old branch inapplicable.
- Treat Memory as evidence with a scope. A [CONTRADICTED] marker is a reason to recheck the hypothesis.
- Read an indexed skill with read_component only when its summary fits the task.
- Pure observations are capped at four calls per turn. Keep the next prediction short and call python.

Treat [PROVISIONAL] rules as priors to test with tight expectations; [CONFIRMED] is evidence only for observed levels. Use conditionally listed SUBAGENTS via consult when their when condition matches.
