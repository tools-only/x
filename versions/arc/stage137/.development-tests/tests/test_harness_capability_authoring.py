"""Capability authoring diagnostics; not real-provider quality acceptance."""
import json
import os
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]

def procedure():
    return {"problem": "Identify candidate controlled objects without assuming identity",
			"applicability": "Use when a decision requires locating a controlled object from public transitions.",
			"abstain_when": "Preserve multiple candidates when the available transition does not distinguish them.",
			"abstraction_scope": "bounded_reuse",
            "inputs": ["before and after public frames", "action"], "steps": ["Compare candidate displacements", "Retain competing explanations"],
            "decision_points": ["If multiple objects move, report ambiguity"],
            "stop_conditions": ["one bounded comparison is complete"], "failure_modes": ["camera motion confounds displacement"],
            "next_use": "when object identity is uncertain", "predicted_semantic_result": "candidate set or explicit uncertainty",
            "falsifier": "asserts unique identity from changed-group size alone", "construction_evidence_refs": [], "contrast_evidence_refs": []}


def module_eval(module, expression):
    node, _ = _pi_cli()
    completed = subprocess.run([
        node, "--experimental-strip-types", "--input-type=module", "-e",
        f'import * as m from {json.dumps((PROJECT / "demo" / module).as_uri())};'
        f'console.log(JSON.stringify({expression}));',
    ], capture_output=True, text=True, env=os.environ.copy())
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_baseline_methods_are_discoverable_without_dynamic_components(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "methods"}},
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 2 and not any(e.get("isError") for e in outputs)
    catalog = json.loads(outputs[0]["result"]["content"][0]["text"])
    assert {m["name"] for m in catalog["methods"]} == {
        "skill-creator", "tool-creator", "subagent-creator", "research-orchestration"}
    body = outputs[1]["result"]["content"][0]["text"]
    assert "Running and evaluating test cases" in body
    assert "Pi runtime adaptation" in body
    read_payload = json.loads(body)
    assert read_payload["format"] == "baseline-method-read-v1"
    assert read_payload["method_ref"].startswith("baseline_method:skill-creator@sha256:")
    assert read_payload["creator_ref"] == read_payload["method_ref"]
    template = read_payload["authoring_template"]
    assert template["template_requires_parent_content"] is True
    assert "method" not in template["change_call"]["changes"][0]["candidate"]
    assert "optional_method_metadata_template" not in template
    assert "Not required" in template["optional_method_metadata"]
    assert template["change_call"]["changes"][0]["candidate"]["authoring_method_ref"] == read_payload["creator_ref"]
    assert not records(tmp_path, "task-skills.jsonl")
    context = records(tmp_path, "provider-contexts.jsonl")[0]["context"]
    assert "skill-creator" in json.dumps(context)
    assert "Running and evaluating test cases" not in json.dumps(context)
    assert records(tmp_path, "task-baseline-method-reads.jsonl")[0]["sha256"]


def test_creator_read_is_required_before_facade_skill_creation(tmp_path):
    candidate = {
        "semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse",
        "reasoning": "bounded_judgment", "name": "creator-gated-skill",
        "summary": "A creator-gated procedure.",
        "content": "Read the current frame before choosing a probe.",
        "scope": {"kind": "task_wide", "statement": "this task"},
        "context_visibility": "on_demand", "stability": "stable_in_scope",
        "basis_refs": [],
        "method": procedure(),
    }
    blocked = _run_fixture(tmp_path / "blocked", "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": candidate}],
            "decision": {"basis_refs": [], "reason": "Try an unauthored skill.", "expected": "Must be rejected."},
        },
    }])
    assert results(blocked, "task_harness")[-1].get("isError")
    assert not records(tmp_path / "blocked", "task-skills.jsonl")

    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    accepted = _run_fixture(tmp_path / "accepted", "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                **candidate,
            }}],
            "decision": {"basis_refs": [], "reason": "Use the skill creator output.", "expected": "The authored method is available."},
        }},
    ])
    assert not results(accepted, "task_harness")[-1].get("isError")
    assert records(tmp_path / "accepted", "task-skills.jsonl")[-1]["status"] == "active"
    assert records(tmp_path / "accepted", "task-skills.jsonl")[-1]["authoring_method_ref"] == method_ref
    lifecycle = records(tmp_path / "accepted", "task-method-lifecycle.jsonl")
    assert [row["maturity"] for row in lifecycle] == ["candidate_method", "trial"]
    assert lifecycle[-1]["resource_refs"] == ["skill:creator-gated-skill@v1"]
    assert lifecycle[-1]["author"] == "parent"


def test_dedicated_create_uses_the_same_creator_gate_and_native_mutation(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    candidate = {
        "semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse",
        "reasoning": "bounded_judgment", "name": "dedicated-create-skill",
        "summary": "Inspect public frame changes before repeating an action.",
        "content": "Compare the current public frame with the previous action result; state uncertainty before retrying.",
        "scope": {"kind": "task_wide", "statement": "this task"},
        "context_visibility": "on_demand", "stability": "stable_in_scope",
        "basis_refs": [], "authoring_method_ref": method_ref,
    }
    decision = {"basis_refs": [], "reason": "Create a reusable comparison procedure.",
                "expected": "The exact skill version is available for assembly."}
    blocked = _run_fixture(tmp_path / "blocked_dedicated", "treatment", steps=[
        {"name": "task_harness_create", "arguments": {"candidate": candidate, "decision": decision}},
    ], extra_env={"PI_HARNESS_OPEN_ADMISSION": "enabled"})
    assert results(blocked, "task_harness_create")[-1].get("isError")
    assert not records(tmp_path / "blocked_dedicated", "task-skills.jsonl")
    assert not records(tmp_path / "blocked_dedicated", "task-baseline-method-reads.jsonl")
    accepted = _run_fixture(tmp_path / "accepted_dedicated", "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": candidate, "decision": decision}},
    ])
    created = results(accepted, "task_harness_create")[-1]
    assert not created.get("isError"), created
    assert records(tmp_path / "accepted_dedicated", "task-skills.jsonl")[-1]["authoring_method_ref"] == method_ref
    assert created["result"]["details"]["activation"]["created_resource_refs"] == ["skill:dedicated-create-skill@v1"]


def test_dedicated_create_derives_only_the_audit_envelope_from_authored_candidate(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    candidate = {
        "semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse",
        "reasoning": "bounded_judgment", "name": "derived-decision-skill",
        "summary": "Compare the current public frame with the preceding result.",
        "content": "Check the current public frame before repeating an action.",
        "scope": {"kind": "task_wide", "statement": "this task"},
        "context_visibility": "on_demand", "stability": "stable_in_scope",
        "basis_refs": [], "authoring_method_ref": method_ref,
    }
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness_create", "arguments": {
            "candidate": candidate,
            "assembly": {"expected_assembly_revision": 0, "selected_resource_refs": []},
        }},
    ])
    created = results(events, "task_harness_create")[-1]
    assert not created.get("isError"), created
    receipt = created["result"]["details"]
    assert receipt["decision"]["reason"] == candidate["summary"]
    assert receipt["activation"]["created_resource_refs"] == ["skill:derived-decision-skill@v1"]
    assembly = records(tmp_path, "task-harness-assemblies.jsonl")[-1]
    assert assembly["selected_resource_refs"] == ["skill:derived-decision-skill@v1"]
    assert assembly["revision"] == 1


def test_direct_create_routes_explicit_metadata_out_of_pure_program(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='tool-creator').method_ref")
    decision = {"basis_refs": [], "reason": "Trial a parent-authored bounded result.", "expected": "Return value 2."}
    candidate = {
        "semantic_kind": "tool", "name": "metadata-placement-probe",
        "description": "Return a bounded value for one semantic trial.",
        "authoring_method_ref": method_ref,
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
        "output_schema": {"type": "object", "properties": {"value": {"type": "integer"}},
                          "required": ["value"], "additionalProperties": False},
        "program": {"format": "task-pure-expression-v1", "limits": {},
                    "expression": {"op": "literal", "value": {"value": 2}},
                    "assembly": {"expected_assembly_revision": 0, "selected_resource_refs": []},
                    "decision": decision},
    }
    steps = [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": candidate}},
        {"name": "task_tool_metadata-placement-probe_v1", "arguments": {"parameters": {}, "bindings": []}},
    ]
    accepted_root = tmp_path / "metadata_accepted"
    accepted = _run_fixture(accepted_root, "treatment",
                            extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=steps)
    created = results(accepted, "task_harness_create")[-1]
    assert not created.get("isError"), created
    assert records(accepted_root, "task-harness-assemblies.jsonl")[-1]["selected_resource_refs"] == [
        "tool:metadata-placement-probe@v1"]
    call = results(accepted, "task_tool_metadata-placement-probe_v1")[-1]
    assert not call.get("isError")
    assert json.loads(call["result"]["content"][0]["text"]) == {"value": 2}
    normalized = records(accepted_root, "task-harness-create-normalizations.jsonl")
    assert normalized[-1]["moved_fields"] == ["assembly", "decision"]
    assert normalized[-1]["outcome"] == "published"

    conflict_root = tmp_path / "metadata_conflict"
    conflict = _run_fixture(conflict_root, "treatment",
                            extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        steps[0], {"name": "task_harness_create", "arguments": {"candidate": candidate,
            "assembly": {"expected_assembly_revision": 1, "selected_resource_refs": []}}},
    ])
    assert results(conflict, "task_harness_create")[-1]["result"].get("isError")
    assert not records(conflict_root, "task-tools.jsonl")

    stale_root = tmp_path / "metadata_stale"
    stale_candidate = {**candidate, "program": {**candidate["program"],
        "assembly": {"expected_assembly_revision": 1, "selected_resource_refs": []}}}
    stale = _run_fixture(stale_root, "treatment",
                         extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        steps[0], {"name": "task_harness_create", "arguments": {"candidate": stale_candidate}},
    ])
    assert "assembly revision conflict" in results(stale, "task_harness_create")[-1]["result"]["content"][0]["text"]
    assert not records(stale_root, "task-tools.jsonl")

    decision_root = tmp_path / "metadata_decision_conflict"
    decision_conflict = _run_fixture(decision_root, "treatment",
                                     extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        steps[0], {"name": "task_harness_create", "arguments": {"candidate": candidate,
            "decision": {**decision, "expected": "Different result"}}},
    ])
    assert results(decision_conflict, "task_harness_create")[-1]["result"].get("isError")
    assert not records(decision_root, "task-tools.jsonl")

    extra_root = tmp_path / "metadata_extra"
    extra_candidate = {**candidate, "program": {**candidate["program"], "unsupported": True}}
    extra = _run_fixture(extra_root, "treatment",
                         extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        steps[0], {"name": "task_harness_create", "arguments": {"candidate": extra_candidate}},
    ])
    assert json.loads(results(extra, "task_harness_create")[-1]["result"]["content"][0]["text"])["status"] == "failed"
    assert not records(extra_root, "task-tools.jsonl")


def test_auto_research_requires_parent_research_orchestration_read(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _, cli = _pi_cli()
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "No extra evidence was available.", "findings": [],
        "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Retry after a grounded question.", "method_candidates": [],
    }
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {"question": "Must be rejected without the orchestration method."}}],
    )
    failure = results(events, "auto_research")[0]
    assert not failure.get("isError")
    prepared = json.loads(failure["result"]["content"][0]["text"])
    assert prepared["status"] == "authoring_method_supplied"
    assert prepared["started"] is False
    assert prepared["retry"]["question"] == "Must be rejected without the orchestration method."
    assert prepared["method"]["content"]
    assert "research-orchestration" in failure["result"]["content"][0]["text"]
    assert not records(tmp_path, "auto-research-runs.jsonl")


def test_research_child_has_no_creator_or_harness_mutation_tools(tmp_path):
    _, cli = _pi_cli()
    orchestration_ref = module_eval(
        "pi_harness_baseline_methods.ts",
        "m.baselineMethodCatalog().find(x=>x.name==='research-orchestration').method_ref")
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "The bounded evidence does not justify a capability yet.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Wait for a discriminating observation.", "method_candidates": [],
    }
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[PROJECT / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(PROJECT / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[
            {"name": "auto_research", "arguments": {"action": "start", "question": "Check one bounded uncertainty."}},
            {"name": "auto_research", "arguments": {"action": "start", "question": "Check one bounded uncertainty.",
                                                        }},
        ],
    )
    assert not results(events, "auto_research")[-1].get("isError")
    context = records(tmp_path, "subagent-provider-contexts.jsonl")[0]["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert "submit_research_report" in names
    assert not {"harness_method", "research_approval", "task_harness"} & names
    rendered = json.dumps(context)
    assert "auto-research-harness-delivery-v1" not in rendered
    assert "Native harness delivery schemas" not in rendered
    assert "the parent owns all Harness authoring" in rendered


def test_legacy_child_delivery_is_downgraded_without_copying_component_body():
    legacy = {
        "format": "auto-research-report-v1", "status": "provisional", "conclusion": "candidate",
        "findings": [], "evidence_refs": ["o1"], "alternatives": [], "limitations": [],
        "validation_plan": "later use", "harness_proposals": [{"candidate_ref": "legacy", "delivery": {
            "format": "auto-research-harness-delivery-v1", "delivery_id": "legacy", "semantic_kind": "procedure",
            "operation": "create", "name": "legacy", "summary": "method input",
            "content": "THIS_CHILD_BODY_MUST_NOT_SURVIVE", "basis_refs": ["o1"], "method": procedure(),
        }}],
    }
    normalized = module_eval(
        "pi_auto_research_output.ts",
        f"m.normalizeAutoResearchReport({json.dumps(legacy)})")
    assert normalized["harness_proposals"] == []
    assert normalized["method_candidates"][0]["candidate_ref"] == "legacy"
    assert "THIS_CHILD_BODY_MUST_NOT_SURVIVE" not in json.dumps(normalized)
    assert normalized["boundary_violations"][0]["code"] == "child_component_authoring_forbidden"


def test_parent_authoring_handoff_is_non_executable_and_creator_gated():
    report = {
        "format": "auto-research-report-v1", "status": "provisional", "conclusion": "method candidate",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "parent may author a bounded trial", "method_candidates": [{
            "candidate_ref": "identify-self", "name": "identify-self", "semantic_kind": "procedure",
            "summary": "Identify a controlled object while preserving ambiguity.", "basis_refs": [],
            "method": procedure(),
        }],
    }
    handoff = module_eval(
        "pi_auto_research_output.ts",
        "m.buildParentAuthoringHandoffs({runId:'auto-research-7',reportRef:'research_report:auto-research-7@v1',"
        f"researchLineRef:'research_line:self@v1',report:{json.dumps(report)}}})[0]")
    assert handoff["status"] == "awaiting_parent_authoring"
    assert handoff["creator"]["name"] == "skill-creator"
    assert handoff["change_call_template"]["executable"] is False
    seed = handoff["change_call_template"]["arguments"]["changes"][0]["candidate_seed"]
    assert "content" not in seed and "instructions" not in seed and "method" not in seed
    assert handoff["source"]["method_ref"].startswith("method:method-auto-research-7-identify-self@v1")


def test_mixed_change_checks_all_creators_before_writing_memory(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "change", "decision": {"basis_refs": [], "reason": "Persist facts and a method", "expected": "Atomic creator preflight"},
            "changes": [
                {"operation": "create", "candidate": {"type": "memory", "name": "observed-control", "content": "up",
                    "atom": {"subject": "control", "predicate": "direction", "value": "up"}}},
                {"operation": "create", "candidate": {"type": "skill", "name": "control-probe",
                    "description": "Probe ambiguous controls", "content": "Compare before and after; retain alternatives."}},
            ],
        },
    }])
    assert results(events, "task_harness")[-1].get("isError")
    assert not records(tmp_path, "task-memory.jsonl")
    assert not records(tmp_path, "task-skills.jsonl")


def test_creator_failure_keeps_review_available_for_corrected_retry(tmp_path):
    (tmp_path / "task-harness-opportunities.jsonl").write_text(
        json.dumps({"opportunity_id": "creator-review"}) + "\n", encoding="utf-8")
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    candidate = {"type": "skill", "name": "bounded-probe", "description": "Resolve ambiguous controls",
                 "method": procedure(),
                 "content": "Compare before and after an action; retain ambiguity if multiple objects move."}
    def review(body):
        return {"name": "task_harness", "arguments": {"action": "review", "opportunity_id": "creator-review", "review": [{
            "component": "skill", "disposition": "create", "reason": "A reusable probe procedure",
            "next_use": "When object identity is uncertain", "validation": "Check a held-out action",
            "candidate": body}]}}
    events = _run_fixture(tmp_path, "treatment", steps=[
        review(candidate),
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        review({**candidate, "authoring_method_ref": method_ref}),
    ])
    outputs = results(events, "task_harness")
    assert outputs[0].get("isError")
    assert "authoring_method_ref" in json.dumps(outputs[0])
    assert not outputs[-1].get("isError"), outputs[-1]
    assert len(records(tmp_path, "task-harness-review-commits.jsonl")) == 1
    assert records(tmp_path, "task-skills.jsonl")[-1]["authoring_method_ref"] == method_ref
    receipt = records(tmp_path, "task-harness-change-receipts.jsonl")[-1]
    assert receipt["activation"]["created_resource_refs"] == ["skill:bounded-probe@v1"]
    assert receipt["activation"]["assemble_template"]["expected_assembly_revision"] == 0
    assert not records(tmp_path, "task-harness-assemblies.jsonl")


def test_unscoped_memory_and_skill_without_use_trigger_cannot_enter_facade(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        *[{"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": candidate}],
           "decision": {"basis_refs": [], "reason": "Check admission", "expected": "Reject incomplete contract"}}}
          for candidate in [
              {"semantic_kind": "memory", "name": "map", "atom": {"subject": "level", "predicate": "map", "value": "observed map"}, "content": "observed map"},
              {"semantic_kind": "skill", "name": "trajectory", "content": "Moved from (1,2) to (1,3)", "authoring_method_ref": method_ref}]]])
    outputs = results(events, "task_harness")
    assert outputs[-2].get("isError") and "validity" in json.dumps(outputs[-2])
    assert outputs[-1].get("isError") and "description" in json.dumps(outputs[-1])
    assert not records(tmp_path, "task-memory.jsonl")
    assert not records(tmp_path, "task-skills.jsonl")


def test_trace_markers_are_nonblocking_for_a_structurally_complete_scoped_method(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    trace_body = """\
obs-93 ACTION1 changed 52 cells at rows30-39 cols39-43.
obs-94 ACTION2 changed 2 cells at rows61-62. Repeat ACTION1 from this bbox.
"""
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "procedure", "name": "trace-recap", "authoring_method_ref": method_ref,
            "description": "Use for the current bounded trace comparison.",
            "content": trace_body, "method": {**procedure(), "abstraction_scope": "single_situation"},
        }}], "decision": {"basis_refs": [], "reason": "Trial a narrowly scoped parent-authored procedure.", "expected": "Preserve the exact example without runtime semantic judgment."}}},
    ])
    receipt = results(events, "task_harness")[-1]
    assert not receipt.get("isError")
    assert records(tmp_path, "task-skills.jsonl")[-1]["name"] == "trace-recap"
    assessment = module_eval("pi_auto_research_harness_router.ts",
        "m.assessMethodAbstraction(m.normalizeMethodSpecification(" +
        json.dumps({**procedure(), "abstraction_scope": "single_situation"}) + ")," + json.dumps(trace_body) + ")")
    assert assessment["documentation_complete"] is True
    assert assessment["documentation_gaps"] == []
    assert "promotable" not in assessment
    assert {"event_identifier", "fixed_coordinate"} <= set(assessment["trajectory_detail_indicators"])


def test_single_situation_procedure_produces_parent_authoring_handoff():
    report = {
        "status": "inconclusive", "conclusion": "One observation supports a narrowly scoped procedure candidate.",
        "findings": [], "evidence_refs": ["o1"], "alternatives": [], "limitations": [],
        "validation_plan": "Compare a later condition.", "method_candidates": [{
            "candidate_ref": "one-case", "name": "one-case", "semantic_kind": "procedure",
            "summary": "A restricted observation procedure.", "basis_refs": ["o1"],
            "method": {**procedure(), "abstraction_scope": "single_situation"},
        }],
    }
    value = module_eval("pi_auto_research_output.ts", "m.buildParentAuthoringHandoffs({runId:'r1',reportRef:'research_report:r1@v1',report:"
                        + json.dumps(report) + "})")
    assert len(value) == 1
    assert value[0]["recommended_component_kind"] == "skill"
    assert value[0]["source"]["method_candidate_ref"] == "one-case"


def test_parent_can_author_single_situation_skill_when_body_is_a_method_not_a_trace(tmp_path):
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    method = {**procedure(), "abstraction_scope": "single_situation"}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "skill", "name": "current-level-controlled-object-probe",
            "authoring_method_ref": method_ref,
            "description": "Identify the controlled object while the current level remains active.",
            "instructions": "Compare before/after states for each available action. Keep multiple candidates when effects are ambiguous, and stop after one candidate has repeatable action-conditioned displacement.",
            "method": method,
        }}], "decision": {
            "basis_refs": [], "reason": "Package a procedural method for repeated use in the current level.",
            "expected": "The method is available without claiming cross-situation validity.",
        }}},
    ])
    result = results(events, "task_harness")[-1]
    assert not result.get("isError")
    skill = records(tmp_path, "task-skills.jsonl")[-1]
    assert skill["status"] == "active"
    assert skill["method"]["abstraction_scope"] == "single_situation"


def test_historical_unscoped_memory_is_review_only():
    result = module_eval("pi_memory_validity.ts", "m.memoryValidityReasons(undefined, m.memoryValidityContext('t', []))")
    assert result == ["validity:missing_requires_review"]


def test_research_candidate_defaults_do_not_overwrite_parent_question():
    result = module_eval("pi_research_method_runtime.ts", "m.bindResearchCandidateParameters({question:'Generic comparison',scope:'research_method',research_line_ref:'research_line:r@v1',evidence_refs:['o1'],constraints:['read only']},{question:'Challenge and package using skill-creator',evidence_refs:['o2'],constraints:['preserve counterexamples']})")
    assert result["question"] == "Challenge and package using skill-creator"
    assert result["evidence_refs"] == ["o1", "o2"]
    assert result["research_line_ref"] == "research_line:r@v1"
    assert result["constraints"] == ["read only", "preserve counterexamples"]


def test_construction_evidence_cannot_validate_a_method():
    result = module_eval("pi_research_method_runtime.ts", "m.advanceMethodAssessment({maturity:'trial',construction_evidence_refs:['observation:o1@v1']},{verdict:'supported',assessmentRef:'a1',observationRefs:['o1'],actualUseRefs:['o1']})")
    assert result["maturity"] == "trial"
    assert result["actual_use_observation_refs"] == []


def test_parent_authored_method_feedback_does_not_invent_a_research_report():
    value = module_eval("pi_research_method_runtime.ts", """(()=>{
      let method=m.parentMethodRecord({resourceRef:'skill:compare@v1',name:'compare',method:{construction_evidence_refs:['o1']},decisionId:'d1'});
      method=m.advanceMethodApplication(method,{resourceRefs:['skill:compare@v1'],applicationRef:'parent-change'});
      const assessment={effect_assessment_id:'a1',verdict:'unsupported',consequence:'Prediction failed',observation_refs:['o2']};
      method=m.advanceMethodAssessment(method,{verdict:'unsupported',assessmentRef:'effect_assessment:a1@v1',observationRefs:['o2'],actualUseRefs:['o2']});
      return {method,feedback:m.buildMethodFeedbackHandoff(method,assessment)};
    })()""")
    assert value["method"]["maturity"] == "contradicted"
    assert value["feedback"]["research_line_ref"] == value["method"]["research_line_ref"]
    assert value["feedback"]["research_problem"]["prior_research_refs"] == []
    assert "skill:compare@v1" in value["feedback"]["resource_refs"]


def test_failed_actual_tool_use_blocks_same_version_and_emits_feedback(tmp_path):
    ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='tool-creator').method_ref")
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[PROJECT / "tests/pi_task_tool_fixture.ts"], steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "tool", "name": "bounded-selector", "description": "Select a state field for comparison",
            "authoring_method_ref": ref, "method": procedure(), "program": {"steps": [{"kind": "select", "fields": ["state"]}]}}}],
            "decision": {"basis_refs": [], "reason": "Trial a bounded selector", "expected": "Select the required field"}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:bounded-selector@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Run bounded trial", "expected": "Return selected state"}}},
        {"name": "task_tool_bounded-selector_v1", "arguments": {"input": {"other": "missing state"}}},
        {"name": "task_harness", "arguments": {"action": "assess_effect", "decision_id": "decision-1",
            "observation_refs": ["task-tool-use-task-tool-invocation-1"], "verdict": "unsupported",
            "consequence": "The input lacked state and the selector did not produce the needed value; revise the input precondition"}},
        {"name": "task_tool_bounded-selector_v1", "arguments": {"input": {"state": "ready"}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    invocations = results(events, "task_tool_bounded-selector_v1")
    assert not invocations[0].get("isError")
    assert invocations[1].get("isError") and "method_requires_revision" in json.dumps(invocations[1])
    method = records(tmp_path, "task-method-lifecycle.jsonl")[-1]
    assert method["maturity"] == "contradicted"
    assert records(tmp_path, "auto-research-handoffs.jsonl")[-1]["research_line_ref"] == method["research_line_ref"]
    assert "method_requires_revision" in json.dumps(results(events, "task_harness")[-1])


def test_method_objects_cannot_silently_become_object_object_or_disappear():
    spec = procedure()
    for field, value in [("parameters", {"tile_size": 5}), ("steps", [{"step": "compare"}])]:
        candidate = {**spec, field: value}
        result = module_eval("pi_auto_research_harness_router.ts",
                             "(()=>{try{m.normalizeMethodSpecification(" + json.dumps(candidate) + ");return null}catch(e){return e.message}})()")
        assert "array of authored strings" in result


def test_flat_method_fields_and_scalar_list_fields_are_losslessly_normalized():
    flat = {**procedure(), "decision_points": "If ambiguous, retain both candidates",
            "semantic_kind": "skill", "name": "compare", "instructions": "Compare and report uncertainty."}
    value = module_eval("pi_harness_protocol.ts", "m.normalizeSemanticCandidate(" + json.dumps(flat) + ")")
    assert value["method"]["problem"] == flat["problem"]
    assert value["method"]["decision_points"] == flat["decision_points"]
    assert "problem" not in value and "decision_points" not in value
    normalized = module_eval("pi_auto_research_harness_router.ts",
                             "m.normalizeMethodSpecification(" + json.dumps(value["method"]) + ")")
    assert normalized["decision_points"] == ["If ambiguous, retain both candidates"]

    conflict = {"semantic_kind": "skill", "name": "compare", "instructions": "Compare.",
                "method": procedure(), "decision_points": ["Choose a different operation"]}
    error = module_eval("pi_harness_protocol.ts",
                        "(()=>{try{m.normalizeSemanticCandidate(" + json.dumps(conflict) + ");return null}catch(e){return e.message}})()")
    assert "conflicts with canonical candidate.method.decision_points" in error


def test_creator_mismatch_returns_current_ref_without_forcing_a_second_read(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "skill", "name": "wrong-ref", "description": "Compare transitions",
            "instructions": "Compare transitions and preserve uncertainty.", "method": procedure(),
            "authoring_method_ref": "baseline_method:research-orchestration@sha256:wrong",
        }}], "decision": {"basis_refs": [], "reason": "Exercise repair details", "expected": "Return exact ref"}}},
    ])
    failure = results(events, "task_harness")[-1]
    text = json.dumps(failure)
    expected = module_eval("pi_harness_baseline_methods.ts",
                           "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    assert failure.get("isError")
    assert f"expected_ref={expected}" in text
    assert "creator_read_in_run=true" in text
    assert len(records(tmp_path, "task-baseline-method-reads.jsonl")) == 1


def test_exposure_cannot_support_utility_and_rejection_is_retryable(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "claim", "content": "An untested claim", "validity": {"scope": "task"}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["memory:claim@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select for trial", "expected": "Exposure only"}}},
        {"name": "task_harness", "arguments": {"action": "assess_effect", "verdict": "supported", "consequence": "I read it"}},
        {"name": "task_harness", "arguments": {"action": "assess_effect", "verdict": "inconclusive", "consequence": "No actual test yet"}},
    ])
    outputs = results(events, "task_harness")
    assert outputs[-2].get("isError") and "actual-use evidence" in json.dumps(outputs[-2])
    assert not outputs[-1].get("isError")
    assessments = records(tmp_path, "effect-assessments.jsonl")
    assert len(assessments) == 1 and assessments[0]["verdict"] == "inconclusive"


def test_missing_skill_body_does_not_consume_review(tmp_path):
    (tmp_path / "task-harness-opportunities.jsonl").write_text(json.dumps({"opportunity_id": "body-review"}) + "\n", encoding="utf-8")
    ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    def review(body):
        return {"name": "task_harness", "arguments": {"action": "review", "opportunity_id": "body-review", "review": [{
            "component": "skill", "disposition": "create", "reason": "Compare transitions", "next_use": "Next observation", "validation": "Check ambiguity",
            "candidate": {"name": "compare", "description": "Compare public transitions", "method": procedure(), "authoring_method_ref": ref, **body}}]}}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        review({}), review({"instructions": "Compare before and after frames; retain competing explanations and abstain if confounded."})])
    outputs = results(events, "task_harness")
    assert outputs[-2].get("isError")
    assert not outputs[-1].get("isError")
    assert len(records(tmp_path, "task-harness-review-commits.jsonl")) == 1


def test_baseline_reader_rejects_traversal_and_unknown_resources():
    result = module_eval("pi_harness_baseline_methods.ts", "(()=>{let failures=0; for(const resource of ['../SKILL.md','/etc/passwd','missing.md']) {try {m.readBaselineMethod('skill-creator',resource)} catch {failures++}} return failures})()")
    assert result == 3


def test_research_start_prerequisite_provides_exact_read_and_ref():
    result = module_eval("pi_harness_baseline_methods.ts", "m.researchAuthoringPrerequisite()")
    assert result["tool"] == "task_harness"
    assert result["arguments"]["action"] == "read_method"
    assert result["arguments"]["method_name"] == "research-orchestration"
    assert result["authoring_method_ref"].endswith(result["arguments"]["expected_sha256"])


def test_tool_creator_is_pi_native_and_excludes_mcp_server_guidance(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator",
            "method_resource": "references/pi-task-local-tool-contract.md"}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 2 and not any(e.get("isError") for e in outputs)
    body = "\n".join(e["result"]["content"][0]["text"] for e in outputs)
    assert "pi.registerTool" in body
    assert "task_tool" in body and "task_harness" in body
    assert "MCP" not in body and "server.registerTool" not in body
    sources = json.loads((PROJECT / "demo" / "harness-methods" /
                          "tool-creator" / "SOURCES.json").read_text(encoding="utf-8"))
    assert sources["primary"]["package"] == "@earendil-works/pi-coding-agent"
    assert sources["primary"]["version"] == "0.80.6"


def test_tool_creator_reference_without_markdown_suffix_is_resolved(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator",
            "method_resource": "references/pi-task-local-tool-contract"}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 1 and not outputs[0].get("isError")
    assert "task_tool" in outputs[0]["result"]["content"][0]["text"]


def test_tool_creator_read_exposes_single_component_and_binding_schema_contract(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
    ])
    read = json.loads(results(events, "task_harness")[0]["result"]["content"][0]["text"])
    body = read["content"]
    assert "task_harness_create(candidate,assembly)" in body
    assert 'declare every field read by get(input,"field")' in body
    assert "including fields supplied by bindings" in body


def test_pi_task_tool_creator_contract_requires_assembled_semantic_output(tmp_path):
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[PROJECT / "tests" / "pi_task_tool_fixture.ts"],
        steps=[
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "state-selector",
            "description": "Select the state field from an input object.",
            "input_schema": {"type": "object"},
            "program": {"steps": [{"kind": "select", "fields": ["state"]}]},
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:state-selector@v1"],
            "prompt_contributions": [],
            "decision": {"basis_refs": [],
                         "reason": "Select the bounded computation for a semantic trial.",
                         "expected": "The selected tool returns only the state field."},
        }},
        {"name": "task_tool_state-selector_v1", "arguments": {
            "input": {"state": "RUNNING", "irrelevant": "discard"}}},
        ],
    )
    assert not results(events, "task_tool")[0].get("isError")
    assert not results(events, "task_harness")[0].get("isError")
    invocation = results(events, "task_tool_state-selector_v1")[0]
    assert not invocation.get("isError")
    assert json.loads(invocation["result"]["content"][0]["text"]) == {
        "state": "RUNNING"}
    event = records(tmp_path, "task-tool-events.jsonl")[-1]
    assert event["status"] == "completed"
    assert "RUNNING" in event["output_excerpt"]


def test_structured_skill_can_be_an_explicit_untested_candidate(tmp_path):
    method = {
        "problem": "Locate a controllable object in a new grid.",
        "inputs": ["two observations around a known directional action"],
        "invariants": ["the compared observations use the same grid coordinates"],
        "parameters": ["candidate component", "action direction"],
        "steps": ["compute changed groups", "compare signed displacement",
                  "retain candidates whose displacement matches the action"],
        "decision_points": ["whether exactly one candidate matches"],
        "stop_conditions": ["one candidate is retained or ambiguity is reported"],
        "failure_modes": ["animation or multiple moving objects remain ambiguous"],
        "construction_evidence_refs": [],
        "contrast_evidence_refs": [],
        "next_use": "when self location is required in an unseen level",
        "predicted_semantic_result": "a candidate object plus uncertainty",
        "falsifier": "a known action moves a different object consistently",
    }
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_skill", "arguments": {
            "action": "create", "name": "identify-controlled-object",
            "description": "Identify the likely controlled object from action deltas.",
            "instructions": "Compare action-aligned displacement; retain ambiguity.",
            "method": method,
        }}])
    output = results(events, "task_skill")[0]
    assert not output.get("isError")
    skill = records(tmp_path, "task-skills.jsonl")[-1]
    assert skill["method"]["construction_evidence_refs"] == []
    assert skill["authoring_status"] == "structured_untested_candidate"


def test_memory_validity_expires_level_and_dependents_not_task_memory():
    result = module_eval("pi_task_knowledge_lifecycle.ts", """(()=>{
      const ctx={task:'task-a',episode:'episode-a',level:'level-2',state:'obs-5'};
      const map={key:'map',version:1,status:'active',validity:{scope:'level',instance_ref:'level-1',task_ref:'task-a'}};
      const controls={key:'controls',version:1,status:'active',validity:{scope:'task',instance_ref:'task-a',task_ref:'task-a'}};
      const skill={name:'route',version:1,status:'active',depends_on_refs:['memory:map@v1']};
      const state=m.knowledgeState([{kind:'memory',record:map},{kind:'memory',record:controls},{kind:'skill',record:skill}],ctx);
      return {map:state.eligible('memory',map),controls:state.eligible('memory',controls),skill:state.eligible('skill',skill),reason:state.reasons('memory',map),historical:state.resolve('memory:map@v1').record.status};
    })()""")
    assert result["map"] is False and result["skill"] is False
    assert result["controls"] is True and result["historical"] == "active"
    assert any("scope_expired" in r for r in result["reason"])


def test_validity_context_uses_successful_environment_boundaries_only():
    result = module_eval("pi_memory_validity.ts", """(()=>{
      const rows=[{observation_id:'o1',tool_name:'arc_action',input:{action:'ACTION1'},arc_outcome:{levels_completed:0}},
        {observation_id:'o2',tool_name:'arc_action',input:{action:'RESET'},is_error:true},
        {observation_id:'o3',tool_name:'arc_action',input:{action:'ACTION1'},arc_outcome:{levels_completed:1,public_transition:{level_changed:true,level_before:0,level_after:1}}}];
      const before=m.memoryValidityContext('task-a',rows.slice(0,1));
      const failed=m.memoryValidityContext('task-a',rows.slice(0,2));
      const after=m.memoryValidityContext('task-a',rows);
      return {same:before.level===failed.level,changed:before.level!==after.level,episode:before.episode===after.episode};
    })()""")
    assert result == {"same": True, "changed": True, "episode": True}


def test_saved_tool_and_subagent_recheck_level_scope_at_invocation_but_task_skill_survives(tmp_path):
    refs = {
        name: module_eval("pi_harness_baseline_methods.ts",
                          f"m.baselineMethodCatalog().find(x=>x.name==='{name}').method_ref")
        for name in ("skill-creator", "tool-creator", "subagent-creator")
    }
    project = Path(__file__).resolve().parents[1]
    extensions = [project / "tests" / "pi_task_tool_fixture.ts",
                  project / "tests" / "pi_non_arc_task_subagents.ts",
                  project / "tests" / "pi_task_scope_transition_fixture.ts"]
    root = tmp_path / "invocation-validity-boundary"
    candidates = [
        {"semantic_kind": "skill", "name": "task-localization", "description": "Locate the controlled object from public transitions.",
         "instructions": "Compare consecutive public frames and retain ambiguity when multiple objects move.",
         "authoring_method_ref": refs["skill-creator"], "validity": {"scope": "task"}},
        {"semantic_kind": "tool", "name": "level-state-selector", "description": "Select the state field from a bounded input.",
         "authoring_method_ref": refs["tool-creator"], "validity": {"scope": "level"},
         "input_schema": {"type": "object", "properties": {"state": {"type": "string"}},
                          "required": ["state"], "additionalProperties": False},
         "output_schema": {"type": "string"},
         "program": {"steps": [{"kind": "select", "source": "input", "fields": ["state"]}]}},
        {"semantic_kind": "subagent", "name": "level-route-reviewer", "description": "Review one route in the current level.",
         "instructions": "Compare the supplied route with current-level constraints and report uncertainty.",
         "authoring_method_ref": refs["subagent-creator"], "validity": {"scope": "level"},
         "tools": [], "context_recipe": {"include_checkpoint": False, "recent_observations": 0,
             "recent_actions": 0, "inherit_harness_refs": [], "output_contract": "route risks and uncertainty"}},
    ]
    events = _run_fixture(root, "treatment", extra_extensions=extensions, steps=[
        *[{"name": "task_harness", "arguments": {"action": "read_method", "method_name": name}}
          for name in refs],
        {"name": "task_harness", "arguments": {"action": "change",
            "changes": [{"operation": "create", "candidate": candidate} for candidate in candidates],
            "decision": {"basis_refs": [], "reason": "Create a task method and two current-level candidates.",
                "expected": "Task scope survives while current-level definitions expire after transition."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:task-localization@v1", "tool:level-state-selector@v1",
                                       "subagent:level-route-reviewer@v1"],
            "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select all exact definitions for their declared scope.",
                "expected": "The task Skill remains useful across levels; level-specific calls stop at transition."}}},
        {"name": "task_tool_level-state-selector_v1", "arguments": {"input": {"state": "current"}}},
        {"name": "fixture_level_transition", "arguments": {}},
        {"name": "task_tool_level-state-selector_v1", "arguments": {"input": {"state": "current"}}},
        {"name": "delegate_task", "arguments": {"agent_name": "level-route-reviewer",
            "task": "Check whether the chosen route respects the current level constraints."}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "focus",
            "resource_refs": ["skill:task-localization@v1"]}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "tool:level-state-selector@v1"}},
    ])
    assert not results(events, "task_harness")[3].get("isError"), results(events, "task_harness")[3]
    assert not results(events, "fixture_level_transition")[-1].get("isError")
    pool = json.loads(results(events, "task_harness")[5]["result"]["content"][0]["text"])["component_pool"]
    entries = {entry["resource_ref"]: entry for entry in pool}
    assert entries["skill:task-localization@v1"]["eligible"] is True
    assert entries["tool:level-state-selector@v1"]["eligible"] is False
    assert entries["subagent:level-route-reviewer@v1"]["eligible"] is False
    assert not results(events, "task_harness")[6].get("isError")
    tool_results = results(events, "task_tool_level-state-selector_v1")
    assert len(tool_results) == 2
    assert not tool_results[0].get("isError")
    assert json.loads(tool_results[0]["result"]["content"][0]["text"]) == {"state": "current"}
    assert tool_results[1].get("isError")
    stale_tool_error = json.dumps(tool_results[1])
    assert "task tool scope requires review" in stale_tool_error
    assert "scope_expired:level:" in stale_tool_error
    child_result = results(events, "delegate_task")[0]
    assert child_result.get("isError") and "saved subagent scope requires review" in json.dumps(child_result)
    historical = results(events, "task_resource")[-1]
    assert not historical.get("isError")
    assert "level-state-selector" in json.dumps(historical)


def test_pure_reasoning_subagent_can_have_explicit_empty_tools(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_subagent", "arguments": {
            "action": "create", "name": "independent-planner", "tools": [],
            "description": "Use for a clean-context plan from selected facts.",
            "instructions": "Compare candidate plans; return assumptions and counterexamples.",
            "context_recipe": {"include_checkpoint": False, "recent_observations": 0,
                "recent_actions": 0, "inherit_harness_refs": [], "output_contract": "plan and uncertainty"},
        }}], extra_extensions=[PROJECT / "tests/pi_non_arc_task_subagents.ts"])
    assert not results(events, "task_subagent")[-1].get("isError")
    row = records(tmp_path, "task-subagents.jsonl")[-1]
    assert row["tools"] == []
    assert row["context_recipe"]["include_checkpoint"] is False


def test_public_facade_admits_five_main_authored_component_types_to_candidate_pool(tmp_path):
    refs = {
        name: module_eval(
            "pi_harness_baseline_methods.ts",
            f"m.baselineMethodCatalog().find(x=>x.name==='{name}').method_ref",
        )
        for name in ("skill-creator", "tool-creator", "subagent-creator")
    }
    candidates = [
        {
            "component": "memory", "name": "door-hypothesis",
            "atom": {"subject": "door", "predicate": "may_open_after_key", "value": True},
            "validity": {"scope": "task"},
        },
        {
            "component": "skill", "name": "check-door",
            "description": "Use when deciding whether a visible door can be crossed.",
            "instructions": "Inspect the latest public state. If the door changed after collecting a key, try the shortest safe crossing; otherwise preserve the hypothesis and stop.",
        },
        {
            "component": "tool", "name": "select-door-state",
            "description": "Select the door field from supplied public state.",
            "input_schema": {"type": "object", "properties": {"door": {}}, "additionalProperties": True},
            "output_schema": {"type": "object", "properties": {"door": {}}, "additionalProperties": False},
            "program": {"steps": [{"kind": "select", "source": "input", "fields": ["door"]}]},
        },
        {
            "component": "subagent", "name": "door-counterexample-reviewer",
            "description": "Use for an independent check of the door hypothesis.",
            "instructions": "Given the bounded supplied context, identify one counterexample or return that none is visible. Do not request actions.",
            "tools": [],
            "context_recipe": {"include_checkpoint": True, "recent_observations": 1,
                               "recent_actions": 0, "inherit_harness_refs": [],
                               "output_contract": "counterexample and uncertainty"},
        },
        {
            "component": "system_prompt", "name": "door-safety-scope",
            "content": "Within the current task, do not cross a door unless the public state indicates it is open.",
            "scope": "current task; untested safety rule",
        },
    ]
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[PROJECT / "tests" / "pi_task_tool_fixture.ts",
                          PROJECT / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[
            *[{"name": "task_harness", "arguments": {
                "action": "read_method", "method_name": name,
            }} for name in refs],
            {"name": "task_harness", "arguments": {
                "action": "change",
                "changes": [{"operation": "create", "candidate": candidate}
                            for candidate in candidates],
                "decision": {"basis_refs": [],
                             "reason": "Create five independently inspectable untested candidates authored by main.",
                             "expected": "All five exact versions enter the pool without being selected."},
            }},
            {"name": "task_harness", "arguments": {"action": "inspect"}},
        ],
    )
    outputs = results(events, "task_harness")
    change = outputs[-2]
    assert not change.get("isError"), change
    receipt = json.loads(change["result"]["content"][0]["text"])
    assert receipt["activation"]["created_resource_refs"] == [
        "memory:door-hypothesis@v1", "skill:check-door@v1",
        "tool:select-door-state@v1", "subagent:door-counterexample-reviewer@v1",
        "system_prompt:door-safety-scope@v1",
    ]
    inspection = json.loads(outputs[-1]["result"]["content"][0]["text"])
    entries = {entry["resource_ref"]: entry for entry in inspection["component_pool"]}
    assert set(receipt["activation"]["created_resource_refs"]) <= entries.keys()
    assert all(entries[ref]["eligible"] for ref in receipt["activation"]["created_resource_refs"])
    assert not any(entries[ref]["selected"] for ref in receipt["activation"]["created_resource_refs"])
    assert records(tmp_path, "task-skills.jsonl")[-1]["authoring_status"] == "creator_authored_untested_candidate"
    for filename, creator in [("task-skills.jsonl", "skill-creator"),
                              ("task-tools.jsonl", "tool-creator"),
                              ("task-subagents.jsonl", "subagent-creator")]:
        assert records(tmp_path, filename)[-1]["authoring_method_ref"] == refs[creator]


def test_failed_change_intent_survives_and_success_is_not_mistaken_for_assembly(tmp_path):
    candidate = {"component": "skill", "name": "compare-options",
                 "description": "Use when choosing between bounded alternatives.",
                 "instructions": "Compare each alternative with current constraints; retain uncertainty."}
    decision = {"basis_refs": [], "reason": "Keep a pending planning method through repair.",
                "expected": "A versioned untested Skill enters the candidate pool."}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change",
            "changes": [{"operation": "create", "candidate": candidate}], "decision": decision}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert results(events, "task_harness")[0].get("isError")
    failed = json.loads(results(events, "task_harness")[1]["result"]["content"][0]["text"])
    intents = failed["conversion_intents"]
    assert len(intents) == 1 and intents[0]["status"] == "awaiting_parent_repair"
    assert intents[0]["retry"]["arguments"]["changes"][0]["candidate"]["name"] == "compare-options"

    # A fresh Pi parent process must recover the intent from the append-only pool.
    repaired = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change",
            "changes": [{"operation": "create", "candidate": candidate}], "decision": decision}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(repaired, "task_harness")
    assert any(item["status"] == "awaiting_parent_repair" for item in
               json.loads(outputs[0]["result"]["content"][0]["text"])["conversion_intents"])
    assert not outputs[2].get("isError"), outputs[2]
    inspected = json.loads(outputs[3]["result"]["content"][0]["text"])
    assert any(item["status"] == "applied_pending_assembly" and
               "skill:compare-options@v1" in item["resource_refs"]
               for item in inspected["conversion_intents"])
    assert not any(item["selected"] for item in inspected["component_pool"]
                   if item["resource_ref"] == "skill:compare-options@v1")


def test_inspect_preserves_multiple_legacy_research_conversion_intents(tmp_path):
    """Legacy research rows used operation_id before intent_id was added.

    Inspect must retain each candidate after a restart; indexing all rows under
    a missing/undefined intent_id would silently collapse the queue to one
    candidate and strand higher-order conversions.
    """
    rows = [
        {"format": "task-harness-conversion-intent-v1",
         "operation_id": "research:r1:method-a", "status": "awaiting_parent_authoring",
         "carrier": "skill", "candidate_ref": "method-a"},
        {"format": "task-harness-conversion-intent-v1",
         "operation_id": "research:r1:method-b", "status": "awaiting_parent_authoring",
         "carrier": "system_prompt", "candidate_ref": "method-b"},
    ]
    (tmp_path / "task-harness-conversion-intents.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    inspected = json.loads(results(events, "task_harness")[0]["result"]["content"][0]["text"])
    intents = inspected["conversion_intents"]
    assert [item["operation_id"] for item in intents] == [
        "research:r1:method-a", "research:r1:method-b",
    ]


def test_research_plan_candidate_gets_parent_authored_system_prompt_handoff():
    value = module_eval("pi_auto_research_output.ts", "m.buildParentAuthoringHandoffs({"
        "runId:'research-1',reportRef:'research_report:research-1@v1',report:{"
        "method_candidates:[{candidate_ref:'choose-route',name:'choose-route',"
        "semantic_kind:'plan',summary:'Plan under current constraints',"
        "method:{applicability:'a goal and constraints are known',steps:['compare alternatives']}}]}})")
    assert len(value) == 1
    handoff = value[0]
    assert handoff["recommended_component_kind"] == "system_prompt"
    assert handoff["authoring_contract"]["owner"] == "parent_agent"
    assert handoff["authoring_contract"]["creator_read_required"] is False
    assert handoff["change_call_template"]["executable"] is False
    assert "candidate" not in handoff["change_call_template"]["arguments"]["changes"][0]
    assert "scope" in handoff["authoring_contract"]["required_parent_authored_fields"]


def test_optional_method_metadata_is_preserved_but_malformed_types_are_rejected(tmp_path):
    method_ref = module_eval(
        "pi_harness_baseline_methods.ts",
        "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref",
    )
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                "component": "skill", "name": "typed-method",
                "description": "Use for one bounded comparison.",
                "instructions": "Compare the two supplied states and report the changed field.",
                "method": {"applicability": "two states are available", "steps": {"bad": "shape"}},
                "authoring_method_ref": method_ref,
            }}], "decision": {"basis_refs": [], "reason": "Reject malformed optional metadata.",
                              "expected": "No component is persisted."}}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                "component": "skill", "name": "typed-method",
                "description": "Use for one bounded comparison.",
                "instructions": "Compare the two supplied states and report the changed field.",
                "method": {"applicability": "two states are available", "steps": ["compare fields"]},
                "authoring_method_ref": method_ref,
            }}], "decision": {"basis_refs": [], "reason": "Keep valid authored optional metadata.",
                              "expected": "The untested skill enters the pool."}}},
    ])
    outputs = results(events, "task_harness")
    assert outputs[-2].get("isError") and "delivery.method.steps" in json.dumps(outputs[-2])
    assert not outputs[-1].get("isError"), outputs[-1]
    rows = records(tmp_path, "task-skills.jsonl")
    assert len(rows) == 1
    assert rows[0]["method"] == {
        "applicability": "two states are available", "steps": ["compare fields"],
    }
