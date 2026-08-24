import json
from pathlib import Path

import pytest

from hos.environments import ArcAgi3Adapter, TerminalBench2Adapter


def test_local_arc_adapter_discovers_and_runs_bundled_game(tmp_path: Path) -> None:
    environments_dir = Path(__file__).resolve().parents[1] / ".environment_files"
    adapter = ArcAgi3Adapter(local=True, environments_dir=environments_dir)

    environments = adapter.discover()

    assert isinstance(environments, list)
    assert any(environment["game_id"].startswith("dc22-") for environment in environments)

    opened = adapter.open({"game_id": "dc22", "seed": 0}, tmp_path)
    assert opened["observation"] is not None
    assert opened["action_space"]

    stepped = adapter.step(opened["handle"], opened["action_space"][0])
    assert stepped["observation"] is not None
    result = adapter.close(opened["handle"])
    assert isinstance(result["score"], float)


def test_terminal_bench_adapter_runs_internal_hos_bridge_and_reads_reward(tmp_path: Path, monkeypatch) -> None:
    commands: list[list[str]] = []
    environments: list[dict[str, str]] = []

    def fake_runner(command, *, cwd, capture_output, text, timeout, check, env):
        commands.append(command)
        environments.append(env)
        jobs_dir = Path(command[command.index("--jobs-dir") + 1])
        result_dir = jobs_dir / "job" / "video-processing__trial"
        result_dir.mkdir(parents=True)
        (result_dir / "result.json").write_text(
            '{"task_name":"terminal-bench/video-processing",'
            '"agent_result":{"metadata":{"completed":true,"finish_reason":"stop",'
            '"final_message":"done","tool_calls":2}},'
            '"verifier_result":{"rewards":{"reward":0.75}}}',
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    adapter = TerminalBench2Adapter(
        dataset="terminal-bench/terminal-bench-2",
        runner=fake_runner,
    )
    monkeypatch.setenv("HARBOR_VERIFIER_TIMEOUT_MULTIPLIER", "2")
    adapter.configure_task_agent(
        {
            "agent": {"name": "task-agent", "provider": "task"},
            "skills": [],
            "config_path": str(tmp_path / "hos.toml"),
        }
    )

    result = adapter.run_task({"task_name": "video-processing"}, tmp_path)

    assert result["score"] == 0.75
    assert result["completion_valid"] is True
    assert result["evaluable"] is True
    assert result["scorecard"]["harbor_result"]["verifier_result"]["rewards"]["reward"] == 0.75
    assert "--model" not in commands[0]
    assert commands[0][commands[0].index("--include-task-name") + 1] == "terminal-bench/video-processing"
    assert commands[0][commands[0].index("--agent") + 1] == "hos.harbor_bridge:HosTaskAgent"
    assert commands[0][commands[0].index("--verifier-timeout-multiplier") + 1] == "2"
    bridge_config = Path(environments[0]["HOS_HARBOR_BRIDGE_CONFIG_FILE"])
    assert json.loads(bridge_config.read_text(encoding="utf-8"))["agent"]["name"] == "task-agent"


def test_terminal_bench_adapter_requires_task_name(tmp_path: Path) -> None:
    adapter = TerminalBench2Adapter(runner=lambda *args, **kwargs: None)

    with pytest.raises(ValueError, match="requires a task_name"):
        adapter.run_task({}, tmp_path)


def test_terminal_bench_adapter_marks_missing_verifier_as_not_evaluable(tmp_path: Path) -> None:
    def fake_runner(command, *, cwd, capture_output, text, timeout, check, env):
        jobs_dir = Path(command[command.index("--jobs-dir") + 1])
        result_dir = jobs_dir / "job" / "video-processing__trial"
        result_dir.mkdir(parents=True)
        (result_dir / "result.json").write_text(
            json.dumps(
                {
                    "task_name": "terminal-bench/video-processing",
                    "verifier_result": None,
                    "exception_info": {
                        "exception_type": "ConfigError",
                        "exception_message": "provider configuration unavailable",
                    },
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 1, "stderr": ""})()

    adapter = TerminalBench2Adapter(runner=fake_runner)
    adapter.configure_task_agent(
        {
            "agent": {"name": "task-agent", "provider": "task"},
            "skills": [],
            "config_path": str(tmp_path / "hos.toml"),
        }
    )

    result = adapter.run_task({"task_name": "video-processing"}, tmp_path)

    assert result["evaluable"] is False
    assert result["score"] == 0.0
    assert result["harbor_result"]["exception_info"]["exception_type"] == "ConfigError"
    assert result["failure_reason"]["code"] == "harbor_exception"


def test_terminal_bench_adapter_extracts_timeout_failure_reason(tmp_path: Path) -> None:
    def fake_runner(command, *, cwd, capture_output, text, timeout, check, env):
        jobs_dir = Path(command[command.index("--jobs-dir") + 1])
        result_dir = jobs_dir / "job" / "video-processing__trial"
        result_dir.mkdir(parents=True)
        (result_dir / "result.json").write_text(
            json.dumps({
                "task_name": "terminal-bench/video-processing",
                "agent_result": {"metadata": None},
                "exception_info": {"exception_type": "AgentTimeoutError", "exception_message": "Agent execution timed out after 900.0 seconds"},
                "verifier_result": {"rewards": {"reward": 0.0}},
            }),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 1, "stderr": ""})()

    adapter = TerminalBench2Adapter(runner=fake_runner)
    adapter.configure_task_agent({"agent": {"name": "task-agent", "provider": "task"}})
    result = adapter.run_task({"task_name": "video-processing"}, tmp_path)
    assert result["failure_reason"] == {
        "code": "agent_timeout",
        "type": "AgentTimeoutError",
        "message": "Agent execution timed out after 900.0 seconds",
        "exit_code": 1,
    }


def test_terminal_bench_adapter_distinguishes_verifier_timeout(tmp_path: Path) -> None:
    def fake_runner(command, *, cwd, capture_output, text, timeout, check, env):
        jobs_dir = Path(command[command.index("--jobs-dir") + 1])
        result_dir = jobs_dir / "job" / "video-processing__trial"
        result_dir.mkdir(parents=True)
        (result_dir / "result.json").write_text(
            json.dumps({
                "task_name": "terminal-bench/video-processing",
                "agent_result": {"metadata": {"completed": True, "final_message": "done", "tool_calls": 1}},
                "exception_info": {"exception_type": "VerifierTimeoutError", "exception_message": "Verifier execution timed out after 360.0 seconds"},
                "verifier_result": None,
            }),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 1, "stderr": ""})()

    adapter = TerminalBench2Adapter(runner=fake_runner)
    adapter.configure_task_agent({"agent": {"name": "task-agent", "provider": "task"}})

    assert adapter.run_task({"task_name": "video-processing"}, tmp_path)["failure_reason"]["code"] == "verifier_timeout"


def test_terminal_bench_adapter_reads_gb18030_result(tmp_path: Path) -> None:
    marker = "\N{RIGHTWARDS ARROW}"

    def fake_runner(command, *, cwd, capture_output, text, timeout, check, env):
        jobs_dir = Path(command[command.index("--jobs-dir") + 1])
        result_dir = jobs_dir / "job" / "video-processing__trial"
        result_dir.mkdir(parents=True)
        result_dir.joinpath("result.json").write_bytes(
            json.dumps(
                {
                    "task_name": "terminal-bench/video-processing",
                    "agent_result": {"metadata": {"final_message": marker}},
                    "verifier_result": {"rewards": {"reward": 0.25}},
                },
                ensure_ascii=False,
            ).encode("gb18030")
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    adapter = TerminalBench2Adapter(runner=fake_runner)
    adapter.configure_task_agent({"agent": {"name": "task-agent", "provider": "task"}})

    result = adapter.run_task({"task_name": "video-processing"}, tmp_path)

    assert result["score"] == 0.25
    assert result["completion_valid"] is False
    assert result["evaluable"] is False
    assert result["harbor_result"]["agent_result"]["metadata"]["final_message"] == marker
