"""Actual provider candidate replay; scripted Pi diagnoses syntax, not adoption."""
import json
from pathlib import Path

import pytest
from test_harness_batch_preflight import run_changes, FILES
from test_harness_capability_authoring import module_eval
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]


def stage47(which):
    return json.loads((PROJECT / 'tests/fixtures/harness-stage47-candidates.json').read_text(encoding='utf-8'))[which]


@pytest.mark.parametrize('which', ['second', 'third'])
def test_actual_candidate_batches_publish_without_rewriting_authored_program(tmp_path, which):
    changes = stage47(which)
    events = run_changes(tmp_path, changes,
        assembly={'expected_assembly_revision': 0, 'selected_resource_refs': []},
        more=[{'name': 'task_tool_check-cell-color_v1', 'arguments': {
            'parameters': {'grid': [[4, 3], [0, 8]], 'x': 0, 'y': 1}, 'bindings': []}}])
    outputs = results(events, 'task_harness')
    assert not any(r['isError'] for r in outputs), outputs
    for file in FILES:
        assert len(records(tmp_path, file)) == 1, file
    published = records(tmp_path, 'task-tools.jsonl')[-1]
    original = changes[3]['candidate']
    assert published['input_schema'] == original['input_schema']
    assert published['program']['expression'] == original['program']['expression']
    assert len(records(tmp_path, 'task-harness-assemblies.jsonl')[-1]['selected_resource_refs']) == 5
    result = results(events, 'task_tool_check-cell-color_v1')[-1]
    assert not result['isError'], result
    assert json.loads(result['result']['content'][0]['text']) == {'color': 0, 'is_black': True}


def test_nested_create_is_redundant_metadata_not_new_authority():
    candidate = {'component': 'memory', 'key': 'fact', 'atom': {'subject': 's', 'predicate': 'p', 'value': 1},
                 'validity': {'scope': 'task'}, 'operation': 'create'}
    for outer in [{}, {'operation': 'create'}]:
        value = module_eval('pi_harness_protocol.ts',
            'm.normalizeHarnessChange(' + json.dumps({**outer, 'candidate': candidate}) + ')')
        assert value == {'operation': 'create', 'candidate': {k: v for k, v in candidate.items() if k != 'operation'}}
    invalid = [{'operation': 'update', 'candidate': candidate},
               {'candidate': {**candidate, 'operation': 'update'}},
               {'candidate': {**candidate, 'operation': 'invented'}},
               {'candidate': {**candidate, 'target_version': 1}},
               {'target_ref': 'memory:fact@v1', 'candidate': candidate}]
    for entry in invalid:
        message = module_eval('pi_harness_protocol.ts',
            '(()=>{try{m.normalizeHarnessChange(' + json.dumps(entry) + ');return null}catch(e){return e.message}})()')
        assert message, entry


def test_preflight_preserves_nested_validator_location_and_input_repair(tmp_path):
    events = run_changes(tmp_path, stage47('first'))
    output = results(events, 'task_harness')[-1]
    assert output['isError'], output
    receipt = json.loads(output['result']['content'][0]['text'])
    issue = next(i for i in receipt['issues'] if 'undeclared variable' in i['message'])
    assert issue['path'].endswith('.program.expression.value.array.value.name'), issue
    assert 'input' in issue['message'] and 'lexical' in issue['message'], issue


def schema_check(schema, value, *, options=None):
    return module_eval('pi_task_json_schema.ts',
        '(()=>{try{const s=m.validateTaskJsonSchema(' + json.dumps(schema) + ');'
        'return {ok:true,usage:m.assertTaskJsonSchemaValue(s,' + json.dumps(value) +
        ',"invalid_input","$.input",' + (options or '{}') + ')};}catch(e){return {ok:false,...e.toJSON()}}})()')


def test_array_items_omission_keeps_type_length_and_authored_element_constraints():
    schema = {'type': 'array', 'minItems': 1, 'maxItems': 2}
    assert schema_check(schema, [[1, 2], {'text': 'x'}])['ok']
    for value in [{}, [], [1, 2, 3]]:
        assert not schema_check(schema, value)['ok'], value
    typed = {**schema, 'items': {'type': 'integer'}}
    assert schema_check(typed, [1, 2])['ok']
    assert not schema_check(typed, ['1'])['ok']


def test_unconstrained_array_elements_remain_bounded_strict_json():
    schema = {'type': 'array'}
    assert not schema_check(schema, [{'__proto__': {'x': 1}}])['ok']
    assert not schema_check(schema, [['abcdefgh']], options='{max_string_code_units:3}')['ok']
    assert not schema_check(schema, [[1, 2, 3]], options='{max_visits:3}')['ok']
    nested = [1]
    for _ in range(70):
        nested = [nested]
    assert not schema_check(schema, nested)['ok']
    cancelled = schema_check(schema, list(range(300)), options='{is_cancelled:()=>true}')
    assert not cancelled['ok'] and cancelled['code'] == 'cancelled'
    non_json = module_eval('pi_task_json_schema.ts',
        '(()=>{try{m.assertTaskJsonSchemaValue({type:"array"},[()=>0],"invalid_input","$");return null}catch(e){return e.message}})()')
    assert non_json
