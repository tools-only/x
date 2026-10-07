"""Evaluation watchdog thresholds; these do not simulate ARC game quality."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("arc_bounded_run", Path(__file__).resolve().parents[1] / "tools/arc_bounded_run.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def write(root, filename, values):
    (root / filename).write_text("".join(json.dumps(row) + "\n" for row in values), encoding="utf-8")


def test_growth_uses_actual_parent_input_including_cache_and_separate_transport_measurement(tmp_path):
    write(tmp_path, "provider-telemetry.jsonl", [
        {"event": "assistant_message", "usage": {"input": 100, "cache_read": 100, "total_tokens": 210}},
        {"event": "assistant_message", "usage": {"input": 100, "cache_read": 300, "total_tokens": 410}},
    ])
    write(tmp_path, "subagent-provider-telemetry.jsonl", [
        {"event": "assistant_message", "usage": {"input": 9000, "total_tokens": 9100}},
    ])
    write(tmp_path, "context-token-debug.jsonl", [
        {"event": "provider_request_context", "measurement_basis": "provider_payload", "context_json_chars": 1100, "image_transport_chars": 100},
        {"event": "provider_request_context", "measurement_basis": "provider_payload", "context_json_chars": 4000, "image_transport_chars": 2900},
    ])
    value = module.status(tmp_path)
    assert value["input_ratio"] == 2
    assert value["context_chars_ratio"] == 1.1
    assert value["reported_tokens"] == 9720
    assert module.stop_reason(value, no_level_limit=10000, growth_limit=2, length_limit=1).startswith("provider input")


def test_unknown_length_and_no_level_stops_are_not_confused_with_game_progress():
    value = {"unmeasured_usage": False, "input_ratio": 1.5, "context_chars_ratio": 1.7,
             "levels": 0, "reported_tokens": 30, "actions": 2, "length_responses": 1}
    options = {"no_level_limit": 40, "growth_limit": 2, "length_limit": 1}
    assert module.stop_reason(value, **options) is None
    assert module.stop_reason({**value, "unmeasured_usage": True}, **options) == "unknown provider usage"
    assert "no first level" in module.stop_reason({**value, "reported_tokens": 40}, **options)
    assert module.stop_reason({**value, "levels": 1, "reported_tokens": 40}, **options) is None
    assert "length recovery" in module.stop_reason({**value, "actions": 0}, **options)


def test_opt_in_feedback_diagnostic_stops_after_length_even_after_an_action():
    value = {"unmeasured_usage": False, "input_ratio": 1.2, "context_chars_ratio": 1.2,
             "levels": 0, "reported_tokens": 19000, "actions": 1, "length_responses": 1}
    options = {"no_level_limit": 30000, "growth_limit": 2, "length_limit": 1,
               "runner_owns_no_level": True}
    assert module.stop_reason(value, **options) is None
    assert "diagnostic stop" in module.stop_reason(value, **options, stop_after_length=True)
    assert module.stop_reason({**value, "length_responses": 0}, **options, stop_after_length=True) is None
