"""Blind-policy floor runner: the policy itself, and one offline run through the real bridge with the mock SDK."""
import json

from autoresearch_pi.arc_blind_policy import BlindPolicy, run_arc_blind_policy


def test_policies_use_only_the_available_actions():
    each = BlindPolicy("repeat_each", repeat=2, seed=0)
    assert [each.next(["ACTION2", "ACTION1", "RESET"])["action"] for _ in range(5)] == ["ACTION1", "ACTION1", "ACTION2", "ACTION2", "ACTION1"]
    probe = BlindPolicy("probe_then_each", repeat=3, seed=0)
    assert [probe.next(["ACTION1", "ACTION2"])["action"] for _ in range(5)] == ["ACTION1", "ACTION2", "ACTION1", "ACTION1", "ACTION1"]
    click = BlindPolicy("uniform_random", repeat=1, seed=7).next(["ACTION6"])
    assert click["action"] == "ACTION6" and 0 <= click["x"] <= 63 and 0 <= click["y"] <= 63
    assert BlindPolicy("uniform_random", 1, seed=7).next(["ACTION6"]) == click          # seeded
    assert BlindPolicy("repeat_each", 1, 0).next(["RESET"]) == {"action": "RESET"}
    assert BlindPolicy("repeat_each", 1, 0).next([]) is None


def test_offline_run_through_the_real_bridge(tmp_path):
    path = run_arc_blind_policy(tmp_path / "run", arc_root=tmp_path, game="ls20", policy="repeat_each",
                                repeat=2, max_actions=5, experiment_timeout_seconds=120, mock_environment=True)
    summary = json.loads(path.read_text(encoding="utf-8"))
    assert summary["stop_reason"] == "max_actions" and summary["passed"]
    assert summary["actions"] == summary["actions_recorded"] == 5
    assert "bridge_close" in summary and summary["levels_at_action"] == []
    actions = [json.loads(line)["action"] for line in (tmp_path / "run" / "trajectory.jsonl").read_text().splitlines()]
    assert actions == ["ACTION1", "ACTION1", "ACTION2", "ACTION2", "ACTION3"]
