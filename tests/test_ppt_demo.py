import json
from pathlib import Path

from autoresearch_pi import ppt_demo
from autoresearch_pi.ppt_demo_continuation import initial_intent, legacy_core_next_intent, pi_prompt


def test_legacy_continuation_policy_keeps_existing_defaults_and_transport_mapping():
    assert pi_prompt(initial_intent(False, None, None)) == "Complete the requested deliverable using the supplied brief and source material."
    assert pi_prompt(initial_intent(True, None, None)) == "PPT_RESUME"
    assert pi_prompt(initial_intent(True, "continue with a new brief", None)) == "continue with a new brief"
    assert pi_prompt(initial_intent(False, None, "kickoff")) == "kickoff"
    assert pi_prompt(legacy_core_next_intent({"batchRequests": 2}, {"stopReason": "length"}, False, 10)) == "PPT_RESUME"
    assert pi_prompt(legacy_core_next_intent({"batchRequests": 2}, {"stopReason": "length"}, True, 10)) == "PPT_RESUME"
    assert pi_prompt(legacy_core_next_intent({"batchRequests": 10}, {"stopReason": "length"}, True, 10)) == "PPT_NEXT"
    assert pi_prompt(legacy_core_next_intent({"batchRequests": 10}, {"stopReason": "stop"}, True, 10)) == "PPT_NEXT"


def test_fresh_run_sends_kickoff_prompt(tmp_path, monkeypatch):
    system_prompt = Path("demo/prompts/ppt_demo_system.md").read_text(encoding="utf-8")
    assert "reflect_component" in system_prompt
    assert "save_program" not in system_prompt
    assert "self_component" not in system_prompt
    root = tmp_path / "run"
    workspace_data = root / "workspace" / "data"
    workspace_data.mkdir(parents=True)
    for name in ("instructions.md", "material.txt", "environment.md"):
        (workspace_data / name).write_text("source", encoding="utf-8")
    (root / "workspace" / "AGENTS.md").write_text("guidance", encoding="utf-8")
    (root / "task-provenance.json").write_text(json.dumps({"case": "offline-case"}), encoding="utf-8")
    captured = []

    class Kernel:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def prompt(self, prompt):
            captured.append(prompt)
            loop = root / ".harness" / "ppt-loop.json"
            loop.parent.mkdir(parents=True)
            loop.write_text(json.dumps({"complete": True, "batch": 1, "deliveredRevision": 1}), encoding="utf-8")
            return {"success": True}

        def wait_for_agent_events(self, **kwargs):
            return []

    monkeypatch.setattr(ppt_demo, "PiKernel", Kernel)
    monkeypatch.setattr(ppt_demo, "load_project_dotenv", lambda _path: {
        "OPENAI_API_BASE": "https://az.gptplus5.com/v1", "OPENAI_API_KEY": "offline-test-key"
    })
    prompt = "Inspect and improve the presentation before delivery."

    result = ppt_demo.run(root, kickoff_prompt=prompt, model_override="az/deepseek-v4-flash")

    assert captured == [prompt]
    assert result["complete"] is True


def test_settled_process_choice_controls_only_next_transport(tmp_path, monkeypatch):
    root = tmp_path / "run"
    workspace_data = root / "workspace" / "data"
    workspace_data.mkdir(parents=True)
    for name in ("instructions.md", "material.txt", "environment.md"):
        (workspace_data / name).write_text("source", encoding="utf-8")
    (root / "workspace" / "AGENTS.md").write_text("guidance", encoding="utf-8")
    (root / "task-provenance.json").write_text(json.dumps({"case": "offline-process"}), encoding="utf-8")
    captured = []

    class Kernel:
        def __init__(self, *args, **kwargs):
            self.prompts = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def prompt(self, prompt):
            captured.append(prompt)
            self.prompts += 1
            loop = root / ".harness" / "ppt-loop.json"
            loop.parent.mkdir(parents=True, exist_ok=True)
            state = {"complete": self.prompts == 2, "batch": self.prompts, "process": {"next": {
                "decision": "adapt", "guidance": "inspect the new evidence", "version": 2}}}
            loop.write_text(json.dumps(state), encoding="utf-8")
            return {"success": True}

        def wait_for_agent_events(self, **kwargs):
            return []

    monkeypatch.setattr(ppt_demo, "PiKernel", Kernel)
    monkeypatch.setattr(ppt_demo, "load_project_dotenv", lambda _path: {
        "OPENAI_API_BASE": "https://az.gptplus5.com/v1", "OPENAI_API_KEY": "offline-test-key"
    })
    result = ppt_demo.run(root, kickoff_prompt="offline kickoff")
    assert result["complete"] is True
    assert captured == ["offline kickoff", "PPT_NEXT\ninspect the new evidence"]


def test_prepare_is_portable_without_windows_registry(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    for name, content in (("material.txt", "material"), ("production_brief.md", "brief"),
                          ("judge_prompt.json", "{}"), ("instructions.md", "instructions"),
                          ("statistics.yaml", "{}")):
        (source / name).write_text(content, encoding="utf-8")
    (tmp_path / "case.json").write_text(json.dumps({"case": "offline-case"}), encoding="utf-8")
    root = tmp_path / "run"
    monkeypatch.setattr(ppt_demo, "_available_fonts", lambda: {"Fixture Sans"})

    ppt_demo.prepare(root, source)

    assert json.loads((root / "workspace/data/available-fonts.json").read_text(encoding="utf-8")) == ["Fixture Sans"]
    assert (root / "workspace/data/instructions.md").read_text(encoding="utf-8") == "brief"
    assert json.loads((root / "task-provenance.json").read_text(encoding="utf-8")) == {"case": "offline-case"}


def test_run_loads_project_dotenv_and_defaults_to_authorized_az_qwen(tmp_path, monkeypatch):
    root = tmp_path / "run"
    workspace_data = root / "workspace/data"
    workspace_data.mkdir(parents=True)
    for name in ("instructions.md", "material.txt", "environment.md"):
        (workspace_data / name).write_text("source", encoding="utf-8")
    (root / "workspace/AGENTS.md").write_text("guidance", encoding="utf-8")
    (root / "task-provenance.json").write_text(json.dumps({"case": "offline-case"}), encoding="utf-8")
    seen = {}

    class Kernel:
        def __init__(self, command, **kwargs):
            seen["command"] = command
            seen["env"] = kwargs["env"]
            self.event_sink = kwargs["event_sink"]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def prompt(self, prompt):
            self.event_sink({"type": "message_end", "message": {"text": secret}})
            loop = root / ".harness/ppt-loop.json"
            loop.parent.mkdir(parents=True)
            loop.write_text(json.dumps({"complete": True, "batch": 1, "deliveredRevision": 1}), encoding="utf-8")
            return {"success": True}

        def wait_for_agent_events(self, **kwargs):
            return []

    secret = "offline-secret-value"
    def load_dotenv(path):
        seen["dotenv"] = path
        return {"OPENAI_API_BASE": "https://az.gptplus5.com/v1", "OPENAI_API_KEY": secret}

    monkeypatch.setattr(ppt_demo, "PiKernel", Kernel)
    monkeypatch.setattr(ppt_demo, "load_project_dotenv", load_dotenv)
    monkeypatch.setenv("PPT_LIVE_ORCHESTRATION", "1")
    result = ppt_demo.run(root, thinking="high")

    provider = json.loads((root / ".pi-agent/models.json").read_text(encoding="utf-8"))["providers"]["az-demo"]
    protocol = json.loads((root / "protocol.json").read_text(encoding="utf-8"))
    assert seen["dotenv"] == ppt_demo.PROJECT
    assert seen["command"][seen["command"].index("--provider") + 1] == "az-demo"
    assert seen["command"][seen["command"].index("--model") + 1] == "qwen3.8-27b"
    assert provider["baseUrl"] == "https://az.gptplus5.com/v1"
    assert provider["models"][0]["id"] == "qwen3.8-27b"
    assert seen["env"]["OPENAI_API_KEY"] == secret
    assert protocol["model"] == "qwen3.8-27b" and protocol["thinking"] == "high"
    assert protocol["ppt_live_orchestration"] is True
    assert secret not in json.dumps(protocol) and secret not in (root / "summary.json").read_text(encoding="utf-8")
    assert secret not in (root / "pi-events.jsonl").read_text(encoding="utf-8")
    assert result["complete"] is True


def test_html_browser_finds_linux_chromium_from_path(tmp_path, monkeypatch):
    from autoresearch_pi import ppt_demo_html

    executable = tmp_path / "chromium"
    executable.write_text("", encoding="utf-8")
    executable.chmod(0o755)
    monkeypatch.delenv("PPT_DEMO_BROWSER", raising=False)
    monkeypatch.setattr("autoresearch_pi.ppt_demo_html.shutil.which",
                        lambda name: str(executable) if name == "chromium" else None)

    assert ppt_demo_html._browser() == executable


def test_explicit_dotenv_file_is_supported_and_process_values_win(tmp_path, monkeypatch):
    dotenv = tmp_path / ".env"
    dotenv.write_text("OPENAI_API_BASE=https://az.gptplus5.com/v1\nOPENAI_API_KEY=file-secret\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "process-secret")

    values = ppt_demo._load_dotenv(dotenv)

    assert values["OPENAI_API_BASE"] == "https://az.gptplus5.com/v1"
    assert values["OPENAI_API_KEY"] == "process-secret"


def test_explicit_missing_dotenv_path_fails_clearly(tmp_path):
    import pytest

    with pytest.raises(ValueError, match="dotenv path does not exist"):
        ppt_demo._load_dotenv(tmp_path / ".env")
