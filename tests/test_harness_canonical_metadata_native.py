"""Equivalent authoring spellings preserve publication control and strict nulls."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


@pytest.mark.parametrize('spelling', ['semantic_kind', 'component', 'source-only'])
def test_metadata_aliases_use_same_assembly_and_compare_objects_semantically(tmp_path, spelling):
    assembly = {'expected_assembly_revision': 0, 'selected_resource_refs': []}
    candidate = {'name': 'canonical-metadata', 'description': 'Return the bounded integer 2.',
                 'program': {'format': 'task-pure-python-v1', 'source': '2',
                             'assembly': assembly}}
    if spelling != 'source-only':
        candidate[spelling] = 'tool'
    request = {'candidate': candidate, 'assembly': {
        'selected_resource_refs': [], 'expected_assembly_revision': 0}}
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness_create', 'arguments': request},
        {'name': 'task_tool_canonical-metadata_v1', 'arguments': {'parameters': {}, 'bindings': []}},
    ], extra_extensions=[project / 'tests/pi_task_tool_fixture.ts'])
    created = results(events, 'task_harness_create')[-1]
    assert not created.get('isError'), created
    assert records(tmp_path, 'task-harness-assemblies.jsonl')[-1]['selected_resource_refs'] == [
        'tool:canonical-metadata@v1']
    invoked = results(events, 'task_tool_canonical-metadata_v1')[-1]
    assert not invoked.get('isError'), invoked
    assert json.loads(invoked['result']['content'][0]['text']) == 2
    assert 'assembly' not in records(tmp_path, 'task-tools.jsonl')[-1]['program']
    assert not records(tmp_path, 'task-baseline-method-reads.jsonl')


@pytest.mark.parametrize('field', ['execution', 'semantic_kind', 'component'])
def test_explicit_null_authoring_controls_are_not_omitted_defaults(tmp_path, field):
    candidate = {'component': 'skill', 'name': 'null-control',
                 'description': 'Compare one public prediction.',
                 'instructions': 'State a prediction and preserve uncertainty.', field: None}
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness_create', 'arguments': {'candidate': candidate, 'assembly': True}}])
    failed = results(events, 'task_harness_create')[-1]
    assert failed.get('isError'), failed
    assert field in json.dumps(failed['result'])
    assert not records(tmp_path, 'task-skills.jsonl')
    assert not records(tmp_path, 'task-harness-assemblies.jsonl')
    rejection = records(tmp_path, 'task-operation-failures.jsonl')[-1]
    assert rejection['applied'] is False
    assert not rejection.get('required_next_call')


@pytest.mark.parametrize('case', ['conflicting-carriers', 'nested-null-assembly'])
def test_compatibility_input_cannot_discard_explicit_carrier_or_control(tmp_path, case):
    candidate = {'semantic_kind': 'tool', 'name': 'explicit-control',
                 'description': 'Return the bounded integer 2.',
                 'program': {'format': 'task-pure-python-v1', 'source': '2'}}
    if case == 'conflicting-carriers':
        candidate['component'] = 'skill'
    else:
        candidate['program']['assembly'] = None
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness_create', 'arguments': {'candidate': candidate}}],
        extra_extensions=[project / 'tests/pi_task_tool_fixture.ts'])
    failed = results(events, 'task_harness_create')[-1]
    assert failed.get('isError'), failed
    assert ('component' if case == 'conflicting-carriers' else 'assembly') in json.dumps(failed['result'])
    assert not records(tmp_path, 'task-tools.jsonl')
    assert not records(tmp_path, 'task-skills.jsonl')
    rejection = records(tmp_path, 'task-operation-failures.jsonl')[-1]
    assert rejection['applied'] is False
    assert not rejection.get('required_next_call')
