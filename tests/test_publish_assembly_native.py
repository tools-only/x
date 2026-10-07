"""One explicit parent call can write and select its own exact new versions."""
import json
from pathlib import Path
import pytest

from test_arc_capability_surface_native import _run_arc_parent
from test_harness_sequential_batch_native import _create
from test_harness_capability_authoring import module_eval


def _publish(name, revision=0, selected=()):
    call = _create(name)
    call["arguments"]["assembly"] = {"expected_assembly_revision": revision, "selected_resource_refs": list(selected)}
    return call


def _calls(events):
    return [e for e in events if e.get("type") == "tool_execution_end"]


def test_explicit_publish_selects_new_version_and_exposes_real_reader(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _publish("combined-trial"),
        {"name": "read", "arguments": {"path": str(tmp_path / "task-harness/skills/combined-trial/SKILL.md")}},
    ])
    calls = _calls(events)
    assert len(calls) == 3 and all(not e.get("isError") for e in calls)
    receipt = json.loads(calls[1]["result"]["content"][0]["text"])
    assert receipt["assembly_receipt"]["applied"] is True
    assert receipt["assembly_receipt"]["current_assembly"]["selected_resource_refs"] == ["skill:combined-trial@v1"]
    assert "State a prediction" in calls[-1]["result"]["content"][0]["text"]


def test_wrong_revision_is_rejected_before_component_write(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _publish("bad-revision", revision=8),
    ])
    assert _calls(events)[-1].get("isError")
    assert not (tmp_path / "task-skills.jsonl").exists()
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()


def test_group_publication_preserves_parent_listed_existing_selection(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _publish("retained"),
        {"name": "task_harness", "arguments": {"action": "change", "changes": [
            {"operation": "create", "candidate": {"component": "memory", "name": "scoped-fact", "atom": {"subject": "trial", "predicate": "has", "value": "public evidence"}, "content": "Public evidence is provisional.", "validity": {"scope": "task"}}},
            {"operation": "create", "candidate": {"component": "system_prompt", "name": "check-policy", "content": "Check predictions against public observations.", "scope": "this task"}},
        ], "decision": {"basis_refs": [], "reason": "Compose new knowledge with the retained method.", "expected": "Keep three exact selected versions."},
            "assembly": {"expected_assembly_revision": 1, "selected_resource_refs": ["skill:retained@v1"]}}},
    ])
    assert all(not e.get("isError") for e in _calls(events))
    receipt = json.loads(_calls(events)[-1]["result"]["content"][0]["text"])
    selected = receipt["assembly_receipt"]["current_assembly"]["selected_resource_refs"]
    assert set(selected) == {"skill:retained@v1", "memory:scoped-fact@v1", "system_prompt:check-policy@v1"}
    assert "assemble_template" not in receipt["activation"]
    assert all(e["selection_call"] is None for e in receipt["activation"]["created_resources"])


def test_no_creator_or_failed_native_write_cannot_apply_assembly(tmp_path):
    events = _run_arc_parent(tmp_path, [_publish("unprepared")])
    assert _calls(events)[0].get("isError")
    assert not (tmp_path / "task-skills.jsonl").exists()
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _create("collision"), _publish("collision"),
    ])
    assert _calls(events)[-1].get("isError")
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()


def test_selection_failure_retains_written_update_for_separate_repair(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _publish("updated"),
        {"name": "task_harness", "arguments": {"action": "change", "changes": [{"operation": "update", "candidate": {
            "component": "skill", "name": "updated", "target_version": 1, "description": "Revised method.", "instructions": "Preserve counterevidence."}}],
            "decision": {"basis_refs": [], "reason": "Write v2 while detecting an obsolete retained v1.", "expected": "A failure must not erase the successful write."},
            "assembly": {"expected_assembly_revision": 1, "selected_resource_refs": ["skill:updated@v1"]}}},
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 1,
            "selected_resource_refs": ["skill:updated@v2"], "decision": {"basis_refs": [], "reason": "Select the already written repair.", "expected": "Do not rewrite v2."}}},
    ])
    calls = _calls(events)
    assert [bool(c.get("isError")) for c in calls] == [False,False,True,False]
    failed = json.loads(calls[2]["result"]["content"][0]["text"])
    assert failed["status"] == "applied" and not failed["assembly_receipt"]["applied"]
    skills = [json.loads(l) for l in (tmp_path / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [s["version"] for s in skills] == [1,2]


@pytest.mark.parametrize("assembly", [None, {}, {"expected_assembly_revision": 0},
    {"expected_assembly_revision": 0, "selected_resource_refs": ["skill:missing@v1"]},
    {"expected_assembly_revision": 0, "selected_resource_refs": [], "prompt_contributions": [{}]}])
def test_malformed_or_unresolvable_publication_rejected_before_write(tmp_path, assembly):
    call = _publish("must-not-write")
    call["arguments"]["assembly"] = assembly
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}}, call,
    ])
    assert _calls(events)[-1].get("isError")
    assert not (tmp_path / "task-skills.jsonl").exists()
    assert not (tmp_path / "task-harness-assemblies.jsonl").exists()


def test_partial_publication_failure_blocks_same_response_action_then_repairs(tmp_path):
    update = {"name": "task_harness", "arguments": {"action": "change", "changes": [{
        "operation": "update", "candidate": {"component": "skill", "name": "partial", "target_version": 1,
            "description": "Revised prediction check.", "instructions": "Compare a counterexample."}}],
        "decision": {"basis_refs": [], "reason": "Try an update with an obsolete retained ref.", "expected": "Repair selection without rewriting."},
        "assembly": {"expected_assembly_revision": 1, "selected_resource_refs": ["skill:partial@v1"]}}}
    events = _run_arc_parent(tmp_path, [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        _publish("partial"), [update, {"name": "arc_action", "arguments": {"action": "ACTION1"}}],
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 1,
            "selected_resource_refs": ["skill:partial@v2"],
            "decision": {"basis_refs": [], "reason": "Select the already written v2.", "expected": "No repeated authoring."}}},
    ])
    calls = _calls(events)
    assert [bool(c.get("isError")) for c in calls] == [False, False, True, True, False]
    assert "Earlier Harness mutation" in json.dumps(calls[3]["result"])  # no fixture bridge contact
    rows = [json.loads(l) for l in (tmp_path / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["version"] for r in rows] == [1, 2]


def test_native_partial_failure_blocks_same_response_selection_and_repairs_only_unwritten_candidate(tmp_path):
    memory = {'component': 'memory', 'name': 'retained-fact',
              'atom': {'subject': 'diagnostic', 'predicate': 'records', 'value': 'provisional'},
              'validity': {'scope': 'task'}}
    skill = _create('late-failure')['arguments']['candidate']
    decision = {'basis_refs': [], 'reason': 'Preserve the first committed version if native execution fails.',
                'expected': 'Repair only the unwritten component.'}
    change = {'name': 'task_harness', 'arguments': {'action': 'change',
              'changes': [{'operation': 'create', 'candidate': candidate} for candidate in [memory, skill]],
              'decision': decision}}
    select = {'name': 'task_harness', 'arguments': {'action': 'assemble',
              'expected_assembly_revision': 0, 'selected_resource_refs': ['memory:retained-fact@v1'],
              'decision': decision}}
    repair = {'name': 'task_harness', 'arguments': {'action': 'change',
              'changes': [{'operation': 'create', 'candidate': skill}], 'decision': decision}}
    events = _run_arc_parent(tmp_path, [
        {'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'skill-creator'}},
        [change, select], repair,
        {'name': 'task_harness', 'arguments': {**select['arguments'],
            'selected_resource_refs': ['memory:retained-fact@v1', 'skill:late-failure@v1']}},
    ], extra_extensions=[Path(__file__).resolve().parents[1] / 'tests/pi_failed_skill_mutation.ts'])
    calls = _calls(events)
    assert calls[1].get('isError'), calls[1]
    assert calls[2].get('isError') and 'Earlier Harness mutation' in json.dumps(calls[2]['result'])
    assert not any(call.get('isError') for call in calls[3:]), calls
    failure = calls[1]['result']['details']
    assert failure['status'] == 'failed'
    assert failure['results'][0]['resource']['resource_ref'] == 'memory:retained-fact@v1'
    assert failure['partial_applied'] is True
    assert failure['applied_resource_refs'] == ['memory:retained-fact@v1']
    assert failure['remaining_changes'] == [{'operation': 'create', 'candidate': skill}]
    contexts = [json.loads(line)['context'] for line in
                (tmp_path / 'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    messages = contexts[2]['messages']
    error_message = next(message for message in messages
                         if message.get('role') == 'toolResult' and message.get('toolCallId') == calls[1]['toolCallId'])
    projected = json.loads(error_message['content'][0]['text'])
    assert projected['applied_resource_refs'] == ['memory:retained-fact@v1']
    assert projected['remaining_change_count'] == 1
    assert projected['remaining_change_targets'][0]['name'] == 'late-failure'
    assert projected['recovery_read']['arguments']['ref'].startswith('failure:')
    for filename in ['task-memory.jsonl', 'task-skills.jsonl', 'task-harness-assemblies.jsonl']:
        assert len((tmp_path / filename).read_text(encoding='utf-8').splitlines()) == 1, filename


def test_revision_changes_during_native_await_keep_written_version_without_automatic_reselection(tmp_path):
    events = _run_arc_parent(tmp_path, [
        {'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'skill-creator'}},
        _publish('retained-before-race'),
        _publish('cas-race', revision=1, selected=['skill:retained-before-race@v1']),
        {'name': 'task_harness', 'arguments': {'action': 'assemble', 'expected_assembly_revision': 2,
            'selected_resource_refs': ['skill:retained-before-race@v1', 'skill:cas-race@v1'],
            'decision': {'basis_refs': [], 'reason': 'Select the written version against the observed revision.',
                         'expected': 'No repeated publication.'}}},
    ], extra_extensions=[Path(__file__).resolve().parents[1] / 'tests/pi_assembly_race.ts'])
    calls = _calls(events)
    assert calls[2].get('isError'), calls[2]
    failed = calls[2]['result']['details']
    assert failed['activation']['created_resource_refs'] == ['skill:cas-race@v1']
    assert failed['assembly_receipt']['applied'] is False
    assert failed['assembly_receipt']['format'] == 'task-harness-assembly-version-conflict-v1'
    assert not calls[3].get('isError'), calls[3]
    versions = [json.loads(line) for line in (tmp_path / 'task-skills.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [(row['name'], row['version']) for row in versions] == [('retained-before-race', 1), ('cas-race', 1)]
    assemblies = [json.loads(line) for line in (tmp_path / 'task-harness-assemblies.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [row['revision'] for row in assemblies] == [1, 2, 3]
    assert assemblies[1]['selected_resource_refs'] == ['skill:retained-before-race@v1']


def test_legacy_partial_failure_projection_keeps_written_refs_and_unknown_remaining_work():
    legacy = {'format': 'task-harness-change-receipt-v1', 'status': 'failed', 'results': [
        {'status': 'applied', 'resource': {'resource_ref': 'memory:retained-fact@v1'}},
        {'status': 'failed', 'error': {'error': 'native failure'}}]}
    failure = {'resource_ref': 'failure:legacy-partial@v1', 'tool': 'task_harness',
               'error': json.dumps(legacy), 'applied': 'unknown', 'retryable': True}
    projected = module_eval('pi_harness_control.ts', 'm.failureReceipt(' + json.dumps(failure) + ')')
    assert projected['partial_applied'] is True
    assert projected['applied_resource_refs'] == ['memory:retained-fact@v1']
    assert projected['remaining_change_count'] is None
    assert projected['recovery_read']['arguments']['ref'] == 'failure:legacy-partial@v1'
