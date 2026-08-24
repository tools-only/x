"""Deterministic, environment-free validation for the live Harness pipeline."""
from __future__ import annotations

from pathlib import Path

from .events import EventLog
from .projections import harness_version_projection
from .resolver import resolve_harness
from .store import ObjectStore
from .supervisor import Supervisor


def run_live_pipeline_smoke(root: Path | str) -> dict:
    store = ObjectStore(root)
    from .demo import _publish_agent, _publish_harness

    agent = _publish_agent(store, "smoke-task-agent", "echo", "deterministic live pipeline probe")
    base = _publish_harness(store, agent, "task", "arc3-local")
    supervisor = Supervisor(store)
    supervisor._lock = resolve_harness(store, base)
    supervisor._live_enabled = True
    supervisor._live_harness_ref = base
    supervisor._live_commit_ref = "ref:harness/task/live/smoke"
    store.set_ref("harness/task/live/smoke", base)
    supervisor._harness_dir = store.root / "smoke"
    supervisor._harness_dir.mkdir(parents=True, exist_ok=True)
    result = supervisor._handle_harness_mutation(
        "smoke-mutation",
        "harness.process_skill",
        {"action": "add", "value": {"name": "bounded_probe", "content": "Inspect state before acting."}},
        "root_agent",
        "smoke-agent",
        EventLog(supervisor._harness_dir / "events.jsonl"),
    )
    successor = result.get("result", {}).get("harness")
    if not isinstance(successor, str):
        raise RuntimeError(f"live pipeline smoke mutation failed: {result}")
    projection = harness_version_projection(store, successor, metrics={"score": 1.0, "evaluable": True})
    return {
        "status": "passed",
        "base_harness": base,
        "successor_harness": successor,
        "live_ref": store.resolve_ref("ref:harness/task/live/smoke"),
        "projection": projection,
    }
