"""Unit coverage for assistant history normalization for the AZ chat endpoint."""
from autoresearch_pi.thinking_proxy import rewrite


def test_reasoning_and_thinking_blocks_become_supported_text_blocks():
    payload = {"messages": [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": None, "reasoning_content": "step", "tool_calls": [{"id": "1"}]},
        {"role": "assistant", "content": [{"type": "thinking", "thinking": "prior"},
                                          {"type": "text", "text": "call"}]},
        {"role": "tool", "tool_call_id": "1", "content": "ok"},
    ]}
    messages = rewrite(payload)["messages"]
    message = messages[1]
    assert "reasoning_content" not in message
    assert message["content"] == [{"type": "text", "text": "step"}]
    assert messages[2]["content"] == [{"type": "text", "text": "prior"}, {"type": "text", "text": "call"}]
    assert all(block["type"] != "thinking" for item in messages if isinstance(item.get("content"), list)
               for block in item["content"])


def test_messages_without_reasoning_are_untouched():
    payload = {"messages": [{"role": "assistant", "content": "plain"}]}
    assert rewrite(payload)["messages"][0] == {"role": "assistant", "content": "plain"}
