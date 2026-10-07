"""Source -> exact selection -> trial -> changed later binding through actual Pi."""
import json

from test_task_pure_expression_native import run
from test_task_research_context import records, results


def test_same_selected_source_version_computes_changed_later_snapshot(tmp_path):
    def binding(index):
        return [{"name": "grid", "ref": f"observation_snapshot:parent-state-{index}@v1",
                 "path": ["public_state", "frames", "0"]}]

    events = run(tmp_path, [
        {"name": "pure_host_fixture", "arguments": {"scenario": "capture"}},
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness_create", "arguments": {
            "candidate": {"name": "snapshot-value", "description": "Read the first cell of an exact numeric snapshot.",
                          "program": {"format": "task-pure-python-v1", "source": "{'value': input['grid'][0][0]}"}},
            "assembly": True, "trial": {"parameters": {}, "bindings": binding(1)}}},
        {"name": "pure_host_fixture", "arguments": {"scenario": "capture_changed"}},
        {"name": "task_tool_snapshot-value_v1", "arguments": {"parameters": {}, "bindings": binding(2)}},
    ])
    errors = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert not errors, errors
    publication = results(events, "task_harness_create")[0]["result"]["details"]
    assert json.loads(publication["trial"]["result"]["content"][0]["text"]) == {"value": 0}
    later = results(events, "task_tool_snapshot-value_v1")[0]["result"]
    assert json.loads(later["content"][0]["text"]) == {"value": 1}
    assert len(records(tmp_path, "task-tools.jsonl")) == 1
    selected = records(tmp_path, "task-harness-assemblies.jsonl")[-1]
    assert selected["selected_resource_refs"] == ["tool:snapshot-value@v1"]
    snapshots = records(tmp_path, "observation-snapshots.jsonl")
    assert snapshots[0]["public_state"]["frames"][0][0][0] == 0
    assert snapshots[1]["public_state"]["frames"][0][0][0] == 1
    contexts = records(tmp_path, "provider-contexts.jsonl")
    actual = next(m for m in contexts[-1]["context"]["messages"]
                  if m.get("role") == "toolResult" and m.get("toolName") == "task_tool_snapshot-value_v1")
    assert json.loads(actual["content"][0]["text"]) == {"value": 1}
