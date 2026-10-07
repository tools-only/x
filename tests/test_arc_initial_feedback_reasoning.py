"""Initial compute timing and canonical receipt handling, without provider calls."""
import json
import importlib.util
from pathlib import Path

import pytest

from autoresearch_pi import arc_agi_3_e2e as runner
from autoresearch_pi import reasoning_policy as policy


def test_initial_waits_for_confirmed_feedback_even_with_counterevidence():
    checkpoint = {"decision_state": {"counterevidence": ["unverified theory"]}}
    options = {"first_deep_after_feedback": True, "action_feedback_received": False}
    assert policy.binary_reasoning_opportunity(checkpoint, {}, **options) == (
        None, "awaiting_first_arc_feedback")
    assert policy.select_reasoning_level(checkpoint, {}, "adaptive-binary", ("off", "medium"),
                                         **options) == ("off", "awaiting_first_arc_feedback")
    options["action_feedback_received"] = True
    assert policy.binary_reasoning_opportunity(checkpoint, {}, **options) == (
        "initial-discovery", "initial_discovery_after_feedback")
    assert policy.select_reasoning_level(checkpoint, {}, "adaptive-binary", ("off", "medium"),
                                         **options) == ("medium", "initial_discovery_after_feedback")
    prior = {"initial-discovery"}
    assert policy.binary_reasoning_opportunity(checkpoint, {}, prior, **options) == (
        policy.binary_reasoning_opportunity(checkpoint, {}, prior))


@pytest.mark.parametrize("checkpoint,expected", [
    ({"recent_actions": [{"action": "ACTION1", "changed_cells": 1, "observation_id": "p"}]},
     {"initial-discovery", "first-effect:initial:p"}),
    ({"recent_actions": [{"action": "ACTION1", "changed_cells": 0, "observation_id": "s"}]},
     {"initial-discovery"}),
    ({"recent_actions": [{"action": "ACTION1", "changed_cells": 1, "observation_id": "p"},
                         {"action": "RESET", "changed_cells": 1, "observation_id": "r"},
                         {"action": "ACTION2", "changed_cells": 1, "observation_id": "q"}]},
     {"initial-discovery", "first-effect:r:q"}),
    ({"recent_actions": [{"action": "ACTION1", "changed_cells": 1, "observation_id": "l",
                          "level_changed": True}]}, {"initial-discovery"}),
])
def test_delayed_initial_freezes_only_existing_current_epoch_effect(checkpoint, expected):
    frozen = policy.binary_reasoning_consumption_keys(checkpoint, "initial-discovery",
                                                     first_deep_after_feedback=True)
    assert frozen == expected
    checkpoint["recent_actions"].append({"action": "ACTION2", "changed_cells": 1,
                                          "observation_id": "new"})
    assert frozen == expected
    assert policy.binary_reasoning_consumption_keys(checkpoint, "initial-discovery") == {"initial-discovery"}


@pytest.mark.parametrize("name,details,error,action,expected", [
    ("arc_action", {"state": "NOT_FINISHED"}, False, "ACTION1", True),  # No pixel diff needed.
    ("arc_action", {}, False, "ACTION1", False),  # Unknown request has no public receipt.
    ("arc_action", {}, True, "ACTION1", False),
    ("arc_action", {}, False, "RESET", False),
    ("arc_action", {"state": "NOT_FINISHED"}, False, None, False),
    ("read", {}, False, "ACTION1", False),
    ("arc_actions", {"completed": []}, False, None, False),
    ("arc_actions", {"completed": [{"action": "RESET"}]}, False, None, False),
    ("arc_actions", {"completed": [{"action": "ACTION1"}]}, True, None, True),
    ("arc_actions", {"completed": [{"action": "ACTION1", "is_error": True}]}, True, None, False),
    ("delegate_task", {"arc_action_count": 1}, False, None, False),
    ("delegate_task", {"arc_action_receipts": [{"action": "ACTION1"}]}, True, None, True),
    ("delegate_task", {"arc_action_receipts": [{"action": "ACTION1", "status": "unknown"}]}, False, None, False),
    ("arc_actions", {"completed": [{"action": []}, {"action": "ACTION1", "status": {}}]}, False, None, False),
])
def test_feedback_accepts_only_completed_nonreset_receipts(name, details, error, action, expected):
    event = {"type": "tool_execution_end", "toolName": name, "isError": error,
             "result": {"details": details}, "args": {"action": action} if action else {}}
    assert runner._turn_has_nonreset_arc_feedback([event]) is expected
    projected = runner._project_arc_feedback_kernel_event(event)
    assert runner._turn_has_nonreset_arc_feedback([projected]) is expected
    assert "nonreset_arc_feedback" not in runner._project_arc_kernel_event(event).get("evidence", {})


def test_default_and_other_policies_match_frozen_stage119():
    source = Path(__file__).resolve().parents[1] / "versions/arc/stage119/src/autoresearch_pi/reasoning_policy.py"
    spec = importlib.util.spec_from_file_location("stage119_reasoning_comparator", source)
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    samples = [({}, {}, set()),
               ({}, {}, {"initial-discovery"}),
               ({"recent_actions": [{"action": "ACTION1", "changed_cells": 0, "observation_id": str(i)}
                                    for i in range(4)]}, {}, {"initial-discovery", "silent:initial:2"}),
               ({"recent_actions": [{"action": "ACTION1", "changed_cells": 1, "observation_id": "e"}]},
                {"plan": {"needs_reconciliation": True}}, {"initial-discovery"})]
    for checkpoint, state, prior in samples:
        assert policy.binary_reasoning_opportunity(checkpoint, state, prior) == previous.binary_reasoning_opportunity(checkpoint, state, prior)
        for name, levels in [("provider-default", ()), ("adaptive", ("low", "medium", "high")),
                             ("adaptive-binary", ("off", "medium")), ("adaptive-evidence", ("low", "medium"))]:
            assert policy.select_reasoning_level(checkpoint, state, name, levels, prior) == previous.select_reasoning_level(checkpoint, state, name, levels, prior)
            if name != "adaptive-binary":
                assert policy.select_reasoning_level(checkpoint, state, name, levels, prior,
                    first_deep_after_feedback=True) == previous.select_reasoning_level(checkpoint, state, name, levels, prior)


@pytest.mark.parametrize("setting", [
    {"pi_api": "openai-responses", "thinking_format": "qwen"},
    {"pi_api": "openai-completions", "thinking_format": "qwen-chat-template"},
    {"pi_api": "openai-completions", "thinking_format": None},
])
def test_enabled_capability_rejected_before_pi_request(tmp_path, monkeypatch, setting):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: {
        **setting, "base_url": "", "api_key": "", "model": "test", "input_modalities": ["text"]})
    monkeypatch.setattr(runner, "PiKernel", lambda *a, **k: pytest.fail("must reject before Pi"))
    with pytest.raises(ValueError):
        runner._run_pi(tmp_path, bridge_url="http://unused", game="test", variant="control",
                       context_compaction=False, provider_extension=tmp_path / "provider.ts",
                       environment_overrides={"PI_REASONING_INITIAL_AFTER_FEEDBACK": "enabled"},
                       reasoning_policy="adaptive-binary", reasoning_levels=("off", "medium"))


@pytest.mark.parametrize("recovery", ["length", "rejected_prompt"])
@pytest.mark.parametrize("effect", [0, 1])
def test_delayed_allocation_preserves_mode_and_frozen_keys_on_recovery(tmp_path, monkeypatch, recovery, effect):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: {
        "thinking_format": "qwen", "pi_api": "openai-completions", "base_url": "", "api_key": "",
        "model": "test", "input_modalities": ["text"], "context_window": 175000, "max_tokens": 100})
    monkeypatch.setattr(runner, "_sync_bridge_events", lambda *a: 0)
    monkeypatch.setattr(runner, "_get_json", lambda _: {"state": "NOT_FINISHED", "levels_completed": 0,
                                                       "action_budget": {}, "available_actions": ["ACTION1"]})
    modes, prompts, session = [], [], []
    checkpoint = {"recent_actions": [{"action": "ACTION1", "changed_cells": effect, "observation_id": "first"}]}
    complete = {"type": "message_end", "message": {"role": "assistant", "stopReason": "toolUse"}}
    batches = [
        [complete, {"type": "tool_execution_end", "toolName": "arc_action", "isError": False,
                    "args": {"action": "ACTION1"}, "result": {"details": {"state": "NOT_FINISHED"}}}],
        [{"type": "message_end", "message": {"role": "assistant",
           "stopReason": "length" if recovery == "length" else "aborted"}}],
        [complete],
    ]

    class Kernel:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def send(self, command, **params):
            if command == "set_thinking_level": modes.append(params["level"])
            return {"success": True}
        def prompt(self, text):
            prompts.append(text)
            return {"success": not (recovery == "rejected_prompt" and len(prompts) == 3)}
        def new_session(self): session.append(True)
        def wait_for_event(self, *a, **k): return {"type": "turn_start"}
        def wait_for_agent_events(self, **k):
            if not batches: raise TimeoutError("bounded diagnostic end")
            if len(batches) == 3:
                (tmp_path / "task-checkpoint.json").write_text(json.dumps(checkpoint), encoding="utf-8")
            elif len(batches) == 1 and not effect:
                checkpoint["recent_actions"].append({"action": "ACTION2", "changed_cells": 1,
                                                     "observation_id": "new-effect"})
                (tmp_path / "task-checkpoint.json").write_text(json.dumps(checkpoint), encoding="utf-8")
            return batches.pop(0)

    monkeypatch.setattr(runner, "PiKernel", Kernel)
    assert runner._run_pi(tmp_path, bridge_url="http://unused", game="test", variant="control",
                          context_compaction=False, provider_extension=tmp_path / "provider.ts",
                          environment_overrides={"PI_REASONING_INITIAL_AFTER_FEEDBACK": "enabled"},
                          reasoning_policy="adaptive-binary", reasoning_levels=("off", "medium")) == 124
    assert modes[:3] == ["off", "medium", "medium"]
    assert modes[-1] == ("off" if effect else "medium")
    events = [json.loads(line) for line in (tmp_path / "pi-events.jsonl").read_text().splitlines()]
    consumed = [event for event in events if event["type"] == "reasoning_policy_consumed"]
    assert len(consumed) == 1
    assert consumed[0]["opportunity_refs"] == (["first-effect:initial:first", "initial-discovery"]
                                               if effect else ["initial-discovery"])
