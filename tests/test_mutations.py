from pathlib import Path

from hos.mutations import HarnessMutationKernel
from hos.store import ObjectStore
from helpers import publish_agent, publish_harness


def test_mutation_schema_rejects_invalid_component_and_memory_confidence(tmp_path: Path) -> None:
    result = HarnessMutationKernel(ObjectStore(tmp_path)).publish(
        {
            "kind": "harness-mutation",
            "base_harness": "sha256:" + "a" * 64,
            "scope": "task-local",
            "operations": [
                {"component": "unknown", "action": "add", "value": {}},
                {"component": "memory", "action": "add", "value": {"confidence": 9}},
            ],
        },
        created_by_run="run-1",
    )
    assert result.accepted is False
    assert {item["code"] for item in result.errors} >= {"invalid_component", "invalid_confidence"}


def test_mutation_publishes_immutable_candidate(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    base = publish_harness(store, publish_agent(store, "solver", "echo"))
    result = HarnessMutationKernel(store).publish(
        {
            "kind": "harness-mutation",
            "base_harness": base,
            "scope": "task-local",
            "operations": [{"component": "prompt", "action": "replace", "value": "new policy"}],
        },
        created_by_run="run-1",
    )
    assert result.accepted is True
    assert store.read(result.generation)["manifest"]["kind"] == "harness-mutation"
    assert result.successor_harness is not None
    store.set_ref("harness/task/current", base)
    committed = HarnessMutationKernel(store).commit(
        result,
        ref="ref:harness/task/current",
        expected_base=base,
    )
    assert committed == result.successor_harness
    assert store.resolve_ref("ref:harness/task/current") == committed


def test_delete_operation_is_absent_from_successor(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    base = publish_harness(store, publish_agent(store, "solver", "echo"))
    result = HarnessMutationKernel(store).publish(
        {
            "kind": "harness-mutation",
            "base_harness": base,
            "scope": "task-local",
            "operations": [{"component": "skill", "action": "delete", "value": "strategy"}],
        },
        created_by_run="run-2",
    )
    assert result.accepted is True
    from hos.resolver import resolve_harness

    lock = resolve_harness(store, result.successor_harness)
    assert "root_agent.skills.strategy" not in lock["resolved_objects"]


def test_memory_mutation_publishes_json_and_updates_component_map(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    base = publish_harness(store, publish_agent(store, "solver", "echo"))
    result = HarnessMutationKernel(store).publish(
        {
            "kind": "harness-mutation",
            "base_harness": base,
            "scope": "task-local",
            "operations": [{"component": "memory", "action": "replace", "value": [{"title": "fact", "confidence": 4}]}],
        },
        created_by_run="run-3",
    )
    assert result.accepted is True
    manifest = store.read(result.successor_harness)["manifest"]
    assert manifest["component_map"]["agent.memory"]
