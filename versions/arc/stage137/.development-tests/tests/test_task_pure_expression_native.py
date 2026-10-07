"""Native task_tool integration diagnostics; not real-provider ARC acceptance."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import harness_delivery, records, results, run_router_helper

PROJECT = Path(__file__).resolve().parents[1]
TOOL_FIXTURE = PROJECT / "tests" / "pi_task_tool_fixture.ts"
HOST_FIXTURE = PROJECT / "tests" / "pi_task_pure_expression_host_fixture.ts"


def lit(value):
    return {"op": "literal", "value": value}


def shift_program():
    return {
        "format": "task-pure-expression-v1", "limits": {},
        "expression": {
            "op": "map", "array": {"op": "get", "value": {"op": "input"}, "key": lit("grid")}, "as": "row",
            "body": {"op": "map", "array": {"op": "var", "name": "row"}, "as": "cell",
                     "body": {"op": "add", "left": {"op": "var", "name": "cell"},
                              "right": {"op": "get", "value": {"op": "input"}, "key": lit("delta")}}},
        },
    }


INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "grid": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
        "delta": {"type": "number"},
    },
    "required": ["grid", "delta"], "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "array", "items": {"type": "array", "items": {"type": "number"}},
}


def run(tmp_path, steps):
    return _run_fixture(tmp_path, "treatment", extra_extensions=[TOOL_FIXTURE, HOST_FIXTURE], steps=steps)


def test_native_pure_tool_binds_exact_snapshot_validates_schemas_and_records_hashes(tmp_path):
    events = run(tmp_path, [
        {"name": "pure_host_fixture", "arguments": {"scenario": "capture"}},
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "matrix-shift", "description": "Add a supplied delta to each numeric measurement.",
            "input_schema": INPUT_SCHEMA, "output_schema": OUTPUT_SCHEMA, "program": shift_program(),
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:matrix-shift@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": ["observation_snapshot:parent-state-1@v1"],
                         "reason": "Exercise the bounded computation on an exact immutable observation.",
                         "expected": "Return the shifted matrix."},
        }},
        {"name": "task_tool_matrix-shift_v1", "arguments": {
            "parameters": {"grid": "$binding:grid", "delta": 10},
            "bindings": [{"name": "grid", "ref": "observation_snapshot:parent-state-1@v1",
                          "path": ["public_state", "frames", "0"]}],
        }},
        {"name": "task_tool_matrix-shift_v1", "arguments": {
            "parameters": {"delta": 10},
            "bindings": [{"name": "grid", "ref": "observation_snapshot:parent-state-1@v1",
                          "path": ["public_state", "current_state_frame"]}],
        }},
        {"name": "task_tool_matrix-shift_v1", "arguments": {
            "parameters": {"delta": 10},
            "bindings": [{"name": "grid", "ref": "observation_snapshot:parent-state-1@v1",
                          "path": ["public_state", "frames", 0]}],
        }},
    ])
    attempts = results(events, "task_tool_matrix-shift_v1")
    assert attempts[0]["isError"] and "omit parameters.grid" in json.dumps(attempts[0]["result"])
    assert attempts[1]["isError"] and "binding path field is missing" in json.dumps(attempts[1]["result"])
    invocation = results(events, "task_tool_matrix-shift_v1")[-1]
    assert not invocation.get("isError"), invocation
    assert json.loads(invocation["result"]["content"][0]["text"]) == [[10, 12], [13, 14]]
    details = invocation["result"]["details"]
    assert details["representation"] == "task-pure-expression-v1"
    assert details["tool_ref"] == "tool:matrix-shift@v1"
    assert details["output_schema_validated"] is True
    assert details["input_provenance"]["bindings"][0]["ref"] == "observation_snapshot:parent-state-1@v1"
    assert all(len(details[key]) == 64 for key in
               ("program_sha256", "input_schema_sha256", "output_schema_sha256", "output_sha256"))
    assert details["consumed"]["steps"] > 0
    assert details["schema_validation"]["input"]["visits"] > 0
    use = records(tmp_path, "task-harness-assembly-receipts.jsonl")[-1]["components"][0]["use"]
    assert "omit any same-named parameter" in use["arguments"]
    assert "any $binding placeholder" in use["arguments"]
    contexts = records(tmp_path, "provider-contexts.jsonl")
    descriptions = [tool["description"] for context in contexts for tool in context["context"]["tools"]
                    if tool["name"] == "task_tool_matrix-shift_v1"]
    assert descriptions and any("omit that field from parameters" in description for description in descriptions)

    event = records(tmp_path, "task-tool-events.jsonl")[-1]
    assert event["status"] == "completed"
    assert event["pure_expression"]["output_sha256"] == details["output_sha256"]
    observation = records(tmp_path, "harness-observations.jsonl")[-1]
    assert observation["actual_use"] is True and observation["invocation_id"] == event["invocation_id"]
    assert observation["resource_refs"] == ["tool:matrix-shift@v1"]


def test_identity_tool_call_is_not_reported_as_semantic_effect(tmp_path):
    events = run(tmp_path, [
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "identity-probe", "description": "Diagnostic identity program.",
            "input_schema": {"type": "object", "additionalProperties": True},
            "output_schema": {"type": "object", "additionalProperties": True},
            "program": {"format": "task-pure-expression-v1", "limits": {}, "expression": {"op": "input"}},
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:identity-probe@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Test semantic effect accounting.",
                         "expected": "Identity result must not be counted as a useful transform."},
        }},
        {"name": "task_tool_identity-probe_v1", "arguments": {
            "parameters": {"cell": 4}, "bindings": [],
        }},
    ])
    assert not results(events, "task_tool_identity-probe_v1")[-1].get("isError")
    event = records(tmp_path, "task-tool-events.jsonl")[-1]
    assert event["status"] == "completed"
    assert event["semantic_effect_observed"] is False
    assert event["semantic_verification"]["output_not_input"] is False
    observation = records(tmp_path, "harness-observations.jsonl")[-1]
    assert observation["actual_use"] is True
    assert observation["semantic_effect_observed"] is False


def test_parent_creator_facade_publishes_assembles_and_invokes_exact_pure_tool(tmp_path):
    candidate = harness_delivery(
        "matrix-shift-facade", "computation", "matrix-shift-facade",
        "Add the declared delta to every numeric matrix cell.",
        input_schema=INPUT_SCHEMA, output_schema=OUTPUT_SCHEMA, program=shift_program(),
        basis_refs=["observation_snapshot:parent-state-1@v1"],
    )
    events = run(tmp_path, [
        {"name": "pure_host_fixture", "arguments": {"scenario": "capture"}},
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator",
        }},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": candidate}],
            "decision": {
                "basis_refs": ["observation_snapshot:parent-state-1@v1"],
                "reason": "Publish the bounded pure matrix transform through the parent facade.",
                "expected": "The exact assembled tool returns the shifted snapshot matrix.",
            },
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:matrix-shift-facade@v1"],
            "prompt_contributions": [],
            "decision": {
                "basis_refs": ["observation_snapshot:parent-state-1@v1"],
                "reason": "Select only the exact published computation for its trial.",
                "expected": "Only v1 becomes callable for this assembly.",
            },
        }},
        {"name": "task_tool_matrix-shift-facade_v1", "arguments": {
            "parameters": {"delta": 5},
            "bindings": [{"name": "grid", "ref": "observation_snapshot:parent-state-1@v1",
                          "path": ["public_state", "frames", 0]}],
        }},
    ])

    reads = results(events, "task_harness")
    assert len(reads) == 3 and not [event for event in reads if event.get("isError")], reads
    creator = json.loads(reads[0]["result"]["content"][0]["text"])
    choice = creator["authoring_template"]["program_choice"]
    assert creator["authoring_template"]["change_call"]["changes"][0]["candidate"]["program"]["format"] == "task-pure-expression-v1"
    assert "get" in choice["supported_pure_operators"]
    assert "steps" in choice["legacy_steps"]
    change = json.loads(reads[1]["result"]["content"][0]["text"])
    assert change["status"] == "applied"
    assert change["results"][0]["resource"]["resource_ref"] == "tool:matrix-shift-facade@v1"
    invocation = results(events, "task_tool_matrix-shift-facade_v1")[-1]
    assert not invocation.get("isError"), invocation
    assert json.loads(invocation["result"]["content"][0]["text"]) == [[5, 7], [8, 9]]

    record = records(tmp_path, "task-tools.jsonl")[-1]
    assert record["output_schema"] == OUTPUT_SCHEMA
    assert record["program"]["format"] == "task-pure-expression-v1"
    assert set(record["program"]["limits"]) == {
        "ast_nodes", "ast_depth", "json_depth", "input_bytes", "steps",
        "collection_length", "constructed_elements", "allocation_bytes", "output_bytes",
    }
    assert record["program_limits_requested"] == {}
    assert record["program_limits_effective"] == record["program"]["limits"]
    assert record["program_authored_sha256"] != record["program_sha256"]
    details = invocation["result"]["details"]
    assert details["program_sha256"] == record["program_sha256"]
    assert details["program_authored_sha256"] == record["program_authored_sha256"]


def test_research_router_preserves_pure_program_and_output_schema_without_legacy_steps():
    delivery = harness_delivery(
        "router-pure", "computation", "router-pure", "Return a bounded pure result.",
        input_schema=INPUT_SCHEMA, output_schema=OUTPUT_SCHEMA, program=shift_program(),
    )
    route = run_router_helper(
        "router.compileHarnessRoute({runId:'run-1',approvalId:'approval-1',approvalVersion:1,"
        "approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),"
        "capabilities:['task_tool']})",
        input_value=delivery,
    )
    assert route["route_status"] == "ready"
    args = route["steps"][0]["native_call"]["arguments"]
    assert args["program"] == shift_program()
    assert args["output_schema"] == OUTPUT_SCHEMA
    assert "steps" not in args["program"]


def test_published_pure_version_is_immutable_across_caller_mutation_update_and_reload(tmp_path):
    events = run(tmp_path, [
        {"name": "task_tool_immutability_fixture", "arguments": {}},
    ])
    event = results(events, "task_tool_immutability_fixture")[-1]
    assert not event.get("isError"), event
    details = event["result"]["details"]
    v1 = details["v1_after_mutation"]
    assert v1["program"]["expression"] == {"op": "input"}
    assert v1["input_schema"]["properties"]["value"]["type"] == "number"
    assert v1["output_schema"]["required"] == ["value"]
    assert v1["program_limits_requested"] == {}
    assert v1["program_limits_effective"] == v1["program"]["limits"]
    assert v1["program_authored_sha256"] != v1["program_sha256"]

    persisted = details["persisted"]
    assert [record["version"] for record in persisted] == [1, 2]
    assert persisted[0]["program_sha256"] == v1["program_sha256"]
    assert persisted[0]["input_schema_sha256"] == v1["input_schema_sha256"]
    assert persisted[0]["output_schema_sha256"] == v1["output_schema_sha256"]
    assert persisted[1]["program_sha256"] != persisted[0]["program_sha256"]
    reloaded = details["reloaded"]["tools"][0]
    assert reloaded["version"] == 2
    assert reloaded["program_sha256"] == persisted[1]["program_sha256"]
    assert reloaded["program_limits_requested"] == {"steps": 10}
    assert reloaded["program"]["limits"]["steps"] == 10


def test_pure_publication_and_invocation_failures_are_real_and_never_actual_use(tmp_path):
    bad_schema = {"type": "object", "oneOf": [{"type": "object"}]}
    events = run(tmp_path, [
        {"name": "pure_host_fixture", "arguments": {"scenario": "capture"}},
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "bad-schema", "description": "Must be rejected.",
            "input_schema": bad_schema, "output_schema": OUTPUT_SCHEMA, "program": shift_program(),
        }},
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "wrong-output", "description": "Exercise output validation.",
            "input_schema": INPUT_SCHEMA, "output_schema": {"type": "string"}, "program": shift_program(),
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:wrong-output@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Exercise a declared output contract.",
                         "expected": "Reject a non-string result."},
        }},
        {"name": "task_tool_wrong-output_v1", "arguments": {
            "parameters": {"delta": 1}, "bindings": [{"name": "grid",
                "ref": "observation_snapshot:parent-state-1@v1", "path": ["public_state", "frames", 0]}],
        }},
    ])
    publication = results(events, "task_tool")[0]
    assert publication.get("isError") and "unsupported schema keyword: oneOf" in json.dumps(publication)
    invocation = results(events, "task_tool_wrong-output_v1")[-1]
    assert invocation.get("isError") and "invalid_output" in json.dumps(invocation)
    tool_records = records(tmp_path, "task-tools.jsonl")
    assert [row["name"] for row in tool_records] == ["wrong-output"]
    event = records(tmp_path, "task-tool-events.jsonl")[-1]
    assert event["status"] == "failed"
    assert event["error"]["code"] == "invalid_output"
    assert event["error"]["effective_limits"] == event["program_limits_effective"]
    assert event["consumed"]["steps"] > 0
    assert all(len(event[key]) == 64 for key in (
        "program_sha256", "program_authored_sha256", "input_schema_sha256", "output_schema_sha256"))
    assert event["input_provenance"]["bindings"][0]["ref"].startswith("observation_snapshot:")
    assert not records(tmp_path, "harness-observations.jsonl")
