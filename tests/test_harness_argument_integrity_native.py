"""Native SSE argument parsing/execution regression, not autonomous model evidence."""
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli
from test_pure_publication_trial_native import top_level_publication
from test_task_research_context import records, results

PROJECT = Path(__file__).resolve().parents[1]
REPLAY = PROJECT / 'tests/fixtures/harness-stage134-malformed-arguments.json'


@contextmanager
def provider(responses):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(payload)
            response = responses[len(requests) - 1] if len(requests) <= len(responses) else []
            if callable(response):
                response = response(payload)
            calls = response['calls'] if isinstance(response, dict) else response
            if isinstance(response, dict) and response.get('http_status', 200) != 200:
                self.send_response(response['http_status'])
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': {'message': 'Diagnostic request rejection'}}).encode())
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()

            def emit(delta, finish=None, usage=None):
                value = {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'scripted',
                         'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                if usage:
                    value['usage'] = usage
                self.wfile.write(('data: ' + json.dumps(value) + '\n\n').encode())
                self.wfile.flush()

            try:
                emit({'role': 'assistant'})
                for i, call in enumerate(calls):
                    # Reuse IDs across provider messages to exercise cleanup; preserve multi-call indices.
                    emit({'tool_calls': [{'index': i, 'id': call.get('id', f'call-{i}'), 'type': 'function',
                         'function': {'name': call['name'], 'arguments': ''}}]})
                    raw = call.get('raw', json.dumps(call.get('arguments', {})))
                    for pos in range(0, len(raw), 37):
                        emit({'tool_calls': [{'index': i, 'function': {'arguments': raw[pos:pos + 37]}}]})
                if not calls:
                    emit({'content': 'done'})
                finish = response.get('finish') if isinstance(response, dict) else None
                emit({}, finish or ('tool_calls' if calls else 'stop'), {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20})
                self.wfile.write(b'data: [DONE]\n\n')
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server, requests
    finally:
        server.shutdown()
        server.server_close()


def run(root, responses, extra_env=None, *, resume=False, final_observer=True):
    root.mkdir(exist_ok=resume)
    node, cli = _pi_cli()
    command = [node, cli, '--mode', 'rpc', '--provider', 'argument-http-test', '--model', 'scripted',
                       '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
                       '--no-context-files', '--no-builtin-tools', '--extension',
                       str(PROJECT / 'tests/pi_harness_argument_http_fixture.ts')]
    if final_observer:
        command.extend(['--extension', str(PROJECT / 'demo/pi_final_provider_payload.ts')])
    with provider(responses) as (server, requests):
        with PiKernel(command,
                      cwd=str(root), env={'PI_CODING_AGENT_DIR': str(root / '.pi-agent'),
                      'PI_AUTORESEARCH_E2E_ROOT': str(root), 'PI_AUTORESEARCH_TASK_ID': 'argument-integrity-fixture',
                      'PI_ARGUMENT_HTTP_BASE_URL': f'http://127.0.0.1:{server.server_port}/v1',
                      **(extra_env or {})}, timeout=60) as kernel:
            kernel.prompt('Run the local argument integrity fixture.')
            events = kernel.wait_for_agent_events(timeout=60)
    (root / ('provider-payloads-resume.json' if resume else 'provider-payloads.json')).write_text(json.dumps(requests, ensure_ascii=False, indent=2), encoding='utf-8')
    return events, requests


def read_creator():
    return [{'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'tool-creator'}}]


def failure(event):
    assert event.get('isError'), event
    return json.loads(event['result']['content'][0]['text'])


def tool_payloads(request):
    values = []
    for message in request['messages']:
        if message['role'] != 'tool':
            continue
        content = message.get('content', '')
        texts = [content] if isinstance(content, str) else [p.get('text', '') for p in content if p.get('type') == 'text']
        for text in texts:
            try:
                values.append(json.loads(text))
            except json.JSONDecodeError:
                pass
    return values


def test_invalid_completed_json_never_publishes_prefix_and_complete_repair_returns_native_value(tmp_path):
    call = top_level_publication()
    args = call['arguments']
    malformed = json.dumps({'candidate': args['candidate']}) + ',"assembly":' + json.dumps(args['assembly']) + ',"trial":' + json.dumps(args['trial']) + '}'
    events, requests = run(tmp_path / 'repair', [read_creator(), [{'name': 'task_harness_create', 'raw': malformed}], [call]])
    attempts = results(events, 'task_harness_create')
    error = failure(attempts[0])
    assert error['phase'] == 'preflight' and error['no_component_written'] is True
    assert error['raw_arguments'] == malformed
    assert records(tmp_path / 'repair', 'task-harness-argument-errors.jsonl')[0]['raw_arguments'] == malformed
    # It is the repaired transaction, not the malformed prefix, that writes version 1.
    assert len(records(tmp_path / 'repair', 'task-tools.jsonl')) == 1
    receipt = attempts[1]['result']['details']
    assert not attempts[1].get('isError') and receipt['trial']['tool_ref'] == 'tool:bound-check@v1'
    assert json.loads(receipt['trial']['result']['content'][0]['text']) is True
    assert len(records(tmp_path / 'repair', 'task-harness-initial-trials.jsonl')) == 1
    assert len(requests) == 4
    assert any(v.get('raw_arguments') == malformed for v in tool_payloads(requests[2]))
    assert any(v.get('trial', {}).get('status') == 'completed'
               and json.loads(v['trial']['result']['content'][0]['text']) is True for v in tool_payloads(requests[3]))


@pytest.mark.parametrize('index', [0, 1], ids=['actual-stage134-response2', 'actual-stage134-response3'])
def test_actual_stage134_invalid_raw_has_complete_repair_evidence_and_zero_writes(tmp_path, index):
    original = json.loads(REPLAY.read_text(encoding='utf-8'))['calls'][index]
    raw = original['raw_arguments']
    events, requests = run(tmp_path / f'replay-{index}', [read_creator(), [{'name': 'task_harness_create', 'raw': raw}]])
    error = failure(results(events, 'task_harness_create')[0])
    assert error['raw_arguments'] == raw and error['no_component_written'] is True
    assert not records(tmp_path / f'replay-{index}', 'task-tools.jsonl')
    assert not records(tmp_path / f'replay-{index}', 'task-tool-events.jsonl')
    assert any(v.get('raw_arguments') == raw for v in tool_payloads(requests[-1]))


def test_multi_call_and_reused_ids_do_not_contaminate_valid_progressive_json(tmp_path):
    malformed = '{"marker":"bad"},"tail":1}'
    events, requests = run(tmp_path / 'multiple', [[
        {'name': 'ingress_probe', 'raw': malformed},
        {'name': 'ingress_probe', 'arguments': {'marker': 'good-same-message'}},
    ], [{'name': 'ingress_probe', 'arguments': {'marker': 'good-next-message'}}]])
    attempts = results(events, 'ingress_probe')
    assert failure(attempts[0])['raw_arguments'] == malformed
    assert not attempts[1].get('isError') and not attempts[2].get('isError')
    assert [x['params']['marker'] for x in records(tmp_path / 'multiple', 'probe-executions.jsonl')] == ['good-same-message', 'good-next-message']
    assert len(requests) == 3


def test_native_duplicate_header_is_outside_raw_arguments_and_cannot_execute_second_call(tmp_path):
    events, _requests = run(tmp_path / 'duplicate', [[
        {'name': 'ingress_probe', 'id': 'same-id', 'arguments': {'marker': 'one'}},
        {'name': 'ingress_probe', 'id': 'same-id', 'arguments': {'marker': 'two'}},
    ]])
    attempts = results(events, 'ingress_probe')
    # The native transport strips the duplicate second header before extension events.
    # Its first complete, valid call is independent and executes; the unnamed call cannot.
    message = records(tmp_path / 'duplicate', 'native-provider-messages.jsonl')[0]
    assert [(c['id'], c['name']) for c in message['content']] == [('same-id', 'ingress_probe'), ('', '')]
    assert len(attempts) == 1 and not attempts[0].get('isError')
    assert [x['params']['marker'] for x in records(tmp_path / 'duplicate', 'probe-executions.jsonl')] == ['one']
    assert any(event.get('type') == 'tool_execution_end' and event.get('toolName') == ''
               and event.get('isError') for event in events)


@pytest.mark.parametrize('cancel', [False, True], ids=['native-length', 'native-aborted'])
def test_unfinished_message_uses_native_stop_without_executor_or_new_argument_error(tmp_path, cancel):
    root = tmp_path / 'interrupted'
    run(root, [{'calls': [{'name': 'ingress_probe', 'raw': '{"marker":"incomplete'}], 'finish': 'length'}],
        {'PI_ARGUMENT_CANCEL_ON_DELTA': '1'} if cancel else None)
    assert not records(root, 'probe-executions.jsonl')
    assert not records(root, 'task-harness-argument-errors.jsonl')
    assert records(root, 'native-provider-messages.jsonl')[0]['stopReason'] == ('aborted' if cancel else 'length')
