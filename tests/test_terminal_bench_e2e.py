import json
from types import SimpleNamespace

from autoresearch_pi.terminal_bench_e2e import (
    build_harbor_command,
    discover_terminal_trial,
    project_terminal_summary,
    run_terminal_bench_e2e,
)


def test_terminal_bench_command_uses_project_pi_adapter_and_one_task(tmp_path):
    dataset = tmp_path / "terminal-bench-2-1"
    command = build_harbor_command(
        root=tmp_path / "run", dataset=dataset, task_id="chess-best-move",
        model="yibu/a:deepseek-v4-flash", variant="treatment", context_compaction=True,
        harbor_command="harbor",
    )

    assert command[:2] == ["harbor", "run"]
    assert command[command.index("--agent") + 1] == "autoresearch_pi.terminal_bench_agent:AutoResearchPiAgent"
    assert command[command.index("--path") + 1] == str(dataset.resolve())
    assert command[command.index("--include-task-name") + 1] == "chess-best-move"
    assert command[command.index("--n-tasks") + 1] == "1"
    assert "experiment_variant=treatment" in command
    assert "context_compaction=true" in command
    assert not any("meta-harness" in part or "continual-harness" in part for part in command)


def test_terminal_result_discovery_and_projection_separate_reward_from_harness(tmp_path):
    job = tmp_path / "harbor" / "run"
    trial = job / "chess-best-move__abc123"
    agent = trial / "agent"
    agent.mkdir(parents=True)
    native = {
        "task_name": "terminal-bench/chess-best-move",
        "trial_name": trial.name,
        "verifier_result": {"rewards": {"reward": 1.0}},
        "agent_result": {"n_input_tokens": 100, "n_output_tokens": 20},
        "exception_info": None,
    }
    (trial / "result.json").write_text(json.dumps(native), encoding="utf-8")
    (agent / "research-resources.jsonl").write_text(
        json.dumps({"finding_id": "finding-1", "version": 1}) + "\n", encoding="utf-8"
    )
    (agent / "execution-signals.jsonl").write_text(
        json.dumps({"signal_id": "execution-signal-1"}) + "\n", encoding="utf-8"
    )
    (agent / "pattern-candidates.jsonl").write_text(
        json.dumps({"candidate_id": "pattern-candidate-1", "version": 1}) + "\n", encoding="utf-8"
    )
    (agent / "effect-assessments.jsonl").write_text(
        json.dumps({"effect_assessment_id": "assessment-1", "verdict": "supported"}) + "\n", encoding="utf-8"
    )

    assert discover_terminal_trial(job.parent, "chess-best-move") == trial
    summary = project_terminal_summary(
        tmp_path, task_id="chess-best-move", variant="treatment",
        trial=trial, process_returncode=0, timed_out=False,
    )

    assert summary["benchmark_evaluation"] == {
        "source": "terminal_bench_native_verifier",
        "reward": 1.0,
        "passed": True,
    }
    assert summary["self_harness_evaluation"]["supported_effect_assessments"] == 1
    assert summary["self_harness_evaluation"]["harness_improved"] is None
    assert summary["research"]["execution_signal_count"] == 1
    assert summary["research"]["pattern_candidate_versions"] == 1
    assert summary["artifacts"]["execution_signals"].endswith("execution-signals.jsonl")
    assert summary["artifacts"]["pattern_candidates"].endswith("pattern-candidates.jsonl")
    assert summary["passed"] is True


def test_terminal_runner_preserves_interrupted_partial_artifacts(monkeypatch, tmp_path):
    dataset = tmp_path / "dataset"
    (dataset / "chess-best-move").mkdir(parents=True)

    def fake_run(command, **kwargs):
        jobs_dir = tmp_path / "run" / "harbor"
        trial = jobs_dir / "run" / "chess-best-move__partial"
        agent = trial / "agent"
        agent.mkdir(parents=True)
        (trial / "result.json").write_text(json.dumps({
            "task_name": "terminal-bench/chess-best-move",
            "verifier_result": {"rewards": {"reward": 0.0}},
            "exception_info": {"exception_type": "AgentTimeoutError"},
        }), encoding="utf-8")
        (agent / "execution-observations.jsonl").write_text(
            json.dumps({"observation_id": "execution-observation-1"}) + "\n", encoding="utf-8"
        )
        return SimpleNamespace(returncode=1, stdout="partial", stderr="timeout")

    monkeypatch.setattr("autoresearch_pi.terminal_bench_e2e.shutil.which", lambda name: "harbor")
    summary_path = run_terminal_bench_e2e(
        tmp_path / "run", dataset=dataset, task_id="chess-best-move", timeout=5,
        process_runner=fake_run,
    )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))

    assert summary["passed"] is False
    assert summary["runtime"]["process_returncode"] == 1
    assert summary["artifacts"]["observations"].endswith("execution-observations.jsonl")
    assert summary["observation_count"] == 1
