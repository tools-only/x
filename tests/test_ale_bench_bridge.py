import json
from pathlib import Path

import pytest

from autoresearch_pi.ale_bench_bridge import AleBenchBridge, LITE_PROBLEM_IDS, write_artifact


class Result:
    overall_judge_result = "AC"
    overall_absolute_score = 7
    overall_relative_score = 3
    case_results = []


class Session:
    def __init__(self): self.closed = False; self.private_calls = 0
    def public_eval(self, code, code_language="cpp23"): return Result()
    def case_eval(self, cases, code, code_language="cpp23"): return Result()
    def private_eval(self, code, code_language="cpp23"):
        self.private_calls += 1
        return Result(), 4, 0.8
    def close(self): self.closed = True


def test_lite_problem_set_is_ten_questions():
    assert len(LITE_PROBLEM_IDS) == 10
    assert "ahc001" not in LITE_PROBLEM_IDS


def test_projection_and_private_summary_do_not_leak_session_fields():
    session = Session()
    bridge = AleBenchBridge(session, "ahc008", True)
    value = bridge.private_eval("code")
    assert value["rank"] == 4
    assert "private_seeds" not in json.dumps(value)
    assert "_private_inputs" not in json.dumps(value)
    assert session.private_calls == 1
    with pytest.raises(RuntimeError, match="private_evaluated"):
        bridge.private_eval("code")


def test_close_is_idempotent_and_blocks_further_evaluation():
    session = Session()
    bridge = AleBenchBridge(session, "ahc008", True)
    bridge.close()
    bridge.close()
    assert session.closed
    with pytest.raises(RuntimeError, match="closed"):
        bridge.public_eval("code")


def test_artifact_is_single_stable_json(tmp_path: Path):
    path = write_artifact(tmp_path / "result.json", problem_id="ahc008", lite_version=True,
                          public_results=[{"overall_absolute_score": 1}],
                          private_result={"result": {"overall_absolute_score": 2}, "rank": 1, "performance": 1.0})
    payload = json.loads(path.read_text())
    assert payload["schema_version"] == 1
    assert payload["private_result"]["rank"] == 1


def test_start_rejects_full_only_problem_without_importing_upstream():
    with pytest.raises(ValueError):
        AleBenchBridge.start("ahc001")
