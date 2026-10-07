"""Replay actual stage38 checkpoint shapes through Pi and later provider inputs."""
import json

import pytest

from test_pi_external_benchmark_native import _run_fixture


def _calls(events):
    return [e for e in events if e.get("type") == "tool_execution_end"]


def _contexts(root):
    return [json.loads(line)["context"] for line in
            (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]


def test_recorded_checkpoint_knowledge_survives_partial_update_and_reload(tmp_path):
    counterexample = "First three actions changed the display but did not advance."
    effects = "ACTION1-3 each cause 52-cell redraw; no level change."
    unknown = "ACTION4 semantics and win condition."
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "counterevidence": [counterexample],
            "decision_state": {"known_effects": effects, "unknowns": unknown}}},
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "next_step": "Test one control against the retained counterexample."}},
    ])
    assert not [e for e in _calls(events) if e.get("isError")]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"] == {"known_effects": [effects],
        "knowledge_gaps": [unknown], "counterevidence": [counterexample]}
    assert "counterevidence" not in checkpoint  # One canonical store.
    contexts = _contexts(tmp_path)
    schema = next(t["parameters"] for t in contexts[0]["tools"] if t["name"] == "task_checkpoint")
    assert set(schema["properties"]["decision_state"]["properties"]) == {
        "known_effects", "knowledge_gaps", "counterevidence", "next_decision"}
    for context in contexts[1:]:
        text = json.dumps({"system": context["systemPrompt"], "messages": context["messages"]})
        assert all(value in text for value in [effects, unknown, counterexample])
    _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[])
    restored = json.dumps(_contexts(tmp_path)[-1])
    assert all(value in restored for value in [effects, unknown, counterexample])


@pytest.mark.parametrize("bad", [
    {"counterevidnce": ["MUST NOT VANISH"]},
    {"counterevidence": ["Top-level"], "decision_state": {"counterevidence": ["Conflicting"]}},
    {"decision_state": {"runtime_fact": "Unsupported"}},
    {"decision_state": {"counterevidence": [{"source_ref": "memory:missing@v1"}]}},
])
def test_invalid_semantic_patch_has_no_partial_checkpoint_or_strategy_effect(tmp_path, bad):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "decision_state": {"counterevidence": ["Keep this counterexample"]}}},
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "working_summary": "MUST NOT COMMIT", "candidate_updates": [
                {"id": "must-not-exist", "kind": "rule", "claim": "Bad update", "status": "proposed"}], **bad}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "next_step": "Recover"}},
    ])
    assert [bool(e.get("isError")) for e in _calls(events)] == [False, True, False]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"]["counterevidence"] == ["Keep this counterexample"]
    assert checkpoint.get("working_summary") != "MUST NOT COMMIT"
    strategy = tmp_path / "task-strategy-state.json"
    assert not strategy.exists() or "must-not-exist" not in strategy.read_text()


def test_explicit_clear_and_identical_compatibility_fields(tmp_path):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "counterevidence": ["Evidence"], "decision_state": {
                "counterevidence": ["Evidence"], "knowledge_gaps": "Unknown goal"}}},
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "decision_state": {"counterevidence": []}}},
    ])
    assert not [e for e in _calls(events) if e.get("isError")]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"] == {"counterevidence": [], "knowledge_gaps": ["Unknown goal"]}
