import json
import os
import subprocess
from types import SimpleNamespace
from pathlib import Path

import pytest

from autoresearch_pi.arc_agi_3_bridge import (
    ArcEnvironmentError,
    exception_details,
    frame_delta,
    parse_action_payload,
    project_trajectory,
    public_state_fingerprint,
    serialize_frame,
)
from autoresearch_pi.arc_agi_3_bridge import derive_action_budget
from autoresearch_pi.arc_agi_3_adapter import (
    ArcAgi3Adapter,
    OFFICIAL_ARC_SYSTEM_PROMPT,
    resolve_model_settings,
)
from autoresearch_pi.arc_agi_3_e2e import (
    _compact_arc_pi_event,
    _arc_continuation_prompt,
    _arc_terminal_or_budget_exhausted,
    _partial_bridge_result,
    _advance_research_validation_window,
    _advance_arc_recovery_phase,
    _expire_research_validation_window_if_consumed,
    _open_research_validation_window,
    _project_arc_kernel_event,
    _turn_has_task_local_progress,
    compare_arc_runs,
    project_arc_summary,
    write_arc_method_evolution_audit,
)


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


def test_arc_public_state_fingerprint_uses_environment_state_not_runtime_counters():
    first = {
        "frames": [[[1, 2], [3, 4]]], "state": "PLAYING", "levels_completed": 1,
        "win_levels": 4, "available_actions": ["ACTION2", "ACTION1"],
        "agent_available_actions": ["RESET", "ACTION2", "ACTION1"], "full_reset": False,
        "action_budget": {"used": 1},
    }
    same_state_later = {**first, "action_budget": {"used": 99}}
    changed_frame = {**first, "frames": [[[1, 2], [3, 9]]]}
    one = public_state_fingerprint(first)
    two = public_state_fingerprint(same_state_later)
    three = public_state_fingerprint(changed_frame)
    assert one["fingerprint"] == two["fingerprint"]
    assert one["fingerprint"] != three["fingerprint"]
    assert len(one["fingerprint"]) == 64


def test_arc_bridge_persists_versioned_pre_action_state_without_runtime_counters(tmp_path):
    from autoresearch_pi.arc_agi_3_bridge import ArcBridge

    (tmp_path / ".task-scope.json").write_text(json.dumps({
        "format": "task-local-scope-v1", "task_id": "arc:test",
        "root": str(tmp_path.resolve()), "root_fingerprint": "root-fingerprint",
        "createdAt": "2026-01-01T00:00:00Z",
    }), encoding="utf-8")
    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    frame = {
        "frames": [[[1, 2], [3, 4]]], "state": "PLAYING", "levels_completed": 1,
        "win_levels": 4, "available_actions": ["ACTION1"],
        "agent_available_actions": ["RESET", "ACTION1"], "full_reset": False,
        "action_budget": {"used": 7},
    }
    summary = bridge._persist_pre_action_state(frame, attempted_index=3)
    assert summary["resource_ref"] == "pre_action_state:arc-pre-action-3@v1"
    record = json.loads((tmp_path / "pre-action-states.jsonl").read_text())
    assert record["state_id"] == "arc-pre-action-3"
    assert record["fingerprint"] == summary["fingerprint"]
    assert "action_budget" not in record["public_state"]
    assert record["task_id"] == "arc:test"


def test_arc_environment_error_keeps_underlying_fetch_diagnostics():
    cause = OSError("fetch failed")
    error = RuntimeError("SDK request failed")
    error.__cause__ = cause
    details = exception_details(error)
    wrapped = ArcEnvironmentError("step", details)

    assert wrapped.operation == "step"
    assert details["type"] == "RuntimeError"
    assert details["message"] == "SDK request failed"
    assert details["cause"]["type"] == "OSError"
    assert details["cause"]["message"] == "fetch failed"
    assert "traceback" in details


def test_arc_bridge_records_inflight_and_failed_environment_step(tmp_path):
    class FailingAction:
        name = "ACTION1"
        action_data = SimpleNamespace(model_dump=lambda: {})

        def is_complex(self):
            return False

    class FakeGameAction:
        @classmethod
        def from_name(cls, name):
            assert name == "ACTION1"
            return FailingAction()

    class FailingEnvironment:
        def step(self, *_args, **_kwargs):
            raise OSError("fetch failed")

    class Adapter:
        def record_action(self, _name):
            raise AssertionError("failed environment calls must not consume an action")

    from autoresearch_pi.arc_agi_3_bridge import ArcBridge

    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    bridge.closed = False
    bridge.actions = 0
    bridge.max_actions = 10
    bridge.level_action_counts = [0]
    bridge.baseline_actions = []
    bridge.game_action = FakeGameAction
    bridge.environment = FailingEnvironment()
    bridge.adapter = Adapter()
    bridge._lock = __import__("threading").Lock()
    bridge._events = []
    bridge._events_lock = __import__("threading").Lock()
    bridge._disk_events_available = True
    bridge._frame = lambda: {
        "state": "PLAYING", "levels_completed": 0,
        "agent_available_actions": ["ACTION1"], "frames": [],
    }

    with pytest.raises(ArcEnvironmentError):
        bridge.step({"action": "ACTION1"})
    events = bridge.events()["events"]
    assert [event["event"] for event in events] == ["environment_call_started", "environment_error"]
    assert events[-1]["error"]["message"] == "fetch failed"
    assert events[-1]["retryable"] is False


def test_arc_bridge_treats_sdk_none_step_as_uncertain_environment_failure(tmp_path):
    """The official remote wrapper swallows request errors and returns None."""
    class FailingAction:
        name = "ACTION1"
        action_data = SimpleNamespace(model_dump=lambda: {})

        def is_complex(self):
            return False

    class FakeGameAction:
        @classmethod
        def from_name(cls, _name):
            return FailingAction()

    class SwallowingEnvironment:
        def step(self, *_args, **_kwargs):
            return None

    class Adapter:
        def record_action(self, _name):
            raise AssertionError("an uncertain SDK result must not consume an action")

    from autoresearch_pi.arc_agi_3_bridge import ArcBridge

    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    bridge.closed = False
    bridge.actions = 0
    bridge.max_actions = 10
    bridge.level_action_counts = [0]
    bridge.baseline_actions = []
    bridge.game_action = FakeGameAction
    bridge.environment = SwallowingEnvironment()
    bridge.adapter = Adapter()
    bridge._lock = __import__("threading").Lock()
    bridge._events = []
    bridge._events_lock = __import__("threading").Lock()
    bridge._disk_events_available = True
    bridge._frame = lambda: {
        "state": "PLAYING", "levels_completed": 0,
        "agent_available_actions": ["ACTION1"], "frames": [],
    }

    with pytest.raises(ArcEnvironmentError):
        bridge.step({"action": "ACTION1"})
    assert bridge.actions == 0
    events = bridge.events()["events"]
    assert [event["event"] for event in events] == ["environment_call_started", "environment_error"]
    assert events[-1]["error"]["type"] == "EnvironmentReturnedNoFrame"
    assert events[-1]["retryable"] is False


def test_arc_pi_bridge_client_preserves_fetch_cause_and_inflight_boundary():
    from test_pi_external_benchmark_native import _pi_cli

    project = Path(__file__).resolve().parents[1]
    node, _ = _pi_cli()
    module = (project / "demo" / "pi_arc_bridge_client.ts").as_uri()
    script = f"""
globalThis.fetch = async (url) => {{
  if (String(url).includes('/events?')) return new Response(JSON.stringify({{
    events: [{{event:'environment_call_started', operation:'step', action:'ACTION4', attempted_index:4}}], next: 1
  }}), {{status: 200, headers: {{'content-type':'application/json'}}}});
  const cause = new Error('socket reset by peer');
  cause.code = 'ECONNRESET';
  throw new TypeError('fetch failed', {{cause}});
}};
const mod = await import({json.dumps(module)});
try {{ await mod.bridge('/action', {{action:'ACTION4'}}); }}
catch (error) {{ console.log(error.message); }}
"""
    env = os.environ.copy()
    env["PI_ARC_BRIDGE_URL"] = "http://127.0.0.1:1"
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=project, env=env, text=True, capture_output=True,
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["format"] == "arc-bridge-client-error-v1"
    assert payload["error"]["message"] == "fetch failed"
    assert payload["error"]["cause"]["code"] == "ECONNRESET"
    assert payload["last_environment_boundary"]["action"] == "ACTION4"
    assert payload["retryable"] is False


def test_arc_validation_window_preserves_agent_requested_action_count():
    window = _open_research_validation_window({
        "hypothesis_id": "long-window",
        "validation_window": {"actions": 1000},
    }, action_index=1)
    assert window is not None
    assert window["action_limit"] == 1000


def test_arc_frame_delta_reports_only_changed_cells_and_bounds():
    before = {"frames": [[ [0, 0, 0], [0, 0, 0] ]]}
    after = {"frames": [[ [0, 1, 0], [0, 0, 2] ]]}
    assert frame_delta(before, after) == {
        "changed_cells": 2,
        "frame_available": True,
        "bbox": {"top": 0, "left": 1, "bottom": 1, "right": 2},
        "cells": [
            {"row": 0, "col": 1, "value": 1},
            {"row": 1, "col": 2, "value": 2},
        ],
        "cells_truncated": False,
    }


def test_arc_action_budget_matches_official_baseline_multiplier():
    assert derive_action_budget([22, 123, 73, 84, 96, 192, 186]) == 3880


def test_arc_model_settings_do_not_add_a_local_output_token_limit():
	settings = resolve_model_settings({})
	assert "max_tokens" not in settings
	assert "ARC_MAX_OUTPUT_TOKENS" not in str(settings)


def test_arc_runner_stops_at_total_action_budget_boundary():
    assert _arc_terminal_or_budget_exhausted({
        "state": "NOT_FINISHED",
        "action_budget": {"used": 12, "maximum": 123, "total_used": 40, "total_maximum": 40},
    }) is True


def test_arc_runner_does_not_add_local_turn_rotation_or_context_caps():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    assert "ARC_LONG_TURN_ROTATION_SECONDS" not in source
    assert "long_turn_rotations" not in source
    assert "ARC_CONTEXT_MAX_CHARS" not in source
    assert "consecutive_provider_errors >= 3" not in source
    # Session rotation remains available only for the provider's explicit
    # length-stop recovery path, not as a wall-clock/no-action policy.
    assert "kernel.new_session()" in source


def test_arc_action_progress_reads_projected_and_raw_transition_shapes():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    assert "raw_details.get(\"public_transition\")" in source
    assert "evidence.get(\"public_transition\")" in source
    assert _arc_terminal_or_budget_exhausted({
        "state": "NOT_FINISHED",
        "action_budget": {"used": 123, "maximum": 123, "total_used": 123, "total_maximum": 3880},
    }) is True


def test_arc_recovery_preserves_progress_intervention_and_reset_epoch_policy():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    prompt_root = Path(__file__).resolve().parents[1] / "demo" / "prompts"
    decision_prompt = (prompt_root / "arc_decision_cycle.md").read_text(encoding="utf-8")
    length_prompt = (prompt_root / "arc_length_recovery.md").read_text(encoding="utf-8")
    liveness_prompt = (prompt_root / "arc_liveness_recovery.md").read_text(encoding="utf-8")
    assert "not a global action-stopping rule" in decision_prompt
    assert "validation_window" in source
    assert "auto_research" in length_prompt
    assert "A completed research or harness operation is recovery progress" in length_prompt
    assert "auto_research" in liveness_prompt
    assert "consecutive_length_responses = 0" in source
    assert 'recovery_phase = "normal"' in source
    assert '"type": "arc_recovery_phase"' in source
    assert "recovery_turn_without_arc_action" not in source
    assert "consecutive_no_action_turns >= 2" not in source


def test_arc_recovery_accepts_research_before_the_final_action():
    research = [{"type": "tool_execution_end", "toolName": "auto_research", "isError": False}]
    harness = [{"type": "tool_execution_end", "toolName": "task_memory", "isError": False}]
    action = [{"type": "tool_execution_end", "toolName": "arc_action", "isError": False}]

    assert _advance_arc_recovery_phase("compact_recovery", research) == "research_returned"
    assert _advance_arc_recovery_phase("research_returned", []) == "awaiting_action"
    assert _advance_arc_recovery_phase("research_returned", harness) == "awaiting_action"
    assert _advance_arc_recovery_phase("awaiting_action", action) == "normal"


def test_arc_does_not_hard_stop_after_actions_without_level_advancement():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    extension = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "consecutive_nonadvancing_actions >= 8" not in source
    assert "nonadvancing_action_interventions" not in source
    assert "reconstructionRequired" not in extension
    assert "SELF_HARNESS_PRELUDE_REQUIRED" not in extension
    assert "validation_window" in extension


def test_research_validation_window_expires_without_blocking_action():
    window = _open_research_validation_window(
        {
            "hypothesis_id": "H-test",
            "hypothesis": "A probe changes the target",
            "prediction": "changed_cells > 0",
            "falsifier": "no target delta",
            "validation_window": {"actions": 3, "expected": "target delta", "on_expiry": "falsify"},
        },
        action_index=10,
    )
    assert window is not None
    assert window["actions_used"] == 1
    window, expired = _advance_research_validation_window(
        window, action_index=11, action_name="ACTION1", changed_cells=2, level_changed=False,
    )
    assert expired is None
    assert window is not None and window["actions_used"] == 2
    window, expired = _advance_research_validation_window(
        window, action_index=12, action_name="ACTION2", changed_cells=4, level_changed=False,
    )
    assert window is None
    assert expired is not None
    assert expired["status"] == "awaiting_assessment"
    assert expired["outcome"] == "unassessed"
    assert expired["assessment_required"] is True


def test_repeated_hypothesis_id_continues_one_validation_window():
    from autoresearch_pi.arc_agi_3_e2e import _same_research_validation_window

    decision = {
        "hypothesis_id": "H-stable", "hypothesis_version": 1,
        "hypothesis": "refined words do not reset identity", "prediction": "a delta",
        "validation_window": {"actions": 3},
    }
    active = _open_research_validation_window(decision, action_index=1)
    repeated = _open_research_validation_window(
        {**decision, "hypothesis": "another wording"}, action_index=2,
    )
    assert _same_research_validation_window(active, repeated, decision)
    continued, expired = _advance_research_validation_window(
        active, action_index=2, action_name="ACTION2", changed_cells=3, level_changed=False,
    )
    assert expired is None and continued["actions_used"] == 2
    assert not _same_research_validation_window(
        continued,
        _open_research_validation_window({**decision, "hypothesis_version": 2}, action_index=3),
        {**decision, "hypothesis_version": 2},
    )


def test_one_action_validation_window_immediately_awaits_assessment_with_evidence():
    window = _open_research_validation_window({
        "hypothesis_id": "H-one", "hypothesis": "one probe", "prediction": "delta",
        "validation_window": {"actions": 1},
    }, action_index=7, action_name="ACTION3", changed_cells=2, level_changed=False)
    active, expired = _expire_research_validation_window_if_consumed(window, action_index=7)
    assert active is None
    assert expired["status"] == "awaiting_assessment"
    assert expired["evidence"] == [{
        "action_index": 7, "action": "ACTION3", "changed_cells": 2, "level_changed": False,
    }]


def test_arc_harness_validation_requires_sequential_evidence_backed_lifecycle():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    prompt = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "arc_harness_validation.md").read_text(encoding="utf-8")
    assert "ONE AT A TIME" in prompt
    assert "CREATE/APPLY -> USE ON A REAL CURRENT ARC OBSERVATION" in prompt
    assert "REVISE TO VERSION 2" in prompt
    assert "USE VERSION 2 -> VERIFY" in prompt
    assert "record that result and retire it" in prompt
    assert _arc_terminal_or_budget_exhausted({
        "state": "WIN",
        "action_budget": {"used": 1, "maximum": 123, "total_used": 1, "total_maximum": 3880},
    }) is True


def test_arc_runner_requests_reset_after_game_over_while_budget_remains():
    prompt = _arc_continuation_prompt({
        "state": "GAME_OVER",
        "action_budget": {"total_used": 10, "total_maximum": 40},
    }, truncated=False)
    assert "GAME_OVER" in prompt
    assert "action='RESET'" in prompt
    assert "memory and research findings" in prompt


def test_arc_adapter_delegates_task_local_entry_to_shared_extension():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "externalBenchmarkResearch" in source
    assert "baseTools: [\"arc_state\", \"arc_action\", \"inspect_arc_trajectory\"]" in source
    assert "HARNESS_BOOTSTRAP_TOOL" not in source
    assert "research_resource" not in source


def test_arc_adapter_keeps_harness_creation_agent_owned():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "installArcTaskSubagents" in source
    assert "externalBenchmarkResearch" in source


def test_arc_action_marks_exhausted_budget_as_terminal_without_followup_reads():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "totalUsed >= totalMaximum" in source
    assert 'terminal_reason: "total_action_budget_exhausted"' in source
    assert "Do not call environment actions or research again" in source
    assert "final read-only level retrospective" in source


def test_arc_state_deduplicates_full_frame_within_same_action_epoch():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "repeatedFullRequest" in source
    assert "request='full' retrieves it again" in source
    assert 'const full = request === "full"' in source
    assert "before_agent_start" in source
    assert "${ARC_SYSTEM_PROMPT}\\n\\n${event.systemPrompt}" in source
    assert "SELF-HARNESS PRELUDE STATUS: completed for this task" not in source
    assert "durableSelfHarnessPreludeCompleted()" in source


def test_arc_adapter_requests_only_arc_tools_as_benchmark_base_tools():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert '"arc_state", "arc_action"' in source


def test_arc_exposes_execution_checkpoint_without_preloading_task_resources():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_external_benchmark_research.ts").read_text(encoding="utf-8")
    assert 'const core = ["task_harness", "task_harness_status", "task_checkpoint", "task_resource", "task_validation"]' in source
    assert '"task_checkpoint"' in source
    assert "initial_resource_counts" in source


def test_arc_action_can_persist_a_bounded_decision_capsule():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert 'decision: Type.Optional(Type.Object({' in source
    assert 'hypothesis_id' in source
    assert 'falsifier' in source
    research_source = (Path(__file__).resolve().parents[1] / "demo" / "pi_external_benchmark_research.ts").read_text(encoding="utf-8")
    assert "decision_capsule" in research_source


def test_arc_effect_ledger_preserves_common_mode_and_action_specific_candidates():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert 'action_invariant_candidate' in source
    assert 'action_conditioned_candidate' in source
    assert 'distinct_effects' in source


def test_arc_extension_stops_the_pi_turn_at_the_action_result_boundary():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert 'pi.on("tool_result"' in source
    assert 'event.toolName === "arc_action"' in source
    assert "terminate: true" in source
    assert "ctx.abort()" in source
    assert '"inspect_arc_trajectory"]' in source
    assert 'baseTools:' in source


def test_arc_adapter_does_not_prescribe_game_strategy():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    assert "repeated state changes as evidence for a later choice" not in source
    assert "pause to consider whether the stable pattern" not in source


def test_arc_adapter_does_not_prescribe_harness_lifecycle():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_arc_agi_3_extension.ts").read_text(encoding="utf-8")
    for marker in ("three repeated non-advancing outcomes", "choose at least one appropriate component", "research is not a required gate"):
        assert marker not in source


def test_arc_runner_starts_with_clean_pi_capabilities():
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    assert '"--no-skills"' in source
    assert '"--exclude-tools", "bash,edit,write,grep,find,ls,read"' in source


def test_arc_allows_bounded_harness_work_without_counting_it_as_game_progress():
    assert _turn_has_task_local_progress([{
        "type": "tool_execution_end", "toolName": "task_skill", "isError": False,
    }]) is True
    assert _turn_has_task_local_progress([{
        "type": "tool_execution_end", "toolName": "arc_state", "isError": False,
    }]) is False
    source = (Path(__file__).resolve().parents[1] / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py").read_text(encoding="utf-8")
    followup = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "arc_followup.md").read_text(encoding="utf-8")
    assert "ARC decision-cycle contract" in followup
    assert "finishes with exactly one available arc_action" in followup
    assert "harness_turns_since_action" not in source
    assert "consecutive_no_action_turns" not in source


def test_task_harness_enable_accepts_research_alias():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_task_local_self_harness.ts").read_text(encoding="utf-8")
    assert 'research: "research_resource"' in source


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


def test_arc_adapter_scopes_model_settings_without_a_local_output_limit():
    settings = resolve_model_settings({
        "ARC_OPENAI_API_BASE": "https://arc.example/v1",
        "ARC_OPENAI_API_KEY": "arc-key",
        "ARC_MODEL": "gpt-5.6-sol",
        "ARC_INPUT_MODALITIES": "text,image",
        "EXEC_MODEL": "ignored",
    })
    assert settings["base_url"] == "https://arc.example/v1"
    assert settings["api_key"] == "arc-key"
    assert settings["model"] == "gpt-5.6-sol"
    assert settings["context_window"] == 175_000
    assert "max_tokens" not in settings
    assert settings["pi_api"] == "openai-responses"
    assert settings["input_modalities"] == ["text", "image"]


def test_arc_system_instructions_stay_system_on_pi_wire(tmp_path, monkeypatch):
    from autoresearch_pi import arc_agi_3_e2e as runner

    node, cli = runner._resolve_pi_cli()
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {
        "ARC_OPENAI_API_BASE": "https://yibuapi.com/v1",
        "ARC_OPENAI_API_KEY": "test-only",
        "ARC_MODEL": "a:deepseek-v4-flash",
    })

    class ConfigWritten(Exception):
        pass

    def stop_before_launch(*args, **kwargs):
        raise ConfigWritten

    monkeypatch.setattr(runner, "PiKernel", stop_before_launch)
    with pytest.raises(ConfigWritten):
        runner._run_pi(tmp_path, bridge_url="http://127.0.0.1:1", game="test",
                       variant="treatment", context_compaction=False)
    config_path = tmp_path / ".pi-agent" / "models.json"
    sdk = (Path(cli).parent.parent / "node_modules" / "@earendil-works"
           / "pi-ai" / "dist" / "api" / "openai-completions.js")
    script = """
import fs from 'node:fs';
const {convertMessages} = await import(process.argv[1]);
const provider = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).providers.yibu;
const model = {...provider.models[0], provider: 'yibu', api: provider.api,
    baseUrl: provider.baseUrl, compat: provider.compat};
const messages = convertMessages(model, {
    systemPrompt: 'Follow the task rules.',
    messages: [{role: 'user', content: 'Solve this task.', timestamp: 1}],
}, provider.compat);
console.log(JSON.stringify(messages));
"""
    result = subprocess.run([node, "--input-type=module", "-e", script,
                             sdk.as_uri(), str(config_path)],
                            check=True, capture_output=True, text=True)
    messages = json.loads(result.stdout)
    assert [message["role"] for message in messages] == ["system", "user"]
    assert messages[0]["content"] == "Follow the task rules."
    assert messages[1]["content"] == "Solve this task."


def test_arc_provider_input_modalities_are_configurable(tmp_path, monkeypatch):
    from autoresearch_pi import arc_agi_3_e2e as runner

    node, cli = runner._resolve_pi_cli()
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {
        "ARC_OPENAI_API_BASE": "https://yibuapi.com/v1",
        "ARC_OPENAI_API_KEY": "test-only",
        "ARC_MODEL": "vision-model",
    })

    class ConfigWritten(Exception):
        pass

    def stop_before_launch(*args, **kwargs):
        raise ConfigWritten

    monkeypatch.setattr(runner, "PiKernel", stop_before_launch)
    with pytest.raises(ConfigWritten):
        runner._run_pi(
            tmp_path, bridge_url="http://127.0.0.1:1", game="test",
            variant="treatment", context_compaction=False,
            input_modalities="text,image",
        )
    config = json.loads((tmp_path / ".pi-agent" / "models.json").read_text(encoding="utf-8"))
    assert config["providers"]["yibu"]["models"][0]["input"] == ["text", "image"]


def test_arc_provider_input_modalities_reject_unknown_values():
    from autoresearch_pi.arc_agi_3_adapter import resolve_input_modalities

    with pytest.raises(ValueError, match="unsupported ARC input modality"):
        resolve_input_modalities("text,audio")


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
    (tmp_path / "execution-signals.jsonl").write_text(
        json.dumps({"signal_id": "execution-signal-1", "observation_id": "execution-observation-1"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "pattern-candidates.jsonl").write_text(
        json.dumps({"candidate_id": "pattern-candidate-1", "version": 1, "kind": "repeated_success"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "effect-assessments.jsonl").write_text(
        json.dumps({"effect_assessment_id": "assessment-1", "verdict": "supported"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "task-memory.jsonl").write_text(
        json.dumps({"memory_id": "memory-1", "key": "state", "version": 1, "status": "active"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "task-skills.jsonl").write_text(
        json.dumps({"skill_id": "skill-1", "name": "probe", "version": 1, "status": "active"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "task-tools.jsonl").write_text(
        json.dumps({"tool_id": "tool-1", "name": "digest", "version": 1, "status": "active", "implementation_ref": "task.local.program"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "task-tool-events.jsonl").write_text(
        json.dumps({"event": "registered", "name": "digest", "version": 1}) + "\n"
        + json.dumps({"event": "invoked", "name": "digest", "version": 1, "status": "completed"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "task-subagents.jsonl").write_text(
        json.dumps({"agent_id": "subagent-1", "name": "critic", "version": 1, "status": "active"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "subagent-invocations.jsonl").write_text(
        json.dumps({"invocation_id": "subagent-invocation-1", "agent_name": "critic"}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "auto-research-runs.jsonl").write_text(
        json.dumps({
            "run_id": "auto-research-1", "version": 1, "status": "completed",
            "scope": "hypothesis", "question": "q" * 4000,
            "summary": "Bounded conclusion.",
            "report_ref": "research_report:auto-research-1@v1",
            "finding_count": 2, "proposal_count": 1,
            "result_summary": {"stop_reason": "submitted_report", "usage": {"output": 321}},
        }) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "pi-events.jsonl").write_text(
        json.dumps({"type": "message_end", "message": {"stopReason": "error", "errorMessage": "provider unavailable"}}) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "provider-telemetry.jsonl").write_text(
        json.dumps({
            "event": "provider_request", "payload_json_chars": 100,
            "message_count": 2, "system_message_json_chars": 40,
            "tool_result_json_chars": 10, "tool_definition_json_chars": 20,
        }) + "\n" + json.dumps({
            "event": "provider_response", "latency_ms": 7,
        }) + "\n" + json.dumps({
            "event": "assistant_message", "elapsed_ms": 12, "stop_reason": "toolUse",
        }) + "\n",
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
        "evaluation_complete": True,
    }
    assert summary["self_harness_evaluation"]["supported_effect_assessments"] == 1
    assert summary["self_harness_evaluation"]["harness_improved"] is None
    assert summary["runtime"]["provider_error_count"] == 1
    assert summary["runtime"]["last_provider_error"] == "provider unavailable"
    assert summary["runtime"]["run_complete"] is True
    assert summary["runtime"]["completion_status"] == "completed"
    assert summary["passed"] is True
    assert summary["task_local_resources"]["memory"]["version_count"] == 1
    assert "system_prompt" in summary["task_local_resources"]
    assert summary["task_local_resources"]["skills"]["latest"][0]["name"] == "probe"
    assert summary["task_local_resources"]["tools"]["version_count"] == 1
    assert summary["task_local_resources"]["tools"]["invocation_count"] == 1
    assert summary["task_local_resources"]["tools"]["latest"][0]["name"] == "digest"
    assert summary["task_local_resources"]["subagents"]["invocation_count"] == 1
    assert summary["research"]["execution_signal_count"] == 1
    assert summary["research"]["pattern_candidate_versions"] == 1
    assert summary["research"]["latest_pattern_candidates"][0]["candidate_id"] == "pattern-candidate-1"
    auto_research = summary["research"]["auto_research"]
    assert auto_research["run_count"] == 1
    assert auto_research["latest"] == [{
        "run_id": "auto-research-1", "version": 1, "status": "completed",
        "scope": "hypothesis", "summary": "Bounded conclusion.",
        "report_ref": "research_report:auto-research-1@v1",
        "finding_count": 2, "proposal_count": 1, "output_tokens": 321,
    }]
    assert "q" * 200 not in json.dumps(summary)
    assert summary["provider_telemetry"]["main"]["request_count"] == 1
    assert summary["provider_telemetry"]["main"]["payload_json_chars"]["first"] == 100
    assert summary["provider_telemetry"]["main"]["response_latency_ms"]["first"] == 7
    assert summary["provider_telemetry"]["subagents"]["record_count"] == 0
    assert summary["native_skills"]["latest_skill_count"] == 0
    assert summary["artifacts"]["bridge_events"] == "bridge-events.jsonl"
    assert summary["artifacts"]["task_subagents"] == "task-subagents.jsonl"
    assert summary["artifacts"]["execution_signals"] == "execution-signals.jsonl"
    assert summary["artifacts"]["pattern_candidates"] == "pattern-candidates.jsonl"
    assert summary["artifacts"]["provider_telemetry"] == "provider-telemetry.jsonl"
    assert summary["artifacts"]["auto_research_reports"] == "auto-research-reports.jsonl"


def test_arc_summary_proves_all_five_auto_research_routes_were_materialized_and_used(tmp_path):
    resources = {
        "task-memory.jsonl": {"memory_id": "memory-1", "key": "arc-fact", "version": 1, "status": "active"},
        "task-skills.jsonl": {"skill_id": "skill-1", "name": "arc-procedure", "version": 1, "status": "active"},
        "task-tools.jsonl": {"tool_id": "tool-1", "name": "arc-diff", "version": 1, "status": "active"},
        "task-subagents.jsonl": {"agent_id": "agent-1", "name": "arc-critic", "version": 1, "status": "active"},
        "task-system-prompt.jsonl": {"segment_id": "prompt-1", "name": "arc-invariant", "version": 1, "status": "active"},
    }
    for name, record in resources.items():
        (tmp_path / name).write_text(json.dumps(record) + "\n", encoding="utf-8")
    routed = [
        ("task_memory", "memory:arc-fact@v1"),
        ("task_skill", "skill:arc-procedure@v1"),
        ("task_tool", "tool:arc-diff@v1"),
        ("task_subagent", "subagent:arc-critic@v1"),
        ("task_system_prompt", "system_prompt:arc-invariant@v1"),
    ]
    (tmp_path / "auto-research-harness-route-receipts.jsonl").write_text(
        "".join(json.dumps({
            "route_id": f"auto-research-1:route-{index}", "native_tool": native_tool,
            "status": "applied", "applied": True, "resource_ref": resource_ref,
            "recordedAt": "2026-09-16T00:00:00.000Z",
        }) + "\n" for index, (native_tool, resource_ref) in enumerate(routed, 1)),
        encoding="utf-8",
    )
    (tmp_path / "task-harness-context-exposures.jsonl").write_text(json.dumps({
        "memory_versions": [{"memory_id": "memory-1", "version": 1}],
        "skill_versions": [{"name": "arc-procedure", "version": 1}],
        "system_prompt_versions": [{"name": "arc-invariant", "version": 1}],
        "task_tools": [{"name": "arc-diff", "version": 1}],
        "subagents": [{"name": "arc-critic", "version": 1}],
        "recordedAt": "2026-09-16T00:00:01.000Z",
    }) + "\n", encoding="utf-8")
    (tmp_path / "task-tool-events.jsonl").write_text(json.dumps({
        "event": "invoked", "name": "arc-diff", "version": 1,
        "status": "completed", "semantic_effect_observed": True,
        "recordedAt": "2026-09-16T00:00:02.000Z",
    }) + "\n", encoding="utf-8")
    (tmp_path / "subagent-invocations.jsonl").write_text(json.dumps({
        "invocation_id": "invocation-1", "agent_name": "arc-critic", "status": "completed",
        "result": {"text": "The critic returned a semantic counterexample."},
        "recordedAt": "2026-09-16T00:00:02.000Z",
    }) + "\n", encoding="utf-8")

    summary = project_arc_summary(
        tmp_path, game="ls20", variant="treatment",
        bridge_result={"terminal_state": "NOT_FINISHED", "levels_completed": 0, "actions": 0},
        scorecard={}, pi_returncode=0, timed_out=False, auto_research_validation=True,
    )

    closure = summary["research"]["auto_research_harness_closure"]
    assert closure["required_components"] == ["system_prompt", "skills", "memory", "tools", "subagents"]
    assert closure["complete"] is True
    assert all(item["route_applied"] and item["materialized"] and item["used_after_route"]
               for item in closure["components"].values())


def test_method_evolution_audit_requires_one_reference_consistent_online_chain():
    from autoresearch_pi.arc_agi_3_e2e import _method_evolution_audit

    method = {
        "method_id": "move-rule", "version": 1, "maturity": "candidate_method",
        "source_report_ref": "research_report:research-1@v1",
        "research_line_ref": "research_line:movement@v1",
        "candidate_ref": "candidate:move-rule@v1",
        "generalization_basis": "cross_context",
        "generalization_scope": "cross_situation_within_episode",
        "construction_evidence_refs": ["observation-1", "observation-2"],
        "context_ids": ["situation-a", "situation-b"],
        "episode_context_ids": ["episode-1"],
        "method": {"invariants": ["i"], "parameters": ["p"], "steps": ["s"], "falsifier": "f"},
        "resource_refs": [], "application_refs": [], "validation_refs": [],
        "recordedAt": "2026-01-01T00:00:02Z",
    }
    adopted = {**method, "version": 2, "maturity": "trial",
               "resource_refs": ["skill:move-rule@v1"],
               "application_refs": ["research_adoption:research-1:call-1"]}
    assessed = {**adopted, "version": 3, "maturity": "validated_within_scope",
                "validation_refs": ["effect_assessment:assessment-1@v1"],
                "actual_use_observation_refs": ["observation-3"]}
    observations = [
        {"observation_id": "observation-1", "tool_name": "arc_action", "input": {"action": "ACTION1"}},
        {"observation_id": "observation-2", "tool_name": "arc_action", "input": {"action": "ACTION1"}},
        {"observation_id": "observation-3", "tool_name": "arc_action", "is_error": False,
         "input": {"action": "ACTION2", "decision": {
             "basis_refs": ["skill:move-rule@v1"], "prediction": "visible change", "falsifier": "no change"}},
         "recordedAt": "2026-01-01T00:00:04Z"},
    ]
    audit = _method_evolution_audit(
        methods=[method, adopted, assessed], comparisons=[{
            "run_id": "research-1", "repeated_cases": [{"cases": [
                {"observation_ref": "observation-1", "situation_context_id": "situation-a"},
                {"observation_ref": "observation-2", "situation_context_id": "situation-b"},
            ]}],
        }], observations=observations,
        assessments=[{"effect_assessment_id": "assessment-1", "observation_refs": ["observation-3"],
                      "recordedAt": "2026-01-01T00:00:05Z"}],
        handoffs=[{
            "handoff_id": "feedback-1", "status": "completed",
            "research_line_ref": "research_line:movement@v1",
            "method_ref": "method:move-rule@v3",
            "effect_assessment_ref": "effect_assessment:assessment-1@v1",
                "run_id": "research-2",
                "report_ref": "research_report:research-2@v1",
                "recordedAt": "2026-01-01T00:00:06Z",
            }],
            reports=[
                {"run_id": "research-1", "version": 1, "status": "completed",
                 "research_line_ref": "research_line:movement@v1",
                 "report": {"status": "supported_within_scope", "conclusion": "bounded rule",
                            "evidence_refs": ["observation-1", "observation-2"]}},
                {"run_id": "research-2", "version": 1, "research_line_ref": "research_line:movement@v1",
                 "report": {"evidence_refs": ["observation-3"]}},
        ],
        resource_accesses=[
            {"reader": "parent", "operation": "paged_read", "resource_ref": "skill:move-rule@v1",
             "recordedAt": "2026-01-01T00:00:03Z"},
            {"reader": "subagent", "operation": "paged_read", "research_run_id": "research-2",
             "resource_ref": "observation:observation-3@v1", "recordedAt": "2026-01-01T00:00:05.100Z"},
            {"reader": "subagent", "operation": "paged_read", "research_run_id": "research-2",
             "resource_ref": "effect_assessment:assessment-1@v1", "recordedAt": "2026-01-01T00:00:05.200Z"},
        ],
        harness_resources={"skill:move-rule@v1": {
            "instructions": "NEXT_ACTION: ACTION2\nPREDICTION: visible change\nFALSIFIER: no change",
        }},
    )
    assert audit["complete"] is True
    assert audit["complete_method_count"] == 1
    assert audit["first_incomplete_stage"] is None
    assert audit["chains"][0]["first_incomplete_stage"] is None
    assert all(stage["passed"] for stage in audit["chains"][0]["stages"].values())


def test_method_evolution_audit_requires_action_to_match_the_read_procedure_contract():
    from autoresearch_pi.arc_agi_3_e2e import _method_evolution_audit

    candidate = {
        "method_id": "rule", "version": 1, "maturity": "candidate_method",
        "source_report_ref": "research_report:research-1@v1",
        "research_line_ref": "research_line:rule@v1", "generalization_basis": "cross_context",
        "construction_evidence_refs": ["observation-1", "observation-2"],
        "context_ids": ["situation-a", "situation-b"],
        "method": {"invariants": ["i"], "parameters": ["p"], "steps": ["s"], "falsifier": "f"},
        "resource_refs": [], "application_refs": [], "validation_refs": [],
        "recordedAt": "2026-01-01T00:00:02Z",
    }
    adopted = {**candidate, "version": 2, "maturity": "trial",
               "resource_refs": ["skill:rule@v1"], "application_refs": ["adoption-1"]}
    reports = [{"run_id": "research-1", "version": 1, "status": "completed",
                "report": {"status": "supported_within_scope", "conclusion": "rule",
                           "evidence_refs": ["observation-1", "observation-2"]}}]
    base_observations = [
        {"observation_id": "observation-1", "tool_name": "arc_action"},
        {"observation_id": "observation-2", "tool_name": "arc_action"},
    ]
    access = [{"reader": "parent", "operation": "paged_read", "resource_ref": "skill:rule@v1",
               "recordedAt": "2026-01-01T00:00:03Z"}]
    resources = {"skill:rule@v1": {
        "instructions": "NEXT_ACTION: ACTION2\nPREDICTION: visible change\nFALSIFIER: no change",
    }}

    for action, prediction, expected in (
        ("ACTION1", "visible change", False),
        ("ACTION2", "different prediction", False),
        ("ACTION2", "visible change", True),
    ):
        audit = _method_evolution_audit(
            methods=[candidate, adopted], comparisons=[{
                "run_id": "research-1", "repeated_cases": [{"cases": [
                    {"observation_ref": "observation-1", "situation_context_id": "situation-a"},
                    {"observation_ref": "observation-2", "situation_context_id": "situation-b"},
                ]}],
            }], assessments=[], handoffs=[], reports=reports,
            observations=[*base_observations, {"observation_id": "observation-3", "tool_name": "arc_action",
                "is_error": False, "recordedAt": "2026-01-01T00:00:04Z",
                "input": {"action": action, "decision": {"basis_refs": ["skill:rule@v1"],
                    "prediction": prediction, "falsifier": "no change"}}}],
            resource_accesses=access, harness_resources=resources,
        )
        assert audit["chains"][0]["stages"]["actual_arc_use"]["passed"] is expected


def test_method_evolution_audit_does_not_count_standalone_tool_use_as_arc_use():
    from autoresearch_pi.arc_agi_3_e2e import _method_evolution_audit

    candidate = {
        "method_id": "rule", "version": 1, "maturity": "candidate_method",
        "source_report_ref": "research_report:research-1@v1",
        "research_line_ref": "research_line:rule@v1", "generalization_basis": "cross_context",
        "construction_evidence_refs": ["observation-1", "observation-2"],
        "context_ids": ["situation-a", "situation-b"],
        "method": {"invariants": ["i"], "parameters": ["p"], "steps": ["s"], "falsifier": "f"},
        "resource_refs": [], "application_refs": [], "validation_refs": [],
        "recordedAt": "2026-01-01T00:00:02Z",
    }
    adopted = {**candidate, "version": 2, "maturity": "trial",
               "resource_refs": ["tool:rule@v1"], "application_refs": ["adoption-1"]}
    audit = _method_evolution_audit(
        methods=[candidate, adopted], comparisons=[{
            "run_id": "research-1", "repeated_cases": [{"cases": [
                {"observation_ref": "observation-1", "situation_context_id": "situation-a"},
                {"observation_ref": "observation-2", "situation_context_id": "situation-b"},
            ]}],
        }],
        observations=[
            {"observation_id": "observation-1", "tool_name": "arc_action", "input": {}},
            {"observation_id": "observation-2", "tool_name": "arc_action", "input": {}},
            {"observation_id": "tool-use-1", "tool_name": "task_tool_rule_v1", "input": {}},
            {"observation_id": "observation-3", "tool_name": "arc_action", "input": {"decision": {}},
             "recordedAt": "2026-01-01T00:00:04Z"},
        ],
        assessments=[], handoffs=[],
        reports=[{"run_id": "research-1", "version": 1, "status": "completed",
                  "research_line_ref": "research_line:rule@v1",
                  "report": {"status": "supported_within_scope", "conclusion": "bounded rule",
                             "evidence_refs": ["observation-1", "observation-2"]}}],
    )
    chain = audit["chains"][0]
    assert audit["complete"] is False
    assert chain["first_incomplete_stage"] == "actual_arc_use"
    assert chain["stages"]["actual_arc_use"]["passed"] is False


def test_method_evolution_audit_does_not_mistake_prepared_comparison_for_induction():
    from autoresearch_pi.arc_agi_3_e2e import _method_evolution_audit

    audit = _method_evolution_audit(
        methods=[], assessments=[], handoffs=[], reports=[],
        observations=[
            {"observation_id": "observation-1", "tool_name": "arc_action"},
            {"observation_id": "observation-2", "tool_name": "arc_action"},
        ],
        comparisons=[{
            "run_id": "research-1", "research_line_ref": "research_line:movement@v1",
            "selected_evidence_refs": ["observation-1", "observation-2"],
            "situation_context_ids": ["situation-a", "situation-b"],
            "episode_context_ids": ["episode-1"],
            "causal_interpretation": False, "semantic_equivalence_claimed": False,
        }],
    )
    assert audit["complete"] is False
    assert audit["cross_situation_material_ready"] is True
    assert audit["cross_situation_induction_observed"] is False
    assert audit["cross_situation_evidence_observed"] is False
    assert audit["first_incomplete_stage"] == "cross_situation_induction"
    assert audit["orphan_cross_situation_evidence"][0]["evidence_refs"] == [
        "observation-1", "observation-2",
    ]


def test_method_evolution_audit_counts_supported_cross_situation_report_before_method_candidate():
    from autoresearch_pi.arc_agi_3_e2e import _method_evolution_audit

    comparison = {
        "run_id": "research-1", "research_line_ref": "research_line:movement@v1",
        "selected_evidence_refs": ["observation-1", "observation-2"],
        "situation_context_ids": ["situation-a", "situation-b"],
        "repeated_cases": [{"cases": [
            {"observation_ref": "observation-1", "situation_context_id": "situation-a"},
            {"observation_ref": "observation-2", "situation_context_id": "situation-b"},
        ]}],
    }
    report = {
        "run_id": "research-1", "version": 1, "status": "completed",
        "research_line_ref": "research_line:movement@v1",
        "report": {"status": "supported_within_scope", "conclusion": "Shared bounded rule.",
                   "evidence_refs": ["observation-1", "observation-2"]},
    }
    audit = _method_evolution_audit(
        methods=[], comparisons=[comparison],
        observations=[{"observation_id": "observation-1"}, {"observation_id": "observation-2"}],
        assessments=[], handoffs=[], reports=[report],
    )
    assert audit["cross_situation_induction_observed"] is True
    assert audit["cross_situation_evidence_observed"] is True
    assert audit["first_incomplete_stage"] == "method_candidate"
    assert audit["cross_situation_inductions"][0]["report_ref"] == "research_report:research-1@v1"


def test_write_arc_method_evolution_audit_handles_interrupted_comparison_only_run(tmp_path):
    (tmp_path / "execution-observations.jsonl").write_text(
        "{\"observation_id\":\"observation-1\"}\n{\"observation_id\":\"observation-2\"}\n",
        encoding="utf-8",
    )
    (tmp_path / "auto-research-comparison-bundles.jsonl").write_text(json.dumps({
        "run_id": "research-1",
        "selected_evidence_refs": ["observation-1", "observation-2"],
        "situation_context_ids": ["situation-a", "situation-b"],
    }) + "\n", encoding="utf-8")

    path = write_arc_method_evolution_audit(tmp_path)
    audit = json.loads(path.read_text(encoding="utf-8"))

    assert path.name == "method-evolution-audit.json"
    assert audit["complete"] is False
    assert audit["cross_situation_material_ready"] is True
    assert audit["cross_situation_induction_observed"] is False
    assert audit["cross_situation_evidence_observed"] is False
    assert audit["first_incomplete_stage"] == "cross_situation_induction"


def test_method_evolution_audit_explains_rejected_delivery_without_promoting_it(tmp_path):
    (tmp_path / "execution-observations.jsonl").write_text(
        "{\"observation_id\":\"observation-1\"}\n{\"observation_id\":\"observation-2\"}\n",
        encoding="utf-8",
    )
    (tmp_path / "auto-research-comparison-bundles.jsonl").write_text(json.dumps({
        "run_id": "research-1", "selected_evidence_refs": ["observation-1", "observation-2"],
        "situation_context_ids": ["situation-a", "situation-b"],
    }) + "\n", encoding="utf-8")
    (tmp_path / "subagent-progress.jsonl").write_text(json.dumps({
        "research_run_id": "research-1", "event": "event",
        "last_tool_name": "submit_research_report", "is_error": True,
    }) + "\n", encoding="utf-8")
    (tmp_path / "auto-research-runs.jsonl").write_text(json.dumps({
        "run_id": "research-1", "status": "completed",
        "result_summary": {"stop_reason": "stalled"},
    }) + "\n", encoding="utf-8")

    audit = json.loads(write_arc_method_evolution_audit(tmp_path).read_text(encoding="utf-8"))

    assert audit["first_incomplete_stage"] == "cross_situation_induction"
    assert audit["cross_situation_material_ready"] is True
    assert audit["cross_situation_induction_observed"] is False
    assert audit["delivery_diagnostics"]["rejected_report_submission_count"] == 1
    assert audit["delivery_diagnostics"]["rejected_report_run_ids"] == ["research-1"]
    assert audit["delivery_diagnostics"]["stalled_run_ids"] == ["research-1"]


def test_real_arc_auto_research_validation_prompt_requires_evidence_backed_five_component_use():
    prompt = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "arc_auto_research_validation.md").read_text(encoding="utf-8")
    for token in ("system_prompt", "skills", "memory", "tools", "subagents"):
        assert token in prompt
    assert "route receipt" in prompt
    assert "next parent turn" in prompt
    assert "Do not invent evidence" in prompt


def test_partial_bridge_result_preserves_interrupted_action_metadata(tmp_path):
    (tmp_path / "bridge-events.jsonl").write_text(
        json.dumps({"event": "scorecard_opened", "scorecard_id": "card-1"}) + "\n"
        + json.dumps({"event": "action", "index": 1, "frame": {"state": "NOT_FINISHED", "levels_completed": 0}}) + "\n"
        + json.dumps({"event": "action", "index": 2, "frame": {"state": "PLAYING", "levels_completed": 1}}) + "\n",
        encoding="utf-8",
    )
    assert _partial_bridge_result(tmp_path) == {
        "terminal_state": "PLAYING", "levels_completed": 1, "actions": 2,
        "forced_actions": 0, "scorecard_id": "card-1", "partial": True,
    }


def test_arc_trace_compacts_duplicate_lifecycle_messages_but_keeps_usage_and_errors():
    event = {
        "type": "message_end",
        "message": {
            "role": "assistant", "content": [{"type": "text", "text": "x" * 100_000}],
            "stopReason": "error", "errorMessage": "provider unavailable",
            "usage": {"input": 12, "output": 3}, "provider": "test", "model": "model-a",
            "api": "openai-completions", "timestamp": 123,
        },
    }

    compact = _compact_arc_pi_event(event)

    assert compact == {
        "type": "message_end",
        "message": {
            "role": "assistant", "stopReason": "error",
            "errorMessage": "provider unavailable", "usage": {"input": 12, "output": 3},
            "provider": "test", "model": "model-a", "api": "openai-completions",
            "timestamp": 123,
        },
    }
    assert _compact_arc_pi_event({"type": "turn_end", "messages": [event]}) is None
    tool_event = {"type": "tool_execution_end", "toolName": "arc_action", "result": {"ok": True}}
    assert _compact_arc_pi_event(tool_event) is tool_event


def test_arc_provider_error_is_a_fail_fast_turn_boundary():
    from autoresearch_pi.arc_agi_3_e2e import _turn_provider_error

    assert _turn_provider_error([{
        "type": "message_end",
        "message": {"stopReason": "error", "errorMessage": "pre_consume_token_quota_failed"},
    }]) == "pre_consume_token_quota_failed"
    assert _turn_provider_error([{
        "type": "message_end", "message": {"stopReason": "stop"},
    }]) is None


def test_arc_runner_stops_after_one_provider_error_without_reprompting(tmp_path, monkeypatch):
    from autoresearch_pi import arc_agi_3_e2e as runner

    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {
        "ARC_OPENAI_API_BASE": "https://provider.invalid/v1",
        "ARC_OPENAI_API_KEY": "test-only",
        "ARC_MODEL": "fixture-model",
    })
    prompts = []

    class ErrorKernel:
        def __init__(self, *args, **kwargs):
            self.event_sink = kwargs["event_sink"]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def send(self, *args, **kwargs):
            return {"success": True}

        def prompt(self, prompt):
            prompts.append(prompt)
            return {"success": True}

        def wait_for_agent_events(self, **kwargs):
            event = {"type": "message_end", "message": {
                "stopReason": "error", "errorMessage": "quota exhausted",
            }}
            self.event_sink(event)
            return [event]

    monkeypatch.setattr(runner, "PiKernel", ErrorKernel)
    monkeypatch.setattr(runner, "_sync_bridge_events", lambda _root, _url, cursor: cursor)
    monkeypatch.setattr(runner, "_get_json", lambda *_: pytest.fail(
        "provider errors must stop before querying or re-prompting the environment"
    ))

    assert runner._run_pi(
        tmp_path, bridge_url="http://unused.invalid", game="test",
        variant="treatment", context_compaction=False,
    ) == 1
    assert len(prompts) == 1
    events = [json.loads(line) for line in (tmp_path / "pi-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert events[-1] == {
        "type": "arc_provider_failure", "error": "quota exhausted",
        "arc_action_committed": False,
    }


def test_arc_kernel_projection_drops_stream_fragments_and_large_tool_results():
    assert _project_arc_kernel_event({
        "type": "text_delta", "partial": {"content": "x" * 1_000_000},
    }) is None
    assert _project_arc_kernel_event({
        "type": "tool_execution_end", "toolName": "arc_action",
        "isError": False, "result": {"frame": "x" * 1_000_000},
    }) == {
        "type": "tool_execution_end", "toolName": "arc_action", "isError": False,
    }
    assert _project_arc_kernel_event({
        "type": "tool_execution_end", "toolName": "arc_action", "isError": False,
        "result": {"details": {"arc_action_boundary": True, "public_transition": {"level_changed": False}}},
    }) == {
        "type": "tool_execution_end", "toolName": "arc_action", "isError": False,
        "evidence": {"public_transition": {"level_changed": False}, "arc_action_boundary": True},
    }
    assert _project_arc_kernel_event({"type": "agent_settled", "messages": ["large"]}) == {
        "type": "agent_settled",
    }
    # The ARC driver synchronizes each outer continuation on this lifecycle
    # boundary.  Dropping it makes a completed turn look permanently pending.
    assert _project_arc_kernel_event({"type": "turn_start", "messages": ["large"]}) == {
        "type": "turn_start",
    }


def test_arc_trajectory_projection_is_bounded_read_only_and_traceable():
    events = [
        {
            "event": "action", "index": 1, "action": "ACTION1",
            "state_before": "PLAYING", "level_before": 0,
            "observation_delta": {"changed_cells": 0, "frame_available": True},
            "frame": {"state": "PLAYING", "levels_completed": 0},
        },
        {
            "event": "action", "index": 2, "action": "ACTION1",
            "state_before": "PLAYING", "level_before": 0,
            "observation_delta": {"changed_cells": 0, "frame_available": True},
            "frame": {"state": "PLAYING", "levels_completed": 0},
        },
        {
            "event": "action", "index": 3, "action": "ACTION2",
            "state_before": "PLAYING", "level_before": 0,
            "observation_delta": {
                "changed_cells": 4, "frame_available": True,
                "bbox": {"top": 1, "left": 2, "bottom": 2, "right": 3},
            },
            "frame": {"state": "PLAYING", "levels_completed": 1},
        },
        {
            "event": "action", "index": 4, "action": "ACTION3",
            "state_before": "PLAYING", "level_before": 1,
            "observation_delta": {"changed_cells": 1, "frame_available": True},
            "frame": {"state": "PLAYING", "levels_completed": 1},
        },
    ]

    recent = project_trajectory(events, projection="transitions", last_n=2)
    assert recent["summary"] == {
        "actions_available": 4,
        "actions_considered": 2,
        "items_returned": 2,
        "current_level": 1,
        "latest_action_id": "arc-action-4",
        "actions_since_level_change": 1,
    }
    assert [item["action_id"] for item in recent["items"]] == ["arc-action-3", "arc-action-4"]
    assert recent["items"][0]["level_changed"] is True
    assert "recommendation" not in recent

    repeated = project_trajectory(events, projection="repeated_actions", last_n=4)
    assert repeated["items"][0] == {
        "start_action_id": "arc-action-1",
        "end_action_id": "arc-action-2",
        "action": "ACTION1",
        "count": 2,
        "level": 0,
        "level_after": 0,
        "state_after": "PLAYING",
        "changed_cells": 0,
        "bbox": None,
    }

    boundaries = project_trajectory(events, projection="level_boundaries", last_n=4)
    assert [item["action_id"] for item in boundaries["items"]] == ["arc-action-3"]


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


def test_arc_pair_comparison_uses_score_when_levels_and_terminal_state_match():
    contract = {
        "model": "model-a", "run_complete": True, "pi_api": "openai-completions",
        "context_window": 1000, "max_output_tokens": 100,
    }
    control = {
        "game": "ls20-test", "experiment": {"variant": "control"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "native_scorecard": {"score": 3.0},
        "runtime": {**contract, "agent_actions": 40},
        "self_harness_evaluation": {"decision_count": 0, "supported_effect_assessments": 0},
    }
    treatment = {
        "game": "ls20-test", "experiment": {"variant": "treatment"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "native_scorecard": {"score": 3.5},
        "runtime": {**contract, "agent_actions": 40},
        "self_harness_evaluation": {"decision_count": 0, "supported_effect_assessments": 0},
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["comparison_valid"] is True
    assert comparison["task"]["score_delta"] == 0.5
    assert comparison["task"]["treatment_improved"] is True


def test_arc_pair_comparison_rejects_incomplete_or_mismatched_runs():
    control = {
        "game": "ls20-test", "experiment": {"variant": "control"},
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {
            "agent_actions": 10, "model": "model-a", "run_complete": False,
            "pi_api": "openai-completions", "context_window": 1000, "max_output_tokens": 100,
        },
        "self_harness_evaluation": {"decision_count": 0, "supported_effect_assessments": 0},
    }
    treatment = {
        "game": "ls20-other", "experiment": {"variant": "treatment"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "runtime": {
            "agent_actions": 8, "model": "model-b", "run_complete": True,
            "pi_api": "openai-completions", "context_window": 1000, "max_output_tokens": 100,
        },
        "self_harness_evaluation": {"decision_count": 1, "supported_effect_assessments": 1},
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["comparison_valid"] is False
    assert set(comparison["invalid_reasons"]) == {
        "control_run_incomplete", "game_mismatch", "model_mismatch",
    }
    assert comparison["task"]["treatment_improved"] is None
    assert comparison["task"]["harness_improved"] is None


def test_arc_pair_does_not_call_research_only_gain_a_harness_improvement():
    control = {
        "game": "ls20-test", "experiment": {"variant": "control"},
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {
            "agent_actions": 10, "model": "model-a", "run_complete": True,
            "pi_api": "openai-completions", "context_window": 1000, "max_output_tokens": 100,
        },
        "self_harness_evaluation": {
            "decision_count": 0, "supported_effect_assessments": 0,
            "provider_payload_verified_effect_assessments": 0,
        },
    }
    treatment = {
        "game": "ls20-test", "experiment": {"variant": "treatment"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "runtime": {
            "agent_actions": 8, "model": "model-a", "run_complete": True,
            "pi_api": "openai-completions", "context_window": 1000, "max_output_tokens": 100,
        },
        "self_harness_evaluation": {
            "decision_count": 0, "supported_effect_assessments": 0,
            "provider_payload_verified_effect_assessments": 0,
        },
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["comparison_valid"] is True
    assert comparison["task"]["treatment_improved"] is True
    assert comparison["task"]["harness_improved"] is None


def test_arc_pair_requires_final_provider_exposure_for_harness_gain():
    contract = {
        "model": "model-a", "run_complete": True, "pi_api": "openai-completions",
        "context_window": 1000, "max_output_tokens": 100,
    }
    control = {
        "game": "ls20-test", "experiment": {"variant": "control"},
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {**contract, "agent_actions": 10},
        "self_harness_evaluation": {
            "decision_count": 0, "supported_effect_assessments": 0,
            "provider_payload_verified_effect_assessments": 0,
        },
    }
    treatment = {
        "game": "ls20-test", "experiment": {"variant": "treatment"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "runtime": {**contract, "agent_actions": 8},
        "self_harness_evaluation": {
            "decision_count": 1, "supported_effect_assessments": 1,
            "provider_payload_verified_effect_assessments": 1,
        },
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["comparison_valid"] is True
    assert comparison["task"]["harness_improved"] is True
    assert comparison["mechanism"]["provider_payload_verified_effect_delta"] == 1


def test_arc_pair_accepts_a_runtime_linked_non_compaction_harness_effect():
    contract = {
        "model": "model-a", "run_complete": True, "pi_api": "openai-completions",
        "context_window": 1000, "max_output_tokens": 100,
    }
    control = {
        "game": "ls20-test", "experiment": {"variant": "control"},
        "benchmark_evaluation": {"levels_completed": 0, "passed": False},
        "runtime": {**contract, "agent_actions": 10},
        "self_harness_evaluation": {
            "decision_count": 0, "supported_effect_assessments": 0,
            "runtime_exposure_linked_supported_effect_assessments": 0,
            "provider_payload_verified_effect_assessments": 0,
        },
    }
    treatment = {
        "game": "ls20-test", "experiment": {"variant": "treatment"},
        "benchmark_evaluation": {"levels_completed": 1, "passed": False},
        "runtime": {**contract, "agent_actions": 8},
        "self_harness_evaluation": {
            "decision_count": 1, "supported_effect_assessments": 1,
            "runtime_exposure_linked_supported_effect_assessments": 1,
            "provider_payload_verified_effect_assessments": 0,
        },
    }

    comparison = compare_arc_runs(control, treatment)

    assert comparison["comparison_valid"] is True
    assert comparison["task"]["harness_improved"] is True
    assert comparison["mechanism"]["runtime_exposure_linked_effect_delta"] == 1
