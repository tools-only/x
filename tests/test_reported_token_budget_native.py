"""Native Pi cancellation and shared reported usage, not exact billing bounds."""
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def _rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


@contextmanager
def _local_provider(stop_reason, tokens=0, *, omit_usage=False):
    """Return real HTTP errors/SSE, leaving Pi to construct native messages."""
    release_stream = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["content-length"])))
            self.server.requests.append(payload)
            if stop_reason == "error" and tokens == 0:
                body = json.dumps({"error": {"message": "local budget fixture rejected request", "type": "fixture_error"}}).encode()
                self.send_response(400)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("connection", "close")
            self.end_headers()
            usage = {"prompt_tokens": tokens, "completion_tokens": 0, "total_tokens": tokens}
            chunk = {"id": "local-budget", "object": "chat.completion.chunk",
                     "choices": [{"index": 0, "delta": {"role": "assistant", "content": "local stream"}, "finish_reason": None}]}
            if not omit_usage and (tokens or stop_reason != "aborted"):
                chunk["usage"] = usage
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()
            if stop_reason == "aborted":
                # The fixture hook cancels on the real native text_delta.
                release_stream.wait(5)
                return
            final = {"id": "local-budget", "object": "chat.completion.chunk",
                     "choices": [{"index": 0, "delta": {}, "finish_reason":
                         "network_error" if stop_reason == "error" else "length" if stop_reason == "length" else "stop"}]}
            if not omit_usage:
                final["usage"] = usage
            self.wfile.write(f"data: {json.dumps(final)}\n\ndata: [DONE]\n\n".encode())
            self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.requests = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        release_stream.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _run_http_budget(root, shared, server, *, child=False, cancel=False, budget=True, extra_env=None):
    node, cli = _pi_cli()
    fixture = Path(__file__).with_name("pi_reported_token_budget_http_fixture.ts")
    root.mkdir(parents=True, exist_ok=True)
    command = [node, cli, "--mode", "rpc", "--provider", "reported-budget-http-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(fixture)]
    env = {"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_AUTORESEARCH_E2E_ROOT": str(root),
           "PI_PROVIDER_MAX_REPORTED_TOKENS": "20" if budget else "", "PI_PROVIDER_TOKEN_BUDGET_ROOT": str(shared),
           "PI_TASK_CHILD": "1" if child else "0", "PI_REPORTED_BUDGET_CANCEL_ON_TEXT": "1" if cancel else "0",
           "PI_REPORTED_BUDGET_HTTP_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1"}
    env.update(extra_env or {})
    with PiKernel(command, cwd=str(root), env=env, timeout=20) as kernel:
        kernel.send("set_auto_retry", enabled=False)
        kernel.prompt("Exercise local provider budget accounting.")
        events = kernel.wait_for_agent_events(timeout=20)
    (root / "native-pi-events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in events), encoding="utf-8")
    return _rows(root / "native-provider-messages.jsonl")


@pytest.mark.parametrize("stop_reason", ["error", "aborted"])
@pytest.mark.parametrize("first_child", [False, True])
def test_native_failed_default_zero_is_unknown_and_stops_shared_resume(tmp_path, stop_reason, first_child):
    shared = tmp_path / "shared"
    root = tmp_path / "first"
    with _local_provider(stop_reason) as server:
        messages = _run_http_budget(root, shared, server, child=first_child, cancel=stop_reason == "aborted")
        message = messages[-1]
        assert message["stopReason"] == stop_reason
        assert message["usage"]["totalTokens"] == 0
        assert message["errorMessage"]
        ledger = _rows(shared / "provider-token-budget.jsonl")
        assert any(row["event"] == "unmeasured_usage" and row["stop_reason"] == stop_reason
                   and row["scope"] == ("child" if first_child else "parent") for row in ledger)
        assert any(row["event"] == "budget_stop" and row["unmeasured"] and row["reported"] == 0 for row in ledger)
        assert not any(row["event"] == "reported_usage" for row in ledger)
        assert len(server.requests) == 1
        # Fresh processes in both scopes cannot reset the unknown shared cost.
        _run_http_budget(tmp_path / "resume-parent", shared, server)
        _run_http_budget(tmp_path / "resume-child", shared, server, child=True)
        assert len(server.requests) == 1


@pytest.mark.parametrize("stop_reason,tokens", [("stop", 7), ("error", 7), ("aborted", 7)])
def test_native_measured_positive_remains_reported(tmp_path, stop_reason, tokens):
    shared = tmp_path / "shared"
    with _local_provider(stop_reason, tokens) as server:
        messages = _run_http_budget(tmp_path / "first", shared, server, cancel=stop_reason == "aborted")
        assert messages[-1]["stopReason"] == stop_reason
        assert messages[-1]["usage"]["totalTokens"] == tokens
        ledger = _rows(shared / "provider-token-budget.jsonl")
        assert [{"event": row["event"], "tokens": row.get("tokens")} for row in ledger] == [
            {"event": "reported_usage", "tokens": tokens}]
        _run_http_budget(tmp_path / "resume", shared, server, cancel=stop_reason == "aborted")
        assert len(server.requests) == 2
        assert not any(row["event"] in {"unmeasured_usage", "budget_stop"}
                       for row in _rows(shared / "provider-token-budget.jsonl"))


@pytest.mark.parametrize("omit_usage", [False, True], ids=["explicit-zero", "missing-raw-usage"])
@pytest.mark.parametrize("first_child", [False, True], ids=["parent", "child"])
def test_native_successful_unmeasured_response_stops_all_shared_resumes(tmp_path, omit_usage, first_child):
    shared = tmp_path / "shared"
    with _local_provider("stop", omit_usage=omit_usage) as server:
        messages = _run_http_budget(tmp_path / "first", shared, server, child=first_child)
        assert messages[-1]["stopReason"] == "stop"
        # The real adapter supplies this default even when every SSE chunk omits usage.
        assert messages[-1]["usage"]["totalTokens"] == 0
        ledger = _rows(shared / "provider-token-budget.jsonl")
        assert any(row["event"] == "unmeasured_usage" and row["stop_reason"] == "stop"
                   and row["scope"] == ("child" if first_child else "parent") for row in ledger)
        assert any(row["event"] == "budget_stop" and row["unmeasured"] for row in ledger)
        assert not any(row["event"] == "reported_usage" for row in ledger)
        _run_http_budget(tmp_path / "resume-parent", shared, server)
        _run_http_budget(tmp_path / "resume-child", shared, server, child=True)
        assert len(server.requests) == 1


def test_native_unknown_usage_without_configured_budget_preserves_legacy_requests(tmp_path):
    shared = tmp_path / "shared"
    with _local_provider("stop", omit_usage=True) as server:
        _run_http_budget(tmp_path / "first", shared, server, budget=False)
        _run_http_budget(tmp_path / "second", shared, server, budget=False)
        assert len(server.requests) == 2
        assert not (shared / "provider-token-budget.jsonl").exists()


def test_native_pre_http_budget_decline_does_not_invent_unknown_usage(tmp_path):
    shared = tmp_path / "shared"
    shared.mkdir()
    (shared / "provider-token-budget.jsonl").write_text(
        json.dumps({"event": "reported_usage", "tokens": 20}) + "\n", encoding="utf-8")
    with _local_provider("stop", 7) as server:
        _run_http_budget(tmp_path / "parent", shared, server)
        _run_http_budget(tmp_path / "child", shared, server, child=True)
        assert len(server.requests) == 0
        ledger = _rows(shared / "provider-token-budget.jsonl")
        assert not any(row["event"] == "unmeasured_usage" for row in ledger)
        assert [row["tokens"] for row in ledger if row["event"] == "reported_usage"] == [20]
        for scope in ('parent', 'child'):
            debug = _rows(tmp_path / scope / 'context-token-debug.jsonl')
            assert not any(row.get('usage_status') == 'unknown' for row in debug)
            assert any(row.get('usage_status') == 'not_requested' for row in debug)


def test_reported_budget_stops_native_tool_continuation_and_cannot_reset_on_resume(tmp_path):
    steps = [{"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": f"step {i}"}} for i in range(5)]
    env = {"PI_PROVIDER_MAX_REPORTED_TOKENS": "10", "PI_PROVIDER_TOKEN_BUDGET_ROOT": str(tmp_path),
           "PI_EXTERNAL_USAGE_TOKENS": "6"}
    _run_fixture(tmp_path, "treatment", steps=steps, extra_env=env)
    def contexts():
        return (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(contexts()) == 2  # First stream below threshold; second crosses it.
    rows = [json.loads(l) for l in (tmp_path / "provider-token-budget.jsonl").read_text(encoding="utf-8").splitlines()]
    assert sum(r["tokens"] for r in rows if r["event"] == "reported_usage") == 12
    assert any(r["event"] == "budget_stop" and r["reported"] == 12 for r in rows)
    # Fresh Pi process/native session observes the same accumulated allowance.
    _run_fixture(tmp_path, "treatment", steps=steps, extra_env=env)
    assert len(contexts()) == 2
    assert (tmp_path / "task-checkpoint.json").exists()
