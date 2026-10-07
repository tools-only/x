"""Real native Qwen HTTP transport; provider and ARC environment are controlled.

No custom streamSimple/provider extension, paid API or autonomous-game claim.
"""
import importlib.util
import json
import os
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi import arc_agi_3_e2e as current_runner
from test_pi_external_benchmark_native import _pi_cli


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


@contextmanager
def native_qwen_fixture(root, *, effect=1, maximum=3, length_requests=(),
                        usage_by_request=None, after_action=None):
    requests, actions, events = [], [], []
    state = {"frames": [[[0, 9, 0]]], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION1"],
             "action_budget": {"used": 0, "maximum": maximum, "total_used": 0, "total_maximum": maximum}}

    class ArcHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args): pass
        def reply(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            if self.path == "/state": self.reply(state)
            else:
                after = int(self.path.split("after=")[-1]) if "after=" in self.path else 0
                self.reply({"events": events[after:], "next": len(events)})
        def do_POST(self):
            assert self.path == "/action"
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert payload["action"] == "ACTION1"
            actions.append(payload)
            used = len(actions)
            level_before = state["levels_completed"]
            if after_action:
                after_action(used, state)
            if effect: state["frames"][0][0][0] = used % 2
            state["action_budget"] = {"used": used, "maximum": maximum,
                                      "total_used": used, "total_maximum": maximum}
            result = {**state, "public_transition": {
                          "level_changed": level_before != state["levels_completed"],
                          "level_before": level_before, "level_after": state["levels_completed"]},
                      "observation_delta": {"changed_cells": effect, "frame_available": True}}
            events.append({"event": "action", "index": used, "action": "ACTION1",
                           "frame": json.loads(json.dumps(state)),
                           "public_transition": result["public_transition"],
                           "observation_delta": result["observation_delta"]})
            self.reply(result)

    class ProviderHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args): pass
        def do_POST(self):
            assert self.path == "/v1/chat/completions"
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(payload)
            with (root / "native-http-requests.jsonl").open("a", encoding="utf-8") as out:
                out.write(json.dumps(payload) + "\n")
            index = len(requests)
            # Synthetic context projections can follow the terminal instruction.
            # This fixture owns its public action budget; after exhaustion its
            # next response finishes the read-only phase without another action.
            review = len(actions) >= maximum
            length = index in length_requests
            if length or review:
                delta = {"role": "assistant", "content": "Controlled public response."}
            else:
                delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": f"native-feedback-{index}",
                         "type": "function", "function": {"name": "arc_action", "arguments": json.dumps({
                             "action": "ACTION1", "reasoning": "Test the controlled public transition once."})}}]}
            finish = "length" if length else "stop" if review else "tool_calls"
            usage = (usage_by_request or {}).get(index, {
                "prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4})
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for part in [
                {"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                {"choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
                 **({"usage": usage} if usage is not None else {})},
            ]:
                self.wfile.write(("data: " + json.dumps({"id": f"fixture-{index}",
                    "object": "chat.completion.chunk", "model": "qwen3.8-27b", **part}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

    arc = ThreadingHTTPServer(("127.0.0.1", 0), ArcHandler)
    provider = ThreadingHTTPServer(("127.0.0.1", 0), ProviderHandler)
    threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (arc, provider)]
    for thread in threads: thread.start()
    try:
        yield {"arc_url": f"http://127.0.0.1:{arc.server_port}",
               "provider_url": f"http://127.0.0.1:{provider.server_port}/v1",
               "requests": requests, "actions": actions, "state": state}
    finally:
        for server in (arc, provider): server.shutdown(); server.server_close()
        for thread in threads: thread.join(timeout=5)


def run_native(root, fixture, monkeypatch, *, enabled=True, levels=("off", "medium"), settings=None,
               overrides=None, max_output_tokens=64, budgeted=True, reasoning_policy="adaptive-binary"):
    _pi_cli()
    runner = current_runner
    # Immutable red source is selected without replacing or editing live runtime.
    frozen_root = os.environ.get("ARC_FEEDBACK_TEST_RUNTIME_ROOT")
    if frozen_root:
        spec = importlib.util.spec_from_file_location("autoresearch_pi._feedback_red_runner",
            Path(frozen_root) / "src/autoresearch_pi/arc_agi_3_e2e.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
    root.mkdir(parents=True, exist_ok=True)
    environment = {"ARC_OPENAI_API_BASE": fixture["provider_url"], "ARC_OPENAI_API_KEY": "local-native-fixture",
                   "ARC_MODEL": "qwen3.8-27b", "ARC_PI_API": "openai-completions",
                   "ARC_PI_THINKING_FORMAT": "qwen", "ARC_INPUT_MODALITIES": "text",
                   "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
    environment.update(settings or {})
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: environment.copy())
    return runner._run_pi(root, bridge_url=fixture["arc_url"], game="controlled", variant="treatment",
        context_compaction=False, provider_name="native-feedback", model_name="qwen3.8-27b",
        input_modalities="text", provider_extension=None, reasoning_policy=reasoning_policy,
        reasoning_levels=levels, max_output_tokens=max_output_tokens, experiment_timeout_seconds=30,
        environment_overrides={**({"PI_REASONING_INITIAL_AFTER_FEEDBACK": "enabled"} if enabled else {}),
                               **({"PI_PROVIDER_MAX_REPORTED_TOKENS": "120000", "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "60000"}
                                  if budgeted else {}),
                               "PI_ARC_TOOL_DISCLOSURE": "on_demand", **(overrides or {})})


def assert_semantic_actions(root, count, effect):
    events = rows(root / "pi-events.jsonl")
    receipts = [row for row in events if row.get("type") == "tool_execution_end" and row.get("toolName") == "arc_action"]
    assert len(receipts) == count and not any(row.get("isError") for row in receipts)
    for receipt in receipts:
        result = receipt.get("result", {})
        details = result.get("details", receipt.get("evidence", {}))
        assert details["arc_action_boundary"] is True
        assert details["observation_delta"]["changed_cells"] == effect
    assert len([row for row in rows(root / "bridge-events.jsonl") if row["event"] == "action"]) == count
    return events


@pytest.mark.parametrize("effect,expected", [(1, [False, True, False]), (0, [False, True, True])],
                         ids=["positive-effect", "silent-milestone-preserved"])
def test_native_post_delays_first_deep_until_committed_arc_feedback(tmp_path, monkeypatch, effect, expected):
    with native_qwen_fixture(tmp_path, effect=effect) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch) == 0
    payloads = fixture["requests"]
    assert [body.get("enable_thinking") for body in payloads[:3]] == expected
    assert all(body["model"] == "qwen3.8-27b" for body in payloads)
    assert all(body["max_completion_tokens"] == 64 for body in payloads)
    registry = json.loads((tmp_path / ".pi-agent/models.json").read_text(encoding="utf-8"))
    assert registry["providers"]["native-feedback"]["compat"]["thinkingFormat"] == "qwen"
    events = assert_semantic_actions(tmp_path, 3, effect)
    first_action = next(i for i, row in enumerate(events) if row.get("type") == "tool_execution_end"
                        and row.get("toolName") == "arc_action")
    first_deep = next(i for i, row in enumerate(events) if row.get("type") == "reasoning_policy_selection"
                      and row.get("level") == "medium")
    assert first_action < first_deep
    if effect:
        consumed = [row for row in events if row.get("type") == "reasoning_policy_consumed"]
        assert len(consumed) == 1
        assert set(consumed[0]["opportunity_refs"]) == {
            "initial-discovery", "first-effect:initial:execution-observation-1"}


def test_native_length_recovery_preserves_both_allocations_and_feedback_latch(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=2, length_requests=(1, 3)) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:4]] == [False, False, True, True]
    events = assert_semantic_actions(tmp_path, 2, 1)
    lengths = [row for row in events if row.get("type") == "message_end"
               and row.get("message", {}).get("stopReason") == "length"]
    assert len(lengths) == 2
    consumed = [row for row in events if row.get("type") == "reasoning_policy_consumed"]
    assert len(consumed) == 1 and consumed[0]["opportunity_ref"] == "initial-discovery"


def test_native_default_binary_allocation_remains_enabled_initially(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, enabled=False) == 0
    assert [body.get("enable_thinking") for body in fixture["requests"][:3]] == [True, True, False]
    events = assert_semantic_actions(tmp_path, 3, 1)
    assert all("opportunity_refs" not in row for row in events if row.get("type") == "reasoning_policy_consumed")


def test_single_declared_off_level_uses_native_qwen_control_in_every_parent_request(tmp_path, monkeypatch):
    with native_qwen_fixture(tmp_path, maximum=2) as fixture:
        assert run_native(tmp_path, fixture, monkeypatch, enabled=False, levels=("off",),
                          reasoning_policy="adaptive", max_output_tokens=4096) == 0
    assert all(payload.get("enable_thinking") is False for payload in fixture["requests"])
    assert all(payload["max_completion_tokens"] == 4096 for payload in fixture["requests"])
    events = assert_semantic_actions(tmp_path, 2, 1)
    selections = [row for row in events if row.get('type') == 'reasoning_policy_selection']
    assert selections and all(row['level'] == 'off' for row in selections)


@pytest.mark.parametrize("levels,settings", [(("off", "low"), {}), (("off", "medium"), {"ARC_PI_THINKING_FORMAT": "openai"})],
                         ids=["undeclared-medium", "unknown-native-qwen-format"])
def test_invalid_feedback_configuration_sends_no_provider_request(tmp_path, monkeypatch, levels, settings):
    with native_qwen_fixture(tmp_path) as fixture:
        with pytest.raises(ValueError):
            run_native(tmp_path, fixture, monkeypatch, levels=levels, settings=settings)
    assert fixture["requests"] == [] and fixture["actions"] == []
