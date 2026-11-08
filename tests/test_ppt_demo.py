import json
from pathlib import Path

from autoresearch_pi import ppt_demo


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
