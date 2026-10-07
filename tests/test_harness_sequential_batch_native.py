"""Native Pi batching preserves ordered composition and failed-write integrity."""
import json
from pathlib import Path

from test_arc_capability_surface_native import _run_arc_parent


def _create(name, instructions="State a prediction and revise it after observation."):
    return {"name": "task_harness_create", "arguments": {"candidate": {
        "component": "skill", "name": name, "description": "Compare one prediction with public evidence.", "instructions": instructions},
        "decision": {"basis_refs": [], "reason": "Trial a bounded procedure.", "expected": "A prediction informs the next action."}}}


def _assemble(name):
    return {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
        "selected_resource_refs": [f"skill:{name}@v1"], "prompt_contributions": [],
        "decision": {"basis_refs": [], "reason": "Select this exact newly created version.", "expected": "The procedure becomes readable."}}}


def _calls(events):
    return [e for e in events if e.get("type") == "tool_execution_end"]


def test_one_response_creates_then_assembles_despite_native_latency(tmp_path):
    project = Path(__file__).resolve().parents[1]
    path = tmp_path / "task-harness/skills/prediction-check/SKILL.md"
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        [_create("prediction-check"), _assemble("prediction-check")],
        {"name": "read", "arguments": {"path": str(path)}},
    ], extra_extensions=[project / "tests/pi_delayed_skill_mutation.ts"])
    calls = _calls(events)
    assert len(calls) == 4 and all(not e.get("isError") for e in calls), [e.get("result") for e in calls if e.get("isError")]
    assert "State a prediction" in calls[-1]["result"]["content"][0]["text"]
    contexts = [json.loads(l)["context"] for l in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(contexts) == 4  # read creator, two ordered calls, use, final.
    assert "read" in {t["name"] for t in contexts[2]["tools"]}


def test_failed_create_cannot_assemble_same_named_old_component_in_its_response(tmp_path):
    _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _create("collision"),
    ])
    events = _run_arc_parent(tmp_path, [[_create("collision", "NEW BODY MUST NOT REPLACE OLD"), _assemble("collision")]])
    calls = _calls(events)
    assert len(calls) == 2 and all(e.get("isError") for e in calls)
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()
    skills = [json.loads(l) for l in (tmp_path / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(skills) == 1 and skills[0]["version"] == 1
    # Integrity failure is local to the response, not a new permanent gate.
    recovered = _run_arc_parent(tmp_path, [_assemble("collision")])
    assert all(not e.get("isError") for e in _calls(recovered))


def test_failed_batch_blocks_action_and_recovers_in_next_native_parent_turn(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _create("same-session"),
        [_create("same-session"), _assemble("same-session"),
         {"name": "arc_action", "arguments": {"action": "ACTION1"}}],
        _assemble("same-session"),
    ])
    calls = _calls(events)
    assert [bool(e.get("isError")) for e in calls] == [False, False, True, True, True, False]
    failure = json.dumps(calls[4]["result"])
    assert "Earlier Harness mutation" in failure  # Never contacted the fixture bridge.
    assemblies = [json.loads(l) for l in (tmp_path / "task-harness-assemblies.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(assemblies) == 1 and assemblies[0]["selected_resource_refs"] == ["skill:same-session@v1"]


def test_ordered_creation_does_not_bypass_assembly_cas(tmp_path):
    stale = _assemble("cas-check")
    stale["arguments"]["expected_assembly_revision"] = 3
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        [_create("cas-check"), stale],
        _assemble("cas-check"),
    ])
    calls = _calls(events)
    assert [bool(e.get("isError")) for e in calls] == [False, False, True, False]
    assert "revision" in json.dumps(calls[2]["result"]).lower()
    skills = [json.loads(l) for l in (tmp_path / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(skills) == 1  # Successful creation survives the separate CAS failure.


def test_failed_checkpoint_write_blocks_same_response_action_and_recovers(tmp_path):
    events = _run_arc_parent(tmp_path, [
        [{"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": "MUST NOT COMMIT",
             "consumed_result_refs": ["tool_result:missing@v1"]}},
         {"name": "arc_action", "arguments": {"action": "ACTION1"}}],
        {"name": "task_checkpoint", "arguments": {"action": "update", "working_summary": "Recovery preserves a valid interpretation"}},
    ])
    calls = _calls(events)
    assert [bool(c.get("isError")) for c in calls] == [True, True, False]
    assert "Earlier Harness mutation" in json.dumps(calls[1]["result"])
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["working_summary"] == "Recovery preserves a valid interpretation"
    assert not (tmp_path / "bridge-events.jsonl").exists()


def test_conflicting_publication_trials_block_same_response_action_only(tmp_path):
    from test_pure_publication_trial_native import top_level_publication

    request = top_level_publication()
    old = json.loads(json.dumps(request["arguments"]["trial"]))
    old["parameters"]["expected"] = 3
    request["arguments"]["candidate"]["trial"] = old
    events = _run_arc_parent(tmp_path, [
        {"name":"task_harness", "arguments":{"action":"read_method", "method_name":"tool-creator"}},
        [request, {"name":"arc_action", "arguments":{"action":"ACTION1"}}],
        {"name":"task_checkpoint", "arguments":{"action":"update", "working_summary":"Repair the conflicting publication call."}},
    ])
    calls = _calls(events)
    assert [bool(c.get("isError")) for c in calls] == [False, True, True, False]
    assert json.loads(calls[1]["result"]["content"][0]["text"])["no_component_written"] is True
    assert "Earlier Harness mutation" in json.dumps(calls[2]["result"])
    assert not (tmp_path / "task-tools.jsonl").exists()
    assert not (tmp_path / "bridge-events.jsonl").exists()
