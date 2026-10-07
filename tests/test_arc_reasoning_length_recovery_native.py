"""Bounded parent length recovery using real Pi's native Qwen HTTP payloads.

The loopback provider emits public partial text followed by length. No private
reasoning content, paid API, real ARC game, or hidden-only classification.
"""

import json
from pathlib import Path

import pytest

from autoresearch_pi import arc_agi_3_e2e as runner
from test_arc_reasoning_feedback_native import (
    assert_semantic_actions, native_qwen_fixture, rows, run_native,
)


ENABLED = {"PI_REASONING_LENGTH_RECOVERY": "enabled"}


def test_provider_default_repeated_length_is_bounded_without_changing_effort_or_replaying_action(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=2, length_requests=(2, 3)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, enabled=False, levels=(),
                          reasoning_policy="provider-default", max_output_tokens=4096,
                          settings={"ARC_PI_THINKING_FORMAT": ""}) == 1
    assert len(fixture['requests']) == 3
    assert all(payload['max_completion_tokens'] == 4096 for payload in fixture['requests'])
    assert all('enable_thinking' not in payload for payload in fixture['requests'])
    events = assert_semantic_actions(tmp_path, 1, 1)
    assert sum(row.get('command') == 'new_session' for row in events) == 1
    stops = [row for row in events if row.get('type') == 'reasoning_length_recovery_stopped']
    assert len(stops) == 1 and stops[0]['consecutive_length_responses'] == 2
    assert stops[0]['policy'] == 'provider-default'
    summary = runner.project_arc_summary(tmp_path, game='controlled', variant='treatment',
        bridge_result={'terminal_state': 'NOT_FINISHED', 'levels_completed': 0, 'partial': True},
        scorecard=None, pi_returncode=1, timed_out=False)
    assert summary['runtime']['completion_status'] == 'provider_length_retry_exhausted'


def test_native_enabled_length_retry_is_off_with_same_output_cap_and_one_consumption(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2, length_requests=(2,)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED, max_output_tokens=8192) == 0
    payloads = fixture["requests"]
    assert [body.get("enable_thinking") for body in payloads[:3]] == [False, True, False]
    assert all(body["max_completion_tokens"] == 8192 for body in payloads)
    assert "execution-observation-1" in json.dumps(payloads[2]["messages"])
    events = assert_semantic_actions(tmp_path, 2, 0)
    recovery = [row for row in events if row.get("type") == "reasoning_policy_selection"
                and row.get("reason") == "length_recovery_native_off"]
    assert len(recovery) == 1 and recovery[0]["level"] == "off"
    assert recovery[0]["rpc_result"]["success"] is True
    assert sum(row.get("command") == "new_session" for row in events) == 1
    consumed = [row for row in events if row.get("type") == "reasoning_policy_consumed"]
    assert len(consumed) == 1 and consumed[0]["opportunity_refs"] == ["initial-discovery"]
    assert consumed[0]["level"] == "off"
    length_index = next(index for index, row in enumerate(events) if row.get("type") == "message_end"
                        and row.get("message", {}).get("stopReason") == "length")
    assert length_index < events.index(consumed[0])
    assert not any(row.get("type") == "reasoning_length_recovery_stopped" for row in events)


def test_native_disabled_length_retry_preserves_medium(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=2, length_requests=(2,)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch,
                          overrides={"PI_REASONING_LENGTH_RECOVERY": "disabled"}, max_output_tokens=8192) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:3]] == [False, True, True]
    assert all(body["max_completion_tokens"] == 8192 for body in fixture["requests"])
    assert_semantic_actions(tmp_path, 2, 1)


def test_native_initial_off_is_preserved_and_action_resets_length_streak(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=2, length_requests=(1, 3)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED, max_output_tokens=8192) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:4]] == [False, False, True, False]
    events = assert_semantic_actions(tmp_path, 2, 1)
    recoveries = [row for row in events if row.get("type") == "arc_recovery_phase"
                  and row.get("reason") == "model_output_length"]
    assert [row["consecutive_length_responses"] for row in recoveries] == [1, 1]
    selections = [row for row in events if row.get("type") == "reasoning_policy_selection"]
    assert selections[1]["reason"] == "length_recovery_preserves_allocation"
    assert sum(row.get("reason") == "length_recovery_native_off" for row in selections) == 1


def test_native_second_consecutive_length_stops_before_third_request_or_new_session(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=3, length_requests=(2, 3, 4)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED, max_output_tokens=8192) == 1
    assert len(fixture["requests"]) == 3
    assert [body.get("enable_thinking") for body in fixture["requests"]] == [False, True, False]
    assert all(body["max_completion_tokens"] == 8192 for body in fixture["requests"])
    events = assert_semantic_actions(tmp_path, 1, 1)
    stops = [row for row in events if row.get("type") == "reasoning_length_recovery_stopped"]
    assert len(stops) == 1 and stops[0]["consecutive_length_responses"] == 2
    assert stops[0]["reason"] == "consecutive_length_retry_exhausted"
    assert sum(row.get("command") == "new_session" for row in events) == 1
    assert not any(row.get("type") == "reasoning_policy_consumed" for row in events)


@pytest.mark.parametrize("variant", [
    "other_policy", "missing_medium", "responses_api", "chat_template", "unknown_format",
    "unknown_flag", "scripted_provider",
])
def test_length_recovery_gate_rejects_before_pi_or_http(tmp_path, monkeypatch, variant):
    settings = {"thinking_format": "qwen", "pi_api": "openai-completions",
                "base_url": "http://127.0.0.1:9", "api_key": "local-unreachable",
                "model": "qwen3.8-27b", "input_modalities": ["text"],
                "context_window": 175000, "max_tokens": 8192}
    policy, levels, flag, extension = "adaptive-binary", ("off", "medium"), "enabled", None
    if variant == "other_policy": policy = "adaptive"
    elif variant == "missing_medium": levels = ("off", "low")
    elif variant == "responses_api": settings["pi_api"] = "openai-responses"
    elif variant == "chat_template": settings["thinking_format"] = "qwen-chat-template"
    elif variant == "unknown_format": settings["thinking_format"] = None
    elif variant == "unknown_flag": flag = "automatic"
    elif variant == "scripted_provider": extension = tmp_path / "scripted-provider.ts"
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: settings)
    monkeypatch.setattr(runner, "PiKernel", lambda *a, **k: pytest.fail("must reject before Pi or HTTP"))
    with pytest.raises(ValueError, match="length recovery|PI_REASONING_LENGTH_RECOVERY"):
        runner._run_pi(tmp_path, bridge_url="http://127.0.0.1:9", game="controlled", variant="treatment",
                       context_compaction=False, provider_extension=extension,
                       environment_overrides={"PI_REASONING_LENGTH_RECOVERY": flag},
                       reasoning_policy=policy, reasoning_levels=levels, max_output_tokens=8192)


@pytest.mark.parametrize("boundary", ["rejected_prompt", "nonassistant_length"])
def test_enabled_policy_does_not_override_other_recovery_boundaries(tmp_path, monkeypatch, boundary):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: {
        "thinking_format": "qwen", "pi_api": "openai-completions", "base_url": "http://unused.invalid",
        "api_key": "unused", "model": "qwen3.8-27b", "input_modalities": ["text"],
        "context_window": 175000, "max_tokens": 8192,
    })
    monkeypatch.setattr(runner, "_sync_bridge_events", lambda *a: 0)
    monkeypatch.setattr(runner, "_get_json", lambda _: {"state": "NOT_FINISHED", "levels_completed": 0,
                                                       "action_budget": {}, "available_actions": ["ACTION1"]})
    complete = {"type": "message_end", "message": {"role": "assistant", "stopReason": "toolUse"}}
    batches = [
        [complete, {"type": "tool_execution_end", "toolName": "arc_action", "isError": False,
                    "args": {"action": "ACTION1"}, "result": {"details": {"state": "NOT_FINISHED"}}}],
        [{"type": "message_end", "message": {
            "role": "toolResult" if boundary == "nonassistant_length" else "assistant",
            "stopReason": "length" if boundary == "nonassistant_length" else "aborted"}}],
        [complete],
    ]
    modes, prompts, sessions = [], [], []

    class Kernel:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def send(self, command, **params):
            if command == "set_thinking_level": modes.append(params["level"])
            return {"success": True}
        def prompt(self, text):
            prompts.append(text)
            return {"success": not (boundary == "rejected_prompt" and len(prompts) == 3)}
        def new_session(self): sessions.append(True)
        def wait_for_event(self, *a, **k): return {"type": "turn_start"}
        def wait_for_agent_events(self, **k):
            if not batches: raise TimeoutError("bounded diagnostic end")
            if len(batches) == 3:
                (tmp_path / "task-checkpoint.json").write_text(json.dumps({"recent_actions": [{
                    "action": "ACTION1", "changed_cells": 1, "observation_id": "first",
                }]}), encoding="utf-8")
            return batches.pop(0)

    monkeypatch.setattr(runner, "PiKernel", Kernel)
    assert runner._run_pi(tmp_path, bridge_url="http://unused.invalid", game="test", variant="control",
                          context_compaction=False, provider_extension=None,
                          environment_overrides={**ENABLED, "PI_REASONING_INITIAL_AFTER_FEEDBACK": "enabled"},
                          reasoning_policy="adaptive-binary", reasoning_levels=("off", "medium")) == 124
    assert modes[:3] == ["off", "medium", "medium"]
    if boundary == "rejected_prompt": assert modes[3] == "medium" and sessions == [True]
    else: assert sessions == []
    events = rows(tmp_path / "pi-events.jsonl")
    assert not any(row.get("reason") == "length_recovery_native_off" for row in events)
    assert not any(row.get("reason") == "model_output_length" for row in events)
