"""Full session remains append-only while the next task turn reads compact history."""
import json
import base64
import time
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel

PROJECT = Path(__file__).resolve().parents[1]


def test_task_context_archives_closed_turn_and_hydrates_through_read(tmp_path):
    root = tmp_path / "run"
    workspace = root / "workspace"
    workspace.mkdir(parents=True)
    (workspace / "data").mkdir()
    (workspace / "data/pixel.png").write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
    deadline = time.time() + 60
    env = {"PPT_DEMO_ROOT": str(root), "PPT_DEMO_DEADLINE": str(int(deadline*1000)),
           "PPT_DEMO_BUDGET_USD": "100", "PPT_DEMO_REQUEST_RESERVE_USD": "0",
           "PI_CODING_AGENT_DIR": str(root / ".pi-agent")}
    command = ["node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
               "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-builtin-tools",
               "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
               "--extension", str(PROJECT / "tests/ppt_task_context_provider.ts"),
               "--provider", "ppt-context-diagnostic", "--model", "scripted", "--thinking", "off", "--session", str(root / "session.jsonl")]
    with PiKernel(command, cwd=str(workspace), env=env, timeout=20, deadline=deadline) as pi:
        assert pi.prompt("FIRST_TASK_TURN")["success"]
        pi.wait_for_agent_events(timeout=25)
        assert (workspace / "artifacts/source.txt").read_text() == "EXACT_SOURCE_"+"x"*9000
        before = (root / "session.jsonl").read_bytes()
        assert pi.prompt("SECOND_TASK_TURN")["success"]
        pi.wait_for_agent_events(timeout=25)
        assert (root / "session.jsonl").read_bytes().startswith(before)
    rows = lambda path: [json.loads(line) for line in (root / path).read_text(encoding="utf-8").splitlines()]
    assert [row["turn"] for row in rows("context-provider.jsonl")] == [0, 1, 2, 3]
    assert "EXACT_SOURCE_"+"x"*9000 in (root / "session.jsonl").read_text(encoding="utf-8")
    projections = rows("harness/context-projection.jsonl")
    assert projections[2]["after_chars"] < projections[2]["before_chars"] - 7000
    assert projections[0]["before_chars"] == projections[0]["after_chars"]
    assert projections[1]["after_chars"] < projections[1]["before_chars"] - 7000

