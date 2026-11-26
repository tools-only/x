"""Bounded coding runtime for one ALE-Bench problem."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from .ale_bench_bridge import AleBenchBridge, write_artifact


def run_ale_bench_e2e(root: Path, *, problem_id: str, code: str,
                      code_language: str = "cpp23", lite_version: bool = True,
                      public_rounds: int = 1, private_eval: bool = True,
                      bridge_factory: Callable[..., AleBenchBridge] | None = None) -> Path:
    if public_rounds < 0:
        raise ValueError("public_rounds must be non-negative")
    bridge = (bridge_factory or AleBenchBridge.start)(problem_id, lite_version=lite_version)
    public_results = []
    try:
        for _ in range(public_rounds):
            public_results.append(bridge.public_eval(code, code_language))
        private_result = bridge.private_eval(code, code_language) if private_eval else None
        return write_artifact(root / "ale_bench.json", problem_id=problem_id,
                              lite_version=lite_version, public_results=public_results,
                              private_result=private_result)
    finally:
        bridge.close()
