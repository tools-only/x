"""Stage51's real authored Tool must fail before publication when schema proves a get impossible."""
import copy
import json
from pathlib import Path

from test_harness_batch_preflight import run_changes
from test_task_pure_expression_native import run
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]
CANDIDATE = json.loads((PROJECT / "tests/fixtures/arc-stage51-tool-candidate.json").read_text(encoding="utf-8"))
STAGE54 = json.loads((PROJECT / "tests/fixtures/arc-stage54-tool-candidate.json").read_text(encoding="utf-8"))


def corrected():
    candidate = copy.deepcopy(CANDIDATE)
    candidate.pop('authoring_method_ref', None)  # Explicitly repair the historical stale citation.
    predicate = candidate["program"]["expression"]["fields"][0]["value"]["value"]["predicate"]
    predicate["right"] = predicate["right"]["value"]
    return candidate


def test_real_author_candidate_is_rejected_before_any_tool_version(tmp_path):
    events = run_changes(tmp_path, [{"operation": "create", "candidate": CANDIDATE}])
    response = results(events, "task_harness")[-1]
    assert response["isError"], response
    receipt = json.loads(response["result"]["content"][0]["text"])
    issue = next(item for item in receipt["issues"] if "input.color" in item["message"])
    assert issue["path"].endswith("program.expression.fields[0].value.value.predicate.right.value")
    assert not records(tmp_path, "task-tools.jsonl")


def test_native_creation_rejects_same_impossible_get(tmp_path):
    source = CANDIDATE
    events = run(tmp_path, [{"name": "task_tool", "arguments": {
        "action": "create", **{key: source[key] for key in
                             ("name", "description", "input_schema", "output_schema", "program")},
    }}])
    response = results(events, "task_tool")[-1]
    assert response["isError"] and "input.color" in json.dumps(response["result"])
    assert not records(tmp_path, "task-tools.jsonl")


def test_scalar_fix_keeps_actual_algorithm_and_object_get_remains_legal(tmp_path):
    candidate = corrected()
    events = run_changes(tmp_path, [{"operation": "create", "candidate": candidate}],
                         assembly={"expected_assembly_revision": 0, "selected_resource_refs": []},
                         more=[{"name": "task_tool_count-grid-color_v1", "arguments": {
                             "parameters": {"grid": [[0, 1], [1, 0]], "color": 0}, "bindings": []}}])
    output = results(events, "task_tool_count-grid-color_v1")[-1]
    assert not output["isError"] and json.loads(output["result"]["content"][0]["text"]) == {"count": 2}
    assert len(records(tmp_path, "task-tools.jsonl")) == 1

    object_candidate = copy.deepcopy(CANDIDATE)
    object_candidate.pop('authoring_method_ref', None)
    object_candidate["input_schema"]["properties"]["color"] = {
        "type": "object", "properties": {"value": {"type": "integer"}}, "required": ["value"]}
    second = tmp_path / "object"
    object_events = run_changes(second, [{"operation": "create", "candidate": object_candidate}])
    assert not results(object_events, "task_harness")[-1]["isError"]
    assert len(records(second, "task-tools.jsonl")) == 1


def test_closed_schema_rejects_undeclared_field_from_real_parent_candidate(tmp_path):
    events = run_changes(tmp_path, [{"operation": "create", "candidate": STAGE54}])
    response = results(events, "task_harness")[-1]
    assert response["isError"], response
    receipt = json.loads(response["result"]["content"][0]["text"])
    issue = next(item for item in receipt["issues"] if "input.grid" in item["message"])
    assert "input_schema.properties.grid" in issue["message"]
    assert ".program.expression." in issue["path"]
    assert not records(tmp_path, "task-tools.jsonl")

    direct = tmp_path / "direct"
    events = run(direct, [{"name": "task_tool", "arguments": {
        "action": "create", **{key: STAGE54[key] for key in
                             ("name", "description", "input_schema", "output_schema", "program")},
    }}])
    native = results(events, "task_tool")[-1]
    assert native["isError"] and "input_schema.properties.grid" in json.dumps(native["result"])
    assert not records(direct, "task-tools.jsonl")


def test_declared_grid_and_open_schema_remain_usable(tmp_path):
    candidate = copy.deepcopy(STAGE54)
    candidate.pop('authoring_method_ref', None)
    candidate["input_schema"]["properties"]["grid"] = {
        "type": "array", "items": {"type": "array", "items": {"type": "integer"}}}
    candidate["input_schema"]["required"].append("grid")
    events = run_changes(tmp_path, [{"operation": "create", "candidate": candidate}],
                         assembly={"expected_assembly_revision": 0, "selected_resource_refs": []},
                         more=[{"name": "task_tool_sample-grid-cells-ls20_v1", "arguments": {
                             "parameters": {"coords": [{"x": 0, "y": 0}, {"x": 1, "y": 0}],
                                            "grid": [[0, 3]]}, "bindings": []}}])
    response = results(events, "task_tool_sample-grid-cells-ls20_v1")[-1]
    assert not response["isError"] and json.loads(response["result"]["content"][0]["text"]) == [
        {"x": 0, "y": 0, "value": 0}, {"x": 1, "y": 0, "value": 3}]

    open_candidate = copy.deepcopy(STAGE54)
    open_candidate.pop('authoring_method_ref', None)
    open_candidate["input_schema"]["additionalProperties"] = True
    events = run_changes(tmp_path / "open", [{"operation": "create", "candidate": open_candidate}])
    assert not results(events, "task_harness")[-1]["isError"]

    dynamic_candidate = copy.deepcopy(STAGE54)
    dynamic_candidate.pop('authoring_method_ref', None)
    dynamic_candidate["input_schema"]["properties"]["field_name"] = {"type": "string"}
    dynamic_candidate["input_schema"]["required"].append("field_name")
    grid_access = dynamic_candidate["program"]["expression"]["body"]["fields"][2]["value"]["array"]["array"]
    grid_access["key"] = {"op": "get", "value": {"op": "input"},
                          "key": {"op": "literal", "value": "field_name"}}
    events = run_changes(tmp_path / "dynamic", [{"operation": "create", "candidate": dynamic_candidate}])
    assert not results(events, "task_harness")[-1]["isError"]
