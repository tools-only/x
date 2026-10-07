"""A native Pi error can recover without repeating the whole review manual."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture


def test_invalid_review_keeps_field_errors_and_direct_full_contract_recovery(tmp_path):
    project = Path(__file__).resolve().parents[1]
    attempted = {"action":"review","review":[{"disposition":"defer","reason":"The mechanism is still unknown."}]}
    transition = {"observed_changes":"The fixture supplies no pixel evidence.",
        "predictive_rules":"Unknown; no mechanism is inferred.", "limiting_uncertainty":"Missing pixels.",
        "next_experiment":"Obtain an observation before interpreting controls.",
        "capability_opportunities":"Unknown until that observation.", "evidence_refs":["execution-observation-1"]}
    events = _run_fixture(tmp_path,"treatment",arc_compact=True,
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"], steps=[
            *[{"name":"arc_action","arguments":{}} for _ in range(5)],
            {"name":"task_harness","arguments":attempted},
            {"name":"task_harness","arguments":{"action":"inspect","section":"review_contract"}},
            {"name":"task_harness","arguments":{"action":"review","review":[],"transition_analysis":transition}},
            {"name":"arc_action","arguments":{}},
        ])
    errors = [e for e in events if e.get("type")=="tool_execution_end" and e.get("isError")]
    assert len(errors)==1
    message = errors[0]["result"]["content"][0]["text"]
    error = json.loads(message)
    assert error["required_next_call"] == {"tool":"task_harness","arguments":{"action":"inspect","section":"review_contract"}}
    assert len(message)<2000 and "rules" not in error and "pattern_template" not in error
    assert {e["path"] for e in error["errors"]} == {"review[0].component","transition_analysis"}
    assert error["applied"] is False and error["retryable"] is True
    assert error["repair_template"]["review"] == []
    contract_event = next(e for e in events if e.get("type")=="tool_execution_end" and e.get("toolCallId")=="fixture-7")
    contract = json.loads(contract_event["result"]["content"][0]["text"])["value"]
    assert contract["rules"] and "pattern_template" in contract
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    following = next(c for c in contexts if any(m.get("role")=="toolResult" and m.get("isError") for m in c["messages"]))
    assert "section" in json.dumps(following) and "review_contract" in json.dumps(following)
    failures = [json.loads(l) for l in (tmp_path / "task-operation-failures.jsonl").read_text(encoding="utf-8").splitlines()]
    assert failures[0]["attempted_input"]["review"] == attempted["review"]
    drafts = [json.loads(l) for l in (tmp_path / "task-harness-review-drafts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert drafts[0]["entries"] == attempted["review"]
    reviews = [json.loads(l) for l in (tmp_path / "task-harness-reviews.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(reviews)==1 and reviews[0]["transition_analysis"]["predictive_rules"] == transition["predictive_rules"]
    actions = [e for e in events if e.get("type")=="tool_execution_end" and e.get("toolName")=="arc_action"]
    assert len(actions)==6 and not any(e.get("isError") for e in actions)
