from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        temporary = Path(handle.name)
    os.replace(temporary, path)


def append_jsonl(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


class EventLog:
    def __init__(self, path: Path):
        self.path = path
        self.sequence = self._last_sequence()

    def _last_sequence(self) -> int:
        if not self.path.is_file():
            return 0
        last = 0
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line:
                continue
            try:
                value = json.loads(line).get("seq", 0)
                if isinstance(value, int):
                    last = max(last, value)
            except json.JSONDecodeError:
                continue
        return last

    def append(self, event_type: str, **fields: object) -> dict:
        self.sequence += 1
        event = {"seq": self.sequence, "at": utc_now(), "type": event_type, **fields}
        append_jsonl(self.path, event)
        return event
