import json
from types import SimpleNamespace

import pytest

from autoresearch_pi.arc_agi_3_bridge import frame_delta, parse_action_payload, serialize_frame
from autoresearch_pi.arc_agi_3_bridge import derive_action_budget
from autoresearch_pi.arc_agi_3_adapter import (
    ArcAgi3Adapter,
    OFFICIAL_ARC_SYSTEM_PROMPT,
    resolve_model_settings,
)
from autoresearch_pi.arc_agi_3_e2e import compare_arc_runs, project_arc_summary


class FakeAction:
    def __init__(self, name, *, complex_action=False):
        self.name = name
        self._complex = complex_action
        self.data = None

    def is_complex(self):
        return self._complex

    def set_data(self, data):
        self.data = data


def test_arc_frame_serialization_preserves_native_state_and_available_actions():
    raw = SimpleNamespace(
        game_id="ls20-test",
        frame=[SimpleNamespace(tolist=lambda: [[1, 2], [3, 4]])],
        state=SimpleNamespace(name="PLAYING"),
        levels_completed=2,
        win_levels=4,
        guid="guid-1",
        full_reset=False,
        available_actions=[1, 6],
        action_input=None,
    )

    serialized = serialize_frame(raw, action_name=lambda action_id: {1: "ACTION1", 6: "ACTION6"}[action_id])

    assert serialized == {
        "game_id": "ls20-test",
        "frames": [[[1, 2], [3, 4]]],
        "state": "PLAYING",
        "levels_completed": 2,
        "win_levels": 4,
        "guid": "guid-1",
        "full_reset": False,
        "available_actions": ["ACTION1", "ACTION6"],
    }


def test_arc_frame_delta_reports_only_changed_cells_and_bounds():
    before = {"frames": [[ [0, 0, 0], [0, 0, 0] ]]}
    after = {"frames": [[ [0, 1, 0], [0, 0, 2] ]]}
    assert frame_delta(before, after) == {
        "changed_cells": 2,
        "frame_available": True,
        "bbox": {"top": 0, "left": 1, "bottom": 1, "right": 2},
    }


def test_arc_action_budget_matches_official_baseline_multiplier():
    assert derive_action_budget([22, 123, 73, 84, 96, 192, 186]) == 3880


def test_arc_action_validation_rejects_unavailable_and_bad_coordinates():
    actions = {
        "ACTION1": FakeAction("ACTION1"),
        "ACTION6": FakeAction("ACTION6", complex_action=True),
    }

    with pytest.raises(ValueError, match="not currently available"):
        parse_action_payload({"action": "ACTION2"}, ["ACTION1"], actions.__getitem__)
    with pytest.raises(ValueError, match="integer coordinates"):
        parse_action_payload({"action": "ACTION6", "x": True, "y": 3}, ["ACTION6"], actions.__getitem__)
    with pytest.raises(ValueError, match="0..63"):
        parse_action_payload({"action": "ACTION6", "x": 64, "y": 3}, ["ACTION6"], actions.__getitem__)

    action = parse_action_payload({"action": "ACTION6", "x": 8, "y": 9}, ["ACTION6"], actions.__getitem__)
    assert action.name == "ACTION6"
    assert action.data == {"x": 8, "y": 9}


def test_arc_simple_action_ignores_provider_default_coordinates():
    actions = {"ACTION1": FakeAction("ACTION1")}
    action = parse_action_payload(
        {"action": "ACTION1", "x": 0, "y": 0}, ["ACTION1"], actions.__getitem__
    )
    assert action.name == "ACTION1"
    assert action.data is None


def test_arc_adapter_matches_official_frame_shape_and_reset_visibility():
    adapter = ArcAgi3Adapter()
    frame = {
        "state": "PLAYING", "levels_completed": 0,
        "frames": [[[1, 2], [3, 4]]], "available_actions": ["CLICK"],
    }
    first = adapter.observe(frame, native_actions=["CLICK"], complex_actions={"CLICK": True})
    assert first["agent_available_actions"] == ["CLICK"]
    assert first["model_prompt"] == (
        "State: PLAYING\nLevels completed: 0\n\n"
        "Frame 0:\n  [1, 2]\n  [3, 4]\n\n"
        "Available actions:\n- CLICK x y  (where x and y are integers 0-63)"
    )
    adapter.record_action("CLICK")
    second = adapter.observe(frame, native_actions=["CLICK"])
    assert second["agent_available_actions"] == ["RESET", "CLICK"]
    assert second["adapter"]["system_prompt"] == OFFICIAL_ARC_SYSTEM_PROMPT


def test_arc_adapter_scopes_model_settings_and_matches_official_limits():
    settings = resolve_model_settings({
        "ARC_OPENAI_API_BASE": "https://arc.example/v1",
        "ARC_OPENAI_API_KEY": "arc-key",
        "ARC_MODEL": "gpt-5.6-sol",
        "EXEC_MODEL": "ignored",
    })
    assert settings["base_url"] == "https://arc.example/v1"
    assert settings["api_key"] == "arc-key"
    assert settings["model"] == "gpt-5.6-sol"
    assert settings["context_window"] == 175_000
    assert settings["max_tokens"] == 128_000
    assert settings["pi_api"] == "openai-responses"


def test_arc_summary_keeps_native_correctness_separate_from_harness_effect(tmp_path):
    (tmp_path / "bridge-events.jsonl").write_text(
        json.dumps({"event": "action", "index": 1}) + "\n"
        + json.dumps({"event": "action", "index": 2}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "research-resources.jsonl").write_text(
        json.dumps({"finding_id": "finding-1", "version": 1}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "effect-assessments.jsonl").write_text(
        json.dumps({"effect_assessment_id": "assessment-1", "verdict": "supported"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "pi-events.jsonl").write_text(
        json.dumps({"type": "message_end", "message": {"stopReason": "error", "errorMessage": "provider unavailable"}}) + "\n",
        encoding="utf-8",
    )
    scorecard = {"scorecard_id": "card-1", "games": {"ls20-test": {"levels_completed": 3}}}

    summary = project_arc_summary(
        tmp_path,
        game="ls20-test",
        variant="treatment",
        bridge_result={"terminal_state": "WIN", "levels_completed": 3, "actions": 2},
        scorecard=scorecard,
        pi_returncode=0,
        timed_out=False,
    )

    assert summary["benchmark_evaluation"] == {
        "source": "arc_agi_3_native_scorecard",
        "scorecard_id": "card-1",
        "terminal_state": "WIN",
        "levels_completed": 3,
        "passed": True,
    }
    assert summary["self_harness_evaluation"]["supported_effect_assessments"] == 1
    assert summary["self_harness_evaluation"]["harness_improved"] is None
    assert summary["runtime"]["provider_error_count"] == 1
    assert summary["runtime"]["last_provider_error"] == "provider unavailable"
    assert summary["passed"] is True
    assert summary["artifacts"]["bridge_events"] == "bridge-events.jsonl"


def test_arc_pair_comparison_does_not_infer_task_gain_from_mechanism_only():
    control = {
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {"agent_actions": 1},
        "self_harness_evaluation": {"decision_count": 0, "supported_effect_assessments": 0},
    }
    treatment = {
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {"agent_actions": 1},
        "self_harness_evaluation": {"decision_count": 1, "supported_effect_assessments": 1},
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["task"]["harness_improved"] is None
    assert comparison["mechanism"]["supported_effect_delta"] == 1
    assert "not established" in comparison["interpretation"]
