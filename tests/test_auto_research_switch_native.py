"""Installed Pi + broker diagnostics with deterministic provider, no ARC closure claim."""
import json
import os
import subprocess
from pathlib import Path

import pytest

from test_task_research_context import _pi_cli, _run_fixture, records, results


def environment(cli):
    project = Path(__file__).resolve().parents[1]
    return {"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
            "PI_SUBAGENT_STEPS": "[]", "PI_SUBAGENT_REPORT": "SWITCH_DELEGATE_RESULT",
            "PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE": "all"}


def seed_saved_research(root, node):
    project = Path(__file__).resolve().parents[1]
    script = (
        f'import {{ assignResearchWorker }} from {json.dumps((project / "demo/pi_auto_research_workers.ts").as_uri())};'
        f'import {{ ensureTaskScope, stampTaskRecord }} from {json.dumps((project / "demo/pi_task_scope.ts").as_uri())};'
        'import { appendFileSync } from "node:fs"; import { join } from "node:path";'
        'const root = process.env.SWITCH_TEST_ROOT;'
        'assignResearchWorker(root, {worker_id:"saved", responsibility:"Track rules", question:"Which rule fits?",'
        'research_line_ref:"research_line:saved@v1", stop_when:"Budget", max_runs:2, max_output_tokens:1000});'
        'appendFileSync(join(root,"auto-research-sessions.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(root), {'
        'session_id:"research-session-1", version:1, run_id:"auto-research-1", status:"pending",'
        'checkpoint:{wait_for:"next_parent_evidence",after_evidence_sequence:0}, evidence_refs:[] }))+String.fromCharCode(10));'
    )
    completed = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                               env={**os.environ, "SWITCH_TEST_ROOT": str(root)}, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr


@pytest.mark.parametrize("enabled", [False, True])
def test_switch_preserves_ordinary_delegate_semantics(tmp_path, enabled):
    _, cli = _pi_cli()
    root = tmp_path / "run"
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={**environment(cli), "PI_AUTORESEARCH_ENABLED": "enabled" if enabled else "disabled"},
        steps=[{"name": "delegate_task", "arguments": {"task": "Return the bounded diagnostic result."}}])
    returned = results(events, "delegate_task")
    assert len(returned) == 1 and not returned[0].get("isError")
    assert "SWITCH_DELEGATE_RESULT" in json.dumps(returned[0])
    assert len(records(root, "subagent-invocations.jsonl")) == 1
    assert not records(root, "auto-research-runs.jsonl")
    for context in records(root, "provider-contexts.jsonl"):
        value = context["context"]
        assert ("auto_research" in {tool["name"] for tool in value["tools"]}) is enabled
        assert ("AUTO-RESEARCH:" in value["systemPrompt"]) is enabled


def test_disabled_does_not_resume_saved_sessions_or_schedule_workers(tmp_path):
    node, cli = _pi_cli()
    root = tmp_path / "saved"
    root.mkdir()
    seed_saved_research(root, node)
    files = [root / "auto-research-workers.jsonl", root / "auto-research-sessions.jsonl"]
    before = [path.read_bytes() for path in files]
    project = Path(__file__).resolve().parents[1]
    _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={**environment(cli), "PI_AUTORESEARCH_ENABLED": "disabled"},
        steps=[{"name": "benchmark_probe", "arguments": {"label": "new_evidence"}}],
        followup_prompt="Continue with the new evidence.")
    assert [path.read_bytes() for path in files] == before
    assert not records(root, "auto-research-runs.jsonl")
    assert not records(root, "subagent-invocations.jsonl")
    assert not records(root, "subagent-provider-contexts.jsonl")
    assert not records(root, "auto-research-evidence-batches.jsonl")
    assert records(root, "execution-observations.jsonl"), "new evidence must actually reach the parent"


def test_enabled_research_returns_structured_conclusion(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "enabled"
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": "SWITCH_RESEARCH_RESULT", "findings": [], "evidence_refs": [],
              "alternatives": [], "limitations": ["Scripted diagnostic"],
              "validation_plan": "No live action", "method_candidates": []}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={**environment(cli), "PI_AUTORESEARCH_ENABLED": "enabled", "PI_SUBAGENT_REPORT": json.dumps(report)},
        steps=[{"name": "auto_research", "arguments": {"question": "Return the diagnostic conclusion.", "scope": "hypothesis"}}])
    returned = results(events, "auto_research")
    assert len(returned) == 1 and not returned[0].get("isError")
    assert "SWITCH_RESEARCH_RESULT" in json.dumps(returned[0])
    assert records(root, "auto-research-reports.jsonl")[-1]["report"]["conclusion"] == "SWITCH_RESEARCH_RESULT"
    assert records(root, "subagent-provider-contexts.jsonl")


@pytest.mark.parametrize("settings,expected", [
    ({}, False),
    ({"PI_ARC_AUTO_RESEARCH": "enabled"}, True),
    ({"PI_ARC_AUTO_RESEARCH": "enabled", "PI_AUTORESEARCH_ENABLED": "disabled"}, False),
    ({"PI_ARC_AUTO_RESEARCH": "disabled", "PI_AUTORESEARCH_ENABLED": "enabled"}, True),
])
def test_actual_arc_adapter_registration_respects_configuration(tmp_path, monkeypatch, settings, expected):
    _pi_cli()
    for key in ["PI_ARC_AUTO_RESEARCH", "PI_AUTORESEARCH_ENABLED"]:
        monkeypatch.delenv(key, raising=False)
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-registration"
    _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_arc_auto_research_switch_fixture.ts"],
                 extra_env=settings, steps=[])
    tools = {tool["name"] for tool in records(root, "provider-contexts.jsonl")[0]["context"]["tools"]}
    assert ("auto_research" in tools) is expected
    assert "delegate_task" in tools
    assert not records(root, "auto-research-runs.jsonl")
