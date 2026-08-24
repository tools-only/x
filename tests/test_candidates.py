from pathlib import Path

from hos.candidates import derive_harness
from hos.resolver import resolve_harness
from hos.store import ObjectStore

from helpers import publish_agent, publish_harness


def test_skill_patch_changes_only_skill_root_agent_and_harness_nodes(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    root = publish_agent(store, "solver", "echo", skill_text="first-action")
    baseline = publish_harness(store, root)

    candidate = derive_harness(
        store,
        baseline,
        {"replace_skill": {"name": "strategy", "content": "candidate-strategy"}},
        created_by_run="agent-meta-0",
    )

    before = resolve_harness(store, baseline)
    after = resolve_harness(store, candidate)
    changed = {
        path
        for path, digest in before["resolved_objects"].items()
        if after["resolved_objects"].get(path) != digest
    }
    assert changed == {"root_agent", "root_agent.skills.strategy"}
    assert store.read(candidate)["manifest"]["parent"] == baseline
    assert store.read(candidate)["manifest"]["created_by_run"] == "agent-meta-0"


def test_subagent_patch_publishes_resolvable_agent_binding(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    root = publish_agent(store, "solver", "echo")
    baseline = publish_harness(store, root)

    candidate = derive_harness(
        store,
        baseline,
        {"add_subagent": {"name": "critic", "driver": "critic", "max_instances": 1}},
        created_by_run="agent-meta-0",
    )

    lock = resolve_harness(store, candidate)
    assert "root_agent.subagents.critic" in lock["resolved_objects"]
    assert lock["objects"]["root_agent.subagents.critic"]["driver"] == "critic"
