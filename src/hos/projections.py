"""Information projections that prevent raw Task evidence reaching Meta."""
from __future__ import annotations

from typing import Any

from .resolver import resolve_harness
from .store import ObjectStore


def meta_harness_projection(*, harness: str, parent_harness: str | None, diff: list[dict[str, Any]],
                            authoritative_metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return version-level evidence without exposing task artifacts."""
    metrics = authoritative_metrics or {}
    return {
        "harness": harness,
        "parent_harness": parent_harness,
        "diff": [
            {"component": item.get("component"), "action": item.get("action"), "name": item.get("name")}
            for item in diff if isinstance(item, dict)
        ],
        "authoritative_metrics": {
            "score": metrics.get("score"),
            "evaluable": metrics.get("evaluable"),
        },
        "projection": {"raw_task_evidence_included": False},
    }


def harness_version_projection(store: ObjectStore, harness: str, *, metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    """Expose lineage and stable component identity for Meta comparison."""
    lock = resolve_harness(store, harness)
    manifest = lock["harness_manifest"]
    component_map = manifest.get("component_map", {})
    return meta_harness_projection(
        harness=lock["harness"],
        parent_harness=manifest.get("parent_harness") or manifest.get("parent"),
        diff=[
            {"component": key, "name": key, "value": value}
            for key, value in component_map.items()
            if key in {"agent", "agent.policy", "agent.memory", "agent.skills", "agent.subagents"}
        ],
        authoritative_metrics=metrics,
    )


def meta_evidence_projection(run: dict[str, Any]) -> dict[str, Any]:
    metrics = run.get("authoritative_metrics", {})
    usage = run.get("usage", {})
    result = run.get("result", {})
    return {
        "run_id": run.get("run_id"),
        "harness": run.get("harness"),
        "status": run.get("status"),
        "authoritative_metrics": {
            "score": metrics.get("score"),
            "episode_runs": metrics.get("episode_runs"),
            "evaluable": metrics.get("evaluable"),
        },
        "usage": {
            "agent_runs": usage.get("agent_runs"),
            "episode_runs": usage.get("episode_runs"),
            "host_calls": usage.get("host_calls"),
        },
        "methodology_reports": [
            {
                "phase": item.get("phase"),
                "status": item.get("status"),
                "confidence": item.get("confidence"),
                "methodology": item.get("methodology"),
            }
            for item in run.get("methodology_reports", [])
            if isinstance(item, dict) and isinstance(item.get("methodology"), dict)
        ],
        "projection": {
            "raw_task_evidence_included": False,
            "task_specificity": "redacted",
            "source_result_present": bool(result),
        },
    }
