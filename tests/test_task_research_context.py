"""Small real-Pi, offline-provider checks for the task-local working set."""
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.task_scope import seal_task_scope
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def records(root, name):
    path = root / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def results(events, name):
    return [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == name]


def harness_delivery(delivery_id, semantic_kind, name, content, **overrides):
    defaults = {
        "format": "auto-research-harness-delivery-v1",
        "delivery_id": delivery_id,
        "semantic_kind": semantic_kind,
        "operation": "create",
        "name": name,
        "summary": f"Structured {semantic_kind} delivery for {name}.",
        "content": content,
        "scope": {"kind": "condition", "statement": "current fixture"},
        "trigger": "when the corresponding fixture decision is active",
        "exclusions": [],
        "stability": "conditional",
        "reuse": "expected_reuse",
        "reasoning": "bounded_judgment" if semantic_kind in {"plan", "procedure"} else "none",
        "execution": {
            "computation": "pure_computation", "role": "model_delegation",
        }.get(semantic_kind, "text"),
        "context_visibility": "on_demand",
        "basis_refs": [],
        "expected_effect": "improve the next bounded fixture decision",
        "reconsider_when": "a later fixture observation contradicts it",
    }
    defaults.update(overrides)
    if (defaults["context_visibility"] == "always" and "prompt_operation" not in defaults):
        defaults["prompt_operation"] = "create"
    return defaults


def run_output_policy_helper(expression: str, *, input_value=None):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_auto_research_output.ts"
    script = (
        f'import * as outputPolicy from {json.dumps(helper.as_uri())};'
        f"console.log(JSON.stringify({expression}));"
    )
    env = os.environ.copy()
    if input_value is not None:
        env["AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        env=env,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def run_router_helper(expression: str, *, input_value):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_auto_research_harness_router.ts"
    script = f'import * as router from {json.dumps(helper.as_uri())};console.log(JSON.stringify({expression}));'
    env = os.environ.copy()
    env["AUTORESEARCH_ROUTER_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True, env=env,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_code_router_compiles_semantics_and_prompt_overlay_to_native_pi_calls():
    cases = {
            "fact": "task_memory", "plan": "task_memory", "procedure": "task_skill",
        "computation": "task_tool", "role": "task_subagent",
    }
    capabilities = list(cases.values()) + ["task_system_prompt", "delegate_task"]
    for kind, expected_tool in cases.items():
        extras = {}
        if kind == "computation":
            extras["program"] = {"steps": [{"kind": "select", "source": "input", "fields": ["value"]}]}
        if kind == "role":
            extras["tools"] = ["task_resource"]
        if kind != "plan":
            extras["prompt_channel"] = "system_prompt"
            extras["basis_refs"] = ["observation:validated-invariant@v1"]
            extras["system_prompt_basis"] = {
                "source": "validated_environment_invariant",
                "evidence_refs": ["observation:validated-invariant@v1"],
            }
        delivery = harness_delivery(
            f"route-{kind}", kind, f"route-{kind}", f"Canonical {kind} body.",
            scope={"kind": "task_wide", "statement": "this task"},
            stability="stable_in_scope", context_visibility="always", **extras,
        )
        plan = run_router_helper(
            "router.compileHarnessRoute({runId:'auto-research-1',approvalId:'auto-research-1:proposal-1',approvalVersion:2,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:" + json.dumps(capabilities) + "})",
            input_value=delivery,
        )
        assert plan["router"] == {"implementation": "code", "policy_version": "harness-router-v1"}
        assert plan["route_status"] == "ready"
        assert plan["steps"][0]["native_tool"] == expected_tool
        assert plan["steps"][0]["native_call"]["arguments"]["routing_id"] == plan["route_id"]
        if kind == "plan":
            assert len(plan["steps"]) == 1
        else:
            assert plan["steps"][1]["native_tool"] == "task_system_prompt"
            assert plan["steps"][1]["depends_on"] == [plan["steps"][0]["step_id"]]


def test_code_router_requires_explicit_system_prompt_channel_for_foundational_overlay():
    delivery = harness_delivery(
        "route-foundation", "plan", "route-foundation", "The host-level protocol is invariant.",
        scope={"kind": "task_wide", "statement": "this task"},
        stability="stable_in_scope", context_visibility="always",
        prompt_channel="system_prompt", prompt_operation="create",
        basis_refs=["context:task-contract@v1"],
        system_prompt_basis={"source": "explicit_task_contract", "evidence_refs": ["context:task-contract@v1"]},
    )
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'run',approvalId:'proposal',approvalVersion:1,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:['task_memory','task_system_prompt']})",
        input_value=delivery,
    )
    assert plan["base_target"] == "memory"
    assert [step["native_tool"] for step in plan["steps"]] == ["task_memory", "task_system_prompt"]


def test_code_router_default_plan_is_dynamic_task_prompt_projection_on_memory():
    delivery = harness_delivery(
        "route-dynamic-plan", "plan", "route-dynamic-plan", "Use the verified sequence for the next decision.",
        scope={"kind": "task_wide", "statement": "this task"},
        stability="stable_in_scope", context_visibility="always",
    )
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'run',approvalId:'proposal',approvalVersion:1,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:['task_memory']})",
        input_value=delivery,
    )
    assert plan["base_target"] == "memory"
    assert [step["native_tool"] for step in plan["steps"]] == ["task_memory"]
    projection = plan["steps"][0]["native_call"]["arguments"]["projection"]
    assert projection["channel"] == "task_prompt"


def test_code_router_rejects_unlinked_system_prompt_basis_and_unexecutable_tool_program():
    prompt_delivery = harness_delivery(
        "route-prompt", "plan", "route-prompt", "Stable rule.",
        scope={"kind": "task_wide", "statement": "this task"},
        stability="stable_in_scope", context_visibility="always",
        prompt_channel="system_prompt", prompt_operation="create",
    )
    prompt_error = run_router_helper(
        "(()=>{try{router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT));return null}catch(error){return String(error.message)}})()",
        input_value=prompt_delivery,
    )
    assert "system_prompt_basis" in prompt_error

    tool_delivery = harness_delivery(
        "route-bad-tool", "computation", "route-bad-tool", "Unknown program.",
        program={"steps": [{"kind": "invented_host_operation"}]},
    )
    tool_error = run_router_helper(
        "(()=>{try{router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT));return null}catch(error){return String(error.message)}})()",
        input_value=tool_delivery,
    )
    assert "unsupported steps" in tool_error


def test_code_router_never_materializes_unapproved_or_research_only_delivery():
    delivery = harness_delivery("negative-result", "assessment", "negative-result", "The test was inconclusive.")
    for status, disposition in [("pending", "waiting"), ("deferred", "waiting"), ("rejected", "closed")]:
        plan = run_router_helper(
            f"router.compileHarnessRoute({{runId:'auto-research-2',approvalId:'a',approvalVersion:1,approvalStatus:'{status}',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:[]}})",
            input_value=delivery,
        )
        assert plan["disposition"] == disposition and plan["steps"] == []
    approved = run_router_helper(
        "router.compileHarnessRoute({runId:'auto-research-2',approvalId:'a',approvalVersion:2,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:[]})",
        input_value=delivery,
    )
    assert approved["disposition"] == "research_only" and approved["steps"] == []


def test_auto_research_report_request_does_not_inject_or_lower_token_limits():
	unchanged = run_output_policy_helper(
		"outputPolicy.capAutoResearchReportRequest({max_tokens:6000,max_completion_tokens:12000}, 12000)"
	)
	assert unchanged["max_tokens"] == 6000
	assert unchanged["max_completion_tokens"] == 12000

	without_limit = run_output_policy_helper(
		"outputPolicy.capAutoResearchReportRequest({}, undefined)"
	)
	assert "max_tokens" not in without_limit


def test_auto_research_report_normalization_preserves_complete_structured_delivery():
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "c" * 2000,
        "findings": [{
            "subject_kind": "component",
            "question": "q" * 1000,
            "conclusion": "f" * 1000,
            "evidence_refs": [f"observation:item-{i}@v1" for i in range(20)],
            "uncertainty": "u" * 1000,
        } for _ in range(8)],
        "evidence_refs": [f"observation:item-{i}@v1" for i in range(20)],
        "alternatives": ["a" * 1000 for _ in range(8)],
        "limitations": ["l" * 1000 for _ in range(8)],
        "validation_plan": "v" * 2000,
        "harness_proposals": [{
            "approval_id": f"approval-{i}",
            "delivery": harness_delivery(
                f"proposal-{i}", "procedure", "proposal", "must enter the canonical delivery",
                summary="s" * 360,
                basis_refs=[f"observation:item-{j}@v1" for j in range(16)],
            ),
        } for i in range(8)],
    }
    normalized = run_output_policy_helper(
        "outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT))",
        input_value=report,
    )

    # The durable report is canonical research output, not a UI capsule.  It
    # must not silently discard findings or delivery bodies to satisfy a local
    # character/item quota.  buildAutoResearchCapsule owns the separate compact
    # parent-facing projection.
    assert normalized["conclusion"] == report["conclusion"]
    assert normalized["findings"] == report["findings"]
    assert normalized["evidence_refs"] == report["evidence_refs"]
    assert normalized["alternatives"] == report["alternatives"]
    assert normalized["limitations"] == report["limitations"]
    assert len(normalized["harness_proposals"]) == len(report["harness_proposals"])
    assert normalized["harness_proposals"][0]["delivery"]["content"] == "must enter the canonical delivery"


def test_capsule_route_projection_omits_native_arguments_but_keeps_recovery_identity():
    delivery = harness_delivery(
        "compact-route", "procedure", "compact-route",
        "CANONICAL-INSTRUCTIONS-MUST-STAY-OUT-OF-THE-CAPSULE",
    )
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "The route is ready.",
        "findings": [],
        "evidence_refs": [],
        "alternatives": [],
        "limitations": [],
        "validation_plan": "Use the materialized skill.",
        "harness_proposals": [{
            "approval_id": "auto-research-1:proposal-1",
            "approval_version": 2,
            "approval_status": "approved",
            "approval_tag": "approved",
            "delivery": delivery,
        }],
    }
    route = {
        "format": "auto-research-harness-route-v1",
        "route_id": "auto-research-1:route-compact-route",
        "route_ref": "harness_route:auto-research-1:route-compact-route@v1",
        "version": 1,
        "run_id": "auto-research-1",
        "delivery_id": "compact-route",
        "delivery_hash": "sha256:canonical-delivery",
        "approval_ref": "proposal:auto-research-1:proposal-1@v2",
        "review_status": "approved",
        "disposition": "materialize",
        "route_status": "ready",
        "execution_status": "fulfilled",
        "execution_applied": True,
        "base_target": "skill",
        "steps": [{
            "step_id": "auto-research-1:route-compact-route:step-1",
            "order": 1,
            "target": "skill",
            "native_tool": "task_skill",
            "native_call": {"name": "task_skill", "arguments": {
                "instructions": "CANONICAL-INSTRUCTIONS-MUST-STAY-OUT-OF-THE-CAPSULE",
            }},
            "depends_on": [],
            "status": "ready",
        }],
        "apply_call": {"name": "task_harness", "arguments": {
            "action": "apply_route",
            "route_ref": "harness_route:auto-research-1:route-compact-route@v1",
            "expected_delivery_hash": "sha256:canonical-delivery",
        }},
        "router": {"implementation": "code", "policy_version": "harness-router-v1"},
    }
    value = run_output_policy_helper(
        "(()=>{const input=JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT);"
        "const before=JSON.stringify(input.routePlans);"
        "const capsule=outputPolicy.buildAutoResearchCapsule(input);"
        "return {capsule,routePlansUnchanged:before===JSON.stringify(input.routePlans)}})()",
        input_value={
            "runId": "auto-research-1",
            "sessionRef": "research_session:auto-research-1@v1",
            "status": "completed",
            "scope": "harness_component",
            "reportRef": "research_report:auto-research-1@v1",
            "report": report,
            "routePlans": [route],
        },
    )

    capsule = value["capsule"]
    projected = capsule["route_plan"][0]
    assert value["routePlansUnchanged"] is True
    assert projected["route_id"] == route["route_id"]
    assert projected["route_ref"] == route["route_ref"]
    assert projected["delivery_hash"] == route["delivery_hash"]
    assert projected["approval_ref"] == route["approval_ref"]
    assert projected["execution_status"] == "fulfilled"
    assert projected["execution_applied"] is True
    assert projected["steps"] == [{
        "step_id": "auto-research-1:route-compact-route:step-1",
        "order": 1,
        "target": "skill",
        "native_tool": "task_skill",
        "status": "ready",
        "depends_on": [],
    }]
    serialized = json.dumps(capsule)
    assert "native_call" not in serialized
    assert "apply_call" not in serialized
    assert "CANONICAL-INSTRUCTIONS-MUST-STAY-OUT-OF-THE-CAPSULE" not in serialized


def test_code_router_does_not_apply_a_project_local_name_length_quota():
    long_name = "long-" + ("component-" * 30) + "x"
    delivery = harness_delivery(long_name, "fact", long_name, "The complete fact body.")
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'auto-research-long-name',approvalId:'approval-long-name',approvalVersion:1,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:['task_memory']})",
        input_value=delivery,
    )
    assert plan["route_status"] == "ready"
    assert plan["steps"][0]["native_call"]["arguments"]["key"] == long_name


def test_report_rejects_system_prompt_basis_not_linked_to_findings_or_report_evidence():
    delivery = harness_delivery(
        "prompt-rule", "fact", "prompt-rule", "Stable rule.",
        scope={"kind": "task_wide", "statement": "this task"},
        stability="stable_in_scope", context_visibility="always",
        prompt_channel="system_prompt", prompt_operation="create",
        basis_refs=["context:task-contract@v1"],
        system_prompt_basis={"source": "explicit_task_contract", "evidence_refs": ["context:task-contract@v1"]},
    )
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "rule", "findings": [], "evidence_refs": [],
        "alternatives": [], "limitations": [], "validation_plan": "recheck",
        "harness_proposals": [{"approval_id": "proposal-1", "delivery": delivery}],
    }
    error = run_output_policy_helper(
        "(()=>{try{const report=outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT));outputPolicy.assertHarnessProposalEvidenceLinks(report);return null}catch(error){return String(error.message)}})()",
        input_value=report,
    )
    assert "not linked to report findings/evidence" in error


def test_memory_conflict_recovers_without_overwrite_and_reads_full_pages(tmp_path):
    root = tmp_path / "memory"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "model", "content": "body" * 1800, "summary": "An untested model."}},
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "model", "target_version": 2, "content": "wrong overwrite"}},
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "model", "target_version": 1, "append_content": " END", "summary": "Updated untested model."}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:model@v2", "offset": 200, "limit": 240}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "failure:failure-1@v1", "limit": 8000}},
    ])
    mutations = records(root, "task-memory.jsonl")
    assert [r["version"] for r in mutations] == [1, 2]
    assert mutations[-1]["content"] == "body" * 1800 + " END"
    conflict = results(events, "task_memory")[1]
    assert conflict["isError"]
    assert conflict["result"]["details"]["current_version"] == 1
    assert conflict["result"]["details"]["applied"] is False
    page = results(events, "task_resource")[0]["result"]["details"]
    assert len(page["text"]) == 240 and page["next_offset"] == 440
    assert page["provenance"]["source_ref"] == "memory:model@v2"
    assert page["provenance"]["source_version"] == 2
    assert page["provenance"]["page"] == {"offset": 200, "limit": 240, "total": page["total"], "truncated": True, "next_offset": 440}
    failure = json.loads(results(events, "task_resource")[1]["result"]["details"]["text"])
    assert failure["attempted_input"]["content"] == "wrong overwrite" and failure["applied"] is False
    assert records(root, "task-operation-failures.jsonl")
    checkpoint = json.loads((root / "task-checkpoint.json").read_text())
    assert checkpoint["pending_operations"] == []
    contexts = records(root, "provider-contexts.jsonl")
    projection = [m for m in contexts[-1]["context"]["messages"] if "Active task-local memory" in json.dumps(m)]
    assert "Updated untested model" in json.dumps(projection)
    assert "body" * 200 not in json.dumps(projection)


def test_validation_retains_open_tests_and_requires_real_evidence_refs(tmp_path):
    root = tmp_path / "validation"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_validation", "arguments": {"action": "open", "hypothesis": "H1", "prediction": "P1", "alternatives": ["H2 also explains the observation"]}},
        {"name": "task_validation", "arguments": {"action": "open", "hypothesis": "H2", "prediction": "P2"}},
        {"name": "benchmark_probe", "arguments": {"progressed": True}},
        {"name": "task_validation", "arguments": {"action": "assess", "validation_id": "validation-1", "target_version": 1, "verdict": "supported", "explanation": "Not enough provenance.", "evidence_refs": ["observation:missing@v1"]}},
        {"name": "task_validation", "arguments": {"action": "assess", "validation_id": "validation-1", "target_version": 1, "verdict": "inconclusive", "explanation": "Progress alone does not distinguish these hypotheses.", "evidence_refs": ["observation:execution-observation-1@v1"]}},
    ])
    validations = records(root, "task-validations.jsonl")
    assert len(validations) == 3
    assert validations[1]["status"] == "open"
    assert validations[-1]["verdict"] == "inconclusive"
    assert validations[-1]["independently_verified"] is False
    assert results(events, "task_validation")[2]["isError"]


def test_output_truncated_write_is_not_applied_and_has_recovery_checkpoint(tmp_path):
    root = tmp_path / "truncated"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "model", "content": "v1"}},
        {"name": "task_memory", "stop_reason": "length", "arguments": {"action": "upsert", "key": "model", "target_version": 1, "content": "incomplete new text"}},
    ])
    assert len(records(root, "task-memory.jsonl")) == 1
    assert results(events, "task_memory")[-1]["isError"]
    checkpoint = json.loads((root / "task-checkpoint.json").read_text())
    assert checkpoint["pending_operations"]
    assert "output token limit" in checkpoint["pending_operations"][-1]["error"]
    _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "model", "target_version": 1, "append_content": " recovered"}},
    ])
    assert records(root, "task-memory.jsonl")[-1]["content"] == "v1 recovered"
    assert json.loads((root / "task-checkpoint.json").read_text())["pending_operations"] == []


def test_archive_has_exact_source_and_protects_checkpoint_under_pressure(tmp_path):
    root = tmp_path / "archive"
    _run_fixture(root, "treatment", context_max_chars=18000, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "current_subgoal": "retain-subgoal", "working_summary": "Agent summary, not fact.", "summary_basis_refs": []}},
        *[{"name": "benchmark_probe", "arguments": {"progressed": bool(i % 2)}} for i in range(7)],
    ])
    contexts = [r["context"] for r in records(root, "provider-contexts.jsonl")]
    assert all(len(json.dumps(c["messages"], ensure_ascii=False, separators=(",", ":"))) <= 18000 for c in contexts)
    assert "retain-subgoal" in json.dumps(contexts[-1])
    assert "agent_interpretation_not_runtime_fact" in json.dumps(contexts[-1])
    archives = records(root, "task-context-cache/messages.jsonl")
    assert archives
    first = next(r for r in archives if r.get("message_refs"))
    assert first["message_refs"] and first["task_id"]
    assert any(r.get("message") for r in archives)
    ref = f"context:{first['archive_id']}@v1"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_resource", "arguments": {"action": "read", "ref": ref, "limit": 700}},
    ])
    assert not results(events, "task_resource")[0].get("isError")
    assert results(events, "task_resource")[0]["result"]["details"]["next_offset"] == 700


def test_ephemeral_validation_child_has_only_selected_resources_and_clean_context(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "child"
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "limit": 8000}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:unselected@v1"}},
        ]),
    }, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "chosen", "content": "selected-full-body", "summary": "Selected summary"}},
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "unselected", "content": "PARENT-ONLY-SECRET"}},
        {"name": "delegate_task", "arguments": {"instructions": "Check the chosen model against the permitted evidence.", "task": "Report uncertainty.", "resource_refs": ["memory:chosen@v1"]}},
    ])
    assert not [e for e in results(events, "delegate_task") if e.get("isError")]
    assert not records(root, "task-subagents.jsonl")
    invocation = records(root, "subagent-invocations.jsonl")[0]
    assert invocation["ephemeral"] and invocation["status"] == "completed"
    contexts = [r["context"] for r in records(root, "subagent-provider-contexts.jsonl")]
    assert {t["name"] for t in contexts[0]["tools"]} == {"fixture_state", "task_resource"}
    assert "PARENT-ONLY-SECRET" not in json.dumps(contexts)
    assert "selected-full-body" not in json.dumps(contexts[0])
    assert "selected-full-body" in json.dumps(contexts[1])
    assert "resource was not granted" in json.dumps(contexts[-1])
    assert all(r["count"] == 0 for r in records(root, "subagent-native-skills.jsonl"))


def test_auto_research_runs_in_clean_child_and_returns_adoption_proposal(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research"
    report = {
        "format": "auto-research-report-v1",
        "status": "provisional",
        "conclusion": "A compact fixture-state inspection skill is worth testing.",
        "findings": [{
            "subject_kind": "component",
            "question": "Would the procedure reduce repeated narration?",
            "conclusion": "It may reduce repeated narration if validated on a later state.",
            "evidence_refs": [],
            "uncertainty": "No environment evidence yet.",
        }],
        "evidence_refs": [],
        "alternatives": ["Keep the parent procedure unchanged."],
        "limitations": ["The child has no write or environment-action capability."],
        "validation_plan": "Create the skill explicitly, then run it on a later fixture state.",
        "harness_proposals": [{
            "approval_id": "auto-research-1:proposal-1",
            "delivery": harness_delivery(
                "fixture-state-review", "procedure", "fixture-state-review",
                "Read fixture_state, state the observation, and record uncertainty.",
                summary="Inspect the fixture state and record a bounded conclusion.",
                expected_effect="reduce repeated parent narration",
                reconsider_when="the procedure does not change a later decision",
            ),
        }],
    }
    compact_report = {
        **report,
        "harness_proposals": [{"approval_id": "auto-research-1:proposal-1"}],
    }
    delivery_hash = run_router_helper("router.harnessDeliveryHash(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))", input_value=report["harness_proposals"][0]["delivery"])
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(compact_report),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "research_approval", "arguments": {
                "action": "propose", "approval_id": "auto-research-1:proposal-1",
                "delivery": report["harness_proposals"][0]["delivery"],
            }},
            {"name": "research_approval", "arguments": {
                "action": "approve", "approval_id": "auto-research-1:proposal-1", "target_version": 1,
            }},
            {"name": "submit_research_report", "arguments": {"report": compact_report}},
        ]),
    }, steps=[
        {"name": "auto_research", "arguments": {
            "question": "Should a fixture-state review skill be created for this task?",
            "scope": "harness_component",
        }},
        {"name": "task_harness", "arguments": {
            "action": "apply_route",
            "route_ref": "harness_route:auto-research-1:route-fixture-state-review@v1",
            "expected_delivery_hash": delivery_hash,
        }},
        {"name": "task_resource", "arguments": {
            "action": "read", "ref": "research_report:auto-research-1@v1", "offset": 0, "limit": 8000,
        }},
    ])
    auto_result = results(events, "auto_research")[0]
    assert not auto_result.get("isError")
    compact = auto_result["result"]["content"][0]["text"]
    capsule = json.loads(compact)
    assert capsule["format"] == "auto-research-capsule-v1"
    assert capsule["summary"] == "A compact fixture-state inspection skill is worth testing."
    assert "A compact fixture-state inspection skill is worth testing." in compact
    assert "It may reduce repeated narration if validated on a later state." in compact
    assert capsule["detail_ref"] == "research_report:auto-research-1@v1"
    assert "apply_call" not in compact
    assert "native_call" not in compact
    assert "Read fixture_state" not in compact
    assert capsule["route_plan"][0]["route_ref"] == "harness_route:auto-research-1:route-fixture-state-review@v1"
    assert capsule["route_plan"][0]["delivery_hash"] == delivery_hash
    assert capsule["route_plan"][0]["approval_ref"] == "proposal:auto-research-1:proposal-1@v2"
    assert capsule["route_plan"][0]["steps"][0]["native_tool"] == "task_skill"
    assert "question" not in capsule
    assert "alternatives" not in capsule

    runs = records(root, "auto-research-runs.jsonl")
    assert len(runs) == 1
    assert runs[0]["status"] == "completed"
    assert runs[0]["report_ref"] == "research_report:auto-research-1@v1"
    assert runs[0]["finding_count"] == 1
    assert runs[0]["proposal_count"] == 1
    assert "report" not in runs[0]
    assert "result" not in runs[0]
    assert "findings" not in runs[0]
    assert "harness_proposals" not in runs[0]
    assert runs[0]["evidence_audit"]["format"] == "research-evidence-audit-v1"
    assert runs[0]["evidence_audit"]["status"] == "no_selected_refs"
    progress = records(root, "subagent-progress.jsonl")
    assert progress[0]["event"] == "spawned"
    assert any(item["event"] == "event" and item["last_event_type"] == "tool_execution_start" for item in progress)
    assert any(item["event"] == "event" and item["last_tool_name"] == "submit_research_report" for item in progress)
    assert progress[-1]["event"] == "process_closed"
    assert progress[-1]["phase"] == "completed"
    reports = records(root, "auto-research-reports.jsonl")
    assert len(reports) == 1
    assert reports[0]["report"]["findings"][0]["subject_kind"] == "component"
    assert reports[0]["report"]["harness_proposals"][0]["delivery"]["semantic_kind"] == "procedure"
    assert reports[0]["report"]["harness_proposals"][0]["delivery"] == report["harness_proposals"][0]["delivery"]
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    assert checkpoint["latest_research_run_ref"] == "research_run:auto-research-1@v1"
    assert checkpoint["research_status"] == "completed"
    assert checkpoint["research_question"] == "Should a fixture-state review skill be created for this task?"
    assert checkpoint["harness_proposal_count"] == 1
    full_read = results(events, "task_resource")[0]
    assert not full_read.get("isError")
    assert "A compact fixture-state inspection skill is worth testing." in full_read["result"]["details"]["text"]
    assert "Read fixture_state" in full_read["result"]["details"]["text"]

    # Auto-Research did not mutate the harness. The next parent call executed
    # the code-compiled route through Pi's native task_skill tool.
    skills = records(root, "task-skills.jsonl")
    assert skills[0]["routing_id"] == "auto-research-1:route-fixture-state-review"
    assert skills[0]["source_approval_ref"] == "proposal:auto-research-1:proposal-1@v2"
    assert skills[0]["instructions"] == report["harness_proposals"][0]["delivery"]["content"]
    receipts = records(root, "auto-research-harness-route-receipts.jsonl")
    assert receipts[0]["status"] == "applied"
    assert receipts[0]["route_id"] == "auto-research-1:route-fixture-state-review"
    assert receipts[0]["resource_ref"] == "skill:fixture-state-review@v1"
    routes = records(root, "auto-research-harness-routes.jsonl")
    assert routes[-1]["route_status"] == "fulfilled"
    assert routes[-1]["delivery_hash"] == delivery_hash
    assert routes[-1]["steps"][0]["native_call"]["arguments"]["instructions"] == report["harness_proposals"][0]["delivery"]["content"]
    parent_contexts = records(root, "provider-contexts.jsonl")
    assert all(item["count"] == 0 for item in records(root, "subagent-native-skills.jsonl"))
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    child_context = json.dumps(child_contexts)
    assert "Auto-Research child reporting contract" in child_context
    assert "Research objects and agent choices" in child_context
    submit_tool = next(
        tool
        for context in child_contexts
        for tool in context["context"]["tools"]
        if tool["name"] == "submit_research_report"
    )
    assert "auto-research-harness-delivery-v1" not in json.dumps(submit_tool)
    assert "Research objects and agent choices" not in json.dumps(parent_contexts)
    assert "child_report_not_automatically_adopted" in json.dumps(parent_contexts[-1])


def test_auto_research_child_reviews_proposal_metadata_without_parent_approval_tool(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-approval"
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "The proposed review skill is ready for explicit parent adoption.",
        "findings": [],
        "evidence_refs": [],
        "alternatives": [],
        "limitations": [],
        "validation_plan": "Use the approved skill on the next state.",
        "harness_proposals": [{
            "approval_id": "auto-research-1:proposal-1",
            "delivery": harness_delivery(
                "fixture-review", "procedure", "fixture-review",
                "Review fixture state before choosing the next action.",
            ),
        }, {
            "approval_id": "auto-research-1:proposal-2",
            "delivery": harness_delivery(
                "fixture-facts", "fact", "fixture-facts", "Retain the bounded fixture conclusion.",
                operation="update", target_version=1,
            ),
        }],
    }
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "research_approval", "arguments": {
                "action": "propose", "approval_id": "auto-research-1:proposal-1",
                "delivery": report["harness_proposals"][0]["delivery"],
            }},
            {"name": "research_approval", "arguments": {
                "action": "inspect", "approval_id": "auto-research-1:proposal-1",
            }},
            {"name": "research_approval", "arguments": {
                "action": "defer", "approval_id": "auto-research-1:proposal-1",
                "target_version": 1, "decision_note": "Defer until the next state supplies a stronger check.",
            }},
            {"name": "research_approval", "arguments": {
                "action": "approve", "approval_id": "auto-research-1:proposal-1",
                "target_version": 2, "decision_note": "The bounded evidence supports trying it now.",
            }},
            {"name": "research_approval", "arguments": {
                "action": "propose", "approval_id": "auto-research-1:proposal-2",
                "delivery": report["harness_proposals"][1]["delivery"],
            }},
            {"name": "research_approval", "arguments": {
                "action": "reject", "approval_id": "auto-research-1:proposal-2",
                "target_version": 1, "decision_note": "The memory is not needed for this task.",
            }},
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
    }, steps=[
        {"name": "auto_research", "arguments": {
            "question": "Should the fixture review skill be tested?", "scope": "harness_component",
        }},
    ])

    auto_result = results(events, "auto_research")[0]
    assert not auto_result.get("isError")
    capsule = json.loads(auto_result["result"]["content"][0]["text"])
    assert capsule["proposal_index"][0]["approval_status"] == "approved"
    assert capsule["proposal_index"][0]["approval_tag"] == "approved"
    assert capsule["proposal_index"][1]["approval_status"] == "rejected"
    assert capsule["route_plan"][0]["steps"][0]["native_tool"] == "task_skill"
    assert capsule["route_plan"][0]["route_status"] == "ready"
    assert capsule["route_plan"][1]["disposition"] == "closed"
    assert capsule["route_plan"][1]["steps"] == []

    approvals = records(root, "task-harness-proposals.jsonl")
    assert [(item["version"], item["status"], item["tag"]) for item in approvals] == [
        (1, "pending", "pending_review"), (2, "deferred", "deferred"),
        (3, "approved", "approved"), (1, "pending", "pending_review"), (2, "rejected", "rejected"),
    ]
    # Approved ready routes are applied by the parent runtime before the
    # capsule returns; the child itself still never mutates parent resources.
    assert records(root, "task-skills.jsonl")[0]["name"] == "fixture-review"
    routes = records(root, "auto-research-harness-routes.jsonl")
    assert [item["router"]["implementation"] for item in routes] == ["code"] * len(routes)
    assert routes[-1]["route_status"] == "fulfilled"

    parent_contexts = records(root, "provider-contexts.jsonl")
    assert "research_approval" not in json.dumps(parent_contexts)
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    assert "research_approval" in json.dumps(child_contexts[0])


def test_auto_research_routes_all_native_components_and_next_context_exposes_them(tmp_path):
    """The compiled route must reach every PI-native mutation surface, not just skills."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "all-native-components"
    deliveries = [
        harness_delivery("route-fact", "fact", "route-fact", "Remember the verified fixture fact.",
                         scope={"kind": "task_wide", "statement": "this fixture task"},
                         stability="stable_in_scope", context_visibility="on_demand"),
        harness_delivery("route-plan", "plan", "route-plan", "Keep the verified fixture fact in view.",
                         scope={"kind": "task_wide", "statement": "this fixture task"},
                         stability="stable_in_scope", context_visibility="always",
                         prompt_channel="system_prompt", prompt_operation="create",
                         basis_refs=["context:task-contract@v1"],
                         system_prompt_basis={"source": "explicit_task_contract", "evidence_refs": ["context:task-contract@v1"]}),
        harness_delivery("route-procedure", "procedure", "route-procedure", "Inspect fixture_state before deciding.",
                         scope={"kind": "condition", "statement": "before a fixture decision"}),
        harness_delivery("route-computation", "computation", "route-computation", "Extract the state field.",
                         program={"steps": [{"kind": "select", "source": "input", "fields": ["state"]}]}),
        harness_delivery("route-role", "role", "route-role", "Independently inspect fixture_state and return uncertainty.",
                         tools=["fixture_state"]),
    ]
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "Each native component has a distinct structured delivery.",
        "findings": [], "evidence_refs": ["context:task-contract@v1"], "alternatives": [], "limitations": [],
        "validation_plan": "Use each materialized component on the next request.",
        "harness_proposals": [{"approval_id": f"auto-research-1:proposal-{i + 1}", "delivery": delivery}
                              for i, delivery in enumerate(deliveries)],
    }
    approval_steps = []
    for index, delivery in enumerate(deliveries, 1):
        approval_steps.extend([
            {"name": "research_approval", "arguments": {"action": "propose", "approval_id": f"auto-research-1:proposal-{index}", "delivery": delivery}},
            {"name": "research_approval", "arguments": {"action": "approve", "approval_id": f"auto-research-1:proposal-{index}", "target_version": 1}},
        ])
    route_refs = [f"harness_route:auto-research-1:route-{delivery['delivery_id']}@v1" for delivery in deliveries]
    events = _run_fixture(root, "treatment", extra_extensions=[
        project / "tests" / "pi_non_arc_task_subagents.ts", project / "tests" / "pi_task_tool_fixture.ts",
    ], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps(approval_steps + [{"name": "submit_research_report", "arguments": {"report": report}}]),
    }, steps=[
        {"name": "auto_research", "arguments": {"question": "Which native surfaces should be materialized?", "scope": "harness_component"}},
        *[{"name": "task_harness", "arguments": {"action": "apply_route", "route_ref": ref,
                                                      "expected_delivery_hash": run_router_helper(
                                                          "router.harnessDeliveryHash(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
                                                          input_value=delivery)}}
          for ref, delivery in zip(route_refs, deliveries)],
        {"name": "task_tool_route-computation_v1", "arguments": {"input": {"state": "RUNNING"}}},
        {"name": "delegate_task", "arguments": {"agent_name": "route-role", "task": "Inspect fixture state independently."}},
    ])
    assert not [event for event in results(events, "auto_research") if event.get("isError")]
    assert not [event for event in results(events, "task_harness") if event.get("isError")]
    assert records(root, "task-memory.jsonl")[0]["key"] == "route-fact"
    assert records(root, "task-system-prompt.jsonl")[0]["name"] == "route-plan"
    assert records(root, "task-skills.jsonl")[0]["name"] == "route-procedure"
    assert records(root, "task-tools.jsonl")[0]["name"] == "route-computation"
    assert records(root, "task-subagents.jsonl")[0]["name"] == "route-role"
    assert all(item["route_status"] == "fulfilled" for item in records(root, "auto-research-harness-routes.jsonl") if item.get("route_status") == "fulfilled")
    assert {item["status"] for item in records(root, "auto-research-harness-route-receipts.jsonl")} == {"applied"}
    assert any("route-fact" in json.dumps(item) for item in records(root, "provider-contexts.jsonl"))
    assert any("route-plan" in json.dumps(item) for item in records(root, "provider-contexts.jsonl"))
    assert any("task_tool_route-computation_v1" in json.dumps(item) for item in records(root, "provider-contexts.jsonl"))


def test_task_memory_plan_projection_enters_dynamic_task_prompt_context_without_system_prompt(tmp_path):
    root = tmp_path / "dynamic-task-prompt"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "next-plan", "content": "Use the verified sequence.",
            "summary": "Dynamic task plan.", "scope": "this task",
            "projection": {"channel": "task_prompt", "prompt_text": "For this task, use the verified sequence."},
        }},
    ])
    assert not results(events, "task_memory")[0].get("isError")
    memory = records(root, "task-memory.jsonl")[0]
    assert memory["projection"]["channel"] == "task_prompt"
    assert not records(root, "task-system-prompt.jsonl")
    contexts = records(root, "provider-contexts.jsonl")
    assert any("Active dynamic task/user prompt knowledge" in json.dumps(item)
               and "verified sequence" in json.dumps(item) for item in contexts)


def test_auto_research_inherits_only_selected_harness_versions_and_context_window(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-inheritance"
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "The selected memory and latest observation are sufficient for this bounded review.",
        "findings": [{
            "subject_kind": "task",
            "question": "Does the selected context distinguish the next review?",
            "conclusion": "The bounded checkpoint identifies the current subgoal and the latest probe.",
            "evidence_refs": [
                "observation:execution-observation-1@v1",
                "memory:chosen@v1",
            ],
            "uncertainty": "The child did not inspect unselected resources.",
        }],
        "evidence_refs": ["execution-observation-1"],
        "alternatives": [],
        "limitations": ["Only explicitly inherited resources were available."],
        "validation_plan": "Compare the next real observation with the selected hypothesis.",
        "harness_proposals": [],
    }
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "limit": 8000}},
        ]),
    }, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "chosen", "content": "selected-full-body", "summary": "Selected harness memory summary"}},
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "unselected", "content": "PARENT-ONLY-SECRET"}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "current_subgoal": "Review the next discriminating observation.", "hypothesis": "The selected probe identifies the relevant transition.", "next_step": "Ask the child to compare the probe with the hypothesis."}},
        {"name": "benchmark_probe", "arguments": {"progressed": True}},
        {"name": "auto_research", "arguments": {
            "question": "Does the selected harness memory and bounded checkpoint support the next review?",
            "scope": "harness_component",
            "evidence_refs": [
                "observation:execution-observation-1@v1", "memory:chosen@v1",
            ],
            "inherit_harness_refs": ["memory:chosen@v1"],
            "context_window": {"include_checkpoint": True, "recent_observations": 1, "recent_actions": 1, "max_chars": 9000},
        }},
    ])
    auto_result = results(events, "auto_research")[0]
    assert not auto_result.get("isError")
    runs = records(root, "auto-research-runs.jsonl")
    assert runs[0]["inherited_harness_refs"] == ["memory:chosen@v1"]
    assert runs[0]["evidence_refs"] == [
        "observation:execution-observation-1@v1", "memory:chosen@v1",
    ]
    assert runs[0]["context_window"]["checkpoint"]["current_subgoal"] == "Review the next discriminating observation."
    assert len(runs[0]["context_window"]["recent_observations"]) == 1

    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    child_context = json.dumps(child_contexts, ensure_ascii=False)
    assert "Parent-selected context window" in child_context
    assert "Review the next discriminating observation." in child_context
    assert "Selected harness memory summary" in child_context
    assert "selected-full-body" not in json.dumps(child_contexts[0])
    assert "selected-full-body" in child_context
    assert "PARENT-ONLY-SECRET" not in child_context
    assert all(item["count"] == 0 for item in records(root, "subagent-native-skills.jsonl"))


def test_auto_research_child_keeps_read_surface_until_agent_submits(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-report-phase"
    report = {
        "format": "auto-research-report-v1",
        "status": "inconclusive",
        "conclusion": "The bounded evidence does not distinguish the alternatives yet.",
        "findings": [],
        "evidence_refs": ["memory:chosen@v1"],
        "alternatives": ["Either candidate remains possible."],
        "limitations": ["No new evidence is available from an identical read."],
        "validation_plan": "Collect one discriminating environment observation.",
        "harness_proposals": [],
    }
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "limit": 8000}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "limit": 8000}},
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
    }, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "chosen", "content": "selected evidence"}},
        {"name": "auto_research", "arguments": {
            "question": "Can the selected evidence distinguish the alternatives?",
            "scope": "hypothesis",
            "inherit_harness_refs": ["memory:chosen@v1"],
        }},
    ])

    assert not results(events, "auto_research")[0].get("isError")
    run = records(root, "auto-research-runs.jsonl")[0]
    assert run["status"] == "completed"
    assert run["result_summary"]["stop_reason"] == "submitted_report"
    controls = records(root, "auto-research-child-control.jsonl")
    assert controls[-1]["event"] == "report_submitted"
    assert controls[-1]["input_form"] == "structured_report"
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    assert "task_resource" in {tool["name"] for tool in child_contexts[1]["context"]["tools"]}
    assert len(child_contexts) >= 3


def test_auto_research_pause_persists_a_resumable_session_checkpoint(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-pause"
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
            "action": "pause", "cursor": "page-2", "unresolved_questions": ["Need a discriminating observation."],
            "resume_condition": "new observation",
        }}]),
    }, steps=[{"name": "auto_research", "arguments": {
        "question": "Which path should be validated next?", "scope": "solution_path",
    }}])
    result = results(events, "auto_research")[0]
    assert not result.get("isError")
    payload = json.loads(result["result"]["content"][0]["text"])
    assert payload["status"] == "paused"
    assert payload["checkpoint"]["cursor"] == "page-2"
    sessions = records(root, "auto-research-sessions.jsonl")
    assert sessions[-1]["status"] == "paused"
    assert sessions[-1]["checkpoint"]["resume_condition"] == "new observation"
    assert records(root, "auto-research-runs.jsonl")[-1]["status"] == "paused"


def test_auto_research_resume_reuses_the_same_session(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-resume"
    base_env = {
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
    }
    _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        **base_env, "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {"action": "pause", "cursor": "cursor-1"}}]),
    }, steps=[{"name": "auto_research", "arguments": {"question": "Which path?", "scope": "solution_path"}}])
    session = records(root, "auto-research-sessions.jsonl")[-1]
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "Resume retained the cursor.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [], "validation_plan": "observe next state", "harness_proposals": []}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        **base_env, "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
    }, steps=[{"name": "auto_research", "arguments": {"action": "resume", "session_ref": f"research_session:{session['session_id']}@v{session['version']}"}}])
    result = results(events, "auto_research")[0]
    assert not result.get("isError")
    payload = json.loads(result["result"]["content"][0]["text"])
    assert payload["status"] == "completed"
    sessions = records(root, "auto-research-sessions.jsonl")
    assert sessions[-1]["session_id"] == session["session_id"]
    assert sessions[-1]["version"] == session["version"] + 1
    assert records(root, "auto-research-runs.jsonl")[-1]["session_id"] == session["session_id"]


def test_auto_research_does_not_close_reads_for_incomplete_selected_evidence(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-incomplete-evidence"
    report = {
        "format": "auto-research-report-v1",
        "status": "inconclusive",
        "conclusion": "The selected page is not enough to distinguish the alternatives.",
        "findings": [],
        "evidence_refs": ["memory:chosen@v1"],
        "alternatives": ["The remaining page may change the conclusion."],
        "limitations": ["Only the first page was read."],
        "validation_plan": "Read the remaining page before deciding.",
        "harness_proposals": [],
    }
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "offset": 0, "limit": 240}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:chosen@v1", "offset": 0, "limit": 240}},
        ]),
    }, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "chosen", "content": "selected evidence " * 1200}},
        {"name": "auto_research", "arguments": {
            "question": "Can the selected evidence distinguish the alternatives?",
            "scope": "hypothesis",
            "inherit_harness_refs": ["memory:chosen@v1"],
        }},
    ])

    result = results(events, "auto_research")[0]
    assert not result.get("isError")
    controls = records(root, "auto-research-child-control.jsonl")
    assert not any(item["event"] == "report_phase_entered" for item in controls)
    report_record = records(root, "auto-research-reports.jsonl")[0]
    assert report_record["evidence_audit"]["status"] == "partial"
    assert report_record["evidence_audit"]["incomplete_refs"] == ["memory:chosen@v1"]


def test_auto_research_does_not_force_a_report_boundary_or_tool_choice():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_task_validation_child.ts").read_text(encoding="utf-8")
    approvals = (Path(__file__).resolve().parents[1] / "demo" / "pi_auto_research_approvals.ts").read_text(encoding="utf-8")
    # Evidence reads and report submission are Agent decisions. There is no
    # hidden read-count phase switch or provider-side forced tool choice.
    assert 'pi.on("before_provider_request"' not in source
    assert 'tool_choice: "required"' not in source
    assert 'parallel_tool_calls: false' not in source
    assert "Do not propose another delivery" not in source
    assert "resolve pending approval first" not in approvals
    assert "pi.setActiveTools" not in approvals


def test_task_shutdown_removes_only_runtime_cache_and_seals_audit(tmp_path):
    root = tmp_path / "owned"
    _run_fixture(root, "treatment", context_max_chars=18000,
                 extra_env={"PI_AUTORESEARCH_OWNS_TASK": "enabled"}, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "fact", "content": "Retain audit."}},
        *[{"name": "benchmark_probe", "arguments": {}} for _ in range(4)],
    ])
    assert not (root / "task-context-cache").exists()
    assert records(root, "task-memory.jsonl")[0]["content"] == "Retain audit."
    marker = json.loads((root / ".task-scope.json").read_text())
    assert marker["status"] == "closed"
    assert seal_task_scope(root)  # idempotent


def test_cleanup_rejects_wrong_task_root(tmp_path):
    root = tmp_path / "wrong"
    root.mkdir()
    (root / ".task-scope.json").write_text(json.dumps({"format": "task-local-scope-v1", "root": str(tmp_path)}))
    with pytest.raises(ValueError, match="mismatched"):
        seal_task_scope(root)


def test_task_shutdown_clears_submitted_research_report_cache(tmp_path):
    root = tmp_path / "research-cache"
    root.mkdir()
    (root / ".task-scope.json").write_text(json.dumps({
        "format": "task-local-scope-v1", "task_id": "research-cache",
        "root": str(root.resolve()), "root_fingerprint": "test",
    }), encoding="utf-8")
    cache = root / "task-context-cache" / "auto-research-child-results"
    cache.mkdir(parents=True)
    (cache / "auto-research-1.json").write_text('{"format":"auto-research-report-v1"}', encoding="utf-8")

    assert seal_task_scope(root)
    assert not (root / "task-context-cache").exists()


def test_arc_research_window_is_not_a_fixed_four_mutation_quota(tmp_path):
    root = tmp_path / "no-quota"
    events = _run_fixture(root, "treatment", arc_compact=True, steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": f"part-{i}", "content": f"Candidate {i}"}}
        for i in range(6)
    ])
    assert len(records(root, "task-memory.jsonl")) == 6
    assert not [e for e in results(events, "task_memory") if e.get("isError")]


def test_closed_scope_rejects_reuse_but_allows_explicit_same_task_resume(tmp_path):
    node, _ = _pi_cli()
    root = tmp_path / "scope"
    module_uri = (Path(__file__).resolve().parents[1] / "demo/pi_task_scope.ts").as_uri()
    code = f"import {{ensureTaskScope}} from {json.dumps(module_uri)}; ensureTaskScope({json.dumps(str(root))});"
    env = {**os.environ, "PI_AUTORESEARCH_TASK_ID": "scope-test", "PI_AUTORESEARCH_RESUME_TASK": "disabled"}
    def check():
        return subprocess.run([node, "--input-type=module", "-e", code], env=env, capture_output=True, text=True)
    assert check().returncode == 0
    seal_task_scope(root)
    rejected = check()
    assert rejected.returncode != 0 and "task scope is closed" in rejected.stderr
    env["PI_AUTORESEARCH_RESUME_TASK"] = "enabled"
    env["PI_AUTORESEARCH_TASK_ID"] = "another-task"
    assert "task scope mismatch" in check().stderr
    env["PI_AUTORESEARCH_TASK_ID"] = "scope-test"
    assert check().returncode == 0


def test_arc_current_supplies_frame_and_explicit_full_restores_same_version(tmp_path):
    class State(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"state": "NOT_FINISHED", "levels_completed": 0,
                               "frames": [[[1, 2], [3, 4]]], "agent_available_actions": ["ACTION1"],
                               "action_budget": {"used": 0, "maximum": 110}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), State)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    project = Path(__file__).resolve().parents[1]
    try:
        # ARC extension installs the shared surface itself; avoid loading it twice.
        from autoresearch_pi.pi_kernel import PiKernel
        node, cli = _pi_cli()
        root = tmp_path / "frame"
        root.mkdir()
        steps = [{"name": "task_harness", "arguments": {"action": "start"}}] + [
            {"name": "arc_state", "arguments": {"request": request}} for request in ("current", "current", "full")]
        with PiKernel([node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
                       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
                       "--extension", str(project / "demo/pi_arc_agi_3_extension.ts"),
                       "--extension", str(project / "tests/pi_external_benchmark_provider.ts")], cwd=str(root), env={
                           "PI_AUTORESEARCH_E2E_ROOT": str(root), "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
                           "PI_AUTORESEARCH_VARIANT": "treatment", "PI_ARC_EXECUTION_GATE": "enabled",
                           "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}", "PI_EXTERNAL_STEPS": json.dumps(steps),
                       }, timeout=60) as kernel:
            try:
                kernel.prompt("Exercise frame retrieval without submitting environment actions.")
            except RuntimeError as error:
                raise AssertionError(kernel.stderr_tail) from error
            events = kernel.wait_for_agent_events(timeout=60)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    states = results(events, "arc_state")
    assert [s["result"]["details"]["frame_returned"] for s in states] == [True, False, True]
    assert states[0]["result"]["content"][0]["text"] == states[2]["result"]["content"][0]["text"]
