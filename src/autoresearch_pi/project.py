"""Project-local paths and isolation checks.

This module deliberately does not import JIT internals.  The JIT checkout is a
read-only test host reached by an adapter in a later implementation step.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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

    def assert_isolated(self) -> None:
        """Reject accidental writes rooted at the external JIT checkout."""
        if self.root == self.jit_root:
            raise RuntimeError("isolated project root must differ from JIT_ROOT")
