import json
from pathlib import Path

import pytest

from hos.events import EventLog, write_json
from hos.experiment import evaluate_checkpoint, load_experiment_suite, run_experiment
from hos.store import ObjectStore
from hos.supervisor import Supervisor

from helpers import leaf, publish_agent, publish_harness


def write_suite(
    path: Path,
    *,
    training: tuple[str, ...] = ("train-task",),
    testing: tuple[str, ...] = ("test-task",),
) -> Path:
    training_values = ", ".join(json.dumps(item) for item in training)
    testing_values = ", ".join(json.dumps(item) for item in testing)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "version = 1",
                'name = "test-suite"',
                'environment = "terminal-bench-2"',
                'dataset = "terminal-bench/terminal-bench-2"',
                "[training]",
                f"tasks = [{training_values}]",
                "[testing]",
                f"tasks = [{testing_values}]",
            ]
        ),
        encoding="utf-8",
    )
    return path


def publish_terminal_harness(store: ObjectStore, name: str) -> str:
    agent = publish_agent(store, name, "echo")
    environment = store.publish(leaf("environment", "terminal-bench-2", adapter="terminal-bench-2"))
    evaluator = store.publish(leaf("evaluator", "score"))
    ruleset = store.publish(leaf("ruleset", "budget"))
    return store.publish(
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


def test_suite_requires_disjoint_unique_tasks(tmp_path: Path) -> None:
    suite_path = write_suite(
        tmp_path / "suite.toml",
        training=("shared-task",),
        testing=("shared-task",),
    )

    with pytest.raises(ValueError, match="must be disjoint"):
        load_experiment_suite(suite_path)


def test_suite_allows_empty_testing_tasks(tmp_path: Path) -> None:
    suite = load_experiment_suite(write_suite(tmp_path / "suite.toml", testing=()))

    assert suite.training_tasks == ("train-task",)
    assert suite.testing_tasks == ()


def test_suite_path_resolves_from_repository_subdirectory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    suite_path = write_suite(project / "experiments" / "suite.toml")
    working_directory = project / "scripts" / "nested"
    working_directory.mkdir(parents=True)
    monkeypatch.chdir(working_directory)

    suite = load_experiment_suite(Path("experiments") / suite_path.name)

    assert suite.name == "test-suite"


def test_evaluation_is_read_only_and_persists_checkpoint(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    harness = publish_terminal_harness(store, "baseline")
    suite = load_experiment_suite(write_suite(tmp_path / "suite.toml"))
    received: list[dict] = []

    def task_runner(run_root: Path, **arguments: object) -> dict:
        received.append({"root": run_root, **arguments})
        return {
            "task_run": {
                "run_id": "harness-evaluation",
                "status": "succeeded",
                "authoritative_metrics": {"score": 1.0},
                "result": {
                    "terminal_bench": {
                        "harbor_result": {"verifier_result": {"rewards": {"reward": 1.0}}}
                    }
                },
            }
        }

    checkpoint = evaluate_checkpoint(
        root,
        suite,
        harness,
        reason="baseline",
        task_runner=task_runner,
    )

    assert received[0]["task_name"] == "test-task"
    assert received[0]["knowledge_writes"] is False
    assert checkpoint["summary"]["mean_score_all"] == 1.0
    latest = json.loads(
        (root / "evaluations" / suite.name / "latest.json").read_text(encoding="utf-8")
    )
    assert latest["checkpoint"] == checkpoint["checkpoint"]
    assert latest["state"] == "completed"


def test_evaluation_does_not_treat_missing_verifier_as_zero_score(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    harness = publish_terminal_harness(store, "baseline")
    suite = load_experiment_suite(write_suite(tmp_path / "suite.toml"))

    def task_runner(run_root: Path, **arguments: object) -> dict:
        return {
            "task_run": {
                "run_id": "harness-not-evaluable",
                "status": "succeeded",
                "authoritative_metrics": {"score": 0.0, "evaluable": False},
                "result": {
                    "terminal_bench": {
                        "harbor_result": {
                            "verifier_result": None,
                            "exception_info": {
                                "exception_type": "ConfigError",
                                "exception_message": "configuration unavailable",
                            },
                        }
                    }
                },
            }
        }

    checkpoint = evaluate_checkpoint(
        root,
        suite,
        harness,
        reason="baseline",
        task_runner=task_runner,
    )

    task = checkpoint["tasks"][0]
    assert task["state"] == "not_evaluable"
    assert task["evaluable"] is False
    assert task["score"] is None
    assert task["error"]["exception_type"] == "ConfigError"
    assert checkpoint["summary"]["mean_score_evaluable"] is None


def test_read_only_harness_blocks_experience_persistence(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    harness = publish_harness(store, publish_agent(store, "solver", "echo"))
    supervisor = Supervisor(store)
    run = supervisor.start_harness(harness, {}, knowledge_writes=False)
    run_dir = store.root / "runs" / run["run_id"]

    assert json.loads((run_dir / "execution-policy.json").read_text(encoding="utf-8")) == {
        "knowledge_writes": False
    }

    events = EventLog(tmp_path / "experience-events.jsonl")
    response = supervisor._handle_experience_call(
        request_id="request-1",
        arguments={"experience": {"name": "must-not-persist"}},
        agent_run_id="agent-evaluation",
        events=events,
    )

    assert response["error"]["code"] == "evaluation_read_only"
    assert not (store.root / "knowledge" / "experiences.jsonl").exists()
    assert "experience.suppressed" in events.path.read_text(encoding="utf-8")


def test_experiment_evaluates_baseline_then_promoted_harness_only(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    baseline = publish_terminal_harness(store, "baseline")
    promoted = publish_terminal_harness(store, "promoted")
    store.set_ref("harness/task/current", baseline)
    suite_path = write_suite(tmp_path / "suite.toml")
    evaluations: list[dict] = []
    training_tasks: list[str] = []

    def evaluation_runner(
        run_root: Path,
        suite: object,
        harness: str,
        *,
        reason: str,
        source_meta_run: str | None = None,
    ) -> dict:
        session = json.loads(
            (root / "experiments" / "test-suite" / "latest.json").read_text(encoding="utf-8")
        )
        assert session["state"] == "running"
        evaluations.append(
            {"root": run_root, "harness": harness, "reason": reason, "meta_run": source_meta_run}
        )
        return {
            "checkpoint": f"checkpoint-{reason}",
            "summary": {"total_tasks": 1, "evaluable_tasks": 1},
        }

    def training_runner(run_root: Path, **arguments: object) -> dict:
        training_tasks.append(str(arguments["task_name"]))
        write_json(
            root / "research" / "evolution.json",
            {
                "schema_version": "hos.evolution.v1",
                "current": {"harness": promoted},
                "rounds": [],
            },
        )
        return {"research": {"status": "succeeded", "run_id": "harness-meta"}}

    session = run_experiment(
        root,
        suite_path,
        duration_hours=1,
        max_cycles=1,
        training_runner=training_runner,
        evaluation_runner=evaluation_runner,
    )

    assert training_tasks == ["train-task"]
    assert evaluations == [
        {"root": store.root, "harness": baseline, "reason": "baseline", "meta_run": None},
        {
            "root": store.root,
            "harness": promoted,
            "reason": "promotion",
            "meta_run": "harness-meta",
        },
    ]
    assert session["checkpoints"] == ["checkpoint-baseline", "checkpoint-promotion"]
    assert session["state"] == "completed"
    assert session["current_harness"] == promoted


def test_experiment_blocks_when_baseline_is_not_evaluable(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    baseline = publish_terminal_harness(store, "baseline")
    store.set_ref("harness/task/current", baseline)
    suite_path = write_suite(tmp_path / "suite.toml")
    training_calls: list[dict] = []

    def evaluation_runner(*args: object, **kwargs: object) -> dict:
        return {
            "checkpoint": "checkpoint-invalid-baseline",
            "summary": {"total_tasks": 1, "evaluable_tasks": 0},
        }

    def training_runner(*args: object, **kwargs: object) -> dict:
        training_calls.append(dict(kwargs))
        return {"research": {"status": "succeeded", "run_id": "harness-meta"}}

    session = run_experiment(
        root,
        suite_path,
        duration_hours=1,
        max_cycles=1,
        training_runner=training_runner,
        evaluation_runner=evaluation_runner,
    )

    assert training_calls == []
    assert session["state"] == "blocked"
    assert session["termination"] == {
        "condition": "blocked",
        "reason": "baseline_not_evaluable",
    }


def test_experiment_skips_evaluation_without_testing_tasks(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    suite_path = write_suite(tmp_path / "suite.toml", testing=())
    evaluations: list[dict] = []

    def evaluation_runner(*args: object, **kwargs: object) -> dict:
        evaluations.append({"args": args, "kwargs": kwargs})
        raise AssertionError("evaluation should be skipped")

    def training_runner(run_root: Path, **arguments: object) -> dict:
        return {"research": {"status": "succeeded", "run_id": "harness-meta"}}

    session = run_experiment(
        root,
        suite_path,
        duration_hours=1,
        max_cycles=1,
        training_runner=training_runner,
        evaluation_runner=evaluation_runner,
    )

    assert evaluations == []
    assert session["checkpoints"] == []
    assert session["state"] == "completed"


def test_continual_experiment_records_controller_failure_without_unbound_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / ".hos"
    suite_path = write_suite(tmp_path / "suite.toml", testing=())

    class FailingController:
        def record_task_run(self, result: dict, *, harness: str | None = None) -> dict:
            raise RuntimeError("evolution failed")

    monkeypatch.setattr("hos.experiment.create_controller", lambda *args, **kwargs: FailingController())
    monkeypatch.setattr(
        "hos.experiment.run_task",
        lambda *args, **kwargs: {
            "task_run": {
                "status": "succeeded",
                "authoritative_metrics": {"score": 0, "episode_runs": 1, "evaluable": True},
            }
        },
    )

    session = run_experiment(
        root,
        suite_path,
        duration_hours=1,
        max_cycles=1,
        controller="continual-harness",
    )

    record = session["cycles"][0]["training_runs"][0]
    assert record["state"] == "failed"
    assert record["error"]["message"] == "evolution failed"


def test_experiment_blocks_before_retry_when_meta_records_no_decision(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    suite_path = write_suite(tmp_path / "suite.toml", testing=())
    calls: list[dict] = []

    def training_runner(run_root: Path, **arguments: object) -> dict:
        calls.append(dict(arguments))
        return {"research": {"status": "succeeded", "run_id": "harness-meta-no-decision"}}

    session = run_experiment(
        root,
        suite_path,
        duration_hours=1,
        max_cycles=2,
        training_runner=training_runner,
    )

    assert len(calls) == 1
    assert session["state"] == "blocked"
    assert session["termination"] == {"condition": "blocked", "reason": "meta_no_progress"}
