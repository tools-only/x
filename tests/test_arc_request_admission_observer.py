"""Observer ownership handshake and preserved independent watchdog predicates."""
import importlib.util
import json
from pathlib import Path


spec = importlib.util.spec_from_file_location("admission_observer", Path(__file__).resolve().parents[1] / "tools/arc_bounded_run.py")
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


def test_observer_defers_only_no_level_kill_to_declared_runner_owner():
    status = {"unmeasured_usage": False, "input_ratio": 1.5, "context_chars_ratio": 1.7,
              "levels": 0, "reported_tokens": 8, "actions": 2, "length_responses": 0}
    bounds = {"no_level_limit": 6, "growth_limit": 2, "length_limit": 1}
    assert observer.stop_reason(status, **bounds, runner_owns_no_level=True) is None
    assert observer.stop_reason(status, **bounds) == "no first level by declared cost checkpoint"
    assert observer.stop_reason({**status, "unmeasured_usage": True}, **bounds,
                                runner_owns_no_level=True) == "unknown provider usage"
    assert observer.stop_reason({**status, "input_ratio": 2}, **bounds,
                                runner_owns_no_level=True).startswith("provider input")
    assert observer.stop_reason({**status, "actions": 0, "length_responses": 1}, **bounds,
                                runner_owns_no_level=True).startswith("length recovery")


def test_wrapper_forwards_threshold_and_requires_matching_runtime_ownership(tmp_path, monkeypatch):
    archive, root = tmp_path / "source", tmp_path / "run"
    archive.mkdir()
    (archive / "complete-source-manifest.json").write_text("{}", encoding="utf-8")
    root.mkdir()
    (tmp_path / "tmp").mkdir()
    config = root / "arc-runtime-config.json"
    config.write_text(json.dumps({"no_level_reported_tokens": 6,
                                 "no_level_checkpoint_scope": "outer_prompt_dispatch"}), encoding="utf-8")
    monkeypatch.setattr(observer, "PROJECT", tmp_path)
    monkeypatch.setattr(observer.time, "sleep", lambda *_: None)
    monkeypatch.setattr(observer.sys, "argv", ["arc_bounded_run.py", "--source", str(archive),
                                            "--root", str(root), "--no-level-tokens", "6",
                                            "--checkpoint-scope", "outer_prompt_dispatch"])
    # The wrapper refuses reused roots; create the runtime's root/config only
    # when the external process is launched, as the production runner does.
    saved_config = config.read_text(encoding="utf-8")
    config.unlink()
    root.rmdir()
    launches = []

    class Owner:
        returncode = 125
        def __init__(self, command, **kwargs):
            launches.append((command, kwargs))
            root.mkdir()
            config.write_text(saved_config, encoding="utf-8")
            self.polls = 0
        def poll(self):
            self.polls += 1
            return None if self.polls == 1 else self.returncode

    monkeypatch.setattr(observer.subprocess, "Popen", Owner)
    status = {"utc": "controlled", "unmeasured_usage": False, "input_ratio": 1,
              "context_chars_ratio": 1, "levels": 0, "reported_tokens": 8,
              "actions": 2, "length_responses": 0, "active_tools": []}
    monkeypatch.setattr(observer, "status", lambda *_: status.copy())
    def competing_stop(*_): raise AssertionError("observer must not kill the runner-owned checkpoint")
    monkeypatch.setattr(observer, "stop_owned_pi", competing_stop)
    assert observer.main() == 125
    assert launches[0][1]["env"]["PI_ARC_NO_LEVEL_REPORTED_TOKENS"] == "6"
    assert observer.runner_owns_no_level_checkpoint(root, 6) is True
    assert observer.runner_owns_no_level_checkpoint(root, 7) is False
    config.write_text("{}", encoding="utf-8")
    assert observer.runner_owns_no_level_checkpoint(root, 6) is False
    config.write_text("{partial", encoding="utf-8")
    assert observer.runner_owns_no_level_checkpoint(root, 6) is False
