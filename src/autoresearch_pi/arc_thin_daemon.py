"""ARC log monitors mounted on the shared daemon service."""

from __future__ import annotations

from typing import Any

from .daemon_service import DaemonService, Rows


def track_capabilities(rows: Rows, state: dict[str, Any], acknowledged: bool) -> list[str]:
    failures = state.setdefault("failures", {})
    rules = state.setdefault("process_rules", {})
    for row in rows[".harness/components.jsonl"]:
        path = row["path"]
        if path.startswith("prompts/process/"):
            good = row.get("good")
            rules[path] = {
                "version": good["version"] if good else None,
                "active": bool(good and good.get("enabled") and not row.get("retired")),
                "decision": row.get("decision"), "error": row.get("error"),
            }
        if row.get("error"):
            key = f"component save: {path}: {row['error']}"[:240]
            failures[key] = failures.get(key, 0) + 1
    for row in rows["harness/component_runs.jsonl"]:
        if row.get("ok") is False:
            key = f"component execution: {row.get('path', row.get('kind', 'unknown'))}"
            failures[key] = failures.get(key, 0) + 1
    reasons = [f"{key} ({count} occurrences)" for key, count in failures.items() if count >= 2]
    if acknowledged:
        failures.clear()
        reasons = []
    seen = set(state.get("seen_signals", []))
    for row in rows["harness/daemon_signals.jsonl"]:
        key = str(row["key"])
        if key not in seen:
            seen.add(key)
            reasons.append(str(row["reason"]))
    state["seen_signals"] = sorted(seen)
    return reasons


def track_runtime(rows: Rows, state: dict[str, Any], acknowledged: bool) -> list[str]:
    failures = state.setdefault("failures", {})
    for row in rows["harness/errors.jsonl"]:
        key = f"{row.get('hook', 'runtime')}: {row.get('message', '')}"[:240]
        failures[key] = failures.get(key, 0) + 1
    for row in rows["harness/python_session.jsonl"]:
        state["python_session"] = row
        if row.get("event") in {"not_saved", "over_capacity", "rolled_back"}:
            key = f"python checkpoint: {row['event']}"
            failures[key] = failures.get(key, 0) + 1
    reasons = [f"{key} ({count} occurrences)" for key, count in failures.items() if count >= 2]
    if acknowledged:
        failures.clear()
        return []
    return reasons


def attach_arc_monitors(daemon: DaemonService) -> None:
    daemon.mount("capabilities", (
        ".harness/components.jsonl", "harness/component_runs.jsonl", "harness/daemon_signals.jsonl",
    ), track_capabilities)
    daemon.mount("runtime", ("harness/errors.jsonl", "harness/python_session.jsonl"), track_runtime)
