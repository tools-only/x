"""Exercise the actual Pi loop without fixture-injected capability activation."""
import json
from hashlib import sha256
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def records(root, name):
    path = root / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_empty_task_has_direct_creation_and_method_at_first_request(tmp_path):
    root = tmp_path / "entry"
    _run_fixture(root, "treatment", steps=[])
    context = records(root, "provider-contexts.jsonl")[0]["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert {"research_resource", "task_harness", "task_harness_status", "task_skill", "task_memory", "task_system_prompt", "read", "assess_harness_effect"} <= names
    assert not any(name.startswith("task_") and ("guid" + "ance") in name for name in names)
    assert "task_subagent" not in names  # no adapter configured
    assert "task_tool" not in names
    assert "Auto-Research" in context["systemPrompt"]
    assert "composition" in context["systemPrompt"]
    method = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "auto_research_method.md").read_text(encoding="utf-8")
    main_contract = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "auto_research_main_contract.md").read_text(encoding="utf-8")
    assert main_contract in context["systemPrompt"]
    assert method not in context["systemPrompt"]
    assert not records(root, "task-skills.jsonl")
    assert not records(root, "task-memory.jsonl")
    assert not records(root, "task-harness-bootstrap.jsonl")
    entry = records(root, "task-harness-entry.jsonl")[0]
    assert entry["native_skill_loading"] is False
    assert entry["initial_resource_counts"]["skills"] == 0
    assert entry["main_contract_sha256"] == sha256(main_contract.encode("utf-8")).hexdigest()
    opportunities = records(root, "task-harness-opportunities.jsonl")
    assert opportunities[0]["trigger"] == "initial_surface"
    assert opportunities[0]["observation_count"] == 0


def test_context_token_debug_breaks_down_each_provider_turn(tmp_path):
    root = tmp_path / "context-token-debug"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "arc-fact", "content": "Keep the observed delta separate from interpretation.",
        }},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "delta-review", "instructions": "Review the latest delta before acting.",
        }},
    ])
    debug = records(root, "context-token-debug.jsonl")
    requests = [item for item in debug if item["event"] == "provider_request_context"]
    usages = [item for item in debug if item["event"] == "provider_response_usage"]
    assert len(requests) == 3
    assert len(usages) == 3
    assert [item["turn"] for item in requests] == [1, 2, 3]
    assert all(item["measurement_basis"] == "context_hook_fallback" for item in requests)
    assert requests[0]["modules"]["system_prompt"]["estimated_tokens"] > 0
    assert requests[0]["modules"]["task_prompt"]["estimated_tokens"] > 0
    assert requests[0]["modules"]["checkpoint"]["estimated_tokens"] > 0
    assert requests[0]["modules"]["tools"]["estimated_tokens"] > 0
    assert requests[1]["modules"]["memory"]["estimated_tokens"] > 0
    assert requests[2]["modules"]["skills"]["estimated_tokens"] > 0
    assert all("Keep the observed delta" not in json.dumps(item) for item in debug)


def test_task_system_prompt_overlay_uses_native_before_agent_start_on_next_agent_turn(tmp_path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "system-prompt-overlay"
    root.mkdir()
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--no-builtin-tools", "--extension", str(project / "demo" / "pi_external_benchmark_research.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_EXTERNAL_STEPS": json.dumps([{
            "name": "task_system_prompt", "arguments": {
                "action": "create", "name": "stable-observation-rule",
                "content": "Keep observed state separate from inferred cause.",
                "scope": "current task",
            },
        }]),
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Create the task-local prompt segment.")
        kernel.wait_for_agent_events(timeout=60)
        kernel.prompt("Continue the same task.")
        kernel.wait_for_agent_events(timeout=60)

    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    assert "Keep observed state separate from inferred cause." not in contexts[0]["systemPrompt"]
    assert "# Task-local system-prompt overlay" in contexts[-1]["systemPrompt"]
    assert "Keep observed state separate from inferred cause." in contexts[-1]["systemPrompt"]
    assert records(root, "task-system-prompt.jsonl")[0]["status"] == "active"


def test_task_harness_start_is_a_non_mutating_creation_kickoff(tmp_path):
    root = tmp_path / "kickoff"
    events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness", "arguments": {"action": "start"},
    }])
    errors = [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert not errors
    start = records(root, "task-harness-entry-events.jsonl")[0]
    entry = start["entry"]
    assert entry["status"] == "unlocked"
    assert entry["active_resources"] == {
        "memory": 0, "system_prompt": 0,
        "skill": 0, "tool": 0, "subagent": 0,
    }
    assert "task_memory(action=upsert)" in entry["creation_calls"]
    assert "task_skill(action=create)" in entry["creation_calls"]
    assert "lifecycle" in entry
    assert not records(root, "task-memory.jsonl")
    assert not records(root, "task-skills.jsonl")


def test_direct_skill_research_revision_projects_next_request_without_native_loader(tmp_path):
    root = tmp_path / "lifecycle"
    path = root / "task-harness" / "skills" / "probe" / "SKILL.md"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {"action": "create", "name": "probe", "instructions": "Predict before probing."}},
        {"name": "read", "arguments": {"path": str(path)}},
        {"name": "benchmark_probe", "arguments": {"progressed": False}},
        {"name": "research_resource", "arguments": {"action": "open", "question": "Does the trial method distinguish explanations?", "evidence_to_seek": "A contrasting prediction", "subject_kind": "component", "hypothesis": "Comparing predictions reduces ambiguous probes.", "subject_refs": ["skill:probe@v1"], "component_refs": ["skill:probe@v1"]}},
        {"name": "task_skill", "arguments": {"action": "update", "name": "probe", "target_version": 1, "instructions": "Compare competing predictions before probing.", "basis_refs": ["finding-1"]}},
        {"name": "benchmark_probe", "arguments": {"progressed": True}},
        {"name": "assess_harness_effect", "arguments": {"decision_id": "decision-2", "observation_refs": ["execution-observation-2"], "verdict": "inconclusive", "consequence": "Progress observed, attribution remains uncertain."}},
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    projected = [m for m in contexts[5]["messages"] if "Active task-local skills" in json.dumps(m)]
    assert "skill:probe@v2" in json.dumps(projected)
    assert "Compare competing predictions" in path.read_text(encoding="utf-8")
    assert "instructions" not in json.dumps(projected)  # full body is available by explicit read/focus
    skill_view = json.loads(projected[0]["content"][0]["text"].split(": ", 1)[1])
    assert skill_view[0]["version"] == 2
    finding = records(root, "research-resources.jsonl")[0]
    assert finding["subject_kind"] == "component"
    assert finding["hypothesis"] == "Comparing predictions reduces ambiguous probes."
    assert finding["subject_refs"] == ["skill:probe@v1"]
    assert not records(root, "task-harness-bootstrap.jsonl")
    assert not any(e["event"] == "loaded_by_pi" for e in records(root, "task-skill-events.jsonl"))
    assert records(root, "effect-assessments.jsonl")[0]["verdict"] == "inconclusive"


def test_task_harness_restores_an_authorized_tool_without_granting_host_tools(tmp_path):
    root = tmp_path / "restore"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_tool_policy", "arguments": {
            "action": "apply", "enabled_tools": ["task_harness", "research_resource"],
            "basis_refs": [], "expected_effect": "temporarily reduce the working set",
            "reconsider_when": "the benchmark probe becomes necessary",
        }},
        {"name": "task_harness", "arguments": {
            "action": "enable", "enabled_tools": ["benchmark_probe"],
        }},
        {"name": "benchmark_probe", "arguments": {"progressed": True}},
    ])
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    assert {tool["name"] for tool in contexts[1]["tools"]} == {
        "task_harness", "task_tool_policy", "research_resource",
    }
    assert {tool["name"] for tool in contexts[2]["tools"]} >= {
        "task_harness", "task_tool_policy", "research_resource", "benchmark_probe",
    }
    assert "bash" not in {tool["name"] for tool in contexts[2]["tools"]}


def test_task_harness_focus_projects_only_selected_task_resource_versions(tmp_path):
    root = tmp_path / "focus"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "alpha", "description": "First trial", "instructions": "Use alpha.",
        }},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "beta", "description": "Second trial", "instructions": "Use beta.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "focus", "resource_refs": ["skill:alpha@v1"],
        }},
    ])
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    focused = [message for message in contexts[3]["messages"] if "Active task-local skills" in json.dumps(message)]
    assert len(focused) == 1
    assert "alpha" in json.dumps(focused[0])
    assert "beta" not in json.dumps(focused[0])


def test_compact_arc_focus_projects_memory_body_after_creation(tmp_path):
    root = tmp_path / "compact-memory"
    _run_fixture(root, "treatment", arc_compact=True, steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "action-effects",
            "content": "Keep public common changes separate from action-specific changes.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "focus", "resource_refs": ["memory:memory-1@v1"],
        }},
    ])
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    memory_text = "\n".join(
        part["text"]
        for context in contexts
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text" and "Active task-local memory" in part.get("text", "")
    )
    assert "Keep public common changes separate from action-specific changes." in memory_text
    compact_method = (
        Path(__file__).resolve().parents[1] / "demo" / "prompts" / "auto_research_arc_contract.md"
    ).read_text(encoding="utf-8")
    assert compact_method in contexts[0]["systemPrompt"]
    assert all("Prefer the next ARC action" not in json.dumps(context) for context in contexts)
    access = records(root, "task-resource-access.jsonl")
    assert not access  # focus/exposure is not the same as an explicit read


def test_compact_arc_focus_projects_skill_instructions_and_system_prompt_body(tmp_path):
    skill_root = tmp_path / "compact-skill"
    _run_fixture(skill_root, "treatment", arc_compact=True, steps=[
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "probe-method",
            "instructions": "Compare competing predictions before selecting a probe.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "focus", "resource_refs": ["skill:skill-1@v1"],
        }},
    ])
    skill_contexts = [item["context"] for item in records(skill_root, "provider-contexts.jsonl")]
    assert "Compare competing predictions before selecting a probe." in json.dumps(skill_contexts)

    prompt_root = tmp_path / "compact-system-prompt"
    _run_fixture(prompt_root, "treatment", arc_compact=True, steps=[
        {"name": "task_system_prompt", "arguments": {
            "action": "create", "name": "review-rule", "content": "After a repeated outcome, compare two hypotheses.",
        }},
    ])
    prompt_contexts = [item["context"] for item in records(prompt_root, "provider-contexts.jsonl")]
    assert "After a repeated outcome, compare two hypotheses." in json.dumps(prompt_contexts)


def test_actual_arc_skill_creation_has_a_reachable_read_use_boundary(tmp_path):
    """The ARC compact surface must make a created task skill usable."""
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "arc-skill-use"
    root.mkdir()
    skill_path = root / "task-harness" / "skills" / "probe" / "SKILL.md"
    steps = [
        {"name": "task_harness", "arguments": {
            "action": "enable", "enabled_tools": ["skill"],
        }},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "probe",
            "instructions": "Use the settled observation before choosing the next action.",
        }},
        {"name": "read", "arguments": {"path": str(skill_path)}},
    ]
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo" / "pi_arc_agi_3_extension.ts"),
        "--extension", str(project / "tests" / "pi_external_benchmark_provider.ts"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project),
        "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_EXECUTION_GATE": "enabled",
        "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_EXTERNAL_STEPS": json.dumps(steps),
    }
    with PiKernel(command, cwd=str(root), env=env, timeout=60) as kernel:
        kernel.prompt("Run the ARC task-local skill use fixture.")
        events = kernel.wait_for_agent_events(timeout=60)

    errors = [event for event in events
              if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert not errors
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    # ARC now exposes the scoped task-local reader from the first planning
    # cycle so a created skill can be created, read, and used without a
    # separate enable-only turn. Native skills remain disabled.
    assert "read" in {tool["name"] for tool in contexts[0]["tools"]}
    assert "read" in {tool["name"] for tool in contexts[1]["tools"]}
    assert any(
        event.get("event") == "read_by_agent" and event.get("name") == "probe"
        for event in records(root, "task-skill-events.jsonl")
    )
    assert any(
        item.get("access") == "read" and item.get("resource_kind") == "skill"
        and item.get("name") == "probe"
        for item in records(root, "task-resource-access.jsonl")
    )


def test_task_local_inspect_is_a_read_and_is_not_a_mutation_gate(tmp_path):
    root = tmp_path / "inspect-access"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "fact", "content": "A retained fact.",
        }},
        {"name": "task_memory", "arguments": {"action": "inspect", "key": "fact"}},
    ])
    assert records(root, "task-resource-access.jsonl")
    errors = [event for event in records(root, "pi-events.jsonl")
              if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert not errors


def test_repeated_real_operations_surface_a_neutral_self_harness_opportunity(tmp_path):
    root = tmp_path / "opportunity-trigger"
    _run_fixture(root, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "benchmark_probe", "arguments": {}},
        {"name": "benchmark_probe", "arguments": {}},
    ])
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    assert any(
        "Self-harness opportunity is available" in json.dumps(message)
        and "benchmark_probe" in json.dumps(message)
        and "Resource types with no active instance" in json.dumps(message)
        for context in contexts
        for message in context["messages"]
    )
    opportunities = records(root, "task-harness-opportunities.jsonl")
    assert opportunities
    assert opportunities[0]["decision"] == "agent_choice_required"
    assert "memory" in opportunities[0]["missing_components"]
    assert all("next_component" not in item for item in opportunities)
    assert all(
        "recommended lower-order component" not in json.dumps(context)
        for context in contexts
    )


def test_control_has_no_method_or_creation_interface(tmp_path):
    root = tmp_path / "control"
    _run_fixture(root, "control", steps=[])
    context = records(root, "provider-contexts.jsonl")[0]["context"]
    assert {t["name"] for t in context["tools"]} == {"benchmark_probe"}
    assert "Auto-Research method" not in context["systemPrompt"]
    assert not records(root, "task-harness-entry.jsonl")
