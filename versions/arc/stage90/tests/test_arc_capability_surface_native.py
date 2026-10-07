"""Assembly must disclose its use interface without opening every control."""
import json
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def _run_arc_parent(root, steps, extra_extensions=(), extra_env=None,
                    prompt="Exercise the selected capability's surface."):
    """Actual ARC extension/Pi surface; no actions against this fixture URL."""
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root.mkdir(exist_ok=True)
    command = [node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
               "--extension", str(project / "demo/pi_arc_agi_3_extension.ts"),
               "--extension", str(project / "tests/pi_external_benchmark_provider.ts")]
    for extension in extra_extensions:
        command.extend(["--extension", str(extension)])
    env = {
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project), "PI_AUTORESEARCH_VARIANT": "treatment",
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled", "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_ARC_EXECUTION_GATE": "enabled", "PI_ARC_BRIDGE_URL": "http://127.0.0.1:9",
        "PI_EXTERNAL_STEPS": json.dumps(steps),
    }
    env.update(extra_env or {})
    broker = None
    if env.get("PI_AUTORESEARCH_PROVIDER") and not env.get("PI_AUTORESEARCH_SUBAGENT_BROKER_URL"):
        from autoresearch_pi.subagent_broker import SubagentBroker
        broker = SubagentBroker()
        broker.start()
        env["PI_AUTORESEARCH_SUBAGENT_BROKER_URL"] = broker.url
    try:
        with PiKernel(command, cwd=str(root), timeout=60, env=env) as kernel:
            kernel.prompt(prompt)
            return kernel.wait_for_agent_events(timeout=60)
    finally:
        if broker is not None:
            broker.close()


def test_unselected_automatic_probe_does_not_open_memory_management_schema(tmp_path):
    project = Path(__file__).resolve().parents[1]
    ref = "memory:action-decision:execution-observation-1@v1"
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "arc_action", "arguments": {"action": "noop", "decision": {
            "hypothesis": "Unknown control", "prediction": "Visible change", "falsifier": "No visible change"}}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "enable", "enabled_tools": ["task_resource"]}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": ref}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [ref], "decision": {"basis_refs": [ref],
                "reason": "Retain this exact falsifier", "expected": "The selected probe is exposed"}}},
        {"name": "task_memory_pool", "arguments": {"action": "capture", "capture_id": "authored-rule",
            "items": [{"key": "unknown-rule", "content": "Controls remain unverified", "scope": "task", "claim_kind": "hypothesis"}]}},
    ], extra_extensions=[project / "tests/pi_arc_action_capture_fixture.ts"],
       extra_env={"PI_ARC_CAPTURE_COMPACT_TOOLS": "enabled"})
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [json.loads(line)["context"] for line in (tmp_path / "provider-contexts.jsonl").read_text().splitlines()]
    for context in contexts[:5]:
        assert "task_memory_pool" not in {t["name"] for t in context["tools"]}
    assert "task_memory_pool" in {t["name"] for t in contexts[5]["tools"]}
    read = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_resource")
    assert "No visible change" in json.dumps(read["result"])
    assert "unknown-rule" in (tmp_path / "task-memory.jsonl").read_text()
    resumed = _run_fixture(tmp_path, "treatment", arc_compact=True,
                           steps=[{"name": "task_memory_pool", "arguments": {"action": "list"}}])
    assert not [e for e in resumed if e.get("type") == "tool_execution_end" and e.get("isError")]


def test_explicit_memory_management_enable_remains_available_without_pool_records(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "enable", "enabled_tools": ["task_memory_pool"]}},
        {"name": "task_memory_pool", "arguments": {"action": "capture", "capture_id": "authored-rule",
            "items": [{"key": "new-rule", "content": "A scoped hypothesis", "scope": "task", "claim_kind": "hypothesis"}]}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [json.loads(line)["context"] for line in (tmp_path / "provider-contexts.jsonl").read_text().splitlines()]
    assert "task_memory_pool" not in {t["name"] for t in contexts[0]["tools"]}
    assert all("task_memory_pool" in {t["name"] for t in c["tools"]} for c in contexts[1:])


def test_arc_skill_path_opens_only_selected_use_and_exact_resource_access(tmp_path):
    path = tmp_path / "task-harness" / "skills" / "bounded-check" / "SKILL.md"
    steps = [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": {
            "component": "skill", "name": "bounded-check", "description": "Compare a visible rule with a new observation.",
            "instructions": "State a prediction, observe one action, and preserve the counterexample."},
            "decision": {"basis_refs": [], "reason": "A small comparison procedure can be trialed.", "expected": "Keep one falsifiable prediction."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:bounded-check@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select only this Skill.", "expected": "The selected procedure becomes readable."}}},
        {"name": "read", "arguments": {"path": str(path)}},
    ]
    events = _run_arc_parent(tmp_path, steps)
    calls = [e for e in events if e.get("type") == "tool_execution_end"]
    assert len(calls) == 4 and all(not e.get("isError") for e in calls)
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    for ctx in contexts[1:]:
        names = {t["name"] for t in ctx["tools"]}
        assert not ({"task_harness_status", "task_tool_policy", "task_memory_pool", "task_validation", "delegate_task"} & names)
        assert {"task_harness", "task_harness_create"} <= names
    assert "read" in {t["name"] for t in contexts[3]["tools"]}
    assert "State a prediction" in calls[-1]["result"]["content"][0]["text"]
    # Explicit discovery still opens a requested control without broadening
    # host permissions, and the commitment survives a new Pi session.
    resumed_events = _run_arc_parent(tmp_path, steps=[
        {"name": "task_harness", "arguments": {"action": "enable", "enabled_tools": ["status", "task_tool_policy"]}},
        {"name": "task_harness_status", "arguments": {"request": "current"}},
        {"name": "read", "arguments": {"path": str(path)}},
    ])
    assert not [e for e in resumed_events if e.get("type") == "tool_execution_end" and e.get("isError")]
    resumed = json.loads((tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[-4])["context"]
    assert "read" in {t["name"] for t in resumed["tools"]}
