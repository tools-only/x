"""Read-only adapter around the external JIT seed-harness runner."""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Sequence

from .project import ProjectPaths


@dataclass
class JitRun:
    command: Sequence[str]
    output_dir: Path
    returncode: int
    stdout: str
    stderr: str


class JitAdapter:
    """Invoke JIT as an external process; never import or mutate its source."""

    def __init__(self, paths: Optional[ProjectPaths] = None, *, python: Optional[str] = None):
        self.paths = paths or ProjectPaths.from_environment()
        self.paths.assert_isolated()
        # Prefer the dedicated JIT conda environment when it exists.  This is
        # important on Windows: the base interpreter often lacks OfficeBench's
        # icalendar/PyMuPDF dependencies.
        self.python = python or os.getenv("JIT_PYTHON") or self._default_python()

    def _default_python(self) -> str:
        candidate = Path(r"D:\anaconda\envs\jit\python.exe")
        return str(candidate) if candidate.exists() else sys.executable

    def run_seed(self, *, bench: str, harness: str = "auto_research", max_samples: Optional[int] = 1, cases: Optional[str] = None, output: Optional[Path] = None, extra_args: Sequence[str] = ()) -> JitRun:
        if bench not in {"officebench", "shopping"}:
            raise ValueError("bench must be officebench or shopping")
        output_dir = Path(output or (self.paths.runs_dir / f"jit_{bench}_{harness}" )).resolve()
        runs_dir = self.paths.runs_dir.resolve()
        if runs_dir not in output_dir.parents:
            raise ValueError("JIT output must stay inside the project runs directory")
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [self.python, "-m", "scripts.run_seed_harness", "--bench", bench, "--harness", harness, "--output", str(output_dir)]
        if max_samples is not None:
            command += ["--max-samples", str(max_samples)]
        if cases:
            command += ["--cases", cases]
        command += list(extra_args)
        env = os.environ.copy()
        result = subprocess.run(command, cwd=str(self.paths.jit_root), env=env, text=True, capture_output=True, check=False)
        return JitRun(command, output_dir, result.returncode, result.stdout, result.stderr)

    def check_prerequisites(self, bench: str) -> Dict[str, object]:
        """Return non-invasive checks needed before starting a benchmark."""
        checks: Dict[str, object] = {
            "jit_root": self.paths.jit_root.is_dir(),
            "dataset": (self.paths.jit_root / "dataset" / bench).is_dir(),
            "python": bool(self.python),
        }
        if bench == "officebench":
            probe = subprocess.run(
                [self.python, "-c", "import icalendar, fitz"],
                cwd=str(self.paths.jit_root), capture_output=True, text=True, check=False,
            )
            checks["officebench_python_deps"] = probe.returncode == 0
            if probe.returncode:
                checks["officebench_dependency_error"] = "install JIT requirements.txt (icalendar, PyMuPDF)"
        return checks
