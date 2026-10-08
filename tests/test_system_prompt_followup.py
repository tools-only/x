"""System-prompt carrier and scoped parent-overlay diagnostics."""
import json
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import harness_delivery, records, results, run_router_helper

PROJECT = Path(__file__).resolve().parents[1]


def evaluate(module: str, expression: str, value: object):
    node, _ = _pi_cli()
    path = (PROJECT / "demo" / module).as_uri()
    script = f"import * as m from {json.dumps(path)}; console.log(JSON.stringify({expression}));"
    result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                            input=json.dumps(value), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_system_prompt_is_optional_explicit_carrier_without_creator():
    review = {"opportunity_id": "op-1", "review_id": "review-1",
              "transition_analysis": {"capability_opportunities": "A bounded level rule"},
              "entries": [{"component": "system_prompt", "disposition": "create",
                           "reason": "Keep a level decision rule salient."}]}
    followup = evaluate("pi_harness_capability_followup.ts",
                        f"m.capabilityFollowups({json.dumps([review])},[],[])[0]", None)
    assert "system_prompt" in followup["components"]
    candidate = next(item for item in followup["carrier_candidates"]
                     if item["component"] == "system_prompt")
    assert "creator_read_call" not in candidate
    assert candidate["create_call"]["tool"] == "task_harness_create"
    assert candidate["create_call"]["arguments"]["candidate"]["component"] == "system_prompt"
    assert "assemble_call" not in candidate
    assert "next provider request" in candidate["instruction"]
    assert "skill" in followup["components"]  # old optional followups remain


def test_compact_parent_cue_allows_first_use_development_and_direct_action(tmp_path):
    _run_fixture(tmp_path, "treatment", steps=[], arc_compact=True)
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    texts = [part["text"] for message in context["messages"]
             for part in message.get("content", []) if part.get("type") == "text"]
    index = next(text for text in texts if text.startswith("Task-local harness index:"))
    assert "task_harness_create" in index
    assert "You may save" in index and "Choose content" in index
    assert "assembly=false saves" in index
    assert "Apply Skill instructions already in context" in index


def test_capability_review_can_settle_explicit_system_prompt_without_four_carrier_table(tmp_path):
    (tmp_path / "task-harness-reviews.jsonl").write_text(json.dumps({
        "opportunity_id": "op-1", "review_id": "review-1",
        "transition_analysis": {"capability_opportunities": "A level decision rule", "evidence_refs": []},
        "entries": [{"component": "system_prompt", "disposition": "create",
                     "reason": "A short directive would help."}],
    }) + "\n", encoding="utf-8")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "contract", "schema_action": "review"}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
        {"name": "task_harness", "arguments": {"action": "capability_review", "opportunity_id": "op-1",
            "review": [{"component": "system_prompt", "disposition": "defer",
                        "reason": "Wait for a discriminating level observation."}]}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    outputs = [r for r in results(events, "task_harness") if r['args']['action'] != 'contract']
    assert not any(output.get("isError") for output in outputs), outputs
    before = json.loads(outputs[0]["result"]["content"][0]["text"])
    after = json.loads(outputs[2]["result"]["content"][0]["text"])
    assert "system_prompt" in before["capability_followups"][0]["components"]
    assert "system_prompt" not in after["capability_followups"][0]["components"]
    decision = records(tmp_path, "task-capability-decisions.jsonl")[-1]
    assert next(e for e in decision["entries"] if e["component"] == "system_prompt")["disposition"] == "defer"


def test_level_scoped_parent_system_prompt_reaches_later_turn_and_expires(tmp_path):
    directive = "LEVEL_ROUTE_DIRECTIVE: compare the next click with the level goal."
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create",
            "candidate": {"component": "system_prompt", "name": "level-route", "content": directive,
                          "scope": "current level while route is untested", "validity": {"scope": "level"}}}],
            "decision": {"basis_refs": [], "reason": "Trial a level-scoped planning directive.",
                         "expected": "The next parent turn receives the selected overlay."}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["system_prompt:level-route@v1"], "prompt_contributions": [],
            "decision": {"basis_refs": ["system_prompt:level-route@v1"],
                         "reason": "Select the level directive for this trial.",
                         "expected": "The next parent request sees it."}}},
        {"name": "benchmark_probe", "arguments": {}},
    ])
    assert not any(item.get("isError") for item in results(events, "task_harness"))
    record = records(tmp_path, "task-system-prompt.jsonl")[-1]
    assert record["validity"]["scope"] == "level"
    assert not records(tmp_path, "task-baseline-method-reads.jsonl")
    # Pi assembles the overlay for a later parent turn, not mid-turn between
    # scripted tool calls from the same prompt.
    later = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "benchmark_probe", "arguments": {}},
    ])
    assert not any(item.get("isError") for item in results(later, "benchmark_probe"))
    contexts = records(tmp_path, "provider-contexts.jsonl")
    assert any(directive in row["context"]["systemPrompt"] for row in contexts)
    (tmp_path / "execution-observations.jsonl").open("a", encoding="utf-8").write(json.dumps({
        "observation_id": "execution-observation-level-change", "tool_name": "arc_action",
        "input": {"action": "ACTION6"},
        "arc_outcome": {"levels_completed": 1,
                        "public_transition": {"level_before": 0, "level_after": 1, "level_changed": True}},
    }) + "\n")
    resumed = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    assert not results(resumed, "task_harness")[-1].get("isError")
    latest = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["systemPrompt"]
    assert directive not in latest
    inspection = json.loads(results(resumed, "task_harness")[-1]["result"]["content"][0]["text"])
    entry = next(row for row in inspection["component_pool"] if row["resource_ref"] == "system_prompt:level-route@v1")
    assert not entry["eligible"]
    assert any("scope_expired:level" in reason for reason in entry["reasons"])


def test_unassembled_system_prompt_offers_later_parent_selection_then_projects_after_assembly(tmp_path):
    directive = "PARENT_POLICY_CAS_TRIAL: compare the next move with the working goal."
    created = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create",
            "candidate": {"component": "system_prompt", "name": "working-policy",
                          "content": directive, "scope": "current task",
                          "validity": {"scope": "task"}}}],
            "decision": {"basis_refs": [], "reason": "Try a parent-owned working policy.",
                         "expected": "It is available for explicit selection."}}},
    ])
    assert not any(item.get("isError") for item in results(created, "task_harness"))
    assert not records(tmp_path, "task-harness-assemblies.jsonl")

    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    assert directive not in context["systemPrompt"]
    notices = [part["text"] for message in context["messages"]
               for part in message.get("content", [])
               if part.get("text", "").startswith("Authored capabilities awaiting parent selection:")]
    assert len(notices) == 1
    notice = json.loads(notices[0].split(": ", 1)[1].split(". Each item", 1)[0])
    assert notice["unselected_counts"]["system_prompt"] == 1
    assert len(notice["recent"]) == 1
    readiness = notice["recent"][0]
    assert readiness["resource_ref"] == "system_prompt:working-policy@v1"
    selection = readiness["selection_call"]
    assert selection["tool"] == "task_harness"
    assert selection["arguments"]["expected_assembly_revision"] == 0
    assert selection["arguments"]["selected_resource_refs"] == ["system_prompt:working-policy@v1"]
    assert readiness["use_after_selection"]["effect"] == "Selected content is projected on the next provider request."

    assembled = _run_fixture(tmp_path, "treatment", steps=[
        {"name": selection["tool"], "arguments": selection["arguments"]},
    ])
    assert not any(item.get("isError") for item in results(assembled, "task_harness"))
    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    assert directive in context["systemPrompt"]
    assert not any(part.get("text", "").startswith("Authored capabilities awaiting parent selection:")
                   for message in context["messages"] for part in message.get("content", []))


def test_unassembled_memory_offers_selection_then_projects_on_later_turn(tmp_path):
    created = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "create",
            "candidate": {"component": "memory", "name": "route-fact",
                          "atom": {"subject": "route", "predicate": "visible", "value": "north"},
                          "validity": {"scope": "task"}}}],
            "decision": {"basis_refs": [], "reason": "Keep a scoped route observation.",
                         "expected": "The parent can select it for later context."}}},
    ])
    assert not any(item.get("isError") for item in results(created, "task_harness"))
    assert not records(tmp_path, "task-harness-assemblies.jsonl")
    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    texts = [part["text"] for message in context["messages"]
             for part in message.get("content", []) if part.get("type") == "text"]
    assert not any(text.startswith("Active task-local memory") for text in texts)
    notice = next(text for text in texts if text.startswith("Authored capabilities awaiting parent selection:"))
    payload = json.loads(notice.split(": ", 1)[1].split(". Each item", 1)[0])
    assert payload["unselected_counts"]["memory"] == 1
    item = payload["recent"][0]
    assert item["resource_ref"].startswith("memory:route-fact@v1")
    selection = item["selection_call"]
    assert selection["arguments"]["expected_assembly_revision"] == 0
    selected = _run_fixture(tmp_path, "treatment", steps=[
        {"name": selection["tool"], "arguments": selection["arguments"]},
    ])
    assert not any(item.get("isError") for item in results(selected, "task_harness"))
    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    texts = [part["text"] for message in context["messages"]
             for part in message.get("content", []) if part.get("type") == "text"]
    assert any(text.startswith("Active task-local memory") and '"key":"route-fact"' in text for text in texts)
    assert not any(text.startswith("Authored capabilities awaiting parent selection:") for text in texts)


def test_selection_notice_counts_all_kinds_when_recent_memories_fill_details(tmp_path):
    decision = {"basis_refs": [], "reason": "Keep scoped inputs available for a later choice.",
                "expected": "Unselected components remain discoverable."}
    initial = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "decision": decision,
            "changes": [{"operation": "create", "candidate": {"component": "system_prompt",
                         "name": "older-policy", "content": "Compare alternatives before committing.",
                         "scope": "current task", "validity": {"scope": "task"}}}]}},
    ])
    assert not any(item.get("isError") for item in results(initial, "task_harness"))
    memory_changes = [{"operation": "create", "candidate": {"component": "memory", "name": f"fact-{n}",
        "atom": {"subject": f"cell-{n}", "predicate": "visible", "value": n},
        "validity": {"scope": "task"}}} for n in range(6)]
    created = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "change", "decision": decision,
            "changes": memory_changes}},
    ])
    assert not any(item.get("isError") for item in results(created, "task_harness"))
    _run_fixture(tmp_path, "treatment", steps=[])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    notice = next(part["text"] for message in context["messages"]
                  for part in message.get("content", [])
                  if part.get("text", "").startswith("Authored capabilities awaiting parent selection:"))
    payload = json.loads(notice.split(": ", 1)[1].split(". Each item", 1)[0])
    assert payload["unselected_counts"] == {"memory": 6, "system_prompt": 1,
                                            "skill": 0, "tool": 0, "subagent": 0}
    assert len(payload["recent"]) == 5
    assert all(item["resource_ref"].startswith("memory:") for item in payload["recent"])
    assert payload["full_pool_call"] == {"tool": "task_harness", "arguments": {"action": "inspect", "section": "component_pool"}}


def test_parent_can_revise_exploratory_policy_into_selected_planning_policy(tmp_path):
    exploratory = "EXPLORE_POLICY: objective unknown; compare explanations through bounded probes."
    planning = "PLAN_POLICY: compare candidate routes against the working goal; reopen assumptions on failure."
    decision = {"basis_refs": [], "reason": "Parent chooses a provisional working policy.",
                "expected": "The explicitly selected policy reaches a later parent turn."}

    def change(operation, content):
        return {"name": "task_harness", "arguments": {"action": "change", "decision": decision,
                "changes": [{"operation": operation, "candidate": {
                    "component": "system_prompt", "name": "working-policy", "content": content,
                    "scope": "current task until contradicted", "validity": {"scope": "task"}}}]}}

    def select(revision, version):
        return {"name": "task_harness", "arguments": {"action": "assemble", "decision": decision,
                "expected_assembly_revision": revision, "prompt_contributions": [],
                "selected_resource_refs": [f"system_prompt:working-policy@v{version}"]}}

    first = _run_fixture(tmp_path, "treatment", steps=[change("create", exploratory), select(0, 1)])
    assert not any(e.get("isError") for e in results(first, "task_harness"))
    # No completed goal specification or research/creator precondition was supplied.
    _run_fixture(tmp_path, "treatment", steps=[])
    assert exploratory in records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["systemPrompt"]

    revised = _run_fixture(tmp_path, "treatment", steps=[change("update", planning), select(1, 2)])
    assert not any(e.get("isError") for e in results(revised, "task_harness"))
    _run_fixture(tmp_path, "treatment", steps=[])
    active_system = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["systemPrompt"]
    assert planning in active_system
    assert exploratory not in active_system
    versions = records(tmp_path, "task-system-prompt.jsonl")
    assert [(r["version"], r["content"]) for r in versions] == [(1, exploratory), (2, planning)]
    assert not records(tmp_path, "task-baseline-method-reads.jsonl")
    assert not records(tmp_path, "auto-research-sessions.jsonl")


def test_conditional_system_prompt_projection_keeps_explicit_basis():
    candidate = {"semantic_kind": "plan", "execution": "text", "prompt_channel": "system_prompt",
                 "context_visibility": "on_demand", "stability": "conditional",
                 "scope": {"kind": "condition", "statement": "current level while the route is untested"},
                 "basis_refs": ["observation:level-route@v1"],
                 "system_prompt_basis": {"source": "explicit_task_contract",
                                         "evidence_refs": ["observation:level-route@v1"]},
                 "atom": {"subject": "current route", "predicate": "try", "value": "compare alternatives"}}
    routed = evaluate("pi_harness_protocol.ts",
                      f"m.classifyHarnessChangeTargets({json.dumps(candidate)})", None)
    assert routed == ["memory", "system_prompt"]
    candidate["semantic_kind"] = "assessment"
    rejected = evaluate("pi_harness_protocol.ts",
                        f"(()=>{{try{{return m.classifyHarnessChangeTargets({json.dumps(candidate)})}}catch(error){{return String(error.message)}}}})()", None)
    assert "research_only" in rejected

    delivery = harness_delivery(
        "level-policy", "plan", "level-policy", "Compare the next click with the level goal.",
        scope={"kind": "condition", "statement": "current level while route is untested"},
        stability="conditional", context_visibility="on_demand",
        prompt_channel="system_prompt", prompt_operation="create",
        basis_refs=["observation:level-route@v1"],
        system_prompt_basis={"source": "explicit_task_contract",
                             "evidence_refs": ["observation:level-route@v1"]},
    )
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'run',approvalId:'proposal',approvalVersion:1,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:['task_memory','task_system_prompt']})",
        input_value=delivery,
    )
    assert [step["native_tool"] for step in plan["steps"]] == ["task_memory", "task_system_prompt"]
