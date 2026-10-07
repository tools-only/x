"""A semantic candidate can commit its base before its prompt overlay fails."""
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]


def test_partial_overlay_recovery_preserves_base_and_retries_only_missing_prompt(tmp_path):
    candidate = {'semantic_kind': 'procedure', 'execution': 'text', 'name': 'late-overlay',
                 'description': 'Review the latest delta.', 'instructions': 'Compare competing predictions.',
                 'content': 'Compare competing predictions.', 'scope': 'this task',
                 'prompt_channel': 'system_prompt', 'basis_refs': ['observation:validated@v1'],
                 'system_prompt_basis': {'evidence_refs': ['observation:validated@v1']}}
    decision = {'basis_refs': ['observation:validated@v1'], 'reason': 'Reuse an authored method and overlay.',
                'expected': 'Both precise versions enter the pool.'}
    events = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'skill-creator'}},
        {'name': 'task_harness', 'arguments': {'action': 'change',
            'changes': [{'operation': 'create', 'candidate': candidate}], 'decision': decision}},
    ], extra_extensions=[PROJECT / 'tests/pi_failed_skill_mutation.ts'])
    calls = results(events, 'task_harness')
    assert calls[1].get('isError'), calls[1]
    failure = calls[1]['result']['details']
    assert failure['applied_resource_refs'] == ['skill:late-overlay@v1']
    assert len(failure['remaining_changes']) == 1, failure
    remaining = failure['remaining_changes'][0]
    assert remaining['operation'] == 'create'
    assert remaining['candidate']['component'] == 'system_prompt'
    assert remaining['candidate']['content'] == candidate['content']
    repaired = _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness', 'arguments': {'action': 'change',
            'changes': failure['remaining_changes'], 'decision': decision}}])
    output = results(repaired, 'task_harness')[-1]
    assert not output.get('isError'), output
    assert len(records(tmp_path, 'task-skills.jsonl')) == 1
    assert len(records(tmp_path, 'task-system-prompt.jsonl')) == 1
    intent = next(row for row in records(tmp_path, 'task-harness-conversion-intents.jsonl')
                  if row.get('phase') == 'apply_failed')
    assert intent['remaining_changes'] == failure['remaining_changes']
