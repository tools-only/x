"""Outer request admission with real Pi/ARC tools and controlled external APIs.

This is functional wiring evidence, not official SDK or model-quality acceptance.
"""
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.arc_agi_3_e2e import _run_pi
from test_pi_external_benchmark_native import _pi_cli
from test_reported_token_budget_native import _local_provider, _run_http_budget


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


@contextmanager
def controlled_arc(*, maximum=3, achieved_level=False):
    state = {"frames": [[[0, 9, 0]]], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION1"],
             "action_budget": {"used": 0, "maximum": maximum, "total_used": 0, "total_maximum": maximum}}
    events = []

    class Handler(BaseHTTPRequestHandler):
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
            before = state["levels_completed"]
            used = state["action_budget"]["total_used"] + 1
            state["action_budget"] = {"used": used, "maximum": maximum,
                                      "total_used": used, "total_maximum": maximum}
            state["levels_completed"] = 1 if achieved_level else 0
            result = {**state, "public_transition": {"level_changed": before != state["levels_completed"],
                      "level_before": before, "level_after": state["levels_completed"]},
                      "observation_delta": {"changed_cells": 0, "frame_available": True}}
            events.append({"event": "action", "index": used, "action": "ACTION1",
                           "frame": json.loads(json.dumps(state)),
                           "public_transition": result["public_transition"],
                           "observation_delta": result["observation_delta"]})
            self.reply(result)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try: yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def run_parent(root, bridge_url, *, checkpoint="6", extra_env=None):
    _pi_cli()
    root.mkdir(parents=True, exist_ok=True)
    env = {"PI_PROVIDER_MAX_REPORTED_TOKENS": "120000", "PI_ARC_TOOL_DISCLOSURE": "on_demand",
           "PI_HARNESS_CAPABILITY_VALIDATION": "", "PI_HARNESS_COMPOSITION_VALIDATION": ""}
    env["PI_ARC_NO_LEVEL_REPORTED_TOKENS"] = checkpoint if checkpoint is not None else ""
    env.update(extra_env or {})
    return _run_pi(root, bridge_url=bridge_url, game="controlled", variant="treatment",
                   context_compaction=False, provider_name="arc-admission-test", model_name="scripted",
                   input_modalities="text", provider_extension=Path(__file__).with_name("pi_arc_request_admission_fixture.ts"),
                   environment_overrides=env, experiment_timeout_seconds=30)


@pytest.mark.parametrize("maximum", [2, 3], ids=["terminal-review", "normal-followup"])
def test_crossing_checkpoint_commits_selected_action_receipt_before_stopping(tmp_path, maximum):
    with controlled_arc(maximum=maximum) as (bridge_url, state):
        result = run_parent(tmp_path, bridge_url)
        assert state["action_budget"]["total_used"] == 2
    requests = rows(tmp_path / "admission-provider-requests.jsonl")
    assert len(requests) == 2 and not any(row["abortedAtEntry"] for row in requests)
    receipts = rows(tmp_path / "admission-action-receipts.jsonl")
    assert len(receipts) == 2 and not any(row["isError"] for row in receipts)
    assert all(row["result"]["terminate"] is True for row in receipts)
    assert all(row["result"]["details"]["arc_action_boundary"] is True for row in receipts)
    assert all(row["result"]["details"]["observation_delta"]["changed_cells"] == 0 for row in receipts)
    assert len([row for row in rows(tmp_path / "bridge-events.jsonl") if row["event"] == "action"]) == 2
    ledger = rows(tmp_path / "provider-token-budget.jsonl")
    assert [row["tokens"] for row in ledger if row["event"] == "reported_usage"] == [4, 4]
    assert not any(row["event"] in {"budget_stop", "unmeasured_usage"} for row in ledger)
    audit = json.loads((tmp_path / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
    assert result == 125 and audit["reason"] == "no first level by declared cost checkpoint"
    assert audit["reported_tokens"] == 8 and audit["levels_completed"] == 0
    assert audit["scope"] == "outer_prompt_dispatch"
    assert not (tmp_path / "runner-error.json").exists()


@pytest.mark.parametrize("achieved_level,checkpoint", [(True, "6"), (False, None)],
                         ids=["achieved-level", "opt-out"])
def test_achieved_level_or_opt_out_preserves_outer_continuation(tmp_path, achieved_level, checkpoint):
    with controlled_arc(achieved_level=achieved_level) as (bridge_url, state):
        assert run_parent(tmp_path, bridge_url, checkpoint=checkpoint) == 0
        assert state["action_budget"]["total_used"] == 3
        assert state["levels_completed"] == int(achieved_level)
    assert len(rows(tmp_path / "admission-provider-requests.jsonl")) == 3
    assert len(rows(tmp_path / "admission-action-receipts.jsonl")) == 3
    assert not (tmp_path / "arc-request-admission-stop.json").exists()


def test_real_native_child_reported_usage_counts_toward_parent_checkpoint(tmp_path):
    root = tmp_path / "parent"
    # A real native child-scope response writes usage; parent consumes that
    # shared ledger rather than a synthetic telemetry total or reset allowance.
    with _local_provider("stop", 7) as provider:
        _run_http_budget(tmp_path / "child", root, provider, child=True)
        assert len(provider.requests) == 1
    with controlled_arc() as (bridge_url, state):
        assert run_parent(root, bridge_url, checkpoint="10") == 125
        assert state["action_budget"]["total_used"] == 1
    assert len(rows(root / "admission-provider-requests.jsonl")) == 1
    ledger = rows(root / "provider-token-budget.jsonl")
    assert [(row["scope"], row["tokens"]) for row in ledger if row["event"] == "reported_usage"] == [
        ("child", 7), ("parent", 4)]
    audit = json.loads((root / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reported_tokens"] == 11
    assert len(rows(root / "admission-action-receipts.jsonl")) == 1


@pytest.mark.parametrize("ledger", ["{partial", '{"event":"reported_usage","tokens":true}\n',
                         '{"event":"unmeasured_usage","scope":"child"}\n', " \n",
                         '{"event":"other","invalid_json":NaN}\n', None],
                         ids=["malformed", "invalid-usage", "unknown-child", "whitespace-record",
                              "non-json-constant", "unreadable"])
def test_bad_shared_ledger_declines_initial_request_with_audit(tmp_path, ledger):
    path = tmp_path / "provider-token-budget.jsonl"
    if ledger is None: path.mkdir()
    else: path.write_text(ledger, encoding="utf-8")
    with controlled_arc() as (bridge_url, state):
        assert run_parent(tmp_path, bridge_url) == 125
        assert state["action_budget"]["total_used"] == 0
    assert not rows(tmp_path / "admission-provider-requests.jsonl")
    audit = json.loads((tmp_path / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reason"] == "unknown provider usage" and audit["unmeasured_usage"] is True


def test_unknown_current_public_levels_declines_request_instead_of_assuming_progress(tmp_path):
    with controlled_arc() as (bridge_url, state):
        state["levels_completed"] = "unknown"
        assert run_parent(tmp_path, bridge_url) == 125
        assert state["action_budget"]["total_used"] == 0
    assert not rows(tmp_path / "admission-provider-requests.jsonl")
    audit = json.loads((tmp_path / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reason"] == "unknown current public ARC levels" and audit["levels_completed"] is None
    assert audit["state_error"]


def test_length_recovery_cannot_bypass_outer_checkpoint(tmp_path):
    with controlled_arc() as (bridge_url, state):
        assert run_parent(tmp_path, bridge_url, checkpoint="3",
                          extra_env={"PI_ARC_ADMISSION_FIRST_LENGTH": "1"}) == 125
        assert state["action_budget"]["total_used"] == 0
    assert len(rows(tmp_path / "admission-provider-requests.jsonl")) == 1
    audit = json.loads((tmp_path / "arc-request-admission-stop.json").read_text(encoding="utf-8"))
    assert audit["reported_tokens"] == 4 and audit["levels_completed"] == 0
