"""Thin, public/private-safe bridge to the upstream ALE-Bench session API."""

from __future__ import annotations

import importlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

LITE_PROBLEM_IDS = (
    "ahc008", "ahc011", "ahc015", "ahc016", "ahc024",
    "ahc025", "ahc026", "ahc027", "ahc039", "ahc046",
)


class SessionLike(Protocol):
    def public_eval(self, code: str, code_language: str = "cpp23") -> Any: ...
    def case_eval(self, input_str: str, code: str, code_language: str = "cpp23") -> Any: ...
    def private_eval(self, code: str, code_language: str = "cpp23") -> Any: ...
    def close(self) -> Any: ...


def _result_summary(result: Any) -> dict[str, Any]:
    """Project only documented public result properties and scalar case scores."""
    value: dict[str, Any] = {}
    for name in ("overall_judge_result", "overall_absolute_score", "overall_relative_score"):
        if hasattr(result, name):
            item = getattr(result, name)
            value[name] = item if isinstance(item, (str, int, float, bool)) or item is None else str(item)
    cases = getattr(result, "case_results", None)
    if cases is not None:
        rows = []
        for case in cases:
            row = {}
            for name in ("judge_result", "absolute_score", "relative_score"):
                if hasattr(case, name):
                    item = getattr(case, name)
                    row[name] = item if isinstance(item, (str, int, float, bool)) or item is None else str(item)
            rows.append(row)
        value["case_results"] = rows
    return value


@dataclass
class AleBenchBridge:
    session: SessionLike
    problem_id: str
    lite_version: bool
    state: Literal["open", "private_evaluated", "closed"] = "open"

    @classmethod
    def start(cls, problem_id: str, *, lite_version: bool = True, num_workers: int | None = None) -> "AleBenchBridge":
        if not problem_id or (lite_version and problem_id not in LITE_PROBLEM_IDS):
            raise ValueError(f"unsupported ALE-Bench problem for selected dataset: {problem_id!r}")
        # ALE-Bench currently calls os.getgid while preparing its Docker build
        # helper. Windows has no getgid. A neutral group id is sufficient for
        # Docker Desktop and keeps the upstream API otherwise unchanged.
        if not hasattr(os, "getgid"):
            os.getgid = lambda: 0  # type: ignore[attr-defined]
        if not hasattr(os, "getuid"):
            os.getuid = lambda: 0  # type: ignore[attr-defined]
        module = importlib.import_module("ale_bench")
        kwargs: dict[str, Any] = {"problem_id": problem_id, "lite_version": lite_version}
        if num_workers is not None:
            kwargs["num_workers"] = num_workers
        return cls(module.start(**kwargs), problem_id, lite_version)

    def public_eval(self, code: str, code_language: str = "cpp23") -> dict[str, Any]:
        self._require_open()
        return _result_summary(self.session.public_eval(code, code_language=code_language))

    def case_eval(self, input_str: str, code: str, code_language: str = "cpp23") -> dict[str, Any]:
        self._require_open()
        return _result_summary(self.session.case_eval(input_str=input_str, code=code, code_language=code_language))

    def private_eval(self, code: str, code_language: str = "cpp23") -> dict[str, Any]:
        self._require_open()
        result, rank, performance = self.session.private_eval(code, code_language=code_language)
        value = {
            "result": _result_summary(result),
            "rank": rank if isinstance(rank, (int, float, str)) or rank is None else str(rank),
            "performance": performance if isinstance(performance, (int, float, str)) or performance is None else str(performance),
        }
        self.state = "private_evaluated"
        return value

    def close(self) -> None:
        if self.state != "closed":
            self.session.close()
            self.state = "closed"

    def _require_open(self) -> None:
        if self.state != "open":
            raise RuntimeError(f"ALE-Bench session is {self.state}")


def write_artifact(path: Path, *, problem_id: str, lite_version: bool,
                   public_results: list[dict[str, Any]], private_result: dict[str, Any] | None) -> Path:
    """Write one stable artifact. Private output contains no inputs or session fields."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "benchmark": "ALE-Bench",
        "problem_id": problem_id,
        "lite_version": lite_version,
        "public_results": public_results,
        "private_result": private_result,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
