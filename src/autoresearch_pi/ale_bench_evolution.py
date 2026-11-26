"""Agent-owned ALE-Bench coding loop.

The evaluator supplies facts and the agent callback chooses the next source. The
runtime owns attempt lineage, best-source selection and the terminal private
evaluation. It never receives or persists private test data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .ale_bench_bridge import AleBenchBridge, write_artifact


@dataclass(frozen=True)
class Attempt:
    attempt_id: str
    parent_id: str | None
    source: str
    public: dict


AgentStep = Callable[[str, dict, tuple[Attempt, ...]], str | None]


def _score(result: dict) -> float:
    value = result.get("overall_absolute_score")
    return float(value) if isinstance(value, (int, float)) else float("-inf")


def run_evolution(
    root: Path,
    *,
    problem_id: str,
    initial_code: str,
    agent_step: AgentStep,
    code_language: str = "cpp23",
    lite_version: bool = True,
    max_iterations: int = 5,
    bridge_factory: Callable[..., AleBenchBridge] | None = None,
) -> Path:
    if max_iterations < 0:
        raise ValueError("max_iterations must be non-negative")
    bridge = (bridge_factory or AleBenchBridge.start)(problem_id, lite_version=lite_version)
    attempts: list[Attempt] = []
    public_results: list[dict] = []
    try:
        source = initial_code
        first = bridge.public_eval(source, code_language)
        current = Attempt("a0", None, source, first)
        attempts.append(current)
        public_results.append({"attempt_id": current.attempt_id, **first})
        for index in range(1, max_iterations + 1):
            candidate = agent_step(source, first, tuple(attempts))
            if not candidate or candidate == source:
                break
            result = bridge.public_eval(candidate, code_language)
            attempt = Attempt(f"a{index}", current.attempt_id, candidate, result)
            attempts.append(attempt)
            public_results.append({"attempt_id": attempt.attempt_id, "parent_id": attempt.parent_id, **result})
            if _score(result) >= _score(current.public):
                current = attempt
                source, first = candidate, result
        private_result = bridge.private_eval(current.source, code_language)
        artifact = write_artifact(root / "ale_bench.json", problem_id=problem_id,
                                  lite_version=lite_version, public_results=public_results,
                                  private_result=private_result)
        (root / "attempts.json").write_text(json.dumps({
            "best_attempt_id": current.attempt_id,
            "attempts": [{"attempt_id": item.attempt_id, "parent_id": item.parent_id,
                           "public": item.public} for item in attempts],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        return artifact
    finally:
        bridge.close()
