"""Freeze non-secret summaries and task artifacts; never copy auth directories."""
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path

from autoresearch_pi import evo_ppt as e

source=e.PROJECT/'runs/evo-v3-real-20261111'
target=Path(__file__).parent
read=lambda p,default:json.loads(p.read_text(encoding='utf-8')) if p.exists() else default
lines=lambda p:[json.loads(s) for s in p.read_text(encoding='utf-8').splitlines()] if p.exists() else []
results=[]
for arm in ['calibration-A','sample-B1','sample-B2']:
    root=source/arm
    if not root.exists():
        results.append({'arm':arm,'status':'not_started'}); continue
    dest=target/arm
    dest.mkdir(exist_ok=True)
    for name in ['manifest.json','runtime-manifest.json','summary.json','inference-preflight.json','renderer-preflight.json','budget-stop.json']:
        if (root/name).exists(): shutil.copyfile(root/name,dest/name)
    saved=read(root/'.harness/live-self.json',{})
    ledger=saved.get('root',{}).get('ledger',[])
    requests=lines(root/'harness/provider-requests.jsonl')
    usage=lines(root/'harness/model-usage.jsonl')
    events=lines(root/'pi-events.jsonl')
    messages=[r['message'] for r in events if r.get('type')=='message_end' and r.get('message',{}).get('role')=='assistant']
    calls=[c for m in messages for c in m.get('content',[]) if c.get('type')=='toolCall']
    checker=[]
    for row in events:
        if row.get('type') not in ('tool_execution_end','message_end'): continue
        result=row.get('result',row.get('message',{}))
        content=result.get('content',[])
        if isinstance(content,str): content=[{'type':'text','text':content}]
        for part in content:
            if part.get('type')=='text' and part.get('text','').startswith('{'):
                # All selected text here is our structured office response.
                decoder=json.JSONDecoder()
                try: value,end=decoder.raw_decode(part['text'])
                except ValueError: continue
                if isinstance(value,dict) and value.get('acceptance'): checker.append(value['acceptance'])
    checker.extend(r['value'] for r in ledger if r['type']=='task_outcome')
    audits=[]
    for row in requests:
        payload=json.loads(row['payload'])
        decide=next((t.get('function',t).get('parameters') for t in payload.get('tools',[]) if t.get('function',t).get('name')=='decide'),None)
        audits.append({k:v for k,v in row.items() if k!='payload'} | {'decide_schema':decide,
            'reasoning_message_count':sum(bool(m.get('reasoning_content')) for m in payload.get('messages',[])),
            'schema_tool_names':[t.get('function',t).get('name') for t in payload.get('tools',[])]})
    final=read(root/'summary.json',{})
    state=read(root/'.harness/ppt-loop.json',{})
    receipts=[read(p,{}) for p in sorted((root/'exports').glob('v*/receipt.json'))]
    posthoc=read(source/'posthoc'/arm/'acceptance.json',None)
    if posthoc:
        e.write(dest/'posthoc-acceptance.json',posthoc)
        shutil.copyfile(source/'posthoc'/arm/'exports/v001/contact-sheet.png',dest/'posthoc-contact-sheet.png')
    artifact=root/'delivery/presentation.html'
    if not artifact.exists(): artifact=root/'workspace/artifacts/presentation.html'
    if artifact.exists(): shutil.copyfile(artifact,dest/('delivered.html' if (root/'delivery/presentation.html').exists() else 'partial.html'))
    for p in [root/'delivery/contact-sheet.png',root/'delivery/receipt.json']:
        if p.exists(): shutil.copyfile(p,dest/p.name)
    hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'session.jsonl',root/'pi-events.jsonl',root/'.harness/live-self.json',root/'harness/provider-requests.jsonl',root/'harness/model-usage.jsonl',artifact] if p.is_file()}
    known=Counter()
    for row in usage:
        for k,v in (row.get('usage') or {}).items():
            if isinstance(v,(int,float)): known[k]+=v
    latest_units={}
    for fact in checker:
        for u in fact.get('units',[]): latest_units[u['id']]=u
    data={'arm':arm,'summary':final,'runtime_state':state,'reported_task_usage':dict(known),
        'response_stops':dict(Counter(m.get('stopReason') for m in messages)),
        'length_responses':[{'usage':m.get('usage'),'content_types':[c['type'] for c in m.get('content',[])]} for m in messages if m.get('stopReason')=='length'],
        'unknown_task_requests':[r['request'] for r in requests if not any(u['request']==r['request'] and u.get('usage') for u in usage)],
        'tool_calls':dict(Counter(c['name'] for c in calls)),
        'tool_errors':[{'tool':r.get('toolName'),'call':r.get('toolCallId'),'content':r.get('result',{}).get('content')} for r in events if r.get('type')=='tool_execution_end' and (r.get('isError') or r.get('result',{}).get('isError'))],
        'decisions':[c for c in calls if c['name']=='decide'],
        'ledger_counts':dict(Counter(r['type'] for r in ledger)),
        'lifecycle':[r for r in ledger if r['type'] in ['mode_entered','review_closed','reflection_activated','validation_delivered','validation_interpreted','validation_enacted','unit_delivered','coverage_gap']],
        'windows':saved.get('root',{}).get('windows',[]),
        'checker_facts':checker,'latest_unit_facts':list(latest_units.values()),'render_receipts':receipts,'posthoc_acceptance':posthoc,
        'usage':usage,'request_audit':audits,'hashes':hashes,
        'runtime_definitions':[{'revision':d['revision'],'policy':d['policy'],'components':[{k:c[k] for k in ['kind','name','version','hash'] if k in c} for c in d['base']['snapshot']['components']]} for d in saved.get('root',{}).get('definitions',[])]}
    e.write(dest/'evidence.json',data)
    results.append({'arm':arm,'summary':final,'reported_task_usage':dict(known),'tool_calls':data['tool_calls'],'response_stops':data['response_stops'],
                    'latest_unit_facts':list(latest_units.values()),'runtime_windows':data['windows'],'hashes':hashes,'posthoc_acceptance':posthoc})
e.write(target/'results.json',results)
for name in ['final-accounting.json','round-results.json','round-plan.json','calibration.json','round-stop.json','posthoc-results.json']:
    if (source/name).exists(): shutil.copyfile(source/name,target/name)
print(json.dumps([{'arm':r['arm'],'stop':r.get('summary',{}).get('stop',r.get('status')),
                  'resources':r.get('summary',{}).get('resources'),'checker_units':len(r.get('latest_unit_facts',[]))} for r in results],ensure_ascii=False))
