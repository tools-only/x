"""Authoring surface through actual Pi/native; not autonomous or ARC quality proof."""
import copy
import hashlib
import json
import pytest

from test_harness_argument_integrity_native import run, read_creator, tool_payloads, PROJECT
from test_task_research_context import records, results

FIXTURE = PROJECT / 'tests/fixtures/harness-stage135a-original-compute-call.json'
SOURCE = '(lambda grid, coords: {"colors": [grid[xy[1]][xy[0]] for xy in coords]})(input["grid"], input["coords"])'


def minimal_call():
    original = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']
    candidate = original['arguments']['candidate']
    return {'name': 'task_harness_create', 'arguments': {
        'candidate': {'name': candidate['name'], 'description': candidate['description'],
                      'program': {'format': 'task-pure-python-v1', 'source': SOURCE}},
        'assembly': True, 'trial': original['arguments']['trial'],
    }}


def test_short_source_call_needs_no_schema_kind_ref_or_assembly_ids_and_reaches_later_parent(tmp_path):
    tmp_path = tmp_path / 'task'
    call = minimal_call()
    events, requests = run(tmp_path, [read_creator(), [call]], {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    receipt = attempt['result']['details']
    expected = {'colors': [5, 4, 5, 5]}
    assert json.loads(receipt['trial']['result']['content'][0]['text']) == expected
    stored = records(tmp_path, 'task-tools.jsonl')[0]
    original = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']['arguments']['candidate']['program']
    assert stored['program']['expression'] == original['expression']
    assert stored['program']['format'] == 'task-pure-expression-v1'
    assert stored['input_schema'] == {'type': 'object'} and stored['output_schema'] == {}
    assert stored['program_source_evidence']['source'] == SOURCE
    assert stored['program_source_evidence']['source_sha256'] == hashlib.sha256(SOURCE.encode()).hexdigest()
    assert len(stored['program_source_evidence']['compiler_sha256']) == 64
    assert stored['program_source_evidence']['python_version'] != 'unknown'
    assert len(requests) == 3
    assert any(json.loads(value['trial']['result']['content'][0]['text']) == expected
               for value in tool_payloads(requests[2]) if value.get('trial', {}).get('status') == 'completed')

    # The immutable version must survive a new Pi process without Python on
    # PATH; a runtime parser dependency would make this semantic call fail.
    before = records(tmp_path, 'task-tools.jsonl')
    invocation = {'name': stored['exposed_name'], 'arguments': call['arguments']['trial']}
    resumed, _ = run(tmp_path, [[invocation]], {'PATH': '', 'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)}, resume=True)
    execution = results(resumed, stored['exposed_name'])[0]
    assert not execution.get('isError'), execution
    assert json.loads(execution['result']['content'][0]['text']) == expected
    assert records(tmp_path, 'task-tools.jsonl') == before
    assert len(records(tmp_path, 'task-baseline-method-reads.jsonl')) == 1


def test_bad_source_is_write_free_and_explicit_output_contract_still_rejects_trial(tmp_path):
    tmp_path = tmp_path / 'task'
    invalid = minimal_call()
    invalid['arguments']['candidate']['program']['source'] = '__import__("os")'
    strong = minimal_call()
    strong['arguments']['candidate']['output_schema'] = {'type': 'boolean'}
    events, _ = run(tmp_path, [read_creator(), [invalid], [strong]], {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    attempts = results(events, 'task_harness_create')
    assert attempts[0].get('isError')
    assert 'no_component_written' in attempts[0]['result']['content'][0]['text']
    assert not attempts[1].get('isError'), attempts[1]
    assert attempts[1]['result']['details']['trial']['status'] == 'failed'
    stored = records(tmp_path, 'task-tools.jsonl')
    assert len(stored) == 1 and stored[0]['version'] == 1
    assert not [row for row in records(tmp_path, 'harness-observations.jsonl') if row.get('actual_use')]


def test_true_assembly_keeps_other_selected_components(tmp_path):
    tmp_path = tmp_path / 'task'
    first = minimal_call()
    second = copy.deepcopy(first)
    second['arguments']['candidate']['name'] = 'another_pixel_color'
    events, _ = run(tmp_path, [read_creator(), [first], [second]], {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    assert not [event for event in results(events, 'task_harness_create') if event.get('isError')]
    assemblies = records(tmp_path, 'task-harness-assemblies.jsonl')
    assert assemblies[-1]['revision'] == 2
    assert set(assemblies[-1]['selected_resource_refs']) == {'tool:arc_pixel_color@v1', 'tool:another_pixel_color@v1'}


@pytest.mark.parametrize('failure', ['closed_parameter', 'lowered_limit', 'expired_binding', 'invalid_unicode'])
def test_source_limits_and_explicit_input_or_binding_integrity_still_apply(tmp_path, failure):
    root = tmp_path / 'task'
    call = minimal_call()
    if failure == 'closed_parameter':
        original = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']['arguments']['candidate']
        call['arguments']['candidate']['input_schema'] = original['input_schema']
        call['arguments']['trial']['parameters']['unexpected'] = 1
    elif failure == 'lowered_limit':
        call['arguments']['candidate']['program']['limits'] = {'ast_nodes': 1}
    elif failure == 'invalid_unicode':
        call['arguments']['candidate']['program']['source'] = '"\ud800"'
    else:
        call['arguments']['trial']['bindings'][0]['ref'] = 'observation_snapshot:not-authorized@v1'
    events, _ = run(root, [read_creator(), [call]], {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    attempt = results(events, 'task_harness_create')[0]
    if failure == 'expired_binding':
        assert not attempt.get('isError'), attempt
        assert attempt['result']['details']['trial']['status'] == 'failed'
        assert len(records(root, 'task-tools.jsonl')) == 1
    else:
        assert attempt.get('isError'), attempt
        assert not records(root, 'task-tools.jsonl')
    assert not [row for row in records(root, 'harness-observations.jsonl') if row.get('actual_use')]


def test_source_update_inherits_strong_contracts_and_new_version_still_validates(tmp_path):
    root = tmp_path / 'task'
    first = minimal_call()
    original = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']['arguments']['candidate']
    first['arguments']['candidate'].update(input_schema=original['input_schema'], output_schema=original['output_schema'])
    update = {'name': 'task_harness', 'arguments': {'action': 'change', 'changes': [
        {'operation': 'update', 'candidate': {'name': 'arc_pixel_color', 'description': 'Reuse the computation with inherited contracts.',
                                            'program': {'format': 'task-pure-python-v1', 'source': SOURCE}}}],
        'assembly': {'expected_assembly_revision': 1, 'selected_resource_refs': []}}}
    wrong = copy.deepcopy(first['arguments']['trial'])
    wrong['parameters']['unexpected'] = 1
    events, _ = run(root, [read_creator(), [first], [update], [
        {'name': 'task_tool_arc_pixel_color_v2', 'arguments': wrong}]], {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    assert not results(events, 'task_harness_create')[0].get('isError'), events
    assert not results(events, 'task_harness')[-1].get('isError'), events
    versions = records(root, 'task-tools.jsonl')
    assert len(versions) == 2 and versions[-1]['version'] == 2
    assert versions[0]['input_schema'] == versions[1]['input_schema']
    assert versions[0]['output_schema'] == versions[1]['output_schema']
    assert versions[-1]['input_schema']['additionalProperties'] is False
    assert results(events, 'task_tool_arc_pixel_color_v2')[0].get('isError')
