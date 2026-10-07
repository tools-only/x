"""Default ARC state remains actionable without replaying static manuals."""
import json

from test_pi_external_benchmark_native import _run_fixture


def test_arc_default_status_keeps_working_state_and_exact_full_read(tmp_path):
    steps = [
        {"name": "task_checkpoint", "arguments": {"action": "update", "task_goal": "Test the observed rule", "next_step": "Compare a prediction against a new observation"}},
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "fact", "name": "rule-to-check",
            "atom": {"subject": "current rule", "predicate": "verification_status", "value": "unverified"},
            "summary": "Hypothesis remains unverified until a discriminating observation.",
            "validity": {"scope": "task"},
            "scope": {"kind": "task_wide", "statement": "current public task"}}}],
            "decision": {"basis_refs": [], "reason": "Keep the unverified rule available.", "expected": "Explicit scope and version remain usable."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["memory:rule-to-check@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the hypothesis for the next check.", "expected": "The parent retains its uncertainty."}}},
        {"name": "task_harness", "arguments": {"action": "status"}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "status", "section": "all"}},
        {"name": "task_harness", "arguments": {"action": "inspect", "section": "review_contract"}},
        {"name": "task_harness", "arguments": {"action": "enable", "enabled_tools": ["status"]}},
        {"name": "task_harness_status", "arguments": {"request": "current"}},
        {"name": "task_harness_status", "arguments": {"request": "full"}},
    ]
    events = _run_fixture(tmp_path, "treatment", steps=steps, arc_compact=True)
    calls = [r for r in events if r.get("type") == "tool_execution_end"]
    assert len(calls) == len(steps) and all(not r.get("isError") for r in calls), [(r.get("toolName"), r.get("result")) for r in calls if r.get("isError")]
    values = [json.loads(r["result"]["content"][0]["text"]) for r in calls]
    state, inspected, full, section = values[4:8]
    alias, alias_full = values[9:]
    assert state["format"] == inspected["format"] == alias["format"] == "task-harness-state-v1"
    for brief in (state, inspected, alias):
        assert brief["task_solving_context"]["task_goal"] == "Test the observed rule"
        assert brief["task_solving_context"]["next_step"] == "Compare a prediction against a new observation"
        for field in ("authorized_tools", "control_policy"):
            assert brief[field] == full[field]
        for field in ("component_pool", "knowledge_requires_review", "parent_authoring_handoffs"):
            assert field not in brief and field in brief["available_sections"]
        assert all(r["method_ref"] for r in brief["baseline_methods"])
        assert "review_contract" not in brief and "assembly_contract" not in brief
        assert brief["full_status_call"]["arguments"] == {"action": "status", "section": "all"}
        assert len(json.dumps(brief)) < len(json.dumps(full)) // 2
        assert brief["current_assembly"]["revision"] == 1
        assert brief["current_assembly"]["selected_resource_refs"] == ["memory:rule-to-check@v1"]
        assert any(r["resource_ref"] == "memory:rule-to-check@v1" and r["selected"] for r in full["component_pool"])
    assert full["format"] == alias_full["format"] == "task-local-harness-status-v1"
    assert section["value"] == full["review_contract"]
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    # The provider after default status sees neither a full manual nor a hidden
    # complete `details` duplicate, but still has the pending complete creator.
    after_status = json.dumps(contexts[5], separators=(",", ":"))
    assert '"review_contract":{' not in after_status
    assert "# Pi runtime adaptation: Skill creator" in after_status and "authoring_template" in after_status
    assert calls[4]["result"]["details"] == state
