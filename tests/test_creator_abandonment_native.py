"""Creator availability is a capability, not a debt owed by the parent."""
import json
import pytest

from test_task_pure_expression_native import run
from test_pure_publication_trial_native import setup, top_level_publication
from test_task_research_context import records, results


@pytest.mark.parametrize('reject_first', [False, True], ids=['read-only', 'rejected-candidate'])
def test_parent_can_leave_creator_then_reuse_original_ref_without_obligation(tmp_path, reject_first):
    rejected = top_level_publication()
    rejected['arguments']['trial']['bindings'] = {}
    steps = setup() + ([rejected] if reject_first else []) + [
        {'name': 'benchmark_probe', 'arguments': {}},
        {'name': 'benchmark_probe', 'arguments': {}},
        top_level_publication(),
    ]
    events = run(tmp_path, steps)
    assert all(not row.get('isError') for row in results(events, 'benchmark_probe'))
    contexts = records(tmp_path, 'provider-contexts.jsonl')
    delivered = contexts[2]['context']
    receipt = next(m for m in delivered['messages'] if m.get('role') == 'toolResult'
                   and m.get('toolName') == 'task_harness')
    method = json.loads(receipt['content'][0]['text'])
    assert method['method_ref'].startswith('baseline_method:tool-creator@')
    for item in contexts[2:]:
        texts = [p.get('text', '') for m in item['context']['messages'] for p in m.get('content', [])]
        assert not any('UNFINISHED CREATOR PREPARATION' in text for text in texts)
    expired = next(m for m in contexts[3]['context']['messages'] if m.get('role') == 'toolResult'
                   and m.get('toolName') == 'task_harness')
    assert method['content'] not in '\n'.join(p.get('text', '') for p in expired['content'])
    assert expired['details']['transient_expired'] is True
    assert not results(events, 'task_harness_create')[-1].get('isError')
    assert len(records(tmp_path, 'task-baseline-method-reads.jsonl')) == 1
    assert len(records(tmp_path, 'task-tools.jsonl')) == 1
