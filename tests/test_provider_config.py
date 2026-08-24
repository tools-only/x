import json
import threading
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import hos.provider as provider_module
from hos.config import ConfigError, ProviderConfig, load_config, load_dotenv
from hos.provider import (
    AnthropicMessagesClient,
    OpenAICompatibleClient,
    conversation_assistant_message,
    create_provider_client,
)


CONFIG = """
version = 1
default_provider = "custom"

[providers.custom]
type = "openai_compatible"
base_url = "https://gateway.example/v1/"
endpoint = "/chat/completions"
api_key_env = "CUSTOM_API_KEY"
model = "example-model"
timeout_seconds = 12

[providers.custom.reasoning]
enabled = true
effort = "high"

[providers.custom.headers]
X-Client = "meta-harness"

[providers.custom.header_env]
X-Tenant = "CUSTOM_TENANT"
"""


ANTHROPIC_CONFIG = """
version = 1
default_provider = "anthropic"

[providers.anthropic]
type = "anthropic_messages"
base_url = "https://api.anthropic.com"
model = "claude-example"
api_key_env = "ANTHROPIC_API_KEY"
anthropic_version = "2023-06-01"
timeout_seconds = 12
"""


def test_config_resolves_custom_provider_env_overrides_and_redacts_secrets(tmp_path: Path) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(CONFIG, encoding="utf-8")
    environment = {
        "CUSTOM_API_KEY": "secret-key",
        "CUSTOM_TENANT": "tenant-secret",
        "HOS_BASE_URL": "https://override.example/api/v1",
        "HOS_MODEL": "override-model",
    }

    config = load_config(path, environment=environment)
    provider = config.resolve_provider(require_secret=True)

    assert provider.name == "custom"
    assert provider.base_url == "https://override.example/api/v1"
    assert provider.endpoint == "/chat/completions"
    assert provider.model == "override-model"
    assert provider.api_key == "secret-key"
    assert provider.headers == {"X-Client": "meta-harness", "X-Tenant": "tenant-secret"}
    assert provider.reasoning == {"enabled": True, "effort": "high"}
    redacted = provider.redacted()
    assert redacted["api_key"] == "***"
    assert redacted["headers"]["X-Tenant"] == "***"
    assert "secret-key" not in json.dumps(redacted)
    assert "tenant-secret" not in json.dumps(redacted)


def test_config_reports_missing_selected_provider_and_secret(tmp_path: Path) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(CONFIG, encoding="utf-8")

    with pytest.raises(ConfigError, match="CUSTOM_API_KEY"):
        load_config(path, environment={}).resolve_provider(require_secret=True)

    with pytest.raises(ConfigError, match="unknown provider"):
        load_config(path, environment={"HOS_PROVIDER": "missing"}).resolve_provider()


def test_optional_header_environment_is_omitted_when_unset(tmp_path: Path) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(CONFIG, encoding="utf-8")

    provider = load_config(path, environment={"CUSTOM_API_KEY": "key"}).resolve_provider(require_secret=True)

    assert provider.headers == {"X-Client": "meta-harness"}


def test_config_loads_dotenv_without_overriding_process_environment(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(CONFIG, encoding="utf-8")
    (tmp_path / ".env").write_text("CUSTOM_API_KEY=dotenv-key\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CUSTOM_API_KEY", raising=False)

    provider = load_config(path).resolve_provider(require_secret=True)

    assert provider.api_key == "dotenv-key"
    monkeypatch.setenv("CUSTOM_API_KEY", "process-key")
    assert load_config(path).resolve_provider(require_secret=True).api_key == "process-key"


def test_config_and_dotenv_are_discovered_from_repository_subdirectory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "hos.toml").write_text(CONFIG, encoding="utf-8")
    (project / ".env").write_text("CUSTOM_API_KEY=ancestor-key\n", encoding="utf-8")
    working_directory = project / "scripts" / "nested"
    working_directory.mkdir(parents=True)
    monkeypatch.chdir(working_directory)
    monkeypatch.delenv("CUSTOM_API_KEY", raising=False)

    load_dotenv()
    config = load_config()

    assert config.path == (project / "hos.toml").resolve()
    assert config.resolve_provider(require_secret=True).api_key == "ancestor-key"


def test_config_resolves_anthropic_messages_defaults(tmp_path: Path) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(ANTHROPIC_CONFIG, encoding="utf-8")

    provider = load_config(path, environment={"ANTHROPIC_API_KEY": "anthropic-secret"}).resolve_provider(
        require_secret=True
    )

    assert provider.provider_type == "anthropic_messages"
    assert provider.url == "https://api.anthropic.com/v1/messages"
    assert provider.auth_header == "x-api-key"
    assert provider.auth_prefix == ""
    assert provider.anthropic_version == "2023-06-01"
    assert isinstance(create_provider_client(provider), AnthropicMessagesClient)


class ChatHandler(BaseHTTPRequestHandler):
    request_record: dict = {}

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        type(self).request_record = {
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "tenant": self.headers.get("X-Tenant"),
            "body": body,
        }
        response = {
            "id": "chatcmpl-local",
            "choices": [{"message": {"role": "assistant", "content": "OK"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
        }
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args) -> None:
        return


class AnthropicHandler(BaseHTTPRequestHandler):
    request_records: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        type(self).request_records.append(
            {
                "path": self.path,
                "api_key": self.headers.get("x-api-key"),
                "anthropic_version": self.headers.get("anthropic-version"),
                "body": body,
            }
        )
        if len(type(self).request_records) == 1:
            content = [
                {"type": "text", "text": "I will observe."},
                {"type": "tool_use", "id": "toolu-1", "name": "observe", "input": {"episode": "ep-1"}},
            ]
            stop_reason = "tool_use"
        else:
            content = [{"type": "text", "text": "OK"}]
            stop_reason = "end_turn"
        response = {
            "id": f"msg-{len(type(self).request_records)}",
            "type": "message",
            "role": "assistant",
            "model": "claude-local",
            "content": content,
            "stop_reason": stop_reason,
            "usage": {"input_tokens": 11, "output_tokens": 4},
        }
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args) -> None:
        return


def test_openai_compatible_client_uses_configured_base_url_headers_model_and_tools() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), ChatHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        from hos.config import ProviderConfig

        provider = ProviderConfig(
            name="local",
            provider_type="openai_compatible",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            endpoint="/chat/completions",
            model="local-model",
            api_key="local-secret",
            headers={"X-Tenant": "tenant-a"},
            secret_headers={"X-Tenant"},
            timeout_seconds=2,
            reasoning={"enabled": True, "effort": "high"},
        )

        response = OpenAICompatibleClient(provider).chat(
            [{"role": "user", "content": "hello"}],
            tools=[{"type": "function", "function": {"name": "observe", "parameters": {"type": "object"}}}],
            max_tokens=17,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert response["choices"][0]["message"]["content"] == "OK"
    assert ChatHandler.request_record["path"] == "/v1/chat/completions"
    assert ChatHandler.request_record["authorization"] == "Bearer local-secret"
    assert ChatHandler.request_record["tenant"] == "tenant-a"
    assert ChatHandler.request_record["body"]["model"] == "local-model"
    assert ChatHandler.request_record["body"]["max_tokens"] == 17
    assert ChatHandler.request_record["body"]["reasoning"] == {"enabled": True, "effort": "high"}
    assert "temperature" not in ChatHandler.request_record["body"]
    assert ChatHandler.request_record["body"]["tools"][0]["function"]["name"] == "observe"


def test_anthropic_messages_client_adapts_tools_messages_and_usage() -> None:
    AnthropicHandler.request_records = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), AnthropicHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        from hos.config import ProviderConfig

        provider = ProviderConfig(
            name="anthropic-local",
            provider_type="anthropic_messages",
            base_url=f"http://127.0.0.1:{server.server_port}",
            endpoint="/v1/messages",
            model="claude-local",
            api_key="anthropic-secret",
            timeout_seconds=2,
            auth_header="x-api-key",
            auth_prefix="",
            anthropic_version="2023-06-01",
        )
        client = AnthropicMessagesClient(provider)
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "observe",
                    "description": "Observe one episode.",
                    "parameters": {
                        "type": "object",
                        "properties": {"episode": {"type": "string"}},
                        "required": ["episode"],
                    },
                },
            }
        ]
        first = client.chat([{"role": "system", "content": "Use tools."}], tools=tools, max_tokens=17)
        tool_call = first["choices"][0]["message"]["tool_calls"][0]
        second = client.chat(
            [
                {"role": "system", "content": "Use tools."},
                {
                    "role": "assistant",
                    "content": "I will observe.",
                    "tool_calls": [tool_call],
                },
                {"role": "tool", "tool_call_id": "toolu-1", "content": '{"ok":true}'},
            ],
            tools=tools,
            max_tokens=17,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)

    first_request, second_request = AnthropicHandler.request_records
    assert first_request["path"] == "/v1/messages"
    assert first_request["api_key"] == "anthropic-secret"
    assert first_request["anthropic_version"] == "2023-06-01"
    assert first_request["body"]["system"] == "Use tools."
    assert first_request["body"]["messages"][0]["role"] == "user"
    assert first_request["body"]["tools"][0]["name"] == "observe"
    assert first_request["body"]["tools"][0]["input_schema"]["required"] == ["episode"]
    assert tool_call["function"] == {
        "name": "observe",
        "arguments": '{"episode":"ep-1"}',
    }
    assert first["usage"] == {"prompt_tokens": 11, "completion_tokens": 4, "total_tokens": 15}
    assert second_request["body"]["messages"][0]["role"] == "user"
    assert second_request["body"]["messages"][1]["content"][1] == {
        "type": "tool_use",
        "id": "toolu-1",
        "name": "observe",
        "input": {"episode": "ep-1"},
    }
    assert second_request["body"]["messages"][2]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "toolu-1",
        "content": '{"ok":true}',
    }
    assert second["choices"][0]["message"]["content"] == "OK"


def test_anthropic_messages_client_retries_remote_disconnect(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0
    response_body = json.dumps(
        {
            "id": "msg-retried",
            "type": "message",
            "role": "assistant",
            "model": "deepseek-v4-flash",
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 3, "output_tokens": 1},
        }
    ).encode("utf-8")

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self) -> bytes:
            return response_body

    def flaky_urlopen(request, *, timeout):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RemoteDisconnected("remote end closed connection")
        return Response()

    monkeypatch.setattr(provider_module, "urlopen", flaky_urlopen)
    monkeypatch.setattr(provider_module.time, "sleep", lambda seconds: None)
    provider = provider_module.ProviderConfig(
        name="anthropic-retry",
        provider_type="anthropic_messages",
        base_url="https://gateway.example",
        endpoint="/v1/messages",
        model="deepseek-v4-flash",
        api_key="secret",
        timeout_seconds=2,
    )

    response = AnthropicMessagesClient(provider).chat(
        [{"role": "user", "content": "hello"}],
        max_tokens=8,
    )

    assert attempts == 2
    assert response["choices"][0]["message"]["content"] == "OK"


def test_repository_example_config_exposes_supported_provider_profiles() -> None:
    path = Path(__file__).resolve().parents[1] / "hos.example.toml"

    config = load_config(path, environment={})

    assert config.default_provider == "custom"
    assert set(config.providers) == {"custom", "openai", "anthropic", "openrouter", "local"}
    assert config.resolve_provider("local").url == "http://127.0.0.1:8000/v1/chat/completions"
    assert config.resolve_provider("anthropic").url == "https://api.anthropic.com/v1/messages"


def test_provider_supports_reasoning_effort_alias() -> None:
    provider = ProviderConfig(
        name="local",
        provider_type="openai_compatible",
        base_url="http://127.0.0.1:8000/v1",
        endpoint="/chat/completions",
        model="local-model",
        reasoning_effort="high",
    )
    assert provider.redacted()["reasoning_effort"] == "high"


def test_conversation_message_preserves_provider_reasoning() -> None:
    response = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "reasoning_content": "private chain",
                "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "x", "arguments": "{}"}}],
            }
        }]
    }

    message = conversation_assistant_message(response)

    assert message["reasoning_content"] == "private chain"
    assert message["tool_calls"][0]["id"] == "call-1"
