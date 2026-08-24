from __future__ import annotations

import json
import socket
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from openai import APIError, APIConnectionError, APITimeoutError, OpenAI

from .config import ProviderConfig


class ProviderError(RuntimeError):
    pass


class OpenAICompatibleClient:
    def __init__(self, provider: ProviderConfig):
        if provider.provider_type != "openai_compatible":
            raise ProviderError(f"unsupported provider type: {provider.provider_type}")
        self.provider = provider
        default_headers = dict(provider.headers)
        api_key = provider.api_key or "placeholder"
        if provider.auth_header.lower() != "authorization" or provider.auth_prefix.strip().lower() != "bearer":
            if provider.api_key:
                default_headers[provider.auth_header] = (
                    f"{provider.auth_prefix.strip()} {provider.api_key}".strip()
                )
            api_key = "placeholder"
        self.client = OpenAI(
            api_key=api_key,
            base_url=provider.base_url,
            timeout=provider.timeout_seconds,
            max_retries=3,
            default_headers=default_headers or None,
        )

    def chat(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        try:
            extra_body = dict(self.provider.reasoning or {})
            if self.provider.reasoning_effort and "effort" not in extra_body:
                extra_body["effort"] = self.provider.reasoning_effort
            response = self.client.chat.completions.create(
                model=self.provider.model,
                messages=messages,
                tools=tools or None,
                max_tokens=max_tokens,
                extra_body={"reasoning": extra_body} if extra_body else None,
            )
        except (APIConnectionError, APITimeoutError) as exc:
            raise ProviderError(f"provider request failed: {exc}") from exc
        except APIError as exc:
            raise ProviderError(f"provider returned HTTP {exc.status_code}: {exc}") from exc
        except Exception as exc:
            raise ProviderError(f"provider request failed: {exc}") from exc
        result = _model_to_dict(response)
        if not isinstance(result, dict):
            raise ProviderError("provider response must be a JSON object")
        return result

    def probe(self) -> dict:
        response = self.chat(
            [{"role": "user", "content": "Reply with exactly OK."}],
            max_tokens=8,
        )
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("provider response is not OpenAI chat-completions compatible") from exc
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "response_id": response.get("id"),
            "content": content,
            "usage": response.get("usage"),
        }


class AnthropicMessagesClient:
    MAX_ATTEMPTS = 3

    def __init__(self, provider: ProviderConfig):
        if provider.provider_type != "anthropic_messages":
            raise ProviderError(f"unsupported provider type: {provider.provider_type}")
        self.provider = provider

    def chat(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        system, anthropic_messages = _anthropic_messages(messages)
        request_body = {
            "model": self.provider.model,
            "max_tokens": max_tokens or 1024,
            "messages": anthropic_messages,
        }
        if system:
            request_body["system"] = system
        if tools:
            request_body["tools"] = [_anthropic_tool(tool) for tool in tools]
        thinking = dict(self.provider.reasoning or {})
        if self.provider.reasoning_effort and not thinking:
            effort_budget = {"low": 1024, "medium": 2048, "high": 4096}.get(
                self.provider.reasoning_effort.lower(),
                2048,
            )
            thinking = {"type": "enabled", "budget_tokens": effort_budget}
        if thinking:
            request_body["thinking"] = thinking

        headers = {"Content-Type": "application/json", **self.provider.headers}
        if self.provider.api_key:
            headers[self.provider.auth_header] = (
                f"{self.provider.auth_prefix.strip()} {self.provider.api_key}".strip()
            )
        if not any(name.lower() == "anthropic-version" for name in headers):
            headers["anthropic-version"] = self.provider.anthropic_version or "2023-06-01"
        encoded_body = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            request = Request(
                self.provider.url,
                data=encoded_body,
                headers=headers,
                method="POST",
            )
            try:
                with urlopen(request, timeout=self.provider.timeout_seconds) as response:
                    result = json.loads(response.read().decode("utf-8"))
                break
            except HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[-1000:]
                if attempt < self.MAX_ATTEMPTS and (exc.code == 429 or exc.code >= 500):
                    time.sleep(2 ** (attempt - 1))
                    continue
                raise ProviderError(f"provider returned HTTP {exc.code}: {detail}") from exc
            except (URLError, TimeoutError, socket.timeout, ConnectionError) as exc:
                if attempt < self.MAX_ATTEMPTS:
                    time.sleep(2 ** (attempt - 1))
                    continue
                raise ProviderError(
                    f"provider request failed after {self.MAX_ATTEMPTS} attempts: {exc}"
                ) from exc
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ProviderError("provider returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise ProviderError("provider response must be a JSON object")
        return _anthropic_response(result)

    def probe(self) -> dict:
        response = self.chat(
            [{"role": "user", "content": "Reply with exactly OK."}],
            max_tokens=8,
        )
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("provider response is not Anthropic messages compatible") from exc
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "response_id": response.get("id"),
            "content": content,
            "usage": response.get("usage"),
        }


def create_provider_client(provider: ProviderConfig) -> OpenAICompatibleClient | AnthropicMessagesClient:
    if provider.provider_type == "openai_compatible":
        return OpenAICompatibleClient(provider)
    if provider.provider_type == "anthropic_messages":
        return AnthropicMessagesClient(provider)
    raise ProviderError(f"unsupported provider type: {provider.provider_type}")


def assistant_message(response: dict) -> dict:
    """Return one normalized assistant message for the next turn."""
    try:
        message = response["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("provider response has no assistant message") from exc
    if not isinstance(message, dict):
        raise ProviderError("provider assistant message must be an object")
    return message


def conversation_assistant_message(response: dict) -> dict:
    """Keep provider reasoning fields that may be required on the next turn."""
    message = assistant_message(response)
    normalized = {
        key: message[key]
        for key in ("role", "content", "tool_calls", "reasoning_content", "reasoning_details")
        if key in message
    }
    normalized.setdefault("role", "assistant")
    normalized.setdefault("content", "")
    return normalized


def finish_reason(response: dict) -> str | None:
    try:
        value = response["choices"][0].get("finish_reason")
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ProviderError("provider response has no finish reason") from exc
    return value if isinstance(value, str) else None


def _model_to_dict(value: Any) -> dict:
    if hasattr(value, "model_dump"):
        result = value.model_dump(exclude_none=True)
    elif hasattr(value, "to_dict"):
        result = value.to_dict()
    elif isinstance(value, dict):
        result = value
    else:
        raise ProviderError("provider response must be an OpenAI response object")
    if not isinstance(result, dict):
        raise ProviderError("provider response must be a JSON object")
    return result


def _anthropic_tool(tool: dict) -> dict:
    function = tool.get("function") if isinstance(tool, dict) else None
    if tool.get("type") != "function" or not isinstance(function, dict):
        raise ProviderError("Anthropic tools must use the internal function-tool format")
    name = function.get("name")
    parameters = function.get("parameters")
    if not isinstance(name, str) or not isinstance(parameters, dict):
        raise ProviderError("Anthropic tool requires a name and object parameters")
    result = {"name": name, "input_schema": parameters}
    description = function.get("description")
    if isinstance(description, str) and description:
        result["description"] = description
    return result


def _anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    converted: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            if isinstance(content, str) and content:
                system_parts.append(content)
            continue
        if role == "assistant":
            blocks = []
            reasoning_content = message.get("reasoning_content")
            if isinstance(reasoning_content, str) and reasoning_content:
                blocks.append({"type": "thinking", "thinking": reasoning_content})
            if isinstance(content, str) and content:
                blocks.append({"type": "text", "text": content})
            tool_calls = message.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise ProviderError("assistant tool_calls must be an array")
            for tool_call in tool_calls:
                function = tool_call.get("function", {})
                name = function.get("name")
                arguments = function.get("arguments", "{}")
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except json.JSONDecodeError as exc:
                        raise ProviderError("assistant tool arguments must be valid JSON") from exc
                if not isinstance(name, str) or not isinstance(arguments, dict):
                    raise ProviderError("assistant tool call requires a name and object arguments")
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": str(tool_call.get("id") or "tool-call"),
                        "name": name,
                        "input": arguments,
                    }
                )
            _append_anthropic_message(converted, "assistant", blocks or [{"type": "text", "text": ""}])
            continue
        if role == "tool":
            tool_call_id = message.get("tool_call_id")
            if not isinstance(tool_call_id, str) or not tool_call_id:
                raise ProviderError("tool result requires tool_call_id")
            tool_content = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            _append_anthropic_message(
                converted,
                "user",
                [{"type": "tool_result", "tool_use_id": tool_call_id, "content": tool_content}],
            )
            continue
        if role == "user":
            text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            _append_anthropic_message(converted, "user", [{"type": "text", "text": text}])
            continue
        raise ProviderError(f"unsupported message role for Anthropic: {role!r}")
    if not converted or converted[0]["role"] != "user":
        converted.insert(
            0,
            {"role": "user", "content": [{"type": "text", "text": "Begin the assigned work."}]},
        )
    return "\n\n".join(system_parts), converted


def _append_anthropic_message(messages: list[dict], role: str, blocks: list[dict]) -> None:
    if messages and messages[-1]["role"] == role:
        messages[-1]["content"].extend(blocks)
    else:
        messages.append({"role": role, "content": blocks})


def _anthropic_response(response: dict) -> dict:
    content = response.get("content")
    if not isinstance(content, list):
        raise ProviderError("Anthropic response content must be an array")
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    reasoning_parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            text_parts.append(block["text"])
        elif block.get("type") == "thinking" and isinstance(block.get("thinking"), str):
            reasoning_parts.append(block["thinking"])
        elif block.get("type") == "tool_use":
            name = block.get("name")
            arguments = block.get("input", {})
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise ProviderError("Anthropic tool_use requires a name and object input")
            tool_calls.append(
                {
                    "id": str(block.get("id") or "tool-call"),
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(arguments, ensure_ascii=False, separators=(",", ":")),
                    },
                }
            )
    usage = response.get("usage")
    normalized_usage = None
    if isinstance(usage, dict):
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        normalized_usage = {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }
    stop_reason = response.get("stop_reason")
    finish_reason = {
        "tool_use": "tool_calls",
        "max_tokens": "length",
        "end_turn": "stop",
        "stop_sequence": "stop",
    }.get(stop_reason, stop_reason)
    message = {"role": "assistant", "content": "\n".join(text_parts)}
    if reasoning_parts:
        message["reasoning_content"] = "\n".join(reasoning_parts)
    if tool_calls:
        message["tool_calls"] = tool_calls
    result = {
        "id": response.get("id"),
        "object": "chat.completion",
        "model": response.get("model"),
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
    }
    if normalized_usage is not None:
        result["usage"] = normalized_usage
    return result
