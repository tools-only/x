"""Thin task-facing client for a Pi-native agent session."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class RunResult:
    answer: str
    steps: int


class PiTaskAgent:
    def __init__(self, *, kernel: Any, max_steps: int = 32):
        self.kernel = kernel
        self.max_steps = max_steps

    def run(self, task: str) -> RunResult:
        """Submit one task; Pi's native loop handles all continuation."""
        self.kernel.prompt(task)
        events = self.kernel.wait_for_agent_events() if hasattr(self.kernel, "wait_for_agent_events") else self.kernel.drain_events()
        answer = ""
        for event in events:
            if event.get("type") in {"agent_end", "final_answer"}:
                answer = event.get("text") or event.get("content") or event.get("answer") or ""
        return RunResult(answer=answer, steps=1)
