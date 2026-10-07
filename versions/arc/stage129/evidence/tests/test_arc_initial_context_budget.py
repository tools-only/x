"""User's initial-context ceiling includes all resident tools, not only prose."""
import json
import base64
import io
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from PIL import Image

from test_arc_capability_surface_native import _run_arc_parent

BASELINE = Path(__file__).parent / 'fixtures/arc_initial_context_baseline.json'


@pytest.fixture(scope='module', params=['disabled', 'after_action'])
def initial_context(tmp_path_factory, request):
    baseline = json.loads(BASELINE.read_text(encoding='utf-8'))
    state = dict(baseline['public_state'])
    state['frames'] = [[[int(c, 16) for c in row] for row in baseline['frame_hex']]]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            if self.path == '/state': value = state
            elif self.path.startswith('/events?'): value = {'next': 0, 'events': []}
            else:
                self.send_error(404)
                return
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    root = tmp_path_factory.mktemp('arc_initial_budget')
    filter_path = root / 'filter.ts'
    filter_path.write_text('export default function(pi) { pi.on("before_agent_start", () => { pi.setActiveTools(pi.getActiveTools().filter(n => n !== "benchmark_probe")); return {}; }); }\n', encoding='utf-8')
    prompt = (Path(__file__).resolve().parents[1] / 'demo/prompts/arc_decision_cycle.md').read_text(encoding='utf-8').replace('{{game}}', 'ls20')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        events = _run_arc_parent(root, [], extra_extensions=[filter_path], prompt=prompt, extra_env={
            'PI_ARC_BRIDGE_URL': f'http://127.0.0.1:{server.server_port}',
            'PI_ARC_INPUT_MODALITIES': 'text,image', 'PI_AUTORESEARCH_CONTEXT_MAX_CHARS': '60000',
            'PI_ARC_EXACT_REGION_TABLE': request.param,
        })
    finally:
        server.shutdown()
        server.server_close()
    assert not [e for e in events if e.get('isError') or e.get('type') == 'error']
    contexts = [json.loads(line)['context'] for line in (root / 'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    assert len(contexts) == 1
    return baseline, contexts[0]


def input_blocks(context):
    return [context['systemPrompt'], *[p['text'] for m in context['messages']
        for p in m.get('content', []) if p.get('type') == 'text']]


def schema_text(context):
    return json.dumps(context['tools'], ensure_ascii=False, separators=(',', ':'))


def test_actual_pi_initial_text_and_full_schema_fit_continual_baseline(initial_context):
    baseline, context = initial_context
    blocks = input_blocks(context)
    text_chars = sum(map(len, blocks))
    assert text_chars <= baseline['limits']['prompt_chars']
    assert text_chars + len(schema_text(context)) <= baseline['limits']['prompt_plus_schema_chars']
    assert len(json.dumps(context, ensure_ascii=False, separators=(',', ':'))) <= baseline['limits']['context_json_chars_with_native_png']
    assert {t['name'] for t in context['tools']} == {
        'task_harness', 'task_harness_create', 'auto_research', 'task_checkpoint', 'arc_action', 'arc_actions'}
    observation = '\n'.join(blocks)
    current_grid = observation.split('Grid current_state_frame (64x64) [hex 0-f = color 0-15]:\n', 1)[1].split('\n\n', 1)[0]
    grid_lines = current_grid.splitlines()
    assert grid_lines[:2] == [
        ''.join(str(x // 10) for x in range(64)) + ' x tens',
        ''.join(str(x % 10) for x in range(64)) + ' x ones',
    ]
    assert len(grid_lines[2:]) == 64
    for y, (actual, expected) in enumerate(zip(grid_lines[2:], baseline['frame_hex'])):
        assert actual == expected + (f' y={y:02d}' if y % 8 == 0 else '')
        assert re.fullmatch(r'[0-9a-f]{64}', actual[:64])
    images = [p for m in context['messages'] for p in m.get('content', []) if p.get('type') == 'image']
    assert len(images) == 1
    image = Image.open(io.BytesIO(base64.b64decode(images[0]['data'])))
    assert image.size == (len(baseline['frame_hex'][0]), len(baseline['frame_hex']))
    # All PNG pixels must still match the complete hex frame, including boundaries.
    palette = [(18,18,18),(0,116,217),(255,65,54),(46,204,64),
               (255,220,0),(170,170,170),(240,18,190),(255,133,27),
               (127,219,255),(135,12,37),(255,255,255),(76,70,50),
               (177,63,191),(37,188,154),(121,85,72),(70,70,230)]
    assert list(image.convert('RGB').getdata()) == [palette[int(c, 16)] for row in baseline['frame_hex'] for c in row]
    # Direct authoring/assignment cannot be hidden to satisfy the size ceiling.
    tools = {t['name']: t['parameters'] for t in context['tools']}
    assert 'candidate' in tools['task_harness_create']['properties']
    assert 'assembly' in tools['task_harness_create']['properties']
    assert 'assignment' in tools['auto_research']['properties']
    assert 'knowledge' in tools['arc_action']['properties']['decision']['properties']


def test_local_text_token_estimate_also_fits_continual_baseline(initial_context):
    tiktoken = pytest.importorskip('tiktoken', reason='Optional local tokenizer; character ceiling is always checked separately.')
    baseline, context = initial_context
    encoding = tiktoken.get_encoding('o200k_base')
    text_tokens = sum(len(encoding.encode(b)) for b in input_blocks(context))
    assert text_tokens <= baseline['limits']['prompt_tokens_o200k']
    assert text_tokens + len(encoding.encode(schema_text(context))) <= baseline['limits']['prompt_plus_schema_tokens_o200k']
