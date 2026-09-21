"""Local process broker for Pi children.

The desktop runtime may deny nested ``CreateProcess`` calls from the Pi Node
process (Windows reports ``spawn EPERM``).  ARC's Python runner is already the
process that starts the Pi parent and can create children, so it exposes this
short-lived loopback-only broker.  It transports child stdout/stderr as
NDJSON and does not make research or scheduling decisions.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


_PROGRESS_KEYS = (
    "cursor", "status", "draft_findings", "supported_findings", "unresolved_questions", "next_step",
    "evidence_refs", "selected_resource_refs", "wait_for", "resume_condition",
)


def _semantic_checkpoint_fingerprint(path: Path | None) -> str:
    if path is None or not path.exists():
        return "{}"
    try:
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return "{}"
    if not isinstance(checkpoint, dict):
        return "{}"
    if (checkpoint.get("pause_reason") == "provider_stop_reason_length"
            and checkpoint.get("cursor") == "provider-output-length"
            and not checkpoint.get("draft_findings") and not checkpoint.get("evidence_refs")):
        return "{}"
    semantic = {key: checkpoint[key] for key in _PROGRESS_KEYS if key in checkpoint}
    return json.dumps(semantic, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class _BrokerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, broker: "SubagentBroker") -> None:
        super().__init__(("127.0.0.1", 0), _BrokerHandler)
        self.broker = broker


class _BrokerHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        value = json.loads(self.rfile.read(length) if length else b"{}")
        if not isinstance(value, dict):
            raise ValueError("broker payload must be an object")
        return value

    def _json_response(self, status: int, value: dict[str, Any]) -> None:
        body = (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self._read_json()
            if self.path == "/spawn":
                self._stream_spawn(payload)
            elif self.path == "/enqueue":
                self._json_response(202, self.server.broker.enqueue(payload))  # type: ignore[attr-defined]
            elif self.path == "/inspect":
                self._json_response(200, self.server.broker.inspect(str(payload.get("job_id", ""))))  # type: ignore[attr-defined]
            elif self.path == "/cancel":
                self._json_response(200, self.server.broker.cancel(str(payload.get("job_id", ""))))  # type: ignore[attr-defined]
            else:
                self._json_response(404, {"error": "unknown broker endpoint"})
        except BrokenPipeError:
            return
        except Exception as exc:  # pragma: no cover - exercised through integration
            try:
                self._json_response(400, {"error": f"{type(exc).__name__}: {exc}"})
            except OSError:
                return

    def _stream_spawn(self, payload: dict[str, Any]) -> None:
        command = payload.get("command")
        cwd = payload.get("cwd")
        environment = payload.get("env")
        job_id = str(payload.get("job_id", ""))
        if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
            raise ValueError("command must be a non-empty string array")
        if not isinstance(cwd, str) or not cwd:
            raise ValueError("cwd must be a non-empty string")
        if not isinstance(environment, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in environment.items()):
            raise ValueError("env must be a string map")
        child = self.server.broker.spawn(job_id, command, cwd, environment)  # type: ignore[attr-defined]
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        write_lock = threading.Lock()
        disconnected = threading.Event()

        def emit(value: dict[str, Any]) -> None:
            line = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            try:
                with write_lock:
                    self.wfile.write(line)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                disconnected.set()
                if child.poll() is None:
                    child.terminate()

        emit({"event": "started", "pid": child.pid})

        def forward(stream: Any, name: str) -> None:
            try:
                while True:
                    chunk = stream.readline()
                    if not chunk:
                        break
                    data = chunk.decode("utf-8", errors="replace")
                    # Pi's JSON mode emits cumulative message snapshots for
                    # every token. They are not needed by runChildPi (which
                    # consumes tool events and message_end), and forwarding
                    # them verbatim can amplify a 16K-token response into
                    # hundreds of MB. Preserve all lifecycle/tool events and
                    # non-JSON diagnostics; coalesce only known streaming
                    # fragments at the transport boundary.
                    if name == "stdout":
                        try:
                            event = json.loads(data)
                        except (TypeError, ValueError):
                            event = None
                        if isinstance(event, dict) and event.get("type") in {
                            "message_update", "text_delta", "thinking_delta",
                        }:
                            continue
                    emit({"event": name, "data": data})
                    if disconnected.is_set():
                        break
            finally:
                stream.close()

        stdout_thread = threading.Thread(target=forward, args=(child.stdout, "stdout"), daemon=True)
        stderr_thread = threading.Thread(target=forward, args=(child.stderr, "stderr"), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        code = child.wait()
        stdout_thread.join()
        stderr_thread.join()
        self.server.broker.finish(job_id)
        if not disconnected.is_set():
            emit({"event": "exit", "code": code})


class SubagentBroker:
    """Loopback-only broker owned by an ARC runner invocation."""

    def __init__(self) -> None:
        self._server: _BrokerServer | None = None
        self._thread: threading.Thread | None = None
        self._jobs: dict[str, subprocess.Popen[bytes]] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()
        self._status_lock = threading.Lock()

    @property
    def url(self) -> str:
        if self._server is None:
            raise RuntimeError("subagent broker is not started")
        return f"http://127.0.0.1:{self._server.server_port}"

    def start(self) -> None:
        if self._server is not None:
            return
        self._server = _BrokerServer(self)
        self._thread = threading.Thread(target=self._server.serve_forever, name="arc-subagent-broker", daemon=True)
        self._thread.start()

    def spawn(self, job_id: str, command: list[str], cwd: str, environment: dict[str, str]) -> subprocess.Popen[bytes]:
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with self._lock:
            self._jobs[job_id] = child
        return child

    def finish(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def _write_status(self, path: Path, value: dict[str, Any]) -> None:
        with self._status_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")
            for attempt in range(20):
                try:
                    temporary.replace(path)
                    return
                except PermissionError:
                    if attempt == 19:
                        raise
                    # Windows can briefly deny os.replace while an inspector
                    # has the old status file open. Keep the update atomic and
                    # retry the same already-written temporary file.
                    time.sleep(0.01)

    def enqueue(self, payload: dict[str, Any]) -> dict[str, Any]:
        command = payload.get("command")
        cwd = payload.get("cwd")
        environment = payload.get("env")
        job_id = str(payload.get("job_id", ""))
        status_path = Path(str(payload.get("status_path", ""))).resolve()
        events_path = Path(str(payload.get("events_path", ""))).resolve()
        checkpoint_path = (Path(str(payload["checkpoint_path"])).resolve()
                           if str(payload.get("checkpoint_path", "")) else None)
        max_stagnant = max(1, int(payload.get("max_stagnant_continuations", 3)))
        if not job_id:
            raise ValueError("job_id is required")
        if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
            raise ValueError("command must be a non-empty string array")
        if not isinstance(cwd, str) or not cwd:
            raise ValueError("cwd must be a non-empty string")
        if not isinstance(environment, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in environment.items()):
            raise ValueError("env must be a string map")
        if not str(payload.get("status_path", "")) or not str(payload.get("events_path", "")):
            raise ValueError("status_path and events_path are required")
        with self._lock:
            existing = self._jobs.get(job_id)
        if existing is not None and existing.poll() is None:
            raise ValueError(f"job is already active: {job_id}")
        child = self.spawn(job_id, command, cwd, environment)
        active = {"format": "subagent-broker-job-v1", "job_id": job_id, "status": "active", "pid": child.pid,
                  "continuation_attempts": 1}
        self._write_status(status_path, active)
        events_lock = threading.Lock()

        def capture(stream: Any, name: str, lifecycle: dict[str, Any]) -> None:
            events_path.parent.mkdir(parents=True, exist_ok=True)
            while True:
                chunk = stream.readline()
                if not chunk:
                    break
                data = chunk.decode("utf-8", errors="replace")
                if name == "stdout":
                    try:
                        event = json.loads(data)
                    except (TypeError, ValueError):
                        event = None
                    if isinstance(event, dict) and event.get("type") in {"message_update", "text_delta", "thinking_delta"}:
                        continue
                    if isinstance(event, dict) and event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant":
                        lifecycle["stop_reason"] = event.get("message", {}).get("stopReason")
                with events_lock, events_path.open("a", encoding="utf-8") as target:
                    target.write(json.dumps({"event": name, "data": data}, ensure_ascii=False) + "\n")
            stream.close()

        def wait_for_child() -> None:
            current = child
            attempt = 1
            stagnant_continuations = 0
            previous_progress = "{}"
            while True:
                lifecycle: dict[str, Any] = {"stop_reason": None}
                stdout_thread = threading.Thread(target=capture, args=(current.stdout, "stdout", lifecycle), daemon=True)
                stderr_thread = threading.Thread(target=capture, args=(current.stderr, "stderr", lifecycle), daemon=True)
                stdout_thread.start()
                stderr_thread.start()
                code = current.wait()
                stdout_thread.join()
                stderr_thread.join()
                with self._lock:
                    cancelled = job_id in self._cancelled
                if cancelled:
                    self._write_status(status_path, {**active, "status": "cancelled", "exit_code": code,
                                                      "continuation_attempts": attempt})
                    self.finish(job_id)
                    with self._lock:
                        self._cancelled.discard(job_id)
                    return
                if code == 0 and payload.get("continue_on_length") is True and lifecycle["stop_reason"] == "length":
                    progress = _semantic_checkpoint_fingerprint(checkpoint_path)
                    if progress != "{}" and progress != previous_progress:
                        stagnant_continuations = 0
                    else:
                        stagnant_continuations += 1
                    previous_progress = progress
                    if stagnant_continuations >= max_stagnant:
                        self._write_status(status_path, {**active, "pid": current.pid, "status": "stalled",
                                                          "exit_code": code, "continuation_attempts": attempt,
                                                          "last_stop_reason": "length",
                                                          "stagnant_continuations": stagnant_continuations})
                        self.finish(job_id)
                        return
                    attempt += 1
                    current = self.spawn(job_id, command, cwd, environment)
                    self._write_status(status_path, {**active, "pid": current.pid, "status": "active",
                                                      "continuation_attempts": attempt, "last_stop_reason": "length",
                                                      "stagnant_continuations": stagnant_continuations})
                    continue
                provider_failed = lifecycle["stop_reason"] == "error"
                self._write_status(status_path, {**active, "pid": current.pid,
                                                  "status": "completed" if code == 0 and not provider_failed else "failed",
                                                  "exit_code": code, "continuation_attempts": attempt,
                                                  "last_stop_reason": lifecycle["stop_reason"],
                                                  "failure_kind": "provider_error" if provider_failed else None})
                self.finish(job_id)
                return

        threading.Thread(target=wait_for_child, name=f"subagent-job-{job_id}", daemon=True).start()
        return active

    def inspect(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            child = self._jobs.get(job_id)
        if child is None:
            return {"job_id": job_id, "status": "unknown"}
        code = child.poll()
        return {"job_id": job_id, "status": "active",
                "pid": child.pid, "exit_code": code}

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            child = self._jobs.get(job_id)
            if child is not None:
                self._cancelled.add(job_id)
        if child is None:
            return {"job_id": job_id, "status": "unknown", "cancelled": False}
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        return {"job_id": job_id, "status": "cancelled", "cancelled": True, "exit_code": child.returncode}

    def close(self) -> None:
        with self._lock:
            children = list(self._jobs.values())
        for child in children:
            if child.poll() is None:
                child.terminate()
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None
