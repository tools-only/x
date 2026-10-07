"""Actual Pi input, semantic receipts and exact resource recovery; no paid API."""
import json
import re
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_latest_completed_qwen_reasoning_projects_and_recovers_exactly(tmp_path):
    node, cli = _pi_cli()
    fixture = Path(__file__).with_name("pi_latest_reasoning_native_fixture.ts")
    command = [node, cli, "--mode", "rpc", "--provider", "yibu", "--model", "qwen3.8-27b",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(fixture)]
    env = {"PI_CODING_AGENT_DIR": str(tmp_path / ".pi-agent"), "PI_AUTORESEARCH_E2E_ROOT": str(tmp_path),
           "PI_PROVIDER_REASONING_HISTORY_POLICY": "summarize_completed_openai_field",
           "PI_PROVIDER_EDITABLE_REASONING_PROVIDERS": "yibu"}
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=30) as kernel:
        kernel.prompt("Use the public semantic probe, recover exact missing evidence once, then finish.")
        events = kernel.wait_for_agent_events(timeout=30)
    (tmp_path / "native-pi-events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in events), encoding="utf-8")
    assert not [row for row in events if row.get("isError") or row.get("type") == "extension_error"]
    material = json.loads((tmp_path / "fixture-material.json").read_text(encoding="utf-8"))
    captures = rows(tmp_path / "provider-contexts.jsonl")
    native = rows(tmp_path / "native-messages.jsonl")
    original = next(message for message in native if message["role"] == "assistant"
                    and any(part.get("type") == "thinking" for part in message["content"]))
    assert original["api"] == "openai-completions" and original["provider"] == "yibu"
    assert original["content"][0]["thinkingSignature"] == "reasoning_content"
    assert original["content"][0]["thinking"] == material["thinking"]

    projected_messages = captures[1]["context"]["messages"]
    projected = next(message for message in projected_messages if message["role"] == "assistant")
    # This is the latest completed exchange: there is no later assistant yet.
    assert not any(part.get("type") == "thinking" for part in projected["content"])
    excerpts = [part["text"] for part in projected["content"] if part.get("type") == "text"
                and re.search(r"context:msg-[a-f0-9]{64}@v1", part.get("text", ""))]
    assert len(excerpts) == 1
    excerpt = excerpts[0]
    assert excerpt.endswith(material["thinking"][-2500:])
    assert "SYNTHETIC_REASONING_HEAD" not in excerpt
    ref = re.search(r"context:msg-[a-f0-9]{64}@v1", excerpt).group()
    assert {**projected, "content": projected["content"][1:]} == {**original, "content": original["content"][1:]}
    assert any(part.get("text") == material["publicText"] for part in projected["content"])
    assert next(part for part in projected["content"] if part["type"] == "toolCall")["arguments"] == material["argumentsValue"]
    semantic = next(message for message in projected_messages if message["role"] == "toolResult"
                    and message["toolCallId"] == "public-call-1")
    assert semantic["content"] == [{"type": "text", "text": material["semanticText"]}]
    assert semantic == next(message for message in native if message["role"] == "toolResult"
                            and message["toolCallId"] == "public-call-1")

    assert len(captures) == 4
    source_id = ref.removeprefix("context:").removesuffix("@v1")
    archived = next(row for row in rows(tmp_path / "task-context-cache" / "messages.jsonl")
                    if row["archive_id"] == source_id)
    assert archived["message"] == original
    recovery = next(message for message in native if message["role"] == "toolResult"
                    and message["toolCallId"] == "public-call-2")
    page = json.loads(recovery["content"][0]["text"])
    assert page["ref"] == ref and page["offset"] == 0 and page["complete"] is True
    assert json.loads(page["text"]) == archived
    assert json.loads(page["text"])["message"] == original
    assert material["thinking"] == json.loads(page["text"])["message"]["content"][0]["thinking"]
    for capture in captures[2:]:
        messages = capture["context"]["messages"]
        assert any(message == recovery for message in messages)
        assert capture["read_workset"]["missing_unacknowledged"] == []
        assert capture["read_workset"]["included_page_count"] == 1
        assert any(message == semantic for message in messages)
    read_calls = [row for row in events if row.get("type") == "tool_execution_start" and row.get("toolName") == "task_resource"]
    assert len(read_calls) == 1 and read_calls[0]["args"]["ref"] == ref
    workset = rows(tmp_path / "task-read-workset-events.jsonl")
    assert len([row for row in workset if row["event"] == "read"]) == 1
    compactions = rows(tmp_path / "task-context-compactions.jsonl")
    assert compactions and all(row["archived_messages"] == 0 and not row["protected_overflow"] for row in compactions)
