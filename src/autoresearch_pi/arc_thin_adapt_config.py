"""Small, editable ADAPT scheduling policy for the ARC parent loop."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_ADAPT_CONFIG: dict[str, Any] = {
    "mode": "on_demand",
    "checkpoint_every_batches": 6,
    "rules": [{"event": "prediction_miss", "count": 2, "within_actions": 8}],
}
EVENTS = {"prediction_miss", "claim_failed", "level_change"}


def validate_adapt_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"mode", "checkpoint_every_batches", "rules"}:
        raise ValueError("adapt config needs mode, checkpoint_every_batches and rules")
    mode = value["mode"]
    interval = value["checkpoint_every_batches"]
    if not isinstance(mode, str) or mode not in {"on_demand", "after_batch", "manual"}:
        raise ValueError("adapt mode must be on_demand, after_batch or manual")
    if type(interval) is not int or not 0 <= interval <= 100:
        raise ValueError("checkpoint_every_batches must be an integer from 0 to 100 (0 disables it)")
    rules = value["rules"]
    if not isinstance(rules, list) or len(rules) > 12:
        raise ValueError("rules must be a list with at most 12 entries")
    for rule in rules:
        if not isinstance(rule, dict) or not {"event", "count", "within_actions"} <= set(rule) \
                or set(rule) - {"event", "count", "within_actions", "key"}:
            raise ValueError("each rule needs event, count and within_actions; claim_failed may also select key")
        if not isinstance(rule["event"], str) or rule["event"] not in EVENTS:
            raise ValueError(f"unsupported adapt event: {rule['event']}")
        if type(rule["count"]) is not int or not 1 <= rule["count"] <= 100:
            raise ValueError("rule count must be an integer from 1 to 100")
        if type(rule["within_actions"]) is not int or not 1 <= rule["within_actions"] <= 100:
            raise ValueError("rule within_actions must be an integer from 1 to 100")
        if "key" in rule and (rule["event"] != "claim_failed" or not isinstance(rule["key"], str)
                              or not 1 <= len(rule["key"]) <= 80):
            raise ValueError("key must name a claim_failed hypothesis")
    return value


def read_adapt_config(path: Path) -> dict[str, Any]:
    return validate_adapt_config(json.loads(path.read_text(encoding="utf-8")))


def due_adapt_reason(config: dict[str, Any], trajectory: list[dict[str, Any]], claim_checks: list[dict[str, Any]],
                     last_adapt_action: int, batches_since_adapt: int) -> str | None:
    if config["mode"] == "after_batch":
        return "after_batch"
    if config["mode"] == "manual":
        return None
    for rule in config["rules"]:
        event = rule["event"]
        start = max(last_adapt_action, len(trajectory) - rule["within_actions"])
        if event == "claim_failed":
            count = sum(row.get("result") is False and isinstance(row.get("n"), int) and row["n"] > start
                        and ("key" not in rule or row.get("key") == rule["key"]) for row in claim_checks)
        else:
            rows = trajectory[start:]
            count = sum(bool((row.get("prediction") or {}).get("misses") or
                             any(field.get("hit") is False for field in (row.get("prediction") or {}).get("fields", [])))
                        if event == "prediction_miss" else bool(row.get("level_changed")) for row in rows)
        if count >= rule["count"]:
            return f"{event}{':' + rule['key'] if 'key' in rule else ''}:{count}/{rule['count']} within {rule['within_actions']} actions"
    interval = config["checkpoint_every_batches"]
    return f"checkpoint:{interval} batches" if interval and batches_since_adapt >= interval else None
