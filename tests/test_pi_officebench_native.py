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


def test_installed_pi_task_runtime_omits_weak_evidence_policy(tmp_path):
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
    root = tmp_path / "baseline"
    root.mkdir()
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "baseline",
    }, timeout=30) as kernel:
        response = kernel.prompt("Inspect the bounded task runtime.")
        assert response.get("success") is not False, response
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1] is True
    request = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])
    tool_names = {tool["name"] for tool in request["context"]["tools"]}
    assert "set_evidence_policy" not in tool_names
    guidance = [
        part["text"] for message in request["context"]["messages"] if message["role"] == "user"
        for part in message["content"] if part.get("type") == "text"
        and part["text"].startswith("Current task-local evidence guidance (")
    ]
    assert guidance == []
    prompt = request["context"]["systemPrompt"]
    assert "No research stages or harness changes are mandatory" in prompt
    assert "neutral EXECUTION_OBSERVATION metadata" in prompt
    assert "The runtime does not infer capability candidates from task actions" in prompt
    assert "calendar_batch_action" in prompt
    assert "email_batch_action" in prompt


def test_installed_pi_control_variant_hides_agent_visible_attribution(tmp_path):
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
    root = tmp_path / "control"
    root.mkdir()
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_OFFICEBENCH_EXPERIMENT_VARIANT": "control",
        "PI_TEST_SCENARIO": "control_observation",
        "JIT_ROOT": r"D:\JIT",
        "JIT_PYTHON": sys.executable,
    }, timeout=30) as kernel:
        kernel.prompt("Exercise the control condition.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1] is True
    request = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])
    tool_names = {tool["name"] for tool in request["context"]["tools"]}
    assert tool_names == {
        "officebench_action", "calendar_action", "email_action",
        "workspace_file_action", "task_notes", "excel_action",
    }
    system_prompt = request["context"]["systemPrompt"]
    assert "No research stages or harness changes are mandatory" not in system_prompt
    assert "Current task capability catalog (bounded static disclosure)" not in system_prompt
    assert "calendar_batch_action" not in system_prompt
    assert "email_batch_action" not in system_prompt
    assert "expected reduction in calls, errors, or context" not in system_prompt
    assert "decision_support" not in system_prompt
    injected = [
        part["text"] for message in request["context"]["messages"] if message["role"] == "user"
        for part in message["content"] if part.get("type") == "text"
        and part["text"].startswith("Current task-local evidence guidance (")
    ]
    assert injected == []
    observations = [
        json.loads(line)
        for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(observations) == 1
    assert all("decision_support" not in observation for observation in observations)


def test_installed_pi_research_surface_omits_unproven_learning_signal(tmp_path):
	try:
		node, cli = _resolve_pi_cli()
	except RuntimeError as exc:
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	root = tmp_path / "research-surface"
	root.mkdir()
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
		"PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
		"PI_TEST_SCENARIO": "baseline",
	}, timeout=30) as kernel:
		kernel.prompt("Inspect the available task-local research surface.")
		events = kernel.wait_for_agent_events(timeout=30)
	assert _extract_agent_outcome(events)[1]
	request = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])
	research_tool = next(tool for tool in request["context"]["tools"] if tool["name"] == "research_resource")
	assert "learning_signal" not in json.dumps(research_tool, ensure_ascii=False)


def test_installed_pi_rehydrates_and_inspects_task_local_resources(tmp_path):
	try:
		node, cli = _resolve_pi_cli()
	except RuntimeError as exc:
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	root = tmp_path / "resource-inspect"
	root.mkdir()
	(root / "research-resources.jsonl").write_text(json.dumps({
		"research_event_id": "research-event-7", "action": "record", "version": 2,
		"goal_id": "research-goal-1", "finding_id": "finding-1", "question": "q",
		"scope": "current task", "uncertainty": "u", "evidence_plan": [],
		"evidence": "observed " + "x" * 1000, "decision": "keep " + "y" * 1000, "evidence_refs": ["old-observation"],
		"assessment_refs": ["effect-assessment-3"], "expected_recurrence": "high",
		"remaining_uses": 2, "status": "resolved", "resolution": "supported",
		"recordedAt": "2026-01-01T00:00:00Z", "source": "task_agent",
	}) + "\n", encoding="utf-8")
	(root / "effect-assessments.jsonl").write_text(json.dumps({
		"effect_assessment_id": "effect-assessment-3", "decision_id": "decision-2",
		"effect_metric": "calendar_batch_utilization", "verdict": "supported",
	}) + "\n", encoding="utf-8")
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_OFFICEBENCH_E2E_ROOT": str(root),
		"PI_OFFICEBENCH_WORKSPACE": str(root), "PI_TEST_SCENARIO": "resource_inspect",
	}, timeout=30) as kernel:
		kernel.prompt("Inspect the task-local research resource.")
		events = kernel.wait_for_agent_events(timeout=30)
	assert _extract_agent_outcome(events)[1]
	result = next(event for event in events if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource")["result"]
	resource = json.loads(result["content"][0]["text"])
	assert resource["read_only"] is True
	assert resource["findings"][0]["finding_id"] == "finding-1"
	assert resource["findings"][0]["version"] == 2
	assert len(resource["findings"][0]["evidence"]) <= 240
	assert len(resource["findings"][0]["decision"]) <= 240
	assert resource["resolved_effect_assessments"][0]["effect_assessment_id"] == "effect-assessment-3"
	assert not (root / "harness-decisions.jsonl").exists()


def test_installed_pi_explicitly_recalls_old_finding_without_restoring_old_surface(tmp_path):
	"""Catches bounded context eviction making canonical current-task history unreachable."""
	try:
		node, cli = _resolve_pi_cli()
	except RuntimeError as exc:
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
	           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
	           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
	           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	root = tmp_path / "old-finding-recall"
	root.mkdir()
	records = [{
		"research_event_id": f"research-event-{index}", "action": "record", "version": 1,
		"goal_id": f"research-goal-{index}", "finding_id": f"finding-{index}",
		"question": f"question {index}", "scope": "current task", "uncertainty": "u",
		"evidence_plan": [], "evidence": f"evidence {index}", "decision": f"decision {index}",
		"evidence_refs": [f"old-observation-{index}"], "assessment_refs": [],
		"expected_recurrence": "medium", "remaining_uses": 1,
		"status": "active", "resolution": None,
		"recordedAt": f"2026-01-01T00:00:0{index}Z", "source": "task_agent",
	} for index in range(1, 8)]
	(root / "research-resources.jsonl").write_text(
		"".join(json.dumps(record) + "\n" for record in records), encoding="utf-8",
	)
	(root / "harness-decisions.jsonl").write_text(json.dumps({
		"decision_id": "old-decision", "applied": True, "value": "calendar_batch",
	}) + "\n", encoding="utf-8")
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_OFFICEBENCH_E2E_ROOT": str(root),
		"PI_OFFICEBENCH_WORKSPACE": str(root), "PI_TEST_SCENARIO": "resource_inspect_oldest",
	}, timeout=30) as kernel:
		kernel.prompt("Explicitly inspect an older current-task finding.")
		events = kernel.wait_for_agent_events(timeout=30)

	result = next(event for event in events if event.get("type") == "tool_execution_end"
	              and event.get("toolName") == "research_resource")["result"]
	resource = json.loads(result["content"][0]["text"])
	assert [finding["finding_id"] for finding in resource["findings"]] == ["finding-1"]
	request = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])
	tool_names = {tool["name"] for tool in request["context"]["tools"]}
	assert "calendar_batch_action" not in tool_names
	assert "officebench_action" in tool_names


def test_installed_pi_same_task_restart_reads_agent_authored_finding(tmp_path):
	try:
		node, cli = _resolve_pi_cli()
	except RuntimeError as exc:
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	root = tmp_path / "same-task-restart"
	root.mkdir()
	env = {
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_OFFICEBENCH_E2E_ROOT": str(root),
		"PI_OFFICEBENCH_WORKSPACE": str(root), "PI_TEST_SCENARIO": "research_record",
	}
	with PiKernel(command, cwd=str(root), env=env, timeout=30) as kernel:
		kernel.prompt("Write one optional task-local finding.")
		events = kernel.wait_for_agent_events(timeout=30)
	assert _extract_agent_outcome(events)[1]
	assert (root / "research-resources.jsonl").is_file()

	env["PI_TEST_SCENARIO"] = "resource_inspect"
	with PiKernel(command, cwd=str(root), env=env, timeout=30) as kernel:
		kernel.prompt("Inspect the finding left by the earlier process.")
		events = kernel.wait_for_agent_events(timeout=30)
	assert _extract_agent_outcome(events)[1]
	result = next(event for event in events if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource")["result"]
	resource = json.loads(result["content"][0]["text"])
	assert resource["read_only"] is True
	assert [finding["finding_id"] for finding in resource["findings"]] == ["finding-1"]
	assert resource["findings"][0]["version"] == 1
	assert not (root / "harness-decisions.jsonl").exists()


def test_installed_pi_same_task_restart_can_continue_from_inspected_finding(tmp_path):
	try:
		node, cli = _resolve_pi_cli()
	except RuntimeError as exc:
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	root = tmp_path / "same-task-continue"
	root.mkdir()
	env = {"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_OFFICEBENCH_E2E_ROOT": str(root),
	       "PI_OFFICEBENCH_WORKSPACE": str(root), "PI_TEST_SCENARIO": "research_record"}
	with PiKernel(command, cwd=str(root), env=env, timeout=30) as kernel:
		kernel.prompt("Write one task-local finding.")
		assert _extract_agent_outcome(kernel.wait_for_agent_events(timeout=30))[1]
	env["PI_TEST_SCENARIO"] = "resource_continue"
	with PiKernel(command, cwd=str(root), env=env, timeout=30) as kernel:
		kernel.prompt("Continue the same task using any relevant inspected finding.")
		events = kernel.wait_for_agent_events(timeout=30)
	assert _extract_agent_outcome(events)[1]
	decision = next(event for event in events if event.get("type") == "tool_execution_end" and event.get("toolName") == "decide_execution_surface")["result"]["details"]
	assert decision["basis_resource_ids"] == ["finding-1"]
	assert decision["applied"] is True
	assert decision["value"] == "calendar_focused"
	assert (root / "harness-observations.jsonl").is_file()


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
    assert '"tool":"officebench_action"' in visible_result
    assert '"decision_support"' not in visible_result
    assert '"candidate_mode"' not in visible_result
    assert "remaining_uses >=" not in visible_result
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
    projected_finding = json.loads(research_result)
    assert projected_finding["finding_id"] == "finding-1"
    assert "decision_point" not in projected_finding
    assert "candidate_mode" not in research_result
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
        and part["text"].startswith("Task-local execution findings: ")
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
        if part.get("type") == "text" and part["text"].startswith("Task-local execution findings: ")
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
        if part.get("type") == "text" and part["text"].startswith("Task-local execution findings: ")
    ]
    final_pending = [
        part["text"] for message in requests[-1]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text"
        and part["text"].startswith("Pending task-local execution condition effects ")
    ]
    assert final_active == []
    assert final_pending == []


def test_installed_pi_compact_experience_record_and_retention(tmp_path):
    """Agent-authored failure connection remains available without runtime prompts."""
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "experience-retention"
    root.mkdir()
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "experience_retention",
    }, timeout=30) as kernel:
        kernel.prompt("Exercise sparse task-local experience retention.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    failed_reads = [
        event for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "workspace_file_action"
    ]
    assert "RESEARCH_DECISION_POINT:" not in failed_reads[0]["result"]["content"][0]["text"]
    second_failure = failed_reads[1]["result"]["content"][0]["text"]
    assert "RESEARCH_DECISION_POINT:" not in second_failure
    assert '"observation_id":"fixture-2"' in second_failure
    assert '"outcome":"semantic_error"' in second_failure

    records = [
        json.loads(line) for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert records[0]["action"] == "record"
    assert records[0]["question"] == "What should later execution infer from the cited outcome?"
    assert records[0]["uncertainty"] == "Whether this finding remains valid within the current task."
    assert records[1]["status"] == "resolved"
    assert records[1]["resolution"] == "supported"
    assert not (root / "harness-decisions.jsonl").exists()

    requests = [
        json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    retained_digest = next(
        part["text"] for message in requests[4]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text" and part["text"].startswith("Task-local execution findings: ")
    )
    retained = json.loads(retained_digest.split(": ", 1)[1])
    assert retained == [{
        "goal_id": "research-goal-1", "finding_id": "finding-1", "version": 2,
        "status": "resolved", "resolution": "supported",
        "scope": "Later workspace reads in this task",
        "decision": "Use only catalogued testbed-relative paths for later workspace reads.",
        "evidence_refs": ["fixture-2"], "remaining_uses": 2,
        "retained_for_later_decisions": True,
    }]
    final_digest = next(
        part["text"] for message in requests[-1]["context"]["messages"] for part in message["content"]
        if part.get("type") == "text" and part["text"].startswith("Task-local execution findings: ")
    )
    final_findings = json.loads(final_digest.split(": ", 1)[1])
    assert len(final_findings) == 5
    assert [finding["finding_id"] for finding in final_findings] == [
        "finding-2", "finding-3", "finding-4", "finding-5", "finding-6",
    ]


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


def test_installed_pi_workspace_file_action_writes_text_inside_task_boundary(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "workspace-write"
    (root / "testbed" / "data").mkdir(parents=True)
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "workspace_write"}, timeout=30) as kernel:
        kernel.prompt("Exercise bounded task-local text output actions.")
        events = kernel.wait_for_agent_events(timeout=30)

    assert _extract_agent_outcome(events)[1]
    assert (root / "testbed" / "data" / "class_1" / "Noah.txt").read_text(encoding="utf-8") == "Noah\n"
    assert not (root / "outside.txt").exists()
    observations = [
        event["result"]["details"]["observation"]
        for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "workspace_file_action"
    ]
    assert [observation["operation"] for observation in observations] == [
        "make_directory", "write_text", "read_text", "write_text",
    ]
    assert [observation["category"] for observation in observations[:3]] == [
        "task_action", "task_action", "resource",
    ]
    assert observations[2]["result_summary"] == "Noah"
    assert observations[3]["outcome"] == "semantic_error"
    assert observations[3]["error_kind"] == "task_resource_boundary_violation"


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
    assert capability_catalog["format"] == "task-local-capability-catalog-v2"
    assert capability_catalog["selection"] == "agent-authored from task-local evidence"
    assert "task_action_triggers" not in capability_catalog
    assert "break_even_remaining_uses" not in json.dumps(capability_catalog)
    assert capability_catalog["initial_surface"] == "general"
    assert "calendar_batch_action" not in capability_catalog["active_tools"]
    assert "email_action" in capability_catalog["active_tools"]
    assert capability_catalog["available_inactive"][0]["tool"] == "calendar_batch_action"
    assert capability_catalog["available_inactive"][0]["effective_at"] == "next_model_request"
    assert capability_catalog["available_inactive"][0]["input"] == (
        "events: 2-16 items with user, summary, time_start, and time_end"
    )
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
    assert "workspace_file_action" in tool_sets[0]
    assert "email_batch_action" not in tool_sets[1]
    assert "email_batch_action" in tool_sets[2]
    assert "calendar_action" in tool_sets[2]
    observation = json.loads((root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert observation["operation"] == "excel.read_file"
    assert "decision_support" not in observation
    assert "candidate_mode" not in observation
    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    effect = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    batch = next(
        json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(line).get("tool") == "email_batch_action"
    )
    assert finding["evidence_refs"] == ["fixture-1"]
    assert finding["decision"] == (
        "apply email_batch: complete three email sends through one Pi tool call and one bridge process"
    )
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


def test_installed_pi_never_infers_batch_candidates_from_task_actions(tmp_path):
    try:
        node, cli = _resolve_pi_cli()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_officebench_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    root = tmp_path / "no-inferred-candidates"
    root.mkdir()
    python_path = str(project / "src")
    if os.environ.get("PYTHONPATH"):
        python_path += os.pathsep + os.environ["PYTHONPATH"]
    with PiKernel(command, cwd=str(root), env={"PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root), "PI_OFFICEBENCH_WORKSPACE": str(root),
        "PI_TEST_SCENARIO": "decision_support_once", "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": sys.executable,
        "PYTHONPATH": python_path}, timeout=30) as kernel:
        kernel.prompt("Exercise repeated task actions without runtime-inferred candidates.")
        kernel.wait_for_agent_events(timeout=30)

    observations = [
        json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(observations) == 2
    assert all("decision_support" not in record for record in observations)
    assert all("candidate_mode" not in record for record in observations)


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
