"""Exact creator data handoff through Pi; no autonomous/provider benefit claim."""
import copy
import json
import pytest

from test_harness_argument_integrity_native import run, read_creator, tool_payloads
from test_task_research_context import records, results


def state(frames, actions):
    return {'game_id': 'public-fixture', 'guid': 'same-environment', 'state': 'NOT_FINISHED',
            'levels_completed': 0, 'frames': frames,
            'action_budget': {'total_used': actions, 'used': actions, 'level': 0}}


def creator_from(request):
    return next(value for value in tool_payloads(request)
                if value.get('format') == 'baseline-method-read-v1')


def test_current_binding_uses_final_numeric_frame_and_reaches_later_parent(tmp_path):
    fixture = tmp_path / 'states.json'
    fixture.write_text(json.dumps([state([[[1]], [[8]]], 0)]), encoding='utf-8')
    captured = {}

    def author(request):
        creator = creator_from(request)
        captured.update(creator)
        call = copy.deepcopy(creator['authoring_template']['authoring_call'])
        call['name'] = call.pop('tool')
        call['arguments']['candidate'].update(name='final-value', description='Read exact final pixel')
        call['arguments']['candidate']['program']['source'] = "{'value': input['grid'][0][0]}"
        return [call]

    root = tmp_path / 'task'
    events, requests = run(root, [read_creator(), author], {
        'PI_ARGUMENT_PUBLIC_SNAPSHOTS': str(fixture), 'PI_ARC_EXECUTION_GATE': 'enabled'})
    template = captured['authoring_template']
    assert template['authoring_call']['arguments']['trial']['bindings'] == [
        {'name': 'grid', 'ref': 'observation_snapshot:parent-state-1@v1',
         'path': ['public_state', 'frames', '1']}]
    assert 'earlier_input' not in template
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    receipt = attempt['result']['details']
    assert json.loads(receipt['trial']['result']['content'][0]['text']) == {'value': 8}
    assert any(json.loads(value['trial']['result']['content'][0]['text']) == {'value': 8}
               for value in tool_payloads(requests[2]) if value.get('trial', {}).get('status') == 'completed')
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1
    assert not records(root, 'task-resource-access.jsonl')


def test_earlier_locator_skips_same_action_capture_and_remains_exact_on_restart(tmp_path):
    fixture = tmp_path / 'states.json'
    fixture.write_text(json.dumps([
        state([[[2]], [[3]]], 0),
        state([[[4]], [[8]]], 2),
        state([[[5]], [[9]]], 2),
    ]), encoding='utf-8')
    captured = {}

    def author(request):
        creator = creator_from(request)
        captured.update(creator)
        template = copy.deepcopy(creator['authoring_template'])
        call = template['authoring_call']
        call['name'] = call.pop('tool')
        call['arguments']['trial']['bindings'].append(template['earlier_input']['binding'])
        call['arguments']['candidate'].update(name='two-frame-value', description='Compare captured final pixels')
        call['arguments']['candidate']['program']['source'] = "{'difference': input['grid'][0][0] - input['earlier_grid'][0][0]}"
        return [call]

    root = tmp_path / 'task'
    env = {'PI_ARGUMENT_PUBLIC_SNAPSHOTS': str(fixture), 'PI_ARC_EXECUTION_GATE': 'enabled'}
    events, requests = run(root, [read_creator(), author], env)
    earlier = captured['authoring_template']['earlier_input']
    assert earlier['binding'] == {'name': 'earlier_grid', 'ref': 'observation_snapshot:parent-state-1@v1',
                                 'path': ['public_state', 'frames', '1']}
    assert earlier['total_used'] == 0 and earlier['level'] == 0
    assert 'previous action' not in json.dumps(earlier)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    assert json.loads(attempt['result']['details']['trial']['result']['content'][0]['text']) == {'difference': 6}
    assert any(json.loads(value['trial']['result']['content'][0]['text']) == {'difference': 6}
               for value in tool_payloads(requests[2]) if value.get('trial', {}).get('status') == 'completed')
    actual_call = json.loads(next(item['function']['arguments'] for message in requests[2]['messages']
                                 for item in message.get('tool_calls', [])
                                 if item['function']['name'] == 'task_harness_create'))
    stored = records(root, 'task-tools.jsonl')[0]
    fixture.write_text(json.dumps([state([[[15]]], 3)]), encoding='utf-8')
    later, _ = run(root, [[{'name': stored['exposed_name'], 'arguments': actual_call['trial']}]], env, resume=True)
    execution = results(later, stored['exposed_name'])[0]
    assert not execution.get('isError'), execution
    assert json.loads(execution['result']['content'][0]['text']) == {'difference': 6}
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1
    assert not records(root, 'task-resource-access.jsonl')


DIFF_SOURCE = '(lambda a, b: (lambda rows: {"row_changes": [row for row in rows if not(len(row["changes"]) == 0)]})([(lambda ar, br: (lambda cells: {"y": y, "changes": [cell for cell in cells if not(cell[1] == cell[2])]})([[x, ar[x], br[x]] for x in range(len(ar))]))(a[y], b[y]) for y in range(len(a))]))(input["earlier_grid"], input["grid"])'
COUNT_SOURCE = '(lambda a,b:{"changed_per_row":[[y,len([x for x in range(len(a[y])) if not(a[y][x]==b[y][x])])] for y in range(len(a))]})(input["earlier_grid"],input["grid"])'


@pytest.mark.parametrize('changed,compact', [(0,False), (1,False), (4096,False), (4096,True)])
def test_prepared_frames_execute_reusable_diff_with_default_budgets(tmp_path, changed, compact):
    before = [[15] * 64 for _ in range(64)]
    after = copy.deepcopy(before)
    for offset in range(changed):
        after[offset // 64][offset % 64] = 14
    # Distractor animation frame makes hardcoded frames[0] observably wrong.
    fixture = tmp_path / 'states.json'
    fixture.write_text(json.dumps([state([before], 0), state([before, after], 1)]), encoding='utf-8')

    def author(request):
        template = copy.deepcopy(creator_from(request)['authoring_template'])
        call = template['authoring_call']
        call['name'] = call.pop('tool')
        call['arguments']['trial']['bindings'].append(template['earlier_input']['binding'])
        call['arguments']['candidate'].update(name='frame-diff', description='Exact differences between captured numeric frames')
        call['arguments']['candidate']['program']['source'] = COUNT_SOURCE if compact else DIFF_SOURCE
        return [call]

    root = tmp_path / 'task'
    events, requests = run(root, [read_creator(), author], {
        'PI_ARGUMENT_PUBLIC_SNAPSHOTS': str(fixture), 'PI_ARC_EXECUTION_GATE': 'enabled'})
    expected = {'row_changes': []}
    for y in range(64):
        changes = [[x, before[y][x], after[y][x]] for x in range(64) if before[y][x] != after[y][x]]
        if changes:
            expected['row_changes'].append({'y': y, 'changes': changes})
    if compact:
        expected = {'changed_per_row': [[y, sum(before[y][x] != after[y][x] for x in range(64))] for y in range(64)]}
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    trial = attempt['result']['details']['trial']
    assert trial['status'] == 'completed', trial
    semantic_text = trial['result']['content'][0]['text']
    assert json.loads(semantic_text) == expected
    if compact:
        assert len(semantic_text) < 600
    assert any(json.loads(value['trial']['result']['content'][0]['text']) == expected
               for value in tool_payloads(requests[2]) if value.get('trial', {}).get('status') == 'completed')
    stored = records(root, 'task-tools.jsonl')[0]
    assert stored['program_source_evidence']['source'] == (COUNT_SOURCE if compact else DIFF_SOURCE)
    assert stored['program']['limits']['steps'] == 250000
    assert stored['program']['limits']['constructed_elements'] == 100000
    assert stored['program']['limits']['output_bytes'] == 65536
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1
    assert not records(root, 'task-resource-access.jsonl')
