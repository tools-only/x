"""Authoring content is sufficient; supplied creator citations stay version-bound."""
import json
from pathlib import Path

import pytest

from test_arc_capability_surface_native import _run_arc_parent
from test_harness_capability_authoring import module_eval
from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import records, results


@pytest.mark.parametrize('citation', ['omitted', 'current', 'stale-after-read', 'null'])
@pytest.mark.parametrize('kind', ['skill', 'tool', 'subagent'])
def test_authoring_needs_valid_content_and_checks_only_explicit_creator_citation(tmp_path, citation, kind):
    candidate = {'component': kind, 'name': 'content-sufficient',
                 'description': 'Compare a bounded public prediction.',
                 'instructions': 'State one prediction, compare public evidence, and preserve uncertainty.'}
    if kind == 'tool':
        candidate.pop('instructions')
        candidate.update(input_schema={'type': 'object', 'properties': {}, 'additionalProperties': False},
            output_schema={'type': 'integer'}, program={'format': 'task-pure-expression-v1', 'limits': {},
                'expression': {'op': 'literal', 'value': 2}})
    elif kind == 'subagent':
        candidate['instructions'] = 'Return the number 2 for this bounded pure-reasoning diagnostic.'
        candidate['tools'] = []
    steps = []
    if citation == 'current':
        candidate['authoring_method_ref'] = module_eval('pi_harness_baseline_methods.ts',
            f"m.baselineMethodCatalog().find(x=>x.name==='{kind}-creator').method_ref")
    elif citation == 'stale-after-read':
        steps.append({'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': kind + '-creator'}})
        candidate['authoring_method_ref'] = f'baseline_method:{kind}-creator@sha256:' + '0' * 64
    elif citation == 'null':
        candidate['authoring_method_ref'] = None
    steps.append({'name': 'task_harness_create', 'arguments': {'candidate': candidate, 'assembly': True}})
    if citation in ['omitted', 'current']:
        steps.append({'name': 'read', 'arguments': {
            'path': str(tmp_path / 'task-harness/skills/content-sufficient/SKILL.md')}} if kind == 'skill' else {
            'name': 'task_tool_content-sufficient_v1', 'arguments': {'parameters': {}, 'bindings': []}} if kind == 'tool' else {
            'name': 'delegate_task', 'arguments': {'agent_name': 'content-sufficient', 'task': 'Return the number 2.'}})
    if kind == 'subagent':
        _, cli = _pi_cli()
        project = Path(__file__).resolve().parents[1]
        events = _run_fixture(tmp_path, 'treatment', steps=steps, extra_extensions=[project / 'tests/pi_non_arc_task_subagents.ts'],
            extra_env={'PI_AUTORESEARCH_PI_CLI': cli, 'PI_AUTORESEARCH_PROVIDER': 'offline-subagent-test',
                'PI_AUTORESEARCH_MODEL': 'scripted', 'PI_SUBAGENT_REPORT': '2',
                'PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION': str(project / 'tests/pi_subagent_provider.ts')})
    else:
        events = _run_arc_parent(tmp_path, steps)
    created = results(events, 'task_harness_create')[-1]
    if citation in ['stale-after-read', 'null']:
        assert created.get('isError'), created
        assert 'authoring_method_ref' in json.dumps(created['result'])
        assert not records(tmp_path, {'skill': 'task-skills.jsonl', 'tool': 'task-tools.jsonl', 'subagent': 'task-subagents.jsonl'}[kind])
        assert not records(tmp_path, 'task-harness-assemblies.jsonl')
    else:
        assert not created.get('isError'), created
        assert created['result']['details']['assembly_receipt']['current_assembly']['selected_resource_refs'] == [
            f'{kind}:content-sufficient@v1']
        read = results(events, {'skill': 'read', 'tool': 'task_tool_content-sufficient_v1', 'subagent': 'delegate_task'}[kind])[-1]
        assert not read.get('isError'), read
        if kind == 'skill':
            assert candidate['instructions'] in read['result']['content'][0]['text']
        elif kind == 'tool':
            assert json.loads(read['result']['content'][0]['text']) == 2
        else:
            assert json.loads(read['result']['details']['result']['text']) == 2
        assert not records(tmp_path, 'task-baseline-method-reads.jsonl')
