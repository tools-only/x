"""First computation uses actual Pi/host/native version execution, not a model claim."""
import json

import pytest

from test_task_pure_expression_native import run, lit
from test_task_research_context import results, records


def field(name):
    return {"op":"get","value":{"op":"input"},"key":lit(name)}


def candidate(trial):
    return {"component":"tool","name":"bound-check","description":"Compare a bound observation value with a supplied integer.",
            "input_schema":{"type":"object","properties":{"pixel":{"type":"integer"},"expected":{"type":"integer"}},
                            "required":["pixel","expected"],"additionalProperties":False},
            "output_schema":{"type":"boolean"},
            "program":{"format":"task-pure-expression-v1","limits":{},
                       "expression":{"op":"eq","left":field("pixel"),"right":field("expected")}},
            "trial":trial}


def trial(path=None):
    return {"parameters":{"expected":2},"bindings":[{"name":"pixel","ref":"observation_snapshot:parent-state-1@v1",
            "path":path or ["public_state","frames","0","0","1"]}]}


def publication(body, assembly=True):
    value={"candidate":body}
    if assembly:
        value["assembly"]={"expected_assembly_revision":0,"selected_resource_refs":[],"prompt_contributions":[]}
    return {"name":"task_harness_create","arguments":value}


def setup():
    return [{"name":"pure_host_fixture","arguments":{"scenario":"capture"}},
            {"name":"task_harness","arguments":{"action":"read_method","method_name":"tool-creator"}}]


def test_create_assembly_trial_returns_semantic_value_and_later_parent_can_use_exact_version(tmp_path):
    events=run(tmp_path, setup()+[publication(candidate(trial())),
        {"name":"task_tool_bound-check_v1","arguments":trial(["public_state","frames","0","0","0"])}])
    receipt=results(events,"task_harness_create")[-1]
    assert not receipt.get("isError"),receipt
    first=receipt["result"]["details"]["trial"]
    assert first["status"]=="completed"
    assert first["tool_ref"]=="tool:bound-check@v1"
    assert json.loads(first["result"]["content"][0]["text"]) is True
    assert first["result"]["details"]["output_schema_validated"] is True
    assert first["result"]["details"]["input_provenance"]["bindings"][0]["ref"]=="observation_snapshot:parent-state-1@v1"
    ordinary=results(events,"task_tool_bound-check_v1")[-1]
    assert not ordinary.get("isError")
    assert json.loads(ordinary["result"]["content"][0]["text"]) is False
    assert len(records(tmp_path,"task-tools.jsonl"))==1
    uses=records(tmp_path,"task-tool-events.jsonl")
    assert len([u for u in uses if u.get("status")=="completed"])==2
    contexts=records(tmp_path,"provider-contexts.jsonl")
    later=[part["text"] for item in contexts[-2]["context"]["messages"] for part in item.get("content",[])
           if part.get("type")=="text"]
    assert any('"trial"' in s and '"completed"' in s and 'true' in s for s in later)


def test_failed_trial_preserves_committed_publication_and_does_not_block_later_parent(tmp_path):
    bad=trial(["public_state","missing"])
    events=run(tmp_path,setup()+[publication(candidate(bad)),
        {"name":"task_checkpoint","arguments":{"action":"update","working_summary":"The tool is assembled; its first input path was invalid."}},
        {"name":"task_tool_bound-check_v1","arguments":trial()}])
    receipt=results(events,"task_harness_create")[-1]
    assert not receipt.get("isError"),receipt
    assert receipt["result"]["details"]["trial"]["status"]=="failed"
    assert receipt["result"]["details"]["trial"]["result"]["isError"] is True
    assert len(records(tmp_path,"task-tools.jsonl"))==1
    assert not results(events,"task_checkpoint")[-1].get("isError")
    assert json.loads(results(events,"task_tool_bound-check_v1")[-1]["result"]["content"][0]["text"]) is True
    statuses=[r.get("status") for r in records(tmp_path,"task-tool-events.jsonl") if r.get("status") in ["failed","completed"]]
    assert statuses==["failed","completed"]


@pytest.mark.parametrize("case",["missing_assembly","non_pure","malformed","executor_override","stale_assembly","batch"])
def test_trial_preflight_rejects_unsafe_or_uncommittable_inputs_before_writes(tmp_path,case):
    body=candidate(trial())
    request=publication(body,assembly=case!="missing_assembly")
    if case=="non_pure":body["program"]={"steps":[{"kind":"select","source":"input","fields":["pixel"]}]}
    if case=="malformed":body["trial"]={"parameters":[],"bindings":[]}
    if case=="executor_override":body["trial"]["tool_name"]="arc_action"
    if case=="stale_assembly":request["arguments"]["assembly"]["expected_assembly_revision"]=7
    if case=="batch":request={"name":"task_harness","arguments":{"action":"change","changes":[{"operation":"create","candidate":body}]}}
    events=run(tmp_path,setup()+[request])
    assert results(events,request["name"])[-1].get("isError")
    assert not records(tmp_path,"task-tools.jsonl")
    assert not records(tmp_path,"task-tool-events.jsonl")


def test_legacy_create_without_trial_keeps_publication_and_explicit_use(tmp_path):
    body=candidate(trial());del body["trial"]
    events=run(tmp_path,setup()+[publication(body),{"name":"task_tool_bound-check_v1","arguments":trial()}])
    result=results(events,"task_harness_create")[-1]
    assert not result.get("isError") and "trial" not in result["result"]["details"]
    assert len([r for r in records(tmp_path,"task-tool-events.jsonl") if r.get("event")=="invoked"])==1
    assert json.loads(results(events,"task_tool_bound-check_v1")[-1]["result"]["content"][0]["text"]) is True
