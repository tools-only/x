"""Creator working-set regression through actual Pi; not model/game acceptance."""
import json

from test_pi_external_benchmark_native import _run_fixture


def test_compact_creators_remain_actionable_until_parent_creation(tmp_path):
    steps = [{"name": "task_harness", "arguments": {"action": "read_method", "method_name": name}}
             for name in ("skill-creator", "tool-creator", "subagent-creator")]
    steps.extend([
        {"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": "Author a bounded comparison method next; keep the creator contracts available."}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "component": "skill", "name": "bounded-comparison", "description": "Compare a hypothesis against a new observation.",
            "instructions": "Use a prediction and a counterexample; retain uncertainty when the new observation does not distinguish the candidates."}}],
            "decision": {"basis_refs": [], "reason": "Keep task reasoning falsifiable.", "expected": "A complete bounded comparison procedure is available."}}},
    ])
    events = _run_fixture(tmp_path, "treatment", steps=steps, arc_compact=True)
    ends = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(ends) == 5 and all(not e.get("isError") for e in ends)
    receipts = [json.loads(e["result"]["content"][0]["text"]) for e in ends[:3]]
    assert sum(len(json.dumps(r, separators=(",", ":"))) for r in receipts) < 14000
    for r in receipts:
        call = r["authoring_template"]["authoring_call"]["arguments"]
        candidate = call.get("candidate") or call["changes"][0]["candidate"]
        assert candidate.get("authoring_method_ref", r["creator_ref"]) == r["creator_ref"]
    assert all("optional_method_metadata_template" not in r["authoring_template"] for r in receipts)
    tool_body = receipts[1]["content"]
    for marker in ("input_schema", "output_schema", "parameters", "bindings", "predicate", "additionalProperties"):
        assert marker in tool_body
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    # The first creator is still actionable after other creator/checkpoint calls.
    before_create = json.dumps(contexts[4], separators=(",", ":"))
    assert receipts[0]["content"] in [json.loads(p["text"]).get("content")
        for m in contexts[4]["messages"] if m.get("role") == "toolResult"
        for p in m.get("content", []) if p.get("type") == "text" and p.get("text", "").startswith('{"format":"baseline-method-read-v1"')]
    assert "authoring_template" in before_create and "<complete parent-authored procedural body>" in before_create
    after_create = json.dumps(contexts[5], separators=(",", ":"))
    assert "used_in_applied_change_not_utility_evidence" in after_create
    assert not (tmp_path / "task-parent-tool-result-choices.jsonl").exists()
    # Resume must restore short complete entries from durable parent reads;
    # the parent should not need to read creators again after losing history.
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True)
    resumed = json.loads((tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[-1])["context"]
    text = json.dumps(resumed, separators=(",", ":"))
    assert "# Pi Tool creator" in text and "# Pi Subagent creator" in text
    assert text.count("# Pi Tool creator") == 1
    assert text.count("# Pi Subagent creator") == 1
    reads = (tmp_path / "task-baseline-method-reads.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(reads) == 3
