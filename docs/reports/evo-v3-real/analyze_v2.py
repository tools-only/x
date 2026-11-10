"""Read-only request composition audit. No credentials or raw payload output."""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
result = {}
for arm in ['calibration-A', 'sample-B1', 'sample-B2']:
    directory = ROOT / 'runs/evo-v2-real-20261111' / arm
    rows = []
    for line in (directory / 'harness/provider-requests.jsonl').read_text(encoding='utf-8').splitlines():
        row = json.loads(line)
        payload = json.loads(row['payload'])
        messages = payload.get('messages', [])
        tools = payload.get('tools', [])
        size = lambda v: len(json.dumps(v, ensure_ascii=False, separators=(',', ':')))
        rows.append({'request': row['request'], 'payload_chars': size(payload),
                     'system_chars': sum(size(m) for m in messages if m['role']=='system'),
                     'tools_chars': size(tools), 'history_chars': sum(size(m) for m in messages if m['role']!='system'),
                     'message_roles': dict(Counter(m['role'] for m in messages)),
                     'tool_names': [t.get('function',t).get('name') for t in tools]})
    saved = json.loads((directory / '.harness/live-self.json').read_text(encoding='utf-8')) if (directory / '.harness/live-self.json').exists() else {}
    ledger = saved.get('root',{}).get('ledger',[])
    result[arm] = {'requests':rows, 'last_messages':[
        {'role':m['role'],'chars':size(m),'keys':list(m),'name':m.get('name'),
         'calls':[{'name':c.get('function',{}).get('name'), 'args':c.get('function',{}).get('arguments') if c.get('function',{}).get('name')=='decide' else None} for c in m.get('tool_calls',[])]}
        for m in messages], 'ledger_types':dict(Counter(r['type'] for r in ledger)),
                   'review_trace':[r for r in ledger if r['type'] in ('event','mode_entered','review_closed','request_cost')]}
target = Path(__file__).with_name('v2-composition.json')
target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result['sample-B1']['last_messages'],ensure_ascii=False))
