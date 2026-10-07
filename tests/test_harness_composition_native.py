"""Actual Pi component assembly/read seam; deterministic provider diagnostic."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture


def test_selected_skill_read_keeps_composed_memory_and_policy(tmp_path):
    refs = ["memory:composition-fact@v1", "system_prompt:composition-policy@v1", "skill:composition-skill@v1"]
    skill_path = tmp_path / "task-harness" / "skills" / "composition-skill" / "SKILL.md"
    candidates = [
        {"component": "memory", "name": "composition-fact", "content": "COMPOSITION_FACT",
         "atom": {"subject": "composition", "predicate": "records", "value": "COMPOSITION_FACT"},
         "validity": {"scope": "task"}, "projection": {"channel": "task_prompt", "layer": "task_state"}},
        {"component": "system_prompt", "name": "composition-policy", "content": "COMPOSITION_POLICY",
         "scope": "this task"},
        {"component": "skill", "name": "composition-skill", "description": "Use to inspect the supplied task state.",
         "instructions": "COMPOSITION_SKILL: compare current evidence with the selected scoped fact."},
    ]
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change",
         "changes": [{"operation": "create", "candidate": c} for c in candidates],
         "decision": {"basis_refs": [], "reason": "Compose a scoped fact, policy and method for a diagnostic.", "expected": "All three remain available after loading the selected method."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
         "selected_resource_refs": refs, "prompt_contributions": [],
         "decision": {"basis_refs": refs, "reason": "Use the three exact authored versions together.", "expected": "Read the Skill without narrowing the selected memory and policy."}}},
        {"name": "read", "arguments": {"path": str(skill_path)}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": "Apply the selected method while retaining COMPOSITION_FACT and COMPOSITION_POLICY."}},
    ])
    outputs = [e for e in events if e.get("type") == "tool_execution_end"]
    assert all(not e.get("isError") for e in outputs), outputs
    creation = json.loads(outputs[1]["result"]["content"][0]["text"])
    created_skill = next(r for r in creation["activation"]["created_resources"] if r["resource_ref"] == refs[2])
    assert created_skill["use_after_selection"] == {"tool": "read", "arguments": {"path": str(skill_path)}}
    assembly = json.loads(outputs[2]["result"]["content"][0]["text"])
    assert {r["resource_ref"] for r in assembly["components"]} == set(refs)
    assert outputs[3]["toolName"] == "read" and "COMPOSITION_SKILL" in outputs[3]["result"]["content"][0]["text"]
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert "read" not in {t["name"] for t in contexts[0]["tools"]}
    for c in contexts[3:]:
        assert "read" in {t["name"] for t in c["tools"]}
        current = "\n".join(p.get("text", "") for m in c["messages"] for p in m.get("content", [])
                            if p.get("text", "").startswith("Active dynamic task/user prompt knowledge:"))
        assert "COMPOSITION_FACT" in current
    assert not (tmp_path / "task-context-choices.jsonl").exists()  # No implicit focus choice.
    # System overlays are applied on the next parent prompt, rather than changing
    # system directives mid tool transaction. Resume the actual Pi parent.
    _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[])
    later = json.loads((tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[-1])["context"]
    assert "COMPOSITION_POLICY" in later["systemPrompt"]
    assert "read" in {t["name"] for t in later["tools"]}
    assert not {"bash", "edit", "write", "grep", "find", "ls"} & {t["name"] for t in later["tools"]}


def test_scoped_skill_read_rejects_unselected_paths_and_failed_assembly(tmp_path):
    ref = "skill:composition-skill@v1"
    skill_path = tmp_path / "task-harness" / "skills" / "composition-skill" / "SKILL.md"
    # Ordinary host surface exposes the same confined reader, so these checks
    # exercise its authorization rather than relying on a missing tool schema.
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create",
         "candidate": {"component": "skill", "name": "composition-skill", "description": "Check scoped evidence.",
                       "instructions": "COMPOSITION_PRIVATE_SKILL"}}],
         "decision": {"basis_refs": [], "reason": "Diagnose confined reader authorization.", "expected": "Only a selected Skill can be read."}}},
        {"name": "read", "arguments": {"path": str(skill_path)}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 99,
         "selected_resource_refs": [ref], "prompt_contributions": [],
         "decision": {"basis_refs": [ref], "reason": "Check failed CAS.", "expected": "Keep the current empty assembly."}}},
        {"name": "read", "arguments": {"path": str(skill_path)}},
        {"name": "read", "arguments": {"path": str(Path(__file__).resolve())}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
         "selected_resource_refs": [ref], "prompt_contributions": [],
         "decision": {"basis_refs": [ref], "reason": "Select the exact Skill.", "expected": "Permit its confined read."}}},
        {"name": "read", "arguments": {"path": str(skill_path)}},
    ])
    outputs = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(outputs) == 8
    assert [bool(e.get("isError")) for e in outputs] == [False, False, True, True, True, True, False, False]
    for i in (2, 4):
        assert "not selected" in json.dumps(outputs[i]["result"])
    assert "confined" in json.dumps(outputs[5]["result"])
    assert "COMPOSITION_PRIVATE_SKILL" in outputs[7]["result"]["content"][0]["text"]
    receipts = [json.loads(l) for l in (tmp_path / "task-harness-assembly-receipts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(receipts) == 1 and receipts[0]["components"][0]["resource_ref"] == ref
