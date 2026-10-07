"""Real Pi replay of failed authoring; deterministic diagnostic, not adoption."""
import copy
import json
from pathlib import Path

import pytest
from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]
FILES = ['task-memory.jsonl', 'task-system-prompt.jsonl', 'task-skills.jsonl',
         'task-tools.jsonl', 'task-subagents.jsonl']


def stage45(which):
    return json.loads((PROJECT / 'tests/fixtures/harness-stage45-candidates.json').read_text(encoding='utf-8'))[which]


def repaired_stage45():
    changes = stage45('last')
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    # The historical failure stays immutable. The parent explicitly removes
    # stale optional citations in its repair, rather than runtime replacing them.
    for change in changes:
        change['candidate'].pop('authoring_method_ref', None)
    return changes


def run_changes(root, changes, *, read_creators=True, more=None, assembly=None, subagent_adapter=True, extra_env=None):
    steps = ([{'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': kind + '-creator'}}
              for kind in ('skill', 'tool', 'subagent')] if read_creators else [])
    steps.append({'name': 'task_harness', 'arguments': {'action': 'change', 'changes': changes,
        **({'assembly': assembly} if assembly is not None else {})}})
    steps.extend(more or [])
    extensions = [PROJECT / 'tests/pi_task_tool_fixture.ts']
    if subagent_adapter:
        extensions.append(PROJECT / 'tests/pi_non_arc_task_subagents.ts')
    return _run_fixture(root, 'treatment', steps=steps, extra_extensions=extensions, extra_env=extra_env)


@pytest.mark.parametrize('which, expected', [
    ('first', ['changes[0]', 'atom', 'validity', 'changes[1]', 'scope', 'changes[3]', 'undeclared variable: grid']),
    ('last', ['changes[1]', 'scope']),
])
def test_real_failed_batch_reports_independent_repairs_before_writes(tmp_path, which, expected):
    events = run_changes(tmp_path, stage45(which))
    output = results(events, 'task_harness')[-1]
    assert output.get('isError'), output
    message = '\n'.join(x.get('text', '') for x in output['result']['content'])
    for text in expected:
        assert text in message, message
    assert len(message) < 4000
    assert 'Before any action, identify one exact visible fact' not in message
    for file in FILES:
        assert not records(tmp_path, file), file
    intents = records(tmp_path, 'task-harness-conversion-intents.jsonl')
    assert intents[-1]['status'] == 'awaiting_parent_repair'
    assert len(intents[-1]['changes']) == 5
    if which == 'last':
        assert 'undeclared variable' not in message


def test_creator_program_and_schemas_fail_together_before_memory_write(tmp_path):
    changes = repaired_stage45()
    tool = changes[3]['candidate']
    tool['program']['expression'] = {'op': 'var', 'name': 'not-defined'}
    tool['input_schema'] = {'type': 'invented'}
    tool['output_schema'] = {'type': 'invented'}
    events = run_changes(tmp_path, changes, read_creators=False)
    output = results(events, 'task_harness')[-1]
    assert output.get('isError'), output
    message = '\n'.join(x.get('text', '') for x in output['result']['content'])
    for text in ['not-defined', 'input_schema', 'output_schema']:
        assert text in message, message
    assert 'candidate.authoring_method_ref' not in message
    for file in FILES:
        assert not records(tmp_path, file), file


def test_late_invalid_tool_program_leaves_no_earlier_native_components(tmp_path):
    changes = stage45('last')
    changes[1]['candidate']['scope'] = 'this bounded diagnostic'
    changes[3]['candidate']['program']['expression'] = {'op': 'var', 'name': 'not-defined'}
    events = run_changes(tmp_path, changes)
    output = results(events, 'task_harness')[-1]
    assert output.get('isError'), output
    assert 'not-defined' in json.dumps(output['result'])
    for file in FILES:
        assert not records(tmp_path, file), file


def test_repaired_real_five_kind_batch_publishes_selects_and_computes(tmp_path):
    changes = repaired_stage45()
    events = run_changes(tmp_path, changes,
        assembly={'expected_assembly_revision': 0, 'selected_resource_refs': []},
        more=[{'name': 'task_tool_read-cell-color_v1', 'arguments': {
            'parameters': {'grid': [[4, 3], [9, 8]], 'row': 1, 'col': 0}, 'bindings': []}}])
    outputs = results(events, 'task_harness')
    assert not any(x.get('isError') for x in outputs), outputs
    for file in FILES:
        assert len(records(tmp_path, file)) == 1, file
    assert len(records(tmp_path, 'task-harness-assemblies.jsonl')[-1]['selected_resource_refs']) == 5
    computed = results(events, 'task_tool_read-cell-color_v1')[-1]
    assert not computed.get('isError'), computed
    assert json.loads(computed['result']['content'][0]['text']) == {'color': 9}


@pytest.mark.parametrize('kind,index', [('memory', 0), ('system_prompt', 1), ('skill', 2), ('tool', 3), ('subagent', 4)])
def test_each_kind_rejects_missing_semantics_or_unauthorized_tool_before_any_write(tmp_path, kind, index):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    bad = changes[index]['candidate']
    if kind == 'memory':
        bad.pop('atom')
    elif kind == 'system_prompt':
        bad.pop('scope')
    elif kind == 'skill':
        bad['instructions'] = ''
    elif kind == 'tool':
        bad['program'] = {'format': 'task-pure-expression-v1', 'limits': {},
                          'expression': {'op': 'var', 'name': 'not-defined'}}
    else:
        bad['tools'] = ['unauthorized-tool']
    events = run_changes(tmp_path, changes)
    failure = results(events, 'task_harness')[-1]
    assert failure.get('isError') or failure['result'].get('isError'), failure
    assert f'changes[{index}]' in json.dumps(failure['result'])
    for file in FILES:
        assert not records(tmp_path, file), file
    assert not records(tmp_path, 'subagent-invocations.jsonl')


def test_missing_subagent_adapter_rejects_batch_before_any_native_write(tmp_path):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    events = run_changes(tmp_path, changes, subagent_adapter=False)
    failure = results(events, 'task_harness')[-1]
    assert failure.get('isError'), failure
    message = json.dumps(failure['result'])
    assert 'changes[4].candidate.tools' in message
    assert 'adapter admission is unavailable' in message
    for file in FILES:
        assert not records(tmp_path, file), file


def test_invalid_subagent_context_recipe_is_rejected_before_earlier_component_writes(tmp_path):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    changes[4]['candidate']['context_recipe'] = {'recent_actions': -1}
    events = run_changes(tmp_path, changes)
    failure = results(events, 'task_harness')[-1]
    assert failure.get('isError') or failure['result'].get('isError'), failure
    assert 'changes[4].candidate.context_recipe' in json.dumps(failure['result'])
    for file in FILES:
        assert not records(tmp_path, file), file


def test_native_subagent_keeps_permission_check_and_update_inherits_explicit_empty_tools(tmp_path):
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_subagent', 'arguments': {'action': 'create', 'name': 'reviewer',
            'description': 'Review supplied evidence.', 'instructions': 'Report a counterexample.',
            'tools': ['unauthorized-tool']}},
        {'name': 'task_subagent', 'arguments': {'action': 'inspect'}},
        {'name': 'task_subagent', 'arguments': {'action': 'create', 'name': 'reviewer',
            'description': 'Review supplied evidence.', 'instructions': 'Report a counterexample.',
            'tools': []}},
        {'name': 'task_subagent', 'arguments': {'action': 'update', 'name': 'reviewer',
            'target_version': 1, 'instructions': 'Report one counterexample or uncertainty.'}},
        {'name': 'task_subagent', 'arguments': {'action': 'inspect', 'name': 'reviewer'}},
    ], extra_extensions=[PROJECT / 'tests/pi_non_arc_task_subagents.ts'])
    outputs = results(events, 'task_subagent')
    assert outputs[0].get('isError'), outputs[0]
    assert outputs[1]['result']['details']['agents'] == []
    assert not any(output.get('isError') for output in outputs[2:]), outputs
    saved = outputs[-1]['result']['details']['agents'][0]
    assert saved['version'] == 2
    assert saved['tools'] == []
    assert saved['instructions'] == 'Report one counterexample or uncertainty.'
    assert len(records(tmp_path, 'task-subagents.jsonl')) == 2


def test_real_parent_repairs_batch_once_without_rereading_creators(tmp_path):
    corrected = repaired_stage45()
    first = stage45('first')
    for change in first:
        change['candidate'].pop('authoring_method_ref', None)
    events = run_changes(tmp_path, first, more=[
        {'name': 'task_harness', 'arguments': {'action': 'change', 'changes': corrected,
            'assembly': {'expected_assembly_revision': 0, 'selected_resource_refs': []}}},
        {'name': 'task_tool_read-cell-color_v1', 'arguments': {
            'parameters': {'grid': [[4, 3], [9, 8]], 'row': 0, 'col': 1}, 'bindings': []}},
    ])
    outputs = results(events, 'task_harness')
    assert outputs[-2]['isError']
    assert not outputs[-1]['isError'], outputs[-1]
    assert len(records(tmp_path, 'task-baseline-method-reads.jsonl')) == 3
    for file in FILES:
        assert len(records(tmp_path, file)) == 1, file
    computed = results(events, 'task_tool_read-cell-color_v1')[-1]
    assert not computed['isError'], computed
    assert json.loads(computed['result']['content'][0]['text']) == {'color': 3}
    contexts = records(tmp_path, 'provider-contexts.jsonl')
    # The repair turn actually receives the indexed receipt, not merely a
    # durable ref to the failure. This is a scripted parent, not model adoption.
    assert 'changes[3].candidate.program' in json.dumps(contexts[4]['context'])


@pytest.mark.parametrize('brief', [False, True])
def test_minimum_contract_is_in_actual_create_surface_and_development_brief(tmp_path, brief):
    events = _run_fixture(tmp_path, 'treatment', steps=[{'name': 'task_harness',
        'arguments': {'action': 'contract', 'topic': 'development'}}], arc_compact=brief)
    body = results(events, 'task_harness')[-1]['result']['content'][0]['text']
    for word in ['atom', 'validity', 'scope']:
        assert word in body
    first = records(tmp_path, 'provider-contexts.jsonl')[0]['context']
    create = next(t for t in first['tools'] if t['name'] == 'task_harness_create')
    for word in ['atom', 'validity', 'scope']:
        assert word in json.dumps(create), create
