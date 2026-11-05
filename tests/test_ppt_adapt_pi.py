"""Bounded actual Pi wiring check for the PPT read-only exploration service."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


PROJECT = Path(__file__).resolve().parents[1]


def test_adapt_selects_context_changes_method_and_returns_to_task(tmp_path: Path) -> None:
    run = tmp_path / "ppt-adapt"
    workspace = run / "workspace"
    (workspace / "data").mkdir(parents=True)
    (workspace / "data/instructions.md").write_text("Diagnostic task.", encoding="utf-8")
    (workspace / "data/material.txt").write_text("Revenue was $30B. Net income was $12B.\n", encoding="utf-8")
    for i in range(8):
        (workspace / f"data/extra-{i}.txt").write_text(f"EXTRA_MATERIAL_{i}", encoding="utf-8")
    deadline = time.time() + 180
    env = {
        "PPT_DEMO_ROOT": str(run), "PPT_DEMO_PYTHON": sys.executable,
        "PPT_DEMO_DEADLINE": str(int(deadline * 1000)), "PPT_DEMO_UNBOUNDED": "1",
        "PPT_DEMO_BUDGET_USD": "100", "PPT_DEMO_REQUEST_RESERVE_USD": "0",
        "PPT_DEMO_THINKING": "high", "PI_CODING_AGENT_DIR": str(run / ".pi-agent"),
    }
    command = [
        "node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-builtin-tools", "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
        "--extension", str(PROJECT / "tests/ppt_adapt_provider.ts"),
        "--provider", "ppt-adapt-diagnostic", "--model", "scripted", "--thinking", "low",
        "--session", str(run / "session.jsonl"),
    ]
    with PiKernel(command, cwd=str(workspace), env=env, timeout=25, deadline=deadline) as pi:
        pi.prompt_and_wait("TASK_HISTORY_ONLY", timeout=170)

    checks = [json.loads(line) for line in (run / "provider-checks.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["turn"] for row in checks] == list(range(6))
    assert "METHOD_FROM_ADAPT" in (workspace / "prompts/working_method.md").read_text(encoding="utf-8")
    assert "Keep developing your capability and working system" in (workspace / "skills/self_evolution/SKILL.md").read_text(encoding="utf-8")
    lifecycle = [json.loads(line) for line in (run / "harness/lifecycle.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["event"] for row in lifecycle if row["event"].startswith("adapt_")] == ["adapt_enter", "adapt_exit"] * 2
    usage = [json.loads(line) for line in (run / "harness/model-usage.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row.get("kind") for row in usage] == [None, "adapt", "adapt", None, "adapt", None]
