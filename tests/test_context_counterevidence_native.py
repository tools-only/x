"""Pi working-set continuity diagnostics; scripted provider, no ARC quality claim."""
import json

from test_task_research_context import _run_fixture, records, results, current_decision_card


def test_rejected_candidate_counterevidence_survives_archive_and_exact_recovery(tmp_path):
    root = tmp_path / 'rejected-counterevidence'
    proof = 'The left probe changed the object but did not satisfy the goal.'
    events = _run_fixture(root, 'treatment', context_max_chars=18000, steps=[
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'candidate_updates': [{'id': 'left-solves', 'kind': 'goal', 'status': 'proposed',
                                   'claim': 'Moving left satisfies the goal.'}]}},
        {'name': 'benchmark_probe', 'arguments': {'progressed': False}},
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'candidate_updates': [{'id': 'left-solves', 'kind': 'goal', 'status': 'rejected',
                'evidence_refs': ['observation:execution-observation-1@v1'],
                'counterevidence': [{'fact': proof, 'source_ref': 'observation:execution-observation-1@v1'}]}],
            'decision_state': {'next_decision': 'Test the goal condition before repeating left.',
                               'knowledge_gaps': ['The goal condition remains untested.']}}},
        *[{'name': 'benchmark_probe', 'arguments': {'progressed': False}} for _ in range(7)],
    ])
    assert not any(row.get('isError') for row in results(events, 'task_checkpoint'))
    contexts = [row['context'] for row in records(root, 'provider-contexts.jsonl')]
    card = current_decision_card(contexts[-1])
    assert any(item.get('fact') == proof for item in card['counterevidence']), (
        'Rejecting a candidate erased the counterexample from the current working set')
    assert next(item for item in card['counterevidence'] if item.get('fact') == proof)['candidate_ref'] == 'strategy_candidate:left-solves@v2'
    assert 'strategy_candidate:left-solves@v2' in card['omitted_claim_refs']
    assert all(item['status'] != 'rejected' for item in card['active_claims'])
    assert card['next_decision'] == 'Test the goal condition before repeating left.'
    assert card['knowledge_gaps'] == ['The goal condition remains untested.']
    assert card['interpretation_status'] == 'agent_authored_not_runtime_fact'
    assert all(len(json.dumps(context['messages'], ensure_ascii=False, separators=(',', ':'))) <= 18000
               for context in contexts)
    assert any(row.get('message_refs') for row in records(root, 'task-context-cache/messages.jsonl'))

    recovered = _run_fixture(root, 'treatment', steps=[
        {'name': 'task_resource', 'arguments': {'action': 'read',
            'ref': 'strategy_candidate:left-solves@v2', 'limit': 8000}},
    ])
    assert not results(recovered, 'task_resource')[0].get('isError')
    assert proof in json.dumps(results(recovered, 'task_resource')[0]['result'])

    revised = _run_fixture(root, 'treatment', steps=[
        {'name': 'task_checkpoint', 'arguments': {'action': 'update',
            'candidate_updates': [{'id': 'left-solves', 'kind': 'goal', 'status': 'proposed',
                                   'counterevidence': []}]}},
    ])
    assert not results(revised, 'task_checkpoint')[0].get('isError')
    revised_context = records(root, 'provider-contexts.jsonl')[-1]['context']
    revised_card = current_decision_card(revised_context)
    assert not any(item.get('fact') == proof for item in revised_card['counterevidence'])
    assert 'strategy_candidate:left-solves@v2' not in revised_card['omitted_claim_refs']
    assert any(item.get('ref') == 'strategy_candidate:left-solves@v3'
               for item in revised_card['active_claims'])
    competition = next(json.loads(part['text'].split(': ', 1)[1])
        for message in revised_context['messages'] for part in message.get('content', [])
        if part.get('text', '').startswith('CURRENT COMPETITION VIEW: '))
    assert any(item['id'] == 'left-solves' and item['status'] == 'proposed'
               for item in competition['candidates'])
