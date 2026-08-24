from __future__ import annotations

import json
import time
import tomllib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .demo import bootstrap_task, run_demo, run_task
from .controllers import create_controller
from .events import append_jsonl, utc_now, write_json
from .research import read_evolution_state
from .store import InvalidReference, ObjectStore


EXPERIMENT_SCHEMA_VERSION = "hos.experiment.v1"
EVALUATION_SCHEMA_VERSION = "hos.evaluation.v1"


@dataclass(frozen=True)
class ExperimentSuite:
    name: str
    environment: str
    dataset: str
    training_tasks: tuple[str, ...]
    testing_tasks: tuple[str, ...]

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "environment": self.environment,
            "dataset": self.dataset,
            "training_tasks": list(self.training_tasks),
            "testing_tasks": list(self.testing_tasks),
        }


def load_experiment_suite(path: Path | str) -> ExperimentSuite:
    suite_path = _resolve_suite_path(path)
    with suite_path.open("rb") as handle:
        value = tomllib.load(handle)
    if value.get("version") != 1:
        raise ValueError("experiment suite version must be 1")
    name = value.get("name")
    environment = value.get("environment")
    dataset = value.get("dataset")
    training = value.get("training", {}).get("tasks")
    testing = value.get("testing", {}).get("tasks")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("experiment suite requires a name")
    if environment != "terminal-bench-2":
        raise ValueError("experiment suite currently supports terminal-bench-2 only")
    if not isinstance(dataset, str) or not dataset.strip():
        raise ValueError("experiment suite requires a dataset")
    training_tasks = _task_list(training, "training.tasks")
    testing_tasks = _task_list(testing, "testing.tasks", allow_empty=True)
    overlap = sorted(set(training_tasks) & set(testing_tasks))
    if overlap:
        raise ValueError(f"training and testing tasks must be disjoint: {', '.join(overlap)}")
    return ExperimentSuite(
        name=name.strip(),
        environment=environment,
        dataset=dataset.strip(),
        training_tasks=training_tasks,
        testing_tasks=testing_tasks,
    )


def _resolve_suite_path(path: Path | str) -> Path:
    requested = Path(path).expanduser()
    if requested.is_absolute():
        candidates = [requested]
    else:
        working_directory = Path.cwd()
        candidates = [working_directory / requested]
        candidates.extend(parent / requested for parent in working_directory.parents)
    resolved_candidates = [candidate.resolve() for candidate in candidates]
    for candidate in resolved_candidates:
        if candidate.is_file():
            return candidate
    attempted = ", ".join(str(candidate) for candidate in resolved_candidates)
    raise FileNotFoundError(f"experiment suite not found; tried: {attempted}")


def _task_list(value: object, field: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list) or (not allow_empty and not value):
        raise ValueError(f"experiment suite requires non-empty {field}")
    tasks = tuple(item.strip() for item in value if isinstance(item, str) and item.strip())
    if len(tasks) != len(value) or len(set(tasks)) != len(tasks):
        raise ValueError(f"{field} must contain unique non-empty task names")
    return tasks


def _selected_harness(store: ObjectStore) -> str | None:
    current = read_evolution_state(store, limit=1).get("current")
    if isinstance(current, dict) and isinstance(current.get("harness"), str):
        return store.resolve_ref(current["harness"])
    try:
        return store.resolve_ref("ref:harness/task/current")
    except InvalidReference:
        return None


def _evaluation_dir(store: ObjectStore, suite: ExperimentSuite) -> Path:
    return store.root / "evaluations" / suite.name


def _experiment_dir(store: ObjectStore, suite: ExperimentSuite) -> Path:
    return store.root / "experiments" / suite.name


def _write_checkpoint(evaluation_dir: Path, checkpoint_path: Path, checkpoint: dict) -> None:
    write_json(checkpoint_path, checkpoint)
    write_json(evaluation_dir / "latest.json", checkpoint)


def _write_session(experiment_dir: Path, session_path: Path, session: dict) -> None:
    write_json(session_path, session)
    write_json(experiment_dir / "latest.json", session)


def _history(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            records.append(json.loads(line))
    return records


def evaluate_checkpoint(
    root: Path | str,
    suite: ExperimentSuite,
    harness: str,
    *,
    reason: str,
    source_meta_run: str | None = None,
    task_runner: Callable[..., dict] = run_task,
) -> dict:
    store = ObjectStore(root)
    harness_reference = store.resolve_ref(harness)
    checkpoint_id = f"checkpoint-{uuid.uuid4().hex[:16]}"
    evaluation_dir = _evaluation_dir(store, suite)
    checkpoint_dir = evaluation_dir / "checkpoints" / checkpoint_id
    events_path = checkpoint_dir / "events.jsonl"
    checkpoint_path = checkpoint_dir / "checkpoint.json"
    started_at = utc_now()
    checkpoint = {
        "schema_version": EVALUATION_SCHEMA_VERSION,
        "checkpoint": checkpoint_id,
        "state": "running",
        "reason": reason,
        "suite": suite.name,
        "harness": harness_reference,
        "source_meta_run": source_meta_run,
        "started_at": started_at,
        "knowledge_writes": False,
        "tasks": [],
    }
    _write_checkpoint(evaluation_dir, checkpoint_path, checkpoint)
    append_jsonl(events_path, {"at": started_at, "type": "checkpoint.started", "harness": harness_reference})

    for task_name in suite.testing_tasks:
        task_started_at = utc_now()
        append_jsonl(events_path, {"at": task_started_at, "type": "task.started", "task": task_name})
        started_clock = time.monotonic()
        try:
            report = task_runner(
                store.root,
                environment=suite.environment,
                harness_ref=harness_reference,
                task_name=task_name,
                terminal_dataset=suite.dataset,
                knowledge_writes=False,
            )
            task_record = _evaluation_task_record(
                store,
                task_name,
                report,
                elapsed_seconds=round(time.monotonic() - started_clock, 3),
            )
        except Exception as exc:
            task_record = {
                "task": task_name,
                "state": "failed",
                "evaluable": False,
                "score": None,
                "elapsed_seconds": round(time.monotonic() - started_clock, 3),
                "error": {"type": type(exc).__name__, "message": str(exc)},
            }
        checkpoint["tasks"].append(task_record)
        _write_checkpoint(evaluation_dir, checkpoint_path, checkpoint)
        append_jsonl(
            events_path,
            {
                "at": utc_now(),
                "type": "task.finished",
                "task": task_name,
                "state": task_record["state"],
                "score": task_record["score"],
                "evaluable": task_record["evaluable"],
            },
        )

    checkpoint["state"] = "completed"
    checkpoint["finished_at"] = utc_now()
    checkpoint["summary"] = _evaluation_summary(checkpoint["tasks"])
    _write_checkpoint(evaluation_dir, checkpoint_path, checkpoint)
    append_jsonl(
        events_path,
        {"at": checkpoint["finished_at"], "type": "checkpoint.finished", **checkpoint["summary"]},
    )
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    append_jsonl(evaluation_dir / "history.jsonl", checkpoint)
    return checkpoint


def _evaluation_task_record(
    store: ObjectStore,
    task_name: str,
    report: dict,
    *,
    elapsed_seconds: float,
) -> dict:
    task_run = report.get("task_run", {})
    run_id = task_run.get("run_id")
    metrics = task_run.get("authoritative_metrics", {})
    score = metrics.get("score") if isinstance(metrics, dict) else None
    metrics_evaluable = metrics.get("evaluable", True) if isinstance(metrics, dict) else False
    result = task_run.get("result", {})
    terminal_result = result.get("terminal_bench") if isinstance(result, dict) else None
    harbor_result = terminal_result.get("harbor_result") if isinstance(terminal_result, dict) else None
    verifier_result = harbor_result.get("verifier_result") if isinstance(harbor_result, dict) else None
    evaluable = (
        metrics_evaluable is not False
        and isinstance(verifier_result, dict)
        and isinstance(score, (int, float))
    )
    result_path = None
    if isinstance(run_id, str):
        result_path = str((store.root / "runs" / run_id / "result.json").relative_to(store.root))
    return {
        "task": task_name,
        "state": task_run.get("status", "failed") if evaluable else "not_evaluable",
        "evaluable": evaluable,
        "score": float(score) if evaluable else None,
        "harness_run": run_id,
        "result_path": result_path,
        "elapsed_seconds": elapsed_seconds,
        "verifier_available": isinstance(verifier_result, dict),
        "error": harbor_result.get("exception_info") if isinstance(harbor_result, dict) else None,
    }


def _evaluation_summary(tasks: list[dict]) -> dict:
    all_scores = [float(item["score"]) if isinstance(item.get("score"), (int, float)) else 0.0 for item in tasks]
    evaluable_scores = [float(item["score"]) for item in tasks if item.get("evaluable")]
    return {
        "total_tasks": len(tasks),
        "evaluable_tasks": len(evaluable_scores),
        "completed_tasks": sum(item.get("state") == "succeeded" for item in tasks),
        "positive_score_tasks": sum(score > 0 for score in all_scores),
        "mean_score_all": sum(all_scores) / len(all_scores) if all_scores else 0.0,
        "mean_score_evaluable": (
            sum(evaluable_scores) / len(evaluable_scores) if evaluable_scores else None
        ),
    }


def _checkpoint_is_evaluable(checkpoint: dict) -> bool:
    summary = checkpoint.get("summary")
    if not isinstance(summary, dict):
        return True
    total_tasks = summary.get("total_tasks")
    evaluable_tasks = summary.get("evaluable_tasks")
    return (
        isinstance(total_tasks, int)
        and total_tasks > 0
        and evaluable_tasks == total_tasks
    )


def _block_session(
    experiment_dir: Path,
    session_path: Path,
    events_path: Path,
    session: dict,
    *,
    reason: str,
) -> None:
    session["state"] = "blocked"
    session["termination"] = {"condition": "blocked", "reason": reason}
    _write_session(experiment_dir, session_path, session)
    append_jsonl(
        events_path,
        {"at": utc_now(), "type": "session.blocked", "session": session["session"], "reason": reason},
    )


def _meta_run_recorded_decision(store: ObjectStore, meta_run: object) -> bool:
    if not isinstance(meta_run, str) or not meta_run:
        return False
    decisions_dir = store.root / "research" / meta_run / "decisions"
    return decisions_dir.is_dir() and any(decisions_dir.glob("*.json"))


def run_experiment(
    root: Path | str,
    suite_path: Path | str,
    *,
    duration_hours: float = 24.0,
    max_cycles: int | None = None,
    controller: str | None = None,
    training_runner: Callable[..., dict] = run_demo,
    evaluation_runner: Callable[..., dict] = evaluate_checkpoint,
) -> dict:
    if duration_hours <= 0:
        raise ValueError("duration_hours must be positive")
    if max_cycles is not None and max_cycles <= 0:
        raise ValueError("max_cycles must be positive")
    suite = load_experiment_suite(suite_path)
    selected_controller = controller or "meta"
    if selected_controller not in {"meta", "fixed-task", "continual-harness", "rule-search"}:
        raise ValueError(f"unsupported controller: {selected_controller}")
    evolution_controller = None
    if selected_controller == "continual-harness":
        evolution_controller = create_controller("continual-harness", root=Path(root))
    elif selected_controller == "rule-search":
        raise NotImplementedError("controller 'rule-search' is reserved for an external adapter")
    store = ObjectStore(root)
    experiment_dir = _experiment_dir(store, suite)
    experiment_dir.mkdir(parents=True, exist_ok=True)
    write_json(experiment_dir / "suite.json", suite.as_dict())
    session_id = f"session-{uuid.uuid4().hex[:16]}"
    session_path = experiment_dir / "sessions" / f"{session_id}.json"
    events_path = experiment_dir / "events.jsonl"
    started_at = utc_now()
    session = {
        "schema_version": EXPERIMENT_SCHEMA_VERSION,
        "session": session_id,
        "state": "running",
        "started_at": started_at,
        "duration_hours": duration_hours,
        "max_cycles": max_cycles,
        "suite": suite.as_dict(),
        "controller": selected_controller,
        "cycles": [],
        "checkpoints": [],
    }
    _write_session(experiment_dir, session_path, session)
    append_jsonl(events_path, {"at": started_at, "type": "session.started", "session": session_id})

    harness = _selected_harness(store)
    if harness is None:
        harness, _ = bootstrap_task(
            store,
            suite.environment,
            task_name=suite.training_tasks[0],
            terminal_dataset=suite.dataset,
        )
        append_jsonl(events_path, {"at": utc_now(), "type": "baseline.created", "harness": harness})

    evaluated_harnesses = set()
    if suite.testing_tasks:
        evaluated_harnesses = {
            item.get("harness")
            for item in _history(_evaluation_dir(store, suite) / "history.jsonl")
            if item.get("state") == "completed" and _checkpoint_is_evaluable(item)
        }
        if harness not in evaluated_harnesses:
            checkpoint = evaluation_runner(store.root, suite, harness, reason="baseline")
            session["checkpoints"].append(checkpoint["checkpoint"])
            _write_session(experiment_dir, session_path, session)
            if not _checkpoint_is_evaluable(checkpoint):
                _block_session(
                    experiment_dir,
                    session_path,
                    events_path,
                    session,
                    reason="baseline_not_evaluable",
                )
            else:
                evaluated_harnesses.add(harness)

    deadline = time.monotonic() + duration_hours * 3600
    cycle_number = 0
    consecutive_failed_cycles = 0
    while (
        session["state"] == "running"
        and time.monotonic() < deadline
        and (max_cycles is None or cycle_number < max_cycles)
    ):
        cycle_number += 1
        cycle = {"cycle": cycle_number, "started_at": utc_now(), "training_runs": []}
        session["cycles"].append(cycle)
        _write_session(experiment_dir, session_path, session)
        for task_name in suite.training_tasks:
            if time.monotonic() >= deadline:
                break
            before_harness = _selected_harness(store)
            training_started_at = utc_now()
            append_jsonl(
                events_path,
                {"at": training_started_at, "type": "training.started", "cycle": cycle_number, "task": task_name},
            )
            research: dict = {}
            try:
                if selected_controller == "fixed-task":
                    report = run_task(
                        store.root,
                        environment=suite.environment,
                        harness_ref=before_harness,
                        task_name=task_name,
                        terminal_dataset=suite.dataset,
                        knowledge_writes=False,
                        live_evolution=False,
                    )
                    research = {}
                elif selected_controller == "continual-harness":
                    report = run_task(
                        store.root,
                        environment=suite.environment,
                        harness_ref=before_harness,
                        task_name=task_name,
                        terminal_dataset=suite.dataset,
                        knowledge_writes=False,
                        live_evolution=True,
                    )
                    task_run = report.get("task_run", {})
                    if task_run.get("live_evolution"):
                        committed = task_run.get("final_harness")
                        if isinstance(committed, str) and committed != before_harness:
                            store.set_ref("harness/task/current", committed)
                        evolution = {"mode": "inline", "committed_harness": committed, "checkpointed": committed != before_harness}
                    else:
                        evolution = evolution_controller.record_task_run(task_run, harness=before_harness)
                    metrics = task_run.get("authoritative_metrics", {})
                    task_status = task_run.get("status", "failed")
                    if metrics.get("evaluable") is False:
                        task_status = "failed"
                    research = {"status": task_status, "evolution": evolution}
                else:
                    report = training_runner(
                        store.root,
                        environment=suite.environment,
                        task_name=task_name,
                        terminal_dataset=suite.dataset,
                    )
                    research = report.get("research", {})
                training_record = {
                    "task": task_name,
                    "state": (
                        report.get("task_run", {}).get("status", "failed")
                        if selected_controller == "fixed-task"
                        else research.get("status", "failed")
                    ),
                    "meta_run": research.get("run_id"),
                    "started_at": training_started_at,
                    "finished_at": utc_now(),
                    "before_harness": before_harness,
                    "failure_reason": (
                        report.get("task_run", {}).get("failure_reason")
                        if isinstance(report.get("task_run"), dict)
                        else None
                    ),
                }
            except Exception as exc:
                training_record = {
                    "task": task_name,
                    "state": "failed",
                    "started_at": training_started_at,
                    "finished_at": utc_now(),
                    "before_harness": before_harness,
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                }
            after_harness = _selected_harness(store)
            if selected_controller == "continual-harness" and isinstance(research.get("evolution"), dict):
                committed = research["evolution"].get("committed_harness")
                if isinstance(committed, str):
                    store.set_ref("harness/task/current", committed)
                    after_harness = committed
            training_record["after_harness"] = after_harness
            training_record["decision_recorded"] = _meta_run_recorded_decision(
                store, training_record.get("meta_run")
            )
            cycle["training_runs"].append(training_record)
            _write_session(experiment_dir, session_path, session)
            append_jsonl(events_path, {"at": utc_now(), "type": "training.finished", **training_record})
            if selected_controller == "meta" and not training_record["decision_recorded"] and (
                max_cycles is None or cycle_number < max_cycles
            ):
                _block_session(
                    experiment_dir,
                    session_path,
                    events_path,
                    session,
                    reason="meta_no_progress",
                )
                break
            if (
                suite.testing_tasks
                and after_harness
                and after_harness != before_harness
                and after_harness not in evaluated_harnesses
            ):
                checkpoint = evaluation_runner(
                    store.root,
                    suite,
                    after_harness,
                    reason="promotion",
                    source_meta_run=training_record.get("meta_run"),
                )
                session["checkpoints"].append(checkpoint["checkpoint"])
                _write_session(experiment_dir, session_path, session)
                if _checkpoint_is_evaluable(checkpoint):
                    evaluated_harnesses.add(after_harness)
                else:
                    _block_session(
                        experiment_dir,
                        session_path,
                        events_path,
                        session,
                        reason="promotion_evaluation_not_evaluable",
                    )
                    break
        cycle["finished_at"] = utc_now()
        _write_session(experiment_dir, session_path, session)
        training_runs = cycle["training_runs"]
        if training_runs and all(item.get("state") == "failed" for item in training_runs):
            consecutive_failed_cycles += 1
        else:
            consecutive_failed_cycles = 0
        if session["state"] == "running" and consecutive_failed_cycles >= 3:
            _block_session(
                experiment_dir,
                session_path,
                events_path,
                session,
                reason="consecutive_training_cycles_failed",
            )

    if session["state"] == "running":
        session["state"] = "completed"
    session["finished_at"] = utc_now()
    session["current_harness"] = _selected_harness(store)
    _write_session(experiment_dir, session_path, session)
    append_jsonl(events_path, {"at": session["finished_at"], "type": "session.finished", "session": session_id})
    return session


def read_experiment_status(root: Path | str, suite_path: Path | str) -> dict:
    suite = load_experiment_suite(suite_path)
    store = ObjectStore(root)
    experiment_dir = _experiment_dir(store, suite)
    evaluation_dir = _evaluation_dir(store, suite)
    latest_session = None
    latest_checkpoint = None
    if (experiment_dir / "latest.json").is_file():
        latest_session = json.loads((experiment_dir / "latest.json").read_text(encoding="utf-8"))
    if (evaluation_dir / "latest.json").is_file():
        latest_checkpoint = json.loads((evaluation_dir / "latest.json").read_text(encoding="utf-8"))
    return {
        "suite": suite.as_dict(),
        "current_harness": _selected_harness(store),
        "latest_session": latest_session,
        "latest_checkpoint": latest_checkpoint,
        "checkpoint_count": len(_history(evaluation_dir / "history.jsonl")),
    }
