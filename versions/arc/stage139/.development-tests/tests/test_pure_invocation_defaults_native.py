"""Default-envelope/native rejection checks; not ARC behavior or benefit proof."""
import json
from test_harness_argument_integrity_native import PROJECT, run, read_creator, tool_payloads
from test_task_research_context import records, results

FIXTURE = PROJECT / 'tests/fixtures/harness-stage138-observed-live-create-call.json'


def test_observed_live_call_reaches_compact_preflight_without_empty_binding_requirement(tmp_path):
    root = tmp_path / 'task'
    call = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']
    events, requests = run(root, [read_creator(), [call]])
    attempt = results(events, 'task_harness_create')[0]
    assert attempt.get('isError'), attempt
    text = attempt['result']['content'][0]['text']
    assert 'Received arguments:' not in text, text
    payload = json.loads(text)
    assert payload['no_component_written'] is True
    assert payload.get('issues') and 'source' in text
    assert len(text) < 2000
    assert not records(root, 'task-tools.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')
    # Keep the exact submitted program and the creator in the later native
    # provider context; avoiding the echo must not require re-reading them.
    assert len(requests) == 3
    assert any(call['arguments']['candidate']['program']['source'] ==
               json.loads(item['function']['arguments'])['candidate']['program']['source']
               for message in requests[2]['messages'] for item in message.get('tool_calls', [])
               if item['function']['name'] == 'task_harness_create')
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1


def test_empty_trial_and_empty_later_invocation_use_existing_host_defaults(tmp_path):
    root = tmp_path / 'task'
    call = {'name': 'task_harness_create', 'arguments': {
        'candidate': {'name': 'constant-probe', 'description': 'Return a fixed semantic value',
                      'program': {'format': 'task-pure-python-v1', 'source': "{'value': 7}"}},
        'assembly': True, 'trial': {},
    }}
    events, requests = run(root, [read_creator(), [call]])
    receipt = results(events, 'task_harness_create')[0]
    assert not receipt.get('isError'), receipt
    assert json.loads(receipt['result']['details']['trial']['result']['content'][0]['text']) == {'value': 7}
    stored = records(root, 'task-tools.jsonl')[0]
    assert any(json.loads(value['trial']['result']['content'][0]['text']) == {'value': 7}
               for value in tool_payloads(requests[2]) if value.get('trial', {}).get('status') == 'completed')
    later, _ = run(root, [[{'name': stored['exposed_name'], 'arguments': {}}]], resume=True)
    execution = results(later, stored['exposed_name'])[0]
    assert not execution.get('isError'), execution
    assert json.loads(execution['result']['content'][0]['text']) == {'value': 7}
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1


def test_explicit_wrong_envelope_types_remain_write_free(tmp_path):
    root = tmp_path / 'task'
    calls = [{'name': 'task_harness_create', 'arguments': {
        'candidate': {'name': 'bad-envelope', 'description': 'Must not be published',
                      'program': {'format': 'task-pure-python-v1', 'source': "{'value': 7}"}},
        'assembly': True, 'trial': trial,
    }} for trial in [{'parameters': []}, {'parameters': None}, {'bindings': {}},
                    {'bindings': None}, {'bindings': 'bad'}, {'extra': True}]]
    events, _ = run(root, [read_creator(), *[[call] for call in calls]])
    attempts = results(events, 'task_harness_create')
    assert len(attempts) == len(calls) and all(item.get('isError') for item in attempts)
    assert not records(root, 'task-tools.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')
