"""Real Pi/broker diagnostic for report reuse and subsequent parent context."""
import json
from pathlib import Path

from test_task_research_context import _pi_cli, _run_fixture, records, results


def test_reused_research_delivers_next_step_into_later_real_parent_context(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "research-action-continuity"
    next_step = "Test one untested region with explicit coordinates; compare final pixels, not animation fingerprints"
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "Region roles are uncertain",
        "findings": [], "evidence_refs": [], "alternatives": ["Try an untested region"],
        "limitations": ["No transition has validated the goal"], "validation_plan": "One discriminating experiment",
        "method_candidates": [], "planning_implications": [{"decision": "Revise the tested-region premise", "applicability": "current"}],
        "research_progress": {"topic": "regions", "question": "which region responds?", "status": "continue",
                              "parent_relevance": "now", "next_step": next_step},
    }
    params = {"action": "start", "question": "Which regions remain untested?", "scope": "mechanism"}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
                   "PI_AUTORESEARCH_MODEL": "scripted", "PI_SUBAGENT_REPORT": json.dumps(report),
                   "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts")},
        steps=[{"name": "auto_research", "arguments": params}, {"name": "auto_research", "arguments": params}])
    returned = results(events, "auto_research")
    assert len(returned) == 2 and not any(item.get("isError") for item in returned)
    receipt = returned[1]["result"]["details"]
    assert receipt["reused"] is True and receipt["started"] is False
    assert receipt["continuation"]["next_step"] == next_step
    assert receipt["continuation"]["planning_implications"][0]["implication"] == "Revise the tested-region premise"
    assert len(records(root, "auto-research-runs.jsonl")) == 1
    contexts = records(root, "provider-contexts.jsonl")
    assert next_step in json.dumps(contexts[-1])
    assert "child_proposal_not_verified_or_adopted" in json.dumps(contexts[-1])
