"""Small real-Pi, offline-provider checks for the task-local working set."""
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.task_scope import seal_task_scope
from autoresearch_pi.subagent_broker import SubagentBroker
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def records(root, name):
    path = root / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def results(events, name):
    return [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == name]


def wait_for_broker_job(root, run_id, timeout=10):
    status_path = root / "task-context-cache" / "auto-research-broker" / f"{run_id}.json"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if status_path.exists():
            status = json.loads(status_path.read_text(encoding="utf-8"))
            if status.get("status") != "active":
                return status
        time.sleep(0.05)
    raise AssertionError(f"broker job {run_id} did not finish")


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


def test_router_normalizes_unambiguous_agent_dataflow_program_aliases():
    result = run_router_helper(
        "router.normalizeComputationProgram(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value={"kind": "pick_filter_map_count", "steps": [
            {"op": "pick", "source": "$.items", "output": "items"},
            {"op": "filter", "input": "items", "predicate": "enabled === true"},
            {"op": "map", "input": "selected", "field": "value"},
            {"op": "count", "input": "ones", "output": "count"},
        ]},
    )
    assert result["steps"] == [
        {"kind": "pick", "source": "input", "field": "items"},
        {"kind": "filter", "field": "enabled", "equals": True},
        {"kind": "map", "fields": ["value"]},
        {"kind": "count"},
    ]


def test_router_normalizes_path_and_expression_program_aliases():
    result = run_router_helper(
        "router.normalizeComputationProgram(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value={"steps": [
            {"op": "pick", "path": "input.items"},
            {"kind": "filter", "field": "enabled", "equals": True},
            {"op": "map", "expr": "item.value"},
            {"kind": "count"},
        ]},
    )
    assert result["steps"] == [
        {"kind": "pick", "source": "input", "field": "items"},
        {"kind": "filter", "field": "enabled", "equals": True},
        {"kind": "map", "fields": ["value"]},
        {"kind": "count"},
    ]


def test_router_normalizes_constant_map_before_count_without_evaluating_code():
    result = run_router_helper(
        "router.normalizeComputationProgram(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value={"steps": [
            {"kind": "pick", "source": "input", "field": "items"},
            {"kind": "filter", "field": "enabled", "equals": True},
            {"op": "map", "expr": "1"},
            {"kind": "count"},
        ]},
    )
    assert result["steps"][2] == {"kind": "map", "fields": []}


def test_router_normalizes_structured_predicate_and_jsonpath_count_pipeline():
    result = run_router_helper(
        "router.normalizeComputationProgram(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value={"steps": [
            {"op": "pick", "path": "$.items"},
            {"op": "filter", "predicate": {"field": "enabled", "equals": True}},
            {"op": "map", "expr": "constant(1)"},
            {"kind": "count"},
        ]},
    )
    assert result["steps"] == [
        {"kind": "pick", "source": "input", "field": "items"},
        {"kind": "filter", "field": "enabled", "equals": True},
        {"kind": "map", "fields": []},
        {"kind": "count"},
    ]


def test_router_compiles_boolean_filter_shorthand_from_agent_schema():
    delivery = harness_delivery(
        "boolean-filter", "computation", "boolean-filter", "Count enabled items.",
        input_schema={"items": {"type": "array", "items": {
            "value": "string", "enabled": "boolean",
        }}},
        program={"steps": [
            {"kind": "pick", "field": "items", "fields": ["items"]},
            {"kind": "filter", "field": "enabled", "fields": ["enabled"]},
            {"kind": "map", "field": "enabled", "fields": ["enabled"]},
            {"kind": "count", "field": "items", "fields": ["items"]},
        ]},
    )
    result = run_router_helper(
        "router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value=delivery,
    )
    assert result["program"]["steps"][1]["equals"] is True


def test_router_compiles_boolean_filter_shorthand_from_json_schema():
    delivery = harness_delivery(
        "json-schema-filter", "computation", "json-schema-filter", "Count enabled items.",
        input_schema={"type": "object", "properties": {"items": {
            "type": "array", "items": {"type": "object", "properties": {
                "value": {"type": "string"}, "enabled": {"type": "boolean"},
            }},
        }}},
        program={"steps": [
            {"kind": "pick", "source": "input", "field": "items"},
            {"kind": "filter", "field": "enabled"},
            {"kind": "map", "fields": []},
            {"kind": "count"},
        ]},
    )
    result = run_router_helper(
        "router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value=delivery,
    )
    assert result["program"]["steps"][1] == {
        "kind": "filter", "field": "enabled", "equals": True,
    }


def test_router_repairs_unambiguous_computation_delivery_category_aliases():
    delivery = harness_delivery(
        "destination-check", "computation", "destination-check",
        "Classify a destination patch from a read-only adapter frame.",
        input_schema={"block_bbox": "object"},
        program={"steps": [
            {"kind": "adapter_call", "impl": "arc_state"},
            {"kind": "select", "source": "frame", "field": "destination_patch"},
            {"kind": "count", "field": "cells_equal_floor"},
            {"kind": "emit_observation"},
        ]},
    )
    # This exact category-copy error occurred in a real child report: the
    # execution enum was copied into reasoning, and adapter operation was
    # described as pure computation.
    delivery["reasoning"] = "pure_computation"
    delivery["execution"] = "pure_computation"

    result = run_router_helper(
        "router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value=delivery,
    )

    assert result["reasoning"] == "none"
    assert result["execution"] == "adapter_operation"
    assert result["program"]["steps"][0] == {
        "kind": "adapter_call", "implementation_ref": "arc_state",
    }
    assert result["program"]["steps"][1]["fields"] == ["destination_patch"]


def test_router_unions_method_evidence_into_delivery_basis_refs_without_inventing_refs():
    delivery = harness_delivery(
        "bounded-method", "procedure", "bounded-method", "Use a bounded method.",
        method={
            "problem": "Decide a bounded case.", "inputs": ["case"],
            "invariants": ["shape is stable"], "parameters": ["case"],
            "steps": ["inspect", "decide"], "decision_points": ["branch"],
            "stop_conditions": ["decision returned"], "failure_modes": ["unknown case"],
            "construction_evidence_refs": ["observation:a@v1"],
            "contrast_evidence_refs": ["observation:b@v1"],
            "next_use": "next case", "predicted_semantic_result": "one decision",
            "falsifier": "a contradictory outcome",
        },
    )
    delivery["basis_refs"] = ["observation:a@v1"]

    result = run_router_helper(
        "router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value=delivery,
    )

    assert result["basis_refs"] == ["observation:a@v1", "observation:b@v1"]


def test_router_rejects_filter_without_predicate_when_schema_is_not_boolean():
    delivery = harness_delivery(
        "ambiguous-filter", "computation", "ambiguous-filter", "Filter named items.",
        input_schema={"items": {"type": "array", "items": {"name": "string"}}},
        program={"steps": [
            {"kind": "pick", "field": "items"},
            {"kind": "filter", "field": "name"},
            {"kind": "count"},
        ]},
    )
    error = run_router_helper(
        "(()=>{try{router.normalizeHarnessDelivery(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT));return null}catch(error){return String(error.message)}})()",
        input_value=delivery,
    )
    assert "requires an explicit predicate" in error


def run_research_protocol_helper(expression: str, *, input_value=None):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_auto_research_protocol.ts"
    script = (
        f'import * as protocol from {json.dumps(helper.as_uri())};'
        f"console.log(JSON.stringify({expression}));"
    )
    env = os.environ.copy()
    if input_value is not None:
        env["AUTORESEARCH_PROTOCOL_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        env=env,
        check=True,
    )
    return json.loads(completed.stdout)


def run_method_runtime_helper(expression: str, *, input_value=None):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_research_method_runtime.ts"
    script = (
        f'import * as runtime from {json.dumps(helper.as_uri())};'
        f"console.log(JSON.stringify({expression}));"
    )
    env = os.environ.copy()
    if input_value is not None:
        env["AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True, env=env,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_versioned_method_resource_uses_durable_id_instead_of_display_name():
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_task_resource_identity.ts"
    script = (
        f'import * as store from {json.dumps(helper.as_uri())};'
        'const row={method_id:"method-run-1",name:"friendly-label",version:3};'
        'console.log(JSON.stringify({name:store.taskResourceName(row)}));'
    )
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "name": "method-run-1",
    }


def test_cross_context_comparison_is_causal_neutral_and_finds_outcome_contrast():
    observations = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {"action": "MOVE"},
         "arc_outcome": {"levels_completed": 0, "observation_delta": {"changed_cells": 2}}},
        {"observation_id": "o2", "tool_name": "arc_action", "input": {"action": "RESET"},
         "arc_outcome": {"levels_completed": 0, "public_transition": {"reset": True}}},
        {"observation_id": "o3", "tool_name": "arc_action", "input": {"action": "MOVE"},
         "arc_outcome": {"levels_completed": 0, "observation_delta": {"changed_cells": 0}}},
    ]
    result = run_method_runtime_helper(
        "runtime.buildCrossContextComparison(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"researchLineRef": "research_line:x@v1", "observations": observations,
                     "explicitEvidenceRefs": ["o1"]},
    )
    assert result["causal_interpretation"] is False
    assert result["semantic_equivalence_claimed"] is False
    assert {"o1", "o3"} <= set(result["selected_evidence_refs"])
    assert result["outcome_contrasts"][0]["context_count"] == 2
    cards = {card["observation_ref"]: card for card in result["evidence_cards"]}
    assert cards["o1"]["public_result"]["observation_delta"]["changed_cells"] == 2
    assert cards["o1"]["canonical_detail_ref"] == "observation:o1@v1"
    assert cards["o3"]["immediate_predecessor"]["action_signature"] == "arc_action:RESET"
    assert "interpretation" not in json.dumps(cards)


def test_cross_context_child_view_keeps_cards_but_removes_duplicate_case_metadata():
    comparison = {
        "format": "auto-research-cross-context-comparison-v1",
        "research_line_ref": "research_line:x@v1",
        "selection_policy": "exact_refs_grouped_by_runtime_context_and_action_signature",
        "causal_interpretation": False,
        "semantic_equivalence_claimed": False,
        "explicit_evidence_refs": ["o1", "o2"],
        "selected_evidence_refs": ["o1", "o2"],
        "context_ids": ["large-context-1", "large-context-2"],
        "situation_context_ids": ["large-context-1", "large-context-2"],
        "episode_context_ids": ["level:0:attempt:1"],
        "evidence_cards": [
            {"observation_ref": "o1", "episode_context_id": "level:0:attempt:1", "context_id": "large-context-1"},
            {"observation_ref": "o2", "episode_context_id": "level:0:attempt:1", "context_id": "large-context-2"},
        ],
        "outcome_contrasts": [{"action_signature": "arc_action:MOVE", "outcomes": ["changed", "unchanged"],
                               "context_count": 2, "episode_context_count": 1,
                               "cases": [{"observation_ref": "o1", "context_id": "large-context-1"},
                                         {"observation_ref": "o2", "context_id": "large-context-2"}]}],
        "repeated_cases": [], "prior_research_refs": [], "prior_method_refs": [],
        "instruction": "Compare without assuming causality.", "recordedAt": "later",
    }
    view = run_method_runtime_helper(
        "runtime.crossContextComparisonForChild(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value=comparison,
    )
    assert view["evidence_cards"] == comparison["evidence_cards"]
    assert view["outcome_contrasts"][0]["case_refs"] == ["o1", "o2"]
    assert "cases" not in view["outcome_contrasts"][0]
    assert "context_ids" not in view
    assert "situation_context_ids" not in view
    assert "recordedAt" not in view


def test_cross_context_comparison_distinguishes_situations_inside_one_online_life():
    observations = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {
            "action": "MOVE", "decision": {"hypothesis_id": "route", "hypothesis_version": 1}},
         "result_text": 'changed_cells":52, bbox={"top":10,"left":20,"bottom":19,"right":24}',
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 52},
                         "public_transition": {"level_before": 0, "level_changed": False}}},
        {"observation_id": "o2", "tool_name": "arc_action", "input": {
            "action": "MOVE", "decision": {"hypothesis_id": "route", "hypothesis_version": 1}},
         "result_text": 'changed_cells":0, bbox=null',
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 0},
                         "public_transition": {"level_before": 0, "level_changed": False}}},
    ]
    comparison = run_method_runtime_helper(
        "runtime.buildCrossContextComparison(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": observations, "explicitEvidenceRefs": ["o1", "o2"]},
    )
    assert comparison["episode_context_ids"] == ["level:0:attempt:1"]
    assert len(comparison["situation_context_ids"]) == 2
    cases = comparison["outcome_contrasts"][0]["cases"]
    assert {case["effect_shape"] for case in cases} == {"bbox:2-4-3-4", "no_change"}
    assert comparison["outcome_contrasts"][0]["episode_context_count"] == 1
    cards = comparison["evidence_cards"]
    assert [card["sequence_index"] for card in cards] == [1, 2]
    assert cards[0]["public_result"]["observation_delta"] == {
        "changed_cells": 52, "bbox": {"top": 10, "left": 20, "bottom": 19, "right": 24},
    }

    proposal = harness_delivery(
        "d-online", "procedure", "online-probe", "Compare a move with a refusal.",
        basis_refs=["o1", "o2"],
        method={"problem": "Choose a probe under irreversible state transitions", "inputs": ["two situations"],
                "invariants": ["same action signature"], "parameters": ["effect shape"],
                "steps": ["compare predicted and observed effects"],
                "decision_points": ["whether the action changes state"], "stop_conditions": ["a contrast is observed"],
                "failure_modes": ["treating two positions as identical"],
                "construction_evidence_refs": ["o1"], "contrast_evidence_refs": ["o2"],
                "next_use": "next irreversible probe", "predicted_semantic_result": "one prediction is rejected",
                "falsifier": "both situation predictions remain indistinguishable"},
    )
    method = run_method_runtime_helper(
        "runtime.methodRecordsFromReport(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))[0]",
        input_value={"runId": "online", "reportRef": "research_report:online@v1",
                     "report": {"evidence_refs": ["o1", "o2"],
                                "harness_proposals": [{"delivery": proposal}]},
                     "comparison": comparison},
    )
    assert method["generalization_basis"] == "cross_context"
    assert method["generalization_scope"] == "cross_situation_within_episode"
    assert method["episode_context_ids"] == ["level:0:attempt:1"]


def test_runtime_discovers_cross_context_research_only_after_distinct_situations():
    same_situation = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 1}}},
        {"observation_id": "o2", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 1}}},
    ]
    assert run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": same_situation},
    ) == []

    distinct_situations = [
        same_situation[0],
        {"observation_id": "contrast", "tool_name": "arc_action", "input": {"action": "ACTION2"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 3}}},
        {**same_situation[1], "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                                               "observation_delta": {"changed_cells": 0}}},
    ]
    candidates = run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": distinct_situations},
    )
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["action_signature"] == "arc_action:ACTION1"
    assert candidate["construction_evidence_refs"] == ["o1", "o2"]
    assert candidate["intervening_evidence_refs"] == ["contrast"]
    assert candidate["evidence_refs"] == ["o1", "o2", "contrast"]
    assert len(candidate["situation_context_ids"]) == 2
    assert candidate["research_call"] == {
        "action": "start",
        "research_candidate_ref": f"research_candidate:{candidate['candidate_id']}@v1",
    }
    assert candidate["research_parameters"]["scope"] == "research_method"
    assert candidate["research_parameters"]["research_kind"] == "capability"
    assert candidate["causal_interpretation"] is False
    assert candidate["semantic_equivalence_claimed"] is False


def test_runtime_does_not_treat_reset_attempt_identity_as_a_distinct_situation():
    observations = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 1,
                                               "bbox": {"top": 2, "left": 3, "bottom": 2, "right": 3}}}},
        {"observation_id": "reset", "tool_name": "arc_action", "input": {"action": "RESET"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "public_transition": {"reset": True}}},
        {"observation_id": "o2", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 1,
                                               "bbox": {"top": 2, "left": 3, "bottom": 2, "right": 3}}}},
    ]
    candidates = run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": observations},
    )
    assert candidates == []


def test_runtime_uses_pre_action_state_instead_of_result_to_define_situations():
    def observation(name, fingerprint, changed):
        return {"observation_id": name, "tool_name": "arc_action", "input": {"action": "ACTION1"},
                "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                                "pre_action_state": {"fingerprint": fingerprint, "state": "NOT_FINISHED",
                                                     "levels_completed": 0, "available_actions": ["ACTION1"]},
                                "observation_delta": {"changed_cells": changed}}}

    same_pre_state = [observation("o1", "a" * 64, 1), observation("o2", "a" * 64, 9)]
    assert run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": same_pre_state},
    ) == []

    different_pre_states = [observation("o1", "a" * 64, 1), observation("o2", "b" * 64, 1)]
    candidates = run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": different_pre_states},
    )
    assert len(candidates) == 1
    assert candidates[0]["situation_basis"] == "pre_action_state"
    assert all("basis:pre_action_state" in item for item in candidates[0]["situation_context_ids"])


def test_runtime_does_not_open_generic_candidate_from_exact_harness_method_use():
    observations = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {"action": "ACTION2"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 2}}},
        {"observation_id": "method-use", "tool_name": "arc_action", "input": {
            "action": "ACTION2", "decision": {
                "basis_refs": ["skill:bounded-method@v1"],
                "prediction": "a visible change", "falsifier": "no visible change",
            }},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 5}}},
    ]
    candidates = run_method_runtime_helper(
        "runtime.buildCrossContextResearchCandidates(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": observations},
    )
    assert candidates == []


def test_cross_context_evidence_cards_extract_public_groups_without_semantic_labels():
    observations = [{
        "observation_id": "o1", "tool_name": "arc_action", "input": {"action": "ACTION1"},
        "result_text": (
            'Current transition state=NOT_FINISHED changed_cells=52, '
            'bbox={"top":40,"left":13,"bottom":62,"right":38}. '
            'Changed groups: {"count":2,"sizes":[50,2],"boxes":['
            '{"top":40,"left":34,"bottom":49,"right":38},'
            '{"top":61,"left":13,"bottom":62,"right":13}]}.'
            ' These are separate groups of changed cells; they do not identify objects.'
        ),
        "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                        "public_transition": {"level_before": 0, "level_after": 0, "level_changed": False},
                        "action_budget": {"used": 1, "maximum": 10}},
    }]
    comparison = run_method_runtime_helper(
        "runtime.buildCrossContextComparison(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))",
        input_value={"observations": observations, "explicitEvidenceRefs": ["o1"]},
    )
    card = comparison["evidence_cards"][0]
    assert card["public_result"]["observation_delta"] == {
        "changed_cells": 52, "bbox": {"top": 40, "left": 13, "bottom": 62, "right": 38},
    }
    assert card["public_result"]["changed_groups"] == {
        "count": 2, "sizes": [50, 2], "boxes": [
            {"top": 40, "left": 34, "bottom": 49, "right": 38},
            {"top": 61, "left": 13, "bottom": 62, "right": 13},
        ],
    }
    assert not ({"object", "goal", "movement", "mechanism"} & set(card["public_result"]))


def test_method_lifecycle_requires_actual_use_for_validation():
    method = {"method_id": "m1", "version": 1, "maturity": "candidate_method",
              "resource_refs": ["skill:probe@v1"], "application_refs": [], "validation_refs": []}
    trial = run_method_runtime_helper(
        "runtime.advanceMethodApplication(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).method, "
        "JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).event)",
        input_value={"method": method, "event": {"resourceRefs": ["skill:probe@v1"],
                                                   "applicationRef": "adoption:1"}},
    )
    assert trial["maturity"] == "trial"
    exposure_only = run_method_runtime_helper(
        "runtime.advanceMethodAssessment(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).method, "
        "JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).assessment)",
        input_value={"method": trial, "assessment": {"verdict": "supported", "assessmentRef": "a1",
                                                        "observationRefs": ["exposure-1"], "actualUseRefs": []}},
    )
    assert exposure_only["maturity"] == "trial"
    used = run_method_runtime_helper(
        "runtime.advanceMethodAssessment(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).method, "
        "JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).assessment)",
        input_value={"method": exposure_only, "assessment": {"verdict": "supported", "assessmentRef": "a2",
                                                                "observationRefs": ["tool-use-1"],
                                                                "actualUseRefs": ["tool-use-1"]}},
    )
    assert used["maturity"] == "validated_within_scope"


def test_method_report_without_explicit_abstraction_remains_experience():
    proposal = harness_delivery("d1", "procedure", "probe", "Use the observed sequence.",
                                basis_refs=["o1"])
    result = run_method_runtime_helper(
        "runtime.methodRecordsFromReport(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))[0]",
        input_value={"runId": "r1", "reportRef": "research_report:r1@v1",
                     "researchLineRef": "research_line:r@v1",
                     "report": {"evidence_refs": ["o1"], "harness_proposals": [{"delivery": proposal}]},
                     "comparison": {"selected_evidence_refs": ["o1"], "context_ids": ["level:0:attempt:1"]}},
    )
    assert result["maturity"] == "experience"


def test_explicit_grounded_method_becomes_candidate_not_validated():
    proposal = harness_delivery(
        "d1", "procedure", "probe", "Compare predictions before acting.", basis_refs=["o1", "o2"],
        method={"problem": "Choose a discriminating probe", "inputs": ["two hypotheses"],
                "invariants": ["predictions are written before action"], "parameters": ["action budget"],
                "steps": ["list alternatives", "select a differing prediction"],
                "decision_points": ["whether predictions differ"], "stop_conditions": ["budget exhausted"],
                "failure_modes": ["no reachable differentiating state"],
                "construction_evidence_refs": ["o1"], "contrast_evidence_refs": ["o2"],
                "next_use": "next ambiguous transition", "predicted_semantic_result": "one explanation loses support",
                "falsifier": "both explanations predict and observe the same result"},
    )
    result = run_method_runtime_helper(
        "runtime.methodRecordsFromReport(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))[0]",
        input_value={"runId": "r1", "reportRef": "research_report:r1@v1",
                     "researchLineRef": "research_line:r@v1",
                     "report": {"evidence_refs": ["o1", "o2"], "harness_proposals": [{"delivery": proposal}]},
                     "comparison": {"selected_evidence_refs": ["o1", "o2"],
                                    "context_ids": ["level:0:attempt:1", "level:0:attempt:2"],
                                    "outcome_contrasts": [{"cases": [
                                        {"observation_ref": "o1", "context_id": "level:0:attempt:1"},
                                        {"observation_ref": "o2", "context_id": "level:0:attempt:2"},
                                    ]}]}},
    )
    assert result["maturity"] == "candidate_method"
    assert result["context_ids"] == ["level:0:attempt:1", "level:0:attempt:2"]


def test_method_contexts_are_limited_to_the_cases_the_method_cites():
    proposal = harness_delivery(
        "d1", "procedure", "probe", "Compare matching cases.", basis_refs=["o1"],
        method={"problem": "Compare matching cases", "inputs": ["case"],
                "invariants": ["same action"], "parameters": ["attempt"],
                "steps": ["compare"], "decision_points": [], "stop_conditions": ["compared"],
                "failure_modes": [], "construction_evidence_refs": ["o1"],
                "contrast_evidence_refs": [], "next_use": "next case",
                "predicted_semantic_result": "same class", "falsifier": "different class"},
    )
    result = run_method_runtime_helper(
        "runtime.methodRecordsFromReport(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))[0]",
        input_value={"runId": "r1", "reportRef": "research_report:r1@v1",
                     "researchLineRef": "research_line:r@v1",
                     "report": {"evidence_refs": ["o1"], "harness_proposals": [{"delivery": proposal}]},
                     "comparison": {"selected_evidence_refs": ["o1", "o2"],
                                    "context_ids": ["level:0:attempt:1", "level:0:attempt:2"],
                                    "repeated_cases": [{"cases": [
                                        {"observation_ref": "o1", "context_id": "level:0:attempt:1"},
                                        {"observation_ref": "o2", "context_id": "level:0:attempt:2"},
                                    ]}]}}
    )
    assert result["context_ids"] == ["level:0:attempt:1"]
    assert result["generalization_basis"] == "single_context"


def test_method_feedback_handoff_carries_construction_and_actual_use_resources():
    handoff = run_method_runtime_helper(
        "runtime.buildMethodFeedbackHandoff(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).method, "
        "JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT).assessment)",
        input_value={
            "method": {"method_id": "m1", "version": 3, "name": "probe",
                       "research_line_ref": "research_line:r@v1",
                       "source_run_ref": "research_run:r1@v1",
                       "source_report_ref": "research_report:r1@v1",
                       "construction_evidence_refs": ["o1", "o2"],
                       "contrast_evidence_refs": ["o3"],
                       "resource_refs": ["tool:probe@v1"],
                       "actual_use_observation_refs": ["task-tool-use-1"]},
            "assessment": {"effect_assessment_id": "a1", "verdict": "supported",
                           "consequence": "matched", "observation_refs": ["task-tool-use-1"]},
        },
    )
    assert handoff["evidence_refs"] == [
        "observation:o1@v1", "observation:o2@v1", "observation:o3@v1",
        "harness_observation:task-tool-use-1@v1",
    ]
    assert handoff["context_window"]["context_refs"] == handoff["evidence_refs"]


def run_harness_protocol_helper(expression: str, *, input_value=None):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_harness_protocol.ts"
    script = (
        f'import * as protocol from {json.dumps(helper.as_uri())};'
        f"console.log(JSON.stringify({expression}));"
    )
    env = os.environ.copy()
    if input_value is not None:
        env["HARNESS_PROTOCOL_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        env=env,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return json.loads(completed.stdout)


def test_harness_protocol_keeps_auto_research_out_of_change_boundary():
    request = {
        "action": "change",
        "changes": [{"operation": "retire", "target_ref": "skill:probe@v1"}],
        "decision": {"basis_refs": [], "reason": "The method failed twice.", "expected": "No stale use."},
    }
    normalized = run_harness_protocol_helper(
        "protocol.normalizeCapabilityRequest(JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT))",
        input_value=request,
    )
    assert normalized["action"] == "change"
    error = run_harness_protocol_helper(
        "(()=>{try{protocol.assertParentChangeSource('auto_research','change');return null}catch(error){return String(error.message)}})()",
    )
    assert "cannot invoke" in error


def test_harness_protocol_normalizes_parent_component_aliases_before_routing():
    state = run_harness_protocol_helper(
        "protocol.classifyHarnessChangeTargets(JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT))",
        input_value={"layer": "task_state", "name": "map", "content": "verified mapping"},
    )
    assert state == ["memory"]
    policy = run_harness_protocol_helper(
        "protocol.normalizeSemanticCandidate(JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT))",
        input_value={"component": "task_prompt", "name": "guidance", "content": "use the verified map"},
    )
    assert policy["semantic_kind"] == "plan"
    assert policy["execution"] == "text"
    assert policy["prompt_channel"] == "task_prompt"


def test_thin_harness_router_uses_semantics_and_rejects_skill_downgrade():
    procedure = {"semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse", "reasoning": "bounded_judgment"}
    assert run_harness_protocol_helper(
        "protocol.classifySemanticKind(JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT))",
        input_value=procedure,
    ) == "skill"
    invalid = {**procedure, "reuse": "one_off"}
    error = run_harness_protocol_helper(
        "(()=>{try{protocol.classifySemanticKind(JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT));return null}catch(error){return String(error.message)}})()",
        input_value=invalid,
    )
    assert "expected_reuse" in error


def test_unified_change_protocol_routes_prompt_tools_and_subagents():
    candidates = [
        {
            "semantic_kind": "fact", "execution": "text", "prompt_channel": "task_prompt",
            "context_visibility": "always",
        },
        {
            "semantic_kind": "fact", "execution": "text", "prompt_channel": "system_prompt",
            "context_visibility": "always", "stability": "stable_in_scope",
            "scope": {"kind": "task_wide", "statement": "whole task"},
            "basis_refs": ["context:contract@v1"],
            "system_prompt_basis": {"source": "explicit_task_contract", "evidence_refs": ["context:contract@v1"]},
        },
        {
            "semantic_kind": "computation", "execution": "pure_computation",
            "program": {"steps": [{"kind": "select", "source": "input", "path": "value"}]},
        },
        {
            "semantic_kind": "role", "execution": "model_delegation", "tools": ["read"],
        },
    ]
    output = run_harness_protocol_helper(
        "JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT).map(protocol.classifyHarnessChangeTarget)",
        input_value=candidates,
    )
    assert output == ["memory", "system_prompt", "tool", "subagent"]


def test_unified_change_protocol_compiles_system_prompt_overlay_after_each_base_component():
    common = {
        "prompt_channel": "system_prompt", "context_visibility": "always",
        "stability": "stable_in_scope", "scope": {"kind": "task_wide", "statement": "whole task"},
        "basis_refs": ["observation:validated@v1"],
        "system_prompt_basis": {"source": "validated_environment_invariant", "evidence_refs": ["observation:validated@v1"]},
    }
    candidates = [
        {"semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse", "reasoning": "bounded_judgment", **common},
        {"semantic_kind": "computation", "execution": "pure_computation", "program": {"steps": [{"kind": "select", "source": "input", "path": "value"}]}, **common},
        {"semantic_kind": "role", "execution": "model_delegation", "tools": ["read"], **common},
    ]
    output = run_harness_protocol_helper(
        "JSON.parse(process.env.HARNESS_PROTOCOL_TEST_INPUT).map(protocol.classifyHarnessChangeTargets)",
        input_value=candidates,
    )
    assert output == [["skill", "system_prompt"], ["tool", "system_prompt"], ["subagent", "system_prompt"]]


def test_research_plan_enforces_dependencies_parent_release_and_concurrency():
    plan_input = {
        "goal": "Resolve a compound research question.",
        "complexity_assessment": {
            "level": "compound",
            "rationale": "Three evidence-dependent deliverables.",
        },
        "concurrency_limit": 1,
        "nodes": [
            {"node_id": "a", "question": "Establish the base evidence.", "completion_contract": "Produce evidence A."},
            {"node_id": "b", "question": "Interpret A.", "depends_on": ["a"],
             "activation_policy": "parent_release", "completion_contract": "Produce conclusion B."},
            {"node_id": "c", "question": "Measure A independently.", "depends_on": ["a"],
             "activation_policy": "after_dependencies", "completion_contract": "Produce measurement C."},
        ],
    }
    expression = """
(() => {
  const input = JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT);
  let plan = protocol.createResearchPlan(input, 'research-plan-1');
  const initial = protocol.researchPlanView(plan);
  plan = protocol.transitionResearchNode(plan, 'a', 'active');
  const whileActive = protocol.researchPlanView(plan);
  plan = protocol.transitionResearchNode(plan, 'a', 'completed', {result_ref:'research_run:auto-research-1@v1'});
  const afterA = protocol.researchPlanView(plan);
  plan = protocol.releaseResearchNode(plan, 'b');
  const released = protocol.researchPlanView(plan);
  plan = protocol.transitionResearchNode(plan, 'c', 'active');
  const saturated = protocol.researchPlanView(plan);
  return {initial, whileActive, afterA, released, saturated};
})()
"""
    result = run_research_protocol_helper(expression, input_value=plan_input)
    assert result["initial"]["runnable_node_ids"] == ["a"]
    assert result["whileActive"]["runnable_node_ids"] == []
    assert result["afterA"]["nodes"]["b"]["status"] == "pending"
    assert result["afterA"]["nodes"]["b"]["wait_reason"] == "parent_release"
    assert result["afterA"]["runnable_node_ids"] == ["c"]
    assert result["released"]["runnable_node_ids"] == ["b", "c"]
    assert result["released"]["available_slots"] == 1
    assert result["released"]["schedulable_node_ids"] == ["b"]
    assert result["saturated"]["runnable_node_ids"] == ["b"]
    assert result["saturated"]["available_slots"] == 0
    assert result["saturated"]["schedulable_node_ids"] == []


def test_research_workset_preserves_required_state_and_pages_optional_context():
    payload = {
        "goal": "Keep this exact research goal.",
        "constraints": ["read only", "cite evidence"],
        "current_node": {"node_id": "map", "completion_contract": "Return a verified map."},
        "checkpoint": {"cursor": "row-7", "next_step": "Inspect row 8", "draft_findings": ["wall at row 7"]},
        "resource_refs": ["research_run:auto-research-1@v1"],
        "selected_context": "x" * 4000,
    }
    result = run_research_protocol_helper(
        "protocol.buildResearchWorkset(JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT), 900)",
        input_value=payload,
    )
    assert result["serialized_chars"] <= 900
    assert result["goal"] == payload["goal"]
    assert result["constraints"] == payload["constraints"]
    assert result["checkpoint"]["cursor"] == "row-7"
    assert result["resource_refs"] == payload["resource_refs"]
    assert result["projection"]["truncated"] is True
    assert result["projection"]["retrieve_on_demand"] is True


def test_child_provider_prompt_uses_one_total_budget_and_preserves_required_work_state(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "bounded-child-workset"
    root.mkdir(parents=True)
    (root / "execution-observations.jsonl").write_text(json.dumps({
        "observation_id": "large-observation",
        "tool_name": "fixture_state",
        "result_text": "large-context:" + "x" * 9000,
    }) + "\n", encoding="utf-8")
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "The bounded input was sufficient.", "findings": [], "evidence_refs": [],
        "alternatives": [], "limitations": [], "validation_plan": "Return to parent.",
        "harness_proposals": [],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_CHILD_INPUT_MAX_CHARS": "2400",
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Preserve this exact bounded research goal.",
            "constraints": ["read only", "return exact evidence references"],
            "complexity_assessment": {"level": "simple", "rationale": "One bounded conclusion."},
            "context_window": {"recent_observations": 1, "max_chars": 10000},
        }}],
    )
    assert not results(events, "auto_research")[0].get("isError")
    prompt_path = root / ".task-child-prompts" / "auto-research-1_continuation-1.txt"
    prompt = prompt_path.read_text(encoding="utf-8")
    assert len(prompt) <= 2400
    assert "Preserve this exact bounded research goal." in prompt
    assert "read only" in prompt
    assert '"truncated":true' in prompt
    assert '"retrieve_on_demand":true' in prompt


def test_research_progress_requires_semantic_checkpoint_change():
    previous = {"cursor": "page-2", "draft_findings": ["A"], "next_step": "read page 3"}
    unchanged = run_research_protocol_helper(
        "protocol.compareResearchProgress(JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT).before, JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT).after)",
        input_value={"before": previous, "after": previous},
    )
    advanced = run_research_protocol_helper(
        "protocol.compareResearchProgress(JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT).before, JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT).after)",
        input_value={"before": previous, "after": {**previous, "cursor": "page-3", "draft_findings": ["A", "B"]}},
    )
    assert unchanged["advanced"] is False
    assert unchanged["reason"] == "semantic_checkpoint_unchanged"
    assert advanced["advanced"] is True
    assert advanced["reason"] == "semantic_checkpoint_advanced"


def test_auto_research_rejects_an_unplanned_compound_goal_without_prior_research(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "compound-goal-admission"
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[{"name": "auto_research", "arguments": {
            "action": "start",
            "question": "Reconstruct the map, infer every object, derive the rules, and plan the complete route.",
            "complexity_assessment": {
                "level": "compound",
                "rationale": "Multiple dependent deliverables with no prior research result.",
            },
        }}],
    )
    result = results(events, "auto_research")[0]
    assert result.get("isError") is True
    assert "enqueue a decomposed research plan" in result["result"]["content"][0]["text"]
    assert not records(root, "auto-research-sessions.jsonl")


def test_auto_research_plan_mounts_dependent_work_as_pending_without_starting_a_child(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "research-plan-queue"
    plan = {
        "goal": "Resolve a compound fixture question.",
        "complexity_assessment": {"level": "compound", "rationale": "B requires A."},
        "concurrency_limit": 1,
        "nodes": [
            {"node_id": "a", "question": "Collect A.", "completion_contract": "Return A."},
            {"node_id": "b", "question": "Use A to decide B.", "depends_on": ["a"],
             "activation_policy": "parent_release", "completion_contract": "Return B."},
        ],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[
            {"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
            {"name": "auto_research", "arguments": {
                "action": "start", "plan_ref": "research_plan:research-plan-1@v1", "node_id": "b",
            }},
            {"name": "auto_research", "arguments": {
                "action": "inspect_plan", "plan_ref": "research_plan:research-plan-1@v1",
            }},
        ],
    )
    payloads = [json.loads(item["result"]["content"][0]["text"]) for item in results(events, "auto_research")]
    assert payloads[0]["runnable_node_ids"] == ["a"]
    assert payloads[1]["status"] == "pending"
    assert payloads[1]["wait_reason"] == "dependencies"
    assert payloads[2]["nodes"]["b"]["status"] == "pending"
    assert not records(root, "auto-research-sessions.jsonl")


def test_parent_can_skip_a_semantically_gated_research_node(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "research-plan-skip"
    plan = {
        "goal": "Queue an optional semantic branch.",
        "complexity_assessment": {"level": "compound", "rationale": "The second branch is conditional."},
        "nodes": [
            {"node_id": "a", "question": "Establish A.", "completion_contract": "Return A."},
            {"node_id": "optional", "question": "Investigate only when warranted.", "depends_on": ["a"],
             "activation_policy": "parent_release", "completion_contract": "Return optional result."},
        ],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[
            {"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
            {"name": "auto_research", "arguments": {
                "action": "skip", "plan_ref": "research_plan:research-plan-1@v1", "node_id": "optional",
            }},
        ],
    )
    skipped = json.loads(results(events, "auto_research")[-1]["result"]["content"][0]["text"])
    assert skipped["nodes"]["optional"]["status"] == "skipped"


def test_completed_planned_research_releases_structural_dependents_but_not_semantic_dependents(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "research-plan-completion"
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "A is established.", "findings": [], "evidence_refs": [],
        "alternatives": [], "limitations": [], "validation_plan": "Use A in dependent work.",
        "harness_proposals": [],
    }
    plan = {
        "goal": "Establish A, then evaluate two dependent questions.",
        "complexity_assessment": {"level": "compound", "rationale": "Both later nodes require A."},
        "concurrency_limit": 2,
        "nodes": [
            {"node_id": "a", "question": "Establish A.", "completion_contract": "Return A."},
            {"node_id": "auto", "question": "Use A structurally.", "depends_on": ["a"],
             "activation_policy": "after_dependencies", "completion_contract": "Return structural result."},
            {"node_id": "semantic", "question": "Run only if A warrants it.", "depends_on": ["a"],
             "activation_policy": "parent_release", "completion_contract": "Return conditional result."},
        ],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[
            {"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
            {"name": "auto_research", "arguments": {
                "action": "start", "plan_ref": "research_plan:research-plan-1@v1", "node_id": "a",
            }},
            {"name": "auto_research", "arguments": {
                "action": "inspect_plan", "plan_ref": "research_plan:research-plan-1",
            }},
        ],
    )
    payloads = [json.loads(item["result"]["content"][0]["text"]) for item in results(events, "auto_research")]
    view = payloads[-1]
    assert view["nodes"]["a"]["status"] == "completed"
    assert view["nodes"]["a"]["result_ref"] == "research_run:auto-research-1@v1"
    assert view["nodes"]["auto"]["status"] == "runnable"
    assert view["nodes"]["semantic"]["status"] == "pending"
    assert view["nodes"]["semantic"]["wait_reason"] == "parent_release"
    child_prompt = (root / ".task-child-prompts" / "auto-research-1_continuation-1.txt").read_text(encoding="utf-8")
    workset = json.loads(child_prompt.split("\n", 1)[1].split("\nParent-selected", 1)[0])
    assert workset["current_node"]["completion_contract"] == "Return A."
    assert workset["current_node"]["plan_goal"] == "Establish A, then evaluate two dependent questions."


def test_non_blocking_planned_node_completion_updates_the_durable_plan(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "research-plan-background-completion"
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "Background A completed.", "findings": [], "evidence_refs": [],
        "alternatives": [], "limitations": [], "validation_plan": "Use A.", "harness_proposals": [],
    }
    plan = {
        "goal": "Complete A in the background.",
        "complexity_assessment": {"level": "simple", "rationale": "One node."},
        "nodes": [{"node_id": "a", "question": "Complete A.", "completion_contract": "Return A."}],
    }
    broker = SubagentBroker()
    broker.start()
    child_env = {
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
    }
    try:
        _run_fixture(
            root,
            "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[
                {"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
                {"name": "auto_research", "arguments": {
                    "action": "start", "plan_ref": "research_plan:research-plan-1@v1", "node_id": "a",
                    "interaction_mode": "non_blocking",
                }},
            ],
        )
        wait_for_broker_job(root, "auto-research-1")
        events = _run_fixture(
            root,
            "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[{"name": "auto_research", "arguments": {
                "action": "inspect_plan", "plan_ref": "research_plan:research-plan-1",
            }}],
        )
        view = json.loads(results(events, "auto_research")[-1]["result"]["content"][0]["text"])
        assert view["nodes"]["a"]["status"] == "completed"
        assert view["nodes"]["a"]["result_ref"] == "research_run:auto-research-1@v1"
    finally:
        broker.close()


def test_code_router_compiles_semantics_and_prompt_overlay_to_native_pi_calls():
    cases = {
            "fact": "task_memory", "plan": "task_memory", "procedure": "task_skill",
        "computation": "task_tool", "role": "task_subagent",
    }
    capabilities = list(cases.values()) + ["task_system_prompt", "delegate_task"]
    for kind, expected_tool in cases.items():
        extras = {}
        if kind == "computation":
            extras["input_schema"] = {"type": "object", "properties": {"value": {"type": "string"}}}
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
    assert "unsupported or unnormalized kind" in tool_error


def test_router_keeps_arc_program_pending_when_declared_adapter_output_lacks_required_field():
    delivery = harness_delivery(
        "destination-check", "computation", "destination-check", "Classify a destination patch.",
        program={"steps": [
            {"kind": "adapter_call", "implementation_ref": "arc_state"},
            {"kind": "select", "fields": ["destination_patch_25_cells"]},
            {"kind": "count"},
        ]},
    )
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'real-child',approvalId:'candidate',approvalVersion:1,"
        "approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),"
        "capabilities:['task_tool'],implementationOutputSchemas:{arc_state:{type:'object',properties:{"
        "state:{type:'string'},available_actions:{type:'array',items:{type:'string'}}}}}})",
        input_value=delivery,
    )
    assert plan["route_status"] == "partial"
    assert "destination_patch_25_cells" in plan["steps"][0]["reason"]
    assert plan["steps"][0]["status"] == "pending_implementation"
    assert "apply_call" not in plan


def test_standalone_method_survives_an_invalid_component_proposal():
    method = {
        "problem": "Predict a bounded transition from contrasting situations.",
        "inputs": ["current situation"], "invariants": ["same action signature"],
        "parameters": ["destination terrain"], "steps": ["compare exact cases", "predict"],
        "decision_points": ["whether the situations differ"], "stop_conditions": ["prediction emitted"],
        "failure_modes": ["unseen terrain"], "construction_evidence_refs": ["o1", "o2"],
        "contrast_evidence_refs": [], "next_use": "the next contrasting situation",
        "predicted_semantic_result": "one bounded transition class", "falsifier": "a mismatching transition",
    }
    invalid_delivery = harness_delivery(
        "broken-tool", "computation", "broken-tool", "An implementation attempt.",
        basis_refs=["o1", "o2"], method=method,
        program={"steps": [{"kind": "invented_host_operation"}]},
    )
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "The cross-situation method is supported; its first tool implementation is invalid.",
        "findings": [], "evidence_refs": ["o1", "o2"], "alternatives": [], "limitations": [],
        "validation_plan": "Implement the candidate with supported operations.",
        "method_candidates": [{
            "candidate_ref": "cross-situation-method", "name": "bounded-transition-method",
            "semantic_kind": "procedure", "summary": "Compare exact situations before predicting.",
            "basis_refs": ["o1", "o2"], "method": method, "proposed_delivery_id": "broken-tool",
        }],
        "harness_proposals": [{"candidate_ref": "broken-tool-candidate", "delivery": invalid_delivery}],
    }
    normalized = run_output_policy_helper(
        "outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT))",
        input_value=report,
    )
    assert normalized["harness_proposals"][0]["proposal_status"] == "pending_implementation"
    assert "unsupported or unnormalized kind" in normalized["harness_proposals"][0]["proposal_error"]
    assert normalized["method_candidates"][0]["candidate_ref"] == "cross-situation-method"

    result = run_method_runtime_helper(
        "runtime.methodRecordsFromReport(JSON.parse(process.env.AUTORESEARCH_METHOD_RUNTIME_TEST_INPUT))[0]",
        input_value={
            "runId": "cross", "reportRef": "research_report:cross@v1",
            "researchLineRef": "research_line:cross@v1", "report": normalized,
            "comparison": {"selected_evidence_refs": ["o1", "o2"], "outcome_contrasts": [{"cases": [
                {"observation_ref": "o1", "context_id": "situation:1", "episode_context_id": "episode:1"},
                {"observation_ref": "o2", "context_id": "situation:2", "episode_context_id": "episode:1"},
            ]}]},
        },
    )
    assert result["maturity"] == "candidate_method"
    assert result["generalization_basis"] == "cross_context"
    assert result["component_status"] == "proposed_separately"
    assert result["delivery_id"] == "broken-tool"


def test_invalid_legacy_tool_migrates_its_valid_method_without_making_a_route():
    method = {
        "problem": "Predict a transition from two situations.", "inputs": ["situation"],
        "invariants": ["same action"], "parameters": ["terrain"], "steps": ["compare", "predict"],
        "decision_points": [], "stop_conditions": ["prediction"], "failure_modes": ["unknown terrain"],
        "construction_evidence_refs": ["o1", "o2"], "contrast_evidence_refs": [],
        "next_use": "next situation", "predicted_semantic_result": "one class", "falsifier": "mismatch",
    }
    invalid = harness_delivery(
        "legacy-broken", "computation", "legacy-broken", "Legacy method and program.",
        basis_refs=["o1", "o2"], method=method,
        program={"steps": [{"kind": "invented_host_operation"}]},
    )
    normalized = run_output_policy_helper(
        "outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT))",
        input_value={
            "format": "auto-research-report-v1", "status": "supported_within_scope", "conclusion": "method",
            "findings": [], "evidence_refs": ["o1", "o2"], "alternatives": [], "limitations": [],
            "validation_plan": "implement", "harness_proposals": [{"candidate_ref": "legacy-method", "delivery": invalid}],
        },
    )
    assert normalized["method_candidates"][0]["candidate_ref"] == "legacy-method"
    assert normalized["harness_proposals"][0]["proposal_status"] == "pending_implementation"
    assert "delivery" not in normalized["harness_proposals"][0]


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


def test_auto_research_report_preserves_structured_probe_and_guards_confidence_increase():
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "The repeated transition supports a bounded mechanism test.",
        "findings": [{
            "subject_kind": "task", "question": "Does action A move the object?",
            "conclusion": "A completed controlled repeat produced the predicted delta.",
            "evidence_refs": ["execution-observation-9"], "uncertainty": "Only one location was tested.",
        }],
        "evidence_refs": ["execution-observation-9"],
        "alternatives": ["The object moved autonomously."], "limitations": [],
        "validation_plan": "Run the requested probe in a second location.",
        "experiment_request": {
            "objective": "Distinguish action control from autonomous motion.",
            "prerequisites": ["Object visible"], "parent_action": "Wait once, then apply action A once.",
            "predicted_outcomes": [{"condition": "action-control hypothesis",
                "expected_observation": "Movement occurs only after A", "implication": "Supports direct control"}],
            "falsifier": "The same movement occurs during the wait.",
            "expected_information_gain": "Separates two live explanations.",
            "action_cost": "Two environment actions.", "stop_condition": "Stop after both deltas are recorded.",
            "evidence_refs": ["execution-observation-9"],
        },
        "confidence_update": {
            "disposition": "increase", "previous": "low", "current": "medium",
            "basis": "completed_discriminating_experiment",
            "reason": "The alternatives made different predictions and the parent completed the probe.",
            "evidence_refs": ["execution-observation-9"],
        },
        "harness_proposals": [],
    }
    result = run_output_policy_helper(
        "(()=>{const report=outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT));"
        "outputPolicy.assertResearchConfidenceUpdate(report);"
        "const capsule=outputPolicy.buildAutoResearchCapsule({runId:'r1',sessionRef:'research_session:s1@v2',status:'completed',scope:'hypothesis',reportRef:'research_report:r1@v1',researchLineRef:'research_line:line-1@v1',researchProblem:{kind:'planning',status:'unresolved',statement:'choose the next phase policy'},report});"
        "return {report,capsule};})()",
        input_value=report,
    )
    assert result["report"]["experiment_request"] == report["experiment_request"]
    assert result["capsule"]["next_experiment"]["parent_action"] == report["experiment_request"]["parent_action"]
    assert result["capsule"]["confidence_update"]["current"] == "medium"
    assert result["capsule"]["research_line_ref"] == "research_line:line-1@v1"
    assert result["capsule"]["research_problem"]["kind"] == "planning"

    invalid = {**report, "confidence_update": {
        **report["confidence_update"], "basis": "analysis_only",
    }}
    message = run_output_policy_helper(
        "(()=>{try{const report=outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT));"
        "outputPolicy.assertResearchConfidenceUpdate(report);return null}catch(error){return String(error.message)}})()",
        input_value=invalid,
    )
    assert "cannot increase" in message


def test_auto_research_report_wraps_direct_harness_delivery():
    delivery = harness_delivery(
        "direct-computation", "computation", "direct-computation", "Count enabled items.",
        input_schema={"items": {"type": "array", "items": {"enabled": "boolean"}}},
        program={"steps": [
            {"kind": "pick", "source": "input", "field": "items"},
            {"kind": "filter", "field": "enabled", "equals": True},
            {"kind": "count"},
        ]},
    )
    report = {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "A bounded candidate is available.", "findings": [],
        "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Use it on a mixed input.",
        "harness_proposals": [delivery],
    }
    normalized = run_output_policy_helper(
        "outputPolicy.normalizeAutoResearchReport(JSON.parse(process.env.AUTORESEARCH_OUTPUT_POLICY_TEST_INPUT))",
        input_value=report,
    )
    assert normalized["harness_proposals"][0]["delivery"]["delivery_id"] == "direct-computation"


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
    projected = capsule["harness_outputs"][0]
    assert value["routePlansUnchanged"] is True
    assert projected == {"delivery_id": "compact-route", "disposition": "materialize",
                         "status": "ready", "target": "skill"}
    assert capsule["adoption_call"]["arguments"] == {
        "action": "adopt_research", "research_run_ref": "research_run:auto-research-1@v1",
    }
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


def test_checkpoint_accepts_a_structured_working_summary_as_serialized_agent_state(tmp_path):
    root = tmp_path / "checkpoint-structured-summary"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "working_summary": {"known": ["A"], "open": ["B"]}}},
    ])
    assert not results(events, "task_checkpoint")[0].get("isError")
    checkpoint = json.loads((root / "task-checkpoint.json").read_text())
    assert json.loads(checkpoint["working_summary"]) == {"known": ["A"], "open": ["B"]}


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


def test_delegate_task_uses_generic_read_only_role_when_only_task_is_supplied(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "delegate-missing-selector"

    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
            "PI_SUBAGENT_STEPS": "[]",
        },
        steps=[{
            "name": "delegate_task",
            "arguments": {"task": "Inspect the public fixture state."},
        }],
    )

    delegate_results = results(events, "delegate_task")
    assert len(delegate_results) == 1
    assert not delegate_results[0].get("isError")
    assert not records(root, "task-operation-failures.jsonl")
    invocation = records(root, "subagent-invocations.jsonl")[0]
    assert invocation['ephemeral'] and invocation['status'] == 'completed'


def test_delegate_task_provider_schema_has_a_single_object_parameters_root(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "delegate-provider-schema"
    _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"], steps=[{
        "name": "benchmark_probe",
        "arguments": {"state": "RUNNING", "progress": 1},
    }])

    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    context = next(context for context in contexts if any(
        tool["name"] == "delegate_task" for tool in context["tools"]
    ))
    delegate_task = next(tool for tool in context["tools"] if tool["name"] == "delegate_task")
    parameters = delegate_task["parameters"]
    assert parameters["type"] == "object"
    assert "anyOf" not in parameters
    assert parameters["properties"]["agent_name"]["type"] == "string"
    assert parameters["properties"]["instructions"]["type"] == "string"


def test_auto_research_child_drops_completed_tool_reasoning_from_provider_projection(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-completed-reasoning"
    report = {
        "format": "auto-research-report-v1",
        "status": "inconclusive",
        "conclusion": "The fixture observation is insufficient for a stronger conclusion.",
        "findings": [],
        "evidence_refs": [],
        "alternatives": ["Collect another independent observation."],
        "limitations": ["Only one fixture observation was available."],
        "validation_plan": "Collect one discriminating observation.",
        "harness_proposals": [],
    }
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_THINKING_CHARS": "24000",
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "fixture_state", "arguments": {}},
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
    }, steps=[{"name": "auto_research", "arguments": {
        "question": "What does the fixture observation establish?",
        "scope": "hypothesis",
    }}])

    assert not results(events, "auto_research")[0].get("isError")
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    assert len(child_contexts) >= 2
    second_messages = child_contexts[1]["context"]["messages"]
    second_context = json.dumps(second_messages)
    assert "child-completed-tool-reasoning:" not in second_context

    fixture_call = next(
        block
        for message in second_messages if message.get("role") == "assistant"
        for block in message.get("content", [])
        if block.get("type") == "toolCall" and block.get("name") == "fixture_state"
    )
    assert fixture_call["arguments"] == {}
    assert any(
        message.get("role") == "toolResult"
        and message.get("toolCallId") == fixture_call["id"]
        for message in second_messages
    )

    archived_context = records(root, "task-context-cache/messages.jsonl")
    assert "child-completed-tool-reasoning:" in json.dumps(archived_context)


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
            "action": "adopt_research",
            "research_run_ref": "research_run:auto-research-1@v1",
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
    assert capsule["harness_outputs"][0] == {
        "delivery_id": "fixture-state-review", "disposition": "materialize",
        "status": "ready", "target": "skill",
    }
    assert capsule["adoption_call"]["arguments"] == {
        "action": "adopt_research", "research_run_ref": "research_run:auto-research-1@v1",
    }
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
    adoption = results(events, "task_harness")[0]
    assert json.loads(adoption["result"]["content"][0]["text"])["status"] == "adopted"
    sessions = records(root, "auto-research-sessions.jsonl")
    assert sessions[-1]["reconciliation_status"] == "adopted"
    parent_contexts = records(root, "provider-contexts.jsonl")
    assert all(item["count"] == 0 for item in records(root, "subagent-native-skills.jsonl"))
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    child_context = json.dumps(child_contexts)
    assert "Auto-Research: child instructions" in child_context
    assert "Research focus: component" in child_context
    submit_tool = next(
        tool
        for context in child_contexts
        for tool in context["context"]["tools"]
        if tool["name"] == "submit_research_report"
    )
    # The child may return a complete immutable candidate, including a method
    # abstraction.  Adoption and native mutation remain parent-only.
    submit_schema = json.dumps(submit_tool)
    assert "auto-research-harness-delivery-v1" in submit_schema
    assert "adopt_research" not in submit_schema
    assert "apply_route" not in submit_schema
    child_tool_names = {
        tool["name"]
        for context in child_contexts
        for tool in context["context"]["tools"]
    }
    assert not ({"task_harness", "task_memory", "task_skill", "task_tool",
                 "task_subagent", "task_system_prompt"} & child_tool_names)
    assert "Research objects and agent choices" not in json.dumps(parent_contexts)
    assert "child_report_not_automatically_adopted" in json.dumps(parent_contexts[-1])


def test_pi_child_preserves_cross_context_method_when_component_is_not_executable(tmp_path):
    """A method is durable even when its first component implementation cannot be adopted."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "cross-context-method-pending-component"
    method = {
        "problem": "Separate a successful probe situation from an error situation before choosing a follow-up.",
        "inputs": ["two exact probe observations from different situations"],
        "invariants": ["the same benchmark_probe interface produced both observations"],
        "parameters": ["whether the probe completed or returned an error"],
        "steps": ["compare the two exact outcomes", "classify the current situation", "choose the matching follow-up"],
        "decision_points": ["whether the current probe has the successful or error outcome"],
        "stop_conditions": ["one bounded situation class is selected"],
        "failure_modes": ["treating an unseen outcome as one of the two observed classes"],
        "construction_evidence_refs": ["execution-observation-1", "execution-observation-2"],
        "contrast_evidence_refs": ["execution-observation-2"],
        "next_use": "the next probe whose outcome matches one of the observed classes",
        "predicted_semantic_result": "one of two bounded probe situation classes",
        "falsifier": "a later probe matches neither observed outcome class",
    }
    delivery = harness_delivery(
        "probe-situation-classifier", "computation", "probe-situation-classifier",
        "Classify a probe situation using a declared adapter result.",
        basis_refs=["execution-observation-1", "execution-observation-2"],
        execution="adapter_operation",
        input_schema={"type": "object", "properties": {}},
        program={"steps": [
            {"kind": "adapter_call", "implementation_ref": "fixture.echo"},
            {"kind": "select", "fields": ["probe_outcome_class"]},
        ]},
    )
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "The two probe situations support a bounded comparison method, but the proposed component lacks a declared executable result shape.",
        "findings": [{
            "subject_kind": "research_method",
            "question": "Can the two exact probe situations be compared without claiming a shared cause?",
            "conclusion": "They form a bounded success/error contrast for a later classification attempt.",
            "evidence_refs": ["execution-observation-1", "execution-observation-2"],
            "uncertainty": "No third outcome has been observed.",
        }],
        "evidence_refs": ["execution-observation-1", "execution-observation-2"],
        "alternatives": ["Keep the observations as unrelated task experience."],
        "limitations": ["The first proposed implementation cannot yet be proved executable."],
        "validation_plan": "Implement the method with a declared result shape, adopt it, and test it on a later probe.",
        "method_candidates": [{
            "candidate_ref": "probe-situation-method", "name": "probe-situation-method",
            "semantic_kind": "computation", "summary": "Compare bounded probe outcomes before selecting a follow-up.",
            "basis_refs": ["execution-observation-1", "execution-observation-2"],
            "method": method, "proposed_delivery_id": "probe-situation-classifier",
        }],
        "harness_proposals": [{"candidate_ref": "probe-situation-component", "delivery": delivery}],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([
                {"name": "task_resource", "arguments": {
                    "action": "read", "ref": "observation:execution-observation-1@v1", "limit": 8000,
                }},
                {"name": "task_resource", "arguments": {
                    "action": "read", "ref": "observation:execution-observation-2@v1", "limit": 8000,
                }},
                {"name": "submit_research_report", "arguments": {"report": report}},
            ]),
        },
        steps=[
            {"name": "benchmark_probe", "arguments": {}},
            {"name": "benchmark_probe", "arguments": {"fail": "bounded fixture contrast"}},
            {"name": "auto_research", "arguments": {
                "question": "Compare the two exact probe situations and induce a bounded method only if supported.",
                "scope": "research_method", "research_kind": "capability",
                "research_line_ref": "research_line:probe-situations@v1",
                "evidence_refs": ["execution-observation-1", "execution-observation-2"],
            }},
            {"name": "task_harness", "arguments": {"action": "inspect"}},
        ],
    )

    auto_result = results(events, "auto_research")[0]
    assert not auto_result.get("isError")
    capsule = json.loads(auto_result["result"]["content"][0]["text"])
    assert capsule["method_candidates"][0]["candidate_ref"] == "probe-situation-method"
    assert capsule["harness_outputs"] == [{
        "delivery_id": "probe-situation-classifier", "disposition": "materialize",
        "status": "partial", "target": "tool",
    }]
    assert capsule["reconciliation_status"] == "not_applicable"
    assert capsule["adoption_required"] is False
    assert "adoption_call" not in capsule

    stored = records(root, "auto-research-reports.jsonl")[0]["report"]
    assert stored["method_candidates"][0]["method"] == method
    assert stored["harness_proposals"][0]["delivery"]["delivery_id"] == "probe-situation-classifier"
    routes = records(root, "auto-research-harness-routes.jsonl")
    assert len(routes) == 1
    assert routes[0]["route_status"] == "partial"
    assert routes[0]["steps"][0]["status"] == "pending_implementation"
    assert "apply_call" not in routes[0]

    lifecycle = records(root, "task-method-lifecycle.jsonl")
    assert len(lifecycle) == 1
    assert lifecycle[0]["maturity"] == "candidate_method"
    # These generic probe fixtures do not expose canonical pre-action state.
    # Different results alone must not be promoted to a cross-context claim.
    assert lifecycle[0]["generalization_basis"] == "single_context"
    assert lifecycle[0]["component_status"] == "proposed_separately"
    assert lifecycle[0]["delivery_id"] == "probe-situation-classifier"
    sessions = records(root, "auto-research-sessions.jsonl")
    assert sessions[-1]["reconciliation_status"] == "not_applicable"
    assert records(root, "task-tools.jsonl") == []
    assert records(root, "auto-research-harness-route-receipts.jsonl") == []

    harness_view = json.loads(results(events, "task_harness")[-1]["result"]["content"][0]["text"])
    assert "awaiting_parent_change" not in json.dumps(harness_view)
    assert "probe-situation-classifier" not in json.dumps(harness_view)


def test_parent_can_start_cross_context_research_from_one_candidate_reference(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "cross-context-candidate-handoff"
    root.mkdir()
    observations = [
        {"observation_id": "o1", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 2}}},
        {"observation_id": "contrast", "tool_name": "arc_action", "input": {"action": "ACTION2"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 4}}},
        {"observation_id": "o2", "tool_name": "arc_action", "input": {"action": "ACTION1"},
         "arc_outcome": {"state": "NOT_FINISHED", "levels_completed": 0,
                         "observation_delta": {"changed_cells": 0}}},
    ]
    (root / "execution-observations.jsonl").write_text(
        "".join(json.dumps(item) + "\n" for item in observations), encoding="utf-8",
    )
    status_events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness_status", "arguments": {"request": "current"},
    }])
    status = json.loads(results(status_events, "task_harness_status")[0]["result"]["content"][0]["text"])
    candidate = status["cross_context_research_candidates"][0]

    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "The exact situations were compared; the evidence does not yet warrant a reusable method.",
        "findings": [], "evidence_refs": ["o1", "o2", "contrast"],
        "alternatives": ["The observed difference may depend on an unmeasured state feature."],
        "limitations": ["Only two construction situations exist."],
        "validation_plan": "Collect a later situation before proposing a method.",
        "harness_proposals": [],
    }
    child_env = {
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
    }
    research_events = _run_fixture(
        root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env=child_env,
        steps=[{"name": "auto_research", "arguments": candidate["research_call"]}],
    )
    assert not results(research_events, "auto_research")[0].get("isError")
    session = records(root, "auto-research-sessions.jsonl")[-1]
    assert session["research_candidate_ref"] == candidate["candidate_ref"]
    assert session["question"].startswith("Compare the exact arc_action:ACTION1 observations")
    assert session["scope"] == "research_method"
    assert session["research_kind"] == "capability"
    assert session["evidence_refs"] == ["o1", "o2", "contrast"]
    comparison = records(root, "auto-research-comparison-bundles.jsonl")[-1]
    assert {"o1", "o2", "contrast"} <= set(comparison["selected_evidence_refs"])
    assert next(group for group in comparison["outcome_contrasts"]
                if group["action_signature"] == "arc_action:ACTION1")["context_count"] == 2

    later_status_events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness_status", "arguments": {"request": "current"},
    }])
    later_status = json.loads(results(later_status_events, "task_harness_status")[0]["result"]["content"][0]["text"])
    assert later_status["cross_context_research_candidates"] == []
    assert len(records(root, "auto-research-opportunities.jsonl")) == 1


def test_cross_context_cards_replace_duplicate_prompt_excerpts_but_keep_canonical_access(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "cross-context-card-deduplication"
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "The two cards are available, but no method is claimed.",
        "findings": [], "evidence_refs": ["execution-observation-1", "execution-observation-2"],
        "alternatives": [], "limitations": ["No semantic comparison was attempted."],
        "validation_plan": "Inspect canonical evidence only if a card omits a needed fact.",
        "harness_proposals": [],
    }
    events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[
            {"name": "benchmark_probe", "arguments": {"state_changed": True}},
            {"name": "benchmark_probe", "arguments": {"state_changed": False}},
            {"name": "auto_research", "arguments": {
                "question": "Compare these exact probe situations.", "scope": "research_method",
                "evidence_refs": ["execution-observation-1", "execution-observation-2"],
                "context_window": {"recent_observations": 2, "context_refs": [
                    "execution-observation-1", "execution-observation-2",
                ], "max_chars": 12000},
            }},
        ],
    )
    assert not results(events, "auto_research")[0].get("isError")
    contexts = records(root, "subagent-provider-contexts.jsonl")
    prompt = next(
        part["text"]
        for item in contexts
        for message in item["context"].get("messages", [])
        if message.get("role") == "user"
        for part in message.get("content", [])
        if part.get("type") == "text" and "# Research task workset" in part.get("text", "")
    )
    assert '"evidence_cards"' in prompt
    assert '"removed_observation_refs":["execution-observation-1","execution-observation-2"]' in prompt
    marker = "Parent-selected context window (bounded state, not the parent transcript): "
    window = json.loads(prompt.split(marker, 1)[1].split("\n\n# Available access", 1)[0])
    assert window["recent_observations"] == []
    assert window["comparison_card_deduplication"]["canonical_access"] == "task_resource"
    assert window["comparison_card_deduplication"]["omission_scope"] == \
        "all_recent_observations_outside_exact_comparison"
    workset = json.loads(prompt.split("# Research task workset\n", 1)[1].split(
        "\nParent-selected context window", 1)[0])
    assert workset["selected_context"] == ""
    child_tools = {
        tool["name"]
        for item in contexts
        for tool in item["context"].get("tools", [])
    }
    assert "task_resource" in child_tools
    assert "fixture_state" not in child_tools
    assert "research_checkpoint" not in child_tools
    assert "submit_research_report" in child_tools
    comparison = records(root, "auto-research-comparison-bundles.jsonl")[-1]
    assert comparison["adapter_tools"] == []
    assert comparison["adapter_tools_omitted_for_exact_comparison"] is True
    budget = records(root, "auto-research-context-budgets.jsonl")[-1]
    assert budget["selected_resource_index_omitted_for_evidence_cards"] is True


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
    assert capsule["harness_outputs"][0] == {
        "delivery_id": "fixture-review", "disposition": "materialize", "status": "ready", "target": "skill",
    }
    assert capsule["harness_outputs"][1]["disposition"] == "closed"
    assert capsule["adoption_call"]["arguments"]["action"] == "adopt_research"

    approvals = records(root, "task-harness-proposals.jsonl")
    assert [(item["version"], item["status"], item["tag"]) for item in approvals] == [
        (1, "pending", "pending_review"), (2, "deferred", "deferred"),
        (3, "approved", "approved"), (1, "pending", "pending_review"), (2, "rejected", "rejected"),
    ]
    # Approval is research metadata.  Auto-Research returns a ready proposal
    # but cannot cross the parent change boundary by itself.
    assert records(root, "task-skills.jsonl") == []
    assert records(root, "auto-research-harness-route-receipts.jsonl") == []
    routes = records(root, "auto-research-harness-routes.jsonl")
    assert [item["router"]["implementation"] for item in routes] == ["code"] * len(routes)
    assert routes[0]["route_status"] == "ready"
    assert routes[-1]["route_status"] == "no_change"

    parent_contexts = records(root, "provider-contexts.jsonl")
    assert "research_approval" not in json.dumps(parent_contexts)
    child_contexts = records(root, "subagent-provider-contexts.jsonl")
    assert "research_approval" in json.dumps(child_contexts[0])


def test_research_method_is_validated_only_after_adoption_actual_use_and_assessment(tmp_path):
    """Exercise the durable method loop through native parent-facing tools."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "method-use-feedback"
    delivery = harness_delivery(
        "state-selector", "computation", "state-selector",
        "Select the decision-relevant state field from a bounded observation.",
        basis_refs=["execution-observation-1"],
        input_schema={"type": "object", "properties": {"state": {"type": "string"}}},
        program={"steps": [{"kind": "select", "source": "input", "fields": ["state"]}]},
        method={
            "problem": "Remove irrelevant fields before comparing task states.",
            "inputs": ["a bounded observation with a state field"],
            "invariants": ["the source observation remains immutable"],
            "parameters": ["selected field names"],
            "steps": ["select only the state field", "return the selected value"],
            "decision_points": ["whether the state field is present"],
            "stop_conditions": ["the selected value is emitted"],
            "failure_modes": ["the requested field is absent"],
            "construction_evidence_refs": ["execution-observation-1"],
            "contrast_evidence_refs": [],
            "next_use": "the next bounded state comparison",
            "predicted_semantic_result": "the output contains the state and omits unrelated input",
            "falsifier": "the output retains an unrelated field or loses the state",
        },
        expected_effect="produce a smaller state representation without losing the state",
        reconsider_when="a later invocation loses the state or retains irrelevant fields",
    )
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "A bounded selector is a candidate method, pending later use.",
        "findings": [],
        "evidence_refs": ["execution-observation-1"],
        "alternatives": ["Keep passing the complete observation."],
        "limitations": ["The method has not yet been used after adoption."],
        "validation_plan": "Adopt it, invoke it on a later input, then assess the semantic output.",
        "harness_proposals": [{"candidate_ref": "candidate-state-selector", "delivery": delivery}],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[
            project / "tests" / "pi_non_arc_task_subagents.ts",
            project / "tests" / "pi_task_tool_fixture.ts",
        ],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([
                {"name": "submit_research_report", "arguments": {"report": report}},
            ]),
        },
        steps=[
            {"name": "benchmark_probe", "arguments": {"state_changed": True}},
            {"name": "auto_research", "arguments": {
                "question": "Can a bounded selector improve later state comparison?",
                "scope": "research_method",
                "research_kind": "capability",
                "research_line_ref": "research_line:state-representation@v1",
                "evidence_refs": ["execution-observation-1"],
            }},
            {"name": "task_harness", "arguments": {
                "action": "adopt_research",
                "research_run_ref": "research_run:auto-research-1@v1",
            }},
            {"name": "task_tool_state-selector_v1", "arguments": {
                "input": {"state": "RUNNING", "irrelevant": "discard-me"},
            }},
            {"name": "task_harness", "arguments": {
                "action": "assess_effect",
                "decision_id": "decision-1",
                "observation_refs": ["task-tool-use-task-tool-invocation-1"],
                "verdict": "supported",
                "consequence": "The later invocation retained state and omitted the unrelated field.",
            }},
        ],
    )

    assert not [event for event in results(events, "auto_research") if event.get("isError")]
    assert not [event for event in results(events, "task_harness") if event.get("isError")]
    invocation = results(events, "task_tool_state-selector_v1")[0]
    assert json.loads(invocation["result"]["content"][0]["text"]) == {"state": "RUNNING"}

    lifecycle = records(root, "task-method-lifecycle.jsonl")
    assert [item["maturity"] for item in lifecycle] == [
        "candidate_method", "trial", "validated_within_scope",
    ]
    assert lifecycle[-1]["resource_refs"] == ["tool:state-selector@v1"]
    assert lifecycle[-1]["actual_use_observation_refs"] == [
        "task-tool-use-task-tool-invocation-1",
    ]
    assert lifecycle[-1]["latest_assessment"]["actual_use_refs"] == [
        "task-tool-use-task-tool-invocation-1",
    ]

    handoffs = records(root, "auto-research-handoffs.jsonl")
    feedback = next(item for item in handoffs if item["handoff_id"] == "method-feedback-effect-assessment-1")
    assert feedback["status"] == "proposed"
    assert feedback["research_line_ref"] == "research_line:state-representation@v1"
    assert feedback["completion_contract_kind"] == "method_feedback_evaluation"
    assert feedback["ready_call"] == {
        "action": "start",
        "research_handoff_ref": "research_handoff:method-feedback-effect-assessment-1@v1",
    }


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
                         input_schema={"type": "object", "properties": {"state": {"type": "string"}}},
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
            {"name": "submit_research_report", "arguments": {"report": report}},
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


def test_non_blocking_auto_research_persists_a_pending_session_checkpoint(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-pause"
    broker = SubagentBroker()
    broker.start()
    try:
        child_env = {
            "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
                "action": "pause", "cursor": "page-2", "unresolved_questions": ["Need a discriminating observation."],
                "reason": "Need a discriminating observation.", "next_step": "Compare the next observation.",
                "wait_for": "next_parent_evidence",
            }}]),
        }
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                              steps=[{"name": "auto_research", "arguments": {
                                  "question": "Which path should be validated next?", "scope": "solution_path", "interaction_mode": "non_blocking",
                              }}])
        payload = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        assert payload["status"] == "active" and payload["accepted"] is True
        wait_for_broker_job(root, "auto-research-1")
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                     steps=[{"name": "auto_research", "arguments": {"action": "inspect", "session_ref": payload["session_ref"]}}])
        sessions = records(root, "auto-research-sessions.jsonl")
        assert sessions[0]["status"] == "active"
        assert sessions[-1]["status"] == "pending"
        assert sessions[-1]["checkpoint"]["cursor"] == "page-2"
        assert sessions[-1]["checkpoint"]["wait_for"] == "next_parent_evidence"
        assert isinstance(sessions[-1]["checkpoint"]["after_evidence_sequence"], int)
        assert "checkpoint_ref" not in sessions[-1]["checkpoint"]
        assert records(root, "auto-research-runs.jsonl")[-1]["status"] == "pending"
    finally:
        broker.close()


def test_auto_research_resume_reuses_the_same_session(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-resume"
    base_env = {
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
    }
    broker = SubagentBroker()
    broker.start()
    try:
        base_env["PI_AUTORESEARCH_SUBAGENT_BROKER_URL"] = broker.url
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
            **base_env, "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
                "action": "pause", "cursor": "cursor-1", "reason": "Need evidence", "next_step": "Inspect it",
                "wait_for": "manual_resume",
            }}]),
        }, steps=[{"name": "auto_research", "arguments": {
            "question": "Which path?", "scope": "solution_path", "interaction_mode": "non_blocking",
        }}])
        wait_for_broker_job(root, "auto-research-1")
        # Startup harvests the pending checkpoint before the explicit resume.
        report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "Resume retained the cursor.",
                  "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [], "validation_plan": "observe next state", "harness_proposals": []}
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
            **base_env, "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        }, steps=[{"name": "auto_research", "arguments": {"action": "resume", "session_ref": "research_session:research-session-1@v2"}}])
        payload = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        assert payload["status"] == "active" and payload["accepted"] is True
        pending = next(item for item in reversed(records(root, "auto-research-sessions.jsonl")) if item["status"] == "pending")
        wait_for_broker_job(root, "auto-research-2")
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=base_env,
                     steps=[{"name": "auto_research", "arguments": {"action": "inspect", "session_ref": payload["session_ref"]}}])
        sessions = records(root, "auto-research-sessions.jsonl")
        assert sessions[-1]["status"] == "completed"
        assert sessions[-1]["session_id"] == pending["session_id"]
        assert sessions[-1]["version"] == pending["version"] + 3
        assert sessions[-1]["completion_delivery_status"] == "delivered"
        assert records(root, "auto-research-runs.jsonl")[-1]["session_id"] == pending["session_id"]
    finally:
        broker.close()


def test_blocking_auto_research_yields_pending_for_future_parent_evidence(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-blocking-pending"
    report = {"format": "auto-research-report-v1", "status": "unresolved", "conclusion": "Future parent evidence is required.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": ["No later observation exists yet."],
              "validation_plan": "Continue the parent task and research again after new evidence.", "harness_proposals": []}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps([
            {"name": "research_checkpoint", "arguments": {"action": "pause", "reason": "Need evidence",
                "next_step": "Inspect the next observation", "wait_for": "next_parent_evidence"}},
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
    }, steps=[{"name": "auto_research", "arguments": {"question": "Can this be decided now?", "interaction_mode": "blocking"}}])
    payload = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
    assert payload["status"] == "pending"
    assert records(root, "auto-research-sessions.jsonl")[-1]["status"] == "pending"
    assert not any(item["event"] == "research_pause_rejected" for item in records(root, "auto-research-child-control.jsonl"))
    assert records(root, "auto-research-sessions.jsonl")[-1]["interaction_mode"] == "blocking"


def test_non_blocking_session_can_be_inspected_and_cancelled(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-cancel"
    broker = SubagentBroker()
    broker.start()
    try:
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url, "PI_SUBAGENT_FORCE_LENGTH": "1",
        }, steps=[
            {"name": "auto_research", "arguments": {"question": "Keep researching until cancelled.", "interaction_mode": "non_blocking"}},
            {"name": "auto_research", "arguments": {"action": "inspect", "session_ref": "research_session:research-session-1@v1"}},
            {"name": "auto_research", "arguments": {"action": "resume", "session_ref": "research_session:research-session-1@v1"}},
            {"name": "auto_research", "arguments": {"action": "cancel", "session_ref": "research_session:research-session-1@v1"}},
        ])
        auto_results = results(events, "auto_research")
        payloads = [json.loads(item["result"]["content"][0]["text"]) if not item.get("isError")
                    else {"error": item["result"]["content"][0]["text"]} for item in auto_results]
        assert payloads[0]["accepted"] is True
        assert payloads[1]["status"] == "active"
        assert auto_results[2].get("isError") is True
        assert "not resumable: active" in payloads[2]["error"]
        assert payloads[3]["status"] == "cancelled"
        assert {item["run_id"] for item in records(root, "auto-research-sessions.jsonl") if item.get("run_id")} == {"auto-research-1"}
        assert records(root, "auto-research-sessions.jsonl")[-1]["status"] == "cancelled"
    finally:
        broker.close()


def test_active_session_is_failed_when_the_current_broker_does_not_own_its_job(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-stale-active"
    first_broker = SubagentBroker()
    first_broker.start()
    _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": first_broker.url, "PI_SUBAGENT_FORCE_LENGTH": "1",
    }, steps=[{"name": "auto_research", "arguments": {"question": "Stay active", "interaction_mode": "non_blocking"}}])
    first_broker.close()
    status_path = root / "task-context-cache" / "auto-research-broker" / "auto-research-1.json"
    status_path.write_text(json.dumps({"format": "subagent-broker-job-v1", "job_id": "auto-research-1:continuation-1",
                                       "status": "active", "pid": 999999}) + "\n", encoding="utf-8")

    replacement_broker = SubagentBroker()
    replacement_broker.start()
    try:
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": replacement_broker.url,
        }, steps=[{"name": "auto_research", "arguments": {"action": "inspect", "session_ref": "research_session:research-session-1@v1"}}])
        inspected = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        assert inspected["status"] == "failed"
        assert records(root, "auto-research-sessions.jsonl")[-1]["failure_code"] == "orphaned_active_session"
    finally:
        replacement_broker.close()


def test_non_blocking_completion_waits_for_one_explicit_parent_change(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-background-route"
    delivery = harness_delivery(
        "background-review", "procedure", "background-review",
        "Inspect the selected observation and preserve uncertainty.",
    )
    report = {
        "format": "auto-research-report-v1", "status": "provisional",
        "conclusion": "The procedure is a candidate for the next parent turn.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Apply at a parent-owned safe point.",
        "harness_proposals": [{"approval_id": "auto-research-1:proposal-1"}],
    }
    broker = SubagentBroker()
    broker.start()
    try:
        child_env = {
            "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url, "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([
                {"name": "research_approval", "arguments": {"action": "propose", "approval_id": "auto-research-1:proposal-1", "delivery": delivery}},
                {"name": "research_approval", "arguments": {"action": "approve", "approval_id": "auto-research-1:proposal-1", "target_version": 1}},
                {"name": "submit_research_report", "arguments": {"report": report}},
            ]),
        }
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                              steps=[{"name": "auto_research", "arguments": {
                                  "question": "Should this procedure be retained?", "interaction_mode": "non_blocking",
                              }}])
        accepted = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        wait_for_broker_job(root, "auto-research-1")
        inspect_events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                                      steps=[{"name": "auto_research", "arguments": {"action": "inspect", "session_ref": accepted["session_ref"]}}])
        inspected = json.loads(results(inspect_events, "auto_research")[0]["result"]["content"][0]["text"])
        assert inspected["status"] == "completed"
        assert inspected["reconciliation_status"] == "awaiting_parent_change"
        route = records(root, "auto-research-harness-routes.jsonl")[-1]
        assert route["route_status"] == "ready"
        assert records(root, "task-skills.jsonl") == []
        assert records(root, "auto-research-harness-route-receipts.jsonl") == []
        assert "AUTO-RESEARCH COMPLETION INBOX" in json.dumps(records(root, "provider-contexts.jsonl")[-1])

        delivery_hash = run_router_helper(
            "router.harnessDeliveryHash(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
            input_value=delivery,
        )
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                     steps=[{"name": "task_harness", "arguments": {
                         "action": "apply_route", "route_ref": route["route_ref"],
                         "expected_delivery_hash": delivery_hash,
                     }}])
        assert len(records(root, "task-skills.jsonl")) == 1
        assert len(records(root, "auto-research-harness-route-receipts.jsonl")) == 1
        assert "AUTO-RESEARCH COMPLETION INBOX" not in json.dumps(records(root, "provider-contexts.jsonl")[-1])
    finally:
        broker.close()


def test_pending_non_blocking_session_resumes_once_with_new_canonical_evidence(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-evidence-resume"
    broker = SubagentBroker()
    broker.start()
    base_env = {
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
    }
    try:
        pause_env = {**base_env, "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
            "action": "pause", "cursor": "waiting-for-memory", "reason": "Need parent evidence",
            "next_step": "Inspect the new memory.", "wait_for": "next_parent_evidence",
        }}])}
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=pause_env,
                     steps=[{"name": "auto_research", "arguments": {"question": "Wait for evidence", "interaction_mode": "non_blocking"}}])
        wait_for_broker_job(root, "auto-research-1")
        # Evidence arrives after the child pauses but before the parent harvests
        # that pause. The child-owned cursor must keep this evidence visible.
        _run_fixture(root, "treatment", steps=[{"name": "task_memory", "arguments": {
            "action": "upsert", "key": "new-evidence", "content": "A new canonical parent observation.",
        }}])
        report = {"format": "auto-research-report-v1", "status": "supported_within_scope",
                  "conclusion": "The new evidence resolved the pending question.", "findings": [],
                  "evidence_refs": ["memory:new-evidence@v1"], "alternatives": [], "limitations": [],
                  "validation_plan": "Use the result on the next parent turn.", "harness_proposals": []}
        resume_env = {**base_env, "PI_SUBAGENT_REPORT": json.dumps(report),
                      "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}])}
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=resume_env,
                     steps=[])
        wait_for_broker_job(root, "auto-research-2")
        _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=resume_env,
                     steps=[])

        sessions = records(root, "auto-research-sessions.jsonl")
        claimed = [item for item in sessions if item.get("run_id") == "auto-research-2" and item["status"] == "active"]
        assert len(claimed) == 1
        assert "memory:new-evidence@v1" in claimed[0]["evidence_refs"]
        assert sessions[-1]["status"] == "completed"
        assert len({item["run_id"] for item in sessions if item.get("run_id")}) == 2
    finally:
        broker.close()


def test_non_blocking_provider_length_continues_to_a_structured_report(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-background-length"
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "Continuation completed.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
              "validation_plan": "Return to the parent.", "harness_proposals": []}
    broker = SubagentBroker()
    broker.start()
    try:
        child_env = {
            "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted", "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url, "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1",
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        }
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                              steps=[{"name": "auto_research", "arguments": {"question": "Continue after length", "interaction_mode": "non_blocking"}}])
        accepted = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        status = wait_for_broker_job(root, "auto-research-1")
        assert status["continuation_attempts"] == 2
        inspect_events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"], extra_env=child_env,
                                      steps=[{"name": "auto_research", "arguments": {"action": "inspect", "session_ref": accepted["session_ref"]}}])
        inspected = json.loads(results(inspect_events, "auto_research")[0]["result"]["content"][0]["text"])
        assert inspected["status"] == "completed"
        assert inspected["report"]["report"]["conclusion"] == "Continuation completed."
    finally:
        broker.close()


def test_length_continuation_prompt_uses_native_session_without_reinjecting_full_workset(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-compact-length-continuation"
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": "Continuation completed without replaying the original workset.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
              "validation_plan": "Return to the parent.", "harness_proposals": []}
    events = _run_fixture(
        root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1",
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Compare a deliberately long original workset " + ("without replay " * 500),
            "constraints": ["original-constraint-should-appear-once " * 100],
        }}],
    )
    assert not results(events, "auto_research")[0].get("isError")
    prompts = sorted((root / ".task-child-prompts").glob("auto-research-1_*.txt"))
    assert len(prompts) == 2
    first = prompts[0].read_text(encoding="utf-8")
    second = prompts[1].read_text(encoding="utf-8")
    assert "original-constraint-should-appear-once" in first
    assert "original-constraint-should-appear-once" not in second
    assert "Complete the existing research turn from the native session" in second
    assert "partial_output" not in second
    assert len(second) < len(first) / 2


def test_auto_research_child_inherits_parent_provider_model_and_registry(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "child-inherits-parent-model-runtime"
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(parents=True)
    (agent_dir / "models.json").write_text(json.dumps({"providers": {
        "offline-subagent-test": {
            "baseUrl": "http://unused.invalid", "api": "openai-completions", "apiKey": "offline",
            "models": [{"id": "scripted", "name": "scripted", "reasoning": False,
                        "input": ["text"], "contextWindow": 128000, "maxTokens": 65536}],
        },
    }}), encoding="utf-8")
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "Bounded report.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
              "validation_plan": "Return to parent.", "harness_proposals": []}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
                          extra_env={
                              "PI_AUTORESEARCH_PI_CLI": cli,
                              "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
                              "PI_AUTORESEARCH_MODEL": "scripted",
                              # Deprecated child-specific values must not split the
                              # subagent from the parent runtime configuration.
                              "PI_AUTORESEARCH_CHILD_PROVIDER": "must-not-be-used",
                              "PI_AUTORESEARCH_CHILD_MODEL": "must-not-be-used",
                              "PI_AUTORESEARCH_CHILD_MAX_OUTPUT_TOKENS": "2048",
                              "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
                              "PI_SUBAGENT_REPORT": json.dumps(report),
                              "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
                          }, steps=[{"name": "auto_research", "arguments": {"question": "Return one bounded report."}}])
    assert not results(events, "auto_research")[0].get("isError")
    assert not (root / ".pi-auto-research-child").exists()
    assert not (root / "auto-research-child-model-config.jsonl").exists()
    parent_config = json.loads((agent_dir / "models.json").read_text(encoding="utf-8"))
    assert parent_config["providers"]["offline-subagent-test"]["models"][0]["maxTokens"] == 65536


def test_followup_research_inherits_line_from_one_selected_prior_report(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "followup-line-inheritance"
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "One bounded result.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
              "validation_plan": "Continue on the same line.", "harness_proposals": []}
    events = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
                          extra_env={
                              "PI_AUTORESEARCH_PI_CLI": cli,
                              "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
                              "PI_AUTORESEARCH_MODEL": "scripted",
                              "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
                              "PI_SUBAGENT_REPORT": json.dumps(report),
                              "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}]),
                          }, steps=[
                              {"name": "auto_research", "arguments": {
                                  "question": "Establish the method line.",
                                  "research_line_ref": "research_line:movement-method@v1",
                              }},
                              {"name": "auto_research", "arguments": {
                                  "question": "Narrow follow-up to research_report:auto-research-1@v1.",
                                  "resource_refs": ["research_report:auto-research-1@v1"],
                              }},
                          ])
    assert not [item for item in results(events, "auto_research") if item.get("isError")]
    sessions = records(root, "auto-research-sessions.jsonl")
    second = [item for item in sessions if item["session_id"] == "research-session-2"][-1]
    assert second["research_line_ref"] == "research_line:movement-method@v1"


def test_blocking_length_continuation_stops_after_repeated_semantic_stagnation(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-stagnant-length"
    eventual_report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "This report should not require five identical length retries.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Return to parent.", "harness_proposals": [],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_FORCE_LENGTH_COUNT": "4",
            "PI_AUTORESEARCH_MAX_STAGNANT_CONTINUATIONS": "2",
            "PI_SUBAGENT_REPORT": json.dumps(eventual_report),
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": eventual_report}}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Investigate until there is meaningful progress.",
            "complexity_assessment": {"level": "simple", "rationale": "One bounded conclusion."},
        }}],
    )
    result = results(events, "auto_research")[0]
    assert not result.get("isError")
    capsule = json.loads(result["result"]["content"][0]["text"])
    assert capsule["status"] == "completed"
    assert capsule["summary"].startswith("Research stopped after 2 consecutive output-length continuations")
    continuations = records(root, "auto-research-continuations.jsonl")
    assert len(continuations) == 2
    assert continuations[-1]["progress_status"] == "stalled"
    assert records(root, "auto-research-runs.jsonl")[-1]["continuation_attempts"] == 2


def test_provider_error_after_checkpoint_fails_research_instead_of_masking_as_checkpointed(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-provider-error-after-checkpoint"
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_FORCE_ERROR_AFTER_TOOL": "1",
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
                "action": "save", "cursor": "evidence-reviewed",
                "evidence_refs": [], "draft_findings": [{"claim": "bounded"}],
                "next_step": "submit the report",
            }}]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Return a bounded report after saving progress.",
            "complexity_assessment": {"level": "simple", "rationale": "One conclusion."},
        }}],
    )

    result = results(events, "auto_research")[0]
    assert result.get("isError") is True
    run = records(root, "auto-research-runs.jsonl")[-1]
    assert run["status"] == "failed"
    assert "subagent provider error" in run["error"]
    assert "fixture provider failure after checkpoint" in run["error"]
    assert not records(root, "auto-research-continuations.jsonl")


def test_rejected_report_is_checkpointed_then_corrected_in_same_child_session(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-report-repair"
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "The corrected report preserves the bounded conclusion.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Return to the parent.", "harness_proposals": [],
    }
    events = _run_fixture(
        root,
        "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_SUBAGENT_FORCE_INVALID_REPORT_ONCE": "1",
            "PI_SUBAGENT_REPORT": json.dumps(report),
            "PI_SUBAGENT_STEPS": json.dumps([
                {"name": "task_resource", "arguments": {"action": "inspect", "ref": "observation:missing@v1"}},
                {"name": "submit_research_report", "arguments": {"report": report}},
            ]),
        },
        steps=[{"name": "auto_research", "arguments": {
            "question": "Return a bounded report and repair a rejected submission.",
            "complexity_assessment": {"level": "simple", "rationale": "One report."},
        }}],
    )

    result = results(events, "auto_research")[0]
    assert not result.get("isError"), result
    assert records(root, "auto-research-reports.jsonl")[-1]["report"]["conclusion"] == report["conclusion"]
    controls = records(root, "auto-research-child-control.jsonl")
    rejected = [item for item in controls if item["event"] == "report_submission_rejected"]
    assert len(rejected) == 1
    assert "not-a-valid-mode" in rejected[0]["error"]
    assert controls[-1]["event"] == "report_submitted"


def test_non_blocking_length_continuation_stops_when_checkpoint_does_not_advance(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-background-stagnation"
    broker = SubagentBroker()
    broker.start()
    try:
        child_env = {
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
            "PI_SUBAGENT_FORCE_LENGTH_COUNT": "4",
            "PI_AUTORESEARCH_MAX_STAGNANT_CONTINUATIONS": "2",
        }
        events = _run_fixture(
            root,
            "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[{"name": "auto_research", "arguments": {
                "question": "Run in the background until meaningful progress exists.",
                "interaction_mode": "non_blocking",
                "complexity_assessment": {"level": "simple", "rationale": "One bounded conclusion."},
            }}],
        )
        accepted = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        status = wait_for_broker_job(root, "auto-research-1")
        assert status["status"] == "stalled"
        assert status["continuation_attempts"] == 2
        inspected_events = _run_fixture(
            root,
            "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[{"name": "auto_research", "arguments": {
                "action": "inspect", "session_ref": accepted["session_ref"],
            }}],
        )
        inspected = json.loads(results(inspected_events, "auto_research")[0]["result"]["content"][0]["text"])
        assert inspected["status"] == "failed"
        assert inspected["failure_code"] == "background_child_stalled"
    finally:
        broker.close()


def test_non_blocking_provider_error_is_not_reported_as_completed(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "auto-research-background-provider-error"
    broker = SubagentBroker()
    broker.start()
    try:
        child_env = {
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
            "PI_SUBAGENT_FORCE_ERROR_AFTER_TOOL": "1",
            "PI_SUBAGENT_STEPS": json.dumps([{"name": "research_checkpoint", "arguments": {
                "action": "save", "cursor": "reviewed", "draft_findings": [{"claim": "bounded"}],
                "next_step": "submit report",
            }}]),
        }
        events = _run_fixture(
            root, "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[{"name": "auto_research", "arguments": {
                "question": "Run until the provider fails.", "interaction_mode": "non_blocking",
                "complexity_assessment": {"level": "simple", "rationale": "One result."},
            }}],
        )
        accepted = json.loads(results(events, "auto_research")[0]["result"]["content"][0]["text"])
        status = wait_for_broker_job(root, "auto-research-1")
        assert status["status"] == "failed"
        assert status["last_stop_reason"] == "error"
        assert status["failure_kind"] == "provider_error"

        inspected_events = _run_fixture(
            root, "treatment",
            extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
            extra_env=child_env,
            steps=[{"name": "auto_research", "arguments": {
                "action": "inspect", "session_ref": accepted["session_ref"],
            }}],
        )
        inspected = json.loads(results(inspected_events, "auto_research")[0]["result"]["content"][0]["text"])
        assert inspected["status"] == "failed"
        assert inspected["failure_code"] == "background_child_failed"
        assert "provider returned stopReason=error" in inspected["error"]
    finally:
        broker.close()


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
            {"name": "submit_research_report", "arguments": {"report": report}},
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
