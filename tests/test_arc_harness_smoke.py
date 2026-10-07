"""Focused diagnostics for the real-runner ARC smoke checkers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import autoresearch_pi.arc_harness_smoke as smoke


TOOL_NAME = "task_tool_smoke-frame-row-count_v1"
TOOL_REF = "tool:smoke-frame-row-count@v1"
FIRST_SNAPSHOT = "observation_snapshot:parent-state-1@v1"
SECOND_SNAPSHOT = "observation_snapshot:parent-state-2@v1"
FRAME_PATH = ["public_state", "frames", 0]
HASH = "a" * 64


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value) + "\n", encoding="utf-8")


def write_jsonl(path: Path, values: list[dict]) -> None:
    path.write_text("".join(json.dumps(value) + "\n" for value in values), encoding="utf-8")


def build_pure_scenario(root: Path) -> None:
    root.mkdir()
    write_json(root / "summary.json", {"runtime": {
        "pi_returncode": 0, "timed_out": False, "agent_actions": 2, "environment_error_count": 0,
    }})
    bindings = [{"name": "grid", "ref": FIRST_SNAPSHOT, "path": FRAME_PATH}]
    steps = [
        ("task_harness", {"action": "read_method", "method_name": "tool-creator"}),
        ("task_harness", {"action": "change"}),
        ("task_harness", {"action": "assemble"}),
        (TOOL_NAME, {"parameters": {}, "bindings": bindings}),
        ("arc_action", {"action": "ACTION1"}),
        (TOOL_NAME, {"parameters": {}, "bindings": bindings}),
        ("arc_action", {"action": "ACTION2"}),
    ]
    write_jsonl(root / "pi-events.jsonl", [
        {"type": "tool_execution_start", "toolName": name, "args": args} for name, args in steps
    ])
    creator_ref = "baseline_method:tool-creator@sha256:" + HASH
    write_jsonl(root / "task-baseline-method-reads.jsonl", [{
        "name": "tool-creator", "origin": "baseline", "actor": "parent", "method_ref": creator_ref,
    }])
    write_jsonl(root / "task-harness-change-receipts.jsonl", [{
        "status": "applied", "results": [{
            "native_tool": "task_tool", "resource": {"resource_ref": TOOL_REF},
        }],
    }])
    write_jsonl(root / "task-tools.jsonl", [{
        "name": "smoke-frame-row-count", "status": "active", "implementation_ref": "task.local.pure_expression",
        "authoring_method_ref": creator_ref,
        "program": {"format": "task-pure-expression-v1", "limits": {},
                    "expression": {"op": "length", "value": {"op": "input"}}},
        "output_schema": {"type": "number"}, "program_sha256": HASH,
        "input_schema_sha256": HASH, "output_schema_sha256": HASH,
    }])
    write_jsonl(root / "task-harness-assemblies.jsonl", [{
        "selection_mode": "explicit", "selected_resource_refs": [TOOL_REF],
    }])
    frame = [[1, 2], [3, 4], [5, 6]]
    write_jsonl(root / "observation-snapshots.jsonl", [
        {"snapshot_id": "parent-state-1", "version": 1, "decision_cycle_sequence": 1,
         "public_state": {"frames": [frame]}},
        {"snapshot_id": "parent-state-2", "version": 1, "decision_cycle_sequence": 2,
         "public_state": {"frames": [[[9]]] }},
    ])
    write_jsonl(root / "arc-smoke-provider-contexts.jsonl", [
        {"child": False, "announced_snapshot_refs": [FIRST_SNAPSHOT]},
        {"child": False, "announced_snapshot_refs": [SECOND_SNAPSHOT]},
    ])
    binding_hashes = {"record_sha256": HASH, "content_sha256": HASH,
                      "resolved_value_sha256": HASH, "resolved_value_bytes": 13}
    serialized_binding = {**bindings[0], "path": ["public_state", "frames", "0"]}
    fresh = {"bindings": [{**serialized_binding, **binding_hashes, "historical_or_stale": False,
                            "capture_boundary": {"total_used": 0},
                            "current_observed_boundary": {"total_used": 0}}]}
    stale = {"bindings": [{**serialized_binding, **binding_hashes, "historical_or_stale": True,
                            "capture_boundary": {"total_used": 0},
                            "current_observed_boundary": {"total_used": 1}}]}
    pure = lambda provenance: {
        "representation": "task-pure-expression-v1", "output_schema_validated": True,
        "consumed": {"steps": 5}, "output_sha256": HASH, "input_provenance": provenance,
    }
    write_jsonl(root / "task-tool-events.jsonl", [
        {"event": "invoked", "name": "smoke-frame-row-count", "status": "completed",
         "output_excerpt": "3", "pure_expression": pure(fresh)},
        {"event": "invoked", "name": "smoke-frame-row-count", "status": "completed",
         "output_excerpt": "3", "pure_expression": pure(stale)},
    ])
    write_jsonl(root / "harness-observations.jsonl", [
        {"observation_kind": "pi_task_tool_invocation", "actual_use": True,
         "semantic_effect_observed": True},
        {"observation_kind": "pi_task_tool_invocation", "actual_use": True,
         "semantic_effect_observed": True},
    ])


def test_pure_expression_validator_covers_semantics_and_historical_provenance(tmp_path):
    root = tmp_path / "pure"
    build_pure_scenario(root)

    result = smoke._validate_pure_expression_scenario(root)

    assert result["passed"] is True
    assert len(result["checks"]) == 20
    assert all(check["passed"] for check in result["checks"])
    messages = {check["check"] for check in result["checks"]}
    assert "both executions returned the semantic row count of the exact bound frame" in messages
    assert "later invocation intentionally reused the old exact ref and recorded stale historical provenance" in messages


def test_pure_expression_validator_rejects_unmarked_historical_reuse(tmp_path):
    root = tmp_path / "pure"
    build_pure_scenario(root)
    rows = smoke._records(root / "task-tool-events.jsonl")
    rows[1]["pure_expression"]["input_provenance"]["bindings"][0]["historical_or_stale"] = False
    write_jsonl(root / "task-tool-events.jsonl", rows)

    result = smoke._validate_pure_expression_scenario(root)

    assert result["passed"] is False
    failed = [check["check"] for check in result["checks"] if not check["passed"]]
    assert failed == ["later invocation intentionally reused the old exact ref and recorded stale historical provenance"]


def test_pure_expression_case_uses_real_runner_configuration(monkeypatch, tmp_path):
    calls = []

    def capture(*args, **kwargs):
        calls.append((args, kwargs))
        raise RuntimeError("stop after configuration capture")

    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(
        tmp_path / "run", arc_root=tmp_path / "arc", mock_environment=True,
        case="pure-expression-tool",
    )

    assert len(calls) == 1
    _, kwargs = calls[0]
    assert kwargs["max_actions"] == 2
    assert kwargs["pi_provider_extension"].name == "arc_harness_smoke_provider.ts"
    assert kwargs["pi_environment"]["PI_ARC_SMOKE_SCENARIO"] == "pure_expression"
    summary = json.loads(output.read_text(encoding="utf-8"))
    assert len(summary["scenarios"]) == 1
    assert summary["scenarios"][0]["error"] == "RuntimeError: stop after configuration capture"


def test_default_matrix_keeps_all_cases_including_continuous_workers(monkeypatch, tmp_path):
    roots = []

    def capture(root, **_kwargs):
        roots.append(root.name)
        raise RuntimeError("configuration-only matrix probe")

    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(
        tmp_path / "run", arc_root=tmp_path / "arc", mock_environment=True,
    )

    assert len(roots) == 18
    assert roots[-2:] == ["minimal-five-pool", "continuous-workers"]
    assert "source-handoff-tool" in roots
    assert len(set(roots)) == 18
    summary = json.loads(output.read_text(encoding="utf-8"))
    assert len(summary["scenarios"]) == 18


def test_continuous_memory_pool_is_a_real_runner_case(monkeypatch, tmp_path):
    calls = []

    def capture(root, **kwargs):
        calls.append((root, kwargs))
        raise RuntimeError("stop after configuration capture")

    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(
        tmp_path / "run", arc_root=tmp_path / "arc", mock_environment=True,
        case="continuous-memory-pool",
    )
    assert len(calls) == 1
    _, kwargs = calls[0]
    assert kwargs["max_actions"] == 3
    assert kwargs["pi_environment"]["PI_ARC_SMOKE_MEMORY_POOL"] == "1"
    assert kwargs["pi_environment"]["PI_ARC_SMOKE_SCENARIO"] == "memory"
    summary = json.loads(output.read_text(encoding="utf-8"))
    assert summary["environment_mocked"] is True
    assert summary["scenarios"][0]["error"] == "RuntimeError: stop after configuration capture"


def test_direct_development_is_opt_in_real_runner_diagnostic(monkeypatch, tmp_path):
    calls = []

    def capture(*args, **kwargs):
        calls.append((args, kwargs))
        raise RuntimeError("stop after configuration capture")

    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(
        tmp_path / "run", arc_root=tmp_path / "arc", case="direct-development-intent",
    )

    assert len(calls) == 1
    _, kwargs = calls[0]
    assert kwargs["max_actions"] == 3
    assert kwargs["arc_root"] == tmp_path / "arc"
    assert "bridge_python" not in kwargs
    assert kwargs["pi_environment"]["PI_ARC_SMOKE_SCENARIO"] == "direct_development_intent"
    summary = json.loads(output.read_text(encoding="utf-8"))
    assert summary["environment_mocked"] is False
    assert len(summary["scenarios"]) == 1


def test_online_retrospective_is_opt_in_real_runner_diagnostic(monkeypatch, tmp_path):
    calls = []

    def capture(*args, **kwargs):
        calls.append((args, kwargs))
        raise RuntimeError("stop after configuration capture")

    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(
        tmp_path / "run", arc_root=tmp_path / "arc", case="online-retrospective",
    )

    assert len(calls) == 1
    _, kwargs = calls[0]
    assert kwargs["max_actions"] == 4
    assert kwargs["arc_root"] == tmp_path / "arc"
    assert "bridge_python" not in kwargs
    assert kwargs["pi_environment"]["PI_ARC_SMOKE_SCENARIO"] == "online_retrospective"
    summary = json.loads(output.read_text(encoding="utf-8"))
    assert summary["environment_mocked"] is False
    assert len(summary["scenarios"]) == 1


@pytest.mark.parametrize("resolution", ["matching", "missing", "different_target", "different_failure", "unknown_call", "failed_call", "still_pending", "missing_call"])
def test_review_repair_validator_requires_same_operation_resolution(tmp_path, resolution):
    # Failure records are immutable; successful recovery is a separate event.
    def write(name, records):
        (tmp_path / name).write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")

    (tmp_path / "summary.json").write_text(json.dumps({"runtime": {"pi_returncode": 0, "agent_actions": 6}}), encoding="utf-8")
    failure = {"resource_ref": "failure:failure-1@v1", "status": "failed", "operation_key": "bound-review-1", "toolCallId": "failed-review"}
    write("task-operation-failures.jsonl", [failure])
    write("pi-events.jsonl", [
        {"type": "tool_execution_end", "toolCallId": "failed-review", "isError": True},
        {"type": "tool_execution_end", "toolCallId": "repaired-review", "isError": resolution == "failed_call"},
    ])
    record = {"failure_ref": failure["resource_ref"], "operation_key": failure["operation_key"],
              "resolved_operation_key": failure["operation_key"], "resolved_by": "repaired-review"}
    if resolution == "different_target":
        record["resolved_operation_key"] = "bound-review-2"
    if resolution == "different_failure":
        record["failure_ref"] = "failure:failure-2@v1"
    if resolution == "unknown_call":
        record["resolved_by"] = "unknown-call"
    if resolution == "missing_call":
        record.pop("resolved_by")
    write("task-operation-resolutions.jsonl", [] if resolution == "missing" else [record])
    (tmp_path / "task-checkpoint.json").write_text(json.dumps({"pending_operations": [failure] if resolution == "still_pending" else []}), encoding="utf-8")
    result = smoke._validate_review_input_repair(tmp_path)
    check = next(c for c in result["checks"] if c["check"] == "success for the same bound review resolves its failure")
    assert check["passed"] is (resolution == "matching")


@pytest.mark.parametrize("variant", ["fresh", "stale", "same_parent", "wrong_boundary"])
def test_checkpoint_batch_validator_requires_fresh_parent_and_action_snapshot(tmp_path, variant):
    def write(name, records):
        (tmp_path / name).write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    (tmp_path / "summary.json").write_text(json.dumps({"runtime": {"pi_returncode": 0, "agent_actions": 3}}))
    (tmp_path / "task-checkpoint.json").write_text("{}")
    write("pi-events.jsonl", [{"type": "agent_start"}] * (1 if variant == "same_parent" else 3))
    write("observation-snapshots.jsonl", [{"snapshot_id": f"s{i}", "version": 1,
        "latest_successful_action_event_boundary": {"total_used": 0 if variant == "wrong_boundary" else i}} for i in range(3)])
    write("arc-smoke-provider-contexts.jsonl", [{"announced_snapshot_refs": [f"observation_snapshot:s{0 if variant == 'stale' else i}@v1"]} for i in range(3)])
    result = smoke._validate_checkpoint_action_batch(tmp_path)
    check = next(c for c in result["checks"] if c["check"].startswith("each batch ends its parent cycle"))
    assert check["passed"] is (variant == "fresh")


@pytest.mark.parametrize("variant", ["complete", "missing_state", "missing_later_input", "stale_snapshot"])
def test_action_knowledge_validator_requires_semantics_and_fresh_inputs(tmp_path, variant):
    def write(name, rows):
        (tmp_path / name).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    knowledge = {"known_effects": ["SMOKE_ACTION_EFFECT: no supported control yet"],
        "knowledge_gaps": ["SMOKE_ACTION_GAP: goal is unknown"],
        "counterevidence": [{"fact": "SMOKE_ACTION_COUNTEREXAMPLE: change alone is not a goal rule",
                             "source_ref": "observation:execution-observation-1@v1"}]}
    (tmp_path / "summary.json").write_text(json.dumps({"runtime": {"pi_returncode": 0, "agent_actions": 3}}))
    (tmp_path / "task-checkpoint.json").write_text(json.dumps({
        "decision_state": {} if variant == "missing_state" else knowledge,
        "current_subgoal": "SMOKE_ACTION_SUBGOAL: compare controls",
        "hypothesis": "SMOKE_ACTION_HYPOTHESIS: controls unknown",
        "next_step": "SMOKE_ACTION_NEXT: contrast another control",
        "latest_environment": {"action_budget": {"total_used": 3}}}))
    write("pi-events.jsonl", [{"type": "agent_start"}] * 3 + [
        {"type": "tool_execution_end", "toolName": "arc_action", "isError": False}] * 3)
    write("bridge-events.jsonl", [{"event": "action", "action": f"ACTION{i+1}"} for i in range(3)])
    write("observation-snapshots.jsonl", [{"snapshot_id": f"s{i}", "version": 1,
        "latest_successful_action_event_boundary": {"total_used": i}} for i in range(3)])
    write("arc-smoke-provider-contexts.jsonl", [{"complete_observation_present": True,
        "announced_snapshot_refs": [f"observation_snapshot:s{0 if variant == 'stale_snapshot' else i}@v1"],
        "checkpoint_batch_state": "" if variant == "missing_later_input" else json.dumps(knowledge)} for i in range(3)])
    result = smoke._validate_action_knowledge(tmp_path)
    assert result["passed"] is (variant == "complete")


def test_action_knowledge_case_uses_actual_three_parent_runner(monkeypatch, tmp_path):
    calls = []
    def capture(root, **kwargs):
        calls.append(kwargs)
        raise RuntimeError("configuration only")
    monkeypatch.setattr(smoke, "run_arc_agi_3_e2e", capture)
    output = smoke.run_arc_harness_smoke(tmp_path, arc_root=tmp_path / "sdk", case="action-knowledge")
    assert len(calls) == 1 and calls[0]["max_actions"] == 3
    assert calls[0]["review_mode"] == "advisory"
    assert calls[0]["pi_environment"]["PI_ARC_SMOKE_SCENARIO"] == "action_knowledge"
    assert not json.loads(output.read_text())["environment_mocked"]


@pytest.mark.parametrize("variant", ["terminal_only", "midgame_missing", "all_terminal", "no_terminal_metadata"])
def test_minimal_pool_memory_retention_requires_post_use_gameplay_context(tmp_path, variant):
    write_json(tmp_path / "summary.json", {"runtime": {
        "pi_returncode": 0, "timed_out": False, "agent_actions": 2, "environment_error_count": 0,
    }})
    contexts = [{
        "child": False, "request": request, "terminal_review": request == 13,
        "messages_have_pool_memory_marker": 7 <= request <= 12,
        "messages_have_pool_skill_marker": request >= 7,
        "system_has_pool_marker": request >= 12,
        "tool_names": ["read"] if request >= 7 else [],
    } for request in range(14)]
    if variant == "midgame_missing":
        contexts[10]["messages_have_pool_memory_marker"] = False
    elif variant == "all_terminal":
        for row in contexts:
            row["terminal_review"] = True
    elif variant == "no_terminal_metadata":
        contexts[-1].pop("terminal_review")
    write_jsonl(tmp_path / "arc-smoke-provider-contexts.jsonl", contexts)

    result = smoke._validate_minimal_five_pool(tmp_path)

    check = next(row for row in result["checks"] if row["check"] ==
                 "selected Memory remained in the live projection after Skill read, Tool and Subagent use")
    assert check["passed"] is (variant == "terminal_only")
    if variant == "terminal_only":
        for message in (
            "a later parent context after exact assembly received the selected memory body",
            "later parent context contained the selected Skill body after exact scoped read",
            "Skill assembly exposed the already-authorized confined read schema",
            "later parent context retained the standalone system-prompt selection",
        ):
            assert next(row for row in result["checks"] if row["check"] == message)["passed"]
