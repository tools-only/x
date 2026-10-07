"""Evidence directories stay recoverable without generating parent chores."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture


def rows(root, name):
    path = root / name
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def texts(context):
    return [p["text"] for m in context["messages"] for p in m.get("content", []) if p.get("type") == "text"]


def test_automatic_probe_is_recoverable_and_selectable_without_default_component_advertising(tmp_path):
    project = Path(__file__).resolve().parents[1]
    ref = "memory:action-decision:execution-observation-1@v1"
    events = _run_fixture(tmp_path, "treatment", arc_compact=True,
        extra_extensions=[project / "tests/pi_arc_action_capture_fixture.ts"], steps=[
            {"name": "arc_action", "arguments": {"action": "noop", "decision": {
                "hypothesis": "An unresolved mechanism", "prediction": "A visible result", "falsifier": "No visible result"}}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": ref}},
            {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
                "selected_resource_refs": [ref], "prompt_contributions": [], "decision": {
                    "basis_refs": ["execution-observation-1"], "reason": "Keep the earlier falsifier visible.",
                    "expected": "This exact probe remains explicitly available."}}},
            {"name": "task_memory_pool", "arguments": {"action": "capture", "capture_id": "authored-rule",
                "items": [{"key": "uncertain-rule", "content": "A parent-authored unverified rule", "scope": "task", "claim_kind": "hypothesis"}]}},
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [r["context"] for r in rows(tmp_path, "provider-contexts.jsonl")]
    assert not any(t.startswith("MEMORY SELECTION CANDIDATES") for t in texts(contexts[1]))
    memories = rows(tmp_path, "task-memory.jsonl")
    probe = next(m for m in memories if m.get("probe_record"))
    assert probe["probe_record"]["decision_capsule"]["falsifier"] == "No visible result"
    read = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_resource")
    assert "No visible result" in json.dumps(read["result"])
    assert rows(tmp_path, "task-harness-assemblies.jsonl")[-1]["selected_resource_refs"] == [ref]
    assert "An unresolved mechanism" in json.dumps(contexts[3])
    candidates = next(t for t in texts(contexts[-1]) if t.startswith("MEMORY SELECTION CANDIDATES"))
    assert "uncertain-rule" in candidates and "action-decision:" not in candidates


def test_research_opportunity_is_short_optional_directory_with_complete_calls_on_demand(tmp_path):
    observations = [{"observation_id":f"o{i}", "tool_name":"arc_action", "input":{"action":"ACTION1"},
                     "arc_outcome":{"state":"NOT_FINISHED","levels_completed":0,
                                    "observation_delta":{"changed_cells":n}}} for i,n in [(1,2),(2,0)]]
    (tmp_path / "execution-observations.jsonl").write_text(
        "".join(json.dumps(o)+"\n" for o in observations), encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name":"task_harness","arguments":{"action":"inspect","section":"cross_context_research_candidates"}},
        {"name":"benchmark_probe","arguments":{}}])
    contexts = [r["context"] for r in rows(tmp_path, "provider-contexts.jsonl")]
    cue = next(t for t in texts(contexts[0]) if t.startswith("OPEN RESEARCH OPPORTUNITIES"))
    assert "optional" in cue and "parent decision required" not in cue and "do not silently bypass" not in cue
    assert "skip_call" not in cue and "authoring_prerequisite" not in cue and len(cue) < 1500
    view = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness")
    candidates = json.loads(view["result"]["content"][0]["text"])["value"]
    assert len(candidates) == 1 and candidates[0]["candidate_ref"] in cue
    assert candidates[0]["research_call"]["research_candidate_ref"] == candidates[0]["candidate_ref"]
    assert set(candidates[0]["evidence_refs"]) == {"o1","o2"}
    assert not rows(tmp_path, "auto-research-sessions.jsonl")
    assert all(r.get("status") != "skipped" for r in rows(tmp_path, "auto-research-opportunities.jsonl"))
