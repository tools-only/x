"""Real Pi + PPT extension lifecycle smoke with a local scripted provider."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


PROJECT = Path(__file__).resolve().parents[1]


def test_agent_authored_method_runs_returns_feedback_revises_and_retires(tmp_path: Path) -> None:
    run = tmp_path / "ppt-live-method"
    workspace = run / "workspace"
    (workspace / "data").mkdir(parents=True)
    (workspace / "data/instructions.md").write_text(
        "Diagnostic deck task: supplied facts are the source of truth.", encoding="utf-8"
    )
    (workspace / "data/material.txt").write_text(
        "Revenue was $30B. Net income was $12B.\n", encoding="utf-8"
    )
    deadline = time.time() + 180
    env = {
        "PPT_DEMO_ROOT": str(run),
        "PPT_DEMO_PYTHON": sys.executable,
        "PPT_DEMO_DEADLINE": str(int(deadline * 1000)),
        "PPT_DEMO_UNBOUNDED": "1",
        "PPT_DEMO_BUDGET_USD": "100",
        "PPT_DEMO_REQUEST_RESERVE_USD": "0",
        "PI_CODING_AGENT_DIR": str(run / ".pi-agent"),
    }
    command = [
        "node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-builtin-tools",
        "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
        "--extension", str(PROJECT / "tests/ppt_live_method_provider.ts"),
        "--provider", "ppt-live-method-diagnostic", "--model", "scripted", "--thinking", "low",
        "--session", str(run / "session.jsonl"),
    ]
    with PiKernel(command, cwd=str(workspace), env=env, timeout=25, deadline=deadline) as pi:
        pi.prompt_and_wait("PPT_METHOD_LOOP_DIAGNOSTIC", timeout=170)

    checks = [json.loads(line) for line in (run / "provider-checks.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["turn"] for row in checks] == list(range(11))
    assert all(row["passed"] for row in checks)

    runs_path = run / "harness/component_runs.jsonl"
    runs = [json.loads(line) for line in runs_path.read_text(encoding="utf-8").splitlines()]
    calls = [row for row in runs if row.get("kind") == "program_call"]
    assert [(row["executed_version"], row.get("requested_version"), row["readonly"]) for row in calls] == [
        (1, None, False), (2, None, False), (1, 1, True),
        (1, 1, True), (1, 1, True), (1, 1, True),
    ]
    results = [row for row in runs if row.get("kind") == "program_result"]
    assert [row["ok"] for row in results] == [True, True, True, False, False, False]
    assert all(row["run_id"] == call["run_id"] for row, call in zip(results, calls))
    assert [row["executed_version"] for row in results] == [1, 2, 1, 1, 1, 1]
    assert all(row["output_excerpt"].count("METHOD RUN ") == 1 for row in results)

    assert not (workspace / "artifacts/readonly-write.txt").exists()
    assert not (workspace / "tools/live_check.py").exists()
    retired_source = workspace / "tools_off/live_check.py"
    assert retired_source.exists()
    assert "Net income" in retired_source.read_text(encoding="utf-8")
    component_rows = [
        json.loads(line) for line in (run / ".harness/components.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(row["path"] == "tools/live_check.py" and row["version"] == 1 for row in component_rows)
    assert any(row["path"] == "tools/live_check.py" and row["version"] == 2 for row in component_rows)
    assert any(row["path"] == "tools/live_check.py" and row.get("retired") for row in component_rows)
    assert (workspace / "prompts/live_method.md").read_text(encoding="utf-8").startswith(
        "---\nactive: false\n---"
    )
