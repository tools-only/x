import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel
from autoresearch_pi.subagent_broker import SubagentBroker


def _pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node unavailable")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        pytest.skip("installed Pi CLI unavailable")
    return node, str(cli)


def _run_fixture(
    root: Path,
    variant: str,
    *,
    initial_findings: list[dict] | None = None,
    steps: list[dict] | None = None,
    extra_extensions: list[Path] | None = None,
    context_max_chars: int | None = None,
    provider_thinking_chars: int | None = None,
    arc_compact: bool = False,
    extra_env: dict[str, str] | None = None,
) -> list[dict]:
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo" / "pi_external_benchmark_research.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    ]
    for extension in extra_extensions or []:
        command.extend(["--extension", str(extension)])
    root.mkdir(exist_ok=True)
    if initial_findings:
        (root / "research-resources.jsonl").write_text(
            "".join(json.dumps(item) + "\n" for item in initial_findings), encoding="utf-8"
        )
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": variant,
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
    }
    if steps is not None:
        env["PI_EXTERNAL_STEPS"] = json.dumps(steps)
    if context_max_chars is not None:
        env["PI_AUTORESEARCH_CONTEXT_MAX_CHARS"] = str(context_max_chars)
    if provider_thinking_chars is not None:
        env["PI_EXTERNAL_THINKING_CHARS"] = str(provider_thinking_chars)
    if arc_compact:
        env["PI_ARC_EXECUTION_GATE"] = "enabled"
    env.update(extra_env or {})
    # The managed Windows runtime rejects nested CreateProcess calls from the
    # Node child.  Use the same loopback broker as the real ARC runner so the
    # fixture exercises the production child-launch path instead of masking
    # the auto-research call behind an environmental EPERM.
    broker = None
    if "PI_AUTORESEARCH_SUBAGENT_BROKER_URL" not in env and env.get("PI_AUTORESEARCH_PROVIDER"):
        broker = SubagentBroker()
        broker.start()
        env["PI_AUTORESEARCH_SUBAGENT_BROKER_URL"] = broker.url
    try:
        with PiKernel(command, cwd=str(root), env={
            **env,
        }, timeout=60) as kernel:
            kernel.prompt("Run the deterministic external benchmark fixture.")
            return kernel.wait_for_agent_events(timeout=60)
    finally:
        if broker is not None:
            broker.close()


def test_shared_external_extension_closes_finding_compaction_effect_loop(tmp_path):
    root = tmp_path / "treatment"
    events = _run_fixture(root, "treatment")

    assert any(event.get("type") == "agent_end" for event in events)
    observations = [json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
    findings = [json.loads(line) for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()]
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    exposure = json.loads((root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    research_exposures = [
        json.loads(line)
        for line in (root / "research-exposures.jsonl").read_text(encoding="utf-8").splitlines()
    ]

    assert observations[0]["observation_id"] == "execution-observation-1"
    assert "x" * 100 in observations[0]["result_text"]
    assert findings[0]["evidence_refs"] == ["execution-observation-1"]
    assert findings[-1]["version"] == 2
    assert findings[-1]["status"] == "resolved"
    assert findings[-1]["assessment_refs"] == ["effect-assessment-1"]
    assert decision["basis_snapshots"][0]["version"] == 1
    assert decision["operation"]["capability"] == "pi.context"
    assert exposure["effect_observed"] is True
    assert assessment["verdict"] == "supported"
    assert assessment["window"]["removed_chars"] > 0
    assert research_exposures
    assert any(
        any(item["finding_id"] == "finding-1" for item in exposure["finding_ids"])
        for exposure in research_exposures
    )

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert "Auto-Research entry for the parent Agent" in contexts[0]["systemPrompt"]
    assert {"benchmark_probe", "task_harness", "task_skill", "task_memory", "research_resource"} <= {tool["name"] for tool in contexts[0]["tools"]}

    active_resources = [
        part["text"]
        for context in contexts[2:6]
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert active_resources
    active = json.loads(active_resources[0].split(": ", 1)[1])
    assert active == [{
        "goal_id": "research-goal-1",
        "finding_id": "finding-1",
        "version": 1,
        "resource_ref": "finding-1@v1",
        "question": "What task-local observation should change a later execution decision?",
        "scope": "current benchmark task",
        "uncertainty": "bounded task-local uncertainty",
        "evidence": "The probe is large and its relevant conclusion is retained.",
        "decision": "Compact the cited observation for later requests.",
        "evidence_refs": ["execution-observation-1"],
        "assessment_refs": [],
        "expected_recurrence": "high",
        "remaining_uses": 2,
    }]

    resolved_resources = [
        part["text"]
        for context in contexts[6:]
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert resolved_resources == []


def test_agent_can_apply_multiple_compaction_decisions_to_new_observations(tmp_path):
    root = tmp_path / "multiple-compactions"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "The first probe's reusable conclusion is retained.",
            "decision": "Compact the first cited observation.",
            "assessment_refs": [], "expected_recurrence": "high", "remaining_uses": 2,
        }},
        {"name": "compact_observation_context", "arguments": {
            "finding_id": "finding-1", "target_version": 1,
            "observation_ids": ["execution-observation-1"],
            "expected_effect": "remove the first historical body from later requests",
            "reconsider_when": "the first observation is needed",
        }},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-2",
            "evidence": "The second probe has a separate reusable conclusion.",
            "decision": "Compact the second cited observation.",
            "assessment_refs": [], "expected_recurrence": "high", "remaining_uses": 2,
        }},
        {"name": "compact_observation_context", "arguments": {
            "finding_id": "finding-2", "target_version": 1,
            "observation_ids": ["execution-observation-2"],
            "expected_effect": "remove the second historical body from later requests",
            "reconsider_when": "the second observation is needed",
        }},
    ])

    assert any(event.get("type") == "agent_end" for event in events)
    decisions = [
        json.loads(line)
        for line in (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(line).get("decision_path") == "compact_observation_context"
    ]
    assert [decision["operation"]["observation_ids"] for decision in decisions] == [
        ["execution-observation-1"], ["execution-observation-2"],
    ]
    assessments = [
        json.loads(line)
        for line in (root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(assessments) == 2
    assert all(item["verdict"] == "supported" for item in assessments)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    later_payloads = json.dumps(contexts[4:])
    assert "execution-observation-1 compacted by finding-1@v1" in later_payloads
    assert "execution-observation-2 compacted by finding-2@v1" in later_payloads


def test_component_tools_disclose_direct_creation_without_a_finding_gate():
    project = Path(__file__).resolve().parents[1]
    descriptions = {
        "task_memory": (project / "demo" / "pi_task_local_self_harness.ts").read_text(encoding="utf-8"),
        "task_skill": (project / "demo" / "pi_task_local_self_harness.ts").read_text(encoding="utf-8"),
        "task_tool": (project / "demo" / "pi_task_local_tools.ts").read_text(encoding="utf-8"),
        "task_subagent": (project / "demo" / "pi_task_local_subagents.ts").read_text(encoding="utf-8"),
    }
    for tool_name, source in descriptions.items():
        assert "directly from a task observation" in source, tool_name
        assert "no finding is required" in source, tool_name


def test_harness_effect_assessment_accepts_native_exposure_reference(tmp_path):
    """Native exposure IDs are valid evidence once the component is projected."""
    root = tmp_path / "native-exposure-assessment"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "probe-fact",
            "content": "The probe returned a stable task-local fact.",
            "basis_refs": ["execution-observation-1"],
        }},
        {"name": "task_harness", "arguments": {
            "action": "assess_effect", "decision_id": "decision-1",
            "observation_refs": ["memory-exposure-decision-1"],
            "verdict": "supported",
            "consequence": "The memory was visible in the next native context.",
        }},
    ])

    assert any(event.get("type") == "agent_end" for event in events)
    assessments = [
        json.loads(line)
        for line in (root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert assessments[-1]["observation_refs"] == ["memory-exposure-decision-1"]
    assert assessments[-1]["verdict"] == "supported"


def test_harness_effect_assessment_error_lists_current_native_refs(tmp_path):
    """A premature/incorrect ref remains rejected with actionable evidence IDs."""
    root = tmp_path / "native-exposure-assessment-error"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "probe-fact",
            "content": "The probe returned a stable task-local fact.",
            "basis_refs": ["execution-observation-1"],
        }},
        {"name": "task_harness", "arguments": {
            "action": "assess_effect", "decision_id": "decision-1",
            "observation_refs": ["made-up-observation"],
            "verdict": "supported",
            "consequence": "This should remain unrecorded.",
        }},
    ])

    assert any(event.get("type") == "agent_end" for event in events)
    failures = [
        json.loads(line)
        for line in (root / "task-operation-failures.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert "Available observation_refs for decision-1" in failures[-1]["error"]


def test_un_evidenced_task_memory_is_marked_as_hypothesis_on_all_reads():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_task_local_self_harness.ts").read_text(encoding="utf-8")
    marker = "UNVERIFIED HYPOTHESIS"
    assert source.count(marker) >= 2
    assert "epistemic_status: \"unverified_hypothesis\"" in source


def test_self_harness_opportunity_is_not_gated_by_repeated_operations(tmp_path):
    root = tmp_path / "first-observation-opportunity"
    root.mkdir()
    (root / "execution-observations.jsonl").write_text(json.dumps({
        "observation_id": "execution-observation-1",
        "tool_name": "benchmark_probe",
        "result_text": "one prior observation",
    }) + "\n", encoding="utf-8")
    _run_fixture(root, "treatment", steps=[{
        "name": "benchmark_probe", "arguments": {"value": "one observation"},
    }])
    opportunities = [
        json.loads(line)
        for line in (root / "task-harness-opportunities.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert opportunities[0]["trigger"] == "missing_component_surface"
    assert opportunities[0]["observation_count"] == 1
    assert opportunities[0]["repeated_operations"] == []


def test_task_harness_status_exposes_all_mutable_components(tmp_path):
    root = tmp_path / "harness-status"
    events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness_status", "arguments": {"request": "current"},
    }])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    available = {tool["name"] for tool in contexts[0]["tools"]}
    assert {"benchmark_probe", "task_harness", "task_skill", "task_memory", "research_resource"} <= available
    later_available = {tool["name"] for tool in contexts[1]["tools"]}
    assert "task_harness_status" in later_available
    assert "task_memory" in later_available
    assert "task_skill" in later_available
    assert "research_resource" in later_available
    status_event = next(
        event for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "task_harness_status"
    )
    assert status_event.get("isError") is not True
    status = json.loads(status_event["result"]["content"][0]["text"])
    modules = {item["name"]: item for item in status["modules"]}
    assert modules["task_skill"]["supported"] is True
    assert modules["task_skill"]["active"] is True
    assert modules["task_skill"]["registered"] is True
    assert modules["task_memory"]["active"] is True
    assert modules["research"]["active"] is True
    assert modules["task_tool"]["supported"] is False
    assert modules["task_subagent"]["supported"] is False
    assert modules["delegate_task"]["supported"] is False


def test_task_harness_start_is_idempotent_and_checkpoint_is_projected(tmp_path):
    root = tmp_path / "checkpoint-and-idempotent-start"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "start"}},
        {"name": "task_harness", "arguments": {"action": "start"}},
        {"name": "task_checkpoint", "arguments": {
            "action": "update", "current_subgoal": "Identify the next useful experiment.",
            "hypothesis": "The changed region identifies the controllable object.",
            "next_step": "Run one discriminating action.", "decision_refs": ["execution-observation-1"],
        }},
        {"name": "benchmark_probe", "arguments": {"state": "RUNNING", "progress": 1}},
    ])

    entries = [json.loads(line) for line in (root / "task-harness-entry-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(entries) == 1
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    assert checkpoint["harness_started"] is True
    assert checkpoint["current_subgoal"] == "Identify the next useful experiment."
    assert checkpoint["hypothesis"] == "The changed region identifies the controllable object."
    assert checkpoint["next_step"] == "Run one discriminating action."
    assert checkpoint["latest_observation"]["tool_name"] == "benchmark_probe"

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    checkpoint_text = json.dumps(contexts[-1], ensure_ascii=False)
    assert "task-local-checkpoint-v1" in checkpoint_text
    assert "Identify the next useful experiment." in checkpoint_text
    assert "The changed region identifies the controllable object." in checkpoint_text
    start_results = [
        event for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "task_harness"
    ]
    assert len(start_results) == 2
    assert "already_started" in start_results[-1]["result"]["content"][0]["text"]


def test_arc_adapter_starts_empty_with_direct_component_operations(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-harness-status"
    root.mkdir()
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_EXTERNAL_STEPS": json.dumps([
            {"name": "task_harness_status", "arguments": {"request": "current"}},
        ]),
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Inspect the ARC task-local capability surface.")
        events = kernel.wait_for_agent_events(timeout=60)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    available = {tool["name"] for tool in contexts[0]["tools"]}
    assert {"arc_state", "arc_action", "inspect_arc_trajectory", "research_resource", "task_harness", "task_skill", "task_memory", "task_subagent", "delegate_task", "task_tool", "read"} <= available
    assert "benchmark_probe" not in available
    assert "harness_bootstrap" not in available
    later_available = {
        tool["name"]
        for tool in contexts[1]["tools"]
    }
    assert "task_harness_status" in later_available
    assert "task_skill" in available
    assert any(
        event.get("type") == "tool_execution_end"
        and event.get("toolName") == "task_harness_status"
        and event.get("isError") is not True
        for event in events
    )


def test_task_skills_are_projected_with_instructions_without_a_read_call(tmp_path):
    root = tmp_path / "skill-direct"
    _run_fixture(root, "treatment", steps=[{
        "name": "task_skill", "arguments": {
            "action": "create", "name": "direct-method",
            "description": "A directly exposed method.",
            "instructions": "Use the settled observation before choosing the next action.",
        },
    }])
    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    skill_text = next(
        part["text"]
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text" and part["text"].startswith("Active task-local skills")
    )
    assert "Use the settled observation before choosing the next action." in skill_text
    assert "read the exact path before use" not in skill_text


def test_task_local_context_projection_does_not_drop_components_after_five(tmp_path):
    root = tmp_path / "unbounded-context"
    _run_fixture(root, "treatment", steps=[{
        "name": "task_memory", "arguments": {
            "action": "upsert", "key": f"memory-{index}", "content": f"content-{index}",
        },
    } for index in range(1, 7)])
    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    memory_text = [
        part["text"]
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text" and part["text"].startswith("Active task-local memory:")
    ][-1]
    projected = json.loads(memory_text.split(": ", 1)[1])
    assert len(projected) == 6


def test_generic_task_local_context_lifecycle_bounds_history_and_deduplicates_projections(tmp_path):
    root = tmp_path / "bounded-context"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}}
        for _ in range(30)
    ], context_max_chars=18000)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    sizes = [len(json.dumps(context["messages"], ensure_ascii=False)) for context in contexts]
    assert max(sizes) <= 18000

    compactions = [
        json.loads(line)
        for line in (root / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(item["archived_messages"] > 0 for item in compactions)
    latest = contexts[-1]["messages"]
    projection_texts = [
        part["text"]
        for message in latest
        for part in message.get("content", [])
        if part.get("type") == "text"
    ]
    for prefix in (
        "Task-local self-harness is ", "Active task-local memory:",
        "Active task-local memory:", "Active task-local Pi tools",
    ):
        assert sum(text.startswith(prefix) for text in projection_texts) <= 1


def test_generic_context_lifecycle_retains_latest_complete_tool_transaction(tmp_path):
    root = tmp_path / "transaction-safe-context"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}}
        for _ in range(30)
    ], context_max_chars=18_000)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    latest = contexts[-1]["messages"]
    latest_call = next(
        message
        for message in reversed(latest)
        if message.get("role") == "assistant"
        and any(part.get("id") == "fixture-30" for part in message.get("content", []))
    )
    assert latest_call
    assert any(
        message.get("role") == "toolResult" and message.get("toolCallId") == "fixture-30"
        for message in latest
    )

    compactions = [
        json.loads(line)
        for line in (root / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert compactions[-1]["latest_tool_transaction_preserved"] is True
    assert compactions[-1]["retained_tool_transactions"] >= 1


def test_generic_context_lifecycle_degrades_latest_transaction_without_dropping_it(tmp_path):
    root = tmp_path / "tiny-transaction-safe-context"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}}
        for _ in range(3)
    ], context_max_chars=5_000)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    latest = contexts[-1]["messages"]
    assert len(json.dumps(latest, ensure_ascii=False)) <= 5_000
    assert any(
        message.get("role") == "assistant"
        and any(part.get("id") == "fixture-3" for part in message.get("content", []))
        for message in latest
    )
    assert any(
        message.get("role") == "toolResult" and message.get("toolCallId") == "fixture-3"
        for message in latest
    )

    compactions = [
        json.loads(line)
        for line in (root / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert compactions[-1]["budget_degraded"] is True
    assert compactions[-1]["latest_tool_result_preserved"] is True


def test_generic_context_lifecycle_bounds_large_reasoning_without_breaking_tool_links(tmp_path):
    root = tmp_path / "reasoning-transaction-safe-context"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}}
        for _ in range(3)
    ], context_max_chars=5_000, provider_thinking_chars=12_000)

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    latest = contexts[-1]["messages"]
    assert len(json.dumps(latest, ensure_ascii=False)) <= 5_000
    assert any(
        message.get("role") == "assistant"
        and any(part.get("id") == "fixture-3" for part in message.get("content", []))
        for message in latest
    )
    assert any(
        message.get("role") == "toolResult" and message.get("toolCallId") == "fixture-3"
        for message in latest
    )


def test_research_record_can_capture_a_hypothesis_before_tool_observation(tmp_path):
    root = tmp_path / "hypothesis-research"
    _run_fixture(root, "treatment", steps=[{
        "name": "research_resource", "arguments": {
            "action": "record",
            "evidence": "The agent predicts that the alternate route will reduce repeated probes.",
            "decision": "Test the alternate route next.",
            "question": "Which route should be tested next?",
            "evidence_to_seek": "A later task result that distinguishes the routes.",
        },
    }])
    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert finding["status"] == "active"
    assert finding["evidence_refs"] == []


def test_production_runners_start_without_native_pi_skills():
    project = Path(__file__).resolve().parents[1]
    sources = [
        project / "src" / "autoresearch_pi" / "arc_agi_3_e2e.py",
        project / "src" / "autoresearch_pi" / "shopping_e2e.py",
        project / "src" / "autoresearch_pi" / "officebench_e2e.py",
        project / "src" / "autoresearch_pi" / "terminal_bench_agent.py",
    ]
    for source_path in sources:
        assert "--no-skills" in source_path.read_text(encoding="utf-8"), source_path


def test_arc_main_agent_does_not_load_native_pi_skills(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-native-skill-audit"
    native_skill = root / ".pi-agent" / "skills" / "native-probe" / "SKILL.md"
    native_skill.parent.mkdir(parents=True)
    native_skill.write_text(
        "---\nname: native-probe\ndescription: A native skill available to the main ARC agent.\n---\n\n"
        "Use the public ARC evidence surface.\n",
        encoding="utf-8",
    )
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_EXTERNAL_STEPS": "[]",
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Inspect the ARC capability surface and stop.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    assert not (root / "native-skill-discovery.jsonl").exists()
    telemetry = [
        json.loads(line)
        for line in (root / "provider-telemetry.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assistant_messages = [item for item in telemetry if item["event"] == "assistant_message"]
    assert assistant_messages
    assert all(item["scope"] == "treatment" for item in assistant_messages)
    assert all("native-probe" not in json.dumps(item) for item in telemetry)
    contexts = [json.loads(line)["context"] for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all("native-probe" not in json.dumps(context) for context in contexts)


def test_task_tool_adapter_can_opt_into_agent_named_backend_refs():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_task_local_tools.ts").read_text(encoding="utf-8")
    assert "allowUnlistedImplementations" in source
    assert "adapter-owned" in source


def test_dynamic_task_tool_input_schema_is_gateway_compatible():
    source = (Path(__file__).resolve().parents[1] / "demo" / "pi_task_local_tools.ts").read_text(encoding="utf-8")
    assert "input: Type.Record" in source
    assert "input: Type.Optional(Type.Record" not in source


def test_shared_external_extension_control_hides_research_and_mutation_tools(tmp_path):
    root = tmp_path / "control"
    _run_fixture(root, "control")

    context = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert names == {"benchmark_probe"}
    assert not (root / "research-resources.jsonl").exists()
    assert not (root / "harness-decisions.jsonl").exists()


def test_active_finding_projection_includes_all_active_resources(tmp_path):
    root = tmp_path / "bounded"
    findings = [
        {
            "goal_id": f"research-goal-{index}", "finding_id": f"finding-{index}", "version": 1,
            "research_event_id": f"research-event-{index}", "evidence_refs": ["execution-observation-1"],
            "assessment_refs": [], "status": "active", "question": "q" * 500,
            "scope": "scope", "uncertainty": "uncertainty", "evidence": "evidence",
            "decision": "decision", "expected_recurrence": "high", "remaining_uses": 1,
            "recordedAt": f"2026-09-11T00:00:0{index}Z",
        }
        for index in range(1, 5)
    ]
    _run_fixture(
        root, "treatment", initial_findings=findings,
        steps=[{"name": "research_resource", "arguments": {
            "action": "inspect", "evidence_refs": [], "assessment_refs": [],
        }}],
    )
    contexts = [json.loads(line)["context"] for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    resources = [
        part["text"]
        for message in contexts[0]["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text" and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert len(resources) == 1
    projected = json.loads(resources[0].split(": ", 1)[1])
    assert [item["finding_id"] for item in projected] == ["finding-1", "finding-2", "finding-3", "finding-4"]
    assert len(projected[-1]["question"]) == 500


def test_pinned_research_is_projected_and_inspection_can_filter_without_new_state(tmp_path):
    root = tmp_path / "research-attention"
    findings = [
        {
            "goal_id": f"research-goal-{index}", "finding_id": f"finding-{index}", "version": 1,
            "research_event_id": f"research-event-{index}", "evidence_refs": ["execution-observation-1"],
            "assessment_refs": [], "status": "active", "question": f"question {index}",
            "scope": "critical navigation" if index == 1 else "routine probe",
            "uncertainty": "uncertainty", "evidence": "evidence", "decision": "decision",
            "expected_recurrence": "high", "remaining_uses": 1, "pinned": index == 1,
            "recordedAt": f"2026-09-11T00:00:0{index}Z",
        }
        for index in range(1, 6)
    ]
    events = _run_fixture(
        root, "treatment", initial_findings=findings,
        steps=[{"name": "research_resource", "arguments": {
            "action": "inspect", "query": "critical", "status": "active", "limit": 1,
        }}],
    )

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    projected_text = next(
        part["text"]
        for message in contexts[0]["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    )
    projected = json.loads(projected_text.split(": ", 1)[1])
    assert [item["finding_id"] for item in projected] == ["finding-1", "finding-2", "finding-3", "finding-4", "finding-5"]
    assert projected[0]["pinned"] is True

    inspection = next(
        event["result"]["details"]
        for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource"
    )
    assert [item["finding_id"] for item in inspection["findings"]] == ["finding-1"]
    assert inspection["page"] == {"offset": 0, "limit": 1, "total": 1, "next_offset": None}
    assert len((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()) == 5


def test_finding_update_links_real_execution_use_and_reconsider_condition(tmp_path):
    root = tmp_path / "research-use"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "The first probe established a reusable local signal.",
            "decision": "Use that signal to choose the next probe.",
            "reconsider_when": "a later probe contradicts the signal", "pinned": True,
            "remaining_uses": 3,
        }},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 1,
            "used_in_observation_refs": ["execution-observation-2"],
            "use_note": "The second probe was selected using finding-1@v1.",
            "remaining_uses": 2,
        }},
    ])

    resources = [
        json.loads(line)
        for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert resources[-1]["version"] == 2
    assert resources[-1]["evidence_refs"] == ["execution-observation-1"]
    assert resources[-1]["used_in_observation_refs"] == ["execution-observation-2"]
    assert resources[-1]["use_note"] == "The second probe was selected using finding-1@v1."
    assert resources[-1]["reconsider_when"] == "a later probe contradicts the signal"
    assert resources[-1]["pinned"] is True


def test_finding_update_accumulates_the_new_observation_id(tmp_path):
    root = tmp_path / "research-revision-evidence"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "The first probe supports the initial interpretation.",
            "decision": "Test the competing interpretation.",
        }},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 1,
            "observation_id": "execution-observation-2",
            "evidence": "The second probe revises the initial interpretation.",
            "decision": "Use the revised interpretation.",
        }},
    ])

    resources = [
        json.loads(line)
        for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert resources[-1]["version"] == 2
    assert resources[-1]["evidence_refs"] == [
        "execution-observation-1", "execution-observation-2",
    ]


def test_finding_can_reference_task_component_versions(tmp_path):
    root = tmp_path / "component-refs"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "component_refs": ["memory:route@v1", "skill:probe@v2"],
            "evidence": "The retained route memory and probe skill explain this observation.",
            "decision": "Use the referenced components for the next probe.",
        }},
    ])

    resources = [
        json.loads(line)
        for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert resources[-1]["component_refs"] == ["memory:route@v1", "skill:probe@v2"]
    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    projected = [
        json.loads(part["text"].split(": ", 1)[1])
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Active task-local research findings for later decisions:")
    ]
    assert projected[-1][0]["component_refs"] == ["memory:route@v1", "skill:probe@v2"]


def test_task_tool_is_adapter_bounded_versioned_and_audited(tmp_path):
    root = tmp_path / "task-tool"
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "echo", "description": "Echo a task-local message.",
            "input_schema": {"type": "object", "properties": {"message": {"type": "string"}}},
            "implementation_ref": "fixture.echo",
        }},
        {"name": "task_tool_echo_v1", "arguments": {"input": {"message": "one"}}},
        {"name": "task_tool", "arguments": {
            "action": "update", "name": "echo", "target_version": 1,
            "description": "Echo a task-local message, version two.",
            "implementation_ref": "fixture.echo",
        }},
        {"name": "task_tool_echo_v2", "arguments": {"input": {"message": "two"}}},
        {"name": "task_tool", "arguments": {
            "action": "retire", "name": "echo", "target_version": 2,
        }},
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "bad", "description": "Unsupported.",
            "input_schema": {"type": "object"}, "implementation_ref": "fixture.shell",
        }},
    ], extra_extensions=[project / "tests" / "pi_task_tool_fixture.ts"])

    records = [
        json.loads(line)
        for line in (root / "task-tools.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [(item["name"], item["version"], item["status"]) for item in records] == [
        ("echo", 1, "active"), ("echo", 2, "active"), ("echo", 3, "retired"),
    ]
    lifecycle = [
        json.loads(line)
        for line in (root / "task-tool-events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [item["event"] for item in lifecycle] == [
        "registered", "invoked", "registered", "invoked", "retired",
    ]
    assert [item["exposed_name"] for item in lifecycle[:4]] == [
        "task_tool_echo_v1", "task_tool_echo_v1", "task_tool_echo_v2", "task_tool_echo_v2",
    ]
    contexts = [json.loads(line)["context"] for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(
        part.get("type") == "text" and "Active task-local Pi tools (adapter-bounded)" in part.get("text", "")
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
    )
    assert any(
        event.get("type") == "tool_execution_end"
        and event.get("toolName") == "task_tool"
        and event.get("isError")
        for event in events
    )


def test_agent_defined_task_program_creates_and_uses_new_behavior(tmp_path):
    root = tmp_path / "task-program"
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "state-signal",
            "description": "Extract the state and progress fields from an observation.",
            "input_schema": {"type": "object", "properties": {
                "state": {"type": "string"}, "progressed": {"type": "boolean"},
            }},
            "program": {"steps": [{"kind": "select", "source": "input",
                                     "fields": ["state", "progressed"]}]},
        }},
        {"name": "task_tool_state-signal_v1", "arguments": {
            "input": {"state": "RUNNING", "progressed": True},
        }},
    ], extra_extensions=[project / "tests" / "pi_task_tool_fixture.ts"])

    records = [
        json.loads(line)
        for line in (root / "task-tools.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert records[0]["implementation_ref"] == "task.local.program"
    assert records[0]["program"] == {"steps": [{"kind": "select", "source": "input",
                                                  "fields": ["state", "progressed"]}]}
    lifecycle = [
        json.loads(line)
        for line in (root / "task-tool-events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [item["event"] for item in lifecycle] == ["registered", "invoked"]
    assert lifecycle[-1]["status"] == "completed"
    assert json.loads(lifecycle[-1]["output_excerpt"]) == {
        "state": "RUNNING", "progressed": True,
    }
    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert "task_tool_state-signal_v1" in {tool["name"] for tool in contexts[1]["tools"]}
    assert any(
        "state-signal" in json.dumps(message)
        and "agent_defined_task_program" in json.dumps(message)
        for context in contexts[1:]
        for message in context["messages"]
    )


def test_agent_defined_analysis_program_emits_provenance_bound_observation(tmp_path):
    root = tmp_path / "task-analysis-program"
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "state-diff", "description": "Compare two authorized state summaries.",
            "program": {"steps": [
                {"kind": "diff"}, {"kind": "emit_observation"},
            ]},
        }},
        {"name": "task_tool_state-diff_v1", "arguments": {"input": {
            "evidence_ref": "observation:execution-observation-1@v1", "source_version": 1,
            "before": {"state": "RUNNING", "levels": 0},
            "after": {"state": "RUNNING", "levels": 1},
        }}},
    ], extra_extensions=[project / "tests" / "pi_task_tool_fixture.ts"])
    result = next(event["result"]["content"][0]["text"] for event in events
                  if event.get("type") == "tool_execution_end" and event.get("toolName") == "task_tool_state-diff_v1")
    value = json.loads(result)
    assert value["format"] == "task-analysis-observation-v1"
    assert value["observation"]["changed"] == [{"field": "levels", "before": 0, "after": 1}]
    assert value["provenance"]["source_ref"] == "observation:execution-observation-1@v1"
    assert value["provenance"]["transformations"] == ["diff"]
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]


def test_execution_signal_index_classifies_reported_errors_without_claiming_root_cause(tmp_path):
    root = tmp_path / "execution-signals"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {
            "fail": "Permission denied while waiting for a timed out transport"
        }},
        {"name": "research_resource", "arguments": {
            "action": "inspect", "observation_id": "execution-observation-1",
        }},
    ])

    signals = [
        json.loads(line)
        for line in (root / "execution-signals.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert signals == [{
        "signal_id": "execution-signal-1",
        "observation_id": "execution-observation-1",
        "layer": "tool_execution",
        "outcome": "error",
        "labels": ["reported_permission_error", "reported_timeout"],
        "classification_method": "text_heuristic",
        "causal_interpretation": False,
        "recordedAt": signals[0]["recordedAt"],
    }]
    inspection = next(
        event["result"]["details"]
        for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "research_resource"
    )
    assert inspection["signals"] == signals
    assert inspection["signal_summary"] == {
        "tool_execution": {"error": 1, "success": 0},
        "labels": {"reported_permission_error": 1, "reported_timeout": 1},
    }


def test_execution_signal_index_keeps_tool_state_and_progress_layers_distinct(tmp_path):
    root = tmp_path / "layered-signals"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {
            "state_changed": False, "progressed": True,
        }},
    ])

    signals = [
        json.loads(line)
        for line in (root / "execution-signals.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [(item["layer"], item["outcome"], item["labels"]) for item in signals] == [
        ("tool_execution", "success", ["tool_call_succeeded"]),
        ("environment_state", "unchanged", ["visible_state_unchanged"]),
        ("task_progress", "advanced", ["public_progress_advanced"]),
    ]
    assert all(item["causal_interpretation"] is False for item in signals)


def test_structured_outcome_contrast_becomes_a_local_pattern_candidate(tmp_path):
    root = tmp_path / "structured-pattern"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {"state_changed": False}},
        {"name": "benchmark_probe", "arguments": {"state_changed": True}},
    ])

    candidates = [
        json.loads(line)
        for line in (root / "pattern-candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(candidates) == 1
    assert candidates[0]["kind"] == "structured_outcome_contrast"
    assert candidates[0]["candidate_key"] == (
        "environment_state:benchmark_probe:fixture:outcome_contrast"
    )
    assert candidates[0]["support_refs"] == [
        "execution-observation-1", "execution-observation-2"
    ]
    assert candidates[0]["observed_outcomes"] == ["changed", "unchanged"]


def test_repeated_structured_progress_outcome_becomes_a_candidate_without_arc_rules(tmp_path):
    root = tmp_path / "repeated-progress"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {"state_changed": True, "progressed": False}},
        {"name": "benchmark_probe", "arguments": {"state_changed": True, "progressed": False}},
    ])

    candidates = [
        json.loads(line)
        for line in (root / "pattern-candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(candidates) == 1
    assert candidates[0]["kind"] == "repeated_structured_outcome"
    assert candidates[0]["candidate_key"] == (
        "task_progress:benchmark_probe:fixture:not_advanced:repeated"
    )
    assert candidates[0]["support_count"] == 2
    assert candidates[0]["observed_outcomes"] == ["not_advanced"]


def test_repeated_finding_revision_becomes_a_method_candidate_not_a_harness_change(tmp_path):
    root = tmp_path / "research-revision-pattern"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "Initial interpretation.", "decision": "Test it.",
        }},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 1,
            "evidence": "The interpretation needs qualification.", "decision": "Use a control.",
        }},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 2,
            "evidence": "The control changed the interpretation again.",
            "decision": "Check the evidence-reading method.",
        }},
    ])

    candidates = [
        json.loads(line)
        for line in (root / "pattern-candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(candidates) == 1
    assert candidates[0]["kind"] == "research_revision_churn"
    assert candidates[0]["candidate_key"] == "research-resource:finding-1:revision-churn"
    assert candidates[0]["related_finding_id"] == "finding-1"
    assert candidates[0]["revision_count"] == 3
    assert candidates[0]["support_refs"] == ["execution-observation-1"]
    assert not (root / "harness-decisions.jsonl").exists()


def test_repeated_no_progress_input_cycle_becomes_a_generic_pattern_candidate(tmp_path):
    root = tmp_path / "repeated-input-cycle"
    cycle = [
        {"name": "benchmark_probe", "arguments": {"state_changed": True, "progressed": False}},
        {"name": "benchmark_probe", "arguments": {"state_changed": False, "progressed": False}},
    ]
    _run_fixture(root, "treatment", steps=cycle * 3)

    candidates = [
        json.loads(line)
        for line in (root / "pattern-candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    action_cycle = next(item for item in candidates if item["kind"] == "repeated_action_cycle")
    assert action_cycle["tool_name"] == "benchmark_probe"
    assert action_cycle["sequence_length"] == 2
    assert action_cycle["support_count"] == 3
    assert action_cycle["support_refs"] == [
        "execution-observation-1", "execution-observation-2", "execution-observation-3",
        "execution-observation-4", "execution-observation-5", "execution-observation-6",
    ]
    assert action_cycle["observed_outcomes"] == ["not_advanced"]


def test_mature_pattern_candidate_does_not_expose_an_automatic_self_harness_checkpoint(tmp_path):
    root = tmp_path / "self-harness-checkpoint"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {"state_changed": True, "progressed": False}},
        {"name": "benchmark_probe", "arguments": {"state_changed": True, "progressed": False}},
    ])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    checkpoint_text = [
        part["text"]
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text" and part["text"].startswith("Self-harness checkpoint:")
    ]
    assert checkpoint_text == []
    assert not (root / "self-harness-checkpoints.jsonl").exists()


def test_pattern_candidates_are_derived_but_require_agent_acceptance_as_a_finding(tmp_path):
    root = tmp_path / "pattern-candidates"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {"fail": "Permission denied"}},
        {"name": "benchmark_probe", "arguments": {"fail": "Permission denied"}},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-3",
            "pattern_candidate_refs": ["pattern-candidate-1"],
            "evidence": "The same tool later succeeded, so permission failures are conditional.",
            "decision": "Compare the differing inputs or environment conditions before retrying.",
            "reconsider_when": "the condition separating outcomes is identified",
        }},
        {"name": "research_resource", "arguments": {
            "action": "inspect", "include_pattern_candidates": True,
        }},
    ])

    candidates = [
        json.loads(line)
        for line in (root / "pattern-candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    latest = {item["candidate_id"]: item for item in candidates}
    assert latest["pattern-candidate-1"] | {
        "recordedAt": latest["pattern-candidate-1"]["recordedAt"]
    } == {
        "candidate_id": "pattern-candidate-1",
        "candidate_key": "benchmark_probe:reported_permission_error",
        "version": 2,
        "kind": "repeated_error",
        "status": "candidate",
        "tool_name": "benchmark_probe",
        "signal_label": "reported_permission_error",
        "claim": "The same reported error recurred; its cause and transfer conditions remain unknown.",
        "support_refs": ["execution-observation-1", "execution-observation-2"],
        "counterexample_refs": ["execution-observation-3"],
        "support_count": 2,
        "counterexample_count": 1,
        "classification_basis": "derived_from_execution_signals",
        "agent_accepted": False,
        "recordedAt": latest["pattern-candidate-1"]["recordedAt"],
    }
    assert latest["pattern-candidate-2"]["kind"] == "outcome_contrast"
    assert latest["pattern-candidate-2"]["support_refs"] == [
        "execution-observation-1", "execution-observation-2", "execution-observation-3"
    ]

    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert finding["pattern_candidate_refs"] == ["pattern-candidate-1"]
    inspection = [
        event["result"]["details"]
        for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "research_resource"
    ][-1]
    assert {item["candidate_id"] for item in inspection["pattern_candidates"]} == {
        "pattern-candidate-1", "pattern-candidate-2"
    }

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(
        part.get("type") == "text"
        and part["text"].startswith("Automatically derived task-local pattern candidates:")
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
    )


def test_multilevel_research_graph_is_derived_and_marks_changed_dependencies(tmp_path):
    root = tmp_path / "research-graph"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "question": "Which exploration family is useful?",
            "evidence": "The first probe provides the initial family-level evidence.",
            "decision": "Test a narrower child question.",
        }},
        {"name": "research_resource", "arguments": {
            "action": "open", "parent_goal_id": "research-goal-1",
            "question": "Which local probe distinguishes the child hypotheses?",
            "evidence_to_seek": "A probe with different predictions under the child hypotheses.",
        }},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-2", "target_version": 1,
            "observation_id": "execution-observation-2",
            "depends_on": ["finding-1@v1"],
            "evidence": "The child probe produced a distinguishable signal.",
            "decision": "Use the child result provisionally.",
        }},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 1,
            "evidence": "The family-level interpretation was narrowed.",
            "decision": "Recheck conclusions that depended on version 1.",
        }},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 2,
            "depends_on": ["finding-2@v2"],
        }},
        {"name": "research_resource", "arguments": {
            "action": "inspect", "include_graph": True, "focus_finding_id": "finding-2",
        }},
    ])

    tool_events = [
        event for event in events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource"
    ]
    cycle_error = tool_events[-2]
    assert cycle_error["isError"] is True
    assert "dependency cycle" in cycle_error["result"]["content"][0]["text"]

    graph = tool_events[-1]["result"]["details"]["research_graph"]
    assert graph["format"] == "task-local-research-graph-v1"
    assert {node["finding_id"] for node in graph["nodes"]} == {"finding-1", "finding-2"}
    parent_edge = next(edge for edge in graph["edges"] if edge["type"] == "parent_goal")
    assert parent_edge == {
        "type": "parent_goal", "from_goal_id": "research-goal-2",
        "to_goal_id": "research-goal-1",
    }
    dependency_edge = next(edge for edge in graph["edges"] if edge["type"] == "depends_on")
    assert dependency_edge == {
        "type": "depends_on", "from_finding_id": "finding-2",
        "to_finding_id": "finding-1", "target_version": 1,
        "current_version": 2, "stale": True,
    }
    assert graph["changed_dependencies"] == [{
        "dependent_finding_id": "finding-2",
        "dependency_ref": "finding-1@v1",
        "current_version": 2,
    }]

    latest_resources = {}
    for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        latest_resources[item["finding_id"]] = item
    assert latest_resources["finding-2"]["status"] == "active"
    assert latest_resources["finding-2"]["parent_goal_id"] == "research-goal-1"
    assert latest_resources["finding-2"]["depends_on"] == ["finding-1@v1"]


def test_open_research_memory_and_system_prompt_reach_later_pi_context(tmp_path):
    root = tmp_path / "working-state"
    _run_fixture(root, "treatment", steps=[
        {"name": "research_resource", "arguments": {
            "action": "open", "question": "Which probe separates the two live hypotheses?",
            "evidence_to_seek": "A probe whose outcome differs under the hypotheses",
            "scope": "current fixture", "uncertainty": "probe selection", "remaining_uses": 3,
        }},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "live-hypotheses",
            "content": "H1 and H2 remain viable until one discriminating probe is observed.",
            "scope": "current fixture", "basis_refs": ["finding-1"], "pinned": True,
        }},
		{"name": "task_system_prompt", "arguments": {
			"action": "create", "name": "probe-selection", "content": "Prefer a discriminating probe over repeating an ambiguous one.",
            "scope": "next fixture probe", "basis_refs": ["finding-1"],
            "expected_effect": "select a more informative probe",
            "reconsider_when": "the hypotheses no longer predict different outcomes",
        }},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "update", "finding_id": "finding-1", "target_version": 1,
            "observation_id": "execution-observation-1",
            "evidence": "The discriminating probe returned the canonical fixture signal.",
            "decision": "Use the observed signal in later execution.", "remaining_uses": 2,
        }},
    ])

    resources = [
        json.loads(line)
        for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert resources[0]["kind"] == "research_goal"
    assert resources[0]["status"] == "open"
    assert resources[0]["evidence_refs"] == []
    assert resources[1]["kind"] == "finding"
    assert resources[1]["status"] == "active"
    assert resources[1]["evidence_refs"] == ["execution-observation-1"]

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    texts = [
        part["text"]
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
    ]
    assert any(text.startswith("Open task-local research questions:") for text in texts)
    assert any(text.startswith("Active task-local memory:") for text in texts)
    assert any("Prefer a discriminating probe over repeating an ambiguous one." in text for text in texts)
    assert any('"resource_ref":"finding-1@v2"' in text for text in texts)
    decisions = [
        json.loads(line)
        for line in (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    prompt_decision = next(
		item for item in decisions if item["intervention"] == "task_system_prompt_context"
	)
    assert prompt_decision["basis_resource_ids"] == ["finding-1@v1"]
    observations = [
        json.loads(line)
        for line in (root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(item["observation_kind"] == "pi_context_projection" for item in observations)


def test_research_linked_memory_records_decision_and_native_context_exposure(tmp_path):
    root = tmp_path / "research-linked-memory"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record",
            "observation_id": "execution-observation-1",
            "evidence": "The probe exposes a stable task-local distinction.",
            "decision": "Retain the distinction for later execution.",
            "expected_recurrence": "high",
            "remaining_uses": 3,
        }},
        {"name": "task_memory", "arguments": {
            "action": "upsert",
            "key": "stable-distinction",
            "content": "Use the observed distinction when selecting the next probe.",
            "scope": "current fixture",
            "basis_refs": ["finding-1@v1"],
            "expected_effect": "make the research result visible during later execution",
            "reconsider_when": "new evidence contradicts the distinction",
            "pinned": True,
        }},
    ])

    memory = json.loads(
        (root / "task-memory.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert memory["decision_id"] == "decision-1"
    assert memory["expected_effect"] == \
        "make the research result visible during later execution"

    decision = json.loads(
        (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert decision["intervention"] == "task_memory_context"
    assert decision["basis_resource_ids"] == ["finding-1@v1"]
    assert decision["operation"] == {
        "capability": "pi.context", "component": "task_memory", "version": 1,
    }

    observations = [
        json.loads(line)
        for line in (root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    memory_exposures = [
        item for item in observations
        if item["observation_kind"] == "pi_task_memory_context"
    ]
    assert len(memory_exposures) == 1
    assert memory_exposures[0]["decision_id"] == "decision-1"
    assert memory_exposures[0]["basis_resource_ids"] == ["finding-1@v1"]

    from autoresearch_pi.research_evidence import project_research_evidence

    findings = [
        json.loads(line)
        for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    projection = project_research_evidence(
        findings=findings,
        execution_signals=[],
        pattern_candidates=[],
        harness_decisions=[decision],
        harness_observations=observations,
        effect_assessments=[],
    )
    assert projection["application_graph"]["paths"] == [{
        "decision_id": "decision-1",
        "intervention": "task_memory_context",
        "research_basis_refs": ["finding-1@v1"],
        "native_observation_refs": ["memory-exposure-decision-1"],
        "effect_assessment_refs": [],
        "stage": "native_exposed",
    }]


def test_raw_finding_basis_is_snapshotted_at_the_current_version(tmp_path):
    root = tmp_path / "research-basis-snapshot"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "The probe establishes a task-local distinction.",
            "decision": "Retain the distinction for later execution.",
        }},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "stable-distinction",
            "content": "Use the observed distinction on the next probe.",
            "basis_refs": ["finding-1"],
        }},
    ])

    decision = json.loads(
        (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    memory = json.loads(
        (root / "task-memory.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert decision["basis_resource_ids"] == ["finding-1@v1"]
    assert memory["basis_refs"] == ["finding-1@v1"]


def test_unassessed_native_intervention_is_visible_in_later_pi_context(tmp_path):
    root = tmp_path / "pending-harness-effect"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "research_resource", "arguments": {
            "action": "record",
            "observation_id": "execution-observation-1",
            "evidence": "A stable distinction should remain visible.",
            "decision": "Keep it in task-local memory.",
            "expected_recurrence": "high",
            "remaining_uses": 2,
        }},
        {"name": "task_memory", "arguments": {
            "action": "upsert",
            "key": "stable-distinction",
            "content": "Use the distinction on later probes.",
            "basis_refs": ["finding-1@v1"],
            "expected_effect": "improve later probe selection",
            "reconsider_when": "later probes do not become more informative",
        }},
        {"name": "benchmark_probe", "arguments": {}},
    ])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    pending_messages = [
        part["text"]
        for message in contexts[-1]["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Unassessed task-local harness effects:")
    ]
    assert len(pending_messages) == 1
    pending = json.loads(pending_messages[0].split(": ", 1)[1])
    assert pending == [{
        "decision_id": "decision-1",
        "decision_path": "task_memory",
        "intervention": "task_memory_context",
        "basis_refs": ["finding-1@v1"],
        "research_link_status": "linked",
        "operation": {
            "capability": "pi.context", "component": "task_memory", "version": 1,
        },
        "expected_effect": "improve later probe selection",
        "reconsider_when": "later probes do not become more informative",
        "native_exposure_count": 1,
        "unassessed_native_exposure_count": 1,
        "latest_native_observation_refs": ["memory-exposure-decision-1"],
    }]
    context_exposures = [
        json.loads(line)
        for line in (root / "task-harness-context-exposures.jsonl")
        .read_text(encoding="utf-8").splitlines()
    ]
    assert context_exposures[-1]["pending_effect_decisions"] == [{
        "decision_id": "decision-1", "native_exposure_count": 1,
    }]


def test_new_native_exposure_reopens_effect_check_after_prior_assessment(tmp_path):
    root = tmp_path / "reopened-harness-effect"
    skill_file = root / "task-harness" / "skills" / "probe-method" / "SKILL.md"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "probe-method",
            "description": "A concise probe method.",
            "instructions": "Select a discriminating observation.",
            "expected_effect": "improve probe selection",
            "reconsider_when": "the method adds no decision-relevant evidence",
        }},
        {"name": "assess_harness_effect", "arguments": {
            "decision_id": "decision-1",
            "observation_refs": ["execution-observation-1"],
            "verdict": "supported",
            "consequence": "The first projection made the method available.",
        }},
        {"name": "read", "arguments": {"path": str(skill_file)}},
        {"name": "benchmark_probe", "arguments": {}},
    ])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    text = next(
        part["text"]
        for message in contexts[-1]["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
        and part["text"].startswith("Unassessed task-local harness effects:")
    )
    pending = json.loads(text.split(": ", 1)[1])
    assert len(pending) == 1
    assert pending[0]["decision_id"] == "decision-1"
    assert pending[0]["research_link_status"] == "unlinked"
    assert pending[0]["native_exposure_count"] == 2
    assert pending[0]["unassessed_native_exposure_count"] == 1
    assert pending[0]["latest_native_observation_refs"] == ["skill-read-decision-1"]
    assert pending[0]["prior_effect_assessment"] == {
        "effect_assessment_id": "effect-assessment-1", "verdict": "supported",
    }


def test_same_task_skill_recovery_uses_context_without_native_loader(tmp_path):
    root = tmp_path / "skill"
    skill_file = root / "task-harness" / "skills" / "probe-method" / "SKILL.md"
    skill_file.parent.mkdir(parents=True)
    skill_file.write_text(
        "---\nname: probe-method\ndescription: A task-local discriminating probe method.\n---\n\n"
        "Read this method before choosing the next probe.\n",
        encoding="utf-8",
    )
    (root / "task-skills.jsonl").write_text(json.dumps({
        "skill_id": "skill-1", "name": "probe-method", "version": 1, "status": "active",
        "description": "A task-local discriminating probe method.",
        "instructions": "Read this method before choosing the next probe.",
        "file": str(skill_file), "basis_refs": ["finding-1"], "decision_id": "decision-1",
        "expected_effect": "improve probe selection", "reconsider_when": "the method is irrelevant",
        "recordedAt": "2026-09-11T00:00:00Z",
    }) + "\n", encoding="utf-8")

    _run_fixture(root, "treatment", steps=[])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert "probe-method" in json.dumps(contexts[0])
    assert "probe-method" not in contexts[0]["systemPrompt"]
    assert {"benchmark_probe", "task_harness", "task_skill"} <= {tool["name"] for tool in contexts[0]["tools"]}
    skill_events = [json.loads(line) for line in (root / "task-skill-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all(item["event"] != "loaded_by_pi" for item in skill_events)


def test_task_skill_creation_projection_and_later_read_are_distinct_facts(tmp_path):
    root = tmp_path / "skill-create"
    expected_file = root / "task-harness" / "skills" / "probe-method" / "SKILL.md"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "probe-method",
            "description": "A reusable discriminating probe method.",
            "instructions": "Compare predictions first, then choose the observation that separates them.",
            "basis_refs": [], "expected_effect": "avoid repeated ambiguous probes",
            "reconsider_when": "the environment no longer matches the method",
        }},
        {"name": "read", "arguments": {"path": str(expected_file)}},
    ])

    assert expected_file.is_file()
    skill = json.loads((root / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert skill["decision_id"] == "decision-1"
    events = [
        json.loads(line)
        for line in (root / "task-skill-events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [item["event"] for item in events if item["event"] in {
        "file_written", "projected_to_context", "read_by_agent",
    }] == ["file_written", "projected_to_context", "read_by_agent"]
    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any("Active task-local skills" in message.get("content", [{}])[0].get("text", "")
               for message in contexts[2]["messages"])
    observations = [
        json.loads(line)
        for line in (root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(
        item["observation_kind"] == "pi_skill_context_index"
        and item["decision_id"] == "decision-1"
        for item in observations
    )


def test_task_tool_policy_changes_the_later_native_pi_tool_set(tmp_path):
    root = tmp_path / "tool-policy"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_tool_policy", "arguments": {
            "action": "apply", "enabled_tools": ["benchmark_probe", "research_resource"],
            "basis_refs": [], "expected_effect": "remove unused management choices",
            "reconsider_when": "another task-local resource is needed",
        }},
    ])

    contexts = [
        json.loads(line)["context"]
        for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert {tool["name"] for tool in contexts[-1]["tools"]} == {
        "benchmark_probe", "research_resource", "task_harness", "task_tool_policy",
    }
    observation = json.loads(
        (root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert observation["observation_kind"] == "pi_active_tools"
    assert observation["effect_observed"] is True


def test_task_tool_policy_cannot_reenable_runner_excluded_builtins(tmp_path):
    root = tmp_path / "tool-policy-boundary"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_tool_policy", "arguments": {
            "action": "apply", "enabled_tools": ["benchmark_probe", "bash"],
            "basis_refs": [], "expected_effect": "try to reenable a runner-excluded builtin",
            "reconsider_when": "the policy rejects the excluded builtin",
        }},
    ])

    assert any(
        event.get("type") == "tool_execution_end"
        and event.get("toolName") == "task_tool_policy"
        and event.get("isError") is True
        and "unknown tools: bash" in json.dumps(event)
        for event in events
    )
    assert not any(event.get("toolName") == "bash" for event in events)


def test_arc_task_subagent_runs_an_isolated_read_only_pi_loop(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-subagent"
    root.mkdir()
    (root / "execution-observations.jsonl").write_text(json.dumps({
        "observation_id": "execution-observation-1", "event_id": "execution-observation-1",
        "tool_name": "inspect_arc_trajectory", "result_text": "Two interpretations remain viable.",
        "result": "Two interpretations remain viable.", "is_error": False,
    }) + "\n", encoding="utf-8")
    steps = [
        {"name": "research_resource", "arguments": {
            "action": "record", "observation_id": "execution-observation-1",
            "evidence": "Two interpretations remain viable.",
            "decision": "Use an independent reader to distinguish them.",
        }},
        {"name": "task_subagent", "arguments": {
            "action": "create", "name": "pattern-critic",
            "description": "Check competing interpretations of the visible ARC trajectory.",
            "instructions": "Return the strongest interpretation and one discriminating next probe.",
            "tools": ["inspect_arc_trajectory"],
            "basis_refs": ["execution-observation-1", "finding-1"],
            "expected_effect": "surface an alternative interpretation before the next action",
            "reconsider_when": "the analysis repeats the parent without new evidence",
        }},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "trajectory-note",
            "content": "The settled frame is more informative than the animation history.",
        }},
        {"name": "delegate_task", "arguments": {
            "agent_name": "pattern-critic", "task": "Review the visible trajectory.",
            "evidence_refs": ["execution-observation-1"],
            "resource_refs": ["memory:trajectory-note@v1"],
        }},
    ]
    command = (
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    )
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_EXTERNAL_STEPS": json.dumps(steps),
    }
    native_skill = root / ".pi-agent" / "skills" / "native-probe" / "SKILL.md"
    native_skill.parent.mkdir(parents=True)
    native_skill.write_text(
        "---\nname: native-probe\ndescription: A native skill available to delegated agents.\n---\n\n"
        "Use the delegated agent's read-only evidence surface.\n",
        encoding="utf-8",
    )
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Run the deterministic ARC delegation fixture.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    invocation = json.loads(
        (root / "subagent-invocations.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert invocation["resource_refs"] == ["memory:trajectory-note@v1"]
    assert invocation["permission"] == "read_only_arc"
    assert invocation["result"]["text"] == "Independent read-only analysis complete."
    assert invocation["result"]["resolved_evidence_refs"] == ["execution-observation-1"]
    assert invocation["result"]["usage"] == {
        "input": 11, "output": 5, "cacheRead": 0, "cacheWrite": 0,
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0},
    }
    native_skill_events = [
        json.loads(line)
        for line in (root / "subagent-native-skills.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert native_skill_events[-1]["names"] == []
    assert native_skill_events[-1]["count"] == len(native_skill_events[-1]["names"])
    observation = json.loads(
        (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()[-1]
    )
    assert 'SUBAGENT_USAGE: {"input":11,"output":5,"cacheRead":0,"cacheWrite":0,"cost_total":0}' \
        in observation["result_text"]
    child_context = json.loads(
        (root / "subagent-provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )["context"]
    assert {tool["name"] for tool in child_context["tools"]} == {"inspect_arc_trajectory", "task_resource"}
    assert "read-only task-local ARC subagent" in child_context["systemPrompt"]
    assert "Two interpretations remain viable." in child_context["messages"][0]["content"][0]["text"]
    assert "The settled frame is more informative than the animation history." in json.dumps(child_context)
    child_telemetry = [
        json.loads(line)
        for line in (root / "subagent-provider-telemetry.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(item["event"] == "assistant_message" for item in child_telemetry)
    assert all(item["scope"] == "arc-readonly-subagent" for item in child_telemetry)
    decisions = [
        json.loads(line)
        for line in (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert decisions[0]["intervention"] == "task_local_pi_subagent"
    assert decisions[0]["basis_resource_ids"] == [
        "execution-observation-1", "finding-1@v1",
    ]
    exposures = [
        json.loads(line)
        for line in (root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    subagent_exposure = next(item for item in exposures if item["observation_kind"] == "pi_subagent_invocation")
    assert subagent_exposure["decision_id"] == decisions[0]["decision_id"]
    assert subagent_exposure["basis_resource_ids"] == [
        "execution-observation-1", "finding-1@v1",
    ]


def test_arc_task_subagent_discards_large_intermediate_json_events(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-subagent-large-intermediate"
    root.mkdir()
    steps = [
        {"name": "task_subagent", "arguments": {
            "action": "create", "name": "bounded-reviewer",
            "description": "Return a bounded conclusion after inspecting large evidence.",
            "instructions": "Return only the concise conclusion.",
            "tools": ["inspect_arc_trajectory"],
        }},
        {"name": "delegate_task", "arguments": {
            "agent_name": "bounded-reviewer", "task": "Review the evidence.",
        }},
    ]
    command = (
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    )
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_AUTORESEARCH_PI_CLI": str(project / "tests" / "pi_large_ndjson_child.mjs"),
        "PI_AUTORESEARCH_PROVIDER": "offline-child",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_EXTERNAL_STEPS": json.dumps(steps),
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Run the large-intermediate subagent fixture.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    invocation = json.loads(
        (root / "subagent-invocations.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert invocation["status"] == "completed"
    assert invocation["result"]["text"] == "Bounded subagent conclusion."
    assert invocation["result"]["event_count"] == 2


def test_task_subagent_lifecycle_is_reusable_by_a_non_arc_adapter(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "generic-subagent"
    root.mkdir()
    steps = [
        {"name": "task_subagent", "arguments": {
            "action": "create", "name": "fixture-reader",
            "description": "Read the fixture's public state.",
            "instructions": "Return a concise observation.",
            "tools": ["fixture_state"],
        }},
        {"name": "delegate_task", "arguments": {
            "agent_name": "fixture-reader", "task": "Inspect the public fixture state.",
        }},
    ]
    command = (
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "tests" / "pi_non_arc_task_subagents.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    )
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(
            project / "tests" / "pi_subagent_provider.ts"
        ),
        "PI_EXTERNAL_STEPS": json.dumps(steps),
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Run the generic task-local delegation fixture.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    invocation = json.loads(
        (root / "subagent-invocations.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert invocation["adapter_id"] == "fixture"
    assert invocation["permission"] == "read_only_fixture"
    child_context = json.loads(
        (root / "subagent-provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )["context"]
    assert {tool["name"] for tool in child_context["tools"]} == {"fixture_state", "task_resource"}
    assert "ARC" not in child_context["systemPrompt"]
    shared_source = (project / "demo" / "pi_task_local_subagents.ts").read_text(encoding="utf-8")
    assert "arc_state" not in shared_source
    assert "read_only_arc" not in shared_source


def test_arc_child_state_uses_the_last_animation_frame_in_lossless_runs(tmp_path):
    class StateHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({
                "state": "NOT_FINISHED",
                "levels_completed": 1,
                "frames": [
                    [[11, 11, 11], [11, 11, 11]],
                    [[1, 1, 2], [3, 3, 3]],
                ],
                "agent_available_actions": ["RESET", "ACTION1"],
                "model_prompt": "Frame 0:\n  [11, 11, 11]\n  [11, 11, 11]",
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), StateHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        node, cli = _pi_cli()
        project = Path(__file__).resolve().parents[1]
        root = tmp_path / "arc-last-frame"
        root.mkdir()
        steps = [
            {"name": "task_subagent", "arguments": {
                "action": "create", "name": "frame-reader",
                "description": "Read the current public ARC frame.",
                "instructions": "Inspect only the current settled frame.",
                "tools": ["arc_state"],
            }},
            {"name": "delegate_task", "arguments": {
                "agent_name": "frame-reader", "task": "Read the current frame.",
            }},
        ]
        command = (
            node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
            "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--no-context-files", "--no-builtin-tools",
            "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
            "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
        )
        env = {
            "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
            "PI_AUTORESEARCH_E2E_ROOT": str(root),
            "PI_AUTORESEARCH_ROOT": str(project),
            "PI_AUTORESEARCH_VARIANT": "treatment",
            "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
            "PI_AUTORESEARCH_SCOPED_READ": "enabled",
            "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(
                project / "tests" / "pi_subagent_provider.ts"
            ),
            "PI_SUBAGENT_STEPS": json.dumps([{
                "name": "arc_state", "arguments": {"request": "current"},
            }]),
            "PI_EXTERNAL_STEPS": json.dumps(steps),
        }
        with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
            kernel.prompt("Run the ARC last-frame fixture.")
            events = kernel.wait_for_agent_events(timeout=60)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert any(event.get("type") == "agent_end" for event in events)
    contexts = [
        json.loads(line)["context"]
        for line in (root / "subagent-provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(contexts) == 2
    later_context = json.dumps(contexts[-1], ensure_ascii=False)
    assert "Current frame is the last rendered frame (2 of 2)" in later_context
    assert "r00: c00-01=1 c02=2" in later_context
    assert "r01: c00-02=3" in later_context
    assert "Frame 0:" not in later_context
    assert '"frames"' not in later_context


def test_arc_task_tool_is_public_state_only_and_dynamic(tmp_path):
    class StateHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({
                "game_id": "fixture", "state": "NOT_FINISHED", "levels_completed": 2,
                "available_actions": ["ACTION1"], "action_budget": 40,
                "secret_evaluator_field": "must-not-leak",
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), StateHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        node, cli = _pi_cli()
        project = Path(__file__).resolve().parents[1]
        root = tmp_path / "arc-task-tool"
        root.mkdir()
        steps = [
            {"name": "task_tool", "arguments": {
            "action": "create", "name": "state", "description": "Read public ARC state.",
                "implementation_ref": "arc.public_state",
            }},
            {"name": "task_tool_state_v1", "arguments": {"input": {"fields": "state,levels_completed,secret_evaluator_field"}}},
        ]
        command = (
            node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
            "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--no-context-files", "--no-builtin-tools",
            "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
            "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
        )
        env = {
            "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
            "PI_AUTORESEARCH_E2E_ROOT": str(root),
            "PI_AUTORESEARCH_ROOT": str(project),
            "PI_AUTORESEARCH_VARIANT": "treatment",
            "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
            "PI_AUTORESEARCH_SCOPED_READ": "enabled",
            "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "PI_EXTERNAL_STEPS": json.dumps(steps),
        }
        with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
            kernel.prompt("Run the ARC task-tool fixture.")
            events = kernel.wait_for_agent_events(timeout=60)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert any(event.get("type") == "agent_end" for event in events)
    records = [json.loads(line) for line in (root / "task-tools.jsonl").read_text(encoding="utf-8").splitlines()]
    assert records[0]["adapter_id"] == "arc_agi_3"
    assert records[0]["permission"] == "arc_adapter_bounded"
    assert records[0]["input_schema"] == {"type": "object"}
    invocation = next(json.loads(line) for line in (root / "task-tool-events.jsonl").read_text(encoding="utf-8").splitlines() if '"event":"invoked"' in line)
    assert "levels_completed" in invocation["output_excerpt"]
    assert "secret_evaluator_field" not in invocation["output_excerpt"]


def test_arc_task_tool_stops_a_bounded_sequence_at_native_terminal_state(tmp_path):
    calls = []

    class StateHandler(BaseHTTPRequestHandler):
        def _send(self, value):
            body = json.dumps(value).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._send({
                "game_id": "fixture", "state": "NOT_FINISHED", "levels_completed": 0,
                "agent_available_actions": ["ACTION1"], "action_budget": 40,
            })

        def do_POST(self):
            size = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(size))
            calls.append(payload["action"])
            self._send({
                "game_id": "fixture", "state": "GAME_OVER", "levels_completed": 0,
                "agent_available_actions": ["ACTION1"], "action_budget": 40,
                "observation_delta": {"changed_cells": 52},
                "public_transition": {"level_changed": False},
            })

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), StateHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        node, cli = _pi_cli()
        project = Path(__file__).resolve().parents[1]
        root = tmp_path / "arc-action-sequence"
        root.mkdir()
        steps = [
            {"name": "task_tool", "arguments": {
                "action": "create", "name": "repeat-probe",
                "description": "Reuse a validated short ARC action sequence.",
                "input_schema": {"type": "object", "properties": {"actions": {"type": "array", "items": {"type": "string"}}}},
                "implementation_ref": "arc.action_sequence",
            }},
            {"name": "task_tool_repeat-probe_v1", "arguments": {"input": {"actions": ["ACTION1", "ACTION1"]}}},
        ]
        command = (
            node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
            "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--no-context-files", "--no-builtin-tools",
            "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
            "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
        )
        env = {
            "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
            "PI_AUTORESEARCH_E2E_ROOT": str(root),
            "PI_AUTORESEARCH_ROOT": str(project),
            "PI_AUTORESEARCH_VARIANT": "treatment",
            "PI_AUTORESEARCH_CONTEXT_COMPACTION": "disabled",
            "PI_AUTORESEARCH_SCOPED_READ": "enabled",
            "PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "PI_EXTERNAL_STEPS": json.dumps(steps),
        }
        with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
            kernel.prompt("Run the ARC action-sequence fixture.")
            events = kernel.wait_for_agent_events(timeout=60)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert any(event.get("type") == "agent_end" for event in events)
    assert calls == ["ACTION1"]
    record = json.loads((root / "task-tools.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert record["implementation_ref"] == "arc.action_sequence"
    invocation = next(
        json.loads(line)
        for line in (root / "task-tool-events.jsonl").read_text(encoding="utf-8").splitlines()
        if '"event":"invoked"' in line
    )
    assert invocation["status"] == "completed"
    assert invocation["output_excerpt"].count("ACTION1") >= 3
    assert "changed_cells" in invocation["output_excerpt"]
