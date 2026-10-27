import json

from autoresearch_pi import arc_thin_e2e as runner


def write_rows(path, rows):
    path.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')


def test_unknown_stream_usage_stops_before_outage_retry(tmp_path):
    write_rows(tmp_path / 'provider-token-budget.jsonl', [
        dict(event='request_reserved', reservation_id='stream', tokens=61077),
        dict(event='unmeasured_usage', reservation_id='stream', stop_reason='error'),
        dict(event='budget_stop', unmeasured=True, exhausted=True, reported=13019),
    ])
    result = runner._provider_admission_stop(tmp_path)
    assert result['stop_reason'] == 'provider_usage_unknown'
    assert 'unknown' in result['error']


def test_local_window_decline_keeps_its_reason_and_no_provider_error(tmp_path):
    (tmp_path / 'provider-window-admission-stop.json').write_text(json.dumps(
        dict(status='declined', reason='image_reserve_unknown', provider_request_admitted=False)))
    result = runner._provider_admission_stop(tmp_path)
    assert result['stop_reason'] == 'provider_admission'
    assert result['error'] == 'provider request declined locally: image_reserve_unknown'


def test_budget_reservation_decline_is_not_a_provider_outage(tmp_path):
    (tmp_path / 'provider-window-admission-stop.json').write_text(json.dumps(
        dict(status='declined', reason='reported_request_reserve_exceeded')))
    assert runner._provider_admission_stop(tmp_path)['stop_reason'] == 'token_cap'


def test_no_stop_for_missing_logs_or_successful_request_with_outstanding_reserve(tmp_path):
    assert runner._provider_admission_stop(tmp_path) is None
    write_rows(tmp_path / 'provider-token-budget.jsonl', [
        dict(event='request_reserved', reservation_id='ok', tokens=100),
        dict(event='reported_usage', reservation_id='ok', tokens=20),
        dict(event='request_reserved', reservation_id='prior_unknown_hold', tokens=61077),
    ])
    assert runner._provider_admission_stop(tmp_path) is None


def test_corrupt_budget_or_stop_marker_fails_closed(tmp_path):
    (tmp_path / 'provider-token-budget.jsonl').write_text('{incomplete')
    assert runner._provider_admission_stop(tmp_path)['stop_reason'] == 'provider_usage_unknown'
