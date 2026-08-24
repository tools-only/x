from pathlib import Path

from hos.supervisor import Supervisor
from hos.store import ObjectStore
from helpers import publish_agent, publish_harness


def _request(method: str, arguments: dict) -> dict:
    return {"id": "request-1", "method": method, "arguments": arguments}


def test_live_mutation_commits_successor_without_touching_current_ref(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    base = publish_harness(store, publish_agent(store, "solver", "echo"))
    supervisor = Supervisor(store)
    supervisor._lock = __import__("hos.resolver", fromlist=["resolve_harness"]).resolve_harness(store, base)
    supervisor._live_enabled = True
    supervisor._live_harness_ref = base
    supervisor._live_commit_ref = "ref:harness/task/live/session-1"
    store.set_ref("harness/task/live/session-1", base)
    supervisor._harness_dir = tmp_path

    from hos.events import EventLog
    result = supervisor._handle_harness_mutation(
        _request("harness.process_skill", {"action": "add", "value": {"name": "inspect", "content": "inspect first"}})["id"],
        "harness.process_skill",
        {"action": "add", "value": {"name": "inspect", "content": "inspect first"}},
        "root_agent",
        "agent-1",
        EventLog(tmp_path / "events.jsonl"),
    )

    assert result["result"]["accepted"] is True
    assert store.resolve_ref("ref:harness/task/live/session-1") != base
    assert not (store.refs_dir / "harness" / "task" / "current").exists()


def test_live_mutation_is_denied_when_not_enabled(tmp_path: Path) -> None:
    supervisor = Supervisor(ObjectStore(tmp_path))
    from hos.events import EventLog
    result = supervisor._handle_harness_mutation("request-1", "harness.process_memory", {"action": "add", "value": {}}, "root_agent", "agent-1", EventLog(tmp_path / "events.jsonl"))
    assert result["error"]["code"] == "live_evolution_disabled"
