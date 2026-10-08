"""First computation uses actual Pi/host/native version execution, not a model claim."""
import json
from pathlib import Path

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


def top_level_publication():
    body = candidate(trial())
    first = body.pop("trial")
    request = publication(body)
    request["arguments"]["trial"] = first
    return request


def test_top_level_trial_is_typed_and_returns_first_value_to_later_parent(tmp_path):
    events = run(tmp_path, setup()+[top_level_publication(),
        {"name":"task_tool_bound-check_v1","arguments":trial(["public_state","frames","0","0","0"])}])
    receipt = results(events,"task_harness_create")[-1]
    assert not receipt.get("isError"), receipt
    first = receipt["result"]["details"]["trial"]
    assert first["status"] == "completed"
    assert json.loads(first["result"]["content"][0]["text"]) is True
    assert "trial" not in records(tmp_path,"task-tools.jsonl")[0]
    contexts = records(tmp_path,"provider-contexts.jsonl")
    create_schema = next(t["parameters"] for t in contexts[0]["context"]["tools"] if t["name"]=="task_harness_create")
    envelope = create_schema["properties"]["trial"]
    assert envelope["type"]=="object" and not envelope.get("required")
    assert envelope["properties"]["current_grid"]["type"] == "boolean"
    assert envelope["properties"]["bindings"]["items"]["properties"]["path"]["items"]["type"]=="string"
    later = contexts[-2]["context"]["messages"]
    assert any('"trial"' in p.get("text","") and '"completed"' in p.get("text","") and 'true' in p.get("text","")
               for m in later for p in m.get("content",[]) if p.get("type")=="text")


@pytest.mark.parametrize("same", [True,False], ids=["same-value","conflict"])
def test_trial_alias_same_value_runs_once_and_conflict_never_writes(tmp_path, same):
    request = top_level_publication()
    # Object order is not semantic. Arrays and scalar values must still agree.
    old = request["arguments"]["trial"]
    request["arguments"]["candidate"]["trial"] = {"bindings":old["bindings"],"parameters":{"expected":2 if same else 3}}
    events = run(tmp_path,setup()+[request])
    result = results(events,"task_harness_create")[-1]
    if same:
        assert not result.get("isError"),result
        assert json.loads(result["result"]["details"]["trial"]["result"]["content"][0]["text"]) is True
        assert len([r for r in records(tmp_path,"task-tool-events.jsonl") if r.get("event")=="invoked"])==1
    else:
        assert result.get("isError") and "conflict" in json.dumps(result)
        assert json.loads(result["result"]["content"][0]["text"])["no_component_written"] is True
        assert not records(tmp_path,"task-tools.jsonl") and not records(tmp_path,"task-tool-events.jsonl")


@pytest.mark.parametrize("field", ["ref", "path", "bindings_order"])
def test_trial_alias_binding_conflicts_never_write(tmp_path, field):
    request = top_level_publication()
    old = json.loads(json.dumps(request["arguments"]["trial"]))
    if field == "ref":
        old["bindings"][0]["ref"] = "observation_snapshot:parent-state-2@v1"
    elif field == "path":
        old["bindings"][0]["path"][-1] = "0"
    else:
        second = {"name":"contrast", "ref":old["bindings"][0]["ref"], "path":old["bindings"][0]["path"]}
        request["arguments"]["trial"]["bindings"].append(second)
        old["bindings"].insert(0, second)
    request["arguments"]["candidate"]["trial"] = old
    result = results(run(tmp_path, setup()+[request]), "task_harness_create")[-1]
    assert result.get("isError")
    assert json.loads(result["result"]["content"][0]["text"])["no_component_written"] is True
    assert not records(tmp_path,"task-tools.jsonl") and not records(tmp_path,"task-tool-events.jsonl")


def test_legacy_integer_path_still_returns_exact_value(tmp_path):
    request = publication(candidate(trial(["public_state","frames",0,0,1])))
    result = results(run(tmp_path, setup()+[request]), "task_harness_create")[-1]["result"]
    assert result["details"]["trial"]["status"] == "completed"
    assert json.loads(result["details"]["trial"]["result"]["content"][0]["text"]) is True


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


@pytest.mark.parametrize("location", ["legacy", "top"])
def test_failed_trial_preserves_committed_publication_and_does_not_block_later_parent(tmp_path, location):
    bad=trial(["public_state","missing"])
    request = publication(candidate(bad))
    if location == "top":
        request["arguments"]["trial"] = request["arguments"]["candidate"].pop("trial")
    events=run(tmp_path,setup()+[request,
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


@pytest.mark.parametrize("case",["disabled_assembly","non_pure","malformed","executor_override","stale_assembly","batch"])
@pytest.mark.parametrize("location", ["legacy", "top"])
def test_trial_preflight_rejects_unsafe_or_uncommittable_inputs_before_writes(tmp_path,case,location):
    if case == "batch" and location == "top":
        pytest.skip("batch has no publication-trial parameter")
    body=candidate(trial())
    request=publication(body)
    if case=="disabled_assembly":request["arguments"]["assembly"]=False
    if case=="non_pure":body["program"]={"steps":[{"kind":"select","source":"input","fields":["pixel"]}]}
    if case=="malformed":body["trial"]={"parameters":[],"bindings":[]}
    if case=="executor_override":body["trial"]["tool_name"]="arc_action"
    if case=="stale_assembly":request["arguments"]["assembly"]["expected_assembly_revision"]=7
    if case=="batch":request={"name":"task_harness","arguments":{"action":"change","changes":[{"operation":"create","candidate":body}]}}
    elif location == "top":request["arguments"]["trial"] = body.pop("trial")
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


def test_real_qwen_first_publication_reports_source_repair_without_obsolete_admin_errors(tmp_path):
    request = json.loads((Path(__file__).parent / "fixtures/harness-stage130-compute-call.json").read_text(encoding="utf-8"))
    # Creator content hash changed with132. Reuse the current read, without altering the AST/schema/trial.
    request["candidate"].pop("authoring_method_ref")
    events = run(tmp_path, setup()+[{"name":"task_harness_create", "arguments":request}])
    result = results(events,"task_harness_create")[-1]
    assert result.get("isError")
    text = result["result"]["content"][0]["text"]
    assert "task-harness-preflight-error-v1" in text, text
    receipt = json.loads(text)
    assert receipt["no_component_written"] is True
    assert len(text) < 3000
    paths = [issue["path"] for issue in receipt["issues"]]
    assert "assembly" not in paths
    # Explicit binding types are compiled mechanically once the independent
    # authoring errors are repaired; they are no longer a parent repair field.
    assert "changes[0].candidate.name" not in paths
    assert any(path.endswith(".program.expression.value.name") for path in paths), receipt
    assert not records(tmp_path,"task-tools.jsonl") and not records(tmp_path,"task-tool-events.jsonl")
    later = json.dumps(records(tmp_path,"provider-contexts.jsonl")[-1]["context"])
    assert "no_component_written" in later and "program.expression.value.name" in later


@pytest.mark.parametrize("closed", [True, False], ids=["closed-binding-compiled", "open-accepted"])
def test_trial_binding_name_respects_closed_input_schema(tmp_path, closed):
    request = top_level_publication()
    schema = request["arguments"]["candidate"]["input_schema"]
    schema["properties"].pop("pixel")
    schema["required"].remove("pixel")
    schema["additionalProperties"] = not closed
    result = results(run(tmp_path, setup()+[request]),"task_harness_create")[-1]
    assert not result.get("isError")
    first = result["result"]["details"]["trial"]
    assert first["status"] == "completed" and json.loads(first["result"]["content"][0]["text"]) is True
    assert ("binding_input_normalization" in result["result"]["details"]) is closed
