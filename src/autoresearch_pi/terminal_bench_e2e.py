"""Thin Harbor adapter for one local Terminal-Bench task."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from .research_evidence import project_research_evidence

from .project import load_project_dotenv


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    result: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            result.append(value)
    return result


def _normalize_model(model: str | None) -> str:
    selected = model or os.getenv("EXEC_MODEL", "a:deepseek-v4-flash")
    return selected if "/" in selected else f"yibu/{selected}"


def build_harbor_command(
    *,
    root: Path,
    dataset: Path,
    task_id: str,
    model: str | None,
    variant: str,
    context_compaction: bool,
    harbor_command: str,
) -> list[str]:
    """Build a one-task Harbor command without importing another harness."""
    return [
        harbor_command, "run", "--jobs-dir", str((root / "harbor").resolve()),
        "--job-name", "run", "--path", str(dataset.resolve()),
        "--include-task-name", task_id, "--n-tasks", "1", "--n-concurrent", "1",
        "--agent", "autoresearch_pi.terminal_bench_agent:AutoResearchPiAgent",
        "--model", _normalize_model(model),
        "--agent-kwarg", "version=0.80.6",
        "--agent-kwarg", f"experiment_variant={variant}",
        "--agent-kwarg", f"context_compaction={'true' if context_compaction else 'false'}",
        "--agent-include-logs", "*.jsonl", "--agent-include-logs", "*.json",
        "--yes",
    ]


def discover_terminal_trial(jobs_dir: Path, task_id: str) -> Path | None:
    """Find the one native trial selected by the task filter."""
    candidates: list[Path] = []
    for result in jobs_dir.rglob("result.json") if jobs_dir.is_dir() else ():
        if result.parent == jobs_dir or result.parent.name == "run":
            continue
        try:
            value = json.loads(result.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        task_name = str(value.get("task_name") or "") if isinstance(value, dict) else ""
        if task_name.endswith("/" + task_id) or result.parent.name.startswith(task_id + "__"):
            candidates.append(result.parent)
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def project_terminal_summary(
    root: Path,
    *,
    task_id: str,
    variant: str,
    trial: Path | None,
    process_returncode: int,
    timed_out: bool,
) -> dict[str, Any]:
    native: dict[str, Any] = {}
    if trial is not None and (trial / "result.json").is_file():
        value = json.loads((trial / "result.json").read_text(encoding="utf-8"))
        if isinstance(value, dict):
            native = value
    agent_dir = trial / "agent" if trial is not None else root / "harbor" / "missing-agent"
    observations = _read_jsonl(agent_dir / "execution-observations.jsonl")
    findings = _read_jsonl(agent_dir / "research-resources.jsonl")
    execution_signals = _read_jsonl(agent_dir / "execution-signals.jsonl")
    pattern_candidates = _read_jsonl(agent_dir / "pattern-candidates.jsonl")
    decisions = _read_jsonl(agent_dir / "harness-decisions.jsonl")
    exposures = _read_jsonl(agent_dir / "harness-observations.jsonl")
    assessments = _read_jsonl(agent_dir / "effect-assessments.jsonl")
    rewards = ((native.get("verifier_result") or {}).get("rewards") or {}) if native else {}
    reward = rewards.get("reward")
    numeric_reward = float(reward) if isinstance(reward, (int, float)) else None
    verifier_passed = numeric_reward == 1.0
    supported = [item for item in assessments if item.get("verdict") == "supported"]
    relative_agent = str(agent_dir.relative_to(root)) if trial is not None else None
    def artifact(name: str) -> str | None:
        return str((agent_dir / name).relative_to(root)) if trial is not None else None
    return {
        "pipeline": "pi-native-terminal-bench-e2e",
        "task_id": task_id,
        "experiment": {"variant": variant, "control": variant == "control"},
        "execution_model": "pi_native_agent_inside_harbor_environment",
        "passed": bool(verifier_passed and process_returncode == 0 and not timed_out),
        "benchmark_evaluation": {
            "source": "terminal_bench_native_verifier", "reward": numeric_reward, "passed": verifier_passed,
        },
        "runtime": {
            "process_returncode": process_returncode, "timed_out": timed_out,
            "exception_info": native.get("exception_info"), "agent_result": native.get("agent_result"),
        },
        "observation_count": len(observations),
        "research": project_research_evidence(
            findings=findings,
            execution_signals=execution_signals,
            pattern_candidates=pattern_candidates,
            harness_decisions=decisions,
            harness_observations=exposures,
            effect_assessments=assessments,
        ),
        "self_harness_evaluation": {
            "decision_count": len(decisions), "exposure_count": len(exposures),
            "effect_assessment_count": len(assessments),
            "supported_effect_assessments": len(supported), "harness_improved": None,
            "interpretation": "Verifier reward is task correctness, not evidence that the harness improved.",
        },
        "native_trial_result": native,
        "artifacts": {
            "trial": str(trial.relative_to(root)) if trial is not None else None,
            "agent_dir": relative_agent,
            "pi_events": artifact("pi-events.jsonl"), "observations": artifact("execution-observations.jsonl"),
            "execution_signals": artifact("execution-signals.jsonl"),
            "pattern_candidates": artifact("pattern-candidates.jsonl"),
            "findings": artifact("research-resources.jsonl"), "decisions": artifact("harness-decisions.jsonl"),
            "effects": artifact("effect-assessments.jsonl"),
        },
    }


def run_terminal_bench_e2e(
    root: Path,
    *,
    dataset: Path,
    task_id: str,
    experiment_variant: str = "treatment",
    timeout: float = 3600.0,
    model: str | None = None,
    context_compaction: bool = False,
    process_runner: Callable[..., Any] | None = None,
) -> Path:
    if experiment_variant not in {"control", "treatment"}:
        raise ValueError("experiment_variant must be control or treatment")
    root = root.resolve()
    dataset = dataset.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("Terminal-Bench output must be an empty directory; use a new run root")
    if not (dataset / task_id).is_dir():
        raise FileNotFoundError(f"Terminal-Bench task was not found: {dataset / task_id}")
    harbor = shutil.which("harbor")
    if not harbor:
        raise RuntimeError("Harbor executable was not found")
    root.mkdir(parents=True, exist_ok=True)
    status_path = root / "runner-status.json"
    status_path.write_text(json.dumps({"status": "running", "task_id": task_id}, indent=2) + "\n", encoding="utf-8")
    command = build_harbor_command(
        root=root, dataset=dataset, task_id=task_id, model=model,
        variant=experiment_variant, context_compaction=context_compaction,
        harbor_command=harbor,
    )
    project_root = Path(__file__).resolve().parents[2]
    env = load_project_dotenv(project_root)
    src = str(Path(__file__).resolve().parent.parent)
    env["PYTHONPATH"] = src + os.pathsep + env.get("PYTHONPATH", "")
    runner = process_runner or subprocess.run
    timed_out = False
    stdout = ""
    stderr = ""
    returncode = 1
    try:
        completed = runner(
            command, cwd=str(root), env=env, text=True, encoding="utf-8", errors="replace",
            capture_output=True, timeout=timeout, check=False,
        )
        returncode = int(completed.returncode)
        stdout, stderr = str(completed.stdout or ""), str(completed.stderr or "")
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        returncode = 124
        stdout = str(exc.stdout or "")
        stderr = str(exc.stderr or "")
    (root / "harbor-stdout.txt").write_text(stdout, encoding="utf-8")
    (root / "harbor-stderr.txt").write_text(stderr, encoding="utf-8")
    trial = discover_terminal_trial(root / "harbor", task_id)
    payload = project_terminal_summary(
        root, task_id=task_id, variant=experiment_variant, trial=trial,
        process_returncode=returncode, timed_out=timed_out,
    )
    summary = root / "summary.json"
    temporary = root / "summary.json.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(summary)
    status_path.write_text(json.dumps({
        "status": "complete" if returncode == 0 else "interrupted", "task_id": task_id,
        "returncode": returncode, "timed_out": timed_out, "trial": str(trial) if trial else None,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary
