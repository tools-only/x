import json
import os
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from hos.store import ObjectStore
from hos.supervisor import Supervisor

from helpers import publish_agent, publish_harness


def test_runtime_process_uses_utf8_protocol_streams(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    root = publish_agent(store, "solver", "echo")
    harness = publish_harness(store, root)
    captured: dict = {}

    class FakeProcess:
        pid = 1234

        def __init__(self) -> None:
            self.stdin = StringIO()
            self.stdout = StringIO(
                '{"type":"runtime.ready","pid":4321,"run_id":"agent-fixed","role":"root","driver":"echo"}\n'
                '{"type":"runtime.finish","result":{"echo":{}}}\n'
            )
            self.stderr = StringIO()

        def wait(self, timeout: float) -> int:
            return 0

    def fake_popen(*args, **kwargs):
        captured.update(kwargs)
        return FakeProcess()

    with patch("hos.supervisor.subprocess.Popen", fake_popen):
        Supervisor(store).start_harness(harness, {})

    assert captured["encoding"] == "utf-8"
    assert captured["errors"] == "replace"
    assert captured["env"]["PYTHONIOENCODING"] == "utf-8"
    assert captured["env"]["PYTHONPATH"].split(os.pathsep)[0].endswith("src")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_declared_subagent_is_a_separate_kernel_managed_process(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    critic = publish_agent(store, "critic", "critic")
    root = publish_agent(
        store,
        "solver",
        "spawn-critic",
        subagents={"critic": {"agent": critic, "max_instances": 1}},
    )
    harness = publish_harness(store, root)

    result = Supervisor(store).start_harness(harness, {"input": "inspect this proposal"})

    assert result["status"] == "succeeded"
    harness_dir = store.root / "runs" / result["run_id"]
    agent_handles = read_jsonl(harness_dir / "agents.jsonl")
    assert [handle["role"] for handle in agent_handles] == ["root", "critic"]

    root_dir = store.root / "runs" / agent_handles[0]["run_id"]
    critic_dir = store.root / "runs" / agent_handles[1]["run_id"]
    root_status = read_json(root_dir / "status.json")
    critic_status = read_json(critic_dir / "status.json")
    assert root_status["pid"] != critic_status["pid"]
    assert root_status["state"] == critic_status["state"] == "succeeded"
    assert root_status["runtime_ready"] is True
    assert isinstance(root_status["runtime_pid"], int)
    assert critic_status["runtime_ready"] is True
    assert isinstance(critic_status["runtime_pid"], int)
    assert read_json(critic_dir / "parent.json")["agent_run"] == agent_handles[0]["run_id"]
    assert result["result"]["critic"]["role"] == "critic"
    assert read_json(harness_dir / "usage.json")["agent_runs"] == 2
    root_events = read_jsonl(root_dir / "events.jsonl")
    assert any(event["type"] == "runtime.ready" for event in root_events)
    assert any(event["type"] == "runtime.finished" for event in root_events)
    assert "runtime.boot" in (root_dir / "stderr.log").read_text(encoding="utf-8")


def test_undeclared_subagent_spawn_is_denied_and_audited(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    root = publish_agent(store, "solver", "spawn-undeclared")
    harness = publish_harness(store, root)

    result = Supervisor(store).start_harness(harness, {})

    assert result["status"] == "succeeded"
    assert result["result"] == {"denied": "capability_denied"}
    harness_dir = store.root / "runs" / result["run_id"]
    handles = read_jsonl(harness_dir / "agents.jsonl")
    assert len(handles) == 1
    root_events = read_jsonl(store.root / "runs" / handles[0]["run_id"] / "events.jsonl")
    assert any(event["type"] == "capability.denied" for event in root_events)


def test_harness_budget_denies_subagent_after_root_consumes_only_agent_slot(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    critic = publish_agent(store, "critic", "critic")
    root = publish_agent(
        store,
        "solver",
        "spawn-critic",
        subagents={"critic": {"agent": critic, "max_instances": 1}},
    )
    harness = publish_harness(store, root)

    result = Supervisor(store).start_harness(harness, {}, budget={"max_agent_runs": 1})

    assert result["status"] == "succeeded"
    assert result["result"] == {"denied": "budget_exhausted"}
    usage = read_json(store.root / "runs" / result["run_id"] / "usage.json")
    assert usage == {"agent_runs": 1, "episode_runs": 0, "host_calls": 1}
