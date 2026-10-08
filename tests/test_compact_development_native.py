"""ARC development reads stay complete without replaying both long manuals."""
import json
from pathlib import Path

from test_arc_capability_surface_native import _run_arc_parent
from test_harness_sequential_batch_native import _create, _assemble


def test_actual_arc_development_read_keeps_creator_and_can_publish(tmp_path):
    project = Path(__file__).resolve().parents[1]
    candidate = _create("brief-trial")
    candidate["arguments"]["assembly"] = False  # Exercise the explicit staged path.
    events = _run_arc_parent(tmp_path, [
        [{"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
         {"name": "task_harness", "arguments": {"action": "contract", "topic": "development"}}],
        [candidate, _assemble("brief-trial")],
        {"name": "read", "arguments": {"path": str(tmp_path / "task-harness/skills/brief-trial/SKILL.md")}},
    ])
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(calls) == 5 and all(not e.get("isError") for e in calls)
    brief = (project / "demo/prompts/harness_development_brief.md").read_text(encoding="utf-8")
    assert json.loads(calls[1]["result"]["content"][0]["text"])["instructions"] == brief
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    retained = json.dumps(contexts[1], ensure_ascii=False)
    payloads = [json.loads(part["text"]) for message in contexts[1]["messages"]
                if message.get("role") == "toolResult" for part in message.get("content", [])
                if part.get("type") == "text"]
    assert [p["instructions"] for p in payloads if p.get("topic") == "development"] == [brief]
    assert "Fill the returned candidate" in retained  # Prepared creator is still actionable.
    old = (project / "demo/prompts/capability_extraction_process.md").read_text(encoding="utf-8")
    assert old not in [p.get("instructions") for p in payloads]
    assert "State a prediction" in calls[-1]["result"]["content"][0]["text"]


def test_actual_arc_can_recover_exact_full_development_reference(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "development", "section": "all"}},
    ])
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    expected = "\n\n".join((project / "demo/prompts" / name).read_bytes().decode("utf-8")
                            for name in ("harness_development_operations.md", "capability_extraction_process.md"))
    assert len(calls) == 1 and not calls[0].get("isError")
    assert json.loads(calls[0]["result"]["content"][0]["text"])["instructions"] == expected
    assert not (tmp_path / "task-skills.jsonl").exists()
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()
