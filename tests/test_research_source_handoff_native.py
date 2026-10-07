"""Real Pi/broker/child diagnostics; scripted models, not ARC acceptance."""
import json
from pathlib import Path
import pytest

from test_auto_research_self_harness_smoke import _child_env
from test_task_research_context import _pi_cli, _run_fixture, records, results


PROJECT = Path(__file__).resolve().parents[1]
EXTENSIONS = [PROJECT / "tests/pi_non_arc_task_subagents.ts"]


def source_report():
    return {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "A bounded successor computation is an untested candidate.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": ["No task utility claim."],
        "validation_plan": "The parent may test the computation on supplied integers.",
        "method_candidates": [{
            "candidate_ref": "successor", "name": "successor", "semantic_kind": "computation",
            "summary": "Add one to a supplied integer.", "basis_refs": [],
            "method": {"steps": ["Return the successor of the supplied integer."],
                       "predicted_semantic_result": "Input 6 yields value 7.",
                       "falsifier": "The returned value is not the successor."},
            "program": {"format": "task-pure-python-v1", "source": "{'value': input['n'] + 1}"},
            "input_schema": {"type": "object", "properties": {"n": {"type": "integer"}},
                             "required": ["n"], "additionalProperties": False},
            "output_schema": {"type": "object", "properties": {"value": {"type": "integer"}},
                              "required": ["value"], "additionalProperties": False},
        }],
    }


def submit_child(root, report, **extra_env):
    _, cli = _pi_cli()
    return _run_fixture(root, "treatment", extra_extensions=EXTENSIONS,
        extra_env={**_child_env(PROJECT, cli, report, [
            {"name": "submit_research_report", "arguments": {"report": report}}]), **extra_env},
        steps=[{"name": "auto_research", "arguments": {
            "question": "Investigate a reusable bounded integer successor computation.",
            "scope": "harness_component"}}])


def test_real_child_source_survives_to_parent_handoff_without_publication(tmp_path):
    report = source_report()
    events = submit_child(tmp_path, report)
    result = results(events, "auto_research")[0]
    assert not result.get("isError"), result
    saved = records(tmp_path, "auto-research-reports.jsonl")[-1]["report"]
    candidate = saved["method_candidates"][0]
    for field in ["program", "input_schema", "output_schema"]:
        assert candidate.get(field) == report["method_candidates"][0][field], (field, candidate)
    handoff = records(tmp_path, "parent-authoring-handoffs.jsonl")[-1]
    assert handoff["computation_candidate"] == {field: candidate[field]
        for field in ["program", "input_schema", "output_schema"]}
    assert handoff["source"]["research_run_ref"] == "research_run:auto-research-1@v1"
    assert handoff["source"]["report_ref"] == "research_report:auto-research-1@v1"
    assert handoff["change_call_template"]["executable"] is False
    assert "candidate" not in handoff["change_call_template"]["arguments"]["changes"][0]
    assert handoff["authoring_contract"]["creator_read_required"] is False
    assert records(tmp_path, "task-tools.jsonl") == []
    assert records(tmp_path, "task-harness-assemblies.jsonl") == []
    assert records(tmp_path, "subagent-progress.jsonl")[-1]["event"] == "process_closed"


def test_parent_explicitly_selects_child_source_and_later_native_result(tmp_path):
    report = source_report()
    child = submit_child(tmp_path, report)
    assert not results(child, "auto_research")[0].get("isError")
    handoff = records(tmp_path, "parent-authoring-handoffs.jsonl")[-1]
    supplied = handoff["computation_candidate"]
    refs = [handoff["source"]["report_ref"], handoff["source"]["method_ref"]]
    # Source comes from the real child's persisted handoff, not a separately
    # authored parent fixture program. The parent decision remains scripted.
    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[*EXTENSIONS, PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        {"name": "task_harness_create", "arguments": {
            "candidate": {"name": "successor", "description": "Add one to a supplied integer.", **supplied},
            "decision": {"basis_refs": refs, "reason": "Try this provisional research computation.",
                         "expected": "Input 6 yields value 7; a later different input also works."},
            "assembly": True, "trial": {"parameters": {"n": 6}}}},
        {"name": "task_tool_successor_v1", "arguments": {"parameters": {"n": 9}}},
    ])
    failures = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert not failures, failures
    created = results(events, "task_harness_create")[0]["result"]["details"]
    assert json.loads(created["trial"]["result"]["content"][0]["text"]) == {"value": 7}
    later = results(events, "task_tool_successor_v1")[0]["result"]
    assert json.loads(later["content"][0]["text"]) == {"value": 10}
    assert len(records(tmp_path, "task-tools.jsonl")) == 1
    assert records(tmp_path, "task-harness-assemblies.jsonl")[-1]["selected_resource_refs"] == ["tool:successor@v1"]
    assert [h["status"] for h in records(tmp_path, "parent-authoring-handoffs.jsonl")] == [
        "awaiting_parent_authoring", "authored"]
    assert "tool-creator" not in json.dumps(records(tmp_path, "task-baseline-method-reads.jsonl"))
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    received = next(m for m in context["messages"]
                    if m.get("role") == "toolResult" and m.get("toolName") == "task_tool_successor_v1")
    assert json.loads(received["content"][0]["text"]) == {"value": 10}


@pytest.mark.parametrize("mutation, expected", [
    ({"semantic_kind": "procedure"}, "only computation"),
    ({"program": {"steps": [{"kind": "adapter_call", "tool": "fixture.echo"}]}}, "bounded pure"),
    ({"program": {"format": "task-pure-python-v1", "source": "__import__('os')"}}, "source rejected"),
    ({"input_schema": {"type": "object", "$ref": "outside"}}, "unsupported schema keyword"),
    ({"input_schema": None}, "input_schema: must be object"),
    ({"implementation_ref": "fixture.echo"}, "cannot supply implementation_ref"),
])
def test_child_rejects_bad_computation_and_can_submit_conclusion_only(tmp_path, mutation, expected):
    bad = source_report()
    bad["method_candidates"][0].update(mutation)
    corrected = source_report()
    corrected["method_candidates"] = []
    corrected["conclusion"] = "Return the conclusion only; abandon the unusable candidate."
    _, cli = _pi_cli()
    events = _run_fixture(tmp_path, "treatment", extra_extensions=EXTENSIONS,
        extra_env=_child_env(PROJECT, cli, corrected, [
            {"name": "submit_research_report", "arguments": {"report": bad}},
            {"name": "submit_research_report", "arguments": {"report": corrected}},
        ]), steps=[{"name": "auto_research", "arguments": {
            "question": "Investigate a bounded computation; a conclusion alone is acceptable.",
            "scope": "harness_component"}}])
    assert not results(events, "auto_research")[0].get("isError")
    assert expected in json.dumps(records(tmp_path, "subagent-provider-contexts.jsonl"))
    saved = records(tmp_path, "auto-research-reports.jsonl")[-1]["report"]
    assert saved["conclusion"] == corrected["conclusion"]
    assert saved["method_candidates"] == []
    assert records(tmp_path, "parent-authoring-handoffs.jsonl") == []
    assert records(tmp_path, "task-tools.jsonl") == []
    assert records(tmp_path, "task-harness-assemblies.jsonl") == []
