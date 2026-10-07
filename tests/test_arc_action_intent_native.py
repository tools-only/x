"""Replay public action intent through the real Pi observer and a fresh process.

HTTP/provider are deterministic diagnostics, not ARC closure or game-quality evidence.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from test_arc_capability_surface_native import _run_arc_parent


@pytest.mark.parametrize("batch", [False, True])
def test_latest_action_intent_survives_reload_without_rebinding_old_prediction(tmp_path, batch):
    used = 0
    state = {"frames": [[[0, 9, 0]]], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION1", "ACTION2"], "action_budget": {"total_used": 0}}

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
            nonlocal used
            assert self.path == "/action"
            json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            used += 1
            state["action_budget"] = {"total_used": used, "total_maximum": 60}
            self.reply({**state, "public_transition": {"level_changed": False, "level_before": 0, "level_after": 0},
                        "observation_delta": {"changed_cells": 0, "frame_available": True}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {"PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
           "PI_AUTORESEARCH_CONTEXT_MAX_CHARS": "8000"}
    reason = "Follow the revised branch; preserve the counterexample. " * 25 + "EXACT_INTENT_TAIL"
    try:
        events = _run_arc_parent(tmp_path, [{"name": "arc_action", "arguments": {
            "action": "ACTION1", "reasoning": "Original probe",
            "decision": {"hypothesis": "Old branch", "prediction": "Old local prediction"}}}], extra_env=env)
        assert not [e for e in events if e.get("isError")]
        first = json.loads((tmp_path / "task-checkpoint.json").read_text())
        origin = first["latest_observation"]["observation_id"]
        action = {"action": "ACTION2", "reasoning": reason}
        step = {"name": "arc_actions", "arguments": {"actions": [action]}} if batch else {
            "name": "arc_action", "arguments": action}
        events = _run_arc_parent(tmp_path, [step], extra_env=env)
        assert not [e for e in events if e.get("isError")]
        _run_arc_parent(tmp_path, [], extra_env=env)  # Empty transcript, canonical checkpoint only.
        context = json.loads((tmp_path / "provider-contexts.jsonl").read_text().splitlines()[-1])["context"]
        texts = [p["text"] for m in context["messages"] for p in m.get("content", []) if p.get("type") == "text"]
        card = json.loads(next(t for t in texts if t.startswith("CURRENT TASK STATE")).split(": ", 1)[1])
        assert card["last_action"]["reasoning"] == reason
        assert card["last_action"]["action"] == "ACTION2"
        assert card["decision_capsule"]["observation_ref"] == f"observation:{origin}@v1"
        assert card["decision_capsule"]["prediction"] == "Old local prediction"
        assert card.get("current_strategy") is None  # No semantic inference from the public reason.
        assert card["last_action"]["observation_id"] != origin
        events = _run_arc_parent(tmp_path, [{"name": "arc_action", "arguments": {"action": "ACTION1"}}], extra_env=env)
        assert not [e for e in events if e.get("isError")]
        checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
        assert "reasoning" not in checkpoint["recent_actions"][-1]
        _run_arc_parent(tmp_path, [{"name": "arc_action", "arguments": {"action": "RESET"}}], extra_env=env)
        _run_arc_parent(tmp_path, [], extra_env=env)
        context = json.loads((tmp_path / "provider-contexts.jsonl").read_text().splitlines()[-1])["context"]
        texts = [p["text"] for m in context["messages"] for p in m.get("content", []) if p.get("type") == "text"]
        card = json.loads(next(t for t in texts if t.startswith("CURRENT TASK STATE")).split(": ", 1)[1])
        assert "decision_capsule" not in card  # RESET preserves history, not current applicability.
    finally:
        server.shutdown()
        server.server_close()
