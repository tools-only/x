from pathlib import Path

from hos.smoke import run_live_pipeline_smoke


def test_live_pipeline_smoke_uses_no_external_environment(tmp_path: Path) -> None:
    result = run_live_pipeline_smoke(tmp_path)
    assert result["status"] == "passed"
    assert result["base_harness"] != result["successor_harness"]
    assert result["live_ref"] == result["successor_harness"]
    assert result["projection"]["projection"]["raw_task_evidence_included"] is False
