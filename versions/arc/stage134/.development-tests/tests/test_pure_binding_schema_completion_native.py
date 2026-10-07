"""Exact host binding contracts through installed Pi; not autonomous ARC evidence."""
import json

import pytest

from test_pure_publication_trial_native import setup, top_level_publication, field
from test_task_pure_expression_native import run, lit
from test_task_research_context import results, records


def omitted_binding():
    request = top_level_publication()
    schema = request["arguments"]["candidate"]["input_schema"]
    schema["properties"].pop("pixel")
    schema["required"].remove("pixel")
    return request


def test_explicit_bound_root_type_compiles_without_rewriting_science(tmp_path):
    request = omitted_binding()
    original = json.loads(json.dumps(request["arguments"]["candidate"]))
    events = run(tmp_path, setup() + [request,
        {"name":"task_tool_bound-check_v1", "arguments":request["arguments"]["trial"]}])
    result = results(events, "task_harness_create")[-1]
    assert not result.get("isError"), result
    receipt = result["result"]["details"]
    assert receipt["trial"]["status"] == "completed"
    assert json.loads(receipt["trial"]["result"]["content"][0]["text"]) is True
    published = records(tmp_path, "task-tools.jsonl")[0]
    assert published["input_schema"]["properties"]["pixel"] == {"type":"number"}
    assert published["input_schema"]["required"] == original["input_schema"]["required"]
    assert published["input_schema"]["additionalProperties"] is False
    assert published["program"]["expression"] == original["program"]["expression"]
    assert published["output_schema"] == original["output_schema"]
    normalization = receipt["binding_input_normalization"]
    assert normalization["added_properties"] == [{"name":"pixel", "type":"number"}]
    assert normalization["source_schema_sha256"] != normalization["compiled_schema_sha256"]
    log = records(tmp_path, "task-harness-create-normalizations.jsonl")[-1]
    assert log["binding_input_normalization"]["preparation"]["work_bytes"] > 0
    assert log["binding_input_normalization"]["provenance"]["bindings"][0]["ref"] == request["arguments"]["trial"]["bindings"][0]["ref"]
    assert json.loads(results(events, "task_tool_bound-check_v1")[-1]["result"]["content"][0]["text"]) is True
    assert "binding_input_normalization" in json.dumps(records(tmp_path, "provider-contexts.jsonl")[-1]["context"])


@pytest.mark.parametrize("scenario", ["unknown_parameter", "unbound_ast", "invalid_name", "lexical_ast", "invalid_schema", "stale_assembly", "no_creator"])
def test_other_preflight_errors_prevent_host_completion(tmp_path, scenario):
    request = omitted_binding()
    args = request["arguments"]
    if scenario == "unknown_parameter":
        args["trial"]["parameters"]["typo"] = 1
    elif scenario == "unbound_ast":
        args["candidate"]["program"]["expression"]["right"] = field("unbound")
    elif scenario == "invalid_name":
        args["candidate"]["name"] = "invalid_name"
    elif scenario == "lexical_ast":
        args["candidate"]["program"]["expression"]["right"] = {"op":"var", "name":"unbound"}
    elif scenario == "invalid_schema":
        args["candidate"]["input_schema"]["properties"]["expected"] = {"type":"imaginary"}
    elif scenario == "stale_assembly":
        args["assembly"]["expected_assembly_revision"] = 99
    steps = setup()[:1] if scenario == "no_creator" else setup()
    result = results(run(tmp_path, steps+[request]), "task_harness_create")[-1]
    assert result.get("isError"), result
    assert not records(tmp_path, "task-tools.jsonl")
    assert not records(tmp_path, "task-tool-events.jsonl")
    assert not records(tmp_path, "task-harness-create-normalizations.jsonl")


@pytest.mark.parametrize("scenario", ["duplicate_binding", "parameter_collision", "missing_ref", "bad_path", "input_limit", "preparation_limit"])
def test_binding_envelope_and_limits_fail_before_writes(tmp_path, scenario):
    request = omitted_binding()
    args = request["arguments"]
    if scenario == "duplicate_binding":
        args["trial"]["bindings"].append(args["trial"]["bindings"][0].copy())
    elif scenario == "parameter_collision":
        args["trial"]["parameters"]["pixel"] = 2
    elif scenario == "missing_ref":
        args["trial"]["bindings"][0]["ref"] = "observation_snapshot:missing@v1"
    elif scenario == "bad_path":
        args["trial"]["bindings"][0]["path"] = ["public_state", "absent"]
    elif scenario == "input_limit":
        args["candidate"]["program"]["limits"]["input_bytes"] = 10
    else:
        args["candidate"]["program"]["limits"]["allocation_bytes"] = 10
    result = results(run(tmp_path, setup()+[request]), "task_harness_create")[-1]
    assert result.get("isError"), result
    assert not records(tmp_path, "task-tools.jsonl")
    assert not records(tmp_path, "task-tool-events.jsonl")


def test_existing_bound_declaration_is_preserved_and_native_trial_rejects_type(tmp_path):
    request = top_level_publication()
    request["arguments"]["candidate"]["input_schema"]["properties"]["pixel"] = {"type":"string"}
    result = results(run(tmp_path, setup()+[request]), "task_harness_create")[-1]
    assert not result.get("isError"), result
    assert result["result"]["details"]["trial"]["status"] == "failed"
    assert records(tmp_path, "task-tools.jsonl")[0]["input_schema"]["properties"]["pixel"] == {"type":"string"}
    assert "binding_input_normalization" not in result["result"]["details"]


@pytest.mark.parametrize("type_name,path", [
    ("number", ["public_state","frames","0","0","1"]),
    ("array", ["public_state","frames","0"]),
    ("object", ["public_state"]),
    ("string", ["public_state","state"]),
    ("boolean", ["public_state","full_reset"]),
])
def test_bound_json_root_type_does_not_infer_shape_or_science(tmp_path, type_name, path):
    request = omitted_binding()
    args = request["arguments"]
    args["candidate"]["program"]["expression"] = field("pixel")
    args["candidate"]["output_schema"] = {"type":type_name}
    args["trial"]["bindings"][0]["path"] = path
    result = results(run(tmp_path, setup()+[request]), "task_harness_create")[-1]
    assert not result.get("isError"), result
    assert result["result"]["details"]["trial"]["status"] == "completed"
    actual = records(tmp_path, "task-tools.jsonl")[0]["input_schema"]["properties"]["pixel"]
    assert actual == {"type":type_name}


def test_duplicate_canonical_name_rejected_before_binding_preparation(tmp_path):
    request = omitted_binding()
    request["arguments"]["candidate"]["name"] = " bound-check "
    request["arguments"]["assembly"]["expected_assembly_revision"] = 1
    # If preparation ran first it would fail on this reference, hiding the
    # already-existing canonical identity and doing unnecessary host work.
    request["arguments"]["trial"]["bindings"][0]["ref"] = "observation_snapshot:missing@v1"
    events = run(tmp_path, setup()+[top_level_publication(), request])
    result = results(events, "task_harness_create")[-1]
    assert result.get("isError") and "tool already exists: bound-check" in json.dumps(result)
    assert len(records(tmp_path, "task-tools.jsonl")) == 1
    assert len(records(tmp_path, "task-harness-initial-trials.jsonl")) == 1
