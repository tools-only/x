"""Recorded provider call through actual Pi; diagnostic, not autonomous ARC proof."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture


def _calls(events):
    return [e for e in events if e.get("type") == "tool_execution_end"]


def test_recorded_prediction_update_commits_once_and_survives_later_context_and_reload(tmp_path):
    project = Path(__file__).resolve().parents[1]
    # Exact failed stage120 submission, frozen as evidence; never gameplay guidance.
    payload = json.loads((project / "tests/fixtures/stage120_checkpoint_forecast.json").read_text())
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": payload},
    ])
    assert len(_calls(events)) == 1 and not _calls(events)[0].get("isError")
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["task_goal"] == payload["task_goal"]
    assert checkpoint["decision_state"]["next_decision"] == {
        field: payload[field] for field in ("prediction", "falsifier")}
    assert "decision_capsule" not in checkpoint  # No fictitious executed action.
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text().splitlines()]
    schema = next(t["parameters"] for t in contexts[0]["tools"] if t["name"] == "task_checkpoint")
    assert all(schema["properties"][f]["type"] == "string" for f in ("prediction", "falsifier"))
    assert all(payload[f] in json.dumps(contexts[-1]) for f in ("prediction", "falsifier"))
    _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[])
    restored = json.dumps(json.loads((tmp_path / "provider-contexts.jsonl").read_text().splitlines()[-1])["context"])
    assert all(payload[f] in restored for f in ("prediction", "falsifier"))


def test_partial_forecast_keeps_other_field_but_explicit_next_decision_replaces(tmp_path):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "prediction": "Old expectation",
            "falsifier": "Retained counterexample", "decision_state": {"next_decision": {"prediction": "Old expectation", "method": "Compare"}}}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "prediction": "Revised expectation"}},
    ])
    assert not [e for e in _calls(events) if e.get("isError")]
    state = json.loads((tmp_path / "task-checkpoint.json").read_text())["decision_state"]
    assert state["next_decision"] == {"prediction": "Revised expectation", "falsifier": "Retained counterexample", "method": "Compare"}
    _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "decision_state": {"next_decision": None}}},
    ])
    assert json.loads((tmp_path / "task-checkpoint.json").read_text())["decision_state"]["next_decision"] is None


def test_recovery_does_not_revive_stale_forecast_fields(tmp_path):
    _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "prediction": "OLD", "falsifier": "OLD_OTHER"}},
    ])
    # Seed only the already implemented state-boundary marker, then use fresh Pi.
    path = tmp_path / "task-checkpoint.json"
    checkpoint = json.loads(path.read_text())
    checkpoint["reasoning_state"] = {"stale_fields": ["decision_state.next_decision"],
        "trigger_ref": "observation:diagnostic-reset@v1", "reason": "reset"}
    path.write_text(json.dumps(checkpoint), encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "prediction": "NEW"}},
    ])
    assert not [e for e in _calls(events) if e.get("isError")]
    checkpoint = json.loads(path.read_text())
    assert checkpoint["decision_state"]["next_decision"] == {"prediction": "NEW"}
    assert "decision_state.next_decision" not in checkpoint["reasoning_state"]["stale_fields"]


@pytest.mark.parametrize("value", [None, "", "Authored next step", {"prediction": ""}])
def test_valid_next_decision_values_are_not_coerced(tmp_path, value):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "decision_state": {"next_decision": value}}},
    ])
    assert not [e for e in _calls(events) if e.get("isError")]
    assert json.loads((tmp_path / "task-checkpoint.json").read_text())["decision_state"]["next_decision"] == value


@pytest.mark.parametrize("bad", [
    {"prediction": 42}, {"falsifier": False}, {"prediction": {"text": "Wrong shape"}},
    {"prediction": "A", "decision_state": {"next_decision": {"prediction": "B"}}},
    {"prediction": "A", "decision_state": {"next_decision": None}},
    {"prediction": "A", "next_decision": "Explicit text"},
    {"prediction": "A", "decision_state": {"next_decision": {"evidence_ref": "memory:missing@v1"}}},
    {"predictio": "Typo must remain an error"},
])
def test_bad_forecast_rejects_without_partial_plan_or_strategy_mutation(tmp_path, bad):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "prediction": "Keep", "falsifier": "Keep too"}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "task_goal": "MUST NOT COMMIT",
            "candidate_updates": [{"id": "must-not-exist", "kind": "rule", "claim": "Invalid", "status": "proposed"}], **bad}},
    ])
    assert [bool(e.get("isError")) for e in _calls(events)] == [False, True]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"]["next_decision"] == {"prediction": "Keep", "falsifier": "Keep too"}
    assert checkpoint.get("task_goal") != "MUST NOT COMMIT"
    strategy = tmp_path / "task-strategy-state.json"
    assert not strategy.exists() or "must-not-exist" not in strategy.read_text()
