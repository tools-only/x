"""Actual native HTTP counts and semantic tools at parent request admission."""
import importlib.util
import json
import os
import stat
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from autoresearch_pi import arc_agi_3_e2e as current_runner
from autoresearch_pi.pi_kernel import PiKernel
from test_arc_request_admission_native import controlled_arc, rows
from test_pi_external_benchmark_native import _pi_cli
from test_reported_token_budget_native import _local_provider, _run_http_budget


@contextmanager
def native_provider(root, steps=("contract", "checkpoint", "arc"), on_request=None):
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(payload)
            if on_request: on_request(len(requests))
            with (root / "actual-parent-http.jsonl").open("a", encoding="utf-8") as out:
                out.write(json.dumps(payload) + "\n")
            step = steps[min(len(requests)-1, len(steps)-1)]
            calls = {"contract": ("task_harness", {"action": "contract"}),
                     "probe": ("native_admission_probe", {}),
                     "checkpoint": ("task_checkpoint", {"action": "update", "working_summary": "SELECTED_SEMANTIC_RECEIPT"}),
                     "arc": ("arc_action", {"action": "ACTION1", "reasoning": "Observe one public effect."})}
            if step == "length": delta = {"role": "assistant", "content": "Controlled length."}; finish = "length"
            elif step == "stop": delta = {"role": "assistant", "content": "Controlled completion."}; finish = "stop"
            else:
                name, arguments = calls[step]
                delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": f"admission-{len(requests)}",
                         "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}
                finish = "tool_calls"
            self.send_response(200); self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close"); self.end_headers()
            for part in [{"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                         {"choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
                          "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}]:
                self.wfile.write(("data: " + json.dumps({"id": "native-admission", "object": "chat.completion.chunk", **part}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try: yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally: server.shutdown(); server.server_close(); thread.join(timeout=5)


def run_parent(root, bridge_url, provider_url, monkeypatch, *, limit="6", scope="parent_provider_requests"):
    _pi_cli(); root.mkdir(parents=True, exist_ok=True)
    runner = current_runner
    frozen = os.environ.get("ARC_PARENT_ADMISSION_RUNTIME_ROOT")
    if frozen:
        spec = importlib.util.spec_from_file_location("autoresearch_pi._parent_admission_red", Path(frozen) / "src/autoresearch_pi/arc_agi_3_e2e.py")
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {
        "ARC_OPENAI_API_BASE": provider_url, "ARC_OPENAI_API_KEY": "local-fixture", "ARC_MODEL": "scripted",
        "ARC_PI_API": "openai-completions", "ARC_INPUT_MODALITIES": "text", "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"})
    env = {"PI_PROVIDER_MAX_REPORTED_TOKENS": "120000", "PI_ARC_TOOL_DISCLOSURE": "on_demand"}
    if limit is not None: env["PI_ARC_NO_LEVEL_REPORTED_TOKENS"] = limit
    if scope is not None: env["PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE"] = scope
    return runner._run_pi(root, bridge_url=bridge_url, game="controlled", variant="treatment", context_compaction=False,
        provider_name="parent-admission-native", model_name="scripted", input_modalities="text", provider_extension=None,
        reasoning_policy="provider-default", max_output_tokens=64, experiment_timeout_seconds=20, environment_overrides=env)


def test_internal_parent_request_declined_after_selected_non_arc_receipts(tmp_path, monkeypatch):
    with controlled_arc(maximum=1) as (arc_url, state), native_provider(tmp_path) as (provider_url, requests):
        assert run_parent(tmp_path, arc_url, provider_url, monkeypatch) == 125
        assert len(requests) == 2 and state["action_budget"]["total_used"] == 0
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text(encoding="utf-8"))
    assert checkpoint["working_summary"] == "SELECTED_SEMANTIC_RECEIPT"
    receipts = [r for r in rows(tmp_path / "pi-events.jsonl") if r.get("type") == "tool_execution_end"]
    assert [r["toolName"] for r in receipts] == ["task_harness", "task_checkpoint"]
    assert not any(r.get("isError") for r in receipts)
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["scope"] == "parent_provider_requests" and audit["reported_tokens"] == 8
    assert audit["provider_http_started"] is False
    # Native aborted/default-zero after a proven pre-HTTP rejection is not
    # a new provider attempt. Preserve measured earlier calls without adding
    # a fictitious unknown bill for the declined continuation.
    ledger = rows(tmp_path / "provider-token-budget.jsonl")
    assert sum(r.get("tokens", 0) for r in ledger if r["event"] == "reported_usage") == 8
    assert not any(r["event"] == "unmeasured_usage" for r in ledger)
    assert any(r["event"] == "request_declined" and r["provider_request_admitted"] is False for r in ledger)


@pytest.mark.parametrize("kind", ["arc", "length"])
def test_selected_arc_receipt_and_length_finish_before_next_request_stop(tmp_path, monkeypatch, kind):
    with controlled_arc(maximum=1) as (arc_url, state), native_provider(tmp_path, (kind,)) as (url, requests):
        assert run_parent(tmp_path, arc_url, url, monkeypatch, limit="1") == 125
        assert len(requests) == 1 and state["action_budget"]["total_used"] == int(kind == "arc")
    if kind == "arc":
        receipts = [r for r in rows(tmp_path / "pi-events.jsonl") if r.get("type") == "tool_execution_end"]
        assert len(receipts) == 1 and receipts[0]["result"]["details"]["arc_action_boundary"] is True


@pytest.mark.parametrize("kind", ["default-outer", "opt-out", "achieved-level"])
def test_default_optout_and_achieved_level_allow_internal_requests(tmp_path, monkeypatch, kind):
    with controlled_arc(maximum=1) as (arc_url, state), native_provider(tmp_path) as (url, requests):
        if kind == "achieved-level": state["levels_completed"] = 1
        result = run_parent(tmp_path, arc_url, url, monkeypatch,
            limit=None if kind == "opt-out" else "6", scope=None if kind != "achieved-level" else "parent_provider_requests")
        assert result in (0, 125) and len(requests) == 3 and state["action_budget"]["total_used"] == 1


def test_shared_native_child_cost_stops_parent_internal_request(tmp_path, monkeypatch):
    root = tmp_path / "parent"; root.mkdir()
    with _local_provider("stop", 7) as provider: _run_http_budget(tmp_path / "child", root, provider, child=True)
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(root) as (url, requests):
        assert run_parent(root, arc_url, url, monkeypatch, limit="10") == 125
        assert len(requests) == 1
    audit = json.loads((root / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reported_tokens"] == 11


def test_native_audit_write_failure_cannot_be_host_swallowed_into_http(tmp_path, monkeypatch):
    (tmp_path / "arc-parent-provider-admission.jsonl").mkdir()
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path) as (url, requests):
        assert run_parent(tmp_path, arc_url, url, monkeypatch) == 125
        assert requests == []


def diagnostic_kernel(root, arc_url, provider_url, *, child=False, invalid_ledger=None, checkpoint="6", shared_root=None):
    node, cli = _pi_cli()
    root.mkdir(parents=True, exist_ok=True)
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(exist_ok=True)
    (agent_dir / "settings.json").write_text(json.dumps({"compaction": {
        "enabled": False, "reserveTokens": 32, "keepRecentTokens": 1}}), encoding="utf-8")
    fixture = Path(__file__).with_name("pi_arc_parent_admission_diagnostics.ts")
    command = [node, cli, "--mode", "rpc", "--provider", "parent-admission-native", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(fixture)]
    env = {"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_AUTORESEARCH_E2E_ROOT": str(root),
           "PI_PROVIDER_MAX_REPORTED_TOKENS": "120000", "PI_ARC_NO_LEVEL_REPORTED_TOKENS": checkpoint,
           "PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE": "parent_provider_requests", "PI_TASK_CHILD": "1" if child else "0",
           "PI_ARC_BRIDGE_URL": arc_url, "PI_ADMISSION_HTTP_BASE_URL": provider_url,
           "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}
    if shared_root is not None: env["PI_PROVIDER_TOKEN_BUDGET_ROOT"] = str(shared_root)
    if invalid_ledger is not None: env["PI_ADMISSION_APPEND_INVALID_LEDGER"] = invalid_ledger
    return PiKernel(command, cwd=str(root), env=env, timeout=20)


@pytest.mark.parametrize("invalid", ["[]", "1", '"scalar"', '{"event":"unmeasured_usage"}'])
def test_native_bad_shared_ledger_after_semantic_receipt_blocks_http(tmp_path, invalid):
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path, ("probe", "stop")) as (url, requests):
        with diagnostic_kernel(tmp_path, arc_url, url, invalid_ledger=invalid) as kernel:
            kernel.prompt("Run the public probe once.")
            kernel.wait_for_agent_events(timeout=20)
        assert len(requests) == 1
    receipts = rows(tmp_path / "diagnostic-tool-receipts.jsonl")
    assert receipts[0]["result"]["details"]["value"] == 42
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reason"] == "unknown provider usage"


@pytest.mark.parametrize("levels,expected_requests", [("unknown", 1), (1, 2)], ids=["unknown-state", "fresh-achieved-level"])
def test_native_uses_fresh_public_levels_after_first_response(tmp_path, levels, expected_requests):
    with controlled_arc(maximum=1) as (arc_url, state):
        def change_level(_index): state["levels_completed"] = levels
        with native_provider(tmp_path, ("probe", "stop"), on_request=change_level) as (url, requests):
            with diagnostic_kernel(tmp_path, arc_url, url, checkpoint="3") as kernel:
                kernel.prompt("Run the public probe once.")
                kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == expected_requests
    assert rows(tmp_path / "diagnostic-tool-receipts.jsonl")[0]["result"]["details"]["value"] == 42


def test_explicit_native_scope_rejects_unmeasured_compaction_before_http(tmp_path):
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path, ("stop",)) as (url, requests):
        with diagnostic_kernel(tmp_path, arc_url, url, checkpoint="10") as kernel:
            kernel.prompt("Controlled public history for compaction. " * 100)
            kernel.wait_for_agent_events(timeout=20)
            compact = kernel.send("compact")
            assert compact["success"] is False and compact["error"] == "Compaction cancelled"
            stop_path = tmp_path / "arc-parent-provider-admission-stop.json"
            first_stop = stop_path.read_text(encoding="utf-8")
            assert not any(r["event"] == "unmeasured_usage" for r in rows(tmp_path / "provider-token-budget.jsonl"))
            kernel.prompt("Continue after the declined compaction.")
            kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == 1
        for child in (False, True):
            root = tmp_path / ("fresh-child" if child else "fresh-parent")
            with diagnostic_kernel(root, arc_url, url, checkpoint="10", child=child, shared_root=tmp_path) as kernel:
                kernel.prompt("Try a fresh process using the same stopped allowance.")
                kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == 1
        assert stop_path.read_text(encoding="utf-8") == first_stop
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["hook"] == "session_before_compact" and audit["reported_tokens"] == 4
    assert audit["native_compaction_policy"] == "decline_unmeasured"


@pytest.mark.parametrize("failure", ["audit", "ledger"], ids=["audit-unwritable", "ledger-unwritable"])
def test_under_limit_compaction_decline_is_durable_with_write_failure(tmp_path, failure):
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path, ("stop",)) as (url, requests):
        with diagnostic_kernel(tmp_path, arc_url, url, checkpoint="10") as kernel:
            kernel.prompt("Controlled public history for compaction. " * 100)
            kernel.wait_for_agent_events(timeout=20)
            ledger = tmp_path / "provider-token-budget.jsonl"
            if failure == "audit":
                journal = tmp_path / "arc-parent-provider-admission.jsonl"
                journal.rename(tmp_path / "admission-before-failure.jsonl")
                journal.mkdir()
            else:
                ledger.rename(tmp_path / "ledger-before-failure.jsonl")
                ledger.mkdir()
            compact = kernel.send("compact")
            assert compact["success"] is False and compact["error"] == "Compaction cancelled"
            if failure == "audit":
                assert any(r["event"] == "budget_stop" for r in rows(ledger))
                assert not any(r["event"] == "unmeasured_usage" for r in rows(ledger))
                journal.rmdir()
            else:
                assert (tmp_path / "provider-token-budget-stop.json").exists()
                ledger.rmdir()
                ledger.write_text((tmp_path / "ledger-before-failure.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
            kernel.prompt("The write path recovered; the allowance remains stopped.")
            kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == 1
        with diagnostic_kernel(tmp_path / "fresh-child", arc_url, url, child=True, shared_root=tmp_path) as kernel:
            kernel.prompt("A fresh child also shares the stopped allowance.")
            kernel.wait_for_agent_events(timeout=20)
        assert len(requests) == 1


def test_native_public_state_body_is_bounded_before_http(tmp_path):
    with controlled_arc(maximum=1) as (arc_url, state), native_provider(tmp_path, ("stop",)) as (url, requests):
        state["padding"] = "x" * (1024 * 1024)
        with diagnostic_kernel(tmp_path, arc_url, url) as kernel:
            kernel.prompt("Request with oversized public state.")
            kernel.wait_for_agent_events(timeout=20)
        assert requests == []
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert "body limit" in audit["state_error"]


def test_native_public_state_has_absolute_deadline_despite_trickling_bytes(tmp_path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            try:
                self.wfile.write(b'{"levels_completed":0,"padding":"')
                self.wfile.flush()
                for _ in range(240):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.03)
                self.wfile.write(b'"}')
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with native_provider(tmp_path, ("stop",)) as (url, requests):
            with diagnostic_kernel(tmp_path, f"http://127.0.0.1:{server.server_port}", url) as kernel:
                kernel.prompt("Use a state response that keeps sending bytes.")
                kernel.wait_for_agent_events(timeout=20)
            assert requests == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert "deadline" in audit["state_error"]


def test_native_unreachable_public_state_blocks_http(tmp_path):
    with native_provider(tmp_path, ("stop",)) as (url, requests):
        with diagnostic_kernel(tmp_path, "http://127.0.0.1:1", url) as kernel:
            kernel.prompt("Use an unreachable local ARC bridge.")
            kernel.wait_for_agent_events(timeout=20)
        assert requests == []
    audit = json.loads((tmp_path / "arc-parent-provider-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reason"] == "unknown current public ARC levels" and audit["state_error"]


def test_reported_usage_write_failure_stops_native_request_and_fresh_child(tmp_path):
    ledger = tmp_path / "provider-token-budget.jsonl"
    ledger.write_text('{"event":"reported_usage","tokens":1}\n', encoding="utf-8")
    ledger.chmod(stat.S_IREAD)
    try:
        with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path, ("probe", "stop")) as (url, requests):
            with diagnostic_kernel(tmp_path, arc_url, url, checkpoint="10") as kernel:
                kernel.prompt("Run the public probe once.")
                kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == 1
            marker = json.loads((tmp_path / "provider-token-budget-stop.json").read_text(encoding="utf-8"))
            assert marker["reason"] == "reported usage ledger write failed"
            ledger.chmod(stat.S_IREAD | stat.S_IWRITE)
            with diagnostic_kernel(tmp_path / "fresh-child", arc_url, url, child=True, shared_root=tmp_path) as kernel:
                kernel.prompt("Try the recovered write path with the same stopped allowance.")
                kernel.wait_for_agent_events(timeout=20)
            assert len(requests) == 1
    finally:
        ledger.chmod(stat.S_IREAD | stat.S_IWRITE)


def test_child_requests_keep_existing_hard_budget_scope(tmp_path):
    with controlled_arc(maximum=1) as (arc_url, _), native_provider(tmp_path, ("probe", "stop")) as (url, requests):
        with diagnostic_kernel(tmp_path, arc_url, url, child=True) as kernel:
            kernel.prompt("Run the public probe once.")
            kernel.wait_for_agent_events(timeout=20)
        assert len(requests) == 2
    assert not (tmp_path / "arc-parent-provider-admission.jsonl").exists()
