import json
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tools.restricted_expression_diagnostic import (
    DiagnosticConfig,
    DiagnosticReadiness,
    run_creator_discovery_smoke,
    run_diagnostic,
)


def _pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node unavailable")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        pytest.skip("installed Pi CLI unavailable")
    return node, str(cli)


def _jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_native_creator_discovery_uses_thin_bootstrap_and_no_authored_program(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    provider = project / "tests" / "pi_restricted_expression_diagnostic_provider.ts"
    root = tmp_path / "creator-discovery"
    root.mkdir()
    config = DiagnosticConfig(
        root=root,
        provider="restricted-expression-diagnostic-test",
        model="scripted",
        project_root=project,
        command=(node, cli, "--mode", "rpc"),
        provider_extension=provider,
        operation_timeout_seconds=30,
        total_wall_seconds=30,
    )

    report = run_creator_discovery_smoke(config, provider)

    tool_events = [
        event for event in report["events"]
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "task_harness"
    ]
    assert len(tool_events) == 1
    event = tool_events[0]
    assert not event.get("isError", False)
    result = event.get("result", {})
    result_text = " ".join(
        item.get("text", "") for item in result.get("content", [])
        if isinstance(item, dict)
    ) if isinstance(result, dict) else ""
    result_value = json.loads(result_text)
    assert result_value["name"] == "tool-creator"
    assert result_value["method_ref"].startswith("baseline_method:tool-creator@sha256:")
    assert result_value["creator_ref"] == result_value["method_ref"]

    reads = _jsonl(root / "task-baseline-method-reads.jsonl")
    assert len(reads) == 1
    assert reads[0]["name"] == "tool-creator"
    assert reads[0]["method_ref"] == result_value["method_ref"]
    assert not (root / "task-tools.jsonl").exists()
    assert not (root / "task-tool-events.jsonl").exists()

    contexts = _jsonl(root / "restricted-expression-provider-contexts.jsonl")
    assert len(contexts) == 2
    initial_context_text = json.dumps(contexts[0], ensure_ascii=False)
    context_text = json.dumps(contexts, ensure_ascii=False)
    # The creator read may legitimately return a placeholder authoring
    # template. The provider must not receive the diagnostic's pure program or
    # any authored solution before creator discovery.
    assert "task-pure-expression-v1" not in initial_context_text
    assert "groups-normal" not in context_text
    assert "oracle" not in context_text.lower()
    assert report["budget"]["stop_reason"] is None


def test_native_budget_hooks_record_real_turn_boundaries(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    provider = project / "tests" / "pi_restricted_expression_diagnostic_http_provider.ts"
    root = tmp_path / "native-budget-hooks"
    root.mkdir()
    config = DiagnosticConfig(
        root=root,
        provider="restricted-expression-diagnostic-http-test",
        model="scripted",
        project_root=project,
        command=(node, cli, "--mode", "rpc"),
        provider_extension=provider,
        operation_timeout_seconds=30,
        total_wall_seconds=30,
        max_turns=2,
        max_output_tokens=2,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            self.server.requests.append(payload)  # type: ignore[attr-defined]
            request = len(self.server.requests)  # type: ignore[attr-defined]
            if request == 1:
                chunks = [
                    {"choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": [{
                        "index": 0, "id": "http-call-1", "type": "function",
                        "function": {"name": "task_harness", "arguments": "{\"action\":\"read_method\",\"method_name\":\"tool-creator\"}"},
                    }]}, "finish_reason": None}]},
                    {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                     "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}},
                ]
            else:
                chunks = [
                    {"choices": [{"index": 0, "delta": {"role": "assistant", "content": "done"}, "finish_reason": None}]},
                    {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                     "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}},
                ]
            body = "".join(f"data: {json.dumps({'id': 'http-fixture', 'object': 'chat.completion.chunk', 'choices': chunk['choices'], **({'usage': chunk['usage']} if 'usage' in chunk else {})})}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
            encoded = body.encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.requests = []  # type: ignore[attr-defined]
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setenv("PI_DIAGNOSTIC_HTTP_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    import threading
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        report = run_diagnostic(config, DiagnosticReadiness(True, True, True, True, True))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        monkeypatch.undo()

    native_budget = _jsonl(root / "diagnostic-native-budget.jsonl")
    assert native_budget
    observations = [row for row in native_budget if "stop_reason" not in row]
    assert [row["turns"] for row in observations] == [1, 2]
    assert [row["output_tokens"] for row in observations] == [1, 2]
    assert native_budget[-1]["stop_reason"] == "max_turns_exceeded"
    payloads = _jsonl(root / "diagnostic-provider-payloads.jsonl")
    cap = lambda row: row.get("max_tokens", row.get("max_completion_tokens"))
    assert [cap(row) for row in payloads] == [2, 1]
    assert [cap(request) for request in server.requests] == [2, 1]
    assert report["budget"]["turns"] == 2
    assert report["budget"]["output_tokens"] == 2
