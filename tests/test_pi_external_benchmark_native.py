import json
import shutil
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel


def _pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node unavailable")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        pytest.skip("installed Pi CLI unavailable")
    return node, str(cli)


def _run_fixture(root: Path, variant: str) -> list[dict]:
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    command = (
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo" / "pi_external_benchmark_research.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    )
    root.mkdir()
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": variant,
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled",
    }, timeout=60) as kernel:
        kernel.prompt("Run the deterministic external benchmark fixture.")
        return kernel.wait_for_agent_events(timeout=60)


def test_shared_external_extension_closes_finding_compaction_effect_loop(tmp_path):
    root = tmp_path / "treatment"
    events = _run_fixture(root, "treatment")

    assert any(event.get("type") == "agent_end" for event in events)
    observations = [json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
    findings = [json.loads(line) for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()]
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    exposure = json.loads((root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])

    assert observations[0]["observation_id"] == "execution-observation-1"
    assert "x" * 100 in observations[0]["result_text"]
    assert findings[0]["evidence_refs"] == ["execution-observation-1"]
    assert findings[-1]["version"] == 2
    assert findings[-1]["status"] == "resolved"
    assert findings[-1]["assessment_refs"] == ["effect-assessment-1"]
    assert decision["basis_snapshots"][0]["version"] == 1
    assert decision["operation"]["capability"] == "pi.context"
    assert exposure["effect_observed"] is True
    assert assessment["verdict"] == "supported"
    assert assessment["window"]["removed_chars"] > 0

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert "more informative way to explore a local uncertainty" in contexts[0]["systemPrompt"]

    active_resources = [
        part["text"]
        for context in contexts[2:]
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert active_resources
    active = json.loads(active_resources[0].split(": ", 1)[1])
    assert active == [{
        "goal_id": "research-goal-1",
        "finding_id": "finding-1",
        "version": 1,
        "question": "What task-local observation should change a later execution decision?",
        "scope": "current benchmark task",
        "uncertainty": "bounded task-local uncertainty",
        "evidence": "The probe is large and its relevant conclusion is retained.",
        "decision": "Compact the cited observation for later requests.",
        "evidence_refs": ["execution-observation-1"],
        "assessment_refs": [],
        "expected_recurrence": "high",
        "remaining_uses": 2,
    }]

    resolved_resources = [
        part["text"]
        for context in contexts[4:]
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert resolved_resources == []


def test_shared_external_extension_control_hides_research_and_mutation_tools(tmp_path):
    root = tmp_path / "control"
    _run_fixture(root, "control")

    context = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert names == {"benchmark_probe"}
    assert not (root / "research-resources.jsonl").exists()
    assert not (root / "harness-decisions.jsonl").exists()
