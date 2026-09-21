"""Exercise the actual Pi loop without fixture-injected capability activation."""
import json
from hashlib import sha256
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import results


def records(root, name):
    path = root / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_empty_task_has_direct_creation_and_method_at_first_request(tmp_path):
    root = tmp_path / "entry"
    _run_fixture(root, "treatment", steps=[], extra_extensions=[Path(__file__).resolve().parents[1] / 'tests/pi_non_arc_task_subagents.ts'])
    context = records(root, "provider-contexts.jsonl")[0]["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert {"research_resource", "task_harness", "task_harness_status", "task_skill", "task_memory", "task_system_prompt", "read", "assess_harness_effect"} <= names
    assert not any(name.startswith("task_") and ("guid" + "ance") in name for name in names)
    assert "task_subagent" in names  # the research contract requires a configured adapter
    assert "auto_research" in names
    assert "AUTO-RESEARCH:" in context["systemPrompt"]
    research = next(tool for tool in context['tools'] if tool['name'] == 'auto_research')
    assert 'composition' in {choice['const'] for choice in research['parameters']['properties']['scope']['anyOf']}
    method = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "auto_research_method.md").read_text(encoding="utf-8")
    main_contract = (Path(__file__).resolve().parents[1] / "demo" / "prompts" / "auto_research_main_contract.md").read_text(encoding="utf-8")
    assert main_contract not in context["systemPrompt"]
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


def test_real_provider_surface_exposes_facade_without_native_mutation_tools(tmp_path):
    root = tmp_path / "facade-surface"
    _run_fixture(root, "treatment")
    context = records(root, "provider-contexts.jsonl")[0]["context"]
    names = {tool["name"] for tool in context["tools"]}
    assert "task_harness" in names
    assert not names.intersection({"task_memory", "task_system_prompt", "task_skill", "task_tool", "task_subagent"})


def test_harness_status_alias_and_review_schema_expose_legal_values(tmp_path):
    root = tmp_path / "tool-contract-descriptions"
    events = _run_fixture(root, "treatment", steps=[
        {"name":"task_harness","arguments":{"action":"status"}},
        {"name":"task_harness","arguments":{"action":"inspect"}},
    ])
    tools = {
        tool["name"]: tool
        for tool in records(root, "provider-contexts.jsonl")[0]["context"]["tools"]
    }

    status_description = tools["task_harness_status"]["description"]
    harness_description = tools["task_harness"]["description"]
    harness_schema = tools["task_harness"]["parameters"]

    outputs = [e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'task_harness']
    assert len(outputs) == 2 and all(not e.get('isError') for e in outputs)
    disposition = harness_schema['properties']['review']['items']['properties']['disposition']
    assert {choice['const'] for choice in disposition['anyOf']} == {'create','update','reuse','defer','not_applicable','keep'}
    status = json.loads(outputs[0]['result']['content'][0]['text'])
    assert status['review_contract']['repair_template']['action'] == 'review'


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
    assert requests[1]["modules"]["memory"]["estimated_tokens"] == 0
    assert requests[2]["modules"]["skills"]["estimated_tokens"] == 0
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
        }, {
            "name": "task_harness", "arguments": {
                "action": "assemble", "expected_assembly_revision": 0,
                "selected_resource_refs": ["system_prompt:stable-observation-rule@v1"],
                "prompt_contributions": [],
                "decision": {"basis_refs": [], "reason": "Select the stable rule.",
                             "expected": "The next request receives the selected overlay."},
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
    assert entry["creation_calls"] == ["task_harness(action=change)"]
    assert "lifecycle" in entry
    assert not records(root, "task-memory.jsonl")
    assert not records(root, "task-skills.jsonl")


def test_facade_routes_skill_and_system_prompt_overlay_in_one_parent_change(tmp_path):
    root = tmp_path / "facade-overlay"
    events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "change",
            "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "procedure", "execution": "text",
                "reuse": "expected_reuse", "reasoning": "bounded_judgment",
                "name": "delta-method", "summary": "Review the latest delta.",
                "content": "Compare competing predictions before selecting a probe.",
                "scope": {"kind": "task_wide", "statement": "this task"},
                "context_visibility": "always", "stability": "stable_in_scope",
                "prompt_channel": "system_prompt",
                "basis_refs": ["observation:validated@v1"],
                "system_prompt_basis": {"source": "validated_environment_invariant", "evidence_refs": ["observation:validated@v1"]},
            }}],
            "decision": {"basis_refs": ["observation:validated@v1"], "reason": "Repeated deltas require a stable review rule.", "expected": "The review rule remains available."},
        },
    }])
    errors = [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert not errors
    receipts = records(root, "task-harness-change-receipts.jsonl")
    assert receipts and receipts[-1]["status"] == "applied"
    assert [item["native_tool"] for item in receipts[-1]["results"]] == ["task_skill", "task_system_prompt"]
    assert records(root, "task-skills.jsonl")[0]["status"] == "active"
    assert records(root, "task-system-prompt.jsonl")[0]["status"] == "active"


def test_facade_accepts_component_words_and_supplies_current_update_version(tmp_path):
    root = tmp_path / "facade-update-version"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "memory", "key": "state", "content": "v1",
                "atom": {"subject": "fixture state", "predicate": "equals", "value": "v1"},
            }}],
            "decision": {"basis_refs": [], "reason": "Keep state.", "expected": "State is available."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [{"operation": "update", "candidate": {
                "semantic_kind": "memory", "key": "state", "content": "v2",
                "atom": {"subject": "fixture state", "predicate": "equals", "value": "v2"},
            }}],
            "decision": {"basis_refs": [], "reason": "Refresh state.", "expected": "New state replaces old state."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "skill", "name": "check-state", "content": "Read state before acting.",
            }}],
            "decision": {"basis_refs": [], "reason": "Reuse the check.", "expected": "The method can be opened later."},
        }},
    ])
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert [row["version"] for row in records(root, "task-memory.jsonl")] == [1, 2]
    assert records(root, "task-memory.jsonl")[-1]["content"] == "v2"
    assert records(root, "task-skills.jsonl")[-1]["name"] == "check-state"


def test_facade_renders_structured_text_bodies_without_object_coercion(tmp_path):
    root = tmp_path / "structured-text-bodies"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [
                {"operation": "create", "candidate": {
                    "semantic_kind": "procedure", "execution": "text",
                    "reuse": "expected_reuse", "reasoning": "bounded_judgment",
                    "name": "structured-method", "summary": "Preserve a structured method.",
                    "content": {
                        "procedure": ["Read the delta.", "Separate field and HUD groups."],
                        "known_action_map": {"ACTION1": "up"},
                    },
                }},
                {"operation": "create", "candidate": {
                    "semantic_kind": "fact", "execution": "text", "name": "structured-state",
                    "content": {"confirmed": ["ACTION1=up"]},
                    "atom": {"subject": "controls", "predicate": "confirmed_mapping",
                             "value": {"ACTION1": "up"}},
                }},
            ],
            "decision": {"basis_refs": [], "reason": "Persist complete structured bodies.",
                         "expected": "Later reads preserve every field as deterministic text."},
        }},
    ])
    errors = [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert not errors, errors
    skill = records(root, "task-skills.jsonl")[0]
    memory = records(root, "task-memory.jsonl")[0]
    skill_text = (root / "task-harness" / "skills" / "structured-method" / "SKILL.md").read_text(encoding="utf-8")
    assert skill["instructions"] == skill_text.split("---\n\n", 1)[1].rstrip()
    assert "[object Object]" not in skill["instructions"]
    assert '"procedure"' in skill["instructions"]
    assert '"known_action_map"' in skill["instructions"]
    assert memory["content"] != "[object Object]"
    assert '"ACTION1"' in memory["content"]


def test_facade_preserves_knowledge_lifecycle_links(tmp_path):
    root = tmp_path / "facade-knowledge-links"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [
                {"operation": "create", "candidate": {
                    "semantic_kind": "memory", "key": "old-policy", "content": "old",
                    "atom": {"subject": "fixture policy", "predicate": "version", "value": "old"},
                }},
                {"operation": "create", "candidate": {
                    "semantic_kind": "skill", "name": "dependent", "content": "Use the old policy.",
                    "depends_on_refs": ["memory:old-policy@v1"],
                }},
                {"operation": "create", "candidate": {
                    "semantic_kind": "memory", "key": "new-policy", "content": "new",
                    "atom": {"subject": "fixture policy", "predicate": "version", "value": "new"},
                    "supersedes_refs": ["memory:old-policy@v1"],
                }},
            ],
            "decision": {
                "basis_refs": [], "reason": "Replace the policy and retain its dependency graph.",
                "expected": "The old policy and dependent guidance are suspended.",
            },
        }},
    ])

    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assert records(root, "task-skills.jsonl")[-1]["depends_on_refs"] == ["memory:old-policy@v1"]
    assert records(root, "task-memory.jsonl")[-1]["supersedes_refs"] == ["memory:old-policy@v1"]


def test_facade_rejects_explicit_stale_update_version(tmp_path):
    root = tmp_path / "facade-stale-version"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "memory", "key": "state", "content": "v1",
                "atom": {"subject": "fixture state", "predicate": "equals", "value": "v1"}}}],
            "decision": {"basis_refs": [], "reason": "Create state.", "expected": "State exists."}}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "update", "candidate": {
                "semantic_kind": "memory", "key": "state", "target_version": 2, "content": "bad",
                "atom": {"subject": "fixture state", "predicate": "equals", "value": "bad"}}}],
            "decision": {"basis_refs": [], "reason": "Attempt stale write.", "expected": "Conflict is reported."}}},
    ])
    writes = records(root, "task-memory.jsonl")
    assert len(writes) == 1 and writes[0]["content"] == "v1"
    assert records(root, "task-harness-change-receipts.jsonl")[-1]["status"] == "failed"


def test_explicit_assembly_selects_pool_and_projects_non_memory_prompt_source(tmp_path):
    root = tmp_path / "explicit-assembly"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "unselected-fact", "content": "DO_NOT_ASSEMBLE",
        }},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "route-check", "instructions": "Check the destination before moving.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble",
            "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:route-check@v1"],
            "prompt_contributions": [{
                "contribution_id": "route-method",
                "source_ref": "skill:route-check@v1",
                "layer": "method",
                "content": "Use the route-check method for the current decision.",
                "reconsider_when": "the destination representation changes",
            }],
            "decision": {
                "basis_refs": [], "reason": "Use only the route method now.",
                "expected": "The next request contains the selected method and omits unrelated memory.",
            },
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    assembly = records(root, "task-harness-assemblies.jsonl")[-1]
    assert assembly["revision"] == 1
    assert assembly["selected_resource_refs"] == ["skill:route-check@v1"]
    status = json.loads(results(events, "task_harness")[-1]["result"]["content"][0]["text"])
    assert status["current_assembly"]["revision"] == 1
    assert {item["resource_ref"] for item in status["component_pool"]} >= {
        "memory:unselected-fact@v1", "skill:route-check@v1",
    }
    context = records(root, "provider-contexts.jsonl")[-1]["context"]
    text = json.dumps(context["messages"])
    assert "Active task-prompt method guidance" in text
    assert "Use the route-check method" in text
    assert "Active task-local skills" in text and "route-check" in text
    assert "DO_NOT_ASSEMBLE" not in text
    prompt_receipt = records(root, "task-prompt-assemblies.jsonl")[-1]
    contribution = next(item for item in prompt_receipt["selected"] if item["layer"] == "method")
    assert contribution["source_ref"] == "skill:route-check@v1"
    assert len(contribution["sha256"]) == 64


def test_atomic_memories_are_independently_selected_and_projected(tmp_path):
    root = tmp_path / "atomic-memory-assembly"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change",
            "changes": [
                {"operation": "create", "candidate": {
                    "semantic_kind": "fact", "name": "control-mapping",
                    "atom": {"subject": "ls20 controls", "predicate": "action_mapping",
                             "value": {"ACTION1": "up", "ACTION2": "down"}},
                    "summary": "Verified control mapping.",
                    "scope": {"kind": "task_wide", "statement": "ls20 task"},
                    "context_visibility": "always", "prompt_channel": "task_prompt",
                    "prompt_text": "Verified controls: ACTION1=up; ACTION2=down.",
                    "basis_refs": ["observation:controls@v1"],
                }},
                {"operation": "create", "candidate": {
                    "semantic_kind": "plan", "name": "route-to-ring",
                    "atom": {"subject": "upper ring", "predicate": "planned_route",
                             "value": ["ACTION1", "ACTION1", "ACTION1"]},
                    "summary": "Conditional route to the upper ring.",
                    "scope": {"kind": "condition", "statement": "while north corridor is open"},
                    "context_visibility": "always", "prompt_channel": "task_prompt",
                    "prompt_text": "ROUTE_SHOULD_STAY_OUT",
                    "basis_refs": ["observation:route@v1"],
                }},
            ],
            "decision": {"basis_refs": ["observation:controls@v1", "observation:route@v1"],
                         "reason": "Persist independently invalidatable controls and route.",
                         "expected": "The parent can select either atom without loading the other."},
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["memory:control-mapping@v1"],
            "prompt_contributions": [],
            "decision": {"basis_refs": ["observation:controls@v1"],
                         "reason": "Only the control mapping is needed for the next decision.",
                         "expected": "The next context includes controls and omits the route."},
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    memories = records(root, "task-memory.jsonl")
    assert [item["key"] for item in memories] == ["control-mapping", "route-to-ring"]
    assert memories[0]["atom"]["predicate"] == "action_mapping"
    assert memories[1]["atom"]["predicate"] == "planned_route"

    inspections = [json.loads(item["result"]["content"][0]["text"])
                   for item in results(events, "task_harness") if not item.get("isError")]
    before_assembly = inspections[1]
    assert before_assembly["current_assembly"] is None
    assert not any(item["selected"] for item in before_assembly["component_pool"])
    assert {item["atom"]["predicate"] for item in before_assembly["component_pool"]
            if item["kind"] == "memory"} == {"action_mapping", "planned_route"}

    context_text = json.dumps(records(root, "provider-contexts.jsonl")[-1]["context"])
    assert "Verified controls: ACTION1=up; ACTION2=down." in context_text
    assert "ROUTE_SHOULD_STAY_OUT" not in context_text
    assembly = records(root, "task-harness-assemblies.jsonl")[-1]
    assert assembly["selected_resource_refs"] == ["memory:control-mapping@v1"]


def test_atomic_memory_revision_does_not_rewrite_other_atoms(tmp_path):
    root = tmp_path / "atomic-memory-revision"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [
                {"operation": "create", "candidate": {"semantic_kind": "fact", "name": "controls",
                    "atom": {"subject": "controls", "predicate": "action_mapping", "value": {"ACTION1": "up"}}}},
                {"operation": "create", "candidate": {"semantic_kind": "fact", "name": "tile-lattice",
                    "atom": {"subject": "level-1 grid", "predicate": "tile_size", "value": 5}}},
            ], "decision": {"basis_refs": [], "reason": "Create separate facts.",
                            "expected": "Each fact has an independent version chain."}}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "update", "candidate": {
                "semantic_kind": "fact", "name": "controls",
                "atom": {"subject": "controls", "predicate": "action_mapping",
                         "value": {"ACTION1": "up", "ACTION2": "down"}}}}],
            "decision": {"basis_refs": [], "reason": "Extend only the control mapping.",
                         "expected": "The tile lattice keeps its original version."}}},
    ])
    assert not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")]
    memories = records(root, "task-memory.jsonl")
    assert [(item["key"], item["version"]) for item in memories] == [
        ("controls", 1), ("tile-lattice", 1), ("controls", 2),
    ]


def test_atomic_memory_revision_keeps_subject_and_predicate_identity(tmp_path):
    root = tmp_path / "atomic-memory-identity"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "fact", "name": "controls",
                "atom": {"subject": "controls", "predicate": "action_mapping", "value": {"ACTION1": "up"}}}}],
            "decision": {"basis_refs": [], "reason": "Create one control atom.",
                         "expected": "Its identity is stable across revisions."}}},
        {"name": "task_harness", "arguments": {
            "action": "change", "changes": [{"operation": "update", "candidate": {
                "semantic_kind": "fact", "name": "controls",
                "atom": {"subject": "goal", "predicate": "target", "value": "vault"}}}],
            "decision": {"basis_refs": [], "reason": "Attempt to reuse the key for another subject.",
                         "expected": "The write is rejected before a new version is stored."}}},
    ])
    output = results(events, "task_harness")[-1]
    receipt = json.loads(output["result"]["content"][0]["text"])
    assert receipt["status"] == "failed"
    assert "cannot change subject or predicate" in json.dumps(receipt)
    assert [(item["key"], item["version"]) for item in records(root, "task-memory.jsonl")] == [("controls", 1)]


def test_facade_rejects_non_atomic_fact_memory(tmp_path):
    root = tmp_path / "reject-compound-memory"
    events = _run_fixture(root, "treatment", steps=[{"name": "task_harness", "arguments": {
        "action": "change", "changes": [{"operation": "create", "candidate": {
            "semantic_kind": "fact", "name": "whole-level-note",
            "content": "position, controls, target and remaining route",
        }}],
        "decision": {"basis_refs": [], "reason": "Attempt a compound memory.",
                     "expected": "The deterministic boundary rejects it."},
    }}])
    output = results(events, "task_harness")[0]
    assert output.get("isError")
    assert "atom={subject,predicate,value}" in output["result"]["content"][0]["text"]


def test_prompt_contribution_cannot_bypass_component_selection(tmp_path):
    root = tmp_path / "prompt-source-selection"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {"action": "create", "name": "route-check",
                                                "instructions": "Check the destination."}},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [],
            "prompt_contributions": [{"contribution_id": "bypass", "source_ref": "skill:route-check@v1",
                                      "layer": "method", "content": "Use the unselected skill."}],
            "decision": {"basis_refs": [], "reason": "Attempt an invalid composition.",
                         "expected": "The runtime rejects an unselected component source."},
        }},
    ])
    output = results(events, "task_harness")[-1]
    assert output.get("isError")
    assert "must also be selected" in output["result"]["content"][0]["text"]


def test_assembly_revision_conflict_does_not_replace_current_selection(tmp_path):
    root = tmp_path / "assembly-version-conflict"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Start with no optional components.",
                         "expected": "Only the base runtime remains assembled."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Stale replacement attempt.",
                         "expected": "The runtime reports a conflict."},
        }},
    ])
    outputs = results(events, "task_harness")
    assert not outputs[0].get("isError")
    assert outputs[1].get("isError")
    body = json.loads(outputs[1]["result"]["content"][0]["text"])
    assert body["format"] == "task-harness-assembly-version-conflict-v1"
    assert body["current_revision"] == 1
    assert len(records(root, "task-harness-assemblies.jsonl")) == 1


def test_task_prompt_accepts_exact_research_plan_source(tmp_path):
    root = tmp_path / "assembly-research-plan-source"
    _run_fixture(root, "treatment", steps=[])
    scope_record = records(root, "task-harness-entry.jsonl")[0]
    scope = {key: scope_record[key] for key in ("task_id", "task_root_fingerprint") if key in scope_record}
    with (root / "auto-research-plans.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            **scope, "format": "auto-research-plan-v1", "plan_id": "research-plan-1",
            "version": 1, "status": "active", "nodes": [],
        }) + "\n")
    _run_fixture(root, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [],
            "prompt_contributions": [{
                "contribution_id": "next-probe-plan",
                "source_ref": "research_plan:research-plan-1@v1",
                "layer": "working_plan", "content": "Compare the two probe outcomes before acting.",
            }],
            "decision": {"basis_refs": ["research_plan:research-plan-1@v1"],
                         "reason": "The current decision needs the bounded research plan.",
                         "expected": "The working plan is present in the next request."},
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    text = json.dumps(records(root, "provider-contexts.jsonl")[-1]["context"]["messages"])
    assert "Active task-prompt working plan" in text
    assert "Compare the two probe outcomes before acting." in text
    receipt = records(root, "task-prompt-assemblies.jsonl")[-1]
    selected = next(item for item in receipt["selected"] if item.get("contribution_id") == "next-probe-plan")
    assert selected["source_ref"] == "research_plan:research-plan-1@v1"


def test_assembly_enforces_system_prompt_skill_and_dynamic_tool_use_boundaries(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "assembly-use-boundaries"
    beta_path = root / "task-harness" / "skills" / "beta" / "SKILL.md"
    events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_task_tool_fixture.ts"],
        steps=[
            {"name": "task_system_prompt", "arguments": {
                "action": "create", "name": "selected-overlay", "content": "SELECTED_OVERLAY",
            }},
            {"name": "task_system_prompt", "arguments": {
                "action": "create", "name": "pool-only-overlay", "content": "POOL_ONLY_OVERLAY",
            }},
            {"name": "task_skill", "arguments": {
                "action": "create", "name": "alpha", "instructions": "Use alpha.",
            }},
            {"name": "task_skill", "arguments": {
                "action": "create", "name": "beta", "instructions": "Use beta.",
            }},
            {"name": "task_tool", "arguments": {
                "action": "create", "name": "alpha", "description": "Selected echo.",
                "input_schema": {"type": "object"}, "implementation_ref": "fixture.echo",
            }},
            {"name": "task_tool", "arguments": {
                "action": "create", "name": "beta", "description": "Pool-only echo.",
                "input_schema": {"type": "object"}, "implementation_ref": "fixture.echo",
            }},
            {"name": "task_harness", "arguments": {
                "action": "assemble", "expected_assembly_revision": 0,
                "selected_resource_refs": [
                    "system_prompt:selected-overlay@v1", "skill:alpha@v1", "tool:alpha@v1",
                ],
                "prompt_contributions": [],
                "decision": {"basis_refs": [], "reason": "Use only alpha resources now.",
                             "expected": "Pool-only resources are not exposed or callable."},
            }},
            {"name": "read", "arguments": {"path": str(beta_path)}},
            {"name": "task_harness", "arguments": {"action": "inspect"}},
        ],
    )
    read_result = results(events, "read")[-1]
    assert read_result.get("isError")
    assert "not selected" in read_result["result"]["content"][0]["text"]
    _run_fixture(
        root, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}],
        extra_extensions=[project / "tests" / "pi_task_tool_fixture.ts"],
    )
    context = records(root, "provider-contexts.jsonl")[-1]["context"]
    assert "SELECTED_OVERLAY" in context["systemPrompt"]
    assert "POOL_ONLY_OVERLAY" not in context["systemPrompt"]
    tool_names = {tool["name"] for tool in context["tools"]}
    assert "task_tool_alpha_v1" in tool_names
    assert "task_tool_beta_v1" not in tool_names


def test_assembly_rejects_unselected_saved_subagent_before_invocation(tmp_path):
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "assembly-subagent-boundary"
    events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[
            {"name": "task_subagent", "arguments": {
                "action": "create", "name": "pool-only-reader",
                "description": "Read public fixture state.",
                "instructions": "Return a concise observation.", "tools": ["fixture_state"],
            }},
            {"name": "task_harness", "arguments": {
                "action": "assemble", "expected_assembly_revision": 0,
                "selected_resource_refs": [], "prompt_contributions": [],
                "decision": {"basis_refs": [], "reason": "No saved role is needed now.",
                             "expected": "Saved roles remain unavailable."},
            }},
            {"name": "delegate_task", "arguments": {
                "agent_name": "pool-only-reader", "task": "Inspect public state.",
            }},
        ],
    )
    delegated = results(events, "delegate_task")[-1]
    assert delegated.get("isError")
    assert "not selected" in delegated["result"]["content"][0]["text"]
    assert not records(root, "subagent-invocations.jsonl")


def test_direct_skill_research_revision_projects_next_request_without_native_loader(tmp_path):
    root = tmp_path / "lifecycle"
    path = root / "task-harness" / "skills" / "probe" / "SKILL.md"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {"action": "create", "name": "probe", "instructions": "Predict before probing."}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:probe@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the probe skill.",
                         "expected": "The skill can be read on the next step."}}},
        {"name": "read", "arguments": {"path": str(path)}},
        {"name": "benchmark_probe", "arguments": {"progressed": False}},
        {"name": "research_resource", "arguments": {"action": "open", "question": "Does the trial method distinguish explanations?", "evidence_to_seek": "A contrasting prediction", "subject_kind": "component", "hypothesis": "Comparing predictions reduces ambiguous probes.", "subject_refs": ["skill:probe@v1"], "component_refs": ["skill:probe@v1"]}},
        {"name": "task_skill", "arguments": {"action": "update", "name": "probe", "target_version": 1, "instructions": "Compare competing predictions before probing.", "basis_refs": ["finding-1"]}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 1,
            "selected_resource_refs": ["skill:probe@v2"], "prompt_contributions": [],
            "decision": {"basis_refs": ["finding-1"], "reason": "Select the revised skill version.",
                         "expected": "Later requests use only the revised procedure."}}},
        {"name": "benchmark_probe", "arguments": {"progressed": True}},
        {"name": "assess_harness_effect", "arguments": {"decision_id": "decision-2", "observation_refs": ["execution-observation-2"], "verdict": "inconclusive", "consequence": "Progress observed, attribution remains uncertain."}},
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    projected = [m for context in contexts for m in context["messages"]
                 if "Active task-local skills" in json.dumps(m) and "skill:probe@v2" in json.dumps(m)]
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


def test_effect_assessment_binds_unique_exposed_decision_and_observations(tmp_path):
    root = tmp_path / "assessment-binding"
    path = root / "task-harness" / "skills" / "probe" / "SKILL.md"
    events = _run_fixture(root, "treatment", steps=[
        {"name": "task_skill", "arguments": {"action": "create", "name": "probe", "instructions": "Inspect once."}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:probe@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the skill for one read.",
                         "expected": "The read is bound to the exact selected version."}}},
        {"name": "read", "arguments": {"path": str(path)}},
        {"name": "task_harness", "arguments": {
            "action": "assess_effect", "verdict": "inconclusive",
            "consequence": "Keep observing before revising the skill.",
        }},
    ])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assessment = records(root, "effect-assessments.jsonl")[0]
    assert assessment["decision_id"] == "decision-1"
    assert assessment["observation_refs"] == ["skill-projection-decision-1", "skill-read-decision-1"]


def test_adopt_research_applies_all_ready_routes_without_parent_route_fields(tmp_path):
    root = tmp_path / "adopt-research"
    root.mkdir()
    route = {
        "format": "auto-research-harness-route-v1",
        "route_id": "auto-research-1:route-fact",
        "route_ref": "harness_route:auto-research-1:route-fact@v1",
        "version": 1,
        "run_id": "auto-research-1",
        "delivery_id": "fact",
        "delivery_hash": "sha256:test",
        "approval_ref": "proposal:auto-research-1:proposal-1@v1",
        "review_status": "approved",
        "disposition": "materialize",
        "route_status": "ready",
        "steps": [{
            "step_id": "auto-research-1:route-fact:step-1", "order": 1,
            "target": "memory", "native_tool": "task_memory", "status": "ready", "depends_on": [],
            "native_call": {"name": "task_memory", "arguments": {
                "action": "upsert", "key": "research-fact", "content": "Keep the verified fact.",
                "routing_id": "auto-research-1:route-fact",
                "source_approval_ref": "proposal:auto-research-1:proposal-1@v1",
            }},
        }],
    }
    (root / "auto-research-harness-routes.jsonl").write_text(json.dumps(route) + "\n", encoding="utf-8")
    (root / "auto-research-sessions.jsonl").write_text(json.dumps({
        "session_id": "research-session-1", "version": 2, "status": "completed",
        "run_id": "auto-research-1", "reconciliation_status": "awaiting_parent_change",
    }) + "\n", encoding="utf-8")
    events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "adopt_research", "research_run_ref": "research_run:auto-research-1@v1",
        },
    }])
    result = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness")
    assert result.get("isError") is not True
    body = json.loads(result["result"]["content"][0]["text"])
    assert body["status"] == "adopted"
    assert records(root, "task-memory.jsonl")[-1]["key"] == "research-fact"
    assert records(root, "auto-research-harness-routes.jsonl")[-1]["route_status"] == "fulfilled"
    assert records(root, "auto-research-sessions.jsonl")[-1]["reconciliation_status"] == "adopted"


def test_adopt_research_preflights_all_route_versions_before_any_mutation(tmp_path):
    root = tmp_path / "adopt-research-preflight"
    _run_fixture(root, "treatment", steps=[
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "state", "content": "v1"}},
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "state", "target_version": 1, "content": "v2",
        }},
    ])
    current = records(root, "task-memory.jsonl")[-1]
    scope = {key: current[key] for key in ("task_id", "task_root_fingerprint") if key in current}
    route = {
        **scope,
        "format": "auto-research-harness-route-v1",
        "route_id": "auto-research-1:route-stale", "route_ref": "harness_route:auto-research-1:route-stale@v1",
        "version": 1, "run_id": "auto-research-1", "delivery_id": "stale", "delivery_hash": "sha256:stale",
        "approval_ref": "proposal:auto-research-1:proposal-1@v1", "review_status": "approved",
        "disposition": "materialize", "route_status": "ready",
        "steps": [
            {
                "step_id": "auto-research-1:route-stale:step-1", "order": 1, "target": "skill",
                "native_tool": "task_skill", "status": "ready", "depends_on": [],
                "native_call": {"name": "task_skill", "arguments": {
                    "action": "create", "name": "must-not-partially-apply", "instructions": "Never partially apply.",
                    "routing_id": "auto-research-1:route-stale",
                    "source_approval_ref": "proposal:auto-research-1:proposal-1@v1",
                }},
            },
            {
                "step_id": "auto-research-1:route-stale:step-2", "order": 2, "target": "memory",
                "native_tool": "task_memory", "status": "ready",
                "depends_on": ["auto-research-1:route-stale:step-1"],
                "native_call": {"name": "task_memory", "arguments": {
                    "action": "upsert", "key": "state", "target_version": 1, "content": "stale overwrite",
                    "routing_id": "auto-research-1:route-stale",
                    "source_approval_ref": "proposal:auto-research-1:proposal-1@v1",
                }},
            },
        ],
    }
    with (root / "auto-research-harness-routes.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(route) + "\n")
    with (root / "auto-research-sessions.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            **scope, "session_id": "research-session-1", "version": 1, "status": "completed",
            "run_id": "auto-research-1", "reconciliation_status": "awaiting_parent_change",
        }) + "\n")

    events = _run_fixture(root, "treatment", steps=[{
        "name": "task_harness", "arguments": {
            "action": "adopt_research", "research_run_ref": "research_run:auto-research-1@v1",
        },
    }])
    output = results(events, "task_harness")[-1]
    assert output.get("isError")
    assert not records(root, "task-skills.jsonl")
    memories = records(root, "task-memory.jsonl")
    assert len(memories) == 2 and memories[-1]["content"] == "v2"
    latest_route = records(root, "auto-research-harness-routes.jsonl")[-1]
    assert latest_route["route_status"] == "failed"
    assert latest_route["step_results"][0]["reason"] == "component_version_conflict"
    assert latest_route["step_results"][0]["current_version"] == 2


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
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:alpha@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select alpha for the next request.",
                         "expected": "Only alpha enters the active Harness."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "focus", "resource_refs": ["skill:alpha@v1"],
        }},
    ])
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    focused = [message for message in contexts[4]["messages"] if "Active task-local skills" in json.dumps(message)]
    assert len(focused) == 1
    assert "alpha" in json.dumps(focused[0])
    assert "beta" not in json.dumps(focused[0])


def test_new_assembly_clears_focus_from_the_previous_assembly(tmp_path):
    root = tmp_path / "assembly-clears-focus"
    events = _run_fixture(root, "treatment", arc_compact=True, steps=[
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "alpha", "instructions": "Use alpha.",
        }},
        {"name": "task_skill", "arguments": {
            "action": "create", "name": "beta", "instructions": "Use beta.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:alpha@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select alpha.",
                         "expected": "Only alpha is selected."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "focus", "resource_refs": ["skill:alpha@v1"],
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 1,
            "selected_resource_refs": ["skill:beta@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Switch to beta.",
                         "expected": "The old alpha focus cannot hide beta."},
        }},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    contexts = [item["context"] for item in records(root, "provider-contexts.jsonl")]
    selected = [message for message in contexts[5]["messages"]
                if "Active task-local skills" in json.dumps(message)]
    assert len(selected) == 1
    assert "beta" in json.dumps(selected[0])
    assert "alpha" not in json.dumps(selected[0])
    status = results(events, "task_harness")[-1]
    assert json.loads(status["result"]["content"][0]["text"])["focused_resource_refs"] is None


def test_compact_arc_focus_projects_memory_body_after_creation(tmp_path):
    root = tmp_path / "compact-memory"
    _run_fixture(root, "treatment", arc_compact=True,
        extra_extensions=[Path(__file__).resolve().parents[1] / 'tests/pi_non_arc_task_subagents.ts'], steps=[
        {"name": "task_memory", "arguments": {
            "action": "upsert", "key": "action-effects",
            "content": "Keep public common changes separate from action-specific changes.",
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["memory:action-effects@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the action-effects memory.",
                         "expected": "The focused body can enter the next request."},
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
    assert "AUTO-RESEARCH:" in contexts[0]["systemPrompt"]
    assert "full contract" not in contexts[0]["systemPrompt"]
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
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:probe-method@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the probe method.",
                         "expected": "The selected skill can be focused."},
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
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["system_prompt:review-rule@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the review rule.",
                         "expected": "The overlay enters the next request."},
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
            "action": "change",
            "changes": [{"operation": "create", "candidate": {
                "semantic_kind": "skill", "name": "probe",
                "content": "Use the settled observation before choosing the next action.",
            }}],
            "decision": {
                "basis_refs": [], "reason": "Create a reusable observation procedure.",
                "expected": "The procedure can be read and used on a later decision.",
            },
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["skill:probe@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": [], "reason": "Select the created procedure.",
                         "expected": "The selected skill can be read."},
        }},
        {"name": "task_harness", "arguments": {
            "action": "enable", "enabled_tools": ["skill"],
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
    # The initial ARC surface is only action, Harness and Auto-Research.
    # Creation goes through the Harness facade; enabling the selected skill
    # then exposes the scoped reader before its explicit read.
    initial_tools = {tool["name"] for tool in contexts[0]["tools"]}
    assert initial_tools >= {"arc_action", "task_harness", "auto_research"}
    assert not initial_tools.intersection({
        "arc_state", "inspect_arc_trajectory", "task_harness_status", "task_checkpoint",
        "task_resource", "task_validation", "research_resource", "delegate_task", "task_skill",
    })
    assert "read" in {tool["name"] for tool in contexts[3]["tools"]}
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
        "Self-harness review opportunity" in json.dumps(message)
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
