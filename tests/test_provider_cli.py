import json
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from hos.cli import main

from test_provider_config import CONFIG, ChatHandler


def test_config_check_prints_redacted_selected_profile(tmp_path: Path, monkeypatch, capsys) -> None:
    path = tmp_path / "hos.toml"
    path.write_text(CONFIG, encoding="utf-8")
    monkeypatch.setenv("CUSTOM_API_KEY", "must-not-print")
    monkeypatch.setenv("CUSTOM_TENANT", "also-secret")

    exit_code = main(["config", "check", "--config", str(path)])

    output = capsys.readouterr().out
    assert exit_code == 0
    assert json.loads(output)["provider"]["name"] == "custom"
    assert "must-not-print" not in output
    assert "also-secret" not in output


def test_provider_probe_uses_selected_custom_provider(tmp_path: Path, monkeypatch, capsys) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), ChatHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    path = tmp_path / "hos.toml"
    path.write_text(
        CONFIG.replace("https://gateway.example/v1/", f"http://127.0.0.1:{server.server_port}/v1"),
        encoding="utf-8",
    )
    monkeypatch.setenv("CUSTOM_API_KEY", "probe-key")
    monkeypatch.setenv("CUSTOM_TENANT", "probe-tenant")
    try:
        exit_code = main(["provider", "probe", "--config", str(path)])
    finally:
        server.shutdown()
        thread.join(timeout=2)

    output = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert output == {
        "content": "OK",
        "model": "example-model",
        "provider": "custom",
        "response_id": "chatcmpl-local",
        "usage": {"completion_tokens": 1, "prompt_tokens": 3, "total_tokens": 4},
    }
