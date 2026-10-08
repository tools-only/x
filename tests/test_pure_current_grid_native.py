"""Current-grid convenience via real Pi and scripted HTTP; no behavior/benefit claim."""
import json
import pytest

from test_arc_creator_grid_handoff_native import state
from test_harness_argument_integrity_native import run, tool_payloads
from test_task_research_context import records, results


def create(trial=None, *, closed=False):
    candidate = {'name': 'current-pixel', 'description': 'Compute from the final observed pixel',
                 'program': {'format': 'task-pure-python-v1',
                             'source': "{'value': input['grid'][0][0] + input['bias']}"}}
    if closed:
        candidate['input_schema'] = {'type': 'object', 'properties': {'bias': {'type': 'number'}},
                                     'required': ['bias'], 'additionalProperties': False}
    return {'name': 'task_harness_create', 'arguments': {
        'candidate': candidate,
        'trial': trial if trial is not None else {'current_grid': True, 'parameters': {'bias': 1}},
    }}


def value(result):
    return json.loads(result['content'][0]['text'])


@pytest.mark.parametrize('closed', [False, True])
def test_create_install_trial_without_reads_then_refresh_current_and_keep_exact_history(tmp_path, closed):
    fixture = tmp_path / 'states.json'
    fixture.write_text(json.dumps([state([[[2]], [[8]]], 0)]), encoding='utf-8')
    env = {'PI_ARGUMENT_PUBLIC_SNAPSHOTS': str(fixture), 'PI_ARC_EXECUTION_GATE': 'enabled'}
    root = tmp_path / 'task'
    events, requests = run(root, [[create(closed=closed)]], env)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    trial = attempt['result']['details']['trial']
    assert trial['status'] == 'completed', trial
    assert value(trial['result']) == {'value': 9}
    provenance = trial['result']['details']['input_provenance']['bindings'][0]
    assert provenance['path'] == ['public_state', 'frames', '1']
    assert provenance['historical_or_stale'] is False
    assert any(value(p['trial']['result']) == {'value': 9} for p in tool_payloads(requests[1])
               if p.get('trial', {}).get('status') == 'completed')
    assert not records(root, 'task-baseline-method-reads.jsonl')
    assert not records(root, 'task-resource-access.jsonl')
    tool = records(root, 'task-tools.jsonl')[0]
    if closed:
        assert tool['input_schema']['properties']['grid']['type'] == 'array'
    fixture.write_text(json.dumps([state([[[3]], [[15]]], 1)]), encoding='utf-8')
    historical = {k: provenance[k] for k in ('name', 'ref', 'path')}
    calls = [[{'name': tool['exposed_name'], 'arguments': {'current_grid': True, 'parameters': {'bias': 1}}}],
             [{'name': tool['exposed_name'], 'arguments': {'parameters': {'bias': 1}, 'bindings': [historical]}}]]
    calls += [[{'name': tool['exposed_name'], 'arguments': {'current_grid': invalid, 'parameters': {'bias': 1}}}]
              for invalid in ('true', None, 1)]
    later, later_requests = run(root, calls, env, resume=True)
    attempts = results(later, tool['exposed_name'])
    assert len(attempts) == 5
    assert all(item.get('isError') and 'boolean' in json.dumps(item) for item in attempts[2:])
    executions = attempts[:2]
    assert all(not item.get('isError') for item in executions), executions
    assert [value(item['result']) for item in executions] == [{'value': 16}, {'value': 9}]
    current, old = [item['result']['details']['input_provenance']['bindings'][0] for item in executions]
    assert current['ref'] != old['ref'] == provenance['ref']
    assert old['historical_or_stale'] is True and current['historical_or_stale'] is False
    assert any(p == {'value': 16} for p in tool_payloads(later_requests[1]))


def test_invalid_shortcut_types_and_conflicts_do_not_publish(tmp_path):
    trials = [{'current_grid': v} for v in ('true', None, 1, {}, [])]
    trials += [{'current_grid': True, 'parameters': {'grid': [[1]], 'bias': 1}},
               {'current_grid': True, 'bindings': [{'name': 'grid',
                'ref': 'observation_snapshot:parent-state-1@v1', 'path': ['public_state', 'frames', '0']}]}]
    root = tmp_path / 'task'
    events, _ = run(root, [[create(trial)] for trial in trials])
    attempts = results(events, 'task_harness_create')
    assert len(attempts) == len(trials) and all(item.get('isError') for item in attempts)
    assert not records(root, 'task-tools.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')


def test_empty_current_grid_reports_failed_trial_without_undoing_publication(tmp_path):
    fixture = tmp_path / 'states.json'
    fixture.write_text(json.dumps([state([], 0)]), encoding='utf-8')
    root = tmp_path / 'task'
    events, _ = run(root, [[create()]], {'PI_ARGUMENT_PUBLIC_SNAPSHOTS': str(fixture)})
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    trial = attempt['result']['details']['trial']
    assert trial['status'] == 'failed'
    assert 'nonempty final grid' in json.dumps(trial)
    assert len(records(root, 'task-tools.jsonl')) == 1
    assert len(records(root, 'task-harness-assemblies.jsonl')) == 1
