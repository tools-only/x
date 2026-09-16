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
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from .arc_agi_3_adapter import ArcAgi3Adapter, DEFAULT_ACTION_BUDGET_MULTIPLIER


ARC_ACTION_BUDGET_MULTIPLIER = DEFAULT_ACTION_BUDGET_MULTIPLIER


def exception_details(error: BaseException) -> dict[str, Any]:
    """Return transport-safe diagnostics for an SDK/environment exception.

    ARC SDK failures are often surfaced by the underlying HTTP client as the
    unhelpful ``fetch failed`` message.  Preserve the concrete exception
    class, errno/syscall and chained cause so the parent can distinguish an
    environment failure from a malformed action or provider failure.  This
    is diagnostics only; it never decides whether an action should be
    replayed.
    """
    details: dict[str, Any] = {
        "type": type(error).__name__,
        "message": str(error),
        "repr": repr(error),
        "traceback": "".join(traceback.format_exception(type(error), error, error.__traceback__)),
    }
    for name in ("code", "errno", "strerror", "filename", "filename2", "winerror", "status"):
        value = getattr(error, name, None)
        if value is not None:
            details[name] = value
    cause = error.__cause__ or error.__context__
    if cause is not None and cause is not error:
        details["cause"] = exception_details(cause)
    return details


class ArcEnvironmentError(RuntimeError):
    """An ARC SDK environment call failed after action validation."""

    def __init__(self, operation: str, details: dict[str, Any]):
        self.operation = operation
        self.details = details
        super().__init__(f"ARC environment {operation} failed: {details.get('type')}: {details.get('message')}")


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


def frame_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Summarize the deterministic visual delta without interpreting its cause."""
    before_frames = before.get("frames") or []
    after_frames = after.get("frames") or []
    previous = before_frames[-1] if before_frames else []
    current = after_frames[-1] if after_frames else []
    changed: list[tuple[int, int]] = []
    for row, (old_row, new_row) in enumerate(zip(previous, current)):
        for col, (old, new) in enumerate(zip(old_row, new_row)):
            if old != new:
                changed.append((row, col))
    result: dict[str, Any] = {
        "changed_cells": len(changed),
        "frame_available": bool(previous and current),
    }
    if changed:
        rows, cols = zip(*changed)
        result["bbox"] = {
            "top": min(rows), "left": min(cols),
            "bottom": max(rows), "right": max(cols),
        }
        # Preserve exact local evidence so the agent can update its working
        # frame without fetching another full observation. The canonical full
        # frame is retained in the bridge event log as the transport fallback.
        result["cells"] = [
            {"row": row, "col": col, "value": after_frames[-1][row][col]}
            for row, col in changed
        ]
        result["cells_truncated"] = False
    return result


def project_trajectory(
    events: list[dict[str, Any]], *, projection: str = "transitions", last_n: int | None = None,
) -> dict[str, Any]:
    """Return a bounded factual view over canonical ARC action events.

    The projection deliberately contains no interpretation or recommended next
    action.  The agent may cite the returned canonical action IDs in a later
    research observation, while ``bridge-events.jsonl`` remains authoritative.
    """
    if projection not in {"transitions", "repeated_actions", "level_boundaries"}:
        raise ValueError("projection must be transitions, repeated_actions, or level_boundaries")
    if last_n is not None and last_n < 1:
        raise ValueError("last_n must be >= 1")

    transitions: list[dict[str, Any]] = []
    previous_level = 0
    for event in events:
        if event.get("event") != "action":
            continue
        frame = event.get("frame") if isinstance(event.get("frame"), dict) else {}
        delta = event.get("observation_delta") if isinstance(event.get("observation_delta"), dict) else {}
        index = int(event.get("index", len(transitions) + 1))
        level_after = int(frame.get("levels_completed", previous_level) or 0)
        level_before = int(event.get("level_before", previous_level) or 0)
        transition = {
            "action_id": f"arc-action-{index}",
            "action": str(event.get("action") or "UNKNOWN"),
            "coordinates": event.get("coordinates"),
            "state_before": str(event.get("state_before") or "UNKNOWN"),
            "state_after": str(frame.get("state") or "UNKNOWN"),
            "level_before": level_before,
            "level_after": level_after,
            "level_changed": level_after != level_before,
            "changed_cells": int(delta.get("changed_cells", 0) or 0),
            "bbox": delta.get("bbox"),
        }
        transitions.append(transition)
        previous_level = level_after

    latest_level_change = next(
        (index for index in range(len(transitions) - 1, -1, -1) if transitions[index]["level_changed"]),
        None,
    )
    actions_since_level_change = (
        len(transitions) if latest_level_change is None else len(transitions) - latest_level_change - 1
    )
    selected = transitions if last_n is None else transitions[-last_n:]
    if projection == "level_boundaries":
        items: list[dict[str, Any]] = [item for item in selected if item["level_changed"]]
    elif projection == "repeated_actions":
        groups: list[dict[str, Any]] = []
        for item in selected:
            key = (
                item["action"], item["level_before"], item["level_after"], item["state_after"],
                item["changed_cells"], json.dumps(item["bbox"], sort_keys=True),
            )
            previous = groups[-1] if groups else None
            if previous and previous.get("_key") == key:
                previous["end_action_id"] = item["action_id"]
                previous["count"] += 1
                continue
            groups.append({
                "_key": key,
                "start_action_id": item["action_id"],
                "end_action_id": item["action_id"],
                "action": item["action"],
                "count": 1,
                "level": item["level_before"],
                "level_after": item["level_after"],
                "state_after": item["state_after"],
                "changed_cells": item["changed_cells"],
                "bbox": item["bbox"],
            })
        for group in groups:
            group.pop("_key", None)
        items = groups
    else:
        items = selected

    return {
        "projection": projection,
        "summary": {
            "actions_available": len(transitions),
            "actions_considered": len(selected),
            "items_returned": len(items),
            "current_level": transitions[-1]["level_after"] if transitions else 0,
            "latest_action_id": transitions[-1]["action_id"] if transitions else None,
            "actions_since_level_change": actions_since_level_change,
        },
        "items": items,
        "canonical_source": "bridge-events.jsonl",
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
        self._close_result: dict[str, Any] | None = None
        self._lock = threading.Lock()
        self._events: list[dict[str, Any]] = []
        self._events_lock = threading.Lock()
        self._disk_events_available = True
        self._append({
            "event": "scorecard_opened", "game": game, "scorecard_id": self.card_id,
            "baseline_actions": baseline_actions,
            "action_budget_multiplier": self.action_budget_multiplier,
            "action_budget": self.max_actions,
        })
        self._normalize_initial_state()

    def _append(self, event: dict[str, Any]) -> None:
        # The bridge may run under the ARC SDK interpreter, whose sandbox
        # identity is not guaranteed to have workspace write access. Keep the
        # canonical event stream in memory and let the parent pull it over
        # HTTP; persist opportunistically when the filesystem is available.
        with self._events_lock:
            self._events.append(event)
        if not self._disk_events_available:
            return
        try:
            with (self.root / "bridge-events.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
                stream.flush()
        except OSError:
            self._disk_events_available = False

    def events(self, *, after: int = 0) -> dict[str, Any]:
        """Return canonical bridge events for parent-side durable projection."""
        if after < 0:
            raise ValueError("after must be >= 0")
        with self._events_lock:
            start = min(after, len(self._events))
            return {"events": self._events[start:], "next": len(self._events)}

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
        action_data = action.action_data.model_dump()
        self._append({
            "event": "environment_call_started", "operation": "step",
            "attempted_index": self.actions + 1, "action": action.name,
            "coordinates": action_data, "level_before": 0,
            "state_before": frame["state"], "reason": "initial_not_played",
        })
        try:
            raw = self.environment.step(action, data=action_data, reasoning={})
        except Exception as exc:
            details = exception_details(exc)
            self._append({
                "event": "environment_error", "operation": "step",
                "attempted_index": self.actions + 1, "action": action.name,
                "coordinates": action_data, "level_before": 0,
                "state_before": frame["state"], "reason": "initial_not_played",
                "retryable": False, "error": details,
            })
            raise ArcEnvironmentError("step", details) from exc
        if raw is None:
            details = {
                "type": "EnvironmentReturnedNoFrame",
                "message": "ARC SDK environment.step returned None; the remote wrapper may have swallowed a request failure",
                "repr": "None",
                "traceback": "",
            }
            self._append({
                "event": "environment_error", "operation": "step",
                "attempted_index": self.actions + 1, "action": action.name,
                "coordinates": action_data, "level_before": 0,
                "state_before": frame["state"], "reason": "initial_not_played",
                "retryable": False, "error": details,
            })
            raise ArcEnvironmentError("step", details)
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

    def trajectory(self, *, projection: str, last_n: int) -> dict[str, Any]:
        with self._lock:
            with self._events_lock:
                events = list(self._events)
            return project_trajectory(events, projection=projection, last_n=last_n)

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
            action_data = action.action_data.model_dump()
            # Record the boundary before entering the SDK.  If its network
            # fetch hangs or the client drops the response, /events remains
            # readable and proves exactly which validated action was in flight.
            self._append({
                "event": "environment_call_started", "operation": "step",
                "attempted_index": self.actions + 1, "action": action.name,
                "coordinates": action_data, "level_before": level,
                "state_before": before["state"],
            })
            try:
                raw = self.environment.step(action, data=action_data, reasoning=reasoning)
            except Exception as exc:
                details = exception_details(exc)
                self._append({
                    "event": "environment_error", "operation": "step",
                    "attempted_index": self.actions + 1, "action": action.name,
                    "coordinates": action_data, "level_before": level,
                    "state_before": before["state"], "retryable": False,
                    "error": details,
                })
                raise ArcEnvironmentError("step", details) from exc
            if raw is None:
                # The official RemoteEnvironmentWrapper currently catches
                # requests exceptions and returns None.  That means action
                # acceptance is unknown: never count or replay it as success.
                details = {
                    "type": "EnvironmentReturnedNoFrame",
                    "message": "ARC SDK environment.step returned None; the remote wrapper may have swallowed a request failure",
                    "repr": "None",
                    "traceback": "",
                }
                self._append({
                    "event": "environment_error", "operation": "step",
                    "attempted_index": self.actions + 1, "action": action.name,
                    "coordinates": action_data, "level_before": level,
                    "state_before": before["state"], "retryable": False,
                    "error": details,
                })
                raise ArcEnvironmentError("step", details)
            self.actions += 1
            self.level_action_counts[level] += 1
            self.adapter.record_action(action.name)
            after = self._frame()
            after["observation_delta"] = frame_delta(before, after)
            after_level = int(after["levels_completed"])
            after["public_transition"] = {
                "level_before": level,
                "level_after": after_level,
                "level_changed": after_level != level,
            }
            self._append({
                "event": "action", "index": self.actions, "action": action.name,
                "coordinates": action.action_data.model_dump(), "state_before": before["state"],
                "level_before": level,
                "observation_delta": after["observation_delta"], "frame": after,
            })
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
                try:
                    (self.root / "arc-scorecard.json").write_text(
                        json.dumps(self.scorecard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                except OSError:
                    pass
                frame = self._frame()
                result = {
                    "terminal_state": frame["state"], "levels_completed": frame["levels_completed"],
                    "actions": self.actions, "forced_actions": self.forced_actions,
                    "scorecard_id": self.card_id, "baseline_actions": self.baseline_actions,
                    "action_budget_multiplier": self.action_budget_multiplier,
                    "action_budget": self.max_actions,
                }
                self._append({"event": "scorecard_closed", **result})
                try:
                    (self.root / "bridge-result.json").write_text(
                        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                except OSError:
                    pass
                self._close_result = result
            response = dict(self._close_result or {})
            with self._events_lock:
                response["events"] = list(self._events)
            return response


def _make_handler(bridge: ArcBridge):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, status: int, error: Exception) -> None:
            if isinstance(error, ArcEnvironmentError):
                self._json(status, {
                    "format": "arc-bridge-error-v1",
                    "error": str(error),
                    "error_type": type(error).__name__,
                    "operation": f"environment.{error.operation}",
                    "retryable": False,
                    "details": error.details,
                })
                return
            self._json(status, {"error": f"{type(error).__name__}: {error}"})

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path not in {"/state", "/trajectory", "/events"}:
                self._json(404, {"error": "not found"})
                return
            try:
                if parsed.path == "/state":
                    self._json(200, bridge.state())
                    return
                if parsed.path == "/events":
                    query = parse_qs(parsed.query)
                    raw_after = (query.get("after") or ["0"])[0]
                    self._json(200, bridge.events(after=int(raw_after)))
                    return
                query = parse_qs(parsed.query)
                projection = (query.get("projection") or ["transitions"])[0]
                raw_last_n = (query.get("last_n") or [None])[0]
                last_n = int(raw_last_n) if raw_last_n is not None else None
                self._json(200, bridge.trajectory(projection=projection, last_n=last_n))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except ArcEnvironmentError as exc:
                self._error(502, exc)
            except Exception as exc:
                self._error(500, exc)

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
            except ArcEnvironmentError as exc:
                self._error(502, exc)
            except Exception as exc:
                self._error(500, exc)

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--game", required=True)
    parser.add_argument("--max-actions", type=int, default=None)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        # The parent creates the run root.  An ARC SDK child may be unable to
        # stat/mutate that directory under a restricted process identity, but
        # it can still serve the in-memory bridge protocol to its parent.
        pass
    bridge: ArcBridge | None = None
    server: ThreadingHTTPServer | None = None
    try:
        bridge = ArcBridge(root, args.game, args.max_actions)
        server = ThreadingHTTPServer(("127.0.0.1", args.port), _make_handler(bridge))
        port = server.server_address[1]
        ready = {"status": "ready", "host": "127.0.0.1", "port": port, "game": args.game, "pid": os.getpid()}
        try:
            (root / "bridge-ready.json").write_text(json.dumps(ready, indent=2) + "\n", encoding="utf-8")
        except OSError:
            # Parent-side readiness is transported by stdout/HTTP when the
            # SDK child cannot write into the workspace.
            pass
        print(json.dumps(ready, ensure_ascii=False), flush=True)
        server.serve_forever()
        return 0
    except Exception as exc:
        details = exception_details(exc)
        error_payload: dict[str, Any] = {
            "format": "arc-bridge-startup-error-v1",
            "error": f"{type(exc).__name__}: {exc}",
            "details": details,
        }
        if isinstance(exc, ArcEnvironmentError):
            error_payload.update({
                "operation": f"environment.{exc.operation}",
                "retryable": False,
                "environment_error": exc.details,
            })
        try:
            (root / "bridge-error.json").write_text(
                json.dumps(error_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError:
            print(json.dumps({"status": "error", **error_payload}, ensure_ascii=False), flush=True)
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
