"""Installed Pi integration, scripted offline model; no real OfficeBench score."""
import json
import os
import sys
from pathlib import Path

import pytest

from autoresearch_pi.officebench_e2e import (
    _execution_condition_effect,
    _extract_agent_outcome,
    _loop_integrity,
    _research_lifecycle,
    _resolve_pi_cli,
)
from autoresearch_pi.pi_kernel import PiKernel


def test_installed_pi_context_mutation_and_independent_baseline(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (
        node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
        "--extension", str(project / "tests" / "pi_offline_context_provider.ts"),
    )
    for scenario in ("mutate", "baseline"):
        root = tmp_path / scenario
        root.mkdir()
        with (root / "pi-events.jsonl").open("w", encoding="utf-8") as trace:
            def persist(event):
                trace.write(json.dumps(event) + "\n")
                trace.flush()
            with PiKernel(command, cwd=str(root), env={
                "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
                "PI_OFFICEBENCH_E2E_ROOT": str(root),
                "PI_OFFICEBENCH_WORKSPACE": str(root),
                "PI_TEST_SCENARIO": scenario,
            }, timeout=30, event_sink=persist) as kernel:
                response = kernel.prompt("Exercise the offline fixture, without external actions.")
                assert response.get("success") is not False, response
                events = kernel.wait_for_agent_events(timeout=30)

        assert _extract_agent_outcome(events)[1] is True
        assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
        requests = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
        assert len({request["pid"] for request in requests}) == 1
        policies = []
        for request in requests:
            # Inspect only injected guidance messages, not tool descriptions/history.
            guidance = [
                part["text"] for message in request["context"]["messages"] if message["role"] == "user"
                for part in message["content"] if part.get("type") == "text"
                and part["text"].startswith("Current task-local evidence guidance (")
            ]
            assert len(guidance) == 1  # context transformations do not accumulate
            policies.append("source_and_date" if "(source_and_date)" in guidance[0] else "summary_only")
            assert "No research stages or harness changes are mandatory" in request["context"]["systemPrompt"]
            assert "EXECUTION_OBSERVATION cards" in request["context"]["systemPrompt"]
            assert "apply or keep" in request["context"]["systemPrompt"]
            assert "officebench-task-resource-catalog-v1" in request["context"]["systemPrompt"]
            assert "current_case_testbed_only" in request["context"]["systemPrompt"]
            assert "current user's exact row time" in request["context"]["systemPrompt"]
            assert "already contains the relevant exact action contracts" in request["context"]["systemPrompt"]
            assert "Pi automatically requests the model again after each tool result" in request["context"]["systemPrompt"]
        before = json.loads((root / "pi-native" / "before.json").read_text(encoding="utf-8"))
        assert before["value"] == "summary_only"
        if scenario == "mutate":
            assert policies == ["summary_only", "summary_only", "source_and_date", "source_and_date", "summary_only", "summary_only"]
            results = [event for event in events if event.get("type") == "tool_execution_end"]
            assert results[1]["result"]["details"]["previous"] == "summary_only"
            assert results[1]["result"]["details"]["value"] == "source_and_date"
            assert "Fixture question" in results[-1]["result"]["content"][0]["text"]
            assert "Fixture follow-up" in (root / "task-notes.md").read_text(encoding="utf-8")
            observed = json.loads((root / "pi-native" / "observed.json").read_text(encoding="utf-8"))
            assert observed["toolCallId"] == "fixture-4"
            assert observed["observedBy"] == "context_hook_before_model_request"
            assert not (root / "pi-native" / "surface-after.json").exists()
            assert not (root / "pi-native" / "surface-observed.json").exists()
        else:
            assert policies == ["summary_only"]
            assert not (root / "task-notes.md").exists()
            assert not (root / "pi-native" / "after.json").exists()
            assert not (root / "pi-native" / "observed.json").exists()


def test_installed_pi_native_tool_surface_switch_and_research_resource(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "surface"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "surface", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise the optional research resource and tool surface capability.")
        events = kernel.wait_for_agent_events(timeout=30)
    assert _extract_agent_outcome(events)[1]
    first_action = next(
        event for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolCallId") == "fixture-1"
    )
    visible_result = first_action["result"]["content"][0]["text"]
    assert 'EXECUTION_OBSERVATION: {"observation_id":"fixture-1"' in visible_result
    assert '"outcome":"semantic_error"' in visible_result
    assert '"error_kind":"unknown_action"' in visible_result
    assert '"decision_support"' in visible_result
    assert '"capability_id":"execution_tool_surface"' in visible_result
    assert '"one_step_if_worthwhile"' in visible_result
    assert "remaining_uses >= 3" in visible_result
    assert 'evidence_refs=[\\"fixture-1\\"]' in visible_result
    resources = (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    finding = json.loads(resources[0])
    assert finding["finding_id"] == "finding-1"
    assert finding["evidence_refs"] == ["fixture-1"]
    assert finding["expected_recurrence"] == "high"
    assert finding["remaining_uses"] == 8
    research_result = next(
        event for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource"
    )["result"]["content"][0]["text"]
    assert "EXECUTION_DECISION_POINT:" in research_result
    assert '"finding_id":"finding-1"' in research_result
    assert '"no_change_valid":true' in research_result
    requests = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    tool_sets = [[tool["name"] for tool in request["context"]["tools"]] for request in requests]
    assert "officebench_action" in tool_sets[0]
    assert "workspace_file_action" in tool_sets[0]
    assert "task_artifact_contract" not in tool_sets[0]
    assert "officebench_action" in tool_sets[2]
    assert "officebench_action" not in tool_sets[3]
    assert "calendar_action" in tool_sets[3]
    assert "workspace_file_action" in tool_sets[3]
    finding_digests = [
        part["text"]
        for message in requests[2]["context"]["messages"] if message["role"] == "user"
        for part in message["content"] if part.get("type") == "text"
        and part["text"].startswith("Active task-local execution findings: ")
    ]
    assert len(finding_digests) == 1
    assert json.loads(finding_digests[0].split(": ", 1)[1])[0]["finding_id"] == "finding-1"
    observations = [
        part["text"]
        for message in requests[3]["context"]["messages"] if message["role"] == "user"
        for part in message["content"] if part.get("type") == "text"
        and part["text"].startswith("Task-local execution condition observation: ")
    ]
    assert len(observations) == 1
    observation = json.loads(observations[0].split(": ", 1)[1])
    assert observation["basis_resource_ids"] == ["finding-1"]
    assert observation["decision_id"] == "decision-1"
    assert observation["operation"] == {
        "capability": "pi.setActiveTools", "previous": "general", "value": "calendar_focused",
    }
    assert observation["consequence"]["status"] == "observed_by_next_model_request"
    assert "officebench_action" not in observation["consequence"]["activeTools"]
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert decision["decision_id"] == "decision-1"
    assert decision["basis_resource_ids"] == ["finding-1"]
    persisted_observation = json.loads((root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert persisted_observation["decision_id"] == "decision-1"
    assert persisted_observation["effect_observed"] is True
    assert _loop_integrity(root)["status"] == "linked_effect_observed"
    effect = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert effect["decision_id"] == "decision-1"
    assert effect["effect_metric"] == "focused_tool_use_rate"
    assert effect["window"]["relevant_calls"] == 2
    assert effect["window"]["focused_tool_calls"] == 2
    assert effect["verdict"] == "supported"
    assert _execution_condition_effect(root)["status"] == "supported"
    effect_messages = [
        part["text"]
        for request in requests for message in request["context"]["messages"] if message["role"] == "user"
        for part in message["content"] if part.get("type") == "text"
            and part["text"].startswith("Pending task-local execution condition effects ")
    ]
    assert len(effect_messages) == 1
    surface_after = json.loads((root / "pi-native" / "surface-after.json").read_text(encoding="utf-8"))
    assert surface_after["value"] == "calendar_focused"
    assert "calendar_action" in surface_after["activeTools"]


def test_installed_pi_versioned_research_lifecycle_absorbs_effect(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "research-lifecycle"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "research_lifecycle", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise the versioned task-local research lifecycle.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    records = [
        json.loads(line) for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [record["action"] for record in records] == ["open", "update", "resolve"]
    assert [record["version"] for record in records] == [1, 2, 3]
    assert {record["goal_id"] for record in records} == {"research-goal-1"}
    assert {record["finding_id"] for record in records} == {"finding-1"}
    assert records[0]["status"] == "open"
    assert records[0]["evidence_refs"] == []
    assert records[1]["status"] == "active"
    assert records[1]["evidence_refs"] == ["fixture-2"]
    assert records[2]["status"] == "resolved"
    assert records[2]["resolution"] == "supported"
    assert records[2]["assessment_refs"] == ["effect-assessment-1"]
    assert records[2]["supersedes_event_id"] == records[1]["research_event_id"]

    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert decision["basis_snapshots"] == [{
        "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 2,
        "research_event_id": records[1]["research_event_id"],
        "evidence_refs": ["fixture-2"], "assessment_refs": [],
    }]
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert assessment["basis_snapshots"][0]["version"] == 2
    assert assessment["attribution"]["confounders_controlled"] is False
    lifecycle = _research_lifecycle(root)
    assert lifecycle["status"] == "closed"
    assert lifecycle["event_count"] == 3
    assert lifecycle["pending_effect_assessment_ids"] == []
    assert lifecycle["absorbed_effect_assessment_ids"] == ["effect-assessment-1"]
    assert _loop_integrity(root)["status"] == "linked_effect_observed"
    assert _execution_condition_effect(root)["status"] == "supported"

    requests = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    open_digest = next(
        part["text"] for message in requests[1]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text" and part["text"].startswith("Active task-local execution findings: ")
    )
    assert json.loads(open_digest.split(": ", 1)[1])[0]["status"] == "open"
    pending = [
        part["text"] for message in requests[4]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text"
        and part["text"].startswith("Pending task-local execution condition effects ")
    ]
    assert len(pending) == 1
    assert "effect-assessment-1" in pending[0]
    final_active = [
        part["text"] for message in requests[-1]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text" and part["text"].startswith("Active task-local execution findings: ")
    ]
    final_pending = [
        part["text"] for message in requests[-1]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text"
        and part["text"].startswith("Pending task-local execution condition effects ")
    ]
    assert final_active == []
    assert final_pending == []


def test_installed_pi_effect_window_starts_only_after_surface_exposure(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "exposure-gate"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "exposure_gate", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise the post-exposure effect boundary.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert assessment["exposure_observed"] is True
    assert assessment["window"]["observation_ids"] == ["fixture-5"]
    assert assessment["window"]["relevant_calls"] == 1
    assert assessment["window"]["focused_tool_calls"] == 1
    assert assessment["verdict"] == "supported"


def test_installed_pi_workspace_file_action_enforces_task_boundary(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "workspace-boundary"
    (root / "testbed" / "data").mkdir(parents=True)
    (root / "testbed" / "data" / "input.txt").write_text("task data", encoding="utf-8")
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "workspace_boundary"}, timeout=30) as kernel:
        kernel.prompt("Exercise the bounded task workspace resource.")
        events = kernel.wait_for_agent_events(timeout=30)

    results = [
        event["result"]["details"]["observation"]
        for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "workspace_file_action"
    ]
    assert results[0]["outcome"] == "success"
    assert "data/input.txt" in results[0]["result_summary"]
    assert results[1]["outcome"] == "semantic_error"
    assert results[1]["error_kind"] == "task_resource_boundary_violation"


def test_installed_pi_enables_batch_only_after_finding_backed_surface_decision(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "batch-surface"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "batch_surface", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise the optional finding-backed batch capability.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    requests = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    tool_sets = [[tool["name"] for tool in request["context"]["tools"]] for request in requests]
    assert "calendar_batch_action" not in tool_sets[0]
    assert "email_action" in tool_sets[0]
    assert "workspace_file_action" in tool_sets[0]
    assert "calendar_batch_action" not in tool_sets[1]
    assert "calendar_batch_action" in tool_sets[2]
    assert "officebench_action" not in tool_sets[2]
    assert "email_action" in tool_sets[2]
    email_tool = next(tool for tool in requests[0]["context"]["tools"] if tool["name"] == "email_action")
    assert "send_email" in email_tool["description"]
    assert "sender" in email_tool["description"]
    assert "recipient" in email_tool["description"]

    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    batch_observation = next(
        json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(line).get("tool") == "calendar_batch_action"
    )
    effect = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert finding["evidence_refs"] == ["fixture-1"]
    assert finding["goal_id"] == "research-goal-1"
    capability_catalog = json.loads((root / "capability-catalog.json").read_text(encoding="utf-8"))
    assert capability_catalog["initial_surface"] == "general"
    assert "calendar_batch_action" not in capability_catalog["active_tools"]
    assert "email_action" in capability_catalog["active_tools"]
    assert capability_catalog["available_inactive"][0]["tool"] == "calendar_batch_action"
    assert capability_catalog["available_inactive"][0]["effective_at"] == "next_model_request"
    assert decision["value"] == "calendar_batch"
    assert decision["effect_metric"] == "calendar_batch_utilization"
    assert decision["decision_path"] == "research_resource.continue_with"
    assert batch_observation["attempted_work_units"] == 3
    assert batch_observation["completed_work_units"] == 3
    assert effect["window"]["batch_tool_calls"] == 1
    assert effect["window"]["attempted_work_units"] == 3
    assert effect["window"]["completed_work_units"] == 3
    assert effect["window"]["tool_call_compression"] == 3
    assert effect["verdict"] == "supported"
    assert _execution_condition_effect(root)["status"] == "supported"
    assert _loop_integrity(root)["status"] == "linked_effect_observed"


def test_installed_pi_enables_email_batch_after_source_backed_decision(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "email-batch-surface"
    (root / "testbed" / "data").mkdir(parents=True)
    (root / "task-resource-catalog.json").write_text(json.dumps({
        "format": "officebench-task-resource-catalog-v1",
        "scope": "current_case_testbed_only",
        "inventory": {"root": ".", "entries": [{"path": "data/team.xlsx", "kind": "file"}], "truncated": False},
        "relevant_apps": ["excel", "email", "calendar"],
        "action_contracts": {"excel.read_file": {"args": {"file_path": "relative path"}},
                             "email.send_email": {"args": {"sender": "string", "recipient": "string",
                                                              "subject": "string", "content": "string"}}},
        "task_language_conventions": {},
        "canonical_contract": {"path": "artifact-contract.json", "format": "officebench-task-artifact-contract-v1"},
    }), encoding="utf-8")
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "email_batch_surface", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise the source-backed email batch capability.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    requests = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    tool_sets = [[tool["name"] for tool in request["context"]["tools"]] for request in requests]
    assert "task_artifact_contract" not in tool_sets[0]
    assert "email_batch_action" not in tool_sets[0]
    assert "workspace_file_action" not in tool_sets[0]
    assert "email_batch_action" not in tool_sets[1]
    assert "email_batch_action" in tool_sets[2]
    assert "calendar_action" in tool_sets[2]
    observation = json.loads((root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert observation["operation"] == "excel.read_file"
    assert observation["decision_support"]["candidate_mode"] == "email_batch"
    assert observation["decision_support"]["cost_model"] == {
        "direct_bridge_processes": "remaining_uses",
        "batch_bridge_processes": 1,
        "decision_model_requests": 1,
        "break_even_remaining_uses": 4,
    }
    assert observation["decision_support"]["input_shape"] == (
        "sender, subject, content_template, recipients[{recipient,variables}]"
    )
    assert "remaining_uses >= 4" in observation["decision_support"]["one_step_if_worthwhile"]
    assert 'evidence_refs=["fixture-1"]' in observation["decision_support"]["one_step_if_worthwhile"]
    assert "continue directly without research or change" in (
        observation["decision_support"]["one_step_if_worthwhile"]
    )
    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    effect = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    batch = next(
        json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(line).get("tool") == "email_batch_action"
    )
    assert finding["evidence_refs"] == ["fixture-1"]
    assert decision["value"] == "email_batch"
    assert decision["effect_metric"] == "email_batch_utilization"
    assert decision["decision_path"] == "research_resource.continue_with"
    assert batch["attempted_work_units"] == 3
    assert batch["completed_work_units"] == 3
    assert effect["window"]["batch_tool_calls"] == 1
    assert effect["window"]["observation_ids"] == ["fixture-4"]
    assert effect["window"]["tool_call_compression"] == 3
    assert effect["verdict"] == "supported"
    assert _execution_condition_effect(root)["status"] == "supported"
    assert _loop_integrity(root)["status"] == "linked_effect_observed"
    capability_catalog = json.loads((root / "capability-catalog.json").read_text(encoding="utf-8"))
    email_capability = next(
        item for item in capability_catalog["available_inactive"] if item["tool"] == "email_batch_action"
    )
    assert email_capability["input"] == "shared sender/subject/content_template plus 2-16 recipient variable maps"


def test_installed_pi_discloses_each_batch_candidate_once(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "decision-support-once"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "decision_support_once", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise one-time decision support.")
        kernel.wait_for_agent_events(timeout=30)

    observations = [
        json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [record["decision_support"]["candidate_mode"] for record in observations if record.get("decision_support")] == [
        "email_batch",
    ]


@pytest.mark.parametrize("scenario,expect_finding,expect_decision,expect_error", [
    ("baseline", False, False, False),
    ("transient", True, True, False),
    ("invalid_surface", False, False, True),
])
def test_installed_pi_decision_quality_paths(tmp_path, scenario, expect_finding, expect_decision, expect_error):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / scenario
    root.mkdir()
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": scenario}, timeout=30) as kernel:
        kernel.prompt("Exercise one decision-quality fixture.")
        events = kernel.wait_for_agent_events(timeout=30)
    errors = [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert bool(errors) is expect_error
    assert (root / "research-resources.jsonl").exists() is expect_finding
    assert (root / "harness-decisions.jsonl").exists() is expect_decision
    if scenario == "transient":
        decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
        assert decision["choice"] == "keep"
        assert decision["applied"] is False
        assert not (root / "pi-native" / "surface-after.json").exists()
        assert _loop_integrity(root)["status"] == "kept_unchanged"
