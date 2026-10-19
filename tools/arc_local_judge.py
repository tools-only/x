"""Plays a plan in a local copy of an ARC-AGI-3 game, once (docs/plans/2026-10-19-offline-world-model.md, round 3).

Input (JSON on stdin): {"env_dir", "game", "prefix": [[action, x, y], ...], "plan": [[action, x, y], ...]}. The game is
reset, the prefix (a run's recorded actions up to the level to plan) is replayed, and the plan is played until it ends,
the level is completed or the game is over. Output (JSON on stdout): the grid after the prefix, and per plan step the
grid, state and levels completed. OFFLINE mode only: the game must have been downloaded before (NORMAL mode). The local
game is a black-box judge; its frames never reach the model that made the plan.

Usage: python -I tools/arc_local_judge.py < request.json > result.json
"""
import json
import sys


def main():
    request = json.loads(sys.stdin.read())
    from arc_agi import Arcade, OperationMode
    from arcengine import GameAction
    arcade = Arcade(operation_mode=OperationMode.OFFLINE, environments_dir=request["env_dir"])
    env = arcade.make(request["game"])
    if env is None:
        raise SystemExit(json.dumps({"error": "no local environment for " + request["game"]}))

    def play(action, x=None, y=None):
        data = {"x": int(x), "y": int(y)} if x is not None and y is not None else {}
        raw = env.step(GameAction.from_name(action), data=data)
        if raw is None:
            raise RuntimeError("no frame after " + action)
        frame = raw.frame[-1]
        return {"grid": frame.tolist() if hasattr(frame, "tolist") else frame,
                "state": str(getattr(raw.state, "name", raw.state)), "levels_completed": int(raw.levels_completed)}

    current = play("RESET")
    for item in request["prefix"]:
        current = play(*item)
    out = {"start": current, "steps": [], "completed_at": None, "game_over_at": None}
    level = current["levels_completed"]
    for i, item in enumerate(request["plan"]):
        if item[0] == "RESET":
            out["steps"].append({"refused": "RESET is not part of a plan"})
            break
        step = play(*item)
        out["steps"].append(step)
        if step["levels_completed"] > level:
            out["completed_at"] = i + 1
            break
        if step["state"] == "GAME_OVER":
            out["game_over_at"] = i + 1
            break
    print(json.dumps(out))


if __name__ == "__main__":
    main()
