"""Capability authoring diagnostics; not real-provider quality acceptance."""
import json
import os
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]


def module_eval(module, expression):
    node, _ = _pi_cli()
    completed = subprocess.run([
        node, "--experimental-strip-types", "--input-type=module", "-e",
        f'import * as m from {json.dumps((PROJECT / "demo" / module).as_uri())};'
        f'console.log(JSON.stringify({expression}));',
    ], capture_output=True, text=True, env=os.environ.copy())
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_baseline_methods_are_discoverable_without_dynamic_components(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "methods"}},
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 2 and not any(e.get("isError") for e in outputs)
    catalog = json.loads(outputs[0]["result"]["content"][0]["text"])
    assert {m["name"] for m in catalog["methods"]} == {
        "skill-creator", "tool-creator", "subagent-creator", "research-orchestration"}
    body = outputs[1]["result"]["content"][0]["text"]
    assert "Running and evaluating test cases" in body
    assert "Pi runtime adaptation" in body
    assert not records(tmp_path, "task-skills.jsonl")
    context = records(tmp_path, "provider-contexts.jsonl")[0]["context"]
    assert "skill-creator" in json.dumps(context)
    assert "Running and evaluating test cases" not in json.dumps(context)
    assert records(tmp_path, "task-baseline-method-reads.jsonl")[0]["sha256"]


def test_baseline_reader_rejects_traversal_and_unknown_resources():
    result = module_eval("pi_harness_baseline_methods.ts", "(()=>{let failures=0; for(const resource of ['../SKILL.md','/etc/passwd','missing.md']) {try {m.readBaselineMethod('skill-creator',resource)} catch {failures++}} return failures})()")
    assert result == 3


def test_tool_creator_is_pi_native_and_excludes_mcp_server_guidance(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator"}},
        {"name": "task_harness", "arguments": {
            "action": "read_method", "method_name": "tool-creator",
            "method_resource": "references/pi-task-local-tool-contract.md"}},
    ])
    outputs = results(events, "task_harness")
    assert len(outputs) == 2 and not any(e.get("isError") for e in outputs)
    body = "\n".join(e["result"]["content"][0]["text"] for e in outputs)
    assert "pi.registerTool" in body
    assert "task_tool" in body and "task_harness" in body
    assert "MCP" not in body and "server.registerTool" not in body
    sources = json.loads((PROJECT / "demo" / "harness-methods" /
                          "tool-creator" / "SOURCES.json").read_text(encoding="utf-8"))
    assert sources["primary"]["package"] == "@earendil-works/pi-coding-agent"
    assert sources["primary"]["version"] == "0.80.6"


def test_pi_task_tool_creator_contract_requires_assembled_semantic_output(tmp_path):
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[PROJECT / "tests" / "pi_task_tool_fixture.ts"],
        steps=[
        {"name": "task_tool", "arguments": {
            "action": "create", "name": "state-selector",
            "description": "Select the state field from an input object.",
            "input_schema": {"type": "object"},
            "program": {"steps": [{"kind": "select", "fields": ["state"]}]},
        }},
        {"name": "task_harness", "arguments": {
            "action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": ["tool:state-selector@v1"],
            "prompt_contributions": [],
            "decision": {"basis_refs": [],
                         "reason": "Select the bounded computation for a semantic trial.",
                         "expected": "The selected tool returns only the state field."},
        }},
        {"name": "task_tool_state-selector_v1", "arguments": {
            "input": {"state": "RUNNING", "irrelevant": "discard"}}},
        ],
    )
    assert not results(events, "task_tool")[0].get("isError")
    assert not results(events, "task_harness")[0].get("isError")
    invocation = results(events, "task_tool_state-selector_v1")[0]
    assert not invocation.get("isError")
    assert json.loads(invocation["result"]["content"][0]["text"]) == {
        "state": "RUNNING"}
    event = records(tmp_path, "task-tool-events.jsonl")[-1]
    assert event["status"] == "completed"
    assert "RUNNING" in event["output_excerpt"]


def test_structured_skill_can_be_an_explicit_untested_candidate(tmp_path):
    method = {
        "problem": "Locate a controllable object in a new grid.",
        "inputs": ["two observations around a known directional action"],
        "invariants": ["the compared observations use the same grid coordinates"],
        "parameters": ["candidate component", "action direction"],
        "steps": ["compute changed groups", "compare signed displacement",
                  "retain candidates whose displacement matches the action"],
        "decision_points": ["whether exactly one candidate matches"],
        "stop_conditions": ["one candidate is retained or ambiguity is reported"],
        "failure_modes": ["animation or multiple moving objects remain ambiguous"],
        "construction_evidence_refs": [],
        "contrast_evidence_refs": [],
        "next_use": "when self location is required in an unseen level",
        "predicted_semantic_result": "a candidate object plus uncertainty",
        "falsifier": "a known action moves a different object consistently",
    }
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_skill", "arguments": {
            "action": "create", "name": "identify-controlled-object",
            "description": "Identify the likely controlled object from action deltas.",
            "instructions": "Compare action-aligned displacement; retain ambiguity.",
            "method": method,
        }}])
    output = results(events, "task_skill")[0]
    assert not output.get("isError")
    skill = records(tmp_path, "task-skills.jsonl")[-1]
    assert skill["method"]["construction_evidence_refs"] == []
    assert skill["authoring_status"] == "structured_untested_candidate"


def test_memory_validity_expires_level_and_dependents_not_task_memory():
    result = module_eval("pi_task_knowledge_lifecycle.ts", """(()=>{
      const ctx={task:'task-a',episode:'episode-a',level:'level-2',state:'obs-5'};
      const map={key:'map',version:1,status:'active',validity:{scope:'level',instance_ref:'level-1',task_ref:'task-a'}};
      const controls={key:'controls',version:1,status:'active',validity:{scope:'task',instance_ref:'task-a',task_ref:'task-a'}};
      const skill={name:'route',version:1,status:'active',depends_on_refs:['memory:map@v1']};
      const state=m.knowledgeState([{kind:'memory',record:map},{kind:'memory',record:controls},{kind:'skill',record:skill}],ctx);
      return {map:state.eligible('memory',map),controls:state.eligible('memory',controls),skill:state.eligible('skill',skill),reason:state.reasons('memory',map),historical:state.resolve('memory:map@v1').record.status};
    })()""")
    assert result["map"] is False and result["skill"] is False
    assert result["controls"] is True and result["historical"] == "active"
    assert any("scope_expired" in r for r in result["reason"])


def test_validity_context_uses_successful_environment_boundaries_only():
    result = module_eval("pi_memory_validity.ts", """(()=>{
      const rows=[{observation_id:'o1',tool_name:'arc_action',input:{action:'ACTION1'},arc_outcome:{levels_completed:0}},
        {observation_id:'o2',tool_name:'arc_action',input:{action:'RESET'},is_error:true},
        {observation_id:'o3',tool_name:'arc_action',input:{action:'ACTION1'},arc_outcome:{levels_completed:1,public_transition:{level_changed:true,level_before:0,level_after:1}}}];
      const before=m.memoryValidityContext('task-a',rows.slice(0,1));
      const failed=m.memoryValidityContext('task-a',rows.slice(0,2));
      const after=m.memoryValidityContext('task-a',rows);
      return {same:before.level===failed.level,changed:before.level!==after.level,episode:before.episode===after.episode};
    })()""")
    assert result == {"same": True, "changed": True, "episode": True}


def test_pure_reasoning_subagent_can_have_explicit_empty_tools(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[{
        "name": "task_subagent", "arguments": {
            "action": "create", "name": "independent-planner", "tools": [],
            "description": "Use for a clean-context plan from selected facts.",
            "instructions": "Compare candidate plans; return assumptions and counterexamples.",
            "context_recipe": {"include_checkpoint": False, "recent_observations": 0,
                "recent_actions": 0, "inherit_harness_refs": [], "output_contract": "plan and uncertainty"},
        }}], extra_extensions=[PROJECT / "tests/pi_non_arc_task_subagents.ts"])
    assert not results(events, "task_subagent")[-1].get("isError")
    row = records(tmp_path, "task-subagents.jsonl")[-1]
    assert row["tools"] == []
    assert row["context_recipe"]["include_checkpoint"] is False
