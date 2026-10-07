"""Minimal admission diagnostics, not real-provider acceptance."""
import json

from test_harness_capability_authoring import module_eval
from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results
from pathlib import Path

from test_task_research_context import _pi_cli, _run_fixture as _research_fixture


def test_partial_research_method_reaches_parent_without_quality_gate():
    report = {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "An untested procedure is available.",
        "method_candidates": [{"candidate_ref": "partial", "name": "bounded-check",
            "semantic_kind": "procedure", "summary": "Compare inputs before choosing.",
            "method": {"steps": ["Compare the supplied inputs; report ambiguity."]}}],
    }
    result = module_eval("pi_auto_research_output.ts",
        f"m.buildParentAuthoringHandoffs({{runId:'partial',reportRef:'research_report:partial@v1',report:{json.dumps(report)}}})")
    assert len(result) == 1
    assert result[0]["recommended_component_kind"] == "skill"
    assert result[0]["status"] == "awaiting_parent_authoring"
    assert result[0]["quality_advisory"]["documentation_complete"] is False
    assert result[0]["quality_advisory"]["documentation_gaps"]
    assert "missing_input" in result[0]["quality_advisory"]["documentation_gaps"]
    assert "promotable" not in result[0]["quality_advisory"]
    assert result[0]["authoring_contract"]["owner"] == "parent_agent"
    lifecycle = module_eval("pi_research_method_runtime.ts",
        f"m.methodRecordsFromReport({{runId:'partial',reportRef:'research_report:partial@v1',report:{json.dumps(report)}}})")
    assert lifecycle[0]["promotion_eligibility"] == "eligible"
    assert lifecycle[0]["maturity"] == "candidate_method"
    assert lifecycle[0]["grounding_status"] == "ungrounded"
    assert "missing_input" in lifecycle[0]["method_abstraction"]["documentation_gaps"]


def test_child_can_submit_partial_untested_method_through_native_tool(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    report = {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "A tentative local comparison may help.",
        "findings": [], "evidence_refs": [], "alternatives": [],
        "limitations": ["Untested method."], "validation_plan": "Parent may test it.",
        "method_candidates": [{
            "candidate_ref": "partial", "name": "local-comparison",
            "semantic_kind": "procedure", "summary": "Compare the next two observations.",
            "basis_refs": [], "method": {"steps": "Compare the next two observations."},
        }],
    }
    events = _research_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Can a tentative local comparison help?",
            "complexity_assessment": {"level": "simple", "rationale": "One candidate."},
        }}])
    result = results(events, "auto_research")[0]
    assert not result.get("isError"), result
    saved = records(tmp_path, "auto-research-reports.jsonl")[-1]["report"]
    assert saved["method_candidates"][0]["method"]["steps"] == ["Compare the next two observations."]
    assert "missing_problem" in saved["method_candidates"][0]["quality_advisory"]["documentation_gaps"]
    assert "promotable" not in saved["method_candidates"][0]["quality_advisory"]


def test_v2_shaped_report_keeps_method_when_optional_confidence_is_unparsed(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    confidence = {"assessment": "tentative", "why": "The first comparison looked promising"}
    report = {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "A bounded comparison procedure may transfer.",
        "findings": [{"subject_kind": "research_method", "question": "What changed?",
                      "conclusion": "Compare the two public states", "evidence_refs": ["execution-observation-1"],
                      "uncertainty": "Untested on another state"}],
        "alternatives": ["The change may be incidental"], "limitations": ["One context only"],
        "validation_plan": "Parent trials the method on a later state",
        "confidence_update": confidence,
        "method_candidates": [{"candidate_ref": "compare-delta", "name": "compare-delta",
                               "semantic_kind": "procedure", "summary": "Compare public deltas",
                               "basis_refs": ["execution-observation-1"],
                               "method": {"steps": ["Compare two public states and retain uncertainty."]}}],
    }
    events = _research_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Can a bounded comparison transfer?",
            "complexity_assessment": {"level": "simple", "rationale": "One method candidate"},
        }}])
    result = results(events, "auto_research")[0]
    assert not result.get("isError"), result
    saved = records(tmp_path, "auto-research-reports.jsonl")[-1]["report"]
    assert saved["evidence_refs"] == []
    assert saved["method_candidates"][0]["candidate_ref"] == "compare-delta"
    assert "confidence_update" not in saved
    assert saved["confidence_update_unparsed"]["raw"] == confidence
    assert saved["warnings"][0]["code"] == "confidence_update_not_applied"
    assert records(tmp_path, "parent-authoring-handoffs.jsonl")[-1]["source"]["method_ref"]
    assert "confidence_update_not_applied" in json.dumps(result)


def test_invalid_confidence_increase_without_evidence_does_not_gain_status():
    report = {"format": "auto-research-report-v1", "status": "provisional",
              "conclusion": "A possible method", "findings": [], "evidence_refs": [],
              "confidence_update": {"disposition": "increase", "basis": "new_environment_evidence",
                                    "evidence_refs": []}}
    value = module_eval("pi_auto_research_output.ts",
        "m.normalizeAutoResearchReport(" + json.dumps(report) + ")")
    assert "confidence_update" not in value
    assert value["confidence_update_unparsed"]["raw"] == report["confidence_update"]
    assert "requires cited evidence_refs" in value["warnings"][0]["message"]
    capsule = module_eval("pi_auto_research_output.ts",
        "m.buildAutoResearchCapsule({runId:'invalid-confidence',sessionRef:'research_session:s1@v1',"
        "status:'completed',scope:'hypothesis',reportRef:'research_report:invalid-confidence@v1',"
        "report:" + json.dumps(value) + "})")
    assert "confidence_update" not in capsule
    assert capsule["warnings"][0]["code"] == "confidence_update_not_applied"


def test_review_guidance_does_not_require_method_dossier():
    contract = module_eval("pi_harness_review.ts", "m.reviewInputContract()")
    text = " ".join(contract["rules"])
    assert "Nested method metadata is optional" in text
    assert "require both creator-authored instructions/content and nested method" not in text


def test_change_normalizer_defaults_only_unambiguous_candidate_to_create():
    candidate = {"type": "memory", "name": "route", "content": "The route is open",
                 "atom": {"subject": "route", "predicate": "state", "value": "open"}}
    value = module_eval("pi_harness_protocol.ts",
        "m.normalizeHarnessChange(" + json.dumps({"candidate": candidate}) + ")")
    assert value == {"operation": "create", "candidate": candidate}
    for extra in ({"target_ref": "memory:route@v1"}, {"candidate_ref": "research_candidate:route@v1"},
                  {"update": True}, {"candidate": {**candidate, "target_version": 1}}):
        entry = {"candidate": candidate, **extra}
        error = module_eval("pi_harness_protocol.ts",
            "(()=>{try{m.normalizeHarnessChange(" + json.dumps(entry) + ");return null}catch(e){return e.message}})()")
        assert "operation" in error


def test_updating_memory_with_redundant_self_supersedes_keeps_later_prompt_change(tmp_path):
    decision = {"basis_refs": [], "reason": "Revise a fact and the solving policy together",
                "expected": "Both exact versions enter the pool"}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{
            "operation": "create", "candidate": {"semantic_kind": "memory", "key": "toggle",
                "validity": {"scope": "task"},
                "atom": {"subject": "tile", "predicate": "state", "value": "8"}}}],
            "decision": decision}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [
            {"operation": "update", "candidate": {"semantic_kind": "memory", "key": "toggle",
                "validity": {"scope": "task"},
                "atom": {"subject": "tile", "predicate": "state", "value": "12"},
                "supersedes_refs": ["memory:toggle@v1"]}},
            {"operation": "create", "candidate": {"semantic_kind": "system_prompt",
                "name": "solve-policy", "scope": "task",
                "content": "Recheck the colour on each new level."}}], "decision": decision}},
    ])
    changes = results(events, "task_harness")
    assert not any(item.get("isError") for item in changes), changes
    receipt = json.loads(changes[-1]["result"]["content"][0]["text"])
    assert [item["native_tool"] for item in receipt["results"]] == ["task_memory", "task_system_prompt"]
    assert records(tmp_path, "task-memory.jsonl")[-1]["version"] == 2
    assert records(tmp_path, "task-system-prompt.jsonl")[-1]["version"] == 1


def test_change_without_wrapper_decision_routes_complete_tool_candidate(tmp_path):
    candidate = {"semantic_kind": "tool", "name": "row-count", "description": "Count rows",
                 "input_schema": {"type": "object"}, "output_schema": {"type": "number"},
                 "program": {"format": "task-pure-expression-v1", "limits": {},
                             "expression": {"op": "length", "value": {"op": "input"}}}}
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[Path(__file__).resolve().parents[1] / "tests" / "pi_task_tool_fixture.ts"], steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create", "candidate": candidate}]}},
    ])
    output = results(events, "task_harness")[-1]
    assert not output.get("isError"), output
    receipt = json.loads(output["result"]["content"][0]["text"])
    assert receipt["status"] == "applied"
    assert receipt["results"][0]["native_tool"] == "task_tool"
    assert records(tmp_path, "task-tools.jsonl")[-1]["name"] == "row-count"


def test_native_change_schema_accepts_second_new_memory_without_operation(tmp_path):
    def memory(name):
        return {"type": "memory", "name": name, "content": f"{name} is open",
                "atom": {"subject": name, "predicate": "state", "value": "open"},
                "validity": {"scope": "task"}}

    decision = {"basis_refs": [], "reason": "Persist two distinct observed routes",
                "expected": "Two memory versions enter the pool"}
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_harness", "arguments": {"action": "change",
            "changes": [{"operation": "create", "candidate": memory("first-route")},
                        {"candidate": memory("second-route")}],
            "decision": decision}},
        {"name": "task_harness", "arguments": {"action": "change",
            "changes": [{"candidate": memory("second-route")}], "decision": decision}}])
    change, collision = results(events, "task_harness")
    assert not change.get("isError"), change
    assert collision.get("isError")
    assert "already exists: second-route" in collision["result"]["content"][0]["text"]
    assert [row["key"] for row in records(tmp_path, "task-memory.jsonl")] == [
        "first-route", "second-route"]
    assert records(tmp_path, "task-harness-change-requests.jsonl")[0]["changes"][1]["operation"] == "create"


def test_ambiguous_assessment_returns_choices_without_recording_verdict(tmp_path):
    for filename, rows in {
        "harness-decisions.jsonl": [{"decision_id": f"decision-{i}", "operation": "create"} for i in (1, 2)],
        "harness-observations.jsonl": [{"decision_id": f"decision-{i}", "observation_id": f"exposure-{i}"} for i in (1, 2)],
    }.items():
        (tmp_path / filename).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_harness", "arguments": {"action": "assess_effect", "verdict": "inconclusive",
            "consequence": "No demonstrated utility yet."}}])
    end = results(events, "task_harness")[-1]
    assert not end.get("isError")
    receipt = json.loads(end["result"]["content"][0]["text"])
    assert receipt["status"] == "selection_required" and receipt["applied"] is False
    assert [x["retry"]["decision_id"] for x in receipt["candidates"]] == ["decision-1", "decision-2"]
    assert not records(tmp_path, "effect-assessments.jsonl")


def test_unstarted_research_survives_elapsed_time_and_unrelated_control_calls(tmp_path):
    extension = Path(__file__).resolve().parents[1] / "tests/pi_periodic_review_fixture.ts"
    handoff = {"handoff_id": "research-waiting", "version": 1, "status": "proposed",
               "recordedAt": "2000-01-01T00:00:00.000Z"}
    (tmp_path / "auto-research-handoffs.jsonl").write_text(json.dumps(handoff) + "\n", encoding="utf-8")
    # Old logs charged unrelated management calls to the pending research.
    events = [{"target": "research-waiting", "event": "attempt", "recordedAt": "2001-01-01T00:00:00.000Z"}
              for _ in range(12)]
    (tmp_path / "task-harness-control-events.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in events), encoding="utf-8")
    observed = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "methods"}},
    ])
    assert not any(row.get("isError") for row in results(observed, "task_harness"))
    assert records(tmp_path, "auto-research-handoffs.jsonl")[-1]["status"] == "proposed"
    assert len(records(tmp_path, "auto-research-handoffs.jsonl")) == 1
    inspection = json.loads(results(observed, "task_harness")[0]["result"]["content"][0]["text"])
    assert inspection["control_policy"]["scope"] == "periodic_review_only"
    assert inspection["control_policy"]["elapsed_ms"] is None
