"""Localhost bridge between Pi tools and the official ARC-AGI-3 SDK.

This module is launched with the Python interpreter from the local ARC checkout.
It owns transport and scorecard lifecycle only; it never chooses an action for
the agent.  Every accepted/forced action is appended immediately so interrupted
runs remain inspectable.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from .arc_agi_3_adapter import ArcAgi3Adapter, DEFAULT_ACTION_BUDGET_MULTIPLIER


ARC_ACTION_BUDGET_MULTIPLIER = DEFAULT_ACTION_BUDGET_MULTIPLIER


def derive_action_budget(baseline_actions: list[int] | None, multiplier: float = ARC_ACTION_BUDGET_MULTIPLIER) -> int:
    """Match ARC benchmarking's per-level baseline budget policy."""
    if baseline_actions:
        import math
        return sum(math.ceil(int(value) * multiplier) for value in baseline_actions)
    return 10


def _enum_name(value: Any) -> str:
    return str(getattr(value, "name", value))


def serialize_frame(raw: Any, *, action_name: Callable[[int], str]) -> dict[str, Any]:
    """Convert SDK ``FrameDataRaw`` into a stable JSON-safe tool observation."""
    if raw is None:
        raise ValueError("ARC environment returned no frame")
    return {
        "game_id": str(raw.game_id),
        "frames": [frame.tolist() if hasattr(frame, "tolist") else frame for frame in raw.frame],
        "state": _enum_name(raw.state),
        "levels_completed": int(raw.levels_completed),
        "win_levels": int(raw.win_levels),
        "guid": str(raw.guid or ""),
        "full_reset": bool(raw.full_reset),
        "available_actions": [action_name(action_id) for action_id in raw.available_actions],
    }


def parse_action_payload(
    payload: dict[str, Any],
    available_actions: list[str],
    action_from_name: Callable[[str], Any],
) -> Any:
    """Validate one agent-selected action against the current native frame."""
    name = payload.get("action")
    if not isinstance(name, str) or name not in available_actions:
        raise ValueError(f"action {name!r} is not currently available")
    action = action_from_name(name)
    complex_action = bool(action.is_complex())
    supplied = set(payload) - {"reasoning"}
    expected = {"action", "x", "y"} if complex_action else {"action"}
    if supplied != expected:
        if complex_action:
            raise ValueError("complex ARC actions require exactly integer coordinates x and y")
        # Some providers habitually emit optional coordinates even when the
        # selected native action is simple.  They have no semantic effect for
        # a simple ARC action, so ignore them instead of consuming an invalid
        # exploration turn.  Complex actions remain strict below.
        unexpected = supplied - {"action", "x", "y"}
        if unexpected:
            raise ValueError("unsupported fields for simple ARC actions: " + ", ".join(sorted(unexpected)))
    if complex_action:
        x, y = payload.get("x"), payload.get("y")
        if type(x) is not int or type(y) is not int:
            raise ValueError("complex ARC actions require integer coordinates")
        if not (0 <= x <= 63 and 0 <= y <= 63):
            raise ValueError("ARC coordinates must be in 0..63")
        action.set_data({"x": x, "y": y})
    return action


class ArcBridge:
    def __init__(self, root: Path, game: str, max_actions: int | None = None):
        from arc_agi import Arcade, OperationMode
        from arcengine import GameAction

        self.root = root
        self.game = game
        self.max_actions = max_actions
        self.game_action = GameAction
        self.arcade = Arcade(operation_mode=OperationMode.ONLINE)
        self.card_id = self.arcade.open_scorecard(tags=["agent", "pi-autoresearch-meta"])
        self.environment = self.arcade.make(game, scorecard_id=self.card_id)
        baseline_actions = list(self.environment.info.baseline_actions or [])
        self.baseline_actions = baseline_actions
        self.action_budget_multiplier = ARC_ACTION_BUDGET_MULTIPLIER
        self.adapter = ArcAgi3Adapter(action_budget_multiplier=self.action_budget_multiplier)
        self.derived_action_budget = derive_action_budget(baseline_actions)
        self.max_actions = int(max_actions) if max_actions is not None else self.derived_action_budget
        self.actions = 0
        self.level_action_counts: list[int] = [0]
        self.forced_actions = 0
        self.closed = False
        self.scorecard: dict[str, Any] | None = None
        self._lock = threading.Lock()
        self._append({
            "event": "scorecard_opened", "game": game, "scorecard_id": self.card_id,
            "baseline_actions": baseline_actions,
            "action_budget_multiplier": self.action_budget_multiplier,
            "action_budget": self.max_actions,
        })
        self._normalize_initial_state()

    def _append(self, event: dict[str, Any]) -> None:
        with (self.root / "bridge-events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
            stream.flush()

    def _frame(self) -> dict[str, Any]:
        frame = serialize_frame(
            self.environment.observation_space,
            action_name=lambda action_id: self.game_action.from_id(action_id).name,
        )
        native_actions = frame["available_actions"]
        complex_actions = {
            name: bool(self.game_action.from_name(name).is_complex())
            for name in native_actions
        }
        return self.adapter.observe(
            frame, native_actions=native_actions, complex_actions=complex_actions
        )

    def _normalize_initial_state(self) -> None:
        frame = self._frame()
        if frame["state"] != "NOT_PLAYED":
            return
        action = self.game_action.from_name("RESET")
        raw = self.environment.step(action, data=action.action_data.model_dump(), reasoning={})
        self.actions += 1
        self.level_action_counts[0] += 1
        self.forced_actions += 1
        self.adapter.record_action(action.name)
        after = self._frame()
        self._append({"event": "forced_action", "reason": "initial_not_played", "action": "RESET", "frame": after})

    def state(self) -> dict[str, Any]:
        with self._lock:
            frame = self._frame()
            level = int(frame["levels_completed"])
            while len(self.level_action_counts) <= level:
                self.level_action_counts.append(0)
            level_budget = (
                math.ceil(self.baseline_actions[level] * self.action_budget_multiplier)
                if level < len(self.baseline_actions) else self.max_actions
            )
            frame["action_budget"] = {
                "used": self.level_action_counts[level], "maximum": level_budget,
                "total_used": self.actions, "total_maximum": self.max_actions,
                "level": level,
                "baseline_actions": self.baseline_actions,
                "multiplier": self.action_budget_multiplier,
            }
            return frame

    def step(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if self.closed:
                raise ValueError("ARC scorecard is already closed")
            if self.actions >= self.max_actions:
                raise ValueError("ARC action budget exhausted")
            before = self._frame()
            level = int(before["levels_completed"])
            while len(self.level_action_counts) <= level:
                self.level_action_counts.append(0)
            level_budget = (
                math.ceil(self.baseline_actions[level] * self.action_budget_multiplier)
                if level < len(self.baseline_actions) else self.max_actions
            )
            if self.level_action_counts[level] >= level_budget:
                raise ValueError(f"ARC level {level} action budget exhausted")
            action = parse_action_payload(
                payload,
                before["agent_available_actions"],
                self.game_action.from_name,
            )
            reasoning_text = payload.get("reasoning")
            reasoning = {"summary": reasoning_text} if isinstance(reasoning_text, str) and reasoning_text else {}
            raw = self.environment.step(action, data=action.action_data.model_dump(), reasoning=reasoning)
            self.actions += 1
            self.level_action_counts[level] += 1
            self.adapter.record_action(action.name)
            after = self._frame()
            self._append({
                "event": "action", "index": self.actions, "action": action.name,
                "coordinates": action.action_data.model_dump(), "state_before": before["state"], "frame": after,
            })
            after_level = int(after["levels_completed"])
            while len(self.level_action_counts) <= after_level:
                self.level_action_counts.append(0)
            after_level_budget = (
                math.ceil(self.baseline_actions[after_level] * self.action_budget_multiplier)
                if after_level < len(self.baseline_actions) else self.max_actions
            )
            after["action_budget"] = {
                "used": self.level_action_counts[after_level],
                "maximum": after_level_budget,
                "total_used": self.actions,
                "total_maximum": self.max_actions,
                "level": after_level,
            }
            return after

    def close(self) -> dict[str, Any]:
        with self._lock:
            if not self.closed:
                native = self.arcade.close_scorecard(self.card_id)
                self.scorecard = native.model_dump(mode="json") if native is not None else None
                self.closed = True
                (self.root / "arc-scorecard.json").write_text(
                    json.dumps(self.scorecard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                frame = self._frame()
                result = {
                    "terminal_state": frame["state"], "levels_completed": frame["levels_completed"],
                    "actions": self.actions, "forced_actions": self.forced_actions,
                    "scorecard_id": self.card_id, "baseline_actions": self.baseline_actions,
                    "action_budget_multiplier": self.action_budget_multiplier,
                    "action_budget": self.max_actions,
                }
                (self.root / "bridge-result.json").write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                self._append({"event": "scorecard_closed", **result})
            return json.loads((self.root / "bridge-result.json").read_text(encoding="utf-8"))


def _make_handler(bridge: ArcBridge):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/state":
                self._json(404, {"error": "not found"})
                return
            try:
                self._json(200, bridge.state())
            except Exception as exc:
                self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

        def do_POST(self) -> None:  # noqa: N802
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/action":
                    self._json(200, bridge.step(payload))
                elif self.path == "/close":
                    self._json(200, bridge.close())
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                else:
                    self._json(404, {"error": "not found"})
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:
                self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--game", required=True)
    parser.add_argument("--max-actions", type=int, default=None)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    bridge: ArcBridge | None = None
    server: ThreadingHTTPServer | None = None
    try:
        bridge = ArcBridge(root, args.game, args.max_actions)
        server = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(bridge))
        port = server.server_address[1]
        ready = {"status": "ready", "host": "127.0.0.1", "port": port, "game": args.game, "pid": os.getpid()}
        (root / "bridge-ready.json").write_text(json.dumps(ready, indent=2) + "\n", encoding="utf-8")
        server.serve_forever()
        return 0
    except Exception as exc:
        (root / "bridge-error.json").write_text(
            json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return 1
    finally:
        if server is not None:
            server.server_close()
        if bridge is not None and not bridge.closed:
            try:
                bridge.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
