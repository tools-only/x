from __future__ import annotations

from pathlib import Path

from autoresearch_pi.project import ProjectPaths


def test_project_root_is_not_jit_root():
    paths = ProjectPaths.from_environment(Path(__file__).resolve().parents[1])
    paths.assert_isolated()
    assert paths.root.name == "autoresearch_pi_project"
    assert paths.jit_root != paths.root


def test_runs_are_project_local():
    paths = ProjectPaths.from_environment(Path(__file__).resolve().parents[1])
    assert paths.runs_dir == paths.root / "runs"
