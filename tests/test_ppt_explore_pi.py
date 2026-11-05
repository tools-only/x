"""Bounded actual Pi wiring check for the PPT read-only exploration service."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


PROJECT = Path(__file__).resolve().parents[1]


def test_explore_returns_independent_answers_and_preserves_candidate_failure(tmp_path: Path) -> None:
    run = tmp_path / "ppt-explore"
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
        "--extension", str(PROJECT / "tests/ppt_explore_provider.ts"),
        "--provider", "ppt-explore-diagnostic", "--model", "scripted", "--thinking", "low",
        "--session", str(run / "session.jsonl"),
    ]
    with PiKernel(command, cwd=str(workspace), env=env, timeout=25, deadline=deadline) as pi:
        pi.prompt_and_wait("PPT_EXPLORE_WIRING_DIAGNOSTIC", timeout=170)

    checks = [json.loads(line) for line in (run / "provider-checks.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["request"] for row in checks] == list(range(7))
    explorations = [json.loads(line) for line in (run / "harness/explore_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["status"] for row in explorations] == ["ok", "error", "ok", "ok", "ok"]
    assert [row["request"] for row in explorations] == [2, 3, 4, 5, 6]
    assert explorations[0]["answer_ref"].startswith("results/")
    assert explorations[1]["usage_status"] == "see_model-usage.jsonl"

    usage = [json.loads(line) for line in (run / "harness/model-usage.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["request"] for row in usage] == list(range(1, 8))
    assert [row["kind"] for row in usage[1:6]] == ["explore"] * 5
    tool_rows = [json.loads(line) for line in (run / "harness/tools.jsonl").read_text(encoding="utf-8").splitlines()]
    explore_result = next(row for row in tool_rows if row["name"] == "explore")
    result_text = "\n".join(part["text"] for part in explore_result["result"] if part["type"] == "text")
    assert "CANDIDATE_ONE_RAW" in result_text
    assert "scripted candidate failure" in result_text
    assert '"selection":"agent_decides"' in result_text
    assert not any((workspace / "tools").iterdir())
    assert not any((workspace / "agents").iterdir())
