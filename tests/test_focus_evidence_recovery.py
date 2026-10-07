"""Focused regression for component focus versus exact evidence reads.

The v5 live run showed valid observation refs rejected by focus with a misleading
"another run" explanation while the compact ARC reader was not yet active.
"""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results


PROJECT = Path(__file__).resolve().parents[1]


def _payload(event):
    return json.loads(event["result"]["content"][0]["text"])


def test_focus_routes_existing_evidence_to_opt_in_reader_but_unknown_ref_stays_missing(tmp_path):
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[
        PROJECT / "tests/pi_periodic_review_fixture.ts",
    ], steps=[
        {"name": "arc_action", "arguments": {}},
        {"name": "task_harness", "arguments": {"action": "focus",
            "resource_refs": ["observation:execution-observation-1@v1"]}},
        {"name": "task_harness", "arguments": {"action": "focus",
            "resource_refs": ["observation:missing@v1"]}},
    ])
    outputs = results(events, "task_harness")
    assert not any(output.get("isError") for output in outputs)
    wrong_surface, missing = map(_payload, outputs)
    assert wrong_surface["format"] == "task-local-harness-rejection-v1"
    assert wrong_surface["code"] == "wrong_surface"
    assert wrong_surface["unsupported_resource_refs"] == ["observation:execution-observation-1@v1"]
    assert wrong_surface["required_next_calls"] == [
        {"tool": "task_harness", "arguments": {"action": "activate", "enabled_tools": ["task_resource"]}},
        {"tool": "task_resource", "arguments": {"action": "read",
            "ref": "observation:execution-observation-1@v1", "offset": 0, "limit": 2000}},
    ]
    assert missing["unknown_resource_refs"] == ["observation:missing@v1"]
    assert "another run" not in missing["message"]
