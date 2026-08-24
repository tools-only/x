from pathlib import Path
from types import SimpleNamespace

import pytest

import hos.llm_runtime as runtime


class FakeConfig:
    def resolve_provider(self, name: str, *, require_secret: bool):
        return SimpleNamespace(name=name, model="model")


class FakeClient:
    def __init__(self, responses: list[dict]):
        self.responses = iter(responses)

    def chat(self, messages, *, tools, max_tokens):
        return next(self.responses)


def response(content: str, finish_reason: str, tool_calls: list[dict] | None = None) -> dict:
    message = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}


def call(call_id: str, name: str, arguments: str) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments},
    }


def init(tmp_path: Path, *, role: str) -> dict:
    return {
        "run_id": "agent-test",
        "artifact_dir": str(tmp_path),
        "harness_role": role,
        "input": {},
        "agent": {
            "name": "agent",
            "provider": "test",
            "max_turns": 4,
            "max_tokens": 128,
            "skills": [],
            "runtime_context": {},
        },
    }


def configure(monkeypatch: pytest.MonkeyPatch, responses: list[dict]) -> None:
    monkeypatch.setattr(runtime, "load_config", lambda: FakeConfig())
    monkeypatch.setattr(runtime, "create_provider_client", lambda provider: FakeClient(responses))


def test_meta_agent_rejects_truncated_empty_completion(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(monkeypatch, [response("", "length")])

    with pytest.raises(RuntimeError, match="truncated"):
        runtime.run_llm_agent(init(tmp_path, role="meta"), lambda method, arguments: {})


def test_task_agent_requires_and_accepts_complete_episode_lifecycle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(
        monkeypatch,
        [
            response("opening", "tool_calls", [call("open", "env_open", '{"case":{}}')]),
            response("closing", "tool_calls", [call("close", "env_close", '{"episode":"ep-1"}')]),
            response("Task completed and verified.", "stop"),
        ],
    )

    def host_result(method: str, arguments: dict) -> dict:
        if method == "env.open":
            return {"episode": "ep-1"}
        if method == "env.close":
            return {"run_id": "ep-1", "score": 1.0, "evaluable": True}
        raise AssertionError(method)

    result = runtime.run_llm_agent(init(tmp_path, role="task"), host_result)

    assert result["final_message"] == "Task completed and verified."
    assert result["tool_calls"] == 2
    assert result["episodes"][0]["evaluable"] is True
