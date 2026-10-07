"""Native review diagnostics, not autonomous ARC quality acceptance."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results


@pytest.mark.parametrize("extra_index,accepted", [(7, True), (99, False)])
def test_delayed_review_uses_recorded_post_window_evidence(tmp_path, extra_index, accepted):
    extension = Path(__file__).resolve().parent / "pi_periodic_review_fixture.ts"
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        *[{"name": "arc_action", "arguments": {}}] * 7,
        {"name": "task_harness", "arguments": {
            "action": "review", "opportunity_id": "harness-opportunity-1", "review": [],
            "transition_analysis": {
                "observed_changes": "The first five actions and a later check are available.",
                "predictive_rules": "No mechanism conclusion yet.",
                "limiting_uncertainty": "Whether the earlier interpretation survives new evidence.",
                "next_experiment": "Compare the later observation with the window.",
                "capability_opportunities": "A comparison procedure may help.",
                "evidence_refs": ["execution-observation-5"],
                "historical_evidence_refs": [f"execution-observation-{extra_index}"],
            },
        }},
    ])
    outcome = results(events, "task_harness")[-1]
    assert bool(outcome.get("isError")) is not accepted, outcome
    if accepted:
        reviews = [json.loads(line) for line in (tmp_path / "task-harness-reviews.jsonl").read_text(encoding="utf-8").splitlines()]
        transition = reviews[-1]["transition_analysis"]
        assert transition["window_evidence_refs"] == ["execution-observation-5"]
        assert transition["historical_evidence_refs"] == ["execution-observation-7"]
    else:
        assert "evidence_refs" in json.dumps(outcome)
