import pytest
from autoresearch_pi.reasoning_policy import select_reasoning_level, validate_reasoning_options
from autoresearch_pi.reasoning_policy import binary_reasoning_opportunity


def test_binary_allocation_reuses_deep_discovery_without_reinvesting_on_each_action():
    levels = ("off", "medium")
    assert select_reasoning_level({}, {}, "adaptive-binary", levels) == ("medium", "initial_discovery")
    assert select_reasoning_level({}, {}, "adaptive-binary", levels, {"initial-discovery"}) == ("off", "bounded_followthrough")
    actions = [{"observation_id": f"o{i}", "changed_cells": 0, "action": "ACTION6"} for i in range(3)]
    checkpoint = {"recent_actions": actions[:2]}
    ref, _ = binary_reasoning_opportunity(checkpoint, {})
    assert select_reasoning_level(checkpoint, {}, "adaptive-binary", levels) == ("medium", "silent_probe_reconsideration")
    assert select_reasoning_level({"recent_actions": actions}, {}, "adaptive-binary", levels, {ref}) == ("off", "bounded_followthrough")
    actions.append({"observation_id": "o3", "changed_cells": 38, "action": "ACTION6"})
    checkpoint = {"recent_actions": actions}
    assert select_reasoning_level(checkpoint, {}, "adaptive-binary", levels, {ref}) == ("medium", "first_persistent_visual_effect_planning")
    effect_ref, _ = binary_reasoning_opportunity(checkpoint, {}, {ref})
    consumed = {ref, effect_ref}
    assert select_reasoning_level(checkpoint, {}, "adaptive-binary", levels, consumed) == ("off", "bounded_followthrough")
    checkpoint["recent_actions"] += [{"observation_id": f"p{i}", "changed_cells": 38} for i in range(3)]
    assert select_reasoning_level(checkpoint, {}, "adaptive-binary", levels, consumed) == ("medium", "visible_effects_without_level_transition")


def test_binary_allocation_preserves_uncertainty_and_requires_verified_modes():
    with pytest.raises(ValueError):
        validate_reasoning_options("adaptive-binary", ("medium",), 65536)
    validate_reasoning_options("adaptive-binary", ("off", "medium"), 65536)
    checkpoint = {"recent_actions": [{"observation_id": "level1", "level_changed": True, "changed_cells": 500}]}
    assert select_reasoning_level(checkpoint, {}, "adaptive-binary", ("off", "medium")) == ("medium", "new_level")
    state = {"candidates": [{"id": "route", "version": 3, "status": "challenged"}]}
    ref, reason = binary_reasoning_opportunity(checkpoint, state)
    assert reason == "explicit_counterevidence_or_plan_failure"
    assert select_reasoning_level(checkpoint, state, "adaptive-binary", ("off", "medium"), {ref}) == ("medium", "new_level")

def test_capability_unknown_does_not_invent_effort_parameters():
    assert select_reasoning_level({}, {}, "adaptive", ()) == (None, "capability_unavailable")
    assert select_reasoning_level({}, {}, "provider-default", ("low", "medium", "high")) == (None, "provider_default")


def test_explicit_native_qwen_control_format_is_optional_and_api_scoped():
    from autoresearch_pi.arc_agi_3_adapter import resolve_model_settings
    assert "thinking_format" not in resolve_model_settings({})
    configured = resolve_model_settings({"ARC_PI_API": "openai-completions", "ARC_PI_THINKING_FORMAT": "qwen"})
    assert configured["thinking_format"] == "qwen"
    with pytest.raises(ValueError):
        resolve_model_settings({"ARC_PI_THINKING_FORMAT": "qwen"})
    with pytest.raises(ValueError):
        resolve_model_settings({"ARC_PI_API": "openai-completions", "ARC_PI_THINKING_FORMAT": "invented"})

def test_execution_and_counterevidence_have_distinct_budget_choices():
    levels = ("low", "medium", "high")
    state = {"plan": {"status": "active", "needs_reconciliation": False,
                      "last_step_outcome": {"status": "matched"}}, "candidates": []}
    assert select_reasoning_level({}, state, "adaptive", levels) == ("low", "checked_execution")
    state["candidates"] = [{"status": "challenged"}]
    assert select_reasoning_level({}, state, "adaptive", levels) == ("high", "counterevidence_or_reconciliation")
    assert select_reasoning_level({"decision_state": {"knowledge_gaps": [{"status": "unresolved"}]}},
                                  {"plan": None}, "adaptive", levels) == ("medium", "discovery")

@pytest.mark.parametrize("policy,levels,output", [("invalid", (), None), ("adaptive", ("invented",), None),
                                                  ("provider-default", (), 0), ("provider-default", (), True)])
def test_invalid_options_fail_before_any_run(policy, levels, output):
    with pytest.raises(ValueError):
        validate_reasoning_options(policy, levels, output)

def test_invalid_envelope_cannot_create_output_or_launch_pi(tmp_path, monkeypatch):
    from autoresearch_pi import arc_agi_3_e2e as runner
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: pytest.fail("must validate before launching"))
    root = tmp_path / "new"
    with pytest.raises(ValueError):
        runner.run_arc_agi_3_e2e(root, arc_root=tmp_path, game="test", max_output_tokens=0)
    assert not root.exists()
    with pytest.raises(ValueError):
        runner._run_pi(root, bridge_url="http://unused", game="test", variant="treatment",
                       context_compaction=False, reasoning_levels=("unknown",))

def test_native_effort_rpc_and_output_reserve_are_effective(tmp_path, monkeypatch):
    import json
    from autoresearch_pi import arc_agi_3_e2e as runner
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "pi"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {
        "ARC_OPENAI_API_BASE": "https://provider.invalid/v1", "ARC_OPENAI_API_KEY": "test-only",
        "ARC_MODEL": "fixture-model", "ARC_PI_API": "openai-completions", "ARC_PI_THINKING_FORMAT": "qwen"})
    calls, envs = [], []
    class Kernel:
        def __init__(self, *args, **kwargs): self.sink = kwargs["event_sink"]; envs.append(kwargs["env"])
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def send(self, command, **params): calls.append((command, params)); return {"success": True}
        def prompt(self, text): return {"success": False}
    monkeypatch.setattr(runner, "PiKernel", Kernel)
    assert runner._run_pi(tmp_path, bridge_url="http://unused", game="test", variant="treatment",
                          context_compaction=False, reasoning_policy="adaptive",
                          reasoning_levels=("low", "medium", "high"), max_output_tokens=4096) == 1
    assert ("set_thinking_level", {"level": "medium"}) in calls
    assert envs[0]["PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS"] == "4096"
    model = json.loads((tmp_path / ".pi-agent/models.json").read_text())["providers"]["yibu"]["models"][0]
    assert model["maxTokens"] == 4096
    registry = json.loads((tmp_path / ".pi-agent/models.json").read_text())
    assert registry["providers"]["yibu"]["compat"]["thinkingFormat"] == "qwen"
    events = [json.loads(line) for line in (tmp_path / "pi-events.jsonl").read_text().splitlines()]
    assert events[-1]["type"] == "reasoning_policy_selection"
    assert events[-1]["capability_basis"] == "operator_declared"

def test_plan_existence_alone_is_not_a_checked_execution_budget():
    assert select_reasoning_level({}, {"plan": {"status": "active"}}, "adaptive", ("low", "medium", "high")) == ("medium", "discovery")

def test_legacy_current_planning_gap_prevents_low_execution_effort():
    plan = {"plan": {"status": "active", "last_step_outcome": {"status": "matched"}}}
    assert select_reasoning_level({"planning_gap": "Unknown goal rule"}, plan, "adaptive",
                                  ("low", "medium", "high")) == ("medium", "discovery")

def test_cli_routes_explicit_policy_levels_and_shared_envelope(tmp_path, monkeypatch):
    import json
    from autoresearch_pi import cli
    captured = {}
    summary = tmp_path / "summary.json"
    summary.write_text(json.dumps({"passed": True}), encoding="utf-8")
    def run(root, **kwargs): captured.update(kwargs); return summary
    monkeypatch.setattr(cli, "run_arc_agi_3_e2e", run)
    assert cli.main(["arc-agi-3-e2e", "--root", str(tmp_path / "run"), "--reasoning-policy", "adaptive",
                     "--reasoning-levels", "low,medium,high", "--max-output-tokens", "4096"]) == 0
    assert captured["reasoning_policy"] == "adaptive"
    assert captured["reasoning_levels"] == ("low", "medium", "high")
    assert captured["max_output_tokens"] == 4096
