"""Context recipe omission is distinct from explicitly authored null values."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


@pytest.mark.parametrize('field', ['recent_observations', 'recent_actions', 'max_chars', 'inherit_harness_refs'])
@pytest.mark.parametrize('interface', ['facade', 'native'])
def test_null_recipe_default_is_rejected_before_publication(tmp_path, field, interface):
    project = Path(__file__).resolve().parents[1]
    candidate = {'component': 'subagent', 'name': 'explicit-context',
                 'description': 'Compare only the selected evidence.',
                 'instructions': 'Return a bounded uncertainty or counterexample.',
                 'tools': [], 'context_recipe': {field: None}}
    call = {'name': 'task_harness_create', 'arguments': {'candidate': candidate, 'assembly': True}}
    if interface == 'native':
        native = {key: value for key, value in candidate.items() if key != 'component'}
        call = {'name': 'task_subagent', 'arguments': {'action': 'create', **native}}
    events = _run_fixture(tmp_path, 'treatment', extra_extensions=[project / 'tests/pi_non_arc_task_subagents.ts'], steps=[call])
    result = results(events, call['name'])[-1]
    assert result.get('isError'), result
    assert f'context_recipe.{field}' in json.dumps(result['result'])
    assert not records(tmp_path, 'task-subagents.jsonl')
    assert not records(tmp_path, 'task-harness-assemblies.jsonl')
    assert not records(tmp_path, 'subagent-invocations.jsonl')
    assert records(tmp_path, 'task-operation-failures.jsonl')[-1]['applied'] is False
    assert not records(tmp_path, 'task-operation-failures.jsonl')[-1].get('required_next_call')
