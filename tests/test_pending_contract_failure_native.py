"""Native reproduction: rejected inputs cannot be repaired by an exact-input retry."""
import json
import pytest
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_harness_batch_preflight import run_changes, stage45
from test_arc_selected_snapshot_native import FIRST, run as run_scene, seed, read_rows


def test_observed_sdk_binding_rejection_is_terminal_before_next_parent_request(tmp_path):
    project = Path(__file__).resolve().parents[1]
    call = json.loads((project / 'tests/fixtures/harness-stage138-observed-live-create-call.json').read_text())['call']
    call['arguments']['trial']['bindings'] = {}
    events = _run_fixture(tmp_path, 'treatment', steps=[call,
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'decision_state': {'knowledge_gaps': ['Continue the task without authoring']}}}])
    ends = [e for e in events if e.get('type') == 'tool_execution_end']
    assert [bool(e.get('isError')) for e in ends] == [True, False]
    failure = read_rows(tmp_path, 'task-operation-failures.jsonl')[0]
    assert failure['applied'] is False
    assert failure['retryable'] is False
    assert not failure.get('required_next_call')
    # Check the actual request immediately after rejection, before a later
    # successful operation could conceal an obsolete repair obligation.
    context = read_rows(tmp_path, 'provider-contexts.jsonl')[1]['context']
    cards = [part['text'] for message in context['messages'] for part in message.get('content', [])
             if part.get('type') == 'text' and 'task-decision-card-v2' in part['text']]
    assert cards and all('"pending_operations":[]' in card for card in cards)
    assert not read_rows(tmp_path, 'task-tools.jsonl')
    assert not read_rows(tmp_path, 'subagent-invocations.jsonl')
    assert not json.loads((tmp_path / 'task-checkpoint.json').read_text()).get('pending_operations')


def test_new_sdk_rejection_preserves_older_unknown_execution_with_same_identity(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _run_fixture(tmp_path, 'treatment', extra_extensions=[project / 'tests/pi_pending_side_effect_fixture.ts'], steps=[
        {'name': 'task_tool', 'arguments': {'action': 'update', 'key': 'same-target', 'fail': True}},
        {'name': 'task_tool', 'arguments': {'action': 'update', 'key': 'same-target', 'fail': 'invalid'}},
    ])
    failures = read_rows(tmp_path, 'task-operation-failures.jsonl')
    assert len(failures) == 2
    assert failures[0]['applied'] == 'unknown' and failures[0]['retryable'] is True
    assert failures[1]['applied'] is False and failures[1]['retryable'] is False
    assert failures[0]['operation_key'] == failures[1]['operation_key']
    pending = json.loads((tmp_path / 'task-checkpoint.json').read_text())['pending_operations']
    assert [item['resource_ref'] for item in pending] == [failures[0]['resource_ref']]
    assert len(read_rows(tmp_path, 'side-effect-entered.jsonl')) == 1
    later = read_rows(tmp_path, 'provider-contexts.jsonl')[1]['context']
    card = next(p['text'] for m in later['messages'] for p in m.get('content', [])
                if p.get('type') == 'text' and 'task-decision-card-v2' in p.get('text', ''))
    assert 'FULL_EXECUTION_DETAIL' not in card and '"applied":"unknown"' in card


def test_rejected_binding_can_be_corrected_as_new_publication_without_inspection(tmp_path):
    from test_pure_publication_trial_native import setup, top_level_publication
    from test_task_pure_expression_native import run
    invalid = top_level_publication()
    invalid['arguments']['trial']['bindings'] = {}
    events = run(tmp_path, setup() + [invalid, top_level_publication()])
    attempts = [e for e in events if e.get('type') == 'tool_execution_end'
                and e.get('toolName') == 'task_harness_create']
    assert [bool(e.get('isError')) for e in attempts] == [True, False]
    assert json.loads(attempts[-1]['result']['details']['trial']['result']['content'][0]['text']) is True
    assert len(read_rows(tmp_path, 'task-tools.jsonl')) == 1
    assert not json.loads((tmp_path / 'task-checkpoint.json').read_text()).get('pending_operations')


def test_sdk_error_is_short_in_actual_input_and_exact_error_remains_readable(tmp_path):
    project = Path(__file__).resolve().parents[1]
    call = json.loads((project / 'tests/fixtures/harness-stage138-observed-live-create-call.json').read_text())['call']
    call['arguments']['trial']['bindings'] = {}
    events = _run_fixture(tmp_path, 'treatment', steps=[call,
        {'name': 'task_resource', 'arguments': {'action': 'read', 'ref': 'failure:failure-1@v1', 'limit': 16000}},
        {'name': 'benchmark_probe', 'arguments': {}},
        {'name': 'benchmark_probe', 'arguments': {}},
    ], followup_prompt='Continue after the completed evidence response.')
    failure = read_rows(tmp_path, 'task-operation-failures.jsonl')[0]
    context = read_rows(tmp_path, 'provider-contexts.jsonl')[1]['context']
    result = next(m for m in context['messages'] if m.get('role') == 'toolResult'
                  and m.get('toolName') == 'task_harness_create')
    text = '\n'.join(p.get('text', '') for p in result['content'])
    assert len(text) <= 1200
    assert 'trial.bindings' in text and 'must be array' in text
    assert 'failure:failure-1@v1' in text and 'Received arguments:' not in text
    assert len(failure['error']) == 5231 and failure['attempted_input'] == call['arguments']
    reads = [e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'task_resource']
    assert len(reads) == 1 and not reads[0].get('isError')
    assert 'Received arguments:' in json.dumps(reads[0]['result'])
    page = json.loads(reads[0]['result']['content'][0]['text'])
    assert json.loads(page['text'])['error'] == failure['error']
    later = read_rows(tmp_path, 'provider-contexts.jsonl')[-1]['context']
    assert not any('Received arguments:' in p.get('text', '')
                   for m in later['messages'] for p in m.get('content', []))


def test_native_schema_rejection_ends_checkpoint_attempt_without_pending(tmp_path):
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_checkpoint', 'arguments': {}},
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'decision_state': {'knowledge_gaps': ['Identify the actual goal condition']}}},
    ])
    ends = [x for x in events if x.get('type') == 'tool_execution_end']
    assert [bool(x.get('isError')) for x in ends] == [True, False]
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text())
    assert checkpoint['decision_state']['knowledge_gaps'] == ['Identify the actual goal condition']
    assert not checkpoint.get('pending_operations')
    failures = [json.loads(l) for l in (tmp_path / 'task-operation-failures.jsonl').read_text().splitlines()]
    assert len(failures) == 1 and failures[0]['applied'] is False


def test_delegate_native_schema_rejection_does_not_leave_pending(tmp_path):
    seed(tmp_path)
    events = run_scene(tmp_path, delegate_overrides={'unsupported_field': 'must reject'})
    call = next(e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'delegate_task')
    assert call.get('isError')
    assert not read_rows(tmp_path, 'subagent-invocations.jsonl')
    assert not read_rows(tmp_path, 'subagent-context-bindings.jsonl')
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
    assert not checkpoint.get('pending_operations')
    failure = read_rows(tmp_path, 'task-operation-failures.jsonl')[-1]
    assert failure['applied'] is False and failure['retryable'] is False


@pytest.mark.parametrize('explicit_recipe', [False, True])
def test_delegate_output_contract_alias_reaches_child_without_permission_changes(tmp_path, explicit_recipe):
    seed(tmp_path)
    output = 'Return the granted frame row count and exact first cell; do not act.'
    overrides = {'output_contract': output}
    if explicit_recipe:
        overrides['context_recipe'] = {'output_contract': output, 'max_chars': 12000}
    events = run_scene(tmp_path, [FIRST], delegate_overrides=overrides)
    call = next(e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'delegate_task')
    assert not call.get('isError')
    invocation = read_rows(tmp_path, 'subagent-invocations.jsonl')[-1]
    result = json.loads(invocation['result']['text'])
    assert result['rows'] == 16 and result['columns'] == 20 and result['first_cell'] == 4
    binding = read_rows(tmp_path, 'subagent-context-bindings.jsonl')[-1]
    assert binding['context_recipe']['output_contract'] == output
    assert binding['effective_tools'] == [] and not binding.get('action_authorization')
    contexts = read_rows(tmp_path, 'subagent-provider-contexts.jsonl')
    assert any('Required output: ' + output in json.dumps(row['context']) for row in contexts)
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
    assert not checkpoint.get('pending_operations')


@pytest.mark.parametrize('bad', [
    {'output_contract': {'format': 'not text'}},
    {'output_contract': 'A', 'context_recipe': {'output_contract': 'B'}},
    {'output_contract': 'A', 'context_recipe': {'include': ['grid']}},
    {'context_recipe': {'include': ['grid']}},
])
def test_delegate_rejects_ambiguous_or_unsupported_context_before_any_child(tmp_path, bad):
    seed(tmp_path)
    events = run_scene(tmp_path, [FIRST], delegate_overrides=bad)
    call = next(e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'delegate_task')
    assert call.get('isError')
    for name in ('subagent-invocations.jsonl', 'subagent-context-bindings.jsonl', 'subagent-provider-contexts.jsonl'):
        assert not read_rows(tmp_path, name)
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
    assert not checkpoint.get('pending_operations')
    failure = read_rows(tmp_path, 'task-operation-failures.jsonl')[-1]
    assert failure['applied'] is False and failure['retryable'] is False


def test_corrected_checkpoint_update_does_not_leave_an_impossible_repair_obligation(tmp_path):
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'knowledge_gaps': ['Conflicting text'], 'decision_state': {'knowledge_gaps': ['Find the goal']}}},
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'decision_state': {'knowledge_gaps': ['Find the goal']}}},
    ])
    ends = [x for x in events if x.get('type') == 'tool_execution_end']
    assert [bool(x.get('isError')) for x in ends] == [True, False]
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text())
    assert checkpoint['decision_state']['knowledge_gaps'] == ['Find the goal']
    assert not checkpoint.get('pending_operations')
    failures = [json.loads(l) for l in (tmp_path / 'task-operation-failures.jsonl').read_text().splitlines()]
    assert len(failures) == 1  # Failure/cost evidence remains durable.


def test_preflight_repaired_batch_does_not_request_an_extra_harness_inspection(tmp_path):
    corrected = stage45('last')
    corrected[1]['candidate']['scope'] = 'public evidence checks within this task'
    events = run_changes(tmp_path, stage45('first'), more=[
        {'name': 'task_harness', 'arguments': {'action': 'change', 'changes': corrected,
            'assembly': {'expected_assembly_revision': 0, 'selected_resource_refs': []}}},
    ])
    ends = [x for x in events if x.get('type') == 'tool_execution_end' and x.get('toolName') == 'task_harness']
    assert ends[-2]['isError'] and not ends[-1]['isError']
    checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text())
    assert not checkpoint.get('pending_operations')
    assert (tmp_path / 'task-operation-failures.jsonl').is_file()
