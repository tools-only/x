"""In-process durable tracking and priority notifications.

Each mount owns a JSON state slot that is saved with the event cursor and pending
notification. Mounts may keep any content they own there; an existing session,
checkpoint, or component store remains the authority for its own original data.
The caller owns safe-turn dispatch and Agent decisions.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any


Rows = dict[str, list[dict[str, Any]]]
Monitor = Callable[[Rows, dict[str, Any], bool], list[str]]


class DaemonService:
    def __init__(self, root: Path):
        self.root = root
        self.path = root / "harness" / "daemon.json"
        if self.path.exists():
            self.state = json.loads(self.path.read_text(encoding="utf-8"))
            if self.state.get("format") != "daemon-v1":
                raise ValueError("unsupported daemon state")
        else:
            self.state = {
                "format": "daemon-v1", "offsets": {}, "monitors": {},
                "decision": 0, "handled_through": 0, "sequence": 0, "pending": None,
            }
            self._save()
        self.mounts: dict[str, tuple[tuple[str, ...], Monitor]] = {}

    def mount(self, name: str, sources: tuple[str, ...], update: Monitor) -> None:
        """Attach continuous tracking before refresh; its JSON state persists by name."""
        if name in self.mounts:
            raise ValueError(f"daemon monitor already mounted: {name}")
        self.mounts[name] = (sources, update)
        self.state["monitors"].setdefault(name, {})

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def _rows(self, relative: str) -> list[dict[str, Any]]:
        path = self.root / relative
        if not path.exists():
            return []
        offset = self.state["offsets"].get(relative, 0)
        if path.stat().st_size < offset:
            raise RuntimeError(f"daemon source was truncated: {relative}")
        rows = []
        with path.open("rb") as source:
            source.seek(offset)
            while line := source.readline():
                if not line.endswith(b"\n"):
                    break  # The writer has not committed this record yet.
                offset = source.tell()
                if line.strip():
                    rows.append(json.loads(line))
        self.state["offsets"][relative] = offset
        return rows

    def refresh(self) -> dict[str, Any] | None:
        """Consume committed events and publish ready notices for the next safe turn."""
        previous = json.dumps(self.state, sort_keys=True)
        sources = {"harness/working_set.jsonl", "harness/call_points.jsonl"}
        for paths, _ in self.mounts.values():
            sources.update(paths)
        rows = {source: self._rows(source) for source in sorted(sources)}
        for row in rows["harness/working_set.jsonl"]:
            self.state["decision"] = max(self.state["decision"], int(row.get("decision") or 0))
        acknowledged = False
        for row in rows["harness/call_points.jsonl"]:
            pending = self.state["pending"]
            if row.get("kind") == "daemon_reply" and pending and row.get("notification") == pending["id"]:
                self.state["last_response"] = {
                    "notification": pending["id"], "decision": row["decision"], "summary": row["summary"],
                }
                self.state["handled_through"] = row["decision"]
                self.state["pending"] = None
                acknowledged = True
        reasons = []
        for name, (_, update) in self.mounts.items():
            reasons.extend(update(rows, self.state["monitors"][name], acknowledged))
        if self.state["pending"]:
            for reason in reasons:
                if reason not in self.state["pending"]["reasons"]:
                    self.state["pending"]["reasons"].append(reason)
        elif reasons:
            self.state["sequence"] += 1
            self.state["pending"] = {
                "id": f"d{self.state['sequence']}", "from_decision": self.state["handled_through"],
                "through_decision": self.state["decision"], "reasons": reasons[:6],
            }
        if json.dumps(self.state, sort_keys=True) != previous:
            self._save()
        return self.state["pending"]
