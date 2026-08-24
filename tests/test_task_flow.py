import pytest

from hos.demo import _case_for_environment, bootstrap_task, run_task
from hos.events import write_json
from hos.store import ObjectStore
from hos.supervisor import Supervisor

from helpers import leaf, publish_agent


def test_arc_environment_requires_explicit_game_id() -> None:
    with pytest.raises(ValueError, match="requires an explicit game_id"):
        _case_for_environment("arc3-local")


def test_terminal_bench_environment_requires_task_name() -> None:
    with pytest.raises(ValueError, match="requires an explicit task_name"):
        _case_for_environment("terminal-bench-2")


def test_terminal_bench_environment_builds_task_case() -> None:
    assert _case_for_environment("terminal-bench-2", task_name="video-processing") == {
        "task_name": "video-processing"
    }


def test_new_task_harness_uses_configurable_terminal_budget(tmp_path, monkeypatch) -> None:
    store = ObjectStore(tmp_path / ".hos")
    monkeypatch.setenv("HOS_TASK_MAX_TURNS", "30")
    monkeypatch.setenv("HOS_TASK_MAX_TOKENS", "8192")

    harness, _ = bootstrap_task(store, environment="terminal-bench-2", task_name="overfull-hbox")
    agent_ref = store.read(harness)["manifest"]["root_agent"]

    assert store.read(agent_ref)["manifest"]["max_turns"] == 30
    assert store.read(agent_ref)["manifest"]["max_tokens"] == 8192


def test_task_run_reuses_matching_promoted_harness(tmp_path, monkeypatch) -> None:
    store = ObjectStore(tmp_path / ".hos")
    agent = publish_agent(store, "solver", "echo")
    environment = store.publish(leaf("environment", "terminal-bench-2", adapter="terminal-bench-2"))
    evaluator = store.publish(leaf("evaluator", "score"))
    ruleset = store.publish(leaf("ruleset", "budget"))
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
    write_json(
        store.root / "research" / "evolution.json",
        {"schema_version": "hos.evolution.v1", "current": {"harness": harness}, "rounds": []},
    )
    received: dict = {}

    def start_harness(
        self,
        harness_ref: str,
        job: dict,
        *,
        knowledge_writes: bool = True,
    ) -> dict:
        received.update(
            {"harness": harness_ref, "job": job, "knowledge_writes": knowledge_writes}
        )
        return {"run_id": "harness-task", "status": "succeeded"}

    monkeypatch.setattr(Supervisor, "start_harness", start_harness)
    result = run_task(
        store.root,
        environment="terminal-bench-2",
        task_name="video-processing",
    )

    assert result["task_harness"] == harness
    assert received["harness"] == harness
    assert received["knowledge_writes"] is True
