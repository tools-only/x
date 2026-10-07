"""Cancellation boundaries through captured production create/host code inside Pi."""
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results


FIXTURE = Path(__file__).parent / "pi_pure_binding_schema_cancellation_fixture.ts"


@pytest.mark.parametrize("phase", ["before", "during_prepare"])
def test_cancelled_binding_schema_preparation_never_publishes(tmp_path, phase):
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[FIXTURE], steps=[
        {"name": "binding_schema_cancellation_fixture", "arguments": {"phase": phase}},
    ])
    result = results(events, "binding_schema_cancellation_fixture")[-1]
    assert not result.get("isError"), result
    detail = result["result"]["details"]
    assert detail["aborted"] is True
    assert detail["snapshot_reads"] == (0 if phase == "before" else 1), detail
    assert detail["error"]["format"] == "task-harness-preflight-error-v1"
    assert detail["error"]["no_component_written"] is True
    assert any("cancelled" in issue["message"] for issue in detail["error"]["issues"]), detail
    assert detail["written_files"] == []
    assert detail["request_unchanged"] is True
