from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any
from .prompts import BASE_ORCHESTRATOR_POLICY


class JsonStore:
    def __init__(self, path: Path, default: Any):
        self.path = path
        self.default = default
        self.lock = Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            self.write(default)

    def read(self) -> Any:
        with self.lock:
            return json.loads(self.path.read_text(encoding="utf-8"))

    def write(self, value: Any) -> None:
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        with self.lock:
            temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.path)


class EvolutionStores:
    def __init__(self, root: Path):
        self.root = root
        self.prompt = JsonStore(root / "prompt.json", {"content": BASE_ORCHESTRATOR_POLICY})
        prompt = self.prompt.read()
        if isinstance(prompt, str):
            self.prompt.write({"content": prompt or BASE_ORCHESTRATOR_POLICY})
        elif not isinstance(prompt, dict) or not prompt.get("content"):
            self.prompt.write({"content": BASE_ORCHESTRATOR_POLICY})
        self.skills = JsonStore(root / "skills.json", [])
        self.subagents = JsonStore(root / "subagents.json", [])
        self.memory = JsonStore(root / "memory.json", [])
        self.trajectory = JsonStore(root / "trajectory.jsonl", [])
        self.generations = JsonStore(root / "generations.jsonl", [])

    def snapshot(self) -> dict[str, Any]:
        return {"prompt": self.prompt.read(), "skills": self.skills.read(), "subagents": self.subagents.read(), "memory": self.memory.read()}
