"""Bridge, Pi and budget plumbing used by the layered ARC runner."""

from __future__ import annotations

import json
import os
import queue
import secrets
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PERSISTED_EVENTS = frozenset({
    "response", "turn_start", "turn_end", "agent_start", "agent_end", "agent_settled",
    "message_start", "message_end", "tool_execution_start", "tool_execution_end", "extension_error",
})


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _get_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _post_json(url: str, payload: dict[str, Any], timeout: float = 10.0,
               action_token: str | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json",
                                              **({"X-ARC-Action-Token": action_token} if action_token else {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read())
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {"error": str(exc)}
        raise RuntimeError(json.dumps({"format": "arc-bridge-http-error-v1", "url": url,
                                       "status": exc.code, "response": body,
                                       "retryable": bool(body.get("retryable", False)) if isinstance(body, dict) else False},
                                      ensure_ascii=False)) from exc
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _pi_cli_version(cli: Path) -> str | None:
    try:
        return str(json.loads((cli.parent.parent / "package.json").read_text(encoding="utf-8")).get("version"))
    except (OSError, ValueError, AttributeError):
        return None


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi runtime unsupported: node executable was not found")
    relative = Path("node_modules") / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    override = os.environ.get("PI_AUTORESEARCH_PI_CLI")
    candidates = [Path(override)] if override else []
    candidates.extend((PROJECT_ROOT / relative, Path(node).resolve().parent / relative))
    for cli in candidates:
        if cli.is_file():
            return node, str(cli)
    if override:
        raise RuntimeError(f"Pi runtime unsupported: PI_AUTORESEARCH_PI_CLI points to a missing file: {override}")
    raise RuntimeError(f"Pi runtime unsupported: no Pi CLI found at {' or '.join(str(c) for c in candidates)}")


def _start_bridge(root: Path, *, arc_root: Path, game: str, max_actions: int | None, env: dict[str, str],
                  bridge_python: Path | None, bridge_module_paths: tuple[Path, ...]
                  ) -> tuple[subprocess.Popen[str], Any, str, str]:
    arc_root = arc_root.resolve()
    arc_python = bridge_python or arc_root / ".venv" / "Scripts" / "python.exe"
    if not arc_python.is_file():
        raise FileNotFoundError(f"ARC SDK interpreter was not found: {arc_python}")
    bridge_env = dict(env)
    bridge_env["PYTHONPATH"] = os.pathsep.join(
        [str(Path(__file__).resolve().parent.parent), *(str(path.resolve()) for path in bridge_module_paths), env.get("PYTHONPATH", "")])
    launch_id, action_token = secrets.token_hex(16), secrets.token_urlsafe(32)
    command = [str(arc_python), "-m", "autoresearch_pi.arc_agi_3_bridge", "--root", str(root),
               "--game", game, "--port", "0"]
    if max_actions is not None:
        command.extend(("--max-actions", str(max_actions)))
    bridge_stderr = (root / "bridge-stderr.log").open("w", encoding="utf-8")
    try:
        bridge = subprocess.Popen(command, cwd=str(arc_root), text=True, stdout=subprocess.PIPE, stderr=bridge_stderr,
                                  env={**bridge_env, "ARC_BRIDGE_EVENT_WRITER": "parent",
                                       "ARC_BRIDGE_ACTION_TOKEN": action_token, "ARC_BRIDGE_LAUNCH_ID": launch_id})
    except OSError:
        bridge_stderr.close()
        raise
    return bridge, bridge_stderr, launch_id, action_token


def _wait_for_bridge(root: Path, process: subprocess.Popen[str], timeout: float = 60.0,
                     *, launch_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    ready_path = root / "bridge-ready.json"
    receipts: queue.Queue[dict[str, Any]] = queue.Queue()

    def valid(value: Any) -> bool:
        return (isinstance(value, dict) and value.get("status") == "ready" and value.get("host") == "127.0.0.1"
                and type(value.get("port")) is int and 0 < value["port"] < 65536
                and type(value.get("pid")) is int and value["pid"] > 0 and value.get("launch_id") == launch_id)

    def read_stdout() -> None:
        try:
            for line in process.stdout:
                try:
                    value = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if valid(value):
                    receipts.put(value)
                    return
        except (OSError, UnicodeError):
            return

    if process.stdout is not None:
        threading.Thread(target=read_stdout, daemon=True, name="arc-bridge-readiness").start()
    while time.monotonic() < deadline:
        if ready_path.is_file():
            try:
                value = json.loads(ready_path.read_text(encoding="utf-8"))
                if valid(value):
                    return value
            except (OSError, ValueError):
                pass
        try:
            return receipts.get_nowait()
        except queue.Empty:
            pass
        if process.poll() is not None:
            error_path = root / "bridge-error.json"
            detail = error_path.read_text(encoding="utf-8") if error_path.is_file() else ""
            raise RuntimeError(f"ARC bridge exited before ready: {detail}")
        time.sleep(0.1)
    (root / "bridge-startup-diagnostics.json").write_text(
        json.dumps({"returncode": process.poll(), "stderr_tail": "deferred until bridge termination"}, indent=2) + "\n",
        encoding="utf-8")
    raise TimeoutError("timed out waiting for ARC bridge readiness; see bridge-startup-diagnostics.json")


def _stop_bridge(bridge: subprocess.Popen[str], bridge_stderr: Any, closed: bool) -> None:
    if bridge.poll() is None:
        try:
            bridge.wait(timeout=30 if closed else 0.1)
        except subprocess.TimeoutExpired:
            bridge.terminate()
            try:
                bridge.wait(timeout=10)
            except subprocess.TimeoutExpired:
                bridge.kill()
    bridge_stderr.close()


def _arc_terminal_or_budget_exhausted(state: dict[str, Any]) -> bool:
    if str(state.get("state", "")) == "WIN":
        return True
    budget = state.get("action_budget")
    if not isinstance(budget, dict):
        return False
    return ((budget.get("maximum") is not None and int(budget.get("used") or 0) >= int(budget["maximum"]))
            or (budget.get("total_maximum") is not None
                and int(budget.get("total_used") or 0) >= int(budget["total_maximum"])))


def _append_events(root: Path, events: list[Any]) -> None:
    with (root / "bridge-events.jsonl").open("a", encoding="utf-8") as stream:
        for event in events:
            if isinstance(event, dict):
                stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


def _bridge_state(bridge_url: str, attempts: int = 3) -> dict[str, Any] | None:
    for attempt in range(attempts):
        try:
            return _get_json(bridge_url + "/state")
        except (OSError, ValueError):
            try:
                health = _get_json(bridge_url + "/health", timeout=2.0)
            except (OSError, ValueError):
                health = None
            if health and health.get("status") in {"uncertain", "busy"}:
                return None
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    return None


def _reported_tokens(harness: Path) -> int:
    total = 0
    for row in _read_jsonl(harness / "usage.jsonl"):
        reported = int(row.get("total") or 0)
        total += reported or int(row.get("input") or 0) + int(row.get("output") or 0)
    return total


def _budget_tokens(harness: Path) -> int:
    return sum(int(row.get("input") or 0) + int(row.get("output") or 0) for row in _read_jsonl(harness / "usage.jsonl"))


def _provider_admission_stop(harness: Path) -> dict[str, str] | None:
    try:
        ledger = harness / "provider-token-budget.jsonl"
        if ledger.exists():
            for line in ledger.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError("invalid budget row")
                if row.get("event") == "unmeasured_usage" or row.get("unmeasured") is True:
                    return {"stop_reason": "provider_usage_unknown", "error": "provider usage unknown; shared budget closed"}
        for name in ("provider-token-budget-stop.json", "provider-window-admission-stop.json",
                     "arc-parent-provider-admission-stop.json"):
            path = harness / name
            if path.exists():
                row = json.loads(path.read_text(encoding="utf-8"))
                reason = row.get("reason") or "shared budget stopped"
                return {"stop_reason": "token_cap" if reason == "reported_request_reserve_exceeded" else "provider_admission",
                        "error": f"provider request declined locally: {reason}"[:500]}
    except (OSError, ValueError, AttributeError):
        return {"stop_reason": "provider_usage_unknown", "error": "provider budget/admission evidence unreadable; refusing retry"}
    return None


def _write_models_json(agent_dir: Path, provider: str, model: str, settings: dict[str, Any]) -> None:
    compat: dict[str, Any] = {"supportsDeveloperRole": False}
    if settings.get("thinking_format"):
        compat["thinkingFormat"] = settings["thinking_format"]
    entry: dict[str, Any] = {"id": model, "name": model, "reasoning": True,
                             "input": list(settings["input_modalities"]), "contextWindow": settings["context_window"],
                             "cost": {"input": 5, "output": 30, "cacheRead": 0, "cacheWrite": 0}}
    if settings.get("max_tokens"):
        entry["maxTokens"] = settings["max_tokens"]
    (agent_dir / "models.json").write_text(json.dumps({"providers": {provider: {
        "baseUrl": settings["base_url"], "api": settings["pi_api"], "apiKey": "$OPENAI_API_KEY",
        "compat": compat, "authHeader": True, "models": [entry]}}}, indent=2) + "\n", encoding="utf-8")


def _request_accounting(rows: list[dict[str, Any]]) -> dict[str, Any]:
    starts = {row["request_id"]: row for row in rows if row.get("stage") == "request_prepared" and row.get("request_id")}
    ends = {row["request_id"]: row for row in rows if row.get("stage") == "request_settlement" and row.get("request_id")}
    by_kind: dict[str, Any] = {}
    known = unknown = 0
    for key, start in starts.items():
        end = ends.get(key, {})
        counts = by_kind.setdefault(start.get("kind", "unknown"), dict(attempts=0, completed=0, aborted=0, unsettled=0, failed=0))
        counts["attempts"] += 1
        status = end.get("status", "unsettled")
        counts[status if status in counts else "failed"] += 1
        value = end.get("total")
        if isinstance(value, (int, float)) and value >= 0:
            known += value
        if end.get("cost_status") != "reported":
            unknown += 1
    return dict(attempts=len(starts), by_kind=by_kind, known_tokens_lower_bound=known,
                unknown_cost_attempts=unknown, complete_cost_known=unknown == 0,
                cost_scope="provider-reported tokens, not verified billing")
