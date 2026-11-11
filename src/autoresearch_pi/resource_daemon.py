"""Resource records mounted on the shared DaemonService.

This mount reconciles harness/model-usage.jsonl and
harness/provider-requests.jsonl, plus preflight and stop receipts already
written by the PPT / SelfRoot runner. It never returns reasons, so it cannot
create DaemonService pending notices or daemon_reply requirements.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

try:
    from .daemon_service import DaemonService, Rows
except ImportError:  # python path/to/resource_daemon.py refresh ROOT
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from autoresearch_pi.daemon_service import DaemonService, Rows

CONSERVATIVE_INPUT = 20
CONSERVATIVE_OUTPUT = 80
REGISTERED_INPUT = 5
REGISTERED_OUTPUT = 30
PROBE_KINDS = frozenset({
    "preflight", "inference", "inference_probe", "inference-preflight",
    "provider-preflight", "renderer-preflight",
})
ESTIMATE_NEVER_INVOICE = "estimate, never the invoice"
CONSERVATIVE_LABEL = "conservative estimate 20/80 USD per million; estimate, never the invoice"
REGISTERED_LABEL = "registered estimate 5/30 USD per million; estimate, never the invoice"


def _load_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open("rb") as source:
        for line in source:
            if not line.endswith(b"\n") or not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _is_probe(row: dict[str, Any]) -> bool:
    kind = str(row.get("kind") or "")
    return bool(row.get("probe")) or kind in PROBE_KINDS


def _usage_parts(usage: Any) -> dict[str, int] | None:
    if not isinstance(usage, dict):
        return None
    details = usage.get("prompt_tokens_details") if isinstance(usage.get("prompt_tokens_details"), dict) else {}
    out_details = usage.get("output_tokens_details") if isinstance(usage.get("output_tokens_details"), dict) else {}
    completion_details = usage.get("completion_tokens_details") if isinstance(usage.get("completion_tokens_details"), dict) else {}
    input_tokens = usage.get("input", usage.get("prompt_tokens"))
    output_tokens = usage.get("output", usage.get("completion_tokens"))
    if not _finite_number(input_tokens) or not _finite_number(output_tokens):
        return None
    cache_read = usage.get("cacheRead", usage.get("cache_read", details.get("cached_tokens", 0)))
    reasoning = usage.get(
        "reasoning",
        usage.get("reasoning_tokens", out_details.get("reasoning_tokens", completion_details.get("reasoning_tokens", 0))),
    )
    return {
        "input": int(input_tokens),
        "output": int(output_tokens),
        "cache_read": int(cache_read or 0),
        "reasoning": int(reasoning or 0),
    }


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")


def _usd(parts: dict[str, int], input_rate: int, output_rate: int) -> float:
    # Reasoning tokens are already included in output; do not add them again.
    return (parts["input"] * input_rate + parts["output"] * output_rate + parts["cache_read"] * input_rate) / 1e6


def _permit_parts(permit: Any) -> tuple[int, dict[str, int] | None]:
    if not isinstance(permit, dict):
        return 0, None
    tokens = permit.get("tokens")
    reserved = int(tokens) if _finite_number(tokens) and tokens > 0 else 0
    input_bound = permit.get("input_tokens_bound")
    output_bound = permit.get("output_tokens_bound")
    if _finite_number(input_bound) or _finite_number(output_bound):
        return reserved, {
            "input": int(input_bound or 0),
            "output": int(output_bound or 0),
            "cache_read": 0,
            "reasoning": 0,
        }
    return reserved, None


def _directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for item in path.rglob("*"):
        if "browser-profile" in item.parts or item.suffix == ".tmp" or item.is_symlink():
            continue
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def _append_unique(items: list[str], reason: str) -> None:
    text = str(reason)[:240]
    if text and text not in items:
        items.append(text)


def _classify_stop(reason: str) -> str:
    lowered = reason.lower()
    if "permit" in lowered or "envelope" in lowered:
        return "permit_reject"
    if "preflight" in lowered:
        return "preflight_failure"
    return "budget_stop"


def build_resource_record(root: Path, *, started_at: float | None = None, now: float | None = None) -> dict[str, Any]:
    """Reconcile ledgers and receipts into one resource record.

    A dispatched request with no usage receipt is reserved / marked unknown.
    Missing usage is never written as zero.
    """
    root = Path(root)
    started = started_at if started_at is not None else time.time()
    clock = now if now is not None else time.time()
    dispatched_rows = _load_jsonl(root / "harness/provider-requests.jsonl")
    usage_rows = _load_jsonl(root / "harness/model-usage.jsonl")
    usage_by_request: dict[Any, dict[str, Any]] = {}
    for row in usage_rows:
        key = row.get("request")
        if key is not None:
            usage_by_request[key] = row

    dispatched = len(dispatched_rows)
    settled = 0
    pending_settlement = 0
    usage_unknown = 0
    tokens = {"input": 0, "output": 0, "cache_read": 0, "reasoning": 0, "unknown_reserved": 0}
    conservative = 0.0
    registered = 0.0

    seen: set[Any] = set()
    for row in dispatched_rows:
        key = row.get("request")
        seen.add(key)
        usage_row = usage_by_request.get(key)
        permit = row.get("permit")
        reserved_tokens, reserved_parts = _permit_parts(permit)
        if reserved_tokens <= 0:
            tokens_hint = row.get("tokens") or (usage_row or {}).get("tokens_used")
            if _finite_number(tokens_hint) and tokens_hint > 0:
                reserved_tokens = int(tokens_hint)
        if usage_row is None:
            pending_settlement += 1
            usage_unknown += 1
            tokens["unknown_reserved"] += reserved_tokens
            if reserved_parts:
                conservative += _usd(reserved_parts, CONSERVATIVE_INPUT, CONSERVATIVE_OUTPUT)
                registered += _usd(reserved_parts, REGISTERED_INPUT, REGISTERED_OUTPUT)
            elif isinstance(permit, dict) and _finite_number(permit.get("usd")):
                conservative += float(permit["usd"])
                # Scale the reserved conservative line onto registered 5/30 rates.
                registered += float(permit["usd"]) * ((REGISTERED_INPUT + REGISTERED_OUTPUT) / (CONSERVATIVE_INPUT + CONSERVATIVE_OUTPUT))
            # If no reserve is recorded, still mark unknown rather than writing zeros
            # into the settled token counts.
            continue
        settled += 1
        parts = _usage_parts(usage_row.get("usage"))
        if parts is None or usage_row.get("usage_status") == "unknown_reserved":
            usage_unknown += 1
            unknown = usage_row.get("tokens_used", reserved_tokens)
            tokens["unknown_reserved"] += int(unknown) if _finite_number(unknown) and unknown > 0 else reserved_tokens
            if reserved_parts:
                conservative += _usd(reserved_parts, CONSERVATIVE_INPUT, CONSERVATIVE_OUTPUT)
                registered += _usd(reserved_parts, REGISTERED_INPUT, REGISTERED_OUTPUT)
            elif isinstance(permit, dict) and _finite_number(permit.get("usd")):
                conservative += float(permit["usd"])
                registered += float(permit["usd"]) * ((REGISTERED_INPUT + REGISTERED_OUTPUT) / (CONSERVATIVE_INPUT + CONSERVATIVE_OUTPUT))
            elif _finite_number(usage_row.get("conservative_usd")) and pending_settlement == 0:
                # Cumulative conservative_usd on a row is not a per-request amount.
                # Prefer permit reserves; if only tokens_used exists, reserve those tokens.
                pass
        else:
            tokens["input"] += parts["input"]
            tokens["output"] += parts["output"]
            tokens["cache_read"] += parts["cache_read"]
            tokens["reasoning"] += parts["reasoning"]
            conservative += _usd(parts, CONSERVATIVE_INPUT, CONSERVATIVE_OUTPUT)
            registered += _usd(parts, REGISTERED_INPUT, REGISTERED_OUTPUT)

    for key, usage_row in usage_by_request.items():
        if key in seen:
            continue
        # A usage receipt without a dispatch row is still settled work.
        dispatched += 1
        seen.add(key)
        settled += 1
        parts = _usage_parts(usage_row.get("usage"))
        if parts is None or usage_row.get("usage_status") == "unknown_reserved":
            usage_unknown += 1
            unknown = usage_row.get("tokens_used")
            tokens["unknown_reserved"] += int(unknown) if _finite_number(unknown) and unknown > 0 else 0
        else:
            tokens["input"] += parts["input"]
            tokens["output"] += parts["output"]
            tokens["cache_read"] += parts["cache_read"]
            tokens["reasoning"] += parts["reasoning"]
            conservative += _usd(parts, CONSERVATIVE_INPUT, CONSERVATIVE_OUTPUT)
            registered += _usd(parts, REGISTERED_INPUT, REGISTERED_OUTPUT)

    stops = {
        "permit_reject": {"count": 0, "reasons": []},
        "preflight_failure": {"count": 0, "reasons": []},
        "budget_stop": {"count": 0, "reasons": []},
    }

    budget_stop = _load_json(root / "budget-stop.json")
    if isinstance(budget_stop, dict):
        reason = str(budget_stop.get("reason") or budget_stop.get("stop") or "budget stop")
        kind = budget_stop.get("stop_kind") or _classify_stop(reason)
        if kind not in stops:
            kind = "budget_stop"
        stops[kind]["count"] += 1
        _append_unique(stops[kind]["reasons"], reason)

    for name, label in (
        ("renderer-preflight.json", "renderer preflight"),
        ("provider-preflight.json", "provider preflight"),
        ("inference-preflight.json", "inference preflight"),
    ):
        receipt = _load_json(root / name)
        if not isinstance(receipt, dict):
            continue
        status = str(receipt.get("status") or "")
        if status in {"passed", "available"}:
            continue
        reason = str(receipt.get("reason") or receipt.get("error") or f"{label}: {status or 'failed'}")
        stops["preflight_failure"]["count"] += 1
        _append_unique(stops["preflight_failure"]["reasons"], reason)

    for row in _load_jsonl(root / "harness/resource-stops.jsonl"):
        kind = row.get("kind") or _classify_stop(str(row.get("reason") or ""))
        if kind not in stops:
            kind = "budget_stop"
        stops[kind]["count"] += 1
        _append_unique(stops[kind]["reasons"], str(row.get("reason") or kind))

    return {
        "requests": {
            "dispatched": dispatched,
            "settled": settled,
            "pending_settlement": pending_settlement,
            "usage_unknown": usage_unknown,
        },
        "tokens": {
            **tokens,
            "reasoning_included_in_output": True,
        },
        "usd": {
            "conservative": {
                "input_per_million": CONSERVATIVE_INPUT,
                "output_per_million": CONSERVATIVE_OUTPUT,
                "estimate": conservative,
                "label": CONSERVATIVE_LABEL,
                "billing": ESTIMATE_NEVER_INVOICE,
            },
            "registered": {
                "input_per_million": REGISTERED_INPUT,
                "output_per_million": REGISTERED_OUTPUT,
                "estimate": registered,
                "label": REGISTERED_LABEL,
                "billing": ESTIMATE_NEVER_INVOICE,
            },
        },
        "time": {"started_at": started, "elapsed_seconds": max(0.0, clock - started)},
        "storage": {"bytes": _directory_bytes(root)},
        "stops": stops,
        "heartbeat_gaps": [],
    }


def track_resources(root: Path, started_at: float):
    def update(rows: Rows, state: dict[str, Any], acknowledged: bool) -> list[str]:
        del rows, acknowledged
        started = state.get("time", {}).get("started_at") if isinstance(state.get("time"), dict) else state.get("started_at")
        if not _finite_number(started):
            started = started_at
        record = build_resource_record(root, started_at=float(started))
        record["heartbeat_gaps"] = list(state.get("heartbeat_gaps") or [])
        state.clear()
        state.update(record)
        return []

    return update


def attach_resource_monitor(daemon: DaemonService, started_at: float | None = None) -> None:
    """Attach the resources mount if it is not already present."""
    if "resources" in daemon.mounts:
        return
    started = started_at
    existing = daemon.state.get("monitors", {}).get("resources") or {}
    if started is None and isinstance(existing.get("time"), dict) and _finite_number(existing["time"].get("started_at")):
        started = float(existing["time"]["started_at"])
    if started is None:
        started = time.time()
    daemon.mount(
        "resources",
        ("harness/model-usage.jsonl", "harness/provider-requests.jsonl", "harness/resource-stops.jsonl"),
        track_resources(daemon.root, started),
    )


def refresh_resource_daemon(root: Path, started_at: float | None = None) -> dict[str, Any]:
    """Construct or reopen DaemonService, attach the resources mount, and refresh."""
    daemon = DaemonService(Path(root))
    attach_resource_monitor(daemon, started_at=started_at)
    daemon.refresh()
    return daemon.state.get("monitors", {}).get("resources") or {}


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2 or args[0] != "refresh":
        print("usage: python -m autoresearch_pi.resource_daemon refresh ROOT", file=sys.stderr)
        return 2
    record = refresh_resource_daemon(Path(args[1]))
    json.dump(record, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
