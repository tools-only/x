"""Real Pi hooks with scripted transport; no real model or ARC benefit claim."""
from pathlib import Path

from test_task_research_context import _run_fixture, records, results

PROBE = Path(__file__).resolve().parent / 'pi_scripted_transport_probe.ts'


def test_scripted_provider_uses_replaced_payload_and_reports_response(tmp_path):
    root = tmp_path / 'scripted-final-payload'
    events = _run_fixture(root, 'treatment', extra_extensions=[PROBE], steps=[
        {'name': 'benchmark_probe', 'arguments': {'progressed': False}},
    ])
    assert not results(events, 'benchmark_probe')[0].get('isError')
    contexts = records(root, 'provider-contexts.jsonl')
    assert contexts and all(row['context']['systemPrompt'] == 'LATE TRANSPORT REPLACEMENT' for row in contexts)
    lifecycle = records(root, 'scripted-transport-events.jsonl')
    assert [row['event'] for row in lifecycle] == ['final_payload', 'response'] * len(contexts)
    assert all(row['status'] == 200 for row in lifecycle if row['event'] == 'response')


def test_scripted_decline_never_advances_the_provider_or_executes_a_tool(tmp_path):
    root = tmp_path / 'scripted-declined-payload'
    events = _run_fixture(root, 'treatment', extra_extensions=[PROBE], steps=[
        {'name': 'benchmark_probe', 'arguments': {'progressed': False}},
    ], extra_env={'PI_SCRIPTED_PROBE_DECLINE': '1'})
    assert not records(root, 'provider-contexts.jsonl')
    assert not results(events, 'benchmark_probe')
    assert not any(row['event'] == 'response' for row in records(root, 'scripted-transport-events.jsonl'))
