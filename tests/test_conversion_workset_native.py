"""The parent sees completed mechanical stages after actual native assembly."""
import json

from test_arc_capability_surface_native import _run_arc_parent
from test_harness_sequential_batch_native import _create, _assemble


def _status():
    return {"name": "task_harness", "arguments": {"action": "status"}}


def _results(events):
    return [e for e in events if e.get("type") == "tool_execution_end"]


def test_selected_write_is_pending_trial_and_restarts_without_reauthoring(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _create("workset-trial"), _assemble("workset-trial"), _status(),
    ])
    calls = _results(events)
    assert all(not c.get("isError") for c in calls)
    intent = json.loads(calls[-1]["result"]["content"][0]["text"])["conversion_intents"][0]
    assert intent["status"] == "assembled_pending_trial"
    assert intent["recorded_status"] == "applied_pending_assembly"
    assert intent["retry"] is None
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    cue = next(p["text"] for m in contexts[3]["messages"] for p in m.get("content", [])
               if p.get("text", "").startswith("OPEN HARNESS CONVERSION INTENTS"))
    assert "assembled_pending_trial" in cue
    assert "either author the smallest" not in cue
    restarted = _run_arc_parent(tmp_path, [_status()])
    intent = json.loads(_results(restarted)[0]["result"]["content"][0]["text"])["conversion_intents"][0]
    assert intent["status"] == "assembled_pending_trial"
    # Removing a selection changes reachability, not the historical write.
    cleared = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 1,
         "selected_resource_refs": [], "decision": {"basis_refs": [], "reason": "End this trial selection.", "expected": "Keep the authored version available for a future choice."}}},
        _status(),
    ])
    intent = json.loads(_results(cleared)[-1]["result"]["content"][0]["text"])["conversion_intents"][0]
    assert intent["status"] == "applied_pending_assembly"
    assert intent["resource_refs"] == ["skill:workset-trial@v1"]


def test_successful_native_computation_advances_trial_without_claiming_benefit(tmp_path):
    candidate = {"component": "tool", "name": "workset-count", "description": "Count supplied values.",
                 "input_schema": {"type": "object", "properties": {"values": {"type": "array", "items": {"type": "number"}}}, "required": ["values"], "additionalProperties": False},
                 "output_schema": {"type": "number"},
                 "program": {"format": "task-pure-expression-v1", "limits": {}, "expression": {
                     "op": "length", "value": {"op": "get", "value": {"op": "input"}, "key": {"op": "literal", "value": "values"}}}}}
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": candidate, "decision": {"basis_refs": [], "reason": "Check native computation feedback.", "expected": "Return the actual count."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0, "selected_resource_refs": ["tool:workset-count@v1"], "decision": {"basis_refs": [], "reason": "Select this computation.", "expected": "The input is checked and counted."}}},
        {"name": "task_tool_workset-count_v1", "arguments": {"parameters": {"values": [3, 7]}, "bindings": []}},
        _status(),
    ])
    calls = _results(events)
    assert all(not c.get("isError") for c in calls)
    assert json.loads(calls[3]["result"]["content"][0]["text"]) == 2
    intent = json.loads(calls[-1]["result"]["content"][0]["text"])["conversion_intents"][0]
    assert intent["status"] == "trial_observed" and intent["trial_evidence_refs"]
    assert "does not establish task benefit" in intent["recovery"]
    assert not (tmp_path / "effect-assessments.jsonl").exists()
