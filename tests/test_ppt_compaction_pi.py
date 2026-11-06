"""Actual PPT runner and Pi; a scripted provider triggers automatic compaction."""
import json
import pytest
from pathlib import Path

from autoresearch_pi import ppt_demo
from autoresearch_pi.pi_kernel import PiKernel


@pytest.mark.parametrize("official,fail_summary", [(False, False), (True, False), (False, True)])
def test_ppt_runner_compacts_and_continues_with_budget_accounting(tmp_path, monkeypatch, official, fail_summary):
    root = tmp_path / "run"
    data = root / "workspace/data"
    data.mkdir(parents=True)
    for name in ["instructions.md", "material.txt", "environment.md"]:
        (data / name).write_text("KEEP_TASK_CONSTRAINT", encoding="utf-8")
    (root / "task-provenance.json").write_text('{"case":"compaction-wiring"}')
    monkeypatch.setattr(ppt_demo, "load_project_dotenv", lambda _: {
        "OPENAI_API_BASE": "https://az.gptplus5.com/v1", "OPENAI_API_KEY": "diagnostic"})

    original_settings = '{"compaction":{"enabled":false},"retry":{"enabled":true}}'
    if official:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        agent = tmp_path / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "settings.json").write_text(original_settings)

    def kernel(command, **kwargs):
        settings_path = (tmp_path / ".pi/agent/settings.json") if official else root / ".pi-agent/settings.json"
        settings = json.loads(settings_path.read_text())
        assert settings["compaction"]["enabled"] is True
        # Reduce only the kept suffix for this short deterministic threshold probe.
        settings["compaction"]["keepRecentTokens"] = 128
        settings_path.write_text(json.dumps(settings))
        command = [*command, "--extension", str(ppt_demo.PROJECT / "tests/ppt_compaction_provider.ts")]
        kwargs["env"]["PPT_COMPACTION_TEST_OFFICIAL"] = "1" if official else "0"
        kwargs["env"]["PPT_COMPACTION_TEST_FAIL"] = "1" if fail_summary else "0"
        return PiKernel(command, **kwargs)

    monkeypatch.setattr(ppt_demo, "PiKernel", kernel)
    result = ppt_demo.run(root, seconds=60, official_openai=official)
    if official:
        assert (tmp_path / ".pi/agent/settings.json").read_text() == original_settings
    assert result.get("error") is None, result
    rows = lambda name: [json.loads(line) for line in (root / name).read_text(encoding="utf-8").splitlines()]
    compactions = rows("harness/compaction.jsonl")
    assert compactions[0]["reason"] == "threshold"
    if fail_summary:
        assert all(row.get("cancelled") for row in compactions)
    else:
        assert compactions[0]["summary_chars"] > 0
    entries = rows("session.jsonl")
    assert any(row["type"] == "compaction" and "PPT_CHECKPOINT" in row["summary"] for row in entries) is (not fail_summary)
    calls = rows("compaction-provider.jsonl")
    assert any(row["summary"] for row in calls)
    assert calls[-1] == {"summary": False, "taskTurns": 2}
    usage = rows("harness/model-usage.jsonl")
    summary_usage = [row for row in usage if row.get("kind") == "compaction"]
    assert summary_usage and all(row["usage_status"] == "reported" for row in summary_usage)
    assert sum(row["summary"] for row in calls) == len(summary_usage), "No unaccounted fallback summary calls"
    requests = rows("harness/provider-requests.jsonl")
    assert any(row.get("kind") == "compaction" for row in requests)
    assert all(row["conservative_usd"] >= 0 for row in usage)
