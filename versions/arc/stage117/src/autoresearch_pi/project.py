"""Project-local paths and isolation checks.

This module deliberately does not import JIT internals.  The JIT checkout is a
read-only test host reached by an adapter in a later implementation step.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_project_dotenv(root: Path, environment: dict[str, str] | None = None) -> dict[str, str]:
    """Load only this project's optional .env, without overriding process values."""
    values = dict(environment if environment is not None else os.environ)
    path = root.resolve() / ".env"
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        values.setdefault(key, value)
    return values


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    jit_root: Path
    autoresearch_root: Path

    @classmethod
    def from_environment(cls, root: Path | None = None) -> "ProjectPaths":
        project_root = (root or Path(__file__).resolve().parents[2]).resolve()
        jit_root = Path(os.getenv("JIT_ROOT", r"D:\JIT")).expanduser().resolve()
        autoresearch_root = Path(
            os.getenv(
                "AUTORESEARCH_META_ROOT",
                r"D:\guan-meta-loop-v2\autoresearch-meta-demo",
            )
        ).expanduser().resolve()
        return cls(
            root=project_root,
            jit_root=jit_root,
            autoresearch_root=autoresearch_root,
        )

    @property
    def runs_dir(self) -> Path:
        return self.root / "runs"

    @property
    def arc_agi_3_root(self) -> Path:
        return Path(os.getenv(
            "ARC_AGI_3_ROOT",
            r"D:\arc-agi-benchmark\arc-agi-3-benchmarking",
        )).expanduser().resolve()

    @property
    def terminal_bench_root(self) -> Path:
        return Path(os.getenv(
            "TERMINAL_BENCH_ROOT",
            r"D:\terminal-bench",
        )).expanduser().resolve()

    @property
    def terminal_bench_dataset(self) -> Path:
        return Path(os.getenv(
            "TERMINAL_BENCH_DATASET",
            r"D:\terminal-bench-2-1",
        )).expanduser().resolve()

    def assert_isolated(self) -> None:
        """Reject accidental writes rooted at the external JIT checkout."""
        if self.root == self.jit_root:
            raise RuntimeError("isolated project root must differ from JIT_ROOT")
