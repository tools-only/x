"""One-off delegation contracts through native Pi/child, including length."""
import json
import pytest

from test_harness_direct_use_native import child_env
from test_harness_argument_integrity_native import run
from test_task_research_context import records, results


def call(**options):
    return {'name': 'delegate_task', 'arguments': {'task': 'Read fixture readiness once.', **options}}


def test_one_off_returns_semantic_report_with_direct_contract_and_no_saved_role(tmp_path):
    root = tmp_path / 'task'
    with child_env() as env:
        events, _ = run(root, [[call(output_contract='Return ready and conclusion.',
            stop_when='Readiness is known or unavailable; return the limitation.',
            budget={'max_tool_calls': 2, 'max_runtime_ms': 60000, 'max_reported_tokens': 1000},
            context_recipe={'include_checkpoint': False})]], env)
    result = results(events, 'delegate_task')[0]
    assert not result.get('isError'), result
    detail = result['result']['details']
    assert json.loads(detail['result']['text']) == {'ready': True, 'conclusion': 'fixture-state:ready'}
    assert detail['ephemeral'] and detail['component_ref'] is None
    assert detail['budget']['limits']['max_tool_calls'] == 2
    assert detail['budget']['tool_calls'] == 1 and detail['budget']['reported_tokens'] == 32
    assert not records(root, 'task-subagents.jsonl') and not records(root, 'task-harness-assemblies.jsonl')
    prompt = next((root / '.task-child-prompts').glob('*.txt')).read_text(encoding='utf-8')
    assert 'Stop when: Readiness is known' in prompt and 'Return ready and conclusion.' in prompt
    assert 'Canonical role resource: subagent:ephemeral' not in prompt


@pytest.mark.parametrize('budget', [{'max_tool_calls': 0}, {'max_runtime_ms': -1},
    {'max_reported_tokens': '100'}, {'max_continuations': True}, {'unknown': 1}])
def test_invalid_call_budget_never_starts_child(tmp_path, budget):
    root = tmp_path / 'task'
    with child_env() as env:
        events, _ = run(root, [[call(budget=budget)]], env)
    assert results(events, 'delegate_task')[0].get('isError')
    assert not records(root, 'subagent-invocations.jsonl') and not records(root, 'subagent-progress.jsonl')


def test_token_allowance_is_shared_across_length_and_parent_can_continue(tmp_path):
    root = tmp_path / 'task'
    with child_env(PI_SUBAGENT_FORCE_LENGTH_ONCE='1') as env:
        events, _ = run(root, [[call(budget={'max_reported_tokens': 32})],
            [{'name': 'ingress_probe', 'arguments': {'marker': 'after-budget'}}]], env)
    assert results(events, 'delegate_task')[0].get('isError')
    invocation = records(root, 'subagent-invocations.jsonl')[0]
    assert invocation['budget']['reported_tokens'] == 32 and invocation['status'] == 'failed'
    assert 'reported-token budget' in invocation['error']
    assert not results(events, 'ingress_probe')[0].get('isError')


def test_parent_can_tighten_continuation_allowance_without_saving_role(tmp_path):
    root = tmp_path / 'task'
    with child_env(PI_SUBAGENT_FORCE_LENGTH_ONCE='1') as env:
        events, _ = run(root, [[call(budget={'max_continuations': 1})]], env)
    assert results(events, 'delegate_task')[0].get('isError')
    assert len(records(root, 'subagent-continuations.jsonl')) == 1
    assert not records(root, 'task-subagents.jsonl')
