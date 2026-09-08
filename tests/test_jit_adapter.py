from pathlib import Path
from types import SimpleNamespace

from autoresearch_pi.jit_adapter import JitAdapter
from autoresearch_pi.project import ProjectPaths


def test_jit_adapter_routes_output_inside_project(monkeypatch, tmp_path: Path):
    calls = {}
    def fake_run(command, **kwargs):
        calls.update(command=command, kwargs=kwargs)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")
    monkeypatch.setattr("autoresearch_pi.jit_adapter.subprocess.run", fake_run)
    paths = ProjectPaths(tmp_path, tmp_path / "jit", tmp_path / "meta")
    run = JitAdapter(paths, python="python").run_seed(bench="officebench", max_samples=1)
    assert run.returncode == 0
    assert str(run.output_dir).startswith(str(paths.runs_dir))
    assert calls["kwargs"]["cwd"] == str(paths.jit_root)
