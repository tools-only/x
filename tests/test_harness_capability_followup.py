"""Native Pi diagnostics; not real-provider ARC quality acceptance."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


def test_retired_memory_receipt_does_not_offer_selection_or_use(tmp_path):
    decision = {"basis_refs": [], "reason": "The old map is obsolete.",
                "expected": "Retain provenance without suggesting obsolete guidance."}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change", "decision": decision,
            "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "memory", "name": "old-map",
                "content": "The observed corridor opens north.",
                "atom": {"subject": "corridor", "predicate": "exit", "value": "north"},
                "validity": {"scope": "task"},
            }}]}},
        {"name": "task_harness", "arguments": {
            "action": "change", "decision": decision,
            "changes": [{"operation": "retire", "target_ref": "memory:old-map@v1"}]}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 2
    assert not any(item.get("isError") for item in outputs), outputs
    active = json.loads(outputs[0]["result"]["content"][0]["text"])
    assert active["activation"]["created_resources"][0]["selection_call"] is not None
    retired = json.loads(outputs[1]["result"]["content"][0]["text"])
    entry = retired["activation"]["created_resources"][0]
    assert entry["resource_ref"] == "memory:old-map@v2"
    assert entry["selection_call"] is None
    assert entry["use_after_selection"] is None
    assert entry["eligible"] is False
    assert entry["reasons"]


def test_omitted_capabilities_survive_research_deferral_and_parent_restart(tmp_path):
    project = Path(__file__).resolve().parents[1]
    extension = project / "tests/pi_periodic_review_fixture.ts"
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        *[{"name": "arc_action", "arguments": {}}] * 5,
        {"name": "task_harness", "arguments": {
            "action": "review", "review": [], "transition_analysis": {
                "observed_changes": "No reliable movement evidence",
                "predictive_rules": "Unknown",
                "limiting_uncertainty": "Need an input parser",
                "next_experiment": "Check parser output against raw input",
                "capability_opportunities": "A decode-plan-verify procedure",
                "evidence_refs": ["execution-observation-1"],
            }}},
        {"name": "task_harness", "arguments": {
            "action": "decide_research", "research_decision": "defer",
            "research_reason": "Parent can author directly; no research required"}},
    ])
    assert not any(e.get("isError") for e in events if e.get("type") == "tool_execution_end")
    resumed = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "harness-opportunity-1",
            "review": []}},
        {"name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "harness-opportunity-1",
            "review": [{"component": c, "disposition": "reuse",
                        "resource_refs": [f"{c}:missing@v1"], "reason": "Attempt nonexistent reuse"}
                       for c in ["skill", "tool", "subagent"]]}},
        {"name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "harness-opportunity-1",
            "review": [{"component": c, "disposition": "defer",
                        "reason": "Need raw input; reconsider after the next observation"}
                       for c in ["skill", "tool", "subagent"]]}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    ends = [e for e in resumed if e.get("type") == "tool_execution_end"]
    assert [bool(e.get("isError")) for e in ends] == [False, False, True, False, False]
    empty = json.loads(ends[1]["result"]["content"][0]["text"])
    assert empty["status"] == "no_decision_submitted" and empty["applied"] is False
    before = json.loads(ends[0]["result"]["content"][0]["text"])
    after = json.loads(ends[-1]["result"]["content"][0]["text"])
    assert before["capability_followups"][0]["research_required"] is False
    assert before["capability_followups"][0]["components"] == ["skill", "tool", "subagent"]
    carriers = before["capability_followups"][0]["carrier_candidates"]
    assert [item["component"] for item in carriers] == ["skill", "tool", "subagent"]
    assert [item["creator_read_call"]["arguments"]["method_name"] for item in carriers] == [
        "skill-creator", "tool-creator", "subagent-creator",
    ]
    assert all(item["inspect_call"] == {"tool": "task_harness", "arguments": {"action": "inspect"}}
               for item in carriers)
    defer_receipt = json.loads(ends[3]["result"]["content"][0]["text"])
    assert [item["disposition"] for item in defer_receipt["carrier_preparation"]] == ["defer"] * 3
    assert [item["creator_read_call"]["arguments"]["method_name"]
            for item in defer_receipt["carrier_preparation"]] == [
        "skill-creator", "tool-creator", "subagent-creator",
    ]
    assert after["capability_followups"] == []
    contexts = (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8")
    assert "Pending parent capability decisions" in contexts
    expected = (project / "demo/prompts/capability_extraction_process.md").read_text(encoding="utf-8")
    delivered = [part["text"] for row in records(tmp_path, "provider-contexts.jsonl")
                 for message in row["context"]["messages"]
                 for part in message.get("content", []) if part.get("type") == "text"]
    assert expected not in delivered
    assert any(text.startswith("Capability workflow reference:") for text in delivered)
    assert not (tmp_path / "task-skills.jsonl").exists()
    assert not (tmp_path / "auto-research-sessions.jsonl").exists()


def test_parent_context_indexes_old_followups_and_details_recent_opportunities(tmp_path):
    reviews = []
    for number in range(1, 10):
        review = {
            "opportunity_id": f"op-{number}", "review_id": f"review-{number}",
            "transition_analysis": {
                "capability_opportunities": f"Develop operation {number}",
                "evidence_refs": [f"observation-{number}"],
            },
            "entries": [],
        }
        if number <= 3:
            review["development_intent"] = {
                "operation_id": f"old-intent-{number}", "status": "open",
                "purpose": f"Continue old operation {number}",
            }
        reviews.append(review)
    (tmp_path / "task-harness-reviews.jsonl").write_text(
        "".join(json.dumps(review) + "\n" for review in reviews), encoding="utf-8")

    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    messages = [part["text"] for message in context["messages"]
                for part in message.get("content", []) if part.get("type") == "text"]
    prefix = "Pending parent capability decisions ("
    projected = next(text for text in messages if text.startswith(prefix))
    payload = json.loads(projected.split(": ", 1)[1])

    assert [item["opportunity_id"] for item in payload["index"]] == [f"op-{n}" for n in range(1, 10)]
    assert payload["omitted_index_count"] == 0
    assert [item["opportunity_id"] for item in payload["details"]] == ["op-9", "op-8", "op-3"]
    assert payload["full_directory_call"] == {
        "tool": "task_harness", "arguments": {"action": "inspect"},
        "result_field": "capability_followups",
    }
    exposure = records(tmp_path, "task-harness-context-exposures.jsonl")[-1]
    descriptor = next(item for item in exposure["guidance_exposures"]
                      if item["name"] == "pending_parent_capability_decisions")
    from hashlib import sha256
    assert descriptor["sha256"] == sha256(projected.encode()).hexdigest()
    assert descriptor["chars"] == len(projected)
    assert not (tmp_path / "task-capability-decisions.jsonl").exists()
    assert not (tmp_path / "task-skills.jsonl").exists()


def test_parent_capability_index_stays_bounded_for_long_runs():
    from test_harness_capability_authoring import module_eval

    projected = module_eval("pi_harness_capability_followup.ts",
                            "m.projectCapabilityFollowupQueue(Array.from({length:100}, (_,i)=>({"
                            "opportunity_id:`op-${i+1}`, status:'awaiting_parent_capability_decision',"
                            "components:['skill'], carrier_candidates:[], opportunity:'A'.repeat(2000)})))")
    payload = json.loads(projected.split(": ", 1)[1])

    assert len(payload["index"]) == 24
    assert [item["opportunity_id"] for item in payload["index"][:3]] == ["op-1", "op-2", "op-3"]
    assert [item["opportunity_id"] for item in payload["details"][:2]] == ["op-100", "op-99"]
    assert payload["omitted_index_count"] == 76
    assert payload["full_directory_call"]["arguments"] == {"action": "inspect"}
    assert "A" * 2000 not in json.dumps(payload["index"])


def test_research_authoring_handoff_survives_later_context_and_parent_deferral(tmp_path):
    from test_context_continuity import _message, _project_context, _texts

    method_ref = "method:method-research-1@v1"
    handoff = {
        "handoff_id": "research-1-skill", "version": 1,
        "resource_ref": "authoring_handoff:research-1-skill@v1",
        "status": "awaiting_parent_authoring", "recommended_component_kind": "skill",
        "candidate_summary": "Compare a widget display with inert siblings to infer a target.",
        "source": {"method_ref": method_ref, "report_ref": "research_report:research-1@v1"},
        "creator": {"read_call": {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "skill-creator", "expected_sha256": "fixture-sha"}}},
    }
    (tmp_path / "parent-authoring-handoffs.jsonl").write_text(
        json.dumps(handoff) + "\n", encoding="utf-8")
    old_reviews = [{"opportunity_id": f"old-{n}", "review_id": f"old-review-{n}",
                    "transition_analysis": {"capability_opportunities": f"Old opportunity {n}"}}
                   for n in range(1, 4)]
    (tmp_path / "task-harness-reviews.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in old_reviews), encoding="utf-8")

    _run_fixture(tmp_path, "treatment", steps=[])
    _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    provider = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    texts = [part["text"] for message in provider["messages"]
             for part in message.get("content", []) if part.get("type") == "text"]
    direct = next(text for text in texts if text.startswith("RESEARCH METHOD CANDIDATES FOR PARENT DECISION"))
    assert method_ref in direct
    assert '"method_name":"skill-creator"' in direct
    assert '"expected_sha256":"fixture-sha"' in direct
    assert "smallest executable version" in direct
    assert "report completion is adoption" in direct
    projected = next(text for text in texts if text.startswith("Pending parent capability decisions ("))
    queue = json.loads(projected.split(": ", 1)[1])
    assert queue["details"][0]["opportunity_id"] == "parent-authoring:research-1-skill"
    assert queue["details"][0]["components"] == ["skill"]
    assert queue["details"][0]["research_authoring_handoff"]["method_ref"] == method_ref
    assert queue["index"][0]["opportunity_id"] == "old-1"
    assert "parent-authoring:research-1-skill" in [item["opportunity_id"] for item in queue["index"]]
    compacted = _project_context(
        tmp_path, [_message("initial task"), _message(projected),
                   *[_message("older transcript " + "x" * 900, "assistant") for _ in range(8)],
                   _message("current action")],
        maxChars=8_000, maxMessageChars=600, keepRecentMessages=2, headMessages=1,
    )
    assert projected in _texts(compacted)
    inspected = json.loads(results(_run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ]), "task_harness")[0]["result"]["content"][0]["text"])
    assert inspected["parent_authoring_handoffs"][0]["handoff_id"] == "research-1-skill"

    _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "parent-authoring:research-1-skill",
            "review": [{"component": "skill", "disposition": "defer",
                        "reason": "Wait for another widget before authoring this procedure."}],
        },
    }])
    _run_fixture(tmp_path, "treatment", steps=[])
    final_texts = [part["text"] for message in records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["messages"]
                   for part in message.get("content", []) if part.get("type") == "text"]
    final_queue = json.loads(next(text for text in final_texts
                                  if text.startswith("Pending parent capability decisions (")).split(": ", 1)[1])
    assert "parent-authoring:research-1-skill" not in [item["opportunity_id"] for item in final_queue["index"]]
    assert not (tmp_path / "task-skills.jsonl").exists()


def test_minimal_parent_skill_closes_exact_research_handoff_without_method_metadata(tmp_path):
    from test_harness_capability_authoring import module_eval

    creator_ref = module_eval("pi_harness_baseline_methods.ts",
                              "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    method_ref = "method:method-research-1@v1"
    (tmp_path / "task-method-lifecycle.jsonl").write_text(json.dumps({
        "format": "task-method-lifecycle-v1", "method_id": "method-research-1",
        "version": 1, "status": "active", "name": "target inference",
    }) + "\n", encoding="utf-8")
    (tmp_path / "parent-authoring-handoffs.jsonl").write_text(json.dumps({
        "handoff_id": "research-1-skill", "version": 1,
        "status": "awaiting_parent_authoring", "recommended_component_kind": "tool",
        "source": {"method_ref": method_ref},
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{
            "operation": "create", "candidate": {
                "semantic_kind": "skill", "name": "target-check",
                "description": "Use when a widget shows a compact target display.",
                "instructions": "Compare the display with inert siblings; stop if their mapping conflicts.",
                "authoring_method_ref": creator_ref,
            },
        }], "decision": {"basis_refs": [method_ref],
                       "reason": "Parent authored a scoped target check from the research candidate.",
                       "expected": "The skill enters the pool for a later trial."}}},
    ])
    assert not any(item.get("isError") for item in results(events, "task_harness"))
    handoffs = records(tmp_path, "parent-authoring-handoffs.jsonl")
    assert [item["status"] for item in handoffs] == ["awaiting_parent_authoring", "authored"]
    assert handoffs[-1]["version"] == 2
    assert handoffs[-1]["resource_ref"] == "authoring_handoff:research-1-skill@v2"
    assert handoffs[-1]["component_ref"] == "skill:target-check@v1"
    assert not any(item.get("author") == "parent" for item in records(tmp_path, "task-method-lifecycle.jsonl"))
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()


def test_inspect_lists_old_research_authoring_handoffs_beyond_context_index(tmp_path):
    handoffs = [{"handoff_id": f"handoff-{n}", "version": 1,
                 "status": "awaiting_parent_authoring", "recommended_component_kind": "skill",
                 "candidate_summary": f"Procedure {n}"} for n in range(1, 31)]
    (tmp_path / "parent-authoring-handoffs.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in handoffs), encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    inspected = json.loads(results(events, "task_harness")[0]["result"]["content"][0]["text"])
    assert len(inspected["parent_authoring_handoffs"]) == 30
    assert inspected["parent_authoring_handoffs"][0]["handoff_id"] == "handoff-1"
    assert len(inspected["capability_followups"]) == 30
    provider = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    projected = next(part["text"] for message in provider["messages"]
                     for part in message.get("content", [])
                     if part.get("text", "").startswith("Pending parent capability decisions ("))
    queue = json.loads(projected.split(": ", 1)[1])
    assert len(queue["index"]) == 24
    assert queue["omitted_index_count"] == 6
    assert queue["full_directory_call"]["result_field"] == "capability_followups"


def test_unselected_authored_capability_names_selection_use_entrypoint_and_last_failure(tmp_path):
    from test_harness_capability_authoring import module_eval, procedure
    method_ref = module_eval("pi_harness_baseline_methods.ts",
                             "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "skill", "name": "bounded-check",
                "description": "Use when comparing two public outputs.",
                "authoring_method_ref": method_ref,
                "content": "Inspect the input, compare alternatives, and stop on ambiguity.",
                "method": procedure(),
            }}], "decision": {"basis_refs": [], "reason": "Prepare a bounded check.",
                                  "expected": "The skill is available for selection."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:bounded-check@v1"],
            "prompt_contributions": [{"contribution_id": "bad-layer", "source_ref": "skill:bounded-check@v1",
                                      "layer": "strategy", "content": "Use the check."}],
            "decision": {"basis_refs": [], "reason": "Attempt selection.", "expected": "Reject invalid layer."},
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(events, "task_harness")
    assert not outputs[0].get("isError") and not outputs[1].get("isError")
    assert outputs[2].get("isError") and not outputs[3].get("isError")
    change = json.loads(outputs[1]["result"]["content"][0]["text"])
    created = change["activation"]["created_resources"][0]
    assert created["resource_ref"] == "skill:bounded-check@v1"
    assert created["use_after_selection"]["load_if_needed"]["tool"] == "read"
    assert created["use_after_selection"]["load_if_needed"]["arguments"] == {
        "path": str(tmp_path / "task-harness" / "skills" / "bounded-check" / "SKILL.md"),
    }
    context_rows = records(tmp_path, "provider-contexts.jsonl")
    context_text = "\n".join(part.get("text", "") for row in context_rows
                             for message in row["context"]["messages"]
                             for part in message.get("content", []) if isinstance(part, dict))
    assert 'Authored capabilities awaiting parent selection' in context_text
    assert '"selection_call"' in context_text
    assert '"use_after_selection"' in context_text
    assert '"last_failure"' in context_text
    assert 'task-harness-assembly-input-error-v1' in context_text


def test_capability_review_can_decide_one_carrier_without_dropping_others(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1",
        "transition_analysis": {"capability_opportunities": "Parse one structured input", "evidence_refs": ["o1"]},
        "entries": [],
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "capability_review", "opportunity_id": "op-1",
            "review": [{"component": "skill", "disposition": "defer",
                        "reason": "Reconsider when a second manual procedure occurs"}]}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "capability_review", "opportunity_id": "op-1",
            "review": [{"component": "tool", "disposition": "defer",
                        "reason": "Missing a disclosed parser primitive; reconsider if the substrate expands"}]}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    ends = results(events, "task_harness")
    assert not any(item.get("isError") for item in ends)
    first = json.loads(ends[1]["result"]["content"][0]["text"])["capability_followups"][0]
    second = json.loads(ends[3]["result"]["content"][0]["text"])["capability_followups"][0]
    assert first["components"] == ["tool", "subagent"]
    assert second["components"] == ["subagent"]


def test_open_planning_intent_survives_settled_carriers_and_unrelated_resolution(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1",
        "transition_analysis": {"capability_opportunities": "A locator exists; approach selection remains open.",
                                "evidence_refs": ["execution-observation-1"]},
        "entries": [],
    }) + "\n", encoding="utf-8")
    settled = [{"component": component, "disposition": "defer",
                "reason": "No additional carrier work is needed for this operation."}
               for component in ["skill", "tool", "subagent"]]
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "op-1", "review": settled,
            "development_intent": {"operation_id": "choose-feasible-approach", "status": "open",
                "purpose": "Compose localization and terrain constraints to choose a reachable goal approach.",
                "next_step": "Compare feasible alternatives and select a discriminating probe."}}},
        {"name": "task_harness", "arguments": {
            "action": "capability_review", "opportunity_id": "op-1", "review": [],
            "development_intent": {"operation_id": "locate-moving-object", "status": "resolved",
                "purpose": "Reuse the existing perception operation for localization.",
                "resource_refs": ["skill:grid-delta-probe@v1"]}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(events, "task_harness")
    assert not any(item.get("isError") for item in outputs), outputs
    followups = json.loads(outputs[-1]["result"]["content"][0]["text"])["capability_followups"]
    assert len(followups) == 1
    assert followups[0]["components"] == []
    assert followups[0]["development_intents"] == [{
        "operation_id": "choose-feasible-approach", "status": "open",
        "purpose": "Compose localization and terrain constraints to choose a reachable goal approach.",
        "next_step": "Compare feasible alternatives and select a discriminating probe.",
    }]


def test_failed_initial_review_draft_preserves_parent_planning_intent(tmp_path):
    project = Path(__file__).resolve().parents[1]
    extension = project / "tests" / "pi_periodic_review_fixture.ts"
    transition = {
        "observed_changes": "The fixture action completed without a state delta.",
        "predictive_rules": "Unknown until the output can be compared.",
        "limiting_uncertainty": "No structured comparator exists.",
        "next_experiment": "Compare two fixture outputs with a bounded checker.",
        "capability_opportunities": "Author a bounded output comparison procedure.",
        "evidence_refs": ["execution-observation-1"],
    }
    invalid = {"name": "task_harness", "arguments": {
        "action": "review", "opportunity_id": "harness-opportunity-1",
        "review": [{"component": "skill", "disposition": "create", "reason": "A checker is useful.",
                    "candidate": {"name": "bad-draft", "instructions": "Incomplete."}}],
        "transition_analysis": transition,
        "development_intent": {"operation_id": "compose-route-strategy", "status": "open",
            "purpose": "Combine object location, barriers and the goal into a route choice.",
            "next_step": "Compare the feasible alternatives."},
    }}
    events = _run_fixture(tmp_path, "treatment", steps=[
        *[{"name": "arc_action", "arguments": {}}] * 5,
        invalid, invalid, invalid,
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ], extra_extensions=[extension])
    outputs = results(events, "task_harness")
    assert outputs[0].get("isError")
    status = json.loads(outputs[-1]["result"]["content"][0]["text"])
    intents = status["review_drafts"][0]["development_intents"]
    assert intents[0]["operation_id"] == "compose-route-strategy"
    assert status["capability_followups"][0]["development_intents"] == intents


def test_nonperiodic_review_can_record_intent_without_transition_analysis(tmp_path):
    (tmp_path / "task-harness-opportunities.jsonl").write_text(json.dumps({
        "opportunity_id": "op-anytime",
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "review", "opportunity_id": "op-anytime", "review": [],
            "development_intent": {"operation_id": "plan-around-barrier", "status": "open",
                "purpose": "Find an approach to the target that respects the observed barrier.",
                "reason": "The locator describes position but not reachability."}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = results(events, "task_harness")
    assert not any(item.get("isError") for item in outputs), outputs
    committed = records(tmp_path, "task-harness-reviews.jsonl")[-1]
    assert "transition_analysis" not in committed
    status = json.loads(outputs[-1]["result"]["content"][0]["text"])
    assert status["capability_followups"][0]["development_intents"][0]["operation_id"] == "plan-around-barrier"


def test_failed_review_window_keeps_draft_capability_followup_readable(tmp_path):
    project = Path(__file__).resolve().parents[1]
    extension = project / "tests/pi_periodic_review_fixture.ts"
    transition = {
        "observed_changes": "The fixture action completed without a state delta.",
        "predictive_rules": "Unknown until the output can be compared.",
        "limiting_uncertainty": "No structured comparator exists.",
        "next_experiment": "Compare two fixture outputs with a bounded checker.",
        "capability_opportunities": "Author a bounded output comparison procedure.",
        "evidence_refs": ["execution-observation-1"],
    }
    invalid = {"name": "task_harness", "arguments": {
        "action": "review", "opportunity_id": "harness-opportunity-1",
        "review": [{"component": "skill", "disposition": "create", "reason": "A checker is useful.",
                    "candidate": {"name": "bounded-check", "instructions": "Compare two outputs."}}],
        "transition_analysis": transition,
    }}
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        *[{"name": "arc_action", "arguments": {}}] * 5, invalid, invalid, invalid,
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    review_ends = [item for item in results(events, "task_harness")
                   if item.get("args", {}).get("action") == "review"]
    assert all(item.get("isError") for item in review_ends)
    status = json.loads(results(events, "task_harness")[-1]["result"]["content"][0]["text"])
    assert status["pending_pattern_extraction"] is None
    assert status["review_drafts"][0]["status"] == "invalid"
    assert status["review_drafts"][0]["transition_analysis"]["capability_opportunities"].startswith("Author")
    assert status["capability_followups"][0]["opportunity_id"] == "harness-opportunity-1"
    # The parent can recover the preserved body even after the review window dies.
    retry = status["review_drafts"][0]["direct_change_fallback"]
    assert retry["changes"][0]["candidate"]["instructions"] == "Compare two outputs."
    assert retry["changes"][0]["candidate"]["component"] == "skill"
    retry.pop("instruction")
    retry["changes"][0]["candidate"]["description"] = "Use when comparing two outputs."
    retry["decision"] = {"basis_refs": [], "reason": "The comparison remains useful after window expiry.",
                         "expected": "An untested comparison skill enters the candidate pool."}
    resumed = _run_fixture(tmp_path, "treatment", extra_extensions=[extension], steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": retry},
    ])
    outcome = results(resumed, "task_harness")[-1]
    assert not outcome.get("isError"), outcome
    receipt = json.loads(outcome["result"]["content"][0]["text"])
    assert receipt["activation"]["created_resource_refs"] == ["skill:bounded-check@v1"]
