"""Budgeted effort screening through installed Pi's native Qwen HTTP transport.

Loopback provider/ARC doubles verify payloads and public receipts, not adoption
or net benefit. Controlled child ledger rows are completed-usage diagnostics.
"""
import json

import pytest

from autoresearch_pi import arc_agi_3_e2e as runner
from test_arc_reasoning_feedback_native import (
    assert_semantic_actions, native_qwen_fixture, rows, run_native,
)


ENABLED = {"PI_REASONING_LENGTH_RECOVERY": "enabled"}
FIRST_USAGE = {"prompt_tokens": 100, "completion_tokens": 1, "total_tokens": 101}


def selections(root):
    return [row for row in rows(root / "pi-events.jsonl")
            if row.get("type") == "reasoning_policy_selection"]


@pytest.mark.parametrize("checkpoint,expected", [(400, False), (429, True), (1000, True)],
                         ids=["insufficient", "exact-boundary", "ample"])
def test_native_effort_reserves_investment_and_retry_from_last_measured_input(
    tmp_path, monkeypatch, checkpoint, expected
):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            **ENABLED, "PI_ARC_NO_LEVEL_REPORTED_TOKENS": str(checkpoint)}) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:2]] == [False, expected]
    assert all(body["max_completion_tokens"] == 64 for body in fixture["requests"])
    assert "execution-observation-1" in json.dumps(fixture["requests"][1]["messages"])
    assert_semantic_actions(tmp_path, 2, 0)
    selection = selections(tmp_path)[1]
    assert selection["investment_budget"]["latest_parent_input_tokens"] == 100
    assert selection["investment_budget"]["planning_reserve_tokens"] == 328
    assert selection["investment_budget"]["remaining_reported_tokens"] == checkpoint - 101
    assert selection["investment_budget"]["fits"] is expected
    if not expected:
        assert selection["opportunity_ref"] is None
        assert not any(row.get("type") == "reasoning_policy_consumed"
                       for row in rows(tmp_path / "pi-events.jsonl"))


def test_native_budget_deferred_opportunity_remains_eligible_after_off_completion(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=3,
                             usage_by_request={1: FIRST_USAGE}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            **ENABLED, "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "400"}) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:3]] == [False, False, True]
    events = assert_semantic_actions(tmp_path, 3, 0)
    consumed = [row for row in events if row.get("type") == "reasoning_policy_consumed"]
    assert len(consumed) == 1 and consumed[0]["level"] == "medium"
    assert consumed[0]["opportunity_refs"] == ["initial-discovery"]
    third_selection = selections(tmp_path)[2]
    assert third_selection["opportunity_ref"] == "initial-discovery"


def test_native_cached_input_is_counted_once_in_investment_estimate(tmp_path, monkeypatch):
    usage = {**FIRST_USAGE, "prompt_tokens_details": {"cached_tokens": 60, "cache_write_tokens": 10}}
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: usage}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            **ENABLED, "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "400"}) == 0
    assert fixture["requests"][1]["enable_thinking"] is False
    events = assert_semantic_actions(tmp_path, 2, 0)
    first_usage = next(row["message"]["usage"] for row in events if row.get("type") == "message_end"
                       and row.get("message", {}).get("role") == "assistant")
    assert (first_usage["input"], first_usage["cacheRead"], first_usage["cacheWrite"]) == (30, 60, 10)
    assert selections(tmp_path)[1]["investment_budget"]["latest_parent_input_tokens"] == 100


def test_native_missing_provider_usage_conservatively_defers_deep(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: None}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED) == 0
    assert fixture["requests"][1]["enable_thinking"] is False
    assert_semantic_actions(tmp_path, 2, 0)
    assert selections(tmp_path)[1]["investment_budget"]["latest_parent_input_tokens"] is None


def test_native_latest_missing_measurement_clears_previous_valid_input(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=3,
                             usage_by_request={1: FIRST_USAGE, 2: None}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:3]] == [False, True, False]
    assert_semantic_actions(tmp_path, 3, 0)
    assert selections(tmp_path)[2]["investment_budget"]["latest_parent_input_tokens"] is None


def test_native_latest_invalid_cache_count_clears_previous_valid_input(tmp_path, monkeypatch):
    invalid_usage = {**FIRST_USAGE, "prompt_tokens_details": {"cached_tokens": True}}
    with native_qwen_fixture(tmp_path, effect=0, maximum=3,
                             usage_by_request={1: FIRST_USAGE, 2: invalid_usage}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:3]] == [False, True, False]
    assert_semantic_actions(tmp_path, 3, 0)
    assert selections(tmp_path)[2]["investment_budget"]["latest_parent_input_tokens"] is None


def test_native_missing_declared_output_cap_conservatively_defers_deep(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED, max_output_tokens=None) == 0
    assert fixture["requests"][1]["enable_thinking"] is False
    assert fixture["requests"][1]["max_completion_tokens"] == fixture["requests"][0]["max_completion_tokens"]
    assert_semantic_actions(tmp_path, 2, 0)
    assert selections(tmp_path)[1]["investment_budget"]["output_cap"] is None


def test_native_no_declared_budget_leaves_filter_inactive(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED, budgeted=False) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:2]] == [False, True]
    assert_semantic_actions(tmp_path, 2, 0)
    assert all("investment_budget" not in row for row in selections(tmp_path))


def test_native_shared_only_budget_is_active_without_no_level_checkpoint(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, budgeted=False, overrides={
            **ENABLED, "PI_PROVIDER_MAX_REPORTED_TOKENS": "400"}) == 0
    assert fixture["requests"][1]["enable_thinking"] is False
    assert_semantic_actions(tmp_path, 2, 0)
    assert selections(tmp_path)[1]["investment_budget"]["remaining_reported_tokens"] == 299


def test_native_completed_child_usage_is_fresh_shared_spending(tmp_path, monkeypatch):
    def completed_child(used, state):
        if used == 1:
            with (tmp_path / "provider-token-budget.jsonl").open("a", encoding="utf-8") as out:
                out.write(json.dumps({"event": "reported_usage", "scope": "child", "tokens": 200}) + "\n")
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}, after_action=completed_child) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            **ENABLED, "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "500"}) == 0
    assert fixture["requests"][1]["enable_thinking"] is False
    assert_semantic_actions(tmp_path, 2, 0)
    assert selections(tmp_path)[1]["investment_budget"]["reported_tokens"] == 301
    assert selections(tmp_path)[1]["investment_budget"]["remaining_reported_tokens"] == 199


@pytest.mark.parametrize("shared_limit,expected", [(400, False), (1000, True)],
                         ids=["shared-still-constrains", "no-level-released"])
def test_native_fresh_level_releases_only_no_level_checkpoint(tmp_path, monkeypatch, shared_limit, expected):
    def cross_level(used, state):
        if used == 1: state["levels_completed"] = 1
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}, after_action=cross_level) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            **ENABLED, "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "150",
            "PI_PROVIDER_MAX_REPORTED_TOKENS": str(shared_limit)}) == 0
    assert fixture["requests"][1]["enable_thinking"] is expected
    assert_semantic_actions(tmp_path, 2, 0)
    budget = selections(tmp_path)[1]["investment_budget"]
    assert budget["levels_completed"] == 1
    assert budget["remaining_reported_tokens"] == shared_limit - 101


def test_native_disabled_filter_preserves_unaffordable_original_allocation(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides={
            "PI_REASONING_LENGTH_RECOVERY": "disabled", "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "400"}) == 0
    assert fixture["requests"][1]["enable_thinking"] is True
    assert_semantic_actions(tmp_path, 2, 0)
    assert all("investment_budget" not in row for row in selections(tmp_path))


@pytest.mark.parametrize("kind", ["unknown", "sticky"])
def test_native_existing_budget_stops_take_priority_over_effort_filter(tmp_path, monkeypatch, kind):
    def stop_budget(used, state):
        if used == 1:
            with (tmp_path / "provider-token-budget.jsonl").open("a", encoding="utf-8") as out:
                out.write(json.dumps({"event": "unmeasured_usage"} if kind == "unknown" else
                                     {"event": "budget_stop", "evaluation_stopped": True}) + "\n")
    with native_qwen_fixture(tmp_path, effect=0, maximum=2,
                             usage_by_request={1: FIRST_USAGE}, after_action=stop_budget) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, overrides=ENABLED) == 125
    assert len(fixture["requests"]) == 1
    assert len(fixture["actions"]) == 1
    # Sticky stop precedes the existing bridge-log synchronization. Verify the
    # committed native receipt itself without requiring a later recovery step.
    receipts = [row for row in rows(tmp_path / "pi-events.jsonl")
                if row.get("type") == "tool_execution_end" and row.get("toolName") == "arc_action"]
    assert len(receipts) == 1 and not receipts[0].get("isError")
    result = receipts[0].get("result", {})
    details = result.get("details", receipts[0].get("evidence", {}))
    assert details["arc_action_boundary"] is True
    assert details["observation_delta"]["changed_cells"] == 0
    assert len(selections(tmp_path)) == 1
    if kind == "unknown":
        audit = json.loads((tmp_path / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
        assert audit["reason"] == "unknown provider usage"


def test_prompt_rejection_preserves_medium_after_budget_fit_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: {
        "thinking_format": "qwen", "pi_api": "openai-completions", "base_url": "http://unused.invalid",
        "api_key": "unused", "model": "qwen3.8-27b", "input_modalities": ["text"],
        "context_window": 175000, "max_tokens": 64,
    })
    monkeypatch.setattr(runner, "_sync_bridge_events", lambda *a: 0)
    monkeypatch.setattr(runner, "_get_json", lambda _: {
        "state": "NOT_FINISHED", "levels_completed": 0, "action_budget": {}, "available_actions": ["ACTION1"]})
    complete = {"type": "message_end", "message": {
        "role": "assistant", "stopReason": "toolUse", "usage": {"input": 100}}}
    batches = [
        [complete, {"type": "tool_execution_end", "toolName": "arc_action", "isError": False,
                    "args": {"action": "ACTION1"}, "result": {"details": {"state": "NOT_FINISHED"}}}],
        [{"type": "message_end", "message": {"role": "assistant", "stopReason": "aborted"}}],
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
            if len(prompts) == 3:
                with (tmp_path / "provider-token-budget.jsonl").open("a", encoding="utf-8") as out:
                    out.write(json.dumps({"event": "reported_usage", "scope": "child", "tokens": 100}) + "\n")
                return {"success": False}
            return {"success": True}
        def new_session(self): sessions.append(True)
        def wait_for_event(self, *a, **k): return {"type": "turn_start"}
        def wait_for_agent_events(self, **k):
            if not batches: raise TimeoutError("bounded diagnostic end")
            if len(batches) == 3:
                (tmp_path / "provider-token-budget.jsonl").write_text(json.dumps({
                    "event": "reported_usage", "scope": "parent", "tokens": 101}) + "\n", encoding="utf-8")
                (tmp_path / "task-checkpoint.json").write_text(json.dumps({"recent_actions": [{
                    "action": "ACTION1", "changed_cells": 1, "observation_id": "first"}]}), encoding="utf-8")
            return batches.pop(0)

    monkeypatch.setattr(runner, "PiKernel", Kernel)
    assert runner._run_pi(tmp_path, bridge_url="http://unused.invalid", game="test", variant="control",
        context_compaction=False, provider_extension=None, reasoning_policy="adaptive-binary",
        reasoning_levels=("off", "medium"), environment_overrides={
            **ENABLED, "PI_REASONING_INITIAL_AFTER_FEEDBACK": "enabled",
            "PI_PROVIDER_MAX_REPORTED_TOKENS": "1000", "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "500"}) == 124
    assert modes[:4] == ["off", "medium", "medium", "medium"]
    assert sessions == [True] and prompts[0] in prompts[3]
    assert "investment_budget" not in selections(tmp_path)[3]


@pytest.mark.parametrize("usage,expected", [
    ({"input": 30, "cacheRead": 60, "cacheWrite": 10}, 100),
    ({"input_tokens": 30, "cache_read": 60, "cache_write": 10}, 100),
    ({"input": 30, "cacheRead": 60, "cache_read": 999, "cacheWrite": 10, "cache_write": 999}, 100),
    ({"input": 100}, 100),
    ({"input": 0, "cacheRead": 100}, 100),
    ({"input": 0}, None),
    ({}, None),
    (None, None),
    ({"input": True}, None),
    ({"input": -1}, None),
    ({"input": 1.5}, None),
    ({"input": "100"}, None),
    ({"input": 100, "cacheRead": True}, None),
    ({"input": 100, "cacheWrite": -1}, None),
    ({"input": 2**53 - 1, "cache_read": 1}, None),
])
def test_parent_input_measurement_rejects_unknown_and_counts_cache_aliases_once(usage, expected):
    assert runner._measured_parent_input(usage) == expected


@pytest.mark.parametrize("spent,input_tokens,no_level_limit,want_remaining,want_reserve", [
    (11105, 10873, 30000, 18895, 38130),
    (23252, 11768, 40000, 16748, 39920),
])
def test_real_stage123r1_and124_counterfactuals_defer_without_claiming_quality(
    spent, input_tokens, no_level_limit, want_remaining, want_reserve
):
    screen = runner._reasoning_investment_budget(shared_limit=60000, no_level_limit=no_level_limit,
        levels_completed=0, usage={"reported_tokens": spent, "unmeasured_usage": False},
        parent_input_tokens=input_tokens, output_cap=8192)
    assert screen["remaining_reported_tokens"] == want_remaining
    assert screen["planning_reserve_tokens"] == want_reserve
    assert screen["fits"] is False


@pytest.mark.parametrize("change", [
    {"parent_input_tokens": None}, {"parent_input_tokens": True},
    {"output_cap": None}, {"output_cap": False}, {"output_cap": -1},
    {"output_cap": "64"}, {"output_cap": 2**53},
    {"levels_completed": None}, {"levels_completed": True},
    {"usage": {"reported_tokens": True, "unmeasured_usage": False}},
    {"usage": {"reported_tokens": 0, "unmeasured_usage": True}},
])
def test_active_budget_unknown_estimates_do_not_approve_deep(change):
    options = {"shared_limit": 1000, "no_level_limit": 500, "levels_completed": 0,
               "usage": {"reported_tokens": 101, "unmeasured_usage": False},
               "parent_input_tokens": 100, "output_cap": 64, **change}
    assert runner._reasoning_investment_budget(**options)["fits"] is False
