"""Direct parent-owned development intents; no periodic review is required."""
import json

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


def _payload(event):
    return json.loads(event["result"]["content"][0]["text"])


def test_creator_read_surfaces_minimal_handoff_before_full_method(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "skill-creator",
            "development_intent": {"operation_id": "decode-plan", "purpose": "Decode a board and plan its clicks",
                                   "status": "open", "next_step": "Author a bounded trial Skill."},
        },
    }])
    output = results(events, "task_harness")[-1]
    assert not output.get("isError"), output
    raw = output["result"]["content"][0]["text"]
    read = json.loads(raw)
    assert read["authoring_handoff"]["status"] == "prepared_not_published"
    assert read["authoring_handoff"]["development_intent"]["operation_id"] == "decode-plan"
    assert read["authoring_handoff"]["next_change_call"]["tool"] == "task_harness"
    assert read["authoring_handoff"]["next_change_call"]["arguments"]["action"] == "change"
    assert raw.index('"authoring_handoff"') < raw.index('"authoring_template"') < raw.index('"content"')
    template = read["authoring_template"]
    assert list(template).index("change_call") < list(template).index("optional_method_metadata")
    assert "Pi runtime adaptation" in read["content"]
    assert "Running and evaluating test cases" in read["content"]
    assert records(tmp_path, "task-development-intents.jsonl")[-1]["operation_id"] == "decode-plan"


def test_direct_intent_survives_memory_change_and_restart_without_review(tmp_path):
    intent = {"operation_id": "compare-strategies", "purpose": "Compare route strategies after locating the object",
              "status": "open", "next_step": "Draft a small strategy comparison method."}
    first = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": intent}},
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "locate-object", "purpose": "Locate the controlled object", "status": "resolved"}}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create",
            "candidate": {"semantic_kind": "memory", "key": "object-location", "validity": {"scope": "task"},
                          "atom": {"subject": "object", "predicate": "location", "value": "north"}}}],
            "decision": {"basis_refs": [], "reason": "Save the observed location.", "expected": "Location retained."}}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "update",
            "candidate": {"semantic_kind": "memory", "key": "object-location", "validity": {"scope": "task"},
                          "atom": {"subject": "object", "predicate": "location", "value": "north-east"}}}],
            "decision": {"basis_refs": [], "reason": "Correct the observed location.", "expected": "Location revised."}}},
    ])
    assert not any(item.get("isError") for item in results(first, "task_harness"))
    resumed = _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}])
    status = _payload(results(resumed, "task_harness")[-1])
    assert status["direct_development_intents"][0]["operation_id"] == "compare-strategies"
    assert status["direct_development_intents"][0]["status"] == "open"
    assert any(followup.get("development_intents", [{}])[0].get("operation_id") == "compare-strategies"
               for followup in status["capability_followups"])
    assert len(status["component_pool"]) == 1
    assert status["current_assembly"] is None
    assert "compare-strategies" in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8")
    assert not records(tmp_path, "task-capability-decisions.jsonl")


def test_direct_intent_can_be_explicitly_deferred_and_resumed_without_opportunity(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "policy", "purpose": "Keep a scoped strategy policy", "status": "open",
            "next_step": "Author a system_prompt."}}},
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "policy", "purpose": "Keep a scoped strategy policy", "status": "deferred",
            "reason": "Need another observation", "reconsider_when": "After the next level transition"}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "policy", "purpose": "Keep a scoped strategy policy", "status": "open",
            "next_step": "Author a level-scoped system_prompt."}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(events, "task_harness")
    assert not any(item.get("isError") for item in outputs), outputs
    assert _payload(outputs[2])["direct_development_intents"][0]["status"] == "deferred"
    assert _payload(outputs[4])["direct_development_intents"][0]["status"] == "open"
    assert len(records(tmp_path, "task-development-intents.jsonl")) == 3


def test_read_without_parent_intent_does_not_invent_one(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(events, "task_harness")
    assert not any(item.get("isError") for item in outputs), outputs
    assert _payload(outputs[1])["direct_development_intents"] == []
    assert not records(tmp_path, "task-development-intents.jsonl")


def test_review_intent_then_direct_resolution_is_one_operation(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1", "recordedAt": "2026-09-25T01:00:00Z",
        "development_intent": {"operation_id": "decode", "purpose": "Decode the board", "status": "open"},
        "transition_analysis": {"capability_opportunities": "Decode the board", "evidence_refs": []},
        "entries": [],
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator",
            "development_intent": {"operation_id": "decode", "purpose": "Decode the board", "status": "open"}}},
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "decode", "purpose": "Decode the board", "status": "resolved"}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not any(item.get("isError") for item in results(events, "task_harness"))
    status = _payload(results(events, "task_harness")[-1])
    assert not any(any(i["operation_id"] == "decode" for i in f.get("development_intents", []))
                   for f in status["capability_followups"])


def test_direct_intent_then_review_resolution_is_one_operation(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1", "recordedAt": "2026-09-25T01:00:00Z",
        "transition_analysis": {"capability_opportunities": "Plan the board", "evidence_refs": []},
        "entries": [],
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "development_intent", "development_intent": {
            "operation_id": "decode", "purpose": "Decode the board", "status": "open"}}},
        {"name": "task_harness", "arguments": {"action": "capability_review", "opportunity_id": "op-1",
            "development_intent": {"operation_id": "decode", "purpose": "Decode the board", "status": "resolved"}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not any(item.get("isError") for item in results(events, "task_harness"))
    status = _payload(results(events, "task_harness")[-1])
    assert not any(any(i["operation_id"] == "decode" for i in f.get("development_intents", []))
                   for f in status["capability_followups"])


def test_research_method_read_preserves_explicit_intent_without_component_handoff(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {
        "action": "read_method", "method_name": "research-orchestration",
        "development_intent": {"operation_id": "compare-approaches", "purpose": "Compare competing approaches",
                               "status": "open", "next_step": "Ask a bounded research question."}}}])
    output = results(events, "task_harness")[-1]
    assert not output.get("isError"), output
    read = _payload(output)
    assert "authoring_handoff" not in read
    assert records(tmp_path, "task-development-intents.jsonl")[-1]["operation_id"] == "compare-approaches"


def test_same_millisecond_updates_follow_control_journal_order(tmp_path):
    stamp = "2026-09-25T01:00:00.000Z"
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1", "recordedAt": stamp,
        "development_intent": {"operation_id": "decode", "purpose": "Decode", "status": "open"},
        "transition_analysis": {"capability_opportunities": "Decode", "evidence_refs": []}, "entries": [],
    }) + "\n", encoding="utf-8")
    (tmp_path / "task-development-intents.jsonl").write_text("\n".join(json.dumps(row) for row in [
        {"operation_id": "decode", "purpose": "Decode", "status": "open", "recordedAt": stamp,
         "source": "review:op-1"},
        {"operation_id": "decode", "purpose": "Decode", "status": "resolved", "recordedAt": stamp,
         "source": "direct_parent_control"},
    ]) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}])
    status = _payload(results(events, "task_harness")[-1])
    assert status["direct_development_intents"][0]["status"] == "resolved"
    assert not any(any(i["operation_id"] == "decode" for i in f.get("development_intents", []))
                   for f in status["capability_followups"])


def test_failed_review_draft_does_not_reopen_committed_resolution(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "old-op", "review_id": "review-old", "recordedAt": "2026-09-25T01:00:00Z",
        "development_intent": {"operation_id": "decode", "purpose": "Decode", "status": "resolved"},
        "transition_analysis": {"capability_opportunities": "Decode", "evidence_refs": []}, "entries": [],
    }) + "\n", encoding="utf-8")
    (tmp_path / "task-harness-review-drafts.jsonl").write_text(json.dumps({
        "opportunity_id": "new-op", "status": "invalid", "recordedAt": "2026-09-25T02:00:00Z",
        "development_intents": [{"operation_id": "decode", "purpose": "Decode", "status": "open"}],
        "transition_analysis": {"capability_opportunities": "Decode", "evidence_refs": []}, "entries": [],
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}])
    status = _payload(results(events, "task_harness")[-1])
    assert status["review_drafts"][0]["development_intents"][0]["status"] == "open"
    assert not any(any(i["operation_id"] == "decode" for i in f.get("development_intents", []))
                   for f in status["capability_followups"])
