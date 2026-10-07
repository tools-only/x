"""Real Pi registration/validation seam; deterministic provider, no quality claim."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture


def _contexts(root):
    return [json.loads(line)["context"] for line in (root / "provider-contexts.jsonl").read_text().splitlines()]


def _schemas(context):
    return {tool["name"]: tool["parameters"] for tool in context["tools"]}


def _result(context, call_id):
    return next(message for message in context["messages"]
                if message.get("role") == "toolResult" and message.get("toolCallId") == call_id)


def test_real_pi_management_disclosure_and_legacy_validation(tmp_path):
    extension = Path(__file__).resolve().parent / "pi_non_arc_task_subagents.ts"
    steps = [
        {"name": "task_harness", "arguments": {"action": "summary", "level_review": {"summary": "invalid"}}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review", "schema_action": "review"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
        {"name": "auto_research", "arguments": {"action": "contract", "schema_action": "enqueue"}},
        {"name": "auto_research", "arguments": {"action": "topics"}},
    ]
    events = _run_fixture(tmp_path, "treatment", steps=steps, arc_compact=True, extra_extensions=[extension])
    results = [event for event in events if event.get("type") == "tool_execution_end"]
    assert results[0]["isError"]
    assert "Invalid task_harness arguments" in results[0]["result"]["content"][0]["text"]
    assert all(not result["isError"] for result in results[1:])
    contexts = _contexts(tmp_path)
    schemas = [_schemas(context) for context in contexts]
    assert "level_review" not in schemas[0]["task_harness"]["properties"]
    assert "review" not in schemas[0]["task_harness"]["properties"]
    assert "review" not in schemas[1]["task_harness"]["properties"]  # Failure cannot load it.
    assert "review" in schemas[2]["task_harness"]["properties"]
    assert schemas[2]["task_harness"] == schemas[3]["task_harness"]
    assert "plan" not in schemas[0]["auto_research"]["properties"]
    assert "assignment" in schemas[0]["auto_research"]["properties"]  # Ongoing work stays directly callable.
    assert "plan" in schemas[4]["auto_research"]["properties"]
    assert schemas[4]["auto_research"] == schemas[5]["auto_research"]
    initial_names = {tool["name"] for tool in contexts[0]["tools"]}
    for context in contexts:
        names = {tool["name"] for tool in context["tools"]}
        assert initial_names <= names
        # Existing summary/status disclosure may expose the registered policy tool.
        assert names - initial_names <= {"task_tool_policy"}
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True, extra_extensions=[extension])
    restored = _schemas(_contexts(tmp_path)[-1])
    assert restored["task_harness"] == schemas[-1]["task_harness"]
    assert restored["auto_research"] == schemas[-1]["auto_research"]


def test_real_pi_full_fallback_preserves_typed_contract(tmp_path):
    extension = Path(__file__).resolve().parent / "pi_non_arc_task_subagents.ts"
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True, extra_extensions=[extension],
                 extra_env={"PI_MANAGEMENT_SCHEMA": "full"})
    schemas = _schemas(_contexts(tmp_path)[0])
    assert "review" in schemas["task_harness"]["properties"]
    assert "level_review" in schemas["task_harness"]["properties"]
    assert "plan" in schemas["auto_research"]["properties"]


def test_real_pi_bare_static_manual_reads_keep_core_schema_without_persistent_profile(tmp_path):
    extension = Path(__file__).resolve().parent / "pi_non_arc_task_subagents.ts"
    steps = [
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review"}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "induction"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
    ]
    events = _run_fixture(tmp_path, "treatment", steps=steps, arc_compact=True, extra_extensions=[extension])
    outputs = [event for event in events if event.get("type") == "tool_execution_end"]
    assert len(outputs) == 3 and all(not output["isError"] for output in outputs)
    contexts = _contexts(tmp_path)
    assert len(contexts) == 4
    initial = _schemas(contexts[0])
    for context in contexts:
        assert _schemas(context)["task_harness"] == initial["task_harness"]
        assert "review" not in _schemas(context)["task_harness"]["properties"]
        assert "transition_analysis" not in _schemas(context)["task_harness"]["properties"]
    for index, topic, phrase in [(1, "review", "complete structured candidate"),
                                 (2, "induction", "before-state, executed action, after-state transitions")]:
        value = json.loads(_result(contexts[index], f"fixture-{index}")["content"][0]["text"])
        assert value["format"] == "task-harness-contract-v1" and value["read_only"] is True
        assert value["topic"] == topic and phrase in value["instructions"]
    assert _result(contexts[2], "fixture-1")["details"]["transient_expired"] is True
    assert not (tmp_path / "management-schema-profiles.jsonl").exists()
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True, extra_extensions=[extension])
    assert _schemas(_contexts(tmp_path)[-1])["task_harness"] == initial["task_harness"]
    assert not (tmp_path / "management-schema-profiles.jsonl").exists()


@pytest.mark.parametrize("schema_action", ["review", "capability_review"])
def test_real_pi_explicit_review_alias_loads_survives_bare_read_reload_and_core_reset(tmp_path, schema_action):
    extension = Path(__file__).resolve().parent / "pi_non_arc_task_subagents.ts"
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "induction"}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "induction", "schema_action": schema_action}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
    ])
    assert not [event for event in events if event.get("type") == "error" or event.get("isError")]
    contexts = _contexts(tmp_path)
    assert len(contexts) == 5
    schemas = [_schemas(context)["task_harness"] for context in contexts]
    assert schemas[0] == schemas[1]
    for schema in schemas[2:]:
        assert schema == schemas[2]
        assert "review" in schema["properties"] and "transition_analysis" in schema["properties"]
        assert "level_review" not in schema["properties"]
    explicit_body = json.loads(_result(contexts[2], "fixture-2")["content"][0]["text"])
    bare_body = json.loads(_result(contexts[3], "fixture-3")["content"][0]["text"])
    assert explicit_body == bare_body and explicit_body["topic"] == "review"
    assert "complete structured candidate" in explicit_body["instructions"]
    profile_path = tmp_path / "management-schema-profiles.jsonl"
    rows = [json.loads(line) for line in profile_path.read_text().splitlines()]
    assert len(rows) == 1 and rows[0]["profiles"] == ["review"]

    resumed = _run_fixture(tmp_path, "treatment", arc_compact=True, extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "contract", "schema_action": "core"}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
    ])
    assert not [event for event in resumed if event.get("type") == "error" or event.get("isError")]
    reloaded = _contexts(tmp_path)[5:]
    assert _schemas(reloaded[0])["task_harness"] == schemas[2]
    for context in reloaded[1:]:
        assert _schemas(context)["task_harness"] == schemas[0]
    rows = [json.loads(line) for line in profile_path.read_text().splitlines()]
    assert len(rows) == 2 and rows[-1]["profiles"] == []


def test_real_pi_static_reads_do_not_weaken_hidden_validation_or_latch_failed_contracts(tmp_path):
    extension = Path(__file__).resolve().parent / "pi_non_arc_task_subagents.ts"
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review"}},
        {"name": "task_harness", "arguments": {"action": "summary", "level_review": {"summary": "invalid"}}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "unknown"}},
        {"name": "task_harness", "arguments": {"action": "contract", "schema_action": "invented"}},
        {"name": "task_harness", "arguments": {"action": "contract", "schema_action": "level_review"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
    ])
    outputs = [event for event in events if event.get("type") == "tool_execution_end"]
    assert [output["isError"] for output in outputs] == [False, True, True, True, True, False]
    failures = [output["result"]["content"][0]["text"] for output in outputs[1:5]]
    assert "Invalid task_harness arguments" in failures[0]
    assert "Unknown Harness contract topic" in failures[1]
    assert "schema_action" in failures[2]
    assert "Unknown pending level outcome window" in failures[3]
    contexts = _contexts(tmp_path)
    initial = _schemas(contexts[0])["task_harness"]
    assert all(_schemas(context)["task_harness"] == initial for context in contexts)
    assert not (tmp_path / "management-schema-profiles.jsonl").exists()


def test_real_pi_dynamic_contracts_and_legacy_auto_research_keep_existing_disclosure(tmp_path):
    test_root = Path(__file__).resolve().parent
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
                          extra_extensions=[test_root / "pi_level_outcome_fixture.ts", test_root / "pi_non_arc_task_subagents.ts"], steps=[
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "opportunity"}},
        {"name": "arc_action", "arguments": {}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "level_review", "window_id": "level-outcome:execution-observation-1"}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
        {"name": "auto_research", "arguments": {"action": "contract"}},
    ])
    assert not [event for event in events if event.get("type") == "error" or event.get("isError")]
    contexts = _contexts(tmp_path)
    schemas = [_schemas(context) for context in contexts]
    assert "review" not in schemas[0]["task_harness"]["properties"]
    assert "review" in schemas[1]["task_harness"]["properties"]
    assert "level_review" not in schemas[2]["task_harness"]["properties"]
    assert "level_review" in schemas[3]["task_harness"]["properties"]
    assert schemas[3]["task_harness"] == schemas[4]["task_harness"]
    opportunity = json.loads(_result(contexts[1], "fixture-1")["content"][0]["text"])
    level = json.loads(_result(contexts[3], "fixture-3")["content"][0]["text"])
    assert opportunity["topic"] == "opportunity" and "instructions" in opportunity
    assert level["format"] == "arc-level-review-contract-v1"
    assert level["window"]["window_id"] == "level-outcome:execution-observation-1"
    assert level["input_contract"]["evidence_ref_candidates"] == ["execution-observation-1"]
    assert "success_path" in level["guidance"]
    assert "plan" not in schemas[4]["auto_research"]["properties"]
    assert "plan" in schemas[5]["auto_research"]["properties"]
    auto = json.loads(_result(contexts[5], "fixture-5")["content"][0]["text"])
    assert auto["format"] == "auto-research-operations-v1" and "instructions" in auto and "plans" in auto
