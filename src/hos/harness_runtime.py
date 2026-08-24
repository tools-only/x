"""Kernel-neutral runtime contract for Harness-defined feedback loops."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
import uuid

from .events import EventLog


@dataclass(frozen=True)
class HarnessSession:
    session_id: str
    harness: str
    scope: str = "task"


@dataclass(frozen=True)
class HarnessCheckpoint:
    checkpoint_id: str
    session_id: str
    harness: str
    boundary: str
    trigger: str
    evidence_ref: str | None = None


class HarnessRuntime(Protocol):
    """Runtime protocol implemented by task Harnesses, including baselines."""

    def open(self, harness: str, *, scope: str = "task", session_id: str | None = None) -> HarnessSession: ...

    def observe(self, session: HarnessSession, event: str, **payload: Any) -> dict[str, Any]: ...

    def checkpoint(
        self,
        session: HarnessSession,
        *,
        boundary: str,
        trigger: str,
        evidence_ref: str | None = None,
        **payload: Any,
    ) -> HarnessCheckpoint: ...

    def close(self, session: HarnessSession, *, status: str, **payload: Any) -> None: ...


class KernelHarnessRuntime:
    """Minimal event-backed implementation used by Harness adapters.

    It deliberately does not choose evolution triggers or mutate a Harness. The concrete
    Harness decides when to call ``checkpoint`` and supplies its own boundary semantics.
    """

    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.events = EventLog(self.root / "harness-events.jsonl")

    def open(self, harness: str, *, scope: str = "task", session_id: str | None = None) -> HarnessSession:
        if not isinstance(harness, str) or not harness:
            raise ValueError("harness reference is required")
        if scope not in {"task", "meta"}:
            raise ValueError("scope must be task or meta")
        session = HarnessSession(session_id or f"harness-session-{uuid.uuid4().hex[:16]}", harness, scope)
        self.events.append("harness.opened", session_id=session.session_id, harness=harness, scope=scope)
        return session

    def observe(self, session: HarnessSession, event: str, **payload: Any) -> dict[str, Any]:
        if not event:
            raise ValueError("event is required")
        return self.events.append(
            "harness.observed",
            session_id=session.session_id,
            harness=session.harness,
            scope=session.scope,
            event=event,
            payload=payload,
        )

    def checkpoint(
        self,
        session: HarnessSession,
        *,
        boundary: str,
        trigger: str,
        evidence_ref: str | None = None,
        **payload: Any,
    ) -> HarnessCheckpoint:
        if not boundary or not trigger:
            raise ValueError("checkpoint boundary and trigger are required")
        checkpoint_id = f"checkpoint-{uuid.uuid4().hex[:16]}"
        self.events.append(
            "harness.checkpoint",
            checkpoint_id=checkpoint_id,
            session_id=session.session_id,
            harness=session.harness,
            scope=session.scope,
            boundary=boundary,
            trigger=trigger,
            evidence_ref=evidence_ref,
            payload=payload,
        )
        return HarnessCheckpoint(checkpoint_id, session.session_id, session.harness, boundary, trigger, evidence_ref)

    def close(self, session: HarnessSession, *, status: str, **payload: Any) -> None:
        if not status:
            raise ValueError("status is required")
        self.events.append(
            "harness.closed",
            session_id=session.session_id,
            harness=session.harness,
            scope=session.scope,
            status=status,
            payload=payload,
        )
