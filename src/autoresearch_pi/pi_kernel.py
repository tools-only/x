"""Small JSONL-RPC client for the Pi Agent CLI."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence


@dataclass
class RpcEvent:
    """One decoded line emitted by Pi."""

    payload: Dict[str, Any]


@dataclass(frozen=True)
class AgentLoopWatchdog:
    """Bound a no-progress read loop inside one active Pi agent turn."""

    read_only_tools: frozenset[str]
    progress_tools: frozenset[str] = field(default_factory=frozenset)
    # Progress in the primary task is distinct from progress in an auxiliary
    # task-local harness.  The latter may be useful, but must not make an ARC
    # read loop look productive.
    task_progress_tools: frozenset[str] = field(default_factory=frozenset)
    auxiliary_progress_tools: frozenset[str] = field(default_factory=frozenset)
    max_read_only_calls_without_progress: int = 8
    max_interventions: int = 2
    abort_on_max_interventions: bool = True

    def __post_init__(self) -> None:
        if self.max_read_only_calls_without_progress < 1:
            raise ValueError("max_read_only_calls_without_progress must be positive")
        if self.max_interventions < 1:
            raise ValueError("max_interventions must be positive")


@dataclass
class AgentLoopWatchdogState:
    """Session state shared across Pi turns for cross-turn read loops."""

    stagnant_read_only_calls: int = 0
    observed_read_only_calls: int = 0
    interventions: int = 0
    recent_signatures: list[str] = field(default_factory=list)

    def reset_after_progress(self) -> None:
        self.stagnant_read_only_calls = 0
        self.recent_signatures.clear()


def _watchdog_signature(event: Dict[str, Any]) -> str:
    """Identify a read observation by operation, inputs, and evidence version."""
    tool_name = str(event.get("toolName") or "")
    inputs = event.get("args", event.get("input", event.get("params", {})))
    result = event.get("result")
    details = result.get("details") if isinstance(result, dict) else None
    evidence = dict(event.get("evidence")) if isinstance(event.get("evidence"), dict) else {}
    if isinstance(details, dict):
        for key in ("version", "revision", "state_version", "state", "progress", "levels_completed", "action_budget"):
            if key in details:
                evidence[key] = details[key]
    try:
        input_text = json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        evidence_text = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        input_text = repr(inputs)
        evidence_text = repr(evidence)
    return f"{tool_name}|input={input_text}|evidence={evidence_text}"


class PiKernel:
    """Bounded, line-oriented Pi process wrapper.

    The client deliberately treats Pi as an opaque child process: callers send
    command dictionaries and receive decoded event dictionaries, without any
    dependency on JIT internals.
    """

    def __init__(
        self,
        command: Sequence[str] = ("pi", "--mode", "rpc"),
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: float = 120.0,
        deadline: Optional[float] = None,
        event_sink: Optional[Callable[[Dict[str, Any]], None]] = None,
        event_projector: Optional[
            Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]
        ] = None,
    ):
        self.command = list(command)
        self.cwd = cwd
        self.env = env
        self.timeout = timeout
        # An optional monotonic deadline lets a caller bound a complete
        # session while retaining the ordinary per-operation timeout API.
        self.deadline = deadline
        self.event_sink = event_sink
        self.event_projector = event_projector
        self.process: Optional[subprocess.Popen[str]] = None
        self.events: List[RpcEvent] = []
        self._lock = threading.Lock()
        self._next_id = 1
        self._queue: "Queue[Optional[str]]" = Queue()
        self._reader_thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None
        self._stderr_lock = threading.Lock()
        self._stderr_tail = ""
        self._event_cursor = 0
        self._tool_call_args: Dict[str, Any] = {}

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
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()
        return self

    def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self._queue.put(line)
        self._queue.put(None)

    def _read_stderr(self) -> None:
        process = self.process
        if process is None or process.stderr is None:
            return
        while True:
            chunk = process.stderr.read(4096)
            if not chunk:
                return
            with self._stderr_lock:
                self._stderr_tail = (self._stderr_tail + chunk)[-65_536:]

    @property
    def stderr_tail(self) -> str:
        """Return a bounded diagnostic tail while stderr is drained continuously."""
        with self._stderr_lock:
            return self._stderr_tail

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
                wait_timeout = self._remaining_timeout(self.timeout)
                try:
                    line = self._queue.get(timeout=wait_timeout)
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

    def _record_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.event_sink is not None:
            self.event_sink(event)
        projection_input = event
        tool_call_id = event.get("toolCallId")
        if event.get("type") == "tool_execution_start" and tool_call_id:
            self._tool_call_args[str(tool_call_id)] = event.get("args", {})
        elif event.get("type") == "tool_execution_end" and tool_call_id:
            # Pi puts arguments on the start event, while the completion event
            # carries the evidence. Join them before projection so the generic
            # watchdog can distinguish A/B/A/B calls with different inputs.
            if "args" not in event and str(tool_call_id) in self._tool_call_args:
                projection_input = dict(event)
                projection_input["args"] = self._tool_call_args[str(tool_call_id)]
            self._tool_call_args.pop(str(tool_call_id), None)
        projected = self.event_projector(projection_input) if self.event_projector is not None else projection_input
        if projected is not None:
            self.events.append(RpcEvent(projected))
        return projected

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
        return self._record_event(event) or {}

    def _remaining_timeout(self, timeout: float) -> float:
        """Cap an operation timeout by the optional session deadline."""
        if self.deadline is None:
            return timeout
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Pi session deadline exceeded")
        return min(timeout, remaining)

    def wait_for_event(self, event_types: Iterable[str], *, timeout: Optional[float] = None) -> Dict[str, Any]:
        """Wait until one of ``event_types`` is observed on the RPC stream."""
        wanted = set(event_types)
        operation_timeout = self.timeout if timeout is None else timeout
        deadline = time.monotonic() + self._remaining_timeout(operation_timeout)
        if self.deadline is not None:
            deadline = min(deadline, self.deadline)
        while time.monotonic() < deadline:
            for event in self.drain_events():
                if event.get("type") in wanted:
                    return event
            event = self._receive_event(deadline - time.monotonic())
            if event and event.get("type") in wanted:
                self._event_cursor = len(self.events)
                return event
        raise TimeoutError(f"timed out waiting for Pi events {sorted(wanted)!r}")

    def wait_for_agent_events(
        self,
        *,
        timeout: Optional[float] = None,
        watchdog: Optional[AgentLoopWatchdog] = None,
        watchdog_state: Optional[AgentLoopWatchdogState] = None,
        stop_after_progress_tools: Optional[Iterable[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Collect one Pi turn, including tool calls, through agent_end/settled.

        ``stop_after_progress_tools`` is an explicit action-boundary mode for
        interactive environments.  Once one of these tools completes, abort
        the remainder of the model turn so a tool result cannot trigger an
        unbounded post-action read/planning loop.  The completed tool event is
        retained and the caller starts the next turn explicitly.
        """
        operation_timeout = self.timeout if timeout is None else timeout
        deadline = time.monotonic() + self._remaining_timeout(operation_timeout)
        if self.deadline is not None:
            deadline = min(deadline, self.deadline)
        collected = self.drain_events()
        if any(event.get("type") == "agent_settled" for event in collected):
            return collected
        state = watchdog_state or AgentLoopWatchdogState()
        stop_tools = frozenset(stop_after_progress_tools or ())
        read_only_calls = 0
        read_signatures: List[str] = []
        while time.monotonic() < deadline:
            event = self._receive_event(deadline - time.monotonic())
            if not event:
                continue
            collected.append(event)
            self._event_cursor = len(self.events)
            if (
                event.get("type") == "tool_execution_end"
                and str(event.get("toolName") or "") in stop_tools
            ):
                # The progress result is authoritative; terminate only the
                # model deliberation that follows it.  This boundary is
                # independent of the optional read-loop watchdog.
                evidence = event.get("evidence")
                native_boundary = (
                    isinstance(evidence, dict)
                    and evidence.get("arc_action_boundary") is True
                )
                # Current Pi supports ToolResult.terminate, which ends the
                # tool batch and emits agent_end without another provider
                # request.  Do not call abort in that case: abort races the
                # normal settlement and turns a successful action into an
                # artificial aborted assistant message.  Keep abort for old
                # adapters/Pi versions that have no native boundary marker.
                if not native_boundary:
                    self.abort()
                # Abort is asynchronous in Pi.  Do not let the caller issue
                # the next prompt while the old turn is still settling; that
                # race can make the first action-boundary turn look like a
                # runner failure even though the action succeeded.
                settle_deadline = min(deadline, time.monotonic() + 2.0)
                settled_events = self.drain_events()
                if any(event.get("type") in {"agent_settled", "agent_end"} for event in settled_events):
                    return collected
                while time.monotonic() < settle_deadline:
                    settled = self._receive_event(settle_deadline - time.monotonic())
                    if settled:
                        self._event_cursor = len(self.events)
                        if settled.get("type") in {"agent_settled", "agent_end"}:
                            collected.append(settled)
                            break
                return collected
            if watchdog and event.get("type") == "tool_execution_end":
                tool_name = str(event.get("toolName") or "")
                if tool_name in (watchdog.progress_tools | watchdog.task_progress_tools):
                    read_only_calls = 0
                    state.reset_after_progress()
                elif tool_name in watchdog.auxiliary_progress_tools:
                    # Harness progress is deliberately observable but does
                    # not reset the primary-task read-loop budget.
                    pass
                elif tool_name in watchdog.read_only_tools:
                    read_only_calls += 1
                    state.observed_read_only_calls += 1
                    signature = _watchdog_signature(event)
                    read_signatures.append(signature)
                    # New evidence is legitimate progress. Repeated
                    # signatures also catch alternating A/B read loops.
                    if signature in state.recent_signatures:
                        state.stagnant_read_only_calls += 1
                    else:
                        state.stagnant_read_only_calls = 0
                    state.recent_signatures.append(signature)
                    state.recent_signatures = state.recent_signatures[-8:]
                else:
                    # A tool outside the configured read-only surface may
                    # have changed task state; let the next configured read
                    # sequence establish whether it is actually stagnant.
                    read_only_calls = 0
                if (
                    state.stagnant_read_only_calls >= watchdog.max_read_only_calls_without_progress
                    and (
                        not watchdog.abort_on_max_interventions
                        or state.interventions < watchdog.max_interventions
                    )
                ):
                    state.interventions += 1
                    watchdog_event = {
                        "type": "agent_progress_watchdog",
                        "read_only_calls": state.stagnant_read_only_calls,
                        "observed_read_only_calls": state.observed_read_only_calls,
                        "intervention": (
                            "steer"
                            if not watchdog.abort_on_max_interventions
                            or state.interventions < watchdog.max_interventions
                            else "steer_then_abort"
                        ),
                        "intervention_number": state.interventions,
                        "read_only_tools": sorted(watchdog.read_only_tools),
                        "progress_tools": sorted(watchdog.progress_tools),
                        "recent_signatures": read_signatures[-8:],
                        "unique_signatures": len(set(state.recent_signatures)),
                    }
                    projected = self._record_event(watchdog_event)
                    if projected is not None:
                        collected.append(projected)
                    read_only_calls = 0
                    read_signatures = []
                    message = (
                        "Progress watchdog: the current agent turn has made "
                        f"{watchdog_event['read_only_calls']} read-only tool calls without a configured progress event. "
                        "Use the latest native context and evidence now. Choose one: submit a new task action, "
                        "create or revise a task-local capability that addresses the current uncertainty, or state why "
                        "waiting for external change is required. Do not call another read-only inspection until that "
                        "decision is made."
                    )
                    before_control_events = len(self.events)
                    self.steer(message)
                    state.stagnant_read_only_calls = 0
                    if (
                        watchdog.abort_on_max_interventions
                        and state.interventions >= watchdog.max_interventions
                    ):
                        self.abort()
                    for recorded in self.events[before_control_events:]:
                        collected.append(recorded.payload)
                    self._event_cursor = len(self.events)
            if event.get("type") == "agent_settled":
                return collected
            if any(item.get("type") == "agent_settled" for item in collected[-8:]):
                return collected
        raise TimeoutError("timed out waiting for Pi agent turn")

    def prompt_and_wait(self, message: str, *, timeout: Optional[float] = None, **params: Any) -> Dict[str, Any]:
        """Submit a prompt and wait for Pi's settled agent event."""
        self.prompt(message, **params)
        return self.wait_for_event(("agent_settled", "agent_end"), timeout=timeout)

    def prompt(self, message: str, **params: Any) -> Dict[str, Any]:
        return self.send("prompt", message=message, **params)

    def new_session(self, parent_session: Optional[str] = None) -> Dict[str, Any]:
        """Start a clean in-memory agent session without restarting the child.

        The external task/runtime remains untouched.  This is useful for
        recovering from a provider ``length`` stop: old model deliberation is
        discarded while the bridge and its durable checkpoint remain the
        source of truth.
        """
        params: Dict[str, Any] = {}
        if parent_session is not None:
            params["parentSession"] = parent_session
        return self.send("new_session", **params)

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
        for thread in (self._reader_thread, self._stderr_thread):
            if thread is not None:
                thread.join(timeout=1)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream:
                stream.close()
        # Session rotation is intentionally excluded: only the owning task
        # runtime closes this scope. Child Pi processes never own the parent.
        if (self.env or {}).get("PI_AUTORESEARCH_OWNS_TASK") == "enabled":
            from .task_scope import seal_task_scope

            task_root = (self.env or {}).get("PI_AUTORESEARCH_E2E_ROOT")
            if task_root:
                seal_task_scope(Path(task_root))

    def __enter__(self) -> "PiKernel":
        return self.start()

    def __exit__(self, *_: Any) -> None:
        self.close()
