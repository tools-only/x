"""Real Pi with a bridge spy: input normalization, no game-quality claim."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from test_arc_capability_surface_native import _run_arc_parent


@pytest.mark.parametrize('kind', ['alias', 'same', 'conflict', 'missing', 'fractional', 'batch_missing'])
def test_coordinate_preparation_before_native_bridge(tmp_path, kind):
    calls = []
    frame = [[5] * 64 for _ in range(64)]
    frame[12][48] = 9
    state = {'frames': [frame], 'state': 'NOT_FINISHED', 'levels_completed': 0,
             'available_actions': ['ACTION6'], 'action_budget': {'total_used': 0}}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            self.reply(state if self.path == '/state' else {'next': 0, 'events': []})
        def do_POST(self):
            value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(value)
            state['action_budget']['total_used'] += 1
            frame[12][48] = 8
            self.reply({**state, 'public_transition': {'level_changed': False},
                        'observation_delta': {'changed_cells': 1, 'frame_available': True}})

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {'PI_ARC_BRIDGE_URL': f'http://127.0.0.1:{server.server_port}'}
    args = {'action': 'ACTION6', 'decision': {'x': 48, 'y': 12,
                                             'reasoning': 'EXACT_PUBLIC_INTENT', 'prediction': 'One cell changes'}}
    if kind == 'same': args.update(x=48, y=12)
    if kind == 'conflict': args['x'] = 47
    if kind == 'missing': del args['decision']['y']
    if kind == 'fractional': args['decision']['x'] = 48.5
    step = {'name': 'arc_action', 'arguments': args}
    if kind == 'batch_missing':
        step = {'name': 'arc_actions', 'arguments': {'actions': [
            {'action': 'ACTION6', 'x': 48, 'y': 12}, {'action': 'ACTION6', 'x': 14}]}}
    try:
        result = _run_arc_parent(tmp_path, [step], extra_env=env)
        if kind in {'alias', 'same'}:
            assert not [e for e in result if e.get('isError')]
            assert calls == [{'action': 'ACTION6', 'x': 48, 'y': 12, 'reasoning': 'EXACT_PUBLIC_INTENT'}]
            _run_arc_parent(tmp_path, [], extra_env=env)
            checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
            assert checkpoint['recent_actions'][-1]['reasoning'] == 'EXACT_PUBLIC_INTENT'
            contexts = [json.loads(l)['context'] for l in
                        (tmp_path / 'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
            text = json.dumps(contexts[-1], ensure_ascii=False)
            assert 'EXACT_PUBLIC_INTENT' in text and 'CURRENT PUBLIC ARC OBSERVATION' in text
        else:
            assert calls == []
            assert any(e.get('isError') for e in result)
        checkpoint = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
        assert not checkpoint.get('pending_operations')
    finally:
        server.shutdown()
        server.server_close()
