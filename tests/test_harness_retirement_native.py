"""Retirement removes future activation without erasing the original version."""
import copy

import pytest

from test_harness_batch_preflight import run_changes, stage45
from test_task_research_context import records, results


@pytest.mark.parametrize('kind', ['tool', 'subagent'])
def test_retired_selected_component_cannot_run_from_a_stale_public_call(tmp_path, kind):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    name = 'read-cell-color' if kind == 'tool' else 'independent-cell-reviewer'
    tool = 'task_tool_read-cell-color_v1' if kind == 'tool' else 'delegate_task'
    arguments = {'parameters': {'grid': [[4]], 'row': 0, 'col': 0}, 'bindings': []} if kind == 'tool' else {
        'agent_name': name, 'task': 'Inspect only the explicitly supplied public evidence.'}
    events = run_changes(tmp_path, changes, assembly={'expected_assembly_revision': 0, 'selected_resource_refs': []}, more=[
        {'name': 'task_harness', 'arguments': {'action': 'change',
            'changes': [{'operation': 'retire', 'target_ref': f'{kind}:{name}@v1'}]}},
        {'name': tool, 'arguments': arguments},
    ])
    assert not results(events, 'task_harness')[-1].get('isError')
    failure = results(events, tool)[-1]
    assert failure.get('isError'), failure
    filename = 'task-tools.jsonl' if kind == 'tool' else 'task-subagents.jsonl'
    versions = records(tmp_path, filename)
    assert [(row['version'], row['status']) for row in versions] == [(1, 'active'), (2, 'retired')]
    assert not records(tmp_path, 'subagent-invocations.jsonl')
    if kind == 'tool':
        assert not any(row.get('status') == 'completed' for row in records(tmp_path, 'task-tool-events.jsonl'))
        last = records(tmp_path, 'provider-contexts.jsonl')[-1]['context']
        assert tool not in {definition['name'] for definition in last['tools']}


@pytest.mark.parametrize('kind', ['tool', 'subagent'])
def test_published_unselected_component_is_not_enabled_by_an_attempted_call(tmp_path, kind):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    tool = 'task_tool_read-cell-color_v1' if kind == 'tool' else 'delegate_task'
    arguments = {'parameters': {'grid': [[4]], 'row': 0, 'col': 0}, 'bindings': []} if kind == 'tool' else {
        'agent_name': 'independent-cell-reviewer', 'task': 'Review only the supplied public evidence.'}
    events = run_changes(tmp_path, changes, more=[{'name': tool, 'arguments': arguments}])
    assert not results(events, 'task_harness')[-1].get('isError')
    assert results(events, tool)[-1].get('isError')
    assert not records(tmp_path, 'task-harness-assemblies.jsonl')
    assert not records(tmp_path, 'subagent-invocations.jsonl')
    if kind == 'tool':
        last = records(tmp_path, 'provider-contexts.jsonl')[-1]['context']
        assert tool not in {definition['name'] for definition in last['tools']}
