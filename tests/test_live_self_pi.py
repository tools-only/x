"""Actual Pi 0.87.0 RPC + scripted provider diagnostic for the live-self extension."""
import json
import os
import shutil
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


def _rows(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_pi_scripted_provider_executes_revisioned_live_self_task_chain(tmp_path: Path):
    node = shutil.which("node")
    assert node, "Node runtime is required"
    project = Path(__file__).resolve().parents[1]
    cli = project / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
    assert cli.is_file(), "Pinned local Pi CLI is required"
    trace = tmp_path / "live-self-trace.jsonl"
    contexts = tmp_path / "provider-contexts.jsonl"
    command = [node, str(cli), "--mode", "rpc", "--provider", "offline-live-self", "--model", "scripted", "--offline",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo/live_self_extension.ts"),
        "--extension", str(project / "tests/live_self_scripted_provider.ts")]
    env = {**os.environ,
        "PI_CODING_AGENT_DIR": str(tmp_path / ".pi-agent"), "LIVE_SELF_TRACE": str(trace),
        "LIVE_SELF_PROVIDER_CONTEXTS": str(contexts), "LIVE_SELF_GRANTS": json.dumps([
            {"target": "task_harness", "operation": "replace"}, {"target": "evolution_loop", "operation": "replace"}]),
        "PYTHONPATH": str(project / "src")}
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=90) as kernel:
        kernel.prompt_and_wait("Draft a short slide outline from the supplied notes, review the evidence, revise the live method if useful, then finish a short code note. Submit the final item with your disposition.", timeout=90)

    requests = _rows(contexts)
    trace_rows = _rows(trace)
    assert len(requests) == 8, f"expected the scripted full chain, got {len(requests)} provider requests"
    mirrors = []
    for row in requests:
        system = next(m for m in row["context"]["messages"] if m["role"] == "system")
        prompt = str(system["content"])
        assert "[LIVE_SELF_MIRROR]" in prompt, "actual provider request did not receive the automatic Mirror"
        encoded = prompt.rsplit("[LIVE_SELF_MIRROR]\n", 1)[1].splitlines()[0]
        mirrors.append(json.loads(encoded))
    assert [m["version"] for m in mirrors] == [1, 1, 1, 2, 3, 3, 3, 3]
    session_ids = {m["pi_session_id"] for m in mirrors}
    assert len(session_ids) == 1 and None not in session_ids and "unbound-pi-session" not in session_ids
    # The operation ref changes with the revision and is attached inline to the editable Mirror parts.
    assert mirrors[0]["parts"]["task_harness"]["operations"][0]["version"] == 1
    assert mirrors[3]["parts"]["evolution_loop"]["operations"][0]["version"] == 2
    assert mirrors[4]["parts"]["task_harness"]["operations"][0]["version"] == 3
    event_names = [r["event"] for r in trace_rows]
    assert event_names.index("draft") < event_names.index("review_decision") < event_names.index("reflect_committed") < event_names.index("submit")
    drafts = [r["value"] for r in trace_rows if r["event"] == "draft"]
    assert [d["revision"] for d in drafts] == [1, 3, 3]
    assert drafts[0]["output"] == "Brief: Revenue rose"
    assert drafts[1]["output"] == "REVENUE ROSE. COSTS WERE FLAT."
    assert drafts[1]["self_review_signal"]["method"] == "shared-token-count"
    assert drafts[0]["self_review_signal"] != drafts[1]["self_review_signal"]
    assert drafts[2]["task"] == "code-note"
    submitted = next(r["value"] for r in trace_rows if r["event"] == "submit")
    assert submitted["content"] == drafts[2]["output"]
    assert submitted["revision"] == 3
    final = next(r["value"] for r in trace_rows if r["event"] == "session_trace")
    assert [x["disposition"] for x in final["review_status"]] == ["change", "unreviewed", "keep"]
