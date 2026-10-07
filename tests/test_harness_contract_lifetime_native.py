"""Installed Pi consuming-context diagnostics; no paid provider/gameplay claim."""
import json

from test_arc_capability_surface_native import _run_arc_parent


def contexts(root):
    return [json.loads(line)["context"] for line in
            (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]


def result(context, call_id):
    return next(m for m in context["messages"]
                if m.get("role") == "toolResult" and m.get("toolCallId") == call_id)


def test_native_contract_first_delivery_expiry_and_explicit_restore_pin(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "review"}},
        {"name": "task_harness", "arguments": {"action": "context"}},
        {"name": "task_harness", "arguments": {"action": "restore_results", "result_refs": ["tool_result:fixture-1@v1"]}},
        {"name": "task_harness", "arguments": {"action": "context"}},
    ])
    assert not [e for e in events if e.get("type") == "error" or e.get("isError")]
    cs = contexts(tmp_path)
    assert len(cs) == 5
    delivered = result(cs[1], "fixture-1")
    assert json.loads(delivered["content"][0]["text"])["topic"] == "review"
    expired = result(cs[2], "fixture-1")
    assert expired["details"]["transient_expired"] is True
    assert "tool_result:fixture-1@v1" in expired["content"][0]["text"]
    for c in cs[3:]:
        restored = result(c, "fixture-1")
        assert restored["content"] == delivered["content"]
        assert restored["details"] == delivered["details"]
    assert not [e for e in events if e.get("toolName") == "task_resource"], "automatic expiry never requires a read"


def test_native_dynamic_assembly_contract_survives_later_continuation(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "assembly", "section": "all"}},
        {"name": "task_harness", "arguments": {"action": "context"}},
    ])
    assert not [e for e in events if e.get("type") == "error" or e.get("isError")]
    cs = contexts(tmp_path)
    assert len(cs) == 3
    first = result(cs[1], "fixture-1")
    value = json.loads(first["content"][0]["text"])
    assert "current_assembly" in value and "assemble_template" in value
    assert result(cs[2], "fixture-1")["content"] == first["content"]
