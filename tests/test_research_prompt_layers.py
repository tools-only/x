"""Prompt-boundary checks; these do not establish real-provider behavior."""
import json
from pathlib import Path
import pytest

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import results, records, run_research_protocol_helper


def test_parent_can_read_operations_without_starting_research(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        steps=[{"name": "auto_research", "arguments": {"action": "contract"}}],
    )
    response = results(events, "auto_research")[0]
    assert not response.get("isError")
    contract = json.loads(response["result"]["content"][0]["text"])
    assert contract["format"] == "auto-research-operations-v1"
    assert contract["instructions"]
    assert not records(tmp_path, "auto-research-sessions.jsonl")
    assert not records(tmp_path, "auto-research-plans.jsonl")


def test_workset_keeps_research_resume_state_when_optional_material_is_trimmed():
    checkpoint = {"cursor": "tested-A", "draft_findings": ["A contradicted"],
                  "unresolved_questions": ["Does B explain it?"], "next_step": "Test B"}
    result = run_research_protocol_helper(
        "protocol.buildResearchWorkset(JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT), 1100)",
        input_value={"goal": "Resolve mechanism", "research_checkpoint": checkpoint,
                     "selected_context": "x" * 4000},
    )
    assert result["research_checkpoint"] == checkpoint
    assert result["projection"]["truncated"]
    assert len(json.dumps(result, separators=(",", ":"))) <= 1100


@pytest.mark.parametrize("force_length", [False, True])
def test_child_workset_keeps_node_contract_and_parent_summary_provenance(tmp_path, force_length):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": "More evidence required.", "findings": [], "evidence_refs": [],
              "alternatives": [], "limitations": [], "validation_plan": "Request evidence.",
              "harness_proposals": []}
    (tmp_path / "task-checkpoint.json").write_text(json.dumps({
        "working_summary": "A is rejected; B remains open.",
        "summary_basis_refs": ["observation:obs-a@v1"],
        "decision_capsule": {"hypothesis_id": "B", "prediction": "movement", "falsifier": "no movement"},
        "pending_operations": [{"operation_key": "probe-B"}],
    }), encoding="utf-8")
    plan = {"goal": "Resolve the global mechanism", "complexity_assessment": {
        "level": "compound", "rationale": "Evidence then interpretation"},
        "nodes": [{"node_id": "a", "question": "Check evidence", "completion_contract": "Evidence or explicit gap",
                   "constraints": ["Keep competing interpretations separate."]},
                  {"node_id": "b", "question": "Interpret evidence", "completion_contract": "Interpretation or gap",
                   "depends_on": ["a"], "activation_policy": "parent_release"}]}
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
                   "PI_AUTORESEARCH_MODEL": "scripted",
                   "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
                   "PI_SUBAGENT_REPORT": json.dumps(report),
                   "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1" if force_length else "0",
                   "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}])},
        steps=[{"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
               {"name": "auto_research", "arguments": {"plan_ref": "research_plan:research-plan-1@v1",
                    "node_id": "a", "context_window": {"include_checkpoint": True}}}],
    )
    assert not results(events, "auto_research")[-1].get("isError")
    prompt = (tmp_path / ".task-child-prompts/auto-research-1_continuation-1.txt").read_text(encoding="utf-8")
    workset = json.loads(prompt.split("\n", 1)[1].split("\nParent-selected", 1)[0])
    assert workset["current_node"]["node_id"] == "a"
    assert workset["current_node"]["completion_contract"] == "Evidence or explicit gap"
    assert workset["current_node"]["plan_goal"] == "Resolve the global mechanism"
    assert workset["constraints"] == ["Keep competing interpretations separate."]
    assert prompt.count("Resolve the global mechanism") == 1
    assert prompt.count("Evidence or explicit gap") == 1
    assert workset["checkpoint"]["summary_basis_refs"] == ["observation:obs-a@v1"]
    assert workset["checkpoint"]["decision_capsule"]["falsifier"] == "no movement"
    assert workset["checkpoint"]["pending_operations"] == [{"operation_key": "probe-B"}]
    if force_length:
        resumed = (tmp_path / ".task-child-prompts/auto-research-1_continuation-2.txt").read_text(encoding="utf-8")
        resumed_workset = json.loads(resumed.split("\n", 1)[1].split("\nParent-selected", 1)[0])
        assert resumed_workset["current_node"] == {
            "node_id": "a", "completion_contract": "Evidence or explicit gap",
        }
        assert "Keep competing interpretations separate." not in resumed
        assert resumed.count("Resolve the global mechanism") == 0
        assert resumed.count("Evidence or explicit gap") == 1
        assert resumed_workset["checkpoint"] is None
        assert resumed_workset["research_checkpoint"]["pause_reason"] == "provider_stop_reason_length"
        assert "partial_output" not in resumed_workset["research_checkpoint"]
