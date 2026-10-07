"""Native Pi lifecycle diagnostic using a recorded public action receipt.

The scripted provider and loopback receipt bridge make no paid model request
and no actual ARC game action. This is not full ARC closure acceptance.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from autoresearch_pi.arc_agi_3_e2e import _project_arc_feedback_kernel_event
from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli


def test_native_action_settlement_precedes_second_prompt_and_exact_receipt_context(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    fixture = json.loads((project / "tests/fixtures/stage122r1_action_receipt.json").read_text(encoding="utf-8"))
    actions = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, body):
            payload = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            self.reply(fixture["frame"] if self.path == "/state" else {"next": 0, "events": []})

        def do_POST(self):
            assert self.path == "/action"
            actions.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.reply(fixture["frame"])

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    raw_events = []
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo/pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests/pi_external_benchmark_provider.ts"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(tmp_path / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(tmp_path),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled",
        "PI_AUTORESEARCH_CONTEXT_MAX_CHARS": "60000",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_EXECUTION_GATE": "enabled",
        "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
        "PI_PROVIDER_MAX_REPORTED_TOKENS": "48000",
        "PI_PROVIDER_TOKEN_BUDGET_ROOT": str(tmp_path),
        "PI_ARC_NO_LEVEL_REPORTED_TOKENS": "26000",
        "PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE": "parent_provider_requests",
        "PI_EXTERNAL_STEPS": json.dumps([{"name": "arc_action", "arguments": fixture["input"]}]),
        "PI_EXTERNAL_USAGE_TOKENS": "1",
    }
    try:
        with (tmp_path / "raw-rpc-events.jsonl").open("w", encoding="utf-8") as trace:
            def persist(event):
                row = {"monotonic": time.perf_counter(), "event": event}
                raw_events.append(row)
                trace.write(json.dumps(row) + "\n")
                trace.flush()

            with PiKernel(
                command, cwd=str(tmp_path), env=env, timeout=30,
                event_projector=_project_arc_feedback_kernel_event, event_sink=persist,
            ) as kernel:
                kernel.prompt("Replay only the recorded public action receipt for lifecycle diagnosis.")
                first_events = kernel.wait_for_agent_events(
                    timeout=30, stop_after_progress_tools=("arc_action", "arc_actions"),
                )
                first_returned_at = time.perf_counter()
                between_start = len(kernel.events)
                kernel.send("set_thinking_level", level="medium")
                second_prompt = kernel.prompt(
                    "Read-only next turn: compare the recorded prediction and returned receipt. No environment action.",
                )
                between_events = [entry.payload for entry in kernel.events[between_start:]]
                second_events = kernel.wait_for_agent_events(timeout=30)
                contexts = [json.loads(line) for line in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]

        card = None
        if len(contexts) >= 2:
            texts = [
                block.get("text", "")
                for message in contexts[1]["context"]["messages"]
                for block in message.get("content", []) if isinstance(block, dict)
            ]
            card = json.loads(next(text for text in texts if text.startswith("CURRENT TASK STATE")).split(": ", 1)[1])
        agent_end = next(row["monotonic"] for row in raw_events if row["event"].get("type") == "agent_end")
        settled = next(row["monotonic"] for row in raw_events if row["event"].get("type") == "agent_settled")
        audit = {
            "provider_environment": "current native Pi/ARC extension; scripted streamSimple provider; recorded public receipt bridge",
            "paid_model_requests": 0, "actual_arc_actions": 0,
            "first_wait_types": [event["type"] for event in first_events],
            "between_first_and_second_wait_types": [event["type"] for event in between_events],
            "second_prompt": second_prompt,
            "second_wait_types": [event["type"] for event in second_events],
            "provider_contexts_after_second_wait": len(contexts),
            "replayed_action_calls": len(actions),
            "settlement_latency_seconds": settled - agent_end,
            "first_wait_return_after_settled_seconds": first_returned_at - settled,
            "next_context_card": card,
        }
        (tmp_path / "settlement-replay-audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
        assert any(event.get("type") == "agent_settled" for event in first_events), audit
        assert not any(event.get("type") == "agent_settled" for event in between_events), audit
        assert second_prompt.get("success") is True
        assert len(contexts) == 2, audit
        assert any(event.get("type") == "turn_start" for event in second_events), audit
        assert sum(event.get("type") == "agent_settled" for event in second_events) == 1
        assert not any(event.get("command") == "abort" for event in first_events)
        assert len(actions) == 1
        expected = fixture["expected"]
        assert card["last_action"] == expected["last_action"]
        assert card["last_action"]["changed_cells"] == 0
        assert card["hypothesis"] == expected["hypothesis"]
        for field in ("subgoal", "hypothesis", "prediction", "falsifier", "next_step"):
            assert card["decision_capsule"][field] == expected["decision_capsule"][field]
        assert card["decision_capsule"]["observation_ref"] == expected["observation_ref"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
