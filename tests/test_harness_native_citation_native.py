"""The native compatibility entry keeps the facade's explicit-version contract."""
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


@pytest.mark.parametrize('kind', ['skill', 'tool', 'subagent'])
def test_native_explicit_stale_creator_citation_is_rejected_before_any_write(tmp_path, kind):
    params = {'action': 'create', 'name': 'stale-native-citation', 'description': 'Bounded diagnostic.',
              'authoring_method_ref': f'baseline_method:{kind}-creator@sha256:' + '0' * 64}
    if kind in ['skill', 'subagent']:
        params['instructions'] = 'Return one bounded uncertainty.'
        if kind == 'subagent':
            params['tools'] = []
    else:
        params.update(input_schema={'type': 'object', 'properties': {}, 'additionalProperties': False},
            output_schema={'type': 'integer'}, program={'format': 'task-pure-expression-v1', 'limits': {},
                'expression': {'op': 'literal', 'value': 2}})
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, 'treatment', steps=[{'name': 'task_' + kind, 'arguments': params}],
        extra_extensions=[project / 'tests/pi_task_tool_fixture.ts', project / 'tests/pi_non_arc_task_subagents.ts'])
    error = results(events, 'task_' + kind)[-1]
    assert error.get('isError'), error
    assert not records(tmp_path, {'skill': 'task-skills.jsonl', 'tool': 'task-tools.jsonl',
                                 'subagent': 'task-subagents.jsonl'}[kind])
    failures = records(tmp_path, 'task-operation-failures.jsonl')
    assert failures[-1]['applied'] is False
    assert failures[-1]['retryable'] is False
    assert not failures[-1].get('required_next_call')
