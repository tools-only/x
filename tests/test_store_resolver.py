import json
import os
import shutil
from pathlib import Path

import pytest

from hos.resolver import GraphCycleError, MissingObjectError, resolve_harness
from hos.store import IntegrityError, ObjectStore


def leaf(kind: str, name: str, **extra: object) -> dict:
    return {"api_version": f"hos.{kind}.v0", "kind": kind, "name": name, **extra}


def publish_task_graph(store: ObjectStore, skill_text: str) -> tuple[str, dict]:
    loop = store.publish(leaf("loop", "jsonl-runtime"))
    policy = store.publish(leaf("policy", "task-policy"), {"policy.md": "solve the task"})
    skill = store.publish(leaf("skill", "arc-strategy"), {"SKILL.md": skill_text})
    tool = store.publish(leaf("tool", "arc3"))
    memory = store.publish(leaf("memory", "empty"))
    environment = store.publish(leaf("environment", "arc3-local", adapter="arc3-local"))
    evaluator = store.publish(leaf("evaluator", "score"))
    ruleset = store.publish(leaf("ruleset", "task-budget"))
    agent = store.publish(
        {
            "api_version": "hos.agent.v0",
            "kind": "agent",
            "name": "solver",
            "loop": loop,
            "policy": policy,
            "skills": [{"name": "strategy", "ref": skill, "load": "always"}],
            "tools": [tool],
            "memory": memory,
            "subagents": {},
        }
    )
    harness = store.publish(
        {
            "api_version": "hos.harness.v0",
            "kind": "harness",
            "role": "task",
            "root_agent": agent,
            "environment": environment,
            "evaluator": evaluator,
            "ruleset": ruleset,
        }
    )
    return harness, resolve_harness(store, harness)


def test_publish_is_content_addressed_and_detects_corruption(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    manifest = leaf("skill", "explore")

    first = store.publish(manifest, {"SKILL.md": "inspect before acting"})
    second = store.publish(manifest, {"SKILL.md": "inspect before acting"})

    assert first == second
    object_dir = store.object_path(first)
    assert json.loads((object_dir / "manifest.json").read_text(encoding="utf-8")) == manifest

    (object_dir / "payload" / "SKILL.md").write_text("corrupted", encoding="utf-8")
    with pytest.raises(IntegrityError):
        store.publish(manifest, {"SKILL.md": "inspect before acting"})


def test_publish_accepts_another_writer_winning_the_directory_race(tmp_path: Path, monkeypatch) -> None:
    store = ObjectStore(tmp_path)
    manifest = leaf("skill", "concurrent")
    payload = {"SKILL.md": "same immutable content"}
    real_replace = os.replace

    def another_writer_wins(source, destination) -> None:
        destination_path = Path(destination)
        if destination_path.parent == store.objects_dir:
            shutil.copytree(source, destination)
            raise PermissionError(5, "destination was published concurrently", str(destination))
        real_replace(source, destination)

    monkeypatch.setattr("hos.store.os.replace", another_writer_wins)

    digest = store.publish(manifest, payload)

    assert store.read(digest)["manifest"] == manifest


def test_publish_retries_transient_windows_directory_access_denial(tmp_path: Path, monkeypatch) -> None:
    store = ObjectStore(tmp_path)
    manifest = leaf("evaluator", "transient-lock")
    real_replace = os.replace
    attempts = 0

    def transient_denial(source, destination) -> None:
        nonlocal attempts
        if Path(destination).parent == store.objects_dir and attempts == 0:
            attempts += 1
            raise PermissionError(5, "directory temporarily locked", str(destination))
        attempts += 1
        real_replace(source, destination)

    monkeypatch.setattr("hos.store.os.replace", transient_denial)

    digest = store.publish(manifest)

    assert attempts == 2
    assert store.read(digest)["manifest"] == manifest


def test_refs_are_mutable_without_mutating_objects(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    old = store.publish(leaf("policy", "old"))
    new = store.publish(leaf("policy", "new"))

    store.set_ref("harness/task/current", old)
    assert store.resolve_ref("ref:harness/task/current") == old
    store.set_ref("harness/task/current", new)

    assert store.resolve_ref("ref:harness/task/current") == new
    assert store.read(old)["manifest"]["name"] == "old"


def test_resolver_locks_every_component_and_exposes_component_diff(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    harness_a, lock_a = publish_task_graph(store, "choose the first available action")
    harness_b, lock_b = publish_task_graph(store, "inspect the frame, then choose an action")

    assert harness_a != harness_b
    assert lock_a["harness"] == harness_a
    assert set(lock_a["resolved_objects"]) == {
        "root_agent",
        "root_agent.loop",
        "root_agent.policy",
        "root_agent.skills.strategy",
        "root_agent.tools.0",
        "root_agent.memory",
        "environment",
        "evaluator",
        "ruleset",
    }
    changed = {
        path
        for path, digest in lock_a["resolved_objects"].items()
        if lock_b["resolved_objects"].get(path) != digest
    }
    assert changed == {"root_agent", "root_agent.skills.strategy"}


def test_resolver_rejects_missing_object_and_recursive_subagent(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    harness, _ = publish_task_graph(store, "baseline")
    harness_manifest = store.read(harness)["manifest"]
    missing_harness = store.publish({**harness_manifest, "root_agent": "sha256:" + "0" * 64})

    with pytest.raises(MissingObjectError):
        resolve_harness(store, missing_harness)

    loop = store.publish(leaf("loop", "loop"))
    policy = store.publish(leaf("policy", "policy"))
    memory = store.publish(leaf("memory", "memory"))
    recursive_agent = store.publish(
        {
            "api_version": "hos.agent.v0",
            "kind": "agent",
            "name": "recursive",
            "loop": loop,
            "policy": policy,
            "skills": [],
            "tools": [],
            "memory": memory,
            "subagents": {"self": {"agent": "ref:agents/recursive", "max_instances": 1}},
        }
    )
    store.set_ref("agents/recursive", recursive_agent)
    recursive_harness = store.publish({**harness_manifest, "root_agent": recursive_agent})

    with pytest.raises(GraphCycleError):
        resolve_harness(store, recursive_harness)
