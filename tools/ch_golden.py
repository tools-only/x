"""Golden outputs of Continual Harness's observation renderers, for tests/arc_thin_ch_view.test.ts.

Run with the Continual Harness checkout's own environment, e.g.
    D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3/.venv/Scripts/python.exe tools/ch_golden.py \
        D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3 tests/fixtures/ch_golden.json
The fixture inputs are written next to each output, so the test feeds this harness's port the same inputs.
"""
from __future__ import annotations

import base64
import json
import sys
import types
from pathlib import Path

ch_root, out_path = Path(sys.argv[1]), Path(sys.argv[2])
# Import the renderers without running agents/__init__.py (it loads the whole agent and its services).
package = types.ModuleType("agents")
package.__path__ = [str(ch_root / "agents")]
sys.modules["agents"] = package
sys.path.insert(0, str(ch_root))

from arcengine import FrameData, GameState  # noqa: E402
from agents.templates.continual_harness.context import build_observation_section, build_working_prompt  # noqa: E402
from agents.templates.continual_harness.helpers import grid_to_image  # noqa: E402
from agents.templates.continual_harness.models import PendingActionObservation  # noqa: E402
from agents.templates.continual_harness.trajectory import render_recent_history, summarize_grid_transitions  # noqa: E402
from agents.templates.continual_harness_agent import _compute_grid_delta  # noqa: E402


def grid(fill: int, marks: dict[tuple[int, int], int] | None = None, h: int = 4, w: int = 6) -> list[list[int]]:
    rows = [[fill] * w for _ in range(h)]
    for (y, x), value in (marks or {}).items():
        rows[y][x] = value
    return rows


def frame(state: str, score: int, layers: list[list[list[int]]], actions: list[int] | None = None) -> FrameData:
    return FrameData(state=GameState[state], levels_completed=score, frame=layers, available_actions=actions or [1, 2, 6])


base = grid(0, {(1, 1): 3})
moved = grid(0, {(1, 2): 3})
flash = grid(0, {(1, 1): 3, (0, 0): 12, (3, 5): 12})
flash2 = grid(0, {(1, 1): 3, (0, 0): 12, (0, 1): 12, (2, 5): 11})
frames = [
    frame("NOT_PLAYED", 0, []),                                   # 0: before the first RESET
    frame("NOT_FINISHED", 0, [base]),                             # 1: after RESET
    frame("NOT_FINISHED", 0, [moved]),                            # 2: ACTION1 changed the final grid
    frame("NOT_FINISHED", 0, [flash, flash2, moved]),             # 3: ACTION6 flashed and settled unchanged
    frame("NOT_FINISHED", 0, [moved]),                            # 4: ACTION2 changed nothing
    frame("GAME_OVER", 0, [grid(5), grid(5, {(0, 0): 8})]),       # 5: ACTION3 ended the game
]
observations = [
    dict(step=0, action="RESET", data={}, source="auto_reset", pre=0, post=1, valid=True),
    dict(step=1, action="ACTION1", data={}, source="arc_action", pre=1, post=2, valid=True, batch=("b_0001_ab12", 1, 2)),
    dict(step=2, action="ACTION6", data={"x": 5, "y": 3}, source="arc_action", pre=2, post=3, valid=True, batch=("b_0001_ab12", 2, 2)),
    dict(step=3, action="ACTION2", data={}, source="python", pre=3, post=4, valid=True),
    dict(step=4, action="ACTION4", data={}, source="python", pre=4, post=4, valid=False),
    dict(step=5, action="ACTION3", data={}, source="tool: probe", pre=4, post=5, valid=True),
]
pending = [PendingActionObservation(action_counter=o["step"], action_name=o["action"], action_data=o["data"], source=o["source"],
                                    batch_id=(o.get("batch") or (None,))[0], batch_position=(o.get("batch") or (None, None))[1],
                                    batch_total=(o.get("batch") or (None, None, None))[2], pre_frame_index=o["pre"],
                                    post_frame_index=o["post"], valid_frame=o["valid"]) for o in observations]
observation_inputs = []
for o in observations:
    pre, post = frames[o["pre"]], frames[o["post"]]
    observation_inputs.append({
        "step": o["step"], "action": o["action"], **({"data": o["data"]} if o["data"] else {}), "source": o["source"],
        **({"batchId": o["batch"][0], "batchPosition": o["batch"][1], "batchTotal": o["batch"][2]} if o.get("batch") else {}),
        "preState": pre.state.name, "preScore": pre.levels_completed, **({"preGrid": pre.frame[-1]} if pre.frame else {}),
        **({"postState": post.state.name, "postScore": post.levels_completed} if o["valid"] else {}),
        "animation": post.frame if o["valid"] else [], "validFrame": o["valid"]})
text, rendered = build_observation_section(pending, frames)
text_budget, rendered_budget = build_observation_section(pending, frames, max_text_grids=1)

# RECENT HISTORY over two levels, with a GAME_OVER attempt, a loop and every source.
def record(step, action, source, score, state="NOT_FINISHED", after="NOT_FINISHED", delta=0, data=None, change=None, cells=None):
    return {"action_counter": step, "chosen_action": action, "chosen_action_data": data or {}, "source": source, "score": score,
            "state": state, "state_after": after, "score_delta": delta, "grid_change": change, "grid_delta": cells}
history = [record(0, "RESET", "auto_reset", 0, state="NOT_PLAYED"),
           record(1, "ACTION1", "arc_action", 0, change=[[0, 3, 1, 1, 1, 2, 2], [3, 0, 1, 1, 1, 1, 1]]),
           record(2, "ACTION1", "arc_action", 0, delta=1, change=[[0, 3, 1, 1, 1, 3, 3]]),
           record(3, "ACTION6", "python", 1, data={"x": 5, "y": 3}, change=None),
           record(4, "ACTION3", "tool: probe", 1, after="GAME_OVER"),
           record(5, "RESET", "auto_reset", 1, state="GAME_OVER"),
           *[record(6 + i, "ACTION2", "arc_action", 1) for i in range(12)],
           record(18, "ACTION4", "arc_action", 1, cells=[[2, 1, 0, 3], [3, 1, 3, 0], [4, 2, 0, 3]])]
history_text = render_recent_history(history, max_chars=12000)
history_short = render_recent_history(history, max_chars=150)

# CURRENT STATE, as build_working_prompt prints it.
latest = frame("NOT_FINISHED", 2, [base, moved], actions=[0, 1, 2, 6, 7])
prompt = build_working_prompt(latest, action_counter=7, recent_tool_results=[], history_block="", memory_overview="",
                              skill_overview="", subagent_overview="")
state_block = prompt[prompt.index("## CURRENT STATE"):prompt.index("\n\n## TURN")]

image = grid_to_image(grid(0, {(0, 0): 15, (1, 2): 9, (3, 5): 4}))
out_path.write_text(json.dumps({
    "observations": {"inputs": observation_inputs, "text": text, "labels": [g.label for g in rendered],
                     "budget1_text": text_budget, "budget1_labels": [g.label for g in rendered_budget]},
    "history": {"inputs": [{"step": r["action_counter"], "action": r["chosen_action"],
                            **({"data": r["chosen_action_data"]} if r["chosen_action_data"] else {}), "source": r["source"],
                            "score": r["score"], "state": r["state"], "stateAfter": r["state_after"], "scoreDelta": r["score_delta"],
                            "gridChange": r["grid_change"], "gridDelta": r["grid_delta"]} for r in history],
                "text": history_text, "short": history_short},
    "state": {"grid": moved, "actions": ["RESET", "ACTION1", "ACTION2", "ACTION6", "ACTION7"], "levels": 2, "text": state_block},
    "transitions": {"pre": flash, "post": flash2, "change": summarize_grid_transitions(flash, flash2),
                    "delta": _compute_grid_delta(flash, flash2)},
    "image": {"grid": grid(0, {(0, 0): 15, (1, 2): 9, (3, 5): 4}), "size": list(image.size),
              "rgba": base64.b64encode(image.tobytes()).decode("ascii")},
}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("wrote", out_path)
