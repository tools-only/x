"""Native Pi projection diagnostics; they do not prove model perception."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from test_arc_capability_surface_native import _run_arc_parent


@pytest.mark.parametrize('mode', ['disabled', 'enabled', 'after_action'])
def test_region_table_initial_and_recovered_action_state(tmp_path, mode):
    frame = [[0] * 6 for _ in range(6)]
    frame[1][1:3] = [8, 9]
    frame[2][1:3] = [9, 8]
    state = {'frames': [frame], 'state': 'NOT_FINISHED', 'levels_completed': 0,
             'available_actions': ['ACTION6'], 'action_budget': {'total_used': 0}}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            used = state['action_budget']['total_used']
            events = [{'event': 'action', 'index': 1, 'action': 'ACTION6',
                       'level_before': 0, 'state_before': 'NOT_FINISHED',
                       'observation_delta': {'changed_cells': 0}, 'frame': state}] if used else []
            body = json.dumps(state if self.path == '/state' else {'next': used, 'events': events}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {'PI_ARC_BRIDGE_URL': f'http://127.0.0.1:{server.server_port}',
           'PI_ARC_EXACT_REGION_TABLE': mode}
    try:
        for used in [0, 1]:
            state['action_budget']['total_used'] = used
            result = _run_arc_parent(tmp_path, [], extra_env=env)
            assert not [e for e in result if e.get('isError') or e.get('type') == 'error']
    finally:
        server.shutdown()
        server.server_close()
    contexts = [json.loads(l)['context'] for l in
                (tmp_path / 'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    assert len(contexts) == 2
    for used, context in enumerate(contexts):
        text = '\n'.join(p['text'] for m in context['messages']
                         for p in m.get('content', []) if p.get('type') == 'text')
        expected = mode == 'enabled' or (mode == 'after_action' and used > 0)
        assert ('PUBLIC PIXEL REGION INDEX' in text) is expected
        assert '000000\n089000\n098000\n000000\n000000\n000000' in text
        if expected:
            assert 'x=[[1,1],[2,2]]; y=[[1,1],[2,2]]; rows=["89","98"]' in text
