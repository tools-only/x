"""ARC action knowledge must validate before touching the irreversible bridge."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from test_arc_capability_surface_native import _run_arc_parent


@pytest.mark.parametrize("knowledge", [
    {"runtime_fact": "MUST NOT VANISH"},
    {"counterevidence": [{"source_ref": "memory:missing@v1"}]},
    {"knowledge_gaps": [42]},
    {"knowledge_gaps": {"question": "A list or authored text is required"}},
])
def test_invalid_knowledge_rejected_before_bridge_and_old_state_retained(tmp_path, knowledge):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "decision_state": {"counterevidence": ["Keep the earlier counterexample"]}}},
        {"name": "arc_action", "arguments": {"action": "ACTION1", "decision": {"knowledge": knowledge}}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "next_step": "Recover"}},
    ])
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    assert [bool(c.get("isError")) for c in calls] == [False, True, False]
    error = json.dumps(calls[1]["result"])
    assert any(text in error for text in ["decision_state field", "resource", "knowledge_gaps"]), error
    assert "fetch failed" not in error  # The closed fixture bridge must not be contacted.
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"]["counterevidence"] == ["Keep the earlier counterexample"]


@pytest.mark.parametrize("arguments, expected", [
    ({"action": "ACTION1", "subgoal": "left", "decision": {"subgoal": "right"}}, "conflict for subgoal"),
    ({"action": "ACTION1", "unsupported_field": "never forward"}, "unsupported arc_action fields"),
    ({"action": "ACTION1", "next_step": 3}, "next_step must be a string"),
    ({"action": "ACTION1", "decision": {"knowledge": {"next_step": "a", "next_decision": "b"}}}, "conflict for next_decision"),
])
def test_misplaced_action_metadata_conflicts_fail_before_bridge(tmp_path, arguments, expected):
    events = _run_arc_parent(tmp_path, [{"name": "arc_action", "arguments": arguments}])
    result = next(event for event in events if event.get("type") == "tool_execution_end")
    assert result["isError"] is True
    message = json.dumps(result["result"])
    assert expected in message, message
    assert "fetch failed" not in message


def test_misnested_next_step_executes_once_and_persists_without_repair_turn(tmp_path):
    received = []
    state = {"frames": [[[0, 9, 0]]], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION4"], "action_budget": {"total_used": 0}}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            self.reply(state if self.path == "/state" else {"next": 0, "events": []})
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            state["action_budget"] = {"total_used": len(received), "total_maximum": 60}
            self.reply({**state, "public_transition": {"level_changed": False},
                        "observation_delta": {"changed_cells": 0, "frame_available": True}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        events = _run_arc_parent(tmp_path, [{"name": "arc_action", "arguments": {
            "action": "ACTION4", "decision": {"next_step": "Map the remaining control",
                "knowledge": {"next_step": "Then compare the configuration", "known_effects": ["Measured displacement"]}}}}],
            extra_env={"PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}"})
    finally:
        server.shutdown()
        server.server_close()
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(calls) == 1 and not calls[0].get("isError")
    assert received == [{"action": "ACTION4"}]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"]["next_decision"] == "Then compare the configuration"
    assert checkpoint["next_step"] == "Map the remaining control"
    assert not checkpoint.get("pending_operations")
