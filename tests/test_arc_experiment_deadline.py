"""Experimental cutoffs are opt-in and must not change native ARC defaults."""
import pytest
from autoresearch_pi import arc_agi_3_e2e as runner


@pytest.mark.parametrize("seconds", [None, 2700.0])
def test_pi_receives_only_explicit_experiment_deadline(tmp_path, monkeypatch, seconds):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "cli.js"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner.time, "monotonic", lambda: 100.0)
    seen = {}

    class LaunchBoundary(Exception):
        pass

    def capture(*args, **kwargs):
        seen.update(kwargs)
        raise LaunchBoundary

    monkeypatch.setattr(runner, "PiKernel", capture)
    with pytest.raises(LaunchBoundary):
        runner._run_pi(tmp_path, bridge_url="http://127.0.0.1:1", game="test",
                       variant="treatment", context_compaction=True,
                       provider_extension=tmp_path / "provider.ts",
                       experiment_timeout_seconds=seconds)
    assert seen["deadline"] == (None if seconds is None else 2800.0)
    assert seen["timeout"] == runner.OFFICIAL_MAX_RUNTIME_SECONDS


@pytest.mark.parametrize("seconds", [0, -1, float("inf"), float("nan")])
def test_invalid_experiment_cutoff_rejected_before_launch(tmp_path, seconds):
    with pytest.raises(ValueError, match="experiment_timeout_seconds"):
        runner.run_arc_agi_3_e2e(tmp_path / "run", arc_root=tmp_path,
                               game="test", experiment_timeout_seconds=seconds)
    assert not (tmp_path / "run").exists()
