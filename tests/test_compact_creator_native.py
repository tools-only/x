"""Creator working-set regression through actual Pi; not model/game acceptance."""
import json

from test_pi_external_benchmark_native import _run_fixture
from test_harness_capability_authoring import module_eval


def test_creators_are_delivered_once_and_original_refs_remain_actionable(tmp_path):
    creator_ref = module_eval('pi_harness_baseline_methods.ts',
        "m.readBaselineMethod('skill-creator').method_ref")
    steps = [{"name": "task_harness", "arguments": {"action": "read_method", "method_name": name}}
             for name in ("skill-creator", "tool-creator", "subagent-creator")]
    steps.extend([
        {"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": "Author a bounded comparison method next; keep the creator contracts available."}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "component": "skill", "name": "bounded-comparison", "description": "Compare a hypothesis against a new observation.",
            "authoring_method_ref": creator_ref,
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
    # The original authorization remains useful after its body leaves residency.
    before_create = json.dumps(contexts[4], separators=(",", ":"))
    assert "<complete parent-authored procedural body>" not in before_create
    assert all(m["details"]["transient_expired"] for m in contexts[4]["messages"]
               if m.get("role") == "toolResult" and m.get("toolName") == "task_harness")
    skill = json.loads((tmp_path / "task-skills.jsonl").read_text().splitlines()[0])
    assert skill["authoring_method_ref"] == receipts[0]["method_ref"]
    assert not (tmp_path / "task-parent-tool-result-choices.jsonl").exists()
    # Restart does not reopen creator work; explicit exact recovery remains available.
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True)
    resumed = json.loads((tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[-1])["context"]
    text = json.dumps(resumed, separators=(",", ":"))
    assert "# Pi Tool creator" not in text and "# Pi Subagent creator" not in text
    assert "UNFINISHED CREATOR PREPARATION" not in text
    reads = (tmp_path / "task-baseline-method-reads.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(reads) == 3
    restored = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[{
        "name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator",
            "method_resource": receipts[1]["resource"], "expected_sha256": receipts[1]["sha256"]}}])
    restore = next(e for e in restored if e.get("type") == "tool_execution_end")
    assert not restore.get("isError")
    assert json.loads(restore["result"]["content"][0]["text"])["content"] == receipts[1]["content"]
