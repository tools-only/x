"""Blind-policy floor for ARC-AGI-3 comparisons.

A scripted policy plays one game through the real bridge without looking at the
frame: it uses only the list of available actions and the terminal state. Its
level count is the floor that a harness arm has to beat on the same game before
a level difference says anything about the harness (some public games fall to
a repeated action or a single click). No model is called.
Design: docs/plans/2026-10-10-self-harness-priority-plan.md (D2)
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import OFFICIAL_MAX_RUNTIME_SECONDS
from .arc_agi_3_e2e import _append_bridge_event_batch, _post_json, _read_jsonl, _wait_for_bridge
from .arc_thin_e2e import PROJECT_ROOT, _bridge_state, _start_bridge, _stop_bridge
from .project import load_project_dotenv

POLICIES = ("repeat_each", "probe_then_each", "uniform_random")
# ACTION6 takes coordinates; the bridge reports which actions are complex only by refusing them.
COMPLEX_ACTIONS = frozenset({"ACTION6"})


class BlindPolicy:
    """The next action from the available-action list alone. Click coordinates are seeded and uniform."""

    def __init__(self, policy: str, repeat: int, seed: int):
        if policy not in POLICIES:
            raise ValueError(f"policy must be one of {', '.join(POLICIES)}")
        self.policy = policy
        self.repeat = max(1, repeat)
        self.random = random.Random(seed)
        self.step = 0
        self.probed: set[str] = set()

    def _payload(self, action: str) -> dict[str, Any]:
        if action in COMPLEX_ACTIONS:
            return {"action": action, "x": self.random.randint(0, 63), "y": self.random.randint(0, 63)}
        return {"action": action}

    def next(self, available: list[str]) -> dict[str, Any] | None:
        choices = sorted(action for action in available if action != "RESET")
        if not choices:
            return {"action": "RESET"} if "RESET" in available else None
        if self.policy == "uniform_random":
            return self._payload(self.random.choice(choices))
        if self.policy == "probe_then_each":
            untried = [action for action in choices if action not in self.probed]
            if untried:
                self.probed.add(untried[0])
                return self._payload(untried[0])
        # Each action in turn, `repeat` times; an action that is not available now is skipped.
        action = choices[(self.step // self.repeat) % len(choices)]
        self.step += 1
        return self._payload(action)


def run_arc_blind_policy(
    root: Path,
    *,
    arc_root: Path,
    game: str,
    policy: str,
    repeat: int = 50,
    seed: int = 0,
    max_actions: int = 200,
    experiment_timeout_seconds: float | None = None,
    mock_environment: bool = False,
) -> Path:
    """Play one game with a blind policy and write ``summary.json`` (levels reached and when)."""
    chooser = BlindPolicy(policy, repeat, seed)
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"run root must be new or empty: {root}")
    root.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + (experiment_timeout_seconds or OFFICIAL_MAX_RUNTIME_SECONDS)
    env = load_project_dotenv(PROJECT_ROOT)
    summary: dict[str, Any] = {
        "format": "arc-blind-policy-v1", "game": game, "policy": policy, "repeat": repeat, "seed": seed,
        "max_actions": max_actions, "mock_environment": mock_environment,
        "passed": False, "stop_reason": None, "actions": 0, "resets": 0, "levels_at_action": [],
    }
    (root / "run-config.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    bridge, bridge_stderr, launch_id, action_token = _start_bridge(
        root, arc_root=PROJECT_ROOT if mock_environment else arc_root, game=game, max_actions=max_actions, env=env,
        bridge_python=Path(__import__("sys").executable) if mock_environment else None,
        bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",) if mock_environment else (),
    )
    closed = False
    state: dict[str, Any] | None = None
    try:
        ready = _wait_for_bridge(root, bridge, launch_id=launch_id)
        url = f"http://127.0.0.1:{int(ready['port'])}"
        levels = 0
        with (root / "trajectory.jsonl").open("a", encoding="utf-8") as log:
            while True:
                state = _bridge_state(url)
                if state is None:
                    summary["stop_reason"] = "bridge_unavailable"
                    break
                if str(state.get("state")) == "WIN":
                    summary["stop_reason"] = "win"
                    break
                if summary["actions"] >= max_actions:
                    summary["stop_reason"] = "max_actions"
                    break
                if time.monotonic() >= deadline - 5:
                    summary["stop_reason"] = "deadline"
                    break
                available = list(state.get("agent_available_actions") or state.get("available_actions") or [])
                if str(state.get("state")) == "GAME_OVER":
                    available = ["RESET"] if "RESET" in available or not available else available
                payload = chooser.next(available)
                if payload is None:
                    summary["stop_reason"] = "no_available_action"
                    break
                try:
                    value = _post_json(url + "/action", payload, timeout=120.0, action_token=action_token)
                except (OSError, RuntimeError, ValueError) as exc:
                    message = str(exc)
                    summary["stop_reason"] = "budget_exhausted" if "budget exhausted" in message else "environment_error"
                    summary["error"] = message[:500]
                    break
                summary["actions"] += 1
                summary["resets"] += payload["action"] == "RESET"
                reached = int(value.get("levels_completed") or 0)
                if reached > levels:
                    summary["levels_at_action"].append({"level": reached, "action": summary["actions"]})
                    levels = reached
                log.write(json.dumps({"n": summary["actions"], **payload, "state": value.get("state"),
                                      "levels_completed": reached}) + "\n")
        try:
            closed_reply = _post_json(url + "/close", {}, timeout=60.0, action_token=action_token)
            events = closed_reply.pop("events", [])
            if isinstance(events, list):
                _append_bridge_event_batch(root, events)
            summary["bridge_close"] = closed_reply
            closed = True
        except (OSError, RuntimeError, ValueError) as exc:
            summary["bridge_close_error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 - persist every runner failure
        summary["stop_reason"] = summary["stop_reason"] or "runner_error"
        summary["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        _stop_bridge(bridge, bridge_stderr, closed)
    summary.update({
        "levels_completed": (state or {}).get("levels_completed"),
        "win_levels": (state or {}).get("win_levels"),
        "final_state": (state or {}).get("state"),
        "actions_recorded": len(_read_jsonl(root / "trajectory.jsonl")),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "passed": summary["stop_reason"] in {"win", "max_actions", "budget_exhausted", "deadline"},
    })
    path = root / "summary.json"
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return path
