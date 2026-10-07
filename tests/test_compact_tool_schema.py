"""Equivalent schema encoding and lossless repeated queue projection."""
import json

from test_harness_capability_authoring import module_eval
from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results


def test_enum_compaction_preserves_constraints_and_non_schema_data():
    result = module_eval("pi_compact_tool_schema.ts", "m.compactToolSchema({type:'object',required:['action'],additionalProperties:false,properties:{action:{anyOf:[{type:'string',const:'read'},{type:'string',const:'write'}],description:'Operation'},mixed:{anyOf:[{type:'string',const:'x'},{type:'number',const:1}]},annotated:{anyOf:[{type:'string',const:'a',description:'meaning'}]},sample:{type:'object',default:{anyOf:[{type:'string',const:'keep'}]}}}})")
    assert result["required"] == ["action"] and result["additionalProperties"] is False
    assert result["properties"]["action"] == {"type": "string", "enum": ["read", "write"], "description": "Operation"}
    assert "anyOf" in result["properties"]["mixed"]
    assert "anyOf" in result["properties"]["annotated"]
    assert "anyOf" in result["properties"]["sample"]["default"]


def test_shared_queue_templates_reconstruct_all_distinct_decisions():
    text = module_eval("pi_harness_capability_followup.ts", "m.projectCapabilityFollowupQueue(Array.from({length:3},(_,i)=>({opportunity_id:'op-'+i,status:'open',components:['skill'],instruction:'same instruction '.repeat(40),carrier_candidates:[{component:'skill',instruction:'same template '.repeat(40),creator_read_call:{action:'read_method',method_name:'skill-creator'}}],evidence_refs:['e-'+i]})))")
    payload = json.loads(text.split(": ", 1)[1])
    assert len(payload["shared"]) == 2
    for item in payload["details"]:
        assert payload["shared"][item["instruction"]["shared_ref"]] == "same instruction " * 40
        carrier = payload["shared"][item["carrier_candidates"][0]["shared_ref"]]
        assert carrier["creator_read_call"]["method_name"] == "skill-creator"
        assert item["evidence_refs"] == ["e-" + item["opportunity_id"].split("-")[-1]]
    assert len(text) < 3000


def test_pi_rejects_unknown_enum_action_and_accepts_valid_action(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "not_a_supported_action"}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    calls = results(events, "task_harness")
    assert len(calls) == 2
    assert calls[0].get("isError") is True
    assert not calls[1].get("isError")
