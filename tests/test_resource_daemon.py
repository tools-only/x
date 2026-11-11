import json

from autoresearch_pi.daemon_service import DaemonService
from autoresearch_pi.resource_daemon import attach_resource_monitor, build_resource_record, refresh_resource_daemon


def _append(root, relative, row):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as out:
        out.write(json.dumps(row) + "\n")


def test_accounting_matches_fixture_logs_and_reserves_missing_usage(tmp_path):
    _append(tmp_path, "harness/provider-requests.jsonl", {
        "request": 1,
        "permit": {"tokens": 150, "usd": 0.007, "input_tokens_bound": 100, "output_tokens_bound": 50},
    })
    _append(tmp_path, "harness/model-usage.jsonl", {
        "request": 1,
        "usage": {"input": 80, "output": 40, "cacheRead": 10, "reasoning": 12},
        "tokens_used": 130,
        "usage_status": "reported",
    })
    _append(tmp_path, "harness/provider-requests.jsonl", {
        "request": 2,
        "permit": {"tokens": 900, "usd": 0.025, "input_tokens_bound": 700, "output_tokens_bound": 200},
    })
    record = build_resource_record(tmp_path, started_at=1000, now=1010)
    assert record["requests"] == {
        "dispatched": 2,
        "settled": 1,
        "pending_settlement": 1,
        "usage_unknown": 1,
    }
    assert record["tokens"]["input"] == 80
    assert record["tokens"]["output"] == 40
    assert record["tokens"]["cache_read"] == 10
    assert record["tokens"]["reasoning"] == 12
    assert record["tokens"]["reasoning_included_in_output"] is True
    assert record["tokens"]["unknown_reserved"] == 900
    assert record["tokens"]["unknown_reserved"] != 0
    # Reported usage: (80+10)*20 + 40*80 per million; reserved missing request uses permit bounds, not zero.
    expected_conservative = ((80 + 10) * 20 + 40 * 80) / 1e6 + (700 * 20 + 200 * 80) / 1e6
    expected_registered = ((80 + 10) * 5 + 40 * 30) / 1e6 + (700 * 5 + 200 * 30) / 1e6
    assert abs(record["usd"]["conservative"]["estimate"] - expected_conservative) < 1e-12
    assert abs(record["usd"]["registered"]["estimate"] - expected_registered) < 1e-12
    assert "never the invoice" in record["usd"]["conservative"]["label"]
    assert "never the invoice" in record["usd"]["registered"]["billing"]
    assert record["time"]["elapsed_seconds"] == 10
    assert record["storage"]["bytes"] > 0

    daemon = DaemonService(tmp_path)
    attach_resource_monitor(daemon, started_at=1000)
    assert daemon.refresh() is None
    mounted = daemon.state["monitors"]["resources"]
    assert mounted["requests"] == record["requests"]
    assert mounted["tokens"]["unknown_reserved"] == 900
    restarted = DaemonService(tmp_path)
    attach_resource_monitor(restarted)
    assert restarted.refresh() is None
    assert restarted.state["monitors"]["resources"]["tokens"]["unknown_reserved"] == 900


def test_resources_mount_does_not_create_pending_or_daemon_reply(tmp_path):
    _append(tmp_path, "harness/provider-requests.jsonl", {"request": 1, "permit": {"tokens": 100, "usd": 0.01}})
    _append(tmp_path, "harness/errors.jsonl", {"hook": "python", "message": "fixture failure"})
    _append(tmp_path, "harness/errors.jsonl", {"hook": "python", "message": "fixture failure"})
    _append(tmp_path, "budget-stop.json", {"reason": "authorized budget boundary", "stop_kind": "budget_stop"})
    daemon = DaemonService(tmp_path)
    attach_resource_monitor(daemon)
    pending = daemon.refresh()
    assert pending is None
    assert daemon.state["pending"] is None
    assert "daemon_reply" not in json.dumps(daemon.state)
    resources = daemon.state["monitors"]["resources"]
    assert resources["stops"]["budget_stop"]["count"] == 1
    assert "authorized budget boundary" in resources["stops"]["budget_stop"]["reasons"]
    # A later refresh still must not invent a pending notice from this mount.
    _append(tmp_path, "harness/model-usage.jsonl", {"request": 1, "usage": None, "tokens_used": 100, "usage_status": "unknown_reserved"})
    assert refresh_resource_daemon(tmp_path)["tokens"]["unknown_reserved"] == 100
    restarted = DaemonService(tmp_path)
    attach_resource_monitor(restarted)
    assert restarted.refresh() is None
    assert restarted.state["pending"] is None
