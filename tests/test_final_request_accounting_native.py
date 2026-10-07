"""Final HTTP payload sizes are evidence, with binary image cost kept unknown."""
import json
import pytest

from test_harness_argument_integrity_native import run
from test_task_research_context import records
from test_harness_argument_integrity_native import read_creator
from test_task_pure_python_native import minimal_call


@pytest.mark.parametrize('image_content', [True, False], ids=['typed-image', 'uri-is-text'])
def test_http_image_transport_is_separate_from_text_and_schema_estimate(tmp_path, image_content):
    marker = 'image' if image_content else 'data:image/png;base64,' + 'A' * 200
    _, requests = run(tmp_path / 'task', [[{'name': 'ingress_probe', 'arguments': {'marker': marker}}]],
                      {'PI_ARGUMENT_TELEMETRY': '1'})
    assert len(requests) == 2
    debug = records(tmp_path / 'task', 'context-token-debug.jsonl')
    snapshots = [r for r in debug if r.get('event') == 'provider_request_context'
                 and r.get('measurement_basis') == 'provider_payload']
    assert len(snapshots) == 2
    first, image = snapshots
    assert first['image_count'] == 0
    assert image['image_count'] == int(image_content)
    if image_content:
        assert image['image_transport_chars'] > 80
        assert image['estimated_text_tokens'] < (image['context_json_chars'] + 3) // 4
        assert image['estimated_image_tokens'] is None and image['estimated_total_tokens'] is None
    else:
        assert image['image_transport_chars'] == 0
        assert image['estimated_text_tokens'] == (image['context_json_chars'] + 3) // 4
        assert image['estimated_image_tokens'] == 0
        assert image['estimated_total_tokens'] == image['estimated_text_tokens']
    assert image['token_estimate']['scope'] == 'text_and_schema_only'
    assert first['estimated_total_tokens'] == first['estimated_text_tokens']
    # Validate the final request against the independently captured HTTP body.
    message_chars = len(json.dumps(requests[1]['messages'], ensure_ascii=False, separators=(',', ':')).encode('utf-16-le')) // 2
    tool_chars = len(json.dumps(requests[1]['tools'], ensure_ascii=False, separators=(',', ':')).encode('utf-16-le')) // 2
    assert image['context_json_chars'] == message_chars + tool_chars
    assert image['tool_definition_count'] == len(requests[1]['tools'])
    usage = [r for r in debug if r.get('event') == 'provider_response_usage']
    assert len(usage) == 2 and all(r['actual_input_tokens'] == 10 for r in usage)
    assert {r['request_id'] for r in usage} == {r['request_id'] for r in snapshots}


def test_actual_request_accounting_tracks_newly_selected_dynamic_tool(tmp_path):
    call = minimal_call()
    name = f"task_tool_{call['arguments']['candidate']['name']}_v1"
    _, requests = run(tmp_path / 'task', [read_creator(), [call]], {'PI_ARGUMENT_TELEMETRY': '1'})
    last_names = [t['function']['name'] for t in requests[-1]['tools']]
    assert name in last_names
    assert name not in [t['function']['name'] for t in requests[0]['tools']]
    snapshots = [r for r in records(tmp_path / 'task', 'context-token-debug.jsonl')
                 if r.get('event') == 'provider_request_context' and r.get('measurement_basis') == 'provider_payload']
    assert snapshots[-1]['tool_definition_count'] == len(requests[-1]['tools'])
    assert name in [t['name'] for t in snapshots[-1]['tool_definition_sizes']]


def test_child_http_usage_is_correlated_in_its_own_scope(tmp_path):
    from test_reported_token_budget_native import _local_provider, _run_http_budget
    with _local_provider('stop', tokens=7) as server:
        _run_http_budget(tmp_path / 'child', tmp_path / 'shared', server, child=True)
    rows = records(tmp_path / 'child', 'context-token-debug.jsonl')
    request = next(r for r in rows if r.get('event') == 'provider_request_context'
                   and r.get('measurement_basis') == 'provider_payload')
    usage = next(r for r in rows if r.get('event') == 'provider_response_usage')
    assert usage['request_id'] == request['request_id']
    assert request['scope'] == usage['scope'] == 'child'
    assert usage['actual_input_tokens'] == 7 and usage['total_tokens'] == 7


@pytest.mark.parametrize('stop_reason', ['error', 'aborted', 'length', 'stop'])
def test_failed_native_zero_default_is_not_telemetry_zero_cost(tmp_path, stop_reason):
    from test_reported_token_budget_native import _local_provider, _run_http_budget
    with _local_provider(stop_reason) as server:
        messages = _run_http_budget(tmp_path / 'child', tmp_path / 'shared', server, child=True,
                                   cancel=stop_reason == 'aborted')
    assert messages[-1]['stopReason'] == stop_reason
    usage = next(r for r in records(tmp_path / 'child', 'context-token-debug.jsonl')
                 if r.get('event') == 'provider_response_usage')
    assert usage['usage_status'] == 'unknown'
    assert usage['actual_input_tokens'] is None and usage['total_tokens'] is None
