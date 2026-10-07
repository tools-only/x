"""Whole-payload admission at actual native Pi HTTP, not provider benefit."""
import json
import pytest
from test_harness_argument_integrity_native import run, tool_payloads
from test_task_research_context import records, results


def test_final_system_and_tool_schema_overflow_stops_before_first_http(tmp_path):
    root = tmp_path / 'oversized-final-request'
    # The native model itself is large enough to avoid Pi auto-compaction;
    # this explicit smaller admission capacity must cover the final payload.
    events, requests = run(root, [], {
        'PI_ARGUMENT_TELEMETRY': '1',
        'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_PROVIDER_CONTEXT_CAPACITY': '1000',
        'PI_PROVIDER_MAX_REPORTED_TOKENS': '100000',
    })
    assert len(requests) == 0, 'Final schemas/system exceed the declared window but were sent.'
    decisions = records(root, 'provider-window-admission.jsonl')
    assert decisions[-1]['status'] == 'declined'
    assert decisions[-1]['reason'] == 'context_capacity_exceeded'
    assert decisions[-1]['input_text_token_reserve'] > 1000
    assert decisions[-1]['tool_definition_count'] > 0
    assert not records(root, 'probe-executions.jsonl')
    assert not records(root, 'task-tools.jsonl')
    assert any(row.get('type') == 'agent_end' for row in events)
    ledger = records(root, 'provider-token-budget.jsonl')
    assert any(row['event'] == 'request_declined' for row in ledger)
    assert not any(row['event'] == 'unmeasured_usage' for row in ledger)
    telemetry = records(root, 'context-token-debug.jsonl')
    assert any(row.get('usage_status') == 'not_requested' for row in telemetry)
    assert not any(row.get('usage_status') == 'unknown' for row in telemetry)


def test_legal_full_payload_keeps_dynamic_tool_semantics_and_later_parent_input(tmp_path):
    root = tmp_path / 'legal'
    call = {'name': 'task_harness_create', 'arguments': {'candidate': {
        'name': 'admitted-value', 'description': 'Return the bounded number 2',
        'program': {'format': 'task-pure-python-v1', 'source': '2'}}, 'assembly': True, 'trial': {}}}
    events, requests = run(root, [[call], [{'name': 'task_tool_admitted-value_v1', 'arguments': {}}]], {
        'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_PROVIDER_CONTEXT_CAPACITY': '999999',
    })
    assert len(requests) == 3
    assert not results(events, 'task_harness_create')[0].get('isError')
    assert json.loads(results(events, 'task_tool_admitted-value_v1')[0]['result']['content'][0]['text']) == 2
    assert any(value.get('trial', {}).get('status') == 'completed' for value in tool_payloads(requests[1]))
    admissions = records(root, 'provider-window-admission.jsonl')
    assert len(admissions) == 3 and all(row['status'] == 'admitted' for row in admissions)
    assert all(row['context_capacity'] == 128000 for row in admissions)
    assert admissions[1]['tool_definition_count'] > admissions[0]['tool_definition_count']
    assert admissions[0]['output_token_reserve'] == requests[0]['max_completion_tokens'] == 4096
    expected_bytes = len(json.dumps(requests[0]['messages'], ensure_ascii=False, separators=(',', ':')).encode())
    expected_bytes += len(json.dumps(requests[0]['tools'], ensure_ascii=False, separators=(',', ':')).encode())
    assert admissions[0]['input_text_token_reserve'] == expected_bytes


def test_late_oversized_replacement_is_measured_and_rejected_before_http(tmp_path):
    root = tmp_path / 'late-oversized-final-request'
    _, sent = run(root, [], {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_ARGUMENT_LATE_OVERSIZE_PAYLOAD': '1', 'PI_PROVIDER_MAX_REPORTED_TOKENS': '100000'})
    assert not sent, 'Admission inspected the early payload while an oversized replacement reached HTTP.'
    decision = records(root, 'provider-window-admission.jsonl')[-1]
    assert decision['reason'] == 'context_capacity_exceeded'
    assert decision['input_text_token_reserve'] > 150000
    debug = records(root, 'context-token-debug.jsonl')
    assert any(row.get('measurement_basis') == 'provider_payload' and row.get('text_json_utf8_bytes', 0) > 150000
               for row in debug)
    assert not any(row.get('event') == 'unmeasured_usage' for row in records(root, 'provider-token-budget.jsonl'))


def test_enabled_window_admission_without_final_observer_declines_before_http(tmp_path):
    root = tmp_path / 'missing-window-observer'
    _, sent = run(root, [], {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_PROVIDER_MAX_REPORTED_TOKENS': '100000'}, final_observer=False)
    assert not sent
    assert records(root, 'provider-window-admission.jsonl')[-1]['reason'] == 'final_provider_observer_unavailable'
    assert not any(row.get('event') == 'unmeasured_usage' for row in records(root, 'provider-token-budget.jsonl'))


def test_actual_output_envelope_is_reserved_separately_from_input(tmp_path):
    root = tmp_path / 'output-overflow'
    _, requests = run(root, [], {
        'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_ARGUMENT_MAX_OUTPUT_TOKENS': '120000',
    })
    assert len(requests) == 0
    decision = records(root, 'provider-window-admission.jsonl')[-1]
    assert decision['declared_model_output_limit'] == 120000
    # Native Pi caps the emitted envelope against its own input estimate;
    # admission must reserve that emitted value rather than registry maxTokens.
    assert 100000 < decision['output_token_reserve'] <= 120000
    assert decision['input_text_token_reserve'] < decision['context_capacity']
    assert decision['required_token_reserve'] > decision['context_capacity']
    assert decision['reason'] == 'context_capacity_exceeded'


@pytest.mark.parametrize('reserve,expected_http', [(None, 1), ('4096', 2)])
def test_typed_images_need_explicit_reserve_without_charging_base64_as_text(tmp_path, reserve, expected_http):
    root = tmp_path / 'image'
    env = {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled'}
    if reserve is not None:
        env['PI_PROVIDER_IMAGE_TOKEN_RESERVE'] = reserve
    _, requests = run(root, [[{'name': 'ingress_probe', 'arguments': {'marker': 'image'}}]], env)
    assert len(requests) == expected_http
    decisions = records(root, 'provider-window-admission.jsonl')
    image = decisions[-1]
    assert image['image_count'] == 1
    assert image['reason'] == ('image_reserve_unknown' if reserve is None else None)
    assert image['image_token_reserve_per_image'] == (None if reserve is None else 4096)
    assert image['input_text_token_reserve'] < 128000
    debug = records(root, 'context-token-debug.jsonl')
    image_stats = next(row for row in debug if row.get('measurement_basis') == 'provider_payload' and row.get('image_count') == 1)
    assert image_stats['estimated_image_tokens'] is None
    assert image_stats['text_json_utf8_bytes'] == image['input_text_token_reserve']


@pytest.mark.parametrize('env,reason', [
    ({'PI_PROVIDER_CONTEXT_CAPACITY': 'bad'}, 'context_capacity_unknown_or_invalid'),
    ({'PI_PROVIDER_CONTEXT_MARGIN': '0'}, 'context_margin_invalid'),
])
def test_invalid_window_configuration_never_becomes_an_unbounded_request(tmp_path, env, reason):
    root = tmp_path / 'invalid'
    _, requests = run(root, [], {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled', **env})
    assert not requests
    assert records(root, 'provider-window-admission.jsonl')[-1]['reason'] == reason


def test_arc_runner_window_decline_is_terminal_without_recovery_prompt_or_http(tmp_path, monkeypatch):
    from test_arc_parent_provider_admission_native import native_provider, run_parent
    from test_arc_request_admission_native import controlled_arc
    with controlled_arc(maximum=1) as (arc_url, state), native_provider(tmp_path) as (provider_url, requests):
        result = run_parent(tmp_path, arc_url, provider_url, monkeypatch, overrides={
            'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled', 'PI_PROVIDER_CONTEXT_CAPACITY': '1000'})
        assert result == 126
        assert len(requests) == 0 and state['action_budget']['total_used'] == 0
    events = records(tmp_path, 'pi-events.jsonl')
    assert any(row.get('type') == 'provider_window_admission_declined' for row in events)
    assert not any(row.get('type') == 'arc_recovery_phase' for row in events)


def test_child_window_decline_does_not_create_a_parent_or_shared_budget_stop(tmp_path):
    from test_reported_token_budget_native import _local_provider, _run_http_budget
    root = tmp_path / 'child-overflow'
    # The parent authoring fixture initializes parent-only resource access.
    # Exercise a child with the existing native child budget fixture instead.
    with _local_provider('stop', tokens=20) as server:
        _run_http_budget(root, root, server, child=True, extra_env={
            'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled', 'PI_PROVIDER_CONTEXT_CAPACITY': '1000',
            'PI_PROVIDER_MAX_REPORTED_TOKENS': '100000',
        })
        assert not server.requests
    assert list(root.glob('provider-window-admission-child-*-stop.json'))
    assert not (root / 'provider-window-admission-stop.json').exists()
    assert not (root / 'provider-token-budget-stop.json').exists()
    ledger = records(root, 'provider-token-budget.jsonl')
    assert any(row.get('event') == 'request_declined' and row.get('scope') == 'child' for row in ledger)
    assert not any(row.get('event') in {'unmeasured_usage', 'budget_stop'} for row in ledger)


def test_cancel_after_real_http_response_is_not_reported_as_pre_http_window_decline(tmp_path):
    root = tmp_path / 'cancelled-http'
    _, requests = run(root, [[{'name': 'ingress_probe', 'arguments': {'marker': 'cancel'}}]], {
        'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
        'PI_ARGUMENT_CANCEL_ON_DELTA': '1', 'PI_PROVIDER_MAX_REPORTED_TOKENS': '100000',
    })
    assert len(requests) == 1
    assert not (root / 'provider-window-admission-stop.json').exists()
    ledger = records(root, 'provider-token-budget.jsonl')
    assert not any(row.get('event') == 'request_declined' for row in ledger)
    assert any(row.get('event') in {'unmeasured_usage', 'reported_usage'} for row in ledger)
    debug = records(root, 'context-token-debug.jsonl')
    assert not any(row.get('usage_status') == 'not_requested' for row in debug)


def test_declined_final_request_keeps_research_increment_for_a_later_actual_parent_input(tmp_path):
    root = tmp_path / 'research-inbox-admission'
    env = {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
           'PI_PROVIDER_CONTEXT_CAPACITY': '1000', 'PI_ARGUMENT_RESEARCH_INBOX': '1'}
    _, rejected = run(root, [], env)
    assert not rejected
    assert not records(root, 'auto-research-deliveries.jsonl')
    _, accepted = run(root, [], {**env, 'PI_PROVIDER_CONTEXT_CAPACITY': '128000'}, resume=True)
    assert len(accepted) == 1
    assert 'A queued counterexample remains unresolved.' in json.dumps(accepted[0]['messages'])
    deliveries = records(root, 'auto-research-deliveries.jsonl')
    assert len(deliveries) == 1
    assert deliveries[0]['update_ref'] == 'research_update:delivery-test-u1@v1'
    assert deliveries[0]['measurement_basis'] == 'accepted_final_provider_payload'
    _, later = run(root, [], {**env, 'PI_PROVIDER_CONTEXT_CAPACITY': '128000'}, resume=True)
    assert 'A queued counterexample remains unresolved.' not in json.dumps(later[0]['messages'])
    assert len(records(root, 'auto-research-deliveries.jsonl')) == 1


def test_declined_completion_survives_and_accepted_completion_leaves_later_inputs(tmp_path):
    root = tmp_path / 'completion-admission'
    env = {'PI_ARGUMENT_TELEMETRY': '1', 'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled',
           'PI_PROVIDER_CONTEXT_CAPACITY': '1000', 'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}
    _, rejected = run(root, [], env)
    assert not rejected
    assert records(root, 'auto-research-sessions.jsonl')[-1].get('completion_delivery_status') != 'delivered'
    calls = [[{'name': 'ingress_probe', 'arguments': {'marker': 'after-completion'}}]]
    _, accepted = run(root, calls, {**env, 'PI_PROVIDER_CONTEXT_CAPACITY': '128000'}, resume=True)
    assert len(accepted) == 2
    assert 'An undelivered completion remains actionable.' in json.dumps(accepted[0]['messages'])
    assert 'An undelivered completion remains actionable.' not in json.dumps(accepted[1]['messages'])
    delivered = records(root, 'auto-research-sessions.jsonl')[-1]
    assert delivered['completion_delivery_status'] == 'delivered'
    assert delivered['completion_delivery_basis'] == 'accepted_final_provider_payload'
    assert delivered['version'] == 2
    _, later = run(root, [], {**env, 'PI_PROVIDER_CONTEXT_CAPACITY': '128000'}, resume=True)
    assert 'An undelivered completion remains actionable.' not in json.dumps(later[0]['messages'])
    assert len(records(root, 'auto-research-sessions.jsonl')) == 2


def test_large_source_completion_is_short_and_exact_source_is_recovered_on_demand(tmp_path):
    root = tmp_path / 'large-source-completion'
    handoff_ref = 'authoring_handoff:auto-research-1-large-successor-tool@v1'
    calls = [[{'name': 'task_resource', 'arguments': {
        'action': 'read', 'ref': handoff_ref, 'limit': 65536}}]]
    events, requests = run(root, calls, {
        'PI_ARGUMENT_RESEARCH_COMPLETION': '1', 'PI_ARGUMENT_COMPLETION_SOURCE': '1'})
    prefix = 'AUTO-RESEARCH COMPLETION INBOX (runtime-delivered once): '
    first_messages = requests[0]['messages']
    text = next(t for m in first_messages for t in (
        [m['content']] if isinstance(m.get('content'), str) else
        [part.get('text', '') for part in m.get('content', []) if part.get('type') == 'text'])
        if t.startswith(prefix))
    assert len(text) < 3000, f'Automatic completion card expands {len(text)} chars of source and templates.'
    assert handoff_ref in text
    assert 'An undelivered completion remains actionable.' in text
    assert 'x' * 1000 not in json.dumps(first_messages)
    restored = json.loads(results(events, 'task_resource')[0]['result']['content'][0]['text'])
    assert restored['ref'] == handoff_ref and not restored['truncated']
    handoff = json.loads(restored['text'])
    assert handoff['computation_candidate']['program']['source'] == "{'value': input['n'] + 1} # " + 'x' * 12000
    assert 'x' * 1000 in json.dumps(requests[1]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'
    assert not records(root, 'task-tools.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')


def test_removed_completion_card_is_not_acknowledged_by_successful_http(tmp_path):
    root = tmp_path / 'removed-completion'
    env = {'PI_ARGUMENT_TELEMETRY': '1', 'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}
    _, removed = run(root, [], {**env, 'PI_ARGUMENT_DROP_COMPLETION': '1'})
    assert len(removed) == 1
    assert 'AUTO-RESEARCH COMPLETION INBOX' not in json.dumps(removed[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1].get('completion_delivery_status') != 'delivered'
    _, accepted = run(root, [], env, resume=True)
    assert 'An undelivered completion remains actionable.' in json.dumps(accepted[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'


def test_late_replacement_payload_cannot_acknowledge_a_removed_completion(tmp_path):
    root = tmp_path / 'late-removed-completion'
    env = {'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}
    _, removed = run(root, [], {**env, 'PI_ARGUMENT_DROP_COMPLETION_PAYLOAD': '1'})
    assert len(removed) == 1
    assert 'AUTO-RESEARCH COMPLETION INBOX' not in json.dumps(removed[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1].get('completion_delivery_status') != 'delivered'
    _, accepted = run(root, [], env, resume=True)
    assert 'An undelivered completion remains actionable.' in json.dumps(accepted[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'


def test_late_replacement_payload_keeps_worker_increment_queued(tmp_path):
    root = tmp_path / 'late-removed-worker-increment'
    env = {'PI_ARGUMENT_RESEARCH_INBOX': '1'}
    _, removed = run(root, [], {**env, 'PI_ARGUMENT_DROP_COMPLETION_PAYLOAD': '1'})
    assert len(removed) == 1
    assert 'AUTO-RESEARCH COMPLETION INBOX' not in json.dumps(removed[0]['messages'])
    assert not records(root, 'auto-research-deliveries.jsonl')
    _, accepted = run(root, [], env, resume=True)
    assert 'A queued counterexample remains unresolved.' in json.dumps(accepted[0]['messages'])
    assert len(records(root, 'auto-research-deliveries.jsonl')) == 1


def test_missing_final_observer_never_fabricates_completion_delivery(tmp_path):
    root = tmp_path / 'missing-final-observer'
    env = {'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}
    _, sent = run(root, [], env, final_observer=False)
    assert 'An undelivered completion remains actionable.' in json.dumps(sent[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1].get('completion_delivery_status') != 'delivered'
    _, accepted = run(root, [], env, resume=True)
    assert 'An undelivered completion remains actionable.' in json.dumps(accepted[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'


def test_http_rejection_keeps_completion_queued(tmp_path):
    root = tmp_path / 'rejected-completion-response'
    env = {'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}
    _, rejected = run(root, [{'http_status': 400, 'calls': []}], env)
    assert len(rejected) == 1
    assert 'An undelivered completion remains actionable.' in json.dumps(rejected[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1].get('completion_delivery_status') != 'delivered'
    _, accepted = run(root, [], env, resume=True)
    assert 'An undelivered completion remains actionable.' in json.dumps(accepted[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'


def test_completion_confirmation_does_not_overwrite_a_concurrent_session_revision(tmp_path):
    root = tmp_path / 'concurrent-completion-revision'
    env = {'PI_ARGUMENT_RESEARCH_COMPLETION': '1'}

    def revise(_payload):
        row = records(root, 'auto-research-sessions.jsonl')[-1]
        with (root / 'auto-research-sessions.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({**row, 'version': 2, 'summary': 'A newer completion revision remains queued.'}) + '\n')
        return []

    _, sent = run(root, [revise], env)
    assert 'An undelivered completion remains actionable.' in json.dumps(sent[0]['messages'])
    current = records(root, 'auto-research-sessions.jsonl')[-1]
    assert current['version'] == 2 and current.get('completion_delivery_status') != 'delivered'
    _, accepted = run(root, [], env, resume=True)
    assert 'A newer completion revision remains queued.' in json.dumps(accepted[0]['messages'])
    assert records(root, 'auto-research-sessions.jsonl')[-1]['version'] == 3


def test_completion_tail_reaches_next_http_without_repeating_the_first_card(tmp_path):
    root = tmp_path / 'completion-tail'
    env = {'PI_ARGUMENT_TELEMETRY': '1', 'PI_ARGUMENT_RESEARCH_COMPLETION': '1',
           'PI_PROVIDER_CONTEXT_ADMISSION': 'enabled', 'PI_PROVIDER_CONTEXT_CAPACITY': '1000'}
    run(root, [], env)
    second = {**records(root, 'auto-research-sessions.jsonl')[0], 'session_id': 'completion-tail',
              'run_id': 'auto-research-2', 'report_ref': 'research_report:auto-research-2@v1',
              'summary': 'A second completion remains queued.'}
    with (root / 'auto-research-sessions.jsonl').open('a', encoding='utf8') as output:
        output.write(json.dumps(second) + '\n')
    calls = [[{'name': 'ingress_probe', 'arguments': {'marker': 'first'}}],
             [{'name': 'ingress_probe', 'arguments': {'marker': 'second'}}]]
    _, sent = run(root, calls, {**env, 'PI_PROVIDER_CONTEXT_CAPACITY': '128000'}, resume=True)
    assert len(sent) == 3
    assert 'An undelivered completion remains actionable.' in json.dumps(sent[0]['messages'])
    assert 'A second completion remains queued.' not in json.dumps(sent[0]['messages'])
    assert 'A second completion remains queued.' in json.dumps(sent[1]['messages'])
    assert 'An undelivered completion remains actionable.' not in json.dumps(sent[1]['messages'])
    assert 'AUTO-RESEARCH COMPLETION INBOX' not in json.dumps(sent[2]['messages'])
    delivered = [row for row in records(root, 'auto-research-sessions.jsonl')
                 if row.get('completion_delivery_status') == 'delivered']
    assert [row['session_id'] for row in delivered] == ['completion-test', 'completion-tail']


def test_real_nonblocking_child_completion_is_delivered_once_at_native_http(tmp_path):
    from pathlib import Path
    import hashlib
    from autoresearch_pi.subagent_broker import SubagentBroker
    from test_auto_research_self_harness_smoke import _child_env
    from test_task_research_context import _pi_cli, wait_for_broker_job

    project = Path(__file__).resolve().parents[1]
    _, cli = _pi_cli()
    root = tmp_path / 'real-completion-child'
    report = {'format': 'auto-research-report-v1', 'status': 'provisional',
              'conclusion': 'A real child completed a bounded research responsibility.',
              'findings': [], 'evidence_refs': [], 'alternatives': [], 'limitations': [],
              'validation_plan': 'The parent may use the conclusion or continue the task.', 'method_candidates': []}
    creator = project / 'demo/harness-methods/research-orchestration/SKILL.md'
    creator_ref = 'baseline_method:research-orchestration@sha256:' + hashlib.sha256(creator.read_bytes()).hexdigest()
    broker = SubagentBroker()
    broker.start()
    try:
        env = {**_child_env(project, cli, report, [{'name': 'submit_research_report', 'arguments': {'report': report}}]),
               'PI_ARGUMENT_TELEMETRY': '1', 'PI_ARGUMENT_RESEARCH_RUNTIME': '1',
               'PI_AUTORESEARCH_PROVIDER_EXTENSION': str(project / 'tests/pi_subagent_provider.ts'),
               'PI_AUTORESEARCH_SUBAGENT_BROKER_URL': broker.url}
        events, _ = run(root, [
            [{'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'research-orchestration'}}],
            [{'name': 'auto_research', 'arguments': {'question': 'Investigate one bounded research responsibility.',
                'interaction_mode': 'non_blocking', 'scope': 'harness_component', 'authoring_method_ref': creator_ref}}],
        ], env)
        assert not results(events, 'auto_research')[0].get('isError')
        status = wait_for_broker_job(root, 'auto-research-1')
        assert status['status'] == 'completed' and status['exit_code'] == 0 and status['pid'] > 0
        _, requests = run(root, [[{'name': 'ingress_probe', 'arguments': {'marker': 'continue-task'}}]], env, resume=True)
        assert 'AUTO-RESEARCH COMPLETION INBOX' in json.dumps(requests[0]['messages'])
        assert 'A real child completed a bounded research responsibility.' in json.dumps(requests[0]['messages'])
        assert 'AUTO-RESEARCH COMPLETION INBOX' not in json.dumps(requests[1]['messages'])
        assert records(root, 'auto-research-sessions.jsonl')[-1]['completion_delivery_status'] == 'delivered'
        child_events = records(root / 'task-context-cache/auto-research-broker', 'auto-research-1.events.jsonl')
        assert any(row['event'] == 'stdout' and 'submit_research_report' in row['data'] for row in child_events)
        assert records(root, 'auto-research-reports.jsonl')[-1]['report']['conclusion'] == report['conclusion']
        assert records(root, 'task-tools.jsonl') == []
        assert records(root, 'task-harness-assemblies.jsonl') == []
    finally:
        broker.close()
