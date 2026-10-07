"""Task-value exit paths keep preparation without pretending semantic success."""
import json

from test_arc_capability_surface_native import _run_arc_parent


def rows(root, name):
    path = root / name
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def intent(status, **details):
    return {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
        "operation_id": "scene-comparison", "purpose": "Compare visible structures for the next goal test.",
        "status": status, **details}}}


def test_creator_preparation_can_be_deferred_and_abandoned_for_task_value_across_restart(tmp_path):
    events = _run_arc_parent(tmp_path, [
        intent("open"),
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        intent("deferred", reason="The target relation is unknown; first obtain a discriminating observation.",
               reconsider_when="A specific candidate target gives this comparison a useful input."),
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [r["context"] for r in rows(tmp_path, "provider-contexts.jsonl")]
    resident = contexts[0]["systemPrompt"] + "\n" + json.dumps(contexts[0]["messages"])
    assert "only defer for a concrete infrastructure" not in resident
    assert "Once chosen, finish authoring" not in resident
    assert "drop an existing" in resident or "dropping the" in resident
    saved = rows(tmp_path, "task-development-intents.jsonl")
    assert saved[-1]["status"] == "deferred" and saved[-1]["operation_id"] == "scene-comparison"
    creator = rows(tmp_path, "task-baseline-method-reads.jsonl")
    assert len(creator) == 1
    restarted = _run_arc_parent(tmp_path, [
        intent("open", reason="New observations make a bounded comparison possible."),
        intent("dropped", reason="A direct goal test now answers the question at lower remaining cost."),
        {"name": "task_harness", "arguments": {"action": "summary"}},
    ])
    assert not [e for e in restarted if e.get("type") == "tool_execution_end" and e.get("isError")]
    saved = rows(tmp_path, "task-development-intents.jsonl")
    assert [r["status"] for r in saved] == ["open", "deferred", "open", "dropped"]
    assert saved[-1]["previous_status"] == "open"
    assert len(rows(tmp_path, "task-baseline-method-reads.jsonl")) == 1
    summary = next(e for e in restarted if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness"
                   and e.get("toolCallId") == "fixture-3")
    text = json.dumps(summary["result"])
    assert '"operation_development_pending"' not in text
    assert not rows(tmp_path, "task-harness-assemblies.jsonl")
    assert not rows(tmp_path, "task-tools.jsonl")
    assert not rows(tmp_path, "task-method-applications.jsonl")


def test_task_value_deferral_still_requires_a_concrete_resumption_condition(tmp_path):
    events = _run_arc_parent(tmp_path, [intent("deferred", reason="A better experiment is available.")])
    errors = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert len(errors) == 1 and "reconsider_when" in json.dumps(errors[0]["result"])
    assert not rows(tmp_path, "task-development-intents.jsonl")
