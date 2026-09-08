"""Small JSONL-RPC client for the Pi Agent CLI."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from queue import Empty, Queue
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence


@dataclass
class RpcEvent:
    """One decoded line emitted by Pi."""

    payload: Dict[str, Any]


class PiKernel:
    """Bounded, line-oriented Pi process wrapper.

    The client deliberately treats Pi as an opaque child process: callers send
    command dictionaries and receive decoded event dictionaries, without any
    dependency on JIT internals.
    """

    def __init__(self, command: Sequence[str] = ("pi", "--mode", "rpc"), *, cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None, timeout: float = 120.0, event_sink: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.command = list(command)
        self.cwd = cwd
        self.env = env
        self.timeout = timeout
        self.event_sink = event_sink
        self.process: Optional[subprocess.Popen[str]] = None
        self.events: List[RpcEvent] = []
        self._lock = threading.Lock()
        self._next_id = 1
        self._queue: "Queue[Optional[str]]" = Queue()
        self._reader_thread: Optional[threading.Thread] = None
        self._event_cursor = 0

    def start(self) -> "PiKernel":
        if self.process is not None:
            return self
        merged_env = os.environ.copy()
        if self.env:
            merged_env.update(self.env)
        self.process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            env=merged_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()
        return self

    def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self._queue.put(line)
        self._queue.put(None)

    def send(self, command: str, **params: Any) -> Dict[str, Any]:
        self.start()
        assert self.process and self.process.stdin and self.process.stdout
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            payload = {"id": request_id, "type": command, **params}
            self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            while True:
                try:
                    line = self._queue.get(timeout=self.timeout)
                except Empty as exc:
                    raise TimeoutError(f"timed out waiting for Pi RPC response to {command!r}") from exc
                if line is None:
                    raise RuntimeError("Pi RPC process exited before responding")
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                self._record_event(event)
                if (
                    event.get("id") == request_id
                    or event.get("request_id") == request_id
                    or (event.get("type") == "response" and event.get("command") == command)
                ):
                    return event

    def drain_events(self) -> List[Dict[str, Any]]:
        """Return asynchronous Pi events observed since the previous drain."""
        with self._lock:
            payloads = [event.payload for event in self.events[self._event_cursor :]]
            self._event_cursor = len(self.events)
            return payloads

    def _record_event(self, event: Dict[str, Any]) -> None:
        self.events.append(RpcEvent(event))
        if self.event_sink is not None:
            self.event_sink(event)

    def _receive_event(self, timeout: float) -> Optional[Dict[str, Any]]:
        """Move one queued Pi JSONL message into the observable event log."""
        try:
            line = self._queue.get(timeout=max(0.0, timeout))
        except Empty:
            return None
        if line is None:
            raise RuntimeError("Pi RPC process exited while waiting for an event")
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            return {}
        if not isinstance(event, dict):
            return {}
        self._record_event(event)
        return event

    def wait_for_event(self, event_types: Iterable[str], *, timeout: Optional[float] = None) -> Dict[str, Any]:
        """Wait until one of ``event_types`` is observed on the RPC stream."""
        wanted = set(event_types)
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        while time.monotonic() < deadline:
            for event in self.drain_events():
                if event.get("type") in wanted:
                    return event
            event = self._receive_event(deadline - time.monotonic())
            if event and event.get("type") in wanted:
                self._event_cursor = len(self.events)
                return event
        raise TimeoutError(f"timed out waiting for Pi events {sorted(wanted)!r}")

    def wait_for_agent_events(self, *, timeout: Optional[float] = None) -> List[Dict[str, Any]]:
        """Collect one Pi turn, including tool calls, through agent_end/settled."""
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        collected = self.drain_events()
        if any(event.get("type") == "agent_settled" for event in collected):
            return collected
        while time.monotonic() < deadline:
            event = self._receive_event(deadline - time.monotonic())
            if not event:
                continue
            collected.append(event)
            self._event_cursor = len(self.events)
            if event.get("type") == "agent_settled":
                return collected
        raise TimeoutError("timed out waiting for Pi agent turn")

    def prompt_and_wait(self, message: str, *, timeout: Optional[float] = None, **params: Any) -> Dict[str, Any]:
        """Submit a prompt and wait for Pi's settled agent event."""
        self.prompt(message, **params)
        return self.wait_for_event(("agent_settled", "agent_end"), timeout=timeout)

    def prompt(self, message: str, **params: Any) -> Dict[str, Any]:
        return self.send("prompt", message=message, **params)

    def steer(self, message: str) -> Dict[str, Any]:
        """Queue a native steering message for the active agent turn."""
        return self.send("steer", message=message)

    def follow_up(self, message: str) -> Dict[str, Any]:
        """Queue a native follow-up message for the next turn."""
        return self.send("follow_up", message=message)

    def abort(self) -> None:
        if self.process and self.process.poll() is None:
            try:
                self.send("abort")
            except (RuntimeError, OSError):
                self.process.terminate()

    def close(self) -> None:
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream:
                stream.close()

    def __enter__(self) -> "PiKernel":
        return self.start()

    def __exit__(self, *_: Any) -> None:
        self.close()
