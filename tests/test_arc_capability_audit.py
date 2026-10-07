import importlib.util
import json
from pathlib import Path


def audit(root):
    path = Path(__file__).resolve().parents[1] / "tools/arc_capability_audit.py"
    spec = importlib.util.spec_from_file_location("capability_audit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.audit_run(root)


def write(root, filename, rows):
    (root / filename).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_created_read_and_invoked_are_not_capability_acceptance(tmp_path):
    write(tmp_path, "task-skills.jsonl", [
        {"name": "procedure", "version": 1, "status": "active"},
        {"name": "procedure", "version": 2, "status": "active"},
    ])
    write(tmp_path, "task-skill-events.jsonl", [{"event": "read", "name": "procedure"}])
    write(tmp_path, "task-tool-events.jsonl", [
        {"event": "invoked", "name": "helper", "version": 1, "status": "completed",
         "input": {"x": 1}, "output_excerpt": "2", "semantic_effect_observed": True},
    ])
    report = audit(tmp_path)
    assert report["resources"]["skills"]["unique_names"] == 1
    assert report["tool_invocations"][0]["output_excerpt"] == "2"
    assert report["acceptance"] == "requires_semantic_review"
    assert report["verified_transfer_count"] is None


def test_action_count_uses_canonical_budget_not_duplicated_bridge_events(tmp_path):
    write(tmp_path, "bridge-events.jsonl", [{"event": "action", "index": 1}] * 2)
    write(tmp_path, "execution-observations.jsonl", [{"observation_id": "execution-observation-2",
        "tool_name": "arc_action", "is_error": False,
        "arc_outcome": {"levels_completed": 1, "action_budget": {"total_used": 1}}}])
    report = audit(tmp_path)
    assert report["arc"]["actions_used"] == 1
    assert report["arc"]["levels_completed"] == 1


def test_parent_tool_audit_counts_engine_errors_and_negative_receipts(tmp_path):
    write(tmp_path, "pi-events.jsonl", [
        {"type": "tool_execution_start", "toolCallId": "read-1", "toolName": "task_resource",
         "args": {"action": "read", "ref": "skill:probe@v1"}},
        {"type": "tool_execution_end", "toolCallId": "read-1", "isError": True,
         "result": {"content": [{"type": "text", "text": "Tool task_resource not found"}]}},
        {"type": "tool_execution_start", "toolCallId": "focus-1", "toolName": "task_harness",
         "args": {"action": "focus", "resource_refs": ["observation:obs-1@v1"]}},
        {"type": "tool_execution_end", "toolCallId": "focus-1", "isError": False,
         "result": {"content": [{"type": "text", "text": json.dumps({
             "format": "task-local-harness-rejection-v1", "unknown_resource_refs": ["observation:obs-1@v1"]})}]}},
        {"type": "tool_execution_start", "toolCallId": "inspect-1", "toolName": "task_resource",
         "args": {"action": "inspect"}},
        {"type": "tool_execution_end", "toolCallId": "inspect-1", "isError": False,
         "result": {"content": [{"type": "text", "text": "{\"total\":2}"}]}},
        {"type": "tool_execution_start", "toolCallId": "pending", "toolName": "task_resource",
         "args": {"action": "read", "ref": "skill:probe@v1"}},
    ])
    report = audit(tmp_path)
    outcomes = report["parent_tool_outcomes"]
    assert outcomes["counts"] == {"engine_error": 1, "structured_rejection": 1, "unflagged_return": 1}
    assert outcomes["records"][0]["ref"] == "skill:probe@v1"
    assert outcomes["records"][0]["outcome"] == "engine_error"
    assert outcomes["records"][1]["resource_refs"] == ["observation:obs-1@v1"]
    assert len(outcomes["records"]) == 3  # A start without an end proves no result.
    assert report["operation_failures"] == []  # This journal alone misses both failures.


def test_partial_jsonl_is_reported_and_not_promoted_to_evidence(tmp_path):
    (tmp_path / "auto-research-runs.jsonl").write_text('{"run_id":', encoding="utf-8")
    report = audit(tmp_path)
    assert report["research_runs"] == []
    assert report["parse_warnings"] == [{"artifact": "auto-research-runs.jsonl", "line": 1}]


def test_audit_separates_versions_assembly_creator_read_use_and_token_streams(tmp_path):
    write(tmp_path, "task-system-prompt.jsonl", [
        {"name": "focus", "version": 1, "status": "active"},
        {"name": "focus", "version": 2, "status": "active"},
    ])
    write(tmp_path, "task-harness-assemblies.jsonl", [{
        "assembly_id": "main", "revision": 1, "status": "active",
        "selected_resource_refs": ["system_prompt:focus@v2"],
    }])
    write(tmp_path, "task-harness-assembly-receipts.jsonl", [{"applied": True}])
    write(tmp_path, "task-system-prompt-assemblies.jsonl", [{
        "assembly_ref": "harness_assembly:main@v1", "selected": ["system_prompt:focus@v2"],
    }])
    write(tmp_path, "task-baseline-method-reads.jsonl", [{
        "name": "skill-creator", "method_ref": "baseline_method:skill-creator@sha256:abc",
    }])
    write(tmp_path, "effect-assessments.jsonl", [{
        "verdict": "inconclusive", "resource_refs": ["system_prompt:focus@v2"],
        "actual_use_refs": ["execution-observation-3"],
    }])
    write(tmp_path, "provider-telemetry.jsonl", [{
        "event": "assistant_message", "request_id": "parent-1",
        "usage": {"input": 100, "output": 20, "cache_read": 5, "cache_write": 0, "total_tokens": 125},
    }])
    write(tmp_path, "subagent-provider-telemetry.jsonl", [{
        "event": "assistant_message", "request_id": "child-1",
        "usage": {"input": 30, "output": 10, "cache_read": 0, "cache_write": 0, "total_tokens": 40},
    }])

    report = audit(tmp_path)
    prompt = report["resources"]["system_prompt"]
    assert prompt["raw_record_count"] == 2
    assert prompt["unique_identity_count"] == prompt["current_version_count"] == 1
    assert prompt["current"][0]["version"] == 2
    assert report["component_assemblies"]["unique_selected_resource_refs"] == ["system_prompt:focus@v2"]
    assert report["creator_reads"]["raw_record_count"] == 1
    assert report["actual_uses"]["unique_resource_refs"] == ["system_prompt:focus@v2"]
    assert report["token_costs"]["streams"][0]["totals"]["total_tokens"] == 125
    assert report["token_costs"]["streams"][1]["totals"]["total_tokens"] == 40


def test_started_research_includes_failed_broker_without_run_record(tmp_path):
    write(tmp_path, "auto-research-sessions.jsonl", [{
        "session_id": "research-session-1", "run_id": "auto-research-1",
        "version": 1, "status": "active",
    }])
    broker = tmp_path / "task-context-cache" / "auto-research-broker"
    broker.mkdir(parents=True)
    (broker / "auto-research-1.json").write_text(
        json.dumps({"status": "failed", "failure_code": "child_start_failed"}) + "\n",
        encoding="utf-8",
    )

    report = audit(tmp_path)
    phases = report["research"]["phases"]
    assert phases["started"]["identities"] == ["auto-research-1"]
    assert phases["completed"]["unique_count"] == 0
    assert phases["delivered"]["unique_count"] == 0
    assert report["research"]["broker_attempts"]["status_counts"] == {"failed": 1}
    assert report["research_runs"] == []


def test_research_completion_delivery_adoption_and_use_remain_distinct(tmp_path):
    write(tmp_path, "auto-research-sessions.jsonl", [
        {"session_id": "s1", "run_id": "r1", "version": 1, "status": "active"},
        {"session_id": "s1", "run_id": "r1", "version": 2, "status": "completed"},
        {"session_id": "s1", "run_id": "r1", "version": 3, "status": "completed",
         "completion_delivery_status": "delivered", "reconciliation_status": "adopted"},
    ])
    write(tmp_path, "auto-research-runs.jsonl", [{"run_id": "r1", "version": 1, "status": "completed"}])
    write(tmp_path, "auto-research-reports.jsonl", [{"run_id": "r1", "version": 1, "status": "completed"}])
    write(tmp_path, "effect-assessments.jsonl", [{
        "resource_refs": ["skill:procedure@v1"], "actual_use_refs": ["execution-observation-5"],
    }])
    write(tmp_path, "task-method-lifecycle.jsonl", [{
        "method_id": "parent-procedure", "version": 1,
        "source_component_ref": "skill:procedure@v1", "source_report_ref": "research_report:r1@v1",
    }])

    phases = audit(tmp_path)["research"]["phases"]
    assert {name: phases[name]["unique_count"] for name in phases} == {
        "started": 1, "completed": 1, "delivered": 1, "adopted": 1, "used": 1,
    }


def test_direct_component_use_does_not_count_as_research_use(tmp_path):
    write(tmp_path, "effect-assessments.jsonl", [{
        "resource_refs": ["skill:direct@v1"], "actual_use_refs": ["execution-observation-2"],
    }])
    report = audit(tmp_path)
    assert report["research"]["phases"]["used"]["unique_count"] == 0
    assert report["actual_uses"]["direct_or_unattributed_resource_refs"] == ["skill:direct@v1"]
    assert report["token_costs"]["streams"][1]["actor"] == "child_unattributed"


def test_outcome_cost_audit_separates_whole_level_incremental_proposals_and_verified_savings(tmp_path):
    write(tmp_path, "task-outcome-cost-index.jsonl", [
        {"format": "task-outcome-cost-index-v1", "version": 1, "window_id": "w1",
         "coverage": "partial", "gaps": ["event_time_unavailable"],
         "calls": [
             {"call_ref": "tool_call:1:read", "tool_name": "task_resource", "result": "success"},
             {"call_ref": "tool_call:2:arc", "tool_name": "arc_action", "result": "error"},
         ],
         "whole_level": {"tool_counts": {"task_resource": 1, "arc_action": 1}, "arc_actions": 1},
         "since_previous_boundary": {"tool_counts": {"task_resource": 1, "arc_action": 1}, "arc_actions": 1},
         "provider_cost": {"request_count": 2, "input_tokens": None, "output_tokens": None,
                           "attribution": "window_only", "token_status": "provider_usage_missing"}},
        {"format": "task-outcome-cost-index-v1", "version": 1, "window_id": "w2",
         "coverage": "complete", "gaps": [],
         "calls": [
             {"call_ref": "tool_call:1:read", "tool_name": "task_resource", "result": "success"},
             {"call_ref": "tool_call:2:arc", "tool_name": "arc_action", "result": "error"},
             {"call_ref": "tool_call:3:arc", "tool_name": "arc_action", "result": "success"},
         ],
         "whole_level": {"tool_counts": {"task_resource": 1, "arc_action": 2}, "arc_actions": 2},
         "since_previous_boundary": {"tool_counts": {"arc_action": 1}, "arc_actions": 1},
         "provider_cost": {"request_count": 1, "input_tokens": 80, "output_tokens": 12,
                           "attribution": "window_only", "token_status": "provider_reported"}},
        {"format": "task-outcome-cost-index-v1", "version": 1, "window_id": "w3",
         "coverage": "complete", "gaps": [], "calls": [
             {"call_ref": "tool_call:7:read", "tool_name": "task_resource", "result": "success"},
             {"call_ref": "tool_call:8:arc", "tool_name": "arc_action", "result": "success"},
         ],
         "whole_level": {"tool_counts": {"task_resource": 1, "arc_action": 1}, "arc_actions": 1},
         "since_previous_boundary": {"tool_counts": {"arc_action": 1}, "arc_actions": 1},
         "provider_cost": {"attribution": "unknown"}},
        {"format": "task-outcome-cost-index-v1", "version": 1, "window_id": "w4",
         "coverage": "partial", "gaps": ["boundary_tool_event_unavailable"], "calls": [],
         "whole_level": {"tool_counts": {"arc_action": 2}, "arc_actions": 2},
         "since_previous_boundary": None, "provider_cost": {"attribution": "unknown"}},
    ])
    write(tmp_path, "task-level-reviews.jsonl", [
        {"window_id": "w1", "level": 2, "reasons": ["reset"]},
        {"window_id": "w2", "level": 2, "reasons": ["level_success"], "success_path": {
            "status": "candidate", "proposed_omissions": [{"call_refs": ["tool_call:1:read"],
                "rationale": "Rule is already known", "risk": "Miss a changed layout", "confidence": "medium"}]}},
        {"window_id": "w3", "level": 3, "reasons": ["level_success"]},
        {"window_id": "w4", "level": 4, "reasons": ["level_success"]},
    ])

    result = audit(tmp_path)["outcome_cost_audit"]
    assert result["coverage_counts"] == {"partial": 2, "complete": 2}
    first, second, third, fourth = result["windows"]
    assert first["whole_level"]["failure_or_error_count"] == 1
    assert second["whole_level"]["tool_counts"] == {"task_resource": 1, "arc_action": 2}
    assert second["since_previous_boundary"]["tool_counts"] == {"arc_action": 1}
    assert second["since_previous_boundary"]["failure_or_error_count"] == 0
    assert second["provider_cost"]["attribution"] == "window_only"
    assert third["since_previous_boundary"]["call_detail_attribution"] == "unknown_prior_window_index_missing"
    assert fourth["since_previous_boundary"]["tool_counts"] is None
    assert fourth["since_previous_boundary"]["arc_actions"] is None
    assert fourth["since_previous_boundary"]["call_detail_attribution"] == "unknown_boundary_attribution"
    assert result["latest_whole_level_by_level"][0]["window_id"] == "w2"
    assert result["incremental_totals"]["tool_counts"] is None
    assert result["incremental_totals"]["known_tool_counts"] == {"task_resource": 1, "arc_action": 3}
    assert result["incremental_totals"]["count_unknown_window_count"] == 1
    assert result["proposed_omissions"]["count"] == 1
    assert result["verified_savings"] == {
        "count": 0, "records": [], "status": "not_measured",
        "basis": "A lower call count or an omission proposal alone is not a verified saving; no comparable post-trial verification field is currently persisted.",
    }
