"""Actually read contracts in Pi without rewriting or selecting components."""
import json
from pathlib import Path

from test_arc_capability_surface_native import _run_arc_parent


def test_actual_arc_contracts_are_complete_brief_and_lossless_on_demand(tmp_path):
    project = Path(__file__).resolve().parents[1]
    steps = [{"name": "task_harness", "arguments": {"action": "contract", "topic": topic, **extra}}
             for extra in ({}, {"section": "all"}) for topic in ("components", "assembly")]
    events = _run_arc_parent(tmp_path, steps)
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(calls) == 4 and all(not e.get("isError") for e in calls)
    bodies = [json.loads(c["result"]["content"][0]["text"]) for c in calls]
    for index, topic in enumerate(("components", "assembly")):
        short = (project / f"demo/prompts/harness_{topic}_brief.md").read_bytes().decode("utf-8")
        full = (project / f"demo/prompts/harness_{topic}_operations.md").read_bytes().decode("utf-8")
        assert bodies[index]["instructions"] == short
        assert bodies[index+2]["instructions"] == full
        assert len(short) < len(full)
        assert "without recreating" in short and "expected_assembly_revision" in short
    assert "atom:{subject:" in bodies[0]["instructions"]
    assert bodies[1]["current_assembly"] is None
    assert bodies[1]["assemble_template"]["expected_assembly_revision"] == 0
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    for index in (0, 1):
        results = [json.loads(p["text"]) for m in contexts[index+1]["messages"] if m.get("role") == "toolResult"
                   for p in m.get("content", []) if p.get("text", "").startswith('{"format":"task-harness-contract-v1"')]
        assert bodies[index]["instructions"] in [r.get("instructions") for r in results]
    for name in ("task-skills.jsonl", "task-memory.jsonl", "task-harness-assemblies.jsonl", "auto-research-runs.jsonl"):
        assert not (tmp_path / name).exists()
