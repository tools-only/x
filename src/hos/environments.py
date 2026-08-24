from __future__ import annotations

import dataclasses
import json
import logging
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from .debug_log import configured_level


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if dataclasses.is_dataclass(value):
        return jsonable(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        return jsonable(value.model_dump())
    if hasattr(value, "name") and hasattr(value, "value"):
        return {"name": value.name, "value": jsonable(value.value)}
    if hasattr(value, "__dict__"):
        return {key: jsonable(item) for key, item in vars(value).items() if not key.startswith("_")}
    return str(value)


class ArcAgi3Adapter:
    def __init__(self, *, local: bool = False, environments_dir: Path | str | None = None):
        try:
            import arc_agi
            from arcengine import GameAction
        except ImportError as exc:
            raise RuntimeError("arc-agi is not installed; run `python -m pip install arc-agi`") from exc
        self._arc_agi = arc_agi
        self._game_action = GameAction
        self._local = local
        self._operation_mode = arc_agi.OperationMode.OFFLINE if local else arc_agi.OperationMode.NORMAL
        configured_dir = (
            environments_dir
            or os.environ.get("ARC_ENVIRONMENTS_DIR")
            or os.environ.get("ENVIRONMENTS_DIR")
            or "environment_files"
        )
        self._environments_dir = str(Path(configured_dir).resolve())
        self._logger = self._build_logger()
        scorecard_logger = logging.getLogger("arc_agi.scorecard")
        scorecard_logger.setLevel(configured_level())
        for handler in scorecard_logger.handlers:
            if isinstance(handler, logging.StreamHandler):
                handler.setStream(sys.stderr)
        self._discovery_client = self._new_arcade()
        self._sessions: dict[str, dict] = {}

    @staticmethod
    def _build_logger() -> logging.Logger:
        logger = logging.getLogger("hos.arc_agi")
        logger.handlers.clear()
        logger.setLevel(configured_level())
        logger.propagate = False
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
        logger.addHandler(handler)
        return logger

    def _new_arcade(self, recordings_dir: Path | None = None):
        options = {
            "operation_mode": self._operation_mode,
            "environments_dir": self._environments_dir,
        }
        if recordings_dir is not None:
            options["recordings_dir"] = str(recordings_dir)
        options["logger"] = self._logger
        return self._arc_agi.Arcade(**options)

    def discover(self) -> list[dict]:
        return [
            {
                "game_id": getattr(environment, "game_id", None),
                "title": getattr(environment, "title", None),
                "raw": jsonable(environment),
            }
            for environment in self._discovery_client.get_environments()
        ]

    def open(self, case: dict, artifact_dir: Path) -> dict:
        recordings_dir = artifact_dir / "arc-recordings"
        arcade = self._new_arcade(recordings_dir=recordings_dir)
        scorecard_id = arcade.create_scorecard(tags=["harness-os", "demo"])
        environment = arcade.make(
            case["game_id"],
            seed=int(case.get("seed", 0)),
            scorecard_id=scorecard_id,
            save_recording=True,
            include_frame_data=True,
        )
        if environment is None:
            raise RuntimeError(f"ARC-AGI-3 could not create {case['game_id']}")
        handle = uuid.uuid4().hex
        observation = jsonable(environment.observation_space)
        actions = [action.name for action in environment.action_space]
        self._sessions[handle] = {
            "arcade": arcade,
            "environment": environment,
            "scorecard_id": scorecard_id,
            "artifact_dir": artifact_dir,
        }
        return {"handle": handle, "observation": observation, "action_space": actions}

    def observe(self, handle: str) -> dict:
        session = self._sessions[handle]
        return jsonable(session["environment"].observation_space)

    def step(self, handle: str, action: str, data: dict | None = None) -> dict:
        session = self._sessions[handle]
        game_action = getattr(self._game_action, action)
        observation = session["environment"].step(game_action, data=data or {})
        return {
            "observation": jsonable(observation),
            "action_space": [item.name for item in session["environment"].action_space],
        }

    def reset(self, handle: str) -> dict:
        return jsonable(self._sessions[handle]["environment"].reset())

    def close(self, handle: str) -> dict:
        session = self._sessions.pop(handle)
        scorecard = session["arcade"].close_scorecard(session["scorecard_id"])
        scorecard_json = jsonable(scorecard)
        score = float(getattr(scorecard, "score", 0.0) if scorecard is not None else 0.0)
        return {"scorecard": scorecard_json, "score": score, "recording": None}


class TerminalBench2Adapter:
    """Run one Terminal-Bench 2 task through Harbor's sandbox and verifier."""

    def __init__(
        self,
        *,
        dataset: str = "terminal-bench/terminal-bench-2",
        command: str = "harbor",
        timeout_seconds: float = 3600.0,
        runner=None,
    ):
        self._dataset = dataset
        self._command = command
        self._timeout_seconds = timeout_seconds
        self._runner = runner or subprocess.run
        self._bridge_config: dict | None = None

    def discover(self) -> list[dict]:
        return [{"dataset": self._dataset}]

    def configure_task_agent(self, config: dict) -> None:
        """Set the locked HOS task-agent configuration for the internal bridge."""
        self._bridge_config = dict(config)

    def run_task(self, case: dict, artifact_dir: Path) -> dict:
        task_name = case.get("task_name") or case.get("task") or case.get("game_id")
        if not isinstance(task_name, str) or not task_name:
            raise ValueError("terminal-bench-2 requires a task_name")
        if self._bridge_config is None:
            raise RuntimeError("terminal-bench-2 task agent has not been configured")
        harbor_task_name = _terminal_bench_task_id(task_name)
        jobs_dir = artifact_dir / "harbor-jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        command = [
            self._command,
            "run",
            "--dataset",
            self._dataset,
            "--include-task-name",
            harbor_task_name,
            "--agent",
            "hos.harbor_bridge:HosTaskAgent",
            "--jobs-dir",
            str(jobs_dir),
            "--n-tasks",
            "1",
            "--n-concurrent",
            "1",
            "--quiet",
            "--yes",
        ]
        verifier_timeout_multiplier = os.environ.get("HARBOR_VERIFIER_TIMEOUT_MULTIPLIER")
        if verifier_timeout_multiplier:
            try:
                if float(verifier_timeout_multiplier) <= 0:
                    raise ValueError
            except ValueError as exc:
                raise ValueError("HARBOR_VERIFIER_TIMEOUT_MULTIPLIER must be positive") from exc
            command.extend(["--verifier-timeout-multiplier", verifier_timeout_multiplier])
        environment = os.environ.copy()
        source_dir = str(Path(__file__).resolve().parents[1])
        existing_path = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = source_dir if not existing_path else source_dir + os.pathsep + existing_path
        bridge_config_path = artifact_dir / "hos-harbor-bridge.json"
        bridge_config_path.write_text(json.dumps(self._bridge_config, ensure_ascii=False), encoding="utf-8")
        environment["HOS_HARBOR_BRIDGE_CONFIG_FILE"] = str(bridge_config_path)
        completed = self._runner(
            command,
            cwd=str(artifact_dir),
            capture_output=True,
            text=True,
            timeout=self._timeout_seconds,
            check=False,
            env=environment,
        )
        result = _read_terminal_bench_result(jobs_dir, task_name)
        if result is None:
            failure_reason = {
                "code": "harbor_result_missing",
                "message": f"Harbor did not produce a result for {task_name}",
                "exit_code": completed.returncode,
                "stderr": completed.stderr[-2000:],
            }
            raise RuntimeError(
                f"Harbor did not produce a result for {task_name}; "
                f"exit_code={completed.returncode} stderr={completed.stderr[-1000:]}"
            )
        score = _terminal_bench_score(result)
        agent_result = result.get("agent_result")
        metadata = agent_result.get("metadata") if isinstance(agent_result, dict) else None
        completion_valid = (
            completed.returncode == 0
            and isinstance(metadata, dict)
            and metadata.get("completed") is True
            and isinstance(metadata.get("final_message"), str)
            and bool(metadata["final_message"].strip())
            and isinstance(metadata.get("tool_calls"), int)
            and metadata["tool_calls"] > 0
        )
        evaluable = (
            completion_valid
            and score is not None
            and isinstance(result.get("verifier_result"), dict)
        )
        failure_reason = _terminal_bench_failure_reason(
            result,
            completion_valid=completion_valid,
            evaluable=evaluable,
            exit_code=completed.returncode,
            stderr=completed.stderr,
        )
        return {
            "scorecard": {
                "score": score if score is not None else 0.0,
                "evaluable": evaluable,
                "harbor_result": result,
            },
            "recording": [],
            "score": float(score if score is not None else 0.0),
            "evaluable": evaluable,
            "completion_valid": completion_valid,
            "harbor_result": result,
            "exit_code": completed.returncode,
            "failure_reason": failure_reason,
        }


def _read_terminal_bench_result(jobs_dir: Path, task_name: str) -> dict | None:
    expected_names = {task_name, _terminal_bench_task_id(task_name)}
    candidates = sorted(jobs_dir.rglob("result.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in candidates:
        value = _read_json_result(path)
        if value is None:
            continue
        if value.get("task_name") in expected_names:
            return value
    for path in candidates:
        value = _read_json_result(path)
        if value is None:
            continue
        if "stats" in value or "verifier_result" in value:
            return value
    return None


def _read_json_result(path: Path) -> dict | None:
    try:
        payload = path.read_bytes()
    except OSError:
        return None
    for encoding in ("utf-8", "gb18030"):
        try:
            value = json.loads(payload.decode(encoding))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            return value
    return None


def _terminal_bench_task_id(task_name: str) -> str:
    normalized = task_name.strip()
    return normalized if normalized.startswith("terminal-bench/") else f"terminal-bench/{normalized}"


def _terminal_bench_score(result: dict) -> float | None:
    verifier_result = result.get("verifier_result")
    rewards = verifier_result.get("rewards", {}) if isinstance(verifier_result, dict) else {}
    reward = rewards.get("reward")
    if isinstance(reward, (int, float)):
        return float(reward)
    stats = result.get("stats")
    metrics = stats.get("evals", {}) if isinstance(stats, dict) else {}
    if not isinstance(metrics, dict):
        return None
    for evaluation in metrics.values():
        if not isinstance(evaluation, dict):
            continue
        evaluation_metrics = evaluation.get("metrics")
        if not isinstance(evaluation_metrics, list) or not evaluation_metrics:
            continue
        first_metric = evaluation_metrics[0]
        mean = first_metric.get("mean") if isinstance(first_metric, dict) else None
        if isinstance(mean, (int, float)):
            return float(mean)
    return None


def _terminal_bench_failure_reason(
    result: dict,
    *,
    completion_valid: bool,
    evaluable: bool,
    exit_code: int,
    stderr: str,
) -> dict | None:
    if evaluable:
        return None
    exception = result.get("exception_info")
    if isinstance(exception, dict):
        exception_type = exception.get("exception_type") or exception.get("type")
        message = exception.get("exception_message") or exception.get("message")
        text = f"{exception_type or ''} {message or ''}".strip()
        normalized_type = str(exception_type or "").lower()
        if "verifiertimeout" in normalized_type:
            code = "verifier_timeout"
        elif "timeout" in text.lower():
            code = "agent_timeout"
        else:
            code = "harbor_exception"
        return {
            "code": code,
            "type": exception_type,
            "message": message,
            "exit_code": exit_code,
        }
    if not completion_valid:
        metadata = result.get("agent_result", {}).get("metadata") if isinstance(result.get("agent_result"), dict) else None
        if not isinstance(metadata, dict):
            return {"code": "agent_metadata_missing", "message": "Harbor did not return completed agent metadata", "exit_code": exit_code}
        if not metadata.get("completed"):
            return {"code": "agent_incomplete", "message": "Task agent did not report completed=true", "exit_code": exit_code}
        if not isinstance(metadata.get("final_message"), str) or not metadata.get("final_message", "").strip():
            return {"code": "agent_empty_final", "message": "Task agent returned an empty final message", "exit_code": exit_code}
    if not isinstance(result.get("verifier_result"), dict):
        return {"code": "verifier_missing", "message": "Harbor did not return verifier_result", "exit_code": exit_code}
    return {"code": "not_evaluable", "message": "Harbor result failed evaluability checks", "exit_code": exit_code, "stderr": stderr[-1000:]}


def adapter_from_manifest(manifest: dict):
    adapter = manifest.get("adapter")
    if adapter == "arc3":
        return ArcAgi3Adapter()
    if adapter == "arc3-local":
        return ArcAgi3Adapter(local=True, environments_dir=manifest.get("environments_dir"))
    if adapter == "terminal-bench-2":
        return TerminalBench2Adapter(
            dataset=str(manifest.get("dataset") or os.environ.get("HARBOR_DATASET", "terminal-bench/terminal-bench-2")),
            command=str(manifest.get("command") or os.environ.get("HARBOR_COMMAND", "harbor")),
            timeout_seconds=float(manifest.get("timeout_seconds", os.environ.get("HARBOR_TIMEOUT_SECONDS", 3600))),
        )
    raise ValueError(
        f"unsupported environment adapter: {adapter!r}; expected 'arc3', 'arc3-local', or 'terminal-bench-2'"
    )
