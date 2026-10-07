"""Read existing run artifacts; do not run ARC or change its implementation."""
import collections
import hashlib
import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
RUN = PROJECT / 'runs/arc-ft09-context-workset-60-20260930'
REPAIR = PROJECT / 'runs/arc-ft09-repair-60-20260930'

def rows(root, filename):
    return [json.loads(s) for s in (root / filename).read_text(encoding='utf-8').splitlines() if s]

def text(message):
    return '\n'.join(p.get('text', '') for p in message.get('content', []) if p.get('type') == 'text')

events = rows(RUN, 'pi-events.jsonl')
calls = {r.get('toolCallId') for r in events if r.get('type') == 'tool_execution_start'}
cache = rows(RUN, 'task-context-cache/messages.jsonl')
by_id = {r['archive_id']: r for r in cache}
indexes = [r for r in cache if 'message_refs' in r]
def expand(index):
    return [by_id[ref.split(':', 1)[1].split('@')[0]]['message'] for ref in index['message_refs']]
parent_indexes = [r for r in indexes if any('Play ARC-AGI-3 game' in text(m) for m in expand(r)[:2])]
parent_source = expand(parent_indexes[0])
(OUT / 'earliest-recoverable-parent-native-source.json').write_text(json.dumps({
    'status': 'exact_native_source_before_generic_projection; NOT final provider payload',
    'archive_ref': f"context:{parent_indexes[0]['archive_id']}@v1",
    'messages': parent_source,
}, ensure_ascii=False, indent=2), encoding='utf-8')
(OUT / 'recovered-original-task-prompt.txt').write_text(text(parent_source[0]), encoding='utf-8')

snapshot = rows(RUN, 'observation-snapshots.jsonl')[0]
frame = snapshot['public_state']['frames'][-1]
recovered = []
for r in cache:
    m = r.get('message', {})
    body = text(m)
    if m.get('toolName') != 'arc_state' or 'Lossless coordinate runs' not in body:
        continue
    decoded = [[None] * len(frame[0]) for _ in frame]
    for line in body.splitlines():
        match = re.match(r'^r(\d+):\s*(.*)$', line)
        if not match:
            continue
        y = int(match[1])
        for cell in re.finditer(r'c(\d+)(?:-(\d+))?=(-?\d+)', match[2]):
            start, end, color = int(cell[1]), int(cell[2] or cell[1]), int(cell[3])
            for x in range(start, end + 1):
                decoded[y][x] = color
    recovered.append({'tool_call_id': m['toolCallId'], 'timestamp': m.get('timestamp'),
        'parent_call': m['toolCallId'] in calls, 'text_chars': len(body),
        'coordinate_rows': len(re.findall(r'^r\d+:', body, re.M)),
        'covered_cells': sum(v is not None for row in decoded for v in row),
        'mismatching_cells': sum(a != b for ra, rb in zip(decoded, frame) for a, b in zip(ra, rb)),
        'source': f"context:{r['archive_id']}@v1"})
    if len(recovered) == 1:
        (OUT / 'recovered-child-arc-state.txt').write_text(body, encoding='utf-8')

obs = rows(RUN, 'execution-observations.jsonl')
actions = [r for r in obs if r.get('tool_name') == 'arc_action']
requests = [r for r in rows(RUN, 'context-token-debug.jsonl')
    if r.get('event') == 'provider_request_context' and r.get('measurement_basis') == 'provider_payload']
telemetry = rows(RUN, 'provider-telemetry.jsonl')
feedback_requests = [{'request_index': r.get('request_index'), 'recordedAt': r.get('recordedAt'),
    'markers': r['arc_decision_feedback_markers']} for r in telemetry if r.get('arc_decision_feedback_markers')]
parent_messages = {json.dumps(m, sort_keys=True): m for i in parent_indexes for m in expand(i)}
reminders = [m for m in parent_messages.values() if m.get('role') == 'user'
    and text(m).startswith('REPEATED ZERO PIXEL DELTAS')]
reminders.sort(key=lambda m: m.get('timestamp', 0))
(OUT / 'recovered-parent-zero-delta-reminders.json').write_text(json.dumps(reminders,
    ensure_ascii=False, indent=2), encoding='utf-8')

repair_snapshots = rows(REPAIR, 'observation-snapshots.jsonl')
before = next(r for r in repair_snapshots if r.get('decision_cycle_id') == 'parent-decision-cycle-after-action-1')
after = next(r for r in repair_snapshots if r.get('decision_cycle_id') == 'parent-decision-cycle-after-action-2')
b, a = before['public_state']['frames'][-1], after['public_state']['frames'][-1]
changed = [{'x': x, 'y': y, 'before': b[y][x], 'after': a[y][x]}
    for y in range(len(a)) for x in range(len(a[y])) if a[y][x] != b[y][x]]
compactions = rows(RUN, 'task-context-compactions.jsonl')
strategy = json.loads((RUN / 'task-strategy-state.json').read_text(encoding='utf-8'))
summary = {
    'run': str(RUN), 'canonical_ref': 'observation_snapshot:parent-state-1@v1',
    'canonical_state_json_chars': len(json.dumps(snapshot['public_state'], separators=(',', ':'), ensure_ascii=False)),
    'frame_shape': [len(frame), len(frame[0])],
    'first_provider_request': requests[0],
    'authoritative_parent_request_count': len(requests),
    'system_prompt_string_chars_range': [min(r['modules']['system_prompt']['string_chars'] for r in requests),
        max(r['modules']['system_prompt']['string_chars'] for r in requests)],
    'completed_action_tool_records': len(actions), 'successful_actions': sum(not r.get('is_error') for r in actions),
    'error_actions': sum(bool(r.get('is_error')) for r in actions),
    'zero_pixel_delta_results': sum(bool(re.search(r'changed_cells=0(?:\D|$)', r.get('result_text', ''))) for r in actions),
    'candidates': len(strategy['candidates']), 'selected_candidate': strategy['selected_candidate_id'], 'plan': strategy['plan'],
    'first_parent_action_input': actions[0]['input'],
    'first_parent_checkpoint': next(r['args'] for r in events if r.get('type') == 'tool_execution_start' and r.get('toolName') == 'task_checkpoint'),
    'feedback_requests': feedback_requests, 'unique_parent_feedback_messages_in_cache': len(reminders),
    'old_feedback_example': text(reminders[0]) if reminders else None,
    'recovered_arc_state_texts': recovered,
    'last_compaction': compactions[-1],
    'repair_second_action_changed_cells': changed,
    'payload_capture_files': [str(p) for p in RUN.glob('provider-prompt-*.json')],
    'reconstruction_limit': 'No complete provider body or system prompt was captured for this run. Parent native archives exclude system prompt; recovered full arc_state tools belong to children. Do not call these final parent payloads.',
}
(OUT / 'evidence-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

from PIL import Image
palette = {0:'#000000', 1:'#0074D9', 2:'#FF4136', 3:'#2ECC40', 4:'#FFDC00', 5:'#AAAAAA',
           6:'#F012BE', 7:'#FF851B', 8:'#7FDBFF', 9:'#870C25', 12:'#FFFFFF'}
image = Image.new('RGB', (len(frame[0]), len(frame)))
for y, row in enumerate(frame):
    for x, color in enumerate(row):
        image.putpixel((x, y), tuple(bytes.fromhex(palette.get(color, '#FFFFFF')[1:])))
image.resize((512, 512), Image.Resampling.NEAREST).save(OUT / 'canonical-parent-state-1.png')
print(json.dumps({'successful_actions': summary['successful_actions'], 'zero_deltas': summary['zero_pixel_delta_results'],
    'feedback_requests': len(feedback_requests), 'cached_parent_feedback': len(reminders),
    'recovered_frames': recovered, 'repair_second_delta': len(changed), 'output': str(OUT)}, ensure_ascii=False))
