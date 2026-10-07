"""Real original author call and exact registry identities; scripted native provider."""
import copy
import hashlib
import json
import os

from test_harness_argument_integrity_native import PROJECT, read_creator, run, tool_payloads
from test_task_research_context import records, results

FIXTURE = PROJECT / 'tests/fixtures/harness-stage135a-original-compute-call.json'


def test_original_valid_snake_case_call_publishes_trials_and_reaches_later_provider(tmp_path):
    source = json.loads(FIXTURE.read_text(encoding='utf-8'))
    call = source['call']
    source_env = {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)}
    if os.environ.get('PI_TOOL_NAME_RED_SOURCE'):
        source_env['PI_ARGUMENT_HARNESS_SOURCE'] = os.environ['PI_TOOL_NAME_RED_SOURCE']
    root = tmp_path / 'original'
    events, requests = run(root, [read_creator(), [call]], source_env)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    receipt = attempt['result']['details']
    expected = {'colors': [5, 4, 5, 5]}
    assert receipt['trial']['tool_ref'] == 'tool:arc_pixel_color@v1'
    assert json.loads(receipt['trial']['result']['content'][0]['text']) == expected
    stored = records(root, 'task-tools.jsonl')[0]
    original = call['arguments']['candidate']['program']
    assert stored['program']['expression'] == original['expression']
    assert stored['program']['format'] == original['format']
    assert stored['program_limits_requested'] == original['limits']
    assert stored['program_authored_sha256'] == hashlib.sha256(
        json.dumps(original, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    assert stored['name'] == 'arc_pixel_color' and stored['exposed_name'] == 'task_tool_arc_pixel_color_v1'
    assert len(requests) == 3
    assert any(json.loads(v['trial']['result']['content'][0]['text']) == expected
               for v in tool_payloads(requests[2]) if v.get('trial', {}).get('status') == 'completed')


def test_hyphen_and_underscore_names_keep_distinct_versions_and_native_invocation(tmp_path):
    call = json.loads(FIXTURE.read_text(encoding='utf-8'))['call']
    other = copy.deepcopy(call)
    other['arguments']['candidate']['name'] = 'arc-pixel-color'
    other['arguments']['assembly'] = {'expected_assembly_revision': 1,
        'selected_resource_refs': ['tool:arc_pixel_color@v1']}
    root = tmp_path / 'distinct'
    invocations = [
        {'name': 'task_tool_arc_pixel_color_v1', 'arguments': call['arguments']['trial']},
        {'name': 'task_tool_arc-pixel-color_v1', 'arguments': {
            **call['arguments']['trial'], 'parameters': {'coords': [[32, 45], [30, 45]]}}},
    ]
    events, _ = run(root, [read_creator(), [call], [other], invocations],
                    {'PI_ARGUMENT_PUBLIC_SNAPSHOT': str(FIXTURE)})
    stored = records(root, 'task-tools.jsonl')
    assert [(x['name'], x['version'], x['exposed_name']) for x in stored] == [
        ('arc_pixel_color', 1, 'task_tool_arc_pixel_color_v1'),
        ('arc-pixel-color', 1, 'task_tool_arc-pixel-color_v1')]
    for item, expected in zip(invocations, [[5, 4, 5, 5], [4, 5]]):
        attempt = results(events, item['name'])[0]
        assert not attempt.get('isError'), attempt
        assert json.loads(attempt['result']['content'][0]['text']) == {'colors': expected}
