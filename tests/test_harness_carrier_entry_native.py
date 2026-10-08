"""Native HTTP discovery/use diagnostics; scripted provider, no adoption claim."""
import json
import pytest

from test_harness_argument_integrity_native import run
from test_harness_direct_use_native import (
    assemble, capture, child_env, current_text, prompt_create, system_text,
)
from test_task_research_context import records, results


COMPACT = {'PI_ARC_EXECUTION_GATE': 'enabled', 'PI_ARC_TOOL_DISCLOSURE': 'on_demand',
           'PI_ARGUMENT_COMPACT_ENTRY': '1', 'PI_AUTORESEARCH_ENABLED': 'disabled'}


def index(request):
    for message in request['messages']:
        content = message.get('content') or ''
        blocks = [content] if isinstance(content, str) else [b.get('text', '') for b in content]
        for text in blocks:
            if text.startswith('Task-local harness index:'):
                return text
    raise AssertionError('No harness entry in actual HTTP payload')


def activate(name):
    return {'name': 'task_harness', 'arguments': {'action': 'activate', 'enabled_tools': [name]}}


@pytest.mark.parametrize('activation_name', ['task_memory_pool', 'memory'])
def test_index_exposes_only_available_activation_then_capture_select_and_archive(tmp_path, activation_name):
    root = tmp_path / 'entry'
    events, requests = run(root, [[activate(activation_name)],
        [capture('selected', 'SELECTED_NOTE', select=True)],
        [capture('archived', 'ARCHIVED_NOTE', key='archive')]], COMPACT)
    first = index(requests[0])
    assert 'enabled_tools=["task_memory_pool"]' in first
    assert 'select=true' in first and 'archive only' in first
    assert 'One-off independent work:' not in first  # no child adapter installed
    assert 'enabled_tools=["delegate_task"]' not in first
    assert '{{' not in first
    assert json.dumps(requests[0]['tools']).count('Skill: component=skill') == 1
    assert 'enabled_tools=["task_memory_pool"]' not in index(requests[1])
    assert all(not r.get('isError') for r in results(events, 'task_memory_pool'))
    assert 'SELECTED_NOTE' in current_text(requests[-1])
    assert 'ARCHIVED_NOTE' not in current_text(requests[-1])
    assert len(records(root, 'task-memory.jsonl')) == 2
    assert not records(root, 'task-baseline-method-reads.jsonl')


def test_compact_entry_four_carriers_reachable_without_manuals_and_subset_preserved(tmp_path):
    root = tmp_path / 'entry'
    skill = {'name': 'task_harness_create', 'arguments': {'candidate': {
        'component': 'skill', 'name': 'bounded-check', 'description': 'Apply a bounded evidence procedure.',
        'instructions': 'Read the supplied readiness once. Return its value; stop when known or unavailable.'}}}
    delegate = {'name': 'delegate_task', 'arguments': {
        'task': 'Read fixture readiness once.', 'tools': ['fixture_state'],
        'output_contract': 'Return ready and conclusion.', 'stop_when': 'Readiness known or unavailable.',
        'budget': {'max_runtime_ms': 60000, 'max_tool_calls': 2, 'max_reported_tokens': 1000},
        'context_recipe': {'include_checkpoint': False}}}
    with child_env(**COMPACT) as env:
        events, requests = run(root, [[activate('task_memory_pool')],
            [capture('selected', 'CARRIER_NOTE', select=True)], [skill],
            [prompt_create('CARRIER_POLICY')], [activate('delegate_task')], [delegate],
            [{'name': 'task_harness', 'arguments': {'action': 'inspect', 'section': 'current_assembly'}}],
            [assemble(3, ['skill:bounded-check@v1', 'system_prompt:direct-policy@v1'])],
            [{'name': 'ingress_probe', 'arguments': {'marker': 'parent-continues'}}]], env)
    first = index(requests[0])
    assert 'enabled_tools=["delegate_task"]' in first and 'No saved role needed' in first
    assert not any(t['function']['name'] == 'delegate_task' for t in requests[0]['tools'])
    assert 'steps with decisions' in first and 'executable input/output' in first
    for name in ('task_harness', 'task_harness_create', 'task_memory_pool', 'delegate_task', 'ingress_probe'):
        assert all(not r.get('isError') for r in results(events, name)), results(events, name)
    assert 'CARRIER_NOTE' in current_text(requests[2])
    assert 'CARRIER_POLICY' in system_text(requests[4])
    assert 'CARRIER_NOTE' not in current_text(requests[-1])
    assert 'CARRIER_POLICY' in system_text(requests[-1])
    assert 'enabled_tools=["delegate_task"]' not in index(requests[6])
    detail = results(events, 'delegate_task')[0]['result']['details']
    assert json.loads(detail['result']['text']) == {'ready': True, 'conclusion': 'fixture-state:ready'}
    assert detail['ephemeral'] and detail['budget']['tool_calls'] == 1
    assert not records(root, 'task-subagents.jsonl')
    assert not records(root, 'auto-research-sessions.jsonl')
    assert not records(root, 'task-baseline-method-reads.jsonl')
    assert not results(events, 'read')
    assembly = records(root, 'task-harness-assemblies.jsonl')[-1]
    assert assembly['selected_resource_refs'] == ['skill:bounded-check@v1', 'system_prompt:direct-policy@v1']
