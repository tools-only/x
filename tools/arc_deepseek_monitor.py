#!/usr/bin/env python3
"""Periodically monitor the newest DeepSeek ARC live run.

This is intentionally read-only with respect to ARC runs. It writes only the
monitor's own history, latest report, and meaningful-change alerts.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
RUNS = ROOT / "runs"
MONITOR = RUNS / "arc-deepseek-monitor"
STATE = MONITOR / "state.json"
HISTORY = MONITOR / "history.jsonl"
ALERTS = MONITOR / "alerts.jsonl"
LATEST_REPORT = MONITOR / "latest-report.md"

sys.path.insert(0, str(TOOLS))
from arc_monitor_report import (  # noqa: E402
    load_jsonl,
    summarize_bridge,
    summarize_failures,
    summarize_provider,
    summarize_research,
    summarize_terminal,
    one_line_module_summaries,
    render_report,
)


def latest_deepseek_run() -> Path:
    candidates = [p for p in RUNS.glob("arc-live-*-deepseek") if p.is_dir()]
    if not candidates:
        raise SystemExit(f"no arc-live-*-deepseek directories under {RUNS}")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def latest_activity(run_dir: Path) -> dt.datetime:
    files = [p for p in run_dir.iterdir() if p.is_file()]
    if not files:
        return dt.datetime.fromtimestamp(run_dir.stat().st_mtime)
    return max(dt.datetime.fromtimestamp(p.stat().st_mtime) for p in files)


def snapshot(run_dir: Path) -> dict[str, Any]:
    bridge = summarize_bridge(run_dir)
    terminal = summarize_terminal(run_dir)
    provider = summarize_provider(run_dir)
    failures = summarize_failures(run_dir)
    research = summarize_research(run_dir)
    activity = latest_activity(run_dir)
    now = dt.datetime.now()
    stale_minutes = max(0, int((now - activity).total_seconds() // 60))
    budget = bridge.get("budget") or {}
    terminal_state = terminal.get("terminal_state") or bridge.get("state")
    if terminal.get("has_runner_error") or terminal.get("has_summary"):
        health = "terminal"
    elif stale_minutes >= 20:
        health = "stale"
    else:
        health = "active"
    return {
        "checked_at": now.isoformat(timespec="seconds"),
        "run_dir": str(run_dir),
        "run_name": run_dir.name,
        "health": health,
        "last_activity": activity.isoformat(timespec="seconds"),
        "stale_minutes": stale_minutes,
        "state": terminal_state,
        "levels_completed": bridge.get("levels_completed"),
        # The bridge event log can contain a synchronized copy of the same
        # action, so use the authoritative budget counter for progression.
        "action_count": budget.get("total_used"),
        "bridge_action_event_count": bridge.get("action_event_count"),
        "last_action": bridge.get("last_action"),
        "last_log_index": bridge.get("last_log_index"),
        "budget": budget,
        "has_summary": terminal.get("has_summary"),
        "has_runner_error": terminal.get("has_runner_error"),
        "provider_error_count": provider.get("provider_error_count", 0),
        "length_anomaly_count": provider.get("length_anomaly_count", 0),
        "operation_failure_count": failures.get("operation_failure_count", 0),
        "execution_error_signal_count": failures.get("execution_error_signal_count", 0),
        "research_counts": research.get("counts", {}),
        "module_counts": {
            name: len(load_jsonl(run_dir / filename))
            for name, filename in {
                "skills": "task-skills.jsonl",
                "memory": "task-memory.jsonl",
                "tools": "task-resource-access.jsonl",
                "harness_decisions": "harness-decisions.jsonl",
            }.items()
        },
    }


def meaningful_key(value: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value.get(key)
        for key in (
            "run_name", "health", "state", "levels_completed", "action_count",
            "last_action", "last_log_index", "budget", "has_summary",
            "has_runner_error", "provider_error_count", "length_anomaly_count",
            "operation_failure_count", "execution_error_signal_count",
            "research_counts", "module_counts",
        )
    }


def main() -> int:
    run_dir = latest_deepseek_run()
    MONITOR.mkdir(parents=True, exist_ok=True)
    current = snapshot(run_dir)
    previous = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else None
    current_key = meaningful_key(current)
    digest = hashlib.sha256(json.dumps(current_key, sort_keys=True).encode()).hexdigest()
    current["meaningful_digest"] = digest

    LATEST_REPORT.write_text(render_report(run_dir), encoding="utf-8")
    with HISTORY.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(current, ensure_ascii=False) + "\n")

    if previous is None or previous.get("meaningful_digest") != digest:
        alert = {
            "event": "meaningful_change",
            "recorded_at": current["checked_at"],
            "run_name": current["run_name"],
            "health": current["health"],
            "changes": {
                key: {"before": previous.get(key) if previous else None, "after": current.get(key)}
                for key in current_key
                if (previous or {}).get(key) != current_key[key]
            },
        }
        with ALERTS.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(alert, ensure_ascii=False) + "\n")

    STATE.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(current, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
